# Progress (v4.0.0)

All of R1–R14 is now built and covered by automated tests (`npm test`, 22 suites, about 600 checks). Items that could not be verified in the build sandbox are listed at the bottom: please read that part before going live.

## What was built

| Req | What it is | Where |
|---|---|---|
| R3 | **Public form drawn from the stored definition.** The server embeds the published definition in the page (a JSON data block, so the strict CSP is unchanged); `public/render.js` draws it. `POST /api/leads` validates against the same definition (the version the visitor saw, if it is still current or older), with the built-in form as a fallback so a form-engine problem can never lose a registration. The default form draws the *same DOM* as the old hand-written form (tested against a saved copy of the old script). | `public/render.js`, `public/register.js`, `src/forms.js`, `src/leads.js`, `test/renderer.test.js` |
| R1, R2, R14 | **Form Studio** at `/admin/forms`: list of forms, and the editor with a layout panel (sections, drag-and-drop of fields between sections, half/full width), field settings (label, type, required, hidden, placeholder, help, options, min/max length, allowed characters, messages, show-when rules), a Form text tab (headline, buttons, thank-you, closed notice, `{name}` `{type}` `{date}`), and a live preview (phone / tablet / desktop) that uses the public renderer. Autosave every 0.7 s to one draft per form. | `admin/views/studio.html`, `admin/assets/studio.js`, `studio.css`, `preview.js`, `src/studio.js` |
| R4 | **Publish, history, restore, rollback.** Publish creates an immutable version (author, time, note). History shows what changed. *Edit this version* copies it into the draft; *Make live* switches the public form to it at once. Published fields keep their key, type and data column for good (so stored answers stay valid). Pause / resume / archive a form. Audit log of every change. | `src/studio.js`, `src/formdef.js` (`compareVersions`, `diffDefinitions`, `sanitizeDefinition`), migration 015 |
| R5 | **Link generator** (Studio → Links & QR): platform + medium + campaign → tagged link, copy, QR code, saved per form. | `src/campaigns.js` (`buildLink`, `saveLink`) |
| R6 | **Campaign manager** at `/admin/campaigns`: create / edit / activate / pause / end, registrations and opens per campaign. At most one active campaign per master class (transaction + unique index). **Base-link redirect:** `/datascience` with no tags forwards (302, never cached) to the active campaign's tagged link; other parameters such as `fbclid` are kept; set `CAMPAIGN_REDIRECT=false` to switch it off. | `src/campaigns.js`, `server.js`, `admin/assets/campaigns.js` |
| R8 | **Visitor, session and event tracking.** `POST /api/track` (write-only): anonymous visitor id, session id (30 min), events `page_view`, `form_start`, `field_focus`, `submit_invalid`, `submit_attempt`, `submit_success`, `submit_failed`, `page_hide`. Device, OS, browser, in-app browser (new `src/ua.js`), source (existing `src/sources.js`), salted IP hash only. No typed values, raw IP, raw user agent or referrer path is ever stored. Bots are ignored; retries are idempotent. | `src/track.js`, `src/ua.js`, `public/register.js`, `test/track.test.js` |
| R9 | **Same-person detection.** A registration is flagged when the same phone, e-mail (any case) or browser registered before; the evidence (`phone,email,device`), count and previous lead are stored. Nothing is merged or blocked. Leads page shows a "Same person" button listing the other registrations. | `src/person.js`, `admin/assets/dashboard.js` |
| R10 | **Maps.** Analytics → "Where registrations come from": bundled world outline (no outside requests), one circle per city, World / India / Fit buttons, drag, +/−, double-click, keyboard, full screen. | `admin/assets/insights.js`, `admin/assets/vendor/world.json`, `scripts/build-world-map.js` |
| R11 | **Chart full screen and zoom** on every line chart: + / − / Reset, drag across the chart to zoom to a range, double-click to reset, Full screen (Esc closes). | `admin/assets/analytics.js`, `fullscreen.js` |
| R12 | **Analytics additions:** visitor journey funnel (opened → started → pressed Register → registered), where people stop (last field touched), fields that fail the check, devices / systems / browsers / in-app browsers, new vs returning, time from opening to registering. Excel export gained form version, custom answers, source, device, location and same-person columns. | `src/insights.js`, `admin/assets/insights.js` |
| R13 | **IP dashboard section:** lookup health (provider, calls today / limit, cache hit rate), location coverage, data-centre / VPN registrations, phone-country vs IP-country mismatches, lookup result mix, top providers, latest registrations with **masked** IPs. | `src/insights.js`, `admin/assets/insights.js` |

## Database
Migration `015_studio_drafts_match.sql` is additive (a drafts table, `published_at`, `match_basis`, visitor counters, three indexes). It runs automatically at start-up like the others. Rollback notes are in the file header.

## New settings (all optional, see `.env.example`)
`PUBLIC_BASE_URL`, `CAMPAIGN_REDIRECT` (default on), `GEO_VISITORS` (default off).

## How the requirements were read
The original requirement text was not in the zip, only the status list and `docs/PLAN.md`. Where the list was short I chose the safe reading:
- "Remove builder blocks, redirects": the old Ad link builder, QR generator and link cards were **kept** (they work and have tests). The new Links & QR dialog and Campaigns page sit beside them. If you want the old blocks removed, that is a small follow-up.
- The plain link `/` (no master class) uses the built-in default form and cannot be edited in the Studio (it has no master class row).
- Visitors' own locations are only looked up when `GEO_VISITORS=true`, so the daily lookup budget stays for registrations.

## Not verified here: please check before going live
1. **Real PostgreSQL.** The sandbox had no Docker or `psql`; everything ran on pg-mem. pg-mem answered one query wrongly when a partial index covers the same column (campaign lookups by master class), so those lookups filter in JavaScript; PostgreSQL itself is not affected. Run `npm run migrate` against a copy of the database first.
2. **A real browser.** There was no Chromium, so there are no Playwright runs or screenshots. The screens were tested in jsdom (clicks, edits, autosave, publish, preview messages, map and chart controls), which does not cover real layout, real pointer drag with the mouse or finger, or CSS. Please click through: drag a field, open the preview in phone width, zoom a chart, open the map full screen.
3. **Pixel identity.** The default form is proven DOM-identical to the old form, and its stylesheet is unchanged apart from added rules for new field types. A screenshot comparison on a real browser is still the final proof.
4. **ipapi.co** free-tier limits and commercial-use terms were not checked.
5. **Security review and load.** I reviewed the new code for injection, XSS, open redirects, ReDoS and CSRF (admin routes are cookie `SameSite=Strict` + JSON only; all SQL is parameterised; labels are escaped; the preview only accepts messages from its own origin; patterns are a fixed list, never user regexes), but no external penetration test was done. The insights query reads up to 100,000 events per request and is cached for 20 seconds; the 100k-event query-plan check on real PostgreSQL has not been done.
6. `POST /api/track` is public, so anyone can send fake events and inflate the funnel (registrations are not affected). It is rate limited and capped.
