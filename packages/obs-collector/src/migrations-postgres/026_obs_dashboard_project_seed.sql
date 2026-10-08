INSERT INTO projects (id, name, slug, created_at)
VALUES ('obs-dashboard', 'Obs Dashboard', 'obs-dashboard', now()::text)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ingest_keys (id, project_id, key_hash, key_prefix, name, created_at)
VALUES (
  'obs-dashboard-bootstrap',
  'obs-dashboard',
  decode('6aa18dc1261b312e98b236d5a7dae698d1a90ecbe33d8024744063a066a35b9b', 'hex'),
  'obs_dashboard_65',
  'bootstrap',
  now()::text
)
ON CONFLICT (id) DO NOTHING;
