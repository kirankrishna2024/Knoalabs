// v3.10 screens in a real DOM: detected sources, "Leads in this view", Leads tab source column, map period. Run: node test/leadview-ui.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '900'; process.env.ADMIN_USERNAME = 'lvui.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'q'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const { pageFetch } = require('./fixtures/fetch');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms'); const campaigns = require('../src/campaigns');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ U${++n}. ${m}`);
const UA_IG = 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android';
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } return null; };

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  const lr = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lvui.admin', password: 'correct-horse-battery' }) });
  const cookie = lr.headers.get('set-cookie').split(';')[0];
  const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
  const ds = (await api('GET', '/admin/api/forms')).forms.find((f) => f.course_slug === 'datascience');
  const camp = (await api('POST', '/admin/api/campaigns', { name: 'DS Reels', form_id: ds.id })).campaign; await api('POST', `/admin/api/campaigns/${camp.id}/status`, { status: 'active' }); campaigns.invalidate();
  const post = (b, ua) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36' }, body: JSON.stringify({ course: 'datascience', first_name: 'Ravi', last_name: 'K', country: 'IN', phone: '9000000001', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', utm_campaign: 'ds-reels', ...b }) });
  await post({ client_id: 'a'.repeat(20), phone: '9000000011', utm_source: 'whatsapp' }); await post({ client_id: 'b'.repeat(20), phone: '9000000012', utm_source: 'meta' }, UA_IG); await post({ client_id: 'c'.repeat(20), phone: '9000000013', utm_source: 'qr', utm_medium: 'qr' });
  await fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA_IG }, body: JSON.stringify({ vid: 'visitor-ui-000001', sid: 'session-ui-000001', course: 'datascience', utm_source: 'meta', utm_campaign: 'ds-reels', events: [{ t: 'page_view', k: 'k'.repeat(16) }] }) });

  const open = async (p) => {
    const jar = new CookieJar(); jar.setCookieSync(cookie + '; Path=/', base);
    const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', (e) => { if (!/Could not load link/.test(String(e.message))) errs.push(String(e.message).slice(0, 200)); });
    const dom = await JSDOM.fromURL(base + p, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
      beforeParse(w) { w.fetch = pageFetch(base, cookie); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.confirm = () => true; } });
    dom.errs = errs; return dom;
  };
  const dom = await open('/admin/analytics?days=7'), w = dom.window, d = w.document, click = (e) => e.dispatchEvent(new w.Event('click', { bubbles: true }));
  const tiles = await until(() => d.querySelectorAll('#detGrid .src-tile').length > 3 && [...d.querySelectorAll('#detGrid .src-tile')]);
  assert(tiles); const names = tiles.map((t) => t.querySelector('.src-name').textContent); for (const x of ['WhatsApp', 'QR scan', 'ChatGPT / AI']) assert(names.includes(x), x);
  assert(/Instagram in-app browser/.test(d.getElementById('browsers').textContent)); ok('Traffic sources detected lists WhatsApp, QR scan and ChatGPT / AI (even at zero) and the browser list shows the Instagram in-app browser');
  assert(d.getElementById('lvBody').hidden); click(d.getElementById('lvToggle'));
  const rows = await until(() => d.querySelectorAll('#lvTable tbody tr.lv-row').length === 3 && d.querySelectorAll('#lvTable tbody tr.lv-row')); assert(rows, 'three leads listed with nothing selected');
  const first = rows[0]; click(first.querySelector('button')); assert(!first.nextElementSibling.hidden && /Mobile \/ WhatsApp/.test(first.nextElementSibling.textContent)); ok('"Show leads" opens the list (everyone when nothing is selected) and a row opens all collected information');
  const sel = d.getElementById('lvKind'); sel.value = 'unregistered'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(await until(() => d.querySelectorAll('#lvTable tbody tr.lv-row').length === 1 && /Did not register/.test(d.querySelector('#lvTable tbody tr.lv-row').textContent))); ok('the dropdown switches to visitors who did not register');
  click([...d.querySelectorAll('#detGrid .src-tile')].find((t) => /WhatsApp/.test(t.textContent)));
  sel.value = 'registered'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(await until(() => d.querySelectorAll('#lvTable tbody tr.lv-row').length === 1 && /WhatsApp/.test(d.querySelector('#lvTable tbody tr.lv-row').textContent) && /channel=WhatsApp/.test(w.location.search))); ok('clicking a source filters the page and the leads list together');
  const per = await until(() => d.querySelectorAll('.geo-period button').length === 10 && [...d.querySelectorAll('.geo-period button')]); assert(per);
  assert.strictEqual(per.find((b) => b.getAttribute('aria-pressed') === 'true').textContent, 'Same as the page period', 'the map opens on the same period as the page, so it never disagrees with the numbers above it');
  assert.deepStrictEqual(per.map((b) => b.textContent), ['Today', 'Last 24 hours', 'Yesterday', 'Last 2 days', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'All time', 'Same as the page period'], 'the periods are in a fixed, readable order');
  assert(['Last 2 days', 'Last 30 days', 'All time'].every((x) => per.some((b) => b.textContent === x))); click(per.find((b) => /Today/.test(b.textContent)));
  assert(await until(() => { const b = [...d.querySelectorAll('.geo-period button')].find((x) => /Today/.test(x.textContent)); return b && b.getAttribute('aria-pressed') === 'true'; })); ok('Where people come from has Today / Yesterday / Last 24 hours / 7 / 14 days / page period');
  /* zoom the map, then force a refresh with new data: the zoom must stay */
  const plus = [...d.querySelectorAll('.map-tools button')].find((b) => b.textContent === '+'); click(plus); click(plus); await new Promise((r) => setTimeout(r, 50));
  const vb0 = d.querySelector('.map-box svg').getAttribute('viewBox'); assert(vb0 !== '0 0 1000 500', 'zoomed');
  await post({ client_id: 'z'.repeat(20), phone: '9000000019', utm_source: 'whatsapp' }); await new Promise((r) => setTimeout(r, 5200)); w.__insights.reload(); await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(d.querySelector('.map-box svg').getAttribute('viewBox'), vb0); ok('a refresh with new data does not reset the map zoom');
  assert(!dom.errs.length, dom.errs.join(' | ')); ok('no script errors on the analytics page'); w.close();

  const dash = await open('/admin'); const dd = dash.window.document;
  const row = await until(() => dd.querySelector('#rows td.src') && dd.querySelectorAll('#rows tr').length === 4 && dd.querySelectorAll('#rows td.src')); assert(row);
  const txt = [...row].map((x) => x.textContent).join('|'); assert(/WhatsApp/.test(txt) && /QR scan/.test(txt) && /Meta/.test(txt) && /Instagram in-app browser/.test(txt));
  assert(await until(() => dd.querySelectorAll('#fSource option').length > 3)); ok('Leads tab: the Source column shows the detected source, how it was found and the browser, and there are Source and Campaign filters');
  assert(!dash.errs.length, dash.errs.join(' | ')); dash.window.close();
  server.close(); console.log(`\nAll ${n} checks passed`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
