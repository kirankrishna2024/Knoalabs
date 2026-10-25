// Same-person detection. One person may register more than once (another master class, a second try, a new phone number
// for the same e-mail). We never merge or block anything: a lead is only flagged, with the evidence that links it.
//   phone  : same normalised mobile number (strong)
//   email  : same e-mail, case-insensitive (strong)
//   device : same anonymous visitor id, i.e. the same browser (probable: a shared computer looks the same)
const db = require('./db');

/** @returns {{is_returning_lead:boolean, previous_lead_id:number|null, submission_count:number, match_basis:string|null}} */
async function findRelated({ phone, email, visitor_id, excludeId = null }) {
  const out = { is_returning_lead: false, previous_lead_id: null, submission_count: 1, match_basis: null };
  const em = email ? String(email).toLowerCase() : null;
  if (!phone && !em && !visitor_id) return out;
  const { rows } = await db.query(
    `SELECT id, phone, email, visitor_id FROM leads
     WHERE (phone = $1 OR ($2::text IS NOT NULL AND LOWER(email) = $2) OR ($3::text IS NOT NULL AND visitor_id = $3)) AND ($4::bigint IS NULL OR id <> $4)
     ORDER BY id DESC LIMIT 200`, [phone || null, em, visitor_id || null, excludeId]);
  if (!rows.length) return out;
  const basis = new Set();
  for (const r of rows) {
    if (phone && r.phone === phone) basis.add('phone');
    if (em && r.email && r.email.toLowerCase() === em) basis.add('email');
    if (visitor_id && r.visitor_id === visitor_id) basis.add('device');
  }
  const order = ['phone', 'email', 'device'];
  return { is_returning_lead: true, previous_lead_id: Number(rows[0].id), submission_count: rows.length + 1, match_basis: order.filter((b) => basis.has(b)).join(',') };
}

/** Other registrations that look like the same person as lead `id` (for the admin lead view). */
async function relatedTo(id) {
  const { rows: base } = await db.query('SELECT id, phone, email, visitor_id FROM leads WHERE id=$1', [id]);
  if (!base.length) return null;
  const b = base[0], em = b.email ? b.email.toLowerCase() : null;
  const { rows } = await db.query(
    `SELECT id, created_at, full_name, phone, email, course, status, utm_campaign, source_detected, visitor_id FROM leads
     WHERE id <> $1 AND (phone = $2 OR ($3::text IS NOT NULL AND LOWER(email) = $3) OR ($4::text IS NOT NULL AND visitor_id = $4)) ORDER BY id DESC LIMIT 50`,
    [id, b.phone, em, b.visitor_id || null]);
  return rows.map((r) => ({ id: Number(r.id), created_at: r.created_at, full_name: r.full_name, phone: r.phone, email: r.email, course: r.course, status: r.status, utm_campaign: r.utm_campaign, source: r.source_detected,
    basis: [r.phone === b.phone ? 'phone' : null, em && r.email && r.email.toLowerCase() === em ? 'email' : null, b.visitor_id && r.visitor_id === b.visitor_id ? 'device' : null].filter(Boolean) }));
}

module.exports = { findRelated, relatedTo };
