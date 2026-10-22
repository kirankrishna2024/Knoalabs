const db = require('../db');
const { startOfDay } = require('../time');

/** Columns the application writes. (id, created_at, updated_at are managed by the database.) */
const FIELDS = [
  'first_name', 'last_name', 'full_name', 'country_code', 'phone', 'email', 'status',
  'student_course', 'student_status', 'college_name', 'specialization',
  'experience_level', 'job_role', 'current_company', 'highest_qualification',
  'course', 'course_slug', 'page_url', 'page_title', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'meta_platform', 'meta_placement', 'ip', 'user_agent', 'client_id',
  'source_detected', 'source_method',           // migration 014: where the visit came from, worked out by the server (src/sources.js)
  'form_id', 'form_version', 'custom_fields', 'visitor_id', 'session_id', 'campaign_id', 'device_type', 'os', 'browser', 'in_app', 'ip_hash', 'ip_version',
  'browser_lat', 'browser_lon', 'browser_accuracy', 'browser_geo_at',          // migration 017: exact location when the browser allowed it
  'is_returning_lead', 'previous_lead_id', 'submission_count', 'visit_count_before_signup', 'time_to_register_seconds', 'match_basis'
];
const JSON_FIELDS = new Set(['custom_fields']);
const valueOf = (lead, f) => (JSON_FIELDS.has(f) && lead[f] != null && typeof lead[f] === 'object' ? JSON.stringify(lead[f]) : lead[f]);
const READ_ONLY = ['geo_city', 'geo_region', 'geo_country', 'geo_country_code'];      // written by the location lookup, only read here
const SELECT = ['id', 'created_at', 'updated_at', ...FIELDS, ...READ_ONLY].join(', ');
const NO_COURSE = '__none';          // filter value for leads that came from the plain link (no course in the URL)

class Lead {
  constructor(data = {}) {
    for (const f of FIELDS) this[f] = data[f] ?? null;
    for (const f of READ_ONLY) if (data[f] !== undefined) this[f] = data[f];        // only when it was selected (lists and exports)
    this.id = data.id ?? null;
    this.created_at = data.created_at ?? null;
    this.updated_at = data.updated_at ?? null;
  }

