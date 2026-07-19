# Ascent Ledger — BMG Standard Climb Tracker & Progression Planner

A personal (non-commercial) web app for logging climbs and tracking progress
toward the British Mountain Guide (BMG) aspirant scheme prerequisites, with a
recommendation engine that suggests the next climbs to close the gap.

Source of the target standard: https://www.bmg.org.uk/become-a-guide/prerequisites/

> **⚠️ VERIFY BEFORE BUILDING RULES**
> The exact numeric thresholds below were pulled via an automated page fetch
> and summarised by a small model — the specific numbers (e.g. "20 must be
> Grade V+", "5 must be 800m+ mixed routes") are **plausible but not
> guaranteed verbatim**. BMG also revises the scheme periodically. Before
> Phase 2 (rules engine), have a human re-read the live page and correct
> `docs/bmg_rules.seed.json` (Phase 2 deliverable). The whole point of
> building this as a config table rather than hardcoded logic is so a wrong
> number is a one-line edit, not a code change.

---

## 1. Product Concept

**Elevator pitch:** Strava/UKC logbook crossed with a syllabus tracker. You
log climbs (rock, winter, alpine, ski touring). The app normalises grades
across systems, scores your logbook against the BMG prerequisite categories,
shows you exactly what's missing, and recommends specific real routes —
pulled from a maintained route database — that would close the gap, weighted
toward areas/grades that make sense as a "next step."

**Primary user:** one person (you), so no need to over-engineer multi-tenant
concerns, but build the data model as if multi-user from day one — it's free
if done early and costly to retrofit.

**Explicitly not a goal:** helping anyone actually apply to BMG, submitting
data to BMG, or claiming route-database completeness/accuracy. This is a
personal training/motivation tool.

### Core features
1. **Climb logbook** — CRUD for logged ascents across 4 disciplines (rock,
   winter, alpine, ski touring), with photos, notes, partners, style.
2. **Grade normalisation engine** — converts/compares grades across systems
   (UK trad adjectival+tech, French sport, UIAA, Scottish winter, WI ice,
   Alpine overall grades, ski touring difficulty).
3. **BMG progress dashboard** — per-category progress bars + sub-condition
   breakdown ("34/50 rock routes at E1 5b+", "8/20 TD+ alpine routes"),
   driven by an editable rules table, not hardcoded thresholds.
4. **Map view** — logged climbs + recommended climbs on an interactive map,
   clustered by area.
5. **Recommendation engine** — rule-based gap analysis + grade-proximity +
   geographic clustering, drawing from a curated/scraped route database.
6. **Route database** — seeded from open climbing-data APIs where possible
   (see §5 — legal/data-source strategy), supplemented by manual curation.
7. **Import/export** — CSV import, GPX import for approach/route tracks,
   CSV export of the logbook.

### Explicit non-features (v1)
- No social feed, no following other climbers, no public profiles.
  *(Amended for Phase 11 — decision D-1 in `docs/PHASE8_PROPOSAL.md`: public
  route reviews/tags and per-climb **opt-in** public ticks are in scope;
  feeds, following, and profile pages remain excluded, and Climbs stay
  private by default.)*
- No payments/subscriptions.
- No native mobile app — build a responsive PWA instead (installable, works
  offline for viewing your own logbook).
- No attempt to be a comprehensive route database for all of climbing —
  scope the seeded database to the regions relevant to the BMG categories
  (UK, Scotland, the Alps) rather than trying to cover the whole world.

---

## 2. Tech Stack

Chosen for being the default "batteries included" stack most AI web-app
builders (including Fable) already know well, which minimises tokens spent
re-deriving boilerplate:

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14+ (App Router, TypeScript)** | Full-stack in one repo: UI + API routes + server actions |
| Styling | **Tailwind CSS + shadcn/ui** | Fast, consistent, low token cost to generate |
| Database | **Postgres via Supabase** | Free tier, built-in auth, storage (photos), row-level security |
| ORM | **Prisma** | Type-safe schema, easy migrations, good for an AI builder to reason about |
| Auth | **Supabase Auth** (email/password + Google OAuth) | No custom auth code needed |
| Maps | **MapLibre GL JS + free OSM tiles** (or Mapbox free tier) | Avoid vendor lock-in / cost for a personal project |
| File storage | **Supabase Storage** | Route/climb photos |
| Background jobs (scraping/import) | **Node script run via a scheduled Supabase Edge Function / GitHub Action cron** | No need for a separate worker service at this scale |
| Hosting | **Vercel** (app) + **Supabase** (DB/auth/storage) | Both have generous free tiers |
| Testing | **Vitest** (unit) + **Playwright** (e2e, later phase) | Standard, cheap for an AI agent to scaffold |

This is a recommendation, not a hard requirement — but naming a concrete
stack up front (rather than asking Fable to choose) is itself a major token
saver, since it skips a whole round of framework debate.

---

## 3. Data Model

```
User
 - id, email, display_name, home_region, created_at

Climb                          -- a single logged ascent
 - id, user_id (FK)
 - route_id (FK, nullable)     -- linked to a canonical Route if matched
 - free_text_route_name        -- fallback if not in the DB / not matched
 - discipline                  -- enum: rock | winter | alpine | ski_touring
 - date
 - grade_system                -- enum: uk_trad | french_sport | uiaa |
                                --   scottish_winter | wi_ice | alpine_overall |
                                --   ski_touring_scale
 - grade_raw                   -- e.g. "E3 5c", "V,6", "TD+", "PD"
 - grade_normalised_score      -- numeric, computed by the grade engine (see §4)
 - ascent_style                -- enum: led | alternate_lead | seconded |
                                --   solo | roped_solo
 - pitches, length_m (nullable)
 - area_id (FK)
 - partners                    -- text[] or join table
 - notes
 - photo_urls                  -- text[]
 - gpx_track_url (nullable)
 - source                      -- enum: manual | csv_import | ukc_import

Route                          -- canonical route entry (from DB or user-added)
 - id, name, area_id (FK)
 - discipline
 - grade_system, grade_raw, grade_normalised_score
 - lat, lng
 - length_m, pitches
 - description
 - quality_rating (nullable)   -- stars, if source provides it
 - external_source, external_url, external_id  -- attribution, see §5
 - last_synced_at

Area                           -- crag / mountain / massif
 - id, name, region            -- e.g. region: "Scotland - Ben Nevis", "Alps - Mont Blanc massif"
 - country
 - lat, lng
 - discipline_tags             -- which BMG categories this area is relevant to

BmgCategory
 - id, key                     -- rock | winter | alpine | ski_touring
 - label, description

BmgRule                        -- editable rules table — THE fix for the
                                --   "verify the numbers" problem above
 - id, category_id (FK)
 - description                 -- human-readable, e.g. "Grade V+ Scottish winter routes"
 - min_grade_normalised_score  -- threshold this rule counts against
 - min_count                   -- how many qualifying climbs required
 - extra_constraint_json       -- flexible field for constraints like
                                --   "must be in Scotland", "must be 800m+ mixed"
 - source_note                 -- link/quote from the BMG page, for auditing

ProgressSnapshot                -- optional, cached computed progress
 - id, user_id, category_id, computed_at, percent_complete, detail_json

RouteImportLog
 - id, source, run_at, routes_added, routes_updated, errors_json
```

### Grade normalisation approach
Don't try to build a perfect universal grade converter (it doesn't exist —
grade systems measure different things). Instead:
- Store the **raw grade string** always (source of truth, shown in UI).
- Compute a **per-discipline ordinal score** (an integer ladder position
  within that discipline's own grade system, e.g. UK trad Severe=1,
  VS=2, ... E11=29). This is enough to answer "is this climb at/above
  threshold X" and "what's slightly harder than my current level," which is
  all the BMG rules and the recommender actually need.
