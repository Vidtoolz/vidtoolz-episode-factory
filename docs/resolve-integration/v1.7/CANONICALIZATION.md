# Canonicalization specification v1.6 (FROZEN_NOW; canonical text law unchanged since v1.5; Node conformance = M1 work)

Reference: `tools/authority_lib.py`; vectors `fixtures/canonicalization/vectors.json`; rejections `fixtures/canonicalization/rejections.json`.

1. **Encoding/objects/strings/integers/booleans**: UTF-8, no whitespace, keys sorted by code point, exact strings with the fixed escape set, integers within ±(2^53−1). Bare floats, NaN, Infinity, lone surrogates rejected. No Unicode normalization.
2. **Tagged numerics**: `{"$rational":"p/q"}` MUST fully match `^(0|[1-9][0-9]*)/([1-9][0-9]*)$` and be reduced. `{"$f64":"<16 lowercase hex>"}` is IEEE-754 binary64 big-endian matched with full-string semantics; NaN/Infinity and negative zero are rejected; one bit pattern has exactly one text.
3. **Nullable fields** are emitted as `null`, never omitted; every timeline/project/track/item observable field is nullable with a status.
4. **Typed array ordering** (`normalize_snapshot_payload`): tracks by (type order, integer index); items by the status-aware key `((start-status rank, start), (end-status rank, end), kind order, unique_id, observation_ordinal)`; `observation_failures` by (track_address, ordinal, reason); markers by the total key (object_address, frame, duration, custom_data, name, color, note) with `MARKER_COLLISION` on shared (object_address, frame); media dependencies by (locator, sha). Ordering never relies on input order (vectors + seeded permutations). **Occurrence identity** used by delta/verification is indexed only after uniqueness validation (`occurrence_index`); duplicates are rejected in canonical address order, never resolved by position.
5. **Duplicate JSON keys (policy A)**: authority files MUST be loaded through `strict_loads`/`strict_load`, which reject duplicate keys at the parse boundary.
6. **Domain-tagged digests**: `sha256(utf8(domain) + 0x0A + canonical_bytes)`; registered domains only: `vidtoolz.resolveSnapshotPayload.v1.5`, `vidtoolz.resolveGuard.v3`, `vidtoolz.resolveProvenance.v1` (digest of `collection.method_provenance`, bound into the guard), `vidtoolz.resolveSnapshotObject.v1` (whole snapshot with normalized payload — the readback identity named by journal, verification and commit), `vidtoolz.resolveMutationPlan.v1`, `vidtoolz.resolveOperationSet.v1`, `vidtoolz.resolveBindingSet.v1`, `vidtoolz.resolveJournalRecord.v1`, `vidtoolz.resolveEvidenceRecord.v1`, `vidtoolz.resolveVerificationResult.v1`, `vidtoolz.resolveGeneric.v1`, and (v1.6) `vidtoolz.resolveRawCapabilityCapture.v1` (a capture body without its `raw_digest`), `vidtoolz.resolveDerivedCapabilityResult.v1` (the reference parser's output), `vidtoolz.resolvePrimitiveSpec.v1` (one expectation spec, and the sorted spec set), `vidtoolz.resolveCapabilityMatrix.v1` (**the capability matrix object — this digest IS the active capability authority**). Earlier payload and guard domains are unregistered (rejections `unregistered_domain_old_guard_v1/v2`, `unregistered_domain_old_payload_v1_4`).
7. **Evidence record ids**: `record_id = digest(body without record_id, vidtoolz.resolveEvidenceRecord.v1)`; the envelope, the sealed capture body, the review's raw/derived/parser/spec references and the refreeze's promotion lists are all part of the body, so none can be altered without changing the record's identity.
7a. **Typed value codec** `vidtoolz.resolvePyValue.v1` (`RAW-CAPTURE.md` §3): the canonical encoding of an observed Python value. Mapping keys are ordered canonically as `[key, value]` pairs; `bool` is never an `int`; integers beyond ±(2^53−1) become `bigint` strings; floats are 16-hex IEEE-754 with explicit `nan`/`+inf`/`-inf` tags; bytes are recorded by length and digest; opaque objects become class/module/handle/repr-digest descriptors; elision is always explicit. **Observed values are recorded faithfully, so a captured negative zero stays `8000000000000000`** — the `-0` normalization of rule 2 applies to authored `$f64` fields in documents, not to observations.
8. `canonicalization_version` is `"1.5"` (the canonical text law did not change in v1.6; only new domains and the value codec were added). Vector and rejection counts are in `VALIDATION-REPORT.md` (`canon-vector`, `canon-rejection`).

## v1.7 additions

**New registered hash domains.** `vidtoolz.resolveReadPrimitiveAuthority.v1`, `vidtoolz.resolveEvidenceSet.v1`,
`vidtoolz.resolveContentKey.v1`, `vidtoolz.resolveSchemaRegistry.v1`, `vidtoolz.resolveTrustedCaptureShim.v1`,
`vidtoolz.resolveShimAllowlist.v1`, `vidtoolz.resolveRawIngestReceipt.v1`, `vidtoolz.resolveEvidenceSession.v1`,
`vidtoolz.resolveEvidenceHashes.v1`, `vidtoolz.resolveIdentityClaimSet.v1`, `vidtoolz.resolveStoredChain.v1`,
`vidtoolz.resolveRefreezeBlock.v1`. The domain registry stays closed: an unregistered domain raises.

**`vidtoolz.resolveContentKey.v1` is not a canonical authority digest.** It is the domain of the cache keys described
in `AUTHORITY-CACHING.md`, computed over a fast deterministic JSON serialization rather than canonical text. It is
never recorded, published, compared against a stored digest or used to authorize anything. Its only job is to make
every authority cache a pure function of input content.

**The canonicalizer implementation changed; the canonical text did not.** `CANONICALIZATION_VERSION` remains `1.5`.
v1.7 replaces the per-character escape loop with a translation table and detects duplicate keys on the canonicalized
key strings, which is strictly stronger. The v1.5/v1.6 implementation is retained verbatim as
`authority_lib.canon_reference`, and `validate_v1_7.py` section `canonicalization-equivalence` proves the two produce
byte-identical output over every document in this bundle plus an adversarial corpus, and refuse the same inputs.
