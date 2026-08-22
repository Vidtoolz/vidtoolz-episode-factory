# Music Creator production-data backup and recovery

Music Creator source is recovered from Git; production projects and audio are recovered independently from verified snapshots of `/home/vidtoolz/vidtoolz-score-projects`. The canonical backup destination is the independent VIDNAS Public share at `/mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups`.

## Backup contract

The backup contains the complete managed root. Nothing is excluded based on age, size, verdict, lifecycle class, or duplication. It therefore includes registries, scripts, cue plans, candidates, WAVs, verdicts, approvals, Resolve copies, lifecycle/dedupe records, archives, unknown legacy material, and frozen quality evidence.

The tool creates a deterministic SHA-256 manifest before capture, writes a tar snapshot in a staging directory, and creates the source manifest again. Any source path/content/mode/hardlink-topology change makes the run fail without promotion. A stable archive is checked, hashed, marked `VERIFIED`, and atomically renamed into `snapshots/`; only then is `latest-successful` replaced. Failed staging never replaces the prior verified backup.

Tar preserves directory structure, modes, symlinks, and hardlinks. Correct bytes and semantic paths are authoritative. Hardlink sharing is a local optimization and may safely materialize when data is copied by other tools, although this backup/restore path preserves it.

## Operator commands

```bash
# Read-only destination and capacity check
./ops/music-creator-data-backup.sh --dry-run

# Create and deeply verify one snapshot
./ops/music-creator-data-backup.sh --backup

# The scheduled policy path: external payload, canonical root, then retention
./ops/music-creator-data-backup.sh --scheduled-run

# Report and reverify the latest successful snapshot
./ops/music-creator-data-backup.sh --status

# Monthly recovery drill against latest canonical + external snapshots
./ops/music-creator-data-backup.sh --restore-drill

# Read-only retention decision; never deletes
./ops/music-creator-data-backup.sh --retention-preview

# Verify a named snapshot
./ops/music-creator-data-backup.sh --verify \
  /mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups/snapshots/BACKUP_ID

# Isolated restore acceptance; TARGET MUST NOT EXIST
./ops/music-creator-data-backup.sh --restore \
  /mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups/snapshots/BACKUP_ID \
  /absolute/path/to/RESTORE_TO_TEST_PATH
```

Routine status verification checks completion markers plus archive and manifest hashes. Acceptance/recovery verification restores to an isolated empty path and compares the regenerated deep manifest byte-for-byte.

## Disaster recovery

### A. Source lost, score data safe

```bash
git checkout 39bc6df66970c3a9039c1d32e7fffb349574dfef
./ops/deploy-music-launchers.sh --deploy
systemctl --user start vidtoolz-cockpit.service
curl --fail http://127.0.0.1:8010/music-creator.html >/dev/null
```

### B. Score-project data lost, source safe

First identify and verify the snapshot. Never restore over a live directory.

```bash
./ops/music-creator-data-backup.sh --status
./ops/music-creator-data-backup.sh --verify /mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups/snapshots/BACKUP_ID
systemctl --user stop vidtoolz-cockpit.service

# If a damaged live root still exists, preserve it as a rollback directory.
# Choose a unique timestamp and inspect both paths before executing this move.
mv /home/vidtoolz/vidtoolz-score-projects \
  /home/vidtoolz/vidtoolz-score-projects.rollback-YYYYMMDDTHHMMSSZ

./ops/music-creator-data-backup.sh --restore \
  /mnt/vidnas_public/VIDTOOLZ/08_SYSTEM_EXPORTS/music-creator-data-backups/snapshots/BACKUP_ID \
  /home/vidtoolz/vidtoolz-score-projects
systemctl --user start vidtoolz-cockpit.service
curl --fail http://127.0.0.1:8010/music-creator.html >/dev/null
curl --fail http://127.0.0.1:8010/api/score/storage/summary >/dev/null
```

Keep the rollback directory until candidate hashes, approvals, exports, and registry consistency have been verified. Removing rollback data is a separate explicit operator decision.

### C. Complete vidnux loss

1. Rebuild the supported Ubuntu/operator environment and mount VIDNAS Public.
2. Recover the repository and check out the accepted or a later verified baseline.
3. Deploy launchers.
4. Verify the chosen backup.
5. Restore it to `/home/vidtoolz/vidtoolz-score-projects` while Episode Factory is stopped.
6. Start Episode Factory and verify Music Creator, package status, music status, and storage summary.
7. Verify project registry consistency and candidate `music-candidate-002` hash/approval truth.
8. Verify MiniMax routing separately; this backup does not rebuild VIDLAP2, credentials, the OS, or NAS configuration.

