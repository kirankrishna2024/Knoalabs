-- 016: campaigns belong to a form (one form -> many campaigns, at most one active), the detected ad source is stored
-- with link opens too, and every form path is unique (a form created on its own is served by its path).
-- ROLLBACK (manual): DROP INDEX campaigns_one_active_per_form; recreate campaigns_one_active_per_course;
--                   ALTER TABLE page_visits DROP COLUMN source_detected, DROP COLUMN source_method; DROP INDEX forms_path_key;

-- which ad click id / referrer / in-app browser the visit came from (src/sources.js), so analytics can use it when
-- the link carries no utm_source (auto-detect)
ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS source_detected TEXT;
ALTER TABLE page_visits ADD COLUMN IF NOT EXISTS source_method TEXT;
CREATE INDEX IF NOT EXISTS page_visits_source_detected_idx ON page_visits (source_detected);

-- existing campaigns already have form_id (campaigns.create has always saved it); a campaign without one simply has no
-- plain-link redirect, so there is nothing to backfill here.

-- one active campaign per FORM now (the form's plain link forwards to it)
DROP INDEX IF EXISTS campaigns_one_active_per_course;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_active_per_form ON campaigns (form_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS campaigns_form_idx ON campaigns (form_id, status);

-- a form created on its own gets its link from its name: two forms must never share a link
CREATE UNIQUE INDEX IF NOT EXISTS forms_path_key ON forms (path);
