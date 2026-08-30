#!/usr/bin/env bash
# Build image SINTESA lokal dan (opsional) push ke GHCR.
#
# Usage:
#   ./scripts/docker-build.sh              # build api + web
#   ./scripts/docker-build.sh --push       # build + push ke ghcr.io
#   ./scripts/docker-build.sh api          # build api saja
#   TAG=v1.0.0 ./scripts/docker-build.sh --push

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGISTRY="${REGISTRY:-ghcr.io}"
OWNER="${GITHUB_OWNER:-ardianryan}"
TAG="${TAG:-latest}"
PUSH=false
TARGETS=(api web)

usage() {
  cat <<'EOF'
SINTESA Docker build helper

  ./scripts/docker-build.sh [api|web] [--push]

Env:
  REGISTRY       default: ghcr.io
  GITHUB_OWNER   default: ardianryan
  TAG            default: latest
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --push) PUSH=true; shift ;;
    api|web) TARGETS=("$1"); shift ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

build_one() {
  local target="$1"
  local dockerfile image
  case "$target" in
    api)
      dockerfile="docker/Dockerfile.api"
      image="${REGISTRY}/${OWNER}/sintesa-api"
      ;;
    web)
      dockerfile="docker/Dockerfile.web"
      image="${REGISTRY}/${OWNER}/sintesa-web"
      ;;
    *)
      echo "Unknown target: $target" >&2
      exit 1
      ;;
  esac

  echo "==> Building ${image}:${TAG} (${dockerfile})"
  docker build \
    -f "$dockerfile" \
    -t "${image}:${TAG}" \
    --build-arg VITE_API_BASE_URL=/api \
    --build-arg VITE_APP_NAME=SINTESA \
    .

  if [[ "$TAG" != "latest" ]]; then
    docker tag "${image}:${TAG}" "${image}:latest"
  fi

  if $PUSH; then
    echo "==> Pushing ${image}:${TAG}"
    docker push "${image}:${TAG}"
    if [[ "$TAG" != "latest" ]]; then
      docker push "${image}:latest"
    fi
  fi
}

for t in "${TARGETS[@]}"; do
  build_one "$t"
done

echo ""
echo "Done."
if ! $PUSH; then
  echo "Tip: jalankan dengan --push setelah 'docker login ghcr.io' untuk upload ke GHCR."
fi