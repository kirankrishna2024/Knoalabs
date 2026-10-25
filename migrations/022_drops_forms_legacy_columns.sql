-- migrate:allow-edit
-- 022: drop the legacy columns the old forms table carried and the app no longer uses (author / is_default / slug; a NOT NULL `slug`
-- made POST /admin/api/forms fail). A no-op on a database that never had them. Runs inside the runner's transaction.
ALTER TABLE forms DROP COLUMN IF EXISTS author;
ALTER TABLE forms DROP COLUMN IF EXISTS is_default;
ALTER TABLE forms DROP COLUMN IF EXISTS slug;
