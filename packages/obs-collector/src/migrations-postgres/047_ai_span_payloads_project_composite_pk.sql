-- Migration 047: ai_span_payloads composite primary key
-- (project_id, trace_id, span_id)
--
-- Mirrors ../migrations/047_ai_span_payloads_project_composite_pk.sql. 019
-- keyed the payload side table by (trace_id, span_id) only; the processor's
-- ON CONFLICT(trace_id, span_id) upsert let a second project replace the
-- first project's prompt/completion payloads. Swaps the key for
-- (project_id, trace_id, span_id) in place, keeping every row and index.
-- The old key was unique, so the composite key cannot collide.
--
-- Idempotent: does nothing when the key is already composite.

DO $$
DECLARE
  pk_name TEXT;
  pk_def TEXT;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO pk_name, pk_def
    FROM pg_constraint c
   WHERE c.conrelid = 'ai_span_payloads'::regclass AND c.contype = 'p';

  IF pk_def IS DISTINCT FROM 'PRIMARY KEY (project_id, trace_id, span_id)' THEN
    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE ai_span_payloads DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE ai_span_payloads ADD PRIMARY KEY (project_id, trace_id, span_id);
  END IF;
END
$$;
