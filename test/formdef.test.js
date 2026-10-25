// Form definition engine: legacy equivalence of the default form, templating, structure rules, custom fields.
// Run: node test/formdef.test.js
const assert = require('assert');
const F = require('../src/formdef');
const { validateLead } = require('../src/validate');
const O = require('../src/options');
const { COUNTRIES } = require('../src/countries');
let n = 0; const ok = (m) => console.log(`  ✓ FD${++n}. ${m}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---- 1. the default definition is valid and reproduces today's page text ---- */
const DEF = F.defaultDefinition();
assert.deepStrictEqual(F.validateDefinition(DEF), []);
ok('the default definition (today\'s form) passes structural validation');
assert.strictEqual(F.renderCopy(DEF, { name: 'Cyber Security' }).headline, 'Register for the Cyber Security Master Class');
assert.strictEqual(F.renderCopy(DEF, { name: 'Cyber Security' }).subheadline, 'Share your details and our team will contact you about the Cyber Security session.');
assert.strictEqual(F.renderCopy(DEF, {}).headline, 'Register for the Master Class');
assert.strictEqual(F.renderCopy(DEF, {}).subheadline, 'Share your details and our team will contact you with the session information.');
ok('default headline and sub-headline equal the text register.js builds today, with and without a course name');

/* ---- 2. differential test: same errors and same lead columns as validate.js for a large corpus ---- */
const LEAD_COLS = ['first_name', 'last_name', 'full_name', 'country_code', 'phone', 'email', 'status', 'student_course', 'student_status', 'college_name', 'specialization', 'experience_level', 'job_role', 'current_company', 'highest_qualification'];
const phones = ['9876543210', '09876543210', '+91 98765 43210', '919876543210', '1234567890', '', '  ', '98765', '98765abcde', '+971501234567', '501234567', '2025550123', '7123456789', '44123', '123456', '12345678901234'];
const emails = ['', 'a@b.co', 'bad', 'x@y', ' spaced@mail.com ', 'UPPER@MAIL.COM'];
const names = ['Asha', '', '   ', 'N'.repeat(70), "O'Neil"];
const statuses = ['Student / Fresher', 'Working Professional', '', 'Hacker', undefined];
const pick = (a, i) => a[i % a.length];
let cases = 0, mismatches = [];
function compare(body, label) {
  cases++;
  const legacy = validateLead(body);
  const r = F.validateSubmission(DEF, body);
  const mine = F.toLeadColumns(r);
  try {
    assert.deepStrictEqual(r.errors, legacy.errors);
    if (!Object.keys(legacy.errors).length) {
      for (const c of LEAD_COLS) assert.strictEqual(mine[c] ?? null, legacy.lead[c] ?? null, 'column ' + c);
      assert.deepStrictEqual(r.custom, {});
    }
  } catch (e) { mismatches.push(label + ': ' + e.message.split('\n')[0]); }
}
let i = 0;
for (const country of [...COUNTRIES.map((c) => c.c), 'ZZ', undefined]) for (const phone of phones) {
  i++;
  compare({ first_name: pick(names, i), last_name: pick(names, i + 1), country, phone, email: pick(emails, i), status: 'Student / Fresher', student_course: O.STUDENT_COURSES[i % 8], student_status: O.STUDENT_STATUSES[i % 4], college_name: 'MES', specialization: i % 3 ? '' : O.SPECIALIZATIONS[i % 9] }, 'phone#' + i);
}
for (const status of statuses) for (const sc of ['', 'BCA', 'Nope']) for (const ss of ['', 'Final year', 'Nope']) for (const exp of ['', '0-2 yrs', 'Nope']) for (const role of ['', O.ROLES[0], 'Nope']) for (const spec of ['', O.SPECIALIZATIONS[0], 'Nope']) for (const qual of ['', O.QUALIFICATIONS[0], 'Nope']) {
  i++;
  compare({ first_name: 'Asha', last_name: 'N', country: 'IN', phone: '9876543210', status, student_course: sc, student_status: ss, experience: exp, current_role: role, specialization: spec, highest_qualification: qual, college_name: 'C', current_company: 'Co' }, `branch#${i}`);
}
for (const e of emails) for (const f of names) for (const l of names) compare({ first_name: f, last_name: l, country: 'IN', phone: '9876543210', email: e, status: 'Working Professional', experience: '2-5 yrs', current_role: O.ROLES[1] }, 'email-name');
compare({}, 'empty body'); compare(undefined, 'undefined body'); compare({ first_name: 123, phone: 9876543210, status: ['x'] }, 'wrong types');
assert.deepStrictEqual(mismatches.slice(0, 5), [], `mismatches (${mismatches.length}) e.g. ` + mismatches.slice(0, 3).join(' | '));
assert(cases > 4000, 'corpus size ' + cases);
ok(`differential test: ${cases} submissions give exactly the same errors and the same lead columns as legacy validateLead (0 differences)`);

