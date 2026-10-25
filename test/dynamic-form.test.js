// Each form decides what analytics shows: a question the form does not ask (or no longer asks) has no chart, filter or column on this page,
// removing a question never breaks registrations or the dashboard, and new custom questions get their own breakdown. Run: node test/dynamic-form.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '900'; process.env.ADMIN_USERNAME = 'dyn.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'w'.repeat(40); process.env.ADMIN_LOGIN_MAX = '50';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ D${++n}. ${m}`);
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } return null; };

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* binary */ } return { status: r.status, json, buf, headers: r.headers }; };
  cookie = (await call('POST', '/admin/api/login', { username: 'dyn.admin', password: 'correct-horse-battery' })).headers.get('set-cookie').split(';')[0];
  const ds = (await call('GET', '/admin/api/forms')).json.forms.find((f) => f.course_slug === 'datascience');

  /* a second master class whose form has no "I am a", no student / professional questions, and two custom questions */
  let r = await call('POST', '/admin/api/forms', { name: 'Cloud Basics' }); assert.strictEqual(r.status, 201); const cb = r.json.form;
  const def = JSON.parse(JSON.stringify((await call('GET', `/admin/api/forms/${cb.id}`)).json.working));
  const gone = ['status', 'student_course', 'student_status', 'college_name', 'specialization', 'experience', 'current_role', 'current_company', 'highest_qualification'];
  def.fields.forEach((f) => { if (gone.includes(f.key)) f.deleted = true; });
  def.fields.push({ key: 'city', label: 'Which city are you in?', type: 'select', section: 'about', width: 'full', required: false, options: [{ value: 'kochi', label: 'Kochi' }, { value: 'tvm', label: 'Trivandrum' }], order: 30 });
  def.fields.push({ key: 'goal', label: 'What do you want from the class?', type: 'multiselect', section: 'about', width: 'full', required: false, options: [{ value: 'job', label: 'Get a job' }, { value: 'skill', label: 'Learn a skill' }], order: 31 });
  assert.strictEqual((await call('PUT', `/admin/api/forms/${cb.id}/draft`, { definition: def })).status, 200); assert.strictEqual((await call('POST', `/admin/api/forms/${cb.id}/publish`, { note: 'no I am a' })).status, 200);
  const reg = (b) => fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36' }, body: JSON.stringify({ first_name: 'Asha', last_name: 'N', country: 'IN', ...b }) });
  assert.strictEqual((await reg({ course: 'cloudbasics', phone: '9000000101', city: 'kochi', goal: ['job', 'skill'] })).status, 201);
  assert.strictEqual((await reg({ course: 'cloudbasics', phone: '9000000102', city: 'kochi', goal: ['job'] })).status, 201);
  assert.strictEqual((await reg({ course: 'cloudbasics', phone: '9000000103', city: 'tvm' })).status, 201);
  assert.strictEqual((await reg({ course: 'datascience', phone: '9000000104', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year' })).status, 201);
  assert.strictEqual((await reg({ course: 'datascience', phone: '9000000105', status: 'Working Professional', experience: '2-5 yrs', current_role: 'Software Developer / Engineer', current_company: 'Acme' })).status, 201);
  ok('a form without "I am a" and the student / professional questions still registers people (it used to fail with HTTP 500), and its custom questions are stored');

  /* what each scope asks */
  r = await call('GET', '/admin/api/analytics/fields?days=7'); assert.strictEqual(r.json.has.status, true); assert.strictEqual(r.json.scope.all, true);
  assert.deepStrictEqual(r.json.fields.map((f) => f.key).sort(), ['city', 'goal']); assert.deepStrictEqual(r.json.fields.find((f) => f.key === 'city').forms.map((f) => f.slug), ['cloudbasics']);
  r = await call('GET', '/admin/api/analytics/fields?days=7&course=cloudbasics'); assert.strictEqual(r.json.scope.all, false); assert.strictEqual(r.json.has.status, false); assert.strictEqual(r.json.has.student_course, false); assert.strictEqual(r.json.has.job_role, false); assert.strictEqual(r.json.has.phone, true);
  const city = r.json.fields.find((f) => f.key === 'city'); assert.deepStrictEqual(city.values.map((v) => [v.name, v.n]), [['Kochi', 2], ['Trivandrum', 1]]); assert.strictEqual(city.answered, 3);
  const goal = r.json.fields.find((f) => f.key === 'goal'); assert.deepStrictEqual(goal.values.map((v) => [v.name, v.n]), [['Get a job', 2], ['Learn a skill', 1]]);
  r = await call('GET', '/admin/api/analytics/fields?days=7&course=datascience'); assert.strictEqual(r.json.has.status, true); assert.strictEqual(r.json.has.student_course, true); assert.deepStrictEqual(r.json.fields, []);
  ok('with a master class chosen only that form\'s questions count: no "I am a" / student / professional for Cloud Basics, none of its custom questions for Data Science; with none chosen the page defaults to all forms');

  /* the dashboard itself keeps working for leads that have no "I am a" */
  r = await call('GET', '/admin/api/analytics?days=7'); assert.strictEqual(r.json.totals.window, 5); r = await call('GET', '/admin/api/analytics?days=7&course=cloudbasics'); assert.strictEqual(r.json.totals.window, 3);
  r = await call('GET', '/admin/api/analytics/leads?days=7&course=cloudbasics'); assert.strictEqual(r.json.total, 3); assert(r.json.rows.every((x) => x.status == null && x.answers && x.answers.city));
  r = await call('GET', '/admin/api/leads'); assert.strictEqual(r.json.total, 5); ok('analytics, the leads list and the leads view count people who were never asked "I am a" and show their custom answers');

  /* removing a question: gone from analytics, kept in the data and the export */
  const def2 = JSON.parse(JSON.stringify((await call('GET', `/admin/api/forms/${cb.id}`)).json.working)); def2.fields.find((f) => f.key === 'city').deleted = true;
  assert.strictEqual((await call('PUT', `/admin/api/forms/${cb.id}/draft`, { definition: def2 })).status, 200); assert.strictEqual((await call('POST', `/admin/api/forms/${cb.id}/publish`, { note: 'city removed' })).status, 200);
  r = await call('GET', '/admin/api/analytics/fields?days=7&course=cloudbasics'); assert.deepStrictEqual(r.json.fields.map((f) => f.key), ['goal']);
  r = await call('GET', '/admin/api/analytics/fields?days=7'); assert.deepStrictEqual(r.json.fields.map((f) => f.key), ['goal']);
  const x = await call('GET', '/admin/api/leads.xlsx'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const sheet = wb.getWorksheet('Leads'); const heads = sheet.getRow(1).values.map(String);
  assert(heads.some((h) => /city/i.test(h) || /Which city/i.test(h)), 'the removed question is still a column in the Excel export'); ok('removing a question takes it off the analytics page everywhere, while its answers stay in the database and the Excel export');

  /* the screen: filter by master class and the unneeded parts disappear */
  const jar = new CookieJar(); jar.setCookieSync(cookie + '; Path=/', base);
  const open = async (p) => { const errs = []; const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { if (!/Could not load link/.test(String(e.message))) errs.push(String(e.message).slice(0, 200)); });
    const dom = await JSDOM.fromURL(base + p, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc, beforeParse(w) { w.fetch = (u, o = {}) => fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), Cookie: cookie } }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; } }); dom.errs = errs; return dom; };
  const off = (d, id) => d.getElementById(id).classList.contains('is-off');
  let dom = await open('/admin/analytics?days=7'), d = dom.window.document;
  await until(() => d.getElementById('answersSec').hidden === false);
  assert(!off(d, 'grpStatus') && !off(d, 'cardStatus') && !off(d, 'cardMatrix') && !off(d, 'cardStudents') && !off(d, 'cardPros')); ok('all master classes: every default panel is there (nothing is lost when no master class is chosen)');
  dom.window.close();
  dom = await open('/admin/analytics?days=7&course=cloudbasics'); d = dom.window.document;
  assert(await until(() => off(d, 'cardStatus')), 'status chart hidden');
  for (const id of ['grpStatus', 'cardStatus', 'cardMatrix', 'cardStudents', 'cardPros']) assert(off(d, id), id);
  assert(await until(() => d.getElementById('answersSec').hidden === false && /Which|What do you want/.test(d.getElementById('answersGrid').textContent === '' ? '' : d.getElementById('answersGrid').textContent) ));
  assert(/What do you want from the class/.test(d.getElementById('answersGrid').textContent) && !/Which city/.test(d.getElementById('answersGrid').textContent));
  assert(![...d.querySelectorAll('#dayTable thead th')].some((th) => /Students|Professionals/.test(th.textContent))); ok('Cloud Basics chosen: "I am a" filter, the I-am-a chart and table, student and professional panels and day-table columns are gone; its own question is shown');
  assert(!dom.errs.length, dom.errs.join(' | ')); dom.window.close();
  dom = await open('/admin/analytics?days=7&course=datascience'); d = dom.window.document;
  await until(() => d.getElementById('cardStatus') && !off(d, 'cardStatus')); await new Promise((r2) => setTimeout(r2, 600));
  assert(!off(d, 'grpStatus') && !off(d, 'cardStudents') && !off(d, 'cardPros') && d.getElementById('answersSec').hidden); ok('Data Science chosen: its panels are back and the Cloud Basics question is not shown');
  assert(!dom.errs.length, dom.errs.join(' | ')); dom.window.close();
  server.close(); console.log(`\nAll ${n} checks passed`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
