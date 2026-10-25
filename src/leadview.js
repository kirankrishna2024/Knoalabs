// "Leads in this view": the people behind the analytics numbers, for exactly the same filters and period as the page.
//   registered   = leads (the form was submitted): every answer the form collected + where they came from + device / place
//   unregistered = visitors who opened the registration link but never registered: only what the tracker saw (no answers exist)
// The same dimension rules as aggregate() are used (channelOf / campaignOf / mediumOf / platformOf), so the list can never disagree with the charts.
// Never sent to the browser: raw IP, user agent, client id, visitor / session ids. Pure matching + two reads from the database.
const db = require('./db');
const Lead = require('./models/Lead');
const A = require('./analytics');
const G = require('./geo');
const campaigns = require('./campaigns');
const { browserLabel, parseUserAgent } = require('./ua');
const Meta = require('./meta');

const MAX_ROWS = 20000, MAX_EVENTS = 100000;
const NO = A.NO_PLATFORM;                                              // "__none": not Meta traffic
const IN_APP_PLATFORM = { Instagram: Meta.INSTAGRAM, Facebook: Meta.FACEBOOK, Messenger: Meta.MESSENGER };
const det = (d) => { try { return typeof d === 'string' ? JSON.parse(d) : d || {}; } catch { return {}; } };
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (code) => { try { return (code && regionNames && regionNames.of(String(code).toUpperCase())) || code || null; } catch { return code || null; } };

/** Does this row (a lead or a visitor with the same field names) pass every filter? `skipStatus` is for visitors (they have not said what they are). */
function passes(r, f, { visitor = false } = {}) {
  const slug = r.course_slug || Lead.NO_COURSE;
  if (f.status && !visitor && r.status !== f.status) return false;
  if (f.course && slug !== f.course) return false;
  if (f.campaign && A.campaignOf(r) !== f.campaign) return false;
  if (f.medium && A.mediumOf(r) !== f.medium) return false;
  if (f.channel && A.channelOf(r) !== f.channel) return false;
  if (f.platform && A.platformOf(r) !== f.platform) return false;
  return true;
}

const registeredView = (l) => {
  const ch = A.channelOf(l), ref = A.hostOf(l.referrer);
  const ua = l.user_agent && (!l.browser || l.in_app == null) ? parseUserAgent(l.user_agent) : null;
  const inApp = l.in_app || (ua && ua.in_app) || null, browser = l.browser || (ua && ua.browser) || null;
  return {
    kind: 'registered', id: Number(l.id), at: l.created_at, name: l.full_name, phone: l.phone, email: l.email, status: l.status,
    student_course: l.student_course, student_status: l.student_status, college: l.college_name, specialization: l.specialization,
    experience: l.experience_level ? String(l.experience_level).replace('-', '–') : null, job_role: l.job_role, company: l.current_company, qualification: l.highest_qualification,
    course: A.courseName(l.course_slug || Lead.NO_COURSE, l.course), course_slug: l.course_slug || null,
    campaign: A.campaignName(A.campaignOf(l)), medium: A.mediumName(A.mediumOf(l)), utm_source: l.utm_source, channel: ch, via: A.METHOD_NAMES[A.methodOf(l)] || null, referrer_host: ref || null,
    meta_app: A.platformOf(l) === NO ? null : A.platformOf(l), placement: l.meta_placement, page_url: l.page_url,
    device: l.device_type || A.deviceOf(l.user_agent), os: l.os, browser: browserLabel({ browser, in_app: inApp }), in_app: inApp,
    city: l.geo_city, region: l.geo_region, country: countryName(l.geo_country_code), exact_location: l.browser_lat != null,
    returning: Boolean(l.is_returning_lead), visits_before: l.visit_count_before_signup, seconds_to_register: l.time_to_register_seconds, form_version: l.form_version,
    answers: l.custom_fields && typeof l.custom_fields === 'object' ? l.custom_fields : (() => { try { return l.custom_fields ? JSON.parse(l.custom_fields) : null; } catch { return null; } })(),
    ip: l.ip ? G.maskIp(l.ip) : null
  };
};

/** Registered leads in the window that pass the filters, newest first (the full rows, for the Excel file and the list). */
async function registeredRows({ win, filters }) {
  const rows = await Lead.forView({ from: new Date(win.bounds[0]), to: new Date(win.bounds[win.n]), limit: MAX_ROWS });
  return rows.filter((l) => passes(l, filters));
}

