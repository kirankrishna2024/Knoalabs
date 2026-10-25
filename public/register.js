(function () {
  'use strict';
  /* The webfont: added here rather than in the HTML because a stylesheet from another origin is render-blocking.
     The page already paints in the fallback font, so this only re-renders it in Urbanist once it arrives. */
  try {
    var font = document.createElement('link');
    font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap';
    (document.head || document.documentElement).appendChild(font);
  } catch (e) { /* the form never depends on the font */ }

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

  /* the ad networks' click ids the link carries: presence only (the value is never read or sent). The server turns them
     into the channel, so Google / Meta (Facebook or Instagram) / Microsoft / LinkedIn / TikTok need no typed source. */
  var CLICK_IDS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'li_fat_id', 'ttclid'];
  function clickIds(q) {
    var out = {};
    for (var i = 0; i < CLICK_IDS.length; i++) if (q.get(CLICK_IDS[i])) out[CLICK_IDS[i]] = true;
    return out;
  }

  /* ---- exact location (optional) ----
     The browser asks once. If the person already allowed location for this site, or a recent location is already stored
     in this browser, nothing is asked again and the stored/current position is used. If they blocked it, it is never asked again.
     The coordinates are only sent with the registration / link open; when it is not allowed, simply nothing is sent. */
  var GEO_KEY = 'knoa_geo', GEO_ASKED = 'knoa_geo_asked', GEO = null, geoStarted = false;
  function storeGet(key) {
    var stores = ['localStorage', 'sessionStorage'];
    for (var i = 0; i < stores.length; i++) { try { var v = window[stores[i]].getItem(key); if (v) return v; } catch (e) { /* blocked */ } }
    return null;
  }
  function storeSet(key, val) {
    var stores = ['localStorage', 'sessionStorage'];
    for (var i = 0; i < stores.length; i++) { try { window[stores[i]].setItem(key, val); return; } catch (e) { /* blocked */ } }
  }
  function validGeo(g) {
    return g && typeof g.lat === 'number' && typeof g.lon === 'number' && isFinite(g.lat) && isFinite(g.lon) &&
      Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180 && typeof g.at === 'number';
  }
  function loadGeo() {
    try { var g = JSON.parse(storeGet(GEO_KEY)); if (validGeo(g) && Date.now() - g.at < 7 * 864e5) return g; } catch (e) { /* ignore */ }
    return null;
  }
  function geoBody() { return GEO ? { lat: GEO.lat, lon: GEO.lon, accuracy: GEO.accuracy } : null; }
  function rememberGeo(pos) {
    var c = pos && pos.coords;
    if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return;
    GEO = {
      lat: Math.round(c.latitude * 1e6) / 1e6, lon: Math.round(c.longitude * 1e6) / 1e6,
      accuracy: isFinite(c.accuracy) ? Math.round(c.accuracy * 100) / 100 : null, at: Date.now()
    };
    storeSet(GEO_KEY, JSON.stringify(GEO));
    reportOpen();                     // store the exact location with this link open too (the counter dedupes it)
  }
  function captureGeo() {
    if (GEO || geoStarted || !navigator.geolocation) return;
    geoStarted = true;
    try {
      navigator.geolocation.getCurrentPosition(rememberGeo, function (err) {
        if (err && err.code === 1) storeSet(GEO_ASKED, 'denied');   // blocked: never ask again in this browser
        geoStarted = false;
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 6 * 3600 * 1000 });
    } catch (e) { geoStarted = false; }
  }
  function startGeo() {
    GEO = loadGeo();
    if (GEO) return;   // already have a recent position: never ask again
    if (!navigator.geolocation) return;
    // If the browser has already granted or remembered the permission for this site, ask immediately and once.
    // If permission was denied, never ask again for this form load.
    function askNow() {
      if (storeGet(GEO_ASKED) === 'denied') return;
      captureGeo();
    }
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
        if (p.state === 'granted') askNow();                       // allowed: no repeated prompt, just get the location
        else if (p.state !== 'denied') askNow();                   // promptable: ask once now
        try { p.onchange = function () { if (p.state === 'granted') askNow(); }; } catch (e) { /* ancient browser */ }
      }, askNow);
    } else askNow();
  }
  startGeo();

  /* link-open counter: tell the server this link was opened (once per page load). A random id kept in this browser lets the server
     count one person once a day instead of once per refresh (localStorage, then sessionStorage when the browser blocks it, so a refresh
     in the same tab still counts once). A page the browser only pre-renders is reported when the person actually opens it.
     Failures are silent: the form never depends on it. */
  function visitorId() {
    var ok = /^[A-Za-z0-9_-]{8,64}$/, stores = ['localStorage', 'sessionStorage'];
    for (var i = 0; i < stores.length; i++) {
      try {
        var st = window[stores[i]], v = st.getItem('knoa_vid') || '';
        if (!ok.test(v)) { v = newClientId(); st.setItem('knoa_vid', v); }
        return v;
      } catch (e) { /* storage blocked: try the next one */ }
    }
    return newClientId();
  }
  function reportOpen() {
    try {
      var q = new URLSearchParams(location.search);
      fetch('/api/visit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit',
        body: JSON.stringify({ vid: visitorId(), course: COURSE, referrer: document.referrer, utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'),
          site_source_name: q.get('site_source_name'), placement: q.get('placement'), fbclid: !!q.get('fbclid'), click_ids: clickIds(q), geo: geoBody() })
      }).catch(function () {});
    } catch (e) { /* never block the form */ }
  }
  if (document.prerendering) document.addEventListener('prerenderingchange', reportOpen, { once: true });
  else if (document.visibilityState !== 'prerender') reportOpen();


  /* ---- the form comes from the stored definition (Form Studio): embedded in the page by the server, else fetched, else a built-in copy ---- */
  function embedded() {
    try { var el = document.getElementById('knoaForm'); return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }
  function fetchForm() {
    return fetch('/api/forms/' + encodeURIComponent(COURSE || '_plain'), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /* ---- tracking: page view, form start, errors, submit (src/track.js). Silent on failure, never waits, no field values are sent ---- */
  var SESSION_ID = (function () {
    try {
      var s = sessionStorage.getItem('knoa_sid'), t = +sessionStorage.getItem('knoa_sid_t') || 0;
      if (!s || !/^[A-Za-z0-9_-]{8,64}$/.test(s) || Date.now() - t > 30 * 60 * 1000) { s = newClientId(); sessionStorage.setItem('knoa_sid', s); }
      sessionStorage.setItem('knoa_sid_t', String(Date.now()));
      return s;
    } catch (e) { return newClientId(); }
  })();
  var T0 = Date.now(), QUEUE = [], FORM_META = {};
  function track(type, detail) {
    try {
      QUEUE.push({ k: newClientId(), t: type, d: detail || {}, ms: Date.now() - T0 });
      if (type === 'submit_success' || type === 'submit_failed' || QUEUE.length >= 8) flush();
      else if (!track.timer) track.timer = setTimeout(flush, 2500);
    } catch (e) { /* ignore */ }
  }
  function flush() {
    try {
      clearTimeout(track.timer); track.timer = null;
      if (!QUEUE.length) return;
      var q = new URLSearchParams(location.search), events = QUEUE.splice(0, 20);
      var body = JSON.stringify({ vid: visitorId(), sid: SESSION_ID, course: COURSE, form_id: FORM_META.form_id || null, form_version: FORM_META.version || null,
        utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'), click_ids: clickIds(q), referrer: document.referrer, landing: location.pathname,
        lang: navigator.language || '', tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })(),
        screen: (window.screen ? screen.width + 'x' + screen.height : ''), events: events });
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { track('page_hide', { s: Math.round((Date.now() - T0) / 1000) }); flush(); } });

  function payload(v) {
    var q = new URLSearchParams(location.search), out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    out.course = COURSE; out.page_url = location.href; out.page_title = document.title; out.referrer = document.referrer;
    out.utm_source = q.get('utm_source'); out.utm_medium = q.get('utm_medium'); out.utm_campaign = q.get('utm_campaign');
    out.site_source_name = q.get('site_source_name'); out.placement = q.get('placement'); out.fbclid = !!q.get('fbclid'); out.click_ids = clickIds(q); out.geo = geoBody();   /* Meta fills these in: which app (fb / ig) and where in it; click ids auto-detect the ad network; geo is optional */
    out.client_id = CLIENT_ID; out.visitor_id = visitorId(); out.session_id = SESSION_ID;
    out.form_id = FORM_META.form_id || null; out.form_version = FORM_META.version || null;
    out.seconds_on_page = Math.round((Date.now() - T0) / 1000);
    return out;
  }

  function submit(values) {
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(values)), signal: ctrl.signal })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (o) {
        if (o.res.ok && o.data.ok) {
          if (window.fbq) { try { window.fbq('track', 'Lead'); } catch (e) { /* the pixel must never affect the form */ } }
          // Google Tag Manager lead event
          window.dataLayer = window.dataLayer || [];
          var statusVal = (values && values.status) ? values.status : '';
          window.dataLayer.push({
            event: 'masterclass_lead',
            course: COURSE,
            lead_status: statusVal,
            lead_id: CLIENT_ID
          });
          return { ok: true };
        }
        if (o.res.status === 422 && o.data.errors) return { errors: o.data.errors };
        return { error: o.data.error };
      })
      .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }

  function start(form) {
    var host = document.getElementById('formMount');
    FORM_META = { form_id: form.form_id, version: form.version };
    var copy = form.copy || {};
    if (COURSE_NAME) { try { document.title = 'Register for the ' + COURSE_NAME + ' Master Class | KnoaLabs'; } catch (e) { /* ignore */ } }
    KnoaForm.mount(host, {
      def: { sections: form.sections, fields: form.fields }, copy: copy, name: COURSE_NAME || form.name_for_copy || '', countries: COUNTRIES,
      button: form.button, fine: form.fine, successTitle: form.successTitle, success: form.success, isClosed: form.closed === true || (form.status && form.status !== 'active'),
      closedTitle: form.closedTitle, closedText: form.closedText, onSubmit: submit, onEvent: track
    });
    track('page_view', { form_version: form.version || null });
  }

  var form = embedded();
  if (form) start(form);
  else fetchForm().then(function (f) { if (f && f.ok) start(f); else document.getElementById('formMount').innerHTML = '<p class="sub">We could not load the form. Please refresh the page.</p>'; });
})();
