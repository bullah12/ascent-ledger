---
name: auth
description: User accounts, sessions, roles, and permissions. Covers registration/login, session vs token auth, role-based access control (RBAC), and account-approval workflows.
used-by: [ecommerce-platform, trail-social-app, property-management]
---

# Skill: Auth (Accounts, Roles & Permissions)

## Purpose

Provide one consistent way to handle identity across projects: who a user is
(authentication), what they may do (authorization), and how account state is
managed (invited, pending approval, active, suspended). Every multi-user
project in this repo should implement auth the same way so code, tests, and
mental models transfer between projects.

## When to Use

- Any project with user accounts (ecommerce, trail app, property management).
- When a project needs more than one class of user (customer vs wholesale
  buyer vs admin; regular user vs moderator).
- When account creation needs an approval step (wholesale accounts).

Do **not** use for the photo-dedupe tool — it is a local, single-user tool
with no accounts.

## Inputs

- The project's list of **roles** and what each may do (write this down first
  as a permissions matrix — see `templates/roles-matrix.example.md`).
- Account lifecycle requirements: self-signup? invite-only? approval queue?
- Session length / "remember me" requirements.

## Outputs

- `users` table (see schema below) plus `sessions` (or JWT config).
- Middleware: `requireAuth`, `requireRole(...roles)`, `requirePermission(p)`.
- Auth endpoints: register, login, logout, password reset, me.
- A seeded admin user for local dev.

## Default Stack

| Concern | Default | Why |
|---|---|---|
| Password hashing | `argon2id` (via `argon2` npm package) | Current OWASP recommendation |
| Sessions | Server-side sessions in Postgres, httpOnly cookie | Revocable, simple, no token-refresh dance |
| Tokens (only if needed) | JWT access + rotating refresh | Only for mobile clients / third-party API consumers |
| Framework glue | Fastify/Express middleware, or Lucia/Auth.js if you want a library | Hand-rolled sessions are ~200 lines and fully understood |
| 2FA (optional) | TOTP via `otplib` | Add for admin roles first |

Stack-agnostic rule: whatever the stack, the *shape* below stays the same.

## Core Schema

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'user',      -- see roles matrix per project
  status        text NOT NULL DEFAULT 'active',    -- 'pending' | 'active' | 'suspended'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,                     -- 128-bit random, base64url
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Projects extend `users` with project-specific columns via a 1:1 profile table
(e.g. `wholesale_accounts`, `trail_profiles`) rather than widening `users`.

## Roles & Permissions Pattern

1. **Roles are coarse, permissions are fine.** Store a single `role` string on
   the user; map roles to permission sets in code, not in the database:

   ```ts
   const PERMISSIONS = {
     admin:     ['*'],
     staff:     ['orders:read', 'orders:write', 'products:write'],
     wholesale: ['catalog:read', 'orders:create', 'pricing:wholesale'],
     user:      ['catalog:read', 'orders:create'],
   } as const;
   ```

2. **Check permissions, not roles, at call sites.** `requirePermission('orders:write')`
   survives role restructuring; `requireRole('staff')` does not.
3. **Approval workflows use `status`, not `role`.** A pending wholesale account
   is `role='wholesale', status='pending'` — permissions apply only when
   `status='active'`.
4. **Resource ownership is a separate check.** "Is this *your* order?" is an
   ownership check in the handler, not a permission.

## Best Practices

- Normalize emails (lowercase, trim) before uniqueness checks; use `citext`.
- Return identical errors for "wrong password" and "no such user".
- Rate-limit login and password-reset endpoints (per-IP and per-account).
- Password reset: single-use token, 30-min expiry, stored hashed.
- Session cookie: `httpOnly`, `secure`, `sameSite=lax`.
- On privilege change or password reset, revoke all existing sessions.
- Never log passwords, tokens, or full session IDs.
- Write the permissions matrix into the project's PROJECT_SPEC.md before
  building any protected endpoint.

## Pitfalls

- Widening the `users` table with per-project fields — use profile tables.
- Trusting a role claim in a JWT after the role changed server-side (a reason
  to prefer server-side sessions).
- Building admin auth as a separate system — same `users` table, different role.
- Forgetting the `status` check: a suspended user with valid session must be
  rejected by `requireAuth`.

## Used By

- **ecommerce-platform** — customers, wholesale accounts (with approval flow), staff, admin.
- **trail-social-app** — users, moderators, admin.
- **property-management** — single owner (admin) today; keep the pattern so tenants can get portal logins later.
