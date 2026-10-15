# KnoaLabs Master Class Registration

Registration page + login-protected admin panel. Leads are stored in **PostgreSQL only** (no CRM, no external API link).

| Part | What it is |
|------|------------|
| `/cybersecurity`, `/datascience`, `/generative-ai`, `/` | Registration pages for ads. The master class comes from the link (aliases like `/genai`, `/cyber`, `/ds` also work) and is saved with the lead, with the page link and UTM tags. `/` is the plain link: saved with no master class |
| `/admin` | Admin panel: sign in with ID + password, lead counts, filters, **Export to Excel** |
| `/admin` → **Master class links** | Default links for **Data Science** (`/datascience`), **Cyber Security** (`/cybersecurity`), **Generative AI** (`/generative-ai`) and the plain link `/`. Type a name under *Add a new master class* (e.g. "Machine Learning") and get its link (`/machine-learning`) to copy. The form heading becomes *Register for the Machine Learning Master Class*. Custom master classes can be deleted; leads already received are kept. The **Ad link builder** adds `utm_source / medium / campaign` tags to a link |
| `/admin` → each lead | **Delete** button on every lead (asks for confirmation, removes it from list, counts, analytics and exports) |
| `/admin/analytics` | **Ad analytics (dark dashboard, live)**: KPIs with sparkline, plain-language signals, master class lines with 7-day average / previous-period overlay, ad channels over time + share, ad performance table (channel x medium x campaign), day-of-week x hour heatmap with best slots, day-by-day table, devices, country codes, cost per lead (type your ad spend), and the original views. Earlier description: refreshes every second; filter by "I am a" (Student / Fresher, Working Professional), by master class (Cyber Security, Data Science, Generative AI, no-course link) and by period; line graphs per master class and per "I am a", KPIs vs previous period, master class × "I am a" table, hour-of-day, traffic source, latest registrations. Filters live in the URL, so a view can be bookmarked |
| `POST /api/leads` | The only public API (used by the form) |

## Run locally

```bash
npm install
cp .env.example .env        # fill DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET
docker compose up -d        # local PostgreSQL (or point DATABASE_URL at any Postgres)
npm start                   # migrations run on start -> http://localhost:8080/cybersecurity
npm run stop                # free the port if an old instance is still running
npm run db:check            # read-only database health check
npm test                    # all checks, no database needed (in-memory Postgres)
```

If the port is already taken the start fails with `Port 8080 is already in use` - an older instance
(probably an older build) is still running: stop that process first, then start again. `/ready` answers
with the running version, so you can always confirm which build is live.

## Look and feel

`public/ui.css` is the one shared design layer (colours, type, inputs, dropdowns, buttons, error messages). The registration form, sign-in page and both dashboards load it first and only add layout in their own stylesheet, so a control looks and behaves the same everywhere. `docs/ui-model.html` shows the design on its own. Breakpoints: form, phone under 520px; dashboards, phone under 720px (rows become cards) and tablet under 1100px.

## Registration form

Common: first name, last name, mobile / WhatsApp (country code: IN +91, UAE +971, USA +1, UK +44, Canada +1, Australia +61, Gulf, Singapore, Other), email (optional), **I am a** (two cards).
- **Student / Fresher:** course (chips), current status (chips), college name (optional), specialization / branch (optional dropdown)
- **Working Professional:** total experience (chips), current role / domain (dropdown), current company (optional), highest qualification (optional dropdown)

All lists live in `src/options.js` and `src/countries.js`; the browser and the server validator read the same lists.

## Admin panel

Open `/admin`. Sign in with the ID and password from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
(that admin is created on first start; remove `ADMIN_PASSWORD` from the env afterwards).

- **Counts:** total, today, last 7 days, last 30 days, split by "I am a" and by master class
- **Table:** search (name, mobile, email, college, company), filter by "I am a", master class and date range, pagination
- **Export to Excel:** downloads `knoalabs-leads-YYYY-MM-DD.xlsx` (sheet *Leads* + sheet *Summary*) and follows the filters on screen
- **Add / change an admin:** `npm run admin:set -- <id> [password]` (changing a password signs that admin out everywhere)

