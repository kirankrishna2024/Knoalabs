// Forms: one per master class / session path. Every save is an immutable version (form_versions); the public page reads the published one.
// seedDefaultForms() is idempotent: it gives every course that has no form yet the default form (today's registration form) as version 1.
const db = require('./db');
const crypto = require('crypto');
const F = require('./formdef');
const O = require('./options');

const STATUSES = ['active', 'draft', 'paused', 'archived'];

/** Create the default form (+ version 1) for each course without one, and link historical leads to it (form_version stays NULL = legacy). */
async function seedDefaultForms() {
  const { rows: courses } = await db.query('SELECT slug, name, path FROM courses ORDER BY sort_order, id');
  const created = [];
  for (const c of courses) {
    const exists = await db.query('SELECT id FROM forms WHERE course_slug=$1', [c.slug]);
    if (exists.rows.length) continue;
    const ins = await db.query(
      `INSERT INTO forms (course_slug, path, name, type_label, status, current_version, published_version) VALUES ($1,$2,$3,'Master Class','active',1,1)
       ON CONFLICT (course_slug) DO NOTHING RETURNING id`, [c.slug, c.path, c.name]);
    if (!ins.rows.length) continue;                                                  // another instance won the race
    await db.query(`INSERT INTO form_versions (form_id, version, definition, author, note, published_at) VALUES ($1,1,$2,'system','Default form (the registration form as it was before Form Studio)', now())
                    ON CONFLICT (form_id, version) DO NOTHING`, [ins.rows[0].id, JSON.stringify(F.defaultDefinition())]);
    created.push(c.slug);
  }
  await db.query('UPDATE leads SET form_id = f.id FROM forms f WHERE leads.form_id IS NULL AND leads.course_slug = f.course_slug');
  return { created };
}

