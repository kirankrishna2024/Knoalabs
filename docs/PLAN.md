# Plan and task board (Planner)

Baseline (task 1): `npm test` exit 0, 14 test files, 351 checks, Node 22, pg-mem. Recorded before any change.

## Differences between the master prompt and the code (audited)
| Prompt says | Code says |
|---|---|
| `/admin/qr` page, builder on Leads + Analytics | True: `admin/views/qr.html`, `builder.js` used by dashboard, analytics, qr |
| `src/analytics.js` has `channelOf` / `niceChannel` | True (SOCIAL regex table, lines ~92-103). `sources.js` will own the table; `niceChannel` stays as is until tests prove parity |
| `register.js` draws form from fixed fields | True. Heading wraps the name in `<span class="accent">`; fallback copy exists when no course name |
| Fixed validation in `src/validate.js` | True. Default definition is derived from it; differential test proves equality |
| Playwright available | Python `playwright` package is importable; no browser binary found on PATH. Browser E2E is UNVERIFIED until a browser is installed |
| No UA parser / maxmind installed | True, nothing installed. Not added yet |
| Backfill of default forms in SQL | A SQL migration cannot import the JS definition. Tables come from SQL; the default form + version 1 is seeded idempotently by `src/forms.js seedDefaultForms()` right after migrations |

## Task board
Status: DONE = built and tested here, TODO = not started.
| # | Task | Reqs | Status |
|---|---|---|---|
| 1 | Audit + baseline | all | DONE |
| 2 | ARCHITECTURE.md, default-form definition | R2 R3 R4 | DONE |
| 3 | Migrations 011-014 | R3 R4 R6 R8 R13 | DONE on pg-mem; real PostgreSQL NOT verified |
| 4 | Form definition engine + legacy equivalence | R2 R3 R4 R14(structure) | DONE |
| 10 | Source detection `src/sources.js` | R7 | DONE |
| 12 | Geo module (ipapi adapter, budget, breaker, cache, mask) | R13 | DONE (module + wired, off by default) |
| 4b | Default-form seed + GET /api/forms/:path | R3 | DONE |
| 5 | Public renderer from definition + DOM regression | R1 R3 | TODO |
| 6 | Form Studio UI + SortableJS | R1 R2 R14 | TODO |
| 7 | Remove builder blocks, redirects | R1 | TODO |
| 8 | Link generator | R5 | TODO |
| 9 | Campaign manager + base-link redirect | R6 | TODO |
| 11 | Tracking pipeline, UA parser | R8 | TODO |
| 13 | Same-person detection | R9 | TODO |
| 13b, 14, 15, 16 | IP dashboard, maps, chart fullscreen, analytics | R10-R13 | TODO |
| 17-20 | Security review, perf, E2E, release | all | TODO |

Risks: pg-mem lacks some index/JSONB features (guarded); no browser here for Playwright; ipapi.co terms and free-tier limits must be verified by the owner; DPDP review needed.
