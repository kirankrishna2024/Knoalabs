// Public renderer (public/render.js): the default form must be the SAME DOM as the old hand-written form, client and server checks must agree,
// and the real page (served by the app, run in jsdom) must register a lead end to end.
// Run: node test/renderer.test.js
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_MAX = '500';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const migrate = require('../src/migrate');
const forms = require('../src/forms');
const F = require('../src/formdef');
const O = require('../src/options');
const { COUNTRIES } = require('../src/countries');
const K = require('../public/render.js');
const { createApp } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ R${++n}. ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(15); } return null; }

/* canonical form of a DOM subtree: tag, sorted attributes, children; whitespace-only text ignored */
function canon(node) {
  if (node.nodeType === 3) return node.nodeValue.trim() ? JSON.stringify(node.nodeValue.replace(/\s+/g, ' ')) : '';
  if (node.nodeType !== 1) return '';
  const attrs = [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
  return `<${node.tagName.toLowerCase()} ${attrs}>${[...node.childNodes].map(canon).join('')}</>`;
}
const CFG = { countries: COUNTRIES, statuses: O.STATUSES, statusSubtitles: O.STATUS_SUBTITLES, studentCourses: O.STUDENT_COURSES, studentStatuses: O.STUDENT_STATUSES, specializations: O.SPECIALIZATIONS,
  qualifications: O.QUALIFICATIONS, experienceOptions: O.EXPERIENCE, currentRoles: O.ROLES, courses: O.COURSES, aliases: O.ALIASES };
function legacyDom(name) {
  const dom = new JSDOM('<!doctype html><body class="bg-brand"><div id="formMount"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.KNOA_CONFIG = CFG; w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
  if (name) { w.document.body.dataset.course = 'cybersecurity'; w.document.body.dataset.courseName = name; }
  w.eval(fs.readFileSync(path.join(__dirname, 'fixtures', 'register.legacy.js'), 'utf8'));
  return w.document.getElementById('formMount');
}
function newDom(name, def = F.defaultDefinition()) {
  const dom = new JSDOM('<!doctype html><body><div id="formMount"></div></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const host = dom.window.document.getElementById('formMount');
  const pub = F.publicDefinition(def), copy = F.renderCopy(def, { name });
  host.innerHTML = K.formHTML(pub, { copy, name, countries: COUNTRIES, button: pub.copy.button, fine: pub.copy.fine }).html;
  return host;
}

(async () => {
  /* ---- 1. same DOM as the old form ---- */
  for (const name of ['Cyber Security', 'Data Science', null]) {
    const a = canon(legacyDom(name)), b = canon(newDom(name));
    if (a !== b) { // show the first difference
      let i = 0; while (a[i] === b[i]) i++;
      console.log('LEGACY:', a.slice(Math.max(0, i - 120), i + 160)); console.log('NEW   :', b.slice(Math.max(0, i - 120), i + 160));
    }
    assert.strictEqual(b, a, `DOM differs for ${name}`);
  }
  ok('the default definition draws exactly the same DOM as the old hand-written form (tags, attributes, text, order), with and without a master class name');

  /* ---- 2. client and server checks agree ---- */
  const def = F.defaultDefinition(), pub = F.publicDefinition(def);
  const phones = ['', '9876543210', '+91 98765 43210', '012345', '98765', 'abcdefghij', '0987654321'];
  const pick = (a, i) => a[i % a.length];
  let diffs = 0, total = 0;
  for (let i = 0; i < 1500; i++) {
    const status = pick(['', ...O.STATUSES, 'Other thing'], i * 7);
    const body = { first_name: pick(['', ' ', 'Asha', 'A'.repeat(80)], i), last_name: pick(['', 'K', 'Nair'], i * 3), country: pick(['IN', 'AE', 'US', 'x', ''], i * 5), phone: pick(phones, i * 11),
      email: pick(['', 'a@b.co', 'bad', ' a@b.co '], i * 13), status, student_course: pick(['', ...O.STUDENT_COURSES, 'Nope'], i * 17), student_status: pick(['', ...O.STUDENT_STATUSES], i * 19),
      college_name: pick(['', 'MES'], i), specialization: pick(['', ...O.SPECIALIZATIONS, 'Nope'], i * 23), experience: pick(['', ...O.EXPERIENCE, 'x'], i * 29), current_role: pick(['', ...O.ROLES, 'x'], i * 31),
      current_company: pick(['', 'Acme'], i * 3), highest_qualification: pick(['', ...O.QUALIFICATIONS, 'x'], i * 37) };
    const server = F.validateSubmission(def, body).errors, client = K.validate(pub, body, COUNTRIES).errors;
    total++; if (JSON.stringify(Object.entries(server).sort()) !== JSON.stringify(Object.entries(client).sort())) { diffs++; if (diffs < 4) console.log('DIFF', body, server, client); }
  }
  assert.strictEqual(diffs, 0); ok(`browser and server checks give the same errors and messages for the default form (${total} submissions, 0 differences)`);

  const custom = JSON.parse(JSON.stringify(def));
  custom.sections.push({ id: 'extra', title: 'Extra' });
  const mk = (key, type, extra) => Object.assign({ key, label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), type, section: 'extra', width: 'full', required: false, order: custom.fields.length }, extra);
  const add = (f) => { f.order = custom.fields.length; custom.fields.push(f); };
  add(mk('city', 'text', { required: true, minLength: 3, pattern: 'letters' })); add(mk('about_you', 'textarea', { maxLength: 50 })); add(mk('age', 'number', { required: true }));
  add(mk('birthday', 'date')); add(mk('website_url', 'url')); add(mk('agree', 'consent', { required: true })); add(mk('news', 'checkbox'));
  add(mk('interests', 'multiselect', { required: true, options: [{ value: 'ai', label: 'AI' }, { value: 'sec', label: 'Security' }] }));
  add(mk('pin', 'text', { pattern: 'pincode', showWhen: { field: 'status', op: 'eq', value: 'Student / Fresher' } }));
  add(mk('slot', 'select', { options: [{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Evening' }], showWhen: { field: 'status', op: 'in', value: ['Working Professional'] } }));
  assert.deepStrictEqual(F.validateDefinition(custom), []);
  const cp = F.publicDefinition(custom);
  const vals = ['', ' ', 'ab', 'Mumbai', 'Mu1', '12', '-3.5', 'x', '2026-02-30', '2026-03-01', 'https://a.co/x', 'ftp://x', '400001', '40000', 'ai', 'zz'];
  diffs = 0; total = 0;
  for (let i = 0; i < 1200; i++) {
    const body = { first_name: 'A', last_name: 'B', country: 'IN', phone: '9876543210', status: pick(O.STATUSES, i), student_course: 'BCA', student_status: 'Final year', experience: '0-2 yrs', current_role: O.ROLES[0],
      city: pick(vals, i * 3), about_you: pick(['', 'x'.repeat(80)], i), age: pick(vals, i * 5), birthday: pick(vals, i * 7), website_url: pick(vals, i * 11), agree: pick([true, false, 'on', undefined], i), news: pick([true, false], i * 3),
      interests: pick([[], ['ai'], ['ai', 'sec'], ['zz'], ['ai', 'ai']], i * 13), pin: pick(vals, i * 17), slot: pick(['', 'am', 'pm', 'zz'], i * 19) };
    const server = F.validateSubmission(custom, body).errors, client = K.validate(cp, body, COUNTRIES).errors;
    total++; if (JSON.stringify(Object.entries(server).sort()) !== JSON.stringify(Object.entries(client).sort())) { diffs++; if (diffs < 4) console.log('DIFF', body, server, client); }
  }
  assert.strictEqual(diffs, 0); ok(`the same agreement for a form with every field type, patterns, length limits, show-when "eq" and "in" (${total} submissions, 0 differences)`);

  /* ---- 3. markup of the new field types, escaping ---- */
  const evil = JSON.parse(JSON.stringify(custom));
  evil.fields.find((f) => f.key === 'city').label = '<img src=x onerror=alert(1)>'; evil.fields.find((f) => f.key === 'interests').options[0].label = '"><script>1</script>';
  const html = K.formHTML(K.visibleFields ? F.publicDefinition(evil) : evil, { copy: { headline: '<b>Hi</b>', subheadline: 'x<y' }, name: '<b>', countries: COUNTRIES }).html;
  assert(!/<img src=x|<script>1|<b>Hi/.test(html) && /&lt;img src=x/.test(html)); ok('labels, options and copy are escaped: markup typed in the studio is shown as text, never run');
  const host = newDom('Cyber Security', custom); const d = host.ownerDocument;
  for (const sel of ['textarea[name=about_you]', 'input[type=date][name=birthday]', 'input[type=url][name=website_url]', 'input[type=checkbox][name=agree]', 'input[type=checkbox][name=news]', 'input[type=checkbox][name=interests]', 'input[inputmode=decimal][name=age]', 'select[name=slot]']) assert(d.querySelector(sel), sel);
  assert(d.querySelectorAll('.panel').length === 4, 'panels: student, professional, pin rule, slot rule'); ok('every field type draws the right control; conditional fields sit in their own hidden panels');
  assert(!newDom('X', (() => { const x = JSON.parse(JSON.stringify(def)); x.fields.find((f) => f.key === 'email').hidden = true; x.fields.find((f) => f.key === 'college_name').deleted = true; return x; })()).querySelector('[name=email],[name=college_name]'));
  ok('hidden and deleted fields are not drawn');

  /* ---- 4. behaviour in a browser (jsdom): panels, clearing, submit, closed ---- */
  {
    const dom = new JSDOM('<!doctype html><body><div id="formMount"></div></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
    const w = dom.window, doc = w.document, host2 = doc.getElementById('formMount'), seen = [], sent = [];
    const inst = K.mount(host2, { def: pub, copy: F.renderCopy(def, { name: 'Cyber Security' }), name: 'Cyber Security', countries: COUNTRIES, button: 'Register now', fine: 'f', successTitle: 'Done!', success: 'We will call.',
      onEvent: (t, dd) => seen.push(t + (dd.field ? ':' + dd.field : '')), onSubmit: (v) => { sent.push(v); return Promise.resolve({ ok: true }); } });
    const f = inst.form, set = (name, value) => { const el = f.querySelector(`[name="${name}"]`); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    const radio = (name, value) => { const el = f.querySelector(`[name="${name}"][value="${value}"]`); el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    const panel = (v) => f.querySelector(`.panel[data-panel="${v}"]`);
    assert(panel('Student / Fresher').hidden && panel('Working Professional').hidden); radio('status', 'Student / Fresher'); assert(!panel('Student / Fresher').hidden && panel('Working Professional').hidden);
    radio('student_course', 'BCA'); set('college_name', 'MES'); radio('status', 'Working Professional');
    assert(panel('Student / Fresher').hidden && !panel('Working Professional').hidden && !f.querySelector('[name=student_course]:checked') && f.querySelector('[name=college_name]').value === '');
    ok('choosing "I am a" shows its panel and clears what was typed in the other one');
    f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert(sent.length === 0 && f.querySelector('[data-err=first_name]').classList.contains('on') && f.querySelector('[data-err=experience]').classList.contains('on') && !f.querySelector('[data-err=student_course]').classList.contains('on'));
    ok('submitting an incomplete form shows the errors of the visible fields only and sends nothing');
    set('first_name', 'Asha'); assert(!f.querySelector('[data-err=first_name]').classList.contains('on')); ok('an error disappears as soon as the field is fixed');
    set('first_name', 'Asha'); set('last_name', 'Nair'); set('phone', '9876543210'); radio('experience', '2-5 yrs'); set('current_role', O.ROLES[0]);
    f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await sleep(20);
    assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].first_name, 'Asha'); assert.strictEqual(sent[0].status, 'Working Professional'); assert.strictEqual(sent[0].country, 'IN');
    assert(host2.querySelector('.success h2').textContent === 'Done!' && !host2.querySelector('form')); assert(seen.includes('form_start') && seen.includes('submit_attempt') && seen.includes('submit_success') && seen.includes('submit_invalid'));
    ok('a valid form is sent once and replaced by the thank-you text from the definition; start / invalid / attempt / success events are reported without values');
    const closed = new JSDOM('<!doctype html><body><div id="m"></div></body>').window.document.getElementById('m');
    K.mount(closed, { def: pub, isClosed: true, closedTitle: 'Closed!' }); assert(closed.querySelector('h2').textContent === 'Closed!' && !closed.querySelector('form')); ok('a paused form shows the closed notice instead of the form');
  }

  /* ---- 5. the real page, served by the app, in jsdom: embedded definition -> fill -> register -> lead in the database ---- */
  db.init(new (newDb().adapters.createPg().Pool)());
  await migrate.run(db.get(), { lock: false }); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(base + '/datascience?utm_source=meta&utm_medium=paid&utm_campaign=ds-reels')).text();
  assert(/id="knoaForm"/.test(page) && !/<!--FORM_DATA-->/.test(page)); ok('the page the server sends carries the published form as a JSON data block (no scripts inline, so the strict CSP still holds)');
  const PIXEL = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const dom = await JSDOM.fromURL(base + '/datascience?utm_source=meta&utm_medium=paid&utm_campaign=ds-reels', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o = {}) => fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), 'user-agent': PIXEL } }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; }
  });
  const w = dom.window, doc = w.document;
  await until(() => doc.querySelector('form.lead-form')); assert(doc.querySelector('h1').textContent === 'Register for the Data Science Master Class' && doc.querySelector('h1 .accent').textContent === 'Data Science');
  ok('the live page draws the form from the embedded definition: heading with the highlighted master class name');
  const f = doc.querySelector('form'), set = (name, v) => { const el = f.querySelector(`[name="${name}"]`); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const radio = (name, v) => { const el = f.querySelector(`[name="${name}"][value="${v}"]`); el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  f.querySelector('[name=first_name]').dispatchEvent(new w.Event('focusin', { bubbles: true }));
  set('first_name', 'Meera'); set('last_name', 'Das'); set('phone', '98765 43210'); set('email', 'meera@example.com'); radio('status', 'Student / Fresher'); radio('student_course', 'BCA'); radio('student_status', 'Final year');
  f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const lead = await until(async () => (await db.query('SELECT * FROM leads WHERE phone=$1', ['+919876543210'])).rows[0]);
  assert(lead, 'lead saved'); assert.strictEqual(lead.course_slug, 'datascience'); assert.strictEqual(lead.utm_campaign, 'ds-reels'); assert.strictEqual(lead.form_version, 1); assert(lead.form_id);
  assert(/^[A-Za-z0-9_-]{8,64}$/.test(lead.visitor_id) && /^[A-Za-z0-9_-]{8,64}$/.test(lead.session_id)); assert.strictEqual(lead.device_type, 'mobile'); assert.strictEqual(lead.os, 'Android'); assert.strictEqual(lead.browser, 'Chrome'); assert.strictEqual(lead.source_detected, 'Meta');
  assert.strictEqual(lead.is_returning_lead, false); assert.strictEqual(lead.submission_count, 1); ok('submitting on the live page stores the lead with form id + version, visitor and session ids, device labels and source');
  await until(() => doc.querySelector('.success')); assert(/Thank you for registering/.test(doc.querySelector('.success h2').textContent)); ok('the page then shows the thank-you message');
  const ev = await until(async () => { const r = (await db.query('SELECT type FROM visitor_events ORDER BY id')).rows.map((x) => x.type); return r.includes('submit_success') ? r : null; });
  assert(ev && ev.includes('page_view') && ev.includes('form_start')); ok('page view, form start and submit events were recorded by the page');
  w.close(); server.close(); await db.close();
  console.log(`\nAll ${n} renderer checks passed`);
})().catch((e) => { console.error('RENDERER TEST FAILED:', e); process.exit(1); });
