/* Preview frame of Form Studio: draws the draft with the same renderer as the public page. The parent window sends the definition
   (postMessage, same origin only). Nothing is ever submitted from here. */
(function () {
  'use strict';
  var CFG = window.KNOA_CONFIG || {}, host = document.getElementById('formMount'), last = null;
  function draw(msg) {
    last = msg;
    var def = msg.definition || { sections: [], fields: [] }, c = def.copy || {};
    function fill(t) { return String(t || '').replace(/\{(name|type|date)\}/g, function (_m, k) { return { name: msg.name || '', type: c.typeLabel || '', date: c.when || '' }[k]; }).replace(/ {2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim(); }
    var hasName = !!msg.name;
    var copy = { headline: fill(hasName ? c.headline : String(c.headline || '').replace(/\{name\}\s*/g, '')), subheadline: fill(hasName ? c.subheadline : (c.subheadlineNoName || String(c.subheadline || '').replace(/\s*\{name\}/g, ''))), extra: c.extra || '', when: fill(c.when) };
    var pub = { sections: def.sections || [], fields: (def.fields || []).filter(function (f) { return !f.deleted; }) };
    if (msg.showClosed) { host.innerHTML = KnoaForm.closedHTML({ closedTitle: c.closedTitle, closedText: c.closed }); return; }
    if (msg.showSuccess) { host.innerHTML = KnoaForm.successHTML({ successTitle: c.successTitle, success: c.success }); return; }
    KnoaForm.mount(host, { def: pub, copy: copy, name: msg.name || '', countries: CFG.countries || [], button: c.button, fine: c.fine, successTitle: c.successTitle, success: c.success,
      onSubmit: function () { return Promise.resolve({ error: 'This is a preview: nothing is sent.' }); } });
    if (msg.focusKey) {
      var el = host.querySelector('[name="' + msg.focusKey + '"]'), box = el && (el.closest('.field') || el.closest('.sub-field'));
      var panel = el && el.closest('.panel'); if (panel) panel.hidden = false;          // show a conditional field so it can be seen while editing
      if (box) { box.classList.add('st-hl'); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'knoa-preview') return;
    draw(ev.data);
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'knoa-preview-ready' }, location.origin);
})();