/* ---- 3. conditional logic and server-side rules ---- */
const base = { first_name: 'A', last_name: 'B', country: 'IN', phone: '9876543210', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year' };
let r = F.validateSubmission(DEF, { ...base, college_name: 'MES', current_company: 'Should be dropped', experience: '0-2 yrs' });
assert.strictEqual(r.columns.college_name, 'MES'); assert.strictEqual(r.columns.current_company, null); assert.strictEqual(r.columns.experience_level, null);
ok('answers of the other branch (professional fields sent by a student) are dropped');
r = F.validateSubmission(DEF, { ...base, hacked_key: 'x', __proto__: { y: 1 } });
assert(!('hacked_key' in r.columns) && !('hacked_key' in r.custom) && !('hacked_key' in r.values)); ok('unknown keys are dropped');

/* ---- 4. custom fields: stored separately, validated by type ---- */
const D2 = clone(DEF);
D2.fields.push(
  { key: 'goal', label: 'Your goal', type: 'textarea', section: 'background', width: 'full', required: false, maxLength: 50, order: 20 },
  { key: 'interest', label: 'Interest', type: 'select', section: 'background', width: 'half', required: true, options: [{ value: 'AI', label: 'AI' }, { value: 'Security', label: 'Security' }], order: 21 },
  { key: 'topics', label: 'Topics', type: 'multiselect', section: 'background', width: 'full', required: false, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], order: 22 },
  { key: 'agree', label: 'I agree to be contacted', type: 'consent', section: 'background', width: 'full', required: true, order: 23 },
  { key: 'dob', label: 'Date of birth', type: 'date', section: 'background', width: 'half', required: false, order: 24 },
  { key: 'years', label: 'Years', type: 'number', section: 'background', width: 'half', required: false, order: 25 },
  { key: 'site', label: 'Website', type: 'url', section: 'background', width: 'full', required: false, order: 26 },
  { key: 'pin', label: 'PIN', type: 'text', section: 'background', width: 'half', required: false, pattern: 'pincode', order: 27 });
assert.deepStrictEqual(F.validateDefinition(D2), []);
r = F.validateSubmission(D2, { ...base, goal: 'x'.repeat(200), interest: 'AI', topics: ['a', 'b', 'a'], agree: true, dob: '2001-02-03', years: '4.5', site: 'https://example.org', pin: '682001' });
assert.deepStrictEqual(r.errors, {});
assert.deepStrictEqual(r.custom, { goal: 'x'.repeat(50), interest: 'AI', topics: ['a', 'b'], agree: true, dob: '2001-02-03', years: 4.5, site: 'https://example.org', pin: '682001' });
ok('custom fields go to `custom` (leads.custom_fields), text is length-capped, multi-select is de-duplicated, numbers are numbers');
r = F.validateSubmission(D2, { ...base, interest: 'Nope', topics: ['zzz'], dob: '2001-13-45', years: 'abc', site: 'javascript:alert(1)', pin: '12', agree: false });
assert.deepStrictEqual(Object.keys(r.errors).sort(), ['agree', 'dob', 'interest', 'pin', 'site', 'topics', 'years'].sort());
ok('options outside the list, bad date/number/URL/pattern and an unticked required consent are refused (server side)');
D2.fields.find((f) => f.key === 'goal').deleted = true;
r = F.validateSubmission(D2, { ...base, interest: 'AI', agree: true, goal: 'still sent' });
assert(!('goal' in r.custom) && Object.keys(r.errors).length === 0); assert(!F.publicDefinition(D2).fields.some((f) => f.key === 'goal')); assert(D2.fields.some((f) => f.key === 'goal'));
ok('a deleted field is gone from the public definition and from validation, but stays in the stored version');

