# SNAPSHOT-COMPLETENESS.md (v1.4, FROZEN_NOW)

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
| `OBSERVED` | required (non-null) **and** the producing primitive must be callable in the collecting session | — |
| `UNAVAILABLE` | must be null | required |
| `ERROR` | must be null | required |
| `UNSUPPORTED` | must be null | optional |
| `NOT_REQUESTED` | must be null | optional |

Every value is nullable in the schema (`start_frame`, `end_frame`, `width`, `height`, `start_timecode`, `fps`, `settings`, `is_current`, names, ids, frames). `semantic_snapshot(snap, callable_methods)` rejects: value null with status `OBSERVED`; value present with any other status ("fabrication"); `UNAVAILABLE`/`ERROR` without reason; unknown status words and invented field names; a status `OBSERVED` whose producing primitive (`FIELD_PRIMITIVE`, e.g. `timeline.start_frame ← GetStartFrame`) is not in `callable_methods`; an observed domain whose producing primitive (`DOMAIN_PRIMITIVE`, e.g. `tracks ← GetTrackCount`) is not callable; a `collection.primitive_status` entry claiming `QUALIFIED_CALLABLE` for a method the active authority does not qualify. `callable_methods` is `callable_method_set(capabilities, read_primitives, evidence_set, target_contract, active)` — capability authority and coverage are coupled, so a snapshot cannot claim to have read what nothing could read. Nothing is ever fabricated.

## Degraded timeline observation (required by v1.4)

If a read primitive is unavailable or unqualified, collection produces a canonical incomplete snapshot: e.g. `GetStartFrame` not callable → `timeline.start_frame: null`, `field_status.start_frame: UNAVAILABLE` (or `UNSUPPORTED`/`ERROR` as observed) with a reason, `coverage.complete: false`, the gap named in `incomplete_reasons`, `collection.primitive_status.GetStartFrame != QUALIFIED_CALLABLE`. The snapshot canonicalizes and hashes (vector `unobserved_timeline_all_null_with_status`; fixtures `snapshot-degraded-start-frame-unavailable-honest`, `full-read-degraded-start-frame.json`). The implementer never invents a value, never uses probe output as production evidence, never omits the timeline, and canonicalization never crashes on null frames (`snapshot-timeline-start-frame-null-observed` records the status/value contradiction instead of raising).

## Pre-qualification capture (zero QUALIFIED_READ rows)

With no callable primitive (`M0-PROBE-CONTRACT.md`), the only legal `SNAPSHOT_CAPTURE` output is: profile `MINIMAL_M0`; `observed_domains` exactly `connection`, `library` (taken from the session's current `CONNECTION_OBSERVATION`, which the probe is allowed to produce); every project and timeline field `UNAVAILABLE` with reason; `payload.tracks`, `markers`, `media_dependencies` empty (tracks enumerated by the probe are candidate evidence, never snapshot content); `coverage.complete: false` with `incomplete_reasons` naming the missing mandatory domains; `collection.primitive_status` all `UNQUALIFIED`; `snapshot_result_class → INCOMPLETE_NOT_QUALIFIED`. It is useful only as the honest baseline that anchors library uuid, target epoch and guard digest for the M0 evidence pack and proves the degrade path; it is never a plan H0 and never proves any read capability. Fixture `m0-minimal-nothing-qualified.json`; negatives `snapshot-m0-complete-claimed-nothing-qualified`, `snapshot-m0-timeline-frames-observed-nothing-qualified`, `snapshot-m0-track-observed-nothing-qualified`, `snapshot-m0-domain-observed-without-callable`, `snapshot-claims-callable-not-in-authority`, `snapshot-full-read-claimed-under-frozen-matrix`.

## Unavailable frame observations — option A (status-aware order) + failure ledger

An item whose `end` (or `start`, `duration`, `enabled`) is unavailable **stays in the canonical item list** with the value null, its status and a reason. The item sort key is total without any frame value: `((start-status rank, start), (end-status rank, end), kind order, unique_id, observation_ordinal)`; `OBSERVED` ranks before `UNAVAILABLE < UNSUPPORTED < ERROR < NOT_REQUESTED`; `observation_ordinal` is required and unique per track. Vectors `partial_items_status_aware_order_A/B` prove permutation invariance. An element that could not be enumerated at all is **never silently omitted**: it is recorded in `payload.observation_failures` (`track_address`, `observation_ordinal`, `method`, `reason`), which is canonical and forces `complete: false` (fixture `full-read-partial-item-ledger.json`).

## Coverage completeness (`authority_lib.COVERAGE_PROFILES`)

| Profile | Mandatory domains | Mandatory item fields | Mandatory timeline fields | Identity required OBSERVED | Locks | Guard |
|---|---|---|---|---|---|---|
| `MINIMAL_M0` | connection, library, project, timeline | none | none | none | no | no |
| `FULL_TIMELINE_READ` | + tracks, items, markers, settings | start, end, enabled | name, start_frame, end_frame, fps, width, height | `timeline.unique_id` | no | no |
| `WRITE_PRECHECK` | + item_identity, track_locks, adapter_bin_media, guard, policy | start, end, enabled, unique_id, media_pool_item_unique_id | name, start_frame, end_frame, start_timecode, fps, width, height, is_current, settings | `project.unique_id`, `timeline.unique_id` | every track `locked` OBSERVED | `guard_digest` present |

`coverage.complete: true` requires: non-empty `observed_domains`; every mandatory domain observed; every mandatory item field and mandatory timeline field `OBSERVED`; the profile's identity fields `OBSERVED`; locks resolved and guard present where required; `observation_failures` empty; `incomplete_reasons` empty. Otherwise `complete` MUST be false, `incomplete_reasons` MUST be non-empty, and the incompleteness must be visible: a profile-mandatory gap, unresolved required identity/locks, a degraded (`UNAVAILABLE`/`UNSUPPORTED`/`ERROR`) timeline, project or track field, a non-empty failure ledger, or declared unobservable/deferred domains. Domain names are a closed vocabulary; a domain cannot be both observed and unobservable/deferred.

**WRITE_PRECHECK fails closed** (provisional contract, mutation still prohibited): library, project and timeline identity, every timeline field, every occurrence's identity, track topology, lock state, current guard and policy pins must all be `OBSERVED`; any degraded field makes the snapshot incomplete and therefore unusable as a plan's H0 or as S1 (`validate_transaction_set` requires a complete `WRITE_PRECHECK` S0). This claims nothing about runtime qualification.

## Range law (unchanged)

`end >= start`; `source_end >= source_start` when both `OBSERVED`; `timeline.end_frame >= start_frame` when both `OBSERVED`. `duration_convention` is `UNQUALIFIED` until M3 P3: a supplied `duration` must equal `end-start` or `end-start+1`; exact under `END_EXCLUSIVE`/`END_INCLUSIVE`. Range checks apply only to `OBSERVED` values.

Fixtures: positives `snapshot-human-timeline-full-read` (under the hypothetical matrix), `snapshot-m0-minimal-nothing-qualified-honest`, `snapshot-m0-minimal-complete-qualified`, `snapshot-full-read-partial-item-honest`, `snapshot-degraded-start-frame-unavailable-honest`, `snapshot-write-precheck-complete`, `snapshot-m0-project-identity-error-honest`; 42 `snapshot`-layer negatives and the schema negatives cover every rejection above.
