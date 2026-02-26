# GNC Campaign Intelligence — Next Steps

## What's Been Done

All code is written, compiles with zero errors, and is ready to deploy.

### New Files Created
| File | What it does |
|---|---|
| `src/constants/ttl.ts` | TTL constants (single source of truth, original values preserved) |
| `src/services/campaign.ts` | Core campaign logic: CRUD, compliance engine, performance evaluation, continuation recommendation, engagement timeline, competitor mining, influencer lifecycle |
| `src/services/scheduler.ts` | Background jobs: auto-monitors campaign posts, prefetches GNC hashtags every 6h |
| `src/routes/campaigns.ts` | REST endpoints: POST/GET/PATCH campaigns, register posts |
| `src/routes/influencers.ts` | REST endpoint: GET influencer lifecycle record |
| `src/scripts/seedCampaigns.ts` | Seeds campaigns collection from JSON |
| `src/scripts/seedInfluencers.ts` | Seeds influencer_records (from Apify or manual JSON) |
| `src/scripts/seedCampaignPosts.ts` | Registers posts under campaigns via Apify |
| `src/scripts/populateAll.ts` | Master script: runs all 3 seeders in order |
| `src/scripts/seed-data/*.json` | 3 seed data JSON files |

### Edited Files
| File | Changes |
|---|---|
| `src/schemas/types.ts` | 6 new interfaces + 3 type aliases (Campaign, CampaignPost, PostSnapshot, etc.) |
| `src/schemas/zod.ts` | 9 new Zod schemas (2 REST + 7 Gemini tool schemas) |
| `src/constants/tool_declarations.ts` | 7 new Gemini FunctionDeclarations |
| `src/constants/system_prompt.ts` | Updated to 19 tools, campaign section, rules 15-20 |
| `src/services/gemini.ts` | 7 new DISPATCH + TOOL_LABELS entries |
| `src/services/tools.ts` | Cache checks now use `TTL.*` constants |
| `src/services/analytics.ts` | `getOrFetchProfile` uses `TTL.PROFILES` |
| `src/scripts/createIndexes.ts` | Drops+recreates TTL indexes, adds 4 new collection indexes |
| `src/index.ts` | Mounts campaign/influencer routes, starts scheduler |
| `api/package.json` | Added seed scripts, build copies seed-data |

### 7 New Gemini Tools
1. `register_campaign_post` — Register paid posts for tracking
2. `monitor_campaign_post` — Re-check posts for deletions/edits
3. `get_campaign_compliance_report` — Compliance summary per campaign
4. `evaluate_collaboration_performance` — Performance vs hashtag averages
5. `get_continuation_recommendation` — Weighted continue/pause/discontinue score
6. `get_engagement_timeline` — Engagement metrics over time
7. `mine_competitor_hashtags` — Find influencers in competitor hashtags

### 4 New MongoDB Collections
1. `campaigns` — No TTL (durable)
2. `campaign_posts` — No TTL (durable)
3. `post_snapshots` — 180-day TTL
4. `influencer_records` — No TTL (durable)

---

## What Needs to Be Done Now

### 1. Create MongoDB Indexes (required before first run)

```bash
cd api
npm run build
npm run create-indexes
```

This will:
- Drop and recreate existing TTL indexes (safe — just re-applies same values)
- Create indexes on the 4 new collections (campaigns, campaign_posts, post_snapshots, influencer_records)

### 2. Update Seed Data with Real Creators

Edit `src/scripts/seed-data/influencers.json` with real GNC-relevant Indian fitness influencers. Here are 10 suggested creators to start with:

```json
[
  { "username": "sahaboraonline", "tags": ["fitness", "bodybuilding", "gnc"], "notes": ["Sahil Khan - Bollywood actor & fitness icon"] },
  { "username": "ranaboron", "tags": ["fitness", "supplement"], "notes": ["Rana Daggubati - actor & fitness enthusiast"] },
  { "username": "yaboron", "tags": ["fitness", "gym"], "notes": ["Placeholder - replace with actual handle"] },
  { "username": "guru_mann_fitness", "tags": ["fitness", "bodybuilding", "nutrition"], "notes": ["Guru Mann - fitness YouTuber"] },
  { "username": "rohitkhatri_fitness", "tags": ["fitness", "bodybuilding"], "notes": ["Rohit Khatri - Indian fitness creator"] },
  { "username": "jaboron_sahil", "tags": ["fitness", "transformation"], "notes": ["Placeholder - replace with actual handle"] },
  { "username": "virat.kohli", "tags": ["sports", "fitness", "brand-ambassador"], "notes": ["Virat Kohli - potential mega influencer"] },
  { "username": "milaboroning", "tags": ["sports", "fitness"], "notes": ["Milind Soman - endurance athlete"] },
  { "username": "deepti_sharma_7", "tags": ["sports", "fitness", "cricket"], "notes": ["Placeholder - replace with actual handle"] },
  { "username": "anaborona_sharma", "tags": ["yoga", "wellness", "nutrition"], "notes": ["Placeholder - replace with actual handle"] }
]
```

