#!/usr/bin/env python3
"""Executable append-only evidence store (v1.7 correction of Codex v1.6 finding C16-M3).

In v1.6 the EVIDENCE-ROOT layout was documented prose only: nothing in the bundle could be run to prove that an evidence
root actually refuses an overwrite, actually refuses a second record under a reused attempt id, actually refuses a record
after finalization, or actually detects a replaced record. This module is that law as running code, and validate_v1_7.py
attacks it.

Laws implemented here (EVIDENCE-ROOT.md is the normative prose; this file is the executable authority):

  L1 SESSION CREATION      one directory per session, created with mkdir (fails if it exists), never reused, never
                           reopened for writing after finalization. The session manifest is written once, read-only.
  L2 APPEND ONLY           a record file is created with O_CREAT|O_EXCL|O_WRONLY and mode 0o400. No code path here ever
                           opens an existing record for writing, truncates one, renames over one or unlinks one.
  L3 CONTENT ADDRESSING    the record's path is derived from sha256 of the exact bytes the store computed itself. A
                           caller-declared digest is only ever compared, never trusted (C16-M3 / section 20).
  L4 IDEMPOTENCE           re-putting byte-identical content is a no-op that returns the same path. Same digest with
                           different bytes, and same attempt id with different bytes, are refusals, not overwrites.
  L5 ATTEMPT UNIQUENESS    one getter attempt id maps to exactly one record digest, recorded in an O_EXCL marker file.
  L6 ATOMICITY             bytes are written to a private temp file, fsynced, then hard-linked to the content-addressed
                           path; the temp link is removed. A crash can leave a temp file (reported as PARTIAL_RECORD)
                           but can never leave a partially written record at a content-addressed path.
  L7 FINALIZATION          finalize() re-reads every record, verifies every filename digest against the actual bytes,
                           writes HASHES.json (read-only) and then a FINALIZED marker carrying the HASHES digest.
                           After that the session is immutable: every put() refuses with SESSION_FINALIZED.
  L8 VERIFICATION          verify() recomputes everything from bytes on disk: record digests, the HASHES digest, the
                           session manifest digest, the attempt index, stray temp files. Evidence replacement, HASHES
                           tampering, a missing record and a missing finalization are all detected.
  L9 NO ESCAPE             every path component is a single validated name; no component may be a symlink; the resolved
                           path must stay inside the resolved session directory. Traversal and symlink escape refuse.

Offline, dependency-free, no Resolve, no network. Deterministic: same bytes in, same digests and same HASHES out.
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

EVIDENCE_STORE_VERSION = "vidtoolz.resolveEvidenceStore.v1"
EVIDENCE_SESSION_SCHEMA = "vidtoolz.resolveEvidenceSession.v1"
EVIDENCE_HASHES_SCHEMA = "vidtoolz.resolveEvidenceHashes.v1"
HASHES_DOMAIN = "vidtoolz.resolveEvidenceHashes.v1"
LAYERS = ("RAW", "DERIVED", "HUMAN_REVIEW", "AUTHORITY_PROMOTION")
MAX_RECORD_BYTES = 1 << 22
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$")
SESSION_FILE = "SESSION.json"
HASHES_FILE = "HASHES.json"
FINALIZED_FILE = "FINALIZED"
ATTEMPTS_DIR = "ATTEMPTS"
TMP_DIR = "TMP"
JOURNAL_FILE = "JOURNAL.ndjson"
RESERVED = (SESSION_FILE, HASHES_FILE, FINALIZED_FILE, ATTEMPTS_DIR, TMP_DIR, JOURNAL_FILE)

ERROR_CODES = (
    "ROOT_NOT_A_DIRECTORY", "ROOT_IS_SYMLINK", "SESSION_EXISTS", "SESSION_NOT_FOUND", "SESSION_FINALIZED",
    "SESSION_NOT_FINALIZED", "NAME_INVALID", "PATH_ESCAPE", "SYMLINK_REJECTED", "LAYER_UNKNOWN", "NOT_BYTES",
    "RECORD_TOO_LARGE", "DECLARED_DIGEST_MISMATCH", "ATTEMPT_ID_REUSED", "DIGEST_COLLISION_DIFFERENT_BYTES",
    "OVERWRITE_REJECTED", "RECORD_MISSING", "EVIDENCE_REPLACED", "HASHES_TAMPERED", "PARTIAL_RECORD",
    "PINNED_AUTHORITY_MISMATCH", "MANIFEST_MISSING", "CONTENT_DIGEST_MISMATCH",
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


def hashes_digest(manifest):
    """Domain-tagged digest of a HASHES manifest with its own digest field removed (same law as every other digest here)."""
    return L.digest({k: v for k, v in manifest.items() if k != "hashes_sha256"}, HASHES_DOMAIN)


def _name(n):
    if not isinstance(n, str) or not NAME_RE.match(n) or n in (".", ".."):
        raise EvidenceStoreError("NAME_INVALID", repr(n))
    return n


def _no_symlink(path):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(st.st_mode):
        raise EvidenceStoreError("SYMLINK_REJECTED", path)


def _safe_join(base, *parts):
    """L9. Each part must be one validated name, no component may be a symlink, and the resolved path must stay inside
    the resolved base. Rejects '..', '/', absolute components and symlink escape before any file is touched."""
    for p in parts:
        _name(p)
    real_base = os.path.realpath(base)
    cur = real_base
    for p in parts:
        cur = os.path.join(cur, p)
        _no_symlink(cur)
    want = os.path.normpath(os.path.join(real_base, *parts))
    if cur != want or not (cur == real_base or cur.startswith(real_base + os.sep)):
        raise EvidenceStoreError("PATH_ESCAPE", cur)
    return cur


def _read_exact(path):
    """Read a file without following a symlink at the final component."""
    _no_symlink(path)
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
    """L2/L6. Create-exclusive write of `data` at `path` via a private temp file in the same directory, fsync, hard link,
    unlink temp, fsync the directory. Never truncates, never renames over an existing file."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, ".partial-" + sha256_bytes(data + os.urandom(16))[:32])
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
    line = (json.dumps(entry, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)


def session_manifest(session_id, probe_id, operator, env, active, rp, created_at, stdout_retention="CONTENT_ADDRESSED_RAW_LAYER", stderr_retention="CONTENT_ADDRESSED_RAW_LAYER"):
    """Build the pinned session manifest of section 21: everything an M0A probe session is bound to. The store writes it
    once, read-only, and finalization binds its digest into HASHES.json."""
    shim = L.trusted_capture_shim()
    return {
        "schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
        "evidence_session_schema": EVIDENCE_SESSION_SCHEMA,
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
    """One append-only evidence session on disk. Construct with create_session() or open_session()."""

    def __init__(self, root, session_id):
        self.root = os.path.realpath(root)
        self.session_id = session_id
        self.dir = _safe_join(self.root, session_id)

    # -------------------------------------------------------------- state
    @property
    def finalized(self):
        return os.path.exists(os.path.join(self.dir, FINALIZED_FILE))

    def manifest(self):
        p = os.path.join(self.dir, SESSION_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("MANIFEST_MISSING", p)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def manifest_sha256(self):
        return sha256_bytes(_read_exact(os.path.join(self.dir, SESSION_FILE)))

    def record_path(self, layer, digest):
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        if not L.is_sha(digest):
            raise EvidenceStoreError("NAME_INVALID", digest)
        return _safe_join(self.dir, layer, digest[:2], digest + ".json")

    # -------------------------------------------------------------- write
    def put(self, layer, attempt_id, raw_bytes, declared_digest=None):
        """L2..L6. Store exactly these bytes in `layer` under `attempt_id`. The digest is computed here from the bytes;
        `declared_digest`, if given, is compared and never trusted. Returns
        {digest, layer, attempt_id, path, byte_count, idempotent}."""
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        _name(attempt_id)
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
        os.makedirs(os.path.dirname(final), exist_ok=True)
        idempotent = False
        if os.path.exists(final):
            existing = _read_exact(final)
            if existing != raw_bytes:
                raise EvidenceStoreError("DIGEST_COLLISION_DIFFERENT_BYTES", digest)
            idempotent = True
        else:
            _write_once(final, raw_bytes)
        _append_journal(os.path.join(self.dir, JOURNAL_FILE), {"layer": layer, "attempt_id": attempt_id, "digest": digest, "byte_count": len(raw_bytes), "idempotent": idempotent})
        return {"digest": digest, "layer": layer, "attempt_id": attempt_id, "path": os.path.relpath(final, self.dir), "byte_count": len(raw_bytes), "idempotent": idempotent}

    def put_json(self, layer, attempt_id, obj):
        """Convenience: canonical UTF-8 JSON bytes of `obj`. The bytes are the evidence; the object is not."""
        return self.put(layer, attempt_id, (json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))

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

    def scan(self):
        """Every record on disk as (layer, digest, byte_count, actual_digest). Never trusts a filename."""
        recs = []
        partial = []
        for layer in LAYERS:
            base = os.path.join(self.dir, layer)
            if not os.path.isdir(base):
                continue
            for pre in sorted(os.listdir(base)):
                pd = os.path.join(base, pre)
                if not os.path.isdir(pd):
                    partial.append(os.path.relpath(pd, self.dir))
                    continue
                for fn in sorted(os.listdir(pd)):
                    p = os.path.join(pd, fn)
                    if fn.startswith(".partial-"):
                        partial.append(os.path.relpath(p, self.dir))
                        continue
                    b = _read_exact(p)
                    recs.append({"layer": layer, "digest": fn[:-5] if fn.endswith(".json") else fn, "byte_count": len(b), "actual_sha256": sha256_bytes(b)})
        recs.sort(key=lambda r: (r["layer"], r["digest"]))
        return recs, sorted(partial)

    # -------------------------------------------------------------- finalize / verify
    def finalize(self):
        """L7. Freeze the session: verify every record against its own content-addressed name, write HASHES.json and the
        FINALIZED marker carrying the HASHES digest. Refuses if any record is replaced, missing or partially written."""
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        recs, partial = self.scan()
        if partial:
            raise EvidenceStoreError("PARTIAL_RECORD", ", ".join(partial[:3]))
        for r in recs:
            if r["actual_sha256"] != r["digest"]:
                raise EvidenceStoreError("EVIDENCE_REPLACED", f"{r['layer']}/{r['digest']} holds {r['actual_sha256']}")
        att = self.attempts()
        have = {r["digest"] for r in recs}
        missing = sorted(a for a, d in att.items() if d not in have)
        if missing:
            raise EvidenceStoreError("RECORD_MISSING", f"attempts without a record: {missing[:3]}")
        by_digest = {}
        for a, d in sorted(att.items()):
            by_digest.setdefault(d, []).append(a)
        man = {
            "schema": EVIDENCE_HASHES_SCHEMA,
            "evidence_store_version": EVIDENCE_STORE_VERSION,
            "session_id": self.session_id,
            "session_manifest_sha256": self.manifest_sha256(),
            "record_count": len(recs),
            "total_bytes": sum(r["byte_count"] for r in recs),
            "attempt_count": len(att),
            "records": [{"layer": r["layer"], "digest": r["digest"], "byte_count": r["byte_count"], "attempt_ids": by_digest.get(r["digest"], [])} for r in recs],
        }
        man["hashes_sha256"] = hashes_digest(man)
        _write_once(os.path.join(self.dir, HASHES_FILE), (json.dumps(man, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o444)
        _write_once(os.path.join(self.dir, FINALIZED_FILE), (man["hashes_sha256"] + "\n").encode("ascii"), 0o444)
        return man["hashes_sha256"]

    def hashes(self):
        p = os.path.join(self.dir, HASHES_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("SESSION_NOT_FINALIZED", self.session_id)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def verify(self, require_finalized=True):
        """L8. Recompute the whole session from bytes on disk. Returns a sorted list of error strings, each prefixed with
        one ERROR_CODES code. An empty list means: every record hashes to its own name, the HASHES manifest is the digest
        of itself, the FINALIZED marker matches it, the session manifest is the one HASHES names, every attempt resolves,
        and nothing is partially written."""
        errs = []
        recs, partial = self.scan()
        for p in partial:
            errs.append(f"PARTIAL_RECORD: {p}")
        for r in recs:
            if r["actual_sha256"] != r["digest"]:
                errs.append(f"EVIDENCE_REPLACED: {r['layer']}/{r['digest']} holds {r['actual_sha256']}")
        if not self.finalized:
            if require_finalized:
                errs.append(f"SESSION_NOT_FINALIZED: {self.session_id}")
            return sorted(errs)
        try:
            man = self.hashes()
        except (EvidenceStoreError, L.ParseError, ValueError) as e:
            return sorted(errs + [f"HASHES_TAMPERED: unreadable ({e})"])
        if not isinstance(man, dict) or man.get("schema") != EVIDENCE_HASHES_SCHEMA:
            return sorted(errs + ["HASHES_TAMPERED: wrong schema"])
        if man.get("hashes_sha256") != hashes_digest(man):
            errs.append("HASHES_TAMPERED: hashes_sha256 is not the digest of this manifest")
        marker = _read_exact(os.path.join(self.dir, FINALIZED_FILE)).decode("ascii").strip()
        if marker != man.get("hashes_sha256"):
            errs.append("HASHES_TAMPERED: FINALIZED marker does not name this HASHES manifest")
        if man.get("session_manifest_sha256") != self.manifest_sha256():
            errs.append("HASHES_TAMPERED: session manifest bytes are not the ones HASHES names")
        listed = {(r["layer"], r["digest"]): r for r in man.get("records", [])}
        actual = {(r["layer"], r["digest"]): r for r in recs}
        for k in sorted(set(listed) - set(actual)):
            errs.append(f"RECORD_MISSING: {k[0]}/{k[1]} listed in HASHES but absent")
        for k in sorted(set(actual) - set(listed)):
            errs.append(f"EVIDENCE_REPLACED: {k[0]}/{k[1]} present but not listed in HASHES")
        for k in sorted(set(listed) & set(actual)):
            if listed[k]["byte_count"] != actual[k]["byte_count"]:
                errs.append(f"EVIDENCE_REPLACED: {k[0]}/{k[1]} byte count {actual[k]['byte_count']} != {listed[k]['byte_count']}")
        att = self.attempts()
        have = {r["digest"] for r in recs}
        for a, d in sorted(att.items()):
            if d not in have:
                errs.append(f"RECORD_MISSING: attempt {a} names absent record {d}")
        return sorted(errs)

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
    _no_symlink(root)
    if not os.path.isdir(root):
        raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", root)
    _name(session_id)
    if session_id in RESERVED:
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
    _write_once(os.path.join(d, SESSION_FILE), (json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o444)
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
