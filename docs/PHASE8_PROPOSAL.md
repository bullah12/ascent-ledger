# Phase 8+ Proposal — Trails, Ingestion Breadth, Cold Start, Community, Preference Engine

Status: **approved 2026-07-19 — all decisions D-1…D-11 resolved (see §7); the
§1 table rows are appended to `docs/PLAN.md` §7.** Nothing is implemented yet;
phases are built one at a time on request, same as Phases 0–7.

Covers the five asks: (A) map trail drawing + track import, (B) broader
ingestion, (C) cold start/onboarding, (D) community layer (reverses a §1
non-feature — presented as a decision point, not a fait accompli), (E) a
general history+preference suggestion engine distinct from the §6 BMG-gap
recommender.

---

## 1. Proposed phase table (append to PLAN.md §7 once approved)

| Phase | Deliverable | Depends on |
|---|---|---|
| **8** | **Trail geometry + track import (A):** trace a line on the MapLibre map when adding/editing a Climb or Route (terra-draw), GPX/KML upload that parses + simplifies + auto-plots, new `path_geojson` geometry on `Route` and `Climb`, backfill parse of existing `gpx_track_url` files, line rendering + fit-to-track on the map | 6 |
| **9** | **Ingestion breadth (B):** OSM/Overpass adapter (hiking + via ferrata relations, region-scoped), OGL trail-agency adapters (National Trails England/Wales, Scotland's Great Trails), new `hiking` discipline + SAC `sac_hiking` grade ladder, per-source attribution/licence pass in UI footer + route pages | 4, **8** (trail sources emit line geometry) |
| **10** | **Cold start + onboarding (C):** first-login onboarding (home region, disciplines, optional self-reported grade), curated starter-route seed + no-history suggestion path, minimal `user_preferences` table (seeded by onboarding, extended in Phase 12), grade/discipline explainer tooltips + a `/help/grades` page generated from `grade_ladders.json` | 5 (better after 9) |
| **11** | **Community v1 (D):** public `RouteReview` (rating + text) and curated `Tag` vocabulary on `Route`, tag chips as at-a-glance summary, per-Climb opt-in "public tick" visibility flag (D-1: Option 2), Supabase RLS for public reads — explicitly **no** feed, following, or profile pages | 3 (better after 9) |
| **12** | **Preference suggestion engine (E):** `user_preferences` extended (grade windows, regions, tags, trip length, engine weights), affinity profile computed from completed climbs (area/tag/grade-band with recency decay), new `src/lib/suggestions.ts` + shared `src/lib/scoring.ts` extracted from `recommender.ts`, "For you" panel + map layer | **9, 10**; benefits from 11 (tags/ratings), degrades gracefully without it |

**Suggested ordering rationale:** 8 → 9 is a hard sequence — the most valuable
new sources in 9 (hiking/via-ferrata trails) are inherently *lines*, so the
geometry column must exist first. 10 is order-flexible (it only depends on
shipped Phase 5) but lands better after 9 so hiking starter packs exist; it
also introduces the minimal `user_preferences` table that 12 extends. 11 is
independent of everything schema-wise and can be pulled earlier, deferred, or
dropped without blocking 12. 12 goes last: it's only as good as its candidate
pool (9) and its knowledge of the user (10, and 11's tags if approved).

---

## 2. Phase 8 — Map trail drawing + track import (A)

### What it is
- **Trace on map:** in the existing map (`src/app/map/map-view.tsx`) and in
  the Climb/Route forms, a "draw" mode that lets the user click out a
  polyline for the route/approach and save it as geometry.
- **Track import:** upload GPX (already supported as a raw file) **or KML**
  and have the track parsed, simplified, and stored as the same geometry —
  no hand-tracing needed.

### Geometry storage — recommendation
Add a nullable **GeoJSON `LineString` stored in a `Json` column** to both
models (pseudo-schema, §3-of-PLAN.md style):

```
Route
 + path_geojson (Json?)        -- GeoJSON LineString, WGS84, simplified
 + path_source  (enum?)        -- drawn | gpx_upload | kml_upload | import
Climb
 + path_geojson (Json?)        -- same shape; the user's personal track
 + path_source  (enum?)
```

Why `Json` GeoJSON and **not PostGIS** (yet): Prisma has no first-class
PostGIS type (it forces `Unsupported()` columns + raw SQL everywhere),
MapLibre consumes GeoJSON natively with zero conversion, and nothing in
Phases 8–12 needs true spatial queries — the recommender's distance logic is
haversine on representative `lat`/`lng` points and stays that way. PostGIS is
a reversible later upgrade (backfill from the JSON) if we ever want
"routes within X km of this line". Flagged as decision **D-3**.

Representative point stays: `Route.lat/lng` (and Climb's area/route point)
remain the canonical *point*, derived from the line (start point) when a line
exists. That keeps every existing consumer — map pins, clustering, the §6
recommender, BMG constraints — untouched.

### Relationship to the existing `gpx_track_url`
Keep both, with distinct jobs:
- `Climb.gpxTrackUrl` = **raw uploaded file** in Supabase Storage — archival
  source of truth, re-parseable, downloadable.
- `path_geojson` = **parsed, simplified, render-ready derivative** (target
  ~500–1000 points via Douglas-Peucker, `@turf/simplify` or `simplify-js`) —
  what the map and future scoring read.

A drawn line has no file, so `gpxTrackUrl` stays null; an uploaded file
populates both. One-off backfill script parses existing `gpxTrackUrl` uploads
into `Climb.path_geojson` (data backfill, not a schema migration concern).
The map view stops fetching + DOM-parsing GPX client-side per render
(`parseGpx` in `map-view.tsx`) once geometry is server-side.

### Drawing library — recommendation
**terra-draw** with `TerraDrawMapLibreGLAdapter`. It's MIT-licensed, actively
maintained, adapter-based with first-class MapLibre GL support, and its
linestring/freehand modes are exactly this feature. The main alternative,
`@mapbox/mapbox-gl-draw`, predates the Mapbox/MapLibre split and only works
against MapLibre via community forks with patchy maintenance — not worth it
when terra-draw targets MapLibre directly. (Leaflet is not on the table; we
committed to MapLibre in §2.)

File parsing: replace the hand-rolled GPX DOM parse with **`@tmcw/togeojson`**
(MIT) — one small library that handles GPX *and* KML (and TCX for free),
server-side or client-side. FIT-file support is possible via `fit-file-parser`
but adds a binary-format dependency — **deferred as a future feature**
(decision D-4: GPX + KML only in Phase 8).

### Files touched
`prisma/schema.prisma` (+1 migration), `src/app/map/map-view.tsx` (draw mode,
line layers, fit-bounds), Climb/Route add-edit forms, new `src/lib/tracks.ts`
(parse/validate/simplify — subsumes the map view's `parseGpx`), the upload
API route, seed/backfill script. No changes to the grade engine, BMG engine,
or recommender.

### Standalone? Yes.
Depends only on shipped Phase 6. But Phase 9 depends on *it*.

---

## 3. Phase 9 — Broaden the ingestion engine (B)

All of these plug into the existing `RouteImporter` interface
(`src/lib/importers/types.ts`) and register in the runner (`sync.ts`); the
runner itself only changes to accept geometry passthrough. `ExternalRoute`
gains an optional `pathGeojson` field — hence the dependency on Phase 8.

### Proposed sources (pass the §5 bar)

1. **OSM via Overpass API** — `relation[route=hiking|foot]` and
   `via_ferrata` ways, scoped to bounding boxes for the regions we care
   about (UK, Scottish Highlands, Alps — decision D-9). Licence: **ODbL** —
   open, attribution "© OpenStreetMap contributors" required, share-alike
   applies to derivative *databases*. For a personal non-commercial app this
   is fine, but it's a real obligation if the route DB is ever published —
   flagged in decision D-8. Politeness: public Overpass endpoints are
   rate-limited; weekly sync (existing cadence), bbox-chunked queries,
   `maxRoutes` cap respected, `last_synced_at` as always.
   New adapter: `src/lib/importers/osm-overpass.ts`.
2. **National Trails (England & Wales) open data** — trail geometries
   published under the **Open Government Licence v3** (attribution,
   otherwise permissive). Small, static, high-quality set of long-distance
   classics. Adapter: `src/lib/importers/uk-national-trails.ts` (fetch once,
   re-sync rarely).
3. **Scotland's Great Trails / NatureScot open data** — OGL-licensed
   Scottish long-distance routes; directly relevant to the Scottish focus of
   the BMG categories and thin open coverage there. Same adapter pattern.
4. *(Optional, out of stated region scope)* **US NPS / USGS trail data** —
   public domain, excellent quality, but §1 scopes the DB to UK + Alps;
   listed only so we've consciously skipped it.

### Considered and rejected (per the §5 legal bar)
- **UKC / UKHillwalking, Mountain Project / onX Hiking Project** — ToS
  restrict bulk scraping/republishing. Deep-linking (already the §5 stance)
  stays the only integration.
- **AllTrails, Komoot, Wikiloc, Strava (heatmap/segments), FATMAP** —
  proprietary UGC platforms; ToS forbid bulk export; no open licence.
- **FFRandonnée GR route data (France)** — the federation asserts database
  rights over GR itineraries; IGN base maps being open doesn't open the GR
  routes themselves. Individual GR sections mapped in OSM come in via
  source 1 legitimately.
- **SchweizMobil / Wanderland (Switzerland)** — not openly licensed.
- **Waymarked Trails** — lovely, but it's an OSM derivative; go to Overpass
  directly rather than scraping a downstream renderer.

### Data-model deltas
```
enum Discipline        + hiking                 -- decision D-2
enum GradeSystem       + sac_hiking             -- SAC T1–T6 ladder in grade_ladders.json
Route                  -- no new columns beyond Phase 8's path_geojson;
                       -- external_source/external_url/last_synced_at already
                       -- carry attribution (§5 point 3)
```
`hiking` deliberately gets **no BmgCategory** — the BMG dashboard iterates
seeded categories, so a fifth discipline flows into the logbook, map, and the
Phase 12 engine without touching BMG progress. The logbook forms, discipline
filters, and grade pickers need the new enum value surfaced.

### Files touched
`src/lib/importers/` (3 new adapters + `types.ts` geometry field),
`sync.ts` registration, `grade_ladders.json` + `src/lib/grades`,
`prisma/schema.prisma` (enum additions), logbook/route form discipline lists,
an attribution block on route detail + map (OSM attribution is mandatory).

### Standalone? Mostly.
The rock/alpine status quo doesn't change; but the *point* of this phase is
trails, and trails are lines → **depends on Phase 8**.

---

## 4. Phase 10 — Cold start + onboarding (C)

### No-history recommendation path
The §6 recommender already half-handles this: with no graded climbs,
`recommendForRule` anchors the grade window on the rule threshold instead of
`current_max` (`recommender.ts:154`). What's missing is everything around it:

1. **Starter routes.** A curated seed file (`docs/starter_routes.seed.json`,
   same pattern as `bmg_rules.seed.json`) marking ~10–20 classic
   easy-to-moderate routes per discipline per region, flagged on the model:
   ```
   Route + starter_disciplines (Discipline[])   -- empty = not a starter
   ```
   An empty-logbook user gets "starter packs" (grouped by discipline +
   region) instead of an empty suggestions panel. Once Phase 11 exists,
   community rating can supplement curation; until then curation is the
   quality signal.
2. **Self-reported level.** Onboarding asks (optionally) "climbed before?
   roughly what grade, per discipline you care about" — stored as a
   *provisional* grade anchor the recommender uses when `current_max` is
   null, clearly labelled provisional and superseded by the first real
   logged climb. Lives in `user_preferences` (below), not on Climb — no
   fake logbook entries.
3. **Minimal `user_preferences` table** (Phase 12 extends it — introducing
   it here keeps onboarding answers out of yet another JSON blob on User):
   ```
   UserPreference (1:1 User)
    - user_id (PK/FK)
    - preferred_disciplines (Discipline[])
    - home_region (supersedes/feeds User.home_region)
    - provisional_grades_json    -- {system: score} self-reported anchors
    - updated_at
   ```

### Where the explainers live — recommendation
**Inline tooltips + one generated help page; no onboarding content walls.**
- A small `GradeHint` tooltip component on every grade picker and dashboard
  grade mention: one sentence per system + the ordinal ladder rendered from
  `grade_ladders.json` (the data already exists — zero new content model).
- One static `/help/grades` page: per-discipline blurb (4–5 short paragraphs
  total, hand-written once) + the full ladders table, linked from tooltips,
  onboarding, and the footer.
- Onboarding itself stays a 3-step form (region → disciplines → optional
  level), not a tutorial. This is the "don't turn it into a content project"
  constraint made structural: all grade content derives from one JSON file
  we already maintain.

### Files touched
New `src/app/onboarding/` (gated on empty logbook at first login), new
`src/app/help/grades/`, tooltip component in the shared UI kit, logbook/
dashboard empty states, `recommender.ts` gains a `getStarterSuggestions`
sibling (or the anchor falls back to the provisional grade — small change),
`prisma/schema.prisma` (+`UserPreference`, +`Route.starter_disciplines`),
seed script.

### Standalone? Yes.
Depends only on shipped Phase 5. Sequenced after 9 so hiking starters exist,
but nothing breaks if it runs before.

---

## 5. Phase 11 — Community v1 (D) — **reverses part of §1; decided via D-1**

§1 explicitly excludes "social feed, following, public profiles" in v1. The
ask is the smallest "see others' trails + reviews + tags" that doesn't
reverse the *spirit* of that line (no feed, no follow graph, no profile
pages). Three shapes, smallest social surface first:

**Option 1 — Route-centric only (recommended).** Nothing about a user's
logbook becomes visible. Instead, users deliberately publish two things
*about a Route*: a **review** (rating + text, knowingly public the way a
guidebook comment is) and **tags**. "Seeing other people's completed trails"
becomes "seeing who reviewed/ticked this route and what they said" on the
route detail page. The private-by-default `Climb` model is untouched — zero
privacy migration risk.

**Option 2 — Option 1 + opt-in public ticks.** Add
`Climb.visibility (private | public)`, default `private`, per-climb opt-in.
A public climb appears (name, date, grade, style — not notes/photos/tracks
unless separately opted) on the route page's tick list. Smallest version
that literally shows "other people's completed trails". Modest privacy
surface: the flag must default private, exports/API must respect it, and
Supabase RLS needs a public-read policy carved out for `visibility=public`
rows only.

**Option 3 — Public-by-default logbooks (UKC model).** Rejected as a
recommendation: it inverts the shipped private-by-default contract, would
require migrating existing climbs with consent, and drags in profile pages
(a public climb implies "whose?" → a browsable person) — that *is* the
non-feature §1 excluded.

**Decision (D-1): Option 2.** Route-centric reviews/tags *and* the per-Climb
opt-in public tick ship together in this phase: `Climb.visibility` is added
(default `private`, per-climb opt-in), and a public climb exposes name, date,
grade, and style on the route page's tick list — never notes, photos, or
tracks. The private-by-default contract for everything not explicitly opted
in is unchanged.

### Data-model deltas (options 1+2)
```
RouteReview
 - id, route_id (FK), user_id (FK)
 - rating (1–5), text (nullable), climbed_on (Date, nullable — optional
   disclosure), created_at, updated_at
 - unique (route_id, user_id)        -- one review per user per route

Tag
 - id, slug, label, kind             -- kind: terrain | character | hazard | logistics
                                     -- curated seed vocabulary (~30 tags), decision D-7

RouteTag
 - route_id (FK), tag_id (FK), user_id (FK), created_at
 - unique (route_id, tag_id, user_id)
 -- chip shows aggregate count; a tag is "on" a route once ≥1 user applies it

Route
 + review_count, avg_rating (cached aggregates, recomputed on write)

Climb                                 -- in scope per D-1 (Option 2)
 + visibility (enum: private | public, default private)
```

### Privacy/schema implications to note explicitly
- A review discloses *that you climbed the route* (and roughly when, if
  `climbed_on` is filled) — the UI should say so at write time.
- `User.displayName` becomes user-facing to others; null display names need
  a fallback and users need to know what name shows.
- Source `quality_rating` (OpenBeta/C2C stars) and community `avg_rating`
  are different signals — keep both columns, display distinctly; the §6
  recommender's `w2` can later blend them (decision left to Phase 12).
- Moderation is trivial at current scale but needs delete-own +
  owner-delete-any from day one.
- All public reads go through Supabase RLS policies, not app-code filtering.

### Files touched
`prisma/schema.prisma` + RLS migration, route detail page (reviews, tags,
tick list), tag chips on route cards/map popups, review/tag write forms,
seed for the tag vocabulary. No recommender changes in this phase.

### Standalone? Yes — and skippable.
Nothing else *requires* it; Phase 12 consumes its tags/ratings when present
and falls back to source quality + area affinity when absent.

---

## 6. Phase 12 — General preference suggestion engine (E)

### Architecture: second module, shared primitives — not a second mode
Recommendation: **new `src/lib/suggestions.ts`, with a new
`src/lib/scoring.ts` extracted from `recommender.ts`** (haversine, grade-fit
window math, area-diversity/visited-set helpers, 0–1 normalisation).
`recommender.ts` refactors to import the primitives — behaviour unchanged,
same tests pass.

Why not a mode inside `recommender.ts`: the two engines have different input
shapes and different reasons to change. §6 is *rule-shaped* — input is an
unmet `BmgRule`, output is "close this gap"; it's an arm of the BMG
dashboard. E is *profile-shaped* — input is (history, preferences), no rule
in sight. Forcing both through one function means every §6 code path grows
`if (mode)` branches. Long-term shape: `scoring.ts` (shared math) ←
`recommender.ts` (BMG gaps) + `suggestions.ts` (preferences); the BMG engine
can later adopt E's community-quality signal through the shared layer
without the engines knowing about each other.

### Preferences data model
Extend Phase 10's table (recommended over a JSON blob on `User` — typed
columns are queryable and self-documenting; a JSON escape hatch stays for
the tunables, mirroring the `recommenderWeightsJson` precedent):
```
UserPreference (extends Phase 10)
 + grade_windows_json        -- {system: {min, max}} preferred grade range
 + preferred_regions (String[])
 + preferred_tag_slugs (String[])          -- meaningful once Phase 11 exists
 + max_trip_length_days (Int?)             -- proxy: route length/pitches band
 + suggestion_weights_json                 -- this engine's weights, distinct
                                           --   from recommenderWeightsJson
```

### How scoring differs from §6's grade-window matching
§6 asks "what's just above your max, matching this rule?" E asks "what looks
like the routes you keep choosing, within what you've said you want?" —
concretely:

1. **Affinity profile from history, not just a max.** Computed per user:
   area affinity (visit frequency with recency decay — an area climbed 5×
   this season outweighs one from 2019), tag affinity (tags on routes you
   completed or reviewed, once 11 exists), discipline mix, and a **grade
   comfort band** per system (e.g. the middle of your recent climbs, not
   the single all-time max — max-anchoring is the right question for
   progression, the wrong one for "what will I enjoy").
2. **Familiarity is a positive signal here.** §6's `w3` deliberately rewards
   *new* areas (portfolio breadth for BMG). E should weight *toward* areas/
   tags you return to, with an explore↔exploit slider so it doesn't become
   an echo chamber (decision D-11 sets the default).
3. **Explicit preferences gate and boost.** Preferred disciplines/regions/
   grade windows act as hard-ish filters; tag preferences and trip length
   act as score terms.
4. Sketch:
   `score = w_g·gradeComfortFit + w_a·areaAffinity + w_t·tagOverlap +
   w_p·prefMatch + w_q·quality(community→source fallback) − w_d·distance`
   — every term 0–1 normalised, same convention as §6, weights editable in
   settings next to the existing w1–w4.

### Sequencing (explicit, as asked)
- **Hard dependency on 9:** with only OpenBeta+C2C, E is a worse §6 — the
  profile engine needs a pool broader than the BMG regions/disciplines to
  say anything the gap engine can't. **Hard dependency on 10** for the
  preferences table it extends.
- **Soft dependency on 11:** tag/rating affinity are its best signals; if
  D is deferred, E ships with grade/area/region/quality terms and the tag
  terms activate when 11 lands.

### Files touched
New `src/lib/suggestions.ts`, new `src/lib/scoring.ts`, `recommender.ts`
(extraction refactor only), settings page (preferences + weights), new
"For you" panel (own page or dashboard section — decision D-10), map layer
alongside the existing amber "suggested" layer, `prisma/schema.prisma`
(UserPreference extension).

---

## 7. Decisions — **resolved 2026-07-19**

| # | Decision | Choice | Applies to |
|---|---|---|---|
| D-1 | Community visibility model | **Option 2** — route-centric reviews/tags **plus** per-Climb opt-in public ticks (`Climb.visibility`, default `private`) | Phase 11 |
| D-2 | Add `hiking` discipline (+ SAC T1–T6 ladder) | **Yes** — clean enum add, no BmgCategory | Phase 9 |
| D-3 | Geometry storage | **GeoJSON `Json` column now**; PostGIS later if spatial queries appear | Phase 8 |
| D-4 | Import formats beyond GPX | **KML only** in Phase 8; **FIT deferred as a future feature** | Phase 8 |
| D-5 | Explainer placement | **Tooltips + `/help/grades` page** generated from `grade_ladders.json` | Phase 10 |
| D-6 | Preferences storage | **`UserPreference` table**, JSON only for weight tunables | Phases 10, 12 |
| D-7 | Tag vocabulary | **Curated seed (~30 tags)** | Phase 11 |
| D-8 | ODbL (OSM-derived routes → derivative database; attribution mandatory, share-alike if redistributed) | **Accept** — personal, non-commercial, attribution shown | Phase 9 |
| D-9 | Overpass region scope | **UK + Alps**, matching §1's stated scope | Phase 9 |
| D-10 | Where E surfaces | **Dedicated page + map layer**; dashboard stays BMG-focused | Phase 12 |
| D-11 | E explore↔exploit default | **Slider, default mildly-familiar** | Phase 12 |

Also carried over from PLAN.md §8: the BMG rule numbers' verification status
is unaffected by all of the above — none of these phases touch `BmgRule`.
