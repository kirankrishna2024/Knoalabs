// Live analytics: turns the filtered leads into everything the analytics page draws.
//
//   resolveWindow()  query string  -> the calendar days to show (in the configured time zone)
//   aggregate()      leads + window -> counts per day / course / "I am a" / hour ...   (pure: no database, unit-tested)
//   getAnalytics()   the above + the database queries + a 1-second cache so several open tabs cost one query
//
// Everything is bucketed by the *calendar day in the configured time zone* (TIMEZONE, default Asia/Kolkata),
// so "today" means the same thing here as on the leads dashboard and in the Excel export.
const O = require('./options');
const Lead = require('./models/Lead');
const { STATUSES } = O;
const { parseYMD, zonedMidnight, startOfDay, dayParts, hourOf } = require('./time');
const { COUNTRIES } = require('./countries');

const NO_COURSE = Lead.NO_COURSE;
const NO_COURSE_NAME = 'No course in link';
const PRESETS = [7, 14, 30, 60, 90];
const DEFAULT_DAYS = 14;
const MAX_DAYS = 120;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const label = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const addDays = (p, n) => { const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const midnight = (tz, p) => zonedMidnight(tz, p.y, p.m, p.d);
const diffDays = (a, b) => Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);

/** Only known statuses and well-formed course slugs get through; anything else is ignored. */
function normalizeFilters(q = {}) {
  const f = {};
  if (STATUSES.includes(q.status)) f.status = q.status;
  if (q.course === NO_COURSE) f.course = NO_COURSE;
  else if (/^[a-z0-9-]{1,80}$/.test(String(q.course || ''))) f.course = String(q.course);
  return f;
}

/**
 * The days to show. `to` defaults to today (never later), `from` + `to` give a custom range (2-120 days),
 * otherwise `days` (7/14/30/60/90, default 14) counts back from `to`.
 */
function resolveWindow({ tz, now = new Date(), from, to, days } = {}) {
  const today = dayParts(tz, now);
  let end = parseYMD(to) || today;
  if (diffDays(end, today) < 0) end = today;                         // no future days
  const f = parseYMD(from);
  let start;
  if (f) start = f;
  else start = addDays(end, -((PRESETS.includes(Number(days)) ? Number(days) : DEFAULT_DAYS) - 1));
  if (diffDays(start, end) < 1) start = addDays(end, -1);            // at least two points so there is a line
  if (diffDays(start, end) + 1 > MAX_DAYS) start = addDays(end, -(MAX_DAYS - 1));
  const n = diffDays(start, end) + 1;
  const labels = [], bounds = [];
  for (let i = 0; i <= n; i++) {
    const p = addDays(start, i);
    if (i < n) labels.push(label(p));
    bounds.push(midnight(tz, p));                   // bounds[n] = start of the day after `end`
  }
  return { n, labels, bounds, start, end, custom: Boolean(f || parseYMD(to)), from: labels[0], to: labels[n - 1] };
}

