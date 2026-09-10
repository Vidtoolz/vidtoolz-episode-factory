
# FINDING RESOLUTION MATRIX — Codex v1.9 result answered in v1.10

The machine-readable form is `FINDING-RESOLUTION-MATRIX-v1.10.json`. `validate_v1_10.py` reads it, requires exactly
the five ids below, and fails unless every validation section they name exists and passes. Earlier matrices are
retained unchanged as history and their corrections are re-run as v1.10 regressions.

| id | severity | Codex finding | v1.10 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| S110-1 | BLOCKER | session boundary not persisted or rechecked | persisted `BOUNDARY.json` receipt, boundary identity inside session identity, re-lstat of root and session before every operation | `evidence-boundary-receipt`: session replacement, alternate root, receipt mutation and deletion, randomized replacement property tests | evidence store (persisted boundary) |
| S110-2 | BLOCKER | inventory and finalization semantics partly self-asserted | `expected_model()` recomputed from independent sources; every normative inventory and marker field derived and compared; provenance table published | `evidence-recomputed-model`, `evidence-finalization-fields` | evidence store (recomputed model) |
| S110-3 | BLOCKER | stored attempt marker authority incomplete | marker/record bijection derived both ways; foreign markers, orphaned records and duplicate attempt ids refused in the ACTIVE path | `evidence-attempt-derivation` | evidence store (attempt marker derivation) |
| S110-4 | MAJOR | mode authority incomplete before finalization | `MODE_TABLE` by kind including the session directory, enforced continuously from creation | `evidence-mode-authority` | evidence store (continuous metadata authority, POSIX) |
| S110-5 | MINOR | filesystem failures leak platform exceptions | one `fs()` normalization boundary and frozen `FS_*` classes | `evidence-fs-errors` | evidence store (filesystem error vocabulary) |

## What is still not closed

- No probe has run, no evidence root exists, and the store has only been exercised against temporary directories.
- Detection, not prevention. Deliberate device and inode reuse is not claimed to be detected, and this is not a
  time-of-check/time-of-use guarantee.
- Only the root and session directory inodes are bound. Replacing an empty layer directory with an identical empty one
  is deliberately out of scope, because it changes no governed evidence.
- Mode and file-type verification are POSIX semantics on the reference host. No Windows parity is claimed.
- Every primitive expectation remains `DOCUMENTED_HYPOTHESIS`.
