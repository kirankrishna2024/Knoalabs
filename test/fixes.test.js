// v3.13: referring-website graph (opens + registrations), "Show leads" pop-up, worldwide state borders. Run: node test/fixes.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '900'; process.env.ADMIN_USERNAME = 'fix.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'q'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms'); const campaigns = require('../src/campaigns');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ F${++n}. ${m}`);
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } return null; };

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  const lr = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fix.admin', password: 'correct-horse-battery' }) });
  const cookie = lr.headers.get('set-cookie').split(';')[0];
  const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
  const ds = (await api('GET', '/admin/api/forms')).forms.find((f) => f.course_slug === 'datascience');
  const camp = (await api('POST', '/admin/api/campaigns', { name: 'DS Reels', form_id: ds.id })).campaign; await api('POST', `/admin/api/campaigns/${camp.id}/status`, { status: 'active' });
  const camp2 = (await api('POST', '/admin/api/campaigns', { name: 'Visitors Only', form_id: ds.id })).campaign; await api('POST', `/admin/api/campaigns/${camp2.id}/status`, { status: 'active' }); campaigns.invalidate();
  const post = (b) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36' }, body: JSON.stringify({ course: 'datascience', first_name: 'Ravi', last_name: 'K', country: 'IN', phone: '9000000001', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', utm_campaign: 'ds-reels', ...b }) });
  await post({ client_id: 'a'.repeat(20), phone: '9000000011', utm_source: 'whatsapp' });
  await post({ client_id: 'b'.repeat(20), phone: '9000000012', referrer: 'https://news.ycombinator.com/item?id=1' });
  const visit = (v, ref, camp2name) => fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/125', ...(ref ? { Referer: ref } : {}) }, body: JSON.stringify({ vid: v, sid: 's-' + v, course: 'datascience', referrer: ref, utm_campaign: camp2name || 'ds-reels', events: [{ t: 'page_view', k: 'k'.repeat(16) }] }) });
  const open1 = (v, ref) => fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36' }, body: JSON.stringify({ vid: v, course: 'datascience', referrer: ref, utm_campaign: 'ds-reels' }) });
  await open1('visitor-open-000001', 'https://news.ycombinator.com/'); await open1('visitor-open-000002', 'https://www.linkedin.com/feed/'); await open1('visitor-open-000003', 'https://t.co/abc');
  await visit('visitor-fix-000001', 'https://news.ycombinator.com/'); await visit('visitor-fix-000002', 'https://www.linkedin.com/'); await visit('visitor-fix-000003', 'https://t.co/abc'); await fetch(base + '/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/125' }, body: JSON.stringify({ vid: 'visitor-fix-000004', sid: 's-visitor-fix-000004', course: 'datascience', utm_source: 'chatgpt', events: [{ t: 'page_view', k: 'm'.repeat(16) }] }) });

  const A = await api('GET', '/admin/api/analytics?days=7');
  const hosts = A.detected.hosts; assert(Array.isArray(hosts) && hosts.length >= 3, 'hosts listed'); const hn = hosts.find((h) => h.name === 'news.ycombinator.com');
  assert(hn && hn.n === 1 && hn.opens >= 1, JSON.stringify(hosts)); assert(hosts.some((h) => h.name === 't.co' && h.redirect && h.opens === 1 && h.n === 0), 'a redirect with opens but no leads still shows');
  ok('referring websites come from link opens AND registrations; redirects (t.co) are flagged and listed even with no leads yet');

  const open = async (p) => {
    const jar = new CookieJar(); jar.setCookieSync(cookie + '; Path=/', base); const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', (e) => { if (!/Could not load link/.test(String(e.message))) errs.push(String(e.message).slice(0, 200)); });
    const dom = await JSDOM.fromURL(base + p, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
      beforeParse(w) { w.fetch = (u, o = {}) => fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), Cookie: cookie } }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } });
    dom.errs = errs; return dom;
  };
  const dom = await open('/admin/analytics?days=7'), w = dom.window, d = w.document, click = (e) => e.dispatchEvent(new w.Event('click', { bubbles: true }));
  const rows = await until(() => d.querySelectorAll('#detHosts .hg-row').length >= 3 && [...d.querySelectorAll('#detHosts .hg-row')]); assert(rows, 'host graph rows');
  assert(rows.every((r) => r.querySelectorAll('.hg-bar').length === 2) && /t\.co/.test(d.getElementById('detHosts').textContent) && d.querySelector('#detHosts .tag'));
  ok('"Websites that sent visitors" is a bar graph: link opens and registrations per website');

  const cb = await until(() => [...d.querySelectorAll('#campTable .linkbtn')].find((b) => /reels/i.test(b.textContent))); click(cb);
  await until(() => /campaign=ds-reels/.test(w.location.search)); click(d.getElementById('lvToggle'));
  const lr2 = await until(() => d.querySelectorAll('#lvTable tbody tr.lv-row').length === 2 && d.querySelectorAll('#lvTable tbody tr.lv-row')); assert(lr2, 'the two leads of the campaign');
  assert(d.getElementById('lvCard').classList.contains('lv-open') && d.querySelector('.lv-backdrop') && d.body.classList.contains('lv-lock'));
  ok('Show leads opens a pop-up with the leads of the selected campaign');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!d.getElementById('lvCard').classList.contains('lv-open') && !d.querySelector('.lv-backdrop') && d.getElementById('lvBody').hidden); ok('Escape closes the pop-up');

  w.close(); const dom2 = await open('/admin/analytics?days=7&channel=' + encodeURIComponent('ChatGPT / AI')), w2 = dom2.window, d2 = w2.document;
  await until(() => d2.querySelectorAll('#detGrid .src-tile').length > 3); d2.getElementById('lvToggle').dispatchEvent(new w2.Event('click', { bubbles: true }));
  const un = await until(() => d2.querySelectorAll('#lvTable tbody tr.lv-row').length === 1 && d2.getElementById('lvKind').value === 'all' && d2.querySelectorAll('#lvTable tbody tr.lv-row')); assert(un, 'falls back to everyone');
  assert(/Did not register/.test(un[0].textContent)); ok('a selection with only visitors (nobody registered) lists those visitors instead of an empty table');

  const paths = await until(() => d2.querySelectorAll('.map-box path.map-state').length > 3000 && d2.querySelectorAll('.map-box path.map-state'), 15000); assert(paths, 'worldwide states');
  const cs = new Set([...paths].map((p) => p.getAttribute('data-country'))); for (const c of ['IN', 'US', 'DE', 'BR', 'AU', 'AE', 'GB', 'CN', 'RU', 'ZA', 'JP', 'FR']) assert(cs.has(c), c + ' states drawn');
  assert(cs.size > 150 && d2.querySelector('.map-box path.map-borders').getAttribute('d').length > 20000); ok('every country\'s states / provinces (' + paths.length + ' outlines, ' + cs.size + ' countries) and the country borders are drawn');
  assert(!dom.errs.length && !dom2.errs.length, dom.errs.concat(dom2.errs).join(' | ')); ok('no script errors'); w2.close();
  server.close(); console.log(`\nAll ${n} checks passed`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
