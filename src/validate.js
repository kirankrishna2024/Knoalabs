const { COUNTRIES } = require('./countries');
const O = require('./options');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nul = (v, max) => str(v, max) || null;

/** Normalise a typed number to national digits for the chosen country. */
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

/** Resolve the course from the registration link. Returns { slug, name } or nulls. */
function resolveCourse(raw) {
  const clean = str(raw, 80).toLowerCase().replace(/[^a-z0-9-]/g, '');
  let key = clean.replace(/-/g, '');
  if (!key || O.RESERVED.includes(key)) return { slug: null, name: null };
  key = O.ALIASES[key] || key;
  if (O.COURSES[key]) return { slug: key, name: O.COURSES[key] };
  const name = clean.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { slug: clean, name };
}

/**
 * Validate + sanitise a lead from the browser.
 * Returns { errors: {field: msg}, lead } — lead is only meaningful when errors is empty.
 */
function validateLead(body = {}) {
  const errors = {};
  const first_name = str(body.first_name, 60);
  const last_name = str(body.last_name, 60);
  const email = str(body.email, 120);
  const status = str(body.status, 60);
  const isStudent = status === 'Student / Fresher';
  const isPro = status === 'Working Professional';

  if (!first_name) errors.first_name = 'Enter your first name';
  if (!last_name) errors.last_name = 'Enter your last name';

  const country = COUNTRIES.find((c) => c.c === body.country) || COUNTRIES[0];
  const digits = normalizePhone(country, body.phone);
  if (!digits) errors.phone = 'Enter your mobile number';
  else if (!new RegExp(country.re).test(digits)) errors.phone = `Enter a valid number: ${country.hint}`;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address';

  if (!O.STATUSES.includes(status)) errors.status = 'Select one option';

  const studentCourse = str(body.student_course, 60);
  const studentStatus = str(body.student_status, 60);
  const experience = str(body.experience, 60);
  const role = str(body.current_role, 120);
  const specialization = str(body.specialization, 80);
  const qualification = str(body.highest_qualification, 80);
  if (isStudent) {
    if (!O.STUDENT_COURSES.includes(studentCourse)) errors.student_course = 'Select the course you are pursuing / completed';
    if (!O.STUDENT_STATUSES.includes(studentStatus)) errors.student_status = 'Select your current status';
    if (specialization && !O.SPECIALIZATIONS.includes(specialization)) errors.specialization = 'Select a specialization from the list';
  }
  if (isPro) {
    if (!O.EXPERIENCE.includes(experience)) errors.experience = 'Select your total work experience';
    if (!O.ROLES.includes(role)) errors.current_role = 'Select your current role / domain';
    if (qualification && !O.QUALIFICATIONS.includes(qualification)) errors.highest_qualification = 'Select a qualification from the list';
  }

  // Course comes from the registration link (/cybersecurity, ?course=ai-ml ...)
  const { slug: course_slug, name: course } = resolveCourse(body.course);
  const client_id = /^[A-Za-z0-9_-]{16,64}$/.test(body.client_id || '') ? body.client_id : null;

  const lead = {
    first_name,
    last_name,
    full_name: `${first_name} ${last_name}`.trim(),
    country_code: country.other ? null : country.d,
    phone: country.other ? `+${digits}` : `${country.d}${digits}`,
    email: email || null,
    status,
    student_course: isStudent ? studentCourse : null,
    student_status: isStudent ? studentStatus : null,
    college_name: isStudent ? nul(body.college_name, 120) : null,
    specialization: isStudent ? specialization || null : null,
    experience_level: isPro ? experience : null,
    job_role: isPro ? role : null,
    current_company: isPro ? nul(body.current_company, 120) : null,
    highest_qualification: isPro ? qualification || null : null,
    course,
    course_slug,
    page_url: nul(body.page_url, 500),
    page_title: nul(body.page_title, 200),
    referrer: nul(body.referrer, 500),
    utm_source: nul(body.utm_source, 120),
    utm_medium: nul(body.utm_medium, 120),
    utm_campaign: nul(body.utm_campaign, 120),
    client_id
  };
  return { errors, lead };
}

/**
 * Exact location the browser shared (Geolocation API): { browser_lat, browser_lon, browser_accuracy, browser_geo_at }.
 * Only finite coordinates inside the real ranges are accepted; anything else is ignored (never an error for the form).
 */
function browserLocation(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const lat = Number(raw.lat), lon = Number(raw.lon), acc = Number(raw.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return {};
  const round = (v, p) => Math.round(v * p) / p;
  return {
    browser_lat: round(lat, 1e6), browser_lon: round(lon, 1e6),
    browser_accuracy: Number.isFinite(acc) && acc >= 0 && acc < 1e7 ? round(acc, 100) : null,
    browser_geo_at: new Date()
  };
}

/** The parts of a lead that do not depend on the form: course from the link, page link, UTM tags, idempotency id. */
function metaFields(body = {}) {
  const { slug: course_slug, name: course } = resolveCourse(body.course);
  return {
    course, course_slug,
    page_url: nul(body.page_url, 500), page_title: nul(body.page_title, 200), referrer: nul(body.referrer, 500),
    utm_source: nul(body.utm_source, 120), utm_medium: nul(body.utm_medium, 120), utm_campaign: nul(body.utm_campaign, 120),
    client_id: /^[A-Za-z0-9_-]{16,64}$/.test(body.client_id || '') ? body.client_id : null
  };
}

module.exports = { validateLead, resolveCourse, metaFields, browserLocation };
