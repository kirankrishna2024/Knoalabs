#!/usr/bin/env bash
# Non-echoing admin auth helper template used by the production checks.
#
# Two supported modes:
#  1) Cookie-based: source a safe environment file that defines
#     KNOLABS_ADMIN_EMAIL and KNOLABS_ADMIN_PASS, then this helper logs in
#     once, keeps a cookie jar, and returns curl args.
#  2) Token-based: define KNOLABS_ADMIN_BEARER and this helper returns a
#     bearer header.
#
# This file is intentionally a template. Replace the URL and helper name with
# whatever the rest of checks/ already uses, and never store the password in
# this file itself.

set -euo pipefail

BASE='https://knoalabsmasterclass-fgsgb.ondigitalocean.app'
COOKIE_JAR="${TMPDIR:-/tmp}/knoa-admin-cookies-$$"

ensure_session() {
  if [ -n "${KNOLABS_ADMIN_BEARER:-}" ]; then
    printf -- '-H' ' ' '-H' 'Authorization: Bearer ' "$KNOLABS_ADMIN_BEARER"
    return 0
  fi

  if [ -z "${KNOLABS_ADMIN_EMAIL:-}" ] || [ -z "${KNOLABS_ADMIN_PASS:-}" ]; then
    echo 'admin auth not configured' >&2
    echo 'expected one of:' >&2
    echo '  - KNOLABS_ADMIN_BEARER' >&2
    echo '  - KNOLABS_ADMIN_EMAIL + KNOLABS_ADMIN_PASS in a safe env file' >&2
    exit 2
  fi

  if [ ! -f "${COOKIE_JAR}" ]; then
    curl -s -c "${COOKIE_JAR}" -o /dev/null \
      -X POST "${BASE}/admin/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"${KNOLABS_ADMIN_EMAIL}\",\"password\":\"${KNOLABS_ADMIN_PASS}\"}" \
      >/dev/null
  fi

  # If the cookie jar is empty or the session is no longer valid, log in again.
  if [ ! -s "${COOKIE_JAR}" ]; then
    rm -f "${COOKIE_JAR}"
    curl -s -c "${COOKIE_JAR}" -o /dev/null \
      -X POST "${BASE}/admin/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"${KNOLABS_ADMIN_EMAIL}\",\"password\":\"${KNOLABS_ADMIN_PASS}\"}" \
      >/dev/null || true
  fi

  printf -- '-b' ' ' "${COOKIE_JAR}" '-c' ' ' "${COOKIE_JAR}"
}

case "${1:-}" in
  --curl-args)
    ensure_session
    ;;
  *)
    echo "usage: $0 --curl-args" >&2
    exit 2
    ;;
esac

# Example usage with the other checks in this folder:
#
#   source checks/admin-auth-safe.sh
#   curl $BASE/admin/api/forms $(ensure_session --curl-args)
#
# If you already have a wrapper named kno_admin_curl or similar, point
# ADMIN= that wrapper and call its --curl-args the same way.
