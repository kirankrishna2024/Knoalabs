-- 023: make the forms status CHECK match the app. A database created by an earlier schema kept a forms_status_check that does not
-- allow every status the app writes; 021 skipped it because "a constraint with that name exists", and archiving a form
-- (PATCH /admin/api/forms/:id {status:'archived'}) failed with: new row for relation "forms" violates check constraint "forms_status_check".
-- Rows with a status the app does not know are moved to 'draft' first so the new constraint can be added.
-- ROLLBACK (manual): ALTER TABLE forms DROP CONSTRAINT forms_status_check;
UPDATE forms SET status = 'draft' WHERE status IS NULL;
UPDATE forms SET status = 'draft' WHERE status <> 'active' AND status <> 'draft' AND status <> 'paused' AND status <> 'archived';
ALTER TABLE forms DROP CONSTRAINT IF EXISTS forms_status_check;
ALTER TABLE forms ADD CONSTRAINT forms_status_check CHECK (status IN ('active', 'draft', 'paused', 'archived'));
ALTER TABLE forms ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE forms ALTER COLUMN status SET NOT NULL;
