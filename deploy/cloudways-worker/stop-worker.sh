#!/usr/bin/env bash
# Stop the AutoCheck Cloudways extraction worker and reap any Chrome it left behind.
#
# nohup keeps the worker alive across SSH disconnects, so stopping it is an
# explicit step. Puppeteer normally closes Chrome itself; the pkill below is a
# safety net for a hard-killed worker so no zombie Chrome keeps using RAM.

set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKER_DIR"

PID_FILE="$WORKER_DIR/worker.pid"
PUPPETEER_CACHE="${PUPPETEER_CACHE_DIR:-$HOME/.cache/puppeteer}"
STOP_TIMEOUT_S="${AUTOCHECK_STOP_TIMEOUT_S:-15}"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found; the worker does not appear to be running."
else
  WORKER_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "Stopping worker PID $WORKER_PID..."
    kill "$WORKER_PID" 2>/dev/null || true
    ELAPSED=0
    while kill -0 "$WORKER_PID" 2>/dev/null && [ "$ELAPSED" -lt "$STOP_TIMEOUT_S" ]; do
      sleep 1
      ELAPSED=$((ELAPSED + 1))
    done
    if kill -0 "$WORKER_PID" 2>/dev/null; then
      echo "Worker did not exit within ${STOP_TIMEOUT_S}s; sending SIGKILL."
      kill -9 "$WORKER_PID" 2>/dev/null || true
      sleep 1
    fi
    echo "Worker stopped."
  else
    echo "Stale PID file; removing it."
  fi
  rm -f "$PID_FILE"
fi

# Safety net: only touches Puppeteer's own browser downloads under this account.
if command -v pkill >/dev/null 2>&1; then
  pkill -f "$PUPPETEER_CACHE/chrome" 2>/dev/null || true
  sleep 1
  pkill -9 -f "$PUPPETEER_CACHE/chrome" 2>/dev/null || true
fi

echo "Stop complete."
