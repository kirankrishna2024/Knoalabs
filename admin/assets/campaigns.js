/* Campaign manager. A campaign belongs to a FORM (one form -> many campaigns); at most one ACTIVE campaign per form,
   and the form's plain link forwards to its tags. Where the ad runs is auto-detected from the click id / referrer. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login'; throw new Error('signed out'); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error(j.error || 'Something went wrong'); e.body = j; e.status = r.status; throw e; } return j; });
    });
  }
  var DATA = null;
  var NAME_RE = /^[A-Za-z][A-Za-z ]{2,39}$/;
  function showErr(m) { var b = $('err'); b.textContent = m || ''; b.hidden = !m; }
  $('logout').addEventListener('click', function () { api('POST', '/admin/api/logout', {}).then(function () { location.href = '/admin/login'; }); });
  api('GET', '/admin/api/me').then(function (m) { $('who').textContent = m.username; }, function () {});

  function btn(label, cls, fn) { var b = el('button', 'kbtn ' + (cls || ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function formName(c) { return c.form_name || (DATA.forms.filter(function (f) { return Number(f.id) === Number(c.form_id); })[0] || {}).name || 'Form'; }
  function setStatus(c, status, replace) {
    api('POST', '/admin/api/campaigns/' + c.id + '/status', { status: status, replace: replace === true }).then(function (r) {
      if (window.KnoaUI) KnoaUI.toast(r.paused ? 'Active. "' + r.paused.name + '" was paused.' : 'Campaign ' + status);
      load();
    }, function (e) {
      if (e.status === 409 && e.body && e.body.active && window.KnoaUI) {
        KnoaUI.confirm({ title: 'Replace the active campaign?', message: '"' + e.body.active.name + '" is the active campaign for this form. Activating "' + c.name + '" pauses it, and the form\'s plain link will forward to the new one.', ok: 'Replace it' }).then(function (yes) { if (yes) setStatus(c, status, true); });
      } else showErr(e.message);
    });
  }
  function row(c) {
    var r = el('div', 'camp'), a = el('div'), b = el('div'), d = el('div'), z = el('div');
    var t = el('div'); t.style.fontWeight = '700'; t.textContent = c.name; a.appendChild(t);
    a.appendChild(el('span', 'chip ' + c.status, c.status));
    b.appendChild(el('div', 'muted', 'Auto-detect · ' + c.utm_medium));    // the source is worked out from the ad click id / referrer
    var dates = c.starts_on || c.ends_on ? (c.starts_on || '…') + ' → ' + (c.ends_on || '…') : 'no dates'; b.appendChild(el('div', 'muted', dates));
    d.appendChild(el('div', null, c.leads + ' registrations')); d.appendChild(el('div', 'muted', c.opens + ' opens'));
    z.appendChild(el('code', null, c.link));
    var acts = el('div', 'camp-actions');
    acts.appendChild(btn('Copy link', '', function () { KnoaUI.copy(c.link).then(function () { KnoaUI.toast('Link copied'); }, function () {}); }));
    acts.appendChild(btn('QR', '', function () { if (window.KnoaQR) KnoaQR.open(c.link, c.name); }));
    if (c.status !== 'active' && c.status !== 'ended') acts.appendChild(btn('Activate', 'primary', function () { setStatus(c, 'active'); }));
    if (c.status === 'active') acts.appendChild(btn('Pause', '', function () { setStatus(c, 'paused'); }));
    if (c.status !== 'ended') acts.appendChild(btn('End', '', function () { setStatus(c, 'ended'); }));
    if (c.status === 'ended') acts.appendChild(btn('Reopen as draft', '', function () { setStatus(c, 'draft'); }));
    acts.appendChild(btn('Edit', '', function () { form(c); }));
    if (!c.leads && c.status !== 'active') acts.appendChild(btn('Delete', 'ghost-danger', function () { KnoaUI.confirm({ title: 'Delete this campaign?', message: c.name, ok: 'Delete', danger: true }).then(function (yes) { if (yes) api('DELETE', '/admin/api/campaigns/' + c.id).then(load, function (e) { showErr(e.message); }); }); }));
    z.appendChild(acts);
    r.appendChild(a); r.appendChild(b); r.appendChild(d); r.appendChild(z);
    return r;
  }
  function render() {
    var host = $('campList'); host.textContent = '';
    if (!DATA.campaigns.length) host.appendChild(el('p', 'muted', 'No campaigns yet. Create one, then activate it.'));
    DATA.forms.forEach(function (f) {
      var list = DATA.campaigns.filter(function (c) { return Number(c.form_id) === Number(f.id); });
      if (!list.length) return;
      var g = el('div', 'camp-group'), h = el('h2', null, f.name), act = list.filter(function (c) { return c.status === 'active'; })[0];
      h.appendChild(el('span', 'chip ' + (act ? 'active' : 'draft'), act ? 'plain link → ' + act.name : 'plain link: no active campaign'));
      g.appendChild(h);
      g.appendChild(el('p', 'redir', 'Plain link ' + f.base_link + (act ? ' forwards to the tagged link of "' + act.name + '".' : ' opens the form untagged.')));
      list.forEach(function (c) { g.appendChild(row(c)); });
      host.appendChild(g);
    });
  }
  function field(label, node) { var w = el('div', 'fld'); w.appendChild(el('label', null, label)); w.appendChild(node); return w; }
  function form(c) {
    var root = el('div', 'md-back'), md = el('div', 'md'); root.appendChild(md);
    md.appendChild(el('h2', null, c ? 'Edit campaign' : 'New campaign'));
    var name = el('input', 'control'); name.value = c ? c.name : ''; name.maxLength = 40; name.placeholder = 'e.g. Student Intake Ads'; name.autocomplete = 'off';
    var formSel = el('select', 'control');
    DATA.forms.filter(function (f) { return !c || f.status !== 'archived' || Number(f.id) === Number(c.form_id); }).forEach(function (f) {
      var o = el('option', null, f.name + (f.status === 'archived' ? ' (archived)' : '')); o.value = f.id; formSel.appendChild(o);
    });
    if (c) formSel.value = c.form_id;
    var med = el('select', 'control'); DATA.mediums.forEach(function (m) { var o = el('option', null, m); o.value = m; med.appendChild(o); }); med.value = c ? c.utm_medium : 'paid';
    var s0 = el('input', 'control'); s0.type = 'date'; s0.value = c && c.starts_on || ''; var s1 = el('input', 'control'); s1.type = 'date'; s1.value = c && c.ends_on || '';
    var notes = el('textarea', 'control'); notes.value = c && c.notes || ''; notes.maxLength = 500;
    var tag = el('p', 'muted');
    function showTag() { var t = (name.value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); tag.textContent = 'Tag in the link: utm_campaign=' + (t || '…'); }
    name.addEventListener('input', showTag); showTag();
    var auto = el('div', 'control'); auto.style.display = 'flex'; auto.style.alignItems = 'center'; auto.textContent = 'Auto-detect (Google, Meta / Facebook / Instagram, Microsoft, LinkedIn, TikTok …)';
    auto.title = 'Nothing to choose: the ad platform is recognised from the click id on the link, the referrer or the in-app browser when someone opens it.';
    var msg = el('div', 'form-error'); msg.hidden = true;
    md.appendChild(field('Campaign name', name)); md.appendChild(el('p', 'muted', '3 to 40 letters, starting with a letter.'));
    md.appendChild(tag); md.appendChild(field('Form', formSel));
    md.appendChild(field('Where the ad runs', auto));
    md.appendChild(field('Medium', med));
    var r3 = el('div', 'row2'); r3.appendChild(field('Starts (optional)', s0)); r3.appendChild(field('Ends (optional)', s1)); md.appendChild(r3);
    md.appendChild(field('Notes (optional)', notes)); md.appendChild(msg);
    var row = el('div', 'fs-row');
    row.appendChild(btn(c ? 'Save' : 'Create campaign', 'primary', function () {
      var nm = name.value.replace(/\s+/g, ' ').trim();
      if (!NAME_RE.test(nm)) { msg.textContent = 'Campaign name must be 3 to 40 letters, start with a letter and contain no numbers.'; msg.hidden = false; name.focus(); return; }
      var body = { name: nm, form_id: Number(formSel.value), medium: med.value, starts_on: s0.value || null, ends_on: s1.value || null, notes: notes.value };
      api(c ? 'PATCH' : 'POST', '/admin/api/campaigns' + (c ? '/' + c.id : ''), body).then(function () { root.remove(); load(); }, function (e) { msg.textContent = e.message; msg.hidden = false; });
    }));
    row.appendChild(btn('Cancel', '', function () { root.remove(); }));
    md.appendChild(row); document.body.appendChild(root); name.focus();
  }
  $('newCampaign').addEventListener('click', function () { if (DATA) form(null); });
  function load() { showErr(''); api('GET', '/admin/api/campaigns').then(function (j) { DATA = j; render(); }, function (e) { showErr(e.message); }); }
  load();
})();
