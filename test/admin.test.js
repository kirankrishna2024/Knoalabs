// Admin panel: login, session, dashboard data, Excel export. Run: npm test
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '100';
process.env.ADMIN_USERNAME = 'Kiran.Admin';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.ADMIN_LOGIN_MAX = '12';
process.env.TIMEZONE = 'Asia/Kolkata';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const auth = require('../src/auth');
const Admin = require('../src/models/Admin');
const Lead = require('../src/models/Lead');
const { createApp, seedAdmin } = require('../server');
const time = require('../src/time');

(async () => {
  let n = 0; const ok = (m) => console.log(`  ✓ A${++n}. ${m}`);

  /* ---- pure helpers ---- */
  const h = await auth.hashPassword('pw-123456789');
  assert(h.startsWith('scrypt$') && !h.includes('pw-123456789')); assert(await auth.verifyPassword('pw-123456789', h)); assert(!(await auth.verifyPassword('pw-123456780', h))); assert(!(await auth.verifyPassword('x', 'garbage')));
  ok('passwords: salted scrypt hash, right password passes, wrong/garbage fails');
  const tok = auth.signSession('s'.repeat(32), { username: 'a', passwordHash: h, hours: 1 });
  assert.strictEqual(auth.readSession('s'.repeat(32), tok).username, 'a'); assert.strictEqual(auth.readSession('t'.repeat(32), tok), null);
  assert.strictEqual(auth.readSession('s'.repeat(32), tok.slice(0, -2) + 'xx'), null); assert.strictEqual(auth.readSession('s'.repeat(32), auth.signSession('s'.repeat(32), { username: 'a', passwordHash: h, hours: -1 })), null);
  ok('sessions: tampered, wrong-secret and expired tokens are rejected');
  assert.strictEqual(time.ymd('Asia/Kolkata', new Date('2026-10-14T19:00:00Z')), '2026-10-15'); assert.strictEqual(time.startOfDay('Asia/Kolkata', new Date('2026-10-14T19:00:00Z')).toISOString(), '2026-10-14T18:30:00.000Z');
  assert.strictEqual(time.parseYMD('2026-02-30'), null); ok('time zone helpers: India day boundaries, invalid dates rejected');

  /* ---- app ---- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false });
  await seedAdmin();
  assert.strictEqual(await Admin.count(), 1); assert.strictEqual((await Admin.findByUsername('kiran.admin')).username, 'kiran.admin'); ok('first admin is created from ADMIN_USERNAME / ADMIN_PASSWORD (hashed, lower-case ID)');
  assert(!(await Admin.findByUsername('kiran.admin')).password_hash.includes('correct-horse')); await seedAdmin(); assert.strictEqual(await Admin.count(), 1); ok('seeding again does not duplicate or overwrite');

  const day = (i) => new Date(Date.now() - i * 86400e3);
  const mk = (o) => Lead.create({ first_name: 'F', last_name: 'L', full_name: 'F L', phone: '+919000000000', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', ...o });
  await mk({ first_name: 'Asha', full_name: 'Asha Nair', phone: '+919876543210', email: 'asha@example.com', college_name: 'MES College', course: 'Cyber Security', course_slug: 'cybersecurity', page_url: 'https://x.test/cybersecurity' });
  await mk({ first_name: 'Ravi', full_name: 'Ravi Kumar', phone: '+919876543211', status: 'Working Professional', student_course: null, student_status: null, experience_level: '2-5 yrs', job_role: 'QA / Tester', current_company: 'Acme Labs', course: 'Data Science', course_slug: 'datascience', ip: '9.9.9.9', user_agent: 'UA' });
  await mk({ first_name: '=cmd', full_name: '=cmd|calc', phone: '+919876543212', course: null, course_slug: null });
  await db.query("UPDATE leads SET created_at = $1 WHERE first_name = '=cmd'", [day(20)]);
  // extra leads so the live analytics course-wise series is non-empty and filterable
  await mk({ first_name: 'Kai', full_name: 'Kai Nair', phone: '+919876543213', status: 'Working Professional', student_course: null, student_status: null, experience_level: '0-2 yrs', job_role: 'Data Analyst / Scientist', current_company: 'ByteLab', course: 'Generative AI', course_slug: 'generativeai', page_url: 'https://x.test/generative-ai' });
  await db.query("UPDATE leads SET created_at = $1 WHERE first_name = 'Kai'", [day(1)]);
  await mk({ first_name: 'Mira', full_name: 'Mira Shah', phone: '+919876543214', status: 'Student / Fresher', student_course: 'B.Tech / BE', student_status: 'Final year', college_name: 'XYZ Institute', course: 'Generative AI', course_slug: 'generativeai', page_url: 'https://x.test/generative-ai' });
  await db.query("UPDATE leads SET created_at = $1 WHERE first_name = 'Mira'", [day(3)]);
  await mk({ first_name: 'Om', full_name: 'Om PK', phone: '+919876543215', status: 'Student / Fresher', student_course: 'MCA', student_status: 'Graduated (fresher)', college_name: 'ABC College', course: 'Cyber Security', course_slug: 'cybersecurity', page_url: 'https://x.test/cybersecurity' });
  await db.query("UPDATE leads SET created_at = $1 WHERE first_name = 'Om'", [day(5)]);

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const J = { 'Content-Type': 'application/json' };
  const login = (u, p) => fetch(base + '/admin/api/login', { method: 'POST', headers: J, body: JSON.stringify({ username: u, password: p }) });

  /* ---- guarded without login ---- */
  let r = await fetch(base + '/admin', { redirect: 'manual' });
  assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/admin/login'); ok('/admin without login redirects to /admin/login');
  for (const u of ['/admin/api/stats', '/admin/api/leads', '/admin/api/leads.xlsx', '/admin/api/me']) assert.strictEqual((await fetch(base + u)).status, 401, u);
  ok('every admin API returns 401 without a session');
  r = await fetch(base + '/admin/login'); const html = await r.text();
  assert.strictEqual(r.status, 200); assert(html.includes('Admin ID') && html.includes('Password')); assert(/script-src 'self'/.test(r.headers.get('content-security-policy'))); assert.strictEqual(r.headers.get('cache-control'), 'no-store'); ok('login page: ID + password form, strict CSP, not cached');
  assert.strictEqual((await fetch(base + '/admin/assets/admin.css')).status, 200); assert.strictEqual((await fetch(base + '/admin/assets/../views/dashboard.html')).status, 404); assert.strictEqual((await fetch(base + '/admin/dashboard.html')).status, 404); ok('dashboard HTML cannot be fetched directly, only styles/scripts are public');

  /* ---- login ---- */
  r = await login('kiran.admin', 'wrong-password-here'); assert.strictEqual(r.status, 401); assert(!r.headers.get('set-cookie')); assert.strictEqual((await r.json()).error, 'Incorrect ID or password.'); ok('wrong password: 401, no cookie');
  r = await login('nobody', 'correct-horse-battery'); assert.strictEqual(r.status, 401); assert.strictEqual((await r.json()).error, 'Incorrect ID or password.'); ok('unknown ID gets the same message (does not reveal which IDs exist)');
  r = await login('', ''); assert.strictEqual(r.status, 400); r = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }); assert.strictEqual(r.status, 415); ok('empty input 400, non-JSON 415');
  r = await login(' KIRAN.admin ', 'correct-horse-battery'); assert.strictEqual(r.status, 200);
  const setCookie = r.headers.get('set-cookie'); assert(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\/admin/.test(setCookie) && /Max-Age=28800/.test(setCookie)); ok('right ID (any case) + password: 200, cookie is HttpOnly, SameSite=Strict, scoped to /admin, 8h');
  const cookie = setCookie.split(';')[0]; const C = { Cookie: cookie };
  assert(!cookie.includes('correct-horse') && !cookie.includes('scrypt')); ok('cookie holds no password or hash');
  assert((await Admin.findByUsername('kiran.admin')).last_login_at); ok('last login time recorded');

  r = await fetch(base + '/admin', { headers: C }); assert.strictEqual(r.status, 200); const dash = await r.text(); assert(dash.includes('Export to Excel') && dash.includes('data-stat="total"')); assert.strictEqual(r.headers.get('cache-control'), 'no-store'); ok('dashboard opens after login');
  r = await fetch(base + '/admin/login', { headers: C, redirect: 'manual' }); assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/admin'); ok('login page sends a signed-in admin straight to the dashboard');
  r = await fetch(base + '/admin/api/me', { headers: C }); assert.strictEqual((await r.json()).username, 'kiran.admin'); ok('/me returns the signed-in ID');
  r = await fetch(base + '/admin/api/me', { headers: { Cookie: 'knoa_admin=' + cookie.split('=')[1].slice(0, -3) + 'abc' } }); assert.strictEqual(r.status, 401); ok('forged cookie rejected');

  /* ---- dashboard numbers ---- */
  let j = await (await fetch(base + '/admin/api/stats', { headers: C })).json();
  assert(j.ok); assert.strictEqual(j.total, 6); assert.strictEqual(j.today, 2); assert.strictEqual(j.last7, 5); assert.strictEqual(j.last30, 6); ok('lead counts: total 6, today 2, last 7 days 5, last 30 days 6');
  assert.strictEqual(j.byStatus.find((x) => x.status === 'Working Professional').n, 2); assert.strictEqual(j.byStatus.find((x) => x.status === 'Student / Fresher').n, 4); assert(!('trend' in j), 'the 14-day trend is gone'); ok('breakdown by "I am a" (no 14-day trend any more)');
  const fl = await (await fetch(base + '/admin/api/filters', { headers: C })).json();
  assert(fl.ok && fl.statuses.includes('Student / Fresher') && fl.statuses.includes('Working Professional')); assert(fl.courses.some((x) => x.slug === 'generativeai') && fl.courses.some((x) => x.slug === '__none'));
  assert.strictEqual((await fetch(base + '/admin/api/filters')).status, 401); ok('/filters lists both "I am a" choices and every master class / form (needs sign-in)');
  // generative-ai must now appear in the by-course breakdown
  assert(j.byCourse.some((x) => x.course_slug === 'generativeai'), 'Generative AI is listed by master class'); ok('Generative AI appears in by-course breakdown');

  j = await (await fetch(base + '/admin/api/leads?pageSize=10', { headers: C })).json();
  assert.strictEqual(j.total, 6); assert.strictEqual(j.rows.length, 6); assert.strictEqual(j.pages, 1); assert.strictEqual(j.rows[2].first_name, 'Kai');
  assert.strictEqual((await (await fetch(base + '/admin/api/leads?pageSize=2', { headers: C })).json()).pageSize, 25);
  const p2 = await (await fetch(base + '/admin/api/leads?pageSize=10&page=2', { headers: C })).json(); assert.strictEqual(p2.rows.length, 0); assert.strictEqual(p2.total, 6); assert(!('ip' in j.rows[0]) && !('user_agent' in j.rows[0]) && !('client_id' in j.rows[0])); ok('lead list is paginated and hides IP / user agent');
  j = await (await fetch(base + '/admin/api/leads?status=' + encodeURIComponent('Working Professional'), { headers: C })).json(); assert.strictEqual(j.total, 2); assert.strictEqual(j.rows[0].job_role, 'QA / Tester');
  j = await (await fetch(base + '/admin/api/leads?course=datascience', { headers: C })).json(); assert.strictEqual(j.total, 1);
  j = await (await fetch(base + '/admin/api/leads?course=__none', { headers: C })).json(); assert.strictEqual(j.total, 1);
  j = await (await fetch(base + '/admin/api/leads?q=acme', { headers: C })).json(); assert.strictEqual(j.total, 1);
  const iso = (d) => time.ymd('Asia/Kolkata', d);
  j = await (await fetch(base + `/admin/api/leads?from=${iso(day(1))}&to=${iso(new Date())}`, { headers: C })).json(); assert.strictEqual(j.total, 3);
  j = await (await fetch(base + `/admin/api/leads?to=${iso(day(10))}`, { headers: C })).json(); assert.strictEqual(j.total, 1);
  j = await (await fetch(base + '/admin/api/leads?status=Hacker&course=%27%3Bdrop&from=nonsense', { headers: C })).json(); assert.strictEqual(j.total, 6);
  ok('filters: status, course, no-course, search, date range; junk filter values are ignored safely');

  /* ---- Excel export ---- */
  r = await fetch(base + '/admin/api/leads.xlsx', { headers: C });
  assert.strictEqual(r.status, 200); assert(r.headers.get('content-type').includes('spreadsheetml.sheet')); assert(/attachment; filename="knoalabs-leads-\d{4}-\d{2}-\d{2}\.xlsx"/.test(r.headers.get('content-disposition')));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const ws = wb.getWorksheet('Leads'); assert.strictEqual(ws.rowCount, 7); const head = ws.getRow(1).values.slice(1);
  assert(['Registered on', 'Mobile / WhatsApp', 'I am a', 'College (student)', 'Role / domain (professional)', 'Master class', 'Page link'].every((x) => head.includes(x)));
  assert(!head.some((x) => /^(IP|User agent)/i.test(x))); ok('Excel file: "Leads" sheet with header + 6 rows, readable column names, no IP / user agent');
  const rowOf = (name) => { let f; ws.eachRow((row, i) => { if (i > 1 && row.getCell(3).value === name) f = row; }); return f; };
  const ravi = rowOf('Ravi'); assert.strictEqual(ravi.getCell(5).value, '+919876543211'); assert.strictEqual(ravi.getCell(12).value, '2–5 yrs'); assert.strictEqual(ravi.getCell(13).value, 'QA / Tester'); assert(ravi.getCell(2).value instanceof Date); ok('phone kept as text with +91, real date cell, professional columns filled');
  assert.strictEqual(typeof rowOf('=cmd').getCell(3).value, 'string'); assert.strictEqual(rowOf('=cmd').getCell(3).type, ExcelJS.ValueType.String); ok('a name starting with "=" is stored as text, never as a formula');
  const sm = wb.getWorksheet('Summary'); let txt = ''; sm.eachRow((row) => { txt += row.values.slice(1).join('|') + '\n'; });
  assert(txt.includes('Leads in this file|6') && txt.includes('Cyber Security|2') && txt.includes('Generative AI|2')); ok('"Summary" sheet with counts');
  r = await fetch(base + '/admin/api/leads.xlsx?status=' + encodeURIComponent('Working Professional'), { headers: C });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(Buffer.from(await r.arrayBuffer())); assert.strictEqual(wb2.getWorksheet('Leads').rowCount, 3);
  let t2 = ''; wb2.getWorksheet('Summary').eachRow((row) => { t2 += row.values.slice(1).join('|') + '\n'; }); assert(t2.includes('Working Professional')); ok('export follows the filters on screen (2 leads) and says which filters were used');

  /* ---- live analytics (before logout: it needs the session) ---- */
  assert.strictEqual((await fetch(base + '/admin/analytics', { redirect: 'manual' })).status, 302); assert.strictEqual((await fetch(base + '/admin/api/analytics')).status, 401); ok('analytics page redirects and analytics API returns 401 without login');
  const AN = async (q = '') => { const x = await fetch(base + '/admin/api/analytics' + q, { headers: C }); assert.strictEqual(x.status, 200, q); return x.json(); };
  let a = await AN();
  assert(a.ok); assert.strictEqual(a.window.days, 14); assert.strictEqual(a.labels.length, 14); assert(Array.isArray(a.series)); assert(a.series.every((s) => s.data.length === 14)); ok('analytics: ok, 14-day window, one 14-point daily line per master class');
  const line = (x, slug) => x.series.find((s) => s.course_slug === slug);
  assert.strictEqual(line(a, 'generativeai').name, 'Generative AI'); assert.strictEqual(line(a, 'generativeai').total, 2); assert.strictEqual(line(a, 'cybersecurity').total, 2); assert.strictEqual(line(a, 'datascience').total, 1); assert.strictEqual(line(a, null).total, 0);
  assert.strictEqual(line(a, 'generativeai').data[13 - 1] + line(a, 'generativeai').data[13 - 3] + line(a, 'generativeai').data[13], 2); ok('Cyber Security 2, Data Science 1, Generative AI 2 (placed on the right days); the 20-day-old no-course lead is outside the window');
  assert.strictEqual(a.totals.allTime, 6); assert.strictEqual(a.totals.window, 5); assert.strictEqual(a.totals.today, 2); assert.strictEqual(a.totals.last7, 5); assert.strictEqual(a.totals.last30, 6);
  const st = await (await fetch(base + '/admin/api/stats', { headers: C })).json(); assert.strictEqual(a.totals.today, st.today); assert.strictEqual(a.totals.allTime, st.total); ok('analytics totals agree with the leads dashboard (all time 6, today 2, 7 days 5, 30 days 6)');
  assert.strictEqual(a.overall.reduce((x, y) => x + y, 0), a.totals.window); assert.strictEqual(a.matrix.rows.reduce((x, r) => x + r.total, 0), a.totals.window); assert.strictEqual(a.byHour.reduce((x, y) => x + y, 0), a.totals.window); ok('every breakdown (daily, matrix, hour of day) adds up to the same window total');
  let af = await AN('?status=' + encodeURIComponent('Student / Fresher')); assert.strictEqual(af.totals.allTime, 4); assert.strictEqual(af.totals.window, 3); assert.strictEqual(af.statusSeries.length, 1); ok('filter "I am a" = Student / Fresher');
  af = await AN('?status=' + encodeURIComponent('Working Professional')); assert.strictEqual(af.totals.allTime, 2); assert.strictEqual(af.professionals.roles.length, 2); ok('filter "I am a" = Working Professional');
  for (const [slug, total] of [['cybersecurity', 2], ['datascience', 1], ['generativeai', 2], ['__none', 1]]) { af = await AN('?course=' + slug); assert.strictEqual(af.totals.allTime, total, slug); assert.strictEqual(af.series.length, 1); }
  ok('filter by master class: Cyber Security, Data Science, Generative AI and "no course in link" each show only their own leads');
  af = await AN('?course=generativeai&status=' + encodeURIComponent('Working Professional')); assert.strictEqual(af.totals.allTime, 1); assert.strictEqual(af.totals.window, 1); ok('combination: Generative AI + Working Professional = 1 (Kai)');
  af = await AN('?course=cybersecurity&status=' + encodeURIComponent('Working Professional')); assert.strictEqual(af.totals.allTime, 0); assert.strictEqual(af.totals.window, 0); assert.strictEqual(af.byCourse.length, 0); ok('combination with no leads returns zeros, not an error');
  af = await AN('?days=30'); assert.strictEqual(af.labels.length, 30); assert.strictEqual(af.totals.window, 6); af = await AN('?days=7'); assert.strictEqual(af.labels.length, 7); assert.strictEqual(af.totals.window, 5); ok('7 / 30 day windows');
  af = await AN(`?from=${iso(day(4))}&to=${iso(new Date())}`); assert.strictEqual(af.window.days, 5); assert.strictEqual(af.window.custom, true); assert.strictEqual(af.totals.window, 4); ok('custom from / to range: 5 days, only the leads inside it');
  af = await AN('?status=Hacker&course=%27%3Bdrop&from=nonsense&days=abc'); assert(af.ok); assert.strictEqual(af.window.days, 14); assert.strictEqual(af.totals.allTime, 6); ok('junk filter values are ignored safely');
  assert.strictEqual(a.recent[0].full_name.length > 0, true); assert(!JSON.stringify(a).includes('9876543210')); assert(!JSON.stringify(a).includes('asha@example.com')); ok('analytics response carries no phone numbers or e-mail addresses');
  r = await fetch(base + '/admin/analytics', { headers: C }); assert.strictEqual(r.status, 200); const an = await r.text();
  assert(an.includes('Live analytics') && an.includes('id="chartCourse"') && an.includes('id="segStatus"') && an.includes('id="chipCourse"') && an.includes('id="winDays"')); assert.strictEqual(r.headers.get('cache-control'), 'no-store'); ok('live analytics page renders: I-am-a filter, master class chips, period, line charts; never cached');
  assert.strictEqual((await fetch(base + '/admin/assets/analytics.js')).status, 200); assert.strictEqual((await fetch(base + '/admin/analytics.html')).status, 404); ok('analytics.js is served; analytics.html is only reachable through the signed-in route');
  assert.deepStrictEqual(st.courses.map((c) => c.slug), ['datascience', 'cybersecurity', 'generativeai', '__none']); ok('leads dashboard filter lists every master class even before it has a lead');

  /* ---- master classes: add, link, use, delete ---- */
  const K = C;
  for (const [m, u] of [['GET', '/admin/api/courses'], ['POST', '/admin/api/courses'], ['DELETE', '/admin/api/courses/machinelearning'], ['DELETE', '/admin/api/leads/1']]) { r = await fetch(base + u, { method: m, headers: { ...J } }); assert.strictEqual(r.status, 401, m + u); }
  ok('course and delete APIs are locked behind the login');
  let cj = await (await fetch(base + '/admin/api/courses', { headers: K })).json();
  assert(cj.ok); assert.deepStrictEqual(cj.courses.map((c) => c.slug), ['datascience', 'cybersecurity', 'generativeai']); assert(cj.courses.every((c) => c.is_default)); assert.strictEqual(cj.courses[2].url, base + '/generative-ai'); assert.strictEqual(cj.plain.url, base + '/');
  assert.strictEqual(cj.courses.find((c) => c.slug === 'generativeai').leads, 2); ok('defaults listed with their links: /datascience, /cybersecurity, /generative-ai, plus the plain link; lead counts shown');
  r = await fetch(base + '/admin/api/courses', { method: 'POST', headers: { ...J, ...K }, body: JSON.stringify({ name: '  Machine   Learning ' }) }); j = await r.json();
  assert.strictEqual(r.status, 201); assert.strictEqual(j.course.name, 'Machine Learning'); assert.strictEqual(j.course.slug, 'machinelearning'); assert.strictEqual(j.course.url, base + '/machine-learning'); assert.strictEqual(j.course.is_default, false); ok('adding "Machine Learning" returns the link /machine-learning (spaces tidied)');
  for (const bad of ['', 'x', 'a'.repeat(61), '###', 'தமிழ்', 'Machine Learning', 'data science', 'ds', 'Admin', '<b>x</b>']) { r = await fetch(base + '/admin/api/courses', { method: 'POST', headers: { ...J, ...K }, body: JSON.stringify({ name: bad }) }); assert([409, 422].includes(r.status), JSON.stringify(bad) + ' -> ' + r.status); assert.strictEqual((await r.json()).ok, false); }
  ok('empty, too short/long, symbol-only, non-English-only, duplicate, reserved and markup names are refused with a message');
  r = await fetch(base + '/admin/api/courses', { method: 'POST', headers: K, body: '{}' }); assert.strictEqual(r.status, 415); ok('course create needs JSON');
  r = await fetch(base + '/machine-learning'); let pg = await r.text(); assert.strictEqual(r.status, 200);
  assert(pg.includes('<title>Register for the Machine Learning Master Class | KnoaLabs</title>') && pg.includes('data-course-name="Machine Learning"')); ok('the new link opens the form for that master class (heading source: Register for the Machine Learning Master Class)');
  r = await fetch(base + '/api/leads', { method: 'POST', headers: J, body: JSON.stringify({ first_name: 'New', last_name: 'Course', country: 'IN', phone: '9876599001', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: 'machine-learning' }) });
  assert.strictEqual(r.status, 201); let ml = await Lead.findById((await r.json()).id); assert.strictEqual(ml.course, 'Machine Learning'); assert.strictEqual(ml.course_slug, 'machinelearning'); ok('a lead from the new link is stored under "Machine Learning"');
  const aml = await (await fetch(base + '/admin/api/analytics?course=machinelearning', { headers: K })).json(); assert.strictEqual(aml.totals.allTime, 1); assert(aml.courses.some((c) => c.slug === 'machinelearning')); ok('the new master class appears in analytics (chips, filter) straight away');
  const st2 = await (await fetch(base + '/admin/api/stats', { headers: K })).json(); assert(st2.courses.some((c) => c.slug === 'machinelearning')); ok('and in the leads dashboard filter');
  r = await fetch(base + '/admin/api/courses/datascience', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 400); r = await fetch(base + '/admin/api/courses/nope', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 404); r = await fetch(base + '/admin/api/courses/%27%3B--', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 404); ok('default master classes cannot be deleted; unknown or malformed slugs give 404');
  r = await fetch(base + '/admin/api/courses/machinelearning', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 200);
  cj = await (await fetch(base + '/admin/api/courses', { headers: K })).json(); assert(!cj.courses.some((c) => c.slug === 'machinelearning')); assert.strictEqual((await Lead.findById(ml.id)).course, 'Machine Learning'); ok('deleting a custom master class removes the link but keeps its leads');

  /* ---- delete a lead ---- */
  const before = (await fetch(base + '/admin/api/stats', { headers: K }).then((x) => x.json())).total;
  r = await fetch(base + '/admin/api/leads/' + ml.id, { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 200); assert.strictEqual(await Lead.findById(ml.id), null);
  assert.strictEqual((await fetch(base + '/admin/api/stats', { headers: K }).then((x) => x.json())).total, before - 1); ok('DELETE /admin/api/leads/:id removes exactly that lead and the counts drop');
  r = await fetch(base + '/admin/api/leads/' + ml.id, { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 404); r = await fetch(base + '/admin/api/leads/abc', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 404); r = await fetch(base + '/admin/api/leads/1%20OR%201=1', { method: 'DELETE', headers: K }); assert.strictEqual(r.status, 404);
  assert.strictEqual((await fetch(base + '/admin/api/stats', { headers: K }).then((x) => x.json())).total, before - 1); ok('deleting twice or with a malformed id is a 404 and deletes nothing else');
  const dpage = await (await fetch(base + '/admin', { headers: K })).text(); const djs = await (await fetch(base + '/admin/assets/dashboard.js')).text();
  assert(!dpage.includes('id="linksMount"') && !dpage.includes('/admin/assets/links.js') && dpage.includes('/admin/assets/kit.js') && /<th class="act">Delete<\/th>/.test(dpage) && djs.includes("method: 'DELETE'") && djs.includes('KnoaUI.confirm')); ok('leads page has no master class links block, loads the shared UI kit and keeps a Delete button on each lead (with a confirm dialog)');
  const apage = await (await fetch(base + '/admin/analytics', { headers: K })).text(); for (const id of ['adTable', 'heat', 'dayTable', 'donutChannel', 'chartChannel', 'spend', 'signals', 'chipCampaign', 'selChannel', 'selMedium', 'crumbs', 'tree', 'chartCampaign', 'campTable']) assert(apage.includes(`id="${id}"`), id);
  assert(!apage.includes('id="linksMount"') && !apage.includes('/admin/assets/builder.js') && !apage.includes('/admin/assets/qr.js'));
  ok('analytics page has no master class links block or builder, and keeps the ad table, heatmap, day-by-day table, channel charts and ad-spend field');
  const an2 = await (await fetch(base + '/admin/api/analytics', { headers: K })).json(); for (const k of ['channels', 'channelSeries', 'campaigns', 'mediums', 'devices', 'countries', 'adTable', 'heatmap', 'previousOverall', 'quality', 'colleges', 'campaignTable', 'campaignSeries', 'tree', 'facets']) assert(k in an2, k);
  assert(!JSON.stringify(an2).includes('@example.com') && !JSON.stringify(an2).includes('Mozilla')); ok('analytics API carries the ad breakdowns but no e-mail addresses or user-agent strings');

  const anc = await (await fetch(base + '/admin/api/analytics?course=cybersecurity&campaign=__none&channel=Direct%20%2F%20no%20tag&medium=__none', { headers: K })).json();
  assert(anc.ok); assert.strictEqual(anc.filters.course, 'cybersecurity'); assert.strictEqual(anc.filters.campaign, '__none'); assert.strictEqual(anc.filters.channel, 'Direct / no tag'); assert.strictEqual(anc.filters.medium, '__none');
  const inj = await fetch(base + '/admin/api/analytics?campaign=%27%3B%20DROP%20TABLE%20leads%3B--', { headers: K }); assert.strictEqual(inj.status, 200); assert.strictEqual((await inj.json()).totals.window, 0);
  const all0 = await (await fetch(base + '/admin/api/analytics', { headers: K })).json();
  const odd = await fetch(base + '/admin/api/analytics?campaign=a&campaign=b&medium[x]=1', { headers: K }); const oddJ = await odd.json(); assert.strictEqual(odd.status, 200); assert.strictEqual(oddJ.filters.campaign, null); assert.strictEqual(oddJ.totals.window, all0.totals.window);
  assert.strictEqual((await db.query('SELECT COUNT(*)::int AS c FROM leads')).rows[0].c >= 5, true); ok('analytics API accepts campaign / channel / medium filters; injection text matches nothing and breaks nothing; repeated or nested params are ignored');

  const bj = await (await fetch(base + '/admin/assets/builder.js', { headers: K })).text();
  assert(bj.includes('var MEDIUMS = [') && bj.includes("['paid'") && bj.includes("['cpc'") && bj.includes("sm = el('select', 'control sm')") && bj.includes("[OTHER, 'Other…']") && !bj.includes("sm.placeholder = 'paid'")); ok('ad link builder: Medium is a dropdown (paid, cpc, social, email, whatsapp, influencer, referral, organic, qr) with an "Other…" custom option');

  const Visit = require('../src/models/Visit');
  await Visit.record({ visitor_id: 'admin-test-visitor-1', course_slug: 'cybersecurity', utm_source: 'instagram', utm_campaign: 'cy-test' }); await Visit.record({ visitor_id: 'admin-test-visitor-2', course_slug: 'cybersecurity' });
  const cjv = await (await fetch(base + '/admin/api/courses', { headers: K })).json();
  assert.strictEqual(cjv.courses.find((c) => c.slug === 'cybersecurity').opens, 2); assert.strictEqual(cjv.courses.find((c) => c.slug === 'datascience').opens, 0); assert.strictEqual(cjv.plain.opens, 0); ok('master class links API returns link opens next to leads (shown on each link card)');
  const av = await (await fetch(base + '/admin/api/analytics?course=cybersecurity&days=60', { headers: K })).json();
  assert.strictEqual(av.visits.available, true); assert.strictEqual(av.visits.window, 2); assert(av.campaignTable.some((c) => c.campaign === 'cy-test' && c.opens === 1)); assert(!JSON.stringify(av).includes('admin-test-visitor')); ok('analytics API returns link opens and per-campaign opens, without visitor ids');
  const ap2 = await (await fetch(base + '/admin/analytics', { headers: K })).text(); assert(ap2.includes('data-stat="opens"') && ap2.includes('id="kOpens"')); ok('analytics page has the Link opens card');

  /* ---- logout + password change ---- */
  r = await fetch(base + '/admin/api/logout', { method: 'POST', headers: { ...J, ...C }, body: '{}' }); assert.strictEqual(r.status, 200); assert(/Max-Age=0/.test(r.headers.get('set-cookie'))); ok('logout clears the cookie');
  await Admin.upsert('kiran.admin', await auth.hashPassword('a-brand-new-password'));
  assert.strictEqual((await fetch(base + '/admin/api/me', { headers: C })).status, 401); ok('changing the password signs the old session out');
  assert.strictEqual((await login('kiran.admin', 'correct-horse-battery')).status, 401); assert.strictEqual((await login('kiran.admin', 'a-brand-new-password')).status, 200); ok('old password stops working, new one works');

  /* ---- brute force ---- */
  let limited = 0, hit = null;
  for (let i = 0; i < 30 && !limited; i++) { const x = await login('kiran.admin', 'guess-' + i); if (x.status === 429) { limited = i; hit = x; } }
  assert(limited > 0 && limited <= 12 && hit.headers.get('retry-after')); ok(`login is throttled per IP (429 + Retry-After after ${limited} tries)`);

  /* ---- public registration links: every ad link is live and stores the right master class ---- */
  const links = [['/cybersecurity', 'cybersecurity', 'Cyber Security'], ['/datascience', 'datascience', 'Data Science'], ['/generative-ai', 'generativeai', 'Generative AI'], ['/genai', 'generativeai', 'Generative AI'], ['/', null, null]];
  for (const [url, slug, name] of links) {
    r = await fetch(base + url); const page = await r.text(); assert.strictEqual(r.status, 200, url); assert(r.headers.get('content-security-policy')); assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
    if (name) assert(page.includes(`<title>Register for the ${name} Master Class | KnoaLabs</title>`) && page.includes(`data-course-name="${name}"`), url); else assert(page.includes('<title>Register for the Master Class | KnoaLabs</title>'));
    const body = { first_name: 'Link', last_name: 'Test' + (slug || 'plain'), country: 'IN', phone: '98765' + String(10000 + links.findIndex((l) => l[0] === url)), status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year', course: slug ? url.slice(1) : '' };
    const pr = await fetch(base + '/api/leads', { method: 'POST', headers: J, body: JSON.stringify(body) }); assert.strictEqual(pr.status, 201, url);
    const saved = await Lead.findById((await pr.json()).id); assert.strictEqual(saved.course_slug, slug); assert.strictEqual(saved.course, name);
  }
  ok('/cybersecurity, /datascience, /generative-ai, /genai and the plain link all open, carry the course in the page title, and save the right master class (plain link = none)');
  const cfgJs = await (await fetch(base + '/config.js')).text(); assert(cfgJs.includes('"aliases"') && cfgJs.includes('"generativeai":"Generative AI"')); ok('/config.js gives the browser the course names and aliases so /generative-ai shows "Generative AI" in the heading');
  assert.strictEqual((await fetch(base + '/robots.txt')).status, 404); ok('file-like paths are not treated as course links');

  server.close(); console.log(`\nAll ${n} admin checks passed`); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