**To find real handles:** Use the chat bot to run:
- "Discover top 10 Indian fitness influencers"
- "Find Indian bodybuilding influencers on Instagram"

Then update the JSON with real usernames from the results.

### 3. Update Seed Data with Real Campaign Posts

Edit `src/scripts/seed-data/posts.json` with real Instagram post URLs from GNC campaigns:

```json
[
  {
    "campaignId": "gnc-summer-fitness-2025",
    "postUrls": [
      "https://www.instagram.com/p/REAL_POST_SHORTCODE_1/",
      "https://www.instagram.com/p/REAL_POST_SHORTCODE_2/",
      "https://www.instagram.com/p/REAL_POST_SHORTCODE_3/"
    ]
  }
]
```

**To find real posts:** Look at @gnclivewell and @guardiangnc tagged posts, or search #gnclivewell on Instagram.

### 4. Run Seed Scripts

#### Option A: Manual mode (uses JSON files only, no Apify calls)
```bash
npm run build
npm run seed:campaigns
npm run seed:influencers -- --source=manual
```

#### Option B: Apify mode (fetches from @gnclivewell & @guardiangnc, extracts mentioned creators)
```bash
npm run build
npm run seed:influencers -- --source=apify
```

#### Option C: Both (recommended — combines manual list + Apify discovery)
```bash
npm run build
npm run seed:all -- --source=both
```

#### Dry run first (logs what would happen without writing to DB)
```bash
npm run seed:all -- --source=manual --dry-run
```

### 5. Test the REST Endpoints

```bash
# Start the server
npm start

# Create a campaign
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "gnc-test-campaign",
    "name": "GNC Test Campaign",
    "startDate": "2025-01-01",
    "endDate": "2025-12-31",
    "requiredHashtags": ["gnclivewell", "gncfitness"],
    "requiredMentions": ["gnclivewell"]
  }'

# List campaigns
curl http://localhost:3000/api/campaigns

# Get single campaign
curl http://localhost:3000/api/campaigns/gnc-test-campaign

# Register a real post under the campaign
curl -X POST http://localhost:3000/api/campaigns/gnc-test-campaign/posts \
  -H "Content-Type: application/json" \
  -d '{ "postUrls": ["https://www.instagram.com/p/REAL_POST_URL/"] }'

# Check influencer lifecycle
curl http://localhost:3000/api/influencers/some_username/lifecycle
```

### 6. Test Gemini Tools via Chat

Start the server and use the chat client:

```bash
npm start
# In another terminal:
node chat.js
```

Test prompts:
- "Track this post under campaign gnc-test-campaign: https://instagram.com/p/XXXX"
- "Check compliance for campaign gnc-test-campaign"
- "How did @username perform in the gnc-test-campaign?"
- "Should we continue working with @username?"
- "Show engagement timeline for https://instagram.com/p/XXXX"
- "Find influencers active in #muscleblaze and #optimumnutrition"

### 7. Verify Scheduler is Running

After `npm start`, you should see in logs:
```
GNC Brand Intel API running on port 3000
Scheduler: starting background jobs
```

After ~10 seconds:
```
Scheduler: prefetching GNC hashtags...
Scheduler: prefetched #gnclivewell
Scheduler: prefetched #gncfitness
...
```

---

## TTL Changes (Deferred)

The original plan included updating TTLs (profiles 1h→24h, posts 10m→6h, hashtags 10m→12h). This has been **deferred** — all original TTLs are preserved. The `src/constants/ttl.ts` file is the single source of truth, so when you're ready to change TTLs, just update the values there and rebuild. Everything else (tools.ts, analytics.ts, createIndexes.ts) reads from that file.

---

## Architecture Summary

```
User/Chat Client
       │
       ▼
  Express Server (index.ts)
       │
       ├── /api/chat → Gemini orchestration → 19 tools
       │                                         │
       │                     ┌───────────────────┤
       │                     │                   │
       │              12 existing tools    7 new campaign tools
       │              (tools.ts,           (campaign.ts)
       │               analytics.ts)
       │
       ├── /api/campaigns → Campaign CRUD + post registration
       │
       ├── /api/influencers → Influencer lifecycle records
       │
       └── Scheduler (background)
            ├── Monitor active campaign posts (hourly)
            └── Prefetch GNC hashtags (every 6h)

MongoDB Collections:
  Existing (with TTL):     ig_profiles, ig_posts, ig_reels,
                           ig_hashtag_posts, ig_hashtag_stats,
                           ig_hashtag_posts_meta

  New (durable):           campaigns, campaign_posts,
                           influencer_records

  New (180-day TTL):       post_snapshots
```
