// Insights for the analytics page: funnel, drop-off by field, devices, new vs returning, time to register, where people are (map data)
// and the IP / location quality section. Reads the leads and the tracking tables; sends no phone numbers, e-mails, raw IPs or visitor ids.
const db = require('./db');
const G = require('./geo');
const geoService = require('./geoService');
const campaigns = require('./campaigns');
const { resolveWindow } = require('./analytics');
const O = require('./options');

const MAX_ROWS = 20000, MAX_EVENTS = 100000;
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (code) => { try { return (code && regionNames && regionNames.of(String(code).toUpperCase())) || code || 'Unknown'; } catch { return code || 'Unknown'; } };
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const topN = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([name, count]) => ({ name, n: count }));
const det = (d) => { try { return typeof d === 'string' ? JSON.parse(d) : d || {}; } catch { return {}; } };
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const BUCKETS = [['Under 1 minute', 60], ['1 to 3 minutes', 180], ['3 to 10 minutes', 600], ['10 to 30 minutes', 1800], ['Over 30 minutes', Infinity]];

function cleanFilters(q) {
  const course = typeof q.course === 'string' && (q.course === '__none' || /^[a-z0-9]{1,80}$/.test(q.course)) ? q.course : '';
  const campaign = typeof q.campaign === 'string' ? q.campaign.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';
  return { course, campaign };
}

const cache = new Map();                    // the page asks every few seconds; one computation serves every open tab for 20 seconds
const CACHE_MS = 20000;
async function getInsights(args) {
  const q = args.query || {}, key = JSON.stringify([args.tz, q.days, q.from, q.to, q.course, q.campaign]), hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await compute(args);
  cache.set(key, { at: Date.now(), value }); if (cache.size > 50) cache.delete(cache.keys().next().value);
  return value;
}
const clearCache = () => cache.clear();

