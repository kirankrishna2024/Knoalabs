// POST /api/track : visitor, session and event tracking from the registration page (public, write-only).
// What is stored: an anonymous visitor id (random, kept in the browser), a session id, event names with small whitelisted details,
// the device labels read from the user agent, the traffic source, and a salted HASH of the IP (never the address).
// What is never stored: typed answers, the raw user agent, the raw IP, click-id values.
const express = require('express');
const db = require('./db');
const config = require('./config');
const log = require('./logger');
const rateLimit = require('./rateLimit');
const O = require('./options');
const G = require('./geo');
const { resolveCourse } = require('./validate');
const { detectSource, ALL_CLICK_IDS } = require('./sources');
const forms = require('./forms');
const { parseUserAgent } = require('./ua');
const campaigns = require('./campaigns');
const geoService = require('./geoService');

const router = express.Router();
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const TYPES = new Set(['page_view', 'form_start', 'field_focus', 'submit_attempt', 'submit_invalid', 'submit_failed', 'submit_success', 'page_hide']);
const FIELD = /^[a-z][a-z_]{1,39}$/;
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const orNull = (v) => v || null;

/** Event details are rebuilt from a whitelist: anything else a client sends is dropped. */
function cleanDetail(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  if (typeof d.field === 'string' && FIELD.test(d.field)) out.field = d.field;
  if (Array.isArray(d.fields)) out.fields = d.fields.filter((x) => typeof x === 'string' && FIELD.test(x)).slice(0, 20);
  if (Number.isInteger(d.form_version) && d.form_version > 0 && d.form_version < 100000) out.form_version = d.form_version;
  if (Number.isInteger(d.s) && d.s >= 0 && d.s < 86400) out.s = d.s;
  if (d.server === true) out.server = true;
  return out;
}
const hostOf = (raw, own) => { try { const h = new URL(String(raw)).hostname.replace(/^www\./, '').toLowerCase().slice(0, 120); return h && h !== String(own || '').replace(/^www\./, '').toLowerCase() ? h : null; } catch { return null; } };
const bigPos = (v, max = 1e12) => (Number.isInteger(v) && v > 0 && v < max ? v : null);

/** Record one batch. Returns { events, newSession } (counts). Throws on database errors (the route swallows them). */
async function record({ body, ip, userAgent, ownHost, now = new Date() }) {
  const ua = parseUserAgent(userAgent);
  if (ua.bot) return { events: 0, newSession: false, skipped: 'bot' };
  const vid = typeof body.vid === 'string' ? body.vid.trim() : '', sid = typeof body.sid === 'string' ? body.sid.trim() : '';
  if (!ID.test(vid) || !ID.test(sid)) return { events: 0, newSession: false, skipped: 'ids' };
  const slug = resolveCourse(body.course).slug;
  if (slug && !O.COURSES[slug]) {
    const found = await forms.findForPath(slug).catch(() => null);
    if (!found || !found.form || found.form.status === 'archived') return { events: 0, newSession: false, skipped: 'course' };   // a form made on its own is a valid link
  }
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 20).filter((e) => e && typeof e === 'object' && TYPES.has(e.t) && KEY.test(String(e.k || '')));
  if (!events.length) return { events: 0, newSession: false, skipped: 'empty' };

  const utm_source = orNull(text(body.utm_source, 120)), utm_medium = orNull(text(body.utm_medium, 120).toLowerCase()), utm_campaign = orNull(text(body.utm_campaign, 120));
  const refHost = hostOf(body.referrer, ownHost);
  const clickIds = {};
  if (body.click_ids && typeof body.click_ids === 'object') for (const k of ALL_CLICK_IDS) if (body.click_ids[k] === true) clickIds[k] = true;
  const src = detectSource({ utm_source, utm_medium, clickIds, userAgent, referrerHost: refHost, ownHost });
  const campaignId = await campaigns.idByTag(slug, utm_campaign);
  const ipHash = G.hashIp(ip, config.geo.ipSalt), ipMasked = ip ? G.maskIp(ip) : null;
  const lang = orNull(text(body.lang, 20)), tz = orNull(text(body.tz, 60)), screen = /^\d{2,5}x\d{2,5}$/.test(String(body.screen || '')) ? body.screen : null;

  const up = await db.query(
    `INSERT INTO visitors (visitor_id, first_seen, last_seen, visit_count, session_count, first_source, first_method, last_source, landing_path, referrer_host, language, timezone, screen,
       device_type, os, os_version, browser, browser_version, in_app, is_webview, ip_hash, ip_masked)
     VALUES ($1,$2,$2,0,0,$3,$4,$3,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (visitor_id) DO UPDATE SET last_seen=$2, last_source=$3, language=COALESCE($7, visitors.language), timezone=COALESCE($8, visitors.timezone), screen=COALESCE($9, visitors.screen),
       device_type=$10, os=$11, os_version=$12, browser=$13, browser_version=$14, in_app=$15, is_webview=$16, ip_hash=COALESCE($17, visitors.ip_hash), ip_masked=COALESCE($18, visitors.ip_masked)
     RETURNING visitor_id`,
    [vid, now, src.channel, src.method, text(body.landing, 120).replace(/[^\w/.-]/g, '') || null, refHost, lang, tz, screen,
      ua.device_type, ua.os, ua.os_version, ua.browser, ua.browser_version, ua.in_app, ua.is_webview, ipHash, ipMasked]);
  void up;

  // known session? (checked first; the insert below is still conflict-safe when two requests of one new session arrive together)
  const known = (await db.query('SELECT 1 FROM sessions WHERE session_id=$1', [sid])).rows.length > 0;
  let newSession = false;
  if (!known) {
    const ses = await db.query(
      `INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, campaign_id, course_slug, source_detected, source_method)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7) ON CONFLICT (session_id) DO NOTHING RETURNING session_id`, [sid, vid, now, campaignId, slug, src.channel, src.method]);
    newSession = ses.rows.length > 0;
  }
  if (newSession) await db.query('UPDATE visitors SET visit_count = visit_count + 1, session_count = session_count + 1 WHERE visitor_id=$1', [vid]);
  else await db.query('UPDATE sessions SET last_seen=$2 WHERE session_id=$1', [sid, now]);

  let stored = 0;
  for (const e of events) {
    const r = await db.query(
      `INSERT INTO visitor_events (event_key, at, visitor_id, session_id, type, course_slug, campaign_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [e.k, now, vid, sid, e.t, slug, campaignId, JSON.stringify({ ...cleanDetail(e.d), ...(bigPos(body.form_id) ? { form_id: bigPos(body.form_id) } : {}) })]);
    stored += r.rows.length;
  }
  if (newSession && config.geo.trackVisitors && ip) setImmediate(() => geoService.enrichVisitor({ visitorId: vid, ip }).catch(() => {}));
  return { events: stored, newSession };
}

router.post('/track', rateLimit({ windowMs: 10 * 60 * 1000, max: 1500 }), async (req, res) => {
  res.status(204);                                  // the page never waits for or reads the answer
  try { await record({ body: req.body || {}, ip: req.ip, userAgent: String(req.headers['user-agent'] || ''), ownHost: req.hostname }); }
  catch (e) { log.warn({ err: e.message }, 'tracking event not recorded'); }
  res.end();
});

module.exports = router;
module.exports.record = record;
module.exports.cleanDetail = cleanDetail;
