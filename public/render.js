/* KnoaForm: draws the registration form from a form definition (Form Studio) and checks answers in the browser.
   Used by the public page (register.js), the Form Studio live preview and the tests (loaded in Node too).
   The server stays the authority: src/formdef.js validateSubmission() checks every submission again. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KnoaForm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ARROW = '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>';
  var LEGACY_IDS = { first_name: 'f-fn', last_name: 'f-ln', phone: 'f-ph', email: 'f-em', status: 'f-st', student_course: 'f-sc', student_status: 'f-ss', college_name: 'f-cn',
    specialization: 'f-sp', experience: 'f-xp', current_role: 'f-cr', current_company: 'f-cc', highest_qualification: 'f-hq' };
  var PATTERNS = {
    digits: [/^\d+$/, 'Use digits only'],
    letters: [/^[\p{L} .'-]+$/u, 'Use letters only'],
    alphanumeric: [/^[\p{L}\p{N} ._-]+$/u, 'Use letters and numbers only'],
    pincode: [/^\d{6}$/, 'Enter a 6-digit PIN code']
  };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, URL_RE = /^https?:\/\/[^\s]{3,}$/i, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var CHOICE = { select: 1, radio: 1, multiselect: 1 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function idOf(f) { return LEGACY_IDS[f.key] || 'f-' + f.key; }
  function err(k) { return '<div class="err" data-err="' + esc(k) + '"></div>'; }
  function visibleFields(def) {
    return (def.fields || []).filter(function (f) { return !f.deleted && !f.hidden; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  /* ---------- show-when ---------- */
  function isShown(f, values) {
    var w = f.showWhen;
    if (!w) return true;
    var v = values[w.field];
    if (w.op === 'eq') return v === w.value;
    if (w.op === 'neq') return v !== w.value;
    if (w.op === 'in') return Array.isArray(w.value) && w.value.indexOf(v) !== -1;
    return true;
  }

  /* ---------- markup ---------- */
  function labelHTML(f, tag, forId) {
    var mark = f.required ? ' <i>*</i>' : (f.type === 'consent' || f.type === 'checkbox' ? '' : ' <small>(optional)</small>');
    var text = esc(f.label) + mark;
    return tag === 'label' ? '<label for="' + forId + '">' + text + '</label>' : '<span class="lbl" id="' + forId + '">' + text + '</span>';
  }
  function attrs(f, extra) {
    var a = '';
    if (f.ui && f.ui.autocomplete) a += ' autocomplete="' + esc(f.ui.autocomplete) + '"';
    if (f.placeholder) a += ' placeholder="' + esc(f.placeholder) + '"';
    return a + (extra || '');
  }
  function pill(name, value, label, type) {
    return '<label class="opt"><input type="' + (type || 'radio') + '" name="' + esc(name) + '" value="' + esc(value) + '"><span>' + esc(label == null ? value : label) + '</span></label>';
  }
  function controlHTML(f, ctx, cls) {
    var id = idOf(f), ml = Math.min(f.maxLength || (f.type === 'textarea' ? 1000 : 200), 2000);
    var help = f.help ? '<p class="help">' + esc(f.help) + '</p>' : '';
    switch (f.type) {
      case 'phone': {
        var cf = (f.ui && f.ui.countryField) || 'country';
        return '<div class="' + cls + '">' + labelHTML(f, 'label', id) +
          '<div class="phone"><select class="control" name="' + esc(cf) + '" aria-label="Country code">' +
          (ctx.countries || []).map(function (c) { return '<option value="' + esc(c.c) + '">' + (c.other ? 'Other' : esc(c.c + ' ' + c.d)) + '</option>'; }).join('') + '</select>' +
          '<input class="control" id="' + id + '" name="' + esc(f.key) + '" type="tel" inputmode="tel"' + attrs(f) + ' maxlength="' + ml + '"></div>' + help + err(f.key) + '</div>';
      }
      case 'select':
        return '<div class="' + cls + '">' + labelHTML(f, 'label', id) +
          '<select class="control placeholder" id="' + id + '" name="' + esc(f.key) + '"><option value="">' + esc(f.placeholder || 'Select one') + '</option>' +
          (f.options || []).map(function (o) { return (o.value === o.label ? '<option>' : '<option value="' + esc(o.value) + '">') + esc(o.label) + '</option>'; }).join('') + '</select>' + help + err(f.key) + '</div>';
      case 'radio':
        if (f.ui && f.ui.variant === 'cards') {
          return '<div class="' + cls + '" role="group" aria-labelledby="' + id + '">' + labelHTML(f, 'span', id) + '<div class="choices">' +
            (f.options || []).map(function (o) {
              return '<label class="choice"><input type="radio" name="' + esc(f.key) + '" value="' + esc(o.value) + '"><span class="choice-body"><span class="dot"></span><span><span class="choice-title">' +
                esc(o.label) + '</span>' + (o.sub ? '<span class="choice-sub">' + esc(o.sub) + '</span>' : '') + '</span></span></label>';
            }).join('') + '</div>' + help + err(f.key) + '</div>';
        }
        return '<div class="' + cls + '" role="group" aria-labelledby="' + id + '">' + labelHTML(f, 'span', id) + '<div class="opts' + (f.ui && f.ui.cols === 4 ? ' cols4' : '') + '">' +
          (f.options || []).map(function (o) { return pill(f.key, o.value, o.label); }).join('') + '</div>' + help + err(f.key) + '</div>';
      case 'multiselect':
        return '<div class="' + cls + '" role="group" aria-labelledby="' + id + '">' + labelHTML(f, 'span', id) + '<div class="opts">' +
          (f.options || []).map(function (o) { return pill(f.key, o.value, o.label, 'checkbox'); }).join('') + '</div>' + help + err(f.key) + '</div>';
      case 'checkbox': case 'consent':
        return '<div class="' + cls + '"><label class="check" for="' + id + '"><input type="checkbox" id="' + id + '" name="' + esc(f.key) + '" value="true"><span>' + esc(f.label) + (f.required ? ' <i>*</i>' : '') + '</span></label>' + help + err(f.key) + '</div>';
      case 'textarea':
        return '<div class="' + cls + '">' + labelHTML(f, 'label', id) + '<textarea class="control area" id="' + id + '" name="' + esc(f.key) + '" rows="4"' + attrs(f) + ' maxlength="' + ml + '"></textarea>' + help + err(f.key) + '</div>';
      default: {
        var type = { email: 'email', url: 'url', number: 'text', date: 'date' }[f.type] || 'text';
        var inputmode = f.type === 'number' ? ' inputmode="decimal"' : '';
        return '<div class="' + cls + '">' + labelHTML(f, 'label', id) + '<input class="control" id="' + id + '" name="' + esc(f.key) + '" type="' + type + '"' + inputmode + attrs(f) + ' maxlength="' + ml + '">' + help + err(f.key) + '</div>';
      }
    }
  }

  /** Heading: the master class name is highlighted when the headline contains it. */
  function headingHTML(copy, name) {
    var h = String((copy && copy.headline) || '');
    if (name) { var i = h.indexOf(name); if (i >= 0) return esc(h.slice(0, i)) + '<span class="accent">' + esc(name) + '</span>' + esc(h.slice(i + name.length)); }
    return esc(h);
  }

  /**
   * @param def  public definition (deleted fields already removed is fine, they are skipped anyway)
   * @param ctx  { copy:{headline,subheadline,extra,when}, name, countries, button, fine }
   * @returns { html, rules } rules[i] = showWhen of the i-th conditional panel (matched by order in the DOM)
   */
  function formHTML(def, ctx) {
    var copy = ctx.copy || {}, fields = visibleFields(def), rules = [], out = [], sections = {};
    (def.sections || []).forEach(function (s) { sections[s.id] = s; });
    var lastSection = null, i = 0;
    function row(f, cls) { return controlHTML(f, ctx, cls); }
    function block(list, cls) {                       // consecutive half-width fields share one row
      var html = '', j = 0;
      while (j < list.length) {
        var f = list[j];
        var head = (f.ui && f.ui.divider ? '<hr class="divider">' : '');
        if (f.width === 'half' && list[j + 1] && list[j + 1].width === 'half' && !(list[j + 1].ui && list[j + 1].ui.divider)) {
          html += head + '<div class="grid2">' + row(f, cls) + row(list[j + 1], cls) + '</div>'; j += 2;
        } else if (f.width === 'half') { html += head + '<div class="grid2">' + row(f, cls) + '</div>'; j += 1; }
        else { html += head + row(f, cls); j += 1; }
      }
      return html;
    }
    while (i < fields.length) {
      var f = fields[i], key = JSON.stringify(f.showWhen || null), run = [f], k = i + 1;
      while (k < fields.length && JSON.stringify(fields[k].showWhen || null) === key && fields[k].section === f.section) { run.push(fields[k]); k++; }
      var sec = sections[f.section];
      if (f.section !== lastSection) { if (sec && sec.showTitle) out.push('<h2 class="sec">' + esc(sec.title) + '</h2>'); lastSection = f.section; }
      if (f.showWhen) {
        var w = f.showWhen, label = w.op === 'eq' ? String(w.value) : 'rule:' + rules.length;
        rules.push(w);
        out.push('<div class="panel" data-panel="' + esc(label) + '" hidden>' + block(run, 'sub-field') + '</div>');
      } else out.push(block(run, 'field'));
      i = k;
    }
    var html = '<h1 id="formTitle">' + headingHTML(copy, ctx.name) + '</h1>' +
      '<p class="sub">' + esc(copy.subheadline || '') + '</p>' +
      (copy.when ? '<p class="when">' + esc(copy.when) + '</p>' : '') +
      (copy.extra ? '<p class="extra">' + esc(copy.extra) + '</p>' : '') +
      '<form class="lead-form" novalidate autocomplete="on">' + out.join('') +
      '<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="form-error" role="alert" hidden></div>' +
      '<button class="btn" type="submit"><span class="label">' + esc(ctx.button || 'Register now') + '</span><span class="orb"><span class="spin"></span>' + ARROW + '</span></button>' +
      '<p class="fine">' + esc(ctx.fine || '') + '</p></form>';
    return { html: html, rules: rules };
  }

  function successHTML(ctx) {
    return '<div class="success" role="status"><div class="tick"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div><h2>' + esc(ctx.successTitle || 'Thank you for registering!') + '</h2><p>' + esc(ctx.success || '') + '</p></div>';
  }
  function closedHTML(ctx) {
    return '<div class="success" role="status"><h2>' + esc(ctx.closedTitle || 'Registrations are closed') + '</h2><p>' + esc(ctx.closedText || 'This master class is not taking registrations right now. Please check back later.') + '</p></div>';
  }

  /* ---------- answers ---------- */
  function readValues(def, form) {
    var v = {}, FD = (form.ownerDocument && form.ownerDocument.defaultView && form.ownerDocument.defaultView.FormData) || FormData, fd = new FD(form);
    visibleFields(def).forEach(function (f) {
      if (f.type === 'multiselect') v[f.key] = fd.getAll(f.key);
      else if (f.type === 'checkbox' || f.type === 'consent') v[f.key] = fd.get(f.key) === 'true';
      else { var x = fd.get(f.key); v[f.key] = typeof x === 'string' ? x : ''; }
      if (f.type === 'phone') { var cf = (f.ui && f.ui.countryField) || 'country'; v[cf] = fd.get(cf) || ''; }
    });
    return v;
  }

  function normalizePhone(country, raw) {
    var digits = String(raw || '').replace(/[\s\-()]/g, '');
    if (country.other && digits.charAt(0) === '+') digits = digits.slice(1); else digits = digits.replace(/^\+/, '');
    if (!country.other) {
      var code = country.d.slice(1);
      if (digits.indexOf(code) === 0 && digits.length > code.length + 6) digits = digits.slice(code.length);
      digits = digits.replace(/^0+/, '');
    }
    return digits;
  }
  function defaultMsg(f, kind) {
    return kind === 'required' ? ((CHOICE[f.type] || f.type === 'consent' || f.type === 'checkbox' ? 'Select ' : 'Enter ') + f.label.toLowerCase()) : f.label + ' is not valid';
  }

  /** Same rules as src/formdef.js validateSubmission (parity is tested). Returns { errors } keyed by field key. */
  function validate(def, values, countries) {
    var errors = {}, shown = {};
    function msg(f, kind) { return (f.messages && f.messages[kind]) || defaultMsg(f, kind); }
    visibleFields(def).forEach(function (f) {
      if (!isShown(f, shown)) { shown[f.key] = undefined; return; }
      var raw = values[f.key], req = !!f.required, val = null;
      if (f.type === 'phone') {
        var cf = (f.ui && f.ui.countryField) || 'country';
        var list = countries || [], country = list.filter(function (c) { return c.c === values[cf]; })[0] || list[0] || { c: '', d: '+0', re: '.*', hint: '' };
        var digits = normalizePhone(country, raw);
        if (!digits) { if (req) errors[f.key] = msg(f, 'required'); }
        else if (!new RegExp(country.re).test(digits)) errors[f.key] = 'Enter a valid number: ' + country.hint;
        else val = digits;
      } else if (f.type === 'multiselect') {
        var arr = Array.isArray(raw) ? raw.filter(Boolean) : [], allowed = (f.options || []).map(function (o) { return o.value; });
        if (arr.some(function (x) { return allowed.indexOf(x) === -1; })) errors[f.key] = msg(f, 'invalid');
        else if (req && !arr.length) errors[f.key] = msg(f, 'required'); else val = arr.length ? arr : null;
      } else if (f.type === 'checkbox' || f.type === 'consent') {
        var on = raw === true || raw === 'true' || raw === 'on';
        if (req && !on) errors[f.key] = msg(f, 'required'); else val = on;
      } else {
        var s = typeof raw === 'string' ? raw.trim().slice(0, Math.min(f.maxLength || (f.type === 'textarea' ? 1000 : 200), 2000)) : '';
        if (!s) { if (req) errors[f.key] = msg(f, 'required'); }
        else if (f.type === 'email' && !EMAIL_RE.test(s)) errors[f.key] = msg(f, 'invalid');
        else if (f.type === 'url' && !URL_RE.test(s)) errors[f.key] = msg(f, 'invalid');
        else if (f.type === 'date' && (!DATE_RE.test(s) || isNaN(Date.parse(s)))) errors[f.key] = msg(f, 'invalid');
        else if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(s)) errors[f.key] = msg(f, 'invalid');
        else if ((f.type === 'select' || f.type === 'radio') && !(f.options || []).some(function (o) { return o.value === s; })) errors[f.key] = req ? msg(f, 'required') : msg(f, 'invalid');
        else if (f.minLength && s.length < f.minLength) errors[f.key] = 'Enter at least ' + f.minLength + ' characters';
        else if (f.pattern && PATTERNS[f.pattern] && !PATTERNS[f.pattern][0].test(s)) errors[f.key] = PATTERNS[f.pattern][1];
        else val = s;
      }
      shown[f.key] = val;
    });
    return { errors: errors };
  }

  function showErrors(f, errs) {
    f.querySelectorAll('[data-err]').forEach(function (el) {
      var k = el.dataset.err, msg = errs[k];
      el.textContent = msg || ''; el.classList.toggle('on', !!msg);
      var ctl = f.querySelector('[name="' + k + '"]');
      if (ctl && ctl.type !== 'radio' && ctl.type !== 'checkbox') ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    var first = Object.keys(errs)[0];
    if (first) {
      var c = f.querySelector('[name="' + first + '"]');
      if (c && c.type !== 'radio' && c.type !== 'checkbox' && c.focus) c.focus({ preventScroll: true });
      var box = c && (c.closest('.field') || c.closest('.sub-field'));
      var target = box || c || f;
      if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /**
   * Draw the form into `host` and wire it up.
   * opts: { def, copy, name, countries, button, fine, successTitle, success, closed, onSubmit(values, done) , onEvent(type, detail) }
   * onSubmit gets the answers and returns a promise resolving to { ok, errors?, error? }.
   */
  function mount(host, opts) {
    var def = opts.def;
    if (opts.isClosed === true) { if (!host.querySelector('.success')) host.innerHTML = closedHTML(opts); return { form: null, destroy: function () {} }; }
    var built = formHTML(def, opts);
    // When the server already drew the form (data-ssr on the mount), the markup is identical to `built.html`:
    // keep it as it is so the first paint is not thrown away, and only wire the events onto it.
    if (!host.querySelector('form.lead-form')) host.innerHTML = built.html;
    var f = host.querySelector('form'), btn = f.querySelector('.btn'), label = btn.querySelector('.label'), banner = f.querySelector('.form-error');
    var panels = [].slice.call(f.querySelectorAll('.panel'));
    var emit = opts.onEvent || function () {}, started = false;

    function applyRules(clear) {
      var vals = readValues(def, f);
      // evaluate top-down: a panel hidden by an earlier panel hides what depends on it
      var shownVals = {};
      visibleFields(def).forEach(function (fl) { shownVals[fl.key] = vals[fl.key]; });
      panels.forEach(function (p, i) {
        var rule = built.rules[i], on = isShown({ showWhen: rule }, shownVals);
        var wasHidden = p.hidden; p.hidden = !on;
        if (!on && (clear !== false)) {
          p.querySelectorAll('input[type=radio],input[type=checkbox]').forEach(function (r) { r.checked = false; });
          p.querySelectorAll('input[type=text],input[type=email],input[type=url],input[type=date],textarea').forEach(function (t) { t.value = ''; });
          p.querySelectorAll('select').forEach(function (s) { s.value = ''; s.classList.add('placeholder'); });
          p.querySelectorAll('.err.on').forEach(function (x) { x.classList.remove('on'); });
          p.querySelectorAll('[name]').forEach(function (el) { if (shownVals[el.name] !== undefined) shownVals[el.name] = el.type === 'checkbox' ? false : ''; });
        }
        void wasHidden;
      });
    }
    f.addEventListener('change', function (ev) {
      applyRules();
      if (ev.target.tagName === 'SELECT') ev.target.classList.toggle('placeholder', !ev.target.value);
    });
    function clearErr(ev) {
      var el = ev.target, e = f.querySelector('[data-err="' + el.name + '"]');
      if (e && e.classList.contains('on')) { e.classList.remove('on'); el.removeAttribute('aria-invalid'); }
    }
    f.addEventListener('input', clearErr); f.addEventListener('change', clearErr);
    f.addEventListener('focusin', function (ev) {
      if (!started) { started = true; emit('form_start', {}); }
      if (ev.target && ev.target.name) emit('field_focus', { field: ev.target.name });
    });

    function fail(msg) { btn.disabled = false; btn.classList.remove('loading'); label.textContent = opts.button || 'Register now'; banner.textContent = msg; banner.hidden = false; }

    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (btn.disabled) return;
      banner.hidden = true;
      var values = readValues(def, f), trap = f.querySelector('[name="website"]');
      values.website = trap ? trap.value : '';
      var r = validate(def, values, opts.countries);
      showErrors(f, r.errors);
      if (Object.keys(r.errors).length) { emit('submit_invalid', { fields: Object.keys(r.errors).slice(0, 20) }); return; }
      btn.disabled = true; btn.classList.add('loading'); label.textContent = 'Sending…';
      emit('submit_attempt', {});
      Promise.resolve(opts.onSubmit(values)).then(function (o) {
        if (o && o.ok) {
          emit('submit_success', {});
          host.innerHTML = successHTML(opts);
          if (host.scrollIntoView) host.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else if (o && o.errors) { emit('submit_invalid', { server: true, fields: Object.keys(o.errors).slice(0, 20) }); fail('Please check the highlighted fields.'); showErrors(f, o.errors); }
        else { emit('submit_failed', {}); fail((o && o.error) || 'We couldn\'t send your details. Please try again.'); }
      }, function () { emit('submit_failed', {}); fail('We couldn\'t reach the server. Check your connection and try again.'); });
    });

    applyRules(false);
    return { form: f, destroy: function () { host.innerHTML = ''; }, refresh: applyRules };
  }

  return { formHTML: formHTML, successHTML: successHTML, closedHTML: closedHTML, mount: mount, validate: validate, readValues: readValues, isShown: isShown, visibleFields: visibleFields, esc: esc, LEGACY_IDS: LEGACY_IDS, PATTERNS: PATTERNS };
});
