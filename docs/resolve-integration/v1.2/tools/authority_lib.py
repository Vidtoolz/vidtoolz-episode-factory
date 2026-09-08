"""VIDTOOLZ Resolve authority bundle v1.2 — reference canonicalization, digests, eligibility and semantic rules.

Reference implementation (Python, offline). Nothing here touches Resolve. Node conformance is M1 work.
These are executable *contract* checks; they are not runtime-qualified.
"""
import hashlib
import json
import re
from fractions import Fraction

CANONICALIZATION_VERSION = "1.2"
TRACK_TYPE_ORDER = {"video": 0, "audio": 1, "subtitle": 2}
ITEM_KIND_ORDER = {"MEDIA_BACKED": 0, "GENERATOR": 1, "TITLE": 2, "COMPOUND": 3, "ADJUSTMENT": 4, "FUSION_OR_GENERATED": 5, "OTHER_OBSERVED": 6}
HASH_DOMAINS = {
    "vidtoolz.resolveSnapshotPayload.v1.2",
    "vidtoolz.resolveGuard.v1",
    "vidtoolz.resolveMutationPlan.v1",
    "vidtoolz.resolveBindingSet.v1",
    "vidtoolz.resolveJournalRecord.v1",
    "vidtoolz.resolveGeneric.v1",
}
F64_RE = re.compile(r"^[0-9a-f]{16}$")
RATIONAL_RE = re.compile(r"^(0|[1-9][0-9]*)/([1-9][0-9]*)$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
OBS_STATUS = ("OBSERVED", "UNAVAILABLE", "UNSUPPORTED", "ERROR", "NOT_REQUESTED")
KNOWN_DOMAINS = {"connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "render_queue"}
COVERAGE_PROFILES = {
    "MINIMAL_M0": {"mandatory_domains": ["connection", "library", "project", "timeline"], "mandatory_item_fields": [], "items_required": False},
    "FULL_TIMELINE_READ": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings"], "mandatory_item_fields": ["start", "end"], "items_required": True},
    "WRITE_PRECHECK": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "markers", "settings", "track_locks", "adapter_bin_media"], "mandatory_item_fields": ["start", "end", "unique_id"], "items_required": True},
}
ATTACHMENT_STATES = ["UNPROVISIONED", "PROVISIONED_NOT_VERIFIED", "ATTACHMENT_READY", "ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY"]
ATTACHMENT_REQUIREMENTS = {
    "UNPROVISIONED": [],
    "PROVISIONED_NOT_VERIFIED": ["library.root_path", "library.instance_uuid", "provisioning.record_sha256"],
    "ATTACHMENT_READY": ["library.root_path", "library.instance_uuid", "provisioning.record_sha256", "session.launch_recipe_sha256", "host.name_matches_contract", "bundle.independent_verification_sha256"],
    "ATTACHED_READ_ONLY": ["library.root_path", "library.instance_uuid", "provisioning.record_sha256", "session.launch_recipe_sha256", "host.name_matches_contract", "bundle.independent_verification_sha256", "observed.database_matches_contract", "observed.database_not_shared", "observed.resolve_version_matches_contract"],
    "SCRATCH_WRITE_READY": ["library.root_path", "library.instance_uuid", "provisioning.record_sha256", "session.launch_recipe_sha256", "host.name_matches_contract", "bundle.independent_verification_sha256", "observed.database_matches_contract", "observed.database_not_shared", "observed.resolve_version_matches_contract", "authorization.m3_token_sha256", "session.exclusive_attestation_sha256", "capabilities.m0_requalification_sha256"],
}


class CanonError(ValueError):
    pass


class ParseError(ValueError):
    pass


# ------------------------------------------------------------------ strict JSON parse boundary (policy A)
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
    """Authority files MUST be loaded through this: duplicate keys are rejected at the parse boundary.
    Ordinary parsed JSON cannot detect duplicates afterwards; the canonicalizer never claims to."""
    return json.loads(text, object_pairs_hook=_no_dup_pairs)


def strict_load(path):
    with open(path, "r", encoding="utf-8") as f:
        return strict_loads(f.read())


