# EVIDENCE-ROOT.md — append-only evidence layout for an M0 run (v1.6, FROZEN_NOW as contract)

Reference implementation: `tools/capture_shim_reference.py#EvidenceRoot`.

```
<evidence root>/                     # a durable local directory, never /tmp, /var/tmp or a cleanup-prone path
  SESSION.json                       # session manifest: probe id, session id, authority version, manifest sha, host,
                                     # product/version/build, library uuid/root, operator, shim version + sha
  RAW/<raw_digest>.raw.json          # RAW_CAPABILITY_CAPTURE bodies, content-addressed
  DERIVED/<raw_digest>.derived.json  # recomputable cache of the reference parser's output
  HUMAN_REVIEW/<record_id>.review.json      # REVIEW_DECISION records
  AUTHORITY_PROMOTION/<record_id>.refreeze.json  # REFREEZE_RECORD records
  HASHES.json                        # path -> sha256 of every file written
  FINALIZED.json                     # written last; after it no further write is permitted
```

## Rules

1. **Append-only.** Files are created with an exclusive atomic create (`O_EXCL`, read-only mode, fsync, link, unlink of the temporary name). An existing path is never overwritten: an attempt raises.
2. **Content-addressed names.** A capture's file name is its `raw_digest`; a review's and a refreeze's file name is its `record_id`. Two different contents can never occupy one name, and one content can never be written twice under two names.
3. **One attempt, one record.** A duplicate `getter_attempt_id` is refused, so a silent retry cannot overwrite or duplicate a capture.
4. **No deletion, no normalization.** Failed captures, refusals, timeouts and unserializable returns are preserved exactly as recorded. Nothing may be "cleaned up", re-run over the top, or replaced by a normalized success.
5. **Finalization.** `HASHES.json` and `FINALIZED.json` close the root; later writes are refused. The M0 evidence package is the finalized root plus its mirror.
6. **Separation of layers.** RAW is produced by the shim, DERIVED by the reference parser, HUMAN_REVIEW by a reviewer who is not the operator, AUTHORITY_PROMOTION by the refreeze that Mikko approves. A layer never writes into another layer's directory.
7. **Journal.** The run also appends to the read-only journal named by the session's `READ_ONLY_JOURNAL` record; the journal proves that no mutator was called.

## v1.7: this layout is now executable authority (Codex C16-M3)

Codex's finding was that everything above is prose. Nothing in v1.6 could be **run** to prove that an evidence root
refuses an overwrite, a reused attempt id, a record written after finalization, or a record replaced afterwards.

`tools/evidence_store.py` is that law as running code, and `validate_v1_7.py` attacks it in a temporary directory on
every run. The layout it creates:

```
<root>/<session id>/
  SESSION.json                     # the pinned session manifest, written once, mode 0o444
  RAW/<aa>/<digest>.json           # content-addressed records, mode 0o400, sharded by the first two hex digits
  DERIVED/<aa>/<digest>.json
  HUMAN_REVIEW/<aa>/<digest>.json
  AUTHORITY_PROMOTION/<aa>/<digest>.json
  ATTEMPTS/<getter attempt id>     # exclusive marker naming the one digest that attempt produced
  JOURNAL.ndjson                   # append-only write log (O_APPEND only)
  HASHES.json                      # written at finalization; digest of itself; mode 0o444
  FINALIZED                        # written last, naming the HASHES digest; after it every write refuses
```

The implemented laws are L1–L9 in the module docstring: session creation by `mkdir` (a second creation refuses),
create-exclusive writes, content addressing from a digest the **store** computes (a caller-declared digest is only ever
compared), idempotence for byte-identical content only, attempt-id uniqueness, atomic temp-then-hard-link writes,
finalization and immutability, verification that recomputes everything from bytes on disk, and path handling that
refuses traversal and symlink escape before touching a file.

Every refusal carries one code from a closed vocabulary: `SESSION_EXISTS`, `SESSION_FINALIZED`, `ATTEMPT_ID_REUSED`,
`DECLARED_DIGEST_MISMATCH`, `OVERWRITE_REJECTED`, `EVIDENCE_REPLACED`, `HASHES_TAMPERED`, `RECORD_MISSING`,
`PARTIAL_RECORD`, `PATH_ESCAPE`, `SYMLINK_REJECTED`, `PINNED_AUTHORITY_MISMATCH` and the rest of `ERROR_CODES`.

**Session manifest.** `session_manifest()` pins the active authority manifest, the schema registry digest, the active
capability matrix, the raw schema, codec and ingest versions, the trusted shim version, self-hash, source hash and
allowlist digest, the reference parser version and hash, the primitive spec digest, the host, product, version, build
and library identity, the session, probe and operator, and the stdout/stderr retention rule.
`session_manifest_errors()` refuses any mismatch, and qualification refuses an evidence set whose session manifest does
not name the active authority.

**stdout and stderr retention.** Streams are never inlined into a frame. When a getter attempt produces either stream
the exact bytes are stored as their own content-addressed record in the RAW layer and the frame carries only
`stdout_sha256` / `stderr_sha256`; when nothing was captured both are null and the rule is `NOT_CAPTURED`. There is no
third option and no truncated copy.

No evidence root exists. The store has only ever been run against temporary directories by the validator.
