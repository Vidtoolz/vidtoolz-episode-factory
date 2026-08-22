#!/usr/bin/env bash
# ensure-cockpit.sh — make sure the VIDTOOLZ cockpit (Package Engine, port 8010)
# is running, via its systemd user unit.
#
# IMPORTANT: this NEVER launches a manual `node package-engine-server.js`.
# A manual start collides with vidtoolz-cockpit.service (which owns port 8010)
# and causes an EADDRINUSE auto-restart loop. Always go through systemd.
#
# Usage: ensure-cockpit.sh [port]   (defaults to 8010, the unit's port)
# Exit 0 = cockpit is serving; exit 1 = could not bring it up.
set -uo pipefail

PORT="${1:-8010}"
CURL_BIN="${VIDTOOLZ_CURL_BIN:-curl}"
SYSTEMCTL_BIN="${VIDTOOLZ_SYSTEMCTL_BIN:-systemctl}"
SLEEP_BIN="${VIDTOOLZ_SLEEP_BIN:-sleep}"
READY_ATTEMPTS="${VIDTOOLZ_READY_ATTEMPTS:-20}"
READY_DELAY="${VIDTOOLZ_READY_DELAY:-0.5}"
HTTP_TIMEOUT="${VIDTOOLZ_HTTP_TIMEOUT:-2}"

ready() {
  "$CURL_BIN" -fsS --max-time "$HTTP_TIMEOUT" \
    "http://127.0.0.1:${PORT}/api/package-engine/status" >/dev/null 2>&1
}

if ready; then
  exit 0
fi

# Only the systemd unit's own port (8010) is managed here.
if [ "$PORT" = "8010" ]; then
  if ! "$SYSTEMCTL_BIN" --user start vidtoolz-cockpit.service; then
    printf 'Episode Factory service start failed (vidtoolz-cockpit.service).\n' >&2
    "$SYSTEMCTL_BIN" --user --no-pager --full status vidtoolz-cockpit.service >&2 || true
    exit 1
  fi
else
  printf 'Port %s is not owned by vidtoolz-cockpit.service.\n' "$PORT" >&2
  exit 1
fi

for _ in $(seq 1 "$READY_ATTEMPTS"); do
  ready && exit 0
  "$SLEEP_BIN" "$READY_DELAY"
done

printf 'Episode Factory service did not become HTTP-ready on port %s.\n' "$PORT" >&2
"$SYSTEMCTL_BIN" --user --no-pager --full status vidtoolz-cockpit.service >&2 || true
exit 1
