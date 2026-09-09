# GUARD-AUTHORITY.md — pre-write / re-validation guard (v1.5, FROZEN_NOW)

**Model A (composite canonical guard digest); v1.5 raises the guard to version 3.** The payload digest is not the revision token (identical content in different projects/libraries/epochs collides); identity observation status and reason are part of the guard (v1.4); and (v1.5) the **field-provenance authority** of the snapshot is part of the guard, so a snapshot whose OBSERVED fields are backed by different capability evidence — or by none — has a different guard.

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
