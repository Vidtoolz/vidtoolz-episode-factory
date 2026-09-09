
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

## v1.9: root trust boundary, session identity, attempt tuples and mode authority

Codex's v1.8 adjudication closed ES-1 and ES-2 and left four evidence-store integrity defects. All four were
reproduced against the frozen v1.8 bundle before anything was changed.

### S19-1 the root trust boundary

v1.8 called `realpath()` on the configured root before it had established any trust boundary, so a symlinked evidence
root was resolved away and never seen: a session could be created, finalized and verified through it.

v1.9 establishes the boundary **first**, and never resolves a caller-supplied root:

- the configured root is inspected with `lstat`. A symlink is `ROOT_SYMLINK_REFUSED`; anything that is not a
  directory is `ROOT_NOT_A_DIRECTORY`.
- the session directory **entry** is inspected with `lstat` before it is used. A symlink is
  `SESSION_SYMLINK_REFUSED`.
- the boundary keeps the literal path, plus the root's device and inode. Every later operation re-checks them, so
  replacing the root with a symlink or with another directory is `ROOT_REPLACED`.
- reads use `O_NOFOLLOW`; the tree walk never follows links.

Honest scope: this is detection, not a time-of-check/time-of-use guarantee, and a replacement that reuses the freed
inode number is not claimed to be detected.

### S19-2 session identity and semantic reconciliation

v1.8 reconciled bytes, paths, byte counts and directories. Nothing tied a session's bytes to its identity, so renaming
a finalized session directory still verified clean.

**Session identity tuple** (frozen, digested into `session_identity_sha256`): session id, probe id, authority version,
authority manifest, evidence-store version, host, product, resolve version, build, library name, library uuid, library
root, trusted shim, primitive spec, schema registry, and the session directory basename. The session manifest, the
inventory and the finalization marker must all carry the same digest.

**Session path law, policy A:** the session directory basename **is** the session id, exactly. No encoding, no free
rename. The verifier recomputes the expected basename and compares it to the actual directory entry
(`SESSION_PATH_MISMATCH`).

**Record semantics.** A record's storage name is its semantic key,
`sha256(domain + session_id + layer + logical_identity + content_digest)`, stored at
`<layer>/<first two hex>/<key>.json`. The verifier recomputes the key from the record's semantics and compares it to
the actual path, so a record moved to another layer (`LAYER_IDENTITY_MISMATCH`) or rebound to another logical identity
(`LOGICAL_IDENTITY_MISMATCH`) fails. The inventory additionally records each record's attempt ids and keys and its
record-internal session and probe ids, and reconciles them (`INTERNAL_IDENTITY_MISMATCH`).

**Verification counters.** PASS now requires four zeros: `missing == 0`, `unexpected == 0`, `changed == 0` and
`semantic_mismatch == 0`. `verify_summary()` returns the counts.

### S19-3 the attempt tuple

v1.8 keyed attempt uniqueness on the attempt id alone, bound only to a digest, so one attempt id produced records in
two layers. The canonical key is now the tuple:

```
(session_id, layer, logical_identity, attempt_id)   bound to the record bytes
```

A logical identity is **required** on every write. The collision policy is frozen and deterministic:

| case | result |
|---|---|
| same tuple, same bytes | idempotent, one record |
| same tuple, different bytes | `ATTEMPT_ID_REUSED` |
| same attempt id, different layer | `ATTEMPT_ID_CROSS_LAYER` |
| same attempt id, different logical identity | `ATTEMPT_ID_CROSS_IDENTITY` |
| same attempt id, different session | allowed; the tuple includes the session, so keys differ |
| same bytes, different logical identity, different attempt id | allowed; two records with distinct semantic keys |

Attempt indexes are built from a list and duplicate tuple keys refuse (`ATTEMPT_TUPLE_DUPLICATE`) before any map
exists, so a duplicate can never be silently overwritten.

### S19-4 mode and file-type authority

v1.8 recorded no filesystem metadata, so `chmod` after finalization was invisible. v1.9 sets canonical modes
explicitly with `chmod` after creation, never relying on the process umask:

| entry | mode |
|---|---|
| directories | `0o700` |
| records, attempt markers | `0o400` |
| session manifest, inventory, finalization marker | `0o444` |
| journal | `0o600` |

File type and permission mode are recorded for every governed file and directory and reconciled at verification
(`MODE_MISMATCH`). A regular file replaced by another filesystem type at the same path fails even though the path
exists. Only POSIX type and permission bits are frozen: no inode, no timestamps, no owner.

### Finalization marker

The marker is now a JSON object binding the session id, the session identity digest, the inventory digest, the store
and authority versions and the state `FINALIZED`. A marker moved to another session fails.

### Platform scope

Mode and file-type verification are POSIX semantics, qualified on the Linux host this bundle is validated on. No
Windows parity is claimed, implemented or tested.

## v1.10: persisted boundary, recomputed model, marker derivation, continuous mode authority

Codex's independent v1.9 result passed all v1.7 and v1.8 regressions (211/211) and left five findings. All five were
reproduced against the frozen v1.9 bundle before anything was changed.

### S110-1 the boundary is persisted, not remembered

