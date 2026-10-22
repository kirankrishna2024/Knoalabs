const express = require('express');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const Lead = require('./models/Lead');
const rateLimit = require('./rateLimit');
const { validateLead, metaFields, browserLocation } = require('./validate');
const F = require('./formdef');
const forms = require('./forms');
const G = require('./geo');
const campaigns = require('./campaigns');
const person = require('./person');
const { parseUserAgent } = require('./ua');
const { detectMeta } = require('./meta');
const { detectSource, ALL_CLICK_IDS } = require('./sources');
const geoService = require('./geoService');

const router = express.Router();
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Check the answers against the form the person saw (the published definition for this link), falling back to the built-in form
 *  when the course has no form yet or the database cannot be read, so a registration is never lost to a form-engine problem. */
async function validateAgainstForm(body, req) {
  let resolved = null;
  try { resolved = await forms.resolveForSubmit(body.course, Number.isInteger(body.form_version) ? body.form_version : null); }
  catch (e) { req.log.warn({ err: e.message }, 'form definition not available; using the built-in form'); }
  if (resolved && resolved.closed) return { closed: true };
  if (resolved && resolved.definition) {
    const r = F.validateSubmission(resolved.definition, body);
    if (Object.keys(r.errors).length) return { errors: r.errors };
    const lead = { ...F.toLeadColumns(r), ...metaFields(body), form_id: resolved.form_id, form_version: resolved.version, custom_fields: Object.keys(r.custom).length ? r.custom : null };
    return { lead };
  }
  const { errors, lead } = validateLead(body);
  if (Object.keys(errors).length) return { errors };
  return { lead: { ...lead, form_id: resolved ? resolved.form_id : null } };
}

/** Device, visitor, campaign, same-person and timing columns. Each part is optional: a failure here never stops the registration. */
async function addTracking(lead, body, req) {
  const ua = parseUserAgent(lead.user_agent);
  Object.assign(lead, { device_type: ua.device_type, os: ua.os, browser: ua.browser, in_app: ua.in_app });
  lead.ip_hash = G.hashIp(lead.ip, config.geo.ipSalt); lead.ip_version = G.ipVersion(lead.ip);
  lead.visitor_id = typeof body.visitor_id === 'string' && ID.test(body.visitor_id) ? body.visitor_id : null;
  lead.session_id = typeof body.session_id === 'string' && ID.test(body.session_id) ? body.session_id : null;
  try { lead.campaign_id = await campaigns.idByTag(lead.course_slug, lead.utm_campaign); } catch { /* optional */ }
  try {
    if (lead.visitor_id) {
      const v = await db.query('SELECT visit_count FROM visitors WHERE visitor_id=$1', [lead.visitor_id]);
      if (v.rows[0]) lead.visit_count_before_signup = v.rows[0].visit_count;
    }
    let seconds = null;
    if (lead.session_id) {
      const e = await db.query("SELECT MIN(at) AS t FROM visitor_events WHERE session_id=$1 AND type='page_view'", [lead.session_id]);
      if (e.rows[0] && e.rows[0].t) seconds = Math.round((Date.now() - new Date(e.rows[0].t).getTime()) / 1000);
    }
    if (seconds == null && Number.isFinite(body.seconds_on_page)) seconds = Math.round(body.seconds_on_page);
    if (seconds != null && seconds >= 0 && seconds < 7 * 86400) lead.time_to_register_seconds = seconds;
  } catch (e) { req.log.warn({ err: e.message }, 'visit history not read'); }
  try { Object.assign(lead, await person.findRelated({ phone: lead.phone, email: lead.email, visitor_id: lead.visitor_id })); }
  catch (e) { req.log.warn({ err: e.message }, 'same-person check failed'); }
}

/* ---------- POST /api/leads : public, called by the registration form ---------- */
router.post('/leads', rateLimit({ max: config.rateLimitMax }), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true });          // honeypot: pretend success to bots

    const out = await validateAgainstForm(body, req);
    if (out.closed) return res.status(409).json({ ok: false, error: 'Registrations for this master class are closed right now.' });
    if (out.errors) return res.status(422).json({ ok: false, errors: out.errors });
    const lead = out.lead;

    lead.ip = req.ip || null;
    lead.user_agent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
    Object.assign(lead, browserLocation(body.geo));                    // exact location, only when the browser shared it
    // Facebook or Instagram? (see src/meta.js). The tags and the link itself are kept as before; this adds the app name and placement.
    const meta = detectMeta({ utm_source: lead.utm_source, site_source_name: body.site_source_name, placement: body.placement, referrer: lead.referrer, userAgent: lead.user_agent, fbclid: body.fbclid === true });
    lead.meta_platform = meta.platform; lead.meta_placement = meta.placement;

    // Where did the visit come from? (src/sources.js). Never blocks the registration.
    try {
      const clickIds = {};
      if (body.fbclid === true) clickIds.fbclid = true;
      if (body.click_ids && typeof body.click_ids === 'object') for (const k of ALL_CLICK_IDS) if (body.click_ids[k] === true) clickIds[k] = true;
      const s = detectSource({ utm_source: lead.utm_source, utm_medium: lead.utm_medium, clickIds, userAgent: lead.user_agent, referrer: lead.referrer, ownHost: req.hostname });
      lead.source_detected = s.channel; lead.source_method = s.method;
    } catch (e) { req.log.warn({ err: e.message }, 'source detection failed'); }
    await addTracking(lead, body, req);

    const { lead: saved, duplicate } = await Lead.createOnce(lead);
    if (!duplicate) req.log.info({ leadId: saved.id, course: saved.course_slug, returning: Boolean(lead.is_returning_lead) }, 'lead saved');
    res.status(duplicate ? 200 : 201).json({ ok: true, id: saved.id, duplicate });
    if (!duplicate && lead.visitor_id) db.query('UPDATE visitors SET lead_count = lead_count + 1 WHERE visitor_id=$1', [lead.visitor_id]).catch(() => {});
    // IP location runs AFTER the answer has been sent: a slow or failing lookup can never delay or fail a registration (no-op unless GEO_PROVIDER is set).
    if (!duplicate) setImmediate(() => geoService.enrichLead({ leadId: saved.id, ip: lead.ip, formDialCode: lead.country_code }).catch(() => {}));
    if (!duplicate) setImmediate(() => geoService.enrichVisitor({ visitorId: lead.visitor_id, ip: lead.ip }).catch(() => {}));
  } catch (e) {
    req.log.error({ err: e.message }, 'lead submit failed');
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'We could not save your details. Please try again.' });
    else next(e);
  }
});

module.exports = router;
void log;
