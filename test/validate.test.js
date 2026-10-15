// Registration form rules (pure, no database / server). Run: node test/validate.test.js
const assert = require('assert');
const { validateLead } = require('../src/validate');
const { COUNTRIES } = require('../src/countries');
const O = require('../src/options');
let n = 0; const ok = (m) => console.log(`  ✓ V${++n}. ${m}`);
const stu = { first_name: 'Asha', last_name: 'Nair', country: 'IN', phone: '9876543210', status: 'Student / Fresher', student_course: 'BCA', student_status: 'Final year' };
const pro = { first_name: 'Ravi', last_name: 'Kumar', country: 'IN', phone: '9876543211', status: 'Working Professional', experience: '2-5 yrs', current_role: 'QA / Tester' };
const errs = (b) => validateLead(b).errors;

/* common fields */
assert.deepStrictEqual(errs(stu), {}); assert.deepStrictEqual(errs(pro), {}); ok('minimal student and professional submissions are valid (email, college, company, specialization, qualification are optional)');
for (const k of ['first_name', 'last_name', 'phone', 'status']) assert(errs({ ...stu, [k]: '' })[k], k + ' required');
assert(!errs({ ...stu, email: '' }).email); assert(errs({ ...stu, email: 'not-an-email' }).email); ok('first name, last name, mobile and "I am a" are required; email optional but checked when given');
assert.deepStrictEqual(O.STATUSES, ['Student / Fresher', 'Working Professional']); ok('"I am a" has exactly two choices');

/* country codes */
const want = { IN: '+91', AE: '+971', US: '+1', GB: '+44', CA: '+1', AU: '+61' };
for (const [c, d] of Object.entries(want)) assert.strictEqual(COUNTRIES.find((x) => x.c === c).d, d, c);
assert(COUNTRIES.some((x) => x.other)); assert(COUNTRIES.length >= 12); ok('country codes: India +91, UAE +971, USA +1, UK +44, Canada +1, Australia +61, plus Gulf/Singapore and an "Other" option');
const phone = (country, p) => validateLead({ ...stu, country, phone: p });
assert.strictEqual(phone('IN', '98765 43210').lead.phone, '+919876543210'); assert.strictEqual(phone('AE', '501234567').lead.phone, '+971501234567'); assert.strictEqual(phone('US', '2025550123').lead.phone, '+12025550123');
assert.strictEqual(phone('CA', '4165550123').lead.phone, '+14165550123'); assert.strictEqual(phone('GB', '7123456789').lead.phone, '+447123456789'); assert.strictEqual(phone('AU', '412345678').lead.phone, '+61412345678'); assert.strictEqual(phone('XX', '+4915112345678').lead.phone, '+4915112345678');
assert(phone('IN', '12345').errors.phone); assert(phone('AE', '9876543210').errors.phone); ok('numbers are normalised to +<code><digits>; wrong-length / wrong-start numbers rejected');

/* student branch */
assert.deepStrictEqual(O.STUDENT_COURSES, ['BCA', 'B.Sc CS / IT', 'B.Tech / BE', 'MCA', 'M.Sc / M.Tech', 'B.Com / BBA', 'Diploma', 'Other']);
assert.deepStrictEqual(O.STUDENT_STATUSES, ['1st / 2nd year', '3rd year', 'Final year', 'Graduated (fresher)']); ok('student course and status chips match the spec exactly');
assert(errs({ ...stu, student_course: '' }).student_course); assert(errs({ ...stu, student_status: '' }).student_status); ok('student: course and current status are required');
let r = validateLead({ ...stu, college_name: ' MES College ', specialization: 'Computer Science' });
assert.strictEqual(r.lead.college_name, 'MES College'); assert.strictEqual(r.lead.specialization, 'Computer Science'); assert.deepStrictEqual(r.errors, {}); ok('student: college name and specialization / branch are saved when given');
assert(errs({ ...stu, specialization: 'Underwater Basket Weaving' }).specialization); assert.strictEqual(validateLead({ ...stu, specialization: '' }).lead.specialization, null); ok('specialization must come from the list, and may be left empty');

/* professional branch */
assert.deepStrictEqual(O.EXPERIENCE, ['0-2 yrs', '2-5 yrs', '5-10 yrs', '10+ yrs']); ok('experience chips: 0–2, 2–5, 5–10, 10+ yrs');
assert(errs({ ...pro, experience: '' }).experience); assert(errs({ ...pro, current_role: '' }).current_role); assert(errs({ ...pro, experience: '40 yrs' }).experience); ok('professional: experience and current role are required and must be from the lists');
r = validateLead({ ...pro, current_company: ' Acme Labs ', highest_qualification: "Master's degree" });
assert.strictEqual(r.lead.current_company, 'Acme Labs'); assert.strictEqual(r.lead.highest_qualification, "Master's degree"); assert.deepStrictEqual(r.errors, {}); ok('professional: company and highest qualification are saved when given');
assert(errs({ ...pro, highest_qualification: 'Wizard' }).highest_qualification); assert.strictEqual(validateLead({ ...pro }).lead.highest_qualification, null); ok('qualification must come from the list, and may be left empty');

/* branches do not leak into each other */
r = validateLead({ ...stu, current_company: 'Sneaky Inc', highest_qualification: 'PhD', experience: '10+ yrs', current_role: 'QA / Tester' });
assert.strictEqual(r.lead.current_company, null); assert.strictEqual(r.lead.highest_qualification, null); assert.strictEqual(r.lead.experience_level, null); assert.strictEqual(r.lead.job_role, null);
r = validateLead({ ...pro, college_name: 'X', specialization: 'Civil', student_course: 'BCA', student_status: 'Final year' });
assert.strictEqual(r.lead.college_name, null); assert.strictEqual(r.lead.specialization, null); assert.strictEqual(r.lead.student_course, null); ok('a student never stores professional answers and vice versa');

/* course links */
const link = (c) => validateLead({ ...stu, course: c }).lead;
assert.deepStrictEqual([link('cybersecurity').course_slug, link('datascience').course_slug, link('generative-ai').course_slug, link('genai').course_slug, link('').course_slug], ['cybersecurity', 'datascience', 'generativeai', 'generativeai', null]); ok('links: /cybersecurity, /datascience, /generative-ai (+ alias) map to the right master class; plain link = none');
console.log(`\nAll ${n} form checks passed`);
