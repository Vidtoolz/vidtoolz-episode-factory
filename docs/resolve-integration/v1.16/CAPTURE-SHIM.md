# CAPTURE-SHIM.md — the M0 probe capture shim (v1.6, FROZEN_NOW as contract; reference implementation is not runtime-qualified)

Reference implementation: `tools/capture_shim_reference.py` (authority class TOOL). It is exercised by `tools/validate_v1_6.py` against **fake in-process Python objects only**; no Resolve module is imported anywhere in this bundle. An M0A driver (for example the prepared Hermes package) is conformant only if it satisfies every rule below and records its own `capture_shim_version` / `capture_shim_sha256`.

## Obligations

1. **Static allowlist.** The shim may call only the 47 methods listed under `READ-PRIMITIVES.json.logical_operations.READ_PRIMITIVE_QUALIFICATION_PROBE`. The list is a constant of the run, never assembled from a matrix, a config file or a caller argument.
2. **Refuse before invocation.** A method that is not on the allowlist, or whose base name is not a `Get*` getter, or that matches a write-like prefix (`Set`, `Create`, `Delete`, `Remove`, `Add`, `Import`, `Export`, `Append`, `Insert`, `Replace`, `Relink`, `Unlink`, `Move`, `Close`, `Save`, `Load`, `Start`, `Run`, `Execute`, `Duplicate`, `Refresh`, `Update`, `Finalize`, `Select`, `Link`, `Open`, `Apply`, `Grab`, `Stop`, `Play`, `Cut`, `Copy`, `Paste`, `Lock`, `Unlock`, `Clear`, `Reset`, `Rename`), or that names a script/render tool (`run_script`, `run_script_unsafe`, `execute_python`, `execute_lua`, `StartRendering`, `AddRenderJob`), is recorded as `outcome: REFUSED` with `invoked: false` **and is not called**. This holds even if such a name is wrongly present in the allowlist.
3. **No dynamic dispatch of instance overrides.** If the attribute is an instance-level override rather than the class method (a monkeypatch indicator), the call is `REFUSED`.
4. **Record, never classify.** The shim writes the mechanical outcome and the typed facts of `RAW-CAPTURE.md` §1. It MUST NOT write success, qualification, expected-type agreement, shape verdicts, review or promotion fields (`RAW-CAPTURE.md` §2), and MUST NOT normalize a failure into a benign value (an empty return is an empty return, not "success with an empty list").
5. **Never touch authority.** The shim MUST NOT read, write or consult `CAPABILITIES.json`, MUST NOT produce a review or a refreeze, MUST NOT write a snapshot, MUST NOT call `eval`, `exec`, `compile` or any Resolve script tool, and MUST NOT retry a call silently (a second attempt is a second capture with its own `getter_attempt_id`).
6. **Timeout, not hang.** Every call runs under a timeout; expiry is `outcome: TIMEOUT` with `timeout_ms`.
7. **Serialize deterministically or refuse.** The typed codec of `RAW-CAPTURE.md` §3 with recorded limits; anything it cannot express is `UNSERIALIZABLE`.
8. **Seal.** Every capture is sealed with `raw_digest` before it leaves the process, and written to the append-only evidence root (`EVIDENCE-ROOT.md`) under a content-addressed name.
9. **Identify itself.** `capture_shim_version` and `capture_shim_sha256` (hash of the shim source) are part of every capture, therefore part of every downstream digest. A substituted shim changes every raw digest, so a refreeze made under the old shim cannot cover captures made by a new one without a new review.
10. **Stop on a fatal target mismatch.** If the observed host, product, version, build, library uuid/root, session or the active manifest/authority disagrees with the contract, the run stops. The corresponding captures derive `BINDING_MISMATCH`, whose family is `FATAL_TARGET_FAILURE`, and the session's derived attachment state becomes `CONFLICT`.

## Non-obligations

The shim does not decide which getters are worth calling (the probe contract does), does not decide the order beyond recording it, does not judge a return value, and has no authority whatsoever. A compromised shim can only produce captures that the reference parser will classify and a human reviewer will inspect; it cannot produce a qualification, because qualification requires digests it cannot compute in its own favour (a review by another identity and a refreeze approved by Mikko).

## v1.7: the shim identity is now enforced (Codex C16-B3)

In v1.6 a capture recorded `capture_shim_version` and `capture_shim_sha256` and nothing compared them to anything, so
a capture declaring any shim hash qualified. v1.7 pins the one trusted shim in `TRUSTED-SHIM.json` and enforces it on
every capture. The normative law is `TRUSTED-SHIM.md`; the short form is:

- the recorded shim version and shim sha256 must equal the pinned ones, which are re-verified against the shim source
  file's bytes on every resolution;
- the serialization codec and the raw frame schema must be the pinned ones;
- the method must be inside the allowlist whose digest the trust root pins, and that allowlist is owned by
  `READ-PRIMITIVES.json`, not by the shim;
- a capture failing any of these is classified `SHIM_UNTRUSTED`, a fatal class, and can never be reviewed or promoted;
- the active authority must itself name the trusted shim digest, and a promoted matrix row records which shim its
  evidence came from.

`raw_frame_bytes()` is the shim's one wire format for a frame, and the evidence store addresses RAW records by the
sha256 of exactly those bytes.

## v1.8: the shim has no storage authority (Codex ES-2)

v1.6 and v1.7 carried an `EvidenceRoot` class in `tools/capture_shim_reference.py`: a second evidence-storage
implementation with its own layout, its own path construction and no verification or finalization law. Its four write
methods each built a filesystem path by interpolating a caller-supplied string, so `add_capture`, `add_derived`,
`add_review` and `add_refreeze` all wrote outside the evidence root when given `../../x`.

It is **removed**. This module captures facts and serializes frames. It creates no directory, derives no evidence path
and writes no evidence.

A driver captures with `capture()`, serializes the frame with `raw_frame_bytes()`, and hands the **bytes** to the one
storage authority:

```python
import evidence_store as ES
store = ES.create_session(root, session_id, ES.session_manifest(...))
store.put_raw(attempt_id, raw_frame_bytes(capture), logical_identity=method)
store.put_derived(attempt_id, derived_obj, logical_identity=method)
store.put_review(attempt_id, review_obj, logical_identity=review_id)
store.put_promotion(attempt_id, refreeze_obj, logical_identity=refreeze_id)
store.finalize()
```

No call there takes a path. See `EVIDENCE-ROOT.md`.
