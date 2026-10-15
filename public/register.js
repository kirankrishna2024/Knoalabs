(function () {
  'use strict';
  var CFG = window.KNOA_CONFIG || {};
  var API = '/api/leads';
  var COUNTRIES = (CFG.countries || []).map(function (c) {
    return { c: c.c, d: c.d, other: !!c.other, hint: c.hint, re: new RegExp(c.re) };
  });
  var STUDENT = 'Student / Fresher', PRO = 'Working Professional';
  var ARROW = '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>';

  /* the course comes from the link: /cybersecurity  or  ?course=data-science (stored with the lead, not shown) */
  function courseFromURL() {
    var q = new URLSearchParams(location.search).get('course');
    var seg = (location.pathname.split('/').filter(Boolean)[0] || '').replace(/\.html?$/i, '');
    return q || seg || '';
  }
  /* same rule as the server (src/validate.js resolveCourse): /generative-ai, /genai and ?course=generativeai all mean "generativeai" */
  function resolveCourse(raw) {
    var clean = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
    var key = clean.replace(/-/g, '');
    if (!key) return { slug: '', name: null };
    key = (CFG.aliases && CFG.aliases[key]) || key;
    if (CFG.courses && Object.prototype.hasOwnProperty.call(CFG.courses, key)) return { slug: key, name: CFG.courses[key] };
    return { slug: clean, name: null };
  }
  /* the server writes the master class into <body data-course data-course-name> (names added in the admin panel included) */
  var BODY = document.body.dataset || {};
  var RESOLVED = BODY.courseName ? { slug: BODY.course || '', name: BODY.courseName } : resolveCourse(courseFromURL());
  var COURSE = RESOLVED.slug || courseFromURL();   // sent with the lead; the server resolves it again
  var COURSE_NAME = RESOLVED.name;                 // shown in the heading

  /* one random id per form load: if the same submission is sent twice (double tap, network retry) the server stores it once */
  function newClientId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  var CLIENT_ID = newClientId();

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var pill = function (name, value, label) {
    return '<label class="opt"><input type="radio" name="' + name + '" value="' + esc(value) + '"><span>' + esc(label || value) + '</span></label>';
  };
  var group = function (name, values, cls, labeler) {
    return '<div class="opts' + (cls ? ' ' + cls : '') + '">' + (values || []).map(function (v) { return pill(name, v, labeler ? labeler(v) : v); }).join('') + '</div>';
  };
  var err = function (k) { return '<div class="err" data-err="' + k + '"></div>'; };

  function formHTML() {
    var heading = COURSE_NAME
      ? 'Register for the <span class="accent">' + esc(COURSE_NAME) + '</span> Master Class'
      : 'Register for the Master Class';
    var sub = 'Share your details and our team will contact you with the session information.';
    if (COURSE_NAME) sub = 'Share your details and our team will contact you about the ' + esc(COURSE_NAME) + ' session.';
    return '' +
    '<h1 id="formTitle">' + heading + '</h1>' +
    '<p class="sub">' + sub + '</p>' +
    '<form class="lead-form" novalidate autocomplete="on">' +
      '<div class="grid2">' +
        '<div class="field"><label for="f-fn">First Name <i>*</i></label>' +
          '<input class="control" id="f-fn" name="first_name" type="text" placeholder="Enter your first name" autocomplete="given-name" maxlength="60">' + err('first_name') + '</div>' +
        '<div class="field"><label for="f-ln">Last Name <i>*</i></label>' +
          '<input class="control" id="f-ln" name="last_name" type="text" placeholder="Enter your last name" autocomplete="family-name" maxlength="60">' + err('last_name') + '</div>' +
      '</div>' +
      '<div class="field"><label for="f-ph">Mobile Number / WhatsApp <i>*</i></label>' +
        '<div class="phone">' +
          '<select class="control" name="country" aria-label="Country code">' +
            COUNTRIES.map(function (c) { return '<option value="' + c.c + '">' + (c.other ? 'Other' : c.c + ' ' + c.d) + '</option>'; }).join('') +
          '</select>' +
          '<input class="control" id="f-ph" name="phone" type="tel" inputmode="tel" placeholder="Mobile number" autocomplete="tel-national" maxlength="20">' +
        '</div>' + err('phone') + '</div>' +
      '<div class="field"><label for="f-em">Email Address <small>(optional)</small></label>' +
        '<input class="control" id="f-em" name="email" type="email" placeholder="Enter your email address" autocomplete="email" maxlength="120">' + err('email') + '</div>' +
      '<hr class="divider">' +
      '<div class="field" role="group" aria-labelledby="f-st"><span class="lbl" id="f-st">I am a <i>*</i></span>' +
        '<div class="choices">' +
          (CFG.statuses || []).map(function (s) {
            var sub = (CFG.statusSubtitles && CFG.statusSubtitles[s]) || '';
            return '<label class="choice"><input type="radio" name="status" value="' + esc(s) + '"><span class="choice-body"><span class="dot"></span><span><span class="choice-title">' +
              esc(s) + '</span>' + (sub ? '<span class="choice-sub">' + esc(sub) + '</span>' : '') + '</span></span></label>';
          }).join('') +
        '</div>' + err('status') + '</div>' +

      /* Student / Fresher */
      '<div class="panel" data-panel="' + STUDENT + '" hidden>' +
        '<div class="sub-field" role="group" aria-labelledby="f-sc"><span class="lbl" id="f-sc">Which course are you pursuing / completed? <i>*</i></span>' +
          group('student_course', CFG.studentCourses) + err('student_course') + '</div>' +
        '<div class="sub-field" role="group" aria-labelledby="f-ss"><span class="lbl" id="f-ss">Current status <i>*</i></span>' +
          group('student_status', CFG.studentStatuses) + err('student_status') + '</div>' +
        '<div class="sub-field"><label for="f-cn">College name <small>(optional)</small></label>' +
          '<input class="control" id="f-cn" name="college_name" type="text" placeholder="e.g. MES College of Engineering" autocomplete="organization" maxlength="120">' + err('college_name') + '</div>' +
        '<div class="sub-field"><label for="f-sp">Specialization / branch <small>(optional)</small></label>' +
          '<select class="control placeholder" id="f-sp" name="specialization"><option value="">Select specialization</option>' +
            (CFG.specializations || []).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
          '</select>' + err('specialization') + '</div>' +
      '</div>' +

      /* Working Professional */
      '<div class="panel" data-panel="' + PRO + '" hidden>' +
        '<div class="sub-field" role="group" aria-labelledby="f-xp"><span class="lbl" id="f-xp">Total work experience <i>*</i></span>' +
          group('experience', CFG.experienceOptions, 'cols4', function (x) { return x.replace('-', '–'); }) + err('experience') + '</div>' +
        '<div class="sub-field"><label for="f-cr">Current role / domain <i>*</i></label>' +
          '<select class="control placeholder" id="f-cr" name="current_role"><option value="">Select one</option>' +
            (CFG.currentRoles || []).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
          '</select>' + err('current_role') + '</div>' +
        '<div class="sub-field"><label for="f-cc">Current company <small>(optional)</small></label>' +
          '<input class="control" id="f-cc" name="current_company" type="text" placeholder="Enter your company name" autocomplete="organization" maxlength="120">' + err('current_company') + '</div>' +
        '<div class="sub-field"><label for="f-hq">Highest qualification <small>(optional)</small></label>' +
          '<select class="control placeholder" id="f-hq" name="highest_qualification"><option value="">Select qualification</option>' +
            (CFG.qualifications || []).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
          '</select>' + err('highest_qualification') + '</div>' +
      '</div>' +

      '<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="form-error" role="alert" hidden></div>' +
      '<button class="btn" type="submit"><span class="label">Register now</span><span class="orb"><span class="spin"></span>' + ARROW + '</span></button>' +
      '<p class="fine">We only use your details to share master class and course information.</p>' +
    '</form>';
  }

  /* client-side checks mirror the server (the server stays the authority) */
  function validate(f) {
    var v = Object.fromEntries(new FormData(f)), e = {};
    ['first_name', 'last_name', 'email'].forEach(function (k) { v[k] = (v[k] || '').trim(); });
    if (!v.first_name) e.first_name = 'Enter your first name';
    if (!v.last_name) e.last_name = 'Enter your last name';
    var country = COUNTRIES.filter(function (c) { return c.c === v.country; })[0] || COUNTRIES[0];
    var digits = String(v.phone || '').replace(/[\s\-()]/g, '');
    if (country.other && digits.charAt(0) === '+') digits = digits.slice(1); else digits = digits.replace(/^\+/, '');
    if (!country.other) {
      var code = country.d.slice(1);
      if (digits.indexOf(code) === 0 && digits.length > code.length + 6) digits = digits.slice(code.length);
      digits = digits.replace(/^0+/, '');
    }
    if (!digits) e.phone = 'Enter your mobile number';
    else if (!/^\d+$/.test(digits) || !country.re.test(digits)) e.phone = 'Enter a valid number: ' + country.hint;
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.email = 'Enter a valid email address';
    if (!v.status) e.status = 'Select one option';
    if (v.status === STUDENT) {
      if (!v.student_course) e.student_course = 'Select the course you are pursuing / completed';
      if (!v.student_status) e.student_status = 'Select your current status';
    }
    if (v.status === PRO) {
      if (!v.experience) e.experience = 'Select your total work experience';
      if (!v.current_role) e.current_role = 'Select your current role / domain';
    }
    return { v: v, e: e };
  }

  function showErrors(f, errs) {
    f.querySelectorAll('[data-err]').forEach(function (el) {
      var k = el.dataset.err, msg = errs[k];
      el.textContent = msg || ''; el.classList.toggle('on', !!msg);
      var ctl = f.querySelector('[name="' + k + '"]');
      if (ctl && ctl.type !== 'radio') ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    var first = Object.keys(errs)[0];
    if (first) {
      var c = f.querySelector('[name="' + first + '"]');
      if (c && c.type !== 'radio') c.focus({ preventScroll: true });
      var box = c && (c.closest('.field') || c.closest('.sub-field'));
      (box || c || f).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function payload(v) {
    var q = new URLSearchParams(location.search);
    return {
      first_name: v.first_name, last_name: v.last_name, country: v.country, phone: v.phone, email: v.email,
      status: v.status,
      student_course: v.student_course || '', student_status: v.student_status || '', college_name: v.college_name || '', specialization: v.specialization || '',
      experience: v.experience || '', current_role: v.current_role || '', current_company: v.current_company || '', highest_qualification: v.highest_qualification || '',
      course: COURSE, page_url: location.href, page_title: document.title, referrer: document.referrer,
      utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'),
      website: v.website || '', client_id: CLIENT_ID
    };
  }

  function mount(host) {
    host.innerHTML = formHTML();
    var f = host.querySelector('form'), btn = f.querySelector('.btn'), label = btn.querySelector('.label'), banner = f.querySelector('.form-error');

    /* show the panel for the chosen status, and clear what was typed in the other one */
    f.addEventListener('change', function (ev) {
      if (ev.target.name === 'status') {
        f.querySelectorAll('[data-panel]').forEach(function (p) {
          var on = p.getAttribute('data-panel') === f.status.value;
          p.hidden = !on;
          if (!on) {
            p.querySelectorAll('input[type=radio]').forEach(function (r) { r.checked = false; });
            p.querySelectorAll('input[type=text]').forEach(function (t) { t.value = ''; });
            p.querySelectorAll('select').forEach(function (s) { s.value = ''; s.classList.add('placeholder'); });
            p.querySelectorAll('.err.on').forEach(function (x) { x.classList.remove('on'); });
          }
        });
      }
      if (ev.target.tagName === 'SELECT') ev.target.classList.toggle('placeholder', !ev.target.value);
    });

    /* clear a field's error as soon as the person fixes it */
    function clearErr(ev) {
      var el = ev.target, e = f.querySelector('[data-err="' + el.name + '"]');
      if (e && e.classList.contains('on')) { e.classList.remove('on'); el.removeAttribute('aria-invalid'); }
    }
    f.addEventListener('input', clearErr);
    f.addEventListener('change', clearErr);

    function fail(msg) {
      btn.disabled = false; btn.classList.remove('loading'); label.textContent = 'Register now';
      banner.textContent = msg; banner.hidden = false;
    }

    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (btn.disabled) return;
      banner.hidden = true;
      var r = validate(f);
      showErrors(f, r.e);
      if (Object.keys(r.e).length) return;

      btn.disabled = true; btn.classList.add('loading'); label.textContent = 'Sending…';
      var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 15000);
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(r.v)), signal: ctrl.signal })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
        .then(function (o) {
          if (o.res.ok && o.data.ok) {
            host.innerHTML = '<div class="success" role="status"><div class="tick"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>' +
              '<h2>Thank you for registering!</h2><p>Our team will contact you soon with the master class details.</p></div>';
            host.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else if (o.res.status === 422 && o.data.errors) {
            fail('Please check the highlighted fields.'); showErrors(f, o.data.errors);
          } else {
            fail(o.data.error || 'We couldn\'t send your details. Please try again.');
          }
        })
        .catch(function () { fail('We couldn\'t reach the server. Check your connection and try again.'); })
        .then(function () { clearTimeout(timer); });
    });
  }

  if (COURSE_NAME) {
    try { document.title = 'Register for the ' + COURSE_NAME + ' Master Class | KnoaLabs'; } catch (e) { /* ignore */ }
  }
  mount(document.getElementById('formMount'));
})();
