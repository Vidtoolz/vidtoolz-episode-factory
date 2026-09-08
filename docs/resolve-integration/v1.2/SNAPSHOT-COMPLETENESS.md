# SNAPSHOT-COMPLETENESS.md (v1.2, FROZEN_NOW)

Coverage profiles (`coverage.profile`) and mandatory content (`authority_lib.COVERAGE_PROFILES`):

| Profile | Mandatory domains | Mandatory item fields | Items required |
|---|---|---|---|
| `MINIMAL_M0` | connection, library, project, timeline | none | no |
| `FULL_TIMELINE_READ` | + tracks, items, markers, settings | start, end | yes |
| `WRITE_PRECHECK` | + item_identity, track_locks, adapter_bin_media | start, end, unique_id | yes |

`coverage.complete: true` requires every mandatory domain in `observed_domains`, non-empty `observed_domains`, every mandatory item field `OBSERVED`, and no invented domain names (closed vocabulary in the schema). Otherwise `complete` MUST be false and the missing domains MUST be named in `unobservable_domains` or `deferred_domains`.

Per-field observation status (`field_status`, closed vocabulary `OBSERVED | UNAVAILABLE | UNSUPPORTED | ERROR | NOT_REQUESTED`): a value is present iff status is `OBSERVED`; `UNAVAILABLE`/`ERROR` require a `<field>_reason`. A Resolve identifier is never fabricated: `unique_id`, `media_pool_item_unique_id`, `media_id`, `source_start`, `source_end` and `project.unique_id`/`timeline.unique_id` may be null with a status. Item ordering stays total via `observation_ordinal` (position in `GetItemListInTrack`).

Range law: `end >= start`; `source_end >= source_start` when both present; `timeline.end_frame >= start_frame`. `duration_convention` is `UNQUALIFIED` until M3 P3 proves inclusivity: under `UNQUALIFIED` a supplied `duration` must equal `end-start` or `end-start+1` (raw observations recorded, no normalized law invented); under `END_EXCLUSIVE`/`END_INCLUSIVE` the exact relation is enforced. Derived relationships may be omitted (`duration: null`) when unobserved.