/* ---- 5. structure rules ---- */
const bad = (mutate, re) => { const d = clone(DEF); mutate(d); const p = F.validateDefinition(d); assert(p.some((m) => re.test(m)), 'expected ' + re + ' in ' + JSON.stringify(p)); };
bad((d) => { d.copy.headline = 'Hello {nmae}'; }, /Unknown placeholder \{nmae\}/);
bad((d) => { d.fields.push({ ...d.fields[0] }); }, /duplicate key/);
bad((d) => { d.fields[0].key = 'First Name'; }, /key must be/);
bad((d) => { d.fields[5].section = 'ghost'; }, /section does not exist/);
bad((d) => { d.fields[0].type = 'iframe'; }, /unknown type/);
bad((d) => { d.fields[7].pattern = '(a+)+$'; }, /pattern must be one of/);
bad((d) => { d.fields.find((f) => f.key === 'specialization').options = []; }, /at least one option/);
bad((d) => { const f = d.fields.find((x) => x.key === 'status'); f.order = 99; d.fields.splice(d.fields.indexOf(f), 1); d.fields.push(f); }, /cannot be placed above "status"/);
bad((d) => { d.fields.forEach((f) => { if (f.type === 'phone' || f.type === 'email') f.deleted = true; }); }, /phone or email/);
bad((d) => { d.fields.find((f) => f.key === 'college_name').showWhen = { field: 'college_name', op: 'eq', value: 'x' }; }, /depend on itself/);
bad((d) => { d.fields.find((f) => f.key === 'college_name').showWhen = { field: 'nothing', op: 'eq', value: 'x' }; }, /does not exist/);
bad((d) => { d.copy.button = '  '; }, /button label/);
bad((d) => { d.fields[0].label = 'L'.repeat(200); }, /label is required/);
bad((d) => { for (let k = 0; k < 70; k++) d.fields.push({ key: 'f' + 'abcdefghij'[k % 10] + 'xyz'.repeat(k % 3 + 1) + 'q'.repeat(k % 7), label: 'x', type: 'text', section: 'about' }); }, /At most 60 fields/);
bad((d) => { d.copy.extra = 'x'.repeat(200000); }, /too large/);
assert.deepStrictEqual(F.validateDefinition(null), ['The form definition must be an object.']);
ok('structure rules: unknown placeholders, duplicate or invalid keys, unknown section/type/pattern, empty options, dependency guard, self-dependency, phone-or-email guard, size limits');

/* ---- 6. dependency guard also covers a controller in a later section ---- */
const D3 = clone(DEF); D3.sections = [D3.sections[3], D3.sections[2], D3.sections[0], D3.sections[1]];   // "background" now before "role"
assert(F.validateDefinition(D3).some((m) => /section comes before the section of "status"/.test(m))); ok('a dependent field in a section above its controller\'s section is refused');

/* ---- 7. escaping is the renderer\'s job: templates keep markup as plain text ---- */
assert.strictEqual(F.renderCopy(D3, { name: '<img src=x onerror=1>' }).headline, 'Register for the <img src=x onerror=1> Master Class'); ok('renderCopy returns plain text (callers escape on output); no HTML is ever interpreted here');

console.log(`\nAll ${n} form definition checks passed`);
