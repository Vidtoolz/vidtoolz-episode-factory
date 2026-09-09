"""VIDTOOLZ Resolve authority bundle v1.4 — reference canonicalization, evidence-envelope binding, deterministic freshness,
evidence-derived attachment/eligibility, capability qualification against the active refrozen authority, honest snapshot
observation model, journal operation membership, derived verification and the composed linked-set validator.

Reference implementation (Python, offline). Nothing here touches Resolve. Node conformance is M1 work.
Executable *contract* checks only; not runtime-qualified.
"""
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from fractions import Fraction

AUTHORITY_VERSION = "1.4.0"
CANONICALIZATION_VERSION = "1.4"
RECORD_TYPE_VERSION = "1.4"
MAX_OBSERVATION_AGE_S = 3600
TRACK_TYPE_ORDER = {"video": 0, "audio": 1, "subtitle": 2}
ITEM_KIND_ORDER = {"MEDIA_BACKED": 0, "GENERATOR": 1, "TITLE": 2, "COMPOUND": 3, "ADJUSTMENT": 4, "FUSION_OR_GENERATED": 5, "OTHER_OBSERVED": 6}
HASH_DOMAINS = {
    "vidtoolz.resolveSnapshotPayload.v1.4", "vidtoolz.resolveGuard.v2", "vidtoolz.resolveMutationPlan.v1", "vidtoolz.resolveOperationSet.v1",
    "vidtoolz.resolveBindingSet.v1", "vidtoolz.resolveJournalRecord.v1", "vidtoolz.resolveEvidenceRecord.v1", "vidtoolz.resolveVerificationResult.v1",
    "vidtoolz.resolveSnapshotObject.v1", "vidtoolz.resolveGeneric.v1",
}
F64_RE = re.compile(r"[0-9a-f]{16}")
RATIONAL_RE = re.compile(r"(0|[1-9][0-9]*)/([1-9][0-9]*)")
SHA_RE = re.compile(r"[a-f0-9]{64}")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
OBS_STATUS = ("OBSERVED", "UNAVAILABLE", "UNSUPPORTED", "ERROR", "NOT_REQUESTED")
STATUS_RANK = {"OBSERVED": 0, "UNAVAILABLE": 1, "UNSUPPORTED": 2, "ERROR": 3, "NOT_REQUESTED": 4}
ITEM_STATUS_FIELDS = ("unique_id", "name", "start", "end", "duration", "enabled", "media_pool_item_unique_id", "media_id", "source_start", "source_end")
TIMELINE_STATUS_FIELDS = ("unique_id", "name", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "is_current", "settings")
PROJECT_STATUS_FIELDS = ("unique_id", "name", "last_modified_time")
TRACK_STATUS_FIELDS = ("name", "enabled", "locked")
# which primitive produces which observed field (OBSERVED requires the primitive to be callable in the collecting session)
FIELD_PRIMITIVE = {
    "timeline.unique_id": ["Timeline.GetUniqueId"], "timeline.name": ["Timeline.GetName"], "timeline.start_frame": ["GetStartFrame"], "timeline.end_frame": ["GetEndFrame"], "timeline.start_timecode": ["GetStartTimecode"], "timeline.fps": ["Timeline.GetSettings"], "timeline.width": ["Timeline.GetSettings"], "timeline.height": ["Timeline.GetSettings"], "timeline.is_current": ["GetCurrentTimeline"], "timeline.settings": ["Timeline.GetSettings"],
    "project.unique_id": ["Project.GetUniqueId"], "project.name": ["Project.GetName"], "project.last_modified_time": ["GetProjectLastModifiedTime"],
    "track.name": ["GetTrackName"], "track.enabled": ["GetIsTrackEnabled"], "track.locked": ["GetIsTrackLocked"],
    "item.unique_id": ["TimelineItem.GetUniqueId"], "item.name": ["TimelineItem.GetName"], "item.start": ["GetStart"], "item.end": ["GetEnd"], "item.duration": ["GetDuration"], "item.enabled": ["GetClipEnabled"], "item.media_pool_item_unique_id": ["GetMediaPoolItem", "MediaPoolItem.GetUniqueId"], "item.media_id": ["GetMediaPoolItem", "MediaPoolItem.GetMediaId"], "item.source_start": ["GetSourceStartFrame"], "item.source_end": ["GetSourceEndFrame"],
}
DOMAIN_PRIMITIVE = {"tracks": ["GetTrackCount"], "items": ["GetItemListInTrack"], "markers": ["GetMarkers"], "settings": ["Timeline.GetSettings", "Project.GetSettings"], "track_locks": ["GetIsTrackLocked"], "item_identity": ["TimelineItem.GetUniqueId"], "item_source_bounds": ["GetSourceStartFrame", "GetSourceEndFrame"]}
KNOWN_DOMAINS = {"connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy", "grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "render_queue"}
COVERAGE_PROFILES = {
    "MINIMAL_M0": {"mandatory_domains": ["connection", "library", "project", "timeline"], "mandatory_item_fields": [], "mandatory_timeline_fields": [], "identity_required": [], "track_locks_required": False, "guard_required": False},
    "FULL_TIMELINE_READ": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings"], "mandatory_item_fields": ["start", "end", "enabled"], "mandatory_timeline_fields": ["name", "start_frame", "end_frame", "fps", "width", "height"], "identity_required": ["timeline.unique_id"], "track_locks_required": False, "guard_required": False},
    "WRITE_PRECHECK": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "mandatory_item_fields": ["start", "end", "enabled", "unique_id", "media_pool_item_unique_id"], "mandatory_timeline_fields": ["name", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "is_current", "settings"], "identity_required": ["project.unique_id", "timeline.unique_id"], "track_locks_required": True, "guard_required": True},
}
ATTACHMENT_STATES = ["UNPROVISIONED", "PROVISIONED_NOT_VERIFIED", "ATTACHMENT_READY", "ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY"]
CONFLICT_STATE = "CONFLICT"
STATE_RANK = {s: i for i, s in enumerate(ATTACHMENT_STATES)}
STATE_RANK[CONFLICT_STATE] = -1
RECORD_TYPES = {"PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION", "CONNECTION_OBSERVATION", "PROJECT_BINDING_OBSERVATION", "TIMELINE_BINDING_OBSERVATION", "OPERATOR_PROVISIONED_PROJECT", "CAPABILITY_EVIDENCE", "RAW_EVIDENCE", "REFREEZE_RECORD", "MILESTONE_EXIT", "M3_AUTHORIZATION", "JOURNAL_PREPARED", "READ_ONLY_JOURNAL", "EXCLUSIVE_SESSION_ATTESTATION", "GUARD_SNAPSHOT", "PLAN_VALIDATION", "MEDIA_CLASS_ATTESTATION", "DESTINATION_TIMELINE"}
ENVELOPE_LEVEL = {"BUNDLE_VERIFICATION": "BUNDLE", "MILESTONE_EXIT": "BUNDLE", "M3_AUTHORIZATION": "BUNDLE", "REFREEZE_RECORD": "BUNDLE", "PLAN_VALIDATION": "BUNDLE", "MEDIA_CLASS_ATTESTATION": "BUNDLE",
                  "PROVISIONING_RECORD": "LIBRARY", "OPERATOR_PROVISIONED_PROJECT": "LIBRARY",
                  "LAUNCH_RECIPE": "SESSION", "CONNECTION_OBSERVATION": "SESSION", "PROJECT_BINDING_OBSERVATION": "SESSION", "TIMELINE_BINDING_OBSERVATION": "SESSION", "CAPABILITY_EVIDENCE": "SESSION", "RAW_EVIDENCE": "SESSION", "JOURNAL_PREPARED": "SESSION", "READ_ONLY_JOURNAL": "SESSION", "EXCLUSIVE_SESSION_ATTESTATION": "SESSION", "GUARD_SNAPSHOT": "SESSION", "DESTINATION_TIMELINE": "SESSION"}
