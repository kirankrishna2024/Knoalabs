-- 009: link opens. One row per visitor, per day, per link (master class + ad tags) when the registration page is opened
-- in a real browser (a small script on the page reports it; crawlers and link-preview bots never run it).
-- No IP, no user agent, no full referrer URL is stored: only the referring site's host name.
-- dedupe_key = visitor | day | master class | utm_source | utm_medium | utm_campaign  -> a refresh never counts twice.
-- bucket = start of the 15-minute slot (ms since epoch): lets analytics group in SQL instead of loading every row.
CREATE TABLE IF NOT EXISTS page_visits (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  bucket        BIGINT NOT NULL,
  dedupe_key    TEXT NOT NULL,
  course_slug   TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  referrer_host TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS page_visits_dedupe_key ON page_visits (dedupe_key);
CREATE INDEX IF NOT EXISTS page_visits_created_at_idx ON page_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS page_visits_course_slug_idx ON page_visits (course_slug);
