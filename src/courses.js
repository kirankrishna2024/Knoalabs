// Master class registry. The `courses` table is the source of truth; options.COURSES / COURSE_PATHS are kept in sync
// *in place*, so validate.js, analytics.js and the registration page keep reading them synchronously.
// ensureFresh() is cheap (one small query at most every few seconds) so several app instances stay consistent.
const O = require('./options');
const log = require('./logger');
const Course = require('./models/Course');

const TTL_MS = 4000;
let loadedAt = 0, inflight = null;

function apply(rows) {
  for (const k of Object.keys(O.COURSES)) delete O.COURSES[k];
  for (const k of Object.keys(O.COURSE_PATHS)) delete O.COURSE_PATHS[k];
  for (const r of rows) { O.COURSES[r.slug] = r.name; O.COURSE_PATHS[r.slug] = r.path; }
}

async function refresh() {
  const rows = await Course.all();
  if (rows.length) apply(rows);
  loadedAt = Date.now();
  return rows;
}

/** Reload from the database when the copy in memory is older than a few seconds. Never throws. */
function ensureFresh() {
  if (Date.now() - loadedAt < TTL_MS) return Promise.resolve();
  if (!inflight) {
    inflight = refresh().catch((e) => { log.warn({ err: e.message }, 'could not reload master classes; using the copy in memory'); loadedAt = Date.now() - TTL_MS + 1000; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** "Machine Learning" -> { name, path: 'machine-learning', slug: 'machinelearning' } or { error }. */
function parseName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { error: 'Enter the master class name (at least 2 characters).' };
  if (name.length > 60) return { error: 'Keep the name under 60 characters.' };
  if (!/^[\p{L}\p{N} &.+#/:,'()-]+$/u.test(name)) return { error: 'Use letters, numbers and spaces only (a few symbols like & + # are fine).' };
  const path = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  const slug = path.replace(/-/g, '');
  if (slug.length < 2) return { error: 'The name needs at least 2 English letters or numbers, they become the link.' };
  if (O.RESERVED.includes(slug) || O.ALIASES[slug]) return { error: 'That name is reserved for the system. Please choose another.' };
  return { name, path, slug };
}

async function create(rawName) {
  await refresh().catch(() => {});
  const p = parseName(rawName);
  if (p.error) return { error: p.error };
  if (O.COURSES[p.slug]) return { error: `"${O.COURSES[p.slug]}" already exists (same link).`, duplicate: true };
  try {
    const row = await Course.create(p);
    await refresh();
    return { course: row };
  } catch (e) {
    if (e && e.code === '23505') return { error: 'A master class with this link already exists.', duplicate: true };
    throw e;
  }
}

async function remove(slug) {
  if (O.DEFAULT_SLUGS.includes(slug)) return { error: 'The default master classes cannot be deleted.', status: 400 };
  const row = await Course.remove(slug);
  if (!row) return { error: 'Master class not found.', status: 404 };
  await refresh();
  return { course: row };
}

module.exports = { ensureFresh, refresh, create, remove, parseName };
