// Time-zone helpers (no dependencies). "Today", date filters and Excel times all use config.timezone,
// so an admin in India sees India days no matter where the server runs.

// Intl.DateTimeFormat objects are slow to build; reuse one per (kind, zone).
const fmtCache = new Map();
function fmt(kind, tz, opts) {
  const k = kind + '|' + tz;
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(kind === 'wall' || kind === 'hour' ? 'en-US' : 'en-CA', { timeZone: tz, ...opts }); fmtCache.set(k, f); }
  return f;
}

/** Offset of `tz` from UTC, in ms, at the instant `date` (local wall clock minus UTC). */
function tzOffsetMs(tz, date) {
  const p = Object.fromEntries(fmt('wall', tz, {
    hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant at which the calendar day y-m-d starts in `tz`. */
function zonedMidnight(tz, y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t));              // second pass settles daylight-saving edges
  return new Date(t);
}

/** { y, m, d } of `date` as seen in `tz`. */
function dayParts(tz, date) {
  const p = Object.fromEntries(fmt('day', tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** Start of the day that is `offsetDays` away from the day `date` falls on (in `tz`). */
function startOfDay(tz, date = new Date(), offsetDays = 0) {
  const { y, m, d } = dayParts(tz, date);
  const n = new Date(Date.UTC(y, m - 1, d + offsetDays));      // calendar arithmetic only
  return zonedMidnight(tz, n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate());
}

/** "2026-10-14" -> { y, m, d } or null when it is not a real date. */
function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}

const pad = (n) => String(n).padStart(2, '0');
/** "YYYY-MM-DD" of `date` in `tz`. */
function ymd(tz, date) { const p = dayParts(tz, date); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }

/** Hour of the day (0-23) of `date` as seen in `tz`. */
function hourOf(tz, date) { return Number(fmt('hour', tz, { hour: '2-digit', hourCycle: 'h23' }).format(date)) % 24; }

/** A Date whose UTC fields equal the wall-clock time in `tz` (Excel has no time zones, so it shows that wall time). */
function wallClock(tz, date) { return new Date(date.getTime() + tzOffsetMs(tz, date)); }

module.exports = { hourOf, zonedMidnight, dayParts, startOfDay, parseYMD, ymd, wallClock };
