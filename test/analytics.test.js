// Analytics maths (pure, no database): windows, day bucketing in the configured time zone, filters, totals. Run: node test/analytics.test.js
const assert = require('assert');
const path = require('path'); const Module = require('module');
// analytics.js loads the Lead model, which loads the DB driver; this test never queries, so give it a stub.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('no db in this test'); } } };
const { aggregate, resolveWindow, normalizeFilters, dayIndex } = require('../src/analytics');
let n = 0; const ok = (m) => console.log(`  ✓ N${++n}. ${m}`);
const tz = 'Asia/Kolkata';
const sumOf = (a) => a.reduce((x, y) => x + y, 0);
const NOW = new Date('2026-10-14T19:00:00Z');                     // = 2026-10-15 00:30 in India
const at = (iso, o = {}) => ({ created_at: iso, status: 'Student / Fresher', course_slug: null, course: null, ...o });

/* windows */
let w = resolveWindow({ tz, now: NOW });
assert.strictEqual(w.n, 14); assert.strictEqual(w.to, '2026-10-15'); assert.strictEqual(w.from, '2026-10-02'); assert.strictEqual(w.bounds.length, 15); ok('default window: 14 days ending today in India time (not UTC)');
assert.strictEqual(resolveWindow({ tz, now: NOW, days: '30' }).n, 30); assert.strictEqual(resolveWindow({ tz, now: NOW, days: '99' }).n, 14); assert.strictEqual(resolveWindow({ tz, now: NOW, days: 'x' }).n, 14); ok('only 7/14/30/60/90 accepted as presets');
w = resolveWindow({ tz, now: NOW, from: '2026-10-05', to: '2026-10-10' }); assert.strictEqual(w.n, 6); assert(w.custom); ok('custom range is inclusive of both days');
assert.strictEqual(resolveWindow({ tz, now: NOW, from: '2026-10-10', to: '2099-01-01' }).to, '2026-10-15'); ok('future end date is clamped to today');
assert.strictEqual(resolveWindow({ tz, now: NOW, from: '2020-01-01' }).n, 120); ok('range is capped at 120 days');
assert(resolveWindow({ tz, now: NOW, from: '2026-10-15', to: '2026-10-15' }).n >= 2); assert(resolveWindow({ tz, now: NOW, from: '2026-10-12', to: '2026-10-03' }).n >= 2); ok('single-day or reversed range still yields a drawable window');
assert.strictEqual(resolveWindow({ tz, now: NOW, from: 'junk', to: '2026-02-30' }).n, 14); ok('invalid dates are ignored');
const dst = resolveWindow({ tz: 'America/New_York', now: new Date('2026-03-10T12:00:00Z'), days: '14' }); assert.strictEqual(dst.n, 14); assert.strictEqual(new Set(dst.labels).size, 14); ok('daylight-saving change does not duplicate or skip a day');

/* bucketing */
w = resolveWindow({ tz, now: NOW });
const b = w.bounds.map((d) => d.getTime());
assert.strictEqual(dayIndex(b, new Date('2026-10-14T18:29:59Z').getTime()), 12); assert.strictEqual(dayIndex(b, new Date('2026-10-14T18:30:00Z').getTime()), 13); assert.strictEqual(dayIndex(b, new Date('2026-10-01T18:29:00Z').getTime()), -1); ok('India midnight (18:30 UTC) splits days exactly');

