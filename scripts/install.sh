#!/usr/bin/env bash
# Download + extract the GitHub Actions runner tarball into .runner-bin/.
# Idempotent: skips if already present at the desired version.
set -euo pipefail

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CI_ROOT"

ARCH="$(uname -m)"
OS="$(uname -s)"
case "$OS" in
  Darwin) RUNNER_OS="osx" ;;
  Linux)  RUNNER_OS="linux" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac
case "$ARCH" in
  arm64|aarch64) RUNNER_ARCH="arm64" ;;
  x86_64)        RUNNER_ARCH="x64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

# Resolve latest version via GitHub API (no auth needed for public releases).
# Capture full response first to avoid SIGPIPE when grep/sed close early — that
# would surface as curl exit 23 and (with pipefail) kill the script silently.
VERSION="${RUNNER_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  RESP="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)"
  VERSION="$(printf '%s\n' "$RESP" | grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')"
fi
[[ -z "$VERSION" ]] && { echo "could not resolve runner version" >&2; exit 1; }

ASSET="actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${ASSET}"
DEST="$CI_ROOT/.runner-bin"
STAMP="$DEST/.version"

if [[ -f "$STAMP" ]] && [[ "$(cat "$STAMP")" == "$VERSION" ]]; then
  echo "actions-runner v$VERSION already installed at $DEST"
  exit 0
fi

echo "Downloading $ASSET..."
mkdir -p "$DEST"
curl -fL --progress-bar -o "$CI_ROOT/$ASSET" "$URL"

echo "Extracting to $DEST/..."
rm -rf "$DEST"/{bin,externals,*.sh,*.cmd,*.runner,*.credentials,_diag,_work} 2>/dev/null || true
mkdir -p "$DEST"
tar xzf "$CI_ROOT/$ASSET" -C "$DEST"
rm -f "$CI_ROOT/$ASSET"
echo "$VERSION" > "$STAMP"

echo
echo "✓ actions-runner v$VERSION installed at $DEST"
echo "  Next: scripts/register.sh <key>   (key from runners.json)"
