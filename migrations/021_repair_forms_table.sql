-- migrate:allow-edit
-- 021: repair a `forms` table that was created by an earlier, incompatible schema (011 uses CREATE TABLE IF NOT EXISTS, so such a
-- table was kept as it was). Plain SQL, safe to run again, and the runner records it (the previous version of this file inserted its
-- own schema_migrations row and ran BEGIN/COMMIT, which made the runner fail with a duplicate key and left a wrong checksum behind).
--
-- Target model: id, course_slug, path, name, type_label, status, current_version, published_version, created_at, updated_at.
-- The status CHECK is repaired separately in 023 (a stale check that does not allow 'archived' caused HTTP 500 on archive).

-- the registration page is found by path or course_slug: neither may be empty
UPDATE forms SET path = course_slug WHERE (path IS NULL OR path = '') AND course_slug IS NOT NULL AND course_slug <> '';
UPDATE forms SET course_slug = path WHERE (course_slug IS NULL OR course_slug = '') AND path IS NOT NULL AND path <> '';
ALTER TABLE forms ALTER COLUMN path SET NOT NULL;
ALTER TABLE forms ALTER COLUMN course_slug SET NOT NULL;

-- one form per link key (011 creates this as a unique index; a legacy table may already have it as a constraint of the same name)
CREATE UNIQUE INDEX IF NOT EXISTS forms_course_slug_key ON forms (course_slug);
