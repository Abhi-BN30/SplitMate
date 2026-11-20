# Vercel deployment checklist

- [ ] Import the GitHub repository into Vercel.
- [ ] Add `DATABASE_URL` using the Neon pooled connection string.
- [ ] Add a cryptographically random `SESSION_SECRET` (32+ characters).
- [ ] Add `APP_URL` with the deployed HTTPS origin.
- [ ] No OCR API key is required; Tesseract.js runs in the browser.
- [ ] Execute `db/schema.sql` in Neon SQL Editor or run `npm run db:init` with the production connection string.
- [ ] Deploy and test register/login, group invite, bill creation, balances and settlement confirmation.
- [ ] Configure private object storage before storing real receipts. Do not rely on Vercel's local filesystem for persistent uploads.
- [ ] Add an email/SMS provider for secure PIN recovery before real users rely on the service.
