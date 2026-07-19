# Prompts for Fable — Ascent Ledger build

How to use this file: paste **one phase at a time**, in order, as a new
message to Fable in the *same* project/session so it can see prior work.
Wait for each phase to be confirmed working before sending the next — don't
queue multiple phases at once. This keeps each request small (cheap) and
lets you catch a wrong turn after one phase instead of five.

Two rules that save the most tokens across a multi-phase build:
1. **Point at the doc, don't paste the doc.** Every prompt below assumes
   `docs/PLAN.md` is already in the repo Fable is working in. Reference
   section numbers instead of re-explaining the product each time.
2. **Cap the ask.** Each prompt below has an explicit scope line and an
   explicit "do not" line. An AI builder left open-ended will happily
   generate 3x the code you asked for (extra settings pages, premature
   polish) — burning tokens and creating stuff you now have to review.

---

## Phase 0 — Kickoff prompt (paste first)

```
Read docs/PLAN.md in full — it's the spec for a personal climbing logbook
and BMG-standard progress tracker called "Ascent Ledger."

Scope for this phase (Phase 0 only, see PLAN.md §7):
- Scaffold a Next.js 14 App Router project in TypeScript with Tailwind CSS
  and shadcn/ui installed.
- Set up Prisma with a Postgres connection (I'll provide a Supabase
  connection string as an env var — use DATABASE_URL, don't hardcode one).
- Set up Supabase Auth scaffolding (email/password) but no protected pages
  yet — just the sign-in/sign-up UI and session handling.
- One placeholder authenticated page ("Dashboard — coming soon") to prove
  the auth flow works end to end.
- Basic CI: a GitHub Actions workflow that runs typecheck + lint on push.
- Deploy to Vercel (or tell me the exact steps if you can't do it yourself).

Do NOT: build the Climb/Route/BmgRule data models yet, don't build any
logbook UI, don't pick a maps library yet. Those are later phases.

When done, give me: (1) a short summary of what was created, (2) any env
vars I need to set myself, (3) confirm typecheck/lint/build all pass.
```

---

## Phase 1 — Auth data model + manual logbook CRUD

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 1). Phase 0 is done —
scaffold, auth, and CI are working.

