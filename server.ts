import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@sanity/client";
import dotenv from "dotenv";
import axios from "axios";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const firebaseConfig = require("./firebase-applet-config.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "..", "SANITY-CMS", "cati-ai-cms", ".env"),
  path.resolve(__dirname, "..", "sanity-cms", "cati-ai-cms", ".env"),
  path.resolve(process.cwd(), "..", "SANITY-CMS", "cati-ai-cms", ".env"),
  path.resolve(process.cwd(), "..", "sanity-cms", "cati-ai-cms", ".env"),
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
  console.log(`[startup] Loaded env from: ${envPath}`);
} else {
  dotenv.config();
  console.log("[startup] No external .env found in known paths, using default dotenv lookup");
}

function maskSecret(value?: string) {
  if (!value) return "(missing)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function createPortableTextBlock(text: string, style: "normal" | "h1" | "h2" | "h3" = "normal") {
  return {
    _type: "block",
    _key: Math.random().toString(36).slice(2, 11),
    style,
    markDefs: [],
    children: [
      {
        _type: "span",
        _key: Math.random().toString(36).slice(2, 11),
        text,
        marks: [],
      },
    ],
  };
}

function toPortableText(content: unknown) {
  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === "string") {
    // Convert incoming HTML/markdown-ish content into Sanity Portable Text blocks.
    const normalized = decodeHtmlEntities(
      content
        .replace(/\r\n/g, "\n")
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\s*\/p\s*>/gi, "\n\n")
        .replace(/<\s*p[^>]*>/gi, "")
        .replace(/<\s*h1[^>]*>/gi, "\n\n# ")
        .replace(/<\s*\/h1\s*>/gi, "\n\n")
        .replace(/<\s*h2[^>]*>/gi, "\n\n## ")
        .replace(/<\s*\/h2\s*>/gi, "\n\n")
        .replace(/<\s*h3[^>]*>/gi, "\n\n### ")
        .replace(/<\s*\/h3\s*>/gi, "\n\n")
        .replace(/<[^>]*>/g, "")
    );

    const paragraphs = normalized
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const blocks = paragraphs.map((paragraph) => {
      if (paragraph.startsWith("### ")) {
        return createPortableTextBlock(paragraph.replace(/^###\s+/, ""), "h3");
      }
      if (paragraph.startsWith("## ")) {
        return createPortableTextBlock(paragraph.replace(/^##\s+/, ""), "h2");
      }
      if (paragraph.startsWith("# ")) {
        return createPortableTextBlock(paragraph.replace(/^#\s+/, ""), "h1");
      }
      return createPortableTextBlock(paragraph, "normal");
    });

    if (blocks.length > 0) {
      return blocks;
    }
  }

  return [createPortableTextBlock("No content", "normal")];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

let db: any;
try {
  // Try named database first
  db = getFirestore(firebaseConfig.firestoreDatabaseId);
  console.log(`Using named database: ${firebaseConfig.firestoreDatabaseId}`);
} catch (e) {
  console.log("Failed to initialize named database, falling back to default...");
  db = getFirestore();
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (err.message.includes('EADDRINUSE')) {
    console.error('Port 3000 is already in use. The previous process might still be running.');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "*";

  console.log("[startup] dotenv loaded and Sanity env check:", {
    SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID || "(missing)",
    SANITY_DATASET: process.env.SANITY_DATASET || "(missing)",
    SANITY_API_TOKEN: maskSecret(process.env.SANITY_API_TOKEN),
  });

  // Request Logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // CORS for frontend -> backend API calls in Railway production.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", allowedOrigin);
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/sanity-config", (req, res) => {
    res.json({
      success: true,
      sanity: {
        projectId: process.env.SANITY_PROJECT_ID || "",
        dataset: process.env.SANITY_DATASET || "production",
        tokenConfigured: Boolean(process.env.SANITY_API_TOKEN),
      },
    });
  });

  app.get("/api/blog-posts", async (req, res) => {
    try {
      const projectId = process.env.SANITY_PROJECT_ID;
      const dataset = process.env.SANITY_DATASET || "production";

      if (!projectId) {
        return res.status(500).json({ success: false, error: "Sanity Project ID not configured" });
      }

      const publicClient = createClient({
        projectId,
        dataset,
        useCdn: true,
        apiVersion: "2023-05-03",
      });

      const posts = await publicClient.fetch(`*[_type == "post" && defined(slug.current)] | order(coalesce(publishedAt, _createdAt) desc) {
        _id,
        title,
        "slug": slug.current,
        excerpt,
        seoTitle,
        seoDescription,
        tags,
        publishedAt,
        _createdAt,
        "imageUrl": coalesce(mainImage.asset->url, featuredImage.asset->url, ogImage.asset->url, ""),
        "imageAlt": coalesce(mainImage.alt, featuredImage.alt, ogImage.alt, title),
        body[]{
          ...,
          _type == "image" => {
            ...,
            "url": asset->url
          }
        },
        author->{name},
        categories[]->{title}
      }`);

      res.json({ success: true, posts });
    } catch (error: any) {
      console.error("[blog-posts] Failed to fetch blog posts:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog-posts/:slug", async (req, res) => {
    try {
      const projectId = process.env.SANITY_PROJECT_ID;
      const dataset = process.env.SANITY_DATASET || "production";
      const { slug } = req.params;

      if (!projectId) {
        return res.status(500).json({ success: false, error: "Sanity Project ID not configured" });
      }

      const publicClient = createClient({
        projectId,
        dataset,
        useCdn: true,
        apiVersion: "2023-05-03",
      });

      const post = await publicClient.fetch(`*[_type == "post" && slug.current == $slug][0] {
        _id,
        title,
        "slug": slug.current,
        excerpt,
        seoTitle,
        seoDescription,
        tags,
        publishedAt,
        _createdAt,
        "imageUrl": coalesce(mainImage.asset->url, featuredImage.asset->url, ogImage.asset->url, ""),
        "imageAlt": coalesce(mainImage.alt, featuredImage.alt, ogImage.alt, title),
        body[]{
          ...,
          _type == "image" => {
            ...,
            "url": asset->url
          }
        },
        author->{name},
        categories[]->{title}
      }`, { slug });

      if (!post) {
        return res.status(404).json({ success: false, error: "Blog post not found" });
      }

      res.json({ success: true, post });
    } catch (error: any) {
      console.error("[blog-post] Failed to fetch blog post:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to fetch blog post" });
    }
  });

  // API Routes
  app.post("/api/upload-blog", async (req, res) => {
    try {
      const { 
        title, slug, content, imageBase64, author, category, 
        excerpt, seoTitle, seoDescription, tags, altText,
        sanityConfig 
      } = req.body;

      // Always prefer server env to avoid accidental project overrides from UI settings.
      const projectId = process.env.SANITY_PROJECT_ID || sanityConfig?.projectId;
      const dataset = process.env.SANITY_DATASET || sanityConfig?.dataset || "production";
      const token = process.env.SANITY_API_TOKEN || sanityConfig?.token;

      if (sanityConfig?.projectId && process.env.SANITY_PROJECT_ID && sanityConfig.projectId !== process.env.SANITY_PROJECT_ID) {
        console.warn(`[upload-blog] Ignoring UI projectId override (${sanityConfig.projectId}); using env projectId (${process.env.SANITY_PROJECT_ID})`);
      }

      if (!token) {
        return res.status(500).json({ error: "Sanity API Token not configured. Please add it in Settings." });
      }
      if (!projectId) {
        return res.status(500).json({ error: "Sanity Project ID not configured. Please add it in Settings." });
      }

      const dynamicClient = createClient({
        projectId,
        dataset,
        token,
        useCdn: false,
        apiVersion: "2023-05-03",
      });

      console.log(`Attempting Sanity upload for project: ${projectId}, dataset: ${dataset}`);
      console.log("[upload-blog] Incoming payload summary:", {
        title,
        slug,
        hasContent: Boolean(content),
        hasImage: Boolean(imageBase64),
        author,
        category,
      });

      if (!title || !slug || !content) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: title, slug, and content are required",
        });
      }

      const authorName = (author || "Rixly").toString().trim() || "Rixly";
      let authorRef: string | null = null;
      try {
        const existingAuthor = await dynamicClient.fetch(
          `*[_type == "author" && lower(name) == lower($name)][0]{_id}`,
          { name: authorName }
        );
        if (existingAuthor?._id) {
          authorRef = existingAuthor._id;
        } else {
          const createdAuthor = await dynamicClient.create({
            _type: "author",
            name: authorName,
            slug: { _type: "slug", current: slugify(authorName) || "author" },
          });
          authorRef = createdAuthor?._id || null;
          console.log(`[upload-blog] Created author document: ${authorRef}`);
        }
      } catch (authorErr: any) {
        console.warn("[upload-blog] Unable to resolve/create author reference, continuing without author ref:", authorErr.message);
      }

      const categoryTitle = (category || "").toString().trim();
      let categoryRef: string | null = null;
      if (categoryTitle) {
        try {
          const existingCategory = await dynamicClient.fetch(
            `*[_type == "category" && lower(title) == lower($title)][0]{_id}`,
            { title: categoryTitle }
          );
          if (existingCategory?._id) {
            categoryRef = existingCategory._id;
          } else {
            const createdCategory = await dynamicClient.create({
              _type: "category",
              title: categoryTitle,
              description: `Auto-created by Rixly for ${categoryTitle}`,
            });
            categoryRef = createdCategory?._id || null;
            console.log(`[upload-blog] Created category document: ${categoryRef}`);
          }
        } catch (categoryErr: any) {
          console.warn("[upload-blog] Unable to resolve/create category reference, continuing without category refs:", categoryErr.message);
        }
      }

      let mainImage = null;

      if (imageBase64) {
        try {
          let buffer: Buffer;
          if (imageBase64.startsWith("data:")) {
            buffer = Buffer.from(imageBase64.split(",")[1], "base64");
          } else {
            // It's a URL (like Picsum fallback)
            const imageResponse = await axios.get(imageBase64, { 
              responseType: 'arraybuffer',
              timeout: 10000 
            });
            buffer = Buffer.from(imageResponse.data);
          }

          const asset = await dynamicClient.assets.upload("image", buffer, {
            filename: `${slug}.png`,
          });
          mainImage = {
            _type: "image",
            asset: {
              _type: "reference",
              _ref: asset._id,
            },
            alt: altText || title
          };
          console.log("Image uploaded successfully to Sanity");
        } catch (imgErr: any) {
          console.error("Image upload to Sanity failed, continuing without image:", imgErr.message);
        }
      }

      const doc = {
        _type: "post",
        title,
        slug: { _type: "slug", current: slug },
        excerpt,
        seoTitle,
        seoDescription,
        tags: tags || [],
        ...(authorRef
          ? {
              author: {
                _type: "reference",
                _ref: authorRef,
              },
            }
          : {}),
        // Support both singular and plural category fields
        category: categoryRef
          ? {
              _type: "reference",
              _ref: categoryRef,
            }
          : undefined,
        categories: categoryRef ? [{
          _type: "reference",
          _ref: categoryRef,
          _key: Math.random().toString(36).substring(2, 11)
        }] : [],
        body: toPortableText(content),
        mainImage,
        featuredImage: mainImage,
        ogImage: mainImage,
        publishedAt: new Date().toISOString(),
      };

      console.log("[upload-blog] Sending document to Sanity:", {
        _type: doc._type,
        title: doc.title,
        slug: doc.slug?.current,
        bodyBlocks: Array.isArray(doc.body) ? doc.body.length : 0,
        hasMainImage: Boolean(doc.mainImage),
      });

      const result = await dynamicClient.create(doc);
      console.log("[upload-blog] Sanity create success:", {
        documentId: result?._id,
        rev: result?._rev,
        type: result?._type,
      });

      res.json({
        success: true,
        documentId: result?._id,
        documentType: result?._type,
        result,
      });
    } catch (error: any) {
      console.error("[upload-blog] Sanity Upload Error Details:", {
        message: error.message,
        stack: error.stack,
        statusCode: error.statusCode,
        details: error.details,
        response: error.response?.data,
        raw: error,
      });
      res.status(500).json({ 
        success: false,
        error: error.message || "Unknown server error",
        details: "If you see 'Request error', check if your Sanity Project ID is correct and your API token has 'Editor' permissions."
      });
    }
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      success: false
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer();
