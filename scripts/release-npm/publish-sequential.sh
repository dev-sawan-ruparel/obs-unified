#!/usr/bin/env bash
# Publish the @obsunified npm packages one at a time, in dependency order.
#
# Why not `changeset publish`?
#   - It publishes every package in parallel. Each package's `prepublishOnly`
#     runs tsup with `clean: true`, so one package's dist/ can vanish while a
#     dependent is still bundling against it (seen with @obsunified/types vs
#     mcp-server).
#   - npm accounts with 2FA set to "auth-and-writes" and a passkey have no TOTP
#     code to pass via --otp. npm's browser flow needs one approval per publish
#     and an interactive TTY, so twelve parallel prompts are unusable.
#
# Usage (from a normal terminal, not a non-TTY shell):
#   pnpm release            # builds, then runs this script
#   bash scripts/release-npm/publish-sequential.sh
#
# Packages already at their local version on the registry are skipped, so the
# script is safe to re-run after a failed or interrupted publish. When every
# package is published it creates the per-package git tags via `changeset tag`;
# push them with `git push origin --tags`.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Dependency order: each package appears after everything it depends on.
ORDER=(
  packages/obs-types
  packages/cli
  packages/pprof-decoder
  packages/brand
  sdks/node
  packages/dashboard
  packages/obs-collector
  packages/analytics-sdk
  packages/mcp-server
  packages/telemetry-sdk
  packages/agents-vercel-ai
  packages/agents-langgraph
)

if [ ! -t 0 ]; then
  echo "warning: stdin is not a TTY. npm's browser-based 2FA prompt needs an interactive terminal." >&2
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "error: not logged in to npm. Run 'npm login' first." >&2
  exit 1
fi

failed=()
published=0
skipped=0
for dir in "${ORDER[@]}"; do
  name=$(node -p "require('$ROOT/$dir/package.json').name")
  local_v=$(node -p "require('$ROOT/$dir/package.json').version")
  npm_v=$(npm view "$name" version 2>/dev/null || echo none)
  if [ "$local_v" = "$npm_v" ]; then
    echo "== skip    $name@$local_v (already on npm)"
    skipped=$((skipped + 1))
    continue
  fi
  echo "== publish $name $npm_v -> $local_v  (approve the browser prompt if asked)"
  if (cd "$ROOT/$dir" && pnpm publish --access public --no-git-checks); then
    echo "== ok      $name@$local_v"
    published=$((published + 1))
  else
    echo "== FAIL    $name@$local_v"
    failed+=("$name@$local_v")
  fi
done

echo
echo "published=$published skipped=$skipped failed=${#failed[@]}"
if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  echo "Re-run this script; published packages are skipped."
  exit 1
fi

echo "All packages published. Creating git tags..."
pnpm exec changeset tag
echo "Push them with: git push origin --tags"
