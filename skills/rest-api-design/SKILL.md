---
name: rest-api-design
description: Consistent REST API structure across projects — URL shape, response envelopes, errors, pagination, filtering, versioning, and validation conventions.
used-by: [ecommerce-platform, trail-social-app, property-management]
---

# Skill: REST API Design

## Purpose

Every backend in this repo speaks the same dialect of REST. A developer (or
frontend) that knows one project's API knows them all: same URL shapes, same
error format, same pagination, same auth headers.

## When to Use

- Designing any new endpoint — check it against these conventions first.
- Building frontend API clients — one shared client wrapper works everywhere.

Not needed for the photo-dedupe tool unless it grows a local web UI (then use
the same conventions for its local HTTP API).

## Inputs

- Resources and actions from the project's PROJECT_SPEC.md.
- The roles/permissions matrix from the `auth` skill.

## Outputs

- A route table in the PROJECT_SPEC.md (method, path, permission, purpose).
- Zod (or equivalent) schemas per endpoint for request validation.
- Optionally an OpenAPI file generated from those schemas.

## Default Stack

- **Fastify** (Node/TypeScript) — schema-first validation, fast, good DX.
  Express is an acceptable substitute; conventions are framework-agnostic.
- **Zod** for validation, `fastify-type-provider-zod` to wire it in.
- JSON only. `Content-Type: application/json` in and out.

## URL & Resource Conventions

```
GET    /api/v1/products              # list (filter via query params)
POST   /api/v1/products              # create
GET    /api/v1/products/:id          # read
PATCH  /api/v1/products/:id          # partial update (prefer over PUT)
DELETE /api/v1/products/:id          # delete (soft-delete where domain requires)

GET    /api/v1/orders/:id/items      # nested only one level, only for ownership
POST   /api/v1/orders/:id/cancel     # state transitions as verb sub-resources
```

- Plural nouns, kebab-case paths (`/wholesale-accounts`), no trailing slash.
- IDs are UUIDs. Never expose serial integers.
- Version prefix `/api/v1/` from day one; bump only for breaking changes.
- State transitions (`cancel`, `approve`, `publish`) are POSTs to a verb
  sub-resource — not `PATCH status`. This keeps transition rules server-side.

## Response Envelope

```jsonc
// Single resource
{ "data": { "id": "…", "name": "…" } }

// List
{
  "data": [ … ],
  "meta": { "page": 2, "perPage": 25, "total": 143, "totalPages": 6 }
}

// Error (every non-2xx, no exceptions)
{
  "error": {
    "code": "VALIDATION_ERROR",        // stable, machine-readable, SCREAMING_SNAKE
    "message": "email must be a valid email address",  // human-readable
    "details": [ { "field": "email", "issue": "invalid_format" } ]  // optional
  }
}
```

Stable error codes to reuse: `VALIDATION_ERROR` (400), `UNAUTHENTICATED`
(401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
`RATE_LIMITED` (429), `INTERNAL` (500).

## Pagination, Filtering, Sorting

- Page-based by default: `?page=1&perPage=25` (max `perPage=100`).
- Cursor-based (`?cursor=…&limit=…`) only for feeds that grow fast
  (trail app activity feed).
- Filters are flat query params: `?status=pending&categoryId=…`.
- Sorting: `?sort=-created_at,name` (leading `-` = descending).
- Always define a default sort so pagination is stable.

## Best Practices

- Validate **every** input at the edge (params, query, body) with Zod;
  handlers receive typed, trusted data.
- 404 vs 403: return 404 for resources the caller shouldn't know exist.
- Timestamps in responses are ISO-8601 UTC (`2026-07-10T12:00:00Z`).
- Money in responses is integer cents plus a `currency` field.
- Idempotency: accept an `Idempotency-Key` header on POSTs that create
  payments/orders (see `payments-billing` skill).
- Log every request with a request ID; return it as `X-Request-Id`.
- Rate-limit unauthenticated endpoints by IP, authenticated by user.
- Write the route table before writing handlers.

## Pitfalls

- Ad-hoc error shapes per endpoint — the frontend error handler should be
  written once, ever.
- `PATCH status: 'approved'` instead of a transition endpoint — invariants
  leak to clients.
- Deep nesting (`/a/:id/b/:id/c/:id`) — flatten and filter instead.
- Returning arrays at the top level (breaks envelope, blocks adding `meta`).

## Used By

- **ecommerce-platform** — full storefront + admin API.
- **trail-social-app** — user-facing API, feed uses cursor pagination.
- **property-management** — small API, same conventions keep it boring.
