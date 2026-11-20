# SplitMate — Phase 1

A mobile-first group expense sharing PWA built with Next.js, TypeScript, Tailwind CSS and direct SQL queries against Neon PostgreSQL. No ORM is used; database access is handled by the lightweight `postgres` driver.

## Included in this project

- Email or phone registration and login using a 4-digit PIN (bcrypt-hashed; never stored as plain text)
- Secure, HTTP-only session cookie and server-side session validation
- Group creation, group membership and shareable invitation links (7-day expiry)
- Group-scoped access checks on expense, balance, activity and settlement APIs
- Restaurant bill image and PDF scanning using local Tesseract.js OCR and table-aware receipt parsing
- Editable extracted items, quantities, prices, taxes, service charges and discounts
- Manual expense creation when there is no receipt
- Equal split only: each selected member receives an equal share; one selected member receives 100%
- Proportional allocation of bill-level tax, service charge and discount across items
- Multiple people can contribute to the restaurant payment
- Group balances, simplified settlement suggestions and two-sided settlement confirmation
- Group activity feed, in-app notifications and spending analytics
- Database-backed PIN login lockout after repeated failed attempts
- Responsive dashboard and installable PWA shell

## Stack

- Next.js 15 App Router / React 19 / TypeScript
- Tailwind CSS and Lucide icons
- Neon PostgreSQL
- `postgres` npm package for parameterized SQL queries (no ORM)
- No external OCR provider or API key required
- Web App Manifest + Service Worker

## 1. Run locally

Requirements: Node.js 20.9+ and a Neon PostgreSQL database.

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```env
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
SESSION_SECRET=use-a-long-random-secret-at-least-32-characters
APP_URL=http://localhost:3000
# No OCR API key required. Receipt OCR uses Tesseract.js in the browser.
```

Generate a session secret with:

```bash
openssl rand -base64 32
```

Create the database tables:

```bash
npm run db:init
```

Start the app:

```bash
npm run dev
```

Open http://localhost:3000.

## 2. Neon setup

1. Create a Neon project and database.
2. Copy the pooled connection string from Neon.
3. Add `?sslmode=require` if it is not already present.
4. Put it in `DATABASE_URL` in `.env.local` and Vercel environment variables.
5. Run `npm run db:init` once against the target database.

The schema is in `db/schema.sql`. It is safe to run repeatedly because the tables and indexes use `IF NOT EXISTS`.

## 3. Receipt scanning

Receipt OCR uses **Tesseract.js** (open-source OCR) in the browser. Image bills (JPG, PNG, WEBP) are upscaled before recognition. The receipt header is used to crop the item table and run a separate table-focused OCR pass. Rows are extracted only when they begin with a printed item sequence number; the address, phone, GSTIN and bill metadata are excluded. The parser uses quantity × unit-price checks and subtotal reconciliation to repair common currency-symbol OCR errors. PDFs are rendered page-by-page using PDF.js (up to the first five pages), then passed through the same OCR pipeline. No OpenAI key or paid OCR API is used.

The receipt parser looks for the item table header (`ITEM`, `QTY`, `UNIT`, `TOTAL`) and only parses rows between that header and the first subtotal/tax/total section. It uses the detected column positions to keep item names, quantities, unit prices and line totals separate. This deliberately avoids treating restaurant address, phone number, GSTIN, bill number and other header text as purchased items. Taxes, service charge, discount and subtotal are read from their own labelled lines.

OCR is not perfect, especially on low-resolution, skewed, faded or unusual receipts. Every extracted field remains editable and the parser displays review warnings when item totals do not match the printed subtotal. If no valid item rows are found, it leaves a blank manual row rather than inventing items. The English OCR model is downloaded on first use, so an internet connection is needed for the initial scan.

**Production storage note:** For local development, scanned image files are written to `public/uploads`. Vercel's filesystem is ephemeral and public receipt URLs are not appropriate for private financial documents. Before production use, replace this local upload adapter with private object storage (e.g. S3-compatible storage or Vercel Blob with private access/signed URLs) and keep the object key in `expenses.receipt_url`. Do not deploy sensitive receipt storage using the local adapter unchanged.

## 4. Calculation rules

All monetary values are stored and calculated as integer paise.

- Item base = quantity × unit price.
- Tax, service charge and discount entered at bill level are distributed proportionally by each item's base value.
- The resulting item total is split equally among the selected members.
- If one member is selected, they receive the entire item amount.
- Any paise remainder is deterministically assigned to the first selected member so each item's shares sum exactly to the item total.
- The creator is the default payer for the full bill. Multiple payer contributions can be entered and must add up exactly to the bill total.

For restaurant bills where taxes are already included in the item price, enter zero in the separate tax field to avoid double-counting.

## 5. Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Add `DATABASE_URL`, `SESSION_SECRET` and `APP_URL` to Vercel project environment variables. No OCR API key is needed.
4. Set `APP_URL` to the deployed HTTPS origin.
5. Run the schema initialization against Neon before first use (`npm run db:init` locally with the production `DATABASE_URL`, or execute `db/schema.sql` in Neon SQL Editor).
6. Deploy.

PWA installation requires HTTPS in production. iOS users install through Safari's Share → Add to Home Screen. Android browsers should offer Install App when PWA criteria are met.

## 6. Important production hardening before inviting real users

This is a functional Phase 1 starter, but it should receive a production-hardening pass before handling real financial records:

- Add durable rate limiting for PIN login attempts (e.g. Upstash Redis or a database-backed lockout policy), account recovery with verified email/SMS OTP, and optional passkeys/biometrics.
- Replace local receipt storage with private object storage and signed URLs.
- Add transactional email/SMS delivery for account recovery and invite notifications.
- Add a proper push notification subscription/delivery service if push notifications are required; the current notifications are in-app.
- Add edit-expense workflows with immutable revision/audit records, and admin member removal/invitation revocation UI.
- Add CSRF/origin checks, security headers, monitoring, backups and restore tests.
- Review privacy, retention and applicable Indian data protection requirements.
- Add automated unit, integration and end-to-end tests, especially for allocation and settlement edge cases.

The application does not initiate or verify UPI payments. That belongs to Phase 2. Settlement records in Phase 1 are manually marked by the payer and confirmed by the receiver.

## 7. Main API routes

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/groups`, `GET/PATCH/DELETE /api/groups/:id`
- `POST /api/groups/:id/invite`, `POST /api/groups/join`
- `POST/GET /api/expenses`, `GET/DELETE /api/expenses/:id`, `POST /api/expenses/scan`
- `GET /api/balances?groupId=...`
- `GET/POST/PATCH /api/settlements`
- `GET /api/activity?groupId=...`, `GET/PATCH /api/notifications`, `GET /api/analytics?groupId=...`

## 8. Notes

- The app starts with INR and rupee display formatting.
- Invite links are generated with a seven-day expiry.
- Group expense visibility is enforced on the server using membership checks.
- A user who leaves a group should not retain access to that group's data.
- PWA offline support caches the application shell only; financial data and mutations require connectivity.

### Database initialization environment variables

Create `.env.local` in the project root (the same folder as `package.json`) and set `DATABASE_URL`. The `db:init` script loads Next.js environment files through `@next/env`, so it reads `.env.local` as well as `.env`. After updating the project files, run `npm install` before `npm run db:init`. On Windows, make sure the file is really named `.env.local`, not `.env.local.txt` (enable **View → File name extensions** in File Explorer to check).
