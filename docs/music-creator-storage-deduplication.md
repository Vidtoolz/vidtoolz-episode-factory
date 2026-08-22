# Music Creator storage deduplication

Music Creator treats duplicate content and duplicate meaning as separate facts. SHA-256 equality can identify repeated bytes, but lifecycle classification, semantic file role, approval provenance, and quality-evidence status decide whether physical sharing is allowed.

## Accounting

- **Logical duplicate bytes** are repeated file lengths.
- **Physical duplicate bytes** are independently allocated filesystem blocks after inode sharing is considered.
- **Reclaimable physical bytes** are blocks covered by the current executable policy, not a theoretical maximum.
- Hardlinks already sharing one inode are reported as already shared and are not counted again as reclaimable.

The server performs hashing and allocation inspection. The browser receives project-relative semantic identities, never arbitrary paths.

## Current policy

The score store is ext4. Hardlinks are supported; copy-on-write reflinks are not. Symlinks are rejected because they weaken safe-file guards, relocation, archive independence, and Resolve portability. A global content-addressed store is intentionally deferred because it would require reference counting, garbage collection, provenance migration, and archive redesign.

Hardlink execution has two deliberately bounded scopes:

- projects explicitly marked `storage_dedupe_fixture: true`, for non-approved fixture audio; and
- the exact current `approved/mix.wav` → `approved/resolve-import/mix.wav` pair after current approval, artifact-manifest hashes, candidate identity, plan revision, path roles, and same-device storage all validate.

The candidate source is never included. Quality-gate, archived, unknown, cross-device, stale-approval, and mismatched-content artifacts remain protected.

Hardlinks make in-place mutation affect every linked path. Resolve 21.0.4 was therefore tested with an isolated library and disposable timeline: import, playback, save, close/reopen, and playback did not change source bytes, metadata, inode, link count, or mtime. Music Creator does not edit either published WAV in place: approval writes independent files into a new build directory and atomically replaces the approved directory. The derived Resolve path is the only path replaced by the dedupe transaction; the approved master and candidate source are never rewritten.

This sharing is a local ext4 optimization. Plain copies and ordinary rsync materialize independent bytes; tools which explicitly preserve hardlinks may retain the relationship. Portability never depends on retaining the hardlink.

## Transaction and reversal

Every mutation requires a short-lived preview bound to hashes, inode/link state, lifecycle state, semantic roles, and measured block allocation. Execution revalidates the preview, creates independent rollback copies, atomically replaces targets with hardlinks, verifies hashes/inodes, and records a transaction under the fixture project's `.storage-dedupe/transactions/` directory.

`materialize` copies each linked target to a new inode without changing bytes or its semantic path. It is the required reversal before an approved artifact is independently archived, migrated, or handled by a workflow that may write in place. Archive payloads remain self-contained; dedupe need not survive archive/restore, because safe independent recovery is preferred.

## Protected domains

- Current approved candidate source: protected. Only the exact validated master/Resolve-copy pair is eligible.
- Quality-gate and frozen evidence: audit-only.
- Unknown files: protected by uncertainty.
- Archive payloads and lifecycle manifests: independently restorable, never cross-linked.
- Destructive delete remains preview-only.

No automatic age policy, bulk dedupe, or WAV deletion is enabled.
