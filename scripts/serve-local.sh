#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

PORT="${PORT:-8010}"
HOST="${HOST:-127.0.0.1}"
REQUESTED_PROVIDER="${THUMBNAIL_PROVIDER:-placeholder}"

status_json() {
  curl -fsS "http://127.0.0.1:${PORT}/api/package-engine/status" 2>/dev/null || true
}

status_provider() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("thumbnailProvider", ""))' 2>/dev/null || true
}

running_provider() {
  json="$(status_json)"
  if [ -n "$json" ]; then
    printf '%s' "$json" | status_provider
  fi
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
  CURRENT_PROVIDER="$(running_provider)"
  if [ -z "$CURRENT_PROVIDER" ]; then
    replace_old_static_server
    sleep 1
  fi
fi

if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
  CURRENT_PROVIDER="$(running_provider)"
  if [ -z "$CURRENT_PROVIDER" ]; then
    printf 'Port %s is already in use by a server without the Package Engine thumbnail API.\n' "$PORT" >&2
    printf 'Stop that process or choose another port with PORT=8020 ./scripts/serve-local.sh.\n' >&2
    exit 1
  fi
  if [ "$CURRENT_PROVIDER" = "$REQUESTED_PROVIDER" ]; then
    printf 'VIDTOOLZ Episode Factory server is already running at http://%s:%s/ with thumbnail provider "%s".\n' "$HOST" "$PORT" "$CURRENT_PROVIDER"
    printf 'Package Engine: http://%s:%s/package-engine.html\n' "$HOST" "$PORT"
    exit 0
  fi
  printf 'Port %s is already running Package Engine with thumbnail provider "%s", but requested provider is "%s".\n' "$PORT" "$CURRENT_PROVIDER" "$REQUESTED_PROVIDER" >&2
  printf 'Stop the existing server first, or use another port:\n' >&2
  printf 'PORT=8020 THUMBNAIL_PROVIDER=%s ./scripts/serve-local.sh\n' "$REQUESTED_PROVIDER" >&2
  exit 1
fi

printf 'Serving VIDTOOLZ Episode Factory at http://%s:%s/\n' "$HOST" "$PORT"
printf 'Press Ctrl+C to stop.\n'

exec env PORT="$PORT" HOST="$HOST" node package-engine-server.js
