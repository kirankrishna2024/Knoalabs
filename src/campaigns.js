// Campaigns and generated links. A campaign belongs to a FORM (one form -> many campaigns) and carries the tags its ads use
// (utm_medium / utm_campaign; the source is auto-detected from the ad click id / referrer when the link is opened).
// At most one campaign per form is "active"; the form's plain link (/student-intake) forwards to the tag of that active campaign,
// so the ad can keep one stable link while the campaign behind it changes. The rule is enforced in a transaction AND by a partial unique index.
const db = require('./db');
const config = require('./config');
const { parseUserAgent } = require('./ua');

const STATUSES = ['draft', 'active', 'paused', 'ended'];
const PLATFORMS = {
  meta: { label: 'Meta (Facebook & Instagram)', source: 'meta', medium: 'paid' },
  google: { label: 'Google Ads', source: 'google', medium: 'cpc' },
  youtube: { label: 'YouTube', source: 'youtube', medium: 'paid' },
  linkedin: { label: 'LinkedIn', source: 'linkedin', medium: 'paid' },
  x: { label: 'X (Twitter)', source: 'x', medium: 'paid' },
  reddit: { label: 'Reddit', source: 'reddit', medium: 'paid' },
  telegram: { label: 'Telegram', source: 'telegram', medium: 'social' },
  whatsapp: { label: 'WhatsApp', source: 'whatsapp', medium: 'whatsapp' },
  email: { label: 'Email', source: 'email', medium: 'email' },
  influencer: { label: 'Influencer', source: 'influencer', medium: 'influencer' },
  qr: { label: 'QR code (print)', source: 'qr', medium: 'qr' },
  other: { label: 'Other', source: '', medium: 'referral' }
};
const MEDIUMS = ['paid', 'cpc', 'social', 'email', 'whatsapp', 'influencer', 'referral', 'organic', 'qr'];
/* Campaign names: start with a letter, 3-40 chars. Allows letters, numbers, spaces, hyphens, slashes and special chars. */
const NAME_RE = /^[A-Za-z].{2,39}$/;

