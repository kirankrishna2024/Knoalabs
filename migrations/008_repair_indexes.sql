-- 008: repair. An earlier manual clean-up of the leads table also dropped the unique index that
-- protects against double submissions (leads_client_id_key). Recreate every index the app relies on.
-- Fully idempotent: safe whether the indexes exist or not.
CREATE UNIQUE INDEX IF NOT EXISTS leads_client_id_key ON leads (client_id);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_course_slug_idx ON leads (course_slug);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);
