#!/bin/bash
# End-to-end live verification of RFC 0013 (AutoSRE causal ontology, change
# correlation, incident memory, pre-execution remediation gate, CLI, and MCP).
#
# For a one-command experience that manages D1 migrations and wrangler dev, run:
#   scripts/e2e-autosre/run-all.sh

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_URL="${COLLECTOR_URL:-http://localhost:8790}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"
DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-e2e-dashboard-token}"
if [ -z "${INGEST_KEY:-}" ]; then
  INGEST_KEY="$(grep -E '^INGEST_KEY=' "$REPO_ROOT/apps/collector/.dev.vars" 2>/dev/null | head -1 | cut -d= -f2-)"
fi
[ -n "$INGEST_KEY" ] || { echo "INGEST_KEY not set and not found in apps/collector/.dev.vars" >&2; exit 1; }
STATE_DIR="${STATE_DIR:-$REPO_ROOT/.dev/e2e-autosre}"
COOKIE_JAR="$STATE_DIR/cookies.txt"

mkdir -p "$STATE_DIR"
rm -f "$COOKIE_JAR"

say() { echo -e "\n\033[1;34m── $* ──\033[0m"; }
ok()  { echo -e "  \033[32m✓\033[0m $*"; }
die() { echo -e "  \033[31m✗\033[0m $*"; exit 1; }

# ── 0. Health check ──
say "0. collector health check"
curl -fsS "$COLLECTOR_URL/health" >/dev/null || die "collector not responding at $COLLECTOR_URL"
ok "collector healthy at $COLLECTOR_URL"

# ── 1. Dashboard login (human operator session cookie) ──
say "1. human operator login (/auth/login)"
curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"password\":\"$DASHBOARD_PASSWORD\"}" \
  "$COLLECTOR_URL/auth/login" | jq -e '.success == true' >/dev/null \
  || die "dashboard login failed"
ok "human session cookie saved"

# Helper: human session request (Cookie)
hcurl() {
  curl -fsS -b "$COOKIE_JAR" -H "X-Project-Id: default" "$@"
}

# Helper: agent bearer token request (Authorization: Bearer)
acurl() {
  curl -fsS -H "Authorization: Bearer $DASHBOARD_TOKEN" -H "X-Project-Id: default" "$@"
}

# ── 2. Run Scenario D Seeder (--scenario autosre) ──
say "2. seed Scenario D (scripts/seed-everything/run.mjs --scenario autosre)"
node "$REPO_ROOT/scripts/seed-everything/run.mjs" \
  --collector "$COLLECTOR_URL" \
  --password "$DASHBOARD_PASSWORD" \
  --key "$INGEST_KEY" \
  --scenario autosre
ok "Scenario D seeded onto live D1 collector"

# ── 3. Verify CLI: obs-unified changes record & list ──
say "3. verify @obsunified/cli changes record & list"
CLI_RECORD=$(node "$REPO_ROOT/packages/cli/dist/cli.js" changes record \
  --url "$COLLECTOR_URL" \
  --api-key "$INGEST_KEY" \
  --environment prod \
  --kind feature_flag \
  --service checkout-api \
  --version 2.4.1 \
  --commit-sha 2222222 \
  --summary "Enable new-checkout-flow treatment flag" \
  --touched-paths "src/checkout/charge.ts")
echo "$CLI_RECORD" | grep -qi "recorded change" || die "CLI changes record failed: $CLI_RECORD"
ok "obs-unified changes record succeeded ($CLI_RECORD)"

CLI_LIST=$(node "$REPO_ROOT/packages/cli/dist/cli.js" changes list \
  --url "$COLLECTOR_URL" \
  --token "$DASHBOARD_TOKEN" \
  --environment prod \
  --service checkout-api)
echo "$CLI_LIST" | grep -q "chg_scenario_d_deploy_241" || die "CLI changes list missing chg_scenario_d_deploy_241: $CLI_LIST"
ok "obs-unified changes list returned chg_scenario_d_deploy_241"

