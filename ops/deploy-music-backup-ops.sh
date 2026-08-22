#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SOURCE_DIR="$SCRIPT_DIR/systemd"
TARGET_DIR=${MUSIC_CREATOR_SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}
UNITS=(vidtoolz-music-creator-backup.service vidtoolz-music-creator-backup.timer)

usage() { printf 'Usage: %s --install|--check\n' "$0" >&2; exit 64; }
check() {
  local failed=0 unit source target
  for unit in "${UNITS[@]}"; do
    source="$SOURCE_DIR/$unit"; target="$TARGET_DIR/$unit"
    if [[ -f "$target" ]] && cmp -s "$source" "$target"; then printf 'MATCH %s\n' "$target"
    else printf 'DRIFT %s\n' "$target"; failed=1; fi
  done
  return "$failed"
}
install_units() {
  local stage unit
  mkdir -p -- "$TARGET_DIR"
  stage=$(mktemp -d "$TARGET_DIR/.music-creator-backup-units.XXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  for unit in "${UNITS[@]}"; do install -m 0644 "$SOURCE_DIR/$unit" "$stage/$unit"; done
  for unit in "${UNITS[@]}"; do cmp -s "$SOURCE_DIR/$unit" "$stage/$unit" || { echo "staging verification failed: $unit" >&2; exit 1; }; done
  for unit in "${UNITS[@]}"; do mv -- "$stage/$unit" "$TARGET_DIR/$unit"; done
  rmdir "$stage"; trap - EXIT
  check
}

case ${1:-} in
  --install) [[ $# = 1 ]] || usage; install_units ;;
  --check) [[ $# = 1 ]] || usage; check ;;
  *) usage ;;
esac
