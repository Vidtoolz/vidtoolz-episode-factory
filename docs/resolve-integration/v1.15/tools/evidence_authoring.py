#!/usr/bin/env python3
"""THE production evidence-set authoring authority (v1.12).

v1.11 froze the FORM of a registered evidence record and the derivation that consumes it, and proved both correct.
It froze nothing about how such a document comes to exist: no governed location, no lifecycle, no writer, no
permission law and no production constructor. The only reference implementation of record assembly was
tools/fixture_evidence.py, which FREEZE-MANIFEST.json labels "never an authority". ATTACHMENT_READY was therefore
reachable only from fixtures, and two A2 repair cycles failed on that seam in the same way: evidence-STORE session
objects written where registered evidence-SET records were required.

This module closes exactly that gap and nothing else.

  V112-1  GOVERNED PERSISTENCE. One normative topology under QUALIFICATION_EVIDENCE_ROOT, with a path law derived
          from the session id, a self-location check, atomic replace and an O_EXCL writer lock.
  V112-2  DOCUMENT LIFECYCLE. OPEN -> PREPARED -> VERIFIED. Writes are granted by (state, role) and VERIFIED grants
          nothing to anyone, so there is no append-after-freeze path.
  V112-3  PRINCIPAL AND WRITE LAW. Each writing entry point stamps a principal from the frozen registry for the ONE
          role it implements, and refuses any record type outside that role's grant.
  V112-4  BUNDLE_VERIFICATION AUTHORING. An independent verifier may author it, and only it. The record binds the
          exact provisioning and launch records it verified, the pinned-file digests it computed itself, both
          principals and an explicit PASS/FAIL result. The derivation binds all of that (authority_lib).

v1.14 corrects the ONE BLOCKER Codex's independent harness found in v1.13 (V113-B1):

  V113-B1   AUTHORIZING LOCATION-CHECK BYPASS. v1.13 enforced the governed-location law HERE, in the authoring
            wrapper, while authority_lib.derive_attachment_state and authority_lib.evaluate_eligibility - the two
            functions actually declared AUTHORIZING - still accepted a bare evidence-set dict. A sandbox document
            this wrapper refused with NOT_PRODUCTION_ROOT was handed straight to the core and returned
            ATTACHMENT_READY, and to eligibility and returned eligible=true. The location check did not dominate the
            authorizing call graph.
            v1.14 moves location authority INTO the core: authority_lib.load_governed_evidence_set is the only door,
            authority_lib.derive_attachment_state_authorizing and evaluate_eligibility_authorizing accept only its
            GovernedEvidenceSet and re-verify the location receipt against the real filesystem first, and the two
            old functions are demoted to DIAGNOSTIC / NON_AUTHORIZING. The trust helpers below now delegate to the
            core's single implementation (authority_lib.governed_dir_errors / location_errors / session_id_errors);
            this wrapper keeps its own early checks as defence in depth, which is deliberate.

v1.13 corrects the ONE defect Codex's runtime-parity oracle found in v1.12 (V112-RP1, WORKFLOW_CONTRADICTORY):

  V112-RP1  CALLER-SELECTABLE GOVERNED ROOT. v1.12 froze "exactly one governed attachment evidence root" in prose
            while every authorizing function took `root=None` and both CLIs took `--evidence-root`, justified as a
            test convenience. Reproduced against the frozen v1.12 bundle: a complete production-CLI workflow under an
            arbitrary /tmp root AND under a SYMLINKED root both derived ATTACHMENT_READY. The law and the code
            contradicted each other, and the code won.
            v1.13 removes root selection from the authorizing surface entirely. No authorizing function and no CLI
            takes a root. governed_attachment_root() takes NO ARGUMENT and returns authority_lib's frozen constant.
            The root and the session directory are inspected with lstat BEFORE any resolution, so a symlink at
            either is refused rather than followed. Every authorizing load re-derives the canonical path and refuses
            a document found anywhere else, and the authorizing derivation additionally refuses any document whose
            recorded authority root is not exactly the frozen constant. Scratch roots for the validation suite live
            in tools/evidence_authoring_testkit.py, which is INTERNAL_NON_AUTHORIZING, is not importable from either
            CLI, and marks every document it produces so the authorizing derivation refuses it.

TWO CONTAINER MODELS, DELIBERATELY NOT MERGED (v1.12 scope rule 2):
  A. tools/evidence_store.py (Store.v5) - raw M0A capture evidence and session integrity. Type-agnostic,
     content-addressed, append-only, FINALIZED. Untouched by v1.12.
  B. this module - the resolveEvidenceSet document that carries attachment and provisioning authority.
`current_session_id` is a LABEL naming the Resolve session under evaluation. It is not a Store.v5 session id and this
module never creates, opens, finalizes or reads a Store.v5 session.

HONESTY: a principal is a role-bound operational label, not an authenticated identity. See authority_lib's
PRINCIPAL_REGISTRY note and THREAT-MODEL.md.
"""
import datetime
import errno
import hashlib
import json
import os
import re
import stat
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