ENVELOPE_REQUIRED = {"BUNDLE": ["authority_version", "manifest_sha256", "host_name"], "LIBRARY": ["authority_version", "manifest_sha256", "host_name", "library_name", "library_uuid", "library_root"], "SESSION": ["authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id"]}
PROJECT_SCOPED = {"PROJECT_BINDING_OBSERVATION", "TIMELINE_BINDING_OBSERVATION", "GUARD_SNAPSHOT", "DESTINATION_TIMELINE", "JOURNAL_PREPARED"}
TIMELINE_SCOPED = {"TIMELINE_BINDING_OBSERVATION", "GUARD_SNAPSHOT", "DESTINATION_TIMELINE"}
ENVELOPE_FIELDS = ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id", "project_name", "project_unique_id", "timeline_name", "timeline_unique_id", "target_epoch", "sequence", "captured_at", "record_type_version")
COHERENCE_FIELDS = ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id")
TARGET_REQUIREMENTS = ("SESSION", "PROJECT", "PROJECT_TIMELINE")
FIXTURE_LAYERS = ("none", "parse", "schema", "evidence-binding", "attachment", "capability", "snapshot", "semantic", "eligibility", "linked-set")
PROBE_FAILURE_TAXONOMY = {"CAPABILITY_FAILURE": ["GETTER_RAISED", "GETTER_TIMEOUT", "UNEXPECTED_RETURN_TYPE", "GETTER_RETURNED_NONE"], "FATAL_TARGET_FAILURE": ["WRONG_HOST", "WRONG_LIBRARY", "WRONG_LIBRARY_UUID", "WRONG_LIBRARY_ROOT", "STALE_SESSION", "CONFLICTING_TARGET", "WRONG_MANIFEST", "WRONG_AUTHORITY_VERSION", "WRONG_RESOLVE_VERSION"]}
WRITE_OPS = {"IMPORT_MEDIA", "APPEND", "DELETE", "DISABLE", "ENABLE", "SET_TAKE", "UPSERT_MARKER", "SET_PROPERTIES", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT", "SAVE_PROJECT"}
GUARD_REQUIRED_OPS = WRITE_OPS - {"IMPORT_MEDIA"}
EFFECT_SPECIFIED_OPS = {"APPEND", "DELETE", "DISABLE", "ENABLE", "UPSERT_MARKER"}
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


def is_abs_path(s):
    return isinstance(s, str) and s.startswith("/") and len(s) > 1 and "/../" not in s and not s.endswith("/..")


def parse_ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


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
    p["observation_failures"] = sorted(p.get("observation_failures", []), key=lambda f: (_s(f.get("track_address")), f.get("observation_ordinal") if isinstance(f.get("observation_ordinal"), int) else -1, _s(f.get("reason"))))
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
            raise CanonError("duplicate keys")
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


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def snapshot_payload_digest(payload):
    return digest(normalize_snapshot_payload(payload), "vidtoolz.resolveSnapshotPayload.v1.4")


def _ident(obj, fs_key="field_status"):
    fs = obj.get(fs_key) or {}
    return {"unique_id": obj.get("unique_id"), "unique_id_status": fs.get("unique_id"), "unique_id_reason": fs.get("unique_id_reason"), "name": obj.get("name"), "name_status": fs.get("name")}


def guard_object(snapshot):
    """v1.4 guard: identity carries observation status AND reason (UNAVAILABLE and ERROR are distinct evidence states)."""
    return {"hash_domain": "vidtoolz.resolveGuard.v2", "guard_version": 2, "library": snapshot["library"], "project": _ident(snapshot["project"]), "timeline": _ident(snapshot["payload"]["timeline"]), "target_epoch": snapshot["target_epoch"], "coverage": snapshot["coverage"], "policy": snapshot["policy"], "payload_sha256": snapshot["payload_sha256"]}


def guard_digest(snapshot):
    return digest(guard_object(snapshot), "vidtoolz.resolveGuard.v2")


def snapshot_object_digest(snapshot):
    """Digest of the whole snapshot object with its payload in canonical order (the readback identity used by verification)."""
    s = dict(snapshot)
    s["payload"] = normalize_snapshot_payload(snapshot["payload"])
    return digest(s, "vidtoolz.resolveSnapshotObject.v1")


def operation_set_digest(operations):
    return digest(operations, "vidtoolz.resolveOperationSet.v1")


# ------------------------------------------------------------------ evidence records: envelope, content addressing, binding
def record_id(rec):
    body = {k: v for k, v in rec.items() if k != "record_id"}
    return digest(body, "vidtoolz.resolveEvidenceRecord.v1")


def make_record(rec):
    r = dict(rec)
    r["record_id"] = record_id(r)
    return r


def envelope_errors(rec):
    """Structural envelope law: every record binds to the identity envelope required by its level."""
    errs = []
    rt = rec.get("record_type")
    env = rec.get("envelope")
    if not isinstance(env, dict):
        return [f"{rt}: envelope missing"]
    extra = set(env) - set(ENVELOPE_FIELDS)
    if extra:
        errs.append(f"{rt}: unknown envelope fields {sorted(extra)}")
    if env.get("record_type_version") != RECORD_TYPE_VERSION:
        errs.append(f"{rt}: envelope.record_type_version must be {RECORD_TYPE_VERSION}")
    level = ENVELOPE_LEVEL.get(rt)
    for k in ENVELOPE_REQUIRED.get(level, []):
        if env.get(k) in (None, ""):
            errs.append(f"{rt}: envelope.{k} required at level {level}")
    if not is_sha(env.get("manifest_sha256")):
        errs.append(f"{rt}: envelope.manifest_sha256 malformed")
    if env.get("library_uuid") is not None and not is_uuid(env["library_uuid"]):
        errs.append(f"{rt}: envelope.library_uuid malformed")
    if env.get("library_root") is not None and not is_abs_path(env["library_root"]):
        errs.append(f"{rt}: envelope.library_root must be absolute and traversal-free")
    if env.get("provisioning_id") is not None and not is_sha(env["provisioning_id"]):
        errs.append(f"{rt}: envelope.provisioning_id malformed")
    if not isinstance(env.get("sequence"), int) or isinstance(env.get("sequence"), bool) or env["sequence"] < 0:
        errs.append(f"{rt}: envelope.sequence must be a non-negative integer")
    if parse_ts(env.get("captured_at")) is None:
        errs.append(f"{rt}: envelope.captured_at must be ISO-8601")
    if rt in PROJECT_SCOPED and not env.get("project_name"):
        errs.append(f"{rt}: envelope.project_name required")
    if rt in TIMELINE_SCOPED and not env.get("timeline_name"):
        errs.append(f"{rt}: envelope.timeline_name required")
    if env.get("build") is not None and (not isinstance(env["build"], int) or isinstance(env["build"], bool)):
        errs.append(f"{rt}: envelope.build must be integer")
    return errs


def validate_evidence_set(es, active=None):
    """Structural + binding validity. `active` = {authority_version, manifest_sha256, capability_matrix_sha256}: every record must
    bind to the active authority (a BUNDLE_VERIFICATION for another manifest is tolerated only with historical:true and never counts)."""
    errs = []
    if not isinstance(es, dict) or not isinstance(es.get("records"), dict):
        return ["evidence set must be {records: {record_id: record}}"]
    if es.get("current_session_id") is not None and not isinstance(es["current_session_id"], str):
        errs.append("current_session_id must be a string or null")
    if parse_ts(es.get("evaluated_at")) is None:
        errs.append("evaluated_at must be ISO-8601")
    for rid, rec in es["records"].items():
        if not is_sha(rid):
            errs.append(f"record id {rid!r} is not a sha256")
            continue
        if not isinstance(rec, dict) or rec.get("record_type") not in RECORD_TYPES:
            errs.append(f"{rid[:12]}: unknown record_type")
            continue
        if rec.get("record_id") != rid or record_id(rec) != rid:
            errs.append(f"{rid[:12]}: record_id does not match content digest")
        errs += [f"{rid[:12]}: {e}" for e in envelope_errors(rec)]
        env = rec.get("envelope") or {}
        if active is not None and isinstance(env, dict):
            hist = rec.get("record_type") == "BUNDLE_VERIFICATION" and rec.get("historical") is True
            if not hist and env.get("manifest_sha256") != active.get("manifest_sha256"):
                errs.append(f"{rid[:12]}: {rec.get('record_type')} bound to manifest {str(env.get('manifest_sha256'))[:12]} != active reviewed manifest")
            if not hist and env.get("authority_version") != active.get("authority_version"):
                errs.append(f"{rid[:12]}: {rec.get('record_type')} bound to authority {env.get('authority_version')} != active {active.get('authority_version')}")
    return errs


def envelope_conflicts(records, fields=COHERENCE_FIELDS):
    """Fields with more than one distinct non-null value across the records: inconsistent records must not compose."""
    out = []
    for f in fields:
        vals = {json.dumps((r.get("envelope") or {}).get(f), sort_keys=True) for r in records if (r.get("envelope") or {}).get(f) is not None}
        if len(vals) > 1:
            out.append(f)
    return out


def find_records(es, rtype, **match):
    out = []
    for rid, rec in (es or {}).get("records", {}).items():
        if rec.get("record_type") != rtype or record_id(rec) != rid:
            continue
        ok = True
        for k, v in match.items():
            if k.startswith("env."):
                ok = ok and (rec.get("envelope") or {}).get(k[4:]) == v
            else:
                ok = ok and rec.get(k) == v
        if ok:
            out.append(rec)
    return sorted(out, key=lambda r: r["record_id"])


def session_records(es, session_id):
    return [r for r in (es or {}).get("records", {}).values() if (r.get("envelope") or {}).get("session_id") == session_id]


def current_record(es, rtype, session_id, **match):
    """Deterministic CURRENT selection: among records of `rtype` in `session_id` (plus extra field matches) the highest
    envelope.sequence wins; two distinct records sharing the highest sequence => AMBIGUOUS; a record older than
    MAX_OBSERVATION_AGE_S relative to es.evaluated_at is STALE. Map/array order never matters."""
    cands = [r for r in find_records(es, rtype, **match) if (r.get("envelope") or {}).get("session_id") == session_id]
    if not cands:
        return None, "NONE"
    top = max(r["envelope"]["sequence"] for r in cands)
    winners = [r for r in cands if r["envelope"]["sequence"] == top]
    if len(winners) > 1:
        return None, "AMBIGUOUS"
    w = winners[0]
    ev = parse_ts(es.get("evaluated_at"))
    ca = parse_ts(w["envelope"].get("captured_at"))
    if ev and ca and (ev - ca).total_seconds() > MAX_OBSERVATION_AGE_S:
        return None, "STALE"
    if ev and ca and (ca - ev).total_seconds() > 60:
        return None, "FUTURE"
    return w, "CURRENT"


def session_order_errors(es, session_id):
    """Within one session, captured_at must be non-decreasing with envelope.sequence per record type (a later sequence may
    never carry an earlier capture time). Equal sequences are resolved by current_record: two distinct candidates sharing the
    highest sequence are AMBIGUOUS (CONFLICT)."""
    errs = []
    recs = session_records(es, session_id)
    by_type = {}
    for r in recs:
        by_type.setdefault(r["record_type"], []).append(r)
    for rt, rs in by_type.items():
        rs = sorted(rs, key=lambda r: (r["envelope"]["sequence"], r["record_id"]))
        prev = None
        for r in rs:
            ts = parse_ts(r["envelope"]["captured_at"])
            if prev is not None and ts is not None and prev[1] is not None and ts < prev[1] and r["envelope"]["sequence"] > prev[0]:
                errs.append(f"{rt}: captured_at decreases while sequence increases")
            prev = (r["envelope"]["sequence"], ts)
    return errs


def resolve_ref(es, ref, expected_type, envelope=None, extra=None, active=None):
    """A ref is evidence only if it is a sha256, exists, has the expected type, re-hashes, binds to the active authority,
    and matches the required envelope/extra fields."""
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
    env = rec.get("envelope") or {}
    if active is not None and (env.get("manifest_sha256") != active.get("manifest_sha256") or env.get("authority_version") != active.get("authority_version")):
        errs.append(f"{expected_type}: record {ref[:12]} not bound to the active authority")
    for k, v in (envelope or {}).items():
        if env.get(k) != v:
            errs.append(f"{expected_type}: record {ref[:12]} envelope.{k}={env.get(k)!r} != {v!r}")
    for k, v in (extra or {}).items():
        if rec.get(k) != v:
            errs.append(f"{expected_type}: record {ref[:12]} {k}={rec.get(k)!r} != {v!r}")
    return (rec if not errs else None), errs


# ------------------------------------------------------------------ attachment state DERIVED from a coherent, current evidence set
def _contract_env(tc):
    return {"host_name": tc["host"]["name"], "product": tc["resolve"]["product"], "resolve_version": f"{tc['resolve']['version']}.{tc['resolve']['build']:04d}", "build": tc["resolve"]["build"], "library_name": tc["library"]["name"]}


def derive_attachment_state(tc, es, active):
    """Never trusts a declared state; never depends on record order. Returns {state, proofs, failures, conflicts, session_id}."""
    out = {"state": "UNPROVISIONED", "proofs": {}, "failures": [], "conflicts": [], "session_id": None}
    ev_errs = validate_evidence_set(es, active)
    if ev_errs:
        out.update(state=CONFLICT_STATE, failures=["EVIDENCE_SET_INVALID"] + ev_errs[:4])
        return out
    C = _contract_env(tc)
    lib = tc["library"]
    if lib["name"] in lib.get("prohibited_library_names", []):
        out["failures"].append("contract library is a prohibited library")
        return out
    provs = [r for r in find_records(es, "PROVISIONING_RECORD", **{"env.host_name": C["host_name"], "env.library_name": lib["name"]}) if r.get("library_kind") == "Disk" and r.get("provisioned_by") and is_uuid(r.get("instance_uuid")) and is_abs_path(r.get("root_path")) and r["envelope"].get("library_uuid") == r["instance_uuid"] and r["envelope"].get("library_root") == r["root_path"]]
    if not provs:
        out["failures"].append("no valid PROVISIONING_RECORD for contract host/library (Disk, uuid, absolute root, provisioned_by, envelope == body)")
        return out
    idents = {(r["instance_uuid"], r["root_path"]) for r in provs}
    if len(idents) > 1:
        out.update(state=CONFLICT_STATE, conflicts=["multiple PROVISIONING_RECORDs with different uuid/root for the contract library"])
        return out
    prov = provs[0]
    out["proofs"]["provisioning"] = prov["record_id"]
    out["state"] = "PROVISIONED_NOT_VERIFIED"
    bundles = [r for r in find_records(es, "BUNDLE_VERIFICATION", **{"env.host_name": C["host_name"]}) if r.get("historical") is not True and r["envelope"].get("manifest_sha256") == active["manifest_sha256"] and r["envelope"].get("authority_version") == active["authority_version"] and r.get("manifest_sha256") == active["manifest_sha256"] and r.get("authority_version") == active["authority_version"] and r.get("verifier") and r.get("verifier") != r.get("prepared_by")]
    if not bundles:
        out["failures"].append("no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host")
    sid = es.get("current_session_id")
    out["session_id"] = sid
    launch = None
    if sid is None:
        out["failures"].append("no current_session_id")
    else:
        ls = [r for r in find_records(es, "LAUNCH_RECIPE", **{"env.session_id": sid, "env.host_name": C["host_name"]}) if is_sha(r.get("recipe_sha256")) and r.get("resolve_version") == C["resolve_version"] and r.get("resolve_binary_sha256") == tc["resolve"]["pins"].get("/opt/resolve/bin/resolve") and r.get("external_scripting_preference") == "Local" and r["envelope"].get("provisioning_id") == prov["record_id"] and r["envelope"].get("library_uuid") == prov["instance_uuid"] and r["envelope"].get("library_root") == prov["root_path"] and r["envelope"].get("library_name") == lib["name"]]
        if len(ls) > 1 and len({r["record_id"] for r in ls}) > 1:
            out.update(state=CONFLICT_STATE, conflicts=["multiple LAUNCH_RECIPEs for the current session"])
            return out
        launch = ls[0] if ls else None
        if launch is None:
            out["failures"].append("no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting")
    if out["failures"]:
        return out
    out["proofs"]["bundle_verification"] = bundles[0]["record_id"]
    out["proofs"]["launch_recipe"] = launch["record_id"]
    # coherence of everything in the current session with the contract, the provisioning record and each other
    srecs = session_records(es, sid)
    conf = envelope_conflicts(srecs)
    for r in srecs:
        e = r["envelope"]
        for k in ("host_name", "product", "resolve_version", "build", "library_name"):
            if e.get(k) is not None and e.get(k) != C[k] and k not in conf:
                conf.append(k)
        if e.get("library_uuid") not in (None, prov["instance_uuid"]) and "library_uuid" not in conf:
            conf.append("library_uuid")
        if e.get("library_root") not in (None, prov["root_path"]) and "library_root" not in conf:
            conf.append("library_root")
        if e.get("provisioning_id") not in (None, prov["record_id"]) and "provisioning_id" not in conf:
            conf.append("provisioning_id")
    conf += session_order_errors(es, sid)
    fatal = [r for r in srecs if r["record_type"] == "CAPABILITY_EVIDENCE" and (r.get("result") or {}).get("classification") == "FATAL_TARGET_FAILURE"]
    if fatal:
        conf.append("FATAL_TARGET_FAILURE recorded in the current session: " + ",".join(sorted({(r.get("result") or {}).get("code", "?") for r in fatal})))
    if conf:
        out.update(state=CONFLICT_STATE, conflicts=conf)
        return out
    out["state"] = "ATTACHMENT_READY"
    conn, status = current_record(es, "CONNECTION_OBSERVATION", sid)
    if status == "AMBIGUOUS":
        out.update(state=CONFLICT_STATE, conflicts=["two CONNECTION_OBSERVATIONs share the highest sequence in the current session"])
        return out
    if status in ("STALE", "FUTURE"):
        out["failures"].append(f"latest CONNECTION_OBSERVATION is {status}")
        return out
    if conn is None:
        out["failures"].append("no CONNECTION_OBSERVATION in the current session")
        return out
    cf = []
    if conn.get("db_type") != "Disk":
        cf.append(f"observed db_type {conn.get('db_type')} is not Disk")
    if conn.get("db_name") != lib["name"]:
        cf.append(f"observed database {conn.get('db_name')!r} != contract library")
    if conn.get("db_name") in lib.get("prohibited_library_names", []):
        cf.append("observed database is a prohibited (shared/user) library")
    if conn.get("product") != C["product"] or conn.get("resolve_version") != C["resolve_version"]:
        cf.append(f"observed product/version {conn.get('product')} {conn.get('resolve_version')} != contract")
    if conn.get("root_path") != prov["root_path"]:
        cf.append("observed library root differs from provisioning record (or missing)")
    if conn.get("instance_uuid") != prov["instance_uuid"]:
        cf.append("observed library uuid differs from provisioning record (or missing)")
    if cf:
        out["failures"].append("OBSERVED_TARGET_MISMATCH: " + "; ".join(cf))
        return out
    out["proofs"]["connection"] = conn["record_id"]
    out["state"] = "ATTACHED_READ_ONLY"
    auth = [r for r in find_records(es, "M3_AUTHORIZATION", **{"env.host_name": C["host_name"]}) if r.get("scope") == "SCRATCH_QUALIFICATION_LIBRARY" and r.get("approver") and r.get("authority_version") == active["authority_version"] and r.get("library_name") == lib["name"]]
    excl, est = current_record(es, "EXCLUSIVE_SESSION_ATTESTATION", sid)
    refz = [r for r in find_records(es, "REFREEZE_RECORD") if r.get("reviewed") is True and r.get("kind") == "M0_READ_REQUALIFICATION" and r.get("authority_version") == active["authority_version"] and r.get("capability_matrix_sha256") == active.get("capability_matrix_sha256")]
    wf = []
    if not auth:
        wf.append("no M3_AUTHORIZATION for scratch scope under the active authority")
    if excl is None or not excl.get("attested_by"):
        wf.append(f"no current EXCLUSIVE_SESSION_ATTESTATION ({est})")
    if not refz:
        wf.append("no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix")
    if wf:
        out["failures"] = wf
        return out
    out["proofs"].update({"m3_authorization": auth[0]["record_id"], "exclusive_session": excl["record_id"], "m0_requalification": refz[0]["record_id"]})
    out["state"] = "SCRATCH_WRITE_READY"
    return out


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
    if set(tc.get("attachment_states", {})) != set(ATTACHMENT_STATES) | {CONFLICT_STATE}:
        errs.append("attachment_states must enumerate the five ladder states and CONFLICT")
    return errs


# ------------------------------------------------------------------ capability authority: qualified vs probe-allowed
def primitive_status(caps, rp_entry, method, es, env, active):
    """QUALIFIED_CALLABLE only when the ACTIVE capability matrix row is QUALIFIED_READ, its evidence_records entry for this method
    links (method, probe_id, raw_evidence_sha256) to a CAPABILITY_EVIDENCE record in the evidence set that is a SUCCESS observation
    on the exact host/product/version/build with the expected receiver, reviewed + ACCEPTed, promoted by the active refreeze
    (authority_version + capability_matrix_sha256), and whose raw evidence exists and re-hashes. PROBE_ALLOWED when the read-primitive
    entry flags it and the row is probe_candidate. Otherwise UNQUALIFIED."""
    row = next((r for r in caps["rows"] if method in r["primitives"]), None)
    if row is None:
        return "UNKNOWN_METHOD"
    if row["evidence_class"] == "QUALIFIED_READ":
        for x in row.get("evidence_records", []):
            if x.get("method") != method or x.get("version_match") is not True or not x.get("reviewed_refreeze_version") or not is_sha(x.get("raw_evidence_sha256")) or not x.get("probe_id"):
                continue
            for rec in find_records(es, "CAPABILITY_EVIDENCE", method=method, probe_id=x["probe_id"], raw_evidence_sha256=x["raw_evidence_sha256"]):
                if capability_record_qualifies(rec, rp_entry, env, active, es):
                    return "QUALIFIED_CALLABLE"
        return "UNQUALIFIED"
    if rp_entry is not None and rp_entry.get("probe_allowed") is True and row.get("probe_candidate") is True:
        return "PROBE_ALLOWED"
    return "UNQUALIFIED"


def capability_record_qualifies(rec, rp_entry, env, active, es):
    e = rec.get("envelope") or {}
    res = rec.get("result") or {}
    q = rec.get("qualification") or {}
    pb = q.get("promoted_by") or {}
    if not (e.get("host_name") == env["host_name"] and e.get("product") == env["product"] and e.get("resolve_version") == env["resolve_version"] and e.get("build") == env["build"]):
        return False
    if rp_entry is not None and rec.get("receiver_type") != rp_entry.get("receiver"):
        return False
    if not (res.get("classification") == "SUCCESS" and res.get("success") is True):
        return False
    if not (q.get("reviewed") is True and q.get("decision") == "ACCEPT"):
        return False
    if pb.get("authority_version") != active.get("authority_version") or pb.get("capability_matrix_sha256") != active.get("capability_matrix_sha256"):
        return False
    if rec.get("probe_authority_version") is None or not isinstance(rec.get("parsed_observation"), dict):
        return False
    raws = [r for r in find_records(es, "RAW_EVIDENCE", content_sha256=rec.get("raw_evidence_sha256")) if sha256_text(r.get("content", "")) == r.get("content_sha256")]
    return bool(raws)


def classify_probe_failure(code):
    for cls, codes in PROBE_FAILURE_TAXONOMY.items():
        if code in codes:
            return cls
    return "UNCLASSIFIED"


def semantic_capability_record(rec):
    """Structural/semantic law for one CAPABILITY_EVIDENCE record (independent of qualification)."""
    errs = []
    res = rec.get("result") or {}
    q = rec.get("qualification") or {}
    cls = res.get("classification")
    if cls == "SUCCESS":
        if res.get("success") is not True or res.get("code") is not None:
            errs.append("SUCCESS requires success:true and code:null")
    elif cls in ("CAPABILITY_FAILURE", "FATAL_TARGET_FAILURE"):
        if res.get("success") is not False:
            errs.append(f"{cls} requires success:false")
        if classify_probe_failure(res.get("code")) != cls:
            errs.append(f"code {res.get('code')} does not belong to {cls}")
        if q.get("decision") == "ACCEPT":
            errs.append("a failed observation can never be ACCEPTed")
    else:
        errs.append(f"unknown classification {cls}")
    if q.get("reviewed") is False and (q.get("decision") is not None or q.get("promoted_by") is not None):
        errs.append("unreviewed candidate cannot carry a decision or promotion")
    if q.get("decision") == "ACCEPT" and not isinstance(q.get("promoted_by"), dict):
        errs.append("ACCEPT requires promoted_by {authority_version, capability_matrix_sha256}")
    return errs


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


def _target_binding(request, tc, es, requirement, need_ids, derived):
    """PROJECT/PROJECT_TIMELINE are proven by CURRENT binding observations of the current session, coherent with the
    provisioning record; never by whatever project/timeline is active."""
    errs = []
    if requirement == "SESSION":
        return errs
    sid = derived.get("session_id")
    prov_id = derived["proofs"].get("provisioning")
    if sid is None or prov_id is None:
        return ["no current session/provisioning to bind a project to"]
    pname = request.get("expected_project_name")
    if not pname:
        return ["target requirement PROJECT: expected_project_name missing"]
    pb, st = current_record(es, "PROJECT_BINDING_OBSERVATION", sid, project_name=pname)
    if pb is None:
        errs.append(f"no CURRENT PROJECT_BINDING_OBSERVATION for expected project {pname!r} in the current session ({st})")
    else:
        e = pb["envelope"]
        if e.get("library_name") != tc["library"]["name"] or e.get("provisioning_id") != prov_id or e.get("project_name") != pname:
            errs.append("project binding observation is not bound to the contract library / provisioning / expected project")
    prefixed = pname.startswith(tc["naming"]["project_prefix"])
    if not prefixed and not [r for r in find_records(es, "OPERATOR_PROVISIONED_PROJECT", project_name=pname) if r["envelope"].get("library_name") == tc["library"]["name"]]:
        errs.append(f"project {pname!r} is neither adapter-prefixed nor operator-provisioned in the contract library")
    if need_ids and pb and (pb.get("project_unique_id_status") != "OBSERVED" or not pb.get("project_unique_id")):
        errs.append("write-capable target requires OBSERVED project_unique_id")
    if requirement == "PROJECT_TIMELINE":
        tname = request.get("expected_timeline_name")
        if not tname:
            return errs + ["target requirement PROJECT_TIMELINE: expected_timeline_name missing"]
        tb, st2 = current_record(es, "TIMELINE_BINDING_OBSERVATION", sid, project_name=pname, timeline_name=tname)
        if tb is None:
            errs.append(f"no CURRENT TIMELINE_BINDING_OBSERVATION for {pname!r}/{tname!r} in the current session ({st2})")
        else:
            e = tb["envelope"]
            if e.get("library_name") != tc["library"]["name"] or e.get("provisioning_id") != prov_id or e.get("project_name") != pname or e.get("timeline_name") != tname:
                errs.append("timeline binding observation is not bound to the same library / provisioning / project / timeline")
            if pb and pb.get("project_unique_id") and tb.get("project_unique_id") not in (None, pb.get("project_unique_id")):
                errs.append("timeline binding names a different project id than the project binding")
            if need_ids and (tb.get("timeline_unique_id_status") != "OBSERVED" or not tb.get("timeline_unique_id")):
                errs.append("write-capable target requires OBSERVED timeline_unique_id")
    return errs


def evaluate_eligibility(perms, request, rp, caps, tc, es, active):
    """Deterministic, fail-closed, order-independent. Attachment state, primitive qualification and every prerequisite
    are DERIVED from (tc, caps, rp, perms, evidence set, active authority); the request carries names and sha256 refs only."""
    out = {"permitted_by_policy": False, "prerequisites_satisfied": False, "eligible": False, "failed_prerequisites": [], "reason_codes": [], "derived_attachment_state": None, "target_requirement": None, "expanded_primitives": [], "attachment_conflicts": []}
    m, op, sc = request.get("milestone"), request.get("operation"), request.get("scope")
    look = permission_lookup(perms, m, op, sc)
    if not look["allowed"]:
        out["reason_codes"].append("NOT_PERMITTED_BY_POLICY:" + look["reason"])
        return out
    entry = look["entry"]
    out["permitted_by_policy"] = True
    derived = derive_attachment_state(tc, es, active)
    out["derived_attachment_state"] = derived["state"]
    out["attachment_conflicts"] = derived["conflicts"]
    if derived["state"] == CONFLICT_STATE:
        out["reason_codes"] += ["ATTACHMENT_CONFLICT"] + derived["failures"][:2] + derived["conflicts"][:3]
        return out
    rp_op = (rp or {}).get("logical_operations", {}).get(op)
    requirement = entry.get("target_requirement") or (rp_op or {}).get("target_requirement")
    out["target_requirement"] = requirement
    if requirement not in TARGET_REQUIREMENTS:
        out["reason_codes"].append("OPERATION_WITHOUT_TARGET_REQUIREMENT")
        return out
    C = _contract_env(tc)
    refs = request.get("refs") or {}
    sid = derived.get("session_id")
    failed = []
    rank = STATE_RANK[derived["state"]]
    codes = list(entry.get("prerequisites", []))
    if "TARGET_REQUIREMENT_SATISFIED" not in codes:
        codes.append("TARGET_REQUIREMENT_SATISFIED")
    for code in codes:
        if code not in PREREQ_CODES:
            failed.append(f"UNKNOWN_PREREQUISITE_CODE:{code}")
            continue
        ok, why = False, ""
        if code == "BUNDLE_INDEPENDENTLY_VERIFIED":
            ok = "bundle_verification" in derived["proofs"]
        elif code.startswith("TARGET_STATE_"):
            ok = rank >= STATE_RANK[code[len("TARGET_STATE_"):]]; why = "; ".join(derived["failures"])
        elif code == "HOST_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"]
        elif code == "LIBRARY_NOT_SHARED":
            ok = tc["library"]["name"] not in tc["library"]["prohibited_library_names"] and not any("prohibited" in f for f in derived["failures"])
        elif code == "LIBRARY_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"] and not any("OBSERVED_TARGET_MISMATCH" in f for f in derived["failures"])
        elif code == "RESOLVE_VERSION_MATCHES":
            ok = "connection" in derived["proofs"]
        elif code in ("M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE"):
            rec, e = resolve_ref(es, refs.get(code[:2].lower() + "_exit"), "MILESTONE_EXIT", {"host_name": C["host_name"]}, {"milestone": code[:2], "authority_version": active["authority_version"]}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "MIKKO_M3_AUTHORIZATION":
            rec, e = resolve_ref(es, refs.get("authorization"), "M3_AUTHORIZATION", {"host_name": C["host_name"]}, {"scope": "SCRATCH_QUALIFICATION_LIBRARY", "authority_version": active["authority_version"], "library_name": tc["library"]["name"]}, active); ok = rec is not None and bool(rec.get("approver")); why = "; ".join(e)
        elif code == "JOURNAL_PREPARED":
            rec, e = resolve_ref(es, refs.get("journal_prepared"), "JOURNAL_PREPARED", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name")}, {"transaction_id": request.get("transaction_id"), "plan_digest": request.get("plan_digest")}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "READ_ONLY_JOURNAL_OPEN":
            rec, e = resolve_ref(es, refs.get("read_only_journal"), "READ_ONLY_JOURNAL", {"host_name": C["host_name"], "session_id": sid}, None, active); ok = rec is not None; why = "; ".join(e)
        elif code == "GUARD_CURRENT":
            rec, e = resolve_ref(es, refs.get("guard"), "GUARD_SNAPSHOT", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, None, active)
            ok = rec is not None and is_sha(request.get("plan_h0_guard_digest")) and rec.get("guard_digest") == request.get("plan_h0_guard_digest"); why = "; ".join(e) or "guard digest mismatch"
            if ok:
                cur, st = current_record(es, "GUARD_SNAPSHOT", sid, project_name=request.get("expected_project_name"), timeline_name=request.get("expected_timeline_name"))
                ok = cur is not None and cur["record_id"] == rec["record_id"]; why = f"guard record is not the CURRENT guard observation ({st})"
        elif code == "EXCLUSIVE_SESSION_ATTESTED":
            rec, e = resolve_ref(es, refs.get("exclusive_session"), "EXCLUSIVE_SESSION_ATTESTATION", {"host_name": C["host_name"], "session_id": sid}, None, active); ok = rec is not None and bool(rec.get("attested_by")); why = "; ".join(e)
        elif code == "PROJECT_ADAPTER_PREFIXED":
            ok = str(request.get("expected_project_name", "")).startswith(tc["naming"]["project_prefix"])
        elif code == "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED":
            exp = []
            for p in (rp_op or {}).get("primitives", []):
                st = primitive_status(caps, p, p["method"], es, C, active)
                exp.append({"method": p["method"], "status": st, "callable": st == "QUALIFIED_CALLABLE", "fallback": p.get("fallback_if_unqualified")})
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] or x["fallback"] in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE") for x in exp)
            why = "REFUSE fallback on unqualified primitive(s): " + ",".join(x["method"] for x in exp if not x["callable"] and x["fallback"] == "REFUSE")
        elif code == "PROBE_ALLOWED_PRIMITIVES":
            exp = []
            for p in (rp_op or {}).get("primitives", []):
                st = primitive_status(caps, p, p["method"], es, C, active)
                exp.append({"method": p["method"], "status": st, "callable": st in ("PROBE_ALLOWED", "QUALIFIED_CALLABLE"), "fallback": "PROBE_ONLY"})
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] for x in exp) and (rp_op or {}).get("purpose_is_qualification") is True and (rp_op or {}).get("read_only") is True
        elif code == "PLAN_VALIDATED":
            rec, e = resolve_ref(es, refs.get("plan_validation"), "PLAN_VALIDATION", {"host_name": C["host_name"]}, {"plan_digest": request.get("plan_digest"), "result": "PASS", "authority_version": active["authority_version"]}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "SYNTHETIC_MEDIA_ONLY":
            rec, e = resolve_ref(es, refs.get("media_class"), "MEDIA_CLASS_ATTESTATION", {"host_name": C["host_name"]}, {"media_class": "SYNTHETIC"}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "TIMELINE_IS_DESTINATION":
            rec, e = resolve_ref(es, refs.get("destination_timeline"), "DESTINATION_TIMELINE", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, {"project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "TARGET_REQUIREMENT_SATISFIED":
            e = _target_binding(request, tc, es, requirement, bool(entry.get("mutation_allowed")), derived); ok = not e; why = "; ".join(e)
        if not ok:
            failed.append(code + (f" ({why})" if why else ""))
    out["failed_prerequisites"] = failed
    out["prerequisites_satisfied"] = not failed
    out["eligible"] = out["permitted_by_policy"] and not failed
    out["reason_codes"].append("ELIGIBLE" if out["eligible"] else "PREREQUISITES_FAILED")
    return out


# ------------------------------------------------------------------ snapshot observation model, completeness, capability coupling
def _status_value_errors(prefix, status, value, reason):
    if status not in OBS_STATUS:
        return [f"{prefix}: unknown status {status!r}"]
    errs = []
    if status == "OBSERVED" and value is None:
        errs.append(f"{prefix}: status OBSERVED but value null")
    if status != "OBSERVED" and value is not None:
        errs.append(f"{prefix}: status {status} but value present (fabrication)")
    if status in ("UNAVAILABLE", "ERROR") and not reason:
        errs.append(f"{prefix}: status {status} requires a reason")
    return errs


def _observed_needs_callable(prefix, key, fs, callable_methods, errs):
    if callable_methods is None:
        return
    for fld, methods in FIELD_PRIMITIVE.items():
        if not fld.startswith(key + "."):
            continue
        name = fld.split(".", 1)[1]
        if fs.get(name) == "OBSERVED" and not all(m in callable_methods for m in methods):
            errs.append(f"{prefix}.{name}: OBSERVED but producing primitive(s) {methods} not callable in this session")


def semantic_snapshot(snap, callable_methods=None):
    """callable_methods: set of QUALIFIED_CALLABLE methods derived from the active capability authority + evidence set;
    when given, no field may be OBSERVED unless its producing primitive was callable (capability -> coverage coupling)."""
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
    proj, tl = snap["project"], snap["payload"]["timeline"]
    pfs, tfs = proj.get("field_status") or {}, tl.get("field_status") or {}
    for f in PROJECT_STATUS_FIELDS:
        errs += _status_value_errors(f"project.{f}", pfs.get(f), proj.get(f), pfs.get(f + "_reason"))
    for f in TIMELINE_STATUS_FIELDS:
        errs += _status_value_errors(f"timeline.{f}", tfs.get(f), tl.get(f), tfs.get(f + "_reason"))
    _observed_needs_callable("project", "project", pfs, callable_methods, errs)
    _observed_needs_callable("timeline", "timeline", tfs, callable_methods, errs)
    if tfs.get("start_frame") == "OBSERVED" and tfs.get("end_frame") == "OBSERVED" and tl.get("end_frame") is not None and tl.get("start_frame") is not None and tl["end_frame"] < tl["start_frame"]:
        errs.append("timeline end_frame < start_frame")
    conv = tl.get("duration_convention")
    if conv not in ("UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"):
        errs.append("timeline.duration_convention missing")
    unresolved_tl = {f for f in prof["mandatory_timeline_fields"] if tfs.get(f) != "OBSERVED"}
    unresolved_items = set()
    unresolved_locks = False
    declared_ps = (snap.get("collection") or {}).get("primitive_status") or {}
    if callable_methods is not None:
        for mth, st in declared_ps.items():
            if st == "QUALIFIED_CALLABLE" and mth not in callable_methods:
                errs.append(f"collection.primitive_status claims {mth} callable but the active authority does not qualify it")
        for d in obs & set(DOMAIN_PRIMITIVE):
            if not all(m in callable_methods for m in DOMAIN_PRIMITIVE[d]):
                errs.append(f"domain {d} observed but producing primitive(s) {DOMAIN_PRIMITIVE[d]} not callable")
    for t in snap["payload"]["tracks"]:
        trfs = t.get("field_status") or {}
        for f in TRACK_STATUS_FIELDS:
            errs += _status_value_errors(f"track[{t.get('type')}:{t.get('index')}].{f}", trfs.get(f), t.get(f), trfs.get(f + "_reason"))
        _observed_needs_callable(f"track[{t.get('type')}:{t.get('index')}]", "track", trfs, callable_methods, errs)
        if trfs.get("locked") != "OBSERVED" and prof["track_locks_required"]:
            unresolved_locks = True
        for it in t["items"]:
            fs = it["field_status"]
            pre = f"item[{t.get('type')}:{t.get('index')}#{it.get('observation_ordinal')}]"
            for fld in ITEM_STATUS_FIELDS:
                errs += _status_value_errors(f"{pre}.{fld}", fs.get(fld), it.get(fld), fs.get(fld + "_reason"))
                if fld in prof["mandatory_item_fields"] and fs.get(fld) != "OBSERVED":
                    unresolved_items.add(fld)
            _observed_needs_callable(pre, "item", fs, callable_methods, errs)
            if fs.get("start") == "OBSERVED" and fs.get("end") == "OBSERVED" and it.get("start") is not None and it.get("end") is not None:
                try:
                    s, e = _num(it["start"]), _num(it["end"])
                    if e < s:
                        errs.append(f"{pre}: end < start")
                    if fs.get("duration") == "OBSERVED" and it.get("duration") is not None:
                        d = _num(it["duration"])
                        if conv == "END_EXCLUSIVE" and d != e - s:
                            errs.append(f"{pre}: duration inconsistent with END_EXCLUSIVE convention")
                        elif conv == "END_INCLUSIVE" and d != e - s + 1:
                            errs.append(f"{pre}: duration inconsistent with END_INCLUSIVE convention")
                        elif conv == "UNQUALIFIED" and d not in (e - s, e - s + 1):
                            errs.append(f"{pre}: duration inconsistent with both candidate conventions")
                except CanonError as ce:
                    errs.append(f"{pre}: {ce}")
            if fs.get("source_start") == "OBSERVED" and fs.get("source_end") == "OBSERVED" and it.get("source_start") is not None and it.get("source_end") is not None and _num(it["source_end"]) < _num(it["source_start"]):
                errs.append(f"{pre}: source_end < source_start")
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
    ident = {"project.unique_id": pfs.get("unique_id"), "timeline.unique_id": tfs.get("unique_id")}
    if cov["complete"]:
        if not obs:
            errs.append("complete:true with empty observed_domains")
        if not mandatory <= obs:
            errs.append(f"complete:true but mandatory domains not observed: {sorted(mandatory - obs)}")
        if unresolved_items:
            errs.append(f"complete:true under {cov['profile']} with unresolved item fields {sorted(unresolved_items)}")
        if unresolved_tl:
            errs.append(f"complete:true under {cov['profile']} with unresolved timeline fields {sorted(unresolved_tl)}")
        for k in prof["identity_required"]:
            if ident[k] != "OBSERVED":
                errs.append(f"complete:true under {cov['profile']} but {k} not OBSERVED")
        if prof["track_locks_required"] and unresolved_locks:
            errs.append("complete:true under WRITE_PRECHECK with unresolved track locks")
        if prof["guard_required"] and not is_sha(snap.get("guard_digest")):
            errs.append("complete:true under WRITE_PRECHECK without guard")
        if snap["payload"].get("observation_failures"):
            errs.append("complete:true with observation_failures present")
        if cov.get("incomplete_reasons"):
            errs.append("complete:true with incomplete_reasons listed")
    else:
        if not cov.get("incomplete_reasons"):
            errs.append("complete:false must list incomplete_reasons")
        degraded_levels = [v for fs_ in [tfs, pfs] + [t.get("field_status") or {} for t in snap["payload"]["tracks"]] for v in fs_.values() if v in ("UNAVAILABLE", "UNSUPPORTED", "ERROR")]
        unresolved_identity = any(ident[k] != "OBSERVED" for k in prof["identity_required"])
        if not (unob or deff or (mandatory - obs) or unresolved_items or unresolved_tl or unresolved_identity or (prof["track_locks_required"] and unresolved_locks) or snap["payload"].get("observation_failures") or degraded_levels):
            errs.append("complete:false must name missing domains/fields (profile-mandatory gaps, degraded timeline/project/track fields or a failure ledger)")
    try:
        if snapshot_payload_digest(snap["payload"]) != snap["payload_sha256"]:
            errs.append("payload_sha256 does not match canonical payload")
        if guard_digest(snap) != snap["guard_digest"]:
            errs.append("guard_digest does not match guard object")
    except CanonError as e:
        errs.append(f"canonicalization error: {e}")
    return errs


def snapshot_result_class(snap):
    """INCOMPLETE / NOT_QUALIFIED vs COMPLETE: a snapshot never claims complete authority when its profile's requirements fail."""
    errs = semantic_snapshot(snap)
    if errs:
        return "INVALID"
    return "COMPLETE" if snap["coverage"]["complete"] else "INCOMPLETE_NOT_QUALIFIED"


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
    rf = caps.get("refreeze") or {}
    for r in caps["rows"]:
        if r["evidence_class"] == "QUALIFIED_READ":
            recs = [x for x in r.get("evidence_records", []) if x.get("version_match") is True and x.get("resolve_version") == contract_version and x.get("build") == contract_build and x.get("method") in r["primitives"] and is_sha(x.get("evidence_sha256")) and is_sha(x.get("raw_evidence_sha256")) and x.get("probe_id") and x.get("reviewed_refreeze_version") == caps.get("version") and x.get("result") == "SUCCESS"]
            if not recs:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ without exact reviewed SUCCESS version-matched evidence record promoted by this matrix version")
            if rf.get("kind") != "M0_READ_REQUALIFICATION" or rf.get("reviewed") is not True:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ requires a reviewed refreeze block on the matrix")
        for x in r.get("evidence_records", []):
            for k in ("host", "resolve_version", "run_ref", "method", "observed_result", "evidence_path"):
                if not x.get(k):
                    errs.append(f"row '{r['operation']}': evidence record missing {k}")
            if x.get("version_match") is True and (x.get("resolve_version") != contract_version or x.get("build") != contract_build):
                errs.append(f"row '{r['operation']}': version_match true but version differs from contract")
            if x.get("result") == "SUCCESS" and x.get("reviewed_refreeze_version") and x.get("reviewed_refreeze_version") != caps.get("version"):
                errs.append(f"row '{r['operation']}': evidence promoted under another refreeze version")
        if r.get("probe_candidate") is True and r["evidence_class"] not in ("DOCUMENTED_NOT_QUALIFIED",):
            errs.append(f"row '{r['operation']}': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows")
    return errs


def semantic_read_primitives(rp, caps, perms=None):
    errs = []
    method_class, probe_rows = {}, {}
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
            if not p.get("receiver"):
                errs.append(f"{op}: primitive {p['method']} lacks receiver type")
        if op == "READ_PRIMITIVE_QUALIFICATION_PROBE":
            if not (spec.get("purpose_is_qualification") is True and spec.get("read_only") is True and spec.get("promotes_capability") is False):
                errs.append("probe operation must declare purpose_is_qualification, read_only and promotes_capability:false")
            tax = spec.get("failure_taxonomy") or {}
            if {k: sorted(v) for k, v in tax.items()} != {k: sorted(v) for k, v in PROBE_FAILURE_TAXONOMY.items()}:
                errs.append("probe failure_taxonomy differs from authority_lib.PROBE_FAILURE_TAXONOMY")
    if perms is not None:
        for e in perms["entries"]:
            spec = rp["logical_operations"].get(e["operation"])
            if spec and e.get("target_requirement") != spec.get("target_requirement"):
                errs.append(f"PERMISSIONS/{e['milestone']}/{e['operation']}: target_requirement differs from READ-PRIMITIVES")
    return errs


# ------------------------------------------------------------------ plan / journal / verification / conflict / commit (binding + membership + derived delta)
def plan_digest_of(plan):
    return digest({k: v for k, v in plan.items() if k not in ("plan_digest", "refs")}, "vidtoolz.resolveMutationPlan.v1")


def semantic_mutation_plan(plan, perms, rp, caps, tc, es, active, current_guard_digest=None):
    errs = []
    if plan.get("authority_version") != active["authority_version"]:
        errs.append("plan authority_version != active authority")
    if not is_sha(plan.get("plan_digest")) or not plan.get("transaction_id"):
        errs.append("plan lacks plan_digest/transaction_id")
    elif plan.get("plan_digest") != plan_digest_of(plan):
        errs.append("plan_digest does not match plan body digest")
    if plan.get("operation_set_digest") != operation_set_digest(plan.get("operations", [])):
        errs.append("operation_set_digest does not match operations")
    ids = [o.get("operation_id") for o in plan.get("operations", [])]
    if len(set(ids)) != len(ids) or not all(ids):
        errs.append("operation ids must be unique and non-empty")
    if plan.get("permission_class") == "RESOLVE_READ" and any(o["op"] in WRITE_OPS for o in plan["operations"]):
        errs.append("RESOLVE_READ permission class cannot carry write operations")
    tgt = plan.get("target") or {}
    for o in plan["operations"]:
        req = {"milestone": plan["milestone"], "operation": o["op"], "scope": plan["scope"], "expected_project_name": tgt.get("project_name"), "expected_timeline_name": tgt.get("timeline_name"), "refs": plan.get("refs") or {}, "transaction_id": plan.get("transaction_id"), "plan_digest": plan.get("plan_digest"), "plan_h0_guard_digest": plan.get("h0_guard_digest")}
        el = evaluate_eligibility(perms, req, rp, caps, tc, es, active)
        if not el["permitted_by_policy"]:
            errs.append(f"operation {o['op']} not permitted at {plan['milestone']}/{plan['scope']}: {el['reason_codes']}")
        elif not plan.get("dry_run") and not el["eligible"]:
            errs.append(f"operation {o['op']} not eligible: {el['failed_prerequisites'] or el['reason_codes']}")
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
            if o["op"] == "APPEND" and not (isinstance(o.get("expected_new"), dict) and "start" in o["expected_new"] and "end" in o["expected_new"]):
                errs.append("APPEND requires expected_new {start, end}")
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
OPERATION_BEARING_STATES = {"OP_STARTED", "APPLIED", "OP_FAILED"}
JOURNAL_TRANSITIONS = {
    None: {"PREPARED"},
    "PREPARED": {"LEASED", "CONFLICT", "NOT_APPLIED", "ABORTED", "RECOVERY_RECONCILING"},
    "LEASED": {"PREFLIGHT_OK", "CONFLICT", "ABORTED", "RECOVERY_RECONCILING"},
    "PREFLIGHT_OK": {"CHECKPOINTED", "OP_STARTED", "CONFLICT", "RECOVERY_RECONCILING"},
    "CHECKPOINTED": {"OP_STARTED", "CONFLICT", "RECOVERY_RECONCILING"},
    "OP_STARTED": {"APPLIED", "OP_FAILED", "RECOVERY_RECONCILING"},
    "APPLIED": {"OP_STARTED", "READBACK_S1", "RECOVERY_RECONCILING"},
    "OP_FAILED": {"RECOVERY_RECONCILING", "ABORTED"},
    "READBACK_S1": {"VERIFIED", "CONFLICT", "RECOVERY_RECONCILING"},
    "VERIFIED": {"SAVED", "RECOVERY_RECONCILING"},
    "SAVED": {"PUBLISHED", "RECOVERY_RECONCILING"},
    "PUBLISHED": {"COMMITTED", "RECOVERY_RECONCILING"},
    "RECOVERY_RECONCILING": {"NOT_APPLIED", "COMMITTED_RECOVERED", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS", "RECOVERY_RECONCILING"},
}


def semantic_journal(records, plan=None):
    """Chain, binding and OPERATION MEMBERSHIP: every operation-bearing record names an operation of the bound plan with the
    same op type; each op STARTED at most once, APPLIED at most once and only after its own OP_STARTED; READBACK_S1 only
    after every plan operation is APPLIED; non-operation records carry operation_id/op null."""
    errs = []
    if not records:
        return ["empty journal"]
    first = records[0]
    tx, pd, tgt, gd, osd = first.get("transaction_id"), first.get("plan_digest"), first.get("target_ref"), first.get("guard_digest"), first.get("operation_set_digest")
    plan_ops = {}
    if plan is not None:
        plan_ops = {o["operation_id"]: o for o in plan.get("operations", [])}
        if pd != plan.get("plan_digest"):
            errs.append("journal plan_digest != plan")
        if tx != plan.get("transaction_id"):
            errs.append("journal transaction_id != plan")
        if gd != plan.get("h0_guard_digest"):
            errs.append("journal guard_digest != plan h0_guard_digest")
        if osd != plan.get("operation_set_digest"):
            errs.append("journal operation_set_digest != plan")
        if tgt != {k: (plan.get("target") or {}).get(k) for k in ("project_unique_id", "timeline_unique_id", "library_instance_uuid")}:
            errs.append("journal target_ref != plan target")
    prev_state, prev_hash, expected_seq = None, None, 0
    started, applied = set(), set()
    for r in records:
        seq = r.get("sequence")
        if r.get("transaction_id") != tx:
            errs.append(f"seq {seq}: transaction_id changed mid-chain")
        if r.get("plan_digest") != pd:
            errs.append(f"seq {seq}: plan_digest changed mid-chain")
        if r.get("operation_set_digest") != osd:
            errs.append(f"seq {seq}: operation_set_digest changed mid-chain")
        if r.get("target_ref") != tgt:
            errs.append(f"seq {seq}: target_ref changed mid-chain")
        if r.get("guard_digest") != gd and r.get("state") != "RECOVERY_RECONCILING":
            errs.append(f"seq {seq}: guard_digest changed without a recovery transition")
        if seq != expected_seq:
            errs.append(f"seq {seq}: sequence not contiguous (expected {expected_seq})")
        expected_seq = (seq if isinstance(seq, int) else expected_seq) + 1
        if r.get("previous_record_sha256") != prev_hash:
            errs.append(f"seq {seq}: hash chain broken")
        st = r.get("state")
        if st not in JOURNAL_TRANSITIONS.get(prev_state, set()):
            errs.append(f"seq {seq}: illegal transition {prev_state} -> {st}")
        oid = r.get("operation_id")
        if st in OPERATION_BEARING_STATES:
            if oid is None:
                errs.append(f"seq {seq}: {st} without operation_id")
            elif plan is not None and oid not in plan_ops:
                errs.append(f"seq {seq}: operation_id {oid} is not in the bound plan operation set (journal invented an operation)")
            elif plan is not None and r.get("op") != plan_ops[oid]["op"]:
                errs.append(f"seq {seq}: op {r.get('op')} inconsistent with plan entry {plan_ops[oid]['op']}")
            if st == "OP_STARTED":
                if oid in started:
                    errs.append(f"seq {seq}: operation {oid} started twice")
                started.add(oid)
            elif st == "APPLIED":
                if oid in applied:
                    errs.append(f"seq {seq}: operation_id {oid} applied twice")
                if oid not in started:
                    errs.append(f"seq {seq}: APPLIED without a preceding OP_STARTED for {oid}")
                applied.add(oid)
        elif oid is not None or r.get("op") is not None:
            errs.append(f"seq {seq}: non-operation state {st} carries operation_id/op")
        if st == "READBACK_S1" and plan is not None and applied != set(plan_ops):
            errs.append(f"seq {seq}: READBACK_S1 before all plan operations applied (missing {sorted(set(plan_ops) - applied)})")
        if st == "RECOVERY_RECONCILING" and r.get("recovery_of_transaction_id") != tx:
            errs.append(f"seq {seq}: recovery record not linked to original transaction")
        if prev_state in TERMINAL_STATES:
            errs.append(f"seq {seq}: record after terminal state {prev_state}")
        prev_state = st
        prev_hash = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return errs


def journal_head(records):
    h = None
    for r in records:
        h = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return h


def journal_applied_ops(records):
    return sorted({r["operation_id"] for r in records if r.get("state") == "APPLIED" and r.get("operation_id")})


# ---- derived delta and expected effects
def _item_index(snap):
    idx = {}
    for t in snap["payload"]["tracks"]:
        for it in t["items"]:
            uid = it.get("unique_id")
            if it["field_status"].get("unique_id") != "OBSERVED" or not uid:
                return None
            idx[uid] = {"unique_id": uid, "track_type": t["type"], "track_index": t["index"], "start": it.get("start"), "end": it.get("end"), "enabled": it.get("enabled"), "media_pool_item_unique_id": it.get("media_pool_item_unique_id"), "name": it.get("name")}
    return idx


def derive_delta(s0, s1):
    """The verifier computes the delta from S0 and S1; callers never declare it."""
    i0, i1 = _item_index(s0), _item_index(s1)
    if i0 is None or i1 is None:
        return None
    added = sorted((i1[k] for k in set(i1) - set(i0)), key=lambda x: x["unique_id"])
    removed = sorted((i0[k] for k in set(i0) - set(i1)), key=lambda x: x["unique_id"])
    changed = []
    for k in sorted(set(i0) & set(i1)):
        diff = {f: {"before": i0[k][f], "after": i1[k][f]} for f in ("track_type", "track_index", "start", "end", "enabled", "media_pool_item_unique_id", "name") if i0[k][f] != i1[k][f]}
        if diff:
            changed.append({"unique_id": k, "fields": diff})
    m0 = {marker_sort_key(m): m for m in s0["payload"]["markers"]}
    m1 = {marker_sort_key(m): m for m in s1["payload"]["markers"]}
    markers_added = [m1[k] for k in sorted(set(m1) - set(m0))]
    markers_removed = [m0[k] for k in sorted(set(m0) - set(m1))]
    return {"added": added, "removed": removed, "changed": changed, "markers_added": markers_added, "markers_removed": markers_removed}


def _q(v):
    return _num(v) if v is not None else None


def expected_effects(plan):
    """Provisional expected-effect law per operation. Ops outside EFFECT_SPECIFIED_OPS have no derivable effect yet."""
    out = []
    for o in plan.get("operations", []):
        op, sel = o["op"], o.get("selector") or {}
        if op == "APPEND":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "ADDED_ITEM", "track_type": sel.get("track_type"), "track_index": sel.get("track_index"), "start": (o.get("expected_new") or {}).get("start"), "end": (o.get("expected_new") or {}).get("end"), "media_pool_item_unique_id": sel.get("expected_media_pool_item_unique_id")})
        elif op == "DELETE":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "REMOVED_ITEM", "unique_id": sel.get("item_unique_id")})
        elif op in ("DISABLE", "ENABLE"):
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "ENABLED_FLAG", "unique_id": sel.get("item_unique_id"), "after": op == "ENABLE"})
        elif op == "UPSERT_MARKER":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "MARKER_PRESENT", "custom_data": sel.get("expected_marker_custom_data")})
        else:
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "NOT_YET_SPECIFIED"})
    return out


