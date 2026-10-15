// UI consistency: the form, sign-in page and both dashboards share one design layer (/ui.css). Run: npm test
process.env.LOG_LEVEL = 'silent';
process.env.ADMIN_USERNAME = 'ui.admin';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'x'.repeat(40);
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const { createApp, seedAdmin } = require('../server');
const pkg = require('../package.json');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

(async () => {
  let n = 0; const ok = (m) => console.log(`  ✓ U${++n}. ${m}`);

  /* ---- static: the shared layer owns the controls, the page files do not redefine them ---- */
  const ui = read('public/ui.css'), reg = read('public/register.css'), adm = read('admin/assets/admin.css');
  for (const [name, css] of [['ui.css', ui], ['register.css', reg], ['admin.css', adm]]) {
    assert.strictEqual((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `${name}: unbalanced braces`);
  }
  for (const [name, css] of [['register.css', reg], ['admin.css', adm]]) {
    assert(!/(^|\n)\.control\s*{/.test(css) && !/(^|\n)\.btn\s*{/.test(css) && !/(^|\n)\.orb\s*{/.test(css), `${name} must not redefine .control / .btn / .orb`);
  }
  ok('inputs, dropdowns and buttons are defined once (ui.css); the page stylesheets only add layout');

  const defined = new Set([...(ui + reg + adm).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...(ui + reg + adm).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  assert.deepStrictEqual([...used].filter((v) => !defined.has(v)), [], 'every var(--x) used must be defined');
  assert.deepStrictEqual([...defined].filter((v) => !used.has(v)), [], 'no unused design tokens');
  ok('every design token used is defined, and none is left unused');

  /* ---- the running app ---- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  await seedAdmin();
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const J = { 'Content-Type': 'application/json' };

  let r = await fetch(base + '/ui.css');
  assert.strictEqual(r.status, 200); assert(/text\/css/.test(r.headers.get('content-type'))); assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
  ok('/ui.css is served as CSS and always revalidated');

  const linksUi = (html) => html.indexOf('/ui.css') > -1 && html.indexOf('/ui.css') < html.search(/\/(register|admin\/assets\/admin)\.css/);
  const reg1 = await (await fetch(base + '/cybersecurity')).text();
  assert(linksUi(reg1) && /<body class="bg-brand"/.test(reg1)); ok('registration page loads /ui.css before its own stylesheet');
  const login = await (await fetch(base + '/admin/login')).text();
  assert(linksUi(login) && /class="login-page bg-brand"/.test(login)); ok('sign-in page loads the same shared layer');

  const cookie = (await fetch(base + '/admin/api/login', { method: 'POST', headers: J, body: JSON.stringify({ username: 'ui.admin', password: 'correct-horse-battery' }) })).headers.get('set-cookie').split(';')[0];
  const dash = await (await fetch(base + '/admin', { headers: { cookie } })).text();
  const ana = await (await fetch(base + '/admin/analytics', { headers: { cookie } })).text();
  assert(linksUi(dash) && linksUi(ana)); ok('both dashboards load the same shared layer');
  assert(/id="dashError"/.test(dash) && /id="retry"/.test(dash)); ok('dashboard has a visible error area with a retry button (failures are never silent)');

  /* ---- the counts load, and a blip does not leave them at "–" ---- */
  assert(/\.filters>\*\{min-width:0\}/.test(adm), 'grid children must be allowed to shrink');
  ok('filter row cannot be pushed out of the card by a long option list (controls stay visible on the phone)');
  const dashJs = read('admin/assets/dashboard.js');
  assert(/statTries\s*<\s*2/.test(dashJs) && /setTimeout\(loadStats/.test(dashJs), 'stats retry quietly before the banner');
  ok('counts retry twice on their own before the error banner appears');
  assert(!/Last 14 days/.test(dash) && !/id="trend"/.test(dash) && !/renderTrend/.test(dashJs)); ok('"Last 14 days" panel is gone from the leads dashboard');
  assert(/<th[^>]*>No\.<\/th>/.test(dash) && /offset \+ idx \+ 1/.test(dashJs) && /\(d\.page - 1\) \* d\.pageSize/.test(dashJs)); ok('every lead row is numbered 1, 2, 3 ... continuing across pages');
  assert(/apiJson\('filters'\)/.test(dashJs) && /applyFilters\(\{\}\)/.test(dashJs) && !/co\.options\.length <= 1/.test(dashJs)); ok('filter dropdowns load from /filters on their own (never depend on the counts) and are never left empty');
  assert(/class="tbl cards"/.test(dash)); ok('leads table turns into cards on phones');
  assert(!/class="control"/.test(dash), 'dashboard filter controls use the toolbar size'); ok('dashboard filters use the same control, toolbar size');

  /* ---- the live build can be identified ---- */
  r = await fetch(base + '/ready'); const rd = await r.json();
  assert.strictEqual(rd.ok, true); assert.strictEqual(rd.version, pkg.version); ok(`/ready reports the running version (${pkg.version}) so you can confirm which build is live`);

  /* ---- every field the form shows comes from the server lists ---- */
  const cfg = JSON.parse((await (await fetch(base + '/config.js')).text()).replace(/^window\.KNOA_CONFIG=/, '').replace(/;$/, ''));
  assert(cfg.qualifications.includes("Master's degree") && cfg.specializations.includes('Computer Science'));
  const js = read('public/register.js');
  assert(/Highest qualification <small>\(optional\)<\/small>/.test(js) && /Specialization \/ branch <small>\(optional\)<\/small>/.test(js));
  assert((cfg.qualifications || []).length >= 4 && (cfg.specializations || []).length >= 4, 'both option lists reach the browser');
  ok('form offers "Highest qualification (optional)" and "Specialization / branch (optional)" with their option lists');
  assert.strictEqual(pkg.scripts['start:dev'], undefined); assert(!fs.existsSync(path.join(__dirname, '..', 'start.js')));
  assert.strictEqual(pkg.scripts.start, 'node server.js'); assert.strictEqual(pkg.scripts.stop, 'node scripts/stop.js');
  ok('single start command (node server.js, so Ctrl+C reaches the app) plus npm run stop; dev-only launcher removed');

  /* ---- Live analytics is white + green like the Leads page (no dark theme) ---- */
  const an = read('admin/views/analytics.html'), anCss = read('admin/assets/analytics.css'), anJs = read('admin/assets/analytics.js');
  assert(!/<body[^>]*class="[^"]*(^|\s)fx(\s|")/.test(an) && !/body\.fx|--fx-|#05080f|#22d3ee|#a78bfa|#f472b6/.test(anCss + anJs + an));
  ok('analytics page uses the light white + green theme (no neon / dark styles left)');

  /* ---- Leads panel: visible "+ Add master class" button and the generated link after creating ---- */
  const lk = read('admin/assets/links.js');
  assert(/\+ Add master class/.test(lk) && /justCreated/.test(lk) && /Copy link/.test(lk));
  ok('leads panel has an Add master class button and shows + copies the new link');

  /* ---- managed PostgreSQL: TLS is derived from the URL, sslmode never overrides it ---- */
  const cfgMod = require('../src/config'); const dbMod = require('../src/db');
  const keep = { u: cfgMod.databaseUrl, s: cfgMod.databaseSsl, ca: cfgMod.databaseSslCa, e: process.env.DATABASE_SSL };
  cfgMod.databaseUrl = 'postgresql://u:p@x-do-user-1-0.db.ondigitalocean.com:25060/d?uselibpqcompat=true&sslmode=require'; cfgMod.databaseSsl = false; cfgMod.databaseSslCa = ''; delete process.env.DATABASE_SSL;
  let cn = dbMod.connection(); assert.deepStrictEqual(cn.ssl, { rejectUnauthorized: false }); assert(!/sslmode|uselibpqcompat/.test(cn.url));
  cfgMod.databaseSslCa = 'PEM'; cn = dbMod.connection(); assert.strictEqual(cn.ssl.rejectUnauthorized, true);
  cfgMod.databaseUrl = 'postgresql://u:p@localhost:5432/d'; cfgMod.databaseSslCa = ''; cn = dbMod.connection(); assert.strictEqual(cn.ssl, false);
  Object.assign(cfgMod, { databaseUrl: keep.u, databaseSsl: keep.s, databaseSslCa: keep.ca }); if (keep.e !== undefined) process.env.DATABASE_SSL = keep.e;
  ok('DigitalOcean URL -> TLS on (verified with the CA, unverified without); localhost -> off; sslmode stripped from the URL');

  await new Promise((res) => server.close(res)); await db.close();
  console.log(`\nAll ${n} UI checks passed`);
})().catch((e) => { console.error('UI TEST FAILED:', e); process.exit(1); });
