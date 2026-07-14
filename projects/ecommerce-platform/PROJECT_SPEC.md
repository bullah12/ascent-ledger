# PROJECT SPEC — E-Commerce Platform

An in-house Shopify alternative serving **B2C retail and wholesale on one
platform**: one catalog, one checkout, with wholesale accounts unlocking
tiered pricing after approval.

## Shared Skills Applied

| Skill | How it's used here |
|---|---|
| `auth` | Customers, wholesale accounts (approval flow via `status='pending'`), staff, admin; permissions matrix below |
| `database-schema-design` | All tables below follow the conventions (cents, CHECK statuses, migrations) |
| `rest-api-design` | Storefront + admin API, envelopes, transition endpoints (`/orders/:id/cancel`) |
| `file-storage-uploads` | Product images (public, variants: thumb/md/lg) |
| `payments-billing` | Stripe Checkout, webhook-driven order state, refunds, wholesale invoicing |
| `notifications-scheduling` | Order emails, low-stock alerts, approval notices, abandoned-order sweep |
| `pdf-document-generation` | Wholesale invoices, packing slips |
| `dashboard-ui-patterns` | Admin: list/detail/form/stats/review-queue patterns |

Stack: Node/TypeScript + Fastify + Postgres + React. Storefront may use
Next.js for SEO; admin is a Vite SPA.

## Roles & Permissions (auth skill matrix)

| Permission | admin | staff | wholesale | customer | anonymous |
|---|:-:|:-:|:-:|:-:|:-:|
| catalog:read | ✅ | ✅ | ✅ | ✅ | ✅ |
| pricing:wholesale | ✅ | ✅ | ✅ (when active) | ❌ | ❌ |
| cart/checkout | ✅ | ✅ | ✅ | ✅ | 🔸 guest checkout |
| orders:read | ✅ | ✅ | 🔸 own | 🔸 own | ❌ |
| orders:manage (fulfill, refund) | ✅ | ✅ | ❌ | ❌ | ❌ |
| products:write, inventory:write | ✅ | ✅ | ❌ | ❌ | ❌ |
| wholesale:approve, tiers:write | ✅ | ❌ | ❌ | ❌ | ❌ |

## Data Model

Conventions from `database-schema-design` (uuid `id`, timestamps, cents,
`text + CHECK` statuses) assumed on every table.

```
users                    (auth skill)
wholesale_accounts       user_id FK unique, company_name, vat_number,
                         pricing_tier_id FK, status CHECK(pending|active|suspended|rejected),
                         approved_by FK users, approved_at
pricing_tiers            name unique, discount_pct           -- 'retail' is implicit
products                 name, slug unique, description, status CHECK(draft|active|archived),
                         category_id FK
product_variants         product_id FK, sku unique, options jsonb ({size,color}),
                         retail_price_cents, position
variant_tier_prices      variant_id FK, pricing_tier_id FK, price_cents,
                         min_quantity int DEFAULT 1, UNIQUE(variant_id, tier_id, min_quantity)
                         -- explicit per-tier price overrides tier discount_pct;
                         -- min_quantity rows give quantity-break pricing
categories               name, slug unique, parent_id FK nullable
product_images           product_id FK, file_id FK, sort_order
inventory_levels         variant_id FK unique, on_hand int, reserved int,
                         low_stock_threshold int
carts                    user_id FK nullable (guest carts by token), status CHECK(open|converted|abandoned)
cart_items               cart_id FK, variant_id FK, quantity
orders                   number serial-ish display code, user_id FK nullable,
                         type CHECK(retail|wholesale),
                         status CHECK(pending|paid|processing|shipped|delivered|cancelled|refunded),
                         email, shipping_address jsonb, billing_address jsonb,
                         subtotal_cents, shipping_cents, tax_cents, total_cents, currency
order_items              order_id FK, variant_id FK, quantity,
                         unit_price_cents, line_total_cents   -- prices frozen at purchase
payments                 (payments-billing skill: subject='order')
stripe_events            (payments-billing skill)
files, notifications, jobs, generated_documents   (respective skills)
```

**Pricing resolution** (server-side only, per `payments-billing` golden rule):
1. If buyer's active wholesale tier has a `variant_tier_prices` row matching
   quantity → that price. 2. Else tier `discount_pct` off retail. 3. Else
   retail. Frozen into `order_items` at checkout.

**Inventory:** checkout reserves (`reserved += qty`); payment confirmation
decrements `on_hand` and releases the reservation; the abandoned-order sweep
(scheduled job) releases stale reservations.

### Order status flow
`pending → paid → processing → shipped → delivered`, with `cancelled`
(from pending/paid) and `refunded` (from paid onward) as exits — all via
transition endpoints, all emitting notifications.

## Key User Flows

1. **Retail purchase:** browse catalog → variant page → add to cart (guest OK)
   → checkout (`POST /checkout` prices cart, creates pending order, returns
   Stripe Checkout URL) → pay → webhook flips to `paid` → confirmation email
   → staff fulfills via admin (processing → shipped + tracking email).
2. **Wholesale onboarding:** customer applies (company details) → account
   `wholesale/pending` → appears in admin **review queue** → admin approves +
   assigns tier → notification email → buyer now sees tier pricing and
   quantity breaks across the catalog.
3. **Wholesale order:** same cart/checkout, `type='wholesale'`; optionally
   pay-by-invoice (Stripe Invoice, order `pending` until `invoice.paid`);
   invoice PDF generated and attached.
4. **Refund:** staff opens order detail → refund action (full/partial) → API
   calls Stripe → webhook confirms → ledger + order status update → email.
5. **Catalog management:** staff CRUD products/variants/images (form +
   list patterns), set tier prices, watch low-stock alerts.

## API Surface (representative)

```
GET  /api/v1/products?category=&search=&page=      # public; prices reflect caller's tier
GET  /api/v1/products/:slug
POST /api/v1/carts / PATCH /api/v1/carts/:id/items
POST /api/v1/checkout                              # → { checkoutUrl }
POST /api/v1/webhooks/stripe
GET  /api/v1/orders            (own)   /:id
POST /api/v1/wholesale-applications
# admin:
GET/POST/PATCH /api/v1/admin/products, /variants, /tier-prices, /inventory
GET  /api/v1/admin/wholesale-applications?status=pending
POST /api/v1/admin/wholesale-applications/:id/approve | /reject
POST /api/v1/admin/orders/:id/fulfill | /refund
GET  /api/v1/admin/stats/sales?period=
```

## Admin Dashboard Screens (dashboard-ui-patterns)

- **Overview** — stats row (today's revenue, open orders, low stock, pending
  wholesale apps) + recent orders list.
- **Orders** — list w/ status filter → detail (items / payment / history tabs).
- **Products** — list → form screen (variants editor, image upload, tier prices).
- **Inventory** — list w/ inline adjust; low-stock filter.
- **Wholesale** — review queue (approve/assign tier) + accounts list.
- **Settings** — tiers, shipping rates, staff users.

## Assumptions & Phasing

- Single currency, single warehouse, flat/simple shipping rates at launch.
- Tax as a configurable flat rate v1; real tax service later.
- **Phase 1:** catalog + retail checkout + orders + admin basics.
  **Phase 2:** wholesale (tiers, approval, quantity breaks, invoicing).
  **Phase 3:** refunds polish, packing slips, stats, low-stock automation.
