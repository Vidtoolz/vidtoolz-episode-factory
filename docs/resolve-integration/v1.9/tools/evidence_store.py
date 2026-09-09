#!/usr/bin/env python3
"""THE evidence store (v1.9). One normative, executable, append-only, closed-world, semantically reconciled
evidence-session authority.

v1.9 corrects Codex's four v1.8 evidence-store findings. v1.8's own corrections (ES-1 closed-world finalization,
ES-2 single store authority with no caller-supplied paths) are retained unchanged and re-run as regressions.

  S19-1  SYMLINKED SESSION ROOT ACCEPTED. v1.8 called os.path.realpath() on the configured root before it had
         established any trust boundary, so a session could be created, finalized and verified through a symlinked
         evidence root: the symlink was resolved away and never seen. v1.9 establishes the root trust boundary FIRST,
         with lstat and no resolution, and records the root's device+inode so a later root substitution is detected.

  S19-2  INVENTORY / SESSION SEMANTICS INCOMPLETE. v1.8's inventory reconciled bytes, paths, byte counts and
         directories, but nothing tied a session's bytes to its identity, so renaming a finalized session directory
         (or copying it beside another) still verified clean. v1.9 freezes a canonical session identity tuple, binds
         the session directory basename to session_id, and reconciles record semantics - layer, logical identity,
         attempt identity, record-internal session and probe ids - against the inventory and the session manifest.

  S19-3  ATTEMPT ID BINDING TOO WEAK. v1.8 keyed attempt uniqueness on the attempt id alone and bound it only to a
         digest, so one attempt id could produce records in two layers under two logical identities. v1.9 makes the
         canonical attempt key the tuple (session_id, layer, logical_identity, attempt_id) bound to the record bytes,
         and refuses cross-layer and cross-identity reuse of an attempt id by name.

  S19-4  FINALIZED PERMISSION CHANGE UNDETECTED. v1.8 recorded no filesystem metadata, so chmod after finalization was
         invisible. v1.9 records file type and permission mode for every governed file and directory, sets canonical
         modes explicitly rather than relying on umask, and reports MODE_MISMATCH on any change.

Laws (EVIDENCE-ROOT.md is the normative prose; this file is the executable authority):

  L1  ROOT TRUST BOUNDARY  the configured evidence root and the session directory entry are inspected with lstat
                           BEFORE any resolution. A symlink at either is refused. The boundary records the root's
                           device and inode; every later operation re-checks them, so replacing the root with a
                           symlink or another directory between operations is detected.
  L2  LSTAT FIRST          every governed entry - root, session, layer directories, records, attempt markers,
                           inventory, finalized marker - is classified by its own directory entry, never by its
                           target. Symlinks are refused before they are followed. Reads use O_NOFOLLOW.
  L3  SESSION IDENTITY     a session is identified by a frozen tuple (session id, probe id, authority version and
                           manifest, store version, host/product/version/build, library, trusted shim, primitive
                           spec, schema registry, directory basename), digested into session_identity_sha256. The
                           manifest, the inventory and the finalization marker must all carry the same value.
  L4  SESSION PATH         the session directory basename IS the session id, exactly. Policy A: no encoding, no free
                           rename. The verifier recomputes the expected basename and compares it to the actual entry.
  L5  RECORD SEMANTICS     a record's storage name is its semantic key,
                           sha256(domain + session id + layer + logical identity + content digest). The verifier
                           recomputes it from the record's semantics and compares it to the actual path, so a record
                           moved to another layer or rebound to another logical identity fails.
  L6  ATTEMPT TUPLE        attempt uniqueness is keyed on (session_id, layer, logical_identity, attempt_id) and bound
                           to the record bytes. Same tuple and same bytes is idempotent; same tuple and different
                           bytes is ATTEMPT_ID_REUSED; the same attempt id under a different layer or a different
                           logical identity is refused by name.
  L7  APPEND ONLY          records are created O_CREAT|O_EXCL|O_WRONLY, then chmod to the canonical mode. Nothing here
                           opens an existing record for writing, truncates one, renames over one or unlinks one.
  L8  CONTENT ADDRESSING   the content digest is computed by this module from the exact bytes. A caller-declared
                           digest is only ever compared. A caller never supplies a path.
  L9  CLOSED WORLD         finalization records the complete allowed inventory of every governed file and directory,
                           with type and mode. Verification requires missing == 0, unexpected == 0, changed == 0 and
                           semantic_mismatch == 0.
  L10 MODE AUTHORITY       canonical modes are set explicitly, never left to umask, and are part of the frozen
                           inventory. POSIX permission bits and file type only: no inode, no timestamps, no owner.
  L11 SESSION STATE        exactly one of ACTIVE, PARTIAL, FINALIZED, INVALID.

Platform scope: this reference implementation is qualified on POSIX (Linux, the host this bundle is validated on).
Permission-mode and file-type verification are POSIX semantics. No Windows parity is claimed, implemented or tested.

Offline, dependency-free, no Resolve, no network. Deterministic: same bytes in, same digests and same inventory out.

This module DETECTS hostile mutation of a finalized session; it does not prevent it at the operating-system level, and
it does not claim to close every time-of-check/time-of-use window. A privileged local process can always edit bytes on
disk. The guarantee is that verification then fails, with a closed refusal code.
"""
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