  async save() {
    const ph = FIELDS.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO leads (${FIELDS.join(',')}) VALUES (${ph}) RETURNING id, created_at, updated_at`,
      FIELDS.map((f) => valueOf(this, f)));
    Object.assign(this, rows[0]);
    return this;
  }

  static async create(data) { return new Lead(data).save(); }

  /**
   * Insert once per client_id. A repeat of the same submission (double tap, network retry)
   * returns the original row with duplicate=true instead of creating a second lead.
   */
  static async createOnce(data) {
    const lead = new Lead(data);
    if (!lead.client_id) return { lead: await lead.save(), duplicate: false };
    const existing = await db.query(`SELECT ${SELECT} FROM leads WHERE client_id=$1`, [lead.client_id]);
    if (existing.rows.length) return { lead: new Lead(existing.rows[0]), duplicate: true };
    // Two identical requests can still arrive at the same instant: the unique index + ON CONFLICT
    // makes the loser insert nothing, and we then return the winner's row.
    const ph = FIELDS.map((_, i) => `$${i + 1}`).join(',');
    const ins = await db.query(
      `INSERT INTO leads (${FIELDS.join(',')}) VALUES (${ph}) ON CONFLICT (client_id) DO NOTHING RETURNING id, created_at, updated_at`,
      FIELDS.map((f) => valueOf(lead, f)));
    if (ins.rows.length) { Object.assign(lead, ins.rows[0]); return { lead, duplicate: false }; }
    const { rows } = await db.query(`SELECT ${SELECT} FROM leads WHERE client_id=$1`, [lead.client_id]);
    return { lead: new Lead(rows[0]), duplicate: true };
  }

  static async findById(id) {
    const { rows } = await db.query(`SELECT ${SELECT} FROM leads WHERE id=$1`, [id]);
    return rows[0] ? new Lead(rows[0]) : null;
  }

  /** WHERE clause for the admin filters: { q, status, course, from, to } (from/to are Dates, `to` exclusive). */
  static where(f = {}) {
    const c = [], p = [];
    const add = (sql, v) => { p.push(v); c.push(sql.replace('?', '$' + p.length)); };
    if (f.q) {
      p.push('%' + String(f.q).replace(/[\\%_]/g, '\\$&') + '%');
      const i = '$' + p.length;
      c.push(`(full_name ILIKE ${i} OR phone ILIKE ${i} OR email ILIKE ${i} OR college_name ILIKE ${i} OR current_company ILIKE ${i})`);
    }
    if (f.status) add('status = ?', f.status);
    if (f.course === NO_COURSE) c.push('course_slug IS NULL');
    else if (f.course) add('course_slug = ?', f.course);
    // ad tags (analytics): NO_COURSE doubles as the "__none" marker = lead came without that tag
    if (f.campaign === NO_COURSE) c.push(`(utm_campaign IS NULL OR utm_campaign = '')`);
    else if (f.campaign) add('utm_campaign = ?', f.campaign);
    if (f.medium === NO_COURSE) c.push(`(utm_medium IS NULL OR utm_medium = '')`);
    else if (f.medium) add('LOWER(utm_medium) = ?', String(f.medium).toLowerCase());
    if (f.from) add('created_at >= ?', f.from);
    if (f.to) add('created_at < ?', f.to);
    return { sql: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p };
  }

  /** One page of leads, newest first, with the total matching the filters. */
  static async list({ limit = 25, offset = 0, ...filters } = {}) {
    const w = Lead.where(filters);
    const { rows } = await db.query(
      `SELECT ${SELECT} FROM leads ${w.sql} ORDER BY created_at DESC, id DESC LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`,
      [...w.params, limit, offset]);
    const { rows: c } = await db.query(`SELECT COUNT(*)::int AS total FROM leads ${w.sql}`, w.params);
    return { total: c[0].total, rows: rows.map((r) => new Lead(r)) };
  }

  /** Permanently delete one lead. Returns true when a row was removed. */
  static async remove(id) {
    const { rows } = await db.query('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }

  /** Every lead matching the filters (Excel export). */
  static async all(filters = {}) {
    const w = Lead.where(filters);
    const { rows } = await db.query(`SELECT ${SELECT} FROM leads ${w.sql} ORDER BY created_at DESC, id DESC`, w.params);
    return rows.map((r) => new Lead(r));
  }

  /**
   * Raw material for the live analytics page: the few columns it needs for every lead created on or after
   * `since`. By default NO other filter is applied in SQL: analytics.js filters in JavaScript so that every
   * filter (master class, campaign, channel, medium, "I am a") can also report how many leads each of its
   * options would show with the other filters applied (the numbers on the chips). The same code then runs
   * on real PostgreSQL and on the pg-mem database used by the test suite. Capped as a safety net.
   */
  static async forAnalytics({ since, status, course, campaign, medium, limit = 100000 }) {
    const w = Lead.where({ status, course, campaign, medium, from: since });
    const { rows } = await db.query(
      `SELECT id, created_at, status, course_slug, course, student_course, student_status, college_name, specialization, experience_level, job_role, highest_qualification,
              utm_source, utm_medium, utm_campaign, source_detected, meta_platform, meta_placement, referrer, user_agent, country_code, email
       FROM leads ${w.sql} ORDER BY created_at DESC, id DESC LIMIT $${w.params.length + 1}`, [...w.params, limit]);
    return rows;
  }

  /** How many leads match the status / course / campaign / medium filters (all time). */
  static async countMatching({ status, course, campaign, medium } = {}) {
    const w = Lead.where({ status, course, campaign, medium });
    return (await db.query(`SELECT COUNT(*)::int AS n FROM leads ${w.sql}`, w.params)).rows[0].n;
  }

  /**
   * Lead counts per distinct (utm_source, referrer, meta_platform) triple for the given filters. The ad channel is derived
   * from those columns in JavaScript (analytics.js channelOf), so a channel filter on the all-time count sums the
   * triples that map to it. Capped at 20 000 groups.
   */
  static async sourceGroups({ status, course, campaign, medium } = {}) {
    const w = Lead.where({ status, course, campaign, medium });
    const { rows } = await db.query(
      `SELECT utm_source, referrer, meta_platform, source_detected, COUNT(*)::int AS n FROM leads ${w.sql} GROUP BY utm_source, referrer, meta_platform, source_detected LIMIT 20000`, w.params);
    return rows;
  }

  /** The newest leads (for the live feed). Name, status and master class (+ the channel columns, which never leave the server). */
  static async recent({ status, course, campaign, medium, limit = 8 } = {}) {
    const w = Lead.where({ status, course, campaign, medium });
    const { rows } = await db.query(
      `SELECT id, created_at, full_name, status, course_slug, course, utm_source, referrer, meta_platform, source_detected, user_agent FROM leads ${w.sql} ORDER BY created_at DESC, id DESC LIMIT $${w.params.length + 1}`,
      [...w.params, limit]);
    return rows;
  }

  /**
   * Numbers for the dashboard: total / today / last 7 / last 30 days (days follow the configured time zone),
   * plus the split by "I am a" and by master class. Three small queries; the four counts share one table scan.
   */
  static async stats({ tz, now = new Date() }) {
    const since = (offsetDays) => startOfDay(tz, now, offsetDays);
    const [counts, byStatus, byCourse] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END), 0)::int AS today,
                COALESCE(SUM(CASE WHEN created_at >= $2 THEN 1 ELSE 0 END), 0)::int AS last7,
                COALESCE(SUM(CASE WHEN created_at >= $3 THEN 1 ELSE 0 END), 0)::int AS last30
         FROM leads`, [since(0), since(-6), since(-29)]),
      db.query('SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status ORDER BY n DESC'),
      db.query('SELECT course_slug, MAX(course) AS course, COUNT(*)::int AS n FROM leads GROUP BY course_slug ORDER BY n DESC')
    ]);
    const c = counts.rows[0];
    return {
      total: c.total, today: c.today, last7: c.last7, last30: c.last30,
      byStatus: byStatus.rows,
      byCourse: byCourse.rows.map((r) => ({ course_slug: r.course_slug, course: r.course, n: r.n }))
    };
  }
}

Lead.NO_COURSE = NO_COURSE;
module.exports = Lead;
