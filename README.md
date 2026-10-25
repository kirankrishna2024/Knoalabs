# KnoaLabs Master Class Registration

Registration page + login-protected admin panel. Leads are stored in **PostgreSQL only** (no CRM, no external API link).

| Part | What it is |
|------|------------|
| `/cybersecurity`, `/datascience`, `/generative-ai`, `/` | Registration pages for ads. The master class comes from the link (aliases like `/genai`, `/cyber`, `/ds` also work) and is saved with the lead, with the page link and UTM tags. `/` is the plain link: saved with no master class |
| `/admin` | Admin panel: sign in with ID + password, lead counts, filters, **Export to Excel** |
| `/admin/forms` → **Form Studio** | Every registration form and its link. **New form** takes a name only (e.g. *Student Intake* → `/student-intake`): it starts as the standard registration form, goes live at once and can be edited, versioned and published like the built-in ones. Search, **Show archived**, **Archive / Restore**, **Open page** and a green **Ad running** badge with the campaign count are on the list |
| `/admin/campaigns` | Campaigns belong to a **form** (one form → many campaigns). At most one campaign per form is active: its tags are what the form's plain link forwards to. The dialog asks for the campaign name (letters only, 3–40), the form, the medium (paid by default), optional dates and notes. There is no source field: the ad platform is auto-detected (see *Auto-detect* below) |
| `/admin` → each lead | **Delete** button on every lead (asks for confirmation, removes it from list, counts, analytics and exports) |
| `/admin/qr` | **QR generator (v3.7)**: build a tagged ad link (or paste any link) and download its QR code as **PNG**, **JPEG** or **SVG**. See *QR generator and link search* below |
| `/admin/analytics` | **Live ad analytics** (refreshes every second; light white + green theme). Filters: "I am a" (Student / Fresher, Working Professional), master class, campaign, channel, medium, **Meta app (Facebook / Instagram, v3.8)** and period. KPIs with sparkline, plain-language signals, master class lines (7-day average / previous-period overlay), ad channels over time and share, ad performance table (channel x medium x campaign), **Meta ads: Facebook vs Instagram** panel, day-of-week x hour heatmap with best slots, day-by-day table, devices, country codes, cost per lead (type your ad spend), master class x "I am a" table, latest registrations. Filters live in the URL, so a view can be bookmarked. See *campaign drill-down*, *link opens*, *QR generator and link search* and *Meta ads* below |
| `POST /api/leads` | The only public API (used by the form) |

## v3.12: new Knoalabs branding

- Logo from the brand PDF as vector files in `public/`: `logo.svg` (white wordmark, for dark headers: registration page, sign-in, preview, every admin header), `logo-dark.svg` (dark wordmark, for light backgrounds), `favicon.svg` / `favicon.png` / `apple-touch-icon.png` and `logo.png` (the bulb mark on the dark brand square; also the QR code centre logo). The old logo and the typed "KnoaLabs" next to it are gone from every page.
- Brand colours as design tokens in `public/ui.css`: primary `#0E2C2B` (page background, gradient, Excel headers), secondary `#E7EFD8` (soft panels), icon `#20C285` (`--green`, accents), font `#0D201F` (`--ink`, text). The old green and ink values were replaced everywhere.

## v3.11: analytics follows each form (dynamic questions)

