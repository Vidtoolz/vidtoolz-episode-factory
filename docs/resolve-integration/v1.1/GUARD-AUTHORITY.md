# GUARD-AUTHORITY.md — pre-write / re-validation guard (v1.1, FROZEN_NOW)

**Model A (composite canonical guard digest) is chosen.** v1.0 implied that the payload digest was the revision token; it is not, because two timelines with identical content in different projects, libraries or epochs produce the same payload digest.

Guard object (`schemas/resolveGuard.schema.json`), hash domain `vidtoolz.resolveGuard.v1`:
```
{ hash_domain, guard_version: 1,
  library: {db_type, db_name, instance_uuid},
  project: {unique_id, name},
  timeline: {unique_id, name},
  target_epoch,
  coverage: {complete, observed_domains, unobservable_domains, deferred_domains},
  policy: {target_contract_sha256, timebase_sha256, track_policy_sha256, capabilities_version, collector_version, canonicalization_version},
  payload_sha256 }
guard_digest = sha256( utf8("vidtoolz.resolveGuard.v1") + 0x0A + canonical(guard) )
payload_sha256 = sha256( utf8("vidtoolz.resolveSnapshotPayload.v1.1") + 0x0A + canonical(normalized payload) )
```
Rules: every snapshot carries both digests and `hash_domains`; the **pre-write and per-phase revalidation token is `guard_digest` equality** (recomputed from a fresh stable snapshot). `payload_sha256` equality alone proves content equality only. Digests are domain-tagged so a payload digest can never be mistaken for a guard digest or a plan digest. Advisory values outside the guard (`project.last_modified_time_observed`, collection timestamps) are recorded but never part of the token; their trust class is decided by M3 probe P12. Demonstration fixture: `fixtures/guard/same-payload-different-project.json` (payload digests equal, guard digests differ).
