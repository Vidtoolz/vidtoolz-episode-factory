#!/usr/bin/env python3
"""Generate v1.3 machine artifacts as a narrow correction of v1.2. Deterministic; offline; no Resolve.
Run from the bundle dir: python3 -B tools/build_v1_3.py
Inputs: the v1.2 instances/schemas already seeded in this directory (byte-identical copies of the frozen v1.2 bundle)."""
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

SHA = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
SHA_OR_NULL = {"anyOf": [SHA, {"type": "null"}]}
NONNEG = {"type": "integer", "minimum": 0}
POSINT = {"type": "integer", "minimum": 1}
RATIONAL_TAG = {"type": "object", "additionalProperties": False, "required": ["$rational"], "properties": {"$rational": {"type": "string", "pattern": "^(0|[1-9][0-9]*)/([1-9][0-9]*)$"}}}
FRAME_QTY = {"anyOf": [NONNEG, RATIONAL_TAG]}
FRAME_QTY_OR_NULL = {"anyOf": [NONNEG, RATIONAL_TAG, {"type": "null"}]}
ABS_PATH = {"type": "string", "pattern": "^/(?!.*(^|/)\\.\\.(/|$)).*$", "minLength": 2}
UUID = {"type": "string", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}
OBS = {"enum": list(L.OBS_STATUS)}
UU = "7e11aa60-fe44-4f3e-aa35-515e9a0d30ca"
SCOPE = "SCRATCH_QUALIFICATION_LIBRARY"
HOST = "vidnux"
LIB = "VIDTOOLZ Resolve Qualification v1"
VER = "21.1.0.0014"
PFX = "VIDTOOLZ_RESOLVE_QUAL_V1_"
PROJ = PFX + "FIXTURE"
TL = "VIDTOOLZ__fixture__r1"
EV = ["QUALIFIED_READ", "DOCUMENTED_NOT_QUALIFIED", "NOT_TESTED", "UNSUPPORTED", "BLOCKED", "QUALIFIED_EF_SIDE"]
FIXTURE_COUNT = [0]


def dump(rel, obj):
    p = os.path.join(B, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load(rel):
    return L.strict_load(os.path.join(B, rel))


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
    assert layer in L.FIXTURE_LAYERS, layer
    d = {"fixture": name, "layer_expected_failure": layer, "schema": schema, "check": check, "expect_error_contains": expect_contains, "document": doc}
    if extra:
        d.update(extra)
    dump(f"fixtures/layered/{name}.json", d)
    FIXTURE_COUNT[0] += 1


# ============================================================ TARGET CONTRACT v1.3: attachment state is DERIVED, never declared
tc = load("TARGET-CONTRACT.json")
tc["schema"] = "vidtoolz.resolveTargetContract.v1.3"
tc["version"] = "1.3.0"
tc["qualification_note"] = "library root_path/instance_uuid/launch recipe are required future observations, not fabricated; attachment state is derived by tools/authority_lib.py#derive_attachment_state from a validated evidence set, never declared"
tc.pop("attachment_state", None)
tc.pop("attachment_evidence", None)
tc["attachment_state_is_declared"] = False
tc["attachment_derivation"] = "tools/authority_lib.py#derive_attachment_state(target_contract, evidence_set)"
tc["attachment_states"] = {
    "UNPROVISIONED": {"required_records": [], "meaning": "no attachment permitted; no valid PROVISIONING_RECORD for contract host+library"},
    "PROVISIONED_NOT_VERIFIED": {"required_records": ["PROVISIONING_RECORD"], "meaning": "library exists on disk (root_path absolute, instance_uuid, provisioned_by); host/library identity not yet proven against launch recipe and bundle"},
    "ATTACHMENT_READY": {"required_records": ["PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION"], "meaning": "launch recipe pinned to contract resolve version, /opt/resolve/bin/resolve sha and Local scripting preference; bundle independently verified (verifier != prepared_by) for authority_version 1.3.0; library not prohibited"},
    "ATTACHED_READ_ONLY": {"required_records": ["PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION", "CONNECTION_OBSERVATION"], "meaning": "the latest CONNECTION_OBSERVATION shows db_type Disk, db_name == contract library (not prohibited), product/version == contract, root == provisioning root; any mismatch keeps ATTACHMENT_READY with failure OBSERVED_TARGET_MISMATCH"},
    "SCRATCH_WRITE_READY": {"required_records": ["PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION", "CONNECTION_OBSERVATION", "M3_AUTHORIZATION", "EXCLUSIVE_SESSION_ATTESTATION", "REFREEZE_RECORD"], "meaning": "all read-only requirements plus Mikko's scratch-scope authorization for authority 1.3.0, exclusive-session attestation and a reviewed M0_READ_REQUALIFICATION refreeze record; scope is always SCRATCH_QUALIFICATION_LIBRARY"},
}
tc["attachment_law"] = "schema validity != attachment eligibility; the state is a function of (TARGET-CONTRACT, evidence set) computed by derive_attachment_state; a document that declares a state is rejected (attachment_state_is_declared must be false); M0 probe requires derived ATTACHMENT_READY; every other M0 read op requires derived ATTACHED_READ_ONLY; any M3 write requires derived SCRATCH_WRITE_READY"
tc["required_future_observations"] = [
    {"field": "PROVISIONING_RECORD.root_path/instance_uuid", "source": "operator provisioning record (external UUID minted at provisioning)", "blocks": "PROVISIONED_NOT_VERIFIED"},
    {"field": "LAUNCH_RECIPE.recipe_sha256/resolve_binary_sha256", "source": "recorded launch script pinned to /opt/resolve/bin/resolve", "blocks": "ATTACHMENT_READY"},
    {"field": "BUNDLE_VERIFICATION.manifest_sha256", "source": "independent verifier (not the preparer) of FREEZE-MANIFEST.json 1.3.0", "blocks": "ATTACHMENT_READY"},
    {"field": "CONNECTION_OBSERVATION.db_name/db_type/product/resolve_version", "source": "M0 READ_PRIMITIVE_QUALIFICATION_PROBE (session-scope)", "blocks": "ATTACHED_READ_ONLY"},
    {"field": "session.external_scripting_preference_observed", "source": "M0 connection evidence", "blocks": "M0 exit"},
]
dump("TARGET-CONTRACT.json", tc)
tcs = load("schemas/resolveTargetContract.schema.json")
tcs["$id"] = "vidtoolz.resolveTargetContract.v1.3"
tcs["title"] = "Resolve target contract v1.3 (attachment gate; derived state)"
tcs["properties"]["schema"] = {"const": "vidtoolz.resolveTargetContract.v1.3"}
tcs["properties"]["version"] = {"type": "string", "pattern": "^1\\.3\\.[0-9]+$"}
for k in ("attachment_state", "attachment_evidence"):
    tcs["properties"].pop(k, None)
tcs["properties"]["attachment_state_is_declared"] = {"const": False}
tcs["properties"]["attachment_derivation"] = {"const": "tools/authority_lib.py#derive_attachment_state(target_contract, evidence_set)"}
tcs["properties"]["attachment_states"] = {"type": "object", "additionalProperties": False, "required": L.ATTACHMENT_STATES, "properties": {s: {"type": "object", "additionalProperties": False, "required": ["required_records", "meaning"], "properties": {"required_records": {"type": "array", "items": {"enum": sorted(L.RECORD_TYPES)}, "uniqueItems": True}, "meaning": {"type": "string"}}} for s in L.ATTACHMENT_STATES}}
tcs["properties"]["attachment_law"] = {"type": "string"}
tcs["required"] = sorted((set(tcs["required"]) - {"attachment_state", "attachment_evidence"}) | {"attachment_state_is_declared", "attachment_derivation", "attachment_states", "attachment_law"})
tcs["$comment"] = "v1.3: attachment_state is not a field. Any document carrying attachment_state is schema-invalid (additionalProperties false). State is derived from a validated evidence set."
dump("schemas/resolveTargetContract.schema.json", tcs)
fixture("target-contract-frozen-derived", "none", "resolveTargetContract", tc, check="semantic_target_contract")
neg = copy.deepcopy(tc); neg["attachment_state"] = "ATTACHMENT_READY"; fixture("target-declared-attachment-state", "schema", "resolveTargetContract", neg, expect_contains="attachment_state")
neg = copy.deepcopy(tc); neg["attachment_state_is_declared"] = True; fixture("target-declared-flag-true", "schema", "resolveTargetContract", neg, expect_contains="False")
neg = copy.deepcopy(tc); neg["accepts_current_open_session_as_target"] = True; fixture("target-accepts-open-session", "schema", "resolveTargetContract", neg, expect_contains="False")
neg = copy.deepcopy(tc); neg["library"]["kind"] = "PostgreSQL"; fixture("target-shared-postgres-library", "schema", "resolveTargetContract", neg, expect_contains="Disk")
neg = copy.deepcopy(tc); neg["denied_calls_all_scopes"].remove("SetCurrentDatabase"); fixture("target-missing-denied-setcurrentdatabase", "schema", "resolveTargetContract", neg, expect_contains="contains")
neg = copy.deepcopy(tc); neg["host"]["name"] = ""; fixture("target-empty-host", "schema", "resolveTargetContract", neg, expect_contains="minLength")
neg = copy.deepcopy(tc); neg["library"]["provisioning_status"] = "PROVISIONED"; neg["library"]["root_path"] = "/home/vidtoolz/../etc/resolve-qual"; neg["library"]["instance_uuid"] = UU; fixture("target-path-traversal", "schema", "resolveTargetContract", neg, expect_contains="anyOf")
neg = copy.deepcopy(tc); neg["library"]["name"] = "EKA"; fixture("target-library-is-prohibited", "schema", "resolveTargetContract", neg, expect_contains="pattern")
neg = copy.deepcopy(tc); neg["library"]["prohibited_library_names"] = ["Local Database", "nelja"]; fixture("target-prohibited-list-drops-eka", "schema", "resolveTargetContract", neg, expect_contains="contains")
neg = copy.deepcopy(tc); neg["attachment_states"]["ATTACHED_READ_ONLY"]["required_records"] = ["VIBES"]; fixture("target-unknown-record-type", "schema", "resolveTargetContract", neg, expect_contains="enum")

# ============================================================ EVIDENCE SET schema + fixture evidence sets
def rec_schema(rtype, req, props):
    return {"if": {"properties": {"record_type": {"const": rtype}}}, "then": {"required": sorted(set(req) | {"record_type", "record_id", "target", "recorded_at"}), "properties": props}}


target_s = {"type": "object", "additionalProperties": False, "required": ["host_name"], "properties": {"host_name": {"type": "string", "minLength": 1}, "library_name": {"type": "string", "minLength": 1}}}
record_common = {"record_type": {"enum": sorted(L.RECORD_TYPES)}, "record_id": SHA, "target": target_s, "recorded_at": {"type": "string", "minLength": 1}}
RECORD_RULES = [
    rec_schema("PROVISIONING_RECORD", ["library_kind", "root_path", "instance_uuid", "provisioned_by"], {"library_kind": {"const": "Disk"}, "root_path": ABS_PATH, "instance_uuid": UUID, "provisioned_by": {"type": "string", "minLength": 1}}),
    rec_schema("LAUNCH_RECIPE", ["recipe_sha256", "resolve_version", "resolve_binary_sha256", "external_scripting_preference"], {"recipe_sha256": SHA, "resolve_version": {"type": "string"}, "resolve_binary_sha256": SHA, "external_scripting_preference": {"enum": ["Local", "Network", "None"]}}),
    rec_schema("BUNDLE_VERIFICATION", ["authority_version", "manifest_sha256", "verifier", "prepared_by"], {"authority_version": {"type": "string"}, "manifest_sha256": SHA, "verifier": {"type": "string", "minLength": 1}, "prepared_by": {"type": "string", "minLength": 1}}),
    rec_schema("CONNECTION_OBSERVATION", ["db_type", "db_name", "product", "resolve_version"], {"db_type": {"type": "string"}, "db_name": {"type": "string"}, "product": {"type": "string"}, "resolve_version": {"type": "string"}, "root_path": {"type": ["string", "null"]}}),
    rec_schema("PROJECT_BINDING_OBSERVATION", ["project_name", "project_unique_id", "project_unique_id_status"], {"project_name": {"type": "string", "minLength": 1}, "project_unique_id": {"type": ["string", "null"]}, "project_unique_id_status": OBS}),
    rec_schema("TIMELINE_BINDING_OBSERVATION", ["project_name", "timeline_name", "timeline_unique_id", "timeline_unique_id_status"], {"project_name": {"type": "string", "minLength": 1}, "timeline_name": {"type": "string", "minLength": 1}, "timeline_unique_id": {"type": ["string", "null"]}, "timeline_unique_id_status": OBS}),
    rec_schema("OPERATOR_PROVISIONED_PROJECT", ["project_name", "provisioned_by"], {"project_name": {"type": "string", "minLength": 1}, "provisioned_by": {"type": "string", "minLength": 1}}),
    rec_schema("CAPABILITY_EVIDENCE", ["method", "host", "resolve_version", "build", "observed_result", "evidence_sha256", "reviewed_refreeze_version"], {"method": {"type": "string", "minLength": 1}, "host": {"type": "string"}, "resolve_version": {"type": "string"}, "build": {"type": "integer"}, "observed_result": {"type": "string"}, "evidence_sha256": SHA, "reviewed_refreeze_version": {"type": ["string", "null"]}}),
    rec_schema("REFREEZE_RECORD", ["kind", "reviewed", "manifest_sha256", "authority_version"], {"kind": {"enum": ["M0_READ_REQUALIFICATION"]}, "reviewed": {"type": "boolean"}, "manifest_sha256": SHA, "authority_version": {"type": "string"}}),
    rec_schema("MILESTONE_EXIT", ["milestone", "authority_version", "evidence_dir_sha256"], {"milestone": {"enum": ["M0", "M1", "M2"]}, "authority_version": {"type": "string"}, "evidence_dir_sha256": SHA}),
    rec_schema("M3_AUTHORIZATION", ["scope", "approver", "authority_version"], {"scope": {"const": SCOPE}, "approver": {"type": "string", "minLength": 1}, "authority_version": {"type": "string"}}),
    rec_schema("JOURNAL_PREPARED", ["transaction_id", "plan_digest", "journal_path_sha256"], {"transaction_id": {"type": "string", "minLength": 1}, "plan_digest": SHA, "journal_path_sha256": SHA}),
    rec_schema("READ_ONLY_JOURNAL", ["journal_path_sha256"], {"journal_path_sha256": SHA}),
    rec_schema("EXCLUSIVE_SESSION_ATTESTATION", ["attested_by", "pid_observed"], {"attested_by": {"type": "string", "minLength": 1}, "pid_observed": {"type": "integer"}}),
    rec_schema("GUARD_SNAPSHOT", ["guard_digest", "project_name", "timeline_name", "payload_sha256"], {"guard_digest": SHA, "project_name": {"type": "string"}, "timeline_name": {"type": "string"}, "payload_sha256": SHA}),
    rec_schema("PLAN_VALIDATION", ["plan_digest", "result", "authority_version", "validator"], {"plan_digest": SHA, "result": {"enum": ["PASS", "FAIL"]}, "authority_version": {"type": "string"}, "validator": {"type": "string"}}),
    rec_schema("MEDIA_CLASS_ATTESTATION", ["media_class", "media_sha256"], {"media_class": {"enum": ["SYNTHETIC", "PRODUCTION"]}, "media_sha256": SHA}),
    rec_schema("DESTINATION_TIMELINE", ["project_name", "timeline_name", "timeline_unique_id"], {"project_name": {"type": "string"}, "timeline_name": {"type": "string"}, "timeline_unique_id": {"type": "string"}}),
]
ev_schema = S("vidtoolz.resolveEvidenceSet.v1.3", "Linked evidence set (content-addressed records)", {"schema": {"const": "vidtoolz.resolveEvidenceSet.v1.3"}, "records": {"type": "object", "propertyNames": {"pattern": "^[a-f0-9]{64}$"}, "additionalProperties": {"type": "object", "required": ["record_type", "record_id", "target", "recorded_at"], "properties": record_common, "allOf": RECORD_RULES}}}, ["schema", "records"],
              comment="Every record is addressed by sha256(domain vidtoolz.resolveEvidenceRecord.v1 + canonical body without record_id). A reference is evidence only if it is a sha256 string, exists here, has the expected record_type, re-hashes to its id and belongs to the same target (validate_evidence_set + resolve_ref). Strings, booleans, empty values and unlinked hashes are never evidence.")
dump("schemas/resolveEvidenceSet.schema.json", ev_schema)
req_schema = S("vidtoolz.resolveEligibilityRequest.v1.3", "Eligibility request (no state or qualification assertions)", {"schema": {"const": "vidtoolz.resolveEligibilityRequest.v1.3"}, "milestone": {"type": "string"}, "operation": {"type": "string"}, "scope": {"type": "string"}, "expected_project_name": {"type": ["string", "null"]}, "expected_timeline_name": {"type": ["string", "null"]}, "transaction_id": {"type": ["string", "null"]}, "plan_digest": {"anyOf": [SHA, {"type": "null"}]}, "plan_h0_guard_digest": {"anyOf": [SHA, {"type": "null"}]}, "refs": {"type": "object", "additionalProperties": False, "properties": {k: SHA for k in ("authorization", "journal_prepared", "read_only_journal", "guard", "plan_validation", "m0_exit", "m1_exit", "m2_exit", "exclusive_session", "media_class", "destination_timeline")}}}, ["schema", "milestone", "operation", "scope", "refs"],
               comment="additionalProperties false: attachment_state, capability_state, evidence, journal_available, guard_available and authorization_token are not request fields; the evaluator derives them from TARGET-CONTRACT, CAPABILITIES, READ-PRIMITIVES, PERMISSIONS and the evidence set.")
dump("schemas/resolveEligibilityRequest.schema.json", req_schema)


def R(rtype, library=LIB, tgt_host=HOST, **fields):
    t = {"host_name": tgt_host}
    if library is not None:
        t["library_name"] = library
    return L.make_record(dict({"record_type": rtype, "target": t, "recorded_at": "2026-09-08T00:00:00Z"}, **fields))


def ES(*records):
    return {"schema": "vidtoolz.resolveEvidenceSet.v1.3", "records": {r["record_id"]: r for r in records}}


BIN_SHA = tc["resolve"]["pins"]["/opt/resolve/bin/resolve"]
r_prov = R("PROVISIONING_RECORD", library_kind="Disk", root_path="/home/vidtoolz/resolve-qualification-library-v1", instance_uuid=UU, provisioned_by="Mikko (operator)")
r_prov_bad_uuid = R("PROVISIONING_RECORD", library_kind="Disk", root_path="/home/vidtoolz/resolve-qualification-library-v1", instance_uuid="not-a-uuid", provisioned_by="Mikko (operator)")
r_launch = R("LAUNCH_RECIPE", library=None, recipe_sha256="a" * 64, resolve_version=VER, resolve_binary_sha256=BIN_SHA, external_scripting_preference="Local")
r_launch_wrong_bin = R("LAUNCH_RECIPE", library=None, recipe_sha256="a" * 64, resolve_version=VER, resolve_binary_sha256="b" * 64, external_scripting_preference="Local")
r_bundle = R("BUNDLE_VERIFICATION", library=None, authority_version="1.3.0", manifest_sha256="c" * 64, verifier="Codex (independent)", prepared_by="Claude Code (Fable 5.1)")
r_bundle_self = R("BUNDLE_VERIFICATION", library=None, authority_version="1.3.0", manifest_sha256="c" * 64, verifier="Claude Code (Fable 5.1)", prepared_by="Claude Code (Fable 5.1)")
r_bundle_old = R("BUNDLE_VERIFICATION", library=None, authority_version="1.2.0", manifest_sha256="69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6", verifier="Codex (independent)", prepared_by="Claude Code (Fable 5.1)")
r_conn = R("CONNECTION_OBSERVATION", db_type="Disk", db_name=LIB, product="DaVinci Resolve Studio", resolve_version=VER, root_path="/home/vidtoolz/resolve-qualification-library-v1")
r_conn_eka = R("CONNECTION_OBSERVATION", db_type="PostgreSQL", db_name="EKA", product="DaVinci Resolve Studio", resolve_version=VER, root_path=None)
r_conn_local = R("CONNECTION_OBSERVATION", db_type="Disk", db_name="Local Database", product="DaVinci Resolve Studio", resolve_version=VER, root_path=None)
r_conn_ver = R("CONNECTION_OBSERVATION", db_type="Disk", db_name=LIB, product="DaVinci Resolve Studio", resolve_version="21.0.3.0007", root_path="/home/vidtoolz/resolve-qualification-library-v1")
r_conn_presto = R("CONNECTION_OBSERVATION", tgt_host="PRESTO", db_type="Disk", db_name=LIB, product="DaVinci Resolve Studio", resolve_version=VER, root_path="V:/resolve-qual")
r_pb = R("PROJECT_BINDING_OBSERVATION", project_name=PROJ, project_unique_id="proj-fixture-0001", project_unique_id_status="OBSERVED")
r_pb_noid = R("PROJECT_BINDING_OBSERVATION", project_name=PROJ, project_unique_id=None, project_unique_id_status="UNAVAILABLE")
r_pb_human = R("PROJECT_BINDING_OBSERVATION", project_name="PYSTY UHD", project_unique_id=None, project_unique_id_status="UNAVAILABLE")
r_pb_operator = R("PROJECT_BINDING_OBSERVATION", project_name="Mikko human scratch", project_unique_id=None, project_unique_id_status="UNAVAILABLE")
r_opp = R("OPERATOR_PROVISIONED_PROJECT", project_name="Mikko human scratch", provisioned_by="Mikko (operator)")
r_tb = R("TIMELINE_BINDING_OBSERVATION", project_name=PROJ, timeline_name=TL, timeline_unique_id="tl-fixture-0001", timeline_unique_id_status="OBSERVED")
r_tb_noid = R("TIMELINE_BINDING_OBSERVATION", project_name=PROJ, timeline_name=TL, timeline_unique_id=None, timeline_unique_id_status="UNAVAILABLE")
r_roj = R("READ_ONLY_JOURNAL", journal_path_sha256="d" * 64)
PROBE_METHODS = sorted({p["method"] for p in load("READ-PRIMITIVES.json")["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["primitives"]})
r_caps = [R("CAPABILITY_EVIDENCE", library=None, method=m, host=HOST, resolve_version=VER, build=14, observed_result="returned non-null on fixture probe", evidence_sha256=hashlib.sha256(m.encode()).hexdigest(), reviewed_refreeze_version="1.4.0-HYPOTHETICAL") for m in PROBE_METHODS]
r_caps_unreviewed = [R("CAPABILITY_EVIDENCE", library=None, method=m, host=HOST, resolve_version=VER, build=14, observed_result="candidate", evidence_sha256=hashlib.sha256(m.encode()).hexdigest(), reviewed_refreeze_version=None) for m in PROBE_METHODS]
r_caps_wrong_build = [R("CAPABILITY_EVIDENCE", library=None, method=m, host=HOST, resolve_version="21.0.3.0007", build=7, observed_result="prior version", evidence_sha256=hashlib.sha256(m.encode()).hexdigest(), reviewed_refreeze_version="1.4.0-HYPOTHETICAL") for m in PROBE_METHODS]
r_m0 = R("MILESTONE_EXIT", library=None, milestone="M0", authority_version="1.3.0", evidence_dir_sha256="e" * 64)
r_m1 = R("MILESTONE_EXIT", library=None, milestone="M1", authority_version="1.3.0", evidence_dir_sha256="e" * 64)
r_m2 = R("MILESTONE_EXIT", library=None, milestone="M2", authority_version="1.3.0", evidence_dir_sha256="e" * 64)
r_auth = R("M3_AUTHORIZATION", library=None, scope=SCOPE, approver="Mikko", authority_version="1.3.0")
r_auth_old = R("M3_AUTHORIZATION", library=None, scope=SCOPE, approver="Mikko", authority_version="1.2.0")
r_excl = R("EXCLUSIVE_SESSION_ATTESTATION", library=None, attested_by="adapter preflight (single resolve pid)", pid_observed=4242)
r_refz = R("REFREEZE_RECORD", library=None, kind="M0_READ_REQUALIFICATION", reviewed=True, manifest_sha256="f" * 64, authority_version="1.4.0-HYPOTHETICAL")
r_refz_unreviewed = R("REFREEZE_RECORD", library=None, kind="M0_READ_REQUALIFICATION", reviewed=False, manifest_sha256="f" * 64, authority_version="1.4.0-HYPOTHETICAL")
r_media = R("MEDIA_CLASS_ATTESTATION", library=None, media_class="SYNTHETIC", media_sha256="1" * 64)
r_dest = R("DESTINATION_TIMELINE", project_name=PROJ, timeline_name=TL, timeline_unique_id="tl-fixture-0001")
EVSETS = {
    "empty": ES(),
    "provisioned-only": ES(r_prov),
    "provisioned-bad-uuid": ES(r_prov_bad_uuid, r_launch, r_bundle),
    "ready": ES(r_prov, r_launch, r_bundle, r_roj),
    "ready-wrong-binary-pin": ES(r_prov, r_launch_wrong_bin, r_bundle, r_roj),
    "ready-self-verified-bundle": ES(r_prov, r_launch, r_bundle_self, r_roj),
    "ready-bundle-verified-for-v1.2-only": ES(r_prov, r_launch, r_bundle_old, r_roj),
    "attached": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, r_pb_human, r_pb_operator, r_opp),
    "attached-no-ids": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb_noid, r_tb_noid),
    "attached-eka-observed": ES(r_prov, r_launch, r_bundle, r_roj, r_conn_eka, r_pb, r_tb),
    "attached-local-database-observed": ES(r_prov, r_launch, r_bundle, r_roj, r_conn_local, r_pb, r_tb),
    "attached-version-mismatch": ES(r_prov, r_launch, r_bundle, r_roj, r_conn_ver, r_pb, r_tb),
    "attached-wrong-host": ES(r_prov, r_launch, r_bundle, r_roj, r_conn_presto, r_pb, r_tb),
    "attached-candidate-evidence-unreviewed": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, *r_caps_unreviewed),
    "attached-evidence-wrong-build": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, *r_caps_wrong_build),
    "attached-reviewed-evidence": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, *r_caps),
    "write-ready-without-authorization": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, r_m0, r_m1, r_m2, r_excl, r_refz, r_media, r_dest),
    "write-ready-authorization-for-v1.2": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, r_m0, r_m1, r_m2, r_auth_old, r_excl, r_refz, r_media, r_dest),
    "write-ready-refreeze-unreviewed": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, r_m0, r_m1, r_m2, r_auth, r_excl, r_refz_unreviewed, r_media, r_dest),
    "write-ready-base": ES(r_prov, r_launch, r_bundle, r_roj, r_conn, r_pb, r_tb, r_m0, r_m1, r_m2, r_auth, r_excl, r_refz, r_media, r_dest),
}
for name, es in EVSETS.items():
    dump(f"fixtures/evidence/{name}.json", es)