- **The form decides what analytics shows.** Choose a master class and only the questions *that form still asks* appear. A form without "I am a" has no "I am a" filter, no I-am-a chart or Master class × "I am a" table, no Students / Professionals columns; a form without the student (or professional) questions has no Students (or Professionals) panel, and individual ranks (course, year, branch, college, role, experience, qualification) disappear one by one. With no master class chosen the page defaults to all live forms, so nothing is lost.
- **Custom questions get their own breakdown** (*Answers to this form's own questions*): questions added in Form Studio (choice, multi-choice, yes/no, short text, number) are counted automatically for the form(s) in view; with several forms the card says which master classes ask it. API: `GET /admin/api/analytics/fields` (same filters as the page).
- **Removing a question** (in Form Studio) takes it off the analytics page, the "where people stop" list and every filter, while the answers stay in the database and the Excel exports.
- **Fixed (end to end)**: publishing a form without "I am a" (or without names / mobile) made every registration fail with HTTP 500, because those database columns were mandatory. Migration `024_leads_optional_answers.sql` makes them optional; a form only has to keep a phone or email.

## v3.10: leads behind the numbers, auto-detected sources, campaign rules

- **Leads in this view** (Live analytics, just above *Registrations by master class*): click **Show leads** to list the people behind the current filters. Nothing selected = everyone. The dropdown switches between **Registered leads**, **Did not register** (visitors who opened the link and left: source, browser, place, how far they got in the form) and both. Click a row for everything collected. **Download Excel** gives one sheet of registered leads (every answer, source, browser, place) and one of visitors who did not register. Campaign table rows have a **View leads** button. API: `GET /admin/api/analytics/leads` and `.xlsx` (same filter parameters as the analytics page, plus `kind=registered|unregistered|all`).
- **Traffic sources detected**: WhatsApp, QR scan, ChatGPT / AI, short / bio links (Linktree, bit.ly ...), Meta, Google, Email, Snapchat, Pinterest, Quora and any referring website, with how each was found (tag, click id, in-app browser, referring site). QR codes from the QR generator carry `utm_medium=qr`; ChatGPT adds `utm_source=chatgpt.com` itself. A QR code printed with the plain link (no tags) cannot be told apart from a direct visit.
- **Browsers**: links opened inside Instagram, Facebook, Messenger, WhatsApp, LinkedIn, Telegram, TikTok, Snapchat ... are listed as that app's in-app browser, not Chrome. Also Samsung Internet, Edge, Opera, Mi / Huawei / UC / Yandex / DuckDuckGo / Vivaldi, Android and iOS web views.
- **Browsers / Opened inside an app / How the source was found** (v3.14): each row shows **everyone who opened the page** next to **the people who registered**, so a browser, app or signal that sends visitors but no registrations is still visible (`visitors` in `GET /admin/api/analytics`). The visitor numbers follow the period, master class and campaign; they cannot be split by "I am a", channel or medium because a visitor has not answered anything yet.
- **Leads tab**: the Source column shows the detected source (same rules as analytics), how it was found, the referring site, campaign and browser; new Source and Campaign filters; the Excel export has the same columns.
- **Where people come from**: its own period, in a fixed order (Today, Last 24 hours, Yesterday, Last 2 days, 7, 14, 30, 90 days, All time, Same as the page period). It opens on **Same as the page period**, so the map never disagrees with the numbers above it. It follows every filter of the page; a refresh does not reset the zoom, position, layers or tab. **India** frames the whole country (Kerala to Kashmir). Registered people are green dots, visitors who did not register are amber rings drawn on top, and each layer is scaled on its own so the green dots stay visible where both share a city.
- **Campaign rules** (`CAMPAIGN_ENFORCE`, default on): only a campaign added in the Campaigns tab and **running** counts. A link with any other `utm_campaign`, or none, is redirected to the form's running campaign (source and medium in the link are kept); a registration, visit or tracker event with an unlisted campaign is saved under the running campaign, or with no campaign when none runs. Leads are never rejected. Ad links (Form Studio *Links & QR* and the QR generator) can only use a running campaign, picked from a list; nothing is typed. Set `CAMPAIGN_ENFORCE=false` to turn the rules off.
- **Fixed**: the plain-link redirect dropped extra parameters such as `fbclid` (a mis-escaped pattern); `/admin/config.js` failed because the options module was not imported.

## Live analytics: master class → campaign drill-down (v3.4)

Under the master class chips the filter bar now has a **Campaign** row. It shows the campaigns that ran inside the selected master class:
click **Data Science** and the row lists only Data Science campaigns (e.g. `ds-reels`, `ds-search`, *no campaign*), each with its registration count;
click **All** and every campaign appears. Pick a campaign and every number, chart, table and the live feed narrow to it.

| Filter | Source of the value | Notes |
|--------|---------------------|-------|
| I am a | `status` | Changing it clears the campaign (the campaign list changes with it) |
| Master class | `course_slug` | Chips show how many registrations each master class has with the other filters applied |
| **Campaign** | `utm_campaign` | Scoped to the selected master class; *(no campaign)* = leads without the tag; more than 10 campaigns -> top 10 as chips + a "More campaigns" dropdown |
| **Channel** | `utm_source`, else the referring site | **Meta** (Facebook + Instagram together), Google ... or *Direct / no tag* |
| **Medium** | `utm_medium` (case-insensitive) | paid, cpc, social ... or *(none)* |

Counts next to each option are **faceted**: they are the leads you would see after choosing that option while keeping the *other* filters. A selected option that has no leads stays listed at 0 so you can always see (and remove) what is active. The **Showing** row lists the active filters as removable tags; **Reset** clears everything.

New panels on the page:
- **Master class → campaigns**: the whole hierarchy in one tree (each master class with its campaigns and counts). Clicking a master class or a campaign sets the filters. It ignores the master class / campaign filters on purpose, so you can hop between branches, but follows period, "I am a", channel and medium.
- **Campaigns over time**: daily line per campaign (top 6), with the same running-total / previous-period controls as the other charts.
- **Campaign performance**: one row per campaign with registrations, share, students vs professionals, a trend sparkline, top channel, top master class and last lead. Click a campaign name to focus on it.
- Ad spend (for cost per lead) is remembered per period **and** per master class / campaign / channel / medium combination.

All filters are in the URL (`?course=datascience&campaign=ds-reels&channel=Instagram&medium=paid`), so a view can be bookmarked or shared. `__none` stands for "no campaign" / "no medium". The API (`GET /admin/api/analytics`) takes the same `course`, `campaign`, `channel`, `medium`, `status`, `days` / `from` / `to` parameters; values are plain text, length-capped and always bound as SQL parameters. No database migration is needed: campaigns come from the `utm_campaign` column that was already being saved.

## v3.9.1 fixes (older)

- **Leads page and Live analytics:** the *Master class links* block and the builder / QR scripts it loaded are gone. Forms are created in **Form Studio**, campaigns in **Campaigns**, and the shared confirm / copy / toast helpers live in `admin/assets/kit.js`. `test/pages.test.js` still fails if any admin page forgets a script its code uses.
- **Ad link builder:** the *Running this on Meta? Paste these into Ads Manager* box (Website URL / URL parameters) is gone. It shows only the link, **Copy link** and **Download QR code** (PNG / JPEG).
- **Find a link:** the separate *Link details* card is gone. A pasted link selects the normal master class, campaign, channel and medium filters and the whole page follows.

## Ad link builder, link opens by app (v3.9)

**The link is only given out when it is complete.** In the *Ad link builder* (the studio's **Links & QR** dialog and the *QR generator*) and in the *QR generator*, nothing is pre-selected. The link, **Copy ad link**, **QR code** and the PNG / JPEG / SVG downloads appear only after all three are filled: **master class**, **medium** and **campaign name**. Until then a yellow line says what is still missing (e.g. "add: medium, campaign name"). Campaign names are written the way they are saved in the link (`DS Oct Reels` becomes `ds-oct-reels`) and the page shows that before you copy it. *Where the ad runs* keeps Meta as its default.

**Master class is a search box, not a dropdown.** Click it to see every master class, or type part of a name to filter (`mach` finds *Machine Learning*). Pick with the mouse, a tap, or Up / Down + Enter. Editing the text after a pick clears the pick, so the link can never name a master class you did not choose. **No master class (plain link)** is the last entry of the list, so the general link is a deliberate choice. If nothing matches, the box says to add the master class first. The list scrolls, so it keeps working with any number of master classes.

**Link opens are split by Facebook and Instagram.** Live analytics shows total opens and the split per period, per placement and per campaign (*Meta ads: Facebook vs Instagram*). Opens that did not come from Meta ads are only in the total.

**Fixed:** a Meta macro that was never filled in (`placement={{placement}}` in a link opened outside an ad) used to be saved as a placement called "placement". It is now ignored.

## QR generator and link search (v3.7)

**Meta is one source.** The Ad link builder no longer has separate *Facebook* and *Instagram* entries: pick **Meta (Facebook & Instagram)** and the link carries `utm_source=meta`. In the analytics, `facebook`, `fb`, `instagram`, `ig`, `meta` and referrers such as `l.facebook.com` / `l.instagram.com` are all counted as one channel, **Meta** (older links that were tagged `instagram` or `facebook` are merged into it too). The Facebook / Instagram split needs nothing extra: the server reads which app the visitor opened the link in (see *Meta ads: Facebook vs Instagram* below). Channel stays **Meta** everywhere; the app is a separate filter.

**Find a link (Live analytics).** Above the filters there is a search box. Paste any registration / ad link and the page selects the normal **master class, campaign, channel and medium** filters by itself and sets the period to 90 days; all the numbers, charts and tables on the page then show that link (there is no separate *Link details* card). A one-line message says what was selected, and adds a note when the link has no tracking tags, is on another website, or has a path that is not a master class on this site. You can also type a word (a campaign, channel, medium or master class name): one match is applied, several matches are offered as buttons. Tags that are missing from the link are not filtered. Nothing is stored and the link is never opened by the server (`GET /admin/api/link-lookup?url=...` only reads the text).

**QR generator (`/admin/qr`, third tab).** Step 1: build the link (master class, source, medium, campaign; choose medium `qr` so QR scans show up as their own medium in the analytics) or switch to *Use any link*. Step 2: choose size (512 / 1024 / **2048 recommended** / 4096 px), error correction (L / M / **Q** / H), colour, border, optional KnoaLabs logo (forces level H), then **Download PNG** (lossless, best for print), **JPEG** (98 % quality, smallest for WhatsApp / email), **SVG** (vector, any size) or **Copy image**. The same dialog opens from the **Download QR code** button in the Ad link builder.

- **Made in the browser.** The QR code is drawn locally with the bundled MIT-licensed `admin/assets/vendor/qrcode.js` (Kazuhiko Arase). No external QR service is called (the admin pages' security policy only allows our own scripts and images, and your campaign links stay private). The files are exactly the size you choose; every square is a whole number of pixels, so edges stay sharp when printed.
- **Use your live address.** The link is built from the address you opened the admin on. On `localhost` the page warns that nobody else can open that link: open the admin on your real domain before printing.
- **Tested.** `npm test` encodes links, renders them like the browser does and scans them back with a QR reader (`jsqr`, dev dependency) at all four error-correction levels.

## Meta ads: Facebook vs Instagram (v3.8)

**Can we see whether a Meta ad click came from Facebook or Instagram? Yes.** A normal link cannot tell, but Meta replaces two placeholders with the real values at the moment of the click, and the registration page now records them:

| Placeholder (Meta fills it in) | Becomes | Stored as |
|---|---|---|
| `{{site_source_name}}` | `fb`, `ig`, `msg` or `an` | **Facebook**, **Instagram**, **Messenger**, **Audience Network** (column `meta_platform`) |
| `{{placement}}` | e.g. `Facebook_Mobile_Feed`, `Instagram_Reels`, `Instagram_Stories` | the placement text (column `meta_placement`) |

### Set it up (nothing extra needed)

1. In the **Ad link builder** (Leads or Live analytics page) choose the master class, **Where the ad runs = Meta (Facebook & Instagram)**, medium (`paid`) and your campaign name. The builder shows only the finished link, with **Copy link** and **Download QR code**.
2. Use that link as the ad's **Website URL** in Meta Ads Manager. Facebook and Instagram are told apart automatically from the app the visitor opened the link in.
3. *Optional, for the exact placement (Reels, Stories, Feed):* in Ads Manager > **Tracking > URL parameters** add only `site_source_name={{site_source_name}}&placement={{placement}}` (typed as shown, not URL-encoded). Do not repeat the `utm_*` tags there: they are already in the link.
4. Within seconds of the first click the **Meta ads: Facebook vs Instagram** panel on the analytics page lists the app, and the lead gets the app in the Excel export (columns *Meta app* and *Meta placement*).

**Test it before spending money.** Open this on your phone (use your real domain): `https://YOUR-DOMAIN/datascience?utm_source=meta&utm_medium=paid&utm_campaign=test&site_source_name=ig&placement=Instagram_Reels`. After a refresh the **Instagram** row of the panel shows one more link open. Change `ig` to `fb` to test Facebook. Test registrations can be deleted from the leads list; test link opens cannot be deleted from the admin, so keep the campaign name `test` and filter it out by campaign (or use the SQL line under *Link opens*).

### What the panel shows

- One row per Meta app: **link opens**, **registrations**, **conversion** (registrations / opens, shown as – when there are more registrations than opens), share, students / professionals. Facebook and Instagram are always listed, even at 0.
- **Placements** below it: registrations and opens per placement (Instagram Reels, Facebook Feed ...), to see *where inside the app* the ad works.
- Click an app to filter the whole page (KPIs, charts, tables, live feed) to it; click again, or the tag under *Showing*, to remove it. In the URL it is `?platform=Instagram`. In the API: `GET /admin/api/analytics?platform=Facebook` (`platform=__none` = everything that is not Meta). Link search also understands a pasted link that already contains `site_source_name=ig`.
- If some Meta registrations cannot be split, the panel says how many (**Meta (unknown)**): those links did not carry the placeholders.

### How the app is decided (first rule that names an app wins)

1. `site_source_name` in the link (Meta's own value). 2. `utm_source` when it is `facebook`, `fb`, `instagram` or `ig` (older links, or `utm_source={{site_source_name}}`). 3. The start of `placement` (`Facebook_...`, `Instagram_...`). 4. The referring site (`l.instagram.com`, `l.facebook.com`, `m.facebook.com` ...). 5. The in-app browser of the Instagram / Facebook / Messenger app (read from the browser string at that moment; **the browser string is not stored with link opens**). Meta clicks that name no app are kept as *Meta (unknown)*. A link tagged for another channel (Google, email ...) is never labelled Meta, whatever app opened it.

### Good to know

- **Older data:** nothing is rewritten. Leads and opens from before v3.8 are still split on the page where their `utm_source` (`instagram`, `facebook`, `ig`, `fb`), referrer or saved browser string named the app; the rest show as *Meta (unknown)*. The all-time number is shown as – while a Meta-app filter is on.
- **Link opens vs Meta's clicks:** Meta counts a click when it happens; an open is counted when the page loaded. Expect opens to be lower than Meta's *link clicks* (slow connections, closed tabs). One person opening the ad once from Facebook and once from Instagram on the same day is two opens, one per app.
- **Boosted posts and links you place by hand** (bio link, story sticker, organic post) do not go through Ads Manager's *URL parameters* field, so Meta does not fill the placeholders. They are usually still split because the in-app browser or the referrer names the app; whatever cannot be told stays *Meta (unknown)*. You can also type `site_source_name=ig` (or `fb`) into such a link yourself.
- **`fbclid`:** Meta adds its own click id to ad links. The page only uses the fact that it is present, as proof that the click came from Meta; the id is not stored on its own (the full page link, which contains it, is still saved with each lead, as before).
- **Messenger / Audience Network** appear in the panel only when they have traffic.
- **Privacy:** per link open the app name and placement are stored in addition to the fields listed under *Link opens*. Mention in your privacy notice that you record which app a visitor came from.
- **Database:** migration `010_meta_platform.sql` (adds `meta_platform`, `meta_placement` to `leads` and `page_visits`). It runs with the normal deploy (PRE_DEPLOY job on DigitalOcean) and is safe to run on a database that already has data.

## Link opens: how many times the ad link was opened (v3.4, refined in v3.5.1)

Registrations only show who filled in the form. **Link opens** shows how many people opened the registration link, so you can see how many of them registered.

- **Where you see it:** a **Link opens** card on `/admin/analytics` (with "x% registered"), **Link opens** and **Conversion** columns in the *Campaign performance* table (a campaign people opened but nobody registered through still gets a row), and next to each campaign in **Campaigns**. The numbers follow the same filters as everything else (master class, campaign, channel, medium, period).
- **What counts as an open:** the registration page loaded in a real browser (a small script on the page reports it to `POST /api/visit`). One visitor counts **once per day per link** (the day follows `TIMEZONE`, India by default, the same day the analytics page uses), so a refresh does not add one. Only real master class links count: a stray path such as `/typo` is ignored. An open is a visit, not a unique person: someone who opens two different ad links counts twice. Crawlers, WhatsApp / Facebook / Slack link previews, headless browsers and scripts are ignored.
- **It is not the ad platform's click number.** Facebook / Google count a click when it happens; an open is counted only if the page actually loaded. Expect opens to be somewhat lower than the platform's clicks (slow connections, people who close the tab).
- **"I am a" filter:** opens show "–" when Students or Professionals is selected, because a visitor has not chosen yet.
- **Conversion** = registrations / opens. It shows "–" when there are more registrations than opens (leads from before the counter started, or a visitor whose browser blocks the script), never a percentage over 100.
- **Counting starts when v3.4 is deployed**: older visits were never recorded, and the card says "counting since <date>".
- **Privacy:** stored per visit: time, master class, the three UTM tags, the *host name* of the referring site and, for Meta traffic, the Meta app and placement (never the full URL, IP address or user agent). The visitor id is a random string kept in the visitor's browser (`localStorage`, or `sessionStorage` when the browser blocks it) and is used only to avoid double counting; it is never sent to the admin pages. Add a line about this to your privacy notice if you publish one.
- **Abuse limits:** 600 beacons per IP per 10 minutes (high on purpose: a whole college can share one IP); the endpoint answers `204` and never returns data.
- **Database:** migration `009_page_visits.sql` (runs on start when `AUTO_MIGRATE` is on, otherwise `npm run migrate`). The analytics page reads visits already grouped into 15-minute slots, so it stays fast with many visitors. The table grows with traffic: to keep it small, delete old rows from time to time, e.g. `DELETE FROM page_visits WHERE created_at < now() - interval '13 months';`.

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
src/analytics.js       Live analytics maths: day windows in TIMEZONE, filters (status / master class / campaign / channel / medium / Meta app) with per-option counts, per-course / per-campaign series, tree, totals (pure, unit-tested)
src/linkparse.js       Reads a pasted link into master class / channel / medium / campaign / Meta app (link search)
src/meta.js            Which Meta app (Facebook / Instagram / Messenger / Audience Network) and placement a click came from (pure, unit-tested)
src/auth.js            Password hashing, signed session cookie
src/export.js          Excel workbook builder (exceljs)
src/time.js            Time-zone helpers (TIMEZONE, default Asia/Kolkata)
src/models/Lead.js     Lead model: create / createOnce / list / filters / stats
src/models/Visit.js    Link opens: record (one per visitor / day / link), grouped counts for analytics
src/visits.js          POST /api/visit (the open counter beacon: bots ignored, rate limited)
src/models/Admin.js    Admin user model
src/db.js, migrate.js, logger.js, rateLimit.js
migrations/            001-004 leads (original) · 005 removes CRM columns, adds admin_users · 006 specialization + highest qualification · 007 courses table (3 defaults) · 008 index repair · 009 page_visits (link opens) · 010 Meta app + placement
scripts/               migrate.js, admin.js
public/                register.html / .css / .js, ui.css (shared design layer), logo, favicon
admin/views, assets    login + dashboard + analytics + QR generator pages and their css/js (builder.js = shared link builder, qr.js = QR maker, vendor/qrcode.js = QR library; every page loads the scripts it needs, checked by test/pages.test.js)
docs/ui-model.html     Design reference: colours, type, controls, phone / tablet / laptop behaviour
test/                  form validation, analytics maths, campaign (SQL), visits (link opens), Meta app (Facebook / Instagram), database layer, migrations, registration, admin, production, UI-consistency, QR / link search tests
```

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET` (production), and `ADMIN_USERNAME` + `ADMIN_PASSWORD` for the first admin. On DigitalOcean also `CLIENT_IP_HEADER=do-connecting-ip` (see Deploy).
`TIMEZONE` (default `Asia/Kolkata`) decides what "today", the date filters and the Excel times mean.

## Forms and campaigns

**A form** is one registration page with one link. The built-in forms (Data Science, Cyber Security, Generative AI) belong to their master
classes. **Form Studio → New form** creates another one from a name only (2-60 characters): *Student Intake* becomes `/student-intake`, starts as
the standard registration form and is live immediately. Its name becomes the link; names that clash with an existing form, master class,
alias (`ds`, `genai`...) or a system word (`admin`, `api`...) are refused. Archived forms can be restored; their versions and leads are kept.

**A campaign** belongs to a form; one form can run many campaigns. At most one is **active**, and the form's plain link forwards to it
(`/student-intake?utm_medium=paid&utm_campaign=student-intake-ads`). Open **Campaigns → New campaign**, give it a name (letters only,
3-40, starting with a letter), pick the form, medium (paid by default) and optional start / end dates and notes. **Source is not typed:**
when somebody opens the link, the ad platform is auto-detected from the click id (`gclid`, `fbclid`, `msclkid`, `li_fat_id`, `ttclid`),
the referrer or the in-app browser and stored with the lead and the link open. Leads and opens are still grouped by the campaign tag.

## Location and Meta Pixel

**Exact location (optional).** The registration page asks the browser for location only when it is useful: if the person already allowed
location for this site, the position is read silently; if a recent position is already stored in their browser, nothing is asked again;
if they blocked it, it is never asked again. Otherwise the browser's own permission prompt appears on their first interaction. Nothing is
sent when they do not allow it. The coordinates are stored on the lead (`browser_lat`, `browser_lon`, `browser_accuracy`, `browser_geo_at`)
and on the link open, and the map uses them when present.

**Approximate location from the IP (no API key).** `src/geo.js` looks the visitor's IP up with **ip-api.com**
(`GET http://ip-api.com/json/{ip}`, for example `http://ip-api.com/json/117.202.180.86`) and keeps city, region, country, coordinates (2 decimals),
timezone, UTC offset, ISP / organisation, ASN, plus the country calling code and EU flag it derives (never the raw IP). Set in the environment:

```
GEO_PROVIDER=ip-api          # no key needed. (ipapi = https://ipapi.co/{ip}/json/, maxmind = local database, none = off)
GEO_IP_SALT=<16+ characters> # required in production: IPs are stored only as salted hashes
GEO_DAILY_LIMIT=50000        # optional safety cap on lookups per day
GEO_IPAPI_COM_KEY=           # optional: a paid ip-api.com key switches to the HTTPS pro endpoint
```

The lookup runs after the registration has been answered, so it can never delay or lose a lead. The free ip-api.com endpoint allows
45 requests a minute, so calls are spaced out and queued; when it is rate limited (it names the wait in `X-Ttl`) or down, **ipapi.co** answers
instead (using `GEO_API_KEY` if you set one), then MaxMind when `GEOIP_DB_PATH` is set. Two things to know about the free ip-api.com plan:
it is **HTTP only** (the visitor IP travels unencrypted from the server to ip-api.com) and its terms allow **non-commercial use only**;
a paid key (`GEO_IPAPI_COM_KEY`) fixes both.

**Map on Live analytics.** Two layers that are never mixed: **Registered** (solid green dots) and **Did not register** (amber rings: visitors who
opened the page and have no registration). Each layer has its own switch and count, the tooltip of a place shows both numbers, and the
Countries / States / Cities lists switch between the two groups. Visitors only get a location when `GEO_VISITORS=true` (the default) and
`GEO_PROVIDER` is on; visitors seen before that stay "unknown". **Every graph card has a Full screen button** (Esc closes it): line charts and the
map keep their own zoom, every other card (donuts, ranked bars, heatmap, funnel, tables) gets + / - zoom while it is open.

**Meta (Facebook) Pixel.** The manager's snippet for pixel `2822992388094391` is in `<head>` of `public/register.html` (as `/pixel.js`, because the
strict CSP blocks inline scripts): it loads `fbevents.js`, then `init` and `PageView`. `register.js` sends `Lead` after a successful registration.
The pixel id is fixed in the code: there is **no Meta Pixel ID box in the admin panel any more** (to change the pixel, edit `fbq('init', ...)` in
`public/pixel.js` and the `<noscript>` image in `register.html`). It fires on every registration page, including forms created in Form Studio.

**Database:** migrations `016_form_campaigns_auto_source.sql` (campaigns per form, auto-detected source on link opens) and
`017_browser_geo.sql` (exact browser coordinates). Both only add columns / indexes; no existing row is changed or removed.

## Ad analytics notes

- Ads are matched through the link tags (`utm_source`, `utm_medium`, `utm_campaign`) or, when missing, the referring site. Use the **Ad link builder** for every ad. For Meta ads also paste the *URL parameters* it shows (see *Meta ads: Facebook vs Instagram*).
- The form cannot see impressions or clicks, so click-through rate is not available. **Cost per lead** uses the ad spend you type for the period (saved in that browser only).
- Devices come from the browser user-agent and countries from the phone code; neither phone numbers nor user-agents are sent to the dashboard.

## Database

`npm run migrate` / `npm run migrate:status`. Migration `005` is safe on a database that already ran 001-004:
it drops only the CRM columns, keeps every existing lead (including old "intent" / "background" answers), and adds `admin_users`.
Migration `006` adds the `specialization` (student) and `highest_qualification` (professional) columns. Migration `009` adds `page_visits` (link opens) and `010` the Meta app / placement columns.
Never edit an applied migration; add a new numbered file.

## Deploy (DigitalOcean App Platform)

The repo ships a ready spec: `.do/app.yaml` (web service from the `Dockerfile`, health check `/health`, a **PRE_DEPLOY migrate job**, all env vars).

1. Push the project to GitHub (`.env` is git-ignored: never commit it).
2. Edit `.do/app.yaml`: set `github.repo` (twice) and the `region`. Then `doctl apps create --spec .do/app.yaml`, or *Apps > Create > Import App Spec*.
3. In *Settings > App-Level Environment Variables* fill the secrets: `DATABASE_URL` (managed PostgreSQL, **direct port 25060**), `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
4. Add the app to the database's *Trusted Sources*, deploy, then open `/ready`: it must show `"db":"up"` and the version.
5. After the first login remove `ADMIN_PASSWORD` from the env.

Important settings (already in the spec):
- `CLIENT_IP_HEADER=do-connecting-ip` **is required on App Platform.** There `X-Forwarded-For` is DigitalOcean's ingress, not the visitor, so without it every visitor shares one rate limit and the site answers `429` after 10 registrations in 10 minutes. Leave it empty on any other host.
- `TRUST_PROXY=1` keeps the login cookie `Secure`.
- `AUTO_MIGRATE=false` on the web service; the PRE_DEPLOY job runs `node scripts/migrate.js` first, so a failed migration fails the deploy and the live version keeps running.
- Keep `instance_count: 1` (rate limits are in memory per instance).

Security hygiene: if a `.env` with real values was ever shared or zipped, rotate the database password, `SESSION_SECRET` and the admin password.

## Checking which build is live

`GET /ready` returns `{"ok":true,"db":"up","version":"4.0.0"}`. If the live site shows an older version (or no `version`), it is running an old deploy: redeploy, then reload with a hard refresh. If the admin dashboard shows an error banner, it names the failing request and its HTTP status.

## Known limits

- Rate limiting is in memory per instance; with several instances also limit at the edge (Cloudflare / load balancer).
- Leads hold personal data. Decide a retention period and restrict database access.
- Logins are stateless cookies: "Sign out" clears this browser; to end all sessions change the password or `SESSION_SECRET`.

## v4.0.0: Form Studio, campaigns, tracking, insights
See `docs/PROGRESS.md` for what each part does, the new settings and what still needs checking on a real PostgreSQL and a real browser. New admin pages: **Form Studio** (`/admin/forms`) and **Campaigns** (`/admin/campaigns`). New tests: `npm test` now also runs the renderer, Form Studio API and screen, tracking and insights suites.
