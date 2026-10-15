-- 007: master classes are managed from the admin panel.
-- slug  = key stored on every lead (lowercase letters/digits only, e.g. "datascience")
-- path  = the link people open (e.g. "data-science" -> https://your-site/data-science)
-- The three default master classes are seeded and cannot be deleted from the panel.
CREATE TABLE IF NOT EXISTS courses (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO courses (slug, name, path, is_default, sort_order) VALUES ('datascience', 'Data Science', 'datascience', true, 1) ON CONFLICT (slug) DO NOTHING;
INSERT INTO courses (slug, name, path, is_default, sort_order) VALUES ('cybersecurity', 'Cyber Security', 'cybersecurity', true, 2) ON CONFLICT (slug) DO NOTHING;
INSERT INTO courses (slug, name, path, is_default, sort_order) VALUES ('generativeai', 'Generative AI', 'generative-ai', true, 3) ON CONFLICT (slug) DO NOTHING;
