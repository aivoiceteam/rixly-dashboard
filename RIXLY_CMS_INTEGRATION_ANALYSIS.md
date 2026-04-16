# Rixly Blog Auto → Current CMS Integration Analysis

**Date:** April 16, 2026  
**Purpose:** Analyze Rixly system and plan replacement/integration into current CMS

---

## 📊 System Comparison

### Current CMS (Strapi-based)
- **Type:** Headless CMS (API-first)
- **Backend:** Node.js + Strapi 5.41.1
- **Database:** PostgreSQL (pg 8.20.0)
- **Admin Panel:** React 18 + Strapi Admin UI
- **Features:** User management, content collections, plugin architecture
- **Location:** `/CMS`

### Rixly Blog Auto (AI Studio App)
- **Type:** React Frontend + AI-powered Content Generation App
- **Backend:** Express.js + Vite dev server
- **Frontend:** React 19 + Tailwind CSS
- **Database:** Firebase Firestore (real-time)
- **Content Hub:** Sanity CMS (external via API)
- **AI Provider:** Google Gemini API
- **Features:** AI-generated blog content, SEO optimization, custom charts, auto-publishing
- **Location:** `/Rixly_blog_auto-main`

---

## 🏗️ Key Technology Stack Differences

| Component | Current CMS (Strapi) | Rixly | Recommendation |
|-----------|----------------------|-------|-----------------|
| **Database** | PostgreSQL | Firebase Firestore + Sanity | Keep PostgreSQL; can bridge to Firebase |
| **Admin UI** | Strapi Admin | React Dashboard | Migrate to React-based UI |
| **Content Storage** | Strapi collections | Sanity CMS | Keep Strapi; integrate Sanity adapter |
| **AI Capabilities** | None | Google Gemini | Add to Rixly → Strapi pipeline |
| **Frontend Framework** | N/A | React 19 + Vite | Maintain React stack |
| **Authentication** | Strapi Users & Permissions | Firebase Auth | Integrate Firebase auth |

---

## 📁 Verified Folder Structures

### RIXLY-CMS

```text
RIXLY-CMS/
├── .env.example
├── package.json
├── server.ts
├── vite.config.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   └── BlogDashboard.tsx
│   └── lib/
│       ├── firebase.ts
│       └── gemini.ts
└── lib/
```

### SANITY-CMS

```text
SANITY-CMS/
└── cati-ai-cms/
  ├── package.json
  ├── sanity.config.js
  ├── sanity.cli.js
  ├── schemaTypes/
  │   ├── index.js
  │   ├── post.js
  │   ├── author.js
  │   ├── category.js
  │   └── blockContent.js
  └── static/
```

---

## 📁 Rixly Architecture Breakdown

### Core Components

```text
RIXLY-CMS/
├── server.ts              ← Express backend with Sanity/Firebase integration
├── src/
│   ├── App.tsx            ← Main React app (password-protected)
│   ├── components/
│   │   └── BlogDashboard.tsx  ← Core AI-powered blog editor
│   ├── lib/               ← Utility functions
│   └── main.tsx
├── package.json           ← React 19 + Gemini AI + Firebase + Sanity
├── vite.config.ts         ← Dev server config
├── firebase-applet-config.json  ← Firebase setup
└── .env.example           ← Environment variables
```

### Key Features in Rixly
1. **AI Content Generation** - Google Gemini API for blog creation
2. **Auto-publishing** - node-cron for scheduled posts
3. **Sanity Integration** - Direct CMS API uploads with SEO metadata
4. **Firebase Backend** - Real-time data storage
5. **Dashboard UI** - Password-protected blog management interface

---

## 🔄 Integration Strategy: Replace Strapi CMS with Rixly

### **Option 1: Full Replacement (Recommended)**
Replace current Strapi CMS entirely with Rixly + Strapi backend layer

**Advantages:**
- Modern React 19 frontend
- AI-powered content generation (Gemini)
- Real-time Firebase integration
- Healthier tech stack (Vite vs old Strapi Admin)

**Steps:**
1. Migrate Strapi database collections to Sanity CMS
2. Update Rixly `server.ts` to use PostgreSQL instead of Firebase Firestore
3. Integrate current voice agent API endpoints
4. Add voice agent-specific fields to blog schema
5. Replace Strapi admin panel with Rixly dashboard

---

### **Option 2: Hybrid Approach**
Keep Strapi as backend API, use Rixly as frontend admin interface

**Advantages:**
- Minimal disruption to existing setup
- Leverage both Strapi stability + Rixly UI/AI
- Gradual migration path

**Steps:**
1. Create API bridge: Rixly ↔ Strapi
2. Update Rixly `server.ts` to call Strapi APIs instead of Sanity
3. Add Gemini AI content generation to Strapi plugin
4. Update authentication to use Strapi users

---

## 🛠️ Migration Steps (Option 1 - Full Replacement)

### Phase 1: Data Migration
```bash
# Export current Strapi content
# Import into Sanity CMS
# Configure Sanity schema to match current blog structure
```

### Phase 2: Backend Updates
1. **Update `server.ts`:**
   - Replace Firebase Firestore with PostgreSQL connection
   - Keep Sanity Client for content publishing
   - Add voice agent API hooks

2. **Environment Setup:**
   ```env
   # Keep these
   GEMINI_API_KEY=<your_key>
   SANITY_PROJECT_ID=<from_current_cms>
   SANITY_API_TOKEN=<token>
   
   # Add these
   DATABASE_URL=postgresql://user:pass@localhost/cms
   VOICE_AGENT_API_URL=<your_voice_agent_endpoint>
   ```

### Phase 3: Frontend Customization
1. Update `BlogDashboard.tsx` to include:
   - Voice agent integration fields
   - Call transcription links
   - Agent-specific metadata

