# RAW-CAPTURE.md — canonical raw capability capture format (v1.6, FROZEN_NOW as contract; nothing has run)

Machine form: `schemas/resolveEvidenceSet.schema.json` record type `RAW_CAPABILITY_CAPTURE` (capture body `vidtoolz.resolveRawCapabilityCapture.v1`), reference producer `tools/capture_shim_reference.py`, reference consumer `tools/authority_lib.py#derive_capability_result`.

**A capture records what mechanically happened. It never records what it means.** The party that runs the getter (the probe) and the party that decides whether the getter works (the reference parser + a human reviewer + a refreeze) are separated by content-addressed evidence. This replaces the v1.5 arrangement in which the probe wrote both the raw text and its own `parse`/`result` block (superseded statement S32).

## 1. Record shape

One capture per **getter attempt** (one method, one receiver, one argument tuple). `capture` is the sealed body; `raw_capture_sha256` (the record field) equals `capture.raw_digest = sha256("vidtoolz.resolveRawCapabilityCapture.v1" + 0x0A + canonical(body without raw_digest))`. The record is envelope-bound (SESSION level) and content-addressed like every evidence record, so the envelope and the capture cannot disagree without changing both digests.

| Group | Fields | Meaning |
|---|---|---|
| run identity | `probe_id`, `getter_attempt_id`, `sequence` (≥1, strictly increasing within the run), `captured_at`, `operator` | which run, which attempt, in which order, by whom |
| authority binding | `authority_version`, `manifest_sha256` | the exact reviewed authority the run was executed under |
| environment | `host_name`, `product`, `resolve_version`, `build` | **as observed at capture time**, copied verbatim, never from the contract |
| target | `session_id`, `library_uuid`, `library_root` | the isolated qualification session and library |
| receiver | `receiver.class` (one of the eight known classes), `receiver.path` (the deterministic navigation actually used, e.g. `...->GetCurrentProject()->GetTimelineByIndex(1)->GetItemListInTrack('video',1)[0]`), `receiver.handle_token` (process-local), `receiver.runtime_type` | which object the call was made on |
| call | `method` (exact name from the probe allowlist; an argument-bearing variant such as `GetStart(True)` is a separate method), `args` (typed codec values, `[]` for none) | the exact call |
| outcome | `outcome` ∈ `RETURNED \| RAISED \| TIMEOUT \| ATTRIBUTE_MISSING \| TRANSPORT_FAILURE \| REFUSED \| UNSERIALIZABLE` | the only interpretation the shim makes, and it is mechanical: which Python control path ended the call |
| outcome payload | exactly one of `returned {python_type, value}`, `raised {exception_class, module, message}`, `timeout_ms` (integer), `transport {reason}`, `refused {reason, invoked:false}`, `unserializable {python_type, reason, path, repr_sha256}`; `ATTRIBUTE_MISSING` carries none | the facts of that path |
| serialization | `serialization {codec, depth_limit, length_limit, string_limit, truncated, elided_paths}` | what the codec did, including every elision |
| streams | `stdout_sha256`, `stderr_sha256` (nullable) | forensic digests; the streams themselves are opaque `RAW_EVIDENCE`, never parsed for meaning |
| timing | `duration_ms` (nullable) | wall time of the call |
| producer | `capture_shim_version`, `capture_shim_sha256` | identity of the shim that produced the capture (`CAPTURE-SHIM.md`) |

## 2. Forbidden fields (schema-enforced, `authority_lib.FORBIDDEN_RAW_FIELDS`)

`success`, `qualified`, `reviewed`, `expected_type_match`, `classification`, `parse`, `parsed_observation`, `result`, `decision`, `promotion`, `promoted`, `shape_ok`, `observed_type`.

A capture carrying any of them is `MALFORMED` (the parser refuses it) **and** schema-invalid (the evidence set refuses it). There is no writable field anywhere in the capture that a compromised or buggy probe could set to make a failure look like a success.

## 3. Typed value codec `vidtoolz.resolvePyValue.v1`

Every captured Python value is tagged. Reference implementation: `tools/capture_shim_reference.py#Encoder`; structural validator: `authority_lib.codec_errors`.

| Tag | Payload | Notes |
|---|---|---|
| `str` | `v`; on truncation `truncated:true`, `full_len`, `full_sha256` | truncation is a recorded fact with a digest of the whole value |
| `int` | `v` (safe integer) | `bool` is never an `int` |
| `bigint` | `v` decimal string | beyond ±(2^53−1) |
| `bool` | `v` | |
| `none` | — | distinct from every empty container |
| `f64` | `v` = 16 lowercase hex (IEEE-754 binary64 big-endian) | negative zero is preserved as `8000000000000000` (a capture records truth; the *canonical record* law that normalizes `-0` applies to authored documents, not to observed values) |
| `f64_nonfinite` | `v` ∈ `nan \| +inf \| -inf` | never coerced to a number |
| `bytes` | `len`, `sha256`, `head_hex` | content is never inlined |
| `list` | `py` ∈ `list \| tuple`, `v` | tuple and list stay distinguishable |
| `dict` | `v` = array of `[key, value]` pairs in canonical key order | key order never changes the encoding |
| `object` | `class`, `module`, `handle_token`, `repr_sha256` | opaque handle descriptor; the parser never dereferences it and it is **not** an identity claim. Tokens are process-local and assigned in first-seen order; the shim retains a reference to every tokenized object, so one token always denotes one object and the tokens depend on call order, not on memory reuse |
| `elided` | `reason` ∈ `depth \| length`, `py`, `len`, `omitted` | the only way information may be dropped, and it is always visible |

Values the codec cannot express faithfully — cycles, callables, modules, classes, unencodable mapping keys — are **not guessed**: the shim records `outcome: UNSERIALIZABLE` with the reason, the path and a `repr` digest.

## 4. Reusability law (capture once, re-parse forever)

A capture must contain everything a *future* parser or a corrected expectation needs, so that refining the parser or a primitive spec never requires calling Resolve again:

- the exact call (method, receiver class **and** navigation path, typed arguments);
- the complete typed return value, or an explicit elision record with the full-value digest;
- the exception class/module/message, or the timeout, or the missing attribute, or the transport failure, or the refusal — whichever happened;
- the observed environment and target, so the capture can never be replayed as evidence for another host, build, library or session;
- the codec limits actually applied and every elided path;
- the producer identity (shim version + source hash) and the operator.

It must **not** contain more than that: no media bytes, no full stdout/stderr text inside the record (digests only), no screen contents, no credentials, no host diagnostic paths, no repr of an opaque object beyond its digest. Breadth is bounded by the 47-method allowlist and the codec limits, not by "capture everything".

## 5. What a capture is not

A capture is not evidence that a capability works. `PROBE_ALLOWED != QUALIFIED_READ`; a capture is `CANDIDATE` until the reference parser derives `SUCCESS`, a reviewer other than the operator ACCEPTs exactly that raw+derived pair, and a reviewed refreeze promotes exactly those digests into a successor capability matrix whose content digest becomes the active authority (`REVIEW-REFREEZE.md`, `M0-PHASES.md`).
