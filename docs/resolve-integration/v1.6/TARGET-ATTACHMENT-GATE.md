# TARGET-ATTACHMENT-GATE.md (v1.6, FROZEN_NOW)

Schema validity != attachment eligibility. **Attachment state is derived, never declared, from a coherent, current, envelope-bound evidence set evaluated against the active reviewed authority.** `TARGET-CONTRACT.json` carries no declared state (`attachment_state_is_declared: false`; the schema rejects the field). The state is a pure function `derive_attachment_state(target_contract, evidence_set, active)` in `tools/authority_lib.py`. It never depends on the order of records.

## 1. Evidence envelope (every record)

`schemas/resolveEvidenceSet.schema.json`. Every record is `{record_type, record_id, envelope, recorded_at, ...body}` with `record_id = sha256("vidtoolz.resolveEvidenceRecord.v1" + 0x0A + canonical body without record_id)`. `envelope` fields (all present, nullable where the level allows): `authority_version`, `manifest_sha256`, `host_name`, `product`, `resolve_version`, `build`, `library_name`, `library_uuid`, `library_root`, `session_id`, `provisioning_id`, `project_name`, `project_unique_id`, `timeline_name`, `timeline_unique_id`, `target_epoch`, `sequence`, `captured_at`, `record_type_version` (`"1.6"`).

Level law (`ENVELOPE_LEVEL` / `ENVELOPE_REQUIRED`, mirrored in `TARGET-CONTRACT.json#evidence_envelope_law`):

| Level | Records | Required non-null envelope fields |
|---|---|---|
| BUNDLE | `BUNDLE_VERIFICATION`, `MILESTONE_EXIT`, `M3_AUTHORIZATION`, `REFREEZE_RECORD`, `REVIEW_DECISION`, `DERIVED_CAPABILITY_RESULT`, `PLAN_VALIDATION`, `MEDIA_CLASS_ATTESTATION` | `authority_version`, `manifest_sha256`, `host_name` |
| LIBRARY | `PROVISIONING_RECORD`, `OPERATOR_PROVISIONED_PROJECT` | + `library_name`, `library_uuid`, `library_root` |
| SESSION | `LAUNCH_RECIPE`, `CONNECTION_OBSERVATION`, `PROJECT_BINDING_OBSERVATION`, `TIMELINE_BINDING_OBSERVATION`, `RAW_CAPABILITY_CAPTURE`, `RAW_EVIDENCE`, `IDENTITY_UNIQUENESS_OBSERVATION`, `IDENTITY_STABILITY_OBSERVATION`, `JOURNAL_PREPARED`, `READ_ONLY_JOURNAL`, `EXCLUSIVE_SESSION_ATTESTATION`, `GUARD_SNAPSHOT`, `DESTINATION_TIMELINE` | + `product`, `resolve_version`, `build`, `session_id`, `provisioning_id`; project-scoped records also `project_name`; timeline-scoped also `timeline_name` |

`validate_evidence_set(es, active)` rejects: non-sha ids, unknown types, records whose id does not re-hash, envelope violations, and **any record whose `envelope.manifest_sha256`/`authority_version` differ from the active authority** — except a `BUNDLE_VERIFICATION` with `historical: true`, which is tolerated and never counts. An invalid set derives `CONFLICT`.

## 2. Exact manifest binding

The proof of independent verification is a `BUNDLE_VERIFICATION` whose body **and** envelope name the active `manifest_sha256` and `authority_version 1.6.0`, whose `host_name` is the contract host, `verifier != prepared_by`, `historical: false`. Arbitrary 64-hex values, an earlier manifest (v1.4, v1.5), another host, another version or a self-verification never count (fixtures `ready-bundle-historical-only`, `ready-bundle-other-host`, `ready-self-verified-bundle`, `invalid-bundle-other-manifest-not-historical`; validator `exact-manifest` re-mints evidence against the real `FREEZE-MANIFEST.json` sha and proves both directions). `MILESTONE_EXIT`, `M3_AUTHORIZATION`, `PLAN_VALIDATION` and `REFREEZE_RECORD` are likewise bound to `1.6.0`; a `REFREEZE_RECORD` must also name the active `capability_matrix_sha256`.

## 3. Coherent library binding

The `PROVISIONING_RECORD` (Disk, absolute traversal-free `root_path`, UUID `instance_uuid`, `provisioned_by`, envelope uuid/root equal to the body) is the identity anchor. Exactly one provisioning identity may exist for the contract library; two different uuid/root pairs → `CONFLICT`. The `LAUNCH_RECIPE` of the current session must cite the provisioning record (`envelope.provisioning_id`), its uuid, root and library name, the contract `resolve_version`, the `/opt/resolve/bin/resolve` pin and `Local` scripting. Every SESSION record of the current session must agree on `COHERENCE_FIELDS` (authority, manifest, host, product, version, build, library name/uuid/root, session id, provisioning id) with each other, with the contract and with the provisioning record; any disagreement → `CONFLICT` (fixture `attached-cross-library-timeline-binding`: a timeline binding whose envelope names `EKA`). The `CONNECTION_OBSERVATION` must report `db_type Disk`, `db_name` = contract library, product/version = contract, **and** `root_path` and `instance_uuid` equal to the provisioning record; a missing root or uuid is `OBSERVED_TARGET_MISMATCH` (fixtures `attached-missing-root-in-connection`, `attached-changed-uuid-in-connection`).

## 4. Freshness / session selection (no insertion-order logic)