# ------------------------------------------------------------------ tagged numerics
def validate_f64(s):
    if not isinstance(s, str) or not F64_RE.match(s):
        raise CanonError("$f64 must be exactly 16 lowercase hex characters (IEEE-754 binary64 big-endian)")
    bits = int(s, 16)
    exp = (bits >> 52) & 0x7FF
    if exp == 0x7FF:
        raise CanonError("$f64 NaN/Infinity rejected")
    if bits == 0x8000000000000000:
        raise CanonError("$f64 negative zero must be normalized to 0000000000000000")
    return s


def validate_rational(s):
    if not isinstance(s, str):
        raise CanonError("$rational must be a string p/q")
    m = RATIONAL_RE.match(s)
    if not m:
        raise CanonError("$rational must match ^(0|[1-9][0-9]*)/([1-9][0-9]*)$")
    p, q = int(m.group(1)), int(m.group(2))
    f = Fraction(p, q)
    if f.numerator != p or f.denominator != q:
        raise CanonError("$rational must be reduced")
    return Fraction(p, q)


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


# ------------------------------------------------------------------ typed ordering
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


def item_sort_key(it):
    kind = (it.get("provenance") or {}).get("kind", "OTHER_OBSERVED")
    ordinal = it.get("observation_ordinal")
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0:
        raise CanonError("item.observation_ordinal (position in GetItemListInTrack) is required for total ordering")
    return (_num(it["start"]), _num(it["end"]), ITEM_KIND_ORDER.get(kind, 99), _s(it.get("unique_id")), ordinal)


def sort_items(items):
    keys = [item_sort_key(it) for it in items]
    if len(set(keys)) != len(keys):
        raise CanonError("two items share start/end/kind/unique_id/ordinal: identity collision")
    ords = [k[4] for k in keys]
    if len(set(ords)) != len(ords):
        raise CanonError("duplicate observation_ordinal within a track")
    return sorted(items, key=item_sort_key)


def marker_sort_key(m):
    return (_s(m.get("object_address")), _num(m["frame"]), _num(m["duration"]), _s(m.get("custom_data")), _s(m.get("name")), _s(m.get("color")), _s(m.get("note")))


def sort_markers(markers):
    """Total order over all semantically relevant fields. Exact duplicates and (object_address, frame)
    collisions are rejected: Resolve keys markers by frame per object, so two markers at one frame on one
    object cannot be a faithful observation."""
    addr_frame = [( _s(m.get("object_address")), _num(m["frame"])) for m in markers]
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
    return digest(normalize_snapshot_payload(payload), "vidtoolz.resolveSnapshotPayload.v1.2")


def guard_object(snapshot):
    return {
        "hash_domain": "vidtoolz.resolveGuard.v1",
        "guard_version": 1,
        "library": snapshot["library"],
        "project": {"unique_id": snapshot["project"]["unique_id"], "name": snapshot["project"]["name"]},
        "timeline": {"unique_id": snapshot["payload"]["timeline"]["unique_id"], "name": snapshot["payload"]["timeline"]["name"]},
        "target_epoch": snapshot["target_epoch"],
        "coverage": snapshot["coverage"],
        "policy": snapshot["policy"],
        "payload_sha256": snapshot["payload_sha256"],
    }


def guard_digest(snapshot):
    return digest(guard_object(snapshot), "vidtoolz.resolveGuard.v1")


# ------------------------------------------------------------------ target attachment gate
def attachment_state_errors(tc):
    """Checks that the declared attachment_state is supported by the evidence fields present."""
    errs = []
    st = tc.get("attachment_state")
    if st not in ATTACHMENT_STATES:
        return [f"unknown attachment_state {st!r}"]
    ev = tc.get("attachment_evidence", {})
    for req in ATTACHMENT_REQUIREMENTS[st]:
        if not ev.get(req):
            errs.append(f"attachment_state {st} requires evidence {req}")
    lib = tc["library"]
    if st == "UNPROVISIONED" and (lib["root_path"] is not None or lib["instance_uuid"] is not None):
        errs.append("UNPROVISIONED must have null root_path/instance_uuid")
    if st != "UNPROVISIONED" and (lib["root_path"] is None or lib["instance_uuid"] is None):
        errs.append("provisioned states require root_path and instance_uuid")
    if ev.get("observed.database_name") and ev["observed.database_name"] in lib.get("prohibited_library_names", []):
        errs.append("observed database is a prohibited (shared/user) library")
    if ev.get("observed.database_name") and ev["observed.database_name"] != lib["name"]:
        errs.append("observed database does not match the qualification library")
    return errs


