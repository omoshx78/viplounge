# VIP Lounge digital check-in & billing system

A working scaffold implementing the design discussed: QR-based passenger self check-in,
staff verification, multi-tenant billing with editable/versioned rate cards, corporate
account and travel-agent markup, platform-subscription tracking, and searchable/exportable
reporting dashboards for lounge admin, travel agent, and corporate roles.

**Stack:** React (Vite) frontend on Vercel, Node.js/Express API + PostgreSQL backend on Render.

---

## What's implemented

- QR-code destination self check-in form (individual and corporate, returning-passenger auto-fill)
- Passport/ID photo upload — optional for individual/cash passengers, available alongside a
  staff/consultant ID photo upload for corporate passengers, both shown to staff during
  verification for side-by-side comparison against the physical documents
- Mandatory data policy / terms-of-use consent checkbox before a passenger can submit check-in
- 30-day image retention: a scheduled purge job nulls out passport/staff ID image data after
  30 days while keeping the rest of the visit record (dates, billing, verification status)
  intact for reporting and reconciliation. Runs as a free GitHub Actions workflow by default
  (Render's free plan doesn't support Cron Jobs) — see the deployment section below.
- Lounge admin can add real travel agents and corporate accounts, and create logins for them,
  directly from the dashboard — no more hand-editing the seed file to onboard a real partner.
- Self-service password changes once logged in, plus an admin-generated one-time reset link
  for forgotten passwords (shared manually — there's no email delivery wired in yet, see
  "What's intentionally out of scope" below).
- **Billing data isolation is enforced at the API layer, not just hidden in the UI**: a
  corporate account's requests never receive `lounge_cost` or `agent_markup` in the response at
  all (the fields come back `null`) — only `client_charge`. A travel agent's own margin stays
  invisible to their corporate clients even if someone inspects raw network traffic, not just
  what's rendered on screen.
- **Row-Level Security: enabled, but not forced — enforcement moved to application code
  instead.** An earlier version forced RLS even against the owning DB user (see prior commit
  history), which broke the public passenger check-in insert in a way that resisted diagnosis
  without direct access to a live Postgres instance to test against. Rather than leave
  check-in broken while chasing a subtle RLS interaction, the actual tenant/corporate isolation
  guarantee now lives explicitly in application code (`routes/visits.js`'s `applyRoleScope`,
  `routes/payments.js`'s `buildPaymentScope`/`isAuthorizedForPayer`) — a travel agent's or
  corporate account's queries are hardcoded to their own scope in the SQL itself, regardless of
  what the client requests, and regardless of what RLS does or doesn't additionally restrict.
  This is arguably more robust than RLS alone anyway, since it's directly testable application
  logic rather than session-variable-dependent database policy evaluation. The billing-isolation
  guarantee (corporate never sees agent markup) was already independently enforced at the API
  response layer and is unaffected by any of this.
- Inventory module for food, drinks (alcoholic and non-alcoholic), and VIP supplies — stock
  levels, reorder levels, automatic low-stock warnings, and a full movement history (restock,
  consumption, waste, corrections) per item. Reachable from the nav as "Inventory" for lounge
  admin/staff. Layout is deliberately master-detail: a categorized item menu on the left, the
  selected item's stock detail and movement log on the right.
- A backend crash in one request can no longer take the entire server down. Two real gaps were
  closed here: async route errors weren't being caught (an unhandled promise rejection crashes
  the whole Node process, not just that request), and the Postgres connection pool had no error
  listener (same failure mode for a dropped idle connection). Both are now handled, converting
  what used to be a total outage into a normal `500` response for the one request that failed.
