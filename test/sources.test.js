// Source detection: a table of utm / click-id / in-app / referrer cases across every listed channel.
// Run: node test/sources.test.js
const assert = require('assert');
const S = require('../src/sources');
let n = 0; const ok = (m) => console.log(`  ✓ SR${++n}. ${m}`);
let _niceChannel = null;
try { _niceChannel = require('../src/analytics').niceChannel; } catch (e) { /* analytics.js not loadable here */ }
const niceChannel = _niceChannel;

const UA = {
  ig: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/21A329 Instagram 310.0.0.24.109 (iPhone14,2; iOS 17_0)',
  fb: 'Mozilla/5.0 (Linux; Android 13; SM-A546E; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.30.113;]',
  msg: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/21A329 [FBAN/MessengerForiOS;FBAV/430.0;FBBV/1]',
  li: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 LinkedInApp/9.30.1',
  tg: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 Telegram-Android/10.2.0',
  wa: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.23.20.1 A',
  tt: 'Mozilla/5.0 (Linux; Android 12; Redmi) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 BytedanceWebview/d8a21c6',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  gpt: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ChatGPT/1.2025.310',
  plx: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/121.0.0.0 Mobile Safari/537.36 Perplexity/1.20.5',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

// [label, input, expected channel, expected method, expected host]
const CASES = [
  // ---- 1. explicit utm_source (synonyms) ----
  ['utm meta', { utm_source: 'meta' }, 'Meta', 'utm'],
  ['utm facebook', { utm_source: 'Facebook' }, 'Meta', 'utm'],
  ['utm ig', { utm_source: 'ig' }, 'Meta', 'utm'],
  ['utm fb ads', { utm_source: 'facebook-ads' }, 'Meta', 'utm'],
  ['utm google', { utm_source: 'google' }, 'Google', 'utm'],
  ['utm google ads', { utm_source: 'google_ads' }, 'Google', 'utm'],
  ['utm adwords', { utm_source: 'adwords' }, 'Google', 'utm'],
  ['utm youtube', { utm_source: 'youtube' }, 'YouTube', 'utm'],
  ['utm yt', { utm_source: 'yt' }, 'YouTube', 'utm'],
  ['utm email', { utm_source: 'email' }, 'Email', 'utm'],
  ['utm newsletter', { utm_source: 'newsletter' }, 'Email', 'utm'],
  ['utm mailchimp', { utm_source: 'Mailchimp' }, 'Email', 'utm'],
  ['utm linkedin', { utm_source: 'linkedin' }, 'LinkedIn', 'utm'],
  ['utm telegram', { utm_source: 'telegram' }, 'Telegram', 'utm'],
  ['utm whatsapp', { utm_source: 'whatsapp' }, 'WhatsApp', 'utm'],
  ['utm chatgpt', { utm_source: 'chatgpt.com' }, 'ChatGPT / AI', 'utm'],
  ['utm perplexity', { utm_source: 'perplexity' }, 'ChatGPT / AI', 'utm'],
  ['utm gemini', { utm_source: 'gemini' }, 'ChatGPT / AI', 'utm'],
  ['utm claude', { utm_source: 'claude' }, 'ChatGPT / AI', 'utm'],
  ['utm qwen', { utm_source: 'qwen' }, 'ChatGPT / AI', 'utm'],
  ['utm grok', { utm_source: 'grok' }, 'ChatGPT / AI', 'utm'],
  ['utm ai_agent (the tag AI chats add)', { utm_source: 'ai_agent' }, 'ChatGPT / AI', 'utm'],
  ['utm x', { utm_source: 'x' }, 'X / Twitter', 'utm'],
  ['utm twitter', { utm_source: 'twitter' }, 'X / Twitter', 'utm'],
  ['utm reddit', { utm_source: 'reddit' }, 'Reddit', 'utm'],
  ['utm bing', { utm_source: 'bing' }, 'Bing', 'utm'],
  ['utm duckduckgo', { utm_source: 'duckduckgo' }, 'Other search', 'utm'],
  ['utm custom stays readable', { utm_source: 'college-fair' }, 'College-fair', 'utm'],
  ['utm unknown + medium email', { utm_source: 'oct-blast', utm_medium: 'email' }, 'Email', 'utm'],
  // utm beats everything else
  ['utm beats click id and in-app', { utm_source: 'google', clickIds: { fbclid: true }, userAgent: UA.ig, referrer: 'https://l.instagram.com/' }, 'Google', 'utm'],
  // the tag is an explicit statement of the channel: it wins over the app the link happened to be opened in (decided rule)
  ['utm meta wins over the WhatsApp app', { utm_source: 'meta', userAgent: UA.wa }, 'Meta', 'utm'],
  ['utm meta wins over the WhatsApp referrer', { utm_source: 'meta', referrer: 'android-app://com.whatsapp' }, 'Meta', 'utm'],
  ['utm whatsapp wins over a plain desktop browser', { utm_source: 'whatsapp', userAgent: UA.chrome }, 'WhatsApp', 'utm'],
  ['unfilled macro is ignored', { utm_source: '{{site_source_name}}', userAgent: UA.ig }, 'Meta', 'in_app'],
  // ---- 2. click ids ----
  ['fbclid', { clickIds: { fbclid: true } }, 'Meta', 'click_id'],
  ['gclid', { clickIds: { gclid: true } }, 'Google', 'click_id'],
  ['gbraid', { clickIds: { gbraid: true } }, 'Google', 'click_id'],
  ['wbraid', { clickIds: { wbraid: true } }, 'Google', 'click_id'],
  ['msclkid', { clickIds: { msclkid: true } }, 'Bing', 'click_id'],
  ['li_fat_id', { clickIds: { li_fat_id: true } }, 'LinkedIn', 'click_id'],
  ['ttclid', { clickIds: { ttclid: true } }, 'TikTok', 'click_id'],
  ['click id beats in-app and referrer', { clickIds: { gclid: true }, userAgent: UA.fb, referrer: 'https://www.facebook.com/' }, 'Google', 'click_id'],
  // ---- 3. in-app browsers ----
  ['in-app Instagram', { userAgent: UA.ig }, 'Meta', 'in_app'],
  ['in-app Facebook', { userAgent: UA.fb }, 'Meta', 'in_app'],
  ['in-app Messenger', { userAgent: UA.msg }, 'Meta', 'in_app'],
  ['in-app LinkedIn', { userAgent: UA.li }, 'LinkedIn', 'in_app'],
  ['in-app Telegram', { userAgent: UA.tg }, 'Telegram', 'in_app'],
  ['in-app WhatsApp', { userAgent: UA.wa }, 'WhatsApp', 'in_app'],
  ['in-app WhatsApp: utm wins over in-app', { utm_source: 'meta', userAgent: UA.wa }, 'Meta', 'utm'],
  ['in-app TikTok', { userAgent: UA.tt }, 'TikTok', 'in_app'],
  ['in-app ChatGPT', { userAgent: UA.gpt }, 'ChatGPT / AI', 'in_app'],
  ['in-app Perplexity', { userAgent: UA.plx }, 'ChatGPT / AI', 'in_app'],
  ['in-app AI app beats nothing at all', { userAgent: UA.gpt, referrer: '' }, 'ChatGPT / AI', 'in_app'],
  ['in-app beats referrer', { userAgent: UA.li, referrer: 'https://www.google.com/' }, 'LinkedIn', 'in_app'],
  // ---- 3b. Android-app referrer (package names as host) ----
  // Android-app intent packages: Chrome keeps the package that opened the link even when the app's own browser gives no
  // user-agent token, so these are the fallback that makes a tap inside WhatsApp / Facebook / Telegram / LinkedIn / ...
  // still attributed. The host field is the android-app:// URL itself (the package is the only signal).
  // android-app:// referrers: Chrome preserves the package that opened the link; that package is the signal. It is stored as
  // the host (the package name), so it matches the same "how it was found" as any other channel's referrer host.
  ['ref android-app://com.whatsapp', { referrer: 'android-app://com.whatsapp' }, 'WhatsApp', 'referrer', 'com.whatsapp'],
  ['ref android-app://com.whatsapp.w4b', { referrer: 'android-app://com.whatsapp.w4b' }, 'WhatsApp', 'referrer', 'com.whatsapp.w4b'],
  ['ref android-app://com.facebook.katana', { referrer: 'android-app://com.facebook.katana' }, 'Meta', 'referrer', 'com.facebook.katana'],
  ['ref android-app://com.instagram.android', { referrer: 'android-app://com.instagram.android' }, 'Meta', 'referrer', 'com.instagram.android'],
  ['ref android-app://org.telegram.messenger', { referrer: 'android-app://org.telegram.messenger' }, 'Telegram', 'referrer', 'org.telegram.messenger'],
  ['ref android-app://com.openai.chatgpt', { referrer: 'android-app://com.openai.chatgpt' }, 'ChatGPT / AI', 'referrer', 'com.openai.chatgpt'],
  ['ref android-app://com.google.android.googlequicksearchbox', { referrer: 'android-app://com.google.android.googlequicksearchbox' }, 'Google', 'referrer', 'com.google.android.googlequicksearchbox'],
  ['ref android-app://com.linkedin.android', { referrer: 'android-app://com.linkedin.android' }, 'LinkedIn', 'referrer', 'com.linkedin.android'],
  ['ref android-app://com.snapchat.android', { referrer: 'android-app://com.snapchat.android' }, 'Snapchat', 'referrer', 'com.snapchat.android'],
  ['ref android-app://com.pinterest', { referrer: 'android-app://com.pinterest' }, 'Pinterest', 'referrer', 'com.pinterest'],
  ['ref android-app://com.twitter.android', { referrer: 'android-app://com.twitter.android' }, 'X / Twitter', 'referrer', 'com.twitter.android'],
  ['ref android-app://com.zhiliaoapp.musically', { referrer: 'android-app://com.zhiliaoapp.musically' }, 'TikTok', 'referrer', 'com.zhiliaoapp.musically'],
  ['ref android-app://com.google.android.gm', { referrer: 'android-app://com.google.android.gm' }, 'Email', 'referrer', 'com.google.android.gm'],
  ['ref android-app://com.google.android.youtube', { referrer: 'android-app://com.google.android.youtube' }, 'YouTube', 'referrer', 'com.google.android.youtube'],
  ['ref android-app://com.whatsapp (plain Chrome UA, intent from a chat)', { userAgent: UA.chrome, referrer: 'android-app://com.whatsapp' }, 'WhatsApp', 'referrer', 'com.whatsapp'],
  ['ref android-app://an app we do not know', { referrer: 'android-app://com.example.chat' }, 'Other', 'referrer', 'com.example.chat'],
  // ---- 4. referrer hosts ----
  ['ref l.instagram.com', { userAgent: UA.safari, referrer: 'https://l.instagram.com/?u=x' }, 'Meta', 'referrer', 'l.instagram.com'],
  ['ref m.facebook.com', { referrerHost: 'm.facebook.com' }, 'Meta', 'referrer', 'm.facebook.com'],
  ['ref google search', { referrer: 'https://www.google.com/' }, 'Google', 'referrer', 'google.com'],
  ['ref google.co.in', { referrer: 'https://www.google.co.in/search?q=x' }, 'Google', 'referrer', 'google.co.in'],
  ['ref youtube', { referrer: 'https://www.youtube.com/watch?v=1' }, 'YouTube', 'referrer', 'youtube.com'],
  ['ref gmail', { referrer: 'https://mail.google.com/mail/u/0/' }, 'Email', 'referrer', 'mail.google.com'],
  ['ref outlook', { referrer: 'https://outlook.live.com/' }, 'Email', 'referrer', 'outlook.live.com'],
  ['ref yahoo mail', { referrer: 'https://mail.yahoo.com/' }, 'Email', 'referrer', 'mail.yahoo.com'],
  ['ref mailchimp host', { referrer: 'https://mailchi.mp/abc/oct' }, 'Email', 'referrer', 'mailchi.mp'],
  ['ref linkedin', { referrer: 'https://www.linkedin.com/feed/' }, 'LinkedIn', 'referrer', 'linkedin.com'],
  ['ref lnkd.in', { referrer: 'https://lnkd.in/abc' }, 'LinkedIn', 'referrer', 'lnkd.in'],
  ['ref t.me', { referrer: 'https://t.me/channel' }, 'Telegram', 'referrer', 't.me'],
  ['ref wa.me', { referrer: 'https://wa.me/9198' }, 'WhatsApp', 'referrer', 'wa.me'],
  ['ref web.whatsapp.com', { referrer: 'https://web.whatsapp.com/' }, 'WhatsApp', 'referrer', 'web.whatsapp.com'],
  ['ref whatsapp.com', { referrer: 'https://whatsapp.com/' }, 'WhatsApp', 'referrer', 'whatsapp.com'],
  ['ref api.whatsapp.com', { referrer: 'https://api.whatsapp.com/' }, 'WhatsApp', 'referrer', 'api.whatsapp.com'],
  ['ref chatgpt.com', { referrer: 'https://chatgpt.com/' }, 'ChatGPT / AI', 'referrer', 'chatgpt.com'],
  ['ref chat.openai.com', { referrer: 'https://chat.openai.com/c/1' }, 'ChatGPT / AI', 'referrer', 'chat.openai.com'],
  ['ref perplexity', { referrer: 'https://www.perplexity.ai/search/x' }, 'ChatGPT / AI', 'referrer', 'perplexity.ai'],
  ['ref aistudio.google.com', { referrer: 'https://aistudio.google.com/prompts' }, 'ChatGPT / AI', 'referrer', 'aistudio.google.com'],
  ['ref character.ai', { referrer: 'https://character.ai/' }, 'ChatGPT / AI', 'referrer', 'character.ai'],
  ['ref gemini', { referrer: 'https://gemini.google.com/app' }, 'ChatGPT / AI', 'referrer', 'gemini.google.com'],
  ['ref copilot', { referrer: 'https://copilot.microsoft.com/' }, 'ChatGPT / AI', 'referrer', 'copilot.microsoft.com'],
  ['ref claude.ai', { referrer: 'https://claude.ai/chat/1' }, 'ChatGPT / AI', 'referrer', 'claude.ai'],
  ['ref deepseek', { referrer: 'https://chat.deepseek.com/' }, 'ChatGPT / AI', 'referrer', 'chat.deepseek.com'],
  ['ref t.co', { referrer: 'https://t.co/abc' }, 'X / Twitter', 'referrer', 't.co'],
  ['ref x.com', { referrer: 'https://x.com/home' }, 'X / Twitter', 'referrer', 'x.com'],
  ['ref reddit', { referrer: 'https://www.reddit.com/r/india/' }, 'Reddit', 'referrer', 'reddit.com'],
  ['ref bing', { referrer: 'https://www.bing.com/search?q=x' }, 'Bing', 'referrer', 'bing.com'],
  ['ref duckduckgo', { referrer: 'https://duckduckgo.com/' }, 'Other search', 'referrer', 'duckduckgo.com'],
  ['ref unknown host shows host', { referrer: 'https://blog.example.org/post' }, 'Other', 'referrer', 'blog.example.org'],
  ['ref wa.me (whatsapp in-app runs first because UA has the app token)', { userAgent: UA.wa, referrer: 'https://wa.me/9198' }, 'WhatsApp', 'in_app'],
  ['ref web.whatsapp.com + plain chrome UA (no app token) uses the referrer host', { userAgent: UA.chrome, referrer: 'https://web.whatsapp.com/' }, 'WhatsApp', 'referrer', 'web.whatsapp.com'],
  // ---- 5. direct and edge cases ----
  ['no evidence = Direct', { userAgent: UA.chrome }, 'Direct', 'direct'],
  ['own site referrer is not a source', { referrer: 'https://masterclass.example.com/cyber', ownHost: 'masterclass.example.com' }, 'Direct', 'direct'],
  ['malformed referrer', { referrer: 'not a url' }, 'Direct', 'direct'],
  ['empty input', {}, 'Direct', 'direct'],
  ['undefined input', undefined, 'Direct', 'direct'],
  ['control characters in utm are cleaned', { utm_source: 'goo\u0000gle' }, 'Goo gle', 'utm'],
  ['very long custom utm is capped', { utm_source: 'z'.repeat(300) }, 'z'.repeat(27) + '…', 'utm']   // same as analytics.niceChannel: truncated, not capitalised
];
for (const [label, input, channel, method, host] of CASES) {
  const r = S.detectSource(input);
  assert.strictEqual(r.channel, channel, `${label}: channel ${r.channel} != ${channel}`);
  assert.strictEqual(r.method, method, `${label}: method ${r.method} != ${method}`);
  if (host !== undefined) assert.strictEqual(r.host, host, `${label}: host`);
}
ok(`${CASES.length} utm / click-id / in-app / referrer / direct cases give the expected channel and method (priority order utm > click id > in-app > referrer)`);
const channels = new Set(CASES.map((c) => c[2]));
for (const need of ['Meta', 'Google', 'YouTube', 'Email', 'LinkedIn', 'Telegram', 'WhatsApp', 'ChatGPT / AI', 'X / Twitter', 'Reddit', 'Bing', 'Other search', 'Direct', 'Other']) assert(channels.has(need), 'no case for ' + need);
ok('every channel named in the requirement has at least one case (Meta, Google, YouTube, Email, LinkedIn, Telegram, WhatsApp, ChatGPT/AI, X, Reddit, Bing, other search, Direct, Other)');

/* labels never say "undefined" */
for (const [, input] of CASES) { const r = S.detectSource(input); const l = S.sourceLabel(r); assert(l && !/undefined|null|NaN/.test(l), l); }
assert.strictEqual(S.sourceLabel(S.detectSource({ referrer: 'https://blog.example.org/' })), 'Other (blog.example.org)');
assert.strictEqual(S.sourceLabel(undefined), 'Direct');
ok('labels never contain "undefined"; an unknown referrer shows its host');

/* click ids are opaque: only presence is kept */
const q = new URLSearchParams('fbclid=IwAR0secretvalue&gclid=abc&x=1');
assert.deepStrictEqual(S.clickIdPresence(q), { fbclid: true, gclid: true });
assert.deepStrictEqual(S.clickIdPresence({ msclkid: 'zzz', other: 'a' }), { msclkid: true });
assert(!JSON.stringify(S.detectSource({ clickIds: S.clickIdPresence(q) })).includes('secretvalue'));
ok('click ids are reduced to presence flags; their values never reach the result');

/* parity with analytics.niceChannel for channels it already names */
const SAME = { instagram: 'Meta', facebook: 'Meta', fb: 'Meta', meta: 'Meta', google: 'Google', youtube: 'YouTube', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', twitter: 'X / Twitter', telegram: 'Telegram', bing: 'Bing' };
if (_niceChannel) { for (const [raw, name] of Object.entries(SAME)) { assert.strictEqual(niceChannel(raw), name); assert.strictEqual(S.channelFromSource(raw), name); } ok('for the channels analytics.js already names, src/sources.js returns the same label (existing charts keep their wording)'); } else { ok('niceChannel parity skipped (analytics.js not loadable here); detection + label cases still run'); }


/* a decoy cannot fake a stronger source through the user agent alone */
assert.strictEqual(S.detectSource({ userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/120 Safari/537.36 FakeInstagramFan' }).channel, 'Direct');
ok('a user agent that only contains part of a word (not the real app token) is not an in-app browser');

/* every AI assistant app is named in the browser list and counted as ONE channel */
const AI_APP_UA = {
  ChatGPT: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ChatGPT/1.2025.310',
  Perplexity: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Perplexity/1.20.5',
  Claude: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Claude/2.1.0',
  Copilot: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Copilot/31.4.1',
  Gemini: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Gemini/1.0.1',
  DeepSeek: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 DeepSeek/1.0.0',
  Grok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Grok/1.4.0',
  Qwen: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Qwen/3.0.0',
  Poe: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Poe/2.0.1'
};
for (const [app, ua] of Object.entries(AI_APP_UA)) {
  assert.deepStrictEqual(S.inAppBrowser(ua), { app, channel: 'ChatGPT / AI' }, app);
  assert.strictEqual(S.detectSource({ userAgent: ua }).channel, 'ChatGPT / AI', app);
}
assert.deepStrictEqual(S.inAppBrowser('Mozilla/5.0 (Linux) Chrome/121 Mobile Safari/537.36 GoogleApp/15.0'), { app: 'Google app', channel: 'Google' });
ok('ChatGPT, Perplexity, Claude, Copilot, Gemini, DeepSeek, Grok, Qwen and Poe openers are named as that app and all count as one "ChatGPT / AI" source (the Google app still counts as Google)');

console.log(`\nAll ${n} source detection checks passed`);
