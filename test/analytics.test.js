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
assert(ad.channels.some((c) => c.name === 'Instagram' && c.n === 2)); assert(ad.channels.some((c) => c.name === 'Facebook / Meta' && c.n === 1)); assert(ad.channels.some((c) => c.name === 'Direct / no tag' && c.n === 2)); ok('channels: utm_source (ig / instagram merge), referrer host, otherwise Direct');
const reels = ad.adTable.find((r) => r.campaign === 'ds-reels'); assert.strictEqual(reels.channel, 'Instagram'); assert.strictEqual(reels.medium, 'paid'); assert.strictEqual(reels.n, 2); assert.strictEqual(reels.topCourse, 'Data Science'); assert.strictEqual(sumOf(ad.adTable.map((r) => r.n)), ad.totals.window); ok('ad table: channel × medium × campaign rows add up to the window total');
assert.deepStrictEqual(ad.devices.map((x) => [x.name, x.n]).sort(), [['Desktop', 1], ['Mobile', 2], ['Unknown', 2]]); assert(ad.countries.some((c) => c.name === 'IN' && c.n === 2) && ad.countries.some((c) => c.name === 'AE')); assert.strictEqual(ad.quality.withEmail, 1); ok('devices, country codes and e-mail capture rate');
assert.strictEqual(sumOf(ad.heatmap.map(sumOf)), ad.totals.window); assert.strictEqual(ad.heatmap.length, 7); assert(ad.heatmap.every((r) => r.length === 24)); assert.strictEqual(ad.heatmap[3][0], 1); assert.strictEqual(ad.heatmap[2][23], 1); ok('heatmap: 7 weekdays × 24 hours adds up; 15 Oct 00:30 IST = Thursday 12 AM, 14 Oct 23:30 IST = Wednesday 11 PM');
assert.strictEqual(ad.previousOverall.length, 14); ok('previous-period series has one value per day');
const unknown = aggregate([at('2026-10-14T10:00:00Z', { course_slug: 'foo-bar', course: 'Foo Bar' })], w, { tz, now: NOW });
assert(unknown.series.some((s) => s.course_slug === 'foo-bar' && s.name === 'Foo Bar' && s.total === 1)); ok('an unknown course link still gets its own line');
const only = aggregate(rows, w, { tz, now: NOW, filters: { course: 'generativeai' } }); assert.strictEqual(only.series.length, 1); ok('course filter keeps a single line');
const empty = aggregate([], w, { tz, now: NOW }); assert.strictEqual(empty.totals.window, 0); assert.strictEqual(empty.totals.peak, null); assert.strictEqual(empty.totals.deltaPct, null); assert.strictEqual(empty.totals.lastLeadAt, null); ok('no leads: zeros, no crash, no divide-by-zero');
assert.deepStrictEqual(normalizeFilters({ status: 'Student / Fresher', course: '__none' }), { status: 'Student / Fresher', course: '__none' }); assert.deepStrictEqual(normalizeFilters({ status: 'x', course: "'; drop" }), {}); ok('filters: only known statuses and clean course slugs pass');

console.log(`\nAll ${n} analytics checks passed`);
