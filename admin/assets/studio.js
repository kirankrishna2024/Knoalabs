/* Form Studio editor: layout (drag and drop), field settings, form text, live preview, autosave, publish, history, links.
   One autosaved draft per form; "Publish" makes it the live version. All server text is inserted as text, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var FORM_ID = (location.pathname.match(/\/admin\/forms\/(\d+)/) || [])[1];
  var S = { form: null, def: null, published: null, problems: [], sel: null, types: [], timer: null, saving: false, dirty: false, ready: false, limits: {}, patterns: [] };
  var TYPE_LABEL = { text: 'Short text', textarea: 'Long text', email: 'Email', phone: 'Phone', number: 'Number', select: 'Dropdown', radio: 'Choice (one)', checkbox: 'Tick box', multiselect: 'Choice (several)', date: 'Date', url: 'Web link', consent: 'Consent' };
  var ADDABLE = ['text', 'textarea', 'email', 'number', 'select', 'radio', 'multiselect', 'checkbox', 'consent', 'date', 'url'];
  var CHOICE = { select: 1, radio: 1, multiselect: 1 };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login'; throw new Error('signed out'); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error(j.error || 'Something went wrong'); e.body = j; e.status = r.status; throw e; } return j; });
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function btn(label, cls, fn) { var b = el('button', 'kbtn ' + (cls || ''), label); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function fld(label, node, hint, inline) { var w = el('div', 'fld' + (inline ? ' inline' : '')); if (inline) { w.appendChild(node); w.appendChild(el('label', null, label)); } else { w.appendChild(el('label', null, label)); w.appendChild(node); } if (hint) w.appendChild(el('div', 'hint', hint)); return w; }
  function input(value, onInput, opts) { var i = el('input', 'control'); i.type = 'text'; i.value = value == null ? '' : value; if (opts && opts.max) i.maxLength = opts.max; if (opts && opts.ph) i.placeholder = opts.ph; i.addEventListener('input', function () { onInput(i.value); }); return i; }
  function select(options, value, onChange) { var s = el('select', 'control'); options.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); }); s.value = value == null ? '' : value; s.addEventListener('change', function () { onChange(s.value); }); return s; }
  function check(value, onChange) { var c = el('input'); c.type = 'checkbox'; c.checked = !!value; c.addEventListener('change', function () { onChange(c.checked); }); return c; }

  /* ---------- model helpers ---------- */
  function fields() { return S.def.fields; }
  function byKey(k) { return fields().filter(function (f) { return f.key === k; })[0]; }
  function publishedKeys() { var m = {}; ((S.published && S.published.fields) || []).forEach(function (f) { m[f.key] = f; }); return m; }
  function isLocked(f) { return !!publishedKeys()[f.key]; }           // key, type and data column of a published field never change
  function normalizeOrder() { S.def.fields.forEach(function (f, i) { f.order = i; }); }
  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30); }
  function newKey(label) {
    var base = slug(label) || 'field', k = base.length < 2 ? 'field' : base, n = 0, used = {}; fields().forEach(function (f) { used[f.key] = 1; });
    var suffix = ''; while (used[k + suffix]) { n++; suffix = '_' + String.fromCharCode(96 + (n % 26 || 26)) + (n > 26 ? String.fromCharCode(96 + Math.floor(n / 26)) : ''); }
    return (k + suffix).slice(0, 40);
  }

  /* ---------- save, preview ---------- */
  function setSave(text, bad) { var s = $('stSave'); s.textContent = text; s.className = 'st-save' + (bad ? ' bad' : ''); }
  function changed(opts) {
    normalizeOrder(); S.dirty = true; setSave('Saving…');
    if (!opts || !opts.noRender) { renderLayout(); }
    sendPreview(opts && opts.focus);
    clearTimeout(S.timer); S.timer = setTimeout(save, 700);
  }
  function save() {
    if (S.saving) { S.timer = setTimeout(save, 400); return Promise.resolve(); }
    S.saving = true;
    return api('PUT', '/admin/api/forms/' + FORM_ID + '/draft', { definition: S.def }).then(function (r) {
      S.saving = false; S.dirty = false; S.problems = r.problems || []; S.form.has_draft = true; setSave('Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); renderProblems(); renderLayout(true);
    }, function (e) { S.saving = false; setSave('Not saved: ' + e.message + ' (retrying)', true); S.timer = setTimeout(save, 4000); });
  }
  function frameWin() { return $('preview').contentWindow; }
  function sendPreview(focusKey) {
    if (!S.ready) return;
    var fw = frameWin(); if (!fw) return;
    fw.postMessage({ type: 'knoa-preview', definition: S.def, name: S.form.name, focusKey: focusKey || S.sel || null, showClosed: S.mode === 'closed', showSuccess: S.mode === 'success' }, location.origin);
  }
  window.addEventListener('message', function (ev) { if (ev.origin === location.origin && ev.data && ev.data.type === 'knoa-preview-ready') { S.ready = true; sendPreview(); } });

  function renderProblems() {
    var box = $('stProblems'); box.textContent = '';
    if (!S.problems.length) { box.hidden = true; return; }
    box.hidden = false; box.appendChild(el('strong', null, 'Fix before publishing:')); var ul = el('ul'); S.problems.slice(0, 8).forEach(function (p) { ul.appendChild(el('li', null, p)); }); box.appendChild(ul);
  }
  function header() {
    $('stName').textContent = S.form.name; var st = $('stStatus'); st.textContent = S.form.status; st.className = 'chip ' + S.form.status;
    $('stVer').textContent = 'Live: version ' + (S.form.published_version || '–') + (S.form.has_draft ? ' · unpublished changes' : '');
    document.title = S.form.name + ' | Form Studio | KnoaLabs Admin';
  }

  /* ---------- layout (R14): sections with draggable fields ---------- */
  function renderLayout(keepScroll) {
    var host = $('layout'), top = $('layout').parentNode.scrollTop; host.textContent = '';
    var badKeys = {}; S.problems.forEach(function (p) { fields().forEach(function (f) { if (p.indexOf('"' + f.key + '"') >= 0 || p.indexOf('"' + f.label + '"') >= 0) badKeys[f.key] = 1; }); });
    S.def.sections.forEach(function (sec, si) {
      var box = el('div', 'st-sec'), h = el('div', 'st-sec-h');
      var t = el('input'); t.type = 'text'; t.value = sec.title; t.maxLength = 80; t.setAttribute('aria-label', 'Section title'); t.addEventListener('input', function () { sec.title = t.value; changed({ noRender: true }); }); h.appendChild(t);
      var showT = check(sec.showTitle, function (v) { if (v) sec.showTitle = true; else delete sec.showTitle; changed({ noRender: true }); }); showT.title = 'Show this title on the form'; h.appendChild(showT);
      var up = btn('↑', 'sm', function () { if (si > 0) { var a = S.def.sections; a.splice(si - 1, 0, a.splice(si, 1)[0]); resort(); changed(); } }); up.title = 'Move section up'; h.appendChild(up);
      var del = btn('✕', 'sm', function () {
        var inside = fields().filter(function (f) { return f.section === sec.id && !f.deleted; });
        if (inside.length || S.def.sections.length < 2) { toast('Move or delete the fields in this section first.', true); return; }
        S.def.sections.splice(si, 1); changed();
      }); del.title = 'Delete empty section'; h.appendChild(del);
      box.appendChild(h);
      var drop = el('div', 'st-drop'); drop.dataset.section = sec.id;
      fields().filter(function (f) { return f.section === sec.id && !f.deleted; }).forEach(function (f) { drop.appendChild(block(f, !!badKeys[f.key])); });
      box.appendChild(drop); host.appendChild(box);
      if (window.Sortable) {
        Sortable.create(drop, { group: 'fields', handle: '.grip', animation: 140, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', fallbackOnBody: true, onEnd: readLayout });
      }
    });
    renderDeleted();
    $('layout').parentNode.scrollTop = keepScroll ? top : $('layout').parentNode.scrollTop;
  }
  function block(f, bad) {
    var b = el('div', 'st-f' + (f.width === 'half' ? ' half' : '') + (f.key === S.sel ? ' sel' : '') + (f.hidden ? ' hid' : '') + (f.showWhen ? ' cond' : '') + (bad ? ' bad' : ''));
    b.dataset.key = f.key; b.tabIndex = 0;
    var g = el('span', 'grip', '⋮⋮'); g.title = 'Drag to move'; b.appendChild(g);
    b.appendChild(el('span', 'nm', f.label || f.key)); if (f.required) b.appendChild(el('span', 'req', '*')); b.appendChild(el('span', 'ty', TYPE_LABEL[f.type] || f.type));
    b.addEventListener('click', function () { selectField(f.key); }); b.addEventListener('keydown', function (e) { if (e.key === 'Enter') selectField(f.key); });
    return b;
  }
  /* after a drag: the DOM order is the truth. Rebuild the field array section by section. */
  function readLayout() {
    var next = [];
    document.querySelectorAll('#layout .st-drop').forEach(function (drop) {
      [].forEach.call(drop.querySelectorAll('.st-f'), function (b) { var f = byKey(b.dataset.key); if (f) { f.section = drop.dataset.section; next.push(f); } });
    });
    fields().filter(function (f) { return f.deleted; }).forEach(function (f) { next.push(f); });
    S.def.fields = next; changed();
  }
  function resort() { var idx = {}; S.def.sections.forEach(function (s, i) { idx[s.id] = i; }); S.def.fields = S.def.fields.map(function (f, i) { return [f, i]; }).sort(function (a, b) { return (idx[a[0].section] - idx[b[0].section]) || (a[1] - b[1]); }).map(function (x) { return x[0]; }); }
  function renderDeleted() {
    var del = fields().filter(function (f) { return f.deleted; }), box = $('deletedBox'), list = $('deletedList'); list.textContent = ''; box.hidden = !del.length;
    del.forEach(function (f) { var r = el('div', 'del'); r.appendChild(el('span', null, f.label)); r.appendChild(btn('Restore', 'sm', function () { delete f.deleted; changed(); selectField(f.key); })); list.appendChild(r); });
  }
  function selectField(key) { S.sel = key; renderLayout(true); renderField(); tab('field'); sendPreview(key); }
  function tab(name) { document.querySelectorAll('.tabs2 button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); }); $('tabField').hidden = name !== 'field'; $('tabText').hidden = name !== 'text'; }

  /* ---------- add / duplicate / delete ---------- */
  function defaults(type) {
    var base = { type: type, width: 'full', required: false };
    if (CHOICE[type]) base.options = [{ value: 'Option 1', label: 'Option 1' }, { value: 'Option 2', label: 'Option 2' }];
    if (type === 'select') base.placeholder = 'Select one';
    if (type === 'consent') base.required = true;
    return base;
  }
  function addField(type, sectionId) {
    if (fields().length >= (S.limits.fields || 60)) { toast('A form can have at most ' + S.limits.fields + ' fields.', true); return; }
    var label = TYPE_LABEL[type] === 'Consent' ? 'I agree to be contacted' : 'New ' + TYPE_LABEL[type].toLowerCase();
    var f = Object.assign({ key: newKey(label), label: label, section: sectionId || S.def.sections[S.def.sections.length - 1].id }, defaults(type));
    var last = -1; fields().forEach(function (x, i) { if (x.section === f.section) last = i; });
    S.def.fields.splice(last + 1 || S.def.fields.length, 0, f); changed(); selectField(f.key);
  }
  function deleteField(f) {
    if (S.sel === f.key) S.sel = null;
    if (isLocked(f)) f.deleted = true; else S.def.fields.splice(S.def.fields.indexOf(f), 1);     // never published: just remove it; published: keep it (hidden) so old answers keep their field
    S.def.fields.forEach(function (x) { if (x.showWhen && x.showWhen.field === f.key) delete x.showWhen; });
    changed(); renderField();
  }

  /* ---------- field settings ---------- */
  function renderField() {
    var host = $('tabField'); host.textContent = '';
    var f = S.sel && byKey(S.sel);
    if (!f || f.deleted) { host.appendChild(el('p', 'empty-s', 'Select a field in the layout to change its label, rules and options.')); return; }
    var locked = isLocked(f), edit = function (fn) { return function (v) { fn(v); changed({ noRender: false, focus: f.key }); }; }, soft = function (fn) { return function (v) { fn(v); changed({ noRender: true, focus: f.key }); updateBlock(f); }; };
    host.appendChild(fld('Label', input(f.label, soft(function (v) { f.label = v; }), { max: 120 })));
    var tsel = select(ADDABLE.concat(['phone']).filter(function (t, i, a) { return a.indexOf(t) === i && (t !== 'phone' || f.type === 'phone'); }).map(function (t) { return [t, TYPE_LABEL[t]]; }), f.type, edit(function (v) { f.type = v; if (CHOICE[v] && !(f.options && f.options.length)) f.options = defaults(v).options; renderField(); }));
    tsel.disabled = locked; host.appendChild(fld('Type', tsel, locked ? 'Published fields keep their type. To change it, add a new field and delete this one.' : null));
    if (f.type !== 'phone' || true) host.appendChild(fld('Required', check(f.required, edit(function (v) { f.required = v; })), null, true));
    host.appendChild(fld('Hide from the form (keep the field)', check(f.hidden, edit(function (v) { if (v) f.hidden = true; else delete f.hidden; })), null, true));
    var row = el('div', 'row2');
    row.appendChild(fld('Width', select([['full', 'Full'], ['half', 'Half']], f.width, edit(function (v) { f.width = v; }))));
    row.appendChild(fld('Section', select(S.def.sections.map(function (s) { return [s.id, s.title]; }), f.section, edit(function (v) { f.section = v; resort(); }))));
    host.appendChild(row);
    if (f.type !== 'checkbox' && f.type !== 'consent' && f.type !== 'radio' && f.type !== 'multiselect') host.appendChild(fld('Placeholder', input(f.placeholder, soft(function (v) { if (v.trim()) f.placeholder = v; else delete f.placeholder; }), { max: 200 })));
    host.appendChild(fld('Help text under the field', input(f.help, soft(function (v) { if (v.trim()) f.help = v; else delete f.help; }), { max: 400 })));
    if (CHOICE[f.type]) host.appendChild(optionsEditor(f, edit));
    if (f.type === 'radio') {
      host.appendChild(fld('Style', select([['pills', 'Pills'], ['cards', 'Cards with description']], (f.ui && f.ui.variant) || 'pills', edit(function (v) { f.ui = f.ui || {}; f.ui.variant = v; }))));
      if (!f.ui || f.ui.variant !== 'cards') host.appendChild(fld('Columns (pills)', select([['', 'Flow'], ['4', '4 across']], f.ui && f.ui.cols ? String(f.ui.cols) : '', edit(function (v) { f.ui = f.ui || {}; if (v) f.ui.cols = +v; else delete f.ui.cols; }))));
    }
    if (f.type === 'text' || f.type === 'textarea' || f.type === 'email' || f.type === 'url' || f.type === 'number') {
      var r2 = el('div', 'row2');
      var mn = input(f.minLength, edit(function (v) { if (v === '') delete f.minLength; else f.minLength = parseInt(v, 10); }), { max: 4 }), mx = input(f.maxLength, edit(function (v) { if (v === '') delete f.maxLength; else f.maxLength = parseInt(v, 10); }), { max: 4 });
      r2.appendChild(fld('Min characters', mn)); r2.appendChild(fld('Max characters', mx)); host.appendChild(r2);
      if (f.type === 'text') host.appendChild(fld('Allowed characters', select([['', 'Anything']].concat(S.patterns.map(function (p) { return [p, { digits: 'Digits only', letters: 'Letters only', alphanumeric: 'Letters and numbers', pincode: '6-digit PIN code' }[p] || p]; })), f.pattern || '', edit(function (v) { if (v) f.pattern = v; else delete f.pattern; }))));
    }
    host.appendChild(el('div', 'lbl', 'Messages shown to the visitor'));
    host.appendChild(fld('When it is missing', input(f.messages && f.messages.required, soft(function (v) { f.messages = f.messages || {}; if (v.trim()) f.messages.required = v; else delete f.messages.required; }), { max: 200, ph: 'Enter ' + (f.label || '').toLowerCase() })));
    host.appendChild(fld('When it is not valid', input(f.messages && f.messages.invalid, soft(function (v) { f.messages = f.messages || {}; if (v.trim()) f.messages.invalid = v; else delete f.messages.invalid; }), { max: 200 })));
    host.appendChild(showWhenEditor(f, edit));
    var ops = el('div', 'fs-row');
    ops.appendChild(btn('Duplicate', '', function () { var c = clone(f); delete c.column; delete c.system; c.label = f.label + ' (copy)'; c.key = newKey(f.label + ' copy'); S.def.fields.splice(S.def.fields.indexOf(f) + 1, 0, c); changed(); selectField(c.key); }));
    if (!f.system) ops.appendChild(btn('Delete field', 'ghost-danger', function () { KnoaUI.confirm({ title: 'Delete "' + f.label + '"?', message: locked ? 'It disappears from the form. Answers already collected stay in the leads and exports.' : 'It has never been published, so it is removed completely.', ok: 'Delete' }).then(function (y) { if (y) deleteField(f); }); }));
    else ops.appendChild(el('span', 'lock', 'The phone number field is required by the system (it identifies a lead) and cannot be deleted.'));
    host.appendChild(ops);
    host.appendChild(el('p', 'lock', 'Key: ' + f.key + (f.column ? ' · stored in the "' + f.column + '" column' : ' · stored with the lead as a custom answer')));
  }
  function updateBlock(f) { var b = document.querySelector('.st-f[data-key="' + f.key + '"] .nm'); if (b) b.textContent = f.label || f.key; }
  function optionsEditor(f, edit) {
    var w = el('div', 'fld'); w.appendChild(el('div', 'lbl', 'Options'));
    var list = el('div');
    function draw() {
      list.textContent = '';
      (f.options || []).forEach(function (o, i) {
        var r = el('div', 'opt-row');
        var lab = input(o.label, function (v) { var same = o.value === o.label; o.label = v; if (same && !isLocked(f)) o.value = v; changed({ noRender: true, focus: f.key }); }, { max: 120 }); lab.setAttribute('aria-label', 'Option label');
        var sub = input(o.sub, function (v) { if (v.trim()) o.sub = v; else delete o.sub; changed({ noRender: true, focus: f.key }); }, { max: 160, ph: f.ui && f.ui.variant === 'cards' ? 'Description' : 'Description (cards)' });
        r.appendChild(lab); r.appendChild(sub);
        var u = btn('↑', '', function () { if (i > 0) { f.options.splice(i - 1, 0, f.options.splice(i, 1)[0]); changed({ focus: f.key }); draw(); } });
        var d = btn('↓', '', function () { if (i < f.options.length - 1) { f.options.splice(i + 1, 0, f.options.splice(i, 1)[0]); changed({ focus: f.key }); draw(); } });
        var x = btn('✕', '', function () { f.options.splice(i, 1); changed({ focus: f.key }); draw(); });
        [u, d, x].forEach(function (b) { b.className = ''; b.type = 'button'; r.appendChild(b); }); list.appendChild(r);
      });
    }
    draw(); w.appendChild(list);
    w.appendChild(btn('Add option', 'sm', function () { var n = (f.options || []).length + 1; f.options = f.options || []; f.options.push({ value: 'Option ' + n, label: 'Option ' + n }); changed({ focus: f.key }); draw(); }));
    w.appendChild(el('div', 'hint', 'The text of an option is what is saved with the lead.'));
    return w;
  }
  /* show only when another field has a value. The controlling field must be ABOVE this one (the server checks it too). */
  function showWhenEditor(f, edit) {
    var w = el('div', 'fld'); w.appendChild(el('div', 'lbl', 'Show this field only when…'));
    var idx = fields().indexOf(f), above = fields().filter(function (x, i) { return i < idx && !x.deleted && CHOICE[x.type] && x.options; });
    var cur = f.showWhen || null;
    var fsel = select([['', 'Always show']].concat(above.map(function (x) { return [x.key, x.label]; })), cur ? cur.field : '', edit(function (v) {
      if (!v) delete f.showWhen; else { var c = byKey(v); f.showWhen = { field: v, op: 'eq', value: c.options[0].value }; } renderField();
    }));
    w.appendChild(fsel);
    if (cur && byKey(cur.field)) {
      var c = byKey(cur.field);
      w.appendChild(select([['eq', 'is'], ['neq', 'is not'], ['in', 'is one of']], cur.op, edit(function (v) { cur.op = v; cur.value = v === 'in' ? [c.options[0].value] : c.options[0].value; renderField(); })));
      if (cur.op === 'in') {
        var box = el('div', 'chips'); c.options.forEach(function (o) { var l = el('label', 'check'); var cb = check((cur.value || []).indexOf(o.value) >= 0, edit(function (v) { var a = cur.value || []; if (v && a.indexOf(o.value) < 0) a.push(o.value); if (!v) a = a.filter(function (x) { return x !== o.value; }); cur.value = a; })); l.appendChild(cb); l.appendChild(el('span', null, ' ' + o.label)); box.appendChild(l); }); w.appendChild(box);
      } else w.appendChild(select(c.options.map(function (o) { return [o.value, o.label]; }), cur.value, edit(function (v) { cur.value = v; })));
    } else if (!above.length) w.appendChild(el('div', 'hint', 'Add a choice field above this one to use it as a condition.'));
    return w;
  }

  /* ---------- form text ---------- */
  var TEXTS = [['headline', 'Headline', 300, 'Use {name} for the master class and {type} for the type.'], ['subheadline', 'Sub-headline', 300], ['subheadlineNoName', 'Sub-headline when the link has no master class', 300], ['when', 'Date / time line (optional)', 300, 'Shown under the sub-headline. {date} uses this text.'], ['extra', 'Extra note (optional)', 300],
    ['typeLabel', 'What this is called ({type})', 40], ['button', 'Button label', 60], ['successTitle', 'Thank-you title', 300], ['success', 'Thank-you message', 300], ['fine', 'Small print under the button', 300], ['closedTitle', 'Closed title (paused form)', 300], ['closed', 'Closed message', 300]];
  function renderText() {
    var host = $('tabText'); host.textContent = ''; var c = S.def.copy = S.def.copy || {};
    TEXTS.forEach(function (t) {
      var long = t[2] > 100 && t[0] !== 'headline' && t[0] !== 'successTitle' && t[0] !== 'closedTitle';
      var node = long ? el('textarea', 'control') : el('input', 'control'); if (!long) node.type = 'text'; node.maxLength = t[2]; node.value = c[t[0]] || '';
      node.addEventListener('input', function () { c[t[0]] = node.value; changed({ noRender: true }); });
      node.addEventListener('focus', function () { if (t[0] === 'success' || t[0] === 'successTitle') { S.mode = 'success'; sendPreview(); } else if (t[0] === 'closed' || t[0] === 'closedTitle') { S.mode = 'closed'; sendPreview(); } else if (S.mode) { S.mode = null; sendPreview(); } });
      node.addEventListener('blur', function () { if (S.mode) { S.mode = null; sendPreview(); } });
      var w = fld(t[1], node, t[3]);
      if (t[0] === 'headline' || t[0] === 'subheadline') { var ch = el('div', 'chips'); ['{name}', '{type}', '{date}'].forEach(function (p) { var b = el('button', null, p); b.type = 'button'; b.addEventListener('click', function () { var s = node.selectionStart == null ? node.value.length : node.selectionStart; node.value = node.value.slice(0, s) + p + node.value.slice(node.selectionEnd == null ? s : node.selectionEnd); c[t[0]] = node.value; changed({ noRender: true }); node.focus(); }); ch.appendChild(b); }); w.appendChild(ch); }
      host.appendChild(w);
    });
  }

  /* ---------- dialogs ---------- */
  function toast(m, bad) { if (window.KnoaUI) KnoaUI.toast(m, bad); }
  function modal(title, build) {
    var root = $('modalRoot'), back = el('div', 'md-back'), md = el('div', 'md'); back.appendChild(md);
    var x = btn('Close', 'sm md-x', close); md.appendChild(x); md.appendChild(el('h2', null, title));
    function close() { back.remove(); document.removeEventListener('keydown', esc, true); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc, true); back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    root.appendChild(back); build(md, close); return close;
  }
  function changesList(changes) {
    var ul = el('ul', 'chg');
    (changes || []).forEach(function (c) {
      var t = c.kind === 'added' ? 'Added field "' + c.label + '"' : c.kind === 'removed' ? 'Removed field "' + c.label + '"' : c.kind === 'changed' ? 'Changed "' + c.label + '": ' + c.changes.join(', ') : 'Changed text: ' + c.changes.join(', ');
      ul.appendChild(el('li', null, t));
    });
    if (!ul.children.length) ul.appendChild(el('li', null, 'No visible changes.'));
    return ul;
  }
  function history() {
    modal('History', function (md, close) {
      md.appendChild(el('p', 'muted', 'Every publish is saved. "Edit this version" copies it into your draft; "Make live" switches the public form to it straight away.'));
      var list = el('div'); md.appendChild(list); list.appendChild(el('p', 'muted', 'Loading…'));
      api('GET', '/admin/api/forms/' + FORM_ID + '/versions').then(function (j) {
        list.textContent = '';
        j.versions.forEach(function (v) {
          var r = el('div', 'ver'); r.appendChild(el('div', 'v', 'v' + v.version));
          var mid = el('div'); var t = el('div'); t.appendChild(document.createTextNode((v.note || 'No note') + ' ')); if (v.live) t.appendChild(el('span', 'chip active', 'live')); mid.appendChild(t);
          mid.appendChild(el('div', 'nt', (v.author || 'system') + ' · ' + new Date(v.created_at).toLocaleString() + ' · ' + v.leads + ' registrations'));
          var det = el('div'); mid.appendChild(det);
          var a = el('div', 'fs-row');
          a.appendChild(btn('What changed', 'sm', function () { api('GET', '/admin/api/forms/' + FORM_ID + '/versions/' + v.version).then(function (d) { det.textContent = ''; det.appendChild(changesList(d.changes)); }, function (e) { toast(e.message, true); }); }));
          a.appendChild(btn('Edit this version', 'sm', function () { api('POST', '/admin/api/forms/' + FORM_ID + '/restore', { version: v.version }).then(function (r) { S.def = r.working; S.sel = null; S.form.has_draft = true; close(); boot2(); toast('Version ' + v.version + ' is in your draft. Publish it when ready.'); }, function (e) { toast(e.message, true); }); }));
          if (!v.live) a.appendChild(btn('Make live', 'sm', function () { KnoaUI.confirm({ title: 'Make version ' + v.version + ' live?', message: 'Visitors see it immediately. Your draft is not changed.', ok: 'Make live' }).then(function (y) { if (y) api('POST', '/admin/api/forms/' + FORM_ID + '/rollback', { version: v.version }).then(function () { S.form.published_version = v.version; header(); close(); toast('Version ' + v.version + ' is live'); }, function (e) { toast(e.message, true); }); }); }));
          r.appendChild(mid); r.appendChild(a); list.appendChild(r);
        });
      }, function (e) { list.textContent = e.message; });
    });
  }
  function links() {
    modal('Links & QR', function (md) {
      md.appendChild(el('p', 'muted', 'Make a tagged link for this form, copy it or print its QR code. Links are saved here so you can find them again.'));
      var host = el('div'); md.appendChild(host); host.textContent = 'Loading…';
      api('GET', '/admin/api/forms/' + FORM_ID + '/links').then(function (j) {
        host.textContent = '';
        var gen = el('div', 'gen');
        var plat = select(j.platforms.map(function (p) { return [p.id, p.label]; }), 'meta', function () { var p = j.platforms.filter(function (x) { return x.id === plat.value; })[0]; if (p && j.mediums.indexOf(p.medium) >= 0) med.value = p.medium; });
        var med = select(j.mediums.map(function (m) { return [m, m]; }), 'paid', function () {});
        /* only a campaign that was added in the Campaigns tab AND is running can be used: a new campaign is never made here */
        var running = j.campaigns.filter(function (c) { return c.status === 'active'; });
        var camp = select(running.map(function (c) { return [String(c.id), c.name]; }), running.length ? String(running[0].id) : '', function () {});
        var label = input('', function () {}, { max: 80, ph: 'Label (optional)' });
        gen.appendChild(fld('Where the ad runs', plat)); gen.appendChild(fld('Medium', med));
        if (running.length) gen.appendChild(fld('Running campaign', camp));
        else { var none = el('p', 'muted', 'No campaign is running for this form. Add one in the Campaigns tab and start it, then come back to make a link.'); var go = el('a', 'kbtn sm', 'Open Campaigns'); go.href = '/admin/campaigns'; none.appendChild(document.createTextNode(' ')); none.appendChild(go); gen.appendChild(none); }
        gen.appendChild(fld('Label', label));
        var msg = el('div', 'form-error'); msg.hidden = true; gen.appendChild(msg);
        var mk = btn('Create link', 'primary', function () {
          api('POST', '/admin/api/forms/' + FORM_ID + '/links', { platform: plat.value, medium: med.value, campaign_id: camp.value || null, label: label.value }).then(function () { msg.hidden = true; links.close && links.close(); document.querySelectorAll('.md-back').forEach(function (n) { n.remove(); }); links(); }, function (e) { msg.textContent = e.message; msg.hidden = false; });
        });
        if (!running.length) mk.disabled = true;
        gen.appendChild(mk);
        host.appendChild(gen);
        host.appendChild(el('p', 'muted', 'Base link (forwards to the active campaign, if any): ' + j.base));
        j.links.forEach(function (l) {
          var r = el('div', 'lnk'); r.appendChild(el('strong', null, l.label)); r.appendChild(el('code', null, l.url));
          var a = el('div', 'fs-row'); a.appendChild(btn('Copy link', 'sm', function () { KnoaUI.copy(l.url).then(function () { toast('Link copied'); }, function () {}); })); a.appendChild(btn('QR code', 'sm', function () { if (window.KnoaQR) KnoaQR.open(l.url, l.label); }));
          a.appendChild(btn('Delete', 'sm ghost-danger', function () { api('DELETE', '/admin/api/forms/' + FORM_ID + '/links/' + l.id).then(function () { r.remove(); }, function (e) { toast(e.message, true); }); })); r.appendChild(a); host.appendChild(r);
        });
        if (!j.links.length) host.appendChild(el('p', 'muted', 'No saved links yet.'));
      }, function (e) { host.textContent = e.message; });
    });
  }
  function publish() {
    if (S.dirty) { clearTimeout(S.timer); }
    save().then(function () {
      if (S.problems.length) { renderProblems(); toast('Fix the problems first.', true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      modal('Publish', function (md, close) {
        md.appendChild(el('p', 'muted', 'This becomes the live form for ' + S.form.name + ' as soon as you publish. The previous version stays in the history.'));
        if (S.published) { var diff = changesSince(); md.appendChild(el('strong', null, 'What is different from the live form')); md.appendChild(changesList(diff)); }
        var note = el('input', 'control'); note.type = 'text'; note.maxLength = 200; note.placeholder = 'Note for the history (optional)'; md.appendChild(fld('Note', note));
        var msg = el('div', 'form-error'); msg.hidden = true; md.appendChild(msg);
        var go = btn('Publish now', 'primary', function () {
          go.disabled = true;
          api('POST', '/admin/api/forms/' + FORM_ID + '/publish', { note: note.value }).then(function (r) {
            close(); S.form.published_version = r.version; S.form.has_draft = false; S.form.status = S.form.status === 'draft' ? 'active' : S.form.status; S.published = clone(S.def); header(); setSave(r.unchanged ? 'Nothing changed' : 'Published version ' + r.version); toast(r.unchanged ? 'Nothing to publish' : 'Published version ' + r.version);
          }, function (e) { go.disabled = false; msg.textContent = e.message + (e.body && e.body.problems ? ': ' + e.body.problems.join(' ') : ''); msg.hidden = false; });
        });
        md.appendChild(go);
      });
    });
  }
  function changesSince() {
    var A = {}, out = []; S.published.fields.forEach(function (f) { A[f.key] = f; });
    S.def.fields.forEach(function (f) { var o = A[f.key]; if (!o) { if (!f.deleted) out.push({ kind: 'added', label: f.label }); return; } if (!o.deleted && f.deleted) { out.push({ kind: 'removed', label: o.label }); return; } var ch = []; ['label', 'required', 'hidden', 'width', 'placeholder', 'help', 'section', 'pattern', 'minLength', 'maxLength'].forEach(function (k) { if (JSON.stringify(o[k] == null ? null : o[k]) !== JSON.stringify(f[k] == null ? null : f[k])) ch.push(k); }); if (JSON.stringify(o.options || null) !== JSON.stringify(f.options || null)) ch.push('options'); if (JSON.stringify(o.showWhen || null) !== JSON.stringify(f.showWhen || null)) ch.push('show-when rule'); if (!f.deleted && ch.length) out.push({ kind: 'changed', label: f.label, changes: ch }); });
    var ch2 = []; Object.keys(Object.assign({}, S.published.copy, S.def.copy)).forEach(function (k) { if (((S.published.copy || {})[k] || '') !== ((S.def.copy || {})[k] || '')) ch2.push(k); }); if (ch2.length) out.push({ kind: 'text', changes: ch2 });
    return out;
  }

  /* ---------- start ---------- */
  function boot2() { renderLayout(); renderField(); renderText(); renderProblems(); header(); sendPreview(); }
  function boot() {
    api('GET', '/admin/api/me').then(function (m) { $('who').textContent = m.username; }, function () {});
    $('logout').addEventListener('click', function () { api('POST', '/admin/api/logout', {}).then(function () { location.href = '/admin/login'; }); });
    api('GET', '/admin/api/forms/' + FORM_ID).then(function (j) {
      S.form = j.form; S.def = j.working; S.published = j.published ? clone(j.published.definition) : null; S.problems = j.problems || []; S.limits = j.limits; S.patterns = j.patterns; S.def.sections = S.def.sections || [];
      var sel = $('addType'); ADDABLE.forEach(function (t) { var o = el('option', null, TYPE_LABEL[t]); o.value = t; sel.appendChild(o); });
      $('btnAddField').addEventListener('click', function () { addField($('addType').value); });
      $('btnAddSection').addEventListener('click', function () { var n = S.def.sections.length + 1, id = 'section_' + String.fromCharCode(96 + n); while (S.def.sections.some(function (s) { return s.id === id; })) id += 'x'; S.def.sections.push({ id: id, title: 'Section ' + n }); changed(); });
      $('btnHistory').addEventListener('click', history); $('btnLinks').addEventListener('click', links); $('btnPublish').addEventListener('click', publish);
      $('btnDiscard').addEventListener('click', function () { KnoaUI.confirm({ title: 'Discard your changes?', message: 'The draft goes back to the live version. Published versions are not affected.', ok: 'Discard' }).then(function (y) { if (y) api('DELETE', '/admin/api/forms/' + FORM_ID + '/draft').then(function (r) { S.def = r.working; S.sel = null; S.form.has_draft = false; S.problems = []; setSave('Draft discarded'); boot2(); }, function (e) { toast(e.message, true); }); }); });
      document.querySelectorAll('.tabs2 button').forEach(function (b) { b.addEventListener('click', function () { tab(b.dataset.tab); }); });
      document.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { document.querySelectorAll('.seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); var fr = $('preview'), w = +b.dataset.w; fr.classList.toggle('full', !w); fr.style.width = w ? w + 'px' : ''; }); });
      window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
      $('preview').src = '/admin/forms/' + FORM_ID + '/preview';
      setSave(S.form.has_draft ? 'Draft loaded' : 'Up to date'); boot2();
      window.__studio = S;                                           // for tests and support: read-only inspection
    }, function (e) { document.querySelector('main.st').textContent = e.message; });
  }
  boot();
})();
