#!/usr/bin/env bash
# Deploy the canonical Music Creator operator launchers as one rollback-safe set.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SOURCE_DIR="${MUSIC_LAUNCHER_SOURCE_DIR:-${SCRIPT_DIR}/music-creator-launchers}"
BIN_DIR="${MUSIC_LAUNCHER_BIN_DIR:-${HOME}/bin}"
DESKTOP_DIR="${MUSIC_LAUNCHER_DESKTOP_DIR:-${HOME}/Desktop}"
MODE="${1:---deploy}"

NAMES=(ensure-cockpit.sh open-episode-factory-page open-music-creator vidtoolz-music3 23-Music-Creator.desktop)
TARGETS=(
  "${BIN_DIR}/ensure-cockpit.sh"
  "${BIN_DIR}/open-episode-factory-page"
  "${BIN_DIR}/open-music-creator"
  "${BIN_DIR}/vidtoolz-music3"
  "${DESKTOP_DIR}/23-Music-Creator.desktop"
)

usage() {
  printf 'Usage: %s [--deploy|--check]\n' "$0" >&2
  exit 64
}

[ "$MODE" = "--deploy" ] || [ "$MODE" = "--check" ] || usage
[ "$#" -le 1 ] || usage

for name in "${NAMES[@]}"; do
  source_file="${SOURCE_DIR}/${name}"
  if [ ! -f "$source_file" ]; then
    printf 'ERROR: canonical launcher source missing: %s\n' "$source_file" >&2
    exit 1
  fi
  if [ ! -x "$source_file" ]; then
    printf 'ERROR: canonical launcher source is not executable: %s\n' "$source_file" >&2
    exit 1
  fi
done

check_deployment() {
  local failures=0 index source_file target source_mode target_mode
  for index in "${!NAMES[@]}"; do
    source_file="${SOURCE_DIR}/${NAMES[$index]}"
    target="${TARGETS[$index]}"
    if [ ! -f "$target" ]; then
      printf 'MISSING  %s\n' "$target" >&2
      failures=1
      continue
    fi
    if ! cmp -s -- "$source_file" "$target"; then
      printf 'DRIFT    %s\n' "$target" >&2
      failures=1
      continue
    fi
    source_mode=$(stat -c '%a' -- "$source_file")
    target_mode=$(stat -c '%a' -- "$target")
    if [ "$source_mode" != "$target_mode" ]; then
      printf 'MODE     %s (canonical %s, deployed %s)\n' "$target" "$source_mode" "$target_mode" >&2
      failures=1
      continue
    fi
    printf 'MATCH    %s  sha256=%s mode=%s\n' \
      "$target" "$(sha256sum -- "$target" | awk '{print $1}')" "$target_mode"
  done
  return "$failures"
}

if [ "$MODE" = "--check" ]; then
  check_deployment
  exit $?
fi

mkdir -p -- "$BIN_DIR" "$DESKTOP_DIR"

# A fully current deployment is a no-op, including mtimes.
if check_deployment >/dev/null 2>&1; then
  printf 'Music Creator launchers are already current; no files changed.\n'
  check_deployment
  exit 0
fi

transaction_dir=$(mktemp -d "${TMPDIR:-/tmp}/music-launchers-deploy.XXXXXX")
declare -a staged=() backups=() existed=()
deployment_started=0
deployment_complete=0

cleanup_staging() {
  local item
  for item in "${staged[@]:-}"; do
    [ -n "$item" ] && rm -f -- "$item"
  done
  rm -rf -- "$transaction_dir"
}

rollback() {
  local index target restore_tmp failed=0
  [ "$deployment_started" = "1" ] || return 0
  [ "$deployment_complete" = "0" ] || return 0
  printf 'Deployment interrupted; restoring the complete previous launcher set.\n' >&2
  for index in "${!TARGETS[@]}"; do
    target="${TARGETS[$index]}"
    if [ "${existed[$index]:-0}" = "1" ]; then
      restore_tmp=$(mktemp "${target}.rollback.XXXXXX") || { failed=1; continue; }
      if cp -p -- "${backups[$index]}" "$restore_tmp" && mv -f -- "$restore_tmp" "$target"; then
        :
      else
        rm -f -- "$restore_tmp"
        failed=1
      fi
    else
      rm -f -- "$target" || failed=1
    fi
  done
  [ "$failed" = "0" ] || printf 'ERROR: rollback could not restore every target; inspect %s\n' "$transaction_dir" >&2
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then rollback; fi
  cleanup_staging
  exit "$rc"
}
trap on_exit EXIT

# Validate and stage every file beside its destination, so each promotion is
# an atomic rename on the destination filesystem. No live target changes yet.
for index in "${!NAMES[@]}"; do
  source_file="${SOURCE_DIR}/${NAMES[$index]}"
  target="${TARGETS[$index]}"
  source_mode=$(stat -c '%a' -- "$source_file")
  stage=$(mktemp "${target}.new.XXXXXX")
  staged[$index]="$stage"
  install -m "$source_mode" -- "$source_file" "$stage"
  cmp -s -- "$source_file" "$stage" || {
    printf 'ERROR: staged launcher verification failed: %s\n' "$source_file" >&2
    exit 1
  }
done

# Snapshot the whole prior set before the first promotion. Rollback restores
# all targets if any later rename or verification fails.
for index in "${!TARGETS[@]}"; do
  target="${TARGETS[$index]}"
  backup="${transaction_dir}/${index}.backup"
  backups[$index]="$backup"
  if [ -e "$target" ]; then
    cp -p -- "$target" "$backup"
    existed[$index]=1
  else
    existed[$index]=0
  fi
done

deployment_started=1
promoted=0
for index in "${!TARGETS[@]}"; do
  mv -f -- "${staged[$index]}" "${TARGETS[$index]}"
  staged[$index]=""
  promoted=$((promoted + 1))
  if [ "${MUSIC_LAUNCHER_ALLOW_TEST_FAILURE:-0}" = "1" ] && \
     [ "${MUSIC_LAUNCHER_TEST_FAIL_AFTER:-0}" = "$promoted" ]; then
    printf 'ERROR: simulated deployment interruption after %s promotions.\n' "$promoted" >&2
    exit 70
  fi
done

if ! check_deployment; then
  printf 'ERROR: deployed launcher set failed post-deployment verification.\n' >&2
  exit 1
fi

deployment_complete=1
printf 'Music Creator launcher deployment complete.\n'
