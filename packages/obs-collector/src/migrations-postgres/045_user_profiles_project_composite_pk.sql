-- Migration 045: user_profiles composite primary key (project_id, user_id)
--
-- Mirrors ../migrations/045_user_profiles_project_composite_pk.sql. The 006
-- table used `user_id TEXT PRIMARY KEY`; 010 added project_id outside the
-- key, so /v1/identify's ON CONFLICT(user_id) upsert let one project rewrite
-- another project's profile. Swaps the key for (project_id, user_id) in
-- place, keeping every row and index. The old key was unique, so the
-- composite key cannot collide.
--
-- Idempotent: the block looks up the current primary key by definition and
-- does nothing when it is already (project_id, user_id).

UPDATE user_profiles SET project_id = 'default' WHERE project_id IS NULL;
ALTER TABLE user_profiles ALTER COLUMN project_id SET NOT NULL;

DO $$
DECLARE
  pk_name TEXT;
  pk_def TEXT;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO pk_name, pk_def
    FROM pg_constraint c
   WHERE c.conrelid = 'user_profiles'::regclass AND c.contype = 'p';

  IF pk_def IS DISTINCT FROM 'PRIMARY KEY (project_id, user_id)' THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE user_profiles DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE user_profiles ADD PRIMARY KEY (project_id, user_id);
  END IF;
END
$$;
