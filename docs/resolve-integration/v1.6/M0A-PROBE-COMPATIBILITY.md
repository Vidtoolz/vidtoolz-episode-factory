# M0A-PROBE-COMPATIBILITY.md — what an M0A driver must satisfy before it may run (v1.6, FROZEN_NOW as contract; no probe is authorized)

Applies to any prepared M0A driver, including the package at `~/outputs/resolve-m0a-probe-preparation/` (inspected read-only, never executed, not certified by this bundle). Captures that do not satisfy §1 cannot be transformed into `RAW_CAPABILITY_CAPTURE` records later, so a run made without these changes would have to be repeated.

## 1. MUST CHANGE BEFORE THE PROBE RUNS

| # | Requirement | Why a later transformation cannot fix it |
|---|---|---|
| 1 | **Typed codec** (`RAW-CAPTURE.md` §3) for every return value and argument, instead of `repr()`, `json.dumps()` text or a `sample_keys` excerpt | `repr` of a Resolve object yields only an address (the class is lost); JSON text loses int/float/bool/None and bigint distinctions; a key excerpt drops content with no digest of the whole value |
| 2 | **Receiver navigation path** (plus handle token and runtime type) per capture | which timeline/item/folder the call was made on cannot be reconstructed afterwards, and `RECEIVER_MISMATCH` becomes uncheckable |
| 3 | **Typed arguments** | `"True"`, `"video"`, `"1"` as strings are ambiguous, so `ARGS_MISMATCH` becomes uncheckable |
| 4 | **Explicit mechanical outcome** from the closed set (`RETURNED`, `RAISED`, `TIMEOUT`, `ATTRIBUTE_MISSING`, `TRANSPORT_FAILURE`, `REFUSED`, `UNSERIALIZABLE`) | timeout, missing attribute, transport failure and refusal are otherwise indistinguishable from "no record" |
| 5 | **Explicit truncation facts**: `truncated`, `elided_paths`, the applied depth/length/string limits, and a full-value digest for a truncated string | a silently truncated value cannot be told apart from a complete one, so `TRUNCATED` becomes uncheckable |
| 6 | **Capture shim identity**: `capture_shim_version` and `capture_shim_sha256`, hashed **before** the run | the producer of the evidence would be unknown, and a substituted driver would be invisible |
| 7 | **No interpretation in the capture layer**: remove any `parse_result` block (including placeholder fields) and any rule that records an empty return, a `None` or an exception as a success | such a field is schema-forbidden in v1.6; a capture carrying it is `MALFORMED`, and the wording invites exactly the defect this bundle corrects |

## 2. Already compatible (no change needed)

Method name from the static allowlist; receiver class; `python_type` of the return; exception class/message (traceback as an opaque attachment digest); `session_id`; `authority_version`, `manifest_sha256`, `probe_id`; `captured_at` and duration; content addressing by sha256 over a canonical body; append-only evidence root outside `/tmp` with a hash list; the intent that failures are preserved rather than normalized.

## 3. Transformable later (derivable from other durable records of the same session)

`is_null` (the codec `none` tag); library uuid/root per record (from the session's connection observation); observed host/product/version/build per record (from the same session's connection observation, provided it records the **observed** values); `sequence` / `getter_attempt_id` (from a durable hashed run journal); operator identity (from the session manifest); content-addressed file names; the identity A/B/C claims — **provided** every identity read is captured individually with its receiver path.

## 4. Open until an independent reviewer decides

Whether `stdout_sha256` / `stderr_sha256` may be null (v1.6 permits null and treats the streams as opaque forensic attachments), and whether the derived class set and check order of `REFERENCE-PARSER.md` are accepted as final.

## 5. Conformance statement required of a driver

Before an M0A run, the driver's own package must state: the shim source hash it will record; that the allowlist is exactly the 47 methods of `READ-PRIMITIVES.json`; that it writes no interpretation field; that it stops on a fatal target mismatch; where its append-only evidence root is; and who the operator is (so that the reviewer can be someone else).
