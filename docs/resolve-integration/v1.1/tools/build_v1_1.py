#!/usr/bin/env python3
"""Generate the v1.1 machine artifacts (schemas, instances, fixtures, vectors, permissions, capabilities).
Deterministic; no Resolve access. Run from the bundle directory: python3 tools/build_v1_1.py
"""
import copy
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

V1 = os.path.join(os.path.dirname(B), "v1")
SHA = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
SHA_OR_NULL = {"anyOf": [SHA, {"type": "null"}]}
NONNEG = {"type": "integer", "minimum": 0}
POSINT = {"type": "integer", "minimum": 1}
RATIONAL_TAG = {"type": "object", "additionalProperties": False, "required": ["$rational"], "properties": {"$rational": {"type": "string", "pattern": "^[0-9]+/[1-9][0-9]*$"}}}
FRAME_QTY = {"anyOf": [NONNEG, RATIONAL_TAG]}
ABS_PATH = {"type": "string", "pattern": "^/(?!.*(^|/)\\.\\.(/|$)).*$", "minLength": 2}
UUID = {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}


def dump(rel, obj):
    p = os.path.join(B, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load(rel, root=B):
    with open(os.path.join(root, rel)) as f:
        return json.load(f)


def S(id_, title, props, req, comment=None, extra=None):
    d = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": id_, "title": title, "type": "object", "additionalProperties": False, "required": req, "properties": props}
    if comment:
        d["$comment"] = comment
    if extra:
        d.update(extra)
    return d


def fixture(name, kind, schema, doc, expect_error_contains=None):
    """kind: positive|negative. Stored under fixtures/schema/<kind>/<name>.json"""
    dump(f"fixtures/schema/{kind}/{name}.json", {"fixture": name, "kind": kind, "schema": schema, "expect_error_contains": expect_error_contains, "document": doc})


# ============================================================ TARGET CONTRACT
v1_tc = load("TARGET-CONTRACT.json", V1)
tc = {
    "schema": "vidtoolz.resolveTargetContract.v1.1",
    "version": "1.1.0",
    "status": "FROZEN_NOW",
    "qualification_note": "library root_path/instance_uuid/launch recipe are required future observations, not fabricated",
    "qualification_mode": "SCRATCH_QUALIFICATION_LIBRARY",
    "accepts_current_open_session_as_target": False,
    "host": {"name": "vidnux", "os": "Linux", "lan_ip_observed": "192.168.50.32"},
    "resolve": {"product": "DaVinci Resolve Studio", "version": "21.1.0", "build": 14, "license": "permanent RLM node-locked", "install_root": "/opt/resolve", "pins": v1_tc["resolve"]["pins"]},
    "interpreter": v1_tc["interpreter"],
    "library": {
        "kind": "Disk",
        "name": "VIDTOOLZ Resolve Qualification v1",
        "provisioning_status": "UNPROVISIONED",
        "root_path": None,
        "instance_uuid": None,
        "prohibited_library_names": ["EKA", "EKA192.168.50.199", "nelja", "Local Database"],
        "rule": "newly provisioned isolated disk library; adapter refuses when GetCurrentDatabase() != this library; never the user's existing Local Database; never a PostgreSQL library",
    },
    "required_future_observations": [
        {"field": "library.root_path", "source": "operator provisioning record", "blocks": "M0 attach"},
        {"field": "library.instance_uuid", "source": "operator provisioning record (external UUID minted at provisioning)", "blocks": "M0 attach"},
        {"field": "session.launch_recipe_sha256", "source": "recorded launch script", "blocks": "M0 attach"},
        {"field": "session.external_scripting_preference_observed", "source": "M0 connection evidence", "blocks": "M0 exit"},
    ],
    "session": {"kind": "dedicated interactive qualification session", "isolation": "separate BMD support/config/cache/log roots", "launch_recipe_sha256": None, "launcher_rule": v1_tc["session"]["launcher_rule"], "external_scripting_preference_required": "Local", "external_scripting_preference_observed": None, "network_port_1144": "closed", "exclusivity_required_for_writes": True},
    "prohibited_targets": v1_tc["prohibited_targets"],
    "naming": v1_tc["naming"],
    "denied_calls_all_scopes": v1_tc["denied_calls_all_scopes"],
}
dump("TARGET-CONTRACT.json", tc)
tc_schema = S("vidtoolz.resolveTargetContract.v1.1", "Resolve target contract v1.1", {
    "schema": {"const": "vidtoolz.resolveTargetContract.v1.1"}, "version": {"type": "string", "pattern": "^1\\.1\\.[0-9]+$"}, "status": {"enum": ["FROZEN_NOW"]}, "qualification_note": {"type": "string"},
    "qualification_mode": {"const": "SCRATCH_QUALIFICATION_LIBRARY"},
    "accepts_current_open_session_as_target": {"const": False},
    "host": {"type": "object", "additionalProperties": False, "required": ["name", "os"], "properties": {"name": {"type": "string", "minLength": 1}, "os": {"enum": ["Linux"]}, "lan_ip_observed": {"type": "string"}}},
    "resolve": {"type": "object", "additionalProperties": False, "required": ["product", "version", "build", "install_root", "pins"], "properties": {"product": {"const": "DaVinci Resolve Studio"}, "version": {"const": "21.1.0"}, "build": {"const": 14}, "license": {"type": "string"}, "install_root": {"const": "/opt/resolve"}, "pins": {"type": "object", "minProperties": 9, "additionalProperties": SHA}}},
    "interpreter": {"type": "object"},
    "library": {"type": "object", "additionalProperties": False, "required": ["kind", "name", "provisioning_status", "root_path", "instance_uuid", "prohibited_library_names", "rule"], "properties": {"kind": {"const": "Disk"}, "name": {"type": "string", "pattern": "^VIDTOOLZ Resolve Qualification v[0-9]+$"}, "provisioning_status": {"enum": ["UNPROVISIONED", "PROVISIONED"]}, "root_path": {"anyOf": [ABS_PATH, {"type": "null"}]}, "instance_uuid": {"anyOf": [UUID, {"type": "null"}]}, "prohibited_library_names": {"type": "array", "minItems": 2, "items": {"type": "string"}, "allOf": [{"contains": {"const": "EKA"}}, {"contains": {"const": "Local Database"}}]}, "rule": {"type": "string"}}},
    "required_future_observations": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["field", "source", "blocks"], "properties": {"field": {"type": "string"}, "source": {"type": "string"}, "blocks": {"type": "string"}}}},
    "session": {"type": "object", "additionalProperties": False, "required": ["kind", "isolation", "launch_recipe_sha256", "external_scripting_preference_required", "external_scripting_preference_observed", "network_port_1144", "exclusivity_required_for_writes"], "properties": {"kind": {"type": "string", "minLength": 1}, "isolation": {"type": "string"}, "launch_recipe_sha256": SHA_OR_NULL, "launcher_rule": {"type": "string"}, "external_scripting_preference_required": {"const": "Local"}, "external_scripting_preference_observed": {"anyOf": [{"enum": ["None", "Local", "Network"]}, {"type": "null"}]}, "network_port_1144": {"const": "closed"}, "exclusivity_required_for_writes": {"const": True}}},
    "prohibited_targets": {"type": "object"},
    "naming": {"type": "object"},
    "denied_calls_all_scopes": {"type": "array", "uniqueItems": True, "items": {"type": "string"}, "allOf": [{"contains": {"const": c}} for c in ["SetCurrentDatabase", "CloseProject", "ImportProject", "ReplaceClip", "run_script", "run_script_unsafe", "execute_python", "execute_lua"]]},
}, ["schema", "version", "status", "qualification_mode", "accepts_current_open_session_as_target", "host", "resolve", "library", "required_future_observations", "session", "prohibited_targets", "denied_calls_all_scopes"],
    comment="Schema-valid != authorized. A valid contract with provisioning_status UNPROVISIONED permits no attach (PERMISSIONS.json). The semantic validator additionally enforces UNPROVISIONED => null root/uuid and PROVISIONED => both present.")
dump("schemas/resolveTargetContract.schema.json", tc_schema)
fixture("target-contract-frozen", "positive", "resolveTargetContract", tc)
neg = copy.deepcopy(tc); neg["accepts_current_open_session_as_target"] = True
fixture("target-accepts-open-session", "negative", "resolveTargetContract", neg, "False")
neg = copy.deepcopy(tc); neg["library"]["name"] = "Local Database"
fixture("target-user-local-database", "negative", "resolveTargetContract", neg, "pattern")
neg = copy.deepcopy(tc); neg["library"]["kind"] = "PostgreSQL"; neg["library"]["name"] = "EKA"
fixture("target-shared-postgres-library", "negative", "resolveTargetContract", neg, "Disk")
neg = copy.deepcopy(tc); neg["denied_calls_all_scopes"] = [c for c in neg["denied_calls_all_scopes"] if c != "SetCurrentDatabase"]
fixture("target-missing-denied-setcurrentdatabase", "negative", "resolveTargetContract", neg, "contains")
neg = copy.deepcopy(tc); neg["host"]["name"] = ""
fixture("target-empty-host", "negative", "resolveTargetContract", neg, "minLength")
neg = copy.deepcopy(tc); neg["library"]["root_path"] = "/x/../etc"
fixture("target-path-traversal", "negative", "resolveTargetContract", neg, "anyOf")
neg = copy.deepcopy(tc); neg["qualification_mode"] = "PRODUCTION_LIBRARY"
fixture("target-production-mode", "negative", "resolveTargetContract", neg, "SCRATCH")
neg = copy.deepcopy(tc); del neg["session"]["exclusivity_required_for_writes"]
fixture("target-empty-session-envelope", "negative", "resolveTargetContract", neg, "required")
# semantic negative: PROVISIONED with nulls
sem = copy.deepcopy(tc); sem["library"]["provisioning_status"] = "PROVISIONED"
dump("fixtures/semantic/target-provisioned-without-evidence.json", {"fixture": "target-provisioned-without-evidence", "check": "semantic_target_contract", "expect_errors": True, "document": sem})

