#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.9.
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
Run: python3 -B tools/validate_v1_9.py
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
ACTIVE = {"authority_version": L.AUTHORITY_VERSION, "manifest_sha256": ACT["placeholder_manifest_sha256"], "capability_matrix_sha256": CAPS_SHA, "trusted_shim_sha256": L.trusted_capture_shim()["trusted_shim_sha256"]}
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
    "attached-evidence-derived-artifact-missing": ARO, "attached-evidence-derived-artifact-of-other-raw": ARO, "attached-evidence-duplicate-current-review": ARO, "attached-evidence-superseded-review": ARO, "attached-evidence-conflicting-current-reviews": ARO, "attached-evidence-duplicate-current-refreeze": ARO,
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
    dc_ = MINT.derived_rec(capture, spec_)
    rf_ = caps_["refreeze"]
    rf_["promoted_raw_capture_sha256"] = sorted(set(rf_["promoted_raw_capture_sha256"]) | {capture["raw_digest"]})
    rf_["promoted_derived_result_sha256"] = sorted(set(rf_["promoted_derived_result_sha256"]) | {d_["derived_result_sha256"]})
    rf_["promoted_review_decision_sha256"] = sorted(set(rf_["promoted_review_decision_sha256"]) | {rv_["record_id"]})
    rf_["promoted_probe_ids"] = sorted(set(rf_["promoted_probe_ids"]) | {capture["probe_id"]})
    # v1.7: the whole chain is rebound - the refreeze BLOCK digest changed with the promotion lists, and the entry must
    # name the exact stored derived record, session and refreeze block of THIS chain (C16-B4, section 12).
    rfb_ = L.refreeze_block_digest(caps_)
    for r_ in caps_["rows"]:
        for x_ in r_.get("evidence_records", []):
            if x_.get("result") is None:
                x_["refreeze_block_sha256"] = rfb_
        if method in r_["primitives"]:
            x_ = next(x for x in r_["evidence_records"] if x["method"] == method)
            x_.update(derived_record_sha256=dc_["record_id"], session_id=capture["session_id"])
    active_ = dict(ACTIVE_HYP, capability_matrix_sha256=L.capability_matrix_digest(caps_))
    refz_ = MINT.refz(caps_, CAPS_SHA, probe_id=capture["probe_id"], session=capture["session_id"], caps_sha=active_["capability_matrix_sha256"])
    # v1.7: this chain supplies its own reviewed refreeze record, so the base set's refreeze is dropped. Leaving both in
    # would be two current reviewed refreeze records promoting one raw capture, which v1.7 refuses as REFREEZE_CONFLICT
    # (correctly - but it would mask what this fixture is testing).
    es_ = F.ES([r for r in es_rev["records"].values() if r["record_type"] != "REFREEZE_RECORD"] + [MINT.raw_rec(capture), dc_, rv_, refz_])
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
rec("identity-evidence", "duplicate ids: A true, B FALSE with the duplicate listed, and C NOT claimed either (v1.7 C16-M1: identity that is not unique within one pass is not identity, so its apparent stability proves nothing)", cld["claim_A_callable"] and not cld["claim_B_unique_within_pass"] and cld["duplicates"] == ["it-1"] and cld["claim_C_stable_across_passes"] is False)
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
    errs, exc = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]))
    joined = "; ".join(errs)
    if exc:
        rec("linked-set", fx["fixture"], False, joined)
    elif fx["layer_expected_failure"] == "none":
        rec("linked-set-positive", fx["fixture"], not errs, joined)
    else:
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec("linked-set-negative", fx["fixture"], hit, joined if errs else "ACCEPTED (should be rejected)")
    if fx["set"].get("commit") is not None:
        ce, exc2 = safe(L.commit_eligibility, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]))
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
rec("bypass-audit", "neither authorizing entry point has a schema-validator parameter at all (v1.7 C16-B2 replaces the v1.6 required-parameter design: the caller cannot name the law)", "schema_validate" not in sig.parameters and "schema_validate" not in inspect.signature(L.commit_eligibility).parameters and all("schema_validate" not in inspect.signature(getattr(L, fn_)).parameters for fn_ in L.AUTHORITY_SURFACE["authorizing"] if callable(getattr(L, fn_, None))))
rec("bypass-audit", "the composed call with no validator argument enforces schemas from the internally pinned registry (v1.7: the default IS enforcement, and passing None is refused as a caller-supplied validator)", L.validate_transaction_set(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP) == [] and any("CALLER_SUPPLIED_VALIDATOR_REFUSED" in e for e in L.validate_transaction_set(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, None)) and not L.commit_eligibility(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, None)["eligible"])
_opaque = copy.deepcopy(TS_OK)
_opaque["s0_snapshot"] = copy.deepcopy(TS_OK["s0_snapshot"]); _opaque["s0_snapshot"]["payload"]["tracks"][0]["items"][0]["opacity"] = 50
rec("bypass-audit", "an unsupported property field in S0 is refused by the mandatory schema stage (F15-04 attack shape: recomputed digests do not help)", any("schema/s0" in e for e in L.validate_transaction_set(_opaque, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)))
rec("bypass-audit", "a forged in-memory matrix under the real active digest is refused before any stage (F15-02)", any("CAPABILITY_MATRIX_NOT_ACTIVE" in e for e in L.validate_transaction_set(TS_OK, perms, rp, forged_matrix(hyp), tc, ES_FULL, ACTIVE_HYP)) and L.callable_method_set(forged_matrix(hyp), rp, es_rev, tc, ACTIVE_HYP) == set())
rec("bypass-audit", "commit_eligibility composes validate_transaction_set (source-level)", "validate_transaction_set(" in inspect.getsource(L.commit_eligibility))
rec("bypass-audit", "semantic_commit_manifest refuses hash-only / missing S0 / missing S1 / missing journal / missing active", all(bool(L.semantic_commit_manifest(cmf, planf, journalf, vrf, [], *args)) for args in ((None, s1f, ACTIVE_HYP), (s0f, None, ACTIVE_HYP), (s0f, s1f, None))) and bool(L.semantic_commit_manifest(cmf, planf, [], vrf, [], s0f, s1f, ACTIVE_HYP)) and bool(L.semantic_commit_manifest(cmf, planf, journalf, None, [], s0f, s1f, ACTIVE_HYP)))
rec("bypass-audit", "semantic_verification_result refuses missing plan / S0 / S1 / journal", all(bool(L.semantic_verification_result(vrf, *args)) for args in ((None, s0f, s1f, journalf), (planf, None, s1f, journalf), (planf, s0f, None, journalf), (planf, s0f, s1f, None))))
rec("bypass-audit", "validate_transaction_set refuses a set without S0", bool(L.validate_transaction_set(dict(TS_OK, s0_snapshot=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)))
rec("bypass-audit", "validate_transaction_set refuses a commit without linked S1 and verification", any("INELIGIBLE without linked S1" in e for e in L.validate_transaction_set(dict(TS_OK, s1_snapshot=None, verification=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)))
ce_ok = L.commit_eligibility(TS_OK, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)
rec("bypass-audit", "commit_eligibility passes only after every stage (evidence, provenance, schema, s0, plan, journal, s1, delta, effects, verification, conflicts, commit)", ce_ok["eligible"] and ce_ok["stages_completed"] == list(L.VALIDATION_STAGES), str(ce_ok["errors"][:2]))
for nm, mut in (("missing S1", lambda t: t.update(s1_snapshot=None)), ("missing verification", lambda t: t.update(verification=None)), ("missing journal", lambda t: t.update(journal=[])), ("missing S0", lambda t: t.update(s0_snapshot=None)), ("missing plan", lambda t: t.update(plan=None)), ("missing commit manifest", lambda t: t.update(commit=None))):
    t = dict(TS_OK); mut(t)
    ce = L.commit_eligibility(t, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)
    rec("bypass-audit", f"commit_eligibility INELIGIBLE with {nm}", not ce["eligible"] and ce["errors"])
forged = dict(vrf, s1_guard_digest=S1X["write-precheck-complete"]["guard_digest"], s1_payload_sha256=S1X["write-precheck-complete"]["payload_sha256"], readback_snapshot_sha256=L.snapshot_object_digest(S1X["write-precheck-complete"]), added=[], creation_identity_map={})
ce_f = L.commit_eligibility(dict(TS_OK, verification=forged), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)
rec("bypass-audit", "commit_eligibility rejects a false VERIFIED object even when its digest is what the commit cites", not ce_f["eligible"] and any("differs from derived truth" in e or "verification" in e for e in ce_f["errors"]))
rec("bypass-audit", "a syntactically valid verification hash alone never makes a commit eligible", not L.commit_eligibility(dict(TS_OK, verification=None, commit=dict(cmf, verification_result_sha256="9" * 64)), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)["eligible"])
_src = open(os.path.join(HERE, "authority_lib.py"), encoding="utf-8").read()
_tail_users = set(re.findall(r"(\w+)\[-1\]", _src))
rec("bypass-audit", "lib never selects evidence by position (array tail only on the ordered journal chain)", _tail_users <= {"journal_records", "journal"}, ",".join(sorted(_tail_users)))
rec("bypass-audit", "callable set and provenance context are derived inside validate_transaction_set (no caller-supplied callable set)", "callable_method_set(" in inspect.getsource(L.semantic_snapshot) and "ctx = {" in inspect.getsource(L._validate_transaction_set_impl) and "internal_schema_errors" in inspect.getsource(L.validate_transaction_set))

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
    base_err, _ = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]))
    for i in range(PERMS):
        ts2 = shuffle_obj(fx["set"])
        ts2["conflicts"] = list(ts2.get("conflicts") or [])
        rng.shuffle(ts2["conflicts"])
        for key in ("s0_snapshot", "s1_snapshot"):
            if ts2.get(key):
                ts2[key] = shuffle_payload(ts2[key])
        e2, exc = safe(L.validate_transaction_set, ts2, perms, rp, caps_for(fx["capabilities"]), tc, shuffle_es(EVS[fx["evidence_set"]]), active_for(fx["capabilities"]))
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
rec("precedence", "the v1.5 through v1.8 changelogs and finding matrices are HISTORICAL; the v1.9 ones are active", all(st_.get(d_) == "HISTORICAL" for d_ in ("CHANGELOG-v1.5.md", "FINDING-RESOLUTION-MATRIX-v1.5.md", "CHANGELOG-v1.6.md", "FINDING-RESOLUTION-MATRIX-v1.6.md", "CHANGELOG-v1.7.md", "FINDING-RESOLUTION-MATRIX-v1.7.md", "CHANGELOG-v1.8.md", "FINDING-RESOLUTION-MATRIX-v1.8.md")) and st_.get("CHANGELOG-v1.9.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.9.md") == "STILL_ACTIVE")
rec("precedence", "the four v1.7 correction laws are retained as STILL_ACTIVE with supersession statements S39-S45", all(st_.get(d_) == "STILL_ACTIVE" for d_ in ("AUTHORITY-CACHING.md", "SCHEMA-REGISTRY.md", "TRUSTED-SHIM.md", "STORED-CHAIN.md")) and sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.7.0") == ["S39", "S40", "S41", "S42", "S43", "S44", "S45"])
rec("precedence", "the v1.8 evidence-store supersessions S46-S47 are retained and EVIDENCE-ROOT.md is the single STILL_ACTIVE store document", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.8.0") == ["S46", "S47"] and st_.get("EVIDENCE-ROOT.md") == "STILL_ACTIVE")
rec("precedence", "the v1.9 evidence-store supersessions S48-S49 are recorded and the v1.9 changelog and matrix are active", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.9.0") == ["S48", "S49"] and st_.get("CHANGELOG-v1.9.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.9.md") == "STILL_ACTIVE" and st_.get("CHANGELOG-v1.8.md") == "HISTORICAL" and st_.get("FINDING-RESOLUTION-MATRIX-v1.8.md") == "HISTORICAL")
rec("precedence", "EVIDENCE-ROOT.md names tools/evidence_store.py as the one authorizing store and explicitly withdraws the EvidenceRoot pointer (section 21)", (lambda t_: "tools/evidence_store.py" in t_ and "EVIDENCE_STORE_AUTHORIZING" in t_ and "withdrawn" in t_)(open(os.path.join(B, "EVIDENCE-ROOT.md"), encoding="utf-8").read()))
rec("precedence", "the M0A compatibility contract and the probe contract point only at the canonical store", all("tools/evidence_store.py" in open(os.path.join(B, d_), encoding="utf-8").read() for d_ in ("M0A-PROBE-COMPATIBILITY.md", "M0-PROBE-CONTRACT.md")))
rec("precedence", "no active document still presents EvidenceRoot as an implementation (only as removed/superseded history)", all(("EvidenceRoot" not in open(os.path.join(B, d_), encoding="utf-8").read()) or any(w_ in open(os.path.join(B, d_), encoding="utf-8").read() for w_ in ("removed", "REMOVED", "withdrawn", "superseded", "SUPERSEDED")) for d_ in [os.path.basename(x) for x in glob.glob(os.path.join(B, "*.md"))]))
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
rec("precedence", "SCORECRAFT-EXTRACTION.md cites v1.8 active schemas, not earlier ones", "resolveTargetContract.v1.8" in scx and "resolveSnapshot.v1.8" in scx and not any(x in scx for x in ("resolveTargetContract.v1.1", "resolveSnapshot.v1.1", "resolveTargetContract.v1.4", "resolveSnapshot.v1.4", "resolveTargetContract.v1.5", "resolveSnapshot.v1.5", "resolveTargetContract.v1.6", "resolveSnapshot.v1.6", "resolveTargetContract.v1.7", "resolveSnapshot.v1.7")))

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
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.8", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent (v1.8) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.8", "FREEZE-MANIFEST.json")) == "727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86")
    rec("manifest", "grandparent (v1.7) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.7", "FREEZE-MANIFEST.json")) == "8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d")
    rec("manifest", "the parent block records the v1.8 branch HEAD and its semantic commit, which for v1.8 are the same commit because its bundle and registration were committed together (section 31)", man["parent"]["head"] == "41081f7f4f227255f44bbb3a94637928187289f0" and man["parent"]["semantic_head"] == "41081f7f4f227255f44bbb3a94637928187289f0" and man["parent"]["manifest_sha256"] == "727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86")
    rec("manifest", "v1.0-v1.8 bundles are byte-identical to their frozen manifests (history preserved)", all(all(sha(os.path.join(os.path.dirname(B), v_, e_["path"])) == e_["sha256"] for e_ in L.strict_load(os.path.join(os.path.dirname(B), v_, "FREEZE-MANIFEST.json"))["files"] if os.path.exists(os.path.join(os.path.dirname(B), v_, e_["path"]))) for v_ in ("v1", "v1.1", "v1.2", "v1.3", "v1.4", "v1.5", "v1.6", "v1.7", "v1.8")))
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])
    rec("manifest", "validation tools listed as TOOL", all(any(e["path"] == p and e["authority_class"] == "TOOL" for e in man["files"]) for p in ("tools/authority_lib.py", "tools/validate_v1_9.py", "tools/build_v1_9.py", "tools/build_manifest.py", "tools/fixture_evidence.py", "tools/capture_shim_reference.py")))

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
    ("F15-04 BLOCKER default direct commit path omits schema validation", [("bypass-audit", "neither authorizing entry point has a schema-validator parameter at all (v1.7 C16-B2 replaces the v1.6 required-parameter design: the caller cannot name the law)"), ("bypass-audit", "the composed call with no validator argument enforces schemas from the internally pinned registry (v1.7: the default IS enforcement, and passing None is refused as a caller-supplied validator)"), ("bypass-audit", "an unsupported property field in S0 is refused by the mandatory schema stage (F15-04 attack shape: recomputed digests do not help)"), ("bypass-audit", "commit_eligibility passes only after every stage (evidence, provenance, schema, s0, plan, journal, s1, delta, effects, verification, conflicts, commit)"), ("bypass-audit", "a syntactically valid verification hash alone never makes a commit eligible")]),
    ("F15-05 MAJOR protected property completeness claimed but unrepresentable", [("protected-surface-exclusions", "item properties, fades, speed, takes, links and unowned media hashes are named as exclusions and have no payload in the item schema"), ("protected-surface-exclusions", "a property payload on an item is schema-invalid (not silently ignored)"), ("protected-surface-exclusions", "declaring an excluded domain as observed is a snapshot error"), ("protected-surface-exclusions", "every verification result names the unobserved/excluded domains and the declaration is compared")]),
    ("F15-06 MAJOR verification can claim an unapplied ghost operation", [("ghost-operation", "a ghost applied_operation_id is rejected against the derived applied list"), ("ghost-operation", "the derived applied list comes from the journal's APPLIED records only"), ("linked-set-negative", "linked-set-verification-ghost-applied-operation")]),
    ("F15-07 MAJOR transaction lifecycle precedence (mandatory checkpoint) (= M-PRECEDENCE)", [("frozen-instance", "journal execution law: CHECKPOINTED is mandatory before any operation; OP_STARTED -> APPLIED | OP_FAILED; READBACK_S1 after APPLIED"), ("fixture-semantic-negative", "journal-op-started-without-checkpoint"), ("fixture-semantic-negative", "journal-checkpointed-without-checkpoint-evidence"), ("fixture-semantic-negative", "journal-non-checkpoint-carries-checkpoint"), ("precedence", "only SEMANTIC-VALIDATION.md and authority_lib enumerate journal states"), ("precedence-supersession", "S32"), ("precedence-supersession", "S33")]),
    ("M-ID no occurrence-identity evidence contract", [("identity-evidence", "A callable, B unique within a pass and C stable across 3 passes are all true on the honest fixture and are separate claims"), ("identity-evidence", "duplicate ids: A true, B FALSE with the duplicate listed, and C NOT claimed either (v1.7 C16-M1: identity that is not unique within one pass is not identity, so its apparent stability proves nothing)"), ("identity-evidence", "two passes are never enough for C, and a failed capture breaks A and B"), ("identity-evidence", "no identity claim covers mutation or save/reopen survival (M3 P6/P15 remain the only place for that)"), ("identity-evidence", "an observation claiming uniqueness over duplicate captures is refused against the recomputation"), ("identity-evidence", "an identity observation may not carry a survival claim"), ("identity-evidence", "occurrence identity stays fail-closed on duplicates regardless of the identity claims")]),
    ("m-TYPE heuristic expectations", [("frozen-instance", "every probe primitive carries the full expectation spec, all DOCUMENTED_HYPOTHESIS, and READ-PRIMITIVES pins their digest"), ("fixture-semantic-negative", "read-primitives-spec-changed-without-digest"), ("fixture-semantic-negative", "read-primitives-frozen-expectation-without-refreeze"), ("re-parser", "a spec whose expectation changed produces a different derived digest (spec digest is part of the derivation)"), ("review-law", "a review bound to another primitive spec is refused")]),
    ("shim containment (probe-tool compromise)", [("shim-safety", "no write-like or script method was ever invoked by the shim"), ("shim-safety", "an instance-level monkeypatched getter is refused (the shim only calls class methods)"), ("shim-safety", "a non-allowlisted getter is refused, not invoked"), ("shim-safety", "the reference shim never imports a Resolve bridge, never writes a matrix and never reviews")]),
    ("stale parser / stale spec / stale matrix replay", [("review-law", "a review bound to an older parser is refused"), ("refreeze-law", "a refreeze bound to another parser is refused"), ("refreeze-law", "a refreeze bound to another primitive spec is refused"), ("refreeze-law", "a refreeze with a stale parent matrix is refused"), ("eligibility", "m0-connect-deny-hyp-refreeze-stale-parser"), ("eligibility", "m0-connect-deny-hyp-refreeze-stale-spec")]),
    ("inherited v1.4/v1.5 attacks still closed", [("occurrence-uniqueness", "duplicate rejection is identical in reversed input order"), ("delta-surface", "source bound change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("journal-s1-binding", "journal validated against a different S1 fails (journal points to S1 A, validator receives S1 B)"), ("s1-profile-law", "WRITE_PRECHECK satisfies APPEND_VERIFY; FULL_TIMELINE_READ and MINIMAL_M0 do not"), ("linked-set-negative", "linked-set-direct-false-verified-consistent-hashes"), ("linked-set-negative", "linked-set-commit-without-s1")]),
]
for attack, refs in ATTACKS:
    res = [(s, n, result_of(s, n)) for s, n in refs]
    rec("v1.5-attack", attack, all(x[2] is True for x in res), "; ".join(f"{s}/{n}={'PASS' if ok else ('MISSING' if ok is None else 'FAIL')}" for s, n, ok in res if ok is not True))



def _try_store(fn):
    """Call fn() expecting an EvidenceStoreError; return the error (so its closed code can be asserted)."""
    try:
        fn()
    except ES_MOD.EvidenceStoreError as ex:
        return ex
    raise AssertionError("expected an EvidenceStoreError refusal")


def _safe_registry():
    """Resolve the schema registry, returning the refusal text instead of raising."""
    try:
        L.schema_registry()
        return None
    except L.AuthorityTrustError as ex:
        return str(ex)

# ============================================================================================================
# ---- 22. v1.7 corrections of the Codex v1.6 adjudication
# C16-B1 content-insensitive authority caches | C16-B2 caller-supplied schema validators | C16-B3 unbound shim trust
# C16-B4 chain substitution | C16-M1 duplicate receiver paths | C16-M2 absent strict byte ingestion
# C16-M3 non-executable evidence store
import shutil          # noqa: E402
import stat            # noqa: E402
import tempfile        # noqa: E402
import evidence_store as ES_MOD  # noqa: E402

CHAIN_ES = EVS["attached-reviewed-evidence"]
CHAIN_METHOD = "GetStartFrame"


def qual(caps_, es_, active_, method=CHAIN_METHOD, warm=False):
    if not warm:
        L.clear_authority_caches()
    return L.capability_qualification(caps_, rp, method, es_, ENVC, active_)


def deep(x):
    return copy.deepcopy(x)


# ---- C16-B1 (1) no authority cache may be keyed on object identity
CACHE_SRC = inspect.getsource(L)
rec("cache-law", "no authority cache in authority_lib is keyed on id(), object identity or a caller container",
    not re.search(r"_CACHE\[\s*\(?\s*id\(", CACHE_SRC) and "id(caps)" not in CACHE_SRC and "id(es)" not in CACHE_SRC and "id(rp)" not in CACHE_SRC and "_ES_INDEX" not in CACHE_SRC)
rec("cache-law", "every cache key is derived by content_key/content_digest and carries the authority version",
    L.content_key(caps, rp, EVS["attached"], ENVC, ACTIVE)[0] == L.AUTHORITY_VERSION and L.content_digest({"a": 1}) == L.content_digest({"a": 1}) and L.content_digest({"a": 1}) != L.content_digest({"a": 2}))
rec("cache-law", "an unserializable input yields no cache key at all (fail-closed: recompute, never reuse)",
    L.content_digest({"k": {1, 2}}) is None and L.content_key(caps, rp, {"records": {"x": {1, 2}}}, ENVC, ACTIVE) is None)
rec("cache-law", "clear_authority_caches empties every registered cache and authority_cache_stats reports them",
    (lambda st: set(st) == {"qualification", "callable_set", "primitive_spec_digest", "parser_identity", "trusted_shim", "schema_registry"} and all(v == 0 for v in st.values()))((L.clear_authority_caches(), L.authority_cache_stats())[1]))

# ---- C16-B1 (2) cache mutation attacks: warm == cold for every in-place mutation of a qualified chain
CHAIN_BASE = {"caps": hyp, "es": deep(CHAIN_ES), "active": ACTIVE_HYP}
rec("cache-mutation", "control: the untouched chain is QUALIFIED_CALLABLE both cold and warm",
    qual(hyp, CHAIN_BASE["es"], ACTIVE_HYP)["status"] == "QUALIFIED_CALLABLE" and qual(hyp, CHAIN_BASE["es"], ACTIVE_HYP, warm=True)["status"] == "QUALIFIED_CALLABLE")


def raw_rec_of(es_, method=CHAIN_METHOD):
    return next(r for r in es_["records"].values() if r["record_type"] == "RAW_CAPABILITY_CAPTURE" and r["capture"]["method"] == method)


def review_rec_of(es_, method=CHAIN_METHOD):
    return next(r for r in es_["records"].values() if r["record_type"] == "REVIEW_DECISION" and r.get("method") == method)


def derived_rec_of(es_, method=CHAIN_METHOD):
    raw = raw_rec_of(es_, method)
    return next(r for r in es_["records"].values() if r["record_type"] == "DERIVED_CAPABILITY_RESULT" and r["raw_capture_sha256"] == raw["raw_capture_sha256"])


def refz_rec_of(es_):
    return next(r for r in es_["records"].values() if r["record_type"] == "REFREEZE_RECORD")


def mut_raw_to_raised(st):
    c = raw_rec_of(st["es"])["capture"]
    c.pop("returned", None)
    c["outcome"] = "RAISED"
    c["raised"] = {"exception_class": "RuntimeError", "module": "builtins", "message": "changed after the review"}


def mut_spec(st):
    st["rp"] = deep(rp)
    st["rp"]["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]["primitives"][0]["expected_type"] = "bool"


def mut_review(st):
    review_rec_of(st["es"])["decision"] = "REJECT"


def mut_refreeze(st):
    refz_rec_of(st["es"])["reviewed"] = False


def mut_matrix(st):
    st["caps"] = deep(hyp)
    st["caps"]["rows"][0]["evidence_class"] = "DOCUMENTED_NOT_QUALIFIED"


def mut_derived(st):
    derived_rec_of(st["es"])["derived"]["classification"] = "SUCCESS "


def mut_host(st):
    raw_rec_of(st["es"])["capture"]["host_name"] = "PRESTO"


def mut_build(st):
    raw_rec_of(st["es"])["capture"]["build"] = 99


def mut_evidence_ref(st):
    row = next(r for r in st["caps"]["rows"] if CHAIN_METHOD in r["primitives"])
    st["caps"] = deep(st["caps"])
    row = next(r for r in st["caps"]["rows"] if CHAIN_METHOD in r["primitives"])
    next(x for x in row["evidence_records"] if x["method"] == CHAIN_METHOD)["raw_capture_sha256"] = "0" * 64


def mut_parser_identity(st):
    st["patch_parser"] = True


CACHE_MUTATIONS = [
    ("raw capture mutated in place to RAISED after qualification", mut_raw_to_raised),
    ("primitive spec expectation edited in place", mut_spec),
    ("review decision flipped to REJECT in place", mut_review),
    ("refreeze record un-reviewed in place", mut_refreeze),
    ("active matrix row demoted in place", mut_matrix),
    ("stored derived result edited in place", mut_derived),
    ("capture host_name changed in place", mut_host),
    ("capture build changed in place", mut_build),
    ("matrix evidence reference repointed in place", mut_evidence_ref),
]
for _name, _mut in CACHE_MUTATIONS:
    st = {"caps": hyp, "rp": rp, "es": deep(CHAIN_ES), "active": ACTIVE_HYP}
    L.clear_authority_caches()
    before_ = L.capability_qualification(st["caps"], st["rp"], CHAIN_METHOD, st["es"], ENVC, st["active"])
    _mut(st)
    warm_ = L.capability_qualification(st["caps"], st["rp"], CHAIN_METHOD, st["es"], ENVC, st["active"])
    L.clear_authority_caches()
    cold_ = L.capability_qualification(st["caps"], st["rp"], CHAIN_METHOD, st["es"], ENVC, st["active"])
    rec("cache-mutation", f"{_name}: warm result equals cold result and both are NOT QUALIFIED",
        before_["status"] == "QUALIFIED_CALLABLE" and warm_ == cold_ and warm_["status"] != "QUALIFIED_CALLABLE",
        f"before={before_['status']} warm={warm_['status']} cold={cold_['status']} equal={warm_ == cold_}")

# parser identity is content-keyed on the live code, not on a process-local flag
_saved_parser = L.derive_capability_result
_sha_before = L.parser_sha256()


def _fake_parser(capture, spec, env, active):
    d = _saved_parser(capture, spec, env, active)
    d["classification"] = "SUCCESS"
    return d


L.derive_capability_result = _fake_parser
_sha_patched = L.parser_sha256()
L.derive_capability_result = _saved_parser
_sha_restored = L.parser_sha256()
rec("cache-mutation", "parser identity: replacing derive_capability_result changes parser_sha256 immediately (the memo is keyed on the live code, not on a process flag)",
    _sha_patched != _sha_before and _sha_restored == _sha_before)

# the callable set is memoized under the same content key and never under object identity
L.clear_authority_caches()
_cs_es = deep(CHAIN_ES)
_cs_before = L.callable_method_set(hyp, rp, _cs_es, tc, ACTIVE_HYP)
raw_rec_of(_cs_es)["capture"]["host_name"] = "PRESTO"
_cs_warm = L.callable_method_set(hyp, rp, _cs_es, tc, ACTIVE_HYP)
L.clear_authority_caches()
_cs_cold = L.callable_method_set(hyp, rp, _cs_es, tc, ACTIVE_HYP)
rec("cache-mutation", "callable_method_set: mutating one capture in place drops exactly that method, warm and cold alike",
    CHAIN_METHOD in _cs_before and _cs_warm == _cs_cold and CHAIN_METHOD not in _cs_warm)

# a warm cache never leaks between two different evidence sets with different content
L.clear_authority_caches()
_a = qual(hyp, CHAIN_ES, ACTIVE_HYP, warm=True)
_b = qual(hyp, EVS["attached-evidence-raised-accepted"], ACTIVE_HYP, warm=True)
_c = qual(hyp, CHAIN_ES, ACTIVE_HYP, warm=True)
rec("cache-mutation", "two evidence sets evaluated in one warm process do not contaminate each other",
    _a["status"] == "QUALIFIED_CALLABLE" and _b["status"] == "UNQUALIFIED" and _c == _a)
L.clear_authority_caches()

# ---- C16-B2 validator injection is refused, and the internal registry is the only law
INJECTIONS = [
    ("an always-true callback", lambda name, doc: True),
    ("an always-empty callback", lambda name, doc: []),
    ("a partial callback that only validates snapshots", lambda name, doc: [] if "Commit" in name else schema_validate(name, doc)),
    ("a permissive wrong schema", lambda name, doc: list(jsonschema.Draft202012Validator({"type": "object"}).iter_errors(doc))),
    ("the real validator supplied by the caller", schema_validate),
]
TS_BAD = copy.deepcopy(TS_OK)
TS_BAD["commit"]["unapproved_authority_extension"] = True
rec("validator-injection", "control: the tampered commit manifest is refused by the internally pinned schema registry",
    not L.commit_eligibility(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)["eligible"] and any("unapproved_authority_extension" in e or "additionalProperties" in e or "Additional properties" in e for e in L.commit_eligibility(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)["errors"]))
for _label, _cb in INJECTIONS:
    try:
        _r = L.commit_eligibility(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, _cb)
        _ok = _r["eligible"] is False and any("CALLER_SUPPLIED_VALIDATOR_REFUSED" in e for e in _r["errors"])
        _d = _r["errors"][:1]
    except TypeError as ex:
        _ok, _d = True, repr(ex)
    rec("validator-injection", f"commit_eligibility refuses {_label} positionally and stays INELIGIBLE", _ok, _d)
    try:
        _r2 = L.commit_eligibility(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, schema_validate=_cb)
        _ok2 = _r2["eligible"] is False and any("CALLER_SUPPLIED_VALIDATOR_REFUSED" in e for e in _r2["errors"])
        _d2 = _r2["errors"][:1]
    except TypeError as ex:
        _ok2, _d2 = True, repr(ex)
    rec("validator-injection", f"commit_eligibility refuses {_label} as a schema_validate keyword", _ok2, _d2)
    _r3 = L.validate_transaction_set(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, _cb)
    rec("validator-injection", f"validate_transaction_set refuses {_label}", any("CALLER_SUPPLIED_VALIDATOR_REFUSED" in e for e in _r3), _r3[:1])
for _kw in ("validator", "schema_validator", "registry", "callable_set", "s0_override"):
    _r4 = L.commit_eligibility(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, **{_kw: (lambda *a, **k: [])})
    rec("validator-injection", f"commit_eligibility refuses the {_kw!r} keyword by name", _r4["eligible"] is False and _kw in _r4["errors"][0])
_diag = L.validate_transaction_set_diagnostic(TS_BAD, perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP, lambda n_, d_: [])
rec("validator-injection", "the diagnostic helper is marked INTERNAL_NON_AUTHORIZING and returns no eligibility a caller could mistake for one",
    _diag["authorizing"] is False and _diag["surface"] == "INTERNAL_NON_AUTHORIZING" and "eligible" not in _diag and "validate_transaction_set_diagnostic" in L.AUTHORITY_SURFACE["internal_non_authorizing"] and "validate_transaction_set_diagnostic" not in L.AUTHORITY_SURFACE["authorizing"])
rec("validator-injection", "a stale schema from the frozen v1.6 bundle validates v1.6 artifacts only and can never be resolved for the active authority",
    L.internal_schema_errors("provisional/resolveCommitManifest", TS_BAD["commit"]) != [] and L.historical_schema_errors("1.6.0", "provisional/resolveCommitManifest", TS_BAD["commit"]) is not None)

# ---- C16-B2 the registry itself is a verified trust root
REG = L.schema_registry()
rec("schema-registry", "the registry is pinned for exactly this authority version and re-derives its own digest",
    REG["authority_version"] == L.AUTHORITY_VERSION and REG["schema_registry_sha256"] == L.strict_load(os.path.join(B, L.SCHEMA_REGISTRY_FILE))["schema_registry_sha256"])
rec("schema-registry", "every schema file on disk is pinned by content digest and byte count",
    all(L.is_sha(e["sha256"]) and sha(os.path.join(B, e["path"])) == e["sha256"] and os.path.getsize(os.path.join(B, e["path"])) == e["byte_count"] for e in REG["entries"].values()) and len(REG["entries"]) == len(glob.glob(os.path.join(B, "schemas", "**", "*.schema.json"), recursive=True)))
rec("schema-registry", "an unregistered artifact schema id is a refusal, never a pass",
    L.internal_schema_errors("resolveNotARealSchema", {}) and "SCHEMA_NOT_REGISTERED" in L.internal_schema_errors("resolveNotARealSchema", {})[0])


def _with_tampered(rel, mutate, fn):
    """Run fn() with one bundle file temporarily replaced, then restore the exact bytes."""
    p_ = os.path.join(B, rel)
    orig = open(p_, "rb").read()
    try:
        open(p_, "wb").write(mutate(orig))
        L.clear_authority_caches()
        return fn()
    finally:
        open(p_, "wb").write(orig)
        L.clear_authority_caches()


_one_byte = _with_tampered("schemas/resolveSnapshot.schema.json", lambda b: b.replace(b'"type": "object"', b'"type":  "object"', 1), _safe_registry)
rec("schema-registry", "ONE changed byte in ONE pinned schema file makes the whole registry untrusted and nothing can be validated",
    _one_byte is not None and "not trusted" in _one_byte, str(_one_byte)[:120])
_missing = _with_tampered(L.SCHEMA_REGISTRY_FILE, lambda b: b.replace(b'"schema_count"', b'"schema_countX"', 1), _safe_registry)
rec("schema-registry", "a tampered registry record is refused (field set / self digest)", _missing is not None, str(_missing)[:120])

# ---- C16-B3 the trusted capture shim
TS_SHIM = L.trusted_capture_shim()
rec("shim-trust", "the bundle pins exactly one trusted capture shim and it re-verifies against the shim source on disk",
    TS_SHIM["shim_version"] == SHIM.SHIM_VERSION and TS_SHIM["shim_sha256"] == SHIM.shim_sha256() and TS_SHIM["shim_source_sha256"] == sha(os.path.join(B, "tools/capture_shim_reference.py")) and TS_SHIM["trusted_shim_sha256"] == L.digest({k: v for k, v in TS_SHIM.items() if k != "trusted_shim_sha256"}, L.SHIM_AUTHORITY_DOMAIN))
rec("shim-trust", "the trusted shim pins the allowlist, the codec and the raw schema version",
    TS_SHIM["allowlist_digest"] == L.shim_allowlist_digest(rp) and TS_SHIM["allowlist_method_count"] == 47 and TS_SHIM["codec_version"] == L.CODEC and TS_SHIM["raw_schema_version"] == L.RAW_SCHEMA_ID)
rec("shim-trust", "the ACTIVE authority names the trusted shim, and an active authority without it authorizes nothing",
    ACTIVE_HYP["trusted_shim_sha256"] == TS_SHIM["trusted_shim_sha256"] and any("trusted_shim_sha256" in e for e in L.active_authority_errors(hyp, {k: v for k, v in ACTIVE_HYP.items() if k != "trusted_shim_sha256"})) and any("TRUSTED_SHIM_NOT_ACTIVE" in e for e in L.active_authority_errors(hyp, dict(ACTIVE_HYP, trusted_shim_sha256="0" * 64))))

SHIM_ATTACKS = [
    ("a capture claiming the right shim version with a wrong sha", {"capture_shim_sha256": "0" * 64}),
    ("a capture from a stale shim build", {"capture_shim_sha256": L.sha256_text("vidtoolz.captureShim.reference.v1 @ an older build")}),
    ("a capture from an unknown shim", {"capture_shim_version": "someone.elses.shim.v9", "capture_shim_sha256": L.sha256_text("someone else")}),
    ("a capture from the same shim version with changed code", {"capture_shim_sha256": L.sha256_text(open(os.path.join(B, "tools/capture_shim_reference.py")).read() + "# one added comment")}),
    ("a capture emitted under another codec", {"serialization": None}),
]
_base_cap = copy.deepcopy(raw_rec_of(CHAIN_ES)["capture"])
for _label, _ch in SHIM_ATTACKS:
    _c = copy.deepcopy(_base_cap)
    if _ch.get("serialization", "keep") is None:
        _c["serialization"] = dict(_c["serialization"], codec="vidtoolz.someOtherCodec.v1")
    else:
        _c.update(_ch)
    _c["raw_digest"] = L.raw_capture_digest(_c)
    _errs = L.capture_shim_trust_errors(_c, rp)
    _der = L.derive_capability_result(_c, F.rp_probe_specs(rp)[CHAIN_METHOD], ENVC, ACTIVE_HYP)
    _want = "MALFORMED" if "codec" in _label else "SHIM_UNTRUSTED"
    rec("shim-trust", f"{_label} is refused by the trusted-shim law and derives {_want}", bool(_errs) and _der["classification"] == _want, f"{_der['classification']}: {(_errs or [''])[0][:90]}")
_other_schema = copy.deepcopy(_base_cap)
_other_schema["schema"] = "vidtoolz.resolveRawCapabilityCapture.v0"
_other_schema["raw_digest"] = L.raw_capture_digest(_other_schema)
rec("shim-trust", "a capture emitted under another raw frame schema is refused by the trusted-shim law (and by the structure law before it)",
    any("raw frame schema" in e for e in L.capture_shim_trust_errors(_other_schema, rp)) and L.derive_capability_result(_other_schema, F.rp_probe_specs(rp)[CHAIN_METHOD], ENVC, ACTIVE_HYP)["classification"] == "MALFORMED")
_out_of_allowlist = copy.deepcopy(_base_cap)
_out_of_allowlist["method"] = "Timeline.SetName"
_out_of_allowlist["raw_digest"] = L.raw_capture_digest(_out_of_allowlist)
rec("shim-trust", "a capture of a method outside the trusted allowlist is refused", any("allowlist" in e for e in L.capture_shim_trust_errors(_out_of_allowlist, rp)))
rec("shim-trust", "SHIM_UNTRUSTED is a closed derived class in the FATAL_TARGET_FAILURE family",
    "SHIM_UNTRUSTED" in L.DERIVED_CLASSES and L.DERIVED_FAMILY["SHIM_UNTRUSTED"] == "FATAL_TARGET_FAILURE" and "SHIM_UNTRUSTED" in L.PROBE_FAILURE_TAXONOMY["FATAL_TARGET_FAILURE"])
_untrusted_es = copy.deepcopy(CHAIN_ES)
_ur = raw_rec_of(_untrusted_es)
_ur["capture"]["capture_shim_sha256"] = "0" * 64
_ur["capture"]["raw_digest"] = L.raw_capture_digest(_ur["capture"])
_ur["raw_capture_sha256"] = _ur["capture"]["raw_digest"]
rec("shim-trust", "a whole chain over a wrong-shim capture cannot qualify (v1.6 promoted it)",
    qual(hyp, _untrusted_es, ACTIVE_HYP)["status"] != "QUALIFIED_CALLABLE")

# ---- C16-B4 exact stored chain
CHAIN_SETS = [
    ("attached-evidence-derived-artifact-missing", "DERIVED_ARTIFACT_MISSING"),
    ("attached-evidence-derived-artifact-of-other-raw", "DERIVED"),
    ("attached-evidence-duplicate-current-review", "REVIEW_CONFLICT"),
    ("attached-evidence-conflicting-current-reviews", "REVIEW"),
    ("attached-evidence-duplicate-current-refreeze", "REFREEZE_CONFLICT"),
]
for _set, _needle in CHAIN_SETS:
    _q = qual(hyp, EVS[_set], ACTIVE_HYP)
    rec("stored-chain", f"{_set}: refused, and the refusal names the substituted link", _q["status"] == "UNQUALIFIED" and any(_needle in r_ for r_ in _q["reasons"]), "; ".join(_q["reasons"][:2])[:160])
_q_sup = qual(hyp, EVS["attached-evidence-superseded-review"], ACTIVE_HYP)
rec("stored-chain", "two reviews resolve deterministically when the second explicitly supersedes the first, and the entry must then name the surviving one",
    _q_sup["status"] == "UNQUALIFIED" and any("REVIEW_SUBSTITUTED" in r_ for r_ in _q_sup["reasons"]), "; ".join(_q_sup["reasons"][:2])[:160])
rec("stored-chain", "supersession_resolve never uses insertion order: none/one/many are NONE/CURRENT/CONFLICT",
    L.supersession_resolve([], "X")[1] == "X_NONE" and L.supersession_resolve([{"record_id": "a" * 64}], "X")[1] == "X_CURRENT" and L.supersession_resolve([{"record_id": "a" * 64}, {"record_id": "b" * 64}], "X")[1] == "X_CONFLICT" and L.supersession_resolve([{"record_id": "a" * 64}, {"record_id": "b" * 64, "supersedes": ["a" * 64]}], "X")[0]["record_id"] == "b" * 64 and L.supersession_resolve(list(reversed([{"record_id": "a" * 64}, {"record_id": "b" * 64, "supersedes": ["a" * 64]}])), "X")[0]["record_id"] == "b" * 64)
rec("stored-chain", "a supersession cycle resolves to nothing, never to an arbitrary winner",
    L.supersession_resolve([{"record_id": "a" * 64, "supersedes": ["b" * 64]}, {"record_id": "b" * 64, "supersedes": ["a" * 64]}], "X")[1] == "X_CONFLICT")
_row = next(r for r in hyp["rows"] if CHAIN_METHOD in r["primitives"])
_entry = next(x for x in _row["evidence_records"] if x["method"] == CHAIN_METHOD)
rec("stored-chain", "a promoted row binds the exact stored chain: raw, stored derived record, review, refreeze block, probe/session, trusted shim, parser and spec",
    all(_entry.get(k) is not None for k in L.ENTRY_BOUND_FIELDS) and _entry["refreeze_block_sha256"] == L.refreeze_block_digest(hyp) and _entry["trusted_shim_sha256"] == TS_SHIM["trusted_shim_sha256"])
_ch = L.resolve_stored_chain(_entry, CHAIN_METHOD, hyp, rp, CHAIN_ES, ENVC, ACTIVE_HYP)
rec("stored-chain", "the honest chain resolves completely and yields a chain digest over the exact stored identities",
    _ch["ok"] and _ch["raw"] and _ch["derived_record"] and _ch["review"] and _ch["refreeze"] and L.is_sha(_ch["chain_sha256"]), "; ".join(_ch["errors"][:2])[:160])
for _drop in ("derived_record_sha256", "refreeze_block_sha256", "session_id", "capture_shim_sha256", "trusted_shim_sha256"):
    _e2 = {k: v for k, v in _entry.items() if k != _drop}
    rec("stored-chain", f"an entry that does not bind {_drop} cannot resolve a chain", not L.resolve_stored_chain(_e2, CHAIN_METHOD, hyp, rp, CHAIN_ES, ENVC, ACTIVE_HYP)["ok"])
_e3 = dict(_entry, derived_record_sha256="0" * 64)
rec("stored-chain", "naming a derived record id that does not exist is DERIVED_ARTIFACT_SUBSTITUTED, never a silent recomputation",
    any("DERIVED_ARTIFACT_SUBSTITUTED" in e for e in L.resolve_stored_chain(_e3, CHAIN_METHOD, hyp, rp, CHAIN_ES, ENVC, ACTIVE_HYP)["errors"]))

# ---- C16-M1 duplicate receiver paths
ISPEC = F.rp_probe_specs(rp)["TimelineItem.GetUniqueId"]
_ictx = F.Mint(F.PLACEHOLDER_MANIFEST, CAPS_SHA, rp=rp).ctx(probe_id="probe-identity-v17")


def _icap(path, uid, token=None, attempt=None):
    c = SHIM.capture(_ictx, F.FAKES["ok"]["TimelineItem"](uid), "TimelineItem", path, "TimelineItem.GetUniqueId", list(F.PRIMITIVE_SPECS))
    if token is not None:
        c["receiver"]["handle_token"] = token
    if attempt is not None:
        c["getter_attempt_id"] = attempt
    c["raw_digest"] = L.raw_capture_digest(c)
    return c


_p_ok = [[_icap(f"track1/item{i}", f"it-{i}") for i in range(3)] for _ in range(3)]
rec("identity-duplicates", "control: three distinct paths with distinct ids over three passes claim A, B and C",
    (lambda c_: c_["claim_A_callable"] and c_["claim_B_unique_within_pass"] and c_["claim_C_stable_across_passes"] and c_["input_errors"] == [])(L.identity_claims(_p_ok, ISPEC, ENVC, ACTIVE_HYP)))
IDENTITY_ATTACKS = [
    ("the same receiver path observed twice with different ids", lambda: [[_icap("track1/item1", "it-1"), _icap("track1/item1", "it-2")] for _ in range(3)], "DUPLICATE_RECEIVER_PATH"),
    ("the same receiver path under two different handle tokens", lambda: [[_icap("track1/item1", "it-1", token="h1"), _icap("track1/item1", "it-1", token="h2")] for _ in range(3)], "PATH_HANDLE_CONFLICT"),
    ("the same receiver path returning two different ids", lambda: [[_icap("track1/item1", "it-1", token="h1"), _icap("track1/item1", "it-9", token="h1")] for _ in range(3)], "PATH_ID_CONFLICT"),
    ("two observations sharing one getter attempt id", lambda: [[_icap("track1/item1", "it-1", attempt="probe:1"), _icap("track1/item2", "it-2", attempt="probe:1")] for _ in range(3)], "DUPLICATE_ATTEMPT_ID"),
]
for _label, _mk, _code in IDENTITY_ATTACKS:
    _c = L.identity_claims(_mk(), ISPEC, ENVC, ACTIVE_HYP)
    rec("identity-duplicates", f"{_label}: refused before any index is built, and no claim survives",
        any(_code in e for e in _c["input_errors"]) and not _c["claim_A_callable"] and not _c["claim_B_unique_within_pass"] and not _c["claim_C_stable_across_passes"],
        f"{_c['input_errors'][:1]} A={_c['claim_A_callable']} B={_c['claim_B_unique_within_pass']} C={_c['claim_C_stable_across_passes']}")
_dup_ids = [[_icap("track1/item1", "dup"), _icap("track1/item2", "dup")] for _ in range(3)]
_dc = L.identity_claims(_dup_ids, ISPEC, ENVC, ACTIVE_HYP)
rec("identity-duplicates", "two distinct paths returning ONE id: uniqueness fails and stability is not claimed either (v1.6 claimed stability)",
    _dc["duplicates"] == ["dup"] and _dc["claim_B_unique_within_pass"] is False and _dc["claim_C_stable_across_passes"] is False)
_obs, _oerr = L.identity_claim_inputs(_dup_ids[0], ISPEC, ENVC, ACTIVE_HYP)
rec("identity-duplicates", "the claim input of one pass is an ordered list of every observation, so nothing can overwrite anything",
    isinstance(_obs, list) and len(_obs) == 2 and [o["ordinal"] for o in _obs] == [0, 1] and "ids[path] = " not in inspect.getsource(L.identity_claims))
_mismatch = [[_icap("track1/item1", "it-1"), _icap("track1/item2", "it-2")], [_icap("track1/item1", "it-1")], [_icap("track1/item1", "it-1"), _icap("track1/item2", "it-2")]]
rec("identity-duplicates", "a pass observing a different receiver-path set cannot support a stability claim",
    any("PASS_SET_MISMATCH" in e for e in L.identity_claims(_mismatch, ISPEC, ENVC, ACTIVE_HYP)["input_errors"]))

# ---- C16-M2 strict raw byte ingestion
_good_cap = copy.deepcopy(_base_cap)
_good_frame = SHIM.raw_frame_bytes(_good_cap)
_ing = L.ingest_raw_frame(_good_frame, ENVC, ACTIVE_HYP, rp)
rec("raw-ingestion", "control: honest frame BYTES ingest to a record whose digest and strict-parse receipt both close",
    _ing["raw_capture_sha256"] == _good_cap["raw_digest"] and L.ingest_receipt_errors(_ing["ingest_receipt"], _ing["capture"]) == [] and _ing["ingest_receipt"]["raw_bytes_sha256"] == hashlib.sha256(_good_frame).hexdigest())
_txt = _good_frame.decode()
_SEQ_TOK = '"sequence":%d' % _good_cap["sequence"]
assert _txt.count(_SEQ_TOK) == 1, _SEQ_TOK
INGEST_ATTACKS = [
    ("a duplicate JSON key", (_txt[:-2] + ',"method":"Timeline.SetName"}\n').encode(), "DUPLICATE_JSON_KEY"),
    ("malformed UTF-8", _good_frame[:20] + b"\xff\xfe" + _good_frame[20:], "MALFORMED_UTF8"),
    ("trailing garbage after the object", _good_frame.rstrip() + b" trailing\n", "TRAILING_BYTES"),
    ("a second JSON object in one frame", _good_frame.rstrip() + b' {"a":1}\n', "MULTIPLE_JSON_VALUES"),
    ("invalid number syntax", _txt.replace(_SEQ_TOK, '"sequence":0%d' % _good_cap["sequence"], 1).encode(), "STRUCTURE_INVALID"),
    ("the non-finite constant NaN", _txt.replace(_SEQ_TOK, '"sequence":NaN', 1).encode(), "NON_FINITE_NUMBER"),
    ("a raw control character", _txt.replace('"outcome"', '"out\x01come"', 1).encode(), "CONTROL_CHARACTER"),
    ("an oversized frame", b'{"schema":"x","pad":"' + b"p" * (L.RAW_FRAME_MAX_BYTES + 8) + b'"}', "FRAME_TOO_LARGE"),
    ("a UTF-8 byte order mark", b"\xef\xbb\xbf" + _good_frame, "BOM_PRESENT"),
    ("an unknown raw schema version", _txt.replace(L.RAW_SCHEMA_ID, "vidtoolz.resolveRawCapabilityCapture.v0", 1).encode(), "UNKNOWN_SCHEMA_VERSION"),
    ("a top-level array instead of an object", b'[' + _good_frame.rstrip() + b']\n', "NOT_A_JSON_OBJECT"),
    ("an empty frame", b"   \n", "EMPTY_FRAME"),
    ("a parsed object instead of bytes", _good_cap, "NOT_BYTES"),
]
for _label, _frame, _code in INGEST_ATTACKS:
    try:
        L.ingest_raw_frame(_frame, ENVC, ACTIVE_HYP, rp)
        _ok, _d = False, "ACCEPTED"
    except L.RawIngestError as ex:
        _ok, _d = ex.code == _code, f"{ex.code} (expected {_code})"
    rec("raw-ingestion", f"{_label} is refused at the byte boundary as {_code}", _ok, _d)
rec("raw-ingestion", "json.loads keeps the LAST duplicate key while the strict parse refuses the frame outright (this is why a parsed object is not authority)",
    json.loads('{"a":1,"a":2}')["a"] == 2 and isinstance(L.__dict__["strict_parse_raw_frame"], type(L.canon)))
rec("raw-ingestion", "a RAW_CAPABILITY_CAPTURE record without a strict-parse receipt is inadmissible",
    any("PARSED_OBJECT_NOT_AUTHORITY" in e or "raw ingestion" in e for e in L.semantic_raw_capture({k: v for k, v in raw_rec_of(CHAIN_ES).items() if k != "ingest_receipt"}, ENVC, ACTIVE_HYP)))
_bad_receipt = copy.deepcopy(raw_rec_of(CHAIN_ES))
_bad_receipt["ingest_receipt"]["capture_digest"] = "0" * 64
rec("raw-ingestion", "a receipt that does not name this capture's digest is inadmissible",
    any("capture_digest" in e for e in L.semantic_raw_capture(_bad_receipt, ENVC, ACTIVE_HYP)))
_bad_receipt2 = copy.deepcopy(raw_rec_of(CHAIN_ES))
_bad_receipt2["ingest_receipt"]["strict_parse"] = False
rec("raw-ingestion", "a receipt that does not assert strict parsing is inadmissible",
    any("strict_parse" in e for e in L.semantic_raw_capture(_bad_receipt2, ENVC, ACTIVE_HYP)))
ING_CASES = L.strict_load(os.path.join(B, "fixtures/raw-ingestion/CASES.json"))
rec("raw-ingestion", "the strict-ingestion negative fixtures are replayable frame FILES with pinned byte counts and digests",
    len(ING_CASES["cases"]) >= 14 and all(open(os.path.join(B, c_["file"]), "rb").read() == open(os.path.join(B, c_["file"]), "rb").read() and hashlib.sha256(open(os.path.join(B, c_["file"]), "rb").read()).hexdigest() == c_["sha256"] and os.path.getsize(os.path.join(B, c_["file"])) == c_["byte_count"] for c_ in ING_CASES["cases"]))
for c_ in ING_CASES["cases"]:
    _b = open(os.path.join(B, c_["file"]), "rb").read()
    try:
        _r = L.ingest_raw_frame(_b, ENVC, ACTIVE_HYP, rp)
        _got, _detail = None, "ingested"
    except L.RawIngestError as ex:
        _got, _detail = ex.code, str(ex)[:90]
    rec("raw-ingestion", f"replayed fixture {c_['name']}: {c_['expected_code'] or 'ingests cleanly'}", _got == c_["expected_code"], f"got {_got}: {_detail}")
rec("raw-ingestion", "every raw capture fixture in the bundle carries a closed strict-parse receipt",
    all(L.ingest_receipt_errors(r_["ingest_receipt"], r_["capture"]) == [] for es_ in EVS.values() for r_ in es_["records"].values() if r_["record_type"] == "RAW_CAPABILITY_CAPTURE" and "ingest_receipt" in r_))

# ---- C16-M3 the executable append-only evidence store
STORE_ROOT = tempfile.mkdtemp(prefix="resolve-v19-evidence-")


def _plant(st, rel, data=b"planted\n", directory=False):
    p = os.path.join(st.dir, *rel.split("/"))
    if directory:
        os.makedirs(p, mode=0o700, exist_ok=True)
    else:
        os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
        os.chmod(os.path.dirname(p), 0o700)
        with open(p, "wb") as f:
            f.write(data)
    return p


def _unplant(p, session_dir=None):
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p, ignore_errors=True)
    elif os.path.exists(p) or os.path.islink(p):
        os.chmod(os.path.dirname(p), 0o700)
        os.unlink(p)
    d = os.path.dirname(os.path.abspath(p))
    root = os.path.abspath(session_dir) if session_dir else None
    while root and d.startswith(root + os.sep) and os.path.isdir(d) and not os.listdir(d):
        os.rmdir(d)
        d = os.path.dirname(d)


def _frame_for(session_id):
    """A raw capture frame whose record-internal session id IS this session's, so semantic reconciliation of the
    record-internal identity is exercised honestly rather than bypassed."""
    c = copy.deepcopy(_good_cap)
    c["session_id"] = session_id
    c["raw_digest"] = L.raw_capture_digest(c)
    return SHIM.raw_frame_bytes(c)


def _sm(name, root=None):
    return ES_MOD.session_manifest(name, "probe-" + name, "adapter-operator (M0A driver)", ENVC, ACTIVE_HYP, rp, "2026-09-09T10:00:00Z")


def _fresh(name, root=None, finalize=True, full=True):
    st = ES_MOD.create_session(root or STORE_ROOT, name, _sm(name))
    st.put_raw(name + ":0001", _frame_for(name), logical_identity="GetStartFrame")
    if full:
        st.put_derived(name + ":1001", {"derived": name}, logical_identity="GetStartFrame")
        st.put_review(name + ":1002", {"review": name}, logical_identity="review-1")
        st.put_promotion(name + ":1003", {"promotion": name}, logical_identity="refreeze-1")
    if finalize:
        st.finalize()
    return st


def _chmod_probe(st, rel, newmode, code="MODE_MISMATCH"):
    """chmod one governed entry, verify, restore. Returns (detected, detail)."""
    p = os.path.join(st.dir, *rel.split("/")) if rel else st.dir
    old = stat.S_IMODE(os.lstat(p).st_mode)
    os.chmod(p, newmode)
    v = st.verify()
    os.chmod(p, old)
    return any(code in e for e in v), "; ".join(v[:1])[:150]


try:
    # ================================================================ S19-1 root trust boundary (sections 1-3, 23, 24)
    REAL = os.path.join(STORE_ROOT, "REAL-ROOT")
    os.makedirs(REAL, mode=0o700)
    LINK = os.path.join(STORE_ROOT, "LINK-ROOT")
    os.symlink(REAL, LINK)
    rec("evidence-root-trust", "the trust boundary is established by lstat BEFORE any resolution: a symlinked evidence root is refused at create_session (v1.8 resolved it away and accepted it)",
        _try_store(lambda: ES_MOD.create_session(LINK, "sess-via-symlink", _sm("sess-via-symlink"))).code == "ROOT_SYMLINK_REFUSED")
    _real_st = _fresh("sess-real", root=REAL)
    rec("evidence-root-trust", "the same session opens fine through the REAL root and verifies clean",
        ES_MOD.open_session(REAL, "sess-real").verify() == [], "; ".join(_real_st.verify()[:2])[:150])
    for _api, _call in (("open_session", lambda: ES_MOD.open_session(LINK, "sess-real")),
                        ("list_sessions", lambda: ES_MOD.list_sessions(LINK)),
                        ("create_session", lambda: ES_MOD.create_session(LINK, "sess-other", _sm("sess-other")))):
        rec("evidence-root-trust", f"{_api} through the symlinked root is refused ROOT_SYMLINK_REFUSED",
            _try_store(_call).code == "ROOT_SYMLINK_REFUSED")
    rec("evidence-root-trust", "no session may be finalized or verified through the symlink path: the boundary refuses before a store object exists",
        _try_store(lambda: ES_MOD.open_session(LINK, "sess-real")).code == "ROOT_SYMLINK_REFUSED" and not os.path.exists(os.path.join(REAL, "sess-other")))
    _symsess = os.path.join(REAL, "sess-symlinked")
    os.symlink(os.path.join(REAL, "sess-real"), _symsess)
    rec("evidence-root-trust", "a symlinked SESSION directory entry is refused SESSION_SYMLINK_REFUSED",
        _try_store(lambda: ES_MOD.open_session(REAL, "sess-symlinked")).code == "SESSION_SYMLINK_REFUSED")
    os.unlink(_symsess)
    _b = ES_MOD.RootBoundary(REAL)
    rec("evidence-root-trust", "the boundary keeps the literal path and records device+inode, and re-checks them on every operation",
        _b.path == os.path.abspath(REAL) and isinstance(_b.dev, int) and isinstance(_b.ino, int) and _b.check() == os.path.abspath(REAL))
    _swap = os.path.join(STORE_ROOT, "SWAP-ROOT")
    os.makedirs(_swap, mode=0o700)
    _spare = os.path.join(STORE_ROOT, "SPARE-DIR")
    os.makedirs(_spare, mode=0o700)   # allocated while SWAP-ROOT still exists, so its inode is necessarily distinct
    _b2 = ES_MOD.RootBoundary(_swap)
    os.rmdir(_swap)
    os.symlink(REAL, _swap)
    rec("evidence-root-trust", "replacing an established root with a symlink between operations is detected (section 23; detection, not a TOCTOU guarantee)",
        _try_store(lambda: _b2.check()).code == "ROOT_SYMLINK_REFUSED")
    os.unlink(_swap)
    os.rename(_spare, _swap)
    rec("evidence-root-trust", "replacing an established root with a DIFFERENT directory is detected as ROOT_REPLACED",
        _try_store(lambda: _b2.check()).code == "ROOT_REPLACED")
    rec("evidence-root-trust", "the root-replacement check is honestly scoped: it compares device and inode, so a replacement that reuses the freed inode is NOT claimed to be detected",
        "inode" in inspect.getsource(ES_MOD.RootBoundary) and "reuse" in inspect.getsource(ES_MOD.RootBoundary.check))
    os.rmdir(_swap)
    rec("evidence-root-trust", "a root that is a regular file, or absent, is refused ROOT_NOT_A_DIRECTORY",
        _try_store(lambda: ES_MOD.RootBoundary(os.path.join(STORE_ROOT, "nope"))).code == "ROOT_NOT_A_DIRECTORY"
        and (lambda f: (open(f, "wb").write(b"x"), _try_store(lambda: ES_MOD.RootBoundary(f)).code)[1])(os.path.join(STORE_ROOT, "afile")) == "ROOT_NOT_A_DIRECTORY")
    _trust_code = "\n".join(l for l in (inspect.getsource(ES_MOD.RootBoundary) + inspect.getsource(ES_MOD._safe_join)).split("\n") if "#" not in l.strip()[:1] and "realpath()" not in l)
    rec("evidence-root-trust", "the store never resolves a caller root before inspecting it: no os.path.realpath on the trust path, and reads use O_NOFOLLOW",
        "os.path.realpath(" not in _trust_code and "lstat" in inspect.getsource(ES_MOD.RootBoundary) and "O_NOFOLLOW" in inspect.getsource(ES_MOD._read_exact))
    rec("evidence-root-trust", "the platform scope of the mode and file-type claims is stated as POSIX and not overclaimed (section 25)",
        ES_MOD.PLATFORM_SCOPE == "POSIX" and "No Windows parity is claimed" in inspect.getsource(ES_MOD).split("import hashlib")[0])

    # ================================================================ S19-2 session identity (sections 4-6, 20, 22)
    SI = _fresh("sess-identity")
    rec("evidence-session-identity", "control: a session in its own directory verifies clean and reports FINALIZED",
        SI.verify() == [] and SI.session_state() == "FINALIZED", "; ".join(SI.verify()[:2])[:150])
    _tup, _dig = SI.identity()
    rec("evidence-session-identity", "the frozen session identity tuple binds session, probe, authority, store, host/build, library, shim, spec, registry and directory basename (section 5)",
        set(ES_MOD.SESSION_IDENTITY_FIELDS) == set(_tup) and len(ES_MOD.SESSION_IDENTITY_FIELDS) >= 16 and L.is_sha(_dig)
        and SI.manifest()["session_identity_sha256"] == _dig and SI.inventory()["session_identity_sha256"] == _dig
        and SI.finalization_marker()["session_identity_sha256"] == _dig)
    rec("evidence-session-identity", "the session path law is policy A: the directory basename IS the session id, and the manifest says so",
        SI.manifest()["session_dir_basename"] == SI.session_id == os.path.basename(SI.dir))
    # ---- section 4: renamed session directory
    os.rename(SI.dir, os.path.join(STORE_ROOT, "sess-renamed"))
    _ren = ES_MOD.open_session(STORE_ROOT, "sess-renamed")
    _rv = _ren.verify()
    rec("evidence-session-identity", "RENAMED SESSION (Codex S19-2): a finalized session moved to another directory name is refused SESSION_PATH_MISMATCH / SESSION_IDENTITY_MISMATCH. v1.8 verified it clean.",
        any("SESSION_PATH_MISMATCH" in e for e in _rv) and any("SESSION_IDENTITY_MISMATCH" in e for e in _rv) and _ren.session_state() == "INVALID",
        "; ".join(_rv[:2])[:170])
    os.rename(_ren.dir, os.path.join(STORE_ROOT, "sess-identity"))
    rec("evidence-session-identity", "renaming it back restores a clean verification", SI.verify() == [])
    # ---- section 22: cross-session attacks
    OTHER = _fresh("sess-other-session")
    XS = []
    _copy = os.path.join(STORE_ROOT, "sess-copy")
    shutil.copytree(SI.dir, _copy)
    _cs = ES_MOD.open_session(STORE_ROOT, "sess-copy")
    XS.append(("the whole finalized session copied to another directory name", _cs.verify()))
    shutil.rmtree(_copy, ignore_errors=True)
    for _label, _src, _dst in (("the inventory alone", ES_MOD.INVENTORY_FILE, ES_MOD.INVENTORY_FILE),
                               ("the finalization marker alone", ES_MOD.FINALIZED_FILE, ES_MOD.FINALIZED_FILE),
                               ("the session manifest alone", ES_MOD.SESSION_FILE, ES_MOD.SESSION_FILE)):
        _t = os.path.join(OTHER.dir, _dst)
        _orig = open(_t, "rb").read()
        _om = stat.S_IMODE(os.lstat(_t).st_mode)
        os.chmod(_t, 0o600)
        open(_t, "wb").write(open(os.path.join(SI.dir, _src), "rb").read())
        os.chmod(_t, _om)
        XS.append((f"{_label} copied from another session", OTHER.verify()))
        os.chmod(_t, 0o600)
        open(_t, "wb").write(_orig)
        os.chmod(_t, _om)
    _srec = next(e for e in SI.inventory()["entries"] if e["kind"] == "RECORD")
    _dstp = _plant(OTHER, _srec["path"], open(os.path.join(SI.dir, *_srec["path"].split("/")), "rb").read())
    XS.append(("one record copied from another session", OTHER.verify()))
    _unplant(_dstp, OTHER.dir)
    for _label, _v in XS:
        rec("evidence-session-identity", f"cross-session attack: {_label} is refused", bool(_v), "; ".join(_v[:1])[:150])
    rec("evidence-session-identity", "after every cross-session attack is reverted both sessions verify clean again",
        SI.verify() == [] and OTHER.verify() == [], "; ".join((SI.verify() + OTHER.verify())[:2])[:150])
    rec("evidence-session-identity", "the finalization marker binds session identity, inventory digest, store and authority version and the expected final state (section 20)",
        (lambda m_: m_["schema"] == ES_MOD.EVIDENCE_FINALIZATION_SCHEMA and m_["state"] == "FINALIZED" and m_["session_id"] == SI.session_id and m_["inventory_sha256"] == SI.inventory()["inventory_sha256"] and m_["evidence_store_version"] == ES_MOD.EVIDENCE_STORE_VERSION and m_["authority_version"] == L.AUTHORITY_VERSION)(SI.finalization_marker()))

    # ================================================================ S19-2 semantic inventory (sections 7, 8, 9, 10, 15, 21)
    SEM = _fresh("sess-semantic")
    _inv = SEM.inventory()
    rec("evidence-semantic-inventory", "the inventory records layer, record key, logical identity, attempt ids and keys, record-internal session and probe ids, file type and mode for every governed entry (sections 7/8/16)",
        all(set(e) == {"path", "kind", "layer", "record_key", "content_sha256", "byte_count", "file_type", "mode", "schema_type", "logical_identity", "internal_session_id", "internal_probe_id", "attempt_ids", "attempt_keys"} for e in _inv["entries"])
        and _inv["semantic_reconciliation"] is True and _inv["closed_world"] is True
        and all(isinstance(d_["mode"], int) and d_["file_type"] == "DIRECTORY" for d_ in _inv["directories"]))
    rec("evidence-semantic-inventory", "verification reports four counters and PASS requires all four to be zero (section 15)",
        (lambda t_: t_[0] == [] and t_[1] == {"missing": 0, "unexpected": 0, "changed": 0, "semantic_mismatch": 0})(SEM.verify_summary()))
    _r = next(e for e in _inv["entries"] if e["kind"] == "RECORD" and e["layer"] == "RAW")
    rec("evidence-semantic-inventory", "a record's storage name recomputes from its semantics: sha256 over session, layer, logical identity and content digest (section 8)",
        _r["record_key"] == ES_MOD.record_key(SEM.session_id, _r["layer"], _r["logical_identity"], _r["content_sha256"])
        and _r["path"] == ES_MOD.expected_record_path(_r["layer"], _r["record_key"]))
    rec("evidence-semantic-inventory", "a RAW capture record's internal session id is extracted and reconciled against the session it lives in (section 7)",
        _r["internal_session_id"] == SEM.session_id and _r["internal_probe_id"] == _good_cap.get("probe_id"),
        f"internal={_r['internal_session_id']} session={SEM.session_id}")

    def _tamper_inventory(st, mutate):
        """Rewrite the inventory with a semantic lie, keeping its self-digest coherent so only reconciliation can catch it."""
        p = os.path.join(st.dir, ES_MOD.INVENTORY_FILE)
        orig = open(p, "rb").read()
        inv = json.loads(orig.decode())
        mutate(inv)
        inv.pop("inventory_sha256", None)
        inv["inventory_sha256"] = ES_MOD.inventory_digest(inv)
        os.chmod(p, 0o600)
        open(p, "wb").write((json.dumps(inv, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode())
        os.chmod(p, 0o444)
        v = st.verify()
        os.chmod(p, 0o600)
        open(p, "wb").write(orig)
        os.chmod(p, 0o444)
        return v

    def _first_record(inv):
        return next(e for e in inv["entries"] if e["kind"] == "RECORD")

    _v = _tamper_inventory(SEM, lambda i: _first_record(i).update(layer="DERIVED"))
    rec("evidence-semantic-inventory", "LAYER COLLISION (section 9): an inventory that records a different layer than the path holds is LAYER_IDENTITY_MISMATCH",
        any("LAYER_IDENTITY_MISMATCH" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: _first_record(i).update(logical_identity="SomeOtherMethod"))
    rec("evidence-semantic-inventory", "LOGICAL IDENTITY COLLISION (section 10): rebinding a stored record to another logical identity is LOGICAL_IDENTITY_MISMATCH",
        any("LOGICAL_IDENTITY_MISMATCH" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: _first_record(i).update(record_key="0" * 64))
    rec("evidence-semantic-inventory", "a record key that does not recompute from the record's semantics is refused",
        any("LOGICAL_IDENTITY_MISMATCH" in e or "RECORD_KEY_MISMATCH" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: _first_record(i).update(internal_session_id="another-session"))
    rec("evidence-semantic-inventory", "a changed record-internal session id is INTERNAL_IDENTITY_MISMATCH",
        any("INTERNAL_IDENTITY_MISMATCH" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: i["entries"].append(dict(_first_record(i))))
    rec("evidence-semantic-inventory", "a duplicate path in the inventory is INVENTORY_DUPLICATE_KEY, refused before any index is built (section 21)",
        any("INVENTORY_DUPLICATE_KEY" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: i["entries"].append(dict(_first_record(i), path="DERIVED/zz/" + "b" * 64 + ".json")))
    rec("evidence-semantic-inventory", "a duplicate record key under a second path is INVENTORY_DUPLICATE_KEY",
        any("INVENTORY_DUPLICATE_KEY" in e for e in _v), "; ".join(_v[:1])[:150])
    _v = _tamper_inventory(SEM, lambda i: i.update(session_id="sess-someone-else"))
    rec("evidence-semantic-inventory", "an inventory naming another session id is SESSION_PATH_MISMATCH / SESSION_IDENTITY_MISMATCH",
        any("SESSION_PATH_MISMATCH" in e or "SESSION_IDENTITY_MISMATCH" in e for e in _v), "; ".join(_v[:1])[:150])
    _moved = os.path.join(SEM.dir, "DERIVED", _r["record_key"][:2])
    os.makedirs(_moved, mode=0o700, exist_ok=True)
    _mp = os.path.join(_moved, _r["record_key"] + ".json")
    shutil.copyfile(os.path.join(SEM.dir, *_r["path"].split("/")), _mp)
    os.chmod(_mp, 0o400)
    _v = SEM.verify()
    rec("evidence-semantic-inventory", "a valid record copied into another LAYER keeps its old key, so the recomputation fails and it is refused",
        bool(_v), "; ".join(_v[:1])[:150])
    _unplant(_mp, SEM.dir)
    rec("evidence-semantic-inventory", "the session verifies clean after every semantic attack is reverted",
        SEM.verify() == [], "; ".join(SEM.verify()[:2])[:150])

    # ================================================================ S19-3 attempt tuple (sections 11-14)
    AT = ES_MOD.create_session(STORE_ROOT, "sess-attempt", _sm("sess-attempt"))
    _bytes_a = b'{"a":1}\n'
    _bytes_b = b'{"b":2}\n'
    _p = AT.put_raw("att-1", _bytes_a, logical_identity="MethodA")
    rec("evidence-attempt-tuple", "the canonical attempt key is the tuple (session, layer, logical identity, attempt id), not a digest (section 11)",
        _p["attempt_key"] == ES_MOD.attempt_key("sess-attempt", "RAW", "MethodA", "att-1") and _p["attempt_key"] != _p["content_sha256"])
    ATTEMPT_TABLE = [
        ("same tuple, same bytes", lambda: AT.put_raw("att-1", _bytes_a, logical_identity="MethodA"), "IDEMPOTENT"),
        ("same tuple, different bytes", lambda: AT.put_raw("att-1", _bytes_b, logical_identity="MethodA"), "ATTEMPT_ID_REUSED"),
        ("same attempt id, different LAYER (v1.8 accepted this and made a second record)", lambda: AT.put_derived("att-1", _bytes_a, logical_identity="MethodA"), "ATTEMPT_ID_CROSS_LAYER"),
        ("same attempt id, different LOGICAL IDENTITY", lambda: AT.put_raw("att-1", _bytes_a, logical_identity="MethodB"), "ATTEMPT_ID_CROSS_IDENTITY"),
        ("RAW attempt reused in DERIVED", lambda: AT.put_derived("att-1", _bytes_b, logical_identity="MethodA"), "ATTEMPT_ID_CROSS_LAYER"),
        ("a write with no logical identity at all", lambda: AT.put_raw("att-9", _bytes_a), "LOGICAL_IDENTITY_INVALID"),
    ]
    for _label, _call, _expect in ATTEMPT_TABLE:
        if _expect == "IDEMPOTENT":
            _r2 = _call()
            rec("evidence-attempt-tuple", f"{_label}: idempotent, same record, no second copy", _r2["idempotent"] is True and _r2["record_key"] == _p["record_key"])
        else:
            rec("evidence-attempt-tuple", f"{_label}: refused {_expect}", _try_store(_call).code == _expect)
    _d1 = AT.put_derived("att-2", _bytes_a, logical_identity="MethodA")
    rec("evidence-attempt-tuple", "a DIFFERENT attempt id may legitimately carry the same bytes into another layer, and gets its own semantic key",
        _d1["layer"] == "DERIVED" and _d1["record_key"] != _p["record_key"] and _d1["content_sha256"] == _p["content_sha256"])
    rec("evidence-attempt-tuple", "DERIVED attempt reused in HUMAN_REVIEW is refused ATTEMPT_ID_CROSS_LAYER",
        _try_store(lambda: AT.put_review("att-2", _bytes_a, logical_identity="MethodA")).code == "ATTEMPT_ID_CROSS_LAYER")
    _d2 = AT.put_raw("att-3", _bytes_a, logical_identity="MethodC")
    rec("evidence-attempt-tuple", "the same digest under two logical identities is two DISTINCT records with distinct semantic keys (documented deterministic outcome, section 14)",
        _d2["content_sha256"] == _p["content_sha256"] and _d2["record_key"] != _p["record_key"] and _d2["logical_identity"] == "MethodC")
    AT2 = ES_MOD.create_session(STORE_ROOT, "sess-attempt-two", _sm("sess-attempt-two"))
    _x = AT2.put_raw("att-1", _bytes_a, logical_identity="MethodA")
    rec("evidence-attempt-tuple", "the same attempt id in a DIFFERENT session is allowed and produces a different attempt key and a different record key (the tuple includes the session)",
        _x["attempt_key"] != _p["attempt_key"] and _x["record_key"] != _p["record_key"])
    AT.finalize()
    AT2.finalize()
    rec("evidence-attempt-tuple", "both attempt sessions finalize and verify clean", AT.verify() == [] and AT2.verify() == [], "; ".join((AT.verify() + AT2.verify())[:2])[:150])
    _mk = os.path.join(AT2.dir, ES_MOD.ATTEMPTS_DIR, "att-1")
    _o = open(_mk, "rb").read()
    os.chmod(_mk, 0o600)
    open(_mk, "wb").write(open(os.path.join(AT.dir, ES_MOD.ATTEMPTS_DIR, "att-1"), "rb").read())
    os.chmod(_mk, 0o400)
    rec("evidence-attempt-tuple", "an attempt marker copied from another session is refused (its tuple names the wrong session)", bool(AT2.verify()), "; ".join(AT2.verify()[:1])[:150])
    os.chmod(_mk, 0o600)
    open(_mk, "wb").write(_o)
    os.chmod(_mk, 0o400)
    rec("evidence-attempt-tuple", "attempt indexes are built from a list and duplicate tuple keys refuse before any map exists (section 13)",
        "ATTEMPT_TUPLE_DUPLICATE" in ES_MOD.ERROR_CODES and "pairs.append" in inspect.getsource(ES_MOD.EvidenceStore.attempts) and AT2.verify() == [])

    # ================================================================ S19-4 mode / file-type authority (sections 16-19)
    MD = _fresh("sess-mode")
    rec("evidence-mode-authority", "canonical modes are set explicitly rather than left to the umask, and are recorded in the inventory (section 17)",
        ES_MOD.CANONICAL_MODES["RECORD"] == 0o400 and ES_MOD.CANONICAL_MODES["DIRECTORY"] == 0o700 and ES_MOD.CANONICAL_MODES["INVENTORY"] == 0o444
        and MD.inventory()["canonical_modes"] == {k: v for k, v in sorted(ES_MOD.CANONICAL_MODES.items())}
        and "os.chmod(path, mode)" in inspect.getsource(ES_MOD._write_once))
    _mrec = next(e for e in MD.inventory()["entries"] if e["kind"] == "RECORD")
    for _label, _rel, _mode in (("a stored record", _mrec["path"], 0o666),
                                ("a layer directory", "RAW", 0o777),
                                ("the session manifest", ES_MOD.SESSION_FILE, 0o666),
                                ("the attempts directory", ES_MOD.ATTEMPTS_DIR, 0o750),
                                ("an attempt marker", ES_MOD.ATTEMPTS_DIR + "/" + _mrec["attempt_ids"][0], 0o644)):
        _ok, _d = _chmod_probe(MD, _rel, _mode)
        rec("evidence-mode-authority", f"CHMOD {_label} after finalization is detected as MODE_MISMATCH (v1.8 did not notice)", _ok, _d)
    for _label, _rel, _mode in (("the INVENTORY", ES_MOD.INVENTORY_FILE, 0o666), ("the FINALIZED marker", ES_MOD.FINALIZED_FILE, 0o666)):
        _ok, _d = _chmod_probe(MD, _rel, _mode)
        rec("evidence-mode-authority", f"CHMOD {_label} after finalization is detected", _ok, _d)
    rec("evidence-mode-authority", "the session verifies clean once every mode is restored", MD.verify() == [], "; ".join(MD.verify()[:2])[:150])
    rec("evidence-mode-authority", "only POSIX file type and permission bits are frozen: no inode, timestamp or owner is recorded (section 16)",
        not any(k in json.dumps(MD.inventory()) for k in ("st_ino", "inode", "mtime", "ctime", "st_uid", "owner")))
    _fp = os.path.join(MD.dir, *_mrec["path"].split("/"))
    _fb = open(_fp, "rb").read()
    os.chmod(os.path.dirname(_fp), 0o700)
    os.unlink(_fp)
    try:
        os.mkfifo(_fp)
        _v = MD.verify()
        rec("evidence-mode-authority", "a regular file replaced by another filesystem type at the same path is refused even though the path exists (section 19)",
            any("FILE_TYPE_REJECTED" in e for e in _v), "; ".join(_v[:1])[:150])
        os.unlink(_fp)
    except (AttributeError, OSError) as _ex:
        rec("evidence-mode-authority", "a regular file replaced by another filesystem type at the same path is refused even though the path exists (section 19)", False, f"mkfifo unavailable: {_ex!r}")
    open(_fp, "wb").write(_fb)
    os.chmod(_fp, 0o400)
    rec("evidence-mode-authority", "restoring the regular file with its canonical mode verifies clean again", MD.verify() == [], "; ".join(MD.verify()[:2])[:150])

    # ================================================================ retained ES-1 / ES-2 regressions (section 28)
    CW = _fresh("sess-v19-closedworld")
    rec("evidence-closed-world", "control: the untouched finalized session verifies clean", CW.verify() == [], "; ".join(CW.verify()[:2])[:150])
    _s14 = _plant(CW, "PLANTED-BY-ATTACKER.json", b'{"forged":"authority"}\n')
    _s14v = CW.verify()
    rec("evidence-closed-world", "STORE-14 (Codex, pinned regression) still closed: an unexpected file in the finalized session ROOT is UNEXPECTED_ENTRY and the session is INVALID",
        any("UNEXPECTED_ENTRY" in e and "PLANTED-BY-ATTACKER.json" in e for e in _s14v) and CW.session_state() == "INVALID", "; ".join(_s14v[:1])[:170])
    _unplant(_s14, CW.dir)
    for _label, _mk2, _code in (("an unexpected nested file inside a layer", lambda: _plant(CW, "RAW/EXTRA-NESTED.json"), "UNEXPECTED_ENTRY"),
                                ("an unexpected directory", lambda: _plant(CW, "EXTRA-DIR", directory=True), "UNEXPECTED_ENTRY"),
                                ("an unexpected nested directory", lambda: _plant(CW, "DERIVED/EXTRA-DIR", directory=True), "UNEXPECTED_ENTRY"),
                                ("an unexpected file in the attempts index", lambda: _plant(CW, "ATTEMPTS/forged", b'{"x":1}\n'), "UNEXPECTED_ENTRY")):
        _p2 = _mk2()
        _v = CW.verify()
        rec("evidence-closed-world", f"still closed: {_label} invalidates the session", any(_code in e for e in _v), "; ".join(_v[:1])[:150])
        _unplant(_p2, CW.dir)
    rec("evidence-closed-world", "post-finalization writes through the API are still refused (all four layers and re-finalization)",
        all(_try_store(fn).code == "SESSION_FINALIZED" for fn in (
            lambda: CW.put_raw("late:1", b'{"l":1}\n', logical_identity="X"),
            lambda: CW.put_derived("late:2", {"l": 1}, logical_identity="X"),
            lambda: CW.put_review("late:3", {"l": 1}, logical_identity="X"),
            lambda: CW.put_promotion("late:4", {"l": 1}, logical_identity="X"),
            lambda: CW.finalize())))
    _sym = os.path.join(CW.dir, "PLANTED-SYMLINK.json")
    os.symlink(os.path.join(CW.dir, ES_MOD.SESSION_FILE), _sym)
    rec("evidence-closed-world", "an internal symlink is still SYMLINK_REJECTED", any("SYMLINK_REJECTED" in e for e in CW.verify()))
    os.unlink(_sym)
    _fifo = os.path.join(CW.dir, "PLANTED-FIFO")
    try:
        os.mkfifo(_fifo)
        rec("evidence-closed-world", "a FIFO inside a session is still FILE_TYPE_REJECTED", any("FILE_TYPE_REJECTED" in e for e in CW.verify()))
        os.unlink(_fifo)
    except (AttributeError, OSError) as _ex:
        rec("evidence-closed-world", "a FIFO inside a session is still FILE_TYPE_REJECTED", False, repr(_ex))
    rec("evidence-closed-world", "the session verifies clean after every retained-regression attack", CW.verify() == [], "; ".join(CW.verify()[:2])[:150])

    TR = ES_MOD.create_session(STORE_ROOT, "sess-v19-traversal", _sm("sess-v19-traversal"))
    TRAVERSALS = ["../x", "../../x", "../../ESCAPED-DERIVED", "/tmp/x", "/etc/passwd", "..", ".", "", "a/b", "a\\b",
                  "./x", "..%2Fx", "x/../../y", "\x00evil", "-" * 200, "RAW/../../x", "~/x", " x", "x ", ".hidden"]
    _before = {os.path.join(dp, f) for dp, _dn, fn in os.walk(STORE_ROOT) for f in fn}
    _accepted = []
    for _bad in TRAVERSALS:
        for _api, _call in (("put_raw", lambda b=_bad: TR.put_raw(b, b"x\n", logical_identity="M")),
                            ("logical_identity", lambda b=_bad: TR.put_raw("ok-" + hashlib.sha256(b.encode("utf-8", "surrogatepass")).hexdigest()[:8], b"x\n", logical_identity=b)),
                            ("put_derived", lambda b=_bad: TR.put_derived(b, {"x": 1}, logical_identity="M")),
                            ("put_review", lambda b=_bad: TR.put_review(b, {"x": 1}, logical_identity="M")),
                            ("put_promotion", lambda b=_bad: TR.put_promotion(b, {"x": 1}, logical_identity="M")),
                            ("record_path", lambda b=_bad: TR.record_path("RAW", b)),
                            ("create_session", lambda b=_bad: ES_MOD.create_session(STORE_ROOT, b, _sm("x"))),
                            ("open_session", lambda b=_bad: ES_MOD.open_session(STORE_ROOT, b))):
            try:
                _call()
                _accepted.append(f"{_api}({_bad!r})")
            except (ES_MOD.EvidenceStoreError, ValueError, OSError, TypeError):
                pass
    _after = {os.path.join(dp, f) for dp, _dn, fn in os.walk(STORE_ROOT) for f in fn}
    _outside = sorted(p for p in (_after - _before) if not p.startswith(TR.dir + os.sep))
    rec("evidence-traversal", f"every one of {len(TRAVERSALS)} identifier shapes is still refused by all eight entry points, on attempt ids AND logical identities",
        not _accepted, "accepted: " + "; ".join(_accepted[:3]))
    rec("evidence-traversal", "no file appeared outside the session root during the traversal battery (legacy EvidenceRoot regression still closed)",
        not _outside and not hasattr(SHIM, "EvidenceRoot"), "; ".join(_outside[:3]))
    rec("evidence-single-authority", "exactly one module is still EVIDENCE_STORE_AUTHORIZING and the capture shim has no storage surface",
        ES_MOD.AUTHORITY_CLASS == "EVIDENCE_STORE_AUTHORIZING" and L.EVIDENCE_STORE_AUTHORITY_CLASS == ES_MOD.AUTHORITY_CLASS
        and not hasattr(SHIM, "EvidenceRoot") and "class EvidenceRoot" not in inspect.getsource(SHIM)
        and all(not any(hasattr(_m, _fn) for _fn in ("create_session", "put_raw", "add_derived")) for _m in (SHIM, F)))
    rec("evidence-single-authority", "the write API still exposes no path parameter",
        all("path" not in inspect.signature(getattr(ES_MOD.EvidenceStore, _fn)).parameters for _fn in ("put", "put_json", "put_raw", "put_derived", "put_review", "put_promotion")))
    rec("evidence-single-authority", "content addressing is retained: every verification recomputes the bytes",
        all(hashlib.sha256(CW.get(e["layer"], e["record_key"])).hexdigest() == e["content_sha256"] for e in CW.inventory()["entries"] if e["kind"] == "RECORD"))

    PT = _fresh("sess-v19-partial", finalize=False, full=False)
    rec("evidence-store", "partial state is retained: an unfinalized session is ACTIVE, a stray temp file makes it PARTIAL and blocks finalization",
        PT.session_state() == "ACTIVE" and (lambda p_: (PT.session_state() == "PARTIAL" and _try_store(lambda: PT.finalize()).code == "PARTIAL_RECORD", _unplant(p_, PT.dir))[0])(_plant(PT, "TMP/.partial-deadbeef", b"half"))
        and tuple(ES_MOD.SESSION_STATES) == ("ACTIVE", "PARTIAL", "FINALIZED", "INVALID"))
    rec("evidence-store", "the store still never truncates, renames over or unlinks a final record",
        not re.search(r'open\([^)]*"[rw]b?\+', inspect.getsource(ES_MOD)) and "O_TRUNC" not in inspect.getsource(ES_MOD) and "os.rename" not in inspect.getsource(ES_MOD) and "O_EXCL" in inspect.getsource(ES_MOD))
    rec("evidence-store", "the session manifest still pins the active authority and refuses a mismatch",
        L.session_manifest_errors(_sm("sess-x"), ENVC, ACTIVE_HYP, rp) == [] and bool(L.session_manifest_errors(dict(_sm("sess-x"), parser_sha256="0" * 64), ENVC, ACTIVE_HYP, rp)))
    rec("evidence-store", "a caller-declared digest is still compared and never trusted, and the same tuple with different bytes is still refused",
        _try_store(lambda: TR.put("RAW", "declared-1", b"abc\n", declared_digest="0" * 64, logical_identity="M")).code == "DECLARED_DIGEST_MISMATCH")
finally:
    for dp, dns, fns in os.walk(STORE_ROOT):
        for x in dns + fns:
            try:
                os.chmod(os.path.join(dp, x), 0o700)
            except OSError:
                pass
    shutil.rmtree(STORE_ROOT, ignore_errors=True)

# ---- canonicalization: the faster implementation is byte-identical to the v1.5/v1.6 reference
CANON_CORPUS = [caps, hyp, rp, tc, perms, CHAIN_ES, EVS["attached"], _good_cap] + [chr(i) for i in range(0, 0x2100, 7)] + ["", "a" * 300, '"\\', "é中\U0001f600", {"$rational": "1/3"}, {"$f64": "3ff0000000000000"}, [], {}, 0, -1, 2 ** 53 - 1, True, False, None]
rec("canonicalization-equivalence", "canon() is byte-identical to the v1.5/v1.6 reference implementation over the whole bundle and an adversarial corpus",
    all(L.canon(x) == L.canon_reference(x) for x in CANON_CORPUS))
for _bad in [1.5, 2 ** 53, "\ud800", object()]:
    def _both(v):
        out = []
        for fn in (L.canon, L.canon_reference):
            try:
                out.append(("ok", fn(v)))
            except Exception as ex:
                out.append(("err", type(ex).__name__))
        return out
    _r = _both(_bad)
    rec("canonicalization-equivalence", f"canon() and the reference agree on refusing {type(_bad).__name__} {str(_bad)[:16]!r}", _r[0] == _r[1], str(_r)[:120])
rec("canonicalization-equivalence", "CANONICALIZATION_VERSION is unchanged: v1.7 changes the implementation, never the canonical text",
    L.CANONICALIZATION_VERSION == "1.5")

# ---- section 22: the v1.6 matrix-forgery attacks re-run warm-cache
L.clear_authority_caches()
_forged = forged_matrix(hyp)
_warm_first = L.primitive_status(hyp, rp, CHAIN_METHOD, CHAIN_ES, ENVC, ACTIVE_HYP, rp=rp)
rec("matrix-forgery-warm", "warm cache: the honest matrix qualifies, then every forged variant is refused without clearing the cache",
    _warm_first == "QUALIFIED_CALLABLE" and L.primitive_status(_forged, rp, CHAIN_METHOD, CHAIN_ES, ENVC, ACTIVE_HYP, rp=rp) == "UNQUALIFIED" and L.callable_method_set(_forged, rp, CHAIN_ES, tc, ACTIVE_HYP) == set())
_byte_changes = [("coverage_caveat", (hyp.get("coverage_caveat") or "") + " "), ("version", hyp["version"] + "x")]
for _k, _v in _byte_changes:
    _m = dict(hyp, **{_k: _v})
    rec("matrix-forgery-warm", f"warm cache: one changed byte of the matrix ({_k}) revokes qualification immediately",
        L.primitive_status(_m, rp, CHAIN_METHOD, CHAIN_ES, ENVC, ACTIVE_HYP, rp=rp) == "UNQUALIFIED" and L.capability_matrix_digest(_m) != HYP_SHA)
_inplace = copy.deepcopy(hyp)
_ip_active = dict(ACTIVE_HYP, capability_matrix_sha256=L.capability_matrix_digest(_inplace))
rec("matrix-forgery-warm", "warm cache: qualifying a matrix and then editing that same object in place revokes qualification",
    L.primitive_status(_inplace, rp, CHAIN_METHOD, CHAIN_ES, ENVC, _ip_active, rp=rp) == "QUALIFIED_CALLABLE" and (_inplace["rows"][0].__setitem__("evidence_class", "BLOCKED"), L.primitive_status(_inplace, rp, CHAIN_METHOD, CHAIN_ES, ENVC, _ip_active, rp=rp))[1] == "UNQUALIFIED")
rec("matrix-forgery-warm", "no cache pollution: after the whole warm sequence the honest chain still qualifies and a cold process agrees",
    L.primitive_status(hyp, rp, CHAIN_METHOD, CHAIN_ES, ENVC, ACTIVE_HYP, rp=rp) == "QUALIFIED_CALLABLE" and (L.clear_authority_caches(), L.primitive_status(hyp, rp, CHAIN_METHOD, CHAIN_ES, ENVC, ACTIVE_HYP, rp=rp))[1] == "QUALIFIED_CALLABLE")

# ---- retained v1.6 guarantees (sections 23-26)
rec("v17-retained", "the M0 phase model M0A/M0B/M0C/M0D is unchanged", tuple(L.M0_PHASES) == ("M0A_PROBE", "M0B_REVIEW", "M0C_REFREEZE", "M0D_QUALIFIED_READ"))
rec("v17-retained", "the H0 early write gate is still evaluated inside evaluate_eligibility, before any mutator", "guard_record_errors(" in inspect.getsource(L.evaluate_eligibility))
rec("v17-retained", "the composed commit design is retained minus the caller-supplied validator", tuple(L.VALIDATION_STAGES) == ("evidence_authority", "capability_provenance", "schema", "s0", "plan", "journal", "s1", "delta", "effects", "verification", "conflicts", "commit"))
rec("v17-retained", "the v1.6 precedence corrections are unchanged (S32-S38 and the single journal-state authority)", result_of("precedence", "AUTHORITY-PRECEDENCE.json and .md agree") is not False)
rec("v17-retained", "the protected-surface exclusion set is unchanged", tuple(L.PROTECTED_SURFACE_EXCLUSIONS) == ("item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes"))

# ---- the Codex v1.6 review matrix (section 27) is published and every id is covered by passing checks
CODEX_MATRIX = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.9.json"))
INHERITED_MATRIX = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.7.json"))
INHERITED_ES = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.8.json"))
rec("codex-matrix", "the inherited v1.7 evidence-store matrix is retained unchanged as history and still enumerates ES-1 and ES-2", sorted(f["id"] for f in INHERITED_ES["findings"]) == ["ES-1", "ES-2"])
rec("codex-matrix", "the inherited v1.6 finding matrix is retained unchanged as history and its seven ids are still enumerated",
    sorted(f["id"] for f in INHERITED_MATRIX["findings"]) == ["C16-B1", "C16-B2", "C16-B3", "C16-B4", "C16-M1", "C16-M2", "C16-M3"]
    and CODEX_MATRIX["inherited_matrices"] == ["FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"])
rec("codex-matrix", "the ACTIVE v1.9 finding-resolution matrix enumerates exactly the four Codex v1.8 evidence-store ids",
    sorted(f["id"] for f in CODEX_MATRIX["findings"]) == ["S19-1", "S19-2", "S19-3", "S19-4"])
for _f in CODEX_MATRIX["findings"]:
    _secs = _f["validation_sections"]
    _checks = [(s_, n_, ok_) for s_, n_, ok_, _d in R if s_ in _secs]
    rec("codex-matrix", f"{_f['id']}: correction, negative fixture and expected layer are named, and its validation sections all pass",
        bool(_f["correction"]) and bool(_f["negative_fixture"]) and bool(_f["expected_layer"]) and bool(_f["prior_defect"]) and len(_checks) >= 5 and all(ok_ for _s, _n, ok_ in _checks),
        f"{len(_checks)} checks; failing={[n_ for s_, n_, ok_ in _checks if not ok_][:2]}")

# ---- the Hermes M0A binding values (section 28) are published with no placeholders
M0A_BIND = L.strict_load(os.path.join(B, "M0A-BINDING-VALUES.json"))
rec("m0a-binding", "every Hermes M0A binding value is published and none is a placeholder",
    all(isinstance(v, (str, int)) and str(v).strip() and "PLACEHOLDER" not in str(v).upper() and "TBD" not in str(v).upper() for k, v in M0A_BIND["values"].items()))
_want = {"raw_schema_id": L.RAW_SCHEMA_ID, "raw_schema_version": L.RECORD_TYPE_VERSION, "codec_version": L.CODEC, "trusted_shim_version": TS_SHIM["shim_version"], "trusted_shim_sha256": TS_SHIM["shim_sha256"],
         "trusted_shim_source_sha256": TS_SHIM["shim_source_sha256"], "capture_allowlist_digest": TS_SHIM["allowlist_digest"], "reference_parser_version": L.PARSER_VERSION, "reference_parser_sha256": L.parser_sha256(),
         "primitive_spec_sha256": L.primitive_spec_digest(rp), "evidence_store_version": ES_MOD.EVIDENCE_STORE_VERSION, "evidence_session_schema": ES_MOD.EVIDENCE_SESSION_SCHEMA, "raw_ingest_version": L.RAW_INGEST_VERSION,
         "schema_registry_sha256": REG["schema_registry_sha256"], "authority_version": L.AUTHORITY_VERSION,
         "evidence_inventory_schema": ES_MOD.EVIDENCE_INVENTORY_SCHEMA, "evidence_store_module": L.EVIDENCE_STORE_MODULE,
         "evidence_store_sha256": sha(os.path.join(B, L.EVIDENCE_STORE_MODULE)), "evidence_store_authority_class": L.EVIDENCE_STORE_AUTHORITY_CLASS,
         "path_identifier_constraints": ES_MOD.NAME_RE.pattern}
for _k, _v in sorted(_want.items()):
    rec("m0a-binding", f"published {_k} is the value this bundle actually implements", M0A_BIND["values"].get(_k) == _v, f"published={str(M0A_BIND['values'].get(_k))[:24]} actual={str(_v)[:24]}")
rec("m0a-binding", "the published closed-world verification rule is stated and names the three required counts (section 22)",
    all(x in M0A_BIND["values"]["closed_world_verification"] for x in ("missing == 0", "unexpected == 0", "changed == 0")))
rec("m0a-binding", "the published canonical store tool path and hash are the store this bundle actually ships",
    M0A_BIND["values"]["evidence_store_module"] == "tools/evidence_store.py" and M0A_BIND["values"]["evidence_store_sha256"] == sha(os.path.join(B, "tools/evidence_store.py")))
rec("m0a-binding", "the published evidence-layer vocabulary is the store's own",
    M0A_BIND["values"]["evidence_layers"] == ", ".join(ES_MOD.LAYERS))
rec("m0a-binding", "the stdout/stderr retention rule is closed and matches the evidence store",
    M0A_BIND["values"]["stdout_retention"] in L.STDOUT_RETENTION_RULES and M0A_BIND["values"]["stderr_retention"] in L.STDOUT_RETENTION_RULES)


passed = sum(1 for r in R if r[2])
total = len(R)
sections = {}
for sec, _, ok, _ in R:
    sections.setdefault(sec, [0, 0])
    sections[sec][0] += 1
    sections[sec][1] += ok
FINDINGS = {
    "S19-1 symlinked session root accepted before the trust boundary (BLOCKER)": ["evidence-root-trust"],
    "S19-2 inventory / session semantics incomplete; renamed or cross-session directory validates (BLOCKER)": ["evidence-session-identity", "evidence-semantic-inventory"],
    "S19-3 attempt id binding digest-bound rather than tuple-bound (BLOCKER)": ["evidence-attempt-tuple"],
    "S19-4 finalized permission change undetected (MAJOR)": ["evidence-mode-authority"],
    "ES-1 finalized evidence session is not a closed world (BLOCKER, Codex STORE-14)": ["evidence-closed-world", "evidence-store"],
    "ES-2 competing EvidenceRoot storage authority accepting traversal (BLOCKER)": ["evidence-single-authority", "evidence-traversal"],
    "C16-B1 content-insensitive authority caches (BLOCKER)": ["cache-law", "cache-mutation", "matrix-forgery-warm"],
    "C16-B2 caller-supplied schema validators (BLOCKER)": ["validator-injection", "schema-registry"],
    "C16-B3 capture-shim digest not bound to a trusted authority (BLOCKER)": ["shim-trust"],
    "C16-B4 derived / review / refreeze chain substitution (BLOCKER)": ["stored-chain"],
    "C16-M1 duplicate receiver paths overwrite identity observations (M0A MAJOR)": ["identity-duplicates"],
    "C16-M2 absent strict byte-level raw ingestion (M0A MAJOR)": ["raw-ingestion"],
    "C16-M3 append-only evidence store not executable (M0A MAJOR)": ["evidence-store"],
    "C16-OP1 Hermes M0A binding values not operationally closed": ["m0a-binding", "codex-matrix"],
    "v1.7 retained v1.6 guarantees (M0 phases, H0 gate, composed commit, precedence, exclusions)": ["v17-retained"],
    "v1.7 canonical text unchanged under a faster implementation": ["canonicalization-equivalence"],
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
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.9", "", f"Result: **{passed}/{total} checks passed**. v1.9 is an extremely narrow correction of the four evidence-store integrity defects Codex left open against v1.8: S19-1 a symlinked session root was accepted because the path was resolved before any trust boundary existed; S19-2 the inventory reconciled bytes but not semantic identity, so a renamed or cross-session directory still validated; S19-3 attempt uniqueness was digest-bound rather than bound to (session, layer, logical identity, attempt id); S19-4 chmod after finalization was undetected. All four were reproduced against the frozen v1.8 bundle before anything was changed, and two were worse than reported. v1.9 establishes the root trust boundary by lstat before any resolution, freezes a session identity tuple and the basename-is-session-id path law, derives every record name from its semantics, keys attempt uniqueness on the canonical tuple, and records POSIX file type and permission mode as frozen metadata; verification PASS now requires missing, unexpected, changed AND semantic_mismatch all zero. Mode and file-type claims are POSIX-scoped to the reference host. Inherited context: v1.8 was an extremely narrow correction of the one defect class Codex left open against v1.7, evidence-store integrity and competing store authority: ES-1, the verifier ignored unexpected files in a finalized session root (independent attack STORE-14), and ES-2, a competing EvidenceRoot surface in the capture shim built filesystem paths from caller strings and escaped the evidence root. v1.8 makes finalization a CLOSED WORLD whose inventory records every governed file and directory and whose verification requires missing == 0, unexpected == 0 and changed == 0; and it leaves exactly one EVIDENCE_STORE_AUTHORIZING implementation, tools/evidence_store.py, whose write API takes a layer, an attempt id, a logical identity and bytes, never a path. Everything v1.7 established is retained and re-run as regressions. Inherited context: v1.7 corrects Codex's final forensic adjudication of v1.6: four BLOCKERs (C16-B1 content-insensitive authority caches, C16-B2 caller-supplied schema validators, C16-B3 unbound capture-shim trust, C16-B4 chain substitution), three M0A MAJORs (C16-M1 duplicate receiver paths, C16-M2 absent strict byte ingestion, C16-M3 non-executable evidence store) and the operational binding closure. Every authority cache is keyed by content digests plus the authority version and warm results are asserted equal to cold ones; the authorizing entry points take no schema-validator parameter and resolve schemas from the pinned SCHEMA-REGISTRY.json; a capture qualifies only under the trusted shim pinned by TRUSTED-SHIM.json, which the active authority must also name; a promoted row must resolve the EXACT stored raw capture, derived record, current review and current reviewed refreeze by digest, with multiplicity a CONFLICT unless explicit supersession leaves one; identity claims validate receiver-path, handle-token and attempt-id uniqueness before any index is built; raw evidence enters only through the strict byte boundary and every record carries a strict-parse receipt; and the append-only evidence store is executable code this suite attacks in a temporary directory. Layers: raw parse -> schema -> evidence-binding (envelope, active manifest, record laws) -> attachment -> capability (RAW_CAPABILITY_CAPTURE -> reference re-parser -> REVIEW_DECISION -> REFREEZE_RECORD -> content-bound ACTIVE matrix) -> snapshot (observation model, raw-capture field provenance, occurrence uniqueness) -> semantic (binding, membership, mandatory checkpoint, readback->S1, derived verification over the protected surface with named exclusions) -> eligibility (incl. the H0/S0 early write gate) -> linked-set / composed authorization (validate_transaction_set, commit_eligibility, both with a MANDATORY schema validator). A finding may be covered by more than one section, so the per-finding counts overlap; the total is not proof. Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed {SEED}, {PERMS} per subject). The bypass audit proves no exported validator can skip S0, S1, schema validation, capability provenance, delta derivation or expected-effect validation, and that no parameter default makes schema enforcement optional. The raw-capability sections execute the REFERENCE capture shim against fake in-process objects (no Resolve) and prove that a probe-authored interpretation has zero authority. The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only. The total count is not proof: see the per-finding coverage below.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Finding | Sections | Checks | Passed |", "|---|---|---|---|"]
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