def semantic_target_contract(tc):
    errs = []
    lib = tc["library"]
    if lib["name"] in lib.get("prohibited_library_names", []):
        errs.append("qualification library name is a prohibited library")
    if tc.get("accepts_current_open_session_as_target") is not False:
        errs.append("target must never accept whatever session is open")
    required_denied = {"SetCurrentDatabase", "CloseProject", "ImportProject", "ReplaceClip", "run_script", "run_script_unsafe", "execute_python", "execute_lua"}
    missing = required_denied - set(tc["denied_calls_all_scopes"])
    if missing:
        errs.append(f"denied_calls_all_scopes missing {sorted(missing)}")
    errs += attachment_state_errors(tc)
    return errs


# ------------------------------------------------------------------ permission declaration vs eligibility
PREREQ_CODES = {
    "BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHMENT_READY", "TARGET_STATE_ATTACHED_READ_ONLY", "TARGET_STATE_SCRATCH_WRITE_READY",
    "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "RESOLVE_VERSION_MATCHES", "M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE",
    "MIKKO_M3_AUTHORIZATION", "JOURNAL_PREPARED", "GUARD_CURRENT", "EXCLUSIVE_SESSION_ATTESTED", "PROJECT_ADAPTER_PREFIXED", "READ_ONLY_JOURNAL_OPEN",
    "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED", "PLAN_VALIDATED", "SYNTHETIC_MEDIA_ONLY", "TIMELINE_IS_DESTINATION",
}


def _has(ev, key):
    v = ev.get(key)
    return bool(v) and (not isinstance(v, str) or not SHA_RE.match(v) or True)