# tampered set: a record whose body was edited after hashing
tampered = copy.deepcopy(EVSETS["attached"])
k = r_conn["record_id"]; tampered["records"][k]["db_name"] = "EKA"
dump("fixtures/evidence/attached-tampered-record.json", tampered)
EVSETS["attached-tampered-record"] = tampered

# ============================================================ SNAPSHOT v1.3: status for every frame/identity field, status-aware ordering, failure ledger, completeness
FS_FIELDS = list(L.ITEM_STATUS_FIELDS)
field_status = {"type": "object", "additionalProperties": False, "required": FS_FIELDS, "properties": {**{k: OBS for k in FS_FIELDS}, **{k + "_reason": {"type": "string", "minLength": 1} for k in FS_FIELDS}}}
common = {"unique_id": {"type": ["string", "null"]}, "observation_ordinal": NONNEG, "name": {"type": "string"}, "start": FRAME_QTY_OR_NULL, "end": FRAME_QTY_OR_NULL, "duration": FRAME_QTY_OR_NULL, "enabled": {"type": ["boolean", "null"]}, "markers": {"type": "array"}, "identity_observed": {"enum": ["COMPLETE", "PARTIAL", "NONE"]}, "field_status": field_status, "media_pool_item_unique_id": {"type": ["string", "null"]}, "media_id": {"type": ["string", "null"]}, "source_start": FRAME_QTY_OR_NULL, "source_end": FRAME_QTY_OR_NULL}
media_backed = {"type": "object", "additionalProperties": False, "required": list(common) + ["provenance", "source_locator", "source_status", "source_sha256"], "properties": dict(common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"const": "MEDIA_BACKED"}}}, source_locator={"type": ["string", "null"]}, source_status={"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}, source_sha256=SHA_OR_NULL)}
non_media = {"type": "object", "additionalProperties": False, "required": list(common) + ["provenance", "source_locator", "source_status", "source_sha256", "absence_reason"], "properties": dict(common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"enum": ["GENERATOR", "TITLE", "COMPOUND", "ADJUSTMENT", "FUSION_OR_GENERATED", "OTHER_OBSERVED"]}}}, source_locator={"type": "null"}, source_status={"const": "NOT_APPLICABLE"}, source_sha256={"type": "null"}, absence_reason={"enum": ["NO_MEDIA_POOL_ITEM", "NO_FILE_BACKED_SOURCE", "UNOBSERVED_BY_API"]})}
marker = {"type": "object", "additionalProperties": False, "required": ["object_address", "frame", "duration", "color", "name", "note", "custom_data"], "properties": {"object_address": {"type": "string", "minLength": 1}, "frame": FRAME_QTY, "duration": FRAME_QTY, "color": {"type": "string"}, "name": {"type": "string"}, "note": {"type": "string"}, "custom_data": {"type": "string"}}}
track = {"type": "object", "additionalProperties": False, "required": ["type", "index", "name", "enabled", "locked", "items"], "properties": {"type": {"enum": ["video", "audio", "subtitle"]}, "index": POSINT, "name": {"type": "string"}, "enabled": {"type": ["boolean", "null"]}, "locked": {"type": ["boolean", "null"]}, "items": {"type": "array", "items": {"oneOf": [media_backed, non_media]}}}}
coverage = {"type": "object", "additionalProperties": False, "required": ["profile", "complete", "observed_domains", "unobservable_domains", "deferred_domains", "incomplete_reasons"], "properties": {"profile": {"enum": list(L.COVERAGE_PROFILES)}, "complete": {"type": "boolean"}, "observed_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "unobservable_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "deferred_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "incomplete_reasons": {"type": "array", "items": {"type": "string", "minLength": 1}}}}
policy_s = {"type": "object", "additionalProperties": False, "required": ["target_contract_sha256", "timebase_sha256", "track_policy_sha256", "capabilities_version", "collector_version", "canonicalization_version"], "properties": {"target_contract_sha256": SHA, "timebase_sha256": SHA, "track_policy_sha256": SHA, "capabilities_version": {"type": "string"}, "collector_version": {"type": "string"}, "canonicalization_version": {"const": "1.3"}}}
library_s = {"type": "object", "additionalProperties": False, "required": ["db_type", "db_name", "instance_uuid"], "properties": {"db_type": {"enum": ["Disk"]}, "db_name": {"type": "string", "minLength": 1}, "instance_uuid": UUID}}
obs_fail = {"type": "object", "additionalProperties": False, "required": ["track_address", "observation_ordinal", "method", "reason"], "properties": {"track_address": {"type": "string", "minLength": 1}, "observation_ordinal": {"type": ["integer", "null"]}, "method": {"type": ["string", "null"]}, "reason": {"type": "string", "minLength": 1}}}
snap_schema = S("vidtoolz.resolveSnapshot.v1.3", "Canonical Resolve readback snapshot v1.3", {
    "schema": {"const": "vidtoolz.resolveSnapshot.v1.3"}, "collector_version": {"type": "string", "minLength": 1}, "canonicalization_version": {"const": "1.3"}, "target_epoch": {"type": "string", "minLength": 1}, "resolve_build": {"type": "string", "minLength": 1},
    "library": library_s,
    "project": {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "name", "last_modified_time_observed"], "properties": {"unique_id": {"type": ["string", "null"]}, "unique_id_status": OBS, "unique_id_reason": {"type": "string", "minLength": 1}, "name": {"type": "string"}, "last_modified_time_observed": {"type": ["integer", "string", "null"]}}},
    "collection": {"type": "object", "additionalProperties": False, "required": ["started_at", "ended_at", "generation", "stable_pair"], "properties": {"started_at": {"type": "string"}, "ended_at": {"type": "string"}, "generation": NONNEG, "stable_pair": {"type": "boolean"}}},
    "coverage": coverage, "policy": policy_s,
    "payload": {"type": "object", "additionalProperties": False, "required": ["timeline", "tracks", "markers", "media_dependencies", "observation_failures"], "properties": {
        "timeline": {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "name", "start_frame", "start_timecode", "fps", "width", "height", "end_frame", "is_current", "duration_convention", "settings"], "properties": {"unique_id": {"type": ["string", "null"]}, "unique_id_status": OBS, "unique_id_reason": {"type": "string", "minLength": 1}, "name": {"type": "string"}, "start_frame": NONNEG, "start_timecode": {"type": "string"}, "fps": {"type": "object", "additionalProperties": False, "required": ["numerator", "denominator"], "properties": {"numerator": POSINT, "denominator": POSINT}}, "width": POSINT, "height": POSINT, "end_frame": NONNEG, "is_current": {"type": "boolean"}, "duration_convention": {"enum": ["UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"]}, "settings": {"type": "object"}}},
        "tracks": {"type": "array", "items": track}, "markers": {"type": "array", "items": marker}, "media_dependencies": {"type": "array", "items": {"type": "object", "required": ["logical_locator", "source_sha256", "status"], "properties": {"logical_locator": {"type": "string"}, "source_sha256": SHA_OR_NULL, "status": {"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}}}}, "observation_failures": {"type": "array", "items": obs_fail}}},
    "payload_sha256": SHA, "guard_digest": SHA, "hash_domains": {"type": "object", "additionalProperties": False, "required": ["payload", "guard"], "properties": {"payload": {"const": "vidtoolz.resolveSnapshotPayload.v1.3"}, "guard": {"const": "vidtoolz.resolveGuard.v1"}}},
}, ["schema", "collector_version", "canonicalization_version", "target_epoch", "resolve_build", "library", "project", "collection", "coverage", "policy", "payload", "payload_sha256", "guard_digest", "hash_domains"],
    comment="v1.3 field observation model: every item frame/identity field (unique_id, start, end, duration, enabled, media_pool_item_unique_id, media_id, source_start, source_end) carries a status OBSERVED|UNAVAILABLE|UNSUPPORTED|ERROR|NOT_REQUESTED. OBSERVED requires a value; any other status requires null and (for UNAVAILABLE/ERROR) a reason. Items with unavailable frames stay in the canonical list under the status-aware sort key (option A); items that could not be enumerated go to payload.observation_failures (ledger), never silently omitted. coverage.complete may be true only when the profile's mandatory domains, mandatory item fields, identity requirements, lock requirements and guard requirement pass (semantic_snapshot); complete:false must list incomplete_reasons.")
dump("schemas/resolveSnapshot.schema.json", snap_schema)
guard_schema = load("schemas/resolveGuard.schema.json")
guard_schema["properties"]["coverage"] = coverage
guard_schema["properties"]["policy"] = policy_s
guard_schema["properties"]["library"] = library_s
guard_schema["properties"]["project"]["properties"]["unique_id"] = {"type": ["string", "null"], "$comment": "null only for read-only profiles with unqualified identity getters; WRITE_PRECHECK requires OBSERVED identity via semantic_snapshot"}
guard_schema["properties"]["timeline"]["properties"]["unique_id"] = {"type": ["string", "null"]}
guard_schema["$comment"] = "Guard digest = sha256(domain + canonical guard object). The guard object binds library identity, project/timeline identity+name, target_epoch, coverage (incl. incomplete_reasons), policy pins and payload digest. Payload digest alone is never a version token."
dump("schemas/resolveGuard.schema.json", guard_schema)
policy = {"target_contract_sha256": sha_of("TARGET-CONTRACT.json"), "timebase_sha256": sha_of("TIMEBASE.json"), "track_policy_sha256": sha_of("schemas/resolveTrackPolicy.v1.json"), "capabilities_version": "1.3.0", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.3"}


def fstat(**kw):
    base = {k: "OBSERVED" for k in FS_FIELDS}
    base.update(kw)
    return base


def item_media(uid, ordn, start, end, mp, sha=None, status="HASHED", name="clip", **kw):
    it = {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "COMPLETE", "field_status": fstat(media_id="UNAVAILABLE", media_id_reason="GetMediaId not qualified on 21.1.0.0014"), "provenance": {"kind": "MEDIA_BACKED"}, "media_pool_item_unique_id": mp, "media_id": None, "source_locator": f"/qual/media/{name}.png", "source_status": status, "source_sha256": sha, "source_start": 0, "source_end": end - start}
    it.update(kw)
    return it


def item_other(uid, ordn, start, end, kind, reason, name):
    return {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "PARTIAL", "field_status": fstat(media_pool_item_unique_id="NOT_REQUESTED", media_id="NOT_REQUESTED", source_start="UNSUPPORTED", source_end="UNSUPPORTED"), "provenance": {"kind": kind}, "media_pool_item_unique_id": None, "media_id": None, "source_locator": None, "source_status": "NOT_APPLICABLE", "source_sha256": None, "absence_reason": reason, "source_start": None, "source_end": None}


def item_partial(ordn, start, name):
    """start observed, end/duration unavailable: honest partial representation (option A)."""
    return dict(item_media(None, ordn, start, start, None, None, "UNHASHED_UNOWNED", name), end=None, duration=None, enabled=None, source_start=None, source_end=None, source_locator=None, identity_observed="NONE",
                field_status=fstat(unique_id="UNAVAILABLE", unique_id_reason="TimelineItem.GetUniqueId not qualified on 21.1.0.0014", end="UNAVAILABLE", end_reason="GetEnd not qualified on 21.1.0.0014", duration="UNAVAILABLE", duration_reason="GetDuration not qualified on 21.1.0.0014", enabled="UNAVAILABLE", enabled_reason="GetClipEnabled not qualified", media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="MediaPoolItem.GetUniqueId not qualified", media_id="NOT_REQUESTED", source_start="UNAVAILABLE", source_start_reason="GetSourceStartFrame not qualified", source_end="UNAVAILABLE", source_end_reason="GetSourceEndFrame not qualified"))


FULL_COV = {"profile": "FULL_TIMELINE_READ", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings", "adapter_bin_media"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "track_locks", "item_identity"], "incomplete_reasons": []}


def make_snapshot(tracks, markers=None, coverage_=None, convention="UNQUALIFIED", failures=None, project_id=("proj-fixture-0001", "OBSERVED"), timeline_id=("tl-fixture-0001", "OBSERVED")):
    tl = {"unique_id": timeline_id[0], "unique_id_status": timeline_id[1], "name": TL, "start_frame": 108000, "start_timecode": "01:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1080, "height": 1920, "end_frame": 114756, "is_current": True, "duration_convention": convention, "settings": {"useCustomSettings": "1", "timelineFrameRate": "30"}}
    if timeline_id[1] != "OBSERVED":
        tl["unique_id_reason"] = "Timeline.GetUniqueId not qualified on 21.1.0.0014; M0 probe pending"
    payload = {"timeline": tl, "tracks": tracks, "markers": markers or [], "media_dependencies": [], "observation_failures": failures or []}
    payload = L.normalize_snapshot_payload(payload)
    proj = {"unique_id": project_id[0], "unique_id_status": project_id[1], "name": PROJ, "last_modified_time_observed": None}
    if project_id[1] != "OBSERVED":
        proj["unique_id_reason"] = "Project.GetUniqueId not qualified on 21.1.0.0014; M0 probe pending"
    snap = {"schema": "vidtoolz.resolveSnapshot.v1.3", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.3", "target_epoch": "epoch-fixture-1", "resolve_build": VER, "library": {"db_type": "Disk", "db_name": LIB, "instance_uuid": UU}, "project": proj, "collection": {"started_at": "2026-09-08T00:00:00Z", "ended_at": "2026-09-08T00:00:01Z", "generation": 1, "stable_pair": True}, "coverage": copy.deepcopy(coverage_ or FULL_COV), "policy": policy, "payload": payload, "hash_domains": {"payload": "vidtoolz.resolveSnapshotPayload.v1.3", "guard": "vidtoolz.resolveGuard.v1"}}
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
# M0 minimal: identity unavailable, one partially observed item (end unavailable), one enumeration failure in the ledger; honest complete:false
M0_COV = {"profile": "MINIMAL_M0", "complete": False, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"], "incomplete_reasons": ["item[1].end UNAVAILABLE (GetEnd not qualified)", "observation_failures: V1 ordinal 2 GetItemListInTrack element raised"]}
m0_items = [dict(item_media(None, 0, 108000, 108300, None, None, "UNHASHED_UNOWNED", "c0"), field_status=fstat(unique_id="UNAVAILABLE", unique_id_reason="TimelineItem.GetUniqueId not qualified on 21.1.0.0014; M0 probe pending", media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="MediaPoolItem.GetUniqueId not qualified", media_id="NOT_REQUESTED", source_start="UNAVAILABLE", source_start_reason="GetSourceStartFrame not qualified", source_end="UNAVAILABLE", source_end_reason="GetSourceEndFrame not qualified"), identity_observed="NONE", source_start=None, source_end=None, source_locator=None), item_partial(1, 108300, "c1")]
m0_snap = make_snapshot([{"type": "video", "index": 1, "name": "V1", "enabled": None, "locked": None, "items": m0_items}], coverage_=M0_COV, failures=[{"track_address": "video:1", "observation_ordinal": 2, "method": "GetItemListInTrack", "reason": "element 2 raised on attribute access; item recorded in ledger, not fabricated"}], project_id=(None, "UNAVAILABLE"), timeline_id=(None, "UNAVAILABLE"))
dump("fixtures/snapshot/m0-minimal-partial-observation.json", m0_snap)
fixture("snapshot-m0-minimal-partial-honest", "none", "resolveSnapshot", m0_snap, check="semantic_snapshot")
# M0 minimal complete (all mandatory domains observed, nothing partial) — identities may be UNAVAILABLE under MINIMAL_M0
m0_complete = make_snapshot([{"type": "video", "index": 1, "name": "V1", "enabled": None, "locked": None, "items": [m0_items[0]]}], coverage_=dict(M0_COV, complete=True, incomplete_reasons=[]), project_id=(None, "UNAVAILABLE"), timeline_id=(None, "UNAVAILABLE"))
fixture("snapshot-m0-minimal-complete-identity-unavailable", "none", "resolveSnapshot", m0_complete, check="semantic_snapshot")
# WRITE_PRECHECK positive: everything resolved
wp_tracks = copy.deepcopy(human_tl)
for t in wp_tracks:
    t["items"] = [it for it in t["items"] if it["provenance"]["kind"] == "MEDIA_BACKED"]
    for it in t["items"]:
        it["field_status"]["media_id"] = "OBSERVED"; it["field_status"].pop("media_id_reason", None); it["media_id"] = "mid-" + it["unique_id"]
WP_COV = {"profile": "WRITE_PRECHECK", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"], "incomplete_reasons": []}
wp_snap = make_snapshot(wp_tracks, coverage_=WP_COV)
dump("fixtures/snapshot/write-precheck-complete.json", wp_snap)
fixture("snapshot-write-precheck-complete", "none", "resolveSnapshot", wp_snap, check="semantic_snapshot")


def sneg(name, mut, expect, layer="semantic", base=None):
    d = copy.deepcopy(base or snap_pos); mut(d)
    if layer == "semantic":
        try:
            d["payload_sha256"] = L.snapshot_payload_digest(d["payload"]); d["guard_digest"] = L.guard_digest(d)
        except L.CanonError:
            pass
    fixture(name, layer, "resolveSnapshot", d, check="semantic_snapshot" if layer != "schema" else None, expect_contains=expect)


def _it(d, t=0, i=0):
    return d["payload"]["tracks"][t]["items"][i]


sneg("snapshot-complete-empty-observed", lambda d: d["coverage"].update(observed_domains=[]), "empty observed")
sneg("snapshot-complete-write-precheck-missing-domains", lambda d: d["coverage"].update(profile="WRITE_PRECHECK"), "mandatory domains")
sneg("snapshot-invented-domain", lambda d: d["coverage"]["observed_domains"].append("vibes"), "enum", "schema")
sneg("snapshot-invented-field-status-name", lambda d: _it(d)["field_status"].update(vibe_level="OBSERVED"), "oneOf", "schema")
sneg("snapshot-observed-status-null-value", lambda d: _it(d).update(unique_id=None), "OBSERVED but value null")
sneg("snapshot-fabricated-id", lambda d: _it(d)["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x"), "fabrication")
sneg("snapshot-observed-start-null", lambda d: _it(d).update(start=None), "OBSERVED but value null")
sneg("snapshot-unavailable-end-with-value", lambda d: _it(d)["field_status"].update(end="UNAVAILABLE", end_reason="x"), "fabrication")
sneg("snapshot-unavailable-without-reason", lambda d: (_it(d).update(enabled=None), _it(d)["field_status"].update(enabled="UNAVAILABLE")), "requires a reason")
sneg("snapshot-not-requested-with-value", lambda d: _it(d)["field_status"].update(enabled="NOT_REQUESTED"), "fabrication")
sneg("snapshot-unknown-status-word", lambda d: _it(d)["field_status"].update(start="MAYBE"), "oneOf", "schema")
sneg("snapshot-timeline-identity-null-observed", lambda d: d["payload"]["timeline"].update(unique_id=None), "OBSERVED but value null")
sneg("snapshot-project-identity-null-observed", lambda d: d["project"].update(unique_id=None), "OBSERVED but value null")
sneg("snapshot-project-identity-value-with-unavailable", lambda d: d["project"].update(unique_id_status="UNAVAILABLE", unique_id_reason="x"), "fabrication")
sneg("snapshot-end-before-start", lambda d: _it(d).update(end=_it(d)["start"] - 1), "end < start")
sneg("snapshot-duration-contradiction", lambda d: _it(d).update(duration=999), "duration inconsistent")
sneg("snapshot-source-bounds-inverted", lambda d: _it(d).update(source_end=0, source_start=5), "source_end < source_start")
sneg("snapshot-timeline-end-before-start", lambda d: d["payload"]["timeline"].update(end_frame=100), "end_frame < start_frame")
sneg("snapshot-missing-ordinal", lambda d: _it(d).pop("observation_ordinal"), "oneOf", "schema")
sneg("snapshot-negative-frame", lambda d: _it(d).update(start=-5), "oneOf", "schema")
sneg("snapshot-postgres-library", lambda d: d["library"].update(db_type="PostgreSQL"), "Disk", "schema")
fixture("snapshot-guard-context-changed-raw", "semantic", "resolveSnapshot", dict(snap_pos, project=dict(snap_pos["project"], unique_id="proj-OTHER")), check="semantic_snapshot", expect_contains="guard_digest")
sneg("snapshot-incomplete-without-reasons", lambda d: d["coverage"].update(complete=False, incomplete_reasons=[]), "incomplete_reasons")
sneg("snapshot-incomplete-nothing-missing-named", lambda d: d["coverage"].update(complete=False, incomplete_reasons=["vibes"], unobservable_domains=[], deferred_domains=[]), "name missing")
sneg("snapshot-complete-with-partial-item-full-profile", lambda d: d["payload"]["tracks"][0]["items"].append(item_partial(9, 113000, "p")), "unresolved item fields")
sneg("snapshot-complete-with-observation-failures", lambda d: d["payload"].update(observation_failures=[{"track_address": "video:1", "observation_ordinal": 7, "method": "GetItemListInTrack", "reason": "raised"}]), "observation_failures present")
sneg("snapshot-failure-ledger-without-reason", lambda d: d["payload"].update(observation_failures=[{"track_address": "video:1", "observation_ordinal": 7, "method": None, "reason": ""}]), "minLength", "schema")
sneg("snapshot-full-profile-timeline-identity-unavailable-complete", lambda d: d["payload"]["timeline"].update(unique_id=None, unique_id_status="UNAVAILABLE", unique_id_reason="x"), "timeline.unique_id not OBSERVED")
sneg("snapshot-m0-complete-with-partial-item", lambda d: d["coverage"].update(complete=True, incomplete_reasons=[]), "observation_failures present", base=m0_snap)
sneg("snapshot-m0-complete-missing-mandatory-domain", lambda d: d["coverage"].update(observed_domains=["connection", "library", "project"]), "mandatory domains", base=m0_complete)
sneg("snapshot-write-precheck-null-lock", lambda d: d["payload"]["tracks"][0].update(locked=None), "unresolved track locks", base=wp_snap)
sneg("snapshot-write-precheck-project-id-unavailable", lambda d: d["project"].update(unique_id=None, unique_id_status="UNAVAILABLE", unique_id_reason="x"), "project.unique_id not OBSERVED", base=wp_snap)
sneg("snapshot-write-precheck-item-id-unavailable", lambda d: (_it(d).update(unique_id=None), _it(d)["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x")), "unresolved item fields", base=wp_snap)
sneg("snapshot-write-precheck-missing-guard-domain", lambda d: d["coverage"].update(observed_domains=[x for x in d["coverage"]["observed_domains"] if x != "guard"]), "mandatory domains", base=wp_snap)
sneg("snapshot-write-precheck-missing-policy-domain", lambda d: d["coverage"].update(observed_domains=[x for x in d["coverage"]["observed_domains"] if x != "policy"]), "mandatory domains", base=wp_snap)
sneg("snapshot-write-precheck-media-pool-id-unavailable", lambda d: (_it(d).update(media_pool_item_unique_id=None), _it(d)["field_status"].update(media_pool_item_unique_id="UNAVAILABLE", media_pool_item_unique_id_reason="x")), "unresolved item fields", base=wp_snap)
snap_b = copy.deepcopy(snap_pos); snap_b["project"]["unique_id"] = "proj-fixture-0002"; snap_b["guard_digest"] = L.guard_digest(snap_b)
dump("fixtures/guard/same-payload-different-project.json", {"purpose": "payload digest alone does not prove target context", "payload_sha256_equal": snap_pos["payload_sha256"] == snap_b["payload_sha256"], "guard_digest_equal": snap_pos["guard_digest"] == snap_b["guard_digest"], "a_guard": snap_pos["guard_digest"], "b_guard": snap_b["guard_digest"]})

# ============================================================ CANONICALIZATION VECTORS v1.3 (+ status-aware item order, f64 exactness)
vectors = []
PD = "vidtoolz.resolveSnapshotPayload.v1.3"


def vec(name, obj, domain="vidtoolz.resolveGeneric.v1", normalize=None, note=None):
    o = normalize(obj) if normalize else obj
    c = L.canon(o)
    vectors.append({"name": name, "note": note, "input": obj, "domain": domain, "canonical_utf8": c, "canonical_byte_length": len(c.encode("utf-8")), "sha256": L.digest(o, domain)})


vec("empty_object", {})
vec("key_order_codepoint", {"b": 1, "a": 2, "B": 3, "ä": 4, "aa": 5})
vec("string_escapes", {"s": "quote\" back\\ tab\t nl\n cr\r del slash/ emoji\U0001F600 ä"})
vec("integers_and_tagged", {"frames": 6756, "ms": 225183, "zero": 0, "neg": -17, "fps": {"$rational": "30/1"}, "gain": {"$f64": "3ff0000000000000"}})
vec("f64_one_canonical_form_positive_zero", {"z": {"$f64": "0000000000000000"}}, note="+0.0; negative zero is rejected, so one bit pattern has one text")
base_tl = {"unique_id": "t", "unique_id_status": "OBSERVED", "name": "t", "start_frame": 0, "start_timecode": "00:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1, "height": 1, "end_frame": 0, "is_current": True, "duration_convention": "UNQUALIFIED", "settings": {}}
tr = lambda typ, idx: {"type": typ, "index": idx, "name": f"{typ}{idx}", "enabled": True, "locked": False, "items": []}  # noqa: E731
P = lambda tracks, markers=None: {"timeline": base_tl, "tracks": tracks, "markers": markers or [], "media_dependencies": [], "observation_failures": []}  # noqa: E731
vec("numeric_track_index_2_before_10", P([tr("video", 10), tr("video", 2)]), PD, L.normalize_snapshot_payload, "track 2 sorts before track 10")
vec("track_type_order_video_audio_subtitle", P([tr("subtitle", 1), tr("audio", 1), tr("video", 1)]), PD, L.normalize_snapshot_payload, "video<audio<subtitle")
mk = lambda addr, frame, dur, cd, name, color, note: {"object_address": addr, "frame": frame, "duration": dur, "custom_data": cd, "name": name, "color": color, "note": note}  # noqa: E731
markers_a = [mk("timeline", 10, 1, "", "m", "Blue", "second"), mk("timeline", 5, 1, "", "m", "Blue", ""), mk("item:it-1", 5, 3, "", "m", "Blue", ""), mk("timeline", 7, 2, "vidtoolz:x", "a", "Red", "n1")]
pa, pb = P([], markers_a), P([], list(reversed(markers_a)))
assert L.snapshot_payload_digest(pa) == L.snapshot_payload_digest(pb)
vec("markers_total_order_A", pa, PD, L.normalize_snapshot_payload, "markers ordered by (object_address, frame, duration, custom_data, name, color, note)")
vec("markers_total_order_B_reversed_same_digest", pb, PD, L.normalize_snapshot_payload, "reversed input; same digest as A")
vec("markers_differ_only_in_note", P([], [mk("timeline", 1, 1, "", "m", "Blue", "zeta"), mk("timeline", 2, 1, "", "m", "Blue", "alpha")]), PD, L.normalize_snapshot_payload)
vec("markers_differ_only_in_duration", P([], [mk("timeline", 1, 9, "", "m", "Blue", ""), mk("timeline", 2, 1, "", "m", "Blue", "")]), PD, L.normalize_snapshot_payload)
vec("unicode_byte_distinct_strings", {"a": "ä", "b": "ä"}, note="NFC vs NFD are distinct strings; no normalization is applied")
perm_a = copy.deepcopy(human_tl); perm_b = list(reversed(copy.deepcopy(human_tl)))
for t in perm_b:
    t["items"] = list(reversed(t["items"]))
assert L.snapshot_payload_digest(P(perm_a)) == L.snapshot_payload_digest(P(perm_b))
vec("permutation_invariance_A", P(perm_a), PD, L.normalize_snapshot_payload)
vec("permutation_invariance_B_same_digest", P(perm_b), PD, L.normalize_snapshot_payload)
same_frame = P([{"type": "video", "index": 1, "name": "V1", "enabled": True, "locked": False, "items": [item_other("z-id", 2, 5, 9, "TITLE", "NO_FILE_BACKED_SOURCE", "t"), item_media("a-id", 1, 5, 9, "mp", None, "UNHASHED_UNOWNED", "m"), item_media("b-id", 0, 5, 7, "mp", None, "UNHASHED_UNOWNED", "n")]}])
vec("same_frame_items_deterministic", same_frame, PD, L.normalize_snapshot_payload, "shorter end first; MEDIA_BACKED<TITLE; then unique_id; then ordinal")
partial_mix = P([{"type": "video", "index": 1, "name": "V1", "enabled": None, "locked": None, "items": [item_partial(3, 20, "p3"), m0_items[0], item_partial(1, 20, "p1"), dict(item_partial(2, 5, "p2"))]}])
partial_mix_rev = copy.deepcopy(partial_mix); partial_mix_rev["tracks"][0]["items"].reverse()
assert L.snapshot_payload_digest(partial_mix) == L.snapshot_payload_digest(partial_mix_rev)
vec("partial_items_status_aware_order_A", partial_mix, PD, L.normalize_snapshot_payload, "option A: items with UNAVAILABLE end sort by (start, end-status rank, kind, id, ordinal); no frame value invented")
vec("partial_items_status_aware_order_B_same_digest", partial_mix_rev, PD, L.normalize_snapshot_payload)
vec("observation_failures_ledger_ordered", P([{"type": "video", "index": 1, "name": "V1", "enabled": None, "locked": None, "items": []}]) | {"observation_failures": [{"track_address": "video:1", "observation_ordinal": 4, "method": "GetItemListInTrack", "reason": "b"}, {"track_address": "video:1", "observation_ordinal": 2, "method": "GetItemListInTrack", "reason": "a"}]}, PD, L.normalize_snapshot_payload, "ledger sorted by (track_address, ordinal, reason)")
vec("nullable_fields_explicit_null", {"media_id": None, "source_sha256": None, "source_locator": None}, note="nullable fields are emitted as null, never omitted")
dump("fixtures/canonicalization/vectors.json", {"schema": "vidtoolz.resolveCanonicalizationVectors.v1.3", "spec": "CANONICALIZATION.md v1.3", "digest_rule": "sha256(utf8(domain) + 0x0A + canonical_bytes)", "registered_domains": sorted(L.HASH_DOMAINS), "reference_implementation": "tools/authority_lib.py", "vectors": vectors})
F64_BAD = [("f64_trailing_newline", "3ff0000000000000\n"), ("f64_leading_space", " 3ff0000000000000"), ("f64_trailing_space", "3ff0000000000000 "), ("f64_trailing_tab", "3ff0000000000000\t"), ("f64_leading_tab", "\t3ff0000000000000"), ("f64_crlf", "3ff0000000000000\r\n"), ("f64_uppercase", "3FF0000000000000"), ("f64_mixed_case", "3fF0000000000000"), ("f64_short", "3ff"), ("f64_fifteen", "3ff000000000000"), ("f64_long", "3ff00000000000000"), ("f64_not_hex", "NOT_HEX_NOT_HEX_"), ("f64_prefix_0x", "0x3ff000000000000"), ("f64_unicode_digit", "3ff000000000000١"), ("f64_empty", ""), ("f64_nonstring", 12345)]
cases = [{"name": n, "kind": "canon", "input": {"$f64": v}, "expect": "$f64"} for n, v in F64_BAD]
cases += [{"name": "f64_nan", "kind": "canon", "input": {"$f64": "7ff8000000000000"}, "expect": "NaN"}, {"name": "f64_nan_payload", "kind": "canon", "input": {"$f64": "fff8000000000001"}, "expect": "NaN"}, {"name": "f64_infinity", "kind": "canon", "input": {"$f64": "7ff0000000000000"}, "expect": "NaN"}, {"name": "f64_negative_infinity", "kind": "canon", "input": {"$f64": "fff0000000000000"}, "expect": "NaN"}, {"name": "f64_negative_zero", "kind": "canon", "input": {"$f64": "8000000000000000"}, "expect": "negative zero"}]
cases += [{"name": "rational_unreduced", "kind": "canon", "input": {"$rational": "2/4"}, "expect": "reduced"}, {"name": "rational_zero_denominator", "kind": "canon", "input": {"$rational": "1/0"}, "expect": "$rational"}, {"name": "rational_negative", "kind": "canon", "input": {"$rational": "-1/2"}, "expect": "$rational"}, {"name": "rational_trailing_newline", "kind": "canon", "input": {"$rational": "30/1\n"}, "expect": "$rational"}, {"name": "rational_leading_space", "kind": "canon", "input": {"$rational": " 30/1"}, "expect": "$rational"}, {"name": "rational_leading_zero", "kind": "canon", "input": {"$rational": "030/1"}, "expect": "$rational"}]
cases += [{"name": "bare_float", "kind": "canon", "input": {"x": 1.5}, "expect": "bare float"}, {"name": "marker_exact_duplicate", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", ""), mk("timeline", 5, 1, "", "m", "Blue", "")], "expect": "MARKER_COLLISION"}, {"name": "marker_same_object_frame_different_note", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", "a"), mk("timeline", 5, 1, "", "m", "Blue", "b")], "expect": "MARKER_COLLISION"}, {"name": "string_track_index", "kind": "tracks", "input": [{"type": "video", "index": "2"}], "expect": "integer"}, {"name": "duplicate_track_address", "kind": "tracks", "input": [{"type": "video", "index": 1}, {"type": "video", "index": 1}], "expect": "duplicate"}, {"name": "unregistered_domain", "kind": "domain", "input": {}, "domain": "vidtoolz.unregistered", "expect": "unregistered"}, {"name": "items_missing_ordinal", "kind": "items", "input": [{"start": 1, "end": 2, "provenance": {"kind": "TITLE"}}], "expect": "observation_ordinal"}, {"name": "items_duplicate_ordinal", "kind": "items", "input": [dict(item_partial(1, 5, "a")), dict(item_partial(1, 5, "b"))], "expect": "collision"}, {"name": "items_observed_end_null_in_sort", "kind": "items", "input": [dict(item_media("x", 0, 5, 9, None, None, "UNHASHED_UNOWNED", "m"), end=None)], "expect": "numeric"}]
dump("fixtures/canonicalization/rejections.json", {"schema": "vidtoolz.resolveCanonicalizationRejections.v1.3", "cases": cases})

# ============================================================ CAPABILITIES v1.3: probe_candidate flag; reviewed_refreeze_version on evidence records
caps = load("CAPABILITIES.json")
caps["schema"] = "vidtoolz.resolveCapabilityMatrix.v1.3"; caps["version"] = "1.3.0"
caps["qualification_note"] = "v1.3: zero QUALIFIED_READ rows (no evidence record exists on Resolve 21.1.0 build 14). Read rows are DOCUMENTED_NOT_QUALIFIED and probe_candidate:true, which permits them ONLY inside READ_PRIMITIVE_QUALIFICATION_PROBE (PROBE_ALLOWED != QUALIFIED_READ). A probe run yields CANDIDATE evidence records (reviewed_refreeze_version null); a row becomes QUALIFIED_READ only in a reviewed refreeze whose records carry reviewed_refreeze_version."
caps["evidence_record_fields"] = ["host", "resolve_version", "build", "run_ref", "method", "observed_result", "evidence_path", "evidence_sha256", "version_match", "reviewed_refreeze_version"]
caps["evidence_class_definitions"]["QUALIFIED_READ"] = "read-only method exercised on the contract Resolve version/build (21.1.0 b14) on the contract host, with a recorded run reference, observed result, evidence hash for that exact method AND a reviewed_refreeze_version (human-reviewed refreeze); callable by ordinary logical operations only when a matching CAPABILITY_EVIDENCE record is linked in the evidence set"
caps["probe_law"] = "probe_candidate:true marks a DOCUMENTED_NOT_QUALIFIED read row whose primitives READ_PRIMITIVE_QUALIFICATION_PROBE may call in an isolated read-only session to produce candidate evidence; it never makes the primitive callable elsewhere"
for r in caps["rows"]:
    if r["operation"].startswith("read:"):
        r["probe_candidate"] = True
    for x in r.get("evidence_records", []):
        x["reviewed_refreeze_version"] = None
dump("CAPABILITIES.json", caps)
cap_schema = load("schemas/resolveCapabilityMatrix.schema.json")
cap_schema["$id"] = "vidtoolz.resolveCapabilityMatrix.v1.3"; cap_schema["title"] = "Capability matrix v1.3"
cap_schema["properties"]["schema"] = {"const": "vidtoolz.resolveCapabilityMatrix.v1.3"}
cap_schema["properties"]["probe_law"] = {"type": "string"}
cap_schema["properties"]["rows"]["items"]["properties"]["probe_candidate"] = {"type": "boolean"}
er = cap_schema["properties"]["rows"]["items"]["properties"]["evidence_records"]["items"]
er["properties"]["reviewed_refreeze_version"] = {"type": ["string", "null"]}
er["required"] = sorted(set(er["required"]) | {"reviewed_refreeze_version"})
dump("schemas/resolveCapabilityMatrix.schema.json", cap_schema)
fixture("capabilities-frozen", "none", "resolveCapabilityMatrix", caps, check="semantic_capabilities")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; fixture("capabilities-qualified-read-without-exact-evidence", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="without exact")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; neg["rows"][0]["evidence_records"] = [{"host": HOST, "resolve_version": "21.1.0", "build": 14, "run_ref": "probe", "method": "GetVersionString", "observed_result": "x", "evidence_path": "/x", "evidence_sha256": "a" * 64, "version_match": True, "reviewed_refreeze_version": None}]; fixture("capabilities-qualified-read-unreviewed-candidate", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="without exact")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED"; fixture("capabilities-unknown-evidence-class", "schema", "resolveCapabilityMatrix", neg, expect_contains="enum")
neg = copy.deepcopy(caps); nt = next(r for r in neg["rows"] if r["evidence_class"] == "NOT_TESTED"); nt["probe_candidate"] = True; fixture("capabilities-probe-candidate-on-mutation-row", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="probe_candidate")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_records"][0]["version_match"] = True; fixture("capabilities-version-match-lie", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="version differs")
# hypothetical refrozen matrix (NOT AUTHORITY) used only to demonstrate the positive callable path in eligibility fixtures
caps_hyp = copy.deepcopy(caps); caps_hyp["qualification_note"] = "HYPOTHETICAL_NOT_AUTHORITY: illustrates a future reviewed refreeze; never load as CAPABILITIES.json"
for r in caps_hyp["rows"]:
    if r["operation"].startswith("read:"):
        r["evidence_class"] = "QUALIFIED_READ"; r.pop("probe_candidate", None)
        r["evidence_records"] = [{"host": HOST, "resolve_version": "21.1.0", "build": 14, "run_ref": "HYPOTHETICAL M0 probe run", "method": m, "observed_result": "hypothetical", "evidence_path": "/HYPOTHETICAL", "evidence_sha256": hashlib.sha256(m.encode()).hexdigest(), "version_match": True, "reviewed_refreeze_version": "1.4.0-HYPOTHETICAL"} for m in r["primitives"]]
dump("fixtures/eligibility/capabilities-hypothetical-refreeze.json", caps_hyp)

# ============================================================ READ PRIMITIVES v1.3: target_requirement per logical op; probe flags
rp = load("READ-PRIMITIVES.json")
rp["schema"] = "vidtoolz.resolveReadPrimitives.v1.3"; rp["version"] = "1.3.0"
rp["law"] = "a logical read operation expands to primitives and declares its target_requirement (SESSION | PROJECT | PROJECT_TIMELINE); a primitive whose evidence_class is not QUALIFIED_READ (with linked reviewed CAPABILITY_EVIDENCE) is never called silently: SNAPSHOT_CAPTURE marks the field UNAVAILABLE or downgrades coverage, REFUSE fallbacks block the operation; only READ_PRIMITIVE_QUALIFICATION_PROBE may call probe_allowed getters, explicitly, in an isolated read-only session, to produce CANDIDATE evidence records; nothing is promoted automatically"
TR = {"READ_PRIMITIVE_QUALIFICATION_PROBE": "SESSION", "CONNECT": "SESSION", "ENUMERATE_PROJECTS": "SESSION", "ENUMERATE_TIMELINES": "PROJECT", "SNAPSHOT_CAPTURE": "PROJECT_TIMELINE", "TIMEBASE_OBSERVE": "PROJECT_TIMELINE", "TRIPWIRE_READ": "PROJECT"}
for op, spec in rp["logical_operations"].items():
    spec["target_requirement"] = TR[op]
    for p in spec["primitives"]:
        p["probe_allowed"] = (op == "READ_PRIMITIVE_QUALIFICATION_PROBE")
probe = rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]
probe.update({"purpose_is_qualification": True, "read_only": True, "promotes_capability": False, "evidence_output": "CANDIDATE_EVIDENCE", "output": "CAPABILITY_EVIDENCE records with reviewed_refreeze_version null; a reviewed refreeze (v1.4) may turn rows QUALIFIED_READ", "contract": "M0-PROBE-CONTRACT.md", "why_allowed": "the getters are DOCUMENTED_NOT_QUALIFIED; calling them is the test, not a use of their result; results are recorded, never acted on"})
rp["logical_operations"]["CONNECT"]["note"] = "SESSION scope: proves host/library/session identity; requires qualified getters (REFUSE fallback) so it is not eligible before a reviewed refreeze; the probe establishes the same boundary in probe mode"
rp["logical_operations"]["ENUMERATE_PROJECTS"]["note"] = "SESSION scope: lists projects; establishes no project binding by itself"
rp["logical_operations"]["ENUMERATE_TIMELINES"]["note"] = "PROJECT scope: requires a PROJECT_BINDING_OBSERVATION for expected_project_name"
rp["logical_operations"]["SNAPSHOT_CAPTURE"]["note"] = "PROJECT_TIMELINE scope: requires PROJECT_BINDING_OBSERVATION + TIMELINE_BINDING_OBSERVATION for the expected names; never the current timeline by accident"
dump("READ-PRIMITIVES.json", rp)
rp_schema = S("vidtoolz.resolveReadPrimitives.v1.3", "Logical read operation -> primitive mapping (v1.3: target requirements, probe flags)", {"schema": {"const": "vidtoolz.resolveReadPrimitives.v1.3"}, "version": {"type": "string"}, "status": {"enum": ["FROZEN_NOW"]}, "law": {"type": "string"}, "logical_operations": {"type": "object", "additionalProperties": {"type": "object", "required": ["primitives", "target_requirement"], "properties": {"purpose": {"type": "string"}, "output": {"type": "string"}, "note": {"type": "string"}, "contract": {"type": "string"}, "why_allowed": {"type": "string"}, "target_requirement": {"enum": list(L.TARGET_REQUIREMENTS)}, "purpose_is_qualification": {"type": "boolean"}, "read_only": {"type": "boolean"}, "promotes_capability": {"const": False}, "evidence_output": {"const": "CANDIDATE_EVIDENCE"}, "primitives": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["method", "evidence_class", "evidence_ref", "milestones_available", "fallback_if_unqualified", "probe_allowed"], "properties": {"method": {"type": "string"}, "evidence_class": {"enum": EV}, "evidence_ref": {"type": "array", "items": {"type": "string"}}, "milestones_available": {"type": "array", "items": {"enum": ["M0", "M1", "M2", "M3"]}}, "fallback_if_unqualified": {"enum": ["MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE", "REFUSE", "PROBE_ONLY"]}, "probe_allowed": {"type": "boolean"}}}}}, "additionalProperties": False}}}, ["schema", "version", "status", "law", "logical_operations"])
dump("schemas/resolveReadPrimitives.schema.json", rp_schema)
fixture("read-primitives-frozen", "none", "resolveReadPrimitives", rp, check="semantic_read_primitives")
neg = copy.deepcopy(rp); neg["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"][0]["evidence_class"] = "QUALIFIED_READ"; fixture("read-primitives-class-mismatch-with-matrix", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="!= matrix")
neg = copy.deepcopy(rp); neg["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"][0]["probe_allowed"] = True; fixture("read-primitives-probe-allowed-outside-probe", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="only inside")
neg = copy.deepcopy(rp); neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["promotes_capability"] = True; fixture("read-primitives-probe-promotes", "schema", "resolveReadPrimitives", neg, expect_contains="False")
neg = copy.deepcopy(rp); del neg["logical_operations"]["CONNECT"]["target_requirement"]; fixture("read-primitives-missing-target-requirement", "schema", "resolveReadPrimitives", neg, expect_contains="target_requirement")
neg = copy.deepcopy(rp); neg["logical_operations"]["CONNECT"]["target_requirement"] = "CURRENT_PROJECT"; fixture("read-primitives-invented-target-requirement", "schema", "resolveReadPrimitives", neg, expect_contains="enum")

# ============================================================ PERMISSIONS v1.3: target_requirement per entry; TARGET_REQUIREMENT_SATISFIED + PROBE_ALLOWED_PRIMITIVES
perms = load("PERMISSIONS.json")
perms["schema"] = "vidtoolz.resolvePermissions.v1.3"; perms["version"] = "1.3.0"
perms["law"] = "PERMISSION DECLARATION (allowed:true) != AUTHORIZATION ELIGIBILITY. Eligibility is evaluated deterministically by authority_lib.evaluate_eligibility(perms, request, read_primitives, capabilities, target_contract, evidence_set); attachment state, primitive qualification and every prerequisite are DERIVED from the frozen authorities plus content-addressed evidence records; the request carries only milestone, operation, scope, expected project/timeline names and sha256 references; unknown or unlinked input fails closed"
perms["prerequisite_codes"] = sorted(L.PREREQ_CODES)
perms["target_requirements"] = list(L.TARGET_REQUIREMENTS)
ENTRY_TR = {**TR, "SetCurrentTimeline": "PROJECT_TIMELINE", "BUILD_MUTATION_PLAN_DRY_RUN": "PROJECT_TIMELINE", "CreateProject": "SESSION", "LoadProject_adapterPrefixed": "PROJECT", "CreateEmptyTimeline": "PROJECT", "SaveProject": "PROJECT", "SAVE_PROJECT": "PROJECT", "ImportMedia": "PROJECT", "IMPORT_MEDIA": "PROJECT"}
for e in perms["entries"]:
    e["target_requirement"] = ENTRY_TR.get(e["operation"], "PROJECT_TIMELINE")
    pre = list(e["prerequisites"])
    if e["operation"] == "READ_PRIMITIVE_QUALIFICATION_PROBE":
        pre.append("PROBE_ALLOWED_PRIMITIVES")
    pre.append("TARGET_REQUIREMENT_SATISFIED")
    e["prerequisites"] = pre
dump("PERMISSIONS.json", perms)
perm_schema = load("schemas/resolvePermissions.schema.json")
perm_schema["$id"] = "vidtoolz.resolvePermissions.v1.3"; perm_schema["properties"]["schema"] = {"const": "vidtoolz.resolvePermissions.v1.3"}
perm_schema["properties"]["prerequisite_codes"] = {"type": "array", "items": {"enum": sorted(L.PREREQ_CODES)}}
perm_schema["properties"]["target_requirements"] = {"const": list(L.TARGET_REQUIREMENTS)}
ei = perm_schema["properties"]["entries"]["items"]
ei["properties"]["prerequisites"] = {"type": "array", "minItems": 1, "items": {"enum": sorted(L.PREREQ_CODES)}, "contains": {"const": "TARGET_REQUIREMENT_SATISFIED"}}
ei["properties"]["target_requirement"] = {"enum": list(L.TARGET_REQUIREMENTS)}
ei["required"] = sorted(set(ei["required"]) | {"target_requirement"})
ei["allOf"] = [{"if": {"properties": {"mutation_allowed": {"const": True}}}, "then": {"properties": {"milestone": {"const": "M3"}, "prerequisites": {"allOf": [{"contains": {"const": "MIKKO_M3_AUTHORIZATION"}}, {"contains": {"const": "TARGET_STATE_SCRATCH_WRITE_READY"}}]}}}}]
perm_schema["required"] = sorted(set(perm_schema["required"]) | {"target_requirements"})
perm_schema["$comment"] = "shared_library_allowed is const false. mutation_allowed true forces milestone M3 and the two mandatory codes by schema. Every entry declares a target_requirement and lists TARGET_REQUIREMENT_SATISFIED (the evaluator enforces binding even if omitted)."
dump("schemas/resolvePermissions.schema.json", perm_schema)
fixture("permissions-frozen", "none", "resolvePermissions", perms)
neg = copy.deepcopy(perms); neg["default"] = "ALLOW"; fixture("permissions-default-allow", "schema", "resolvePermissions", neg, expect_contains="DENY")
neg = copy.deepcopy(perms); neg["entries"][0]["shared_library_allowed"] = True; fixture("permissions-shared-library-grant", "schema", "resolvePermissions", neg, expect_contains="False")
neg = copy.deepcopy(perms); neg["entries"][0]["prerequisites"] = ["TRUST_ME", "TARGET_REQUIREMENT_SATISFIED"]; fixture("permissions-unknown-prerequisite-code", "schema", "resolvePermissions", neg, expect_contains="enum")
neg = copy.deepcopy(perms); neg["entries"][0]["mutation_allowed"] = True; fixture("permissions-m0-mutation", "schema", "resolvePermissions", neg, expect_contains="M3")
neg = copy.deepcopy(perms); del neg["entries"][0]["target_requirement"]; fixture("permissions-missing-target-requirement", "schema", "resolvePermissions", neg, expect_contains="target_requirement")
neg = copy.deepcopy(perms); neg["entries"][1]["prerequisites"] = [c for c in neg["entries"][1]["prerequisites"] if c != "TARGET_REQUIREMENT_SATISFIED"]; fixture("permissions-entry-without-target-requirement-code", "schema", "resolvePermissions", neg, expect_contains="contains")
neg = copy.deepcopy(perms); neg["entries"][1]["target_requirement"] = "PROJECT"; fixture("permissions-target-requirement-disagrees-with-read-primitives", "semantic", "resolvePermissions", neg, check="semantic_read_primitives_with_perms", expect_contains="differs")

# ============================================================ ELIGIBILITY cases (evidence-derived)
def REQ(m, op, project=None, timeline=None, refs=None, **kw):
    r = {"schema": "vidtoolz.resolveEligibilityRequest.v1.3", "milestone": m, "operation": op, "scope": SCOPE, "refs": refs or {}}
    if project is not None:
        r["expected_project_name"] = project
    if timeline is not None:
        r["expected_timeline_name"] = timeline
    r.update(kw)
    return r


RID = lambda r: r["record_id"]  # noqa: E731
M3_REFS = {"m0_exit": RID(r_m0), "m1_exit": RID(r_m1), "m2_exit": RID(r_m2), "authorization": RID(r_auth), "exclusive_session": RID(r_excl), "read_only_journal": RID(r_roj), "media_class": RID(r_media), "destination_timeline": RID(r_dest)}
elig = []


def case(name, request, evidence_set, expect, expect_failed_contains=None, capabilities="CAPABILITIES.json", schema_valid=True):
    elig.append({"name": name, "request": request, "evidence_set": evidence_set, "capabilities": capabilities, "expect_eligible": expect, "expect_failed_contains": expect_failed_contains, "request_schema_valid": schema_valid})


ROJ = {"read_only_journal": RID(r_roj)}
case("m0-probe-allow-attachment-ready", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "ready", True)
case("m0-probe-deny-unprovisioned", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "empty", False, "TARGET_STATE_ATTACHMENT_READY")
case("m0-probe-deny-provisioned-not-verified", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "provisioned-only", False, "TARGET_STATE_ATTACHMENT_READY")
case("m0-probe-deny-bad-provisioning-uuid", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "provisioned-bad-uuid", False, "TARGET_STATE_ATTACHMENT_READY")
case("m0-probe-deny-launch-recipe-wrong-binary", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "ready-wrong-binary-pin", False, "LAUNCH_RECIPE")
case("m0-probe-deny-self-verified-bundle", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "ready-self-verified-bundle", False, "BUNDLE_INDEPENDENTLY_VERIFIED")
case("m0-probe-deny-bundle-verified-for-other-version", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "ready-bundle-verified-for-v1.2-only", False, "BUNDLE_INDEPENDENTLY_VERIFIED")
case("m0-probe-deny-no-read-only-journal-ref", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE"), "ready", False, "READ_ONLY_JOURNAL_OPEN")
case("m0-probe-deny-declared-state-ignored", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ, attachment_state="ATTACHMENT_READY"), "empty", False, "TARGET_STATE_ATTACHMENT_READY", schema_valid=False)
case("m0-probe-deny-eka-observed", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "attached-eka-observed", False, "LIBRARY")
case("m0-probe-deny-tampered-record", REQ("M0", "READ_PRIMITIVE_QUALIFICATION_PROBE", refs=ROJ), "attached-tampered-record", False, "EVIDENCE_SET_INVALID")
case("m0-snapshot-allow-degraded-attached", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached", True)
case("m0-snapshot-deny-attachment-ready-only", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "ready", False, "TARGET_STATE_ATTACHED_READ_ONLY")
case("m0-snapshot-deny-no-timeline-binding", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, "VIDTOOLZ__other__r1", refs=ROJ), "attached", False, "TIMELINE_BINDING_OBSERVATION")
case("m0-snapshot-deny-no-expected-timeline", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, refs=ROJ), "attached", False, "expected_timeline_name")
case("m0-snapshot-deny-no-expected-project", REQ("M0", "SNAPSHOT_CAPTURE", None, TL, refs=ROJ), "attached", False, "expected_project_name")
case("m0-snapshot-deny-unbound-project-name", REQ("M0", "SNAPSHOT_CAPTURE", PFX + "GHOST", TL, refs=ROJ), "attached", False, "PROJECT_BINDING_OBSERVATION")
case("m0-snapshot-deny-human-project-without-operator-record", REQ("M0", "ENUMERATE_TIMELINES", "PYSTY UHD", refs=ROJ), "attached", False, "neither adapter-prefixed nor operator-provisioned")
case("m0-enumerate-timelines-allow-operator-provisioned-project", REQ("M0", "ENUMERATE_TIMELINES", "Mikko human scratch", refs=ROJ), "attached", True)
case("m0-enumerate-projects-allow-session-scope", REQ("M0", "ENUMERATE_PROJECTS", refs=ROJ), "attached", True)
case("m0-enumerate-timelines-deny-no-project", REQ("M0", "ENUMERATE_TIMELINES", refs=ROJ), "attached", False, "expected_project_name")
case("m0-snapshot-deny-eka-observed", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-eka-observed", False, "TARGET_STATE_ATTACHED_READ_ONLY")
case("m0-snapshot-deny-local-database-observed", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-local-database-observed", False, "TARGET_STATE_ATTACHED_READ_ONLY")
case("m0-snapshot-deny-version-mismatch", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-version-mismatch", False, "RESOLVE_VERSION_MATCHES")
case("m0-snapshot-deny-wrong-host-observation", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-wrong-host", False, "TARGET_STATE_ATTACHED_READ_ONLY")
case("m0-connect-deny-refuse-fallback-no-qualified-rows", REQ("M0", "CONNECT", refs=ROJ), "attached", False, "REFUSE")
case("m0-connect-deny-qualified-read-string-ignored", REQ("M0", "CONNECT", refs=ROJ, capability_state={"GetVersionString": "QUALIFIED_READ"}), "attached", False, "REFUSE", schema_valid=False)
case("m0-connect-deny-candidate-evidence-unreviewed", REQ("M0", "CONNECT", refs=ROJ), "attached-candidate-evidence-unreviewed", False, "REFUSE")
case("m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen", REQ("M0", "CONNECT", refs=ROJ), "attached-reviewed-evidence", False, "REFUSE")
case("m0-connect-allow-hypothetical-refrozen-matrix", REQ("M0", "CONNECT", refs=ROJ), "attached-reviewed-evidence", True, capabilities="fixtures/eligibility/capabilities-hypothetical-refreeze.json")
case("m0-connect-deny-hypothetical-matrix-unreviewed-evidence", REQ("M0", "CONNECT", refs=ROJ), "attached-candidate-evidence-unreviewed", False, "REFUSE", capabilities="fixtures/eligibility/capabilities-hypothetical-refreeze.json")
case("m0-connect-deny-hypothetical-matrix-wrong-build-evidence", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-wrong-build", False, "REFUSE", capabilities="fixtures/eligibility/capabilities-hypothetical-refreeze.json")
case("m0-connect-deny-hypothetical-matrix-no-linked-evidence", REQ("M0", "CONNECT", refs=ROJ), "attached", False, "REFUSE", capabilities="fixtures/eligibility/capabilities-hypothetical-refreeze.json")
case("m0-deny-write-op", REQ("M0", "APPEND", PROJ, TL, refs=ROJ), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
case("m0-deny-ref-empty-string", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": ""}), "attached", False, "not a sha256", schema_valid=False)
case("m0-deny-ref-false-string", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": "false"}), "attached", False, "not a sha256", schema_valid=False)
case("m0-deny-ref-uppercase-sha", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": RID(r_roj).upper()}), "attached", False, "not a sha256", schema_valid=False)
case("m0-deny-ref-unlinked-sha", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": "9" * 64}), "attached", False, "not in evidence set")
case("m0-deny-ref-wrong-record-type", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": RID(r_conn)}), "attached", False, "has type CONNECTION_OBSERVATION")
case("m2-set-current-timeline-deny-production-project-name", REQ("M2", "SetCurrentTimeline", "PYSTY UHD", "traileri", refs=dict(ROJ, m1_exit=RID(r_m1))), "write-ready-base", False, "PROJECT_ADAPTER_PREFIXED")
case("m2-set-current-timeline-allow", REQ("M2", "SetCurrentTimeline", PROJ, TL, refs=dict(ROJ, m1_exit=RID(r_m1))), "write-ready-base", True)
case("m2-deny-exit-ref-for-other-milestone", REQ("M2", "SetCurrentTimeline", PROJ, TL, refs=dict(ROJ, m1_exit=RID(r_m0))), "write-ready-base", False, "M1_EXIT_EVIDENCE")
case("m3-append-deny-without-authorization", REQ("M3", "APPEND", PROJ, TL, refs={k: v for k, v in M3_REFS.items() if k != "authorization"}, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-without-authorization", False, "MIKKO_M3_AUTHORIZATION")
case("m3-append-deny-authorization-for-old-authority", REQ("M3", "APPEND", PROJ, TL, refs=dict(M3_REFS, authorization=RID(r_auth_old)), transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-authorization-for-v1.2", False, "MIKKO_M3_AUTHORIZATION")
case("m3-append-deny-refreeze-unreviewed", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-refreeze-unreviewed", False, "TARGET_STATE_SCRATCH_WRITE_READY")
case("m3-append-deny-no-journal-guard-plan-records", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-base", False, "JOURNAL_PREPARED")
case("m3-append-deny-ids-unavailable", REQ("M3", "SAVE_PROJECT", PROJ, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64), "attached-no-ids", False, "OBSERVED project_unique_id")
case("m3-deny-shared-library-scope", dict(REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS), scope="NETWORK_LIBRARY_EKA"), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
case("m4-deny-unknown-milestone", REQ("M4", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached", False, "NOT_PERMITTED_BY_POLICY")
case("deny-unknown-operation", REQ("M3", "FrobnicateTimeline", PROJ, TL, refs=M3_REFS), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
dump("fixtures/eligibility/cases.json", {"schema": "vidtoolz.resolveEligibilityFixtures.v1.3", "law": "expect_eligible is computed by evaluate_eligibility over (PERMISSIONS, request, READ-PRIMITIVES, capabilities file, TARGET-CONTRACT, fixtures/evidence/<evidence_set>.json); requests with request_schema_valid=false must ALSO be rejected by schemas/resolveEligibilityRequest.schema.json", "cases": elig})

# ============================================================ MILESTONE MATRIX + M3 PROBES (P15: rename claim removed, option B)
matrix = load("MILESTONE-MATRIX.json")
matrix["schema"] = "vidtoolz.resolveMilestoneMatrix.v1.3"; matrix["version"] = "1.3.0"
matrix["invariants"].append("every entry declares a target_requirement (SESSION | PROJECT | PROJECT_TIMELINE); no operation binds to whatever project or timeline is current")
for m in perms["milestones"]:
    es_ = [e for e in perms["entries"] if e["milestone"] == m]
    matrix["milestones"][m] = {"read_operations": sorted(e["operation"] for e in es_ if not e["mutation_allowed"]), "mutation_operations": sorted(e["operation"] for e in es_ if e["mutation_allowed"]), "target_requirements": {e["operation"]: e["target_requirement"] for e in sorted(es_, key=lambda x: x["operation"])}, "denied_all_scopes": perms["denied_all_scopes"], "scopes": perms["scopes"]}
dump("MILESTONE-MATRIX.json", matrix)
probes = load("M3-PROBES.json")
probes["schema"] = "vidtoolz.resolveM3Probes.v1.3"
for p in probes["probes"]:
    if p["id"] == "P15":
        p["title"] = "identity stable across save/reopen"
        p["note"] = "v1.3: rename removed from the claim (option B); no rename operation exists in PERMISSIONS and none is needed for the qualification goal; the machine operation list is authoritative"
dump("M3-PROBES.json", probes)

# ============================================================ PROVISIONAL schemas: cross-artifact binding fields
TGT_S = {"type": "object", "additionalProperties": False, "required": ["library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "host_name", "library_name", "library_kind", "project_name", "timeline_name", "resolve_version"], "properties": {"library_instance_uuid": UUID, "project_unique_id": {"type": "string", "minLength": 1}, "timeline_unique_id": {"type": "string", "minLength": 1}, "target_epoch": {"type": "string", "minLength": 1}, "host_name": {"type": "string", "minLength": 1}, "library_name": {"type": "string", "minLength": 1}, "library_kind": {"enum": ["Disk"]}, "observed_database_name": {"type": ["string", "null"]}, "project_name": {"type": "string", "minLength": 1}, "timeline_name": {"type": "string", "minLength": 1}, "resolve_version": {"type": "string", "minLength": 1}}}
TARGET_REF_S = {"type": "object", "additionalProperties": False, "required": ["project_unique_id", "timeline_unique_id", "library_instance_uuid"], "properties": {"project_unique_id": {"type": "string", "minLength": 1}, "timeline_unique_id": {"type": "string", "minLength": 1}, "library_instance_uuid": UUID}}
AV = {"const": L.AUTHORITY_VERSION}
REFS_S = {"type": "object", "additionalProperties": False, "properties": {k: SHA for k in ("authorization", "journal_prepared", "read_only_journal", "guard", "plan_validation", "m0_exit", "m1_exit", "m2_exit", "exclusive_session", "media_class", "destination_timeline")}}
mp = load("schemas/provisional/resolveMutationPlan.schema.json")
for k in ("target_attachment_state", "evidence", "authorization_token", "journal_available", "capability_state"):
    mp["properties"].pop(k, None)
mp["properties"]["target"] = TGT_S
mp["properties"]["transaction_id"] = {"type": "string", "minLength": 1}
mp["properties"]["authority_version"] = AV
mp["properties"]["operation_set_digest"] = SHA
mp["properties"]["refs"] = REFS_S
mp["required"] = sorted((set(mp["required"]) - {"target_attachment_state", "evidence", "authorization_token", "journal_available"}) | {"transaction_id", "authority_version", "operation_set_digest", "refs"})
mp["$comment"] = "PROVISIONAL_UNTIL_M3. v1.3 binding: plan_digest = digest(plan without plan_digest/refs, domain vidtoolz.resolveMutationPlan.v1); transaction_id, target, h0_guard_digest, operation_set_digest (= digest of operations, domain vidtoolz.resolveOperationSet.v1) and authority_version are the binding tuple shared with journal, verification, conflict and commit. No attachment state, capability state, evidence blob or authorization token is carried: refs are sha256 references into the evidence set and are resolved by evaluate_eligibility."
dump("schemas/provisional/resolveMutationPlan.schema.json", mp)
jr = load("schemas/provisional/resolveTransactionJournal.schema.json")
jr["properties"]["target_ref"] = TARGET_REF_S
jr["properties"]["guard_digest"] = SHA
jr["properties"]["authority_version"] = AV
jr["properties"]["recovery_of_transaction_id"] = {"type": ["string", "null"]}
jr["required"] = sorted(set(jr["required"]) | {"target_ref", "guard_digest", "authority_version", "recovery_of_transaction_id"})
jr["$comment"] = "Append-only; contiguous sequence from 0; single transaction_id AND single plan_digest; constant target_ref; constant guard_digest except across a RECOVERY_RECONCILING record; hash chain over vidtoolz.resolveJournalRecord.v1; transitions per authority_lib.JOURNAL_TRANSITIONS; APPLIED requires a unique operation_id; RECOVERY_RECONCILING requires recovery_of_transaction_id == transaction_id; nothing after a terminal state."
dump("schemas/provisional/resolveTransactionJournal.schema.json", jr)
vs = load("schemas/provisional/resolveVerificationResult.schema.json")
vs["properties"].update({"transaction_id": {"type": "string", "minLength": 1}, "target": TGT_S, "h0_guard_digest": SHA, "s1_guard_digest": SHA, "expected_delta_digest": SHA, "authority_version": AV, "readback_snapshot_sha256": SHA})
vs["required"] = sorted(set(vs["required"]) | {"transaction_id", "target", "h0_guard_digest", "s1_guard_digest", "expected_delta_digest", "authority_version", "readback_snapshot_sha256"})
vs["$comment"] = "Binding: plan_digest, transaction_id, target, h0_guard_digest must equal the plan's; expected_delta_digest must equal plan.operation_set_digest (the delta authority); s1_guard_digest/readback_snapshot_sha256 identify the actual readback. VERIFIED forbids unrelated/missing_expected. Never human approval."
dump("schemas/provisional/resolveVerificationResult.schema.json", vs)
cs = load("schemas/provisional/resolveConflict.schema.json")
cs["properties"].update({"plan_digest": SHA_OR_NULL, "resolved": {"type": "boolean"}, "authority_version": AV})
cs["required"] = sorted(set(cs["required"]) | {"plan_digest", "resolved", "authority_version"})
cs["$comment"] = cs["$comment"] + " v1.3: bound to plan_digest (null only for pre-plan attach conflicts) and transaction_id; resolved is a human adjudication flag, never set by the adapter."
dump("schemas/provisional/resolveConflict.schema.json", cs)
cmm = load("schemas/provisional/resolveCommitManifest.schema.json")
cmm["properties"].update({"target": TGT_S, "authority_version": AV, "operation_set_digest": SHA})
cmm["required"] = sorted(set(cmm["required"]) | {"target", "authority_version", "operation_set_digest"})
cmm["$comment"] = "Commit eligibility is composed validation (semantic_commit_manifest / validate_transaction_set): the plan, the full journal and the verification object are re-validated; a hash alone is never trusted. Same plan_digest, transaction_id, target, guard across all artifacts; VERIFIED verdict; allowed terminal state; no unresolved conflicts; evidence digests present."
dump("schemas/provisional/resolveCommitManifest.schema.json", cmm)

# ============================================================ PLAN / JOURNAL / VERIFICATION / CONFLICT / COMMIT fixtures + evidence
TGT = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "host_name": HOST, "library_name": LIB, "library_kind": "Disk", "observed_database_name": LIB, "project_name": PROJ, "timeline_name": TL, "resolve_version": VER}
sel_append = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "track_type": "video", "track_index": 1}
ops = [{"operation_id": "op-1", "op": "APPEND", "selector": sel_append, "expected_old": None, "expected_new": {"start": 110194, "end": 110541}, "allowed_created": ["one item"], "allowed_deleted": [], "declared_side_effects": []}]
plan_body = {"schema": "vidtoolz.resolveMutationPlan.v1", "transaction_id": "tx-fixture", "authority_version": L.AUTHORITY_VERSION, "milestone": "M3", "dry_run": False, "target": TGT, "target_epoch": "epoch-fixture-1", "target_contract_digest": sha_of("TARGET-CONTRACT.json"), "binding_set_digest": "2" * 64, "handoff_digest_sha256": "3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69", "h0_payload_sha256": snap_pos["payload_sha256"], "h0_guard_digest": snap_pos["guard_digest"], "capability_matrix_version": "1.3.0", "collector_version": "0.0.0-fixture", "timebase_digest": sha_of("TIMEBASE.json"), "permission_class": "RESOLVE_ASSEMBLE", "scope": SCOPE, "lease": {}, "operations": ops, "operation_set_digest": L.operation_set_digest(ops)}
PDG = L.plan_digest_of(plan_body)
r_jp = R("JOURNAL_PREPARED", transaction_id="tx-fixture", plan_digest=PDG, journal_path_sha256="d" * 64)
r_guard = R("GUARD_SNAPSHOT", guard_digest=snap_pos["guard_digest"], project_name=PROJ, timeline_name=TL, payload_sha256=snap_pos["payload_sha256"])
r_guard_stale = R("GUARD_SNAPSHOT", guard_digest=snap_b["guard_digest"], project_name=PROJ, timeline_name=TL, payload_sha256=snap_b["payload_sha256"])
r_pv = R("PLAN_VALIDATION", library=None, plan_digest=PDG, result="PASS", authority_version=L.AUTHORITY_VERSION, validator="tools/authority_lib.py#semantic_mutation_plan")
r_pv_fail = R("PLAN_VALIDATION", library=None, plan_digest=PDG, result="FAIL", authority_version=L.AUTHORITY_VERSION, validator="tools/authority_lib.py#semantic_mutation_plan")
base_recs = list(EVSETS["write-ready-base"]["records"].values())
EVSETS["write-ready-full"] = ES(*base_recs, r_jp, r_guard, r_pv)
EVSETS["write-ready-stale-guard"] = ES(*base_recs, r_jp, r_guard_stale, r_pv)
EVSETS["write-ready-plan-validation-fail"] = ES(*base_recs, r_jp, r_guard, r_pv_fail)
for name in ("write-ready-full", "write-ready-stale-guard", "write-ready-plan-validation-fail"):
    dump(f"fixtures/evidence/{name}.json", EVSETS[name])
PLAN_REFS = dict(M3_REFS, journal_prepared=RID(r_jp), guard=RID(r_guard), plan_validation=RID(r_pv))
plan_m3 = dict(plan_body, plan_digest=PDG, refs=PLAN_REFS)
assert L.plan_digest_of(plan_m3) == PDG
dump("fixtures/plan/m3-append-plan.json", plan_m3)
G = snap_pos["guard_digest"]
PX = {"evidence_set": "write-ready-full", "guard_digest": G}
fixture("plan-m3-append-eligible", "none", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", extra=PX)
p = copy.deepcopy(plan_m3); p["permission_class"] = "RESOLVE_READ"; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-read-class-with-append", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="RESOLVE_READ", extra=PX)
p = copy.deepcopy(plan_m3); p["operations"][0]["selector"]["project_unique_id"] = "proj-OTHER"; p["operation_set_digest"] = L.operation_set_digest(p["operations"]); p["plan_digest"] = L.plan_digest_of(p); fixture("plan-selector-target-mismatch", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="does not match plan target", extra=PX)
p = copy.deepcopy(plan_m3); p["h0_guard_digest"] = snap_b["guard_digest"]; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-stale-guard", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="STALE_SNAPSHOT", extra=PX)
p = copy.deepcopy(plan_m3); p["refs"].pop("authorization"); fixture("plan-missing-m3-authorization", "eligibility", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="MIKKO_M3_AUTHORIZATION", extra=PX)
p = copy.deepcopy(plan_m3); p["refs"]["authorization"] = RID(r_roj); fixture("plan-authorization-ref-wrong-type", "eligibility", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="MIKKO_M3_AUTHORIZATION", extra=PX)
p = copy.deepcopy(plan_m3); p["refs"]["authorization"] = ""; fixture("plan-authorization-ref-empty", "schema", "provisional/resolveMutationPlan", p, expect_contains="pattern")
p = copy.deepcopy(plan_m3); p["authorization_token"] = "3" * 64; fixture("plan-legacy-authorization-token-field", "schema", "provisional/resolveMutationPlan", p, expect_contains="authorization_token")
p = copy.deepcopy(plan_m3); p["target_attachment_state"] = "SCRATCH_WRITE_READY"; fixture("plan-declared-attachment-state", "schema", "provisional/resolveMutationPlan", p, expect_contains="target_attachment_state")
p = copy.deepcopy(plan_m3); p["milestone"] = "M2"; p["dry_run"] = True; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-m2-append-not-permitted", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="not permitted", extra=PX)
p = copy.deepcopy(plan_m3); p["operations"][0]["op"] = "DELETE"; p["operations"][0]["expected_old"] = {"unique_id": "it-1"}; p["operation_set_digest"] = L.operation_set_digest(p["operations"]); p["plan_digest"] = L.plan_digest_of(p); fixture("plan-delete-selector-incomplete", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="selector incomplete", extra=PX)
p = copy.deepcopy(plan_m3); p["dry_run"] = False; p["milestone"] = "M2"; p["operations"] = []; fixture("plan-m2-non-dry-run", "schema", "provisional/resolveMutationPlan", p, expect_contains="minItems")
p = copy.deepcopy(plan_m3); p["plan_digest"] = "0" * 64; fixture("plan-digest-not-of-body", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="plan_digest does not match", extra=PX)
p = copy.deepcopy(plan_m3); p["operation_set_digest"] = "0" * 64; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-operation-set-digest-mismatch", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="operation_set_digest", extra=PX)
p = copy.deepcopy(plan_m3); p["authority_version"] = "1.2.0"; fixture("plan-authority-version-old", "schema", "provisional/resolveMutationPlan", p, expect_contains="1.3.0")
p = copy.deepcopy(plan_m3); p["h0_payload_sha256"] = p["h0_guard_digest"]; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-payload-as-guard", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="payload digest used as guard", extra=PX)
fixture("plan-eligible-but-guard-record-stale", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="GUARD_CURRENT", extra={"evidence_set": "write-ready-stale-guard", "guard_digest": G})
fixture("plan-plan-validation-record-fail", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="PLAN_VALIDATED", extra={"evidence_set": "write-ready-plan-validation-fail", "guard_digest": G})
fixture("plan-eligible-without-prepared-journal", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="JOURNAL_PREPARED", extra={"evidence_set": "write-ready-base", "guard_digest": G})
TREF = {"project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "library_instance_uuid": UU}


def jrec(seq, state, prev, tx="tx-fixture", opid=None, pd=PDG, guard=G, tref=TREF):
    return {"schema": "vidtoolz.resolveTransactionJournal.v1", "transaction_id": tx, "sequence": seq, "previous_record_sha256": prev, "state": state, "plan_digest": pd, "operation_id": opid, "intent": {"phase": state}, "result": None, "readback_payload_sha256": None, "checkpoint": None, "recorded_at": "2026-09-08T00:00:00Z", "target_ref": tref, "guard_digest": guard, "authority_version": L.AUTHORITY_VERSION, "recovery_of_transaction_id": (tx if state == "RECOVERY_RECONCILING" else None)}


def chain(states, tx="tx-fixture", **kw):
    out, prev = [], None
    for i, st in enumerate(states):
        r = jrec(i, st, prev, tx, opid=("op-1" if st == "APPLIED" else None), **kw)
        out.append(r); prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
    return out


def rechain(records):
    prev = None
    for r in records:
        r["previous_record_sha256"] = prev; prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
    return records


legal = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"])
JX = {"plan": plan_m3}
fixture("journal-legal-chain", "none", "provisional/resolveTransactionJournal", legal, check="semantic_journal", extra=JX)
fixture("journal-recovery-committed-recovered", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "RECOVERY_RECONCILING", "COMMITTED_RECOVERED"]), check="semantic_journal", extra=JX)
fixture("journal-recovery-not-applied", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "RECOVERY_RECONCILING", "NOT_APPLIED"]), check="semantic_journal", extra=JX)
fixture("journal-aborted", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "LEASED", "ABORTED"]), check="semantic_journal", extra=JX)
b = copy.deepcopy(legal); b[4]["state"] = "COMMITTED"; rechain(b); fixture("journal-skip-to-committed", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="illegal transition", extra=JX)
b = copy.deepcopy(legal); b[3]["previous_record_sha256"] = "f" * 64; fixture("journal-broken-hash-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="hash chain", extra=JX)
b = copy.deepcopy(legal); b[2]["sequence"] = 1; rechain(b); fixture("journal-repeated-sequence", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not contiguous", extra=JX)
b = copy.deepcopy(legal); b[2]["sequence"] = 5; rechain(b); fixture("journal-sequence-gap", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not contiguous", extra=JX)
b = copy.deepcopy(legal); b[3]["transaction_id"] = "tx-other"; rechain(b); fixture("journal-transaction-id-change", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="transaction_id changed", extra=JX)
b = copy.deepcopy(legal); b[5]["plan_digest"] = "9" * 64; rechain(b); fixture("journal-plan-digest-change-mid-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="plan_digest changed", extra=JX)
b = copy.deepcopy(legal); b[5]["target_ref"] = dict(TREF, timeline_unique_id="tl-OTHER"); rechain(b); fixture("journal-target-change-mid-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="target_ref changed", extra=JX)
b = copy.deepcopy(legal); b[5]["guard_digest"] = snap_b["guard_digest"]; rechain(b); fixture("journal-guard-change-without-recovery", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="guard_digest changed", extra=JX)
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "APPLIED"]); fixture("journal-operation-id-reused", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="applied twice", extra=JX)
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED"]); b[3]["operation_id"] = None; rechain(b); fixture("journal-applied-without-operation-id", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="APPLIED without operation_id", extra=JX)
b = copy.deepcopy(legal) + [jrec(10, "APPLIED", L.journal_head(legal), opid="op-9")]; fixture("journal-record-after-terminal", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="after terminal", extra=JX)
b = chain(["PREPARED", "RECOVERY_RECONCILING", "NOT_APPLIED"]); b[1]["recovery_of_transaction_id"] = "tx-other"; rechain(b); fixture("journal-recovery-unlinked", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not linked", extra=JX)
b = chain(["PREPARED", "LEASED"], pd="8" * 64); fixture("journal-bound-to-other-plan", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="journal plan_digest != plan", extra=JX)
b = chain(["PREPARED", "LEASED"], tx="tx-other"); fixture("journal-bound-to-other-transaction", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="transaction_id != plan", extra=JX)
b = copy.deepcopy(legal); del b[0]["target_ref"]; fixture("journal-missing-target-ref", "schema", "provisional/resolveTransactionJournal", b, expect_contains="target_ref")
fixture("journal-empty", "semantic", "provisional/resolveTransactionJournal", [], check="semantic_journal", expect_contains="empty", extra=JX)
vr_ok = {"schema": "vidtoolz.resolveVerificationResult.v1", "plan_digest": PDG, "transaction_id": "tx-fixture", "target": TGT, "h0_guard_digest": G, "s1_guard_digest": snap_b["guard_digest"], "h0_payload_sha256": snap_pos["payload_sha256"], "s1_payload_sha256": snap_b["payload_sha256"], "readback_snapshot_sha256": "5" * 64, "expected_delta_digest": plan_m3["operation_set_digest"], "authority_version": L.AUTHORITY_VERSION, "added": ["it-new"], "removed": [], "changed": [], "creation_identity_map": {"op-1": "it-new"}, "missing_expected": [], "unrelated": [], "coverage": {}, "verdict": "VERIFIED", "is_human_approval": False}
dump("fixtures/plan/m3-append-verification.json", vr_ok)
fixture("verification-verified-clean", "none", "provisional/resolveVerificationResult", vr_ok, check="semantic_verification_result", extra=JX)
v = copy.deepcopy(vr_ok); v["unrelated"] = ["it-3 moved"]; fixture("verification-verified-with-unrelated", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="unrelated", extra=JX)
v = copy.deepcopy(vr_ok); v["missing_expected"] = ["op-1"]; fixture("verification-verified-with-missing-expected", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="missing_expected", extra=JX)
v = copy.deepcopy(vr_ok); v["plan_digest"] = "9" * 64; fixture("verification-other-plan", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="another plan", extra=JX)
v = copy.deepcopy(vr_ok); v["transaction_id"] = "tx-other"; fixture("verification-other-transaction", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="another transaction", extra=JX)
v = copy.deepcopy(vr_ok); v["target"] = dict(TGT, timeline_unique_id="tl-OTHER"); fixture("verification-other-target", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="another target", extra=JX)
v = copy.deepcopy(vr_ok); v["h0_guard_digest"] = snap_b["guard_digest"]; fixture("verification-guard-mismatch", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="guard mismatch", extra=JX)
v = copy.deepcopy(vr_ok); v["expected_delta_digest"] = "9" * 64; fixture("verification-delta-authority-mismatch", "semantic", "provisional/resolveVerificationResult", v, check="semantic_verification_result", expect_contains="expected-delta", extra=JX)
v = copy.deepcopy(vr_ok); v["is_human_approval"] = True; fixture("verification-claims-human-approval", "schema", "provisional/resolveVerificationResult", v, expect_contains="False")
v = copy.deepcopy(vr_ok); del v["transaction_id"]; fixture("verification-missing-transaction", "schema", "provisional/resolveVerificationResult", v, expect_contains="transaction_id")
conflict_ok = {"schema": "vidtoolz.resolveConflict.v1", "transaction_id": "tx-fixture", "plan_digest": PDG, "code": "UNEXPECTED_DELTA", "drift_class": "POSITION_DRIFT", "object": {"item": "it-3"}, "expected": {"start": 108694}, "observed": {"start": 108700}, "policy": "REQUEST_RECONCILIATION", "next_action_non_mutating": "present to Mikko", "authority_effect": "NONE_UNTIL_HUMAN_ADJUDICATION", "resolved": True, "authority_version": L.AUTHORITY_VERSION}
fixture("conflict-bound-resolved", "none", "provisional/resolveConflict", conflict_ok, check="semantic_conflict", extra=JX)
c = copy.deepcopy(conflict_ok); c["plan_digest"] = "9" * 64; fixture("conflict-other-plan", "semantic", "provisional/resolveConflict", c, check="semantic_conflict", expect_contains="not bound", extra=JX)
c = copy.deepcopy(conflict_ok); c["authority_effect"] = "APPLIED"; fixture("conflict-with-authority-effect", "schema", "provisional/resolveConflict", c, expect_contains="NONE_UNTIL_HUMAN_ADJUDICATION")
commit_ok = {"schema": "vidtoolz.resolveCommitManifest.v1", "transaction_id": "tx-fixture", "plan_digest": PDG, "target": TGT, "authority_version": L.AUTHORITY_VERSION, "operation_set_digest": plan_m3["operation_set_digest"], "terminal_state": "COMMITTED", "binding_observation_sha256": "5" * 64, "binding_set_digest": "2" * 64, "receipt_sha256": "6" * 64, "journal_head_sha256": L.journal_head(legal), "verification_result_sha256": L.digest(vr_ok, "vidtoolz.resolveVerificationResult.v1"), "guard_digest": G, "unresolved_conflicts": [], "ef_source_pins": {}, "published_at": "2026-09-08T00:00:00Z"}
CX = {"plan": plan_m3, "journal": legal, "verification_result": vr_ok, "conflicts": [], "guard_digest": G}
fixture("commit-linked-eligible", "none", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", extra=CX)
fixture("commit-journal-not-published", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="last state", extra=dict(CX, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED", "READBACK_S1", "VERIFIED"])))
fixture("commit-verification-not-verified", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="VERIFIED", extra=dict(CX, verification_result=dict(vr_ok, verdict="UNEXPECTED_DELTA", unrelated=["x"])))
fixture("commit-verification-from-other-plan-with-matching-hash", "semantic", "provisional/resolveCommitManifest", dict(commit_ok, verification_result_sha256=L.digest(dict(vr_ok, plan_digest="9" * 64), "vidtoolz.resolveVerificationResult.v1")), check="semantic_commit_manifest", expect_contains="another plan", extra=dict(CX, verification_result=dict(vr_ok, plan_digest="9" * 64)))
fixture("commit-verification-hash-only-object-missing", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="not only their hashes", extra=dict(CX, verification_result=None))
fixture("commit-journal-from-other-transaction", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="transaction", extra=dict(CX, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"], tx="tx-other")))
c = copy.deepcopy(commit_ok); c["journal_head_sha256"] = "7" * 64; fixture("commit-journal-head-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="journal_head", extra=CX)
c = copy.deepcopy(commit_ok); c["guard_digest"] = snap_b["guard_digest"]; fixture("commit-guard-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="guard", extra=CX)
c = copy.deepcopy(commit_ok); c["target"] = dict(TGT, project_unique_id="proj-OTHER"); fixture("commit-target-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="target", extra=CX)
c = copy.deepcopy(commit_ok); c["unresolved_conflicts"] = ["HUMAN_CONFLICT it-3"]; fixture("commit-unresolved-conflict-listed", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="unresolved", extra=CX)
fixture("commit-with-unresolved-conflict-record", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="unresolved conflict", extra=dict(CX, conflicts=[dict(conflict_ok, resolved=False)]))
c = copy.deepcopy(commit_ok); del c["verification_result_sha256"]; fixture("commit-naked-terminal-state", "schema", "provisional/resolveCommitManifest", c, expect_contains="verification_result_sha256")
c = copy.deepcopy(commit_ok); del c["target"]; fixture("commit-missing-target", "schema", "provisional/resolveCommitManifest", c, expect_contains="target")

# ============================================================ LINKED-SET fixtures (validate_transaction_set)
def linked(name, layer, ts, expect=None, evidence_set="write-ready-full"):
    dump(f"fixtures/linked-set/{name}.json", {"fixture": name, "layer_expected_failure": layer, "evidence_set": evidence_set, "expect_error_contains": expect, "set": ts})


TS_OK = {"plan": plan_m3, "journal": legal, "verification": vr_ok, "commit": commit_ok, "conflicts": [conflict_ok], "guard_snapshot_digest": G}
linked("linked-set-committed-consistent", "none", TS_OK)
linked("linked-set-in-flight-no-commit", "none", dict(TS_OK, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "APPLIED"]), verification=None, commit=None, conflicts=[]))
linked("linked-set-verification-other-plan", "linked-set", dict(TS_OK, verification=dict(vr_ok, plan_digest="9" * 64), commit=dict(commit_ok, verification_result_sha256=L.digest(dict(vr_ok, plan_digest="9" * 64), "vidtoolz.resolveVerificationResult.v1"))), "another plan")
linked("linked-set-journal-other-transaction", "linked-set", dict(TS_OK, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"], tx="tx-other")), "transaction_id")
linked("linked-set-commit-other-target", "linked-set", dict(TS_OK, commit=dict(commit_ok, target=dict(TGT, timeline_unique_id="tl-OTHER"))), "target")
linked("linked-set-guard-snapshot-stale", "linked-set", dict(TS_OK, guard_snapshot_digest=snap_b["guard_digest"]), "STALE_SNAPSHOT")
linked("linked-set-plan-not-eligible-no-authorization", "linked-set", TS_OK, "MIKKO_M3_AUTHORIZATION", evidence_set="write-ready-without-authorization")
linked("linked-set-committed-journal-without-commit", "linked-set", dict(TS_OK, commit=None), "without a commit manifest")
linked("linked-set-unresolved-conflict", "linked-set", dict(TS_OK, conflicts=[dict(conflict_ok, resolved=False)]), "unresolved conflict")
linked("linked-set-journal-plan-digest-drift", "linked-set", dict(TS_OK, journal=rechain([dict(r, plan_digest=("9" * 64 if r["sequence"] == 6 else r["plan_digest"])) for r in copy.deepcopy(legal)])), "plan_digest changed")
linked("linked-set-verification-delta-authority-mismatch", "linked-set", dict(TS_OK, verification=dict(vr_ok, expected_delta_digest="9" * 64), commit=dict(commit_ok, verification_result_sha256=L.digest(dict(vr_ok, expected_delta_digest="9" * 64), "vidtoolz.resolveVerificationResult.v1"))), "expected-delta")
linked("linked-set-schema-invalid-plan", "linked-set", dict(TS_OK, plan=dict(plan_m3, target_attachment_state="SCRATCH_WRITE_READY")), "schema/plan")
linked("linked-set-commit-authority-version-old", "linked-set", dict(TS_OK, commit=dict(commit_ok, authority_version="1.2.0")), "schema/commit")

# ============================================================ freeze manifest schema v1.3
man_schema = S("vidtoolz.resolveFreezeManifest.v1.3", "Freeze manifest v1.3", {"schema": {"const": "vidtoolz.resolveFreezeManifest.v1.3"}, "bundle": {"const": "docs/resolve-integration/v1.3"}, "version": {"const": "1.3.0"}, "frozen_at": {"type": "string"}, "prepared_by": {"type": "string"}, "approval_status": {"enum": ["CANDIDATE_FOR_INDEPENDENT_REVIEW", "APPROVED", "SUPERSEDED"]}, "approver": {"type": ["string", "null"]}, "parent": {"type": "object", "additionalProperties": False, "required": ["version", "branch", "head", "manifest_sha256", "immutable", "grandparent"], "properties": {"version": {"const": "1.2.0"}, "branch": {"const": "docs/resolve-authority-freeze-v1.2"}, "head": {"const": "c6d1284c6f395f5b21a6d14f8c2873bccfc065bb"}, "manifest_sha256": {"const": "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6"}, "immutable": {"const": True}, "grandparent": {"type": "object"}}}, "status_vocabulary": {"const": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"]}, "status_field_law": {"type": "string"}, "rules": {"type": "array"}, "files": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": False, "required": ["path", "sha256", "bytes", "status", "authority_class", "inherited_from_parent", "changed_from_parent", "new_in_this_version"], "properties": {"path": {"type": "string", "minLength": 1}, "sha256": SHA, "bytes": NONNEG, "status": {"enum": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"]}, "authority_class": {"enum": ["NORMATIVE", "SCHEMA", "FIXTURE", "TOOL", "HISTORICAL_INPUT", "REPORT"]}, "inherited_from_parent": {"type": "boolean"}, "changed_from_parent": {"type": "boolean"}, "new_in_this_version": {"type": "boolean"}, "qualification_note": {"type": "string"}, "blocked_until": {"type": "string"}}}}, "removed_from_this_version_present_in_parent": {"type": "array"}, "external_pins": {"type": "object"}, "counts": {"type": "object"}}, ["schema", "bundle", "version", "frozen_at", "approval_status", "approver", "parent", "status_vocabulary", "files", "external_pins", "counts"], comment="semantic_manifest additionally requires on-disk sha256 AND byte count equality for every listed file.")
dump("schemas/resolveFreezeManifest.schema.json", man_schema)
print("build_v1_3: OK; layered fixtures:", FIXTURE_COUNT[0])