- Every printable list — the passenger list ("All passengers"), stock list, stock movement
  history, staff/partner login list, and travel agent/corporate client list — has a Print button
  that opens a clean, formatted document in a new tab (browser print-to-PDF covers the "download
  PDF" case from the same button). Verified passengers also get a per-row printable receipt, and
  filtering the passenger list to a single corporate account or travel agent unlocks a
  "Generate invoice" button that totals the filtered visits into a formatted invoice.
- Dashboard overview metric cards highlight on hover and are clickable — "Awaiting
  verification" and "Items below reorder level" jump straight to the verification queue /
  inventory page; every other metric jumps to the filtered passenger list (or scrolls to it, on
  the single-page agent/corporate dashboards).
- **Cashier role and statements of account.** Corporate accounts and travel agents are billed
  and pay later — a new `cashier` role (plus lounge admin) can now post an actual payment
  received against either, on the new "Cashier" page. A statement of account for any period is
  computed as opening balance (all charges minus all payments before the period) + charges in
  the period − payments in the period = closing balance, with a full line-item breakdown and
  print/PDF output. Corporate accounts and travel agents can generate and print their own
  statement from their own dashboard; lounge admin/cashier can generate one for any account.
  Fixed a real pre-existing bug along the way: the travel agent dashboard's own "my corporate
  clients" dropdown was silently failing (it called an admin-only endpoint a travel agent never
  had access to) — replaced with a proper RLS-scoped endpoint that actually works for that role.
- **Fixed a real infinite-loop bug** that was causing the passenger list to freeze on
  "Loading..." indefinitely: a default prop value (`fixedFilters = {}`) created a brand-new
  object on every render, which — since it sat inside a `useCallback` dependency array — gave
  the data-loading function a new identity every render, re-triggering the effect that calls
  it, in an endless cycle. Fixed with a stable module-level reference instead.
- **Individual cash/card payment collection is now an explicit, separate step from
  verification**, not something the system just silently assumes happened. Staff verifies
  identity first; a follow-up "Confirm payment collected" step asks for a payment
  reference/notes and records who collected it and when. This feeds directly into the
  cashier's "Cash & card collections" report (filterable by shift, printable, cash/card
  totals) — separate from the corporate/agent payments ledger, since individual passengers pay
  immediately rather than being billed later.
- **End-of-shift cash reconciliation**: pick a shift period, the system computes the expected
  cash total from actual verified+collected cash visits (the cashier never types in the
  expected figure — only what they actually counted), shows the variance, and saves a
  historical record. Printable, with history retained for audit.
- **Passenger detail on click**: rows in the passenger list highlight on hover and open a full
  detail view on click — including the passport/staff-ID photos, if they're still within their
  30-day retention window (shows a clear "no photo on file" message once purged or if none was
  uploaded). Images are deliberately NOT included in the main list response (they're fetched
  only when a row is actually opened) so the list itself stays fast regardless of how many
  photos are on file.
- Staff verification queue (tablet-friendly), approve/reject, billing calculated on approval
- **Tenant/corporate data isolation is enforced explicitly in application code** (see
  `applyRoleScope` in `routes/visits.js` and `buildPaymentScope`/`isAuthorizedForPayer` in
  `routes/payments.js`), not left to depend on Postgres Row-Level Security alone. RLS is still
  enabled and its policies are real and in effect, but an earlier attempt to also `FORCE` it
  against the app's own database connection broke the public check-in flow in a way that
  resisted diagnosis without live database access — see the comment block in `schema.sql` for
  the full account. The application-layer scoping is the guarantee you should rely on; treat
  RLS here as defense-in-depth on top of it, not the sole mechanism.
- Rate cards: editable, versioned (old visits keep historical rates), scoped globally / per travel
  agent / per corporate account, lounge-admin managed only
- Direct corporate accounts (no travel agent) supported as a first-class case
- Platform subscription tracker (per-pax or flat-monthly) — visible only on the lounge admin dashboard
- Reports: filter by tenant/agency/corporate account, direction, date range; type-ahead search;
  sortable columns; CSV export and print (browser print-to-PDF) on every report view

## What's intentionally out of scope for this scaffold (flagged for a follow-up build)

- Images are currently stored as base64 text directly in the `visits` table for simplicity.
  This is fine for demoing and moderate volume, but for production at real airport volume,
  move to object storage (S3-compatible works with both Render and Vercel) and store just the
  URL — see "Extending this" below.