WORKFLOW_SCHEMA = "vidtoolz.resolveEvidenceSetWorkflow.v1"
EVIDENCE_SET_FILE = "EVIDENCE-SET.json"
WORKFLOW_FILE = "WORKFLOW.json"
LOCK_FILE = "LOCK"
ATTACHMENT_SUBDIR = "attachment"
DIR_MODE = 0o700
OPEN_MODE = 0o600
SEALED_MODE = 0o400

# The session id becomes a directory name under the governed root, so authoring constrains it to a safe basename.
# This is an AUTHORING restriction only: the resolveEvidenceSet schema still types current_session_id as a string
# and the derivation is unchanged. A pre-existing session id outside this shape cannot be governed by this topology.
# V112-RP1 section 5 / V113-B1 section 7: the safe-basename law is now held ONCE, in the core
# (authority_lib.SESSION_ID_RE / session_id_errors). This alias exists so existing references keep working and so
# there is provably no second implementation.
NAME_SAFE = L.SESSION_ID_RE
SESSION_ID_REJECTS = ("", ".", "..", "/", "\\", "a/b", "a\\b", "../escape", "/abs", "./x", ".hidden", "~", "~/x",
                      "a\x00b", "C:\\x", " lead", "trail ", "x" * 129)


def utc_now():
    """ISO-8601 Z, second precision - the form authority_lib.parse_ts accepts."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


ERRORS = (
    "ROOT_NOT_GOVERNED", "SET_EXISTS", "SET_NOT_FOUND", "SET_LOCATION_MISMATCH", "SET_TAMPERED",
    "STATE_INVALID", "STATE_TRANSITION_INVALID", "WRITE_NOT_GRANTED", "PRINCIPAL_INVALID",
    "PRINCIPAL_NOT_INDEPENDENT", "RECORD_TYPE_NOT_GRANTED", "RECORD_INVALID", "LOCK_HELD",
    "PREPARER_RECORD_MISSING", "VERIFICATION_EXISTS", "VERIFICATION_FAILED", "CONTRACT_MISMATCH",
    "SESSION_ID_INVALID", "FORBIDDEN_ENVELOPE_INPUT", "SET_STALE",
    # ---- v1.13 (V112-RP1) governed-location refusals
    "ROOT_NOT_GOVERNED", "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_NOT_FOUND", "ROOT_MODE_INVALID",
    "SESSION_SYMLINK_REFUSED", "SESSION_NOT_A_DIRECTORY", "SESSION_PATH_NOT_GOVERNED", "NOT_PRODUCTION_ROOT",
    # ---- v1.15 (V114-B4) authority-FILE refusals, relabelled from the core's single file-entry law
    "DOCUMENT_SYMLINK_REFUSED", "DOCUMENT_NOT_A_REGULAR_FILE", "DOCUMENT_NOT_AT_CANONICAL_PATH",
    "WORKFLOW_SYMLINK_REFUSED", "WORKFLOW_NOT_A_REGULAR_FILE", "WORKFLOW_NOT_AT_CANONICAL_PATH",
)


class AuthoringError(Exception):
    """Every refusal carries one closed code; nothing refuses anonymously."""

    def __init__(self, code, detail=""):
        assert code in ERRORS, code
        self.code, self.detail = code, str(detail)
        super().__init__(f"{code}: {self.detail}" if detail else code)


# ================================================================ V112-1 / V112-RP1 the governed path law
# THE authority root, and the ONLY one. Set exclusively by the INTERNAL_NON_AUTHORIZING testkit; no authorizing
# function, no CLI and no caller argument can influence it. A document written while a sandbox is active records
# written_under_production_root=false and is refused by the authorizing derivation.
_SANDBOX_ROOT = None


def governed_attachment_root():
    """THE governed attachment evidence root. Takes NO ARGUMENT (V112-RP1): there is nothing for a caller to choose."""
    return _SANDBOX_ROOT if _SANDBOX_ROOT is not None else L.GOVERNED_ATTACHMENT_ROOT


def is_production_root():
    """True only when the frozen authority root is in force. False inside the non-authorizing testkit sandbox."""
    return _SANDBOX_ROOT is None


def set_dir(session_id):
    """<governed attachment root>/<session_id>/ - the one governed directory for one evaluated Resolve session."""
    _session_id(session_id)
    return os.path.join(governed_attachment_root(), session_id)


def set_path(session_id):
    return os.path.join(set_dir(session_id), EVIDENCE_SET_FILE)


def workflow_path(session_id):
    return os.path.join(set_dir(session_id), WORKFLOW_FILE)


def canonical_set_dir(session_id):
    """The canonical governed directory under the FROZEN authority root, independent of any sandbox. Delegates to the
    core (authority_lib.canonical_session_dir) so there is one path law, not two."""
    _session_id(session_id)
    return L.canonical_session_dir(session_id)


# ================================================================ V112-RP1 root and session entry trust
def _lstat_or_none(p):
    """The directory ENTRY itself, never its target. lstat FIRST; nothing is resolved before it is classified."""
    try:
        return os.lstat(p)
    except (FileNotFoundError, NotADirectoryError):
        return None


def _require_trusted_dir(p, symlink_code, notdir_code, missing_code, want_mode=None):
    """Delegates to the CORE trust implementation (authority_lib.governed_dir_errors) and re-labels its codes into
    this module's vocabulary. V113-B1 section 7: there is exactly one directory-entry trust implementation."""
    kind = "ROOT" if symlink_code.startswith("ROOT") else "SESSION"
    errs = L.governed_dir_errors(p, kind, want_mode=want_mode)
    if errs:
        code, _, detail = errs[0].partition(": ")
        mapped = {f"{kind}_SYMLINK_REFUSED": symlink_code, f"{kind}_NOT_A_DIRECTORY": notdir_code,
                  f"{kind}_NOT_FOUND": missing_code, f"{kind}_MODE_INVALID": "ROOT_MODE_INVALID",
                  f"{kind}_NOT_GOVERNED": "ROOT_NOT_GOVERNED" if kind == "ROOT" else "SESSION_PATH_NOT_GOVERNED"}
        raise AuthoringError(mapped.get(code, "ROOT_NOT_GOVERNED"), detail or p)
    return _lstat_or_none(p)