Security: passwords are stored as salted scrypt hashes; the login cookie is signed, `HttpOnly`, `SameSite=Strict`, limited to `/admin`, and expires (default 8 h);
login attempts are throttled per IP; the dashboard HTML is never served without a valid session; IP and user agent are never sent to the browser or exported.

## Project structure

```
server.js              App wiring: headers/CSP, logging, routes, errors, startup, graceful shutdown
src/config.js          Env -> config + startup validation (lists every problem)
src/options.js         Form choices + default course names (one source for browser and server)
src/courses.js         Master class registry: keeps the courses table and options.COURSES in sync, name -> link rules
src/models/Course.js   Courses table model
src/countries.js       Phone rules (one source for browser and server)
src/validate.js        Server-side validation + phone normalisation (E.164)
src/leads.js           POST /api/leads
src/admin.js           /admin pages and /admin/api (login, logout, stats, analytics, leads, leads.xlsx)
src/analytics.js       Live analytics maths: day windows in TIMEZONE, per-course / per-status series, totals (pure, unit-tested)
src/auth.js            Password hashing, signed session cookie
src/export.js          Excel workbook builder (exceljs)
src/time.js            Time-zone helpers (TIMEZONE, default Asia/Kolkata)
src/models/Lead.js     Lead model: create / createOnce / list / filters / stats
src/models/Admin.js    Admin user model
src/db.js, migrate.js, logger.js, rateLimit.js
migrations/            001-004 (original) + 005 (removes CRM columns, adds admin_users) + 006 (specialization, highest qualification) + 007 (courses table, 3 defaults seeded)
scripts/               migrate.js, admin.js
public/                register.html / .css / .js, ui.css (shared design layer), logo, favicon
admin/views, assets    login + dashboard + analytics pages and their css/js
docs/ui-model.html     Design reference: colours, type, controls, phone / tablet / laptop behaviour
test/                  migrate/model, registration, admin, production, UI-consistency tests
```

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET` (production), and `ADMIN_USERNAME` + `ADMIN_PASSWORD` for the first admin.
`TIMEZONE` (default `Asia/Kolkata`) decides what "today", the date filters and the Excel times mean.

## Master classes (adding a course)

Sign in, open **Leads**, scroll to *Master class links*, type the name, press **Create link**, then **Copy link**.
Rules: 2-60 characters, English letters or digits must be present (they become the link); names that clash with an existing
course, an alias (`ds`, `genai`...) or a system word (`admin`, `api`...) are refused. The three defaults cannot be deleted.
A deleted master class link keeps working as a generic form (the name is derived from the link) so old ads do not break.

## Ad analytics notes

- Ads are matched through the link tags (`utm_source`, `utm_medium`, `utm_campaign`) or, when missing, the referring site. Use the **Ad link builder** for every ad.
- The form cannot see impressions or clicks, so click-through rate is not available. **Cost per lead** uses the ad spend you type for the period (saved in that browser only).
- Devices come from the browser user-agent and countries from the phone code; neither phone numbers nor user-agents are sent to the dashboard.

## Database

`npm run migrate` / `npm run migrate:status`. Migration `005` is safe on a database that already ran 001-004:
it drops only the CRM columns, keeps every existing lead (including old "intent" / "background" answers), and adds `admin_users`.
Migration `006` adds the `specialization` (student) and `highest_qualification` (professional) columns.
Never edit an applied migration; add a new numbered file.

## Deploy (DigitalOcean App Platform)

1. Managed PostgreSQL: copy the connection string (and CA certificate).
2. Create the app from the repo: run command `npm start`, HTTP port `8080`, health check `/health`.
3. Env: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=true`, `DATABASE_SSL_CA`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (mark secrets *Encrypted*).
4. Keep `TRUST_PROXY=1` so the login cookie gets the `Secure` flag and rate limits see real IPs.

## Checking which build is live

`GET /ready` returns `{"ok":true,"db":"up","version":"3.2.0"}`. If the live site shows an older version (or no `version`), it is running an old deploy: redeploy, then reload with a hard refresh. If the admin dashboard shows an error banner, it names the failing request and its HTTP status.

## Known limits

- Rate limiting is in memory per instance; with several instances also limit at the edge (Cloudflare / load balancer).
- Leads hold personal data. Decide a retention period and restrict database access.
- Logins are stateless cookies: "Sign out" clears this browser; to end all sessions change the password or `SESSION_SECRET`.
