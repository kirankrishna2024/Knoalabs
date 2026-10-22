(function () {
  'use strict';
  var form = document.getElementById('loginForm'), btn = document.getElementById('loginBtn'), label = btn.querySelector('.label'),
      banner = document.getElementById('loginError'), pw = document.getElementById('p'), toggle = document.getElementById('pwToggle');

  toggle.addEventListener('click', function () {
    var show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  function fail(msg) {
    btn.disabled = false; btn.classList.remove('loading'); label.textContent = 'Sign in';
    banner.textContent = msg; banner.hidden = false;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (btn.disabled) return;
    banner.hidden = true;
    var username = form.username.value.trim(), password = form.password.value;
    if (!username || !password) return fail('Enter your admin ID and password.');
    btn.disabled = true; btn.classList.add('loading'); label.textContent = 'Signing in…';
    fetch('/admin/api/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { res: res, d: d }; }); })
      .then(function (o) {
        if (o.res.ok && o.d.ok) { window.location.replace('/admin'); return; }
        if (o.res.status === 429) return fail('Too many attempts. Please wait a few minutes and try again.');
        fail(o.d.error || 'Could not sign in. Please try again.');
        form.password.value = ''; form.password.focus();
      })
      .catch(function () { fail('Could not reach the server. Check your connection and try again.'); });
  });
})();
