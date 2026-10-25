// Insights for the analytics page: funnel, drop-off by field, devices, new vs returning, time to register, where people are (map data)
// and the IP / location quality section. Reads the leads and the tracking tables; sends no phone numbers, e-mails, raw IPs or visitor ids.
const db = require('./db');
const G = require('./geo');
const geoService = require('./geoService');
const campaigns = require('./campaigns');
const { resolveWindow, normalizeFilters } = require('./analytics');
const { startOfDay } = require('./time');
const LV = require('./leadview');
const fieldscope = require('./fieldscope');
const { browserLabel, parseUserAgent } = require('./ua');
const O = require('./options');

const MAX_ROWS = 20000, MAX_EVENTS = 100000;
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (code) => { try { return (code && regionNames && regionNames.of(String(code).toUpperCase())) || code || 'Unknown'; } catch { return code || 'Unknown'; } };
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const topN = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([name, count]) => ({ name, n: count }));
const det = (d) => { try { return typeof d === 'string' ? JSON.parse(d) : d || {}; } catch { return {}; } };
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const BUCKETS = [['Under 1 minute', 60], ['1 to 3 minutes', 180], ['3 to 10 minutes', 600], ['10 to 30 minutes', 1800], ['Over 30 minutes', Infinity]];

/** Filters = the same ones as the rest of the page (I am a, master class, campaign, channel, medium, Meta app). */
function cleanFilters(q) { return normalizeFilters(q || {}); }

/* An array, not an object: JavaScript lists integer-like object keys ("24", "2", "7" ...) first, which put the map's
   period buttons in a random-looking order. The order below is the one the page shows. */
const GEO_PERIODS = [
  ['today', 'Today'], ['24h', 'Last 24 hours'], ['yesterday', 'Yesterday'], ['2', 'Last 2 days'],
  ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'],
  ['all', 'All time'], ['page', 'Same as the page period']
];
const GEO_LABELS = new Map(GEO_PERIODS);
const GEO_DEFAULT = 'page';                 // the map opens on the page's own period, so it never disagrees with the numbers above it
/** The period of the map. Today / yesterday are calendar days in the configured time zone; 7 and 14 days end today. */
function geoWindow(key, tz, now, win) {
  const k = GEO_LABELS.has(key) ? key : GEO_DEFAULT;
  let start, end;
  if (k === 'today') { start = startOfDay(tz, now, 0); end = startOfDay(tz, now, 1); }
  else if (k === 'yesterday') { start = startOfDay(tz, now, -1); end = startOfDay(tz, now, 0); }
  else if (k === '24h') { start = new Date(now.getTime() - 86400000); end = new Date(now.getTime() + 1000); }
  else if (k === '2') { start = startOfDay(tz, now, -1); end = startOfDay(tz, now, 1); }
  else if (k === '30') { start = startOfDay(tz, now, -29); end = startOfDay(tz, now, 1); }
  else if (k === '90') { start = startOfDay(tz, now, -89); end = startOfDay(tz, now, 1); }
  else if (k === 'all') { start = new Date('2020-01-01T00:00:00Z'); end = new Date(now.getTime() + 86400000); }
  else if (k === '7') { start = startOfDay(tz, now, -6); end = startOfDay(tz, now, 1); }
  else if (k === '14') { start = startOfDay(tz, now, -13); end = startOfDay(tz, now, 1); }
  else { start = new Date(win.bounds[0]); end = new Date(win.bounds[win.n]); }
  return { key: k, label: GEO_LABELS.get(k), start, end };
}

const cache = new Map();                    // the page asks every few seconds; one computation serves every open tab for a few seconds
const CACHE_MS = 5000;
async function getInsights(args) {
  const q = args.query || {}, key = JSON.stringify([args.tz, q.days, q.from, q.to, q.course, q.campaign, q.channel, q.medium, q.status, q.platform, q.geo]), hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await compute(args);
  cache.set(key, { at: Date.now(), value }); if (cache.size > 50) cache.delete(cache.keys().next().value);
  return value;
}
const clearCache = () => cache.clear();

