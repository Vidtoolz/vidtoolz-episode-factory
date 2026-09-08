"""VIDTOOLZ Resolve authority bundle v1.3 — reference canonicalization, evidence-derived eligibility,
attachment derivation, snapshot completeness, cross-artifact binding and the linked-set validator.

Reference implementation (Python, offline). Nothing here touches Resolve. Node conformance is M1 work.
Executable *contract* checks only; not runtime-qualified. Eligibility consumes validated, linked evidence
records — never caller assertions about state or qualification.
"""
import hashlib
import json
import os
import re
from fractions import Fraction

AUTHORITY_VERSION = "1.3.0"
CANONICALIZATION_VERSION = "1.3"
TRACK_TYPE_ORDER = {"video": 0, "audio": 1, "subtitle": 2}
ITEM_KIND_ORDER = {"MEDIA_BACKED": 0, "GENERATOR": 1, "TITLE": 2, "COMPOUND": 3, "ADJUSTMENT": 4, "FUSION_OR_GENERATED": 5, "OTHER_OBSERVED": 6}
HASH_DOMAINS = {
    "vidtoolz.resolveSnapshotPayload.v1.3", "vidtoolz.resolveGuard.v1", "vidtoolz.resolveMutationPlan.v1", "vidtoolz.resolveOperationSet.v1",
    "vidtoolz.resolveBindingSet.v1", "vidtoolz.resolveJournalRecord.v1", "vidtoolz.resolveEvidenceRecord.v1", "vidtoolz.resolveVerificationResult.v1", "vidtoolz.resolveGeneric.v1",
}
F64_RE = re.compile(r"[0-9a-f]{16}")
RATIONAL_RE = re.compile(r"(0|[1-9][0-9]*)/([1-9][0-9]*)")
SHA_RE = re.compile(r"[a-f0-9]{64}")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
OBS_STATUS = ("OBSERVED", "UNAVAILABLE", "UNSUPPORTED", "ERROR", "NOT_REQUESTED")
STATUS_RANK = {"OBSERVED": 0, "UNAVAILABLE": 1, "UNSUPPORTED": 2, "ERROR": 3, "NOT_REQUESTED": 4}
ITEM_STATUS_FIELDS = ("unique_id", "start", "end", "duration", "enabled", "media_pool_item_unique_id", "media_id", "source_start", "source_end")
KNOWN_DOMAINS = {"connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy", "grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "render_queue"}
COVERAGE_PROFILES = {
    "MINIMAL_M0": {"mandatory_domains": ["connection", "library", "project", "timeline"], "mandatory_item_fields": [], "identity_required": [], "track_locks_required": False, "guard_required": False},
    "FULL_TIMELINE_READ": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings"], "mandatory_item_fields": ["start", "end", "enabled"], "identity_required": ["timeline.unique_id"], "track_locks_required": False, "guard_required": False},
    "WRITE_PRECHECK": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "mandatory_item_fields": ["start", "end", "enabled", "unique_id", "media_pool_item_unique_id"], "identity_required": ["project.unique_id", "timeline.unique_id"], "track_locks_required": True, "guard_required": True},
}
ATTACHMENT_STATES = ["UNPROVISIONED", "PROVISIONED_NOT_VERIFIED", "ATTACHMENT_READY", "ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY"]
STATE_RANK = {s: i for i, s in enumerate(ATTACHMENT_STATES)}
RECORD_TYPES = {"PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION", "CONNECTION_OBSERVATION", "PROJECT_BINDING_OBSERVATION", "TIMELINE_BINDING_OBSERVATION", "OPERATOR_PROVISIONED_PROJECT", "CAPABILITY_EVIDENCE", "REFREEZE_RECORD", "MILESTONE_EXIT", "M3_AUTHORIZATION", "JOURNAL_PREPARED", "READ_ONLY_JOURNAL", "EXCLUSIVE_SESSION_ATTESTATION", "GUARD_SNAPSHOT", "PLAN_VALIDATION", "MEDIA_CLASS_ATTESTATION", "DESTINATION_TIMELINE"}
TARGET_REQUIREMENTS = ("SESSION", "PROJECT", "PROJECT_TIMELINE")
FIXTURE_LAYERS = ("none", "parse", "schema", "semantic", "eligibility", "linked-set")
WRITE_OPS = {"IMPORT_MEDIA", "APPEND", "DELETE", "DISABLE", "ENABLE", "SET_TAKE", "UPSERT_MARKER", "SET_PROPERTIES", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT", "SAVE_PROJECT"}
GUARD_REQUIRED_OPS = WRITE_OPS - {"IMPORT_MEDIA"}
PREREQ_CODES = {
    "BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHMENT_READY", "TARGET_STATE_ATTACHED_READ_ONLY", "TARGET_STATE_SCRATCH_WRITE_READY",
    "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "RESOLVE_VERSION_MATCHES", "M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE",
    "MIKKO_M3_AUTHORIZATION", "JOURNAL_PREPARED", "READ_ONLY_JOURNAL_OPEN", "GUARD_CURRENT", "EXCLUSIVE_SESSION_ATTESTED", "PROJECT_ADAPTER_PREFIXED",
    "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED", "PROBE_ALLOWED_PRIMITIVES", "PLAN_VALIDATED", "SYNTHETIC_MEDIA_ONLY", "TIMELINE_IS_DESTINATION", "TARGET_REQUIREMENT_SATISFIED",
}


class CanonError(ValueError):
    pass


class ParseError(ValueError):
    pass


# ------------------------------------------------------------------ strict parse boundary (policy A)
def _no_dup_pairs(pairs):
    seen = set()
    out = {}
    for k, v in pairs:
        if k in seen:
            raise ParseError(f"duplicate JSON key at parse boundary: {k!r}")
        seen.add(k)
        out[k] = v
    return out


def strict_loads(text):
    return json.loads(text, object_pairs_hook=_no_dup_pairs)


def strict_load(path):
    with open(path, "r", encoding="utf-8") as f:
        return strict_loads(f.read())


# ------------------------------------------------------------------ exact syntax helpers (full-string semantics)
def is_sha(s):
    return isinstance(s, str) and SHA_RE.fullmatch(s) is not None


def is_uuid(s):
    return isinstance(s, str) and UUID_RE.fullmatch(s) is not None


def validate_f64(s):
    if not isinstance(s, str) or F64_RE.fullmatch(s) is None:
        raise CanonError("$f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian)")
    bits = int(s, 16)
    if (bits >> 52) & 0x7FF == 0x7FF:
        raise CanonError("$f64 NaN/Infinity rejected")
    if bits == 0x8000000000000000:
        raise CanonError("$f64 negative zero must be normalized to 0000000000000000")
    return s


def validate_rational(s):
    if not isinstance(s, str) or RATIONAL_RE.fullmatch(s) is None:
        raise CanonError("$rational must fully match (0|[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace")
    p, q = (int(x) for x in s.split("/"))
    f = Fraction(p, q)
    if f.numerator != p or f.denominator != q:
        raise CanonError("$rational must be reduced")
    return f


def _num(v):
    if isinstance(v, bool):
        raise CanonError("boolean is not a frame quantity")
    if isinstance(v, int):
        return Fraction(v)
    if isinstance(v, dict) and set(v.keys()) == {"$rational"}:
        return validate_rational(v["$rational"])
    raise CanonError(f"not a numeric quantity: {v!r}")


def _s(v):
    return "" if v is None else str(v)


# ------------------------------------------------------------------ typed ordering (observation-status aware, option A)
def sort_tracks(tracks):
    for t in tracks:
        if t.get("type") not in TRACK_TYPE_ORDER:
            raise CanonError(f"unknown track type {t.get('type')!r}")
        if not isinstance(t.get("index"), int) or isinstance(t.get("index"), bool) or t["index"] < 1:
            raise CanonError(f"track index must be integer >= 1, got {t.get('index')!r}")
    keys = [(TRACK_TYPE_ORDER[t["type"]], t["index"]) for t in tracks]
    if len(set(keys)) != len(keys):
        raise CanonError("duplicate (type,index) track address")
    return sorted(tracks, key=lambda t: (TRACK_TYPE_ORDER[t["type"]], t["index"]))


def _frame_key(it, field):
    st = (it.get("field_status") or {}).get(field, "OBSERVED" if it.get(field) is not None else "UNAVAILABLE")
    if st == "OBSERVED":
        return (0, _num(it[field]))
    return (STATUS_RANK.get(st, 9), Fraction(0))


def item_sort_key(it):
    """Total order that never needs a frame value: unavailable frames sort by status rank, then kind, id, ordinal."""
    kind = (it.get("provenance") or {}).get("kind", "OTHER_OBSERVED")
    ordinal = it.get("observation_ordinal")
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0:
        raise CanonError("item.observation_ordinal (position in GetItemListInTrack) is required for total ordering")
    return (_frame_key(it, "start"), _frame_key(it, "end"), ITEM_KIND_ORDER.get(kind, 99), _s(it.get("unique_id")), ordinal)


def sort_items(items):
    keys = [item_sort_key(it) for it in items]
    if len(set(keys)) != len(keys):
        raise CanonError("two items share the full sort key: identity collision")
    ords = [k[4] for k in keys]
    if len(set(ords)) != len(ords):
        raise CanonError("duplicate observation_ordinal within a track")
    return sorted(items, key=item_sort_key)


def marker_sort_key(m):
    return (_s(m.get("object_address")), _num(m["frame"]), _num(m["duration"]), _s(m.get("custom_data")), _s(m.get("name")), _s(m.get("color")), _s(m.get("note")))


def sort_markers(markers):
    addr_frame = [(_s(m.get("object_address")), _num(m["frame"])) for m in markers]
    if len(set(addr_frame)) != len(addr_frame):
        raise CanonError("MARKER_COLLISION: two markers share (object_address, frame)")
    keys = [marker_sort_key(m) for m in markers]
    if len(set(keys)) != len(keys):
        raise CanonError("MARKER_COLLISION: exact duplicate marker records")
    return sorted(markers, key=marker_sort_key)


def sort_media_dependencies(deps):
    keys = [(_s(d.get("logical_locator")), _s(d.get("source_sha256"))) for d in deps]
    if len(set(keys)) != len(keys):
        raise CanonError("duplicate media dependency record")
    return sorted(deps, key=lambda d: (_s(d.get("logical_locator")), _s(d.get("source_sha256"))))


def normalize_snapshot_payload(payload):
    p = json.loads(json.dumps(payload))
    p["tracks"] = sort_tracks(p.get("tracks", []))
    for t in p["tracks"]:
        t["items"] = sort_items(t.get("items", []))
        for it in t["items"]:
            it["markers"] = sort_markers(it.get("markers", []))
    p["markers"] = sort_markers(p.get("markers", []))
    p["media_dependencies"] = sort_media_dependencies(p.get("media_dependencies", []))
    p["observation_failures"] = sorted(p.get("observation_failures", []), key=lambda f: (_s(f.get("track_address")), f.get("observation_ordinal", -1), _s(f.get("reason"))))
    return p


# ------------------------------------------------------------------ canonical text + digests
def canon(v):
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, int):
        if not (-(2 ** 53 - 1) <= v <= 2 ** 53 - 1):
            raise CanonError("integer outside safe range")
        return str(v)
    if isinstance(v, float):
        raise CanonError("bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'}")
    if isinstance(v, str):
        out = ['"']
        for ch in v:
            o = ord(ch)
            if 0xD800 <= o <= 0xDFFF:
                raise CanonError("lone surrogate")
            if ch == '"':
                out.append('\\"')
            elif ch == "\\":
                out.append("\\\\")
            elif o == 8:
                out.append("\\b")
            elif o == 9:
                out.append("\\t")
            elif o == 10:
                out.append("\\n")
            elif o == 12:
                out.append("\\f")
            elif o == 13:
                out.append("\\r")
            elif o < 0x20:
                out.append("\\u%04x" % o)
            else:
                out.append(ch)
        out.append('"')
        return "".join(out)
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = list(v.keys())
        if len(set(keys)) != len(keys):
            raise CanonError("duplicate keys (dictionary level; source duplicates are a parse-boundary concern)")
        if set(keys) == {"$rational"}:
            validate_rational(v["$rational"])
        if set(keys) == {"$f64"}:
            validate_f64(v["$f64"])
        return "{" + ",".join(canon(k) + ":" + canon(v[k]) for k in sorted(keys)) + "}"
    raise CanonError(f"unsupported type {type(v)}")


