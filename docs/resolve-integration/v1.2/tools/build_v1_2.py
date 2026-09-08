#!/usr/bin/env python3
"""Generate v1.2 machine artifacts. Deterministic; offline. Run from the bundle dir: python3 -B tools/build_v1_2.py"""
import copy
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

V11 = os.path.join(os.path.dirname(B), "v1.1")
SHA = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
SHA_OR_NULL = {"anyOf": [SHA, {"type": "null"}]}
NONNEG = {"type": "integer", "minimum": 0}
POSINT = {"type": "integer", "minimum": 1}
RATIONAL_TAG = {"type": "object", "additionalProperties": False, "required": ["$rational"], "properties": {"$rational": {"type": "string", "pattern": "^(0|[1-9][0-9]*)/([1-9][0-9]*)$"}}}
F64_TAG = {"type": "object", "additionalProperties": False, "required": ["$f64"], "properties": {"$f64": {"type": "string", "pattern": "^[0-9a-f]{16}$"}}}
FRAME_QTY = {"anyOf": [NONNEG, RATIONAL_TAG]}
FRAME_QTY_OR_NULL = {"anyOf": [NONNEG, RATIONAL_TAG, {"type": "null"}]}
ABS_PATH = {"type": "string", "pattern": "^/(?!.*(^|/)\\.\\.(/|$)).*$", "minLength": 2}
UUID = {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}
OBS = {"enum": list(L.OBS_STATUS)}
UU = "7e11aa60-fe44-4f3e-aa35-515e9a0d30ca"
SCOPE = "SCRATCH_QUALIFICATION_LIBRARY"


