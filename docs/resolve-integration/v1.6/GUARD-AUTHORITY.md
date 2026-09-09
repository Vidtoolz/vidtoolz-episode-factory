# GUARD-AUTHORITY.md — pre-write / re-validation guard and the H0 guard record (v1.6, FROZEN_NOW)

**Model A (composite canonical guard digest); the guard object is version 3, unchanged from v1.5.** The payload digest is not the revision token (identical content in different projects/libraries/epochs collides); identity observation status and reason are part of the guard (v1.4); and (v1.5) the **field-provenance authority** of the snapshot is part of the guard, so a snapshot whose OBSERVED fields are backed by different capability evidence — or by none — has a different guard.

Guard object (`schemas/resolveGuard.schema.json`), hash domain `vidtoolz.resolveGuard.v3`:
```
{ hash_domain: "vidtoolz.resolveGuard.v3", guard_version: 3,
  library: {db_type, db_name, instance_uuid},
  project:  {unique_id, unique_id_status, unique_id_reason, name, name_status},
  timeline: {unique_id, unique_id_status, unique_id_reason, name, name_status},
  target_epoch,
  coverage: {profile, complete, observed_domains, unobservable_domains, deferred_domains, incomplete_reasons},
  policy: {target_contract_sha256, timebase_sha256, track_policy_sha256, capabilities_version, capability_matrix_sha256, collector_version, canonicalization_version},
  provenance_sha256,      // = sha256("vidtoolz.resolveProvenance.v1" + 0x0A + canonical(collection.method_provenance))
  payload_sha256 }
guard_digest   = sha256( utf8("vidtoolz.resolveGuard.v3") + 0x0A + canonical(guard) )
payload_sha256 = sha256( utf8("vidtoolz.resolveSnapshotPayload.v1.5") + 0x0A + canonical(normalized payload) )
snapshot object digest (readback identity) = sha256( utf8("vidtoolz.resolveSnapshotObject.v1") + 0x0A + canonical(snapshot with normalized payload) )
```
Rules: every snapshot carries both digests and `hash_domains`; the pre-write and per-phase revalidation token is `guard_digest` equality (recomputed from a fresh stable snapshot). `payload_sha256` equality alone proves content equality only. Digests are domain-tagged; the v1/v2 guard domains and the v1.4 payload domain are unregistered. The journal `READBACK_S1` event, the verification and the commit manifest name S1 by its snapshot object digest **and** its guard digest. Advisory values outside the guard (`project.last_modified_time`, collection timestamps, `is_current`) are recorded but never part of the token. Demonstration fixture `fixtures/guard/guard-vectors.json`: same payload / different project; same payload with project identity `UNAVAILABLE` vs `ERROR`; same payload with different provenance → different guards (validator `guard`).

## v1.6: the GUARD_SNAPSHOT evidence record carries the guarded facts

A guard digest alone said nothing about *what was guarded*, so early write eligibility could accept the guard of a degraded snapshot (Codex F15-03, Claude M-H0). In v1.6 the `GUARD_SNAPSHOT` record carries, besides `guard_digest` and `payload_sha256`:

- `snapshot_object_sha256` — the readback identity of the guarded snapshot;
- `guard` — the **whole guard object** above (library, project/timeline identity with status, target epoch, coverage, policy, `provenance_sha256`, `payload_sha256`);
- `method_provenance` — the snapshot's provenance map;
- `authority_version`.

`authority_lib.guard_record_errors` recomputes `digest(guard, vidtoolz.resolveGuard.v3)` and `digest(method_provenance, vidtoolz.resolveProvenance.v1)` and requires them to equal `guard_digest` and `guard.provenance_sha256`. Profile, completeness, observed domains, identity observation status, capability matrix, authority version, target identity and per-method provenance are therefore **proven fields of the guarded snapshot**, not declarations — a swapped guard object or a swapped provenance map is caught by the recomputation.

For a write precondition (`GUARD_CURRENT` on a mutation-capable or guard-requiring operation, evaluated **before any mutator**) the record must additionally prove: `coverage.profile` satisfies `WRITE_PRECHECK` under `profile_satisfies`; `coverage.complete` is true; every mandatory domain of the profile is observed; project and timeline `unique_id_status` are `OBSERVED`; every provenance entry is `QUALIFIED_OBSERVATION` resolving to the capture the **active** matrix promotes for that method; the producing primitives of every mandatory field carry that provenance; `policy.capability_matrix_sha256` is the active matrix; the authority version is the active one; and the guarded target equals the plan target. A `MINIMAL_M0`, `FULL_TIMELINE_READ`, incomplete, candidate-provenance, other-matrix or other-target guard can never satisfy write eligibility (`ELIGIBILITY.md`).
