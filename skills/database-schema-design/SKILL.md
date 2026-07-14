---
name: database-schema-design
description: PostgreSQL schema conventions, naming rules, and a forward-only SQL migrations pattern shared by every project in this repo.
used-by: [ecommerce-platform, trail-social-app, property-management, photo-dedupe-tool]
---

# Skill: Database Schema Design (Postgres + Migrations)

## Purpose

Every project stores data the same way: same naming conventions, same column
idioms, same migration workflow. This makes schemas readable across projects
and lets tooling (seed scripts, backup scripts, admin queries) be copy-pasted.

## When to Use

- Starting any project's data model (write the schema in the PROJECT_SPEC
  using these conventions before writing code).
- Adding/changing tables in an existing project (always via a new migration).
- Reviewing a data model — use the checklist at the bottom.

## Inputs

- The entities and relationships from the project's PROJECT_SPEC.md.
- Expected query patterns (what will be filtered/sorted/joined) — indexes
  come from queries, not from guesses.

## Outputs

- `db/migrations/NNNN_description.sql` files (forward-only).
- `db/seed.sql` (or `seed.ts`) with realistic dev data.
- An up-to-date schema section in PROJECT_SPEC.md.

## Default Stack

- **PostgreSQL 16** everywhere — including the photo-dedupe tool if it needs
  `pgvector`; SQLite is an acceptable exception there for a zero-setup CLI.
- **Migrations:** plain SQL files run by a tiny runner (`node-pg-migrate`,
  `dbmate`, or Drizzle Kit if using Drizzle ORM). Plain SQL is the contract;
  the runner is swappable.
- **ORM/query layer:** Drizzle ORM (or Kysely) for typed queries. Avoid
  ORM-generated schemas drifting from SQL — migrations are the source of truth.

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Tables | `snake_case`, plural | `order_items` |
| Columns | `snake_case` | `unit_price_cents` |
| Primary keys | `id uuid DEFAULT gen_random_uuid()` | |
| Foreign keys | `<singular>_id` | `order_id` |
| Timestamps | `created_at`, `updated_at` (`timestamptz`) | |
| Booleans | `is_` / `has_` prefix | `is_active` |
| Money | integer cents, `_cents` suffix | `total_cents` |
| Enum-ish state | `text` + `CHECK` constraint | `status text CHECK (status IN (...))` |
| Join tables | both names, alphabetical | `trail_tags` |
| Indexes | `idx_<table>_<cols>` | `idx_orders_customer_id` |

## Column Idioms

```sql
-- Every table gets these:
id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()

-- Soft delete only where the domain needs history (orders, contracts):
deleted_at timestamptz  -- NULL = live; filter in queries, don't forget indexes

-- Money: never floats.
subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0)

-- State machines: text + CHECK, documented in the spec.
status text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','pending','paid','shipped','cancelled'))
```

Prefer `text` + `CHECK` over Postgres `ENUM` types — `CHECK` constraints can
be altered in one migration; enums can't easily shrink.

## Migrations Pattern

1. **Forward-only.** No down migrations; to undo, write a new migration.
2. **Numbered + descriptive:** `0007_add_wholesale_tiers.sql`.
3. **One concern per migration.** Schema change and backfill can share a file
   only if the backfill is fast; otherwise split.
4. **Never edit an applied migration.** Applied = immutable.
5. **Additive first on live systems:** add nullable column → backfill →
   add `NOT NULL` in a later migration.
6. Migrations run automatically in dev on boot; in prod as an explicit
   deploy step.

See `templates/migration.example.sql` for the canonical file shape.

## Best Practices

- Declare every FK with an explicit `ON DELETE` behavior (`CASCADE` for
  owned children, `RESTRICT` for referenced masters).
- Index every FK column you join or filter on; add composite indexes to
  match real query patterns (`(customer_id, created_at DESC)`).
- Use `citext` for emails/usernames; `numeric` only for non-money decimals
  (e.g., trail distance km).
- `jsonb` is for genuinely schemaless data (webhook payloads, provider
  responses) — not a way to avoid designing columns.
- Keep a `updated_at` trigger (or set it in the app layer consistently —
  pick one per project and note it in the spec).
- Seed data should exercise every status value and role.

## Review Checklist

- [ ] Every table: `id`, `created_at`, `updated_at`.
- [ ] No floats for money; cents integers everywhere.
- [ ] All FKs have `ON DELETE` and an index.
- [ ] All state columns have `CHECK` constraints and appear in the spec's
      state-machine notes.
- [ ] Unique constraints for natural keys (email, SKU, slug).
- [ ] No applied migration was edited.

## Used By

All four projects. The photo-dedupe tool may substitute SQLite for a
zero-dependency local install; keep the same naming conventions.
