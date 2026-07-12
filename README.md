# Ascent Ledger

Personal climbing logbook and BMG-standard progress tracker. See
`docs/PLAN.md` (on the plan branch) for the full product spec and phased
roadmap — this repo currently contains the **Phase 0 scaffold**.

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
3. Install and run:

```bash
npm install       # also runs `prisma generate`
npm run dev
```

Open <http://localhost:3000>. Sign up, confirm your email, and you should
land on the (placeholder) dashboard at `/dashboard`.

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Dev server                      |
| `npm run build`     | Production build                |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint                          |
| `npx prisma generate` | Regenerate the Prisma client (into `src/generated/prisma`, gitignored) |

## Project layout

- `src/app/` — App Router pages: landing, `(auth)/sign-in`, `(auth)/sign-up`,
  `auth/callback` + `auth/confirm` (email confirmation handlers), `dashboard`
  (placeholder, requires a session)
- `src/proxy.ts` — Supabase session refresh + `/dashboard` gating
  (Next.js 16 proxy, formerly middleware)
- `src/lib/supabase/` — browser/server Supabase clients
- `src/lib/prisma.ts` — Prisma client singleton (pg driver adapter)
- `prisma/schema.prisma` + `prisma.config.ts` — schema (no models yet —
  Phase 1) and CLI config; connection comes from `DATABASE_URL`
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
