#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

PORT="${PORT:-8010}"
HOST="${HOST:-127.0.0.1}"
DASHBOARD_HOST="${DASHBOARD_HOST:-127.0.0.1}"
STATUS_URL="http://${DASHBOARD_HOST}:${PORT}/api/package-engine/status"
DASHBOARD_URL="http://${DASHBOARD_HOST}:${PORT}/package-runs-dashboard.html"
LOG_FILE="${TMPDIR:-/tmp}/vidtoolz-episode-factory-${PORT}.log"

server_ready() {
  command -v curl >/dev/null 2>&1 && curl -fsS "$STATUS_URL" >/dev/null 2>&1
}

open_url() {
  if [ -n "${BROWSER:-}" ]; then
    "$BROWSER" "$DASHBOARD_URL" >/dev/null 2>&1 &
    return 0
  fi

  for opener in xdg-open gio sensible-browser open; do
    if command -v "$opener" >/dev/null 2>&1; then
      if [ "$opener" = "gio" ]; then
        gio open "$DASHBOARD_URL" >/dev/null 2>&1 &
      else
        "$opener" "$DASHBOARD_URL" >/dev/null 2>&1 &
      fi
      return 0
    fi
  done

  return 1
}

if ! server_ready; then
  printf 'Starting VIDTOOLZ Episode Factory server on http://%s:%s/ ...\n' "$HOST" "$PORT"
  PORT="$PORT" HOST="$HOST" ./scripts/serve-local.sh >"$LOG_FILE" 2>&1 &

  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if server_ready; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" -ne 1 ]; then
    printf 'Could not confirm local server at %s.\n' "$STATUS_URL" >&2
    printf 'Server log: %s\n' "$LOG_FILE" >&2
    exit 1
  fi
fi

printf 'Opening Package Runs Dashboard:\n%s\n' "$DASHBOARD_URL"
if ! open_url; then
  printf 'No browser opener found. Open this URL manually:\n%s\n' "$DASHBOARD_URL"
fi