- Maintain one lookup table per grade system (`grade_ladders.json`), not a
  cross-system conversion matrix. Cross-discipline comparison is never
  required by BMG rules (rock is compared to rock, alpine to alpine, etc).

---

## 4. BMG Rules Engine

Pure function, no ML:

```
for each BmgRule in category.rules:
    qualifying_climbs = user.climbs
        .filter(discipline == category)
        .filter(grade_normalised_score >= rule.min_grade_normalised_score)
        .filter(matches(rule.extra_constraint_json))   -- region, style, etc.
    rule.actual_count = qualifying_climbs.count()
    rule.met = rule.actual_count >= rule.min_count

category.percent_complete = weighted average of rule completion
category.gaps = [rule for rule in rules if not rule.met], each with
                 (rule.min_count - rule.actual_count) "still needed"
```

Surface this as a dashboard: 4 category cards (Rock / Winter / Alpine / Ski
Touring), each expandable to show every sub-rule with a progress bar and
"X more needed" — and, once the recommender exists, a "suggest routes for
this gap" button per rule.

---

## 5. Route Database & Data-Source Strategy (read before scraping anything)

Scraping UK/Alpine climbing sites is a legal and ethical grey area — most
UGC climbing databases (UKClimbing, UKHillwalking, Mountain Project) have
ToS that restrict bulk scraping/republishing, even though the underlying
route names/grades/locations are largely factual and not very copyrightable
on their own. Recommended approach, cheapest-and-safest first:

