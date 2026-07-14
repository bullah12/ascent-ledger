# PROJECT SPEC — Property Management Dashboard

A dashboard for a **single owner managing multiple rental properties**:
properties, tenants, lease contracts (stored *and* auto-generated), rent
income, expenses, and deadline reminders (certificates, inspections, lease
expiry).

## Shared Skills Applied

| Skill | How it's used here |
|---|---|
| `auth` | Single admin (owner) today; standard pattern so tenant portal logins can be added later |
| `database-schema-design` | Schema below (cents, date-typed due dates, CHECK statuses) |
| `rest-api-design` | Small internal API, same conventions |
| `file-storage-uploads` | Lease PDFs, certificates, expense receipts — all **private**, presigned GET |
| `notifications-scheduling` | The Notifications tab: daily-scan reminder pattern (60/30/7-day leads) |
| `pdf-document-generation` | **Auto Contract Generation** tab: lease template → PDF on new tenancy |
| `payments-billing` | Phase 2 only: automated rent collection via Stripe invoices |
| `dashboard-ui-patterns` | The whole app: property detail page with tabs is the detail-screen pattern |

Stack: Node/TypeScript + Fastify + Postgres + React (Vite SPA). Simple
multipart uploads are fine here (internal tool, one user).

## Data Model

```
users              (auth skill — owner as admin; timezone setting drives due-date logic)
properties         nickname, address_line1, address_line2, city, postcode,
                   property_type CHECK(house|flat|hmo|commercial),
                   bedrooms int, purchase_price_cents NULL, notes,
                   status CHECK(active|archived)
tenants            full_name, email, phone, notes
                   -- a person; may rent different properties over time
tenancies          property_id FK, tenant_id FK,
                   start_date date, end_date date,
                   rent_amount_cents, rent_due_day int CHECK 1..28,
                   deposit_amount_cents, deposit_scheme, deposit_reference,
                   status CHECK(draft|active|ended|renewed)
                   -- the lease relationship; contracts and rent hang off this
contracts          tenancy_id FK, kind CHECK(lease|renewal|addendum),
                   source CHECK(generated|uploaded),
                   file_id FK files, generated_document_id FK NULL,
                   signed_on date NULL, status CHECK(draft|issued|signed|superseded)
transactions       property_id FK, tenancy_id FK NULL,
                   direction CHECK(income|expense),
                   category (income: rent|deposit|other;
                             expense: repairs|maintenance|insurance|mortgage_interest|
                                      certificates|agent_fees|utilities|other),
                   amount_cents, occurred_on date, description,
                   receipt_file_id FK NULL,
                   rent_period date NULL   -- first-of-month marker for rent rows
compliance_items   property_id FK,
                   kind CHECK(gas_certificate|electrical_eicr|epc|
                              smoke_co_check|inspection|insurance|custom),
                   label, due_on date, completed_on date NULL,
                   document_file_id FK NULL,
                   recurrence_months int NULL   -- gas: 12, EICR: 60, EPC: 120
reminders          (notifications-scheduling skill) subject_type CHECK(compliance_item|tenancy),
                   subject_id, due_on, lead_days int[] DEFAULT '{60,30,7}',
                   last_notified_lead int NULL
notifications, jobs, files, generated_documents    (respective skills)
payments           (phase 2, payments-billing: subject='rent_invoice')
```

**Rent tracking model (v1 = manual):** each month a scheduled job creates
*expected* rent rows? — No: keep it simpler. The Monthly Income tab compares
`tenancies` (expected: active tenancy × rent_amount × due day) against
`transactions` rent rows (actual, entered manually or via bank-import CSV
later). "Overdue" = expected period with no matching transaction N days past
the due day → notification. Nothing is written until money actually arrives.

**Reminder lifecycle:** creating/updating a `compliance_item` or `tenancy`
upserts its `reminders` row (tenancy reminder targets `end_date`). Completing
a compliance item with a `recurrence_months` rolls `due_on` forward and
resets the reminder. Daily 08:00 scan per the `notifications-scheduling`
skill sends at 60/30/7-day leads (per-item overridable).

## Screens (dashboard-ui-patterns)

- **Overview** — stats row: monthly income (actual vs expected), overdue rent
  count, upcoming deadlines (30d), YTD expenses; recent activity list.
- **Properties** — list screen → **Property detail** (the core screen),
  tabs per the detail pattern:
  - **Contracts** — contracts list for the property's tenancies: view/download
    (presigned), upload signed copies, status badges; "Generate contract"
    action (below).
  - **Monthly Income** — month-by-month grid: expected vs received per
    tenancy, quick "record payment" inline action, overdue highlighted;
    yearly chart (Recharts).
  - **Expenses** — transactions list filtered to expenses; add-expense form
    (category, amount, date, receipt upload); category-breakdown chart;
    CSV export (tax time).
  - **Notifications** — compliance items + reminders for this property:
    due dates, status (ok / due soon / overdue), mark-complete with new
    certificate upload, edit lead times.
  - **Tenancy** — current/past tenancies, tenant contact details, deposit info.
- **Tenants** — list → detail (tenancy history across properties).
- **Notifications inbox** — global unread feed (bell icon, in-app inbox from
  the skill) + all upcoming deadlines across properties.
- **Settings** — owner profile/timezone, default lead times, lease template
  clause toggles, email preferences.

## Key Flows

1. **Add property** → form screen → prompted to add compliance items
   (gas cert due date, EICR, EPC) → reminders auto-created.
2. **Add tenant / start tenancy** → pick property, tenant (new or existing),
   dates, rent, deposit → tenancy `draft` → **Auto Contract Generation**:
   view-model built from owner + property + tenancy (per
   `pdf-document-generation`), clause toggles (pets/garden) → background job
   renders PDF → contract `draft` appears in Contracts tab → owner reviews,
   marks `issued`, later uploads/marks `signed` → tenancy `active` →
   lease-expiry reminder armed.
3. **Record rent** → Monthly Income tab inline action → transaction row →
   month turns green. Overdue detection is automatic (daily scan).
4. **Certificate renewal** → notification at 60/30/7 days → owner books
   engineer → marks complete + uploads new cert → next due date rolls forward.
5. **Renewal/expiry** → lease-expiry reminders → owner generates a renewal
   contract (new tenancy row, `kind='renewal'`) or lets it lapse (`ended`).

## API Surface (representative)

```
GET/POST/PATCH /api/v1/properties            /:id
GET/POST       /api/v1/tenants               /:id
POST /api/v1/tenancies                       POST /api/v1/tenancies/:id/activate
POST /api/v1/tenancies/:id/contracts/generate     # → job → generated_documents
GET  /api/v1/properties/:id/income?year=     POST /api/v1/transactions
GET  /api/v1/properties/:id/compliance       POST /api/v1/compliance-items/:id/complete
GET  /api/v1/notifications                   POST /api/v1/notifications/:id/read
GET  /api/v1/reports/expenses?year=&format=csv
```

## Assumptions & Phasing

- One owner, one login; no tenant-facing portal in v1 (schema doesn't block it).
- Rent recorded manually in v1 (bank transfers happen outside the app);
  UK-flavored compliance defaults (gas cert 12mo, EICR 5yr, EPC 10yr) —
  configurable, not hardcoded.
- **Phase 1:** properties, tenants/tenancies, contracts upload, expenses,
  income tracking. **Phase 2:** reminders + notifications, auto contract
  generation. **Phase 3 (optional):** Stripe rent collection auto-filling the
  income tab, bank CSV import, e-signatures.
