#!/usr/bin/env bash
set -euo pipefail

# One-command Apollo UI evaluation harness:
#   1. Builds production frontend (`npm run build`)
#   2. Deploys `dist/.` to the running `apollo-web-1` nginx container
#   3. Runs deterministic Retina 2x Playwright captures (fails on console/page errors)
#
# Usage:
#   ./.agents/skills/ui-council/scripts/deploy-and-capture.sh app [output-folder]
#   ./.agents/skills/ui-council/scripts/deploy-and-capture.sh daw [output-folder]

TARGET="${1:-app}"
OUT_DIR_NAME="${2:-}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [[ "$TARGET" == "app" ]]; then
  OUT_DIR_NAME="${OUT_DIR_NAME:-current}"
  CAPTURE_SCRIPT="$REPO_ROOT/.ui-eval/capture.mjs"
elif [[ "$TARGET" == "daw" ]]; then
  OUT_DIR_NAME="${OUT_DIR_NAME:-daw-current}"
  CAPTURE_SCRIPT="$REPO_ROOT/.ui-eval/capture-daw.mjs"
else
  echo "Usage: $0 <app|daw> [output-folder]" >&2
  exit 2
fi

if [[ ! -f "$CAPTURE_SCRIPT" ]]; then
  echo "Capture script not found: $CAPTURE_SCRIPT" >&2
  exit 1
fi

echo "[ui-council] Building production bundle..."
npm run build

echo "[ui-council] Deploying dist/ to apollo-web-1:/usr/share/nginx/html..."
docker cp "$REPO_ROOT/dist/." apollo-web-1:/usr/share/nginx/html

echo "[ui-council] Running Playwright capture ($TARGET -> .ui-eval/$OUT_DIR_NAME)..."
node "$CAPTURE_SCRIPT" "$OUT_DIR_NAME"