v1.9's boundary lived only in process memory. Reproduced: replacing the session directory with another directory of
the same basename and content verified clean, and copying the whole session under a second root verified clean.

`create_session` now writes a **SESSION_BOUNDARY receipt**, `BOUNDARY.json`, as governed evidence at mode `0o444`:

| field | meaning |
|---|---|
| `root_path`, `root_device`, `root_inode` | the configured evidence root actually established |
| `session_basename`, `session_device`, `session_inode` | the session directory actually created |
| `session_id`, `authority_version`, `evidence_store_version`, `platform_scope`, `created_at` | the authority it was created under |
| `boundary_sha256` | the digest of everything above |

`boundary_identity()` digests the six filesystem fields, and that digest is part of the **session identity tuple**, so
the same bytes under another root or another session-directory inode are a different, invalid session.
`check_boundary()` re-lstats the configured root **and** the session directory against the receipt before every
authorizing operation, comparing literal path, device, inode, non-symlink type, directory type and frozen mode, and
fails closed with `ROOT_IDENTITY_MISMATCH` or `SESSION_BOUNDARY_CHANGED`.

**Scope, stated honestly.** Ordinary replacement and substitution are detectable through the stored boundary identity.
Deliberate device and inode reuse is **not** claimed to be detected, and this is not a time-of-check/time-of-use
guarantee. Only the root and session directory inodes are bound: replacing an empty layer directory with an identical
empty one at the same mode is not detected, and is deliberately out of scope because it changes no governed evidence.
A populated layer directory is detected through its lost records.

### S110-2 the inventory is evidence, not the model

`expected_model()` rebuilds the whole semantic model from **independent sources only** — filesystem facts, record
bytes, the session manifest, the boundary receipt and frozen store law — and never reads the inventory or the
finalization marker. `verify_summary()` then compares the stored inventory and marker against that model, field by
field. Directory kinds and modes are derived from path law, not read from the inventory. Duplicate entry paths, record
keys, attempt keys and directories are refused before any index is built.

Every normative finalization-marker field is now derived and compared, including `evidence_store_version` and
`authority_version`, which v1.9 read but ignored. A marker missing a normative field is refused.

`INVENTORY-FIELD-PROVENANCE.json` publishes, for every normative field, which source the verifier derives it from:
`DERIVED_FROM_FILESYSTEM`, `DERIVED_FROM_RECORD_BYTES`, `DERIVED_FROM_SESSION_AUTHORITY`, `DERIVED_FROM_SCHEMA`,
`FROZEN_CONSTANT` or `NON_NORMATIVE`. No normative field may be classified `TRUSTED_FROM_INVENTORY_ITSELF`, and the
validator asserts it.

**Frozen precedence.** FILESYSTEM FACTS + RECORD BYTES + SESSION MANIFEST and BOUNDARY RECEIPT + FROZEN SCHEMAS and
STORE LAW produce the expected model. The stored inventory, finalization marker and attempt markers are compared
against it. They never define it.

### S110-3 stored attempt markers are derived, not trusted

v1.9's public API refused cross-layer and cross-identity reuse, but a marker planted on disk was accepted through
write, finalize and verify.

Markers and records must now reconcile as a **bijection**. For every marker the store derives the record path its
tuple requires and matches it against the records present; for every record it derives the marker whose tuple
recomputes that record's semantic key. A marker with no record is `FOREIGN_ATTEMPT_MARKER`, a record with no marker is
`ORPHANED_RECORD`, a marker naming another session is `FOREIGN_ATTEMPT_MARKER`, and attempt ids are unique in addition
to attempt keys (`ATTEMPT_ID_DUPLICATE`). This runs inside the ACTIVE integrity check, so a corrupted ACTIVE session
cannot progress to FINALIZED.

### S110-4 mode authority is continuous and covers the session directory

`MODE_TABLE` derives the expected mode of every governed entry from its **kind**:

| kind | mode |
|---|---|
| evidence root | not owned by the store |
| session, layer, shard, attempts, temp directories | `0o700` |
| records, attempt markers | `0o400` |
| session manifest, boundary receipt, inventory, finalization marker | `0o444` |
| journal | `0o600` |

The session directory is now inside mode authority, and the comparison runs from creation onward, not only after
finalization. `_require_can_write()` refuses any further operation on a session whose modes have drifted, so an ACTIVE
chmod blocks the next write and blocks finalization.

### S110-5 one filesystem error vocabulary

`fs()` wraps every os-level call and `ERRNO_TO_CODE` maps ENOENT, EEXIST, ENOTDIR, EISDIR, ELOOP, EACCES, EPERM,
ENAMETOOLONG, EXDEV, ENOTEMPTY, ENOSPC, EROFS and EOPNOTSUPP to frozen `FS_*` classes, with `FS_UNAVAILABLE` as the
closed default. Programming defects are deliberately not caught and still surface.

### Session state

`ACTIVE`, `PARTIAL`, `FINALIZED`, `INVALID`. An ACTIVE session with an integrity violation is `INVALID` and can never
finalize. Verification PASS requires the four normative counters — missing, unexpected, changed, semantic_mismatch —
to be zero; `boundary_mismatch`, `metadata_mismatch` and `attempt_mismatch` are advisory refinements that always also
increment a normative counter, so they add detail and never a second authority.