`evidence_set.current_session_id` names the session under evaluation; `evidence_set.evaluated_at` is the evaluation instant. `current_record(es, type, session_id, **match)`: among records of that type in that session (plus field matches) the **highest `envelope.sequence`** is current; two distinct records sharing the highest sequence → **AMBIGUOUS**; a current record whose `captured_at` is older than `MAX_OBSERVATION_AGE_S` (3600 s) before `evaluated_at` → **STALE**; more than 60 s in the future → **FUTURE**; records of other sessions are never current. Within a session, `captured_at` must not decrease while `sequence` increases (`session_order_errors` → `CONFLICT`). Map order, array order and caller ordering are never consulted (the validator asserts the library takes the array tail only on the ordered journal chain and re-derives every fixture under seeded permutations).

| Scenario | Fixture | Derived |
|---|---|---|
| current bad + stale good | `attached-stale-good-current-eka` | `ATTACHMENT_READY` (`OBSERVED_TARGET_MISMATCH`) |
| stale bad + current good | `attached-current-good-stale-eka` | `ATTACHED_READ_ONLY` |
| reversed input order | `attached-reversed-order` | identical to `attached` |
| prior session only | `attached-connection-previous-session-only`, `ready-launch-previous-session-only` | not current → no connection / no launch |
| same timestamp, distinct sequence | `attached-duplicate-timestamp-distinct-sequence` | sequence decides |
| ancient record | `attached-ancient-observation` | STALE → `ATTACHMENT_READY` |
| duplicate "current" records | `attached-duplicate-sequence-conflict` | AMBIGUOUS → `CONFLICT` |
| sequence/timestamp disorder | `attached-sequence-timestamp-disorder` | `CONFLICT` |

## 5. Derived states

| State | Proven by | Permits |
|---|---|---|
| `CONFLICT` | evidence set invalid or unbound; multiple provisioning identities; incoherent session envelopes; sequence/timestamp disorder; ambiguous current records; a `FATAL_TARGET_FAILURE` probe record in the session | nothing (ranks below `UNPROVISIONED`; eligibility reports `ATTACHMENT_CONFLICT` + conflicts) |
| `UNPROVISIONED` | no valid `PROVISIONING_RECORD` for the contract host+library, or the contract library name is prohibited | nothing |
| `PROVISIONED_NOT_VERIFIED` | valid provisioning record; bundle verification or current-session launch recipe missing/invalid | nothing |
| `ATTACHMENT_READY` | + independent `BUNDLE_VERIFICATION` bound to the active manifest on this host; + `LAUNCH_RECIPE` of the current session bound to the provisioning record and pinned to the contract version/binary/Local scripting; session coherent; no current `CONNECTION_OBSERVATION`, or a current one that mismatches (`OBSERVED_TARGET_MISMATCH`), or one that is STALE/FUTURE | M0 `READ_PRIMITIVE_QUALIFICATION_PROBE` (SESSION scope) |
| `ATTACHED_READ_ONLY` | + current `CONNECTION_OBSERVATION` matching Disk / contract library / product+version / provisioning root **and** uuid | M0–M2 read operations subject to their target requirement and primitive qualification; `SetCurrentTimeline` (M2+) |
| `SCRATCH_WRITE_READY` | + `M3_AUTHORIZATION` (scope `SCRATCH_QUALIFICATION_LIBRARY`, approver, authority `1.6.0`, contract library), current `EXCLUSIVE_SESSION_ATTESTATION`, reviewed `REFREEZE_RECORD` (`M0_READ_REQUALIFICATION`) naming the active capability matrix sha | M3 mutation entries only |

Rules: `accepts_current_open_session_as_target` is `false`; the intended target is the contract, the actual target is the current connection observation; the two are compared mechanically. The qualification library UUID and root exist only in the provisioning record, never in the contract, never fabricated. `.dblist`/`.activedb` are never copied. No shared or production scope exists.

Project and timeline are **not** attachment state: they are operation-level target requirements (`ELIGIBILITY.md`) proven by the current session's `PROJECT_BINDING_OBSERVATION` / `TIMELINE_BINDING_OBSERVATION` records bound to the same provisioning record; write-capable operations additionally need `OBSERVED` unique ids. Operations with `SESSION` scope consult no project or timeline evidence at all.

Fixtures: `fixtures/evidence/*.json`; validator sections `evidence-set-schema`, `evidence-set-binding`, `attachment-derived`, `order-independence`, `exact-manifest` pin every derived state and prove order independence and manifest binding.

## v1.6 additions

`validate_evidence_set` additionally rejects: a record of a **retired** type (the v1.5 capability-evidence record type); a raw capability capture whose body is not a facts-only capture, whose digest does not re-hash, or whose binding fields disagree with its envelope; a derived-result record that does not re-hash or is bound to another parser; a review decision without its digests, decision, reviewer or rationale; a refreeze record without parent and successor matrix digests, the active parser version or a human approver; an identity observation without pass lists and recomputed claims; a guard record without its guard object, provenance map and snapshot digest. Errors are returned in a deterministic (sorted) order, so a derivation never depends on record-map iteration order.

A `FATAL_TARGET_FAILURE` in the current session is now derived, not declared: a raw capability capture whose observed host, product, version, build, library uuid/root, session, manifest or authority disagrees with the contract or the active authority makes the session `CONFLICT` (`REFERENCE-PARSER.md` class `BINDING_MISMATCH`).
