#!/usr/bin/env bash
# Create the DNS CNAMEs that wire obsunified.com → Cloudflare Pages.
#
# Why this exists:
#   Wrangler's OAuth token has `pages:write` + `zone:read` but not
#   `dns:edit`, so it can attach a custom domain to a Pages project
#   but can't create the CNAME the domain actually resolves through.
#   Cloudflare auto-creates the CNAME when zone + Pages live in the
#   same account, but only reliably for zones that have been on
#   Cloudflare DNS for a while (newly-transferred zones often don't
#   trigger the auto-create path).
#
# Reads CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID from ci/.env.deploy.
# See ci/.env.deploy.example for the scopes the token needs.

set -euo pipefail

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Auto-source .env.deploy if present so the user doesn't have to export manually.
if [[ -f "$CI_ROOT/.env.deploy" ]]; then
  set -o allexport
  # shellcheck disable=SC1090
  source "$CI_ROOT/.env.deploy"
  set +o allexport
fi

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN in $CI_ROOT/.env.deploy (Zone:DNS:Edit on obsunified.com)}"
ZONE="${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID missing from .env.deploy}"

upsert() {
  local name="$1" target="$2"
  # Find an existing record by name+type=CNAME
  local existing
  existing=$(curl -sf \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=CNAME&name=$name" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    | jq -r '.result[0].id // empty')

  local body="{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$target\",\"proxied\":true,\"ttl\":1}"

  if [[ -n "$existing" ]]; then
    echo "→ updating $name (id=$existing) → $target"
    curl -sf -X PUT \
      "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$existing" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" | jq -r '"  ok=\(.success)  name=\(.result.name)"'
  else
    echo "→ creating $name → $target"
    curl -sf -X POST \
      "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" | jq -r '"  ok=\(.success)  name=\(.result.name)"'
  fi
}

upsert obsunified.com      obsunified.pages.dev
upsert www.obsunified.com  obsunified.pages.dev
upsert docs.obsunified.com obsunified-docs.pages.dev

echo
echo "DNS records in place. Pages will validate within ~30s."
echo "Verify with:"
echo "  curl -sI https://obsunified.com/ | head -1"
echo "  curl -sI https://docs.obsunified.com/ | head -1"
