-- migrate:allow-edit
-- 019: admin_audit_log index. The table itself is created by 011_forms.sql (CREATE TABLE IF NOT EXISTS there), so a database that
-- applied an older 011 already got it from the earlier version of this file. Kept as plain SQL that is safe to run again.
CREATE INDEX IF NOT EXISTS admin_audit_log_at_idx ON admin_audit_log (at DESC);
