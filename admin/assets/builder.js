/* Shared ad-link builder fields (Leads/Analytics panel and the QR generator tab use the same one).
   KnoaBuilder.mount(host, { base, courses, state, onChange }) draws: master class, where the ad runs (source), medium, campaign
   and returns { url(), ready(), set() }.

   The link is only given out when it is complete and trustworthy: a master class must be picked (nothing is pre-selected), a medium
   must be chosen (or typed under "Other…") and a campaign name must be typed. Until then url() is '' and onChange(url, state, ready)
   reports ready = false, so the pages keep the link, copy and QR buttons hidden.

   The master class field is a search box, not a dropdown: type part of a name to filter, pick with the mouse, touch or Up / Down + Enter.
   It keeps working with any number of master classes. "No master class (plain link)" is an explicit choice at the end of the list.
   state.course: null = nothing chosen yet, '' = plain link, otherwise the link path (e.g. 'generative-ai').

   Facebook and Instagram are one source, "Meta": one link covers both. The server tells Facebook from Instagram by itself (the app the visitor
   opened the link in), so nothing extra has to be pasted into Meta Ads Manager: the link is all that is needed. Text only, never innerHTML. */
(function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /* value in the link, label on screen */
  var SOURCES = [['meta', 'Meta (Facebook & Instagram)'], ['google', 'Google'], ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp'], ['linkedin', 'LinkedIn'], ['telegram', 'Telegram'], ['email', 'Email']];
  /* Medium = how the ad reaches people. A fixed list keeps the analytics clean (no "Paid" / "paid-ads" / "paid_ads" splits);
     "Other…" still allows a custom value. */
  var MEDIUMS = [['paid', 'Paid ads (paid)'], ['cpc', 'Pay per click (cpc)'], ['social', 'Free social post (social)'], ['email', 'Email (email)'],
    ['whatsapp', 'WhatsApp message (whatsapp)'], ['influencer', 'Influencer / partner (influencer)'], ['referral', 'Referral (referral)'], ['organic', 'Organic / search (organic)'], ['qr', 'QR code (qr)']];
  var OTHER = '__other';
  var PLAIN = 'No master class (plain link)';
  var uid = 0;

  function clean(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  function norm(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim(); }

  /* complete = master class chosen + medium + campaign (the source always has a value) */
  function missing(s) {
    var m = [];
    if (s.course == null) m.push('master class');
    if (!clean(s.medium)) m.push('medium');
    if (!clean(s.campaign)) m.push('campaign name');
    return m;
  }
  function buildUrl(base, s) {
    var q = new URLSearchParams(); q.set('utm_source', s.source || 'meta');
    if (clean(s.medium)) q.set('utm_medium', clean(s.medium));
    if (clean(s.campaign)) q.set('utm_campaign', clean(s.campaign));
    return base + '/' + (s.course || '') + '?' + q.toString();
  }

  /* ---------- master class search box ---------- */
  function combo(courses, st, onPick) {
    var id = 'kbc' + (++uid), wrap = el('div', 'kcombo');
    var inp = el('input', 'control sm'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.maxLength = 60;
    inp.placeholder = 'Search or pick a master class'; inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-label', 'Master class');
    inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-expanded', 'false'); inp.setAttribute('aria-controls', id + '-list');
    var clear = el('button', 'kcombo-x', '×'); clear.type = 'button'; clear.hidden = true; clear.setAttribute('aria-label', 'Clear master class'); clear.title = 'Clear';
    var list = el('ul', 'kcombo-list'); list.id = id + '-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
    var note = el('div', 'kcombo-note'); note.setAttribute('role', 'status');
    wrap.appendChild(inp); wrap.appendChild(clear); wrap.appendChild(list); wrap.appendChild(note);

    var items = [], active = -1;
    function all() { return courses.map(function (c) { return { name: c.name, path: c.path, hint: '/' + c.path }; }).concat([{ name: PLAIN, path: '', hint: 'general link', plain: true }]); }
    function matches(q) {
      var n = norm(q);
      if (!n) return all();
      return all().filter(function (o) { return norm(o.name).indexOf(n) !== -1 || norm(o.path).indexOf(n) !== -1 || (o.plain && ['plain', 'no master class', 'none'].some(function (w) { return w.indexOf(n) === 0; })); });
    }
    function selectedName() { if (st.course == null) return null; if (st.course === '') return PLAIN; var c = courses.filter(function (x) { return x.path === st.course; })[0]; return c ? c.name : null; }
    function paintClear() { clear.hidden = !inp.value; }
    function setNote() {
      note.textContent = ''; note.className = 'kcombo-note';
      if (st.course != null || !inp.value.trim()) return;
      note.className = 'kcombo-note bad';
      note.textContent = items.length ? 'Pick one from the list.' : 'No master class matches “' + inp.value.trim() + '”. Add it first under “Add a new master class”.';
    }
    function open() { list.hidden = false; inp.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); active = -1; }
    function choose(o, keepText) {
      st.course = o.path; if (!keepText) inp.value = o.name; note.textContent = ''; note.className = 'kcombo-note';
      close(); paintClear(); onPick();
    }
    function mark(i) {
      var rows = list.querySelectorAll('[role=option]'); if (!rows.length) { active = -1; return; }
      active = (i + rows.length) % rows.length;
      for (var k = 0; k < rows.length; k++) { rows[k].classList.toggle('on', k === active); rows[k].setAttribute('aria-selected', String(k === active)); }
      inp.setAttribute('aria-activedescendant', rows[active].id); if (rows[active].scrollIntoView) rows[active].scrollIntoView({ block: 'nearest' });
    }
    function paintList() {
      items = matches(st.course != null && inp.value === selectedName() ? '' : inp.value);   // right after a pick, the whole list is shown again
      list.textContent = '';
      items.forEach(function (o, i) {
        var li = el('li', 'kcombo-opt' + (o.plain ? ' plain' : '')); li.id = id + '-o' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
        li.appendChild(el('span', 'kcombo-name', o.name)); li.appendChild(el('span', 'kcombo-hint', o.hint));
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(o); });             // mousedown runs before the input loses focus
        list.appendChild(li);
      });
      if (!items.length) { var none = el('li', 'kcombo-empty', 'No master class matches'); none.setAttribute('role', 'presentation'); list.appendChild(none); }
      active = -1;
    }

    inp.addEventListener('focus', function () { paintList(); open(); if (st.course != null) inp.select(); });
    inp.addEventListener('click', function () { if (list.hidden) { paintList(); open(); } });
    inp.addEventListener('input', function () {
      var typed = inp.value.trim().toLowerCase();
      var exact = typed ? all().filter(function (o) { return o.name.toLowerCase() === typed; })[0] : null;
      if (exact) { choose(exact, true); return; }                                                        // typed the whole name: that is a pick
      if (st.course != null) { st.course = null; onPick(); }                                             // editing the text drops the previous pick
      paintList(); open(); paintClear(); setNote();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) { paintList(); open(); } mark(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) { paintList(); open(); } mark(active - 1); }
      else if (e.key === 'Enter') { if (!list.hidden && items.length) { e.preventDefault(); choose(items[active >= 0 ? active : 0]); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
    });
    inp.addEventListener('blur', function () { close(); setNote(); });
    clear.addEventListener('click', function () { inp.value = ''; st.course = null; paintClear(); note.textContent = ''; note.className = 'kcombo-note'; onPick(); inp.focus(); });

    function sync() { var n = selectedName(); if (n) inp.value = n; else if (st.course != null) inp.value = ''; paintClear(); }
    sync();
    return { node: wrap, input: inp, sync: sync };
  }

  function mount(host, o) {
    var st = o.state, courses = o.courses;
    if (st.course === undefined) st.course = null;
    if (st.course !== null && st.course !== '' && !courses.some(function (c) { return c.path === st.course; })) st.course = null;   // a master class that no longer exists is not a choice
    function field(label, node) { var w = el('label', 'lbf'); w.appendChild(el('span', null, label)); w.appendChild(node); return w; }

    var cb = combo(courses, st, function () { read(); });
    var cw = el('div', 'lbf'); cw.appendChild(el('span', null, 'Master class')); cw.appendChild(cb.node);

    var ss = el('select', 'control sm'); ss.setAttribute('aria-label', 'Where the ad runs');
    SOURCES.forEach(function (x) { var op = el('option', null, x[1]); op.value = x[0]; ss.appendChild(op); });
    if (!SOURCES.some(function (x) { return x[0] === st.source; })) st.source = 'meta';
    ss.value = st.source;

    var sm = el('select', 'control sm'); sm.setAttribute('aria-label', 'Medium');
    var op0 = el('option', null, 'Select a medium'); op0.value = ''; sm.appendChild(op0);
    MEDIUMS.concat([[OTHER, 'Other…']]).forEach(function (m) { var op = el('option', null, m[1]); op.value = m[0]; sm.appendChild(op); });
    var med0 = clean(st.medium), known = MEDIUMS.some(function (m) { return m[0] === st.medium; });
    sm.value = !med0 ? '' : (known ? st.medium : OTHER);
    var smo = el('input', 'control sm'); smo.type = 'text'; smo.maxLength = 40; smo.placeholder = 'type your own, e.g. brochure'; smo.autocomplete = 'off'; smo.setAttribute('aria-label', 'Custom medium');
    smo.value = med0 && !known ? st.medium : ''; smo.hidden = sm.value !== OTHER;
    var sg = el('input', 'control sm'); sg.type = 'text'; sg.value = st.campaign || ''; sg.maxLength = 60; sg.placeholder = 'e.g. ds-oct-reels'; sg.autocomplete = 'off'; sg.setAttribute('aria-label', 'Campaign name');
    var sgNote = el('div', 'kcombo-note');

    var grid = el('div', 'lbuild-grid');
    grid.appendChild(cw); grid.appendChild(field('Where the ad runs (source)', ss));
    var mw = field('Medium (how the ad is delivered)', sm); mw.appendChild(smo); grid.appendChild(mw);
    var gw = field('Campaign name', sg); gw.appendChild(sgNote); grid.appendChild(gw);
    host.appendChild(grid);

    /* what is still missing */
    var need = el('p', 'lb-need'); need.setAttribute('role', 'status'); need.setAttribute('aria-live', 'polite');
    host.appendChild(need);

    function ready() { return missing(st).length === 0; }
    function url() { return ready() ? buildUrl(o.base, st) : ''; }
    function read() {
      st.source = ss.value; smo.hidden = sm.value !== OTHER; st.medium = sm.value === OTHER ? smo.value : sm.value; st.campaign = sg.value;
      var typedCamp = sg.value.trim(), cleaned = clean(sg.value);
      sgNote.className = 'kcombo-note'; sgNote.textContent = typedCamp && cleaned && cleaned !== typedCamp ? 'Saved in the link as: ' + cleaned : '';
      var m = missing(st), ok = m.length === 0;
      need.hidden = ok; need.textContent = ok ? '' : 'To get the link and QR code, add: ' + m.join(', ') + '.';
      if (o.onChange) o.onChange(url(), st, ok);
    }
    [ss, sm, smo, sg].forEach(function (n) { n.addEventListener('input', read); n.addEventListener('change', read); });
    read();
    return { url: url, ready: ready, set: function (patch) { for (var k in patch) st[k] = patch[k]; cb.sync(); read(); } };
  }

  window.KnoaBuilder = { SOURCES: SOURCES, MEDIUMS: MEDIUMS, clean: clean, missing: missing, buildUrl: buildUrl, mount: mount };
})();
