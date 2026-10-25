-- 024: a form can now drop built-in questions ("I am a", names, mobile when an email is kept ...). Their leads columns must accept "not asked":
-- before this, publishing a form without "I am a" made every registration fail with HTTP 500 (leads.status was NOT NULL).
ALTER TABLE leads ALTER COLUMN status DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN last_name DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN full_name SET DEFAULT '';
ALTER TABLE leads ALTER COLUMN full_name DROP NOT NULL;