# ============================================================ TIMEBASE
v1_tb = load("TIMEBASE.json", V1)
tb = {
    "schema": "vidtoolz.resolveTimebase.v1.1", "version": "1.1.0", "status": "FROZEN_NOW", "qualification_note": "law, profile and fixtures frozen; api_mapping is PROVISIONAL_UNTIL_M3", "blocked_until": "M3",
    "authoritative_fps_source": v1_tb["authoritative_fps_source"],
    "profile_v1": {"output_fps": 30, "fps": {"numerator": 30, "denominator": 1}, "timecode": {"nominal_fps": 30, "drop_frame": False, "drop_frames_per_minute": 0, "start": "01:00:00:00"}, "intended_start_frame_offset": 108000, "geometry": {"width": 1080, "height": 1920, "progressive": True}, "audio_sample_rate_hz": 48000},
    "domains": {"millisecond": {"type": "integer", "minimum": 0}, "frame": {"type": "integer", "minimum": 0}, "audio_sample": {"type": "integer", "minimum": 0}},
    "law": {"name": "CEIL_BOUNDARY_V1", "rounding": "CEIL", "den": "1000*q", "B(m)": "floor((m*p + den - 1) / den)", "absolute(m)": "O + B(m)", "interval": "[a,b) -> [O+B(a), O+B(b))", "duration": "B(b) - B(a)", "coincident_boundaries": "share one frame; later interval owns it", "reject": v1_tb["law"]["reject"], "substitution_allowed": False, "scope": "profile_v1 only; any other rate/drop-frame/geometry requires a new profile with its own fixtures and M3-class evidence"},
    "tolerance": {"planned_vs_observed_frames": 0},
    "quantization": {"delay_ms_upper_bound_exclusive": "1000*q/p", "programme_tail_policy": "extend final visual hold + silence to B(end_ms); never time-stretch narration", "audio_rule": "ms boundary -> 48*m samples at 48000 Hz, verified separately"},
    "legacy_drafts": v1_tb["legacy_drafts"],
    "api_mapping": dict(v1_tb["api_mapping"], status="PROVISIONAL_UNTIL_M3", m3_probes=["P2", "P3", "P4"]),
    "fixtures": ["fixtures/timebase/canary-boundaries.json", "fixtures/timebase/negative-profiles.json"],
}
dump("TIMEBASE.json", tb)
tb_schema = S("vidtoolz.resolveTimebase.v1.1", "Resolve timebase law and frozen profile v1", {
    "schema": {"const": "vidtoolz.resolveTimebase.v1.1"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "qualification_note": {"type": "string"}, "blocked_until": {"enum": ["M3"]},
    "authoritative_fps_source": {"type": "object"},
    "profile_v1": {"type": "object", "additionalProperties": False, "required": ["output_fps", "fps", "timecode", "intended_start_frame_offset", "geometry", "audio_sample_rate_hz"], "properties": {"output_fps": {"const": 30}, "fps": {"type": "object", "additionalProperties": False, "required": ["numerator", "denominator"], "properties": {"numerator": {"const": 30}, "denominator": {"const": 1}}}, "timecode": {"type": "object", "additionalProperties": False, "required": ["nominal_fps", "drop_frame", "drop_frames_per_minute", "start"], "properties": {"nominal_fps": {"const": 30}, "drop_frame": {"const": False}, "drop_frames_per_minute": {"const": 0}, "start": {"const": "01:00:00:00"}}}, "intended_start_frame_offset": {"const": 108000}, "geometry": {"type": "object", "additionalProperties": False, "required": ["width", "height", "progressive"], "properties": {"width": {"const": 1080}, "height": {"const": 1920}, "progressive": {"const": True}}}, "audio_sample_rate_hz": {"const": 48000}}},
    "domains": {"type": "object", "additionalProperties": False, "required": ["millisecond", "frame", "audio_sample"], "properties": {k: {"type": "object", "additionalProperties": False, "required": ["type", "minimum"], "properties": {"type": {"const": "integer"}, "minimum": {"const": 0}}} for k in ("millisecond", "frame", "audio_sample")}},
    "law": {"type": "object", "additionalProperties": False, "required": ["name", "rounding", "den", "B(m)", "absolute(m)", "interval", "duration", "coincident_boundaries", "reject", "substitution_allowed", "scope"], "properties": {"name": {"const": "CEIL_BOUNDARY_V1"}, "rounding": {"const": "CEIL"}, "den": {"const": "1000*q"}, "B(m)": {"const": "floor((m*p + den - 1) / den)"}, "absolute(m)": {"type": "string"}, "interval": {"type": "string"}, "duration": {"const": "B(b) - B(a)"}, "coincident_boundaries": {"type": "string"}, "reject": {"type": "array", "minItems": 4}, "substitution_allowed": {"const": False}, "scope": {"type": "string"}}},
    "tolerance": {"type": "object", "additionalProperties": False, "required": ["planned_vs_observed_frames"], "properties": {"planned_vs_observed_frames": {"const": 0}}},
    "quantization": {"type": "object"},
    "legacy_drafts": {"type": "string"},
    "api_mapping": {"type": "object", "required": ["status"], "properties": {"status": {"const": "PROVISIONAL_UNTIL_M3"}}, "additionalProperties": True},
    "fixtures": {"type": "array", "items": {"type": "string"}},
}, ["schema", "version", "status", "blocked_until", "authoritative_fps_source", "profile_v1", "domains", "law", "tolerance", "api_mapping"],
    comment="The frozen profile is mechanically pinned by const values: 30/1, NDF, CEIL_BOUNDARY_V1, zero frame tolerance, 48 kHz. No other tolerance key is schema-legal. Generalization is a new profile, never an edit.")
dump("schemas/resolveTimebase.schema.json", tb_schema)
fixture("timebase-frozen", "positive", "resolveTimebase", tb)
neg = copy.deepcopy(tb); neg["profile_v1"]["fps"] = {"numerator": 24, "denominator": 1}; neg["profile_v1"]["output_fps"] = 24
fixture("timebase-24fps", "negative", "resolveTimebase", neg, "30")
neg = copy.deepcopy(tb); neg["law"]["name"] = "HALF_UP_BOUNDARY_V1"; neg["law"]["rounding"] = "HALF_UP"
fixture("timebase-half-up-law", "negative", "resolveTimebase", neg, "CEIL")
neg = copy.deepcopy(tb); neg["law"]["rounding"] = "ROUND"
fixture("timebase-math-round-law", "negative", "resolveTimebase", neg, "CEIL")
neg = copy.deepcopy(tb); neg["profile_v1"]["audio_sample_rate_hz"] = -48000
fixture("timebase-negative-sample-rate", "negative", "resolveTimebase", neg, "48000")
neg = copy.deepcopy(tb); neg["tolerance"]["planned_vs_observed_frames"] = 1
fixture("timebase-frame-tolerance", "negative", "resolveTimebase", neg, "0")
neg = copy.deepcopy(tb); neg["tolerance"]["arbitrary_ms"] = 40
fixture("timebase-arbitrary-tolerance-field", "negative", "resolveTimebase", neg, "additional")
neg = copy.deepcopy(tb); neg["law"]["substitution_allowed"] = True
fixture("timebase-substitution-allowed", "negative", "resolveTimebase", neg, "False")
# negative profile fixture doc (data, not schema)
dump("fixtures/timebase/negative-profiles.json", {"schema": "vidtoolz.resolveTimebaseNegativeFixtures.v1.1", "purpose": "each entry MUST be rejected by the frozen timebase schema or the timebase law self-check", "cases": [
    {"name": "24fps_under_profile_v1", "profile_v1.fps": {"numerator": 24, "denominator": 1}, "reject_reason": "profile_v1 pins 30/1"},
    {"name": "half_up_law", "law.name": "HALF_UP_BOUNDARY_V1", "reject_reason": "225183 ms -> 6755 frames; approved MP4 has 6756"},
    {"name": "math_round_law", "law.rounding": "ROUND", "reject_reason": "rounding const CEIL"},
    {"name": "negative_sample_rate", "profile_v1.audio_sample_rate_hz": -48000, "reject_reason": "const 48000"},
    {"name": "arbitrary_tolerance", "tolerance": {"planned_vs_observed_frames": 1}, "reject_reason": "exactness is const 0"},
    {"name": "floor_law_on_canary_end", "B(225183)": 6755, "reject_reason": "ceil gives 6756 = MP4 frame count"},
]})
# inherit fixtures/timebase/canary-boundaries.json unchanged (copied with the bundle)

# ============================================================ TRACK POLICY
tp = {"schema": "vidtoolz.resolveTrackPolicy.v1.1", "version": "1.1.0", "status": "FROZEN_NOW", "qualification_note": "layout policy is EF intent; whether Resolve enforces/keeps this layout is NOT_TESTED (M3 probes P1, P5, P9)", "enforcement_evidence": "NOT_TESTED",
      "video": [{"index": 1, "role": "FULL_CANVAS_VISUAL"}, {"index": 2, "role": "PRESENTER"}, {"index": 3, "role": "TYPOGRAPHY"}, {"index": 4, "role": "RESERVED"}],
      "audio": [{"index": 1, "role": "NARRATION"}, {"index": 2, "role": "MUSIC"}, {"index": 3, "role": "RESERVED"}],
      "ordering": "tracks sort by (type order video<audio<subtitle, numeric index); indexes are integers, never strings",
      "marker_owner_prefix": "vidtoolz:resolve:binding:v1:", "bin_pattern": "VIDTOOLZ/<run_id>/", "timeline_name_pattern": "VIDTOOLZ__<run_id>__<handoff_id[0:8]>__r<N>"}
dump("schemas/resolveTrackPolicy.v1.json", tp)
tp_schema = S("vidtoolz.resolveTrackPolicy.v1.1", "Track policy v1.1", {
    "schema": {"const": "vidtoolz.resolveTrackPolicy.v1.1"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "qualification_note": {"type": "string"}, "enforcement_evidence": {"enum": ["NOT_TESTED", "QUALIFIED"]},
    "video": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["index", "role"], "properties": {"index": POSINT, "role": {"enum": ["FULL_CANVAS_VISUAL", "PRESENTER", "PRESENTER_PROXY", "TYPOGRAPHY", "RESERVED"]}}}},
    "audio": {"type": "array", "minItems": 2, "items": {"type": "object", "additionalProperties": False, "required": ["index", "role"], "properties": {"index": POSINT, "role": {"enum": ["NARRATION", "MUSIC", "RESERVED"]}}}},
    "ordering": {"type": "string"}, "marker_owner_prefix": {"const": "vidtoolz:resolve:binding:v1:"}, "bin_pattern": {"type": "string"}, "timeline_name_pattern": {"type": "string"},
}, ["schema", "version", "status", "enforcement_evidence", "video", "audio", "marker_owner_prefix"], comment="Semantic validator enforces unique ascending indexes and the frozen required roles (V1 FULL_CANVAS_VISUAL, A1 NARRATION, A2 MUSIC).")
dump("schemas/resolveTrackPolicy.schema.json", tp_schema)
fixture("track-policy-frozen", "positive", "resolveTrackPolicy", tp)
neg = copy.deepcopy(tp); neg["video"][0]["index"] = "1"
fixture("track-policy-string-index", "negative", "resolveTrackPolicy", neg, "integer")
neg = copy.deepcopy(tp); neg["video"][0]["role"] = "B_ROLL"
fixture("track-policy-unknown-role", "negative", "resolveTrackPolicy", neg, "enum")
neg = copy.deepcopy(tp); neg["video"] = {"1": "FULL_CANVAS_VISUAL"}
fixture("track-policy-object-keys-as-index", "negative", "resolveTrackPolicy", neg, "array")
sem = copy.deepcopy(tp); sem["video"][1]["index"] = 1
dump("fixtures/semantic/track-policy-duplicate-index.json", {"fixture": "track-policy-duplicate-index", "check": "semantic_track_policy", "expect_errors": True, "document": sem})

