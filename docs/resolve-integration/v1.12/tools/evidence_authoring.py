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
NAME_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def utc_now():
    """ISO-8601 Z, second precision - the form authority_lib.parse_ts accepts."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


ERRORS = (
    "ROOT_NOT_GOVERNED", "SET_EXISTS", "SET_NOT_FOUND", "SET_LOCATION_MISMATCH", "SET_TAMPERED",
    "STATE_INVALID", "STATE_TRANSITION_INVALID", "WRITE_NOT_GRANTED", "PRINCIPAL_INVALID",
    "PRINCIPAL_NOT_INDEPENDENT", "RECORD_TYPE_NOT_GRANTED", "RECORD_INVALID", "LOCK_HELD",
    "PREPARER_RECORD_MISSING", "VERIFICATION_EXISTS", "VERIFICATION_FAILED", "CONTRACT_MISMATCH",
    "SESSION_ID_INVALID", "FORBIDDEN_ENVELOPE_INPUT", "SET_STALE",
)


class AuthoringError(Exception):
    """Every refusal carries one closed code; nothing refuses anonymously."""

    def __init__(self, code, detail=""):
        assert code in ERRORS, code
        self.code, self.detail = code, str(detail)
        super().__init__(f"{code}: {self.detail}" if detail else code)


# ================================================================ V112-1 the governed path law
def governed_root(root=None):
    """THE governed evidence root. Production MUST use the frozen default; a caller-supplied root exists only so the
    validation suite can exercise the real code in a temporary directory, and the document records which root it was
    written under so a moved document is refused (see _load)."""
    return os.path.abspath(root or L.QUALIFICATION_EVIDENCE_ROOT)


def set_dir(session_id, root=None):
    """{root}/attachment/{session_id}/ - the one governed directory for one evaluated Resolve session."""
    _session_id(session_id)
    return os.path.join(governed_root(root), ATTACHMENT_SUBDIR, session_id)


def set_path(session_id, root=None):
    return os.path.join(set_dir(session_id, root), EVIDENCE_SET_FILE)


def workflow_path(session_id, root=None):
    return os.path.join(set_dir(session_id, root), WORKFLOW_FILE)


def _session_id(sid):
    if not isinstance(sid, str) or not sid or not NAME_SAFE.match(sid):
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

    def __init__(self, session_id, principal, root=None):
        self.path = os.path.join(set_dir(session_id, root), LOCK_FILE)
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


def _load(session_id, root=None):
    """Load the document and its workflow state, refusing a moved, missing or tampered document."""
    d = set_dir(session_id, root)
    sp, wp = set_path(session_id, root), workflow_path(session_id, root)
    if not os.path.exists(sp) or not os.path.exists(wp):
        raise AuthoringError("SET_NOT_FOUND", d)
    wf = L.strict_load(wp)
    es = L.strict_load(sp)
    # self-location check: the document says where it lives; a copy or move is refused
    if os.path.abspath(os.path.join(wf["governed_root"], ATTACHMENT_SUBDIR, wf["session_id"])) != os.path.abspath(d):
        raise AuthoringError("SET_LOCATION_MISMATCH",
                             f"document records {wf['governed_root']}/{ATTACHMENT_SUBDIR}/{wf['session_id']} but was loaded from {d}")
    if es.get("current_session_id") != wf["session_id"] or wf["session_id"] != session_id:
        raise AuthoringError("SET_TAMPERED", "session id disagrees between the document, the workflow and the path")
    if wf.get("state") not in L.EVIDENCE_SET_STATES:
        raise AuthoringError("STATE_INVALID", repr(wf.get("state")))
    if wf.get("evidence_set_sha256") and wf["evidence_set_sha256"] != _sha_file(sp):
        raise AuthoringError("SET_TAMPERED", "the document bytes differ from the digest sealed at VERIFIED")
    return es, wf


def _save(session_id, es, wf, root=None, seal=False):
    sp, wp = set_path(session_id, root), workflow_path(session_id, root)
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
def create_evidence_set(session_id, principal, root=None, evaluated_at=None):
    """PREPARER only. Create the governed directory and an OPEN document."""
    if L.principal_errors(principal, "PREPARER"):
        raise AuthoringError("PRINCIPAL_INVALID", f"{principal!r} is not a registered PREPARER principal")
    d = set_dir(session_id, root)
    if os.path.exists(set_path(session_id, root)):
        raise AuthoringError("SET_EXISTS", d)
    os.makedirs(d, mode=DIR_MODE, exist_ok=True)
    os.chmod(d, DIR_MODE)
    es = _blank_doc(session_id, evaluated_at)
    wf = {"schema": WORKFLOW_SCHEMA, "authority_version": L.AUTHORITY_VERSION,
          "manifest_sha256": active_authority()["manifest_sha256"], "session_id": session_id,
          "governed_root": governed_root(root), "state": "OPEN",
          "transitions": [{"state": "OPEN", "principal": principal, "at": utc_now()}],
          "prepared_content_sha256": None, "evidence_set_sha256": None}
    with _Lock(session_id, principal, root):
        _save(session_id, es, wf, root)
    return set_path(session_id, root)


def add_provisioning_record(session_id, principal, *, instance_uuid, root_path, provisioned_by,
                            root=None, envelope=None):
    """PREPARER only, OPEN only. LIBRARY level; the envelope uuid/root are derived from the body, never supplied."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal, root):
        es, wf = _load(session_id, root)
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
        _save(session_id, es, wf, root)
    return r


