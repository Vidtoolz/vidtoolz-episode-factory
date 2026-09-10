# FINDING RESOLUTION MATRIX — Codex v1.10 result answered in v1.11

The machine-readable form is `FINDING-RESOLUTION-MATRIX-v1.11.json`. `validate_v1_11.py` reads it, requires exactly
the four ids below, and fails unless every validation section they name exists and passes. Earlier matrices —
including `FINDING-RESOLUTION-MATRIX-v1.10.json` — are retained unchanged as history and their corrections are re-run
as v1.11 regressions.

Codex's independent v1.10 result was the supplied suite **1911/1911 twice, deterministic**, with exactly four
release-relevant findings remaining. All four were reproduced against the frozen v1.10 bundle at
`9c6643430d2dc66741afe9852668d8e6e19c0630` before anything was changed.

| id | severity | Codex finding | v1.11 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| F110-A | BLOCKER | boundary receipt contains normative fields that can be consistently rewritten and still authorize | every `BOUNDARY.json` field classified with exactly one provenance class; the four `FROZEN_CONSTANT` fields compared outside the receipt; structural type law; L5 internal coherence; `created_at` explicitly `INFORMATIONAL_NON_AUTHORIZING`; digest documented as byte integrity, not semantic truth | `evidence-boundary-fields`: the full receipt attack matrix over all twelve normative fields with a recomputed digest, the `created_at` law asserted in both directions, four structural attacks, extra/removed field, a Store.v4 receipt refused, plus 24 seeded mutations in `property` | evidence store (boundary receipt reconciliation) |
| F110-B | BLOCKER | six normative inventory header/path fields not independently compared, and an extra semantic header field survives | exact frozen `INVENTORY_FIELDS` vocabulary checked before interpretation; `record_count`, `entry_count`, `total_bytes`, `attempt_count`, `self_path`, `finalized_marker_path` recomputed from the independent model and the frozen store layout; `Inventory.v3 -> v4` | `evidence-inventory-fields`: the six-field mutation matrix with recomputed digest **and** updated finalization reference (over- and understated), extra field, removed field, five wrong types, duplicate key, vocabulary partition assertion, plus 24 seeded perturbations in `property` | evidence store (inventory header reconciliation / field vocabulary) |
| F110-C | BLOCKER | marker/record reconciliation checks derivation but not exact one-to-one cardinality | L7 is a bijection with exact cardinality both ways: zero is `ORPHANED_RECORD`, more than one is `MARKER_CARDINALITY_VIOLATION`; `_put()` refuses the second attempt id before anything is persisted; the same rule holds in `active_integrity()`, `expected_model()`, `finalize()` and `verify_summary()` | `evidence-marker-cardinality`: the pinned second-write attack with the ATTEMPTS directory asserted unchanged, a planted twin marker on an ACTIVE session and on an already FINALIZED session, eleven retained-law regressions, plus 8 seeded sessions in `property` | evidence store (attempt marker bijection) |
| F110-D | MERGE MAJOR / M0A MAJOR | public authority-bearing read/model methods do not boundary-check first; `inventory()` masks the boundary violation with `SESSION_NOT_FINALIZED` | `PUBLIC_AUTHORITY_METHODS` inventory asserted complete against `dir(EvidenceStore)`; every authority-bearing member checks the persisted boundary first (raising, or reporting first in its own vocabulary); unchecked internals made private with checked wrappers; `ERROR_PRECEDENCE` frozen as `BOUNDARY > SESSION_STATE > MODEL > READ` | `evidence-public-surface`: post-replacement calls to **every discovered** method on an ACTIVE and a FINALIZED session, the completeness and private/wrapper assertions, the specific `inventory()` unmasking assertion, plus 6 seeded replaced sessions x 6 sampled methods in `property` | evidence store (public authority surface / error precedence) |

## Deliberately not in this matrix

Codex marked filesystem normalization **PARTIAL** (raw `os.close` and walk-iteration coverage remain incomplete). It
was not one of the four release-relevant findings, and v1.11 does not broaden into a filesystem wrapper rewrite. The
13-label frozen `FS_*` vocabulary, the mapped errno conditions, the `TypeError`/programming-error distinction and
`fs()`'s normalization behaviour are retained and re-run unchanged in `evidence-fs-errors`; the changed code introduced
no new raw filesystem call. The item is left for separate adjudication.

## What is still not closed

- No probe has run, no evidence root exists, and the store has only been exercised against temporary directories.
- Detection, not prevention. Deliberate device and inode reuse is not claimed to be detected, and this is not a
  time-of-check/time-of-use guarantee.
- Mode, file-type and permission claims are POSIX-scoped to the Linux reference host. No Windows parity is claimed.
- `SCHEMA-VALID != AUTHORIZED TO MUTATE`. Passing proves internal consistency and that the reproduced attacks are
  refused; it is not evidence that any Resolve read or write works.
