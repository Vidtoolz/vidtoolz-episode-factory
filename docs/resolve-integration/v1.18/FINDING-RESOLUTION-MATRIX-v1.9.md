
# FINDING RESOLUTION MATRIX — Codex v1.8 adjudication answered in v1.9

The machine-readable form is `FINDING-RESOLUTION-MATRIX-v1.9.json`. `validate_v1_9.py` reads it, requires exactly the
four ids below, and fails unless every validation section they name exists and passes. The v1.7 evidence-store matrix
(ES-1, ES-2) is retained unchanged as `FINDING-RESOLUTION-MATRIX-v1.8.json` and its corrections are re-run as v1.9
regressions.

| id | severity | Codex finding | v1.9 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| S19-1 | BLOCKER | path confinement fails when the session root itself is a symlink | the trust boundary is established by `lstat` before any resolution; no `realpath` on the trust path; device+inode re-checked every operation | `evidence-root-trust`: symlinked root and session at create/open/list, root replaced by symlink and by another directory, non-directory root | evidence store (root trust boundary) |
| S19-2 | BLOCKER | inventory/session semantics incomplete; a renamed or cross-session directory still validates | frozen session identity tuple, basename-is-session-id path law, semantic record keys, full inventory reconciliation, a fourth `semantic_mismatch` counter | `evidence-session-identity`, `evidence-semantic-inventory`: rename, five cross-session copies, wrong layer, wrong logical identity, tampered internal id, duplicate inventory keys | evidence store (semantic reconciliation) |
| S19-3 | BLOCKER | attempt ids are digest-bound rather than tuple-bound | canonical key `(session_id, layer, logical_identity, attempt_id)` bound to bytes; cross-layer and cross-identity refused by name; list-first index | `evidence-attempt-tuple`: the full collision table plus cross-layer, cross-identity, cross-session and two-identity cases | evidence store (attempt identity) |
| S19-4 | MAJOR | chmod after finalization undetected | canonical modes set explicitly; POSIX file type and permission mode frozen per entry and reconciled | `evidence-mode-authority`: chmod of record, directory, manifest, attempts directory, attempt marker, inventory and marker; file replaced by a FIFO | evidence store (metadata authority, POSIX) |

## Reproduction before correction

Every finding was reproduced against the frozen v1.8 bundle first. Two were worse than reported: the symlinked root
passed create, finalize **and** verify, and the reused attempt id created a **second distinct record** in another
layer rather than colliding.

## What is still not closed

- No probe has run, no evidence root exists, and the store has only been exercised against temporary directories.
- The store detects post-finalization tampering; it does not prevent it, and it does not close every TOCTOU window.
  A root replacement that reuses the freed inode is explicitly not claimed to be detected.
- Mode and file-type verification are POSIX semantics on the reference host. No Windows parity is claimed.
- Every primitive expectation remains `DOCUMENTED_HYPOTHESIS`.
