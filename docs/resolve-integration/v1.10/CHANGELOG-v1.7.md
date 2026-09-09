# CHANGELOG — Resolve authority bundle v1.7 (narrowly scoped correction of v1.6)

- **Parent:** v1.6.0, branch `docs/resolve-authority-freeze-v1.6` @ `82976433875c8a68aff13f2d9a4071e913b8da29`, manifest `9f8a1a2e51f205409f8cb3f175144d21c59658221a42398612f982746a04ac29`. Ancestors: v1.5.0 @ `9d944e01358b4b88d6ee4c9993a4db4084ba23ad`; v1.4.0 @ `d2d77680047221f2dac52adce6938dd410e38b47`; v1.3.0 @ `1c9e090fcc8978e6e9b8f5dd538849448044d26b`; v1.2.0 @ `c6d1284c6f395f5b21a6d14f8c2873bccfc065bb`; v1.1.0 @ `47ddb225335b8c85ca5255b1de86ff508e0e8e91`; v1.0.0 @ `e2874f6f67f5adb3a5ced0e0e138c370e38995cb`.
- **This version:** 1.7.0, directory `docs/resolve-integration/v1.7/`, own `FREEZE-MANIFEST.json` (schema `resolveFreezeManifest.v1.7`; parent head and manifest pinned as schema constants and semantic checks).
- **Input of record:** Codex's final independent forensic adjudication of v1.6 — four BLOCKERs (C16-B1 content-insensitive authority caches, C16-B2 caller-supplied schema validators, C16-B3 unbound capture-shim trust, C16-B4 chain substitution), three M0A MAJORs (C16-M1 duplicate receiver paths, C16-M2 absent strict byte ingestion, C16-M3 non-executable evidence store) and one operational finding (the Hermes M0A package cannot bind to v1.6 because the trusted shim, parser, spec and raw identities are not operationally closed).
- **Scope discipline:** this is a correction of the listed findings and their direct consequences, nothing else. No Resolve launched or contacted; no `EKA`; no M0; no M0A probe executed; no merge; v1.0–v1.6 bytes untouched; unrelated production code untouched. The v1.6 gate verdicts stand until this bundle is independently reviewed.

## New authorities (documents)

`AUTHORITY-CACHING.md` (what an authority evaluator may remember, and why no cache key may be an object identity), `SCHEMA-REGISTRY.md` (the authority owns the validator; the caller supplies artifacts), `TRUSTED-SHIM.md` (the one capture shim a promotable capture may come from), `STORED-CHAIN.md` (the exact stored artifacts a promotion rests on and how multiplicity resolves).

## New machine artifacts

- `TRUSTED-SHIM.json` — pinned trusted capture shim: version, self-hash, source path and source bytes, allowlist digest and method count, codec, raw frame schema, raw-ingest version, closed by its own digest.
- `SCHEMA-REGISTRY.json` — pinned map from artifact schema id to exact schema bytes, digest and byte count for this authority version, closed by its own digest.
- `M0A-BINDING-VALUES.json` — every identity an M0A probe package must bind to under v1.7, with no placeholders, re-derived from the running code by the validator.
- `FINDING-RESOLUTION-MATRIX-v1.7.json` — machine-readable Codex review matrix: per finding the v1.6 defect, the v1.7 correction, a negative fixture, the expected failure layer and the validation sections that prove it.
- `tools/evidence_store.py` — the executable append-only evidence store.

## Corrections

### C16-B1 — content-insensitive authority caches (BLOCKER)

Every identity-keyed cache is gone. `content_key()` derives one key from `AUTHORITY_VERSION` plus the content digests of the capability matrix, the read-primitive authority, the evidence set, the contract environment and the active authority, plus the live parser identity and the trusted-shim digest; an unserializable input yields no key and the caller recomputes. The evidence record index keyed on the evidence-set object is removed entirely: `find_records` re-derives each candidate's `record_id` from its current content on every call and orders by record id. `parser_sha256()` is memoized under a content key derived from the live parser code objects, so a replaced or patched parser is detected. Qualification results are stored as JSON text and re-parsed on return, so no caller can mutate another's remembered answer. `clear_authority_caches()` and `authority_cache_stats()` make warm/cold equality provable. The validator asserts, for nine in-place mutations of a qualified chain plus parser replacement, callable-set mutation and cross-evidence-set contamination, that **warm equals cold** and that a mutated chain is never qualified.

