#!/bin/bash
set -e
BASE=https://knoalabsmasterclass-fgsgb.ondigitalocean.app
echo 'Healthy-path checklist (no admin credentials needed)'

check() {
  local path="$1"
  local expect="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  if [ "$code" = "$expect" ]; then
    printf 'OK  %-55s %s\n' "$path" "$code"
  else
    printf '!!  %-55s %s (expected %s)\n' "$path" "$code" "$expect"
  fi
}

check '/' 200
check '/cybersecurity' 200
check '/datascience' 200
check '/generative-ai' 200
check '/genai' 200
check '/register' 200
check '/register?fbclid=1' 200
check '/config.js' 200
check '/register.js' 200
check '/register.css' 200
check '/render.js' 200
check '/ui.css' 200
check '/pixel.js' 200
check '/logo.png' 200
check '/favicon.png' 200
check '/admin/login' 200
check '/admin/assets/kit.js' 200
check '/admin/assets/forms.js' 200
check '/admin/assets/studio.css' 200
check '/admin/assets/dashboard.js' 200
check '/admin/assets/analytics.js' 200
check '/admin/assets/campaigns.js' 200
check '/admin/assets/qr.js' 200
check '/admin/assets/admin.css' 200
check '/admin/assets/links.css' 200
check '/admin/assets/campaigns.css' 200
check '/admin/assets/builder.js' 200
check '/admin/assets/links.js' 404
check '/admin/forms' 302
check '/admin/campaigns' 302
check '/admin/qr' 302
check '/admin/analytics' 302
check '/admin/api/forms/cybersecurity' 401
check '/api/forms/cybersecurity' 200
check '/api/forms/missing' 404
check '/health' 200
check '/ready' 200
check '/api/health' 200
check '/robots.txt' 404
check '/.well-known/security.txt' 404
check '/favicon.ico' 404
check '/nonexistent-page' 404
check '/admin/forms/1' 302
check '/admin/forms/999' 302
check '/admin/campaigns' 302
check '/admin/qr' 302
check '/admin/analytics' 302
check '/admin/api/forms' 401
check '/admin/api/courses' 401
check '/admin/api/campaigns' 401
check '/admin/api/analytics' 401
check '/admin/api/leads' 401
check '/admin/api/me' 401
check '/admin/api/stats' 401
check '/admin/api/leads/1' 401
check '/admin/api/leads/1.xlsx' 401
check '/admin/api/audit' 401
check '/admin/api/leads/1/related' 401
check '/admin/api/forms/1/versions' 401
check '/admin/api/forms/1/links' 401

echo
echo 'Public POST checks:'
echo '  valid submit ->'
curl -s -o /dev/null -w '    /api/leads valid -> %{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"first_name":"R","last_name":"B","phone":"9876543210","status":"Student / Fresher","student_course":"BCA","student_status":"Final year","country":"IN","course":""}' \
  "$BASE/api/leads"
echo '  invalid submit ->'
curl -s -o /dev/null -w '    /api/leads invalid -> %{http_code} (expect 422)\n' -X POST -H 'Content-Type: application/json' \
  -d '{"first_name":"A","status":"Student / Fresher"}' \
  "$BASE/api/leads"

echo
echo 'done'
