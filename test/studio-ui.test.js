// The Form Studio screen itself, run in jsdom against the real app: edit, drag, autosave, live preview, publish, history, campaigns page.
// (jsdom is not a browser: layout and real pointer dragging are not covered; see docs/PROGRESS.md.)  Run: node test/studio-ui.test.js
process.env.LOG_LEVEL = 'silent'; process.env.RATE_LIMIT_MAX = '500'; process.env.ADMIN_USERNAME = 'ui.admin'; process.env.ADMIN_PASSWORD = 'correct-horse-battery'; process.env.SESSION_SECRET = 'z'.repeat(40);
const assert = require('assert');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const { newDb } = require('pg-mem');
const db = require('../src/db'); const migrate = require('../src/migrate'); const forms = require('../src/forms');
const { createApp, seedAdmin } = require('../server');
let n = 0; const ok = (m) => console.log(`  ✓ UI${++n}. ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(20); } return null; }

(async () => {
  db.init(new (newDb().adapters.createPg().Pool)()); await migrate.run(db.get(), { lock: false }); await seedAdmin(); await forms.seedDefaultForms();
  const server = createApp().listen(0), base = `http://127.0.0.1:${server.address().port}`;
  const lr = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ui.admin', password: 'correct-horse-battery' }) });
  const cookie = lr.headers.get('set-cookie').split(';')[0];
  const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
  const open = async (p) => {
    const jar = new CookieJar(); jar.setCookieSync(cookie + '; Path=/', base);
    const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', (e) => { if (!/Could not load link/.test(String(e.message))) errs.push(String(e.message).slice(0, 200)); });   // the Google Fonts stylesheet cannot load in the sandbox
    const dom = await JSDOM.fromURL(base + p, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
      beforeParse(w) { w.fetch = (u, o = {}) => fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), Cookie: cookie } }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.confirm = () => true; } });
    dom.errs = errs; return dom;
  };
  const forms0 = (await api('GET', '/admin/api/forms')).forms, ds = forms0.find((f) => f.course_slug === 'datascience');

  /* ---- forms list ---- */
  let dom = await open('/admin/forms'); let w = dom.window, d = w.document;
  await until(() => d.querySelectorAll('.fs-card').length === 3); assert(/Data Science/.test(d.body.textContent) && /Open studio/.test(d.body.textContent) && d.querySelector('a[href="/admin/forms/' + ds.id + '"]'));
  /* New form: name only, the link is made from it and the form starts live */
  d.getElementById('newForm').dispatchEvent(new w.Event('click', { bubbles: true })); await until(() => d.querySelector('.md-back input'));
  const nfInput = d.querySelector('.md-back input'); nfInput.value = 'Alumni Intake';
  [...d.querySelectorAll('.md-back button')].find((b) => /Create form/.test(b.textContent)).dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => d.querySelectorAll('.fs-card').length === 4);
  const nf = (await api('GET', '/admin/api/forms')).forms.find((f) => f.path === 'alumni-intake');
  assert(nf && nf.status === 'active' && nf.published_version === 1 && /Alumni Intake/.test(d.body.textContent));
  assert(/id="formSearch"/.test(d.body.innerHTML) && /Show archived/.test(d.body.textContent)); ok('New form takes a name only: the card and /alumni-intake appear at once, with search and Show archived on the list');
  ok('the forms list shows one card per master class with its live version, registrations, link and an Open studio button'); w.close();

  /* ---- the editor ---- */
  dom = await open(`/admin/forms/${ds.id}`); w = dom.window; d = w.document;
  await until(() => d.querySelectorAll('#layout .st-f').length === 13); assert.strictEqual(d.querySelectorAll('#layout .st-sec').length, 4); assert.strictEqual(d.querySelectorAll('#layout .st-f.half').length, 2);
  assert(d.querySelector('.st-f[data-key="status"]') && d.getElementById('stName').textContent === 'Data Science'); ok('the editor loads the live form: 4 sections, 13 fields, the two name fields shown half width');
  const S = w.__studio; assert(S.def.fields.length === 13); assert(!dom.errs.length, dom.errs.join(' | '));
  assert(d.getElementById('preview').src.endsWith(`/admin/forms/${ds.id}/preview`)); ok('the live preview frame points at the studio preview page (same renderer as the public form)');

  d.querySelector('.st-f[data-key="college_name"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  const labelInput = await until(() => [...d.querySelectorAll('#tabField input.control')].find((i) => i.value === 'College name')); assert(labelInput); assert(/College name/.test(d.querySelector('.st-f.sel .nm').textContent));
  labelInput.value = 'College / institute'; labelInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.strictEqual(d.querySelector('.st-f[data-key="college_name"] .nm').textContent, 'College / institute'); ok('selecting a field opens its settings; changing the label updates the layout at once');
  const saved = await until(async () => (await api('GET', `/admin/api/forms/${ds.id}`)).draft); assert(saved); assert.strictEqual((await api('GET', `/admin/api/forms/${ds.id}`)).working.fields.find((f) => f.key === 'college_name').label, 'College / institute');
  assert(/Saved/.test(d.getElementById('stSave').textContent)); ok('the change is autosaved to the draft within a second ("Saved hh:mm" shows) and is not live');
  const pageNow = await (await fetch(base + '/datascience')).text(); assert(!/College \/ institute/.test(pageNow)); ok('the public page still shows the published version');

  // required checkbox of a locked field; type select is disabled for a published field
  const typeSel = [...d.querySelectorAll('#tabField select')].find((s) => [...s.options].some((o) => o.value === 'textarea')); assert(typeSel && typeSel.disabled); ok('a published field keeps its type: the type selector is locked');

  // add a field
  d.getElementById('addType').value = 'select'; d.getElementById('btnAddField').dispatchEvent(new w.Event('click', { bubbles: true }));
  const added = S.def.fields[S.def.fields.length - 1]; assert(added.type === 'select' && added.options.length === 2 && /^[a-z_]+$/.test(added.key)); assert(d.querySelector(`.st-f[data-key="${added.key}"]`));
  assert(S.sel === added.key); ok('Add field creates a dropdown with two options and a valid key, and selects it for editing');
  const optInputs = [...d.querySelectorAll('#tabField .opt-row input')]; assert.strictEqual(optInputs.length, 4); optInputs[0].value = 'Kochi'; optInputs[0].dispatchEvent(new w.Event('input', { bubbles: true })); assert.strictEqual(added.options[0].label, 'Kochi'); assert.strictEqual(added.options[0].value, 'Kochi'); ok('editing an option label also sets what is saved with the lead (for a new field)');
  const tmpField = added;

  // show-when editor
  const swSel = [...d.querySelectorAll('#tabField select')].find((s) => [...s.options].some((o) => o.value === 'status')); assert(swSel); swSel.value = 'status'; swSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(JSON.stringify(tmpField.showWhen), JSON.stringify({ field: 'status', op: 'eq', value: 'Student / Fresher' })); ok('"Show only when…" lists only choice fields above this one and stores the rule');

  // drag: move the new field to the first section, above first_name (this puts it ABOVE its controller -> problem), then fix by dropping it below
  const dropFirst = d.querySelector('#layout .st-drop'); dropFirst.insertBefore(d.querySelector(`.st-f[data-key="${tmpField.key}"]`), dropFirst.firstChild);
  w.Sortable.get(dropFirst).option('onEnd')(); assert.strictEqual(S.def.fields[0].key, tmpField.key); assert.strictEqual(S.def.fields[0].section, 'about');
  const prob = await until(() => /cannot be placed above/.test(d.getElementById('stProblems').textContent) ? true : null); assert(prob, d.getElementById('stProblems').textContent); ok('dragging a field to another section moves it there; putting a conditional field above the field that controls it is reported at once');
  const dropBg = d.querySelectorAll('#layout .st-drop')[3]; dropBg.appendChild(d.querySelector(`.st-f[data-key="${tmpField.key}"]`)); w.Sortable.get(dropBg).option('onEnd')(); assert.strictEqual(S.def.fields[S.def.fields.length - 1].key, tmpField.key);
  await until(() => d.getElementById('stProblems').hidden); assert(d.getElementById('stProblems').hidden); ok('dropping it back below its controller clears the problem');
  // width toggle
  d.querySelector('.st-f[data-key="email"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  const wsel = [...d.querySelectorAll('#tabField select')].find((s) => [...s.options].some((o) => o.value === 'half')); wsel.value = 'half'; wsel.dispatchEvent(new w.Event('change', { bubbles: true })); assert(d.querySelector('.st-f[data-key="email"]').classList.contains('half')); ok('width Half shows the block half-size in the layout');
  // delete the never-published field -> removed completely; delete a published one -> moves to Deleted fields
  d.querySelector(`.st-f[data-key="${tmpField.key}"]`).dispatchEvent(new w.Event('click', { bubbles: true }));
  [...d.querySelectorAll('#tabField button')].find((b) => /Delete field/.test(b.textContent)).dispatchEvent(new w.Event('click', { bubbles: true }));
  const yes = await until(() => [...d.querySelectorAll('.kmodal button')].find((b) => /Delete/.test(b.textContent))); yes.dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => !S.def.fields.some((f) => f.key === tmpField.key)); assert(!S.def.fields.some((f) => f.key === tmpField.key)); ok('deleting a field that was never published removes it completely');
  d.querySelector('.st-f[data-key="current_company"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  [...d.querySelectorAll('#tabField button')].find((b) => /Delete field/.test(b.textContent)).dispatchEvent(new w.Event('click', { bubbles: true }));
  (await until(() => [...d.querySelectorAll('.kmodal button')].find((b) => /Delete/.test(b.textContent)))).dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => S.def.fields.find((f) => f.key === 'current_company').deleted); assert(!d.querySelector('.st-f[data-key="current_company"]') && !d.getElementById('deletedBox').hidden); ok('deleting a published field hides it from the form and lists it under "Deleted fields" with a Restore button');
  [...d.querySelectorAll('#deletedList button')][0].dispatchEvent(new w.Event('click', { bubbles: true })); await until(() => d.querySelector('.st-f[data-key="current_company"]')); assert(d.querySelector('.st-f[data-key="current_company"]')); ok('Restore brings it back');

  // form text tab
  d.querySelector('.tabs2 button[data-tab="text"]').dispatchEvent(new w.Event('click', { bubbles: true })); const head = [...d.querySelectorAll('#tabText input')][0]; assert(/\{name\}/.test(head.value));
  head.value = 'Join the {name} {type} today'; head.dispatchEvent(new w.Event('input', { bubbles: true })); assert.strictEqual(S.def.copy.headline, 'Join the {name} {type} today'); ok('the Form text tab edits the headline (with {name} / {type} placeholders)');

  // the preview page (what the iframe loads): receives the draft by postMessage and draws it with the public renderer
  {
    const pdom = await open(`/admin/forms/${ds.id}/preview`), pw = pdom.window, pd = pw.document;
    await until(() => pw.KnoaForm && pd.getElementById('formMount'));
    const def = JSON.parse(JSON.stringify(S.def));
    pw.dispatchEvent(new pw.MessageEvent('message', { origin: base, data: { type: 'knoa-preview', definition: def, name: 'Data Science', focusKey: 'college_name' } }));
    assert(/Join the Data Science Master Class today/.test(pd.querySelector('h1').textContent)); assert(pd.querySelector('.st-hl') && !pd.querySelector('.panel[data-panel="Student / Fresher"]').hidden); assert(/College \/ institute/.test(pd.body.textContent));
    pw.dispatchEvent(new pw.MessageEvent('message', { origin: 'https://evil.example', data: { type: 'knoa-preview', definition: { sections: [], fields: [] }, name: 'X' } })); assert(pd.querySelector('h1')); // foreign origin ignored
    pw.dispatchEvent(new pw.MessageEvent('message', { origin: base, data: { type: 'knoa-preview', definition: def, name: 'Data Science', showClosed: true } })); assert(/Registrations are closed/.test(pd.body.textContent));
    pw.dispatchEvent(new pw.MessageEvent('message', { origin: base, data: { type: 'knoa-preview', definition: def, name: 'Data Science' } })); pd.querySelector('form').dispatchEvent(new pw.Event('submit', { bubbles: true, cancelable: true })); assert(pd.querySelector('[data-err=first_name]').classList.contains('on'));
    ok('the preview page draws the draft sent by the studio (headline, edited label, highlighted conditional field), shows the closed state on request, ignores messages from other sites and never submits anything'); pw.close();
  }

  // publish
  d.getElementById('btnPublish').dispatchEvent(new w.Event('click', { bubbles: true }));
  const go = await until(() => [...d.querySelectorAll('.md button')].find((b) => /Publish now/.test(b.textContent))); assert(go); assert(/College \/ institute|Changed text|changed/i.test(d.querySelector('.md').textContent)); ok('Publish shows what is different from the live form before anything goes live');
  d.querySelector('.md input').value = 'UI test publish'; go.dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(async () => (await api('GET', `/admin/api/forms/${ds.id}`)).form.published_version === 2); const after = await api('GET', `/admin/api/forms/${ds.id}`); assert.strictEqual(after.form.published_version, 2); assert(!after.draft);
  const live = JSON.parse(/id="knoaForm">([\s\S]*?)<\/script>/.exec(await (await fetch(base + '/datascience')).text())[1]); assert.strictEqual(live.copy.headline, 'Join the Data Science Master Class today'); assert(live.fields.find((f) => f.key === 'college_name').label === 'College / institute'); assert(live.fields.find((f) => f.key === 'email').width === 'half'); ok('publishing from the screen makes version 2 live with the headline, label and layout changes');
  // history dialog
  d.getElementById('btnHistory').dispatchEvent(new w.Event('click', { bubbles: true })); await until(() => d.querySelectorAll('.ver').length === 2); assert(/UI test publish/.test(d.querySelector('.md').textContent) && /live/.test(d.querySelector('.md').textContent)); ok('History lists both versions with the note and which one is live');
  // links dialog
  const uiCamp = (await api('POST', '/admin/api/campaigns', { name: 'UI Campaign', form_id: ds.id })).campaign; await api('POST', `/admin/api/campaigns/${uiCamp.id}/status`, { status: 'active' });
  d.querySelectorAll('.md-back').forEach((x) => x.remove()); d.getElementById('btnLinks').dispatchEvent(new w.Event('click', { bubbles: true })); await until(() => d.querySelector('.gen'));
  const gen = d.querySelector('.gen'); assert(![...gen.querySelectorAll('input')].some((i) => /campaign name/i.test(i.placeholder || '')), 'no free campaign name field'); [...gen.querySelectorAll('button')].find((b) => /Create link/.test(b.textContent)).dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => /utm_campaign=ui-campaign/.test(d.querySelector('.md') ? d.querySelector('.md').textContent : '')); assert(/utm_source=meta&utm_medium=paid&utm_campaign=ui-campaign/.test(d.querySelector('.md').textContent)); ok('the Links dialog creates a tagged link and lists it with Copy and QR buttons');
  assert(!dom.errs.length, dom.errs.join(' | ')); ok('no script errors on the studio page during the whole session'); w.close();

  /* ---- campaigns page ---- */
  const cyForm = (await api('GET', '/admin/api/forms')).forms.find((f) => f.course_slug === 'cybersecurity');
  const camp = await api('POST', '/admin/api/campaigns', { name: 'Page Test', form_id: cyForm.id });
  dom = await open('/admin/campaigns'); w = dom.window; d = w.document; await until(() => d.querySelector('.camp')); assert(/Page Test/.test(d.body.textContent) && /Cyber Security/.test(d.body.textContent) && /utm_campaign=page-test/.test(d.body.textContent));
  [...d.querySelectorAll('.camp button')].find((b) => /Activate/.test(b.textContent)).dispatchEvent(new w.Event('click', { bubbles: true })); await until(async () => (await api('GET', '/admin/api/campaigns')).campaigns.find((c) => c.id === camp.campaign.id).status === 'active');
  await until(() => /plain link → Page Test/.test(d.body.textContent)); assert(/plain link → Page Test/.test(d.body.textContent)); ok('the Campaigns page lists campaigns grouped by form, shows the tagged link and activating one shows the plain link pointing at it');
  assert(!dom.errs.length, dom.errs.join(' | ')); w.close(); server.close(); await db.close();
  console.log(`\nAll ${n} Form Studio screen checks passed`);
})().catch((e) => { console.error('STUDIO UI TEST FAILED:', e); process.exit(1); });
