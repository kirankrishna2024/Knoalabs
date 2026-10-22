// Link-open counter: the public beacon, de-duplication, bots, privacy and what the analytics shows. Run: node test/visits.test.js
process.env.LOG_LEVEL = 'silent';
const assert = require('assert');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const Lead = require('../src/models/Lead');
const Visit = require('../src/models/Visit');
const { getAnalytics } = require('../src/analytics');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ V${++n}. ${m}`);
const tz = 'Asia/Kolkata';
const NOW = new Date('2026-10-14T19:00:00Z');                 // 2026-10-15 00:30 in India
const ago = (d, h = 0, m = 0) => new Date(NOW.getTime() - d * 86400e3 - h * 3600e3 - m * 60e3);
const rows = async () => (await db.query('SELECT * FROM page_visits ORDER BY id')).rows;

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1';
  const beacon = (body, ua = UA, raw) => fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: raw || JSON.stringify(body) });

  /* ---- the public beacon ---- */
  let r = await beacon({ vid: 'visitor-aaaa-0001', course: 'ds', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels', referrer: 'https://l.instagram.com/?u=https%3A%2F%2Fsecret.example%2Fpath%3Ftoken%3D1' });
  assert.strictEqual(r.status, 204); let v = await rows(); assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].course_slug, 'datascience'); assert.strictEqual(v[0].utm_campaign, 'ds-reels'); assert.strictEqual(v[0].referrer_host, 'l.instagram.com'); ok('a browser beacon is stored (alias "ds" -> datascience) and answered with 204');
  assert(!JSON.stringify(v[0]).includes('secret.example') && !JSON.stringify(v[0]).includes('token')); assert(!Object.keys(v[0]).some((k) => /ip|agent/i.test(k))); ok('privacy: only the referring site name is kept: no full URL, no IP, no user agent');

  await beacon({ vid: 'visitor-aaaa-0001', course: 'datascience', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' });
  await beacon({ vid: 'visitor-aaaa-0001', course: 'datascience', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' });
  assert.strictEqual((await rows()).length, 1); ok('the same person refreshing the same link the same day counts once');
  await beacon({ vid: 'visitor-aaaa-0001', course: 'datascience', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' });
  await beacon({ vid: 'visitor-bbbb-0002', course: 'datascience', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' });
  assert.strictEqual((await rows()).length, 3); ok('another link or another person counts separately');

  for (const ua of ['WhatsApp/2.23.20 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uagent.php)', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'curl/8.4.0', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 HeadlessChrome/120', '']) {
    assert.strictEqual((await beacon({ vid: 'bot-visitor-' + Math.random().toString(36).slice(2, 10), course: 'datascience' }, ua)).status, 204);
  }
  assert.strictEqual((await rows()).length, 3); ok('bots, link-preview fetchers, scripts and headless browsers are not counted');

  for (const b of [{}, { vid: 'short' }, { vid: 'bad id with spaces!!' }, { vid: 'x'.repeat(200) }, { vid: ['a', 'b'] }, { vid: 12345678901 }]) assert.strictEqual((await beacon(b)).status, 204);
  assert.strictEqual((await beacon(null, UA, '{not json')).status >= 400, true);
  assert.strictEqual((await rows()).length, 3); ok('missing / malformed visitor ids and broken JSON store nothing and never error the page');

  await beacon({ vid: 'visitor-cccc-0003', course: 'datascience', utm_campaign: 'x'.repeat(500), utm_source: ['a'], utm_medium: 'PAID', referrer: base + '/datascience' });
  v = await rows(); const last = v[v.length - 1]; assert.strictEqual(last.utm_campaign.length, 120); assert.strictEqual(last.utm_source, null); assert.strictEqual(last.utm_medium, 'paid'); assert.strictEqual(last.referrer_host, null); assert.strictEqual((await db.query('SELECT COUNT(*)::int c FROM leads')).rows[0].c, 0); ok('odd values are trimmed / ignored, the medium is lower-cased; a referrer from our own site is not a source');
  const before = (await rows()).length;
  for (const course of ["'; DROP TABLE leads;--", 'wp-login', 'typo-datascince', 'zzz']) assert.strictEqual((await beacon({ vid: 'stray-visitor-' + course.length + '-x', course })).status, 204);
  assert.strictEqual((await rows()).length, before); assert.strictEqual((await db.query('SELECT COUNT(*)::int c FROM leads')).rows[0].c, 0); ok('a path that is not a master class (/typo, /wp-login, SQL text) is not counted as an ad open, and nothing breaks');
  await beacon({ vid: 'plain-link-visitor-1' }); await beacon({ vid: 'plain-link-visitor-2', course: 'register' });
  v = await rows(); assert.strictEqual(v.length, before + 2); assert.strictEqual(v[v.length - 1].course_slug, null); ok('the plain link (no course, or a reserved word) is still counted, as "no master class"');
  await beacon({ vid: 'case-visitor-0001', course: 'datascience', utm_medium: 'Paid' }); await beacon({ vid: 'case-visitor-0001', course: 'datascience', utm_medium: 'paid' });
  assert.strictEqual((await db.query("SELECT COUNT(*)::int c FROM page_visits WHERE dedupe_key LIKE 'case-visitor-0001|%'")).rows[0].c, 1); ok('"Paid" and "paid" are the same medium: one open, not two');

  /* ---- the counter is wired into the page ---- */
  const js = await (await fetch(base + '/register.js')).text();
  assert(js.includes("'/api/visit'") && js.includes('keepalive: true') && js.includes('knoa_vid') && js.includes("credentials: 'omit'")); ok('the registration page reports each open (once per load, silent on failure)');
  assert(js.includes('sessionStorage') && js.includes('document.prerendering') && js.includes('prerenderingchange')); ok('blocked localStorage falls back to sessionStorage, and pre-rendered pages are reported only when opened');
  assert.strictEqual((await fetch(base + '/api/visit')).status, 404); ok('GET /api/visit does not exist: the counter is write-only from the public side');

  /* ---- analytics: opens, conversion, filters ---- */
  await db.query('DELETE FROM page_visits');
  const V = (vid, o, when) => Visit.record({ visitor_id: vid, ...o }, when);
  const DS = { course_slug: 'datascience' }, CY = { course_slug: 'cybersecurity' };
  await V('p1', { ...DS, utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(0, 1));
  await V('p2', { ...DS, utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(1));
  await V('p3', { ...DS, utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(2));
  await V('p4', { ...DS, utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(3));
  await V('p5', { ...DS, utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(1));
  await V('p6', { ...DS, utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(1));
  await V('p7', { ...CY, utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'cyber-launch' }, ago(2));      // opened, nobody registered
  await V('p8', { ...DS }, ago(2));                                                                                  // plain link, no tags
  await V('p9', { ...DS, utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(20));         // before the window
  await V('p10', { referrer_host: 'l.facebook.com' }, ago(2));                                                       // no course, channel from the referrer
  let phone = 9200000000;
  const L = async (o, when) => { const l = await Lead.create({ first_name: 'F', last_name: 'L', full_name: 'F L', phone: '+91' + (phone++), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', ...o }); await db.query('UPDATE leads SET created_at=$1 WHERE id=$2', [when, l.id]); };
  await L({ course: 'Data Science', course_slug: 'datascience', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(0, 1));
  await L({ course: 'Data Science', course_slug: 'datascience', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels', status: 'Working Professional' }, ago(1));
  await L({ course: 'Data Science', course_slug: 'datascience', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(1));
  const A = (query) => getAnalytics({ tz, now: NOW, query });

  let a = await A({});
  assert.strictEqual(a.visits.available, true); assert.strictEqual(a.visits.window, 9); assert.strictEqual(a.visits.data.length, 14); assert.strictEqual(a.visits.data.reduce((x, y) => x + y, 0), 9); assert.strictEqual(a.totals.window, 3); assert.strictEqual(a.visits.conversionPct, 33.3); ok('link opens in the window, one value per day, and conversion = registrations / opens (3 of 9)');
  assert(a.visits.since && a.visits.since.length > 10); ok('the response says since when opens are counted');

  a = await A({ course: 'datascience' });
  assert.strictEqual(a.visits.window, 7); assert.strictEqual(a.totals.window, 3); assert.strictEqual(a.visits.conversionPct, 42.9); ok('master class filter applies to opens too');
  a = await A({ course: 'datascience', campaign: 'ds-reels' });
  assert.strictEqual(a.visits.window, 4); assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.visits.conversionPct, 50); const row = a.campaignTable[0]; assert.strictEqual(row.opens, 4); assert.strictEqual(row.n, 2); assert.strictEqual(row.conversionPct, 50); ok('Data Science + ds-reels: 4 opened, 2 registered, 50%, same numbers in the campaign table');
  a = await A({ channel: 'Meta', medium: 'paid' }); assert.strictEqual(a.visits.window, 5); ok('channel + medium filters apply to opens (Instagram and Facebook opens are both Meta)');
  a = await A({ campaign: '__none' }); assert.strictEqual(a.visits.window, 2); ok('"no campaign" opens: plain link + referrer-only visit');
  a = await A({ channel: 'Meta' }); assert.strictEqual(a.visits.window, 6); ok('channel can come from the referring site (l.facebook.com), as for registrations');

  a = await A({});
  const cyber = a.campaignTable.find((c) => c.campaign === 'cyber-launch'); assert(cyber); assert.strictEqual(cyber.n, 0); assert.strictEqual(cyber.opens, 1); assert.strictEqual(cyber.conversionPct, 0); assert.strictEqual(cyber.lastLeadAt, null); assert.strictEqual(cyber.topChannel, 'Meta'); ok('a campaign people opened but nobody registered through still gets a row (opens 1, registrations 0, 0%)');
  assert.deepStrictEqual(a.campaignTable.map((c) => c.campaign).slice(0, 2), ['ds-reels', 'ds-search']); assert.strictEqual(a.campaignTable.reduce((x, c) => x + c.n, 0), a.totals.window); assert.strictEqual(a.campaignTable.reduce((x, c) => x + c.opens, 0), a.visits.window); ok('campaign rows: registrations add up to the window total and opens add up to all opens');

  a = await A({ status: 'Student / Fresher' });
  assert.strictEqual(a.visits.available, false); assert.strictEqual(a.visits.window, 0); assert.strictEqual(a.campaignTable[0].opens, null); assert.strictEqual(a.campaignTable[0].conversionPct, null); ok('with an "I am a" filter opens are marked not available (visitors have not chosen yet) instead of showing a wrong number');

  await Visit.record({ visitor_id: 'late-visitor-1', course_slug: 'cybersecurity' }, ago(0, 2)); await L({ course: 'Cyber Security', course_slug: 'cybersecurity' }, ago(0, 2)); await L({ course: 'Cyber Security', course_slug: 'cybersecurity' }, ago(0, 3));
  a = await A({ course: 'cybersecurity' }); assert.strictEqual(a.visits.window, 2); assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.visits.conversionPct, 100);
  a = await A({ course: 'cybersecurity', days: '30' }); await db.query('DELETE FROM page_visits WHERE course_slug = $1', ['cybersecurity']); await Visit.record({ visitor_id: 'late-visitor-2', course_slug: 'cybersecurity' }, ago(0, 2));
  a = await A({ course: 'cybersecurity', days: '60' }); assert.strictEqual(a.visits.window, 1); assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.visits.conversionPct, null); ok('more registrations than opens (leads from before the counter, or a blocked beacon): conversion is "–", never a made-up percentage over 100');

  await db.query('DELETE FROM page_visits'); a = await A({});
  assert.strictEqual(a.visits.window, 0); assert.strictEqual(a.visits.conversionPct, null); assert.strictEqual(a.visits.since, null); ok('no visits yet: zeros, no conversion, no divide-by-zero');
  await Visit.record({ visitor_id: 'edge-visitor-1', course_slug: 'datascience' }, new Date('2026-10-14T18:29:00Z')); await Visit.record({ visitor_id: 'edge-visitor-2', course_slug: 'datascience' }, new Date('2026-10-14T18:31:00Z'));
  a = await A({}); assert.strictEqual(a.visits.data[12], 1); assert.strictEqual(a.visits.data[13], 1); assert.strictEqual(a.visits.today, 1); ok('India midnight (18:30 UTC) splits opens into the right days; "today" counts the 18:31 one');
  assert(!JSON.stringify(a).includes('edge-visitor')); ok('visitor ids never leave the server');

  /* ---- one person, one India day ---- */
  await db.query('DELETE FROM page_visits');
  const rec = (when) => Visit.record({ visitor_id: 'india-day-visitor', course_slug: 'datascience' }, new Date(when));
  const stored = async () => (await db.query("SELECT COUNT(*)::int c FROM page_visits WHERE dedupe_key LIKE 'india-day-visitor|%'")).rows[0].c;
  await rec('2026-10-14T22:00:00Z'); assert.strictEqual(await stored(), 1);     // 15 Oct 03:30 IST (still 14 Oct in UTC)
  await rec('2026-10-15T03:00:00Z'); assert.strictEqual(await stored(), 1);     // 15 Oct 08:30 IST (15 Oct in UTC): same India day, not counted again
  a = await getAnalytics({ tz, now: new Date('2026-10-15T10:00:00Z'), query: {} }); assert.strictEqual(a.visits.today, 1); assert.strictEqual(a.visits.window, 1);
  await rec('2026-10-15T19:00:00Z'); assert.strictEqual(await stored(), 2);     // 16 Oct 00:30 IST: a new India day
  ok('the same person on the same India calendar day counts once even when the UTC date changes in between; the next India day counts again');

  /* ---- abuse: one IP cannot flood the counter ---- */
  let limited = 0; for (let i = 0; i < 640 && !limited; i++) { const x = await beacon({ vid: 'flood-visitor-' + i, course: 'datascience' }); if (x.status === 429) limited = i; }
  assert(limited > 120 && limited <= 605); ok(`a shared IP (college Wi-Fi) can send well over 120 opens in 10 minutes; one IP is limited after ${limited}`);

  server.close(); console.log(`\nAll ${n} visit checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
