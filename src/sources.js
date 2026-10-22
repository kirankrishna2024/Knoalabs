// Where did a visit / lead come from? One data-driven table, easy to extend. Pure and dependency free.
//
// Priority (first match wins):
//   1. utm_source        normalised through the synonym table below (method "utm")
//   2. click id          fbclid -> Meta, gclid/gbraid/wbraid -> Google, msclkid -> Bing, li_fat_id -> LinkedIn, ttclid -> TikTok (method "click_id")
//                        Click ids are opaque: callers pass presence flags only, the value is never read or stored.
//   3. in-app browser    the user agent of the Instagram / Facebook / Messenger / LinkedIn / Telegram / WhatsApp / TikTok app (method "in_app")
//   4. referrer host     l.instagram.com, mail.google.com, chatgpt.com ... (method "referrer")
//   5. nothing           "Direct" (method "direct"); a host we do not know is "Other" and keeps its host name (never "undefined")
// Channel names for the channels analytics.js already knows (Meta, Google, YouTube, WhatsApp, LinkedIn, X / Twitter, Telegram, Bing) are
// identical to analytics.niceChannel, so existing charts keep their labels (test/sources.test.js checks this).
// Facebook vs Instagram is NOT decided here: that stays in src/meta.js (detectMeta); one "Meta" channel covers both.

