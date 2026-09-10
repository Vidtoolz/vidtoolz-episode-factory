# TRUSTED-SHIM.md — the one capture shim a promotable capture may come from (v1.7, FROZEN_NOW)

Correction of Codex v1.6 BLOCKER **C16-B3**: *the capture-shim digest is not bound to an exact trusted authority; a
wrong shim SHA can still qualify.*

## What went wrong in v1.6

Every `RAW_CAPABILITY_CAPTURE` carried `capture_shim_version` and `capture_shim_sha256`. Nothing ever compared them to
anything. A capture declaring `capture_shim_sha256: 0000...0` was promoted to `QUALIFIED_CALLABLE` exactly like an
honest one. The fields recorded a claim about provenance and enforced nothing, which is the same failure shape as a
probe writing its own success flag: the artifact asserted its own trustworthiness.

## The v1.7 law

`TRUSTED-SHIM.json` is a pinned trust root of this bundle:

| field | meaning |
|---|---|
| `shim_version` | the version string a trusted capture must carry |
| `shim_sha256` | the shim's own identity hash, over the source of its capture, encoder, write-guard and call-parsing functions |
| `shim_source_path` | `tools/capture_shim_reference.py` |
| `shim_source_sha256` | sha256 of that file's exact bytes as frozen |
| `allowlist_digest` | canonical digest of the getter allowlist the shim may invoke |
| `allowlist_method_count` | how many methods that allowlist holds |
| `codec_version` | the only value codec a trusted capture may be serialized with |
| `raw_schema_version` | the only raw frame schema a trusted capture may declare |
| `raw_ingest_version` | the strict byte-ingestion boundary those frames must have passed |
| `trusted_shim_sha256` | the digest of everything above |

`trusted_capture_shim()` re-verifies all of it on every resolution: the record's own digest, the pinned authority
version, the shim source file's bytes against `shim_source_sha256`, the loaded shim module's own `shim_sha256()`
against `shim_sha256`, and the codec, raw schema and ingest versions against the constants this library implements.
Any mismatch raises `AuthorityTrustError` and nothing can be authorized while it stands.

1. **A capture qualifies only under the trusted shim.** `capture_shim_trust_errors` refuses a capture whose recorded
   shim version, shim sha256, serialization codec or frame schema is not the trusted one, and refuses a capture of a
   method outside the trusted allowlist.
2. **The reference parser classifies an untrusted capture `SHIM_UNTRUSTED`.** That class is in the closed derived
   vocabulary, in the `FATAL_TARGET_FAILURE` family. A reviewer can never accept it, and a refreeze can never promote
   it, for the same reason a binding mismatch stops a probe: the session's provenance is wrong, not just this getter.
3. **The active authority names the trusted shim.** `active.trusted_shim_sha256` is required and must equal the
   pinned trusted-shim digest. An active authority that omits it, or names a different shim, authorizes nothing
   (`TRUSTED_SHIM_NOT_ACTIVE`).
4. **A promoted matrix row binds the shim identity.** The row's evidence entry carries `capture_shim_version`,
   `capture_shim_sha256` and `trusted_shim_sha256`, so a promotion records which shim produced the evidence and cannot
   be re-read later under a different one.
5. **The allowlist belongs to the authority, not the shim.** It is derived from the probe-allowed primitives of
   `READ-PRIMITIVES.json`, published there as `capture_allowlist_digest`, and pinned by the trust root. The shim can
   never widen it, because the shim does not own it.

## Attacks this refuses

Right version with a wrong sha; a stale shim build; an unknown third-party shim; the same version with one added
comment in the source; a capture serialized under another codec; a capture declaring another raw frame schema; a
capture of a method outside the allowlist; an active authority that omits or misnames the trusted shim; and a whole
otherwise-coherent chain resting on any of those.

## What this does not claim

The trust root proves that a capture claims the identity of the shim this bundle froze. It does not prove that the
shim ran, that Resolve was present, or that the returned value is true. No shim has been run against Resolve. M0A is
not authorized by this document.
