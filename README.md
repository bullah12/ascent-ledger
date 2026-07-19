# Ascent Ledger

Personal climbing logbook and BMG-standard progress tracker. See
`docs/PLAN.md` for the full product spec and phased roadmap. The current app
includes Phases 0–10, including open trail ingestion, onboarding, and
auditable starter packs.

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
   - `NATURESCOT_TRAILS_GEOJSON_URL` — optional HTTPS URL for an
     official/licensed Scotland's Great Trails GeoJSON distribution
3. Install, migrate, and run:

```bash
npm install                 # also runs `prisma generate`
npx prisma migrate deploy   # applies prisma/migrations to your database
npm run db:seed             # BMG rules
npm run db:seed:starters    # idempotent open-source starter routes
npm run dev
```

For raw Climb track archives, create a public Supabase Storage bucket named
`gpx-tracks` with authenticated INSERT/DELETE policies restricted to paths
starting with the user's auth UUID. Both GPX and KML files use this existing
bucket name.

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
| `npm run sync:routes -- --max=200` | Run each configured route importer with a per-source cap |
| `npm run db:seed:starters` | Upsert the verified starter-route pack and flags |
| `npx prisma generate` | Regenerate the Prisma client (into `src/generated/prisma`, gitignored) |

The weekly sync keeps OpenBeta and Camptocamp compatibility and adds bounded
OpenStreetMap/Overpass UK + Alps queries, Natural England National Trails,
Natural Resources Wales National Trails, and the optional NatureScot loader.
Each source writes an independent `RouteImportLog`, so a temporary outage does
not abort later adapters. NatureScot publishes a route catalogue but no stable
machine-readable feature endpoint; configure only an official distribution and
do not substitute scraped or proprietary route data.

Imported records retain stable source IDs and links. Route details and the map
display the applicable licence and attribution, including “© OpenStreetMap
contributors” for OSM-derived geometry. Source-specific terms remain
authoritative: OSM data is ODbL, Natural England and Natural Resources Wales
data is OGL with the displayed agency/Ordnance Survey notices, OpenBeta is CC0,
and Camptocamp content is CC BY-SA 3.0.

New users complete a three-step `/onboarding` flow. Its preference row is the
completion signal; optional self-reported grades are provisional and are used
only until a real climb exists in that grade system. Existing users are
backfilled as complete by the Phase 10 migration. The starter seed is audited
in `docs/starter_routes.seed.json`; it never creates `Climb` rows.

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
2. Add the four env vars from `.env.example` in Project → Settings →
   Environment Variables.
3. In Supabase: Authentication → URL Configuration, set the **Site URL** to
   your Vercel URL and add `https://<your-app>.vercel.app/auth/callback` to
   the redirect allow-list.
4. Deploy.