/** "Student Intake" -> { name, path: 'student-intake', slug: 'studentintake' } or { error }. Same link rules as master classes. */
function parseFormName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { error: 'Enter the form name (at least 2 characters).' };
  if (name.length > 60) return { error: 'Keep the name under 60 characters.' };
  if (!/^[\p{L}\p{N} &.+#/:,'()-]+$/u.test(name)) return { error: 'Use letters, numbers and spaces only (a few symbols like & + # are fine).' };
  const path = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  const slug = path.replace(/-/g, '');
  if (slug.length < 2) return { error: 'The name needs at least 2 English letters or numbers, they become the link.' };
  if (O.RESERVED.includes(slug) || O.RESERVED.includes(path) || O.ALIASES[slug]) return { error: 'That name is reserved for the system. Please choose another.' };
  return { name, path, slug };
}

/**
 * Create a form on its own (not tied to a master class): name only. It starts as the standard registration form,
 * published as version 1, so its link works at once. `path` is the link and is unique.
 */
async function createForm(rawName, author) {
  const p = parseFormName(rawName);
  if (p.error) return p;
  if (O.COURSES[p.slug] || O.COURSE_PATHS[p.slug]) return { error: 'That name already belongs to a master class; its form is already in the list.', duplicate: true };
  const exists = await db.query('SELECT id FROM forms WHERE course_slug=$1 OR path=$2', [p.path, p.path]);
  if (exists.rows.length) return { error: `A form with the link "/${p.path}" already exists. Pick another name.`, duplicate: true };
  try {
    const row = await db.tx(async (c) => {
      // the form is its own top-level entity: course_slug holds the same link key the registration page resolves,
      // so leads and campaigns of this form agree without pretending it is a master class
      const ins = await c.query(
        `INSERT INTO forms (course_slug, path, name, type_label, status, current_version, published_version)
         VALUES ($1,$2,$3,'Registration','active',1,1) RETURNING *`, [p.path, p.path, p.name]);
      await c.query(
        `INSERT INTO form_versions (form_id, version, definition, author, note, published_at)
         VALUES ($1,1,$2,$3,'New form (the standard registration form)', now())`,
        [ins.rows[0].id, JSON.stringify(F.defaultDefinition()), author || null]);
      return ins.rows[0];
    });
    return { form: row };
  } catch (e) {
    if (e && e.code === '23505') return { error: 'A form with this link already exists. Pick another name.', duplicate: true };
    throw e;
  }
}

/** The form for a link path or alias: { form, version, definition } or null. Falls back to nothing when the course is unknown. */
async function findPublished(rawPath) {
  const clean = String(rawPath || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  let key = clean.replace(/-/g, '');
  if (!key) return null;
  key = O.ALIASES[key] || key;
  const { rows } = await db.query(
    `SELECT f.id, f.course_slug, f.path, f.name, f.type_label, f.status, f.published_version, v.version, v.definition
     FROM forms f JOIN form_versions v ON v.form_id = f.id AND v.version = f.published_version WHERE (f.course_slug = $1 OR f.path = $2)`, [key, clean]);
  if (!rows.length) return null;
  const r = rows[0];
  return { form: { id: r.id, course_slug: r.course_slug, path: r.path, name: r.name, type_label: r.type_label, status: r.status }, version: r.version, definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition };
}

/** Body of GET /api/forms/:path: the public definition (no deleted fields), the copy already filled in, and an ETag. */
function publicPayload(found) {
  const def = F.publicDefinition(found.definition);
  const body = { ok: true, form_id: found.form.id, version: found.version, status: found.form.status, name: found.form.name,
    copy: F.renderCopy(found.definition, { name: found.form.name }), button: def.copy.button, successTitle: def.copy.successTitle, success: def.copy.success, fine: def.copy.fine,
    sections: def.sections, fields: def.fields };
  const etag = '"' + crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 20) + '"';
  return { body, etag };
}

/** Like findPublished, but also returns forms that are paused / draft / archived (so the page can say "closed" instead of guessing). */
async function findForPath(rawPath) {
  const clean = String(rawPath || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  let key = clean.replace(/-/g, '');
  if (!key || O.RESERVED.includes(key)) return null;
  key = O.ALIASES[key] || key;
  const { rows } = await db.query('SELECT id, course_slug, path, name, type_label, status, current_version, published_version FROM forms WHERE course_slug = $1 OR path = $2', [key, clean]);
  if (!rows.length) return null;
  const f = rows[0];
  if (f.published_version == null) return { form: f, version: null, definition: null };
  const v = await db.query('SELECT version, definition FROM form_versions WHERE form_id=$1 AND version=$2', [f.id, f.published_version]);
  if (!v.rows.length) return { form: f, version: null, definition: null };
  return { form: f, version: v.rows[0].version, definition: asObj(v.rows[0].definition) };
}
const asObj = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

/**
 * What the registration page embeds. Always returns something the page can draw: the published definition, a closed notice,
 * or the built-in default form when the course has no form row yet or the database is unreachable.
 * `closed` is true for paused / draft / archived forms.
 */
async function pagePayload(rawPath, courseName) {
  let found = null;
  try { found = await findForPath(rawPath); } catch { found = null; }
  const name = courseName || (found && found.form.name) || '';
  if (!found || !found.definition) {
    const def = F.defaultDefinition();
    const closed = Boolean(found);                                    // a form row exists but nothing is published yet
    return payloadFrom({ form: { id: found ? found.form.id : null, name, status: found ? (found.form.status === 'active' ? 'draft' : found.form.status) : 'active' }, version: null, definition: def }, name, closed);
  }
  return payloadFrom(found, name, found.form.status !== 'active');
}
function payloadFrom(found, name, closed) {
  const def = F.publicDefinition(found.definition);
  return { ok: true, form_id: found.form.id, version: found.version, status: found.form.status, closed: Boolean(closed), name: found.form.name,
    copy: F.renderCopy(found.definition, { name }), button: def.copy.button, successTitle: def.copy.successTitle, success: def.copy.success, fine: def.copy.fine,
    closedTitle: def.copy.closedTitle || undefined, closedText: def.copy.closed || undefined, sections: def.sections, fields: def.fields };
}

/**
 * The definition a submission is checked against. `version` is the one the person's page was drawn from; it is honoured
 * when it exists and is not newer than the published one, so a form published while someone is typing does not break their submit.
 * Returns { definition, form_id, version, closed } or null (no form in the database: caller uses the built-in default).
 */
async function resolveForSubmit(rawPath, wantedVersion) {
  const found = await findForPath(rawPath);
  if (!found) return null;
  if (found.form.status !== 'active' || !found.definition) return { closed: true, form_id: found.form.id };
  const want = Number.isInteger(wantedVersion) ? wantedVersion : null;
  if (want && want !== found.version && want < found.version) {
    const { rows } = await db.query('SELECT version, definition FROM form_versions WHERE form_id=$1 AND version=$2', [found.form.id, want]);
    if (rows.length) return { definition: asObj(rows[0].definition), form_id: found.form.id, version: want, closed: false };
  }
  return { definition: found.definition, form_id: found.form.id, version: found.version, closed: false };
}

module.exports = { seedDefaultForms, createForm, parseFormName, findPublished, findForPath, pagePayload, publicPayload, resolveForSubmit, STATUSES };