def verify_transaction(plan, s0, s1, journal):
    """Derive the verification truth from S0, plan, journal and S1. Returns the derived verification body (no schema envelope)."""
    applied = set(journal_applied_ops(journal))
    delta = derive_delta(s0, s1)
    base = {"added": [], "removed": [], "changed": [], "creation_identity_map": {}, "missing_expected": [], "unrelated": [], "applied_operation_ids": sorted(applied)}
    if delta is None or not s0["coverage"]["complete"] or not s1["coverage"]["complete"]:
        base["verdict"] = "UNOBSERVABLE_STATE"
        base["missing_expected"] = ["S0/S1 incomplete or item identity unobserved"]
        return base
    base.update({"added": delta["added"], "removed": delta["removed"], "changed": delta["changed"]})
    unmatched_added = {a["unique_id"]: a for a in delta["added"]}
    unmatched_removed = {r["unique_id"] for r in delta["removed"]}
    unmatched_changed = {c["unique_id"]: c for c in delta["changed"]}
    unmatched_markers = {marker_sort_key(m): m for m in delta["markers_added"]}
    not_specified = False
    for ex in expected_effects(plan):
        oid = ex["operation_id"]
        if oid not in applied:
            base["missing_expected"].append(f"{oid}: not APPLIED in journal")
            continue
        if ex["kind"] == "ADDED_ITEM":
            hit = None
            for uid, a in sorted(unmatched_added.items()):
                if a["track_type"] == ex["track_type"] and a["track_index"] == ex["track_index"] and _q(a["start"]) == _q(ex["start"]) and _q(a["end"]) == _q(ex["end"]) and (ex["media_pool_item_unique_id"] is None or a["media_pool_item_unique_id"] == ex["media_pool_item_unique_id"]):
                    hit = uid
                    break
            if hit is None:
                base["missing_expected"].append(f"{oid}: APPEND produced no new occurrence on {ex['track_type']}:{ex['track_index']} [{ex['start']},{ex['end']}]")
            else:
                base["creation_identity_map"][oid] = hit
                unmatched_added.pop(hit)
        elif ex["kind"] == "REMOVED_ITEM":
            if ex["unique_id"] in unmatched_removed:
                unmatched_removed.discard(ex["unique_id"])
            else:
                base["missing_expected"].append(f"{oid}: DELETE target {ex['unique_id']} still present")
        elif ex["kind"] == "ENABLED_FLAG":
            c = unmatched_changed.get(ex["unique_id"])
            if c and set(c["fields"]) == {"enabled"} and c["fields"]["enabled"]["after"] is ex["after"]:
                unmatched_changed.pop(ex["unique_id"])
            else:
                base["missing_expected"].append(f"{oid}: {ex['op']} did not flip only the enabled flag of {ex['unique_id']}")
        elif ex["kind"] == "MARKER_PRESENT":
            k = next((k for k, m in unmatched_markers.items() if m.get("custom_data") == ex["custom_data"]), None)
            if k is None:
                base["missing_expected"].append(f"{oid}: marker with custom_data {ex['custom_data']!r} not added")
            else:
                unmatched_markers.pop(k)
        else:
            not_specified = True
            base["missing_expected"].append(f"{oid}: effect of {ex['op']} NOT_YET_SPECIFIED; cannot verify")
    base["unrelated"] += [f"added {u}" for u in sorted(unmatched_added)] + [f"removed {u}" for u in sorted(unmatched_removed)] + [f"changed {u}" for u in sorted(unmatched_changed)] + [f"marker added {m.get('custom_data')!r}@{m.get('frame')}" for m in unmatched_markers.values()] + [f"marker removed {m.get('custom_data')!r}@{m.get('frame')}" for m in delta["markers_removed"]]
    if not_specified:
        base["verdict"] = "EFFECT_NOT_SPECIFIED"
    elif base["missing_expected"]:
        base["verdict"] = "EXPECTED_DELTA_MISSING"
    elif base["unrelated"]:
        base["verdict"] = "UNEXPECTED_DELTA"
    else:
        base["verdict"] = "VERIFIED"
    return base