def require_governed_root():
    """V112-RP1 section 6. Inspect the governed root ENTRY with no-follow semantics before anything is created or
    opened. The literal path must be absolute and already normal, must exist, must be a directory, must not be a
    symlink, and must carry the frozen mode. Nothing is resolved first and then trusted."""
    root = governed_attachment_root()
    if not os.path.isabs(root) or os.path.normpath(root) != root:
        raise AuthoringError("ROOT_NOT_GOVERNED", f"{root!r} is not an absolute normalised path")
    _require_trusted_dir(root, "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_NOT_FOUND",
                         want_mode=L.GOVERNED_ROOT_MODE)
    return root


def require_governed_session_dir(session_id, must_exist=True):
    """V112-RP1 section 7. The session directory entry itself: non-symlink, a real directory, the expected basename,
    contained directly in the governed root, and free of any alias."""
    require_governed_root()
    d = set_dir(session_id)
    if os.path.basename(d) != session_id or os.path.dirname(d) != governed_attachment_root():
        raise AuthoringError("SESSION_PATH_NOT_GOVERNED", d)
    if _lstat_or_none(d) is None:
        if must_exist:
            raise AuthoringError("SET_NOT_FOUND", d)
        return d
    _require_trusted_dir(d, "SESSION_SYMLINK_REFUSED", "SESSION_NOT_A_DIRECTORY", "SET_NOT_FOUND")
    return d


def _session_id(sid):
    """Delegates to the core session-id law (V113-B1 section 7: one implementation)."""
    if L.session_id_errors(sid):
        raise AuthoringError("SESSION_ID_INVALID", repr(sid))
    return sid


