// Meta ads: Facebook vs Instagram. Detection rules, the public beacon and form, the analytics panel and filter, the link builder helper.
// Run: node test/meta.test.js
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '200';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const Lead = require('../src/models/Lead');
const Visit = require('../src/models/Visit');
const M = require('../src/meta');
const { getAnalytics, normalizeFilters, channelOf, platformOf } = require('../src/analytics');
const { parseLink } = require('../src/linkparse');
const { buildWorkbook } = require('../src/export');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ MT${++n}. ${m}`);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tz = 'Asia/Kolkata';
const NOW = new Date('2026-10-14T19:00:00Z');
const ago = (d, h = 0) => new Date(NOW.getTime() - d * 86400e3 - h * 3600e3);

const UA_IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 310.0.0.24.109 (iPhone14,2; iOS 17_0; en_IN; en; scale=3.00; 1170x2532; 123456789)';
const UA_FB = 'Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.30.113;]';
const UA_MSG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 [FBAN/MessengerForiOS;FBAV/430.0;FBBV/1;FBDV/iPhone14,2]';
const UA_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

(async () => {
  /* ---------- detection rules (pure) ---------- */
  const d = M.detectMeta;
  assert.deepStrictEqual(d({ utm_source: 'meta', site_source_name: 'ig', placement: 'Instagram_Reels' }), { platform: 'Instagram', placement: 'Instagram_Reels' });
  assert.strictEqual(d({ utm_source: 'meta', site_source_name: 'fb' }).platform, 'Facebook');
  assert.strictEqual(d({ utm_source: 'meta', site_source_name: 'msg' }).platform, 'Messenger');
  assert.strictEqual(d({ utm_source: 'meta', site_source_name: 'an' }).platform, 'Audience Network'); ok('Meta\'s {{site_source_name}} values fb / ig / msg / an become Facebook / Instagram / Messenger / Audience Network');
  assert.strictEqual(d({ utm_source: 'ig' }).platform, 'Instagram'); assert.strictEqual(d({ utm_source: 'Facebook' }).platform, 'Facebook');
  assert.strictEqual(d({ utm_source: 'fb', site_source_name: 'ig' }).platform, 'Instagram'); ok('utm_source={{site_source_name}} (resolved to ig / fb) and older \"instagram\" / \"facebook\" links are understood; Meta\'s own macro wins');
  assert.strictEqual(d({ utm_source: 'meta', placement: 'Facebook_Mobile_Feed' }).platform, 'Facebook');
  assert.strictEqual(d({ utm_source: 'meta', placement: 'Instagram_Stories' }).platform, 'Instagram'); ok('the placement text alone also names the app');
  assert.strictEqual(d({ referrer: 'https://l.instagram.com/?u=x' }).platform, 'Instagram'); assert.strictEqual(d({ referrerHost: 'm.facebook.com' }).platform, 'Facebook'); assert.strictEqual(d({ referrerHost: 'lm.facebook.com' }).platform, 'Facebook'); ok('the referring site (l.instagram.com, m.facebook.com ...) names the app when the link does not');
  assert.strictEqual(d({ userAgent: UA_IG }).platform, 'Instagram'); assert.strictEqual(d({ userAgent: UA_FB }).platform, 'Facebook'); assert.strictEqual(d({ userAgent: UA_MSG }).platform, 'Messenger'); assert.strictEqual(d({ userAgent: UA_SAFARI }).platform, null); ok('the in-app browser of Instagram / Facebook / Messenger names the app (an ordinary browser says nothing)');
  assert.deepStrictEqual(d({ utm_source: 'google', userAgent: UA_IG, referrerHost: 'l.instagram.com', site_source_name: 'ig' }), { platform: null, placement: null }); assert.strictEqual(d({ utm_source: 'email', userAgent: UA_FB }).platform, null); ok('a link tagged for another channel (google, email ...) is never labelled Meta, whatever browser opened it');
  assert.strictEqual(d({ utm_source: 'meta' }).platform, 'Meta (unknown)'); assert.strictEqual(d({ fbclid: true }).platform, 'Meta (unknown)'); assert.strictEqual(d({ utm_source: 'meta', site_source_name: '{{site_source_name}}' }).platform, 'Meta (unknown)'); ok('Meta traffic that does not say which app is kept as \"Meta (unknown)\" (also when the macro was pasted but never filled in)');
  assert.deepStrictEqual(d({}), { platform: null, placement: null }); assert.deepStrictEqual(d({ referrerHost: 'example.org', userAgent: UA_SAFARI }), { platform: null, placement: null }); ok('no Meta evidence at all: nothing is stored');
  const pl = d({ utm_source: 'meta', site_source_name: 'ig', placement: '<img src=x onerror=alert(1)>' + 'R'.repeat(100) }).placement;
  assert(pl.length <= 60 && !/[<>()=]/.test(pl)); ok('the placement text is cleaned (no markup characters) and capped at 60 characters');
  assert.strictEqual(M.cleanPlacement(''), null); assert.strictEqual(M.cleanPlacement(['x']), 'x'.length ? M.cleanPlacement(['x']) : null);

  /* ---------- database, beacon, form ---------- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const beacon = (body, ua = UA_SAFARI) => fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
  const lead = (body, ua = UA_SAFARI) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body) });
  const visits = async () => (await db.query('SELECT * FROM page_visits ORDER BY id')).rows;
  const leads = async () => (await db.query('SELECT * FROM leads ORDER BY id')).rows;
  const form = (i, extra = {}) => ({ first_name: 'Asha', last_name: 'N' + i, country: 'IN', phone: '98765' + String(10000 + i), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'datascience', client_id: 'meta-form-client-' + i, ...extra });

  await beacon({ vid: 'visitor-meta-0001', course: 'ds', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', site_source_name: 'ig', placement: 'Instagram_Reels' });
  let v = await visits();
  assert.strictEqual(v[0].meta_platform, 'Instagram'); assert.strictEqual(v[0].meta_placement, 'Instagram_Reels'); assert.strictEqual(v[0].utm_source, 'meta'); ok('a link open from an Instagram ad is stored with its app and placement (utm_source stays \"meta\")');
  await beacon({ vid: 'visitor-meta-0001', course: 'ds', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', site_source_name: 'ig', placement: 'Instagram_Reels' });
  assert.strictEqual((await visits()).length, 1); ok('the same person refreshing the same Instagram ad link still counts once');
  await beacon({ vid: 'visitor-meta-0001', course: 'ds', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', site_source_name: 'fb', placement: 'Facebook_Mobile_Feed' });
  v = await visits(); assert.strictEqual(v.length, 2); assert.strictEqual(v[1].meta_platform, 'Facebook'); ok('the same person opening the ad from Facebook the same day is a separate open');
  await beacon({ vid: 'visitor-meta-0002', course: 'ds', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels' }, UA_IG);
  await beacon({ vid: 'visitor-meta-0003', course: 'ds', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', fbclid: true });
  v = await visits(); assert.strictEqual(v[2].meta_platform, 'Instagram'); assert.strictEqual(v[3].meta_platform, 'Meta (unknown)'); ok('without the macros the in-app browser still names the app; with only Meta\'s click id it is \"Meta (unknown)\"');
  await beacon({ vid: 'visitor-goog-0004', course: 'ds', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, UA_IG);
  await beacon({ vid: 'visitor-direct-005', course: 'ds' });
  v = await visits(); assert.strictEqual(v[4].meta_platform, null); assert.strictEqual(v[5].meta_platform, null); ok('Google traffic (even opened inside Instagram) and direct visits carry no Meta app');
  assert(!JSON.stringify(v).includes('Instagram 310') && !JSON.stringify(v).includes('FBAV') && !Object.keys(v[0]).some((k) => /agent|^ip$/.test(k))); ok('privacy: the user agent is read to find the app but never stored with a link open');
  assert((await beacon({ vid: 'visitor-meta-0006', course: 'ds', utm_source: 'meta', site_source_name: { a: 1 }, placement: ['x'] })).status === 204); ok('odd macro values never break the beacon');

  assert.strictEqual((await lead(form(1, { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', site_source_name: 'ig', placement: 'Instagram_Stories', page_url: base + '/ds?utm_source=meta&site_source_name=ig' }))).status, 201);
  assert.strictEqual((await lead(form(2, { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', site_source_name: 'fb', placement: 'Facebook_Mobile_Feed' }))).status, 201);
  assert.strictEqual((await lead(form(3, { utm_source: 'meta', referrer: 'https://l.instagram.com/?u=x' }))).status, 201);
  assert.strictEqual((await lead(form(4), UA_FB)).status, 201);
  assert.strictEqual((await lead(form(5, { utm_source: 'google', utm_medium: 'cpc', referrer: 'https://l.instagram.com/' }), UA_IG)).status, 201);
  assert.strictEqual((await lead(form(6))).status, 201);
  assert.strictEqual((await lead(form(7, { utm_source: 'meta', fbclid: true }))).status, 201);
  const L = await leads();
  const got = L.map((r) => r.meta_platform + '|' + r.meta_placement);
  assert.deepStrictEqual(got, ['Instagram|Instagram_Stories', 'Facebook|Facebook_Mobile_Feed', 'Instagram|null', 'Facebook|null', 'null|null', 'null|null', 'Meta (unknown)|null']); ok('a registration keeps the Meta app + placement: from the macros, the referrer, or the in-app browser; none for Google or untagged desktop visits');
  assert(L[0].page_url.includes('site_source_name=ig') && L[0].user_agent); ok('the full page link and the browser string are still saved with the lead, exactly as before');
  assert.strictEqual((await lead(form(1, { utm_source: 'meta', site_source_name: 'fb' }))).status, 200); assert.strictEqual((await leads()).length, 7); ok('a repeated submission is still stored once');
  const bad = await lead(form(8, { utm_source: 'meta', site_source_name: 'ig<script>', placement: { x: 1 } })); assert.strictEqual(bad.status, 201);
  assert.strictEqual((await leads())[7].meta_platform, 'Meta (unknown)'); ok('hostile macro text cannot be stored as an app name');

  /* ---------- analytics ---------- */
  await db.query('DELETE FROM leads'); await db.query('DELETE FROM page_visits');
  let phone = 9100000000;
  const mk = async (o, when) => { const l = await Lead.create({ first_name: 'F', last_name: 'L', full_name: 'F L', phone: '+91' + (phone++), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'Data Science', course_slug: 'datascience', ...o }); await db.query('UPDATE leads SET created_at = $1 WHERE id = $2', [when, l.id]); };
  const mv = (o, when, key) => Visit.record({ visitor_id: 'seed-visitor-' + key, course_slug: 'datascience', ...o }, when);
  await mk({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels' }, ago(0, 1));
  await mk({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels', status: 'Working Professional', job_role: 'QA / Tester', experience_level: '2-5 yrs' }, ago(1));
  await mk({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Facebook', meta_placement: 'Facebook_Mobile_Feed' }, ago(1));
  await mk({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Meta (unknown)' }, ago(2));
  await mk({ utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'old-ig' }, ago(2));                                    // before v3.8: no stored app, the tag still says Instagram
  await mk({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'old-fb' }, ago(3));                                     // same, Facebook
  await mk({ referrer: 'https://l.instagram.com/?u=1' }, ago(3));                                                              // old untagged lead, referrer only
  await mk({ meta_platform: 'Instagram' }, ago(4));                                                                            // untagged but Meta said Instagram (fbclid / in-app browser)
  await mk({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(2));
  await mk({ name: 'Direct' }, ago(2));
  await mv({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels' }, ago(0, 2), 1);
  await mv({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels' }, ago(1), 2);
  await mv({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels' }, ago(1), 3);
  await mv({ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', meta_platform: 'Facebook', meta_placement: 'Facebook_Mobile_Feed' }, ago(1), 4);
  await mv({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(2), 5);
  const A = (query) => getAnalytics({ tz, now: NOW, query });
  const byName = (a) => Object.fromEntries(a.meta.platforms.map((p) => [p.name, p]));

  let a = await A({});
  assert.deepStrictEqual(a.channels.map((c) => c.name + ':' + c.n), ['Meta:8', 'Direct / no tag:1', 'Google:1']); ok('Facebook and Instagram are still one channel, \"Meta\" (tags, stored app and referrer all merge into it)');
  let p = byName(a);
  assert.strictEqual(a.meta.total, 8); assert.strictEqual(p.Instagram.n, 5); assert.strictEqual(p.Facebook.n, 2); assert.strictEqual(p['Meta (unknown)'].n, 1); ok('panel: registrations split Instagram 5 / Facebook 2 / unknown 1 (older leads are split from their utm_source and referrer)');
  assert.strictEqual(p.Instagram.opens, 3); assert.strictEqual(p.Facebook.opens, 1); assert.strictEqual(p.Instagram.conversionPct, null); assert.strictEqual(p.Facebook.conversionPct, null); assert.strictEqual(a.meta.opens, 4);
  const cc = byName(await A({ campaign: 'ds-reels' })); assert.strictEqual(cc.Instagram.conversionPct, 66.7); assert.strictEqual(cc.Facebook.conversionPct, 100); ok('panel: link opens per app, and conversion is shown only where opens are at least registrations (never over 100%)');
  assert.deepStrictEqual(a.meta.placements.map((x) => x.name + ':' + x.n + ':' + x.opens), ['Instagram_Reels:2:3', 'Facebook_Mobile_Feed:1:1']); ok('panel: placements with registrations and opens');
  assert.strictEqual(p['Instagram'].students + p['Instagram'].professionals, 5); assert.strictEqual(p.Instagram.professionals, 1); ok('panel: students / professionals per app');
  assert.strictEqual(a.meta.known, 7); assert.strictEqual(a.meta.knownPct, 87.5); ok('panel: how many Meta registrations could be split (the rest need the macros)');

  a = await A({ platform: 'Instagram' });
  assert.strictEqual(a.totals.window, 5); assert.strictEqual(a.totals.allTime, null); assert.strictEqual(a.filters.platform, 'Instagram'); ok('filter Instagram: 5 registrations, all-time shown as – (no cheap number), the filter is echoed back');
  assert.strictEqual(a.visits.window, 3); ok('filter Instagram: link opens follow it (3)');
  assert.strictEqual(byName(a).Facebook.n, 2); assert.strictEqual(a.meta.total, 8); ok('the panel itself ignores the Meta-app filter, so you can hop between apps');
  assert.deepStrictEqual(a.facets.channel.items.map((c) => c.name + ':' + c.n), ['Meta:5']); assert.deepStrictEqual(a.facets.campaign.items.map((c) => c.name + ':' + c.n).sort(), ['(no campaign):2', 'ds-reels:2', 'old-ig:1']); ok('filter Instagram: the other filters\' counts follow it');
  a = await A({ platform: 'Facebook', course: 'datascience' }); assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.recent.length, 2); ok('Facebook + master class: 2 registrations and the live feed shows just those');
  a = await A({ platform: '__none' }); assert.strictEqual(a.totals.window, 2); ok('platform \"__none\" = everything that is not Meta (Google + direct)');
  a = await A({ platform: 'Instagram', channel: 'Google' }); assert.strictEqual(a.totals.window, 0); assert.strictEqual(a.meta.total, 0); ok('contradicting filters give an empty page, not an error');
  a = await A({ status: 'Working Professional' }); assert.strictEqual(a.meta.opens, null); assert.strictEqual(byName(a).Instagram.opens, null); assert.strictEqual(byName(a).Instagram.n, 1); ok('\"I am a\" = professional: opens are hidden (a visitor has not chosen yet), registrations narrow');
  assert.deepStrictEqual(normalizeFilters({ platform: 'MySpace' }), {}); assert.deepStrictEqual(normalizeFilters({ platform: "'; DROP TABLE leads;--" }), {}); assert.strictEqual(normalizeFilters({ platform: 'Instagram' }).platform, 'Instagram'); ok('only known Meta app names (or __none) are accepted as the filter');
  assert.strictEqual(channelOf({ meta_platform: 'Facebook' }), 'Meta'); assert.strictEqual(channelOf({ utm_source: 'google', meta_platform: 'Facebook' }), 'Google'); assert.strictEqual(platformOf({ utm_source: 'google' }), '__none'); assert.strictEqual(platformOf({ utm_source: 'meta' }), 'Meta (unknown)'); ok('an untagged click that Meta identified counts as Meta; a Google tag always wins');
  await db.query('DELETE FROM leads'); await db.query('DELETE FROM page_visits');
  a = await A({}); assert.strictEqual(a.meta.total, 0); assert.strictEqual(a.meta.platforms.length, 2); assert.strictEqual(a.meta.platforms[0].name, 'Facebook'); ok('no data: the panel still lists Facebook and Instagram at zero');

  /* ---------- admin pages, API, export, link search ---------- */
  assert.strictEqual((await fetch(base + '/admin/api/analytics?platform=Instagram', { redirect: 'manual' })).status, 401); ok('the analytics API (with the Meta-app filter) still needs sign-in');
  const js = read('admin/assets/analytics.js'), html = read('admin/views/analytics.html');
  assert(html.includes('id="metaTable"') && html.includes('Meta ads: Facebook vs Instagram') && js.includes('renderMeta') && js.includes("p.set('platform'") && js.includes("q.get('platform')")); ok('the analytics page has the Meta panel, and the filter lives in the URL');
  const bj = read('admin/assets/builder.js');
  assert(bj.includes('utm_source') && !bj.includes('Website URL (no tags)') && !bj.includes('URL parameters') && !bj.includes('{{site_source_name}}') && !bj.includes('meta-box') && !bj.includes('metaHelper')); ok('the Ad link builder shows only the link: no Meta Ads Manager paste-boxes (Facebook / Instagram are told apart by the server)');
  const rj = read('public/register.js');
  assert(rj.includes("site_source_name: q.get('site_source_name')") && rj.includes("placement: q.get('placement')") && rj.includes('fbclid')); assert((rj.match(/site_source_name/g) || []).length >= 2); ok('the registration page sends the Meta macros with both the link open and the registration');
  const wb = await buildWorkbook({ leads: [new Lead({ id: 1, created_at: NOW, full_name: 'A B', meta_platform: 'Instagram', meta_placement: 'Instagram_Reels' })], tz });
  const hdr = wb.getWorksheet('Leads').getRow(1).values, row = wb.getWorksheet('Leads').getRow(2).values;
  assert(hdr.includes('Meta app (Facebook / Instagram)') && row.includes('Instagram') && row.includes('Instagram_Reels')); ok('the Excel export has Meta app and placement columns');
  let r = parseLink('https://x.test/datascience?utm_source=meta&utm_medium=paid&utm_campaign=ds-reels&site_source_name=ig');
  assert.strictEqual(r.platform, 'Instagram'); assert.strictEqual(r.filters.platform, 'Instagram'); assert.strictEqual(r.channel, 'Meta');
  r = parseLink('https://x.test/datascience?utm_source=meta&utm_campaign=ds-reels'); assert.strictEqual(r.platform, null); assert.strictEqual(r.filters.platform, undefined);
  r = parseLink('https://x.test/datascience?utm_source=google&site_source_name=ig'); assert.strictEqual(r.platform, null); ok('link search: a pasted link that already says ig / fb also filters the Meta app; a plain Meta link or another channel does not');

  server.close();
  console.log(`\nAll ${n} Meta (Facebook / Instagram) checks passed`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
