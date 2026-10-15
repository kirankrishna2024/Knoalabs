-- 001: leads table (registration form submissions).
-- Idempotent on purpose: databases created by the earlier version of this project
-- (which auto-created the table) are adopted safely instead of failing.
CREATE TABLE IF NOT EXISTS leads (
  id                      BIGSERIAL PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  full_name               TEXT NOT NULL,
  country_code            TEXT,
  phone                   TEXT NOT NULL,
  email                   TEXT,
  status                  TEXT NOT NULL,
  course_studying         TEXT,
  professional_background TEXT,
  experience_level        TEXT NOT NULL,
  intent                  TEXT NOT NULL,
  course                  TEXT,
  course_slug             TEXT,
  page_url                TEXT,
  page_title              TEXT,
  referrer                TEXT,
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  ip                      TEXT,
  user_agent              TEXT,
  crm_status              TEXT NOT NULL DEFAULT 'skipped',
  crm_error               TEXT
);
-- older installs of this project did not have updated_at
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_course_slug_idx ON leads (course_slug);
