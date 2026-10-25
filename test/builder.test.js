// v3.9: ad link builder (searchable master class, nothing pre-selected, link + QR only when complete), unfilled Meta macros,
// and link opens split by Facebook / Instagram on the master class link cards.
// Run: node test/builder.test.js
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '500';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const M = require('../src/meta');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ B${++n}. ${m}`);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const UA_IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 310.0.0.24.109 (iPhone14,2; iOS 17_0; en_IN; en; scale=3.00; 1170x2532; 123456789)';
const UA_FB = 'Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.30.113;]';
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

(async () => {
  /* ---------- Meta macros that were never filled in ---------- */
  assert.deepStrictEqual(M.detectMeta({ utm_source: 'meta', site_source_name: '{{site_source_name}}', placement: '{{placement}}' }), { platform: 'Meta (unknown)', placement: null });
  assert.strictEqual(M.cleanPlacement('{{placement}}'), null); assert.strictEqual(M.cleanPlacement('%7B%7Bplacement%7D%7D'), null);
  assert.strictEqual(M.cleanPlacement('Instagram_Reels'), 'Instagram_Reels');
  assert.strictEqual(M.detectMeta({ utm_source: 'meta', site_source_name: '{{site_source_name}}', userAgent: UA_IG }).platform, 'Instagram');
  assert.deepStrictEqual(M.detectMeta({ site_source_name: '{{site_source_name}}', placement: '{{placement}}' }), { platform: null, placement: null });
  ok('a Meta macro that was never filled in ({{placement}}, {{site_source_name}}) is ignored: no fake "placement" row, and it does not count as Meta evidence on its own');

  /* ---------- server: unfilled macros + opens per Facebook / Instagram on the link cards ---------- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const beacon = (body, ua) => fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
  const tag = { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-oct' };
  await beacon({ vid: 'builder-vis-ig-0001', course: 'datascience', ...tag, site_source_name: 'ig', placement: 'Instagram_Reels' }, UA_IG);
  await beacon({ vid: 'builder-vis-ig-0002', course: 'datascience', ...tag }, UA_IG);
  await beacon({ vid: 'builder-vis-fb-0003', course: 'datascience', ...tag, site_source_name: 'fb', placement: 'Facebook_Feed' }, UA_FB);
  await beacon({ vid: 'builder-vis-xx-0004', course: 'datascience', ...tag, site_source_name: '{{site_source_name}}', placement: '{{placement}}' }, UA_CHROME);
  await beacon({ vid: 'builder-vis-gg-0005', course: 'datascience', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, UA_IG);
  await beacon({ vid: 'builder-vis-pl-0006', course: '', ...tag, site_source_name: 'ig' }, UA_IG);
  const rows = (await db.query('SELECT meta_platform, meta_placement FROM page_visits ORDER BY id')).rows;
  assert.deepStrictEqual(rows.map((r) => r.meta_platform), ['Instagram', 'Instagram', 'Facebook', 'Meta (unknown)', null, 'Instagram']);
  assert.deepStrictEqual(rows.map((r) => r.meta_placement), ['Instagram_Reels', null, 'Facebook_Feed', null, null, null]); ok('opens are stored per app; an unfilled {{placement}} is not stored as a placement; a Google open inside Instagram is not Meta');

  // sign in like the admin tests do
  process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'tester';
  const Admin = require('../src/models/Admin'); const auth = require('../src/auth');
  await Admin.upsert('builder-admin', await auth.hashPassword('Builder-pass-123'));
  const login = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'builder-admin', password: 'Builder-pass-123' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert(cookie, 'login should set a cookie');
  const api = await (await fetch(base + '/admin/api/courses', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(api.ok, true);
  const ds = api.courses.find((c) => c.slug === 'datascience');
  assert.strictEqual(ds.opens, 5); assert.deepStrictEqual(ds.opensByApp, { Instagram: 2, Facebook: 1, 'Meta (unknown)': 1 });
  assert.deepStrictEqual(api.plain.opensByApp, { Instagram: 1 }); assert.strictEqual(api.plain.opens, 1);
  assert.deepStrictEqual(api.courses.find((c) => c.slug === 'cybersecurity').opensByApp, {});
  ok('GET /admin/api/courses: every master class link reports its total opens and how many came from Facebook, Instagram ... (non-Meta opens only in the total)');
  server.close();

  /* ---------- link builder: the rules are in the shared script every page uses ---------- */
  const b = read('admin/assets/builder.js'), page = read('admin/assets/qr-page.js'), html = read('admin/views/qr.html');
  assert(b.includes("role', 'combobox'") && b.includes('aria-activedescendant') && !/courses\.forEach\(function \(c\) \{ var op = el\('option'/.test(b)); ok('master class is a search box (combobox with keyboard support), not a dropdown that grows with every new master class');
  assert(b.includes('if (st.course === undefined) st.course = null') && /course: null/.test(page)); ok('no master class is pre-selected (state starts at null; "plain link" is a deliberate choice)');
  assert(/function missing\(s\)/.test(b) && b.includes("m.push('master class')") && b.includes("m.push('medium')") && b.includes("m.push('running campaign')") && b.includes('function url() { return ready() ? buildUrl(o.base, st) : \'\'; }')); ok('the link exists only when master class + medium + running campaign are all filled (a campaign is picked from the running ones, never typed)');
  assert(/medium: ''/.test(page) && b.includes("op0.value = ''")); ok('medium starts empty ("Select a medium")');
  assert(html.includes('id="qrLinkBox" hidden') && html.includes('id="qrBody" hidden') && page.includes("$('qrLinkBox').hidden = !ok") && page.includes("$('qrBody').hidden = !ok")); ok('QR generator: link box, preview and PNG / JPEG / SVG download buttons stay hidden until the link is complete');
  assert(!b.includes('mb.hidden') && !b.includes('Ads Manager box')); ok('there is no Meta Ads Manager box any more: the ad link builder only gives the link (copy / QR)');

  console.log(`\nAll ${n} builder checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