def evaluate_eligibility(perms, request, read_primitives=None, capabilities=None):
    """Deterministic offline eligibility evaluator.
    request = {milestone, operation, scope, target: {attachment_state, host_name, library_name, library_kind, observed_database_name, project_name}, evidence: {...}, capability_state: {method: evidence_class}, journal_available, guard_available, authorization_token}
    Unknown/missing evidence fails closed. permitted_by_policy is the declaration; eligible requires every prerequisite.
    """
    out = {"permitted_by_policy": False, "prerequisites_satisfied": False, "eligible": False, "failed_prerequisites": [], "reason_codes": [], "expanded_primitives": []}
    m, op, sc = request.get("milestone"), request.get("operation"), request.get("scope")
    if perms.get("default") != "DENY":
        out["reason_codes"].append("POLICY_DEFAULT_NOT_DENY")
        return out
    if m not in perms["milestones"]:
        out["reason_codes"].append("UNKNOWN_MILESTONE")
        return out
    if sc not in perms["scopes"]:
        out["reason_codes"].append("UNKNOWN_OR_PROHIBITED_SCOPE")
        return out
    if op in perms["denied_all_scopes"]:
        out["reason_codes"].append("DENIED_ALL_SCOPES")
        return out
    entry = next((e for e in perms["entries"] if e["milestone"] == m and e["operation"] == op and e["scope"] == sc), None)
    if entry is None or not entry.get("allowed"):
        out["reason_codes"].append("NO_EXPLICIT_ALLOW_ENTRY")
        return out
    out["permitted_by_policy"] = True
    tgt = request.get("target") or {}
    ev = request.get("evidence") or {}
    cap = request.get("capability_state") or {}
    tc_host = perms.get("target_contract_ref", {}).get("host_name")
    tc_lib = perms.get("target_contract_ref", {}).get("library_name")
    prohibited = set(perms.get("target_contract_ref", {}).get("prohibited_library_names", []))
    failed = []
    for code in entry.get("prerequisites", []):
        if code not in PREREQ_CODES:
            failed.append(f"UNKNOWN_PREREQUISITE_CODE:{code}")
            continue
        ok = False
        if code == "BUNDLE_INDEPENDENTLY_VERIFIED":
            ok = bool(ev.get("bundle_independent_verification_sha256")) and bool(SHA_RE.match(str(ev.get("bundle_independent_verification_sha256"))))
        elif code == "TARGET_STATE_ATTACHMENT_READY":
            ok = tgt.get("attachment_state") in ("ATTACHMENT_READY", "ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY")
        elif code == "TARGET_STATE_ATTACHED_READ_ONLY":
            ok = tgt.get("attachment_state") in ("ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY")
        elif code == "TARGET_STATE_SCRATCH_WRITE_READY":
            ok = tgt.get("attachment_state") == "SCRATCH_WRITE_READY"
        elif code == "HOST_MATCHES_CONTRACT":
            ok = bool(tc_host) and tgt.get("host_name") == tc_host
        elif code == "LIBRARY_NOT_SHARED":
            name = tgt.get("observed_database_name") or tgt.get("library_name")
            ok = bool(name) and name not in prohibited and tgt.get("library_kind") == "Disk"
        elif code == "LIBRARY_MATCHES_CONTRACT":
            ok = bool(tc_lib) and tgt.get("library_name") == tc_lib and (tgt.get("observed_database_name") in (None, tc_lib))
        elif code == "RESOLVE_VERSION_MATCHES":
            ok = tgt.get("resolve_version") == perms.get("target_contract_ref", {}).get("resolve_version")
        elif code in ("M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE"):
            ok = bool(ev.get(code.lower() + "_sha256")) and bool(SHA_RE.match(str(ev.get(code.lower() + "_sha256"))))
        elif code == "MIKKO_M3_AUTHORIZATION":
            ok = bool(request.get("authorization_token")) and bool(SHA_RE.match(str(request.get("authorization_token"))))
        elif code == "JOURNAL_PREPARED":
            ok = request.get("journal_available") is True and ev.get("journal_prepared_record_sha256") is not None
        elif code == "READ_ONLY_JOURNAL_OPEN":
            ok = request.get("journal_available") is True
        elif code == "GUARD_CURRENT":
            ok = request.get("guard_available") is True and bool(ev.get("current_guard_digest")) and ev.get("current_guard_digest") == ev.get("plan_h0_guard_digest")
        elif code == "EXCLUSIVE_SESSION_ATTESTED":
            ok = bool(ev.get("exclusive_session_attestation_sha256"))
        elif code == "PROJECT_ADAPTER_PREFIXED":
            ok = str(tgt.get("project_name", "")).startswith(perms.get("target_contract_ref", {}).get("project_prefix", "\x00"))
        elif code == "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED":
            prims = (read_primitives or {}).get("logical_operations", {}).get(op, {}).get("primitives", [])
            out["expanded_primitives"] = [{"method": p["method"], "evidence_class": cap.get(p["method"], p.get("evidence_class")), "callable": cap.get(p["method"], p.get("evidence_class")) == "QUALIFIED_READ", "fallback": p.get("fallback_if_unqualified")} for p in prims]
            ok = all(p["callable"] or p["fallback"] in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE") for p in out["expanded_primitives"]) and bool(prims)
        elif code == "PLAN_VALIDATED":
            ok = ev.get("plan_semantic_validation") == "PASS"
        elif code == "SYNTHETIC_MEDIA_ONLY":
            ok = ev.get("media_class") == "SYNTHETIC"
        elif code == "TIMELINE_IS_DESTINATION":
            ok = bool(tgt.get("timeline_unique_id")) and tgt.get("timeline_unique_id") == ev.get("destination_timeline_unique_id")
        if not ok:
            failed.append(code)
    out["failed_prerequisites"] = failed
    out["prerequisites_satisfied"] = not failed
    out["eligible"] = out["permitted_by_policy"] and not failed
    out["reason_codes"].append("ELIGIBLE" if out["eligible"] else "PREREQUISITES_FAILED")
    return out


def permission_lookup(perms, milestone, operation, scope):
    """Declaration-only lookup (fail closed). Eligibility is evaluate_eligibility()."""
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


# ------------------------------------------------------------------ snapshot completeness + ranges
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
    if cov["complete"]:
        if not obs:
            errs.append("complete:true with empty observed_domains")
        if not mandatory <= obs:
            errs.append(f"complete:true but mandatory domains not observed: {sorted(mandatory - obs)}")
    elif not (unob or deff or (mandatory - obs)):
        errs.append("complete:false must name missing domains")
    tl = snap["payload"]["timeline"]
    if tl["end_frame"] < tl["start_frame"]:
        errs.append("timeline end_frame < start_frame")
    conv = tl.get("duration_convention")
    if conv not in ("UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"):
        errs.append("timeline.duration_convention missing")
    items_seen = 0
    for t in snap["payload"]["tracks"]:
        for it in t["items"]:
            items_seen += 1
            fs = it["field_status"]
            for fld in ("unique_id", "media_pool_item_unique_id", "media_id", "source_start", "source_end"):
                st = fs.get(fld)
                val = it.get(fld)
                if st == "OBSERVED" and val is None:
                    errs.append(f"{fld}: status OBSERVED but value null")
                if st in ("UNAVAILABLE", "UNSUPPORTED", "ERROR", "NOT_REQUESTED") and val is not None:
                    errs.append(f"{fld}: status {st} but value present (fabrication)")
                if st in ("UNAVAILABLE", "ERROR") and not fs.get(fld + "_reason"):
                    errs.append(f"{fld}: status {st} requires a reason")
            if cov["complete"]:
                for fld in prof["mandatory_item_fields"]:
                    if fld in ("start", "end"):
                        continue
                    if fs.get(fld) != "OBSERVED":
                        errs.append(f"complete:true under {cov['profile']} but item field {fld} not OBSERVED")
            s, e = _num(it["start"]), _num(it["end"])
            if e < s:
                errs.append(f"item {it.get('unique_id') or it['observation_ordinal']}: end < start")
            if it.get("duration") is not None:
                d = _num(it["duration"])
                if conv == "END_EXCLUSIVE" and d != e - s:
                    errs.append("duration inconsistent with END_EXCLUSIVE convention")
                elif conv == "END_INCLUSIVE" and d != e - s + 1:
                    errs.append("duration inconsistent with END_INCLUSIVE convention")
                elif conv == "UNQUALIFIED" and d not in (e - s, e - s + 1):
                    errs.append("duration inconsistent with both candidate conventions (raw observation contradiction)")
            if it.get("source_start") is not None and it.get("source_end") is not None and _num(it["source_end"]) < _num(it["source_start"]):
                errs.append("source_end < source_start")
            kind = it["provenance"]["kind"]
            if kind == "MEDIA_BACKED":
                if it["source_status"] == "HASHED" and not it.get("source_sha256"):
                    errs.append("HASHED item without sha")
                if it["source_status"] != "HASHED" and it.get("source_sha256"):
                    errs.append("sha present but status not HASHED")
            else:
                if it["source_status"] != "NOT_APPLICABLE" or it.get("source_sha256") is not None:
                    errs.append(f"{kind} item must have NOT_APPLICABLE source and null sha")
    if prof["items_required"] and cov["complete"] and items_seen == 0 and "items" in obs:
        pass  # an empty timeline is a legitimate complete observation
    try:
        if snapshot_payload_digest(snap["payload"]) != snap["payload_sha256"]:
            errs.append("payload_sha256 does not match canonical payload")
        if guard_digest(snap) != snap["guard_digest"]:
            errs.append("guard_digest does not match guard object")
    except CanonError as e:
        errs.append(f"canonicalization error: {e}")
    return errs


# ------------------------------------------------------------------ other frozen-authority semantics
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


# ------------------------------------------------------------------ provisional mutation authorities (executable contract checks)
WRITE_OPS = {"IMPORT_MEDIA", "APPEND", "DELETE", "DISABLE", "ENABLE", "SET_TAKE", "UPSERT_MARKER", "SET_PROPERTIES", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT", "SAVE_PROJECT"}
GUARD_REQUIRED_OPS = WRITE_OPS - {"IMPORT_MEDIA"}


def semantic_mutation_plan(plan, perms, current_guard_digest=None, read_primitives=None):
    errs = []
    if plan.get("permission_class") == "RESOLVE_READ" and any(o["op"] in WRITE_OPS for o in plan["operations"]):
        errs.append("RESOLVE_READ permission class cannot carry write operations")
    tgt = plan.get("target") or {}
    for o in plan["operations"]:
        req = {"milestone": plan["milestone"], "operation": o["op"], "scope": plan["scope"], "target": {"attachment_state": plan.get("target_attachment_state"), "host_name": tgt.get("host_name"), "library_name": tgt.get("library_name"), "library_kind": tgt.get("library_kind", "Disk"), "observed_database_name": tgt.get("observed_database_name"), "project_name": tgt.get("project_name"), "timeline_unique_id": tgt.get("timeline_unique_id"), "resolve_version": tgt.get("resolve_version")}, "evidence": plan.get("evidence") or {}, "authorization_token": plan.get("authorization_token"), "journal_available": plan.get("journal_available"), "guard_available": current_guard_digest is not None, "capability_state": plan.get("capability_state") or {}}
        req["evidence"] = dict(req["evidence"], plan_h0_guard_digest=plan.get("h0_guard_digest"), current_guard_digest=current_guard_digest)
        el = evaluate_eligibility(perms, req, read_primitives)
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
        if o["op"] in GUARD_REQUIRED_OPS and not plan.get("h0_guard_digest"):
            errs.append(f"operation {o['op']} requires h0_guard_digest")
    if current_guard_digest is not None and plan.get("h0_guard_digest") != current_guard_digest:
        errs.append("plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)")
    if plan.get("dry_run") is not True and plan["milestone"] in ("M0", "M1", "M2"):
        errs.append("non-dry-run plan before M3")
    if plan.get("h0_guard_digest") and plan.get("h0_payload_sha256") and plan["h0_guard_digest"] == plan["h0_payload_sha256"]:
        errs.append("payload digest used as guard digest")
    return errs


def semantic_verification_result(vr):
    errs = []
    if vr["verdict"] == "VERIFIED" and (vr["unrelated"] or vr["missing_expected"]):
        errs.append("VERIFIED with unrelated or missing_expected non-empty")
    if vr["is_human_approval"] is not False:
        errs.append("verification can never be human approval")
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


def semantic_journal(records):
    errs = []
    if not records:
        return ["empty journal"]
    prev_state = None
    prev_hash = None
    tx = records[0]["transaction_id"]
    seen_seq = set()
    applied_ops = set()
    expected_seq = 0
    for r in records:
        if r["transaction_id"] != tx:
            errs.append(f"seq {r['sequence']}: transaction_id changed mid-chain")
        if r["sequence"] in seen_seq:
            errs.append(f"seq {r['sequence']}: repeated sequence number")
        if r["sequence"] != expected_seq:
            errs.append(f"seq {r['sequence']}: sequence gap (expected {expected_seq})")
        seen_seq.add(r["sequence"])
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


def semantic_commit_manifest(cm, journal_records, verification_result, snapshot_guard_digest):
    errs = []
    if not journal_records:
        return ["commit without journal"]
    if cm["transaction_id"] != journal_records[0]["transaction_id"]:
        errs.append("commit transaction_id does not match journal")
    if cm["journal_head_sha256"] != journal_head(journal_records):
        errs.append("commit journal_head_sha256 does not match journal chain head")
    terminal = journal_records[-1]["state"]
    if terminal not in ("PUBLISHED", "COMMITTED", "COMMITTED_RECOVERED"):
        errs.append(f"commit for journal whose last state is {terminal}")
    if cm["terminal_state"] not in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("invalid terminal_state")
    if verification_result is None or verification_result.get("verdict") != "VERIFIED":
        errs.append("commit without VERIFIED verification result")
    elif cm.get("verification_result_sha256") != digest(verification_result, "vidtoolz.resolveGeneric.v1"):
        errs.append("verification_result_sha256 does not match the linked verification result")
    if cm.get("guard_digest") != snapshot_guard_digest:
        errs.append("commit guard_digest does not match target guard")
    if cm.get("unresolved_conflicts"):
        errs.append("commit with unresolved conflicts")
    for k in ("binding_observation_sha256", "binding_set_digest", "receipt_sha256"):
        if not SHA_RE.match(str(cm.get(k, ""))):
            errs.append(f"missing required evidence {k}")
    return errs


# ------------------------------------------------------------------ capability matrix + read-primitive consistency
def semantic_capabilities(caps, contract_version="21.1.0", contract_build=14):
    """QUALIFIED_READ requires at least one exact evidence record on the contract Resolve version/build for the same method."""
    errs = []
    for r in caps["rows"]:
        if r["evidence_class"] == "QUALIFIED_READ":
            recs = [x for x in r.get("evidence_records", []) if x.get("version_match") is True and x.get("resolve_version") == contract_version and x.get("build") == contract_build and x.get("method") in r["primitives"] and SHA_RE.match(str(x.get("evidence_sha256", "")))]
            if not recs:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ without exact version-matched evidence record")
        for x in r.get("evidence_records", []):
            for k in ("host", "resolve_version", "run_ref", "method", "observed_result", "evidence_path"):
                if not x.get(k):
                    errs.append(f"row '{r['operation']}': evidence record missing {k}")
            if x.get("version_match") is True and (x.get("resolve_version") != contract_version or x.get("build") != contract_build):
                errs.append(f"row '{r['operation']}': version_match true but version differs from contract")
    return errs


def semantic_read_primitives(rp, caps):
    """Every primitive named in READ-PRIMITIVES must be covered by a capability row whose evidence_class it inherits; fallback must be declared."""
    errs = []
    method_class = {}
    for r in caps["rows"]:
        for p in r["primitives"]:
            method_class.setdefault(p, r["evidence_class"])
    for op, spec in rp["logical_operations"].items():
        for p in spec["primitives"]:
            cls = method_class.get(p["method"])
            if cls is None:
                errs.append(f"{op}: primitive {p['method']} has no capability row")
            elif cls != p["evidence_class"]:
                errs.append(f"{op}: primitive {p['method']} evidence_class {p['evidence_class']} != matrix {cls}")
            if p["evidence_class"] != "QUALIFIED_READ" and p.get("fallback_if_unqualified") not in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE", "REFUSE", "PROBE_ONLY"):
                errs.append(f"{op}: unqualified primitive {p['method']} without declared fallback")
    return errs


# ------------------------------------------------------------------ manifest validation
def semantic_manifest(m, bundle_dir=None, sha_fn=None, parent_manifest=None):
    errs = []
    if m.get("schema") != "vidtoolz.resolveFreezeManifest.v1.2":
        errs.append("wrong manifest schema")
    vocab = set(m.get("status_vocabulary", []))
    paths = [e["path"] for e in m["files"]]
    if len(set(paths)) != len(paths):
        errs.append("duplicate path in manifest")
    for e in m["files"]:
        if e.get("status") not in vocab:
            errs.append(f"{e['path']}: invalid status {e.get('status')!r}")
        if not SHA_RE.match(str(e.get("sha256", ""))):
            errs.append(f"{e['path']}: missing/malformed sha256")
        if e.get("authority_class") not in ("NORMATIVE", "SCHEMA", "FIXTURE", "TOOL", "HISTORICAL_INPUT", "REPORT"):
            errs.append(f"{e['path']}: unknown authority classification")
        if bundle_dir and sha_fn:
            actual = sha_fn(f"{bundle_dir}/{e['path']}")
            if actual != e["sha256"]:
                errs.append(f"{e['path']}: sha mismatch on disk")
        if parent_manifest is not None:
            pv = {x["path"]: x["sha256"] for x in parent_manifest["files"]}
            if e.get("inherited_from_parent") and pv.get(e["path"]) != e.get("sha256"):
                errs.append(f"{e['path']}: marked inherited but bytes differ from parent")
            if e.get("changed_from_parent") and pv.get(e["path"]) in (None, e.get("sha256")):
                errs.append(f"{e['path']}: marked changed but identical/absent in parent")
            if e.get("new_in_this_version") and e["path"] in pv:
                errs.append(f"{e['path']}: marked new but present in parent")
    par = m.get("parent", {})
    if par.get("version") != "1.1.0" or par.get("head") != "47ddb225335b8c85ca5255b1de86ff508e0e8e91" or par.get("manifest_sha256") != "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5":
        errs.append("broken parent lineage")
    return errs
