-- 018: add note column to form_versions (missing due to older migration version being applied)
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS note TEXT;
