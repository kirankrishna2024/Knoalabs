#!/bin/bash
set -e
BASE=https://knoalabsmasterclass-fgsgb.ondigitalocean.app
J='Content-Type: application/json'

echo 'Registration flow checks (public, no admin credentials)'

echo '1) the form endpoint for the published definition'
curl -s -o /dev/null -w 'GET /api/forms/cybersecurity -> %{http_code} \n' "$BASE/api/forms/cybersecurity"
curl -s -o /dev/null -w 'GET /api/forms/datascience -> %{http_code} \n' "$BASE/api/forms/datascience"
curl -s -o /dev/null -w 'GET /api/forms/missing-course -> %{http_code} (expect 404) \n' "$BASE/api/forms/missing-course"

echo '2) submit a valid registration through the plain link'
curl -s -X POST -H "$J" \
  -d '{"first_name":"R","last_name":"B","phone":"9876543210","status":"Student / Fresher","student_course":"BCA","student_status":"Final year","country":"IN","course":""}' \
  "$BASE/api/leads" | python -c "import sys,json; d=json.load(sys.stdin); print('plain link submit ->', d.get('ok'), 'id=', d.get('id'))" 2>/dev/null || echo 'submit parse failed'

echo '3) submit a valid registration through /cybersecurity'
curl -s -X POST -H "$J" \
  -d '{"first_name":"R","last_name":"B","phone":"9876543210","status":"Student / Fresher","student_course":"BCA","student_status":"Final year","country":"IN","course":"cybersecurity"}' \
  "$BASE/api/leads" | python -c "import sys,json; d=json.load(sys.stdin); print('cybersecurity submit ->', d.get('ok'), 'id=', d.get('id'))" 2>/dev/null || echo 'submit parse failed'

echo '4) invalid submission returns 422 with field errors'
curl -s -X POST -H "$J" \
  -d '{"first_name":"A","status":"Student / Fresher"}' \
  "$BASE/api/leads" | python -c "import sys,json; d=json.load(sys.stdin); print('invalid submit ->', d.get('ok'), 'has field errors=', bool(d.get('errors')))" 2>/dev/null || echo 'submit parse failed'

echo '5) closed form behavior: submit to an archived form path should be rejected by the form layer, not by /api/leads'
echo '  (verified in code: src/leads.js validateAgainstForm returns closed: true for non-active forms)'

echo
echo 'done'
