# GNC Brand Intelligence Bot — Implementation Reference

**Version:** 2.0
**Last Updated:** 2026-02-25
**Status:** Live (server-side Gemini, single `/api/chat` endpoint)

---

## Architecture Overview

```
Rails / Any Client
    │  POST /api/chat { message, sessionId? }
    ▼
Express API (Node.js, port 3000)
    │
    ├── SessionStore (in-memory, 500 sessions, 30min TTL)
    ├── Gemini 2.5 Flash (server-side agentic loop, max 10 turns)
    │       │
    │       │  functionCalls → dispatch directly (no HTTP round-trip)
    │       │  parallel execution via Promise.allSettled
    │       ▼
    ├── 10 Tools (MongoDB cache-first + Apify on miss)
    └── Returns { response, sessionId, toolCalls[], timestamp }

Direct tool access still available:
    POST /api/tools/*     ← 10 endpoints for testing
    GET  /api/health
```

---

## Directory Structure

```
api/
├── src/
│   ├── index.ts                      # Express server, route mounting
│   ├── constants/
│   │   ├── actors.ts                 # Apify actor IDs
│   │   ├── system_prompt.ts          # Gemini system instruction
│   │   └── tool_declarations.ts      # 10 Gemini FunctionDeclaration objects
│   ├── middleware/
│   │   ├── cacheFirst.ts             # MongoDB TTL cache middleware
│   │   ├── validate.ts               # Zod validation middleware
│   │   └── errorHandler.ts           # Global error handler
│   ├── routes/
│   │   ├── chat.ts                   # POST /api/chat — main endpoint
│   │   ├── phase1.ts                 # POST /api/tools/* (data fetching)
│   │   └── phase2.ts                 # POST /api/tools/* (analytics)
│   ├── schemas/
│   │   ├── zod.ts                    # Input validation schemas
│   │   └── types.ts                  # TypeScript interfaces
│   └── services/
│       ├── analytics.ts              # MongoDB aggregation queries
│       ├── apify.ts                  # Apify client wrapper
│       ├── gemini.ts                 # Gemini orchestration engine + SSE events
│       ├── mongo.ts                  # MongoDB connection (db: gnc_influencer)
│       ├── session_store.ts          # In-memory chat session storage
│       ├── tools.ts                  # Extracted Phase 1 tool functions
│       └── transform.ts              # Apify → MongoDB data normalization
├── chat.js                           # Interactive terminal chat client
├── .env                              # Real credentials (gitignored)
├── .env.example                      # Placeholder template
└── .gitignore
```

---

## Environment Variables

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/gnc_influencer
APIFY_API_TOKEN=apify_api_...
GEMINI_API_KEY=...
PORT=3000
CORS_ORIGIN=*
```

---

## Database

**MongoDB Atlas** — database: `gnc_influencer`

| Collection | Purpose | TTL |
|---|---|---|
| `ig_profiles` | Instagram profile cache | 1 hour |
| `ig_posts` | User feed posts | 10 min |
| `ig_reels` | User reels | 10 min |
| `ig_hashtag_posts` | Posts by hashtag | 10 min |
| `ig_hashtag_stats` | Aggregated hashtag stats | 10 min |
| `ig_hashtag_posts_meta` | Hashtag fetch metadata | 10 min |

**Key field:** `ig_hashtag_posts` now stores `locationName` and `locationId` per post (from Apify's `locationName` field) — used for Indian influencer detection.

---

## 10 Tools

### Phase 1 — Data Fetching (Apify actors, cache-first)

| Tool | Apify Actor | Cache Key | TTL |
|---|---|---|---|
| `get_profile` | `instagram-profile-scraper` | `ig_profiles.username` | 1hr |
| `get_user_posts` | `instagram-post-scraper` | `ig_posts.username` | 10min |
| `get_user_reels` | `instagram-reel-scraper` | `ig_reels.username` | 10min |
| `get_hashtag_posts` | `instagram-hashtag-scraper` | `ig_hashtag_posts_meta.hashtag` | 10min |
| `get_hashtag_stats` | MongoDB aggregation | `ig_hashtag_stats.hashtag` | 10min |
| `check_post` | `instagram-post-scraper` | all post collections | - |

**Apify input format notes (confirmed from live runs):**
- Profile scraper: `{ usernames: [username] }`
- Post scraper: `{ username: [username], resultsLimit }`
- Reel scraper: `{ username: [username], resultsLimit }`
- Hashtag scraper: `{ hashtags: [hashtag], resultsLimit, onlyPostsNewerThan: '1 month' }`

### Phase 2 — Analytics (MongoDB aggregations, requires prior cache population)

| Tool | What it does |
|---|---|
| `get_top_posts_by_reach` | Ranks posts by engagement/likes/comments/views/plays |
| `get_brand_mentions` | Finds GNC keyword mentions across hashtag posts |
| `find_top_influencers` | Ranks creators by engagement score + brand affinity |
| `check_user_topic_posts` | Scans a creator's posts for topic keywords |

---

## Indian Influencer Filtering

Apify actors have **no native country/follower filters**. We implement a 3-layer approach:

### Layer 1 — Hashtag targeting
Use India-specific hashtags: `fitnessindia`, `indianfitness`, `desifit`, `indianbodybuilder`, `gymmotivationindia`, `mumbaifit`, `delhigym`

### Layer 2 — Biography detection
After profile enrichment, scan `bio` text for Indian city/state/country keywords (95-item list in `analytics.ts: INDIA_LOCATIONS`). Example: bio contains "Mr North India" → flagged as Indian.

### Layer 3 — Post location check
`ig_hashtag_posts.locationName` (e.g. "Indore", "Mumbai") stored from Apify output — checked against same `INDIA_LOCATIONS` list.

When `indianOnly: true`, candidate pool is `limit × 8` to compensate for filtering attrition.

### Follower thresholds
- 1 lakh+ → `minFollowers: 100000`
- 10 lakh+ → `minFollowers: 1000000`, `influencerTier: 'mega'`

---

## Sponsored Content

`sponsoredRatio` is **calculated and reported** for every influencer but is **NOT used as a hard filter**. Rationale: GNC may want to partner with influencers who already do brand deals — high sponsored ratio is a data point, not a disqualifier. The ratio is visible in results so the marketing team can decide.

Detection markers: `#ad`, `#sponsored`, `#paid`, `#partnership`, `#collab`, `#gifted`, `#promo`, `#ambassador`, `paid partnership`, `sponsored by`, `in collaboration with`

