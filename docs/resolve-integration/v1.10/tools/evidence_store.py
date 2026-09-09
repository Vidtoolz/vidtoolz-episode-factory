#!/usr/bin/env python3
"""THE evidence store (v1.10). One normative, executable, append-only, closed-world, semantically reconciled
evidence-session authority with a persisted filesystem boundary and continuous metadata enforcement.

v1.10 corrects Codex's five v1.9 findings. Everything v1.7, v1.8 and v1.9 established is retained and re-run.

  S110-1  SESSION BOUNDARY NOT PERSISTED / RECHECKED. v1.9's boundary lived only in process memory, so after creation
          the session directory could be replaced by another directory with the same basename, or the whole session
          copied under a second root, and both verified clean. Root identity was not part of session identity.
          v1.10 persists a SESSION_BOUNDARY receipt (BOUNDARY.json) as governed evidence, binds the root and session
          directory identity into the session identity digest, and re-lstats both against the receipt before every
          authorizing operation.

  S110-2  INVENTORY / FINALIZATION SEMANTICS PARTLY SELF-ASSERTED. Several normative fields were recorded and then
          trusted. v1.10 rebuilds an expected semantic model from independent sources only - filesystem facts, record
          bytes, the session manifest, the boundary receipt and frozen store law - and compares the stored inventory
          against it. The inventory is evidence, never the model. Every normative finalization-marker field is now
          derived and compared, including the store and authority versions v1.9 ignored, and duplicate directory
          semantics are refused before any index is built.

  S110-3  STORED ATTEMPT MARKER AUTHORITY INCOMPLETE. The public API refused cross-layer and cross-identity reuse, but
          a foreign marker planted on disk was accepted through write, finalize and verify. v1.10 reconciles stored
          markers against records as a bijection: every marker must resolve to exactly one record whose semantic key
          recomputes from the marker's tuple, and every record must have exactly one such marker.

  S110-4  MODE AUTHORITY INCOMPLETE BEFORE FINALIZATION. The session directory itself was outside mode authority and
          modes were only checked after finalization. v1.10 derives the expected mode of every governed entry from its
          KIND, includes the session directory, and enforces it continuously from creation onward.

  S110-5  FILESYSTEM ERROR VOCABULARY. A raw PermissionError could leak from the public authority path. v1.10 routes
          every filesystem call through one normalization boundary that converts expected errno conditions into frozen
          refusal classes.

Laws (EVIDENCE-ROOT.md is the normative prose; this file is the executable authority):

  L1  ROOT TRUST BOUNDARY   root and session directory entries are inspected with lstat BEFORE any resolution.
  L2  LSTAT FIRST           every governed entry is classified by its own directory entry, never its target.
  L3  BOUNDARY RECEIPT      the established boundary is persisted as governed evidence at creation and re-checked
                            before every authorizing operation (S110-1).
  L4  SESSION IDENTITY      the identity tuple includes the boundary identity, so the same bytes under another root or
                            another directory inode are a different, invalid session.
  L5  SESSION PATH          the session directory basename IS the session id, exactly.
  L6  RECORD SEMANTICS      a record's storage name is sha256(domain + session + layer + logical identity + content).
  L7  ATTEMPT BIJECTION     stored markers and records must agree one-to-one, each derived from the other (S110-3).
  L8  APPEND ONLY           create-exclusive writes, canonical mode applied explicitly, never truncate or unlink.
  L9  CLOSED WORLD          finalization records the complete allowed inventory of files and directories.
  L10 RECOMPUTED MODEL      verification rebuilds the expected model from independent sources and compares the stored
                            inventory to it. The inventory never defines the model (S110-2).
  L11 MODE AUTHORITY        expected mode is derived from entry KIND, covers the session directory, and is enforced
                            continuously from creation, not only after finalization (S110-4).
  L12 SESSION STATE         ACTIVE, PARTIAL, FINALIZED, INVALID. An integrity violation makes an ACTIVE session
                            INVALID, and INVALID can never finalize.
  L13 ERROR NORMALIZATION   every filesystem condition becomes a frozen refusal class (S110-5).

Source of truth precedence (frozen): FILESYSTEM FACTS + RECORD BYTES + SESSION MANIFEST and BOUNDARY RECEIPT + FROZEN
SCHEMAS and STORE LAW produce the expected model. Stored INVENTORY, FINALIZATION MARKER and ATTEMPT MARKERS are
compared against that model; they never define it.

Platform scope: qualified on POSIX (the Linux reference host). Permission-mode and file-type verification are POSIX
semantics. No Windows parity is claimed, implemented or tested.

This module DETECTS hostile mutation; it does not prevent it at the operating-system level and does not close every
time-of-check/time-of-use window. Ordinary replacement and substitution are detectable through the stored boundary
identity; deliberate device and inode reuse is explicitly NOT claimed to be detected.
"""
import errno as _errno
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

EVIDENCE_STORE_VERSION = "vidtoolz.resolveEvidenceStore.v4"
EVIDENCE_SESSION_SCHEMA = "vidtoolz.resolveEvidenceSession.v4"
EVIDENCE_BOUNDARY_SCHEMA = "vidtoolz.resolveEvidenceBoundary.v1"
EVIDENCE_INVENTORY_SCHEMA = "vidtoolz.resolveEvidenceInventory.v3"
EVIDENCE_FINALIZATION_SCHEMA = "vidtoolz.resolveEvidenceFinalization.v2"
INVENTORY_DOMAIN = "vidtoolz.resolveEvidenceInventory.v3"
BOUNDARY_DOMAIN = "vidtoolz.resolveEvidenceBoundary.v1"
SESSION_IDENTITY_DOMAIN = "vidtoolz.resolveEvidenceSessionIdentity.v2"
RECORD_KEY_DOMAIN = "vidtoolz.resolveEvidenceRecordKey.v1"
ATTEMPT_KEY_DOMAIN = "vidtoolz.resolveEvidenceAttemptKey.v1"
AUTHORITY_CLASS = "EVIDENCE_STORE_AUTHORIZING"
PLATFORM_SCOPE = "POSIX"
LAYERS = ("RAW", "DERIVED", "HUMAN_REVIEW", "AUTHORITY_PROMOTION")
MAX_RECORD_BYTES = 1 << 22
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$")
SESSION_FILE = "SESSION.json"
BOUNDARY_FILE = "BOUNDARY.json"
INVENTORY_FILE = "INVENTORY.json"
FINALIZED_FILE = "FINALIZED"
ATTEMPTS_DIR = "ATTEMPTS"
TMP_DIR = "TMP"
JOURNAL_FILE = "JOURNAL.ndjson"
RESERVED_NAMES = (SESSION_FILE, BOUNDARY_FILE, INVENTORY_FILE, FINALIZED_FILE, ATTEMPTS_DIR, TMP_DIR, JOURNAL_FILE) + LAYERS
PARTIAL_PREFIX = ".partial-"
SESSION_STATES = ("ACTIVE", "PARTIAL", "FINALIZED", "INVALID")