## Scheduling and retention

The versioned systemd user timer runs daily at 04:45 Europe/Helsinki with up to ten minutes of jitter and catch-up after downtime. Daily is justified by observed bursty project work: 1,321 files/6.19 GB were created or changed on 2026-08-21 and 53 files/47.2 MB on 2026-08-22, including approvals and production candidates. A verified snapshot takes tens of seconds, while the NAS has about 100 TB free. Also run `--scheduled-run` explicitly after a major approval when a same-day recovery point matters.

Automatic retention keeps the newest seven verified canonical snapshots. `latest-successful` is always protected; `PINNED` snapshots are also protected and unknown/unverified directories are never automatic deletion candidates. Retention runs only after both the external-payload snapshot and canonical backup succeed. Preview with `--retention-preview`; execution is `--apply-retention`. At the measured 6.239 GB per snapshot, the normal retained canonical footprint is about 43.7 GB, with a worst-case full-snapshot write volume of about 187.2 GB per 30-day month. Pins are explicit operator exceptions, not created by the timer.

The accepted recovery snapshot `20260822T142451Z-a3ecd184` is pinned as the known-good full backup/restore gate. A `PINNED` marker's text is its operator-visible reason; retention reports it and never removes the snapshot. Operators should review pins periodically, but unpinning is always a separate human decision.

Deploy and verify the timer from repository source:

```bash
./ops/deploy-music-backup-ops.sh --install
systemctl --user daemon-reload
systemctl --user enable --now vidtoolz-music-creator-backup.timer
./ops/deploy-music-backup-ops.sh --check
systemctl --user list-timers vidtoolz-music-creator-backup.timer
```

The backup script verifies that `/mnt/vidnas_public` resolves to the CIFS authority `//192.168.61.186/Public`, checks free capacity before capture, and refuses a local fallback directory. The service has a six-hour bound and the script lock prevents overlap.

## External package-linked Music Creator project

Registry project `pkg-why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630` points to the AIGEN-owned package on VIDNAS, with its Music Creator payload at:

`/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630/music`

The generating system is AIGEN, but its existing Git mirror excludes WAVs and its media mirror includes only images/video. Backup ownership of this exact registry-linked `music` directory is therefore `MUSIC_CREATOR_OWNED`. The scheduled operation validates the registry ID and exact canonical path, then creates a separately verified local snapshot under:

`/home/vidtoolz/vidtoolz-music-external-backups/pkg-why-i-refuse-to-outsource-my-creator-identity-to-ai-20260630`

This gives the NAS-hosted payload an independent ext4 recovery copy. Its retention is the newest two verified snapshots. Restore to an absent test path with:

```bash
./ops/music-creator-data-backup.sh --external-verify EXTERNAL_BACKUP_DIR
./ops/music-creator-data-backup.sh --external-restore EXTERNAL_BACKUP_DIR /absolute/absent/test-path
```

On NAS loss, restore the verified local external snapshot to the exact registry path after remounting/replacing VIDNAS. On local-system loss, the original external package remains on VIDNAS. Never redirect an arbitrary registry path into this backup lane; the project ID and path are fixed and fail closed.

## Recurring recovery drill

Run `./ops/music-creator-data-backup.sh --restore-drill` monthly and after any material backup-tool change. Monthly is conservative for roughly 9.5 GB of combined restore I/O: it exercises recovery often enough to expose drift without turning deep hashing and temporary disk allocation into routine daily load. The drill is explicit/manual; no separate restore timer is installed.

The command takes both backup-domain locks, verifies the latest canonical and external snapshots, checks that local scratch has the combined declared payload size plus 10 GiB reserve, and restores both into a uniquely named isolated directory under `/home/vidtoolz`. It then compares deterministic manifests, runs alternate-root registry/provenance consistency, verifies the accepted MiniMax candidate and all six quality-gate projects, and validates the external registry relationship. On PASS, only that disposable drill directory is removed and a durable result is written under `~/.local/state/vidtoolz/music-creator-backup/latest.json`. On failure, production remains untouched and the isolated evidence directory is retained for diagnosis.

`--status` reports a concise recovery health classification. `HEALTHY` requires the timer enabled, the expected CIFS authority mounted, fresh canonical and external snapshots, a successful service result, and a passing drill within 45 days. It otherwise reports the most relevant state: `NAS_UNAVAILABLE`, `TIMER_DISABLED`, `BACKUP_STALE`, `EXTERNAL_BACKUP_STALE`, `RESTORE_DRILL_DUE`, or `RESTORE_DRILL_FAILED`.
