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

## v1.7: the binding values are now published (Codex operational finding C16-OP1)

Codex's operational finding was that the Hermes M0A package could not be bound to v1.6 because the trusted shim,
parser, spec and raw identities were not operationally closed. `M0A-BINDING-VALUES.json` closes them. It carries no
placeholders, and `validate_v1_7.py` section `m0a-binding` re-derives every value from the running code and fails if
any differs or reads as a placeholder.

Published there, and required of any M0A package:

- `raw_schema_id`, `raw_schema_version`, `codec_version`, `raw_ingest_version`, `raw_frame_max_bytes`
- `trusted_shim_version`, `trusted_shim_sha256`, `trusted_shim_source_path`, `trusted_shim_source_sha256`,
  `trusted_shim_authority_sha256`
- `capture_allowlist_digest`, `capture_allowlist_method_count`
- `reference_parser_version`, `reference_parser_sha256`, `primitive_spec_sha256`
- `evidence_store_version`, `evidence_session_schema`, `evidence_hashes_schema`, `evidence_layers`
- `schema_registry_sha256`, `schema_registry_file`, `trusted_shim_file`, `authority_version`
- `stdout_retention`, `stderr_retention`

**The active authority shape.** Every authorizing call takes an active authority of exactly
`{authority_version, manifest_sha256, capability_matrix_sha256, trusted_shim_sha256}`. A package that omits
`trusted_shim_sha256`, or names a shim other than the pinned one, authorizes nothing.

**`manifest_sha256` is read at probe time.** It is deliberately absent from `M0A-BINDING-VALUES.json`, because
embedding this bundle's own manifest digest inside a file the manifest covers would prevent the
build-validate-manifest-validate cycle from converging. Read it from `FREEZE-MANIFEST.json`.

**stdout and stderr.** Never inlined into a frame. When a getter attempt produces either stream, store the exact bytes
as their own content-addressed record in the RAW layer of the session and put only the digest in the frame; when
nothing was captured, both fields are null and the retention rule is `NOT_CAPTURED`. There is no truncated copy.

**What publishing these values is not.** It is not authorization to run M0A, not a certification of any driver, and
not a claim that any of these identities has ever been exercised against Resolve. It is the list of things a package
must bind to before an independent reviewer can even assess it.

## v1.8: the evidence-store binding (Codex ES-1 / ES-2)

The M0A package expects append-only evidence behaviour. v1.8 makes that behaviour singular and closed-world, so the
package must bind to these values, all published in `M0A-BINDING-VALUES.json` and re-derived from the running code by
`validate_v1_8.py`:

| field | meaning |
|---|---|
| `evidence_store_version` | `vidtoolz.resolveEvidenceStore.v2` — the store law this package runs under |
| `evidence_session_schema` | `vidtoolz.resolveEvidenceSession.v2` — the pinned session manifest |
| `evidence_inventory_schema` | `vidtoolz.resolveEvidenceInventory.v1` — the finalization receipt |
| `evidence_layers` | `RAW, DERIVED, HUMAN_REVIEW, AUTHORITY_PROMOTION` |
| `evidence_store_module` | `tools/evidence_store.py` — the canonical store tool path |
| `evidence_store_sha256` | the sha256 of that file as frozen |
| `evidence_store_authority_class` | `EVIDENCE_STORE_AUTHORIZING` — exactly one module carries it |
| `closed_world_verification` | a finalized session is a closed world; verification requires missing == 0, unexpected == 0, changed == 0 |
| `path_identifier_constraints` | `^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$` — every attempt id and logical identity |

### Three things an M0A package must change from v1.7

1. **Do not construct evidence paths.** Call `put_raw` / `put_derived` / `put_review` / `put_promotion` with an attempt
   id, content and a logical identity. There is no path parameter, and the legacy `EvidenceRoot` surface is removed.
2. **Finalize.** A session that is not finalized is not an evidence package. Finalization writes `INVENTORY.json` and
   the `FINALIZED` marker; `verify()` must then return no errors.
3. **Keep the session closed.** After finalization, do not add logs, notes, scratch files or directories anywhere under
   the session root. Any extra entry invalidates the whole session. Put run logs outside the evidence root.

Publishing these values is not authorization to run M0A, and no driver is certified by this bundle.

