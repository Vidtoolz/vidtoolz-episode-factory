#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
MANIFEST_TOOL="$SCRIPT_DIR/music-creator-data-manifest.js"
VERIFY_TOOL="$SCRIPT_DIR/music-creator-data-verify.js"
SOURCE_ROOT=${MUSIC_CREATOR_DATA_ROOT:-/home/vidtoolz/vidtoolz-score-projects}
BACKUP_ROOT=${MUSIC_CREATOR_BACKUP_ROOT:-/mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups}
STEP_TIMEOUT=${MUSIC_CREATOR_BACKUP_STEP_TIMEOUT:-4h}

usage() {
  cat <<'EOF'
Usage:
  ./ops/music-creator-data-backup.sh --status
  ./ops/music-creator-data-backup.sh --dry-run
  ./ops/music-creator-data-backup.sh --backup
  ./ops/music-creator-data-backup.sh --verify BACKUP_DIR
  ./ops/music-creator-data-backup.sh --restore BACKUP_DIR ABSENT_TARGET_DIR

Environment overrides for tests/operators:
  MUSIC_CREATOR_DATA_ROOT
  MUSIC_CREATOR_BACKUP_ROOT
  MUSIC_CREATOR_BACKUP_STEP_TIMEOUT
EOF
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
absolute_dir() { [[ "$1" = /* ]] || fail "path must be absolute: $1"; }
sha() { sha256sum -- "$1" | awk '{print $1}'; }
nearest_existing_parent() {
  local candidate=$1
  while [[ ! -e "$candidate" ]]; do
    local parent
    parent=$(dirname -- "$candidate")
    [[ "$parent" != "$candidate" ]] || fail "no existing parent for $1"
    candidate=$parent
  done
  printf '%s\n' "$candidate"
}
mount_source() { findmnt -T "$1" -n -o SOURCE | tail -1; }

validate_roots() {
  absolute_dir "$SOURCE_ROOT"
  absolute_dir "$BACKUP_ROOT"
  [[ -d "$SOURCE_ROOT" ]] || fail "source root missing: $SOURCE_ROOT"
  [[ "$BACKUP_ROOT" != "$SOURCE_ROOT" && "$BACKUP_ROOT" != "$SOURCE_ROOT/"* ]] || fail "backup root cannot be inside source root"
  local backup_parent source_mount backup_mount
  backup_parent=$(nearest_existing_parent "$BACKUP_ROOT")
  source_mount=$(mount_source "$SOURCE_ROOT")
  backup_mount=$(mount_source "$backup_parent")
  if [[ ${MUSIC_CREATOR_BACKUP_ALLOW_SAME_DEVICE:-0} != 1 && "$source_mount" = "$backup_mount" ]]; then
    fail "backup destination is not independent from source device ($source_mount)"
  fi
}

verify_backup() {
  local backup=$1 metadata archive manifest
  absolute_dir "$backup"
  [[ -d "$backup" ]] || fail "backup directory missing: $backup"
  metadata="$backup/backup.json"
  archive="$backup/data.tar"
  manifest="$backup/integrity-manifest.jsonl"
  [[ -f "$metadata" && -f "$archive" && -f "$manifest" && -f "$backup/VERIFIED" ]] || fail "backup is incomplete or unverified: $backup"
  [[ $(jq -r '.status' "$metadata") = verified ]] || fail "backup metadata is not verified"
  [[ $(sha "$archive") = "$(jq -r '.archive_sha256' "$metadata")" ]] || fail "archive checksum mismatch"
  [[ $(sha "$manifest") = "$(jq -r '.manifest_sha256' "$metadata")" ]] || fail "manifest checksum mismatch"
  timeout "$STEP_TIMEOUT" tar -tf "$archive" >/dev/null || fail "archive structure verification failed"
  printf 'VERIFIED backup_id=%s files=%s bytes=%s manifest_sha256=%s\n' \
    "$(jq -r '.backup_id' "$metadata")" "$(jq -r '.file_count' "$metadata")" \
    "$(jq -r '.byte_count' "$metadata")" "$(jq -r '.manifest_sha256' "$metadata")"
}

status() {
  local pointer="$BACKUP_ROOT/latest-successful"
  if [[ ! -f "$pointer" ]]; then
    printf 'NO_VERIFIED_BACKUP backup_root=%s\n' "$BACKUP_ROOT"
    return 2
  fi
  local id backup
  id=$(head -1 "$pointer")
  [[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || fail "invalid latest-successful pointer"
  backup="$BACKUP_ROOT/snapshots/$id"
  verify_backup "$backup"
  printf 'latest_successful=%s destination=%s completed_at=%s\n' "$id" "$backup" "$(jq -r '.completed_at' "$backup/backup.json")"
}

dry_run() {
  validate_roots
  local source_bytes source_files available
  source_bytes=$(du -sb "$SOURCE_ROOT" | awk '{print $1}')
  source_files=$(find "$SOURCE_ROOT" -type f | wc -l)
  available=$(df -B1 --output=avail "$(nearest_existing_parent "$BACKUP_ROOT")" | tail -1 | tr -d ' ')
  printf 'DRY_RUN source=%s files=%s bytes=%s destination=%s available=%s source_mount=%s destination_mount=%s\n' \
    "$SOURCE_ROOT" "$source_files" "$source_bytes" "$BACKUP_ROOT" "$available" \
    "$(mount_source "$SOURCE_ROOT")" "$(mount_source "$(nearest_existing_parent "$BACKUP_ROOT")")"
}

backup() {
  validate_roots
  mkdir -p -- "$BACKUP_ROOT/snapshots" "$BACKUP_ROOT/.staging"
  exec 9>"$BACKUP_ROOT/.backup.lock"
  flock -n 9 || fail "another Music Creator backup is active"

  local id stage completed started completed_at before_summary after_summary manifest_hash archive_hash
  id="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$SOURCE_ROOT:$PPID:$RANDOM" | sha256sum | cut -c1-8)"
  stage="$BACKUP_ROOT/.staging/$id"
  completed="$BACKUP_ROOT/snapshots/$id"
  [[ ! -e "$stage" && ! -e "$completed" ]] || fail "backup ID collision: $id"
  mkdir -p -- "$stage"
  started=$(date -u +%FT%TZ)

  before_summary=$(timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$SOURCE_ROOT" "$stage/source-before.jsonl")
  timeout "$STEP_TIMEOUT" node "$VERIFY_TOOL" "$SOURCE_ROOT" "$SOURCE_ROOT" > "$stage/source-consistency.json"
  timeout "$STEP_TIMEOUT" tar --create --file "$stage/data.tar" --directory "$SOURCE_ROOT" --one-file-system .
  if [[ ${MUSIC_CREATOR_BACKUP_TEST_MODE:-0} = 1 && -n ${MUSIC_CREATOR_BACKUP_TEST_AFTER_ARCHIVE_COMMAND:-} ]]; then
    bash -c "$MUSIC_CREATOR_BACKUP_TEST_AFTER_ARCHIVE_COMMAND"
  fi
  after_summary=$(timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$SOURCE_ROOT" "$stage/source-after.jsonl")
  cmp -s "$stage/source-before.jsonl" "$stage/source-after.jsonl" || fail "source changed during backup; staging was not promoted"
  [[ "$before_summary" = "$after_summary" ]] || fail "source accounting changed during backup"
  mv -- "$stage/source-before.jsonl" "$stage/integrity-manifest.jsonl"
  unlink -- "$stage/source-after.jsonl"

  timeout "$STEP_TIMEOUT" tar -tf "$stage/data.tar" >/dev/null
  manifest_hash=$(sha "$stage/integrity-manifest.jsonl")
  archive_hash=$(sha "$stage/data.tar")
  completed_at=$(date -u +%FT%TZ)
  jq -n \
    --arg backup_id "$id" --arg started_at "$started" --arg completed_at "$completed_at" \
    --arg source_path "$SOURCE_ROOT" --arg source_host "$(hostname)" --arg destination "$completed" \
    --arg manifest_sha256 "$manifest_hash" --arg archive_sha256 "$archive_hash" \
    --argjson file_count "$(jq -r '.files' <<<"$before_summary")" \
    --argjson directory_count "$(jq -r '.directories' <<<"$before_summary")" \
    --argjson symlink_count "$(jq -r '.symlinks' <<<"$before_summary")" \
    --argjson byte_count "$(jq -r '.bytes' <<<"$before_summary")" \
    '{schema_version:1,tool:"music-creator-data-backup",status:"verified",backup_id:$backup_id,started_at:$started_at,completed_at:$completed_at,source_path:$source_path,source_host:$source_host,destination:$destination,file_count:$file_count,directory_count:$directory_count,symlink_count:$symlink_count,byte_count:$byte_count,manifest_sha256:$manifest_sha256,archive_sha256:$archive_sha256,verification:{source_stable:true,archive_readable:true,manifest_verified:true}}' \
    > "$stage/backup.json"
  printf 'verified %s\n' "$completed_at" > "$stage/VERIFIED"
  mv -- "$stage" "$completed"
  local pointer_tmp="$BACKUP_ROOT/.latest-successful.$id"
  printf '%s\n' "$id" > "$pointer_tmp"
  mv -- "$pointer_tmp" "$BACKUP_ROOT/latest-successful"
  verify_backup "$completed"
}

restore_backup() {
  local backup=$1 target=$2 parent stage
  absolute_dir "$target"
  [[ "$target" != / && "$target" != "$HOME" && "$target" != "$SOURCE_ROOT" ]] || fail "unsafe restore target: $target"
  [[ ! -e "$target" ]] || fail "restore target already exists: $target"
  verify_backup "$backup" >/dev/null
  parent=$(nearest_existing_parent "$(dirname -- "$target")")
  stage="$(dirname -- "$target")/.restore-staging-$(basename -- "$target")-$$"
  [[ ! -e "$stage" ]] || fail "restore staging path exists: $stage"
  mkdir -p -- "$stage"
  timeout "$STEP_TIMEOUT" tar -xf "$backup/data.tar" -C "$stage"
  timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$stage" "$stage.manifest.jsonl" >/dev/null
  if ! cmp -s "$backup/integrity-manifest.jsonl" "$stage.manifest.jsonl"; then
    fail "restored content does not match integrity manifest; staging retained at $stage"
  fi
  timeout "$STEP_TIMEOUT" node "$VERIFY_TOOL" "$stage" "$(jq -r '.source_path' "$backup/backup.json")" > "$stage.consistency.json" || fail "restored registry/provenance consistency check failed; staging retained at $stage"
  mv -- "$stage" "$target"
  mv -- "$stage.manifest.jsonl" "$target.restore-manifest.jsonl"
  mv -- "$stage.consistency.json" "$target.restore-consistency.json"
  printf 'RESTORED backup_id=%s target=%s manifest_sha256=%s\n' \
    "$(jq -r '.backup_id' "$backup/backup.json")" "$target" "$(sha "$target.restore-manifest.jsonl")"
}

case ${1:-} in
  --status) [[ $# = 1 ]] || { usage; exit 64; }; status ;;
  --dry-run) [[ $# = 1 ]] || { usage; exit 64; }; dry_run ;;
  --backup) [[ $# = 1 ]] || { usage; exit 64; }; backup ;;
  --verify) [[ $# = 2 ]] || { usage; exit 64; }; verify_backup "$2" ;;
  --restore) [[ $# = 3 ]] || { usage; exit 64; }; restore_backup "$2" "$3" ;;
  --help|-h) usage ;;
  *) usage; exit 64 ;;
esac