# ---- L11 the mode derivation table (section 21). Expected mode is a function of KIND, never of an inventory claim.
KIND_EVIDENCE_ROOT = "EVIDENCE_ROOT"
KIND_SESSION_DIR = "SESSION_DIRECTORY"
KIND_LAYER_DIR = "LAYER_DIRECTORY"
KIND_SHARD_DIR = "SHARD_DIRECTORY"
KIND_ATTEMPTS_DIR = "ATTEMPTS_DIRECTORY"
KIND_TMP_DIR = "TMP_DIRECTORY"
KIND_RECORD = "RECORD"
KIND_ATTEMPT_MARKER = "ATTEMPT_MARKER"
KIND_SESSION_MANIFEST = "SESSION_MANIFEST"
KIND_BOUNDARY_RECEIPT = "BOUNDARY_RECEIPT"
KIND_JOURNAL = "JOURNAL"
KIND_INVENTORY = "INVENTORY"
KIND_FINALIZATION_MARKER = "FINALIZATION_MARKER"
MODE_TABLE = {
    KIND_EVIDENCE_ROOT: None,          # the root is the operator's; the store does not own its mode
    KIND_SESSION_DIR: 0o700,
    KIND_LAYER_DIR: 0o700,
    KIND_SHARD_DIR: 0o700,
    KIND_ATTEMPTS_DIR: 0o700,
    KIND_TMP_DIR: 0o700,
    KIND_RECORD: 0o400,
    KIND_ATTEMPT_MARKER: 0o400,
    KIND_SESSION_MANIFEST: 0o444,
    KIND_BOUNDARY_RECEIPT: 0o444,
    KIND_JOURNAL: 0o600,
    KIND_INVENTORY: 0o444,
    KIND_FINALIZATION_MARKER: 0o444,
}
DIR_KINDS = (KIND_SESSION_DIR, KIND_LAYER_DIR, KIND_SHARD_DIR, KIND_ATTEMPTS_DIR, KIND_TMP_DIR)


def expected_mode(kind):
    """L11/section 21. The expected permission mode of a governed entry, derived from its kind."""
    return MODE_TABLE.get(kind)


ERROR_CODES = (
    # boundary and root
    "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_REPLACED", "ROOT_IDENTITY_MISMATCH",
    "SESSION_SYMLINK_REFUSED", "SESSION_BOUNDARY_CHANGED", "BOUNDARY_RECEIPT_MISSING", "BOUNDARY_RECEIPT_INVALID",
    # session
    "SESSION_EXISTS", "SESSION_NOT_FOUND", "SESSION_FINALIZED", "SESSION_NOT_FINALIZED", "SESSION_INVALID",
    "SESSION_IDENTITY_MISMATCH", "SESSION_PATH_MISMATCH",
    # names and paths
    "NAME_INVALID", "PATH_ESCAPE", "SYMLINK_REJECTED", "FILE_TYPE_REJECTED", "LAYER_UNKNOWN",
    # records and identity
    "LAYER_IDENTITY_MISMATCH", "LOGICAL_IDENTITY_MISMATCH", "LOGICAL_IDENTITY_INVALID", "RECORD_KEY_MISMATCH",
    "NOT_BYTES", "RECORD_TOO_LARGE", "DECLARED_DIGEST_MISMATCH", "DIGEST_COLLISION_DIFFERENT_BYTES",
    "OVERWRITE_REJECTED", "RECORD_MISSING", "EVIDENCE_REPLACED", "UNEXPECTED_ENTRY", "ORPHANED_RECORD",
    # attempts
    "ATTEMPT_ID_REUSED", "ATTEMPT_ID_CROSS_LAYER", "ATTEMPT_ID_CROSS_IDENTITY", "ATTEMPT_TUPLE_DUPLICATE",
    "ATTEMPT_ID_DUPLICATE", "FOREIGN_ATTEMPT_MARKER", "ATTEMPT_MARKER_MISMATCH",
    # inventory and finalization
    "INVENTORY_TAMPERED", "INVENTORY_DUPLICATE_KEY", "FINALIZATION_MARKER_INVALID", "INTERNAL_IDENTITY_MISMATCH",
    # metadata
    "MODE_MISMATCH", "PARTIAL_RECORD", "PINNED_AUTHORITY_MISMATCH", "MANIFEST_MISSING", "CONTENT_DIGEST_MISMATCH",
    # L13 filesystem normalization
    "FS_NOT_FOUND", "FS_EXISTS", "FS_NOT_A_DIRECTORY", "FS_IS_A_DIRECTORY", "FS_SYMLINK_LOOP", "FS_PERMISSION_DENIED",
    "FS_NAME_TOO_LONG", "FS_CROSS_DEVICE", "FS_NOT_EMPTY", "FS_NO_SPACE", "FS_READ_ONLY", "FS_UNSUPPORTED",
    "FS_UNAVAILABLE",
)


class EvidenceStoreError(Exception):
    """Every refusal of this store carries one closed code from ERROR_CODES; nothing refuses anonymously."""

    def __init__(self, code, detail=""):
        assert code in ERROR_CODES, code
        self.code = code
        self.detail = str(detail)
        super().__init__(f"{code}: {self.detail}" if detail else code)


# ================================================================ L13 filesystem error normalization (sections 24/25)
ERRNO_TO_CODE = {
    _errno.ENOENT: "FS_NOT_FOUND",
    _errno.EEXIST: "FS_EXISTS",
    _errno.ENOTDIR: "FS_NOT_A_DIRECTORY",
    _errno.EISDIR: "FS_IS_A_DIRECTORY",
    _errno.ELOOP: "FS_SYMLINK_LOOP",
    _errno.EACCES: "FS_PERMISSION_DENIED",
    _errno.EPERM: "FS_PERMISSION_DENIED",
    _errno.ENAMETOOLONG: "FS_NAME_TOO_LONG",
    _errno.EXDEV: "FS_CROSS_DEVICE",
    _errno.ENOTEMPTY: "FS_NOT_EMPTY",
    _errno.ENOSPC: "FS_NO_SPACE",
    _errno.EROFS: "FS_READ_ONLY",
    _errno.EOPNOTSUPP: "FS_UNSUPPORTED",
    _errno.EINVAL: "FS_UNSUPPORTED",
}


def fs_error_code(exc):
    """L13. The frozen refusal class for one filesystem condition. Unknown errno maps to FS_UNAVAILABLE rather than
    leaking; a genuine programming defect is not an OSError and still raises."""
    return ERRNO_TO_CODE.get(getattr(exc, "errno", None), "FS_UNAVAILABLE")