/** Index of the day containing instant `t` (ms), or -1 when outside the window. Binary search, no Intl calls. */
function dayIndex(boundsMs, t) {
  const n = boundsMs.length - 1;
  if (t < boundsMs[0] || t >= boundsMs[n]) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (boundsMs[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

const courseName = (slug, fallback) => (slug === NO_COURSE ? NO_COURSE_NAME : O.COURSES[slug] || fallback || slug);
const top = (map, limit = 6) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).slice(0, limit).map(([name, n]) => ({ name, n }));
const bump = (map, k, by = 1) => map.set(k, (map.get(k) || 0) + by);


/* ---------- ad-analysis helpers ---------- */
const SOCIAL = [[/instagram|^ig$|l\.instagram/i, 'Instagram'], [/facebook|^fb$|^meta$|m\.facebook|l\.facebook/i, 'Facebook / Meta'], [/google|gclid|adwords/i, 'Google'], [/youtube|youtu\.be/i, 'YouTube'],
  [/whatsapp|wa\.me|^wa$/i, 'WhatsApp'], [/linkedin|lnkd/i, 'LinkedIn'], [/^t\.co$|twitter|^x$|x\.com/i, 'X / Twitter'], [/telegram|^t\.me$/i, 'Telegram'], [/bing/i, 'Bing']];
const niceChannel = (raw) => { const t = String(raw).trim(); for (const [re, n] of SOCIAL) if (re.test(t)) return n; return t.length > 28 ? t.slice(0, 27) + '…' : t.charAt(0).toUpperCase() + t.slice(1); };
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Where the lead came from: the UTM source when the ad link is tagged, else the referring site, else Direct. */
function channelOf(r) {
  if (r.utm_source && String(r.utm_source).trim()) return niceChannel(r.utm_source);
  const h = hostOf(r.referrer);
  return h ? niceChannel(h) : 'Direct / no tag';
}
function deviceOf(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown';
  if (/ipad|tablet|android(?!.*mobile)/i.test(s)) return 'Tablet';
  if (/mobi|iphone|ipod|android/i.test(s)) return 'Mobile';
  return 'Desktop';
}
const COUNTRY_BY_DIAL = new Map(); for (const c of COUNTRIES) if (!c.other && !COUNTRY_BY_DIAL.has(c.d)) COUNTRY_BY_DIAL.set(c.d, c.c);
const countryOf = (dial) => (dial ? COUNTRY_BY_DIAL.get(dial) || dial : 'Other');

/**
 * Pure aggregation. `rows` are leads (any age) matching the status / course filters.
 * Returns the numbers for the selected window, plus today / 7 / 30 day counts and the previous period for the % change.
 */
function aggregate(rows, win, { tz, now = new Date(), filters = {}, allTime = null } = {}) {
  const n = win.n;
  const bMs = win.bounds.map((d) => d.getTime());
  const prevStartMs = midnight(tz, addDays(win.start, -n)).getTime();
  const t0 = startOfDay(tz, now, 0).getTime(), t7 = startOfDay(tz, now, -6).getTime(), t30 = startOfDay(tz, now, -29).getTime();

  const byCourse = new Map();                  // slug|NO_COURSE -> { name, data[n], total }
  const byStatus = new Map(STATUSES.map((s) => [s, { data: new Array(n).fill(0), total: 0 }]));
  const overall = new Array(n).fill(0);
  const matrix = new Map();                    // course -> { status -> n }
  const hours = new Array(24).fill(0);
  const stuCourses = new Map(), stuStatus = new Map(), stuSpec = new Map(), roles = new Map(), exp = new Map(), quals = new Map(), sources = new Map();
  const prevBounds = []; for (let i = 0; i <= n; i++) prevBounds.push(midnight(tz, addDays(win.start, -n + i)).getTime());
  const previousOverall = new Array(n).fill(0);
  const dow = win.labels.map((l) => (new Date(l + 'T00:00:00Z').getUTCDay() + 6) % 7);          // Monday = 0
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const channels = new Map(), campaigns = new Map(), mediums = new Map(), devices = new Map(), countries = new Map(), colleges = new Map(), adRows = new Map();
  let withEmail = 0;
  let today = 0, last7 = 0, last30 = 0, previous = 0, inWindow = 0, lastLeadMs = 0;

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > lastLeadMs) lastLeadMs = t;
    if (t >= t0) today++;
    if (t >= t7) last7++;
    if (t >= t30) last30++;
    if (t >= prevStartMs && t < bMs[0]) { previous++; const pi = dayIndex(prevBounds, t); if (pi >= 0) previousOverall[pi]++; }
    const i = dayIndex(bMs, t);
    if (i < 0) continue;

    inWindow++; overall[i]++;
    const slug = r.course_slug || NO_COURSE;
    let c = byCourse.get(slug);
    if (!c) { c = { name: courseName(slug, r.course), data: new Array(n).fill(0), total: 0 }; byCourse.set(slug, c); }
    c.data[i]++; c.total++;
    const st = byStatus.get(r.status);
    if (st) { st.data[i]++; st.total++; }
    const mx = matrix.get(slug) || {}; mx[r.status] = (mx[r.status] || 0) + 1; matrix.set(slug, mx);
    const hr = hourOf(tz, new Date(t));
    hours[hr]++; heat[dow[i]][hr]++;
    const ch = channelOf(r), camp = (r.utm_campaign && String(r.utm_campaign).trim()) || '(no campaign)', med = (r.utm_medium && String(r.utm_medium).trim().toLowerCase()) || '(none)';
    let cs = channels.get(ch); if (!cs) { cs = { total: 0, data: new Array(n).fill(0) }; channels.set(ch, cs); } cs.total++; cs.data[i]++;
    bump(campaigns, camp); bump(mediums, med); bump(devices, deviceOf(r.user_agent)); bump(countries, countryOf(r.country_code));
    if (r.email) withEmail++;
    if (r.status === 'Student / Fresher' && r.college_name) bump(colleges, String(r.college_name).trim());
    const ak = ch + '\u0001' + med + '\u0001' + camp; let ar = adRows.get(ak);
    if (!ar) { ar = { channel: ch, medium: med, campaign: camp, n: 0, students: 0, professionals: 0, courses: new Map(), lastMs: 0 }; adRows.set(ak, ar); }
    ar.n++; if (r.status === 'Student / Fresher') ar.students++; else if (r.status === 'Working Professional') ar.professionals++;
    bump(ar.courses, courseName(slug, r.course)); if (t > ar.lastMs) ar.lastMs = t;
    bump(sources, r.utm_source || 'Direct / no UTM tag');
    if (r.status === 'Student / Fresher') { if (r.student_course) bump(stuCourses, r.student_course); if (r.student_status) bump(stuStatus, r.student_status); if (r.specialization) bump(stuSpec, r.specialization); }
    else if (r.status === 'Working Professional') { if (r.job_role) bump(roles, r.job_role); if (r.experience_level) bump(exp, r.experience_level.replace('-', '–')); if (r.highest_qualification) bump(quals, r.highest_qualification); }
  }

  // one line per master class: every configured one (even at zero) + anything else that has data in the window
  let slugs = [...Object.keys(O.COURSES)];
  for (const s of [...byCourse.keys()].filter((k) => k !== NO_COURSE && !slugs.includes(k)).sort((a, b) => byCourse.get(b).total - byCourse.get(a).total)) slugs.push(s);
  slugs.push(NO_COURSE);
  if (filters.course) slugs = slugs.filter((s) => s === filters.course);
  const series = slugs.map((slug) => {
    const c = byCourse.get(slug);
    return { course_slug: slug === NO_COURSE ? null : slug, key: slug, name: courseName(slug, c && c.name), total: c ? c.total : 0, data: c ? c.data : new Array(n).fill(0) };
  });

  let peak = null;
  overall.forEach((v, i) => { if (v > 0 && (!peak || v > peak.n)) peak = { date: win.labels[i], n: v }; });
  const share = (v) => (inWindow ? Math.round((v / inWindow) * 1000) / 10 : 0);
  const statuses = filters.status ? [filters.status] : STATUSES;

  return {
    labels: win.labels,
    overall,
    series,
    statusSeries: STATUSES.filter((s) => statuses.includes(s)).map((s) => ({ status: s, total: byStatus.get(s).total, data: byStatus.get(s).data })),
    totals: {
      allTime: allTime == null ? null : allTime,
      window: inWindow, previous,
      deltaPct: previous ? Math.round(((inWindow - previous) / previous) * 1000) / 10 : null,
      today, last7, last30,
      avgPerDay: Math.round((inWindow / n) * 10) / 10,
      peak,
      lastLeadAt: lastLeadMs ? new Date(lastLeadMs).toISOString() : null
    },
    byCourse: series.filter((s) => s.total > 0).sort((a, b) => b.total - a.total).map((s) => ({ course_slug: s.course_slug, course: s.name, n: s.total, share: share(s.total) })),
    byStatus: STATUSES.filter((s) => statuses.includes(s)).map((s) => ({ status: s, n: byStatus.get(s).total, share: share(byStatus.get(s).total) })),
    matrix: {
      statuses,
      rows: series.filter((s) => s.total > 0).sort((a, b) => b.total - a.total).map((s) => ({ course_slug: s.course_slug, course: s.name, total: s.total, counts: Object.fromEntries(statuses.map((st) => [st, (matrix.get(s.key) || {})[st] || 0])) }))
    },
    byHour: hours,
    students: { courses: top(stuCourses), statuses: top(stuStatus, 4), specializations: top(stuSpec) },
    professionals: { roles: top(roles), experience: top(exp, 4), qualifications: top(quals) },
    sources: top(sources),
    previousOverall,
    channels: top(new Map([...channels].map(([k, v]) => [k, v.total])), 8).map((c) => ({ ...c, share: share(c.n) })),
    channelSeries: [...channels].sort((a, b) => b[1].total - a[1].total).slice(0, 5).map(([name, v]) => ({ name, total: v.total, data: v.data })),
    campaigns: top(campaigns, 8).map((c) => ({ ...c, share: share(c.n) })),
    mediums: top(mediums, 6).map((c) => ({ ...c, share: share(c.n) })),
    devices: top(devices, 4).map((c) => ({ ...c, share: share(c.n) })),
    countries: top(countries, 6).map((c) => ({ ...c, share: share(c.n) })),
    adTable: [...adRows.values()].sort((a, b) => b.n - a.n || a.channel.localeCompare(b.channel)).slice(0, 15).map((r) => ({
      channel: r.channel, medium: r.medium, campaign: r.campaign, n: r.n, share: share(r.n), students: r.students, professionals: r.professionals,
      topCourse: top(r.courses, 1)[0].name, lastLeadAt: new Date(r.lastMs).toISOString()
    })),
    heatmap: heat,
    quality: { withEmail, emailPct: inWindow ? Math.round((withEmail / inWindow) * 1000) / 10 : 0 },
    colleges: top(colleges, 6)
  };
}

