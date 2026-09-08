"""VIDTOOLZ Resolve authority bundle v1.1 — reference canonicalization, digests and semantic rules.

Reference implementation (Python). A Node conformance implementation reproducing every vector
byte-for-byte is M1 work. Nothing here touches Resolve.
"""
import hashlib
import json
from fractions import Fraction

CANONICALIZATION_VERSION = "1.1"
TRACK_TYPE_ORDER = {"video": 0, "audio": 1, "subtitle": 2}
ITEM_KIND_ORDER = {"MEDIA_BACKED": 0, "GENERATOR": 1, "TITLE": 2, "COMPOUND": 3, "ADJUSTMENT": 4, "FUSION_OR_GENERATED": 5, "OTHER_OBSERVED": 6}
HASH_DOMAINS = {
    "vidtoolz.resolveSnapshotPayload.v1.1",
    "vidtoolz.resolveGuard.v1",
    "vidtoolz.resolveMutationPlan.v1",
    "vidtoolz.resolveBindingSet.v1",
    "vidtoolz.resolveJournalRecord.v1",
    "vidtoolz.resolveGeneric.v1",
}


class CanonError(ValueError):
    pass


def _num(v):
    """Numeric value for sorting: int, or tagged rational {"$rational":"p/q"}."""
    if isinstance(v, bool):
        raise CanonError("boolean is not a frame quantity")
    if isinstance(v, int):
        return Fraction(v)
    if isinstance(v, dict) and set(v.keys()) == {"$rational"}:
        p, q = v["$rational"].split("/")
        return Fraction(int(p), int(q))
    raise CanonError(f"not a numeric quantity: {v!r}")


def _s(v):
    return "" if v is None else str(v)


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


def sort_items(items):
    def key(it):
        kind = (it.get("provenance") or {}).get("kind", "OTHER_OBSERVED")
        return (_num(it["start"]), _num(it["end"]), ITEM_KIND_ORDER.get(kind, 99), _s(it.get("unique_id")))
    keys = [key(it) for it in items]
    if len(set(keys)) != len(keys):
        raise CanonError("two items share start/end/kind/unique_id: identity collision")
    return sorted(items, key=key)


def sort_markers(markers):
    def key(m):
        return (_s(m.get("object_address")), _num(m["frame"]), _s(m.get("custom_data")), _s(m.get("name")), _s(m.get("color")))
    return sorted(markers, key=key)


def sort_media_dependencies(deps):
    return sorted(deps, key=lambda d: (_s(d.get("logical_locator")), _s(d.get("source_sha256"))))


def normalize_snapshot_payload(payload):
    """Apply the schema-defined array ordering to a snapshot payload (does not validate schema)."""
    p = json.loads(json.dumps(payload))
    p["tracks"] = sort_tracks(p.get("tracks", []))
    for t in p["tracks"]:
        t["items"] = sort_items(t.get("items", []))
        for it in t["items"]:
            it["markers"] = sort_markers(it.get("markers", []))
    p["markers"] = sort_markers(p.get("markers", []))
    p["media_dependencies"] = sort_media_dependencies(p.get("media_dependencies", []))
    return p


def canon(v):
    """Canonical UTF-8 JSON text per CANONICALIZATION.md v1.1 (no whitespace, code-point key order)."""
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
        raise CanonError("bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex'}")
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
            p, q = v["$rational"].split("/")
            f = Fraction(int(p), int(q))
            if f.denominator != int(q) or f.numerator != int(p) or int(q) <= 0:
                raise CanonError("rational must be reduced with positive denominator")
        return "{" + ",".join(canon(k) + ":" + canon(v[k]) for k in sorted(keys)) + "}"
    raise CanonError(f"unsupported type {type(v)}")


def digest(obj, domain):
    """Domain-tagged digest: sha256( utf8(domain) + 0x0A + canonical_bytes )."""
    if domain not in HASH_DOMAINS:
        raise CanonError(f"unregistered hash domain {domain!r}")
    return hashlib.sha256(domain.encode("utf-8") + b"\n" + canon(obj).encode("utf-8")).hexdigest()


def snapshot_payload_digest(payload):
    return digest(normalize_snapshot_payload(payload), "vidtoolz.resolveSnapshotPayload.v1.1")


def guard_object(snapshot):
    """Composite guard (model A): binds library, project, timeline, epoch, coverage, policy pins and payload digest."""
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


# ---------------------------------------------------------------- semantic rules (NOT runtime-qualified)

def semantic_target_contract(tc):
    errs = []
    lib = tc["library"]
    if lib["provisioning_status"] == "UNPROVISIONED" and (lib["root_path"] is not None or lib["instance_uuid"] is not None):
        errs.append("UNPROVISIONED library must have null root_path/instance_uuid")
    if lib["provisioning_status"] == "PROVISIONED" and (lib["root_path"] is None or lib["instance_uuid"] is None):
        errs.append("PROVISIONED library must carry root_path and instance_uuid")
    if lib["name"] in lib.get("prohibited_library_names", []):
        errs.append("qualification library name is a prohibited library")
    if tc.get("accepts_current_open_session_as_target") is not False:
        errs.append("target must never accept whatever session is open")
    required_denied = {"SetCurrentDatabase", "CloseProject", "ImportProject", "ReplaceClip", "run_script", "run_script_unsafe", "execute_python", "execute_lua"}
    missing = required_denied - set(tc["denied_calls_all_scopes"])
    if missing:
        errs.append(f"denied_calls_all_scopes missing {sorted(missing)}")
    return errs