EVIDENCE_STORE_VERSION = "vidtoolz.resolveEvidenceStore.v3"
EVIDENCE_SESSION_SCHEMA = "vidtoolz.resolveEvidenceSession.v3"
EVIDENCE_INVENTORY_SCHEMA = "vidtoolz.resolveEvidenceInventory.v2"
EVIDENCE_FINALIZATION_SCHEMA = "vidtoolz.resolveEvidenceFinalization.v1"
INVENTORY_DOMAIN = "vidtoolz.resolveEvidenceInventory.v2"
SESSION_IDENTITY_DOMAIN = "vidtoolz.resolveEvidenceSessionIdentity.v1"
RECORD_KEY_DOMAIN = "vidtoolz.resolveEvidenceRecordKey.v1"
ATTEMPT_KEY_DOMAIN = "vidtoolz.resolveEvidenceAttemptKey.v1"
AUTHORITY_CLASS = "EVIDENCE_STORE_AUTHORIZING"  # exactly one module may carry this
PLATFORM_SCOPE = "POSIX"
LAYERS = ("RAW", "DERIVED", "HUMAN_REVIEW", "AUTHORITY_PROMOTION")
MAX_RECORD_BYTES = 1 << 22
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

# ---- L10 canonical modes. Set explicitly after creation so the process umask can never decide them.
MODE_DIR = 0o700
MODE_RECORD = 0o400
MODE_SESSION = 0o444
MODE_INVENTORY = 0o444
MODE_FINALIZED = 0o444
MODE_ATTEMPT = 0o400
MODE_JOURNAL = 0o600
CANONICAL_MODES = {"DIRECTORY": MODE_DIR, "RECORD": MODE_RECORD, "SESSION_MANIFEST": MODE_SESSION,
                   "INVENTORY": MODE_INVENTORY, "FINALIZATION_MARKER": MODE_FINALIZED,
                   "ATTEMPT_MARKER": MODE_ATTEMPT, "JOURNAL": MODE_JOURNAL}

