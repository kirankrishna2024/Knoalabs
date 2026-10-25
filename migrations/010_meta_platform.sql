-- 010: which Meta app brought the person: Facebook / Instagram / Messenger / Audience Network, and the ad placement
-- (Meta fills {{site_source_name}} and {{placement}} into the ad link at click time; see src/meta.js).
-- Both columns are NULL for traffic that is not Meta and for everything recorded before this migration (old rows are
-- still split on the analytics page where the referrer, utm_source or in-app browser named the app).
-- Only the app name and the placement text are kept: no user agent is stored for link opens.
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS meta_platform  TEXT;
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS meta_placement TEXT;
ALTER TABLE page_visits  ADD COLUMN IF NOT EXISTS meta_platform  TEXT;
ALTER TABLE page_visits  ADD COLUMN IF NOT EXISTS meta_placement TEXT;
