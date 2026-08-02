# Proto Admin Portal

Standalone admin app for Proto Trading. **Not** the main trade portal.

- **Repo:** https://github.com/danieljoffeinfo-web/protoportal-admin
- **Production:** https://admin.proto.co.za (Vercel project `protoportal-admin`)
- **Main portal (separate):** https://github.com/danieljoffeinfo-web/Proto-Website-

## Stack
- Vite + React (JSX)
- Supabase via `api/_site-config.js`
- Vercel serverless `api/` routes
- npm

## Dev
```bash
npm run dev
npm run build
```

## Structure
- `src/pages/AdminPage.jsx` — all admin sections
- `src/components/` — ProductManagerEngine, ReorderGrid, etc.
- `src/lib/` — products, taxonomy, customers, orders
- `api/` — serverless backend

## Sections (nav ids)
`orders` (Order Requests, incl. Order Workspace) · `product-loader` ·
`image-replace` · `catalogue` (Product Manager, live only) · `archive`
(archived products, no category sidebar) · `reorder` (Reorder Grid) ·
`customers` · `comms` (Email CRM: Brevo-synced contacts + broadcast composer +
Email Analytics) · `whatsapp` (Broadcast + Inbox + Analytics + Contacts over
WATI) · `site-content` (Featured + Specials + Banner Editor) · `analytics` ·
`pricing` · `team` (opens fulfillment team modal).

Removed features — do NOT reintroduce: **Apollo (the entire tab, engine and
docs)**, Cost Tracking, product approval tab, reorder mode inside Product
Manager, product-type dropdown in the edit modal, scheduled send for email
broadcasts (immediate-send only).

**WhatsApp was deliberately reinstated** (migration 060), after PR #179 removed
the original build and migration 055 dropped its tables. It is NOT the old
feature restored — the rules below are the point of the rebuild, so do not
"simplify" back toward the previous design:

- **We own the message ledger.** `whatsapp_messages` is the source of truth for
  every message in and out. Per-contact rollups (`last_outbound_*`,
  `last_inbound_*`, `session_expires_at`, `unread_count`) are maintained by the
  migration-060 trigger and read from our DB.
- **Never store or read state in WATI contact custom params.** The old build
  kept join status in `attribute_2` / `joined` / `join_status` and scraped
  `getMessages` per contact on every render. Both are gone on purpose.
- **Broadcast audience is `customers.accept_whatsapp` only**, resolved through
  the `wa_broadcast_audience()` SQL function so the composer's preview count and
  the worker's send list cannot diverge. Team numbers and STOP contacts never
  receive.
- **Broadcasts queue; they never send in-request.** `api/wa-broadcast.js`
  enqueues, the `api/wa-broadcast-worker.js` cron drains in bounded batches.
- **The webhook secret goes in a header** (`x-webhook-secret`, `timingSafeEqual`),
  never the query string — see the Brevo webhook for the same pattern.
- **Order alerts stay email-only.** Reinstating WhatsApp for messaging does not
  reinstate WhatsApp order notifications; `api/_order-notify-core.js` is unchanged.

## Customers & email
- **Customer codes are NEVER auto-generated** — always null or an admin-typed
  6-char code. Approval does **not** require a code (allocate later).
- **10000 club** = pre-registered emails (`proto_active_customers` allowlist)
  with a **non-empty account_code** (migration 054 — a blank-code row never
  auto-approves). On signup they auto-approve, get the `10000 club` tag, and
  are sent a **welcome email** (`api/_welcome-email.js`).
- **Manual add-customer**: POST `api/admin-customers` with a `section`
  (`approved` / `approved-10000` → creates auth acct + welcome email;
  `pre-registration` → allowlist). Never trade-requests, never a code.
- **Per-customer last email**: `customers.last_email_type` + `last_email_at`
  (migration 042), stamped by `api/_customer-email-status.js` on every send;
  shown as a badge in Customer Management.
- **Per-template test send**: `api/email-test-send.js` (welcome, campaign,
  order_confirmation, trade_application) → `EmailTemplateTests` in the email modal.
- **Brevo analytics**: opens/clicks flow via `api/brevo-email-webhook.js`. Set
  `WEBHOOK_SECRET` in Vercel and configure Brevo to send the same value as the
  `X-Webhook-Secret` header (or Bearer token). The endpoint fails closed when
  the secret is absent or incorrect.

## Auth

Supabase email/password login with a **3-email allowlist** (`src/lib/auth.js`, mirrored in `api/_admin-auth.js`):

- `danieljoffeinfo@gmail.com`, `george@proto.co.za`, `online@proto.co.za`

`Root.jsx` shows `AdminLoginPage` until `getVerifiedSession()` + `/api/auth-check` succeed. API routes use `requireAdminKey` (JWT or optional `ADMIN_DASH_KEY` header). Fulfillment work requires a verified allowlisted admin session; legacy shared per-order bearer tokens are disabled. Crons require `CRON_SECRET`.

## Agent skill
See `.cursor/skills/protoportal-admin/SKILL.md` for full architecture.

**Never** implement admin features in protoportal-main's deprecated embedded AdminPage.
