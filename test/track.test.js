// Visitor / session / event tracking (POST /api/track), the user-agent reader and privacy. Run: node test/track.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '500'; process.env.GEO_IP_SALT = 'a-long-random-salt-for-tests';
const assert = require('assert');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms');
const { parseUserAgent } = require('../src/ua');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ T${++n}. ${m}`);
const UA = {
  pixel: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  ig: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/21A329 Instagram 310.0.0.24.109 (iPhone14,2; iOS 17_0)',
  fb: 'Mozilla/5.0 (Linux; Android 12; SM-G991B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0]',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ff: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', curl: 'curl/8.4.0', preview: 'facebookexternalhit/1.1', headless: 'Mozilla/5.0 HeadlessChrome/120.0.0.0 Safari/537.36'
};
(async () => {
  const P = (k) => parseUserAgent(UA[k]);
  assert.deepStrictEqual([P('pixel').device_type, P('pixel').os, P('pixel').os_version, P('pixel').browser, P('pixel').browser_version, P('pixel').in_app], ['mobile', 'Android', '13', 'Chrome', '120', null]);
  assert.deepStrictEqual([P('iphone').device_type, P('iphone').os, P('iphone').os_version, P('iphone').browser], ['mobile', 'iOS', '17.2', 'Safari']);
  assert.deepStrictEqual([P('win').device_type, P('win').os, P('win').os_version, P('win').browser], ['desktop', 'Windows', '10/11', 'Edge']);
  assert.deepStrictEqual([P('mac').os, P('mac').os_version, P('mac').browser], ['macOS', '10.15', 'Safari']); assert.deepStrictEqual([P('ff').os, P('ff').browser, P('ff').device_type], ['Linux', 'Firefox', 'desktop']);
  assert.strictEqual(P('ipad').device_type, 'tablet'); assert.strictEqual(P('samsung').browser, 'Samsung Internet');
  ok('user agents: device type, OS + version, browser + major version for phones, a tablet, Windows / Edge, macOS / Safari, Linux / Firefox, Samsung Internet');
  assert.strictEqual(P('ig').in_app, 'Instagram'); assert(P('ig').is_webview); assert.strictEqual(P('fb').in_app, 'Facebook'); assert(P('fb').is_webview); assert(!P('pixel').is_webview && !P('win').is_webview); ok('in-app browsers (Instagram, Facebook) and Android webviews are recognised; ordinary browsers are not');
  for (const k of ['bot', 'curl', 'preview', 'headless']) assert(P(k).bot, k); assert(parseUserAgent('').bot && !P('pixel').bot); ok('crawlers, link previews, scripts, headless browsers and an empty user agent are bots');
  assert.deepStrictEqual(Object.keys(parseUserAgent('x'.repeat(5000))).sort(), ['bot', 'browser', 'browser_version', 'device_type', 'in_app', 'is_webview', 'os', 'os_version'].sort()); ok('absurdly long or odd user agents are read safely');

  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  const track = (body, ua = UA.pixel, extra = {}) => fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': ua, ...extra }, body: JSON.stringify(body) });
  const key = (i) => `evt-${String(i).padStart(4, '0')}-abcdefghij`;
  const batch = (over = {}) => ({ vid: 'visitor-aaaa-1111', sid: 'session-aaaa-1111', course: 'datascience', utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'ds-reels', referrer: 'https://l.instagram.com/x?secret=1', landing: '/datascience', lang: 'en-IN', tz: 'Asia/Kolkata', screen: '390x844',
    events: [{ k: key(1), t: 'page_view', d: { form_version: 1 } }, { k: key(2), t: 'form_start', d: {} }, { k: key(3), t: 'field_focus', d: { field: 'first_name' } }], ...over });
  let r = await track(batch()); assert.strictEqual(r.status, 204);
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  let v = (await q('SELECT * FROM visitors'))[0]; assert.strictEqual(v.visitor_id, 'visitor-aaaa-1111'); assert.deepStrictEqual([v.device_type, v.os, v.browser, v.first_source, v.first_method, v.language, v.timezone, v.screen, v.referrer_host, v.visit_count, v.session_count], ['mobile', 'Android', 'Chrome', 'Meta', 'utm', 'en-IN', 'Asia/Kolkata', '390x844', 'l.instagram.com', 1, 1]);
  assert.strictEqual((await q('SELECT COUNT(*)::int n FROM visitor_events'))[0].n, 3); const s = (await q('SELECT * FROM sessions'))[0]; assert.strictEqual(s.session_id, 'session-aaaa-1111'); assert.strictEqual(s.course_slug, 'datascience'); assert.strictEqual(s.source_detected, 'Meta');
  ok('a batch stores one visitor (device, source, language, time zone, screen, referring host only), one session and its three events');
  await track(batch()); assert.strictEqual((await q('SELECT COUNT(*)::int n FROM visitor_events'))[0].n, 3); assert.strictEqual((await q('SELECT visit_count, session_count FROM visitors'))[0].visit_count, 1); ok('sending the same batch again stores nothing new (event keys are unique): no double counting on retries');
  await track(batch({ sid: 'session-aaaa-2222', events: [{ k: key(10), t: 'page_view', d: {} }] })); v = (await q('SELECT visit_count, session_count FROM visitors'))[0]; assert.deepStrictEqual([v.visit_count, v.session_count], [2, 2]); ok('a new session of the same visitor raises the visit count (2 visits); a reload inside a session does not');
  await track(batch({ vid: 'visitor-bbbb-2222', sid: 'session-bbbb-1111', events: [{ k: key(20), t: 'page_view', d: {} }] }), UA.ig); const v2 = (await q("SELECT * FROM visitors WHERE visitor_id='visitor-bbbb-2222'"))[0]; assert.strictEqual(v2.in_app, 'Instagram'); assert.strictEqual(v2.is_webview, true); assert.strictEqual(v2.os, 'iOS'); ok('an Instagram in-app visitor is stored with the app name');

  const before = (await q('SELECT COUNT(*)::int n FROM visitor_events'))[0].n;
  for (const ua of [UA.bot, UA.curl, UA.preview, UA.headless, '']) await track(batch({ vid: 'visitor-bot-0001', sid: 'session-bot-0001', events: [{ k: key(30), t: 'page_view', d: {} }] }), ua);
  assert.strictEqual((await q('SELECT COUNT(*)::int n FROM visitor_events'))[0].n, before); assert.strictEqual((await q("SELECT COUNT(*)::int n FROM visitors WHERE visitor_id='visitor-bot-0001'"))[0].n, 0); ok('bots, previews, scripts and headless browsers are not tracked');
  for (const bad of [{ vid: 'x' }, { sid: 'no spaces allowed' }, { events: [] }, { events: 'nope' }, { events: [{ k: 'short', t: 'page_view' }] }, { events: [{ k: key(40), t: 'drop_table' }] }, { course: '/wp-login' }, { course: 'nonexistent' }]) { r = await track(batch(bad)); assert.strictEqual(r.status, 204); }
  assert.strictEqual((await q('SELECT COUNT(*)::int n FROM visitor_events'))[0].n, before); r = await fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' }); assert([400, 204].includes(r.status)); ok('malformed ids, unknown event types, empty or broken batches and non-course paths store nothing and never error the page');
  await track(batch({ vid: 'visitor-cccc-3333', sid: 'session-cccc-1111', events: [{ k: key(50), t: 'submit_invalid', d: { fields: ['first_name', 'bad key!', 'phone'], value: 'SECRET', server: true, extra: { a: 1 } } }, { k: key(51), t: 'field_focus', d: { field: '<script>' } }] }));
  const evs = await q("SELECT type, detail FROM visitor_events WHERE visitor_id='visitor-cccc-3333' ORDER BY id"); const det = (e) => (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail);
  assert.deepStrictEqual(det(evs[0]).fields, ['first_name', 'phone']); assert.strictEqual(det(evs[0]).server, true); assert(!('value' in det(evs[0])) && !('extra' in det(evs[0]))); assert(!('field' in det(evs[1]))); ok('event details are rebuilt from a whitelist: field names only; typed values, nested data and odd names are dropped');
  const dump = JSON.stringify([await q('SELECT * FROM visitors'), await q('SELECT * FROM sessions'), await q('SELECT * FROM visitor_events')]); assert(!/Mozilla|Googlebot|secret=1|SECRET|127\.0\.0\.1|::1|::ffff/.test(dump)); const vv = (await q("SELECT ip_hash, ip_masked FROM visitors WHERE visitor_id='visitor-aaaa-1111'"))[0]; assert(/^[0-9a-f]{20,}$/.test(vv.ip_hash)); ok('privacy: no raw IP, no user agent string, no referrer path or query, no typed values anywhere in the tracking tables; the IP exists only as a salted hash');
  const ev = (a) => Array.from({ length: a }, (_, i) => ({ k: key(100 + i), t: 'field_focus', d: { field: 'phone' } })); await track(batch({ vid: 'visitor-dddd-4444', sid: 'session-dddd-1111', events: ev(50) })); assert.strictEqual((await q("SELECT COUNT(*)::int n FROM visitor_events WHERE visitor_id='visitor-dddd-4444'"))[0].n, 20); ok('at most 20 events are taken from one request');
  assert.strictEqual((await fetch(base + '/api/track')).status, 404); ok('the tracker is write-only: GET /api/track does not exist');

  // the WhatsApp in-app browser is a person, not a bot: /api/track, the campaign redirect and the open counter all read this same table
  const UA_WA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.23.20.1 A';
  assert.strictEqual(parseUserAgent(UA_WA).bot, false); assert.strictEqual(parseUserAgent(UA_WA).in_app, 'WhatsApp');
  assert.strictEqual(parseUserAgent('WhatsApp/2.23.20 A').bot, true);        // WhatsApp's own link-preview crawler
  ok('a user agent that merely ends with "WhatsApp/2.23.20.1 A" is a person; the bare "WhatsApp/2.23.20 A" crawler still is a bot');
  await track(batch({ vid: 'visitor-waaa-1111', sid: 'session-waaa-1111', utm_source: null, referrer: '', events: [{ k: key(60), t: 'page_view', d: {} }] }), UA_WA);
  const wv = (await q("SELECT * FROM visitors WHERE visitor_id='visitor-waaa-1111'"))[0];
  assert(wv && wv.in_app === 'WhatsApp' && wv.is_webview === true && wv.first_source === 'WhatsApp' && wv.first_method === 'in_app');
  const ws = (await q("SELECT * FROM sessions WHERE session_id='session-waaa-1111'"))[0]; assert(ws && ws.source_detected === 'WhatsApp' && ws.source_method === 'in_app');
  ok('a visit tracked from inside the WhatsApp app is stored (app, source, session) instead of being dropped as a bot');

  // AI: the crawlers are ignored, the assistant's own app is a person and counts as ChatGPT / AI
  const AI_BOTS = ['Mozilla/5.0 (compatible; anthropic-ai/1.0)', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Google-Extended',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) ChatGPT-User/1.0', 'Mozilla/5.0 (compatible; Claude-Web/1.0)', 'Mozilla/5.0 (compatible; meta-externalagent/1.1)'];
  for (const ua of AI_BOTS) assert(parseUserAgent(ua).bot, ua);
  const UA_GPT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ChatGPT/1.2025.310';
  assert.strictEqual(parseUserAgent(UA_GPT).bot, false); assert.strictEqual(parseUserAgent(UA_GPT).in_app, 'ChatGPT');
  ok('AI crawlers (anthropic-ai, Google-Extended, ChatGPT-User, Claude-Web, meta-externalagent) are bots; the ChatGPT app opening the link is a person');
  await track(batch({ vid: 'visitor-gpt-1111', sid: 'session-gpt-1111', utm_source: null, referrer: '', events: [{ k: key(70), t: 'page_view', d: {} }] }), UA_GPT);
  const gv = (await q("SELECT * FROM visitors WHERE visitor_id='visitor-gpt-1111'"))[0];
  assert(gv && gv.in_app === 'ChatGPT' && gv.first_source === 'ChatGPT / AI' && gv.first_method === 'in_app');
  ok('a visit from inside the ChatGPT app is stored under ChatGPT / AI (in-app browser) instead of being dropped as a bot');

  // lead -> visitor link, time to register, visit count
  const lead = await fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': UA.pixel }, body: JSON.stringify({ course: 'datascience', first_name: 'Asha', last_name: 'N', country: 'IN', phone: '9800000001', status: 'Working Professional', experience: '0-2 yrs', current_role: 'Product Manager', client_id: 'lead-client-0000001', visitor_id: 'visitor-aaaa-1111', session_id: 'session-aaaa-1111', utm_source: 'meta', utm_campaign: 'ds-reels' }) });
  assert.strictEqual(lead.status, 201); await new Promise((r2) => setTimeout(r2, 30)); const l = (await q("SELECT * FROM leads WHERE client_id='lead-client-0000001'"))[0]; assert.strictEqual(l.visit_count_before_signup, 2); assert(l.time_to_register_seconds >= 0 && l.time_to_register_seconds < 60); assert(/^[0-9a-f]{20,}$/.test(l.ip_hash)); assert.strictEqual(l.ip_version, 4); assert.strictEqual((await q("SELECT lead_count FROM visitors WHERE visitor_id='visitor-aaaa-1111'"))[0].lead_count, 1);
  ok('a registration carries the visitor id, how many visits came before it, the seconds from the first page view to the registration, an IP hash and version');
  server.close(); await db.close();
  console.log(`\nAll ${n} tracking checks passed`);
})().catch((e) => { console.error('TRACK TEST FAILED:', e); process.exit(1); });
