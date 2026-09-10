# SNAPSHOT-COMPLETENESS.md (v1.7, FROZEN_NOW)

## Field observation model (timeline, project, track and item fields)

Closed vocabulary `OBSERVED | UNAVAILABLE | UNSUPPORTED | ERROR | NOT_REQUESTED` on every observable field, in a `field_status` object next to the values:

| Object | `field_status` keys (all required) |
|---|---|
| `payload.timeline` | `unique_id`, `name`, `start_frame`, `end_frame`, `start_timecode`, `fps`, `width`, `height`, `is_current`, `settings` |
| `project` | `unique_id`, `name`, `last_modified_time` |
| each track | `name`, `enabled`, `locked` |
| each item | `unique_id`, `name`, `start`, `end`, `duration`, `enabled`, `media_pool_item_unique_id`, `media_id`, `source_start`, `source_end` |

| Status | Value | Reason (`<field>_reason`) |
|---|---|---|
| `OBSERVED` | required (non-null) **and** backed by qualifying field provenance (below) | — |
| `UNAVAILABLE` | must be null | required |
| `ERROR` | must be null | required |
| `UNSUPPORTED` | must be null | optional |
| `NOT_REQUESTED` | must be null | optional |

Every value is nullable. `semantic_snapshot(snap, ctx)` rejects: value null with status `OBSERVED`; value present with any other status ("fabrication"); `UNAVAILABLE`/`ERROR` without reason; unknown status words and invented field names; a status/value contradiction is recorded, never raised. Nothing is ever fabricated.

## Field provenance (v1.6): `status: OBSERVED` is never earned by a value existing

`collection.method_provenance` is a normalized map `method → {observation_class, raw_capture_record_id, capability_matrix_sha256}` with `observation_class ∈ {QUALIFIED_OBSERVATION, CANDIDATE_OBSERVATION, NOT_CALLABLE}`. Fields map to producing methods through `FIELD_PRIMITIVE` (e.g. `timeline.start_frame ← GetStartFrame`, `item.media_pool_item_unique_id ← GetMediaPoolItem + MediaPoolItem.GetUniqueId`) and observed domains through `DOMAIN_PRIMITIVE` (e.g. `tracks ← GetTrackCount`). Under the active authority context (`ctx = {caps, rp, es, active, tc}`, built by `validate_transaction_set` — never supplied by a caller):

- every method an OBSERVED field or observed domain relies on must have an entry whose class is `QUALIFIED_OBSERVATION`, whose `capability_matrix_sha256` is the active matrix, and whose `raw_capture_record_id` resolves to the `RAW_CAPABILITY_CAPTURE` record **for that method** that the active matrix promotes — that is, `capability_qualification` derives `QUALIFIED_CALLABLE` for the method **through that exact capture** (capture re-parsed to `SUCCESS` now, reviewed `ACCEPT`, promoted by a reviewed refreeze under the active parser and primitive spec);
- a `QUALIFIED_OBSERVATION` entry for a method the active authority does not qualify is an error ("claims");
- `CANDIDATE_OBSERVATION` (probe output, unreviewed) can never back an OBSERVED field: the fields it would produce must be `UNAVAILABLE` (fixture `snapshot-candidate-observation-honest-unavailable`); `NOT_CALLABLE` entries cite no capture;
- the guard (v3) binds `provenance_sha256 = digest(method_provenance)` so a snapshot's trust cannot be changed without changing its guard, and the `GUARD_SNAPSHOT` evidence record carries the guard object **and** the provenance map so a pre-write evaluator can prove all of this before any mutator (`GUARD-AUTHORITY.md`, `ELIGIBILITY.md`).

Negatives: missing entry, candidate backing OBSERVED, unreviewed / failed / fabricated-interpretation captures cited, a capture other than the promoted one cited, adjacent getter cited, matrix sha not active, capture not in the set, QUALIFIED without a capture id, unknown class, missing map, degraded collection marking OBSERVED (`snapshot-degraded-start-frame-claimed-observed`), frozen matrix with OBSERVED fields (`snapshot-full-read-claimed-under-frozen-matrix`), and a forged matrix under the active digest (`snapshot-provenance-under-forged-matrix-digest`).

## Occurrence identity uniqueness (v1.6)

Any identity used by delta/verification must be unique within its identity domain, which for occurrences is the whole timeline payload. `occurrence_index(snap)` builds the canonical index only after uniqueness validation: two items with the same OBSERVED `unique_id` (in one track or across tracks) → `DUPLICATE_OCCURRENCE_IDENTITY: <id> at <addresses in canonical order>`; no index is built; `derive_delta` returns None; `verify_transaction` → `UNOBSERVABLE_STATE`. `semantic_snapshot` reports the duplicate in every profile. Input order never affects identity lookup, added/removed/changed determination, creation mappings or the verdict (seeded permutation tests with and without duplicates). The field name `UniqueId` is not assumed to guarantee uniqueness: this bundle fails closed on duplicates; if M0/M3 observations show that Resolve can legitimately produce duplicate ids, a versioned correction must define a stronger composite occurrence identity before any verification relies on it. The three M0 identity claims (callable, unique within one pass, stable across passes) and the M3 survival questions are separated by `IDENTITY-EVIDENCE.md`; verification never depends on a claim, only on the fail-closed index.

