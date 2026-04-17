#!/bin/bash
# End-to-end verification of projects + alerts MVP.
# Assumes:
#   - collector running at COLLECTOR_URL (default http://localhost:8790)
#   - webhook receiver running at WEBHOOK_URL (default http://localhost:9998/fire)
#   - DASHBOARD_PASSWORD matches apps/collector/.dev.vars
#   - $STATE_DIR/webhook.log is being written by the webhook receiver
#
# For a one-command experience that manages services, run:
#   scripts/e2e-alerts/run-all.sh

set -eu
set -o pipefail

COLLECTOR_URL="${COLLECTOR_URL:-http://localhost:8790}"
WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:9998/fire}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"
STATE_DIR="${STATE_DIR:-/tmp/obs-e2e}"
COOKIE_JAR="$STATE_DIR/cookies.txt"
LOG_PATH="$STATE_DIR/webhook.log"

mkdir -p "$STATE_DIR"
rm -f "$COOKIE_JAR"

say() { echo -e "\n\033[1;34m── $* ──\033[0m"; }
ok()  { echo -e "  \033[32m✓\033[0m $*"; }
die() { echo -e "  \033[31m✗\033[0m $*"; exit 1; }
jqv() { jq -r "$@"; }

HDR_JSON='-H Content-Type:application/json'

# ── 0. Health ──
say "0. health check"
curl -fsS "$COLLECTOR_URL/health" >/dev/null || die "collector not responding at $COLLECTOR_URL"
ok "collector up"

# ── 1. Dashboard login ──
say "1. dashboard login"
curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"password\":\"$DASHBOARD_PASSWORD\"}" \
  "$COLLECTOR_URL/auth/login" | jq -e '.success == true' >/dev/null \
  || die "login failed"
ok "session cookie saved to $COOKIE_JAR"

# helper: authed GET/POST (carries session cookie + X-Project-Id)
acurl() {
  local project_id="${1:-default}"; shift
  curl -fsS -b "$COOKIE_JAR" -H "X-Project-Id: $project_id" "$@"
}

# ── 2. Projects: list default, create acme ──
say "2. projects"
PROJECTS=$(acurl default "$COLLECTOR_URL/internal/projects")
echo "  initial: $(echo "$PROJECTS" | jq -c '.projects | map(.slug)')"
echo "$PROJECTS" | jq -e '.projects | map(.slug) | contains(["default"])' >/dev/null \
  || die "default project missing"
ok "default project present"

CREATE=$(acurl default -X POST -H "Content-Type: application/json" \
  -d '{"name":"Acme","slug":"acme"}' \
  "$COLLECTOR_URL/internal/projects")
ACME_ID=$(echo "$CREATE" | jq -r '.project.id')
[ -n "$ACME_ID" ] && [ "$ACME_ID" != "null" ] || die "project id missing"
ok "acme created (id=$ACME_ID)"

# ── 3. Keys: create one for acme, verify prefix ──
say "3. ingest keys"
KEY_RESP=$(acurl default -X POST -H "Content-Type: application/json" \
  -d '{"name":"e2e"}' \
  "$COLLECTOR_URL/internal/projects/$ACME_ID/keys")
ACME_KEY=$(echo "$KEY_RESP" | jq -r '.key')
KEY_ID=$(echo "$KEY_RESP" | jq -r '.id')
KEY_PREFIX=$(echo "$KEY_RESP" | jq -r '.keyPrefix')
[[ "$ACME_KEY" == obs_acme_* ]] || die "key format wrong: $ACME_KEY"
[[ "$KEY_PREFIX" == obs_acme_* ]] || die "prefix format wrong: $KEY_PREFIX"
ok "key created prefix=$KEY_PREFIX"

# List keys and verify only one (non-revoked)
LIST=$(acurl default "$COLLECTOR_URL/internal/projects/$ACME_ID/keys")
echo "$LIST" | jq -e --arg id "$KEY_ID" '.keys | map(select(.id==$id)) | length == 1' >/dev/null \
  || die "key not listed"
ok "key listed"

# ── 4. Ingest: log with acme key ──
say "4. ingest"
INGEST_RESP=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACME_KEY" \
  -d '{"logs":[{"severity":"ERROR","message":"e2e-trigger-1","serviceName":"checkout"}]}' \
  "$COLLECTOR_URL/v1/logs")
