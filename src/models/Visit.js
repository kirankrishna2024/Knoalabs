const db = require('../db');
const config = require('../config');
const { ymd } = require('../time');

const SLOT = 15 * 60 * 1000;           // visits are grouped in 15-minute slots: every real time zone offset is a multiple of 15 minutes
const NO_COURSE = '__none';

const Visit = {
  SLOT,

  /** Store one visit. Returns true when it was new, false when the same visitor already counted for this link today
   *  ("today" = the calendar day in the configured time zone, the same day the analytics page uses). */
  async record({ visitor_id, course_slug = null, utm_source = null, utm_medium = null, utm_campaign = null, referrer_host = null, meta_platform = null, meta_placement = null, source_detected = null, source_method = null, browser_lat = null, browser_lon = null, browser_accuracy = null, browser_geo_at = null }, now = new Date()) {
    // the Meta app is part of the key only when known, so keys written before v3.8 stay valid; Facebook and Instagram opens of one person are two opens
    const key = [visitor_id, ymd(config.timezone, now), course_slug || '', utm_source || '', (utm_medium || '').toLowerCase(), utm_campaign || ''].join('|') + (meta_platform ? '|' + meta_platform : '');
    const { rows } = await db.query(
      `INSERT INTO page_visits (created_at, bucket, dedupe_key, course_slug, utm_source, utm_medium, utm_campaign, referrer_host, meta_platform, meta_placement, source_detected, source_method, browser_lat, browser_lon, browser_accuracy, browser_geo_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [now, Math.floor(now.getTime() / SLOT) * SLOT, key, course_slug, utm_source, utm_medium, utm_campaign, referrer_host, meta_platform, meta_placement, source_detected, source_method,
        browser_lat, browser_lon, browser_accuracy, browser_geo_at]);
    if (!rows.length && browser_lat != null && browser_lon != null) {
      // the open was already counted earlier (same visitor, link, day); add the exact location the browser shared afterwards
      await db.query('UPDATE page_visits SET browser_lat=$2, browser_lon=$3, browser_accuracy=$4, browser_geo_at=$5 WHERE dedupe_key=$1 AND browser_lat IS NULL',
        [key, browser_lat, browser_lon, browser_accuracy, browser_geo_at]);
    }
    return rows.length > 0;
  },

  /** Visits since `since`, already grouped (slot x master class x tags x referrer host x Meta app): small even with many visitors. */
  async groups({ since }) {
    const { rows } = await db.query(
      `SELECT bucket, course_slug, utm_source, utm_medium, utm_campaign, referrer_host, meta_platform, meta_placement, source_detected, COUNT(*)::int AS n
       FROM page_visits WHERE created_at >= $1
       GROUP BY bucket, course_slug, utm_source, utm_medium, utm_campaign, referrer_host, meta_platform, meta_placement, source_detected ORDER BY bucket DESC LIMIT 500000`, [since]);   // if the cap is ever hit, the oldest slots drop first
    return rows.map((r) => ({ ...r, bucket: Number(r.bucket) }));
  },

  /** When the first visit was recorded (the counter only knows about visits from then on), or null. */
  async firstAt() {
    const { rows } = await db.query('SELECT MIN(created_at) AS t FROM page_visits');
    return rows[0] && rows[0].t ? new Date(rows[0].t).toISOString() : null;
  },

  /** Opens per course slug and traffic source, all time (the Meta app is worked out from these in admin.js). */
  async countsByCourseSource() {
    const { rows } = await db.query(
      `SELECT course_slug, utm_source, referrer_host, meta_platform, source_detected, COUNT(*)::int AS n
       FROM page_visits GROUP BY course_slug, utm_source, referrer_host, meta_platform, source_detected LIMIT 20000`);
    return rows;
  },

  /** Opens per course slug (null = plain link), all time. */
  async countsByCourse() {
    const { rows } = await db.query('SELECT course_slug, COUNT(*)::int AS n FROM page_visits GROUP BY course_slug');
    return new Map(rows.map((r) => [r.course_slug, r.n]));
  }
};

Visit.NO_COURSE = NO_COURSE;
module.exports = Visit;
