#!/usr/bin/env bash
# Start the AutoCheck Cloudways extraction worker in the background.
#
# - exports LD_LIBRARY_PATH so the locally installed Chrome libraries are found
#   (Cloudways ships an incomplete set and we have no sudo/root)
# - loads .env when present
# - survives SSH disconnect via nohup
# - records the PID in worker.pid for stop/restart
#
# NOTE: nohup keeps the worker alive after an SSH disconnect but NOT after a full
# Cloudways server reboot. Re-run ./start-worker.sh after a reboot (see README).

set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKER_DIR"

NODE_BIN="${NODE_BIN:-node}"
CHROME_LIB_ROOT="${AUTOCHECK_CHROME_LIB_ROOT:-/home/master/chrome-libs/root}"
WORKER_ENTRY="$WORKER_DIR/dist/deploy/cloudways-worker/src/main.js"
PID_FILE="$WORKER_DIR/worker.pid"
LOG_FILE="${AUTOCHECK_WORKER_LOG:-$WORKER_DIR/worker.log}"

# 1. Chrome's locally installed Debian libraries (no sudo, no apt).
export LD_LIBRARY_PATH="$CHROME_LIB_ROOT/usr/lib/x86_64-linux-gnu:$CHROME_LIB_ROOT/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# 2. Configuration (.env is optional; real secrets never live in git).
if [ -f "$WORKER_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$WORKER_DIR/.env"
  set +a
fi

if [ ! -f "$WORKER_ENTRY" ]; then
  echo "Worker build not found at $WORKER_ENTRY. Run 'npm install && npm run build' first." >&2
  exit 1
fi

if [ ! -x "$(command -v "$NODE_BIN" || true)" ] && ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node was not found. Set NODE_BIN to your Node 20 executable." >&2
  exit 1
fi

# 3. Refuse to start a second worker: one Chrome at a time on a 2 vCPU / 4 GB host.
if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Worker already running with PID $EXISTING_PID."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# 4. Start, detached, with all output captured.
nohup "$NODE_BIN" "$WORKER_ENTRY" >>"$LOG_FILE" 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" >"$PID_FILE"

sleep 2
if ! kill -0 "$WORKER_PID" 2>/dev/null; then
  echo "Worker exited immediately. Last log lines:" >&2
  tail -n 20 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "AutoCheck extraction worker started."
echo "  PID: $WORKER_PID"
echo "  Log: $LOG_FILE"
echo "  PID file: $PID_FILE"
echo "  Listening on 127.0.0.1:${AUTOCHECK_WORKER_PORT:-3000} (reachable only via worker-gateway.php)"
