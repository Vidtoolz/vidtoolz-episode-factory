#!/usr/bin/env python3
"""Generate v1.7 machine artifacts as the narrowly scoped correction of v1.6 (Codex v1.6 BLOCKERS C16-B1 content-insensitive
authority caches, C16-B2 caller-supplied schema validators, C16-B3 unbound capture-shim trust, C16-B4 chain substitution; M0A
MAJORs C16-M1 duplicate receiver paths, C16-M2 absent strict byte ingestion, C16-M3 non-executable evidence store; plus the
operational closure of the Hermes M0A binding values). Deterministic; offline; no Resolve; fake receivers only.
Run from the bundle dir: python3 -B tools/build_v1_19.py
Inputs: the v1.6 instances/schemas seeded in this directory (byte-identical copies of the frozen v1.6 bundle)."""
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
import authority_slots as SLOTS  # noqa: E402
import fixture_evidence as F  # noqa: E402
import capture_shim_reference as SHIM  # noqa: E402

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
STR_OR_NULL = {"type": ["string", "null"]}
AV = {"const": L.AUTHORITY_VERSION}
UU, HOST, LIB, VER, PFX, PROJ, TL, SCOPE = F.UU, F.HOST, F.LIB, F.VER, F.PFX, F.PROJ, F.TL, "SCRATCH_QUALIFICATION_LIBRARY"
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


# ============================================================ TARGET CONTRACT v1.5: CONFLICT state, envelope binding law
tc = load("TARGET-CONTRACT.json")
tc["schema"] = "vidtoolz.resolveTargetContract.v1.10"; tc["version"] = "1.20.0"
# v1.20 (Phase 1 R19-F4): the qualification library observations are no longer future; they are bound from governed records
tc["library"].update({"provisioning_status": "PROVISIONED", "root_path": "/home/vidtoolz/outputs/resolve-qualification-library", "instance_uuid": "7bebd326-63b5-4359-8811-23626d862be6"})
tc["library"]["rule"] += " v1.20: root_path and instance_uuid are OBSERVED values bound from governed records (A2 PROVISIONING_RECORD e24f83c1 canonical instance 7bebd326-63b5-4359-8811-23626d862be6, provisioned 2026-09-10; A3 record commit 10e8e398; PHASE1-QUALIFICATION-RECORD.json), never fabricated; attachment state remains derived from evidence, never declared by this contract."
tc["session"]["network_port_1144"] = "protocol-closed"
tc["session"]["network_port_1144_semantics"] = "External Scripting = Local refuses remote scripting sessions at the protocol layer; the vendor scripting sockets (1144/49152/15000) may remain bound to non-loopback interfaces. Production control never uses native network scripting (CONTROL-PLANE.md section 1)."
# V115-B1 (group 1): the inherited note said "attachment state is derived by tools/authority_lib.py#derive_attachment_state",
# a current normative statement naming the diagnostic function as the deriver.
tc["qualification_note"] = ("library root_path/instance_uuid/launch recipe are required future observations, not "
                            "fabricated; the AUTHORIZING attachment state is derived by "
                            "tools/authority_lib.py#derive_attachment_state_authorizing (or "
                            "#derive_attachment_state_for_session) from a GovernedEvidenceSet minted by "
                            "#load_governed_evidence_set, never declared. The bare-evidence "
                            "#derive_attachment_state is DIAGNOSTIC / NON_AUTHORIZING.")
# V114-B3: v1.14 demoted the raw derivation in code but left this active binding naming it, so a consumer following
# the target contract selected the DIAGNOSTIC function and recreated raw evidence consumption. The active binding
# now names only the authorizing entry points; the diagnostic pair is named separately AS diagnostic.
tc["attachment_derivation"] = "tools/authority_lib.py#derive_attachment_state_authorizing(target_contract, GovernedEvidenceSet, active_authority) - or #derive_attachment_state_for_session(session_id, target_contract, active_authority), which loads through #load_governed_evidence_set itself. The GovernedEvidenceSet is minted ONLY by tools/authority_lib.py#load_governed_evidence_set and carries the validated bytes; the evidence consumed is re-derived from those bytes on every authorizing call."
tc["attachment_derivation_diagnostic_non_authorizing"] = "tools/authority_lib.py#derive_attachment_state(target_contract, evidence_set, active_authority) is DIAGNOSTIC / NON_AUTHORIZING (v1.14 V113-B1): semantic derivation only, no location authority, no receipt. It is for fixtures and diagnosis and must never be selected for an authority decision."
tc["attachment_states"]["CONFLICT"] = {"required_records": [], "meaning": "contradictory, ambiguous or fatal evidence: incoherent envelopes in the current session, multiple provisioning identities, two current observations with the same sequence, timestamp/sequence disorder, a FATAL_TARGET_FAILURE probe record, or an evidence set not bound to the active reviewed manifest; rank below UNPROVISIONED; nothing is eligible"}
tc["attachment_states"]["ATTACHMENT_READY"]["meaning"] = "current session (evidence_set.current_session_id) opened by a LAUNCH_RECIPE bound to the provisioning record (provisioning_id, uuid, root), pinned to contract version/binary/Local scripting; independent BUNDLE_VERIFICATION bound to the ACTIVE reviewed manifest + authority version on this host; all session records coherent"
tc["attachment_states"]["ATTACHED_READ_ONLY"]["meaning"] = "the CURRENT CONNECTION_OBSERVATION of the current session (highest envelope.sequence, not stale, not ambiguous) shows db_type Disk, db_name == contract library, product/version == contract, root and uuid == provisioning record; any mismatch stays ATTACHMENT_READY with OBSERVED_TARGET_MISMATCH"
tc["evidence_envelope_law"] = {"schema": "schemas/resolveEvidenceSet.schema.json", "levels": L.ENVELOPE_REQUIRED, "record_levels": L.ENVELOPE_LEVEL, "coherence_fields": list(L.COHERENCE_FIELDS), "currency": "CURRENT record of a type in the current session = highest envelope.sequence; equal highest sequences with distinct content = AMBIGUOUS (CONFLICT); captured_at older than MAX_OBSERVATION_AGE_S relative to evidence_set.evaluated_at = STALE; records of other sessions are never current; JSON/map/array order never matters", "max_observation_age_s": L.MAX_OBSERVATION_AGE_S, "binding": "every record binds envelope.manifest_sha256 and envelope.authority_version to the ACTIVE reviewed authority; a BUNDLE_VERIFICATION for another manifest is tolerated only with historical:true and never counts"}
# V115-B1 (Codex v1.15 BLOCKER, group 1): this field and qualification_note below were CURRENT normative contract
# statements naming the DIAGNOSTIC derivation as the computing authority, unmarked - contradicting
# attachment_derivation above and AUTHORITY_SURFACE in code. The corrected authorizing field and the diagnostic
# warning field did not erase them. Both now name the authorizing entry points.
tc["attachment_law"] = "schema validity != attachment eligibility; the AUTHORIZING state is a function of (TARGET-CONTRACT, GovernedEvidenceSet, active authority {authority_version, manifest_sha256, capability_matrix_sha256}) computed by tools/authority_lib.py#derive_attachment_state_authorizing - or #derive_attachment_state_for_session, which loads through #load_governed_evidence_set itself (the bare-evidence #derive_attachment_state is DIAGNOSTIC / NON_AUTHORIZING and must never be selected for an authority decision); a document that declares a state is rejected; inconsistent records never compose (CONFLICT); M0 probe requires derived ATTACHMENT_READY; every other M0 read op requires derived ATTACHED_READ_ONLY plus its operation-specific project/timeline binding; any M3 write requires derived SCRATCH_WRITE_READY"
dump("TARGET-CONTRACT.json", tc)
tcs = load("schemas/resolveTargetContract.schema.json")
# v1.20 (Phase 1 R-03): 'closed' is protocol-closed; the vendor socket may stay bound. Semantics are stated explicitly.
tcs["properties"]["session"]["properties"]["network_port_1144"] = {"enum": ["closed", "protocol-closed"]}
tcs["properties"]["session"]["properties"]["network_port_1144_semantics"] = {"type": "string"}
tcs["properties"]["session"]["required"] = sorted(set(tcs["properties"]["session"].get("required", [])) | {"network_port_1144_semantics"})
tcs["$id"] = "vidtoolz.resolveTargetContract.v1.10"; tcs["title"] = "Resolve target contract v1.10 (attachment gate; derived state; envelope law)"
tcs["properties"]["schema"] = {"const": "vidtoolz.resolveTargetContract.v1.10"}
tcs["properties"]["version"] = {"type": "string", "pattern": "^1\\.20\\.[0-9]+$"}
tcs["properties"]["attachment_derivation"] = {"const": tc["attachment_derivation"]}
# V114-B3: the diagnostic pair is named in the active contract ONLY as diagnostic, in its own field, and the
# schema pins that text so the classification cannot drift back.
tcs["properties"]["attachment_derivation_diagnostic_non_authorizing"] = {"const": tc["attachment_derivation_diagnostic_non_authorizing"]}
tcs["properties"]["attachment_states"] = {"type": "object", "additionalProperties": False, "required": L.ATTACHMENT_STATES + ["CONFLICT"], "properties": {s: {"type": "object", "additionalProperties": False, "required": ["required_records", "meaning"], "properties": {"required_records": {"type": "array", "items": {"enum": sorted(L.RECORD_TYPES)}, "uniqueItems": True}, "meaning": {"type": "string"}}} for s in L.ATTACHMENT_STATES + ["CONFLICT"]}}
tcs["properties"]["evidence_envelope_law"] = {"type": "object", "required": ["schema", "levels", "record_levels", "coherence_fields", "currency", "max_observation_age_s", "binding"]}
tcs["required"] = sorted(set(tcs["required"]) | {"evidence_envelope_law", "attachment_derivation_diagnostic_non_authorizing"})
dump("schemas/resolveTargetContract.schema.json", tcs)
fixture("target-contract-frozen-derived", "none", "resolveTargetContract", tc, check="semantic_target_contract")
neg = copy.deepcopy(tc); neg["attachment_state"] = "ATTACHMENT_READY"; fixture("target-declared-attachment-state", "schema", "resolveTargetContract", neg, expect_contains="attachment_state")
neg = copy.deepcopy(tc); neg["attachment_state_is_declared"] = True; fixture("target-declared-flag-true", "schema", "resolveTargetContract", neg, expect_contains="False")
neg = copy.deepcopy(tc); neg["accepts_current_open_session_as_target"] = True; fixture("target-accepts-open-session", "schema", "resolveTargetContract", neg, expect_contains="False")
neg = copy.deepcopy(tc); neg["library"]["kind"] = "PostgreSQL"; fixture("target-shared-postgres-library", "schema", "resolveTargetContract", neg, expect_contains="Disk")
neg = copy.deepcopy(tc); neg["denied_calls_all_scopes"].remove("SetCurrentDatabase"); fixture("target-missing-denied-setcurrentdatabase", "schema", "resolveTargetContract", neg, expect_contains="contains")
neg = copy.deepcopy(tc); neg["host"]["name"] = ""; fixture("target-empty-host", "schema", "resolveTargetContract", neg, expect_contains="minLength")
neg = copy.deepcopy(tc); neg["library"]["name"] = "EKA"; fixture("target-library-is-prohibited", "schema", "resolveTargetContract", neg, expect_contains="pattern")
neg = copy.deepcopy(tc); del neg["attachment_states"]["CONFLICT"]; fixture("target-missing-conflict-state", "schema", "resolveTargetContract", neg, expect_contains="CONFLICT")
neg = copy.deepcopy(tc); del neg["evidence_envelope_law"]; fixture("target-missing-envelope-law", "schema", "resolveTargetContract", neg, expect_contains="evidence_envelope_law")

# ============================================================ CAPABILITIES v1.6 (content-bound matrix; raw-capture evidence entries; refreeze block binds parser + spec) + READ PRIMITIVES (primitive spec authority)
rp = load("READ-PRIMITIVES.json")
rp["schema"] = "vidtoolz.resolveReadPrimitives.v1.10"; rp["version"] = "1.20.0"
for op, spec in rp["logical_operations"].items():
    for p in spec["primitives"]:
        s = F.PRIMITIVE_SPECS[p["method"]]
        p.pop("expected_type", None)
        p.update({"receiver": s["receiver"], "expected_type": s["expected_type"], "arg_types": s["arg_types"], "nullable": s["nullable"], "shape_rule": s["shape_rule"], "completeness": s["completeness"], "expectation_status": s["expectation_status"], "expectation_source": s["expectation_source"]})
probe = rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]
probe["failure_taxonomy"] = {k: list(v) for k, v in L.PROBE_FAILURE_TAXONOMY.items()}
probe["failure_law"] = "the probe (M0A) never classifies: it records RAW_CAPABILITY_CAPTURE facts (mechanical outcome RETURNED/RAISED/TIMEOUT/ATTRIBUTE_MISSING/TRANSPORT_FAILURE/REFUSED/UNSERIALIZABLE, typed return, exception facts, truncation facts, shim identity); the reference parser derives the class offline (M0B); a CAPABILITY_FAILURE family class is reviewed REJECT and the probe continues; a BINDING_MISMATCH (capture bound to another host/library/uuid/root/session/manifest/authority/version) is FATAL_TARGET_FAILURE: the probe STOPS and the session derives CONFLICT"
probe["output"] = "one RAW_CAPABILITY_CAPTURE record per (method, receiver) attempt + one CONNECTION_OBSERVATION + IDENTITY_UNIQUENESS/STABILITY_OBSERVATION pass lists, all envelope-bound to the session; no parse block, no success flag; a reviewed refreeze (M0C) may later turn rows QUALIFIED_READ"
probe["evidence_output"] = "RAW_CAPABILITY_CAPTURE"
probe["capture_shim_contract"] = "CAPTURE-SHIM.md"
probe["phases"] = list(L.M0_PHASES)
rp["primitive_spec_law"] = {"statuses": list(L.EXPECTATION_STATUSES), "frozen_allowed": False, "law": "every expectation (receiver, arg_types, nullable, expected_type, shape_rule, completeness) is DOCUMENTED_HYPOTHESIS until a reviewed refreeze (M0C) validates it against re-parsed captures; the reference parser classifies against the hypothesis, and classification against a hypothesis is not qualification; primitive_spec_sha256 = digest of the probe primitive specs and is bound by every REVIEW_DECISION, REFREEZE_RECORD and matrix evidence entry"}
rp["expected_type_note"] = "expected_type is the documented 21.1 return type (broad codec type: str|int|bool|float|list|dict|object) under expectation_status DOCUMENTED_HYPOTHESIS; the reference parser (authority_lib.derive_capability_result) classifies the raw capture against it; TYPE_MISMATCH is a derived class, never a probe field"
rp["primitive_spec_sha256"] = L.primitive_spec_digest(rp)
PROBE_METHODS = sorted({p["method"] for p in probe["primitives"]})
assert len(PROBE_METHODS) == 47, len(PROBE_METHODS)
rp["capture_allowlist_digest"] = L.shim_allowlist_digest(rp)
rp["capture_allowlist_law"] = "the ONE static getter allowlist a trusted capture may have been invoked under is exactly the probe_allowed primitives of READ_PRIMITIVE_QUALIFICATION_PROBE; capture_allowlist_digest is its canonical content digest (domain vidtoolz.resolveShimAllowlist.v1) and TRUSTED-SHIM.json pins it. A capture of a method outside this allowlist is refused before any derivation (v1.7, C16-B3)"
dump("READ-PRIMITIVES.json", rp)
# ---- v1.7 TRUST ROOT 1: the exact capture shim this authority version trusts (C16-B3, sections 6/7/8).
# Written here, before any capture fixture is minted, because derive_capability_result refuses an untrusted shim.
TRUSTED_SHIM = L.compute_trusted_capture_shim(rp)
dump("TRUSTED-SHIM.json", TRUSTED_SHIM)
L.clear_authority_caches()
assert L.trusted_capture_shim()["trusted_shim_sha256"] == TRUSTED_SHIM["trusted_shim_sha256"]
TRUSTED_SHIM_S = S("vidtoolz.resolveTrustedCaptureShim.v1", "Trusted capture shim authority v1.10 (the one shim identity a promotable capture may carry)",
                   {"schema": {"const": L.TRUSTED_SHIM_AUTHORITY_VERSION}, "authority_version": {"const": L.AUTHORITY_VERSION}, "shim_version": {"const": SHIM.SHIM_VERSION}, "shim_sha256": SHA,
                    "shim_source_path": {"const": "tools/capture_shim_reference.py"}, "shim_source_sha256": SHA, "allowlist_digest": SHA, "allowlist_method_count": POSINT,
                    "codec_version": {"const": L.CODEC}, "raw_schema_version": {"const": L.RAW_SCHEMA_ID}, "raw_ingest_version": {"const": L.RAW_INGEST_VERSION},
                    "evidence_store_version": {"const": L.EVIDENCE_STORE_VERSION}, "trusted_shim_sha256": SHA},
                   list(L.TRUSTED_SHIM_FIELDS) + ["trusted_shim_sha256"],
                   comment="v1.7 (C16-B3): in v1.6 a capture carried capture_shim_version and capture_shim_sha256 that nothing was ever compared against, so a capture claiming any shim sha qualified. Here the bundle pins ONE trusted shim: its source path and source bytes, its own self-hash, the allowlist it may invoke, the codec and raw schema it may emit. trusted_capture_shim() re-verifies all of that against the files on disk on every resolution, and capture_shim_trust_errors() refuses any capture that does not match. This file is itself pinned by FREEZE-MANIFEST.json.")
dump("schemas/resolveTrustedCaptureShim.schema.json", TRUSTED_SHIM_S)
rp_schema = load("schemas/resolveReadPrimitives.schema.json")
rp_schema["$id"] = "vidtoolz.resolveReadPrimitives.v1.10"; rp_schema["properties"]["schema"] = {"const": "vidtoolz.resolveReadPrimitives.v1.10"}
rp_schema["properties"]["expected_type_note"] = {"type": "string"}
rp_schema["properties"]["primitive_spec_sha256"] = SHA
rp_schema["properties"]["capture_allowlist_digest"] = SHA
rp_schema["properties"]["capture_allowlist_law"] = {"type": "string"}
rp_schema["properties"]["primitive_spec_law"] = {"type": "object", "additionalProperties": False, "required": ["statuses", "frozen_allowed", "law"], "properties": {"statuses": {"type": "array", "items": {"enum": list(L.EXPECTATION_STATUSES)}}, "frozen_allowed": {"const": False}, "law": {"type": "string"}}}
rp_schema["required"] = sorted(set(rp_schema["required"]) | {"primitive_spec_sha256", "primitive_spec_law", "capture_allowlist_digest", "capture_allowlist_law"})
lo = rp_schema["properties"]["logical_operations"]["additionalProperties"]
lo["properties"]["failure_taxonomy"] = {"type": "object", "additionalProperties": False, "required": ["CAPABILITY_FAILURE", "FATAL_TARGET_FAILURE"], "properties": {"CAPABILITY_FAILURE": {"type": "array", "items": {"type": "string"}}, "FATAL_TARGET_FAILURE": {"type": "array", "items": {"type": "string"}}}}
lo["properties"]["failure_law"] = {"type": "string"}
lo["properties"]["evidence_output"] = {"enum": ["RAW_CAPABILITY_CAPTURE", "NONE"]}
lo["properties"]["capture_shim_contract"] = {"type": "string"}
lo["properties"]["phases"] = {"type": "array", "items": {"enum": list(L.M0_PHASES)}}
pi = lo["properties"]["primitives"]["items"]
pi["properties"]["receiver"] = {"enum": list(L.RECEIVER_CLASSES)}
pi["properties"]["expected_type"] = {"enum": list(L.EXPECTED_TYPES)}
pi["properties"]["arg_types"] = {"type": "array", "items": {"enum": list(L.ARG_TYPES)}}
pi["properties"]["nullable"] = {"type": "boolean"}
pi["properties"]["shape_rule"] = {"enum": list(L.SHAPE_RULES)}
pi["properties"]["completeness"] = {"enum": list(L.COMPLETENESS_RULES)}
pi["properties"]["expectation_status"] = {"enum": list(L.EXPECTATION_STATUSES)}
pi["properties"]["expectation_source"] = {"type": "string", "minLength": 1}
pi["required"] = sorted(set(pi["required"]) | {"receiver", "expected_type", "arg_types", "nullable", "shape_rule", "completeness", "expectation_status"})
dump("schemas/resolveReadPrimitives.schema.json", rp_schema)

caps = load("CAPABILITIES.json")
caps["schema"] = "vidtoolz.resolveCapabilityMatrix.v1.10"; caps["version"] = "1.20.0"
caps["qualification_note"] = "v1.6: zero QUALIFIED_READ rows. The ACTIVE matrix is content-bound: active.capability_matrix_sha256 = digest(matrix, vidtoolz.resolveCapabilityMatrix.v1); a matrix object with any other content is not the active matrix whatever its labels. A row becomes QUALIFIED_READ only in a reviewed refreeze whose refreeze block (parser_version, parser_sha256, primitive_spec_sha256, promoted_probe_ids, promoted_raw_capture_sha256, promoted_derived_result_sha256, promoted_review_decision_sha256) and a REFREEZE_RECORD promote exactly the evidence entry's digests; capability_qualification then resolves the RAW_CAPABILITY_CAPTURE, re-parses it NOW with the reference parser (SUCCESS required, derived digest equal), and requires a valid ACCEPT REVIEW_DECISION of exactly that raw+derived pair by a reviewer other than the operator. No entry has a writable success flag."
caps["evidence_record_fields"] = ["host", "product", "resolve_version", "build", "run_ref", "method", "receiver_class", "evidence_path", "evidence_sha256", "version_match", "reviewed_refreeze_version", "probe_id", "raw_capture_sha256", "derived_result_sha256", "review_decision_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "result"]
caps["refreeze"] = {"kind": "M0_READ_REQUALIFICATION", "reviewed": False, "review_decision_ref": None, "parent_capability_matrix_sha256": None, "parser_version": L.PARSER_VERSION, "parser_sha256": L.parser_sha256(), "primitive_spec_sha256": rp["primitive_spec_sha256"], "promoted_probe_ids": [], "promoted_raw_capture_sha256": [], "promoted_derived_result_sha256": [], "promoted_review_decision_sha256": [], "note": "no probe has run; nothing promoted"}
caps["qualification_pipeline"] = ["M0A RAW_CAPABILITY_CAPTURE: the capture shim records facts only (outcome, typed return or exception, truncation, shim identity, binding); no parse block, no success flag (CAPTURE-SHIM.md, RAW-CAPTURE.md)", "M0B DERIVE: authority_lib.derive_capability_result(capture, primitive_spec, env, active) -> classification in the closed vocabulary; parser_version + parser_sha256 identify the parser; stored DERIVED_CAPABILITY_RESULT records are a cache that must equal the recomputation", "M0B REVIEW_DECISION: human decision bound to raw_capture_sha256 + derived_result_sha256 + parser + primitive_spec_sha256 + method + receiver + reviewer; ACCEPT valid only over recomputed SUCCESS; reviewer != operator", "M0C REFREEZE: successor CAPABILITIES.json whose refreeze block lists promoted probe ids, raw, derived and review digests under the active parser + spec; rows QUALIFIED_READ with evidence entries naming those digests; REFREEZE_RECORD binding parent + successor matrix digest, parser, spec, probe/session, host/product/version/build, approver", "M0D ACTIVE_CAPABILITY: active.capability_matrix_sha256 = digest of the successor matrix; capability_qualification recomputes every link (matrix content, refreeze block, refreeze record, raw capture re-parsed to SUCCESS, review ACCEPT) before any primitive is QUALIFIED_CALLABLE", "PROMOTION STATE (derived): CANDIDATE -> REVIEWED_ACCEPTED | REVIEWED_REJECTED -> PROMOTED_IN_REFREEZE -> ACTIVE_QUALIFIED_READ; no direct jump"]
caps["matrix_content_law"] = "the active capability authority is the canonical content digest of this object (domain vidtoolz.resolveCapabilityMatrix.v1), bound to the freeze manifest (this file's sha256 + bytes) and to REFREEZE_RECORDs; evaluators refuse (CAPABILITY_MATRIX_NOT_ACTIVE) any matrix whose digest differs from active.capability_matrix_sha256"
for r in caps["rows"]:
    for x in r.get("evidence_records", []):
        x.pop("raw_evidence_sha256", None)
        x["probe_id"] = None; x["result"] = "UNQUALIFIED_PRIOR_VERSION"
dump("CAPABILITIES.json", caps)
cap_schema = load("schemas/resolveCapabilityMatrix.schema.json")
cap_schema["$id"] = "vidtoolz.resolveCapabilityMatrix.v1.10"; cap_schema["title"] = "Capability matrix v1.10 (content-bound; exact stored-chain evidence entries)"
cap_schema["properties"]["schema"] = {"const": "vidtoolz.resolveCapabilityMatrix.v1.10"}
cap_schema["properties"]["refreeze"] = {"type": "object", "additionalProperties": False, "required": ["kind", "reviewed", "review_decision_ref", "parent_capability_matrix_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "promoted_probe_ids", "promoted_raw_capture_sha256", "promoted_derived_result_sha256", "promoted_review_decision_sha256"], "properties": {"kind": {"const": "M0_READ_REQUALIFICATION"}, "reviewed": {"type": "boolean"}, "review_decision_ref": STR_OR_NULL, "parent_capability_matrix_sha256": SHA_OR_NULL, "parser_version": {"const": L.PARSER_VERSION}, "parser_sha256": SHA, "primitive_spec_sha256": SHA, "promoted_probe_ids": {"type": "array", "items": {"type": "string"}}, "promoted_raw_capture_sha256": {"type": "array", "items": SHA}, "promoted_derived_result_sha256": {"type": "array", "items": SHA}, "promoted_review_decision_sha256": {"type": "array", "items": SHA}, "note": {"type": "string"}}}
cap_schema["properties"]["qualification_pipeline"] = {"type": "array", "items": {"type": "string"}}
cap_schema["properties"]["matrix_content_law"] = {"type": "string"}
er = cap_schema["properties"]["rows"]["items"]["properties"]["evidence_records"]["items"]
er["properties"].pop("raw_evidence_sha256", None)
er["properties"].pop("observed_result", None)
er["properties"].update({"product": STR_OR_NULL, "receiver_class": {"enum": list(L.RECEIVER_CLASSES)}, "probe_id": STR_OR_NULL, "session_id": STR_OR_NULL, "raw_capture_sha256": SHA, "derived_result_sha256": SHA, "derived_record_sha256": SHA, "review_decision_sha256": SHA, "refreeze_block_sha256": SHA, "capture_shim_version": {"const": SHIM.SHIM_VERSION}, "capture_shim_sha256": SHA, "trusted_shim_sha256": SHA, "parser_version": {"const": L.PARSER_VERSION}, "parser_sha256": SHA, "primitive_spec_sha256": SHA, "result": {"enum": ["UNQUALIFIED_PRIOR_VERSION", None]}, "observed_result": {"type": "string"}})
er["required"] = ["build", "evidence_path", "host", "method", "probe_id", "resolve_version", "result", "reviewed_refreeze_version", "run_ref", "version_match"]  # fixed set: never accumulated from the previous version
er["additionalProperties"] = False
# v1.7 (C16-B4, section 12): a promoted row binds the EXACT stored chain - raw capture, stored derived record, review,
# refreeze record, probe and session, the trusted shim identity, the parser and the primitive spec - not just some digests.
er["allOf"] = [{"if": {"properties": {"result": {"const": None}}}, "then": {"required": ["receiver_class", "session_id", "raw_capture_sha256", "derived_result_sha256", "derived_record_sha256", "review_decision_sha256", "refreeze_block_sha256", "capture_shim_version", "capture_shim_sha256", "trusted_shim_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "product"], "not": {"required": ["observed_result"]}}}]
cap_schema["required"] = sorted(set(cap_schema["required"]) | {"refreeze", "matrix_content_law"})
dump("schemas/resolveCapabilityMatrix.schema.json", cap_schema)
fixture("capabilities-frozen", "none", "resolveCapabilityMatrix", caps, check="semantic_capabilities")
V16E = {"host": HOST, "product": F.PRODUCT, "resolve_version": "21.1.0", "build": 14, "run_ref": "probe", "method": "GetVersionString", "receiver_class": "Resolve", "evidence_path": "/x", "evidence_sha256": "a" * 64, "version_match": True, "reviewed_refreeze_version": "1.20.0", "probe_id": "probe-0001", "session_id": F.S_CUR, "raw_capture_sha256": "b" * 64, "derived_result_sha256": "c" * 64, "derived_record_sha256": "e" * 64, "review_decision_sha256": "d" * 64, "refreeze_block_sha256": "f" * 64, "capture_shim_version": SHIM.SHIM_VERSION, "capture_shim_sha256": SHIM.shim_sha256(), "trusted_shim_sha256": TRUSTED_SHIM["trusted_shim_sha256"], "parser_version": L.PARSER_VERSION, "parser_sha256": L.parser_sha256(), "primitive_spec_sha256": rp["primitive_spec_sha256"], "result": None}
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; fixture("capabilities-qualified-read-without-exact-evidence", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="without exact")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; neg["rows"][0]["evidence_records"] = [dict(V16E, success=True)]; fixture("capabilities-qualified-read-entry-with-success-flag", "schema", "resolveCapabilityMatrix", neg, expect_contains="success")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; neg["rows"][0]["evidence_records"] = [dict(V16E, reviewed_refreeze_version="1.5.0")]; fixture("capabilities-qualified-read-promoted-by-other-refreeze", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="refreeze")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; neg["rows"][0]["evidence_records"] = [dict(V16E)]; fixture("capabilities-qualified-read-unreviewed-refreeze-block", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="reviewed refreeze block")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED"; fixture("capabilities-unknown-evidence-class", "schema", "resolveCapabilityMatrix", neg, expect_contains="enum")
neg = copy.deepcopy(caps); del neg["refreeze"]; fixture("capabilities-missing-refreeze-block", "schema", "resolveCapabilityMatrix", neg, expect_contains="refreeze")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_class"] = "QUALIFIED_READ"; neg["refreeze"].update(reviewed=True, review_decision_ref="x", promoted_probe_ids=["probe-0001"], promoted_raw_capture_sha256=["b" * 64], promoted_derived_result_sha256=[], promoted_review_decision_sha256=[]); neg["rows"][0]["evidence_records"] = [dict(V16E)]; fixture("capabilities-qualified-read-evidence-not-promoted-by-refreeze", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="not explicitly promoted")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_records"][0]["version_match"] = True; fixture("capabilities-version-match-lie", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="version differs")
neg = copy.deepcopy(caps); neg["refreeze"]["parser_sha256"] = "0" * 64; fixture("capabilities-refreeze-block-stale-parser", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="parser")
neg = copy.deepcopy(caps); neg["refreeze"]["parser_version"] = "vidtoolz.resolveProbeParser.v0"; fixture("capabilities-refreeze-block-old-parser-version", "schema", "resolveCapabilityMatrix", neg, expect_contains="const")
neg = copy.deepcopy(caps); neg["refreeze"]["promoted_raw_capture_sha256"] = ["b" * 64]; fixture("capabilities-unreviewed-block-promotes", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="unreviewed refreeze block promotes")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_records"].append(dict(V16E)); fixture("capabilities-v16-entry-on-unqualified-row", "semantic", "resolveCapabilityMatrix", neg, check="semantic_capabilities", expect_contains="not QUALIFIED_READ")
neg = copy.deepcopy(caps); neg["rows"][0]["evidence_records"][0]["result"] = "SUCCESS"; fixture("capabilities-prior-record-claims-success", "schema", "resolveCapabilityMatrix", neg, expect_contains="enum")
neg = copy.deepcopy(caps); del neg["matrix_content_law"]; fixture("capabilities-missing-content-law", "schema", "resolveCapabilityMatrix", neg, expect_contains="matrix_content_law")
fixture("read-primitives-frozen", "none", "resolveReadPrimitives", rp, check="semantic_read_primitives")
neg = copy.deepcopy(rp); neg["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"][0]["evidence_class"] = "QUALIFIED_READ"; fixture("read-primitives-class-mismatch-with-matrix", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="!= matrix")
neg = copy.deepcopy(rp); neg["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"][0]["probe_allowed"] = True; fixture("read-primitives-probe-allowed-outside-probe", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="only inside")
neg = copy.deepcopy(rp); neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["failure_taxonomy"]["FATAL_TARGET_FAILURE"] = ["WRONG_HOST"]; fixture("read-primitives-taxonomy-drift", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="taxonomy")
neg = copy.deepcopy(rp); del neg["logical_operations"]["CONNECT"]["primitives"][0]["receiver"]; fixture("read-primitives-missing-receiver", "schema", "resolveReadPrimitives", neg, expect_contains="receiver")
neg = copy.deepcopy(rp); del neg["logical_operations"]["CONNECT"]["primitives"][0]["expected_type"]; fixture("read-primitives-missing-expected-type", "schema", "resolveReadPrimitives", neg, expect_contains="expected_type")
neg = copy.deepcopy(rp); del neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["primitives"][0]["nullable"]; fixture("read-primitives-missing-nullable", "schema", "resolveReadPrimitives", neg, expect_contains="nullable")
neg = copy.deepcopy(rp); neg["logical_operations"]["CONNECT"]["target_requirement"] = "CURRENT_PROJECT"; fixture("read-primitives-invented-target-requirement", "schema", "resolveReadPrimitives", neg, expect_contains="enum")
neg = copy.deepcopy(rp); neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["primitives"][0]["nullable"] = True; fixture("read-primitives-spec-changed-without-digest", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="primitive_spec_sha256")
neg = copy.deepcopy(rp); neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["primitives"][0]["expectation_status"] = "FROZEN"; neg["primitive_spec_sha256"] = L.primitive_spec_digest(neg); fixture("read-primitives-frozen-expectation-without-refreeze", "semantic", "resolveReadPrimitives", neg, check="semantic_read_primitives", expect_contains="FROZEN")
neg = copy.deepcopy(rp); neg["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["evidence_output"] = "CANDIDATE_EVIDENCE"; fixture("read-primitives-probe-output-not-raw", "schema", "resolveReadPrimitives", neg, expect_contains="enum")
# hypothetical refrozen matrix template (NOT AUTHORITY); its refreeze block and QUALIFIED_READ entries are filled by fixture_evidence.base_sets from the honest captures/reviews
caps_hyp = copy.deepcopy(caps); caps_hyp["version"] = "1.20.0-HYPOTHETICAL"; caps_hyp["qualification_note"] = "HYPOTHETICAL_NOT_AUTHORITY: illustrates a future reviewed refreeze (rows QUALIFIED_READ citing raw/derived/review digests of fixture captures); never load as CAPABILITIES.json"
CAPS_SHA = L.capability_matrix_digest(caps)
assert CAPS_SHA == L.capability_matrix_digest(load("CAPABILITIES.json"))
ACTIVE = {"authority_version": L.AUTHORITY_VERSION, "manifest_sha256": F.PLACEHOLDER_MANIFEST, "capability_matrix_sha256": CAPS_SHA, "trusted_shim_sha256": TRUSTED_SHIM["trusted_shim_sha256"]}
M = F.Mint(F.PLACEHOLDER_MANIFEST, CAPS_SHA, rp=rp)
EVSETS, H = F.base_sets(M, PROBE_METHODS, caps_hyp, CAPS_SHA)
dump("fixtures/eligibility/capabilities-hypothetical-refreeze.json", caps_hyp)
HYP = "fixtures/eligibility/capabilities-hypothetical-refreeze.json"
HYP_SHA = H["hyp_sha"]
assert HYP_SHA == L.capability_matrix_digest(load(HYP))
ACTIVE_HYP = dict(ACTIVE, capability_matrix_sha256=HYP_SHA)
dump("fixtures/evidence/ACTIVE-AUTHORITY-PLACEHOLDER.json", {"schema": "vidtoolz.resolveFixtureActiveAuthority.v1.10", "note": "fixtures are minted against this PLACEHOLDER manifest sha; the validator proves they do not derive against the real FREEZE-MANIFEST.json sha and that records re-minted against the real sha do. capability_matrix_sha256 is the CANONICAL CONTENT DIGEST (domain vidtoolz.resolveCapabilityMatrix.v1) of the matrix object, not a file hash", "placeholder_manifest_sha256": F.PLACEHOLDER_MANIFEST, "capability_matrix_sha256": CAPS_SHA, "hypothetical_capability_matrix_sha256": HYP_SHA, "parser_version": L.PARSER_VERSION, "parser_sha256": L.parser_sha256(), "primitive_spec_sha256": rp["primitive_spec_sha256"], "reference_shim_version": SHIM.SHIM_VERSION, "reference_shim_sha256": SHIM.shim_sha256(), "trusted_shim_sha256": TRUSTED_SHIM["trusted_shim_sha256"], "capture_allowlist_digest": rp["capture_allowlist_digest"], "active_authority_shape": ["authority_version", "manifest_sha256", "capability_matrix_sha256", "trusted_shim_sha256"]})

# ============================================================ EVIDENCE SET schema v1.6 (envelope law; raw-capture record types) + fixture evidence sets
envelope_s = {"type": "object", "additionalProperties": False, "required": list(L.ENVELOPE_FIELDS), "properties": {"authority_version": {"type": "string", "minLength": 1}, "manifest_sha256": SHA, "host_name": {"type": "string", "minLength": 1}, "product": STR_OR_NULL, "resolve_version": STR_OR_NULL, "build": {"type": ["integer", "null"]}, "library_name": STR_OR_NULL, "library_uuid": {"anyOf": [UUID, {"type": "null"}]}, "library_root": {"anyOf": [ABS_PATH, {"type": "null"}]}, "session_id": STR_OR_NULL, "provisioning_id": SHA_OR_NULL, "project_name": STR_OR_NULL, "project_unique_id": STR_OR_NULL, "timeline_name": STR_OR_NULL, "timeline_unique_id": STR_OR_NULL, "target_epoch": STR_OR_NULL, "sequence": NONNEG, "captured_at": {"type": "string", "minLength": 20}, "record_type_version": {"const": L.RECORD_TYPE_VERSION}}}


def rec_schema(rtype, req, props):
    level = L.ENVELOPE_LEVEL[rtype]
    env_req = {k: {"not": {"type": "null"}} for k in L.ENVELOPE_REQUIRED[level]}
    if rtype in L.PROJECT_SCOPED:
        env_req["project_name"] = {"type": "string", "minLength": 1}
    if rtype in L.TIMELINE_SCOPED:
        env_req["timeline_name"] = {"type": "string", "minLength": 1}
    return {"if": {"properties": {"record_type": {"const": rtype}}}, "then": {"required": sorted(set(req) | {"record_type", "record_id", "envelope", "recorded_at"}), "properties": dict(props, envelope={"properties": env_req})}}


PYV = {"$ref": "#/$defs/pyvalue"}
PYVALUE_DEFS = {"pyvalue": {"oneOf": [
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "str"}, "v": {"type": "string"}, "truncated": {"const": True}, "full_len": NONNEG, "full_sha256": SHA}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "int"}, "v": {"type": "integer"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "bigint"}, "v": {"type": "string", "pattern": "^-?[0-9]+$"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "bool"}, "v": {"type": "boolean"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t"], "properties": {"$t": {"const": "none"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "f64"}, "v": {"type": "string", "pattern": "^[0-9a-f]{16}$"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "f64_nonfinite"}, "v": {"enum": ["nan", "+inf", "-inf"]}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "len", "sha256", "head_hex"], "properties": {"$t": {"const": "bytes"}, "len": NONNEG, "sha256": SHA, "head_hex": {"type": "string"}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "py", "v"], "properties": {"$t": {"const": "list"}, "py": {"enum": ["list", "tuple"]}, "v": {"type": "array", "items": PYV}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "v"], "properties": {"$t": {"const": "dict"}, "v": {"type": "array", "items": {"type": "array", "minItems": 2, "maxItems": 2, "items": PYV}}}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "class", "module", "handle_token", "repr_sha256"], "properties": {"$t": {"const": "object"}, "class": {"type": "string", "minLength": 1}, "module": {"type": "string"}, "handle_token": {"type": "string"}, "repr_sha256": SHA}},
    {"type": "object", "additionalProperties": False, "required": ["$t", "reason"], "properties": {"$t": {"const": "elided"}, "reason": {"enum": ["depth", "length"]}, "py": {"type": "string"}, "len": NONNEG, "omitted": NONNEG}},
]}}
CAPTURE_S = {"type": "object", "additionalProperties": False, "required": list(L.RAW_CAPTURE_REQUIRED), "properties": {
    "schema": {"const": L.RAW_SCHEMA_ID}, "probe_id": {"type": "string", "minLength": 1}, "getter_attempt_id": {"type": "string", "minLength": 1}, "sequence": POSINT, "captured_at": {"type": "string", "minLength": 20},
    "authority_version": {"type": "string", "minLength": 1}, "manifest_sha256": SHA, "host_name": {"type": "string", "minLength": 1}, "product": STR_OR_NULL, "resolve_version": STR_OR_NULL, "build": {"type": ["integer", "null"]}, "session_id": {"type": "string", "minLength": 1}, "library_uuid": UUID, "library_root": ABS_PATH,
    "receiver": {"type": "object", "additionalProperties": False, "required": ["class", "path", "handle_token", "runtime_type"], "properties": {"class": {"enum": list(L.RECEIVER_CLASSES)}, "path": {"type": "string", "minLength": 1}, "handle_token": STR_OR_NULL, "runtime_type": STR_OR_NULL}},
    "method": {"type": "string", "minLength": 1}, "args": {"type": "array", "items": PYV}, "outcome": {"enum": list(L.MECHANICAL_OUTCOMES)},
    "returned": {"type": "object", "additionalProperties": False, "required": ["python_type", "value"], "properties": {"python_type": {"type": "string", "minLength": 1}, "value": PYV}},
    "raised": {"type": "object", "additionalProperties": False, "required": ["exception_class", "module", "message"], "properties": {"exception_class": {"type": "string", "minLength": 1}, "module": {"type": "string"}, "message": {"type": "string"}}},
    "timeout_ms": POSINT, "transport": {"type": "object", "required": ["reason"], "properties": {"reason": {"type": "string"}}},
    "refused": {"type": "object", "additionalProperties": False, "required": ["reason", "invoked"], "properties": {"reason": {"type": "string"}, "invoked": {"const": False}}},
    "unserializable": {"type": "object", "additionalProperties": False, "required": ["python_type", "reason", "path", "repr_sha256"], "properties": {"python_type": {"type": "string"}, "reason": {"type": "string"}, "path": {"type": "string"}, "repr_sha256": SHA}},
    "serialization": {"type": "object", "additionalProperties": False, "required": ["codec", "depth_limit", "length_limit", "string_limit", "truncated", "elided_paths"], "properties": {"codec": {"const": L.CODEC}, "depth_limit": POSINT, "length_limit": POSINT, "string_limit": POSINT, "truncated": {"type": "boolean"}, "elided_paths": {"type": "array", "items": {"type": "string"}}}},
    "stdout_sha256": SHA_OR_NULL, "stderr_sha256": SHA_OR_NULL, "duration_ms": {"type": ["integer", "null"], "minimum": 0}, "capture_shim_version": {"type": "string", "minLength": 1}, "capture_shim_sha256": SHA, "operator": {"type": "string", "minLength": 1}, "raw_digest": SHA},
    "allOf": [{"if": {"properties": {"outcome": {"const": "RETURNED"}}}, "then": {"required": ["returned"]}}, {"if": {"properties": {"outcome": {"const": "RAISED"}}}, "then": {"required": ["raised"]}}, {"if": {"properties": {"outcome": {"const": "TIMEOUT"}}}, "then": {"required": ["timeout_ms"]}}, {"if": {"properties": {"outcome": {"const": "REFUSED"}}}, "then": {"required": ["refused"]}}, {"if": {"properties": {"outcome": {"const": "UNSERIALIZABLE"}}}, "then": {"required": ["unserializable"]}}, {"if": {"properties": {"outcome": {"const": "TRANSPORT_FAILURE"}}}, "then": {"required": ["transport"]}}]}
DERIVED_S = {"type": "object", "additionalProperties": False, "required": ["schema", "parser_version", "parser_sha256", "raw_capture_sha256", "spec_digest", "method", "receiver_class", "expectation_status", "classification", "family", "facts", "reasons", "derived_result_sha256"], "properties": {"schema": {"const": "vidtoolz.resolveDerivedCapabilityResult.v1"}, "parser_version": {"const": L.PARSER_VERSION}, "parser_sha256": SHA, "raw_capture_sha256": SHA_OR_NULL, "spec_digest": SHA_OR_NULL, "method": STR_OR_NULL, "receiver_class": STR_OR_NULL, "expectation_status": {"anyOf": [{"enum": list(L.EXPECTATION_STATUSES)}, {"type": "null"}]}, "classification": {"enum": list(L.DERIVED_CLASSES)}, "family": {"type": "string"}, "facts": {"type": "object"}, "reasons": {"type": "array", "items": {"type": "string"}}, "derived_result_sha256": SHA}}
ident_s = {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "unique_id_reason", "name", "name_status"], "properties": {"unique_id": STR_OR_NULL, "unique_id_status": OBS, "unique_id_reason": STR_OR_NULL, "name": STR_OR_NULL, "name_status": OBS}}
coverage = {"type": "object", "additionalProperties": False, "required": ["profile", "complete", "observed_domains", "unobservable_domains", "deferred_domains", "incomplete_reasons"], "properties": {"profile": {"enum": list(L.COVERAGE_PROFILES)}, "complete": {"type": "boolean"}, "observed_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "unobservable_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "deferred_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "incomplete_reasons": {"type": "array", "items": {"type": "string", "minLength": 1}}}}
policy_s = {"type": "object", "additionalProperties": False, "required": ["target_contract_sha256", "timebase_sha256", "track_policy_sha256", "capabilities_version", "capability_matrix_sha256", "collector_version", "canonicalization_version"], "properties": {"target_contract_sha256": SHA, "timebase_sha256": SHA, "track_policy_sha256": SHA, "capabilities_version": {"type": "string"}, "capability_matrix_sha256": SHA, "collector_version": {"type": "string"}, "canonicalization_version": {"const": "1.5"}}}
library_s = {"type": "object", "additionalProperties": False, "required": ["db_type", "db_name", "instance_uuid"], "properties": {"db_type": {"enum": ["Disk"]}, "db_name": {"type": "string", "minLength": 1}, "instance_uuid": UUID}}
GUARD_OBJ_S = {"type": "object", "additionalProperties": False, "required": ["hash_domain", "guard_version", "library", "project", "timeline", "target_epoch", "coverage", "policy", "provenance_sha256", "payload_sha256"], "properties": {"hash_domain": {"const": "vidtoolz.resolveGuard.v3"}, "guard_version": {"const": 3}, "library": library_s, "project": ident_s, "timeline": ident_s, "target_epoch": {"type": "string"}, "coverage": coverage, "policy": policy_s, "provenance_sha256": SHA, "payload_sha256": SHA}}
PROV_ENTRY_S = {"type": "object", "additionalProperties": False, "required": ["observation_class", "raw_capture_record_id", "capability_matrix_sha256"], "properties": {"observation_class": {"enum": list(L.OBSERVATION_CLASSES)}, "raw_capture_record_id": SHA_OR_NULL, "capability_matrix_sha256": SHA_OR_NULL}}
PROV_MAP_S = {"type": "object", "additionalProperties": PROV_ENTRY_S}
# v1.7: `supersedes` is the ONLY way one review or refreeze retires another (sections 10/11); insertion order never decides.
SUPERSEDES_S = {"type": "array", "items": SHA, "uniqueItems": True}
# v1.7 (C16-M2): a raw capture record is admissible only with the strict-parse receipt of the exact frame bytes it came from.
INGEST_RECEIPT_S = {"type": "object", "additionalProperties": False, "required": ["schema", "ingest_version", "authority_version", "raw_schema_version", "codec_version", "raw_bytes_sha256", "byte_count", "strict_parse", "duplicate_keys_rejected", "control_characters_rejected", "single_json_object", "capture_digest", "receipt_sha256"],
                    "properties": {"schema": {"const": L.RAW_INGEST_RECEIPT_DOMAIN}, "ingest_version": {"const": L.RAW_INGEST_VERSION}, "authority_version": {"const": L.AUTHORITY_VERSION}, "raw_schema_version": {"const": L.RAW_SCHEMA_ID}, "codec_version": {"const": L.CODEC}, "raw_bytes_sha256": SHA, "byte_count": POSINT, "strict_parse": {"const": True}, "duplicate_keys_rejected": {"const": True}, "control_characters_rejected": {"const": True}, "single_json_object": {"const": True}, "capture_digest": SHA, "receipt_sha256": SHA}}
CLAIMS_S = {"type": "object", "additionalProperties": False, "required": ["claim_A_callable", "claim_B_unique_within_pass", "claim_C_stable_across_passes", "passes", "items", "duplicates", "null_paths", "input_errors", "observation_count", "raw_capture_sha256s", "derived_result_sha256s", "not_claimed"], "properties": {"claim_A_callable": {"type": "boolean"}, "claim_B_unique_within_pass": {"type": "boolean"}, "claim_C_stable_across_passes": {"type": "boolean"}, "passes": NONNEG, "items": NONNEG, "duplicates": {"type": "array", "items": {"type": "string"}}, "null_paths": {"type": "array", "items": {"type": "string"}}, "input_errors": {"type": "array", "items": {"type": "string"}}, "observation_count": NONNEG, "raw_capture_sha256s": {"type": "array", "items": SHA}, "derived_result_sha256s": {"type": "array", "items": SHA}, "not_claimed": {"type": "array", "items": {"type": "string"}}}}
IDENTITY_OBS_S = (["method", "passes", "claims", "project_name", "timeline_name"], {"method": {"type": "string", "minLength": 1}, "passes": {"type": "array", "minItems": 1, "items": {"type": "array", "items": SHA}}, "claims": CLAIMS_S, "project_name": {"type": "string"}, "timeline_name": {"type": "string"}})
RECORD_RULES = [
    rec_schema("PROVISIONING_RECORD", ["library_kind", "root_path", "instance_uuid", "provisioned_by"], {"library_kind": {"const": "Disk"}, "root_path": ABS_PATH, "instance_uuid": UUID, "provisioned_by": {"type": "string", "minLength": 1}}),
    rec_schema("LAUNCH_RECIPE", ["recipe_sha256", "resolve_version", "resolve_binary_sha256", "external_scripting_preference"], {"recipe_sha256": SHA, "resolve_version": {"type": "string"}, "resolve_binary_sha256": SHA, "external_scripting_preference": {"enum": ["Local", "Network", "None"]}}),
    rec_schema("BUNDLE_VERIFICATION",
               ["authority_version", "manifest_sha256", "verifier", "prepared_by", "historical",
                # ---- v1.12 (V112-4) the workflow binding: what was verified, by which registered principal, with
                # which independently computed pinned-file digests, and with an explicit result.
                "verification_result", "verifier_principal", "preparer_principal",
                "verified_provisioning_id", "verified_launch_recipe_id", "pinned_file_digests"],
               {"authority_version": {"type": "string"}, "manifest_sha256": SHA,
                "verifier": {"type": "string", "minLength": 1}, "prepared_by": {"type": "string", "minLength": 1},
                "historical": {"type": "boolean"},
                "verification_result": {"enum": list(L.VERIFICATION_RESULTS)},
                # SCHEMA-VALID != AUTHORIZED: the schema types a principal, and derive_attachment_state decides
                # whether it is REGISTERED for the role. A self-verified bundle is schema-valid and never authorized.
                "verifier_principal": {"type": "string", "pattern": "^[A-Z]+:[A-Za-z0-9._-]+$"},
                "preparer_principal": {"type": "string", "pattern": "^[A-Z]+:[A-Za-z0-9._-]+$"},
                "verified_provisioning_id": SHA, "verified_launch_recipe_id": SHA,
                "pinned_file_digests": {"type": "object", "additionalProperties": {"anyOf": [SHA, {"type": "null"}]},
                                        "minProperties": 1}}),
    rec_schema("CONNECTION_OBSERVATION", ["db_type", "db_name", "product", "resolve_version", "root_path", "instance_uuid"], {"db_type": {"type": "string"}, "db_name": {"type": "string"}, "product": {"type": "string"}, "resolve_version": {"type": "string"}, "root_path": {"type": ["string", "null"]}, "instance_uuid": {"anyOf": [UUID, {"type": "null"}]}}),
    rec_schema("PROJECT_BINDING_OBSERVATION", ["project_name", "project_unique_id", "project_unique_id_status"], {"project_name": {"type": "string", "minLength": 1}, "project_unique_id": STR_OR_NULL, "project_unique_id_status": OBS}),
    rec_schema("TIMELINE_BINDING_OBSERVATION", ["project_name", "timeline_name", "timeline_unique_id", "timeline_unique_id_status", "project_unique_id"], {"project_name": {"type": "string", "minLength": 1}, "timeline_name": {"type": "string", "minLength": 1}, "timeline_unique_id": STR_OR_NULL, "timeline_unique_id_status": OBS, "project_unique_id": STR_OR_NULL}),
    rec_schema("OPERATOR_PROVISIONED_PROJECT", ["project_name", "provisioned_by"], {"project_name": {"type": "string", "minLength": 1}, "provisioned_by": {"type": "string", "minLength": 1}}),
    rec_schema("RAW_CAPABILITY_CAPTURE", ["capture", "raw_capture_sha256", "ingest_receipt"], {"capture": CAPTURE_S, "raw_capture_sha256": SHA, "ingest_receipt": INGEST_RECEIPT_S}),
    rec_schema("DERIVED_CAPABILITY_RESULT", ["raw_capture_sha256", "derived_result_sha256", "derived"], {"raw_capture_sha256": SHA, "derived_result_sha256": SHA, "derived": DERIVED_S}),
    rec_schema("REVIEW_DECISION", ["raw_capture_sha256", "derived_result_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "method", "receiver_class", "probe_id", "session_id", "reviewer", "decision", "rationale", "reviewed_at"], {"supersedes": SUPERSEDES_S, "raw_capture_sha256": SHA, "derived_result_sha256": SHA, "parser_version": {"const": L.PARSER_VERSION}, "parser_sha256": SHA, "primitive_spec_sha256": SHA, "method": {"type": "string", "minLength": 1}, "receiver_class": {"enum": list(L.RECEIVER_CLASSES)}, "probe_id": {"type": "string", "minLength": 1}, "session_id": {"type": "string", "minLength": 1}, "reviewer": {"type": "string", "minLength": 1}, "decision": {"enum": list(L.REVIEW_DECISIONS)}, "rationale": {"type": "string", "minLength": 1}, "reviewed_at": {"type": "string", "minLength": 20}}),
    rec_schema("RAW_EVIDENCE", ["content", "content_sha256"], {"content": {"type": "string"}, "content_sha256": SHA}),
    rec_schema("REFREEZE_RECORD", ["kind", "reviewed", "manifest_sha256", "authority_version", "parent_capability_matrix_sha256", "capability_matrix_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "probe_id", "session_id", "promoted_probe_ids", "promoted_raw_capture_sha256", "promoted_derived_result_sha256", "promoted_review_decision_sha256", "host_name", "product", "resolve_version", "build", "approver"], {"kind": {"enum": ["M0_READ_REQUALIFICATION"]}, "reviewed": {"type": "boolean"}, "manifest_sha256": SHA, "authority_version": {"type": "string"}, "parent_capability_matrix_sha256": SHA, "capability_matrix_sha256": SHA, "parser_version": {"const": L.PARSER_VERSION}, "parser_sha256": SHA, "primitive_spec_sha256": SHA, "probe_id": {"type": "string", "minLength": 1}, "session_id": {"type": "string", "minLength": 1}, "promoted_probe_ids": {"type": "array", "items": {"type": "string"}}, "promoted_raw_capture_sha256": {"type": "array", "items": SHA}, "promoted_derived_result_sha256": {"type": "array", "items": SHA}, "promoted_review_decision_sha256": {"type": "array", "items": SHA}, "host_name": {"type": "string"}, "product": {"type": "string"}, "resolve_version": {"type": "string"}, "build": {"type": "integer"}, "approver": {"type": "string", "minLength": 1}, "supersedes": SUPERSEDES_S}),
    rec_schema("IDENTITY_UNIQUENESS_OBSERVATION", *IDENTITY_OBS_S),
    rec_schema("IDENTITY_STABILITY_OBSERVATION", *IDENTITY_OBS_S),
    rec_schema("MILESTONE_EXIT", ["milestone", "authority_version", "evidence_dir_sha256"], {"milestone": {"enum": ["M0", "M1", "M2"]}, "authority_version": {"type": "string"}, "evidence_dir_sha256": SHA}),
    rec_schema("M3_AUTHORIZATION", ["scope", "approver", "authority_version", "library_name"], {"scope": {"const": SCOPE}, "approver": {"type": "string", "minLength": 1}, "authority_version": {"type": "string"}, "library_name": {"type": "string"}}),
    rec_schema("JOURNAL_PREPARED", ["transaction_id", "plan_digest", "journal_path_sha256"], {"transaction_id": {"type": "string", "minLength": 1}, "plan_digest": SHA, "journal_path_sha256": SHA}),
    rec_schema("READ_ONLY_JOURNAL", ["journal_path_sha256"], {"journal_path_sha256": SHA}),
    rec_schema("EXCLUSIVE_SESSION_ATTESTATION", ["attested_by", "pid_observed"], {"attested_by": {"type": "string", "minLength": 1}, "pid_observed": {"type": "integer"}}),
    rec_schema("GUARD_SNAPSHOT", ["guard_digest", "project_name", "timeline_name", "payload_sha256", "snapshot_object_sha256", "guard", "method_provenance", "authority_version"], {"guard_digest": SHA, "project_name": {"type": "string"}, "timeline_name": {"type": "string"}, "payload_sha256": SHA, "snapshot_object_sha256": SHA, "guard": GUARD_OBJ_S, "method_provenance": PROV_MAP_S, "authority_version": {"type": "string"}}),
    rec_schema("PLAN_VALIDATION", ["plan_digest", "result", "authority_version", "validator", "h0_guard_digest", "h0_snapshot_sha256", "stages_completed"], {"plan_digest": SHA, "result": {"enum": ["PASS", "FAIL"]}, "authority_version": {"type": "string"}, "validator": {"type": "string"}, "h0_guard_digest": SHA_OR_NULL, "h0_snapshot_sha256": SHA_OR_NULL, "stages_completed": {"type": "array", "items": {"enum": list(L.VALIDATION_STAGES)}}}),
    rec_schema("MEDIA_CLASS_ATTESTATION", ["media_class", "media_sha256"], {"media_class": {"enum": ["SYNTHETIC", "PRODUCTION"]}, "media_sha256": SHA}),
    rec_schema("DESTINATION_TIMELINE", ["project_name", "timeline_name", "timeline_unique_id"], {"project_name": {"type": "string"}, "timeline_name": {"type": "string"}, "timeline_unique_id": {"type": "string"}}),
]
record_common = {"record_type": {"enum": sorted(L.RECORD_TYPES)}, "record_id": SHA, "envelope": envelope_s, "recorded_at": {"type": "string", "minLength": 1}}
ev_schema = S(L.EVIDENCE_SET_SCHEMA_ID, "Linked evidence set (content-addressed, envelope-bound records; v1.12 workflow-bound BUNDLE_VERIFICATION)", {"schema": {"const": L.EVIDENCE_SET_SCHEMA_ID}, "current_session_id": STR_OR_NULL, "evaluated_at": {"type": "string", "minLength": 20}, "records": {"type": "object", "propertyNames": {"pattern": "^[a-f0-9]{64}$"}, "additionalProperties": {"type": "object", "required": ["record_type", "record_id", "envelope", "recorded_at"], "properties": record_common, "allOf": RECORD_RULES}}}, ["schema", "current_session_id", "evaluated_at", "records"],
              comment="v1.6: capability evidence is a RAW_CAPABILITY_CAPTURE (facts only: mechanical outcome, typed return/exception, truncation, shim identity, binding; interpretation fields are schema-forbidden). Meaning is derived by the reference parser (authority_lib.derive_capability_result); DERIVED_CAPABILITY_RESULT is a cache that must equal the recomputation; REVIEW_DECISION binds raw+derived+parser+spec; REFREEZE_RECORD binds parent+successor matrix digest, parser, spec, probe/session and the promoted digests; GUARD_SNAPSHOT carries the whole guard object + method_provenance so H0 profile/completeness/provenance/target are proven; IDENTITY_*_OBSERVATION carry pass lists of raw capture digests with recomputed claims. The retired CAPABILITY_EVIDENCE type is rejected. Every record carries the identity envelope; record_id = sha256(domain vidtoolz.resolveEvidenceRecord.v1 + canonical body without record_id); the CURRENT record of a type is the highest envelope.sequence within current_session_id; map order is irrelevant.", extra={"$defs": PYVALUE_DEFS})
dump("schemas/resolveEvidenceSet.schema.json", ev_schema)
req_schema = load("schemas/resolveEligibilityRequest.schema.json")
req_schema["$id"] = "vidtoolz.resolveEligibilityRequest.v1.10"; req_schema["properties"]["schema"] = {"const": "vidtoolz.resolveEligibilityRequest.v1.10"}
req_schema["properties"]["plan_target"] = {"anyOf": [{"type": "object", "additionalProperties": False, "required": ["library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch"], "properties": {"library_instance_uuid": {"anyOf": [UUID, {"type": "null"}]}, "project_unique_id": STR_OR_NULL, "timeline_unique_id": STR_OR_NULL, "target_epoch": STR_OR_NULL}}, {"type": "null"}]}
dump("schemas/resolveEligibilityRequest.schema.json", req_schema)
# structurally invalid sets (schema / binding layer)
bad_prov = M.R("PROVISIONING_RECORD", level="LIBRARY", env={"library_root": None}, library_kind="Disk", root_path=F.ROOT, instance_uuid=UU, provisioned_by="Mikko")
EVSETS["invalid-provisioning-without-root"] = F.ES([bad_prov, H["bundle"], H["launch"], H["roj"]])
EVSETS["invalid-connection-wrong-manifest"] = F.ES([H["prov"], H["bundle"], H["launch"], H["roj"], M.conn(seq=2, env={"manifest_sha256": "9" * 64}), H["pb"], H["tb"]])
EVSETS["invalid-connection-other-authority"] = F.ES([H["prov"], H["bundle"], H["launch"], H["roj"], M.conn(seq=2, env={"authority_version": "1.5.0"}), H["pb"], H["tb"]])
EVSETS["invalid-bundle-other-manifest-not-historical"] = F.ES([H["prov"], M.bundle(env={"manifest_sha256": "9" * 64}, manifest_sha256="9" * 64), H["launch"], H["roj"]])
tampered = copy.deepcopy(EVSETS["attached"]); tampered["records"][H["conn"]["record_id"]]["db_name"] = "EKA"
EVSETS["invalid-tampered-record"] = tampered
legacy_ce = M.R("RAW_EVIDENCE", env={"session_id": F.S_CUR, "sequence": 5, "captured_at": F.ts(25)}, content="legacy", content_sha256=L.sha256_text("legacy")); legacy_ce["record_type"] = "CAPABILITY_EVIDENCE"; legacy_ce = L.make_record({k: v for k, v in legacy_ce.items() if k != "record_id"})
EVSETS["invalid-retired-capability-evidence-type"] = F.ES(list(EVSETS["attached"]["records"].values()) + [legacy_ce])
for name, es in EVSETS.items():
    dump(f"fixtures/evidence/{name}.json", es)

# ============================================================ SNAPSHOT v1.6: observation status; field provenance cites RAW_CAPABILITY_CAPTURE records; GUARD v3 (unchanged digest law)
def fs_schema(fields):
    return {"type": "object", "additionalProperties": False, "required": list(fields), "properties": {**{k: OBS for k in fields}, **{k + "_reason": {"type": "string", "minLength": 1} for k in fields}}}


item_common = {"unique_id": STR_OR_NULL, "observation_ordinal": NONNEG, "name": STR_OR_NULL, "start": FRAME_QTY_OR_NULL, "end": FRAME_QTY_OR_NULL, "duration": FRAME_QTY_OR_NULL, "enabled": {"type": ["boolean", "null"]}, "markers": {"type": "array"}, "identity_observed": {"enum": ["COMPLETE", "PARTIAL", "NONE"]}, "field_status": fs_schema(L.ITEM_STATUS_FIELDS), "media_pool_item_unique_id": STR_OR_NULL, "media_id": STR_OR_NULL, "source_start": FRAME_QTY_OR_NULL, "source_end": FRAME_QTY_OR_NULL}
media_backed = {"type": "object", "additionalProperties": False, "required": list(item_common) + ["provenance", "source_locator", "source_status", "source_sha256"], "properties": dict(item_common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"const": "MEDIA_BACKED"}}}, source_locator=STR_OR_NULL, source_status={"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}, source_sha256=SHA_OR_NULL)}
non_media = {"type": "object", "additionalProperties": False, "required": list(item_common) + ["provenance", "source_locator", "source_status", "source_sha256", "absence_reason"], "properties": dict(item_common, provenance={"type": "object", "additionalProperties": False, "required": ["kind"], "properties": {"kind": {"enum": ["GENERATOR", "TITLE", "COMPOUND", "ADJUSTMENT", "FUSION_OR_GENERATED", "OTHER_OBSERVED"]}}}, source_locator={"type": "null"}, source_status={"const": "NOT_APPLICABLE"}, source_sha256={"type": "null"}, absence_reason={"enum": ["NO_MEDIA_POOL_ITEM", "NO_FILE_BACKED_SOURCE", "UNOBSERVED_BY_API"]})}
marker = {"type": "object", "additionalProperties": False, "required": ["object_address", "frame", "duration", "color", "name", "note", "custom_data"], "properties": {"object_address": {"type": "string", "minLength": 1}, "frame": FRAME_QTY, "duration": FRAME_QTY, "color": {"type": "string"}, "name": {"type": "string"}, "note": {"type": "string"}, "custom_data": {"type": "string"}}}
track = {"type": "object", "additionalProperties": False, "required": ["type", "index", "name", "enabled", "locked", "field_status", "items"], "properties": {"type": {"enum": ["video", "audio", "subtitle"]}, "index": POSINT, "name": STR_OR_NULL, "enabled": {"type": ["boolean", "null"]}, "locked": {"type": ["boolean", "null"]}, "field_status": fs_schema(L.TRACK_STATUS_FIELDS), "items": {"type": "array", "items": {"oneOf": [media_backed, non_media]}}}}
coverage = {"type": "object", "additionalProperties": False, "required": ["profile", "complete", "observed_domains", "unobservable_domains", "deferred_domains", "incomplete_reasons"], "properties": {"profile": {"enum": list(L.COVERAGE_PROFILES)}, "complete": {"type": "boolean"}, "observed_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "unobservable_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "deferred_domains": {"type": "array", "items": {"enum": sorted(L.KNOWN_DOMAINS)}, "uniqueItems": True}, "incomplete_reasons": {"type": "array", "items": {"type": "string", "minLength": 1}}}}
policy_s = {"type": "object", "additionalProperties": False, "required": ["target_contract_sha256", "timebase_sha256", "track_policy_sha256", "capabilities_version", "capability_matrix_sha256", "collector_version", "canonicalization_version"], "properties": {"target_contract_sha256": SHA, "timebase_sha256": SHA, "track_policy_sha256": SHA, "capabilities_version": {"type": "string"}, "capability_matrix_sha256": SHA, "collector_version": {"type": "string"}, "canonicalization_version": {"const": "1.5"}}}
library_s = {"type": "object", "additionalProperties": False, "required": ["db_type", "db_name", "instance_uuid"], "properties": {"db_type": {"enum": ["Disk"]}, "db_name": {"type": "string", "minLength": 1}, "instance_uuid": UUID}}
obs_fail = {"type": "object", "additionalProperties": False, "required": ["track_address", "observation_ordinal", "method", "reason"], "properties": {"track_address": {"type": "string", "minLength": 1}, "observation_ordinal": {"type": ["integer", "null"]}, "method": STR_OR_NULL, "reason": {"type": "string", "minLength": 1}}}
project_s = {"type": "object", "additionalProperties": False, "required": ["unique_id", "name", "last_modified_time", "field_status"], "properties": {"unique_id": STR_OR_NULL, "name": STR_OR_NULL, "last_modified_time": {"type": ["integer", "string", "null"]}, "field_status": fs_schema(L.PROJECT_STATUS_FIELDS)}}
timeline_s = {"type": "object", "additionalProperties": False, "required": ["unique_id", "name", "start_frame", "start_timecode", "fps", "width", "height", "end_frame", "is_current", "duration_convention", "settings", "field_status"], "properties": {"unique_id": STR_OR_NULL, "name": STR_OR_NULL, "start_frame": {"type": ["integer", "null"], "minimum": 0}, "start_timecode": STR_OR_NULL, "fps": {"anyOf": [{"type": "object", "additionalProperties": False, "required": ["numerator", "denominator"], "properties": {"numerator": POSINT, "denominator": POSINT}}, {"type": "null"}]}, "width": {"type": ["integer", "null"], "minimum": 1}, "height": {"type": ["integer", "null"], "minimum": 1}, "end_frame": {"type": ["integer", "null"], "minimum": 0}, "is_current": {"type": ["boolean", "null"]}, "duration_convention": {"enum": ["UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"]}, "settings": {"type": ["object", "null"]}, "field_status": fs_schema(L.TIMELINE_STATUS_FIELDS)}}
collection_s = {"type": "object", "additionalProperties": False, "required": ["started_at", "ended_at", "generation", "stable_pair", "session_id", "method_provenance"], "properties": {"started_at": {"type": "string"}, "ended_at": {"type": "string"}, "generation": NONNEG, "stable_pair": {"type": "boolean"}, "session_id": {"type": "string", "minLength": 1}, "method_provenance": {"type": "object", "additionalProperties": PROV_ENTRY_S}}}
snap_schema = S("vidtoolz.resolveSnapshot.v1.10", "Canonical Resolve readback snapshot v1.10", {
    "schema": {"const": "vidtoolz.resolveSnapshot.v1.10"}, "collector_version": {"type": "string", "minLength": 1}, "canonicalization_version": {"const": "1.5"}, "target_epoch": {"type": "string", "minLength": 1}, "resolve_build": {"type": "string", "minLength": 1},
    "library": library_s, "project": project_s, "collection": collection_s, "coverage": coverage, "policy": policy_s,
    "payload": {"type": "object", "additionalProperties": False, "required": ["timeline", "tracks", "markers", "media_dependencies", "observation_failures"], "properties": {"timeline": timeline_s, "tracks": {"type": "array", "items": track}, "markers": {"type": "array", "items": marker}, "media_dependencies": {"type": "array", "items": {"type": "object", "required": ["logical_locator", "source_sha256", "status"], "properties": {"logical_locator": {"type": "string"}, "source_sha256": SHA_OR_NULL, "status": {"enum": ["HASHED", "UNHASHED_UNOWNED", "OFFLINE"]}}}}, "observation_failures": {"type": "array", "items": obs_fail}}},
    "payload_sha256": SHA, "guard_digest": SHA, "hash_domains": {"type": "object", "additionalProperties": False, "required": ["payload", "guard"], "properties": {"payload": {"const": "vidtoolz.resolveSnapshotPayload.v1.5"}, "guard": {"const": "vidtoolz.resolveGuard.v3"}}},
}, ["schema", "collector_version", "canonicalization_version", "target_epoch", "resolve_build", "library", "project", "collection", "coverage", "policy", "payload", "payload_sha256", "guard_digest", "hash_domains"],
    comment="v1.6: the honest observation model (OBSERVED|UNAVAILABLE|UNSUPPORTED|ERROR|NOT_REQUESTED + reason) covers timeline fields (unique_id, name, start_frame, end_frame, start_timecode, fps, width, height, is_current, settings), project fields (unique_id, name, last_modified_time), track fields (name, enabled, locked) and the ten item fields. Every value is nullable; null only when status permits; OBSERVED requires a value AND a producing primitive cited in collection.method_provenance as a QUALIFIED_OBSERVATION whose raw_capture_record_id is the RAW_CAPABILITY_CAPTURE the ACTIVE matrix promotes for that method (re-parsed to SUCCESS, reviewed ACCEPT, refrozen); CANDIDATE_OBSERVATION (probe output) never backs an OBSERVED field; occurrence unique_id must be unique within the timeline (DUPLICATE_OCCURRENCE_IDENTITY). Item properties/fades/speed/takes/links are NOT represented (PROTECTED_SURFACE_EXCLUSIONS; honest narrowing, F15-05). coverage.complete is a function of the profile's mandatory domains, item fields, timeline fields, identity, locks, guard and an empty failure ledger; otherwise incomplete_reasons must name what is missing.")
dump("schemas/resolveSnapshot.schema.json", snap_schema)
ident_s = {"type": "object", "additionalProperties": False, "required": ["unique_id", "unique_id_status", "unique_id_reason", "name", "name_status"], "properties": {"unique_id": STR_OR_NULL, "unique_id_status": OBS, "unique_id_reason": STR_OR_NULL, "name": STR_OR_NULL, "name_status": OBS}}
guard_schema = S("vidtoolz.resolveGuard.v3", "Composite pre-write / revalidation guard v3 (identity with observation status + reason; provenance binding)", {"hash_domain": {"const": "vidtoolz.resolveGuard.v3"}, "guard_version": {"const": 3}, "library": library_s, "project": ident_s, "timeline": ident_s, "target_epoch": {"type": "string"}, "coverage": coverage, "policy": policy_s, "provenance_sha256": SHA, "payload_sha256": SHA}, ["hash_domain", "guard_version", "library", "project", "timeline", "target_epoch", "coverage", "policy", "provenance_sha256", "payload_sha256"],
                 comment="Guard digest = sha256(domain vidtoolz.resolveGuard.v3 + canonical guard object). v3 carries project/timeline identity WITH observation status and reason, and provenance_sha256 = digest(collection.method_provenance, vidtoolz.resolveProvenance.v1) so the guard binds which raw captures produced the OBSERVED fields. v1.6: the GUARD_SNAPSHOT evidence record carries this whole object plus method_provenance so the pre-write evaluator recomputes both digests and proves profile/completeness/provenance/target before any mutator. Payload digest alone is never a version token.")
dump("schemas/resolveGuard.schema.json", guard_schema)
policy = {"target_contract_sha256": sha_of("TARGET-CONTRACT.json"), "timebase_sha256": sha_of("TIMEBASE.json"), "track_policy_sha256": sha_of("schemas/resolveTrackPolicy.v1.json"), "capabilities_version": "1.20.0", "capability_matrix_sha256": CAPS_SHA, "collector_version": "0.0.0-fixture", "canonicalization_version": "1.5"}
policy_hyp = dict(policy, capabilities_version="1.20.0-HYPOTHETICAL", capability_matrix_sha256=HYP_SHA)


def fst(fields, **kw):
    base = {k: "OBSERVED" for k in fields}
    base.update(kw)
    return base


def unavailable(fields, reason="not qualified on 21.1.0.0014 (no QUALIFIED_READ row)"):
    d = {}
    for k in fields:
        d[k] = "UNAVAILABLE"; d[k + "_reason"] = f"{k}: {reason}"
    return d


def item_media(uid, ordn, start, end, mp, sha=None, status="HASHED", name="clip", **kw):
    it = {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "COMPLETE", "field_status": fst(L.ITEM_STATUS_FIELDS, media_id="UNAVAILABLE", media_id_reason="GetMediaId returned None on fixture"), "provenance": {"kind": "MEDIA_BACKED"}, "media_pool_item_unique_id": mp, "media_id": None, "source_locator": f"/qual/media/{name}.png", "source_status": status, "source_sha256": sha, "source_start": 0, "source_end": end - start}
    it.update(kw)
    return it


def item_other(uid, ordn, start, end, kind, reason, name):
    return {"unique_id": uid, "observation_ordinal": ordn, "name": name, "start": start, "end": end, "duration": end - start, "enabled": True, "markers": [], "identity_observed": "PARTIAL", "field_status": fst(L.ITEM_STATUS_FIELDS, media_pool_item_unique_id="NOT_REQUESTED", media_id="NOT_REQUESTED", source_start="UNSUPPORTED", source_end="UNSUPPORTED"), "provenance": {"kind": kind}, "media_pool_item_unique_id": None, "media_id": None, "source_locator": None, "source_status": "NOT_APPLICABLE", "source_sha256": None, "absence_reason": reason, "source_start": None, "source_end": None}


def item_unobserved(ordn):
    """M0 before any qualification: enumerated by the probe's ledger only; every field UNAVAILABLE."""
    return {"unique_id": None, "observation_ordinal": ordn, "name": None, "start": None, "end": None, "duration": None, "enabled": None, "markers": [], "identity_observed": "NONE", "field_status": unavailable(L.ITEM_STATUS_FIELDS), "provenance": {"kind": "OTHER_OBSERVED"}, "media_pool_item_unique_id": None, "media_id": None, "source_locator": None, "source_status": "NOT_APPLICABLE", "source_sha256": None, "absence_reason": "UNOBSERVED_BY_API", "source_start": None, "source_end": None}


def item_partial(ordn, start, name):
    it = item_media(None, ordn, start, start, None, None, "UNHASHED_UNOWNED", name)
    it.update(end=None, duration=None, enabled=None, source_start=None, source_end=None, source_locator=None, identity_observed="NONE", field_status=fst(L.ITEM_STATUS_FIELDS, **unavailable(("unique_id", "end", "duration", "enabled", "media_pool_item_unique_id", "source_start", "source_end"), "getter not callable in this session"), media_id="NOT_REQUESTED"))
    return it


def trk(typ, idx, name, items, enabled=True, locked=False, observed=True):
    if observed:
        return {"type": typ, "index": idx, "name": name, "enabled": enabled, "locked": locked, "field_status": fst(L.TRACK_STATUS_FIELDS), "items": items}
    return {"type": typ, "index": idx, "name": None, "enabled": None, "locked": None, "field_status": unavailable(L.TRACK_STATUS_FIELDS), "items": items}


FULL_COV = {"profile": "FULL_TIMELINE_READ", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings", "adapter_bin_media"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "track_locks", "item_identity"], "incomplete_reasons": []}
WP_COV = {"profile": "WRITE_PRECHECK", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"], "incomplete_reasons": []}
RAWREC_ID = {r["capture"]["method"]: r["record_id"] for r in H["raws_ok"]}
HYP_PROV = {m: {"observation_class": "QUALIFIED_OBSERVATION", "raw_capture_record_id": RAWREC_ID[m], "capability_matrix_sha256": HYP_SHA} for m in PROBE_METHODS}
FROZEN_PROV = {m: {"observation_class": "NOT_CALLABLE", "raw_capture_record_id": None, "capability_matrix_sha256": None} for m in PROBE_METHODS}
CANDIDATE_PROV = {m: {"observation_class": "CANDIDATE_OBSERVATION", "raw_capture_record_id": RAWREC_ID[m], "capability_matrix_sha256": None} for m in PROBE_METHODS}


def make_snapshot(tracks, markers=None, coverage_=None, convention="UNQUALIFIED", failures=None, timeline_observed=True, project_observed=True, policy_=None, prov=None, epoch="epoch-fixture-1", session=F.S_CUR):
    if timeline_observed:
        tl = {"unique_id": "tl-fixture-0001", "name": TL, "start_frame": 108000, "start_timecode": "01:00:00:00", "fps": {"numerator": 30, "denominator": 1}, "width": 1080, "height": 1920, "end_frame": 114756, "is_current": True, "duration_convention": convention, "settings": {"useCustomSettings": "1", "timelineFrameRate": "30"}, "field_status": fst(L.TIMELINE_STATUS_FIELDS)}
    else:
        tl = {"unique_id": None, "name": None, "start_frame": None, "start_timecode": None, "fps": None, "width": None, "height": None, "end_frame": None, "is_current": None, "duration_convention": convention, "settings": None, "field_status": unavailable(L.TIMELINE_STATUS_FIELDS)}
    payload = L.normalize_snapshot_payload({"timeline": tl, "tracks": tracks, "markers": markers or [], "media_dependencies": [], "observation_failures": failures or []})
    proj = {"unique_id": "proj-fixture-0001", "name": PROJ, "last_modified_time": None, "field_status": fst(L.PROJECT_STATUS_FIELDS, last_modified_time="NOT_REQUESTED")} if project_observed else {"unique_id": None, "name": None, "last_modified_time": None, "field_status": unavailable(L.PROJECT_STATUS_FIELDS)}
    snap = {"schema": "vidtoolz.resolveSnapshot.v1.10", "collector_version": "0.0.0-fixture", "canonicalization_version": "1.5", "target_epoch": epoch, "resolve_build": VER, "library": {"db_type": "Disk", "db_name": LIB, "instance_uuid": UU}, "project": proj, "collection": {"started_at": "2026-09-08T11:50:00Z", "ended_at": "2026-09-08T11:50:01Z", "generation": 1, "stable_pair": True, "session_id": session, "method_provenance": copy.deepcopy(prov if prov is not None else HYP_PROV)}, "coverage": copy.deepcopy(coverage_ or FULL_COV), "policy": policy_ or policy_hyp, "payload": payload, "hash_domains": {"payload": "vidtoolz.resolveSnapshotPayload.v1.5", "guard": "vidtoolz.resolveGuard.v3"}}
    snap["payload_sha256"] = L.snapshot_payload_digest(payload)
    snap["guard_digest"] = L.guard_digest(snap)
    return snap


def resign(d):
    d["payload_sha256"] = L.snapshot_payload_digest(d["payload"]); d["guard_digest"] = L.guard_digest(d)
    return d


sha_a = hashlib.sha256(b"fixture-a").hexdigest()
human_tl = [
    trk("video", 1, "V1", [item_media("it-1", 0, 108000, 108347, "mp-1", sha_a, "HASHED", "still-001"), item_other("it-2", 1, 108347, 108694, "TITLE", "NO_FILE_BACKED_SOURCE", "Text+"), item_media("it-3", 2, 108694, 109174, "mp-2", None, "UNHASHED_UNOWNED", "human-broll"), item_other("it-4", 3, 109174, 109654, "GENERATOR", "NO_MEDIA_POOL_ITEM", "Solid Color"), item_other("it-5", 4, 109654, 109924, "COMPOUND", "NO_FILE_BACKED_SOURCE", "Compound Clip 1"), item_media("it-6", 5, 109924, 110194, "mp-3", None, "OFFLINE", "missing-media")]),
    trk("video", 2, "V2", [item_other("it-7", 0, 108000, 108694, "ADJUSTMENT", "NO_MEDIA_POOL_ITEM", "Adjustment Clip"), item_other("it-8", 1, 108694, 109174, "FUSION_OR_GENERATED", "UNOBSERVED_BY_API", "Fusion Composition")]),
    trk("audio", 1, "A1", [item_media("it-9", 0, 108000, 114756, "mp-4", hashlib.sha256(b"narr").hexdigest(), "HASHED", "narration")]),
]
snap_pos = make_snapshot(human_tl, markers=[{"object_address": "timeline", "frame": 108000, "duration": 1, "color": "Blue", "name": "draft-still-001", "note": "", "custom_data": "vidtoolz:resolve:binding:v1:epoch-fixture-1:b-001:o-1"}])
dump("fixtures/snapshot/human-timeline-mixed-provenance.json", snap_pos)
SX_HYP = {"capabilities": "fixtures/eligibility/capabilities-hypothetical-refreeze.json", "evidence_set": "attached-reviewed-evidence"}
SX_FROZEN = {"capabilities": "CAPABILITIES.json", "evidence_set": "attached"}
fixture("snapshot-human-timeline-full-read", "none", "resolveSnapshot", snap_pos, check="semantic_snapshot", extra=SX_HYP)
fixture("snapshot-full-read-claimed-under-frozen-matrix", "snapshot", "resolveSnapshot", snap_pos, check="semantic_snapshot", expect_contains="not callable", extra=SX_FROZEN)
# M0 before any qualification (zero QUALIFIED_READ rows): nothing callable, so the degraded capture may contain ONLY the
# connection/library domains (from the session's CONNECTION_OBSERVATION); project/timeline fields UNAVAILABLE with reason;
# no tracks, items or markers (probe output is never snapshot content); honest complete:false. This is the only legal
# SNAPSHOT_CAPTURE output before a reviewed refreeze and it is never a plan H0.
M0_COV = {"profile": "MINIMAL_M0", "complete": False, "observed_domains": ["connection", "library"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"], "incomplete_reasons": ["no read primitive is QUALIFIED_READ under the active capability authority (v1.5): project/timeline fields UNAVAILABLE; tracks/items/markers not enumerated", "mandatory domains project, timeline not observed"]}
m0_snap = make_snapshot([], coverage_=M0_COV, timeline_observed=False, project_observed=False, policy_=policy, prov=FROZEN_PROV)
dump("fixtures/snapshot/m0-minimal-nothing-qualified.json", m0_snap)
fixture("snapshot-m0-minimal-nothing-qualified-honest", "none", "resolveSnapshot", m0_snap, check="semantic_snapshot", extra=SX_FROZEN)
# M0 minimal with hypothetical qualification: identities observed, complete
m0_complete = make_snapshot([trk("video", 1, "V1", [item_media("it-1", 0, 108000, 108347, "mp-1", sha_a)])], coverage_={"profile": "MINIMAL_M0", "complete": True, "observed_domains": ["connection", "library", "project", "timeline", "tracks", "items"], "unobservable_domains": ["grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves"], "deferred_domains": ["item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"], "incomplete_reasons": []})
fixture("snapshot-m0-minimal-complete-qualified", "none", "resolveSnapshot", m0_complete, check="semantic_snapshot", extra=SX_HYP)
# partial item under qualified matrix but one getter failed at runtime (ERROR) + one element that could not be enumerated (ledger) -> honest incomplete
part = copy.deepcopy(human_tl); part[0]["items"].append(dict(item_partial(9, 113000, "p"), field_status=dict(item_partial(9, 113000, "p")["field_status"], end="ERROR", end_reason="GetEnd raised RuntimeError on this item")))
snap_partial = make_snapshot(part, coverage_=dict(FULL_COV, complete=False, incomplete_reasons=["item video:1#9 end ERROR (GetEnd raised)", "item video:1#9 identity UNAVAILABLE", "observation_failures: video:1 ordinal 10 GetItemListInTrack element raised"]), failures=[{"track_address": "video:1", "observation_ordinal": 10, "method": "GetItemListInTrack", "reason": "element 10 raised on attribute access; recorded in ledger, not fabricated"}])
dump("fixtures/snapshot/full-read-partial-item-ledger.json", snap_partial)
fixture("snapshot-full-read-partial-item-honest", "none", "resolveSnapshot", snap_partial, check="semantic_snapshot", extra=SX_HYP)
# degraded timeline observation: GetStartFrame NOT callable under an otherwise qualified matrix (evidence set lacks its record)
SX_HYP_NO_SF = {"capabilities": "fixtures/eligibility/capabilities-hypothetical-refreeze.json", "evidence_set": "attached-reviewed-evidence-minus-getstartframe"}
deg = copy.deepcopy(snap_pos)
deg["payload"]["timeline"].update(start_frame=None); deg["payload"]["timeline"]["field_status"].update(start_frame="UNAVAILABLE", start_frame_reason="GetStartFrame not QUALIFIED_CALLABLE in this session (no linked reviewed CAPABILITY_EVIDENCE)")
deg["collection"]["method_provenance"]["GetStartFrame"] = {"observation_class": "NOT_CALLABLE", "raw_capture_record_id": None, "capability_matrix_sha256": None}
deg["coverage"].update(complete=False, incomplete_reasons=["timeline.start_frame UNAVAILABLE (GetStartFrame not callable)"]); resign(deg)
dump("fixtures/snapshot/full-read-degraded-start-frame.json", deg)
fixture("snapshot-degraded-start-frame-unavailable-honest", "none", "resolveSnapshot", deg, check="semantic_snapshot", extra=SX_HYP_NO_SF)
fixture("snapshot-degraded-start-frame-claimed-observed", "snapshot", "resolveSnapshot", snap_pos, check="semantic_snapshot", expect_contains="timeline.start_frame: OBSERVED but producing primitive", extra=SX_HYP_NO_SF)
deg2 = copy.deepcopy(deg); deg2["payload"]["timeline"].update(start_frame=108000); resign(deg2)
fixture("snapshot-degraded-start-frame-value-with-unavailable", "snapshot", "resolveSnapshot", deg2, check="semantic_snapshot", expect_contains="fabrication", extra=SX_HYP_NO_SF)
deg3 = copy.deepcopy(deg); deg3["coverage"].update(complete=True, incomplete_reasons=[]); resign(deg3)
fixture("snapshot-degraded-start-frame-claims-complete", "snapshot", "resolveSnapshot", deg3, check="semantic_snapshot", expect_contains="unresolved timeline fields", extra=SX_HYP_NO_SF)
wp_tracks = copy.deepcopy(human_tl)
for t in wp_tracks:
    t["items"] = [it for it in t["items"] if it["provenance"]["kind"] == "MEDIA_BACKED"]
    for it in t["items"]:
        it["field_status"]["media_id"] = "OBSERVED"; it["field_status"].pop("media_id_reason", None); it["media_id"] = "mid-" + it["unique_id"]
wp_snap = make_snapshot(wp_tracks, coverage_=WP_COV)
dump("fixtures/snapshot/write-precheck-complete.json", wp_snap)
fixture("snapshot-write-precheck-complete", "none", "resolveSnapshot", wp_snap, check="semantic_snapshot", extra=SX_HYP)


def sneg(name, mut, expect, layer="snapshot", base=None, extra=None):
    d = copy.deepcopy(base or snap_pos); mut(d)
    if layer != "schema":
        try:
            resign(d)
        except L.CanonError:
            pass
    fixture(name, layer, "resolveSnapshot", d, check="semantic_snapshot" if layer != "schema" else None, expect_contains=expect, extra=extra or SX_HYP)


def _it(d, t=0, i=0):
    return d["payload"]["tracks"][t]["items"][i]


TLN = lambda d: d["payload"]["timeline"]  # noqa: E731
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
sneg("snapshot-timeline-start-frame-null-observed", lambda d: TLN(d).update(start_frame=None), "timeline.start_frame: status OBSERVED but value null")
sneg("snapshot-timeline-width-value-with-unavailable", lambda d: TLN(d)["field_status"].update(width="UNAVAILABLE", width_reason="x"), "fabrication")
sneg("snapshot-timeline-identity-null-observed", lambda d: TLN(d).update(unique_id=None), "timeline.unique_id: status OBSERVED but value null")
sneg("snapshot-timeline-settings-unavailable-without-reason", lambda d: (TLN(d).update(settings=None), TLN(d)["field_status"].update(settings="UNAVAILABLE")), "requires a reason")
sneg("snapshot-timeline-missing-field-status", lambda d: TLN(d).pop("field_status"), "field_status", "schema")
sneg("snapshot-project-identity-null-observed", lambda d: d["project"].update(unique_id=None), "project.unique_id: status OBSERVED but value null")
sneg("snapshot-project-identity-value-with-unavailable", lambda d: d["project"]["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x"), "fabrication")
sneg("snapshot-track-lock-value-with-unavailable", lambda d: d["payload"]["tracks"][0]["field_status"].update(locked="UNAVAILABLE", locked_reason="x"), "fabrication")
sneg("snapshot-end-before-start", lambda d: _it(d).update(end=_it(d)["start"] - 1), "end < start")
sneg("snapshot-duration-contradiction", lambda d: _it(d).update(duration=999), "duration inconsistent")
sneg("snapshot-source-bounds-inverted", lambda d: _it(d).update(source_end=0, source_start=5), "source_end < source_start")
sneg("snapshot-timeline-end-before-start", lambda d: TLN(d).update(end_frame=100), "end_frame < start_frame")
sneg("snapshot-missing-ordinal", lambda d: _it(d).pop("observation_ordinal"), "oneOf", "schema")
sneg("snapshot-negative-frame", lambda d: _it(d).update(start=-5), "oneOf", "schema")
sneg("snapshot-postgres-library", lambda d: d["library"].update(db_type="PostgreSQL"), "Disk", "schema")
fixture("snapshot-guard-context-changed-raw", "snapshot", "resolveSnapshot", dict(snap_pos, project=dict(snap_pos["project"], unique_id="proj-OTHER")), check="semantic_snapshot", expect_contains="guard_digest", extra=SX_HYP)
sneg("snapshot-incomplete-without-reasons", lambda d: d["coverage"].update(complete=False, incomplete_reasons=[]), "incomplete_reasons")
sneg("snapshot-incomplete-nothing-missing-named", lambda d: d["coverage"].update(complete=False, incomplete_reasons=["vibes"], unobservable_domains=[], deferred_domains=[]), "name missing")
sneg("snapshot-complete-with-incomplete-reasons", lambda d: d["coverage"].update(incomplete_reasons=["stray"]), "incomplete_reasons listed")
sneg("snapshot-complete-with-partial-item-full-profile", lambda d: d["payload"]["tracks"][0]["items"].append(item_partial(9, 113000, "p")), "unresolved item fields")
sneg("snapshot-complete-with-unresolved-timeline-fields", lambda d: (TLN(d).update(start_frame=None, end_frame=None), TLN(d)["field_status"].update(start_frame="UNAVAILABLE", start_frame_reason="GetStartFrame not callable", end_frame="UNAVAILABLE", end_frame_reason="GetEndFrame not callable")), "unresolved timeline fields")
sneg("snapshot-complete-with-observation-failures", lambda d: d["payload"].update(observation_failures=[{"track_address": "video:1", "observation_ordinal": 7, "method": "GetItemListInTrack", "reason": "raised"}]), "observation_failures present")
sneg("snapshot-full-profile-timeline-identity-unavailable-complete", lambda d: (TLN(d).update(unique_id=None), TLN(d)["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x")), "timeline.unique_id not OBSERVED")
sneg("snapshot-observed-field-without-callable-primitive", lambda d: None, "not callable", extra={"capabilities": "fixtures/eligibility/capabilities-hypothetical-refreeze.json", "evidence_set": "attached-evidence-wrong-build"})
sneg("snapshot-claims-callable-not-in-authority", lambda d: d["collection"]["method_provenance"].update(GetStart={"observation_class": "QUALIFIED_OBSERVATION", "raw_capture_record_id": RAWREC_ID["GetStart"], "capability_matrix_sha256": CAPS_SHA}), "claims GetStart QUALIFIED_OBSERVATION", base=m0_snap, extra=SX_FROZEN)
# field provenance law (v1.5): OBSERVED needs qualifying, cited capability evidence
sneg("snapshot-observed-without-provenance-entry", lambda d: d["collection"]["method_provenance"].pop("GetStartFrame"), "has no entry")
sneg("snapshot-observed-backed-by-candidate-observation", lambda d: d["collection"]["method_provenance"].update(GetStartFrame=CANDIDATE_PROV["GetStartFrame"]), "candidate/probe output is never OBSERVED")
sneg("snapshot-provenance-cites-unreviewed-evidence", lambda d: None, "not QUALIFIED_CALLABLE", extra={"capabilities": HYP, "evidence_set": "attached-candidate-evidence-unreviewed"})
sneg("snapshot-provenance-cites-adjacent-getter", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(raw_capture_record_id=RAWREC_ID["GetEndFrame"]), "adjacent getter")
sneg("snapshot-provenance-matrix-not-active", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(capability_matrix_sha256="0" * 64), "not the active matrix")
sneg("snapshot-provenance-evidence-not-in-set", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(raw_capture_record_id="1" * 64), "does not resolve")
sneg("snapshot-provenance-qualified-without-evidence-id", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(raw_capture_record_id=None), "requires raw_capture_record_id")
sneg("snapshot-provenance-unknown-class", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(observation_class="TRUSTED"), "enum", "schema")
sneg("snapshot-missing-method-provenance", lambda d: d["collection"].pop("method_provenance"), "method_provenance", "schema")
def prov_of(set_name):
    """Provenance map citing the RAW captures that exist in that evidence set (so the rejection is about qualification, not resolution)."""
    ids = {r["capture"]["method"]: r["record_id"] for r in EVSETS[set_name]["records"].values() if r["record_type"] == "RAW_CAPABILITY_CAPTURE"}
    return {m: {"observation_class": "QUALIFIED_OBSERVATION", "raw_capture_record_id": ids.get(m, RAWREC_ID[m]), "capability_matrix_sha256": HYP_SHA} for m in PROBE_METHODS}


sneg("snapshot-provenance-cites-failed-evidence", lambda d: d["collection"].update(method_provenance=prov_of("attached-evidence-raised-fake-parse-block")), "not QUALIFIED_CALLABLE", extra={"capabilities": HYP, "evidence_set": "attached-evidence-raised-fake-parse-block"})
sneg("snapshot-provenance-cites-raised-accepted-evidence", lambda d: d["collection"].update(method_provenance=prov_of("attached-evidence-raised-accepted")), "not QUALIFIED_CALLABLE", extra={"capabilities": HYP, "evidence_set": "attached-evidence-raised-accepted"})
sneg("snapshot-provenance-cites-other-capture-than-promoted", lambda d: d["collection"]["method_provenance"]["GetStartFrame"].update(raw_capture_record_id=next(r["record_id"] for r in EVSETS["attached-evidence-derived-cache-forged"]["records"].values() if r["record_type"] == "RAW_CAPABILITY_CAPTURE" and r["capture"]["method"] == "GetStartFrame")), "not QUALIFIED_CALLABLE", extra={"capabilities": HYP, "evidence_set": "attached-evidence-derived-cache-forged"})
sneg("snapshot-provenance-under-forged-matrix-digest", lambda d: None, "provenance: CAPABILITY_MATRIX_NOT_ACTIVE", extra={"capabilities": HYP, "evidence_set": "attached-reviewed-evidence", "forge_matrix": True})
# candidate snapshot: probe-session capture may cite CANDIDATE_OBSERVATION only while every field it would back is UNAVAILABLE
cand = copy.deepcopy(m0_snap); cand["collection"]["method_provenance"] = copy.deepcopy(CANDIDATE_PROV); resign(cand)
fixture("snapshot-candidate-observation-honest-unavailable", "none", "resolveSnapshot", cand, check="semantic_snapshot", extra={"capabilities": "CAPABILITIES.json", "evidence_set": "attached-candidate-evidence-unreviewed"})
# occurrence identity uniqueness (v1.5): duplicate OBSERVED unique_id is a semantic error in any input order
dup = copy.deepcopy(snap_pos); dup["payload"]["tracks"][0]["items"][2]["unique_id"] = "it-1"; resign(dup)
fixture("snapshot-duplicate-occurrence-identity", "snapshot", "resolveSnapshot", dup, check="semantic_snapshot", expect_contains="DUPLICATE_OCCURRENCE_IDENTITY", extra=SX_HYP)
dup_rev = copy.deepcopy(dup); dup_rev["payload"]["tracks"][0]["items"].reverse(); dup_rev["payload"]["tracks"].reverse(); resign(dup_rev)
fixture("snapshot-duplicate-occurrence-identity-reversed-order", "snapshot", "resolveSnapshot", dup_rev, check="semantic_snapshot", expect_contains="DUPLICATE_OCCURRENCE_IDENTITY", extra=SX_HYP)
dup_x = copy.deepcopy(snap_pos); dup_x["payload"]["tracks"][2]["items"][0]["unique_id"] = "it-1"; resign(dup_x)
fixture("snapshot-duplicate-occurrence-identity-across-tracks", "snapshot", "resolveSnapshot", dup_x, check="semantic_snapshot", expect_contains="DUPLICATE_OCCURRENCE_IDENTITY", extra=SX_HYP)
sneg("snapshot-m0-domain-observed-without-callable", lambda d: d["coverage"].update(observed_domains=["connection", "library", "tracks"]), "domain tracks observed but producing primitive", base=m0_snap, extra=SX_FROZEN)
sneg("snapshot-m0-complete-claimed-nothing-qualified", lambda d: d["coverage"].update(complete=True, incomplete_reasons=[]), "mandatory domains", base=m0_snap, extra=SX_FROZEN)
sneg("snapshot-m0-timeline-frames-observed-nothing-qualified", lambda d: (TLN(d).update(start_frame=108000, end_frame=114756), TLN(d)["field_status"].update(start_frame="OBSERVED", end_frame="OBSERVED")), "not callable", base=m0_snap, extra=SX_FROZEN)
sneg("snapshot-m0-track-observed-nothing-qualified", lambda d: d["payload"].update(tracks=[trk("video", 1, "V1", [])]), "not callable", base=m0_snap, extra=SX_FROZEN)
sneg("snapshot-write-precheck-null-lock", lambda d: (d["payload"]["tracks"][0].update(locked=None), d["payload"]["tracks"][0]["field_status"].update(locked="UNAVAILABLE", locked_reason="x")), "unresolved track locks", base=wp_snap)
sneg("snapshot-write-precheck-project-id-unavailable", lambda d: (d["project"].update(unique_id=None), d["project"]["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x")), "project.unique_id not OBSERVED", base=wp_snap)
sneg("snapshot-write-precheck-item-id-unavailable", lambda d: (_it(d).update(unique_id=None), _it(d)["field_status"].update(unique_id="UNAVAILABLE", unique_id_reason="x")), "unresolved item fields", base=wp_snap)
sneg("snapshot-write-precheck-timecode-unavailable", lambda d: (TLN(d).update(start_timecode=None), TLN(d)["field_status"].update(start_timecode="UNAVAILABLE", start_timecode_reason="x")), "unresolved timeline fields", base=wp_snap)
sneg("snapshot-write-precheck-missing-guard-domain", lambda d: d["coverage"].update(observed_domains=[x for x in d["coverage"]["observed_domains"] if x != "guard"]), "mandatory domains", base=wp_snap)
# guard v2: UNAVAILABLE vs ERROR identity are distinct guards
g_unavail = copy.deepcopy(m0_snap); g_error = copy.deepcopy(m0_snap)
g_error["project"]["field_status"].update(unique_id="ERROR", unique_id_reason="Project.GetUniqueId raised"); resign(g_error)
snap_b = copy.deepcopy(snap_pos); snap_b["project"]["unique_id"] = "proj-fixture-0002"; resign(snap_b)
g_prov = copy.deepcopy(snap_pos); g_prov["collection"]["method_provenance"]["GetStartFrame"] = dict(HYP_PROV["GetStartFrame"], capability_matrix_sha256=CAPS_SHA); resign(g_prov)
dump("fixtures/guard/guard-vectors.json", {"purpose": "payload digest alone does not prove target context; identity observation status and reason are part of the guard; provenance authority is part of the guard (v3)", "provenance_changes_guard": {"payload_sha256_equal": snap_pos["payload_sha256"] == g_prov["payload_sha256"], "guard_digest_equal": snap_pos["guard_digest"] == g_prov["guard_digest"]}, "same_payload_different_project": {"payload_sha256_equal": snap_pos["payload_sha256"] == snap_b["payload_sha256"], "guard_digest_equal": snap_pos["guard_digest"] == snap_b["guard_digest"]}, "unavailable_vs_error_identity": {"payload_sha256_equal": g_unavail["payload_sha256"] == g_error["payload_sha256"], "guard_digest_equal": g_unavail["guard_digest"] == g_error["guard_digest"], "a_status": "UNAVAILABLE", "b_status": "ERROR"}, "guard_a": snap_pos["guard_digest"], "guard_b": snap_b["guard_digest"]})
fixture("snapshot-m0-project-identity-error-honest", "none", "resolveSnapshot", g_error, check="semantic_snapshot", extra=SX_FROZEN)
# v1.6 (F15-05): item properties are NOT representable in the snapshot; a property payload is schema-invalid, never silently accepted
sneg("snapshot-item-property-payload-unrepresentable", lambda d: _it(d).update(properties={"Opacity": 100}), "oneOf", "schema")
sneg("snapshot-observed-domain-item-properties-excluded", lambda d: d["coverage"]["observed_domains"].append("item_properties"), "PROTECTED_SURFACE_EXCLUSIONS", extra=SX_HYP)

# ============================================================ CANONICALIZATION VECTORS v1.5
vectors = []
PD = "vidtoolz.resolveSnapshotPayload.v1.5"


def vec(name, obj, domain="vidtoolz.resolveGeneric.v1", normalize=None, note=None):
    o = normalize(obj) if normalize else obj
    c = L.canon(o)
    vectors.append({"name": name, "note": note, "input": obj, "domain": domain, "canonical_utf8": c, "canonical_byte_length": len(c.encode("utf-8")), "sha256": L.digest(o, domain)})


vec("empty_object", {})
vec("key_order_codepoint", {"b": 1, "a": 2, "B": 3, "ä": 4, "aa": 5})
vec("string_escapes", {"s": "quote\" back\\ tab\t nl\n cr\r del slash/ emoji\U0001F600 ä"})
vec("integers_and_tagged", {"frames": 6756, "ms": 225183, "zero": 0, "neg": -17, "fps": {"$rational": "30/1"}, "gain": {"$f64": "3ff0000000000000"}})
vec("f64_one_canonical_form_positive_zero", {"z": {"$f64": "0000000000000000"}})
base_tl = m0_snap["payload"]["timeline"]
tr_ = lambda typ, idx: trk(typ, idx, f"{typ}{idx}", [])  # noqa: E731
P = lambda tracks, markers=None: {"timeline": base_tl, "tracks": tracks, "markers": markers or [], "media_dependencies": [], "observation_failures": []}  # noqa: E731
vec("numeric_track_index_2_before_10", P([tr_("video", 10), tr_("video", 2)]), PD, L.normalize_snapshot_payload)
vec("track_type_order_video_audio_subtitle", P([tr_("subtitle", 1), tr_("audio", 1), tr_("video", 1)]), PD, L.normalize_snapshot_payload)
mk = lambda addr, frame, dur, cd, name, color, note: {"object_address": addr, "frame": frame, "duration": dur, "custom_data": cd, "name": name, "color": color, "note": note}  # noqa: E731
markers_a = [mk("timeline", 10, 1, "", "m", "Blue", "second"), mk("timeline", 5, 1, "", "m", "Blue", ""), mk("item:it-1", 5, 3, "", "m", "Blue", ""), mk("timeline", 7, 2, "vidtoolz:x", "a", "Red", "n1")]
vec("markers_total_order_A", P([], markers_a), PD, L.normalize_snapshot_payload)
vec("markers_total_order_B_reversed_same_digest", P([], list(reversed(markers_a))), PD, L.normalize_snapshot_payload)
perm_a = copy.deepcopy(human_tl); perm_b = list(reversed(copy.deepcopy(human_tl)))
for t in perm_b:
    t["items"] = list(reversed(t["items"]))
vec("permutation_invariance_A", P(perm_a), PD, L.normalize_snapshot_payload)
vec("permutation_invariance_B_same_digest", P(perm_b), PD, L.normalize_snapshot_payload)
same_frame = P([trk("video", 1, "V1", [item_other("z-id", 2, 5, 9, "TITLE", "NO_FILE_BACKED_SOURCE", "t"), item_media("a-id", 1, 5, 9, "mp", None, "UNHASHED_UNOWNED", "m"), item_media("b-id", 0, 5, 7, "mp", None, "UNHASHED_UNOWNED", "n")])])
vec("same_frame_items_deterministic", same_frame, PD, L.normalize_snapshot_payload)
partial_mix = P([trk("video", 1, None, [item_partial(3, 20, "p3"), item_unobserved(0), item_partial(1, 20, "p1"), item_partial(2, 5, "p2")], observed=False)])
partial_mix_rev = copy.deepcopy(partial_mix); partial_mix_rev["tracks"][0]["items"].reverse()
vec("partial_items_status_aware_order_A", partial_mix, PD, L.normalize_snapshot_payload)
vec("partial_items_status_aware_order_B_same_digest", partial_mix_rev, PD, L.normalize_snapshot_payload)
vec("unobserved_timeline_all_null_with_status", P([]), PD, L.normalize_snapshot_payload, "a timeline with every field UNAVAILABLE is representable and hashable")
vec("nullable_fields_explicit_null", {"media_id": None, "source_sha256": None, "source_locator": None})
dump("fixtures/canonicalization/vectors.json", {"schema": "vidtoolz.resolveCanonicalizationVectors.v1.10", "spec": "CANONICALIZATION.md v1.10", "digest_rule": "sha256(utf8(domain) + 0x0A + canonical_bytes)", "registered_domains": sorted(L.HASH_DOMAINS), "reference_implementation": "tools/authority_lib.py", "vectors": vectors})
F64_BAD = [("f64_trailing_newline", "3ff0000000000000\n"), ("f64_leading_space", " 3ff0000000000000"), ("f64_trailing_space", "3ff0000000000000 "), ("f64_trailing_tab", "3ff0000000000000\t"), ("f64_leading_tab", "\t3ff0000000000000"), ("f64_crlf", "3ff0000000000000\r\n"), ("f64_uppercase", "3FF0000000000000"), ("f64_mixed_case", "3fF0000000000000"), ("f64_short", "3ff"), ("f64_fifteen", "3ff000000000000"), ("f64_long", "3ff00000000000000"), ("f64_not_hex", "NOT_HEX_NOT_HEX_"), ("f64_prefix_0x", "0x3ff000000000000"), ("f64_unicode_digit", "3ff000000000000١"), ("f64_empty", ""), ("f64_nonstring", 12345)]
cases = [{"name": n, "kind": "canon", "input": {"$f64": v}, "expect": "$f64"} for n, v in F64_BAD]
cases += [{"name": "f64_nan", "kind": "canon", "input": {"$f64": "7ff8000000000000"}, "expect": "NaN"}, {"name": "f64_nan_payload", "kind": "canon", "input": {"$f64": "fff8000000000001"}, "expect": "NaN"}, {"name": "f64_infinity", "kind": "canon", "input": {"$f64": "7ff0000000000000"}, "expect": "NaN"}, {"name": "f64_negative_infinity", "kind": "canon", "input": {"$f64": "fff0000000000000"}, "expect": "NaN"}, {"name": "f64_negative_zero", "kind": "canon", "input": {"$f64": "8000000000000000"}, "expect": "negative zero"}]
cases += [{"name": "rational_unreduced", "kind": "canon", "input": {"$rational": "2/4"}, "expect": "reduced"}, {"name": "rational_zero_denominator", "kind": "canon", "input": {"$rational": "1/0"}, "expect": "$rational"}, {"name": "rational_negative", "kind": "canon", "input": {"$rational": "-1/2"}, "expect": "$rational"}, {"name": "rational_trailing_newline", "kind": "canon", "input": {"$rational": "30/1\n"}, "expect": "$rational"}, {"name": "rational_leading_space", "kind": "canon", "input": {"$rational": " 30/1"}, "expect": "$rational"}, {"name": "rational_leading_zero", "kind": "canon", "input": {"$rational": "030/1"}, "expect": "$rational"}]
cases += [{"name": "bare_float", "kind": "canon", "input": {"x": 1.5}, "expect": "bare float"}, {"name": "marker_exact_duplicate", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", ""), mk("timeline", 5, 1, "", "m", "Blue", "")], "expect": "MARKER_COLLISION"}, {"name": "marker_same_object_frame_different_note", "kind": "markers", "input": [mk("timeline", 5, 1, "", "m", "Blue", "a"), mk("timeline", 5, 1, "", "m", "Blue", "b")], "expect": "MARKER_COLLISION"}, {"name": "string_track_index", "kind": "tracks", "input": [{"type": "video", "index": "2"}], "expect": "integer"}, {"name": "duplicate_track_address", "kind": "tracks", "input": [{"type": "video", "index": 1}, {"type": "video", "index": 1}], "expect": "duplicate"}, {"name": "unregistered_domain", "kind": "domain", "input": {}, "domain": "vidtoolz.unregistered", "expect": "unregistered"}, {"name": "unregistered_domain_old_guard_v1", "kind": "domain", "input": {}, "domain": "vidtoolz.resolveGuard.v1", "expect": "unregistered"}, {"name": "unregistered_domain_old_guard_v2", "kind": "domain", "input": {}, "domain": "vidtoolz.resolveGuard.v2", "expect": "unregistered"}, {"name": "unregistered_domain_old_payload_v1_4", "kind": "domain", "input": {}, "domain": "vidtoolz.resolveSnapshotPayload.v1.4", "expect": "unregistered"}, {"name": "items_missing_ordinal", "kind": "items", "input": [{"start": 1, "end": 2, "provenance": {"kind": "TITLE"}}], "expect": "observation_ordinal"}, {"name": "items_duplicate_ordinal", "kind": "items", "input": [item_partial(1, 5, "a"), item_partial(1, 5, "b")], "expect": "collision"}, {"name": "items_observed_end_null_in_sort", "kind": "items", "input": [dict(item_media("x", 0, 5, 9, None, None, "UNHASHED_UNOWNED", "m"), end=None)], "expect": "numeric"}]
dump("fixtures/canonicalization/rejections.json", {"schema": "vidtoolz.resolveCanonicalizationRejections.v1.10", "cases": cases})

# ============================================================ PERMISSIONS v1.5 (unchanged law; schema/version bump) + ELIGIBILITY cases
perms = load("PERMISSIONS.json")
perms["schema"] = "vidtoolz.resolvePermissions.v1.10"; perms["version"] = "1.20.0"
perms["law"] = "PERMISSION DECLARATION (allowed:true) != AUTHORIZATION ELIGIBILITY. Eligibility is evaluated deterministically by authority_lib.evaluate_eligibility_authorizing(perms, request, read_primitives, capabilities, target_contract, GovernedEvidenceSet, active_authority) - or evaluate_eligibility_for_session(session_id, ...), which loads through load_governed_evidence_set itself. authority_lib.evaluate_eligibility(..., evidence_set, ...) is DIAGNOSTIC / NON_AUTHORIZING (v1.14 V113-B1) and must never be selected for an authority decision. Under the authorizing gate: attachment state, primitive qualification and every prerequisite are DERIVED from the frozen authorities plus envelope-bound, content-addressed evidence records of the CURRENT session bound to the ACTIVE reviewed manifest; record order never matters; contradictory evidence is CONFLICT; unknown or unlinked input fails closed"
dump("PERMISSIONS.json", perms)
perm_schema = load("schemas/resolvePermissions.schema.json")
perm_schema["$id"] = "vidtoolz.resolvePermissions.v1.10"; perm_schema["properties"]["schema"] = {"const": "vidtoolz.resolvePermissions.v1.10"}
dump("schemas/resolvePermissions.schema.json", perm_schema)
fixture("permissions-frozen", "none", "resolvePermissions", perms)
neg = copy.deepcopy(perms); neg["default"] = "ALLOW"; fixture("permissions-default-allow", "schema", "resolvePermissions", neg, expect_contains="DENY")
neg = copy.deepcopy(perms); neg["entries"][0]["shared_library_allowed"] = True; fixture("permissions-shared-library-grant", "schema", "resolvePermissions", neg, expect_contains="False")
neg = copy.deepcopy(perms); neg["entries"][0]["mutation_allowed"] = True; fixture("permissions-m0-mutation", "schema", "resolvePermissions", neg, expect_contains="M3")
neg = copy.deepcopy(perms); neg["entries"][1]["target_requirement"] = "PROJECT"; fixture("permissions-target-requirement-disagrees-with-read-primitives", "semantic", "resolvePermissions", neg, check="semantic_read_primitives_with_perms", expect_contains="differs")
matrix = load("MILESTONE-MATRIX.json"); matrix["schema"] = "vidtoolz.resolveMilestoneMatrix.v1.10"; matrix["version"] = "1.20.0"; dump("MILESTONE-MATRIX.json", matrix)
probes = load("M3-PROBES.json"); probes["schema"] = "vidtoolz.resolveM3Probes.v1.10"; dump("M3-PROBES.json", probes)


def REQ(m, op, project=None, timeline=None, refs=None, plan_target=None, **kw):
    r = {"schema": "vidtoolz.resolveEligibilityRequest.v1.10", "milestone": m, "operation": op, "scope": SCOPE, "refs": refs or {}}
    if plan_target is not None:
        r["plan_target"] = plan_target
    if project is not None:
        r["expected_project_name"] = project
    if timeline is not None:
        r["expected_timeline_name"] = timeline
    r.update(kw)
    return r


RID = lambda r: r["record_id"]  # noqa: E731
ROJ = {"read_only_journal": RID(H["roj"])}
M3_REFS = {"m0_exit": RID(H["m0"]), "m1_exit": RID(H["m1"]), "m2_exit": RID(H["m2"]), "authorization": RID(H["auth"]), "exclusive_session": RID(H["excl"]), "read_only_journal": RID(H["roj"]), "media_class": RID(H["media"]), "destination_timeline": RID(H["dest"])}
elig = []


def case(name, request, evidence_set, expect, expect_failed_contains=None, capabilities="CAPABILITIES.json", schema_valid=True, expect_state=None, forge_matrix=False):
    elig.append({"name": name, "request": request, "evidence_set": evidence_set, "capabilities": capabilities, "expect_eligible": expect, "expect_failed_contains": expect_failed_contains, "expect_attachment_state": expect_state, "request_schema_valid": schema_valid, "forge_matrix": forge_matrix})


PR = "READ_PRIMITIVE_QUALIFICATION_PROBE"
case("m0-probe-allow-attachment-ready", REQ("M0", PR, refs=ROJ), "ready", True, expect_state="ATTACHMENT_READY")
case("m0-probe-deny-unprovisioned", REQ("M0", PR, refs=ROJ), "empty", False, "TARGET_STATE_ATTACHMENT_READY", expect_state="UNPROVISIONED")
case("m0-probe-deny-provisioned-not-verified", REQ("M0", PR, refs=ROJ), "provisioned-only", False, "TARGET_STATE_ATTACHMENT_READY", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-launch-wrong-binary", REQ("M0", PR, refs=ROJ), "ready-wrong-binary-pin", False, "TARGET_STATE_ATTACHMENT_READY", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-self-verified-bundle", REQ("M0", PR, refs=ROJ), "ready-self-verified-bundle", False, "BUNDLE_INDEPENDENTLY_VERIFIED", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-bundle-other-host", REQ("M0", PR, refs=ROJ), "ready-bundle-other-host", False, "BUNDLE_INDEPENDENTLY_VERIFIED", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-bundle-historical-only", REQ("M0", PR, refs=ROJ), "ready-bundle-historical-only", False, "BUNDLE_INDEPENDENTLY_VERIFIED", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-no-current-session", REQ("M0", PR, refs=ROJ), "ready-no-current-session", False, "TARGET_STATE_ATTACHMENT_READY", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-launch-previous-session-only", REQ("M0", PR, refs=ROJ), "ready-launch-previous-session-only", False, "TARGET_STATE_ATTACHMENT_READY", expect_state="PROVISIONED_NOT_VERIFIED")
case("m0-probe-deny-no-read-only-journal-ref", REQ("M0", PR), "ready", False, "READ_ONLY_JOURNAL_OPEN")
case("m0-probe-deny-declared-state-ignored", REQ("M0", PR, refs=ROJ, attachment_state="ATTACHMENT_READY"), "empty", False, "TARGET_STATE_ATTACHMENT_READY", schema_valid=False)
case("m0-probe-deny-tampered-record", REQ("M0", PR, refs=ROJ), "invalid-tampered-record", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-deny-provisioning-without-root", REQ("M0", PR, refs=ROJ), "invalid-provisioning-without-root", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-deny-wrong-manifest-record", REQ("M0", PR, refs=ROJ), "invalid-connection-wrong-manifest", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-deny-other-authority-record", REQ("M0", PR, refs=ROJ), "invalid-connection-other-authority", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-deny-bundle-other-manifest-not-historical", REQ("M0", PR, refs=ROJ), "invalid-bundle-other-manifest-not-historical", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-deny-fatal-probe-failure-in-session", REQ("M0", PR, refs=ROJ), "attached-fatal-probe-failure", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-probe-allow-after-capability-failure-only", REQ("M0", PR, refs=ROJ), "attached-capability-failure-only", True, expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-allow-degraded-attached", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached", True, expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-allow-reversed-record-order", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-reversed-order", True, expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-deny-attachment-ready-only", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "ready", False, "TARGET_STATE_ATTACHED_READ_ONLY", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-stale-good-current-eka", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-stale-good-current-eka", False, "TARGET_STATE_ATTACHED_READ_ONLY", expect_state="ATTACHMENT_READY")
case("m0-snapshot-allow-current-good-stale-eka", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-current-good-stale-eka", True, expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-deny-duplicate-sequence-conflict", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-duplicate-sequence-conflict", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-snapshot-allow-duplicate-timestamp-distinct-sequence", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-duplicate-timestamp-distinct-sequence", True, expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-deny-connection-previous-session-only", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-connection-previous-session-only", False, "TARGET_STATE_ATTACHED_READ_ONLY", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-ancient-observation", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-ancient-observation", False, "STALE", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-sequence-timestamp-disorder", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-sequence-timestamp-disorder", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-snapshot-deny-missing-root-in-connection", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-missing-root-in-connection", False, "root", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-changed-uuid-in-connection", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-changed-uuid-in-connection", False, "uuid", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-second-provisioning-other-uuid", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-second-provisioning-other-uuid", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-snapshot-deny-cross-library-timeline-binding", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-cross-library-timeline-binding", False, "ATTACHMENT_CONFLICT", expect_state="CONFLICT")
case("m0-snapshot-deny-binding-from-other-session", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-binding-other-session", False, "PROJECT_BINDING_OBSERVATION", expect_state="ATTACHED_READ_ONLY")
case("m0-snapshot-deny-no-timeline-binding", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, "VIDTOOLZ__other__r1", refs=ROJ), "attached", False, "TIMELINE_BINDING_OBSERVATION")
case("m0-snapshot-deny-no-expected-timeline", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, refs=ROJ), "attached", False, "expected_timeline_name")
case("m0-snapshot-deny-no-expected-project", REQ("M0", "SNAPSHOT_CAPTURE", None, TL, refs=ROJ), "attached", False, "expected_project_name")
case("m0-snapshot-deny-unbound-project-name", REQ("M0", "SNAPSHOT_CAPTURE", PFX + "GHOST", TL, refs=ROJ), "attached", False, "PROJECT_BINDING_OBSERVATION")
case("m0-enumerate-timelines-deny-human-project-without-operator-record", REQ("M0", "ENUMERATE_TIMELINES", "PYSTY UHD", refs=ROJ), "attached", False, "neither adapter-prefixed nor operator-provisioned")
case("m0-enumerate-timelines-allow-operator-provisioned-project", REQ("M0", "ENUMERATE_TIMELINES", "Mikko human scratch", refs=ROJ), "attached", True)
case("m0-enumerate-projects-allow-session-scope-no-project", REQ("M0", "ENUMERATE_PROJECTS", refs=ROJ), "attached", True)
case("m0-enumerate-projects-allow-without-any-binding-records", REQ("M0", "ENUMERATE_PROJECTS", refs=ROJ), "attached-current-good-stale-eka", True)
case("m0-enumerate-timelines-deny-no-project", REQ("M0", "ENUMERATE_TIMELINES", refs=ROJ), "attached", False, "expected_project_name")
case("m0-snapshot-deny-eka-observed", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-eka-observed", False, "TARGET_STATE_ATTACHED_READ_ONLY", expect_state="ATTACHMENT_READY")
case("m0-snapshot-deny-local-database-observed", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-local-database-observed", False, "TARGET_STATE_ATTACHED_READ_ONLY")
case("m0-snapshot-deny-version-mismatch", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached-version-mismatch", False, "RESOLVE_VERSION_MATCHES")
case("m0-connect-deny-refuse-fallback-no-qualified-rows", REQ("M0", "CONNECT", refs=ROJ), "attached", False, "REFUSE")
case("m0-connect-deny-qualified-read-string-ignored", REQ("M0", "CONNECT", refs=ROJ, capability_state={"GetVersionString": "QUALIFIED_READ"}), "attached", False, "REFUSE", schema_valid=False)
case("m0-connect-deny-reviewed-evidence-but-matrix-not-refrozen", REQ("M0", "CONNECT", refs=ROJ), "attached-reviewed-evidence", False, "REFUSE")
case("m0-connect-allow-hypothetical-refrozen-matrix", REQ("M0", "CONNECT", refs=ROJ), "attached-reviewed-evidence", True, capabilities=HYP)
case("m0-connect-deny-hyp-unreviewed-candidates", REQ("M0", "CONNECT", refs=ROJ), "attached-candidate-evidence-unreviewed", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-failed-getters", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-failed-getters", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-wrong-build", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-wrong-build", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-old-refreeze", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-old-refreeze", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-old-authority", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-old-authority", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-no-raw-evidence", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-no-raw", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-raw-tampered", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-raw-tampered", False, "ATTACHMENT_CONFLICT", capabilities=HYP)
case("m0-connect-deny-hyp-wrong-receiver", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-wrong-receiver", False, "REFUSE", capabilities=HYP)
case("m0-connect-deny-hyp-no-linked-evidence", REQ("M0", "CONNECT", refs=ROJ), "attached", False, "REFUSE", capabilities=HYP)
for nm_ in ("raised-accepted", "raised-fake-parse-block", "timeout-accepted", "attribute-missing-accepted", "wrong-type-accepted", "null-accepted", "truncated-accepted", "unserializable-accepted", "review-other-raw", "review-stale-parser", "review-stale-spec", "reviewer-is-operator", "review-reject", "refreeze-stale-parser", "refreeze-stale-spec", "refreeze-other-session", "refreeze-unreviewed", "refreeze-unlisted-raw", "no-refreeze-record", "derived-cache-forged"):
    case(f"m0-connect-deny-hyp-{nm_}", REQ("M0", "CONNECT", refs=ROJ), f"attached-evidence-{nm_}", False, ("ATTACHMENT_CONFLICT" if nm_ == "raised-fake-parse-block" else "REFUSE"), capabilities=HYP)
case("m0-connect-allow-hyp-derived-cache-honest", REQ("M0", "CONNECT", refs=ROJ), "attached-evidence-derived-cache-honest", True, capabilities=HYP)
case("m0-deny-write-op", REQ("M0", "APPEND", PROJ, TL, refs=ROJ), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
case("m0-deny-ref-empty-string", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": ""}), "attached", False, "not a sha256", schema_valid=False)
case("m0-deny-ref-false-string", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": "false"}), "attached", False, "not a sha256", schema_valid=False)
case("m0-deny-ref-unlinked-sha", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": "9" * 64}), "attached", False, "not in evidence set")
case("m0-deny-ref-wrong-record-type", REQ("M0", "SNAPSHOT_CAPTURE", PROJ, TL, refs={"read_only_journal": RID(H["conn"])}), "attached", False, "has type CONNECTION_OBSERVATION")
case("m2-set-current-timeline-deny-production-project-name", REQ("M2", "SetCurrentTimeline", "PYSTY UHD", "traileri", refs=dict(ROJ, m1_exit=RID(H["m1"]))), "write-ready-base", False, "PROJECT_ADAPTER_PREFIXED")
case("m2-set-current-timeline-allow", REQ("M2", "SetCurrentTimeline", PROJ, TL, refs=dict(ROJ, m1_exit=RID(H["m1"]))), "write-ready-base", True)
case("m3-append-deny-without-authorization", REQ("M3", "APPEND", PROJ, TL, refs={k: v for k, v in M3_REFS.items() if k != "authorization"}, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-without-authorization", False, "MIKKO_M3_AUTHORIZATION")
case("m3-append-deny-authorization-old-authority", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-authorization-old-authority", False, "MIKKO_M3_AUTHORIZATION")
case("m3-append-deny-refreeze-unreviewed", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-refreeze-unreviewed", False, "TARGET_STATE_SCRATCH_WRITE_READY")
case("m3-append-deny-refreeze-for-other-matrix", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-refreeze-other-matrix", False, "TARGET_STATE_SCRATCH_WRITE_READY")
case("m3-append-deny-no-journal-guard-plan-records", REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64, plan_h0_guard_digest=snap_pos["guard_digest"]), "write-ready-base", False, "JOURNAL_PREPARED", expect_state="SCRATCH_WRITE_READY")
case("m3-save-deny-ids-unavailable", REQ("M3", "SAVE_PROJECT", PROJ, refs=M3_REFS, transaction_id="tx-1", plan_digest="a" * 64), "attached-no-ids", False, "OBSERVED project_unique_id")
case("m3-deny-shared-library-scope", dict(REQ("M3", "APPEND", PROJ, TL, refs=M3_REFS), scope="NETWORK_LIBRARY_EKA"), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
case("m4-deny-unknown-milestone", REQ("M4", "SNAPSHOT_CAPTURE", PROJ, TL, refs=ROJ), "attached", False, "NOT_PERMITTED_BY_POLICY")
case("deny-unknown-operation", REQ("M3", "FrobnicateTimeline", PROJ, TL, refs=M3_REFS), "write-ready-base", False, "NOT_PERMITTED_BY_POLICY")
# (the H0/S0 early-write-gate cases are appended after the plan fixtures below, then fixtures/eligibility/cases.json is written)

# ============================================================ PROVISIONAL schemas: binding + membership + derived verification
TGT_S = {"type": "object", "additionalProperties": False, "required": ["library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "host_name", "library_name", "library_kind", "project_name", "timeline_name", "resolve_version"], "properties": {"library_instance_uuid": UUID, "project_unique_id": {"type": "string", "minLength": 1}, "timeline_unique_id": {"type": "string", "minLength": 1}, "target_epoch": {"type": "string", "minLength": 1}, "host_name": {"type": "string", "minLength": 1}, "library_name": {"type": "string", "minLength": 1}, "library_kind": {"enum": ["Disk"]}, "observed_database_name": STR_OR_NULL, "project_name": {"type": "string", "minLength": 1}, "timeline_name": {"type": "string", "minLength": 1}, "resolve_version": {"type": "string", "minLength": 1}}}
TARGET_REF_S = {"type": "object", "additionalProperties": False, "required": ["project_unique_id", "timeline_unique_id", "library_instance_uuid"], "properties": {"project_unique_id": {"type": "string", "minLength": 1}, "timeline_unique_id": {"type": "string", "minLength": 1}, "library_instance_uuid": UUID}}
mp = load("schemas/provisional/resolveMutationPlan.schema.json")
mp["properties"]["target"] = TGT_S; mp["properties"]["authority_version"] = AV; mp["properties"]["session_id"] = {"type": "string", "minLength": 1}
mp["required"] = sorted(set(mp["required"]) | {"session_id"})
mp["properties"]["operations"]["items"]["properties"]["selector"]["properties"]["expected_media_pool_item_unique_id"] = {"type": "string"}
mp["$comment"] = "PROVISIONAL_UNTIL_M3. v1.5 binding tuple: plan_digest (= digest of plan without plan_digest/refs), transaction_id, target, h0_guard_digest, operation_set_digest (= digest of operations) and authority_version, shared with journal, verification, conflict and commit. Every journal operation record must name an operation_id of this plan with the same op. refs are sha256 references into the evidence set resolved by evaluate_eligibility."
dump("schemas/provisional/resolveMutationPlan.schema.json", mp)
jr = load("schemas/provisional/resolveTransactionJournal.schema.json")
jr["properties"]["state"] = {"enum": sorted({s for v in L.JOURNAL_TRANSITIONS.values() for s in v} | {"PREPARED"})}
jr["properties"]["target_ref"] = TARGET_REF_S; jr["properties"]["authority_version"] = AV
jr["properties"]["operation_set_digest"] = SHA; jr["properties"]["op"] = {"anyOf": [{"enum": sorted(L.WRITE_OPS)}, {"type": "null"}]}
jr["properties"]["session_id"] = {"type": "string", "minLength": 1}; jr["properties"]["readback_snapshot_sha256"] = SHA_OR_NULL; jr["properties"]["readback_guard_digest"] = SHA_OR_NULL
jr["required"] = sorted(set(jr["required"]) | {"operation_set_digest", "op", "session_id", "readback_snapshot_sha256", "readback_guard_digest"})
jr["$comment"] = "Append-only; contiguous sequence from 0; single transaction_id, plan_digest and operation_set_digest; constant target_ref; constant guard_digest except across RECOVERY_RECONCILING; hash chain; transitions per JOURNAL_TRANSITIONS (operation lifecycle OP_STARTED -> APPLIED | OP_FAILED); OPERATION MEMBERSHIP: OP_STARTED/APPLIED/OP_FAILED name an operation_id of the bound plan with matching op, each started/applied at most once, APPLIED only after its OP_STARTED, READBACK_S1 only after every plan operation is APPLIED; non-operation records carry null operation_id/op."
dump("schemas/provisional/resolveTransactionJournal.schema.json", jr)
vs = load("schemas/provisional/resolveVerificationResult.schema.json")
vs["properties"].update({"target": TGT_S, "authority_version": AV, "applied_operation_ids": {"type": "array", "items": {"type": "string"}}, "unobserved_domains": {"type": "array", "items": {"type": "string"}}, "added": {"type": "array", "items": {"type": "object"}}, "removed": {"type": "array", "items": {"type": "object"}}, "changed": {"type": "array", "items": {"type": "object"}}, "verdict": {"enum": ["VERIFIED", "EXPECTED_DELTA_MISSING", "UNEXPECTED_DELTA", "UNOBSERVABLE_STATE", "EFFECT_NOT_SPECIFIED"]}, "session_id": {"type": "string", "minLength": 1}})
vs["required"] = sorted(set(vs["required"]) | {"applied_operation_ids", "session_id", "unobserved_domains"})
vs["$comment"] = "v1.6: applied_operation_ids and unobserved_domains are DERIVED and compared (F15-06: a ghost applied id is rejected; F15-05: the unobserved/excluded domains are named in every result so no zero-unintended-change claim covers them). v1.5: the verifier DERIVES added/removed/changed/creation_identity_map/missing_expected/unrelated/verdict from S0, the bound plan, the journal's applied operations and S1 (authority_lib.verify_transaction); a declared result must equal the derived truth. h0/s1 digests must resolve to supplied snapshots; readback_snapshot_sha256 = digest of the S1 snapshot object. VERIFIED is impossible for operations whose effect law is NOT_YET_SPECIFIED (EFFECT_NOT_SPECIFIED). Never human approval."
dump("schemas/provisional/resolveVerificationResult.schema.json", vs)
cs = load("schemas/provisional/resolveConflict.schema.json"); cs["properties"]["authority_version"] = AV; dump("schemas/provisional/resolveConflict.schema.json", cs)
cmm = load("schemas/provisional/resolveCommitManifest.schema.json")
cmm["properties"].update({"target": TGT_S, "authority_version": AV, "s1_guard_digest": SHA, "s1_snapshot_sha256": SHA, "session_id": {"type": "string", "minLength": 1}})
cmm["required"] = sorted(set(cmm["required"]) | {"s1_guard_digest", "s1_snapshot_sha256", "session_id"})
cmm["$comment"] = "Commit eligibility is composed validation (validate_transaction_set): S0, plan, journal (membership), S1, derived delta, expected effect, verification against derived truth, then commit: same plan/transaction/target/guard/operation set; VERIFIED; allowed terminal state; no unresolved conflict; evidence digests; s1_guard_digest == S1."
dump("schemas/provisional/resolveCommitManifest.schema.json", cmm)

# ============================================================ PLAN / JOURNAL / S0 / S1 / VERIFICATION / COMMIT fixtures (linked sets) — v1.5 session + readback binding
TGT = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "host_name": HOST, "library_name": LIB, "library_kind": "Disk", "observed_database_name": LIB, "project_name": PROJ, "timeline_name": TL, "resolve_version": VER}
s0 = wp_snap
sel_append = {"library_instance_uuid": UU, "project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "target_epoch": "epoch-fixture-1", "track_type": "video", "track_index": 1, "expected_media_pool_item_unique_id": "mp-new"}
ops = [{"operation_id": "op-1", "op": "APPEND", "selector": sel_append, "expected_old": None, "expected_new": {"start": 110194, "end": 110541}, "allowed_created": ["one item"], "allowed_deleted": [], "declared_side_effects": []}]
plan_body = {"schema": "vidtoolz.resolveMutationPlan.v1", "transaction_id": "tx-fixture", "session_id": F.S_CUR, "authority_version": L.AUTHORITY_VERSION, "milestone": "M3", "dry_run": False, "target": TGT, "target_epoch": "epoch-fixture-1", "target_contract_digest": sha_of("TARGET-CONTRACT.json"), "binding_set_digest": "2" * 64, "handoff_digest_sha256": "3fd9bdd875c9eb489abf77797613abbc2616eef36073503742ebc9fd80f5bf69", "h0_payload_sha256": s0["payload_sha256"], "h0_guard_digest": s0["guard_digest"], "capability_matrix_version": "1.20.0-HYPOTHETICAL", "collector_version": "0.0.0-fixture", "timebase_digest": sha_of("TIMEBASE.json"), "permission_class": "RESOLVE_ASSEMBLE", "scope": SCOPE, "lease": {}, "operations": ops, "operation_set_digest": L.operation_set_digest(ops)}
PDG = L.plan_digest_of(plan_body)
PLAN_TARGET = {k: TGT[k] for k in ("library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch")}
RID_ = lambda r: r["record_id"]  # noqa: E731
r_jp = M.journal_prepared("tx-fixture", PDG)
r_guard = M.guard(s0)
r_guard_stale = M.guard(snap_b, seq=3)
r_pv = M.plan_validation(PDG, h0_guard_digest=s0["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(s0))
r_pv_fail = M.plan_validation(PDG, "FAIL", h0_guard_digest=s0["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(s0))
r_pv_helper = M.plan_validation(PDG, h0_guard_digest=s0["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(s0), validator="tools/authority_lib.py#semantic_mutation_plan", stages=("plan",))
r_pv_other_guard = M.plan_validation(PDG, h0_guard_digest=snap_b["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(snap_b))
PLAN_REFS = dict(M3_REFS, journal_prepared=RID(r_jp), guard=RID(r_guard), plan_validation=RID(r_pv))
PLAN_REFS_EARLY = PLAN_REFS
hyp_recs = list(EVSETS["write-ready-hyp"]["records"].values())
EVSETS["write-ready-full"] = F.ES(hyp_recs + [r_jp, r_guard, r_pv])
EVSETS["write-ready-stale-guard-current"] = F.ES(hyp_recs + [r_jp, r_guard, r_guard_stale, r_pv])
EVSETS["write-ready-plan-validation-fail"] = F.ES(hyp_recs + [r_jp, r_guard, r_pv_fail])
EVSETS["write-ready-plan-validation-from-helper"] = F.ES(hyp_recs + [r_jp, r_guard, r_pv_helper])
EVSETS["write-ready-plan-validation-other-h0"] = F.ES(hyp_recs + [r_jp, r_guard, r_pv_other_guard])
# ---- H0 / S0 early write-gate attacks: each guard record is schema-valid and its digests recompute, but the GUARDED SNAPSHOT is degraded
H0_ATTACKS = {
    "write-ready-h0-minimal-m0": m0_snap,                    # MINIMAL_M0, incomplete, NOT_CALLABLE provenance (the F15-03 shape)
    "write-ready-h0-full-timeline-read": snap_pos,            # complete FULL_TIMELINE_READ: an M0-only read profile
    "write-ready-h0-incomplete-write-precheck": None,         # WRITE_PRECHECK profile label with complete:false
    "write-ready-h0-candidate-provenance": None,              # WRITE_PRECHECK complete but provenance CANDIDATE_OBSERVATION
    "write-ready-h0-other-matrix": None,                      # collected under another capability matrix
    "write-ready-h0-other-target": None,                      # complete WRITE_PRECHECK of ANOTHER timeline
}
h0_incomplete = copy.deepcopy(s0); h0_incomplete["coverage"].update(complete=False, incomplete_reasons=["track_locks deferred"], observed_domains=[d for d in WP_COV["observed_domains"] if d != "track_locks"], deferred_domains=WP_COV["deferred_domains"] + ["track_locks"]); resign(h0_incomplete)
h0_candidate = copy.deepcopy(s0); h0_candidate["collection"]["method_provenance"] = copy.deepcopy(CANDIDATE_PROV); resign(h0_candidate)
h0_other_matrix = copy.deepcopy(s0); h0_other_matrix["policy"] = dict(policy_hyp, capability_matrix_sha256=CAPS_SHA, capabilities_version="1.20.0"); resign(h0_other_matrix)
h0_other_target = copy.deepcopy(s0); h0_other_target["payload"]["timeline"]["unique_id"] = "tl-OTHER-0002"; h0_other_target["project"]["unique_id"] = "proj-OTHER-0002"; resign(h0_other_target)
H0_ATTACKS.update({"write-ready-h0-incomplete-write-precheck": h0_incomplete, "write-ready-h0-candidate-provenance": h0_candidate, "write-ready-h0-other-matrix": h0_other_matrix, "write-ready-h0-other-target": h0_other_target})
H0_GUARDS = {}
for nm_, snap_ in H0_ATTACKS.items():
    g_ = M.guard(snap_, seq=2)
    pv_ = M.plan_validation(L.plan_digest_of(dict(plan_body, h0_guard_digest=snap_["guard_digest"], h0_payload_sha256=snap_["payload_sha256"])), h0_guard_digest=snap_["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(snap_))
    H0_GUARDS[nm_] = (snap_, g_, pv_)
    EVSETS[nm_] = F.ES(hyp_recs + [r_jp, g_, pv_])
# forged guard record: the guard OBJECT claims a complete WRITE_PRECHECK while guard_digest is the degraded snapshot's (digest recomputation catches it)
g_forged = M.guard(m0_snap, seq=2, guard_override=L.guard_object(s0))
EVSETS["write-ready-h0-forged-guard-object"] = F.ES(hyp_recs + [r_jp, g_forged, M.plan_validation(PDG, h0_guard_digest=m0_snap["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(m0_snap))])
# guard record whose method_provenance is swapped for a fully-qualified map while the guard object's provenance digest is the degraded one
g_prov_swap = M.guard(m0_snap, seq=2)
g_prov_swap = L.make_record({k: v for k, v in dict(g_prov_swap, method_provenance=copy.deepcopy(HYP_PROV)).items() if k != "record_id"})
EVSETS["write-ready-h0-provenance-swapped"] = F.ES(hyp_recs + [r_jp, g_prov_swap, M.plan_validation(PDG, h0_guard_digest=m0_snap["guard_digest"], h0_snapshot_sha256=L.snapshot_object_digest(m0_snap))])
for name in ("write-ready-full", "write-ready-stale-guard-current", "write-ready-plan-validation-fail", "write-ready-plan-validation-from-helper", "write-ready-plan-validation-other-h0", "write-ready-h0-forged-guard-object", "write-ready-h0-provenance-swapped", *H0_ATTACKS):
    dump(f"fixtures/evidence/{name}.json", EVSETS[name])
# ---- eligibility cases for the v1.6 early write gate (evaluated BEFORE any mutator; the composed path is not consulted)
def h0_case(name, evidence_set, guard_rec, snap_, expect_contains, plan_digest=None):
    refs_ = dict(M3_REFS, journal_prepared=RID(r_jp), guard=RID(guard_rec), plan_validation=next(RID(r) for r in EVSETS[evidence_set]["records"].values() if r["record_type"] == "PLAN_VALIDATION"))
    case(name, REQ("M3", "APPEND", PROJ, TL, refs=refs_, transaction_id="tx-fixture", plan_digest=plan_digest or PDG, plan_h0_guard_digest=snap_["guard_digest"], plan_target=PLAN_TARGET), evidence_set, False, expect_contains, capabilities=HYP)


H0_EXPECT = {"write-ready-h0-minimal-m0": "H0_PROFILE", "write-ready-h0-full-timeline-read": "H0_PROFILE", "write-ready-h0-incomplete-write-precheck": "H0_INCOMPLETE", "write-ready-h0-candidate-provenance": "H0_PROVENANCE", "write-ready-h0-other-matrix": "H0_MATRIX", "write-ready-h0-other-target": "H0_TARGET"}
for nm_, (snap_, g_, pv_) in H0_GUARDS.items():
    pd_ = L.plan_digest_of(dict(plan_body, h0_guard_digest=snap_["guard_digest"], h0_payload_sha256=snap_["payload_sha256"]))
    h0_case(f"m3-append-deny-{nm_[len('write-ready-'):]}", nm_, g_, snap_, H0_EXPECT[nm_], plan_digest=pd_)
h0_case("m3-append-deny-h0-forged-guard-object", "write-ready-h0-forged-guard-object", g_forged, m0_snap, "does not re-hash")
h0_case("m3-append-deny-h0-provenance-swapped", "write-ready-h0-provenance-swapped", g_prov_swap, m0_snap, "does not re-hash")
case("m3-append-allow-complete-write-precheck-h0", REQ("M3", "APPEND", PROJ, TL, refs=PLAN_REFS_EARLY, transaction_id="tx-fixture", plan_digest=PDG, plan_h0_guard_digest=s0["guard_digest"], plan_target=PLAN_TARGET), "write-ready-full", True, capabilities=HYP)
case("m3-append-deny-plan-validation-from-helper", REQ("M3", "APPEND", PROJ, TL, refs=dict(PLAN_REFS_EARLY, plan_validation=RID(r_pv_helper)), transaction_id="tx-fixture", plan_digest=PDG, plan_h0_guard_digest=s0["guard_digest"], plan_target=PLAN_TARGET), "write-ready-plan-validation-from-helper", False, "PLAN_VALIDATED", capabilities=HYP)
case("m3-append-deny-plan-validation-other-h0", REQ("M3", "APPEND", PROJ, TL, refs=dict(PLAN_REFS_EARLY, plan_validation=RID(r_pv_other_guard)), transaction_id="tx-fixture", plan_digest=PDG, plan_h0_guard_digest=s0["guard_digest"], plan_target=PLAN_TARGET), "write-ready-plan-validation-other-h0", False, "PLAN_VALIDATED", capabilities=HYP)
case("m3-append-deny-forged-matrix-under-active-digest", REQ("M3", "APPEND", PROJ, TL, refs=PLAN_REFS_EARLY, transaction_id="tx-fixture", plan_digest=PDG, plan_h0_guard_digest=s0["guard_digest"], plan_target=PLAN_TARGET), "write-ready-full", False, "CAPABILITY_MATRIX_NOT_ACTIVE", capabilities=HYP, forge_matrix=True)
dump("fixtures/eligibility/cases.json", {"schema": "vidtoolz.resolveEligibilityFixtures.v1.10", "law": "expect_eligible/expect_attachment_state are computed by evaluate_eligibility/derive_attachment_state over (PERMISSIONS, request, READ-PRIMITIVES, capabilities file, TARGET-CONTRACT, fixtures/evidence/<evidence_set>.json, active authority = {1.7.0, placeholder manifest sha, CONTENT DIGEST of the capabilities object}); forge_matrix cases replace the matrix content while keeping the active digest and must be refused with CAPABILITY_MATRIX_NOT_ACTIVE; results must be identical under randomized record order", "cases": elig})
plan_m3 = dict(plan_body, plan_digest=PDG, refs=PLAN_REFS)
dump("fixtures/plan/m3-append-plan.json", plan_m3)
G = s0["guard_digest"]
PX = {"evidence_set": "write-ready-full", "capabilities": HYP, "guard_digest": G}
fixture("plan-m3-append-eligible", "none", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", extra=PX)
p = copy.deepcopy(plan_m3); p["permission_class"] = "RESOLVE_READ"; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-read-class-with-append", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="RESOLVE_READ", extra=PX)
p = copy.deepcopy(plan_m3); p["operations"][0]["selector"]["project_unique_id"] = "proj-OTHER"; p["operation_set_digest"] = L.operation_set_digest(p["operations"]); p["plan_digest"] = L.plan_digest_of(p); fixture("plan-selector-target-mismatch", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="does not match plan target", extra=PX)
p = copy.deepcopy(plan_m3); p["h0_guard_digest"] = snap_b["guard_digest"]; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-stale-guard", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="STALE_SNAPSHOT", extra=PX)
p = copy.deepcopy(plan_m3); p["refs"].pop("authorization"); fixture("plan-missing-m3-authorization", "eligibility", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="MIKKO_M3_AUTHORIZATION", extra=PX)
p = copy.deepcopy(plan_m3); p["operations"].append(dict(ops[0], operation_id="op-1")); p["operation_set_digest"] = L.operation_set_digest(p["operations"]); p["plan_digest"] = L.plan_digest_of(p); fixture("plan-duplicate-operation-id", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="unique", extra=PX)
p = copy.deepcopy(plan_m3); p["plan_digest"] = "0" * 64; fixture("plan-digest-not-of-body", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="plan_digest does not match", extra=PX)
p = copy.deepcopy(plan_m3); p["operation_set_digest"] = "0" * 64; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-operation-set-digest-mismatch", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="operation_set_digest", extra=PX)
p = copy.deepcopy(plan_m3); p["authority_version"] = "1.4.0"; fixture("plan-authority-version-old", "schema", "provisional/resolveMutationPlan", p, expect_contains="1.20.0")
p = copy.deepcopy(plan_m3); p["milestone"] = "M2"; p["dry_run"] = True; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-m2-append-not-permitted", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="not permitted", extra=PX)
p = copy.deepcopy(plan_m3); p["session_id"] = F.S_OLD; p["plan_digest"] = L.plan_digest_of(p); fixture("plan-session-not-current", "semantic", "provisional/resolveMutationPlan", p, check="semantic_mutation_plan", expect_contains="execution session mismatch", extra=PX)
p = copy.deepcopy(plan_m3); del p["session_id"]; fixture("plan-missing-session", "schema", "provisional/resolveMutationPlan", p, expect_contains="session_id")
fixture("plan-guard-record-not-current", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="GUARD_CURRENT", extra=dict(PX, evidence_set="write-ready-stale-guard-current"))
fixture("plan-plan-validation-record-fail", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="PLAN_VALIDATED", extra=dict(PX, evidence_set="write-ready-plan-validation-fail"))
fixture("plan-eligible-without-prepared-journal", "eligibility", "provisional/resolveMutationPlan", plan_m3, check="semantic_mutation_plan", expect_contains="JOURNAL_PREPARED", extra=dict(PX, evidence_set="write-ready-hyp"))
TREF = {"project_unique_id": "proj-fixture-0001", "timeline_unique_id": "tl-fixture-0001", "library_instance_uuid": UU}
OSD = plan_m3["operation_set_digest"]

# ---- S1 family (defined before journals so READBACK_S1 can bind to the exact S1)
s1_tracks = copy.deepcopy(wp_tracks)
new_item = item_media("it-new", 6, 110194, 110541, "mp-new", hashlib.sha256(b"new-still").hexdigest(), "HASHED", "still-021"); new_item["field_status"]["media_id"] = "OBSERVED"; new_item["media_id"] = "mid-it-new"
s1_tracks[0]["items"].append(new_item)
s1 = make_snapshot(s1_tracks, coverage_=WP_COV); s1["collection"]["generation"] = 2; resign(s1)
dump("fixtures/snapshot/write-precheck-s1-after-append.json", s1)
AV_COV = dict(WP_COV, profile="APPEND_VERIFY")
s1_av = make_snapshot(s1_tracks, coverage_=AV_COV); s1_av["collection"]["generation"] = 2; resign(s1_av)
dump("fixtures/snapshot/append-verify-s1-after-append.json", s1_av)
fixture("snapshot-append-verify-profile-complete", "none", "resolveSnapshot", s1_av, check="semantic_snapshot", extra=SX_HYP)
s1_noop = copy.deepcopy(s0); s1_noop["collection"]["generation"] = 2; resign(s1_noop)
s1_extra = copy.deepcopy(s1); s1_extra["payload"]["tracks"][0]["items"][1]["enabled"] = False; resign(s1_extra)
s1_wrong_track = make_snapshot([copy.deepcopy(wp_tracks[0]), dict(copy.deepcopy(wp_tracks[1]), items=[dict(new_item, observation_ordinal=2)]), copy.deepcopy(wp_tracks[2])], coverage_=WP_COV)
s1_other_media = copy.deepcopy(s1); s1_other_media["payload"]["tracks"][0]["items"][-1]["media_pool_item_unique_id"] = "mp-wrong"; resign(s1_other_media)
s1_other_epoch = copy.deepcopy(s1); s1_other_epoch["target_epoch"] = "epoch-fixture-2"; resign(s1_other_epoch)
s1_other_session = copy.deepcopy(s1); s1_other_session["collection"]["session_id"] = F.S_OLD; resign(s1_other_session)
# unrelated protected-surface changes hidden behind a correct APPEND
s1_srcbound = copy.deepcopy(s1); it_ = s1_srcbound["payload"]["tracks"][0]["items"][0]; it_["source_start"] = 5; it_["source_end"] = it_["source_end"] + 5; resign(s1_srcbound)
s1_dims = copy.deepcopy(s1); s1_dims["payload"]["timeline"]["width"] = 1920; resign(s1_dims)
s1_tlstart = copy.deepcopy(s1); s1_tlstart["payload"]["timeline"]["start_frame"] = 108001; resign(s1_tlstart)
s1_settings = copy.deepcopy(s1); s1_settings["payload"]["timeline"]["settings"] = {"useCustomSettings": "1", "timelineFrameRate": "25"}; resign(s1_settings)
s1_topology = copy.deepcopy(s1); s1_topology["payload"]["tracks"].append(trk("video", 3, "V3", [])); resign(s1_topology)
s1_trackname = copy.deepcopy(s1); s1_trackname["payload"]["tracks"][0]["name"] = "V1-renamed"; resign(s1_trackname)
s1_marker = copy.deepcopy(s1); s1_marker["payload"]["markers"].append({"object_address": "timeline", "frame": 109000, "duration": 1, "color": "Red", "name": "human note", "note": "", "custom_data": ""}); resign(s1_marker)
s1_media = copy.deepcopy(s1); s1_media["payload"]["media_dependencies"].append({"logical_locator": "/qual/media/unexpected.png", "source_sha256": "7" * 64, "status": "HASHED"}); resign(s1_media)
s1_tlend = copy.deepcopy(s1); s1_tlend["payload"]["timeline"]["end_frame"] = 114000; resign(s1_tlend)  # end_frame moved without an explaining extension: unrelated
s1_dup = copy.deepcopy(s1); s1_dup["payload"]["tracks"][0]["items"][-1]["unique_id"] = "it-1"; resign(s1_dup)
s1_dup_rev = copy.deepcopy(s1_dup); s1_dup_rev["payload"]["tracks"][0]["items"].reverse(); resign(s1_dup_rev)
s1_weak = copy.deepcopy(s1); s1_weak["coverage"] = dict(FULL_COV, complete=True); resign(s1_weak)  # complete FULL_TIMELINE_READ: weaker than APPEND_VERIFY
s1_incomplete = copy.deepcopy(s1); s1_incomplete["coverage"] = dict(WP_COV, complete=False, incomplete_reasons=["track_locks deferred"], observed_domains=[d for d in WP_COV["observed_domains"] if d != "track_locks"], deferred_domains=WP_COV["deferred_domains"] + ["track_locks"]); resign(s1_incomplete)


def jrec(seq, state, prev, tx="tx-fixture", opid=None, op=None, pd=PDG, guard=G, tref=TREF, osd=OSD, session=F.S_CUR, rb=None):
    return {"schema": "vidtoolz.resolveTransactionJournal.v1", "transaction_id": tx, "sequence": seq, "previous_record_sha256": prev, "state": state, "plan_digest": pd, "operation_set_digest": osd, "operation_id": opid, "op": op, "intent": {"phase": state}, "result": None, "readback_payload_sha256": None, "checkpoint": ({"checkpoint_sha256": hashlib.sha256(f"checkpoint {tx}".encode()).hexdigest(), "duplicate_timeline_name": TL + "__checkpoint", "drt_export_sha256": hashlib.sha256(b"drt").hexdigest(), "saved": True} if state == "CHECKPOINTED" else None), "recorded_at": "2026-09-08T11:55:00Z", "target_ref": tref, "guard_digest": guard, "authority_version": L.AUTHORITY_VERSION, "recovery_of_transaction_id": (tx if state == "RECOVERY_RECONCILING" else None), "session_id": session, "readback_snapshot_sha256": (rb[0] if rb else None), "readback_guard_digest": (rb[1] if rb else None)}


def chain(states, tx="tx-fixture", ops_=("op-1",), s1_=None, **kw):
    """states: list of state names; OP_STARTED/APPLIED/OP_FAILED consume operation ids in order given by ops_; READBACK_S1 binds to s1_."""
    out, prev, oi = [], None, 0
    for i, st in enumerate(states):
        opid = op = None
        if st in ("OP_STARTED",):
            opid = ops_[oi]; op = "APPEND"
        elif st in ("APPLIED", "OP_FAILED"):
            opid = ops_[oi]; op = "APPEND"; oi += 1
        rb = (L.snapshot_object_digest(s1_), s1_["guard_digest"]) if (st == "READBACK_S1" and s1_ is not None) else None
        r = jrec(i, st, prev, tx, opid=opid, op=op, rb=rb, **kw)
        out.append(r); prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
    return out


def rechain(records):
    prev = None
    for r in records:
        r["previous_record_sha256"] = prev; prev = L.digest(r, "vidtoolz.resolveJournalRecord.v1")
    return records


LEGAL_STATES = ["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED", "READBACK_S1", "VERIFIED", "SAVED", "PUBLISHED", "COMMITTED"]
legal_for = lambda s1x: chain(LEGAL_STATES, s1_=s1x)  # noqa: E731
legal = legal_for(s1)
JX = {"plan": plan_m3, "s1": s1}
fixture("journal-legal-chain", "none", "provisional/resolveTransactionJournal", legal, check="semantic_journal", extra=JX)
fixture("journal-recovery-committed-recovered", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED", "RECOVERY_RECONCILING", "COMMITTED_RECOVERED"]), check="semantic_journal", extra={"plan": plan_m3})
fixture("journal-recovery-not-applied", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "RECOVERY_RECONCILING", "NOT_APPLIED"]), check="semantic_journal", extra={"plan": plan_m3})
fixture("journal-operation-failed-aborted", "none", "provisional/resolveTransactionJournal", chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "OP_FAILED", "ABORTED"]), check="semantic_journal", extra={"plan": plan_m3})
b = copy.deepcopy(legal); b[5]["operation_id"] = "op-9"; rechain(b); fixture("journal-applied-operation-not-in-plan", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not in the bound plan operation set", extra=JX)
b = copy.deepcopy(legal); b[4]["operation_id"] = "op-9"; b[5]["operation_id"] = "op-9"; rechain(b); fixture("journal-invented-operation-started-and-applied", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="invented", extra=JX)
b = copy.deepcopy(legal); b[5]["op"] = "DELETE"; rechain(b); fixture("journal-op-type-inconsistent-with-plan", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="inconsistent with plan entry", extra=JX)
b = copy.deepcopy(legal); del b[4]
for i, r in enumerate(b):
    r["sequence"] = i
rechain(b); fixture("journal-applied-without-started", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="without a preceding OP_STARTED", extra=JX)
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED", "OP_STARTED", "APPLIED"], ops_=("op-1", "op-1")); fixture("journal-operation-applied-twice", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="applied twice", extra={"plan": plan_m3})
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "READBACK_S1"], s1_=s1); fixture("journal-readback-before-all-applied", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="READBACK_S1 before all plan operations applied", extra=JX)
b = copy.deepcopy(legal); b[1]["operation_id"] = "op-1"; b[1]["op"] = "APPEND"; rechain(b); fixture("journal-non-operation-state-carries-operation", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="carries operation_id", extra=JX)
b = copy.deepcopy(legal); b[6]["operation_set_digest"] = "9" * 64; rechain(b); fixture("journal-operation-set-digest-drift", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="operation_set_digest changed", extra=JX)
b = chain(["PREPARED", "LEASED"], osd="9" * 64); fixture("journal-operation-set-digest-not-plan", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="operation_set_digest != plan", extra={"plan": plan_m3})
b = copy.deepcopy(legal); b[5]["state"] = "COMMITTED"; rechain(b); fixture("journal-skip-to-committed", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="illegal transition", extra=JX)
b = copy.deepcopy(legal); b[3]["previous_record_sha256"] = "f" * 64; fixture("journal-broken-hash-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="hash chain", extra=JX)
b = copy.deepcopy(legal); b[2]["sequence"] = 5; rechain(b); fixture("journal-sequence-gap", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not contiguous", extra=JX)
b = copy.deepcopy(legal); b[3]["transaction_id"] = "tx-other"; rechain(b); fixture("journal-transaction-id-change", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="transaction_id changed", extra=JX)
b = copy.deepcopy(legal); b[6]["plan_digest"] = "9" * 64; rechain(b); fixture("journal-plan-digest-change-mid-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="plan_digest changed", extra=JX)
b = copy.deepcopy(legal); b[6]["guard_digest"] = snap_b["guard_digest"]; rechain(b); fixture("journal-guard-change-without-recovery", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="guard_digest changed", extra=JX)
b = copy.deepcopy(legal) + [jrec(11, "APPLIED", L.journal_head(legal), opid="op-1", op="APPEND")]; fixture("journal-record-after-terminal", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="after terminal", extra=JX)
b = chain(["PREPARED", "RECOVERY_RECONCILING", "NOT_APPLIED"]); b[1]["recovery_of_transaction_id"] = "tx-other"; rechain(b); fixture("journal-recovery-unlinked", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="not linked", extra={"plan": plan_m3})
b = copy.deepcopy(legal); b[5]["state"] = "APPLIED_MAYBE"; fixture("journal-unknown-state", "schema", "provisional/resolveTransactionJournal", b, expect_contains="enum")
b = copy.deepcopy(legal); del b[0]["op"]; fixture("journal-missing-op-field", "schema", "provisional/resolveTransactionJournal", b, expect_contains="op")
b = copy.deepcopy(legal); del b[0]["session_id"]; fixture("journal-missing-session-id", "schema", "provisional/resolveTransactionJournal", b, expect_contains="session_id")
fixture("journal-empty", "semantic", "provisional/resolveTransactionJournal", [], check="semantic_journal", expect_contains="empty", extra=JX)
# v1.5: readback -> S1 binding and execution session
fixture("journal-readback-names-other-s1", "semantic", "provisional/resolveTransactionJournal", legal_for(s1_noop), check="semantic_journal", expect_contains="names a different S1", extra=JX)
b = copy.deepcopy(legal); b[6]["readback_snapshot_sha256"] = None; b[6]["readback_guard_digest"] = None; rechain(b); fixture("journal-readback-without-digests", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="must name readback_snapshot_sha256", extra=JX)
b = copy.deepcopy(legal); b[6]["readback_guard_digest"] = snap_b["guard_digest"]; rechain(b); fixture("journal-readback-guard-not-s1", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="guard differs from the supplied S1", extra=JX)
b = copy.deepcopy(legal); b[5]["readback_snapshot_sha256"] = L.snapshot_object_digest(s1); rechain(b); fixture("journal-non-readback-carries-readback-digest", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="only READBACK_S1 may carry", extra=JX)
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED", "READBACK_S1", "READBACK_S1"], s1_=s1); fixture("journal-duplicate-readback-events", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="multiple READBACK_S1", extra=JX)
fixture("journal-session-not-plan-session", "semantic", "provisional/resolveTransactionJournal", chain(LEGAL_STATES, s1_=s1, session=F.S_OLD), check="semantic_journal", expect_contains="session_id != plan execution session", extra=JX)
b = copy.deepcopy(legal); b[7]["session_id"] = F.S_OLD; rechain(b); fixture("journal-session-changes-mid-chain", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="session_id changed", extra=JX)
fixture("journal-s1-from-other-session", "semantic", "provisional/resolveTransactionJournal", legal_for(s1_other_session), check="semantic_journal", expect_contains="different session", extra={"plan": plan_m3, "s1": s1_other_session})
b = chain(["PREPARED", "LEASED", "PREFLIGHT_OK"]) + [jrec(3, "OP_STARTED", None, opid="op-1", op="APPEND")]; rechain(b); fixture("journal-op-started-without-checkpoint", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="illegal transition", extra=JX)
b = copy.deepcopy(legal); b[3]["checkpoint"] = None; rechain(b); fixture("journal-checkpointed-without-checkpoint-evidence", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="CHECKPOINTED must carry checkpoint", extra=JX)
b = copy.deepcopy(legal); b[5]["checkpoint"] = {"checkpoint_sha256": "9" * 64}; rechain(b); fixture("journal-non-checkpoint-carries-checkpoint", "semantic", "provisional/resolveTransactionJournal", b, check="semantic_journal", expect_contains="only CHECKPOINTED may carry a checkpoint", extra=JX)
fixture("journal-in-flight-no-readback-with-s1-supplied", "semantic", "provisional/resolveTransactionJournal", chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED"]), check="semantic_journal", expect_contains="no READBACK_S1 event", extra=JX)


def make_vr(plan, s0_, s1_, journal, override=None):
    d = L.verify_transaction(plan, s0_, s1_, journal)
    vr = {"schema": "vidtoolz.resolveVerificationResult.v1", "plan_digest": plan["plan_digest"], "transaction_id": plan["transaction_id"], "session_id": plan["session_id"], "target": plan["target"], "h0_guard_digest": s0_["guard_digest"], "s1_guard_digest": s1_["guard_digest"], "h0_payload_sha256": s0_["payload_sha256"], "s1_payload_sha256": s1_["payload_sha256"], "readback_snapshot_sha256": L.snapshot_object_digest(s1_), "expected_delta_digest": plan["operation_set_digest"], "authority_version": L.AUTHORITY_VERSION, "coverage": {"s0": s0_["coverage"]["profile"], "s1": s1_["coverage"]["profile"]}, "is_human_approval": False}
    vr.update({k: d[k] for k in ("added", "removed", "changed", "creation_identity_map", "missing_expected", "unrelated", "applied_operation_ids", "unobserved_domains", "verdict")})
    vr.update(override or {})
    return vr


def forged_verified(plan, s0_, s1_, journal):
    """A verification object that CLAIMS the honest VERIFIED result over a different S1 (the attack shape)."""
    return dict(vr_ok, s1_guard_digest=s1_["guard_digest"], s1_payload_sha256=s1_["payload_sha256"], readback_snapshot_sha256=L.snapshot_object_digest(s1_))


vr_ok = make_vr(plan_m3, s0, s1, legal)
assert vr_ok["verdict"] == "VERIFIED" and vr_ok["creation_identity_map"] == {"op-1": "it-new"}, vr_ok
dump("fixtures/plan/m3-append-verification.json", vr_ok)
VX = {"plan": plan_m3, "s0": s0, "s1": s1, "journal": legal}


def vx(s1x, journal=None):
    return {"plan": plan_m3, "s0": s0, "s1": s1x, "journal": journal or legal_for(s1x)}


fixture("verification-derived-verified", "none", "provisional/resolveVerificationResult", vr_ok, check="semantic_verification_result", extra=VX)
vr_av = make_vr(plan_m3, s0, s1_av, legal_for(s1_av)); assert vr_av["verdict"] == "VERIFIED"
fixture("verification-derived-verified-append-verify-profile", "none", "provisional/resolveVerificationResult", vr_av, check="semantic_verification_result", extra=vx(s1_av))
fixture("verification-append-no-added-item-claims-verified", "semantic", "provisional/resolveVerificationResult", dict(forged_verified(plan_m3, s0, s1_noop, None), added=[], creation_identity_map={}), check="semantic_verification_result", expect_contains="differs from derived truth", extra=vx(s1_noop))
fixture("verification-derived-append-missing", "none", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_noop, legal_for(s1_noop)), check="semantic_verification_result", extra=vx(s1_noop))
for nm, s1x in (("unrelated-enabled-change", s1_extra), ("unrelated-source-bound-change", s1_srcbound), ("unrelated-timeline-dimension-change", s1_dims), ("unrelated-timeline-start-change", s1_tlstart), ("unrelated-timeline-end-change", s1_tlend), ("unrelated-timeline-settings-change", s1_settings), ("unrelated-track-topology-change", s1_topology), ("unrelated-track-name-change", s1_trackname), ("unrelated-marker-change", s1_marker), ("unrelated-media-dependency-change", s1_media)):
    dv = make_vr(plan_m3, s0, s1x, legal_for(s1x)); assert dv["verdict"] == "UNEXPECTED_DELTA", (nm, dv["verdict"], dv["unrelated"])
    fixture(f"verification-derived-{nm}", "none", "provisional/resolveVerificationResult", dv, check="semantic_verification_result", extra=vx(s1x))
    fixture(f"verification-hides-{nm}", "semantic", "provisional/resolveVerificationResult", forged_verified(plan_m3, s0, s1x, None), check="semantic_verification_result", expect_contains="differs from derived truth", extra=vx(s1x))
fixture("verification-arbitrary-s1-hash", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, s1_payload_sha256="9" * 64), check="semantic_verification_result", expect_contains="S1 digests do not resolve", extra=VX)
fixture("verification-arbitrary-readback-hash", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, readback_snapshot_sha256="9" * 64), check="semantic_verification_result", expect_contains="S1 digests do not resolve", extra=VX)
fixture("verification-s0-hash-not-plan-guard", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, h0_guard_digest=snap_b["guard_digest"], h0_payload_sha256=snap_b["payload_sha256"]), check="semantic_verification_result", expect_contains="guard mismatch", extra=VX)
fixture("verification-other-plan", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, plan_digest="9" * 64), check="semantic_verification_result", expect_contains="another plan", extra=VX)
fixture("verification-other-transaction", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, transaction_id="tx-other"), check="semantic_verification_result", expect_contains="another transaction", extra=VX)
fixture("verification-other-session", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, session_id=F.S_OLD), check="semantic_verification_result", expect_contains="session_id != plan", extra=VX)
fixture("verification-other-target", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, target=dict(TGT, timeline_unique_id="tl-OTHER")), check="semantic_verification_result", expect_contains="another target", extra=VX)
fixture("verification-delta-authority-mismatch", "semantic", "provisional/resolveVerificationResult", dict(vr_ok, expected_delta_digest="9" * 64), check="semantic_verification_result", expect_contains="expected-delta", extra=VX)
fixture("verification-s1-other-epoch", "semantic", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_other_epoch, legal_for(s1_other_epoch)), check="semantic_verification_result", expect_contains="target_epoch", extra=vx(s1_other_epoch))
fixture("verification-s1-from-other-session", "semantic", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_other_session, legal_for(s1_other_session)), check="semantic_verification_result", expect_contains="different session", extra=vx(s1_other_session))
fixture("verification-journal-readback-names-other-s1", "semantic", "provisional/resolveVerificationResult", vr_ok, check="semantic_verification_result", expect_contains="journal READBACK_S1", extra=vx(s1, legal_for(s1_noop)))
fixture("verification-without-readback-event", "semantic", "provisional/resolveVerificationResult", vr_ok, check="semantic_verification_result", expect_contains="no single READBACK_S1", extra=vx(s1, chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED"])))
fixture("verification-append-on-wrong-track-not-verified", "none", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_wrong_track, legal_for(s1_wrong_track)), check="semantic_verification_result", extra=vx(s1_wrong_track))
fixture("verification-append-wrong-media-not-verified", "none", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_other_media, legal_for(s1_other_media)), check="semantic_verification_result", extra=vx(s1_other_media))
fixture("verification-duplicate-identity-unobservable", "none", "provisional/resolveVerificationResult", make_vr(plan_m3, s0, s1_dup, legal_for(s1_dup)), check="semantic_verification_result", extra=vx(s1_dup))
assert L.verify_transaction(plan_m3, s0, s1_dup, legal_for(s1_dup))["verdict"] == "UNOBSERVABLE_STATE"
fixture("verification-duplicate-identity-claims-verified", "semantic", "provisional/resolveVerificationResult", forged_verified(plan_m3, s0, s1_dup, None), check="semantic_verification_result", expect_contains="differs from derived truth", extra=vx(s1_dup))
fixture("verification-duplicate-identity-reversed-claims-verified", "semantic", "provisional/resolveVerificationResult", forged_verified(plan_m3, s0, s1_dup_rev, None), check="semantic_verification_result", expect_contains="differs from derived truth", extra=vx(s1_dup_rev))
fixture("verification-claims-human-approval", "schema", "provisional/resolveVerificationResult", dict(vr_ok, is_human_approval=True), expect_contains="False")
fixture("verification-missing-applied-ops", "schema", "provisional/resolveVerificationResult", {k: v for k, v in vr_ok.items() if k != "applied_operation_ids"}, expect_contains="applied_operation_ids")
fixture("verification-missing-session", "schema", "provisional/resolveVerificationResult", {k: v for k, v in vr_ok.items() if k != "session_id"}, expect_contains="session_id")
# effect law: SET_PROPERTIES has no specified effect -> can never be VERIFIED
ops_sp = [dict(ops[0], operation_id="op-2", op="SET_PROPERTIES", selector=dict(sel_append, item_unique_id="it-1", expected_start=108000, expected_end=108347), expected_new={"ZoomX": {"$f64": "3ff0000000000000"}})]
plan_sp_body = dict(plan_body, operations=ops_sp, operation_set_digest=L.operation_set_digest(ops_sp)); plan_sp = dict(plan_sp_body, plan_digest=L.plan_digest_of(plan_sp_body), refs=PLAN_REFS)
legal_sp = chain(LEGAL_STATES, ops_=("op-2",), pd=plan_sp["plan_digest"], osd=plan_sp["operation_set_digest"], s1_=s1_noop)
for r in legal_sp:
    if r["op"]:
        r["op"] = "SET_PROPERTIES"
rechain(legal_sp)
vr_sp = make_vr(plan_sp, s0, s1_noop, legal_sp)
assert vr_sp["verdict"] == "EFFECT_NOT_SPECIFIED", vr_sp["verdict"]
fixture("verification-effect-not-specified-derived", "none", "provisional/resolveVerificationResult", vr_sp, check="semantic_verification_result", extra={"plan": plan_sp, "s0": s0, "s1": s1_noop, "journal": legal_sp})
fixture("verification-effect-not-specified-claims-verified", "semantic", "provisional/resolveVerificationResult", dict(vr_sp, verdict="VERIFIED", missing_expected=[]), check="semantic_verification_result", expect_contains="NOT_YET_SPECIFIED", extra={"plan": plan_sp, "s0": s0, "s1": s1_noop, "journal": legal_sp})
conflict_ok = {"schema": "vidtoolz.resolveConflict.v1", "transaction_id": "tx-fixture", "plan_digest": PDG, "code": "UNEXPECTED_DELTA", "drift_class": "POSITION_DRIFT", "object": {"item": "it-3"}, "expected": {"start": 108694}, "observed": {"start": 108700}, "policy": "REQUEST_RECONCILIATION", "next_action_non_mutating": "present to Mikko", "authority_effect": "NONE_UNTIL_HUMAN_ADJUDICATION", "resolved": True, "authority_version": L.AUTHORITY_VERSION}
fixture("conflict-bound-resolved", "none", "provisional/resolveConflict", conflict_ok, check="semantic_conflict", extra={"plan": plan_m3})
c = copy.deepcopy(conflict_ok); c["plan_digest"] = "9" * 64; fixture("conflict-other-plan", "semantic", "provisional/resolveConflict", c, check="semantic_conflict", expect_contains="not bound", extra={"plan": plan_m3})


def commit_for(vr, s1x, journal):
    return {"schema": "vidtoolz.resolveCommitManifest.v1", "transaction_id": "tx-fixture", "session_id": F.S_CUR, "plan_digest": PDG, "target": TGT, "authority_version": L.AUTHORITY_VERSION, "operation_set_digest": OSD, "terminal_state": "COMMITTED", "binding_observation_sha256": "5" * 64, "binding_set_digest": "2" * 64, "receipt_sha256": "6" * 64, "journal_head_sha256": L.journal_head(journal), "verification_result_sha256": L.digest(vr, "vidtoolz.resolveVerificationResult.v1"), "guard_digest": G, "s1_guard_digest": s1x["guard_digest"], "s1_snapshot_sha256": L.snapshot_object_digest(s1x), "unresolved_conflicts": [], "ef_source_pins": {}, "published_at": "2026-09-08T11:59:00Z"}


commit_ok = commit_for(vr_ok, s1, legal)
CX = {"plan": plan_m3, "journal": legal, "verification_result": vr_ok, "conflicts": [], "s0": s0, "s1": s1}
fixture("commit-linked-eligible", "none", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", extra=CX)
fixture("commit-verification-hash-only-object-missing", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="hash-only or partial input refused", extra=dict(CX, verification_result=None))
fixture("commit-without-s0-object", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="hash-only or partial input refused", extra=dict(CX, s0=None))
fixture("commit-without-s1-object", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="hash-only or partial input refused", extra=dict(CX, s1=None))
vr_bad = dict(forged_verified(plan_m3, s0, s1_noop, None), added=[], creation_identity_map={})
fixture("commit-verification-not-derived-truth", "semantic", "provisional/resolveCommitManifest", commit_for(vr_bad, s1_noop, legal_for(s1_noop)), check="semantic_commit_manifest", expect_contains="differs from derived truth", extra=dict(CX, verification_result=vr_bad, s1=s1_noop, journal=legal_for(s1_noop)))
fixture("commit-direct-false-verified-consistent-hashes", "semantic", "provisional/resolveCommitManifest", commit_for(forged_verified(plan_m3, s0, s1_srcbound, None), s1_srcbound, legal_for(s1_srcbound)), check="semantic_commit_manifest", expect_contains="differs from derived truth", extra=dict(CX, verification_result=forged_verified(plan_m3, s0, s1_srcbound, None), s1=s1_srcbound, journal=legal_for(s1_srcbound)))
fixture("commit-journal-invented-operation", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="not in the bound plan", extra=dict(CX, journal=(lambda b: (b[5].update(operation_id="op-9"), rechain(b))[1])(copy.deepcopy(legal))))
c = copy.deepcopy(commit_ok); c["s1_guard_digest"] = snap_b["guard_digest"]; fixture("commit-s1-guard-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="s1_guard_digest", extra=CX)
c = copy.deepcopy(commit_ok); c["s1_snapshot_sha256"] = "9" * 64; fixture("commit-s1-snapshot-digest-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="s1_snapshot_sha256", extra=CX)
c = copy.deepcopy(commit_ok); c["session_id"] = F.S_OLD; fixture("commit-session-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="session_id", extra=CX)
c = copy.deepcopy(commit_ok); c["operation_set_digest"] = "9" * 64; fixture("commit-operation-set-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="operation_set_digest", extra=CX)
c = copy.deepcopy(commit_ok); c["journal_head_sha256"] = "7" * 64; fixture("commit-journal-head-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="journal_head", extra=CX)
c = copy.deepcopy(commit_ok); c["target"] = dict(TGT, project_unique_id="proj-OTHER"); fixture("commit-target-mismatch", "semantic", "provisional/resolveCommitManifest", c, check="semantic_commit_manifest", expect_contains="target", extra=CX)
fixture("commit-with-unresolved-conflict-record", "semantic", "provisional/resolveCommitManifest", commit_ok, check="semantic_commit_manifest", expect_contains="unresolved conflict", extra=dict(CX, conflicts=[dict(conflict_ok, resolved=False)]))
c = copy.deepcopy(commit_ok); del c["s1_guard_digest"]; fixture("commit-missing-s1-guard", "schema", "provisional/resolveCommitManifest", c, expect_contains="s1_guard_digest")
c = copy.deepcopy(commit_ok); del c["s1_snapshot_sha256"]; fixture("commit-missing-s1-snapshot-digest", "schema", "provisional/resolveCommitManifest", c, expect_contains="s1_snapshot_sha256")
c = copy.deepcopy(commit_ok); del c["session_id"]; fixture("commit-missing-session", "schema", "provisional/resolveCommitManifest", c, expect_contains="session_id")


def linked(name, layer, ts, expect=None, evidence_set="write-ready-full", capabilities=HYP):
    dump(f"fixtures/linked-set/{name}.json", {"fixture": name, "layer_expected_failure": layer, "evidence_set": evidence_set, "capabilities": capabilities, "expect_error_contains": expect, "set": ts})


def ts_for(s1x, vr=None, journal=None, commit=True):
    j = journal or legal_for(s1x)
    v = vr or make_vr(plan_m3, s0, s1x, j)
    return {"s0_snapshot": s0, "plan": plan_m3, "journal": j, "s1_snapshot": s1x, "verification": v, "commit": (commit_for(v, s1x, j) if commit else None), "conflicts": [conflict_ok]}


TS_OK = ts_for(s1)
linked("linked-set-committed-consistent", "none", TS_OK)
linked("linked-set-committed-append-verify-profile", "none", ts_for(s1_av))
linked("linked-set-in-flight-no-s1", "none", dict(TS_OK, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED"]), s1_snapshot=None, verification=None, commit=None, conflicts=[]))
linked("linked-set-append-without-effect", "linked-set", ts_for(s1_noop, vr=vr_bad), "differs from derived truth")
linked("linked-set-append-without-effect-honest-verdict-no-commit", "linked-set", ts_for(s1_noop), "without VERIFIED")
for nm, s1x in (("unrelated-change-hidden", s1_extra), ("source-bound-unrelated-change", s1_srcbound), ("timeline-dimension-unrelated-change", s1_dims), ("timeline-start-unrelated-change", s1_tlstart), ("timeline-end-unrelated-change", s1_tlend), ("timeline-settings-unrelated-change", s1_settings), ("track-topology-unrelated-change", s1_topology), ("marker-unrelated-change", s1_marker), ("media-dependency-unrelated-change", s1_media)):
    linked(f"linked-set-{nm}", "linked-set", ts_for(s1x, vr=forged_verified(plan_m3, s0, s1x, None)), "differs from derived truth")
linked("linked-set-journal-invented-operation", "linked-set", dict(TS_OK, journal=(lambda b: (b[5].update(operation_id="op-9"), rechain(b))[1])(copy.deepcopy(legal))), "not in the bound plan")
linked("linked-set-journal-applied-without-started", "linked-set", dict(TS_OK, journal=(lambda b: ([r.update(sequence=i) for i, r in enumerate(b)], rechain(b))[1])([r for i, r in enumerate(copy.deepcopy(legal)) if i != 4])), "without a preceding OP_STARTED")
linked("linked-set-s1-arbitrary-hash", "linked-set", dict(TS_OK, verification=dict(vr_ok, s1_payload_sha256="9" * 64)), "S1 digests do not resolve")
linked("linked-set-s0-not-write-precheck", "linked-set", dict(TS_OK, s0_snapshot=snap_pos), "WRITE_PRECHECK")
linked("linked-set-s0-observed-fields-not-callable", "linked-set", TS_OK, "not callable", evidence_set="write-ready-base", capabilities="CAPABILITIES.json")
linked("linked-set-s0-observed-fields-without-provenance", "linked-set", dict(TS_OK, s0_snapshot=(lambda d: (d["collection"]["method_provenance"].pop("GetStartFrame"), resign(d))[1])(copy.deepcopy(s0))), "has no entry")
linked("linked-set-effect-not-specified-claims-verified", "linked-set", dict(TS_OK, plan=plan_sp, journal=legal_sp, s1_snapshot=s1_noop, verification=dict(vr_sp, verdict="VERIFIED", missing_expected=[]), commit=None, conflicts=[]), "NOT_YET_SPECIFIED")
linked("linked-set-verification-other-plan", "linked-set", dict(TS_OK, verification=dict(vr_ok, plan_digest="9" * 64)), "another plan")
linked("linked-set-guard-snapshot-stale", "linked-set", dict(TS_OK, s0_snapshot=snap_b), "STALE_SNAPSHOT")
linked("linked-set-plan-not-eligible-no-authorization", "linked-set", TS_OK, "MIKKO_M3_AUTHORIZATION", evidence_set="write-ready-without-authorization")
linked("linked-set-committed-journal-without-commit", "linked-set", dict(TS_OK, commit=None), "without a commit manifest")
linked("linked-set-unresolved-conflict", "linked-set", dict(TS_OK, conflicts=[dict(conflict_ok, resolved=False)]), "unresolved conflict")
linked("linked-set-schema-invalid-plan", "linked-set", dict(TS_OK, plan=dict(plan_m3, target_attachment_state="SCRATCH_WRITE_READY")), "schema/plan")
linked("linked-set-s1-other-epoch", "linked-set", ts_for(s1_other_epoch), "target_epoch")
# v1.5: journal/S1 binding, sessions, profiles, duplicates, direct false VERIFIED
linked("linked-set-journal-names-other-s1", "linked-set", dict(TS_OK, journal=legal_for(s1_noop), commit=commit_for(vr_ok, s1, legal_for(s1_noop))), "names a different S1")
linked("linked-set-s1-from-other-session", "linked-set", ts_for(s1_other_session, vr=forged_verified(plan_m3, s0, s1_other_session, None)), "different session")
linked("linked-set-missing-readback-event-with-verification", "linked-set", dict(TS_OK, journal=chain(["PREPARED", "LEASED", "PREFLIGHT_OK", "CHECKPOINTED", "OP_STARTED", "APPLIED"]), commit=None), "no single READBACK_S1")
linked("linked-set-s1-weaker-profile", "linked-set", ts_for(s1_weak, vr=forged_verified(plan_m3, s0, s1_weak, None)), "weaker than the required APPEND_VERIFY")
linked("linked-set-s1-incomplete", "linked-set", ts_for(s1_incomplete, vr=forged_verified(plan_m3, s0, s1_incomplete, None)), "requires a complete S1")
linked("linked-set-s1-minimal-m0-profile", "linked-set", ts_for(m0_snap, vr=forged_verified(plan_m3, s0, m0_snap, None)), "weaker than the required APPEND_VERIFY")
linked("linked-set-duplicate-occurrence-identity", "linked-set", ts_for(s1_dup, vr=forged_verified(plan_m3, s0, s1_dup, None)), "DUPLICATE_OCCURRENCE_IDENTITY")
linked("linked-set-duplicate-occurrence-identity-reversed", "linked-set", ts_for(s1_dup_rev, vr=forged_verified(plan_m3, s0, s1_dup_rev, None)), "DUPLICATE_OCCURRENCE_IDENTITY")
linked("linked-set-direct-false-verified-consistent-hashes", "linked-set", ts_for(s1_srcbound, vr=forged_verified(plan_m3, s0, s1_srcbound, None)), "differs from derived truth")
linked("linked-set-combined-weak-s1-other-session-hidden-change", "linked-set", ts_for((lambda d: (d["coverage"].update(FULL_COV, complete=True), d["collection"].update(session_id=F.S_OLD), resign(d))[2])(copy.deepcopy(s1_dims)), vr=forged_verified(plan_m3, s0, s1_dims, None)), "weaker than the required")
linked("linked-set-combined-duplicate-identity-other-session", "linked-set", ts_for((lambda d: (d["collection"].update(session_id=F.S_OLD), resign(d))[1])(copy.deepcopy(s1_dup)), vr=forged_verified(plan_m3, s0, s1_dup, None)), "DUPLICATE_OCCURRENCE_IDENTITY")
linked("linked-set-commit-without-s1", "linked-set", dict(TS_OK, s1_snapshot=None, verification=None), "INELIGIBLE without linked S1")
vr_ghost = dict(vr_ok, applied_operation_ids=sorted(set(vr_ok["applied_operation_ids"]) | {"op-ghost"}))
linked("linked-set-verification-ghost-applied-operation", "linked-set", dict(TS_OK, verification=vr_ghost, commit=commit_for(vr_ghost, s1, legal)), "applied_operation_ids differs from derived truth")
vr_hides_excl = dict(vr_ok, unobserved_domains=[])
linked("linked-set-verification-hides-unobserved-domains", "linked-set", dict(TS_OK, verification=vr_hides_excl, commit=commit_for(vr_hides_excl, s1, legal)), "unobserved_domains differs from derived truth")

# ============================================================ freeze manifest schema v1.5
man_schema = load("schemas/resolveFreezeManifest.schema.json")
man_schema["$id"] = "vidtoolz.resolveFreezeManifest.v1.10"; man_schema["title"] = "Freeze manifest v1.10"
man_schema["properties"]["schema"] = {"const": "vidtoolz.resolveFreezeManifest.v1.10"}; man_schema["properties"]["bundle"] = {"const": "docs/resolve-integration/v1.20"}; man_schema["properties"]["version"] = {"const": "1.20.0"}
man_schema["properties"]["parent"] = {"type": "object", "additionalProperties": False, "required": ["version", "branch", "head", "semantic_head", "manifest_sha256", "immutable", "ancestors"], "properties": {
    "version": {"const": "1.19.0"}, "branch": {"const": "docs/resolve-authority-freeze-v1.19"}, "head": {"const": "5efbcae6a36b76d4a359f3e65e503336576575c7"}, "semantic_head": {"const": "5efbcae6a36b76d4a359f3e65e503336576575c7"}, "manifest_sha256": {"const": "06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848"}, "immutable": {"const": True},
    "ancestors": {"type": "array", "minItems": 18, "items": {"type": "object", "additionalProperties": False, "required": ["version", "branch", "head", "manifest_sha256"], "properties": {"version": {"type": "string"}, "branch": {"type": "string"}, "head": {"type": "string", "pattern": "^[0-9a-f]{40}$"}, "manifest_sha256": SHA, "baseline": {"type": "string"}}}}}}
dump("schemas/resolveFreezeManifest.schema.json", man_schema)
# ============================================================ v1.7 TRUST ROOT 2: the internally pinned schema registry (C16-B2, sections 3/4/5)
# Written LAST, after every schema file this bundle publishes has been written, so it pins the exact bytes that ship.
SCHEMA_REGISTRY = L.compute_schema_registry()
dump(L.SCHEMA_REGISTRY_FILE, SCHEMA_REGISTRY)
L.clear_authority_caches()
assert L.schema_registry()["schema_registry_sha256"] == SCHEMA_REGISTRY["schema_registry_sha256"], "schema registry does not re-resolve against the files on disk"
assert SCHEMA_REGISTRY["schema_count"] >= 20, SCHEMA_REGISTRY["schema_count"]
reg_schema = S("vidtoolz.resolveSchemaRegistry.v1", "Schema registry v1.10 (the exact schema bytes this authority version validates against)",
               {"schema": {"const": L.SCHEMA_REGISTRY_VERSION}, "authority_version": {"const": L.AUTHORITY_VERSION}, "registry_version": {"const": L.SCHEMA_REGISTRY_VERSION}, "schema_count": POSINT,
                "schemas": {"type": "object", "additionalProperties": {"type": "object", "additionalProperties": False, "required": ["path", "sha256", "byte_count"], "properties": {"path": {"type": "string", "pattern": "^schemas/"}, "sha256": SHA, "byte_count": POSINT}}},
                "schema_registry_sha256": SHA},
               ["schema", "authority_version", "registry_version", "schema_count", "schemas", "schema_registry_sha256"],
               comment="v1.7 (C16-B2): in v1.6 every authorizing entry point took a caller-supplied schema_validate callback, so an always-empty, partial, wrong-schema or stale-schema callback authorized artifacts the real schemas reject. In v1.7 the authority owns the law: this registry maps artifact schema id -> exact schema bytes for THIS authority version, authority_lib.schema_registry() re-verifies every listed file's bytes and byte count on every resolution, internal_schema_errors() resolves schemas from it internally, and the authorizing functions have no validator parameter at all. Historical artifacts are validated against historical registries by historical_schema_errors(), which is INTERNAL_NON_AUTHORIZING.")
dump("schemas/resolveSchemaRegistry.schema.json", reg_schema)
# the registry schema is itself a schema file, so the registry must be regenerated once more to include it, then fixed
SCHEMA_REGISTRY = L.compute_schema_registry()
dump(L.SCHEMA_REGISTRY_FILE, SCHEMA_REGISTRY)
L.clear_authority_caches()
assert L.schema_registry()["schema_registry_sha256"] == SCHEMA_REGISTRY["schema_registry_sha256"]
assert L.SCHEMA_REGISTRY_FILE.removesuffix(".json") not in SCHEMA_REGISTRY["schemas"]
# ============================================================ section 27: the Codex v1.6 review matrix, machine readable
CODEX_FINDINGS = [
    {"id": "C16-B1", "severity": "BLOCKER",
     "codex_finding": "Content-insensitive authority caches allow stale or modified evidence, parser, spec, refreeze and matrix state to remain qualified.",
     "v16_defect": "capability_qualification memoized on (id(caps), id(es), id(rp), method, canon(active)); primitive_spec_digest on id(rp); the evidence-record index on id(es); parser_sha256 on a process-local flag. Mutating a qualified chain in place kept the warm result QUALIFIED_CALLABLE while a cold process refused it.",
     "correction": "Authority-result caching is keyed ONLY by content: content_key() = AUTHORITY_VERSION + content digests of matrix, read-primitive authority, evidence set, contract environment and active authority + the live parser identity + the trusted shim digest. The identity-keyed record index is gone: find_records re-derives record_id from current content on every call. parser_sha256 is keyed on the live parser code objects. clear_authority_caches()/authority_cache_stats() exist for warm/cold equality proofs.",
     "negative_fixture": "validate_v1_19.py section cache-mutation: nine in-place mutations of a qualified chain (raw->RAISED, primitive spec, review->REJECT, refreeze un-reviewed, matrix row demoted, stored derived edited, host_name, build, matrix evidence reference), each asserting warm == cold and NOT QUALIFIED, plus parser replacement, callable-set mutation and cross-evidence-set contamination.",
     "expected_layer": "capability (capability_qualification / callable_method_set)",
     "validation_sections": ["cache-law", "cache-mutation", "matrix-forgery-warm"]},
    {"id": "C16-B2", "severity": "BLOCKER",
     "codex_finding": "Caller-supplied schema-validator trust allows permissive or wrong validators to authorize invalid artifacts.",
     "v16_defect": "validate_transaction_set and commit_eligibility took schema_validate as a REQUIRED parameter, so an always-empty, partial, wrong-schema or permissive callback authorized a commit manifest carrying unapproved_authority_extension.",
     "correction": "SCHEMA-REGISTRY.json pins (authority_version, artifact_schema_id) -> exact schema bytes, digest and byte count. schema_registry() re-verifies every pinned file on every resolution; internal_schema_errors() resolves schemas internally; the authorizing signatures have NO validator parameter and refuse any extra positional or validator-named keyword by name. validate_transaction_set_diagnostic is INTERNAL_NON_AUTHORIZING and returns no eligibility. historical_schema_errors validates historical artifacts against historical registries only.",
     "negative_fixture": "validate_v1_19.py section validator-injection: five injected validators x (positional, keyword) x both entry points, five validator-named keywords, the diagnostic surface, and one changed byte of one pinned schema file making the whole registry untrusted.",
     "expected_layer": "schema (composed validation stage 3)",
     "validation_sections": ["validator-injection", "schema-registry"]},
    {"id": "C16-B3", "severity": "BLOCKER",
     "codex_finding": "Capture-shim digest is not bound to an exact trusted authority; a wrong shim SHA can still qualify.",
     "v16_defect": "A capture carried capture_shim_version and capture_shim_sha256 that nothing compared against anything, so a capture declaring capture_shim_sha256 = 000...0 qualified.",
     "correction": "TRUSTED-SHIM.json pins the one trusted shim: version, its own self-hash, its source path and source bytes, the allowlist digest, the codec, the raw schema and the raw-ingest version, closed by its own digest. trusted_capture_shim() re-verifies all of it against the files on disk. capture_shim_trust_errors() refuses any capture that does not match, the parser classifies such a capture SHIM_UNTRUSTED (family FATAL_TARGET_FAILURE), and the ACTIVE authority itself must name the trusted shim digest.",
     "negative_fixture": "validate_v1_19.py section shim-trust: wrong sha, stale build, unknown shim, same version with changed code, other codec, other raw schema, a method outside the trusted allowlist, an active authority missing or misnaming the trusted shim, and a whole chain over a wrong-shim capture.",
     "expected_layer": "capability (reference parser + record law)",
     "validation_sections": ["shim-trust"]},
    {"id": "C16-B4", "severity": "BLOCKER",
     "codex_finding": "Derived, review and refreeze substitutions can authorize because the exact stored chain is not always resolved and compared.",
     "v16_defect": "Qualification recomputed the derived result and compared digests, but never required the stored DERIVED_CAPABILITY_RESULT the chain claims to resolve by digest, and selected among multiple reviews or refreeze records without an explicit rule.",
     "correction": "resolve_stored_chain() resolves the EXACT stored artifacts one promoted evidence entry names: the single raw capture, the single stored derived record (by derived digest AND by record id, belonging to that raw, bound to the active parser and spec, byte-equal to the recomputation), the single CURRENT review referencing exactly that stored derived digest, and the single CURRENT reviewed refreeze record promoting exactly that triple. supersession_resolve() makes multiplicity a CONFLICT unless an explicit supersedes chain leaves exactly one record; insertion order never decides. A promoted row binds the whole chain (ENTRY_BOUND_FIELDS), including the refreeze BLOCK digest, the trusted shim identity and the probe/session.",
     "negative_fixture": "evidence sets attached-evidence-derived-artifact-missing, -derived-artifact-of-other-raw, -duplicate-current-review, -superseded-review, -conflicting-current-reviews, -duplicate-current-refreeze; plus entry-field-dropping and derived-record-substitution cases in section stored-chain.",
     "expected_layer": "capability (stored-chain resolution)",
     "validation_sections": ["stored-chain"]},
    {"id": "C16-M1", "severity": "MAJOR",
     "codex_finding": "Duplicate receiver paths can overwrite identity observations before uniqueness or stability derivation.",
     "v16_defect": "identity_claims built ids[path] = value, so a second observation of the same receiver path overwrote the first and the conflict disappeared; claim B was then asserted true. Stability was also asserted while uniqueness was false.",
     "correction": "identity_claim_inputs() builds each pass as an ORDERED LIST of observations; identity_claim_input_errors() validates receiver-path uniqueness, path/handle-token binding, path/identity-value agreement and getter-attempt-id uniqueness BEFORE any index exists. Any refusal yields no claims at all, claim C now requires claim B, and every pass must observe the same receiver-path set.",
     "negative_fixture": "validate_v1_19.py section identity-duplicates: duplicate path, path with two handle tokens, path with two identity values, duplicate attempt id, two paths returning one id, and a pass-set mismatch.",
     "expected_layer": "capability (identity evidence)",
     "validation_sections": ["identity-duplicates"]},
    {"id": "C16-M2", "severity": "MAJOR",
     "codex_finding": "Strict byte-level JSON ingestion is absent; a parsed-object API cannot detect duplicate keys or malformed raw-frame structure.",
     "v16_defect": "Raw captures entered the authority as already-parsed dictionaries. json.loads keeps the LAST duplicate key, so a frame with two 'method' keys would have been accepted with the attacker's value and nothing recorded that a strict parse ever happened.",
     "correction": "ingest_raw_frame() is the ONE canonical boundary: bytes -> strict single-object parse (duplicate keys, malformed UTF-8, byte-order mark, control characters, invalid number syntax, non-finite constants, trailing bytes, multiple values, non-object top level, oversized frame, unknown schema version) -> structure validation -> trusted-shim check -> content digest -> immutable record plus a strict-parse receipt. Every RAW_CAPABILITY_CAPTURE record must carry a receipt that closes over its own digest and names the exact frame bytes; a pre-parsed dictionary is inadmissible.",
     "negative_fixture": "validate_v1_19.py section raw-ingestion: thirteen malformed frames each asserting its closed RAW_INGEST_CODES refusal, plus records with a missing, mis-bound or non-strict receipt.",
     "expected_layer": "raw parse (byte boundary)",
     "validation_sections": ["raw-ingestion"]},
    {"id": "C16-M3", "severity": "MAJOR",
     "codex_finding": "Append-only evidence-root behaviour is documented but not implemented or testable as executable authority.",
     "v16_defect": "EVIDENCE-ROOT.md described the layout in prose. Nothing in the bundle could be run to prove that an evidence root refuses an overwrite, a reused attempt id, a record after finalization, or a replaced record.",
     "correction": "tools/evidence_store.py implements the law: session creation by mkdir, O_CREAT|O_EXCL writes at mode 0o400, content-addressed paths derived from digests the store computes itself, idempotence only for byte-identical content, attempt-id uniqueness via O_EXCL markers, atomic temp->hard-link->unlink writes, finalization into a self-digesting HASHES manifest plus a FINALIZED marker, a closed ERROR_CODES vocabulary, and verify() recomputing everything from bytes on disk. session_manifest_errors() binds a session to the active authority, registry, matrix, trusted shim, parser and primitive spec.",
     "negative_fixture": "validate_v1_19.py section evidence-store: session re-creation, caller-declared digest mismatch, attempt-id reuse, path traversal, unknown layer, symlinked session, write after finalization, re-finalization, replaced record bytes, tampered HASHES, removed record, unfinalized session, partially written record, mismatched pinned authority, and a static audit that no code path opens a record for writing, truncates, renames over one or unlinks one.",
     "expected_layer": "evidence store (byte layer)",
     "validation_sections": ["evidence-store"]},
]
S110_FINDINGS = [
    {"id": "S110-1", "severity": "BLOCKER",
     "codex_finding": "Session boundary not persisted or rechecked: after creation a session directory can be replaced, the same basename accepted under another root, root identity is absent from session semantic identity, and the session directory entry is not sufficiently rechecked on later operations.",
     "prior_defect": "v1.9's RootBoundary lived only in process memory. Reproduced against the frozen v1.9 bundle: replacing the session directory with another directory of the same basename and content verified clean, and copying the whole session under a second root verified clean. The evidence root was not part of the session identity tuple.",
     "correction": "create_session persists a SESSION_BOUNDARY receipt (BOUNDARY.json, mode 0o444, governed evidence) binding the configured root literal path, device and inode, the session basename, device and inode, the session id, the authority and store versions and the platform scope, closed by its own digest. boundary_identity() digests it into the session identity tuple, so the same bytes under another root or another directory inode are a different, invalid session. check_boundary() re-lstats the root AND the session directory against the receipt - path, device, inode, non-symlink type, directory type and frozen mode - before every authorizing operation, and fails closed with ROOT_IDENTITY_MISMATCH or SESSION_BOUNDARY_CHANGED.",
     "negative_fixture": "validate_v1_19.py section evidence-boundary-receipt: session directory replaced by another with the same basename, same-basename session under an alternate root, boundary receipt mutation and deletion, root replaced by symlink and by another directory, plus randomized boundary-replacement property tests.",
     "expected_layer": "evidence store (persisted boundary)",
     "validation_sections": ["evidence-boundary-receipt"]},
    {"id": "S110-2", "severity": "BLOCKER",
     "codex_finding": "Inventory and finalization semantics still partly self-asserted: directory semantic duplicates not fully rejected, attempt-ID duplicates survive where attempt-key duplicates do not, finalization marker store_version and authority_version are ignored, and some inventory semantic fields are not independently derived.",
     "prior_defect": "v1.9 recorded normative fields and then trusted them. Reproduced: mutating the finalization marker's evidence_store_version and authority_version left verify() returning clean.",
     "correction": "expected_model() rebuilds the whole semantic model from INDEPENDENT sources only - filesystem facts, record bytes, the session manifest, the boundary receipt and frozen store law - and never reads the inventory. verify_summary() then compares the stored inventory and finalization marker against that model field by field, including every inventory header field and every normative marker field. Directory kinds and modes are derived from path law, duplicates in entries, record keys, attempt keys and directories are refused before any index is built, and a published provenance table classifies every normative inventory field by source.",
     "negative_fixture": "validate_v1_19.py sections evidence-recomputed-model and evidence-finalization-fields: the seven-field finalization attack matrix, inventory header mutation, directory duplicate and conflicting-kind cases, and the provenance table assertion that no normative field is trusted from the inventory itself.",
     "expected_layer": "evidence store (recomputed model)",
     "validation_sections": ["evidence-recomputed-model", "evidence-finalization-fields"]},
    {"id": "S110-3", "severity": "BLOCKER",
     "codex_finding": "Stored attempt marker authority incomplete: the public attempt tuple API is enforced, but a foreign or pre-finalization attempt marker can be inserted and accepted, so the persisted layer is weaker than the API.",
     "prior_defect": "Reproduced: a syntactically valid marker naming another session was planted into an ACTIVE session, and the subsequent write, finalize and verify all succeeded.",
     "correction": "Stored markers are never trusted from filename or content. expected_model() derives, for every marker, the record path its tuple requires and matches it against the records actually present, and derives, for every record, the marker whose tuple recomputes that record's semantic key. The relation must be a bijection: a marker with no record is FOREIGN_ATTEMPT_MARKER, a record with no marker is ORPHANED_RECORD, a marker naming another session is FOREIGN_ATTEMPT_MARKER, and attempt ids are unique in addition to attempt keys (ATTEMPT_ID_DUPLICATE). This runs in the ACTIVE integrity check, so a corrupted ACTIVE session cannot progress to FINALIZED.",
     "negative_fixture": "validate_v1_19.py section evidence-attempt-derivation: foreign marker planted while ACTIVE, duplicate attempt id, orphaned record, marker field mutation property tests, and the cross-session ACTIVE insertion matrix.",
     "expected_layer": "evidence store (attempt marker derivation)",
     "validation_sections": ["evidence-attempt-derivation"]},
    {"id": "S110-4", "severity": "MAJOR",
     "codex_finding": "Mode authority incomplete before finalization: session-directory chmod is accepted, pre-finalization chmod can be accepted, and mode invariants are not enforced continuously.",
     "prior_defect": "Reproduced: chmod of the session directory on a finalized session verified clean, and chmod of a record while ACTIVE allowed the next write and a successful finalize.",
     "correction": "A frozen MODE_TABLE derives the expected mode of every governed entry from its KIND, including the evidence session directory, the layer, shard, attempts and temp directories, records, attempt markers, the manifest, the boundary receipt, the journal, the inventory and the finalization marker. expected_model() compares derived modes against the filesystem, so the check runs continuously from creation onward, and _require_can_write() refuses any further operation on a session whose modes have drifted.",
     "negative_fixture": "validate_v1_19.py section evidence-mode-authority: ACTIVE chmod of session directory, layer directory, manifest, record, attempt marker and journal each blocking the next canonical operation; the finalized chmod matrix retained; randomized permission-bit property tests in both states.",
     "expected_layer": "evidence store (continuous metadata authority, POSIX)",
     "validation_sections": ["evidence-mode-authority"]},
    {"id": "S110-5", "severity": "MINOR",
     "codex_finding": "Filesystem failures need deterministic conversion into frozen refusal classes rather than leaking platform or runtime exceptions.",
     "prior_defect": "Reproduced: a write into a layer directory with mode 0o000 raised a raw PermissionError out of the public authority path.",
     "correction": "One normalization boundary, fs(), wraps every os-level call, and ERRNO_TO_CODE maps ENOENT, EEXIST, ENOTDIR, EISDIR, ELOOP, EACCES, EPERM, ENAMETOOLONG, EXDEV, ENOTEMPTY, ENOSPC, EROFS and EOPNOTSUPP to frozen FS_* classes, with FS_UNAVAILABLE as the closed default. Programming defects are deliberately not caught and still surface.",
     "negative_fixture": "validate_v1_19.py section evidence-fs-errors: missing path, permission denied, symlink loop, wrong file type, name too long, cross-device, and concurrent disappearance, each asserting a frozen class and no raw OSError.",
     "expected_layer": "evidence store (filesystem error vocabulary)",
     "validation_sections": ["evidence-fs-errors"]},
]
S19_FINDINGS = [
    {"id": "S19-1", "severity": "BLOCKER",
     "codex_finding": "Path confinement fails when the session root itself is a symlink: internal symlinks are rejected, but canonicalization can accept a symlinked session directory before the root trust boundary is established.",
     "prior_defect": "v1.8 called os.path.realpath() on the configured root in EvidenceStore.__init__, create_session, open_session and _safe_join BEFORE any trust boundary existed. The symlink was resolved away and never seen, so a session could be created, finalized and verified through a symlinked evidence root (reproduced against the frozen v1.8 bundle).",
     "correction": "RootBoundary establishes the trust boundary FIRST: lstat on the configured root with no resolution, refusing ROOT_SYMLINK_REFUSED for a symlink and ROOT_NOT_A_DIRECTORY otherwise, then lstat on the session directory entry itself (SESSION_SYMLINK_REFUSED). The boundary keeps the literal path, never a resolved one, and records the root's device and inode; every later operation re-checks them, so replacing the root between operations is ROOT_REPLACED. Reads use O_NOFOLLOW.",
     "negative_fixture": "validate_v1_19.py section evidence-root-trust: symlinked evidence root and symlinked session root refused at create, open, finalize and verify; root replaced by a symlink and by another directory between operations; non-directory root.",
     "expected_layer": "evidence store (root trust boundary)",
     "validation_sections": ["evidence-root-trust"]},
    {"id": "S19-2", "severity": "BLOCKER",
     "codex_finding": "The finalized inventory verifies bytes, files and directories but does not fully reconcile semantic identity between session manifest, inventory, stored records, layer, logical identity, attempt identity and session identity. A renamed or cross-session directory can still validate.",
     "prior_defect": "v1.8 reconciled paths, digests and byte counts only. Renaming a finalized session directory left verify() returning clean while the manifest still named the old session (reproduced). Nothing bound a record to its layer, its logical identity or its session.",
     "correction": "A frozen session identity tuple (session id, probe id, authority version and manifest, store version, host/product/version/build, library, trusted shim, primitive spec, schema registry, directory basename) is digested into session_identity_sha256 and carried by the manifest, the inventory and the finalization marker. The session directory basename IS the session id (policy A) and the verifier recomputes it. Every record's storage name is its semantic key, recomputed from (session, layer, logical identity, content digest), and the inventory records layer, logical identity, attempt ids and keys, and record-internal session and probe ids, all reconciled at verification.",
     "negative_fixture": "validate_v1_19.py sections evidence-session-identity and evidence-semantic-inventory: renamed session, cross-session copies of the whole session, the inventory alone, the marker alone, one record and the manifest; wrong layer; wrong logical identity; tampered internal session id.",
     "expected_layer": "evidence store (semantic reconciliation)",
     "validation_sections": ["evidence-session-identity", "evidence-semantic-inventory"]},
    {"id": "S19-3", "severity": "BLOCKER",
     "codex_finding": "Attempt IDs are effectively digest-bound rather than bound to the tuple of session, layer, logical identity, attempt ID and record bytes, permitting identity and layer collision cases.",
     "prior_defect": "v1.8 kept one marker per attempt id whose content was only a digest. Reusing an attempt id in another layer with the same bytes was accepted and produced a SECOND distinct record rather than being idempotent or refused (reproduced).",
     "correction": "The canonical attempt key is the tuple (session_id, layer, logical_identity, attempt_id), bound to the record bytes. The marker carries the whole tuple, so reuse under a different layer is ATTEMPT_ID_CROSS_LAYER, under a different logical identity is ATTEMPT_ID_CROSS_IDENTITY, under a different session is SESSION_IDENTITY_MISMATCH, and the same tuple with different bytes is ATTEMPT_ID_REUSED. Only the identical tuple with identical bytes is idempotent. A logical identity is now required on every write. Attempt indexes are built from a list and duplicate tuple keys refuse before any map exists.",
     "negative_fixture": "validate_v1_19.py section evidence-attempt-tuple: the full collision table plus RAW attempt reused in DERIVED, DERIVED reused in HUMAN_REVIEW, one digest under two logical identities, one record's bytes in two layers, one attempt id across two sessions, and duplicate attempt keys in an inventory.",
     "expected_layer": "evidence store (attempt identity)",
     "validation_sections": ["evidence-attempt-tuple"]},
    {"id": "S19-4", "severity": "MAJOR",
     "codex_finding": "Direct chmod or permission mutation after finalization is not detected. The store need not prevent hostile filesystem tampering, but verification must detect all frozen metadata that authority claims to preserve.",
     "prior_defect": "v1.8 recorded no filesystem metadata in the inventory, so chmod of a record, a directory, the inventory or the finalization marker after finalization left verify() returning clean (reproduced).",
     "correction": "Canonical modes are set explicitly with chmod after creation rather than left to the umask (directories 0o700, records 0o400, attempt markers 0o400, session manifest 0o444, inventory 0o444, finalization marker 0o444, journal 0o600). File type and permission mode are recorded for every governed file and directory and reconciled at verification as MODE_MISMATCH. Only POSIX type and permission bits are frozen: no inode, no timestamps, no owner.",
     "negative_fixture": "validate_v1_19.py section evidence-mode-authority: chmod of a record, a layer directory, the session manifest, the inventory and the finalization marker; a regular file replaced by another filesystem type.",
     "expected_layer": "evidence store (metadata authority, POSIX)",
     "validation_sections": ["evidence-mode-authority"]},
]
ES_FINDINGS = [
    {"id": "ES-1", "severity": "BLOCKER",
     "codex_finding": "The normative evidence-store verifier ignores unexpected files placed in a finalized session root.",
     "prior_defect": "v1.7 verify() enumerated only the four evidence layers plus a fixed set of known names. A file planted in the finalized session ROOT after finalization was not looked at at all, so verify() returned no errors: independent attack STORE-14 passed. A file planted inside a layer directory was noticed only incidentally and mis-reported as PARTIAL_RECORD, which describes a torn write rather than a hostile addition. An unexpected DIRECTORY was ignored entirely.",
     "correction": "Finalization is now a CLOSED WORLD. finalize() enumerates every governed entry - every file and every directory, at every depth - hashes all bytes, and records the complete allowed inventory in INVENTORY.json (path, kind, layer, digest, byte count, schema type, logical identity, attempt ids, plus the expected directory set), self-digesting and read-only, with a FINALIZED marker naming that inventory digest. verify() walks the whole tree and compares EXPECTED against ACTUAL, requiring missing == 0, unexpected == 0 and changed == 0. An unknown file or directory anywhere under the session root is UNEXPECTED_ENTRY. Nothing is ignored.",
     "negative_fixture": "validate_v1_19.py section evidence-closed-world: the pinned STORE-14 regression (finalize, plant an unexpected root file, verify) plus unexpected nested file, unexpected directory, extra RAW record, extra DERIVED record, altered record, deleted record, renamed record, altered inventory and altered finalization receipt.",
     "expected_layer": "evidence store (closed-world verification)",
     "validation_sections": ["evidence-closed-world", "evidence-store"]},
    {"id": "ES-2", "severity": "BLOCKER",
     "codex_finding": "A legacy/competing EvidenceRoot surface remains in tools/capture_shim_reference.py; its add_derived() path accepts traversal such as '../../...' and lacks the verification/finalization guarantees of the normative evidence_store.py.",
     "prior_defect": "The capture shim carried a second evidence-storage implementation with its own layout, its own path construction and no verification, no inventory and no closed-world finalization. All FOUR of its write entry points built a filesystem path by interpolating a caller-supplied string (add_capture from raw_digest, add_derived from raw_capture_sha256, add_review and add_refreeze from record_id), so each of them escaped the evidence root on '../../x'. Two competing storage authorities existed for the same evidence.",
     "correction": "EvidenceRoot is REMOVED from the capture shim, which now captures facts and serializes frames and never creates a directory, derives an evidence path or writes evidence. tools/evidence_store.py is the single EVIDENCE_STORE_AUTHORIZING implementation. Its write API takes a layer, a logical identity and bytes - never a path - and derives the content-addressed destination itself (put_raw / put_derived / put_review / put_promotion). Every caller-supplied identifier passes one NAME_RE logical-name gate and a resolved-path containment proof before any filesystem use.",
     "negative_fixture": "validate_v1_19.py sections evidence-single-authority (static audit: exactly one EVIDENCE_STORE_AUTHORIZING module, EvidenceRoot absent, no storage primitives in the shim) and evidence-traversal (the exact legacy attack plus twelve traversal, absolute-path, separator, symlink, dot, empty and over-long identifier shapes against every write API, each proving no file appears outside the session root).",
     "expected_layer": "evidence store (path law) / authority surface",
     "validation_sections": ["evidence-single-authority", "evidence-traversal"]},
]

F110_FINDINGS = [
    {"id": "F110-A", "severity": "BLOCKER",
     "codex_finding": "The boundary receipt contains normative fields that can be consistently rewritten and still authorize: schema, evidence_store_version, authority_version, platform_scope and created_at are stored and digested but never compared to anything outside the receipt.",
     "prior_defect": "Reproduced against the frozen v1.10 bundle at 9c66434: for each of the five fields, an ACTIVE session's BOUNDARY.json was edited, boundary_sha256 was recomputed with the bundle's own boundary_digest(), the canonical 0o444 mode was restored, and the next put_raw() SUCCEEDED in all five cases. v1.10's boundary_receipt() checked only the field SET and the receipt's own digest, so a self-consistent forgery - a receipt claiming another schema, another evidence-store version, another authority version or WINDOWS platform scope - authorized every subsequent operation. INVENTORY-FIELD-PROVENANCE.json published four of them as FROZEN_CONSTANT while nothing compared them.",
     "correction": "BOUNDARY_PROVENANCE classifies every BOUNDARY.json field with EXACTLY ONE of DERIVED_FROM_FILESYSTEM, DERIVED_FROM_SESSION_AUTHORITY, FROZEN_CONSTANT or INFORMATIONAL_NON_AUTHORIZING; there is no ambiguous category and the table is asserted complete against BOUNDARY_FIELDS. _boundary_receipt() now reconciles the four FROZEN_CONSTANT fields against BOUNDARY_FROZEN_CONSTANTS - EVIDENCE_BOUNDARY_SCHEMA, EVIDENCE_STORE_VERSION, authority_lib.AUTHORITY_VERSION and PLATFORM_SCOPE - applies a structural type law to every remaining field, and enforces the L5 internal coherence session_id == session_basename. check_boundary() keeps the already-passing DERIVED_FROM_FILESYSTEM reconciliation of root path/device/inode and session basename/device/inode against a fresh lstat. created_at is DELIBERATELY classified INFORMATIONAL_NON_AUTHORIZING (option A): this store governs no independent creation-event authority, so it is type-checked, excluded from boundary_identity() and the session identity, still covered by boundary_sha256 for byte integrity, and a consistent rewrite of it explicitly does not refuse. boundary_sha256 is documented as byte integrity over the stored receipt and never as semantic truth: authorization requires the stored receipt AND independent reconciliation.",
     "negative_fixture": "validate_v1_19.py section evidence-boundary-fields: the full receipt attack matrix - all twelve normative fields mutated one at a time with a recomputed boundary_sha256 and the canonical mode restored, each refusing the next canonical operation inside the frozen BOUNDARY precedence class; created_at asserted to behave exactly as its documented informational law (consistent rewrite authorizes, unrecomputed edit refuses as byte tampering, excluded from boundary_identity); four structural attacks (non-string created_at, non-integer inode, empty root path, session_id/session_basename disagreement); an extra and a removed receipt field; and a Store.v4 receipt refused under v1.11. Section property adds 24 seeded single-field mutations.",
     "expected_layer": "evidence store (boundary receipt reconciliation)",
     "validation_sections": ["evidence-boundary-fields", "evidence-boundary-receipt", "evidence-provenance"]},
    {"id": "F110-B", "severity": "BLOCKER",
     "codex_finding": "The inventory contains six normative header/path fields that are not independently compared - record_count, entry_count, total_bytes, attempt_count, self_path and finalized_marker_path - and an extra semantic header field can survive verification.",
     "prior_defect": "Reproduced against the frozen v1.10 bundle at 9c66434: for each of the six fields, a FINALIZED session's INVENTORY.json was edited, inventory_sha256 was recomputed with the bundle's own inventory_digest(), the FINALIZED marker's inventory_sha256 reference was updated, both canonical 0o444 modes were restored, and verify() returned CLEAN in all six cases. A syntactically valid extra top-level semantic field also verified clean. v1.10's verify_summary() compared nine header fields and the mode table and simply never looked at the other six, and it accepted any superset of the field set - while INVENTORY-FIELD-PROVENANCE.json published all six as DERIVED_FROM_FILESYSTEM or FROZEN_CONSTANT.",
     "correction": "INVENTORY_FIELDS freezes the EXACT top-level inventory vocabulary and INVENTORY_FIELD_SET is compared before any field is interpreted: a missing normative field, an unknown extra semantic field or a wrong type is INVENTORY_FIELD_SET_INVALID, and a duplicate top-level key is already refused by authority_lib.strict_loads at the parse boundary. All six fields are then RECOMPUTED and compared for exact equality: record_count and attempt_count from the KIND_RECORD and KIND_ATTEMPT_MARKER entries of the independent expected_model(), entry_count from the length of the governed entry set, total_bytes from the byte_count sum over the frozen TOTAL_BYTES_SCOPE (every governed regular file except INVENTORY.json and FINALIZED, which finalization itself creates), and self_path and finalized_marker_path from the frozen INVENTORY_FILE and FINALIZED_FILE store-layout constants. expected_model() is NOT redesigned - Codex confirmed its independence passes - it is only consumed. Semantic extension now requires a schema version, which is why resolveEvidenceInventory.v3 became v4. FINALIZATION_FIELDS names the nine finalization fields explicitly without redesigning the marker format.",
     "negative_fixture": "validate_v1_19.py section evidence-inventory-fields: the six-field mutation matrix (each mutated field with a recomputed inventory digest AND an updated finalization reference, overstated and understated), the extra-semantic-field attack, a removed normative field, five wrong-type attacks, a duplicate top-level key, an assertion that the frozen vocabulary partitions exactly into the reconciliation routes, and an assertion that expected_model() still consumes no inventory or finalization claim. Section property adds 24 seeded counter perturbations.",
     "expected_layer": "evidence store (inventory header reconciliation / field vocabulary)",
     "validation_sections": ["evidence-inventory-fields", "evidence-recomputed-model", "evidence-finalization-fields", "evidence-provenance"]},
    {"id": "F110-C", "severity": "BLOCKER",
     "codex_finding": "Attempt marker/record reconciliation checks semantic derivation but not exact one-to-one cardinality: two distinct attempt ids over the same session, layer, logical identity and record bytes create two markers resolving to one content-addressed record, and finalization and verify() still pass.",
     "prior_defect": "Reproduced against the frozen v1.10 bundle at 9c66434: put_raw(\"a1\", B, logical_identity=\"L\") followed by put_raw(\"a2\", B, logical_identity=\"L\") both SUCCEEDED and returned the SAME record_key; active_integrity() was clean, attempts() listed both, finalize() succeeded, verify() was clean, and the stored inventory recorded record_count 1 with attempt_count 2 and the record carrying attempt_ids [a1, a2]. v1.10 required every marker to resolve to a record whose key recomputes from its tuple, and every record to have AT LEAST one such marker, but never required exactly one - so the published one-to-one claim was false in the many-to-one direction.",
     "correction": "L7 is now a BIJECTION with EXACT cardinality in both directions. expected_model() computes the set of valid markers claiming each authoritative record: zero is ORPHANED_RECORD (retained) and more than one is MARKER_CARDINALITY_VIOLATION, so a persisted many-to-one state is refused by active_integrity(), session_state(), finalize(), verify_summary() and every write, which all consume the same model. _put() additionally refuses the second attempt id BEFORE anything is persisted: after _require_can_write() has established that every existing record already has exactly one marker, an existing record at the computed content-addressed path whose marker is not this attempt's own marker means another attempt owns it. With cardinality one, a record's attempt_ids and attempt_keys are exactly one value each. Every already-passing attempt law is retained unchanged: same-tuple/same-bytes idempotence, same-tuple/different-bytes ATTEMPT_ID_REUSED, cross-layer and cross-identity refusals, the record-key law, content addressing, foreign-marker detection, orphan detection and duplicate persisted attempt ids.",
     "negative_fixture": "validate_v1_19.py section evidence-marker-cardinality: the pinned second-write attack (refused MARKER_CARDINALITY_VIOLATION with the ATTEMPTS directory asserted unchanged, so no ambiguous state is persisted), a manually planted second valid marker on an ACTIVE session (refused by ACTIVE integrity, session_state INVALID, finalize and further writes refused), the same planted twin on an ALREADY FINALIZED session (refused by verify()), and eleven retained-law regressions including idempotence, cross-layer, cross-identity, different-identity-same-bytes, foreign markers and orphans. Section property adds 8 seeded sessions over random bytes and identities.",
     "expected_layer": "evidence store (attempt marker bijection)",
     "validation_sections": ["evidence-marker-cardinality", "evidence-attempt-derivation", "evidence-attempt-tuple", "evidence-provenance"]},
    {"id": "F110-D", "severity": "MERGE MAJOR / M0A MAJOR",
     "codex_finding": "Several public authority-bearing read/model methods do not perform the required boundary recheck first: attempts(), expected_model(), manifest() and identity() return live data after session replacement, and inventory() checks finalization state first and answers SESSION_NOT_FINALIZED, masking the boundary violation.",
     "prior_defect": "Reproduced against the frozen v1.10 bundle at 9c66434 by replacing the session directory with a copy (a new inode, same basename and content): attempts(), expected_model(), manifest(), identity(), manifest_sha256(), scan_tree(), boundary_receipt() and authority_errors() all RETURNED LIVE AUTHORITY-BEARING DATA, identity_errors() returned CLEAN, and inventory() and finalization_marker() answered SESSION_NOT_FINALIZED - masking a session substitution with a state error. Only check_boundary(), active_integrity(), verify(), verify_summary() and session_state() refused. The reproduction found four unchecked surfaces beyond the five Codex named.",
     "correction": "PUBLIC_AUTHORITY_METHODS is an explicit inventory built by discovery, asserted COMPLETE against dir(EvidenceStore) and split into raising readers, reporting readers, writers and properties, with PUBLIC_NON_AUTHORITY naming record_path and the construction attributes as the only non-authority-bearing public members. Every authority-bearing member checks the persisted boundary FIRST: members that return data raise, and members whose contract is to return a refusal list or a state label express the boundary refusal first in their own vocabulary. The previously unchecked internals became private (_boundary_receipt, _scan_tree, _manifest, _manifest_sha256, _inventory, _finalization_marker, _identity_errors, _finalized) with checked public wrappers, because check_boundary() is built from them. ERROR_PRECEDENCE freezes BOUNDARY > SESSION_STATE > MODEL > READ with ERROR_PRECEDENCE_CLASS naming the codes of each class, so a lower class can never be reported while a higher one holds; inventory() and finalization_marker() therefore answer the boundary refusal and no longer mask it.",
     "negative_fixture": "validate_v1_19.py section evidence-public-surface: the method inventory asserted complete against dir(EvidenceStore), the private/wrapper split asserted, the frozen precedence asserted, a source-level assertion that every public authority-bearing reader checks the boundary or delegates to one that does, and the full post-replacement negative test over EVERY discovered method on both an ACTIVE and a FINALIZED session, plus the specific assertion that inventory() no longer answers SESSION_NOT_FINALIZED. Section property adds 6 seeded replaced sessions x 6 sampled methods.",
     "expected_layer": "evidence store (public authority surface / error precedence)",
     "validation_sections": ["evidence-public-surface", "evidence-provenance", "property"]},
]

V112_FINDINGS = [
    {"id": "V112-1", "severity": "BLOCKER (AUTHORITY_UNDERSPECIFIED)",
     "codex_finding": "v1.11 froze the resolveEvidenceSet schema, the record_id law, make_record(), envelope validation, all three record shapes and the attachment derivation - and proved them correct - but froze no governed persistence location for the evidence-set document, no writer, no permission law and no production constructor. ATTACHMENT_READY was therefore reachable only from fixtures.",
     "prior_defect": "Reproduced twice operationally: two A2 repair cycles failed the same way, writing Store.v5 session objects where registered evidence-set records were required, because an implementer had to invent the container mapping. The only reference record constructor was tools/fixture_evidence.py, which FREEZE-MANIFEST.json labels 'TOOL: mints fixture evidence ... never an authority', and make_record/record_id were absent from AUTHORITY_SURFACE entirely.",
     "correction": "ONE normative topology: QUALIFICATION_EVIDENCE_ROOT/attachment/<current_session_id>/{EVIDENCE-SET.json, WORKFLOW.json, LOCK}, derived from the session id alone. Directory 0700, document 0600 while writable and 0400 once VERIFIED. Every write is an atomic sibling-temp + fsync + os.replace under an O_EXCL writer lock recording the holder's principal and pid. WORKFLOW.json records governed_root and session_id, and loading refuses SET_LOCATION_MISMATCH when the derived path is not where the document was found, so a copied or moved document is not authority. A session id must be a safe basename, so the path law cannot be escaped. The two container models are deliberately NOT merged: this module never creates, opens, finalizes or reads a Store.v5 session, and current_session_id remains a LABEL naming the Resolve session under evaluation.",
     "negative_fixture": "validate_v1_19.py section workflow-persistence: forbidden-location and absoluteness assertions, seven path-escape session ids, a copied document refused SET_LOCATION_MISMATCH, a held lock refusing a second writer LOCK_HELD, lock release, SET_EXISTS and SET_NOT_FOUND.",
     "expected_layer": "pre-M0A workflow (governed persistence)",
     "validation_sections": ["workflow-persistence", "workflow-static"]},
    {"id": "V112-2", "severity": "BLOCKER (AUTHORITY_UNDERSPECIFIED)",
     "codex_finding": "The evidence-set document had no ACTIVE/finalized lifecycle, so nothing sequenced the preparer against the verifier and nothing prevented a stale or post-verification write.",
     "prior_defect": "v1.11 had no state at all on this document. A verifier could only attest to inputs that remained editable, and the failed repair imported the Store.v5 finalization law into a place it does not apply - which is why a FINALIZED store session was mistaken for a blocker on BUNDLE_VERIFICATION.",
     "correction": "OPEN -> PREPARED -> VERIFIED, with writes granted by (state, role) and VERIFIED granting nothing to any role, so there is no append-after-finalization path and no successor-document mechanism is needed. mark_prepared() requires exactly one PROVISIONING_RECORD and one LAUNCH_RECIPE and seals prepared_content_sha256 over both record ids; add_bundle_verification() seals evidence_set_sha256 over the whole document and re-checks it on every load. The governed derivation entry point additionally refuses a document whose evaluated_at is older than MAX_OBSERVATION_AGE_S or more than 60s in the future (SET_STALE). authority_lib's derivation, which has no concept of a governed document, is untouched by the staleness law.",
     "negative_fixture": "validate_v1_19.py section workflow-lifecycle: the preparer refused every record type after PREPARED, PREPARED not re-enterable, mark_prepared without both records, no write of any kind after VERIFIED, second verification refused, sealed modes and sealed digest asserted; sections workflow-e2e-negative stale document, future document, tamper-after-verification for both preparer records.",
     "expected_layer": "pre-M0A workflow (document lifecycle)",
     "validation_sections": ["workflow-lifecycle", "workflow-e2e-negative"]},
    {"id": "V112-3", "severity": "BLOCKER (AUTHORITY_UNDERSPECIFIED)",
     "codex_finding": "Nobody was designated to author any record, and verifier independence rested on `verifier != prepared_by` - a lexical inequality between two self-declared free-text strings that one actor could satisfy alone.",
     "prior_defect": "The v1.11 threat model documented this as a process mitigation rather than a mechanism, which was honest but left the operational role separation unenforceable: any non-empty string differing from prepared_by satisfied the gate, and no tool owned the write.",
     "correction": "A frozen principal registry of role-bound labels '<ROLE>:<actor>' (PRINCIPALS.json), with no ACTOR permitted in two roles (role_separation_errors asserted empty). WRITE_GRANTS gives the PREPARER exactly LAUNCH_RECIPE / PROVISIONING_RECORD / READ_ONLY_JOURNAL, the VERIFIER exactly BUNDLE_VERIFICATION and the APPROVER none. Every writing entry point stamps the principal for the ONE role it implements and routes through a single _authorize choke point, so a preparer cannot author a bundle verification and a verifier cannot author a preparer record. The derivation now requires both principals to be registered under exactly their role and to be DIFFERENT ACTORS. Envelope fields are derived from the target contract, the active authority, the provisioning record and the document; a caller may supply only sequence and captured_at and is refused FORBIDDEN_ENVELOPE_INPUT otherwise. HONESTY: a principal is an operational label, not an authenticated identity - no key, no signature, no certificate - and a human who runs both tools is still one human (THREAT-MODEL.md).",
     "negative_fixture": "validate_v1_19.py section workflow-principals: seven invalid principals refused PRINCIPAL_INVALID, a PREPARER refused BUNDLE_VERIFICATION, a VERIFIER refused every preparer entry point, role separation asserted, frozen grants asserted; section workflow-e2e-negative unauthorized verifier, unregistered verifier principal, same-actor principals, preparer self-verification; the ready-self-verified-bundle fixture now collapses BOTH the free-text pair and the registered principals to the preparer.",
     "expected_layer": "pre-M0A workflow (principal and write-permission law)",
     "validation_sections": ["workflow-principals", "workflow-e2e-negative"]},
    {"id": "V112-4", "severity": "BLOCKER (AUTHORITY_UNDERSPECIFIED)",
     "codex_finding": "No production law permitted any actor or workflow to author a BUNDLE_VERIFICATION after another actor prepared the A2 evidence, and no positive ATTACHMENT_READY state was reachable without fixture synthesis. Fixture/runtime parity was false.",
     "prior_defect": "Classified NO_WRITE_WORKFLOW_IS_FROZEN in the A2 canonical-workflow adjudication. The record form was fully specified and demonstrably correct, but nothing said who could write it, where, or in what order - the single reason A2 could not lawfully reach ATTACHMENT_READY.",
     "correction": "tools/a2_verify.py is the ONE production path that authors a BUNDLE_VERIFICATION, named A2V and governed as a DISTINCT human authorization (not A2, not A1, not M0B). It requires a registered VERIFIER principal of a different actor than the preparer and a document in PREPARED. Everything the record asserts is computed by the verifier itself: the manifest digest from this bundle's own FREEZE-MANIFEST.json, the nine target-contract pinned file digests hashed from disk, the exact provisioning and launch record ids read from the document, and the preparer principal read from the workflow transitions. add_bundle_verification takes NO caller-supplied result, principal-pair, record ids or digest map. The record gains verification_result (only PASS satisfies the gate; a FAIL record is written for audit and refused), verifier_principal, preparer_principal, verified_provisioning_id, verified_launch_recipe_id and pinned_file_digests, and derive_attachment_state binds all of them - including that the digest map equals the contract's own pinned set and that the named launch recipe is the one that resolves for the session. The v1.11 body fields are retained verbatim. The evidence-set schema id moves to vidtoolz.resolveEvidenceSet.v1.12 because its accepted instance set changed; the envelope law, the record_id law and every other record shape are unchanged.",
     "negative_fixture": "validate_v1_19.py section workflow-e2e-positive: the MANDATORY end-to-end runtime path using only production tools derives ATTACHMENT_READY, plus the same path driven through both CLIs; section workflow-e2e-negative: 28 cases, none of which may derive ATTACHMENT_READY; section workflow-parity: the production record field sets are asserted identical to the fixture field sets for all four record types, so no positive state is reachable from a shape production cannot build.",
     "expected_layer": "pre-M0A workflow (BUNDLE_VERIFICATION write authority)",
     "validation_sections": ["workflow-e2e-positive", "workflow-e2e-negative", "workflow-parity", "workflow-static"]},
]

V113_FINDINGS = [
    {"id": "V112-RP1", "severity": "BLOCKER (WORKFLOW_CONTRADICTORY)",
     "codex_finding": "Runtime-parity oracle FAIL. The v1.12 production APIs and CLIs accepted arbitrary evidence roots AND symlinked evidence roots, and a complete workflow under such a forbidden root still derived ATTACHMENT_READY. This contradicted the frozen v1.12 law that there is exactly one governed attachment evidence root. Consequences: MERGE BLOCKED, A2 and A2V NOT AUTHORITY_READY, ATTACHMENT_READY FAIL, A1 authority-ready NO.",
     "prior_defect": "Reproduced against the frozen v1.12 bundle at 73150d00: `a2_prepare.py adopt/prepare --evidence-root /tmp/<dir>` followed by `a2_verify.py verify --evidence-root /tmp/<dir>` printed `derived state ATTACHMENT_READY`, and the same sequence with the root pointing at a SYMLINK also printed ATTACHMENT_READY, with both documents living under /tmp. Root cause: every authorizing function in tools/evidence_authoring.py took `root=None` and both CLIs took `--evidence-root`, introduced deliberately so the validation suite could exercise the real code in a temporary directory. The test convenience was placed on the AUTHORIZING surface, so the law lived only in prose while the code let any caller choose the authority location. governed_root(root) also called os.path.abspath on the caller's value and never classified the entry, so a symlink was followed rather than refused.",
     "correction": "Root selection is removed from the authorizing surface entirely. authority_lib freezes GOVERNED_ATTACHMENT_ROOT and GOVERNED_ROOT_MODE; evidence_authoring.governed_attachment_root() takes NO ARGUMENT; no authorizing function and neither CLI accepts root, evidence_root, output_root, base_dir, directory, path, dir or prefix, and the preparer's Resolve-library option was renamed --library-root so no production CLI carries an option literally called --root. require_governed_root() classifies the root ENTRY with lstat before anything is resolved - absolute, already normalised, existing, a directory, not a symlink, mode 0700 - and only afterwards consults realpath as an alias check; the module contains no .resolve() call. require_governed_session_dir() applies the same no-follow law to <root>/<session_id> plus the basename, containment and alias checks. Both run on EVERY authorizing load, so update, verify, finalize and derive are as protected as create, and the authorizing derivation additionally requires the document's recorded authority_root to equal the frozen constant and written_under_production_root to be true. Scratch roots for the suite live in tools/evidence_authoring_testkit.py (AUTHORITY_CLASS INTERNAL_NON_AUTHORIZING), which neither CLI imports, which refuses to sandbox the frozen root, and whose documents the authorizing derivation refuses; the sandbox changes the root prefix ONLY, so every trust, lifecycle, principal, TOCTOU and freshness check runs unchanged on the same code.",
     "negative_fixture": "validate_v1_19.py sections root-law (the pinned v1.12 attack invocations now rejected by argument parsing; symlinked root refused before any write; file/mode/absent root entries; symlinked session directory refused on load and on derive; relocation to /tmp, a sibling root and an alternate user path; the production path refusing outright when the frozen root is absent; the full session-id reject list), root-parity (the sandbox differs in prefix only, and a mechanically sound sandboxed document is refused by the authorizing derivation), root-property (24 seeded root/symlink/relocation/sibling-prefix/relative/normalisation attacks and 40 seeded session-id shapes) and root-static (ten audits including no authorizing root parameter, one governed constant, no symlink-follow-before-check, no /tmp production path, no Store.v5 or EKA root, derive and verify both re-checking the canonical location, and the test override being unreachable from production).",
     "expected_layer": "pre-M0A workflow (governed evidence-set location)",
     "validation_sections": ["root-law", "root-parity", "root-property", "root-static"]},
]
V114_FINDINGS = [
    {"id": "V113-B1", "severity": "BLOCKER (AUTHORIZING LOCATION BYPASS)",
     "codex_finding": "Direct calls to authority_lib.derive_attachment_state() and authority_lib.evaluate_eligibility() - the two functions the v1.13 AUTHORITY_SURFACE declared AUTHORIZING - consume a forbidden-location sandbox evidence set and return ATTACHMENT_READY and eligible=true, bypassing the v1.13 wrapper-level governed-location law entirely. 93 of 96 checks passed; one BLOCKER and one MINOR.",
     "prior_defect": "Reproduced against the frozen v1.13 bundle at 65895c6dedceadff012a08c1bafcdf9e92b65221 before anything was changed. A complete, mechanically perfect workflow authored under a sandbox root - the exact document evidence_authoring.derive_attachment_state() refuses with NOT_PRODUCTION_ROOT - was passed straight to the core: authority_lib.derive_attachment_state(tc, es, active) returned ATTACHMENT_READY and authority_lib.evaluate_eligibility(..., es, active) returned eligible=true with derived_attachment_state ATTACHMENT_READY. Root cause: v1.13 fixed V112-RP1 in the authoring wrapper, one layer above the authority. The core took a bare evidence-set dict and knew nothing about where it came from, so every v1.13 control was real and every one of them sat on a layer an attacker did not have to use. Same class as V112-RP1: a law enforced in exactly one place is a property of that place, not of the authority. The MINOR: EVIDENCE-SET-WORKFLOW.json still carried a stale test_root_override claim that the authoring API accepts a root parameter, which it has not since v1.13.",
     "correction": "Location reconciliation is now part of the authorizing core. authority_lib.load_governed_evidence_set(session_id, active) is the ONLY door: it takes a session id and the active authority and nothing else, derives the canonical path from the frozen constant, classifies the root, session and document entries with lstat before anything is resolved, reads the document only from the path it computed, compares the document's own recorded location and session identity against where it was found, requires the recorded authority_root to be the frozen constant and written_under_production_root to be true, re-checks the bytes against the digest sealed at VERIFIED, and mints a location receipt under the registered domain vidtoolz.resolveLocationReceipt.v1. It returns a GovernedEvidenceSet whose __init__ refuses without a module-private token and which has __slots__ and no instance dict, so a dict, a namespace object, a subclass or a hand-computed receipt cannot fabricate provenance. derive_attachment_state_authorizing and evaluate_eligibility_authorizing (plus their by-session-id forms) accept ONLY that object and call governed_provenance_errors() FIRST, which re-derives every location fact from the live filesystem, so precedence is LOCATION AUTHORITY -> ATTACHMENT SEMANTICS -> ELIGIBILITY and a forbidden-location set never reaches readiness computation. The eligibility gate has no attachment-state parameter and recomputes the state itself, so no precomputed or diagnostic state can bootstrap it; it is fail-closed with reason code LOCATION_AUTHORITY_INVALID. derive_attachment_state and evaluate_eligibility are DEMOTED to a new AUTHORITY_SURFACE key, diagnostic_non_authorizing, with NON-AUTHORIZING stated in their own docstrings; their behaviour is unchanged. The authoring layer now delegates to the core's single implementation of the root resolver, the session-id law and the directory-entry trust check, keeping its earlier checks as DEFENCE IN DEPTH rather than as the only guard, and its own realpath alias check is gone because the core performs it. The stale test_root_override key is removed.",
     "negative_fixture": "validate_v1_19.py sections core-bypass (the exact Codex reproduction pinned as one check that asserts the wrapper's refusal, the diagnostic ATTACHMENT_READY and the authorizing refusal together; eight escalation payloads including a precomputed state, the diagnostic result, a fully populated provenance dict, a namespace object and a token-less subclass; the relocation and symlink attacks against the core; the testkit's own document), core-authority (the surface split, the callable surface, no root parameter anywhere, the override-free root resolver, the un-fabricable provenance object, the receipt's domain and separation, the closed refusal vocabulary), core-positive (the MANDATORY positive control at the REAL canonical governed root: ATTACHMENT_READY with authorizing=true and eligible=true with reason code ELIGIBLE, the by-session-id paths, wrapper agreement, the same bytes relocated refused, a symlinked session directory at the canonical path refused and the refusal disappearing when the real directory is restored, a stale provenance object refused, and the whole tree removed in a finally), core-callgraph (the in-core consumer graph by AST: the diagnostic derivation is called only by the authorizing derivation and the diagnostic eligibility, that only by semantic_mutation_plan, that only by the M3 composed path; both CLIs reach authority through the wrapper; neither imports the testkit), core-selflocation, core-property (24 seeded forbidden-root/precomputed/diagnostic-result/raw-dict/symlink/sibling-prefix cases and 40 seeded session ids) and core-static (the eight audits, including that authorizing eligibility cannot accept a raw or precomputed state, that the diagnostic functions declare themselves NON-AUTHORIZING, that there is exactly one root resolver and one entry-trust implementation, that the core imports neither the authoring layer nor the testkit, that fixture helpers are not on the authority surface, and that the stale test_root_override text is gone).",
     "expected_layer": "authorizing core (location authority before attachment semantics)",
     "validation_sections": ["core-authority", "core-bypass", "core-positive", "core-callgraph", "core-selflocation",
                             "core-property", "core-static"]},
]
V115_FINDINGS = [
    {"id": "V114-B1", "severity": "BLOCKER (consumed evidence not bound to the validated governed bytes)",
     "codex_finding": "The governed carrier has slots but is mutable. Its evidence_set slot can be replaced after canonical loading. Live provenance reopens and hashes canonical EVIDENCE-SET.json against governed.document_sha256, but authorizing derivation consumes governed.evidence_set without proving that it is the object parsed from those checked bytes: validation applies to byte stream A while authorization consumes object B.",
     "prior_defect": "Reproduced against the frozen v1.14 bundle at b61f248238ec7ed60deca79aa9728ec0cde86edd before anything was changed, in its sharpest form: two governed sessions were authored at the real canonical root, A fully verified (ATTACHMENT_READY) and B prepared only (PROVISIONED_NOT_VERIFIED); B was loaded; A's evidence set was assigned to B's carrier by ordinary slot assignment; governed_provenance_errors returned [] and derive_attachment_state_authorizing returned ATTACHMENT_READY with authorizing=true, carrying B's own receipt and B's canonical document path while reporting A's session id. That is a FALSE ATTACHMENT_READY under valid governed provenance. In-place mutation of the carrier's stored dict (records 4 -> 0) also passed provenance and changed the derived state.",
     "correction": "The carrier holds the exact validated BYTES and no parsed object. __slots__ drops evidence_set and gains document_bytes plus ten provenance fields; the object is frozen after construction (__setattr__/__delattr__ refuse GOVERNED_EVIDENCE_INVALID); evidence_set is a read-only property that strict-parses those bytes afresh on every access and returns a new object; __copy__, __deepcopy__ and __reduce__ refuse, so provenance cannot be cloned out of the loader. A new registered domain vidtoolz.resolveEvidenceSetSnapshot.v1 digests the PARSED content, and that digest is recorded on the carrier and bound into the location receipt. authority_lib.governed_consume(governed, active) is now THE one way an authorizing path obtains semantic evidence: on every call it validates the carrier structurally, revalidates the whole live location, re-reads BOTH authority files no-follow, requires the live digests to equal the minted ones AND the carrier's own bytes to digest identically, strict-parses those exact bytes, schema-validates the parse, requires its snapshot digest to equal the receipt-bound one, re-checks the self-location/production-root/sealed-digest claims, recomputes the receipt, and RETURNS the semantic object. Every authorizing entry point consumes that return value; governed.evidence_set appears in none of them. No authorizing entry point takes a carrier AND a separate evidence argument: there is exactly one evidence authority input.",
     "negative_fixture": "validate_v1_19.py section b1-consumed-evidence: immutability of every field, the reparsing property, the single-evidence-source signature audit, a four-step forced-attribute matrix (object.__setattr__ forcing bytes, then digest, then snapshot digest, then receipt of the READY session onto the PREPARED session's carrier - none authorizes), object-identity independence (two carriers for one document are different objects with identical digests and identical results), the source-order proof that the consumed object is the parse of the bytes just read, post-load mutation of the live document refused by derivation, eligibility AND commit, restoration of the exact bytes restoring authority, and a held carrier authorizing nothing once its session is removed; section b1-positive: the MANDATORY positive control at the REAL canonical governed root; section v115-property: 32 seeded cases; section v115-static: the end-to-end statement of the law itself.",
     "expected_layer": "authorizing core (consumed evidence bound to validated bytes)",
     "validation_sections": ["b1-consumed-evidence", "b1-positive", "v115-property", "v115-static"]},
    {"id": "V114-B2", "severity": "BLOCKER (diagnostic eligibility reaching commit authority)",
     "codex_finding": "The active transaction/commit authorizers retain a raw evidence-set path. A complete transaction fixture supplied with a bare evidence dict reaches diagnostic eligible=true, passes plan validation, and produces commit_eligibility.eligible=true with all twelve stages completed. This is not a display-only result: diagnostic eligibility influences mutation-plan acceptance and yields a positive commit decision.",
     "prior_defect": "Reproduced against frozen v1.14 with the exact artifacts Codex named - fixtures/linked-set/linked-set-committed-consistent.json, fixtures/evidence/write-ready-full.json and fixtures/eligibility/capabilities-hypothetical-refreeze.json, evidence supplied as a bare dict: validate_transaction_set returned [] with stages ['evidence_authority','capability_provenance','schema','s0','plan','journal','s1','delta','effects','verification','conflicts','commit'] and commit_eligibility returned eligible=true. v1.14 had recorded this path as a scoped residual; the final decision it produces is a commit decision, so Codex's BLOCKER classification is correct.",
     "correction": "validate_transaction_set_authorizing and commit_eligibility_authorizing are added and require a GovernedEvidenceSet: they consume the bytes-bound snapshot from governed_consume and refuse GOVERNED_EVIDENCE_REQUIRED before any stage runs. semantic_mutation_plan stays INTERNAL_NON_AUTHORIZING but chooses its eligibility law BY TYPE - governed carrier -> evaluate_eligibility_authorizing, bare dict -> the diagnostic gate - never by a caller-supplied callback, which would be the C16-B2 defect class. validate_transaction_set and commit_eligibility are DEMOTED to a fourth surface class, provisional_until_m3_non_authorizing, with the demotion stated in their own docstrings; their behaviour is unchanged and every inherited transaction and commit regression still runs against them. The twelve stages, their order, the internally pinned schemas, S0/S1, journal, delta, effects, verification, conflicts and H0 are untouched: v1.15 adds a provenance gate in front of them and changes no stage law, which is asserted by running both validators over the same legitimate governed carrier and requiring identical stage errors.",
     "negative_fixture": "validate_v1_19.py section b2-transaction-authority: the exact Codex reproduction retained as a control on the demoted pair (12/12 stages, composed eligible=true), the authorizing pair refusing the same bare dict with GOVERNED_EVIDENCE_REQUIRED and zero stages, a five-payload diagnostic-poison matrix (diagnostic eligibility result, diagnostic derivation result, a bare eligible=true dict, the raw evidence dict, the diagnostic transaction result), the type-dispatch audit, the unchanged-stage-law audit, and the refusal of extra positional or keyword arguments on the authorizing pair; section v115-property: seeded diagnostic-into-commit injection; section v115-static: the AST call-graph audit.",
     "expected_layer": "authorizing transaction / commit boundary (governed provenance before plan acceptance)",
     "validation_sections": ["b2-transaction-authority", "v115-property", "v115-static"]},
    {"id": "V114-B3", "severity": "BLOCKER (active authority naming diagnostic entrypoints)",
     "codex_finding": "The Python surface registry and the M0A binding use the v1.14 split, but the active TARGET-CONTRACT.json (attachment_derivation), PERMISSIONS.json (eligibility law), TARGET-ATTACHMENT-GATE.md and ELIGIBILITY.md still designate the raw diagnostic functions as current/reference authority. Mutually contradictory current instructions coexist, and authority selection is itself an authorizing decision; the report declined to pick a winner and treated the contradiction as blocking.",
     "prior_defect": "Reproduced against frozen v1.14 by scanning the active artifacts: TARGET-CONTRACT.json named derive_attachment_state at three places including the attachment_derivation binding, PERMISSIONS.json named evaluate_eligibility in its eligibility law, TARGET-ATTACHMENT-GATE.md named derive_attachment_state as the state function, and ELIGIBILITY.md named evaluate_eligibility as the reference evaluator and derive_attachment_state as the state source.",
     "correction": "All four now designate the AUTHORIZING entry points, and the diagnostic pair appears only AS diagnostic - in TARGET-CONTRACT.json in its own field, attachment_derivation_diagnostic_non_authorizing, whose text the schema pins so the classification cannot drift back. AUTHORITY-PRECEDENCE.json carries a blanket clause: where an earlier superseded statement names one of the four bare-evidence functions as the authority of its era, that name now reads as its authorizing counterpart, and S62 records the change. EVIDENCE-SET-WORKFLOW.json and M0A-BINDING-VALUES.json publish all four surface classes from the code itself, so the machine artifacts cannot disagree with the registry.",
     "negative_fixture": "validate_v1_19.py section b3-active-naming: an audit that scans EVERY current top-level artifact, machine and prose (50+ documents, not the four Codex found - the precedence table does not even list TARGET-CONTRACT.json or PERMISSIONS.json, so scanning only that table would have missed the defect), requiring that no current artifact names a diagnostic or provisional-until-M3 function except in a clause that marks it as such; the four named artifacts asserted individually; every authority-designated name asserted to be on the authorizing surface and every demoted name asserted not to be; the code registry, the workflow law and the M0A bindings asserted to publish identical class lists; section v115-static: no diagnostic name in any authorizing registry slot.",
     "expected_layer": "active authority bindings (authority selection)",
     "validation_sections": ["b3-active-naming", "v115-static"]},
    {"id": "V114-B4", "severity": "BLOCKER (governed loader following a symlinked WORKFLOW.json)",
     "codex_finding": "Root, session and EVIDENCE-SET.json receive lstat-first checks. WORKFLOW.json is checked only for existence and then opened through strict_load, which follows a symlink. WORKFLOW supplies authority-bearing session/location and evidence-set claims used during provenance minting and records lifecycle/handoff state, so redirecting that read lets foreign bytes participate in authority. Result: ACCEPTED_WORKFLOW_SYMLINK; the loader returned a GovernedEvidenceSet.",
     "prior_defect": "Reproduced against frozen v1.14 at the real canonical root: with a valid EVIDENCE-SET.json in place, WORKFLOW.json was replaced by a symlink to a marked foreign file outside the governed root; load_governed_evidence_set returned a GovernedEvidenceSet and derive_attachment_state_authorizing returned ATTACHMENT_READY with authorizing=true. Two further consequences of the same missing law were found that the report did not name: a FIFO at that path BLOCKED THE AUTHORITY INDEFINITELY (open() never returns), and a directory raised a raw IsADirectoryError out of the loader.",
     "correction": "One authority-FILE law for both governed files, implemented once in the core and used by both the core and the authoring wrapper: governed_file_errors lstat-classifies the ENTRY before anything is opened (symlink -> <KIND>_SYMLINK_REFUSED and never followed; FIFO, socket, device or directory -> <KIND>_NOT_A_REGULAR_FILE and never opened; then the alias check), and read_governed_file opens with O_NOFOLLOW and O_NONBLOCK and re-verifies the OPEN FILE by fstat for regular type and matching device and inode, so an entry swapped between check and open is refused rather than trusted. location_errors now checks both files. WORKFLOW.json's bytes are digested, bound into the location receipt and re-checked on every authorizing call, so a post-handoff replacement is detected. evidence_authoring._load was corrected to use the same law, because a defence the core performs and the wrapper does not is the same asymmetry mirrored.",
     "negative_fixture": "validate_v1_19.py section b4-workflow-file: a six-case substitution matrix (symlink outside the governed root, symlink to the sibling EVIDENCE-SET.json, symlink to another governed session's workflow, FIFO, directory, dangling symlink), each required to be refused with the exact frozen code by the loader, by the authoring wrapper AND by the published location predicate, with every call bounded by an alarm so a hang cannot be mistaken for a refusal; the receipt-binding assertions; post-load replacement detected; the same law asserted for the evidence document; section v115-property: seeded WORKFLOW path and file-type cases; section v115-static: the no-follow audit.",
     "expected_layer": "governed location (authority-file entry trust)",
     "validation_sections": ["b4-workflow-file", "v115-property", "v115-static"]},
    {"id": "V114-M1", "severity": "MERGE MAJOR (malformed nominal carrier leaking a raw exception)",
     "codex_finding": "object.__new__(GovernedEvidenceSet) creates an uninitialised nominal instance that passes isinstance. Provenance validation dereferences the missing session_id and leaks a raw AttributeError at both public authorizing boundaries; copy, deepcopy and pickle reach the same nominal state. Malformed external input escapes the frozen result vocabulary and turns an authority decision into an uncontrolled runtime failure.",
     "prior_defect": "Reproduced against frozen v1.14 exactly as reported: g = object.__new__(GovernedEvidenceSet) passed to derive_attachment_state_authorizing and to evaluate_eligibility_authorizing raised AttributeError: 'GovernedEvidenceSet' object has no attribute 'session_id' from both.",
     "correction": "governed_structure_errors validates the input's exact type (a subclass is refused) and every field with getattr defaults and type checks BEFORE any dereference, and it is called FIRST inside governed_consume, which every authorizing entry point uses. A nominal instance, a subclass, missing slots, None slots, wrong-typed slots and a malformed receipt all fail closed as GOVERNED_EVIDENCE_INVALID; __copy__, __deepcopy__ and __reduce__ refuse so the constructor cannot be bypassed by cloning; and _safe_session_id is used in the refusal payload so even the error path cannot dereference unsafely. Only malformed AUTHORITY INPUT is normalised: a genuine programming error - a wrong-arity call, an unserialisable value - still raises, preserving the v1.10 programming-error distinction, and that distinction is asserted rather than asserted-away.",
     "negative_fixture": "validate_v1_19.py section m1-malformed-carrier: a ten-case matrix run against all THREE public authorizing boundaries (attachment derivation, eligibility, commit eligibility) requiring a frozen refusal and no raw exception from each; the exact Codex reproduction pinned separately with its GOVERNED_EVIDENCE_INVALID code; the structure-validator-runs-first source assertion; the programming-error distinction; and the frozen-vocabulary membership of all four new codes; section v115-property: seeded malformed-slot and wrong-type carriers.",
     "expected_layer": "authorizing core (input validation / fail-closed vocabulary)",
     "validation_sections": ["m1-malformed-carrier", "v115-property", "v115-static"]},
    {"id": "V114-N1", "severity": "MINOR (canonicalization documentation omitting a registered hash domain)",
     "codex_finding": "The code registers vidtoolz.resolveLocationReceipt.v1 but CANONICALIZATION.md's closed registered-domain list omits it. No runtime bypass was demonstrated, but the closed-domain authority claim is inaccurate and impairs independent verification.",
     "prior_defect": "Reproduced against frozen v1.14 by comparing authority_lib.HASH_DOMAINS with the document. The gap was WIDER than reported: the location-receipt domain plus vidtoolz.resolveEvidenceSessionIdentity.v2, resolveEvidenceRecordKey.v1, resolveEvidenceAttemptKey.v1 and resolveEvidenceBoundary.v1 were absent, and resolveEvidenceSession and resolveEvidenceInventory were documented at superseded versions (.v2 and .v1 against the code's .v4), while the document claimed a closed list.",
     "correction": "CANONICALIZATION.md now names every registered domain, including the new vidtoolz.resolveEvidenceSetSnapshot.v1, and says what the two governed-location domains bind. The hash law itself is unchanged. Section hash-domain-parity compares the documented list with authority_lib.HASH_DOMAINS exactly in BOTH directions - no code domain missing from the document, no documented domain the code does not register (the typed-value codec is documented as a codec, not a digest domain) - and the document itself records that this comparison exists, so the omission cannot recur silently.",
     "negative_fixture": "validate_v1_19.py section hash-domain-parity: both-direction set equality, the published parity claim, the two governed-location domains documented with what they bind, and the assertion that the receipt digest, the snapshot digest and the evidence-set record digest are three different domains.",
     "expected_layer": "documentation / authority claim consistency",
     "validation_sections": ["hash-domain-parity", "v115-static"]},
]
V116_FINDINGS = [
    {"id": "V115-B1", "severity": "BLOCKER (active authority classification contradiction)",
     "codex_finding": "Two independent contradiction groups remain in current authority. (1) TARGET-CONTRACT.json:5 says attachment state is derived by tools/authority_lib.py#derive_attachment_state, and line 167 says it is computed by derive_attachment_state; both are current normative contract fields and neither marks that function diagnostic/non-authorizing, and the corrected authorizing field at line 169 and the diagnostic warning at line 242 do not erase these conflicting current statements. (2) SCHEMA-REGISTRY.md:8-11 names validate_transaction_set_authorizing / commit_eligibility_authorizing as the authorizing pair and then states that 'those two' are PROVISIONAL_UNTIL_M3 and non-authorizing, directly contradicting the executable surface and the correct law later in the same document. The candidate static check misses the TARGET-CONTRACT contradiction because it excludes fields such as qualification_note and generic law from its active-name invariant. Affected gates: MERGE, ATTACHMENT_READY, A1 authority readiness, and PRE-M3 (the active transaction-surface classification).",
     "prior_defect": "Reproduced against the frozen v1.15 bundle before anything was changed, at the exact key paths Codex named. TARGET-CONTRACT.json#qualification_note read 'library root_path/instance_uuid/launch recipe are required future observations, not fabricated; attachment state is derived by tools/authority_lib.py#derive_attachment_state from a validated evidence set, never declared' with no diagnostic marking. TARGET-CONTRACT.json#attachment_law read '... computed by derive_attachment_state ...' with no diagnostic marking. SCHEMA-REGISTRY.md carried the sentence '... since v1.15 the authorizing pair is validate_transaction_set_authorizing / commit_eligibility_authorizing and those two are PROVISIONAL_UNTIL_M3 and non-authorizing ...', which is the inverse of AUTHORITY_SURFACE. The executable classification itself was correct in v1.15 and remains correct: this is a frozen-statement defect, and authority selection is itself an authorizing decision.",
     "correction": "ONE canonical machine-readable classification, generated rather than restated: AUTHORITY-FUNCTION-CLASSES.json is produced from tools/authority_lib.py#AUTHORITY_SURFACE via #authority_function_classes(), publishing one function -> one class for all twelve names in #CLASSIFIED_DECISION_FUNCTIONS, the four class definitions (#FUNCTION_CLASS_LAW), the per-class inventories, the AUTHORIZING-SLOT and DIAGNOSTIC-SLOT inventories by exact artifact key path, the runtime-lookup law, and the generated receipt binding. The three contradictory statements are corrected at their exact key paths: qualification_note and attachment_law now name #derive_attachment_state_authorizing and #derive_attachment_state_for_session and mark the bare function DIAGNOSTIC / NON_AUTHORIZING, and the SCHEMA-REGISTRY sentence now says it is the LEGACY BARE-EVIDENCE pair that is PROVISIONAL_UNTIL_M3 and non-authorizing. The invariant that missed the defect is made EXHAUSTIVE: key-name exemptions drop from twenty (including law, note, qualification_note, reason) to seven that self-declare as a demoted-function inventory or as history, each of which is separately asserted to match the canonical map, and the scanner now also catches MODULE-QUALIFIED references (authority_lib.derive_attachment_state) that the v1.15 lookbehind let through. Running it exhaustively surfaced four further stale statements in generated values - EVIDENCE-SET-WORKFLOW.json#read_only_journal.law, M0A-BINDING-VALUES.json#values.verification_result_law and #values.toctou_law, and the FREEZE-MANIFEST per-file note for TARGET-CONTRACT.json - all corrected. The provisional pair KEEPS its exact class and its behaviour: it was not relabelled to eliminate the contradiction. No runtime law changed, and the runtime-lookup audit proves no authorizing code can resolve a function by name from an artifact.",
     "negative_fixture": "validate_v1_19.py section b1-classification: the canonical map generated from the executable surface with the four classes asserted disjoint and all twelve decision functions asserted class-by-class; the two TARGET-CONTRACT key paths asserted individually, including that no unmarked bare name survives in either; the SCHEMA-REGISTRY sentence asserted with clause-bounded negative regexes in both directions; every AUTHORIZING slot asserted to name an authorizing function with any demoted name only inside a clause that declares it demoted; every DIAGNOSTIC slot asserted to name only demoted functions; cross-artifact reconciliation of every classification claim in every current machine artifact against the canonical map and the code; the runtime-lookup audit (no getattr on the module, no eval/exec/importlib, the single globals() lookup proved to be parser_sha256 over the frozen module constant PARSER_FUNCTION_NAMES, and no artifact key that names a function read by runtime code); and the frozen-parent reproduction, which asserts the contradiction IS present in v1.15 and absent here, plus the v1.15 audit's own blind spot; section b1-property: 24 seeded (demoted function x authorizing slot) pairs and the exhaustive artifact coverage count; section v116-static: one class per reference, TARGET-CONTRACT and SCHEMA-REGISTRY agreement, and no contradiction hidden behind precedence.",
     "expected_layer": "active authority publication (authority selection)",
     "validation_sections": ["b1-classification", "b1-property", "v116-static"]},
    {"id": "V115-M1", "severity": "MERGE MAJOR (machine-readable receipt binding omits three runtime-bound fields)",
     "codex_finding": "EVIDENCE-SET-WORKFLOW.json:71-82 publishes a machine-readable receipt.binds list containing only the seven v1.14 fields. Runtime location_receipt (authority_lib.py:302) binds ten fields, additionally including workflow_path, workflow_sha256 and evidence_snapshot_digest. Adjacent prose accurately claims those bindings, so executable enforcement is stronger than the stale machine list and no false authorization was demonstrated. Nevertheless the frozen machine authority gives an incomplete receipt domain and must be corrected before merge. Add the exact three active fields and add bidirectional code/document parity validation. Affected gate: MERGE.",
     "prior_defect": "Reproduced against the frozen v1.15 bundle: EVIDENCE-SET-WORKFLOW.json#core_authority.receipt.binds == ['session_id','document_path','governed_root','authority_version','manifest_sha256','document_sha256','location_validated'] (7), while authority_lib.location_receipt digested ['session_id','document_path','workflow_path','governed_root','authority_version','manifest_sha256','document_sha256','workflow_sha256','evidence_snapshot_digest','location_validated'] (10). The three omitted fields are exactly workflow_path and workflow_sha256 (added by v1.15 V114-B4, which made WORKFLOW.json governed evidence) and evidence_snapshot_digest (added by v1.15 V114-B1, the digest of the parse of the validated bytes). A consumer recomputing the receipt from frozen machine authority would have digested seven fields and disagreed with every receipt the authority mints.",
     "correction": "The publication is GENERATED from the runtime instead of written beside it. tools/authority_lib.py#RECEIPT_BOUND_FIELDS declares the ten fields in digest order and location_receipt() now ASSEMBLES its digest body from that tuple, raising RECEIPT_BINDING_DRIFT if the assembled body and the declared tuple ever disagree, so the declared set and the digested set are one thing rather than two. #RECEIPT_FIELD_SEMANTICS adds the operational semantics of every field - source, normative, in_digest, revalidated_live, consumed_by_authorizing_core - and #receipt_binding_publication() generates the machine publication that both EVIDENCE-SET-WORKFLOW.json#core_authority.receipt and AUTHORITY-FUNCTION-CLASSES.json#receipt_binding are produced from. M0A-BINDING-VALUES.json publishes the field list, the field count, the two artifact paths and the package update requirement, so Hermes can derive the exact runtime receipt field set without inspecting Python. The receipt DOMAIN vidtoolz.resolveLocationReceipt.v1 is unchanged and the evidence-set snapshot domain remains distinct: documentation catching up with the runtime is not a contract change, and no receipt semantics were redesigned.",
     "negative_fixture": "validate_v1_19.py section m1-receipt-parity: exact ordered-set equality between the runtime tuple and BOTH machine publications; the declared tuple proved to be what location_receipt() assembles by reading the field names out of the function body by AST, plus the RECEIPT_BINDING_DRIFT guard; the three omitted fields identified by set difference and asserted present; per-field semantics asserted complete, internally consistent and true of the implementation; the domain asserted unchanged and the snapshot domain asserted distinct; and the frozen negatives - removing ANY ONE of the ten fields fails, the exact v1.15 seven-field list fails with BOUND_NOT_PUBLISHED naming precisely the three omissions, five plausible over-claims fail because the law is exact-set equality rather than containment, and a consumer recomputing the receipt from the PUBLISHED list is asserted to obtain the authority's own value; section m1-property: 24 seeded permutations, omissions and additions.",
     "expected_layer": "machine-readable authority publication (receipt binding contract)",
     "validation_sections": ["m1-receipt-parity", "m1-property", "v116-static"]},
]
V117_FINDINGS = [
    {"id": "V116-B1", "severity": "BLOCKER (unenumerated current TOCTOU authority slot names the diagnostic core)",
     "codex_finding": "EVIDENCE-SET-WORKFLOW.json:254, key toctou.law, says that after a verified input changes, 'derive_attachment_state refuses.' The bare authority-lib function is classified diagnostic_non_authorizing; the authorizing refusal belongs to derive_attachment_state_authorizing or its session wrapper. The sentence is a current normative TOCTOU law, not historical text, and does not mark the named function diagnostic. The same key path is absent from AUTHORITY-FUNCTION-CLASSES.json#authorizing_slots. The candidate scanner misses it because its generic marker list contains the phrase 'no longer'; in this sentence that phrase modifies 'the bundle's binding no longer resolves', not the function's authority class. Thus an unrelated English phrase suppresses a real diagnostic-name violation. This is the exact current example contemplated by the candidate's disclosed slot-enumeration residual: a machine consumer following this current law can select the non-authorizing semantic function for an authorizing TOCTOU decision, so V115-B1 remains open. Affected gates: MERGE, ATTACHMENT_READY, A1 authority readiness, and PRE-M3 by way of the unmergeable release. Independent harness 84/85; authorizing slots FAIL for completeness (the eleventh designation); stale-name properties FAIL on non-local marker matching plus a manually incomplete inventory.",
     "prior_defect": "Reproduced against the FROZEN v1.16 bundle at a03923cd4b09e8e11d40e8cf13819f8df763063a before anything was changed, in four parts. (1) The exact value at EVIDENCE-SET-WORKFLOW.json#toctou.law contains the bare derive_attachment_state (DIAGNOSTIC / NON_AUTHORIZING in the canonical map), the verb 'refuses', and no diagnostic marking anywhere in the value itself. (2) AUTHORITY-FUNCTION-CLASSES.json#authorizing_slots contains exactly ten hand-written key paths and not this one. (3) The v1.16 validator source literally contains the marker string 'no longer' in its context list and splits clauses only at '. ' and '; ', so the clause the scanner examined was the whole sentence, which contains 'no longer' - the suppression is mechanical and provable from the frozen source. (4) With comma-aware, paren-aware clause splitting the same sentence isolates the clause 'and derive_attachment_state refuses' (DIAGNOSTIC / NON_AUTHORIZING), which as written carries no class token, so the defect is caught immediately. The executable authority was never wrong: no runtime dispatch reads a function name from any artifact, so this is a consumer-facing frozen-authority defect, which is why it blocks merge without being a runtime bypass.",
     "correction": "Three parts, no runtime change. (1) EVIDENCE-SET-WORKFLOW.json#toctou.law now names the AUTHORIZING refusal - tools/authority_lib.py#derive_attachment_state_authorizing, with #derive_attachment_state_for_session as the equivalent session wrapper loading through #load_governed_evidence_set - and names the bare-evidence function explicitly AS DIAGNOSTIC / NON_AUTHORIZING in its own clause, for fixtures and diagnosis only. TOCTOU SEMANTICS ARE UNCHANGED: the same record-id/content-digest law and the same two additional seals, asserted equal to the parent's. (2) The hand-written authorizing_slots and diagnostic_slots dictionaries are REMOVED from AUTHORITY-FUNCTION-CLASSES.json and replaced by a frozen SEMANTIC slot_discovery_law: a slot is authorizing if its value designates a function as authoritative, deciding, refusing, enforcing, deriving current authority state, gating eligibility or commit, or validating - whatever its key is called - and the inventory itself is GENERATED into the new AUTHORITY-SLOT-INVENTORY.json by validate_v1_19.py through the new tooling module tools/authority_slots.py, one row per reference with artifact, key path or line, referenced function, authority role, canonical class and current/historical status. 32 authorizing slots are discovered across 54 current artifacts where v1.16 hand-listed ten. (3) The scanner is rebuilt around two fail-closed laws - R1 every reference to a demoted function in a current artifact carries an explicit class token in its OWN clause; R2 every clause that designates authority names a function of class authorizing - with clause boundaries at '.', ';', ':', ',' and newline at parenthesis depth zero and only before whitespace (so an argument list, a dotted module path and a version number stay intact), wrapped markdown rejoined into logical lines first, an explicit signal precedence (class or history token in the clause, then structured key path, then that clause's authority verbs), NO bare negation in any token list, module-aware normalization of six reference forms to one canonical (module, name), and an artifact scope DERIVED from precedence status plus a published document role (NORMATIVE_AUTHORITY, CORRECTION_RECORD, GENERATED_EVIDENCE, HISTORICAL_INPUT) rather than a filename pattern. Running it exhaustively found three further stale statements Codex had not named, all corrected: a current designation of the provisional-until-M3 commit pair in SNAPSHOT-CONCURRENCY-RECOVERY.md, and the retired CAPABILITY-EVIDENCE record type still described as the qualification mechanism in CAPABILITIES.json and READ-PRIMITIVES.json.",
     "negative_fixture": "validate_v1_19.py section b1-toctou: the four-part reproduction against the frozen v1.16 bundle including the suppression mechanism proved from the v1.16 validator source, the corrected law asserted clause by clause, the diagnostic counterpart asserted marked in its own clause, and TOCTOU semantics asserted identical to the parent's. Section slot-discovery: the TOCTOU key asserted present in the DISCOVERED inventory with all named functions authorizing, the absence of any hand-written slot dictionary, the semantic definition, the derived artifact scope, ZERO violations across every current artifact, and the generated inventory's shape and counts. Section scanner-negation: the EXACT v1.16 sentence pinned as a failing case; the absence of any bare negation from every token list; three negation-binding cases; the adversarial 'X is no longer diagnostic; X is authoritative'; the mixed clause; eight reference-form normalizations; module awareness; longest-name matching; and delimiter safety inside dotted paths, argument lists and version numbers. Section unknown-slot: five unfamiliar key names naming the diagnostic function as deciding authority all detected, and the same keys naming the authorizing function accepted. Section v117-property: 48 seeded cases over demoted/authorizing functions x six formats x eight keys x six verbs x three negation prefixes x optional marking, plus 16 seeded historical statements. Section v117-runtime-parity: three runtime files byte-identical to v1.16, evidence_store.py one comment line, every authority_lib.py change a version/lineage/tool-name line, and the ten-field receipt parity unchanged. Section v117-static: five audits.",
     "expected_layer": "active authority publication (authority designation and slot discovery)",
     "validation_sections": ["b1-toctou", "slot-discovery", "scanner-negation", "unknown-slot", "v117-property",
                             "v117-runtime-parity", "v117-static"]},
]
dump("FINDING-RESOLUTION-MATRIX-v1.19.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Codex v1.16 independent forensic adjudication: intake PASS, supplied suite PASS (2365/2365 twice, byte-identical report), receipt parity PASS, v1.15 functional regressions 57/57 PASS, independent assertions 84/85, ONE BLOCKER (V116-B1), ZERO merge majors, ZERO minors. MERGE BLOCKED; A1 AUTHORITY_READY NO. The candidate remained clean and unmodified. Every executable repair of v1.15 and v1.16 was confirmed CLOSED, and the runtime lookup was confirmed statically bound: the finding is a consumer-facing frozen-authority contradiction, not a runtime bypass.",
                                              "law": "the single finding names the v1.16 defect at the exact key path Codex identified, as reproduced against the frozen v1.16 bundle at a03923cd4b09e8e11d40e8cf13819f8df763063a, its three root causes (stale designation, hand-written inventory, phrase-presence scanner), the v1.19 correction, the adversarial and property fixtures, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes. The v1.19 laws: R1 every reference to a demoted function in a CURRENT artifact carries an explicit class token in its own clause; R2 every clause that designates authority names a function whose canonical class is authorizing; and the authorizing-slot inventory is DISCOVERED from the current artifacts, never hand-written.",
                                              "operational_closure": "the v1.16 matrix (V115-B1, V115-M1) is retained as FINDING-RESOLUTION-MATRIX-v1.16.json and its corrections are re-run as v1.19 regressions; this file is the ACTIVE matrix. NO RUNTIME SEMANTICS CHANGED IN v1.19: tools/evidence_authoring.py, tools/a2_prepare.py and tools/a2_verify.py are BYTE-IDENTICAL to v1.16, tools/evidence_store.py differs by EXACTLY ONE COMMENT LINE (the validator's filename, carried by the tool rename), and every changed line in tools/authority_lib.py is a version pin, a lineage pin or a tool-name reference - all asserted in section v117-runtime-parity. Untouched and re-run: the governed evidence byte binding, the GovernedEvidenceSet snapshot law, the authorizing/diagnostic split, the authorizing transaction and commit path, the governed root law, WORKFLOW no-follow, malformed-carrier handling, the PREPARER/VERIFIER/APPROVER roles, A2V, the OPEN/PREPARED/VERIFIED lifecycle, the record constructors, BUNDLE semantics, the checked-file law, TOCTOU runtime enforcement, locking, Store.v5, cache, the schema-registry architecture, the trusted shim, raw ingestion, the exact stored chain, H0, the commit stage architecture, the capability matrix and M0B/M0C/M0D. The V115-M1 receipt parity is unchanged: ten runtime-bound fields, published identically in both machine artifacts, domain unchanged. The v1.15 residual stands and is NOT closed here: the authorizing transaction path has no positive control because no production path authors M3 write evidence.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.16.json", "FINDING-RESOLUTION-MATRIX-v1.15.json", "FINDING-RESOLUTION-MATRIX-v1.14.json", "FINDING-RESOLUTION-MATRIX-v1.13.json", "FINDING-RESOLUTION-MATRIX-v1.12.json", "FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V117_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.16.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Codex v1.15 independent forensic adjudication: harness 54/57 PASS, ONE BLOCKER (V115-B1, active authority classification contradiction) and ONE MERGE MAJOR (V115-M1, machine-readable location-receipt binding omits three runtime-bound fields). Authority completeness WORKFLOW_CONTRADICTORY; MERGE BLOCKED; A1 authority-ready NO. The candidate remained clean and unmodified, the supplied suite reproduced 2320/2320 twice byte-identically, and every executable v1.15 repair - consumed-byte binding, carrier immutability, forced-mutation resistance, snapshot digest, live revalidation, substitution refusal, transaction/commit provenance, WORKFLOW file law, malformed-carrier normalisation and hash-domain parity - was confirmed CLOSED. Both findings are frozen-statement defects, not executable defects: no false authorization was demonstrated by either.",
                                              "law": "each finding names the v1.15 defect at the exact key paths Codex identified, as reproduced against the frozen v1.15 bundle at 459bd29e358574896f0cf69f4b0bfb347bf2902d, its root cause, the v1.16 correction, the negative and property fixtures, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes. The v1.16 law: ONE function -> ONE current authority class, published from the executable surface; and the published receipt binding IS the runtime receipt binding, exactly, in both directions.",
                                              "operational_closure": "the v1.15 matrix (V114-B1..B4, V114-M1, V114-N1) is retained as FINDING-RESOLUTION-MATRIX-v1.15.json and its corrections are re-run as v1.16 regressions; this file is HISTORICAL under v1.19, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.19.json. v1.16 changes NO RUNTIME LAW AT ALL: the consumed-evidence byte binding, the immutable carrier and snapshot law, governed root enforcement, the diagnostic/authorizing API separation, the transaction/commit provenance gate, the WORKFLOW.json no-follow/file-type law, malformed-carrier handling, Store.v5, the PREPARER/VERIFIER/APPROVER roles, A2V, the OPEN/PREPARED/VERIFIED lifecycle, the record constructors, BUNDLE_VERIFICATION semantics, the checked-file law, TOCTOU, locking, cache, the schema-registry architecture, the trusted shim, strict raw ingestion, the exact stored chain, H0, the commit stage architecture, the capability matrix and M0B/M0C/M0D are untouched and re-run. tools/evidence_store.py differs from v1.15 by EXACTLY ONE COMMENT LINE (the validator's filename, carried by the tool rename). The location-receipt hash domain and the evidence-set snapshot domain are UNCHANGED and remain distinct: a documentation correction is not a contract change. The v1.15 residual stands unchanged and is not closed here: the authorizing transaction path has no positive control because no production path authors M3 write evidence.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.15.json", "FINDING-RESOLUTION-MATRIX-v1.14.json", "FINDING-RESOLUTION-MATRIX-v1.13.json", "FINDING-RESOLUTION-MATRIX-v1.12.json", "FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V116_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.15.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Codex v1.14 forensic adjudication and blocking-findings extraction: FOUR BLOCKERs (V114-B1 consumed evidence not bound to governed provenance, V114-B2 diagnostic eligibility reaching commit authority, V114-B3 active authority naming diagnostic entrypoints, V114-B4 governed loader following a symlinked WORKFLOW.json), ONE MERGE MAJOR (V114-M1 malformed nominal carrier leaking AttributeError) and ONE MINOR (V114-N1 canonicalization documentation omitting the location-receipt hash domain). Authority completeness WORKFLOW_CONTRADICTORY; merge FAIL. Hermes's root-existence sensitivity was classified REVIEW_ENVIRONMENT_EFFECT and is NOT treated as a candidate defect.",
                                              "law": "each of the six findings names the v1.14 defect as reproduced against the frozen v1.14 bundle at b61f248238ec7ed60deca79aa9728ec0cde86edd, its root cause, the v1.15 correction, the negative and property fixtures, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes. The essential v1.15 law is THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION.",
                                              "operational_closure": "the v1.14 authorizing-location matrix (V113-B1) is retained as FINDING-RESOLUTION-MATRIX-v1.14.json and its corrections are re-run as v1.15 regressions; this file is HISTORICAL under v1.16, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.16.json. v1.15 reopens NOTHING else: the v1.12 workflow architecture, the v1.13 governed-root law, Store.v5, the role model, A2V, the lifecycle, the record constructors, BUNDLE semantics, the checked-file law, writer locking, H0, the commit STAGE architecture, the schema-registry architecture, the trusted shim, raw ingestion, the exact stored chain, precedence, the capability matrix, M0B/M0C/M0D and unrelated pre-M3 transaction design are all untouched. tools/evidence_store.py differs from v1.14 by EXACTLY ONE COMMENT LINE (the validator's filename, carried by the tool rename) and by nothing else: every semantic constant is identical - Store.v5, Session.v4, Boundary.v1, Inventory.v4, Finalization.v2, 13 MODE_TABLE entries, 64 error codes, 22 inventory fields, 25 public authority methods and the precedence BOUNDARY > SESSION_STATE > MODEL > READ. What v1.15 does NOT close, stated: the authorizing transaction path has no positive control because no production path authors M3 write evidence, so it is proved fail-closed and proved to apply the ordinary pre-M3 stage laws once provenance passes, and its first true positive belongs to the milestone that freezes write evidence.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.14.json", "FINDING-RESOLUTION-MATRIX-v1.13.json", "FINDING-RESOLUTION-MATRIX-v1.12.json", "FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V115_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.14.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Hermes v1.13 operational review PASS. Codex v1.13: 93 of 96 checks passed with ONE BLOCKER, V113-B1 (the authorizing location-check bypass), and one MINOR (a stale test_root_override claim in EVIDENCE-SET-WORKFLOW.json).",
                                              "law": "the single finding names the v1.13 defect as reproduced against the frozen v1.13 bundle at 65895c6dedceadff012a08c1bafcdf9e92b65221, its root cause, the v1.14 correction, the negative and property fixtures, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                              "operational_closure": "the v1.13 governed-root matrix (V112-RP1) is retained as FINDING-RESOLUTION-MATRIX-v1.13.json and its corrections are re-run as v1.14 regressions; this file is HISTORICAL under v1.15, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.15.json. v1.14 reopens NOTHING else: the v1.12/v1.13 workflow, principals, A2V, the lifecycle, the record constructors, record_id, the envelope law, BUNDLE_VERIFICATION semantics, the TOCTOU law, the checked-file law, locking, Store.v5, cache, the schema registry, the shim, strict ingestion, H0, commit authority, precedence, the matrix architecture, M0B/M0C/M0D and pre-M3 transaction authority are all untouched. tools/evidence_store.py differs from v1.13 by EXACTLY ONE COMMENT LINE (the validator's filename, carried by the tool rename) and by nothing else: every semantic constant is identical - Store.v5, Session.v4, Boundary.v1, Inventory.v4, Finalization.v2, 13 MODE_TABLE entries, 64 error codes, 22 inventory fields, 25 public authority methods and the precedence BOUNDARY > SESSION_STATE > MODEL > READ. The one honest residual is recorded rather than fixed: the M3 composed path still consumes the diagnostic eligibility, which cannot yield M0A probe eligibility.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.13.json", "FINDING-RESOLUTION-MATRIX-v1.12.json", "FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V114_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.13.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Hermes v1.12 operational review PASS on the intended path (lifecycle, positive runtime-only E2E, canonical records, 9/9 checked files, role separation, TOCTOU, NO_RERUN_RISK, zero Resolve/EKA contact). Codex v1.12: intake PASS, semantic delta PASS, runtime-parity oracle FAIL - classification WORKFLOW_CONTRADICTORY, finding V112-RP1.",
                                              "law": "the single finding names the v1.12 defect as reproduced against the frozen v1.12 bundle at 73150d00a72820b155caf357c412f46b8ec4a9ba, its root cause, the v1.13 correction, the negative and property fixtures, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                              "operational_closure": "the v1.11 pre-M0A workflow matrix (V112-1..V112-4) is retained as FINDING-RESOLUTION-MATRIX-v1.12.json and its corrections are re-run as v1.13 regressions; this file is HISTORICAL under v1.14, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.14.json. v1.13 changes NOTHING that passed the v1.12 operational review: principal roles, A2V semantics, the OPEN/PREPARED/VERIFIED lifecycle, the record constructors, the BUNDLE_VERIFICATION content, the TOCTOU law, the checked-file law, Store.v5, cache, shim, strict ingestion, H0, commit authority, precedence, the capability matrix and M0B/M0C/M0D are all untouched. tools/evidence_store.py differs from v1.12 by EXACTLY ONE COMMENT LINE (the validator's filename, carried by the tool rename) and by nothing else: every semantic constant is identical - Store.v5, Session.v4, Boundary.v1, Inventory.v4, Finalization.v2, 13 MODE_TABLE entries, 64 error codes, 22 inventory fields, 25 public authority methods and the precedence BOUNDARY > SESSION_STATE > MODEL > READ.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.12.json", "FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V113_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.12.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Architectural adjudication of the failed A2 repair under v1.11: AUTHORITY_UNDERSPECIFIED on the evidence-set container and write axis. Derivation correctness and record-form specification were both COMPLETE and demonstrated (17/17 positive and negative canonical record-form tests); the failure was operational authority completeness.",
                                              "law": "each finding names the v1.11 gap, the v1.12 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                              "operational_closure": "the v1.10 evidence-store matrix (F110-A..F110-D) is retained as FINDING-RESOLUTION-MATRIX-v1.11.json and its corrections are re-run as v1.13 regressions; this file is HISTORICAL under v1.13, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.13.json. v1.12 changes NO Store.v5 semantics, no Boundary.v1 or Inventory.v4 law, no marker cardinality, no mode law, no content addressing, no cache, no schema-registry architecture, no trusted shim, no strict raw ingestion, no exact stored chain, no H0, no commit authority, no precedence and no M0B/M0C/M0D phase design. The only derivation change is the additive BUNDLE_VERIFICATION binding of V112-4, and every v1.11 positive and negative attachment case is re-run unchanged.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": V112_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.11.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                              "adjudication": "Codex independent v1.10 result: 1911/1911 supplied validation twice and deterministic, with exactly four release-relevant findings remaining - F110-A, F110-B and F110-C BLOCKERs and F110-D a MERGE MAJOR / M0A MAJOR",
                                              "law": "each finding names the v1.10 defect as reproduced against the frozen v1.10 bundle at 9c6643430d2dc66741afe9852668d8e6e19c0630, the v1.11 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                              "operational_closure": "the v1.9 evidence-store matrix (S110-1..S110-5) is retained as FINDING-RESOLUTION-MATRIX-v1.10.json and its corrections are re-run as v1.12 regressions; this file is HISTORICAL under v1.12, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.12.json. Codex's PARTIAL filesystem-normalization observation (raw os.close and walk-iteration coverage) was NOT one of the four release findings and is DELIBERATELY out of v1.11 scope: the 13-label frozen FS_* vocabulary, the mapped errno conditions, the TypeError/programming-error distinction and the fs() normalization behaviour are retained and re-run unchanged, and the item is left for separate adjudication rather than broadened into a filesystem wrapper rewrite.",
                                              "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                              "findings": F110_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.10.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                             "adjudication": "Codex independent v1.9 result: all v1.7/v1.8 regressions 211/211 PASS, with five remaining evidence-store findings S110-1..S110-5",
                                             "law": "each finding names the v1.9 defect, the v1.10 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                             "operational_closure": "the v1.8 evidence-store matrix (S19-1..S19-4) is retained as FINDING-RESOLUTION-MATRIX-v1.9.json and its corrections are re-run as v1.11 regressions; this file is HISTORICAL under v1.11, whose ACTIVE matrix is FINDING-RESOLUTION-MATRIX-v1.11.json.",
                                             "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                             "findings": S110_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.9.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                             "adjudication": "Codex final v1.8 adjudication: 1856/1856 supplied validation twice, ES-1 and ES-2 closed, all v1.7 regressions passing, with four remaining evidence-store integrity defects S19-1..S19-4",
                                             "law": "each finding names the v1.8 defect, the v1.9 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                             "operational_closure": "the v1.7 evidence-store matrix (ES-1, ES-2) is retained as FINDING-RESOLUTION-MATRIX-v1.8.json and its corrections are re-run as v1.9 regressions; this file is the ACTIVE matrix.",
                                             "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"],
                                             "findings": S19_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.8.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                             "adjudication": "Codex final v1.7 forensic adjudication: intake PASS, supplied validation 1800/1800 twice, independent harness 210/211, one remaining defect class (EVIDENCE STORE INTEGRITY / COMPETING STORE AUTHORITY): ES-1 and ES-2",
                                             "law": "each finding names the v1.7 defect, the v1.8 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                             "operational_closure": "the v1.6 finding matrix (C16-B1..B4, C16-M1..M3, C16-OP1) is retained as FINDING-RESOLUTION-MATRIX-v1.7.json and its corrections are re-run as v1.8 regressions; this file is the ACTIVE matrix.",
                                             "inherited_matrices": ["FINDING-RESOLUTION-MATRIX-v1.7.json", "FINDING-RESOLUTION-MATRIX-v1.6.md", "FINDING-RESOLUTION-MATRIX-v1.5.md"],
                                             "findings": ES_FINDINGS})
dump("FINDING-RESOLUTION-MATRIX-v1.7.json", {"schema": "vidtoolz.resolveFindingResolutionMatrix.v1.10", "authority_version": L.AUTHORITY_VERSION,
                                             "adjudication": "Codex final v1.6 forensic adjudication (4 BLOCKER, 3 M0A MAJOR, 1 operational)",
                                             "law": "each finding names the v1.6 defect, the v1.7 correction, at least one negative fixture, the layer the attack must fail at, and the validate_v1_19.py sections that prove it. validate_v1_19.py refuses to pass unless every named section exists and every check in it passes.",
                                             "operational_closure": "C16-OP1 (Hermes M0A cannot bind to v1.6 because the trusted shim, parser, spec and raw identities are not operationally closed) is closed by M0A-BINDING-VALUES.json, which publishes every value with no placeholder and is verified against the running code by validate_v1_19.py section m0a-binding.",
                                             "findings": CODEX_FINDINGS})
frm_schema = S("vidtoolz.resolveFindingResolutionMatrix.v1.10", "Finding resolution matrix v1.7 (Codex v1.6 adjudication)",
               {"schema": {"const": "vidtoolz.resolveFindingResolutionMatrix.v1.10"}, "authority_version": {"const": L.AUTHORITY_VERSION}, "adjudication": {"type": "string"}, "law": {"type": "string"}, "operational_closure": {"type": "string"},
                "inherited_matrices": {"type": "array", "items": {"type": "string"}},
                "findings": {"type": "array", "minItems": 2, "items": {"type": "object", "additionalProperties": False, "required": ["id", "severity", "codex_finding", "correction", "negative_fixture", "expected_layer", "validation_sections"],
                                                                       "properties": {"id": {"pattern": "^(C16-(B|M)[0-9]|ES-[0-9]|S19-[0-9]|S110-[0-9]|V117-(I1|S[1-5])|V118-(M[1-4]|N[1-3])|V119-F[1-5]|P1-(F(07|08|09|10|11|12)|R0[1-5]))$"}, "severity": {"enum": ["BLOCKER", "MAJOR", "MINOR", "MERGE MAJOR", "OPERATIONAL"]}, "codex_finding": {"type": "string", "minLength": 20}, "v16_defect": {"type": "string", "minLength": 20}, "prior_defect": {"type": "string", "minLength": 20}, "correction": {"type": "string", "minLength": 20}, "negative_fixture": {"type": "string", "minLength": 20}, "expected_layer": {"type": "string", "minLength": 3}, "validation_sections": {"type": "array", "minItems": 1, "items": {"type": "string"}}}}}},
               ["schema", "authority_version", "adjudication", "law", "operational_closure", "findings"])
dump("schemas/resolveFindingResolutionMatrix.schema.json", frm_schema)

print("build_v1_7: OK; layered fixtures:", FIXTURE_COUNT[0], "; evidence sets:", len(EVSETS), "; pinned schemas:", SCHEMA_REGISTRY["schema_count"], "; trusted shim:", TRUSTED_SHIM["trusted_shim_sha256"][:12])

# ============================================================ section 17: strict raw-ingestion negative fixtures, as replayable BYTES
# These are frame FILES, not JSON documents: several of them are deliberately not valid UTF-8 or not valid JSON, so an
# independent reviewer replays the exact bytes through authority_lib.ingest_raw_frame and compares the refusal code.
def dump_bytes(rel, data):
    p_ = os.path.join(B, rel)
    os.makedirs(os.path.dirname(p_), exist_ok=True)
    with open(p_, "wb") as f_:
        f_.write(data)


_ing_cap = copy.deepcopy(next(r["capture"] for r in EVSETS["attached-reviewed-evidence"]["records"].values() if r["record_type"] == "RAW_CAPABILITY_CAPTURE" and r["capture"]["method"] == "GetStartFrame"))
_ing_good = SHIM.raw_frame_bytes(_ing_cap)
_ing_txt = _ing_good.decode("utf-8")
_ing_seq = '"sequence":%d' % _ing_cap["sequence"]
assert _ing_txt.count(_ing_seq) == 1
INGEST_CASES = [
    ("honest-frame", _ing_good, None, "the canonical frame bytes of an honest capture; ingests to a record whose digest and strict-parse receipt both close"),
    ("duplicate-json-key", (_ing_txt[:-2] + ',"method":"Timeline.SetName"}\n').encode("utf-8"), "DUPLICATE_JSON_KEY", "a second 'method' key; the standard parser would silently keep this one"),
    ("malformed-utf8", _ing_good[:20] + b"\xff\xfe" + _ing_good[20:], "MALFORMED_UTF8", "two bytes that are not valid UTF-8"),
    ("trailing-bytes", _ing_good.rstrip() + b" trailing\n", "TRAILING_BYTES", "non-whitespace after the object"),
    ("multiple-json-values", _ing_good.rstrip() + b' {"a":1}\n', "MULTIPLE_JSON_VALUES", "a second complete JSON value in one frame"),
    ("invalid-number-syntax", _ing_txt.replace(_ing_seq, '"sequence":0%d' % _ing_cap["sequence"], 1).encode("utf-8"), "STRUCTURE_INVALID", "a leading zero in a number"),
    ("non-finite-number", _ing_txt.replace(_ing_seq, '"sequence":NaN', 1).encode("utf-8"), "NON_FINITE_NUMBER", "the non-finite constant NaN, which the standard parser accepts by default"),
    ("control-character", _ing_txt.replace('"outcome"', '"out\x01come"', 1).encode("utf-8"), "CONTROL_CHARACTER", "a raw control character inside a key"),
    ("oversized-frame", b'{"schema":"x","pad":"' + b"p" * (L.RAW_FRAME_MAX_BYTES + 8) + b'"}\n', "FRAME_TOO_LARGE", "a frame larger than RAW_FRAME_MAX_BYTES"),
    ("byte-order-mark", b"\xef\xbb\xbf" + _ing_good, "BOM_PRESENT", "a UTF-8 byte order mark before the object"),
    ("unknown-schema-version", _ing_txt.replace(L.RAW_SCHEMA_ID, "vidtoolz.resolveRawCapabilityCapture.v0", 1).encode("utf-8"), "UNKNOWN_SCHEMA_VERSION", "a raw frame schema this authority version does not implement"),
    ("top-level-array", b"[" + _ing_good.rstrip() + b"]\n", "NOT_A_JSON_OBJECT", "a top-level array instead of an object"),
    ("empty-frame", b"   \n", "EMPTY_FRAME", "whitespace only"),
    ("digest-mismatch", _ing_txt.replace(_ing_cap["operator"], "someone else", 1).encode("utf-8"), "DIGEST_MISMATCH", "content edited after raw_digest was computed"),
]
for _nm, _bytes, _code, _why in INGEST_CASES:
    dump_bytes(f"fixtures/raw-ingestion/{_nm}.frame", _bytes)
dump("fixtures/raw-ingestion/CASES.json", {
    "schema": "vidtoolz.resolveRawIngestionCases.v1.10",
    "authority_version": L.AUTHORITY_VERSION,
    "law": "each case is the EXACT frame bytes of fixtures/raw-ingestion/<name>.frame. Replay it through authority_lib.ingest_raw_frame(open(path,'rb').read(), env, active, rp): the honest frame must ingest and produce a closing strict-parse receipt; every other case must raise RawIngestError with exactly the expected_code. Several files are deliberately not valid UTF-8 or not valid JSON, which is why they are bytes on disk and not JSON documents.",
    "codes": list(L.RAW_INGEST_CODES),
    "cases": [{"name": _nm, "file": f"fixtures/raw-ingestion/{_nm}.frame", "byte_count": len(_b), "sha256": hashlib.sha256(_b).hexdigest(), "expected_code": _c, "why": _w} for _nm, _b, _c, _w in INGEST_CASES],
})
ing_schema = S("vidtoolz.resolveRawIngestionCases.v1.10", "Strict raw-ingestion negative fixtures v1.10",
               {"schema": {"const": "vidtoolz.resolveRawIngestionCases.v1.10"}, "authority_version": {"const": L.AUTHORITY_VERSION}, "law": {"type": "string"}, "codes": {"type": "array", "items": {"type": "string"}},
                "cases": {"type": "array", "minItems": 14, "items": {"type": "object", "additionalProperties": False, "required": ["name", "file", "byte_count", "sha256", "expected_code", "why"], "properties": {"name": {"type": "string", "minLength": 1}, "file": {"type": "string", "pattern": "^fixtures/raw-ingestion/"}, "byte_count": POSINT, "sha256": SHA, "expected_code": {"anyOf": [{"enum": list(L.RAW_INGEST_CODES)}, {"type": "null"}]}, "why": {"type": "string", "minLength": 5}}}}},
               ["schema", "authority_version", "law", "codes", "cases"])
dump("schemas/resolveRawIngestionCases.schema.json", ing_schema)

# ============================================================ v1.12 (V112-1..V112-4) the pre-M0A workflow authority
dump("PRINCIPALS.json", {
    "schema": "vidtoolz.resolvePrincipalRegistry.v1", "authority_version": L.AUTHORITY_VERSION,
    "law": "a principal is a ROLE-BOUND OPERATIONAL LABEL of the form '<ROLE>:<actor>', registered here and stamped by the authoring tool for the ONE role that tool implements. It is NOT an authenticated identity: there is no key, no signature and no certificate. What the law buys is that a caller cannot invent two labels inside one record and that no actor id may hold two roles, so BUNDLE_VERIFICATION independence is no longer satisfiable by relabelling. A human who runs both tools is still one human; that residual risk is stated in THREAT-MODEL.md, not closed.",
    "roles": list(L.PRINCIPAL_ROLES),
    "registry": {k: list(v) for k, v in sorted(L.PRINCIPAL_REGISTRY.items())},
    "write_grants": {k: list(v) for k, v in sorted(L.WRITE_GRANTS.items())},
    "state_grants": {st: {r: list(t) for r, t in sorted(g.items())} for st, g in sorted(L.EVIDENCE_SET_STATE_GRANTS.items())},
    "role_separation": "no ACTOR may appear under two roles; authority_lib.role_separation_errors() is asserted empty by validate_v1_19.py",
    "actor_disjointness_now": {r: sorted(L.principal_actor(p) for p in ps) for r, ps in sorted(L.PRINCIPAL_REGISTRY.items())},
    "verification_results": list(L.VERIFICATION_RESULTS),
    "enforced_by": [L.EVIDENCE_AUTHORING_MODULE + "#_authorize", "authority_lib.py#principal_errors",
                    "authority_lib.py#may_write", "authority_lib.py#derive_attachment_state_authorizing (BUNDLE_VERIFICATION filter)"],
})
dump("schemas/resolvePrincipalRegistry.schema.json",
     S("vidtoolz.resolvePrincipalRegistry.v1", "Principal registry v1 (role-bound operational labels; not authenticated identities)",
       {"schema": {"const": "vidtoolz.resolvePrincipalRegistry.v1"}, "authority_version": AV, "law": {"type": "string"},
        "roles": {"type": "array", "items": {"enum": list(L.PRINCIPAL_ROLES)}},
        "registry": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string", "pattern": "^[A-Z]+:[A-Za-z0-9._-]+$"}}},
        "write_grants": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
        "state_grants": {"type": "object"}, "role_separation": {"type": "string"},
        "actor_disjointness_now": {"type": "object"},
        "verification_results": {"type": "array", "items": {"enum": list(L.VERIFICATION_RESULTS)}},
        "enforced_by": {"type": "array", "items": {"type": "string"}}},
       ["schema", "authority_version", "law", "roles", "registry", "write_grants", "state_grants",
        "role_separation", "actor_disjointness_now", "verification_results", "enforced_by"]))
dump("schemas/resolveEvidenceSetWorkflow.schema.json",
     S("vidtoolz.resolveEvidenceSetWorkflow.v1", "Evidence-set workflow state v1 (governed location, lifecycle, transitions)",
       {"schema": {"const": "vidtoolz.resolveEvidenceSetWorkflow.v1"}, "authority_version": AV,
        "manifest_sha256": SHA, "session_id": {"type": "string", "minLength": 1},
        "governed_root": ABS_PATH, "state": {"enum": list(L.EVIDENCE_SET_STATES)},
        "transitions": {"type": "array", "minItems": 1, "items": {"type": "object", "required": ["state", "principal", "at"],
                        "properties": {"state": {"enum": list(L.EVIDENCE_SET_STATES)}, "principal": {"type": "string"},
                                       "at": {"type": "string"}, "verification_result": {"enum": list(L.VERIFICATION_RESULTS)},
                                       "failed_checks": {"type": "array", "items": {"type": "string"}}}}},
        "prepared_content_sha256": SHA_OR_NULL, "evidence_set_sha256": SHA_OR_NULL},
       ["schema", "authority_version", "manifest_sha256", "session_id", "governed_root", "state", "transitions",
        "prepared_content_sha256", "evidence_set_sha256"]))
# ============================================================ v1.16 (V115-B1): ONE canonical, machine-readable
# function-classification artifact, GENERATED from authority_lib.AUTHORITY_SURFACE. Every other artifact quotes this
# fact rather than restating a claim, and validate_v1_19.py compares all of them against it exhaustively - no
# exclusion list, because an exclusion list for `law` and `qualification_note` is exactly how the v1.15
# contradiction survived its own audit.
_FCLASSES = L.authority_function_classes()
dump("AUTHORITY-FUNCTION-CLASSES.json", {
    "schema": "vidtoolz.resolveAuthorityFunctionClasses.v1",
    "authority_version": L.AUTHORITY_VERSION,
    "law": "ONE function -> ONE current authority class. This file is generated from tools/authority_lib.py#AUTHORITY_SURFACE and is the single machine-readable classification authority. Where any other current artifact speaks about one of these functions, it must agree with this file, and any slot whose semantics are 'this function authorizes X' must name a function classified authorizing. Authority selection is itself an authorizing decision (Codex v1.15 V115-B1).",
    "classes": L.FUNCTION_CLASS_LAW,
    "classes_are_disjoint": True,
    "source_of_truth": "tools/authority_lib.py#AUTHORITY_SURFACE via #authority_function_classes()",
    "decision_functions": {f: {"authority_class": _FCLASSES[f],
                               "module": "tools/authority_lib.py",
                               "consumed_by_authorizing_runtime": _FCLASSES[f] == "authorizing"}
                           for f in L.CLASSIFIED_DECISION_FUNCTIONS},
    "authorizing": sorted(f for f, c in _FCLASSES.items() if c == "authorizing"),
    "diagnostic_non_authorizing": sorted(f for f, c in _FCLASSES.items() if c == "diagnostic_non_authorizing"),
    "provisional_until_m3_non_authorizing": sorted(f for f, c in _FCLASSES.items() if c == "provisional_until_m3_non_authorizing"),
    "internal_non_authorizing": sorted(f for f, c in _FCLASSES.items() if c == "internal_non_authorizing"),
    # v1.19 (V116-B1): the hardcoded ten-slot and four-slot dictionaries are GONE. Codex found an eleventh
    # authorizing slot - EVIDENCE-SET-WORKFLOW.json#toctou.law - that no hand-written inventory had listed, and a
    # hand-written inventory has no way to notice a slot nobody thought of. What is frozen here is the LAW by which
    # a slot is discovered; the inventory itself is GENERATED into AUTHORITY-SLOT-INVENTORY.json by
    # validate_v1_19.py through tools/authority_slots.py, from the current artifacts themselves.
    "slot_discovery_law": {
        "definition": "A slot is AUTHORIZING if its value or text designates a function as authoritative, deciding, "
                      "refusing, enforcing, deriving current authority state, gating eligibility or commit, or "
                      "validating - whatever its key is called. Slot membership follows the SEMANTICS OF THE VALUE, "
                      "never a key-name allowlist, so an unfamiliar key cannot hide an authority designation.",
        "roles": list(SLOTS.ROLES),
        "authority_tokens": list(SLOTS.AUTHORITY_TOKENS),
        "class_tokens": list(SLOTS.CLASS_TOKENS),
        "history_tokens": list(SLOTS.HISTORY_TOKENS),
        "clause_law": "A claim is read ONLY from the clause containing the reference. Clauses break at '.', ';', "
                      "':', ',' and newline, at parenthesis depth zero, and only where the delimiter is followed by "
                      "whitespace or the end of the text - so an argument list, a dotted module path and a version "
                      "number stay intact while ordinary punctuation ends a clause. Wrapped markdown prose is "
                      "rejoined into logical lines first, so where a line happens to wrap cannot change a "
                      "classification.",
        "negation_law": "Negation is LOCAL, never a phrase search. 'X is no longer authoritative; Y is "
                        "authoritative' classifies X non-authorizing and Y authorizing, because each clause is read "
                        "separately. No bare negation appears in any token list: the v1.16 scanner exempted any "
                        "sentence containing the phrase 'no longer', and in the TOCTOU law that phrase modified 'the "
                        "bundle's binding no longer resolves' - an unrelated clause - which suppressed a real "
                        "diagnostic-name violation (V116-B1).",
        "signal_precedence": ["an explicit class or history token in the reference's OWN clause",
                              "the structured key path (a key whose name declares diagnostic/provisional/authorizing)",
                              "the authority verbs of the reference's own clause"],
        "reference_forms": ["bare", "module-qualified", "anchor (module.py#name)", "path-qualified (tools/module.py#name)",
                            "markdown code (`name`)", "call form name(args)"],
        "module_awareness": "A same-named function in another module is a DIFFERENT symbol: "
                            "evidence_authoring.derive_attachment_state is the AUTHORIZING authoring wrapper, not "
                            "the diagnostic authority_lib core function, and is recorded as a foreign-module symbol "
                            "rather than judged against the authority_lib class map.",
        "laws": {"R1": "every reference to a demoted function in a CURRENT artifact carries an explicit class token "
                       "in its own clause",
                 "R2": "every clause that designates authority names a function whose canonical class is authorizing"},
        "artifact_scope": "derived from AUTHORITY-PRECEDENCE.json: status STILL_ACTIVE and role in "
                          "(NORMATIVE_AUTHORITY, CORRECTION_RECORD). Never a filename pattern. GENERATED_EVIDENCE "
                          "(the validation report and the generated inventory) reports what the suite checked and "
                          "quotes its own check names, so it is out of scope by published role; HISTORICAL_INPUT is "
                          "out of scope by status.",
        "generated_inventory": "AUTHORITY-SLOT-INVENTORY.json",
        "generator": "tools/authority_slots.py, used by both this build and validate_v1_19.py",
    },
    "runtime_lookup_law": "NO authorizing runtime code resolves a function by name from any artifact. Functions are bound statically by Python import; there is no getattr/eval/dispatch-table lookup keyed on an artifact string anywhere in the authority. A stale artifact can therefore mislead a HUMAN or an external consumer - which is why this file exists and why the validator compares every current artifact against it - but it cannot make the authority itself call a diagnostic function.",
    "receipt_binding": L.receipt_binding_publication(),
})
_fc_schema = S("vidtoolz.resolveAuthorityFunctionClasses.v1", "Canonical function -> authority class map (v1.16, V115-B1)",
               {"schema": {"const": "vidtoolz.resolveAuthorityFunctionClasses.v1"}, "authority_version": AV,
                "law": {"type": "string", "minLength": 1}, "classes": {"type": "object"},
                "classes_are_disjoint": {"const": True}, "source_of_truth": {"type": "string"},
                "decision_functions": {"type": "object", "additionalProperties": {"type": "object", "additionalProperties": False,
                                       "required": ["authority_class", "module", "consumed_by_authorizing_runtime"],
                                       "properties": {"authority_class": {"enum": sorted(L.FUNCTION_CLASS_LAW)},
                                                      "module": {"type": "string"},
                                                      "consumed_by_authorizing_runtime": {"type": "boolean"}}}},
                "authorizing": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "diagnostic_non_authorizing": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "provisional_until_m3_non_authorizing": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "internal_non_authorizing": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "slot_discovery_law": {"type": "object"},
                "runtime_lookup_law": {"type": "string", "minLength": 1},
                "receipt_binding": {"type": "object"}},
               ["schema", "authority_version", "law", "classes", "classes_are_disjoint", "source_of_truth",
                "decision_functions", "authorizing", "diagnostic_non_authorizing",
                "provisional_until_m3_non_authorizing", "internal_non_authorizing", "slot_discovery_law",
                "runtime_lookup_law", "receipt_binding"])
dump("schemas/resolveAuthorityFunctionClasses.schema.json", _fc_schema)

dump("EVIDENCE-SET-WORKFLOW.json", {
    "schema": "vidtoolz.resolveEvidenceSetWorkflowLaw.v1", "authority_version": L.AUTHORITY_VERSION,
    "law": "ONE normative persistence topology, lifecycle and permission model for the resolveEvidenceSet document. v1.11 froze the record FORM and the derivation and proved both correct; it froze none of this, so ATTACHMENT_READY was reachable only from fixtures. This closes exactly that gap.",
    "persistence": {
        "governed_root": L.QUALIFICATION_EVIDENCE_ROOT,
        # v1.13 (V112-RP1): the ONE attachment root, and the fact that no caller can choose it. v1.12 froze this law
        # in prose while every authorizing function took root= and both CLIs took --evidence-root, so an arbitrary or
        # SYMLINKED root still derived ATTACHMENT_READY.
        "governed_attachment_root": L.GOVERNED_ATTACHMENT_ROOT,
        "governed_root_mode": L.GOVERNED_ROOT_MODE,
        "caller_selectable": False,
        "root_resolver": L.EVIDENCE_AUTHORING_MODULE + "#governed_attachment_root (takes NO argument)",
        "root_trust_law": "the governed root and the session directory are classified by lstat BEFORE any resolution: a symlink at either is ROOT_SYMLINK_REFUSED / SESSION_SYMLINK_REFUSED and never followed. realpath is consulted only afterwards, as an alias check. The root must be absolute, already normalised, a real directory and carry mode 0700.",
        "location_recheck_law": "the governed location is re-established on EVERY authorizing load - update, verify, finalize and derive - not only at creation. The authorizing derivation additionally requires the document's recorded authority_root to be exactly the frozen constant and written_under_production_root to be true.",
        "refusal_codes": ["ROOT_NOT_GOVERNED", "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_NOT_FOUND",
                          "ROOT_MODE_INVALID", "SESSION_SYMLINK_REFUSED", "SESSION_NOT_A_DIRECTORY",
                          "SESSION_PATH_NOT_GOVERNED", "NOT_PRODUCTION_ROOT", "SET_LOCATION_MISMATCH",
                          "SESSION_ID_INVALID"],
        "test_override": "scratch roots live in tools/evidence_authoring_testkit.py, AUTHORITY_CLASS INTERNAL_NON_AUTHORIZING. It is not imported by either production CLI, it refuses to sandbox the frozen authority root, and every document it produces records written_under_production_root=false so the authorizing derivation refuses it. The sandbox changes the root prefix ONLY: every trust, lifecycle, principal, TOCTOU and freshness check runs unchanged on the same code.",
        "path_law": L.GOVERNED_ATTACHMENT_ROOT + "/<current_session_id>/{EVIDENCE-SET.json,WORKFLOW.json,LOCK}",
        "file_identity": "FIXED NAME within a governed per-session directory. Not content-addressed: the document is mutable across its OPEN and PREPARED states by design, and content-addressing a mutable document would rename it on every write. Integrity comes from (a) the per-record content-addressed record_id, (b) prepared_content_sha256 sealed at PREPARED, (c) evidence_set_sha256 sealed at VERIFIED and re-checked on every load, (d) atomic replace, (e) the self-location check.",
        "ownership": "the qualification authority on the contract host; directory mode 0700, document 0600 while writable and 0400 once VERIFIED",
        "forbidden_locations": ["/tmp or any transient-only path as production authority", "an arbitrary user path",
                                "a Store.v5 session root", "any EKA or shared network library path"],
        "self_location_check": "WORKFLOW.json records governed_root and session_id; loading refuses SET_LOCATION_MISMATCH when the derived path is not where the document was actually found, so a copied or moved document is not authority",
        "atomicity": "sibling temp + fsync + os.replace; a reader never observes a partial document",
        "writer_exclusivity": "O_EXCL LOCK file in the document directory recording the holder's principal and pid, released in a finally block. Single-host qualification only; no distributed locking is claimed.",
    },
    # v1.14 (V113-B1): WHERE the location law is enforced. v1.13 enforced it in the authoring wrapper only, so the
    # two functions the authority surface itself called AUTHORIZING accepted a bare evidence set and returned
    # ATTACHMENT_READY / eligible=true for a document authored under a forbidden root.
    "core_authority": {
        "law": "location authority is part of the authorizing core, not of a wrapper. Precedence inside any authorizing call is LOCATION AUTHORITY -> ATTACHMENT SEMANTICS -> ELIGIBILITY, and a forbidden-location evidence set never reaches the point where readiness is computed.",
        "only_door": "tools/authority_lib.py#load_governed_evidence_set(session_id, active) - takes a session id and the active authority and NOTHING else; it derives the canonical path from the frozen constant itself",
        "provenance_object": "tools/authority_lib.py#GovernedEvidenceSet - constructible ONLY by that loader (a module-private token), __slots__ and no instance dict, so a dict, a namespace object, a subclass or a hand-computed receipt cannot fabricate provenance (LOCATION_PROVENANCE_MISSING)",
        "authorizing_entrypoints": ["derive_attachment_state_authorizing", "derive_attachment_state_for_session",
                                    "evaluate_eligibility_authorizing", "evaluate_eligibility_for_session",
                                    "validate_transaction_set_authorizing", "commit_eligibility_authorizing"],
        # ---- v1.15 (V114-B1) THE consumed-evidence law
        "consumed_evidence_law": "THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION. The carrier holds the validated BYTES and no parsed object: it is frozen after construction (__setattr__/__delattr__ refuse), its evidence_set is a read-only property that strict-parses those bytes afresh on every access, and copy/deepcopy/pickle are refused. On every authorizing call authority_lib.governed_consume() revalidates the live location, re-reads both authority files no-follow, requires the live digests to equal the minted ones AND the carrier's own bytes to digest to the same value, strict-parses those exact bytes, schema-validates them, requires the canonical snapshot digest to equal the one bound into the receipt, and RETURNS the semantic object the authorizing path then consumes. In v1.14 the carrier stored a mutable parsed dict that nothing bound to the validated bytes, so provenance for document A could be presented with semantic evidence B and a false ATTACHMENT_READY derived.",
        "snapshot_domain": L.EVIDENCE_SNAPSHOT_DOMAIN,
        "one_evidence_source": "no authorizing entry point takes both a governed carrier and a separate evidence argument; there is exactly ONE evidence authority input, and it is the carrier.",
        # ---- v1.15 (V114-B4) the authority-FILE law, symmetrical for both governed files
        "authority_files": [L.EVIDENCE_SET_FILE_NAME, L.WORKFLOW_FILE_NAME],
        "authority_file_law": "both governed files are classified by lstat BEFORE anything is opened: a symlink is <KIND>_SYMLINK_REFUSED and never followed, and a FIFO, socket, device or directory is <KIND>_NOT_A_REGULAR_FILE and never opened. Each is then read with O_NOFOLLOW and O_NONBLOCK and the OPEN FILE is re-verified by fstat to be the same regular file (device, inode) the entry check saw, so an entry swapped between check and open is refused. WORKFLOW.json is authority-bearing - session identity, governed root, production-root claim, lifecycle state and the digest sealed at VERIFIED - so its bytes are digested, bound into the location receipt and re-checked on every authorizing call. In v1.14 it was checked for existence only and then opened through strict_load, which followed a symlink (ACCEPTED_WORKFLOW_SYMLINK), blocked forever on a FIFO and raised a raw IsADirectoryError on a directory.",
        # ---- v1.15 (V114-M1) malformed-carrier law
        "malformed_carrier_law": "authority_lib.governed_structure_errors() validates the carrier's type and every field with defaults BEFORE any dereference, so object.__new__, a missing or None slot, a wrong field type, a malformed receipt, a subclass, or a copy/deepcopy/pickle attempt fails closed as GOVERNED_EVIDENCE_INVALID inside the frozen vocabulary. In v1.14 object.__new__(GovernedEvidenceSet) passed isinstance and leaked a raw AttributeError out of both public authorizing boundaries. Genuine internal programming errors are NOT masked: only malformed external authority input is normalised (the v1.10 programming-error distinction is preserved).",
        "diagnostic_non_authorizing": list(L.AUTHORITY_SURFACE["diagnostic_non_authorizing"]),
        "provisional_until_m3_non_authorizing": list(L.AUTHORITY_SURFACE["provisional_until_m3_non_authorizing"]),
        "transaction_authority_law": "v1.15 (V114-B2): the authorizing transaction and commit entry points require a GovernedEvidenceSet, consume the bytes-bound snapshot, and evaluate plan-time eligibility through evaluate_eligibility_authorizing, so no diagnostic eligibility result can influence transaction validity, mutation-plan acceptance or a commit decision. semantic_mutation_plan stays INTERNAL_NON_AUTHORIZING and chooses its eligibility law BY TYPE - governed carrier -> authorizing gate, bare dict -> diagnostic - never by a caller-supplied callback. The bare-dict validate_transaction_set/commit_eligibility pair is retained unchanged for fixtures and diagnosis and is classified PROVISIONAL_UNTIL_M3 / NON-AUTHORIZING. In v1.14 the complete committed-consistent fixture supplied as a raw dict completed all twelve stages and produced commit_eligibility.eligible=true.",
        "diagnostic_law": "authority_lib.derive_attachment_state and authority_lib.evaluate_eligibility are the SEMANTIC derivation only. They know nothing about where the evidence set came from, they carry no location receipt, and no authorizing entry point accepts their output. They exist for fixtures, in-memory evidence sets and diagnostics.",
        # V115-M1 (Codex v1.15 MERGE MAJOR): this list published only the seven v1.14 fields while
        # authority_lib.location_receipt() bound TEN - workflow_path, workflow_sha256 and evidence_snapshot_digest
        # were missing from the machine authority Hermes reads. It is now GENERATED from the runtime, with per-field
        # semantics, and validate_v1_19.py compares the two sets in both directions.
        "receipt": dict(L.receipt_binding_publication(),
                        law="recomputed from the live filesystem on EVERY authorizing call by governed_consume(), never trusted as a field. Possession of a previously valid object is not authority: a document changed underneath it, a different active manifest or a non-canonical path is LOCATION_RECEIPT_INVALID."),
        "no_state_parameter": "evaluate_eligibility_authorizing has no attachment-state parameter of any kind; it recomputes the state from the governed document, so a precomputed or diagnostic state cannot bootstrap eligibility",
        "fail_closed": "absent or invalid location provenance yields eligible=false with reason code LOCATION_AUTHORITY_INVALID, and a derivation of CONFLICT with authorizing=false and no readiness value",
        "one_implementation": "the root resolver, the session-id law and the directory-entry trust check exist ONCE, in tools/authority_lib.py (authority_attachment_root, session_id_errors, governed_dir_errors). tools/evidence_authoring.py delegates to them and keeps its own earlier checks as DEFENCE IN DEPTH, never as the only guard.",
        "refusal_codes": list(L.LOCATION_ERRORS) + ["LOCATION_AUTHORITY_INVALID"],
        "residual": "v1.14 recorded as a residual that the M3 composed path consumed the diagnostic eligibility. Codex classified that residual a BLOCKER (V114-B2) because commit_eligibility returned eligible=true from a bare evidence dict, and v1.15 closes it: the authorizing transaction/commit pair requires governed provenance and the bare-dict pair is no longer authorizing. What remains outside v1.15's scope is the rest of pre-M3 transaction design, which is unchanged.",
    },
    "lifecycle": {
        "states": list(L.EVIDENCE_SET_STATES),
        "transitions": [{"from": None, "to": "OPEN", "by": "PREPARER", "function": "create_evidence_set"},
                        {"from": "OPEN", "to": "PREPARED", "by": "PREPARER", "function": "mark_prepared",
                         "requires": "exactly one PROVISIONING_RECORD and exactly one LAUNCH_RECIPE",
                         "seals": "prepared_content_sha256 over both preparer record ids"},
                        {"from": "PREPARED", "to": "VERIFIED", "by": "VERIFIER", "function": "add_bundle_verification",
                         "seals": "evidence_set_sha256 over the whole document; both files become mode 0400"}],
        "state_grants": {st: {r: list(t) for r, t in sorted(g.items())} for st, g in sorted(L.EVIDENCE_SET_STATE_GRANTS.items())},
        "no_append_after_freeze": "VERIFIED grants no record type to any role, and evidence_set_sha256 is re-checked on every load, so there is no append-after-finalization path and no successor-document mechanism is required",
        "why_a_lifecycle_is_needed": "the preparer must stop writing before the verifier attests, or the verifier attests to inputs that can still change. The two seals make a post-verification edit detectable and the derivation binding makes it fatal.",
    },
    "toctou": {
        # V116-B1 (Codex v1.16 BLOCKER): this CURRENT normative law designated the DIAGNOSTIC
        # authority_lib.derive_attachment_state as the refusing authority. TOCTOU semantics are unchanged - only the
        # named function is corrected to the authorizing entry point, and the diagnostic counterpart is named
        # explicitly AS diagnostic in its own clause.
        "law": "a BUNDLE_VERIFICATION names the exact record ids it verified. A record id is a content digest, so editing a verified preparer record changes its id and the bundle's binding no longer resolves. The AUTHORIZING refusal is tools/authority_lib.py#derive_attachment_state_authorizing (equivalently #derive_attachment_state_for_session, which loads through #load_governed_evidence_set), which refuses such an evidence set. The bare-evidence tools/authority_lib.py#derive_attachment_state is DIAGNOSTIC / NON_AUTHORIZING and applies the same semantic rule for fixtures and diagnosis only.",
        "additional_seals": ["prepared_content_sha256 re-checked inside add_bundle_verification",
                             "evidence_set_sha256 re-checked on every _load after VERIFIED"],
    },
    "read_only_journal": {
        "owner": "PREPARER", "layer": "PROBE ELIGIBILITY",
        "law": "READ_ONLY_JOURNAL satisfies the PERMISSIONS.json prerequisite READ_ONLY_JOURNAL_OPEN for READ_PRIMITIVE_QUALIFICATION_PROBE. It is NOT attachment evidence, the attachment derivation (#derive_attachment_state_authorizing, and equally the diagnostic #derive_attachment_state) ignores it entirely, and it is never a substitute for BUNDLE_VERIFICATION.",
    },
    "current_session_id": {
        "law": "a LABEL naming the Resolve session under evaluation. It is NOT a Store.v5 evidence-store session id, and no Store.v5 session-manifest field (probe_id, capability_matrix_sha256, primitive_spec_sha256, ...) belongs in any attachment record.",
        "container_separation": "Store.v5 carries raw M0A capture evidence and session integrity; the resolveEvidenceSet document carries attachment and provisioning authority. v1.12 freezes the BRIDGE (this document), not a merger. tools/evidence_authoring.py never creates, opens, finalizes or reads a Store.v5 session.",
    },
    "envelope_derivation": {
        "derived_from_target_contract": ["host_name", "product", "resolve_version", "build", "library_name"],
        "derived_from_active_authority": ["authority_version", "manifest_sha256"],
        "derived_from_provisioning_record": ["library_uuid", "library_root", "provisioning_id"],
        "derived_from_document": ["session_id"],
        "derived_from_store_law": ["record_type_version"],
        "caller_supplied": list(__import__("evidence_authoring").ENVELOPE_CALLER_SUPPLIED),
        "forbidden_to_caller": list(__import__("evidence_authoring").ENVELOPE_FORBIDDEN_TO_CALLER),
        "trap_closed": "resolve_version is the COMPUTED contract form (authority_lib._contract_env), not tc.resolve.version; the constructor derives it so the v1.11 trap cannot be reproduced by hand",
    },
    "tools": {"authoring_library": L.EVIDENCE_AUTHORING_MODULE, "preparer_cli": L.PREPARER_TOOL,
              "verifier_cli": L.VERIFIER_TOOL,
              "constructors": ["create_evidence_set", "add_provisioning_record", "add_launch_recipe",
                               "add_read_only_journal", "mark_prepared", "add_bundle_verification",
                               "load_evidence_set", "workflow_state", "validate_evidence_set",
                               "evidence_authoring.derive_attachment_state (the AUTHORIZING wrapper: it loads through "
                               "authority_lib.load_governed_evidence_set and calls "
                               "authority_lib.derive_attachment_state_authorizing)"],
              "no_body_only_path": "every constructor routes through authority_lib.make_record and authority_lib.envelope_errors; there is no code path that stores a body-only object"},
})

# ============================================================ section 8: the boundary + inventory field provenance table
import evidence_store as ESTORE  # noqa: E402

# v1.11 F110-A section 1 / F110-B section 10: the published table is DERIVED FROM the executable authority, so it can
# never again claim a derivation the verifier does not perform. That was the shape of both v1.10 findings: this file
# already published record_count and the other five as derived while nothing compared them.
PROVENANCE = {
    "schema": "vidtoolz.resolveInventoryFieldProvenance.v1.11",
    "authority_version": L.AUTHORITY_VERSION,
    "law": "every NORMATIVE inventory, boundary and finalization field is classified by the source the verifier derives it from. No normative field may be classified TRUSTED_FROM_INVENTORY_ITSELF: the stored inventory is evidence that is compared against an independently recomputed model, never the model. validate_v1_19.py asserts this table is complete, that no normative field is self-asserted, and (v1.11) that every field the table classifies as reconciled is ACTUALLY compared by tools/evidence_store.py against a source outside the document it appears in.",
    "sources": ["DERIVED_FROM_FILESYSTEM", "DERIVED_FROM_RECORD_BYTES", "DERIVED_FROM_SESSION_AUTHORITY", "DERIVED_FROM_SCHEMA", "FROZEN_CONSTANT", "NON_NORMATIVE"],
    "forbidden_source": "TRUSTED_FROM_INVENTORY_ITSELF",
    # ---- F110-A section 1: EXACTLY four classes, EXACTLY one per BOUNDARY.json field, no ambiguous category.
    "boundary_sources": [ESTORE.PROV_FS, ESTORE.PROV_SESSION, ESTORE.PROV_CONST, ESTORE.PROV_INFO],
    "boundary_field_set": list(sorted(ESTORE.BOUNDARY_FIELDS + ("boundary_sha256",))),
    "boundary_fields": dict(sorted(ESTORE.BOUNDARY_PROVENANCE.items())),
    "boundary_frozen_constants": dict(sorted(ESTORE.BOUNDARY_FROZEN_CONSTANTS.items())),
    "boundary_digest_law": "boundary_sha256 is BYTE INTEGRITY over the stored receipt, not semantic truth. A consistent rewrite recomputes it, which is exactly the v1.10 F110-A defect. Authorization requires the stored receipt AND independent reconciliation of every normative field: the four FROZEN_CONSTANT fields against this authority's constants in _boundary_receipt(), the six DERIVED_FROM_FILESYSTEM fields against a fresh lstat of the root and the session directory in check_boundary(), and session_id against the session this store was opened as.",
    "created_at_classification": ESTORE.CREATED_AT_CLASSIFICATION,
    "created_at_law": "DELIBERATE DECISION (F110-A section 6, option A). created_at is INFORMATIONAL_NON_AUTHORIZING. This store governs no independent creation-event authority: it deliberately records no timestamp, owner or inode age as governed metadata (see mode_metadata_law), so there is nothing outside the receipt to bind created_at to. Comparing it to the session manifest's created_at would compare two caller-supplied values written by the same call in the same trust domain, which is the self-assertion F110-A objects to. Consequences, all explicit: it is type-checked (string or null) but never authorizing; it is excluded from boundary_identity() and therefore from the session identity tuple; it remains inside boundary_sha256 so an UNRECOMPUTED edit is still caught as byte tampering; and a CONSISTENT rewrite of it does NOT refuse. No claim that every BOUNDARY field is normative survives in v1.11.",
    # ---- F110-B section 10: the EXACT frozen top-level vocabularies. Extension is a schema version, never an extra key.
    "inventory_field_set": list(ESTORE.INVENTORY_FIELD_SET),
    "finalization_field_set": list(sorted(ESTORE.FINALIZATION_FIELDS)),
    "field_set_law": "the BOUNDARY receipt, the INVENTORY header and the FINALIZATION marker each have an EXACT top-level field set. Verification refuses a missing normative field, an unknown extra semantic field, a duplicate field (refused at the strict parse boundary by authority_lib.strict_loads) and a wrong type. Semantic extension requires an inventory schema version: that is why the closed vocabulary took resolveEvidenceInventory.v3 to v4.",
    "total_bytes_scope": ESTORE.TOTAL_BYTES_SCOPE,
    "total_bytes_scope_law": "total_bytes is the sum of byte_count over every governed REGULAR file entry of the closed world EXCEPT INVENTORY.json and FINALIZED, which finalization itself creates and which therefore cannot be inside their own count. It is recomputed over exactly the entry set finalize() counted, so the comparison is an exact equality.",
    # ---- F110-D sections 27/33: the public authority surface and the frozen error precedence.
    "public_authority_methods": list(ESTORE.PUBLIC_AUTHORITY_METHODS),
    "public_non_authority_members": list(ESTORE.PUBLIC_NON_AUTHORITY),
    "boundary_dominance_law": "every member of public_authority_methods checks the persisted boundary BEFORE any state, model or read precondition. Members whose contract is to return data raise the boundary refusal; members whose contract is to return a refusal list or a state label report it FIRST in their own vocabulary. The only unchecked surfaces are private (_boundary_receipt, _scan_tree, _manifest, _inventory, _finalization_marker, _put, _require_can_write) because check_boundary() is built from them.",
    "error_precedence": list(ESTORE.ERROR_PRECEDENCE),
    "error_precedence_classes": {k: list(v) for k, v in sorted(ESTORE.ERROR_PRECEDENCE_CLASS.items())},
    "error_precedence_law": "BOUNDARY invalidity dominates SESSION_STATE, which dominates MODEL, which dominates READ. A lower class may never be reported while a higher one holds. In v1.10 inventory() answered SESSION_NOT_FINALIZED for a session whose directory had been replaced, masking the substitution with a lesser status error.",
    "marker_cardinality_law": "L7 is a BIJECTION with exact cardinality in both directions. For every authoritative record the set of valid attempt markers resolving to it has size exactly one: zero is ORPHANED_RECORD, more than one is MARKER_CARDINALITY_VIOLATION. Every marker resolves to exactly one authoritative record whose semantic key recomputes from the marker tuple. _put() refuses a second attempt id for an already-recorded (session, layer, logical identity, content) BEFORE any marker is persisted, and expected_model() refuses a persisted many-to-one state, so the public API and the persisted verifier enforce the same rule.",
    "verifier_binding": {
        "BOUNDARY.schema": "evidence_store.EvidenceStore._boundary_receipt vs EVIDENCE_BOUNDARY_SCHEMA",
        "BOUNDARY.evidence_store_version": "evidence_store.EvidenceStore._boundary_receipt vs EVIDENCE_STORE_VERSION",
        "BOUNDARY.authority_version": "evidence_store.EvidenceStore._boundary_receipt vs authority_lib.AUTHORITY_VERSION",
        "BOUNDARY.platform_scope": "evidence_store.EvidenceStore._boundary_receipt vs PLATFORM_SCOPE",
        "BOUNDARY.session_id": "evidence_store.EvidenceStore.check_boundary vs the opened session id and the receipt's own session_basename",
        "BOUNDARY.root_path": "evidence_store.EvidenceStore.check_boundary vs os.path.abspath of the configured root",
        "BOUNDARY.root_device": "evidence_store.EvidenceStore.check_boundary vs a fresh lstat of root_path",
        "BOUNDARY.root_inode": "evidence_store.EvidenceStore.check_boundary vs a fresh lstat of root_path",
        "BOUNDARY.session_basename": "evidence_store.EvidenceStore.check_boundary vs os.path.basename of the session directory",
        "BOUNDARY.session_device": "evidence_store.EvidenceStore.check_boundary vs a fresh lstat of the session directory",
        "BOUNDARY.session_inode": "evidence_store.EvidenceStore.check_boundary vs a fresh lstat of the session directory",
        "BOUNDARY.boundary_sha256": "evidence_store.boundary_digest over the stored receipt bytes (integrity only)",
        "BOUNDARY.created_at": "NOT RECONCILED BY DESIGN - INFORMATIONAL_NON_AUTHORIZING, type-checked only",
        "INVENTORY.record_count": "evidence_store.EvidenceStore.verify_summary vs the KIND_RECORD entries of expected_model()",
        "INVENTORY.entry_count": "evidence_store.EvidenceStore.verify_summary vs len() of the expected governed entry set",
        "INVENTORY.total_bytes": "evidence_store.EvidenceStore.verify_summary vs the byte_count sum over TOTAL_BYTES_SCOPE",
        "INVENTORY.attempt_count": "evidence_store.EvidenceStore.verify_summary vs the KIND_ATTEMPT_MARKER entries of expected_model()",
        "INVENTORY.self_path": "evidence_store.EvidenceStore.verify_summary vs the frozen INVENTORY_FILE store-layout constant",
        "INVENTORY.finalized_marker_path": "evidence_store.EvidenceStore.verify_summary vs the frozen FINALIZED_FILE store-layout constant",
    },
    "fields": {
        "schema": "DERIVED_FROM_SCHEMA", "evidence_store_version": "FROZEN_CONSTANT",
        "authority_version": "FROZEN_CONSTANT", "platform_scope": "FROZEN_CONSTANT",
        "session_id": "DERIVED_FROM_SESSION_AUTHORITY", "session_dir_basename": "DERIVED_FROM_FILESYSTEM",
        "session_identity_sha256": "DERIVED_FROM_SESSION_AUTHORITY", "boundary_identity_sha256": "DERIVED_FROM_SESSION_AUTHORITY",
        "boundary_sha256": "DERIVED_FROM_SESSION_AUTHORITY", "session_manifest_sha256": "DERIVED_FROM_FILESYSTEM",
        "closed_world": "FROZEN_CONSTANT", "semantic_reconciliation": "FROZEN_CONSTANT", "recomputed_model": "FROZEN_CONSTANT",
        "record_count": "DERIVED_FROM_FILESYSTEM", "entry_count": "DERIVED_FROM_FILESYSTEM",
        "total_bytes": "DERIVED_FROM_FILESYSTEM", "attempt_count": "DERIVED_FROM_FILESYSTEM",
        "mode_table": "FROZEN_CONSTANT", "self_path": "FROZEN_CONSTANT", "finalized_marker_path": "FROZEN_CONSTANT",
        "directories": "DERIVED_FROM_FILESYSTEM", "entries": "DERIVED_FROM_FILESYSTEM",
        "entries[].path": "DERIVED_FROM_FILESYSTEM", "entries[].kind": "DERIVED_FROM_SCHEMA",
        "entries[].content_sha256": "DERIVED_FROM_RECORD_BYTES", "entries[].byte_count": "DERIVED_FROM_RECORD_BYTES",
        "entries[].file_type": "DERIVED_FROM_FILESYSTEM", "entries[].mode": "FROZEN_CONSTANT",
        "entries[].layer": "DERIVED_FROM_FILESYSTEM", "entries[].record_key": "DERIVED_FROM_SESSION_AUTHORITY",
        "entries[].logical_identity": "DERIVED_FROM_RECORD_BYTES", "entries[].internal_session_id": "DERIVED_FROM_RECORD_BYTES",
        "entries[].internal_probe_id": "DERIVED_FROM_RECORD_BYTES", "entries[].attempt_ids": "DERIVED_FROM_RECORD_BYTES",
        "entries[].attempt_keys": "DERIVED_FROM_SESSION_AUTHORITY",
        "directories[].path": "DERIVED_FROM_FILESYSTEM", "directories[].kind": "DERIVED_FROM_SCHEMA",
        "directories[].file_type": "DERIVED_FROM_FILESYSTEM", "directories[].mode": "FROZEN_CONSTANT",
        "directories[].parent": "DERIVED_FROM_FILESYSTEM",
        "finalization.schema": "DERIVED_FROM_SCHEMA", "finalization.evidence_store_version": "FROZEN_CONSTANT",
        "finalization.authority_version": "FROZEN_CONSTANT", "finalization.platform_scope": "FROZEN_CONSTANT",
        "finalization.session_id": "DERIVED_FROM_SESSION_AUTHORITY",
        "finalization.session_identity_sha256": "DERIVED_FROM_SESSION_AUTHORITY",
        "finalization.boundary_identity_sha256": "DERIVED_FROM_SESSION_AUTHORITY",
        "finalization.inventory_sha256": "DERIVED_FROM_FILESYSTEM", "finalization.state": "FROZEN_CONSTANT",
    },
}
dump("INVENTORY-FIELD-PROVENANCE.json", PROVENANCE)
# The $id moves to v1.11 because this document's FIELD CONTRACT changed: it now requires the boundary provenance
# table, the exact field-set vocabularies, the public authority surface, the error precedence and the verifier
# binding. Schemas whose contract did not change keep their existing $id even where the authority-version const they
# pin moved to 1.11.0 (see CHANGELOG-v1.11.md "version decisions").
prov_schema = S("vidtoolz.resolveInventoryFieldProvenance.v1.11", "Boundary and inventory field provenance v1.11 (no normative field is self-asserted, and every classified field is actually compared)",
                {"schema": {"const": "vidtoolz.resolveInventoryFieldProvenance.v1.11"}, "authority_version": {"const": L.AUTHORITY_VERSION},
                 "law": {"type": "string"}, "sources": {"type": "array", "items": {"type": "string"}},
                 "forbidden_source": {"const": "TRUSTED_FROM_INVENTORY_ITSELF"},
                 "fields": {"type": "object", "additionalProperties": {"enum": PROVENANCE["sources"]}},
                 "boundary_sources": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4},
                 "boundary_field_set": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                 "boundary_fields": {"type": "object", "additionalProperties": {"enum": PROVENANCE["boundary_sources"]}},
                 "boundary_frozen_constants": {"type": "object", "additionalProperties": {"type": "string"}},
                 "boundary_digest_law": {"type": "string"},
                 "created_at_classification": {"const": ESTORE.PROV_INFO},
                 "created_at_law": {"type": "string"},
                 "inventory_field_set": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                 "finalization_field_set": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                 "field_set_law": {"type": "string"},
                 "total_bytes_scope": {"const": ESTORE.TOTAL_BYTES_SCOPE},
                 "total_bytes_scope_law": {"type": "string"},
                 "public_authority_methods": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                 "public_non_authority_members": {"type": "array", "items": {"type": "string"}},
                 "boundary_dominance_law": {"type": "string"},
                 "error_precedence": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4},
                 "error_precedence_classes": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
                 "error_precedence_law": {"type": "string"},
                 "marker_cardinality_law": {"type": "string"},
                 "verifier_binding": {"type": "object", "additionalProperties": {"type": "string"}}},
                ["schema", "authority_version", "law", "sources", "forbidden_source", "fields",
                 "boundary_sources", "boundary_field_set", "boundary_fields", "boundary_frozen_constants",
                 "boundary_digest_law", "created_at_classification", "created_at_law", "inventory_field_set",
                 "finalization_field_set", "field_set_law", "total_bytes_scope", "total_bytes_scope_law",
                 "public_authority_methods", "public_non_authority_members", "boundary_dominance_law",
                 "error_precedence", "error_precedence_classes", "error_precedence_law", "marker_cardinality_law",
                 "verifier_binding"])
dump("schemas/resolveInventoryFieldProvenance.schema.json", prov_schema)

# ============================================================ section 28: the Hermes M0A binding values, no placeholders
M0A_VALUES = {
    "authority_version": L.AUTHORITY_VERSION,
    "raw_schema_id": L.RAW_SCHEMA_ID,
    "raw_schema_version": L.RECORD_TYPE_VERSION,
    "codec_version": L.CODEC,
    "raw_ingest_version": L.RAW_INGEST_VERSION,
    "raw_frame_max_bytes": L.RAW_FRAME_MAX_BYTES,
    "trusted_shim_version": TRUSTED_SHIM["shim_version"],
    "trusted_shim_sha256": TRUSTED_SHIM["shim_sha256"],
    "trusted_shim_source_path": TRUSTED_SHIM["shim_source_path"],
    "trusted_shim_source_sha256": TRUSTED_SHIM["shim_source_sha256"],
    "trusted_shim_authority_sha256": TRUSTED_SHIM["trusted_shim_sha256"],
    "capture_allowlist_digest": TRUSTED_SHIM["allowlist_digest"],
    "capture_allowlist_method_count": TRUSTED_SHIM["allowlist_method_count"],
    "reference_parser_version": L.PARSER_VERSION,
    "reference_parser_sha256": L.parser_sha256(),
    "primitive_spec_sha256": rp["primitive_spec_sha256"],
    "schema_registry_sha256": SCHEMA_REGISTRY["schema_registry_sha256"],
    "schema_registry_file": L.SCHEMA_REGISTRY_FILE,
    "trusted_shim_file": L.TRUSTED_SHIM_FILE,
    "evidence_store_version": ESTORE.EVIDENCE_STORE_VERSION,
    "evidence_session_schema": ESTORE.EVIDENCE_SESSION_SCHEMA,
    "evidence_inventory_schema": ESTORE.EVIDENCE_INVENTORY_SCHEMA,
    "evidence_finalization_schema": ESTORE.EVIDENCE_FINALIZATION_SCHEMA,
    "evidence_boundary_schema": ESTORE.EVIDENCE_BOUNDARY_SCHEMA,
    "boundary_receipt_file": ESTORE.BOUNDARY_FILE,
    "boundary_receipt_law": "create_session persists a SESSION_BOUNDARY receipt binding the configured root path, device and inode and the session basename, device and inode; it is governed evidence and is re-checked before every authorizing operation",
    "root_session_identity_law": "the session identity tuple includes the boundary identity digest, so the same bytes under another root or another session-directory inode are a different, invalid session",
    "attempt_marker_derivation_law": "stored attempt markers are never trusted from filename or content: markers and records must reconcile as a bijection, each derived from the other, and attempt ids are unique in addition to attempt keys",
    "active_integrity_law": "active_integrity() must be clean before any write and before finalize; an ACTIVE session with an integrity violation is INVALID and can never finalize",
    "mode_authority_law": "expected mode is derived from entry KIND via the frozen MODE_TABLE, covers the session directory, and is enforced continuously from creation onward",
    "filesystem_refusal_vocabulary": ", ".join(c for c in ESTORE.ERROR_CODES if c.startswith("FS_")),
    "inventory_field_provenance_file": "INVENTORY-FIELD-PROVENANCE.json",
    "evidence_store_platform_scope": ESTORE.PLATFORM_SCOPE,
    "session_path_identity_law": "the session directory basename IS the session_id, exactly (policy A); the verifier recomputes it and refuses SESSION_PATH_MISMATCH on any rename",
    "session_identity_tuple": ", ".join(ESTORE.SESSION_IDENTITY_FIELDS),
    "attempt_tuple_law": "attempt uniqueness key is (session_id, layer, logical_identity, attempt_id) bound to the record bytes; cross-layer and cross-identity reuse of an attempt id are refused by name. v1.11 (F110-C): markers and authoritative records are a BIJECTION with EXACT cardinality in both directions - exactly one marker per authoritative record and exactly one record per marker. A SECOND attempt id over the same (session_id, layer, logical_identity, content) is refused MARKER_CARDINALITY_VIOLATION at the write, before any marker is persisted, and a persisted many-to-one state is refused by ACTIVE integrity, finalize() and verify(). An M0A package must therefore derive each attempt id from exactly one probe attempt and must never retry the same captured bytes under a new attempt id for the same logical identity; a retry of an unchanged capture is the idempotent same-tuple write.",
    "record_key_law": "a record's storage name is sha256 over (session_id, layer, logical_identity, content digest); the verifier recomputes it from the record's semantics and compares it to the actual path",
    "mode_metadata_law": "POSIX file type and permission mode are frozen for every governed file and directory (dirs 0o700, records and attempt markers 0o400, session manifest / inventory / finalization marker 0o444, journal 0o600); no inode, timestamp or owner is recorded",
    "root_symlink_refusal_law": "the evidence root and the session directory entry are inspected with lstat BEFORE any resolution; a symlink at either refuses ROOT_SYMLINK_REFUSED or SESSION_SYMLINK_REFUSED, and the root device+inode are re-checked on every operation",
    "verification_counters": "PASS requires missing == 0, unexpected == 0, changed == 0 and semantic_mismatch == 0",
    "boundary_recheck_law": "v1.11 (F110-A, F110-D): every normative BOUNDARY.json field is independently reconciled before any authorizing operation - schema, evidence_store_version, authority_version and platform_scope against the frozen constants of THIS authority, and root path/device/inode plus session basename/device/inode against a fresh lstat. created_at is INFORMATIONAL_NON_AUTHORIZING. boundary_sha256 is byte integrity over the stored receipt, never semantic truth. Every public authority-bearing method checks the persisted boundary FIRST under the frozen precedence BOUNDARY > SESSION_STATE > MODEL > READ, so a replaced session can never be reported as SESSION_NOT_FINALIZED or answer with live data.",
    "inventory_field_vocabulary": ", ".join(ESTORE.INVENTORY_FIELD_SET),
    "inventory_field_set_law": "v1.11 (F110-B): the top-level INVENTORY field set is EXACT. A missing normative field, an unknown extra semantic field, a duplicate field or a wrong type is a refusal (INVENTORY_FIELD_SET_INVALID), and semantic extension requires an inventory schema version. record_count, entry_count, total_bytes, attempt_count, self_path and finalized_marker_path are recomputed from the independent model and the frozen store layout; total_bytes scope is " + ESTORE.TOTAL_BYTES_SCOPE + ".",
    "public_authority_surface": ", ".join(ESTORE.PUBLIC_AUTHORITY_METHODS),
    "error_precedence": " > ".join(ESTORE.ERROR_PRECEDENCE),
    "created_at_classification": ESTORE.CREATED_AT_CLASSIFICATION,
    # ---- v1.12 (V112-1..V112-4) the pre-M0A workflow bindings Hermes's harness needs
    "evidence_set_schema": L.EVIDENCE_SET_SCHEMA_ID,
    "evidence_set_governed_root": L.QUALIFICATION_EVIDENCE_ROOT,
    "evidence_set_path_law": L.QUALIFICATION_EVIDENCE_ROOT + "/attachment/<current_session_id>/EVIDENCE-SET.json (siblings WORKFLOW.json, LOCK)",
    "evidence_set_lifecycle": " -> ".join(L.EVIDENCE_SET_STATES) + "; OPEN grants the PREPARER its three record types, PREPARED grants the VERIFIER only BUNDLE_VERIFICATION, VERIFIED grants nothing to anyone",
    "evidence_set_record_type_version": L.RECORD_TYPE_VERSION,
    "preparer_principals": ", ".join(L.PRINCIPAL_REGISTRY["PREPARER"]),
    "verifier_principals": ", ".join(L.PRINCIPAL_REGISTRY["VERIFIER"]),
    "principal_law": "a principal is '<ROLE>:<actor>' registered in PRINCIPALS.json and stamped by the tool for the ONE role that tool implements. No ACTOR holds two roles. It is a role-bound operational label, NOT an authenticated identity: no key, no signature, no certificate.",
    "authoring_library": L.EVIDENCE_AUTHORING_MODULE,
    "authoring_library_sha256": sha_of(L.EVIDENCE_AUTHORING_MODULE),
    "preparer_tool": L.PREPARER_TOOL,
    "preparer_tool_sha256": sha_of(L.PREPARER_TOOL),
    "verifier_tool": L.VERIFIER_TOOL,
    "verifier_tool_sha256": sha_of(L.VERIFIER_TOOL),
    "constructor_functions": "evidence_authoring.create_evidence_set, evidence_authoring.add_provisioning_record, evidence_authoring.add_launch_recipe, evidence_authoring.add_read_only_journal, evidence_authoring.mark_prepared, evidence_authoring.add_bundle_verification, evidence_authoring.load_evidence_set, evidence_authoring.workflow_state, evidence_authoring.validate_evidence_set, evidence_authoring.derive_attachment_state (the AUTHORIZING wrapper, which loads through authority_lib.load_governed_evidence_set and calls authority_lib.derive_attachment_state_authorizing)",
    "state_derivation_entrypoint": "evidence_authoring.derive_attachment_state(session_id) -> authority_lib.load_governed_evidence_set(session_id, active) -> authority_lib.derive_attachment_state_authorizing(target_contract, GovernedEvidenceSet, active) (v1.14: the wrapper no longer calls the diagnostic authority_lib.derive_attachment_state)",
    "verifier_action_name": "A2V",
    "verifier_action_law": "A2V INDEPENDENT BUNDLE VERIFICATION is a DISTINCT named human authorization: it is not part of A2, not part of A1 and not part of M0B. It requires a registered VERIFIER principal whose ACTOR differs from the preparer's, and it may author no record type but BUNDLE_VERIFICATION.",
    "bundle_verification_content": "authority_version, manifest_sha256, verifier, prepared_by, historical (v1.11) + verification_result, verifier_principal, preparer_principal, verified_provisioning_id, verified_launch_recipe_id, pinned_file_digests (v1.12)",
    "bundle_verification_derived_not_supplied": "the verifier tool supplies ONLY its own principal; the result, both principals, both verified record ids, the manifest digest and the 9 pinned-file digests are computed by the tool itself",
    "verification_result_law": "only PASS satisfies the attachment gate; a FAIL record is written for audit and refused by the attachment derivation (#derive_attachment_state_authorizing on the authorizing path; the diagnostic #derive_attachment_state applies the same semantic rule)",
    "finalization_lock_law": "O_EXCL LOCK file in the document directory recording the holder's principal and pid; atomic sibling-temp + os.replace for every write; prepared_content_sha256 sealed at PREPARED; evidence_set_sha256 sealed at VERIFIED and re-checked on every load; both files become mode 0400. Single-host qualification; no distributed locking is claimed.",
    "toctou_law": "a BUNDLE_VERIFICATION names the exact provisioning and launch record ids it verified; a record id is a content digest, so editing a verified preparer record breaks the binding and the attachment derivation refuses (#derive_attachment_state_authorizing on the authorizing path; the diagnostic #derive_attachment_state applies the same semantic rule)",
    "staleness_law": "evidence_authoring.derive_attachment_state refuses a governed document whose evaluated_at is older than MAX_OBSERVATION_AGE_S (" + str(L.MAX_OBSERVATION_AGE_S) + "s) or more than 60s in the future",
    "read_only_journal_ownership": "PREPARER; PROBE ELIGIBILITY layer (PERMISSIONS.json READ_ONLY_JOURNAL_OPEN). It is not attachment evidence and never substitutes for BUNDLE_VERIFICATION.",
    "container_separation_law": "Store.v5 carries raw M0A capture evidence and session integrity; the resolveEvidenceSet document carries attachment and provisioning authority. current_session_id is a LABEL naming the Resolve session under evaluation, never a Store.v5 session id, and no Store.v5 session-manifest field belongs in an attachment record.",
    # ---- v1.13 (V112-RP1) governed-root bindings
    "governed_attachment_root": L.GOVERNED_ATTACHMENT_ROOT,
    "governed_attachment_root_mode": L.GOVERNED_ROOT_MODE,
    "governed_root_caller_selectable": "NO - no authorizing function and neither production CLI accepts a root parameter of any name. governed_attachment_root() takes no argument.",
    "governed_root_resolver": L.EVIDENCE_AUTHORING_MODULE + "#governed_attachment_root",
    "governed_root_trust_law": "the governed root and the session directory are classified by lstat BEFORE any resolution: a symlink at either is ROOT_SYMLINK_REFUSED / SESSION_SYMLINK_REFUSED and never followed. realpath is only ever a later alias check; the module contains no .resolve() call. The root must be absolute, already normalised, an existing directory with mode 0700.",
    "governed_location_recheck_law": "re-established on EVERY authorizing load - update, verify, finalize and derive - not only at creation. The authorizing derivation also requires the document's authority_root to equal the frozen constant and written_under_production_root to be true.",
    "governed_path_refusal_codes": "ROOT_NOT_GOVERNED, ROOT_SYMLINK_REFUSED, ROOT_NOT_A_DIRECTORY, ROOT_NOT_FOUND, ROOT_MODE_INVALID, SESSION_SYMLINK_REFUSED, SESSION_NOT_A_DIRECTORY, SESSION_PATH_NOT_GOVERNED, NOT_PRODUCTION_ROOT, SET_LOCATION_MISMATCH, SESSION_ID_INVALID",
    "session_id_law": "safe basename only: first character alphanumeric, remainder [A-Za-z0-9._-], maximum 128. Rejects empty, separators, .., leading dot, NUL, absolute syntax, drive letters, whitespace and over-length. No traversal is possible through the session id.",
    "preparer_library_option": "--library-root (renamed from --root in v1.13 so no production CLI carries an option literally called --root; it is the ALREADY-PROVISIONED Resolve Disk library path, a record field, never the evidence root)",
    "test_override_module": "tools/evidence_authoring_testkit.py, AUTHORITY_CLASS INTERNAL_NON_AUTHORIZING; not imported by either production CLI; refuses to sandbox the frozen root; its documents are refused by the authorizing derivation",
    "operational_package_update_required": "any prepared M0A/A2 harness must drop --evidence-root and root= entirely, rename --root to --library-root, and expect the frozen attachment root to exist as a 0700 directory before adopt is called (ROOT_NOT_FOUND otherwise).",

    # ---- v1.14 (V113-B1) authorizing-core bindings: WHERE an authorizing answer may come from
    "authorizing_state_derivation": "authority_lib.derive_attachment_state_authorizing(target_contract, GovernedEvidenceSet, active) or derive_attachment_state_for_session(session_id, target_contract, active)",
    "authorizing_eligibility": "authority_lib.evaluate_eligibility_authorizing(permissions, request, read_primitives, capabilities, target_contract, GovernedEvidenceSet, active) or evaluate_eligibility_for_session(session_id, ...)",
    "governed_evidence_set_loader": "authority_lib.load_governed_evidence_set(session_id, active) - the ONLY door to an authorizing attachment or eligibility answer",
    "diagnostic_non_authorizing_functions": "authority_lib.derive_attachment_state, authority_lib.evaluate_eligibility - DIAGNOSTIC / NON_AUTHORIZING as of v1.14: semantic derivation only, no location authority, no receipt; their output is refused by every authorizing entry point",
    "location_receipt_domain": L.LOCATION_RECEIPT_DOMAIN,
    "location_receipt_binds": "session_id, document_path, workflow_path, governed_root, authority_version, manifest_sha256, document_sha256, workflow_sha256, evidence_snapshot_digest, location_validated",
    "location_provenance_law": "an authorizing answer requires a GovernedEvidenceSet minted by the core loader, and the receipt is recomputed from the live filesystem on every authorizing call. A dict, a namespace object, a subclass, a precomputed state or a diagnostic result is refused LOCATION_PROVENANCE_MISSING; a stale object is refused LOCATION_RECEIPT_INVALID.",
    "location_refusal_codes": ", ".join(list(L.LOCATION_ERRORS) + ["LOCATION_AUTHORITY_INVALID"]),
    "authority_surface_classes": ", ".join(sorted(L.AUTHORITY_SURFACE)),
    # ---- v1.16 (V115-B1, V115-M1) the two machine artifacts a package reads instead of Python
    "function_classification_artifact": "AUTHORITY-FUNCTION-CLASSES.json (generated from authority_lib.AUTHORITY_SURFACE; ONE function -> ONE current authority class, with the authorizing and diagnostic slot inventories and the runtime-lookup law)",
    "receipt_binding_artifact": "EVIDENCE-SET-WORKFLOW.json#core_authority.receipt and AUTHORITY-FUNCTION-CLASSES.json#receipt_binding - both generated from authority_lib.receipt_binding_publication(), so the published field set IS the runtime field set",
    "receipt_bound_field_count": len(L.RECEIPT_BOUND_FIELDS),
    "receipt_bound_fields": ", ".join(L.RECEIPT_BOUND_FIELDS),
    "receipt_field_semantics_published": "field, source, normative, in_digest, revalidated_live, consumed_by_authorizing_core - per field, in both artifacts",
    "operational_package_update_required_v116": "an M0A/A2 harness must derive the receipt field set and every function's authority class from AUTHORITY-FUNCTION-CLASSES.json and EVIDENCE-SET-WORKFLOW.json#core_authority.receipt, NOT by reading Python and NOT from any prose. The published receipt binding gained three fields it always bound at runtime - workflow_path, workflow_sha256 and evidence_snapshot_digest - so a harness that recomputes the receipt from the v1.15 publication computed it over seven fields and would have disagreed with the authority; recompute over all ten, in the published order.",
    # ---- v1.15 (V114-B1..B4, V114-M1) bindings a future M0A/A2 package must carry
    "authorizing_evidence_object_law": "an authorizing answer requires a GovernedEvidenceSet minted by authority_lib.load_governed_evidence_set. It is IMMUTABLE (frozen slots, bytes not a parsed object, evidence_set is a reparsing read-only property) and NOT copyable or picklable. There is exactly one evidence authority input per authorizing call.",
    "immutable_snapshot_law": "THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION. authority_lib.governed_consume() revalidates the location, re-reads both authority files no-follow, requires the live digests to equal the minted ones and the carrier's bytes to digest identically, strict-parses those exact bytes, schema-validates them, checks the canonical snapshot digest bound into the receipt, and returns the object the authorizing path consumes.",
    "evidence_snapshot_domain": L.EVIDENCE_SNAPSHOT_DOMAIN,
    "authorizing_transaction_eligibility": "authority_lib.validate_transaction_set_authorizing / commit_eligibility_authorizing over a GovernedEvidenceSet; plan-time eligibility is evaluated by evaluate_eligibility_authorizing. The bare-dict validate_transaction_set / commit_eligibility pair is PROVISIONAL_UNTIL_M3 and NON-AUTHORIZING.",
    "authority_files": L.EVIDENCE_SET_FILE_NAME + ", " + L.WORKFLOW_FILE_NAME,
    "workflow_file_refusal_codes": "WORKFLOW_NOT_FOUND, WORKFLOW_SYMLINK_REFUSED, WORKFLOW_NOT_A_REGULAR_FILE, WORKFLOW_NOT_AT_CANONICAL_PATH",
    "malformed_object_refusal_code": "GOVERNED_EVIDENCE_INVALID (a malformed governed carrier fails closed; no raw Python exception escapes a public authorizing boundary)",
    "missing_provenance_refusal_code": "GOVERNED_EVIDENCE_REQUIRED (an authorizing transaction/commit path handed evidence with no governed provenance)",
    "snapshot_mismatch_refusal_code": "EVIDENCE_SNAPSHOT_MISMATCH (the consumed semantic object is not the parse of the validated bytes)",
    "operational_package_update_required_v115": "an M0A/A2 harness must (1) obtain evidence ONLY from authority_lib.load_governed_evidence_set(session_id, active) and never construct, copy, pickle or mutate a GovernedEvidenceSet - assignment to any field now raises a frozen refusal; (2) read authorizing results by the authorizing=true flag, the location_receipt and the new evidence_snapshot_digest; (3) call authority_lib.commit_eligibility_authorizing / validate_transaction_set_authorizing for any transaction or commit decision, because the bare-dict pair is no longer authorizing; and (4) expect WORKFLOW.json to be refused as symlink, FIFO, socket, device or directory exactly as EVIDENCE-SET.json is.",
    "operational_package_update_required_v114": "an M0A/A2 harness must not call the DIAGNOSTIC / NON_AUTHORIZING authority_lib.derive_attachment_state or the DIAGNOSTIC / NON_AUTHORIZING authority_lib.evaluate_eligibility for any decision. Load through authority_lib.load_governed_evidence_set(session_id, active) - or simply call evidence_authoring.derive_attachment_state(session_id), which now routes through it - and read the authorizing=true flag and the location_receipt from the result. A harness that passes a bare evidence-set dict now receives CONFLICT / eligible=false with LOCATION_AUTHORITY_INVALID.",
    "library_adoption_law": "tools/a2_prepare.py adopt records the identity of a library that ALREADY exists physically (name, Disk kind, absolute root, canonical UUID, provisioned_by) and matches it against the target contract. It never creates, renames or deletes a Resolve library, and destructive recreation is never required.",
    "evidence_store_module": L.EVIDENCE_STORE_MODULE,
    "evidence_store_sha256": sha_of(L.EVIDENCE_STORE_MODULE),
    "evidence_store_authority_class": L.EVIDENCE_STORE_AUTHORITY_CLASS,
    "closed_world_verification": "FINALIZED sessions are a closed world: the inventory records every governed file and directory, and verification requires missing == 0, unexpected == 0, changed == 0",
    "path_identifier_constraints": ESTORE.NAME_RE.pattern,
    "evidence_layers": ", ".join(ESTORE.LAYERS),
    "stdout_retention": "CONTENT_ADDRESSED_RAW_LAYER",
    "stderr_retention": "CONTENT_ADDRESSED_RAW_LAYER",
}
dump("M0A-BINDING-VALUES.json", {
    "schema": "vidtoolz.resolveM0ABindingValues.v1.10",
    "authority_version": L.AUTHORITY_VERSION,
    "purpose": "The exact identities an M0A probe package must record and be bound to under authority v1.7. Codex's v1.6 operational finding was that Hermes could not bind its M0A package because these values were not operationally closed. Every value here is the value the running code produces; validate_v1_19.py section m0a-binding re-derives each one and fails if any differs or reads as a placeholder.",
    "active_authority_shape": ["authority_version", "manifest_sha256", "capability_matrix_sha256", "trusted_shim_sha256"],
    "retention_rule": "stdout and stderr are never inlined into a raw frame. When a getter attempt produces either stream, the exact bytes are stored as their own content-addressed record in the RAW layer of the evidence session and the frame carries only stdout_sha256 / stderr_sha256. When nothing was captured both fields are null and the retention rule is NOT_CAPTURED. There is no third option and no truncated copy.",
    "manifest_sha256_note": "authority_manifest_sha256 is the sha256 of THIS bundle's FREEZE-MANIFEST.json as frozen; it is deliberately absent from this file so that build -> validate -> manifest -> validate converges. Read it from FREEZE-MANIFEST.json at probe time.",
    "values": M0A_VALUES,
})
m0a_schema = S("vidtoolz.resolveM0ABindingValues.v1.10", "M0A binding values v1.10 (the identities a probe package must bind to)",
               {"schema": {"const": "vidtoolz.resolveM0ABindingValues.v1.10"}, "authority_version": {"const": L.AUTHORITY_VERSION}, "purpose": {"type": "string"}, "active_authority_shape": {"type": "array", "items": {"type": "string"}}, "retention_rule": {"type": "string"}, "manifest_sha256_note": {"type": "string"},
                "values": {"type": "object", "additionalProperties": False, "required": sorted(M0A_VALUES), "properties": {k: ({"type": "integer", "minimum": 1} if isinstance(v, int) else {"type": "string", "minLength": 1}) for k, v in M0A_VALUES.items()}}},
               ["schema", "authority_version", "purpose", "active_authority_shape", "retention_rule", "manifest_sha256_note", "values"])
dump("schemas/resolveM0ABindingValues.schema.json", m0a_schema)
# the two new schemas changed the schema set, so the registry is regenerated once more and re-verified
SCHEMA_REGISTRY = L.compute_schema_registry()
dump(L.SCHEMA_REGISTRY_FILE, SCHEMA_REGISTRY)
L.clear_authority_caches()
assert L.schema_registry()["schema_registry_sha256"] == SCHEMA_REGISTRY["schema_registry_sha256"]
M0A = load("M0A-BINDING-VALUES.json")
M0A["values"]["schema_registry_sha256"] = SCHEMA_REGISTRY["schema_registry_sha256"]
dump("M0A-BINDING-VALUES.json", M0A)
print("build_v1_7: trust roots pinned; schemas:", SCHEMA_REGISTRY["schema_count"], "; M0A binding values:", len(M0A_VALUES))