# ── 4. Verify Change Blast Radius & Cohort Attribution ──
say "4. verify traffic-normalized cohort lift (/internal/changes/:id/blast-radius)"
BLAST=$(acurl "$COLLECTOR_URL/internal/changes/chg_scenario_d_deploy_241/blast-radius?environment=prod")
VERDICT=$(echo "$BLAST" | jq -r '.cohortVerdict')
PROOF_TIER=$(echo "$BLAST" | jq -r '.causalProofTier')
RR=$(echo "$BLAST" | jq -r '.relativeRisk')
OVERLAP_LEN=$(echo "$BLAST" | jq -r '.overlappingCodePaths | length')
[ "$VERDICT" = "isolated_to_new_version" ] || die "expected cohortVerdict=isolated_to_new_version, got $VERDICT ($BLAST)"
[ "$PROOF_TIER" = "cohort_rate_isolated" ] || die "expected causalProofTier=cohort_rate_isolated, got $PROOF_TIER"
[ "$OVERLAP_LEN" -ge 1 ] || die "expected >=1 overlappingCodePaths, got $OVERLAP_LEN"
ok "blast-radius cohortVerdict=$VERDICT causalProofTier=$PROOF_TIER relativeRisk=${RR}x overlappingCodePaths=$OVERLAP_LEN"

# ── 5. Verify Ontology Topology & Connected Rail Dual Epistemic Badges ──
say "5. verify ontology topology & Connected Rail (/internal/connected/incident/:id)"
TOPO=$(acurl "$COLLECTOR_URL/internal/ontology?environment=prod")
NODE_COUNT=$(echo "$TOPO" | jq -r '.nodes | length')
[ "$NODE_COUNT" -ge 1 ] || die "expected >=1 ontology node, got $NODE_COUNT"
ok "ontology topology has $NODE_COUNT node(s) in prod"

RAIL=$(acurl "$COLLECTOR_URL/internal/connected/incident/inc_scenario_d")
CERTAINTY=$(echo "$RAIL" | jq -r '[.across[].links[] | select(.entityKind=="finding")][0].relationshipCertainty')
FINDING_PROOF=$(echo "$RAIL" | jq -r '[.across[].links[] | select(.entityKind=="finding")][0].causalProofTier')
[ "$CERTAINTY" = "exact" ] || die "expected relationshipCertainty=exact, got $CERTAINTY"
[ "$FINDING_PROOF" = "counterfactual_verified" ] || die "expected causalProofTier=counterfactual_verified, got $FINDING_PROOF"
ok "Connected Rail incident->finding pivot carries relationshipCertainty=$CERTAINTY + causalProofTier=$FINDING_PROOF"

# ── 6. Verify CCR triage_incident Bundle ──
say "6. verify CCR triage_incident bundle (POST /internal/evidence/bundle)"
BUNDLE=$(acurl -X POST -H "Content-Type: application/json" \
  -d '{"anchor":{"entityKind":"incident","entityId":"inc_scenario_d"},"intent":"triage_incident"}' \
  "$COLLECTOR_URL/internal/evidence/bundle")
BUNDLE_INTENT=$(echo "$BUNDLE" | jq -r '.intent')
BUNDLE_CHG_COUNT=$(echo "$BUNDLE" | jq -r '.autosre.candidateChanges | length')
BUNDLE_FND_COUNT=$(echo "$BUNDLE" | jq -r '.autosre.priorFindings | length')
[ "$BUNDLE_INTENT" = "triage_incident" ] || die "expected bundle intent triage_incident, got $BUNDLE_INTENT"
[ "$BUNDLE_CHG_COUNT" -ge 1 ] || die "expected >=1 candidate change in bundle, got $BUNDLE_CHG_COUNT"
[ "$BUNDLE_FND_COUNT" -ge 1 ] || die "expected >=1 prior finding in bundle, got $BUNDLE_FND_COUNT"
ok "CCR triage_incident bundle returned $BUNDLE_CHG_COUNT candidate change(s) and $BUNDLE_FND_COUNT prior finding(s)"

