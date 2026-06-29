#!/usr/bin/env bash
# Open the CURRENT active package run in the canonical cockpit.
#
# Unlike per-episode shortcuts that hardcode a run id (and go stale the moment a
# run is parked/superseded or a new one starts), this resolves the active run at
# launch time from the canonical orientation API (/api/cockpit-orientation) and
# opens the cockpit's canonical "what now" surface. Read-only: it never changes
# package-run state, advances gates, or starts jobs.
set -euo pipefail

COCKPIT="${VIDTOOLZ_COCKPIT_URL:-http://127.0.0.1:8010}"
DASHBOARD="${COCKPIT}/package-runs-dashboard.html"

payload="$(curl -fsS "${COCKPIT}/api/cockpit-orientation" 2>/dev/null || true)"
if [ -z "${payload}" ]; then
  echo "VIDTOOLZ cockpit is not reachable at ${COCKPIT}." >&2
  echo "Start it with: systemctl --user start vidtoolz-cockpit.service" >&2
  exit 1
fi

mode="$(printf '%s' "${payload}" | jq -r '.data.mode // ""')"
run_id="$(printf '%s' "${payload}" | jq -r '.data.activeRun // ""')"
gate="$(printf '%s' "${payload}" | jq -r '.data.currentGate // ""')"
withheld="$(printf '%s' "${payload}" | jq -r '.data.guidanceWithheld // false')"

if [ "${mode}" = "AMBIGUOUS" ] || [ "${withheld}" = "true" ] || [ -z "${run_id}" ]; then
  echo "No single active run (state ambiguous or none). Opening the cockpit dashboard so you can resolve active state." >&2
else
  echo "Active run: ${run_id}  |  gate: ${gate}. Opening the canonical cockpit dashboard." >&2
fi

# The package-runs dashboard carries the canonical orientation strip + artifact
# panel, both of which reflect whatever run is currently active.
xdg-open "${DASHBOARD}" >/dev/null 2>&1 &