async function compute({ tz, query = {}, now = new Date() }) {
  const win = resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days }), f = cleanFilters(query), gw = geoWindow(query.geo, tz, now, win);
  const start = new Date(win.bounds[0]), end = new Date(win.bounds[win.n]);
  const lo = new Date(Math.min(start.getTime(), gw.start.getTime())), hi = new Date(Math.max(end.getTime(), gw.end.getTime()));      // one read covers the page period and the map period
  const inWin = (t, a, b) => { const x = new Date(t).getTime(); return x >= a.getTime() && x < b.getTime(); };

  const [leadRows, sesRows, evRows, visRows, campRows] = await Promise.all([
    db.query(`SELECT created_at, course_slug, utm_source, utm_medium, utm_campaign, referrer, user_agent, meta_platform, source_detected, source_method, status, device_type, os, browser, in_app, is_returning_lead, time_to_register_seconds, visit_count_before_signup, geo_status, geo_country_code, geo_region, geo_region_code, geo_city, geo_lat, geo_lon, browser_lat, browser_lon, browser_accuracy,
                     geo_org, geo_asn, phone_country_mismatch, ip, ip_version, form_version FROM leads WHERE created_at >= $1 AND created_at < $2 ORDER BY id DESC LIMIT ${MAX_ROWS}`, [lo, hi]),
    db.query('SELECT s.session_id, s.visitor_id, s.started_at, s.campaign_id, s.course_slug, s.source_detected, s.source_method, v.in_app, v.referrer_host FROM sessions s LEFT JOIN visitors v ON v.visitor_id = s.visitor_id WHERE s.started_at >= $1 AND s.started_at < $2 LIMIT 100000', [lo, hi]),
    db.query(`SELECT id, at, type, session_id, detail FROM visitor_events WHERE at >= $1 AND at < $2 ORDER BY id LIMIT ${MAX_EVENTS}`, [lo, hi]),
    db.query('SELECT v.visitor_id, v.visit_count, v.last_seen, v.device_type, v.os, v.browser, v.in_app, v.is_webview, v.geo_country_code, v.geo_region, v.geo_city, v.geo_lat, v.geo_lon, (v.visitor_id IN (SELECT visitor_id FROM leads WHERE visitor_id IS NOT NULL)) AS registered FROM visitors v WHERE v.last_seen >= $1 AND v.last_seen < $2 LIMIT 100000', [lo, hi]),
    campaigns.list()
  ]);
  const campById = new Map(campRows.map((c) => [Number(c.id), c]));
  const sessionOk = (s) => LV.passes(LV.sessionRow(s, campById), f, { visitor: true });       // a visit has no "I am a" yet, so that filter is not applied to visits
  const leadsAll = leadRows.rows.filter((r) => LV.passes(r, f));
  const leads = leadsAll.filter((r) => inWin(r.created_at, start, end));

  /* ---- funnel (sessions): visited -> started -> tried to submit -> registered ---- */
  const okSession = new Map(sesRows.rows.filter((s) => inWin(s.started_at, start, end) && sessionOk(s)).map((s) => [s.session_id, s]));
  const evWin = evRows.rows.filter((e) => inWin(e.at, start, end));
  const ofType = (t) => new Set(evWin.filter((e) => e.type === t && okSession.has(e.session_id)).map((e) => e.session_id));
  const started = ofType('form_start'), tried = ofType('submit_attempt'), done = ofType('submit_success');
  const funnel = [{ key: 'visited', label: 'Opened the form', n: okSession.size }, { key: 'started', label: 'Started filling it', n: started.size }, { key: 'tried', label: 'Pressed Register', n: tried.size },
    { key: 'registered', label: 'Registered', n: Math.max(done.size, 0) }];
  for (let i = 1; i < funnel.length; i++) funnel[i].pctOfPrev = funnel[i - 1].n ? Math.round((funnel[i].n / funnel[i - 1].n) * 1000) / 10 : null;
  funnel.forEach((s) => { s.pctOfFirst = funnel[0].n ? Math.round((s.n / funnel[0].n) * 1000) / 10 : null; });

  /* ---- where people stop: last field focused by sessions that started but did not register; fields that fail checks ---- */
  const lastField = new Map(), errs = new Map(), lastBy = new Map();
  for (const e of evWin) {
    if (!okSession.has(e.session_id)) continue;
    const d = det(e.detail);
    if (e.type === 'field_focus' && d.field) lastBy.set(e.session_id, d.field);
    if (e.type === 'submit_invalid' && Array.isArray(d.fields)) for (const fl of d.fields) bump(errs, fl);
  }
  for (const [sid, fl] of lastBy) if (started.has(sid) && !done.has(sid)) bump(lastField, fl);
  let removedKeys = new Set(); try { removedKeys = new Set((await fieldscope.describe(f)).removed); } catch { /* keep everything */ }      // a question taken off the form no longer shows where people stop
  for (const k of removedKeys) { lastField.delete(k); errs.delete(k); }

  /* ---- people ---- */
  const okVisitorWin = new Set([...okSession.values()].map((s) => s.visitor_id));
  const filtered = Object.keys(f).some((k) => k !== 'status');
  const vis = visRows.rows.filter((v) => inWin(v.last_seen, start, end) && (!filtered || okVisitorWin.has(v.visitor_id)));
  const returning = leads.filter((l) => l.is_returning_lead).length, retVis = vis.filter((v) => v.visit_count > 1).length;
  const tally = (rows, label) => { const m = new Map(); rows.forEach((r) => bump(m, label(r))); return topN(m, 12); };
  const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
  /* the browser a lead used: the stored columns, else read from the saved user agent (older leads) */
  const browserOf = (l) => { const ua = l.user_agent && (!l.browser || l.in_app == null) ? parseUserAgent(l.user_agent) : null; const inApp = l.in_app || (ua && ua.in_app) || null; return { browser: l.browser || (ua && ua.browser) || null, in_app: inApp, is_webview: ua && ua.is_webview }; };
  const leadBrowsers = leads.map(browserOf);
  const devices = {
    type: tally(leads, (l) => (l.device_type ? cap(l.device_type) : 'Unknown')).slice(0, 8), os: tally(leads, (l) => l.os || 'Unknown').slice(0, 8),
    browser: tally(leadBrowsers, browserLabel), inApp: tally(leadBrowsers.filter((b) => b.in_app), (b) => b.in_app).slice(0, 8),
    visitorsType: tally(vis, (v) => (v.device_type ? cap(v.device_type) : 'Unknown')).slice(0, 8),
    visitorsBrowser: tally(vis, (v) => browserLabel(v)), visitorsInApp: tally(vis.filter((v) => v.in_app), (v) => v.in_app).slice(0, 8)
  };
  const ttr = leads.map((l) => l.time_to_register_seconds).filter((x) => Number.isFinite(x) && x >= 0);
  const buckets = BUCKETS.map(([label, max], i) => ({ label, n: ttr.filter((x) => x < max && x >= (i ? BUCKETS[i - 1][1] : 0)).length }));
  const visits = leads.map((l) => l.visit_count_before_signup).filter((x) => Number.isFinite(x));

  /* ---- map data: registered people and visitors who did NOT register, kept apart (coordinates are already rounded to 2 decimals).
          Own period (today / yesterday / 24 h / 7 / 14 days / same as page), but the same filters as the whole page. ---- */
  const aggregate = (items) => {
    const countries = new Map(), regions = new Map(), cities = new Map(), regionCodes = new Map(); let located = 0;
    for (const it of items) {
      if (!it.code) continue;
      located++; bump(countries, it.code);
      if (it.region) { bump(regions, it.code + '|' + it.region); if (it.rc && !regionCodes.has(it.code + '|' + it.region)) regionCodes.set(it.code + '|' + it.region, String(it.rc).toUpperCase()); }
      if (it.city && it.lat != null && it.lon != null) bump(cities, [it.city, it.region || '', it.code, it.lat, it.lon].join('|'));
    }
    return {
      countries: [...countries].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: countryName(code), n })),
      regions: [...regions].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([k, n]) => { const [code, name] = k.split('|'); const o = { code, country: countryName(code), name, n }; if (regionCodes.has(k)) o.rc = regionCodes.get(k); return o; }),   // enough for every state of India plus the other countries
      cities: [...cities].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([k, n]) => { const [name, region, code, lat, lon] = k.split('|'); return { name, region, code, country: countryName(code), lat: Number(lat), lon: Number(lon), n }; }),
      located
    };
  };
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const geoLeads = leadsAll.filter((l) => inWin(l.created_at, gw.start, gw.end));
  let exactLocated = 0;
  const regItems = geoLeads.map((l) => {
    /* the coordinates on the map use the exact browser location when the person allowed it, else the IP lookup's city location */
    const exact = l.browser_lat != null && l.browser_lon != null;
    if (exact) exactLocated++;
    return { code: l.geo_country_code, region: l.geo_region, rc: l.geo_region_code, city: l.geo_city, lat: exact ? num(l.browser_lat) : num(l.geo_lat), lon: exact ? num(l.browser_lon) : num(l.geo_lon) };
  });
  const geoVisitorOk = new Set(sesRows.rows.filter((s) => inWin(s.started_at, gw.start, gw.end) && sessionOk(s)).map((s) => s.visitor_id));
  const geoFiltered = Object.keys(f).some((k) => k !== 'status');
  const unregRows = f.status ? [] : visRows.rows.filter((v) => !v.registered && inWin(v.last_seen, gw.start, gw.end) && (!geoFiltered || geoVisitorOk.has(v.visitor_id)));
  const unregItems = unregRows.map((v) => ({ code: v.geo_country_code, region: v.geo_region, city: v.geo_city, lat: num(v.geo_lat), lon: num(v.geo_lon) }));
  const regAgg = aggregate(regItems), unregAgg = aggregate(unregItems);
  const geo = {
    period: { key: gw.key, label: gw.label, from: gw.start.toISOString(), to: gw.end.toISOString(), options: GEO_PERIODS.map(([key, label]) => ({ key, label })) },
    countries: regAgg.countries, regions: regAgg.regions, cities: regAgg.cities,
    located: regAgg.located, exactLocated, unknown: geoLeads.length - regAgg.located, total: geoLeads.length,
    unregisteredAvailable: !f.status,
    unregistered: { countries: unregAgg.countries, regions: unregAgg.regions, cities: unregAgg.cities, located: unregAgg.located, unknown: unregRows.length - unregAgg.located, total: unregRows.length }
  };

  /* ---- IP / location quality ---- */
  const status = new Map(), orgs = new Map(), hostingOrgs = new Set();
  let hosting = 0, mismatch = 0, v6 = 0;
  for (const l of leads) {
    bump(status, l.geo_status || 'not looked up');
    if (l.geo_org) { bump(orgs, l.geo_org); if (G.isLikelyHosting(l.geo_org)) { hosting++; hostingOrgs.add(l.geo_org); } }
    if (l.phone_country_mismatch === true) mismatch++;
    if (l.ip_version === 6) v6++;
  }
  let health = null; try { health = await geoService.get().health(); } catch { health = null; }
  const ip = {
    enabled: Boolean(health && health.enabled), health, status: topN(status, 10), orgs: topN(orgs, 10).map((o) => ({ ...o, hosting: hostingOrgs.has(o.name) })), hosting, mismatch, v6,
    mismatchPct: leads.length ? Math.round((mismatch / leads.length) * 1000) / 10 : null,
    recent: leads.slice(0, 30).map((l) => ({ at: l.created_at, ip: l.ip ? G.maskIp(l.ip) : null, version: l.ip_version, city: l.geo_city, region: l.geo_region, country: l.geo_country_code ? countryName(l.geo_country_code) : null, org: l.geo_org,
      status: l.geo_status, exact: l.browser_lat != null && l.browser_lon != null, accuracy: l.browser_accuracy == null ? null : Number(l.browser_accuracy),
      hosting: G.isLikelyHosting(l.geo_org), mismatch: l.phone_country_mismatch === true, course: O.COURSES[l.course_slug] || null, returning: Boolean(l.is_returning_lead) }))
  };

  return {
    window: { from: win.from, to: win.to, n: win.n }, filters: f,
    funnel, trackedSince: null, dropoff: { lastField: topN(lastField, 8), errors: topN(errs, 8) },
    people: { registrations: leads.length, returning, newPeople: leads.length - returning, visitors: vis.length, returningVisitors: retVis },
    devices, timeToRegister: { medianSeconds: median(ttr), n: ttr.length, buckets, avgVisitsBeforeSignup: visits.length ? Math.round((visits.reduce((a, b) => a + b, 0) / visits.length) * 10) / 10 : null },
    geo, ip
  };
}

module.exports = { getInsights, cleanFilters, clearCache, geoWindow };
