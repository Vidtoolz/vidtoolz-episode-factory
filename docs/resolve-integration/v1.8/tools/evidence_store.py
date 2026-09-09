#!/usr/bin/env python3
"""THE evidence store (v1.8). One normative, executable, append-only, closed-world evidence-session authority.

v1.8 corrects Codex's final v1.7 findings:

  ES-1  the v1.7 verifier ignored unexpected files placed in a finalized session root (independent attack STORE-14).
        v1.8 makes finalization a CLOSED WORLD: finalize() records the complete allowed inventory of every governed
        entry - files AND directories - and verify() compares EXPECTED against ACTUAL and requires
        missing == 0, unexpected == 0, changed == 0. An unknown entry anywhere under the session root, at any depth,
        invalidates the session. Nothing is ignored.

  ES-2  a second, competing evidence-storage surface existed as EvidenceRoot in tools/capture_shim_reference.py, whose
        add_capture / add_derived / add_review / add_refreeze all built filesystem paths from caller-supplied strings
        and escaped the session root on '../../x'. v1.8 REMOVES it. There is exactly one storage implementation, this
        module, and no caller anywhere supplies a path: callers supply bytes, a logical identity and a layer, and the
        store derives the content-addressed destination itself.

Laws (EVIDENCE-ROOT.md is the normative prose; this file is the executable authority):

  L1  SESSION CREATION    one directory per session, created with mkdir (refuses if it exists), never reused, never
                          reopened for writing after finalization. The pinned session manifest is written once, read-only.
  L2  APPEND ONLY         a record is created with O_CREAT|O_EXCL|O_WRONLY at mode 0o400. No code path here opens an
                          existing record for writing, truncates one, renames over one or unlinks one.
  L3  CONTENT ADDRESSING  the destination is derived from sha256 of the exact bytes THIS module hashed. A caller-declared
                          digest is only ever compared, never trusted, and a caller never supplies a path at all.
  L4  IDEMPOTENCE         re-putting byte-identical content under the same attempt id is a no-op returning the same
                          path. Same attempt id with different bytes, and same digest with different bytes, are refusals.
  L5  ATTEMPT UNIQUENESS  one getter attempt id maps to exactly one record digest, recorded in an O_EXCL marker.
  L6  ATOMICITY           bytes go to a private temp file, fsync, hard link to the content-addressed path, unlink temp.
                          A crash can leave a temp file (reported PARTIAL_RECORD); it can never leave a torn record.
  L7  FINALIZATION        finalize() re-reads every record, verifies every filename digest against actual bytes, writes
                          INVENTORY.json (the complete closed-world expected set, self-digesting, read-only) and then a
                          FINALIZED marker carrying the inventory digest. After that every write refuses.
  L8  CLOSED WORLD        verify() enumerates the whole session tree and compares it to the inventory. Missing,
                          unexpected and changed entries are all refusals. Directories are part of the expected set.
  L9  NO ESCAPE           every path component is one validated logical name; no component may be a symlink; the
                          resolved path must stay inside the resolved session directory. Traversal and symlink escape
                          are refused before any file is touched.
  L10 FILE TYPES          regular files and directories only, anywhere under the session root. A symlink, FIFO, socket
                          or device entry is a refusal, at creation time and at verification time.
  L11 SESSION STATE       exactly one of ACTIVE, PARTIAL, FINALIZED, INVALID. A crashed session can never masquerade as
                          finalized authority.

Offline, dependency-free, no Resolve, no network. Deterministic: same bytes in, same digests and same inventory out.

This module detects hostile mutation of a finalized session; it does not claim to prevent it at the operating-system
level. A privileged local process can always edit bytes on disk. The guarantee is that verification then fails.
"""
import errno
import hashlib
import json
import os
import re
import stat
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

