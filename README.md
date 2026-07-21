# Ascent Ledger

Personal climbing logbook and BMG-standard progress tracker. See
`docs/PLAN.md` for the full product spec and phased roadmap. The current app
includes Phases 0–12, including open trail ingestion, onboarding, auditable
starter packs, private-by-default route community features, and the separate
preference-driven “For you” engine.

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com) v4 + [shadcn/ui](https://ui.shadcn.com)
- [Prisma](https://prisma.io) 7 → Postgres (Supabase)
- [Supabase Auth](https://supabase.com/docs/guides/auth) (email/password) via `@supabase/ssr`
- Hosted on [Vercel](https://vercel.com) + [Supabase](https://supabase.com)

## Getting started

1. Create a [Supabase](https://supabase.com/dashboard) project.
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — pooled Postgres connection string (port 6543)
   - `DIRECT_URL` — direct connection string (port 5432, used by Prisma Migrate; optional)
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Project Settings → API
   - optional route-ingestion variables are documented in
     [`docs/ROUTE_INGESTION.md`](docs/ROUTE_INGESTION.md)
   - `OPENROUTESERVICE_API_KEY` — enables snap-to-trail drawing with the
     openrouteservice hiking profile
   - `OPENROUTESERVICE_BASE_URL` — optional override for a proxy or
     self-hosted openrouteservice instance
3. Install, migrate, and run:

```bash
npm install                 # also runs `prisma generate`
npx prisma migrate deploy   # applies prisma/migrations to your database
npm run db:seed             # BMG rules
npm run db:seed:starters    # idempotent open-source starter routes
npm run db:seed:tags        # idempotent curated route-tag vocabulary
npm run dev
```

For raw Climb track archives, create a public Supabase Storage bucket named
`gpx-tracks` with authenticated INSERT/DELETE policies restricted to paths
starting with the user's auth UUID. Both GPX and KML files use this existing
bucket name.

The route editor's **Follow trails** mode snaps ordinary clicks to mapped
trails within 75 metres and routes between them. Shift-click places an exact
off-trail waypoint; dragging a snapped waypoint also converts it to an
off-trail waypoint. Routing failures fall back to a straight section without
discarding the user's point. The openrouteservice key is read only by the
authenticated `/api/trail-route` handler and is never included in browser code.

Open <http://localhost:3000>. Sign up, confirm your email, and you land on
the dashboard — from there, open the logbook at `/logbook` to start logging
climbs.

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server                      |
| `npm run build`     | Production build                |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint                          |
| `npm test`          | Vitest unit tests               |
| `npm run backfill:tracks -- --dry-run` | Parse existing `gpx_track_url` files without writing |
| `npm run backfill:tracks` | Populate missing Climb `path_geojson` values |
| `npm run sync:routes -- --source=osm_geofabrik --shard=uk-england --max=200` | Run a bounded, resumable UK extract import |
| `npm run sync:routes -- --source=osm_geofabrik --shard=rotate --max=500` | Progress through one European shard |
| `npm run sync:routes -- --health` | Report recent import/checkpoint health |
| `npm run db:seed:starters` | Upsert the verified starter-route pack and flags |
| `npm run db:seed:tags` | Upsert the curated terrain/character/hazard/logistics tags |
| `npx prisma generate` | Regenerate the Prisma client (into `src/generated/prisma`, gitignored) |

The ingestion subsystem provides rotating Geofabrik PBF coverage for every
registered European country, checkpointed Camptocamp/OpenBeta traversal,
official UK trail overlays, and pluggable national adapters. Each source/shard/
activity has an independent cursor and run log, so capped and failed runs resume
safely and cannot mark unseen routes stale. See
[`docs/ROUTE_INGESTION.md`](docs/ROUTE_INGESTION.md) for the source/licence
matrix, configuration, deduplication precedence, CI rotation, and rejected or
permission-gated sources.

Imported representations are retained as auditable source records linked to a
single canonical route. Route details and the map display all applicable
licences/attributions and distinguish official from calculated values.

New users complete a three-step `/onboarding` flow. Its preference row is the
completion signal; optional self-reported grades are provisional and are used
only until a real climb exists in that grade system. Existing users are
backfilled as complete by the Phase 10 migration. The starter seed is audited
in `docs/starter_routes.seed.json`; it never creates `Climb` rows.

Community reviews and route tags are visible to other users, while climbs
remain `private` by database default. A climb appears in route-centric public
ticks only after explicit per-climb opt-in, and the public projection contains
only display name/fallback, route name, date, grade, and ascent style. Supabase
RLS restricts writes to owners; private preferences and sensitive climb fields
are never included in anonymous grants. Run the Phase 11 migration before the
tag seed so the enum and tables exist.

`/for-you` scores the route database from recency-weighted completed-climb
history and explicit settings. Grade comfort uses a recent weighted band rather
than an all-time maximum; community rating is preferred with source quality as
fallback; completed routes are excluded. The default explore level is `0.35`
(mildly familiar). Route distance and pitches provide the documented trip-day
proxy (25 km or eight pitches per day). All terms are normalised to 0–1 and
ties are ordered by route name then ID. These settings and weights are stored
separately from the BMG gap recommender, whose dashboard behavior is unchanged.

## Project layout

- `src/app/` — App Router pages: landing, `(auth)/sign-in`, `(auth)/sign-up`,
  `auth/callback` + `auth/confirm` (email confirmation handlers), `dashboard`,
  and `logbook` (list / new / edit, with server actions in
  `logbook/actions.ts`)
- `src/proxy.ts` — Supabase session refresh + auth gating for `/dashboard`
  and `/logbook` (Next.js 16 proxy, formerly middleware)
- `src/lib/supabase/` — browser/server Supabase clients
- `src/lib/auth.ts` — `requireUser()`: session → `User` row (upserted on
  first visit); every logbook query is scoped by `user_id`
- `src/lib/prisma.ts` — Prisma client singleton (pg driver adapter)
- `prisma/schema.prisma` + `prisma.config.ts` — `User`/`Climb`/`Area` models
  and CLI config; connection comes from `DATABASE_URL`; migrations in
  `prisma/migrations/`
- `.github/workflows/ci.yml` — typecheck + lint on push/PR

## Deploying to Vercel

1. Import the GitHub repo at <https://vercel.com/new> (framework preset:
   Next.js, defaults are fine — `npm install` triggers `prisma generate`).
2. Add the required env vars from `.env.example` in Project → Settings →
   Environment Variables.
3. In Supabase: Authentication → URL Configuration, set the **Site URL** to
   your Vercel URL and add `https://<your-app>.vercel.app/auth/callback` to
   the redirect allow-list.
4. Deploy.