# ============================================================ CANARY MANIFEST
v1_cm = load("CANARY-SOURCE-MANIFEST.json", V1)
cm = dict(v1_cm); cm["schema"] = "vidtoolz.resolveCanarySourceManifest.v1.1"; cm["status"] = "FROZEN_NOW"
dump("CANARY-SOURCE-MANIFEST.json", cm)
media_item = {"type": "object", "additionalProperties": True, "required": ["role", "declared_path", "preserved_path", "declared_sha256", "preserved_sha256", "match"], "properties": {"role": {"enum": ["DRAFT_BESPOKE_STILL", "NARRATION", "MUSIC"]}, "asset_id": {"type": "string", "pattern": "^draft-still-[0-9]{3}$"}, "declared_path": ABS_PATH, "preserved_path": ABS_PATH, "declared_sha256": SHA, "preserved_sha256": SHA, "match": {"const": True}}}
cm_schema = S("vidtoolz.resolveCanarySourceManifest.v1.1", "Canary source relocation manifest v1.1", {
    "schema": {"const": "vidtoolz.resolveCanarySourceManifest.v1.1"}, "status": {"enum": ["FROZEN_NOW"]}, "run_id": {"const": "2026-08-31-claude-real-20-bespoke-still-draft-successor"}, "preserved_root": ABS_PATH, "live_root_declared_in_handoff": ABS_PATH, "live_root_status": {"type": "string"}, "relocation_rule": {"type": "string"},
    "handoff": {"type": "object", "required": ["handoff_id", "revision", "handoff_digest_sha256", "file_sha256", "duration_ms", "beat_count"], "properties": {"handoff_id": {"const": "directed-draft-handoff-3fd9bdd875c9eb489abf7779"}, "revision": {"const": 2}, "handoff_digest_sha256": {"const": "3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69"}, "file_sha256": {"const": "b675b8f33acfa0134d70c5205d66984e981b2b069fd35eb81071319b2eebdf66"}, "duration_ms": {"const": 225183}, "beat_count": {"const": 20}}},
    "story_pin": {"type": "object"},
    "approved_comparison_artifact": {"type": "object", "required": ["path", "sha256", "ffprobe"], "properties": {"sha256": {"const": "b5ba7bc097ce450714afef5a8f38ad82d64010b2e1129d01766e9cd80a515348"}, "ffprobe": {"type": "object", "required": ["nb_read_frames"], "properties": {"nb_read_frames": {"const": 6756}}}}},
    "media": {"type": "array", "minItems": 22, "maxItems": 22, "uniqueItems": True, "items": media_item},
    "media_match_count": {"const": "22/22"},
    "asset_manifest": {"type": "object"}, "composition": {"type": "object"}, "human_review": {"type": "object", "required": ["draft_verdict", "notes"], "properties": {"draft_verdict": {"const": "KEEP"}, "notes": {"const": 0}}}, "lock": {"type": "object"}, "blueprint_manual_not_target": {"type": "object", "required": ["edit_mode"], "properties": {"edit_mode": {"const": "MANUAL"}}}, "story_binding_sha256": SHA, "negative_fixture_only": {"type": "object"}, "grants_gate_approval": {"const": False},
}, ["schema", "status", "run_id", "preserved_root", "relocation_rule", "handoff", "approved_comparison_artifact", "media", "media_match_count", "human_review", "lock", "blueprint_manual_not_target", "grants_gate_approval"],
    comment="Semantic validator: exactly 20 stills + 1 narration + 1 music; unique asset ids; unique shas; declared == preserved sha; absolute paths without traversal.")
dump("schemas/resolveCanarySourceManifest.schema.json", cm_schema)
fixture("canary-manifest-frozen", "positive", "resolveCanarySourceManifest", cm)
neg = copy.deepcopy(cm); neg["media"] = neg["media"][:21]; neg["media_match_count"] = "21/21"
fixture("canary-21-media", "negative", "resolveCanarySourceManifest", neg, "22")
neg = copy.deepcopy(cm); neg["media"][0]["declared_sha256"] = "ZZ" + neg["media"][0]["declared_sha256"][2:]
fixture("canary-bad-sha-format", "negative", "resolveCanarySourceManifest", neg, "pattern")
neg = copy.deepcopy(cm); neg["media"][0]["match"] = "true"
fixture("canary-match-string-not-bool", "negative", "resolveCanarySourceManifest", neg, "True")
neg = copy.deepcopy(cm); neg["media"][0]["preserved_path"] = "/home/vidtoolz/../etc/passwd"
fixture("canary-path-traversal", "negative", "resolveCanarySourceManifest", neg, "pattern")
neg = copy.deepcopy(cm); neg["media"][1] = copy.deepcopy(neg["media"][0])
fixture("canary-duplicate-record", "negative", "resolveCanarySourceManifest", neg, "unique")
neg = copy.deepcopy(cm); neg["grants_gate_approval"] = True
fixture("canary-claims-approval", "negative", "resolveCanarySourceManifest", neg, "False")
sem = copy.deepcopy(cm); sem["media"][2]["preserved_sha256"] = "0" * 64
dump("fixtures/semantic/canary-hash-mismatch.json", {"fixture": "canary-hash-mismatch", "check": "semantic_canary_manifest", "expect_errors": True, "document": sem})
sem = copy.deepcopy(cm); sem["media"][5]["asset_id"] = sem["media"][4]["asset_id"]
dump("fixtures/semantic/canary-duplicate-asset-id.json", {"fixture": "canary-duplicate-asset-id", "check": "semantic_canary_manifest", "expect_errors": True, "document": sem})