/* ---------- database + cache ---------- */
const cache = new Map();
const CACHE_MS = 900;

async function compute({ tz, now, query }) {
  const filters = normalizeFilters(query);
  const win = resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days });
  const prevStart = midnight(tz, addDays(win.start, -win.n));
  const since = new Date(Math.min(prevStart.getTime(), startOfDay(tz, now, -29).getTime()));
  const [rows, allTime, recent] = await Promise.all([
    Lead.forAnalytics({ since, ...filters }),
    Lead.countMatching(filters),
    Lead.recent({ ...filters, limit: 8 })
  ]);
  const out = aggregate(rows, win, { tz, now, filters, allTime });
  return {
    generatedAt: now.toISOString(), tz,
    window: { days: win.n, from: win.from, to: win.to, custom: win.custom },
    filters: { status: filters.status || null, course: filters.course || null },
    courses: [...Object.entries(O.COURSES).map(([slug, name]) => ({ slug, name })), { slug: NO_COURSE, name: NO_COURSE_NAME }],
    statuses: STATUSES,
    ...out,
    recent: recent.map((r) => ({ id: r.id, created_at: r.created_at, full_name: r.full_name, status: r.status, course: courseName(r.course_slug || NO_COURSE, r.course) }))
  };
}

/** Same filters asked within ~1 s (several tabs, several admins) share one set of queries. */
function getAnalytics({ tz, query = {}, now }) {
  if (now) return compute({ tz, now, query });                       // tests pass a fixed clock: never cached
  const key = JSON.stringify([tz, query.status || '', query.course || '', query.from || '', query.to || '', query.days || '']);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = compute({ tz, now: new Date(), query });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (cache.get(key) && cache.get(key).promise === promise) cache.delete(key); });
  if (cache.size > 100) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return promise;
}

module.exports = { getAnalytics, aggregate, resolveWindow, normalizeFilters, dayIndex, PRESETS };
