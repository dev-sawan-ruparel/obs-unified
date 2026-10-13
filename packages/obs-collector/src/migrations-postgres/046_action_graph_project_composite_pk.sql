-- Migration 046: action graph tables keyed by (project_id, id)
--
-- Mirrors ../migrations/046_action_graph_project_composite_pk.sql. The 031
-- spine and leaf tables used `id TEXT PRIMARY KEY`; action ids are
-- client-supplied and leaf ids are raw OTel span ids, so two projects can
-- emit the same id and the ON CONFLICT(id) upserts let one tenant overwrite
-- another's row. Swaps each key for (project_id, id) in place, keeping every
-- row and index (031, 038, 044). The old keys were unique, so the composite
-- keys cannot collide.
--
-- Idempotent: each table is skipped when its primary key is already
-- (project_id, id).

DO $$
DECLARE
  t TEXT;
  pk_name TEXT;
  pk_def TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'actions', 'agent_runs', 'tool_calls', 'retrieval_events',
    'eval_results', 'artifacts'
  ] LOOP
    pk_name := NULL;
    pk_def := NULL;
    SELECT c.conname, pg_get_constraintdef(c.oid)
      INTO pk_name, pk_def
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'p';

    IF pk_def IS DISTINCT FROM 'PRIMARY KEY (project_id, id)' THEN
      IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, pk_name);
      END IF;
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (project_id, id)', t);
    END IF;
  END LOOP;
END
$$;
