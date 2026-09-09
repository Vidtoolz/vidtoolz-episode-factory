# FINDING RESOLUTION MATRIX — Codex v1.6 adjudication answered in v1.7

The machine-readable form of this table is `FINDING-RESOLUTION-MATRIX-v1.7.json`. `validate_v1_7.py` reads that file,
requires it to enumerate exactly these seven ids, and fails unless every validation section named by every finding
exists and passes. The counts below come from `VALIDATION-REPORT.md` of the same run.

| id | severity | Codex finding | v1.7 correction | negative fixture | expected failure layer |
|---|---|---|---|---|---|
| C16-B1 | BLOCKER | content-insensitive authority caches keep stale or modified state qualified | no cache key may be an object identity; one content key per evaluation; identity-keyed record index removed; parser identity keyed on live code; warm equals cold | nine in-place mutations of a qualified chain, plus parser replacement, callable-set mutation and cross-set contamination | capability (`capability_qualification`, `callable_method_set`) |
| C16-B2 | BLOCKER | caller-supplied schema validators authorize invalid artifacts | no validator parameter anywhere on the authorizing surface; internally pinned `SCHEMA-REGISTRY.json`; refusal by argument name | five injected validators across both entry points and both call forms, five validator-named keywords, one changed schema byte | schema (composed stage 3) |
| C16-B3 | BLOCKER | a wrong capture-shim SHA still qualifies | `TRUSTED-SHIM.json` pins the one trusted shim and is re-verified against the source; `SHIM_UNTRUSTED` is a fatal derived class; the active authority names the trusted shim | wrong sha, stale build, unknown shim, same version with changed code, other codec, other frame schema, method outside the allowlist | capability (reference parser and record law) |
| C16-B4 | BLOCKER | derived, review and refreeze substitutions can authorize | `resolve_stored_chain` resolves the exact stored artifacts by digest; `supersession_resolve` makes multiplicity a CONFLICT unless explicit supersession leaves one | six chain-substitution evidence sets plus entry-field-dropping and derived-record substitution | capability (stored-chain resolution) |
| C16-M1 | MAJOR | duplicate receiver paths overwrite identity observations | ordered claim inputs validated for path, handle-token and attempt-id uniqueness before any index; claim C requires claim B | duplicate path, two handle tokens, two identity values, duplicate attempt id, two paths one id, pass-set mismatch | capability (identity evidence) |
| C16-M2 | MAJOR | no strict byte-level ingestion; a parsed object hides duplicate keys | `ingest_raw_frame(bytes)` is the one boundary; every raw record carries a strict-parse receipt | thirteen malformed frames, each with its own closed refusal code, plus missing, mis-bound and non-strict receipts | raw parse (byte boundary) |
| C16-M3 | MAJOR | the append-only evidence root is prose, not executable authority | `tools/evidence_store.py` implements and the validator attacks it | fifteen store attacks plus a static audit that no path opens a record for writing, truncates, renames over one or unlinks one | evidence store (byte layer) |
| C16-OP1 | OPERATIONAL | Hermes M0A cannot bind to v1.6 | `M0A-BINDING-VALUES.json` publishes every identity with no placeholder | every value re-derived from the running code | operational (binding closure) |

## What is still not closed

- No probe has run. Every capture in this bundle was produced by the reference shim against fake in-process objects.
- Nothing here is human approval of M0A, M0B, M0C or M0D, and none of the four phases implies the next.
- The residual risks named in `THREAT-MODEL.md` remain open; v1.7 adds executable controls, not proof of operation.
- A second implementation in another language has not been written, so the canonicalization, ingestion and store laws
  are proven only against this bundle's own reference implementation.