ERROR_CODES = (
    "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_REPLACED", "SESSION_SYMLINK_REFUSED", "SESSION_EXISTS",
    "SESSION_NOT_FOUND", "SESSION_FINALIZED", "SESSION_NOT_FINALIZED", "SESSION_IDENTITY_MISMATCH",
    "SESSION_PATH_MISMATCH", "NAME_INVALID", "PATH_ESCAPE", "SYMLINK_REJECTED", "FILE_TYPE_REJECTED", "LAYER_UNKNOWN",
    "LAYER_IDENTITY_MISMATCH", "LOGICAL_IDENTITY_MISMATCH", "LOGICAL_IDENTITY_INVALID", "RECORD_KEY_MISMATCH",
    "NOT_BYTES", "RECORD_TOO_LARGE", "DECLARED_DIGEST_MISMATCH", "ATTEMPT_ID_REUSED", "ATTEMPT_ID_CROSS_LAYER",
    "ATTEMPT_ID_CROSS_IDENTITY", "ATTEMPT_TUPLE_DUPLICATE", "DIGEST_COLLISION_DIFFERENT_BYTES", "OVERWRITE_REJECTED",
    "RECORD_MISSING", "EVIDENCE_REPLACED", "UNEXPECTED_ENTRY", "INVENTORY_TAMPERED", "INVENTORY_DUPLICATE_KEY",
    "MODE_MISMATCH", "PARTIAL_RECORD", "PINNED_AUTHORITY_MISMATCH", "MANIFEST_MISSING", "CONTENT_DIGEST_MISMATCH",
    "INTERNAL_IDENTITY_MISMATCH", "FINALIZATION_MARKER_INVALID",
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
    return (json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def inventory_digest(inv):
    return L.digest({k: v for k, v in inv.items() if k != "inventory_sha256"}, INVENTORY_DOMAIN)


# ================================================================ L1/L2 the root trust boundary
def _lstat_entry(path):
    """The directory ENTRY itself, never its target. Returns None when absent."""
    try:
        return os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        return None


def _name(n, code="NAME_INVALID"):
    """One logical name or a refusal. The ONLY way a caller-supplied string reaches the filesystem."""
    if not isinstance(n, str) or not NAME_RE.match(n) or n in (".", ".."):
        raise EvidenceStoreError(code, repr(n))
    return n


class RootBoundary:
    """L1. The established trust boundary of one evidence root.

    Establishment inspects the configured root path with lstat and WITHOUT resolving it first, which is the defect
    Codex reported as S19-1: v1.8 called realpath() up front, so a symlinked root was resolved away and never seen.
    The literal path is kept as the boundary; the root's device and inode are captured so that a later substitution of
    the root - by a symlink or by another directory - is detected on the next operation."""

    __slots__ = ("path", "dev", "ino")

    def __init__(self, root):
        if not isinstance(root, str) or not root:
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", repr(root))
        path = os.path.abspath(root)
        st = _lstat_entry(path)
        if st is None:
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", path)
        if stat.S_ISLNK(st.st_mode):
            raise EvidenceStoreError("ROOT_SYMLINK_REFUSED", path)
        if not stat.S_ISDIR(st.st_mode):
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", path)
        self.path = path
        self.dev = st.st_dev
        self.ino = st.st_ino

    def check(self):
        """Re-establish that the root is still the same directory entry it was, by device and inode.

        Honest scope: this DETECTS a root replaced by a symlink (a type change, always caught) or by a different
        directory (an inode change). It is not a time-of-check/time-of-use guarantee, and a replacement that happens
        to reuse the freed inode number is not claimed to be detected. A privileged local process can still race the
        filesystem; what this buys is that the ordinary substitution attack does not pass silently."""
        st = _lstat_entry(self.path)
        if st is None:
            raise EvidenceStoreError("ROOT_REPLACED", f"{self.path} no longer exists")
        if stat.S_ISLNK(st.st_mode):
            raise EvidenceStoreError("ROOT_SYMLINK_REFUSED", self.path)
        if not stat.S_ISDIR(st.st_mode):
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", self.path)
        if (st.st_dev, st.st_ino) != (self.dev, self.ino):
            raise EvidenceStoreError("ROOT_REPLACED", f"{self.path} is a different directory than the established root")
        return self.path

    def session_dir(self, session_id):
        """L1/L4. The session directory entry, inspected with lstat before it is used for anything."""
        _name(session_id)
        d = os.path.join(self.check(), session_id)
        st = _lstat_entry(d)
        if st is not None:
            if stat.S_ISLNK(st.st_mode):
                raise EvidenceStoreError("SESSION_SYMLINK_REFUSED", d)
            if not stat.S_ISDIR(st.st_mode):
                raise EvidenceStoreError("FILE_TYPE_REJECTED", f"session entry is not a directory: {d}")
        return d


def _reject_non_regular(path, allow_dir=False):
    """L2. Refuse a symlink, FIFO, socket or device. Regular files (and directories when allowed) only."""
    st = _lstat_entry(path)
    if st is None:
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
    """L2. Each part is one validated logical name; no component may be a symlink; the joined path must stay inside the
    base. The base here is already an established trust boundary, so this function never resolves it away."""
    for p in parts:
        _name(p)
    cur = base
    for p in parts:
        cur = os.path.join(cur, p)
        _reject_non_regular(cur, allow_dir=True)
    want = os.path.normpath(os.path.join(base, *parts))
    if cur != want or not (cur == base or cur.startswith(base + os.sep)):
        raise EvidenceStoreError("PATH_ESCAPE", cur)
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


def _write_once(path, data, mode):
    """L7/L10. Create-exclusive write via a private temp file in the same directory, fsync, hard link, unlink temp,
    then chmod to the canonical mode so the process umask never decides it. Never truncates, never renames over an
    existing file, never unlinks a final record."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, PARTIAL_PREFIX + sha256_bytes(data + os.urandom(16))[:32])
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
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
    os.chmod(path, mode)
    dfd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def _mkdir(path):
    os.mkdir(path)
    os.chmod(path, MODE_DIR)


def _append_journal(path, entry):
    line = canonical_json_bytes(entry)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(path, MODE_JOURNAL)


# ================================================================ L3/L5/L6 identity law
SESSION_IDENTITY_FIELDS = ("session_id", "probe_id", "authority_version", "authority_manifest_sha256",
                           "evidence_store_version", "host_name", "product", "resolve_version", "build",
                           "library_name", "library_uuid", "library_root", "trusted_shim_sha256",
                           "primitive_spec_sha256", "schema_registry_sha256", "session_dir_basename")


def session_identity(manifest, dir_basename):
    """L3. The canonical session identity tuple and its digest. Everything that identifies WHICH session this is, in
    one place, so a directory rename or a cross-session copy cannot leave the bytes looking valid."""
    tup = {k: (dir_basename if k == "session_dir_basename" else (manifest or {}).get(k)) for k in SESSION_IDENTITY_FIELDS}
    return tup, L.digest(tup, SESSION_IDENTITY_DOMAIN)


def record_key(session_id, layer, logical_identity, content_digest):
    """L5. The deterministic mapping from record SEMANTICS to storage name. The verifier recomputes this and compares
    it to the actual path, so a record moved to another layer, or rebound to another logical identity, fails."""
    return L.digest({"session_id": session_id, "layer": layer, "logical_identity": logical_identity,
                     "content_sha256": content_digest}, RECORD_KEY_DOMAIN)


def attempt_key(session_id, layer, logical_identity, attempt_id):
    """L6. The canonical attempt uniqueness key: the tuple, not the digest."""
    return L.digest({"session_id": session_id, "layer": layer, "logical_identity": logical_identity,
                     "attempt_id": attempt_id}, ATTEMPT_KEY_DOMAIN)


def expected_record_path(layer, key):
    return os.path.join(layer, key[:2], key + ".json")


def _internal_ids(raw_bytes):
    """Record-internal identity, when the record is a JSON object that carries it. Recorded in the inventory either
    way, so a later appearance or disappearance of these fields is itself a detected change."""
    try:
        obj = L.strict_loads(raw_bytes.decode("utf-8"))
    except Exception:  # noqa: BLE001 - a non-JSON record simply has no internal identity
        return None, None
    if not isinstance(obj, dict):
        return None, None
    sid = obj.get("session_id")
    pid = obj.get("probe_id")
    for k in ("capture", "derived"):
        inner = obj.get(k)
        if isinstance(inner, dict):
            sid = sid if sid is not None else inner.get("session_id")
            pid = pid if pid is not None else inner.get("probe_id")
    return (sid if isinstance(sid, str) else None), (pid if isinstance(pid, str) else None)


def session_manifest(session_id, probe_id, operator, env, active, rp, created_at,
                     stdout_retention="CONTENT_ADDRESSED_RAW_LAYER", stderr_retention="CONTENT_ADDRESSED_RAW_LAYER"):
    """The pinned session manifest, closed by its own session identity digest (L3)."""
    shim = L.trusted_capture_shim()
    m = {
        "schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
        "evidence_session_schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_inventory_schema": EVIDENCE_INVENTORY_SCHEMA,
        "evidence_finalization_schema": EVIDENCE_FINALIZATION_SCHEMA,
        "session_id": session_id,
        "session_dir_basename": session_id,
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
        "platform_scope": PLATFORM_SCOPE,
    }
    m["session_identity_sha256"] = session_identity(m, session_id)[1]
    return m


class EvidenceStore:
    """One append-only evidence session on disk, behind an established root trust boundary.

    Callers never supply a path. They supply a layer, an attempt id, a logical identity and bytes; this class derives
    the semantic key, the content-addressed destination and the attempt tuple."""

    def __init__(self, boundary, session_id):
        self.boundary = boundary if isinstance(boundary, RootBoundary) else RootBoundary(boundary)
        self.session_id = session_id
        self.dir = self.boundary.session_dir(session_id)

    @property
    def root(self):
        return self.boundary.path

    # -------------------------------------------------------------- state
    @property
    def finalized(self):
        return os.path.exists(os.path.join(self.dir, FINALIZED_FILE))

    def session_state(self):
        """L11."""
        self.boundary.check()
        if not os.path.isdir(self.dir) or not os.path.exists(os.path.join(self.dir, SESSION_FILE)):
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

    def identity(self):
        """L3/L4. The session identity recomputed from the manifest on disk and the ACTUAL directory basename."""
        m = self.manifest()
        return session_identity(m, os.path.basename(self.dir))

    def identity_errors(self):
        """L3/L4. Reconcile the manifest, the declared identity digest and the directory the session actually lives in."""
        errs = []
        try:
            m = self.manifest()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            return [f"MANIFEST_MISSING: {e}"]
        base = os.path.basename(self.dir)
        if m.get("session_id") != base:
            errs.append(f"SESSION_PATH_MISMATCH: manifest session_id {m.get('session_id')!r} but directory basename {base!r}")
        if m.get("session_dir_basename") != base:
            errs.append(f"SESSION_PATH_MISMATCH: manifest session_dir_basename {m.get('session_dir_basename')!r} but directory basename {base!r}")
        _tup, dig = session_identity(m, base)
        if m.get("session_identity_sha256") != dig:
            errs.append("SESSION_IDENTITY_MISMATCH: session_identity_sha256 is not the digest of this session's identity tuple in this directory")
        return errs

    def record_path(self, layer, key):
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        if not L.is_sha(key):
            raise EvidenceStoreError("NAME_INVALID", key)
        return _safe_join(self.dir, layer, key[:2], key + ".json")

    # -------------------------------------------------------------- write
    def _put(self, layer, attempt_id, raw_bytes, logical_identity, declared_digest=None):
        """L5..L8. The ONE write path."""
        self.boundary.check()
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        _name(attempt_id)
        if logical_identity is None:
            raise EvidenceStoreError("LOGICAL_IDENTITY_INVALID", "a logical identity is required (v1.9, S19-3)")
        _name(logical_identity, "LOGICAL_IDENTITY_INVALID")
        if not isinstance(raw_bytes, (bytes, bytearray)):
            raise EvidenceStoreError("NOT_BYTES", type(raw_bytes).__name__)
        raw_bytes = bytes(raw_bytes)
        if len(raw_bytes) > MAX_RECORD_BYTES:
            raise EvidenceStoreError("RECORD_TOO_LARGE", len(raw_bytes))
        digest = sha256_bytes(raw_bytes)
        if declared_digest is not None and declared_digest != digest:
            raise EvidenceStoreError("DECLARED_DIGEST_MISMATCH", f"declared {declared_digest} actual {digest}")

        # ---- L6 attempt tuple. One marker per attempt id carries the whole canonical tuple, so a cross-layer or
        # cross-identity reuse of the id is refused by name rather than silently producing a second record.
        marker = _safe_join(self.dir, ATTEMPTS_DIR, attempt_id)
        tup = {"session_id": self.session_id, "layer": layer, "logical_identity": logical_identity,
               "attempt_id": attempt_id, "content_sha256": digest,
               "attempt_key": attempt_key(self.session_id, layer, logical_identity, attempt_id)}
        try:
            _write_once(marker, canonical_json_bytes(tup), MODE_ATTEMPT)
        except EvidenceStoreError as e:
            if e.code != "OVERWRITE_REJECTED":
                raise
            prev = L.strict_loads(_read_exact(marker).decode("utf-8"))
            if prev.get("layer") != layer:
                raise EvidenceStoreError("ATTEMPT_ID_CROSS_LAYER", f"{attempt_id} already bound to layer {prev.get('layer')}, cannot also serve {layer}")
            if prev.get("logical_identity") != logical_identity:
                raise EvidenceStoreError("ATTEMPT_ID_CROSS_IDENTITY", f"{attempt_id} already bound to logical identity {prev.get('logical_identity')!r}, cannot also serve {logical_identity!r}")
            if prev.get("session_id") != self.session_id:
                raise EvidenceStoreError("SESSION_IDENTITY_MISMATCH", f"attempt marker {attempt_id} names session {prev.get('session_id')!r}")
            if prev.get("content_sha256") != digest:
                raise EvidenceStoreError("ATTEMPT_ID_REUSED", f"{attempt_id} already bound to {prev.get('content_sha256')}")

        key = record_key(self.session_id, layer, logical_identity, digest)
        final = self.record_path(layer, key)
        shard = os.path.dirname(final)
        if not os.path.isdir(shard):
            _mkdir(shard)
        idempotent = False
        if os.path.exists(final):
            existing = _read_exact(final)
            if existing != raw_bytes:
                raise EvidenceStoreError("DIGEST_COLLISION_DIFFERENT_BYTES", digest)
            idempotent = True
        else:
            _write_once(final, raw_bytes, MODE_RECORD)
        _append_journal(os.path.join(self.dir, JOURNAL_FILE),
                        {"layer": layer, "attempt_id": attempt_id, "logical_identity": logical_identity,
                         "content_sha256": digest, "record_key": key, "byte_count": len(raw_bytes),
                         "idempotent": idempotent})
        return {"digest": digest, "content_sha256": digest, "record_key": key, "layer": layer,
                "attempt_id": attempt_id, "logical_identity": logical_identity,
                "attempt_key": tup["attempt_key"], "path": os.path.relpath(final, self.dir),
                "byte_count": len(raw_bytes), "idempotent": idempotent}

    def put(self, layer, attempt_id, raw_bytes, declared_digest=None, logical_identity=None):
        return self._put(layer, attempt_id, raw_bytes, logical_identity, declared_digest)

    def put_json(self, layer, attempt_id, obj, logical_identity=None):
        return self._put(layer, attempt_id, canonical_json_bytes(obj), logical_identity)

    def put_raw(self, attempt_id, raw_bytes, logical_identity=None):
        return self._put("RAW", attempt_id, raw_bytes, logical_identity)

    def put_derived(self, attempt_id, content, logical_identity=None):
        return self._put("DERIVED", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    def put_review(self, attempt_id, content, logical_identity=None):
        return self._put("HUMAN_REVIEW", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    def put_promotion(self, attempt_id, content, logical_identity=None):
        return self._put("AUTHORITY_PROMOTION", attempt_id, content if isinstance(content, (bytes, bytearray)) else canonical_json_bytes(content), logical_identity)

    # -------------------------------------------------------------- read
    def get(self, layer, key):
        p = self.record_path(layer, key)
        if not os.path.exists(p):
            raise EvidenceStoreError("RECORD_MISSING", key)
        return _read_exact(p)

    def attempts(self):
        """L6/S19-3 (section 13). Built from a LIST first: duplicate tuple keys are refused before any map exists."""
        d = os.path.join(self.dir, ATTEMPTS_DIR)
        pairs = []
        for n in sorted(os.listdir(d)):
            p = os.path.join(d, n)
            _reject_non_regular(p)
            try:
                t = L.strict_loads(_read_exact(p).decode("utf-8"))
            except (L.ParseError, ValueError, UnicodeDecodeError) as e:
                raise EvidenceStoreError("INVENTORY_TAMPERED", f"attempt marker {n} unreadable ({e})")
            pairs.append((n, t))
        seen = {}
        for n, t in pairs:
            k = t.get("attempt_key")
            if k in seen:
                raise EvidenceStoreError("ATTEMPT_TUPLE_DUPLICATE", f"{n} and {seen[k]} share attempt key {str(k)[:12]}")
            seen[k] = n
        return dict(pairs)

    # -------------------------------------------------------------- enumeration
    def _partials(self):
        out = []
        for dp, _dns, fns in os.walk(self.dir):
            for n in fns:
                if n.startswith(PARTIAL_PREFIX):
                    out.append(os.path.relpath(os.path.join(dp, n), self.dir))
        return sorted(out)

    def scan_tree(self):
        """L2/L9/L10. Every entry under the session root, at any depth: files, directories, and anything that is
        neither. Each carries its own file type and permission mode, taken from lstat, never from the target."""
        files, dirs, partials, bad = {}, {}, [], []
        for dp, dns, fns in os.walk(self.dir, followlinks=False):
            rel_dir = os.path.relpath(dp, self.dir)
            if rel_dir != ".":
                dirs[rel_dir] = {"mode": stat.S_IMODE(os.lstat(dp).st_mode), "file_type": "DIRECTORY"}
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
                files[rel] = {"byte_count": len(b), "sha256": sha256_bytes(b),
                              "mode": stat.S_IMODE(st.st_mode), "file_type": "REGULAR", "_bytes": b}
        return files, dirs, sorted(partials), sorted(bad)

    def _expected_dirs(self, record_rels):
        exp = set(LAYERS) | {ATTEMPTS_DIR, TMP_DIR}
        for rel in record_rels:
            parts = rel.split(os.sep)
            if len(parts) == 3:
                exp.add(parts[0])
                exp.add(os.path.join(parts[0], parts[1]))
        return exp

    # -------------------------------------------------------------- finalize / verify
    def finalize(self):
        """L9. The finalization transaction: establish the root, reconcile identity, refuse partial and non-regular
        entries, enumerate every governed entry with type and mode, reconcile every record's semantics, write the
        inventory atomically, then the finalization marker that binds session identity to the inventory digest."""
        self.boundary.check()
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        ie = self.identity_errors()
        if ie:
            raise EvidenceStoreError("SESSION_IDENTITY_MISMATCH" if "IDENTITY" in ie[0] else "SESSION_PATH_MISMATCH", ie[0])
        manifest = self.manifest()
        files, dirs, partials, bad = self.scan_tree()
        if partials:
            raise EvidenceStoreError("PARTIAL_RECORD", ", ".join(partials[:3]))
        if bad:
            kind, rel = bad[0]
            raise EvidenceStoreError("SYMLINK_REJECTED" if kind == "SYMLINK" else "FILE_TYPE_REJECTED", f"{kind} at {rel}")
        att = self.attempts()
        by_key = {}
        for n, t in att.items():
            by_key.setdefault((t.get("layer"), t.get("logical_identity"), t.get("content_sha256")), []).append(n)
        entries = []
        seen_paths = set()
        for rel in sorted(files):
            meta = files[rel]
            if rel in seen_paths:
                raise EvidenceStoreError("INVENTORY_DUPLICATE_KEY", rel)
            seen_paths.add(rel)
            parts = rel.split(os.sep)
            is_record = len(parts) == 3 and parts[0] in LAYERS and parts[2].endswith(".json")
            if is_record:
                layer, key = parts[0], parts[2][:-5]
                # Resolve the logical identity by the RECORD KEY, never by (layer, digest): identical bytes may
                # legitimately be stored under two logical identities, and each gets its own key. Matching on the key
                # is exact, so a record can never borrow another identity's binding.
                tuples = [t for t in att.values()
                          if t.get("layer") == layer and t.get("content_sha256") == meta["sha256"]
                          and record_key(self.session_id, layer, t.get("logical_identity"), meta["sha256"]) == key]
                if not tuples:
                    raise EvidenceStoreError("LOGICAL_IDENTITY_MISMATCH", f"{rel} has no attempt whose (layer, logical identity, content) recomputes this record key")
                logical = tuples[0].get("logical_identity")
                if len({t.get("logical_identity") for t in tuples}) != 1:
                    raise EvidenceStoreError("LOGICAL_IDENTITY_MISMATCH", f"{rel} is claimed by two logical identities")
                isid, ipid = _internal_ids(meta["_bytes"])
                entries.append({"path": rel, "kind": "RECORD", "layer": layer, "record_key": key,
                                "content_sha256": meta["sha256"], "byte_count": meta["byte_count"],
                                "file_type": meta["file_type"], "mode": meta["mode"], "schema_type": "EVIDENCE_RECORD",
                                "logical_identity": logical, "internal_session_id": isid, "internal_probe_id": ipid,
                                "attempt_ids": sorted(t["attempt_id"] for t in tuples),
                                "attempt_keys": sorted(t["attempt_key"] for t in tuples)})
            else:
                kind = {SESSION_FILE: "SESSION_MANIFEST", JOURNAL_FILE: "JOURNAL"}.get(
                    rel, "ATTEMPT_MARKER" if rel.startswith(ATTEMPTS_DIR + os.sep) else "OTHER")
                entries.append({"path": rel, "kind": kind, "layer": None, "record_key": None,
                                "content_sha256": meta["sha256"], "byte_count": meta["byte_count"],
                                "file_type": meta["file_type"], "mode": meta["mode"], "schema_type": kind,
                                "logical_identity": None, "internal_session_id": None, "internal_probe_id": None,
                                "attempt_ids": [], "attempt_keys": []})
        exp_dirs = self._expected_dirs([e["path"] for e in entries if e["kind"] == "RECORD"])
        unexpected_dirs = sorted(set(dirs) - exp_dirs)
        if unexpected_dirs:
            raise EvidenceStoreError("UNEXPECTED_ENTRY", f"directory {unexpected_dirs[0]}")
        _tup, ident = session_identity(manifest, os.path.basename(self.dir))
        inv = {
            "schema": EVIDENCE_INVENTORY_SCHEMA,
            "evidence_store_version": EVIDENCE_STORE_VERSION,
            "platform_scope": PLATFORM_SCOPE,
            "session_id": self.session_id,
            "session_dir_basename": os.path.basename(self.dir),
            "session_identity_sha256": ident,
            "session_manifest_sha256": self.manifest_sha256(),
            "closed_world": True,
            "semantic_reconciliation": True,
            "record_count": sum(1 for e in entries if e["kind"] == "RECORD"),
            "entry_count": len(entries),
            "total_bytes": sum(e["byte_count"] for e in entries),
            "attempt_count": len(att),
            "directories": [{"path": p, "file_type": "DIRECTORY", "mode": dirs.get(p, {}).get("mode", MODE_DIR)} for p in sorted(exp_dirs)],
            "canonical_modes": {k: v for k, v in sorted(CANONICAL_MODES.items())},
            "self_path": INVENTORY_FILE,
            "finalized_marker_path": FINALIZED_FILE,
            "entries": entries,
        }
        inv["inventory_sha256"] = inventory_digest(inv)
        _write_once(os.path.join(self.dir, INVENTORY_FILE),
                    (json.dumps(inv, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), MODE_INVENTORY)
        marker = {"schema": EVIDENCE_FINALIZATION_SCHEMA, "evidence_store_version": EVIDENCE_STORE_VERSION,
                  "authority_version": L.AUTHORITY_VERSION, "session_id": self.session_id,
                  "session_identity_sha256": ident, "inventory_sha256": inv["inventory_sha256"], "state": "FINALIZED"}
        _write_once(os.path.join(self.dir, FINALIZED_FILE), canonical_json_bytes(marker), MODE_FINALIZED)
        return inv["inventory_sha256"]

    def inventory(self):
        p = os.path.join(self.dir, INVENTORY_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("SESSION_NOT_FINALIZED", self.session_id)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def finalization_marker(self):
        p = os.path.join(self.dir, FINALIZED_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("SESSION_NOT_FINALIZED", self.session_id)
        return L.strict_loads(_read_exact(p).decode("utf-8"))

    def verify_summary(self, require_finalized=True):
        """L9. Returns (errors, counts). PASS requires missing == 0, unexpected == 0, changed == 0 and
        semantic_mismatch == 0."""
        errs = []
        counts = {"missing": 0, "unexpected": 0, "changed": 0, "semantic_mismatch": 0}

        def add(bucket, msg):
            counts[bucket] += 1
            errs.append(msg)

        try:
            self.boundary.check()
        except EvidenceStoreError as e:
            return [f"{e.code}: {e.detail}"], dict(counts, semantic_mismatch=1)
        if not os.path.isdir(self.dir):
            return [f"SESSION_NOT_FOUND: {self.session_id}"], dict(counts, missing=1)
        files, dirs, partials, bad = self.scan_tree()
        for rel in partials:
            add("unexpected", f"PARTIAL_RECORD: {rel}")
        for kind, rel in bad:
            add("unexpected", f"SYMLINK_REJECTED: {rel}" if kind == "SYMLINK" else f"FILE_TYPE_REJECTED: {kind} at {rel}")
        for e in self.identity_errors():
            add("semantic_mismatch", e)
        if not self.finalized:
            if require_finalized:
                errs.append(f"SESSION_NOT_FINALIZED: {self.session_id}")
            return sorted(set(errs)), counts
        try:
            inv = self.inventory()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            add("changed", f"INVENTORY_TAMPERED: unreadable ({e})")
            return sorted(set(errs)), counts
        if not isinstance(inv, dict) or inv.get("schema") != EVIDENCE_INVENTORY_SCHEMA or inv.get("closed_world") is not True or inv.get("semantic_reconciliation") is not True:
            add("changed", "INVENTORY_TAMPERED: wrong schema or not a closed-world semantically reconciled inventory")
            return sorted(set(errs)), counts
        if inv.get("inventory_sha256") != inventory_digest(inv):
            add("changed", "INVENTORY_TAMPERED: inventory_sha256 is not the digest of this inventory")
        # ---- L3 session identity across manifest, inventory and marker
        try:
            m = self.manifest()
            _t, ident = session_identity(m, os.path.basename(self.dir))
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            add("semantic_mismatch", f"MANIFEST_MISSING: {e}")
            ident = None
        if ident is not None:
            if inv.get("session_identity_sha256") != ident:
                add("semantic_mismatch", "SESSION_IDENTITY_MISMATCH: the inventory names another session identity than this directory holds")
            if inv.get("session_id") != self.session_id or inv.get("session_dir_basename") != os.path.basename(self.dir):
                add("semantic_mismatch", "SESSION_PATH_MISMATCH: the inventory names another session id or directory basename")
        try:
            mk = self.finalization_marker()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            add("changed", f"FINALIZATION_MARKER_INVALID: unreadable ({e})")
            mk = None
        if mk is not None:
            if mk.get("schema") != EVIDENCE_FINALIZATION_SCHEMA or mk.get("state") != "FINALIZED":
                add("changed", "FINALIZATION_MARKER_INVALID: wrong schema or state")
            if mk.get("inventory_sha256") != inv.get("inventory_sha256"):
                add("changed", "FINALIZATION_MARKER_INVALID: marker does not name this inventory")
            if ident is not None and mk.get("session_identity_sha256") != ident:
                add("semantic_mismatch", "SESSION_IDENTITY_MISMATCH: the finalization marker belongs to another session")
            if mk.get("session_id") != self.session_id:
                add("semantic_mismatch", "SESSION_IDENTITY_MISMATCH: the finalization marker names another session id")
        if inv.get("session_manifest_sha256") != files.get(SESSION_FILE, {}).get("sha256"):
            add("changed", "INVENTORY_TAMPERED: session manifest bytes are not the ones the inventory names")
        # ---- L9 closed world over files
        raw_entries = inv.get("entries", [])
        expected, dup = {}, []
        for e in raw_entries:
            if not isinstance(e, dict) or not isinstance(e.get("path"), str):
                continue
            if e["path"] in expected:
                dup.append(e["path"])
            expected[e["path"]] = e
        for p in sorted(set(dup)):
            add("changed", f"INVENTORY_DUPLICATE_KEY: {p} appears more than once in the inventory")
        keyseen = {}
        for e in raw_entries:
            if isinstance(e, dict) and e.get("kind") == "RECORD":
                k = (e.get("layer"), e.get("record_key"))
                if k in keyseen:
                    add("changed", f"INVENTORY_DUPLICATE_KEY: record key {str(k[1])[:12]} appears twice in {k[0]}")
                keyseen[k] = e["path"]
                for ak in e.get("attempt_keys") or []:
                    if ak in keyseen:
                        add("changed", f"INVENTORY_DUPLICATE_KEY: attempt key {str(ak)[:12]} appears twice")
                    keyseen[ak] = e["path"]
        governed = {rel: m2 for rel, m2 in files.items() if rel not in (INVENTORY_FILE, FINALIZED_FILE)}
        for rel in sorted(set(expected) - set(governed)):
            add("missing", f"RECORD_MISSING: {rel} is recorded in the inventory but absent on disk")
        for rel in sorted(set(governed) - set(expected)):
            add("unexpected", f"UNEXPECTED_ENTRY: {rel} is present on disk but not in the finalized inventory")
        for rel in sorted(set(expected) & set(governed)):
            e, m2 = expected[rel], governed[rel]
            if e.get("content_sha256") != m2["sha256"]:
                add("changed", f"EVIDENCE_REPLACED: {rel} holds {m2['sha256']}, inventory records {e.get('content_sha256')}")
            if e.get("byte_count") != m2["byte_count"]:
                add("changed", f"EVIDENCE_REPLACED: {rel} byte count {m2['byte_count']} != inventory {e.get('byte_count')}")
            if e.get("file_type") != m2["file_type"]:
                add("changed", f"FILE_TYPE_REJECTED: {rel} is {m2['file_type']}, inventory records {e.get('file_type')}")
            if e.get("mode") != m2["mode"]:
                add("changed", f"MODE_MISMATCH: {rel} mode {m2['mode']:#o}, inventory records {(e.get('mode') or 0):#o}")
            # ---- L5 semantic reconciliation of every record
            if e.get("kind") == "RECORD":
                parts = rel.split(os.sep)
                path_layer = parts[0] if len(parts) == 3 else None
                if e.get("layer") != path_layer:
                    add("semantic_mismatch", f"LAYER_IDENTITY_MISMATCH: {rel} sits in {path_layer} but the inventory records layer {e.get('layer')}")
                want_key = record_key(self.session_id, e.get("layer"), e.get("logical_identity"), m2["sha256"])
                if e.get("record_key") != want_key:
                    add("semantic_mismatch", f"LOGICAL_IDENTITY_MISMATCH: {rel} record key does not recompute from (session, layer, logical identity, content)")
                if len(parts) == 3 and parts[2][:-5] != want_key:
                    add("semantic_mismatch", f"RECORD_KEY_MISMATCH: {rel} is not stored at the path its semantics require")
                isid, ipid = _internal_ids(m2["_bytes"])
                if isid != e.get("internal_session_id") or ipid != e.get("internal_probe_id"):
                    add("semantic_mismatch", f"INTERNAL_IDENTITY_MISMATCH: {rel} record-internal identity changed")
                if isid is not None and isid != self.session_id:
                    add("semantic_mismatch", f"INTERNAL_IDENTITY_MISMATCH: {rel} names session {isid!r} inside a record of session {self.session_id!r}")
        # ---- L9/L10 directories
        exp_dirs = {d["path"]: d for d in inv.get("directories", []) if isinstance(d, dict)}
        for rel in sorted(set(exp_dirs) - set(dirs)):
            add("missing", f"RECORD_MISSING: directory {rel} is recorded in the inventory but absent on disk")
        for rel in sorted(set(dirs) - set(exp_dirs)):
            add("unexpected", f"UNEXPECTED_ENTRY: directory {rel} is present on disk but not in the finalized inventory")
        for rel in sorted(set(exp_dirs) & set(dirs)):
            if exp_dirs[rel].get("mode") != dirs[rel]["mode"]:
                add("changed", f"MODE_MISMATCH: directory {rel} mode {dirs[rel]['mode']:#o}, inventory records {(exp_dirs[rel].get('mode') or 0):#o}")
        for f, want in ((INVENTORY_FILE, MODE_INVENTORY), (FINALIZED_FILE, MODE_FINALIZED)):
            if f not in files:
                add("missing", f"RECORD_MISSING: {f}")
            elif files[f]["mode"] != want:
                add("changed", f"MODE_MISMATCH: {f} mode {files[f]['mode']:#o}, canonical mode is {want:#o}")
        return sorted(set(errs)), counts

    def verify(self, require_finalized=True):
        """L9. The closed world plus the semantic world. Empty list means every one of the four counters is zero."""
        return self.verify_summary(require_finalized)[0]

    def authority_errors(self, env, active, rp):
        try:
            sm = self.manifest()
        except (EvidenceStoreError, L.ParseError, ValueError) as e:
            return [f"MANIFEST_MISSING: {e}"]
        return [f"PINNED_AUTHORITY_MISMATCH: {e}" for e in L.session_manifest_errors(sm, env, active, rp)]


def create_session(root, session_id, manifest):
    """L1/L3/L4. Establish the root trust boundary, then create the session directory whose basename IS the session id."""
    boundary = RootBoundary(root)
    _name(session_id)
    if session_id in RESERVED_NAMES:
        raise EvidenceStoreError("NAME_INVALID", session_id)
    if not isinstance(manifest, dict) or manifest.get("schema") != EVIDENCE_SESSION_SCHEMA or manifest.get("session_id") != session_id:
        raise EvidenceStoreError("PINNED_AUTHORITY_MISMATCH", "session manifest schema/session_id")
    if manifest.get("session_dir_basename") != session_id:
        raise EvidenceStoreError("SESSION_PATH_MISMATCH", "session manifest basename is not the session id")
    if manifest.get("session_identity_sha256") != session_identity(manifest, session_id)[1]:
        raise EvidenceStoreError("SESSION_IDENTITY_MISMATCH", "session manifest identity digest does not re-derive")
    d = boundary.session_dir(session_id)
    try:
        _mkdir(d)
    except FileExistsError:
        raise EvidenceStoreError("SESSION_EXISTS", session_id)
    st = EvidenceStore(boundary, session_id)
    for sub in LAYERS + (ATTEMPTS_DIR, TMP_DIR):
        _mkdir(os.path.join(d, sub))
    _write_once(os.path.join(d, SESSION_FILE),
                (json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), MODE_SESSION)
    return st


def open_session(root, session_id):
    """L1. Establish the root trust boundary, then open an existing session. A symlinked root or session refuses here."""
    boundary = RootBoundary(root)
    _name(session_id)
    d = boundary.session_dir(session_id)
    if not os.path.isdir(d):
        raise EvidenceStoreError("SESSION_NOT_FOUND", session_id)
    return EvidenceStore(boundary, session_id)


def list_sessions(root):
    boundary = RootBoundary(root)
    return sorted(n for n in os.listdir(boundary.path)
                  if NAME_RE.match(n) and not os.path.islink(os.path.join(boundary.path, n))
                  and os.path.isdir(os.path.join(boundary.path, n)))
