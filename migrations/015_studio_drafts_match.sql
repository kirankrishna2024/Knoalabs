-- 015: Form Studio drafts (one mutable autosave per form), campaign link of a lead, same-person evidence, visitor columns used by tracking.
-- Additive only. ROLLBACK: DROP TABLE form_drafts; ALTER TABLE leads DROP COLUMN IF EXISTS match_basis; ALTER TABLE campaigns DROP COLUMN IF EXISTS is_demo;
CREATE TABLE IF NOT EXISTS form_drafts (
  form_id      BIGINT PRIMARY KEY REFERENCES forms(id),
  definition   JSONB NOT NULL,
  base_version INTEGER,
  author       TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE form_versions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS match_basis TEXT;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS session_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lead_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS visitor_events_session_idx ON visitor_events (session_id, type);
CREATE INDEX IF NOT EXISTS visitor_events_visitor_idx ON visitor_events (visitor_id, at DESC);
CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions (started_at DESC);
UPDATE form_versions SET published_at = created_at WHERE published_at IS NULL;
