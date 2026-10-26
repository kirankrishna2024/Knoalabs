// Seed realistic traffic so the analytics "detected sources" panels have something to show.
process.env.LOG_LEVEL = 'silent';
const db = require('../src/db');
const Lead = require('../src/models/Lead');
const Visit = require('../src/models/Visit');
const forms = require('../src/forms');
const { seedAdmin } = require('../server');

const DAY = 86400000;
const now = new Date();
const ago = (ms) => new Date(now.getTime() - ms);

const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.0.0';
const FB_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/FBAV;FBAV/440.0.0.0.0]';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';

// [count, lead fields, visit fields]
const MIX = [
  // tagged Meta ad -> utm method
  [18, {
    utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'ds-oct-reels',
    source_detected: 'Meta', source_method: 'utm', meta_platform: 'Instagram', meta_placement: 'reels',
    user_agent: IG_UA, in_app: 'Instagram', browser: 'Instagram', device_type: 'mobile', os: 'iOS', referrer: 'https://www.instagram.com/'
  }, { utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'ds-oct-reels', referrer_host: 'www.instagram.com', meta_platform: 'Instagram', meta_placement: 'reels', source_detected: 'Meta', source_method: 'utm' }],
  // untagged link clicked inside Facebook -> in_app detection
  [9, {
    user_agent: FB_UA, in_app: 'Facebook', browser: 'Facebook', device_type: 'mobile', os: 'Android',
    referrer: '', source_detected: 'Meta', source_method: 'in_app', meta_platform: 'Facebook'
  }, { referrer_host: null, source_detected: 'Meta', source_method: 'in_app' }],
  // WhatsApp share -> utm medium, no source tag
  [7, {
    utm_medium: 'whatsapp', source_detected: 'WhatsApp', source_method: 'utm',
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'mobile', os: 'Android', referrer: ''
  }, { utm_medium: 'whatsapp', source_detected: 'WhatsApp', source_method: 'utm' }],
  // referral from ChatGPT
  [6, {
    referrer: 'https://chatgpt.com/c/abc-123', source_detected: 'ChatGPT / AI', source_method: 'referrer',
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'desktop', os: 'Windows'
  }, { referrer_host: 'chatgpt.com', source_detected: 'ChatGPT / AI', source_method: 'referrer' }],
  // Google ad click id
  [5, {
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search',
    source_detected: 'Google', source_method: 'utm', user_agent: CHROME_UA, browser: 'Chrome', device_type: 'desktop', os: 'Windows',
    referrer: 'https://www.google.com/'
  }, { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ds-search', referrer_host: 'www.google.com', source_detected: 'Google', source_method: 'utm' }],
  // fbclid only (no utm) -> click_id method
  [4, {
    source_detected: 'Meta', source_method: 'click_id', meta_platform: 'Facebook',
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'desktop', os: 'macOS', referrer: 'https://www.facebook.com/'
  }, { source_detected: 'Meta', source_method: 'click_id', meta_platform: 'Facebook', referrer_host: 'www.facebook.com' }],
  // QR scan (utm_medium=qr)
  [4, {
    utm_medium: 'qr', source_detected: 'QR scan', source_method: 'utm',
    user_agent: SAFARI_UA, browser: 'Safari', device_type: 'mobile', os: 'iOS', referrer: ''
  }, { utm_medium: 'qr', source_detected: 'QR scan', source_method: 'utm' }],
  // referral from a blog (unknown host -> "Other" keeps its host)
  [5, {
    referrer: 'https://blog.knowjava.com/data-science-course', source_detected: 'Other', source_method: 'referrer',
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'desktop', os: 'Windows'
  }, { referrer_host: 'blog.knowjava.com', source_detected: 'Other', source_method: 'referrer' }],
  // referral through t.co redirect
  [3, {
    referrer: 'https://t.co/xyz', source_detected: 'X / Twitter', source_method: 'referrer',
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'mobile', os: 'Android'
  }, { referrer_host: 't.co', source_detected: 'X / Twitter', source_method: 'referrer' }],
  // nothing at all -> direct
  [12, {
    user_agent: CHROME_UA, browser: 'Chrome', device_type: 'desktop', os: 'Windows', referrer: ''
  }, { source_detected: null, source_method: null, referrer_host: null }]
];

// visitors who opened but never registered (so "opened vs registered" has something to show)
const VISITOR_MIX = [
  { n: 40, browser: 'Chrome', in_app: null, device_type: 'mobile', os: 'Android' },
  { n: 25, browser: 'Safari', in_app: null, device_type: 'mobile', os: 'iOS' },
  { n: 30, browser: 'Chrome', in_app: null, device_type: 'desktop', os: 'Windows' },
  { n: 18, browser: 'Instagram', in_app: 'Instagram', device_type: 'mobile', os: 'iOS' },
  { n: 12, browser: 'Facebook', in_app: 'Facebook', device_type: 'mobile', os: 'Android' },
  { n: 8, browser: 'WhatsApp', in_app: 'WhatsApp', device_type: 'mobile', os: 'Android' },
  { n: 6, browser: 'Edge', in_app: null, device_type: 'desktop', os: 'Windows' }
];

const COURSES = ['datascience', 'cybersecurity', 'webdevelopment', null];

(async () => {
  db.init();
  await db.ping();
  await seedAdmin();
  await forms.seedDefaultForms().catch(() => {});

  let ph = 0;
  for (const [count, lead, visit] of MIX) {
    for (let i = 0; i < count; i++) {
      const course = COURSES[(i + ph) % COURSES.length];
      const at = ago(Math.floor(Math.random() * 13) * DAY + Math.floor(Math.random() * DAY));
      const l = await Lead.create({
        first_name: 'Seed', last_name: 'Person' + (ph++), full_name: 'Seed Person' + ph,
        phone: '+9198' + String(10000000 + ph * 7919).slice(0, 8),
        email: 'seed' + ph + '@example.com',
        status: i % 3 === 0 ? 'Working Professional' : 'Student / Fresher',
        student_course: 'BCA', student_status: 'Final year', college_name: 'St. Alberts College',
        course_slug: course, course: course ? course.toUpperCase() : null,
        page_url: 'https://knoalabs.example/' + (course || ''),
        ...lead
      });
      await db.query('UPDATE leads SET created_at=$1 WHERE id=$2', [at, l.id]);
      await Visit.record({ course_slug: course, ...visit }, ago(Math.floor(Math.random() * 13) * DAY));
    }
  }

  // extra opens that never converted (the visitor side of the panels)
  for (const v of VISITOR_MIX) {
    for (let i = 0; i < v.n; i++) {
      const vid = 'visitor-' + String(ph++).padStart(6, '0') + '-abcdefghijklmnop';
      const at = ago(Math.floor(Math.random() * 13) * DAY);
      await db.query(`INSERT INTO visitors (visitor_id, first_seen, last_seen, visit_count, device_type, os, browser, in_app, session_count)
                      VALUES ($1,$2,$2,1,$3,$4,$5,$6,1)
                      ON CONFLICT (visitor_id) DO NOTHING`, [vid, at, v.device_type, v.os, v.browser, v.in_app]);
      await db.query(`INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, course_slug) VALUES ($1,$2,$3,$3,$4)`,
        ['session-' + vid.slice(8), vid, at, COURSES[i % 4]]);
      await Visit.record({
        course_slug: COURSES[i % 4], referrer_host: v.in_app ? null : 'chatgpt.com',
        source_detected: v.in_app ? 'Meta' : 'ChatGPT / AI', source_method: v.in_app ? 'in_app' : 'referrer'
      }, at);
    }
  }

  const leads = (await db.query('SELECT COUNT(*)::int AS n FROM leads')).rows[0].n;
  const visits = (await db.query('SELECT COUNT(*)::int AS n FROM page_visits')).rows[0].n;
  const visitors = (await db.query('SELECT COUNT(*)::int AS n FROM visitors')).rows[0].n;
  console.log('seeded: leads=' + leads + ' page_visits=' + visits + ' visitors=' + visitors);
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
