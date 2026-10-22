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
const Visit = require('./models/Visit');
const { STATUSES } = O;
const { parseYMD, zonedMidnight, startOfDay, dayParts, hourOf } = require('./time');
const { COUNTRIES } = require('./countries');
const Meta = require('./meta');

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

const NONE = NO_COURSE;                     // "__none": the lead carries no value for that tag (no campaign / no medium)
const NO_CAMPAIGN_NAME = '(no campaign)';
const NO_MEDIUM_NAME = '(none)';
const FACETS = ['course', 'campaign', 'channel', 'medium'];           // filters that also report per-option counts
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/**
 * Only known statuses, well-formed course slugs and short plain-text tag values get through; anything else is ignored.
 * campaign = exact utm_campaign (or "__none"), medium = lower-cased utm_medium (or "__none"), channel = the channel name
 * shown on the page (Meta, Google, Direct / no tag ...), platform = the Meta app (Facebook, Instagram, Messenger, Audience Network,
 * Meta (unknown)) or "__none" for traffic that is not Meta. They are only ever compared for equality or sent
 * as bound SQL parameters, never concatenated into a query.
 */
function normalizeFilters(q = {}) {
  const f = {};
  if (STATUSES.includes(q.status)) f.status = q.status;
  if (q.course === NO_COURSE) f.course = NO_COURSE;
  else if (/^[a-z0-9-]{1,80}$/.test(String(q.course || ''))) f.course = String(q.course);
  const campaign = cleanText(q.campaign, 120); if (campaign) f.campaign = campaign;
  const medium = cleanText(q.medium, 120).toLowerCase(); if (medium) f.medium = medium;
  const channel = cleanText(q.channel, 60); if (channel) f.channel = channel;
  if (q.platform === NO_COURSE || PLATFORM_FILTERS.includes(q.platform)) f.platform = q.platform;
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
const SOCIAL = [[/instagram|^ig$|facebook|^fb$|^meta$|messenger|^msg$|^an$|audience[ _-]?network/i, 'Meta'], [/google|gclid|adwords/i, 'Google'], [/youtube|youtu\.be/i, 'YouTube'],
  [/whatsapp|wa\.me|^wa$/i, 'WhatsApp'], [/linkedin|lnkd/i, 'LinkedIn'], [/^t\.co$|twitter|^x$|x\.com/i, 'X / Twitter'], [/telegram|^t\.me$/i, 'Telegram'], [/bing/i, 'Bing']];
const niceChannel = (raw) => { const t = String(raw).trim(); for (const [re, n] of SOCIAL) if (re.test(t)) return n; return t.length > 28 ? t.slice(0, 27) + '…' : t.charAt(0).toUpperCase() + t.slice(1); };
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Where the lead came from: the UTM source when the ad link is tagged, else the referring site, else Direct. */
function channelOf(r) {
  if (r.utm_source && String(r.utm_source).trim()) return niceChannel(r.utm_source);
  // auto-detect (migration 016): the click id / referrer / in-app browser the visit carried, when the link had no utm_source
  if (r.source_detected && String(r.source_detected).trim()) return niceChannel(r.source_detected);
  if (r.meta_platform) return 'Meta';                         // untagged link, but Meta's fbclid / in-app browser / referrer says it came from a Meta ad
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

/** Per-lead tag keys used for filtering and grouping (the same rules everywhere on the page). */
const NO_PLATFORM = NO_COURSE;                                 // "__none": not Meta traffic
const PLATFORM_FILTERS = [...Meta.PLATFORMS];
/** Facebook / Instagram / ... for Meta traffic, NO_PLATFORM for everything else. Stored value first; older rows are read from what they kept (utm_source, referrer, in-app browser). */
function platformOf(r) {
  if (r.meta_platform) return r.meta_platform;
  if (channelOf(r) !== 'Meta') return NO_PLATFORM;
  const m = Meta.detectMeta({ utm_source: r.utm_source, referrer: r.referrer, referrerHost: r.referrer_host, userAgent: r.user_agent });
  return m.platform || Meta.UNKNOWN;
}
/** The Meta app of one stored group of link opens (same rules as for a lead; a visit keeps only the referring host). */
const visitRow = (g) => ({ utm_source: g.utm_source, utm_medium: g.utm_medium, utm_campaign: g.utm_campaign, referrer: g.referrer_host ? 'https://' + g.referrer_host + '/' : null, meta_platform: g.meta_platform, source_detected: g.source_detected });
const visitPlatform = (g) => platformOf(visitRow(g));
const campaignOf = (r) => (r.utm_campaign && String(r.utm_campaign).trim()) || NONE;
const mediumOf = (r) => (r.utm_medium && String(r.utm_medium).trim().toLowerCase()) || NONE;
const campaignName = (k) => (k === NONE ? NO_CAMPAIGN_NAME : k);
const mediumName = (k) => (k === NONE ? NO_MEDIUM_NAME : k);

/** The "Meta ads: Facebook vs Instagram" panel: per app and per placement, registrations + link opens (opens only when "I am a" is not chosen). */
function metaPanel(byApp, byPlacement, opensAvailable) {
  const conv = (n, opens) => (opens && n <= opens ? Math.round((n / opens) * 1000) / 10 : null);   // null when there are more registrations than opens: a percentage would be false
  const total = [...byApp.values()].reduce((x, y) => x + y.n, 0);
  const totalOpens = [...byApp.values()].reduce((x, y) => x + y.opens, 0);
  const always = new Set([Meta.FACEBOOK, Meta.INSTAGRAM]);
  const platforms = Meta.PLATFORMS.filter((p) => always.has(p) || (byApp.get(p) && (byApp.get(p).n || byApp.get(p).opens))).map((name) => {
    const o = byApp.get(name) || { n: 0, students: 0, professionals: 0, opens: 0 };
    return { name, n: o.n, share: total ? Math.round((o.n / total) * 1000) / 10 : 0, students: o.students, professionals: o.professionals,
      opens: opensAvailable ? o.opens : null, conversionPct: opensAvailable ? conv(o.n, o.opens) : null };
  });
  const placements = [...byPlacement].map(([name, o]) => ({ name, app: o.app, n: o.n, opens: opensAvailable ? o.opens : null }))
    .sort((a, b) => b.n - a.n || (b.opens || 0) - (a.opens || 0) || a.name.localeCompare(b.name)).slice(0, 8);
  const known = platforms.filter((p) => p.name !== Meta.UNKNOWN).reduce((x, p) => x + p.n, 0);
  return { total, opens: opensAvailable ? totalOpens : null, known, knownPct: total ? Math.round((known / total) * 1000) / 10 : null, platforms, placements };
}

/**
 * Pure aggregation. `rows` are leads (any age, any course / campaign ...): every filter in `filters` is applied here, so
 * the chips can show how many leads each option would give with the *other* filters in place (faceted counts).
 * Returns the numbers for the selected window, plus today / 7 / 30 day counts and the previous period for the % change.
 */
function aggregate(rows, win, { tz, now = new Date(), filters = {}, allTime = null, visits = [], firstVisitAt = null } = {}) {
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
  const campRows = new Map();                  // campaign key -> per-campaign performance row
  const facet = { course: new Map(), campaign: new Map(), channel: new Map(), medium: new Map() };   // option -> leads, other filters applied
  const tree = new Map();                      // course -> { n, camps: Map(campaign -> { n, students, professionals }) }   (ignores the course + campaign filters)
  const metaP = new Map(), metaPl = new Map(); // Meta panel: app -> { n, students, professionals, opens }, placement -> { n, opens, app }   (ignores the platform filter, so you can hop between apps)
  const metaRow = (map, key, extra) => { let o = map.get(key); if (!o) { o = { n: 0, students: 0, professionals: 0, opens: 0, ...extra }; map.set(key, o); } return o; };
  const labelOf = { course: new Map(), campaign: new Map(), channel: new Map(), medium: new Map() };
  let withEmail = 0;
  let today = 0, last7 = 0, last30 = 0, previous = 0, inWindow = 0, lastLeadMs = 0;

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const slug = r.course_slug || NO_COURSE;
    const ch = channelOf(r), campKey = campaignOf(r), medKey = mediumOf(r);
    const plat = platformOf(r);
    const dim = { status: r.status, course: slug, campaign: campKey, channel: ch, medium: medKey, platform: plat };
    const i = dayIndex(bMs, t);

    // which filters does this lead fail?  none -> it is counted everywhere;  exactly one -> it only feeds that filter's option counts
    let fails = 0, failKey = null, treeOk = true;
    for (const k of ['status', 'course', 'campaign', 'channel', 'medium', 'platform']) {
      if (filters[k] && dim[k] !== filters[k]) { fails++; failKey = k; if (k !== 'course' && k !== 'campaign') treeOk = false; }
    }
    if (i >= 0) {
      for (const k of FACETS) if (fails === 0 || (fails === 1 && failKey === k)) {
        bump(facet[k], dim[k]);
        if (!labelOf[k].has(dim[k])) labelOf[k].set(dim[k], k === 'course' ? courseName(slug, r.course) : k === 'campaign' ? campaignName(campKey) : k === 'medium' ? mediumName(medKey) : ch);
      }
      if (treeOk) {
        let tn = tree.get(slug); if (!tn) { tn = { n: 0, camps: new Map(), name: courseName(slug, r.course) }; tree.set(slug, tn); }
        tn.n++;
        let tc = tn.camps.get(campKey); if (!tc) { tc = { n: 0, students: 0, professionals: 0 }; tn.camps.set(campKey, tc); }
        tc.n++; if (r.status === 'Student / Fresher') tc.students++; else if (r.status === 'Working Professional') tc.professionals++;
      }
    }
    if (i >= 0 && plat !== NO_PLATFORM && (fails === 0 || (fails === 1 && failKey === 'platform'))) {
      const mp = metaRow(metaP, plat); mp.n++; if (r.status === 'Student / Fresher') mp.students++; else if (r.status === 'Working Professional') mp.professionals++;
      if (r.meta_placement) metaRow(metaPl, r.meta_placement, { app: plat }).n++;
    }
    if (fails) continue;

    if (t > lastLeadMs) lastLeadMs = t;
    if (t >= t0) today++;
    if (t >= t7) last7++;
    if (t >= t30) last30++;
    if (t >= prevStartMs && t < bMs[0]) { previous++; const pi = dayIndex(prevBounds, t); if (pi >= 0) previousOverall[pi]++; }
    if (i < 0) continue;

    inWindow++; overall[i]++;
    let c = byCourse.get(slug);
    if (!c) { c = { name: courseName(slug, r.course), data: new Array(n).fill(0), total: 0 }; byCourse.set(slug, c); }
    c.data[i]++; c.total++;
    const st = byStatus.get(r.status);
    if (st) { st.data[i]++; st.total++; }
    const mx = matrix.get(slug) || {}; mx[r.status] = (mx[r.status] || 0) + 1; matrix.set(slug, mx);
    const hr = hourOf(tz, new Date(t));
    hours[hr]++; heat[dow[i]][hr]++;
    const camp = campaignName(campKey), med = mediumName(medKey);
    let cs = channels.get(ch); if (!cs) { cs = { total: 0, data: new Array(n).fill(0) }; channels.set(ch, cs); } cs.total++; cs.data[i]++;
    bump(campaigns, camp); bump(mediums, med); bump(devices, deviceOf(r.user_agent)); bump(countries, countryOf(r.country_code));
    if (r.email) withEmail++;
    if (r.status === 'Student / Fresher' && r.college_name) bump(colleges, String(r.college_name).trim());
    const ak = ch + '\u0001' + med + '\u0001' + camp; let ar = adRows.get(ak);
    if (!ar) { ar = { channel: ch, medium: med, campaign: camp, n: 0, students: 0, professionals: 0, courses: new Map(), lastMs: 0 }; adRows.set(ak, ar); }
    ar.n++; if (r.status === 'Student / Fresher') ar.students++; else if (r.status === 'Working Professional') ar.professionals++;
    bump(ar.courses, courseName(slug, r.course)); if (t > ar.lastMs) ar.lastMs = t;
    let cr = campRows.get(campKey);
    if (!cr) { cr = { key: campKey, name: camp, n: 0, students: 0, professionals: 0, data: new Array(n).fill(0), channels: new Map(), courses: new Map(), lastMs: 0 }; campRows.set(campKey, cr); }
    cr.n++; cr.data[i]++; if (r.status === 'Student / Fresher') cr.students++; else if (r.status === 'Working Professional') cr.professionals++;
    bump(cr.channels, ch); bump(cr.courses, courseName(slug, r.course)); if (t > cr.lastMs) cr.lastMs = t;
    bump(sources, r.utm_source || 'Direct / no UTM tag');
    if (r.status === 'Student / Fresher') { if (r.student_course) bump(stuCourses, r.student_course); if (r.student_status) bump(stuStatus, r.student_status); if (r.specialization) bump(stuSpec, r.specialization); }
    else if (r.status === 'Working Professional') { if (r.job_role) bump(roles, r.job_role); if (r.experience_level) bump(exp, r.experience_level.replace('-', '–')); if (r.highest_qualification) bump(quals, r.highest_qualification); }
  }

  /* link opens (visits to the registration page): same filters as the leads, except "I am a" (a visitor has not told us yet) */
  const vAvailable = !filters.status;
  const vData = new Array(n).fill(0), vcamp = new Map();
  let vWindow = 0, vToday = 0;
  if (vAvailable) for (const g of visits) {
    const t = Number(g.bucket), cnt = Number(g.n) || 0;
    if (!Number.isFinite(t) || !cnt) continue;
    const vr = visitRow(g);
    const slug = g.course_slug || NO_COURSE, campKey = campaignOf(vr), ch = channelOf(vr), medKey = mediumOf(vr), vplat = platformOf(vr);
    if ((filters.course && slug !== filters.course) || (filters.campaign && campKey !== filters.campaign) || (filters.channel && ch !== filters.channel) || (filters.medium && medKey !== filters.medium)) continue;
    if (vplat !== NO_PLATFORM && dayIndex(bMs, t) >= 0) { metaRow(metaP, vplat).opens += cnt; if (g.meta_placement) metaRow(metaPl, g.meta_placement, { app: vplat }).opens += cnt; }
    if (filters.platform && vplat !== filters.platform) continue;
    if (t >= t0) vToday += cnt;
    const i = dayIndex(bMs, t);
    if (i < 0) continue;
    vWindow += cnt; vData[i] += cnt;
    let vc = vcamp.get(campKey); if (!vc) { vc = { n: 0, channels: new Map(), courses: new Map() }; vcamp.set(campKey, vc); }
    vc.n += cnt; bump(vc.channels, ch, cnt); bump(vc.courses, courseName(slug, null), cnt);
  }
  // a campaign people opened but nobody registered through still gets a row (that is exactly what you want to spot)
  for (const [campKey, vc] of vcamp) if (!campRows.has(campKey)) campRows.set(campKey, { key: campKey, name: campaignName(campKey), n: 0, students: 0, professionals: 0, data: new Array(n).fill(0), channels: vc.channels, courses: vc.courses, lastMs: 0 });

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

  /* options for the filter chips: counts with the other filters applied; the selected option is always listed, even at zero */
  const options = (k, limit, nameOf) => {
    const rowsK = [...facet[k]].map(([key, v]) => ({ key, name: labelOf[k].get(key) || nameOf(key), n: v }));
    if (filters[k] && !facet[k].has(filters[k])) rowsK.push({ key: filters[k], name: nameOf(filters[k]), n: 0 });
    rowsK.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return { total: rowsK.reduce((x, y) => x + y.n, 0), count: rowsK.length, items: rowsK.slice(0, limit) };
  };
  const facets = {
    course: options('course', 60, (key) => courseName(key)),
    campaign: options('campaign', 60, campaignName),
    channel: options('channel', 30, (key) => key),
    medium: options('medium', 30, mediumName)
  };
  const facetTotal = facets.course.total;

  const opensOf = (k) => (vcamp.get(k) ? vcamp.get(k).n : 0);
  // null when there are more registrations than opens: the counter did not see them all (they came before it started, or the visitor's browser blocked it), so a percentage would be false
  const conv = (leads, opens) => (opens && leads <= opens ? Math.round((leads / opens) * 1000) / 10 : null);
  const campList = [...campRows.values()].sort((a, b) => b.n - a.n || opensOf(b.key) - opensOf(a.key) || a.name.localeCompare(b.name));
  const treeOut = [...tree].sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name)).map(([slug, v]) => {
    const camps = [...v.camps].sort((a, b) => b[1].n - a[1].n || campaignName(a[0]).localeCompare(campaignName(b[0])));
    return {
      course_slug: slug === NO_COURSE ? null : slug, key: slug, course: v.name, n: v.n,
      campaigns: camps.slice(0, 12).map(([key, c]) => ({ key, name: campaignName(key), n: c.n, students: c.students, professionals: c.professionals })),
      moreCampaigns: Math.max(0, camps.length - 12)
    };
  });

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
    /* campaign level: one row + one daily line per campaign, and the master class -> campaign tree */
    campaignTable: campList.slice(0, 25).map((c) => ({
      key: c.key, campaign: c.name, n: c.n, share: share(c.n), students: c.students, professionals: c.professionals, data: c.data,
      opens: vAvailable ? opensOf(c.key) : null, conversionPct: vAvailable ? conv(c.n, opensOf(c.key)) : null,
      topChannel: (top(c.channels, 1)[0] || { name: '–' }).name, topCourse: (top(c.courses, 1)[0] || { name: '–' }).name, lastLeadAt: c.lastMs ? new Date(c.lastMs).toISOString() : null
    })),
    campaignSeries: campList.slice(0, 6).map((c) => ({ key: c.key, name: c.name, total: c.n, data: c.data })),
    tree: treeOut,
    facets: {
      course: { ...facets.course, items: facets.course.items.map((o) => ({ ...o, slug: o.key === NO_COURSE ? NO_COURSE : o.key })) },
      campaign: facets.campaign, channel: facets.channel, medium: facets.medium, total: facetTotal
    },
    /* link opens: people who opened the registration link (a page load in a browser, one per visitor per day per link) */
    meta: metaPanel(metaP, metaPl, vAvailable),
    visits: { available: vAvailable, window: vWindow, today: vToday, data: vData, conversionPct: vAvailable ? conv(inWindow, vWindow) : null, since: firstVisitAt },
    heatmap: heat,
    quality: { withEmail, emailPct: inWindow ? Math.round((withEmail / inWindow) * 1000) / 10 : 0 },
    colleges: top(colleges, 6)
  };
}

