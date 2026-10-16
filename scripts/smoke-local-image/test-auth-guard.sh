#!/usr/bin/env bash
# Exercises docker/local/auth-guard.sh with env permutations (no Docker needed).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT/docker/local/auth-guard.sh"
fail=0

run() { # run VAR=... ; echoes stderr+rc
	env -i PATH="$PATH" "$@" bash -c ". '$GUARD'; obs_validate_release_auth" 2>&1
	echo "rc=$?"
}
expect() { # expect "desc" "pattern" output
	if ! grep -Eq -- "$2" <<<"$3"; then
		echo "FAIL: $1 (wanted /$2/)"; echo "$3"; fail=1
	fi
}
reject() {
	if grep -Eq -- "$2" <<<"$3"; then echo "FAIL: $1 (unexpected /$2/)"; fail=1; fi
}

out="$(run INGEST_KEY=real-key-123 DASHBOARD_PASSWORD=real-pass-123)"
expect "valid without token passes" "rc=0" "$out"

out="$(run INGEST_KEY=real-key-123 DASHBOARD_PASSWORD=real-pass-123 DASHBOARD_TOKEN=real-token-123)"
expect "valid with token passes" "rc=0" "$out"

out="$(run INGEST_KEY=real-key-123 DASHBOARD_PASSWORD=real-pass-123 DASHBOARD_TOKEN=e2e-dashboard-token)"
expect "sample token rejected" "DASHBOARD_TOKEN is set to a rejected sample value" "$out"
expect "sample token rc" "rc=1" "$out"
reject "sample token value not echoed" "e2e-dashboard-token" "$out"

out="$(run INGEST_KEY=dev-ingest-key DASHBOARD_PASSWORD=e2e-test-pass DASHBOARD_TOKEN=e2e-dashboard-token)"
expect "all three reported" "INGEST_KEY is set to a rejected sample.*" "$out"
expect "password reported" "DASHBOARD_PASSWORD is set to a rejected sample" "$out"
expect "token reported" "DASHBOARD_TOKEN is set to a rejected sample" "$out"

out="$(run)"
expect "unset ingest" "INGEST_KEY is unset" "$out"
expect "unset password" "DASHBOARD_PASSWORD is unset" "$out"
reject "unset token not an error" "DASHBOARD_TOKEN" "$out"
expect "unset rc" "rc=1" "$out"

# start.sh wires the guard only when REQUIRE_AUTH_CONFIG=true and keeps the
# local defaults path otherwise.
grep -q 'obs_validate_release_auth' "$ROOT/docker/local/start.sh" || { echo "FAIL: start.sh does not call guard"; fail=1; }
grep -q 'DASHBOARD_TOKEN:-e2e-dashboard-token' "$ROOT/docker/local/start.sh" || { echo "FAIL: local defaults path missing"; fail=1; }

if [ "$fail" -eq 0 ]; then echo "auth-guard: all checks passed"; fi
exit "$fail"
