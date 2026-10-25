-- 011: Form Studio. A form attaches to a course (master class / session); every save is an immutable version.
-- ROLLBACK (manual, only if nothing depends on it): DROP TABLE admin_audit_log; DROP TABLE form_versions; DROP TABLE forms;
CREATE TABLE IF NOT EXISTS forms (
  id                BIGSERIAL PRIMARY KEY,
  course_slug       TEXT NOT NULL,
  path              TEXT NOT NULL,
  name              TEXT NOT NULL,
  type_label        TEXT NOT NULL DEFAULT 'Master Class',
  status            TEXT NOT NULL DEFAULT 'draft',
  current_version   INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT forms_status_check CHECK (status IN ('active','draft','paused','archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS forms_course_slug_key ON forms (course_slug);
CREATE INDEX IF NOT EXISTS forms_status_idx ON forms (status);

CREATE TABLE IF NOT EXISTS form_versions (
  id          BIGSERIAL PRIMARY KEY,
  form_id     BIGINT NOT NULL REFERENCES forms(id),
  version     INTEGER NOT NULL,
  definition  JSONB NOT NULL,
  author      TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS form_versions_form_version_key ON form_versions (form_id, version);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     JSONB
);
CREATE INDEX IF NOT EXISTS admin_audit_log_at_idx ON admin_audit_log (at DESC);
