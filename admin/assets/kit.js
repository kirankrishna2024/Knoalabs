/* Shared admin UI helpers: KnoaUI.confirm() (modal), KnoaUI.copy() and KnoaUI.toast(). Text only, never innerHTML. */
(function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

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

  window.KnoaUI = { confirm: confirmBox, copy: copyText, toast: toast };
})();
