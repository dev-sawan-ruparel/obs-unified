-- Service-map performance indices.
--
-- Two queries blow up at ~100k+ spans without these:
--   1. The whole service-map endpoint filters by project_id + received_at
--      window, but the existing idx_spans_received_at is single-column
--      (received_at DESC) and can't prune on project_id, so multi-tenant
--      installs scan the world.
--   2. The new async-edge query (added in 522424e) gates on
--      `links_json IS NOT NULL AND links_json != '[]'`. Without an index
--      that knows about that predicate, every row gets a json_each call
--      even when the column is NULL — order-of-magnitude slower than it
--      needs to be.
--
-- Both indices target (project_id, received_at DESC) as the leading
-- columns so range queries hit the index first and project filtering is
-- free. The partial index for links is much smaller than the full one
-- (links_json is non-empty on a small fraction of spans) so the planner
-- prefers it for the link-follow path.

CREATE INDEX IF NOT EXISTS idx_spans_project_received
	ON telemetry_spans (project_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_with_links
	ON telemetry_spans (project_id, received_at DESC)
	WHERE links_json IS NOT NULL AND links_json != '[]';

-- Same scoping for service-name lookups: the per-service operations
-- query (used by the click-through drawer) filters by
-- (project_id, service_name, received_at). Existing idx_spans_service
-- is service_name-only.
CREATE INDEX IF NOT EXISTS idx_spans_project_service_received
	ON telemetry_spans (project_id, service_name, received_at DESC);
