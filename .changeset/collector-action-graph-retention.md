---
"@obsunified/collector": patch
---

Retention cleanup now expires the RFC 0010 action graph.

`createRetentionCleanupHandler()` purges `actions` and their `agent_runs`,
`tool_calls`, `retrieval_events`, `eval_results` and `artifacts` rows once a
whole causal tree (`project_id`, `root_action_id`) is older than
`RETENTION_HOURS`, judged by `actions.started_at`. Trees are deleted whole in
bounded batches, each inside one `SqlDb.batch`, with leaves removed before the
spine. A tree is kept while any action in it is fresh or unfinished, its agent
run is still `running`, or an `eval_cases` row in the same project references
it. `RetentionCleanupSummary` gains `actions` and `action_leaves`;
`purgeExpiredActionGraph` and `actionRetentionCutoff` are exported for hosts
that schedule retention themselves.

Migration `044_actions_started_at_index.sql` (SQLite/D1 and Postgres) adds
`idx_actions_started_at`; run your migration step before deploying.

Known limits: expired trees with more actions than the per-batch cap (500 by
default) are retained intact and logged as `oversized_trees` rather than
deleted in pieces; artifact blobs behind `storage_ref` are not deleted; and on
Postgres (READ COMMITTED) an ingest into an already-expired tree that commits
between that tree's leaf deletes and its spine delete can leave the spine
without its leaves. D1 batches run as one serialized SQLite transaction and do
not have that window.
