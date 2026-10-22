// Form definition engine (Form Studio). Pure and dependency free: no database, no Express.
//
//  defaultDefinition()          today's registration form as a definition (built from options.js / countries.js, the lists validate.js uses)
//  validateDefinition(def)      structural check used before a version is saved: returns a list of problems (empty = valid)
//  renderCopy(def, ctx)         headline / sub-headline with {name} {type} {date} filled in (plain text; the caller escapes)
//  publicDefinition(def)        what the browser gets: no deleted fields, no internal notes
//  validateSubmission(def, body) server-side check of an answer set against ONE definition version
//
// Built-in fields carry `column` (their existing leads column). Fields without one are custom: they are returned in `custom`
// and stored in leads.custom_fields. A deleted field (deleted:true) stays in the stored version, so history and exports keep it.
const { COUNTRIES } = require('./countries');
const O = require('./options');

const TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'select', 'radio', 'checkbox', 'multiselect', 'date', 'url', 'consent'];
const CHOICE = new Set(['select', 'radio', 'multiselect']);
const WIDTHS = ['full', 'half'];
const KEY_RE = /^[a-z][a-z_]{1,39}$/;                        // letters and underscore, stable
const PLACEHOLDERS = ['name', 'type', 'date'];
const LIMITS = { fields: 60, sections: 12, options: 60, label: 120, text: 400, template: 300, definitionBytes: 120 * 1024 };
// Patterns come from a closed list: an admin can never type a regular expression (no ReDoS, no surprises).
const PATTERNS = {
  digits: [/^\d+$/, 'Use digits only'],
  letters: [/^[\p{L} .'-]+$/u, 'Use letters only'],
  alphanumeric: [/^[\p{L}\p{N} ._-]+$/u, 'Use letters and numbers only'],
  pincode: [/^\d{6}$/, 'Enter a 6-digit PIN code']
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]{3,}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nul = (v, max) => str(v, max) || null;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/* ---------------- the default definition = today's form ---------------- */
function defaultDefinition() {
  const o = (list) => list.map((v) => ({ value: v, label: v }));
  const text = (key, label, column, section, extra) => Object.assign({ key, label, type: 'text', column, section, width: 'full', required: false }, extra);
  const fields = [
    text('first_name', 'First Name', 'first_name', 'about', { width: 'half', required: true, placeholder: 'Enter your first name', maxLength: 60, ui: { autocomplete: 'given-name' }, messages: { required: 'Enter your first name' }, system: false }),
    text('last_name', 'Last Name', 'last_name', 'about', { width: 'half', required: true, placeholder: 'Enter your last name', maxLength: 60, ui: { autocomplete: 'family-name' }, messages: { required: 'Enter your last name' } }),
    { key: 'phone', label: 'Mobile Number / WhatsApp', type: 'phone', column: 'phone', section: 'contact', width: 'full', required: true, placeholder: 'Mobile number', maxLength: 20, system: true,
      ui: { autocomplete: 'tel-national', countryField: 'country' }, messages: { required: 'Enter your mobile number' } },
    { key: 'email', label: 'Email Address', type: 'email', column: 'email', section: 'contact', width: 'full', required: false, placeholder: 'Enter your email address', maxLength: 120,
      ui: { autocomplete: 'email' }, messages: { invalid: 'Enter a valid email address' } },
    { key: 'status', label: 'I am a', type: 'radio', column: 'status', section: 'role', width: 'full', required: true, ui: { variant: 'cards', divider: true },
      options: O.STATUSES.map((s) => ({ value: s, label: s, sub: O.STATUS_SUBTITLES[s] || '' })), messages: { required: 'Select one option' } },
    // Student / Fresher
    { key: 'student_course', label: 'Which course are you pursuing / completed?', type: 'radio', column: 'student_course', section: 'background', width: 'full', required: true, ui: { variant: 'pills' },
      options: o(O.STUDENT_COURSES), showWhen: { field: 'status', op: 'eq', value: 'Student / Fresher' }, messages: { required: 'Select the course you are pursuing / completed' } },
    { key: 'student_status', label: 'Current status', type: 'radio', column: 'student_status', section: 'background', width: 'full', required: true, ui: { variant: 'pills' },
      options: o(O.STUDENT_STATUSES), showWhen: { field: 'status', op: 'eq', value: 'Student / Fresher' }, messages: { required: 'Select your current status' } },
    text('college_name', 'College name', 'college_name', 'background', { placeholder: 'e.g. MES College of Engineering', maxLength: 120, ui: { autocomplete: 'organization' }, showWhen: { field: 'status', op: 'eq', value: 'Student / Fresher' } }),
    { key: 'specialization', label: 'Specialization / branch', type: 'select', column: 'specialization', section: 'background', width: 'full', required: false, placeholder: 'Select specialization',
      options: o(O.SPECIALIZATIONS), showWhen: { field: 'status', op: 'eq', value: 'Student / Fresher' }, messages: { invalid: 'Select a specialization from the list' } },
    // Working Professional
    { key: 'experience', label: 'Total work experience', type: 'radio', column: 'experience_level', section: 'background', width: 'full', required: true, ui: { variant: 'pills', cols: 4 },
      options: O.EXPERIENCE.map((v) => ({ value: v, label: v.replace('-', '–') })), showWhen: { field: 'status', op: 'eq', value: 'Working Professional' }, messages: { required: 'Select your total work experience' } },
    { key: 'current_role', label: 'Current role / domain', type: 'select', column: 'job_role', section: 'background', width: 'full', required: true, placeholder: 'Select one',
      options: o(O.ROLES), showWhen: { field: 'status', op: 'eq', value: 'Working Professional' }, messages: { required: 'Select your current role / domain' } },
    text('current_company', 'Current company', 'current_company', 'background', { placeholder: 'Enter your company name', maxLength: 120, ui: { autocomplete: 'organization' }, showWhen: { field: 'status', op: 'eq', value: 'Working Professional' } }),
    { key: 'highest_qualification', label: 'Highest qualification', type: 'select', column: 'highest_qualification', section: 'background', width: 'full', required: false, placeholder: 'Select qualification',
      options: o(O.QUALIFICATIONS), showWhen: { field: 'status', op: 'eq', value: 'Working Professional' }, messages: { invalid: 'Select a qualification from the list' } }
  ];
  fields.forEach((f, i) => { f.order = i; });
  return {
    schema: 1,
    copy: {
      typeLabel: 'Master Class',
      headline: 'Register for the {name} {type}',
      subheadline: 'Share your details and our team will contact you about the {name} session.',
      subheadlineNoName: 'Share your details and our team will contact you with the session information.',
      extra: '', when: '',
      button: 'Register now',
      successTitle: 'Thank you for registering!',
      success: 'Our team will contact you soon with the master class details.',
      fine: 'We only use your details to share master class and course information.'
    },
    sections: [{ id: 'about', title: 'About you' }, { id: 'contact', title: 'Contact' }, { id: 'role', title: 'Your role' }, { id: 'background', title: 'Background' }],
    fields
  };
}

/* ---------------- templating ---------------- */
function templateProblems(tpl) {
  const bad = [];
  String(tpl || '').replace(/\{([^{}]*)\}/g, (_m, k) => { if (!PLACEHOLDERS.includes(k)) bad.push(k); return ''; });
  return [...new Set(bad)];
}

/** Fill {name} {type} {date}. Plain text out (escape on output). With no name the legacy fallback copy is used, as the page does today. */
function renderCopy(def, ctx = {}) {
  const c = (def && def.copy) || {};
  const vars = { name: str(ctx.name, 80), type: str(c.typeLabel || ctx.type, 40), date: str(ctx.date || c.when, 80) };
  const fill = (t) => String(t || '').replace(/\{(name|type|date)\}/g, (_m, k) => vars[k]).replace(/ {2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  const hasName = Boolean(vars.name);
  const headlineTpl = hasName ? c.headline : String(c.headline || '').replace(/\{name\}\s*/g, '');
  const subTpl = hasName ? c.subheadline : (c.subheadlineNoName || String(c.subheadline || '').replace(/\s*\{name\}/g, ''));
  return { headline: fill(headlineTpl), subheadline: fill(subTpl), extra: str(c.extra, 600), when: fill(c.when) };
}

/* ---------------- structural validation ---------------- */
function validateDefinition(def) {
  const problems = [];
  if (!isObj(def)) return ['The form definition must be an object.'];
  if (Buffer.byteLength(JSON.stringify(def)) > LIMITS.definitionBytes) return ['The form definition is too large.'];
  const copy = def.copy;
  if (!isObj(copy)) problems.push('Missing text settings (copy).');
  else {
    for (const k of ['headline', 'subheadline', 'subheadlineNoName', 'extra', 'when', 'button', 'successTitle', 'success', 'typeLabel', 'fine', 'closedTitle', 'closed']) {
      if (copy[k] != null && typeof copy[k] !== 'string') problems.push(`"${k}" must be text.`);
      if (typeof copy[k] === 'string' && copy[k].length > LIMITS.template) problems.push(`"${k}" is too long (max ${LIMITS.template} characters).`);
    }
    for (const k of ['headline', 'subheadline', 'subheadlineNoName', 'when']) {
      const bad = templateProblems(copy[k]);
      if (bad.length) problems.push(`Unknown placeholder ${bad.map((b) => '{' + b + '}').join(', ')} in ${k}. Use {name}, {type} or {date}.`);
    }
    if (!str(copy.button, 60)) problems.push('The button label cannot be empty.');
  }
  const sections = Array.isArray(def.sections) ? def.sections : [];
  const fields = Array.isArray(def.fields) ? def.fields : [];
  if (!sections.length) problems.push('At least one section is needed.');
  if (sections.length > LIMITS.sections) problems.push(`At most ${LIMITS.sections} sections.`);
  if (fields.length > LIMITS.fields) problems.push(`At most ${LIMITS.fields} fields (deleted ones included).`);
  const sectionIds = new Set();
  for (const s of sections) {
    if (!isObj(s) || !/^[a-z][a-z0-9_]{0,30}$/.test(String(s.id || ''))) { problems.push('Every section needs an id made of lowercase letters, digits or underscore.'); continue; }
    if (sectionIds.has(s.id)) problems.push(`Duplicate section "${s.id}".`);
    sectionIds.add(s.id);
    if (!str(s.title, 80)) problems.push(`Section "${s.id}" needs a title.`);
  }
  const keys = new Map(), columns = new Set();
  fields.forEach((f, i) => {
    if (!isObj(f)) { problems.push(`Field ${i + 1} is not valid.`); return; }
    const where = `Field "${f.key || i + 1}"`;
    if (!KEY_RE.test(String(f.key || ''))) problems.push(`${where}: the key must be 2-40 letters or underscores.`);
    else if (keys.has(f.key)) problems.push(`${where}: duplicate key.`);
    keys.set(f.key, f);
    if (!TYPES.includes(f.type)) problems.push(`${where}: unknown type "${f.type}".`);
    if (!str(f.label, LIMITS.label + 1) || String(f.label).length > LIMITS.label) problems.push(`${where}: the label is required (max ${LIMITS.label} characters).`);
    if (!sectionIds.has(f.section)) problems.push(`${where}: its section does not exist.`);
    if (!WIDTHS.includes(f.width || 'full')) problems.push(`${where}: width must be full or half.`);
    for (const k of ['placeholder', 'help']) if (f[k] != null && String(f[k]).length > LIMITS.text) problems.push(`${where}: ${k} is too long.`);
    if (f.ui != null) {
      const u = f.ui;
      if (!isObj(u)) problems.push(`${where}: ui settings are not valid.`);
      else {
        if (u.variant != null && !['cards', 'pills'].includes(u.variant)) problems.push(`${where}: ui.variant must be cards or pills.`);
        if (u.cols != null && ![2, 3, 4].includes(u.cols)) problems.push(`${where}: ui.cols must be 2, 3 or 4.`);
        if (u.autocomplete != null && !/^[a-z-]{1,30}$/.test(String(u.autocomplete))) problems.push(`${where}: ui.autocomplete is not valid.`);
        if (u.countryField != null && u.countryField !== 'country') problems.push(`${where}: ui.countryField must be \"country\".`);
      }
    }
    for (const op of Array.isArray(f.options) ? f.options : []) if (isObj(op) && op.sub != null && String(op.sub).length > 160) { problems.push(`${where}: an option description is too long (max 160 characters).`); break; }
    if (f.column) { if (columns.has(f.column)) problems.push(`${where}: its column is used twice.`); columns.add(f.column); }
    if (f.pattern != null && f.pattern !== '' && !PATTERNS[f.pattern]) problems.push(`${where}: pattern must be one of ${Object.keys(PATTERNS).join(', ')}.`);
    for (const k of ['minLength', 'maxLength']) if (f[k] != null && !(Number.isInteger(f[k]) && f[k] >= 0 && f[k] <= 2000)) problems.push(`${where}: ${k} must be a whole number 0-2000.`);
    if (f.minLength != null && f.maxLength != null && f.minLength > f.maxLength) problems.push(`${where}: minLength is larger than maxLength.`);
    if (CHOICE.has(f.type)) {
      const opts = Array.isArray(f.options) ? f.options : [];
      if (!opts.length) problems.push(`${where}: add at least one option.`);
      if (opts.length > LIMITS.options) problems.push(`${where}: at most ${LIMITS.options} options.`);
      const seen = new Set();
      for (const op of opts) {
        if (!isObj(op) || !str(op.value, 120) || !str(op.label, 120)) { problems.push(`${where}: every option needs a value and a label (max 120 characters).`); break; }
        if (seen.has(op.value)) { problems.push(`${where}: duplicate option "${op.value}".`); break; }
        seen.add(op.value);
      }
    }
  });
  // show-when rules: the controller must exist and come earlier (dependency guard)
  const orderOf = new Map(fields.map((f, i) => [f && f.key, i]));
  fields.forEach((f) => {
    if (!isObj(f) || f.showWhen == null) return;
    const w = f.showWhen, where = `Field "${f.key}"`;
    if (!isObj(w) || !['eq', 'neq', 'in'].includes(w.op)) { problems.push(`${where}: the show-when rule is not valid.`); return; }
    if (!keys.has(w.field)) { problems.push(`${where}: it depends on "${w.field}", which does not exist.`); return; }
    if (w.field === f.key) { problems.push(`${where}: a field cannot depend on itself.`); return; }
    if (orderOf.get(w.field) > orderOf.get(f.key)) problems.push(`${where}: it cannot be placed above "${w.field}", the field that controls it.`);
    else {
      const si = (id) => sections.findIndex((s) => s && s.id === id);
      if (si(keys.get(w.field).section) > si(f.section)) problems.push(`${where}: its section comes before the section of "${w.field}", the field that controls it.`);
    }
    if (w.op === 'in' ? !Array.isArray(w.value) : typeof w.value !== 'string') problems.push(`${where}: the show-when value is not valid.`);
  });
  // system guard: the form must always be able to identify and contact a lead
  const contactable = fields.some((f) => isObj(f) && !f.deleted && !f.hidden && (f.type === 'phone' || f.type === 'email') && f.column && !f.showWhen);
  if (!contactable) problems.push('The form must keep a phone or email field (it is how a lead is identified and contacted, and how duplicates are found).');
  return problems;
}

/** What the browser needs: deleted fields are gone, fields stay in their saved order. */
function publicDefinition(def) {
  const out = JSON.parse(JSON.stringify(def));
  out.fields = out.fields.filter((f) => !f.deleted);
  out.fields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return out;
}

/* ---------------- show-when ---------------- */
function isShown(field, values) {
  const w = field.showWhen;
  if (!w) return true;
  const v = values[w.field];
  if (w.op === 'eq') return v === w.value;
  if (w.op === 'neq') return v !== w.value;
  if (w.op === 'in') return Array.isArray(w.value) && w.value.includes(v);
  return true;
}

/* ---------------- phone (same rules as validate.js) ---------------- */
function normalizePhone(country, raw) {
  let digits = String(raw || '').replace(/[\s\-()]/g, '');
  if (country.other && digits.startsWith('+')) digits = digits.slice(1);
  else digits = digits.replace(/^\+/, '');
  if (!country.other) {
    const code = country.d.slice(1);
    if (digits.startsWith(code) && digits.length > code.length + 6) digits = digits.slice(code.length);
    digits = digits.replace(/^0+/, '');
  }
  return digits;
}

/* ---------------- submission validation ---------------- */
const defaultMsg = (f, kind) => (kind === 'required'
  ? (CHOICE.has(f.type) || f.type === 'consent' || f.type === 'checkbox' ? `Select ${f.label.toLowerCase()}` : `Enter ${f.label.toLowerCase()}`)
  : `${f.label} is not valid`);

/**
 * @returns {{errors:Object, values:Object, columns:Object, custom:Object}}
 *   values  = every accepted answer by field key; columns = answers of built-in fields by leads column;
 *   custom  = answers of custom fields by key (goes to leads.custom_fields). Only meaningful when errors is empty.
 */
function validateSubmission(def, body = {}) {
  const errors = {}, values = {}, columns = {}, custom = {};
  const fields = (def.fields || []).filter((f) => !f.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));   // the order stored in the version, never the client's
  const msg = (f, kind) => (f.messages && f.messages[kind]) || defaultMsg(f, kind);

  for (const f of fields) {
    // the answers of a hidden branch are dropped, exactly like validate.js does (isStudent ? ... : null)
    if (f.hidden || !isShown(f, values)) { values[f.key] = undefined; if (f.column) columns[f.column] = null; continue; }
    const raw = body[f.key], req = Boolean(f.required);
    let val = null;

    if (f.type === 'phone') {
      const countryKey = (f.ui && f.ui.countryField) || 'country';
      const country = COUNTRIES.find((c) => c.c === body[countryKey]) || COUNTRIES[0];
      const digits = normalizePhone(country, raw);
      if (!digits) { if (req) errors[f.key] = msg(f, 'required'); }
      else if (!new RegExp(country.re).test(digits)) errors[f.key] = `Enter a valid number: ${country.hint}`;
      else val = country.other ? `+${digits}` : `${country.d}${digits}`;
      columns.country_code = country.other ? null : country.d;
    } else if (f.type === 'multiselect') {
      const list = Array.isArray(raw) ? raw.map((x) => str(x, 120)).filter(Boolean) : [];
      const allowed = new Set((f.options || []).map((o) => o.value));
      if (list.some((x) => !allowed.has(x))) errors[f.key] = msg(f, 'invalid');
      else if (req && !list.length) errors[f.key] = msg(f, 'required');
      else val = list.length ? [...new Set(list)] : null;
    } else if (f.type === 'checkbox' || f.type === 'consent') {
      const on = raw === true || raw === 'true' || raw === 'on';
      if (req && !on) errors[f.key] = msg(f, 'required'); else val = on;
    } else {
      const max = Math.min(f.maxLength || (f.type === 'textarea' ? 1000 : 200), 2000);
      let s = str(f.type === 'number' && typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw, max);   // only real strings count (like validate.js): 123 or ['x'] is an empty answer
      if (!s) { if (req) errors[f.key] = msg(f, 'required'); }
      else if (f.type === 'email' && !EMAIL_RE.test(s)) errors[f.key] = msg(f, 'invalid');
      else if (f.type === 'url' && !URL_RE.test(s)) errors[f.key] = msg(f, 'invalid');
      else if (f.type === 'date' && (!DATE_RE.test(s) || Number.isNaN(Date.parse(s)))) errors[f.key] = msg(f, 'invalid');
      else if (f.type === 'number' && !(/^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)))) errors[f.key] = msg(f, 'invalid');
      else if ((f.type === 'select' || f.type === 'radio') && !(f.options || []).some((o) => o.value === s)) errors[f.key] = req ? msg(f, 'required') : msg(f, 'invalid');   // same wording as validate.js
      else if (f.minLength && s.length < f.minLength) errors[f.key] = `Enter at least ${f.minLength} characters`;
      else if (f.pattern && !PATTERNS[f.pattern][0].test(s)) errors[f.key] = PATTERNS[f.pattern][1];
      else val = f.type === 'number' ? Number(s) : s;
    }
    values[f.key] = val;
    if (!errors[f.key] && val != null && !(Array.isArray(val) && !val.length)) {
      if (f.column) columns[f.column] = val; else custom[f.key] = val;
    } else if (!errors[f.key] && f.column && f.column !== 'phone') columns[f.column] = null;
  }
  return { errors, values, columns, custom };
}

/** Add the derived columns validate.js also produces (full_name). Names are the fields mapped to first_name / last_name. */
function toLeadColumns(result) {
  const c = Object.assign({}, result.columns);
  if (c.first_name != null || c.last_name != null) c.full_name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return c;
}

/**
 * Rules for changing a form that already has answers. Compared with the PUBLISHED version: a field keeps its key, its type and its
 * leads column for good (stored answers and exports depend on them); to change one of those, add a new field and delete the old one.
 * Returns a list of plain-language problems (empty = fine).
 */
function compareVersions(prev, next) {
  const problems = [], before = new Map(((prev && prev.fields) || []).map((f) => [f.key, f]));
  for (const f of (next && next.fields) || []) {
    const was = before.get(f.key);
    if (!was) continue;
    const name = `\"${was.label || f.key}\"`;
    if (was.type !== f.type && !(f.deleted && was.deleted)) problems.push(`${name}: the field type cannot change after publishing. Add a new field and delete this one.`);
    if ((was.column || null) !== (f.column || null)) problems.push(`${name}: its data column cannot change after publishing.`);
  }
  // a built-in field can be deleted, but a new field may not reuse a deleted built-in field's column (it would mix old and new answers)
  const usedColumns = new Map(((prev && prev.fields) || []).filter((f) => f.column).map((f) => [f.column, f.key]));
  for (const f of (next && next.fields) || []) if (f.column && usedColumns.has(f.column) && usedColumns.get(f.column) !== f.key) problems.push(`\"${f.label || f.key}\": the data column is already used by another field.`);
  return problems;
}

/** Field-level difference between two definitions, for the history screen. */
function diffDefinitions(a, b) {
  const A = new Map(((a && a.fields) || []).map((f) => [f.key, f])), B = new Map(((b && b.fields) || []).map((f) => [f.key, f])), out = [];
  const live = (f) => f && !f.deleted;
  for (const [k, f] of B) {
    const o = A.get(k);
    if (!o || (!live(o) && live(f))) { if (live(f)) out.push({ kind: 'added', key: k, label: f.label }); continue; }
    if (live(o) && !live(f)) { out.push({ kind: 'removed', key: k, label: o.label }); continue; }
    const changes = [];
    for (const prop of ['label', 'type', 'required', 'hidden', 'width', 'placeholder', 'help', 'section', 'order', 'pattern', 'minLength', 'maxLength']) if (JSON.stringify(o[prop] ?? null) !== JSON.stringify(f[prop] ?? null)) changes.push(prop === 'order' ? 'position' : prop);
    if (JSON.stringify(o.options || null) !== JSON.stringify(f.options || null)) changes.push('options');
    if (JSON.stringify(o.showWhen || null) !== JSON.stringify(f.showWhen || null)) changes.push('show-when rule');
    if (live(f) && changes.length) out.push({ kind: 'changed', key: k, label: f.label, changes });
  }
  for (const [k, o] of A) if (!B.has(k) && live(o)) out.push({ kind: 'removed', key: k, label: o.label });
  const ca = (a && a.copy) || {}, cb = (b && b.copy) || {}, copyChanged = Object.keys({ ...ca, ...cb }).filter((k) => (ca[k] || '') !== (cb[k] || ''));
  if (copyChanged.length) out.push({ kind: 'text', changes: copyChanged });
  return out;
}

/**
 * Clean a definition that arrives from the editor: only known properties survive, strings are trimmed and capped, order follows the array,
 * and a data column is kept only when it is one the app already owns (`allowedColumns`), so the editor can never point a field at an arbitrary column.
 */
function sanitizeDefinition(input, { allowedColumns = {} } = {}) {
  const def = isObj(input) ? input : {}, allowed = allowedColumns, c = isObj(def.copy) ? def.copy : {};
  const copy = {};
  for (const k of ['typeLabel', 'headline', 'subheadline', 'subheadlineNoName', 'extra', 'when', 'button', 'successTitle', 'success', 'fine', 'closedTitle', 'closed']) if (typeof c[k] === 'string') copy[k] = c[k].slice(0, LIMITS.template);
  const sections = (Array.isArray(def.sections) ? def.sections : []).filter(isObj).slice(0, LIMITS.sections).map((s) => {
    const o = { id: str(s.id, 31), title: str(s.title, 80) }; if (s.showTitle === true) o.showTitle = true; return o;
  });
  const fields = (Array.isArray(def.fields) ? def.fields : []).filter(isObj).slice(0, LIMITS.fields).map((f, i) => {
    const o = { key: str(f.key, 40), label: str(f.label, LIMITS.label), type: str(f.type, 20), section: str(f.section, 31), width: f.width === 'half' ? 'half' : 'full', order: i, required: f.required === true };
    if (f.column && allowed[o.key] === f.column) o.column = String(f.column);      // a column is kept only for a field the app already owns (same key, same column)
    for (const k of ['hidden', 'deleted', 'system']) if (f[k] === true) o[k] = true;
    for (const k of ['placeholder', 'help']) if (typeof f[k] === 'string' && f[k].trim()) o[k] = f[k].trim().slice(0, LIMITS.text);
    for (const k of ['minLength', 'maxLength']) if (Number.isInteger(f[k])) o[k] = f[k];
    if (f.pattern) o.pattern = str(f.pattern, 20);
    if (typeof f.defaultValue === 'string' && f.defaultValue.trim()) o.defaultValue = f.defaultValue.trim().slice(0, 200);
    if (Array.isArray(f.options)) o.options = f.options.filter(isObj).slice(0, LIMITS.options + 1).map((p) => { const q = { value: str(p.value, 120), label: str(p.label, 120) }; if (typeof p.sub === 'string' && p.sub.trim()) q.sub = p.sub.trim().slice(0, 160); return q; });
    if (isObj(f.showWhen)) o.showWhen = { field: str(f.showWhen.field, 40), op: str(f.showWhen.op, 5), value: Array.isArray(f.showWhen.value) ? f.showWhen.value.map((x) => str(x, 120)).slice(0, 60) : str(f.showWhen.value, 120) };
    if (isObj(f.ui)) {
      const u = {};
      if (['cards', 'pills'].includes(f.ui.variant)) u.variant = f.ui.variant;
      if ([2, 3, 4].includes(f.ui.cols)) u.cols = f.ui.cols;
      if (typeof f.ui.autocomplete === 'string' && /^[a-z-]{1,30}$/.test(f.ui.autocomplete)) u.autocomplete = f.ui.autocomplete;
      if (f.ui.divider === true) u.divider = true;
      if (f.ui.countryField === 'country') u.countryField = 'country';
      if (Object.keys(u).length) o.ui = u;
    }
    if (isObj(f.messages)) { const m = {}; for (const k of ['required', 'invalid']) if (typeof f.messages[k] === 'string' && f.messages[k].trim()) m[k] = f.messages[k].trim().slice(0, 200); if (Object.keys(m).length) o.messages = m; }
    return o;
  });
  return { schema: 1, copy, sections, fields };
}

module.exports = { sanitizeDefinition, compareVersions, diffDefinitions, toLeadColumns, defaultDefinition, validateDefinition, validateSubmission, renderCopy, publicDefinition, templateProblems, isShown, normalizePhone, TYPES, PATTERNS, PLACEHOLDERS, LIMITS, KEY_RE };
