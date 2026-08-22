#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
MANIFEST_TOOL="$SCRIPT_DIR/music-creator-data-manifest.js"
VERIFY_TOOL="$SCRIPT_DIR/music-creator-data-verify.js"
SOURCE_ROOT=${MUSIC_CREATOR_DATA_ROOT:-/home/vidtoolz/vidtoolz-score-projects}
BACKUP_ROOT=${MUSIC_CREATOR_BACKUP_ROOT:-/mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups}
STEP_TIMEOUT=${MUSIC_CREATOR_BACKUP_STEP_TIMEOUT:-4h}
RETENTION_KEEP=${MUSIC_CREATOR_BACKUP_RETENTION_KEEP:-7}
EXPECTED_BACKUP_SOURCE=${MUSIC_CREATOR_BACKUP_EXPECTED_SOURCE:-//192.168.61.186/Public}
EXPECTED_BACKUP_FSTYPE=${MUSIC_CREATOR_BACKUP_EXPECTED_FSTYPE:-cifs}
MIN_FREE_AFTER=${MUSIC_CREATOR_BACKUP_MIN_FREE_AFTER:-10737418240}
EXTERNAL_PROJECT_ID=${MUSIC_CREATOR_EXTERNAL_PROJECT_ID:-pkg-why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630}
EXTERNAL_SOURCE=${MUSIC_CREATOR_EXTERNAL_SOURCE:-/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630/music}
EXTERNAL_BACKUP_ROOT=${MUSIC_CREATOR_EXTERNAL_BACKUP_ROOT:-/home/vidtoolz/vidtoolz-music-external-backups/$EXTERNAL_PROJECT_ID}
EXTERNAL_RETENTION_KEEP=${MUSIC_CREATOR_EXTERNAL_RETENTION_KEEP:-2}
DRILL_STATE_ROOT=${MUSIC_CREATOR_RESTORE_DRILL_STATE_ROOT:-/home/vidtoolz/.local/state/vidtoolz/music-creator-backup}
DRILL_SCRATCH_PARENT=${MUSIC_CREATOR_RESTORE_DRILL_SCRATCH_PARENT:-/home/vidtoolz}
DRILL_MIN_FREE_AFTER=${MUSIC_CREATOR_RESTORE_DRILL_MIN_FREE_AFTER:-10737418240}
DRILL_PROJECT_ID=${MUSIC_CREATOR_RESTORE_DRILL_PROJECT_ID:-2026-08-21-mc-smoke-04-24-18}
DRILL_CANDIDATE_ID=${MUSIC_CREATOR_RESTORE_DRILL_CANDIDATE_ID:-music-candidate-002}
DRILL_PLAN_REVISION=${MUSIC_CREATOR_RESTORE_DRILL_PLAN_REVISION:-7aeb9c2281a548c64742056276be12de5e57e48ea1ca166f5363015a8eb09a30}
DRILL_WAV_SHA256=${MUSIC_CREATOR_RESTORE_DRILL_WAV_SHA256:-18d947a3733bf244d1f4b716df09972f0176b6fe7760bec09b2b48427760ffb8}
DRILL_QUALITY_PROJECTS=${MUSIC_CREATOR_RESTORE_DRILL_QUALITY_PROJECTS:-6}
DRILL_MAX_AGE_DAYS=${MUSIC_CREATOR_RESTORE_DRILL_MAX_AGE_DAYS:-45}

usage() {
  cat <<'EOF'
Usage:
  ./ops/music-creator-data-backup.sh --status
  ./ops/music-creator-data-backup.sh --dry-run
  ./ops/music-creator-data-backup.sh --backup
  ./ops/music-creator-data-backup.sh --scheduled-run
  ./ops/music-creator-data-backup.sh --retention-preview
  ./ops/music-creator-data-backup.sh --apply-retention
  ./ops/music-creator-data-backup.sh --verify BACKUP_DIR
  ./ops/music-creator-data-backup.sh --restore BACKUP_DIR ABSENT_TARGET_DIR
  ./ops/music-creator-data-backup.sh --external-verify BACKUP_DIR
  ./ops/music-creator-data-backup.sh --external-restore BACKUP_DIR ABSENT_TARGET_DIR
  ./ops/music-creator-data-backup.sh --restore-drill

Environment overrides for tests/operators:
  MUSIC_CREATOR_DATA_ROOT
  MUSIC_CREATOR_BACKUP_ROOT
  MUSIC_CREATOR_BACKUP_STEP_TIMEOUT
  MUSIC_CREATOR_EXTERNAL_SOURCE
  MUSIC_CREATOR_EXTERNAL_BACKUP_ROOT
  MUSIC_CREATOR_RESTORE_DRILL_SCRATCH_PARENT
  MUSIC_CREATOR_RESTORE_DRILL_STATE_ROOT
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
mount_fstype() { findmnt -T "$1" -n -o FSTYPE | tail -1; }

validate_expected_nas() {
  local path=$1 source fstype
  source=$(mount_source "$path")
  fstype=$(mount_fstype "$path")
  if [[ ${MUSIC_CREATOR_BACKUP_TEST_MODE:-0} != 1 ]]; then
    [[ "$source" = "$EXPECTED_BACKUP_SOURCE" && "$fstype" = "$EXPECTED_BACKUP_FSTYPE" ]] ||
      fail "expected NAS mount $EXPECTED_BACKUP_SOURCE ($EXPECTED_BACKUP_FSTYPE), got $source ($fstype) at $path"
  fi
}

require_capacity() {
  local source_root=$1 destination=$2 needed available
  needed=$(du -sb "$source_root" | awk '{print $1}')
  available=$(df -B1 --output=avail "$destination" | tail -1 | tr -d ' ')
  (( available >= needed + MIN_FREE_AFTER )) || fail "insufficient destination space: available=$available required=$((needed + MIN_FREE_AFTER))"
}

validate_roots() {
  absolute_dir "$SOURCE_ROOT"
  absolute_dir "$BACKUP_ROOT"
  [[ -d "$SOURCE_ROOT" ]] || fail "source root missing: $SOURCE_ROOT"
  [[ "$BACKUP_ROOT" != "$SOURCE_ROOT" && "$BACKUP_ROOT" != "$SOURCE_ROOT/"* ]] || fail "backup root cannot be inside source root"
  local backup_parent source_mount backup_mount
  backup_parent=$(nearest_existing_parent "$BACKUP_ROOT")
  validate_expected_nas "$backup_parent"
  source_mount=$(mount_source "$SOURCE_ROOT")
  backup_mount=$(mount_source "$backup_parent")
  if [[ ${MUSIC_CREATOR_BACKUP_ALLOW_SAME_DEVICE:-0} != 1 && "$source_mount" = "$backup_mount" ]]; then
    fail "backup destination is not independent from source device ($source_mount)"
  fi
  require_capacity "$SOURCE_ROOT" "$backup_parent"
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

locked_verify() {
  local root=$1 backup=$2
  mkdir -p -- "$root"
  exec 6>"$root/.backup.lock"; flock -n 6 || fail "backup/retention/restore operation is active for $root"
  verify_backup "$backup"
  flock -u 6
}

recognized_snapshot() {
  local root=$1 dir=$2 id metadata manifest
  id=$(basename -- "$dir")
  [[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || return 1
  [[ "$dir" = "$root/snapshots/$id" && -d "$dir" ]] || return 1
  metadata="$dir/backup.json"; manifest="$dir/integrity-manifest.jsonl"
  [[ -f "$metadata" && -f "$manifest" && -f "$dir/data.tar" && -f "$dir/VERIFIED" ]] || return 1
  [[ $(jq -r '.status' "$metadata" 2>/dev/null) = verified && $(jq -r '.backup_id' "$metadata" 2>/dev/null) = "$id" ]] || return 1
  [[ $(sha "$manifest") = "$(jq -r '.manifest_sha256' "$metadata" 2>/dev/null)" ]] || return 1
}

retention_plan() {
  local root=$1 keep=$2 latest="" dir id size index cutoff reason action
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || fail "retention count must be a positive integer"
  [[ -d "$root/snapshots" ]] || { printf 'RETENTION root=%s verified=0 keep=%s\n' "$root" "$keep"; return; }
  [[ -f "$root/latest-successful" ]] && latest=$(head -1 "$root/latest-successful")
  local -a verified=() unknown=()
  while IFS= read -r dir; do
    if recognized_snapshot "$root" "$dir"; then verified+=("$dir"); else unknown+=("$dir"); fi
  done < <(find "$root/snapshots" -mindepth 1 -maxdepth 1 -type d -print | sort)
  cutoff=$((${#verified[@]} - keep)); (( cutoff < 0 )) && cutoff=0
  printf 'RETENTION root=%s verified=%s keep=%s latest=%s\n' "$root" "${#verified[@]}" "$keep" "${latest:-none}"
  for ((index=0; index<${#verified[@]}; index++)); do
    dir=${verified[$index]}; id=$(basename -- "$dir"); size=$(du -sb "$dir" | awk '{print $1}')
    action=RETAIN; reason=newest
    if [[ -f "$dir/PINNED" ]]; then reason=pinned
    elif [[ "$id" = "$latest" ]]; then reason=latest
    elif (( index < cutoff )); then action=REMOVE; reason=outside-retention
    fi
    printf '%s backup_id=%s bytes=%s reason=%s\n' "$action" "$id" "$size" "$reason"
  done
  for dir in "${unknown[@]}"; do
    printf 'PROTECT_UNKNOWN name=%s reason=unrecognized-or-unverified\n' "$(basename -- "$dir")"
  done
}

apply_retention_root() {
  local root=$1 keep=$2 lock_file=$3 plan line id dir removed=0 bytes=0 size latest
  mkdir -p -- "$root/snapshots"
  exec 8>"$lock_file"
  flock -n 8 || fail "backup/retention operation is active for $root"
  plan=$(retention_plan "$root" "$keep")
  latest=""; [[ -f "$root/latest-successful" ]] && latest=$(head -1 "$root/latest-successful")
  while IFS= read -r line; do
    [[ "$line" = REMOVE\ * ]] || continue
    id=${line#*backup_id=}; id=${id%% *}; dir="$root/snapshots/$id"
    [[ "$id" != "$latest" ]] || fail "retention attempted to remove latest-successful"
    recognized_snapshot "$root" "$dir" || fail "retention candidate changed or became ambiguous: $id"
    [[ ! -f "$dir/PINNED" ]] || fail "retention candidate became pinned: $id"
    size=$(du -sb "$dir" | awk '{print $1}')
    rm -rf -- "$dir"
    removed=$((removed + 1)); bytes=$((bytes + size))
    printf 'REMOVED backup_id=%s bytes=%s\n' "$id" "$size"
  done <<< "$plan"
  [[ -z "$latest" || -d "$root/snapshots/$latest" ]] || fail "latest-successful was lost"
  printf 'RETENTION_APPLIED root=%s removed=%s reclaimed_bytes=%s\n' "$root" "$removed" "$bytes"
}

validate_external() {
  absolute_dir "$EXTERNAL_SOURCE"; absolute_dir "$EXTERNAL_BACKUP_ROOT"
  [[ -d "$EXTERNAL_SOURCE" ]] || fail "external payload missing: $EXTERNAL_SOURCE"
  local registered
  registered=$(jq -r --arg id "$EXTERNAL_PROJECT_ID" '.projects[] | select(.project_id==$id) | .path' "$SOURCE_ROOT/score-registry.json")
  [[ "$registered" = "$EXTERNAL_SOURCE" ]] || fail "external payload is not the exact registered project path"
  [[ "$(realpath "$EXTERNAL_SOURCE")" = "$EXTERNAL_SOURCE" ]] || fail "external payload path must be canonical and non-symlinked"
  validate_expected_nas "$EXTERNAL_SOURCE"
  local parent source_mount backup_mount
  parent=$(nearest_existing_parent "$EXTERNAL_BACKUP_ROOT")
  source_mount=$(mount_source "$EXTERNAL_SOURCE"); backup_mount=$(mount_source "$parent")
  [[ "$source_mount" != "$backup_mount" || ${MUSIC_CREATOR_BACKUP_TEST_MODE:-0} = 1 ]] || fail "external backup is not independent from payload device"
  require_capacity "$EXTERNAL_SOURCE" "$parent"
}

external_backup() {
  validate_external
  mkdir -p -- "$EXTERNAL_BACKUP_ROOT/snapshots" "$EXTERNAL_BACKUP_ROOT/.staging"
  exec 7>"$EXTERNAL_BACKUP_ROOT/.backup.lock"; flock -n 7 || fail "another external payload backup is active"
  local id stage completed started completed_at summary after_summary manifest_hash archive_hash
  id="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$EXTERNAL_SOURCE:$PPID:$RANDOM" | sha256sum | cut -c1-8)"
  stage="$EXTERNAL_BACKUP_ROOT/.staging/$id"; completed="$EXTERNAL_BACKUP_ROOT/snapshots/$id"
  mkdir -p -- "$stage"; started=$(date -u +%FT%TZ)
  summary=$(timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$EXTERNAL_SOURCE" "$stage/source-before.jsonl")
  timeout "$STEP_TIMEOUT" tar --create --file "$stage/data.tar" --directory "$EXTERNAL_SOURCE" --one-file-system .
  after_summary=$(timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$EXTERNAL_SOURCE" "$stage/source-after.jsonl")
  cmp -s "$stage/source-before.jsonl" "$stage/source-after.jsonl" || fail "external payload changed during backup"
  [[ "$summary" = "$after_summary" ]] || fail "external payload accounting changed during backup"
  mv -- "$stage/source-before.jsonl" "$stage/integrity-manifest.jsonl"; unlink -- "$stage/source-after.jsonl"
  timeout "$STEP_TIMEOUT" tar -tf "$stage/data.tar" >/dev/null
  manifest_hash=$(sha "$stage/integrity-manifest.jsonl"); archive_hash=$(sha "$stage/data.tar"); completed_at=$(date -u +%FT%TZ)
  jq -n --arg backup_id "$id" --arg started_at "$started" --arg completed_at "$completed_at" \
    --arg source_path "$EXTERNAL_SOURCE" --arg source_host "$(hostname)" --arg destination "$completed" \
    --arg project_id "$EXTERNAL_PROJECT_ID" --arg manifest_sha256 "$manifest_hash" --arg archive_sha256 "$archive_hash" \
    --argjson file_count "$(jq -r '.files' <<<"$summary")" --argjson directory_count "$(jq -r '.directories' <<<"$summary")" \
    --argjson symlink_count "$(jq -r '.symlinks' <<<"$summary")" --argjson byte_count "$(jq -r '.bytes' <<<"$summary")" \
    '{schema_version:1,tool:"music-creator-external-data-backup",status:"verified",ownership:"MUSIC_CREATOR_OWNED",project_id:$project_id,backup_id:$backup_id,started_at:$started_at,completed_at:$completed_at,source_path:$source_path,source_host:$source_host,destination:$destination,file_count:$file_count,directory_count:$directory_count,symlink_count:$symlink_count,byte_count:$byte_count,manifest_sha256:$manifest_sha256,archive_sha256:$archive_sha256,verification:{source_stable:true,archive_readable:true,manifest_verified:true}}' > "$stage/backup.json"
  printf 'verified %s\n' "$completed_at" > "$stage/VERIFIED"
  mv -- "$stage" "$completed"; printf '%s\n' "$id" > "$EXTERNAL_BACKUP_ROOT/.latest-successful.$id"; mv -- "$EXTERNAL_BACKUP_ROOT/.latest-successful.$id" "$EXTERNAL_BACKUP_ROOT/latest-successful"
  verify_backup "$completed"
  flock -u 7
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
  local completed_at age_seconds
  completed_at=$(jq -r '.completed_at' "$backup/backup.json")
  age_seconds=$(( $(date -u +%s) - $(date -u -d "$completed_at" +%s) ))
  printf 'latest_successful=%s destination=%s completed_at=%s age_seconds=%s\n' "$id" "$backup" "$completed_at" "$age_seconds"
  local count bytes mount_ok=NO timer_state=not-installed next=unknown service_result=unknown external_status=missing
  count=$(find "$BACKUP_ROOT/snapshots" -mindepth 1 -maxdepth 1 -type d -exec test -f '{}/VERIFIED' \; -printf . | wc -c)
  bytes=$(du -sb "$BACKUP_ROOT/snapshots" | awk '{print $1}')
  if [[ "$(mount_source "$BACKUP_ROOT")" = "$EXPECTED_BACKUP_SOURCE" && "$(mount_fstype "$BACKUP_ROOT")" = "$EXPECTED_BACKUP_FSTYPE" ]]; then mount_ok=YES; fi
  if systemctl --user cat vidtoolz-music-creator-backup.timer >/dev/null 2>&1; then
    timer_state=$(systemctl --user is-enabled vidtoolz-music-creator-backup.timer 2>/dev/null || true)
    next=$(systemctl --user list-timers vidtoolz-music-creator-backup.timer --no-legend 2>/dev/null | awk '{$1=$1;print}' || true)
    service_result=$(systemctl --user show vidtoolz-music-creator-backup.service -p Result --value 2>/dev/null || true)
  fi
  if [[ -f "$EXTERNAL_BACKUP_ROOT/latest-successful" ]]; then external_status=$(head -1 "$EXTERNAL_BACKUP_ROOT/latest-successful"); fi
  printf 'operations retained=%s retained_bytes=%s retention_keep=%s nas_mount_ok=%s timer=%s service_result=%s external_latest=%s\n' "$count" "$bytes" "$RETENTION_KEEP" "$mount_ok" "$timer_state" "${service_result:-unknown}" "$external_status"
  printf 'next_scheduled=%s\n' "${next:-unknown}"

  local pinned=0 health=HEALTHY external_age=-1 drill_result=NEVER drill_age=-1 drill_backup=none
  pinned=$(find "$BACKUP_ROOT/snapshots" -mindepth 2 -maxdepth 2 -type f -name PINNED 2>/dev/null | wc -l)
  if [[ "$external_status" != missing && -f "$EXTERNAL_BACKUP_ROOT/snapshots/$external_status/backup.json" ]]; then
    external_age=$(( $(date -u +%s) - $(date -u -d "$(jq -r '.completed_at' "$EXTERNAL_BACKUP_ROOT/snapshots/$external_status/backup.json")" +%s) ))
  fi
  if [[ -f "$DRILL_STATE_ROOT/latest.json" ]]; then
    drill_result=$(jq -r '.result // "UNKNOWN"' "$DRILL_STATE_ROOT/latest.json" 2>/dev/null || printf UNKNOWN)
    drill_backup=$(jq -r '.canonical_backup_id // "none"' "$DRILL_STATE_ROOT/latest.json" 2>/dev/null || printf none)
    drill_age=$(( $(date -u +%s) - $(date -u -d "$(jq -r '.completed_at // .failed_at' "$DRILL_STATE_ROOT/latest.json")" +%s) ))
  fi
  if [[ "$mount_ok" != YES ]]; then health=NAS_UNAVAILABLE
  elif [[ "$timer_state" != enabled ]]; then health=TIMER_DISABLED
  elif (( age_seconds > 129600 )); then health=BACKUP_STALE
  elif (( external_age < 0 || external_age > 129600 )); then health=EXTERNAL_BACKUP_STALE
  elif [[ "$drill_result" = FAILED ]]; then health=RESTORE_DRILL_FAILED
  elif [[ "$drill_result" != PASS || $drill_age -gt $((DRILL_MAX_AGE_DAYS * 86400)) ]]; then health=RESTORE_DRILL_DUE
  fi
  printf 'recovery_health=%s pinned=%s restore_drill=%s drill_age_seconds=%s drill_canonical=%s\n' "$health" "$pinned" "$drill_result" "$drill_age" "$drill_backup"
  while IFS= read -r pin; do
    printf 'pinned_backup=%s reason=%s\n' "$(basename -- "$(dirname -- "$pin")")" "$(tr '\n' ' ' < "$pin" | sed 's/[[:space:]]*$//')"
  done < <(find "$BACKUP_ROOT/snapshots" -mindepth 2 -maxdepth 2 -type f -name PINNED 2>/dev/null | sort)
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
  validate_external
  printf 'EXTERNAL_DRY_RUN project_id=%s source=%s files=%s bytes=%s destination=%s source_mount=%s destination_mount=%s\n' \
    "$EXTERNAL_PROJECT_ID" "$EXTERNAL_SOURCE" "$(find "$EXTERNAL_SOURCE" -type f | wc -l)" "$(du -sb "$EXTERNAL_SOURCE" | awk '{print $1}')" \
    "$EXTERNAL_BACKUP_ROOT" "$(mount_source "$EXTERNAL_SOURCE")" "$(mount_source "$(nearest_existing_parent "$EXTERNAL_BACKUP_ROOT")")"
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
  flock -u 9
}

restore_backup() {
  local backup=$1 target=$2 parent stage
  exec 6>"$BACKUP_ROOT/.backup.lock"; flock -n 6 || fail "backup/retention/restore operation is active for $BACKUP_ROOT"
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

external_restore() {
  local backup=$1 target=$2 stage
  exec 6>"$EXTERNAL_BACKUP_ROOT/.backup.lock"; flock -n 6 || fail "backup/retention/restore operation is active for $EXTERNAL_BACKUP_ROOT"
  absolute_dir "$target"; [[ "$target" != / && "$target" != "$HOME" && ! -e "$target" ]] || fail "unsafe or existing external restore target: $target"
  verify_backup "$backup" >/dev/null
  [[ $(jq -r '.project_id' "$backup/backup.json") = "$EXTERNAL_PROJECT_ID" ]] || fail "backup is not for the registered external project"
  stage="$(dirname -- "$target")/.restore-staging-$(basename -- "$target")-$$"; [[ ! -e "$stage" ]] || fail "restore staging exists"
  mkdir -p -- "$stage"; timeout "$STEP_TIMEOUT" tar -xf "$backup/data.tar" -C "$stage"
  timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$stage" "$stage.manifest.jsonl" >/dev/null
  cmp -s "$backup/integrity-manifest.jsonl" "$stage.manifest.jsonl" || fail "external restore manifest mismatch"
  mv -- "$stage" "$target"; mv -- "$stage.manifest.jsonl" "$target.restore-manifest.jsonl"
  printf 'EXTERNAL_RESTORED project_id=%s target=%s manifest_sha256=%s\n' "$EXTERNAL_PROJECT_ID" "$target" "$(sha "$target.restore-manifest.jsonl")"
}

restore_drill() {
  validate_roots
  validate_external
  absolute_dir "$DRILL_STATE_ROOT"
  absolute_dir "$DRILL_SCRATCH_PARENT"
  [[ -d "$DRILL_SCRATCH_PARENT" ]] || fail "restore-drill scratch parent missing: $DRILL_SCRATCH_PARENT"

  mkdir -p -- "$DRILL_STATE_ROOT"
  exec 9>"$BACKUP_ROOT/.backup.lock"; flock -n 9 || fail "canonical backup operation is active"
  exec 7>"$EXTERNAL_BACKUP_ROOT/.backup.lock"; flock -n 7 || fail "external backup operation is active"

  local canonical_id external_id canonical_backup external_backup needed available drill_id drill_root
  canonical_id=$(head -1 "$BACKUP_ROOT/latest-successful")
  external_id=$(head -1 "$EXTERNAL_BACKUP_ROOT/latest-successful")
  canonical_backup="$BACKUP_ROOT/snapshots/$canonical_id"
  external_backup="$EXTERNAL_BACKUP_ROOT/snapshots/$external_id"
  verify_backup "$canonical_backup" >/dev/null
  verify_backup "$external_backup" >/dev/null
  needed=$(( $(jq -r '.byte_count' "$canonical_backup/backup.json") + $(jq -r '.byte_count' "$external_backup/backup.json") + DRILL_MIN_FREE_AFTER ))
  available=$(df -B1 --output=avail "$DRILL_SCRATCH_PARENT" | tail -1 | tr -d ' ')
  (( available >= needed )) || fail "insufficient restore-drill scratch space: available=$available required=$needed"

  drill_id="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$canonical_id:$external_id:$PPID:$RANDOM" | sha256sum | cut -c1-8)"
  drill_root=$(mktemp -d -- "$DRILL_SCRATCH_PARENT/music-creator-restore-drill-$drill_id-XXXXXXXX")
  local canonical_restore="$drill_root/canonical" external_restore_root="$drill_root/external"
  local failure_file="$DRILL_STATE_ROOT/.failed-$drill_id.json"
  drill_failure() {
    local layer=$1
    jq -n --arg drill_id "$drill_id" --arg failed_at "$(date -u +%FT%TZ)" --arg layer "$layer" \
      --arg canonical_backup_id "$canonical_id" --arg external_backup_id "$external_id" --arg evidence "$drill_root" \
      '{schema_version:1,result:"FAILED",drill_id:$drill_id,failed_at:$failed_at,failure_layer:$layer,canonical_backup_id:$canonical_backup_id,external_backup_id:$external_backup_id,evidence_path:$evidence}' > "$failure_file"
    mv -- "$failure_file" "$DRILL_STATE_ROOT/latest.json"
    fail "RESTORE_DRILL_FAILED layer=$layer evidence=$drill_root"
  }

  mkdir -p -- "$canonical_restore" "$external_restore_root"
  timeout "$STEP_TIMEOUT" tar -xf "$canonical_backup/data.tar" -C "$canonical_restore" || drill_failure canonical_extract
  if [[ ${MUSIC_CREATOR_BACKUP_TEST_MODE:-0} = 1 && -n ${MUSIC_CREATOR_BACKUP_TEST_DRILL_AFTER_RESTORE_COMMAND:-} ]]; then
    export MUSIC_CREATOR_RESTORE_DRILL_CANONICAL="$canonical_restore"
    bash -c "$MUSIC_CREATOR_BACKUP_TEST_DRILL_AFTER_RESTORE_COMMAND" || drill_failure test_hook
  fi
  timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$canonical_restore" "$drill_root/canonical-manifest.jsonl" >/dev/null || drill_failure canonical_manifest
  cmp -s "$canonical_backup/integrity-manifest.jsonl" "$drill_root/canonical-manifest.jsonl" || drill_failure canonical_manifest_mismatch
  timeout "$STEP_TIMEOUT" node "$VERIFY_TOOL" "$canonical_restore" "$(jq -r '.source_path' "$canonical_backup/backup.json")" > "$drill_root/canonical-consistency.json" || drill_failure canonical_consistency
  [[ $(jq -r '.ok' "$drill_root/canonical-consistency.json") = true ]] || drill_failure canonical_consistency
  [[ $(jq -r '.quality_gate_projects' "$drill_root/canonical-consistency.json") = "$DRILL_QUALITY_PROJECTS" ]] || drill_failure quality_gate_count

  local project="$canonical_restore/projects/$DRILL_PROJECT_ID"
  local candidate="$project/music-candidates/$DRILL_CANDIDATE_ID/music-candidate.json"
  local production="$project/music-candidates/$DRILL_CANDIDATE_ID/production.wav"
  local provenance="$project/approved/provenance.json"
  [[ -f "$candidate" && -f "$production" && -f "$provenance" && -f "$project/approved/mix.wav" && -f "$project/approved/resolve-import/mix.wav" ]] || drill_failure accepted_candidate_missing
  [[ $(jq -r '.candidate_id' "$candidate") = "$DRILL_CANDIDATE_ID" && $(jq -r '.backend' "$candidate") = minimax && $(jq -r '.status' "$candidate") = completed && $(jq -r '.human_verdict | ascii_downcase' "$candidate") = use ]] || drill_failure accepted_candidate_state
  [[ $(jq -r '.approved_candidate' "$provenance") = "$DRILL_CANDIDATE_ID" && $(jq -r '.approval_status' "$provenance") = approved && $(jq -r '.plan_revision_id' "$provenance") = "$DRILL_PLAN_REVISION" ]] || drill_failure accepted_provenance
  [[ $(sha "$production") = "$DRILL_WAV_SHA256" && $(sha "$project/approved/mix.wav") = "$DRILL_WAV_SHA256" && $(sha "$project/approved/resolve-import/mix.wav") = "$DRILL_WAV_SHA256" ]] || drill_failure accepted_wav_hash

  timeout "$STEP_TIMEOUT" tar -xf "$external_backup/data.tar" -C "$external_restore_root" || drill_failure external_extract
  timeout "$STEP_TIMEOUT" node "$MANIFEST_TOOL" "$external_restore_root" "$drill_root/external-manifest.jsonl" >/dev/null || drill_failure external_manifest
  cmp -s "$external_backup/integrity-manifest.jsonl" "$drill_root/external-manifest.jsonl" || drill_failure external_manifest_mismatch
  [[ $(jq -r '.project_id' "$external_backup/backup.json") = "$EXTERNAL_PROJECT_ID" ]] || drill_failure external_project_identity
  [[ $(jq -r --arg id "$EXTERNAL_PROJECT_ID" '.projects[] | select(.project_id==$id) | .path' "$canonical_restore/score-registry.json") = "$EXTERNAL_SOURCE" ]] || drill_failure external_registry_relationship

  local completed_at result_tmp="$DRILL_STATE_ROOT/.latest-$drill_id.json"
  completed_at=$(date -u +%FT%TZ)
  jq -n --arg drill_id "$drill_id" --arg completed_at "$completed_at" \
    --arg canonical_backup_id "$canonical_id" --arg external_backup_id "$external_id" \
    --arg canonical_manifest_sha256 "$(sha "$drill_root/canonical-manifest.jsonl")" \
    --arg external_manifest_sha256 "$(sha "$drill_root/external-manifest.jsonl")" \
    --arg candidate_id "$DRILL_CANDIDATE_ID" --arg candidate_sha256 "$DRILL_WAV_SHA256" \
    --argjson quality_gate_projects "$DRILL_QUALITY_PROJECTS" \
    --argjson canonical_files "$(jq -r '.file_count' "$canonical_backup/backup.json")" \
    --argjson canonical_bytes "$(jq -r '.byte_count' "$canonical_backup/backup.json")" \
    --argjson external_files "$(jq -r '.file_count' "$external_backup/backup.json")" \
    --argjson external_bytes "$(jq -r '.byte_count' "$external_backup/backup.json")" \
    '{schema_version:1,result:"PASS",drill_id:$drill_id,completed_at:$completed_at,canonical_backup_id:$canonical_backup_id,external_backup_id:$external_backup_id,canonical_manifest_sha256:$canonical_manifest_sha256,external_manifest_sha256:$external_manifest_sha256,canonical_files:$canonical_files,canonical_bytes:$canonical_bytes,external_files:$external_files,external_bytes:$external_bytes,accepted_candidate:{candidate_id:$candidate_id,sha256:$candidate_sha256},quality_gate_projects:$quality_gate_projects,scratch_removed:true}' > "$result_tmp"
  mv -- "$result_tmp" "$DRILL_STATE_ROOT/latest.json"
  rm -rf -- "$drill_root"
  printf 'RESTORE_DRILL_PASS drill_id=%s canonical_backup=%s external_backup=%s canonical_manifest_sha256=%s external_manifest_sha256=%s\n' \
    "$drill_id" "$canonical_id" "$external_id" "$(jq -r '.canonical_manifest_sha256' "$DRILL_STATE_ROOT/latest.json")" "$(jq -r '.external_manifest_sha256' "$DRILL_STATE_ROOT/latest.json")"
}

scheduled_run() {
  external_backup
  backup
  apply_retention_root "$BACKUP_ROOT" "$RETENTION_KEEP" "$BACKUP_ROOT/.backup.lock"
  apply_retention_root "$EXTERNAL_BACKUP_ROOT" "$EXTERNAL_RETENTION_KEEP" "$EXTERNAL_BACKUP_ROOT/.backup.lock"
  status
}

case ${1:-} in
  --status) [[ $# = 1 ]] || { usage; exit 64; }; status ;;
  --dry-run) [[ $# = 1 ]] || { usage; exit 64; }; dry_run ;;
  --backup) [[ $# = 1 ]] || { usage; exit 64; }; backup ;;
  --scheduled-run) [[ $# = 1 ]] || { usage; exit 64; }; scheduled_run ;;
  --retention-preview) [[ $# = 1 ]] || { usage; exit 64; }; retention_plan "$BACKUP_ROOT" "$RETENTION_KEEP" ;;
  --apply-retention) [[ $# = 1 ]] || { usage; exit 64; }; apply_retention_root "$BACKUP_ROOT" "$RETENTION_KEEP" "$BACKUP_ROOT/.backup.lock" ;;
  --verify) [[ $# = 2 ]] || { usage; exit 64; }; locked_verify "$BACKUP_ROOT" "$2" ;;
  --restore) [[ $# = 3 ]] || { usage; exit 64; }; restore_backup "$2" "$3" ;;
  --external-verify) [[ $# = 2 ]] || { usage; exit 64; }; locked_verify "$EXTERNAL_BACKUP_ROOT" "$2" ;;
  --external-restore) [[ $# = 3 ]] || { usage; exit 64; }; external_restore "$2" "$3" ;;
  --restore-drill) [[ $# = 1 ]] || { usage; exit 64; }; restore_drill ;;
  --help|-h) usage ;;
  *) usage; exit 64 ;;
esac
