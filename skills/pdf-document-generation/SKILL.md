---
name: pdf-document-generation
description: Generating PDFs from templates — lease contracts, invoices, receipts. HTML-template-to-PDF pipeline, merge-field conventions, versioning, and storage of generated documents.
used-by: [property-management, ecommerce-platform]
---

# Skill: PDF & Document Generation

## Purpose

Turn structured data + a template into a finished document: a lease agreement
when a tenant is added, an invoice for a wholesale order. Templates are
version-controlled HTML; generation is deterministic; output is stored like
any other file.

## When to Use

- Auto contract generation (property management — the primary driver).
- Invoices/receipts/packing slips (ecommerce).
- Any "fill in this document from database fields" feature.

## Inputs

- A template (HTML + CSS) with named merge fields.
- A validated data object supplying every merge field.
- Document metadata: type, related entities (tenancy, order).

## Outputs

- A PDF stored via the `file-storage-uploads` pattern (private).
- A `generated_documents` row linking data → template version → file.

## Default Stack

| Concern | Default | Notes |
|---|---|---|
| Rendering | **HTML + CSS → PDF via headless Chromium (Playwright/Puppeteer)** | Full CSS control; templates are just web pages |
| Templating | Handlebars (or JSX rendered to static HTML) | Logic-light templates |
| Paged layout | CSS `@page`, `page-break-*` rules | Margins, headers/footers, page numbers |
| Alternative | `pdf-lib` for *filling existing PDF forms* (AcroForm) | Use when a landlord/legal template must be preserved exactly |

Rule of thumb: **you own the layout → HTML-to-PDF; someone hands you a fixed
PDF form → pdf-lib form filling.**

## Template Conventions

- Templates live in the project repo: `templates/documents/<type>/<version>/`
  e.g. `templates/documents/lease/v3/template.hbs` + `styles.css`.
- Merge fields are explicit and flat-ish: `{{tenant.fullName}}`,
  `{{property.addressLine1}}`, `{{tenancy.rentAmountFormatted}}`,
  `{{tenancy.startDateLong}}`.
- **Formatting happens before the template.** The generator receives raw data
  and produces a "view model" with pre-formatted strings (dates spelled out,
  money with currency symbol, "two thousand pounds (£2,000)" legal style
  where needed). Templates never format.
- Validate the view model with a Zod schema per template version — a missing
  field fails generation loudly, never renders a blank.
- Conditional clauses (pets clause, garden clause) are template sections
  toggled by explicit booleans, listed in the template's README.

See `templates/lease-agreement.template.html` for a worked example.

## Generation Pipeline

```
data (db rows) → view-model builder → Zod validate → render HTML
  → Chromium print-to-PDF (A4, margins) → store file (private)
  → insert generated_documents row → notify/return download link
```

```sql
CREATE TABLE generated_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type         text NOT NULL,          -- 'lease' | 'invoice' | ...
  template_version text NOT NULL,          -- 'lease/v3'
  subject_type     text NOT NULL,          -- 'tenancy' | 'order'
  subject_id       uuid NOT NULL,
  file_id          uuid NOT NULL REFERENCES files(id),
  input_snapshot   jsonb NOT NULL,         -- the exact view model used
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

`input_snapshot` makes every document reproducible and auditable — you can
always answer "what data produced this contract?"

## Best Practices

- Generate in a background job (Chromium is heavy); the UI shows
  "generating…" then a download link (see `notifications-scheduling`).
- Never regenerate-and-replace a signed/issued document — generate a new
  version row; old files are immutable.
- Template changes bump the version directory; old versions stay in the repo
  so historical documents remain reproducible.
- Embed fonts; don't rely on system fonts in the container.
- Test fixtures: golden-file test renders each template version with sample
  data and diffs the PDF text layer (or a raster hash) to catch layout breaks.
- Legal documents: treat template text as owner-provided content; changes to
  clause wording go through the repo (reviewable diffs), not a CMS.
- Signatures are out of scope for v1 — leave signature blocks for wet/manual
  signing; integrate an e-sign provider (Dropbox Sign, DocuSign) later if needed.

## Pitfalls

- Formatting dates/money inside templates — guarantees inconsistency.
- Generating synchronously in a request handler — timeouts under load.
- Losing the input data — without `input_snapshot`, a disputed contract
  can't be explained.
- Using `wkhtmltopdf` (abandoned, ancient WebKit) — use Chromium.

## Used By

- **property-management** — auto lease generation when a tenant is added; renewal documents.
- **ecommerce-platform** — invoices for wholesale orders, packing slips.
