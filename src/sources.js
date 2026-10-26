// Where did a visit / lead come from? One data-driven table, easy to extend. Pure and dependency free.
//
// Priority (first match wins):
//   1. utm_source        normalised through the synonym table below (method "utm")
//   2. click id          fbclid -> Meta, gclid/gbraid/wbraid -> Google, msclkid -> Bing, li_fat_id -> LinkedIn, ttclid -> TikTok (method "click_id")
//                        Click ids are opaque: callers pass presence flags only, the value is never read or stored.
//   2b. utm_medium=qr / whatsapp (when no utm_source says it)
//   3. in-app browser    the user agent of the Instagram / Facebook / Messenger / LinkedIn / Telegram / WhatsApp / TikTok app, or of an AI assistant (ChatGPT / Gemini / Claude / Perplexity ...) (method "in_app")
//   4. referrer host     l.instagram.com, mail.google.com, chatgpt.com ... (method "referrer")
//                        A link opened from an Android app arrives with `Referer: android-app://com.whatsapp` (Chrome keeps the
//                        package that sent the intent, even when the app browser itself sends nothing): the package names below
//                        are listed like any other host, so a link shared in WhatsApp / Facebook / Telegram / LinkedIn ... is
//                        still attributed when the user agent gives nothing away.
//   5. nothing           "Direct" (method "direct"); a host we do not know is "Other" and keeps its host name (never "undefined")
// Channel names for the channels analytics.js already knows (Meta, Google, YouTube, WhatsApp, LinkedIn, X / Twitter, Telegram, Bing) are
// identical to analytics.niceChannel, so existing charts keep their labels (test/sources.test.js checks this).
// Facebook vs Instagram is NOT decided here: that stays in src/meta.js (detectMeta); one "Meta" channel covers both.

