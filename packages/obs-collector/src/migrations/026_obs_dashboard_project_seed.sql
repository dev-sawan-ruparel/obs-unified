-- Seed a separate `obs-dashboard` project for the dashboard's own self-telemetry,
-- so dogfooded page_views / errors / interactions don't pollute the `default`
-- project that holds real demo + customer traffic.
INSERT OR IGNORE INTO projects (id, name, slug, created_at)
VALUES ('obs-dashboard', 'Obs Dashboard', 'obs-dashboard', datetime('now'));

-- Deterministic ingest key whose plaintext lives in apps/web/.env.development.local
-- (VITE_OBS_INGEST_KEY). Re-running this migration is a no-op via INSERT OR IGNORE
-- on the unique key_hash.
INSERT OR IGNORE INTO ingest_keys (id, project_id, key_hash, key_prefix, name, created_at)
VALUES (
  'obs-dashboard-bootstrap',
  'obs-dashboard',
  '6aa18dc1261b312e98b236d5a7dae698d1a90ecbe33d8024744063a066a35b9b',
  'obs_dashboard_65',
  'bootstrap',
  datetime('now')
);
