#!/usr/bin/env bash
# Validate the host has everything ci/ scripts need before you start
# registering runners or deploying.
#
# Usage: scripts/check-prereqs.sh [--help]
#
# Exits 0 if all checks pass, 1 if any blocker is missing.
set -euo pipefail

if [[ "${1-}" == "--help" || "${1-}" == "-h" ]]; then
  awk '/^#!/{next} /^#/{sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
  exit 0
fi

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail=0
ok()    { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn()  { printf "  \033[33m!\033[0m %s — %s\n" "$1" "$2"; }
bad()   { printf "  \033[31m✘\033[0m %s — %s\n" "$1" "$2"; fail=1; }

echo "== host =="
case "$(uname -s)" in
  Darwin) ok "Darwin $(uname -m)" ;;
  Linux)  ok "Linux $(uname -m)" ;;
  *) bad "$(uname -s)" "only Darwin and Linux are supported" ;;
esac

case "$(uname -m)" in
  arm64|aarch64|x86_64) : ;;
  *) bad "arch $(uname -m)" "expected arm64 or x86_64" ;;
esac

echo
echo "== tools =="
for tool in bash curl jq gh; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool ($("$tool" --version 2>&1 | head -1))"
  else
    bad "$tool" "missing — brew install $tool (or apt/dnf equivalent)"
  fi
done

echo
echo "== gh authentication =="
if gh auth status >/dev/null 2>&1; then
  scopes=$(gh auth status 2>&1 | grep -oE "Token scopes:.*" | head -1 || true)
  ok "gh authenticated ($scopes)"
  if ! gh auth status 2>&1 | grep -q "repo"; then
    bad "gh repo scope" "register.sh needs admin on the repo — run 'gh auth refresh -s repo,workflow'"
  fi
else
  bad "gh auth" "not logged in — run 'gh auth login'"
fi

echo
echo "== runner files =="
if [[ -f "$CI_ROOT/.runner-bin/.version" ]]; then
  ok "actions-runner installed ($(cat "$CI_ROOT/.runner-bin/.version"))"
else
  warn ".runner-bin" "not installed yet — run scripts/install.sh"
fi

if [[ -f "$CI_ROOT/runners.json" ]]; then
  count=$(jq '.runners | length' "$CI_ROOT/runners.json" 2>/dev/null || echo 0)
  ok "runners.json ($count entries)"
else
  bad "runners.json" "missing"
fi

echo
echo "== Cloudflare env (.env.deploy) =="
if [[ -f "$CI_ROOT/.env.deploy" ]]; then
  ok ".env.deploy present"
  # shellcheck disable=SC1090
  set -o allexport; source "$CI_ROOT/.env.deploy"; set +o allexport
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] \
    && ok "CLOUDFLARE_API_TOKEN set" \
    || warn "CLOUDFLARE_API_TOKEN" "empty — DNS scripts will fail; run scripts/check-env.sh after filling in"
else
  warn ".env.deploy" "not created — cp .env.deploy.example .env.deploy"
fi

echo
if [[ $fail -eq 0 ]]; then
  printf "\033[32m✓\033[0m all prerequisites satisfied\n"
  exit 0
else
  printf "\033[31m✘\033[0m at least one prerequisite missing (see above)\n"
  exit 1
fi