EVIDENCE_STORE_VERSION = "vidtoolz.resolveEvidenceStore.v2"
EVIDENCE_SESSION_SCHEMA = "vidtoolz.resolveEvidenceSession.v2"
EVIDENCE_INVENTORY_SCHEMA = "vidtoolz.resolveEvidenceInventory.v1"
INVENTORY_DOMAIN = "vidtoolz.resolveEvidenceInventory.v1"
AUTHORITY_CLASS = "EVIDENCE_STORE_AUTHORIZING"  # section 20: exactly one module may carry this
LAYERS = ("RAW", "DERIVED", "HUMAN_REVIEW", "AUTHORITY_PROMOTION")
MAX_RECORD_BYTES = 1 << 22
# One logical name: starts alphanumeric, then alphanumerics and . _ : + - only. This rejects '', '.', '..', '/', '\',
# NUL, leading dots, absolute paths, separator injection and anything longer than 128 characters.
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$")
SESSION_FILE = "SESSION.json"
INVENTORY_FILE = "INVENTORY.json"
FINALIZED_FILE = "FINALIZED"
ATTEMPTS_DIR = "ATTEMPTS"
TMP_DIR = "TMP"
JOURNAL_FILE = "JOURNAL.ndjson"
RESERVED_NAMES = (SESSION_FILE, INVENTORY_FILE, FINALIZED_FILE, ATTEMPTS_DIR, TMP_DIR, JOURNAL_FILE) + LAYERS
PARTIAL_PREFIX = ".partial-"
SESSION_STATES = ("ACTIVE", "PARTIAL", "FINALIZED", "INVALID")

ERROR_CODES = (
    "ROOT_NOT_A_DIRECTORY", "ROOT_IS_SYMLINK", "SESSION_EXISTS", "SESSION_NOT_FOUND", "SESSION_FINALIZED",
    "SESSION_NOT_FINALIZED", "NAME_INVALID", "PATH_ESCAPE", "SYMLINK_REJECTED", "FILE_TYPE_REJECTED", "LAYER_UNKNOWN",
    "NOT_BYTES", "RECORD_TOO_LARGE", "DECLARED_DIGEST_MISMATCH", "ATTEMPT_ID_REUSED",
    "DIGEST_COLLISION_DIFFERENT_BYTES", "OVERWRITE_REJECTED", "RECORD_MISSING", "EVIDENCE_REPLACED",
    "UNEXPECTED_ENTRY", "INVENTORY_TAMPERED", "PARTIAL_RECORD", "PINNED_AUTHORITY_MISMATCH", "MANIFEST_MISSING",
    "CONTENT_DIGEST_MISMATCH", "LOGICAL_IDENTITY_INVALID",
)