def guard_lineage_errors(s0, s1, plan=None):
    errs = []
    if s0["library"] != s1["library"]:
        errs.append("S1 library identity differs from S0")
    if s0["project"].get("unique_id") != s1["project"].get("unique_id") or s0["project"].get("name") != s1["project"].get("name"):
        errs.append("S1 project identity differs from S0")
    if s0["payload"]["timeline"].get("unique_id") != s1["payload"]["timeline"].get("unique_id"):
        errs.append("S1 timeline identity differs from S0")
    if s0["target_epoch"] != s1["target_epoch"]:
        errs.append("S1 target_epoch differs from S0")
    if plan is not None:
        tgt = plan.get("target") or {}
        if s0["guard_digest"] != plan.get("h0_guard_digest"):
            errs.append("S0 guard is not the plan's h0_guard_digest")
        if s0["library"].get("instance_uuid") != tgt.get("library_instance_uuid") or s0["project"].get("unique_id") != tgt.get("project_unique_id") or s0["payload"]["timeline"].get("unique_id") != tgt.get("timeline_unique_id") or s0["target_epoch"] != tgt.get("target_epoch"):
            errs.append("S0 identity differs from plan target")
    return errs


def semantic_verification_result(vr, plan=None, s0=None, s1=None, journal=None):
    """Declared lists are never authority: when S0/S1/journal are given the result must equal the derived truth."""
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
        if vr["verdict"] == "VERIFIED" and any(o["op"] not in EFFECT_SPECIFIED_OPS for o in plan.get("operations", [])):
            errs.append("VERIFIED claimed for an operation whose effect law is NOT_YET_SPECIFIED")
    if s0 is not None and s1 is not None:
        if vr.get("h0_payload_sha256") != s0.get("payload_sha256") or vr.get("h0_guard_digest") != s0.get("guard_digest"):
            errs.append("verification S0 digests do not resolve to the supplied S0 snapshot")
        if vr.get("s1_payload_sha256") != s1.get("payload_sha256") or vr.get("s1_guard_digest") != s1.get("guard_digest") or vr.get("readback_snapshot_sha256") != snapshot_object_digest(s1):
            errs.append("verification S1 digests do not resolve to the supplied S1 snapshot")
        errs += [f"lineage: {e}" for e in guard_lineage_errors(s0, s1, plan)]
        if plan is not None and journal is not None:
            derived = verify_transaction(plan, s0, s1, journal)
            for k in ("added", "removed", "changed", "creation_identity_map", "missing_expected", "unrelated", "verdict"):
                if canon(vr.get(k)) != canon(derived[k]):
                    errs.append(f"verification.{k} differs from derived truth (declared {canon(vr.get(k))[:80]} vs derived {canon(derived[k])[:80]})")
    return errs


