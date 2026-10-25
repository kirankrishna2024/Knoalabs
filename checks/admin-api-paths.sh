#!/bin/bash
set -e
BASE=https://knoalabsmasterclass-fgsgb.ondigitalocean.app/admin
FORM=1
echo 'Admin API path coverage (expect 401 everywhere here because no session is sent)'
for path in \
  api/stats \
  api/analytics \
  api/insights \
  api/filters \
  api/me \
  api/leads \
  api/leads.xlsx \
  api/courses \
  api/courses/$FORM \
  api/courses/nonexistent \
  api/courses/1%20OR%201=1 \
  api/forms \
  api/forms/$FORM \
  api/forms/999 \
  api/forms/$FORM/versions \
  api/forms/$FORM/versions/1 \
  api/forms/$FORM/versions/999 \
  api/forms/$FORM/diff \
  api/forms/$FORM/diff?from=1&to=1 \
  api/forms/$FORM/diff?from=a&to=b \
  api/forms/$FORM/links \
  api/forms/$FORM/links/$FORM \
  api/forms/$FORM/links/999 \
  api/campaigns \
  api/campaigns/1 \
  api/campaigns/999 \
  api/campaigns/1/status \
  api/audit \
  api/leads/1 \
  api/leads/1/related \
  api/leads/999/related \
  api/leads/abc \
  api/leads/1%20OR%201=1
do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$path")
  printf '%-55s %s\n' "$path" "$code"
done
echo
echo 'done'
