// Reads a pasted registration / ad link and turns it into the analytics filters it belongs to.
//   https://host/datascience?utm_source=meta&utm_medium=paid&utm_campaign=ds-oct-reels
//     -> course "datascience", channel "Meta", medium "paid", campaign "ds-oct-reels"
// A tag that is missing from the link is simply not filtered (the link then covers all of them).
// Pure apart from reading the master class list in options.js. Unit-tested in test/qr.test.js.
const O = require('./options');
const { resolveCourse } = require('./validate');
const { niceChannel } = require('./analytics');
const Meta = require('./meta');

const NO_COURSE = '__none';
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/** The first path segment of a pasted link ('' for the plain link or text that is not a link). */
function pathOf(raw) {
  let text = clean(String(raw == null ? '' : raw), 2000);
  if (!text || text.startsWith('?')) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text.replace(/^\/+/, '');
  try {
    let seg = new URL(text).pathname.split('/').filter(Boolean)[0] || '';
    try { seg = decodeURIComponent(seg); } catch { /* keep it as typed */ }
    return seg.slice(0, 80).toLowerCase();
  } catch { return ''; }
}

/** @returns {{ok:true, ...}|{ok:false, error:string}} */
function parseLink(raw, ownHost = '') {
  let text = clean(String(raw == null ? '' : raw), 2000);
  if (!text) return { ok: false, error: 'Paste a link first.' };
  if (/\s/.test(text)) return { ok: false, error: 'That does not look like a link (it has spaces).' };
  const tagOnly = text.startsWith('?');                 // just the tag part: no master class to go by
  if (tagOnly) text = 'http://link.invalid/' + text;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text.replace(/^\/+/, '');
  let u;
  try { u = new URL(text); } catch { return { ok: false, error: 'That does not look like a valid link.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Only http / https links can be searched.' };

  const first = pathOf(raw);
  const r = first ? resolveCourse(first) : { slug: null, name: null };
  const known = r.slug && O.COURSES[r.slug] ? r.slug : null;
  const q = u.searchParams;
  const source = clean(q.get('utm_source') || '', 120);
  const medium = clean(q.get('utm_medium') || '', 120).toLowerCase();
  const campaign = clean(q.get('utm_campaign') || '', 120);
  // a link that already carries Meta's answer (…&site_source_name=ig, or utm_source=instagram) also narrows the Meta app
  const platform = source && niceChannel(source) === 'Meta' ? (Meta.platformFromWord(clean(q.get('site_source_name') || '', 20)) || Meta.platformFromWord(source) || Meta.platformFromPlacement(clean(q.get('placement') || '', 60))) : null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const own = String(ownHost || '').replace(/:\d+$/, '').replace(/^www\./, '').toLowerCase();

  return {
    ok: true,
    sameHost: u.hostname !== 'link.invalid' ? (!own || host === own) : true,
    unknownCourse: Boolean(first && !known),            // /something that is not a master class on this site
    course: known ? { slug: known, name: O.COURSES[known], path: O.COURSE_PATHS[known] || known } : null,
    plain: !first && !tagOnly,                                  // the general link without a master class
    source: source || null,
    channel: source ? niceChannel(source) : null,
    medium: medium || null,
    campaign: campaign || null,
    platform: platform || null,
    filters: {
      course: known || (!first && !tagOnly ? NO_COURSE : ''),
      channel: source ? niceChannel(source) : '',
      medium,
      campaign,
      ...(platform ? { platform } : {})                    // only when the link already names the Meta app
    }
  };
}

module.exports = { parseLink, pathOf, NO_COURSE };
