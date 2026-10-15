/* Master class links: list of registration links (copy / open), add a new master class, ad-link builder with UTM tags.
   Also exposes KnoaUI.confirm() (modal) for both dashboards. Everything from the server goes in as text, never as HTML. */
(function () {
  'use strict';
  var NO_COURSE = '__none';

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }

  /* ---------- confirm modal ---------- */
  function confirmBox(opts) {
    return new Promise(function (resolve) {
      var back = el('div', 'kmodal-back'), box = el('div', 'kmodal'), prevFocus = document.activeElement;
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'kmTitle');
      var h = el('h3', null, opts.title); h.id = 'kmTitle';
      var p = el('p', null, opts.message);
      var row = el('div', 'kmodal-row'), no = el('button', 'kbtn', opts.cancel || 'Cancel'), yes = el('button', 'kbtn danger', opts.ok || 'Delete');
      no.type = yes.type = 'button';
      row.appendChild(no); row.appendChild(yes); box.appendChild(h); box.appendChild(p);
      if (opts.detail) box.appendChild(el('div', 'kmodal-detail', opts.detail));
      box.appendChild(row); back.appendChild(box); document.body.appendChild(back);
      function done(v) { document.removeEventListener('keydown', key, true); back.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(v); }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); done(false); } if (e.key === 'Tab') { var a = [no, yes], i = a.indexOf(document.activeElement); e.preventDefault(); a[(i + (e.shiftKey ? -1 : 1) + 2) % 2].focus(); } }
      document.addEventListener('keydown', key, true);
      back.addEventListener('mousedown', function (e) { if (e.target === back) done(false); });
      no.addEventListener('click', function () { done(false); }); yes.addEventListener('click', function () { done(true); });
      no.focus();
    });
  }
  window.KnoaUI = { confirm: confirmBox, copy: copyText, toast: toast };

  /* ---------- clipboard + toast ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } t.remove(); return ok;
    }
  }
  var toastTimer = null;
  function toast(msg, bad) {
    var t = document.getElementById('ktoast');
    if (!t) { t = el('div', 'ktoast'); t.id = 'ktoast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'ktoast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'ktoast' + (bad ? ' bad' : ''); }, 2600);
  }

  /* ---------- api ---------- */
  function call(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch('/admin/api/' + path, opt).then(function (res) {
      if (res.status === 401) { location.replace('/admin/login'); throw new Error('signed out'); }
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok || !d.ok) { var e = new Error(d.error || 'Request failed (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
        return d;
      });
    });
  }

  var mount = document.getElementById('linksMount');
  if (!mount) return;
  var data = null, justCreated = null, builder = { course: '', source: 'facebook', medium: 'paid', campaign: '' };

  /* same rule as the server (src/courses.js parseName): "Machine Learning" -> machine-learning */
  function pathFor(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, ''); }

  function copyBtn(getText, label) {
    var b = el('button', 'kbtn', label || 'Copy link'); b.type = 'button';
    b.addEventListener('click', function () {
      copyText(getText()).then(function (ok) {
        b.textContent = ok ? 'Copied ✓' : 'Press Ctrl+C'; b.classList.toggle('done', ok);
        toast(ok ? 'Link copied. Paste it in your ad.' : 'Could not copy automatically. Select the link and copy it.', !ok);
        setTimeout(function () { b.textContent = label || 'Copy link'; b.classList.remove('done'); }, 1800);
      });
    });
    return b;
  }

  function card(name, url, leads, opts) {
    var c = el('div', 'lcard' + (opts.dot ? '' : ' plain'));
    var top = el('div', 'lcard-top'), nm = el('span', 'lcard-name');
    if (opts.color) { var sw = el('i', 'lsw'); sw.style.background = opts.color; nm.appendChild(sw); }
    nm.appendChild(document.createTextNode(name));
    top.appendChild(nm); top.appendChild(el('span', 'lcard-n', num(leads) + (leads === 1 ? ' lead' : ' leads')));
    var u = el('a', 'lcard-url', url.replace(/^https?:\/\//, '')); u.href = url; u.target = '_blank'; u.rel = 'noopener'; u.title = url;
    var row = el('div', 'lcard-row');
    row.appendChild(copyBtn(function () { return url; }));
    if (opts.onDelete) {
      var del = el('button', 'kbtn ghost-danger', 'Delete'); del.type = 'button'; del.setAttribute('aria-label', 'Delete master class ' + name);
      del.addEventListener('click', opts.onDelete); row.appendChild(del);
    } else if (opts.note) row.appendChild(el('span', 'lcard-note', opts.note));
    c.appendChild(top); c.appendChild(u); c.appendChild(row);
    return c;
  }

  function colorOf(slug) { return (window.KnoaColors && window.KnoaColors(slug)) || ''; }

  function render() {
    mount.textContent = '';
    var head = el('div', 'lk-head'), t = el('div');
    t.appendChild(el('h2', null, 'Master class links'));
    t.appendChild(el('p', 'lk-sub', 'One link per master class. Paste it in your ad: the form opens with that master class name, and every lead is counted under it.'));
    head.appendChild(t);
    var addTop = el('button', 'kbtn primary', '+ Add master class'); addTop.type = 'button'; addTop.id = 'addCourseBtn';
    addTop.addEventListener('click', function () { var i = document.getElementById('newCourse'); if (i) { i.scrollIntoView({ behavior: 'smooth', block: 'center' }); i.focus(); } });
    head.appendChild(addTop); mount.appendChild(head);

    var grid = el('div', 'lgrid');
    data.courses.forEach(function (c) {
      grid.appendChild(card(c.name, c.url, c.leads, {
        dot: true, color: colorOf(c.slug),
        onDelete: c.is_default ? null : function () { removeCourse(c); },
        note: c.is_default ? 'Default' : ''
      }));
    });
    grid.appendChild(card('No master class (plain link)', data.plain.url, data.plain.leads, { note: 'Default · general form' }));
    mount.appendChild(grid);

    /* link of the master class that was just created */
    if (justCreated) {
      var ok = el('div', 'lnew'), okT = el('div', 'lnew-t');
      okT.appendChild(el('b', null, justCreated.name + ' is ready. '));
      okT.appendChild(document.createTextNode('Share this link in your ad:'));
      var okU = el('a', 'lcard-url', justCreated.url); okU.href = justCreated.url; okU.target = '_blank'; okU.rel = 'noopener';
      var okX = el('button', 'kbtn', 'Dismiss'); okX.type = 'button';
      okX.addEventListener('click', function () { justCreated = null; render(); });
      var okR = el('div', 'lcard-row'); okR.appendChild(copyBtn(function () { return justCreated.url; }, 'Copy link')); okR.appendChild(okX);
      ok.appendChild(okT); ok.appendChild(okU); ok.appendChild(okR); mount.appendChild(ok);
    }

    /* add a master class */
    var add = el('form', 'ladd'); add.noValidate = true;
    var lab = el('label', 'ladd-lab', 'Add a new master class'); lab.setAttribute('for', 'newCourse');
    var inp = el('input', 'control sm'); inp.id = 'newCourse'; inp.type = 'text'; inp.maxLength = 60; inp.placeholder = 'e.g. Machine Learning'; inp.autocomplete = 'off';
    var btn = el('button', 'kbtn primary', 'Create link'); btn.type = 'submit';
    var preview = el('div', 'ladd-prev'), msg = el('div', 'ladd-msg'); msg.setAttribute('role', 'alert');
    var rowA = el('div', 'ladd-row'); rowA.appendChild(inp); rowA.appendChild(btn);
    add.appendChild(lab); add.appendChild(rowA); add.appendChild(preview); add.appendChild(msg);
    function showPreview() {
      var p = pathFor(inp.value); preview.textContent = '';
      if (!p) { preview.textContent = 'Type a name: its link appears here.'; preview.className = 'ladd-prev muted'; return; }
      preview.className = 'ladd-prev'; preview.appendChild(document.createTextNode('Link: '));
      preview.appendChild(el('b', null, data.base.replace(/^https?:\/\//, '') + '/' + p));
      var h = el('span', 'ladd-h', ' · form heading: Register for the ' + inp.value.replace(/\s+/g, ' ').trim() + ' Master Class'); preview.appendChild(h);
    }
    inp.addEventListener('input', function () { msg.textContent = ''; showPreview(); }); showPreview();
    add.addEventListener('submit', function (e) {
      e.preventDefault(); if (btn.disabled) return; msg.textContent = ''; msg.className = 'ladd-msg';
      btn.disabled = true; btn.textContent = 'Creating…';
      call('POST', 'courses', { name: inp.value }).then(function (r) {
        toast('Created. Link ready to copy: ' + r.course.name);
        justCreated = { name: r.course.name, url: r.course.url };
        return load().then(function () { document.dispatchEvent(new CustomEvent('knoa:courses-changed')); var i = document.getElementById('newCourse'); if (i) i.focus(); });
      }).catch(function (er) {
        if (er.message === 'signed out') return;
        msg.textContent = er.message; msg.className = 'ladd-msg bad'; btn.disabled = false; btn.textContent = 'Create link';
      });
    });
    mount.appendChild(add);

    /* ad link builder */
    var det = el('details', 'lbuild'), sum = el('summary', null, 'Ad link builder (adds tracking tags so the analytics shows which ad brought each lead)');
    det.appendChild(sum);
    var f = el('div', 'lbuild-grid');
    function field(label, node) { var w = el('label', 'lbf'); w.appendChild(el('span', null, label)); w.appendChild(node); return w; }
    var sc = el('select', 'control sm'); data.courses.forEach(function (c) { var o = el('option', null, c.name); o.value = c.path; sc.appendChild(o); });
    var o0 = el('option', null, 'No master class (plain link)'); o0.value = ''; sc.appendChild(o0);
    if (builder.course) sc.value = builder.course;
    var ss = el('select', 'control sm'); ['facebook', 'instagram', 'google', 'youtube', 'whatsapp', 'linkedin', 'telegram', 'email'].forEach(function (x) { var o = el('option', null, x); o.value = x; ss.appendChild(o); }); ss.value = builder.source;
    var sm = el('input', 'control sm'); sm.type = 'text'; sm.value = builder.medium; sm.maxLength = 40; sm.placeholder = 'paid';
    var sg = el('input', 'control sm'); sg.type = 'text'; sg.value = builder.campaign; sg.maxLength = 60; sg.placeholder = 'e.g. ds-oct-reels'; sg.autocomplete = 'off';
    f.appendChild(field('Master class', sc)); f.appendChild(field('Where the ad runs (source)', ss)); f.appendChild(field('Medium', sm)); f.appendChild(field('Campaign name', sg));
    var out = el('div', 'lbuild-out'), url = el('code', 'lbuild-url'); out.appendChild(url);
    function clean(v) { return String(v).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
    function build() {
      builder.course = sc.value; builder.source = ss.value; builder.medium = sm.value; builder.campaign = sg.value;
      var q = new URLSearchParams(); q.set('utm_source', ss.value);
      if (clean(sm.value)) q.set('utm_medium', clean(sm.value)); if (clean(sg.value)) q.set('utm_campaign', clean(sg.value));
      url.textContent = data.base + '/' + sc.value + '?' + q.toString();
    }
    [sc, ss, sm, sg].forEach(function (n) { n.addEventListener('input', build); n.addEventListener('change', build); }); build();
    out.appendChild(copyBtn(function () { return url.textContent; }, 'Copy ad link'));
    det.appendChild(f); det.appendChild(out);
    mount.appendChild(det);
  }

  function removeCourse(c) {
    confirmBox({
      title: 'Delete this master class?', message: 'The link stops being listed here. Leads already received are kept and still counted. This cannot be undone.',
      detail: c.name + ' · ' + c.leads + (c.leads === 1 ? ' lead' : ' leads'), ok: 'Delete master class'
    }).then(function (yes) {
      if (!yes) return;
      call('DELETE', 'courses/' + encodeURIComponent(c.slug)).then(function () { toast('Master class deleted'); return load().then(function () { document.dispatchEvent(new CustomEvent('knoa:courses-changed')); }); })
        .catch(function (e) { if (e.message !== 'signed out') toast(e.message, true); });
    });
  }

  function load() {
    return call('GET', 'courses').then(function (d) { data = d; render(); })
      .catch(function (e) { if (e.message === 'signed out') return; mount.textContent = ''; mount.appendChild(el('div', 'ladd-msg bad', 'Could not load the master class links: ' + e.message)); });
  }
  mount.setAttribute('aria-live', 'polite');
  load();
  document.addEventListener('knoa:lead-deleted', load);
  setInterval(function () { if (!document.hidden && !document.activeElement.closest('#linksMount')) load(); }, 30000);   // keeps lead counts fresh
})();
