# Vercel deployment checklist

- [ ] Import the GitHub repository into Vercel.
- [ ] Add `DATABASE_URL` using the Neon pooled connection string.
- [ ] Add a cryptographically random `SESSION_SECRET` (32+ characters).
- [ ] Optionally add `APP_URL` with the deployed HTTPS origin (otherwise invite links use the request origin).
- [ ] No OCR API key is required; Tesseract.js runs in the browser.
- [ ] Execute `db/schema.sql` in Neon SQL Editor or run `npm run db:init` with the production connection string.
- [ ] Use Node.js 20.9 or later, then deploy and test register/login, group invite, bill creation, balances and settlement confirmation.
- [ ] Receipt files are stored in Neon PostgreSQL and served only to group members; keep uploads under Vercel's 4 MB request limit (large images are compressed in the browser; PDFs over 4 MB are rejected).
- [ ] Add an email/SMS provider for secure PIN recovery before real users rely on the service.