/** "DS Oct Reels!" -> "ds-oct-reels" (the way the tag is written in the link). */
const slugify = (t, max = 60) => String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function origin(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

/** The tagged link. `path` is the master class path ('' = plain link). Only the tags that are set are added. */
function buildLink({ origin: base, path = '', source, medium, campaign, extra = {} }) {
  const u = new URL(String(base).replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, ''));
  if (source) u.searchParams.set('utm_source', source);
  if (medium) u.searchParams.set('utm_medium', medium);
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  for (const [k, v] of Object.entries(extra)) if (/^[a-z_]{2,30}$/.test(k) && v) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Validate and clean a campaign from the admin form. Returns { error } or { value }. */
function clean(input, { partial = false, tag = null } = {}) {
  const b = input || {}, v = {}, bad = (error) => ({ error });
  if (!partial || b.name !== undefined) {
    v.name = text(b.name, 40);
    if (!NAME_RE.test(v.name)) return bad('Campaign name must be 3 to 40 characters, start with a letter, and can contain letters, numbers, spaces, hyphens, slashes and special characters.');
  }
  if (!partial || b.form_id !== undefined) {
    const id = Number(b.form_id);
    if (!Number.isInteger(id) || id < 1) return bad('Pick the form this campaign belongs to.');
    v.form_id = id;
  }
  if (!partial || b.utm_medium !== undefined || b.medium !== undefined) {
    v.medium = slugify(b.utm_medium || b.medium || 'paid', 40);
    if (!MEDIUMS.includes(v.medium)) return bad('Pick a medium from the list.');
    v.utm_medium = v.medium;
  }
  if (!partial || b.utm_campaign !== undefined || b.name !== undefined) {
    v.utm_campaign = slugify(tag || b.utm_campaign || v.name || b.name, 60);
    if (!v.utm_campaign || v.utm_campaign.length < 2) return bad('The campaign tag needs at least 2 letters or digits.');
  }
  for (const k of ['starts_on', 'ends_on']) if (!partial || b[k] !== undefined) {
    if (b[k] == null || b[k] === '') v[k] = null; else if (isYmd(b[k])) v[k] = b[k]; else return bad(`${k === 'starts_on' ? 'Start' : 'End'} date is not valid (use YYYY-MM-DD).`);
  }
  if (v.starts_on && v.ends_on && v.starts_on > v.ends_on) return bad('The end date is before the start date.');
  if (!partial || b.notes !== undefined) v.notes = text(b.notes, 500) || null;
  return { value: v };
}

const view = (r) => ({ id: Number(r.id), course_slug: r.course_slug, name: r.name, code: r.code, platform: r.platform, medium: r.medium, utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
  status: r.status, starts_on: r.starts_on ? String(r.starts_on instanceof Date ? r.starts_on.toISOString().slice(0, 10) : r.starts_on).slice(0, 10) : null,
  ends_on: r.ends_on ? String(r.ends_on instanceof Date ? r.ends_on.toISOString().slice(0, 10) : r.ends_on).slice(0, 10) : null, notes: r.notes, created_at: r.created_at, updated_at: r.updated_at,
  form_id: r.form_id == null ? null : Number(r.form_id), form_name: r.form_name || null, form_path: r.form_path || null });

let cache = { at: 0, active: new Map(), activeBySlug: new Map(), byTag: new Map() };
const invalidate = () => { cache = { at: 0, active: new Map(), activeBySlug: new Map(), byTag: new Map() }; };
async function load() {
  if (Date.now() - cache.at < 3000) return cache;
  const { rows } = await db.query('SELECT id, form_id, course_slug, utm_medium, utm_campaign, status FROM campaigns');
  const active = new Map(), activeBySlug = new Map(), byTag = new Map();
  for (const r of rows) {
    if (r.status === 'active' && r.form_id != null) { active.set(Number(r.form_id), r); activeBySlug.set(r.course_slug, r); }
    const k = r.course_slug + '|' + String(r.utm_campaign || '').toLowerCase();
    if (!byTag.has(k) || r.status === 'active') byTag.set(k, r);
  }
  cache = { at: Date.now(), active, activeBySlug, byTag };
  return cache;
}
/** The active campaign of a form, or null (cached for a few seconds). */
async function activeFor(formId) { try { return (await load()).active.get(Number(formId)) || null; } catch { return null; } }
async function formById(id) {
  const { rows } = await db.query('SELECT id, course_slug, path, name, status FROM forms WHERE id=$1', [id]);
  return rows[0] || null;
}
/** The campaign a registration / visit belongs to, found from the tag in its link: id or null. */
async function idByTag(courseSlug, utmCampaign) {
  if (!courseSlug || !utmCampaign) return null;
  try { const r = (await load()).byTag.get(courseSlug + '|' + String(utmCampaign).trim().toLowerCase()); return r ? Number(r.id) : null; } catch { return null; }
}

/**
 * Campaigns only exist when they were added in the Campaigns tab, and only an ACTIVE one counts.
 * A link, visit or registration that carries any other utm_campaign (a typo, an old or paused campaign, a name nobody added) is attributed
 * to the form's active campaign instead, or to no campaign when the form has none, so a made-up name never appears in the analytics.
 * @returns {{tag:string|null, changed:boolean, listed:boolean, active:object|null}}  tag = the campaign tag to store
 */
async function canonical(courseSlug, utmCampaign) {
  const given = String(utmCampaign == null ? '' : utmCampaign).trim();
  if (!config.campaignEnforce || !courseSlug || !given) return { tag: given || null, changed: false, listed: true, active: null };
  try {
    const c = await load();
    const hit = c.byTag.get(courseSlug + '|' + given.toLowerCase());
    if (hit && hit.status === 'active') return { tag: hit.utm_campaign, changed: hit.utm_campaign !== given, listed: true, active: hit };
    const act = c.activeBySlug.get(courseSlug) || null;
    return { tag: act ? act.utm_campaign : null, changed: true, listed: false, active: act };
  } catch { return { tag: given, changed: false, listed: true, active: null }; }          // the database cannot be read: keep what the link says, never lose a lead
}

async function uniqueCode(name, client) {
  const base = slugify(name, 40) || 'campaign';
  for (let i = 0; i < 50; i++) {
    const code = i ? `${base}-${i + 1}` : base;
    const { rows } = await (client || db).query('SELECT 1 FROM campaigns WHERE code=$1', [code]);
    if (!rows.length) return code;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function list({ form_id, course_slug } = {}) {
  const { rows } = await db.query(
    `SELECT c.*, f.name AS form_name, f.path AS form_path FROM campaigns c LEFT JOIN forms f ON f.id = c.form_id
     ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, c.id DESC`);
  return rows.filter((r) => (form_id == null || Number(r.form_id) === Number(form_id)) && (!course_slug || r.course_slug === course_slug)).map(view);
}
async function get(id) {
  const { rows } = await db.query('SELECT c.*, f.name AS form_name, f.path AS form_path FROM campaigns c LEFT JOIN forms f ON f.id = c.form_id WHERE c.id=$1', [id]);
  return rows[0] ? view(rows[0]) : null;
}

async function create(input) {
  const c = clean(input);
  if (c.error) return c;
  const v = c.value;
  const form = await formById(v.form_id);
  if (!form) return { error: 'Pick the form this campaign belongs to.', status: 422 };
  // looked up by tag and filtered here (pg-mem, used in tests, answers wrongly when a partial index covers the same column; PostgreSQL would not care)
  const dupe = (await db.query('SELECT id, name, form_id FROM campaigns WHERE utm_campaign=$1', [v.utm_campaign])).rows.filter((r) => Number(r.form_id) === Number(v.form_id));
  if (dupe.length) return { error: `This form already has a campaign with the tag "${v.utm_campaign}" ("${dupe[0].name}"). Pick another name.`, duplicate: true };
  const code = await uniqueCode(v.name);
  const { rows } = await db.query(
    `INSERT INTO campaigns (course_slug, form_id, name, code, medium, utm_source, utm_medium, utm_campaign, status, starts_on, ends_on, notes)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'draft',$8,$9,$10) RETURNING *`,
    [form.course_slug, form.id, v.name, code, v.medium, v.utm_medium, v.utm_campaign, v.starts_on || null, v.ends_on || null, v.notes || null]);
  invalidate();
  return { campaign: view({ ...rows[0], form_name: form.name, form_path: form.path }) };
}

async function update(id, input) {
  const cur = await get(id);
  if (!cur) return { error: 'Campaign not found.', status: 404 };
  const c = clean({ ...cur, ...input }, { partial: false, tag: cur.utm_campaign });
  if (c.error) return c;
  const v = c.value;
  const form = await formById(v.form_id);
  if (!form) return { error: 'Pick the form this campaign belongs to.', status: 422 };
  const rows = (await db.query('SELECT id, form_id FROM campaigns WHERE utm_campaign=$1', [v.utm_campaign])).rows.filter((r) => Number(r.form_id) === Number(v.form_id) && Number(r.id) !== Number(id));
  if (rows.length) return { error: `Another campaign of this form already uses the tag "${v.utm_campaign}".`, duplicate: true };
  if (cur.status === 'active' && Number(v.form_id) !== Number(cur.form_id)) {
    const act = await db.query("SELECT id FROM campaigns WHERE form_id=$1 AND status='active' AND id<>$2", [v.form_id, id]);
    if (act.rows.length) return { error: 'That form already has an active campaign.', conflict: true };
  }
  try {
    const out = await db.query(
      `UPDATE campaigns SET form_id=$2, course_slug=$3, name=$4, medium=$5, utm_medium=$6, utm_campaign=$7, starts_on=$8, ends_on=$9, notes=$10, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, v.form_id, form.course_slug, v.name, v.medium, v.utm_medium, v.utm_campaign, v.starts_on || null, v.ends_on || null, v.notes || null]);
    invalidate();
    return { campaign: view({ ...out.rows[0], form_name: form.name, form_path: form.path }) };
  } catch (e) {
    if (e && e.code === '23505') return { error: 'That form already has an active campaign.', status: 409 };
    throw e;
  }
}

/**
 * Change a campaign's status. Activating while another campaign of the same master class is active is refused (409 with the
 * name of the active one) unless replace=true, which pauses the other one in the same transaction.
 */
async function setStatus(id, status, { replace = false } = {}) {
  if (!STATUSES.includes(status)) return { error: 'Unknown status.', status: 422 };
  const cur = await get(id);
  if (!cur) return { error: 'Campaign not found.', status: 404 };
  if (cur.status === status) return { campaign: cur };
  try {
    const out = await db.tx(async (c) => {
      let paused = null;
      if (status === 'active') {
        const { rows: act } = await c.query("SELECT id, name FROM campaigns WHERE form_id=$1 AND status='active' AND id<>$2", [cur.form_id, id]);
        if (act.length) {
          if (!replace) return { error: `"${act[0].name}" is already active for this form. Pause it first, or choose to replace it.`, status: 409, active: { id: Number(act[0].id), name: act[0].name } };
          await c.query("UPDATE campaigns SET status='paused', updated_at=now() WHERE id=$1", [act[0].id]); paused = { id: Number(act[0].id), name: act[0].name };
        }
      }
      const { rows } = await c.query('UPDATE campaigns SET status=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, status]);
      return { campaign: view(rows[0]), paused };
    });
    invalidate();
    return out;
  } catch (e) {
    if (e && e.code === '23505') return { error: 'Another campaign of this form is already active.', status: 409 };
    throw e;
  }
}

async function remove(id) {
  const cur = await get(id);
  if (!cur) return { error: 'Campaign not found.', status: 404 };
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM leads WHERE campaign_id=$1', [id]);
  if (rows[0].n > 0 || cur.status === 'active') return { error: rows[0].n > 0 ? 'This campaign has registrations, so it cannot be deleted. End it instead.' : 'Pause or end the campaign before deleting it.', status: 409 };
  await db.query('DELETE FROM campaign_links WHERE campaign_id=$1', [id]);
  await db.query('DELETE FROM campaigns WHERE id=$1', [id]);
  invalidate();
  return { ok: true };
}

/** Registrations and (counted) link opens per campaign. */
async function stats() {
  const [leads, opens] = await Promise.all([
    db.query('SELECT campaign_id, COUNT(*)::int AS n, MAX(created_at) AS last FROM leads WHERE campaign_id IS NOT NULL GROUP BY campaign_id'),
    db.query('SELECT course_slug, utm_campaign, COUNT(*)::int AS n FROM page_visits WHERE utm_campaign IS NOT NULL GROUP BY course_slug, utm_campaign')
  ]);
  return { leads: new Map(leads.rows.map((r) => [Number(r.campaign_id), { n: r.n, last: r.last }])), opens: new Map(opens.rows.map((r) => [r.course_slug + '|' + r.utm_campaign, r.n])) };
}

/** Generated links of a form (saved so they can be found again). */
async function listLinks(formId) {
  const { rows } = await db.query('SELECT id, campaign_id, label, url, platform, medium, created_at FROM campaign_links WHERE form_id=$1 ORDER BY id DESC LIMIT 200', [formId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), campaign_id: r.campaign_id == null ? null : Number(r.campaign_id) }));
}
async function saveLink({ form, req, platform, medium, campaign_id, campaign_name, label, extra }) {
  const plat = PLATFORMS[platform];
  if (!plat) return { error: 'Pick where the ad runs.' };
  // a link can only carry a campaign that was added in the Campaigns tab and is running: new campaigns are never made from here
  if (campaign_id == null || campaign_id === '') return { error: 'Pick a running campaign. New campaigns are added in the Campaigns tab, not here.' };
  const camp = await get(campaign_id);
  if (!camp || (camp.form_id != null && Number(camp.form_id) !== Number(form.id))) return { error: 'That campaign belongs to another form.' };
  if (config.campaignEnforce && camp.status !== 'active') return { error: `\u201c${camp.name}\u201d is ${camp.status}, not running. Start it in the Campaigns tab first, or pick a running campaign.` };
  const tag = camp.utm_campaign;
  const platformMedium = ['qr', 'whatsapp', 'email', 'influencer'].includes(platform);       // for these the medium IS the channel (a QR code is a qr, whatever the campaign's usual medium)
  const med = slugify(medium || (platformMedium ? plat.medium : '') || camp.utm_medium || plat.medium, 40);
  if (!med) return { error: 'Pick a medium.' };
  // campaigns no longer store a source: the platform picked here supplies the tag, and opening the link auto-detects the rest
  const source = slugify((camp && camp.utm_source) || plat.source, 40);
  if (!source) return { error: 'Pick where the ad runs.' };
  const url = buildLink({ origin: origin(req), path: form.path, source, medium: med, campaign: tag, extra: extra || {} });
  const name = text(label, 80) || `${PLATFORMS[platform].label} · ${tag}`;
  void campaign_name;
  const { rows } = await db.query('INSERT INTO campaign_links (campaign_id, form_id, course_slug, label, url, platform, medium) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at', [camp.id, form.id, form.course_slug, name, url, platform, med]);
  return { link: { id: Number(rows[0].id), url, label: name, platform, medium: med, campaign_id: camp.id, created_at: rows[0].created_at } };
}
async function removeLink(formId, id) { const r = await db.query('DELETE FROM campaign_links WHERE id=$1 AND form_id=$2 RETURNING id', [id, formId]); return r.rows.length > 0; }

/**
 * Plain form link redirect. A request for /student-intake (or /datascience) that carries NO tags (no utm_*, no ?nocampaign)
 * and comes from a real browser is sent (302) to the same link with the tags of the form's active campaign.
 * No source is written: the page detects Google / Meta (Facebook or Instagram) / Microsoft / LinkedIn / TikTok from the
 * click id, referrer and in-app browser. Other parameters (fbclid, site_source_name ...) are kept.
 * Returns the URL path+query to redirect to, or null.
 */
async function redirectFor({ form, query, userAgent }) {
  if (!config.campaignRedirect || !form || form.status !== 'active') return null;
  if (parseUserAgent(userAgent).bot) return null;                    // crawlers and link-preview bots are never redirected
  const q = query || {}, keys = Object.keys(q);
  if (keys.includes('nocampaign')) return null;
  const given = typeof q.utm_campaign === 'string' ? q.utm_campaign.trim() : '';
  const a = await activeFor(form.id);
  if (given) {
    // a tag that is not a running campaign of this form (typo, old / paused / never added) goes to the running campaign, or loses the tag when there is none
    if (!config.campaignEnforce) return null;
    const c = await canonical(form.course_slug, given);
    if (c.listed && !c.changed) return null;                         // a running campaign: nothing to do
  } else if (!a) return null;                                        // no tag and nothing running: leave the link alone
  else if (keys.some((k) => /^utm_/i.test(k)) && !config.campaignEnforce) return null;
  const u = new URL('http://x/' + String(form.path || '').replace(/^\/+/, ''));
  for (const [k, val] of Object.entries(q)) if (typeof val === 'string' && /^[\w.-]{1,40}$/.test(k) && k !== 'utm_campaign') u.searchParams.set(k, val);
  if (a) {
    if (!u.searchParams.has('utm_medium') && a.utm_medium) u.searchParams.set('utm_medium', a.utm_medium);     // a medium the link already has (qr, whatsapp ...) is kept
    if (a.utm_campaign) u.searchParams.set('utm_campaign', a.utm_campaign);
  }
  const to = u.pathname + u.search;
  const here = String(form.path || '').replace(/^\/+/, '');
  const same = (() => { const o = new URL('http://x/' + here); for (const [k, val] of Object.entries(q)) if (typeof val === 'string') o.searchParams.set(k, val); return o.pathname + o.search === to; })();
  return same ? null : to;
}

module.exports = { STATUSES, PLATFORMS, MEDIUMS, slugify, buildLink, clean, list, get, create, update, setStatus, remove, stats, listLinks, saveLink, removeLink, activeFor, idByTag, canonical, redirectFor, invalidate, origin };
