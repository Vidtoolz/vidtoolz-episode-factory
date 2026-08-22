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

# Report and reverify the latest successful snapshot
./ops/music-creator-data-backup.sh --status

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

The production backup remains manual after initial acceptance. A full snapshot is about 6.24 GB and deep verification reads the source twice; installing an unattended schedule without a separately approved retention policy would create unbounded NAS history. Run a verified backup after meaningful project/approval changes and check `--status`. Keep the prior verified snapshot when creating a new one. A future scheduler should reuse this command, prevent overlap, and add conservative retention only after capacity/churn evidence.
