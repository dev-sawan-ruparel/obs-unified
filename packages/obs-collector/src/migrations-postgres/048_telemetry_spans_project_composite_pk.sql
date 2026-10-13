-- Migration 048: telemetry_spans composite primary key
-- (project_id, trace_id, span_id)
--
-- Mirrors ../migrations/048_telemetry_spans_project_composite_pk.sql. 001
-- keyed spans by (trace_id, span_id); 010 added project_id outside the key,
-- so ingest's INSERT OR IGNORE (ON CONFLICT DO NOTHING here) silently
-- dropped a span whose ids already existed under another project. Swaps the
-- key for (project_id, trace_id, span_id) in place, keeping every row and
-- index. The old key was unique, so the composite key cannot collide.
--
-- Idempotent: does nothing when the key is already composite.
--
-- Operational note: ADD PRIMARY KEY builds a new unique index under an
-- ACCESS EXCLUSIVE lock. Retention keeps the table bounded, but on a busy
-- database apply it in a quiet window.

UPDATE telemetry_spans SET project_id = 'default' WHERE project_id IS NULL;
ALTER TABLE telemetry_spans ALTER COLUMN project_id SET NOT NULL;

DO $$
DECLARE
  pk_name TEXT;
  pk_def TEXT;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO pk_name, pk_def
    FROM pg_constraint c
   WHERE c.conrelid = 'telemetry_spans'::regclass AND c.contype = 'p';

  IF pk_def IS DISTINCT FROM 'PRIMARY KEY (project_id, trace_id, span_id)' THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE telemetry_spans DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE telemetry_spans ADD PRIMARY KEY (project_id, trace_id, span_id);
  END IF;
END
$$;
