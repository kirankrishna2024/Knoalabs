-- 017: exact location the visitor allows the browser to share (Geolocation API). Kept apart from the IP-based geo_* columns,
-- so the approximate city/country from ipapi.co and the precise browser coordinates can both be stored.
-- Nothing is written unless the person allows location in their browser (or has allowed it before).
-- ROLLBACK (manual): ALTER TABLE leads DROP COLUMN IF EXISTS browser_geo_at, browser_accuracy, browser_lon, browser_lat;
--                    ALTER TABLE page_visits DROP COLUMN IF EXISTS browser_geo_at, browser_accuracy, browser_lon, browser_lat;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS browser_lat NUMERIC(9,6);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS browser_lon NUMERIC(9,6);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS browser_accuracy NUMERIC(10,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS browser_geo_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS leads_browser_geo_idx ON leads (browser_lat, browser_lon);

ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS browser_lat NUMERIC(9,6);
ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS browser_lon NUMERIC(9,6);
ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS browser_accuracy NUMERIC(10,2);
ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS browser_geo_at TIMESTAMPTZ;