## v1.9: the evidence-store binding changes (Codex S19-1 … S19-4)

Everything v1.8 published stays, except the values below. All are in `M0A-BINDING-VALUES.json` and re-derived from the
running code by `validate_v1_9.py`.

| field | v1.9 value or law |
|---|---|
| `evidence_store_version` | `vidtoolz.resolveEvidenceStore.v3` |
| `evidence_session_schema` | `vidtoolz.resolveEvidenceSession.v3` |
| `evidence_inventory_schema` | `vidtoolz.resolveEvidenceInventory.v2` |
| `evidence_finalization_schema` | `vidtoolz.resolveEvidenceFinalization.v1` |
| `evidence_store_platform_scope` | `POSIX` |
| `session_path_identity_law` | the session directory basename IS the session id, exactly; any rename is `SESSION_PATH_MISMATCH` |
| `session_identity_tuple` | the sixteen fields digested into `session_identity_sha256` |
| `attempt_tuple_law` | uniqueness key is `(session_id, layer, logical_identity, attempt_id)` bound to the record bytes |
| `record_key_law` | a record's storage name is sha256 over (session id, layer, logical identity, content digest) |
| `mode_metadata_law` | POSIX file type and permission mode are frozen per entry; no inode, timestamp or owner |
| `root_symlink_refusal_law` | root and session entries are `lstat`-inspected before any resolution |
| `verification_counters` | PASS requires missing, unexpected, changed and semantic_mismatch all zero |

### What an M0A package must change from v1.8

1. **Pass a logical identity on every write.** `put_raw`, `put_derived`, `put_review` and `put_promotion` now require
   one. For a capture, the natural logical identity is the primitive method.
2. **Do not reuse an attempt id across layers or identities.** One getter attempt produces one record in one layer
   under one logical identity. Derive a distinct attempt id per layer.
3. **Do not rename or relocate a session directory.** The basename is the session id and is part of the frozen
   identity.
4. **Do not chmod anything inside a finalized session.** Modes are frozen metadata.
5. **Do not place the evidence root behind a symlink.** The root and the session entry must be real directories.

Publishing these values is not authorization to run M0A, and no driver is certified by this bundle.

## v1.10: the evidence-store binding deltas (Codex S110-1 … S110-5)

Everything v1.9 published stays except the values below. All are in `M0A-BINDING-VALUES.json` and re-derived from the
running code by `validate_v1_10.py`.

| field | v1.10 value or law |
|---|---|
| `evidence_store_version` | `vidtoolz.resolveEvidenceStore.v4` |
| `evidence_session_schema` | `vidtoolz.resolveEvidenceSession.v4` |
| `evidence_boundary_schema` | `vidtoolz.resolveEvidenceBoundary.v1` |
| `evidence_inventory_schema` | `vidtoolz.resolveEvidenceInventory.v3` |
| `evidence_finalization_schema` | `vidtoolz.resolveEvidenceFinalization.v2` |
| `boundary_receipt_file` | `BOUNDARY.json` |
| `boundary_receipt_law` | persisted at creation as governed evidence, re-checked before every authorizing operation |
| `root_session_identity_law` | the session identity tuple includes the boundary identity digest |
| `attempt_marker_derivation_law` | markers and records reconcile as a bijection; attempt ids unique as well as attempt keys |
| `active_integrity_law` | `active_integrity()` must be clean before any write and before finalize |
| `mode_authority_law` | expected mode derived from KIND, covers the session directory, enforced from creation |
| `filesystem_refusal_vocabulary` | the frozen `FS_*` classes |
| `inventory_field_provenance_file` | `INVENTORY-FIELD-PROVENANCE.json` |

### What an M0A package must change from v1.9

1. **Do not move, copy or re-root a session.** The boundary receipt binds the root and the session directory; a copy
   under another root is a different session and will not verify.
2. **Do not write into a session out of band.** Foreign markers and orphaned records now block the next operation, not
   just the final verification.
3. **Do not chmod anything at any time**, including the session directory and while the session is ACTIVE.
4. **Expect frozen `FS_*` refusals** instead of platform exceptions, and handle them as authority results.

Publishing these values is not authorization to run M0A, and no driver is certified by this bundle.
