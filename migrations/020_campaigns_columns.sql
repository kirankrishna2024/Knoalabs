-- 020: add missing course_slug column to campaigns (was in newer migration but DB has older version)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS course_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS starts_on DATE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ends_on DATE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add missing columns to campaign_links
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS course_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS medium TEXT;