## Degraded timeline observation

If a read primitive is unavailable or unqualified, collection produces a canonical incomplete snapshot: e.g. `GetStartFrame` not callable → `timeline.start_frame: null`, `field_status.start_frame: UNAVAILABLE` with a reason, `method_provenance.GetStartFrame.observation_class: NOT_CALLABLE`, `coverage.complete: false`, the gap named in `incomplete_reasons`. The snapshot canonicalizes and hashes. The implementer never invents a value, never uses probe output as production evidence, never omits the timeline.

## Pre-qualification capture (zero QUALIFIED_READ rows)

With no callable primitive, the only legal `SNAPSHOT_CAPTURE` output is: profile `MINIMAL_M0`; `observed_domains` exactly `connection`, `library`; every project and timeline field `UNAVAILABLE` with reason; `payload.tracks`, `markers`, `media_dependencies` empty; every `method_provenance` entry `NOT_CALLABLE` (or `CANDIDATE_OBSERVATION` for a probe-session capture, still with every dependent field `UNAVAILABLE`); `coverage.complete: false`; `snapshot_result_class → INCOMPLETE_NOT_QUALIFIED`. It anchors library uuid, target epoch and guard for the M0 evidence pack and proves the degrade path; it is never a plan H0 or S1.

## Unavailable frame observations — option A (status-aware order) + failure ledger

An item whose frame or identity field is unavailable **stays in the canonical item list** with the value null, its status and a reason. The item sort key is total without any frame value: `((start-status rank, start), (end-status rank, end), kind order, unique_id, observation_ordinal)`. An element that could not be enumerated at all is recorded in `payload.observation_failures` (canonical, forces `complete: false`).

## Coverage profiles (`authority_lib.COVERAGE_PROFILES`)

| Profile | Mandatory domains | Mandatory item fields | Mandatory timeline fields | Identity required OBSERVED | Locks | Guard |
|---|---|---|---|---|---|---|
| `MINIMAL_M0` | connection, library, project, timeline | none | none | none | no | no |
| `FULL_TIMELINE_READ` | + tracks, items, markers, settings | start, end, enabled | name, start_frame, end_frame, fps, width, height | `timeline.unique_id` | no | no |
| `APPEND_VERIFY` (v1.5, provisional) | + item_identity, item_source_bounds, track_locks, adapter_bin_media, guard, policy | start, end, enabled, unique_id, media_pool_item_unique_id, source_start, source_end | name, start_frame, end_frame, fps, width, height, settings | `project.unique_id`, `timeline.unique_id` | every track `locked` OBSERVED | `guard_digest` present |
| `WRITE_PRECHECK` | as APPEND_VERIFY | as APPEND_VERIFY | + start_timecode, is_current | as APPEND_VERIFY | yes | yes |

`coverage.complete: true` requires every mandatory domain observed, every mandatory item and timeline field `OBSERVED`, the identity fields `OBSERVED`, locks/guard where required, empty failure ledger and empty `incomplete_reasons`. Otherwise `complete` MUST be false with visible justification (profile-mandatory gap, unresolved identity/locks, a degraded timeline/project/track field, a failure ledger, or declared unobservable/deferred domains).

**S0/S1 profile law (v1.7, unchanged from v1.5 except that the H0 guard record now proves it before any mutator — `ELIGIBILITY.md`):** S0 of a mutation must be a complete `WRITE_PRECHECK` snapshot (it now mandates source bounds so the protected surface is provable). S1 must satisfy the strongest verify profile required by the plan's operations (`OPERATION_VERIFY_PROFILE`: APPEND → `APPEND_VERIFY`; other operations have none yet and therefore cannot be verified) under `profile_satisfies` (every mandatory set a superset; locks/guard at least as strict) and must be complete; a `MINIMAL_M0`, `FULL_TIMELINE_READ` or incomplete snapshot can never serve as S1. `APPEND_VERIFY` requires exactly what APPEND verification needs (target identity, occurrence identity/track/range, source/media identity, the protected timeline metadata, track locks, guard) and is not generalized to other mutators.

## Range law (unchanged)

`end >= start`; `source_end >= source_start` when both `OBSERVED`; `timeline.end_frame >= start_frame` when both `OBSERVED`. `duration_convention` is `UNQUALIFIED` until M3 P3.

## Not represented at all (v1.6 honest exclusion)

`authority_lib.PROTECTED_SURFACE_EXCLUSIONS` = item properties (transform/crop/composite/audio), fades, speed, takes, linked items, unowned media hashes. The snapshot schema has **no** payload for them, `derive_delta` does not compare them, and no zero-unintended-change claim covers them. They may appear only in `deferred_domains` / `unobservable_domains`; listing one in `observed_domains` is a snapshot error, and every verification result repeats them in `unobserved_domains`. This replaces the earlier situation in which active prose implied a protected property surface that no schema could express (Codex F15-05). Representing them is future work behind its own probe and refreeze.
