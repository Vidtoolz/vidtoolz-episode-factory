#!/usr/bin/env bash
# Launcher for Directed Draft Review Inspector GUI (port 8095)
set -euo pipefail

PORT=8095
URL="http://127.0.0.1:${PORT}"
SERVER_SCRIPT="/home/vidtoolz/vidtoolz-episode-factory/scripts/autonomous-visual-draft/directed-draft-inspector-server.js"
LOG_FILE="/home/vidtoolz/.local/share/vidtoolz-launcher-logs/directed-draft-inspector.log"

mkdir -p "$(dirname "$LOG_FILE")"

# Check if server is already running on port 8095
if ss -tulpn 2>/dev/null | grep -q ":${PORT} "; then
  echo "Directed Draft Inspector server already running on port ${PORT}."
else
  echo "Starting Directed Draft Inspector server..."
  nohup node "$SERVER_SCRIPT" >> "$LOG_FILE" 2>&1 &
  sleep 1
fi

echo "Opening ${URL} in browser..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
fi