class EvidenceStoreError(Exception):
    """Every refusal of this store carries one closed code from ERROR_CODES; nothing refuses anonymously."""

    def __init__(self, code, detail=""):
        assert code in ERROR_CODES, code
        self.code = code
        self.detail = str(detail)
        super().__init__(f"{code}: {self.detail}" if detail else code)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def canonical_json_bytes(obj):
    """The one serialization this store writes for an object: sorted keys, minimal separators, UTF-8, trailing newline."""
    return (json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def inventory_digest(inv):
    """Domain-tagged digest of an inventory with its own digest field removed."""
    return L.digest({k: v for k, v in inv.items() if k != "inventory_sha256"}, INVENTORY_DOMAIN)


# ---------------------------------------------------------------- L9 / L10 path law
def _name(n, code="NAME_INVALID"):
    """L9. One logical name or a refusal. This is the ONLY way a caller-supplied string reaches the filesystem."""
    if not isinstance(n, str) or not NAME_RE.match(n) or n in (".", ".."):
        raise EvidenceStoreError(code, repr(n))
    return n


def _reject_non_regular(path, allow_dir=False):
    """L10. Refuse a symlink, FIFO, socket or device. Regular files (and directories when allowed) only."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return
    m = st.st_mode
    if stat.S_ISLNK(m):
        raise EvidenceStoreError("SYMLINK_REJECTED", path)
    if stat.S_ISDIR(m):
        if allow_dir:
            return
        raise EvidenceStoreError("FILE_TYPE_REJECTED", f"directory where a file is required: {path}")
    if not stat.S_ISREG(m):
        raise EvidenceStoreError("FILE_TYPE_REJECTED", f"{stat.S_IFMT(m):#o} at {path}")


def _safe_join(base, *parts):
    """L9. Each part must be one validated logical name, no component may be a symlink, and the resolved path must stay
    inside the resolved base. Traversal, absolute components, separator injection and symlink escape all refuse here,
    before any file is created or read. Containment is proven on the resolved path, not by string prefix alone."""
    for p in parts:
        _name(p)
    real_base = os.path.realpath(base)
    cur = real_base
    for p in parts:
        cur = os.path.join(cur, p)
        _reject_non_regular(cur, allow_dir=True)
    want = os.path.normpath(os.path.join(real_base, *parts))
    if cur != want or not (cur == real_base or cur.startswith(real_base + os.sep)):
        raise EvidenceStoreError("PATH_ESCAPE", cur)
    real_cur = os.path.realpath(cur)
    if real_cur != cur and not real_cur.startswith(real_base + os.sep):
        raise EvidenceStoreError("PATH_ESCAPE", real_cur)
    return cur


def _read_exact(path):
    """Read a regular file without following a symlink at the final component."""
    _reject_non_regular(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        chunks = []
        while True:
            b = os.read(fd, 1 << 20)
            if not b:
                break
            chunks.append(b)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _write_once(path, data, mode=0o400):
    """L2/L6. Create-exclusive write via a private temp file in the same directory, fsync, hard link, unlink temp,
    fsync the directory. Never truncates, never renames over an existing file, never unlinks a final record."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, PARTIAL_PREFIX + sha256_bytes(data + os.urandom(16))[:32])
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(tmp, path)
    except FileExistsError:
        os.unlink(tmp)
        raise EvidenceStoreError("OVERWRITE_REJECTED", path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
    dfd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def _append_journal(path, entry):
    """Append-only session journal. O_APPEND only; no seek, no truncate, no rewrite."""
    line = canonical_json_bytes(entry)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)


def session_manifest(session_id, probe_id, operator, env, active, rp, created_at,
                     stdout_retention="CONTENT_ADDRESSED_RAW_LAYER", stderr_retention="CONTENT_ADDRESSED_RAW_LAYER"):
    """The pinned session manifest: everything an M0A probe session is bound to. The store writes it once, read-only,
    and finalization binds its digest into the inventory."""
    shim = L.trusted_capture_shim()
    return {
        "schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
        "evidence_session_schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_inventory_schema": EVIDENCE_INVENTORY_SCHEMA,
        "session_id": session_id,
        "probe_id": probe_id,
        "operator": operator,
        "created_at": created_at,
        "authority_version": L.AUTHORITY_VERSION,
        "authority_manifest_sha256": (active or {}).get("manifest_sha256"),
        "schema_registry_sha256": L.schema_registry_digest(),
        "capability_matrix_sha256": (active or {}).get("capability_matrix_sha256"),
        "raw_schema_version": L.RAW_SCHEMA_ID,
        "codec_version": L.CODEC,
        "raw_ingest_version": L.RAW_INGEST_VERSION,
        "trusted_shim_version": shim["shim_version"],
        "trusted_shim_sha256": shim["shim_sha256"],
        "trusted_shim_allowlist_digest": shim["allowlist_digest"],
        "trusted_shim_sha256_of_source": shim["shim_source_sha256"],
        "parser_version": L.PARSER_VERSION,
        "parser_sha256": L.parser_sha256(),
        "primitive_spec_sha256": L.primitive_spec_digest(rp),
        "host_name": (env or {}).get("host_name"),
        "product": (env or {}).get("product"),
        "resolve_version": (env or {}).get("resolve_version"),
        "build": (env or {}).get("build"),
        "library_name": (env or {}).get("library_name"),
        "library_uuid": (env or {}).get("library_uuid"),
        "library_root": (env or {}).get("library_root"),
        "stdout_retention": stdout_retention,
        "stderr_retention": stderr_retention,
    }


class EvidenceStore:
    """One append-only evidence session on disk. Construct with create_session() or open_session().

    Callers never supply a path. They supply a layer, a logical identity and bytes; this class derives the
    content-addressed destination. There is no API here that accepts a filesystem-relative path."""

    def __init__(self, root, session_id):
        self.root = os.path.realpath(root)
        self.session_id = session_id
        self.dir = _safe_join(self.root, session_id)

    # -------------------------------------------------------------- state
    @property
    def finalized(self):
        return os.path.exists(os.path.join(self.dir, FINALIZED_FILE))

    def session_state(self):
        """L11. Exactly one of ACTIVE, PARTIAL, FINALIZED, INVALID. A crashed session reports PARTIAL and can never
        report FINALIZED; a finalized session that no longer verifies reports INVALID."""
        if not os.path.isdir(self.dir):
            return "INVALID"
        if not os.path.exists(os.path.join(self.dir, SESSION_FILE)):
            return "INVALID"
        if self.finalized:
            return "FINALIZED" if not self.verify() else "INVALID"
        return "PARTIAL" if self._partials() else "ACTIVE"

    def manifest(self):
        p = os.path.join(self.dir, SESSION_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("MANIFEST_MISSING", p)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def manifest_sha256(self):
        return sha256_bytes(_read_exact(os.path.join(self.dir, SESSION_FILE)))

    def record_path(self, layer, digest):
        """The content-addressed destination of a record. Derived here, never supplied by a caller."""
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        if not L.is_sha(digest):
            raise EvidenceStoreError("NAME_INVALID", digest)
        return _safe_join(self.dir, layer, digest[:2], digest + ".json")

    # -------------------------------------------------------------- write
    def _put(self, layer, attempt_id, raw_bytes, logical_identity, declared_digest=None):
        """L2..L6. The ONE write path. `layer` is a member of LAYERS, `attempt_id` and `logical_identity` are logical
        names, `raw_bytes` are the exact bytes. The digest and the destination are computed here."""
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        _name(attempt_id)
        if logical_identity is not None:
            _name(logical_identity, "LOGICAL_IDENTITY_INVALID")
        if not isinstance(raw_bytes, (bytes, bytearray)):
            raise EvidenceStoreError("NOT_BYTES", type(raw_bytes).__name__)
        raw_bytes = bytes(raw_bytes)
        if len(raw_bytes) > MAX_RECORD_BYTES:
            raise EvidenceStoreError("RECORD_TOO_LARGE", len(raw_bytes))
        digest = sha256_bytes(raw_bytes)
        if declared_digest is not None and declared_digest != digest:
            raise EvidenceStoreError("DECLARED_DIGEST_MISMATCH", f"declared {declared_digest} actual {digest}")
        marker = _safe_join(self.dir, ATTEMPTS_DIR, attempt_id)
        try:
            _write_once(marker, (digest + "\n").encode("ascii"))
        except EvidenceStoreError as e:
            if e.code != "OVERWRITE_REJECTED":
                raise
            prev = _read_exact(marker).decode("ascii").strip()
            if prev != digest:
                raise EvidenceStoreError("ATTEMPT_ID_REUSED", f"{attempt_id} already bound to {prev}")
        final = self.record_path(layer, digest)
        os.makedirs(os.path.dirname(final), mode=0o700, exist_ok=True)
        idempotent = False
        if os.path.exists(final):
            existing = _read_exact(final)
            if existing != raw_bytes:
                raise EvidenceStoreError("DIGEST_COLLISION_DIFFERENT_BYTES", digest)
            idempotent = True
        else:
            _write_once(final, raw_bytes)
        _append_journal(os.path.join(self.dir, JOURNAL_FILE),
                        {"layer": layer, "attempt_id": attempt_id, "logical_identity": logical_identity,
                         "digest": digest, "byte_count": len(raw_bytes), "idempotent": idempotent})
        return {"digest": digest, "layer": layer, "attempt_id": attempt_id, "logical_identity": logical_identity,
                "path": os.path.relpath(final, self.dir), "byte_count": len(raw_bytes), "idempotent": idempotent}

    def put(self, layer, attempt_id, raw_bytes, declared_digest=None, logical_identity=None):
        """Store exactly these bytes in `layer` under `attempt_id`. Retained v1.7 signature."""
        return self._put(layer, attempt_id, raw_bytes, logical_identity, declared_digest)

    def put_json(self, layer, attempt_id, obj, logical_identity=None):
        """Canonical UTF-8 JSON bytes of `obj`. The bytes are the evidence; the object is not."""
        return self._put(layer, attempt_id, canonical_json_bytes(obj), logical_identity)

    def put_raw(self, attempt_id, raw_bytes, logical_identity=None):
        """RAW layer. `raw_bytes` are the exact capture frame bytes (capture_shim_reference.raw_frame_bytes)."""
        return self._put("RAW", attempt_id, raw_bytes, logical_identity)

    def put_derived(self, attempt_id, content, logical_identity=None):
        """DERIVED layer (section 5). Accepts content plus a logical identity; the destination is content-addressed here.
        This replaces the removed EvidenceRoot.add_derived, which took a caller string and escaped the session root."""
        return self._put("DERIVED", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    def put_review(self, attempt_id, content, logical_identity=None):
        """HUMAN_REVIEW layer (section 6). Same law: no caller-controlled path, no overwrite."""
        return self._put("HUMAN_REVIEW", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    def put_promotion(self, attempt_id, content, logical_identity=None):
        """AUTHORITY_PROMOTION layer (section 6). Same law: no caller-controlled path, no overwrite."""
        return self._put("AUTHORITY_PROMOTION", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    # -------------------------------------------------------------- read
    def get(self, layer, digest):
        """L3/L8. Read a record and re-verify that its bytes hash to the digest in its own path."""
        p = self.record_path(layer, digest)
        if not os.path.exists(p):
            raise EvidenceStoreError("RECORD_MISSING", digest)
        b = _read_exact(p)
        if sha256_bytes(b) != digest:
            raise EvidenceStoreError("CONTENT_DIGEST_MISMATCH", digest)
        return b

    def attempts(self):
        d = os.path.join(self.dir, ATTEMPTS_DIR)
        out = {}
        for n in sorted(os.listdir(d)):
            out[n] = _read_exact(os.path.join(d, n)).decode("ascii").strip()
        return out

    # -------------------------------------------------------------- closed-world enumeration
    def _partials(self):
        out = []
        for dp, dns, fns in os.walk(self.dir):
            for n in fns:
                if n.startswith(PARTIAL_PREFIX):
                    out.append(os.path.relpath(os.path.join(dp, n), self.dir))
        return sorted(out)

    def scan_tree(self):
        """L8/L10. Enumerate EVERY entry under the session root, at any depth: files, directories and anything that is
        neither. Returns (files, dirs, partials, bad_types), all relative to the session root and sorted. Nothing is
        skipped and nothing is filtered by name, because the whole point is to notice entries nobody expected."""
        files, dirs, partials, bad = {}, [], [], []
        for dp, dns, fns in os.walk(self.dir, followlinks=False):
            rel_dir = os.path.relpath(dp, self.dir)
            if rel_dir != ".":
                dirs.append(rel_dir)
            for n in sorted(dns):
                p = os.path.join(dp, n)
                if os.path.islink(p):
                    bad.append(("SYMLINK", os.path.relpath(p, self.dir)))
            for n in sorted(fns):
                p = os.path.join(dp, n)
                rel = os.path.relpath(p, self.dir)
                st = os.lstat(p)
                if stat.S_ISLNK(st.st_mode):
                    bad.append(("SYMLINK", rel))
                    continue
                if not stat.S_ISREG(st.st_mode):
                    bad.append((f"MODE_{stat.S_IFMT(st.st_mode):#o}", rel))
                    continue
                if n.startswith(PARTIAL_PREFIX):
                    partials.append(rel)
                    continue
                b = _read_exact(p)
                files[rel] = {"byte_count": len(b), "sha256": sha256_bytes(b)}
        return files, sorted(dirs), sorted(partials), sorted(bad)

    def _expected_dirs(self, record_rels):
        """Section 9: directories are part of the expected structure. The allowed set is the fixed skeleton plus exactly
        the two-hex shard directories that hold a stored record."""
        exp = set(LAYERS) | {ATTEMPTS_DIR, TMP_DIR}
        for rel in record_rels:
            parts = rel.split(os.sep)
            if len(parts) == 3:
                exp.add(parts[0])
                exp.add(os.path.join(parts[0], parts[1]))
        return exp

    # -------------------------------------------------------------- finalize / verify
    def finalize(self):
        """L7 (section 17). The finalization transaction, in this exact order:
             1 ensure the session is active and not already finalized
             2 refuse any partially written record and any non-regular entry
             3 enumerate every allowed entry and hash all bytes
             4 verify every record's filename digest against its actual bytes
             5 write INVENTORY.json (the complete closed world, self-digesting) atomically and read-only
             6 write the FINALIZED marker naming that inventory digest
           There is no finalization with a partially written record, and step 5 is a create-exclusive write, so a crash
           mid-finalization leaves the session unfinalized rather than half-frozen."""
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        files, dirs, partials, bad = self.scan_tree()
        if partials:
            raise EvidenceStoreError("PARTIAL_RECORD", ", ".join(partials[:3]))
        if bad:
            kind, rel = bad[0]
            raise EvidenceStoreError("SYMLINK_REJECTED" if kind == "SYMLINK" else "FILE_TYPE_REJECTED", f"{kind} at {rel}")
        records, others = {}, {}
        for rel, meta in files.items():
            parts = rel.split(os.sep)
            if len(parts) == 3 and parts[0] in LAYERS and parts[2].endswith(".json"):
                name_digest = parts[2][:-5]
                if name_digest != meta["sha256"]:
                    raise EvidenceStoreError("EVIDENCE_REPLACED", f"{rel} holds {meta['sha256']}")
                records[rel] = dict(meta, layer=parts[0], digest=name_digest)
            else:
                others[rel] = meta
        att = self.attempts()
        have = {r["digest"] for r in records.values()}
        missing = sorted(a for a, d in att.items() if d not in have)
        if missing:
            raise EvidenceStoreError("RECORD_MISSING", f"attempts without a record: {missing[:3]}")
        ident = {}
        jp = os.path.join(self.dir, JOURNAL_FILE)
        if os.path.exists(jp):
            for line in _read_exact(jp).decode("utf-8").splitlines():
                if line.strip():
                    e = L.strict_loads(line)
                    ident.setdefault(e["digest"], e.get("logical_identity"))
        by_digest = {}
        for a, d in sorted(att.items()):
            by_digest.setdefault(d, []).append(a)
        entries = []
        for rel in sorted(records):
            r = records[rel]
            entries.append({"path": rel, "kind": "RECORD", "layer": r["layer"], "digest": r["digest"],
                            "byte_count": r["byte_count"], "schema_type": "EVIDENCE_RECORD",
                            "logical_identity": ident.get(r["digest"]), "attempt_ids": by_digest.get(r["digest"], [])})
        for rel in sorted(others):
            m = others[rel]
            kind = {SESSION_FILE: "SESSION_MANIFEST", JOURNAL_FILE: "JOURNAL"}.get(rel, "ATTEMPT_MARKER" if rel.startswith(ATTEMPTS_DIR + os.sep) else "OTHER")
            entries.append({"path": rel, "kind": kind, "layer": None, "digest": m["sha256"],
                            "byte_count": m["byte_count"], "schema_type": kind, "logical_identity": None,
                            "attempt_ids": []})
        exp_dirs = self._expected_dirs(list(records))
        unexpected_dirs = sorted(set(dirs) - exp_dirs)
        if unexpected_dirs:
            raise EvidenceStoreError("UNEXPECTED_ENTRY", f"directory {unexpected_dirs[0]}")
        inv = {
            "schema": EVIDENCE_INVENTORY_SCHEMA,
            "evidence_store_version": EVIDENCE_STORE_VERSION,
            "session_id": self.session_id,
            "session_manifest_sha256": self.manifest_sha256(),
            "closed_world": True,
            "record_count": len(records),
            "entry_count": len(entries),
            "total_bytes": sum(e["byte_count"] for e in entries),
            "attempt_count": len(att),
            "directories": sorted(exp_dirs),
            "self_path": INVENTORY_FILE,
            "finalized_marker_path": FINALIZED_FILE,
            "entries": entries,
        }
        inv["inventory_sha256"] = inventory_digest(inv)
        _write_once(os.path.join(self.dir, INVENTORY_FILE),
                    (json.dumps(inv, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o444)
        _write_once(os.path.join(self.dir, FINALIZED_FILE), (inv["inventory_sha256"] + "\n").encode("ascii"), 0o444)
        return inv["inventory_sha256"]

    def inventory(self):
        p = os.path.join(self.dir, INVENTORY_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("SESSION_NOT_FINALIZED", self.session_id)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def verify(self, require_finalized=True):
        """L8. Recompute the whole session from the bytes on disk and compare the CLOSED WORLD.

        Returns a sorted list of refusal strings, each prefixed with one ERROR_CODES code. An empty list means all of:
        every record hashes to its own name; the inventory is the digest of itself; the FINALIZED marker names that
        inventory; the session manifest is the one the inventory names; every attempt resolves; nothing is partially
        written; no entry anywhere is a symlink or any other non-regular type; and the set of entries on disk - files
        AND directories, at every depth - is EXACTLY the set the inventory records. Missing, unexpected and changed are
        all failures. This is the correction of Codex ES-1: an unknown entry is never ignored."""
        errs = []
        if not os.path.isdir(self.dir):
            return [f"SESSION_NOT_FOUND: {self.session_id}"]
        files, dirs, partials, bad = self.scan_tree()
        for rel in partials:
            errs.append(f"PARTIAL_RECORD: {rel}")
        for kind, rel in bad:
            errs.append(f"SYMLINK_REJECTED: {rel}" if kind == "SYMLINK" else f"FILE_TYPE_REJECTED: {kind} at {rel}")
        for rel, meta in sorted(files.items()):
            parts = rel.split(os.sep)
            if len(parts) == 3 and parts[0] in LAYERS and parts[2].endswith(".json") and parts[2][:-5] != meta["sha256"]:
                errs.append(f"EVIDENCE_REPLACED: {rel} holds {meta['sha256']}")
        if not self.finalized:
            if require_finalized:
                errs.append(f"SESSION_NOT_FINALIZED: {self.session_id}")
            return sorted(set(errs))
        try:
            inv = self.inventory()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            return sorted(set(errs + [f"INVENTORY_TAMPERED: unreadable ({e})"]))
        if not isinstance(inv, dict) or inv.get("schema") != EVIDENCE_INVENTORY_SCHEMA or inv.get("closed_world") is not True:
            return sorted(set(errs + ["INVENTORY_TAMPERED: wrong schema or not a closed-world inventory"]))
        if inv.get("inventory_sha256") != inventory_digest(inv):
            errs.append("INVENTORY_TAMPERED: inventory_sha256 is not the digest of this inventory")
        try:
            marker = _read_exact(os.path.join(self.dir, FINALIZED_FILE)).decode("ascii").strip()
        except (OSError, EvidenceStoreError, UnicodeDecodeError) as e:
            return sorted(set(errs + [f"INVENTORY_TAMPERED: FINALIZED marker unreadable ({e})"]))
        if marker != inv.get("inventory_sha256"):
            errs.append("INVENTORY_TAMPERED: FINALIZED marker does not name this inventory")
        if inv.get("session_manifest_sha256") != files.get(SESSION_FILE, {}).get("sha256"):
            errs.append("INVENTORY_TAMPERED: session manifest bytes are not the ones the inventory names")
        # ---- the closed world: EXPECTED vs ACTUAL, over files and directories
        expected = {e["path"]: e for e in inv.get("entries", []) if isinstance(e, dict) and isinstance(e.get("path"), str)}
        governed = {rel: m for rel, m in files.items() if rel not in (INVENTORY_FILE, FINALIZED_FILE)}
        for rel in sorted(set(expected) - set(governed)):
            errs.append(f"RECORD_MISSING: {rel} is recorded in the inventory but absent on disk")
        for rel in sorted(set(governed) - set(expected)):
            errs.append(f"UNEXPECTED_ENTRY: {rel} is present on disk but not in the finalized inventory")
        for rel in sorted(set(expected) & set(governed)):
            e, m = expected[rel], governed[rel]
            if e.get("digest") != m["sha256"]:
                errs.append(f"EVIDENCE_REPLACED: {rel} holds {m['sha256']}, inventory records {e.get('digest')}")
            if e.get("byte_count") != m["byte_count"]:
                errs.append(f"EVIDENCE_REPLACED: {rel} byte count {m['byte_count']} != inventory {e.get('byte_count')}")
        exp_dirs = set(inv.get("directories") or [])
        for rel in sorted(exp_dirs - set(dirs)):
            errs.append(f"RECORD_MISSING: directory {rel} is recorded in the inventory but absent on disk")
        for rel in sorted(set(dirs) - exp_dirs):
            errs.append(f"UNEXPECTED_ENTRY: directory {rel} is present on disk but not in the finalized inventory")
        for f in (INVENTORY_FILE, FINALIZED_FILE):
            if f not in files:
                errs.append(f"RECORD_MISSING: {f}")
        att_paths = [rel for rel in expected if rel.startswith(ATTEMPTS_DIR + os.sep)]
        have = {e["digest"] for e in expected.values() if e.get("kind") == "RECORD"}
        for rel in sorted(att_paths):
            try:
                d = _read_exact(os.path.join(self.dir, rel)).decode("ascii").strip()
            except (OSError, EvidenceStoreError, UnicodeDecodeError):
                continue
            if d not in have:
                errs.append(f"RECORD_MISSING: attempt {os.path.basename(rel)} names absent record {d}")
        return sorted(set(errs))

    def authority_errors(self, env, active, rp):
        """Section 21: the pinned authority in the session manifest must be the active authority. Any mismatch makes
        every record in this session inadmissible, whatever the records themselves say."""
        try:
            sm = self.manifest()
        except (EvidenceStoreError, L.ParseError, ValueError) as e:
            return [f"MANIFEST_MISSING: {e}"]
        return [f"PINNED_AUTHORITY_MISMATCH: {e}" for e in L.session_manifest_errors(sm, env, active, rp)]


def create_session(root, session_id, manifest):
    """L1. Create a brand new session directory (mkdir; refuses if it exists) and write its pinned manifest read-only."""
    root = os.path.realpath(root)
    if os.path.islink(root):
        raise EvidenceStoreError("ROOT_IS_SYMLINK", root)
    if not os.path.isdir(root):
        raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", root)
    _name(session_id)
    if session_id in RESERVED_NAMES:
        raise EvidenceStoreError("NAME_INVALID", session_id)
    d = _safe_join(root, session_id)
    try:
        os.mkdir(d, 0o700)
    except FileExistsError:
        raise EvidenceStoreError("SESSION_EXISTS", session_id)
    st = EvidenceStore(root, session_id)
    for sub in LAYERS + (ATTEMPTS_DIR, TMP_DIR):
        os.mkdir(os.path.join(d, sub), 0o700)
    if not isinstance(manifest, dict) or manifest.get("schema") != EVIDENCE_SESSION_SCHEMA or manifest.get("session_id") != session_id:
        raise EvidenceStoreError("PINNED_AUTHORITY_MISMATCH", "session manifest schema/session_id")
    _write_once(os.path.join(d, SESSION_FILE),
                (json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o444)
    return st


def open_session(root, session_id):
    """Open an existing session for reading (and for writing only while it is not finalized)."""
    root = os.path.realpath(root)
    _name(session_id)
    d = _safe_join(root, session_id)
    if not os.path.isdir(d):
        raise EvidenceStoreError("SESSION_NOT_FOUND", session_id)
    return EvidenceStore(root, session_id)


def list_sessions(root):
    root = os.path.realpath(root)
    if not os.path.isdir(root):
        return []
    return sorted(n for n in os.listdir(root) if os.path.isdir(os.path.join(root, n)) and NAME_RE.match(n))