def semantic_timebase(tb):
    errs = []
    p = tb["profile_v1"]
    if p["fps"] != {"numerator": 30, "denominator": 1} or p["output_fps"] != 30:
        errs.append("profile_v1 must be exactly 30/1")
    if tb["law"]["name"] != "CEIL_BOUNDARY_V1" or tb["law"]["rounding"] != "CEIL":
        errs.append("rounding law substitution")
    if tb["tolerance"]["planned_vs_observed_frames"] != 0:
        errs.append("exactness redefined")
    # law self-check against fixture values
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
    roles_v = {t["index"]: t["role"] for t in tp["video"]}
    roles_a = {t["index"]: t["role"] for t in tp["audio"]}
    if roles_v.get(1) != "FULL_CANVAS_VISUAL":
        errs.append("video 1 must be FULL_CANVAS_VISUAL")
    if roles_a.get(1) != "NARRATION" or roles_a.get(2) != "MUSIC":
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


def semantic_snapshot(snap):
    errs = []
    cov = snap["coverage"]
    required = {"timeline", "tracks", "items", "markers", "adapter_bin_media"}
    if cov["complete"] and (set(cov["unobservable_domains"]) & required):
        errs.append("coverage.complete=true while a required domain is unobservable")
    if cov["complete"] is False and not cov["unobservable_domains"] and not cov["deferred_domains"]:
        errs.append("coverage.complete=false must name the missing domains")
    try:
        if snapshot_payload_digest(snap["payload"]) != snap["payload_sha256"]:
            errs.append("payload_sha256 does not match canonical payload")
        if guard_digest(snap) != snap["guard_digest"]:
            errs.append("guard_digest does not match guard object")
    except CanonError as e:
        errs.append(f"canonicalization error: {e}")
    for t in snap["payload"]["tracks"]:
        for it in t["items"]:
            kind = it["provenance"]["kind"]
            if kind == "MEDIA_BACKED":
                if it["source_status"] == "HASHED" and not it.get("source_sha256"):
                    errs.append("HASHED item without sha")
                if it["source_status"] != "HASHED" and it.get("source_sha256"):
                    errs.append("sha present but status not HASHED")
            else:
                if it["source_status"] != "NOT_APPLICABLE" or it.get("source_sha256") is not None:
                    errs.append(f"{kind} item must have NOT_APPLICABLE source and null sha")
    return errs


def permission_lookup(perms, milestone, operation, scope):
    """Fail-closed lookup: anything unlisted is DENY."""
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


def semantic_mutation_plan(plan, perms, snapshot_guard_digest=None):
    errs = []
    for op in plan["operations"]:
        r = permission_lookup(perms, plan["milestone"], op["op"], plan["scope"])
        if not r["allowed"]:
            errs.append(f"operation {op['op']} not permitted at {plan['milestone']}/{plan['scope']}: {r['reason']}")
        if op["op"] in ("APPEND", "DELETE", "DISABLE", "ENABLE", "SET_TAKE", "UPSERT_MARKER", "SET_PROPERTIES"):
            sel = op["selector"]
            need = {"library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "track_type", "track_index"}
            if op["op"] != "APPEND":
                need |= {"item_unique_id", "expected_start", "expected_end"}
            missing = need - set(sel.keys())
            if missing:
                errs.append(f"selector incomplete for {op['op']}: missing {sorted(missing)}")
    if snapshot_guard_digest is not None and plan["h0_guard_digest"] != snapshot_guard_digest:
        errs.append("plan bound to a different guard digest than the snapshot")
    if plan.get("dry_run") is not True and plan["milestone"] in ("M0", "M1", "M2"):
        errs.append("non-dry-run plan before M3")
    return errs


def semantic_verification_result(vr):
    errs = []
    if vr["verdict"] == "VERIFIED" and (vr["unrelated"] or vr["missing_expected"]):
        errs.append("VERIFIED with unrelated or missing_expected non-empty")
    if vr["is_human_approval"] is not False:
        errs.append("verification can never be human approval")
    return errs


JOURNAL_TRANSITIONS = {
    None: {"PREPARED"},
    "PREPARED": {"LEASED", "CONFLICT", "NOT_APPLIED"},
    "LEASED": {"PREFLIGHT_OK", "CONFLICT"},
    "PREFLIGHT_OK": {"CHECKPOINTED", "APPLIED", "CONFLICT"},
    "CHECKPOINTED": {"APPLIED", "CONFLICT", "ORPHANED_PARTIAL"},
    "APPLIED": {"APPLIED", "READBACK_S1", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS"},
    "READBACK_S1": {"VERIFIED", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS"},
    "VERIFIED": {"SAVED", "ORPHANED_AMBIGUOUS"},
    "SAVED": {"PUBLISHED", "ORPHANED_AMBIGUOUS"},
    "PUBLISHED": {"COMMITTED"},
}


def semantic_journal(records):
    errs = []
    prev = None
    prev_hash = None
    for r in records:
        if r["previous_record_sha256"] != prev_hash:
            errs.append(f"seq {r['sequence']}: hash chain broken")
        if r["state"] not in JOURNAL_TRANSITIONS.get(prev, set()) and not (prev is None and r["state"] == "PREPARED"):
            errs.append(f"seq {r['sequence']}: illegal transition {prev} -> {r['state']}")
        prev = r["state"]
        prev_hash = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return errs


def semantic_commit_manifest(cm, terminal_journal_state):
    errs = []
    if terminal_journal_state not in ("PUBLISHED", "COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("commit manifest for a transaction that never reached PUBLISHED")
    return errs
