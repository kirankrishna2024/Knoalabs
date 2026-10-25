#!/usr/bin/env bash
# Archive behavior that should stay live-safe.
# These checks talk to https://knoalabsmasterclass-fgsgb.ondigitalocean.app.
# Do not paste auth tokens here. Use a helper that keeps the session out of
# the terminal history, or a short-lived cookie jar obtained from POST /admin/login.
# This file is a template; replace the curl-token glue with the same non-echoing
# helper you use for the other checks in checks/.

set -euo pipefail

BASE='https://knoalabsmasterclass-fgsgb.ondigitalocean.app'

# If you have a small helper already, point ADMIN_CURL at it. Otherwise fill the
# token/cookie glue below and keep it out of the bash history.
ADMIN=''
if [ -n "${ADMIN}" ] && command -v "${ADMIN}" >/dev/null 2>&1; then
  ADMIN_ARGS="$(${ADMIN} --curl-args 2>/dev/null)"
else
  echo "admin auth helper not ready; fill \$ADMIN before running the live checks" >&2
  exit 2
fi

echo '--- archive safeguard checks ---'

echo '# archive an already-archived form should be rejected clearly, not hit forms_status_check'
echo "curl -s -o /dev/null -w '%{http_code}' -X PATCH -H 'Content-Type: application/json' -d '{\"status\":\"archived\"}' \\"
echo "  '${BASE}/admin/api/forms/70' \\"
echo "  ${ADMIN_ARGS}"
echo

echo '# archive a live form is the real intended operation; confirm it works and then the form is gone from public lookup'
echo "curl -s -o /dev/null -w '%{http_code}' -X PATCH -H 'Content-Type: application/json' -d '{\"status\":\"archived\"}' \\"
echo "  '${BASE}/admin/api/forms/70' \\"
echo "  ${ADMIN_ARGS}"
echo

echo '# after an archive, the public form endpoint should return 404'
echo "curl -s -o /dev/null -w '%{http_code}' '${BASE}/api/forms/70'"
echo

echo '# submitting to an archived form should not return 200'
echo "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{\"first_name\":\"A\",\"status\":\"Student / Fresher\",\"client_id\":\"archive-safe-check\"}' \\"
echo "  '${BASE}/api/leads'"
echo
