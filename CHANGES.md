# v3.13.0 (Oct 26 2026)
- **Websites that sent visitors** is now a real bar graph (link opens + registrations per website, redirects such as t.co / l.instagram.com flagged, click a row to filter). Before, it only counted registrations, so a site that sent visitors but no leads never appeared. Source: `detected.hosts` in /admin/api/analytics. Note: the site is only known when the visitor's browser sends a referrer; WhatsApp, QR scans, many in-app browsers and typed addresses send none.
- **Show leads** opens a pop-up (Esc / click outside closes) on every entry point (button, filter bar, campaign table). Shows a loading message and the real error, and when the selection has only visitors who did not register it switches to "Registered + did not register" by itself instead of an empty table.
- **Where people come from**: opens on **Today**; periods Today, Yesterday, Last 24 hours, Last 2 days, 7, 14, 30, 90 days, All time, Same as page. Every state / province of every country (4,400 outlines, 201 countries, Natural Earth 10m) plus country borders. Visitors who did not register are solid amber dots drawn on top of the green registered dots. People whose lookup gave only a state or country (no city) are drawn at the middle of that state / country ("area only"). Country, state and city lists are longer and scroll.
- src/compress.js: MAX_BUFFER 2 MB -> 8 MB so states.json (2.5 MB) is compressed (about 800 KB on the wire).
- Rebuild map data: `node scripts/build-world-map.js` and `node scripts/build-states-map.js ne_10m_admin_1_states_provinces.geojson`.
- New test: test/fixes.test.js.

# Fixes (Oct 23 2026)
- Startup crash `Cannot find module './geoAggregate'`: that file was never committed; src/insights.js was also broken by the last commit (restored from 394e0d3, no geoAggregate needed). Delete src/geoAggregate.js if it still exists.
- src/compress.js never called next() for gzip/br requests (every compressed request hung): fixed.
- Migrations 019/021/022 rewritten as plain re-runnable SQL (`-- migrate:allow-edit`), new 023 repairs forms_status_check (archive 500). Runner: allowMissing at startup (warn only), allow-edit marker.
- src/studio.js: re-archive bug fixed; DB constraint errors -> 409/422 instead of 500.
- SSL: no DATABASE_SSL*/CA settings. DigitalOcean hosts are encrypted without a CA; `?sslmode=disable` gives a plain connection. Remove DATABASE_SSL / DATABASE_SSL_CA from your DO env settings and your local .env files.
- Map: admin/assets/vendor/states.json (36 Indian states/UTs + other countries) drawn under the dots, shaded by registrations, click/hover shows counts. Rebuild: scripts/build-states-map.js.
- Google Tag Manager (GTM-TFGRSK64): register.html cleaned (the snippet had been pasted 4x, with duplicate <title>/<meta>); the loader is now /gtm.js (CSP blocks inline scripts) and the CSP allows GTM + Google Ads hosts and the noscript iframe. The `masterclass_lead` dataLayer push was already in register.js (fires only after /api/leads succeeds; no name/phone/email).
