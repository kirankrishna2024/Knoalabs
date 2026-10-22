// Small, dependency-free user-agent reader: device type, OS, browser, in-app browser, webview, bot.
// The user agent is read here and only these labels are stored (never the raw string with a visitor).
const { inAppBrowser } = require('./sources');

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|telegrambot|skypeuripreview|slack|discord|embedly|pingdom|uptime|monitor|lighthouse|headless|phantom|puppeteer|playwright|curl\/|wget|python-requests|axios|go-http|java\//i;

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
  const t = [
    [/SamsungBrowser\/([\d.]+)/i, 'Samsung Internet'], [/EdgA?\/([\d.]+)|Edg\/([\d.]+)/i, 'Edge'], [/OPR\/([\d.]+)|Opera\/([\d.]+)/i, 'Opera'],
    [/UCBrowser\/([\d.]+)/i, 'UC Browser'], [/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/i, 'Firefox'], [/CriOS\/([\d.]+)/i, 'Chrome'],
    [/Chrome\/([\d.]+)/i, 'Chrome'], [/Version\/([\d.]+).*Safari/i, 'Safari']
  ];
  for (const [re, name] of t) {
    const m = re.exec(ua);
    if (m) return { browser: name, browser_version: String(m[1] || m[2] || '').split('.')[0] || null };
  }
  return { browser: null, browser_version: null };
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
  return { bot: !ua || BOT.test(ua), device_type: deviceOf(ua), ...osOf(ua), ...browserOf(ua), in_app: app ? app.app : null, is_webview: Boolean(app) || webview };
}

module.exports = { parseUserAgent, BOT };