- Real payment gateway integration for card payments (the check-in form records `payment_type`
  but doesn't process a live charge — wire in Stripe/local acquirer here)
- Email/SMS/WhatsApp delivery of scheduled reports **and of password reset links** — both exist
  as data/links you can copy, but nothing sends them automatically yet. Wiring in a provider
  like Postmark/SendGrid/Twilio would cover both use cases at once.
- True PDF generation for invoices (currently CSV + browser print; a templated PDF invoice
  generator, e.g. via a headless-Chrome or PDF library, is a natural next step)

---

## Local development

### Backend
```bash
cd backend
cp .env.example .env      # edit DATABASE_URL to point at your local Postgres
npm install
npm run migrate           # creates all tables + RLS policies
npm run seed               # optional demo data — all seeded users' password is: password123
npm run dev                 # starts on http://localhost:4000
```

### Frontend
```bash
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:4000
npm install
npm run dev                 # starts on http://localhost:5173
```

Visit `http://localhost:5173` for the passenger check-in form (this is what your QR code
should point to). Visit `/login` to sign in as staff/admin/agent/corporate using the seeded
demo accounts:

| Role | Email | Password |
|---|---|---|
| Lounge admin | admin@lounge.example | password123 |
| Lounge staff | staff@lounge.example | password123 |
| Cashier | cashier@lounge.example | password123 |
| Travel agent | agent@skylinetravel.example | password123 |
| Corporate admin | finance@acmemining.example | password123 |

---

## Deploying to Render (backend + database)

`render.yaml` is set up for **Render's free plan** — no payment required to deploy this.

1. Push this **entire project** (the folder containing `render.yaml`, `backend/`, and
   `frontend/`) to a GitHub repo. `render.yaml` must sit at the **root of the repo** — Render's
   Blueprint feature only looks for it there, not inside a subfolder.
   - **No local git/terminal needed**: on github.com, create a new repository, then use
     **Add file > Upload files** on the repo page and drag in the unzipped project folder's
     contents (or the whole extracted folder, depending on your browser). This project is small
     enough (no `node_modules`) to upload this way entirely from the browser.
   - This repo already has `render.yaml` at the root, with `rootDir: backend` on the service
     telling Render to actually build and run from the `backend/` subdirectory.
2. In Render, choose **New > Blueprint** and connect the repo. Render reads `render.yaml` and
   shows a preview: one free PostgreSQL database (`vip-lounge-db`) and one free web service
   (`vip-lounge-api`). Click **Apply** — this should not prompt for payment.
   - *"Blueprint file `render.yaml` not found on main branch"* means the file isn't at the repo
     root on the branch Render is looking at (usually `main`) — check it was actually committed
     and pushed there.
   - *Still asks for payment* — double check you didn't accidentally leave `plan: starter`
     anywhere in `render.yaml`; the version in this project uses `plan: free` throughout.
3. Once deployed, set `CORS_ORIGIN` to your actual Vercel frontend URL (see below).
4. **Run the migration and seed via GitHub Actions** — no local machine or terminal needed
   anywhere. Render's free plan doesn't include Shell access, so instead this project includes
   a workflow you trigger entirely from GitHub's website:
   - In Render, open your `vip-lounge-db` database page and copy the **External Database URL**.
   - In your GitHub repo: **Settings > Secrets and variables > Actions > New repository
     secret**, name it `DATABASE_URL`, paste that URL in. (If you've already added this same
     secret for the image-purge workflow, you can skip this — it's reused.)
   - Go to the repo's **Actions** tab, select **"Run database migration / seed"** from the list
     on the left, click **Run workflow**. Leave "Also run seed data" unticked for a real
     production database, or tick it if you want the demo accounts to test with first.
   - Watch the run in the Actions tab — green check means the tables and security policies are
     now live on your Render database. You only need to do this once (and again any time you
     add a new migration in the future).
5. Note the service URL Render gives you (e.g. `https://vip-lounge-api.onrender.com`) — you'll
   need it for the frontend's `VITE_API_URL`.

### Free-tier limitations worth knowing

- **The web service sleeps** after ~15 minutes of no traffic and takes 30–50 seconds to wake on
  the next request — the first check-in after a quiet period will feel slow. Upgrading to a paid
  instance later removes this.
- **The free Postgres database expires after 90 days** (Render deletes free databases that pass
  their free period) — fine for a pilot/demo, but plan to upgrade to a paid database before going
  live for real, or you'll lose all visit/billing data when it expires.
- **Render's Cron Job service type isn't available on the free plan at all**, which is why the
  30-day image-purge job isn't in `render.yaml` here — see the next section for the free
  replacement.

### Running the 30-day image purge on the free tier

Since Render Cron Jobs need a paid plan, this project includes a **GitHub Actions workflow**
(`.github/workflows/purge-images.yml`) that does the same job for free, on GitHub's scheduler:

1. In Render, open your `vip-lounge-db` database page and copy the **External Database URL**
   (not the internal one — GitHub Actions runs outside Render's network).
2. In your GitHub repo, go to **Settings > Secrets and variables > Actions > New repository
   secret**, name it `DATABASE_URL`, and paste that connection string in.
3. That's it — the workflow runs automatically every day at 03:00 UTC. You can also trigger it
   manually any time from the repo's **Actions** tab (**Purge expired passport/ID images >
   Run workflow**) to test it immediately rather than waiting for the schedule.

### Deploying manually instead of via Blueprint

`render.yaml` is optional — it's just a shortcut. You can create the same two resources by hand
in the Render dashboard if you'd rather not use Blueprint at all:

1. **New > PostgreSQL** — name it `vip-lounge-db`, choose the **Free** instance type, create it.
   Once it's up, open it and copy the **Internal Database URL** (services in the same Render
   account can reach each other over the internal network, which is faster and doesn't count
   against any external bandwidth).
2. **New > Web Service** — connect the same GitHub repo. Render will ask for a **Root
   Directory**: set this to `backend` (this is what `rootDir` did automatically in the
   Blueprint — doing it here achieves the same thing by hand). Set:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
3. Under the new web service's **Environment** tab, add these variables manually:
   - `DATABASE_URL` — paste the Internal Database URL from step 1
   - `JWT_SECRET` — any long random string (Render has a "Generate" button for this)
   - `CORS_ORIGIN` — your Vercel frontend URL (can be set/updated after step in the Vercel
     section below)
   - `PORT` — `4000`
4. Deploy. Once live, continue from step 4 in the Blueprint instructions above — run the
   migration/seed via the GitHub Actions workflow (fully web-based, no local machine needed),
   note the service URL, etc. Everything past the initial resource creation is identical either way.
5. The GitHub Actions image-purge workflow above works the same regardless of which deployment
   method you used — it only needs the database's External URL as a secret.

## Deploying to Vercel (frontend)

1. Push `frontend/` to a GitHub repo (or the same repo, with Vercel's root directory set to
   `frontend/`).
2. In Vercel, **Add New Project**, import the repo, set root directory to `frontend`.
3. Add an environment variable: `VITE_API_URL` = your Render backend URL from above.
4. Deploy. Vercel auto-detects the Vite build (`npm run build`, output `dist/`).
5. Generate a QR code pointing at your Vercel URL's root (`https://your-app.vercel.app/`) —
   that's the passenger check-in entry point for lounge signage.
6. Go back to Render and update `CORS_ORIGIN` to this Vercel URL, then redeploy the backend.

---

## Extending this

- **Move images to object storage**: swap the base64-in-Postgres approach for direct upload to
  S3-compatible storage, storing only the URL on `visits.passport_image_data` /
  `staff_id_image_data`. Update the purge job to delete the object, not just null the column.
- **Scheduled report delivery**: add a cron job (Render supports scheduled jobs natively) that
  queries `/api/visits` per corporate account/tenant on their `report_cadence` and emails a
  generated PDF/CSV via a provider like Postmark/SendGrid/Twilio.
- **Real payments**: wire Stripe (or a local acquirer) into the check-in flow for card payments;
  record the transaction ID on the `visits` row.
- **Flight data validation**: once an airport feed is available, validate `flight_number` and
  auto-fill scheduled time server-side instead of relying on self-report.
- **OCR/MRZ auto-fill**: once passport photos are being captured, an OCR/MRZ read on upload
  could auto-fill name/passport number/nationality instead of the passenger typing them.