# ── 7. Verify Governance Boundary: Agent Bearer Token Cannot Approve Remediation ──
say "7. verify pre-execution remediation governance boundary"
PROPOSALS=$(acurl "$COLLECTOR_URL/internal/remediations?environment=prod&incidentId=inc_scenario_d")
PROPOSAL_ID=$(echo "$PROPOSALS" | jq -r '.proposals[0].id')
PROPOSAL_STATUS=$(echo "$PROPOSALS" | jq -r '.proposals[0].status')
[ "$PROPOSAL_STATUS" = "pending_human_approval" ] || die "expected pending_human_approval, got $PROPOSAL_STATUS"
ok "found pending proposal $PROPOSAL_ID (status=$PROPOSAL_STATUS)"

AGENT_APPROVE_CODE=$(curl -sS -o "$STATE_DIR/agent_approve.json" -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $DASHBOARD_TOKEN" -H "X-Project-Id: default" \
  -H "Content-Type: application/json" -d '{"environment":"prod"}' \
  "$COLLECTOR_URL/internal/remediations/$PROPOSAL_ID/approve")
[ "$AGENT_APPROVE_CODE" = "403" ] || die "agent bearer token approve should return 403, got $AGENT_APPROVE_CODE"
ok "agent bearer token rejected with HTTP 403 on /approve"

# ── 8. Human Session Approves Proposal → Single-Use Grant Token Issued ──
say "8. human operator approves proposal → single-use grant token issued"
APPROVE_RESP=$(hcurl -X POST -H "Content-Type: application/json" \
  -H "X-Obs-User-Actor: sre-lead@acme.dev" \
  -d '{"environment":"prod"}' \
  "$COLLECTOR_URL/internal/remediations/$PROPOSAL_ID/approve")
GRANT_TOKEN=$(echo "$APPROVE_RESP" | jq -r '.grantToken')
NEW_STATUS=$(echo "$APPROVE_RESP" | jq -r '.proposal.status')
[[ "$GRANT_TOKEN" == rgt_* ]] || die "expected rgt_* grant token, got $GRANT_TOKEN"
[ "$NEW_STATUS" = "grant_issued" ] || die "expected status=grant_issued, got $NEW_STATUS"
ok "human approval issued single-use grant token (${GRANT_TOKEN:0:16}...)"

# ── 9. Claim Grant Token, Verify Replay Rejection, Complete Rollback ──
say "9. claim grant token, verify single-use replay rejection, and complete rollback"
CLAIM_RESP=$(acurl -X POST -H "Content-Type: application/json" \
  -d "{\"environment\":\"prod\",\"grantToken\":\"$GRANT_TOKEN\",\"runnerId\":\"deploy-runner-1\"}" \
  "$COLLECTOR_URL/internal/remediations/$PROPOSAL_ID/claim")
CLAIM_STATUS=$(echo "$CLAIM_RESP" | jq -r '.proposal.status')
[ "$CLAIM_STATUS" = "claimed_executing" ] || die "expected claimed_executing, got $CLAIM_STATUS"
ok "grant claimed (status=$CLAIM_STATUS)"

REPLAY_CODE=$(curl -sS -o "$STATE_DIR/replay_claim.json" -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $DASHBOARD_TOKEN" -H "X-Project-Id: default" \
  -H "Content-Type: application/json" \
  -d "{\"environment\":\"prod\",\"grantToken\":\"$GRANT_TOKEN\",\"runnerId\":\"deploy-runner-2\"}" \
  "$COLLECTOR_URL/internal/remediations/$PROPOSAL_ID/claim")
[ "$REPLAY_CODE" = "409" ] || die "replaying grant token should return 409, got $REPLAY_CODE"
ok "second claim with same grantToken rejected with HTTP 409"

COMPLETE_RESP=$(acurl -X POST -H "Content-Type: application/json" \
  -d '{"environment":"prod","resultingChangeId":"chg_scenario_d_deploy_241"}' \
  "$COLLECTOR_URL/internal/remediations/$PROPOSAL_ID/complete")
DONE_STATUS=$(echo "$COMPLETE_RESP" | jq -r '.proposal.status')
[ "$DONE_STATUS" = "completed" ] || die "expected completed, got $DONE_STATUS"
ok "remediation completed (status=$DONE_STATUS)"

echo -e "\n\033[1;32m✓ ALL LIVE AUTOSRE E2E CHECKS PASSED\033[0m"