### C16-B2 — caller-supplied schema validators (BLOCKER)

`validate_transaction_set` and `commit_eligibility` no longer take a schema validator at all. Schemas are resolved internally from `SCHEMA-REGISTRY.json`, which is re-verified against the schema files on every resolution; one changed byte in one schema file makes the registry untrusted and nothing validates. Any extra positional argument, and any validator-, schema-, registry- or override-named keyword, is refused by name with `CALLER_SUPPLIED_VALIDATOR_REFUSED`. An unregistered artifact schema id is a refusal, not a pass. An unavailable schema engine is a refusal, not an exemption. `historical_schema_errors` validates historical artifacts against historical registries only and is INTERNAL_NON_AUTHORIZING, as is the diagnostic helper `validate_transaction_set_diagnostic`, which returns no eligibility.

### C16-B3 — unbound capture-shim trust (BLOCKER)

`TRUSTED-SHIM.json` pins the one trusted shim and `trusted_capture_shim()` re-verifies it against the shim source on disk on every resolution. `capture_shim_trust_errors` refuses any capture whose shim version, shim sha, codec or frame schema is not the trusted one, or whose method is outside the trusted allowlist; the reference parser classifies such a capture `SHIM_UNTRUSTED` in the `FATAL_TARGET_FAILURE` family. The active authority must itself carry `trusted_shim_sha256`, and a promoted matrix row binds the shim identity it rests on. The allowlist is owned by `READ-PRIMITIVES.json` (`capture_allowlist_digest`) and pinned by the trust root, so the shim can never widen it.

### C16-B4 — chain substitution (BLOCKER)

