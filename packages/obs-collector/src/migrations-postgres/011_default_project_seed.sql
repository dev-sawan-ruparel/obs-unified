-- Seed the default project. Existing rows already carry project_id='default'
-- via migration 010's column default.
INSERT INTO projects (id, name, slug, created_at)
VALUES ('default', 'Default', 'default', now()::text)
ON CONFLICT (id) DO NOTHING;