/* aggregate */
const rows = [
  at('2026-10-14T19:00:00Z', { course_slug: 'cybersecurity', course: 'Cyber Security' }),                        // today
  at('2026-10-14T18:00:00Z', { status: 'Working Professional', course_slug: 'datascience', course: 'Data Science', job_role: 'QA / Tester', experience_level: '2-5 yrs', highest_qualification: 'MBA' }),   // yesterday (IST)
  at('2026-10-12T05:00:00Z', { course_slug: 'generativeai', course: 'Generative AI', student_course: 'BCA', student_status: 'Final year', specialization: 'Civil', utm_source: 'meta' }),
  at('2026-10-10T05:00:00Z', { course_slug: 'generativeai', course: 'Generative AI', status: 'Working Professional' }),
  at('2026-10-01T05:00:00Z', {}),                                                                                 // previous period
  at('2026-09-20T05:00:00Z', { course_slug: 'foo-bar', course: 'Foo Bar' })                                       // 25 days ago: previous period, inside the 30-day count
];
const a = aggregate(rows, w, { tz, now: NOW, allTime: 6 });
assert.strictEqual(a.totals.window, 4); assert.strictEqual(a.totals.today, 1); assert.strictEqual(a.totals.previous, 2); assert.strictEqual(a.totals.deltaPct, 100); assert.strictEqual(a.totals.last7, 4); assert.strictEqual(a.totals.last30, 6); assert.strictEqual(a.totals.allTime, 6); ok('window / today / 7 / 30 day counts and % change vs previous period');
assert.strictEqual(a.overall[13], 1); assert.strictEqual(a.overall[12], 1); assert.strictEqual(a.totals.peak.n, 1); assert.strictEqual(a.totals.avgPerDay, 0.3); ok('daily series, best day and average per day');
const by = Object.fromEntries(a.series.map((s) => [s.key, s]));
assert.deepStrictEqual(Object.keys(by).slice(0, 3), ['datascience', 'cybersecurity', 'generativeai']); assert.strictEqual(by.generativeai.total, 2); assert.strictEqual(by.__none.total, 0); assert(by.datascience.data.every((v) => v === 0) === false); ok('one line per master class, zero-filled when empty');
assert.strictEqual(a.matrix.rows.find((r) => r.course_slug === 'generativeai').counts['Working Professional'], 1); assert.strictEqual(a.matrix.rows.reduce((x, r) => x + r.total, 0), 4); ok('master class × "I am a" matrix adds up');
assert.strictEqual(a.byStatus.find((s) => s.status === 'Student / Fresher').n, 2); assert.strictEqual(a.byStatus[0].share + a.byStatus[1].share, 100); ok('"I am a" split and shares');
assert.deepStrictEqual(a.students.courses, [{ name: 'BCA', n: 1 }]); assert.deepStrictEqual(a.professionals.experience, [{ name: '2–5 yrs', n: 1 }]); assert.deepStrictEqual(a.students.specializations, [{ name: 'Civil', n: 1 }]); assert.deepStrictEqual(a.professionals.qualifications, [{ name: 'MBA', n: 1 }]); assert.strictEqual(a.sources.find((s) => s.name === 'meta').n, 1); ok('student / professional / source breakdowns');
assert.strictEqual(a.byHour[0], 1); assert.strictEqual(a.byHour.reduce((x, y) => x + y, 0), 4); ok('hour-of-day uses India time (19:00 UTC = 00:30)');
/* ad analysis */
const adRows = [
  at('2026-10-14T19:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'instagram', utm_medium: 'Paid', utm_campaign: 'ds-reels', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari', country_code: '+91', email: 'a@x.in' }),
  at('2026-10-14T18:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'ds-reels', user_agent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile', country_code: '+91' }),
  at('2026-10-12T05:00:00Z', { course_slug: 'cybersecurity', course: 'Cyber Security', referrer: 'https://l.facebook.com/l.php?u=x', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome', country_code: '+971', status: 'Working Professional' }),
  at('2026-10-10T05:00:00Z', { course_slug: null }),
  at('2026-10-03T05:00:00Z', {})                                                                             // inside the window, 12 days back
];
const ad = aggregate(adRows, w, { tz, now: NOW });
assert(ad.channels.some((c) => c.name === 'Meta' && c.n === 3)); assert.strictEqual(ad.channels.filter((c) => c.name === 'Meta').length, 1); assert(ad.channels.some((c) => c.name === 'Direct / no tag' && c.n === 2)); ok('channels: utm_source (ig / instagram / facebook / referrer l.facebook.com are one channel, Meta), otherwise Direct');
const reels = ad.adTable.find((r) => r.campaign === 'ds-reels'); assert.strictEqual(reels.channel, 'Meta'); assert.strictEqual(reels.medium, 'paid'); assert.strictEqual(reels.n, 2); assert.strictEqual(reels.topCourse, 'Data Science'); assert.strictEqual(sumOf(ad.adTable.map((r) => r.n)), ad.totals.window); ok('ad table: channel × medium × campaign rows add up to the window total');
assert.deepStrictEqual(ad.devices.map((x) => [x.name, x.n]).sort(), [['Desktop', 1], ['Mobile', 2], ['Unknown', 2]]); assert(ad.countries.some((c) => c.name === 'IN' && c.n === 2) && ad.countries.some((c) => c.name === 'AE')); assert.strictEqual(ad.quality.withEmail, 1); ok('devices, country codes and e-mail capture rate');
assert.strictEqual(sumOf(ad.heatmap.map(sumOf)), ad.totals.window); assert.strictEqual(ad.heatmap.length, 7); assert(ad.heatmap.every((r) => r.length === 24)); assert.strictEqual(ad.heatmap[3][0], 1); assert.strictEqual(ad.heatmap[2][23], 1); ok('heatmap: 7 weekdays × 24 hours adds up; 15 Oct 00:30 IST = Thursday 12 AM, 14 Oct 23:30 IST = Wednesday 11 PM');
assert.strictEqual(ad.previousOverall.length, 14); ok('previous-period series has one value per day');
const unknown = aggregate([at('2026-10-14T10:00:00Z', { course_slug: 'foo-bar', course: 'Foo Bar' })], w, { tz, now: NOW });
assert(unknown.series.some((s) => s.course_slug === 'foo-bar' && s.name === 'Foo Bar' && s.total === 1)); ok('an unknown course link still gets its own line');
const only = aggregate(rows, w, { tz, now: NOW, filters: { course: 'generativeai' } }); assert.strictEqual(only.series.length, 1); ok('course filter keeps a single line');
const empty = aggregate([], w, { tz, now: NOW }); assert.strictEqual(empty.totals.window, 0); assert.strictEqual(empty.totals.peak, null); assert.strictEqual(empty.totals.deltaPct, null); assert.strictEqual(empty.totals.lastLeadAt, null); ok('no leads: zeros, no crash, no divide-by-zero');
assert.deepStrictEqual(normalizeFilters({ status: 'Student / Fresher', course: '__none' }), { status: 'Student / Fresher', course: '__none' }); assert.deepStrictEqual(normalizeFilters({ status: 'x', course: "'; drop" }), {}); ok('filters: only known statuses and clean course slugs pass');

/* ---- campaign level: filters, cascading options, tree ---- */
const cr = (iso, o) => at(iso, o);
const CAMP = [
  cr('2026-10-14T19:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'instagram', utm_medium: 'Paid', utm_campaign: 'ds-reels' }),
  cr('2026-10-14T18:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'ds-reels', status: 'Working Professional' }),
  cr('2026-10-12T05:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search' }),
  cr('2026-10-12T06:00:00Z', { course_slug: 'datascience', course: 'Data Science' }),                                                        // no tags at all
  cr('2026-10-11T05:00:00Z', { course_slug: 'cybersecurity', course: 'Cyber Security', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'cyber-launch' }),
  cr('2026-10-10T05:00:00Z', { course_slug: 'cybersecurity', course: 'Cyber Security', utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'ds-reels' }),   // same campaign name under another course
  cr('2026-10-01T05:00:00Z', { course_slug: 'datascience', course: 'Data Science', utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'ds-reels' })       // previous period
];
const names = (o) => o.items.map((x) => x.name + ':' + x.n);
let c0 = aggregate(CAMP, w, { tz, now: NOW });
assert.strictEqual(c0.totals.window, 6); assert.deepStrictEqual(names(c0.facets.campaign), ['ds-reels:3', '(no campaign):1', 'cyber-launch:1', 'ds-search:1']); ok('campaign options with counts (all master classes)');
let c1 = aggregate(CAMP, w, { tz, now: NOW, filters: { course: 'datascience' } });
assert.strictEqual(c1.totals.window, 4); assert.deepStrictEqual(names(c1.facets.campaign), ['ds-reels:2', '(no campaign):1', 'ds-search:1']); assert(!names(c1.facets.campaign).some((x) => x.startsWith('cyber-launch'))); ok('picking a master class narrows the campaign options to that master class (Data Science -> ds-reels, ds-search, no campaign)');
assert.deepStrictEqual(names(c1.facets.course).slice(0, 2), ['Data Science:4', 'Cyber Security:2']); ok('master class options keep their counts while one is selected (other filters applied, not itself)');
let c2 = aggregate(CAMP, w, { tz, now: NOW, filters: { course: 'datascience', campaign: 'ds-reels' } });
assert.strictEqual(c2.totals.window, 2); assert.strictEqual(c2.totals.previous, 1); assert.strictEqual(c2.series.length, 1); assert.strictEqual(c2.byCourse[0].n, 2); assert.strictEqual(c2.campaignTable.length, 1); assert.strictEqual(c2.campaignTable[0].campaign, 'ds-reels'); ok('course + campaign filter: totals, previous period, lines and table all follow it');
assert.deepStrictEqual(names(c2.facets.campaign), ['ds-reels:2', '(no campaign):1', 'ds-search:1']); ok('the campaign options do not collapse once a campaign is picked (you can switch straight to a sibling)');
let c3 = aggregate(CAMP, w, { tz, now: NOW, filters: { campaign: 'ds-reels' } });
assert.strictEqual(c3.totals.window, 3); assert.deepStrictEqual(names(c3.facets.course).slice(0, 2), ['Data Science:2', 'Cyber Security:1']); assert.deepStrictEqual(c3.byCourse.map((x) => x.course + ':' + x.n), ['Data Science:2', 'Cyber Security:1']); ok('same campaign name under two master classes: both listed, split by master class');
let c4 = aggregate(CAMP, w, { tz, now: NOW, filters: { campaign: '__none' } });
assert.strictEqual(c4.totals.window, 1); assert.strictEqual(c4.campaignTable[0].campaign, '(no campaign)'); ok('"no campaign" filter finds leads without a utm_campaign');
let c5 = aggregate(CAMP, w, { tz, now: NOW, filters: { channel: 'Meta' } });
assert.strictEqual(c5.totals.window, 4); assert(c5.facets.channel.items.some((x) => x.name === 'Meta' && x.n === 4)); assert.deepStrictEqual(names(c5.facets.channel), ['Meta:4', 'Direct / no tag:1', 'Google:1']); assert.deepStrictEqual(names(c5.facets.campaign), ['ds-reels:3', 'cyber-launch:1']); ok('channel filter: instagram, ig and facebook are all one channel, Meta, and the campaigns that channel ran');
let c6 = aggregate(CAMP, w, { tz, now: NOW, filters: { medium: 'paid', course: 'datascience' } });
assert.strictEqual(c6.totals.window, 2); assert(c6.facets.medium.items.some((x) => x.key === 'cpc' && x.n === 1)); ok('medium filter is case-insensitive (Paid = paid) and keeps the other mediums as options');
let c7 = aggregate(CAMP, w, { tz, now: NOW, filters: { status: 'Working Professional' } });
assert.strictEqual(c7.totals.window, 1); assert.strictEqual(c7.campaignTable[0].campaign, 'ds-reels'); ok('"I am a" filter also narrows the campaigns');
const tr = c1.tree; assert.strictEqual(tr[0].course, 'Data Science'); assert.deepStrictEqual(tr[0].campaigns.map((x) => x.name + ':' + x.n), ['ds-reels:2', '(no campaign):1', 'ds-search:1']); assert.strictEqual(tr.length, 2); assert.strictEqual(sumOf(tr.map((x) => x.n)), 6);
assert.deepStrictEqual(tr.find((x) => x.course === 'Cyber Security').campaigns.map((x) => x.name), ['cyber-launch', 'ds-reels']); ok('master class -> campaign tree ignores the course / campaign filters, so the whole hierarchy stays visible');
assert.deepStrictEqual(aggregate(CAMP, w, { tz, now: NOW, filters: { channel: 'Meta' } }).tree.reduce((x, y) => x + y.n, 0), 4); ok('tree does follow the channel / medium / "I am a" filters');
const ct = c0.campaignTable.find((r) => r.campaign === 'ds-reels'); assert.strictEqual(ct.n, 3); assert.strictEqual(ct.data.length, 14); assert.strictEqual(sumOf(ct.data), 3); assert.strictEqual(ct.topCourse, 'Data Science'); assert.strictEqual(ct.students, 2); assert.strictEqual(ct.professionals, 1); assert.strictEqual(ct.topChannel, 'Meta'); assert.strictEqual(sumOf(c0.campaignTable.map((r) => r.n)), c0.totals.window); ok('campaign table: counts, daily trend, who registered, top channel and master class; rows add up to the window total');
assert.strictEqual(c0.campaignSeries[0].name, 'ds-reels'); assert(c0.campaignSeries.length <= 6); ok('campaign lines for the over-time chart (top 6)');
const gone = aggregate(CAMP, w, { tz, now: NOW, filters: { course: 'datascience', campaign: 'cyber-launch' } });
assert.strictEqual(gone.totals.window, 0); assert(gone.facets.campaign.items.some((x) => x.key === 'cyber-launch' && x.n === 0)); ok('a selected campaign with no leads stays in the options (at 0) instead of vanishing');
assert.deepStrictEqual(normalizeFilters({ campaign: '  ds-reels  ', medium: ' Paid ', channel: 'Meta' }), { campaign: 'ds-reels', medium: 'paid', channel: 'Meta' }); assert.deepStrictEqual(normalizeFilters({ campaign: ['a', 'b'], medium: { x: 1 }, channel: '' }), {}); assert.strictEqual(normalizeFilters({ campaign: 'x'.repeat(500) }).campaign.length, 120); assert.strictEqual(normalizeFilters({ campaign: 'a\u0000b\nc' }).campaign, 'a b c'); ok('campaign / medium / channel filters are trimmed, length-capped, control characters removed, non-text ignored');

console.log(`\nAll ${n} analytics checks passed`);
