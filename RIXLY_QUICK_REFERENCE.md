# Rixly → CMS Integration: Quick Reference

## 🎯 What is Rixly?
A modern React + AI-powered blog automation platform that:
- **Generates AI content** using Google Gemini
- **Auto-publishes** to Sanity CMS via scheduled tasks
- **Creates SEO-optimized blogs** with custom metadata
- **Provides a clean dashboard** for content management
- **Integrates Firebase** for real-time data storage

## 🔄 Current Setup
- **CMS:** Strapi 5.41.1 (older admin UI, PostgreSQL backend)
- **Tech Stack:** Node.js + React 18 + Styled Components
- **Status:** Functional but outdated frontend

## 📁 Verified Folder Structure

### RIXLY-CMS
```text
RIXLY-CMS/
├── .env.example
├── package.json
├── server.ts
├── vite.config.ts
└── src/
  ├── App.tsx
  ├── main.tsx
  ├── index.css
  ├── components/
  │   └── BlogDashboard.tsx
  └── lib/
    ├── firebase.ts
    └── gemini.ts
```

### SANITY-CMS
```text
SANITY-CMS/
└── cati-ai-cms/
  ├── package.json
  ├── sanity.config.js
  ├── sanity.cli.js
  └── schemaTypes/
    ├── index.js
    ├── post.js
    ├── author.js
    ├── category.js
    └── blockContent.js
```

## 💡 Why Replace with Rixly?
| Aspect | Strapi CMS | Rixly |
|--------|-----------|-------|
| **React Version** | 18 (older) | 19 (latest) |
| **UI Framework** | Strapi Admin (proprietary) | React + Tailwind (modern) |
| **AI Capabilities** | None | Gemini AI built-in |
| **Build Tool** | Webpack (slower) | Vite (faster) |
| **Admin UX** | Complex | Clean dashboard |
| **Dev Experience** | Slower HMR | Instant HMR with Vite |

## 🛠️ Integration Approach

### Option A: **Complete Replacement** (Recommended)
- Remove Strapi entirely
- Use Rixly as new admin dashboard
- Keep PostgreSQL as backend database
- Connect Rixly → PostgreSQL → Sanity publishing

### Option B: **Hybrid** (Lower Risk)
- Keep Strapi API running
- Use Rixly as frontend overlay
- Bridge Rixly ↔ Strapi API calls
- Allows rollback if needed

## 📦 What Needs to Change

### In Rixly Code:
1. **`server.ts`** - Connect to PostgreSQL instead of Firebase
2. **`.env`** - Configuration for your databases
3. **`BlogDashboard.tsx`** - Add voice agent fields
4. **`package.json`** - Remove Firebase, add PostgreSQL (pg)

### In Your Infrastructure:
1. Export Strapi content → Sanity CMS
2. Set up PostgreSQL connection string
3. Create Sanity API token
4. Get Google Gemini API key
5. Create `.env` file with credentials

## 🚀 Quick Start (Option A)

### Step 1: Backup & Prep
```bash
# Backup current Strapi
cd CMS
npm run build
# Export all data using Strapi UI

# Clone Rixly
cd ..
cp -r RIXLY-CMS/. ./CMS-RIXLY/
```

### Step 2: Install Dependencies
```bash
cd CMS-RIXLY
npm install  # Adds pg driver for PostgreSQL
```

### Step 3: Create `.env`
```env
# Your existing PostgreSQL from Strapi
DATABASE_URL=postgresql://user:pass@localhost/cms_db

# Sanity settings
SANITY_PROJECT_ID=your_id
SANITY_DATASET=production
SANITY_API_TOKEN=your_token

# AI
GEMINI_API_KEY=your_key

# Voice Agent
VOICE_AGENT_API_URL=http://localhost:5001

# App
APP_PASSWORD=newpassword
```

### Step 4: Update Backend
Replace Firebase initialization in `server.ts` with PostgreSQL pool:
```typescript
import { Pool } from 'pg';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Now use: db.query(sql, [params])
```

### Step 5: Run
```bash
npm run dev   # Development
npm run build # Production build
npm start     # Production server
```

## 📊 Data Migration Checklist

- [ ] Export Strapi collections (JSON)
- [ ] Create Sanity CMS project
- [ ] Map Strapi schema → Sanity schema
- [ ] Import historical blog posts to Sanity
- [ ] Test Sanity API token permissions
- [ ] Verify all content published correctly
- [ ] Set up automated backups

## 🔗 Voice Agent Integration

After replacing CMS, hook up your voice agent:

```typescript
// In server.ts - Add new endpoint
app.post("/api/voice-agent/create-content", async (req, res) => {
  const { callTranscript, agentId } = req.body;
  
  // Generate blog from transcript using Gemini
  const blog = await generateBlogContent(callTranscript);
  
  // Publish to Sanity
  const published = await sanityClient.create({
    _type: 'blog',
    title: blog.title,
    content: blog.content,
    relatedAgentId: agentId,
    sourceTranscript: callTranscript
  });
  
  res.json({ success: true, blogId: published._id });
});
```

## ⚠️ Critical Points

1. **Password:** Rixly has hardcoded password in App.tsx - change it!
2. **Sanity Schema:** Must match your blog structure
3. **API Tokens:** Keep `.env` secure, never commit
4. **Database Migration:** Test thoroughly before going live
5. **Voice Agent APIs:** Update endpoints to point to new CMS

## 📚 Files to Review

1. `RIXLY-CMS/server.ts` - Backend architecture
2. `RIXLY-CMS/src/App.tsx` - Authentication logic
3. `RIXLY-CMS/src/components/BlogDashboard.tsx` - Main UI
4. `CMS/package.json` - Current dependencies
5. `CMS/src/api/` - Current API structure

## ⏱️ Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| 1. Prep & Backup | 2-3 days | Export data, setup Sanity |
| 2. Integration | 3-4 days | Modify Rixly code, database config |
| 3. Testing | 2-3 days | Migration tests, API validation |
| 4. Deployment | 1-2 days | Go live, monitor, rollback ready |

## ✅ Success Checklist

- [ ] Rixly dashboard loads without Firebase errors
- [ ] PostgreSQL connection works
- [ ] Sanity publishing pipeline functional
- [ ] All blogs migrated and visible
- [ ] AI content generation working
- [ ] Voice agent API integration complete
- [ ] Performance: < 500ms API response time
- [ ] Admin auth working correctly

---

**Next Action:** Review `RIXLY_CMS_INTEGRATION_ANALYSIS.md` for detailed implementation plan