def digest(obj, domain):
    if domain not in HASH_DOMAINS:
        raise CanonError(f"unregistered hash domain {domain!r}")
    return hashlib.sha256(domain.encode("utf-8") + b"\n" + canon(obj).encode("utf-8")).hexdigest()


def snapshot_payload_digest(payload):
    return digest(normalize_snapshot_payload(payload), "vidtoolz.resolveSnapshotPayload.v1.3")


def guard_object(snapshot):
    return {"hash_domain": "vidtoolz.resolveGuard.v1", "guard_version": 1, "library": snapshot["library"], "project": {"unique_id": snapshot["project"]["unique_id"], "name": snapshot["project"]["name"]}, "timeline": {"unique_id": snapshot["payload"]["timeline"]["unique_id"], "name": snapshot["payload"]["timeline"]["name"]}, "target_epoch": snapshot["target_epoch"], "coverage": snapshot["coverage"], "policy": snapshot["policy"], "payload_sha256": snapshot["payload_sha256"]}


def guard_digest(snapshot):
    return digest(guard_object(snapshot), "vidtoolz.resolveGuard.v1")


def operation_set_digest(operations):
    return digest(operations, "vidtoolz.resolveOperationSet.v1")


# ------------------------------------------------------------------ evidence records (linked, validated)
def record_id(rec):
    body = {k: v for k, v in rec.items() if k != "record_id"}
    return digest(body, "vidtoolz.resolveEvidenceRecord.v1")


def make_record(rec):
    r = dict(rec)
    r["record_id"] = record_id(r)
    return r


def validate_evidence_set(es):
    """Structural validity of an evidence set: every record typed, content-addressed and target-tagged."""
    errs = []
    if not isinstance(es, dict) or not isinstance(es.get("records"), dict):
        return ["evidence set must be {records: {record_id: record}}"]
    for rid, rec in es["records"].items():
        if not is_sha(rid):
            errs.append(f"record id {rid!r} is not a sha256")
            continue
        if not isinstance(rec, dict) or rec.get("record_type") not in RECORD_TYPES:
            errs.append(f"{rid[:12]}: unknown record_type {rec.get('record_type') if isinstance(rec, dict) else rec!r}")
            continue
        if rec.get("record_id") != rid or record_id(rec) != rid:
            errs.append(f"{rid[:12]}: record_id does not match content digest")
        if not isinstance(rec.get("target"), dict) or not rec["target"].get("host_name"):
            errs.append(f"{rid[:12]}: record lacks target.host_name")
    return errs


