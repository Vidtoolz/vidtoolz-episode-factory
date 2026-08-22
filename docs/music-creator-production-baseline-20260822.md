# Music Creator production baseline — 2026-08-22

## Verdict

**MUSIC CREATOR CORE PRODUCTION PATH READY**

The accepted real chain is: Music Creator → explicitly approved cue plan → real VIDLAP2 MiniMax Music 3 → playable production candidate → human verdict → current revision-aware approval → Resolve-facing export → restart persistence.

## Accepted gates

- State integrity: cue plans, candidates, approvals, and exports are revision-aware and fail closed when stale.
- Script authority: `script-snapshot.txt` is the authoritative script input for music direction.
- Candidate backends: local Scorecraft sketches and MiniMax production audio coexist without losing backend provenance.
- Human authority: generated cues require explicit plan approval; production candidates require an explicit `USE` verdict before approval.
- Production media: real MiniMax dispatch, retrieval, WAV probing, playback, approval, provenance, package verification, and Resolve export have passed live acceptance.
- Musical continuity: MiniMax direction follows “Evolve the same cue; do not replace it.”
- Runtime lifecycle: MiniMax cache release occurs only after durable terminal job state and an idle runtime; the 15 GB admission floor remains authoritative.
- Operations: launcher source is versioned under `ops/music-creator-launchers/`; startup is readiness-gated and MiniMax retains its explicit manual-start policy.
- Storage lifecycle: production truth drives classification; archive/restore is transactional; stale previews fail; destructive deletion remains preview-only.
- Storage dedupe: the exact approved-master/Resolve-copy hardlink pair is production-proven opt-in and reversible. Candidate sources and quality-gate evidence are excluded. There is no automatic or bulk dedupe.

## Canonical production fixture

The read-only regression fixture is project `2026-08-21-mc-smoke-04-24-18`, candidate `music-candidate-002`:

- backend: MiniMax
- status: completed
- human verdict: `USE`
- `approval_current = true`
- SHA-256: `18d947a3733bf244d1f4b716df09972f0176b6fe7760bec09b2b48427760ffb8`

The candidate WAV, `approved/mix.wav`, and `approved/resolve-import/mix.wav` must retain that hash.

## Source and operational authority

The canonical source inventory is `ops/music-creator-source-manifest.json`. Launcher deployment and drift checks are:

```bash
./ops/deploy-music-launchers.sh --deploy
./ops/deploy-music-launchers.sh --check
```

Source recovery is separate from production-data recovery. Git contains the application, tests, operational launchers, and documentation. Runtime score projects, candidate WAVs, approvals, and lifecycle transaction data remain under `/home/vidtoolz/vidtoolz-score-projects` and require an independent data backup.

## Recovery smoke

From a checkout containing this baseline:

```bash
./ops/deploy-music-launchers.sh --deploy
systemctl --user start vidtoolz-cockpit.service
curl --fail http://127.0.0.1:8010/music-creator.html >/dev/null
./ops/deploy-music-launchers.sh --check
```

Repository-wide failures outside the Music Creator source inventory are not Music Creator production authority and must be assessed independently rather than frozen as expected behavior.
