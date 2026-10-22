/* Form Studio: list of forms. Anything from the server is inserted as text. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login'; throw new Error('signed out'); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || 'Something went wrong'); return j; });
    });
  }
  function showErr(m) { var b = $('err'); b.textContent = m; b.hidden = !m; }
  function toast(m, bad) { if (window.KnoaUI) KnoaUI.toast(m, bad); }
  $('logout').addEventListener('click', function () { api('POST', '/admin/api/logout', {}).then(function () { location.href = '/admin/login'; }); });
  api('GET', '/admin/api/me').then(function (m) { $('who').textContent = m.username; }, function () {});

  var ALL = [];
  function pathFor(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''); }

  function openPage(f) { var a = document.createElement('a'); a.href = '/' + f.path; a.target = '_blank'; a.rel = 'noopener'; a.className = 'kbtn'; a.textContent = 'Open page'; return a; }
  function card(f) {
    var c = el('div', 'fs-card'), top = el('div', 'fs-row');
    top.appendChild(el('h3', null, f.name));
    top.appendChild(el('span', 'chip ' + f.status, f.status));
    if (f.ad_running) top.appendChild(el('span', 'chip ad-run', 'Ad running · ' + f.active_campaigns + (f.active_campaigns === 1 ? ' campaign' : ' campaigns')));
    if (f.has_draft) top.appendChild(el('span', 'chip draft', 'unpublished changes'));
    c.appendChild(top);
    var meta = el('div', 'fs-meta');
    meta.appendChild(el('span', null, 'Live version ' + (f.published_version || '–')));
    meta.appendChild(el('span', null, f.leads + ' registrations'));
    meta.appendChild(el('span', null, (f.campaigns || 0) + (f.campaigns === 1 ? ' campaign' : ' campaigns')));
    c.appendChild(meta);
    c.appendChild(el('div', 'fs-url', f.url));
    var row = el('div', 'fs-row');
    var open = el('a', 'kbtn primary', 'Open studio'); open.href = '/admin/forms/' + f.id; open.style.textDecoration = 'none'; open.style.display = 'inline-flex'; open.style.alignItems = 'center'; row.appendChild(open);
    row.appendChild(openPage(f));
    var cp = el('button', 'kbtn', 'Copy link'); cp.type = 'button'; cp.addEventListener('click', function () { if (window.KnoaUI) KnoaUI.copy(f.url).then(function () { KnoaUI.toast('Link copied'); }, function () {}); }); row.appendChild(cp);
    if (f.status === 'active' || f.status === 'paused') {
      var t = el('button', 'kbtn', f.status === 'active' ? 'Pause' : 'Resume'); t.type = 'button';
      t.addEventListener('click', function () { api('PATCH', '/admin/api/forms/' + f.id, { status: f.status === 'active' ? 'paused' : 'active' }).then(load, function (e) { showErr(e.message); }); });
      row.appendChild(t);
      var ar = el('button', 'kbtn ghost-danger', 'Archive'); ar.type = 'button';
      ar.addEventListener('click', function () { if (window.KnoaUI) KnoaUI.confirm({ title: 'Archive "' + f.name + '"?', message: 'The link stops serving the form. Published versions and registrations are kept.', ok: 'Archive' }).then(function (yes) { if (yes) api('PATCH', '/admin/api/forms/' + f.id, { status: 'archived' }).then(load, function (e) { showErr(e.message); }); }); });
      row.appendChild(ar);
    } else if (f.status === 'archived') {
      var rs = el('button', 'kbtn', 'Restore'); rs.type = 'button';
      rs.addEventListener('click', function () { api('PATCH', '/admin/api/forms/' + f.id, { status: 'active' }).then(load, function (e) { showErr(e.message); }); });
      row.appendChild(rs);
    }
    c.appendChild(row);
    return c;
  }
  function visible(f, term, showArchived) {
    if (f.status === 'archived' && !showArchived) return false;
    if (!term) return true;
    return (f.name + ' ' + f.path).toLowerCase().indexOf(term) !== -1;
  }
  function paint() {
    var host = $('formList'), term = $('formSearch').value.trim().toLowerCase(), showArchived = $('showArchived').checked;
    host.textContent = '';
    var rows = ALL.filter(function (f) { return visible(f, term, showArchived); });
    if (!rows.length) { host.appendChild(el('p', 'muted', ALL.length ? 'No form matches.' : 'No forms yet. Create one with “New form”.')); return; }
    rows.forEach(function (f) { host.appendChild(card(f)); });
  }
  function load() {
    showErr('');
    api('GET', '/admin/api/forms').then(function (j) { ALL = j.forms; paint(); }, function (e) { showErr(e.message); });
  }

  /* ---------- new form (name only) ---------- */
  function newForm() {
    var root = el('div', 'md-back'), md = el('div', 'md'); root.appendChild(md);
    md.appendChild(el('h2', null, 'New form'));
    var input = el('input', 'control'); input.type = 'text'; input.maxLength = 60; input.placeholder = 'e.g. Student Intake'; input.autocomplete = 'off';
    var prev = el('p', 'muted', 'Type a name: its link appears here.');
    var msg = el('div', 'form-error'); msg.hidden = true;
    function showPreview() {
      var p = pathFor(input.value.trim());
      prev.textContent = p ? 'Link: /' + p + ' · starts as the standard registration form and goes live' : 'Type a name: its link appears here.';
    }
    input.addEventListener('input', function () { msg.hidden = true; showPreview(); }); showPreview();
    md.appendChild(el('h6', 'muted', 'Form name'));
    md.appendChild(input); md.appendChild(prev); md.appendChild(msg);
    var row = el('div', 'fs-row');
    var create = el('button', 'kbtn primary', 'Create form'); create.type = 'button';
    create.addEventListener('click', function () {
      var name = input.value.replace(/\s+/g, ' ').trim();
      if (name.length < 2) { msg.textContent = 'Enter the form name (at least 2 characters).'; msg.hidden = false; input.focus(); return; }
      create.disabled = true; create.textContent = 'Creating…';
      api('POST', '/admin/api/forms', { name: name }).then(function (r) {
        root.remove(); toast('Form created. Link ready to copy: ' + r.form.name); load();
      }, function (e) {
        if (e.message === 'signed out') return;
        msg.textContent = e.message; msg.hidden = false; create.disabled = false; create.textContent = 'Create form';
      });
    });
    var cancel = el('button', 'kbtn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', function () { root.remove(); });
    row.appendChild(create); row.appendChild(cancel); md.appendChild(row);
    document.body.appendChild(root); input.focus();
  }

  $('newForm').addEventListener('click', newForm);
  $('formSearch').addEventListener('input', paint);
  $('showArchived').addEventListener('change', paint);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });   // forms may have changed in another tab
  load();
})();
