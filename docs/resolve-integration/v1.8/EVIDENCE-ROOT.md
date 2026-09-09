
# EVIDENCE-ROOT.md — the one evidence store (v1.8, FROZEN_NOW as contract)

**Normative implementation: `tools/evidence_store.py`.** That module, and nothing else in this bundle, is classified
`EVIDENCE_STORE_AUTHORIZING`. It is the only code permitted to create an evidence session, write a raw, derived,
review or promotion record, finalize a session, verify a session or derive an evidence path.

This document supersedes every earlier description of an evidence root. In particular the v1.6/v1.7 sentence
"Reference implementation: `tools/capture_shim_reference.py#EvidenceRoot`" is **withdrawn**: that second
implementation is removed from the bundle (Codex finding ES-2, precedence S47).

## Why v1.8 changed this

Codex's final v1.7 adjudication left exactly one defect class open, and it was this one.

**ES-1.** The v1.7 verifier only looked at entries it already expected. A file planted in a finalized session's root
after finalization was never examined, so `verify()` returned no errors: independent attack STORE-14 passed. A file
planted inside a layer was noticed only incidentally and mis-labelled `PARTIAL_RECORD`. An unexpected directory was
ignored entirely.

**ES-2.** A second storage implementation lived in the capture shim with its own layout, its own path construction and
no verification or finalization law. All four of its write methods interpolated a caller string into a filesystem path,
so `add_derived({"raw_capture_sha256": "../../x"})` wrote outside the evidence root, and so did `add_capture`,
`add_review` and `add_refreeze`. Two authorities disagreed about where evidence lives and what makes it valid.

## Layout

```
<root>/<session id>/
  SESSION.json                     # the pinned session manifest, written once, mode 0o444
  RAW/<aa>/<digest>.json           # content-addressed records, mode 0o400, sharded by the first two hex digits
  DERIVED/<aa>/<digest>.json
  HUMAN_REVIEW/<aa>/<digest>.json
  AUTHORITY_PROMOTION/<aa>/<digest>.json
  ATTEMPTS/<getter attempt id>     # exclusive marker naming the one digest that attempt produced
  TMP/                             # private staging for atomic writes; must be empty at finalization
  JOURNAL.ndjson                   # append-only write log (O_APPEND only)
  INVENTORY.json                   # written at finalization: the complete closed world, self-digesting, mode 0o444
  FINALIZED                        # written last, naming the inventory digest; after it every write refuses
```

`HASHES.json` is retired. The finalization receipt is `INVENTORY.json`, and it records more than hashes: it is the
whole allowed file and directory set.

## The laws

L1–L11 are stated in the module docstring of `tools/evidence_store.py` and are executable there. In summary:

1. **One session, one directory.** Created with `mkdir`; a second creation refuses `SESSION_EXISTS`.
2. **Append only.** Records are created `O_CREAT|O_EXCL|O_WRONLY` at mode 0o400. Nothing here opens an existing record
   for writing, truncates one, renames over one or unlinks one.
3. **Content addressing.** The destination is derived from the sha256 of the exact bytes the *store* hashed. A
   caller-declared digest is only ever compared (`DECLARED_DIGEST_MISMATCH`), and a caller never supplies a path.
4. **Idempotence only for identical bytes.** Same attempt id with different bytes is `ATTEMPT_ID_REUSED`; same digest
   with different bytes is `DIGEST_COLLISION_DIFFERENT_BYTES`. No silent replacement.
5. **Atomicity.** Bytes go to a private temp file, fsync, hard link, unlink temp. A crash can leave a temp file
   (`PARTIAL_RECORD`); it can never leave a torn record at a content-addressed path.
6. **Closed-world finalization.** See below.
7. **No escape.** Every caller-supplied identifier passes one logical-name gate and a resolved-path containment proof
   before any filesystem use.
8. **Regular files and directories only**, anywhere under the session root.

## The write API: logical identity, never a path

```
put_raw(attempt_id, raw_bytes, logical_identity=None)
put_derived(attempt_id, content, logical_identity=None)
put_review(attempt_id, content, logical_identity=None)
put_promotion(attempt_id, content, logical_identity=None)
```

A caller supplies a layer (implied by the method), an attempt id, an optional logical identity and the content. The
store computes the digest and the content-addressed destination. There is no parameter named `path` anywhere on the
write surface, and the validator asserts that.

`attempt_id` and `logical_identity` must each match one logical name:

```
^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$
```

which rejects the empty string, `.`, `..`, a leading dot, `/`, `\`, NUL, absolute paths, separator injection and
anything over 128 characters. Containment is then proven again on the **resolved** path, not by a string prefix test.

## Closed-world finalization

`finalize()` runs one transaction:

1. ensure the session is active and not already finalized;
2. refuse any partially written record and any non-regular entry;
3. enumerate every governed entry — every file and every directory, at every depth — and hash all bytes;
4. verify every record's filename digest against its actual bytes;
5. write `INVENTORY.json` atomically and read-only;
6. write the `FINALIZED` marker naming the inventory digest.

The inventory records, per entry: `path`, `kind`, `layer`, `digest`, `byte_count`, `schema_type`, `logical_identity`
and `attempt_ids`, plus the complete expected `directories` set, the session manifest digest, and its own
`inventory_sha256`.

`verify()` then compares **EXPECTED against ACTUAL** over that closed world and requires:

```
missing == 0        unexpected == 0        changed == 0
```

An unknown file or directory anywhere under the session root is `UNEXPECTED_ENTRY`. Directories are part of the
expected structure (only the fixed skeleton plus the two-hex shards that actually hold a record). Nothing is ignored.

## Session state

Exactly one of `ACTIVE`, `PARTIAL`, `FINALIZED`, `INVALID`. A session with a partially written record reports
`PARTIAL`; a finalized session that no longer verifies reports `INVALID`. A crashed session can never masquerade as
finalized authority.

## Symlinks and file types

No symlink may exist anywhere inside an evidence session, at creation time or at verification time
(`SYMLINK_REJECTED`). The tree walk never follows links. Anything that is not a regular file or a directory — FIFO,
socket, device — is `FILE_TYPE_REJECTED`. Hard links are used internally for atomic publication and are not a caller
surface.

## What this does not claim

The store **detects** hostile mutation of a finalized session; it does not prevent it at the operating-system level. A
privileged local process can always edit bytes on disk. The guarantee is that verification then fails, loudly, with a
closed refusal code. No evidence root exists: this store has only ever been run against temporary directories by
`validate_v1_8.py`.