def _sha_file(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _canon_bytes(obj):
    return (json.dumps(obj, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _write_atomic(path, data, mode=OPEN_MODE):
    """Atomic replace: write a sibling temp, fsync, chmod, rename over. Never a partial document."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, ".tmp-" + hashlib.sha256(data + os.urandom(16)).hexdigest()[:24])
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, OPEN_MODE)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(tmp, mode)
    os.replace(tmp, path)
    dfd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


# ================================================================ V112-1 writer exclusivity
class _Lock:
    """O_EXCL writer lock in the document's own directory. Single-host qualification: one writer at a time, the
    holder's principal and pid recorded, released on exit even on failure. No distributed locking is claimed."""

    def __init__(self, session_id, principal):
        self.path = os.path.join(set_dir(session_id), LOCK_FILE)
        self.principal = principal
        self.fd = None

    def __enter__(self):
        try:
            self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, OPEN_MODE)
        except OSError as e:
            if e.errno == errno.EEXIST:
                try:
                    held = open(self.path, encoding="utf-8").read()[:200]
                except OSError:
                    held = "unreadable"
                raise AuthoringError("LOCK_HELD", f"{self.path} held by {held}")
            raise
        os.write(self.fd, json.dumps({"principal": self.principal, "pid": os.getpid()}).encode("utf-8"))
        os.fsync(self.fd)
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        try:
            os.unlink(self.path)
        except OSError:
            pass
        return False


# ================================================================ active authority and contract, read from the bundle
def active_authority():
    """The ACTIVE authority this bundle IS: the authority version, the sha256 of its own FREEZE-MANIFEST.json, and
    the canonical content digest of its capability matrix. Never caller-supplied."""
    man = os.path.join(BUNDLE, "FREEZE-MANIFEST.json")
    caps = L.strict_load(os.path.join(BUNDLE, "CAPABILITIES.json"))
    return {"authority_version": L.AUTHORITY_VERSION, "manifest_sha256": _sha_file(man),
            "capability_matrix_sha256": L.capability_matrix_digest(caps),
            "trusted_shim_sha256": L.trusted_capture_shim()["trusted_shim_sha256"]}


def target_contract():
    return L.strict_load(os.path.join(BUNDLE, "TARGET-CONTRACT.json"))


# ================================================================ V112-3 envelope derivation law
# derived_from_target_contract : host_name, product, resolve_version, build, library_name
# derived_from_active_authority: authority_version, manifest_sha256
# derived_from_provisioning    : library_uuid, library_root, provisioning_id
# derived_from_document        : session_id
# derived_from_store_law       : record_type_version
# caller_supplied              : sequence, captured_at
# forbidden_to_caller          : every other envelope field (project/timeline/target_epoch stay null at these levels)
ENVELOPE_CALLER_SUPPLIED = ("sequence", "captured_at")
ENVELOPE_DERIVED = ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build",
                    "library_name", "library_uuid", "library_root", "session_id", "provisioning_id",
                    "record_type_version")
ENVELOPE_FORBIDDEN_TO_CALLER = tuple(f for f in L.ENVELOPE_FIELDS
                                     if f not in ENVELOPE_CALLER_SUPPLIED + ENVELOPE_DERIVED)


def _envelope(level, tc, active, session_id=None, prov=None, sequence=0, captured_at=None):
    """Build the envelope from authority, never from caller strings. resolve_version is the COMPUTED contract form
    (_contract_env), which is the v1.11 trap that broke the first repair: tc['resolve']['version'] is NOT it."""
    C = L._contract_env(tc)
    env = {k: None for k in L.ENVELOPE_FIELDS}
    env.update(authority_version=active["authority_version"], manifest_sha256=active["manifest_sha256"],
               host_name=C["host_name"], record_type_version=L.RECORD_TYPE_VERSION,
               sequence=int(sequence), captured_at=captured_at or utc_now())
    if level in ("LIBRARY", "SESSION"):
        env.update(library_name=C["library_name"])
        if prov is not None:
            env.update(library_uuid=prov["instance_uuid"], library_root=prov["root_path"])
    if level == "SESSION":
        env.update(product=C["product"], resolve_version=C["resolve_version"], build=C["build"],
                   session_id=session_id, provisioning_id=(prov or {}).get("record_id"))
    return env


def _check_caller_envelope(over):
    bad = sorted(set(over or {}) - set(ENVELOPE_CALLER_SUPPLIED))
    if bad:
        raise AuthoringError("FORBIDDEN_ENVELOPE_INPUT",
                             f"{bad} are derived from authority and may not be supplied; caller may set only "
                             f"{list(ENVELOPE_CALLER_SUPPLIED)}")


# ================================================================ V112-2 document + workflow state
def _blank_doc(session_id, evaluated_at):
    return {"schema": L.EVIDENCE_SET_SCHEMA_ID, "current_session_id": session_id,
            "evaluated_at": evaluated_at or utc_now(), "records": {}}


def _load(session_id):
    """Load the document and its workflow state, refusing a moved, missing, relocated or tampered document.

    V112-RP1 section 11: the governed location is re-established on EVERY authorizing load, not only at creation.
    Root entry trust, session entry trust and the self-location check all run here, so update, verify, finalize and
    derive are each as protected as create."""
    d = require_governed_session_dir(session_id, must_exist=True)
    sp, wp = set_path(session_id), workflow_path(session_id)
    # v1.15 (V114-B4): BOTH authority files are classified and read through the CORE file law - lstat first, symlink
    # refused, regular file required, O_NOFOLLOW open re-verified by fstat. v1.14 read them with strict_load, which
    # follows a symlink, blocks forever on a FIFO and raises a raw IsADirectoryError on a directory. The wrapper must
    # not be weaker than the core it defends: that asymmetry is exactly what V113-B1 and V114-B4 both were.
    _raw, _sha_es, _errs = L.read_governed_file(sp, "DOCUMENT")
    if _errs:
        code, _, detail = _errs[0].partition(": ")
        raise AuthoringError("SET_NOT_FOUND" if code.endswith("NOT_FOUND") else code, detail or sp)
    _wraw, _sha_wf, _errs = L.read_governed_file(wp, "WORKFLOW")
    if _errs:
        code, _, detail = _errs[0].partition(": ")
        raise AuthoringError("SET_NOT_FOUND" if code.endswith("NOT_FOUND") else code, detail or wp)
    wf = L.strict_loads(_wraw.decode("utf-8"))
    es = L.strict_loads(_raw.decode("utf-8"))
    # self-location check: the document says where it lives; a copy or move is refused
    if os.path.abspath(os.path.join(wf["governed_root"], wf["session_id"])) != os.path.abspath(d):
        raise AuthoringError("SET_LOCATION_MISMATCH",
                             f"document records {wf['governed_root']}/{wf['session_id']} but was loaded from {d}")
    if es.get("current_session_id") != wf["session_id"] or wf["session_id"] != session_id:
        raise AuthoringError("SET_TAMPERED", "session id disagrees between the document, the workflow and the path")
    if wf.get("state") not in L.EVIDENCE_SET_STATES:
        raise AuthoringError("STATE_INVALID", repr(wf.get("state")))
    if wf.get("evidence_set_sha256") and wf["evidence_set_sha256"] != _sha_es:
        raise AuthoringError("SET_TAMPERED", "the document bytes differ from the digest sealed at VERIFIED")
    return es, wf


def _save(session_id, es, wf, seal=False):
    sp, wp = set_path(session_id), workflow_path(session_id)
    _write_atomic(sp, _canon_bytes(es), SEALED_MODE if seal else OPEN_MODE)
    if seal:
        wf["evidence_set_sha256"] = _sha_file(sp)
    _write_atomic(wp, _canon_bytes(wf), SEALED_MODE if seal else OPEN_MODE)


def _authorize(wf, principal, role, record_type):
    """The single choke point: principal registered for the role, and (state, role) grants this record type."""
    errs = L.principal_errors(principal, role)
    if errs:
        raise AuthoringError("PRINCIPAL_INVALID", "; ".join(errs))
    if not L.may_write(wf["state"], role, record_type):
        raise AuthoringError("WRITE_NOT_GRANTED",
                             f"state {wf['state']} grants {role} {list((L.EVIDENCE_SET_STATE_GRANTS.get(wf['state']) or {}).get(role, ()))}, not {record_type}")


def _add(es, rec):
    """Register the record through the v1.11 record-id law and key it by the returned id. There is no body-only path."""
    r = L.make_record(rec)
    errs = L.envelope_errors(r)
    if errs:
        raise AuthoringError("RECORD_INVALID", "; ".join(errs[:4]))
    es["records"][r["record_id"]] = r
    return r


def _only(es, rtype):
    rs = [r for r in es["records"].values() if r.get("record_type") == rtype]
    return rs[0] if len(rs) == 1 else None


# ================================================================ public authoring API (V112-3 grants enforced)
def create_evidence_set(session_id, principal, evaluated_at=None):
    """PREPARER only. Create the governed directory and an OPEN document."""
    if L.principal_errors(principal, "PREPARER"):
        raise AuthoringError("PRINCIPAL_INVALID", f"{principal!r} is not a registered PREPARER principal")
    require_governed_root()                                   # V112-RP1: lstat-first root trust BEFORE anything exists
    d = require_governed_session_dir(session_id, must_exist=False)
    if os.path.exists(set_path(session_id)):
        raise AuthoringError("SET_EXISTS", d)
    os.makedirs(d, mode=DIR_MODE, exist_ok=True)
    os.chmod(d, DIR_MODE)
    es = _blank_doc(session_id, evaluated_at)
    wf = {"schema": WORKFLOW_SCHEMA, "authority_version": L.AUTHORITY_VERSION,
          "manifest_sha256": active_authority()["manifest_sha256"], "session_id": session_id,
          "governed_root": governed_attachment_root(),
          # V112-RP1: the FROZEN authority root this document claims, and whether it was actually written under it.
          # The authorizing derivation requires both to be the production values, so a sandbox document is never
          # authority no matter how well formed it is.
          "authority_root": L.GOVERNED_ATTACHMENT_ROOT,
          "written_under_production_root": is_production_root(),
          "state": "OPEN",
          "transitions": [{"state": "OPEN", "principal": principal, "at": utc_now()}],
          "prepared_content_sha256": None, "evidence_set_sha256": None}
    with _Lock(session_id, principal):
        _save(session_id, es, wf)
    return set_path(session_id)


def add_provisioning_record(session_id, principal, *, instance_uuid, root_path, provisioned_by, envelope=None):
    """PREPARER only, OPEN only. LIBRARY level; the envelope uuid/root are derived from the body, never supplied."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal):
        es, wf = _load(session_id)
        _authorize(wf, principal, "PREPARER", "PROVISIONING_RECORD")
        if _only(es, "PROVISIONING_RECORD") is not None:
            raise AuthoringError("RECORD_INVALID", "a PROVISIONING_RECORD already exists; exactly one identity is permitted")
        body = {"record_type": "PROVISIONING_RECORD", "recorded_at": utc_now(),
                "library_kind": "Disk", "root_path": root_path, "instance_uuid": instance_uuid,
                "provisioned_by": provisioned_by}
        env = _envelope("LIBRARY", tc, active, **(envelope or {}))
        env.update(library_uuid=instance_uuid, library_root=root_path)
        body["envelope"] = env
        if not L.is_uuid(instance_uuid):
            raise AuthoringError("RECORD_INVALID", f"instance_uuid {instance_uuid!r} is not a uuid")
        if not L.is_abs_path(root_path):
            raise AuthoringError("RECORD_INVALID", f"root_path {root_path!r} is not an absolute traversal-free path")
        r = _add(es, body)
        _save(session_id, es, wf)
    return r


def add_launch_recipe(session_id, principal, *, recipe_sha256, envelope=None):
    """PREPARER only, OPEN only. SESSION level; version, binary pin, scripting preference and the provisioning
    binding are all DERIVED, so the three v1.11 traps cannot be reproduced by hand."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal):
        es, wf = _load(session_id)
        _authorize(wf, principal, "PREPARER", "LAUNCH_RECIPE")
        prov = _only(es, "PROVISIONING_RECORD")
        if prov is None:
            raise AuthoringError("PREPARER_RECORD_MISSING", "a LAUNCH_RECIPE must cite exactly one PROVISIONING_RECORD")
        if _only(es, "LAUNCH_RECIPE") is not None:
            raise AuthoringError("RECORD_INVALID", "a LAUNCH_RECIPE already exists for this session")
        C = L._contract_env(tc)
        body = {"record_type": "LAUNCH_RECIPE", "recorded_at": utc_now(),
                "recipe_sha256": recipe_sha256, "resolve_version": C["resolve_version"],
                "resolve_binary_sha256": tc["resolve"]["pins"]["/opt/resolve/bin/resolve"],
                "external_scripting_preference": tc["session"]["external_scripting_preference_required"],
                "envelope": _envelope("SESSION", tc, active, session_id=session_id, prov=prov, **(envelope or {}))}
        if not L.is_sha(recipe_sha256):
            raise AuthoringError("RECORD_INVALID", "recipe_sha256 must be the sha256 of the recorded launch script")
        r = _add(es, body)
        _save(session_id, es, wf)
    return r


def add_read_only_journal(session_id, principal, *, journal_path_sha256, envelope=None):
    """PREPARER only, OPEN only. Probe-ELIGIBILITY evidence (PERMISSIONS.json READ_ONLY_JOURNAL_OPEN), NOT
    attachment readiness: it is never a substitute for BUNDLE_VERIFICATION and the derivation ignores it."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal):
        es, wf = _load(session_id)
        _authorize(wf, principal, "PREPARER", "READ_ONLY_JOURNAL")
        prov = _only(es, "PROVISIONING_RECORD")
        if prov is None:
            raise AuthoringError("PREPARER_RECORD_MISSING", "a READ_ONLY_JOURNAL is SESSION level and must cite the provisioning record")
        body = {"record_type": "READ_ONLY_JOURNAL", "recorded_at": utc_now(),
                "journal_path_sha256": journal_path_sha256,
                "envelope": _envelope("SESSION", tc, active, session_id=session_id, prov=prov, **(envelope or {}))}
        r = _add(es, body)
        _save(session_id, es, wf)
    return r


def mark_prepared(session_id, principal):
    """PREPARER only. OPEN -> PREPARED. Seals a digest over the preparer records so a later edit is detectable, and
    ends every preparer write grant: from here only a VERIFIER may write, and only BUNDLE_VERIFICATION."""
    if L.principal_errors(principal, "PREPARER"):
        raise AuthoringError("PRINCIPAL_INVALID", f"{principal!r} is not a registered PREPARER principal")
    with _Lock(session_id, principal):
        es, wf = _load(session_id)
        if wf["state"] != "OPEN":
            raise AuthoringError("STATE_TRANSITION_INVALID", f"{wf['state']} -> PREPARED")
        for rt in ("PROVISIONING_RECORD", "LAUNCH_RECIPE"):
            if _only(es, rt) is None:
                raise AuthoringError("PREPARER_RECORD_MISSING", f"exactly one {rt} is required before PREPARED")
        wf["state"] = "PREPARED"
        wf["prepared_content_sha256"] = L.digest(
            {rt: _only(es, rt)["record_id"] for rt in ("PROVISIONING_RECORD", "LAUNCH_RECIPE")},
            "vidtoolz.resolveEvidenceRecord.v1")
        wf["transitions"].append({"state": "PREPARED", "principal": principal, "at": utc_now()})
        _save(session_id, es, wf)
    return wf["prepared_content_sha256"]


def add_bundle_verification(session_id, principal, envelope=None):
    """VERIFIER only, PREPARED only. PREPARED -> VERIFIED.

    Everything in the record is DERIVED or INDEPENDENTLY COMPUTED; the caller supplies only its own principal:
      - the preparer principal is read from the workflow transitions, not from the caller
      - the pinned-file digest set is hashed FROM DISK here, never taken from the preparer
      - the manifest digest is hashed from this bundle's own FREEZE-MANIFEST.json
      - the verified provisioning and launch record ids are read from the document
      - verification_result is PASS only if every check passes; a FAIL record is written for audit and the
        derivation refuses it
    """
    _check_caller_envelope(envelope)
    if L.principal_errors(principal, "VERIFIER"):
        raise AuthoringError("PRINCIPAL_INVALID", f"{principal!r} is not a registered VERIFIER principal")
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal):
        es, wf = _load(session_id)
        _authorize(wf, principal, "VERIFIER", "BUNDLE_VERIFICATION")
        if _only(es, "BUNDLE_VERIFICATION") is not None:
            raise AuthoringError("VERIFICATION_EXISTS", "this document already carries a BUNDLE_VERIFICATION")
        prov, launch = _only(es, "PROVISIONING_RECORD"), _only(es, "LAUNCH_RECIPE")
        if prov is None or launch is None:
            raise AuthoringError("PREPARER_RECORD_MISSING", "both preparer records must be present and unique")
        prep = next((t["principal"] for t in reversed(wf["transitions"]) if t["state"] == "PREPARED"), None)
        if L.principal_errors(prep, "PREPARER"):
            raise AuthoringError("PRINCIPAL_INVALID", f"workflow preparer principal {prep!r} is not registered")
        if L.principal_actor(prep) == L.principal_actor(principal):
            raise AuthoringError("PRINCIPAL_NOT_INDEPENDENT",
                                 f"preparer and verifier are the same actor ({L.principal_actor(prep)})")
        # ---- independent checks, computed here and nowhere else
        checks, pins = [], {}
        for p, want in sorted(tc["resolve"]["pins"].items()):
            got = _sha_file(p) if os.path.exists(p) else None
            pins[p] = got
            if got != want:
                checks.append(f"pinned file {p}: {'absent' if got is None else 'digest ' + got[:12]} != contract {want[:12]}")
        if wf["prepared_content_sha256"] != L.digest(
                {rt: _only(es, rt)["record_id"] for rt in ("PROVISIONING_RECORD", "LAUNCH_RECIPE")},
                "vidtoolz.resolveEvidenceRecord.v1"):
            checks.append("preparer records changed after PREPARED")
        C = L._contract_env(tc)
        if launch.get("resolve_binary_sha256") != tc["resolve"]["pins"]["/opt/resolve/bin/resolve"]:
            checks.append("LAUNCH_RECIPE resolve_binary_sha256 is not the contract pin")
        if launch.get("resolve_version") != C["resolve_version"]:
            checks.append("LAUNCH_RECIPE resolve_version is not the computed contract version")
        if prov.get("library_kind") != "Disk" or (prov["envelope"].get("library_name") != C["library_name"]):
            checks.append("PROVISIONING_RECORD is not a Disk library matching the contract")
        if C["library_name"] in tc["library"].get("prohibited_library_names", []):
            checks.append("contract library is a prohibited library")
        result = "PASS" if not checks else "FAIL"
        body = {"record_type": "BUNDLE_VERIFICATION", "recorded_at": utc_now(),
                "authority_version": active["authority_version"], "manifest_sha256": active["manifest_sha256"],
                "verifier": principal, "prepared_by": prep, "historical": False,
                "verification_result": result,
                "verifier_principal": principal, "preparer_principal": prep,
                "verified_provisioning_id": prov["record_id"],
                "verified_launch_recipe_id": launch["record_id"],
                "pinned_file_digests": pins,
                "envelope": _envelope("BUNDLE", tc, active, **(envelope or {}))}
        r = _add(es, body)
        wf["state"] = "VERIFIED"
        wf["transitions"].append({"state": "VERIFIED", "principal": principal, "at": utc_now(),
                                  "verification_result": result, "failed_checks": checks})
        _save(session_id, es, wf, seal=True)
    if result != "PASS":
        raise AuthoringError("VERIFICATION_FAILED", "; ".join(checks[:4]))
    return r


# ================================================================ read + derive
def load_evidence_set(session_id):
    return _load(session_id)[0]


def workflow_state(session_id):
    return _load(session_id)[1]


def validate_evidence_set(session_id):
    """The v1.11 validator, unchanged, over the governed document."""
    return L.validate_evidence_set(load_evidence_set(session_id), active_authority())


def derive_attachment_state(session_id):
    """THE derivation entry point for a governed document. authority_lib#derive_attachment_state is unchanged apart
    from the v1.12 BUNDLE_VERIFICATION binding; nothing here re-implements it.

    V112-2 staleness: a governed document declares the instant it was evaluated. Deriving authority from a document
    whose evaluated_at is older than MAX_OBSERVATION_AGE_S would be reasoning over an old snapshot, so this entry
    point refuses it. This is a WORKFLOW law on the governed container; authority_lib's derivation, which has no
    concept of a governed document, is untouched."""
    es, wf = _load(session_id)
    # V112-RP1: the authorizing derivation is the last gate, so it re-states the location law itself. A document that
    # is well formed, correctly sequenced and independently verified is STILL not authority unless it lives at the
    # canonical governed path under the frozen authority root and was written there.
    if not is_production_root():
        raise AuthoringError("NOT_PRODUCTION_ROOT",
                             f"the frozen authority root is {L.GOVERNED_ATTACHMENT_ROOT}; this process is operating "
                             f"under the non-authorizing sandbox root {governed_attachment_root()}")
    if wf.get("authority_root") != L.GOVERNED_ATTACHMENT_ROOT:
        raise AuthoringError("ROOT_NOT_GOVERNED",
                             f"document claims authority root {wf.get('authority_root')!r}, not {L.GOVERNED_ATTACHMENT_ROOT!r}")
    if wf.get("written_under_production_root") is not True:
        raise AuthoringError("NOT_PRODUCTION_ROOT",
                             "document was not written under the frozen authority root and can never be authority")
    if os.path.abspath(set_dir(session_id)) != canonical_set_dir(session_id):
        raise AuthoringError("SESSION_PATH_NOT_GOVERNED",
                             f"{set_dir(session_id)} != canonical {canonical_set_dir(session_id)}")
    require_fresh(es)
    # V113-B1: the wrapper's own checks above are retained as defence in depth, but the AUTHORIZING answer now comes
    # from the core, which re-verifies the governed location itself. The wrapper can no longer be the only guard.
    active = active_authority()
    governed = L.load_governed_evidence_set(session_id, active)
    out = L.derive_attachment_state_authorizing(target_contract(), governed, active)
    if not out.get("authorizing"):
        raise AuthoringError("NOT_PRODUCTION_ROOT", "; ".join(out.get("failures", [])[:3]))
    return out


def load_governed(session_id):
    """The authoring layer's door to the core's governed loader. Returns an authority_lib.GovernedEvidenceSet, the
    only input the authorizing derivation and the authorizing eligibility gate accept."""
    return L.load_governed_evidence_set(session_id, active_authority())


def evaluate_eligibility_authorizing(perms, request, rp, caps, session_id):
    """The authoring layer's authorizing eligibility path: load by canonical session id and evaluate. Fail-closed on
    location provenance, because the core is."""
    active = active_authority()
    return L.evaluate_eligibility_authorizing(perms, request, rp, caps, target_contract(),
                                              L.load_governed_evidence_set(session_id, active), active)


def require_fresh(es):
    """V112-2 staleness. A law of the governed DOCUMENT, not of the root: deriving authority from a document whose
    evaluated_at is old would be reasoning over a stale snapshot. Applied by the authorizing derivation and by the
    non-authorizing testkit alike, so a sandbox cannot establish a state production would refuse."""
    ev = L.parse_ts(es.get("evaluated_at"))
    if ev is None:
        raise AuthoringError("SET_STALE", f"evaluated_at {es.get('evaluated_at')!r} is not ISO-8601")
    age = (datetime.datetime.now(datetime.timezone.utc) - ev).total_seconds()
    if age > L.MAX_OBSERVATION_AGE_S:
        raise AuthoringError("SET_STALE",
                             f"evaluated_at is {int(age)}s old; the governed document is stale beyond "
                             f"MAX_OBSERVATION_AGE_S ({L.MAX_OBSERVATION_AGE_S}s)")
    if age < -60:
        raise AuthoringError("SET_STALE", f"evaluated_at is {int(-age)}s in the future")
    return True
