-- Make active-incident deduplication race-free (RFC 0013 § 6.A, governance review B4).
--
-- `openOrDeduplicateIncident` used to SELECT-then-INSERT, so two concurrent
-- alerts for the same symptom could each open an incident. A partial UNIQUE
-- index lets the database arbitrate; the application inserts with
-- ON CONFLICT DO NOTHING and re-reads the winner.

-- Collapse any pre-existing duplicate active rows (keep the newest per key) so
-- the index can be built. Older duplicates are closed as escalated, not deleted.
UPDATE incident_investigations
SET status = 'escalated'
WHERE status IN ('open', 'dispatched', 'leased', 'remediating', 'verifying')
  AND EXISTS (
    SELECT 1 FROM incident_investigations o
    WHERE o.project_id = incident_investigations.project_id
      AND o.environment = incident_investigations.environment
      AND o.dedup_key = incident_investigations.dedup_key
      AND o.status IN ('open', 'dispatched', 'leased', 'remediating', 'verifying')
      AND (
        o.opened_at > incident_investigations.opened_at
        OR (o.opened_at = incident_investigations.opened_at AND o.id > incident_investigations.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_incidents_active_dedup
  ON incident_investigations (project_id, environment, dedup_key)
  WHERE status IN ('open', 'dispatched', 'leased', 'remediating', 'verifying');

-- Watchdog (governance review B11): a finding is only `recovered` after two
-- consecutive checkpoints with sufficient traffic and a healthy error rate.
ALTER TABLE investigation_findings ADD COLUMN consecutive_ok_checks INTEGER NOT NULL DEFAULT 0;