2. Extend blog schema with:
   - `agentId` - Link to voice agent
   - `callTranscripts` - Related conversation logs
   - `voiceMetadata` - Agent-specific settings

### Phase 4: Testing & Deployment
```bash
cd RIXLY-CMS
npm install
npm run build
npm run start  # Uses express server.ts
```

---

## 📋 Detailed File-by-File Integration Plan

### Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `server.ts` | **Modify** | Connect to PostgreSQL instead of Firebase |
| `src/App.tsx` | **Modify** | Add voice agent auth/integration |
| `src/components/BlogDashboard.tsx` | **Extend** | Add voice agent specific fields |
| `.env` | **Create** | Configure PostgreSQL + APIs |
| `src/lib/dbClient.ts` | **Create** | PostgreSQL connection pool |
| `src/lib/voiceAgentIntegration.ts` | **Create** | Voice agent API client |
| `package.json` | **Modify** | Add PostgreSQL driver (pg), remove Firebase admin |

---

## 🔌 Voice Agent Integration Points

### 1. Blog → Agent Linking
```typescript
// In BlogDashboard when creating blog post:
const publishBlog = async (blogData) => {
  // Publish to Sanity
  await sanityClient.create({
    _type: 'blog',
    title: blogData.title,
    content: blogData.content,
    agentId: selectedAgent.id,  // Link to voice agent
    voiceMetadata: {
      callScript: blogData.content,  // Use blog as call script
      topicKeywords: extractKeywords(blogData.content)
    }
  });
};
```

### 2. Call Transcripts → Blog Posts
```typescript
// Parse incoming call transcripts and suggest blog topics
const generateBlogFromTranscript = async (transcript) => {
  const suggestion = await gemini.generateContent(
    `Create blog post outline from this call transcript: ${transcript}`
  );
  return suggestion;
};
```

### 3. Agent Settings in Blog CMS
- Map agent configurations to blog metadata
- Store call scripts as blog content drafts
- Link agent performance metrics to content topics

---

## ⚙️ Environment Configuration

### Required `.env` for Rixly CMS
```env
# PostgreSQL (Current CMS Database)
DATABASE_URL=postgresql://user:password@localhost:5432/cms_db
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cms_db
DB_USER=postgres
DB_PASSWORD=your_password

# Sanity (Content Publishing)
SANITY_PROJECT_ID=your_sanity_project_id
SANITY_DATASET=production
SANITY_API_TOKEN=your_sanity_token

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Voice Agent Integration
VOICE_AGENT_API_URL=http://localhost:5001
VOICE_AGENT_API_KEY=your_agent_api_key

# App Settings
APP_PASSWORD=secure_password_here
PORT=3000
NODE_ENV=production
```

---

## 🚀 Implementation Roadmap

### Week 1: Setup & Migration
- [ ] Export Strapi content to structured format
- [ ] Set up Sanity CMS schema matching current structure
- [ ] Clone Rixly into integration branch
- [ ] Create PostgreSQL database connection module

### Week 2: Backend Integration
- [ ] Replace Firebase with PostgreSQL in `server.ts`
- [ ] Test Sanity publishing pipeline
- [ ] Add voice agent API endpoints
- [ ] Set up authentication middleware

### Week 3: Frontend Customization
- [ ] Extend BlogDashboard with agent fields
- [ ] Add call transcript viewer
- [ ] Create agent-specific content templates
- [ ] Add real-time sync with voice agent status

### Week 4: Testing & Deployment
- [ ] Unit tests for API endpoints
- [ ] Integration tests with current voice agent
- [ ] User acceptance testing
- [ ] Deploy to production
- [ ] Archive old Strapi CMS

---

## ⚠️ Migration Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Data Loss** | High | Export Strapi as backup; test import thoroughly |
| **API Downtime** | High | Run parallel systems; gradual traffic shift |
| **Authentication Breaks** | High | Map Strapi users → Firebase/custom auth early |
| **Sanity API Limits** | Medium | Set up caching; rate limiting; monitor usage |
| **Gemini API Costs** | Medium | Add usage quotas; cost alerts; fallback to templates |

---

## 📚 Key Files Reference

### Rixly Server Logic
- **File:** `server.ts`
- **Key Routes:**
  - `POST /api/upload-blog` - Publish to Sanity
  - `POST /api/login` - Authentication
  - `GET /api/health` - Health check

### Current CMS Structure
- **Type:** Strapi 5.41.1
- **Database:** PostgreSQL
- **Admin:** `/CMS/src/admin/`
- **API:** `/CMS/src/api/`

### Integration Points
- Rixly frontend (React 19) → PostgreSQL backend
- AI generation (Gemini) → Rixly dashboard
- Content publishing → Sanity CMS
- Voice agent APIs → New Rixly endpoints

---

## ✅ Success Criteria

1. ✓ All blog content migrated from Strapi to Sanity
2. ✓ Rixly dashboard fully functional with PostgreSQL backend
3. ✓ Voice agent integration working (read/write call data)
4. ✓ AI content generation producing valid blogs
5. ✓ Zero data loss during migration
6. ✓ Performance: API response time < 500ms
7. ✓ Admin dashboard loads in < 3 seconds

---

## 🔗 Next Steps

1. **Backup Current CMS** - Export all Strapi data
2. **Set Up Sanity Project** - Create new Sanity workspace
3. **Review Rixly Code** - Understand AI/publishing pipeline
4. **Create Integration Branch** - Start development isolation
5. **Build PostgreSQL Connector** - Bridge Rixly ↔ Current DB
6. **Test Voice Agent Integration** - Ensure API compatibility

---

**Document Version:** 1.0  
**Last Updated:** April 16, 2026  
**Status:** Ready for Implementation