def resolve_ref(es, ref, expected_type, target=None, extra=None):
    """Returns (record, errors). A ref is evidence only if it is a sha256, exists, has the expected type,
    is content-addressed correctly, and (if target given) belongs to the same target."""
    errs = []
    if not is_sha(ref):
        return None, [f"{expected_type}: reference is not a sha256 ({ref!r})"]
    rec = (es or {}).get("records", {}).get(ref)
    if rec is None:
        return None, [f"{expected_type}: referenced record {ref[:12]} not in evidence set"]
    if rec.get("record_type") != expected_type:
        return None, [f"{expected_type}: record {ref[:12]} has type {rec.get('record_type')}"]
    if record_id(rec) != ref:
        return None, [f"{expected_type}: record {ref[:12]} content does not match its id"]
    if target:
        for k, v in target.items():
            if rec.get("target", {}).get(k) != v:
                errs.append(f"{expected_type}: record {ref[:12]} target.{k}={rec.get('target', {}).get(k)!r} != {v!r}")
    for k, v in (extra or {}).items():
        if rec.get(k) != v:
            errs.append(f"{expected_type}: record {ref[:12]} {k}={rec.get(k)!r} != {v!r}")
    return (rec if not errs else None), errs


def find_records(es, rtype, **match):
    out = []
    for rid, rec in (es or {}).get("records", {}).items():
        if rec.get("record_type") != rtype or record_id(rec) != rid:
            continue
        if all(rec.get(k) == v if not k.startswith("target.") else rec.get("target", {}).get(k[7:]) == v for k, v in match.items()):
            out.append(rec)
    return out


# ------------------------------------------------------------------ attachment state DERIVED from evidence
def derive_attachment_state(tc, es):
    """Never trusts a declared state. Returns {state, proofs, failures}."""
    host = tc["host"]["name"]
    lib = tc["library"]
    ver = f"{tc['resolve']['version']}.{tc['resolve']['build']:04d}"
    proofs, fails = {}, []
    if lib["name"] in lib.get("prohibited_library_names", []):
        return {"state": "UNPROVISIONED", "proofs": {}, "failures": ["contract library is a prohibited library"]}
    prov = [r for r in find_records(es, "PROVISIONING_RECORD", **{"target.host_name": host, "target.library_name": lib["name"]}) if r.get("library_kind") == "Disk" and isinstance(r.get("root_path"), str) and r["root_path"].startswith("/") and "/../" not in r["root_path"] and is_uuid(r.get("instance_uuid")) and r.get("provisioned_by")]
    if not prov:
        return {"state": "UNPROVISIONED", "proofs": {}, "failures": ["no valid PROVISIONING_RECORD for contract host/library"]}
    proofs["provisioning"] = prov[0]["record_id"]
    launch = find_records(es, "LAUNCH_RECIPE", **{"target.host_name": host})
    launch = [r for r in launch if is_sha(r.get("recipe_sha256")) and r.get("resolve_version") == ver and r.get("resolve_binary_sha256") == tc["resolve"]["pins"].get("/opt/resolve/bin/resolve") and r.get("external_scripting_preference") == "Local"]
    bundle = [r for r in find_records(es, "BUNDLE_VERIFICATION", authority_version=AUTHORITY_VERSION) if is_sha(r.get("manifest_sha256")) and r.get("verifier") and r.get("verifier") != r.get("prepared_by")]
    if not launch:
        fails.append("no LAUNCH_RECIPE record for host matching contract version/binary pin/Local scripting preference")
    if not bundle:
        fails.append("no independent BUNDLE_VERIFICATION record for authority version")
    if fails:
        return {"state": "PROVISIONED_NOT_VERIFIED", "proofs": proofs, "failures": fails}
    proofs["launch_recipe"] = launch[0]["record_id"]
    proofs["bundle_verification"] = bundle[0]["record_id"]
    conns = find_records(es, "CONNECTION_OBSERVATION", **{"target.host_name": host})
    if not conns:
        return {"state": "ATTACHMENT_READY", "proofs": proofs, "failures": []}
    c = conns[-1]
    cf = []
    if c.get("db_type") != "Disk":
        cf.append(f"observed db_type {c.get('db_type')} is not Disk")
    if c.get("db_name") != lib["name"]:
        cf.append(f"observed database {c.get('db_name')!r} != contract library")
    if c.get("db_name") in lib.get("prohibited_library_names", []):
        cf.append("observed database is a prohibited (shared/user) library")
    if c.get("product") != tc["resolve"]["product"] or c.get("resolve_version") != ver:
        cf.append(f"observed product/version {c.get('product')} {c.get('resolve_version')} != contract {tc['resolve']['product']} {ver}")
    if c.get("root_path") and c["root_path"] != prov[0]["root_path"]:
        cf.append("observed library root differs from provisioning record")
    if cf:
        return {"state": "ATTACHMENT_READY", "proofs": proofs, "failures": ["OBSERVED_TARGET_MISMATCH: " + "; ".join(cf)]}
    proofs["connection"] = c["record_id"]
    auth = [r for r in find_records(es, "M3_AUTHORIZATION", **{"target.host_name": host}) if r.get("scope") == "SCRATCH_QUALIFICATION_LIBRARY" and r.get("approver") and r.get("authority_version") == AUTHORITY_VERSION]
    excl = [r for r in find_records(es, "EXCLUSIVE_SESSION_ATTESTATION", **{"target.host_name": host}) if r.get("attested_by")]
    refz = [r for r in find_records(es, "REFREEZE_RECORD") if r.get("reviewed") is True and r.get("kind") == "M0_READ_REQUALIFICATION" and is_sha(r.get("manifest_sha256"))]
    wf = []
    if not auth:
        wf.append("no M3_AUTHORIZATION for scratch scope")
    if not excl:
        wf.append("no EXCLUSIVE_SESSION_ATTESTATION")
    if not refz:
        wf.append("no reviewed M0 requalification REFREEZE_RECORD")
    if wf:
        return {"state": "ATTACHED_READ_ONLY", "proofs": proofs, "failures": wf}
    proofs.update({"m3_authorization": auth[0]["record_id"], "exclusive_session": excl[0]["record_id"], "m0_requalification": refz[0]["record_id"]})
    return {"state": "SCRATCH_WRITE_READY", "proofs": proofs, "failures": []}


def semantic_target_contract(tc):
    errs = []
    lib = tc["library"]
    if lib["name"] in lib.get("prohibited_library_names", []):
        errs.append("qualification library name is a prohibited library")
    if tc.get("accepts_current_open_session_as_target") is not False:
        errs.append("target must never accept whatever session is open")
    if tc.get("attachment_state_is_declared") is not False:
        errs.append("attachment state MUST be derived from evidence (attachment_state_is_declared must be false)")
    required_denied = {"SetCurrentDatabase", "CloseProject", "ImportProject", "ReplaceClip", "run_script", "run_script_unsafe", "execute_python", "execute_lua"}
    missing = required_denied - set(tc["denied_calls_all_scopes"])
    if missing:
        errs.append(f"denied_calls_all_scopes missing {sorted(missing)}")
    if lib["provisioning_status"] == "UNPROVISIONED" and (lib["root_path"] is not None or lib["instance_uuid"] is not None):
        errs.append("UNPROVISIONED library must have null root_path/instance_uuid")
    return errs


# ------------------------------------------------------------------ capability authority: qualified vs probe-allowed
def primitive_status(caps, rp_entry, method, es, env):
    """QUALIFIED_CALLABLE only when the frozen matrix says QUALIFIED_READ AND an exact reviewed evidence record for the
    same method on the same host/version/build is linked. PROBE_ALLOWED when the read-primitive entry flags it.
    Otherwise UNQUALIFIED."""
    row = next((r for r in caps["rows"] if method in r["primitives"]), None)
    if row is None:
        return "UNKNOWN_METHOD"
    if row["evidence_class"] == "QUALIFIED_READ":
        recs = [r for r in find_records(es, "CAPABILITY_EVIDENCE", method=method) if r.get("host") == env["host_name"] and r.get("resolve_version") == env["resolve_version"] and r.get("build") == env["build"] and r.get("reviewed_refreeze_version")]
        if recs:
            return "QUALIFIED_CALLABLE"
        return "UNQUALIFIED"
    if rp_entry is not None and rp_entry.get("probe_allowed") is True and row.get("probe_candidate") is True:
        return "PROBE_ALLOWED"
    return "UNQUALIFIED"