# ============================================================ SNAPSHOT (MAJOR CORRECTION) + GUARD
common_item = {"unique_id": {"type": "string", "minLength": 1}, "name": {"type": "string"}, "start": FRAME_QTY, "end": FRAME_QTY, "duration": FRAME_QTY, "enabled": {"type": "boolean"}, "markers": {"type": "array"}, "identity_observed": {"enum": ["COMPLETE", "PARTIAL"]}, "observed_identity_fields": {"type": "array", "items": {"type": "string"}, "minItems": 1}}
media_backed = {"type": "object", "additionalProperties": False, "required": list(common_item) + ["provenance", "media_pool_item_unique_id", "media_id", "source_locator", "source_status", "source_sha256", "source_start", "source_end"], "properties": dict(common_item, **{
    "provenance": {"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"const": "MEDIA_BACKED"}}},
    "media_pool_item_unique_id": {"type": "string", "minLength": 1}, "media_id": {"type": ["string", "null"]}, "source_locator": {"type": "string", "minLength": 1},
    "source_status": {"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}, "source_sha256": SHA_OR_NULL, "source_start": FRAME_QTY, "source_end": FRAME_QTY})}
non_media = {"type": "object", "additionalProperties": False, "required": list(common_item) + ["provenance", "media_pool_item_unique_id", "media_id", "source_locator", "source_status", "source_sha256", "absence_reason"], "properties": dict(common_item, **{
    "provenance": {"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"enum": ["GENERATOR", "TITLE", "COMPOUND", "ADJUSTMENT", "FUSION_OR_GENERATED", "OTHER_OBSERVED"]}}},
    "media_pool_item_unique_id": {"type": ["string", "null"]}, "media_id": {"type": ["string", "null"]}, "source_locator": {"type": "null"},
    "source_status": {"const": "NOT_APPLICABLE"}, "source_sha256": {"type": "null"}, "absence_reason": {"enum": ["NO_MEDIA_POOL_ITEM", "NO_FILE_BACKED_SOURCE", "UNOBSERVED_BY_API"]}, "source_start": FRAME_QTY, "source_end": FRAME_QTY})}
marker = {"type": "object", "additionalProperties": False, "required": ["object_address", "frame", "duration", "color", "name", "note", "custom_data"], "properties": {"object_address": {"type": "string", "minLength": 1}, "frame": FRAME_QTY, "duration": FRAME_QTY, "color": {"type": "string"}, "name": {"type": "string"}, "note": {"type": "string"}, "custom_data": {"type": "string"}}}
track = {"type": "object", "additionalProperties": False, "required": ["type", "index", "name", "enabled", "locked", "items"], "properties": {"type": {"enum": ["video", "audio", "subtitle"]}, "index": POSINT, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "locked": {"type": "boolean"}, "items": {"type": "array", "items": {"oneOf": [media_backed, non_media]}}}}
snap_schema = S("vidtoolz.resolveSnapshot.v1.1", "Canonical Resolve readback snapshot v1.1", {
    "schema": {"const": "vidtoolz.resolveSnapshot.v1.1"}, "collector_version": {"type": "string", "minLength": 1}, "canonicalization_version": {"const": "1.1"},
    "target_epoch": {"type": "string", "minLength": 1}, "resolve_build": {"type": "string", "minLength": 1},
    "library": {"type": "object", "additionalProperties": False, "required": ["db_type", "db_name", "instance_uuid"], "properties": {"db_type": {"enum": ["Disk"]}, "db_name": {"type": "string", "minLength": 1}, "instance_uuid": UUID}},
    "project": {"type": "object", "additionalProperties": False, "required": ["unique_id", "name", "last_modified_time_observed"], "properties": {"unique_id": {"type": "string", "minLength": 1}, "name": {"type": "string"}, "last_modified_time_observed": {"type": ["integer", "string", "null"], "description": "advisory tripwire; trust class decided by M3 probe P12"}}},
    "collection": {"type": "object", "additionalProperties": False, "required": ["started_at", "ended_at", "generation", "stable_pair"], "properties": {"started_at": {"type": "string"}, "ended_at": {"type": "string"}, "generation": NONNEG, "stable_pair": {"type": "boolean"}}},
    "coverage": {"type": "object", "additionalProperties": False, "required": ["complete", "observed_domains", "unobservable_domains", "deferred_domains"], "properties": {"complete": {"type": "boolean"}, "observed_domains": {"type": "array", "items": {"type": "string"}}, "unobservable_domains": {"type": "array", "items": {"type": "string"}}, "deferred_domains": {"type": "array", "items": {"type": "string"}}}},
    "policy": {"type": "object", "additionalProperties": False, "required": ["target_contract_sha256", "timebase_sha256", "track_policy_sha256", "capabilities_version", "collector_version", "canonicalization_version"], "properties": {"target_contract_sha256": SHA, "timebase_sha256": SHA, "track_policy_sha256": SHA, "capabilities_version": {"type": "string"}, "collector_version": {"type": "string"}, "canonicalization_version": {"const": "1.1"}}},
    "payload": {"type": "object", "additionalProperties": False, "required": ["timeline", "tracks", "markers", "media_dependencies"], "properties": {
        "timeline": {"type": "object", "additionalProperties": False, "required": ["unique_id", "name", "start_frame", "start_timecode", "fps", "width", "height", "end_frame", "is_current", "settings"], "properties": {"unique_id": {"type": "string", "minLength": 1}, "name": {"type": "string"}, "start_frame": NONNEG, "start_timecode": {"type": "string"}, "fps": {"type": "object", "additionalProperties": False, "required": ["numerator", "denominator"], "properties": {"numerator": POSINT, "denominator": POSINT}}, "width": POSINT, "height": POSINT, "end_frame": NONNEG, "is_current": {"type": "boolean"}, "settings": {"type": "object"}}},
        "tracks": {"type": "array", "items": track}, "markers": {"type": "array", "items": marker}, "media_dependencies": {"type": "array", "items": {"type": "object", "required": ["logical_locator", "source_sha256", "status"], "properties": {"logical_locator": {"type": "string"}, "source_sha256": SHA_OR_NULL, "status": {"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}}}}}},
    "payload_sha256": SHA, "guard_digest": SHA, "hash_domains": {"type": "object", "additionalProperties": False, "required": ["payload", "guard"], "properties": {"payload": {"const": "vidtoolz.resolveSnapshotPayload.v1.1"}, "guard": {"const": "vidtoolz.resolveGuard.v1"}}},
}, ["schema", "collector_version", "canonicalization_version", "target_epoch", "resolve_build", "library", "project", "collection", "coverage", "policy", "payload", "payload_sha256", "guard_digest", "hash_domains"],
    comment="payload_sha256 = digest(normalized payload, domain vidtoolz.resolveSnapshotPayload.v1.1). guard_digest = digest(guard object, domain vidtoolz.resolveGuard.v1) binding library/project/timeline/epoch/coverage/policy/payload_sha256. The payload hash ALONE never proves target context; pre-write revalidation compares guard_digest. Item provenance variants: MEDIA_BACKED requires media-pool identity and a source status; GENERATOR/TITLE/COMPOUND/ADJUSTMENT/FUSION_OR_GENERATED/OTHER_OBSERVED require null source and an absence_reason. Nullable fields MUST be emitted as null, never omitted.")
dump("schemas/resolveSnapshot.schema.json", snap_schema)
guard_schema = S("vidtoolz.resolveGuard.v1", "Composite pre-write / revalidation guard (model A)", {
    "hash_domain": {"const": "vidtoolz.resolveGuard.v1"}, "guard_version": {"const": 1}, "library": snap_schema["properties"]["library"], "project": {"type": "object", "additionalProperties": False, "required": ["unique_id", "name"], "properties": {"unique_id": {"type": "string"}, "name": {"type": "string"}}}, "timeline": {"type": "object", "additionalProperties": False, "required": ["unique_id", "name"], "properties": {"unique_id": {"type": "string"}, "name": {"type": "string"}}}, "target_epoch": {"type": "string"}, "coverage": snap_schema["properties"]["coverage"], "policy": snap_schema["properties"]["policy"], "payload_sha256": SHA,
}, ["hash_domain", "guard_version", "library", "project", "timeline", "target_epoch", "coverage", "policy", "payload_sha256"], comment="guard_digest = sha256(utf8('vidtoolz.resolveGuard.v1') + 0x0A + canonical(guard)). Equality of guard_digest is the pre-write version token; equality of payload_sha256 alone is insufficient.")
dump("schemas/resolveGuard.schema.json", guard_schema)


def sha_of(rel):
    return hashlib.sha256(open(os.path.join(B, rel), "rb").read()).hexdigest()


policy = {"target_contract_sha256": sha_of("TARGET-CONTRACT.json"), "timebase_sha256": sha_of("TIMEBASE.json"), "track_policy_sha256": sha_of("schemas/resolveTrackPolicy.v1.json"), "capabilities_version": "1.1.0", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.1"}
UU = "7e11aa60-fe44-4f3e-aa35-515e9a0d30ca"


def item_media(uid, start, end, mp, sha=None, status="HASHED", name="clip"):
    return {"unique_id": uid, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "COMPLETE", "observed_identity_fields": ["unique_id", "start", "end", "media_pool_item_unique_id"], "provenance": {"kind": "MEDIA_BACKED"}, "media_pool_item_unique_id": mp, "media_id": None, "source_locator": f"/qual/media/{name}.png", "source_status": status, "source_sha256": sha, "source_start": 0, "source_end": end - start}


def item_other(uid, start, end, kind, reason, name):
    return {"unique_id": uid, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "PARTIAL", "observed_identity_fields": ["unique_id", "start", "end"], "provenance": {"kind": kind}, "media_pool_item_unique_id": None, "media_id": None, "source_locator": None, "source_status": "NOT_APPLICABLE", "source_sha256": None, "absence_reason": reason, "source_start": 0, "source_end": end - start}


def make_snapshot(tracks, markers=None, coverage=None):
    payload = {"timeline": {"unique_id": "tl-fixture-0001", "name": "VIDTOOLZ__fixture__r1", "start_frame": 108000, "start_timecode": "01:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1080, "height": 1920, "end_frame": 114756, "is_current": True, "settings": {"useCustomSettings": "1", "timelineFrameRate": "30"}}, "tracks": tracks, "markers": markers or [], "media_dependencies": []}
    payload = L.normalize_snapshot_payload(payload)
    snap = {"schema": "vidtoolz.resolveSnapshot.v1.1", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.1", "target_epoch": "epoch-fixture-1", "resolve_build": "21.1.0.0014", "library": {"db_type": "Disk", "db_name": "VIDTOOLZ Resolve Qualification v1", "instance_uuid": UU}, "project": {"unique_id": "proj-fixture-0001", "name": "VIDTOOLZ_RESOLVE_QUAL_V1_FIXTURE", "last_modified_time_observed": None}, "collection": {"started_at": "2026-09-08T00:00:00Z", "ended_at": "2026-09-08T00:00:01Z", "generation": 1, "stable_pair": True}, "coverage": coverage or {"complete": True, "observed_domains": ["timeline", "tracks", "items", "markers", "adapter_bin_media"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"]}, "policy": policy, "payload": payload, "hash_domains": {"payload": "vidtoolz.resolveSnapshotPayload.v1.1", "guard": "vidtoolz.resolveGuard.v1"}}
    snap["payload_sha256"] = L.snapshot_payload_digest(payload)
    snap["guard_digest"] = L.guard_digest(snap)
    return snap


sha_a = hashlib.sha256(b"fixture-a").hexdigest()
human_tl = [
    {"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [item_media("it-1", 108000, 108347, "mp-1", sha_a, "HASHED", "still-001"), item_other("it-2", 108347, 108694, "TITLE", "NO_FILE_BACKED_SOURCE", "Text+"), item_media("it-3", 108694, 109174, "mp-2", None, "UNHASHED_UNOWNED", "human-broll"), item_other("it-4", 109174, 109654, "GENERATOR", "NO_MEDIA_POOL_ITEM", "Solid Color"), item_other("it-5", 109654, 109924, "COMPOUND", "NO_FILE_BACKED_SOURCE", "Compound Clip 1"), item_media("it-6", 109924, 110194, "mp-3", None, "OFFLINE", "missing-media")]},
    {"type": "video", "index": 2, "name": "V2", "enabled": True, "locked": False, "items": [item_other("it-7", 108000, 108694, "ADJUSTMENT", "NO_MEDIA_POOL_ITEM", "Adjustment Clip"), item_other("it-8", 108694, 109174, "FUSION_OR_GENERATED", "UNOBSERVED_BY_API", "Fusion Composition")]},
    {"type": "audio", "index": 1, "name": "A1", "enabled": True, "locked": False, "items": [item_media("it-9", 108000, 114756, "mp-4", hashlib.sha256(b"narr").hexdigest(), "HASHED", "narration")]},
]
snap_pos = make_snapshot(human_tl, markers=[{"object_address": "timeline", "frame": 108000, "duration": 1, "color": "Blue", "name": "draft-still-001", "note": "", "custom_data": "vidtoolz:resolve:binding:v1:epoch-fixture-1:b-001:o-1"}])
dump("fixtures/snapshot/human-timeline-mixed-provenance.json", snap_pos)
fixture("snapshot-human-timeline-mixed-provenance", "positive", "resolveSnapshot", snap_pos)
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][1]["source_sha256"] = sha_a
fixture("snapshot-title-with-sha", "negative", "resolveSnapshot", neg, "oneOf")
neg = copy.deepcopy(snap_pos); del neg["payload"]["tracks"][0]["items"][0]["media_pool_item_unique_id"]
fixture("snapshot-media-backed-missing-pool-id", "negative", "resolveSnapshot", neg, "media_pool_item_unique_id")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][3]["absence_reason"] = "BECAUSE"
fixture("snapshot-bad-absence-reason", "negative", "resolveSnapshot", neg, "oneOf")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["index"] = "1"
fixture("snapshot-string-track-index", "negative", "resolveSnapshot", neg, "integer")
neg = copy.deepcopy(snap_pos); del neg["coverage"]["deferred_domains"]
fixture("snapshot-missing-deferred-domains", "negative", "resolveSnapshot", neg, "deferred_domains")
neg = copy.deepcopy(snap_pos); neg["library"]["db_type"] = "PostgreSQL"
fixture("snapshot-postgres-library", "negative", "resolveSnapshot", neg, "Disk")
neg = copy.deepcopy(snap_pos); del neg["guard_digest"]
fixture("snapshot-no-guard-digest", "negative", "resolveSnapshot", neg, "guard_digest")
neg = copy.deepcopy(snap_pos); neg["payload"]["tracks"][0]["items"][0]["start"] = -5
fixture("snapshot-negative-frame", "negative", "resolveSnapshot", neg, "oneOf")
sem = copy.deepcopy(snap_pos); sem["coverage"]["unobservable_domains"].append("items")
dump("fixtures/semantic/snapshot-complete-but-items-unobservable.json", {"fixture": "snapshot-complete-but-items-unobservable", "check": "semantic_snapshot", "expect_errors": True, "document": sem})
sem = copy.deepcopy(snap_pos); sem["project"]["unique_id"] = "proj-OTHER"  # guard must change -> stored guard_digest mismatch
dump("fixtures/semantic/snapshot-guard-context-changed.json", {"fixture": "snapshot-guard-context-changed", "check": "semantic_snapshot", "expect_errors": True, "document": sem})
sem = copy.deepcopy(snap_pos); sem["payload"]["tracks"][0]["items"][0]["enabled"] = False  # payload changed, digests stale
dump("fixtures/semantic/snapshot-stale-payload-digest.json", {"fixture": "snapshot-stale-payload-digest", "check": "semantic_snapshot", "expect_errors": True, "document": sem})
dump("fixtures/semantic/snapshot-valid.json", {"fixture": "snapshot-valid", "check": "semantic_snapshot", "expect_errors": False, "document": snap_pos})
# guard-vs-payload demonstration: same payload, different project => same payload digest, different guard digest
snap_b = copy.deepcopy(snap_pos); snap_b["project"]["unique_id"] = "proj-fixture-0002"; snap_b["guard_digest"] = L.guard_digest(snap_b)
dump("fixtures/guard/same-payload-different-project.json", {"purpose": "payload digest alone does not prove target context", "payload_sha256_equal": snap_pos["payload_sha256"] == snap_b["payload_sha256"], "guard_digest_equal": snap_pos["guard_digest"] == snap_b["guard_digest"], "a_guard": snap_pos["guard_digest"], "b_guard": snap_b["guard_digest"]})

# ============================================================ CANONICALIZATION VECTORS
vectors = []


def vec(name, obj, domain="vidtoolz.resolveGeneric.v1", normalize=None, note=None):
    o = normalize(obj) if normalize else obj
    c = L.canon(o)
    vectors.append({"name": name, "note": note, "input": obj, "domain": domain, "canonical_utf8": c, "canonical_byte_length": len(c.encode("utf-8")), "sha256": L.digest(o, domain)})


vec("empty_object", {})
vec("key_order_codepoint", {"b": 1, "a": 2, "B": 3, "ä": 4, "aa": 5})
vec("string_escapes", {"s": "quote\" back\\ tab\t nl\n cr\r del slash/ ls  emoji\U0001F600 ä"})
vec("integers_and_tagged", {"frames": 6756, "ms": 225183, "zero": 0, "neg": -17, "fps": {"$rational": "30/1"}, "gain": {"$f64": "3ff0000000000000"}})
vec("timebase_boundary_row", {"boundary_ms": 225183, "B": 6756, "absolute_frame": 114756, "law": "CEIL_BOUNDARY_V1"})
tracks_2_10 = {"timeline": {"unique_id": "t", "name": "t", "start_frame": 0, "start_timecode": "00:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1, "height": 1, "end_frame": 0, "is_current": True, "settings": {}}, "tracks": [{"type": "video", "index": 10, "name": "V10", "enabled": True, "locked": False, "items": []}, {"type": "video", "index": 2, "name": "V2", "enabled": True, "locked": False, "items": []}], "markers": [], "media_dependencies": []}
vec("numeric_track_index_2_before_10", tracks_2_10, "vidtoolz.resolveSnapshotPayload.v1.1", L.normalize_snapshot_payload, "track 2 sorts before track 10 (numeric, not lexical)")
tracks_types = copy.deepcopy(tracks_2_10); tracks_types["tracks"] = [{"type": "subtitle", "index": 1, "name": "S1", "enabled": True, "locked": False, "items": []}, {"type": "audio", "index": 1, "name": "A1", "enabled": True, "locked": False, "items": []}, {"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": []}]
vec("track_type_order_video_audio_subtitle", tracks_types, "vidtoolz.resolveSnapshotPayload.v1.1", L.normalize_snapshot_payload, "declared type order video<audio<subtitle")
perm_a = copy.deepcopy(human_tl); perm_b = list(reversed(copy.deepcopy(human_tl)))
for t in perm_b:
    t["items"] = list(reversed(t["items"]))
pa = {"timeline": tracks_2_10["timeline"], "tracks": perm_a, "markers": [], "media_dependencies": []}
pb = {"timeline": tracks_2_10["timeline"], "tracks": perm_b, "markers": [], "media_dependencies": []}
da, db = L.snapshot_payload_digest(pa), L.snapshot_payload_digest(pb)
assert da == db
vec("permutation_invariance_A", pa, "vidtoolz.resolveSnapshotPayload.v1.1", L.normalize_snapshot_payload, "input permutation A")
vec("permutation_invariance_B_same_digest", pb, "vidtoolz.resolveSnapshotPayload.v1.1", L.normalize_snapshot_payload, "input permutation B; sha256 equals A")
same_frame = copy.deepcopy(tracks_2_10); same_frame["tracks"] = [{"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [item_other("z-id", 5, 9, "TITLE", "NO_FILE_BACKED_SOURCE", "t"), item_media("a-id", 5, 9, "mp", None, "UNHASHED_UNOWNED", "m"), item_media("b-id", 5, 7, "mp", None, "UNHASHED_UNOWNED", "n")]}]
vec("same_frame_items_deterministic", same_frame, "vidtoolz.resolveSnapshotPayload.v1.1", L.normalize_snapshot_payload, "same start: shorter end first; then kind order MEDIA_BACKED<TITLE; then unique_id")
vec("nullable_fields_explicit_null", {"media_id": None, "source_sha256": None, "source_locator": None, "absence_reason": "NO_MEDIA_POOL_ITEM"}, note="nullable fields are emitted as null, never omitted")
vec("rational_frame_sort_key", {"start": {"$rational": "216001/2"}, "end": 108001}, note="tagged rational allowed for subframe positions; sorted by exact fraction")
dump("fixtures/canonicalization/vectors.json", {"schema": "vidtoolz.resolveCanonicalizationVectors.v1.1", "spec": "CANONICALIZATION.md v1.1", "digest_rule": "sha256(utf8(domain) + 0x0A + canonical_bytes)", "registered_domains": sorted(L.HASH_DOMAINS), "reference_implementation": "tools/authority_lib.py", "vectors": vectors})

# ============================================================ PERMISSIONS
ops_read = ["Connect", "GetVersionString", "GetCurrentDatabase", "GetProjectListInCurrentFolder", "GetCurrentProject", "GetTimelineByIndex", "GetTimelineCount", "GetCurrentTimeline", "GetTrackCount", "GetItemListInTrack", "GetItemAttributes", "GetMarkers", "GetSettings", "GetProperties", "GetUniqueId", "GetProjectLastModifiedTime", "SnapshotCapture"]
scope = "SCRATCH_QUALIFICATION_LIBRARY"
entries = []
for m in ("M0", "M1", "M2", "M3"):
    for op in ops_read:
        entries.append({"milestone": m, "operation": op, "scope": scope, "allowed": True, "evidence_prerequisite": "TARGET-CONTRACT provisioning_status=PROVISIONED and independent v1.1 manifest verification" if m == "M0" else f"{m} entry gate", "mutation_allowed": False, "shared_library_allowed": False})
for m in ("M2", "M3"):
    entries.append({"milestone": m, "operation": "SetCurrentTimeline", "scope": scope, "allowed": True, "evidence_prerequisite": "read-only navigation on adapter-prefixed project only", "mutation_allowed": False, "shared_library_allowed": False})
    entries.append({"milestone": m, "operation": "BuildMutationPlanDryRun", "scope": scope, "allowed": True, "evidence_prerequisite": "M1 exit", "mutation_allowed": False, "shared_library_allowed": False})
m3_mut = {"CreateProject": "adapter-prefixed VIDTOOLZ_RESOLVE_QUAL_V1_* only", "CreateEmptyTimeline": "inside adapter-prefixed project", "AddTrack": "probe P1/P9", "ImportMedia": "synthetic media only; run-scoped bin", "AppendToTimeline": "probes P1-P5, P13", "DeleteClips_noRipple": "probe P13; never ripple", "SetClipEnabled": "probe P14", "AddMarker": "probe P7", "UpdateMarkerCustomData": "probe P7", "DeleteMarkerByCustomData": "probe P7", "SetSettings": "probe P8", "SetTrackLock": "probe P9", "AddTake_SelectTake_FinalizeTake": "probe P6", "DuplicateTimeline": "probe P6 (checkpoint qualification)", "ExportTimelineDRT": "probe P6", "ImportTimelineFromFileDRT": "probe P6", "SaveProject": "scratch lifecycle: adapter-prefixed project in the qualification library only (P15, P16)", "LoadProject_adapterPrefixed": "scratch lifecycle: reopen the same adapter-prefixed project after SaveProject (P15)"}
PLAN_OPS = {"IMPORT_MEDIA": "ImportMedia", "APPEND": "AppendToTimeline", "DELETE": "DeleteClips_noRipple", "DISABLE": "SetClipEnabled", "ENABLE": "SetClipEnabled", "SET_TAKE": "AddTake_SelectTake_FinalizeTake", "UPSERT_MARKER": "AddMarker", "SET_PROPERTIES": "SetProperties", "CHECKPOINT_DUPLICATE": "DuplicateTimeline", "CHECKPOINT_EXPORT_DRT": "ExportTimelineDRT", "SAVE_PROJECT": "SaveProject"}
for pop, api in PLAN_OPS.items():
    entries.append({"milestone": "M3", "operation": pop, "scope": scope, "allowed": True, "evidence_prerequisite": f"plan-level op; executes API primitive {api}; same prerequisites as that primitive; PREPARED journal record", "mutation_allowed": True, "shared_library_allowed": False})
for op, pre in m3_mut.items():
    entries.append({"milestone": "M3", "operation": op, "scope": scope, "allowed": True, "evidence_prerequisite": f"M2 exit + Mikko M3 authorization + PREPARED journal record; {pre}", "mutation_allowed": True, "shared_library_allowed": False})
perms = {"schema": "vidtoolz.resolvePermissions.v1.1", "version": "1.1.0", "status": "FROZEN_NOW", "default": "DENY", "rule": "any (milestone, operation, scope) without an explicit allowed:true entry is DENIED; unknown milestone, operation or scope is DENIED; entries never grant shared_library_allowed",
         "milestones": ["M0", "M1", "M2", "M3"], "scopes": [scope], "prohibited_scopes": ["LOCAL_STAGING_LIBRARY", "PRODUCTION_LIBRARY", "USER_LOCAL_DATABASE", "NETWORK_LIBRARY_EKA"],
         "denied_all_scopes": ["SetCurrentDatabase", "CloseProject", "ImportProject", "DeleteTimelines", "DeleteClips_ripple", "ReplaceClip", "ReplaceClipPreserveSubClip", "RelinkClips", "UnlinkClips", "run_script", "run_script_unsafe", "execute_python", "execute_lua", "StartRendering", "AddRenderJob", "LoadProject_nonPrefixed", "SetClipProperty", "DeleteProject"],
         "plan_op_to_api": PLAN_OPS, "scratch_lifecycle": {"granted_at": "M3", "operations": ["CreateProject", "CreateEmptyTimeline", "SaveProject", "LoadProject_adapterPrefixed"], "constraints": ["project name prefix VIDTOOLZ_RESOLVE_QUAL_V1_", "library == TARGET-CONTRACT qualification library (PROVISIONED)", "never EKA, never user's Local Database, never library switching"]},
         "entries": entries}
dump("PERMISSIONS.json", perms)
perm_schema = S("vidtoolz.resolvePermissions.v1.1", "Fail-closed permission authority", {
    "schema": {"const": "vidtoolz.resolvePermissions.v1.1"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "default": {"const": "DENY"}, "rule": {"type": "string"},
    "milestones": {"type": "array", "items": {"enum": ["M0", "M1", "M2", "M3"]}, "uniqueItems": True}, "scopes": {"type": "array", "items": {"const": scope}, "minItems": 1, "maxItems": 1}, "prohibited_scopes": {"type": "array", "items": {"type": "string"}},
    "denied_all_scopes": {"type": "array", "uniqueItems": True, "items": {"type": "string"}, "allOf": [{"contains": {"const": c}} for c in ["SetCurrentDatabase", "ReplaceClip", "run_script", "run_script_unsafe", "DeleteClips_ripple"]]},
    "scratch_lifecycle": {"type": "object"}, "plan_op_to_api": {"type": "object", "additionalProperties": {"type": "string"}},
    "entries": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["milestone", "operation", "scope", "allowed", "evidence_prerequisite", "mutation_allowed", "shared_library_allowed"], "properties": {"milestone": {"enum": ["M0", "M1", "M2", "M3"]}, "operation": {"type": "string", "minLength": 1}, "scope": {"const": scope}, "allowed": {"type": "boolean"}, "evidence_prerequisite": {"type": "string", "minLength": 1}, "mutation_allowed": {"type": "boolean"}, "shared_library_allowed": {"const": False}}}},
}, ["schema", "version", "status", "default", "milestones", "scopes", "denied_all_scopes", "entries"], comment="shared_library_allowed is const false: no schema-valid document can grant shared-library access. mutation_allowed true is only reachable for M3 entries by construction of the frozen instance; the semantic validator refuses mutation_allowed:true outside M3.")
dump("schemas/resolvePermissions.schema.json", perm_schema)
fixture("permissions-frozen", "positive", "resolvePermissions", perms)
neg = copy.deepcopy(perms); neg["default"] = "ALLOW"
fixture("permissions-default-allow", "negative", "resolvePermissions", neg, "DENY")
neg = copy.deepcopy(perms); neg["entries"][0]["shared_library_allowed"] = True
fixture("permissions-shared-library-grant", "negative", "resolvePermissions", neg, "False")
neg = copy.deepcopy(perms); neg["scopes"] = [scope, "PRODUCTION_LIBRARY"]
fixture("permissions-production-scope", "negative", "resolvePermissions", neg, "maxItems")
dump("fixtures/permissions/lookups.json", {"schema": "vidtoolz.resolvePermissionLookupFixtures.v1.1", "cases": [
    {"milestone": "M0", "operation": "GetCurrentDatabase", "scope": scope, "expect_allowed": True},
    {"milestone": "M0", "operation": "SaveProject", "scope": scope, "expect_allowed": False},
    {"milestone": "M2", "operation": "AppendToTimeline", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "AppendToTimeline", "scope": scope, "expect_allowed": True},
    {"milestone": "M3", "operation": "SetCurrentDatabase", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "DeleteClips_ripple", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "AppendToTimeline", "scope": "PRODUCTION_LIBRARY", "expect_allowed": False},
    {"milestone": "M4", "operation": "AppendToTimeline", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "FrobnicateTimeline", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "SaveProject", "scope": scope, "expect_allowed": True},
    {"milestone": "M3", "operation": "LoadProject_nonPrefixed", "scope": scope, "expect_allowed": False},
    {"milestone": "M1", "operation": "SetCurrentTimeline", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "APPEND", "scope": scope, "expect_allowed": True},
    {"milestone": "M2", "operation": "APPEND", "scope": scope, "expect_allowed": False},
    {"milestone": "M3", "operation": "SET_PROPERTIES", "scope": scope, "expect_allowed": True},
]})

# ============================================================ CAPABILITIES v1.1
EV = ["QUALIFIED_READ", "DOCUMENTED_NOT_QUALIFIED", "NOT_TESTED", "UNSUPPORTED", "BLOCKED", "QUALIFIED_EF_SIDE"]


def row(op, cls, prims, evidence_class, evidence, probes=None, blocked_until=None, note=None, m3_question=None):
    d = {"operation": op, "class": cls, "primitives": prims, "evidence_class": evidence_class, "evidence": evidence, "m3_probes": probes or [], "blocked_until": blocked_until}
    if note:
        d["qualification_note"] = note
    if m3_question:
        d["m3_question"] = m3_question
    return d


rows = [
    row("read: project/timeline enumeration", "DIRECT_API", ["GetProjectManager", "GetCurrentProject", "GetCurrentDatabase", "GetTimelineByIndex", "GetTimelineCount", "GetCurrentTimeline", "GetName", "GetVersionString"], "QUALIFIED_READ", "ESTATE: resolve-hermes read-only tools; Scorecraft driver; hardlink fixture (GetCurrentDatabase)", [], None),
    row("read: track/item enumeration (integer form)", "DIRECT_API", ["GetTrackCount", "GetItemListInTrack", "GetTrackName", "GetStart", "GetEnd", "GetDuration", "GetMediaPoolItem", "GetStartFrame"], "QUALIFIED_READ", "ESTATE: Scorecraft production driver readback; FRB render harness (GetStart/GetDuration/GetStartFrame)", [], None, note="integer (default) form only; subframe_precision=True form is a separate row"),
    row("read: subframe precision variants", "DIRECT_API", ["GetStart(True)", "GetEnd(True)", "GetDuration(True)", "GetLeftOffset(True)", "GetRightOffset(True)"], "DOCUMENTED_NOT_QUALIFIED", "stub only; never called in estate", ["P0-read"], "M0"),
    row("read: source boundary methods", "DIRECT_API", ["GetSourceStartFrame", "GetSourceEndFrame", "GetSourceStartTime", "GetSourceEndTime"], "DOCUMENTED_NOT_QUALIFIED", "stub only", ["P0-read", "P3"], "M0"),
    row("read: plural settings/properties", "DIRECT_API", ["Project.GetSettings", "Timeline.GetSettings", "TimelineItem.GetProperties"], "DOCUMENTED_NOT_QUALIFIED", "README.md deprecates singular forms; estate used ONLY singular GetSetting/GetProperty; plural never exercised", ["P0-read", "P8"], "M0"),
    row("read: object identity", "DIRECT_API", ["Project.GetUniqueId", "Timeline.GetUniqueId", "TimelineItem.GetUniqueId", "MediaPoolItem.GetUniqueId", "MediaPoolItem.GetMediaId", "Folder.GetUniqueId"], "DOCUMENTED_NOT_QUALIFIED", "stub only; uniqueness scope and survival unknown", ["P0-read", "P6", "P15"], "M3", m3_question="scope of uniqueness; survival across DuplicateTimeline / DRT export-import / FinalizeTake / delete+append / rename / save+reopen; which MediaPoolItem id is stable"),
    row("read: track lock/enable getters", "DIRECT_API", ["GetIsTrackLocked", "GetIsTrackEnabled"], "DOCUMENTED_NOT_QUALIFIED", "stub only", ["P0-read", "P9"], "M0"),
    row("read: timeline/project metadata", "DIRECT_API", ["GetStartTimecode", "GetEndFrame", "GetProjectLastModifiedTime", "GetMarkers", "GetMarkerByCustomData"], "DOCUMENTED_NOT_QUALIFIED", "stub only (GetStartFrame is qualified via FRB/Scorecraft; GetStartTimecode is not)", ["P0-read", "P12"], "M0"),
    row("create timeline with canonical settings", "DIRECT_API", ["CreateEmptyTimeline", "AddTrack", "SetSettings", "SetStartTimecode"], "NOT_TESTED", "FRB used deprecated singular SetSetting; plural untested", ["P8", "P11"], "M3"),
    row("import media into controlled bin", "DIRECT_API", ["ImportMedia([{FilePath}])", "AddSubFolder", "SetCurrentFolder", "SetMetadata"], "NOT_TESTED", "hardlink fixture used deprecated AddItemListToMediaPool list form", ["P2"], "M3"),
    row("exact placement with source range", "DIRECT_API", ["AppendToTimeline([{mediaPoolItem,startFrame,endFrame,mediaType,trackIndex,recordFrame}]) on CURRENT timeline"], "NOT_TESTED", "signature documented; recordFrame origin INFERRED from two estate scripts", ["P1", "P2", "P3", "P4", "P5"], "M3", m3_question="current-timeline targeting; recordFrame origin; endFrame inclusivity; still duration; collision behaviour"),
    row("move/trim/slip/nudge existing item in place", "UNSUPPORTED", [], "UNSUPPORTED", "stub grep: no setters", [], None),
    row("replace one occurrence with a new occurrence", "DELETE_AND_APPEND", ["DeleteClips([item], false)", "AppendToTimeline"], "NOT_TESTED", "documented primitives; composed operation never exercised", ["P13", "P16"], "M3", m3_question="does the new occurrence land at the identical [start,end) with neighbours byte-for-byte unchanged in snapshot terms; what identity does the new item carry; what happens on crash between delete and append; does DeleteClips(false) shift anything"),
    row("replace one occurrence media keeping item (take swap)", "TAKE_SWAP", ["AddTake", "SelectTakeByIndex", "FinalizeTake"], "NOT_TESTED", "documented", ["P6"], "M3", m3_question="does item GetUniqueId survive FinalizeTake; source bounds after finalize"),
    row("temporarily hide/disable one occurrence", "DISABLE", ["SetClipEnabled(false)", "GetClipEnabled"], "NOT_TESTED", "documented", ["P14"], "M3", m3_question="does SetClipEnabled change only the enabled flag (no position/duration/marker change); is the flag readable and stable across save/reopen; DISABLE != CUT: a disabled occurrence still occupies its interval and is NOT a canonical CUT, which is a successor-handoff rebuild", note="DISABLE != CUT"),
    row("replace underlying media-pool file", "UNSAFE", ["ReplaceClip", "ReplaceClipPreserveSubClip", "RelinkClips"], "BLOCKED", "global to all uses of the pool item", [], "never in v1"),
    row("close gap by deletion", "RIPPLE_DELETE", ["DeleteClips([items], true)"], "BLOCKED", "downstream/linked scope unqualified", [], "never in v1"),
    row("canonical CUT / section re-tile / script retime", "REBUILD_DESTINATION_TIMELINE", ["successor handoff -> new destination timeline"], "QUALIFIED_EF_SIDE", "EF retileSection (draft-revision-successor.js)", [], None),
    row("KEEP", "COMPOSED_API_OPERATION", ["verify binding; zero mutation"], "QUALIFIED_EF_SIDE", "EF intake: NO_FEEDBACK != KEEP", [], None),
    row("CHANGE / REWRITE", "COMPOSED_API_OPERATION", ["canonical review -> revision plan -> successor -> bindings -> primitives"], "QUALIFIED_EF_SIDE", "EF revision authority; Resolve primitives remain NOT_TESTED", ["P13", "P6"], "M3"),
    row("transform/crop/composite/audio properties", "DIRECT_API", ["SetProperties", "GetProperties"], "NOT_TESTED", "plural forms never exercised", [], "M3"),
    row("speed, fades, transitions", "DIRECT_API", ["SetSpeed", "SetFades", "AddTransition"], "NOT_TESTED", "documented", [], "M3"),
    row("titles / Fusion graphics", "COMPOSED_API_OPERATION", ["InsertFusionTitleIntoTimeline", "ImportFusionComp"], "NOT_TESTED", "FRB: 5 s user-pref insert duration; restart to rescan", [], "deferred"),
    row("audio tracks / mapping / normalization", "DIRECT_API", ["AddTrack('audio')", "mediaType 2 append", "SetAudioMapping", "NormalizeAudioLevel"], "NOT_TESTED", "documented", [], "deferred"),
    row("subtitles / AI tools", "DIRECT_API", ["CreateSubtitlesFromAudio", "TranscribeAudio"], "BLOCKED", "Studio+Extras; fail soft", [], "never in v1"),
    row("checkpoint", "COMPOSED_API_OPERATION", ["DuplicateTimeline", "Timeline.Export(EXPORT_DRT)", "SaveProject"], "NOT_TESTED", "documented", ["P6", "P15"], "M3"),
    row("undo / rollback", "UNSUPPORTED", [], "UNSUPPORTED", "stub grep", [], None),
    row("revision counter / change events / CAS", "UNSUPPORTED", ["GetProjectLastModifiedTime(projectName) advisory"], "UNSUPPORTED", "no CAS/event API; last-modified trust class decided by P12", ["P12"], "M3"),
    row("track locking as GUI-edit mitigation", "DIRECT_API", ["SetTrackLock", "GetIsTrackLocked"], "NOT_TESTED", "stub", ["P9"], "M3"),
    row("cross-client project lock", "OBSERVED", ["project-server collaboration lock (ResolveDebug.txt 2026-09-08)"], "DOCUMENTED_NOT_QUALIFIED", "log observation only; project granularity", [], None),
    row("render / delivery", "COMPOSED_API_OPERATION", ["LoadRenderPreset", "SetRenderSettings", "AddRenderJob", "StartRendering", "GetRenderJobStatus"], "BLOCKED", "FRB: live GUI required; media-storage target", [], "M11"),
    row("playback control", "UNSUPPORTED", ["SetCurrentTimecode is seek only"], "UNSUPPORTED", "estate xdotool workaround", [], None),
    row("library switch / load other project / close project", "UNSAFE", ["SetCurrentDatabase", "LoadProject(non-prefixed)", "CloseProject", "ImportProject"], "BLOCKED", "README.txt:146", [], "never"),
    row("scratch project lifecycle (adapter-prefixed only)", "COMPOSED_API_OPERATION", ["CreateProject", "CreateEmptyTimeline", "SaveProject", "LoadProject(adapter-prefixed)"], "NOT_TESTED", "hardlink fixture used CreateProject/SaveProject on an isolated library (deprecated forms)", ["P15", "P16"], "M3", note="permitted only in the qualification library by PERMISSIONS.json scratch_lifecycle"),
    row("non-render mutation under -nogui", "NOT_TESTED", ["Scorecraft P7/P8 harness assumes yes; no recorded pass"], "NOT_TESTED", "gate scripts exist", ["P10"], "M3", m3_question="one -nogui pass qualifies ONLY the probes actually executed under -nogui; it does not qualify M4-M8 headless operation"),
]
caps = {"schema": "vidtoolz.resolveCapabilityMatrix.v1.1", "version": "1.1.0", "status": "FROZEN_NOW", "qualification_note": "static inventory frozen; evidence_class per row is the authority state; rows with evidence_class NOT_TESTED or DOCUMENTED_NOT_QUALIFIED are UNTESTED_BLOCKED for every dependent milestone", "evidence_class_vocabulary": EV, "evidence_class_definitions": {"QUALIFIED_READ": "read-only call exercised against a real Resolve by an estate script whose output was consumed", "DOCUMENTED_NOT_QUALIFIED": "present in the 21.1 stub/README but never exercised in this estate", "NOT_TESTED": "mutation or composed operation with no scratch evidence", "UNSUPPORTED": "no API primitive exists", "BLOCKED": "denied by policy regardless of evidence", "QUALIFIED_EF_SIDE": "implemented and tested inside Episode Factory; no Resolve dependency"}, "resolve": load("CAPABILITIES.json", V1)["resolve"], "coverage_caveat": load("CAPABILITIES.json", V1)["coverage_caveat"], "rows": rows}
dump("CAPABILITIES.json", caps)
cap_schema = S("vidtoolz.resolveCapabilityMatrix.v1.1", "Capability matrix v1.1", {"schema": {"const": "vidtoolz.resolveCapabilityMatrix.v1.1"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "qualification_note": {"type": "string"}, "evidence_class_vocabulary": {"type": "array"}, "evidence_class_definitions": {"type": "object"}, "resolve": {"type": "object"}, "coverage_caveat": {"type": "string"}, "rows": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["operation", "class", "primitives", "evidence_class", "evidence", "m3_probes", "blocked_until"], "properties": {"operation": {"type": "string"}, "class": {"type": "string"}, "primitives": {"type": "array"}, "evidence_class": {"enum": EV}, "evidence": {"type": "string"}, "m3_probes": {"type": "array", "items": {"type": "string"}}, "blocked_until": {"type": ["string", "null"]}, "qualification_note": {"type": "string"}, "m3_question": {"type": "string"}}}}}, ["schema", "version", "status", "evidence_class_vocabulary", "rows"])
dump("schemas/resolveCapabilityMatrix.schema.json", cap_schema)
fixture("capabilities-frozen", "positive", "resolveCapabilityMatrix", caps)
neg = copy.deepcopy(caps); neg["rows"][2]["evidence_class"] = "QUALIFIED"
fixture("capabilities-unknown-evidence-class", "negative", "resolveCapabilityMatrix", neg, "enum")

# ============================================================ provisional schema tweaks (mutation plan gets milestone + guard binding; conflict policy semantics)
mp = load("schemas/provisional/resolveMutationPlan.schema.json")
mp["properties"]["milestone"] = {"enum": ["M2", "M3"]}
mp["properties"]["h0_guard_digest"] = SHA
mp["properties"]["h0_payload_sha256"]["description"] = "payload digest of H0; insufficient alone; h0_guard_digest is the version token"
mp["required"] = sorted(set(mp["required"]) | {"milestone", "h0_guard_digest", "dry_run"})
mp["properties"]["operations"]["items"]["properties"]["selector"] = {"type": "object", "required": ["library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "track_type", "track_index"], "properties": {"library_instance_uuid": UUID, "project_unique_id": {"type": "string"}, "timeline_unique_id": {"type": "string"}, "target_epoch": {"type": "string"}, "track_type": {"enum": ["video", "audio"]}, "track_index": POSINT, "item_unique_id": {"type": "string"}, "expected_start": FRAME_QTY, "expected_end": FRAME_QTY, "expected_media_pool_item_unique_id": {"type": "string"}, "expected_marker_custom_data": {"type": "string"}}, "additionalProperties": False}
mp["$comment"] = "PROVISIONAL_UNTIL_M3. Schema-valid != authorized to mutate. A plan is executable only if PERMISSIONS.json allows every operation at (milestone, scope), the semantic validator passes, dry_run is false only at M3, and h0_guard_digest equals the current guard."
dump("schemas/provisional/resolveMutationPlan.schema.json", mp)
cf = load("schemas/provisional/resolveConflict.schema.json")
cf["properties"]["policy"] = {"enum": ["PRESERVE", "PROPOSE_REVIEW_NOTE", "REQUEST_RECONCILIATION", "STOP"]}
cf["properties"]["authority_effect"] = {"const": "NONE_UNTIL_HUMAN_ADJUDICATION"}
cf["required"] = sorted(set(cf["required"]) | {"authority_effect"})
cf["$comment"] = "PROVISIONAL_UNTIL_M3. The former IMPORT_OVERRIDE is renamed PROPOSE_REVIEW_NOTE: a Resolve observation may only produce an unsubmitted, non-authoritative draftReview.v2 proposal. STALE_ASSET is evaluated against the Episode Factory canonical head, never against the newest Resolve observation or any 'newer handoff' inferred from Resolve."
dump("schemas/provisional/resolveConflict.schema.json", cf)

# semantic fixtures for provisional authorities
plan_ok = {"schema": "vidtoolz.resolveMutationPlan.v1", "plan_digest": "0" * 64, "milestone": "M2", "dry_run": True, "target_epoch": "epoch-fixture-1", "target_contract_digest": "1" * 64, "binding_set_digest": "2" * 64, "handoff_digest_sha256": "3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69", "h0_payload_sha256": snap_pos["payload_sha256"], "h0_guard_digest": snap_pos["guard_digest"], "capability_matrix_version": "1.1.0", "collector_version": "0.0.0-fixture", "timebase_digest": "4" * 64, "permission_class": "RESOLVE_ASSEMBLE", "scope": scope, "lease": {}, "operations": [{"operation_id": "op-1", "op": "APPEND", "selector": {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "track_type": "video", "track_index": 1}, "expected_old": None, "expected_new": {"start": 110194, "end": 110541}, "allowed_created": ["one item"], "allowed_deleted": [], "declared_side_effects": []}]}
dump("fixtures/semantic/plan-m2-append-dry-run-denied.json", {"fixture": "plan-m2-append-dry-run-denied", "check": "semantic_mutation_plan", "expect_errors": True, "note": "APPEND is not permitted at M2 even as dry-run plan execution; plan construction is allowed, execution permission is not", "document": plan_ok})
plan_m3 = copy.deepcopy(plan_ok); plan_m3["milestone"] = "M3"; plan_m3["dry_run"] = False
dump("fixtures/semantic/plan-m3-append-selector-complete.json", {"fixture": "plan-m3-append-selector-complete", "check": "semantic_mutation_plan", "expect_errors": False, "document": plan_m3})
plan_bad = copy.deepcopy(plan_m3); plan_bad["operations"][0]["op"] = "DELETE"; plan_bad["operations"][0]["expected_old"] = {"unique_id": "it-1"}
dump("fixtures/semantic/plan-m3-delete-selector-incomplete.json", {"fixture": "plan-m3-delete-selector-incomplete", "check": "semantic_mutation_plan", "expect_errors": True, "document": plan_bad})
plan_stale = copy.deepcopy(plan_m3); plan_stale["h0_guard_digest"] = "9" * 64
dump("fixtures/semantic/plan-m3-stale-guard.json", {"fixture": "plan-m3-stale-guard", "check": "semantic_mutation_plan", "expect_errors": True, "guard_digest": snap_pos["guard_digest"], "document": plan_stale})
plan_m2_live = copy.deepcopy(plan_ok); plan_m2_live["dry_run"] = False; plan_m2_live["operations"] = []
dump("fixtures/semantic/plan-m2-non-dry-run.json", {"fixture": "plan-m2-non-dry-run", "check": "semantic_mutation_plan", "expect_errors": True, "document": plan_m2_live})
vr_ok = {"schema": "vidtoolz.resolveVerificationResult.v1", "plan_digest": "0" * 64, "h0_payload_sha256": "1" * 64, "s1_payload_sha256": "2" * 64, "added": ["it-new"], "removed": [], "changed": [], "creation_identity_map": {"op-1": "it-new"}, "missing_expected": [], "unrelated": [], "coverage": {}, "verdict": "VERIFIED", "is_human_approval": False}
dump("fixtures/semantic/verification-verified-clean.json", {"fixture": "verification-verified-clean", "check": "semantic_verification_result", "expect_errors": False, "document": vr_ok})
vr_bad = copy.deepcopy(vr_ok); vr_bad["unrelated"] = ["it-3 moved"]
dump("fixtures/semantic/verification-verified-with-unrelated.json", {"fixture": "verification-verified-with-unrelated", "check": "semantic_verification_result", "expect_errors": True, "document": vr_bad})
vr_bad2 = copy.deepcopy(vr_ok); vr_bad2["is_human_approval"] = True
dump("fixtures/semantic/verification-claims-human-approval.json", {"fixture": "verification-claims-human-approval", "check": "semantic_verification_result", "expect_errors": True, "document": vr_bad2})


def jrec(seq, state, prev):
    return {"schema": "vidtoolz.resolveTransactionJournal.v1", "transaction_id": "tx-fixture", "sequence": seq, "previous_record_sha256": prev, "state": state, "plan_digest": "0" * 64, "operation_id": None, "intent": {"phase": state}, "result": None, "readback_payload_sha256": None, "checkpoint": None, "recorded_at": "2026-09-08T00:00:00Z"}


chain = []
prev = None
for i, st in enumerate(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"]):
    r = jrec(i, st, prev); chain.append(r); prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
dump("fixtures/semantic/journal-legal-chain.json", {"fixture": "journal-legal-chain", "check": "semantic_journal", "expect_errors": False, "document": chain})
bad = copy.deepcopy(chain); bad[4]["state"] = "COMMITTED"  # PREFLIGHT_OK -> COMMITTED illegal (and chain breaks afterwards)
dump("fixtures/semantic/journal-skip-to-committed.json", {"fixture": "journal-skip-to-committed", "check": "semantic_journal", "expect_errors": True, "document": bad})
bad2 = copy.deepcopy(chain); bad2[3]["previous_record_sha256"] = "f" * 64
dump("fixtures/semantic/journal-broken-hash-chain.json", {"fixture": "journal-broken-hash-chain", "check": "semantic_journal", "expect_errors": True, "document": bad2})
dump("fixtures/semantic/commit-without-published.json", {"fixture": "commit-without-published", "check": "semantic_commit_manifest", "expect_errors": True, "terminal_journal_state": "VERIFIED", "document": {"schema": "vidtoolz.resolveCommitManifest.v1"}})
dump("fixtures/semantic/commit-after-published.json", {"fixture": "commit-after-published", "check": "semantic_commit_manifest", "expect_errors": False, "terminal_journal_state": "PUBLISHED", "document": {"schema": "vidtoolz.resolveCommitManifest.v1"}})
dump("fixtures/semantic/timebase-valid.json", {"fixture": "timebase-valid", "check": "semantic_timebase", "expect_errors": False, "document": tb})
dump("fixtures/semantic/target-valid-unprovisioned.json", {"fixture": "target-valid-unprovisioned", "check": "semantic_target_contract", "expect_errors": False, "document": tc})
dump("fixtures/semantic/track-policy-valid.json", {"fixture": "track-policy-valid", "check": "semantic_track_policy", "expect_errors": False, "document": tp})
dump("fixtures/semantic/canary-valid.json", {"fixture": "canary-valid", "check": "semantic_canary_manifest", "expect_errors": False, "document": cm})
print("build_v1_1: OK")
