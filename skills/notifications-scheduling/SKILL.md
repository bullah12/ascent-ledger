---
name: notifications-scheduling
description: Reminders, alerts, and scheduled/background jobs — a Postgres-backed job queue, recurring schedules, and multi-channel notification delivery (in-app, email).
used-by: [property-management, ecommerce-platform, trail-social-app]
---

# Skill: Notifications & Scheduling

## Purpose

Two related capabilities, one skill:

1. **Scheduling** — run code later or on a recurrence (cron): "30 days before
   the gas certificate expires, create a reminder"; "nightly orphan-file cleanup".
2. **Notifications** — tell a user something happened, across channels
   (in-app inbox first, email second), with read/unread state.

## When to Use

- Deadline reminders (certificate renewals, lease expiry, inspections).
- Transactional email (order confirmation, wholesale approval, password reset).
- Social notifications (new follower, comment).
- Background jobs of any kind (image variants, cleanup, digest emails) — the
  same queue powers them.

## Inputs

- Event catalog: which events notify whom, on which channels (table it in the
  project spec).
- Reminder rules: lead times per deadline type (e.g. 60/30/7 days before expiry).

## Outputs

- `jobs`, `notifications` tables + a worker loop.
- `notify(userId, type, payload)` helper used by all features.
- `GET /api/v1/notifications` + mark-read endpoints for the in-app inbox.

## Default Stack

| Concern | Default | Why |
|---|---|---|
| Job queue | **pg-boss** (Postgres-backed) | No Redis to operate; transactional enqueue with your data |
| Recurring jobs | pg-boss cron schedules | One system for cron + one-off delayed jobs |
| Email | Resend or Postmark via a thin `sendEmail()` wrapper | Swappable provider |
| Email templates | React Email (or MJML) | Shared layout across projects |
| In-app | `notifications` table + polling (`?since=`) | WebSockets/SSE only when a project truly needs live push |

Stack-agnostic core: *durable queue in the database + idempotent handlers +
a notifications table*. Everything else is replaceable.

## Core Schema

```sql
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,             -- 'cert.expiring' | 'order.shipped' | 'social.follow' ...
  title      text NOT NULL,
  body       text,
  link_path  text,                      -- in-app deep link, e.g. '/properties/123'
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
```

(pg-boss creates its own job tables.)

## Reminder Pattern (deadline-driven)

For "remind me before X expires" features, do **not** enqueue far-future jobs
per deadline. Instead:

1. Store deadlines as data: `reminders(id, subject_type, subject_id, due_on,
   lead_days int[], last_notified_lead int)`.
2. A daily cron job (`08:00` local) scans: for each reminder, if
   `due_on - today` has crossed a lead threshold not yet notified, call
   `notify()` and record it.

This survives edits (change the expiry date → next scan just works), and
nothing breaks if the worker was down for a day.

## Notification Delivery Pattern

- `notify()` writes the `notifications` row, then enqueues per-channel jobs
  based on the user's channel preferences (default: in-app always, email for
  high-importance types).
- Email jobs are idempotent: check a `sent` marker keyed by
  `(notification_id, channel)` before sending.
- Batch low-importance social notifications into digests (one job per user
  per day) instead of one email per like.

## Best Practices

- Every job handler is **idempotent** — jobs will occasionally run twice.
- Set explicit retry policy per job type (payment webhooks: many retries;
  digest email: few).
- Dead-letter queue: failed-after-retries jobs land somewhere visible; the
  admin dashboard shows a count (see `dashboard-ui-patterns`).
- Timezones: store timestamps in UTC; evaluate "due dates" (certificates,
  rent due) as `date` in the owner's timezone, set per account.
- Log every send with provider message ID; handle bounce webhooks by flagging
  the email address.
- Test clock: reminder logic takes `today` as a parameter so tests can time-travel.

## Pitfalls

- Scheduling a job at signup for something 11 months away — use the daily
  scan pattern instead.
- Sending email inline in a request handler — always via the queue.
- Notification fan-out inside a transaction that can roll back — enqueue
  after commit (or use pg-boss's transactional send with the same tx).

## Used By

- **property-management** (primary) — certificate/lease/inspection reminders, rent-overdue alerts.
- **ecommerce-platform** — order emails, low-stock alerts, wholesale-approval notices; queue powers image variants.
- **trail-social-app** — social notifications, weekly digest, "new trails near you".
