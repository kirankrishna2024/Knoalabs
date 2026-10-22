(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { page: 1, pageSize: 25, total: 0, pages: 1, tz: undefined };

  /* small DOM builder: everything from the database goes in as text, never as HTML */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function api(path) {
    return fetch('/admin/api/' + path, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (res) {
      if (res.status === 401) { window.location.replace('/admin/login'); throw new Error('signed out'); }
      return res;
    });
  }
  /* every failure becomes a readable message that names the HTTP status, so "Not found" is never a mystery */
  function apiJson(path) {
    return api(path).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok || !d.ok) { var e = new Error((d.error || 'The server answered') + ' (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
        return d;
      });
    }, function (e) { if (e.message === 'signed out') throw e; throw new Error('Could not reach the server. Check your connection'); });
  }
  function showError(msg) { $('dashErrorText').textContent = msg; $('dashError').hidden = false; }
  function clearError() { $('dashError').hidden = true; }

  var fmtDate = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('en-IN', { timeZone: state.tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
    catch (e) { return d.toLocaleString(); }
  };
  var num = function (n) { return Number(n || 0).toLocaleString('en-IN'); };

  /* ---------------- filters ---------------- */
  function filterParams() {
    var p = new URLSearchParams();
    var q = $('q').value.trim(); if (q) p.set('q', q);
    if ($('fStatus').value) p.set('status', $('fStatus').value);
    if ($('fCourse').value) p.set('course', $('fCourse').value);
    if ($('fFrom').value) p.set('from', $('fFrom').value);
    if ($('fTo').value) p.set('to', $('fTo').value);
    return p;
  }

  /* ---------------- stats ---------------- */
  function renderRank(host, rows, label) {
    host.textContent = '';
    if (!rows.length) { host.appendChild(el('div', 'muted', 'No data yet')); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    rows.forEach(function (r) {
      var row = el('div', 'rank-row'), top = el('div', 'rank-top'), bar = el('div', 'rank-bar'), fill = el('i');
      top.appendChild(el('span', null, label(r))); top.appendChild(el('span', null, num(r.n)));
      fill.style.width = Math.max(4, Math.round(r.n / max * 100)) + '%';
      bar.appendChild(fill); row.appendChild(top); row.appendChild(bar); host.appendChild(row);
    });
  }

  /* Counts are retried quietly twice before the error is shown: a restart or a hiccup on the live
     dashboard must not leave the numbers at "–". The banner only appears if the retries also fail. */
  var statTries = 0;
  function loadStats() {
    return apiJson('stats').then(function (s) {
      statTries = 0;
      clearError();
      ['total', 'today', 'last7', 'last30'].forEach(function (k) {
        document.querySelector('[data-stat="' + k + '"]').textContent = num(s[k]);
      });
      renderRank($('byStatus'), s.byStatus, function (r) { return r.status; });
      renderRank($('byCourse'), s.byCourse, function (r) { return r.course || 'No course in link'; });
    }).catch(function (e) {
      if (e.message === 'signed out') return;
      if (statTries < 2) { statTries++; setTimeout(loadStats, 1500 * statTries); return; }
      showError('Could not load the counts: ' + e.message + '.');
    });
  }

  /* ---------------- filter dropdowns ----------------
     Filled from /filters, which needs no database query, so both dropdowns always show every choice, even while
     the counts are failing. Rebuilt from scratch each time (never appended twice) and the selection is kept. */
  var FALLBACK_STATUSES = ['Student / Fresher', 'Working Professional'];
  var NO_COURSE = '__none';
  function fillSelect(sel, items) {
    var keep = sel.value, first = sel.options[0];
    while (sel.options.length) sel.remove(0);
    sel.appendChild(first);
    items.forEach(function (it) { var o = el('option', null, it.label); o.value = it.value; sel.appendChild(o); });
    sel.value = keep;
    if (sel.value !== keep) sel.value = '';
  }
  function applyFilters(f) {
    fillSelect($('fStatus'), (f.statuses && f.statuses.length ? f.statuses : FALLBACK_STATUSES).map(function (x) { return { value: x, label: x }; }));
    var courses = (f.courses || []).slice();
    if (!courses.some(function (c) { return c.slug === NO_COURSE; })) courses.push({ slug: NO_COURSE, name: 'No course in link' });
    fillSelect($('fCourse'), courses.map(function (c) { return { value: c.slug, label: c.name }; }));
  }
  var filterTries = 0;
  function loadFilters() {
    return apiJson('filters').then(function (f) { filterTries = 0; applyFilters(f); }).catch(function (e) {
      if (e.message === 'signed out') return;
      applyFilters({});                                           // statuses still work from the built-in list
      if (filterTries < 3) { filterTries++; setTimeout(loadFilters, 2000 * filterTries); }
    });
  }
  applyFilters({});                                               // visible immediately, before any request finishes

  /* ---------------- table ---------------- */
  function detailsCell(r) {
    var td = el('td'), box = el('div', 'detail');
    if (r.status === 'Student / Fresher') {
      box.appendChild(el('span', null, [r.student_course, r.student_status].filter(Boolean).join(' · ') || '—'));
      if (r.college_name || r.specialization) box.appendChild(el('span', 'small', [r.college_name, r.specialization].filter(Boolean).join(' · ')));
    } else if (r.status === 'Working Professional') {
      box.appendChild(el('span', null, [r.experience_level && r.experience_level.replace('-', '–'), r.job_role].filter(Boolean).join(' · ') || '—'));
      if (r.current_company || r.highest_qualification) box.appendChild(el('span', 'small', [r.current_company, r.highest_qualification].filter(Boolean).join(' · ')));
    } else box.appendChild(el('span', 'muted', '—'));
    var cf = r.custom_fields && typeof r.custom_fields === 'object' ? r.custom_fields : null;      // answers to fields added in Form Studio
    if (cf) Object.keys(cf).slice(0, 6).forEach(function (k) { var v = cf[k]; box.appendChild(el('span', 'small', k.replace(/_/g, ' ') + ': ' + (Array.isArray(v) ? v.join(', ') : String(v)))); });
    td.appendChild(box);
    return td;
  }

  var BASIS = { phone: 'same phone number', email: 'same e-mail', device: 'same browser' };
  function showRelated(r) {
    fetch('/admin/api/leads/' + encodeURIComponent(r.id) + '/related', { credentials: 'same-origin' }).then(function (x) { return x.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'failed');
      var lines = j.related.map(function (o) { return '#' + o.id + ' · ' + fmtDate(o.created_at) + ' · ' + (o.course || 'no master class') + ' · ' + (o.basis.map(function (b) { return BASIS[b]; }).join(', ')); }).join('\n');
      KnoaUI.confirm({ title: (r.full_name || 'This lead') + ' registered before', message: 'Other registrations that look like the same person. Nothing is merged or blocked.', detail: lines || 'None found.', ok: 'Close', cancel: 'Done' });
    }).catch(function (e) { KnoaUI.toast('Could not load: ' + e.message, true); });
  }

  var LABELS = ['No.', 'Registered', 'Name', 'Mobile', 'Email', 'I am a', 'Details', 'Master class', 'Source', 'Delete'];
  /* `offset` = rows on earlier pages, so the numbering runs 1, 2, 3 ... across pages instead of restarting */
  function renderRows(rows, offset) {
    var body = $('rows'); body.textContent = '';
    $('empty').hidden = rows.length > 0;
    rows.forEach(function (r, idx) {
      var tr = el('tr');
      tr.appendChild(el('td', 'no', String(offset + idx + 1)));
      tr.appendChild(el('td', 'nowrap', fmtDate(r.created_at)));
      var n = el('td'); n.appendChild(el('span', 'name', r.full_name || ''));
      if (r.is_returning_lead) { var rb = el('button', 'tag', 'Same person'); rb.type = 'button'; rb.title = 'This phone, e-mail or browser registered before. Click to see the other registrations.'; rb.style.marginLeft = '8px'; rb.style.cursor = 'pointer'; rb.addEventListener('click', function () { showRelated(r); }); n.appendChild(rb); }
      tr.appendChild(n);
      tr.appendChild(el('td', 'nowrap', r.phone || ''));
      tr.appendChild(el('td', null, r.email || '—'));
      var s = el('td'); s.appendChild(el('span', 'tag' + (r.status === 'Working Professional' ? ' pro' : ''), r.status || '—')); tr.appendChild(s);
      tr.appendChild(detailsCell(r));
      tr.appendChild(el('td', null, r.course || '—'));
      tr.appendChild(el('td', null, r.utm_source || '—'));
      var ac = el('td', 'act'), del = el('button', 'del', 'Delete');
      del.type = 'button'; del.setAttribute('aria-label', 'Delete lead ' + (r.full_name || r.id));
      del.addEventListener('click', function () { deleteLead(r, del); });
      ac.appendChild(del); tr.appendChild(ac);
      Array.prototype.forEach.call(tr.children, function (td, i) { td.setAttribute('data-label', LABELS[i]); });   // shown on phones
      body.appendChild(tr);
    });
  }

  function loadLeads() {
    var body = $('rows'); body.textContent = '';
    var tr = el('tr', 'loading-row'), td = el('td', null, 'Loading…'); td.colSpan = 10; tr.appendChild(td); body.appendChild(tr);
    $('empty').hidden = true;
    var p = filterParams(); p.set('page', state.page); p.set('pageSize', state.pageSize);
    return apiJson('leads?' + p.toString()).then(function (d) {
      state.total = d.total; state.pages = d.pages; state.page = Math.min(d.page, d.pages);
      renderRows(d.rows, (d.page - 1) * d.pageSize);
      var from = d.total ? (d.page - 1) * d.pageSize + 1 : 0, to = Math.min(d.page * d.pageSize, d.total);
      $('range').textContent = d.total ? 'Showing ' + num(from) + '–' + num(to) + ' of ' + num(d.total) : '0 results';
      $('pageNo').textContent = 'Page ' + d.page + ' of ' + d.pages;
      $('prev').disabled = d.page <= 1; $('next').disabled = d.page >= d.pages;
    }).catch(function (e) {
      body.textContent = '';
      var r = el('tr', 'loading-row'), c = el('td', null, 'Could not load registrations: ' + (e.message || 'unknown error') + '.'); c.colSpan = 10; r.appendChild(c); body.appendChild(r);
    });
  }

  /* ---------------- delete one lead ---------------- */
  function deleteLead(r, btn) {
    window.KnoaUI.confirm({
      title: 'Delete this lead?',
      message: 'The registration is removed for good, from the list, the counts, the analytics and future Excel exports. This cannot be undone.',
      detail: [r.full_name, r.phone, r.course].filter(Boolean).join(' · '), ok: 'Delete lead'
    }).then(function (yes) {
      if (!yes) return;
      btn.disabled = true; btn.textContent = 'Deleting…';
      fetch('/admin/api/leads/' + encodeURIComponent(r.id), { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.status === 401) { window.location.replace('/admin/login'); throw new Error('signed out'); }
          return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok || !d.ok) throw new Error(d.error || 'Could not delete (HTTP ' + res.status + ')'); });
        })
        .then(function () {
          window.KnoaUI.toast('Lead deleted');
          if (state.page > 1 && $('rows').children.length === 1) state.page--;      // last row of a later page: step back
          document.dispatchEvent(new CustomEvent('knoa:lead-deleted'));
          loadStats(); return loadLeads();
        })
        .catch(function (e) { if (e.message !== 'signed out') { window.KnoaUI.toast(e.message, true); btn.disabled = false; btn.textContent = 'Delete'; } });
    });
  }
  document.addEventListener('knoa:courses-changed', function () { loadFilters(); });      // a master class was added / deleted

  $('retry').addEventListener('click', function () { statTries = 0; loadFilters(); loadStats(); loadLeads(); });

  function refresh(resetPage) { if (resetPage) state.page = 1; return loadLeads(); }

  /* ---------------- events ---------------- */
  var t;
  $('q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { refresh(true); }, 300); });
  ['fStatus', 'fCourse', 'fFrom', 'fTo'].forEach(function (id) { $(id).addEventListener('change', function () { refresh(true); }); });
  $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
  $('clear').addEventListener('click', function () {
    $('q').value = ''; $('fStatus').value = ''; $('fCourse').value = ''; $('fFrom').value = ''; $('fTo').value = ''; refresh(true);
  });
  $('pageSize').addEventListener('change', function () { state.pageSize = +$('pageSize').value; refresh(true); });
  $('prev').addEventListener('click', function () { if (state.page > 1) { state.page--; loadLeads(); } });
  $('next').addEventListener('click', function () { if (state.page < state.pages) { state.page++; loadLeads(); } });

  /* Excel export uses the filters currently on screen */
  $('exportBtn').addEventListener('click', function () {
    var btn = $('exportBtn'), label = btn.querySelector('.label');
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('loading'); label.textContent = 'Preparing…';
    api('leads.xlsx?' + filterParams().toString())
      .then(function (res) {
        if (!res.ok) throw new Error('Export failed');
        var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'knoalabs-leads.xlsx';
        return res.blob().then(function (b) { return { blob: b, name: name }; });
      })
      .then(function (f) {
        var url = URL.createObjectURL(f.blob), a = document.createElement('a');
        a.href = url; a.download = f.name; a.style.display = 'none'; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      })
      .catch(function (e) { if (e.message !== 'signed out') window.alert('Could not create the Excel file. Please try again.'); })
      .then(function () { btn.disabled = false; btn.classList.remove('loading'); label.textContent = 'Export to Excel'; });
  });

  $('logout').addEventListener('click', function () {
    fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(function () { /* leave anyway */ })
      .then(function () { window.location.replace('/admin/login'); });
  });

  /* forms are created in Form Studio: pick up a new one when the admin comes back to this tab */
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadFilters(); });

  /* ---------------- start ---------------- */
  apiJson('me').then(function (me) { state.tz = me.timezone; $('who').textContent = me.username; })
    .catch(function () {})
    .then(function () { loadFilters(); loadStats(); return loadLeads(); });
})();
