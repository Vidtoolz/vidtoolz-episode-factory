# Music Creator storage lifecycle

Music Creator storage is managed from production truth, never from file age, size, or naming alone. The lifecycle is explicit: inventory, preview, archive, verify, restore, and verify again. No automatic retention job exists.

## Classification and protection

- `CURRENT_APPROVED`: current approved candidate, approval provenance, current cue authority, and exports. Protected.
- `CURRENT_UNAPPROVED`: current-plan work, including unreviewed or active candidates. Protected.
- `HISTORICAL`: prior-plan candidate or approval evidence. Candidate groups may be archived.
- `REJECTED`: human-rejected candidate evidence. Candidate groups may be archived, never automatically deleted.
- `QUALITY_GATE`: project IDs referenced by structured quality-gate JSON evidence. Hard protected.
- `FAILED_INCOMPLETE`: failed or incomplete candidate evidence. Archivable after preview when unreferenced.
- `RECONSTRUCTIBLE_DISPOSABLE`: reserved for artifacts whose reconstruction is proven. Nothing is placed here merely because it looks temporary.
- `UNKNOWN`: insufficient provenance. Protected by uncertainty.

Current approval is derived from project, cue-plan revision, candidate identity, approval provenance, and verified approved artifact hashes. Timestamps are informational only.

## Archive and restore

Candidate archives live under:

```text
<score-project-root>/archives/music-creator/<archive-id>/
```

Each archive contains `manifest.json` and, while archived, a `payload/` directory. The manifest records source project/candidate IDs, classification, verdict, original relative path, byte sizes, SHA-256 hashes, approval state, quality-gate status, and restore mapping.

Preview plans are process-local, expire, and bind the current authority/file fingerprint. Execution revalidates the fingerprint. A changed approval, candidate, or file makes the preview stale. Restarting Episode Factory invalidates outstanding previews.

Archive uses same-filesystem atomic moves with rollback. Restore verifies the archive, refuses destination conflicts, atomically returns the candidate group, verifies its bytes, and marks the archive record restored.

## Delete policy

Deletion is preview-only in lifecycle schema v1. There is no raw-path delete endpoint and no live-project deletion path. Quality evidence and current approved assets are never delete-eligible. This deliberately leaves destructive deletion for a later gate after archive/restore semantics have production history.

## Operator workflow

Open a Music Creator project, expand **Advanced / diagnostics**, and choose **Review Storage**. The server provides classifications, exact byte totals, archive/restore previews, blockers, and archive records. Direct edits inside the score-project root are not lifecycle operations and may cause consistency blocking.

No WAV deduplication, hardlinking, symlinking, age-based cleanup, or bulk quality-evidence cleanup is performed by this system.
