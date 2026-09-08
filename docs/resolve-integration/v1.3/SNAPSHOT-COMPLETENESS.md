# SNAPSHOT-COMPLETENESS.md (v1.3, FROZEN_NOW)

## Field observation model (every item frame and identity field)

`field_status` keys (all required): `unique_id`, `start`, `end`, `duration`, `enabled`, `media_pool_item_unique_id`, `media_id`, `source_start`, `source_end`; plus `project.unique_id_status` and `payload.timeline.unique_id_status`. Closed vocabulary `OBSERVED | UNAVAILABLE | UNSUPPORTED | ERROR | NOT_REQUESTED`.

| Status | Value | Reason (`<field>_reason`) |
|---|---|---|
| `OBSERVED` | required (non-null) | — |
| `UNAVAILABLE` | must be null | required |
| `ERROR` | must be null | required |
| `UNSUPPORTED` | must be null | optional |
| `NOT_REQUESTED` | must be null | optional |

`semantic_snapshot` rejects: value null with status `OBSERVED`; value present with any other status ("fabrication"); `UNAVAILABLE`/`ERROR` without reason; unknown status words and invented field names (schema, closed `field_status`); timeline or project identity null while `OBSERVED`. Nothing is ever fabricated.

## Unavailable frame observations — option A (status-aware order) + failure ledger

An item whose `end` (or `start`, `duration`, `enabled`) is unavailable **stays in the canonical item list** with `end: null`, `field_status.end: UNAVAILABLE` and a reason. The item sort key is total without any frame value: `((start-status rank, start), (end-status rank, end), kind order, unique_id, observation_ordinal)`; `OBSERVED` ranks before `UNAVAILABLE < UNSUPPORTED < ERROR < NOT_REQUESTED`; `observation_ordinal` (position in `GetItemListInTrack`) is required and unique per track. Vectors `partial_items_status_aware_order_A/B` prove permutation invariance. An item that could not be enumerated at all (the getter raised on the element) is **never silently omitted**: it is recorded in `payload.observation_failures` (`track_address`, `observation_ordinal`, `method`, `reason`), which is part of the canonical payload and forces `complete: false`. Honest incomplete representation is always possible under `MINIMAL_M0`.

## Coverage completeness (`authority_lib.COVERAGE_PROFILES`)

| Profile | Mandatory domains | Mandatory item fields | Identity required OBSERVED | Locks | Guard |
|---|---|---|---|---|---|
| `MINIMAL_M0` | connection, library, project, timeline | none | none (ids may be `UNAVAILABLE`) | no | no |
| `FULL_TIMELINE_READ` | + tracks, items, markers, settings | start, end, enabled | `timeline.unique_id` | no | no |
| `WRITE_PRECHECK` | + item_identity, track_locks, adapter_bin_media, guard, policy | start, end, enabled, unique_id, media_pool_item_unique_id | `project.unique_id`, `timeline.unique_id` | every track `locked` non-null | `guard_digest` present |

`coverage.complete: true` requires: non-empty `observed_domains`; every mandatory domain observed; every mandatory item field `OBSERVED` on every item; the profile's identity fields `OBSERVED`; locks resolved and guard present where required; `observation_failures` empty. Otherwise `complete` MUST be false, `incomplete_reasons` MUST be non-empty, and the missing domains/fields MUST be visible (in `unobservable_domains`/`deferred_domains`, unresolved fields or the failure ledger). Domain names are a closed vocabulary; a domain cannot be both observed and unobservable/deferred.

**WRITE_PRECHECK fails closed** (provisional contract, mutation still prohibited): library, project and timeline identity, every occurrence's identity, track topology, lock state, current guard and policy pins must all be `OBSERVED`; null required identity or an unresolved lock makes the snapshot incomplete and therefore unusable as a plan's H0. This claims nothing about runtime qualification.

## Range law (unchanged)

`end >= start`; `source_end >= source_start` when both `OBSERVED`; `timeline.end_frame >= start_frame`. `duration_convention` is `UNQUALIFIED` until M3 P3: a supplied `duration` must equal `end-start` or `end-start+1`; exact under `END_EXCLUSIVE`/`END_INCLUSIVE`. Range checks apply only to `OBSERVED` values.

Fixtures: positives `snapshot-human-timeline-full-read`, `snapshot-m0-minimal-partial-honest` (partial item + ledger, `complete: false`), `snapshot-m0-minimal-complete-identity-unavailable`, `snapshot-write-precheck-complete`; 36 negatives (`snapshot-*`) covering every rejection above.
