// Meta (Facebook / Instagram) ad traffic: which app did the person come from?
//
// A link cannot tell Facebook from Instagram by itself, but Meta can fill that in at click time. In Ads Manager, ad ->
// Tracking -> URL parameters, put:   utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&site_source_name={{site_source_name}}&placement={{placement}}
// {{site_source_name}} becomes fb / ig / msg / an and {{placement}} e.g. Instagram_Reels. The registration page sends both to the
// server, which stores the result (Facebook, Instagram, Messenger, Audience Network) with the lead and with the link open.
//
// Evidence, strongest first (the first one that names an app wins):
//   1. site_source_name   fb / ig / msg / an            (Meta's own macro)
//   2. utm_source         facebook / fb / instagram / ig ... (older links, or utm_source={{site_source_name}})
//   3. placement          starts with Facebook_ / Instagram_ / Messenger_ / Audience_Network
//   4. referrer           l.facebook.com, l.instagram.com, ...   (often removed by the in-app browser)
//   5. in-app browser     the user agent of the Instagram / Facebook / Messenger app (read here, never stored)
// If the traffic is Meta but no evidence names the app, the platform is "Meta (unknown)".
// Traffic whose utm_source names another channel (google, email ...) is never labelled Meta, whatever the browser says.
// Pure and dependency free. Unit-tested in test/meta.test.js.

const FACEBOOK = 'Facebook', INSTAGRAM = 'Instagram', MESSENGER = 'Messenger', AUDIENCE = 'Audience Network', UNKNOWN = 'Meta (unknown)';
const PLATFORMS = [FACEBOOK, INSTAGRAM, MESSENGER, AUDIENCE, UNKNOWN];

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
// A macro Meta never filled in ("{{placement}}", "{{site_source_name}}": the link was opened outside an ad, or pasted without the right field) is not a value.
const UNFILLED = /\{\{|\}\}|%7B%7B/i;
const filled = (v) => { const t = clean(typeof v === 'string' ? v : '', 120); return t && !UNFILLED.test(t) ? t : ''; };

const WORDS = new Map([['fb', FACEBOOK], ['facebook', FACEBOOK], ['ig', INSTAGRAM], ['instagram', INSTAGRAM], ['msg', MESSENGER], ['messenger', MESSENGER],
  ['an', AUDIENCE], ['audience network', AUDIENCE], ['audience_network', AUDIENCE], ['audience-network', AUDIENCE], ['audiencenetwork', AUDIENCE]]);

/** Exactly one of Meta's names: 'fb' / 'ig' / 'msg' / 'an' / 'facebook' / 'instagram' ... -> platform name, else null (anything with extra text is not a name). */
function platformFromWord(raw) {
  const t = clean(String(raw == null ? '' : raw), 40).toLowerCase();
  return WORDS.get(t) || null;
}

/** Meta's {{placement}} values start with the app: Facebook_Mobile_Feed, Instagram_Reels, Messenger_Inbox, Audience_Network_Native ... */
function platformFromPlacement(raw) {
  const t = clean(String(raw == null ? '' : raw), 80).toLowerCase();
  const m = /^(facebook|instagram|messenger|audience[ _-]?network)(?:[ _-]|$)/.exec(t);
  return m ? WORDS.get(m[1].replace(/[ _-]/g, m[1].startsWith('audience') ? ' ' : '')) || null : null;
}

/** Referring site name -> platform (l.facebook.com, m.facebook.com, l.instagram.com, messenger.com ...). */
function platformFromHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return null;
  if (h === 'instagram.com' || h.endsWith('.instagram.com')) return INSTAGRAM;
  if (h === 'messenger.com' || h.endsWith('.messenger.com')) return MESSENGER;
  if (h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h.endsWith('.fb.com') || h === 'fb.me') return FACEBOOK;
  return null;
}

/** The in-app browser of the Meta apps announces itself in the user agent. */
function platformFromUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return null;
  if (/FB_IAB\/MESSENGER|MessengerForiOS|Orca-Android|\bMessenger\b/i.test(s)) return MESSENGER;
  if (/\bInstagram\b/i.test(s)) return INSTAGRAM;
  if (/FBAN\/|FBAV\/|FB_IAB\/|FBIOS|FB4A/i.test(s)) return FACEBOOK;
  return null;
}

const META_SOURCE = /^(meta|facebook|fb|instagram|ig|messenger|msg|an|audience[\s_.-]?network)$/i;

/** Is this utm_source one of the Meta names? (empty counts: the tag is simply absent) */
const isMetaSource = (s) => !s || META_SOURCE.test(String(s).trim());

/** Meta's {{placement}} value: letters, digits and a few separators only, 60 characters at most. */
const cleanPlacement = (v) => (filled(String(v == null ? '' : v)) ? clean(String(v), 60).replace(/[^A-Za-z0-9 _.\-/+]/g, '').trim() || null : null);

/**
 * @param {object} i  { utm_source, site_source_name, placement, referrerHost | referrer, userAgent, fbclid }
 * @returns {{platform: string|null, placement: string|null}}  platform null = this is not Meta traffic (or not known to be)
 */
function detectMeta(i = {}) {
  const source = clean(i.utm_source, 120);
  if (!isMetaSource(source)) return { platform: null, placement: null };             // tagged as another channel: not Meta
  const placement = cleanPlacement(i.placement);
  let host = i.referrerHost;
  if (host == null && i.referrer) { try { host = new URL(String(i.referrer)).hostname; } catch { host = ''; } }
  const named = filled(i.site_source_name);                                            // an unfilled {{site_source_name}} says nothing
  const byWord = platformFromWord(named) || (source ? platformFromWord(source) : null) || platformFromPlacement(placement);
  const byHost = platformFromHost(host);
  const byUa = platformFromUserAgent(i.userAgent);
  const platform = byWord || byHost || byUa;
  if (platform) return { platform, placement };
  const evidence = Boolean(source) || Boolean(named) || Boolean(i.fbclid);
  return evidence ? { platform: UNKNOWN, placement } : { platform: null, placement: null };
}

module.exports = { detectMeta, platformFromWord, platformFromPlacement, platformFromHost, platformFromUserAgent, isMetaSource, cleanPlacement, PLATFORMS, FACEBOOK, INSTAGRAM, MESSENGER, AUDIENCE, UNKNOWN };