def semantic_conflict(cf, plan=None):
    errs = []
    if cf.get("authority_effect") != "NONE_UNTIL_HUMAN_ADJUDICATION":
        errs.append("conflict must have no authority effect")
    if plan is not None and (cf.get("plan_digest") != plan.get("plan_digest") or cf.get("transaction_id") != plan.get("transaction_id")):
        errs.append("conflict not bound to this plan/transaction")
    return errs


def semantic_commit_manifest(cm, plan, journal_records, verification_result, conflicts, s0=None, s1=None, active=None):
    errs = []
    if plan is None or not journal_records or verification_result is None:
        return ["commit requires plan, journal and verification objects (not only their hashes)"]
    errs += [f"journal: {e}" for e in semantic_journal(journal_records, plan)]
    errs += [f"verification: {e}" for e in semantic_verification_result(verification_result, plan, s0, s1, journal_records)]
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
    if cm.get("operation_set_digest") != plan.get("operation_set_digest"):
        errs.append("commit operation_set_digest != plan")
    if cm.get("guard_digest") != plan.get("h0_guard_digest") or (s0 is not None and cm.get("guard_digest") != s0.get("guard_digest")):
        errs.append("commit guard_digest does not match plan/S0 guard")
    if s1 is not None and cm.get("s1_guard_digest") != s1.get("guard_digest"):
        errs.append("commit s1_guard_digest does not match S1")
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
    if active is not None and cm.get("authority_version") != active["authority_version"]:
        errs.append("commit authority_version != active authority")
    return errs