1. **Prefer open-licensed data APIs first:**
   - **OpenBeta** (openbeta.io) — open, community climbing route dataset
     (rock), GraphQL API, permissive licence. Good primary source for UK
     rock routes.
   - **Camptocamp (c2c)** — camptocamp.org's public API, CC BY-SA licensed
     content, strong coverage of Alpine routes, ski touring, and winter
     mountaineering routes across the Alps. Good primary source for
     alpine/ski touring/alpine-mixed.
2. **For gaps these don't cover well (notably Scottish winter, which has
   thin open-data coverage):** don't bulk-scrape UKC/UKH. Instead:
   - Seed a small **manually curated** set of classic Scottish winter
     routes (public knowledge — grade/name/crag, easily hand-entered from
     guidebooks you already own or SAIS/Scottish winter guidebook data).
   - Let the app **deep-link** to UKC/UKH/SAIS route pages instead of
     storing their content — respects ToS, still useful for the user.
   - Optionally let users manually add a Route with just name/area/grade
     when it's missing, growing the personal DB organically.
3. **Always store `external_source` + `external_url` attribution** on any
   Route pulled from an external dataset, and cache with a `last_synced_at`
   rather than re-fetching live (be a polite API citizen; check each API's
   rate limits and cache accordingly — e.g. re-sync weekly, not per-request).
4. Build the importer as a **pluggable adapter per source**
   (`/lib/importers/openbeta.ts`, `/lib/importers/camptocamp.ts`,
   `/lib/importers/manual-csv.ts`) so adding a new source later doesn't
   touch existing ones.

This staged approach also happens to match the phased build plan below —
Phase 3 ships with zero external data (manual entry only), Phase 4 adds the
two open APIs, Phase 5+ optionally adds curated Scottish data.

---

## 6. Recommendation Engine (v1 — rule-based, no ML needed)

Given a BmgRule gap (e.g. "need 8 more Grade V+ Scottish winter routes"):

```
candidates = Route.filter(discipline == rule.category)
    .filter(grade_normalised_score in [current_max - 1, current_max + 2])
        -- "just above your current comfortable grade", not miles above
    .filter(matches rule.extra_constraint_json, e.g. region == Scotland)
    .filter(route not already logged by user)

score(candidate) =
      w1 * grade_fit            -- closer to "next logical grade" scores higher
    + w2 * quality_rating        -- prefer well-regarded routes if rating available
    + w3 * area_diversity_bonus  -- slight preference for areas the user hasn't
                                  --   visited yet, to broaden the portfolio
    - w4 * distance_penalty      -- optional: prefer areas near ones already visited,
                                  --   to keep trip planning efficient

return top N candidates per rule, grouped by area, shown on the map view
```

