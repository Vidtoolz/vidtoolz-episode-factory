# Canonicalization specification v1.1 (FROZEN_NOW; Node conformance = M1 work)

Supersedes v1.0 by adding typed array ordering, explicit nullable-field law and domain-tagged digests. Reference implementation: `tools/authority_lib.py`; vectors: `fixtures/canonicalization/vectors.json` (12 vectors).

1. **Encoding/objects/strings/numbers/booleans** as in v1.0: UTF-8, no whitespace, keys sorted by code point, exact strings with the fixed escape set, integers only within ±(2^53−1), non-integers as tagged `{"$rational":"p/q"}` (reduced, q>0) or `{"$f64":"<16 hex>"}`; bare floats, NaN, Infinity, lone surrogates and duplicate keys are rejected.
2. **Nullable fields:** a schema-declared nullable field MUST be emitted as `null`, never omitted. Absence of a required field fails validation before canonicalization. (Vector `nullable_fields_explicit_null`.)
3. **Typed array ordering (applied by `normalize_snapshot_payload` before hashing):**
   - `payload.tracks`: sort by (`TRACK_TYPE_ORDER[type]` with video=0 < audio=1 < subtitle=2, numeric `index`). `index` MUST be an integer ≥ 1; a string index is rejected. Duplicate (type,index) is rejected. (Vectors `numeric_track_index_2_before_10`, `track_type_order_video_audio_subtitle`.)
   - `tracks[].items`: sort by (numeric `start`, numeric `end`, `ITEM_KIND_ORDER[provenance.kind]` MEDIA_BACKED<GENERATOR<TITLE<COMPOUND<ADJUSTMENT<FUSION_OR_GENERATED<OTHER_OBSERVED, `unique_id` code-point order). Frame quantities compare as exact rationals (integers or `$rational`). Two items equal on all four keys are an identity collision and are rejected. (Vector `same_frame_items_deterministic`.)
   - `markers` (timeline and item): sort by (`object_address`, numeric `frame`, `custom_data`, `name`, `color`).
   - `media_dependencies`: sort by (`logical_locator`, `source_sha256`).
   - Arrays not listed keep insertion order (order has semantics, e.g. `operations`).
   - Property: any permutation of the input arrays yields the same canonical bytes and digest. (Vectors `permutation_invariance_A/B`.)
4. **Domain-tagged digests:** `digest(obj, domain) = sha256(utf8(domain) + 0x0A + canonical_bytes)`. Registered domains: `vidtoolz.resolveSnapshotPayload.v1.1`, `vidtoolz.resolveGuard.v1`, `vidtoolz.resolveMutationPlan.v1`, `vidtoolz.resolveBindingSet.v1`, `vidtoolz.resolveJournalRecord.v1`, `vidtoolz.resolveGeneric.v1`. Unregistered domains are rejected. Every stored digest field names its domain (snapshot `hash_domains`).
5. **Versioning:** `canonicalization_version` is `"1.1"`; a change to any rule is a new version and new vectors.