Scope:
- Add Prisma models for User, Climb, Area exactly as specified in
  docs/PLAN.md §3, EXCEPT: leave `grade_normalised_score` on Climb as
  nullable/unused for now (no grade engine yet — that's Phase 2). Store
  grade as free text (`grade_raw`) only.
- Build logbook CRUD UI: list view (table, sortable by date), add form,
  edit form, delete with confirmation. Fields: discipline, date, route
  name (free text — no Route table yet), grade_raw, ascent_style, area
  (free text for now), notes.
- Logbook is private per-user (row-level security or query-scoped by
  user_id — your call, but state which you used).
- Basic empty/loading/error states. No need for pagination yet at this
  scale (assume < 500 rows).

Do NOT: touch the grade engine, BmgRule tables, maps, or any external
route database. Do NOT add photo upload yet (Phase 6).

When done: short summary + confirm typecheck/lint/build pass + a couple
sentences on how you scoped users (RLS vs query-scoping).
```

---

## Phase 2 — Grade engine + BMG rules dashboard

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 2, §4 for the rules
engine algorithm). Phase 1 logbook CRUD is done.

Scope:
- Build one grade-ladder JSON per discipline's grade system (per PLAN.md
  §3 "Grade normalisation approach") covering: UK trad adjectival+tech,
  Scottish winter (I–XI + M grades), WI ice grades, Alpine overall grades
  (F through ED), ski touring difficulty scale. Compute
  `grade_normalised_score` on Climb create/edit from `grade_raw` +
  `grade_system` using these ladders.
- Add BmgCategory and BmgRule Prisma models per PLAN.md §3. Seed BmgRule
  from the attached bmg_rules.seed.json [I WILL PASTE THIS — see note
  below] rather than inventing numbers yourself.
- Implement the rules engine exactly as pseudocoded in PLAN.md §4.
- Build the dashboard: 4 category cards (Rock/Winter/Alpine/Ski Touring),
  each with an overall progress bar, expandable to show each sub-rule with
  its own progress bar and "X more needed."

IMPORTANT: before you seed BmgRule, I'll paste the verified rule numbers
as a JSON list (see docs/PLAN.md's "VERIFY BEFORE BUILDING RULES" note) —
use exactly those, don't infer thresholds from anywhere else.

Do NOT: build the recommender or route database yet (Phases 4-5). Do NOT
let the grade ladder work block the dashboard — if a logged climb's grade
doesn't parse cleanly, show it as "ungraded" on the dashboard rather than
erroring.

When done: short summary + confirm build passes + list which grade
systems' ladders you actually implemented vs stubbed.
```

*(Before sending Phase 2, fill in and attach the verified rule thresholds —
see the callout at the top of `docs/PLAN.md`. Don't let Fable guess them.)*

---

## Phase 3 — Route database schema + map + CSV import

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 3). Phase 2 grade engine
and BMG dashboard are done.

Scope:
- Add Route and RouteImportLog Prisma models per PLAN.md §3.
- Add a "link this climb to a Route" step in the existing logbook forms:
  simple search-by-name against the Route table, optional (climbs can stay
  unlinked/free-text).
- Add a manual "Add a Route" form (name, area, discipline, grade,
  lat/lng, description) — this is how the route DB grows before Phase 4's
  importers exist.
- Map view: MapLibre GL JS + free OSM tiles, plot the user's logged climbs
  that have lat/lng (via linked Route), clustered by area at low zoom.
- CSV import for the logbook: a documented column format, upload UI,
  validation with a per-row error report (don't silently drop bad rows).

Do NOT: build the OpenBeta/Camptocamp importers yet (Phase 4). Do NOT
build the recommender (Phase 5). Keep the map read-only — no click-to-add
route creation from the map yet.

When done: short summary + confirm build passes + sample of the CSV
column format you implemented so I can prep my import file.
```

---

## Phase 4 — External route data importers

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 4, §5 for data-source
strategy — read §5 carefully, it has legal/ToS constraints).

Scope:
- Build a pluggable importer interface per PLAN.md §5 point 4
  (`/lib/importers/<source>.ts`).
- Implement the OpenBeta importer (rock routes) and the Camptocamp c2c
  importer (alpine/ski touring/winter mountaineering routes), both using
  their public APIs only — no scraping of UKC/UKH/any ToS-restricted site.
- Store `external_source`/`external_url`/`external_id`/`last_synced_at` on
  every imported Route per PLAN.md §5 point 3.
- Scheduled sync: a script runnable via GitHub Actions cron (weekly),
  writing to RouteImportLog (routes added/updated/errors) each run.
- Fuzzy-match existing free-text Climb entries to newly-imported Routes by
  name+area, and surface matches to the user as an optional "link
  suggestion" they can accept/reject (don't auto-link silently).

Do NOT: scrape UKClimbing, UKHillwalking, Mountain Project, or any site
whose ToS restricts bulk data reuse — PLAN.md §5 explains why. If you hit
API rate limits or auth requirements I haven't provided credentials for,
stop and tell me rather than working around them.

When done: short summary + confirm sync ran successfully at least once
against real API data + counts of routes imported per source.
```

---

## Phase 5 — Recommendation engine

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 5, §6 for the algorithm).
Phases 2 (rules engine) and 4 (route DB) are done.

Scope:
- Implement the recommender exactly as pseudocoded in PLAN.md §6, with the
  scoring weights (w1-w4) as an editable settings object (simple key-value
  UI is fine, doesn't need to be fancy).
- Add a "Suggested routes" panel per BMG sub-rule on the dashboard (Phase
  2's UI), showing top N candidates with route name/area/grade and a
  "why this route" one-liner (e.g. "closest grade step up from your
  current V,5 max").
- Show suggested routes as a distinct marker style on the Phase 3 map,
  toggleable on/off per category.

Do NOT: add machine learning of any kind — this is intentionally a rules-
based scorer per §6, keep it simple and debuggable. Do NOT change the
BmgRule schema from Phase 2 unless you hit a concrete blocker — tell me
first if you think you need to.

When done: short summary + confirm build passes + a couple of example
recommendations for a sample logbook so I can sanity-check the ranking.
```

---

## Phase 6 — Polish (photos, GPX, PWA, mobile)

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 6).

Scope:
- Photo upload on Climb (Supabase Storage), shown in logbook detail view
  and as a small thumbnail strip.
- GPX file upload/display on the map for a Climb's approach/route track.
- PWA setup: installable, offline access to the user's own already-loaded
  logbook data (read-only offline — don't try to build offline write/sync,
  that's out of scope).
- Mobile layout pass on: logbook list, add/edit forms, dashboard, map.

Do NOT: add offline write support, don't add push notifications, don't
add a native app wrapper — PWA only, per PLAN.md's non-features list.

When done: short summary + confirm build passes + note any mobile
viewport issues you couldn't fully resolve.
```

---

## Phase 7 — Scottish winter seed data + tuning + e2e tests

```
Continuing Ascent Ledger (docs/PLAN.md §7 Phase 7). This is the final
planned phase.

Scope:
- Seed a curated set of classic Scottish winter routes I'll provide as a
  CSV (name/area/grade/lat-lng) — load via the existing manual-add path
  or a small seed script, your call.
- Playwright e2e test covering the core flow: sign up → log 3-4 climbs
  across disciplines → view dashboard progress → view a recommendation →
  see it on the map.
- Pass on the recommendation scoring weights (§6) using my actual logbook
  data once I've imported it, and adjust defaults if the top suggestions
  look obviously wrong (e.g. suggesting routes on the wrong continent).

Do NOT: add new features not already specced in docs/PLAN.md — this phase
is stabilisation, not scope expansion. If you find a gap in the plan, flag
it to me instead of improvising a solution.

When done: short summary + e2e test results + any recommendation-weight
changes you made and why.
```

---

## Phase 8 — Planning prompt (map tracing, ingestion, onboarding, community, general suggestions)

Unlike Phases 0-7, this one asks Fable to *propose a plan* (new PLAN.md
phase(s), data-model deltas, sequencing, open questions) rather than write
code — review its answer, decide the open questions (especially D's
public/private question), then turn the agreed phases into their own
implementation prompts in this same file.

```
Continuing Ascent Ledger. Phases 0–7 (docs/PLAN.md §7) are shipped: auth,
logbook CRUD, grade engine + BMG rules dashboard, Route/RouteImportLog
tables, MapLibre map view, OpenBeta + Camptocamp importers, rule-based
recommender (src/lib/recommender.ts), GPX/photo upload, PWA.

Re-read docs/PLAN.md in full first, especially §3 (data model), §5 (route
data-source strategy), §6 (recommender algorithm), and the "Explicit
non-features (v1)" list in §1 — one of the asks below directly reverses an
item on that list, flagged explicitly.

I want to extend the product in five directions. For THIS message, do NOT
write any code or migrations — I want a written plan only: new PLAN.md
phase(s) (in the existing §7 table format), the data-model deltas each
needs, which existing modules/files each touches, sequencing/dependencies,
and open questions for me to decide. Treat it like a Phase 8+ proposal I
can review and then feed back to you one phase at a time, same as
Phases 0-7 were.

A) Map-based trail drawing + auto-import
   - Let a user trace a route/trail directly on the existing MapLibre map
     (src/app/map/map-view.tsx) when adding a Climb or a Route, saving the
     traced line as geometry (not just a lat/lng point).
   - Also let them import a track (GPX, and whatever else is reasonable —
     e.g. KML) and have it auto-plot instead of tracing by hand.
   - Propose: what geometry field/type this needs on Route (and/or Climb),
     how it relates to the gpx_track_url field that already exists, and
     which drawing library/approach fits MapLibre (don't just say
     "Leaflet" — we already committed to MapLibre in §2).

B) Broaden the route/trail ingestion engine
   - The importer pattern (src/lib/importers/{openbeta,camptocamp,sync,types}.ts)
     currently covers rock (OpenBeta) and alpine/ski/winter (Camptocamp).
     Propose additional open/permissive-licence sources worth adding as new
     adapters to that same pluggable pattern — e.g. OSM/Overpass for hiking
     trails, national park or trail-agency open datasets, or similar — so
     candidate pools (for both the BMG recommender in §6 and the new
     general engine in E below) are bigger and more diverse, especially for
     hiking/trail-style routes which aren't well covered by the current two
     sources.
   - Apply the same §5 legal/ToS bar to any new source you propose (open
     licence only, attribution + last_synced_at, no bulk-scraping ToS-
     restricted sites) — call out any source you considered and rejected.

C) Fix cold-start / onboarding
   - Right now a brand-new user with an empty logbook gets nothing useful:
     the recommender needs existing climbs to establish "current_max"
     (§6), and there's no beginner-facing explanation of grades, route
     types, or disciplines anywhere in the UI.
   - Propose: a no-history recommendation path (e.g. popular/curated
     starter routes per discipline/region), plus where a lightweight
     "what does this grade/route type mean" explainer belongs (onboarding
     flow vs. inline tooltips vs. a help page) without turning this into a
     big content project.

D) Community layer: public trails, reviews, tags — reverses a stated
   non-feature
   - I want users to be able to view other people's completed trails/routes
     and how they reviewed them, and to have tags/keywords on a trail that
     act as an at-a-glance summary.
   - §1 currently says v1 explicitly excludes social feed / following /
     public profiles. Don't just override that — present it as a decision
     point: what's the smallest version of "view others' trails + reviews +
     tags" that doesn't require a full social feed (e.g. public-by-default
     vs. opt-in-public Routes/Climbs, a Review/Rating model tied to Route
     rather than to a user's private Climb log, a Tag/keyword model on
     Route). Flag any privacy or schema implications for the existing
     private-by-default Climb model.

E) General history + preference-based suggestion engine (distinct from the
   BMG-gap recommender in §6)
   - §6's recommender only exists to close a specific unmet BMG rule — it
     has no concept of a standing user profile. I want a second, broader
     engine: given (1) the routes/trails a user has already completed
     (grades, disciplines, areas, and — once D exists — tags they engaged
     with) and (2) explicit preferences a user sets somewhere (e.g.
     preferred disciplines, grade range, regions, terrain/tag preferences,
     trip length), suggest routes/trails that fit — independent of whether
     the user cares about BMG progress at all.
   - Propose: does this live as a second mode inside src/lib/recommender.ts,
     or a separate module (e.g. src/lib/suggestions.ts) that the BMG
     recommender can eventually share scoring primitives with? What's the
     minimal user-preferences data model (a settings table/JSON, similar
     in spirit to the existing recommenderWeightsJson on User)? How does
     "based on completed routes" scoring differ from simple grade-window
     matching already in §6 — e.g. should it weight toward areas/tags the
     user returns to, not just grade proximity?
   - This depends on B (bigger candidate pool) to be useful, and benefits
     from D's tags for preference matching — say so explicitly if your plan
     sequences it after either.

For each of A-E, tell me: does it stand alone as its own phase, or does it
depend on another? Suggest a phase ordering, and where E and the existing
§6 recommender should end up relative to each other architecturally.

Do NOT: implement anything yet, don't touch existing Phase 0-7 schemas or
code, don't unilaterally decide the public/private question in D — give me
the options and your recommendation, not a fait accompli.

When done: give me the proposed phase table rows (append-style, like §7),
the data-model deltas per phase, and the open decisions you need from me
before any phase becomes buildable.
```

---

## General prompting tips for the rest of the build

- If Fable's response for a phase seems to have drifted into scope from a
  later phase, say so explicitly and ask it to revert/hold that part — cheaper
  than letting it compound into the next prompt.
- When you hit a bug between phases, describe it as its own short message
  ("logbook add form throws X on submit") rather than re-pasting a whole
  phase prompt — Fable already has the context.
- Keep `docs/PLAN.md` as the single edit point if your requirements change
  mid-build (e.g. you decide to drop ski touring). Edit the doc, then tell
  Fable "PLAN.md §X changed, re-read it" instead of re-describing the change
  inline.