`resolve_stored_chain()` resolves the exact stored raw capture, stored derived record, current review and current reviewed refreeze record that one promoted evidence entry names, by digest. A claimed derived artifact that is absent is `DERIVED_ARTIFACT_MISSING` and is never replaced by a recomputation; a derived artifact belonging to another raw capture is `DERIVED_ARTIFACT_SUBSTITUTED` even when it recomputes identically; a review must reference the exact stored derived digest. `supersession_resolve()` makes multiplicity deterministic: none, exactly one, or CONFLICT, with explicit `supersedes` the only way one record retires another. Insertion, array and map order never decide anything. A promoted row binds the whole chain, including the refreeze block digest (the acyclic binding, since the refreeze record's id depends on the matrix digest), the probe and session, the trusted shim identity, the parser and the primitive spec.

### C16-M1 — duplicate receiver paths (M0A MAJOR)

`identity_claim_inputs()` builds each read pass as an ordered list of observations before any map exists, and `identity_claim_input_errors()` validates receiver-path uniqueness, path-to-handle-token binding, path-to-identity agreement and getter-attempt-id uniqueness before any uniqueness or stability index is constructed. A duplicate receiver path is a refusal, not a dictionary overwrite that makes the conflict disappear. Claim C now requires claim B: identity that is not unique within one pass is not identity, so its apparent stability proves nothing. Every pass must observe the same receiver-path set.

### C16-M2 — strict raw byte ingestion (M0A MAJOR)

`ingest_raw_frame(bytes)` is the one canonical boundary: strict single-object parse rejecting duplicate JSON keys, malformed UTF-8, a byte-order mark, raw control characters, invalid number syntax, the non-finite constants, trailing bytes, a second JSON value, a non-object top level, an oversized frame and an unknown schema version; then structure validation, the trusted-shim check, the content digest, and an immutable record carrying a strict-parse receipt. Every `RAW_CAPABILITY_CAPTURE` record must carry a receipt that closes over its own digest and names the exact frame bytes it was parsed from. A pre-parsed caller dictionary is not equivalent authority, because a parsed object cannot show that duplicate keys were ever rejected — and the standard parser keeps the last one.

### C16-M3 — executable append-only evidence store (M0A MAJOR)

`tools/evidence_store.py` implements the `EVIDENCE-ROOT.md` law as running code: session creation by `mkdir`, create-exclusive writes at mode 0o400, content-addressed paths derived from digests the store computes itself, idempotence only for byte-identical content, attempt-id uniqueness through exclusive marker files, atomic temp-then-hard-link writes, finalization into a self-digesting `HASHES.json` plus a `FINALIZED` marker, a closed refusal vocabulary, and `verify()` recomputing everything from the bytes on disk. `session_manifest_errors()` binds a session to the active authority, schema registry, capability matrix, trusted shim, reference parser and primitive spec. The validator attacks it in a temporary directory: session re-creation, declared-digest mismatch, attempt-id reuse, path traversal, unknown layer, symlinked session, write after finalization, re-finalization, replaced record bytes, tampered `HASHES.json`, a removed record, an unfinalized session, a partially written record and a mismatched pinned authority.

### C16-OP1 — the Hermes M0A binding closure (operational)

`M0A-BINDING-VALUES.json` publishes the raw schema id and version, the codec and ingest versions, the trusted shim version, self-hash and source hash, the capture allowlist digest, the reference parser version and hash, the primitive spec digest, the evidence store and session schema versions, the schema registry digest, the required active-authority shape and the stdout/stderr retention rule. No value is a placeholder, and the validator re-derives each one from the running code. Publishing them is not authorization to run M0A.

## Also changed

- `tools/authority_lib.py` — the corrections above, plus a faster `canon()` whose output is proven byte-identical to the retained v1.5/v1.6 reference implementation (`canon_reference`) over the whole bundle and an adversarial corpus. `CANONICALIZATION_VERSION` is unchanged: the implementation changed, the canonical text did not. New hash domains for the read-primitive authority, the evidence set, cache content keys, the schema registry, the trusted shim and its allowlist, the raw-ingest receipt, the evidence session and hashes manifests, identity claim sets, stored chains and the refreeze block.
- `tools/capture_shim_reference.py` — `raw_frame_bytes()`, the one wire format of a raw frame.
- `CAPABILITIES.json` and its schema — evidence entries bind the stored derived record, the refreeze block digest, the session and the trusted shim identity.
- `READ-PRIMITIVES.json` and its schema — `capture_allowlist_digest` and `capture_allowlist_law`.
- `schemas/resolveEvidenceSet.schema.json` — the strict-parse receipt on raw capture records; `supersedes` on review and refreeze records; the identity claim set carries its input errors and observation count.
- `tools/build_v1_7.py`, `tools/validate_v1_7.py` (new sections `cache-law`, `cache-mutation`, `validator-injection`, `schema-registry`, `shim-trust`, `stored-chain`, `identity-duplicates`, `raw-ingestion`, `evidence-store`, `canonicalization-equivalence`, `matrix-forgery-warm`, `v17-retained`, `codex-matrix`, `m0a-binding`), `tools/build_manifest.py` (parent v1.6), `tools/fixture_evidence.py` (strict-parse receipts, stored derived records in every chain, six new chain-substitution evidence sets).
- Documents extended: `RAW-CAPTURE.md`, `CAPTURE-SHIM.md`, `REVIEW-REFREEZE.md`, `IDENTITY-EVIDENCE.md`, `EVIDENCE-ROOT.md`, `M0A-PROBE-COMPATIBILITY.md`, `THREAT-MODEL.md`, `AUTHORITY-PRECEDENCE.json/.md`, `README.md`, `SCORECRAFT-EXTRACTION.md`, `PROVISIONAL.md`.

## Retained without redesign

The M0 phase model M0A/M0B/M0C/M0D and its guarantees; the H0 early write gate and its regression tests; the composed commit design (the twelve validation stages, in order, with no skippable stage) minus the caller-supplied validator; the v1.6 precedence corrections S32–S38 and the single journal-state enumeration authority; the protected-surface exclusion set; the content-bound active capability matrix; the facts-only raw capture and the versioned reference parser.

## Retired in v1.7

The `schema_validate` parameter of `validate_transaction_set` and `commit_eligibility`; every identity-keyed authority cache and the evidence-set record index; the v1.6 assumption that a promoted chain may rest on a recomputed rather than a stored derived artifact; implicit selection among multiple current reviews or refreeze records. `tools/build_v1_6.py` and `tools/validate_v1_6.py` are replaced.
