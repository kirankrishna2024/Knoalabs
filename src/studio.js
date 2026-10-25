// Form Studio + campaigns + generated links: the admin API (all routes need an admin session).
//   forms     GET /forms, GET /forms/:id, PATCH /forms/:id, PUT|DELETE /forms/:id/draft, POST /forms/:id/publish|restore|rollback,
//             GET /forms/:id/versions[/:v], GET /forms/:id/diff, GET|POST /forms/:id/links, DELETE /forms/:id/links/:linkId
//   campaigns GET|POST /campaigns, PATCH|DELETE /campaigns/:id, POST /campaigns/:id/status
//   misc      GET /audit, GET /leads/:id/related
// Every change is written to admin_audit_log. Published versions are immutable; the editor works on ONE autosaved draft per form.
const express = require('express');
const db = require('./db');
const log = require('./logger');
const F = require('./formdef');
const O = require('./options');
const campaigns = require('./campaigns');
const person = require('./person');
const forms = require('./forms');

const ID = /^\d{1,18}$/;
const asObj = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const DEFAULT_COLUMNS = Object.fromEntries(F.defaultDefinition().fields.filter((f) => f.column).map((f) => [f.key, f.column]));

function mountStudio(router, { needApi, needPage, jsonOnly, sendPage, studioCsp, previewCsp, origin }) {
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const json = express.json({ limit: '300kb' });
  const fail = (res, status, error, extra) => res.status(status).json({ ok: false, error, ...(extra || {}) });
  const audit = (req, action, entity, entityId, detail) =>
    db.query('INSERT INTO admin_audit_log (admin, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [req.admin && req.admin.username, action, entity, String(entityId), detail ? JSON.stringify(detail) : null]).catch((e) => log.warn({ err: e.message }, 'audit log not written'));
  /* A database rule (check / unique / not null / foreign key) that refuses a write is a problem with the request or with an outdated schema,
     not a crash: answer with a clear 4xx instead of a blind 500, and log the code + constraint so the cause is visible. */
  const dbProblem = (e) => {
    const c = String(e && e.code || '');
    if (c === '23505') return [409, 'That already exists. Use a different name or link.'];
    if ((c === '23514' || /(violates|is violated).*check constraint|check constraint.*(violated|violates)/i.test(String(e.message))) && /forms_status_check/.test(String(e.constraint || '') + ' ' + String(e.message))) return [409, 'The database does not accept this form status yet. Restart the app so the latest migration runs, then try again.'];
    if (c === '23514' || c === '23502' || c === '22001' || c === '22P02') return [422, 'Some of the values are not allowed. Check the fields and try again.'];
    if (c === '23503') return [409, 'This item is still used by something else.'];
    return null;
  };
  const wrap = (fn) => async (req, res) => {
    noStore(res);
    try { await fn(req, res); }
    catch (e) {
      const known = dbProblem(e);
      log.error({ err: e.message, code: e.code, constraint: e.constraint, path: req.path }, known ? 'studio request refused by the database' : 'studio request failed');
      if (!res.headersSent) { if (known) fail(res, known[0], known[1]); else fail(res, 500, 'Something went wrong. Please try again.'); }
    }
  };

  async function loadForm(id) {
    if (!ID.test(String(id))) return null;
    const { rows } = await db.query('SELECT * FROM forms WHERE id=$1', [id]);
    return rows[0] || null;
  }
  async function versionDef(formId, version) {
    const { rows } = await db.query('SELECT version, definition, author, note, created_at, published_at FROM form_versions WHERE form_id=$1 AND version=$2', [formId, version]);
    return rows[0] ? { ...rows[0], definition: asObj(rows[0].definition) } : null;
  }
  async function draftOf(formId) {
    const { rows } = await db.query('SELECT definition, base_version, author, updated_at FROM form_drafts WHERE form_id=$1', [formId]);
    return rows[0] ? { ...rows[0], definition: asObj(rows[0].definition) } : null;
  }
  const columnsFor = (prevDef) => ({ ...DEFAULT_COLUMNS, ...Object.fromEntries(((prevDef && prevDef.fields) || []).filter((f) => f.column).map((f) => [f.key, f.column])) });
  const formView = (f, leads, hasDraft) => ({ id: Number(f.id), course_slug: f.course_slug, name: f.name, path: f.path, status: f.status, current_version: f.current_version, published_version: f.published_version,
    has_draft: Boolean(hasDraft), updated_at: f.updated_at, leads: leads || 0 });

  /* ---------- pages ---------- */
  router.get('/forms', needPage, (_req, res) => sendPage(res, 'forms.html'));
  router.get('/forms/:id', needPage, (req, res, next) => (ID.test(req.params.id) ? sendPage(res, 'studio.html', studioCsp) : next()));
  router.get('/forms/:id/preview', needPage, (req, res, next) => (ID.test(req.params.id) ? sendPage(res, 'preview.html', previewCsp) : next()));
  router.get('/campaigns', needPage, (_req, res) => sendPage(res, 'campaigns.html'));

  /* ---------- forms ---------- */
  const campaignCounts = async () => {
    // counted here, not with GROUP BY (pg-mem, used by the tests, answers such a group wrongly; the list is small)
    const { rows } = await db.query('SELECT form_id, status FROM campaigns');
    const map = new Map();
    for (const r of rows) {
      if (r.form_id == null) continue;
      const o = map.get(Number(r.form_id)) || { n: 0, active: 0 };
      o.n++; if (r.status === 'active') o.active++;
      map.set(Number(r.form_id), o);
    }
    return map;
  };
  router.get('/api/forms', needApi, wrap(async (req, res) => {
    const [fs, counts, drafts, camps] = await Promise.all([
      db.query('SELECT * FROM forms ORDER BY id'),
      db.query('SELECT form_id, COUNT(*)::int AS n FROM leads WHERE form_id IS NOT NULL GROUP BY form_id'),
      db.query('SELECT form_id FROM form_drafts'),
      campaignCounts()
    ]);
    const cnt = new Map(counts.rows.map((r) => [Number(r.form_id), r.n])), dr = new Set(drafts.rows.map((r) => Number(r.form_id)));
    res.json({ ok: true, forms: fs.rows.map((f) => {
      const c = camps.get(Number(f.id)) || { n: 0, active: 0 };
      return { ...formView(f, cnt.get(Number(f.id)), dr.has(Number(f.id))), url: `${origin(req)}/${f.path}`, type_label: f.type_label, campaigns: c.n, active_campaigns: c.active, ad_running: c.active > 0 };
    }) });
  }));

  /* a new form on its own: name only, it starts as the standard registration form and goes live */
  router.post('/api/forms', needApi, jsonOnly, json, wrap(async (req, res) => {
    const b = req.body || {};
    const r = await forms.createForm(b.name, req.admin.username);
    if (r.error) return fail(res, r.duplicate ? 409 : 422, r.error);
    await audit(req, 'form.create', 'form', r.form.id, { name: r.form.name, path: r.form.path });
    req.log.info({ admin: req.admin.username, form: r.form.path }, 'form created');
    res.status(201).json({ ok: true, form: { ...formView(r.form, 0, false), url: `${origin(req)}/${r.form.path}`, type_label: r.form.type_label, campaigns: 0, active_campaigns: 0, ad_running: false } });
  }));

  router.get('/api/forms/:id', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const [draft, pub, leads] = await Promise.all([draftOf(f.id), f.published_version ? versionDef(f.id, f.published_version) : null, db.query('SELECT COUNT(*)::int AS n FROM leads WHERE form_id=$1', [f.id])]);
    const working = draft ? draft.definition : pub ? pub.definition : F.defaultDefinition();
    res.json({ ok: true, form: { ...formView(f, leads.rows[0].n, draft), url: `${origin(req)}/${f.path}`, type_label: f.type_label },
      draft: draft ? { base_version: draft.base_version, updated_at: draft.updated_at, author: draft.author } : null, published: pub ? { version: pub.version, definition: pub.definition } : null,
      working, problems: F.validateDefinition(working), limits: F.LIMITS, patterns: Object.keys(F.PATTERNS), types: F.TYPES });
  }));

  router.patch('/api/forms/:id', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const b = req.body || {}, sets = [], p = [f.id];
    if (b.status !== undefined) {
      if (!['active', 'paused', 'archived'].includes(b.status)) return fail(res, 422, 'Status must be active, paused or archived.');
      if (b.status === 'active' && f.published_version == null) return fail(res, 422, 'Publish the form before making it active.');
      p.push(b.status); sets.push(`status=$${p.length}`);
    }
    if (b.name !== undefined) { const name = String(b.name || '').trim().slice(0, 80); if (name.length < 2) return fail(res, 422, 'Give the form a name.'); p.push(name); sets.push(`name=$${p.length}`); }
    if (!sets.length) return fail(res, 422, 'Nothing to change.');
    if (b.name === undefined && b.status === f.status) return res.json({ ok: true, form: formView(f) });   // already in that state (e.g. archiving an archived form): nothing to write
    const { rows } = await db.query(`UPDATE forms SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, p);
    await audit(req, 'form.update', 'form', f.id, { status: b.status, name: b.name });
    res.json({ ok: true, form: formView(rows[0]) });
  }));

  /* autosave: accepts work in progress (problems are reported, not refused) */
  router.put('/api/forms/:id/draft', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const prev = f.published_version ? await versionDef(f.id, f.published_version) : null;
    if (!req.body || typeof req.body.definition !== 'object' || req.body.definition === null) return fail(res, 422, 'Send the form definition.');
    const def = F.sanitizeDefinition(req.body.definition, { allowedColumns: columnsFor(prev && prev.definition) });
    if (Buffer.byteLength(JSON.stringify(def)) > F.LIMITS.definitionBytes) return fail(res, 413, 'The form is too large.');
    await db.query(`INSERT INTO form_drafts (form_id, definition, base_version, author, updated_at) VALUES ($1,$2,$3,$4,now())
                    ON CONFLICT (form_id) DO UPDATE SET definition=$2, base_version=$3, author=$4, updated_at=now()`, [f.id, JSON.stringify(def), f.published_version, req.admin.username]);
    const problems = F.validateDefinition(def).concat(prev ? F.compareVersions(prev.definition, def) : []);
    res.json({ ok: true, saved_at: new Date().toISOString(), problems });
  }));

  router.delete('/api/forms/:id/draft', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    await db.query('DELETE FROM form_drafts WHERE form_id=$1', [f.id]);
    await audit(req, 'form.draft_discarded', 'form', f.id);
    const pub = f.published_version ? await versionDef(f.id, f.published_version) : null;
    res.json({ ok: true, working: pub ? pub.definition : F.defaultDefinition() });
  }));

  router.post('/api/forms/:id/publish', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const draft = await draftOf(f.id);
    if (!draft) return fail(res, 422, 'There is nothing new to publish.');
    const prev = f.published_version ? await versionDef(f.id, f.published_version) : null;
    const def = F.sanitizeDefinition(draft.definition, { allowedColumns: columnsFor(prev && prev.definition) });
    const problems = F.validateDefinition(def).concat(prev ? F.compareVersions(prev.definition, def) : []);
    if (problems.length) return fail(res, 422, 'Fix these before publishing.', { problems });
    if (prev && F.diffDefinitions(prev.definition, def).length === 0) { await db.query('DELETE FROM form_drafts WHERE form_id=$1', [f.id]); return res.json({ ok: true, unchanged: true, version: prev.version }); }
    const note = String((req.body || {}).note || '').trim().slice(0, 200) || null;
    const version = f.current_version + 1;
    try {
      await db.tx(async (c) => {
        await c.query('INSERT INTO form_versions (form_id, version, definition, author, note, published_at) VALUES ($1,$2,$3,$4,$5,now())', [f.id, version, JSON.stringify(def), req.admin.username, note]);
        await c.query("UPDATE forms SET current_version=$2, published_version=$2, status=CASE WHEN status='draft' THEN 'active' ELSE status END, updated_at=now() WHERE id=$1", [f.id, version]);
        await c.query('DELETE FROM form_drafts WHERE form_id=$1', [f.id]);
      });
    } catch (e) { if (e && e.code === '23505') return fail(res, 409, 'Someone else published at the same moment. Reload the studio and try again.'); throw e; }
    await audit(req, 'form.publish', 'form', f.id, { version, note, changes: prev ? F.diffDefinitions(prev.definition, def).length : null });
    res.json({ ok: true, version });
  }));

  router.get('/api/forms/:id/versions', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const { rows } = await db.query('SELECT version, author, note, created_at, published_at FROM form_versions WHERE form_id=$1 ORDER BY version DESC LIMIT 200', [f.id]);
    const counts = await db.query('SELECT form_version, COUNT(*)::int AS n FROM leads WHERE form_id=$1 AND form_version IS NOT NULL GROUP BY form_version', [f.id]);
    const cnt = new Map(counts.rows.map((r) => [r.form_version, r.n]));
    res.json({ ok: true, published_version: f.published_version, versions: rows.map((r) => ({ ...r, live: r.version === f.published_version, leads: cnt.get(r.version) || 0 })) });
  }));

  router.get('/api/forms/:id/versions/:v', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id); const v = parseInt(req.params.v, 10);
    if (!f || !(v > 0)) return fail(res, 404, 'Version not found.');
    const ver = await versionDef(f.id, v);
    if (!ver) return fail(res, 404, 'Version not found.');
    const before = v > 1 ? await versionDef(f.id, v - 1) : null;
    res.json({ ok: true, version: ver.version, author: ver.author, note: ver.note, created_at: ver.created_at, definition: ver.definition, changes: F.diffDefinitions(before && before.definition, ver.definition) });
  }));

  router.get('/api/forms/:id/diff', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id); const a = parseInt(req.query.from, 10), b = parseInt(req.query.to, 10);
    if (!f || !(a > 0) || !(b > 0)) return fail(res, 404, 'Version not found.');
    const [va, vb] = await Promise.all([versionDef(f.id, a), versionDef(f.id, b)]);
    if (!va || !vb) return fail(res, 404, 'Version not found.');
    res.json({ ok: true, changes: F.diffDefinitions(va.definition, vb.definition) });
  }));

  /* restore = copy an old version into the draft (nothing goes live until it is published) */
  router.post('/api/forms/:id/restore', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id); const v = parseInt((req.body || {}).version, 10);
    if (!f || !(v > 0)) return fail(res, 404, 'Version not found.');
    const ver = await versionDef(f.id, v);
    if (!ver) return fail(res, 404, 'Version not found.');
    await db.query(`INSERT INTO form_drafts (form_id, definition, base_version, author, updated_at) VALUES ($1,$2,$3,$4,now())
                    ON CONFLICT (form_id) DO UPDATE SET definition=$2, base_version=$3, author=$4, updated_at=now()`, [f.id, JSON.stringify(ver.definition), f.published_version, req.admin.username]);
    await audit(req, 'form.restore', 'form', f.id, { version: v });
    res.json({ ok: true, working: ver.definition });
  }));

  /* rollback = make an existing version the live one straight away (no new version is created) */
  router.post('/api/forms/:id/rollback', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id); const v = parseInt((req.body || {}).version, 10);
    if (!f || !(v > 0)) return fail(res, 404, 'Version not found.');
    const ver = await versionDef(f.id, v);
    if (!ver) return fail(res, 404, 'Version not found.');
    if (F.validateDefinition(ver.definition).length) return fail(res, 422, 'That version is no longer valid and cannot go live.');
    await db.query("UPDATE forms SET published_version=$2, status=CASE WHEN status='draft' THEN 'active' ELSE status END, updated_at=now() WHERE id=$1", [f.id, v]);
    await audit(req, 'form.rollback', 'form', f.id, { from: f.published_version, to: v });
    res.json({ ok: true, published_version: v });
  }));

  /* ---------- generated links (per form) ---------- */
  router.get('/api/forms/:id/links', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const [links, camps] = await Promise.all([campaigns.listLinks(f.id), campaigns.list({ form_id: f.id })]);
    res.json({ ok: true, base: `${origin(req)}/${f.path}`, links, campaigns: camps, platforms: Object.entries(campaigns.PLATFORMS).map(([id, p]) => ({ id, label: p.label, medium: p.medium })), mediums: campaigns.MEDIUMS });
  }));
  router.post('/api/forms/:id/links', needApi, jsonOnly, json, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f) return fail(res, 404, 'Form not found.');
    const b = req.body || {};
    const r = await campaigns.saveLink({ form: f, req, platform: b.platform, medium: b.medium, campaign_id: b.campaign_id == null || b.campaign_id === '' ? null : Number(b.campaign_id), campaign_name: b.campaign_name, label: b.label, extra: b.extra && typeof b.extra === 'object' ? b.extra : {} });
    if (r.error) return fail(res, 422, r.error);
    await audit(req, 'link.create', 'form', f.id, { url: r.link.url });
    res.status(201).json({ ok: true, link: r.link });
  }));
  router.delete('/api/forms/:id/links/:linkId', needApi, wrap(async (req, res) => {
    const f = await loadForm(req.params.id);
    if (!f || !ID.test(req.params.linkId)) return fail(res, 404, 'Link not found.');
    if (!(await campaigns.removeLink(f.id, req.params.linkId))) return fail(res, 404, 'Link not found.');
    res.json({ ok: true });
  }));

  /* ---------- campaigns ---------- */
  router.get('/api/campaigns', needApi, wrap(async (req, res) => {
    const [list, st, fs] = await Promise.all([campaigns.list(), campaigns.stats(), db.query('SELECT id, course_slug, name, path, status FROM forms ORDER BY id')]);
    const base = origin(req);
    const formPath = new Map(fs.rows.map((f) => [Number(f.id), f.path]));
    res.json({ ok: true, mediums: campaigns.MEDIUMS, statuses: campaigns.STATUSES,
      forms: fs.rows.map((f) => ({ id: Number(f.id), course_slug: f.course_slug, name: f.name, path: f.path, status: f.status, base_link: `${base}/${f.path}` })),
      campaigns: list.map((c) => {
        const path = c.form_path || formPath.get(Number(c.form_id)) || O.COURSE_PATHS[c.course_slug] || c.course_slug;
        return { ...c, leads: (st.leads.get(c.id) || {}).n || 0, last_lead_at: (st.leads.get(c.id) || {}).last || null, opens: st.opens.get(c.course_slug + '|' + c.utm_campaign) || 0,
          link: campaigns.buildLink({ origin: base, path, medium: c.utm_medium, campaign: c.utm_campaign }), base_link: `${base}/${path}` };
      }) });
  }));
  router.post('/api/campaigns', needApi, jsonOnly, json, wrap(async (req, res) => {
    const r = await campaigns.create(req.body);
    if (r.error) return fail(res, r.duplicate ? 409 : 422, r.error);
    await audit(req, 'campaign.create', 'campaign', r.campaign.id, { name: r.campaign.name, course: r.campaign.course_slug });
    res.status(201).json({ ok: true, campaign: r.campaign });
  }));
  router.patch('/api/campaigns/:id', needApi, jsonOnly, json, wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return fail(res, 404, 'Campaign not found.');
    const r = await campaigns.update(req.params.id, req.body || {});
    if (r.error) return fail(res, r.status || (r.duplicate || r.conflict ? 409 : 422), r.error);
    await audit(req, 'campaign.update', 'campaign', req.params.id);
    res.json({ ok: true, campaign: r.campaign });
  }));
  router.post('/api/campaigns/:id/status', needApi, jsonOnly, json, wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return fail(res, 404, 'Campaign not found.');
    const r = await campaigns.setStatus(req.params.id, (req.body || {}).status, { replace: (req.body || {}).replace === true });
    if (r.error) return fail(res, r.status || 422, r.error, r.active ? { active: r.active } : undefined);
    await audit(req, 'campaign.status', 'campaign', req.params.id, { status: r.campaign.status, paused: r.paused || null });
    res.json({ ok: true, campaign: r.campaign, paused: r.paused || null });
  }));
  router.delete('/api/campaigns/:id', needApi, wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return fail(res, 404, 'Campaign not found.');
    const r = await campaigns.remove(req.params.id);
    if (r.error) return fail(res, r.status || 422, r.error);
    await audit(req, 'campaign.delete', 'campaign', req.params.id);
    res.json({ ok: true });
  }));

  /* ---------- audit + same person ---------- */
  router.get('/api/audit', needApi, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT at, admin, action, entity, entity_id, detail FROM admin_audit_log ORDER BY id DESC LIMIT 100');
    res.json({ ok: true, rows: rows.map((r) => ({ ...r, detail: r.detail ? asObj(r.detail) : null })) });
  }));
  router.get('/api/leads/:id/related', needApi, wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return fail(res, 404, 'Lead not found.');
    const rel = await person.relatedTo(req.params.id);
    if (!rel) return fail(res, 404, 'Lead not found.');
    res.json({ ok: true, related: rel });
  }));
}

module.exports = { mountStudio, forms };