def validate_transaction_set(ts, perms, rp, caps, tc, es, active, schema_validate=None, callable_methods=None):
    """Composed authority for a linked transaction set:
    1 S0 → 2 plan → 3 journal → 4 S1 → 5 derive delta → 6 expected effect → 7 verification vs derived truth → 8 commit.
    ts = {s0_snapshot, plan, journal, s1_snapshot, verification, commit|None, conflicts}."""
    errs = []
    s0, plan, journal, s1, vr, cm, conflicts = ts.get("s0_snapshot"), ts.get("plan"), ts.get("journal") or [], ts.get("s1_snapshot"), ts.get("verification"), ts.get("commit"), ts.get("conflicts") or []
    if schema_validate:
        for name, doc, tag in (("resolveSnapshot", s0, "s0"), ("provisional/resolveMutationPlan", plan, "plan"), ("resolveSnapshot", s1, "s1"), ("provisional/resolveVerificationResult", vr, "verification"), ("provisional/resolveCommitManifest", cm, "commit")):
            if doc is not None:
                errs += [f"schema/{tag}: {e}" for e in schema_validate(name, doc)]
        for r in journal:
            errs += [f"schema/journal: {e}" for e in schema_validate("provisional/resolveTransactionJournal", r)]
        for c in conflicts:
            errs += [f"schema/conflict: {e}" for e in schema_validate("provisional/resolveConflict", c)]
    if errs:
        return errs
    if s0 is None or plan is None:
        return ["linked set requires s0_snapshot and plan"]
    errs += [f"s0: {e}" for e in semantic_snapshot(s0, callable_methods)]
    if s0["coverage"]["profile"] != "WRITE_PRECHECK" or not s0["coverage"]["complete"]:
        errs.append("s0: mutation requires a complete WRITE_PRECHECK snapshot")
    errs += [f"plan: {e}" for e in semantic_mutation_plan(plan, perms, rp, caps, tc, es, active, s0["guard_digest"])]
    errs += [f"journal: {e}" for e in semantic_journal(journal, plan)]
    if s1 is not None:
        errs += [f"s1: {e}" for e in semantic_snapshot(s1, callable_methods)]
        errs += [f"lineage: {e}" for e in guard_lineage_errors(s0, s1, plan)]
    if vr is not None:
        if s1 is None:
            errs.append("verification without an S1 snapshot")
        else:
            errs += [f"verification: {e}" for e in semantic_verification_result(vr, plan, s0, s1, journal)]
    for c in conflicts:
        errs += [f"conflict: {e}" for e in semantic_conflict(c, plan)]
    if cm is not None:
        errs += [f"commit: {e}" for e in semantic_commit_manifest(cm, plan, journal, vr, conflicts, s0, s1, active)]
    elif journal and journal[-1]["state"] in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("journal reached COMMITTED without a commit manifest")
    return errs


# ------------------------------------------------------------------ manifest validation (bytes + sha + lineage)
def semantic_manifest(m, bundle_dir=None, sha_fn=None, parent_manifest=None, size_fn=None):
    errs = []
    if m.get("schema") != "vidtoolz.resolveFreezeManifest.v1.4":
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
    if par.get("version") != "1.3.0" or par.get("head") != "1c9e090fcc8978e6e9b8f5dd538849448044d26b" or par.get("manifest_sha256") != "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc":
        errs.append("broken parent lineage")
    return errs


def callable_method_set(caps, rp, es, tc, active):
    """All methods QUALIFIED_CALLABLE for the contract environment under the active capability authority and evidence set."""
    env = _contract_env(tc)
    out = set()
    for spec in rp.get("logical_operations", {}).values():
        for p in spec.get("primitives", []):
            if primitive_status(caps, p, p["method"], es, env, active) == "QUALIFIED_CALLABLE":
                out.add(p["method"])
    return out
