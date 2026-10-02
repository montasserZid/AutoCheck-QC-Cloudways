#!/usr/bin/env bash
# Restart the AutoCheck Cloudways extraction worker.
# Rebuilds when dist/ is missing so a fresh checkout can be brought up in one step.

set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKER_DIR"

bash ./stop-worker.sh

if [ ! -f "$WORKER_DIR/node_modules" ]; then
  echo "Installing worker dependencies..."
  npm install --omit=optional --no-audit --no-fund
fi

if [ ! -f "$WORKER_DIR/dist/src/main.js" ]; then
  echo "Building worker..."
  npm run build
fi

bash ./start-worker.sh