def fs(op, *args, **kwargs):
    """L13 (section 24). THE filesystem boundary. Every os-level call in this module goes through here, so a user,
    input or filesystem condition becomes a frozen EvidenceStoreError instead of a raw OSError escaping the public
    authority path. Programming defects (TypeError, AttributeError) are not caught and still surface."""
    try:
        return op(*args, **kwargs)
    except EvidenceStoreError:
        raise
    except OSError as e:
        raise EvidenceStoreError(fs_error_code(e), f"{getattr(op, '__name__', op)}: {e.strerror or e}")


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def canonical_json_bytes(obj):
    return (json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def inventory_digest(inv):
    return L.digest({k: v for k, v in inv.items() if k != "inventory_sha256"}, INVENTORY_DOMAIN)


def boundary_digest(b):
    return L.digest({k: v for k, v in b.items() if k != "boundary_sha256"}, BOUNDARY_DOMAIN)


# ================================================================ L1/L2 path and type law
def _lstat(path):
    """The directory ENTRY itself, never its target. None when absent; every other condition is a frozen class."""
    try:
        return os.lstat(path)
    except FileNotFoundError:
        return None
    except NotADirectoryError:
        return None
    except OSError as e:
        raise EvidenceStoreError(fs_error_code(e), f"lstat {path}: {e.strerror or e}")


def _name(n, code="NAME_INVALID"):
    if not isinstance(n, str) or not NAME_RE.match(n) or n in (".", ".."):
        raise EvidenceStoreError(code, repr(n))
    return n


def _reject_non_regular(path, allow_dir=False):
    st = _lstat(path)
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
    _reject_non_regular(path)
    fd = fs(os.open, path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        chunks = []
        while True:
            b = fs(os.read, fd, 1 << 20)
            if not b:
                break
            chunks.append(b)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _write_once(path, data, mode):
    """L8/L11. Create-exclusive write, fsync, hard link, unlink temp, then chmod to the canonical mode."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, PARTIAL_PREFIX + sha256_bytes(data + os.urandom(16))[:32])
    fd = fs(os.open, tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        fs(os.write, fd, data)
        fs(os.fsync, fd)
    finally:
        os.close(fd)
    try:
        os.link(tmp, path)
    except FileExistsError:
        fs(os.unlink, tmp)
        raise EvidenceStoreError("OVERWRITE_REJECTED", path)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise EvidenceStoreError(fs_error_code(e), f"link {path}: {e.strerror or e}")
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
    fs(os.chmod, path, mode)
    dfd = fs(os.open, d, os.O_RDONLY)
    try:
        fs(os.fsync, dfd)
    finally:
        os.close(dfd)


def _mkdir(path, mode=None):
    fs(os.mkdir, path)
    fs(os.chmod, path, MODE_TABLE[KIND_SESSION_DIR] if mode is None else mode)


def _append_journal(path, entry):
    line = canonical_json_bytes(entry)
    fd = fs(os.open, path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        fs(os.write, fd, line)
        fs(os.fsync, fd)
    finally:
        os.close(fd)
    fs(os.chmod, path, MODE_TABLE[KIND_JOURNAL])


# ================================================================ L1/L3 the boundary
BOUNDARY_FIELDS = ("schema", "evidence_store_version", "authority_version", "platform_scope", "session_id",
                   "root_path", "root_device", "root_inode", "session_basename", "session_device", "session_inode",
                   "created_at")


def boundary_identity(b):
    """L4. The digest of the filesystem boundary a session was established on. Part of the session identity, so the
    same bytes under another root or another directory inode are a different session."""
    return L.digest({k: b.get(k) for k in ("root_path", "root_device", "root_inode", "session_basename",
                                           "session_device", "session_inode")}, BOUNDARY_DOMAIN)


class RootBoundary:
    """L1. The established trust boundary of one evidence root: lstat with no resolution, literal path retained,
    device and inode captured. Ordinary replacement or substitution of the root is detectable; deliberate device and
    inode reuse is explicitly not claimed to be detected."""

    __slots__ = ("path", "dev", "ino")

    def __init__(self, root):
        if not isinstance(root, str) or not root:
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", repr(root))
        path = os.path.abspath(root)
        st = _lstat(path)
        if st is None:
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", path)
        if stat.S_ISLNK(st.st_mode):
            raise EvidenceStoreError("ROOT_SYMLINK_REFUSED", path)
        if not stat.S_ISDIR(st.st_mode):
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", path)
        self.path, self.dev, self.ino = path, st.st_dev, st.st_ino

    def check(self):
        st = _lstat(self.path)
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
        _name(session_id)
        d = os.path.join(self.check(), session_id)
        st = _lstat(d)
        if st is not None:
            if stat.S_ISLNK(st.st_mode):
                raise EvidenceStoreError("SESSION_SYMLINK_REFUSED", d)
            if not stat.S_ISDIR(st.st_mode):
                raise EvidenceStoreError("FILE_TYPE_REJECTED", f"session entry is not a directory: {d}")
        return d


# ================================================================ L4/L6 identity law
SESSION_IDENTITY_FIELDS = ("session_id", "probe_id", "authority_version", "authority_manifest_sha256",
                           "evidence_store_version", "host_name", "product", "resolve_version", "build",
                           "library_name", "library_uuid", "library_root", "trusted_shim_sha256",
                           "primitive_spec_sha256", "schema_registry_sha256", "session_dir_basename",
                           "boundary_identity_sha256")


def session_identity(manifest, dir_basename, boundary_identity_sha256):
    """L4. The canonical session identity tuple, now including the frozen filesystem boundary identity (section 2)."""
    tup = {}
    for k in SESSION_IDENTITY_FIELDS:
        if k == "session_dir_basename":
            tup[k] = dir_basename
        elif k == "boundary_identity_sha256":
            tup[k] = boundary_identity_sha256
        else:
            tup[k] = (manifest or {}).get(k)
    return tup, L.digest(tup, SESSION_IDENTITY_DOMAIN)


def record_key(session_id, layer, logical_identity, content_digest):
    return L.digest({"session_id": session_id, "layer": layer, "logical_identity": logical_identity,
                     "content_sha256": content_digest}, RECORD_KEY_DOMAIN)


def attempt_key(session_id, layer, logical_identity, attempt_id):
    return L.digest({"session_id": session_id, "layer": layer, "logical_identity": logical_identity,
                     "attempt_id": attempt_id}, ATTEMPT_KEY_DOMAIN)


def expected_record_path(layer, key):
    return os.path.join(layer, key[:2], key + ".json")


def _internal_ids(raw_bytes):
    try:
        obj = L.strict_loads(raw_bytes.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None, None
    if not isinstance(obj, dict):
        return None, None
    sid, pid = obj.get("session_id"), obj.get("probe_id")
    for k in ("capture", "derived"):
        inner = obj.get(k)
        if isinstance(inner, dict):
            sid = sid if sid is not None else inner.get("session_id")
            pid = pid if pid is not None else inner.get("probe_id")
    return (sid if isinstance(sid, str) else None), (pid if isinstance(pid, str) else None)


def path_kind(rel):
    """Derive an entry's KIND from its path under frozen store law. The inventory never supplies a kind."""
    parts = rel.split(os.sep)
    if rel == SESSION_FILE:
        return KIND_SESSION_MANIFEST
    if rel == BOUNDARY_FILE:
        return KIND_BOUNDARY_RECEIPT
    if rel == JOURNAL_FILE:
        return KIND_JOURNAL
    if rel == INVENTORY_FILE:
        return KIND_INVENTORY
    if rel == FINALIZED_FILE:
        return KIND_FINALIZATION_MARKER
    if len(parts) == 2 and parts[0] == ATTEMPTS_DIR:
        return KIND_ATTEMPT_MARKER
    if len(parts) == 3 and parts[0] in LAYERS and parts[2].endswith(".json"):
        return KIND_RECORD
    return None


def dir_kind(rel):
    parts = rel.split(os.sep)
    if len(parts) == 1:
        if parts[0] in LAYERS:
            return KIND_LAYER_DIR
        if parts[0] == ATTEMPTS_DIR:
            return KIND_ATTEMPTS_DIR
        if parts[0] == TMP_DIR:
            return KIND_TMP_DIR
    if len(parts) == 2 and parts[0] in LAYERS and re.fullmatch(r"[0-9a-f]{2}", parts[1]):
        return KIND_SHARD_DIR
    return None


def session_manifest(session_id, probe_id, operator, env, active, rp, created_at,
                     stdout_retention="CONTENT_ADDRESSED_RAW_LAYER", stderr_retention="CONTENT_ADDRESSED_RAW_LAYER"):
    """The pinned session manifest. Its identity digest is completed by create_session, which is the only place the
    filesystem boundary is known."""
    shim = L.trusted_capture_shim()
    return {
        "schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
        "evidence_session_schema": EVIDENCE_SESSION_SCHEMA,
        "evidence_boundary_schema": EVIDENCE_BOUNDARY_SCHEMA,
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


class EvidenceStore:
    """One append-only evidence session on disk, behind a PERSISTED filesystem boundary.

    Callers never supply a path. Every authorizing operation re-establishes the boundary against the stored receipt
    before it touches anything, and verification rebuilds the expected model from independent sources."""

    def __init__(self, boundary, session_id):
        self.boundary = boundary if isinstance(boundary, RootBoundary) else RootBoundary(boundary)
        self.session_id = session_id
        self.dir = self.boundary.session_dir(session_id)

    @property
    def root(self):
        return self.boundary.path

    # -------------------------------------------------------------- L3 the persisted boundary
    def boundary_receipt(self):
        p = os.path.join(self.dir, BOUNDARY_FILE)
        if not os.path.exists(p):
            raise EvidenceStoreError("BOUNDARY_RECEIPT_MISSING", p)
        try:
            b = L.strict_loads(_read_exact(p).decode("utf-8"))
        except (L.ParseError, ValueError, UnicodeDecodeError) as e:
            raise EvidenceStoreError("BOUNDARY_RECEIPT_INVALID", f"unreadable ({e})")
        if not isinstance(b, dict) or sorted(b) != sorted(BOUNDARY_FIELDS + ("boundary_sha256",)):
            raise EvidenceStoreError("BOUNDARY_RECEIPT_INVALID", "field set is not the canonical boundary field set")
        if b.get("boundary_sha256") != boundary_digest(b):
            raise EvidenceStoreError("BOUNDARY_RECEIPT_INVALID", "boundary_sha256 is not the digest of this receipt")
        return b

    def check_boundary(self):
        """L3 (section 3). Re-lstat the configured root AND the session directory and compare both against the
        persisted receipt: literal path, device, inode, non-symlink type, directory type and frozen mode. Called
        before every authorizing operation. Fails closed."""
        b = self.boundary_receipt()
        if b["session_id"] != self.session_id:
            raise EvidenceStoreError("SESSION_BOUNDARY_CHANGED", f"receipt names session {b['session_id']!r}")
        rst = _lstat(b["root_path"])
        if rst is None:
            raise EvidenceStoreError("ROOT_REPLACED", f"{b['root_path']} no longer exists")
        if stat.S_ISLNK(rst.st_mode):
            raise EvidenceStoreError("ROOT_SYMLINK_REFUSED", b["root_path"])
        if not stat.S_ISDIR(rst.st_mode):
            raise EvidenceStoreError("ROOT_NOT_A_DIRECTORY", b["root_path"])
        if os.path.abspath(self.boundary.path) != b["root_path"]:
            raise EvidenceStoreError("ROOT_IDENTITY_MISMATCH",
                                     f"opened under {self.boundary.path!r} but the receipt was established under {b['root_path']!r}")
        if (rst.st_dev, rst.st_ino) != (b["root_device"], b["root_inode"]):
            raise EvidenceStoreError("ROOT_IDENTITY_MISMATCH", f"{b['root_path']} is not the root this session was established on")
        sst = _lstat(self.dir)
        if sst is None:
            raise EvidenceStoreError("SESSION_BOUNDARY_CHANGED", f"{self.dir} no longer exists")
        if stat.S_ISLNK(sst.st_mode):
            raise EvidenceStoreError("SESSION_SYMLINK_REFUSED", self.dir)
        if not stat.S_ISDIR(sst.st_mode):
            raise EvidenceStoreError("FILE_TYPE_REJECTED", f"session entry is not a directory: {self.dir}")
        if os.path.basename(self.dir) != b["session_basename"]:
            raise EvidenceStoreError("SESSION_PATH_MISMATCH", f"{os.path.basename(self.dir)!r} != {b['session_basename']!r}")
        if (sst.st_dev, sst.st_ino) != (b["session_device"], b["session_inode"]):
            raise EvidenceStoreError("SESSION_BOUNDARY_CHANGED",
                                     "the session directory is not the one this session was created in")
        want = expected_mode(KIND_SESSION_DIR)
        if want is not None and stat.S_IMODE(sst.st_mode) != want:
            raise EvidenceStoreError("MODE_MISMATCH", f"session directory mode {stat.S_IMODE(sst.st_mode):#o} != {want:#o}")
        return b

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

    def identity(self):
        b = self.boundary_receipt()
        return session_identity(self.manifest(), os.path.basename(self.dir), boundary_identity(b))

    def identity_errors(self):
        errs = []
        try:
            m = self.manifest()
            b = self.boundary_receipt()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            return [f"{getattr(e, 'code', 'MANIFEST_MISSING')}: {e}"]
        base = os.path.basename(self.dir)
        if m.get("session_id") != base or m.get("session_dir_basename") != base:
            errs.append(f"SESSION_PATH_MISMATCH: manifest names {m.get('session_id')!r}/{m.get('session_dir_basename')!r} but the directory basename is {base!r}")
        _t, dig = session_identity(m, base, boundary_identity(b))
        if m.get("session_identity_sha256") != dig:
            errs.append("SESSION_IDENTITY_MISMATCH: session_identity_sha256 does not re-derive from this manifest, this directory and this boundary")
        return errs

    def record_path(self, layer, key):
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        if not L.is_sha(key):
            raise EvidenceStoreError("NAME_INVALID", key)
        return _safe_join(self.dir, layer, key[:2], key + ".json")

    # -------------------------------------------------------------- L2/L9/L11 enumeration
    def scan_tree(self):
        """Every entry under the session root with its own type and mode, taken from lstat."""
        files, dirs, partials, bad = {}, {}, [], []
        for dp, dns, fns in fs(os.walk, self.dir, followlinks=False):
            rel_dir = os.path.relpath(dp, self.dir)
            if rel_dir != ".":
                _dst = _lstat(dp)
                if _dst is None:
                    continue          # vanished between walk and stat; the closed-world compare reports it missing
                dirs[rel_dir] = {"mode": stat.S_IMODE(_dst.st_mode), "file_type": "DIRECTORY"}
            for n in sorted(dns):
                if os.path.islink(os.path.join(dp, n)):
                    bad.append(("SYMLINK", os.path.relpath(os.path.join(dp, n), self.dir)))
            for n in sorted(fns):
                p = os.path.join(dp, n)
                rel = os.path.relpath(p, self.dir)
                st = _lstat(p)
                if st is None:
                    continue          # vanished between walk and stat; the closed-world compare reports it missing
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

    # -------------------------------------------------------------- L7/L10 the independently recomputed model
    def expected_model(self):
        """L10 (sections 7, 9, 12, 27). Rebuild the expected semantic model from INDEPENDENT sources only:
        filesystem facts, record bytes, the session manifest, the boundary receipt and frozen store law. The stored
        inventory and finalization marker are NEVER consulted here. Returns (model, errors)."""
        errs = []
        files, dirs, partials, bad = self.scan_tree()
        for rel in partials:
            errs.append(f"PARTIAL_RECORD: {rel}")
        for kind, rel in bad:
            errs.append(f"SYMLINK_REJECTED: {rel}" if kind == "SYMLINK" else f"FILE_TYPE_REJECTED: {kind} at {rel}")
        errs += self.identity_errors()

        # ---- markers, from bytes, with attempt-key AND attempt-id uniqueness (sections 10, 11)
        markers, seen_key, seen_id = {}, {}, {}
        for rel in sorted(files):
            if path_kind(rel) != KIND_ATTEMPT_MARKER:
                continue
            aid = rel.split(os.sep)[1]
            try:
                t = L.strict_loads(files[rel]["_bytes"].decode("utf-8"))
            except (L.ParseError, ValueError, UnicodeDecodeError) as e:
                errs.append(f"ATTEMPT_MARKER_MISMATCH: {rel} unreadable ({e})")
                continue
            if not isinstance(t, dict) or sorted(t) != ["attempt_id", "attempt_key", "content_sha256", "layer", "logical_identity", "session_id"]:
                errs.append(f"ATTEMPT_MARKER_MISMATCH: {rel} field set is not the canonical attempt tuple")
                continue
            if t["attempt_id"] != aid:
                errs.append(f"ATTEMPT_MARKER_MISMATCH: {rel} names attempt id {t['attempt_id']!r}")
                continue
            if t["session_id"] != self.session_id:
                errs.append(f"FOREIGN_ATTEMPT_MARKER: {rel} names session {t['session_id']!r}")
                continue
            if t["layer"] not in LAYERS:
                errs.append(f"ATTEMPT_MARKER_MISMATCH: {rel} names unknown layer {t['layer']!r}")
                continue
            want_key = attempt_key(self.session_id, t["layer"], t["logical_identity"], t["attempt_id"])
            if t["attempt_key"] != want_key:
                errs.append(f"ATTEMPT_MARKER_MISMATCH: {rel} attempt_key does not recompute from its own tuple")
                continue
            if want_key in seen_key:
                errs.append(f"ATTEMPT_TUPLE_DUPLICATE: {rel} and {seen_key[want_key]} share an attempt key")
                continue
            if aid in seen_id:
                prev = markers[seen_id[aid]]
                errs.append(f"ATTEMPT_ID_DUPLICATE: {rel} reuses attempt id {aid!r} already bound to "
                            f"{prev['layer']}/{prev['logical_identity']!r}")
                continue
            seen_key[want_key], seen_id[aid] = rel, rel
            markers[rel] = t

        # ---- records, reconciled against markers as a bijection (section 12)
        by_expected_path = {}
        for rel, t in markers.items():
            key = record_key(self.session_id, t["layer"], t["logical_identity"], t["content_sha256"])
            by_expected_path.setdefault(expected_record_path(t["layer"], key), []).append((rel, t, key))
        entries = {}
        for rel in sorted(files):
            kind = path_kind(rel)
            meta = files[rel]
            if kind is None:
                errs.append(f"UNEXPECTED_ENTRY: {rel} has no governed kind under store law")
                continue
            base = {"path": rel, "kind": kind, "content_sha256": meta["sha256"], "byte_count": meta["byte_count"],
                    "file_type": "REGULAR", "mode": expected_mode(kind), "layer": None, "record_key": None,
                    "logical_identity": None, "internal_session_id": None, "internal_probe_id": None,
                    "attempt_ids": [], "attempt_keys": []}
            if kind == KIND_RECORD:
                claims = by_expected_path.get(rel, [])
                matched = [c for c in claims if c[1]["content_sha256"] == meta["sha256"]]
                if not matched:
                    errs.append(f"ORPHANED_RECORD: {rel} has no attempt marker whose tuple recomputes this record path and content")
                    continue
                if len({c[1]["logical_identity"] for c in matched}) != 1:
                    errs.append(f"LOGICAL_IDENTITY_MISMATCH: {rel} is claimed by more than one logical identity")
                    continue
                _mrel, t, key = matched[0]
                path_layer = rel.split(os.sep)[0]
                if t["layer"] != path_layer:
                    errs.append(f"LAYER_IDENTITY_MISMATCH: {rel} sits in {path_layer} but its marker names {t['layer']}")
                    continue
                if rel.split(os.sep)[2][:-5] != key:
                    errs.append(f"RECORD_KEY_MISMATCH: {rel} is not stored at the path its semantics require")
                    continue
                isid, ipid = _internal_ids(meta["_bytes"])
                if isid is not None and isid != self.session_id:
                    errs.append(f"INTERNAL_IDENTITY_MISMATCH: {rel} names session {isid!r} inside a record of {self.session_id!r}")
                base.update(layer=path_layer, record_key=key, logical_identity=t["logical_identity"],
                            internal_session_id=isid, internal_probe_id=ipid,
                            attempt_ids=sorted(c[1]["attempt_id"] for c in matched),
                            attempt_keys=sorted(c[2 - 2] and attempt_key(self.session_id, t["layer"], c[1]["logical_identity"], c[1]["attempt_id"]) for c in matched))
            entries[rel] = base
        for rel, claims in sorted(by_expected_path.items()):
            if rel not in files:
                errs.append(f"FOREIGN_ATTEMPT_MARKER: {claims[0][0]} claims record {rel}, which does not exist")

        # ---- directories, derived from kind, deduplicated before any index (sections 7, 10)
        exp_dirs, seen_dir = {}, {}
        for rel in sorted(dirs):
            k = dir_kind(rel)
            if k is None:
                errs.append(f"UNEXPECTED_ENTRY: directory {rel} has no governed kind under store law")
                continue
            if k == KIND_SHARD_DIR:
                parent = rel.split(os.sep)[0]
                if not any(e["kind"] == KIND_RECORD and e["path"].startswith(rel + os.sep) for e in entries.values()):
                    errs.append(f"UNEXPECTED_ENTRY: shard directory {rel} holds no record")
                    continue
                if parent not in dirs:
                    errs.append(f"RECORD_MISSING: shard directory {rel} has no parent layer directory")
                    continue
            if rel in seen_dir:
                errs.append(f"INVENTORY_DUPLICATE_KEY: directory {rel} appears twice")
                continue
            seen_dir[rel] = k
            exp_dirs[rel] = {"path": rel, "kind": k, "file_type": "DIRECTORY", "mode": expected_mode(k),
                             "parent": os.path.dirname(rel) or None}
        for req in LAYERS + (ATTEMPTS_DIR, TMP_DIR):
            if req not in exp_dirs:
                errs.append(f"RECORD_MISSING: required directory {req} is absent")
        for req in (SESSION_FILE, BOUNDARY_FILE):
            if req not in entries:
                errs.append(f"RECORD_MISSING: required file {req} is absent")

        # ---- L11 modes, derived from kind, compared to the filesystem, from creation onward
        for rel, e in sorted(entries.items()):
            want = e["mode"]
            if want is not None and files[rel]["mode"] != want:
                errs.append(f"MODE_MISMATCH: {rel} ({e['kind']}) mode {files[rel]['mode']:#o} != expected {want:#o}")
        for rel, d in sorted(exp_dirs.items()):
            if d["mode"] is not None and dirs[rel]["mode"] != d["mode"]:
                errs.append(f"MODE_MISMATCH: directory {rel} ({d['kind']}) mode {dirs[rel]['mode']:#o} != expected {d['mode']:#o}")
        return {"entries": entries, "directories": exp_dirs, "files": files, "dirs": dirs}, sorted(set(errs))

    # -------------------------------------------------------------- L12 ACTIVE integrity (section 22)
    def active_integrity(self):
        """L12 (section 22). The integrity check an ACTIVE session must pass before any further operation: boundary,
        symlinks, unexpected entries, attempt-marker reconciliation, modes, record semantics and file types. It does
        not require the final inventory; it establishes that the current state is safe to continue from."""
        try:
            self.check_boundary()
        except EvidenceStoreError as e:
            return [f"{e.code}: {e.detail}"]
        _model, errs = self.expected_model()
        return errs

    def session_state(self):
        """L12 (section 23). ACTIVE + integrity violation becomes INVALID; INVALID can never finalize."""
        try:
            self.check_boundary()
        except EvidenceStoreError:
            return "INVALID"
        if not os.path.isdir(self.dir) or not os.path.exists(os.path.join(self.dir, SESSION_FILE)):
            return "INVALID"
        _f, _d, partials, _b = self.scan_tree()
        if self.finalized:
            return "FINALIZED" if not self.verify() else "INVALID"
        if self.active_integrity():
            return "INVALID" if not partials else "PARTIAL"
        return "PARTIAL" if partials else "ACTIVE"

    def _require_can_write(self):
        """Sections 14/18: every operation that depends on current session state validates it first."""
        self.check_boundary()
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        errs = self.active_integrity()
        if errs:
            raise EvidenceStoreError("SESSION_INVALID", errs[0])

    # -------------------------------------------------------------- write
    def _put(self, layer, attempt_id, raw_bytes, logical_identity, declared_digest=None):
        self._require_can_write()
        if layer not in LAYERS:
            raise EvidenceStoreError("LAYER_UNKNOWN", layer)
        _name(attempt_id)
        if logical_identity is None:
            raise EvidenceStoreError("LOGICAL_IDENTITY_INVALID", "a logical identity is required")
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
        tup = {"session_id": self.session_id, "layer": layer, "logical_identity": logical_identity,
               "attempt_id": attempt_id, "content_sha256": digest,
               "attempt_key": attempt_key(self.session_id, layer, logical_identity, attempt_id)}
        try:
            _write_once(marker, canonical_json_bytes(tup), MODE_TABLE[KIND_ATTEMPT_MARKER])
        except EvidenceStoreError as e:
            if e.code != "OVERWRITE_REJECTED":
                raise
            prev = L.strict_loads(_read_exact(marker).decode("utf-8"))
            if prev.get("session_id") != self.session_id:
                raise EvidenceStoreError("FOREIGN_ATTEMPT_MARKER", f"{attempt_id} names session {prev.get('session_id')!r}")
            if prev.get("layer") != layer:
                raise EvidenceStoreError("ATTEMPT_ID_CROSS_LAYER", f"{attempt_id} already bound to layer {prev.get('layer')}")
            if prev.get("logical_identity") != logical_identity:
                raise EvidenceStoreError("ATTEMPT_ID_CROSS_IDENTITY", f"{attempt_id} already bound to {prev.get('logical_identity')!r}")
            if prev.get("content_sha256") != digest:
                raise EvidenceStoreError("ATTEMPT_ID_REUSED", f"{attempt_id} already bound to {prev.get('content_sha256')}")
        key = record_key(self.session_id, layer, logical_identity, digest)
        final = self.record_path(layer, key)
        shard = os.path.dirname(final)
        if not os.path.isdir(shard):
            _mkdir(shard, MODE_TABLE[KIND_SHARD_DIR])
        idempotent = False
        if os.path.exists(final):
            if _read_exact(final) != raw_bytes:
                raise EvidenceStoreError("DIGEST_COLLISION_DIFFERENT_BYTES", digest)
            idempotent = True
        else:
            _write_once(final, raw_bytes, MODE_TABLE[KIND_RECORD])
        _append_journal(os.path.join(self.dir, JOURNAL_FILE),
                        {"layer": layer, "attempt_id": attempt_id, "logical_identity": logical_identity,
                         "content_sha256": digest, "record_key": key, "byte_count": len(raw_bytes),
                         "idempotent": idempotent})
        return {"digest": digest, "content_sha256": digest, "record_key": key, "layer": layer,
                "attempt_id": attempt_id, "logical_identity": logical_identity, "attempt_key": tup["attempt_key"],
                "path": os.path.relpath(final, self.dir), "byte_count": len(raw_bytes), "idempotent": idempotent}

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

    def get(self, layer, key):
        self.check_boundary()
        p = self.record_path(layer, key)
        if not os.path.exists(p):
            raise EvidenceStoreError("RECORD_MISSING", key)
        return _read_exact(p)

    def attempts(self):
        model, _e = self.expected_model()
        return {e["path"].split(os.sep)[1]: e for e in model["entries"].values() if e["kind"] == KIND_ATTEMPT_MARKER}

    # -------------------------------------------------------------- L9 finalize
    def finalize(self):
        """L9. Finalization requires a clean ACTIVE integrity check first, so a corrupted session can never become
        FINALIZED (section 23)."""
        self.check_boundary()
        if self.finalized:
            raise EvidenceStoreError("SESSION_FINALIZED", self.session_id)
        model, errs = self.expected_model()
        if errs:
            raise EvidenceStoreError("SESSION_INVALID", errs[0])
        b = self.boundary_receipt()
        manifest = self.manifest()
        _t, ident = session_identity(manifest, os.path.basename(self.dir), boundary_identity(b))
        entries = [dict(e) for e in sorted(model["entries"].values(), key=lambda x: x["path"])]
        inv = {
            "schema": EVIDENCE_INVENTORY_SCHEMA,
            "evidence_store_version": EVIDENCE_STORE_VERSION,
            "authority_version": L.AUTHORITY_VERSION,
            "platform_scope": PLATFORM_SCOPE,
            "session_id": self.session_id,
            "session_dir_basename": os.path.basename(self.dir),
            "session_identity_sha256": ident,
            "boundary_identity_sha256": boundary_identity(b),
            "boundary_sha256": b["boundary_sha256"],
            "session_manifest_sha256": self.manifest_sha256(),
            "closed_world": True,
            "semantic_reconciliation": True,
            "recomputed_model": True,
            "record_count": sum(1 for e in entries if e["kind"] == KIND_RECORD),
            "entry_count": len(entries),
            "total_bytes": sum(e["byte_count"] for e in entries),
            "attempt_count": sum(1 for e in entries if e["kind"] == KIND_ATTEMPT_MARKER),
            "directories": [dict(d) for d in sorted(model["directories"].values(), key=lambda x: x["path"])],
            "mode_table": {k: v for k, v in sorted(MODE_TABLE.items()) if v is not None},
            "self_path": INVENTORY_FILE,
            "finalized_marker_path": FINALIZED_FILE,
            "entries": entries,
        }
        inv["inventory_sha256"] = inventory_digest(inv)
        _write_once(os.path.join(self.dir, INVENTORY_FILE),
                    (json.dumps(inv, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                    MODE_TABLE[KIND_INVENTORY])
        marker = {"schema": EVIDENCE_FINALIZATION_SCHEMA, "evidence_store_version": EVIDENCE_STORE_VERSION,
                  "authority_version": L.AUTHORITY_VERSION, "platform_scope": PLATFORM_SCOPE,
                  "session_id": self.session_id, "session_identity_sha256": ident,
                  "boundary_identity_sha256": boundary_identity(b),
                  "inventory_sha256": inv["inventory_sha256"], "state": "FINALIZED"}
        _write_once(os.path.join(self.dir, FINALIZED_FILE), canonical_json_bytes(marker), MODE_TABLE[KIND_FINALIZATION_MARKER])
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

    # -------------------------------------------------------------- L10 verify
    def verify_summary(self, require_finalized=True):
        """L10. Rebuild the expected model from independent sources, then compare the stored inventory and
        finalization marker against it. Returns (errors, counts). PASS requires every normative counter zero:
        missing, unexpected, changed, semantic_mismatch. boundary_mismatch, metadata_mismatch and attempt_mismatch are
        advisory refinements that also increment a normative counter, so they add detail, never a second authority."""
        errs = []
        counts = {"missing": 0, "unexpected": 0, "changed": 0, "semantic_mismatch": 0,
                  "boundary_mismatch": 0, "metadata_mismatch": 0, "attempt_mismatch": 0}

        def add(bucket, msg, advisory=None):
            counts[bucket] += 1
            if advisory:
                counts[advisory] += 1
            errs.append(msg)

        try:
            self.check_boundary()
        except EvidenceStoreError as e:
            add("semantic_mismatch", f"{e.code}: {e.detail}", "boundary_mismatch")
            return sorted(set(errs)), counts
        model, merrs = self.expected_model()
        for m in merrs:
            head = m.split(":", 1)[0]
            bucket = ("missing" if head in ("RECORD_MISSING",) else
                      "unexpected" if head in ("UNEXPECTED_ENTRY", "PARTIAL_RECORD", "SYMLINK_REJECTED", "FILE_TYPE_REJECTED") else
                      "changed" if head in ("MODE_MISMATCH", "EVIDENCE_REPLACED") else "semantic_mismatch")
            adv = ("metadata_mismatch" if head == "MODE_MISMATCH" else
                   "attempt_mismatch" if head.startswith(("ATTEMPT", "FOREIGN_ATTEMPT", "ORPHANED")) else None)
            add(bucket, m, adv)
        if not self.finalized:
            if require_finalized:
                errs.append(f"SESSION_NOT_FINALIZED: {self.session_id}")
            return sorted(set(errs)), counts
        try:
            inv = self.inventory()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            add("changed", f"INVENTORY_TAMPERED: unreadable ({e})")
            return sorted(set(errs)), counts
        if not isinstance(inv, dict) or inv.get("schema") != EVIDENCE_INVENTORY_SCHEMA or inv.get("closed_world") is not True or inv.get("semantic_reconciliation") is not True or inv.get("recomputed_model") is not True:
            add("changed", "INVENTORY_TAMPERED: wrong schema or missing a frozen inventory property")
            return sorted(set(errs)), counts
        if inv.get("inventory_sha256") != inventory_digest(inv):
            add("changed", "INVENTORY_TAMPERED: inventory_sha256 is not the digest of this inventory")

        b = self.boundary_receipt()
        m = self.manifest()
        _t, ident = session_identity(m, os.path.basename(self.dir), boundary_identity(b))
        # ---- every normative inventory header field, derived independently (section 8/9)
        for field, want in (("evidence_store_version", EVIDENCE_STORE_VERSION), ("authority_version", L.AUTHORITY_VERSION),
                            ("platform_scope", PLATFORM_SCOPE), ("session_id", self.session_id),
                            ("session_dir_basename", os.path.basename(self.dir)), ("session_identity_sha256", ident),
                            ("boundary_identity_sha256", boundary_identity(b)), ("boundary_sha256", b["boundary_sha256"]),
                            ("session_manifest_sha256", self.manifest_sha256())):
            if inv.get(field) != want:
                add("semantic_mismatch", f"INVENTORY_TAMPERED: {field} is not the value derived from this session")
        if inv.get("mode_table") != {k: v for k, v in sorted(MODE_TABLE.items()) if v is not None}:
            add("semantic_mismatch", "INVENTORY_TAMPERED: mode_table is not the frozen store mode table")

        # ---- entries: EXPECTED (model) vs STORED (inventory), both directions, with duplicates refused first
        stored, dup = {}, []
        for e in inv.get("entries", []):
            if not isinstance(e, dict) or not isinstance(e.get("path"), str):
                add("changed", "INVENTORY_TAMPERED: malformed inventory entry")
                continue
            if e["path"] in stored:
                dup.append(e["path"])
            stored[e["path"]] = e
        for p in sorted(set(dup)):
            add("changed", f"INVENTORY_DUPLICATE_KEY: {p} appears more than once in the inventory")
        seenk = {}
        for e in stored.values():
            for k in ([("RK", e.get("layer"), e.get("record_key"))] if e.get("kind") == KIND_RECORD else []) + [("AK", None, ak) for ak in (e.get("attempt_keys") or [])]:
                if k in seenk:
                    add("changed", f"INVENTORY_DUPLICATE_KEY: {k[0]} {str(k[2])[:12]} appears twice")
                seenk[k] = e["path"]
        expected = {p: e for p, e in model["entries"].items() if p not in (INVENTORY_FILE, FINALIZED_FILE)}
        for rel in sorted(set(expected) - set(stored)):
            add("unexpected", f"UNEXPECTED_ENTRY: {rel} is present on disk but not in the finalized inventory")
        for rel in sorted(set(stored) - set(expected)):
            add("missing", f"RECORD_MISSING: {rel} is recorded in the inventory but is not a valid entry on disk")
        for rel in sorted(set(stored) & set(expected)):
            s_, x_ = stored[rel], expected[rel]
            for f in ("kind", "content_sha256", "byte_count", "file_type", "mode", "layer", "record_key",
                      "logical_identity", "internal_session_id", "internal_probe_id", "attempt_ids", "attempt_keys"):
                if s_.get(f) != x_.get(f):
                    bucket = "changed" if f in ("content_sha256", "byte_count", "file_type", "mode") else "semantic_mismatch"
                    adv = "metadata_mismatch" if f in ("mode", "file_type") else ("attempt_mismatch" if f.startswith("attempt") else None)
                    add(bucket, f"{'MODE_MISMATCH' if f == 'mode' else 'EVIDENCE_REPLACED' if f in ('content_sha256', 'byte_count') else 'LOGICAL_IDENTITY_MISMATCH' if f == 'logical_identity' else 'LAYER_IDENTITY_MISMATCH' if f == 'layer' else 'INVENTORY_TAMPERED'}: {rel} inventory {f}={s_.get(f)!r} but derived {x_.get(f)!r}", adv)

        # ---- directories, derived from kind, not trusted from the inventory (section 7)
        sdirs, ddup = {}, []
        for d in inv.get("directories", []):
            if not isinstance(d, dict) or not isinstance(d.get("path"), str):
                add("changed", "INVENTORY_TAMPERED: malformed inventory directory")
                continue
            if d["path"] in sdirs:
                ddup.append(d["path"])
            sdirs[d["path"]] = d
        for p in sorted(set(ddup)):
            add("changed", f"INVENTORY_DUPLICATE_KEY: directory {p} appears more than once in the inventory")
        for rel in sorted(set(model["directories"]) - set(sdirs)):
            add("unexpected", f"UNEXPECTED_ENTRY: directory {rel} is present on disk but not in the finalized inventory")
        for rel in sorted(set(sdirs) - set(model["directories"])):
            add("missing", f"RECORD_MISSING: directory {rel} is recorded in the inventory but absent or ungoverned on disk")
        for rel in sorted(set(sdirs) & set(model["directories"])):
            for f in ("kind", "file_type", "mode", "parent"):
                if sdirs[rel].get(f) != model["directories"][rel].get(f):
                    add("changed" if f in ("mode", "file_type") else "semantic_mismatch",
                        f"{'MODE_MISMATCH' if f == 'mode' else 'INVENTORY_TAMPERED'}: directory {rel} inventory {f}={sdirs[rel].get(f)!r} but derived {model['directories'][rel].get(f)!r}",
                        "metadata_mismatch" if f in ("mode", "file_type") else None)

        # ---- L9/L11 the inventory and the marker themselves
        files = model["files"]
        for f, kind in ((INVENTORY_FILE, KIND_INVENTORY), (FINALIZED_FILE, KIND_FINALIZATION_MARKER)):
            if f not in files:
                add("missing", f"RECORD_MISSING: {f}")
            elif files[f]["mode"] != expected_mode(kind):
                add("changed", f"MODE_MISMATCH: {f} mode {files[f]['mode']:#o} != expected {expected_mode(kind):#o}", "metadata_mismatch")

        # ---- L10 every normative finalization-marker field, derived and compared (sections 15/16)
        try:
            mk = self.finalization_marker()
        except (EvidenceStoreError, L.ParseError, ValueError, UnicodeDecodeError) as e:
            add("changed", f"FINALIZATION_MARKER_INVALID: unreadable ({e})")
            mk = None
        if mk is not None:
            if not isinstance(mk, dict) or sorted(mk) != sorted(("schema", "evidence_store_version", "authority_version",
                                                                 "platform_scope", "session_id", "session_identity_sha256",
                                                                 "boundary_identity_sha256", "inventory_sha256", "state")):
                add("changed", "FINALIZATION_MARKER_INVALID: field set is not the canonical finalization field set")
            else:
                for field, want in (("schema", EVIDENCE_FINALIZATION_SCHEMA),
                                    ("evidence_store_version", EVIDENCE_STORE_VERSION),
                                    ("authority_version", L.AUTHORITY_VERSION),
                                    ("platform_scope", PLATFORM_SCOPE),
                                    ("session_id", self.session_id),
                                    ("session_identity_sha256", ident),
                                    ("boundary_identity_sha256", boundary_identity(b)),
                                    ("inventory_sha256", inv.get("inventory_sha256")),
                                    ("state", "FINALIZED")):
                    if mk.get(field) != want:
                        add("semantic_mismatch" if field in ("session_id", "session_identity_sha256", "boundary_identity_sha256") else "changed",
                            f"FINALIZATION_MARKER_INVALID: {field}={mk.get(field)!r} but this session derives {want!r}")
        return sorted(set(errs)), counts

    def verify(self, require_finalized=True):
        return self.verify_summary(require_finalized)[0]

    def authority_errors(self, env, active, rp):
        try:
            sm = self.manifest()
        except (EvidenceStoreError, L.ParseError, ValueError) as e:
            return [f"MANIFEST_MISSING: {e}"]
        return [f"PINNED_AUTHORITY_MISMATCH: {e}" for e in L.session_manifest_errors(sm, env, active, rp)]


def create_session(root, session_id, manifest, created_at=None):
    """L1/L3/L4. Establish the boundary, create the session directory, persist the SESSION_BOUNDARY receipt as
    governed evidence, and complete the session identity with the boundary identity."""
    boundary = RootBoundary(root)
    _name(session_id)
    if session_id in RESERVED_NAMES:
        raise EvidenceStoreError("NAME_INVALID", session_id)
    if not isinstance(manifest, dict) or manifest.get("schema") != EVIDENCE_SESSION_SCHEMA or manifest.get("session_id") != session_id:
        raise EvidenceStoreError("PINNED_AUTHORITY_MISMATCH", "session manifest schema/session_id")
    if manifest.get("session_dir_basename") != session_id:
        raise EvidenceStoreError("SESSION_PATH_MISMATCH", "session manifest basename is not the session id")
    d = boundary.session_dir(session_id)
    try:
        _mkdir(d, MODE_TABLE[KIND_SESSION_DIR])
    except EvidenceStoreError as e:
        if e.code == "FS_EXISTS":
            raise EvidenceStoreError("SESSION_EXISTS", session_id)
        raise
    st = EvidenceStore(boundary, session_id)
    for sub, kind in [(x, KIND_LAYER_DIR) for x in LAYERS] + [(ATTEMPTS_DIR, KIND_ATTEMPTS_DIR), (TMP_DIR, KIND_TMP_DIR)]:
        _mkdir(os.path.join(d, sub), MODE_TABLE[kind])
    sst = _lstat(d)
    receipt = {
        "schema": EVIDENCE_BOUNDARY_SCHEMA,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
        "authority_version": L.AUTHORITY_VERSION,
        "platform_scope": PLATFORM_SCOPE,
        "session_id": session_id,
        "root_path": boundary.path,
        "root_device": boundary.dev,
        "root_inode": boundary.ino,
        "session_basename": session_id,
        "session_device": sst.st_dev,
        "session_inode": sst.st_ino,
        "created_at": created_at or manifest.get("created_at"),
    }
    receipt["boundary_sha256"] = boundary_digest(receipt)
    _write_once(os.path.join(d, BOUNDARY_FILE),
                (json.dumps(receipt, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                MODE_TABLE[KIND_BOUNDARY_RECEIPT])
    m = dict(manifest)
    m["session_identity_sha256"] = session_identity(m, session_id, boundary_identity(receipt))[1]
    _write_once(os.path.join(d, SESSION_FILE),
                (json.dumps(m, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
                MODE_TABLE[KIND_SESSION_MANIFEST])
    return st


def open_session(root, session_id):
    """L1/L3. Establish the boundary, then re-check it against the persisted receipt before the session is usable."""
    boundary = RootBoundary(root)
    _name(session_id)
    d = boundary.session_dir(session_id)
    if not os.path.isdir(d):
        raise EvidenceStoreError("SESSION_NOT_FOUND", session_id)
    st = EvidenceStore(boundary, session_id)
    st.check_boundary()
    return st


def list_sessions(root):
    boundary = RootBoundary(root)
    return sorted(n for n in fs(os.listdir, boundary.path)
                  if NAME_RE.match(n) and not os.path.islink(os.path.join(boundary.path, n))
                  and os.path.isdir(os.path.join(boundary.path, n)))
