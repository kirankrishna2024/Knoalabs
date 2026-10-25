const db = require('../db');

/** Master classes (table `courses`). Leads keep their own copy of the slug + name, so deleting a course never touches leads. */
class Course {
  static async all() {
    const { rows } = await db.query('SELECT id, slug, name, path, is_default, sort_order, created_at FROM courses ORDER BY sort_order, id');
    return rows;
  }

  static async create({ slug, name, path }) {
    const { rows: m } = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses');
    const { rows } = await db.query(
      'INSERT INTO courses (slug, name, path, is_default, sort_order) VALUES ($1,$2,$3,false,$4) RETURNING id, slug, name, path, is_default, sort_order, created_at',
      [slug, name, path, Number(m[0].m) + 1]);
    return rows[0];
  }

  /** Delete a custom course. Default ones are protected. Returns the deleted row or null. */
  static async remove(slug) {
    const { rows } = await db.query('DELETE FROM courses WHERE slug = $1 AND is_default = false RETURNING slug, name', [slug]);
    return rows[0] || null;
  }

  /** Leads per course slug (null slug = plain link). */
  static async leadCounts() {
    const { rows } = await db.query('SELECT course_slug, COUNT(*)::int AS n FROM leads GROUP BY course_slug');
    return new Map(rows.map((r) => [r.course_slug, r.n]));
  }
}

module.exports = Course;
