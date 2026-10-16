#!/usr/bin/env bash
set -euo pipefail

# scripts/release-docker/build.sh
# Builds the reproducible Docker release image for ghcr.io/dev-sawan-ruparel/obs-unified.
#
# Usage:
#   ./scripts/release-docker/build.sh [version] [--sha <git-sha>] [--no-latest] [--dry-run]
#
# Examples:
#   ./scripts/release-docker/build.sh 2.0.1
#   ./scripts/release-docker/build.sh 2.0.1 --sha e4ea903
#   ./scripts/release-docker/build.sh 2.0.1 --no-latest

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_ORG="${IMAGE_ORG:-dev-sawan-ruparel}"
IMAGE_REPO="${IMAGE_REPO:-obs-unified}"
FULL_IMAGE="${REGISTRY}/${IMAGE_ORG}/${IMAGE_REPO}"

# Defaults
DEFAULT_VERSION=$(node -p "try { require('./packages/obs-collector/package.json').version } catch { '0.1.0' }" 2>/dev/null || echo "0.1.0")
VERSION=""
TAG_LATEST=true
DRY_RUN=false
COMMIT_SHA=""
PLATFORMS=""
PUSH_IMAGE=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--sha)
			COMMIT_SHA="$2"
			shift 2
			;;
		--platform)
			PLATFORMS="$2"
			shift 2
			;;
		--multiarch)
			PLATFORMS="linux/amd64,linux/arm64"
			shift
			;;
		--push)
			PUSH_IMAGE=true
			shift
			;;
		--no-latest)
			TAG_LATEST=false
			shift
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		--help|-h)
			echo "Usage: $0 [version] [--sha <git-sha>] [--platform <arch-list>|--multiarch] [--push] [--no-latest] [--dry-run]"
			exit 0
			;;
		*)
			if [ -z "$VERSION" ]; then
				VERSION="$1"
			else
				echo "Unknown argument: $1" >&2
				exit 1
			fi
			shift
			;;
	esac
done

VERSION="${VERSION:-$DEFAULT_VERSION}"

if [ -z "$COMMIT_SHA" ]; then
	# Never fall back to a made-up revision: the sha-* tag and the
	# org.opencontainers.image.revision label must point at a real commit.
	if ! COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null)" || [ -z "$COMMIT_SHA" ]; then
		echo "error: not inside a git checkout; pass --sha <git-sha>" >&2
		exit 1
	fi
fi

BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

TAGS=(
	"-t" "${FULL_IMAGE}:${VERSION}"
	"-t" "${FULL_IMAGE}:sha-${COMMIT_SHA}"
)

if [ "$TAG_LATEST" = true ]; then
	TAGS+=("-t" "${FULL_IMAGE}:latest")
fi

LABELS=(
	"--label" "org.opencontainers.image.source=https://github.com/${IMAGE_ORG}/${IMAGE_REPO}"
	"--label" "org.opencontainers.image.revision=${COMMIT_SHA}"
	"--label" "org.opencontainers.image.version=${VERSION}"
	"--label" "org.opencontainers.image.created=${BUILD_DATE}"
	"--label" "org.opencontainers.image.title=obs-unified"
	"--label" "org.opencontainers.image.description=Unified observability collector and dashboard for agentic debugging"
	"--label" "org.opencontainers.image.licenses=MIT"
)

if [ -n "$PLATFORMS" ] || [ "$PUSH_IMAGE" = true ]; then
	BUILD_CMD=(
		"docker" "buildx" "build"
		"-f" "Dockerfile"
	)
	if [ -n "$PLATFORMS" ]; then
		BUILD_CMD+=("--platform" "$PLATFORMS")
	fi
	if [ "$PUSH_IMAGE" = true ]; then
		BUILD_CMD+=("--push")
	else
		BUILD_CMD+=("--load")
	fi
	BUILD_CMD+=(
		"${TAGS[@]}"
		"${LABELS[@]}"
		"."
	)
else
	BUILD_CMD=(
		"docker" "build"
		"-f" "Dockerfile"
		"${TAGS[@]}"
		"${LABELS[@]}"
		"."
	)
fi

echo "=========================================================="
echo "obs-unified GHCR Release Image Build"
echo "=========================================================="
echo "Image:        ${FULL_IMAGE}"
echo "Version:      ${VERSION}"
echo "Commit SHA:   ${COMMIT_SHA}"
echo "Build Date:   ${BUILD_DATE}"
if [ -n "$PLATFORMS" ]; then
	echo "Platforms:    ${PLATFORMS}"
fi
echo "Push:         ${PUSH_IMAGE}"
echo "Tags:"
echo "  - ${FULL_IMAGE}:${VERSION}"
echo "  - ${FULL_IMAGE}:sha-${COMMIT_SHA}"
if [ "$TAG_LATEST" = true ]; then
	echo "  - ${FULL_IMAGE}:latest"
fi
echo "=========================================================="

if [ "$DRY_RUN" = true ]; then
	echo "[DRY RUN] Would execute:"
	echo "${BUILD_CMD[*]}"
	exit 0
fi

echo "Checking build context for local secrets..."
bash "$ROOT/scripts/release-docker/check-context.sh"

echo "Executing build..."
"${BUILD_CMD[@]}"

echo ""
echo "=========================================================="
echo "Build completed successfully!"
echo ""
echo "Next validation step:"
echo "  bash scripts/release-docker/smoke.sh ${FULL_IMAGE}:${VERSION}"
echo ""
echo "To publish multi-arch (linux/amd64,linux/arm64) to GitHub Container Registry (GHCR):"
echo "  1. Authenticate to GHCR using existing gh session or docker credential helper:"
echo "       gh auth token | docker login ghcr.io -u <github-username> --password-stdin"
echo "  2. Build and push multi-arch manifest list:"
echo "       bash scripts/release-docker/build.sh ${VERSION} --multiarch --push"
echo "=========================================================="