def dump(rel, obj):
    p = os.path.join(B, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load(rel, root=B):
    return L.strict_load(os.path.join(root, rel))


def sha_of(rel):
    return hashlib.sha256(open(os.path.join(B, rel), "rb").read()).hexdigest()


def S(id_, title, props, req, comment=None, extra=None):
    d = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": id_, "title": title, "type": "object", "additionalProperties": False, "required": req, "properties": props}
    if comment:
        d["$comment"] = comment
    if extra:
        d.update(extra)
    return d


def fixture(name, layer, schema, doc, check=None, expect_contains=None, extra=None):
    """layer_expected_failure: none | parse | schema | semantic | eligibility"""
    d = {"fixture": name, "layer_expected_failure": layer, "schema": schema, "check": check, "expect_error_contains": expect_contains, "document": doc}
    if extra:
        d.update(extra)
    dump(f"fixtures/layered/{name}.json", d)


# clean superseded fixture trees from the v1.1 copy (regenerated below under fixtures/layered)
import shutil  # noqa: E402
for sub in ("fixtures/schema", "fixtures/semantic", "fixtures/permissions", "fixtures/snapshot", "fixtures/guard", "fixtures/canonicalization"):
    shutil.rmtree(os.path.join(B, sub), ignore_errors=True)

# ============================================================ TARGET CONTRACT v1.2 (attachment gate)
tc11 = load("TARGET-CONTRACT.json", V11)
tc = copy.deepcopy(tc11)
tc.update({"schema": "vidtoolz.resolveTargetContract.v1.2", "version": "1.2.0", "attachment_state": "UNPROVISIONED", "attachment_evidence": {}, "attachment_states": {k: {"required_evidence": v} for k, v in L.ATTACHMENT_REQUIREMENTS.items()},
           "attachment_law": "schema validity != attachment eligibility; M0 CONNECT requires ATTACHMENT_READY; every other M0 read op requires ATTACHED_READ_ONLY; any M3 write requires SCRATCH_WRITE_READY; the declared state must be supported by the listed evidence fields (semantic check)"})
tc["required_future_observations"].append({"field": "attachment_evidence.observed.*", "source": "M0 connection evidence (database name/type, resolve version)", "blocks": "ATTACHED_READ_ONLY"})
dump("TARGET-CONTRACT.json", tc)
ev_props = {k: {"type": ["string", "boolean", "null"]} for k in sorted({x for v in L.ATTACHMENT_REQUIREMENTS.values() for x in v} | {"observed.database_name", "observed.database_type", "observed.resolve_version"})}
tc_schema = load("schemas/resolveTargetContract.schema.json", V11)
tc_schema["$id"] = "vidtoolz.resolveTargetContract.v1.2"
tc_schema["title"] = "Resolve target contract v1.2 (attachment gate)"
tc_schema["properties"]["schema"] = {"const": "vidtoolz.resolveTargetContract.v1.2"}
tc_schema["properties"]["version"] = {"type": "string", "pattern": "^1\\.2\\.[0-9]+$"}
tc_schema["properties"]["attachment_state"] = {"enum": L.ATTACHMENT_STATES}
tc_schema["properties"]["attachment_evidence"] = {"type": "object", "additionalProperties": False, "properties": ev_props}
tc_schema["properties"]["attachment_states"] = {"type": "object"}
tc_schema["properties"]["attachment_law"] = {"type": "string"}
tc_schema["required"] = sorted(set(tc_schema["required"]) | {"attachment_state", "attachment_evidence", "attachment_states"})
tc_schema["$comment"] = "Schema-valid != attachment-eligible. attachment_state is a declaration; semantic_target_contract() verifies the declared state is supported by attachment_evidence and that observed database is neither shared nor the user's Local Database. A valid contract in state UNPROVISIONED permits no attach."
dump("schemas/resolveTargetContract.schema.json", tc_schema)
fixture("target-contract-frozen-unprovisioned", "none", "resolveTargetContract", tc, check="semantic_target_contract")
ready = copy.deepcopy(tc); ready["attachment_state"] = "ATTACHMENT_READY"; ready["library"]["provisioning_status"] = "PROVISIONED"; ready["library"]["root_path"] = "/home/vidtoolz/resolve-qualification/v1/library"; ready["library"]["instance_uuid"] = UU; ready["session"]["launch_recipe_sha256"] = "a" * 64
ready["attachment_evidence"] = {"library.root_path": True, "library.instance_uuid": True, "provisioning.record_sha256": "b" * 64, "session.launch_recipe_sha256": "a" * 64, "host.name_matches_contract": True, "bundle.independent_verification_sha256": "c" * 64}
fixture("target-attachment-ready-valid", "none", "resolveTargetContract", ready, check="semantic_target_contract")
attached = copy.deepcopy(ready); attached["attachment_state"] = "ATTACHED_READ_ONLY"; attached["attachment_evidence"].update({"observed.database_matches_contract": True, "observed.database_not_shared": True, "observed.resolve_version_matches_contract": True, "observed.database_name": "VIDTOOLZ Resolve Qualification v1", "observed.database_type": "Disk", "observed.resolve_version": "21.1.0.0014"})
fixture("target-attached-read-only-valid", "none", "resolveTargetContract", attached, check="semantic_target_contract")
neg = copy.deepcopy(attached); neg["attachment_evidence"]["observed.database_name"] = "EKA"
fixture("target-attached-observed-eka", "semantic", "resolveTargetContract", neg, check="semantic_target_contract", expect_contains="prohibited")
neg = copy.deepcopy(ready); neg["attachment_evidence"].pop("session.launch_recipe_sha256")
fixture("target-ready-without-launch-evidence", "semantic", "resolveTargetContract", neg, check="semantic_target_contract", expect_contains="launch_recipe")
neg = copy.deepcopy(tc); neg["attachment_state"] = "PROVISIONED_NOT_VERIFIED"
fixture("target-provisioned-not-verified-without-evidence", "semantic", "resolveTargetContract", neg, check="semantic_target_contract", expect_contains="requires evidence")
neg = copy.deepcopy(tc); neg["attachment_state"] = "OPEN_SESSION"
fixture("target-unknown-attachment-state", "schema", "resolveTargetContract", neg, expect_contains="enum")
neg = copy.deepcopy(tc); neg["accepts_current_open_session_as_target"] = True
fixture("target-accepts-open-session", "schema", "resolveTargetContract", neg, expect_contains="False")
neg = copy.deepcopy(tc); neg["library"]["kind"] = "PostgreSQL"; neg["library"]["name"] = "EKA"
fixture("target-shared-postgres-library", "schema", "resolveTargetContract", neg, expect_contains="Disk")
neg = copy.deepcopy(tc); neg["denied_calls_all_scopes"] = [c for c in neg["denied_calls_all_scopes"] if c != "SetCurrentDatabase"]
fixture("target-missing-denied-setcurrentdatabase", "schema", "resolveTargetContract", neg, expect_contains="contains")
neg = copy.deepcopy(tc); neg["host"]["name"] = ""
fixture("target-empty-host", "schema", "resolveTargetContract", neg, expect_contains="minLength")
neg = copy.deepcopy(tc); neg["library"]["root_path"] = "/x/../etc"
fixture("target-path-traversal", "schema", "resolveTargetContract", neg, expect_contains="anyOf")

# ============================================================ TIMEBASE (inherit v1.1 instance/schema; re-emit fixtures)
tb = load("TIMEBASE.json", V11)
dump("TIMEBASE.json", tb)
shutil.copyfile(os.path.join(V11, "schemas/resolveTimebase.schema.json"), os.path.join(B, "schemas/resolveTimebase.schema.json"))
fixture("timebase-frozen", "none", "resolveTimebase", tb, check="semantic_timebase")
for name, mut, exp in [("timebase-24fps", lambda d: (d["profile_v1"].update({"fps": {"numerator": 24, "denominator": 1}, "output_fps": 24})), "30"), ("timebase-half-up-law", lambda d: d["law"].update({"name": "HALF_UP_BOUNDARY_V1", "rounding": "HALF_UP"}), "CEIL"), ("timebase-math-round-law", lambda d: d["law"].update({"rounding": "ROUND"}), "CEIL"), ("timebase-negative-sample-rate", lambda d: d["profile_v1"].update({"audio_sample_rate_hz": -48000}), "48000"), ("timebase-frame-tolerance", lambda d: d["tolerance"].update({"planned_vs_observed_frames": 1}), "0"), ("timebase-arbitrary-tolerance-field", lambda d: d["tolerance"].update({"arbitrary_ms": 40}), "additional"), ("timebase-substitution-allowed", lambda d: d["law"].update({"substitution_allowed": True}), "False")]:
    d = copy.deepcopy(tb); mut(d); fixture(name, "schema", "resolveTimebase", d, expect_contains=exp)

# ============================================================ TRACK POLICY (inherit)
tp = load("schemas/resolveTrackPolicy.v1.json", V11)
dump("schemas/resolveTrackPolicy.v1.json", tp)
shutil.copyfile(os.path.join(V11, "schemas/resolveTrackPolicy.schema.json"), os.path.join(B, "schemas/resolveTrackPolicy.schema.json"))
fixture("track-policy-frozen", "none", "resolveTrackPolicy", tp, check="semantic_track_policy")
neg = copy.deepcopy(tp); neg["video"][0]["index"] = "1"; fixture("track-policy-string-index", "schema", "resolveTrackPolicy", neg, expect_contains="integer")
neg = copy.deepcopy(tp); neg["video"][1]["index"] = 1; fixture("track-policy-duplicate-index", "semantic", "resolveTrackPolicy", neg, check="semantic_track_policy", expect_contains="unique")

# ============================================================ CANARY MANIFEST (inherit)
cm = load("CANARY-SOURCE-MANIFEST.json", V11)
dump("CANARY-SOURCE-MANIFEST.json", cm)
shutil.copyfile(os.path.join(V11, "schemas/resolveCanarySourceManifest.schema.json"), os.path.join(B, "schemas/resolveCanarySourceManifest.schema.json"))
fixture("canary-manifest-frozen", "none", "resolveCanarySourceManifest", cm, check="semantic_canary_manifest")
neg = copy.deepcopy(cm); neg["media"] = neg["media"][:21]; neg["media_match_count"] = "21/21"; fixture("canary-21-media", "schema", "resolveCanarySourceManifest", neg, expect_contains="22")
neg = copy.deepcopy(cm); neg["media"][1] = copy.deepcopy(neg["media"][0]); fixture("canary-duplicate-record", "schema", "resolveCanarySourceManifest", neg, expect_contains="unique")
neg = copy.deepcopy(cm); neg["media"][2]["preserved_sha256"] = "0" * 64; fixture("canary-hash-mismatch", "semantic", "resolveCanarySourceManifest", neg, check="semantic_canary_manifest", expect_contains="hash mismatch")
neg = copy.deepcopy(cm); neg["media"][0]["preserved_path"] = "/home/vidtoolz/../etc/passwd"; fixture("canary-path-traversal", "schema", "resolveCanarySourceManifest", neg, expect_contains="pattern")

# ============================================================ SNAPSHOT v1.2 (completeness law, field statuses, ordinal, ranges) + GUARD
field_status = {"type": "object", "additionalProperties": False, "required": ["unique_id", "media_pool_item_unique_id", "media_id", "source_start", "source_end"], "properties": {**{k: OBS for k in ("unique_id", "media_pool_item_unique_id", "media_id", "source_start", "source_end")}, **{k + "_reason": {"type": "string"} for k in ("unique_id", "media_pool_item_unique_id", "media_id", "source_start", "source_end")}}}
common = {"unique_id": {"type": ["string", "null"]}, "observation_ordinal": NONNEG, "name": {"type": "string"}, "start": FRAME_QTY, "end": FRAME_QTY, "duration": FRAME_QTY_OR_NULL, "enabled": {"type": ["boolean", "null"]}, "markers": {"type": "array"}, "identity_observed": {"enum": ["COMPLETE", "PARTIAL", "NONE"]}, "field_status": field_status, "media_pool_item_unique_id": {"type": ["string", "null"]}, "media_id": {"type": ["string", "null"]}, "source_start": FRAME_QTY_OR_NULL, "source_end": FRAME_QTY_OR_NULL}
media_backed = {"type": "object", "additionalProperties": False, "required": list(common) + ["provenance", "source_locator", "source_status", "source_sha256"], "properties": dict(common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"const": "MEDIA_BACKED"}}}, source_locator={"type": ["string", "null"]}, source_status={"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}, source_sha256=SHA_OR_NULL)}
non_media = {"type": "object", "additionalProperties": False, "required": list(common) + ["provenance", "source_locator", "source_status", "source_sha256", "absence_reason"], "properties": dict(common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"enum": ["GENERATOR", "TITLE", "COMPOUND", "ADJUSTMENT", "FUSION_OR_GENERATED", "OTHER_OBSERVED"]}}}, source_locator={"type": "null"}, source_status={"const": "NOT_APPLICABLE"}, source_sha256={"type": "null"}, absence_reason={"enum": ["NO_MEDIA_POOL_ITEM", "NO_FILE_BACKED_SOURCE", "UNOBSERVED_BY_API"]})}
marker = {"type": "object", "additionalProperties": False, "required": ["object_address", "frame", "duration", "color", "name", "note", "custom_data"], "properties": {"object_address": {"type": "string", "minLength": 1}, "frame": FRAME_QTY, "duration": FRAME_QTY, "color": {"type": "string"}, "name": {"type": "string"}, "note": {"type": "string"}, "custom_data": {"type": "string"}}}
track = {"type": "object", "additionalProperties": False, "required": ["type", "index", "name", "enabled", "locked", "items"], "properties": {"type": {"enum": ["video", "audio", "subtitle"]}, "index": POSINT, "name": {"type": "string"}, "enabled": {"type": ["boolean", "null"]}, "locked": {"type": ["boolean", "null"]}, "items": {"type": "array", "items": {"oneOf": [media_backed, non_media]}}}}
coverage = {"type": "object", "additionalProperties": False, "required": ["profile", "complete", "observed_domains", "unobservable_domains", "deferred_domains"], "properties": {"profile": {"enum": list(L.COVERAGE_PROFILES)}, "complete": {"type": "boolean"}, "observed_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "unobservable_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "deferred_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}}}
policy_s = {"type": "object", "additionalProperties": False, "required": ["target_contract_sha256", "timebase_sha256", "track_policy_sha256", "capabilities_version", "collector_version", "canonicalization_version"], "properties": {"target_contract_sha256": SHA, "timebase_sha256": SHA, "track_policy_sha256": SHA, "capabilities_version": {"type": "string"}, "collector_version": {"type": "string"}, "canonicalization_version": {"const": "1.2"}}}
library_s = {"type": "object", "additionalProperties": False, "required": ["db_type", "db_name", "instance_uuid"], "properties": {"db_type": {"enum": ["Disk"]}, "db_name": {"type": "string", "minLength": 1}, "instance_uuid": UUID}}
snap_schema = S("vidtoolz.resolveSnapshot.v1.2", "Canonical Resolve readback snapshot v1.2", {
    "schema": {"const": "vidtoolz.resolveSnapshot.v1.2"}, "collector_version": {"type": "string", "minLength": 1}, "canonicalization_version": {"const": "1.2"}, "target_epoch": {"type": "string", "minLength": 1}, "resolve_build": {"type": "string", "minLength": 1},
    "library": library_s,
    "project": {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "name", "last_modified_time_observed"], "properties": {"unique_id": {"type": ["string", "null"]}, "unique_id_status": OBS, "name": {"type": "string"}, "last_modified_time_observed": {"type": ["integer", "string", "null"]}}},
    "collection": {"type": "object", "additionalProperties": False, "required": ["started_at", "ended_at", "generation", "stable_pair"], "properties": {"started_at": {"type": "string"}, "ended_at": {"type": "string"}, "generation": NONNEG, "stable_pair": {"type": "boolean"}}},
    "coverage": coverage, "policy": policy_s,
    "payload": {"type": "object", "additionalProperties": False, "required": ["timeline", "tracks", "markers", "media_dependencies"], "properties": {
        "timeline": {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "name", "start_frame", "start_timecode", "fps", "width", "height", "end_frame", "is_current", "duration_convention", "settings"], "properties": {"unique_id": {"type": ["string", "null"]}, "unique_id_status": OBS, "name": {"type": "string"}, "start_frame": NONNEG, "start_timecode": {"type": "string"}, "fps": {"type": "object", "additionalProperties": False, "required": ["numerator", "denominator"], "properties": {"numerator": POSINT, "denominator": POSINT}}, "width": POSINT, "height": POSINT, "end_frame": NONNEG, "is_current": {"type": "boolean"}, "duration_convention": {"enum": ["UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"]}, "settings": {"type": "object"}}},
        "tracks": {"type": "array", "items": track}, "markers": {"type": "array", "items": marker}, "media_dependencies": {"type": "array", "items": {"type": "object", "required": ["logical_locator", "source_sha256", "status"], "properties": {"logical_locator": {"type": "string"}, "source_sha256": SHA_OR_NULL, "status": {"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}}}}}},
    "payload_sha256": SHA, "guard_digest": SHA, "hash_domains": {"type": "object", "additionalProperties": False, "required": ["payload", "guard"], "properties": {"payload": {"const": "vidtoolz.resolveSnapshotPayload.v1.2"}, "guard": {"const": "vidtoolz.resolveGuard.v1"}}},
}, ["schema", "collector_version", "canonicalization_version", "target_epoch", "resolve_build", "library", "project", "collection", "coverage", "policy", "payload", "payload_sha256", "guard_digest", "hash_domains"],
    comment="Completeness law: coverage.complete may be true only when every mandatory domain of coverage.profile is observed and every mandatory item field is OBSERVED (semantic_snapshot). Identity fields are nullable; field_status says OBSERVED|UNAVAILABLE|UNSUPPORTED|ERROR|NOT_REQUESTED and a non-OBSERVED status forbids a value (no fabricated ids). duration_convention is UNQUALIFIED until M3 P3; raw start/end/duration are recorded, end>=start enforced, duration must match one of the two candidate conventions. observation_ordinal (position in GetItemListInTrack) completes the total item ordering when unique_id is unavailable.")
dump("schemas/resolveSnapshot.schema.json", snap_schema)
guard_schema = load("schemas/resolveGuard.schema.json", V11)
guard_schema["properties"]["coverage"] = coverage
guard_schema["properties"]["policy"] = policy_s
guard_schema["properties"]["library"] = library_s
dump("schemas/resolveGuard.schema.json", guard_schema)
policy = {"target_contract_sha256": sha_of("TARGET-CONTRACT.json"), "timebase_sha256": sha_of("TIMEBASE.json"), "track_policy_sha256": sha_of("schemas/resolveTrackPolicy.v1.json"), "capabilities_version": "1.2.0", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.2"}


def fstat(**kw):
    base = {k: "OBSERVED" for k in ("unique_id", "media_pool_item_unique_id", "media_id", "source_start", "source_end")}
    base.update(kw)
    return base


def item_media(uid, ordn, start, end, mp, sha=None, status="HASHED", name="clip", **kw):
    it = {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "COMPLETE", "field_status": fstat(media_id="UNAVAILABLE", media_id_reason="GetMediaId not qualified on 21.1.0.0014"), "provenance": {"kind": "MEDIA_BACKED"}, "media_pool_item_unique_id": mp, "media_id": None, "source_locator": f"/qual/media/{name}.png", "source_status": status, "source_sha256": sha, "source_start": 0, "source_end": end - start}
    it.update(kw)
    return it


def item_other(uid, ordn, start, end, kind, reason, name):
    return {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "PARTIAL", "field_status": fstat(media_pool_item_unique_id="NOT_REQUESTED", media_id="NOT_REQUESTED", source_start="UNSUPPORTED", source_end="UNSUPPORTED"), "provenance": {"kind": kind}, "media_pool_item_unique_id": None, "media_id": None, "source_locator": None, "source_status": "NOT_APPLICABLE", "source_sha256": None, "absence_reason": reason, "source_start": None, "source_end": None}


def make_snapshot(tracks, markers=None, coverage_=None, convention="UNQUALIFIED"):
    payload = {"timeline": {"unique_id": "tl-fixture-0001", "unique_id_status": "OBSERVED", "name": "VIDTOOLZ__fixture__r1", "start_frame": 108000, "start_timecode": "01:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1080, "height": 1920, "end_frame": 114756, "is_current": True, "duration_convention": convention, "settings": {"useCustomSettings": "1", "timelineFrameRate": "30"}}, "tracks": tracks, "markers": markers or [], "media_dependencies": []}
    payload = L.normalize_snapshot_payload(payload)
    snap = {"schema": "vidtoolz.resolveSnapshot.v1.2", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.2", "target_epoch": "epoch-fixture-1", "resolve_build": "21.1.0.0014", "library": {"db_type": "Disk", "db_name": "VIDTOOLZ Resolve Qualification v1", "instance_uuid": UU}, "project": {"unique_id": "proj-fixture-0001", "unique_id_status": "OBSERVED", "name": "VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE", "last_modified_time_observed": None}, "collection": {"started_at": "2026-09-08T00:00:00Z", "ended_at": "2026-09-08T00:00:01Z", "generation": 1, "stable_pair": True}, "coverage": coverage_ or {"profile": "FULL_TIMELINE_READ", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings", "adapter_bin_media"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "track_locks", "item_identity"]}, "policy": policy, "payload": payload, "hash_domains": {"payload": "vidtoolz.resolveSnapshotPayload.v1.2", "guard": "vidtoolz.resolveGuard.v1"}}
    snap["payload_sha256"] = L.snapshot_payload_digest(payload)
    snap["guard_digest"] = L.guard_digest(snap)
    return snap


sha_a = hashlib.sha256(b"fixture-a").hexdigest()
human_tl = [
    {"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [item_media("it-1", 0, 108000, 108347, "mp-1", sha_a, "HASHED", "still-001"), item_other("it-2", 1, 108347, 108694, "TITLE", "NO_FILE_BACKED_SOURCE", "Text+"), item_media("it-3", 2, 108694, 109174, "mp-2", None, "UNHASHED_UNOWNED", "human-broll"), item_other("it-4", 3, 109174, 109654, "GENERATOR", "NO_MEDIA_POOL_ITEM", "Solid Color"), item_other("it-5", 4, 109654, 109924, "COMPOUND", "NO_FILE_BACKED_SOURCE", "Compound Clip 1"), item_media("it-6", 5, 109924, 110194, "mp-3", None, "OFFLINE", "missing-media")]},
    {"type": "video", "index": 2, "name": "V2", "enabled": True, "locked": False, "items": [item_other("it-7", 0, 108000, 108694, "ADJUSTMENT", "NO_MEDIA_POOL_ITEM", "Adjustment Clip"), item_other("it-8", 1, 108694, 109174, "FUSION_OR_GENERATED", "UNOBSERVED_BY_API", "Fusion Composition")]},
    {"type": "audio", "index": 1, "name": "A1", "enabled": True, "locked": False, "items": [item_media("it-9", 0, 108000, 114756, "mp-4", hashlib.sha256(b"narr").hexdigest(), "HASHED", "narration")]},
]
snap_pos = make_snapshot(human_tl, markers=[{"object_address": "timeline", "frame": 108000, "duration": 1, "color": "Blue", "name": "draft-still-001", "note": "", "custom_data": "vidtoolz:resolve:binding:v1:epoch-fixture-1:b-001:o-1"}])
dump("fixtures/snapshot/human-timeline-mixed-provenance.json", snap_pos)
fixture("snapshot-human-timeline-full-read", "none", "resolveSnapshot", snap_pos, check="semantic_snapshot")
# M0 minimal snapshot: no item identity qualified yet -> unique_id UNAVAILABLE, ordinal-only ordering, complete under MINIMAL_M0
m0_items = [dict(item_media(None, i, 108000 + 300 * i, 108300 + 300 * i, None, None, "UNHASHED_UNOWNED", f"c{i}"), field_status=fstat(unique_id="UNAVAILABLE", unique_id_reason="TimelineItem.GetUniqueId not qualified on 21.1.0.0014; M0 probe pending", media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="MediaPoolItem.GetUniqueId not qualified", media_id="NOT_REQUESTED", source_start="UNAVAILABLE", source_start_reason="GetSourceStartFrame not qualified", source_end="UNAVAILABLE", source_end_reason="GetSourceEndFrame not qualified"), identity_observed="NONE", source_start=None, source_end=None, source_locator=None) for i in range(2)]
m0_snap = make_snapshot([{"type": "video", "index": 1, "name": "V1", "enabled": None, "locked": None, "items": m0_items}], coverage_={"profile": "MINIMAL_M0", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"]})
dump("fixtures/snapshot/m0-minimal-identity-unavailable.json", m0_snap)
fixture("snapshot-m0-minimal-identity-unavailable", "none", "resolveSnapshot", m0_snap, check="semantic_snapshot")
# negatives (layered)
neg = copy.deepcopy(snap_pos); neg["coverage"]["observed_domains"] = []; fixture("snapshot-complete-empty-observed", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="empty observed")
neg = copy.deepcopy(snap_pos); neg["coverage"]["profile"] = "WRITE_PRECHECK"; fixture("snapshot-complete-write-precheck-missing-domains", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="mandatory domains")
neg = copy.deepcopy(snap_pos); neg["coverage"]["observed_domains"].append("vibes"); fixture("snapshot-invented-domain", "schema", "resolveSnapshot", neg, expect_contains="enum")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["unique_id"] = None; fixture("snapshot-observed-status-null-value", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="OBSERVED but value null")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["field_status"]["unique_id"] = "UNAVAILABLE"; neg["payload"]["tracks"][0]["items"][0]["field_status"]["unique_id_reason"] = "x"; fixture("snapshot-fabricated-id", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="fabrication")
neg = copy.deepcopy(snap_pos); it = neg["payload"]["tracks"][0]["items"][0]; it["end"] = it["start"] - 1; fixture("snapshot-end-before-start", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="end < start")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["duration"] = 999; fixture("snapshot-duration-contradiction", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="duration inconsistent")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["source_end"] = 0; neg["payload"]["tracks"][0]["items"][0]["source_start"] = 5; fixture("snapshot-source-bounds-inverted", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="source_end < source_start")
neg = copy.deepcopy(snap_pos); neg["payload"]["timeline"]["end_frame"] = 100; fixture("snapshot-timeline-end-before-start", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="end_frame < start_frame")
neg = copy.deepcopy(snap_pos); del neg["payload"]["tracks"][0]["items"][0]["observation_ordinal"]; fixture("snapshot-missing-ordinal", "schema", "resolveSnapshot", neg, expect_contains="oneOf")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["start"] = -5; fixture("snapshot-negative-frame", "schema", "resolveSnapshot", neg, expect_contains="oneOf")
neg = copy.deepcopy(snap_pos); neg["library"]["db_type"] = "PostgreSQL"; fixture("snapshot-postgres-library", "schema", "resolveSnapshot", neg, expect_contains="Disk")
neg = copy.deepcopy(snap_pos); neg["project"]["unique_id"] = "proj-OTHER"; fixture("snapshot-guard-context-changed", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="guard_digest")
neg = copy.deepcopy(snap_pos); neg["coverage"]["complete"] = False; neg["coverage"]["unobservable_domains"] = []; neg["coverage"]["deferred_domains"] = []; fixture("snapshot-incomplete-without-reason", "semantic", "resolveSnapshot", neg, check="semantic_snapshot", expect_contains="name missing")
snap_b = copy.deepcopy(snap_pos); snap_b["project"]["unique_id"] = "proj-fixture-0002"; snap_b["guard_digest"] = L.guard_digest(snap_b)
dump("fixtures/guard/same-payload-different-project.json", {"purpose": "payload digest alone does not prove target context", "payload_sha256_equal": snap_pos["payload_sha256"] == snap_b["payload_sha256"], "guard_digest_equal": snap_pos["guard_digest"] == snap_b["guard_digest"], "a_guard": snap_pos["guard_digest"], "b_guard": snap_b["guard_digest"]})

# ============================================================ CANONICALIZATION VECTORS v1.2 (+ adversarial markers, f64, dup keys)
vectors = []


def vec(name, obj, domain="vidtoolz.resolveGeneric.v1", normalize=None, note=None):
    o = normalize(obj) if normalize else obj
    c = L.canon(o)
    vectors.append({"name": name, "note": note, "input": obj, "domain": domain, "canonical_utf8": c, "canonical_byte_length": len(c.encode("utf-8")), "sha256": L.digest(o, domain)})


vec("empty_object", {})
vec("key_order_codepoint", {"b": 1, "a": 2, "B": 3, "ä": 4, "aa": 5})
vec("string_escapes", {"s": "quote\" back\\ tab\t nl\n cr\r del slash/ emoji\U0001F600 ä"})
vec("integers_and_tagged", {"frames": 6756, "ms": 225183, "zero": 0, "neg": -17, "fps": {"$rational": "30/1"}, "gain": {"$f64": "3ff0000000000000"}})
base_tl = {"unique_id": "t", "unique_id_status": "OBSERVED", "name": "t", "start_frame": 0, "start_timecode": "00:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1, "height": 1, "end_frame": 0, "is_current": True, "duration_convention": "UNQUALIFIED", "settings": {}}
tr = lambda typ, idx: {"type": typ, "index": idx, "name": f"{typ}{idx}", "enabled": True, "locked": False, "items": []}  # noqa: E731
vec("numeric_track_index_2_before_10", {"timeline": base_tl, "tracks": [tr("video", 10), tr("video", 2)], "markers": [], "media_dependencies": []}, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "track 2 sorts before track 10")
vec("track_type_order_video_audio_subtitle", {"timeline": base_tl, "tracks": [tr("subtitle", 1), tr("audio", 1), tr("video", 1)], "markers": [], "media_dependencies": []}, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "video<audio<subtitle")
mk = lambda addr, frame, dur, cd, name, color, note: {"object_address": addr, "frame": frame, "duration": dur, "custom_data": cd, "name": name, "color": color, "note": note}  # noqa: E731
markers_a = [mk("timeline", 10, 1, "", "m", "Blue", "second"), mk("timeline", 5, 1, "", "m", "Blue", ""), mk("item:it-1", 5, 3, "", "m", "Blue", ""), mk("timeline", 7, 2, "vidtoolz:x", "a", "Red", "n1")]
pa = {"timeline": base_tl, "tracks": [], "markers": markers_a, "media_dependencies": []}
pb = {"timeline": base_tl, "tracks": [], "markers": list(reversed(markers_a)), "media_dependencies": []}
assert L.snapshot_payload_digest(pa) == L.snapshot_payload_digest(pb)
vec("markers_total_order_A", pa, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "markers ordered by (object_address, frame, duration, custom_data, name, color, note)")
vec("markers_total_order_B_reversed_same_digest", pb, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "reversed input; same digest as A")
# same prior key different note/duration at DIFFERENT frames (same frame is a collision)
vec("markers_differ_only_in_note", {"timeline": base_tl, "tracks": [], "markers": [mk("timeline", 1, 1, "", "m", "Blue", "zeta"), mk("timeline", 2, 1, "", "m", "Blue", "alpha")], "media_dependencies": []}, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "note is part of the key; distinct frames so no collision")
vec("markers_differ_only_in_duration", {"timeline": base_tl, "tracks": [], "markers": [mk("timeline", 1, 9, "", "m", "Blue", ""), mk("timeline", 2, 1, "", "m", "Blue", "")], "media_dependencies": []}, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "duration is part of the key")
vec("unicode_byte_distinct_strings", {"a": "ä", "b": "ä"}, note="NFC vs NFD are distinct strings; no normalization is applied, both are preserved as given")
perm_a = copy.deepcopy(human_tl); perm_b = list(reversed(copy.deepcopy(human_tl)))
for t in perm_b:
    t["items"] = list(reversed(t["items"]))
pa2 = {"timeline": base_tl, "tracks": perm_a, "markers": [], "media_dependencies": []}
pb2 = {"timeline": base_tl, "tracks": perm_b, "markers": [], "media_dependencies": []}
assert L.snapshot_payload_digest(pa2) == L.snapshot_payload_digest(pb2)
vec("permutation_invariance_A", pa2, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload)
vec("permutation_invariance_B_same_digest", pb2, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload)
same_frame = {"timeline": base_tl, "tracks": [{"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [item_other("z-id", 2, 5, 9, "TITLE", "NO_FILE_BACKED_SOURCE", "t"), item_media("a-id", 1, 5, 9, "mp", None, "UNHASHED_UNOWNED", "m"), item_media("b-id", 0, 5, 7, "mp", None, "UNHASHED_UNOWNED", "n")]}], "markers": [], "media_dependencies": []}
vec("same_frame_items_deterministic", same_frame, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "shorter end first; MEDIA_BACKED<TITLE; then unique_id; then ordinal")
null_ids = {"timeline": base_tl, "tracks": [{"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [dict(item_media(None, 1, 5, 9, None, None, "UNHASHED_UNOWNED", "m"), field_status=fstat(unique_id="UNAVAILABLE", unique_id_reason="r", media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="r", media_id="NOT_REQUESTED")), dict(item_media(None, 0, 5, 9, None, None, "UNHASHED_UNOWNED", "m"), field_status=fstat(unique_id="UNAVAILABLE", unique_id_reason="r", media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="r", media_id="NOT_REQUESTED"))]}], "markers": [], "media_dependencies": []}
vec("null_unique_ids_ordered_by_ordinal", null_ids, "vidtoolz.resolveSnapshotPayload.v1.2", L.normalize_snapshot_payload, "unique_id null (UNAVAILABLE); observation_ordinal breaks the tie deterministically")
vec("nullable_fields_explicit_null", {"media_id": None, "source_sha256": None, "source_locator": None}, note="nullable fields are emitted as null, never omitted")
dump("fixtures/canonicalization/vectors.json", {"schema": "vidtoolz.resolveCanonicalizationVectors.v1.2", "spec": "CANONICALIZATION.md v1.2", "digest_rule": "sha256(utf8(domain) + 0x0A + canonical_bytes)", "registered_domains": sorted(L.HASH_DOMAINS), "reference_implementation": "tools/authority_lib.py", "vectors": vectors})
dump("fixtures/canonicalization/rejections.json", {"schema": "vidtoolz.resolveCanonicalizationRejections.v1.2", "cases": [
    {"name": "marker_exact_duplicate", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", ""), mk("timeline", 5, 1, "", "m", "Blue", "")], "expect": "MARKER_COLLISION"},
    {"name": "marker_same_object_frame_different_note", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", "a"), mk("timeline", 5, 1, "", "m", "Blue", "b")], "expect": "MARKER_COLLISION"},
    {"name": "f64_not_hex", "kind": "canon", "input": {"$f64": "NOT_HEX"}, "expect": "$f64"},
    {"name": "f64_uppercase", "kind": "canon", "input": {"$f64": "3FF0000000000000"}, "expect": "$f64"},
    {"name": "f64_short", "kind": "canon", "input": {"$f64": "3ff"}, "expect": "$f64"},
    {"name": "f64_nan", "kind": "canon", "input": {"$f64": "7ff8000000000000"}, "expect": "NaN"},
    {"name": "f64_infinity", "kind": "canon", "input": {"$f64": "7ff0000000000000"}, "expect": "NaN"},
    {"name": "f64_negative_zero", "kind": "canon", "input": {"$f64": "8000000000000000"}, "expect": "negative zero"},
    {"name": "rational_unreduced", "kind": "canon", "input": {"$rational": "2/4"}, "expect": "reduced"},
    {"name": "rational_zero_denominator", "kind": "canon", "input": {"$rational": "1/0"}, "expect": "$rational"},
    {"name": "rational_negative", "kind": "canon", "input": {"$rational": "-1/2"}, "expect": "$rational"},
    {"name": "bare_float", "kind": "canon", "input": {"x": 1.5}, "expect": "bare float"},
    {"name": "string_track_index", "kind": "tracks", "input": [{"type": "video", "index": "2"}], "expect": "integer"},
    {"name": "duplicate_track_address", "kind": "tracks", "input": [{"type": "video", "index": 1}, {"type": "video", "index": 1}], "expect": "duplicate"},
    {"name": "unregistered_domain", "kind": "domain", "input": {}, "domain": "vidtoolz.unregistered", "expect": "unregistered"},
]})
with open(os.path.join(B, "fixtures/parse/duplicate-key.json.txt"), "w") if os.makedirs(os.path.join(B, "fixtures/parse"), exist_ok=True) is None else None as f:
    f.write('{"schema":"vidtoolz.resolveGeneric.v1","a":1,"a":2}\n')
with open(os.path.join(B, "fixtures/parse/clean.json.txt"), "w") as f:
    f.write('{"schema":"vidtoolz.resolveGeneric.v1","a":1,"b":2}\n')

# ============================================================ READ PRIMITIVES + CAPABILITIES v1.2 (evidence records)
PRIOR = [
    {"host": "vidnux", "resolve_version": "21.0.0b.28", "build": None, "run_ref": "resolve-hermes live validation (docs/render-readiness-field-map.md:43)", "method": "GetCurrentProject", "observed_result": "current project PYSTY UHD", "evidence_path": "/home/vidtoolz/resolve-hermes/docs/render-readiness-field-map.md", "evidence_sha256": None, "version_match": False},
    {"host": "vidnux", "resolve_version": "21.0.0b.28", "build": None, "run_ref": "resolve-hermes live validation", "method": "GetCurrentTimeline", "observed_result": "current timeline traileri", "evidence_path": "/home/vidtoolz/resolve-hermes/docs/render-readiness-field-map.md", "evidence_sha256": None, "version_match": False},
    {"host": "vidnux", "resolve_version": "21.0.3", "build": 7, "run_ref": "FRB supervised acceptance 2026-08-01 (isolated Resolve, real renders)", "method": "GetStart", "observed_result": "used as MarkIn for successful renders", "evidence_path": "/home/vidtoolz/outputs/fusion-replica-builder-supervised-lower-third-20260801-183905/resolve-evidence/", "evidence_sha256": None, "version_match": False},
    {"host": "vidnux", "resolve_version": "21.0.3", "build": 7, "run_ref": "FRB supervised acceptance 2026-08-01", "method": "GetDuration", "observed_result": "used as MarkOut basis for successful renders", "evidence_path": "/home/vidtoolz/outputs/fusion-replica-builder-supervised-lower-third-20260801-183905/resolve-evidence/", "evidence_sha256": None, "version_match": False},
    {"host": "vidnux", "resolve_version": "21.0.3", "build": 7, "run_ref": "FRB supervised acceptance 2026-08-01", "method": "GetCurrentDatabase", "observed_result": "Local Database guard executed", "evidence_path": "/home/vidtoolz/outputs/fusion-replica-builder-supervised-lower-third-20260801-183905/resolve-evidence/", "evidence_sha256": None, "version_match": False},
]
for r in PRIOR:
    try:
        r["evidence_sha256"] = hashlib.sha256(open(r["evidence_path"], "rb").read()).hexdigest() if os.path.isfile(r["evidence_path"]) else None
    except OSError:
        r["evidence_sha256"] = None
prior_by_method = {}
for r in PRIOR:
    prior_by_method.setdefault(r["method"], []).append(r)
EV = ["QUALIFIED_READ", "DOCUMENTED_NOT_QUALIFIED", "NOT_TESTED", "UNSUPPORTED", "BLOCKED", "QUALIFIED_EF_SIDE"]


def row(op, cls, prims, evidence_class, evidence, probes=None, blocked_until=None, note=None, m3_question=None, records=None):
    d = {"operation": op, "class": cls, "primitives": prims, "evidence_class": evidence_class, "evidence": evidence, "evidence_records": records or [r for p in prims for r in prior_by_method.get(p, [])], "m3_probes": probes or [], "blocked_until": blocked_until}
    if note:
        d["qualification_note"] = note
    if m3_question:
        d["m3_question"] = m3_question
    return d


READ_ROWS = [
    ("read: connection", ["GetVersionString", "GetProductName", "GetProjectManager", "GetCurrentDatabase"], "no evidence on 21.1.0 build 14; prior-version records attached where they exist"),
    ("read: project enumeration", ["GetProjectListInCurrentFolder", "GetCurrentProject", "Project.GetName"], "resolve-hermes evidence is on 21.0.0b.28 (version mismatch)"),
    ("read: timeline enumeration", ["GetTimelineCount", "GetTimelineByIndex", "GetCurrentTimeline", "Timeline.GetName"], "prior-version evidence only"),
    ("read: track enumeration", ["GetTrackCount", "GetItemListInTrack", "GetTrackName"], "Scorecraft driver never recorded a pass; FRB used GetStart/GetDuration on 21.0.3"),
    ("read: item position (integer form)", ["GetStart", "GetEnd", "GetDuration", "TimelineItem.GetName", "GetMediaPoolItem", "GetClipEnabled"], "GetStart/GetDuration evidenced on 21.0.3 only; GetEnd never evidenced"),
    ("read: subframe precision variants", ["GetStart(True)", "GetEnd(True)", "GetDuration(True)", "GetLeftOffset(True)", "GetRightOffset(True)"], "never called in estate"),
    ("read: source boundary methods", ["GetSourceStartFrame", "GetSourceEndFrame", "GetSourceStartTime", "GetSourceEndTime"], "never called in estate"),
    ("read: plural settings/properties", ["Project.GetSettings", "Timeline.GetSettings", "TimelineItem.GetProperties", "GetClipProperty"], "estate used ONLY deprecated singular forms"),
    ("read: object identity (readable now)", ["Project.GetUniqueId", "Timeline.GetUniqueId", "TimelineItem.GetUniqueId", "MediaPoolItem.GetUniqueId", "MediaPoolItem.GetMediaId", "Folder.GetUniqueId"], "stub only; readability on 21.1 build 14 unproven"),
    ("read: track lock/enable getters", ["GetIsTrackLocked", "GetIsTrackEnabled"], "stub only"),
    ("read: timeline/project metadata", ["GetStartFrame", "GetEndFrame", "GetStartTimecode", "GetProjectLastModifiedTime", "GetMarkers", "GetMarkerByCustomData"], "GetStartFrame used by hardlink fixture/FRB on prior versions"),
]
rows = [row(op, "DIRECT_API", prims, "DOCUMENTED_NOT_QUALIFIED", ev, ["P0-read"], "M0", note="QUALIFIED_READ requires an exact evidence record on 21.1.0 build 14 for the same method; none exists") for op, prims, ev in READ_ROWS]
rows.append(row("identity: GetUniqueId survives mutation (separate claim)", "DIRECT_API", ["TimelineItem.GetUniqueId(survival)", "MediaPoolItem.GetUniqueId(survival)", "Timeline.GetUniqueId(survival)"], "NOT_TESTED", "survival across DuplicateTimeline/DRT/FinalizeTake/delete+append/rename/save+reopen is a mutation-era claim", ["P6", "P15"], "M3", m3_question="which ids survive which operation; separate from readability"))
caps11 = load("CAPABILITIES.json", V11)
for r in caps11["rows"]:
    if r["operation"].startswith("read:"):
        continue
    r.setdefault("evidence_records", [])
    rows.append(r)
caps = {"schema": "vidtoolz.resolveCapabilityMatrix.v1.2", "version": "1.2.0", "status": "FROZEN_NOW", "qualification_note": "v1.2: every read row downgraded to DOCUMENTED_NOT_QUALIFIED because no evidence record exists on Resolve 21.1.0 build 14; prior-version records are attached with version_match=false; M0 READ_PRIMITIVE_QUALIFICATION_PROBE produces the exact records", "evidence_class_vocabulary": EV, "evidence_class_definitions": dict(caps11["evidence_class_definitions"], QUALIFIED_READ="read-only method exercised on the contract Resolve version/build (21.1.0 b14) on the contract host, with a recorded run reference, observed result and evidence path/hash for that exact method"), "evidence_record_fields": ["host", "resolve_version", "build", "run_ref", "method", "observed_result", "evidence_path", "evidence_sha256", "version_match"], "resolve": caps11["resolve"], "coverage_caveat": caps11["coverage_caveat"], "rows": rows}
dump("CAPABILITIES.json", caps)
cap_schema = load("schemas/resolveCapabilityMatrix.schema.json", V11)
cap_schema["$id"] = "vidtoolz.resolveCapabilityMatrix.v1.2"
cap_schema["properties"]["schema"] = {"const": "vidtoolz.resolveCapabilityMatrix.v1.2"}
cap_schema["properties"]["evidence_record_fields"] = {"type": "array"}
cap_schema["properties"]["rows"]["items"]["properties"]["evidence_records"] = {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["host", "resolve_version", "build", "run_ref", "method", "observed_result", "evidence_path", "evidence_sha256", "version_match"], "properties": {"host": {"type": "string"}, "resolve_version": {"type": "string"}, "build": {"type": ["integer", "null"]}, "run_ref": {"type": "string"}, "method": {"type": "string"}, "observed_result": {"type": "string"}, "evidence_path": {"type": "string"}, "evidence_sha256": SHA_OR_NULL, "version_match": {"type": "boolean"}}}}
cap_schema["properties"]["rows"]["items"]["required"] = sorted(set(cap_schema["properties"]["rows"]["items"]["required"]) | {"evidence_records"})
dump("schemas/resolveCapabilityMatrix.schema.json", cap_schema)
fixture("capabilities-frozen", "none", "resolveCapabilityMatrix", caps, check="semantic_capabilities")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"
fixture("capabilities-qualified-read-without-exact-evidence", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="without exact")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED"
fixture("capabilities-unknown-evidence-class", "schema", "resolveCapabilityMatrix", neg, expect_contains="enum")
method_class = {}
for r in rows:
    for p in r["primitives"]:
        method_class.setdefault(p, r["evidence_class"])


def prim(method, fallback):
    return {"method": method, "evidence_class": method_class[method], "evidence_ref": [x["run_ref"] for x in prior_by_method.get(method, [])] or ["none on 21.1.0 build 14"], "milestones_available": ["M0", "M1", "M2", "M3"], "fallback_if_unqualified": fallback}


rp = {"schema": "vidtoolz.resolveReadPrimitives.v1.2", "version": "1.2.0", "status": "FROZEN_NOW", "law": "a logical read operation expands to primitives; a primitive whose evidence_class is not QUALIFIED_READ is never called silently: SNAPSHOT_CAPTURE marks the field UNAVAILABLE or downgrades coverage; only READ_PRIMITIVE_QUALIFICATION_PROBE may call DOCUMENTED_NOT_QUALIFIED getters, explicitly, to produce evidence records",
      "logical_operations": {
          "READ_PRIMITIVE_QUALIFICATION_PROBE": {"purpose": "M0 preflight: call each DOCUMENTED_NOT_QUALIFIED read getter explicitly and record an evidence record per method", "primitives": [prim(m, "PROBE_ONLY") for m in sorted({p for op, prims, _ in READ_ROWS for p in prims})], "output": "capabilities evidence_records for bundle v1.3 refreeze"},
          "CONNECT": {"primitives": [prim(m, "REFUSE") for m in ["GetVersionString", "GetProductName", "GetProjectManager", "GetCurrentDatabase"]]},
          "ENUMERATE_PROJECTS": {"primitives": [prim(m, "DOWNGRADE_COVERAGE") for m in ["GetProjectListInCurrentFolder", "GetCurrentProject", "Project.GetName"]]},
          "ENUMERATE_TIMELINES": {"primitives": [prim(m, "DOWNGRADE_COVERAGE") for m in ["GetTimelineCount", "GetTimelineByIndex", "GetCurrentTimeline", "Timeline.GetName"]]},
          "SNAPSHOT_CAPTURE": {"primitives": [prim("GetTrackCount", "DOWNGRADE_COVERAGE"), prim("GetItemListInTrack", "DOWNGRADE_COVERAGE"), prim("GetTrackName", "MARK_UNAVAILABLE"), prim("GetStart", "DOWNGRADE_COVERAGE"), prim("GetEnd", "DOWNGRADE_COVERAGE"), prim("GetDuration", "MARK_UNAVAILABLE"), prim("TimelineItem.GetName", "MARK_UNAVAILABLE"), prim("GetMediaPoolItem", "MARK_UNAVAILABLE"), prim("GetClipEnabled", "MARK_UNAVAILABLE"), prim("GetStartFrame", "DOWNGRADE_COVERAGE"), prim("GetEndFrame", "DOWNGRADE_COVERAGE"), prim("GetStartTimecode", "MARK_UNAVAILABLE"), prim("Timeline.GetUniqueId", "MARK_UNAVAILABLE"), prim("Project.GetUniqueId", "MARK_UNAVAILABLE"), prim("TimelineItem.GetUniqueId", "MARK_UNAVAILABLE"), prim("MediaPoolItem.GetUniqueId", "MARK_UNAVAILABLE"), prim("MediaPoolItem.GetMediaId", "MARK_UNAVAILABLE"), prim("GetSourceStartFrame", "MARK_UNAVAILABLE"), prim("GetSourceEndFrame", "MARK_UNAVAILABLE"), prim("GetIsTrackLocked", "MARK_UNAVAILABLE"), prim("GetIsTrackEnabled", "MARK_UNAVAILABLE"), prim("GetMarkers", "DOWNGRADE_COVERAGE"), prim("Timeline.GetSettings", "DOWNGRADE_COVERAGE"), prim("Project.GetSettings", "DOWNGRADE_COVERAGE"), prim("GetClipProperty", "MARK_UNAVAILABLE")]},
          "TIMEBASE_OBSERVE": {"primitives": [prim("GetStartFrame", "REFUSE"), prim("GetStartTimecode", "REFUSE"), prim("Timeline.GetSettings", "REFUSE")]},
          "TRIPWIRE_READ": {"primitives": [prim("GetProjectLastModifiedTime", "MARK_UNAVAILABLE")]},
      }}
dump("READ-PRIMITIVES.json", rp)
rp_schema = S("vidtoolz.resolveReadPrimitives.v1.2", "Logical read operation -> primitive mapping", {"schema": {"const": "vidtoolz.resolveReadPrimitives.v1.2"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "law": {"type": "string"}, "logical_operations": {"type": "object", "additionalProperties": {"type": "object", "required": ["primitives"], "properties": {"purpose": {"type": "string"}, "output": {"type": "string"}, "primitives": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["method", "evidence_class", "evidence_ref", "milestones_available", "fallback_if_unqualified"], "properties": {"method": {"type": "string"}, "evidence_class": {"enum": EV}, "evidence_ref": {"type": "array", "items": {"type": "string"}}, "milestones_available": {"type": "array", "items": {"enum": ["M0", "M1", "M2", "M3"]}}, "fallback_if_unqualified": {"enum": ["MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE", "REFUSE", "PROBE_ONLY"]}}}}}, "additionalProperties": False}}}, ["schema", "version", "status", "law", "logical_operations"])
dump("schemas/resolveReadPrimitives.schema.json", rp_schema)
fixture("read-primitives-frozen", "none", "resolveReadPrimitives", rp, check="semantic_read_primitives")
neg = copy.deepcopy(rp); neg["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"][0]["evidence_class"] = "QUALIFIED_READ"
fixture("read-primitives-class-mismatch-with-matrix", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="!= matrix")

# ============================================================ PERMISSIONS v1.2 (declaration + prerequisites) + eligibility fixtures
READ_OPS = ["CONNECT", "ENUMERATE_PROJECTS", "ENUMERATE_TIMELINES", "SNAPSHOT_CAPTURE", "TIMEBASE_OBSERVE", "TRIPWIRE_READ"]
M0_READ_PREREQ = ["BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHED_READ_ONLY", "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "RESOLVE_VERSION_MATCHES", "READ_ONLY_JOURNAL_OPEN", "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED"]
entries = []
entries.append({"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE, "allowed": True, "prerequisites": ["BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHMENT_READY", "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "READ_ONLY_JOURNAL_OPEN"], "evidence_prerequisite": "first M0 operation; qualifies read getters by explicit probe; produces evidence records", "mutation_allowed": False, "shared_library_allowed": False})
for m in ("M0", "M1", "M2", "M3"):
    for op in READ_OPS:
        pre = list(M0_READ_PREREQ) if op != "CONNECT" else ["BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHMENT_READY", "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "READ_ONLY_JOURNAL_OPEN", "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED"]
        if m == "M1":
            pre = pre + ["M0_EXIT_EVIDENCE"]
        if m in ("M2", "M3"):
            pre = pre + ["M1_EXIT_EVIDENCE"]
        entries.append({"milestone": m, "operation": op, "scope": SCOPE, "allowed": True, "prerequisites": pre, "evidence_prerequisite": "read-only; primitives expand per READ-PRIMITIVES.json", "mutation_allowed": False, "shared_library_allowed": False})
for m in ("M2", "M3"):
    entries.append({"milestone": m, "operation": "SetCurrentTimeline", "scope": SCOPE, "allowed": True, "prerequisites": ["M1_EXIT_EVIDENCE", "TARGET_STATE_ATTACHED_READ_ONLY", "PROJECT_ADAPTER_PREFIXED", "READ_ONLY_JOURNAL_OPEN"], "evidence_prerequisite": "navigation only, adapter-prefixed project", "mutation_allowed": False, "shared_library_allowed": False})
    entries.append({"milestone": m, "operation": "BUILD_MUTATION_PLAN_DRY_RUN", "scope": SCOPE, "allowed": True, "prerequisites": ["M1_EXIT_EVIDENCE", "GUARD_CURRENT"], "evidence_prerequisite": "dry_run=true only", "mutation_allowed": False, "shared_library_allowed": False})
M3_PRE = ["M2_EXIT_EVIDENCE", "MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY", "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "PROJECT_ADAPTER_PREFIXED", "EXCLUSIVE_SESSION_ATTESTED", "JOURNAL_PREPARED", "PLAN_VALIDATED"]
PLAN_OPS = {"IMPORT_MEDIA": "ImportMedia", "APPEND": "AppendToTimeline", "DELETE": "DeleteClips_noRipple", "DISABLE": "SetClipEnabled", "ENABLE": "SetClipEnabled", "SET_TAKE": "AddTake_SelectTake_FinalizeTake", "UPSERT_MARKER": "AddMarker", "SET_PROPERTIES": "SetProperties", "CHECKPOINT_DUPLICATE": "DuplicateTimeline", "CHECKPOINT_EXPORT_DRT": "ExportTimelineDRT", "SAVE_PROJECT": "SaveProject"}
for pop, api in PLAN_OPS.items():
    pre = list(M3_PRE) + (["GUARD_CURRENT", "TIMELINE_IS_DESTINATION"] if pop in L.GUARD_REQUIRED_OPS else []) + (["SYNTHETIC_MEDIA_ONLY"] if pop == "IMPORT_MEDIA" else [])
    entries.append({"milestone": "M3", "operation": pop, "scope": SCOPE, "allowed": True, "prerequisites": pre, "evidence_prerequisite": f"plan-level op executing {api}", "mutation_allowed": True, "shared_library_allowed": False})
API_MUT = {"ImportMedia": ["P19"], "AppendToTimeline": ["P1", "P2", "P3", "P4", "P5", "P13"], "DeleteClips_noRipple": ["P13"], "SetClipEnabled": ["P14"], "AddMarker": ["P7"], "UpdateMarkerCustomData": ["P7"], "DeleteMarkerByCustomData": ["P7"], "SetSettings": ["P8"], "SetTrackLock": ["P9"], "AddTrack": ["P1", "P9"], "AddTake_SelectTake_FinalizeTake": ["P6"], "DuplicateTimeline": ["P6"], "ExportTimelineDRT": ["P6"], "ImportTimelineFromFileDRT": ["P6"], "SetProperties": ["P17"]}
for api, probes in API_MUT.items():
    pre = list(M3_PRE) + (["GUARD_CURRENT", "TIMELINE_IS_DESTINATION"] if api not in ("ImportMedia", "DuplicateTimeline", "ExportTimelineDRT", "ImportTimelineFromFileDRT") else []) + (["SYNTHETIC_MEDIA_ONLY"] if api in ("ImportMedia", "ImportTimelineFromFileDRT") else [])
    entries.append({"milestone": "M3", "operation": api, "scope": SCOPE, "allowed": True, "prerequisites": pre, "evidence_prerequisite": f"M3 probes {','.join(probes)}", "mutation_allowed": True, "shared_library_allowed": False})
for api in ("CreateProject", "CreateEmptyTimeline", "SaveProject", "LoadProject_adapterPrefixed"):
    entries.append({"milestone": "M3", "operation": api, "scope": SCOPE, "allowed": True, "prerequisites": ["M2_EXIT_EVIDENCE", "MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY", "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "PROJECT_ADAPTER_PREFIXED", "JOURNAL_PREPARED"], "evidence_prerequisite": "scratch lifecycle P15/P16: adapter-prefixed project in the qualification library only", "mutation_allowed": True, "shared_library_allowed": False})
perms = {"schema": "vidtoolz.resolvePermissions.v1.2", "version": "1.2.0", "status": "FROZEN_NOW", "default": "DENY",
         "law": "PERMISSION DECLARATION (allowed:true) != AUTHORIZATION ELIGIBILITY. Eligibility is evaluated deterministically by authority_lib.evaluate_eligibility over (milestone, operation, scope, target state, evidence set, capability state, journal, guard, authorization token) and fails closed on any unknown or missing input.",
         "milestones": ["M0", "M1", "M2", "M3"], "scopes": [SCOPE], "prohibited_scopes": ["LOCAL_STAGING_LIBRARY", "PRODUCTION_LIBRARY", "USER_LOCAL_DATABASE", "NETWORK_LIBRARY_EKA"],
         "prerequisite_codes": sorted(L.PREREQ_CODES),
         "target_contract_ref": {"host_name": "vidnux", "library_name": "VIDTOOLZ Resolve Qualification v1", "prohibited_library_names": tc["library"]["prohibited_library_names"], "project_prefix": "VIDTOOLZ_RESOLVE_QUAL_V1_", "resolve_version": "21.1.0.0014"},
         "denied_all_scopes": ["SetCurrentDatabase", "CloseProject", "ImportProject", "DeleteTimelines", "DeleteClips_ripple", "ReplaceClip", "ReplaceClipPreserveSubClip", "RelinkClips", "UnlinkClips", "run_script", "run_script_unsafe", "execute_python", "execute_lua", "StartRendering", "AddRenderJob", "LoadProject_nonPrefixed", "SetClipProperty", "DeleteProject"],
         "plan_op_to_api": PLAN_OPS, "scratch_lifecycle": {"granted_at": "M3", "operations": ["CreateProject", "CreateEmptyTimeline", "SaveProject", "LoadProject_adapterPrefixed"], "constraints": ["project name prefix VIDTOOLZ_RESOLVE_QUAL_V1_", "library == TARGET-CONTRACT qualification library in state SCRATCH_WRITE_READY", "never EKA, never user's Local Database, never library switching"]},
         "entries": entries}
dump("PERMISSIONS.json", perms)
perm_schema = load("schemas/resolvePermissions.schema.json", V11)
perm_schema["$id"] = "vidtoolz.resolvePermissions.v1.2"
perm_schema["properties"]["schema"] = {"const": "vidtoolz.resolvePermissions.v1.2"}
perm_schema["properties"]["law"] = {"type": "string"}
perm_schema["properties"]["prerequisite_codes"] = {"type": "array", "items": {"enum": sorted(L.PREREQ_CODES)}}
perm_schema["properties"]["target_contract_ref"] = {"type": "object", "additionalProperties": False, "required": ["host_name", "library_name", "prohibited_library_names", "project_prefix", "resolve_version"], "properties": {"host_name": {"type": "string", "minLength": 1}, "library_name": {"type": "string"}, "prohibited_library_names": {"type": "array"}, "project_prefix": {"type": "string", "minLength": 1}, "resolve_version": {"type": "string"}}}
perm_schema["properties"]["entries"]["items"]["properties"]["prerequisites"] = {"type": "array", "items": {"enum": sorted(L.PREREQ_CODES)}}
perm_schema["properties"]["entries"]["items"]["required"] = sorted(set(perm_schema["properties"]["entries"]["items"]["required"]) | {"prerequisites"})
perm_schema.pop("properties", None) if False else None
perm_schema["required"] = sorted(set(perm_schema["required"]) | {"law", "prerequisite_codes", "target_contract_ref"})
dump("schemas/resolvePermissions.schema.json", perm_schema)
fixture("permissions-frozen", "none", "resolvePermissions", perms)
neg = copy.deepcopy(perms); neg["default"] = "ALLOW"; fixture("permissions-default-allow", "schema", "resolvePermissions", neg, expect_contains="DENY")
neg = copy.deepcopy(perms); neg["entries"][0]["shared_library_allowed"] = True; fixture("permissions-shared-library-grant", "schema", "resolvePermissions", neg, expect_contains="False")
neg = copy.deepcopy(perms); neg["entries"][0]["prerequisites"] = ["TRUST_ME"]; fixture("permissions-unknown-prerequisite-code", "schema", "resolvePermissions", neg, expect_contains="enum")

# eligibility fixtures (item 17)
def m0_target(**kw):
    t = {"attachment_state": "ATTACHED_READ_ONLY", "host_name": "vidnux", "library_name": "VIDTOOLZ Resolve Qualification v1", "library_kind": "Disk", "observed_database_name": "VIDTOOLZ Resolve Qualification v1", "project_name": "VIDTOOLZ_RESOLVE_QUAL_V1_M0_scratch", "resolve_version": "21.1.0.0014", "timeline_unique_id": "tl-1"}
    t.update(kw)
    return t


base_ev = {"bundle_independent_verification_sha256": "c" * 64}
post_probe_caps = {m: "QUALIFIED_READ" for m in ["GetVersionString", "GetProductName", "GetProjectManager", "GetCurrentDatabase", "GetTrackCount", "GetItemListInTrack", "GetStart", "GetEnd", "GetStartFrame", "GetEndFrame", "GetMarkers", "Timeline.GetSettings", "Project.GetSettings", "GetStartTimecode"]}
elig = [
    ("m0-probe-allow", {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE, "target": m0_target(attachment_state="ATTACHMENT_READY", observed_database_name=None), "evidence": base_ev, "journal_available": True}, True),
    ("m0-snapshot-allow-post-probe", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, True),
    ("m0-snapshot-allow-pre-probe-degraded", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(), "evidence": base_ev, "journal_available": True, "capability_state": {}}, True),
    ("m0-connect-deny-pre-probe-refuse-fallback", {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE, "target": m0_target(attachment_state="ATTACHMENT_READY"), "evidence": base_ev, "journal_available": True, "capability_state": {}}, False),
    ("m0-connect-allow-post-probe", {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE, "target": m0_target(attachment_state="ATTACHMENT_READY"), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, True),
    ("m0-deny-unprovisioned", {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE, "target": m0_target(attachment_state="UNPROVISIONED"), "evidence": base_ev, "journal_available": True}, False),
    ("m0-deny-eka-target", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(observed_database_name="EKA", library_kind="PostgreSQL"), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, False),
    ("m0-deny-unknown-library", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(observed_database_name="Some Other Library"), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, False),
    ("m0-deny-production-project-name", {"milestone": "M2", "operation": "SetCurrentTimeline", "scope": SCOPE, "target": m0_target(project_name="PYSTY UHD"), "evidence": dict(base_ev, m1_exit_evidence_sha256="d" * 64), "journal_available": True}, False),
    ("m0-deny-wrong-host", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(host_name="PRESTO"), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, False),
    ("m0-deny-missing-bundle-verification", {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE, "target": m0_target(attachment_state="ATTACHMENT_READY"), "evidence": {}, "journal_available": True}, False),
    ("m0-deny-version-mismatch", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(resolve_version="21.0.4.0005"), "evidence": base_ev, "journal_available": True, "capability_state": post_probe_caps}, False),
    ("m0-deny-no-journal", {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(), "evidence": base_ev, "journal_available": False, "capability_state": post_probe_caps}, False),
    ("m0-deny-write-op", {"milestone": "M0", "operation": "APPEND", "scope": SCOPE, "target": m0_target(), "evidence": base_ev, "journal_available": True}, False),
    ("m3-append-deny-without-authorization", {"milestone": "M3", "operation": "APPEND", "scope": SCOPE, "target": m0_target(attachment_state="SCRATCH_WRITE_READY"), "evidence": dict(base_ev, m1_exit_evidence_sha256="d" * 64, m2_exit_evidence_sha256="e" * 64, journal_prepared_record_sha256="f" * 64, exclusive_session_attestation_sha256="1" * 64, plan_semantic_validation="PASS", current_guard_digest="2" * 64, plan_h0_guard_digest="2" * 64, destination_timeline_unique_id="tl-1"), "journal_available": True, "guard_available": True}, False),
    ("m3-append-allow-full-evidence", {"milestone": "M3", "operation": "APPEND", "scope": SCOPE, "target": m0_target(attachment_state="SCRATCH_WRITE_READY"), "evidence": dict(base_ev, m1_exit_evidence_sha256="d" * 64, m2_exit_evidence_sha256="e" * 64, journal_prepared_record_sha256="f" * 64, exclusive_session_attestation_sha256="1" * 64, plan_semantic_validation="PASS", current_guard_digest="2" * 64, plan_h0_guard_digest="2" * 64, destination_timeline_unique_id="tl-1"), "journal_available": True, "guard_available": True, "authorization_token": "3" * 64}, True),
    ("m3-append-deny-stale-guard", {"milestone": "M3", "operation": "APPEND", "scope": SCOPE, "target": m0_target(attachment_state="SCRATCH_WRITE_READY"), "evidence": dict(base_ev, m1_exit_evidence_sha256="d" * 64, m2_exit_evidence_sha256="e" * 64, journal_prepared_record_sha256="f" * 64, exclusive_session_attestation_sha256="1" * 64, plan_semantic_validation="PASS", current_guard_digest="9" * 64, plan_h0_guard_digest="2" * 64, destination_timeline_unique_id="tl-1"), "journal_available": True, "guard_available": True, "authorization_token": "3" * 64}, False),
    ("m3-deny-shared-library-scope", {"milestone": "M3", "operation": "APPEND", "scope": "NETWORK_LIBRARY_EKA", "target": m0_target(attachment_state="SCRATCH_WRITE_READY"), "evidence": base_ev, "journal_available": True}, False),
    ("m4-deny-unknown-milestone", {"milestone": "M4", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE, "target": m0_target(), "evidence": base_ev, "journal_available": True}, False),
    ("deny-unknown-operation", {"milestone": "M3", "operation": "FrobnicateTimeline", "scope": SCOPE, "target": m0_target(attachment_state="SCRATCH_WRITE_READY"), "evidence": base_ev, "journal_available": True}, False),
]
dump("fixtures/eligibility/cases.json", {"schema": "vidtoolz.resolveEligibilityFixtures.v1.2", "cases": [{"name": n, "request": r, "expect_eligible": e} for n, r, e in elig]})

# ============================================================ MILESTONE MATRIX (machine-checkable)
matrix = {"schema": "vidtoolz.resolveMilestoneMatrix.v1.2", "version": "1.2.0", "status": "FROZEN_NOW", "derived_from": ["PERMISSIONS.json", "READ-PRIMITIVES.json"], "invariants": ["M0 permits only read logical operations and the explicit read-primitive qualification probe; mutation_allowed is false for every M0/M1/M2 entry", "M1 is offline contract work; its Resolve read entries require M0_EXIT_EVIDENCE", "M2 adds SetCurrentTimeline (adapter-prefixed) and dry-run plan construction; no mutator", "M3 is the only milestone with mutation_allowed entries; every one requires MIKKO_M3_AUTHORIZATION and TARGET_STATE_SCRATCH_WRITE_READY", "the shared library is not a scope; no entry can grant it"], "milestones": {}}
for m in perms["milestones"]:
    es = [e for e in entries if e["milestone"] == m]
    matrix["milestones"][m] = {"read_operations": sorted(e["operation"] for e in es if not e["mutation_allowed"]), "mutation_operations": sorted(e["operation"] for e in es if e["mutation_allowed"]), "denied_all_scopes": perms["denied_all_scopes"], "scopes": perms["scopes"]}
dump("MILESTONE-MATRIX.json", matrix)

# ============================================================ M3 probes (machine list) — 19 probes P1..P19; P0 is an M0 preflight reference
probes = [
    ("P1", "AppendToTimeline targets the current timeline", ["SetCurrentTimeline", "AppendToTimeline", "AddTrack"]),
    ("P2", "recordFrame origin", ["AppendToTimeline"]), ("P3", "endFrame inclusivity", ["AppendToTimeline"]), ("P4", "still duration on append", ["AppendToTimeline"]), ("P5", "collision on occupied interval", ["AppendToTimeline"]),
    ("P6", "GetUniqueId survival", ["DuplicateTimeline", "ExportTimelineDRT", "ImportTimelineFromFileDRT", "DeleteClips_noRipple", "AppendToTimeline", "AddTake_SelectTake_FinalizeTake"]),
    ("P7", "marker customData limits/duplicates", ["AddMarker", "UpdateMarkerCustomData", "DeleteMarkerByCustomData"]), ("P8", "SetSettings partial failure", ["SetSettings"]), ("P9", "SetTrackLock vs API append", ["SetTrackLock", "AppendToTimeline", "AddTrack"]),
    ("P10", "-nogui non-render mutation (P1-P4, P7, P13 only)", ["AppendToTimeline", "AddMarker", "DeleteClips_noRipple"]), ("P11", "duplicate timeline name", ["CreateEmptyTimeline"]), ("P12", "GetProjectLastModifiedTime trust class", ["AppendToTimeline", "AddMarker", "SetClipEnabled", "SaveProject"]),
    ("P13", "replace one occurrence with a new occurrence", ["DeleteClips_noRipple", "AppendToTimeline"]), ("P14", "disable changes only the enabled flag (DISABLE != CUT)", ["SetClipEnabled"]), ("P15", "identity stable across rename/save/reopen", ["SaveProject", "LoadProject_adapterPrefixed"]),
    ("P16", "crash recovery at every phase boundary", ["AppendToTimeline", "AddMarker", "SaveProject"]), ("P17", "comparator exactness incl. SetProperties", ["SetProperties"]), ("P18", "Resolve crash mid-call", ["AppendToTimeline"]), ("P19", "import synthetic media into run-scoped bin", ["ImportMedia"]),
]
dump("M3-PROBES.json", {"schema": "vidtoolz.resolveM3Probes.v1.2", "status": "PROVISIONAL_UNTIL_M3", "count": len(probes), "preflight_reference": {"id": "P0-read", "milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "note": "P0 is an M0 read-getter qualification preflight, not an M3 probe"}, "probes": [{"id": i, "title": t, "operations": ops, "milestone": "M3", "scope": SCOPE} for i, t, ops in probes]})

# ============================================================ provisional schemas (plan/journal/commit/conflict) + semantic fixtures
mp = load("schemas/provisional/resolveMutationPlan.schema.json", V11)
mp["properties"]["target"] = {"type": "object", "additionalProperties": False, "required": ["library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "host_name", "library_name", "library_kind", "project_name", "resolve_version"], "properties": {"library_instance_uuid": UUID, "project_unique_id": {"type": "string"}, "timeline_unique_id": {"type": "string"}, "target_epoch": {"type": "string"}, "host_name": {"type": "string"}, "library_name": {"type": "string"}, "library_kind": {"enum": ["Disk"]}, "observed_database_name": {"type": ["string", "null"]}, "project_name": {"type": "string"}, "resolve_version": {"type": "string"}}}
mp["properties"]["target_attachment_state"] = {"enum": L.ATTACHMENT_STATES}
mp["properties"]["evidence"] = {"type": "object"}
mp["properties"]["authorization_token"] = SHA_OR_NULL
mp["properties"]["journal_available"] = {"type": "boolean"}
mp["properties"]["capability_state"] = {"type": "object", "additionalProperties": {"enum": EV}}
mp["required"] = sorted(set(mp["required"]) | {"target", "target_attachment_state", "evidence", "authorization_token", "journal_available"})
mp["$comment"] = "PROVISIONAL_UNTIL_M3. Semantic layer: permission class × op, selector completeness and target match, guard presence for guard-required ops, eligibility of every op via evaluate_eligibility (non-dry-run), dry-run law, no payload-as-guard."
dump("schemas/provisional/resolveMutationPlan.schema.json", mp)
jr = load("schemas/provisional/resolveTransactionJournal.schema.json", V11)
jr["properties"]["state"] = {"enum": sorted({s for v in L.JOURNAL_TRANSITIONS.values() for s in v} | {"PREPARED"})}
jr["$comment"] = "Append-only; contiguous sequence from 0; single transaction_id; hash chain; transitions per authority_lib.JOURNAL_TRANSITIONS incl. RECOVERY_RECONCILING -> {NOT_APPLIED, COMMITTED_RECOVERED, ORPHANED_PARTIAL, ORPHANED_AMBIGUOUS}; APPLIED requires a unique operation_id."
dump("schemas/provisional/resolveTransactionJournal.schema.json", jr)
cmm = load("schemas/provisional/resolveCommitManifest.schema.json", V11)
cmm["properties"]["verification_result_sha256"] = SHA
cmm["properties"]["guard_digest"] = SHA
cmm["properties"]["unresolved_conflicts"] = {"type": "array", "items": {"type": "string"}}
cmm["required"] = sorted(set(cmm["required"]) | {"verification_result_sha256", "guard_digest", "unresolved_conflicts"})
cmm["$comment"] = "Commit eligibility is never a naked terminal state: semantic_commit_manifest links journal identity/head, VERIFIED verification result digest, guard digest, terminal state, empty unresolved_conflicts and required evidence digests."
dump("schemas/provisional/resolveCommitManifest.schema.json", cmm)
for name in ("resolveSequenceLineage", "resolveBindingSet", "resolveBindingObservation", "resolveVerificationResult", "resolveConflict", "resolveCheckpoint"):
    shutil.copyfile(os.path.join(V11, f"schemas/provisional/{name}.schema.json"), os.path.join(B, f"schemas/provisional/{name}.schema.json"))
# provisional fixtures (layered: must pass schema when positive)
TGT = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "host_name": "vidnux", "library_name": "VIDTOOLZ Resolve Qualification v1", "library_kind": "Disk", "observed_database_name": "VIDTOOLZ Resolve Qualification v1", "project_name": "VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE", "resolve_version": "21.1.0.0014"}
FULL_EV = {"bundle_independent_verification_sha256": "c" * 64, "m1_exit_evidence_sha256": "d" * 64, "m2_exit_evidence_sha256": "e" * 64, "journal_prepared_record_sha256": "f" * 64, "exclusive_session_attestation_sha256": "1" * 64, "plan_semantic_validation": "PASS", "destination_timeline_unique_id": "tl-fixture-0001", "media_class": "SYNTHETIC"}
sel_append = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "track_type": "video", "track_index": 1}
plan_m3 = {"schema": "vidtoolz.resolveMutationPlan.v1", "plan_digest": "0" * 64, "milestone": "M3", "dry_run": False, "target": TGT, "target_attachment_state": "SCRATCH_WRITE_READY", "target_epoch": "epoch-fixture-1", "target_contract_digest": "1" * 64, "binding_set_digest": "2" * 64, "handoff_digest_sha256": "3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69", "h0_payload_sha256": snap_pos["payload_sha256"], "h0_guard_digest": snap_pos["guard_digest"], "capability_matrix_version": "1.2.0", "collector_version": "0.0.0-fixture", "timebase_digest": "4" * 64, "permission_class": "RESOLVE_ASSEMBLE", "scope": SCOPE, "lease": {}, "evidence": FULL_EV, "authorization_token": "3" * 64, "journal_available": True, "operations": [{"operation_id": "op-1", "op": "APPEND", "selector": sel_append, "expected_old": None, "expected_new": {"start": 110194, "end": 110541}, "allowed_created": ["one item"], "allowed_deleted": [], "declared_side_effects": []}]}
fixture("plan-m3-append-eligible", "none", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["permission_class"] = "RESOLVE_READ"; fixture("plan-read-class-with-append", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="RESOLVE_READ", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["operations"][0]["selector"]["project_unique_id"] = "proj-OTHER"; fixture("plan-selector-target-mismatch", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="does not match plan target", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["h0_guard_digest"] = "9" * 64; fixture("plan-stale-guard", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="STALE_SNAPSHOT", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["authorization_token"] = None; fixture("plan-missing-m3-authorization", "eligibility", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="MIKKO_M3_AUTHORIZATION", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["milestone"] = "M2"; p["dry_run"] = True; fixture("plan-m2-append-not-permitted", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="not permitted", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["operations"][0]["op"] = "DELETE"; p["operations"][0]["expected_old"] = {"unique_id": "it-1"}; fixture("plan-delete-selector-incomplete", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="selector incomplete", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["target"]["library_name"] = "Local Database"; p["target"]["observed_database_name"] = "Local Database"; fixture("plan-target-library-mismatch", "eligibility", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="LIBRARY", extra={"guard_digest": snap_pos["guard_digest"]})
p = copy.deepcopy(plan_m3); p["dry_run"] = False; p["milestone"] = "M2"; p["operations"] = []; fixture("plan-m2-non-dry-run", "schema", "provisional/resolveMutationPlan", p, expect_contains="minItems")
vr_ok = {"schema": "vidtoolz.resolveVerificationResult.v1", "plan_digest": "0" * 64, "h0_payload_sha256": "1" * 64, "s1_payload_sha256": "2" * 64, "added": ["it-new"], "removed": [], "changed": [], "creation_identity_map": {"op-1": "it-new"}, "missing_expected": [], "unrelated": [], "coverage": {}, "verdict": "VERIFIED", "is_human_approval": False}
fixture("verification-verified-clean", "none", "provisional/resolveVerificationResult", vr_ok, check="semantic_verification_result")
v = copy.deepcopy(vr_ok); v["unrelated"] = ["it-3 moved"]; fixture("verification-verified-with-unrelated", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="unrelated")


def jrec(seq, state, prev, tx="tx-fixture", opid=None):
    return {"schema": "vidtoolz.resolveTransactionJournal.v1", "transaction_id": tx, "sequence": seq, "previous_record_sha256": prev, "state": state, "plan_digest": "0" * 64, "operation_id": opid, "intent": {"phase": state}, "result": None, "readback_payload_sha256": None, "checkpoint": None, "recorded_at": "2026-09-08T00:00:00Z"}


def chain(states, tx="tx-fixture"):
    out = []
    prev = None
    for i, st in enumerate(states):
        r = jrec(i, st, prev, tx, opid=("op-1" if st == "APPLIED" else None))
        out.append(r)
        prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
    return out


legal = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"])
fixture("journal-legal-chain", "none", "provisional/resolveTransactionJournal", legal, check="semantic_journal")
rec = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "RECOVERY_RECONCILING", "COMMITTED_RECOVERED"])
fixture("journal-recovery-committed-recovered", "none", "provisional/resolveTransactionJournal", rec, check="semantic_journal")
rec2 = chain(["PREPARED", "RECOVERY_RECONCILING", "NOT_APPLIED"])
fixture("journal-recovery-not-applied", "none", "provisional/resolveTransactionJournal", rec2, check="semantic_journal")
b = copy.deepcopy(legal); b[4]["state"] = "COMMITTED"; fixture("journal-skip-to-committed", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="illegal transition")
b = copy.deepcopy(legal); b[3]["previous_record_sha256"] = "f" * 64; fixture("journal-broken-hash-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="hash chain")
b = copy.deepcopy(legal); b[2]["sequence"] = 1; fixture("journal-repeated-sequence", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="repeated sequence")
b = copy.deepcopy(legal); b[2]["sequence"] = 5; fixture("journal-sequence-gap", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="gap")
b = copy.deepcopy(legal); b[3]["transaction_id"] = "tx-other"; fixture("journal-transaction-id-change", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="transaction_id changed")
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "APPLIED"]); fixture("journal-operation-id-reused", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="applied twice")
b = copy.deepcopy(legal) + [jrec(10, "APPLIED", L.journal_head(legal), opid="op-9")]; fixture("journal-record-after-terminal", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="after terminal")
commit_ok = {"schema": "vidtoolz.resolveCommitManifest.v1", "transaction_id": "tx-fixture", "plan_digest": "0" * 64, "terminal_state": "COMMITTED", "binding_observation_sha256": "5" * 64, "binding_set_digest": "2" * 64, "receipt_sha256": "6" * 64, "journal_head_sha256": L.journal_head(legal), "verification_result_sha256": L.digest(vr_ok, "vidtoolz.resolveGeneric.v1"), "guard_digest": snap_pos["guard_digest"], "unresolved_conflicts": [], "ef_source_pins": {}, "published_at": "2026-09-08T00:00:00Z"}
fixture("commit-linked-eligible", "none", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", extra={"journal": legal, "verification_result": vr_ok, "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); fixture("commit-journal-not-published", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="last state", extra={"journal": chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "READBACK_S1", "VERIFIED"]), "verification_result": vr_ok, "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); fixture("commit-verification-not-verified", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="VERIFIED", extra={"journal": legal, "verification_result": dict(vr_ok, verdict="UNEXPECTED_DELTA", unrelated=["x"]), "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); c["journal_head_sha256"] = "7" * 64; fixture("commit-journal-head-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="journal_head", extra={"journal": legal, "verification_result": vr_ok, "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); c["guard_digest"] = "8" * 64; fixture("commit-guard-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="guard", extra={"journal": legal, "verification_result": vr_ok, "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); c["unresolved_conflicts"] = ["HUMAN_CONFLICT it-3"]; fixture("commit-unresolved-conflict", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="unresolved", extra={"journal": legal, "verification_result": vr_ok, "guard_digest": snap_pos["guard_digest"]})
c = copy.deepcopy(commit_ok); del c["verification_result_sha256"]; fixture("commit-naked-terminal-state", "schema", "provisional/resolveCommitManifest", c, expect_contains="verification_result_sha256")

# ============================================================ freeze manifest schema
man_schema = S("vidtoolz.resolveFreezeManifest.v1.2", "Freeze manifest v1.2", {"schema": {"const": "vidtoolz.resolveFreezeManifest.v1.2"}, "bundle": {"const": "docs/resolve-integration/v1.2"}, "version": {"const": "1.2.0"}, "frozen_at": {"type": "string"}, "prepared_by": {"type": "string"}, "approval_status": {"enum": ["CANDIDATE_FOR_INDEPENDENT_REVIEW", "APPROVED", "SUPERSEDED"]}, "approver": {"type": ["string", "null"]}, "parent": {"type": "object", "additionalProperties": False, "required": ["version", "branch", "head", "manifest_sha256", "immutable", "grandparent"], "properties": {"version": {"const": "1.1.0"}, "branch": {"const": "docs/resolve-authority-freeze-v1.1"}, "head": {"const": "47ddb225335b8c85ca5255b1de86ff508e0e8e91"}, "manifest_sha256": {"const": "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5"}, "immutable": {"const": True}, "grandparent": {"type": "object"}}}, "status_vocabulary": {"const": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"]}, "status_field_law": {"type": "string"}, "rules": {"type": "array"}, "files": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["path", "sha256", "bytes", "status", "authority_class", "inherited_from_parent", "changed_from_parent", "new_in_this_version"], "properties": {"path": {"type": "string", "minLength": 1}, "sha256": SHA, "bytes": NONNEG, "status": {"enum": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"]}, "authority_class": {"enum": ["NORMATIVE", "SCHEMA", "FIXTURE", "TOOL", "HISTORICAL_INPUT", "REPORT"]}, "inherited_from_parent": {"type": "boolean"}, "changed_from_parent": {"type": "boolean"}, "new_in_this_version": {"type": "boolean"}, "qualification_note": {"type": "string"}, "blocked_until": {"type": "string"}}}}, "removed_from_this_version_present_in_parent": {"type": "array"}, "external_pins": {"type": "object"}, "counts": {"type": "object"}}, ["schema", "bundle", "version", "frozen_at", "approval_status", "approver", "parent", "status_vocabulary", "files", "external_pins", "counts"])
dump("schemas/resolveFreezeManifest.schema.json", man_schema)
print("build_v1_2: OK")
