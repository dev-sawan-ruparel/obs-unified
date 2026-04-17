# Projects + alerts E2E

End-to-end verification of the projects (multi-tenancy) and alerts MVP
against a real `wrangler dev` collector and a real webhook receiver —
no API mocks. Exercises 12 checks covering auth, key lifecycle, project
data isolation, alert rule CRUD, scheduled evaluator, webhook delivery,
state transitions, and idempotence.

## What it verifies

1. Collector health
2. Dashboard session login
3. Default project seeded; create a second project (`acme`)
4. Ingest key creation (`obs_<slug>_<hex>` format, plaintext shown once)
5. Ingest with the new key; bogus key rejected with 401
6. Project isolation: acme's log is invisible from the default project
7. Alert rule create + `/rules/:id/test` preview
8. Scheduled evaluator trigger via `/__scheduled`
9. Webhook delivery with correct `state`, `rule.id`, `projectId`
10. Evaluation row + `alert_state.currentState = firing` persisted
11. Repeat tick on same state does NOT re-fire the webhook
12. Identical rule on default project does not fire on acme's data
13. Key revocation flips `revoked_at` in DB

## One-command run

```bash
# First time: create apps/collector/.dev.vars
cat > apps/collector/.dev.vars <<EOF
DASHBOARD_PASSWORD=e2e-test-pass
ALLOW_UNAUTHENTICATED=false
EOF

scripts/e2e-alerts/run-all.sh
```

`run-all.sh`:
- Resets `apps/collector/.wrangler` and re-applies all 14 migrations
- Starts the webhook receiver on `:9998`
- Starts `wrangler dev --test-scheduled` on `:8790`
- Waits for `/health` to respond
- Runs `run.sh`
- Kills both background services on exit

Defaults to ports `8790` (collector) and `9998` (webhook). Override via
`COLLECTOR_PORT`, `WEBHOOK_PORT`, `DASHBOARD_PASSWORD`, `STATE_DIR`.

## Manual run (three terminals)

Useful for iterating on test logic without restarting services.

```bash
# terminal 1: webhook receiver
node scripts/e2e-alerts/webhook-receiver.mjs

# terminal 2: collector
cd apps/collector
pnpm db:setup          # once, or whenever you want a fresh DB
wrangler dev --port 8790 --local --test-scheduled

# terminal 3: run the test (can repeat)
scripts/e2e-alerts/run.sh
```

## Artifacts

- `run.sh` — 12 checks, expects services already up.
- `run-all.sh` — orchestrator that starts/stops services.
- `webhook-receiver.mjs` — tiny Node HTTP server that logs every POST
  as a JSON line to `$STATE_DIR/webhook.log` (default `/tmp/obs-e2e`).

## Requirements

- `jq` (for JSON assertions)
- `curl`
- Node 20+
- pnpm + wrangler (already repo deps)
