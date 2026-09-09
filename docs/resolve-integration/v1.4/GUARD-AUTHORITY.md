# GUARD-AUTHORITY.md — pre-write / re-validation guard (v1.4, FROZEN_NOW)

**Model A (composite canonical guard digest) is chosen; v1.4 raises the guard to version 2.** The payload digest is not the revision token, because two timelines with identical content in different projects, libraries or epochs produce the same payload digest; and (v1.4, MINOR finding) an identity that was *unavailable* must not silently equal one that *errored* or one that was *observed* — the observation status and reason of project and timeline identity are part of the guard.

Guard object (`schemas/resolveGuard.schema.json`), hash domain `vidtoolz.resolveGuard.v2`:
```
{ hash_domain: "vidtoolz.resolveGuard.v2", guard_version: 2,
  library: {db_type, db_name, instance_uuid},
  project:  {unique_id, unique_id_status, unique_id_reason, name, name_status},
  timeline: {unique_id, unique_id_status, unique_id_reason, name, name_status},
  target_epoch,
  coverage: {profile, complete, observed_domains, unobservable_domains, deferred_domains, incomplete_reasons},
  policy: {target_contract_sha256, timebase_sha256, track_policy_sha256, capabilities_version, capability_matrix_sha256, collector_version, canonicalization_version},
  payload_sha256 }
guard_digest   = sha256( utf8("vidtoolz.resolveGuard.v2") + 0x0A + canonical(guard) )
payload_sha256 = sha256( utf8("vidtoolz.resolveSnapshotPayload.v1.4") + 0x0A + canonical(normalized payload) )
snapshot object digest (readback identity) = sha256( utf8("vidtoolz.resolveSnapshotObject.v1") + 0x0A + canonical(snapshot with normalized payload) )
```
Rules: every snapshot carries both digests and `hash_domains`; the **pre-write and per-phase revalidation token is `guard_digest` equality** (recomputed from a fresh stable snapshot). `payload_sha256` equality alone proves content equality only. Digests are domain-tagged so a payload digest can never be mistaken for a guard digest, a plan digest or a snapshot object digest; the v1 guard domain is unregistered (rejection `unregistered_domain_old_guard_v1`). `policy.capability_matrix_sha256` binds the guard to the capability authority the snapshot was collected under. Advisory values outside the guard (`project.last_modified_time`, collection timestamps) are recorded but never part of the token. Demonstration fixture `fixtures/guard/guard-vectors.json`: same payload / different project → different guards; same payload with project identity `UNAVAILABLE` vs `ERROR` → different guards (validator `guard`).
