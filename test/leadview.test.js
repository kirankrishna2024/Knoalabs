// v3.10: campaign rules (only campaigns added in the Campaigns tab and running count), detected sources (WhatsApp / QR / ChatGPT / in-app browsers),
// the browser list, "Leads in this view" (registered + did not register, filters, Excel), the Leads tab source, and the map period. Run: node test/leadview.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '900'; process.env.ADMIN_USERNAME = 'lv.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'z'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const forms = require('../src/forms');
const campaigns = require('../src/campaigns');
const S = require('../src/sources');
const { parseUserAgent, browserLabel } = require('../src/ua');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ L${++n}. ${m}`);
const UA_IG = 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android';
const UA_CH = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

(async () => {
  /* ---- detection tables ---- */
  assert.strictEqual(S.detectSource({ utm_source: 'chatgpt.com' }).channel, 'ChatGPT / AI'); assert.strictEqual(S.detectSource({ referrerHost: 'chat.openai.com' }).channel, 'ChatGPT / AI');
  assert.strictEqual(S.detectSource({ utm_source: 'qr', utm_medium: 'qr' }).channel, 'QR scan'); assert.strictEqual(S.detectSource({ utm_medium: 'qr' }).channel, 'QR scan');
  assert.strictEqual(S.detectSource({ utm_source: 'whatsapp' }).channel, 'WhatsApp'); assert.strictEqual(S.detectSource({ referrerHost: 'linktr.ee' }).channel, 'Short / bio link');
  assert.strictEqual(S.detectSource({ userAgent: UA_IG }).channel, 'Meta'); assert.strictEqual(S.detectSource({ referrerHost: 'example.org' }).channel, 'Other');
  ok('WhatsApp, QR scans, ChatGPT / AI, bio and short links, in-app browsers and other websites are detected by themselves');
  const ig = parseUserAgent(UA_IG); assert.strictEqual(browserLabel(ig), 'Instagram in-app browser'); assert.strictEqual(browserLabel(parseUserAgent(UA_CH)), 'Chrome');
  assert.strictEqual(browserLabel(parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36')), 'Samsung Internet');
  assert.strictEqual(browserLabel(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 Instagram 312.0.0.18.111')), 'Instagram in-app browser');
  ok('browser list: an Instagram / Facebook link is "Instagram in-app browser", never "Chrome"; Samsung, Edge, Safari, Mi Browser ... are told apart');

  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
    return { status: r.status, json, buf, headers: r.headers };
  };
  cookie = (await call('POST', '/admin/api/login', { username: 'lv.admin', password: 'correct-horse-battery' })).headers.get('set-cookie').split(';')[0];
  const ds = (await call('GET', '/admin/api/forms')).json.forms.find((f) => f.course_slug === 'datascience');
  const post = (b, ua = UA_CH) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify({ course: 'datascience', first_name: 'Ravi', last_name: 'K', country: 'IN', phone: '9000000001', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', ...b }) });

  /* ---- campaign rules ---- */
  let r = await call('POST', '/admin/api/campaigns', { name: 'DS Reels', form_id: ds.id }); const reels = r.json.campaign;
  campaigns.invalidate();
  let rd = await fetch(base + '/datascience?utm_campaign=made-up', { redirect: 'manual', headers: { 'User-Agent': UA_CH } }); assert.strictEqual(rd.status, 302); assert(!/made-up/.test(rd.headers.get('location')), 'nothing is running yet: a made-up tag only loses its tag');
  rd = await fetch(base + '/datascience?utm_campaign=made-up&utm_source=whatsapp', { redirect: 'manual', headers: { 'User-Agent': UA_CH } }); assert.strictEqual(rd.status, 302); assert(!/made-up/.test(rd.headers.get('location')) && /utm_source=whatsapp/.test(rd.headers.get('location')));
  await call('POST', `/admin/api/campaigns/${reels.id}/status`, { status: 'active' }); campaigns.invalidate();
  rd = await fetch(base + '/datascience?utm_campaign=made-up&utm_source=whatsapp', { redirect: 'manual', headers: { 'User-Agent': UA_CH } }); assert.strictEqual(rd.status, 302);
  assert(/utm_campaign=ds-reels/.test(rd.headers.get('location')) && /utm_source=whatsapp/.test(rd.headers.get('location')));
  assert.strictEqual((await fetch(base + '/datascience?utm_campaign=ds-reels&utm_source=meta', { redirect: 'manual', headers: { 'User-Agent': UA_CH } })).status, 200);
  rd = await fetch(base + '/datascience?utm_source=whatsapp', { redirect: 'manual', headers: { 'User-Agent': UA_CH } }); assert.strictEqual(rd.status, 302); assert(/utm_campaign=ds-reels/.test(rd.headers.get('location')));
  ok('a link with a campaign nobody added (or a tag-less link) is redirected to the running campaign, keeping its source and medium; a running campaign passes; with none running the made-up tag is dropped');

  await post({ client_id: 'a'.repeat(20), phone: '9000000011', first_name: 'Made', utm_campaign: 'made-up', utm_source: 'whatsapp' });
  await post({ client_id: 'b'.repeat(20), phone: '9000000012', first_name: 'Listed', utm_campaign: 'DS-Reels', utm_source: 'meta', utm_medium: 'paid' }, UA_IG);
  await post({ client_id: 'c'.repeat(20), phone: '9000000013', first_name: 'Scan', utm_campaign: 'ds-reels', utm_source: 'qr', utm_medium: 'qr' });
  await post({ client_id: 'd'.repeat(20), phone: '9000000014', first_name: 'Gpt', utm_campaign: 'ds-reels', utm_source: 'chatgpt.com' });
  const saved = (await db.query('SELECT first_name, utm_campaign, campaign_id, source_detected, source_method, in_app, browser FROM leads ORDER BY id')).rows;
  assert.deepStrictEqual(saved.map((x) => x.utm_campaign), ['ds-reels', 'ds-reels', 'ds-reels', 'ds-reels']); assert(saved.every((x) => Number(x.campaign_id) === Number(reels.id)));
  assert.deepStrictEqual(saved.map((x) => x.source_detected), ['WhatsApp', 'Meta', 'QR scan', 'ChatGPT / AI']); assert.strictEqual(saved[1].in_app, 'Instagram');
  ok('a registration with a campaign nobody added is saved under the running campaign (the lead is never lost); the source is detected: WhatsApp, Meta, QR scan, ChatGPT / AI');
  await call('POST', `/admin/api/campaigns/${reels.id}/status`, { status: 'paused' }); campaigns.invalidate();
  await post({ client_id: 'e'.repeat(20), phone: '9000000015', first_name: 'Late', utm_campaign: 'ds-reels', utm_source: 'google', click_ids: { gclid: true } });
  assert.strictEqual((await db.query("SELECT utm_campaign, campaign_id FROM leads WHERE first_name='Late'")).rows[0].utm_campaign, null); ok('a paused campaign no longer counts: nothing running -> the lead carries no campaign');
  await call('POST', `/admin/api/campaigns/${reels.id}/status`, { status: 'active' }); campaigns.invalidate();
  // people who opened the page and did not register
  const track = (b, ua) => fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(b) });
  await track({ vid: 'visitor-unreg-0001', sid: 'session-unreg-0001', course: 'datascience', utm_source: 'whatsapp', utm_campaign: 'ds-reels', events: [{ t: 'page_view', k: 'k'.repeat(16) }, { t: 'form_start', k: 'l'.repeat(16) }, { t: 'field_focus', k: 'm'.repeat(16), d: { field: 'college_name' } }] }, UA_IG);
  await track({ vid: 'visitor-unreg-0002', sid: 'session-unreg-0002', course: 'datascience', utm_source: 'google', utm_campaign: 'ds-reels', events: [{ t: 'page_view', k: 'n'.repeat(16) }] }, UA_CH);

  /* ---- analytics: detected sources + browsers ---- */
  r = await call('GET', '/admin/api/analytics?days=7'); assert(r.json.ok);
  const det = Object.fromEntries(r.json.detected.items.map((i) => [i.name, i.n]));
  assert.strictEqual(det.WhatsApp, 1); assert.strictEqual(det['QR scan'], 1); assert.strictEqual(det['ChatGPT / AI'], 1); assert(r.json.detected.methods.length > 0);
  assert(r.json.browsers.some((b) => b.name === 'Instagram in-app browser' && b.n === 1) && r.json.browsers.some((b) => b.name === 'Chrome')); assert.deepStrictEqual(r.json.inApp.map((x) => x.name), ['Instagram']);
  assert(r.json.channels.some((c) => c.name === 'QR scan') && r.json.channels.some((c) => c.name === 'ChatGPT / AI') && r.json.recent[0].channel);
  ok('analytics shows the detected sources (WhatsApp, QR scan, ChatGPT / AI ...) with how they were found, the browser list (Instagram in-app browser) and the channel on the live feed');
  r = await call('GET', '/admin/api/analytics?days=7&channel=QR%20scan'); assert.strictEqual(r.json.totals.window, 1); r = await call('GET', '/admin/api/analytics?days=7&channel=ChatGPT%20%2F%20AI'); assert.strictEqual(r.json.totals.window, 1);
  ok('channel filter works for the new sources');

  /* ---- leads in this view ---- */
  r = await call('GET', '/admin/api/analytics/leads?days=7'); assert(r.json.ok); assert.strictEqual(r.json.total, 5); assert.strictEqual(r.json.counts.registered, 5); assert.strictEqual(r.json.counts.unregistered, 2);
  assert(r.json.rows.every((x) => x.kind === 'registered' && x.name && x.phone)); assert(!JSON.stringify(r.json).match(/Mozilla|client_id|visitor-unreg|visitor_id/)); ok('with no filter every registered lead is listed with its answers, source and browser; no user agent or ids leave the server');
  r = await call('GET', '/admin/api/analytics/leads?days=7&channel=WhatsApp'); assert.strictEqual(r.json.total, 1); assert.strictEqual(r.json.rows[0].name, 'Made K'); assert.strictEqual(r.json.rows[0].campaign, 'ds-reels'); assert.strictEqual(r.json.counts.unregistered, 1);
  r = await call('GET', '/admin/api/analytics/leads?days=7&kind=unregistered'); assert.strictEqual(r.json.total, 2); assert(r.json.rows.every((x) => x.kind === 'unregistered')); const u1 = r.json.rows.find((x) => x.channel === 'WhatsApp');
  assert(u1 && u1.in_app === 'Instagram' && u1.browser === 'Instagram in-app browser' && u1.started_form === true && u1.last_field === 'college_name');
  r = await call('GET', '/admin/api/analytics/leads?days=7&kind=all&campaign=ds-reels&medium=qr'); assert.strictEqual(r.json.counts.registered, 1); assert.strictEqual(r.json.rows[0].name, 'Scan K');
  r = await call('GET', '/admin/api/analytics/leads?days=7&kind=all&status=' + encodeURIComponent('Student / Fresher')); assert.strictEqual(r.json.unregisteredAvailable, false); assert.strictEqual(r.json.counts.unregistered, null);
  ok('the list follows the filters exactly: source, campaign, medium, "I am a"; people who did not register show how far they got; "I am a" hides them (they have not said yet)');
  r = await call('GET', '/admin/api/analytics/leads.xlsx?days=7&kind=all'); assert.strictEqual(r.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf); const reg = wb.getWorksheet('Registered leads'), un = wb.getWorksheet('Did not register');
  assert.strictEqual(reg.rowCount, 6); assert.strictEqual(un.rowCount, 3); assert(wb.getWorksheet('Summary'));
  const heads = reg.getRow(1).values.map(String); assert(heads.includes('Source (as shown on the dashboard)') && heads.includes('Browser (as listed)') && heads.includes('Email')); ok('the Excel file has a sheet of registered leads (every answer + source + browser) and a sheet of visitors who did not register');
  const anon = await fetch(base + '/admin/api/analytics/leads.xlsx'); assert.strictEqual(anon.status, 401); assert.strictEqual((await fetch(base + '/admin/api/analytics/leads')).status, 401); ok('both endpoints need an admin session');

  /* ---- Leads tab ---- */
  r = await call('GET', '/admin/api/leads?channel=' + encodeURIComponent('ChatGPT / AI')); assert.strictEqual(r.json.total, 1); assert.strictEqual(r.json.rows[0].source_channel, 'ChatGPT / AI'); assert(r.json.rows[0].source_via);
  r = await call('GET', '/admin/api/leads?campaign=ds-reels&pageSize=10'); assert.strictEqual(r.json.total, 4); assert(r.json.rows.every((x) => x.source_channel && x.browser_label)); assert(r.json.rows.some((x) => x.browser_label === 'Instagram in-app browser'));
  r = await call('GET', '/admin/api/filters'); assert(r.json.channels.some((c) => c.name === 'WhatsApp') && r.json.campaigns.some((c) => c.name === 'ds-reels'));
  ok('Leads tab: every row carries the detected source, how it was found and the browser; it can be filtered by source and campaign, and the dropdowns list what really exists');

  /* ---- Where people come from: own period, all filters ---- */
  for (const g of ['today', 'yesterday', '24h', '2', '7', '14', '30', '90', 'all', 'page']) { r = await call('GET', `/admin/api/insights?days=14&geo=${g}&channel=WhatsApp`); assert(r.json.ok, g); assert.strictEqual(r.json.geo.period.key, g); }
  r = await call('GET', '/admin/api/insights?days=14&geo=today'); assert.strictEqual(r.json.geo.total, 5); r = await call('GET', '/admin/api/insights?days=14&geo=yesterday'); assert.strictEqual(r.json.geo.total, 0);
  r = await call('GET', '/admin/api/insights?days=14&channel=WhatsApp&geo=today'); assert.strictEqual(r.json.geo.total, 1); assert.strictEqual(r.json.geo.unregistered.total, 1); assert.strictEqual(r.json.funnel[0].n, 1);
  assert(r.json.devices.visitorsBrowser.some((b) => b.name === 'Instagram in-app browser'));
  ok('the map has its own period (today / yesterday / last 24 h / 7 / 14 days) and follows every filter of the page');

  server.close(); console.log(`\nAll ${n} checks passed`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
