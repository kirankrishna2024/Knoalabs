// POST /api/visit : public beacon sent by the registration page when it is opened in a browser.
// Counts "link opens" (people who clicked an ad link and the page loaded). Never returns data, never blocks the page.
const express = require('express');
const Visit = require('./models/Visit');
const rateLimit = require('./rateLimit');
const { resolveCourse, browserLocation } = require('./validate');
const O = require('./options');
const { detectMeta } = require('./meta');
const { detectSource, ALL_CLICK_IDS } = require('./sources');
const forms = require('./forms');
const campaigns = require('./campaigns');

const router = express.Router();
// Many students share one IP (college Wi-Fi, mobile carrier gateways), so the per-IP limit is generous: it only stops floods.
const BEACONS_PER_10_MIN = 600;
// crawlers, link-preview fetchers (WhatsApp / Facebook / Slack ...), headless browsers and uptime monitors are not people.
// "whatsapp/" is only matched at the START of the user agent: that is the link-preview crawler ("WhatsApp/2.23.20 A").
// Someone reading the link inside the WhatsApp app sends "Mozilla/5.0 ... WhatsApp/2.23.20.1 A": a real browser,
// counted like any other visit, otherwise WhatsApp opens would always show zero.
// The AI crawlers are named explicitly (anthropic-ai, google-extended, chatgpt-user ... carry no "bot"); an AI assistant's
// own app browser is a person and is counted under ChatGPT / AI.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|^\s*whatsapp\/|chatgpt-user|anthropic-ai|claude-web|google-extended|meta-externalagent|cohere-ai|ai2bot|telegram|skype|slack|discord|embedly|pingdom|uptime|monitor|lighthouse|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|go-http/i;
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const orNull = (v) => v || null;

function referrerHost(raw, ownHost) {
  try {
    const h = new URL(String(raw)).hostname.replace(/^www\./, '').toLowerCase().slice(0, 120);
    return h && h !== String(ownHost || '').replace(/^www\./, '').toLowerCase() ? h : null;   // our own pages are not a source
  } catch { return null; }
}

router.post('/visit', rateLimit({ windowMs: 10 * 60 * 1000, max: BEACONS_PER_10_MIN }), async (req, res) => {
  res.status(204);                                                     // the page never waits for or reads the answer
  try {
    const b = req.body || {};
    const vid = typeof b.vid === 'string' ? b.vid.trim() : '';          // not truncated: an over-long id is rejected, not bent into a valid one
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(vid)) return res.end();
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT.test(ua)) return res.end();                          // real browsers always send a user agent
    const slug = resolveCourse(b.course).slug;                          // null = the plain link
    if (slug && !O.COURSES[slug]) {                                     // a form created on its own lives only in `forms`
      const found = await forms.findForPath(slug).catch(() => null);
      if (!found || !found.form || found.form.status === 'archived') return res.end();   // /typo, /wp-login ...: not a registration link
    }
    const utm_source = orNull(text(b.utm_source, 120)), refHost = referrerHost(b.referrer, req.hostname);
    const camp = await campaigns.canonical(slug, orNull(text(b.utm_campaign, 120)));        // a campaign nobody added is counted under the running one (or none)
    // Facebook or Instagram? from Meta's {{site_source_name}} / {{placement}} in the link, else the tag, referrer or in-app browser (the user agent is read here and never stored)
    const meta = detectMeta({ utm_source, site_source_name: text(b.site_source_name, 20), placement: b.placement, referrerHost: refHost, userAgent: ua, fbclid: b.fbclid === true });
    // which ad network? the click id the ad platform appended, the referrer or the in-app browser (auto-detect, no typed source needed)
    const clickIds = {};
    if (b.fbclid === true) clickIds.fbclid = true;
    if (b.click_ids && typeof b.click_ids === 'object') for (const k of ALL_CLICK_IDS) if (b.click_ids[k] === true) clickIds[k] = true;
    const src = detectSource({ utm_source, utm_medium: b.utm_medium, clickIds, userAgent: ua, referrerHost: refHost, ownHost: req.hostname });
    const exact = browserLocation(b.geo);
    await Visit.record({
      visitor_id: vid,
      course_slug: slug,
      utm_source, utm_medium: orNull(text(b.utm_medium, 120).toLowerCase()), utm_campaign: camp.tag,
      referrer_host: refHost,
      meta_platform: meta.platform, meta_placement: meta.placement,
      source_detected: src.channel, source_method: src.method,
      browser_lat: exact.browser_lat ?? null, browser_lon: exact.browser_lon ?? null, browser_accuracy: exact.browser_accuracy ?? null, browser_geo_at: exact.browser_geo_at || null
    });
  } catch (e) { req.log.warn({ err: e.message }, 'visit not recorded'); }
  res.end();
});

module.exports = router;
