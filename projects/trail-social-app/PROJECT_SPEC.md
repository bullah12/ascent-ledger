# PROJECT SPEC — Trail Social App

AllTrails-style app with a social layer and personalized recommendations:
users log completed trails, follow friends, and get "your next trail"
suggestions from their preferences and history.

## Shared Skills Applied

| Skill | How it's used here |
|---|---|
| `auth` | Users, moderators, admin; social features require accounts |
| `database-schema-design` | Trail/log/social schema below |
| `rest-api-design` | User API; **cursor pagination** for the activity feed |
| `file-storage-uploads` | Trail photos + avatars (public, variants; EXIF GPS kept only with consent) |
| `notifications-scheduling` | Follow/comment notifications, weekly digest, batched social emails |
| `embeddings-similarity-search` | Phase 2 recommendation upgrade (see below) |
| `dashboard-ui-patterns` | Moderation/admin dashboard; user app reuses form/query conventions |

Stack: Node/TypeScript + Fastify + Postgres (+ PostGIS for geo queries) +
React (Vite SPA; wrap with Capacitor later if mobile packaging is wanted).

## Trail Data: Build vs Integrate

Options, in recommended order:

1. **OpenStreetMap / Overpass + Waymarked Trails data** — free, global,
   license-friendly (ODbL, attribution required). Import into our own
   `trails` table via an ETL job; curate/enrich manually. **Default choice.**
2. **Recreation.gov / national-park open APIs** — good regional supplements.
3. **Commercial APIs (Outdooractive, Trailforks)** — better data, licensing
   cost and terms; revisit if OSM quality disappoints in target regions.

Design consequence: `trails` is **our** table with a `source` +
`source_ref` column — the app never depends on a third-party API at request
time; imports are scheduled jobs.

## Data Model

```
users                (auth skill)
profiles             user_id unique FK, bio, avatar_file_id FK, home_region,
                     is_private boolean
trails               name, slug unique, region, country,
                     distance_km numeric, elevation_gain_m int,
                     difficulty CHECK(easy|moderate|hard|expert),
                     route_type CHECK(loop|out_and_back|point_to_point),
                     geom geography(LineString) NULL,  -- PostGIS, when source has track
                     lat/lng trailhead, description,
                     source CHECK(osm|manual|partner), source_ref,
                     status CHECK(draft|published|archived),
                     embedding vector(512) NULL, embedding_model text  -- phase 2
tags                 name unique, kind CHECK(landscape|feature|season|suitability)
                     -- e.g. landscape:coastal, feature:waterfall, suitability:dog-friendly
trail_tags           trail_id FK, tag_id FK, UNIQUE pair
trail_photos         trail_id FK, file_id FK, user_id FK (uploader), status(pending|approved)
trail_logs           user_id FK, trail_id FK, completed_on date,
                     duration_minutes int NULL, rating int CHECK 1..5 NULL,
                     notes text, is_public boolean DEFAULT true
                     -- multiple logs per (user,trail) allowed: repeat hikes
log_photos           trail_log_id FK, file_id FK
follows              follower_id FK, followee_id FK, UNIQUE pair, CHECK(no self-follow)
comments             subject_type CHECK(trail|trail_log), subject_id, user_id FK,
                     body, deleted_at (soft delete for moderation)
reactions            subject_type, subject_id, user_id FK, kind CHECK(like), UNIQUE(subject,user)
user_preferences     user_id unique FK, preferred_difficulties text[],
                     preferred_tags uuid[], max_distance_km numeric,
                     max_drive_minutes int NULL, elevation_comfort_m int
reports              reporter_id FK, subject_type, subject_id, reason, status(open|actioned|dismissed)
notifications, jobs, files    (respective skills)
```

## Recommendation Engine

### Phase 1 — rule-based (ships with MVP)

Score = weighted sum over candidate trails, computed by a scheduled job per
active user (cached in `recommendations(user_id, trail_id, score, reasons jsonb)`):

1. **Hard filters (SQL):** not already logged, `status=published`, within
   `max_distance_km`/region, difficulty within one step of preference.
2. **Soft scores:**
   - Tag overlap with `preferred_tags` **and** tags of highly-rated logged
     trails (learned taste, not just declared).
   - Difficulty progression: slight bonus one notch above their recent average.
   - Distance/elevation proximity to their typical completed stats.
   - Popularity prior (log count) as tiebreaker; small recency penalty for
     trails similar to last week's hike (encourage variety).
3. **Explainability:** store `reasons` ("coastal like 4 trails you rated 5★",
   "a step up in elevation") — shown in the UI, which also makes tuning debuggable.

### Phase 2 — embeddings upgrade (`embeddings-similarity-search` skill)

- Embed each trail: text embedding of description + tags (+ optionally CLIP
  over trail photos) → `trails.embedding` (pgvector, HNSW).
- Build a **user-taste vector**: recency-decayed, rating-weighted mean of
  embeddings of trails they logged.
- Replace the tag-overlap soft score with cosine similarity; **keep** the
  hard SQL filters and progression/variety logic. Rule-based and vector
  scores can be blended during transition and A/B checked against
  click/complete rates.

## Key User Flows

1. **Log a trail:** search/browse trails (filters: region, difficulty, tags,
   distance) → trail page → "I did this" → date, duration, rating, notes,
   photos → appears on profile + followers' feeds (if public).
2. **Get recommendations:** home screen "Your next trails" carousel with
   reason chips; thumbs-down hides and feeds back into scoring.
3. **Social:** search users → follow → activity feed (cursor-paginated:
   follows' logs, photos) → comment/like → notifications (batched digests
   for low-priority, per `notifications-scheduling`).
4. **Privacy:** private profile hides logs from non-followers; per-log
   `is_public` override; EXIF GPS stripped from photos unless user opts in.
5. **Moderation (admin dashboard):** reports queue (review-queue pattern),
   comment/photo takedowns, trail data curation + import monitoring.

## API Surface (representative)

```
GET  /api/v1/trails?difficulty=&tags=&region=&maxDistanceKm=&sort=
GET  /api/v1/trails/:slug
POST /api/v1/trail-logs           GET /api/v1/users/:id/trail-logs
GET  /api/v1/recommendations      POST /api/v1/recommendations/:trailId/dismiss
POST /api/v1/users/:id/follow     DELETE .../follow
GET  /api/v1/feed?cursor=&limit=          # cursor pagination
POST /api/v1/comments             POST /api/v1/reports
GET  /api/v1/me/preferences       PATCH /api/v1/me/preferences
# admin: /api/v1/admin/reports, /admin/trails, /admin/imports
```

## Assumptions & Phasing

- Web-first; no offline maps or GPS track recording in v1 (log after the
  fact, not live tracking).
- Trail data seeded for one launch region first; expand via imports.
- **Phase 1:** trails + search + logging + profiles. **Phase 2:** social
  (follow/feed/comments) + rule-based recommendations. **Phase 3:**
  embeddings recommendations + digests + moderation tooling.
