-- 005: database-only lead store + admin panel.
-- * CRM forwarding is gone: its CHECK constraint, index and columns are dropped.
-- * The form no longer asks "What would you like to do?" or a free-text background, and experience is
--   only asked from working professionals, so those columns become optional. Old rows keep their data.
-- * admin_users holds the panel logins (passwords stored as salted scrypt hashes, never in plain text).
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_crm_status_check;
DROP INDEX IF EXISTS leads_crm_queue_idx;
ALTER TABLE leads DROP COLUMN IF EXISTS crm_status;
ALTER TABLE leads DROP COLUMN IF EXISTS crm_error;
ALTER TABLE leads DROP COLUMN IF EXISTS crm_attempts;
ALTER TABLE leads DROP COLUMN IF EXISTS crm_next_attempt_at;

ALTER TABLE leads ALTER COLUMN intent DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN experience_level DROP NOT NULL;

CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);

CREATE TABLE IF NOT EXISTS admin_users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
