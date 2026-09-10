# CHANGELOG — Resolve authority bundle v1.1 (versioned correction of v1.0)

## Versioning law
- **Parent authority version:** 1.0.0.
- **Parent branch / head:** `docs/resolve-authority-freeze-v1` @ `e2874f6f67f5adb3a5ced0e0e138c370e38995cb` (baseline `f30e4543b0af17d047f803ae9044aef859ef13bc`).
- **Parent manifest sha256:** `d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821` (`../v1/FREEZE-MANIFEST.json`, bytes untouched; v1.0 is immutable historical authority).
- **This version:** 1.1.0, new directory `docs/resolve-integration/v1.1/`, new manifest `FREEZE-MANIFEST.json` with closed status vocabulary. v1.0 is not repinned, rewritten or deleted.
- **Rationale:** adjudication findings B1 (drift-policy authority leak), M1 (snapshot schema rejects real human timelines), M2 (capability matrix over-claims read qualification), M3 (marker→review inference) and MINORs; plus the forensic corrections enumerated in Mikko's v1.1 mission (target contract strength, timebase pinning, track-policy typing, canary manifest constraints, guard authority, typed canonicalization, rows 10/12, missing CANARIES/MILESTONES/PERMISSIONS, schema-vs-semantic validation, M3 overclaims, scratch lifecycle permission, Scorecraft documentation, manifest status model, fixture suite).
- **Inputs available:** `ADJUDICATION-FREEZE-CONTRACT.md`, `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md`, the mission text. **Inputs named but not found on disk at authoring time:** `PRESERVATION-REPORT.md` and a Codex forensic review against `e2874f6` (only the earlier Codex review of 16:07 exists). The mission's enumerated corrections were treated as the forensic findings.

## Changed authorities (new bytes vs v1.0)
`TARGET-CONTRACT.json` (+ schema); `TIMEBASE.json` (+ schema, + `fixtures/timebase/negative-profiles.json`); `schemas/resolveTrackPolicy.v1.json` (+ schema); `CANARY-SOURCE-MANIFEST.json` (schema id bump, + schema constraints); `schemas/resolveSnapshot.schema.json` (provenance variants, guard, coverage); new `schemas/resolveGuard.schema.json`; `CANONICALIZATION.md` (+ `fixtures/canonicalization/vectors.json` v1.1, 12 vectors); `CAPABILITIES.json` (+ schema; evidence classes; rows split; rows 10/12 questions); `schemas/provisional/resolveMutationPlan.schema.json` (milestone, guard binding, typed selector); `schemas/provisional/resolveConflict.schema.json` (`PROPOSE_REVIEW_NOTE`, `authority_effect`); `SNAPSHOT-CONCURRENCY-RECOVERY.md`; `IDENTITY-BINDING.md`; `SCORECRAFT-EXTRACTION.md`; `PROVISIONAL.md`; `README.md`.

## New authorities
`CANARIES.md`, `MILESTONES.md`, `PERMISSIONS.json` (+ schema), `DRIFT-POLICY.md`, `REVIEW-MARKER-POLICY.md`, `GUARD-AUTHORITY.md`, `SEMANTIC-VALIDATION.md`, `M3-MATRIX.md` (replaces `SCRATCH-TEST-PLAN-M3.md`), `AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md` (input copy), `FINDING-RESOLUTION-MATRIX.md`, `tools/authority_lib.py`, `tools/build_v1_1.py`, `tools/validate_v1_1.py`, `VALIDATION-REPORT.md`, `fixtures/**`.

## Unchanged inherited authorities (byte-identical to v1.0; listed as `inherited_from_v1: true` in the manifest)
`ADJUDICATION-FREEZE-CONTRACT.md`, `AUTHORIZATION-2026-09-08.md`, `DOCTRINE.md`, `TRANSPORT.md`, `QUARANTINE-MANIFEST.json`, `CLIENT-VERSION-INVENTORY.md`, `fixtures/timebase/canary-boundaries.json`, and the unchanged provisional schemas (`resolveSequenceLineage`, `resolveBindingSet`, `resolveBindingObservation`, `resolveVerificationResult`, `resolveTransactionJournal`, `resolveCommitManifest`, `resolveCheckpoint`).

## Removed from v1.1 (still present in v1.0)
`SCRATCH-TEST-PLAN-M3.md` (superseded by `M3-MATRIX.md`); `schemas/resolveTrackPolicy.v1.json` object-keyed form (replaced by typed arrays).

## Mutation prohibition preserved
Every mutation-capable schema remains PROVISIONAL_UNTIL_M3; no adapter mutation code exists; no Resolve write was executed; `PERMISSIONS.json` denies by default and grants `mutation_allowed` only for M3 entries in the qualification library.
