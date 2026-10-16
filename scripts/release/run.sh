#!/usr/bin/env bash
# scripts/release/run.sh — one-command release for obs-unified.
#
# Runs, in order, from a clean `main`:
#   1. preflight   git clean + on main + fast-forward pull; auth checks
#   2. gates       pnpm lint, type-check, test, check:surfaces
#   3. docker      multi-arch GHCR build+push (:<version>, :sha-<sha>, :latest) + smoke
#   4. npm         pnpm release (sequential publish, passkey prompts) + push tags
#   5. deploy      website + docs (Cloudflare Pages)
#   6. skills      optional: build bundles + GitHub release skills-v<ver>
#
# Usage (from a real interactive terminal; npm's passkey flow needs a TTY):
#   pnpm release:all                      # everything
#   pnpm release:all -- --skip-docker     # only npm + deploy
#   pnpm release:all -- --skills 0.1.4    # also cut a skills release
#   pnpm release:all -- --dry-run         # print the plan and exit
#
# Flags:
#   --skip-gates --skip-docker --skip-npm --skip-deploy
#   --skills <version>   build skills/dist and create GitHub release skills-v<version>
#   --allow-pending      proceed even if .changeset/ has unversioned changesets
#   --yes                do not ask for confirmation
#   --dry-run            show what would run, run nothing
#
# Every stage is idempotent: an image tag already on GHCR, an npm version already
# published, or an existing skills release is skipped, so re-running after a
# failure resumes where it stopped.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="ghcr.io/dev-sawan-ruparel/obs-unified"
GH_USER="${GH_USER:-dev-sawan-ruparel}"
COLIMA_SOCK="$HOME/.colima/obs-unified-smoke/docker.sock"

SKIP_GATES=false SKIP_DOCKER=false SKIP_NPM=false SKIP_DEPLOY=false
ALLOW_PENDING=false ASSUME_YES=false DRY_RUN=false SKILLS_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-gates) SKIP_GATES=true ;;
    --skip-docker) SKIP_DOCKER=true ;;
    --skip-npm) SKIP_NPM=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    --skills) SKILLS_VERSION="$2"; shift ;;
    --allow-pending) ALLOW_PENDING=true ;;
    --yes|-y) ASSUME_YES=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
run() {
  if $DRY_RUN; then printf '  \033[2m$ %s\033[0m\n' "$*"; return 0; fi
  printf '  $ %s\n' "$*"
  "$@"
}
pkg_version() { node -p "require('./$1/package.json').version"; }
pkg_name() { node -p "require('./$1/package.json').name"; }

# ---------------------------------------------------------------- 1. preflight
bold "1. Preflight"
[ -t 0 ] || $SKIP_NPM || $DRY_RUN || die "stdin is not a TTY; npm's passkey prompts need an interactive terminal (or pass --skip-npm)."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  $DRY_RUN && warn "on branch '$BRANCH' (a real run requires main)" || die "on branch '$BRANCH'; releases are cut from main."
fi
if [ -n "$(git status --porcelain)" ]; then
  $DRY_RUN && warn "working tree is not clean (a real run requires a clean tree)" || die "working tree is not clean."
fi
run git fetch -q origin
if ! $DRY_RUN; then
  git merge-base --is-ancestor HEAD origin/main || die "local main has commits that are not on origin/main."
  git pull -q --ff-only
fi
SHA="$(git rev-parse --short HEAD)"
ok "HEAD @ $SHA"

PENDING=""
for f in .changeset/*.md; do [ -e "$f" ] && [ "$(basename "$f")" != "README.md" ] && PENDING+="$f"$'\n'; done
if [ -n "$PENDING" ] && ! $ALLOW_PENDING; then
  echo "$PENDING" | sed 's/^/    /'
  die "unversioned changesets present; run 'pnpm changeset version' in a PR first (or pass --allow-pending)."
fi

COLLECTOR_VERSION="$(pkg_version packages/obs-collector)"
ok "collector version $COLLECTOR_VERSION (image tag)"

if ! $SKIP_DOCKER; then
  if [ -z "${DOCKER_HOST:-}" ] && [ -S "$COLIMA_SOCK" ]; then
    export DOCKER_HOST="unix://$COLIMA_SOCK"
    ok "DOCKER_HOST -> colima profile obs-unified-smoke"
  fi
  $DRY_RUN || docker info >/dev/null 2>&1 || die "docker daemon not reachable (DOCKER_HOST=${DOCKER_HOST:-unset}); start colima: colima start obs-unified-smoke"
  $DRY_RUN || gh auth status 2>&1 | grep -q "write:packages" || die "gh token lacks write:packages; run: gh auth refresh -s write:packages"
  if ! $DRY_RUN && ! grep -q '"ghcr.io"' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null; then
    gh auth token | docker login ghcr.io -u "$GH_USER" --password-stdin >/dev/null
    ok "docker logged in to ghcr.io"
  fi
fi
if ! $SKIP_NPM && ! $DRY_RUN; then
  NPM_USER="$(npm whoami 2>/dev/null || true)"
  [ -n "$NPM_USER" ] || die "not logged in to npm; run: npm login"
  ok "npm user $NPM_USER"
fi

# ----------------------------------------------------------------- plan
bold "Plan"
echo "  commit      $SHA"
$SKIP_GATES  && echo "  gates       skip" || echo "  gates       lint, type-check, test, check:surfaces"
$SKIP_DOCKER && echo "  docker      skip" || echo "  docker      $IMAGE:{$COLLECTOR_VERSION,sha-$SHA,latest} (linux/amd64,linux/arm64) + smoke"
$SKIP_NPM    && echo "  npm         skip" || echo "  npm         pnpm release (sequential) + git push --tags"
$SKIP_DEPLOY && echo "  deploy      skip" || echo "  deploy      website + docs"
[ -n "$SKILLS_VERSION" ] && echo "  skills      skills-v$SKILLS_VERSION" || echo "  skills      skip (pass --skills <version> to cut one)"
if ! $SKIP_NPM; then
  for d in packages/*/ sdks/node/; do
    [ -f "$d/package.json" ] || continue
    node -e "process.exit(require('./$d/package.json').private ? 1 : 0)" || continue
    n="$(pkg_name "$d")"; v="$(pkg_version "$d")"
    cur="$(npm view "$n" version 2>/dev/null || echo "-")"
    [ "$cur" = "$v" ] && echo "    $n $v (already on npm)" || echo "    $n $cur -> $v"
  done
