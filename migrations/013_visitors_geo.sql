-- 013: anonymous visitors, sessions, append-only events, IP geo cache and the daily lookup budget.
-- No raw IP is stored here: only a salted hash (ip_hash) and a masked display string.
-- ROLLBACK: DROP TABLE visitor_events; DROP TABLE sessions; DROP TABLE visitors; DROP TABLE geo_cache; DROP TABLE geo_budget;
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id    TEXT PRIMARY KEY,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  visit_count   INTEGER NOT NULL DEFAULT 1,
  first_source  TEXT,
  first_method  TEXT,
  last_source   TEXT,
  landing_path  TEXT,
  referrer_host TEXT,
  language      TEXT,
  timezone      TEXT,
  screen        TEXT,
  device_type   TEXT,
  os            TEXT,
  os_version    TEXT,
  browser       TEXT,
  browser_version TEXT,
  in_app        TEXT,
  is_webview    BOOLEAN,
  ip_hash       TEXT,
  ip_masked     TEXT,
  geo_status    TEXT,
  geo_country_code TEXT, geo_region TEXT, geo_city TEXT,
  geo_lat       NUMERIC(6,2), geo_lon NUMERIC(6,2),
  is_demo       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors (last_seen DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  campaign_id  BIGINT,
  course_slug  TEXT,
  source_detected TEXT,
  source_method   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_visitor_idx ON sessions (visitor_id, started_at DESC);

CREATE TABLE IF NOT EXISTS visitor_events (
  id          BIGSERIAL PRIMARY KEY,
  event_key   TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id  TEXT,
  session_id  TEXT,
  type        TEXT NOT NULL,
  course_slug TEXT,
  campaign_id BIGINT,
  detail      JSONB,
  is_demo     BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS visitor_events_key ON visitor_events (event_key);
CREATE INDEX IF NOT EXISTS visitor_events_at_idx ON visitor_events (at DESC);
CREATE INDEX IF NOT EXISTS visitor_events_type_idx ON visitor_events (type, at DESC);

CREATE TABLE IF NOT EXISTS geo_cache (
  ip_hash     TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  data        JSONB,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_cache_expires_idx ON geo_cache (expires_at);

CREATE TABLE IF NOT EXISTS geo_budget (
  day    DATE PRIMARY KEY,
  used   INTEGER NOT NULL DEFAULT 0
);
