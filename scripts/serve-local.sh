#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

PORT="${PORT:-8010}"
HOST="${HOST:-127.0.0.1}"

api_ready() {
  curl -fsS \
    -H "Content-Type: application/json" \
    -X POST \
    --data '{"count":1,"topic":"serve-local check"}' \
    "http://127.0.0.1:${PORT}/api/package-engine/thumbnails" >/dev/null 2>&1
}

replace_old_static_server() {
  if ! command -v fuser >/dev/null 2>&1; then
    return
  fi

  pids="$(fuser -n tcp "$PORT" 2>/dev/null || true)"
  for pid in $pids; do
    command="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$command" in
      *"python3 -m http.server ${PORT}"*|*"python -m http.server ${PORT}"*)
        printf 'Replacing old Python static server on port %s: pid %s\n' "$PORT" "$pid"
        kill "$pid" 2>/dev/null || true
        ;;
    esac
  done
}

if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
  if ! api_ready; then
    replace_old_static_server
    sleep 1
  fi
fi

if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
  if ! api_ready; then
    printf 'Port %s is already in use by a server without the Package Engine thumbnail API.\n' "$PORT" >&2
    printf 'Stop that process or choose another port with PORT=8020 ./scripts/serve-local.sh.\n' >&2
    exit 1
  fi
fi

printf 'Serving VIDTOOLZ Episode Factory at http://%s:%s/\n' "$HOST" "$PORT"
printf 'Press Ctrl+C to stop.\n'

exec env PORT="$PORT" HOST="$HOST" node package-engine-server.js