const CHANNELS = [
  // name, utm_source synonyms, referrer host suffixes, click ids, in-app user-agent
  { name: 'Meta', utm: /^(meta|facebook|fb|instagram|ig|messenger|msg|an|audience[\s_.-]?network|facebook[\s_.-]?ads|instagram[\s_.-]?ads)$/i,
    hosts: ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'messenger.com', 'l.facebook.com', 'm.facebook.com', 'lm.facebook.com', 'com.facebook.katana', 'com.instagram.android', 'com.facebook.orca', 'com.facebook.lite'], clickIds: ['fbclid'], inApp: /\bInstagram\b|FBAN\/|FBAV\/|FB_IAB\/|FBIOS|FB4A|Messenger/i },
  { name: 'YouTube', utm: /^(youtube|yt|youtu\.?be)$/i,
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'com.google.android.youtube'] },
  { name: 'Google', utm: /^(google|google[\s_.-]?(ads|search|adwords)|adwords|gads|googleads)$/i,
    hosts: ['google.com', 'google.co.in', 'google.co.uk', 'google.ae', 'google.ca', 'google.com.au', 'google.com.sg', 'googleadservices.com', 'googlesyndication.com', 'g.co', 'com.google.android.googlequicksearchbox'],
    clickIds: ['gclid', 'gbraid', 'wbraid'], hostRe: /(^|\.)google\.[a-z.]{2,6}$/ },
  { name: 'Email', utm: /^(e-?mail|newsletter|mailchimp|sendgrid|mailer|gmail|outlook|yahoo[\s_.-]?mail|hubspot|brevo|sendinblue|klaviyo|substack|convertkit)$/i,
    hosts: ['mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'mail.yahoo.co.in', 'mail.proton.me', 'mailchi.mp', 'list-manage.com', 'sendgrid.net', 'substack.com', 'convertkit.com', 'hubspotemail.net', 'sendibt3.com', 'zoho.com', 'com.google.android.gm'] },
  { name: 'LinkedIn', utm: /^(linkedin|lnkd|lnkd\.in|li)$/i, hosts: ['linkedin.com', 'lnkd.in', 'com.linkedin.android'], clickIds: ['li_fat_id'], inApp: /LinkedInApp/i },
  { name: 'Telegram', utm: /^(telegram|tg|t\.me)$/i, hosts: ['t.me', 'telegram.org', 'web.telegram.org', 'telegram.me', 'org.telegram.messenger', 'org.telegram.messenger.web'], inApp: /\bTelegram\b/i },
  { name: 'WhatsApp', utm: /^(whatsapp|wa|wa\.me)$/i, hosts: ['wa.me', 'whatsapp.com', 'web.whatsapp.com', 'api.whatsapp.com', 'com.whatsapp', 'com.whatsapp.w4b'], inApp: /\bWhatsApp\b/i, androidPack: ['com.whatsapp', 'com.whatsapp.w4b'] },
  { name: 'ChatGPT / AI', utm: /^(chatgpt|openai|chat\.?gpt|perplexity|gemini|bard|copilot|claude|deepseek|grok|mistral|ai|llm|gpt|oai|anthropic|qwen|kimi|doubao|poe|character|aistudio|manus|genai|ai[\s_.-]?agent|ai[\s_.-]?bot|chatbot)$/i,
    hosts: ['chatgpt.com', 'chat.openai.com', 'openai.com', 'com.openai.chatgpt', 'perplexity.ai', 'com.perplexity.app', 'gemini.google.com', 'aistudio.google.com', 'notebooklm.google.com', 'copilot.microsoft.com', 'copilot.com', 'claude.ai', 'deepseek.com', 'chat.deepseek.com', 'you.com', 'poe.com', 'grok.com', 'x.ai', 'meta.ai', 'kimi.com', 'kimi.moonshot.cn', 'moonshot.cn', 'mistral.ai', 'chat.mistral.ai', 'phind.com', 'edgeservices.bing.com', 'character.ai', 'qwen.ai', 'chat.qwen.ai', 'doubao.com', 'manus.im'] },
  // The AI assistants that open the page in their own in-app browser are handled by inAppBrowser() below.
  { name: 'X / Twitter', utm: /^(t\.co|twitter|x|x\.com|tw)$/i, hosts: ['t.co', 'twitter.com', 'x.com', 'com.twitter.android'] },
  { name: 'Reddit', utm: /^(reddit)$/i,
    hosts: ['reddit.com', 'old.reddit.com', 'redd.it'] },  { name: 'TikTok', utm: /^(tiktok|tt)$/i,
    hosts: ['tiktok.com', 'com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], clickIds: ['ttclid'] },  { name: 'Bing', utm: /^(bing|msn|microsoft[\s_.-]?ads)$/i,
    hosts: ['bing.com', 'msn.com', 'cn.bing.com'], clickIds: ['msclkid'] },
  { name: 'QR scan', utm: /^(qr|qrcode|qr[\s_.-]?code|qr[\s_.-]?scan|scan|poster|print|flyer|standee|brochure)$/i, hosts: [] },
  { name: 'Short / bio link', utm: /^(bitly|bit\.ly|linktree|linktr\.ee|bio|biolink|link[\s_.-]?in[\s_.-]?bio|shortlink|short[\s_.-]?link|redirect)$/i,
    hosts: ['bit.ly', 'tinyurl.com', 't.ly', 'rb.gy', 'cutt.ly', 'is.gd', 'ow.ly', 'buff.ly', 'goo.gl', 'shorturl.at', 'rebrand.ly', 'linktr.ee', 'beacons.ai', 'bio.link', 'lnk.bio', 'taplink.cc', 'l.wl.co'] },  { name: 'Snapchat', utm: /^(snapchat|snap|sc)$/i,
    hosts: ['snapchat.com', 'com.snapchat.android'], clickIds: ['sccid'], inApp: /\bSnapchat\b/i },  { name: 'Pinterest', utm: /^(pinterest|pin)$/i,
    hosts: ['pinterest.com', 'pinterest.co.uk', 'in.pinterest.com', 'com.pinterest', 'pin.it'], inApp: /\bPinterest\b/i },
  { name: 'Quora', utm: /^(quora)$/i, hosts: ['quora.com'] },
  { name: 'Other search', utm: /^(duckduckgo|ddg|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|search)$/i,
    hosts: ['duckduckgo.com', 'search.yahoo.com', 'in.search.yahoo.com', 'yahoo.com', 'yandex.com', 'yandex.ru', 'baidu.com', 'ecosia.org', 'search.brave.com', 'startpage.com', 'qwant.com'] }
];
const ALL_CLICK_IDS = [...new Set(CHANNELS.flatMap((c) => c.clickIds || []))];
const MEDIUM_CHANNELS = [[/^(qr|qr[\s_.-]?code|qrcode|print)$/i, 'QR scan'], [/^(whatsapp|wa)$/i, 'WhatsApp'], [/^e-?mail$/i, 'Email']];   // utm_medium says it when utm_source does not
// The AI assistants with their own in-app browser: one pattern per app, all of them counted under the single "ChatGPT / AI"
// channel. Listed as that app in the browser list ("ChatGPT in-app browser"). Real apps only: an AI crawler is a bot (BOT in src/ua.js).
const AI_APPS = [[/\bChatGPT\b|\bOpenAI\b/i, 'ChatGPT'], [/\bPerplexity\b/i, 'Perplexity'], [/\bClaude\b/i, 'Claude'], [/\bCopilot\b/i, 'Copilot'],
  [/\bGemini\b/i, 'Gemini'], [/\bDeepSeek\b/i, 'DeepSeek'], [/\bGrok\b/i, 'Grok'], [/\bQwen\b/i, 'Qwen'], [/\bPoe\b/i, 'Poe']];

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

/** utm_medium text -> channel name for the few media that name a channel on their own (qr, whatsapp, email), else null. */
function channelFromMedium(raw) {
  const t = clean(String(raw == null ? '' : raw), 60);
  if (!t) return null;
  for (const [re, name] of MEDIUM_CHANNELS) if (re.test(t)) return name;
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
}  /** Android-app intent package name -> channel name, or null. Covers the chat / social / helper apps that open links and leave a
 *  Referer: android-app://<package> (Chrome keeps the package even when the app's browser itself sends no signal).
 *  Mapping lives on the channel, not in a separate list, so it stays with the rest of that channel's evidence.
 *  The returned host is the bare package name, not the full android-app:// URL — that is what the referrer-host table already
 *  uses and is what you see in "How the source was found".
 */
function channelFromAndroidPackage(pkg) {
  const p = pkg.trim().toLowerCase();
  if (!p) return null;
  for (const c of CHANNELS) {
    const want = (c.androidPack || []).map((x) => String(x).toLowerCase());
    if (want.length && want.includes(p)) return c.name;
  }
  return null;
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
  if (/\bSnapchat\b/i.test(s)) return { app: 'Snapchat', channel: 'Snapchat' };
  if (/\bPinterest\b/i.test(s)) return { app: 'Pinterest', channel: 'Pinterest' };
  if (/Twitter for|TwitterAndroid|\bTwitterWebView\b/i.test(s)) return { app: 'X / Twitter', channel: 'X / Twitter' };
  if (/MicroMessenger/i.test(s)) return { app: 'WeChat', channel: 'WeChat' };
  if (/\bLine\/\d/i.test(s)) return { app: 'Line', channel: 'Line' };
  // an AI assistant's own browser (ChatGPT, Gemini, Claude, Perplexity ...): often no referring site at all, so this is the only signal
  for (const [re, app] of AI_APPS) if (re.test(s)) return { app, channel: 'ChatGPT / AI' };
  if (/\bGSA\/\d|GoogleApp\//i.test(s)) return { app: 'Google app', channel: 'Google' };
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
    const byMedium = channelFromMedium(i.utm_medium);
    if (byMedium) return { channel: byMedium, method: 'utm', host: null };                                      // unknown source name, but the medium says email / QR / WhatsApp
    const label = utm.length > 28 ? utm.slice(0, 27) + '…' : titleCase(utm);
    return { channel: label, method: 'utm', host: null };                                                       // a custom tag stays readable, like analytics does today
  }
  const mediumOnly = channelFromMedium(i.utm_medium);
  if (mediumOnly && mediumOnly !== 'Email') return { channel: mediumOnly, method: 'utm', host: null };         // ?utm_medium=qr without a source: still a QR scan
  const ids = i.clickIds || {};
  for (const c of CHANNELS) if ((c.clickIds || []).some((k) => ids[k])) return { channel: c.name, method: 'click_id', host: null };
  // a link shared in a chat: Chrome keeps the Android package that opened it, even when the app's own browser gives no
  // user-agent token and the referrer is a bare android-app:// URL with no hostname. Map those packages directly to their
  // channel so a tap inside WhatsApp / Facebook / Telegram / LinkedIn / ... is still attributed. The host we store is the
  // package name, not the full android-app:// URL — that is what the referrer-host table already uses and is what appears in
  // "How the source was found".
  const androidRef = clean(i.referrer, 300);
  if (androidRef && androidRef.startsWith('android-app://')) {
    const pkg = androidRef.slice('android-app://'.length).split('/')[0];
    if (pkg) {
      const byPkg = channelFromAndroidPackage(pkg);
      if (byPkg) return { channel: byPkg, method: 'referrer', host: pkg };
    }
  }
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

module.exports = { channelFromMedium, detectSource, sourceLabel, channelFromSource, channelFromHost, inAppBrowser, clickIdPresence, CHANNELS, ALL_CLICK_IDS };
