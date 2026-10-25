-- 004: expanded registration form fields.
-- Student / Fresher branch: course, current status, college name.
-- Working Professional branch: current role, current company.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS student_course            TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS student_status           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS college_name             TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_role           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS current_company          TEXT;
