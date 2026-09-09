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