# ------------------------------------------------------------------ eligibility (consumes validated authority only)
def permission_lookup(perms, milestone, operation, scope):
    if perms.get("default") != "DENY":
        return {"allowed": False, "reason": "permission authority default is not DENY"}
    if milestone not in perms["milestones"] or scope not in perms["scopes"]:
        return {"allowed": False, "reason": "unknown milestone or scope"}
    if operation in perms["denied_all_scopes"]:
        return {"allowed": False, "reason": "denied in all scopes"}
    for e in perms["entries"]:
        if e["milestone"] == milestone and e["operation"] == operation and e["scope"] == scope:
            return {"allowed": bool(e["allowed"]), "reason": "explicit entry", "entry": e}
    return {"allowed": False, "reason": "no explicit entry (default DENY)"}


def _target_binding(request, tc, es, requirement, need_ids):
    """PROJECT/PROJECT_TIMELINE requirements are proven by binding observation records, never by the current project."""
    errs = []
    host = tc["host"]["name"]
    if requirement == "SESSION":
        return errs
    pname = request.get("expected_project_name")
    if not pname:
        return ["target requirement PROJECT: expected_project_name missing"]
    pb = find_records(es, "PROJECT_BINDING_OBSERVATION", **{"target.host_name": host, "target.library_name": tc["library"]["name"]}, project_name=pname)
    if not pb:
        errs.append(f"no PROJECT_BINDING_OBSERVATION for expected project {pname!r}")
    prefixed = pname.startswith(tc["naming"]["project_prefix"])
    if not prefixed and not find_records(es, "OPERATOR_PROVISIONED_PROJECT", project_name=pname):
        errs.append(f"project {pname!r} is neither adapter-prefixed nor operator-provisioned")
    if need_ids and pb and (pb[-1].get("project_unique_id_status") != "OBSERVED" or not pb[-1].get("project_unique_id")):
        errs.append("write-capable target requires OBSERVED project_unique_id")
    if requirement == "PROJECT_TIMELINE":
        tname = request.get("expected_timeline_name")
        if not tname:
            return errs + ["target requirement PROJECT_TIMELINE: expected_timeline_name missing"]
        tb = find_records(es, "TIMELINE_BINDING_OBSERVATION", **{"target.host_name": host}, project_name=pname, timeline_name=tname)
        if not tb:
            errs.append(f"no TIMELINE_BINDING_OBSERVATION for {pname!r}/{tname!r}")
        elif need_ids and (tb[-1].get("timeline_unique_id_status") != "OBSERVED" or not tb[-1].get("timeline_unique_id")):
            errs.append("write-capable target requires OBSERVED timeline_unique_id")
    return errs


