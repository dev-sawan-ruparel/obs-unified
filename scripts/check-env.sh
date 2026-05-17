#!/usr/bin/env bash
# Verify ci/.env.deploy is filled in and the token actually works against
# the Cloudflare API. Run this once after pasting your token.
set -euo pipefail

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$CI_ROOT/.env.deploy"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✘ $ENV_FILE not found" >&2
  echo "  → cp $CI_ROOT/.env.deploy.example $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -o allexport; source "$ENV_FILE"; set +o allexport

fail=0
check() {
  local name="$1" value="${2-}"
  if [[ -z "$value" ]]; then
    printf "  %-28s ✘ missing\n" "$name"
    fail=1
  else
    printf "  %-28s ✓\n" "$name"
  fi
}

echo "== env file =="
echo "  $ENV_FILE"
echo
echo "== required vars =="
check CLOUDFLARE_API_TOKEN  "${CLOUDFLARE_API_TOKEN-}"
check CLOUDFLARE_ACCOUNT_ID "${CLOUDFLARE_ACCOUNT_ID-}"
check CLOUDFLARE_ZONE_ID    "${CLOUDFLARE_ZONE_ID-}"
[[ $fail -ne 0 ]] && { echo; echo "Fill in the missing values in $ENV_FILE and re-run."; exit 1; }

echo
echo "== token verify (GET /user/tokens/verify) =="
verify="$(curl -sf https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>&1 || true)"
if [[ -z "$verify" ]]; then
  echo "  ✘ no response — token is invalid or revoked"
  exit 1
fi
echo "$verify" | jq -r '"  ok=\(.success)  status=\(.result.status // "?")  message=\(.messages[0].message // "—")"'

echo
echo "== probe scopes against the API =="

probe() {
  local label="$1" url="$2" need="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  if [[ "$code" =~ ^2 ]]; then
    printf "  %-36s ✓ (HTTP %s)\n" "$label" "$code"
  else
    printf "  %-36s ✘ HTTP %s — needs %s\n" "$label" "$code" "$need"
    fail=1
  fi
}

probe "account access (read)" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID" \
  "valid account ID"

probe "zone access (Zone:Read)" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID" \
  "Zone:Zone:Read on obsunified.com"

probe "DNS list (DNS:Edit implies Read)" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?per_page=1" \
  "Zone:DNS:Edit on obsunified.com"

probe "Pages list (Pages:Edit)" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects?per_page=1" \
  "Account:Cloudflare Pages:Edit"

echo
if [[ $fail -eq 0 ]]; then
  echo "✓ token is good — attach-dns.sh and other deploy scripts will work."
else
  echo "✘ at least one scope is missing. Update the token at:"
  echo "  https://dash.cloudflare.com/profile/api-tokens"
  exit 1
fi