async function compute({ tz, query = {} }) {
  const win = resolveWindow({ tz, from: query.from, to: query.to, days: query.days });
  const start = new Date(win.bounds[0]), end = new Date(win.bounds[win.n]), f = cleanFilters(query);
  const want = (slug, tag) => (!f.course || (f.course === '__none' ? !slug : slug === f.course)) && (!f.campaign || (f.campaign === '__none' ? !tag : tag === f.campaign));

  const [leadRows, sesRows, evRows, visRows, campRows] = await Promise.all([
    db.query(`SELECT created_at, course_slug, utm_campaign, status, device_type, os, browser, in_app, is_returning_lead, time_to_register_seconds, visit_count_before_signup, geo_status, geo_country_code, geo_region, geo_city, geo_lat, geo_lon, browser_lat, browser_lon, browser_accuracy,
                     geo_org, geo_asn, phone_country_mismatch, ip, ip_version, form_version, source_detected FROM leads WHERE created_at >= $1 AND created_at < $2 ORDER BY id DESC LIMIT ${MAX_ROWS}`, [start, end]),
    db.query('SELECT session_id, visitor_id, campaign_id, course_slug FROM sessions WHERE started_at >= $1 AND started_at < $2 LIMIT 100000', [start, end]),
    db.query(`SELECT id, type, session_id, detail FROM visitor_events WHERE at >= $1 AND at < $2 ORDER BY id LIMIT ${MAX_EVENTS}`, [start, end]),
    db.query('SELECT v.visitor_id, v.visit_count, v.device_type, v.os, v.browser, v.in_app, v.geo_country_code, v.geo_region, v.geo_city, v.geo_lat, v.geo_lon, (v.visitor_id IN (SELECT visitor_id FROM leads WHERE visitor_id IS NOT NULL)) AS registered FROM visitors v WHERE v.last_seen >= $1 AND v.last_seen < $2 LIMIT 100000', [start, end]),
    campaigns.list()
  ]);
  const campTag = new Map(campRows.map((c) => [c.id, c.utm_campaign]));
  const leads = leadRows.rows.filter((r) => want(r.course_slug, r.utm_campaign));

  /* ---- funnel (sessions): visited -> started -> tried to submit -> registered ---- */
  const okSession = new Map(sesRows.rows.filter((s) => want(s.course_slug, s.campaign_id ? campTag.get(Number(s.campaign_id)) : null)).map((s) => [s.session_id, s]));
  const ofType = (t) => new Set(evRows.rows.filter((e) => e.type === t && okSession.has(e.session_id)).map((e) => e.session_id));
  const started = ofType('form_start'), tried = ofType('submit_attempt'), done = ofType('submit_success');
  const funnel = [{ key: 'visited', label: 'Opened the form', n: okSession.size }, { key: 'started', label: 'Started filling it', n: started.size }, { key: 'tried', label: 'Pressed Register', n: tried.size },
    { key: 'registered', label: 'Registered', n: Math.max(done.size, 0) }];
  for (let i = 1; i < funnel.length; i++) funnel[i].pctOfPrev = funnel[i - 1].n ? Math.round((funnel[i].n / funnel[i - 1].n) * 1000) / 10 : null;
  funnel.forEach((s) => { s.pctOfFirst = funnel[0].n ? Math.round((s.n / funnel[0].n) * 1000) / 10 : null; });

  /* ---- where people stop: last field focused by sessions that started but did not register; fields that fail checks ---- */
  const lastField = new Map(), errs = new Map(), lastBy = new Map();
  for (const e of evRows.rows) {
    if (!okSession.has(e.session_id)) continue;
    const d = det(e.detail);
    if (e.type === 'field_focus' && d.field) lastBy.set(e.session_id, d.field);
    if (e.type === 'submit_invalid' && Array.isArray(d.fields)) for (const fl of d.fields) bump(errs, fl);
  }
  for (const [sid, fl] of lastBy) if (started.has(sid) && !done.has(sid)) bump(lastField, fl);

  /* ---- people ---- */
  const returning = leads.filter((l) => l.is_returning_lead).length;
  const vis = visRows.rows, retVis = vis.filter((v) => v.visit_count > 1).length;
  const devMap = (rows, key, label) => { const m = new Map(); rows.forEach((r) => bump(m, r[key] ? (label ? label(r[key]) : r[key]) : 'Unknown')); return topN(m, 8); };
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const devices = { type: devMap(leads, 'device_type', cap), os: devMap(leads, 'os'), browser: devMap(leads, 'browser'), inApp: devMap(leads.filter((l) => l.in_app), 'in_app'),
    visitorsType: devMap(vis, 'device_type', cap) };
  const ttr = leads.map((l) => l.time_to_register_seconds).filter((x) => Number.isFinite(x) && x >= 0);
  const buckets = BUCKETS.map(([label, max], i) => ({ label, n: ttr.filter((x) => x < max && x >= (i ? BUCKETS[i - 1][1] : 0)).length }));
  const visits = leads.map((l) => l.visit_count_before_signup).filter((x) => Number.isFinite(x));

  /* ---- map data: registered people and visitors who did NOT register, kept apart (coordinates are already rounded to 2 decimals) ---- */
  const aggregate = (items) => {
    const countries = new Map(), regions = new Map(), cities = new Map(); let located = 0;
    for (const it of items) {
      if (!it.code) continue;
      located++; bump(countries, it.code);
      if (it.region) bump(regions, it.code + '|' + it.region);
      if (it.city && it.lat != null && it.lon != null) bump(cities, [it.city, it.region || '', it.code, it.lat, it.lon].join('|'));
    }
    return {
      countries: [...countries].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: countryName(code), n })),
      regions: [...regions].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => { const [code, name] = k.split('|'); return { code, country: countryName(code), name, n }; }),
      cities: [...cities].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k, n]) => { const [name, region, code, lat, lon] = k.split('|'); return { name, region, code, country: countryName(code), lat: Number(lat), lon: Number(lon), n }; }),
      located
    };
  };
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  let exactLocated = 0;
  const regItems = leads.map((l) => {
    /* the coordinates on the map use the exact browser location when the person allowed it, else the IP lookup's city location */
    const exact = l.browser_lat != null && l.browser_lon != null;
    if (exact) exactLocated++;
    return { code: l.geo_country_code, region: l.geo_region, city: l.geo_city, lat: exact ? num(l.browser_lat) : num(l.geo_lat), lon: exact ? num(l.browser_lon) : num(l.geo_lon) };
  });
  /* visitors who opened the page and never registered (same master class / campaign filter as everything else) */
  const filtered = Boolean(f.course || f.campaign), visitorOk = new Set([...okSession.values()].map((s) => s.visitor_id));
  const unregRows = vis.filter((v) => !v.registered && (!filtered || visitorOk.has(v.visitor_id)));
  const unregItems = unregRows.map((v) => ({ code: v.geo_country_code, region: v.geo_region, city: v.geo_city, lat: num(v.geo_lat), lon: num(v.geo_lon) }));
  const regAgg = aggregate(regItems), unregAgg = aggregate(unregItems);
  const geo = {
    countries: regAgg.countries, regions: regAgg.regions, cities: regAgg.cities,
    located: regAgg.located, exactLocated, unknown: leads.length - regAgg.located, total: leads.length,
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

module.exports = { getInsights, cleanFilters, clearCache };
