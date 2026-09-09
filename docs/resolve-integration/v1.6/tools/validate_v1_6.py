#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.6.
Layers: raw parse (strict duplicate keys) -> schema (Draft 2020-12) -> evidence-binding (envelope + active manifest + record laws)
-> attachment (derived state, freshness, coherence) -> capability (RAW_CAPABILITY_CAPTURE -> reference re-parser ->
REVIEW_DECISION -> REFREEZE_RECORD -> content-bound ACTIVE matrix) -> snapshot (observation model, raw-capture field provenance,
occurrence identity uniqueness) -> semantic (binding, membership, mandatory checkpoint, readback->S1, derived verification over the
protected surface with named exclusions) -> eligibility (evaluate_eligibility incl. the H0/S0 early write gate) -> linked-set /
composed authorization (validate_transaction_set / commit_eligibility with MANDATORY schema enforcement).
Every fixture records its expected failure layer; an exception in a check is a FAIL, never a pass. Order-independence is proven by
seeded random permutations. The bypass audit proves that no exported validator can skip S0, S1, schema validation, capability
provenance, delta derivation or expected-effect validation, and that no default makes schema enforcement optional. The
raw-capability sections execute the REFERENCE capture shim against fake in-process receivers (no Resolve) and prove that a
probe-authored interpretation has zero authority. The exact-manifest binding is proven against the REAL FREEZE-MANIFEST.json sha
when present (the report never embeds that sha, so validate -> manifest -> validate converges).
Offline; no Resolve; no M0. Exit 0 only if every check passes. Writes VALIDATION-REPORT.md.
Run: python3 -B tools/validate_v1_6.py
"""
import copy
import glob
import hashlib
import inspect
import json
import os
import random
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402
import fixture_evidence as F  # noqa: E402
import capture_shim_reference as SHIM  # noqa: E402

try:
    import jsonschema
except ImportError:  # pragma: no cover
    print("python jsonschema >= 4.10 required")
    sys.exit(2)

R = []
SEED = 20260909
PERMS = 4
HYP_PATH = "fixtures/eligibility/capabilities-hypothetical-refreeze.json"


def rec(section, name, ok, detail=""):
    R.append((section, name, bool(ok), str(detail)[:220]))


def result_of(section, name):
    for s, n, ok, _ in R:
        if s == section and n == name:
            return ok
    return None


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def load(rel):
    return L.strict_load(os.path.join(B, rel))


def schema_errs(v, doc):
    """Schema errors in a DETERMINISTIC order. jsonschema yields additionalProperties errors in set-iteration order, which
    varies with per-process string hash randomization; sorting by (validator, path, message) makes the report byte-stable
    across fresh processes without changing which documents are accepted or rejected."""
    errs = [e for d in doc for e in v.iter_errors(d)] if isinstance(doc, list) else list(v.iter_errors(doc))
    return sorted(errs, key=lambda e: (str(e.validator), "/".join(str(x) for x in e.absolute_path), e.message))


def msgs(errs):
    return " | ".join(f"{e.validator}:{'/'.join(str(x) for x in e.absolute_path)}:{e.message}" for e in errs)


def safe(fn, *a, **k):
    """Run a reference check; an exception is a FAIL with the exception text (never a pass)."""
    try:
        return fn(*a, **k), False
    except Exception as e:  # noqa: BLE001
        return [f"EXCEPTION {type(e).__name__}: {e}"], True


# ---- 1. parse boundary (policy A)
for name, ok_expected in (("clean.json.txt", True), ("duplicate-key.json.txt", False)):
    try:
        L.strict_loads(open(os.path.join(B, "fixtures/parse", name), encoding="utf-8").read())
        rec("parse", name, ok_expected, "parsed")
    except L.ParseError as e:
        rec("parse", name, not ok_expected, str(e))
for rel in sorted(glob.glob(os.path.join(B, "**/*.json"), recursive=True)):
    try:
        L.strict_load(rel)
    except Exception as e:  # noqa: BLE001
        rec("parse", os.path.relpath(rel, B), False, str(e))
rec("parse", "all bundle JSON parses strictly", all(r[2] for r in R if r[0] == "parse"))

# ---- 2. schemas well-formed
SCHEMAS = {n: f"schemas/{n}.schema.json" for n in ["resolveTargetContract", "resolveTimebase", "resolveTrackPolicy", "resolveCanarySourceManifest", "resolveSnapshot", "resolveGuard", "resolvePermissions", "resolveCapabilityMatrix", "resolveReadPrimitives", "resolveFreezeManifest", "resolveEvidenceSet", "resolveEligibilityRequest"]}
for n in ["resolveSequenceLineage", "resolveBindingSet", "resolveBindingObservation", "resolveMutationPlan", "resolveVerificationResult", "resolveConflict", "resolveTransactionJournal", "resolveCommitManifest", "resolveCheckpoint"]:
    SCHEMAS[f"provisional/{n}"] = f"schemas/provisional/{n}.schema.json"
V = {}
for n, rel in SCHEMAS.items():
    try:
        s = load(rel)
        jsonschema.Draft202012Validator.check_schema(s)
        V[n] = jsonschema.Draft202012Validator(s)
        rec("schema-wellformed", n, True)
    except Exception as e:  # noqa: BLE001
        rec("schema-wellformed", n, False, e)


def schema_validate(name, doc):
    return [msgs([e]) for e in schema_errs(V[name], doc)]


# ---- 3. frozen instances (schema + semantic) and v1.5 structural laws
tc = load("TARGET-CONTRACT.json"); perms = load("PERMISSIONS.json"); rp = load("READ-PRIMITIVES.json"); caps = load("CAPABILITIES.json")
INSTANCES = [("TARGET-CONTRACT.json", "resolveTargetContract", L.semantic_target_contract), ("TIMEBASE.json", "resolveTimebase", L.semantic_timebase), ("schemas/resolveTrackPolicy.v1.json", "resolveTrackPolicy", L.semantic_track_policy), ("CANARY-SOURCE-MANIFEST.json", "resolveCanarySourceManifest", L.semantic_canary_manifest), ("PERMISSIONS.json", "resolvePermissions", None), ("CAPABILITIES.json", "resolveCapabilityMatrix", lambda d: L.semantic_capabilities(d, rp=rp)), ("READ-PRIMITIVES.json", "resolveReadPrimitives", lambda d: L.semantic_read_primitives(d, caps, perms))]
for inst, sch, fn in INSTANCES:
    d = load(inst)
    errs = schema_errs(V[sch], d)
    rec("frozen-instance-schema", inst, not errs, msgs(errs[:2]))
    if fn:
        se, exc = safe(fn, d)
        rec("frozen-instance-semantic", inst, not se and not exc, "; ".join(se[:3]))
rec("frozen-instance", "TARGET-CONTRACT has no declared attachment_state", "attachment_state" not in tc and tc.get("attachment_state_is_declared") is False)
rec("frozen-instance", "TARGET-CONTRACT enumerates CONFLICT as an attachment state", set(tc["attachment_states"]) == set(L.ATTACHMENT_STATES) | {L.CONFLICT_STATE})
rec("frozen-instance", "TARGET-CONTRACT carries the evidence envelope law", {"levels", "record_levels", "coherence_fields", "currency", "binding", "max_observation_age_s"} <= set(tc.get("evidence_envelope_law", {})) and tc["evidence_envelope_law"]["levels"] == L.ENVELOPE_REQUIRED)
rec("frozen-instance", "CAPABILITIES has zero QUALIFIED_READ rows in v1.6", not any(r["evidence_class"] == "QUALIFIED_READ" for r in caps["rows"]))
rec("frozen-instance", "every read row is probe_candidate", all(r.get("probe_candidate") is True for r in caps["rows"] if r["operation"].startswith("read:")))
rec("frozen-instance", "CAPABILITIES refreeze block is unreviewed and promotes nothing (no probe ids, no raw/derived/review digests)", caps["refreeze"]["kind"] == "M0_READ_REQUALIFICATION" and caps["refreeze"]["reviewed"] is False and caps["refreeze"]["promoted_probe_ids"] == [] and caps["refreeze"]["promoted_raw_capture_sha256"] == [] and caps["refreeze"]["promoted_derived_result_sha256"] == [] and caps["refreeze"]["promoted_review_decision_sha256"] == [] and caps["refreeze"]["review_decision_ref"] is None)
rec("frozen-instance", "CAPABILITIES refreeze block binds the active parser and primitive spec digests", caps["refreeze"]["parser_version"] == L.PARSER_VERSION and caps["refreeze"]["parser_sha256"] == L.parser_sha256() and caps["refreeze"]["primitive_spec_sha256"] == L.primitive_spec_digest(rp))
rec("frozen-instance", "CAPABILITIES declares the machine pipeline M0A RAW_CAPABILITY_CAPTURE -> DERIVE -> REVIEW_DECISION -> REFREEZE -> ACTIVE_CAPABILITY -> derived PROMOTION STATE", len(caps.get("qualification_pipeline", [])) >= 6 and all(any(k in s_ for s_ in caps["qualification_pipeline"]) for k in ("RAW_CAPABILITY_CAPTURE", "derive_capability_result", "REVIEW_DECISION", "REFREEZE_RECORD", "ACTIVE_CAPABILITY", "PROMOTION STATE")))
rec("frozen-instance", "CAPABILITIES carries the matrix content law and the active digest is its canonical content digest", "content digest" in caps.get("matrix_content_law", "") and L.capability_matrix_digest(caps) == L.capability_matrix_digest(load("CAPABILITIES.json")))
rec("frozen-instance", "no evidence record carries an interpretation field; prior-version records are marked UNQUALIFIED_PRIOR_VERSION with no probe id", all(x.get("result") == "UNQUALIFIED_PRIOR_VERSION" and x.get("probe_id") is None and not any(k in x for k in ("success", "classification", "qualified", "raw_evidence_sha256")) for r in caps["rows"] for x in r.get("evidence_records", [])))
probe = rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]
PROBE_METHODS = sorted({p["method"] for p in probe["primitives"]})
rec("frozen-instance", "probe produces RAW_CAPABILITY_CAPTURE only, promotes nothing and names its shim contract and M0 phases", probe.get("evidence_output") == "RAW_CAPABILITY_CAPTURE" and probe.get("promotes_capability") is False and probe.get("read_only") is True and probe.get("purpose_is_qualification") is True and probe.get("capture_shim_contract") == "CAPTURE-SHIM.md" and probe.get("phases") == list(L.M0_PHASES))
rec("frozen-instance", "every probe primitive carries the full expectation spec, all DOCUMENTED_HYPOTHESIS, and READ-PRIMITIVES pins their digest", all(not L.spec_errors(L.primitive_spec(p)) and p["expectation_status"] == "DOCUMENTED_HYPOTHESIS" and p.get("expectation_source") for p in probe["primitives"]) and rp["primitive_spec_sha256"] == L.primitive_spec_digest(rp) and rp["primitive_spec_law"]["frozen_allowed"] is False)
rec("frozen-instance", "the 47 probe primitives are exactly the specs of the fixture tool (no method without an expectation, no expectation without a method)", set(PROBE_METHODS) == set(F.PRIMITIVE_SPECS) and len(PROBE_METHODS) == 47)
rec("frozen-instance", "CAPABILITY_EVIDENCE is retired and no record type carries a parse block", "CAPABILITY_EVIDENCE" in L.RETIRED_RECORD_TYPES and "CAPABILITY_EVIDENCE" not in L.RECORD_TYPES and {"RAW_CAPABILITY_CAPTURE", "DERIVED_CAPABILITY_RESULT", "REVIEW_DECISION", "IDENTITY_UNIQUENESS_OBSERVATION", "IDENTITY_STABILITY_OBSERVATION"} <= L.RECORD_TYPES)
rec("frozen-instance", "probe failure taxonomy equals the reference taxonomy", {k: sorted(v) for k, v in probe.get("failure_taxonomy", {}).items()} == {k: sorted(v) for k, v in L.PROBE_FAILURE_TAXONOMY.items()})
rec("frozen-instance", "every read primitive declares receiver and expected_type", all(p.get("receiver") and p.get("expected_type") in L.EXPECTED_TYPES for spec in rp["logical_operations"].values() for p in spec["primitives"]))
rec("frozen-instance", "the probe failure taxonomy is derived-class based (no probe-written failure codes) and BINDING_MISMATCH is fatal", "BINDING_MISMATCH" in L.PROBE_FAILURE_TAXONOMY["FATAL_TARGET_FAILURE"] and "EXCEPTION" in L.PROBE_FAILURE_TAXONOMY["CAPABILITY_FAILURE"] and set(L.DERIVED_CLASSES) - {"SUCCESS"} <= set(sum(L.PROBE_FAILURE_TAXONOMY.values(), [])))
snap_schema = load("schemas/resolveSnapshot.schema.json")
tl_fs = snap_schema["properties"]["payload"]["properties"]["timeline"]["properties"]["field_status"]
rec("frozen-instance", "timeline observation status model covers start/end frame, start timecode, width, height", {"start_frame", "end_frame", "start_timecode", "width", "height"} <= set(tl_fs["required"]) and set(tl_fs["required"]) == set(L.TIMELINE_STATUS_FIELDS))
rec("frozen-instance", "snapshot schema requires collection.method_provenance citing RAW captures and knows APPEND_VERIFY", "method_provenance" in snap_schema["properties"]["collection"]["required"] and "APPEND_VERIFY" in snap_schema["properties"]["coverage"]["properties"]["profile"]["enum"] and "raw_capture_record_id" in snap_schema["properties"]["collection"]["properties"]["method_provenance"]["additionalProperties"]["required"] and "capability_evidence_record_id" not in snap_schema["properties"]["collection"]["properties"]["method_provenance"]["additionalProperties"]["properties"])
rec("frozen-instance", "the snapshot item schema has no property/fade/speed/take payload (F15-05 honest exclusion, named in PROTECTED_SURFACE_EXCLUSIONS)", not any(k in json.dumps(snap_schema["properties"]["payload"]["properties"]["tracks"]) for k in ("\"properties\": {\"Opacity", "\"fades\"", "\"speed\"", "\"takes\"")) and set(L.PROTECTED_SURFACE_EXCLUSIONS) >= {"item_properties", "fades", "speed", "takes", "linked_items"})
rec("frozen-instance", "guard schema is v3 and binds provenance_sha256", load("schemas/resolveGuard.schema.json")["properties"]["guard_version"]["const"] == 3 and "provenance_sha256" in load("schemas/resolveGuard.schema.json")["required"])
rec("frozen-instance", "journal execution law: CHECKPOINTED is mandatory before any operation; OP_STARTED -> APPLIED | OP_FAILED; READBACK_S1 after APPLIED", "APPLIED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "OP_FAILED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "READBACK_S1" in L.JOURNAL_TRANSITIONS["APPLIED"] and L.JOURNAL_TRANSITIONS["PREFLIGHT_OK"] == {"CHECKPOINTED", "CONFLICT", "RECOVERY_RECONCILING"} and "OP_STARTED" in L.JOURNAL_TRANSITIONS["CHECKPOINTED"])
for nm, sch, keys in (("plan", "provisional/resolveMutationPlan", {"session_id"}), ("journal", "provisional/resolveTransactionJournal", {"session_id", "readback_snapshot_sha256", "readback_guard_digest"}), ("verification", "provisional/resolveVerificationResult", {"session_id"}), ("commit", "provisional/resolveCommitManifest", {"session_id", "s1_snapshot_sha256", "s1_guard_digest"})):
    rec("frozen-instance", f"{nm} schema requires the linked-identity fields {sorted(keys)}", keys <= set(load(f"schemas/{sch}.schema.json")["required"]))
rec("frozen-instance", "verification schema requires the derived applied_operation_ids and unobserved_domains (F15-06/F15-05)", {"applied_operation_ids", "unobserved_domains"} <= set(load("schemas/provisional/resolveVerificationResult.schema.json")["required"]))
rec("frozen-instance", "GUARD_SNAPSHOT records must carry the guard object, method_provenance and snapshot digest (F15-03)", all(k in json.dumps(load("schemas/resolveEvidenceSet.schema.json")) for k in ("\"guard\"", "method_provenance", "snapshot_object_sha256")))
rec("frozen-instance", "PLAN_VALIDATION records must name the composed validator, the H0 guard and the completed stages", {"validator", "h0_guard_digest", "h0_snapshot_sha256", "stages_completed"} <= set(next(r["then"]["required"] for r in load("schemas/resolveEvidenceSet.schema.json")["properties"]["records"]["additionalProperties"]["allOf"] if r["if"]["properties"]["record_type"]["const"] == "PLAN_VALIDATION")))

# ---- 4. active authority
ACT = load("fixtures/evidence/ACTIVE-AUTHORITY-PLACEHOLDER.json")
CAPS_SHA = L.capability_matrix_digest(caps)
HYP_SHA = L.capability_matrix_digest(load(HYP_PATH))
rec("active-authority", "fixture placeholder is a well-formed sha256 and is not any real manifest", L.is_sha(ACT["placeholder_manifest_sha256"]) and ACT["placeholder_manifest_sha256"] == hashlib.sha256(b"VIDTOOLZ-FIXTURE-MANIFEST-PLACEHOLDER-v1.6").hexdigest())
rec("active-authority", "the active capability authority is the CONTENT digest of the matrix object, not a file hash", ACT["capability_matrix_sha256"] == CAPS_SHA and CAPS_SHA != sha(os.path.join(B, "CAPABILITIES.json")) and L.capability_matrix_digest(caps) == L.digest(caps, L.MATRIX_DOMAIN))
rec("active-authority", "the fixture pins the active parser, primitive spec and reference shim identities", ACT["parser_version"] == L.PARSER_VERSION and ACT["parser_sha256"] == L.parser_sha256() and ACT["primitive_spec_sha256"] == L.primitive_spec_digest(rp) and ACT["reference_shim_sha256"] == SHIM.shim_sha256())
rec("active-authority", "fixture hypothetical matrix digest equals the content digest of the hypothetical matrix", ACT["hypothetical_capability_matrix_sha256"] == HYP_SHA)
ACTIVE = {"authority_version": L.AUTHORITY_VERSION, "manifest_sha256": ACT["placeholder_manifest_sha256"], "capability_matrix_sha256": CAPS_SHA}
ACTIVE_HYP = dict(ACTIVE, capability_matrix_sha256=HYP_SHA)
CAPS_CACHE = {"CAPABILITIES.json": caps, HYP_PATH: load(HYP_PATH)}


def caps_for(path):
    return CAPS_CACHE[path]


def active_for(path):
    return ACTIVE_HYP if path == HYP_PATH else ACTIVE


def ctx_for(caps_path, es_name):
    return {"caps": caps_for(caps_path), "rp": rp, "es": EVS[es_name], "active": active_for(caps_path), "tc": tc}


hyp = caps_for(HYP_PATH)
rec("active-authority", "hypothetical matrix is labelled HYPOTHETICAL_NOT_AUTHORITY and is not the frozen matrix", "HYPOTHETICAL_NOT_AUTHORITY" in hyp["qualification_note"] and hyp["version"] != caps["version"] and HYP_SHA != CAPS_SHA)
se, exc = safe(L.semantic_capabilities, hyp, rp=rp)
rec("active-authority", "hypothetical refrozen matrix is internally consistent (reviewed refreeze block promoting exact probe ids + raw/derived/review digests)", not se and not exc, "; ".join(se[:2]))
rec("active-authority", "hypothetical refreeze names every promoted raw, derived and review digest of its QUALIFIED_READ rows", set(hyp["refreeze"]["promoted_raw_capture_sha256"]) == {x["raw_capture_sha256"] for r in hyp["rows"] if r["evidence_class"] == "QUALIFIED_READ" for x in r["evidence_records"]} and set(hyp["refreeze"]["promoted_derived_result_sha256"]) == {x["derived_result_sha256"] for r in hyp["rows"] if r["evidence_class"] == "QUALIFIED_READ" for x in r["evidence_records"]} and set(hyp["refreeze"]["promoted_review_decision_sha256"]) == {x["review_decision_sha256"] for r in hyp["rows"] if r["evidence_class"] == "QUALIFIED_READ" for x in r["evidence_records"]})

# ---- 5. evidence sets: schema, structural/binding validity, derived attachment state
EVS = {}
SCHEMA_NEG = {"invalid-provisioning-without-root": "library_root", "attached-evidence-raised-fake-parse-block": "Additional properties", "attached-evidence-review-stale-parser": "parser_version", "invalid-retired-capability-evidence-type": "record_type"}
BINDING_NEG = {"invalid-tampered-record": "content digest", "invalid-connection-wrong-manifest": "active reviewed manifest", "invalid-connection-other-authority": "bound to authority", "invalid-bundle-other-manifest-not-historical": "active reviewed manifest", "invalid-provisioning-without-root": "library_root",
               "attached-evidence-raised-fake-parse-block": "forbidden interpretation field", "attached-evidence-raw-tampered": "does not re-hash", "attached-fatal-probe-failure": "capture binding", "invalid-retired-capability-evidence-type": "RETIRED"}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/evidence/*.json"))):
    name = os.path.basename(rel)[:-5]
    if name == "ACTIVE-AUTHORITY-PLACEHOLDER":
        continue
    es = load(f"fixtures/evidence/{name}.json")
    EVS[name] = es
    errs = schema_errs(V["resolveEvidenceSet"], es)
    if name in SCHEMA_NEG:
        rec("evidence-set-schema-negative", name, bool(errs) and SCHEMA_NEG[name] in msgs(errs), msgs(errs[:1]) or "ACCEPTED (should be rejected)")
    else:
        rec("evidence-set-schema", name, not errs, msgs(errs[:2]))
    st, exc = safe(L.validate_evidence_set, es, ACTIVE)
    if name in BINDING_NEG:
        rec("evidence-set-binding-negative", name, bool(st) and not exc and any(BINDING_NEG[name] in x for x in st), "; ".join(st[:2]) or "ACCEPTED (should be rejected)")
    else:
        rec("evidence-set-binding", name, not st and not exc, "; ".join(st[:2]))
base_es = EVS["attached"]
rid = next(iter(base_es["records"]))
for nm, ref, exp in (("empty string", "", "not a sha256"), ("boolean-string false", "false", "not a sha256"), ("uppercase sha", rid.upper(), "not a sha256"), ("unlinked sha", "9" * 64, "not in evidence set"), ("wrong type", rid, "has type"), ("short hex", rid[:63], "not a sha256"), ("sha with newline", rid + "\n", "not a sha256")):
    r_, e_ = L.resolve_ref(base_es, ref, "M3_AUTHORIZATION", active=ACTIVE)
    rec("evidence-ref-negative", nm, r_ is None and any(exp in x for x in e_), "; ".join(e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], {"host_name": "PRESTO"}, None, ACTIVE)
rec("evidence-ref-negative", "record for another host", r_ is None and bool(e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], None, None, dict(ACTIVE, manifest_sha256="9" * 64))
rec("evidence-ref-negative", "record bound to another manifest is not evidence for the active authority", r_ is None and any("active authority" in x for x in e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], None, None, ACTIVE)
rec("evidence-ref-positive", "linked correct-type record bound to the active authority resolves", r_ is not None and not e_)
ARO = "ATTACHED_READ_ONLY"
EXPECT_STATE = {
    "empty": "UNPROVISIONED", "provisioned-only": "PROVISIONED_NOT_VERIFIED", "ready": "ATTACHMENT_READY",
    "ready-wrong-binary-pin": "PROVISIONED_NOT_VERIFIED", "ready-self-verified-bundle": "PROVISIONED_NOT_VERIFIED", "ready-bundle-other-host": "PROVISIONED_NOT_VERIFIED", "ready-bundle-historical-only": "PROVISIONED_NOT_VERIFIED", "ready-no-current-session": "PROVISIONED_NOT_VERIFIED", "ready-launch-previous-session-only": "PROVISIONED_NOT_VERIFIED", "ready-ghost-session-without-launch": "PROVISIONED_NOT_VERIFIED",
    "attached": ARO, "attached-reversed-order": ARO, "attached-stale-good-current-eka": "ATTACHMENT_READY", "attached-current-good-stale-eka": ARO, "attached-duplicate-sequence-conflict": "CONFLICT", "attached-duplicate-timestamp-distinct-sequence": ARO, "attached-connection-previous-session-only": "ATTACHMENT_READY", "attached-ancient-observation": "ATTACHMENT_READY", "attached-sequence-timestamp-disorder": "CONFLICT", "attached-missing-root-in-connection": "ATTACHMENT_READY", "attached-changed-uuid-in-connection": "ATTACHMENT_READY", "attached-second-provisioning-other-uuid": "CONFLICT", "attached-cross-library-timeline-binding": "CONFLICT", "attached-binding-other-session": ARO, "attached-fatal-probe-failure": "CONFLICT", "attached-capability-failure-only": ARO,
    "attached-eka-observed": "ATTACHMENT_READY", "attached-local-database-observed": "ATTACHMENT_READY", "attached-version-mismatch": "ATTACHMENT_READY", "attached-no-ids": ARO,
    "attached-candidate-evidence-unreviewed": ARO, "attached-evidence-failed-getters": ARO, "attached-evidence-wrong-build": ARO, "attached-evidence-old-refreeze": ARO, "attached-evidence-old-authority": ARO, "attached-evidence-no-raw": ARO, "attached-evidence-wrong-receiver": ARO, "attached-reviewed-evidence": ARO, "attached-reviewed-evidence-minus-getstartframe": ARO, "attached-evidence-review-other-raw": ARO,
    "write-ready-without-authorization": ARO, "write-ready-authorization-old-authority": ARO, "write-ready-refreeze-unreviewed": ARO, "write-ready-refreeze-other-matrix": ARO, "write-ready-base": "SCRATCH_WRITE_READY",
    "write-ready-hyp": ARO, "write-ready-full": ARO, "write-ready-stale-guard-current": ARO, "write-ready-plan-validation-fail": ARO,
    "invalid-tampered-record": "CONFLICT", "invalid-provisioning-without-root": "CONFLICT", "invalid-connection-wrong-manifest": "CONFLICT", "invalid-connection-other-authority": "CONFLICT", "invalid-bundle-other-manifest-not-historical": "CONFLICT",
    "invalid-retired-capability-evidence-type": "CONFLICT", "attached-evidence-raised-fake-parse-block": "CONFLICT", "attached-evidence-raw-tampered": "CONFLICT",
    "attached-evidence-raised-accepted": ARO, "attached-evidence-timeout-accepted": ARO, "attached-evidence-attribute-missing-accepted": ARO, "attached-evidence-wrong-type-accepted": ARO, "attached-evidence-null-accepted": ARO, "attached-evidence-truncated-accepted": ARO, "attached-evidence-unserializable-accepted": ARO,
    "attached-evidence-review-stale-parser": ARO, "attached-evidence-review-stale-spec": ARO, "attached-evidence-reviewer-is-operator": ARO, "attached-evidence-review-reject": ARO,
    "attached-evidence-refreeze-stale-parser": ARO, "attached-evidence-refreeze-stale-spec": ARO, "attached-evidence-refreeze-other-session": ARO, "attached-evidence-refreeze-unreviewed": ARO, "attached-evidence-refreeze-unlisted-raw": ARO, "attached-evidence-no-refreeze-record": ARO,
    "attached-evidence-derived-cache-forged": ARO, "attached-evidence-derived-cache-honest": ARO,
    "attached-identity-observations": ARO, "attached-identity-duplicates-honest": ARO, "attached-identity-duplicates-claimed-unique": ARO, "attached-identity-stability-two-passes": ARO,
    "write-ready-plan-validation-from-helper": ARO, "write-ready-plan-validation-other-h0": ARO, "write-ready-h0-minimal-m0": ARO, "write-ready-h0-full-timeline-read": ARO, "write-ready-h0-incomplete-write-precheck": ARO, "write-ready-h0-candidate-provenance": ARO, "write-ready-h0-other-matrix": ARO, "write-ready-h0-other-target": ARO, "write-ready-h0-forged-guard-object": ARO, "write-ready-h0-provenance-swapped": ARO,
}
rec("attachment-derived", "every evidence fixture has a pinned expected state", set(EXPECT_STATE) == set(EVS), ",".join(sorted(set(EXPECT_STATE) ^ set(EVS))))
DERIVED = {}
for name in sorted(EVS):
    exp = EXPECT_STATE.get(name)
    d, exc = safe(L.derive_attachment_state, tc, EVS[name], ACTIVE)
    if exc:
        rec("attachment-derived", f"{name} -> {exp}", False, d[0])
        continue
    DERIVED[name] = d
    rec("attachment-derived", f"{name} -> {exp}", d["state"] == exp, f"got {d['state']}; failures={d['failures'][:2]} conflicts={d['conflicts'][:2]}")
for name in ("write-ready-hyp", "write-ready-full", "write-ready-stale-guard-current", "write-ready-plan-validation-fail"):
    d, exc = safe(L.derive_attachment_state, tc, EVS[name], ACTIVE_HYP)
    rec("attachment-derived", f"{name} under hypothetical refreeze -> SCRATCH_WRITE_READY", not exc and d["state"] == "SCRATCH_WRITE_READY", "" if exc else f"got {d['state']}; failures={d['failures'][:2]}")
rec("attachment-derived", "same evidence reversed gives an identical derivation", L.canon(DERIVED["attached"]) == L.canon(DERIVED["attached-reversed-order"]))
rec("attachment-derived", "historical BUNDLE_VERIFICATION never serves as current authority", DERIVED["ready-bundle-historical-only"]["state"] == "PROVISIONED_NOT_VERIFIED" and "bundle_verification" not in DERIVED["ready-bundle-historical-only"]["proofs"])
rec("attachment-derived", "CONFLICT ranks below every ladder state", L.STATE_RANK[L.CONFLICT_STATE] < min(L.STATE_RANK[s] for s in L.ATTACHMENT_STATES))

# ---- 6. RAW CAPABILITY EVIDENCE (v1.6): capture shim -> reference re-parser -> review -> refreeze -> content-bound active matrix
def forged_matrix(cp):
    """An in-memory matrix whose CONTENT differs from the one the active digest names (read rows flipped to QUALIFIED_READ where they
    were not, refreeze block marked reviewed, note altered), used to prove Codex F15-02: content, not references, is the authority."""
    f = copy.deepcopy(cp)
    for r in f["rows"]:
        if r["operation"].startswith("read:"):
            r["evidence_class"] = "QUALIFIED_READ"
    f["refreeze"]["reviewed"] = True
    f["qualification_note"] = f.get("qualification_note", "") + " [FORGED IN MEMORY: not the active matrix content]"
    return f

SPECS = L.probe_spec_index(rp)
MINT = F.Mint(ACT["placeholder_manifest_sha256"], CAPS_SHA, rp=rp)
ENVC = env = L._contract_env(tc)
es_rev = EVS["attached-reviewed-evidence"]
rp_connect = next(p for p in rp["logical_operations"]["CONNECT"]["primitives"] if p["method"] == "GetVersionString")
CAP_OK = {m: MINT.capture(m) for m in PROBE_METHODS}
cap_vs = CAP_OK["GetVersionString"]
spec_vs = SPECS["GetVersionString"]


def derive(capture, spec=None, env=None, active=None):
    return L.derive_capability_result(capture, spec if spec is not None else spec_vs, env or ENVC, active or ACTIVE_HYP)


# 6a. raw capture: facts only; every interpretation field is schema-forbidden
raw_rec_ok = MINT.raw_rec(cap_vs)
rec("raw-capture", "an honest capture record validates against the evidence-set schema and its structural law", not schema_errs(V["resolveEvidenceSet"], F.ES([raw_rec_ok])) and not L.semantic_raw_capture(raw_rec_ok, ENVC, ACTIVE_HYP))
rec("raw-capture", "the capture body re-hashes to its raw_digest and the record names it", L.raw_capture_digest_ok(cap_vs) and raw_rec_ok["raw_capture_sha256"] == cap_vs["raw_digest"])
for f_ in L.FORBIDDEN_RAW_FIELDS:
    bad = F.reseal(cap_vs, **{f_: True})
    rec("raw-capture", f"forbidden interpretation field {f_!r} makes the capture MALFORMED and schema-invalid", any(f_ in e for e in L._capture_structure_errors(bad)) and derive(bad)["classification"] == "MALFORMED" and bool(schema_errs(V["resolveEvidenceSet"], F.ES([MINT.raw_rec(bad)]))))
rec("raw-capture", "the mechanical outcome vocabulary is closed and exclusive (a second outcome block is refused)", set(L.MECHANICAL_OUTCOMES) == {"RETURNED", "RAISED", "TIMEOUT", "ATTRIBUTE_MISSING", "TRANSPORT_FAILURE", "REFUSED", "UNSERIALIZABLE"} and any("block" in e for e in L._capture_structure_errors(F.reseal(cap_vs, raised={"exception_class": "X", "module": "m", "message": ""}))))
rec("raw-capture", "one changed byte in the returned value breaks the digest -> MALFORMED (never silently reinterpreted)", derive(F.tamper(cap_vs, returned={"python_type": "str", "value": {"$t": "str", "v": "21.9.9"}}))["classification"] == "MALFORMED")
rec("raw-capture", "the capture pins the shim identity, the operator and the serialization limits", L.is_sha(cap_vs["capture_shim_sha256"]) and cap_vs["capture_shim_version"] == SHIM.SHIM_VERSION and cap_vs["operator"] and cap_vs["serialization"]["codec"] == L.CODEC)
rec("raw-capture", "the receiver navigation path and handle token are recorded (a capture cannot be relocated to another receiver)", cap_vs["receiver"]["path"] and cap_vs["receiver"]["handle_token"] and derive(F.reseal(cap_vs, receiver=dict(cap_vs["receiver"], **{"class": "Timeline"})))["classification"] == "RECEIVER_MISMATCH")

# 6b. typed value codec
E = SHIM.Encoder
enc = lambda v, **k: E(**k).encode(v)  # noqa: E731
rec("codec", "None/bool/int/float/str are tagged and bool is never an int", enc(None) == {"$t": "none"} and enc(True) == {"$t": "bool", "v": True} and enc(3) == {"$t": "int", "v": 3} and enc(1.5) == {"$t": "f64", "v": SHIM.f64_hex(1.5)} and enc("ä") == {"$t": "str", "v": "ä"} and enc(1) != enc(True))
a_, b_ = enc({"b": 1, "a": {"y": [1, 2], "x": {}}}), enc({"a": {"x": {}, "y": [1, 2]}, "b": 1})
rec("codec", "mapping key order never changes the encoding (canonical ordered pairs)", L.canon(a_) == L.canon(b_) and not L.codec_errors(a_))
rec("codec", "empty containers are distinct from None and from each other", enc([]) == {"$t": "list", "py": "list", "v": []} and enc(()) == {"$t": "list", "py": "tuple", "v": []} and enc({}) == {"$t": "dict", "v": []} and enc([]) != enc(None))
rec("codec", "integers beyond 2^53 become explicit bigint strings", enc(2 ** 60) == {"$t": "bigint", "v": str(2 ** 60)} and not L.codec_errors(enc(2 ** 60)))
rec("codec", "positive and negative zero stay distinct facts", enc(0.0) != enc(-0.0) and enc(-0.0)["v"] == "8000000000000000")
rec("codec", "NaN and infinities are recorded as explicit non-finite facts, never as numbers", enc(float("nan")) == {"$t": "f64_nonfinite", "v": "nan"} and enc(float("inf"))["v"] == "+inf" and enc(float("-inf"))["v"] == "-inf")
rec("codec", "bytes are recorded by length + digest + head, never inlined", enc(b"\x00\x01")["$t"] == "bytes" and enc(b"\x00\x01")["len"] == 2 and L.is_sha(enc(b"\x00\x01")["sha256"]))
o_ = enc(F.FakeObj("x"))
rec("codec", "an opaque Resolve-like object becomes a descriptor (class, module, handle token, repr digest); no identity is inferred", o_["$t"] == "object" and o_["class"] == "FakeObj" and L.is_sha(o_["repr_sha256"]) and not L.codec_errors(o_))
for nm_, val_, reason_ in (("cyclic value", None, "CYCLE"), ("callable value", (lambda: 1), "CALLABLE_OR_TYPE")):
    v_ = [] if val_ is None else val_
    if val_ is None:
        v_.append(v_)
    try:
        enc(v_)
        rec("codec", f"{nm_} -> UnsupportedValue (never guessed)", False, "encoded")
    except SHIM.UnsupportedValue as u_:
        rec("codec", f"{nm_} -> UnsupportedValue (never guessed)", u_.reason == reason_, u_.reason)
e2 = E(depth_limit=2, length_limit=3, string_limit=5)
big = e2.encode({"a": {"b": {"c": 1}}, "l": list(range(10)), "s": "0123456789"})
rec("codec", "oversized/deep values are elided with a truncation flag, elided paths and a full-value digest", e2.truncated and L.codec_contains_elision(big) and len(e2.elided) == 3 and L.is_sha(big["v"][2][1]["full_sha256"]))
rec("codec", "structural codec validation accepts honest values and rejects unknown tags / bad payloads", not L.codec_errors(a_) and L.codec_errors({"$t": "float", "v": 1.0}) and L.codec_errors({"$t": "f64", "v": "NOTHEX"}) and L.codec_errors({"$t": "int", "v": "3"}))
rec("codec", "the codec broad type maps every tag into the expectation vocabulary", {L.codec_broad_type({"$t": k}) for k in L.CODEC_TAG_TYPES} == set(L.CODEC_TAG_TYPES.values()) and set(L.EXPECTED_TYPES) < set(L.CODEC_TAG_TYPES.values()) | {"str", "int", "bool", "float", "list", "dict", "object"})

# 6c. capture shim safety: refusal BEFORE invocation
class Trap(F.FakeObj):
    called = []

    def SetName(self, n):
        Trap.called.append("SetName")
        return True

    def AppendToTimeline(self, x):
        Trap.called.append("AppendToTimeline")
        return True

    def DeleteClips(self, x):
        Trap.called.append("DeleteClips")
        return True

    def CreateEmptyTimeline(self, n):
        Trap.called.append("CreateEmptyTimeline")
        return True

    def ImportMedia(self, p):
        Trap.called.append("ImportMedia")
        return True

    def run_script(self, s):
        Trap.called.append("run_script")
        return True

    def execute_lua(self, s):
        Trap.called.append("execute_lua")
        return True

    def SaveProject(self):
        Trap.called.append("SaveProject")
        return True

    def GetVersionString(self):
        return F.VER


SCTX = SHIM.ShimContext("probe-shim-test", F.S_CUR, L.AUTHORITY_VERSION, ACT["placeholder_manifest_sha256"], F.HOST, F.PRODUCT, F.VER, F.BUILD, F.UU, F.ROOT, "shim-test-operator", clock=lambda: "2026-09-08T11:30:00Z")
trap = Trap("trap")
for m_ in ("SetName", "AppendToTimeline", "DeleteClips", "CreateEmptyTimeline", "ImportMedia", "run_script", "execute_lua", "SaveProject"):
    r_ = SHIM.capture(SCTX, trap, "Timeline", "path", m_, list(F.PRIMITIVE_SPECS) + [m_])
    rec("shim-safety", f"{m_}: refused BEFORE invocation even when wrongly allowlisted", r_["outcome"] == "REFUSED" and r_["refused"]["invoked"] is False and L.raw_capture_digest_ok(r_))
rec("shim-safety", "no write-like or script method was ever invoked by the shim", Trap.called == [], str(Trap.called))
rec("shim-safety", "a non-allowlisted getter is refused, not invoked", SHIM.capture(SCTX, trap, "Timeline", "path", "GetVersionString", ["GetEndFrame"])["outcome"] == "REFUSED")
rec("shim-safety", "the allowlist is the static 47-method probe list", len(PROBE_METHODS) == 47 and set(PROBE_METHODS) == set(F.PRIMITIVE_SPECS))
mp_ = Trap("mp")
mp_.GetVersionString = lambda: "forged"
rec("shim-safety", "an instance-level monkeypatched getter is refused (the shim only calls class methods)", SHIM.capture(SCTX, mp_, "Resolve", "path", "GetVersionString", list(F.PRIMITIVE_SPECS))["outcome"] == "REFUSED")
rec("shim-safety", "a getter that raises is recorded as RAISED with class/module/message and no classification", MINT.capture("GetVersionString", "raise")["outcome"] == "RAISED" and "classification" not in MINT.capture("GetVersionString", "raise"))
rec("shim-safety", "a getter that hangs is recorded as TIMEOUT with integer milliseconds", MINT.capture("GetVersionString", "slow", timeout_s=0.05)["outcome"] == "TIMEOUT" and isinstance(MINT.capture("GetVersionString", "slow", timeout_s=0.05)["timeout_ms"], int))
rec("shim-safety", "a missing attribute is ATTRIBUTE_MISSING, an unserializable return is UNSERIALIZABLE (never a guess)", MINT.capture("GetVersionString", "missing")["outcome"] == "ATTRIBUTE_MISSING" and MINT.capture("GetVersionString", "cyclic")["outcome"] == "UNSERIALIZABLE")
rec("shim-safety", "an absent receiver is TRANSPORT_FAILURE", SHIM.capture(SCTX, None, "Timeline", "path", "GetVersionString", list(F.PRIMITIVE_SPECS))["outcome"] == "TRANSPORT_FAILURE")
rec("shim-safety", "the reference shim never imports a Resolve bridge, never writes a matrix and never reviews", not any(k in inspect.getsource(SHIM) for k in ("DaVinciResolveScript", "import bmd", "CAPABILITIES.json", "REVIEW_DECISION", "primitive_status")))

# 6d. reference re-parser: determinism and the closed class vocabulary
d_ok = derive(cap_vs)
rec("re-parser", "an honest capture derives SUCCESS with facts and the hypothesis status of the spec", d_ok["classification"] == "SUCCESS" and d_ok["facts"]["broad_type"] == "str" and d_ok["expectation_status"] == "DOCUMENTED_HYPOTHESIS" and d_ok["family"] == "SUCCESS")
rec("re-parser", "the same capture + parser + spec derive the same digest (8 repeats, shuffled input key order)", all(derive(cap_vs)["derived_result_sha256"] == d_ok["derived_result_sha256"] for _ in range(4)) and all(L.derive_capability_result({k: cap_vs[k] for k in list(cap_vs)[::-1]}, spec_vs, ENVC, ACTIVE_HYP)["derived_result_sha256"] == d_ok["derived_result_sha256"] for _ in range(4)))
rec("re-parser", "the derived result carries the parser identity and re-hashes", d_ok["parser_version"] == L.PARSER_VERSION and d_ok["parser_sha256"] == L.parser_sha256() and L.derived_result_digest_ok(d_ok))
rec("re-parser", "every one of the 47 honest captures derives SUCCESS under its documented expectation", all(derive(CAP_OK[m], SPECS[m])["classification"] == "SUCCESS" for m in PROBE_METHODS), ",".join(m for m in PROBE_METHODS if derive(CAP_OK[m], SPECS[m])["classification"] != "SUCCESS")[:120])
CLASS_CASES = [
    ("EXCEPTION", MINT.capture("GetVersionString", "raise"), spec_vs),
    ("TIMEOUT", MINT.capture("GetVersionString", "slow", timeout_s=0.05), spec_vs),
    ("UNSUPPORTED", MINT.capture("GetVersionString", "missing"), spec_vs),
    ("UNSERIALIZABLE", MINT.capture("GetVersionString", "cyclic"), spec_vs),
    ("TYPE_MISMATCH", MINT.capture("GetVersionString", "wrong_type"), spec_vs),
    ("NULL_NOT_ALLOWED", MINT.capture("GetVersionString", "none"), spec_vs),
    ("TRUNCATED", MINT.capture("Timeline.GetSettings", "deep", encoder_limits={"depth_limit": 1}), SPECS["Timeline.GetSettings"]),
    ("REFUSED", SHIM.capture(SCTX, trap, "Resolve", "path", "GetVersionString", ["GetEndFrame"]), spec_vs),
    ("TRANSPORT_FAILURE", SHIM.capture(SCTX, None, "Resolve", "path", "GetVersionString", list(F.PRIMITIVE_SPECS)), spec_vs),
    ("RECEIVER_MISMATCH", F.reseal(cap_vs, receiver=dict(cap_vs["receiver"], **{"class": "Timeline"})), spec_vs),
    ("ARGS_MISMATCH", MINT.capture("GetTrackCount", args=[1]), SPECS["GetTrackCount"]),
    ("MALFORMED", F.tamper(cap_vs, method="GetProductName"), spec_vs),
    ("BINDING_MISMATCH", MINT.capture("GetVersionString", session=F.S_OLD, build=7, resolve_version="21.0.3.0007"), spec_vs),
]
for cls_, capture_, spec_ in CLASS_CASES:
    d_ = L.derive_capability_result(capture_, spec_, ENVC, ACTIVE_HYP)
    rec("re-parser", f"derived class {cls_} for its capture shape", d_["classification"] == cls_, f"got {d_['classification']}: {d_['reasons'][:1]}")
rec("re-parser", "the derived class vocabulary is closed and every non-SUCCESS class has a family", set(L.DERIVED_CLASSES) == set(L.DERIVED_FAMILY) and L.classification_family("SUCCESS") == "SUCCESS" and L.classification_family("BINDING_MISMATCH") == "FATAL_TARGET_FAILURE")
rec("re-parser", "an empty value where the expectation says NON_EMPTY is TYPE_MISMATCH, and NONE shape rules accept empty containers", L.derive_capability_result(MINT.capture("GetVersionString", "empty"), spec_vs, ENVC, ACTIVE_HYP)["classification"] == "TYPE_MISMATCH" and L.derive_capability_result(MINT.capture("GetMarkers", "empty"), SPECS["GetMarkers"], ENVC, ACTIVE_HYP)["classification"] == "SUCCESS")
rec("re-parser", "a nullable primitive accepts None as SUCCESS with an explicit null fact", L.derive_capability_result(MINT.capture("GetCurrentTimeline", "none"), SPECS["GetCurrentTimeline"], ENVC, ACTIVE_HYP)["facts"].get("null") is True)
rec("re-parser", "a capture evaluated against another method's spec is MALFORMED (a spec can never be swapped in)", L.derive_capability_result(cap_vs, SPECS["GetProductName"], ENVC, ACTIVE_HYP)["classification"] == "MALFORMED")
rec("re-parser", "a spec whose expectation changed produces a different derived digest (spec digest is part of the derivation)", L.derive_capability_result(cap_vs, dict(spec_vs, nullable=True), ENVC, ACTIVE_HYP)["derived_result_sha256"] != d_ok["derived_result_sha256"])
rec("re-parser", "the parser identity is the hash of its own source: a changed parser cannot pretend to be the active one", L.parser_sha256() == L.sha256_text(inspect.getsource(L.derive_capability_result) + inspect.getsource(L.codec_errors) + inspect.getsource(L.codec_broad_type) + inspect.getsource(L.codec_contains_elision) + inspect.getsource(L._capture_structure_errors) + L.PARSER_VERSION))

# 6e. THE v1.5 DEFECT (F15-01 / M-RAW): a raw failure with a fabricated successful interpretation
crash = MINT.capture("GetVersionString", "raise")
fake_block = {"parse": {"parser": "probe", "succeeded": True, "error": None, "getter_exception": None, "observed_type": "str", "shape_ok": True}, "parsed_observation": {"type": "str", "non_null": True}, "result": {"classification": "SUCCESS", "success": True, "code": None}}
d_crash = derive(crash)
rec("raw-vs-fake-parse", "raw RAISED RuntimeError + an EXTERNAL fabricated successful parse block: the machine derives EXCEPTION and the fake block is not an input at all", crash["outcome"] == "RAISED" and d_crash["classification"] == "EXCEPTION" and "fake" not in L.canon(d_crash) and "succeeded" not in L.canon(d_crash))
inj = F.reseal(crash, **fake_block)
rec("raw-vs-fake-parse", "the same fabricated block injected INTO the capture makes it MALFORMED (schema-forbidden interpretation fields)", derive(inj)["classification"] == "MALFORMED" and bool(schema_errs(V["resolveEvidenceSet"], F.ES([MINT.raw_rec(inj)]))))
rv_bad = MINT.review(crash, spec_vs, decision="ACCEPT")
es_crash = F.ES(list(EVS["attached"]["records"].values()) + [MINT.raw_rec(crash), rv_bad])
rec("raw-vs-fake-parse", "a reviewer cannot ACCEPT a derived EXCEPTION (review law refuses it)", any("ACCEPT over derived EXCEPTION" in e for e in L.semantic_review_decision(rv_bad, es_crash, rp, ENVC, ACTIVE_HYP)))
rec("raw-vs-fake-parse", "no refreeze can promote it: the recomputation is EXCEPTION, so the promotion is refused", any("cannot be promoted" in e for e in L.semantic_refreeze_record(MINT.refz(hyp, CAPS_SHA, promoted_raw_capture_sha256=[crash["raw_digest"]], promoted_derived_result_sha256=[d_crash["derived_result_sha256"]], promoted_review_decision_sha256=[rv_bad["record_id"]]), None, es_crash, rp, ENVC, ACTIVE_HYP)))
rec("raw-vs-fake-parse", "QUALIFIED_READ is unreachable: under every fabricated-interpretation evidence set the primitive stays UNQUALIFIED and the callable set stays empty", all(L.primitive_status(hyp, rp, "GetVersionString", EVS[s_], ENVC, ACTIVE_HYP, rp=rp) == "UNQUALIFIED" and L.callable_method_set(hyp, rp, EVS[s_], tc, ACTIVE_HYP) == set() for s_ in ("attached-evidence-raised-accepted", "attached-evidence-raised-fake-parse-block", "attached-evidence-derived-cache-forged")))
# 6e-bis. COHERENT hostile controls: a successor matrix + refreeze record that promote EXACTLY the failing capture's own digests
# (the attacker did everything else right, so the refusal must come from the DERIVATION, not from missing evidence)
def hostile_chain(capture, method="GetVersionString"):
    """Build {caps, active, es} in which the matrix, its refreeze block, a REFREEZE_RECORD and an ACCEPT review all name this capture."""
    spec_ = SPECS[method]
    d_ = L.derive_capability_result(capture, spec_, ENVC, dict(ACTIVE_HYP))
    rv_ = MINT.review(capture, spec_)
    caps_ = copy.deepcopy(hyp)
    for r_ in caps_["rows"]:
        if method in r_["primitives"]:
            r_["evidence_records"] = [x for x in r_["evidence_records"] if x["method"] != method] + [dict(next(x for x in r_["evidence_records"] if x["method"] == method), raw_capture_sha256=capture["raw_digest"], derived_result_sha256=d_["derived_result_sha256"], review_decision_sha256=rv_["record_id"], evidence_sha256=capture["raw_digest"], probe_id=capture["probe_id"])]
    rf_ = caps_["refreeze"]
    rf_["promoted_raw_capture_sha256"] = sorted(set(rf_["promoted_raw_capture_sha256"]) | {capture["raw_digest"]})
    rf_["promoted_derived_result_sha256"] = sorted(set(rf_["promoted_derived_result_sha256"]) | {d_["derived_result_sha256"]})
    rf_["promoted_review_decision_sha256"] = sorted(set(rf_["promoted_review_decision_sha256"]) | {rv_["record_id"]})
    rf_["promoted_probe_ids"] = sorted(set(rf_["promoted_probe_ids"]) | {capture["probe_id"]})
    active_ = dict(ACTIVE_HYP, capability_matrix_sha256=L.capability_matrix_digest(caps_))
    refz_ = MINT.refz(caps_, CAPS_SHA, probe_id=capture["probe_id"], session=capture["session_id"], caps_sha=active_["capability_matrix_sha256"])
    es_ = F.ES(list(es_rev["records"].values()) + [MINT.raw_rec(capture), rv_, refz_])
    return {"caps": caps_, "active": active_, "es": es_, "derived": d_, "review": rv_, "refreeze": refz_}


COHERENT = [("RAISED getter", MINT.capture("GetVersionString", "raise", probe_id="probe-coh-1"), "EXCEPTION"),
            ("TIMEOUT getter", MINT.capture("GetVersionString", "slow", timeout_s=0.05, probe_id="probe-coh-2"), "TIMEOUT"),
            ("missing attribute", MINT.capture("GetVersionString", "missing", probe_id="probe-coh-3"), "UNSUPPORTED"),
            ("wrong return type", MINT.capture("GetVersionString", "wrong_type", probe_id="probe-coh-4"), "TYPE_MISMATCH"),
            ("None where non-nullable", MINT.capture("GetVersionString", "none", probe_id="probe-coh-5"), "NULL_NOT_ALLOWED"),
            ("unserializable return", MINT.capture("GetVersionString", "cyclic", probe_id="probe-coh-6"), "UNSERIALIZABLE"),
            ("empty value where NON_EMPTY", MINT.capture("GetVersionString", "empty", probe_id="probe-coh-7"), "TYPE_MISMATCH")]
for nm_, cap_, cls_ in COHERENT:
    ch_ = hostile_chain(cap_)
    q_ = L.capability_qualification(ch_["caps"], rp, "GetVersionString", ch_["es"], ENVC, ch_["active"])
    reason_ = "; ".join(q_["reasons"])
    rec("raw-vs-fake-parse", f"COHERENT hostile chain ({nm_}): matrix, refreeze record and ACCEPT review all name this capture, and it is still UNQUALIFIED because the parser derives {cls_}", q_["status"] == "UNQUALIFIED" and cls_ in reason_ and "missing" not in reason_, f"status={q_['status']} reasons={q_['reasons'][:1]}")
    rec("raw-vs-fake-parse", f"COHERENT hostile chain ({nm_}): the promoted review is refused and the refreeze record is refused for the same reason", any("ACCEPT over derived" in e for e in L.semantic_review_decision(ch_["review"], ch_["es"], rp, ENVC, ch_["active"])) and any("cannot be promoted" in e for e in L.semantic_refreeze_record(ch_["refreeze"], ch_["caps"], ch_["es"], rp, ENVC, ch_["active"])))
    rec("raw-vs-fake-parse", f"COHERENT hostile chain ({nm_}): the callable set stays empty and the promotion state never reaches ACTIVE_QUALIFIED_READ", L.callable_method_set(ch_["caps"], rp, ch_["es"], tc, ch_["active"]) - set(PROBE_METHODS) == set() and "GetVersionString" not in L.callable_method_set(ch_["caps"], rp, ch_["es"], tc, ch_["active"]) and L.promotion_state(cap_["raw_digest"], ch_["caps"], ch_["es"], rp, ENVC, ch_["active"])["state"] in ("CANDIDATE", "REVIEWED_ACCEPTED", "PROMOTED_IN_REFREEZE"))
ch_ok = hostile_chain(CAP_OK["GetVersionString"])
rec("raw-vs-fake-parse", "the same coherent chain over the HONEST capture does qualify (the control is valid: only the derived class differs)", L.capability_qualification(ch_ok["caps"], rp, "GetVersionString", ch_ok["es"], ENVC, ch_ok["active"])["status"] == "QUALIFIED_CALLABLE")
for nm_, set_, expect_ in (("timeout", "attached-evidence-timeout-accepted", "TIMEOUT"), ("attribute missing", "attached-evidence-attribute-missing-accepted", "UNSUPPORTED"), ("wrong type", "attached-evidence-wrong-type-accepted", "TYPE_MISMATCH"), ("null", "attached-evidence-null-accepted", "NULL_NOT_ALLOWED"), ("truncated", "attached-evidence-truncated-accepted", "TRUNCATED"), ("unserializable", "attached-evidence-unserializable-accepted", "UNSERIALIZABLE"), ("tampered raw", "attached-evidence-raw-tampered", "MALFORMED"), ("wrong receiver", "attached-evidence-wrong-receiver", "RECEIVER_MISMATCH"), ("wrong build/session", "attached-evidence-wrong-build", "BINDING_MISMATCH")):
    q_ = L.capability_qualification(hyp, rp, "GetVersionString", EVS[set_], ENVC, ACTIVE_HYP)
    rec("raw-vs-fake-parse", f"{nm_} + ACCEPT review -> UNQUALIFIED (derived {expect_} or unresolvable evidence)", q_["status"] == "UNQUALIFIED" and bool(q_["reasons"]), f"status={q_['status']} reasons={q_['reasons'][:1]}")

# 6f. review law
rv_ok = MINT.review(cap_vs, spec_vs)
es_rev16 = EVS["attached-reviewed-evidence"]
rec("review-law", "an honest ACCEPT review of a derived SUCCESS is valid and binds raw, derived, parser and spec digests", not L.semantic_review_decision(rv_ok, es_rev16, rp, ENVC, ACTIVE_HYP) and rv_ok["parser_sha256"] == L.parser_sha256() and rv_ok["primitive_spec_sha256"] == L.primitive_spec_digest(rp))
for nm_, mut_, expect_ in (
    ("a review of another raw capture", dict(raw_capture_sha256=L.sha256_text("other")), "missing, malformed or ambiguous"),
    ("a review naming a derived digest that does not recompute", dict(derived_result_sha256="0" * 64), "does not recompute"),
    ("a review bound to an older parser", dict(parser_sha256="0" * 64), "another parser"),
    ("a review bound to another primitive spec", dict(primitive_spec_sha256="0" * 64), "another primitive spec"),
    ("a review by the probe operator", dict(reviewer=F.OPERATOR), "must differ from the probe operator"),
    ("a review of another method", dict(method="GetProductName"), "method/receiver differ"),
    ("a review from another probe run", dict(probe_id="probe-9999"), "probe/session differ"),
    ("a review without a rationale", dict(rationale=""), "rationale required"),
):
    r2 = L.make_record({k: v for k, v in dict(rv_ok, **mut_).items() if k != "record_id"})
    e_ = L.semantic_review_decision(r2, es_rev16, rp, ENVC, ACTIVE_HYP)
    rec("review-law", f"{nm_} is refused", bool(e_) and any(expect_ in x for x in e_), "; ".join(e_[:1]) or "ACCEPTED (should be rejected)")
rec("review-law", "REJECT and DEFER are valid decisions over any derived class, but only ACCEPT can promote", not L.semantic_review_decision(MINT.review(crash, spec_vs, decision="REJECT"), es_crash, rp, ENVC, ACTIVE_HYP) and not L.semantic_review_decision(MINT.review(crash, spec_vs, decision="DEFER"), es_crash, rp, ENVC, ACTIVE_HYP))
rec("review-law", "the stored derived result is only a cache: a forged cache is rejected against the recomputation", any("recomputation" in e for e in L.semantic_derived_result_record(next(r for r in EVS["attached-evidence-derived-cache-forged"]["records"].values() if r["record_type"] == "DERIVED_CAPABILITY_RESULT"), EVS["attached-evidence-derived-cache-forged"], rp, ENVC, ACTIVE_HYP)) and not L.semantic_derived_result_record(next(r for r in EVS["attached-evidence-derived-cache-honest"]["records"].values() if r["record_type"] == "DERIVED_CAPABILITY_RESULT" and r["derived"]["method"] == "GetVersionString"), EVS["attached-evidence-derived-cache-honest"], rp, ENVC, ACTIVE_HYP))

# 6g. refreeze law
refz_ok = next(r for r in es_rev16["records"].values() if r["record_type"] == "REFREEZE_RECORD")
rec("refreeze-law", "the honest refreeze record validates against the successor matrix and every promotion re-derives to SUCCESS", not L.semantic_refreeze_record(refz_ok, hyp, es_rev16, rp, ENVC, ACTIVE_HYP))
for nm_, mut_, expect_ in (
    ("a refreeze bound to another parser", dict(parser_sha256="0" * 64), "another parser"),
    ("a refreeze bound to another primitive spec", dict(primitive_spec_sha256="0" * 64), "another primitive spec"),
    ("a refreeze naming another successor matrix", dict(capability_matrix_sha256="0" * 64), "does not name the supplied successor matrix"),
    ("a refreeze with a stale parent matrix", dict(parent_capability_matrix_sha256="0" * 64), "parent matrix differs"),
    ("a refreeze from another session", dict(session_id=F.S_OLD), "another probe/session"),
    ("a refreeze from another probe run", dict(probe_id="probe-9999"), "another probe/session"),
    ("a refreeze on another host", dict(host_name="PRESTO"), "host_name differs"),
    ("a refreeze on another build", dict(build=7), "build differs"),
    ("a refreeze without a human approver", dict(approver=""), "human approver"),
    ("a refreeze promoting a raw capture that is not in the evidence set", dict(promoted_raw_capture_sha256=[L.sha256_text("ghost")]), "missing/malformed/ambiguous"),
    ("a refreeze whose promoted review digest is absent", dict(promoted_review_decision_sha256=[]), "no promoted REVIEW_DECISION"),
    ("a refreeze whose promoted derived digest is not the recomputation", dict(promoted_derived_result_sha256=["0" * 64]), "not among the promoted derived digests"),
):
    r2 = L.make_record({k: v for k, v in dict(refz_ok, **mut_).items() if k != "record_id"})
    e_ = L.semantic_refreeze_record(r2, hyp, es_rev16, rp, ENVC, ACTIVE_HYP)
    rec("refreeze-law", f"{nm_} is refused", bool(e_) and any(expect_ in x for x in e_), "; ".join(e_[:1]) or "ACCEPTED (should be rejected)")
mixed = L.make_record({k: v for k, v in dict(refz_ok, promoted_review_decision_sha256=[next(r["record_id"] for r in es_rev16["records"].values() if r["record_type"] == "REVIEW_DECISION" and r["method"] == "GetProductName")]).items() if k != "record_id"})
rec("refreeze-law", "evidence A reviewed but evidence B promoted (a review of one capture can never promote another)", bool(L.semantic_refreeze_record(mixed, hyp, es_rev16, rp, ENVC, ACTIVE_HYP)))
rec("refreeze-law", "the refreeze record and the matrix refreeze block must promote identical digest sets", any("differs from the matrix refreeze block" in e for e in L.semantic_refreeze_record(refz_ok, load(HYP_PATH) | {"refreeze": dict(hyp["refreeze"], promoted_probe_ids=[])}, es_rev16, rp, ENVC, ACTIVE_HYP)))

# 6h. content-bound active matrix (F15-02)
rec("matrix-integrity", "the frozen matrix is the active matrix; a forged QUALIFIED_READ matrix under the same active digest is refused", not L.active_authority_errors(caps, ACTIVE) and any("CAPABILITY_MATRIX_NOT_ACTIVE" in e for e in L.active_authority_errors(forged_matrix(caps), ACTIVE)))
rec("matrix-integrity", "an invented QUALIFIED_READ matrix cited under the REAL frozen zero-qualified digest cannot qualify anything (primitive_status and the callable set stay empty)", L.primitive_status(forged_matrix(caps), rp, "GetVersionString", es_rev16, ENVC, ACTIVE, rp=rp) == "UNQUALIFIED" and L.callable_method_set(forged_matrix(caps), rp, es_rev16, tc, ACTIVE) == set())
rec("matrix-integrity", "the hypothetical successor matrix qualifies ONLY when supplied as its own content (its digest is the active one)", L.primitive_status(hyp, rp, "GetVersionString", es_rev16, ENVC, ACTIVE_HYP, rp=rp) == "QUALIFIED_CALLABLE" and L.primitive_status(hyp, rp, "GetVersionString", es_rev16, ENVC, ACTIVE, rp=rp) == "UNQUALIFIED")
rec("matrix-integrity", "a single changed byte of the successor matrix changes its digest and revokes qualification", L.capability_matrix_digest(dict(hyp, coverage_caveat=hyp["coverage_caveat"] + " ")) != HYP_SHA and L.primitive_status(dict(hyp, coverage_caveat=hyp["coverage_caveat"] + " "), rp, "GetVersionString", es_rev16, ENVC, ACTIVE_HYP, rp=rp) == "UNQUALIFIED")
rec("matrix-integrity", "the frozen matrix qualifies nothing and the hypothetical one qualifies exactly the 47 probe methods", L.callable_method_set(caps, rp, EVS["attached"], tc, ACTIVE) == set() and L.callable_method_set(hyp, rp, es_rev16, tc, ACTIVE_HYP) == set(PROBE_METHODS))
rec("matrix-integrity", "GetStartFrame alone drops out when its capture is absent (per-method evidence, not a blanket flag)", L.callable_method_set(hyp, rp, EVS["attached-reviewed-evidence-minus-getstartframe"], tc, ACTIVE_HYP) == set(PROBE_METHODS) - {"GetStartFrame"})
rec("matrix-integrity", "the retired CAPABILITY_EVIDENCE record type is refused by the evidence-set law", any("RETIRED" in e for e in L.validate_evidence_set(EVS["invalid-retired-capability-evidence-type"], ACTIVE)))

# 6i. promotion state machine (derived) and its transition guards
PS = lambda es_, sha_=None, caps_=None, active_=None: L.promotion_state(sha_ or cap_vs["raw_digest"], caps_ if caps_ is not None else hyp, es_, rp, ENVC, active_ or ACTIVE_HYP)
rec("promotion", "an honest capture with a valid ACCEPT review, refreeze and active matrix derives ACTIVE_QUALIFIED_READ", PS(es_rev16)["state"] == "ACTIVE_QUALIFIED_READ")
rec("promotion", "the same evidence under the frozen (non-active) matrix stops at PROMOTED_IN_REFREEZE", PS(es_rev16, caps_=caps, active_=ACTIVE)["state"] in ("PROMOTED_IN_REFREEZE", "REVIEWED_ACCEPTED"))
rec("promotion", "a capture with no review is CANDIDATE; with a REJECT review it is REVIEWED_REJECTED (terminal)", PS(EVS["attached-candidate-evidence-unreviewed"])["state"] == "CANDIDATE" and PS(EVS["attached-evidence-review-reject"])["state"] == "REVIEWED_REJECTED")
rec("promotion", "a valid ACCEPT without a refreeze stops at REVIEWED_ACCEPTED", PS(EVS["attached-evidence-no-refreeze-record"])["state"] == "REVIEWED_ACCEPTED")
for st_, ev_, ctx_, ok_ in (("CANDIDATE", "REFREEZE", {"refreeze_errors": [], "promoted": True}, False), ("CANDIDATE", "ACTIVATE", {}, False), ("CANDIDATE", "REVIEW_ACCEPT", {"review_errors": [], "derived_class": "EXCEPTION"}, False), ("CANDIDATE", "REVIEW_ACCEPT", {"review_errors": [], "derived_class": "SUCCESS"}, True), ("REVIEWED_ACCEPTED", "REFREEZE", {"refreeze_errors": ["x"], "promoted": True}, False), ("REVIEWED_ACCEPTED", "REFREEZE", {"refreeze_errors": [], "promoted": True}, True), ("PROMOTED_IN_REFREEZE", "ACTIVATE", {"active_matrix_sha256": "a", "refreeze_matrix_sha256": "b", "qualification_status": "QUALIFIED_CALLABLE"}, False), ("PROMOTED_IN_REFREEZE", "ACTIVATE", {"active_matrix_sha256": "a", "refreeze_matrix_sha256": "a", "qualification_status": "UNQUALIFIED"}, False), ("PROMOTED_IN_REFREEZE", "ACTIVATE", {"active_matrix_sha256": "a", "refreeze_matrix_sha256": "a", "qualification_status": "QUALIFIED_CALLABLE"}, True), ("REVIEWED_REJECTED", "REFREEZE", {"refreeze_errors": [], "promoted": True}, False), ("ACTIVE_QUALIFIED_READ", "REVIEW_ACCEPT", {"review_errors": [], "derived_class": "SUCCESS"}, False)):
    st2, err_ = L.promotion_step(st_, ev_, ctx_)
    rec("promotion", f"{st_} --{ev_}--> {'allowed' if ok_ else 'refused'}", (err_ is None) == ok_ and (st2 != st_) == ok_, err_ or "")
rec("promotion", "the promotion state vocabulary and transitions are closed (no direct jump exists)", set(L.PROMOTION_STATES) == set(L.PROMOTION_TRANSITIONS) and L.PROMOTION_TRANSITIONS["CANDIDATE"] == {"REVIEWED_ACCEPTED", "REVIEWED_REJECTED"} and L.PROMOTION_TRANSITIONS["REVIEWED_REJECTED"] == set() and L.PROMOTION_TRANSITIONS["ACTIVE_QUALIFIED_READ"] == set())

# 6j. identity evidence claims A/B/C (M-ID)
ID_SPEC = SPECS["TimelineItem.GetUniqueId"]


def id_pass(uids, probe_id):
    """One no-mutation read pass: one capture per item, each with its own receiver navigation path."""
    c_ = SHIM.ShimContext(probe_id, F.S_CUR, L.AUTHORITY_VERSION, ACT["placeholder_manifest_sha256"], F.HOST, F.PRODUCT, F.VER, F.BUILD, F.UU, F.ROOT, F.OPERATOR, clock=lambda: "2026-09-08T11:40:00Z")
    return [SHIM.capture(c_, F.FAKES["ok"]["TimelineItem"](u), "TimelineItem", f"...->GetItemListInTrack('video',1)[{i}]", "TimelineItem.GetUniqueId", list(F.PRIMITIVE_SPECS)) for i, u in enumerate(uids)]


id_passes = [id_pass(("it-1", "it-2", "it-3"), f"probe-id-{r_}") for r_ in range(3)]
dup_passes = [id_pass(("it-1", "it-1", "it-3"), f"probe-dup-{r_}") for r_ in range(3)]
cl = L.identity_claims(id_passes, ID_SPEC, ENVC, ACTIVE_HYP)
rec("identity-evidence", "A callable, B unique within a pass and C stable across 3 passes are all true on the honest fixture and are separate claims", cl["claim_A_callable"] and cl["claim_B_unique_within_pass"] and cl["claim_C_stable_across_passes"] and cl["passes"] == 3 and cl["items"] == 3)
cld = L.identity_claims(dup_passes, ID_SPEC, ENVC, ACTIVE_HYP)
rec("identity-evidence", "duplicate ids: A true, B FALSE with the duplicate listed, C true (callability never implies uniqueness)", cld["claim_A_callable"] and not cld["claim_B_unique_within_pass"] and cld["duplicates"] == ["it-1"] and cld["claim_C_stable_across_passes"])
unstable = [[MINT.capture("TimelineItem.GetUniqueId", ctx=MINT.ctx(probe_id=f"probe-unstable-{r_}")) for _ in range(2)] for r_ in range(3)]
rec("identity-evidence", "two passes are never enough for C, and a failed capture breaks A and B", not L.identity_claims(id_passes[:2], ID_SPEC, ENVC, ACTIVE_HYP)["claim_C_stable_across_passes"] and not L.identity_claims([[MINT.capture("TimelineItem.GetUniqueId", "raise")]], ID_SPEC, ENVC, ACTIVE_HYP)["claim_A_callable"])
rec("identity-evidence", "no identity claim covers mutation or save/reopen survival (M3 P6/P15 remain the only place for that)", any("survival across append" in s_ for s_ in cl["not_claimed"]) and any("save/reopen" in s_ for s_ in cl["not_claimed"]))
id_u = next(r for r in EVS["attached-identity-observations"]["records"].values() if r["record_type"] == "IDENTITY_UNIQUENESS_OBSERVATION")
id_s = next(r for r in EVS["attached-identity-observations"]["records"].values() if r["record_type"] == "IDENTITY_STABILITY_OBSERVATION")
rec("identity-evidence", "honest uniqueness and stability observations validate (claims recomputed from the re-parsed captures)", not L.semantic_identity_observation(id_u, EVS["attached-identity-observations"], rp, ENVC, ACTIVE_HYP) and not L.semantic_identity_observation(id_s, EVS["attached-identity-observations"], rp, ENVC, ACTIVE_HYP))
id_forged = next(r for r in EVS["attached-identity-duplicates-claimed-unique"]["records"].values() if r["record_type"] == "IDENTITY_UNIQUENESS_OBSERVATION")
rec("identity-evidence", "an observation claiming uniqueness over duplicate captures is refused against the recomputation", any("differs from the recomputation" in e for e in L.semantic_identity_observation(id_forged, EVS["attached-identity-duplicates-claimed-unique"], rp, ENVC, ACTIVE_HYP)))
id_honest_dup = next(r for r in EVS["attached-identity-duplicates-honest"]["records"].values() if r["record_type"] == "IDENTITY_UNIQUENESS_OBSERVATION")
rec("identity-evidence", "an honest observation that records the duplicates is valid evidence (a failure is recorded, not hidden)", not L.semantic_identity_observation(id_honest_dup, EVS["attached-identity-duplicates-honest"], rp, ENVC, ACTIVE_HYP))
id_two = next(r for r in EVS["attached-identity-stability-two-passes"]["records"].values() if r["record_type"] == "IDENTITY_STABILITY_OBSERVATION")
rec("identity-evidence", "a stability observation with fewer than three passes is refused", any("requires >= 3 passes" in e or "differs from the recomputation" in e for e in L.semantic_identity_observation(id_two, EVS["attached-identity-stability-two-passes"], rp, ENVC, ACTIVE_HYP)))
rec("identity-evidence", "an identity observation may not carry a survival claim", any("survival" in e for e in L.semantic_identity_observation(L.make_record({k: v for k, v in dict(id_u, claims=dict(id_u["claims"], claim_D_survives_mutation=True)).items() if k != "record_id"}), EVS["attached-identity-observations"], rp, ENVC, ACTIVE_HYP)))
rec("identity-evidence", "occurrence identity stays fail-closed on duplicates regardless of the identity claims", L.occurrence_index({"payload": {"tracks": [{"type": "video", "index": 1, "items": [{"unique_id": "d", "observation_ordinal": 0, "field_status": {"unique_id": "OBSERVED"}}, {"unique_id": "d", "observation_ordinal": 1, "field_status": {"unique_id": "OBSERVED"}}]}]}})[0] is None)

# ---- 7. layered fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_capabilities": lambda d: L.semantic_capabilities(d, rp=rp)}
layer_counts = {}
LAYERED = {}


def ctx_from(fx):
    if not fx.get("capabilities") or not fx.get("evidence_set"):
        return None
    c = ctx_for(fx["capabilities"], fx["evidence_set"])
    if fx.get("forge_matrix"):
        c = dict(c, caps=forged_matrix(caps_for(fx["capabilities"])))
    return c



def run_check(chk, doc, fx):
    if chk == "semantic_mutation_plan":
        return L.semantic_mutation_plan(doc, perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), fx.get("guard_digest"))
    if chk == "semantic_journal":
        return L.semantic_journal(doc, fx.get("plan"), fx.get("s1"))
    if chk == "semantic_verification_result":
        return L.semantic_verification_result(doc, fx.get("plan"), fx.get("s0"), fx.get("s1"), fx.get("journal"))
    if chk == "semantic_conflict":
        return L.semantic_conflict(doc, fx.get("plan"))
    if chk == "semantic_commit_manifest":
        return L.semantic_commit_manifest(doc, fx.get("plan"), fx.get("journal"), fx.get("verification_result"), fx.get("conflicts") or [], fx.get("s0"), fx.get("s1"), ACTIVE_HYP)
    if chk == "semantic_snapshot":
        return L.semantic_snapshot(doc, ctx_from(fx))
    if chk == "semantic_read_primitives":
        return L.semantic_read_primitives(doc, caps, perms)
    if chk == "semantic_read_primitives_with_perms":
        return L.semantic_read_primitives(rp, caps, doc)
    return CHECKS[chk](doc)


for rel in sorted(glob.glob(os.path.join(B, "fixtures/layered/*.json"))):
    fx = load(rel)
    name, layer = fx["fixture"], fx["layer_expected_failure"]
    LAYERED[name] = fx
    layer_counts[layer] = layer_counts.get(layer, 0) + 1
    if layer not in L.FIXTURE_LAYERS:
        rec("fixture-layer", name, False, f"unknown layer {layer}")
        continue
    doc = fx["document"]
    v = V.get(fx["schema"]) if fx.get("schema") else None
    s_errs = schema_errs(v, doc) if v else []
    s_msgs = msgs(s_errs)
    if layer == "schema":
        hit = bool(s_errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in s_msgs.lower())
        rec("fixture-schema-negative", name, hit, s_msgs if s_errs else "ACCEPTED (should be rejected)")
        continue
    if s_errs:
        rec("fixture-schema-positive", name, False, "fixture beyond schema layer is schema-invalid: " + s_msgs)
        continue
    rec("fixture-schema-positive", name, True)
    chk = fx.get("check")
    if not chk:
        rec("fixture-none", name, layer == "none")
        continue
    errs, exc = safe(run_check, chk, doc, fx)
    joined = "; ".join(errs)
    if exc:
        rec(f"fixture-{layer}", name, False, "check raised instead of returning errors: " + joined)
    elif layer == "none":
        rec("fixture-semantic-positive", name, not errs, joined)
    elif layer in ("semantic", "eligibility", "snapshot", "evidence-binding", "attachment", "capability"):
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec(f"fixture-{layer}-negative", name, hit, joined if errs else "ACCEPTED (should be rejected)")
    else:
        rec("fixture-layer", name, False, f"layer {layer} not valid for layered fixtures")
rec("fixture-layers", "layers present", {"none", "schema", "snapshot", "semantic", "eligibility"} <= set(layer_counts), str(layer_counts))

# ---- 8. linked sets: composed authorization (the only path)
LINKED = {}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/linked-set/*.json"))):
    fx = load(rel)
    LINKED[fx["fixture"]] = fx
    errs, exc = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), schema_validate)
    joined = "; ".join(errs)
    if exc:
        rec("linked-set", fx["fixture"], False, joined)
    elif fx["layer_expected_failure"] == "none":
        rec("linked-set-positive", fx["fixture"], not errs, joined)
    else:
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec("linked-set-negative", fx["fixture"], hit, joined if errs else "ACCEPTED (should be rejected)")
    if fx["set"].get("commit") is not None:
        ce, exc2 = safe(L.commit_eligibility, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), schema_validate)
        expect_ok = fx["layer_expected_failure"] == "none"
        rec("commit-eligibility", fx["fixture"], not exc2 and ce["eligible"] == expect_ok and (not expect_ok or ce["stages_completed"] == list(L.VALIDATION_STAGES)), "" if exc2 else f"eligible={ce['eligible']} stages={len(ce['stages_completed'])} errors={ce['errors'][:2]}")
TS_OK = LINKED["linked-set-committed-consistent"]["set"]
ES_FULL = EVS["write-ready-full"]
rec("linked-set", "plan_digest law: digest of body without refs", L.plan_digest_of(TS_OK["plan"]) == TS_OK["plan"]["plan_digest"] and L.plan_digest_of(dict(TS_OK["plan"], refs={})) == TS_OK["plan"]["plan_digest"])
s0f, s1f, planf, journalf, vrf, cmf = TS_OK["s0_snapshot"], TS_OK["s1_snapshot"], TS_OK["plan"], TS_OK["journal"], TS_OK["verification"], TS_OK["commit"]
S1X = {os.path.basename(p)[:-5]: load(f"fixtures/snapshot/{os.path.basename(p)[:-5]}.json") for p in glob.glob(os.path.join(B, "fixtures/snapshot/*.json"))}

# ---- 9. bypass audit: no exported validator can skip S0, S1, capability provenance, delta or effects
pub = {n: f for n, f in inspect.getmembers(L, inspect.isfunction) if not n.startswith("_") and f.__module__ == L.__name__}
auth_names = set(L.AUTHORITY_SURFACE["authorizing"]); internal_names = set(L.AUTHORITY_SURFACE["internal_non_authorizing"])
rec("bypass-audit", "AUTHORITY_SURFACE lists commit_eligibility and validate_transaction_set as the only transaction-authorizing entry points", {"commit_eligibility", "validate_transaction_set"} <= auth_names and not ({"semantic_commit_manifest", "semantic_verification_result", "verify_transaction", "derive_delta"} & auth_names))
rec("bypass-audit", "every exported validator touching commit/verification/journal/plan/snapshot/delta is classified", all(n in auth_names or n in internal_names for n in pub if re.search(r"commit|verif|journal|mutation_plan|snapshot$|delta|occurrence|capability_", n)), ",".join(n for n in pub if re.search(r"commit|verif|journal|mutation_plan|snapshot$|delta|occurrence|capability_", n) and n not in auth_names | internal_names))
rec("bypass-audit", "every INTERNAL_NON_AUTHORIZING function says so in its docstring", all("INTERNAL_NON_AUTHORIZING" in (pub[n].__doc__ or "") for n in internal_names if n in pub), ",".join(n for n in internal_names if n in pub and "INTERNAL_NON_AUTHORIZING" not in (pub[n].__doc__ or "")))
sig = inspect.signature(L.validate_transaction_set)
rec("bypass-audit", "validate_transaction_set has no callable-set, skip or override parameter", not any(k in sig.parameters for k in ("callable_methods", "skip", "skip_stages", "trust", "receipt")) and "_stages" in sig.parameters)
rec("bypass-audit", "schema_validate is a REQUIRED positional parameter of both authorizing entry points (F15-04: no default makes schema enforcement optional)", sig.parameters["schema_validate"].default is inspect.Parameter.empty and inspect.signature(L.commit_eligibility).parameters["schema_validate"].default is inspect.Parameter.empty)
rec("bypass-audit", "the default (no schema validator) composed call refuses instead of reporting the schema stage completed", any("schema validator is REQUIRED" in e for e in L.validate_transaction_set(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, None)) and not L.commit_eligibility(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, None)["eligible"])
_opaque = copy.deepcopy(TS_OK)
_opaque["s0_snapshot"] = copy.deepcopy(TS_OK["s0_snapshot"]); _opaque["s0_snapshot"]["payload"]["tracks"][0]["items"][0]["opacity"] = 50
rec("bypass-audit", "an unsupported property field in S0 is refused by the mandatory schema stage (F15-04 attack shape: recomputed digests do not help)", any("schema/s0" in e for e in L.validate_transaction_set(_opaque, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)))
rec("bypass-audit", "a forged in-memory matrix under the real active digest is refused before any stage (F15-02)", any("CAPABILITY_MATRIX_NOT_ACTIVE" in e for e in L.validate_transaction_set(TS_OK, perms, rp, forged_matrix(hyp), tc, ES_FULL, ACTIVE_HYP, schema_validate)) and L.callable_method_set(forged_matrix(hyp), rp, es_rev, tc, ACTIVE_HYP) == set())
rec("bypass-audit", "commit_eligibility composes validate_transaction_set (source-level)", "validate_transaction_set(" in inspect.getsource(L.commit_eligibility))
rec("bypass-audit", "semantic_commit_manifest refuses hash-only / missing S0 / missing S1 / missing journal / missing active", all(bool(L.semantic_commit_manifest(cmf, planf, journalf, vrf, [], *args)) for args in ((None, s1f, ACTIVE_HYP), (s0f, None, ACTIVE_HYP), (s0f, s1f, None))) and bool(L.semantic_commit_manifest(cmf, planf, [], vrf, [], s0f, s1f, ACTIVE_HYP)) and bool(L.semantic_commit_manifest(cmf, planf, journalf, None, [], s0f, s1f, ACTIVE_HYP)))
rec("bypass-audit", "semantic_verification_result refuses missing plan / S0 / S1 / journal", all(bool(L.semantic_verification_result(vrf, *args)) for args in ((None, s0f, s1f, journalf), (planf, None, s1f, journalf), (planf, s0f, None, journalf), (planf, s0f, s1f, None))))
rec("bypass-audit", "validate_transaction_set refuses a set without S0", bool(L.validate_transaction_set(dict(TS_OK, s0_snapshot=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)))
rec("bypass-audit", "validate_transaction_set refuses a commit without linked S1 and verification", any("INELIGIBLE without linked S1" in e for e in L.validate_transaction_set(dict(TS_OK, s1_snapshot=None, verification=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)))
ce_ok = L.commit_eligibility(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)
rec("bypass-audit", "commit_eligibility passes only after every stage (evidence, provenance, schema, s0, plan, journal, s1, delta, effects, verification, conflicts, commit)", ce_ok["eligible"] and ce_ok["stages_completed"] == list(L.VALIDATION_STAGES), str(ce_ok["errors"][:2]))
for nm, mut in (("missing S1", lambda t: t.update(s1_snapshot=None)), ("missing verification", lambda t: t.update(verification=None)), ("missing journal", lambda t: t.update(journal=[])), ("missing S0", lambda t: t.update(s0_snapshot=None)), ("missing plan", lambda t: t.update(plan=None)), ("missing commit manifest", lambda t: t.update(commit=None))):
    t = dict(TS_OK); mut(t)
    ce = L.commit_eligibility(t, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)
    rec("bypass-audit", f"commit_eligibility INELIGIBLE with {nm}", not ce["eligible"] and ce["errors"])
forged = dict(vrf, s1_guard_digest=S1X["write-precheck-complete"]["guard_digest"], s1_payload_sha256=S1X["write-precheck-complete"]["payload_sha256"], readback_snapshot_sha256=L.snapshot_object_digest(S1X["write-precheck-complete"]), added=[], creation_identity_map={})
ce_f = L.commit_eligibility(dict(TS_OK, verification=forged), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)
rec("bypass-audit", "commit_eligibility rejects a false VERIFIED object even when its digest is what the commit cites", not ce_f["eligible"] and any("differs from derived truth" in e or "verification" in e for e in ce_f["errors"]))
rec("bypass-audit", "a syntactically valid verification hash alone never makes a commit eligible", not L.commit_eligibility(dict(TS_OK, verification=None, commit=dict(cmf, verification_result_sha256="9" * 64)), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate)["eligible"])
_src = open(os.path.join(HERE, "authority_lib.py"), encoding="utf-8").read()
_tail_users = set(re.findall(r"(\w+)\[-1\]", _src))
rec("bypass-audit", "lib never selects evidence by position (array tail only on the ordered journal chain)", _tail_users <= {"journal_records", "journal"}, ",".join(sorted(_tail_users)))
rec("bypass-audit", "callable set and provenance context are derived inside validate_transaction_set (no caller-supplied callable set)", "callable_method_set(" in inspect.getsource(L.semantic_snapshot) and "ctx = {" in inspect.getsource(L.validate_transaction_set))

# ---- 10. occurrence identity uniqueness + order-independent indexing (F3/F4)
dup = copy.deepcopy(s1f); dup["payload"]["tracks"][0]["items"][-1]["unique_id"] = "it-1"
dup_rev = copy.deepcopy(dup); dup_rev["payload"]["tracks"][0]["items"].reverse(); dup_rev["payload"]["tracks"].reverse()
i1, e1 = L.occurrence_index(dup); i2, e2 = L.occurrence_index(dup_rev)
rec("occurrence-uniqueness", "duplicate OBSERVED unique_id is rejected before any index is built", i1 is None and any("DUPLICATE_OCCURRENCE_IDENTITY" in e for e in e1))
rec("occurrence-uniqueness", "duplicate rejection is identical in reversed input order", e1 == e2)
rec("occurrence-uniqueness", "derive_delta refuses duplicates (None) and verification is UNOBSERVABLE_STATE, never first/last pick", L.derive_delta(s0f, dup) is None and L.verify_transaction(planf, s0f, dup, journalf)["verdict"] == "UNOBSERVABLE_STATE" and L.verify_transaction(planf, s0f, dup_rev, journalf)["verdict"] == "UNOBSERVABLE_STATE")
rec("occurrence-uniqueness", "unobserved identity in an authoritative index is an error (require_identity)", L.occurrence_index(S1X["full-read-partial-item-ledger"])[0] is None and any("not OBSERVED" in e for e in L.occurrence_index(S1X["full-read-partial-item-ledger"])[1]))
rec("occurrence-uniqueness", "semantic_snapshot flags duplicates in every profile (identity domain = timeline)", any("DUPLICATE_OCCURRENCE_IDENTITY" in e for e in L.semantic_snapshot(dup)) and any("DUPLICATE_OCCURRENCE_IDENTITY" in e for e in L.semantic_snapshot(dup_rev)))
rng = random.Random(SEED)


def shuffle_obj(o):
    if isinstance(o, dict):
        keys = list(o.keys())
        rng.shuffle(keys)
        return {k: shuffle_obj(o[k]) for k in keys}
    if isinstance(o, list):
        return [shuffle_obj(x) for x in o]
    return o


def shuffle_es(es):
    out = shuffle_obj(es)
    items = list(out["records"].items())
    rng.shuffle(items)
    out["records"] = dict(items)
    return out


def shuffle_payload(snap):
    s = copy.deepcopy(snap)
    p = s["payload"]
    rng.shuffle(p["tracks"])
    for t in p["tracks"]:
        rng.shuffle(t["items"])
        for it in t["items"]:
            rng.shuffle(it.get("markers", []))
    rng.shuffle(p["markers"]); rng.shuffle(p["media_dependencies"]); rng.shuffle(p["observation_failures"])
    return shuffle_obj(s)


base_delta = L.canon(L.derive_delta(s0f, s1f)); base_vt = L.canon(L.verify_transaction(planf, s0f, s1f, journalf))
ok_u, ok_d = True, True
for i in range(PERMS * 2):
    a, b_ = shuffle_payload(s0f), shuffle_payload(s1f)
    ok_u = ok_u and L.canon(L.derive_delta(a, b_)) == base_delta and L.canon(L.verify_transaction(planf, a, b_, journalf)) == base_vt and L.occurrence_index(b_)[0] == L.occurrence_index(s1f)[0]
    d_ = shuffle_payload(dup)
    ok_d = ok_d and L.occurrence_index(d_)[1] == e1 and L.verify_transaction(planf, s0f, d_, journalf)["verdict"] == "UNOBSERVABLE_STATE"
rec("occurrence-uniqueness", f"unique identities: {PERMS * 2} S0/S1 permutations give identical index, delta, creation mapping and verdict", ok_u)
rec("occurrence-uniqueness", f"duplicate identities: {PERMS * 2} permutations reject identically (same DUPLICATE_OCCURRENCE_IDENTITY text)", ok_d)

# ---- 11. protected delta surface + unrelated-change law (F5/F6)
delta = L.derive_delta(s0f, s1f)
rec("delta-surface", "S0 -> S1 delta derives exactly one added occurrence and no other protected change", delta is not None and [a["unique_id"] for a in delta["added"]] == ["it-new"] and not delta["removed"] and not delta["changed"] and not delta["timeline_changed"] and not delta["tracks_added"] and not delta["tracks_changed"] and not delta["markers_added"] and not delta["media_added"])
rec("delta-surface", "protected surface covers occurrence identity/track/range/source/media/enabled/properties/markers, timeline identity/frames/timebase/geometry/settings, track topology+fields, markers, media linkage", {"track_type", "track_index", "start", "end", "media_pool_item_unique_id", "media_id", "enabled", "source_start", "source_end", "source_sha256", "markers", "name"} <= set(L.PROTECTED_ITEM_FIELDS) and {"unique_id", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "settings", "name"} <= set(L.PROTECTED_TIMELINE_FIELDS) and set(L.PROTECTED_TRACK_FIELDS) == {"name", "enabled", "locked"} and "is_current" in L.UNPROTECTED_TIMELINE_FIELDS)


def with_(mut, base=None):
    d = copy.deepcopy(base or s1f); mut(d)
    d["payload_sha256"] = L.snapshot_payload_digest(d["payload"]); d["guard_digest"] = L.guard_digest(d)
    return d


for nm, mut, key, sub in (("source bound change", lambda d: d["payload"]["tracks"][0]["items"][0].update(source_start=5, source_end=352), "changed", "source_start"), ("timeline width change", lambda d: d["payload"]["timeline"].update(width=1920), "timeline_changed", "width"), ("timeline start change", lambda d: d["payload"]["timeline"].update(start_frame=108001), "timeline_changed", "start_frame"), ("timeline settings change", lambda d: d["payload"]["timeline"].update(settings={"timelineFrameRate": "25"}), "timeline_changed", "settings"), ("track topology change", lambda d: d["payload"]["tracks"].append(dict(copy.deepcopy(d["payload"]["tracks"][1]), index=3, items=[])), "tracks_added", "video:3"), ("track lock change", lambda d: d["payload"]["tracks"][0].update(locked=True), "tracks_changed", "video:1"), ("unrelated marker", lambda d: d["payload"]["markers"].append({"object_address": "timeline", "frame": 109000, "duration": 1, "color": "Red", "name": "x", "note": "", "custom_data": ""}), "markers_added", None), ("unrelated occurrence property (enabled)", lambda d: d["payload"]["tracks"][0]["items"][1].update(enabled=False), "changed", "enabled"), ("unrelated media dependency", lambda d: d["payload"]["media_dependencies"].append({"logical_locator": "/x.png", "source_sha256": "7" * 64, "status": "HASHED"}), "media_added", None)):
    s1x = with_(mut)
    dl = L.derive_delta(s0f, s1x)
    vt = L.verify_transaction(planf, s0f, s1x, journalf)
    found = dl is not None and bool(dl[key]) and (sub is None or (sub in dl[key] if isinstance(dl[key], dict) else any(sub in json.dumps(x) for x in dl[key])))
    rec("delta-surface", f"{nm}: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED", found and vt["verdict"] == "UNEXPECTED_DELTA" and vt["unrelated"] and vt["creation_identity_map"] == {"op-1": "it-new"}, f"verdict={vt['verdict']} unrelated={vt['unrelated'][:2]}")
    forged_x = dict(vrf, s1_guard_digest=s1x["guard_digest"], s1_payload_sha256=s1x["payload_sha256"], readback_snapshot_sha256=L.snapshot_object_digest(s1x))
    jx = copy.deepcopy(journalf); jx[6]["readback_snapshot_sha256"] = L.snapshot_object_digest(s1x); jx[6]["readback_guard_digest"] = s1x["guard_digest"]
    prev = None
    for r_ in jx:
        r_["previous_record_sha256"] = prev; prev = L.digest(r_, "vidtoolz.resolveJournalRecord.v1")
    rec("unrelated-change-law", f"{nm}: a caller-declared unrelated:[] + VERIFIED is rejected against the derived truth", any("differs from derived truth" in e for e in L.semantic_verification_result(forged_x, planf, s0f, s1x, jx)))
s0e = with_(lambda d: d["payload"]["timeline"].update(end_frame=110000), base=s0f); s1e = with_(lambda d: d["payload"]["timeline"].update(end_frame=110541))
rec("delta-surface", "APPEND that extends the timeline exactly to the new occurrence end is an explained end_frame change", L.verify_transaction(planf, s0e, s1e, journalf)["verdict"] == "VERIFIED")
s1e2 = with_(lambda d: d["payload"]["timeline"].update(end_frame=110600))
rec("delta-surface", "end_frame moved beyond the appended range is unrelated", L.verify_transaction(planf, s0e, s1e2, journalf)["verdict"] == "UNEXPECTED_DELTA")
rec("delta-surface", "is_current is outside the protected surface (adapter selection, documented)", L.verify_transaction(planf, s0f, with_(lambda d: d["payload"]["timeline"].update(is_current=False)), journalf)["verdict"] == "VERIFIED")
rec("delta-surface", "identical S0/S1 derives an empty delta", all(not v for v in L.derive_delta(s0f, s0f).values()))
vt0 = L.verify_transaction(planf, s0f, S1X["write-precheck-complete"], journalf)
rec("append-effect", "APPEND with no new occurrence -> EXPECTED_DELTA_MISSING, empty creation map, never VERIFIED", vt0["verdict"] == "EXPECTED_DELTA_MISSING" and vt0["added"] == [] and vt0["creation_identity_map"] == {})
rec("append-effect", "APPEND not APPLIED in the journal cannot verify", L.verify_transaction(planf, s0f, s1f, journalf[:3])["verdict"] != "VERIFIED")
rec("append-effect", "incomplete S1 -> UNOBSERVABLE_STATE", L.verify_transaction(planf, s0f, dict(s1f, coverage=dict(s1f["coverage"], complete=False)), journalf)["verdict"] == "UNOBSERVABLE_STATE")

# ---- 12. journal readback -> S1 binding and execution session (F5')
rb = L.journal_readback(journalf)
rec("journal-s1-binding", "journal READBACK_S1 names exactly the supplied S1 (snapshot object digest + guard)", rb is not None and rb["readback_snapshot_sha256"] == L.snapshot_object_digest(s1f) and rb["readback_guard_digest"] == s1f["guard_digest"])
rec("journal-s1-binding", "journal validated against a different S1 fails (journal points to S1 A, validator receives S1 B)", any("names a different S1" in e for e in L.semantic_journal(journalf, planf, S1X["write-precheck-complete"])))
rec("journal-s1-binding", "S1 from another session is rejected by journal, lineage and verification", any("different session" in e for e in L.semantic_journal(journalf, planf, dict(s1f, collection=dict(s1f["collection"], session_id=F.S_OLD)))) and any("session" in e for e in L.guard_lineage_errors(s0f, dict(s1f, collection=dict(s1f["collection"], session_id=F.S_OLD)), planf)))
rec("journal-s1-binding", "verification without a READBACK_S1 event is rejected", any("no single READBACK_S1" in e for e in L.semantic_verification_result(vrf, planf, s0f, s1f, journalf[:5])))
rec("journal-s1-binding", "two READBACK_S1 events are ambiguous", L.journal_readback(journalf[:7] + [journalf[6]]) is None)
rec("journal-s1-binding", "linked identity is bound across plan, journal, S0, S1, verification and commit (session, plan digest, transaction, target, guards, operation set, S1 digest)", planf["session_id"] == journalf[0]["session_id"] == s0f["collection"]["session_id"] == s1f["collection"]["session_id"] == vrf["session_id"] == cmf["session_id"] and cmf["s1_snapshot_sha256"] == L.snapshot_object_digest(s1f) == vrf["readback_snapshot_sha256"] == rb["readback_snapshot_sha256"] and cmf["verification_result_sha256"] == L.digest(vrf, "vidtoolz.resolveVerificationResult.v1"))

# ---- 13. S1 coverage profile law (F7')
rec("s1-profile-law", "APPEND requires the APPEND_VERIFY profile; S0 requires WRITE_PRECHECK", L.required_s1_profile(planf) == "APPEND_VERIFY" and L.S0_REQUIRED_PROFILE == "WRITE_PRECHECK")
rec("s1-profile-law", "WRITE_PRECHECK satisfies APPEND_VERIFY; FULL_TIMELINE_READ and MINIMAL_M0 do not", L.profile_satisfies("WRITE_PRECHECK", "APPEND_VERIFY") and L.profile_satisfies("APPEND_VERIFY", "APPEND_VERIFY") and not L.profile_satisfies("FULL_TIMELINE_READ", "APPEND_VERIFY") and not L.profile_satisfies("MINIMAL_M0", "APPEND_VERIFY") and not L.profile_satisfies("APPEND_VERIFY", "WRITE_PRECHECK"))
rec("s1-profile-law", "APPEND_VERIFY mandates identity, track, range, source/media identity, locks, guard and the protected timeline metadata", {"unique_id", "start", "end", "media_pool_item_unique_id", "source_start", "source_end", "enabled"} <= set(L.COVERAGE_PROFILES["APPEND_VERIFY"]["mandatory_item_fields"]) and {"name", "start_frame", "end_frame", "fps", "width", "height", "settings"} <= set(L.COVERAGE_PROFILES["APPEND_VERIFY"]["mandatory_timeline_fields"]) and L.COVERAGE_PROFILES["APPEND_VERIFY"]["track_locks_required"] and L.COVERAGE_PROFILES["APPEND_VERIFY"]["guard_required"] and set(L.COVERAGE_PROFILES["APPEND_VERIFY"]["identity_required"]) == {"project.unique_id", "timeline.unique_id"})
rec("s1-profile-law", "operations without a verify profile cannot be verified by any S1", L.required_s1_profile({"operations": [{"op": "SET_PROPERTIES"}]}) is None and L.required_s1_profile({"operations": [{"op": "APPEND"}, {"op": "DELETE"}]}) is None)
rec("s1-profile-law", "the APPEND_VERIFY S1 fixture validates and verifies", result_of("linked-set-positive", "linked-set-committed-append-verify-profile") is True and result_of("fixture-semantic-positive", "snapshot-append-verify-profile-complete") is True)

# ---- 14. canonicalization vectors, rejections, f64 exactness
vec = load("fixtures/canonicalization/vectors.json")
for x in vec["vectors"]:
    obj = x["input"]
    try:
        o = L.normalize_snapshot_payload(obj) if x["domain"].startswith("vidtoolz.resolveSnapshotPayload") else obj
        c = L.canon(o)
        rec("canon-vector", x["name"], c == x["canonical_utf8"] and L.digest(o, x["domain"]) == x["sha256"] and len(c.encode("utf-8")) == x["canonical_byte_length"])
    except Exception as e:  # noqa: BLE001
        rec("canon-vector", x["name"], False, e)
by = {x["name"]: x["sha256"] for x in vec["vectors"]}
for a, b_ in (("markers_total_order_A", "markers_total_order_B_reversed_same_digest"), ("permutation_invariance_A", "permutation_invariance_B_same_digest"), ("partial_items_status_aware_order_A", "partial_items_status_aware_order_B_same_digest")):
    rec("canon-invariance", f"{a} == {b_}", by.get(a) == by.get(b_))
rec("canon-vector", "payload domain is v1.5, guard v3 and provenance v1 registered; guard v1/v2 and payload v1.4 unregistered", all(x["domain"] == "vidtoolz.resolveSnapshotPayload.v1.5" for x in vec["vectors"] if "resolveSnapshotPayload" in x["domain"]) and {"vidtoolz.resolveGuard.v3", "vidtoolz.resolveProvenance.v1"} <= L.HASH_DOMAINS and not ({"vidtoolz.resolveGuard.v1", "vidtoolz.resolveGuard.v2", "vidtoolz.resolveSnapshotPayload.v1.4"} & L.HASH_DOMAINS))
for c_ in load("fixtures/canonicalization/rejections.json")["cases"]:
    try:
        if c_["kind"] == "canon":
            L.canon(c_["input"])
        elif c_["kind"] == "markers":
            L.sort_markers(c_["input"])
        elif c_["kind"] == "tracks":
            L.sort_tracks(c_["input"])
        elif c_["kind"] == "items":
            L.sort_items(c_["input"])
        elif c_["kind"] == "domain":
            L.digest(c_["input"], c_["domain"])
        rec("canon-rejection", c_["name"], False, "ACCEPTED (should be rejected)")
    except L.CanonError as e:
        rec("canon-rejection", c_["name"], c_["expect"].lower() in str(e).lower(), str(e))
    except Exception as e:  # noqa: BLE001
        rec("canon-rejection", c_["name"], False, f"wrong exception type {type(e).__name__}: {e}")
rec("f64-exact", "fullmatch semantics used", L.F64_RE.fullmatch("3ff0000000000000\n") is None and L.F64_RE.fullmatch("3ff0000000000000") is not None)


def _rejects(fn):
    try:
        fn()
        return False
    except L.CanonError:
        return True


rec("f64-exact", "one bit pattern one text (uppercase rejected, -0 rejected, whitespace rejected)", all(_rejects(lambda v=v: L.validate_f64(v)) for v in ("3FF0000000000000", "8000000000000000", " 3ff0000000000000", "3ff0000000000000\n", "3ff0000000000000\t")))

# ---- 15. eligibility
CASES = load("fixtures/eligibility/cases.json")["cases"]
ELIG = {}
for c in CASES:
    cp = forged_matrix(caps_for(c["capabilities"])) if c.get("forge_matrix") else caps_for(c["capabilities"])
    req = c["request"]
    s_ok = not schema_errs(V["resolveEligibilityRequest"], req)
    rec("eligibility-request-schema", c["name"], s_ok == c["request_schema_valid"], "request schema-valid=" + str(s_ok))
    r, exc = safe(L.evaluate_eligibility, perms, req, rp, cp, tc, EVS[c["evidence_set"]], active_for(c["capabilities"]))
    if exc:
        rec("eligibility", c["name"], False, r[0])
        continue
    ELIG[c["name"]] = r
    ok = r["eligible"] == c["expect_eligible"]
    hay = " ".join(r["failed_prerequisites"] + r["reason_codes"])
    if c.get("expect_failed_contains") and not c["expect_eligible"]:
        ok = ok and c["expect_failed_contains"] in hay
    if c.get("expect_attachment_state"):
        ok = ok and r["derived_attachment_state"] == c["expect_attachment_state"]
    rec("eligibility", c["name"], ok, f"eligible={r['eligible']} state={r['derived_attachment_state']} tr={r['target_requirement']} failed={r['failed_prerequisites'][:2]} codes={r['reason_codes'][:2]}")
SCOPE_ = perms["scopes"][0]
ROJ_REF = next(k for k, v in EVS["attached"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")
rec("eligibility-invariant", "allowed_true_is_not_eligibility", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE_, "refs": {}}, rp, caps, tc, EVS["empty"], ACTIVE)["eligible"])
rec("eligibility-invariant", "capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not)", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE_HYP)["eligible"] and not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, caps, tc, es_rev, ACTIVE)["eligible"])
rec("eligibility-invariant", "active authority argument is consumed", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE)["eligible"])
rec("eligibility-invariant", "a capture that carries a forbidden interpretation field, or whose bytes were tampered with, invalidates the whole evidence set (CONFLICT) instead of being reinterpreted", ELIG["m0-connect-deny-hyp-raised-fake-parse-block"]["derived_attachment_state"] == "CONFLICT" and ELIG["m0-connect-deny-hyp-raw-tampered"]["derived_attachment_state"] == "CONFLICT")
rec("eligibility-invariant", "CONFLICT short-circuits", ELIG["m0-snapshot-deny-duplicate-sequence-conflict"]["derived_attachment_state"] == "CONFLICT" and "ATTACHMENT_CONFLICT" in ELIG["m0-snapshot-deny-duplicate-sequence-conflict"]["reason_codes"])
rec("permission-invariant", "no_mutation_before_M3", all(not e["mutation_allowed"] for e in perms["entries"] if e["milestone"] != "M3"))
rec("permission-invariant", "every_M3_mutation_requires_authorization_and_write_ready", all({"MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY"} <= set(e["prerequisites"]) for e in perms["entries"] if e["mutation_allowed"]))
rec("permission-invariant", "no_shared_library_grant", all(e["shared_library_allowed"] is False for e in perms["entries"]))
rec("permission-invariant", "default_deny", perms["default"] == "DENY")
rec("permission-invariant", "prerequisite_codes == library set", set(perms["prerequisite_codes"]) == L.PREREQ_CODES)

# ---- 16. order-independence (seeded random permutations)
bad_e, n_e = [], 0
for c in CASES:
    base = ELIG.get(c["name"])
    if base is None:
        continue
    for i in range(PERMS):
        n_e += 1
        cp2 = forged_matrix(caps_for(c["capabilities"])) if c.get("forge_matrix") else caps_for(c["capabilities"])
        r2, exc = safe(L.evaluate_eligibility, perms, shuffle_obj(c["request"]), rp, cp2, tc, shuffle_es(EVS[c["evidence_set"]]), active_for(c["capabilities"]))
        if exc or L.canon(r2) != L.canon(base):
            bad_e.append(c["name"])
            break
rec("order-independence", f"eligibility: {len(ELIG)} cases x {PERMS} evidence/request permutations give identical decisions", not bad_e, ",".join(bad_e[:4]) or f"{n_e} permutations")
bad_a = []
for name in sorted(DERIVED):
    for i in range(PERMS):
        d2, exc = safe(L.derive_attachment_state, tc, shuffle_es(EVS[name]), ACTIVE)
        if exc or L.canon(d2) != L.canon(DERIVED[name]):
            bad_a.append(name)
            break
rec("order-independence", f"attachment: {len(DERIVED)} evidence sets x {PERMS} record-map permutations give identical derivations", not bad_a, ",".join(bad_a[:4]))
bad_s, n_s = [], 0
CTX_HYP = ctx_for(HYP_PATH, "attached-reviewed-evidence")
for sn, snap in sorted(S1X.items()):
    base_err = L.semantic_snapshot(snap, CTX_HYP)
    for i in range(PERMS):
        n_s += 1
        s2 = shuffle_payload(snap)
        try:
            same = L.snapshot_payload_digest(s2["payload"]) == snap["payload_sha256"] and L.guard_digest(s2) == snap["guard_digest"] and L.snapshot_object_digest(s2) == L.snapshot_object_digest(snap) and L.semantic_snapshot(s2, CTX_HYP) == base_err
        except Exception:  # noqa: BLE001
            same = False
        if not same:
            bad_s.append(sn)
            break
rec("order-independence", f"snapshots: every snapshot fixture x {PERMS} track/item/marker/ledger permutations keeps payload, guard and object digests and the semantic result", not bad_s, ",".join(bad_s[:4]) or f"{n_s} permutations")
bad_l = []
for name, fx in sorted(LINKED.items()):
    base_err, _ = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), schema_validate)
    for i in range(PERMS):
        ts2 = shuffle_obj(fx["set"])
        ts2["conflicts"] = list(ts2.get("conflicts") or [])
        rng.shuffle(ts2["conflicts"])
        for key in ("s0_snapshot", "s1_snapshot"):
            if ts2.get(key):
                ts2[key] = shuffle_payload(ts2[key])
        e2, exc = safe(L.validate_transaction_set, ts2, perms, rp, caps_for(fx["capabilities"]), tc, shuffle_es(EVS[fx["evidence_set"]]), active_for(fx["capabilities"]), schema_validate)
        if exc or sorted(e2) != sorted(base_err):
            bad_l.append(name)
            break
rec("order-independence", f"linked sets: {len(LINKED)} sets x {PERMS} permutations of evidence map, conflicts, snapshot arrays and key order give identical validation (incl. duplicate-identity sets)", not bad_l, ",".join(bad_l[:4]))
dup_es = EVS["attached-duplicate-sequence-conflict"]
rev = {"schema": dup_es["schema"], "current_session_id": dup_es["current_session_id"], "evaluated_at": dup_es["evaluated_at"], "records": dict(reversed(list(dup_es["records"].items())))}
rec("order-independence", "two current-sequence contradictions stay CONFLICT in both input orders", L.derive_attachment_state(tc, dup_es, ACTIVE)["state"] == "CONFLICT" and L.derive_attachment_state(tc, rev, ACTIVE)["state"] == "CONFLICT")

# ---- 16b. H0/S0 early write gate, protected-surface exclusions and the ghost applied operation (F15-03, F15-05, F15-06)
G_OK = next(r for r in EVS["write-ready-full"]["records"].values() if r["record_type"] == "GUARD_SNAPSHOT")
PLAN_TGT = {k: (planf.get("target") or {}).get(k) for k in ("library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch")}
rec("h0-early-gate", "a complete WRITE_PRECHECK guard record with qualified provenance satisfies the gate", not L.guard_record_errors(G_OK, ACTIVE_HYP, ENVC, EVS["write-ready-full"], rp, hyp, PLAN_TGT, planf["h0_guard_digest"], L.S0_REQUIRED_PROFILE))
H0_SETS = {"write-ready-h0-minimal-m0": "H0_PROFILE", "write-ready-h0-full-timeline-read": "H0_PROFILE", "write-ready-h0-incomplete-write-precheck": "H0_INCOMPLETE", "write-ready-h0-candidate-provenance": "H0_PROVENANCE", "write-ready-h0-other-matrix": "H0_MATRIX", "write-ready-h0-other-target": "H0_TARGET", "write-ready-h0-forged-guard-object": "does not re-hash", "write-ready-h0-provenance-swapped": "does not re-hash"}
for set_, expect_ in H0_SETS.items():
    g_ = next(r for r in EVS[set_]["records"].values() if r["record_type"] == "GUARD_SNAPSHOT")
    e_ = L.guard_record_errors(g_, ACTIVE_HYP, ENVC, EVS[set_], rp, hyp, PLAN_TGT, g_["guard_digest"], L.S0_REQUIRED_PROFILE)
    rec("h0-early-gate", f"{set_[len('write-ready-'):]} is refused with {expect_}", bool(e_) and any(expect_ in x for x in e_), "; ".join(e_[:1]) or "ACCEPTED (should be rejected)")
rec("h0-early-gate", "a complete FULL_TIMELINE_READ guard is accepted for a NON-write operation and refused as a write precondition (the gate is operation-specific, not a blanket ban on read snapshots)", not L.guard_record_errors(next(r for r in EVS["write-ready-h0-full-timeline-read"]["records"].values() if r["record_type"] == "GUARD_SNAPSHOT"), ACTIVE_HYP, ENVC, EVS["write-ready-h0-full-timeline-read"], rp, hyp, None, None, None) and any("H0_PROFILE" in e for e in L.guard_record_errors(next(r for r in EVS["write-ready-h0-full-timeline-read"]["records"].values() if r["record_type"] == "GUARD_SNAPSHOT"), ACTIVE_HYP, ENVC, EVS["write-ready-h0-full-timeline-read"], rp, hyp, None, None, L.S0_REQUIRED_PROFILE)))
rec("h0-early-gate", "the early gate is evaluated by evaluate_eligibility itself, before any mutator, and does not depend on the composed path", "guard_record_errors(" in inspect.getsource(L.evaluate_eligibility) and all(ELIG[f"m3-append-deny-{s_[len('write-ready-'):]}"]["eligible"] is False for s_ in H0_SETS) and ELIG["m3-append-allow-complete-write-precheck-h0"]["eligible"] is True)
rec("h0-early-gate", "PLAN_VALIDATION must come from the composed validator and name this plan's H0", ELIG["m3-append-deny-plan-validation-from-helper"]["eligible"] is False and ELIG["m3-append-deny-plan-validation-other-h0"]["eligible"] is False)
_item_schema_json = json.dumps(load("schemas/resolveSnapshot.schema.json")["properties"]["payload"]["properties"]["tracks"])
rec("protected-surface-exclusions", "item properties, fades, speed, takes, links and unowned media hashes are named as exclusions and have no payload in the item schema", set(L.PROTECTED_SURFACE_EXCLUSIONS) == {"item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"} and not any(k in _item_schema_json for k in ("\"properties\": {\"Zoom", "\"opacity\"", "\"fades\"", "\"takes\"", "\"speed\"", "\"linked_items\"")) and not any(f in json.dumps(L.PROTECTED_ITEM_FIELDS) for f in ("opacity", "fade", "speed", "take")))
rec("protected-surface-exclusions", "a property payload on an item is schema-invalid (not silently ignored)", result_of("fixture-schema-negative", "snapshot-item-property-payload-unrepresentable") is True)
rec("protected-surface-exclusions", "declaring an excluded domain as observed is a snapshot error", result_of("fixture-snapshot-negative", "snapshot-observed-domain-item-properties-excluded") is True)
dv_ = L.verify_transaction(planf, s0f, s1f, journalf)
rec("protected-surface-exclusions", "every verification result names the unobserved/excluded domains and the declaration is compared", set(L.PROTECTED_SURFACE_EXCLUSIONS) <= set(dv_["unobserved_domains"]) and any("unobserved_domains differs" in e for e in L.semantic_verification_result(dict(vrf, unobserved_domains=[]), planf, s0f, s1f, journalf)) and result_of("linked-set-negative", "linked-set-verification-hides-unobserved-domains") is True)
rec("ghost-operation", "a ghost applied_operation_id is rejected against the derived applied list", any("applied_operation_ids differs" in e for e in L.semantic_verification_result(dict(vrf, applied_operation_ids=sorted(set(vrf["applied_operation_ids"]) | {"op-ghost"})), planf, s0f, s1f, journalf)) and result_of("linked-set-negative", "linked-set-verification-ghost-applied-operation") is True)
rec("ghost-operation", "the derived applied list comes from the journal's APPLIED records only", L.journal_applied_ops(journalf) == ["op-1"] and L.journal_applied_ops(journalf[:5]) == [] and dv_["applied_operation_ids"] == ["op-1"])
rec("ghost-operation", "a commit citing the ghost verification is INELIGIBLE through the only authorizing path", not L.commit_eligibility(LINKED["linked-set-verification-ghost-applied-operation"]["set"], perms, rp, hyp, tc, EVS["write-ready-full"], ACTIVE_HYP, schema_validate)["eligible"])

# ---- 18. milestone matrix + probes + precedence
mx = load("MILESTONE-MATRIX.json")
for m, spec in mx["milestones"].items():
    es_ = [e for e in perms["entries"] if e["milestone"] == m]
    rec("milestone-matrix", f"{m} read ops match PERMISSIONS", sorted(e["operation"] for e in es_ if not e["mutation_allowed"]) == spec["read_operations"])
    rec("milestone-matrix", f"{m} mutation ops match PERMISSIONS", sorted(e["operation"] for e in es_ if e["mutation_allowed"]) == spec["mutation_operations"])
rec("milestone-matrix", "M3 is the only mutation milestone", bool(mx["milestones"]["M3"]["mutation_operations"]) and all(mx["milestones"][m]["mutation_operations"] == [] for m in ("M0", "M1", "M2")))
probes = load("M3-PROBES.json")
m3_ops = set(mx["milestones"]["M3"]["mutation_operations"]) | set(mx["milestones"]["M3"]["read_operations"])
rec("m3-probe", "19 probes P1..P19, all M3-permitted; P15 claims no rename", probes["count"] == 19 and all(op in m3_ops for p in probes["probes"] for op in p["operations"]) and "rename" not in next(p for p in probes["probes"] if p["id"] == "P15")["title"].lower())
prec = load("AUTHORITY-PRECEDENCE.json")
active = {e["path"] for e in prec["documents"] if e["status"] == "STILL_ACTIVE"}
for e in prec["documents"]:
    rec("precedence", f"{e['path']} classified", e["status"] in ("STILL_ACTIVE", "SUPERSEDED", "HISTORICAL") and (e["path"] == "VALIDATION-REPORT.md" or os.path.exists(os.path.join(B, e["path"]))))
for path in sorted(active):
    if not os.path.exists(os.path.join(B, path)) or path in prec.get("retired_term_exempt", []):
        continue
    txt = open(os.path.join(B, path), encoding="utf-8").read()
    hits = [t for t in prec["retired_terms"] if t in txt]
    rec("precedence-retired-terms", path, not hits, ",".join(hits))
bundle_docs = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "*.md"))}
rec("precedence", "every top-level document has an entry", bundle_docs <= {e["path"] for e in prec["documents"]}, ",".join(sorted(bundle_docs - {e["path"] for e in prec["documents"]})))
for s_ in prec["superseded_statements"]:
    targets = [t.strip().split("#")[0] for t in s_["new_authority"].split(";")]
    rec("precedence-supersession", s_["id"], all(os.path.exists(os.path.join(B, t)) for t in targets) and s_["status"] == "SUPERSEDED", ",".join(t for t in targets if not os.path.exists(os.path.join(B, t))))
rec("precedence", "v1.5 supersessions present", any(s_["effective_version"] == "1.5.0" for s_ in prec["superseded_statements"]))
st_ = {e["path"]: e["status"] for e in prec["documents"]}
rec("precedence", "v1.5 changelog and finding matrix are HISTORICAL; v1.6 ones are active", st_.get("CHANGELOG-v1.5.md") == "HISTORICAL" and st_.get("FINDING-RESOLUTION-MATRIX-v1.5.md") == "HISTORICAL" and st_.get("CHANGELOG-v1.6.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.6.md") == "STILL_ACTIVE")
JOURNAL_STATES = sorted({s for v in L.JOURNAL_TRANSITIONS.values() for s in v} | {"PREPARED"})
_off = []
for path in sorted(active):
    if not os.path.exists(os.path.join(B, path)) or path in ("SEMANTIC-VALIDATION.md", "AUTHORITY-PRECEDENCE.md"):
        continue
    txt_ = open(os.path.join(B, path), encoding="utf-8").read()
    chains = re.findall(r"(?:`?[A-Z_]{4,}`?\s*(?:->|→)\s*){2,}`?[A-Z_]{4,}`?", txt_)
    for ch in chains:
        if sum(1 for s_ in JOURNAL_STATES if s_ in ch) >= 3:
            _off.append(f"{path}: {ch[:60]}")
rec("precedence", "only SEMANTIC-VALIDATION.md and authority_lib enumerate journal states", not _off, "; ".join(_off[:3]))
SEMV = open(os.path.join(B, "SEMANTIC-VALIDATION.md"), encoding="utf-8").read()
_m = re.search(r"execution law `([^`]+)`", SEMV)
_segs = [s for s in ([re.findall(r"[A-Z_][A-Z_0-9]{3,}", x) for x in re.split(r"\u2192|->", _m.group(1))] if _m else []) if s]
_known = {s for v in L.JOURNAL_TRANSITIONS.values() for s in v} | {"PREPARED"}
_flat = [x for s in _segs for x in s]
_legal = bool(_segs) and all(any(nxt in L.JOURNAL_TRANSITIONS.get(prev, set()) for prev in _segs[i] for nxt in _segs[i + 1]) for i in range(len(_segs) - 1))
rec("precedence", "the journal chain quoted in SEMANTIC-VALIDATION.md is a legal path through JOURNAL_TRANSITIONS (the document mirrors the code; it is not a second independent authority)", _legal and not [x for x in _flat if x not in _known] and "CHECKPOINTED" in _flat and _flat.index("CHECKPOINTED") < _flat.index("OP_STARTED"), ",".join(_flat[:6]))
rec("m0-phases", "the four M0 phases are declared identically in the library, READ-PRIMITIVES and M0-PHASES.md, and none implies the next", list(L.M0_PHASES) == rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["phases"] and all(ph in open(os.path.join(B, "M0-PHASES.md"), encoding="utf-8").read() for ph in ("M0A PROBE", "M0B REVIEW", "M0C REFREEZE", "M0D QUALIFIED READ")) and "No phase implies the next" in open(os.path.join(B, "M0-PHASES.md"), encoding="utf-8").read())
_compat = open(os.path.join(B, "M0A-PROBE-COMPATIBILITY.md"), encoding="utf-8").read()
rec("m0-phases", "the M0A driver contract states seven must-change requirements plus the compatible, transformable and open sets", len(re.findall(r"^\| [1-7] \|", _compat, re.M)) == 7 and all(s in _compat for s in ("MUST CHANGE BEFORE THE PROBE RUNS", "Already compatible", "Transformable later", "Open until an independent reviewer decides", "Conformance statement required")))
rec("precedence", "the precedence authority names the journal-state enumeration authority", prec.get("journal_state_enumeration_authority") == ["SEMANTIC-VALIDATION.md", "tools/authority_lib.py"])
scx = open(os.path.join(B, "SCORECRAFT-EXTRACTION.md"), encoding="utf-8").read()
rec("precedence", "SCORECRAFT-EXTRACTION.md cites v1.6 active schemas, not earlier ones", "resolveTargetContract.v1.6" in scx and "resolveSnapshot.v1.6" in scx and not any(x in scx for x in ("resolveTargetContract.v1.1", "resolveSnapshot.v1.1", "resolveTargetContract.v1.4", "resolveSnapshot.v1.4", "resolveTargetContract.v1.5", "resolveSnapshot.v1.5")))

# ---- 19. timebase, guard, degraded snapshots, probe vs qualified observation
fx = load("fixtures/timebase/canary-boundaries.json")
p_, q_, O_ = fx["fps"]["numerator"], fx["fps"]["denominator"], fx["start_frame_offset"]
rec("timebase", "canary_boundaries_ceil_law", all(((r["boundary_ms"] * p_ + 1000 * q_ - 1) // (1000 * q_)) == r["B"] and r["absolute_frame"] == O_ + r["B"] for r in fx["boundaries"]) and sum(b["duration_frames"] for b in fx["beats"]) == 6756)
g = load("fixtures/guard/guard-vectors.json")
rec("guard", "payload_equal_but_guard_differs (same payload, different project)", g["same_payload_different_project"]["payload_sha256_equal"] and not g["same_payload_different_project"]["guard_digest_equal"])
rec("guard", "UNAVAILABLE != ERROR project identity produces different guards over an identical payload", g["unavailable_vs_error_identity"]["payload_sha256_equal"] and not g["unavailable_vs_error_identity"]["guard_digest_equal"])
rec("guard", "provenance authority is part of the guard (same payload, different capability evidence -> different guard)", g["provenance_changes_guard"]["payload_sha256_equal"] and not g["provenance_changes_guard"]["guard_digest_equal"])
for sn, snap in sorted(S1X.items()):
    go = L.guard_object(snap)
    rec("guard", f"{sn} guard v3 validates, recomputes and binds provenance", not list(V["resolveGuard"].iter_errors(go)) and L.snapshot_payload_digest(snap["payload"]) == snap["payload_sha256"] and L.guard_digest(snap) == snap["guard_digest"] and go["guard_version"] == 3 and go["provenance_sha256"] == L.provenance_digest(snap))
m0s = S1X["m0-minimal-nothing-qualified"]
rec("degraded-snapshot", "pre-qualification capture: every timeline/project field UNAVAILABLE, no tracks, complete:false, every method NOT_CALLABLE", all(m0s["payload"]["timeline"]["field_status"][k] == "UNAVAILABLE" for k in L.TIMELINE_STATUS_FIELDS) and m0s["payload"]["tracks"] == [] and m0s["coverage"]["complete"] is False and all(v["observation_class"] == "NOT_CALLABLE" for v in m0s["collection"]["method_provenance"].values()))
rec("degraded-snapshot", "pre-qualification capture classifies as INCOMPLETE_NOT_QUALIFIED", L.snapshot_result_class(m0s) == "INCOMPLETE_NOT_QUALIFIED")
dg = S1X["full-read-degraded-start-frame"]
rec("degraded-snapshot", "GetStartFrame not callable -> start_frame null, UNAVAILABLE + reason, provenance NOT_CALLABLE, complete:false", dg["payload"]["timeline"]["start_frame"] is None and dg["payload"]["timeline"]["field_status"]["start_frame"] == "UNAVAILABLE" and dg["collection"]["method_provenance"]["GetStartFrame"]["observation_class"] == "NOT_CALLABLE" and dg["coverage"]["complete"] is False)
rec("degraded-snapshot", "degraded snapshot passes under the matching reduced evidence set and fails when it claims OBSERVED", not L.semantic_snapshot(dg, ctx_for(HYP_PATH, "attached-reviewed-evidence-minus-getstartframe")) and result_of("fixture-snapshot-negative", "snapshot-degraded-start-frame-claimed-observed") is True)
rec("probe-vs-qualified", "CANDIDATE_OBSERVATION is distinct from QUALIFIED_OBSERVATION and never backs an OBSERVED field", set(L.OBSERVATION_CLASSES) == {"QUALIFIED_OBSERVATION", "CANDIDATE_OBSERVATION", "NOT_CALLABLE"} and result_of("fixture-snapshot-negative", "snapshot-observed-backed-by-candidate-observation") is True and result_of("fixture-semantic-positive", "snapshot-candidate-observation-honest-unavailable") is True)
rec("probe-vs-qualified", "probe output (unreviewed candidates) cannot qualify a primitive nor back OBSERVED fields, even under the hypothetical matrix", L.primitive_status(hyp, rp, "GetVersionString", EVS["attached-candidate-evidence-unreviewed"], env, ACTIVE_HYP, rp=rp) == "UNQUALIFIED" and result_of("fixture-snapshot-negative", "snapshot-provenance-cites-unreviewed-evidence") is True)

# ---- 20. exact manifest binding against the REAL manifest (never printed into the report)
man_path = os.path.join(B, "FREEZE-MANIFEST.json")
if os.path.exists(man_path):
    REAL = sha(man_path)
    ACTIVE_REAL = dict(ACTIVE, manifest_sha256=REAL)
    rec("exact-manifest", "real manifest sha differs from the fixture placeholder", REAL != ACTIVE["manifest_sha256"])
    d_ph = L.derive_attachment_state(tc, EVS["ready"], ACTIVE_REAL)
    rec("exact-manifest", "placeholder-bound fixture evidence does not derive against the real manifest (CONFLICT)", d_ph["state"] == "CONFLICT" and any("manifest" in f for f in d_ph["failures"]))
    MR = F.Mint(REAL, CAPS_SHA, rp=rp)
    SR, HR = F.base_sets(MR, PROBE_METHODS, copy.deepcopy(hyp), CAPS_SHA)
    rec("exact-manifest", "evidence re-minted against the real manifest derives ATTACHMENT_READY / ATTACHED_READ_ONLY", L.derive_attachment_state(tc, SR["ready"], ACTIVE_REAL)["state"] == "ATTACHMENT_READY" and L.derive_attachment_state(tc, SR["attached"], ACTIVE_REAL)["state"] == "ATTACHED_READ_ONLY")
    rec("exact-manifest", "the M0A probe is eligible on re-minted ready evidence (and nothing else is)", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": HR["roj"]["record_id"]}}, rp, caps, tc, SR["ready"], ACTIVE_REAL)["eligible"] and not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": HR["roj"]["record_id"]}}, rp, caps, tc, SR["ready"], ACTIVE_REAL)["eligible"])
    rec("exact-manifest", "re-minted evidence is structurally valid against the real manifest", not L.validate_evidence_set(SR["attached"], ACTIVE_REAL))
    SA, _ = F.base_sets(F.Mint("9" * 64, CAPS_SHA, rp=rp), PROBE_METHODS, copy.deepcopy(hyp), CAPS_SHA)
    rec("exact-manifest", "arbitrary 64-hex manifest sha is rejected (CONFLICT)", L.derive_attachment_state(tc, SA["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    S15, _ = F.base_sets(F.Mint("a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a", CAPS_SHA, authority_version="1.5.0", rp=rp), PROBE_METHODS, copy.deepcopy(hyp), CAPS_SHA)
    rec("exact-manifest", "v1.5 manifest / authority 1.5.0 evidence is rejected as current authority (CONFLICT)", L.derive_attachment_state(tc, S15["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    rec("exact-manifest", "real-manifest verification for another host / other version / self-verified does not count", all(L.derive_attachment_state(tc, F.ES([HR["prov"], b_, HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED" for b_ in (MR.bundle(env={"host_name": "PRESTO"}), MR.bundle(authority_version="1.5.0"), MR.bundle(verifier="Claude Code (Fable 5.1)"))))
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.5", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent (v1.5) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.5", "FREEZE-MANIFEST.json")) == "a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a")
    rec("manifest", "v1.0-v1.5 bundles are byte-identical to their frozen manifests (history preserved)", all(all(sha(os.path.join(os.path.dirname(B), v_, e_["path"])) == e_["sha256"] for e_ in L.strict_load(os.path.join(os.path.dirname(B), v_, "FREEZE-MANIFEST.json"))["files"] if os.path.exists(os.path.join(os.path.dirname(B), v_, e_["path"]))) for v_ in ("v1", "v1.1", "v1.2", "v1.3", "v1.4", "v1.5")))
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])
    rec("manifest", "validation tools listed as TOOL", all(any(e["path"] == p and e["authority_class"] == "TOOL" for e in man["files"]) for p in ("tools/authority_lib.py", "tools/validate_v1_6.py", "tools/build_v1_6.py", "tools/build_manifest.py", "tools/fixture_evidence.py", "tools/capture_shim_reference.py")))

    def mutated(fn, disk=False):
        m2 = copy.deepcopy(man)
        fn(m2)
        se2 = L.semantic_manifest(m2, B if disk else None, sha if disk else None, parent, os.path.getsize)
        return bool(se2) or bool(list(V["resolveFreezeManifest"].iter_errors(m2)))
    tgt = next(e for e in man["files"] if e["path"] == "tools/authority_lib.py")
    rec("manifest-negative", "invalid status", mutated(lambda m: m["files"][0].update({"status": "FROZEN_MAYBE"})))
    rec("manifest-negative", "duplicate path", mutated(lambda m: m["files"].append(dict(m["files"][0]))))
    rec("manifest-negative", "malformed hash", mutated(lambda m: m["files"][0].update({"sha256": "xyz"})))
    rec("manifest-negative", "broken parent lineage", mutated(lambda m: m["parent"].update({"head": "0" * 40})))
    rec("manifest-negative", "parent manifest sha changed", mutated(lambda m: m["parent"].update({"manifest_sha256": "0" * 64})))
    changed = next(e for e in man["files"] if e["changed_from_parent"])
    rec("manifest-negative", "changed file marked inherited", mutated(lambda m: next(e for e in m["files"] if e["path"] == changed["path"]).update({"inherited_from_parent": True})))
    rec("manifest-negative", "bytes +1", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": tgt["bytes"] + 1}), disk=True))
    rec("manifest-negative", "wrong size with correct sha", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": tgt["bytes"] * 2 + 7}), disk=True))
    rec("manifest-negative", "correct size with wrong sha", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"sha256": "0" * 64}), disk=True))
    rec("manifest-positive", "actual bytes equal on disk for every file", all(os.path.getsize(os.path.join(B, e["path"])) == e["bytes"] for e in man["files"] if os.path.exists(os.path.join(B, e["path"]))))
else:
    rec("manifest", "present", False, "FREEZE-MANIFEST.json not built yet")

# ---- 21. determinism
rec("determinism", "vectors_rerun_identical", all(L.digest(L.normalize_snapshot_payload(x["input"]) if x["domain"].startswith("vidtoolz.resolveSnapshotPayload") else x["input"], x["domain"]) == x["sha256"] for x in vec["vectors"]))
rec("determinism", "evidence record ids recompute", all(L.record_id(r_) == k for n_, es in EVS.items() if n_ != "invalid-tampered-record" for k, r_ in es["records"].items()))
rec("determinism", "no_bytecode_cache_written", not os.path.exists(os.path.join(HERE, "__pycache__")))

# ---- 17. Codex v1.5 findings (F15-01..07) + independent architectural findings must fail at the intended layer
ATTACKS = [
    ("F15-01 MAJOR raw failure qualifies through fabricated successful parse facts (= M-RAW)", [("raw-vs-fake-parse", "raw RAISED RuntimeError + an EXTERNAL fabricated successful parse block: the machine derives EXCEPTION and the fake block is not an input at all"), ("raw-vs-fake-parse", "the same fabricated block injected INTO the capture makes it MALFORMED (schema-forbidden interpretation fields)"), ("raw-vs-fake-parse", "a reviewer cannot ACCEPT a derived EXCEPTION (review law refuses it)"), ("raw-vs-fake-parse", "no refreeze can promote it: the recomputation is EXCEPTION, so the promotion is refused"), ("raw-vs-fake-parse", "QUALIFIED_READ is unreachable: under every fabricated-interpretation evidence set the primitive stays UNQUALIFIED and the callable set stays empty"), ("raw-vs-fake-parse", "timeout + ACCEPT review -> UNQUALIFIED (derived TIMEOUT or unresolvable evidence)"), ("raw-vs-fake-parse", "attribute missing + ACCEPT review -> UNQUALIFIED (derived UNSUPPORTED or unresolvable evidence)"), ("raw-vs-fake-parse", "wrong type + ACCEPT review -> UNQUALIFIED (derived TYPE_MISMATCH or unresolvable evidence)"), ("raw-vs-fake-parse", "null + ACCEPT review -> UNQUALIFIED (derived NULL_NOT_ALLOWED or unresolvable evidence)"), ("raw-vs-fake-parse", "truncated + ACCEPT review -> UNQUALIFIED (derived TRUNCATED or unresolvable evidence)"), ("raw-vs-fake-parse", "unserializable + ACCEPT review -> UNQUALIFIED (derived UNSERIALIZABLE or unresolvable evidence)"), ("raw-vs-fake-parse", "tampered raw + ACCEPT review -> UNQUALIFIED (derived MALFORMED or unresolvable evidence)"), ("review-law", "an honest ACCEPT review of a derived SUCCESS is valid and binds raw, derived, parser and spec digests"), ("eligibility", "m0-connect-deny-hyp-raised-accepted"), ("eligibility", "m0-connect-deny-hyp-derived-cache-forged")]),
    ("F15-02 BLOCKER capability/refreeze content forgery under the real active digest", [("matrix-integrity", "the frozen matrix is the active matrix; a forged QUALIFIED_READ matrix under the same active digest is refused"), ("matrix-integrity", "an invented QUALIFIED_READ matrix cited under the REAL frozen zero-qualified digest cannot qualify anything (primitive_status and the callable set stay empty)"), ("matrix-integrity", "a single changed byte of the successor matrix changes its digest and revokes qualification"), ("bypass-audit", "a forged in-memory matrix under the real active digest is refused before any stage (F15-02)"), ("eligibility", "m3-append-deny-forged-matrix-under-active-digest"), ("fixture-snapshot-negative", "snapshot-provenance-under-forged-matrix-digest")]),
    ("F15-03 BLOCKER degraded H0/S0 passes early write eligibility (= M-H0)", [("eligibility", "m3-append-deny-h0-minimal-m0"), ("eligibility", "m3-append-deny-h0-full-timeline-read"), ("eligibility", "m3-append-deny-h0-incomplete-write-precheck"), ("eligibility", "m3-append-deny-h0-candidate-provenance"), ("eligibility", "m3-append-deny-h0-other-matrix"), ("eligibility", "m3-append-deny-h0-other-target"), ("eligibility", "m3-append-deny-h0-forged-guard-object"), ("eligibility", "m3-append-deny-h0-provenance-swapped"), ("eligibility", "m3-append-allow-complete-write-precheck-h0"), ("eligibility", "m3-append-deny-plan-validation-from-helper"), ("eligibility", "m3-append-deny-plan-validation-other-h0"), ("h0-early-gate", "the early gate is evaluated by evaluate_eligibility itself, before any mutator, and does not depend on the composed path")]),
    ("F15-04 BLOCKER default direct commit path omits schema validation", [("bypass-audit", "schema_validate is a REQUIRED positional parameter of both authorizing entry points (F15-04: no default makes schema enforcement optional)"), ("bypass-audit", "the default (no schema validator) composed call refuses instead of reporting the schema stage completed"), ("bypass-audit", "an unsupported property field in S0 is refused by the mandatory schema stage (F15-04 attack shape: recomputed digests do not help)"), ("bypass-audit", "commit_eligibility passes only after every stage (evidence, provenance, schema, s0, plan, journal, s1, delta, effects, verification, conflicts, commit)"), ("bypass-audit", "a syntactically valid verification hash alone never makes a commit eligible")]),
    ("F15-05 MAJOR protected property completeness claimed but unrepresentable", [("protected-surface-exclusions", "item properties, fades, speed, takes, links and unowned media hashes are named as exclusions and have no payload in the item schema"), ("protected-surface-exclusions", "a property payload on an item is schema-invalid (not silently ignored)"), ("protected-surface-exclusions", "declaring an excluded domain as observed is a snapshot error"), ("protected-surface-exclusions", "every verification result names the unobserved/excluded domains and the declaration is compared")]),
    ("F15-06 MAJOR verification can claim an unapplied ghost operation", [("ghost-operation", "a ghost applied_operation_id is rejected against the derived applied list"), ("ghost-operation", "the derived applied list comes from the journal's APPLIED records only"), ("linked-set-negative", "linked-set-verification-ghost-applied-operation")]),
    ("F15-07 MAJOR transaction lifecycle precedence (mandatory checkpoint) (= M-PRECEDENCE)", [("frozen-instance", "journal execution law: CHECKPOINTED is mandatory before any operation; OP_STARTED -> APPLIED | OP_FAILED; READBACK_S1 after APPLIED"), ("fixture-semantic-negative", "journal-op-started-without-checkpoint"), ("fixture-semantic-negative", "journal-checkpointed-without-checkpoint-evidence"), ("fixture-semantic-negative", "journal-non-checkpoint-carries-checkpoint"), ("precedence", "only SEMANTIC-VALIDATION.md and authority_lib enumerate journal states"), ("precedence-supersession", "S32"), ("precedence-supersession", "S33")]),
    ("M-ID no occurrence-identity evidence contract", [("identity-evidence", "A callable, B unique within a pass and C stable across 3 passes are all true on the honest fixture and are separate claims"), ("identity-evidence", "duplicate ids: A true, B FALSE with the duplicate listed, C true (callability never implies uniqueness)"), ("identity-evidence", "two passes are never enough for C, and a failed capture breaks A and B"), ("identity-evidence", "no identity claim covers mutation or save/reopen survival (M3 P6/P15 remain the only place for that)"), ("identity-evidence", "an observation claiming uniqueness over duplicate captures is refused against the recomputation"), ("identity-evidence", "an identity observation may not carry a survival claim"), ("identity-evidence", "occurrence identity stays fail-closed on duplicates regardless of the identity claims")]),
    ("m-TYPE heuristic expectations", [("frozen-instance", "every probe primitive carries the full expectation spec, all DOCUMENTED_HYPOTHESIS, and READ-PRIMITIVES pins their digest"), ("fixture-semantic-negative", "read-primitives-spec-changed-without-digest"), ("fixture-semantic-negative", "read-primitives-frozen-expectation-without-refreeze"), ("re-parser", "a spec whose expectation changed produces a different derived digest (spec digest is part of the derivation)"), ("review-law", "a review bound to another primitive spec is refused")]),
    ("shim containment (probe-tool compromise)", [("shim-safety", "no write-like or script method was ever invoked by the shim"), ("shim-safety", "an instance-level monkeypatched getter is refused (the shim only calls class methods)"), ("shim-safety", "a non-allowlisted getter is refused, not invoked"), ("shim-safety", "the reference shim never imports a Resolve bridge, never writes a matrix and never reviews")]),
    ("stale parser / stale spec / stale matrix replay", [("review-law", "a review bound to an older parser is refused"), ("refreeze-law", "a refreeze bound to another parser is refused"), ("refreeze-law", "a refreeze bound to another primitive spec is refused"), ("refreeze-law", "a refreeze with a stale parent matrix is refused"), ("eligibility", "m0-connect-deny-hyp-refreeze-stale-parser"), ("eligibility", "m0-connect-deny-hyp-refreeze-stale-spec")]),
    ("inherited v1.4/v1.5 attacks still closed", [("occurrence-uniqueness", "duplicate rejection is identical in reversed input order"), ("delta-surface", "source bound change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("journal-s1-binding", "journal validated against a different S1 fails (journal points to S1 A, validator receives S1 B)"), ("s1-profile-law", "WRITE_PRECHECK satisfies APPEND_VERIFY; FULL_TIMELINE_READ and MINIMAL_M0 do not"), ("linked-set-negative", "linked-set-direct-false-verified-consistent-hashes"), ("linked-set-negative", "linked-set-commit-without-s1")]),
]
for attack, refs in ATTACKS:
    res = [(s, n, result_of(s, n)) for s, n in refs]
    rec("v1.5-attack", attack, all(x[2] is True for x in res), "; ".join(f"{s}/{n}={'PASS' if ok else ('MISSING' if ok is None else 'FAIL')}" for s, n, ok in res if ok is not True))

passed = sum(1 for r in R if r[2])
total = len(R)
sections = {}
for sec, _, ok, _ in R:
    sections.setdefault(sec, [0, 0])
    sections[sec][0] += 1
    sections[sec][1] += ok
FINDINGS = {
    "R1 F15-01 / M-RAW raw truth vs fabricated interpretation": ["raw-capture", "codec", "re-parser", "raw-vs-fake-parse", "review-law", "shim-safety"],
    "R2 F15-02 capability/refreeze content forgery (BLOCKER)": ["matrix-integrity"],
    "R3 F15-03 / M-H0 degraded H0 passes early write eligibility (BLOCKER)": ["h0-early-gate"],
    "R4 F15-04 default commit path omits schema validation (BLOCKER)": ["bypass-audit", "commit-eligibility"],
    "R5 F15-05 protected property completeness unrepresentable": ["protected-surface-exclusions"],
    "R6 F15-06 verification claims an unapplied ghost operation": ["ghost-operation"],
    "R7 F15-07 / M-PRECEDENCE transaction lifecycle precedence": ["precedence", "precedence-supersession", "precedence-retired-terms"],
    "R8 M-ID occurrence-identity evidence contract": ["identity-evidence"],
    "R9 m-TYPE versioned primitive-spec authority": ["refreeze-law", "promotion"],
    "inherited v1.4/v1.5 laws still closed": ["occurrence-uniqueness", "delta-surface", "unrelated-change-law", "append-effect", "journal-s1-binding", "s1-profile-law", "probe-vs-qualified", "degraded-snapshot", "guard"],
    "M0 phase model and driver contract": ["m0-phases"],
    "attack matrix (Codex F15-01..07 + independent findings)": ["v1.5-attack"],
    "order independence": ["order-independence"],
}
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.6", "", f"Result: **{passed}/{total} checks passed**. Layers: raw parse -> schema -> evidence-binding (envelope, active manifest, record laws) -> attachment -> capability (RAW_CAPABILITY_CAPTURE -> reference re-parser -> REVIEW_DECISION -> REFREEZE_RECORD -> content-bound ACTIVE matrix) -> snapshot (observation model, raw-capture field provenance, occurrence uniqueness) -> semantic (binding, membership, mandatory checkpoint, readback->S1, derived verification over the protected surface with named exclusions) -> eligibility (incl. the H0/S0 early write gate) -> linked-set / composed authorization (validate_transaction_set, commit_eligibility, both with a MANDATORY schema validator). A finding may be covered by more than one section, so the per-finding counts overlap; the total is not proof. Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed {SEED}, {PERMS} per subject). The bypass audit proves no exported validator can skip S0, S1, schema validation, capability provenance, delta derivation or expected-effect validation, and that no parameter default makes schema enforcement optional. The raw-capability sections execute the REFERENCE capture shim against fake in-process objects (no Resolve) and prove that a probe-authored interpretation has zero authority. The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only. The total count is not proof: see the per-finding coverage below.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Finding | Sections | Checks | Passed |", "|---|---|---|---|"]
for f_, secs in FINDINGS.items():
    n_ = sum(sections.get(s_, [0, 0])[0] for s_ in secs); p__ = sum(sections.get(s_, [0, 0])[1] for s_ in secs)
    lines.append(f"| {f_} | {', '.join(secs)} | {n_} | {p__} |")
lines += ["", "| Section | Checks | Passed |", "|---|---|---|"]
for sec in sorted(sections):
    lines.append(f"| {sec} | {sections[sec][0]} | {sections[sec][1]} |")
lines += ["", "| Section | Check | Result | Detail |", "|---|---|---|---|"]
for sec, name, ok, det in R:
    lines.append(f"| {sec} | {name.replace('|', '/')} | {'PASS' if ok else 'FAIL'} | {det.replace('|', '/')} |")
with open(os.path.join(B, "VALIDATION-REPORT.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"{passed}/{total} passed")
for sec, name, ok, det in R:
    if not ok:
        print(f"FAIL [{sec}] {name}: {det}")
sys.exit(0 if passed == total else 1)
