import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { generateBlog, generateImage, type BlogContent } from "@/src/lib/gemini";
import { Loader2, Send, Sparkles, Image as ImageIcon, BarChart3, CheckCircle2, History, LayoutDashboard, Trash2, Search, Calendar, ListTodo, Settings as SettingsIcon, Play, Clock, CheckCircle, Eye, UploadCloud, LogOut } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { db } from "@/src/lib/firebase";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, updateDoc, setDoc, getDoc, writeBatch, runTransaction } from "firebase/firestore";
import showdown from "showdown";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

const isUsableApiKey = (rawKey: string) => {
  const key = rawKey.trim();
  if (!key) return false;
  const looksLikePlaceholder = /^(my_|your_|replace|change-me|changeme|test)/i.test(key) || key.includes("YOUR_") || key.includes("MY_");
  if (looksLikePlaceholder) return false;
  return key.length >= 20;
};

export default function BlogDashboard({ onLogout }: { onLogout?: () => void }) {
  const [view, setView] = useState<'dashboard' | 'queue' | 'settings'>('dashboard');
  const [queue, setQueue] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({ 
    additionalApiKeys: [], 
    defaultOldLinks: [], 
    defaultInternalLinks: [],
    categorizedLinks: [] 
  });
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [instanceId] = useState(() => {
    const envInstanceId = (((import.meta as any).env?.VITE_RIXLY_INSTANCE_ID as string) || "").trim();
    if (envInstanceId) {
      localStorage.setItem("rixly_instance_id", envInstanceId);
      return envInstanceId;
    }

    const params = new URLSearchParams(window.location.search);
    const queryInstanceId = (params.get("instance") || "").trim();
    if (queryInstanceId) {
      localStorage.setItem("rixly_instance_id", queryInstanceId);
      return queryInstanceId;
    }

    const storageKey = "rixly_instance_id";
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  });
  const queueCollectionName = "queue";
  const settingsDocId = `automation_${instanceId}`;
  
  const [topics, setTopics] = useState<{topic: string, instructions: string}[]>([
    {topic: "", instructions: ""}, 
    {topic: "", instructions: ""}
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ message: string; timestamp: string; type: 'info' | 'success' | 'error' }[]>([]);
  
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Queue Listener
    const qQueue = query(
      collection(db, queueCollectionName),
      where("instanceId", "==", instanceId),
      orderBy("createdAt", "desc")
    );
    const unsubQueue = onSnapshot(qQueue, (snapshot) => {
      setQueue(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Settings Listener
    const unsubSettings = onSnapshot(doc(db, "settings", settingsDocId), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        const sanitizedSettings = { ...data };
        delete sanitizedSettings.sanityProjectId;
        delete sanitizedSettings.sanityDataset;
        delete sanitizedSettings.sanityToken;
        setSettings(sanitizedSettings);
        if (sanitizedSettings.autoDelaySeconds !== undefined) {
          setTimerDuration(sanitizedSettings.autoDelaySeconds);
          // Only reset countdown if timer is not active or if it's the first load
          setCountdown(prev => isTimerActive ? prev : sanitizedSettings.autoDelaySeconds);
        }
      }
    });

    return () => {
      unsubQueue();
      unsubSettings();
    };
  }, [queueCollectionName, settingsDocId, isTimerActive]);

  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { message, timestamp: new Date().toLocaleTimeString(), type }]);
  };

  const toMillisSafe = (value: any): number | null => {
    if (!value) return null;
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  };

  const extractRetryDelayMs = (message: string): number | null => {
    if (!message) return null;
    const retryInfoMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (retryInfoMatch?.[1]) {
      return Number(retryInfoMatch[1]) * 1000;
    }
    const plainSecondsMatch = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s?/i);
    if (plainSecondsMatch?.[1]) {
      return Math.ceil(Number(plainSecondsMatch[1]) * 1000);
    }
    return null;
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // If it's a URL (like Picsum), we need crossOrigin to avoid "tainted canvas" error
      if (base64Str.startsWith('http')) {
        img.crossOrigin = "anonymous";
      }
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; 
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Str);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (err) {
          console.error("Compression failed (likely CORS):", err);
          resolve(base64Str); // Fallback to original if compression fails
        }
      };
      img.onerror = () => {
        console.error("Image load failed for compression");
        resolve(base64Str);
      };
    });
  };

  const [previewBlog, setPreviewBlog] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [countdown, setCountdown] = useState(10);
  const [timerDuration, setTimerDuration] = useState(10);
  const [autoUploadQueue, setAutoUploadQueue] = useState<string[]>([]);
  const [localAutoUploadEnabled, setLocalAutoUploadEnabled] = useState(() => {
    const saved = localStorage.getItem("localAutoUploadEnabled");
    return saved !== null ? JSON.parse(saved) : true;
  });

  const builtInGeminiKey = (process.env.GEMINI_API_KEY as string | undefined)?.trim() || "";
  const builtInOpenRouterKey = (process.env.OPENROUTER_API_KEY as string | undefined)?.trim() || "";
  const availableApiKeys = [
    builtInGeminiKey,
    ...(settings.additionalApiKeys || []),
  ].map((key) => key.trim()).filter(isUsableApiKey);

  React.useEffect(() => {
    localStorage.setItem("localAutoUploadEnabled", JSON.stringify(localAutoUploadEnabled));
  }, [localAutoUploadEnabled]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 || h > 0 ? m + 'm ' : ''}${s}s`;
  };

  const preGenerate = async () => {
    const nowMs = Date.now();
    const pendingItems = queue.filter(t => {
      if (t.status !== 'pending') return false;
      const scheduledMs = toMillisSafe(t.scheduledAt);
      if (scheduledMs !== null) return scheduledMs <= nowMs;
      const createdMs = toMillisSafe(t.createdAt);
      const itemDelaySeconds = typeof t.delaySeconds === "number" ? Math.max(0, t.delaySeconds) : Math.max(0, timerDuration);
      return createdMs !== null ? createdMs + (itemDelaySeconds * 1000) <= nowMs : false;
    }).sort((a, b) => {
      const timeA = toMillisSafe(a.scheduledAt) ?? toMillisSafe(a.createdAt) ?? 0;
      const timeB = toMillisSafe(b.scheduledAt) ?? toMillisSafe(b.createdAt) ?? 0;
      return timeA - timeB;
    }).slice(0, 1);
    
    if (pendingItems.length === 0) {
      addLog("No pending topics found for pre-generation.", "info");
      return;
    }

    setIsGenerating(true);
    setShowLogs(true);
    setLogs([]);
    addLog(`Starting pre-generation for topic...`, "info");

    const oldLinkList = settings.defaultOldLinks || [];
    const internalLinkList = settings.defaultInternalLinks || [];
    const apiKeys = availableApiKeys;
    const preferredKey = settings.preferredApiKey || builtInGeminiKey;
    const openRouterKey = settings.openRouterKey || builtInOpenRouterKey;
    const categorizedLinks = settings.categorizedLinks || [];

    try {
      for (const item of pendingItems) {
        addLog(`Generating content for: ${item.topic}...`, "info");
        try {
          const blog = await generateBlog(item.topic, oldLinkList, internalLinkList, apiKeys, preferredKey, openRouterKey, categorizedLinks, item.customInstructions);
          addLog(`Content generated for: ${item.topic}. Now generating image...`, "info");
          const rawImage = await generateImage(blog.imagePrompt, apiKeys, preferredKey, openRouterKey);
          const image = await compressImage(rawImage);
          
            const docRef = doc(db, queueCollectionName, item.id);
          const docSnap = await getDoc(docRef);
          
          if (!docSnap.exists()) {
            addLog(`Item ${item.topic} was removed from queue during generation. Skipping update.`, "info");
            continue;
          }

          await updateDoc(docRef, {
            status: "generated",
            generatedAt: serverTimestamp(),
            generatedContent: {
              ...blog,
              image
            }
          });

          await setDoc(doc(db, "settings", settingsDocId), { lastGeneratedAt: serverTimestamp() }, { merge: true });

          addLog(`Successfully generated: ${item.topic}`, "success");

          // Bypass scheduler when user manually clicks pre-generate: publish immediately.
          if (localAutoUploadEnabled) {
            addLog(`Publishing ${item.topic} to Sanity (direct publish path)...`, "info");
            await updateDoc(docRef, { status: "uploading" });
            const uploadResponse = await handleUpload(blog, image);
            await updateDoc(docRef, {
              status: "completed",
              completedAt: serverTimestamp(),
              publishedDocumentId: uploadResponse?.documentId || null,
            });
            addLog(`Published ${item.topic} successfully.`, "success");
          } else {
            addLog(`Generated ${item.topic}. Waiting for manual upload (auto-upload disabled).`, "info");
          }
        } catch (itemError: any) {
          addLog(`Failed to generate "${item.topic}": ${itemError.message}`, "error");

          try {
            const retryDelayMs = extractRetryDelayMs(itemError?.message || "") || 60000;
            const safeRetryDelayMs = Math.max(10000, Math.min(retryDelayMs + 2000, 5 * 60 * 1000));
            await updateDoc(doc(db, queueCollectionName, item.id), {
              scheduledAt: new Date(Date.now() + safeRetryDelayMs),
              lastError: itemError?.message || "Generation failed",
            });
            addLog(`Rescheduled ${item.topic} after failure in ${Math.ceil(safeRetryDelayMs / 1000)}s.`, "info");
          } catch (rescheduleError: any) {
            console.error("Failed to reschedule item after error:", rescheduleError);
          }

          throw itemError;
        }
      }
      toast.success("Pre-generation complete!");
      setTimeout(() => setShowLogs(false), 3000);
    } catch (error: any) {
      console.error("Pre-generation error:", error);
      toast.error(`Pre-generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  React.useEffect(() => {
    const interval = setInterval(() => {
      const pendingItems = queue.filter(t => t.status === 'pending');

      if (pendingItems.length === 0 || isGenerating) {
        setIsTimerActive(false);
        setCountdown(timerDuration);
        return;
      }

      const nowMs = Date.now();
      const lastGeneratedMs = toMillisSafe(settings?.lastGeneratedAt);
      const nextDueMs = pendingItems
        .map((item) => {
          const scheduledMs = toMillisSafe(item.scheduledAt);
          if (scheduledMs !== null) return scheduledMs;
          const createdMs = toMillisSafe(item.createdAt);
          const itemDelaySeconds = typeof item.delaySeconds === "number" ? Math.max(0, item.delaySeconds) : Math.max(0, timerDuration);
          if (createdMs !== null) return createdMs + (itemDelaySeconds * 1000);
          return null;
        })
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b)[0];

      if (nextDueMs === undefined) {
        setIsTimerActive(false);
        setCountdown(timerDuration);
        return;
      }

      const minCadenceDueMs = lastGeneratedMs !== null
        ? lastGeneratedMs + Math.max(0, timerDuration) * 1000
        : nextDueMs;
      const effectiveDueMs = Math.max(nextDueMs, minCadenceDueMs);

      setIsTimerActive(true);
      setCountdown(Math.max(0, Math.ceil((effectiveDueMs - nowMs) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [queue, isGenerating, timerDuration, settings?.lastGeneratedAt]);

  React.useEffect(() => {
    if (isTimerActive && countdown === 0 && !isGenerating) {
      console.log("Timer hit zero, auto-triggering pre-generation...");
      preGenerate().catch((err) => {
        console.error("Auto pre-generate failed:", err);
      });
    }
  }, [isTimerActive, countdown, isGenerating]);

  const updateTimerDuration = async (newTotal: number) => {
    setTimerDuration(newTotal);
    setCountdown(newTotal);
    try {
      await setDoc(doc(db, "settings", settingsDocId), { autoDelaySeconds: newTotal }, { merge: true });
    } catch (error) {
      console.error("Failed to sync timer duration:", error);
    }
  };

  const addToQueue = async () => {
    const topicList = topics.filter(t => t.topic.trim());
    if (topicList.length === 0) {
      toast.error("Enter topics to add to queue");
      return;
    }

    try {
      toast.info(`Adding ${topicList.length} topics to queue...`);
      const pendingItems = queue.filter(t => t.status === 'pending');
      const latestPendingDueMs = pendingItems
        .map((item) => {
          const scheduledMs = toMillisSafe(item.scheduledAt);
          if (scheduledMs !== null) return scheduledMs;
          const createdMs = toMillisSafe(item.createdAt);
          const itemDelaySeconds = typeof item.delaySeconds === "number" ? Math.max(0, item.delaySeconds) : Math.max(0, timerDuration);
          return createdMs !== null ? createdMs + itemDelaySeconds * 1000 : null;
        })
        .filter((value): value is number => value !== null)
        .sort((a, b) => b - a)[0];

      const baseScheduleMs = Math.max(Date.now(), latestPendingDueMs ?? Date.now());
      const delayMs = Math.max(0, timerDuration) * 1000;

      for (let index = 0; index < topicList.length; index++) {
        const item = topicList[index];
        const scheduledAt = new Date(baseScheduleMs + delayMs * (index + 1));
        await addDoc(collection(db, queueCollectionName), {
          topic: item.topic,
          customInstructions: item.instructions,
          status: "pending",
          createdAt: serverTimestamp(),
          scheduledAt,
          delaySeconds: Math.max(0, timerDuration),
          instanceId,
        });
      }
      setTopics([{topic: "", instructions: ""}, {topic: "", instructions: ""}]);
      toast.success("Topics added to queue!");
      setView('queue');
    } catch (error: any) {
      toast.error("Failed to add to queue");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    const processLinks = async (data: any[]) => {
      const newLinks = data.map((row: any) => ({
        url: row.url || row.URL || row.link || row.Link,
        category: row.category || row.Category || "General",
        title: row.title || row.Title || ""
      })).filter(l => l.url);

      if (newLinks.length === 0) {
        toast.error("No valid links found. Ensure you have a 'url' column.");
        return;
      }

      try {
        const currentLinks = settings.categorizedLinks || [];
        const updatedLinks = [...currentLinks, ...newLinks];
        await updateSettings({ categorizedLinks: updatedLinks });
        toast.success(`Successfully added ${newLinks.length} links!`);
      } catch (err) {
        toast.error("Failed to save links to database");
      }
    };

    if (fileExtension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processLinks(results.data),
        error: (err) => toast.error(`Error parsing CSV: ${err.message}`)
      });
    } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          processLinks(data);
        } catch (err: any) {
          toast.error(`Error parsing Excel file: ${err.message}`);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      toast.error("Unsupported file format. Please upload .csv, .xlsx, or .xls");
    }
  };

  const updateSettings = async (newSettings: any) => {
    try {
      const sanitizedUpdates = { ...newSettings };
      delete sanitizedUpdates.sanityProjectId;
      delete sanitizedUpdates.sanityDataset;
      delete sanitizedUpdates.sanityToken;
      await setDoc(doc(db, "settings", settingsDocId), sanitizedUpdates, { merge: true });
      toast.success("Settings updated");
    } catch (error: any) {
      toast.error("Failed to update settings");
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const deleteFromQueue = async (id: string, silent = false) => {
    try {
      await deleteDoc(doc(db, queueCollectionName, id));
      if (!silent) toast.success("Removed from queue");
    } catch (error) {
      console.error("Error deleting from queue:", error);
    }
    setDeleteConfirm(null);
  };

  const updateTopic = (index: number, field: 'topic' | 'instructions', value: string) => {
    const newTopics = [...topics];
    newTopics[index] = { ...newTopics[index], [field]: value };
    setTopics(newTopics);
  };

  const generateRandomTopics = () => {
    const randomTitles = [
      "The Future of AI in Sales Intelligence",
      "How Community-Led Growth is Changing SaaS",
      "Mastering Reddit Marketing for Startups",
      "SEO vs GEO: What You Need to Know in 2024",
      "Product Intelligence: The Key to User Retention",
      "Automating Lead Generation with AI",
      "The Rise of Generative Engine Optimization",
      "Building a Brand on Reddit: Do's and Don'ts",
      "Scaling Sales with AI-Powered Insights",
      "Why Community is the New Competitive Moat"
    ];
    
    const selected = [...randomTitles].sort(() => 0.5 - Math.random()).slice(0, 3);
    setTopics(selected.map(t => ({ topic: t, instructions: "Write in a professional yet engaging tone." })));
    toast.success("Random titles generated!");
  };

  const handleUpload = async (blog: any, image: string) => {
    const slugify = (value: string) =>
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    const uploadToServer = async () => {
      const response = await fetch("/api/upload-blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: blog.title,
          slug: blog.slug,
          content: htmlContent,
          author: blog.author,
          category: blog.category,
          excerpt: blog.excerpt,
          seoTitle: blog.seoTitle,
          seoDescription: blog.seoDescription,
          tags: blog.tags,
          altText: blog.altText,
          imageBase64: image,
        }),
      });

      const text = await response.text();
      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = JSON.parse(text);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("SERVER_404");
        }
        throw new Error(data?.error || text || `Server Error ${response.status}`);
      }
      return data;
    };

    // Convert Markdown to HTML for Sanity
    const converter = new showdown.Converter({
      tables: true,
      strikethrough: true,
      tasklists: true,
      simpleLineBreaks: true,
      openLinksInNewWindow: true
    });
    const htmlContent = converter.makeHtml(blog.content);

    try {
      setIsUploading(blog.slug || "uploading");
      toast.info(`Uploading "${blog.title}" to Sanity...`);
      
      const data = await uploadToServer();
      if (!data?.success) {
        throw new Error(data?.error || "Upload failed");
      }

      // Automatically add to categorized links for future backlinks
      try {
        const newLink = {
          url: `https://www.userixly.com/blog/${blog.slug}`,
          category: blog.category || "General",
          title: blog.title
        };

        const currentLinks = settings.categorizedLinks || [];
        if (!currentLinks.some((l: any) => l.url === newLink.url)) {
          const updatedLinks = [...currentLinks, newLink];
          await updateSettings({ categorizedLinks: updatedLinks });
          console.log("Added new blog to internal links database");
        }
      } catch (linkErr) {
        console.error("Failed to auto-add link to database:", linkErr);
      }

      return {
        success: true,
        documentId: data?.documentId || data?.result?._id || null,
        result: data?.result || null,
      };
    } catch (error: any) {
      console.error("Sanity Upload Error:", error);
      let errorMsg = error.message;
      if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("Request error")) {
        errorMsg = "Network connection failed. Please check your internet and Sanity Project ID.";
      }
      toast.error("Upload failed: " + errorMsg);
      throw error; 
    } finally {
      setIsUploading(null);
    }
  };

  // Auto-upload logic: Watch for newly generated items
  React.useEffect(() => {
    if (!localAutoUploadEnabled) return;

    const generatedItems = queue.filter(t => t.status === 'generated');
    generatedItems.forEach(item => {
      if (!autoUploadQueue.includes(item.id)) {
        setAutoUploadQueue(prev => [...prev, item.id]);
        addLog(`Auto-upload scheduled for ${item.topic} in 5 seconds...`, "info");
        setTimeout(async () => {
          try {
            // Use a transaction to "lock" the upload process so only one instance does it
            const docRef = doc(db, queueCollectionName, item.id);
            await runTransaction(db, async (transaction) => {
              const sfDoc = await transaction.get(docRef);
              if (!sfDoc.exists()) throw new Error("Document does not exist!");
              if (sfDoc.data().status !== 'generated') throw new Error("Already uploading or completed by another instance.");
              
              // Mark as uploading to lock it
              transaction.update(docRef, { status: 'uploading' });
            });

            // If transaction succeeds, this instance is the winner
            addLog(`Lock acquired for ${item.topic}. Starting upload...`, "info");

            try {
              const uploadResponse = await handleUpload(item.generatedContent, item.generatedContent.image);
              await updateDoc(doc(db, queueCollectionName, item.id), {
                status: 'completed',
                completedAt: serverTimestamp(),
                publishedDocumentId: uploadResponse?.documentId || null,
              });
              setAutoUploadQueue(prev => prev.filter(id => id !== item.id));
            } catch (err: any) {
              addLog(`Auto-upload failed for ${item.topic}: ${err.message}`, "error");
              // Revert status to generated so it can be retried
              await updateDoc(doc(db, queueCollectionName, item.id), { status: 'generated' });
              setAutoUploadQueue(prev => prev.filter(id => id !== item.id));
            }
          } catch (lockError: any) {
            console.log("Auto-upload lock skip:", lockError.message);
            // This is expected if another instance already started the upload
          }
        }, 5000);
      }
    });
  }, [queue, autoUploadQueue, localAutoUploadEnabled]);

  return (
    <div className="container mx-auto py-10 px-4 max-w-6xl">
      {/* Debug Info */}
      {availableApiKeys.length === 0 && (
        <div className="bg-red-500 text-white text-center py-2 rounded-lg mb-4 text-sm font-bold animate-pulse">
          ⚠️ No AI keys configured! Add `VITE_GEMINI_API_KEY` in `.env` or add at least one API key in the Settings tab.
        </div>
      )}
      
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
        {/* Navigation Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rixly Automator</h1>
              <p className="text-slate-500 text-sm">Full-scale blog automation.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 w-full md:w-auto custom-scrollbar">
            <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
              <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
              <NavButton active={view === 'queue'} onClick={() => setView('queue')} icon={<ListTodo className="h-4 w-4" />} label="Queue" />
              <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={<SettingsIcon className="h-4 w-4" />} label="Settings" />
            </div>
            {onLogout && (
              <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-500 hover:text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            )}
          </div>
        </div>

        {view === 'dashboard' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-800">Title Manager</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="lg" onClick={generateRandomTopics} className="border-slate-200 text-slate-600 hover:bg-slate-50">
                  <Sparkles className="mr-2 h-4 w-4 text-indigo-500" />
                  Random Titles
                </Button>
                <Button size="lg" onClick={addToQueue} disabled={isGenerating} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200">
                  <ListTodo className="mr-2 h-5 w-5" />
                  Add to Queue
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {showLogs && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <Card className="bg-slate-900 border-slate-800 text-slate-300 font-mono text-sm">
                    <CardHeader className="border-b border-slate-800 py-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        Live Logs
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setShowLogs(false)} className="h-8 text-slate-400 hover:text-white hover:bg-slate-800">Close</Button>
                    </CardHeader>
                    <CardContent ref={logContainerRef} className="p-4 max-h-75 overflow-y-auto space-y-1 scroll-smooth">
                      {logs.map((log, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="text-slate-600 whitespace-nowrap">[{log.timestamp}]</span>
                          <span className={log.type === 'success' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : 'text-slate-300'}>{log.message}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="max-w-xl mx-auto">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader><CardTitle className="text-lg">Enter Titles</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-semibold text-slate-700">Titles & Instructions</Label>
                      <Button variant="ghost" size="sm" onClick={() => setTopics([...topics, {topic: "", instructions: ""}])} className="h-7 text-indigo-600 text-xs font-semibold hover:bg-indigo-50">+ Add Title</Button>
                    </div>
                    <div className="space-y-4 max-h-125 overflow-y-auto pr-2 custom-scrollbar">
                      {topics.map((item, index) => (
                        <div key={index} className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3 relative group">
                          <div className="flex gap-2 items-center">
                            <Input 
                              placeholder={`Title ${index + 1}`} 
                              value={item.topic} 
                              onChange={(e) => updateTopic(index, 'topic', e.target.value)} 
                              className="h-9 text-sm bg-white" 
                            />
                            {topics.length > 1 && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => setTopics(topics.filter((_, i) => i !== index))} 
                                className="h-8 w-8 text-slate-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <Textarea 
                            placeholder="Specific instructions for this title (optional)..." 
                            value={item.instructions} 
                            onChange={(e) => updateTopic(index, 'instructions', e.target.value)}
                            className="min-h-15 text-xs resize-none bg-white"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {view === 'queue' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-slate-800">Title Queue</h2>
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <div className="px-3 py-1.5 bg-white rounded-md shadow-sm flex items-center gap-2">
                    <Clock className={`h-4 w-4 ${isTimerActive ? 'text-indigo-500 animate-pulse' : 'text-slate-400'}`} />
                    <span className="text-sm font-bold text-slate-700 min-w-15 text-center">{formatTime(countdown)}</span>
                  </div>
                  <div className="flex items-center gap-1 px-2 border-l border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Delay:</span>
                    <div className="flex items-center gap-1">
                      <input 
                        type="number" 
                        placeholder="H"
                        min="0"
                        className="w-8 bg-transparent text-xs font-bold text-indigo-600 focus:outline-none text-center"
                        value={Math.floor(timerDuration / 3600) || ""}
                        onChange={(e) => {
                          const h = parseInt(e.target.value) || 0;
                          const currentM = Math.floor((timerDuration % 3600) / 60);
                          const currentS = timerDuration % 60;
                          const newTotal = (h * 3600) + (currentM * 60) + currentS;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] text-slate-400">h</span>
                      <input 
                        type="number" 
                        placeholder="M"
                        min="0"
                        max="59"
                        className="w-8 bg-transparent text-xs font-bold text-indigo-600 focus:outline-none text-center"
                        value={Math.floor((timerDuration % 3600) / 60) || ""}
                        onChange={(e) => {
                          const m = parseInt(e.target.value) || 0;
                          const currentH = Math.floor(timerDuration / 3600);
                          const currentS = timerDuration % 60;
                          const newTotal = (currentH * 3600) + (m * 60) + currentS;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] text-slate-400">m</span>
                      <input 
                        type="number" 
                        placeholder="S"
                        min="0"
                        max="59"
                        className="w-8 bg-transparent text-xs font-bold text-indigo-600 focus:outline-none text-center"
                        value={timerDuration % 60 || ""}
                        onChange={(e) => {
                          const s = parseInt(e.target.value) || 0;
                          const currentH = Math.floor(timerDuration / 3600);
                          const currentM = Math.floor((timerDuration % 3600) / 60);
                          const newTotal = (currentH * 3600) + (currentM * 60) + s;
                          updateTimerDuration(newTotal);
                        }}
                      />
                      <span className="text-[10px] text-slate-400">s</span>
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={() => preGenerate()} 
                  disabled={isGenerating || queue.filter(t => t.status === 'pending').length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Pre-generate Next One
                </Button>
              </div>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">
                  <Sparkles className="h-3 w-3" />
                  {queue.filter(t => t.status === 'generated').length} Generated
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
                  <Clock className="h-3 w-3" />
                  {queue.filter(t => t.status === 'pending').length} Pending
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-semibold">
                  <CheckCircle className="h-3 w-3" />
                  {queue.filter(t => t.status === 'completed').length} Completed
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                  <ListTodo className="h-4 w-4" /> Pending & Generated
                </h3>
                <div className="space-y-3">
                  {queue.filter(t => t.status !== 'completed').map((item) => (
                    <Card key={item.id} className={`border-slate-200 shadow-sm hover:shadow-md transition-all ${item.status === 'generated' ? 'border-l-4 border-l-blue-500' : ''}`}>
                      <CardContent className="p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${item.status === 'generated' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                            {item.status === 'generated' ? <Sparkles className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{item.topic}</p>
                            <p className="text-xs text-slate-500">
                              {item.status === 'generated' ? 'Generated & Ready for Review' : 'Waiting for automation...'}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {item.status === 'generated' && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => setPreviewBlog(item.generatedContent)} className="h-8 text-blue-600 border-blue-200 hover:bg-blue-50">
                                <Eye className="h-4 w-4 mr-1" /> Preview
                              </Button>
                              <Button 
                                size="sm" 
                                disabled={isUploading !== null}
                                onClick={async () => {
                                  try {
                                    await updateDoc(doc(db, queueCollectionName, item.id), { status: 'uploading' });
                                    const uploadResponse = await handleUpload(item.generatedContent, item.generatedContent.image);
                                    await updateDoc(doc(db, queueCollectionName, item.id), {
                                      status: 'completed',
                                      completedAt: serverTimestamp(),
                                      publishedDocumentId: uploadResponse?.documentId || null,
                                    });
                                  } catch (err: any) {
                                    await updateDoc(doc(db, queueCollectionName, item.id), { status: 'generated' });
                                    addLog(`Manual upload failed for ${item.topic}: ${err.message}`, "error");
                                  }
                                }} 
                                className="h-8 bg-indigo-600 text-white"
                              >
                                {isUploading === item.generatedContent.slug ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <UploadCloud className="h-4 w-4 mr-1" />}
                                Upload
                              </Button>
                            </>
                          )}
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setDeleteConfirm(item.id)} 
                            className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {queue.filter(t => t.status !== 'completed').length === 0 && (
                    <div className="text-center py-10 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-sm">Queue is empty</div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Recently Completed
                  </h3>
                  {queue.filter(t => t.status === 'completed').length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={async () => {
                        const completed = queue.filter(t => t.status === 'completed');
                        toast.info(`Clearing ${completed.length} completed topics...`);
                        for (const item of completed) {
                          await deleteDoc(doc(db, queueCollectionName, item.id));
                        }
                        toast.success("Completed topics cleared");
                      }}
                      className="h-7 text-[10px] text-slate-400 hover:text-red-500"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
                <div className="space-y-3">
                  {queue
                    .filter(t => t.status === 'completed')
                    .sort((a, b) => (b.completedAt?.toMillis() || 0) - (a.completedAt?.toMillis() || 0))
                    .slice(0, 10)
                    .map((item) => (
                    <Card key={item.id} className="p-3 flex justify-between items-center bg-slate-50 border-slate-100 group">
                      <div className="flex flex-col">
                        <span className="text-sm text-slate-500 line-through">{item.topic}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{item.completedAt?.toDate().toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.generatedContent && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => setPreviewBlog(item.generatedContent)} 
                            className="h-7 w-7 text-blue-400 hover:text-blue-600 hover:bg-blue-50"
                            title="Preview Content"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setDeleteConfirm(item.id)} 
                          className="h-7 w-7 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        <AnimatePresence>
          {previewBlog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                  <h3 className="font-bold text-slate-900">Blog Preview</h3>
                  <Button variant="ghost" size="sm" onClick={() => setPreviewBlog(null)}>Close</Button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  <BlogCard blog={previewBlog} image={previewBlog.image} isUploading={isUploading !== null} onUpload={async () => {
                    await handleUpload(previewBlog, previewBlog.image);
                    setPreviewBlog(null);
                  }} />
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirm && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-6">
                <div className="space-y-2 text-center">
                  <div className="h-12 w-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Delete Topic?</h3>
                  <p className="text-slate-500 text-sm">Are you sure you want to remove this topic from the queue? This action cannot be undone.</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" onClick={() => deleteFromQueue(deleteConfirm)}>Delete</Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {view === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-8">
            <h2 className="text-2xl font-bold text-slate-800">Settings</h2>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>Manage your API keys and default link settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex justify-between">
                      <span>Additional Gemini API Keys</span>
                      <div className="flex items-center gap-2">
                        {settings.preferredApiKey && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => updateSettings({ preferredApiKey: null })}
                            className="h-5 text-[10px] text-indigo-600 hover:text-indigo-700 p-0"
                          >
                            Clear Preferred Key
                          </Button>
                        )}
                        <span className="text-[10px] text-slate-400">Rotation & Retry enabled</span>
                      </div>
                    </Label>
                    <div className="space-y-2">
                      {(settings.additionalApiKeys || []).map((key: string, i: number) => (
                        <div key={i} className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <Input 
                              type="password" 
                              value={key} 
                              onChange={(e) => {
                                const newKeys = [...settings.additionalApiKeys];
                                newKeys[i] = e.target.value;
                                updateSettings({ additionalApiKeys: newKeys });
                              }}
                              placeholder="Enter API Key"
                              className={`text-sm pr-20 ${settings.preferredApiKey === key && key ? 'border-indigo-500 ring-1 ring-indigo-500' : ''}`}
                            />
                            {key && (
                              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                {settings.preferredApiKey === key ? (
                                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Active</span>
                                ) : (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => updateSettings({ preferredApiKey: key })}
                                    className="h-6 text-[10px] text-slate-400 hover:text-indigo-600"
                                  >
                                    Use this
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => {
                            const newKeys = settings.additionalApiKeys.filter((_: any, idx: number) => idx !== i);
                            const updates: any = { additionalApiKeys: newKeys };
                            if (settings.preferredApiKey === key) updates.preferredApiKey = null;
                            updateSettings(updates);
                          }}>×</Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => {
                        const newKeys = [...(settings.additionalApiKeys || []), ""];
                        updateSettings({ additionalApiKeys: newKeys });
                      }} className="w-full text-xs">+ Add API Key</Button>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t border-slate-100">
                    <Label className="flex justify-between">
                      <span>OpenRouter API Key (Fallback)</span>
                      <span className="text-[10px] text-slate-400">Optional</span>
                    </Label>
                    <Input 
                      type="password" 
                      value={settings.openRouterKey || ""} 
                      onChange={(e) => updateSettings({ openRouterKey: e.target.value })}
                      placeholder="sk-or-v1-..."
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <Label className="flex justify-between items-center">
                      <span>Categorized Links (Bulk CSV/Excel)</span>
                      <div className="flex gap-2">
                        {settings.categorizedLinks?.length > 0 && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => updateSettings({ categorizedLinks: [] })}
                            className="h-7 text-[10px] text-red-500 hover:bg-red-50"
                          >
                            Clear All ({settings.categorizedLinks.length})
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-[10px] relative">
                          Upload File
                          <input 
                            type="file" 
                            accept=".csv, .xlsx, .xls" 
                            onChange={handleFileUpload} 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                          />
                        </Button>
                      </div>
                    </Label>
                    <div className="bg-slate-50 rounded-lg p-3 max-h-50 overflow-y-auto border border-slate-100">
                      {settings.categorizedLinks?.length > 0 ? (
                        <div className="space-y-2">
                          {Array.from(new Set(settings.categorizedLinks.map((l: any) => l.category))).map((cat: any) => (
                            <div key={cat} className="space-y-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{cat}</p>
                              <div className="flex flex-wrap gap-1">
                                {settings.categorizedLinks.filter((l: any) => l.category === cat).map((l: any, i: number) => (
                                  <div key={i} className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 truncate max-w-37.5">
                                    {l.url}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 text-center py-4 italic">No categorized links uploaded yet. Upload a CSV with 'url' and 'category' columns.</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Default Old Blog Links (Backlinks)</Label>
                    <Textarea 
                      placeholder="One URL per line"
                      value={settings.defaultOldLinks?.join('\n') || ""}
                      onChange={(e) => updateSettings({ defaultOldLinks: e.target.value.split('\n').filter(l => l.trim()) })}
                      className="h-24 text-sm font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Default Internal Links</Label>
                    <Textarea 
                      placeholder="One URL per line"
                      value={settings.defaultInternalLinks?.join('\n') || ""}
                      onChange={(e) => updateSettings({ defaultInternalLinks: e.target.value.split('\n').filter(l => l.trim()) })}
                      className="h-24 text-sm font-mono"
                    />
                  </div>
                  
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <Label className="text-indigo-600 font-bold flex items-center gap-2">
                      <UploadCloud className="h-4 w-4" /> Sanity CMS Configuration
                    </Label>
                    <p className="text-xs text-slate-500">
                      Sanity upload config is server-managed from <code>.env</code> and cannot be edited from this dashboard.
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-bold text-slate-700">Auto-Upload (This Instance)</Label>
                        <p className="text-[10px] text-slate-500">Enable or disable automatic Sanity uploads for this specific browser/hosting.</p>
                      </div>
                      <Button 
                        size="sm" 
                        variant={localAutoUploadEnabled ? "default" : "outline"}
                        onClick={() => setLocalAutoUploadEnabled(!localAutoUploadEnabled)}
                        className={`h-8 px-4 ${localAutoUploadEnabled ? 'bg-green-600 hover:bg-green-700' : ''}`}
                      >
                        {localAutoUploadEnabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>

                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={async () => {
                        try {
                          addLog("Testing API Key...", "info");
                          const blog = await generateBlog("Test Topic", [], [], settings.additionalApiKeys || [], settings.preferredApiKey, settings.openRouterKey);
                          addLog("API Key is working! Test generation successful.", "success");
                          toast.success("API Key is working!");
                        } catch (err: any) {
                          addLog(`API Key Test Failed: ${err.message}`, "error");
                          toast.error("API Key Test Failed");
                        }
                      }}
                      className="w-full"
                    >
                      Test Gemini API Keys
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <Button variant={active ? 'secondary' : 'ghost'} size="sm" onClick={onClick} className={active ? 'bg-white shadow-sm' : ''}>
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

function BlogCard({ blog, image, isUploading, onUpload }: { blog: any, image: string, isUploading: boolean, onUpload: () => void }) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-md">
      <div className="relative bg-slate-100">
        <img src={image} alt={blog.title} className="w-full h-auto object-cover block" />
        <div className="absolute top-4 right-4">
          <Button 
            onClick={onUpload} 
            disabled={isUploading}
            className="bg-white/90 backdrop-blur-sm text-slate-900"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Upload to Sanity
          </Button>
        </div>
      </div>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-2xl font-bold">{blog.title}</CardTitle>
            <p className="text-xs font-mono text-slate-400 mt-1">Slug: {blog.slug}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-500">Author</p>
              <p className="text-sm font-bold text-indigo-600">{blog.author}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Category</p>
              <p className="text-[10px] px-2 py-0.5 bg-slate-100 rounded-full font-medium text-slate-600">{blog.category}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {blog.tags?.map((tag: string, i: number) => (
            <span key={i} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md font-medium">#{tag}</span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Excerpt</p>
            <p className="text-sm text-slate-600 italic">"{blog.excerpt}"</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SEO Title</p>
              <p className="text-xs text-slate-700 font-medium">{blog.seoTitle}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SEO Description</p>
              <p className="text-xs text-slate-700">{blog.seoDescription}</p>
            </div>
          </div>
        </div>
        <div className="prose prose-slate max-w-none text-slate-600 max-h-125 overflow-y-auto custom-scrollbar pr-4 prose-p:my-8 prose-headings:mt-12 prose-headings:mb-6 prose-h2:text-3xl prose-h3:text-2xl prose-strong:text-slate-900">
          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{blog.content}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