const CHANNELS = [
  // name, utm_source synonyms, referrer host suffixes, click ids, in-app user-agent
  { name: 'Meta', utm: /^(meta|facebook|fb|instagram|ig|messenger|msg|an|audience[\s_.-]?network|facebook[\s_.-]?ads|instagram[\s_.-]?ads)$/i,
    hosts: ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'messenger.com', 'l.facebook.com', 'lm.facebook.com'], clickIds: ['fbclid'], inApp: /\bInstagram\b|FBAN\/|FBAV\/|FB_IAB\/|FBIOS|FB4A|Messenger/i },
  { name: 'YouTube', utm: /^(youtube|yt|youtu\.?be)$/i, hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { name: 'Google', utm: /^(google|google[\s_.-]?(ads|search|adwords)|adwords|gads|googleads)$/i,
    hosts: ['google.com', 'google.co.in', 'google.co.uk', 'google.ae', 'google.ca', 'google.com.au', 'google.com.sg', 'googleadservices.com', 'googlesyndication.com', 'g.co'],
    clickIds: ['gclid', 'gbraid', 'wbraid'], hostRe: /(^|\.)google\.[a-z.]{2,6}$/ },
  { name: 'Email', utm: /^(e-?mail|newsletter|mailchimp|sendgrid|mailer|gmail|outlook|yahoo[\s_.-]?mail|hubspot|brevo|sendinblue|klaviyo|substack|convertkit)$/i,
    hosts: ['mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'mail.yahoo.co.in', 'mail.proton.me', 'mailchi.mp', 'list-manage.com', 'sendgrid.net', 'substack.com', 'convertkit.com', 'hubspotemail.net', 'sendibt3.com', 'zoho.com'] },
  { name: 'LinkedIn', utm: /^(linkedin|lnkd|lnkd\.in|li)$/i, hosts: ['linkedin.com', 'lnkd.in'], clickIds: ['li_fat_id'], inApp: /LinkedInApp/i },
  { name: 'Telegram', utm: /^(telegram|tg|t\.me)$/i, hosts: ['t.me', 'telegram.org', 'web.telegram.org', 'telegram.me'], inApp: /\bTelegram\b/i },
  { name: 'WhatsApp', utm: /^(whatsapp|wa|wa\.me)$/i, hosts: ['wa.me', 'whatsapp.com', 'web.whatsapp.com', 'api.whatsapp.com'], inApp: /\bWhatsApp\b/i },
  { name: 'ChatGPT / AI', utm: /^(chatgpt|openai|chat\.?gpt|perplexity|gemini|bard|copilot|claude|deepseek|ai|llm)$/i,
    hosts: ['chatgpt.com', 'chat.openai.com', 'openai.com', 'perplexity.ai', 'gemini.google.com', 'bard.google.com', 'copilot.microsoft.com', 'claude.ai', 'deepseek.com', 'chat.deepseek.com', 'you.com', 'poe.com'] },
  { name: 'X / Twitter', utm: /^(t\.co|twitter|x|x\.com|tw)$/i, hosts: ['t.co', 'twitter.com', 'x.com'] },
  { name: 'Reddit', utm: /^(reddit)$/i, hosts: ['reddit.com', 'out.reddit.com', 'old.reddit.com', 'redd.it'] },
  { name: 'TikTok', utm: /^(tiktok|tt)$/i, hosts: ['tiktok.com'], clickIds: ['ttclid'], inApp: /musical_ly|BytedanceWebview|TikTok/i },
  { name: 'Bing', utm: /^(bing|msn|microsoft[\s_.-]?ads)$/i, hosts: ['bing.com', 'msn.com', 'cn.bing.com'], clickIds: ['msclkid'] },
  { name: 'Other search', utm: /^(duckduckgo|ddg|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|search)$/i,
    hosts: ['duckduckgo.com', 'search.yahoo.com', 'in.search.yahoo.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'baidu.com', 'ecosia.org', 'search.brave.com', 'startpage.com', 'qwant.com'] }
];
const ALL_CLICK_IDS = [...new Set(CHANNELS.flatMap((c) => c.clickIds || []))];

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const normHost = (h) => String(h || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '').slice(0, 120);
const hostOf = (raw) => { try { return normHost(new URL(String(raw)).hostname); } catch { return ''; } };
const inDomain = (host, d) => host === d || host.endsWith('.' + d);
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** utm_source text -> channel name, or null when the table does not know it. */
function channelFromSource(raw) {
  const t = clean(String(raw == null ? '' : raw), 120);
  if (!t || /\{\{|%7B%7B/i.test(t)) return null;                 // an unfilled macro says nothing
  for (const c of CHANNELS) if (c.utm.test(t)) return c.name;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t)) return channelFromHost(t);   // utm_source=chatgpt.com (ChatGPT adds this itself), utm_source=t.co ...
  return null;
}

/** Referring host -> channel name, or null. The most specific domain wins (mail.google.com is Email, not Google); the generic google.* pattern is the last resort. */
function channelFromHost(rawHost) {
  const h = normHost(rawHost);
  if (!h) return null;
  let best = null, bestLen = -1;
  for (const c of CHANNELS) {
    for (const d of c.hosts || []) if (inDomain(h, d) && d.length > bestLen) { best = c.name; bestLen = d.length; }
    if (c.hostRe && c.hostRe.test(h) && bestLen < 0) { best = c.name; bestLen = 0; }
  }
  return best;
}

/** The app whose in-app browser opened the page ("Instagram", "Facebook", "Messenger", "LinkedIn", "Telegram", "WhatsApp", "TikTok") or null. Read from the user agent, never stored raw. */
function inAppBrowser(ua) {
  const s = String(ua || '');
  if (!s) return null;
  if (/FB_IAB\/MESSENGER|MessengerForiOS|Orca-Android|\bMessenger\b/i.test(s)) return { app: 'Messenger', channel: 'Meta' };
  if (/\bInstagram\b/i.test(s)) return { app: 'Instagram', channel: 'Meta' };
  if (/FBAN\/|FBAV\/|FB_IAB\/|FBIOS|FB4A/i.test(s)) return { app: 'Facebook', channel: 'Meta' };
  if (/LinkedInApp/i.test(s)) return { app: 'LinkedIn', channel: 'LinkedIn' };
  if (/\bTelegram\b/i.test(s)) return { app: 'Telegram', channel: 'Telegram' };
  if (/\bWhatsApp\b/i.test(s)) return { app: 'WhatsApp', channel: 'WhatsApp' };
  if (/musical_ly|BytedanceWebview|TikTok/i.test(s)) return { app: 'TikTok', channel: 'TikTok' };
  return null;
}

/** Which click ids are present on the URL? Presence only: the values are never read. */
function clickIdPresence(query) {
  const out = {};
  const has = (k) => (query && typeof query.has === 'function' ? query.has(k) : Boolean(query && query[k]));
  for (const k of ALL_CLICK_IDS) if (has(k)) out[k] = true;
  return out;
}

/**
 * @param {object} i { utm_source, utm_medium, clickIds:{fbclid:true,...}, userAgent, referrer | referrerHost, ownHost }
 * @returns {{channel:string, method:'utm'|'click_id'|'in_app'|'referrer'|'direct', host:string|null}}
 */
function detectSource(i = {}) {
  const utm = clean(i.utm_source, 120);
  if (utm && !/\{\{|%7B%7B/i.test(utm)) {
    const known = channelFromSource(utm);
    if (known) return { channel: known, method: 'utm', host: null };
    if (/^e-?mail$/i.test(clean(i.utm_medium, 60))) return { channel: 'Email', method: 'utm', host: null };      // unknown source name, but the medium says email
    const label = utm.length > 28 ? utm.slice(0, 27) + '…' : titleCase(utm);
    return { channel: label, method: 'utm', host: null };                                                       // a custom tag stays readable, like analytics does today
  }
  const ids = i.clickIds || {};
  for (const c of CHANNELS) if ((c.clickIds || []).some((k) => ids[k])) return { channel: c.name, method: 'click_id', host: null };
  const app = inAppBrowser(i.userAgent);
  if (app) return { channel: app.channel, method: 'in_app', host: null };
  const own = normHost(i.ownHost);
  const host = normHost(i.referrerHost != null ? i.referrerHost : hostOf(i.referrer));
  if (host && host !== own) {
    const byHost = channelFromHost(host);
    return byHost ? { channel: byHost, method: 'referrer', host } : { channel: 'Other', method: 'referrer', host };
  }
  return { channel: 'Direct', method: 'direct', host: null };
}

/** Text for tables and charts: "Other" shows its host ("Other (example.org)"), never "undefined". */
function sourceLabel(d) {
  if (!d || !d.channel) return 'Direct';
  return d.channel === 'Other' && d.host ? `Other (${d.host})` : d.channel;
}

module.exports = { detectSource, sourceLabel, channelFromSource, channelFromHost, inAppBrowser, clickIdPresence, CHANNELS, ALL_CLICK_IDS };
