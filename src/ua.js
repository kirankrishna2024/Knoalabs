// Small, dependency-free user-agent reader: device type, OS, browser, in-app browser, webview, bot.
// The user agent is read here and only these labels are stored (never the raw string with a visitor).
const { inAppBrowser } = require('./sources');

// "whatsapp/" only at the START of the string: that is WhatsApp's own link-preview crawler ("WhatsApp/2.23.20 A").
// A person reading the link inside the WhatsApp app sends a real browser user agent that merely ENDS with
// "... Safari/537.36 WhatsApp/2.23.20.1 A" and must never be treated as a bot (the campaign redirect, the tracker
// and the open counter all ask this table first, so a wrong answer here hides every WhatsApp visit).
// The AI crawlers are named explicitly: they have no "bot" in their name (anthropic-ai, google-extended, chatgpt-user ...),
// while an AI assistant's own app browser ("... ChatGPT/1.2025.310") is a person and is detected by src/sources.js.
// "slack" / "discord" / "telegram" are only their link-preview fetchers (Slackbot, Discordbot, TelegramBot): the app's own
// browser must stay a person, or a link shared in a chat is never tracked or redirected.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|^\s*whatsapp\/|chatgpt-user|anthropic-ai|claude-web|google-extended|meta-externalagent|cohere-ai|ai2bot|telegrambot|skypeuripreview|slackbot|discordbot|embedly|pingdom|uptime|monitor|lighthouse|headless|phantom|puppeteer|playwright|curl\/|wget|python-requests|axios|go-http|java\//i;

function osOf(ua) {
  let m;
  if ((m = /Android[ /]([\d.]+)/i.exec(ua))) return { os: 'Android', os_version: m[1].split('.').slice(0, 2).join('.') };
  if ((m = /(iPhone|iPad|iPod).*? OS ([\d_]+)/i.exec(ua))) return { os: 'iOS', os_version: m[2].split('_').slice(0, 2).join('.') };
  if (/iPhone|iPad|iPod/i.test(ua)) return { os: 'iOS', os_version: null };
  if ((m = /Windows NT ([\d.]+)/i.exec(ua))) return { os: 'Windows', os_version: { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m[1]] || m[1] };
  if ((m = /Mac OS X ([\d_.]+)/i.exec(ua))) return { os: 'macOS', os_version: m[1].replace(/_/g, '.').split('.').slice(0, 2).join('.') };
  if (/CrOS/i.test(ua)) return { os: 'ChromeOS', os_version: null };
  if (/Linux|X11/i.test(ua)) return { os: 'Linux', os_version: null };
  return { os: null, os_version: null };
}

function browserOf(ua) {
  // most specific first: a lot of browsers carry the word "Chrome" or "Safari" as well
  const t = [
    [/SamsungBrowser\/([\d.]+)/i, 'Samsung Internet'], [/EdgA?\/([\d.]+)|Edg\/([\d.]+)|EdgiOS\/([\d.]+)/i, 'Edge'], [/OPR\/([\d.]+)|Opera\/([\d.]+)|OPT\/([\d.]+)|OPiOS\/([\d.]+)/i, 'Opera'],
    [/UCBrowser\/([\d.]+)/i, 'UC Browser'], [/MiuiBrowser\/([\d.]+)/i, 'Mi Browser'], [/HuaweiBrowser\/([\d.]+)/i, 'Huawei Browser'], [/YaBrowser\/([\d.]+)/i, 'Yandex'],
    [/Vivaldi\/([\d.]+)/i, 'Vivaldi'], [/DuckDuckGo\/([\d.]+)/i, 'DuckDuckGo'], [/Brave\/([\d.]+)/i, 'Brave'], [/Focus\/([\d.]+)/i, 'Firefox Focus'],
    [/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/i, 'Firefox'], [/CriOS\/([\d.]+)/i, 'Chrome'], [/Chrome\/([\d.]+)/i, 'Chrome'], [/Version\/([\d.]+).*Safari/i, 'Safari']
  ];
  for (const [re, name] of t) {
    const m = re.exec(ua);
    if (m) return { browser: name, browser_version: String(m.slice(1).find(Boolean) || '').split('.')[0] || null };
  }
  // an iPhone / iPad web view (an app's own browser) has WebKit but no "Safari" word
  if (/(iPhone|iPad|iPod).*AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) return { browser: 'iOS web view', browser_version: null };
  return { browser: null, browser_version: null };
}

/** The label for browser lists: the app's own browser when the link was opened inside an app ("Instagram in-app browser"),
 *  else the real browser ("Chrome"). Works on a parsed user agent or on the stored browser / in_app columns. */
function browserLabel(x) {
  const o = x || {};
  if (o.in_app) return `${o.in_app} in-app browser`;
  if (o.is_webview && !o.browser) return 'Android web view';
  return o.browser || 'Unknown';
}

function deviceOf(ua) {
  if (/ipad|tablet|playbook|silk|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  return ua ? 'desktop' : null;
}

/** @returns {{bot:boolean, device_type, os, os_version, browser, browser_version, in_app, is_webview}} */
function parseUserAgent(raw) {
  const ua = String(raw || '').slice(0, 400);
  const app = inAppBrowser(ua);
  const webview = /; wv\)|WebView/i.test(ua);
  const b = browserOf(ua);
  if (webview && !app && b.browser === 'Chrome' && /; wv\)/i.test(ua)) b.browser = 'Android web view';      // Chrome's engine inside some app that is not one we know by name
  return { bot: !ua || BOT.test(ua), device_type: deviceOf(ua), ...osOf(ua), ...b, in_app: app ? app.app : null, is_webview: Boolean(app) || webview };
}

module.exports = { parseUserAgent, browserLabel, BOT };
