# Form Studio acceptance checklist (production)
# Run through this before and after any deploy that touches forms.

# 0. App is reachable and current build is up
curl -fs https://knoalabsmasterclass-fgsgb.ondigitalocean.app/api/health
curl -fs https://knoalabsmasterclass-fgsgb.ondigitalocean.app/ready
curl -fs https://knoalabsmasterclass-fgsgb.ondigitalocean.app/config.js | grep -q window.KNOA_CONFIG

# 1. Registration page renders for every link type
for path in '/' '/cybersecurity' '/datascience' '/generative-ai' '/genai'; do
  curl -fs -o /dev/null -w '%{http_code} %{url_effective}\n' "https://knoalabsmasterclass-fgsgb.ondigitalocean.app${path}"
done

# 2. Public form API (used by the page)
curl -fs https://knoalabsmasterclass-fgsgb.ondigitalocean.app/api/forms/cybersecurity | jq -e '.ok and .form_id'
curl -fs https://knoalabsmasterclass-fgsgb.ondigitalocean.app/api/forms/datascience | jq -e '.ok and .form_id'

# 3. Valid submission through each link + plain link
for course in cybersecurity ds ''; do
  course_param=${course:-''}
  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{"first_name":"R","last_name":"B","phone":"9876543210","status":"Student / Fresher","student_course":"BCA","student_status":"Final year","country":"IN","course":"'"${course_param}"'"}' \
    "https://knoalabsmasterclass-fgsgb.ondigitalocean.app/api/leads"
done

# 4. Invalid submissions are rejected with 422 and field errors (form-level)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"first_name":"A","status":"Student / Fresher"}' \
  https://knoalabsmasterclass-fgsgb.ondigitalocean.app/api/leads | jq -e '.ok == false and (.errors.first_name or .errors.phone or .errors.status)'

# 5. Admin routes are locked behind login
for route in /admin /admin/api/stats /admin/api/leads /admin/api/courses /admin/api/forms /admin/api/campaigns /admin/api/analytics; do
  curl -fs -o /dev/null -w '%{http_code} ' "https://knoalabsmasterclass-fgsgb.ondigitalocean.app${route}"
done
echo 'all 401 or 302'

# 6. Login flow once (use a real admin session, then sign out)
# reminder: ADMIN_USERNAME and ADMIN_PASSWORD must be available in the env; do not ship these in docs
