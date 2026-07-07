#!/usr/bin/env sh
# Idempotent installer for the Super Focus desktop shortcut.
#
# Safe to run repeatedly: it overwrites a single .desktop file with a fixed
# name and touches nothing else. It reuses the existing, idempotent launcher
# (~/bin/open-episode-factory-page) which starts the cockpit only if it is not
# already running, then opens the page with the OS default browser.
#
# Shortcut target: http://127.0.0.1:8010/super-focus.html
set -eu

APPS_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${APPS_DIR}/VIDTOOLZ Super Focus.desktop"
LAUNCHER="${HOME}/bin/open-episode-factory-page"
PORT="${1:-8010}"

if [ ! -x "$LAUNCHER" ]; then
  echo "ERROR: launcher not found or not executable: $LAUNCHER" >&2
  echo "Cannot install the Super Focus shortcut without it." >&2
  exit 1
fi

mkdir -p "$APPS_DIR"

# Write atomically (tmp + mv) so a concurrent read never sees a partial file.
TMP_FILE="${DESKTOP_FILE}.tmp.$$"
cat > "$TMP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=VIDTOOLZ Super Focus
Comment=Minimal single-flow VIDTOOLZ production view (local-first)
Exec=${LAUNCHER} super-focus.html ${PORT}
Terminal=false
Icon=view-fullscreen-symbolic
Categories=AudioVideo;Development;
EOF
mv "$TMP_FILE" "$DESKTOP_FILE"

# Refresh the desktop database if the tool is available (best-effort, non-fatal).
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

echo "Installed Super Focus shortcut:"
echo "  $DESKTOP_FILE"
echo "  -> ${LAUNCHER} super-focus.html ${PORT}"
echo "  -> http://127.0.0.1:${PORT}/super-focus.html"
