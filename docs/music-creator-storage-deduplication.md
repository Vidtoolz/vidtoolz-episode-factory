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

Hardlink execution is limited to projects explicitly marked `storage_dedupe_fixture: true`, to non-approved audio, and to files within one project/filesystem. Production, current-approved, quality-gate, archived, and unknown artifacts are audit-only.

Hardlinks make in-place mutation affect every linked path. The production writers normally publish through new build paths and atomic rename, but that is not sufficient justification to mutate current production. Dedupe transactions therefore remain scratch-scoped until a separate production-role gate is approved.

## Transaction and reversal

Every mutation requires a short-lived preview bound to hashes, inode/link state, lifecycle state, semantic roles, and measured block allocation. Execution revalidates the preview, creates independent rollback copies, atomically replaces targets with hardlinks, verifies hashes/inodes, and records a transaction under the fixture project's `.storage-dedupe/transactions/` directory.

`materialize` copies each linked target to a new inode without changing bytes. Candidate archive preview refuses shared hardlinks until materialization, so archive payloads remain storage-independent. Dedupe need not survive archive/restore; safe independent bytes are preferred.

## Protected domains

- Current approved candidate/master/Resolve paths: audit-only.
- Quality-gate and frozen evidence: audit-only.
- Unknown files: protected by uncertainty.
- Archive payloads and lifecycle manifests: independently restorable, never cross-linked.
- Destructive delete remains preview-only.

No automatic age policy, bulk dedupe, or WAV deletion is enabled.