/* ---------- database + cache ---------- */
const cache = new Map();
const CACHE_MS = 900;

async function allTimeCount(filters) {
  const { channel, platform, ...sql } = filters;
  if (platform) return null;                                         // the Meta app of older leads is read from several columns: no cheap all-time number, shown as –
  if (!channel) return Lead.countMatching(sql);
  const groups = await Lead.sourceGroups(sql);                       // the channel is derived from utm_source / referrer
  return groups.reduce((sum, g) => sum + (channelOf(g) === channel ? g.n : 0), 0);
}
async function recentLeads(filters, limit) {
  const { channel, platform, ...sql } = filters;
  if (!channel && !platform) return Lead.recent({ ...sql, limit });
  const rows = await Lead.recent({ ...sql, limit: 400 });            // newest 400 that match the other filters, then keep this channel / Meta app
  return rows.filter((r) => (!channel || channelOf(r) === channel) && (!platform || platformOf(r) === platform)).slice(0, limit);
}

async function compute({ tz, now, query }) {
  const filters = normalizeFilters(query);
  const win = resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days });
  const prevStart = midnight(tz, addDays(win.start, -win.n));
  const since = new Date(Math.min(prevStart.getTime(), startOfDay(tz, now, -29).getTime()));
  const [rows, allTime, recent, visits, firstVisitAt] = await Promise.all([
    Lead.forAnalytics({ since }),                                    // every filter is applied in aggregate() so the chips can show their counts
    allTimeCount(filters),
    recentLeads(filters, 8),
    Visit.groups({ since: new Date(Math.min(win.bounds[0].getTime(), startOfDay(tz, now, 0).getTime())) }),
    Visit.firstAt()
  ]);
  const out = aggregate(rows, win, { tz, now, filters, allTime, visits, firstVisitAt });
  // chips: the configured master classes (even at zero) + any other course that has leads in the window, each with its count
  const cnt = new Map(out.facets.course.items.map((o) => [o.key, o.n]));
  const courses = [...Object.entries(O.COURSES).map(([slug, name]) => ({ slug, name, n: cnt.get(slug) || 0 }))];
  for (const o of out.facets.course.items) if (o.key !== NO_COURSE && !courses.some((c) => c.slug === o.key)) courses.push({ slug: o.key, name: o.name, n: o.n });
  courses.push({ slug: NO_COURSE, name: NO_COURSE_NAME, n: cnt.get(NO_COURSE) || 0 });
  return {
    generatedAt: now.toISOString(), tz,
    window: { days: win.n, from: win.from, to: win.to, custom: win.custom },
    filters: { status: filters.status || null, course: filters.course || null, campaign: filters.campaign || null, channel: filters.channel || null, medium: filters.medium || null, platform: filters.platform || null },
    courses,
    statuses: STATUSES,
    ...out,
    recent: recent.map((r) => ({ id: r.id, created_at: r.created_at, full_name: r.full_name, status: r.status, course: courseName(r.course_slug || NO_COURSE, r.course) }))
  };
}

/** Same filters asked within ~1 s (several tabs, several admins) share one set of queries. */
function getAnalytics({ tz, query = {}, now }) {
  if (now) return compute({ tz, now, query });                       // tests pass a fixed clock: never cached
  const key = JSON.stringify([tz, query.status || '', query.course || '', query.campaign || '', query.channel || '', query.medium || '', query.platform || '', query.from || '', query.to || '', query.days || '']);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = compute({ tz, now: new Date(), query });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (cache.get(key) && cache.get(key).promise === promise) cache.delete(key); });
  if (cache.size > 100) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return promise;
}

module.exports = { getAnalytics, aggregate, resolveWindow, normalizeFilters, dayIndex, niceChannel, channelOf, platformOf, visitPlatform, NO_PLATFORM, PRESETS };