def add_launch_recipe(session_id, principal, *, recipe_sha256, root=None, envelope=None):
    """PREPARER only, OPEN only. SESSION level; version, binary pin, scripting preference and the provisioning
    binding are all DERIVED, so the three v1.11 traps cannot be reproduced by hand."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal, root):
        es, wf = _load(session_id, root)
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
        _save(session_id, es, wf, root)
    return r


def add_read_only_journal(session_id, principal, *, journal_path_sha256, root=None, envelope=None):
    """PREPARER only, OPEN only. Probe-ELIGIBILITY evidence (PERMISSIONS.json READ_ONLY_JOURNAL_OPEN), NOT
    attachment readiness: it is never a substitute for BUNDLE_VERIFICATION and the derivation ignores it."""
    _check_caller_envelope(envelope)
    tc, active = target_contract(), active_authority()
    with _Lock(session_id, principal, root):
        es, wf = _load(session_id, root)
        _authorize(wf, principal, "PREPARER", "READ_ONLY_JOURNAL")
        prov = _only(es, "PROVISIONING_RECORD")
        if prov is None:
            raise AuthoringError("PREPARER_RECORD_MISSING", "a READ_ONLY_JOURNAL is SESSION level and must cite the provisioning record")
        body = {"record_type": "READ_ONLY_JOURNAL", "recorded_at": utc_now(),
                "journal_path_sha256": journal_path_sha256,
                "envelope": _envelope("SESSION", tc, active, session_id=session_id, prov=prov, **(envelope or {}))}
        r = _add(es, body)
        _save(session_id, es, wf, root)
    return r


def mark_prepared(session_id, principal, root=None):
    """PREPARER only. OPEN -> PREPARED. Seals a digest over the preparer records so a later edit is detectable, and
    ends every preparer write grant: from here only a VERIFIER may write, and only BUNDLE_VERIFICATION."""
    if L.principal_errors(principal, "PREPARER"):
        raise AuthoringError("PRINCIPAL_INVALID", f"{principal!r} is not a registered PREPARER principal")
    with _Lock(session_id, principal, root):
        es, wf = _load(session_id, root)
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
        _save(session_id, es, wf, root)
    return wf["prepared_content_sha256"]


def add_bundle_verification(session_id, principal, root=None, envelope=None):
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
    with _Lock(session_id, principal, root):
        es, wf = _load(session_id, root)
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
        _save(session_id, es, wf, root, seal=True)
    if result != "PASS":
        raise AuthoringError("VERIFICATION_FAILED", "; ".join(checks[:4]))
    return r


# ================================================================ read + derive
def load_evidence_set(session_id, root=None):
    return _load(session_id, root)[0]


def workflow_state(session_id, root=None):
    return _load(session_id, root)[1]


def validate_evidence_set(session_id, root=None):
    """The v1.11 validator, unchanged, over the governed document."""
    return L.validate_evidence_set(load_evidence_set(session_id, root), active_authority())


def derive_attachment_state(session_id, root=None):
    """THE derivation entry point for a governed document. authority_lib#derive_attachment_state is unchanged apart
    from the v1.12 BUNDLE_VERIFICATION binding; nothing here re-implements it.

    V112-2 staleness: a governed document declares the instant it was evaluated. Deriving authority from a document
    whose evaluated_at is older than MAX_OBSERVATION_AGE_S would be reasoning over an old snapshot, so this entry
    point refuses it. This is a WORKFLOW law on the governed container; authority_lib's derivation, which has no
    concept of a governed document, is untouched."""
    es = load_evidence_set(session_id, root)
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
    return L.derive_attachment_state(target_contract(), es, active_authority())
