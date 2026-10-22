// Campaign-level analytics against a real SQL engine (pg-mem): the filters that go through SQL (campaign, medium),
// the channel filter (derived in JavaScript), the all-time counts and the live feed. Run: node test/campaign.test.js
process.env.LOG_LEVEL = 'silent';
const assert = require('assert');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const Lead = require('../src/models/Lead');
const { getAnalytics } = require('../src/analytics');
let n = 0; const ok = (m) => console.log(`  ✓ C${++n}. ${m}`);
const tz = 'Asia/Kolkata';
const NOW = new Date('2026-10-14T19:00:00Z');
const ago = (d, h = 0) => new Date(NOW.getTime() - d * 86400e3 - h * 3600e3);

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  let phone = 9000000000;
  const mk = async (o, when) => {
    const l = await Lead.create({ first_name: 'F', last_name: 'L', full_name: o.name || 'F L', phone: '+91' + (phone++), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', ...o });
    await db.query('UPDATE leads SET created_at = $1 WHERE id = $2', [when, l.id]);
  };
  const DS = { course: 'Data Science', course_slug: 'datascience' }, CY = { course: 'Cyber Security', course_slug: 'cybersecurity' };
  await mk({ ...DS, name: 'D One', utm_source: 'instagram', utm_medium: 'Paid', utm_campaign: 'ds-reels' }, ago(0, 1));
  await mk({ ...DS, name: 'D Two', utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'ds-reels', status: 'Working Professional', job_role: 'QA / Tester', experience_level: '2-5 yrs' }, ago(1));
  await mk({ ...DS, name: 'D Three', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }, ago(2));
  await mk({ ...DS, name: 'D Four' }, ago(2));
  await mk({ ...CY, name: 'C One', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'cyber-launch' }, ago(3));
  await mk({ ...CY, name: 'C Two', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(4));
  await mk({ ...DS, name: 'D Old', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' }, ago(20));        // previous period
  await mk({ name: 'Ref', referrer: 'https://l.facebook.com/l.php?u=1' }, ago(2));                                           // channel from the referrer, no course
  const A = (query) => getAnalytics({ tz, now: NOW, query });
  const camps = (a) => a.facets.campaign.items.map((x) => x.name + ':' + x.n);

  let a = await A({});
  assert.strictEqual(a.totals.window, 7); assert.strictEqual(a.totals.allTime, 8); assert.strictEqual(a.filters.campaign, null); ok('no filter: 7 in the 14-day window, 8 all time');
  assert.deepStrictEqual(camps(a), ['ds-reels:3', '(no campaign):2', 'cyber-launch:1', 'ds-search:1']); ok('campaign options with counts straight from the database');

  a = await A({ course: 'datascience' });
  assert.deepStrictEqual(camps(a), ['ds-reels:2', '(no campaign):1', 'ds-search:1']); assert.strictEqual(a.totals.window, 4); assert.strictEqual(a.totals.allTime, 5); ok('Data Science: only its own campaigns are offered (ds-reels, ds-search, no campaign)');
  assert.deepStrictEqual(a.courses.map((c) => c.slug + ':' + c.n), ['datascience:4', 'cybersecurity:2', 'generativeai:0', '__none:1']); ok('master class chips carry counts and stay listed while one is selected');

  a = await A({ course: 'datascience', campaign: 'ds-reels' });
  assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.totals.allTime, 3); assert.strictEqual(a.totals.previous, 1); assert.strictEqual(a.campaignTable.length, 1); assert.strictEqual(a.recent.length, 3); assert(a.recent.every((r) => r.course === 'Data Science')); ok('course + campaign: window, all-time (SQL), previous period and the live feed all agree');

  a = await A({ campaign: '__none' });
  assert.strictEqual(a.totals.window, 2); assert.strictEqual(a.totals.allTime, 2); ok('"no campaign" works in SQL too');

  a = await A({ medium: 'PAID' });
  assert.strictEqual(a.totals.window, 4); assert.strictEqual(a.totals.allTime, 5); assert.deepStrictEqual(a.facets.medium.items.map((x) => x.key + ':' + x.n), ['paid:4', '__none:2', 'cpc:1']); ok('medium filter is case-insensitive end to end');

  a = await A({ channel: 'Meta' });
  assert.strictEqual(a.totals.window, 5); assert.strictEqual(a.totals.allTime, 6); assert.strictEqual(a.recent.length, 6); assert(a.recent.every((r) => ['D One', 'D Two', 'C One', 'C Two', 'D Old', 'Ref'].includes(r.full_name))); ok('channel filter: Facebook + Instagram are one channel, Meta (utm_source instagram / ig / facebook): window, all-time and live feed');
  assert(a.recent.some((r) => r.full_name === 'Ref')); ok('channel can come from the referrer (l.facebook.com) when there is no utm_source, and still counts as Meta');
  a = await A({ channel: 'Direct / no tag' });
  assert.strictEqual(a.totals.window, 1); assert.strictEqual(a.totals.allTime, 1); ok('"Direct / no tag" is a channel you can filter on');

  a = await A({ course: 'cybersecurity', channel: 'Meta', medium: 'paid', campaign: 'cyber-launch', status: 'Student / Fresher' });
  assert.strictEqual(a.totals.window, 1); assert.strictEqual(a.totals.allTime, 1); assert.strictEqual(a.recent[0].full_name, 'C One'); ok('all five filters together');

  for (const bad of ["'; DROP TABLE leads; --", '%', '_', '" OR 1=1 --', '\\']) {
    const r = await A({ campaign: bad, medium: bad, channel: bad });
    assert.strictEqual(r.totals.window, 0); assert.strictEqual(r.totals.allTime, 0);
  }
  assert.strictEqual((await db.query('SELECT COUNT(*)::int AS c FROM leads')).rows[0].c, 8); ok('quotes, % _ and backslashes in a filter are plain text: no match, nothing broken, table intact');

  const json = JSON.stringify(await A({}));
  assert(!json.includes('+919') && !json.includes('Mozilla') && !json.includes('l.facebook.com')); ok('response still carries no phone numbers, user agents or referrer URLs');
  const t0 = Date.now(); for (let i = 0; i < 20; i++) await A({ course: 'datascience', campaign: 'ds-reels', days: String([7, 14, 30][i % 3]) }); assert(Date.now() - t0 < 5000); ok('20 filtered requests answer quickly');

  console.log(`\nAll ${n} campaign checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