fi
if $DRY_RUN; then bold "Dry run; nothing executed."; exit 0; fi
if ! $ASSUME_YES; then
  read -r -p "Proceed? [y/N] " ans; [[ "$ans" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }
fi

# ------------------------------------------------------------------ 2. gates
if ! $SKIP_GATES; then
  bold "2. Gates"
  run pnpm install --frozen-lockfile
  run pnpm lint
  run pnpm type-check
  run pnpm test
  run pnpm check:surfaces
  ok "gates green"
fi

# ----------------------------------------------------------------- 3. docker
if ! $SKIP_DOCKER; then
  bold "3. Docker image"
  if docker manifest inspect "$IMAGE:sha-$SHA" >/dev/null 2>&1; then
    warn "$IMAGE:sha-$SHA already on GHCR; skipping build (tags :$COLLECTOR_VERSION/:latest unchanged)"
  else
    run bash scripts/release-docker/build.sh "$COLLECTOR_VERSION" --sha "$SHA" --multiarch --push
    ok "pushed $IMAGE:{$COLLECTOR_VERSION,sha-$SHA,latest}"
  fi
  run bash scripts/release-docker/smoke.sh "$IMAGE:$COLLECTOR_VERSION"
  ok "image smoke passed"
fi

# -------------------------------------------------------------------- 4. npm
if ! $SKIP_NPM; then
  bold "4. npm publish"
  run pnpm release
  run git push origin --tags
  bold "   verifying registry (replicas may lag up to ~2 min)"
  for d in packages/*/ sdks/node/; do
    [ -f "$d/package.json" ] || continue
    node -e "process.exit(require('./$d/package.json').private ? 1 : 0)" || continue
    n="$(pkg_name "$d")"; v="$(pkg_version "$d")"
    for _ in $(seq 1 24); do
      [ "$(npm view "$n" version 2>/dev/null || true)" = "$v" ] && break
      sleep 5
    done
    [ "$(npm view "$n" version 2>/dev/null || true)" = "$v" ] && ok "$n@$v" || warn "$n@$v not visible yet"
  done
fi

# ------------------------------------------------------------------ 5. deploy
if ! $SKIP_DEPLOY; then
  bold "5. Deploy sites"
  run pnpm deploy:website
  run pnpm deploy:docs
  ok "website + docs deployed"
fi

# ------------------------------------------------------------------ 6. skills
if [ -n "$SKILLS_VERSION" ]; then
  bold "6. Skills release skills-v$SKILLS_VERSION"
  if gh release view "skills-v$SKILLS_VERSION" >/dev/null 2>&1; then
    warn "release skills-v$SKILLS_VERSION already exists; skipping"
  else
    run make -C skills build
    run gh release create "skills-v$SKILLS_VERSION" skills/dist/*.skill \
      --target "$(git rev-parse HEAD)" --title "skills-v$SKILLS_VERSION" \
      --notes "Skill bundles built from main at $SHA."
    warn "update the documented download tag (grep -rn 'skills-v' apps/website/public/llms.txt apps/website/index.html apps/docs/content/docs/getting-started.mdx skills/README.md docs/release.md) in a follow-up PR"
  fi
else
  LAST_SKILLS_TAG="$(git tag -l 'skills-v*' --sort=-v:refname | head -1)"
  if [ -n "$LAST_SKILLS_TAG" ] && [ -n "$(git diff --name-only "$LAST_SKILLS_TAG"..HEAD -- skills/ ':!skills/dist' 2>/dev/null)" ]; then
    warn "skills/ changed since $LAST_SKILLS_TAG; consider re-running with --skills <next-version>"
  fi
fi

bold "Done: $SHA released."
