#!/usr/bin/env sh
# Idempotent installer for the VIDTOOLZ Motion Graphics Studio desktop shortcut.
#
# Safe to run repeatedly: it overwrites a single .desktop file with a fixed
# name and touches nothing else (it does NOT modify the Super Focus or Script
# Evaluator shortcuts). It reuses the existing, idempotent launcher
# (~/bin/open-episode-factory-page) which starts the cockpit only if it is not
# already running, then opens the page with the OS default browser.
#
# Shortcut target: http://127.0.0.1:8010/motion-graphics-studio.html
set -eu

APPS_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${APPS_DIR}/VIDTOOLZ Motion Graphics Studio.desktop"
LAUNCHER="${HOME}/bin/open-episode-factory-page"
PAGE="motion-graphics-studio.html"
PORT="${1:-8010}"

if [ ! -x "$LAUNCHER" ]; then
  echo "ERROR: launcher not found or not executable: $LAUNCHER" >&2
  echo "Cannot install the Motion Graphics Studio shortcut without it." >&2
  exit 1
fi

mkdir -p "$APPS_DIR"

# Write atomically (tmp + mv) so a concurrent read never sees a partial file.
TMP_FILE="${DESKTOP_FILE}.tmp.$$"
cat > "$TMP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=VIDTOOLZ Motion Graphics Studio
Comment=Deterministic branded motion cards (HyperFrames/Remotion); local-first, no auto-render
Exec=${LAUNCHER} ${PAGE} ${PORT}
Terminal=false
Icon=applications-graphics
Categories=AudioVideo;Graphics;Development;
EOF
mv "$TMP_FILE" "$DESKTOP_FILE"

# Refresh the desktop database if the tool is available (best-effort, non-fatal).
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

echo "Installed Motion Graphics Studio shortcut:"
echo "  $DESKTOP_FILE"
echo "  -> ${LAUNCHER} ${PAGE} ${PORT}"
echo "  -> http://127.0.0.1:${PORT}/${PAGE}"