Keep the weights (`w1..w4`) as a simple config object editable in the UI
settings — this is the kind of thing that's fun to tune once the app
exists, and building it as a first-class setting instead of a magic number
avoids a redesign later.

---

## 7. Phased Build Roadmap

Each phase is scoped to be independently shippable and independently
promptable (see `docs/FABLE_PROMPTS.md`). Don't start a phase's prompt by
re-explaining the whole product — point Fable at this doc and the specific
phase section only.

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | Repo scaffold: Next.js + TS + Tailwind + shadcn/ui + Prisma + Supabase wired up, deployed "hello world" on Vercel, CI running lint/typecheck | — |
| **1** | Auth (Supabase) + `User`/`Climb`/`Area` tables + manual climb logbook CRUD (list/add/edit/delete, no grade engine yet, free-text grade field) | 0 |
| **2** | Grade ladders (`grade_ladders.json`) + `BmgCategory`/`BmgRule` tables seeded from **verified** BMG numbers + progress dashboard (4 category cards + sub-rule breakdown) | 1 |
| **3** | `Route`/`RouteImportLog` tables + map view (logged climbs plotted) + CSV import for bulk logbook entry + manual "add a Route to the DB" form | 2 |
| **4** | OpenBeta + Camptocamp importer adapters, scheduled sync job, route matching (link a logged Climb to a canonical Route by name+area fuzzy match) | 3 |
| **5** | Recommendation engine v1 (rule-based gap analysis, per §6) + "suggested routes" panel per BMG sub-rule + suggested routes shown on map | 2, 4 |
| **6** | Polish: photo upload, GPX import/display, PWA offline support for viewing own logbook, mobile layout pass | 3, 5 |
| **7** | Curated Scottish winter seed data, area-diversity/distance scoring tuning, e2e tests (Playwright) for the core logbook→dashboard→recommendation flow | 4, 6 |
| **8** | Trail geometry + track import: terra-draw line tracing on the MapLibre map for Climbs/Routes, GPX/KML upload → parse/simplify/auto-plot, `path_geojson` (GeoJSON LineString) on `Route` + `Climb`, backfill of existing `gpx_track_url` files | 6 |
| **9** | Ingestion breadth: OSM/Overpass adapter (hiking + via ferrata, UK + Alps bboxes), OGL trail-agency adapters (National Trails, Scotland's Great Trails), `hiking` discipline + SAC `sac_hiking` ladder, per-source attribution pass | 4, 8 |
| **10** | Cold start + onboarding: first-login flow (region/disciplines/optional self-reported grade), curated starter-route seed + no-history suggestion path, minimal `UserPreference` table, grade explainer tooltips + `/help/grades` generated from `grade_ladders.json` | 5 |
| **11** | Community v1: public `RouteReview` + curated `Tag` vocabulary on `Route`, tag chips, per-Climb opt-in public-tick (`visibility`, default private), Supabase RLS for public reads — no feed/following/profile pages | 3 |
| **12** | Preference suggestion engine: `UserPreference` extended (grade windows, regions, tags, trip length, weights), affinity profile from history with recency decay, `src/lib/suggestions.ts` + shared `src/lib/scoring.ts` extracted from `recommender.ts`, dedicated "For you" page + map layer | 9, 10 |

Phases 8–12 are specified in detail — per-phase data-model deltas, touched
files, rejected data sources, and the resolved decisions D-1…D-11 — in
`docs/PHASE8_PROPOSAL.md`.

---

## 8. Open Questions for You (not for Fable)

Answer these before Phase 2, since they affect the rules table:
1. Do you want the BMG numbers **manually re-verified** against the live
   page (recommended), or are you okay shipping with the fetched draft
   values flagged as "unverified" in the UI until you check them?
2. Home base / regions you'll actually be climbing in — affects how much
   effort Phase 4/7 data seeding is worth for each discipline.
3. Do you already have an existing logbook (UKC export, spreadsheet,
   paper) to import in Phase 1/3, or starting from zero?
