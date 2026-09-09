# REFERENCE-PARSER.md — deriving meaning from a raw capture (v1.7, FROZEN_NOW; not runtime-qualified)

`authority_lib.derive_capability_result(capture, primitive_spec, contract_env, active_authority) -> DERIVED_CAPABILITY_RESULT`.

**Parser identity.** `parser_version = vidtoolz.resolveProbeParser.v1`; `parser_sha256 = sha256(source of derive_capability_result + codec_errors + codec_broad_type + codec_contains_elision + _capture_structure_errors + parser_version)`. Every review, every refreeze, every matrix evidence entry and the matrix refreeze block bind both. A changed parser is a new authority version: it invalidates promotions made under the old one instead of silently reclassifying them.

**Inputs and nothing else.** The immutable capture body, the primitive spec (`PRIMITIVE-SPEC.md`), the contract environment and the active authority. No probe-authored field is an input; none exists.

## Derivation order (total, first match wins)

| # | Check | Class |
|---|---|---|
| 1 | structural law of `RAW-CAPTURE.md` §1–§3, forbidden fields absent, `raw_digest` re-hashes, codec structurally valid | `MALFORMED` |
| 2 | `authority_version`, `manifest_sha256` equal the active authority; `host_name`, `product`, `resolve_version`, `build` equal the contract environment | `BINDING_MISMATCH` (family `FATAL_TARGET_FAILURE`) |
| 3 | mechanical outcome: `RAISED` → `EXCEPTION`; `TIMEOUT` → `TIMEOUT`; `ATTRIBUTE_MISSING` → `UNSUPPORTED`; `TRANSPORT_FAILURE`, `REFUSED`, `UNSERIALIZABLE` → the same class | as shown |
| 4 | the capture's `method` is the spec's method; `receiver.class` equals the spec receiver; the codec broad types of `args` equal the spec `arg_types` | `MALFORMED` / `RECEIVER_MISMATCH` / `ARGS_MISMATCH` |
| 5 | the returned value was truncated or elided while the spec requires `COMPLETE` | `TRUNCATED` |
| 6 | the value is `none` and the spec is not `nullable` | `NULL_NOT_ALLOWED` |
| 7 | the codec broad type differs from `expected_type`, or the value is a non-finite float | `TYPE_MISMATCH` |
| 8 | `shape_rule: NON_EMPTY` and the value is an empty string/list/mapping | `TYPE_MISMATCH` |
| 9 | otherwise | `SUCCESS` |

Closed class vocabulary (`authority_lib.DERIVED_CLASSES`): `SUCCESS`, `EXCEPTION`, `TIMEOUT`, `UNSUPPORTED`, `MALFORMED`, `BINDING_MISMATCH`, `RECEIVER_MISMATCH`, `ARGS_MISMATCH`, `TYPE_MISMATCH`, `NULL_NOT_ALLOWED`, `TRUNCATED`, `TRANSPORT_FAILURE`, `REFUSED`, `UNSERIALIZABLE`. Each maps to a family (`SUCCESS`, `EXCEPTION`, `TIMEOUT`, `UNSUPPORTED`, `MALFORMED`, `TRANSPORT_FAILURE`, `FATAL_TARGET_FAILURE`, `FAILURE`) used by the probe failure law; a `FATAL_TARGET_FAILURE` family stops the run, every other non-`SUCCESS` class is reviewed `REJECT` and the run continues.

## Output and the cache rule

```
{ schema, parser_version, parser_sha256, raw_capture_sha256, spec_digest, method, receiver_class,
  expectation_status, classification, family, facts { outcome, python_type, broad_type, truncated, null, length, exception_class },
  reasons[], derived_result_sha256 }
```

A `DERIVED_CAPABILITY_RESULT` record may be stored, but it is **only a cache**: every validator recomputes the derivation from the capture and requires byte equality (`semantic_derived_result_record`). A stored result that differs — because it was forged, or because the parser or the spec has moved on — is rejected, never trusted. Nothing downstream reads a stored derived result without recomputing it.

## Consequence for the v1.5 defect

A capture whose outcome is `RAISED` derives `EXCEPTION` no matter what any other document, record, label or reviewer says. An externally supplied "successful parse" object is not an input; injected into the capture it makes the capture `MALFORMED`. `ACCEPT` is invalid over a non-`SUCCESS` derivation, a refreeze cannot promote a non-`SUCCESS` derivation, and `primitive_status` recomputes the derivation on every call — so `QUALIFIED_READ` is unreachable for a failed getter (Codex F15-01, Claude M-RAW).
