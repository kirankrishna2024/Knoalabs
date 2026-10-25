// Analytics insights (funnel, drop-off, devices, map data, IP dashboard) + chart zoom / full screen + map in the page. Run: node test/insights.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '500'; process.env.ADMIN_USERNAME = 'in.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery'; process.env.SESSION_SECRET = 'q'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const { pageFetch } = require('./fixtures/fetch');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms'); const Lead = require('../src/models/Lead');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ I${++n}. ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(25); } return null; }

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  assert.strictEqual((await fetch(base + '/admin/api/insights')).status, 401); ok('the insights API needs a sign-in');
  const lr = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'in.admin', password: 'correct-horse-battery' }) }); const cookie = lr.headers.get('set-cookie').split(';')[0];
  const get = async (p) => { require('../src/insights').clearCache(); return (await fetch(base + p, { headers: { Cookie: cookie } })).json(); };
  const now = new Date(), ago = (min) => new Date(now.getTime() - min * 60000);

  // sessions + events: 10 visited, 6 started, 4 tried, 3 registered
  const sid = (i) => `session-${String(i).padStart(4, '0')}-xxxx`, vid = (i) => `visitor-${String(i).padStart(4, '0')}-xxxx`;
  for (let i = 0; i < 10; i++) {
    await db.query("INSERT INTO visitors (visitor_id, first_seen, last_seen, visit_count, session_count, device_type, os, browser) VALUES ($1,$2,$2,$3,1,'mobile','Android','Chrome')", [vid(i), ago(30), i < 3 ? 2 : 1]);
    await db.query("INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, course_slug) VALUES ($1,$2,$3,$3,$4)", [sid(i), vid(i), ago(30), i < 8 ? 'datascience' : 'cybersecurity']);
    const ev = (t, k, d) => db.query('INSERT INTO visitor_events (event_key, at, visitor_id, session_id, type, course_slug, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)', [`k-${i}-${k}-abcdefghijkl`, ago(29), vid(i), sid(i), t, i < 8 ? 'datascience' : 'cybersecurity', JSON.stringify(d || {})]);
    await ev('page_view', 'a');
    if (i < 6) { await ev('form_start', 'b'); await ev('field_focus', 'c', { field: i < 4 ? 'phone' : 'email' }); }
    if (i < 4) { await ev('submit_attempt', 'd'); if (i === 0) await ev('submit_invalid', 'e', { fields: ['phone'] }); }
    if (i < 3) await ev('submit_success', 'f');
  }
  const mk = async (o) => { const l = await Lead.create({ first_name: 'A', last_name: 'B', full_name: 'A B', phone: '+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), country_code: 'IN', status: 'Student / Fresher', course_slug: 'datascience', course: 'Data Science', ...o }); await db.query('UPDATE leads SET created_at=$1 WHERE id=$2', [o.created_at || ago(20), l.id]); const extra = Object.entries(o).filter(([k]) => /^geo_|^phone_country/.test(k));       // written by the location lookup after saving, not by Lead.create
    if (extra.length) await db.query(`UPDATE leads SET ${extra.map(([k], i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`, [l.id, ...extra.map(([, v]) => v)]);
    return l; };
  const geoKochi = { geo_status: 'ok', geo_country_code: 'IN', geo_region: 'Kerala', geo_city: 'Kochi', geo_lat: 9.93, geo_lon: 76.26, geo_org: 'Bharti Airtel Ltd.' };
  await mk({ ...geoKochi, device_type: 'mobile', os: 'Android', browser: 'Chrome', ip: '117.251.10.5', ip_version: 4, time_to_register_seconds: 45, visit_count_before_signup: 1 });
  await mk({ ...geoKochi, device_type: 'mobile', os: 'iOS', browser: 'Safari', in_app: 'Instagram', ip: '117.251.10.6', ip_version: 4, time_to_register_seconds: 200, is_returning_lead: true, visit_count_before_signup: 3 });
  await mk({ geo_status: 'ok', geo_country_code: 'AE', geo_region: 'Dubai', geo_city: 'Dubai', geo_lat: 25.2, geo_lon: 55.27, geo_org: 'Amazon.com, Inc.', phone_country_mismatch: true, device_type: 'desktop', os: 'Windows', browser: 'Edge', ip: '3.4.5.6', ip_version: 4, time_to_register_seconds: 700 });
  await mk({ geo_status: 'private_ip', device_type: 'desktop', ip: '10.0.0.4', course_slug: 'cybersecurity', course: 'Cyber Security', ip_version: 4 });
  await mk({ created_at: new Date(now.getTime() - 40 * 86400000), ...geoKochi });          // outside the 14-day window

  let r = await get('/admin/api/insights'); if (!r.ok) console.error('insights said:', JSON.stringify(r)); assert(r.ok); assert.deepStrictEqual(r.funnel.map((s) => s.n), [10, 6, 4, 3]); assert.strictEqual(r.funnel[1].pctOfPrev, 60); assert.strictEqual(r.funnel[3].pctOfFirst, 30);
  ok('funnel: 10 opened, 6 started, 4 pressed Register, 3 registered, with the percentage of the step before');
  assert.deepStrictEqual(r.dropoff.lastField, [{ name: 'email', n: 2 }, { name: 'phone', n: 1 }]); assert.deepStrictEqual(r.dropoff.errors, [{ name: 'phone', n: 1 }]); ok('where people stop: the last field touched by visits that started but did not register; fields that blocked an attempt');
  assert.strictEqual(r.people.registrations, 4); assert.strictEqual(r.people.returning, 1); assert.strictEqual(r.people.returningVisitors, 3); assert.strictEqual(r.people.visitors, 10); ok('registrations in the window (the 40-day-old one is excluded); returning registrations and returning visitors');
  assert.deepStrictEqual(r.devices.type.map((x) => [x.name, x.n]), [['Desktop', 2], ['Mobile', 2]]);   // ties are listed alphabetically assert.strictEqual(r.devices.inApp[0].name, 'Instagram'); ok('devices, systems, browsers and in-app browsers of the registrations');
  assert.strictEqual(r.timeToRegister.medianSeconds, 200); assert.strictEqual(r.timeToRegister.buckets.find((b) => b.label === 'Under 1 minute').n, 1); assert.strictEqual(r.timeToRegister.avgVisitsBeforeSignup, 2); ok('time to register: median, buckets and the average number of visits before registering');
  assert.deepStrictEqual(r.geo.countries.map((c) => [c.code, c.name, c.n]), [['IN', 'India', 2], ['AE', 'United Arab Emirates', 1]]); assert.deepStrictEqual([r.geo.cities[0].name, r.geo.cities[0].n, r.geo.cities[0].lat, r.geo.cities[0].lon], ['Kochi', 2, 9.93, 76.26]); assert.strictEqual(r.geo.located, 3); assert.strictEqual(r.geo.unknown, 1);
  assert(r.geo.regions.some((x) => x.name === 'Kerala' && x.n === 2)); ok('map data: countries (named), regions and cities with rounded coordinates; located vs unknown counts');

  /* registered and unregistered are kept apart: visitor 0 registered (a lead carries its visitor id), visitors 1-9 did not; 4 of those have a located IP */
  const firstLead = (await db.query('SELECT id FROM leads ORDER BY id LIMIT 1')).rows[0].id; await db.query('UPDATE leads SET visitor_id=$1 WHERE id=$2', [vid(0), firstLead]);
  const place = (i, city, region, cc, lat, lon) => db.query('UPDATE visitors SET geo_status=$2, geo_country_code=$3, geo_region=$4, geo_city=$5, geo_lat=$6, geo_lon=$7 WHERE visitor_id=$1', [vid(i), 'ok', cc, region, city, lat, lon]);
  await place(0, 'Kochi', 'Kerala', 'IN', 9.93, 76.26); await place(1, 'Kochi', 'Kerala', 'IN', 9.93, 76.26); await place(2, 'Kochi', 'Kerala', 'IN', 9.93, 76.26); await place(5, 'Dubai', 'Dubai', 'AE', 25.2, 55.27); await place(6, 'Mumbai', 'Maharashtra', 'IN', 19.08, 72.88);
  r = await get('/admin/api/insights'); const u = r.geo.unregistered;
  assert.strictEqual(u.total, 9); assert.strictEqual(u.located, 4); assert.strictEqual(u.unknown, 5);
  assert.deepStrictEqual(u.cities.map((c) => [c.name, c.n, c.lat, c.lon]).sort(), [['Dubai', 1, 25.2, 55.27], ['Kochi', 2, 9.93, 76.26], ['Mumbai', 1, 19.08, 72.88]]);
  assert.deepStrictEqual(u.countries.map((c) => [c.code, c.n]), [['IN', 3], ['AE', 1]]);
  assert.deepStrictEqual(r.geo.countries.map((c) => [c.code, c.n]), [['IN', 2], ['AE', 1]], 'the registered layer is unchanged by the visitors');
  ok('map data: visitors who did NOT register are a separate layer (the registered visitor is not in it), with their own countries, regions, cities and located / unknown counts');
  r = await get('/admin/api/insights?course=cybersecurity'); assert.strictEqual(r.geo.unregistered.total, 2); assert.strictEqual(r.geo.unregistered.located, 0); ok('the master class filter also filters the not-registered layer (only visitors who opened that master class)');
  r = await get('/admin/api/insights');
  assert.strictEqual(r.ip.hosting, 1); assert.strictEqual(r.ip.mismatch, 1); assert.strictEqual(r.ip.mismatchPct, 25); assert(r.ip.orgs.find((o) => /Amazon/.test(o.name)).hosting); assert.strictEqual(r.ip.status.find((s) => s.name === 'private_ip').n, 1);
  assert.deepStrictEqual(r.ip.recent.map((x) => x.ip).sort(), ['10.0.x.x', '117.251.x.x', '117.251.x.x', '3.4.x.x']); ok('IP section: data-centre / country-mismatch counts, lookup result mix, and recent registrations with MASKED IPs only');
  const dump = JSON.stringify(r); assert(!/117\.251\.10|3\.4\.5\.6|10\.0\.0\.4|visitor-0|session-0|\+9198/.test(dump)); ok('the response carries no full IP, phone number, visitor id or session id');
  r = await get('/admin/api/insights?course=cybersecurity'); assert.deepStrictEqual(r.funnel.map((s) => s.n), [2, 0, 0, 0]); assert.strictEqual(r.people.registrations, 1); r = await get('/admin/api/insights?course=datascience&days=7'); assert.strictEqual(r.funnel[0].n, 8);
  r = await get("/admin/api/insights?course='%3BDROP%20TABLE%20leads&campaign=%00x&days=abc"); assert(r.ok && r.window.n === 14); ok('filters (master class, period) narrow the funnel and the registrations; junk values are ignored safely');

  /* ---- leads list + Excel export carry the new columns, and hide internal ids ---- */
  const list = await get('/admin/api/leads?pageSize=50'); assert(list.rows.length >= 5 && list.rows.every((x) => !('ip_hash' in x) && !('visitor_id' in x) && !('session_id' in x) && !('ip' in x))); assert(list.rows.some((x) => x.is_returning_lead === true) && list.rows.some((x) => x.geo_city === 'Kochi'));
  const first = list.rows.find((x) => x.is_returning_lead); await db.query("UPDATE leads SET custom_fields=$2, form_version=2, match_basis='phone,device' WHERE id=$1", [first.id, JSON.stringify({ city: 'Kochi', interests: ['ai', 'sec'] })]);
  const ExcelJS = require('exceljs'), wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await (await fetch(base + '/admin/api/leads.xlsx', { headers: { Cookie: cookie } })).arrayBuffer()));
  const ws = wb.getWorksheet('Leads'), head = ws.getRow(1).values.slice(1), col = (h) => head.indexOf(h) + 1; for (const h of ['Form version', 'Other answers (added in Form Studio)', 'Source (detected)', 'Device', 'City', 'Country (from IP)', 'Returning (same person)', 'Same person because', 'Seconds to register']) assert(col(h) > 0, h);
  let found = null; ws.eachRow((row, i) => { if (i > 1 && row.getCell(col('Returning (same person)')).value === 'Yes') found = row; }); assert(found); assert.strictEqual(found.getCell(col('Other answers (added in Form Studio)')).value, 'city: Kochi; interests: ai, sec'); assert.strictEqual(found.getCell(col('Same person because')).value, 'phone,device');
  ok('the leads list hides IP hash / visitor / session ids but shows the returning flag and city; the Excel export has form version, custom answers, source, device, location and same-person columns');

  /* ---- the browser / in-app / "how the source was found" panels count everyone who opened the page, not only registrations ---- */
  const an = await get('/admin/api/analytics?days=14');
  assert.strictEqual(an.visitors.available, true); assert.strictEqual(an.visitors.total, 10);
  assert.deepStrictEqual(an.visitors.browsers, [{ name: 'Chrome', n: 10 }], 'all ten visitors opened the page in Chrome');
  assert.deepStrictEqual(an.visitors.devices, [{ name: 'Mobile', n: 10 }]);
  assert.deepStrictEqual(an.browsers.map((x) => [x.name, x.n]), [['Chrome', 1], ['Edge', 1], ['Instagram in-app browser', 1], ['Unknown', 1]]);            // only the people who registered
  assert.strictEqual(an.visitors.inApp.length, 0); assert(an.detected.methods.length > 0 && an.detected.methods.every((m) => m.opens != null));
  const anStatus = await get('/admin/api/analytics?days=14&status=Student%20%2F%20Fresher');
  assert.strictEqual(anStatus.visitors.available, false, 'one "I am a" group hides the visitor side: a visitor has not answered it yet');
  ok('the analytics API reports browsers / devices for everyone who opened the page (also with no registrations) next to the registered ones, and link opens per way of finding the source');

  /* ---- the page, in jsdom ---- */
  const jar = new CookieJar(); jar.setCookieSync(cookie + '; Path=/', base); const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', (e) => { if (!/Could not load link/.test(String(e.message))) errs.push(String(e.message).slice(0, 200)); });
  const dom = await JSDOM.fromURL(base + '/admin/analytics?days=14', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
    beforeParse(w) { w.fetch = pageFetch(base, cookie); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })); } });
  const w = dom.window, d = w.document;
  await until(() => d.querySelectorAll('#insights .fx-card').length >= 4);  assert.strictEqual(d.querySelectorAll('#insights .fx-card').length, 4); assert(/Opened the form/.test(d.getElementById('insights').textContent) && /Where people come from/.test(d.getElementById('insights').textContent) && /IP and location quality/.test(d.getElementById('insights').textContent));
  ok('the analytics page shows the visitor journey, devices, map and IP quality sections');
  const cardByTitle = (t) => [...d.querySelectorAll('.fx-card')].find((c) => (c.querySelector('h2') || {}).textContent === t);
  const bsplit = cardByTitle('Browsers'); const btxt = bsplit ? bsplit.textContent.replace(/\s+/g, ' ') : '';
  assert(bsplit && /Chrome/.test(btxt) && /10 opened/.test(btxt) && /1 registered/.test(btxt), 'the Browsers card shows everyone who opened the page and the people who registered: ' + btxt.slice(0, 160));
  const isplit = cardByTitle('Opened inside an app'); assert(isplit && /Instagram/.test(isplit.textContent) && /opened/.test(isplit.textContent) && /registered/.test(isplit.textContent));
  assert(/opened/.test(cardByTitle('Traffic sources detected').textContent) && /registered/.test(cardByTitle('Traffic sources detected').textContent));
  ok('Browsers, Opened inside an app and How the source was found show visitors and registrations side by side');
  const dots = d.querySelectorAll('.map-box .map-dot.reg'), unregDots = d.querySelectorAll('.map-box .map-dot.unreg'); assert.strictEqual(dots.length, 2); assert.strictEqual(unregDots.length, 3); assert(d.querySelector('.map-box path.map-land').getAttribute('d').length > 50000); assert(/Kochi/.test(dots[0].getAttribute('aria-label'))); assert(/^Registered/.test(dots[0].getAttribute('aria-label')) && /^Did not register/.test(unregDots[0].getAttribute('aria-label'))); ok('the map draws the bundled world outline (no outside requests); registered people (solid dots) and visitors who did not register (rings) are separate layers, one circle per city');
  await until(() => d.querySelectorAll('.map-box path.map-state').length >= 36);
  assert(d.querySelectorAll('.map-box path.map-state[data-country="IN"]').length === 36, 'all 36 Indian states and union territories are drawn');
  assert(d.querySelector('.map-state[data-state="Kerala"]').classList.contains('has') && d.querySelector('.map-state[data-state="Maharashtra"]').classList.contains('has-unreg') && d.querySelector('.map-state[data-country="AE"]'));
  d.querySelector('.map-state[data-state="Kerala"]').dispatchEvent(new w.Event('click', { bubbles: true })); assert(/Kerala, India: 2 registered · 2 did not register/.test(d.querySelector('.map-tip').textContent), d.querySelector('.map-tip').textContent);
  ok('state borders are drawn (36 Indian states), shaded by registrations, and a click names the state with both counts');
  const keys = [...d.querySelectorAll('.map-key')]; assert.deepStrictEqual(keys.map((k) => k.textContent), ['Registered (3)', 'Did not register (4)']);
  keys[1].dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual(d.querySelector('.map-layer.map-unreg').style.display, 'none'); assert.notStrictEqual(d.querySelector('.map-layer.map-reg').style.display, 'none'); assert.strictEqual(keys[1].getAttribute('aria-pressed'), 'false');
  keys[1].dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual(d.querySelector('.map-layer.map-unreg').style.display, ''); ok('each layer can be switched off and on from the legend, with its own count');
  const segBtns = [...d.querySelectorAll('.map-box')[0].closest('.fx-card').querySelectorAll('.seg button')]; assert.deepStrictEqual(segBtns.map((b) => b.textContent), ['Registered', 'Did not register']);
  segBtns[1].dispatchEvent(new w.Event('click', { bubbles: true })); assert(/Mumbai/.test(d.querySelector('.map-box').closest('.fx-card').textContent) && /Dubai/.test(d.querySelector('.map-box').closest('.fx-card').textContent)); ok('the top countries / regions / cities lists switch between registered people and visitors who did not register');
  segBtns[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  const svg = d.querySelector('.map-box svg'), vb0 = svg.getAttribute('viewBox'); const mapBtn = (t) => [...d.querySelectorAll('.map-tools button')].find((b) => b.textContent === t);
  mapBtn('+').dispatchEvent(new w.Event('click', { bubbles: true })); const vb1 = svg.getAttribute('viewBox').split(' ').map(Number); assert(vb1[2] < Number(vb0.split(' ')[2])); mapBtn('World').dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual(svg.getAttribute('viewBox').split(' ').map(Number)[2], 1000);  mapBtn('India').dispatchEvent(new w.Event('click', { bubbles: true })); const vbIndia = svg.getAttribute('viewBox').split(' ').map(Number); assert(vbIndia[2] < 200);
  const kochi = [((76.26 + 180) / 360) * 1000, ((90 - 9.93) / 180) * 500];                    // the map's own projection
  assert(kochi[0] >= vbIndia[0] && kochi[0] <= vbIndia[0] + vbIndia[2] && kochi[1] >= vbIndia[1] && kochi[1] <= vbIndia[1] + vbIndia[3], 'India includes Kerala (Kochi), not just the north: ' + vbIndia.join(',') + ' vs ' + kochi.join(','));
  ok('map zoom: + zooms in, World shows everything, India shows the whole country (Kerala to Kashmir)');
  dots[0].dispatchEvent(new w.Event('click', { bubbles: true })); assert(/Kochi, Kerala, India: 2 registered · 2 did not register/.test(d.querySelector('.map-tip').textContent)); ok('clicking a circle names the city and gives the numbers of both layers at that place');
  const mapCardEl = d.querySelector('.map-box').closest('.fx-card');
  const perBtns = [...mapCardEl.querySelectorAll('.geo-period button')]; assert.deepStrictEqual(perBtns.map((b) => b.textContent), ['Today', 'Last 24 hours', 'Yesterday', 'Last 2 days', 'Last 7 days', 'Last 14 days', 'Last 30 days', 'Last 90 days', 'All time', 'Same as the page period']);
  assert.strictEqual(perBtns.find((b) => b.getAttribute('aria-pressed') === 'true').textContent, 'Same as the page period', 'the map opens on the same period as the page');
  [...mapCardEl.querySelectorAll('[data-fs]')][0].dispatchEvent(new w.Event('click', { bubbles: true })); assert(mapCardEl.classList.contains('fs-open') && d.documentElement.classList.contains('fs-lock'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(!mapCardEl.classList.contains('fs-open') && !d.documentElement.classList.contains('fs-lock')); ok('full screen opens a card over the page and Escape closes it');

  // line charts: zoom buttons + full screen exist and change what is drawn
  await until(() => d.querySelector('#chartCourse path')); const card = d.getElementById('wrapCourse').closest('.fx-card'); const tools = card.querySelector('.ztools'); assert(tools && [...tools.querySelectorAll('button')].map((b) => b.textContent).join('|').includes('+|−'));
  const ticks = () => d.querySelectorAll('#chartCourse text.tk').length; const before = [...d.querySelectorAll('#chartCourse text.tk')].map((t) => t.textContent).join(',');
  [...tools.querySelectorAll('button')].find((b) => b.textContent === '+').dispatchEvent(new w.Event('click', { bubbles: true })); const after = [...d.querySelectorAll('#chartCourse text.tk')].map((t) => t.textContent).join(',');
  assert.notStrictEqual(before, after); const reset = [...tools.querySelectorAll('button')].find((b) => b.textContent === 'Reset zoom'); assert(!reset.hidden); reset.dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual([...d.querySelectorAll('#chartCourse text.tk')].map((t) => t.textContent).join(','), before); assert(ticks() > 0);
  ok('every line chart has zoom in / out / reset (the axis shows fewer days when zoomed) and a full screen button'); 
  const fsBtn = tools.querySelector('[data-fs]'); fsBtn.dispatchEvent(new w.Event('click', { bubbles: true })); assert(card.classList.contains('fs-open')); fsBtn.dispatchEvent(new w.Event('click', { bubbles: true })); assert(!card.classList.contains('fs-open')); ok('a chart opens full screen and closes again');
  /* every other graph (donuts, ranked bars, heatmap, funnel, tables) gets Full screen + zoom automatically */
  const VIS = 'svg, .rank, .heat, .heatmap, .funnel, .donut-row, table, canvas, .chart-wrap, .spark';
  const lacking = () => [...d.querySelectorAll('.fx-card')].filter((c) => !c.matches('.filterbar, .linkfind') && c.querySelector(VIS) && !c.querySelector('[data-fs]'));
  await until(() => d.querySelectorAll('.fx-card.fs-auto').length >= 5 && !lacking().length, 8000);          // cards drawn later are picked up within a fraction of a second
  const missing = lacking();
  assert.strictEqual(missing.length, 0, 'cards without a Full screen button: ' + missing.map((c) => (c.querySelector('h2') || {}).textContent).join(', '));
  assert(d.querySelectorAll('.fx-card [data-fs]').length >= 8);
  const auto = d.querySelector('.fx-card.fs-auto'); auto.querySelector('[data-fs]').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert(auto.classList.contains('fs-open')); await until(() => auto.style.getPropertyValue('--fs-zoom') === '1.4'); assert.strictEqual(auto.style.getPropertyValue('--fs-zoom'), '1.4');
  auto.querySelector('[aria-label="Zoom in"]').dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual(auto.style.getPropertyValue('--fs-zoom'), '1.6');
  auto.querySelector('[aria-label="Zoom out"]').dispatchEvent(new w.Event('click', { bubbles: true })); auto.querySelector('[aria-label="Zoom out"]').dispatchEvent(new w.Event('click', { bubbles: true })); assert.strictEqual(auto.style.getPropertyValue('--fs-zoom'), '1.2');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await until(() => !auto.style.getPropertyValue('--fs-zoom')); assert(!auto.classList.contains('fs-open') && !auto.style.getPropertyValue('--fs-zoom'));
  ok('every graph card on the analytics page has a Full screen button; the ones without their own zoom get + / - zoom while open, and close back to normal size with Escape');
  assert(!errs.length, errs.join(' | ')); ok('no script errors on the analytics page'); w.close(); server.close(); await db.close();
  console.log(`\nAll ${n} insights checks passed`);
})().catch((e) => { console.error('INSIGHTS TEST FAILED:', e); process.exit(1); });
