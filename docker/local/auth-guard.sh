#!/usr/bin/env bash
# Release auth guard, sourced by start.sh (and by scripts/smoke-local-image/
# test-auth-guard.sh). Defines obs_validate_release_auth, which checks every
# credential, prints ALL failures together, and returns non-zero if any
# failed. Messages name the variable and the failure category only; a supplied
# value is never echoed.

# Echo "unset" or "sample" when the named variable must be rejected.
# usage: obs_auth_problem VAR_NAME SAMPLE_VALUE [allow_unset]
obs_auth_problem() {
	local name="$1" sample="$2" allow_unset="${3:-}"
	local value="${!name:-}"
	if [ -z "$value" ]; then
		[ "$allow_unset" = "allow_unset" ] || echo "unset"
		return 0
	fi
	if [ "$value" = "$sample" ]; then
		echo "sample"
	fi
}

obs_validate_release_auth() {
	local failures=0 problem
	local checks=(
		"INGEST_KEY|dev-ingest-key|"
		"DASHBOARD_PASSWORD|e2e-test-pass|"
		"DASHBOARD_TOKEN|e2e-dashboard-token|allow_unset"
	)
	local entry name sample mode
	for entry in "${checks[@]}"; do
		IFS='|' read -r name sample mode <<<"$entry"
		problem="$(obs_auth_problem "$name" "$sample" "$mode")"
		case "$problem" in
		unset)
			echo "[obs-unified] ERROR: $name is unset; set it to a secure value for production runtime." >&2
			failures=$((failures + 1))
			;;
		sample)
			echo "[obs-unified] ERROR: $name is set to a rejected sample value; set it to a secure value for production runtime." >&2
			failures=$((failures + 1))
			;;
		esac
	done
	[ "$failures" -eq 0 ]
}