echo "$INGEST_RESP" | jq -e '.accepted == 1' >/dev/null || die "ingest failed"
ok "log ingested under acme"

# Negative: bogus key → 401
BOGUS=$(curl -sS -o "$STATE_DIR/bogus.json" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer obs_acme_deadbeef_not_a_real_key" \
  -d '{"logs":[{"severity":"ERROR","message":"nope"}]}' \
  "$COLLECTOR_URL/v1/logs")
[ "$BOGUS" = "401" ] || die "bogus key should 401, got $BOGUS"
ok "unknown key rejected with 401"

# ── 5. Project isolation on logs query ──
say "5. project isolation"
LOGS_ACME=$(acurl "$ACME_ID" "$COLLECTOR_URL/internal/logs/overview?hours=24")
ACME_COUNT=$(echo "$LOGS_ACME" | jq -r '.logs | length')
[ "$ACME_COUNT" -ge 1 ] || die "acme logs missing (got $ACME_COUNT)"
ok "acme sees $ACME_COUNT log(s)"

LOGS_DEFAULT=$(acurl default "$COLLECTOR_URL/internal/logs/overview?hours=24")
DEFAULT_COUNT=$(echo "$LOGS_DEFAULT" | jq -r '.logs | map(select(.message=="e2e-trigger-1")) | length')
[ "$DEFAULT_COUNT" = "0" ] || die "isolation broken: default sees acme's log ($DEFAULT_COUNT)"
ok "default does NOT see acme's log"

# ── 6. Alert rule: logs ERROR severity >= 1 over 5 min ──
say "6. alert rule"
RULE_BODY=$(cat <<JSON
{
  "name": "E2E error logs",
  "signal": "logs",
  "query": {"severity": "ERROR"},
  "threshold": 1,
  "windowMins": 5,
  "comparison": ">=",
  "channels": [{"type": "webhook", "url": "$WEBHOOK_URL"}]
}
JSON
)
RULE_RESP=$(acurl "$ACME_ID" -X POST -H "Content-Type: application/json" \
  -d "$RULE_BODY" "$COLLECTOR_URL/internal/alerts/rules")
RULE_ID=$(echo "$RULE_RESP" | jq -r '.rule.id')
[ -n "$RULE_ID" ] && [ "$RULE_ID" != "null" ] || die "rule creation failed: $RULE_RESP"
ok "rule created id=$RULE_ID"

# Test endpoint returns live count (should be >= 1 because of the earlier log).
TEST_RESP=$(acurl "$ACME_ID" -X POST "$COLLECTOR_URL/internal/alerts/rules/$RULE_ID/test")
TEST_VAL=$(echo "$TEST_RESP" | jq -r '.value')
TEST_FIRE=$(echo "$TEST_RESP" | jq -r '.wouldFire')
[ "$TEST_VAL" -ge 1 ] && [ "$TEST_FIRE" = "true" ] \
  || die "test preview should fire, got value=$TEST_VAL wouldFire=$TEST_FIRE"
ok "test preview: value=$TEST_VAL wouldFire=$TEST_FIRE"

# ── 7. Trigger the evaluator via wrangler's /__scheduled ──
say "7. trigger scheduled evaluator"
# reset webhook log before triggering
: > "$LOG_PATH"
SCHED_CODE=$(curl -sS -o "$STATE_DIR/sched.out" -w "%{http_code}" \
  "$COLLECTOR_URL/__scheduled?cron=*%2F5+*+*+*+*")
[ "$SCHED_CODE" = "200" ] || die "scheduled dispatch failed (HTTP $SCHED_CODE): $(cat "$STATE_DIR/sched.out")"
ok "scheduled dispatch returned 200"

# give webhook a moment to land (best-effort async delivery in worker)
sleep 2

# ── 8. Webhook delivered ──
say "8. webhook delivery"
if [ ! -s "$LOG_PATH" ]; then
  die "no webhook received (log empty)"
fi
WEBHOOK_RECORD=$(tail -n 1 "$LOG_PATH")
echo "  record: $WEBHOOK_RECORD" | head -c 300; echo
STATE=$(echo "$WEBHOOK_RECORD" | jq -r '.body.state')
RULE_ECHOED=$(echo "$WEBHOOK_RECORD" | jq -r '.body.rule.id')
PROJECT_ECHOED=$(echo "$WEBHOOK_RECORD" | jq -r '.body.projectId')
[ "$STATE" = "firing" ] || die "state should be 'firing', got '$STATE'"
[ "$RULE_ECHOED" = "$RULE_ID" ] || die "rule id mismatch: $RULE_ECHOED vs $RULE_ID"
[ "$PROJECT_ECHOED" = "$ACME_ID" ] || die "project id mismatch: $PROJECT_ECHOED vs $ACME_ID"
ok "webhook received with state=firing, rule=$RULE_ID, project=$ACME_ID"

# ── 9. Evaluation row + state persisted ──
say "9. evaluation + state persisted"
EVAL=$(acurl "$ACME_ID" "$COLLECTOR_URL/internal/alerts/evaluations?ruleId=$RULE_ID&hours=1")
EVAL_COUNT=$(echo "$EVAL" | jq -r '.evaluations | length')
[ "$EVAL_COUNT" -ge 1 ] || die "no evaluations recorded"
FIRING_EVALS=$(echo "$EVAL" | jq -r '.evaluations | map(select(.state=="firing")) | length')
[ "$FIRING_EVALS" -ge 1 ] || die "no firing evaluation recorded"
ok "$EVAL_COUNT evaluation(s) recorded, $FIRING_EVALS firing"

RULE_AFTER=$(acurl "$ACME_ID" "$COLLECTOR_URL/internal/alerts/rules" | jq -c --arg id "$RULE_ID" '.rules | map(select(.id==$id))[0]')
CURRENT_STATE=$(echo "$RULE_AFTER" | jq -r '.currentState')
[ "$CURRENT_STATE" = "firing" ] || die "rule currentState should be 'firing', got '$CURRENT_STATE'"
ok "rule currentState=firing"

# ── 10. Idempotence: second tick should NOT re-fire webhook ──
say "10. idempotence: repeat scheduled tick"
: > "$LOG_PATH"
curl -fsS "$COLLECTOR_URL/__scheduled?cron=*%2F5+*+*+*+*" >/dev/null
sleep 2
EXTRA=$(wc -l < "$LOG_PATH" | tr -d ' ')
[ "$EXTRA" = "0" ] || die "webhook should NOT fire on repeat — got $EXTRA extra deliveries"
ok "no re-delivery on same-state tick"

# ── 11. Isolation: default project rule does NOT fire on acme's data ──
say "11. default-project rule stays quiet"
DEFAULT_RULE=$(acurl default -X POST -H "Content-Type: application/json" \
  -d "$RULE_BODY" "$COLLECTOR_URL/internal/alerts/rules")
DEFAULT_RULE_ID=$(echo "$DEFAULT_RULE" | jq -r '.rule.id')
DTEST=$(acurl default -X POST "$COLLECTOR_URL/internal/alerts/rules/$DEFAULT_RULE_ID/test")
DTEST_VAL=$(echo "$DTEST" | jq -r '.value')
DTEST_FIRE=$(echo "$DTEST" | jq -r '.wouldFire')
[ "$DTEST_VAL" = "0" ] && [ "$DTEST_FIRE" = "false" ] \
  || die "default rule should NOT fire — value=$DTEST_VAL wouldFire=$DTEST_FIRE"
ok "default-project rule test returns value=0, wouldFire=false"

# ── 12. Revoke key → ingest rejected after cache expiry ──
say "12. revoke key (note: 60s cache means 401 takes up to 60s; we verify DB state here)"
acurl default -X DELETE "$COLLECTOR_URL/internal/projects/$ACME_ID/keys/$KEY_ID" >/dev/null
AFTER=$(acurl default "$COLLECTOR_URL/internal/projects/$ACME_ID/keys" \
  | jq -c --arg id "$KEY_ID" '.keys | map(select(.id==$id))[0] | {revokedAt}')
echo "  $AFTER"
echo "$AFTER" | jq -e '.revokedAt != null' >/dev/null || die "revokedAt not set"
ok "key revoked in DB"

echo -e "\n\033[1;32m══ ALL E2E CHECKS PASSED ══\033[0m"
