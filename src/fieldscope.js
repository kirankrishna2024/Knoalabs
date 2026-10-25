// Which questions the LIVE form(s) ask, and what people answered, so the analytics page shows only what exists.
//   describe(filters)  -> the forms in scope (the chosen master class, or every live form) and which built-in answers they collect
//   answers(...)       -> one breakdown per question that has no fixed leads column (custom questions added in Form Studio)
// A question that was removed from a form (deleted:true) is not "live": it is not listed, so charts built on it disappear when you look at
// that form, while the answers stay in the database and in the Excel exports. Nothing here changes how registrations are stored.
const db = require('./db');
const Lead = require('./models/Lead');
const A = require('./analytics');
const LV = require('./leadview');

const asObj = (d) => { try { return typeof d === 'string' ? JSON.parse(d) : d || {}; } catch { return {}; } };
const COLUMNS = ['status', 'student_course', 'student_status', 'college_name', 'specialization', 'experience_level', 'job_role', 'current_company', 'highest_qualification', 'email', 'phone', 'first_name', 'last_name'];
const MAX_ROWS = 20000, TOP = 12;

/** Published, non-archived forms with their live (not deleted) fields. */
async function liveForms() {
  const { rows } = await db.query(
    `SELECT f.id, f.course_slug, f.path, f.name, f.status, v.definition
     FROM forms f JOIN form_versions v ON v.form_id = f.id AND v.version = f.published_version WHERE f.published_version IS NOT NULL AND f.status <> 'archived' ORDER BY f.id`);
  return rows.map((r) => ({ id: Number(r.id), slug: r.course_slug, name: r.name, fields: (asObj(r.definition).fields || []).filter((f) => f && !f.deleted), deleted: (asObj(r.definition).fields || []).filter((f) => f && f.deleted).map((f) => f.key) }));
}

/** The forms a filter looks at: the chosen master class (when it has a form), else every live form. */
function inScope(forms, filters) {
  const slug = filters && filters.course;
  if (slug && slug !== Lead.NO_COURSE) { const one = forms.filter((f) => f.slug === slug); if (one.length) return { all: false, forms: one }; }
  return { all: true, forms };
}

async function describe(filters) {
  const forms = await liveForms(), sc = inScope(forms, filters);
  const has = Object.fromEntries(COLUMNS.map((c) => [c, false]));
  const fields = new Map();
  for (const form of sc.forms) for (const f of form.fields) {
    if (f.column && has[f.column] !== undefined) has[f.column] = true;
    let o = fields.get(f.key); if (!o) { o = { key: f.key, label: f.label || f.key, type: f.type, column: f.column || null, options: Array.isArray(f.options) ? f.options : [], forms: [] }; fields.set(f.key, o); }
    o.forms.push({ slug: form.slug, name: form.name });
  }
  const removed = [...new Set(sc.forms.flatMap((f) => f.deleted))].filter((k) => !fields.has(k));          // asked once, removed since (their answers stay in the database)
  return { scope: { all: sc.all, forms: sc.forms.map((f) => ({ slug: f.slug, name: f.name })) }, has, fields: [...fields.values()], removed };
}

const top = (m, n) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

/** Breakdown of the custom questions (no leads column) of the forms in scope, over the leads that pass the page filters in the window. */
async function answers({ tz, query = {}, now }) {
  const win = A.resolveWindow({ tz, now, from: query.from, to: query.to, days: query.days }), filters = A.normalizeFilters(query);
  const info = await describe(filters);
  const rows = (await Lead.forView({ from: new Date(win.bounds[0]), to: new Date(win.bounds[win.n]), limit: MAX_ROWS })).filter((l) => LV.passes(l, filters));
  const out = [];
  for (const f of info.fields) {
    if (f.column) continue;                                           // built-in questions already have their own panels
    if (!['select', 'radio', 'multiselect', 'checkbox', 'consent', 'text', 'number'].includes(f.type)) continue;
    const label = new Map(f.options.map((o) => [String(o.value), o.label || String(o.value)]));
    const counts = new Map(), nums = []; let answered = 0;
    for (const l of rows) {
      const cf = asObj(l.custom_fields), v = cf[f.key];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      answered++;
      if (f.type === 'number') { const x = Number(v); if (Number.isFinite(x)) nums.push(x); continue; }
      const list = Array.isArray(v) ? v : f.type === 'checkbox' || f.type === 'consent' ? [v === true || v === 'true' || v === 'yes' ? 'Yes' : 'No'] : [v];
      for (const x of list) { const s = String(x).trim().slice(0, 60); if (s) counts.set(label.get(s) || (f.type === 'text' ? s.toLowerCase() : s), (counts.get(label.get(s) || (f.type === 'text' ? s.toLowerCase() : s)) || 0) + 1); }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const values = top(counts, TOP).map(([name, n]) => ({ name, n, share: total ? Math.round((n / total) * 1000) / 10 : 0 }));
    const rest = total - values.reduce((a, b) => a + b.n, 0); if (rest > 0) values.push({ name: 'Other', n: rest, share: Math.round((rest / total) * 1000) / 10 });
    out.push({ key: f.key, label: f.label, type: f.type, forms: f.forms, answered, total: rows.length, values,
      numeric: f.type === 'number' && nums.length ? { avg: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100, min: Math.min(...nums), max: Math.max(...nums) } : null });
  }
  return { scope: info.scope, has: info.has, fields: out, window: { from: win.from, to: win.to, days: win.n }, registrations: rows.length };
}

module.exports = { describe, answers, liveForms, inScope };