---

## Gemini Orchestration (`services/gemini.ts`)

- Model: `gemini-2.5-flash`
- Max turns: 10
- Uses **manual `generateContent()` with `Content[]` history** — NOT SDK's `ChatSession`. Reason: Gemini 2.5 Flash thinking mode returns empty-text parts that `ChatSession.isValidResponse()` drops, corrupting history.
- All function calls in a turn execute in **parallel** via `Promise.allSettled`
- Emits SSE events during loop: `thinking` → `tool_start` → `tool_done` (per tool) → `answer`
- History trimmed before storage: large `posts[]`/`reels[]` arrays replaced with summary strings

### SSE Event Types
```typescript
{ type: 'thinking', turn: number }
{ type: 'tool_start', tools: string[] }
{ type: 'tool_done', info: { name, durationMs, cacheHit?, error? } }
{ type: 'answer', text: string, toolCalls: ToolCallInfo[] }
```

---

## Session Store (`services/session_store.ts`)

- In-memory `Map<string, Session>`
- Max 500 sessions, 30min TTL
- Auto-evicts expired on every get/set
- Evicts oldest when at capacity
- Session IDs: `crypto.randomUUID()` — server-generated only

---

## API Reference

### `POST /api/chat`
Main endpoint. Rails team calls this.

**Request:**
```json
{ "message": "Find top Indian fitness influencers", "sessionId": "optional-uuid" }
```

**Response:**
```json
{
  "response": "Here are the top influencers...",
  "sessionId": "abc-123",
  "toolCalls": [
    { "name": "get_hashtag_posts", "cacheHit": false, "durationMs": 8798 },
    { "name": "find_top_influencers", "durationMs": 31598 }
  ],
  "timestamp": "2026-02-25T12:05:44.302Z"
}
```

Validation: `message` 1–2000 chars, `sessionId` optional UUID.

### `GET /api/health`
```json
{ "status": "ok", "timestamp": "..." }
```

### `POST /api/tools/:toolName`
Direct tool access for testing. Same 10 tool names as above.

---

## Scoring Algorithm

```
engagementScore = likes + comments + (views × 0.1) + (plays × 0.1)

influencerScore = (avgEngagementScore × 0.5) + (brandMentionCount × 1000)
```

### Influencer Tiers
| Tier | Followers |
|---|---|
| nano | < 10,000 |
| micro | 10,000 – 99,999 |
| macro | 100,000 – 999,999 |
| mega | ≥ 1,000,000 |

---

## Running Locally

```bash
cd api
npm install
npm run build
node build/index.js        # server on :3000

# Terminal chat client (separate terminal)
node chat.js
```

---

## Rails Integration

```ruby
class GncBrandApi
  BASE_URL = ENV['GNC_BRAND_API_URL']

  def self.chat(message:, session_id: nil)
    body = { message: message }
    body[:sessionId] = session_id if session_id
    response = HTTParty.post("#{BASE_URL}/api/chat",
      body: body.to_json,
      headers: { 'Content-Type' => 'application/json' },
      timeout: 60
    )
    JSON.parse(response.body)
  end
end
```

---

## Known Limitations

1. **Apify free tier**: Hashtag scraper limited to 1 page per run on free plan → typically 15–50 posts per hashtag. Upgrade Apify plan for more data.
2. **No native India filter in Apify**: Bio-based detection works well but misses accounts with no India mention in bio and no location-tagged posts.
3. **Gemini API quota**: Free tier has daily limits. Enable billing on Google AI Studio for production use.
4. **Session storage is in-memory**: Restarts clear all sessions. Acceptable for current usage; swap to Redis for multi-instance deployment.
5. **`#indianfitness` hashtag**: Timed out on Apify in testing (TIMED-OUT status) — retry separately if needed.
