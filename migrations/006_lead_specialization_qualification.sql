-- 006: two optional form fields.
-- Student / Fresher: specialization / branch.  Working Professional: highest qualification.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS specialization         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS highest_qualification  TEXT;
