-- 012: campaigns and the links generated for a form.
-- "At most one active campaign per course" is enforced in a transaction in code AND by the partial unique index below.
-- ROLLBACK: DROP TABLE campaign_links; DROP TABLE campaigns;
CREATE TABLE IF NOT EXISTS campaigns (
  id           BIGSERIAL PRIMARY KEY,
  course_slug  TEXT NOT NULL,
  form_id      BIGINT,
  name         TEXT NOT NULL,
  code         TEXT NOT NULL,
  platform     TEXT,
  medium       TEXT NOT NULL DEFAULT 'paid',
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  starts_on    DATE,
  ends_on      DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_status_check CHECK (status IN ('draft','active','paused','ended'))
);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_code_key ON campaigns (code);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_active_per_course ON campaigns (course_slug) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS campaigns_course_idx ON campaigns (course_slug, status);

CREATE TABLE IF NOT EXISTS campaign_links (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES campaigns(id),
  form_id     BIGINT,
  course_slug TEXT NOT NULL,
  label       TEXT NOT NULL,
  url         TEXT NOT NULL,
  platform    TEXT,
  medium      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_links_form_idx ON campaign_links (form_id, created_at DESC);