def evaluate_eligibility(perms, request, rp, caps, tc, es):
    """Deterministic, fail-closed. request = {milestone, operation, scope, expected_project_name?, expected_timeline_name?,
    refs: {authorization, journal_prepared, read_only_journal, guard, plan_validation, m0_exit, m1_exit, m2_exit, exclusive_session,
    media_class, destination_timeline}, transaction_id?, plan_digest?, plan_h0_guard_digest?}.
    Attachment state and primitive qualification are DERIVED from tc + evidence set, never read from the request."""
    out = {"permitted_by_policy": False, "prerequisites_satisfied": False, "eligible": False, "failed_prerequisites": [], "reason_codes": [], "derived_attachment_state": None, "target_requirement": None, "expanded_primitives": []}
    ev_errs = validate_evidence_set(es)
    if ev_errs:
        out["reason_codes"] += ["EVIDENCE_SET_INVALID"] + ev_errs[:3]
        return out
    m, op, sc = request.get("milestone"), request.get("operation"), request.get("scope")
    look = permission_lookup(perms, m, op, sc)
    if not look["allowed"]:
        out["reason_codes"].append("NOT_PERMITTED_BY_POLICY:" + look["reason"])
        return out
    entry = look["entry"]
    out["permitted_by_policy"] = True
    derived = derive_attachment_state(tc, es)
    out["derived_attachment_state"] = derived["state"]
    rp_op = (rp or {}).get("logical_operations", {}).get(op)
    requirement = entry.get("target_requirement") or (rp_op or {}).get("target_requirement")
    out["target_requirement"] = requirement
    if requirement not in TARGET_REQUIREMENTS:
        out["reason_codes"].append("OPERATION_WITHOUT_TARGET_REQUIREMENT")
        return out
    host = tc["host"]["name"]
    env = {"host_name": host, "resolve_version": f"{tc['resolve']['version']}.{tc['resolve']['build']:04d}", "build": tc["resolve"]["build"]}
    refs = request.get("refs") or {}
    failed = []
    rank = STATE_RANK[derived["state"]]
    for code in entry.get("prerequisites", []):
        if code not in PREREQ_CODES:
            failed.append(f"UNKNOWN_PREREQUISITE_CODE:{code}")
            continue
        ok, why = False, ""
        if code == "BUNDLE_INDEPENDENTLY_VERIFIED":
            ok = "bundle_verification" in derived["proofs"]
        elif code == "TARGET_STATE_ATTACHMENT_READY":
            ok = rank >= STATE_RANK["ATTACHMENT_READY"]; why = "; ".join(derived["failures"])
        elif code == "TARGET_STATE_ATTACHED_READ_ONLY":
            ok = rank >= STATE_RANK["ATTACHED_READ_ONLY"]; why = "; ".join(derived["failures"])
        elif code == "TARGET_STATE_SCRATCH_WRITE_READY":
            ok = rank >= STATE_RANK["SCRATCH_WRITE_READY"]; why = "; ".join(derived["failures"])
        elif code == "HOST_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"]
        elif code == "LIBRARY_NOT_SHARED":
            ok = tc["library"]["name"] not in tc["library"]["prohibited_library_names"] and not any("prohibited" in f for f in derived["failures"])
        elif code == "LIBRARY_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"] and not any("OBSERVED_TARGET_MISMATCH" in f for f in derived["failures"])
        elif code == "RESOLVE_VERSION_MATCHES":
            ok = "connection" in derived["proofs"]
        elif code in ("M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE"):
            rec, e = resolve_ref(es, refs.get(code[:2].lower() + "_exit"), "MILESTONE_EXIT", {"host_name": host}, {"milestone": code[:2], "authority_version": AUTHORITY_VERSION}); ok = rec is not None; why = "; ".join(e)
        elif code == "MIKKO_M3_AUTHORIZATION":
            rec, e = resolve_ref(es, refs.get("authorization"), "M3_AUTHORIZATION", {"host_name": host}, {"scope": "SCRATCH_QUALIFICATION_LIBRARY", "authority_version": AUTHORITY_VERSION}); ok = rec is not None and bool(rec.get("approver")); why = "; ".join(e)
        elif code == "JOURNAL_PREPARED":
            rec, e = resolve_ref(es, refs.get("journal_prepared"), "JOURNAL_PREPARED", {"host_name": host}, {"transaction_id": request.get("transaction_id"), "plan_digest": request.get("plan_digest")}); ok = rec is not None; why = "; ".join(e)
        elif code == "READ_ONLY_JOURNAL_OPEN":
            rec, e = resolve_ref(es, refs.get("read_only_journal"), "READ_ONLY_JOURNAL", {"host_name": host}); ok = rec is not None; why = "; ".join(e)
        elif code == "GUARD_CURRENT":
            rec, e = resolve_ref(es, refs.get("guard"), "GUARD_SNAPSHOT", {"host_name": host}); ok = rec is not None and is_sha(request.get("plan_h0_guard_digest")) and rec.get("guard_digest") == request.get("plan_h0_guard_digest") and rec.get("project_name") == request.get("expected_project_name") and rec.get("timeline_name") == request.get("expected_timeline_name"); why = "; ".join(e) or "guard digest/target mismatch"
        elif code == "EXCLUSIVE_SESSION_ATTESTED":
            rec, e = resolve_ref(es, refs.get("exclusive_session"), "EXCLUSIVE_SESSION_ATTESTATION", {"host_name": host}); ok = rec is not None and bool(rec.get("attested_by")); why = "; ".join(e)
        elif code == "PROJECT_ADAPTER_PREFIXED":
            ok = str(request.get("expected_project_name", "")).startswith(tc["naming"]["project_prefix"])
        elif code == "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED":
            prims = (rp_op or {}).get("primitives", [])
            exp = []
            for p in prims:
                st = primitive_status(caps, p, p["method"], es, env)
                exp.append({"method": p["method"], "status": st, "callable": st == "QUALIFIED_CALLABLE", "fallback": p.get("fallback_if_unqualified")})
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] or x["fallback"] in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE") for x in exp)
            why = "REFUSE fallback on unqualified primitive(s): " + ",".join(x["method"] for x in exp if not x["callable"] and x["fallback"] == "REFUSE")
        elif code == "PROBE_ALLOWED_PRIMITIVES":
            prims = (rp_op or {}).get("primitives", [])
            exp = [{"method": p["method"], "status": primitive_status(caps, p, p["method"], es, env), "callable": False, "fallback": "PROBE_ONLY"} for p in prims]
            for x in exp:
                x["callable"] = x["status"] in ("PROBE_ALLOWED", "QUALIFIED_CALLABLE")
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] for x in exp) and rp_op.get("purpose_is_qualification") is True and rp_op.get("read_only") is True
        elif code == "PLAN_VALIDATED":
            rec, e = resolve_ref(es, refs.get("plan_validation"), "PLAN_VALIDATION", {"host_name": host}, {"plan_digest": request.get("plan_digest"), "result": "PASS", "authority_version": AUTHORITY_VERSION}); ok = rec is not None; why = "; ".join(e)
        elif code == "SYNTHETIC_MEDIA_ONLY":
            rec, e = resolve_ref(es, refs.get("media_class"), "MEDIA_CLASS_ATTESTATION", {"host_name": host}, {"media_class": "SYNTHETIC"}); ok = rec is not None; why = "; ".join(e)
        elif code == "TIMELINE_IS_DESTINATION":
            rec, e = resolve_ref(es, refs.get("destination_timeline"), "DESTINATION_TIMELINE", {"host_name": host}, {"project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}); ok = rec is not None; why = "; ".join(e)
        elif code == "TARGET_REQUIREMENT_SATISFIED":
            e = _target_binding(request, tc, es, requirement, need_ids=bool(entry.get("mutation_allowed"))); ok = not e; why = "; ".join(e)
        if not ok:
            failed.append(code + (f" ({why})" if why else ""))
    if "TARGET_REQUIREMENT_SATISFIED" not in entry.get("prerequisites", []):
        e = _target_binding(request, tc, es, requirement, need_ids=bool(entry.get("mutation_allowed")))
        if e:
            failed.append("TARGET_REQUIREMENT_SATISFIED (" + "; ".join(e) + ")")
    out["failed_prerequisites"] = failed
    out["prerequisites_satisfied"] = not failed
    out["eligible"] = out["permitted_by_policy"] and not failed
    out["reason_codes"].append("ELIGIBLE" if out["eligible"] else "PREREQUISITES_FAILED")
    return out


# ------------------------------------------------------------------ snapshot completeness, status consistency, ranges
def _status_value_errors(prefix, status, value, reason, mandatory_reason=True):
    errs = []
    if status not in OBS_STATUS:
        return [f"{prefix}: unknown status {status!r}"]
    if status == "OBSERVED" and value is None:
        errs.append(f"{prefix}: status OBSERVED but value null")
    if status != "OBSERVED" and value is not None:
        errs.append(f"{prefix}: status {status} but value present (fabrication)")
    if status in ("UNAVAILABLE", "ERROR") and mandatory_reason and not reason:
        errs.append(f"{prefix}: status {status} requires a reason")
    return errs


def semantic_snapshot(snap):
    errs = []
    cov = snap["coverage"]
    prof = COVERAGE_PROFILES.get(cov.get("profile"))
    if prof is None:
        return [f"unknown coverage profile {cov.get('profile')!r}"]
    obs, unob, deff = set(cov["observed_domains"]), set(cov["unobservable_domains"]), set(cov["deferred_domains"])
    for d in obs | unob | deff:
        if d not in KNOWN_DOMAINS:
            errs.append(f"invented domain name {d!r}")
    if obs & unob or obs & deff:
        errs.append("a domain cannot be both observed and unobservable/deferred")
    mandatory = set(prof["mandatory_domains"])
    ident = {"project.unique_id": (snap["project"]["unique_id_status"], snap["project"]["unique_id"]), "timeline.unique_id": (snap["payload"]["timeline"]["unique_id_status"], snap["payload"]["timeline"]["unique_id"])}
    for k, (st, val) in ident.items():
        errs += _status_value_errors(k, st, val, snap["project"].get("unique_id_reason") if k.startswith("project") else snap["payload"]["timeline"].get("unique_id_reason"))
    tl = snap["payload"]["timeline"]
    if tl["end_frame"] < tl["start_frame"]:
        errs.append("timeline end_frame < start_frame")
    conv = tl.get("duration_convention")
    if conv not in ("UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"):
        errs.append("timeline.duration_convention missing")
    unresolved_mandatory_item_fields = set()
    unresolved_locks = False
    for t in snap["payload"]["tracks"]:
        if t.get("locked") is None and prof["track_locks_required"]:
            unresolved_locks = True
        for it in t["items"]:
            fs = it["field_status"]
            for fld in ITEM_STATUS_FIELDS:
                errs += _status_value_errors(f"item[{it.get('observation_ordinal')}].{fld}", fs.get(fld), it.get(fld), fs.get(fld + "_reason"))
                if fld in prof["mandatory_item_fields"] and fs.get(fld) != "OBSERVED":
                    unresolved_mandatory_item_fields.add(fld)
            if fs.get("start") == "OBSERVED" and fs.get("end") == "OBSERVED" and it.get("start") is not None and it.get("end") is not None:
                s, e = _num(it["start"]), _num(it["end"])
                if e < s:
                    errs.append(f"item {it.get('unique_id') or it['observation_ordinal']}: end < start")
                if fs.get("duration") == "OBSERVED":
                    d = _num(it["duration"])
                    if conv == "END_EXCLUSIVE" and d != e - s:
                        errs.append("duration inconsistent with END_EXCLUSIVE convention")
                    elif conv == "END_INCLUSIVE" and d != e - s + 1:
                        errs.append("duration inconsistent with END_INCLUSIVE convention")
                    elif conv == "UNQUALIFIED" and d not in (e - s, e - s + 1):
                        errs.append("duration inconsistent with both candidate conventions")
            if fs.get("source_start") == "OBSERVED" and fs.get("source_end") == "OBSERVED" and it.get("source_start") is not None and it.get("source_end") is not None and _num(it["source_end"]) < _num(it["source_start"]):
                errs.append("source_end < source_start")
            kind = it["provenance"]["kind"]
            if kind == "MEDIA_BACKED":
                if it["source_status"] == "HASHED" and not it.get("source_sha256"):
                    errs.append("HASHED item without sha")
                if it["source_status"] != "HASHED" and it.get("source_sha256"):
                    errs.append("sha present but status not HASHED")
            elif it["source_status"] != "NOT_APPLICABLE" or it.get("source_sha256") is not None:
                errs.append(f"{kind} item must have NOT_APPLICABLE source and null sha")
    for f in snap["payload"].get("observation_failures", []):
        if not f.get("reason") or f.get("track_address") is None:
            errs.append("observation_failures entries require track_address and reason")
    if cov["complete"]:
        if not obs:
            errs.append("complete:true with empty observed_domains")
        if not mandatory <= obs:
            errs.append(f"complete:true but mandatory domains not observed: {sorted(mandatory - obs)}")
        if unresolved_mandatory_item_fields:
            errs.append(f"complete:true under {cov['profile']} with unresolved item fields {sorted(unresolved_mandatory_item_fields)}")
        for k in prof["identity_required"]:
            if ident[k][0] != "OBSERVED":
                errs.append(f"complete:true under {cov['profile']} but {k} not OBSERVED")
        if prof["track_locks_required"] and unresolved_locks:
            errs.append("complete:true under WRITE_PRECHECK with unresolved track locks")
        if prof["guard_required"] and not is_sha(snap.get("guard_digest")):
            errs.append("complete:true under WRITE_PRECHECK without guard")
        if snap["payload"].get("observation_failures"):
            errs.append("complete:true with observation_failures present")
    else:
        if not cov.get("incomplete_reasons"):
            errs.append("complete:false must list incomplete_reasons")
        if not (unob or deff or (mandatory - obs) or unresolved_mandatory_item_fields or snap["payload"].get("observation_failures")):
            errs.append("complete:false must name missing domains/fields")
    try:
        if snapshot_payload_digest(snap["payload"]) != snap["payload_sha256"]:
            errs.append("payload_sha256 does not match canonical payload")
        if guard_digest(snap) != snap["guard_digest"]:
            errs.append("guard_digest does not match guard object")
    except CanonError as e:
        errs.append(f"canonicalization error: {e}")
    return errs


# ------------------------------------------------------------------ other frozen-authority semantics (unchanged laws)
def semantic_timebase(tb):
    errs = []
    p = tb["profile_v1"]
    if p["fps"] != {"numerator": 30, "denominator": 1} or p["output_fps"] != 30:
        errs.append("profile_v1 must be exactly 30/1")
    if tb["law"]["name"] != "CEIL_BOUNDARY_V1" or tb["law"]["rounding"] != "CEIL":
        errs.append("rounding law substitution")
    if tb["tolerance"]["planned_vs_observed_frames"] != 0:
        errs.append("exactness redefined")
    for m, expect in ((0, 0), (16, 1), (34, 2), (225183, 6756)):
        if (m * 30 + 999) // 1000 != expect:
            errs.append(f"law arithmetic broken at {m}")
    return errs


def semantic_track_policy(tp):
    errs = []
    for kind in ("video", "audio"):
        idx = [t["index"] for t in tp[kind]]
        if idx != sorted(idx) or len(set(idx)) != len(idx):
            errs.append(f"{kind} indexes must be unique and ascending")
    rv = {t["index"]: t["role"] for t in tp["video"]}
    ra = {t["index"]: t["role"] for t in tp["audio"]}
    if rv.get(1) != "FULL_CANVAS_VISUAL":
        errs.append("video 1 must be FULL_CANVAS_VISUAL")
    if ra.get(1) != "NARRATION" or ra.get(2) != "MUSIC":
        errs.append("audio 1/2 must be NARRATION/MUSIC")
    return errs


def semantic_canary_manifest(cm):
    errs = []
    media = cm["media"]
    roles = [m["role"] for m in media]
    if roles.count("DRAFT_BESPOKE_STILL") != 20 or roles.count("NARRATION") != 1 or roles.count("MUSIC") != 1:
        errs.append("media cardinality must be 20 stills + 1 narration + 1 music")
    ids = [m.get("asset_id") for m in media if m["role"] == "DRAFT_BESPOKE_STILL"]
    if len(set(ids)) != len(ids):
        errs.append("duplicate asset_id")
    for m in media:
        if m["declared_sha256"] != m["preserved_sha256"]:
            errs.append(f"hash mismatch {m.get('asset_id', m['role'])}")
        for k in ("declared_path", "preserved_path"):
            if "/../" in m[k] or m[k].endswith("/..") or not m[k].startswith("/"):
                errs.append(f"bad path {k}")
    shas = [m["declared_sha256"] for m in media]
    if len(set(shas)) != len(shas):
        errs.append("duplicate media record (same sha)")
    return errs


def semantic_capabilities(caps, contract_version="21.1.0", contract_build=14):
    errs = []
    for r in caps["rows"]:
        if r["evidence_class"] == "QUALIFIED_READ":
            recs = [x for x in r.get("evidence_records", []) if x.get("version_match") is True and x.get("resolve_version") == contract_version and x.get("build") == contract_build and x.get("method") in r["primitives"] and is_sha(x.get("evidence_sha256")) and x.get("reviewed_refreeze_version")]
            if not recs:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ without exact reviewed version-matched evidence record")
        for x in r.get("evidence_records", []):
            for k in ("host", "resolve_version", "run_ref", "method", "observed_result", "evidence_path"):
                if not x.get(k):
                    errs.append(f"row '{r['operation']}': evidence record missing {k}")
            if x.get("version_match") is True and (x.get("resolve_version") != contract_version or x.get("build") != contract_build):
                errs.append(f"row '{r['operation']}': version_match true but version differs from contract")
        if r.get("probe_candidate") is True and r["evidence_class"] not in ("DOCUMENTED_NOT_QUALIFIED",):
            errs.append(f"row '{r['operation']}': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows")
    return errs


def semantic_read_primitives(rp, caps, perms=None):
    errs = []
    method_class = {}
    probe_rows = {}
    for r in caps["rows"]:
        for p in r["primitives"]:
            method_class.setdefault(p, r["evidence_class"])
            probe_rows.setdefault(p, r.get("probe_candidate") is True)
    for op, spec in rp["logical_operations"].items():
        if spec.get("target_requirement") not in TARGET_REQUIREMENTS:
            errs.append(f"{op}: missing/invalid target_requirement")
        for p in spec["primitives"]:
            cls = method_class.get(p["method"])
            if cls is None:
                errs.append(f"{op}: primitive {p['method']} has no capability row")
            elif cls != p["evidence_class"]:
                errs.append(f"{op}: primitive {p['method']} evidence_class {p['evidence_class']} != matrix {cls}")
            if p["evidence_class"] != "QUALIFIED_READ" and p.get("fallback_if_unqualified") not in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE", "REFUSE", "PROBE_ONLY"):
                errs.append(f"{op}: unqualified primitive {p['method']} without declared fallback")
            if p.get("probe_allowed") and not probe_rows.get(p["method"]):
                errs.append(f"{op}: primitive {p['method']} probe_allowed but matrix row is not probe_candidate")
            if p.get("probe_allowed") and op != "READ_PRIMITIVE_QUALIFICATION_PROBE":
                errs.append(f"{op}: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE")
        if op == "READ_PRIMITIVE_QUALIFICATION_PROBE" and not (spec.get("purpose_is_qualification") is True and spec.get("read_only") is True and spec.get("promotes_capability") is False):
            errs.append("probe operation must declare purpose_is_qualification, read_only and promotes_capability:false")
    if perms is not None:
        for e in perms["entries"]:
            spec = rp["logical_operations"].get(e["operation"])
            if spec and e.get("target_requirement") != spec.get("target_requirement"):
                errs.append(f"PERMISSIONS/{e['milestone']}/{e['operation']}: target_requirement differs from READ-PRIMITIVES")
    return errs


# ------------------------------------------------------------------ cross-artifact binding: plan / journal / verification / conflict / commit
def plan_digest_of(plan):
    """plan_digest covers the plan body; refs (evidence attachments) and the digest field itself are excluded so records may cite it."""
    return digest({k: v for k, v in plan.items() if k not in ("plan_digest", "refs")}, "vidtoolz.resolveMutationPlan.v1")


def plan_binding(plan):
    return {"plan_digest": plan.get("plan_digest"), "transaction_id": plan.get("transaction_id"), "target": plan.get("target"), "h0_guard_digest": plan.get("h0_guard_digest"), "operation_set_digest": plan.get("operation_set_digest"), "authority_version": plan.get("authority_version")}


def semantic_mutation_plan(plan, perms, rp, caps, tc, es, current_guard_digest=None):
    errs = []
    if plan.get("authority_version") != AUTHORITY_VERSION:
        errs.append("plan authority_version != current authority")
    if not is_sha(plan.get("plan_digest")) or not plan.get("transaction_id"):
        errs.append("plan lacks plan_digest/transaction_id")
    elif plan.get("plan_digest") != plan_digest_of(plan):
        errs.append("plan_digest does not match plan body digest")
    if plan.get("operation_set_digest") != operation_set_digest(plan.get("operations", [])):
        errs.append("operation_set_digest does not match operations")
    if plan.get("permission_class") == "RESOLVE_READ" and any(o["op"] in WRITE_OPS for o in plan["operations"]):
        errs.append("RESOLVE_READ permission class cannot carry write operations")
    tgt = plan.get("target") or {}
    for o in plan["operations"]:
        req = {"milestone": plan["milestone"], "operation": o["op"], "scope": plan["scope"], "expected_project_name": tgt.get("project_name"), "expected_timeline_name": tgt.get("timeline_name"), "refs": plan.get("refs") or {}, "transaction_id": plan.get("transaction_id"), "plan_digest": plan.get("plan_digest"), "plan_h0_guard_digest": plan.get("h0_guard_digest")}
        el = evaluate_eligibility(perms, req, rp, caps, tc, es)
        if not el["permitted_by_policy"]:
            errs.append(f"operation {o['op']} not permitted at {plan['milestone']}/{plan['scope']}: {el['reason_codes']}")
        elif not plan.get("dry_run") and not el["eligible"]:
            errs.append(f"operation {o['op']} not eligible: {el['failed_prerequisites']}")
        sel = o.get("selector") or {}
        if o["op"] in WRITE_OPS:
            need = {"library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "track_type", "track_index"}
            if o["op"] not in ("APPEND", "IMPORT_MEDIA", "SAVE_PROJECT", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT"):
                need |= {"item_unique_id", "expected_start", "expected_end"}
            missing = need - set(sel.keys())
            if missing:
                errs.append(f"selector incomplete for {o['op']}: missing {sorted(missing)}")
            for k in ("library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch"):
                if k in sel and tgt.get(k) is not None and sel[k] != tgt[k]:
                    errs.append(f"selector {k} does not match plan target")
        if o["op"] in GUARD_REQUIRED_OPS and not is_sha(plan.get("h0_guard_digest")):
            errs.append(f"operation {o['op']} requires h0_guard_digest")
    if current_guard_digest is not None and plan.get("h0_guard_digest") != current_guard_digest:
        errs.append("plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)")
    if plan.get("dry_run") is not True and plan["milestone"] in ("M0", "M1", "M2"):
        errs.append("non-dry-run plan before M3")
    if plan.get("h0_guard_digest") and plan.get("h0_payload_sha256") and plan["h0_guard_digest"] == plan["h0_payload_sha256"]:
        errs.append("payload digest used as guard digest")
    return errs


TERMINAL_STATES = {"COMMITTED", "COMMITTED_RECOVERED", "NOT_APPLIED", "CONFLICT", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS", "ABORTED"}
JOURNAL_TRANSITIONS = {
    None: {"PREPARED"},
    "PREPARED": {"LEASED", "CONFLICT", "NOT_APPLIED", "ABORTED", "RECOVERY_RECONCILING"},
    "LEASED": {"PREFLIGHT_OK", "CONFLICT", "ABORTED", "RECOVERY_RECONCILING"},
    "PREFLIGHT_OK": {"CHECKPOINTED", "APPLIED", "CONFLICT", "RECOVERY_RECONCILING"},
    "CHECKPOINTED": {"APPLIED", "CONFLICT", "RECOVERY_RECONCILING"},
    "APPLIED": {"APPLIED", "READBACK_S1", "RECOVERY_RECONCILING"},
    "READBACK_S1": {"VERIFIED", "RECOVERY_RECONCILING"},
    "VERIFIED": {"SAVED", "RECOVERY_RECONCILING"},
    "SAVED": {"PUBLISHED", "RECOVERY_RECONCILING"},
    "PUBLISHED": {"COMMITTED", "RECOVERY_RECONCILING"},
    "RECOVERY_RECONCILING": {"NOT_APPLIED", "COMMITTED_RECOVERED", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS", "RECOVERY_RECONCILING"},
}


def semantic_journal(records, plan=None):
    errs = []
    if not records:
        return ["empty journal"]
    first = records[0]
    tx, pd, tgt, gd = first.get("transaction_id"), first.get("plan_digest"), first.get("target_ref"), first.get("guard_digest")
    if plan is not None:
        if pd != plan.get("plan_digest"):
            errs.append("journal plan_digest != plan")
        if tx != plan.get("transaction_id"):
            errs.append("journal transaction_id != plan")
        if gd != plan.get("h0_guard_digest"):
            errs.append("journal guard_digest != plan h0_guard_digest")
        if tgt != {k: (plan.get("target") or {}).get(k) for k in ("project_unique_id", "timeline_unique_id", "library_instance_uuid")}:
            errs.append("journal target_ref != plan target")
    prev_state, prev_hash, expected_seq = None, None, 0
    applied_ops = set()
    for r in records:
        if r.get("transaction_id") != tx:
            errs.append(f"seq {r['sequence']}: transaction_id changed mid-chain")
        if r.get("plan_digest") != pd:
            errs.append(f"seq {r['sequence']}: plan_digest changed mid-chain")
        if r.get("target_ref") != tgt:
            errs.append(f"seq {r['sequence']}: target_ref changed mid-chain")
        if r.get("guard_digest") != gd and r.get("state") not in ("RECOVERY_RECONCILING",):
            errs.append(f"seq {r['sequence']}: guard_digest changed without a recovery transition")
        if r["sequence"] != expected_seq:
            errs.append(f"seq {r['sequence']}: sequence not contiguous (expected {expected_seq})")
        expected_seq = r["sequence"] + 1
        if r["previous_record_sha256"] != prev_hash:
            errs.append(f"seq {r['sequence']}: hash chain broken")
        if r["state"] not in JOURNAL_TRANSITIONS.get(prev_state, set()):
            errs.append(f"seq {r['sequence']}: illegal transition {prev_state} -> {r['state']}")
        if r["state"] == "APPLIED":
            if r.get("operation_id") is None:
                errs.append(f"seq {r['sequence']}: APPLIED without operation_id")
            elif r["operation_id"] in applied_ops:
                errs.append(f"seq {r['sequence']}: operation_id {r['operation_id']} applied twice")
            else:
                applied_ops.add(r["operation_id"])
        if r["state"] == "RECOVERY_RECONCILING" and r.get("recovery_of_transaction_id") != tx:
            errs.append(f"seq {r['sequence']}: recovery record not linked to original transaction")
        if prev_state in TERMINAL_STATES:
            errs.append(f"seq {r['sequence']}: record after terminal state {prev_state}")
        prev_state = r["state"]
        prev_hash = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return errs


def journal_head(records):
    h = None
    for r in records:
        h = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return h


def semantic_verification_result(vr, plan=None, s1_guard_digest=None):
    errs = []
    if vr["verdict"] == "VERIFIED" and (vr["unrelated"] or vr["missing_expected"]):
        errs.append("VERIFIED with unrelated or missing_expected non-empty")
    if vr["is_human_approval"] is not False:
        errs.append("verification can never be human approval")
    if plan is not None:
        if vr.get("plan_digest") != plan.get("plan_digest"):
            errs.append("verification refers to another plan")
        if vr.get("transaction_id") != plan.get("transaction_id"):
            errs.append("verification refers to another transaction")
        if vr.get("target") != plan.get("target"):
            errs.append("verification refers to another target")
        if vr.get("h0_guard_digest") != plan.get("h0_guard_digest"):
            errs.append("verification guard mismatch")
        if vr.get("expected_delta_digest") != plan.get("operation_set_digest"):
            errs.append("verification expected-delta authority != plan operation set")
    if s1_guard_digest is not None and vr.get("s1_guard_digest") != s1_guard_digest:
        errs.append("verification s1 guard != observed readback guard")
    return errs


def semantic_conflict(cf, plan=None):
    errs = []
    if cf.get("authority_effect") != "NONE_UNTIL_HUMAN_ADJUDICATION":
        errs.append("conflict must have no authority effect")
    if plan is not None and (cf.get("plan_digest") != plan.get("plan_digest") or cf.get("transaction_id") != plan.get("transaction_id")):
        errs.append("conflict not bound to this plan/transaction")
    return errs


def semantic_commit_manifest(cm, plan, journal_records, verification_result, conflicts, guard_snapshot_digest):
    """Composes validation: journal and verification semantics are re-validated here; a hash alone is never trusted."""
    errs = []
    if plan is None or not journal_records or verification_result is None:
        return ["commit requires plan, journal and verification objects (not only their hashes)"]
    errs += [f"journal: {e}" for e in semantic_journal(journal_records, plan)]
    errs += [f"verification: {e}" for e in semantic_verification_result(verification_result, plan)]
    for c in conflicts or []:
        errs += [f"conflict: {e}" for e in semantic_conflict(c, plan)]
        if c.get("resolved") is not True:
            errs.append("commit with unresolved conflict")
    if cm.get("plan_digest") != plan.get("plan_digest"):
        errs.append("commit plan_digest != plan")
    if cm.get("transaction_id") != plan.get("transaction_id") or cm.get("transaction_id") != journal_records[0].get("transaction_id"):
        errs.append("commit transaction_id mismatch")
    if cm.get("target") != plan.get("target"):
        errs.append("commit target != plan target")
    if cm.get("guard_digest") != plan.get("h0_guard_digest") or cm.get("guard_digest") != guard_snapshot_digest:
        errs.append("commit guard_digest does not match plan/target guard")
    if cm.get("journal_head_sha256") != journal_head(journal_records):
        errs.append("commit journal_head_sha256 does not match journal chain head")
    if cm.get("verification_result_sha256") != digest(verification_result, "vidtoolz.resolveVerificationResult.v1"):
        errs.append("verification_result_sha256 does not match the validated verification object")
    if verification_result.get("verdict") != "VERIFIED":
        errs.append("commit without VERIFIED verification")
    terminal = journal_records[-1]["state"]
    if terminal not in ("PUBLISHED", "COMMITTED", "COMMITTED_RECOVERED"):
        errs.append(f"commit for journal whose last state is {terminal}")
    if cm.get("terminal_state") not in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("invalid terminal_state")
    if cm.get("unresolved_conflicts"):
        errs.append("commit with unresolved_conflicts listed")
    for k in ("binding_observation_sha256", "binding_set_digest", "receipt_sha256"):
        if not is_sha(cm.get(k)):
            errs.append(f"missing required evidence {k}")
    if cm.get("authority_version") != AUTHORITY_VERSION:
        errs.append("commit authority_version != current authority")
    return errs


def validate_transaction_set(ts, perms, rp, caps, tc, es, schema_validate=None):
    """The authority for cross-artifact consistency. ts = {plan, journal, verification, commit|None, conflicts, guard_snapshot_digest}.
    schema_validate(name, doc) -> list[str] (optional callback to compose schema validation)."""
    errs = []
    plan, journal, vr, cm, conflicts = ts.get("plan"), ts.get("journal") or [], ts.get("verification"), ts.get("commit"), ts.get("conflicts") or []
    if schema_validate:
        errs += [f"schema/plan: {e}" for e in schema_validate("provisional/resolveMutationPlan", plan)]
        for r in journal:
            errs += [f"schema/journal: {e}" for e in schema_validate("provisional/resolveTransactionJournal", r)]
        if vr is not None:
            errs += [f"schema/verification: {e}" for e in schema_validate("provisional/resolveVerificationResult", vr)]
        if cm is not None:
            errs += [f"schema/commit: {e}" for e in schema_validate("provisional/resolveCommitManifest", cm)]
        for c in conflicts:
            errs += [f"schema/conflict: {e}" for e in schema_validate("provisional/resolveConflict", c)]
    if errs:
        return errs
    errs += [f"plan: {e}" for e in semantic_mutation_plan(plan, perms, rp, caps, tc, es, ts.get("guard_snapshot_digest"))]
    errs += [f"journal: {e}" for e in semantic_journal(journal, plan)]
    if vr is not None:
        errs += [f"verification: {e}" for e in semantic_verification_result(vr, plan)]
    for c in conflicts:
        errs += [f"conflict: {e}" for e in semantic_conflict(c, plan)]
    if cm is not None:
        errs += [f"commit: {e}" for e in semantic_commit_manifest(cm, plan, journal, vr, conflicts, ts.get("guard_snapshot_digest"))]
    elif journal and journal[-1]["state"] in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("journal reached COMMITTED without a commit manifest")
    return errs


# ------------------------------------------------------------------ manifest validation (bytes + sha + lineage)
def semantic_manifest(m, bundle_dir=None, sha_fn=None, parent_manifest=None, size_fn=None):
    errs = []
    if m.get("schema") != "vidtoolz.resolveFreezeManifest.v1.3":
        errs.append("wrong manifest schema")
    vocab = set(m.get("status_vocabulary", []))
    paths = [e["path"] for e in m["files"]]
    if len(set(paths)) != len(paths):
        errs.append("duplicate path in manifest")
    pv = {x["path"]: x["sha256"] for x in parent_manifest["files"]} if parent_manifest else {}
    for e in m["files"]:
        if e.get("status") not in vocab:
            errs.append(f"{e['path']}: invalid status {e.get('status')!r}")
        if not is_sha(e.get("sha256")):
            errs.append(f"{e['path']}: missing/malformed sha256")
        if not isinstance(e.get("bytes"), int) or isinstance(e.get("bytes"), bool) or e.get("bytes") < 0:
            errs.append(f"{e['path']}: missing/invalid byte count")
        if e.get("authority_class") not in ("NORMATIVE", "SCHEMA", "FIXTURE", "TOOL", "HISTORICAL_INPUT", "REPORT"):
            errs.append(f"{e['path']}: unknown authority classification")
        if bundle_dir and sha_fn:
            p = f"{bundle_dir}/{e['path']}"
            if sha_fn(p) != e.get("sha256"):
                errs.append(f"{e['path']}: sha mismatch on disk")
            actual_size = size_fn(p) if size_fn else os.path.getsize(p)
            if actual_size != e.get("bytes"):
                errs.append(f"{e['path']}: byte count {e.get('bytes')} != on-disk size {actual_size}")
        if parent_manifest is not None:
            if e.get("inherited_from_parent") and pv.get(e["path"]) != e.get("sha256"):
                errs.append(f"{e['path']}: marked inherited but bytes differ from parent")
            if e.get("changed_from_parent") and pv.get(e["path"]) in (None, e.get("sha256")):
                errs.append(f"{e['path']}: marked changed but identical/absent in parent")
            if e.get("new_in_this_version") and e["path"] in pv:
                errs.append(f"{e['path']}: marked new but present in parent")
    par = m.get("parent", {})
    if par.get("version") != "1.2.0" or par.get("head") != "c6d1284c6f395f5b21a6d14f8c2873bccfc065bb" or par.get("manifest_sha256") != "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6":
        errs.append("broken parent lineage")
    return errs
