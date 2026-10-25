# Architecture (Architect)

## Data model (migrations 011-014, all additive, re-runnable)
- 011 `forms`, `form_versions` (immutable rows; immutability enforced in code), `admin_audit_log`.
- 012 `campaigns`, `campaign_links`.
- 013 `visitors`, `sessions`, `visitor_events` (unique `event_key`), `geo_cache`, `geo_budget`.
- 014 new nullable columns on `leads` (form_id, form_version, custom_fields JSONB, visitor/session/campaign ids, source_detected/method, device + geo snapshot, ip_hash, geo_status, returning-lead fields).
Rollback notes are in each file's header (DROP the new objects; no existing column is touched).

## Form definition (JSON in `form_versions.definition`)
`{ schema:1, copy:{headline,subheadline,subheadlineNoName,typeLabel,extra,when,button,success,successTitle}, sections:[{id,title}], fields:[{key,label,type,column?,section,width,order,required,hidden,deleted,placeholder,help,minLength,maxLength,pattern,options[{value,label,sub}],defaultValue,showWhen,ui,messages,system}] }`
- Built-in fields carry `column` (their existing `leads` column); custom fields have none and are stored in `leads.custom_fields`.
- Delete = `deleted:true` (kept in the version, dropped from the public definition and from validation).
- `showWhen: {field, op:'eq'|'neq'|'in', value}`; the controller must come earlier in order (dependency guard, checked server-side).

## Compatibility argument (hard rule 1)
`defaultDefinition()` is generated from `src/options.js` / `src/countries.js`, the same lists `validate.js` uses. `test/formdef.test.js` runs a differential test: for a large corpus of submissions, `validateSubmission(defaultDefinition())` returns the same errors and the same lead columns as legacy `validateLead`. Rendering equivalence (DOM) is NOT yet proven: the renderer is still TODO and `register.js` is untouched.

## Modules
`src/formdef.js` (schema, templating, show-when, validation), `src/forms.js` (seed/DB access), `src/sources.js` (data-driven source table), `src/geo.js` (provider interface, ipapi adapter, budget, breaker, cache, masking).