/** Visitors who opened the link in the window and have no registration (one row per person, their latest visit in the window). */
async function unregisteredRows({ win, filters }) {
  if (filters.status) return { available: false, rows: [] };            // a visitor has not told us "I am a" yet
  const start = new Date(win.bounds[0]), end = new Date(win.bounds[win.n]);
  const [ses, ev, camps] = await Promise.all([
    db.query(`SELECT s.session_id, s.visitor_id, s.started_at, s.course_slug, s.source_detected, s.source_method, s.campaign_id,
                     v.first_seen, v.last_seen, v.visit_count, v.session_count, v.landing_path, v.referrer_host, v.language, v.timezone, v.screen, v.device_type, v.os, v.os_version,
                     v.browser, v.browser_version, v.in_app, v.is_webview, v.ip_masked, v.geo_country_code, v.geo_region, v.geo_city, v.geo_lat, v.geo_lon
              FROM sessions s JOIN visitors v ON v.visitor_id = s.visitor_id
              WHERE s.started_at >= $1 AND s.started_at < $2 AND v.visitor_id NOT IN (SELECT visitor_id FROM leads WHERE visitor_id IS NOT NULL)
              ORDER BY s.started_at DESC LIMIT ${MAX_ROWS}`, [start, end]),
    db.query(`SELECT session_id, type, detail FROM visitor_events WHERE at >= $1 AND at < $2 ORDER BY id LIMIT ${MAX_EVENTS}`, [start, end]),
    campaigns.list()
  ]);
  const tag = new Map(camps.map((c) => [Number(c.id), c]));
  const by = new Map();                                                   // session -> what the person did on the form
  for (const e of ev.rows) {
    let o = by.get(e.session_id); if (!o) { o = { started: false, tried: false, last: null, invalid: new Set() }; by.set(e.session_id, o); }
    const d = det(e.detail);
    if (e.type === 'form_start') o.started = true; else if (e.type === 'submit_attempt') o.tried = true;
    else if (e.type === 'field_focus' && d.field) o.last = d.field;
    else if (e.type === 'submit_invalid' && Array.isArray(d.fields)) for (const f of d.fields) o.invalid.add(f);
  }
  const seen = new Set(), out = [];
  for (const s of ses.rows) {
    if (seen.has(s.visitor_id)) continue; seen.add(s.visitor_id);
    const c = s.campaign_id != null ? tag.get(Number(s.campaign_id)) : null;
    const row = { utm_campaign: c ? c.utm_campaign : null, utm_medium: c ? c.utm_medium : null, utm_source: null, source_detected: s.source_detected, source_method: s.source_method,
      referrer: s.referrer_host ? 'https://' + s.referrer_host + '/' : null, meta_platform: IN_APP_PLATFORM[s.in_app] || null, course_slug: s.course_slug };
    if (!passes(row, filters, { visitor: true })) continue;
    const act = by.get(s.session_id) || {};
    out.push({
      kind: 'unregistered', at: s.started_at, first_seen: s.first_seen, last_seen: s.last_seen, visits: s.visit_count, sessions: s.session_count,
      course: A.courseName(s.course_slug || Lead.NO_COURSE), course_slug: s.course_slug || null, campaign: A.campaignName(A.campaignOf(row)), medium: A.mediumName(A.mediumOf(row)),
      channel: A.channelOf(row), via: A.METHOD_NAMES[s.source_method] || null, referrer_host: s.referrer_host || null,
      device: s.device_type, os: s.os ? s.os + (s.os_version ? ' ' + s.os_version : '') : null, browser: browserLabel({ browser: s.browser, in_app: s.in_app, is_webview: s.is_webview }), in_app: s.in_app || null,
      language: s.language, timezone: s.timezone, screen: s.screen, city: s.geo_city, region: s.geo_region, country: countryName(s.geo_country_code), ip: s.ip_masked, landing: s.landing_path,
      _cc: s.geo_country_code, _lat: s.geo_lat, _lon: s.geo_lon,
      started_form: Boolean(act.started), pressed_register: Boolean(act.tried), last_field: act.last || null, failed_fields: [...(act.invalid || [])]
    });
  }
  return { available: true, rows: out };
}

const pick = (n, d, allowed) => (allowed.includes(Number(n)) ? Number(n) : d);

/** One page of the list. kind = registered | unregistered | all. */
async function view({ tz, query = {}, now }) {
  const win = A.resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days });
  const filters = A.normalizeFilters(query);
  const [reg, unreg] = await Promise.all([registeredRows({ win, filters }), unregisteredRows({ win, filters })]);
  const kind = ['registered', 'unregistered', 'all'].includes(query.kind) ? query.kind : 'registered';
  const regV = kind === 'unregistered' ? [] : reg.map(registeredView);
  const unV = kind === 'registered' ? [] : unreg.rows;
  const merged = regV.concat(unV).sort((a, b) => new Date(b.at) - new Date(a.at));
  const pageSize = pick(query.pageSize, 25, [10, 25, 50, 100]), pages = Math.max(1, Math.ceil(merged.length / pageSize));
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), pages);
  return {
    kind, window: { from: win.from, to: win.to, days: win.n }, filters,
    counts: { registered: reg.length, unregistered: unreg.available ? unreg.rows.length : null, all: reg.length + (unreg.available ? unreg.rows.length : 0) },
    unregisteredAvailable: unreg.available, total: merged.length, page, pages, pageSize, rows: merged.slice((page - 1) * pageSize, page * pageSize).map((r) => { const { _cc, _lat, _lon, ...pub } = r; return pub; })
  };
}

/** Everything for the Excel file (no paging). */
async function exportData({ tz, query = {}, now }) {
  const win = A.resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days });
  const filters = A.normalizeFilters(query);
  const kind = ['registered', 'unregistered', 'all'].includes(query.kind) ? query.kind : 'all';
  const [reg, unreg] = await Promise.all([kind === 'unregistered' ? [] : registeredRows({ win, filters }), kind === 'registered' ? { available: true, rows: [] } : unregisteredRows({ win, filters })]);
  for (const l of reg) { const v = registeredView(l); l.channel_label = v.channel; l.source_via = v.via; l.browser_label = v.browser; l.campaign_label = v.campaign; l.medium_label = v.medium; }
  return { win, filters, kind, registered: reg, unregistered: unreg.rows, unregisteredAvailable: unreg.available };
}

/** A session (joined with its visitor) shaped like a lead for the filters: campaign and medium come from the campaign it was attributed to. */
const sessionRow = (s, campaignById) => {
  const c = s.campaign_id != null ? campaignById.get(Number(s.campaign_id)) : null;
  return { utm_campaign: c ? c.utm_campaign : null, utm_medium: c ? c.utm_medium : null, utm_source: null, source_detected: s.source_detected, source_method: s.source_method,
    referrer: s.referrer_host ? 'https://' + s.referrer_host + '/' : null, meta_platform: IN_APP_PLATFORM[s.in_app] || null, course_slug: s.course_slug };
};

module.exports = { view, exportData, passes, registeredView, unregisteredRows, sessionRow };
