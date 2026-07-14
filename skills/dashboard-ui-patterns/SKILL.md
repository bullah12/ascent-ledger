---
name: dashboard-ui-patterns
description: Admin/dashboard frontend patterns — app shell layout, data tables, forms, detail pages, stat cards, and state management conventions shared across all admin UIs.
used-by: [ecommerce-platform, trail-social-app, property-management]
---

# Skill: Dashboard UI Patterns

## Purpose

Every project needs an admin/dashboard UI, and they should all feel like the
same product family: same shell, same table behavior, same form patterns.
Build these primitives once, copy them between projects (or extract a shared
package later — copy first, extract on the third use).

## When to Use

- Ecommerce admin (products, orders, wholesale approvals).
- Property management dashboard (the entire app is a dashboard).
- Trail app moderation/admin views.
- Any internal tool UI, including a future photo-dedupe review web UI.

## Inputs

- The screens list from the project spec (map each to a pattern below).
- The API (built with `rest-api-design`) — these patterns assume its
  envelopes and pagination.

## Outputs

- An app shell + a set of screens composed from the five core patterns.
- A typed API client wrapper shared by all screens.

## Default Stack

| Concern | Default | Notes |
|---|---|---|
| Framework | **React 18 + TypeScript + Vite** | SPA is fine for auth-gated dashboards; Next.js only if SEO pages needed (ecommerce storefront) |
| Components | **shadcn/ui + Tailwind CSS** | Owned code, consistent look across projects |
| Server state | **TanStack Query** | Caching, invalidation, optimistic updates |
| Tables | **TanStack Table** (headless) + shared `<DataTable>` wrapper | |
| Forms | **react-hook-form + Zod** (same schemas as the API where possible) | |
| Routing | React Router (or TanStack Router) | |
| Charts | Recharts | Income/expense charts, sales graphs |

## The App Shell

```
┌────────────┬──────────────────────────────────────┐
│            │ Topbar: page title · search · user menu │
│  Sidebar   ├──────────────────────────────────────┤
│  (nav      │                                      │
│   groups,  │   Page content (max-w container)     │
│   active   │                                      │
│   state,   │                                      │
│   badge    │                                      │
│   counts)  │                                      │
└────────────┴──────────────────────────────────────┘
```

- Sidebar nav is config-driven: `[{ label, icon, path, permission, badgeCount? }]`
  — items filter by the user's permissions (auth skill), badges show queue
  sizes (pending approvals, unread notifications, failed jobs).
- Mobile: sidebar collapses to a drawer; tables gain horizontal scroll.
- Global toaster for mutation results; top-level error boundary.

## The Five Core Patterns

Nearly every dashboard screen is one of these — name them in the spec:

1. **List screen** — `<DataTable>` + filter bar + primary "New X" action.
   Server-side pagination/sort/filter mirroring API query params; URL holds
   the state (shareable, refreshable). Row click → detail. Empty state with
   a call to action; skeleton rows while loading.
2. **Detail screen** — header (title, status badge, action buttons) +
   tabbed sections for related data (an Order: items / payments / history;
   a Property: contracts / income / expenses / reminders). Tabs lazy-load
   their queries.
3. **Form screen (create/edit)** — react-hook-form + Zod; inline field
   errors from the API's `VALIDATION_ERROR.details`; dirty-state guard on
   navigation; disable submit while pending. Prefer a route (not a modal)
   for anything > 4 fields.
4. **Stats row** — small cards over a list/overview page: label, value,
   delta vs previous period, optional sparkline. Numbers come from
   dedicated `/stats` endpoints — never computed client-side from page 1
   of a list.
5. **Review queue** — a list pattern variant for human-judgment flows
   (wholesale approvals, photo-dupe review): keyboard-friendly
   approve/reject, optimistic removal from the queue, undo toast.

## Conventions

- **All server state through TanStack Query**; no server data in
  useState/Redux. Query keys mirror API paths: `['orders', { page, status }]`.
- Mutations invalidate the affected list + detail keys; use optimistic
  updates only for small, reversible actions (mark-read, approve).
- Dates render in the user's locale/timezone via one shared `<DateTime>`
  component; money via one `<Money cents currency>` component (API sends
  cents — see `rest-api-design`).
- Status badges use one shared color map per status vocabulary, defined
  next to the API's `CHECK` constraint values.
- Loading = skeletons for initial load, subtle spinners for refetch;
  destructive actions get a confirm dialog naming the object ("Delete
  product 'Blue Hoodie'?").
- Every list screen ships with: empty state, error state, loading state.
  Build them first, not last.

## Pitfalls

- Client-side pagination on server data — breaks past a few hundred rows.
- Modals for complex forms — use routes; modals lose state and can't be linked.
- Bespoke fetch logic per screen — the typed API client + Query is the only
  data path.
- Copying shadcn components between projects *with local tweaks* and losing
  track — keep a CHANGES.md note per project until you extract a shared package.

## Used By

- **property-management** — the whole product is this skill (detail-page tabs pattern is the spec).
- **ecommerce-platform** — admin: products, orders, inventory, approval queue, stats.
- **trail-social-app** — admin/moderation; user-facing app shares form/query conventions.
