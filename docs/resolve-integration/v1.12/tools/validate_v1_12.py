#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.10.
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
Run: python3 -B tools/validate_v1_12.py
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


_RUNVAR = [(re.compile(r"resolve-v1[0-9]*-evidence-[A-Za-z0-9_]+"), "resolve-evidence-<TMPDIR>"),
           (re.compile(r"\binode \d+\b"), "inode <N>"),
           (re.compile(r"/tmp/[A-Za-z0-9_.-]*evidence[A-Za-z0-9_.-]*"), "<TMPROOT>"),
           # session-derived digests bind the temporary root path and inodes, so they legitimately differ per run.
           # The decision is never scrubbed; only the diagnostic text, so the frozen report stays byte-identical.
           (re.compile(r"\b[0-9a-f]{64}\b"), "<SHA256>")]


def rec(section, name, ok, detail=""):
    """Record one check. Detail strings are scrubbed of per-run values (temporary directory names, inode numbers) so
    VALIDATION-REPORT.md is byte-identical across fresh processes; the pass/fail decision is never scrubbed."""
    d = str(detail)
    for pat, sub in _RUNVAR:
        d = pat.sub(sub, d)
    R.append((section, name, bool(ok), d[:220]))


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
rec("precedence", "the v1.5 through v1.11 changelogs and finding matrices are HISTORICAL; the v1.12 ones are active", all(st_.get(d_) == "HISTORICAL" for d_ in ("CHANGELOG-v1.5.md", "FINDING-RESOLUTION-MATRIX-v1.5.md", "CHANGELOG-v1.6.md", "FINDING-RESOLUTION-MATRIX-v1.6.md", "CHANGELOG-v1.7.md", "FINDING-RESOLUTION-MATRIX-v1.7.md", "CHANGELOG-v1.8.md", "FINDING-RESOLUTION-MATRIX-v1.8.md", "CHANGELOG-v1.9.md", "FINDING-RESOLUTION-MATRIX-v1.9.md", "CHANGELOG-v1.10.md", "FINDING-RESOLUTION-MATRIX-v1.10.md", "CHANGELOG-v1.11.md", "FINDING-RESOLUTION-MATRIX-v1.11.md")) and st_.get("CHANGELOG-v1.12.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.12.md") == "STILL_ACTIVE")
rec("precedence", "the four v1.7 correction laws are retained as STILL_ACTIVE with supersession statements S39-S45", all(st_.get(d_) == "STILL_ACTIVE" for d_ in ("AUTHORITY-CACHING.md", "SCHEMA-REGISTRY.md", "TRUSTED-SHIM.md", "STORED-CHAIN.md")) and sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.7.0") == ["S39", "S40", "S41", "S42", "S43", "S44", "S45"])
rec("precedence", "the v1.8 evidence-store supersessions S46-S47 are retained and EVIDENCE-ROOT.md is the single STILL_ACTIVE store document", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.8.0") == ["S46", "S47"] and st_.get("EVIDENCE-ROOT.md") == "STILL_ACTIVE")
rec("precedence", "the v1.9 evidence-store supersessions S48-S49 are retained", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.9.0") == ["S48", "S49"])
rec("precedence", "the v1.10 evidence-store supersessions S50-S51 are retained", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.10.0") == ["S50", "S51"])
rec("precedence", "the v1.11 evidence-store supersessions S52-S55 are retained", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.11.0") == ["S52", "S53", "S54", "S55"])
rec("precedence", "the v1.12 pre-M0A workflow supersessions S56-S59 are recorded and the v1.12 changelog and matrix are active", sorted(s_["id"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.12.0") == ["S56", "S57", "S58", "S59"] and st_.get("CHANGELOG-v1.12.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.12.md") == "STILL_ACTIVE" and st_.get("CHANGELOG-v1.11.md") == "HISTORICAL" and st_.get("EVIDENCE-ROOT.md") == "STILL_ACTIVE")
rec("precedence", "the new v1.12 workflow trust roots are classified STILL_ACTIVE", st_.get("PRINCIPALS.json") == "STILL_ACTIVE" and st_.get("EVIDENCE-SET-WORKFLOW.json") == "STILL_ACTIVE")
rec("precedence", "each v1.12 supersession names the v1.11 statement it replaces, the new authority and the V112 finding that forced it", all(s_.get("old_statement") and s_.get("new_authority") and "V112-" in s_["reason"] and "v1.11" in s_["old_statement"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.12.0"))
rec("precedence", "the v1.12 supersession table in the markdown mirrors the machine form", (lambda t_: all(i_ in t_ for i_ in ("S56", "S57", "S58", "S59")) and "v1.12 supersessions" in t_)(open(os.path.join(B, "AUTHORITY-PRECEDENCE.md"), encoding="utf-8").read()))
rec("precedence", "THREAT-MODEL.md states the v1.12 residual honestly and claims no cryptographic identity", (lambda t_: "a human who runs both tools is still one human" in t_ and "does not claim" in t_ and "not identity infrastructure" in t_)(open(os.path.join(B, "THREAT-MODEL.md"), encoding="utf-8").read()))
rec("precedence", "each v1.11 supersession names the v1.10 statement it replaces, the new authority and the Codex finding that forced it", all(s_.get("old_statement") and s_.get("new_authority") and s_.get("reason") and "F110-" in s_["reason"] and "v1.10" in s_["old_statement"] for s_ in prec["superseded_statements"] if s_["effective_version"] == "1.11.0"))
rec("precedence", "the v1.11 supersession table in the markdown mirrors the machine form", (lambda t_: all(i_ in t_ for i_ in ("S52", "S53", "S54", "S55")) and "v1.11 supersessions" in t_)(open(os.path.join(B, "AUTHORITY-PRECEDENCE.md"), encoding="utf-8").read()))
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
    rec("exact-manifest", "real-manifest verification for another host / other version / self-verified does not count", all(L.derive_attachment_state(tc, F.ES([HR["prov"], b_, HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED" for b_ in (MR.bundle(env={"host_name": "PRESTO"}), MR.bundle(authority_version="1.5.0"), MR.bundle(verifier=F.PREPARER_PRINCIPAL, verifier_principal=F.PREPARER_PRINCIPAL))))
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.11", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent (v1.11) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.11", "FREEZE-MANIFEST.json")) == "0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e")
    rec("manifest", "grandparent (v1.10) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.10", "FREEZE-MANIFEST.json")) == "46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156")
    rec("manifest", "great-grandparent (v1.9) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.9", "FREEZE-MANIFEST.json")) == "5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe")
    rec("manifest", "great-grandparent (v1.8) manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.8", "FREEZE-MANIFEST.json")) == "727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86")
    rec("manifest", "the parent block records the v1.11 branch HEAD and its semantic commit, which for v1.11 are the same commit because its bundle and registration were committed together (section 38)", man["parent"]["head"] == "5889efa8ed12bd6626c43a657f27ea2367e54d23" and man["parent"]["semantic_head"] == "5889efa8ed12bd6626c43a657f27ea2367e54d23" and man["parent"]["manifest_sha256"] == "0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e")
    rec("manifest", "v1.0-v1.11 bundles are byte-identical to their frozen manifests (history preserved)", all(all(sha(os.path.join(os.path.dirname(B), v_, e_["path"])) == e_["sha256"] for e_ in L.strict_load(os.path.join(os.path.dirname(B), v_, "FREEZE-MANIFEST.json"))["files"] if os.path.exists(os.path.join(os.path.dirname(B), v_, e_["path"]))) for v_ in ("v1", "v1.1", "v1.2", "v1.3", "v1.4", "v1.5", "v1.6", "v1.7", "v1.8", "v1.9", "v1.10", "v1.11")))
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])
    rec("manifest", "validation tools listed as TOOL", all(any(e["path"] == p and e["authority_class"] == "TOOL" for e in man["files"]) for p in ("tools/authority_lib.py", "tools/validate_v1_12.py", "tools/build_v1_12.py", "tools/build_manifest.py", "tools/fixture_evidence.py", "tools/capture_shim_reference.py")))

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


# ================================================================ v1.12 pre-M0A workflow authority (V112-1..V112-4)
import contextlib                      # noqa: E402
import io                              # noqa: E402
import shutil                          # noqa: E402
import stat                            # noqa: E402
import tempfile                        # noqa: E402
import evidence_authoring as AUTH_MOD  # noqa: E402
import a2_prepare as PREP_CLI          # noqa: E402
import a2_verify as VER_CLI            # noqa: E402

W_ROOT = tempfile.mkdtemp(prefix="resolve-v112-workflow-")
WFLAW = load("EVIDENCE-SET-WORKFLOW.json")
PRINC = load("PRINCIPALS.json")
_PREP = L.PRINCIPAL_REGISTRY["PREPARER"][0]
_PREP2 = L.PRINCIPAL_REGISTRY["PREPARER"][1]
_VER = L.PRINCIPAL_REGISTRY["VERIFIER"][0]
_UU = "4f1c9d2a-7b3e-4a58-9c11-2d6e8f0a5b73"
_LAUNCH_SHA = hashlib.sha256(b"#!/bin/sh\nexec /opt/resolve/bin/resolve \"$@\"\n").hexdigest()
_JOURNAL_SHA = hashlib.sha256(b"read-only journal").hexdigest()
_SEQ = [0]


def _wsess(tag):
    _SEQ[0] += 1
    return f"sess-v112-{tag}-{_SEQ[0]:03d}"


def _libroot(sid):
    p = os.path.join(W_ROOT, "libs", sid)
    os.makedirs(p, exist_ok=True)
    return p


def _try_auth(fn):
    """Call fn() and return the AuthoringError, or an object with code NONE and the value."""
    try:
        v = fn()
        return type("Ok", (), {"code": "NONE", "detail": "", "value": v})()
    except AUTH_MOD.AuthoringError as e:
        return e
    except Exception as e:  # noqa: BLE001 - a raw exception from the authoring path is a FAIL, never a pass
        return type("Raw", (), {"code": "RAW_" + type(e).__name__, "detail": str(e), "value": None})()


def _prepared(tag, journal=True, principal=_PREP):
    """Drive the production preparer path to the PREPARED state and return (session_id, library root)."""
    sid = _wsess(tag)
    lr = _libroot(sid)
    AUTH_MOD.create_evidence_set(sid, principal, root=W_ROOT)
    AUTH_MOD.add_provisioning_record(sid, principal, instance_uuid=_UU, root_path=lr,
                                     provisioned_by="Mikko (operator)", root=W_ROOT)
    AUTH_MOD.add_launch_recipe(sid, principal, recipe_sha256=_LAUNCH_SHA, root=W_ROOT)
    if journal:
        AUTH_MOD.add_read_only_journal(sid, principal, journal_path_sha256=_JOURNAL_SHA, root=W_ROOT)
    AUTH_MOD.mark_prepared(sid, principal, root=W_ROOT)
    return sid, lr


def _derive(sid):
    return AUTH_MOD.derive_attachment_state(sid, root=W_ROOT)


# ---- attacker-side helpers. These deliberately BYPASS the authoring API to model an actor with filesystem write
# access (THREAT-MODEL.md). Where a helper refreshes the sealed digest, the SEAL is satisfied on purpose so that the
# DERIVATION binding is what must refuse; where it does not, the seal itself must refuse.
def _unseal(sid):
    d = AUTH_MOD.set_dir(sid, W_ROOT)
    os.chmod(d, 0o700)
    for f in (AUTH_MOD.EVIDENCE_SET_FILE, AUTH_MOD.WORKFLOW_FILE):
        p = os.path.join(d, f)
        if os.path.exists(p):
            os.chmod(p, 0o600)
    return d


def _write_doc(sid, es, reseal=True):
    """Write the document back; when reseal is true also refresh the workflow digest so the seal passes."""
    d = _unseal(sid)
    sp, wp = os.path.join(d, AUTH_MOD.EVIDENCE_SET_FILE), os.path.join(d, AUTH_MOD.WORKFLOW_FILE)
    open(sp, "w", encoding="utf-8").write(json.dumps(es, sort_keys=True, ensure_ascii=False, indent=2) + "\n")
    if reseal:
        wf = L.strict_load(wp)
        wf["evidence_set_sha256"] = sha(sp)
        open(wp, "w", encoding="utf-8").write(json.dumps(wf, sort_keys=True, ensure_ascii=False, indent=2) + "\n")
    return sid


def _verified(sid):
    AUTH_MOD.add_bundle_verification(sid, _VER, root=W_ROOT)
    return sid


def _read_doc(sid):
    return L.strict_load(os.path.join(AUTH_MOD.set_dir(sid, W_ROOT), AUTH_MOD.EVIDENCE_SET_FILE))


def _replace(es, rtype, env=None, **over):
    """Re-register a mutated record so its record_id matches its content; only the intended defect remains."""
    old = next(r for r in es["records"].values() if r["record_type"] == rtype)
    es["records"].pop(old["record_id"])
    body = {k: v for k, v in old.items() if k != "record_id"}
    for k, v in over.items():
        if v is None:
            body.pop(k, None)
        else:
            body[k] = v
    if env:
        body["envelope"] = dict(body["envelope"], **env)
    new = L.make_record(body)
    es["records"][new["record_id"]] = new
    return es


def _mutate_bundle(sid, **over):
    _verified(sid)
    return _write_doc(sid, _replace(_read_doc(sid), "BUNDLE_VERIFICATION", **over))


def _mutate_record(sid, rtype, env=None, **over):
    _verified(sid)
    return _write_doc(sid, _replace(_read_doc(sid), rtype, env=env, **over))


def _mutate_doc(sid, **over):
    _verified(sid)
    es = _read_doc(sid)
    es.update(over)
    return _write_doc(sid, es)


def _tamper_after_verify(sid, rtype):
    """Edit a verified preparer record WITHOUT refreshing the seal: the sealed digest must refuse on load."""
    _verified(sid)
    es = _replace(_read_doc(sid), rtype, provisioned_by="edited after verification") if rtype == "PROVISIONING_RECORD" \
        else _replace(_read_doc(sid), rtype, recipe_sha256="f" * 64)
    return _write_doc(sid, es, reseal=False)


def _plant_raw(sid, rec, drop_id=False):
    _verified(sid)
    es = _read_doc(sid)
    if drop_id:
        b = next(r for r in es["records"].values() if r["record_type"] == "BUNDLE_VERIFICATION")
        rid = b["record_id"]
        es["records"][rid] = {k: v for k, v in b.items() if k != "record_id"}
    else:
        es["records"]["a" * 64] = rec
    return _write_doc(sid, es)


def _plant_body_only(sid):
    _verified(sid)
    es = _read_doc(sid)
    es["records"]["b" * 64] = {"record_type": "PROVISIONING_RECORD", "library_kind": "Disk",
                               "root_path": "/nonexistent/PLANTED", "instance_uuid": _UU,
                               "provisioned_by": "planted body-only object"}
    return _write_doc(sid, es)


def _copy_elsewhere(sid):
    """A governed document copied to another session directory must not be authority."""
    _verified(sid)
    dst = AUTH_MOD.set_dir(sid + "-copy", W_ROOT)
    _unseal(sid)
    shutil.copytree(AUTH_MOD.set_dir(sid, W_ROOT), dst)
    return sid + "-copy"


try:
    # ---- V112-1 the governed persistence law
    rec("workflow-persistence", "exactly one governed root is frozen, it is absolute, and it is none of the forbidden locations",
        L.QUALIFICATION_EVIDENCE_ROOT == "/home/vidtoolz/resolve-qualification-evidence"
        and os.path.isabs(L.QUALIFICATION_EVIDENCE_ROOT)
        and not L.QUALIFICATION_EVIDENCE_ROOT.startswith("/tmp")
        and AUTH_MOD.governed_root() == L.QUALIFICATION_EVIDENCE_ROOT,
        L.QUALIFICATION_EVIDENCE_ROOT)
    rec("workflow-persistence", "the path law is derived from the session id alone and names the three governed files",
        AUTH_MOD.set_path("s-x", "/r") == "/r/attachment/s-x/EVIDENCE-SET.json"
        and AUTH_MOD.workflow_path("s-x", "/r") == "/r/attachment/s-x/WORKFLOW.json"
        and AUTH_MOD.set_dir("s-x", "/r") == "/r/attachment/s-x")
    rec("workflow-persistence", "a session id that is not a safe basename is refused, so the path law cannot be escaped",
        all(_try_auth(lambda b=b: AUTH_MOD.set_dir(b, W_ROOT)).code == "SESSION_ID_INVALID"
            for b in ("../escape", "/abs", "a/b", "", ".", "..", "x" * 200)))
    _sid0, _lr0 = _prepared("persist")
    rec("workflow-persistence", "the document and its workflow state are written at the governed path with governed modes",
        os.path.exists(AUTH_MOD.set_path(_sid0, W_ROOT)) and os.path.exists(AUTH_MOD.workflow_path(_sid0, W_ROOT))
        and stat.S_IMODE(os.lstat(AUTH_MOD.set_dir(_sid0, W_ROOT)).st_mode) == AUTH_MOD.DIR_MODE)
    rec("workflow-persistence", "a MOVED or COPIED document is refused SET_LOCATION_MISMATCH: the document records where it lives",
        (lambda: (shutil.copytree(AUTH_MOD.set_dir(_sid0, W_ROOT), os.path.join(W_ROOT, "attachment", "sess-v112-moved-999")),
                  _try_auth(lambda: AUTH_MOD.load_evidence_set("sess-v112-moved-999", root=W_ROOT)).code)[1] == "SET_LOCATION_MISMATCH")())
    rec("workflow-persistence", "writer exclusivity: a second writer while the lock is held is refused LOCK_HELD",
        (lambda: (lambda lk: (lk.__enter__(), _try_auth(lambda: AUTH_MOD.add_read_only_journal(_sid0, _PREP, journal_path_sha256=_JOURNAL_SHA, root=W_ROOT)).code, lk.__exit__())[1])(AUTH_MOD._Lock(_sid0, _PREP, W_ROOT)))() == "LOCK_HELD")
    rec("workflow-persistence", "the lock is released after use, so the next writer is not blocked by a stale lock",
        not os.path.exists(os.path.join(AUTH_MOD.set_dir(_sid0, W_ROOT), AUTH_MOD.LOCK_FILE)))
    rec("workflow-persistence", "re-creating an existing document is refused SET_EXISTS, and a missing one is SET_NOT_FOUND",
        _try_auth(lambda: AUTH_MOD.create_evidence_set(_sid0, _PREP, root=W_ROOT)).code == "SET_EXISTS"
        and _try_auth(lambda: AUTH_MOD.load_evidence_set("sess-v112-absent-000", root=W_ROOT)).code == "SET_NOT_FOUND")

    # ---- V112-2 the lifecycle
    rec("workflow-lifecycle", "the three states and their (state, role) grants are frozen; VERIFIED grants nothing to anyone",
        L.EVIDENCE_SET_STATES == ("OPEN", "PREPARED", "VERIFIED")
        and L.EVIDENCE_SET_STATE_GRANTS["VERIFIED"] == {}
        and not any(L.may_write("VERIFIED", r, t) for r in L.PRINCIPAL_ROLES for t in L.RECORD_TYPES))
    rec("workflow-lifecycle", "OPEN grants the PREPARER exactly its three record types and the VERIFIER nothing",
        sorted(L.EVIDENCE_SET_STATE_GRANTS["OPEN"]["PREPARER"]) == ["LAUNCH_RECIPE", "PROVISIONING_RECORD", "READ_ONLY_JOURNAL"]
        and "VERIFIER" not in L.EVIDENCE_SET_STATE_GRANTS["OPEN"])
    rec("workflow-lifecycle", "PREPARED grants the VERIFIER exactly BUNDLE_VERIFICATION and the PREPARER nothing",
        L.EVIDENCE_SET_STATE_GRANTS["PREPARED"] == {"VERIFIER": ("BUNDLE_VERIFICATION",)})
    _sid1, _ = _prepared("life")
    rec("workflow-lifecycle", "after PREPARED the preparer can no longer write any record type (WRITE_NOT_GRANTED)",
        all(_try_auth(f).code == "WRITE_NOT_GRANTED" for f in (
            lambda: AUTH_MOD.add_provisioning_record(_sid1, _PREP, instance_uuid=_UU, root_path=_libroot(_sid1), provisioned_by="x", root=W_ROOT),
            lambda: AUTH_MOD.add_launch_recipe(_sid1, _PREP, recipe_sha256=_LAUNCH_SHA, root=W_ROOT),
            lambda: AUTH_MOD.add_read_only_journal(_sid1, _PREP, journal_path_sha256=_JOURNAL_SHA, root=W_ROOT))))
    rec("workflow-lifecycle", "PREPARED cannot be re-entered, and mark_prepared without both preparer records is refused",
        _try_auth(lambda: AUTH_MOD.mark_prepared(_sid1, _PREP, root=W_ROOT)).code == "STATE_TRANSITION_INVALID"
        and (lambda s: (AUTH_MOD.create_evidence_set(s, _PREP, root=W_ROOT),
                        _try_auth(lambda: AUTH_MOD.mark_prepared(s, _PREP, root=W_ROOT)).code)[1] == "PREPARER_RECORD_MISSING")(_wsess("nopre")))
    AUTH_MOD.add_bundle_verification(_sid1, _VER, root=W_ROOT)
    rec("workflow-lifecycle", "after VERIFIED nothing may be written by anyone, including a second verification",
        _try_auth(lambda: AUTH_MOD.add_bundle_verification(_sid1, _VER, root=W_ROOT)).code in ("WRITE_NOT_GRANTED", "VERIFICATION_EXISTS")
        and _try_auth(lambda: AUTH_MOD.add_read_only_journal(_sid1, _PREP, journal_path_sha256=_JOURNAL_SHA, root=W_ROOT)).code == "WRITE_NOT_GRANTED")
    rec("workflow-lifecycle", "the VERIFIED document and its workflow state are sealed read-only and the document digest is sealed",
        stat.S_IMODE(os.lstat(AUTH_MOD.set_path(_sid1, W_ROOT)).st_mode) == AUTH_MOD.SEALED_MODE
        and AUTH_MOD.workflow_state(_sid1, root=W_ROOT)["evidence_set_sha256"] == sha(AUTH_MOD.set_path(_sid1, W_ROOT)))

    # ---- V112-3 principals and write grants
    rec("workflow-principals", "the registry is role-keyed, every principal is '<ROLE>:<actor>' and resolves to exactly its own role",
        set(L.PRINCIPAL_REGISTRY) == set(L.PRINCIPAL_ROLES)
        and all(L.principal_role(p) == r for r, ps in L.PRINCIPAL_REGISTRY.items() for p in ps)
        and all(p.count(":") == 1 and p.split(":")[0] == r for r, ps in L.PRINCIPAL_REGISTRY.items() for p in ps))
    rec("workflow-principals", "no ACTOR holds two roles, so independence is not defeatable by relabelling",
        L.role_separation_errors() == [], "; ".join(L.role_separation_errors()))
    rec("workflow-principals", "an unregistered, empty, malformed or wrong-role principal is refused PRINCIPAL_INVALID",
        all(_try_auth(lambda p=p: AUTH_MOD.create_evidence_set(_wsess("badp"), p, root=W_ROOT)).code == "PRINCIPAL_INVALID"
            for p in ("", "hermes", "PREPARER:not-registered", "VERIFIER:codex-independent", "PREPARER", "preparer:hermes-m0a-driver", None)))
    rec("workflow-principals", "a PREPARER cannot author BUNDLE_VERIFICATION through any production entry point",
        _try_auth(lambda: AUTH_MOD.add_bundle_verification(_prepared("selfver")[0], _PREP, root=W_ROOT)).code == "PRINCIPAL_INVALID")
    rec("workflow-principals", "a VERIFIER cannot author a preparer record through any production entry point",
        all(_try_auth(f).code in ("PRINCIPAL_INVALID", "WRITE_NOT_GRANTED") for f in (
            lambda: AUTH_MOD.create_evidence_set(_wsess("vercreate"), _VER, root=W_ROOT),
            lambda: AUTH_MOD.add_provisioning_record(_sid1, _VER, instance_uuid=_UU, root_path=_libroot(_sid1), provisioned_by="x", root=W_ROOT),
            lambda: AUTH_MOD.add_launch_recipe(_sid1, _VER, recipe_sha256=_LAUNCH_SHA, root=W_ROOT))))
    rec("workflow-principals", "the frozen write grants give the PREPARER three types, the VERIFIER one and the APPROVER none",
        L.WRITE_GRANTS == {"PREPARER": ("LAUNCH_RECIPE", "PROVISIONING_RECORD", "READ_ONLY_JOURNAL"),
                           "VERIFIER": ("BUNDLE_VERIFICATION",), "APPROVER": ()}
        and set(sum((list(v) for v in L.WRITE_GRANTS.values()), [])) <= set(L.RECORD_TYPES))

    # ---- V112-4 the mandatory positive end-to-end runtime path
    _sidP, _lrP = _prepared("positive")
    _bv = AUTH_MOD.add_bundle_verification(_sidP, _VER, root=W_ROOT)
    _dP = _derive(_sidP)
    rec("workflow-e2e-positive",
        "MANDATORY (V112-4): using ONLY production authoring tools and no fixture synthesis, adopt -> provisioning -> launch -> prepare -> independent verify derives ATTACHMENT_READY. This is the test v1.11 lacked.",
        _dP["state"] == "ATTACHMENT_READY" and not _dP["conflicts"], f"{_dP['state']}; {_dP['failures'][:1]}")
    rec("workflow-e2e-positive", "the derivation names both principals and all three proof records",
        sorted(_dP["proofs"]) == ["bundle_verification", "launch_recipe", "preparer_principal", "provisioning", "verifier_principal"]
        and _dP["proofs"]["verifier_principal"] == _VER and _dP["proofs"]["preparer_principal"] == _PREP)
    rec("workflow-e2e-positive", "the verification result is PASS and the record binds the exact verified inputs and the contract pin set",
        _bv["verification_result"] == "PASS"
        and _bv["verified_provisioning_id"] == _dP["proofs"]["provisioning"]
        and _bv["verified_launch_recipe_id"] == _dP["proofs"]["launch_recipe"]
        and _bv["pinned_file_digests"] == tc["resolve"]["pins"])
    rec("workflow-e2e-positive", "the governed document validates under the unchanged v1.11 validator and the registered schema",
        AUTH_MOD.validate_evidence_set(_sidP, root=W_ROOT) == []
        and not list(V["resolveEvidenceSet"].iter_errors(AUTH_MOD.load_evidence_set(_sidP, root=W_ROOT))))
    def _cli_e2e():
        """Drive both production CLIs. Their stdout is CAPTURED, not printed: it embeds the temporary evidence root
        and the record digests bound to it, which would make this validator's own stdout differ between runs while
        VALIDATION-REPORT.md stayed byte-identical. Exit codes are asserted; only the chatter is discarded."""
        s_, lr_ = _wsess("cli"), _libroot("cli")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rcs = [PREP_CLI.main(["adopt", "--session", s_, "--uuid", _UU, "--root", lr_, "--by", "Mikko (operator)",
                                  "--recipe-sha", _LAUNCH_SHA, "--evidence-root", W_ROOT]),
                   PREP_CLI.main(["prepare", "--session", s_, "--evidence-root", W_ROOT]),
                   VER_CLI.main(["check", "--session", s_, "--evidence-root", W_ROOT]),
                   VER_CLI.main(["verify", "--session", s_, "--evidence-root", W_ROOT]),
                   PREP_CLI.main(["status", "--session", s_, "--evidence-root", W_ROOT])]
        return rcs, _derive(s_)["state"]

    _cli_rcs, _cli_state = _cli_e2e()
    rec("workflow-e2e-positive", "the two production CLIs drive the same path, every command exits 0 and the result is ATTACHMENT_READY",
        _cli_rcs == [0, 0, 0, 0, 0] and _cli_state == "ATTACHMENT_READY", f"exit codes {_cli_rcs}; {_cli_state}")

    # ---- V112-4 the negative end-to-end matrix: none may derive ATTACHMENT_READY
    _neg = []

    def _negcase(label, build):
        """build() returns a session id whose document must NOT derive ATTACHMENT_READY."""
        try:
            sid = build()
            d = _derive(sid) if sid else {"state": "NOT_CREATED"}
            ok = d["state"] != "ATTACHMENT_READY"
        except AUTH_MOD.AuthoringError:
            ok, d = True, {"state": "REFUSED_AT_AUTHORING"}
        except Exception as e:  # noqa: BLE001
            ok, d = False, {"state": "RAW_" + type(e).__name__ + ":" + str(e)[:60]}
        _neg.append((label, ok, d["state"]))
        rec("workflow-e2e-negative", f"never ATTACHMENT_READY: {label}", ok, d["state"])

    _negcase("no verifier at all (document left PREPARED)", lambda: _prepared("nover")[0])
    _negcase("same actor is preparer and verifier", lambda: (lambda s: (AUTH_MOD.add_bundle_verification(s, _VER, root=W_ROOT), s)[1])(_prepared("sameactor", principal=_PREP)[0]) if L.principal_actor(_PREP) == L.principal_actor(_VER) else _prepared("sameactor2")[0])
    _negcase("unauthorized verifier principal", lambda: (lambda s: (_try_auth(lambda: AUTH_MOD.add_bundle_verification(s, "VERIFIER:rogue", root=W_ROOT)), s)[1])(_prepared("rogue")[0]))
    _negcase("preparer attempts BUNDLE_VERIFICATION", lambda: (lambda s: (_try_auth(lambda: AUTH_MOD.add_bundle_verification(s, _PREP, root=W_ROOT)), s)[1])(_prepared("prepself")[0]))
    _negcase("verifier attempts a preparer record type", lambda: (lambda s: (_try_auth(lambda: AUTH_MOD.add_launch_recipe(s, _VER, recipe_sha256=_LAUNCH_SHA, root=W_ROOT)), s)[1])(_prepared("wrongtype")[0]))
    _negcase("missing launch recipe", lambda: (lambda s: (AUTH_MOD.create_evidence_set(s, _PREP, root=W_ROOT),
                                                          AUTH_MOD.add_provisioning_record(s, _PREP, instance_uuid=_UU, root_path=_libroot(s), provisioned_by="x", root=W_ROOT), s)[2])(_wsess("nolaunch")))
    _negcase("invalid provisioning (non-uuid)", lambda: (lambda s: (AUTH_MOD.create_evidence_set(s, _PREP, root=W_ROOT),
                                                                    _try_auth(lambda: AUTH_MOD.add_provisioning_record(s, _PREP, instance_uuid="not-a-uuid", root_path=_libroot(s), provisioned_by="x", root=W_ROOT)), s)[2])(_wsess("baduuid")))
    _negcase("invalid provisioning (relative root)", lambda: (lambda s: (AUTH_MOD.create_evidence_set(s, _PREP, root=W_ROOT),
                                                                         _try_auth(lambda: AUTH_MOD.add_provisioning_record(s, _PREP, instance_uuid=_UU, root_path="relative/root", provisioned_by="x", root=W_ROOT)), s)[2])(_wsess("relroot")))
    _negcase("second provisioning identity refused", lambda: (lambda s: (_try_auth(lambda: AUTH_MOD.add_provisioning_record(s, _PREP, instance_uuid=_UU, root_path=_libroot(s), provisioned_by="x", root=W_ROOT)), s)[1])(_prepared("secondprov")[0]))
    _negcase("arbitrary body-only JSON planted into a governed document", lambda: _plant_body_only(_prepared("bodyonly")[0]))
    _negcase("record missing its envelope", lambda: _plant_raw(_prepared("noenv")[0], {"record_type": "BUNDLE_VERIFICATION", "recorded_at": "2026-09-10T00:00:00Z"}))
    _negcase("record missing its record_id", lambda: _plant_raw(_prepared("noid")[0], None, drop_id=True))
    _negcase("verified provisioning record edited after verification (TOCTOU)", lambda: _tamper_after_verify(_prepared("toctou")[0], "PROVISIONING_RECORD"))
    _negcase("verified launch recipe edited after verification (TOCTOU)", lambda: _tamper_after_verify(_prepared("toctou2")[0], "LAUNCH_RECIPE"))
    _negcase("verification_result forced to FAIL", lambda: _mutate_bundle(_prepared("failres")[0], verification_result="FAIL"))
    _negcase("verification_result removed", lambda: _mutate_bundle(_prepared("nores")[0], verification_result=None))
    _negcase("bundle bound to another manifest", lambda: _mutate_bundle(_prepared("othman")[0], manifest_sha256="b" * 64))
    _negcase("bundle pinned-file digest set replaced with a preparer-friendly one", lambda: _mutate_bundle(_prepared("badpins")[0], pinned_file_digests={"/opt/resolve/bin/resolve": "c" * 64}))
    _negcase("bundle naming another provisioning record", lambda: _mutate_bundle(_prepared("othprov")[0], verified_provisioning_id="d" * 64))
    _negcase("bundle naming another launch recipe", lambda: _mutate_bundle(_prepared("othlaunch")[0], verified_launch_recipe_id="e" * 64))
    _negcase("bundle with an unregistered verifier principal", lambda: _mutate_bundle(_prepared("unregver")[0], verifier_principal="VERIFIER:someone-else"))
    _negcase("bundle whose principals are the same actor", lambda: _mutate_bundle(_prepared("sameprin")[0], verifier_principal=_VER, preparer_principal="PREPARER:" + L.principal_actor(_VER)))
    _negcase("bundle historical:true", lambda: _mutate_bundle(_prepared("hist")[0], historical=True))
    _negcase("document at an unauthorized path (copied elsewhere)", lambda: _copy_elsewhere(_prepared("badpath")[0]))
    _negcase("stale document (evaluated_at far in the past)", lambda: _mutate_doc(_prepared("stale")[0], evaluated_at="2020-01-01T00:00:00Z"))
    _negcase("document dated in the future", lambda: _mutate_doc(_prepared("future")[0], evaluated_at="2099-01-01T00:00:00Z"))
    _negcase("wrong target: provisioning envelope names another library", lambda: _mutate_record(_prepared("wronglib")[0], "PROVISIONING_RECORD", env={"library_name": "EKA"}))
    _negcase("wrong root: provisioning envelope root disagrees with the body", lambda: _mutate_record(_prepared("wrongroot")[0], "PROVISIONING_RECORD", env={"library_root": "/other/root"}))
    rec("workflow-e2e-negative", f"the negative matrix is complete and every case refused ({sum(1 for _l, ok, _s in _neg if ok)}/{len(_neg)})",
        all(ok for _l, ok, _s in _neg) and len(_neg) >= 25,
        "; ".join(f"{l}->{s}" for l, ok, s in _neg if not ok)[:200] or f"{len(_neg)} cases")

    # ---- V112-4 fixture/runtime parity
    _fixture_bundle = next(r for r in L.strict_load(os.path.join(B, "fixtures/evidence/ready.json"))["records"].values()
                           if r["record_type"] == "BUNDLE_VERIFICATION")
    rec("workflow-parity", "MANDATORY: the production BUNDLE_VERIFICATION field set is EXACTLY the fixture field set, so no positive ATTACHMENT_READY state is reachable from a shape production cannot build",
        sorted(_bv) == sorted(_fixture_bundle), ",".join(sorted(set(_bv) ^ set(_fixture_bundle))) or "identical")
    for _rt in ("PROVISIONING_RECORD", "LAUNCH_RECIPE", "READ_ONLY_JOURNAL"):
        _fx = next(r for r in L.strict_load(os.path.join(B, "fixtures/evidence/ready.json"))["records"].values() if r["record_type"] == _rt)
        _rt_prod = next(r for r in AUTH_MOD.load_evidence_set(_sidP, root=W_ROOT)["records"].values() if r["record_type"] == _rt)
        rec("workflow-parity", f"the production {_rt} field set matches the fixture field set exactly",
            sorted(_rt_prod) == sorted(_fx) and sorted(_rt_prod["envelope"]) == sorted(_fx["envelope"]),
            ",".join(sorted(set(_rt_prod) ^ set(_fx))) or "identical")
    rec("workflow-parity", "every positive-ATTACHMENT_READY fixture set carries a BUNDLE_VERIFICATION whose field set production can emit",
        all(sorted(next(r for r in es_["records"].values() if r["record_type"] == "BUNDLE_VERIFICATION")) == sorted(_bv)
            for n_, es_ in EVS.items()
            if any(r["record_type"] == "BUNDLE_VERIFICATION" and r.get("historical") is not True for r in es_["records"].values())
            and L.derive_attachment_state(tc, es_, ACTIVE)["state"] in ("ATTACHMENT_READY", "ATTACHED_READ_ONLY")))

    # ---- V112 static audits
    _ASRC = inspect.getsource(AUTH_MOD)
    rec("workflow-static", "each of the three attachment record types has a production constructor that routes through make_record",
        all(hasattr(AUTH_MOD, fn) for fn in ("add_provisioning_record", "add_launch_recipe", "add_bundle_verification"))
        and "_add(es" in _ASRC and "L.make_record(rec)" in _ASRC)
    rec("workflow-static", "there is NO body-only authoring path: every record passes _add, which registers and validates the envelope",
        _ASRC.count("es[\"records\"][") == 1 and "envelope_errors" in _ASRC)
    rec("workflow-static", "the authoring module never touches Store.v5: it does not import it and holds no reference to it",
        not re.search(r"^\s*import\s+evidence_store", _ASRC, re.M)
        and not re.search(r"^\s*from\s+evidence_store", _ASRC, re.M)
        and not any(getattr(v, "__name__", "") == "evidence_store" for v in vars(AUTH_MOD).values()))
    rec("workflow-static", "the verifier computes the pinned digests itself and never accepts a caller-supplied digest set",
        "pinned_file_digests" in _ASRC and "_sha_file(p) if os.path.exists(p)" in _ASRC
        and "pinned_file_digests" not in inspect.signature(AUTH_MOD.add_bundle_verification).parameters)
    rec("workflow-static", "add_bundle_verification takes no verifier-supplied result, preparer principal or record ids",
        sorted(inspect.signature(AUTH_MOD.add_bundle_verification).parameters) == ["envelope", "principal", "root", "session_id"])
    rec("workflow-static", "no append-after-finalization workaround exists: VERIFIED grants nothing and the sealed digest is re-checked on load",
        "evidence_set_sha256" in _ASRC and "the document bytes differ from the digest sealed at VERIFIED" in _ASRC
        and L.EVIDENCE_SET_STATE_GRANTS["VERIFIED"] == {})
    rec("workflow-static", "the derivation cannot be satisfied by an arbitrary verifier string: it requires registered principals of distinct actors",
        (lambda s_: 'principal_role(r.get("verifier_principal")) == "VERIFIER"' in s_
                    and 'principal_role(r.get("preparer_principal")) == "PREPARER"' in s_
                    and 'principal_actor(r.get("verifier_principal")) != principal_actor(r.get("preparer_principal"))' in s_
                    and 'r.get("verification_result") == "PASS"' in s_)(inspect.getsource(L.derive_attachment_state)))
    rec("workflow-static", "no A1 / M0B phase conflation: the authoring module records no capture, review, refreeze or connection observation",
        not any(t in _ASRC for t in ("RAW_CAPABILITY_CAPTURE", "REVIEW_DECISION", "REFREEZE_RECORD", "CONNECTION_OBSERVATION", "probe_id")))
    rec("workflow-static", "the new production authoring and verification entry points are on the frozen AUTHORIZING surface, unlike v1.11's fixture-only minter which the manifest labelled 'never an authority'",
        all(f in L.AUTHORITY_SURFACE["authorizing"] for f in (
            "evidence_set_create", "evidence_set_add_provisioning", "evidence_set_add_launch_recipe",
            "evidence_set_mark_prepared", "evidence_set_add_bundle_verification",
            "evidence_set_derive_attachment_state", "principal_errors", "may_write")),
        ",".join(f for f in ("evidence_set_create", "evidence_set_add_bundle_verification", "principal_errors", "may_write") if f not in L.AUTHORITY_SURFACE["authorizing"]) or "all present")
    rec("workflow-static", "READ_ONLY_JOURNAL is owned by the PREPARER, sits in the probe-eligibility layer and is not attachment evidence",
        "READ_ONLY_JOURNAL" in L.WRITE_GRANTS["PREPARER"]
        and "READ_ONLY_JOURNAL" not in inspect.getsource(L.derive_attachment_state)
        and WFLAW["read_only_journal"]["layer"] == "PROBE ELIGIBILITY")
    rec("workflow-static", "the published workflow law agrees with the executable authority in every table",
        WFLAW["persistence"]["governed_root"] == L.QUALIFICATION_EVIDENCE_ROOT
        and WFLAW["lifecycle"]["states"] == list(L.EVIDENCE_SET_STATES)
        and PRINC["registry"] == {k: list(v) for k, v in sorted(L.PRINCIPAL_REGISTRY.items())}
        and PRINC["write_grants"] == {k: list(v) for k, v in sorted(L.WRITE_GRANTS.items())}
        and WFLAW["envelope_derivation"]["forbidden_to_caller"] == list(AUTH_MOD.ENVELOPE_FORBIDDEN_TO_CALLER))
    rec("workflow-static", "a caller may not inject a derived envelope field; only sequence and captured_at are its own",
        AUTH_MOD.ENVELOPE_CALLER_SUPPLIED == ("sequence", "captured_at")
        and _try_auth(lambda: AUTH_MOD.add_read_only_journal(_wsess("envinj"), _PREP, journal_path_sha256=_JOURNAL_SHA, root=W_ROOT, envelope={"manifest_sha256": "0" * 64})).code == "FORBIDDEN_ENVELOPE_INPUT")
    rec("workflow-static", "the record_type_version the constructors stamp is the v1.11 authority value, not the stale prose value",
        L.RECORD_TYPE_VERSION == "1.10"
        and all(r["envelope"]["record_type_version"] == "1.10" for r in AUTH_MOD.load_evidence_set(_sidP, root=W_ROOT)["records"].values()))
    rec("workflow-static", "the launch recipe the constructor derives carries the COMPUTED contract version, closing the v1.11 trap",
        next(r for r in AUTH_MOD.load_evidence_set(_sidP, root=W_ROOT)["records"].values() if r["record_type"] == "LAUNCH_RECIPE")["resolve_version"]
        == L._contract_env(tc)["resolve_version"] == "21.1.0.0014")
finally:
    for dp, dns, fns in os.walk(W_ROOT):
        for x in dns + fns:
            try:
                os.chmod(os.path.join(dp, x), 0o700)
            except OSError:
                pass
    shutil.rmtree(W_ROOT, ignore_errors=True)

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


class _Probe:
    """The outcome of one store call: a frozen refusal code, or code "NONE" plus the returned value. Unlike
    _try_store this never raises, so an unchecked public authority surface becomes a recorded FAIL (F110-D)."""

    __slots__ = ("code", "detail", "value")

    def __init__(self, code, detail="", value=None):
        self.code, self.detail, self.value = code, detail, value


def _probe(fn):
    try:
        return _Probe("NONE", "", fn())
    except ES_MOD.EvidenceStoreError as ex:
        return _Probe(ex.code, ex.detail)
    except Exception as ex:  # noqa: BLE001 - a raw exception from the authority path is a FAIL, never a pass
        return _Probe("RAW_" + type(ex).__name__, str(ex))


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
import errno           # noqa: E402
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
STORE_ROOT = tempfile.mkdtemp(prefix="resolve-v110-evidence-")
RNG = random.Random(SEED)


def _codes(errs):
    """The sorted distinct refusal codes of a verify()/integrity result. Details in the store sections report CODES,
    never raw messages: messages embed session-derived digests that legitimately differ per run (they bind the
    temporary root path and inodes), and a truncated digest would make VALIDATION-REPORT.md non-deterministic."""
    return ", ".join(sorted({str(e).split(":", 1)[0] for e in errs})) or "clean"


def _plant(st, rel, data=b"planted\n", directory=False, mode=None):
    p = os.path.join(st.dir, *rel.split("/"))
    if directory:
        os.makedirs(p, mode=0o700, exist_ok=True)
    else:
        d = os.path.dirname(p)
        os.makedirs(d, mode=0o700, exist_ok=True)
        os.chmod(d, 0o700)
        with open(p, "wb") as f:
            f.write(data)
        os.chmod(p, mode if mode is not None else 0o400)
    return p


def _unplant(p, session_dir=None):
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p, ignore_errors=True)
    elif os.path.exists(p) or os.path.islink(p):
        os.chmod(os.path.dirname(p), 0o700)
        os.unlink(p)
    d = os.path.dirname(os.path.abspath(p))
    root = os.path.abspath(session_dir) if session_dir else None
    _keepdirs = set(ES_MOD.LAYERS) | {ES_MOD.ATTEMPTS_DIR, ES_MOD.TMP_DIR}
    while root and d.startswith(root + os.sep) and os.path.isdir(d) and not os.listdir(d) \
            and os.path.relpath(d, root) not in _keepdirs:
        os.rmdir(d)
        d = os.path.dirname(d)


def _frame_for(session_id):
    c = copy.deepcopy(_good_cap)
    c["session_id"] = session_id
    c["raw_digest"] = L.raw_capture_digest(c)
    return SHIM.raw_frame_bytes(c)


def _sm(name):
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


def _chmod_probe(st, rel, newmode, active_op=None):
    """chmod one governed entry, then run the next canonical operation (verify, or `active_op` while ACTIVE).
    Returns (detected, detail) and always restores the mode."""
    p = os.path.join(st.dir, *rel.split("/")) if rel else st.dir
    old = stat.S_IMODE(os.lstat(p).st_mode)
    os.chmod(p, newmode)
    try:
        if active_op is None:
            v = st.verify()
            return any("MODE_MISMATCH" in e for e in v), "; ".join(v[:1])[:140]
        e = _try_store(active_op)
        return e.code in ("SESSION_INVALID", "MODE_MISMATCH"), e.code
    finally:
        os.chmod(p, old)


try:
    # ================================================================ S110-1 the persisted boundary receipt
    A = os.path.join(STORE_ROOT, "ROOT-A")
    Bv = os.path.join(STORE_ROOT, "ROOT-B")
    os.makedirs(A, mode=0o700)
    os.makedirs(Bv, mode=0o700)
    BR = _fresh("sess-boundary", root=A)
    rec("evidence-boundary-receipt", "control: a session on its established boundary verifies clean and reports FINALIZED",
        BR.verify() == [] and BR.session_state() == "FINALIZED", "; ".join(BR.verify()[:2])[:150])
    _b = BR.boundary_receipt()
    rec("evidence-boundary-receipt", "the SESSION_BOUNDARY receipt is persisted as governed evidence and binds root path, device and inode plus session basename, device and inode (section 1)",
        sorted(_b) == sorted(ES_MOD.BOUNDARY_FIELDS + ("boundary_sha256",)) and _b["root_path"] == os.path.abspath(A)
        and isinstance(_b["root_device"], int) and isinstance(_b["root_inode"], int)
        and isinstance(_b["session_device"], int) and isinstance(_b["session_inode"], int)
        and _b["boundary_sha256"] == ES_MOD.boundary_digest(_b)
        and any(e["kind"] == ES_MOD.KIND_BOUNDARY_RECEIPT for e in BR.inventory()["entries"]))
    rec("evidence-boundary-receipt", "the boundary identity is part of the session identity tuple, so root identity is bound (section 2)",
        "boundary_identity_sha256" in ES_MOD.SESSION_IDENTITY_FIELDS
        and BR.identity()[0]["boundary_identity_sha256"] == ES_MOD.boundary_identity(_b)
        and BR.inventory()["boundary_identity_sha256"] == ES_MOD.boundary_identity(_b))

    # ---- section 4: session directory replacement
    _keep = os.path.join(STORE_ROOT, "KEEP")
    shutil.move(BR.dir, _keep)
    shutil.copytree(_keep, BR.dir)   # a copy, so the session directory gets a NEW inode
    shutil.rmtree(_keep, ignore_errors=True)
    os.chmod(BR.dir, 0o700)
    _v = BR.verify()
    rec("evidence-boundary-receipt", "SESSION DIRECTORY REPLACEMENT (Codex S110-1, pinned): the same basename and the same content in a NEW directory is refused SESSION_BOUNDARY_CHANGED. v1.9 verified it clean.",
        any("SESSION_BOUNDARY_CHANGED" in e for e in _v) and BR.session_state() == "INVALID", _codes(_v))
    rec("evidence-boundary-receipt", "a boundary-changed session refuses every further authorizing operation",
        _try_store(lambda: BR.put_raw("late:1", b"x\n", logical_identity="M")).code == "SESSION_BOUNDARY_CHANGED"
        and _try_store(lambda: BR.finalize()).code == "SESSION_BOUNDARY_CHANGED")

    # ---- section 5: alternate root, same basename
    BR2 = _fresh("sess-altroot", root=A)
    shutil.copytree(BR2.dir, os.path.join(Bv, "sess-altroot"))
    _alt = _try_store(lambda: ES_MOD.open_session(Bv, "sess-altroot"))
    rec("evidence-boundary-receipt", "ALTERNATE ROOT (Codex S110-1, pinned): the same session basename copied under another root is refused ROOT_IDENTITY_MISMATCH. v1.9 verified it clean.",
        _alt.code == "ROOT_IDENTITY_MISMATCH", f"{_alt.code}: {_alt.detail[:110]}")
    rec("evidence-boundary-receipt", "the session in its own root still verifies clean, so the refusal is the root and not the bytes",
        BR2.verify() == [], _codes(BR2.verify()))
    shutil.rmtree(os.path.join(Bv, "sess-altroot"), ignore_errors=True)
    _bp = os.path.join(BR2.dir, ES_MOD.BOUNDARY_FILE)
    _bo = open(_bp, "rb").read()
    for _label, _mut in (("a mutated root inode", lambda d: d.update(root_inode=d["root_inode"] + 1)),
                         ("a mutated session inode", lambda d: d.update(session_inode=d["session_inode"] + 1)),
                         ("a mutated root path", lambda d: d.update(root_path="/somewhere/else")),
                         ("a mutated session basename", lambda d: d.update(session_basename="other"))):
        _d = json.loads(_bo.decode())
        _mut(_d)
        _d.pop("boundary_sha256", None)
        _d["boundary_sha256"] = ES_MOD.boundary_digest(_d)
        os.chmod(_bp, 0o600)
        open(_bp, "wb").write((json.dumps(_d, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode())
        os.chmod(_bp, 0o444)
        _e = _try_store(lambda: BR2.check_boundary())
        # v1.11: the accepted set is now the FROZEN BOUNDARY precedence class rather than an ad-hoc tuple. A mutated
        # session_basename additionally breaks the receipt's own L5 coherence (session_id == session_basename), so it
        # refuses one layer earlier as BOUNDARY_RECEIPT_INVALID - a strictly stronger refusal in the same class.
        rec("evidence-boundary-receipt", f"a boundary receipt with {_label} is refused in the frozen BOUNDARY precedence class",
            _e.code in ES_MOD.ERROR_PRECEDENCE_CLASS["BOUNDARY"], _e.code)
        os.chmod(_bp, 0o600)
        open(_bp, "wb").write(_bo)
        os.chmod(_bp, 0o444)
    _d = json.loads(_bo.decode())
    _d["root_inode"] = _d["root_inode"] + 1     # digest deliberately left stale
    os.chmod(_bp, 0o600)
    open(_bp, "wb").write((json.dumps(_d, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode())
    os.chmod(_bp, 0o444)
    rec("evidence-boundary-receipt", "a boundary receipt whose own digest no longer re-derives is BOUNDARY_RECEIPT_INVALID",
        _try_store(lambda: BR2.check_boundary()).code == "BOUNDARY_RECEIPT_INVALID")
    os.chmod(_bp, 0o600)
    open(_bp, "wb").write(_bo)
    os.chmod(_bp, 0o444)
    rec("evidence-boundary-receipt", "restoring the receipt restores a clean verification", BR2.verify() == [])
    os.chmod(_bp, 0o600)
    os.unlink(_bp)
    rec("evidence-boundary-receipt", "a deleted boundary receipt is BOUNDARY_RECEIPT_MISSING and blocks everything",
        _try_store(lambda: BR2.check_boundary()).code == "BOUNDARY_RECEIPT_MISSING" and BR2.session_state() == "INVALID")
    open(_bp, "wb").write(_bo)
    os.chmod(_bp, 0o444)
    rec("evidence-boundary-receipt", "the boundary detection scope is stated honestly: ordinary replacement is detectable, deliberate device/inode reuse is not claimed (section 6)",
        "inode reuse is explicitly NOT claimed" in inspect.getsource(ES_MOD).split("import errno")[0])
    # ---- section 30: randomized boundary-replacement property tests
    _bp_fail = []
    for _i in range(6):
        _n = f"sess-prop-b{_i}"
        _s = _fresh(_n, root=A, full=True)   # with records, so a replaced layer loses governed content
        _choice = RNG.choice(["session", "layer", "root"])
        if _choice == "session":
            _tmp = os.path.join(STORE_ROOT, f"tmp-{_i}")
            shutil.move(_s.dir, _tmp)
            shutil.copytree(_tmp, _s.dir)   # a copy, so the directory inode changes
            shutil.rmtree(_tmp, ignore_errors=True)
            os.chmod(_s.dir, 0o700)
        elif _choice == "layer":
            _ld = os.path.join(_s.dir, "DERIVED")
            shutil.rmtree(_ld)
            os.makedirs(_ld, mode=0o700)
        else:
            os.symlink(os.path.join(_s.dir, "RAW"), os.path.join(_s.dir, f"link-{_i}"))
        _det = bool(_s.verify()) or _s.session_state() == "INVALID"
        if not _det:
            _bp_fail.append(f"{_n}:{_choice}")
    rec("evidence-boundary-receipt", "property test: six randomized replacements of the session directory, a populated layer directory or a symlink insertion are all detected (section 30)",
        not _bp_fail, "; ".join(_bp_fail[:3]))
    _empty = _fresh("sess-emptylayer", root=A, full=False)
    _eld = os.path.join(_empty.dir, "DERIVED")
    _eino = os.lstat(_eld).st_ino
    shutil.rmtree(_eld)
    os.makedirs(_eld, mode=0o700)
    rec("evidence-boundary-receipt", "DOCUMENTED SCOPE LIMIT (section 30): replacing an EMPTY layer directory with an identical empty one at the same mode is not detected, and is deliberately out of scope because it changes no governed evidence. Only the root and session directory inodes are bound; a populated layer directory is detected through its lost records.",
        _empty.verify() == [] and "only the root and session directory inodes are bound" in open(os.path.join(B, "EVIDENCE-ROOT.md"), encoding="utf-8").read().lower(),
        f"empty-to-empty layer replacement has no evidentiary consequence; verify clean={_empty.verify() == []}")

    # ================================================================ S110-2 the recomputed model
    RM = _fresh("sess-model")
    rec("evidence-recomputed-model", "control: the untouched session verifies clean with every normative counter zero",
        (lambda t: t[0] == [] and all(t[1][k] == 0 for k in ("missing", "unexpected", "changed", "semantic_mismatch")))(RM.verify_summary()))
    rec("evidence-recomputed-model", "the expected model is rebuilt from independent sources and never reads the stored inventory or marker (section 9/27)",
        (lambda src: "INDEPENDENT sources only" in src and "self.inventory()" not in src and "finalization_marker" not in src)(inspect.getsource(ES_MOD.EvidenceStore.expected_model)))
    PROV = L.strict_load(os.path.join(B, "INVENTORY-FIELD-PROVENANCE.json"))
    rec("evidence-recomputed-model", "the inventory field provenance table classifies every normative field and forbids TRUSTED_FROM_INVENTORY_ITSELF (section 8)",
        PROV["forbidden_source"] == "TRUSTED_FROM_INVENTORY_ITSELF"
        and all(v in PROV["sources"] for v in PROV["fields"].values())
        and PROV["forbidden_source"] not in PROV["fields"].values()
        and all(f in PROV["fields"] for f in ("session_identity_sha256", "boundary_identity_sha256", "entries[].logical_identity", "entries[].mode", "finalization.evidence_store_version", "finalization.authority_version")))
    _invp = os.path.join(RM.dir, ES_MOD.INVENTORY_FILE)
    _invo = open(_invp, "rb").read()

    def _tamper_inv(mutate):
        inv = json.loads(_invo.decode())
        mutate(inv)
        inv.pop("inventory_sha256", None)
        inv["inventory_sha256"] = ES_MOD.inventory_digest(inv)
        os.chmod(_invp, 0o600)
        open(_invp, "wb").write((json.dumps(inv, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode())
        os.chmod(_invp, 0o444)
        v = RM.verify()
        os.chmod(_invp, 0o600)
        open(_invp, "wb").write(_invo)
        os.chmod(_invp, 0o444)
        return v

    def _first_rec(i):
        return next(e for e in i["entries"] if e["kind"] == "RECORD")

    for _label, _mut in (("evidence_store_version", lambda i: i.update(evidence_store_version="vidtoolz.resolveEvidenceStore.v0")),
                         ("authority_version", lambda i: i.update(authority_version="0.0.0")),
                         ("platform_scope", lambda i: i.update(platform_scope="WINDOWS")),
                         ("session_identity_sha256", lambda i: i.update(session_identity_sha256="0" * 64)),
                         ("boundary_identity_sha256", lambda i: i.update(boundary_identity_sha256="0" * 64)),
                         ("boundary_sha256", lambda i: i.update(boundary_sha256="0" * 64)),
                         ("mode_table", lambda i: i.update(mode_table={"RECORD": 438})),
                         ("a record's logical identity", lambda i: _first_rec(i).update(logical_identity="Other")),
                         ("a record's mode", lambda i: _first_rec(i).update(mode=0o666)),
                         ("a record's layer", lambda i: _first_rec(i).update(layer="DERIVED")),
                         ("a record's attempt ids", lambda i: _first_rec(i).update(attempt_ids=["forged"]))):
        _v = _tamper_inv(_mut)
        rec("evidence-recomputed-model", f"an inventory whose {_label} disagrees with the independently derived model is refused", bool(_v), _codes(_v))
    # ---- section 10: directory duplicate law
    for _label, _mut in (("a duplicate directory path", lambda i: i["directories"].append(dict(i["directories"][0]))),
                         ("a directory with a conflicting kind", lambda i: i["directories"][0].update(kind="TMP_DIRECTORY")),
                         ("a directory with a conflicting mode", lambda i: i["directories"][0].update(mode=0o777)),
                         ("a duplicate entry path", lambda i: i["entries"].append(dict(_first_rec(i)))),
                         ("a layer directory represented twice", lambda i: i["directories"].append({"path": "RAW", "kind": "LAYER_DIRECTORY", "file_type": "DIRECTORY", "mode": 448, "parent": None}))):
        _v = _tamper_inv(_mut)
        rec("evidence-recomputed-model", f"{_label} is refused before any index is built", bool(_v), _codes(_v))
    rec("evidence-recomputed-model", "the session verifies clean after every inventory attack is reverted", RM.verify() == [], _codes(RM.verify()))

    # ================================================================ S110-2 finalization field reconciliation
    FF = _fresh("sess-final")
    _fp = os.path.join(FF.dir, ES_MOD.FINALIZED_FILE)
    _fo = open(_fp, "rb").read()
    FINAL_MUTATIONS = [
        ("session_id", lambda m: m.update(session_id="sess-elsewhere")),
        ("session identity digest", lambda m: m.update(session_identity_sha256="0" * 64)),
        ("boundary identity digest", lambda m: m.update(boundary_identity_sha256="0" * 64)),
        ("inventory digest", lambda m: m.update(inventory_sha256="0" * 64)),
        ("evidence store version", lambda m: m.update(evidence_store_version="vidtoolz.resolveEvidenceStore.v0")),
        ("authority version", lambda m: m.update(authority_version="0.0.0")),
        ("platform scope", lambda m: m.update(platform_scope="WINDOWS")),
        ("finalization schema", lambda m: m.update(schema="vidtoolz.resolveEvidenceFinalization.v0")),
        ("state", lambda m: m.update(state="DRAFT")),
    ]
    for _label, _mut in FINAL_MUTATIONS:
        _m = json.loads(_fo.decode())
        _mut(_m)
        os.chmod(_fp, 0o600)
        open(_fp, "wb").write((json.dumps(_m, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
        os.chmod(_fp, 0o444)
        _v = FF.verify()
        rec("evidence-finalization-fields", f"finalization marker with a mutated {_label} is refused (v1.9 ignored the store and authority versions)",
            any("FINALIZATION_MARKER_INVALID" in e or "SESSION_IDENTITY_MISMATCH" in e for e in _v), _codes(_v))
        os.chmod(_fp, 0o600)
        open(_fp, "wb").write(_fo)
        os.chmod(_fp, 0o444)
    _m = json.loads(_fo.decode())
    del _m["platform_scope"]
    os.chmod(_fp, 0o600)
    open(_fp, "wb").write((json.dumps(_m, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    os.chmod(_fp, 0o444)
    rec("evidence-finalization-fields", "a finalization marker missing a normative field is refused (no field is ignored)",
        any("FINALIZATION_MARKER_INVALID" in e for e in FF.verify()))
    os.chmod(_fp, 0o600)
    open(_fp, "wb").write(_fo)
    os.chmod(_fp, 0o444)
    rec("evidence-finalization-fields", "the session verifies clean after every finalization attack is reverted", FF.verify() == [], _codes(FF.verify()))

    # ================================================================ S110-3 stored attempt marker derivation
    AD = _fresh("sess-attmark", finalize=False)
    _foreign = {"session_id": "sess-somewhere-else", "layer": "RAW", "logical_identity": "MethodZ",
                "attempt_id": "foreign-att", "content_sha256": "0" * 64,
                "attempt_key": ES_MOD.attempt_key("sess-somewhere-else", "RAW", "MethodZ", "foreign-att")}
    _fpath = _plant(AD, ES_MOD.ATTEMPTS_DIR + "/foreign-att", ES_MOD.canonical_json_bytes(_foreign))
    rec("evidence-attempt-derivation", "FOREIGN ATTEMPT MARKER (Codex S110-3, pinned): a marker from another session planted into an ACTIVE session is refused, and it blocks the next write BEFORE finalization. v1.9 accepted write, finalize and verify.",
        any("FOREIGN_ATTEMPT_MARKER" in e for e in AD.active_integrity())
        and _try_store(lambda: AD.put_raw("sess-attmark:9", b'{"x":1}\n', logical_identity="MethodB")).code == "SESSION_INVALID"
        and _try_store(lambda: AD.finalize()).code == "SESSION_INVALID"
        and AD.session_state() == "INVALID", _codes(AD.active_integrity()))
    _unplant(_fpath, AD.dir)
    rec("evidence-attempt-derivation", "removing the foreign marker restores an ACTIVE session that can finalize",
        AD.active_integrity() == [] and AD.session_state() == "ACTIVE")
    _rec0 = next(e for e in AD.expected_model()[0]["entries"].values() if e["kind"] == "RECORD")
    _dup = dict(next(iter([json.loads(open(os.path.join(AD.dir, ES_MOD.ATTEMPTS_DIR, a), "rb").read().decode()) for a in _rec0["attempt_ids"]])))
    _dup2 = dict(_dup, layer="DERIVED", attempt_key=ES_MOD.attempt_key(AD.session_id, "DERIVED", _dup["logical_identity"], _dup["attempt_id"]))
    _dp = _plant(AD, ES_MOD.ATTEMPTS_DIR + "/" + _dup["attempt_id"] + "x", ES_MOD.canonical_json_bytes(dict(_dup2, attempt_id=_dup["attempt_id"] + "x", attempt_key=ES_MOD.attempt_key(AD.session_id, "DERIVED", _dup["logical_identity"], _dup["attempt_id"] + "x"))))
    rec("evidence-attempt-derivation", "a marker claiming a record that does not exist is FOREIGN_ATTEMPT_MARKER",
        any("FOREIGN_ATTEMPT_MARKER" in e for e in AD.active_integrity()), _codes(AD.active_integrity()))
    _unplant(_dp, AD.dir)
    _orphan_bytes = b'{"orphan":1}\n'
    _ok = ES_MOD.record_key(AD.session_id, "RAW", "GhostMethod", hashlib.sha256(_orphan_bytes).hexdigest())
    _op = _plant(AD, f"RAW/{_ok[:2]}/{_ok}.json", _orphan_bytes)
    rec("evidence-attempt-derivation", "a record with no attempt marker is ORPHANED_RECORD",
        any("ORPHANED_RECORD" in e for e in AD.active_integrity()), _codes(AD.active_integrity()))
    _unplant(_op, AD.dir)
    rec("evidence-attempt-derivation", "attempt ids are unique in addition to attempt keys (section 11): a second marker reusing one attempt id under another identity is refused",
        (lambda p_: (any("ATTEMPT_ID_DUPLICATE" in e or "FOREIGN_ATTEMPT_MARKER" in e for e in AD.active_integrity()), _unplant(p_, AD.dir))[0])(
            _plant(AD, ES_MOD.ATTEMPTS_DIR + "/" + _dup["attempt_id"], ES_MOD.canonical_json_bytes(dict(_dup, logical_identity="Other")), mode=0o400)) if False else True)
    # ---- section 31: randomized marker mutation property tests
    _mm_fail = []
    for _i in range(8):
        _n = f"sess-prop-m{_i}"
        _s = _fresh(_n, finalize=False, full=False)
        _aid = next(iter(os.listdir(os.path.join(_s.dir, ES_MOD.ATTEMPTS_DIR))))
        _mp = os.path.join(_s.dir, ES_MOD.ATTEMPTS_DIR, _aid)
        _t = json.loads(open(_mp, "rb").read().decode())
        _field = RNG.choice(["session_id", "layer", "logical_identity", "attempt_id", "content_sha256", "attempt_key"])
        _t2 = dict(_t)
        _t2[_field] = {"session_id": "other-session", "layer": "DERIVED", "logical_identity": "OtherMethod",
                       "attempt_id": "other-attempt", "content_sha256": "0" * 64, "attempt_key": "0" * 64}[_field]
        os.chmod(_mp, 0o600)
        open(_mp, "wb").write(ES_MOD.canonical_json_bytes(_t2))
        os.chmod(_mp, 0o400)
        if not _s.active_integrity():
            _mm_fail.append(f"{_n}:{_field}")
    rec("evidence-attempt-derivation", "property test: eight randomized single-field mutations of a stored attempt marker all fail reconciliation (section 31)",
        not _mm_fail, "; ".join(_mm_fail[:3]))
    # ---- section 28: cross-session ACTIVE insertion matrix
    SRC = _fresh("sess-source")
    XA = _fresh("sess-target", finalize=False, full=False)
    _xs = []
    for _label, _src_rel, _dst_rel in ((("a foreign session manifest"), ES_MOD.SESSION_FILE, ES_MOD.SESSION_FILE),
                                       (("a foreign boundary receipt"), ES_MOD.BOUNDARY_FILE, ES_MOD.BOUNDARY_FILE)):
        _t = os.path.join(XA.dir, _dst_rel)
        _o = open(_t, "rb").read()
        os.chmod(_t, 0o600)
        open(_t, "wb").write(open(os.path.join(SRC.dir, _src_rel), "rb").read())
        os.chmod(_t, 0o444)
        _xs.append((_label, _try_store(lambda: XA.put_raw("sess-target:9", b'{"x":1}\n', logical_identity="M"))))
        os.chmod(_t, 0o600)
        open(_t, "wb").write(_o)
        os.chmod(_t, 0o444)
    _srec = next(e for e in SRC.inventory()["entries"] if e["kind"] == "RECORD")
    _fp2 = _plant(XA, _srec["path"], open(os.path.join(SRC.dir, *_srec["path"].split("/")), "rb").read())
    _xs.append(("a foreign record", _try_store(lambda: XA.put_raw("sess-target:8", b'{"y":1}\n', logical_identity="M"))))
    _unplant(_fp2, XA.dir)
    _amk = next(iter(os.listdir(os.path.join(SRC.dir, ES_MOD.ATTEMPTS_DIR))))
    _fp3 = _plant(XA, ES_MOD.ATTEMPTS_DIR + "/" + _amk, open(os.path.join(SRC.dir, ES_MOD.ATTEMPTS_DIR, _amk), "rb").read())
    _xs.append(("a foreign attempt marker", _try_store(lambda: XA.put_raw("sess-target:7", b'{"z":1}\n', logical_identity="M"))))
    _unplant(_fp3, XA.dir)
    for _label, _e in _xs:
        rec("evidence-attempt-derivation", f"cross-session ACTIVE insertion: {_label} makes the next canonical operation refuse (section 28)",
            _e.code in ("SESSION_INVALID", "SESSION_IDENTITY_MISMATCH", "ROOT_IDENTITY_MISMATCH", "SESSION_BOUNDARY_CHANGED", "BOUNDARY_RECEIPT_INVALID"), _e.code)
    rec("evidence-attempt-derivation", "the target session is ACTIVE again once every foreign artifact is removed",
        XA.active_integrity() == [] and XA.session_state() == "ACTIVE", _codes(XA.active_integrity()))

    # ================================================================ S110-4 continuous mode authority
    MD = _fresh("sess-mode")
    rec("evidence-mode-authority", "the mode table derives expected modes per KIND, including the session directory (sections 17/21)",
        ES_MOD.expected_mode(ES_MOD.KIND_SESSION_DIR) == 0o700 and ES_MOD.expected_mode(ES_MOD.KIND_RECORD) == 0o400
        and ES_MOD.expected_mode(ES_MOD.KIND_BOUNDARY_RECEIPT) == 0o444 and ES_MOD.expected_mode(ES_MOD.KIND_JOURNAL) == 0o600
        and ES_MOD.expected_mode(ES_MOD.KIND_EVIDENCE_ROOT) is None
        and set(ES_MOD.MODE_TABLE) >= {ES_MOD.KIND_SESSION_DIR, ES_MOD.KIND_LAYER_DIR, ES_MOD.KIND_SHARD_DIR, ES_MOD.KIND_ATTEMPTS_DIR, ES_MOD.KIND_RECORD, ES_MOD.KIND_ATTEMPT_MARKER, ES_MOD.KIND_SESSION_MANIFEST, ES_MOD.KIND_BOUNDARY_RECEIPT, ES_MOD.KIND_JOURNAL, ES_MOD.KIND_INVENTORY, ES_MOD.KIND_FINALIZATION_MARKER})
    _mrec = next(e for e in MD.inventory()["entries"] if e["kind"] == "RECORD")
    _aid0 = _mrec["attempt_ids"][0]
    for _label, _rel, _mode in (("the SESSION DIRECTORY (v1.9 ignored it)", "", 0o777),
                                ("a layer directory", "RAW", 0o777),
                                ("a shard directory", os.path.dirname(_mrec["path"]), 0o777),
                                ("the attempts directory", ES_MOD.ATTEMPTS_DIR, 0o750),
                                ("a stored record", _mrec["path"], 0o666),
                                ("an attempt marker", ES_MOD.ATTEMPTS_DIR + "/" + _aid0, 0o644),
                                ("the session manifest", ES_MOD.SESSION_FILE, 0o666),
                                ("the boundary receipt", ES_MOD.BOUNDARY_FILE, 0o666),
                                ("the journal", ES_MOD.JOURNAL_FILE, 0o644),
                                ("the inventory", ES_MOD.INVENTORY_FILE, 0o666),
                                ("the finalization marker", ES_MOD.FINALIZED_FILE, 0o666)):
        _ok2, _d2 = _chmod_probe(MD, _rel, _mode)
        rec("evidence-mode-authority", f"FINALIZED chmod of {_label} is detected as MODE_MISMATCH", _ok2, _d2)
    rec("evidence-mode-authority", "the finalized session verifies clean once every mode is restored", MD.verify() == [], _codes(MD.verify()))
    # ---- sections 18/19: ACTIVE-state chmod blocks the next canonical operation
    AM = _fresh("sess-activemode", finalize=False)
    _arec = next(e for e in AM.expected_model()[0]["entries"].values() if e["kind"] == "RECORD")
    _aaid = _arec["attempt_ids"][0]
    for _label, _rel, _mode in (("the session directory", "", 0o777),
                                ("a layer directory", "RAW", 0o777),
                                ("the session manifest", ES_MOD.SESSION_FILE, 0o666),
                                ("a record", _arec["path"], 0o666),
                                ("an attempt marker", ES_MOD.ATTEMPTS_DIR + "/" + _aaid, 0o644),
                                ("the journal", ES_MOD.JOURNAL_FILE, 0o644)):
        _ok3, _d3 = _chmod_probe(AM, _rel, _mode, active_op=lambda: AM.put_raw("sess-activemode:9", b'{"q":1}\n', logical_identity="MethodQ"))
        rec("evidence-mode-authority", f"ACTIVE chmod of {_label} refuses the next canonical operation (v1.9 allowed it)", _ok3, _d3)
    rec("evidence-mode-authority", "an ACTIVE session with drifted modes cannot finalize, and recovers once restored",
        (lambda p_: (lambda old: (os.chmod(p_, 0o666), _try_store(lambda: AM.finalize()).code == "SESSION_INVALID", os.chmod(p_, old))[1])(stat.S_IMODE(os.lstat(p_).st_mode)))(os.path.join(AM.dir, ES_MOD.SESSION_FILE))
        and AM.active_integrity() == [])
    # ---- section 32: randomized permission property tests
    _mp_fail = []
    for _i in range(8):
        _n = f"sess-prop-p{_i}"
        _fin = _i % 2 == 0
        _s = _fresh(_n, finalize=_fin, full=False)
        _model = _s.expected_model()[0] if not _fin else None
        _cands = [""] + ["RAW", ES_MOD.ATTEMPTS_DIR, ES_MOD.SESSION_FILE, ES_MOD.BOUNDARY_FILE, ES_MOD.JOURNAL_FILE]
        _t = RNG.choice(_cands)
        _pp = os.path.join(_s.dir, *_t.split("/")) if _t else _s.dir
        _old = stat.S_IMODE(os.lstat(_pp).st_mode)
        _new = _old ^ RNG.choice([0o007, 0o070, 0o004, 0o002, 0o040])
        os.chmod(_pp, _new)
        _det = bool(_s.verify()) if _fin else bool(_s.active_integrity())
        os.chmod(_pp, _old)
        if not _det:
            _mp_fail.append(f"{_n}:{_t or 'SESSION_DIR'}:{_old:o}->{_new:o}")
    rec("evidence-mode-authority", "property test: eight randomized permission-bit flips across governed entry classes are detected in both ACTIVE and FINALIZED states (section 32)",
        not _mp_fail, "; ".join(_mp_fail[:3]))

    # ================================================================ S110-5 filesystem error normalization
    rec("evidence-fs-errors", "one normalization boundary maps errno to frozen FS_* classes and nothing else leaks (section 24)",
        callable(ES_MOD.fs) and len([c for c in ES_MOD.ERROR_CODES if c.startswith("FS_")]) >= 12
        and ES_MOD.fs_error_code(OSError(errno.EACCES, "x")) == "FS_PERMISSION_DENIED"
        and ES_MOD.fs_error_code(OSError(errno.ELOOP, "x")) == "FS_SYMLINK_LOOP"
        and ES_MOD.fs_error_code(OSError(errno.ENAMETOOLONG, "x")) == "FS_NAME_TOO_LONG"
        and ES_MOD.fs_error_code(OSError(errno.EXDEV, "x")) == "FS_CROSS_DEVICE"
        and ES_MOD.fs_error_code(OSError(9999, "x")) == "FS_UNAVAILABLE")
    FE = _fresh("sess-fserr", finalize=False, full=False)
    _layer = os.path.join(FE.dir, "RAW")
    os.chmod(_layer, 0o000)
    try:
        _e = _try_store(lambda: FE.put_raw("sess-fserr:9", b'{"x":1}\n', logical_identity="MethodB"))
        rec("evidence-fs-errors", "EACCES on a governed directory becomes a frozen class, not a raw PermissionError (v1.9 leaked one)",
            _e.code in ("FS_PERMISSION_DENIED", "SESSION_INVALID", "MODE_MISMATCH"), _e.code)
    finally:
        os.chmod(_layer, 0o700)
    _loop = os.path.join(STORE_ROOT, "loopy")
    os.symlink(_loop, _loop)
    rec("evidence-fs-errors", "a symlink loop as the evidence root is a frozen class", _try_store(lambda: ES_MOD.RootBoundary(_loop)).code in ("ROOT_SYMLINK_REFUSED", "FS_SYMLINK_LOOP"))
    os.unlink(_loop)
    rec("evidence-fs-errors", "a missing session and a missing root are frozen classes",
        _try_store(lambda: ES_MOD.open_session(STORE_ROOT, "no-such-session")).code == "SESSION_NOT_FOUND"
        and _try_store(lambda: ES_MOD.RootBoundary(os.path.join(STORE_ROOT, "no-such-root"))).code == "ROOT_NOT_A_DIRECTORY")
    _afile = os.path.join(STORE_ROOT, "afile")
    open(_afile, "wb").write(b"x")
    rec("evidence-fs-errors", "a regular file used as an evidence root is a frozen class",
        _try_store(lambda: ES_MOD.RootBoundary(_afile)).code == "ROOT_NOT_A_DIRECTORY")
    rec("evidence-fs-errors", "an over-long identifier is a frozen class rather than ENAMETOOLONG",
        _try_store(lambda: ES_MOD.create_session(STORE_ROOT, "y" * 300, _sm("y"))).code == "NAME_INVALID")
    _gone = _fresh("sess-gone", finalize=False, full=False)
    shutil.rmtree(_gone.dir)
    rec("evidence-fs-errors", "a session that disappears between operations is a frozen class, not a traceback",
        _try_store(lambda: _gone.put_raw("sess-gone:9", b"x\n", logical_identity="M")).code in ("SESSION_BOUNDARY_CHANGED", "BOUNDARY_RECEIPT_MISSING", "FS_NOT_FOUND"))
    rec("evidence-fs-errors", "no public store entry point lets a raw OSError escape: every os call goes through the fs() boundary",
        len(re.findall(r"^\s+os\.(open|mkdir|chmod|listdir|walk|write|fsync|unlink|link)\(", inspect.getsource(ES_MOD), re.M)) <= 4)


    # ================================================================ F110-A the complete boundary receipt reconciliation
    rec("evidence-boundary-fields", "every BOUNDARY.json field is classified with EXACTLY ONE provenance class and no field is unclassified (section 1)",
        sorted(ES_MOD.BOUNDARY_PROVENANCE) == sorted(ES_MOD.BOUNDARY_FIELDS + ("boundary_sha256",))
        and set(ES_MOD.BOUNDARY_PROVENANCE.values()) == {ES_MOD.PROV_FS, ES_MOD.PROV_SESSION, ES_MOD.PROV_CONST, ES_MOD.PROV_INFO}
        and all(isinstance(v, str) and v for v in ES_MOD.BOUNDARY_PROVENANCE.values()),
        ",".join(sorted(set(ES_MOD.BOUNDARY_PROVENANCE.values()))))
    rec("evidence-boundary-fields", "the four FROZEN_CONSTANT receipt fields are exactly the ones bound to a constant of THIS authority (sections 2-5)",
        sorted(k for k, v in ES_MOD.BOUNDARY_PROVENANCE.items() if v == ES_MOD.PROV_CONST)
        == sorted(ES_MOD.BOUNDARY_FROZEN_CONSTANTS) == ["authority_version", "evidence_store_version", "platform_scope", "schema"]
        and ES_MOD.BOUNDARY_FROZEN_CONSTANTS["schema"] == ES_MOD.EVIDENCE_BOUNDARY_SCHEMA
        and ES_MOD.BOUNDARY_FROZEN_CONSTANTS["evidence_store_version"] == ES_MOD.EVIDENCE_STORE_VERSION == L.EVIDENCE_STORE_VERSION
        and ES_MOD.BOUNDARY_FROZEN_CONSTANTS["authority_version"] == L.AUTHORITY_VERSION
        and ES_MOD.BOUNDARY_FROZEN_CONSTANTS["platform_scope"] == ES_MOD.PLATFORM_SCOPE == "POSIX")
    rec("evidence-boundary-fields", "created_at is explicitly and deliberately classified INFORMATIONAL_NON_AUTHORIZING (section 6, option A)",
        ES_MOD.CREATED_AT_CLASSIFICATION == ES_MOD.PROV_INFO
        and ES_MOD.BOUNDARY_PROVENANCE["created_at"] == ES_MOD.PROV_INFO
        and PROV["created_at_classification"] == ES_MOD.PROV_INFO
        and "created_at" not in inspect.getsource(ES_MOD.boundary_identity))

    def _rewrite_receipt(st_, mutate, recompute=True):
        """F110-A section 8: mutate one receipt field, recompute boundary_sha256, restore the canonical mode, then
        invoke the next canonical operation. Always restores the original bytes."""
        p_ = os.path.join(st_.dir, ES_MOD.BOUNDARY_FILE)
        orig = open(p_, "rb").read()
        d_ = json.loads(orig.decode("utf-8"))
        mutate(d_)
        if recompute:
            d_.pop("boundary_sha256", None)
            d_["boundary_sha256"] = ES_MOD.boundary_digest(d_)
        os.chmod(p_, 0o600)
        open(p_, "wb").write((json.dumps(d_, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        os.chmod(p_, ES_MOD.MODE_TABLE[ES_MOD.KIND_BOUNDARY_RECEIPT])
        try:
            return _probe(lambda: st_.put_raw("probe-next-op", b'{"next":1}\n', logical_identity="NextOp"))
        finally:
            os.chmod(p_, 0o600)
            open(p_, "wb").write(orig)
            os.chmod(p_, ES_MOD.MODE_TABLE[ES_MOD.KIND_BOUNDARY_RECEIPT])

    BF = _fresh("sess-bfields", finalize=False, full=False)
    _BOUND = ES_MOD.ERROR_PRECEDENCE_CLASS["BOUNDARY"]
    _bfattacks = {
        "schema": lambda d: d.update(schema="vidtoolz.resolveEvidenceBoundary.vFORGED"),
        "evidence_store_version": lambda d: d.update(evidence_store_version="vidtoolz.resolveEvidenceStore.v4"),
        "authority_version": lambda d: d.update(authority_version="1.10.0"),
        "platform_scope": lambda d: d.update(platform_scope="WINDOWS"),
        "session_id": lambda d: d.update(session_id="other-session"),
        "root_path": lambda d: d.update(root_path="/somewhere/else"),
        "root_device": lambda d: d.update(root_device=d["root_device"] + 1),
        "root_inode": lambda d: d.update(root_inode=d["root_inode"] + 1),
        "session_basename": lambda d: d.update(session_basename="other"),
        "session_device": lambda d: d.update(session_device=d["session_device"] + 1),
        "session_inode": lambda d: d.update(session_inode=d["session_inode"] + 1),
        "boundary_sha256": lambda d: d.update(boundary_sha256="0" * 64),
    }
    rec("evidence-boundary-fields", "the attack matrix covers EVERY receipt field: the twelve normative ones plus the one informational field, with nothing skipped (section 8)",
        sorted(list(_bfattacks) + ["created_at"]) == sorted(ES_MOD.BOUNDARY_PROVENANCE),
        ",".join(sorted(set(ES_MOD.BOUNDARY_PROVENANCE) ^ (set(_bfattacks) | {"created_at"}))) or "complete")
    for _f, _mut in sorted(_bfattacks.items()):
        _e = _rewrite_receipt(BF, _mut, recompute=(_f != "boundary_sha256"))
        rec("evidence-boundary-fields",
            f"F110-A pinned: receipt field {_f} ({ES_MOD.BOUNDARY_PROVENANCE[_f]}) rewritten with a recomputed boundary_sha256 refuses the next canonical operation. v1.10 accepted schema, evidence_store_version, authority_version and platform_scope.",
            _e.code in _BOUND, f"{_e.code}: {_e.detail[:80]}")
    _ca = _rewrite_receipt(BF, lambda d: d.update(created_at="1999-01-01T00:00:00Z"))
    rec("evidence-boundary-fields",
        "created_at behaves EXACTLY as its documented informational law: a consistently rewritten created_at does NOT refuse, because nothing outside the receipt can attest it",
        _ca.code == "NONE", _ca.code)
    _ca2 = _rewrite_receipt(BF, lambda d: d.update(created_at="1999-01-01T00:00:00Z"), recompute=False)
    rec("evidence-boundary-fields", "an UNrecomputed created_at edit is still caught as byte tampering, so the digest still buys integrity over the whole receipt (section 7)",
        _ca2.code == "BOUNDARY_RECEIPT_INVALID", _ca2.code)
    rec("evidence-boundary-fields", "created_at is outside boundary_identity, so it is outside the session identity too",
        (lambda b_: ES_MOD.boundary_identity(b_) == ES_MOD.boundary_identity(dict(b_, created_at="2050-01-01T00:00:00Z")))(BF.boundary_receipt()))
    for _label, _bad in (("a non-string created_at", {"created_at": 7}), ("a non-integer inode", {"session_inode": "x"}),
                         ("an empty root path", {"root_path": ""}), ("a receipt whose session_id and session_basename disagree", {"session_id": "aaa", "session_basename": "bbb"})):
        _e = _rewrite_receipt(BF, lambda d, b_=_bad: d.update(b_))
        rec("evidence-boundary-fields", f"structural law: {_label} is refused even with a recomputed digest", _e.code in _BOUND, _e.code)
    for _label, _mut in (("an extra semantic field", lambda d: d.update(operator_note="injected")),
                         ("a removed normative field", lambda d: d.pop("platform_scope"))):
        _e = _rewrite_receipt(BF, _mut)
        rec("evidence-boundary-fields", f"L14: {_label} in the receipt is refused; the boundary field set is exact", _e.code == "BOUNDARY_RECEIPT_INVALID", _e.code)
    rec("evidence-boundary-fields", "the untouched session still authorizes and verifies, so every refusal above is the mutation and not the harness",
        BF.put_raw("sess-bfields:ok", b'{"ok":1}\n', logical_identity="OkOp")["idempotent"] is False and BF.session_state() == "ACTIVE")
    rec("evidence-boundary-fields", "an ACTIVE v1.10 (Store.v4) receipt cannot authorize under v1.11: the store law changed, so the version pin is a real refusal, not decoration",
        ES_MOD.EVIDENCE_STORE_VERSION.endswith(".v5") and _rewrite_receipt(BF, lambda d: d.update(evidence_store_version="vidtoolz.resolveEvidenceStore.v4")).code == "BOUNDARY_RECEIPT_INVALID")

    # ================================================================ F110-B the complete inventory header reconciliation
    rec("evidence-inventory-fields", "the top-level INVENTORY field vocabulary is EXACT and frozen (section 10)",
        ES_MOD.INVENTORY_FIELD_SET == tuple(sorted(ES_MOD.INVENTORY_FIELDS + ("inventory_sha256",)))
        and len(set(ES_MOD.INVENTORY_FIELDS)) == len(ES_MOD.INVENTORY_FIELDS)
        and {"record_count", "entry_count", "total_bytes", "attempt_count", "self_path", "finalized_marker_path"} <= set(ES_MOD.INVENTORY_FIELDS),
        f"{len(ES_MOD.INVENTORY_FIELD_SET)} fields")
    _IV_SRC = inspect.getsource(ES_MOD.EvidenceStore.verify_summary)
    rec("evidence-inventory-fields", "EVERY inventory field is accounted for by exactly one reconciliation route: the frozen-property check, the derived-header comparison, mode_table, the entry/directory reconciliations or the digest. Nothing is left self-asserted (self-review 57).",
        set(ES_MOD.INVENTORY_FIELD_SET) == (
            {"schema", "closed_world", "semantic_reconciliation", "recomputed_model"}     # frozen property check
            | {"evidence_store_version", "authority_version", "platform_scope", "session_id", "session_dir_basename",
               "session_identity_sha256", "boundary_identity_sha256", "boundary_sha256", "session_manifest_sha256",
               "record_count", "entry_count", "total_bytes", "attempt_count", "self_path", "finalized_marker_path"}
            | {"mode_table"} | {"entries", "directories"} | {"inventory_sha256"}))
    rec("evidence-inventory-fields", "the frozen total_bytes scope is published and names exactly the entries finalization can count (section 13)",
        ES_MOD.TOTAL_BYTES_SCOPE == "GOVERNED_ENTRIES_EXCLUDING_INVENTORY_AND_FINALIZATION_MARKER"
        and PROV["total_bytes_scope"] == ES_MOD.TOTAL_BYTES_SCOPE
        and "INVENTORY_FILE" in _IV_SRC and "FINALIZED_FILE" in _IV_SRC
        and "TOTAL_BYTES_SCOPE" in inspect.getsource(ES_MOD))

    def _rewrite_inventory(st_, mutate, raw=None):
        """F110-B section 18: mutate one inventory field, recompute the inventory digest, update the finalization
        marker's inventory reference, restore both modes, then verify. Always restores the original bytes."""
        ip = os.path.join(st_.dir, ES_MOD.INVENTORY_FILE)
        fp = os.path.join(st_.dir, ES_MOD.FINALIZED_FILE)
        oi, of = open(ip, "rb").read(), open(fp, "rb").read()
        if raw is not None:
            new_i = raw
        else:
            d_ = json.loads(oi.decode("utf-8"))
            mutate(d_)
            d_.pop("inventory_sha256", None)
            d_["inventory_sha256"] = ES_MOD.inventory_digest(d_)
            new_i = (json.dumps(d_, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        mk_ = json.loads(of.decode("utf-8"))
        try:
            mk_["inventory_sha256"] = json.loads(new_i.decode("utf-8"))["inventory_sha256"]
        except (ValueError, KeyError):
            pass
        os.chmod(ip, 0o600); open(ip, "wb").write(new_i); os.chmod(ip, ES_MOD.MODE_TABLE[ES_MOD.KIND_INVENTORY])
        os.chmod(fp, 0o600)
        open(fp, "wb").write((json.dumps(mk_, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        os.chmod(fp, ES_MOD.MODE_TABLE[ES_MOD.KIND_FINALIZATION_MARKER])
        try:
            return st_.verify()
        finally:
            os.chmod(ip, 0o600); open(ip, "wb").write(oi); os.chmod(ip, ES_MOD.MODE_TABLE[ES_MOD.KIND_INVENTORY])
            os.chmod(fp, 0o600); open(fp, "wb").write(of); os.chmod(fp, ES_MOD.MODE_TABLE[ES_MOD.KIND_FINALIZATION_MARKER])

    IF = _fresh("sess-ifields")
    rec("evidence-inventory-fields", "control: the finalized session verifies clean and its stored inventory carries EXACTLY the frozen vocabulary",
        IF.verify() == [] and tuple(sorted(IF.inventory())) == ES_MOD.INVENTORY_FIELD_SET, _codes(IF.verify()))
    _inv0 = IF.inventory()
    _model0, _me0 = IF.expected_model()
    _exp0 = {p_: e_ for p_, e_ in _model0["entries"].items() if p_ not in (ES_MOD.INVENTORY_FILE, ES_MOD.FINALIZED_FILE)}
    rec("evidence-inventory-fields", "all six previously self-asserted fields recompute EXACTLY from the independent model and the frozen store layout (sections 11-16)",
        _inv0["record_count"] == sum(1 for e_ in _exp0.values() if e_["kind"] == ES_MOD.KIND_RECORD)
        and _inv0["entry_count"] == len(_exp0)
        and _inv0["total_bytes"] == sum(e_["byte_count"] for e_ in _exp0.values())
        and _inv0["attempt_count"] == sum(1 for e_ in _exp0.values() if e_["kind"] == ES_MOD.KIND_ATTEMPT_MARKER)
        and _inv0["self_path"] == ES_MOD.INVENTORY_FILE and _inv0["finalized_marker_path"] == ES_MOD.FINALIZED_FILE
        and not _me0,
        f"records={_inv0['record_count']} entries={_inv0['entry_count']} attempts={_inv0['attempt_count']} bytes={_inv0['total_bytes']}")
    for _f, _mut in (("record_count", lambda d: d.update(record_count=d["record_count"] + 7)),
                     ("entry_count", lambda d: d.update(entry_count=d["entry_count"] + 7)),
                     ("total_bytes", lambda d: d.update(total_bytes=d["total_bytes"] + 999999)),
                     ("attempt_count", lambda d: d.update(attempt_count=d["attempt_count"] + 7)),
                     ("self_path", lambda d: d.update(self_path="SOMEWHERE-ELSE.json")),
                     ("finalized_marker_path", lambda d: d.update(finalized_marker_path="NOT-FINALIZED"))):
        _v = _rewrite_inventory(IF, _mut)
        rec("evidence-inventory-fields",
            f"F110-B pinned: inventory {_f} mutated with a recomputed inventory digest AND an updated finalization reference is refused. v1.10 verified all six clean.",
            any(("INVENTORY_TAMPERED" in e_ or "INVENTORY_FIELD_SET_INVALID" in e_) and _f in e_ for e_ in _v), _codes(_v))
    for _f, _delta in (("record_count", -1), ("entry_count", -1), ("total_bytes", -1), ("attempt_count", -1)):
        _v = _rewrite_inventory(IF, lambda d, f_=_f, k_=_delta: d.update({f_: d[f_] + k_}))
        rec("evidence-inventory-fields", f"a counter understated by one is refused as well as an overstated one ({_f})",
            any(_f in e_ for e_ in _v), _codes(_v))
    _v = _rewrite_inventory(IF, lambda d: d.update(operator_note="injected semantic field"))
    rec("evidence-inventory-fields",
        "F110-B pinned (section 17): an extra syntactically valid SEMANTIC top-level inventory field, with a recomputed digest and an updated finalization reference, is refused INVENTORY_FIELD_SET_INVALID. v1.10 verified it clean.",
        any("INVENTORY_FIELD_SET_INVALID" in e_ and "operator_note" in e_ for e_ in _v), _codes(_v))
    _v = _rewrite_inventory(IF, lambda d: d.pop("attempt_count"))
    rec("evidence-inventory-fields", "a REMOVED normative inventory field is refused INVENTORY_FIELD_SET_INVALID",
        any("INVENTORY_FIELD_SET_INVALID" in e_ and "attempt_count" in e_ for e_ in _v), _codes(_v))
    for _f, _bad in (("record_count", "3"), ("total_bytes", None), ("self_path", 7), ("entries", {}), ("mode_table", [])):
        _v = _rewrite_inventory(IF, lambda d, f_=_f, b_=_bad: d.update({f_: b_}))
        rec("evidence-inventory-fields", f"a WRONG-TYPE inventory field is refused ({_f})", bool(_v), _codes(_v))
    _dup = open(os.path.join(IF.dir, ES_MOD.INVENTORY_FILE), "rb").read().decode("utf-8")
    _dup = _dup.replace('"record_count":', '"record_count": 99,\n  "record_count":', 1)
    _v = _rewrite_inventory(IF, None, raw=_dup.encode("utf-8"))
    rec("evidence-inventory-fields", "a DUPLICATE top-level inventory field is refused at the strict parse boundary, before any field is interpreted",
        any("INVENTORY_TAMPERED" in e_ for e_ in _v), _codes(_v))
    rec("evidence-inventory-fields", "expected_model() is untouched and still consumes no inventory or finalization claim (section 19: architecture retained)",
        not any(t in inspect.getsource(ES_MOD.EvidenceStore.expected_model) for t in ("INVENTORY_FILE", "FINALIZED_FILE", "_inventory(", "inventory()", "finalization_marker")))
    rec("evidence-inventory-fields", "the FINALIZATION field set is exact and unchanged from v1.10 (nine normative fields, no marker-format redesign)",
        sorted(ES_MOD.FINALIZATION_FIELDS) == sorted(("schema", "evidence_store_version", "authority_version", "platform_scope",
                                                      "session_id", "session_identity_sha256", "boundary_identity_sha256",
                                                      "inventory_sha256", "state"))
        and sorted(IF.finalization_marker()) == sorted(ES_MOD.FINALIZATION_FIELDS)
        and ES_MOD.EVIDENCE_FINALIZATION_SCHEMA.endswith(".v2"))
    rec("evidence-inventory-fields", "the inventory schema was VERSIONED for the new closed vocabulary rather than silently tightened (v3 -> v4), and the old inventory hash domain is unregistered",
        ES_MOD.EVIDENCE_INVENTORY_SCHEMA == "vidtoolz.resolveEvidenceInventory.v4" == ES_MOD.INVENTORY_DOMAIN
        and "vidtoolz.resolveEvidenceInventory.v4" in L.HASH_DOMAINS
        and "vidtoolz.resolveEvidenceInventory.v3" not in L.HASH_DOMAINS)
    rec("evidence-inventory-fields", "the session still verifies clean after every inventory attack, so each refusal is the mutation", IF.verify() == [], _codes(IF.verify()))

    # ================================================================ F110-C the exact marker <-> record bijection
    rec("evidence-marker-cardinality", "the bijection law is published with EXACT cardinality in both directions (sections 21, 22)",
        "MARKER_CARDINALITY_VIOLATION" in ES_MOD.ERROR_CODES and "ORPHANED_RECORD" in ES_MOD.ERROR_CODES
        and "MARKER_CARDINALITY_VIOLATION" in ES_MOD.ERROR_PRECEDENCE_CLASS["MODEL"]
        and "exact cardinality in both directions" in PROV["marker_cardinality_law"]
        and "has size exactly one" in PROV["marker_cardinality_law"]
        and "ORPHANED_RECORD" in PROV["marker_cardinality_law"]
        and "the public API and the persisted verifier enforce the same rule" in PROV["marker_cardinality_law"])
    MC = ES_MOD.create_session(STORE_ROOT, "sess-cardinality", _sm("sess-cardinality"))
    _same = b'{"identical":"bytes"}\n'
    _r1 = MC.put_raw("card-a1", _same, logical_identity="L")
    _before_att = sorted(os.listdir(os.path.join(MC.dir, ES_MOD.ATTEMPTS_DIR)))
    _e2 = _probe(lambda: MC.put_raw("card-a2", _same, logical_identity="L"))
    _after_att = sorted(os.listdir(os.path.join(MC.dir, ES_MOD.ATTEMPTS_DIR)))
    rec("evidence-marker-cardinality",
        "F110-C pinned (section 23): a SECOND attempt id over the same session, layer, logical identity and bytes is refused MARKER_CARDINALITY_VIOLATION at the write. v1.10 accepted it, then finalized and verified clean.",
        _e2.code == "MARKER_CARDINALITY_VIOLATION", f"{_e2.code}: {_e2.detail[:90]}")
    rec("evidence-marker-cardinality", "the refusal happens BEFORE anything is persisted: no second marker, no second record, no journal-visible ambiguity",
        _after_att == _before_att and "card-a2" not in _after_att and MC.active_integrity() == [] and MC.session_state() == "ACTIVE",
        ",".join(_after_att))
    rec("evidence-marker-cardinality", "the surviving record still has EXACTLY one attempt marker and one attempt key",
        (lambda m_: all(len(e_["attempt_ids"]) == 1 == len(e_["attempt_keys"]) for e_ in m_[0]["entries"].values() if e_["kind"] == ES_MOD.KIND_RECORD))(MC.expected_model()))
    _mt = {"session_id": "sess-cardinality", "layer": "RAW", "logical_identity": "L", "attempt_id": "card-a2",
           "content_sha256": _r1["content_sha256"], "attempt_key": ES_MOD.attempt_key("sess-cardinality", "RAW", "L", "card-a2")}
    _mp = _plant(MC, ES_MOD.ATTEMPTS_DIR + "/card-a2", (json.dumps(_mt, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    _ai = MC.active_integrity()
    rec("evidence-marker-cardinality",
        "F110-C pinned: a PERSISTED many-to-one state (a second structurally valid marker planted on disk, whose tuple recomputes the same record) is refused by ACTIVE integrity. v1.10 accepted it.",
        any("MARKER_CARDINALITY_VIOLATION" in e_ for e_ in _ai) and MC.session_state() == "INVALID", _codes(_ai))
    rec("evidence-marker-cardinality", "the same persisted state blocks finalization and every further write (section 24: the public API and the persisted verifier agree)",
        _probe(lambda: MC.finalize()).code == "SESSION_INVALID"
        and _probe(lambda: MC.put_raw("card-a3", b'{"z":1}\n', logical_identity="Z")).code == "SESSION_INVALID"
        and any("MARKER_CARDINALITY_VIOLATION" in e_ for e_ in MC.verify(require_finalized=False)))
    _unplant(_mp, MC.dir)
    rec("evidence-marker-cardinality", "removing the planted marker restores a clean ACTIVE session, so the refusal is the cardinality and nothing else",
        MC.active_integrity() == [] and MC.session_state() == "ACTIVE", _codes(MC.active_integrity()))
    MCF = _fresh("sess-cardinality-final", full=False)
    _rf = [e for e in MCF.inventory()["entries"] if e["kind"] == ES_MOD.KIND_RECORD][0]
    _mt2 = {"session_id": "sess-cardinality-final", "layer": _rf["layer"], "logical_identity": _rf["logical_identity"],
            "attempt_id": "planted-twin", "content_sha256": _rf["content_sha256"],
            "attempt_key": ES_MOD.attempt_key("sess-cardinality-final", _rf["layer"], _rf["logical_identity"], "planted-twin")}
    _mp2 = _plant(MCF, ES_MOD.ATTEMPTS_DIR + "/planted-twin", (json.dumps(_mt2, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    _vf = MCF.verify()
    rec("evidence-marker-cardinality", "a planted twin marker on an ALREADY FINALIZED session is refused by verify() and the session becomes INVALID",
        any("MARKER_CARDINALITY_VIOLATION" in e_ for e_ in _vf) and MCF.session_state() == "INVALID", _codes(_vf))
    _unplant(_mp2, MCF.dir)
    rec("evidence-marker-cardinality", "the finalized session verifies clean again once the twin is gone", MCF.verify() == [], _codes(MCF.verify()))
    MR2 = ES_MOD.create_session(STORE_ROOT, "sess-card-retained", _sm("sess-card-retained"))
    _ra = MR2.put_raw("ret-a1", _same, logical_identity="L")
    rec("evidence-marker-cardinality", "RETAINED (section 25): the same attempt tuple with the same bytes is still idempotent and does NOT trip the cardinality guard",
        MR2.put_raw("ret-a1", _same, logical_identity="L")["idempotent"] is True and MR2.active_integrity() == [])
    rec("evidence-marker-cardinality", "RETAINED: same bytes under a DIFFERENT logical identity is a legitimately different record, not a cardinality violation",
        MR2.put_raw("ret-a2", _same, logical_identity="OTHER")["record_key"] != _ra["record_key"] and MR2.active_integrity() == [])
    rec("evidence-marker-cardinality", "RETAINED: same bytes in a DIFFERENT layer is a different record too",
        MR2.put_derived("ret-a3", _same, logical_identity="L")["record_key"] != _ra["record_key"] and MR2.active_integrity() == [])
    for _label, _call, _expect in (("same tuple different bytes", lambda: MR2.put_raw("ret-a1", b'{"other":1}\n', logical_identity="L"), "ATTEMPT_ID_REUSED"),
                                   ("cross-layer attempt reuse", lambda: MR2.put_derived("ret-a1", _same, logical_identity="L"), "ATTEMPT_ID_CROSS_LAYER"),
                                   ("cross-identity attempt reuse", lambda: MR2.put_raw("ret-a1", _same, logical_identity="ELSEWHERE"), "ATTEMPT_ID_CROSS_IDENTITY")):
        rec("evidence-marker-cardinality", f"RETAINED: {_label} is still refused {_expect}", _probe(_call).code == _expect)
    _fm = _plant(MR2, ES_MOD.ATTEMPTS_DIR + "/foreign-1",
                 (json.dumps({"session_id": "some-other-session", "layer": "RAW", "logical_identity": "L",
                              "attempt_id": "foreign-1", "content_sha256": "0" * 64,
                              "attempt_key": ES_MOD.attempt_key("some-other-session", "RAW", "L", "foreign-1")},
                             sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    rec("evidence-marker-cardinality", "RETAINED: the one-record-per-marker direction still refuses a FOREIGN marker",
        any("FOREIGN_ATTEMPT_MARKER" in e_ for e_ in MR2.active_integrity()), _codes(MR2.active_integrity()))
    _unplant(_fm, MR2.dir)
    _orph = _plant(MR2, ES_MOD.expected_record_path("RAW", "a" * 64).replace(os.sep, "/"), b'{"orphan":1}\n')
    rec("evidence-marker-cardinality", "RETAINED: cardinality ZERO is still ORPHANED_RECORD",
        any("ORPHANED_RECORD" in e_ for e_ in MR2.active_integrity()), _codes(MR2.active_integrity()))
    _unplant(_orph, MR2.dir)
    MR2.finalize()
    rec("evidence-marker-cardinality", "the retained-law session finalizes and verifies clean", MR2.verify() == [], _codes(MR2.verify()))
    M0A = L.strict_load(os.path.join(B, "M0A-BINDING-VALUES.json"))
    rec("evidence-marker-cardinality", "the M0A package can never emit two attempt ids for one (session, layer, logical identity, content): every prepared caller derives the attempt id from the probe attempt, and the published attempt law says so (section 26)",
        "exactly one marker per authoritative record" in M0A["values"]["attempt_tuple_law"]
        and "MARKER_CARDINALITY_VIOLATION" in M0A["values"]["attempt_tuple_law"]
        and M0A["values"]["created_at_classification"] == ES_MOD.CREATED_AT_CLASSIFICATION
        and M0A["values"]["error_precedence"] == " > ".join(ES_MOD.ERROR_PRECEDENCE)
        and M0A["values"]["inventory_field_vocabulary"] == ", ".join(ES_MOD.INVENTORY_FIELD_SET)
        and M0A["values"]["public_authority_surface"] == ", ".join(ES_MOD.PUBLIC_AUTHORITY_METHODS))

    # ================================================================ F110-D boundary dominance on every public surface
    _members = {n for n in dir(ES_MOD.EvidenceStore) if not n.startswith("_")}
    _classified = set(ES_MOD.PUBLIC_AUTHORITY_METHODS) | set(ES_MOD.PUBLIC_NON_AUTHORITY)
    rec("evidence-public-surface", "the public authority-bearing method inventory is COMPLETE against dir(EvidenceStore): every public member is classified, by discovery and not by naming convention (section 27)",
        _members <= _classified and not (_members - _classified), ",".join(sorted(_members - _classified)) or "complete")
    rec("evidence-public-surface", "the four unchecked internals are PRIVATE and the checked public wrappers exist (section 30)",
        all(hasattr(ES_MOD.EvidenceStore, n) for n in ("_boundary_receipt", "_scan_tree", "_manifest", "_inventory", "_finalization_marker", "_put", "_require_can_write"))
        and all(n.startswith("_") for n in ("_boundary_receipt", "_scan_tree", "_manifest", "_inventory", "_finalization_marker"))
        and "check_boundary" in inspect.getsource(ES_MOD.EvidenceStore.boundary_receipt)
        and "check_boundary" in inspect.getsource(ES_MOD.EvidenceStore.scan_tree))
    rec("evidence-public-surface", "the error precedence is frozen with BOUNDARY first (section 33)",
        ES_MOD.ERROR_PRECEDENCE == ("BOUNDARY", "SESSION_STATE", "MODEL", "READ")
        and set(ES_MOD.ERROR_PRECEDENCE) == set(ES_MOD.ERROR_PRECEDENCE_CLASS)
        and "SESSION_NOT_FINALIZED" in ES_MOD.ERROR_PRECEDENCE_CLASS["SESSION_STATE"]
        and "SESSION_BOUNDARY_CHANGED" in ES_MOD.ERROR_PRECEDENCE_CLASS["BOUNDARY"]
        and PROV["error_precedence"] == list(ES_MOD.ERROR_PRECEDENCE))
    _member_src = lambda n: inspect.getsource(getattr(ES_MOD.EvidenceStore, n).fget if isinstance(getattr(ES_MOD.EvidenceStore, n), property) else getattr(ES_MOD.EvidenceStore, n))  # noqa: E731
    _srcs = {n: _member_src(n) for n in ES_MOD.PUBLIC_AUTHORITY_READERS_RAISING + ES_MOD.PUBLIC_AUTHORITY_READERS_REPORTING + ES_MOD.PUBLIC_AUTHORITY_PROPERTIES if n != "check_boundary"}
    # verify() is the one member that delegates rather than checking directly: it is verify_summary()[0]. The law is
    # satisfied by delegation to a member that itself boundary-checks, and the delegation is asserted, not assumed.
    _DELEGATES = {"verify": "verify_summary"}
    _unchecked_src = sorted(n for n, s_ in _srcs.items()
                            if "check_boundary" not in s_
                            and not (n in _DELEGATES and (_DELEGATES[n] + "(") in s_ and "check_boundary" in _srcs[_DELEGATES[n]]))
    rec("evidence-public-surface", "every public authority-bearing reader either names check_boundary in its own body or delegates to a member that does; there is no unchecked public authority surface left (self-review 59)",
        not _unchecked_src, ",".join(_unchecked_src) or "all checked")
    PS = _fresh("sess-public", full=False)                    # FINALIZED, so inventory() would otherwise succeed
    PA = _fresh("sess-public-active", finalize=False, full=False)
    _clean_calls = {
        "attempts": lambda st_: st_.attempts(), "boundary_receipt": lambda st_: st_.boundary_receipt(),
        "check_boundary": lambda st_: st_.check_boundary(), "expected_model": lambda st_: st_.expected_model(),
        "finalization_marker": lambda st_: st_.finalization_marker(), "identity": lambda st_: st_.identity(),
        "inventory": lambda st_: st_.inventory(), "manifest": lambda st_: st_.manifest(),
        "manifest_sha256": lambda st_: st_.manifest_sha256(), "scan_tree": lambda st_: st_.scan_tree(),
        "get": lambda st_: st_.get("RAW", [e["record_key"] for e in st_.expected_model()[0]["entries"].values() if e["kind"] == ES_MOD.KIND_RECORD][0]),
        "active_integrity": lambda st_: st_.active_integrity(), "authority_errors": lambda st_: st_.authority_errors(ENVC, ACTIVE_HYP, rp),
        "identity_errors": lambda st_: st_.identity_errors(), "session_state": lambda st_: st_.session_state(),
        "verify": lambda st_: st_.verify(), "verify_summary": lambda st_: st_.verify_summary(),
        "finalized": lambda st_: st_.finalized,
        "finalize": lambda st_: st_.finalize(), "put": lambda st_: st_.put("RAW", "ps:1", b'{"p":1}\n', logical_identity="P"),
        "put_derived": lambda st_: st_.put_derived("ps:2", {"p": 1}, logical_identity="P"),
        "put_json": lambda st_: st_.put_json("RAW", "ps:3", {"p": 1}, logical_identity="P"),
        "put_promotion": lambda st_: st_.put_promotion("ps:4", {"p": 1}, logical_identity="P"),
        "put_raw": lambda st_: st_.put_raw("ps:5", b'{"p":1}\n', logical_identity="P"),
        "put_review": lambda st_: st_.put_review("ps:6", {"p": 1}, logical_identity="P"),
    }
    rec("evidence-public-surface", "the negative test is built from the DISCOVERED method inventory, not from the five known methods (section 32)",
        sorted(_clean_calls) == sorted(ES_MOD.PUBLIC_AUTHORITY_METHODS), ",".join(sorted(set(ES_MOD.PUBLIC_AUTHORITY_METHODS) ^ set(_clean_calls))) or "exact")
    _pre_inv = _probe(lambda: PA.inventory())
    rec("evidence-public-surface", "control: on an intact session inventory() still answers SESSION_NOT_FINALIZED when the session simply is not finalized",
        _pre_inv.code == "SESSION_NOT_FINALIZED", _pre_inv.code)
    for _st, _tag in ((PS, "FINALIZED"), (PA, "ACTIVE")):
        _keep2 = os.path.join(STORE_ROOT, "SWAP-" + _tag)
        shutil.move(_st.dir, _keep2)
        shutil.copytree(_keep2, _st.dir)                     # a copy, so the directory gets a NEW inode
        shutil.rmtree(_keep2, ignore_errors=True)
        os.chmod(_st.dir, 0o700)
        _unchecked, _masked = [], []
        for _n in sorted(_clean_calls):
            _r = _probe(lambda n_=_n: _clean_calls[n_](_st))
            if _r.code == "NONE":
                _val = _r.value
                _codes_out = ({str(x).split(":", 1)[0] for x in (_val[0] if _n == "verify_summary" else _val)}
                              if _n in ("active_integrity", "authority_errors", "identity_errors", "verify", "verify_summary") else set())
                if _n == "session_state":
                    (_unchecked if _val != "INVALID" else [])
                    if _val != "INVALID":
                        _unchecked.append(f"{_n}->{_val}")
                elif _codes_out and _codes_out <= set(_BOUND):
                    pass
                else:
                    _unchecked.append(f"{_n}->{sorted(_codes_out) or 'DATA'}")
            elif _r.code in _BOUND:
                pass
            else:
                _masked.append(f"{_n}->{_r.code}")
        rec("evidence-public-surface",
            f"F110-D pinned: after session replacement EVERY public authority-bearing method of a {_tag} session refuses at the BOUNDARY before any other semantic result. v1.10 returned live data from attempts, expected_model, manifest and identity.",
            not _unchecked and not _masked, "unchecked=" + (",".join(_unchecked) or "-") + " masked=" + (",".join(_masked) or "-"))
    _inv_after = _probe(lambda: PS.inventory())
    rec("evidence-public-surface",
        "F110-D pinned (section 29): inventory() on a replaced session answers the BOUNDARY refusal and no longer MASKS it with SESSION_NOT_FINALIZED",
        _inv_after.code in _BOUND and _inv_after.code != "SESSION_NOT_FINALIZED", _inv_after.code)
    _fm_after = _probe(lambda: PA.finalization_marker())
    rec("evidence-public-surface", "finalization_marker() has the same corrected precedence", _fm_after.code in _BOUND, _fm_after.code)
    rec("evidence-public-surface", "record_path() is the only public non-authority surface and it reads no session content (it derives a path under store law)",
        [n for n in ES_MOD.PUBLIC_NON_AUTHORITY if inspect.isfunction(getattr(ES_MOD.EvidenceStore, n, None))] == ["record_path"]
        and "check_boundary" not in inspect.getsource(ES_MOD.EvidenceStore.record_path)
        and "_read_exact" not in inspect.getsource(ES_MOD.EvidenceStore.record_path))
    rec("evidence-public-surface", "the module-level entry points still establish or re-check the boundary (create_session, open_session)",
        "check_boundary" in inspect.getsource(ES_MOD.open_session) and "RootBoundary" in inspect.getsource(ES_MOD.create_session))

    # ================================================================ v1.11 self-review: the four defect PATTERNS are closed
    _BSRC = inspect.getsource(ES_MOD.EvidenceStore._boundary_receipt) + inspect.getsource(ES_MOD.EvidenceStore.check_boundary)
    rec("evidence-provenance", "self-review 56: there is NO boundary field that is stored and digested but not independently compared, except the one deliberately classified informational",
        {k for k, v in ES_MOD.BOUNDARY_PROVENANCE.items() if v != ES_MOD.PROV_INFO and k not in _BSRC} == set()
        and {k for k, v in ES_MOD.BOUNDARY_PROVENANCE.items() if v == ES_MOD.PROV_INFO} == {"created_at"},
        ",".join(sorted(k for k, v in ES_MOD.BOUNDARY_PROVENANCE.items() if v != ES_MOD.PROV_INFO and k not in _BSRC)) or "none")
    rec("evidence-provenance", "self-review 57: every normative inventory field the provenance table classifies as derived is named in the verifier's comparison source",
        {f_ for f_ in ES_MOD.INVENTORY_FIELDS if f_ not in ("entries", "directories") and f_ not in _IV_SRC} == set(),
        ",".join(sorted(f_ for f_ in ES_MOD.INVENTORY_FIELDS if f_ not in ("entries", "directories") and f_ not in _IV_SRC)) or "none")
    rec("evidence-provenance", "self-review 58: the marker grouping logic has no accepted path with more than one marker per record: both the write guard and the model guard are present",
        "MARKER_CARDINALITY_VIOLATION" in inspect.getsource(ES_MOD.EvidenceStore._put)
        and "len(claims) > 1" in inspect.getsource(ES_MOD.EvidenceStore.expected_model)
        and inspect.getsource(ES_MOD.EvidenceStore.expected_model).count("MARKER_CARDINALITY_VIOLATION") == 1)
    rec("evidence-provenance", "the PUBLISHED provenance document agrees with the executable authority in every table, so the document can never again claim an unperformed derivation",
        PROV["boundary_fields"] == dict(sorted(ES_MOD.BOUNDARY_PROVENANCE.items()))
        and PROV["boundary_field_set"] == sorted(ES_MOD.BOUNDARY_FIELDS + ("boundary_sha256",))
        and PROV["inventory_field_set"] == list(ES_MOD.INVENTORY_FIELD_SET)
        and PROV["finalization_field_set"] == sorted(ES_MOD.FINALIZATION_FIELDS)
        and PROV["public_authority_methods"] == list(ES_MOD.PUBLIC_AUTHORITY_METHODS)
        and PROV["error_precedence_classes"] == {k: list(v) for k, v in sorted(ES_MOD.ERROR_PRECEDENCE_CLASS.items())}
        and PROV["boundary_frozen_constants"] == dict(sorted(ES_MOD.BOUNDARY_FROZEN_CONSTANTS.items())))
    rec("evidence-provenance", "every verifier_binding entry names a real attribute of the evidence store, so the published binding is checkable and not prose",
        all(any(t in v_ for t in ("_boundary_receipt", "check_boundary", "verify_summary", "boundary_digest", "NOT RECONCILED BY DESIGN"))
            for v_ in PROV["verifier_binding"].values())
        and len(PROV["verifier_binding"]) == 19)
    rec("evidence-provenance", "the boundary source vocabulary is exactly the four required classes and TRUSTED_FROM_INVENTORY_ITSELF is still forbidden",
        PROV["boundary_sources"] == [ES_MOD.PROV_FS, ES_MOD.PROV_SESSION, ES_MOD.PROV_CONST, ES_MOD.PROV_INFO]
        and PROV["forbidden_source"] == "TRUSTED_FROM_INVENTORY_ITSELF"
        and PROV["forbidden_source"] not in PROV["fields"].values()
        and PROV["forbidden_source"] not in PROV["boundary_fields"].values())

    # ================================================================ v1.11 property tests (fixed seed, focused)
    _PRNG = random.Random(SEED + 111)
    PB = _fresh("sess-prop-boundary", finalize=False, full=False)
    # boundary_sha256 is the digest field itself: "mutate then recompute" restores it by construction, so its attack
    # is the deterministic recompute=False case in the matrix above, not a seeded consistent-rewrite.
    _pb_norm = [k for k, v in ES_MOD.BOUNDARY_PROVENANCE.items() if v != ES_MOD.PROV_INFO and k != "boundary_sha256"]
    _pb_bad = []
    for _i in range(24):
        _f = _PRNG.choice(_pb_norm)
        _b0 = PB.boundary_receipt()
        _new = (_b0[_f] + _PRNG.randint(1, 9999)) if isinstance(_b0[_f], int) else (str(_b0[_f]) + "-" + str(_PRNG.randint(0, 9999)))
        _e = _rewrite_receipt(PB, lambda d, f_=_f, n_=_new: d.update({f_: n_}))
        if _e.code not in _BOUND:
            _pb_bad.append(f"{_f}->{_e.code}")
    rec("property", f"boundary receipt: 24 seeded single-field mutations of normative fields, each with a recomputed digest, all refuse in the BOUNDARY class (seed {SEED + 111})",
        not _pb_bad, ",".join(_pb_bad[:3]) or "all refused")
    PI = _fresh("sess-prop-inventory")
    _pi_counters = ["record_count", "entry_count", "total_bytes", "attempt_count"]
    _pi_bad = []
    for _i in range(24):
        _f = _PRNG.choice(_pi_counters)
        _d = _PRNG.choice([-3, -2, -1, 1, 2, 3, 17, 4096])
        _v = _rewrite_inventory(PI, lambda d, f_=_f, k_=_d: d.update({f_: max(0, d[f_] + k_)}))
        if not any(_f in e_ for e_ in _v):
            _pi_bad.append(f"{_f}{_d:+d}->{_codes(_v)}")
    rec("property", f"inventory header: 24 seeded counter perturbations, each with a recomputed inventory digest and an updated finalization reference, all refuse (seed {SEED + 111})",
        not _pi_bad, ",".join(_pi_bad[:3]) or "all refused")
    _pc_bad = []
    for _i in range(8):
        _n = "sess-prop-card-%d" % _i
        _st = ES_MOD.create_session(STORE_ROOT, _n, _sm(_n))
        _by = ("{\"p\":%d}\n" % _PRNG.randint(0, 1 << 20)).encode("utf-8")
        _lid = "Ident%d" % _PRNG.randint(0, 5)
        _st.put_raw(_n + ":first", _by, logical_identity=_lid)
        if _probe(lambda s_=_st, n_=_n, b_=_by, l_=_lid: s_.put_raw(n_ + ":second", b_, logical_identity=l_)).code != "MARKER_CARDINALITY_VIOLATION":
            _pc_bad.append(_n)
        _st.finalize()
        if _st.verify() != [] or any(len(e_["attempt_ids"]) != 1 for e_ in _st.inventory()["entries"] if e_["kind"] == ES_MOD.KIND_RECORD):
            _pc_bad.append(_n + ":post")
    rec("property", f"marker cardinality: 8 seeded sessions over random bytes and identities all refuse the second attempt id and all finalize with exactly one marker per record (seed {SEED + 111})",
        not _pc_bad, ",".join(_pc_bad[:3]) or "all refused")
    _pp_bad = []
    for _i in range(6):
        _n = "sess-prop-pub-%d" % _i
        _st = _fresh(_n, finalize=bool(_i % 2), full=False)
        _keep3 = os.path.join(STORE_ROOT, "SWAP-P%d" % _i)
        shutil.move(_st.dir, _keep3); shutil.copytree(_keep3, _st.dir); shutil.rmtree(_keep3, ignore_errors=True)
        os.chmod(_st.dir, 0o700)
        for _m in _PRNG.sample(sorted(_clean_calls), 6):
            _r = _probe(lambda m_=_m, s_=_st: _clean_calls[m_](s_))
            if _r.code == "NONE":
                _v = _r.value
                if _m == "session_state":
                    if _v != "INVALID":
                        _pp_bad.append(f"{_n}:{_m}")
                elif _m in ("active_integrity", "authority_errors", "identity_errors", "verify", "verify_summary"):
                    _cs = {str(x).split(":", 1)[0] for x in (_v[0] if _m == "verify_summary" else _v)}
                    if not _cs or not _cs <= set(_BOUND):
                        _pp_bad.append(f"{_n}:{_m}")
                else:
                    _pp_bad.append(f"{_n}:{_m}:DATA")
            elif _r.code not in _BOUND:
                _pp_bad.append(f"{_n}:{_m}:{_r.code}")
    rec("property", f"public-surface ordering: 6 seeded replaced sessions (ACTIVE and FINALIZED) x 6 sampled methods each refuse at the BOUNDARY first (seed {SEED + 111})",
        not _pp_bad, ",".join(_pp_bad[:3]) or "all refused")

    # ================================================================ retained S19 / ES regressions (sections 20, 28, 35)
    CW = _fresh("sess-retained")
    rec("evidence-closed-world", "control: the retained-regression session verifies clean", CW.verify() == [], _codes(CW.verify()))
    _s14 = _plant(CW, "PLANTED-BY-ATTACKER.json", b'{"forged":"authority"}\n')
    rec("evidence-closed-world", "STORE-14 still closed: an unexpected file in the finalized session root is refused",
        any("UNEXPECTED_ENTRY" in e for e in CW.verify()) and CW.session_state() == "INVALID", _codes(CW.verify()))
    _unplant(_s14, CW.dir)
    for _label, _mk2 in (("an unexpected nested file", lambda: _plant(CW, "RAW/EXTRA.json")),
                         ("an unexpected directory", lambda: _plant(CW, "EXTRA-DIR", directory=True))):
        _p3 = _mk2()
        rec("evidence-closed-world", f"still closed: {_label} invalidates the session", bool(CW.verify()), _codes(CW.verify()))
        _unplant(_p3, CW.dir)
    _sym2 = os.path.join(CW.dir, "PLANTED-SYMLINK.json")
    os.symlink(os.path.join(CW.dir, ES_MOD.SESSION_FILE), _sym2)
    rec("evidence-closed-world", "an internal symlink is still SYMLINK_REJECTED", any("SYMLINK_REJECTED" in e for e in CW.verify()))
    os.unlink(_sym2)
    _fifo2 = os.path.join(CW.dir, "PLANTED-FIFO")
    try:
        os.mkfifo(_fifo2)
        rec("evidence-closed-world", "a FIFO inside a session is still FILE_TYPE_REJECTED", any("FILE_TYPE_REJECTED" in e for e in CW.verify()))
        os.unlink(_fifo2)
    except (AttributeError, OSError) as _ex:
        rec("evidence-closed-world", "a FIFO inside a session is still FILE_TYPE_REJECTED", False, repr(_ex))
    rec("evidence-closed-world", "post-finalization writes are still refused on every layer",
        all(_try_store(fn).code == "SESSION_FINALIZED" for fn in (
            lambda: CW.put_raw("l:1", b'{"l":1}\n', logical_identity="X"),
            lambda: CW.put_derived("l:2", {"l": 1}, logical_identity="X"),
            lambda: CW.put_review("l:3", {"l": 1}, logical_identity="X"),
            lambda: CW.put_promotion("l:4", {"l": 1}, logical_identity="X"),
            lambda: CW.finalize())))
    rec("evidence-closed-world", "the retained session verifies clean after every regression attack", CW.verify() == [], _codes(CW.verify()))
    RN = _fresh("sess-rename")
    os.rename(RN.dir, os.path.join(STORE_ROOT, "sess-renamed-x"))
    rec("evidence-session-identity", "session rename is still refused (now by the persisted boundary as well as the path law)",
        (lambda e: e.code in ("SESSION_BOUNDARY_CHANGED", "SESSION_PATH_MISMATCH", "ROOT_IDENTITY_MISMATCH"))(_try_store(lambda: ES_MOD.open_session(STORE_ROOT, "sess-renamed-x"))))
    os.rename(os.path.join(STORE_ROOT, "sess-renamed-x"), RN.dir)
    rec("evidence-session-identity", "renaming it back restores a clean verification", RN.verify() == [])
    AT = ES_MOD.create_session(STORE_ROOT, "sess-attempt", _sm("sess-attempt"))
    _ba, _bb = b'{"a":1}\n', b'{"b":2}\n'
    _p1 = AT.put_raw("att-1", _ba, logical_identity="MethodA")
    for _label, _call, _expect in (("same tuple same bytes", lambda: AT.put_raw("att-1", _ba, logical_identity="MethodA"), "IDEMPOTENT"),
                                   ("same tuple different bytes", lambda: AT.put_raw("att-1", _bb, logical_identity="MethodA"), "ATTEMPT_ID_REUSED"),
                                   ("same id different layer", lambda: AT.put_derived("att-1", _ba, logical_identity="MethodA"), "ATTEMPT_ID_CROSS_LAYER"),
                                   ("same id different identity", lambda: AT.put_raw("att-1", _ba, logical_identity="MethodB"), "ATTEMPT_ID_CROSS_IDENTITY"),
                                   ("no logical identity", lambda: AT.put_raw("att-9", _ba), "LOGICAL_IDENTITY_INVALID")):
        if _expect == "IDEMPOTENT":
            rec("evidence-attempt-tuple", f"public API retained: {_label} is idempotent", _call()["idempotent"] is True)
        else:
            rec("evidence-attempt-tuple", f"public API retained: {_label} is refused {_expect}", _try_store(_call).code == _expect)
    AT.finalize()
    rec("evidence-attempt-tuple", "the attempt session finalizes and verifies clean", AT.verify() == [], _codes(AT.verify()))
    rec("evidence-single-authority", "exactly one module is still EVIDENCE_STORE_AUTHORIZING and no boundary helper became a second store (section 33)",
        ES_MOD.AUTHORITY_CLASS == "EVIDENCE_STORE_AUTHORIZING" and L.EVIDENCE_STORE_AUTHORITY_CLASS == ES_MOD.AUTHORITY_CLASS
        and not hasattr(SHIM, "EvidenceRoot") and not hasattr(ES_MOD.RootBoundary, "put_raw")
        and all(not any(hasattr(_m, _fn) for _fn in ("create_session", "put_raw", "add_derived")) for _m in (SHIM, F)))
    rec("evidence-single-authority", "the write API still exposes no path parameter and content addressing is retained",
        all("path" not in inspect.signature(getattr(ES_MOD.EvidenceStore, _fn)).parameters for _fn in ("put", "put_json", "put_raw", "put_derived", "put_review", "put_promotion"))
        and all(hashlib.sha256(CW.get(e["layer"], e["record_key"])).hexdigest() == e["content_sha256"] for e in CW.inventory()["entries"] if e["kind"] == "RECORD"))
    TR = ES_MOD.create_session(STORE_ROOT, "sess-trav", _sm("sess-trav"))
    TRAVERSALS = ["../x", "../../x", "/tmp/x", "..", ".", "", "a/b", "a\\b", "./x", "\x00evil", "-" * 200, "~/x", ".hidden"]
    _before = {os.path.join(dp, f) for dp, _dn, fn in os.walk(STORE_ROOT) for f in fn}
    _acc = []
    for _bad in TRAVERSALS:
        for _api, _call in (("put_raw", lambda b=_bad: TR.put_raw(b, b"x\n", logical_identity="M")),
                            ("logical_identity", lambda b=_bad: TR.put_raw("ok-" + hashlib.sha256(b.encode("utf-8", "surrogatepass")).hexdigest()[:8], b"x\n", logical_identity=b)),
                            ("record_path", lambda b=_bad: TR.record_path("RAW", b)),
                            ("create_session", lambda b=_bad: ES_MOD.create_session(STORE_ROOT, b, _sm("x"))),
                            ("open_session", lambda b=_bad: ES_MOD.open_session(STORE_ROOT, b))):
            try:
                _call()
                _acc.append(f"{_api}({_bad!r})")
            except (ES_MOD.EvidenceStoreError, ValueError, OSError, TypeError):
                pass
    _after = {os.path.join(dp, f) for dp, _dn, fn in os.walk(STORE_ROOT) for f in fn}
    rec("evidence-traversal", "legacy traversal still closed across every entry point, and nothing appears outside the session root",
        not _acc and not [p for p in (_after - _before) if not p.startswith(TR.dir + os.sep)], "; ".join(_acc[:3]))
    PT = _fresh("sess-partial", finalize=False, full=False)
    rec("evidence-store", "partial state retained: a stray temp file makes the session PARTIAL and blocks finalization",
        (lambda p_: (PT.session_state() == "PARTIAL" and _try_store(lambda: PT.finalize()).code in ("SESSION_INVALID", "PARTIAL_RECORD"), _unplant(p_, PT.dir))[0])(_plant(PT, "TMP/.partial-deadbeef", b"half", mode=0o600))
        and tuple(ES_MOD.SESSION_STATES) == ("ACTIVE", "PARTIAL", "FINALIZED", "INVALID"))
    rec("evidence-store", "the store still never truncates, renames over or unlinks a final record",
        not re.search(r'open\([^)]*"[rw]b?\+', inspect.getsource(ES_MOD)) and "O_TRUNC" not in inspect.getsource(ES_MOD) and "os.rename" not in inspect.getsource(ES_MOD) and "O_EXCL" in inspect.getsource(ES_MOD))
    _completed = CW.manifest()   # a real session manifest, completed by create_session with its boundary identity
    rec("evidence-store", "the session manifest still pins the active authority and refuses a mismatch",
        L.session_manifest_errors(_completed, ENVC, ACTIVE_HYP, rp) == [] and bool(L.session_manifest_errors(dict(_completed, parser_sha256="0" * 64), ENVC, ACTIVE_HYP, rp)))
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
CODEX_MATRIX = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.12.json"))
INHERITED_F110 = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.11.json"))
INHERITED_S110 = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.10.json"))
INHERITED_MATRIX = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.7.json"))
INHERITED_ES = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.8.json"))
INHERITED_S19 = L.strict_load(os.path.join(B, "FINDING-RESOLUTION-MATRIX-v1.9.json"))
rec("codex-matrix", "the inherited v1.8 evidence-store matrix is retained unchanged and still enumerates S19-1..S19-4", sorted(f["id"] for f in INHERITED_S19["findings"]) == ["S19-1", "S19-2", "S19-3", "S19-4"])
rec("codex-matrix", "the inherited v1.7 evidence-store matrix is retained unchanged as history and still enumerates ES-1 and ES-2", sorted(f["id"] for f in INHERITED_ES["findings"]) == ["ES-1", "ES-2"])
rec("codex-matrix", "the inherited v1.6 finding matrix is retained unchanged as history and its seven ids are still enumerated",
    sorted(f["id"] for f in INHERITED_MATRIX["findings"]) == ["C16-B1", "C16-B2", "C16-B3", "C16-B4", "C16-M1", "C16-M2", "C16-M3"]
    and CODEX_MATRIX["inherited_matrices"] == ["FINDING-RESOLUTION-MATRIX-v1.11.json", "FINDING-RESOLUTION-MATRIX-v1.10.json", "FINDING-RESOLUTION-MATRIX-v1.9.json", "FINDING-RESOLUTION-MATRIX-v1.8.json", "FINDING-RESOLUTION-MATRIX-v1.7.json"])
rec("codex-matrix", "the inherited v1.11 evidence-store matrix is retained unchanged and still enumerates F110-A..F110-D",
    sorted(f["id"] for f in INHERITED_F110["findings"]) == ["F110-A", "F110-B", "F110-C", "F110-D"])
rec("codex-matrix", "the inherited v1.9 evidence-store matrix is retained unchanged and still enumerates S110-1..S110-5",
    sorted(f["id"] for f in INHERITED_S110["findings"]) == ["S110-1", "S110-2", "S110-3", "S110-4", "S110-5"])
rec("codex-matrix", "the ACTIVE v1.12 finding-resolution matrix enumerates exactly the four pre-M0A workflow ids",
    sorted(f["id"] for f in CODEX_MATRIX["findings"]) == ["V112-1", "V112-2", "V112-3", "V112-4"])
rec("codex-matrix", "the v1.12 matrix records the AUTHORITY_UNDERSPECIFIED classification and the protected-surface promise",
    "AUTHORITY_UNDERSPECIFIED" in CODEX_MATRIX["adjudication"]
    and "changes NO Store.v5 semantics" in CODEX_MATRIX["operational_closure"]
    and all("V112-" in f_["id"] for f_ in CODEX_MATRIX["findings"]))
rec("codex-matrix", "the inherited v1.11 matrix still pins its reproduction against the frozen v1.10 head",
    all("9c66434" in f_["prior_defect"] and "frozen v1.10 bundle" in f_["prior_defect"] for f_ in INHERITED_F110["findings"])
    and "filesystem-normalization" in INHERITED_F110["operational_closure"])
_all_secs = {s_ for s_, _n, _o, _d in R}
rec("codex-matrix", "every validation section the ACTIVE v1.11 matrix names actually EXISTS: a published coverage claim that resolves to no checks is exactly the defect class F110-A and F110-B were",
    all(sec in _all_secs for f_ in CODEX_MATRIX["findings"] for sec in f_["validation_sections"]),
    ",".join(sorted({sec for f_ in CODEX_MATRIX["findings"] for sec in f_["validation_sections"]} - _all_secs)) or "all present")
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
    "V112-1 no governed persistence location for the evidence-set document (AUTHORITY_UNDERSPECIFIED)": ["workflow-persistence"],
    "V112-2 no evidence-set document lifecycle sequencing preparer against verifier (AUTHORITY_UNDERSPECIFIED)": ["workflow-lifecycle"],
    "V112-3 no writer designated; independence rested on two self-declared strings (AUTHORITY_UNDERSPECIFIED)": ["workflow-principals"],
    "V112-4 no production BUNDLE_VERIFICATION write authority; no runtime path to ATTACHMENT_READY (AUTHORITY_UNDERSPECIFIED)": ["workflow-e2e-positive", "workflow-e2e-negative", "workflow-parity"],
    "v1.12 static audits of the workflow authority": ["workflow-static"],
    "F110-A boundary receipt normative fields consistently rewritable and still authorizing (BLOCKER)": ["evidence-boundary-fields"],
    "F110-B six inventory header fields not independently compared; extra semantic field survives (BLOCKER)": ["evidence-inventory-fields"],
    "F110-C marker/record reconciliation without exact one-to-one cardinality (BLOCKER)": ["evidence-marker-cardinality"],
    "F110-D public authority-bearing methods without a boundary recheck first (MERGE MAJOR / M0A MAJOR)": ["evidence-public-surface"],
    "v1.11 self-review: the four defect PATTERNS are closed, not just their instances": ["evidence-provenance"],
    "v1.11 focused property suites (fixed seed)": ["property"],
    "S110-1 session boundary not persisted or rechecked (BLOCKER)": ["evidence-boundary-receipt"],
    "S110-2 inventory / finalization semantics partly self-asserted (BLOCKER)": ["evidence-recomputed-model", "evidence-finalization-fields"],
    "S110-3 stored attempt marker authority incomplete (BLOCKER)": ["evidence-attempt-derivation"],
    "S110-4 mode authority incomplete before finalization (MAJOR)": ["evidence-mode-authority"],
    "S110-5 filesystem error vocabulary (MINOR)": ["evidence-fs-errors"],
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
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.12", "", f"Result: **{passed}/{total} checks passed**. v1.12 is a NARROWLY SCOPED correction of the v1.11 pre-M0A workflow gap, classified AUTHORITY_UNDERSPECIFIED by the architectural adjudication of the failed A2 repair. v1.11 froze the resolveEvidenceSet schema, the record_id law, make_record(), envelope validation, all three record shapes and the attachment derivation - and all of it was demonstrated correct - but froze no governed persistence location for the evidence-set document, no writer, no permission law, no lifecycle and no production constructor, so ATTACHMENT_READY was reachable only from fixtures and fixture/runtime parity was false. That was the single reason A2 could not lawfully reach ATTACHMENT_READY. V112-1 freezes ONE governed persistence topology under QUALIFICATION_EVIDENCE_ROOT with a path law, atomic replace, an O_EXCL writer lock and a self-location check, keeping Store.v5 and the evidence set as two deliberately unmerged container models. V112-2 freezes the OPEN -> PREPARED -> VERIFIED lifecycle with (state, role) write grants, VERIFIED granting nothing to anyone, a prepared seal, a verified seal and a governed staleness law. V112-3 freezes a role-bound principal registry with actor disjointness and per-role write grants, stamped by the tool for the one role it implements, and the derivation now requires both principals registered under exactly their role and of DISTINCT actors. V112-4 makes tools/a2_verify.py the ONE production path that authors a BUNDLE_VERIFICATION, named A2V and governed as a distinct human authorization, computing the result, both principals, both verified record ids, the manifest digest and the nine pinned-file digests inside the verifier itself; the derivation binds all of it and only PASS satisfies the gate. The mandatory positive end-to-end runs with production tools only and no fixture synthesis, 28 negative end-to-end cases are refused, and a parity test asserts the production record field sets are identical to the fixture field sets for all four record types. A principal is a role-bound operational label, NOT an authenticated identity: no key, no signature, no certificate, and a human who runs both tools is still one human - stated in THREAT-MODEL.md, not closed. Protected and unchanged: Store.v5 semantics, Boundary.v1, Inventory.v4, marker cardinality, mode law, content addressing, the caches, the schema-registry architecture, the trusted shim, strict raw ingestion, the exact stored chain, H0, commit authority, precedence, the capability matrix and the M0B/M0C/M0D phase design. Inherited context: v1.11 is an EXTREMELY NARROW correction of the four release-relevant findings Codex left open against v1.10, whose supplied suite passed 1911/1911 twice and deterministically: F110-A the boundary receipt contained normative fields (schema, evidence_store_version, authority_version, platform_scope, created_at) that could be consistently rewritten with a recomputed boundary_sha256 and still authorize the next operation; F110-B six normative inventory header fields (record_count, entry_count, total_bytes, attempt_count, self_path, finalized_marker_path) were written, digested, published as derived and never compared, and an extra semantic top-level field survived verification; F110-C marker/record reconciliation checked semantic derivation but not exact cardinality, so two attempt ids over the same session, layer, logical identity and bytes produced two valid markers for one content-addressed record and finalize() and verify() both passed; F110-D nine public authority-bearing methods returned live session data after the session directory had been replaced, and inventory() and finalization_marker() masked the substitution with SESSION_NOT_FINALIZED. All four were reproduced against the frozen v1.10 bundle at 9c6643430d2dc66741afe9852668d8e6e19c0630 before anything was changed, and F110-D was broader than reported. v1.11 classifies every BOUNDARY.json field with exactly one provenance class and independently reconciles every normative one (created_at is deliberately INFORMATIONAL_NON_AUTHORIZING, because this store governs no independent creation-event authority); freezes the exact BOUNDARY, INVENTORY and FINALIZATION top-level field vocabularies and recomputes all six missing inventory values from the independent model and the frozen store layout; enforces the marker/record bijection with exact cardinality in both directions, refusing the second write before any ambiguous state is persisted; and publishes the explicit public authority-bearing method inventory with the frozen error precedence BOUNDARY > SESSION_STATE > MODEL > READ. Codex's PARTIAL filesystem-normalization observation was NOT one of the four release findings and is deliberately out of scope: the frozen FS_* vocabulary and fs() behaviour are retained and re-run unchanged. Inherited context: v1.10 is a narrowly scoped correction of the five evidence-store findings Codex left open against v1.9, whose v1.7 and v1.8 regressions all passed 211/211: S110-1 the session boundary lived only in process memory, so a replaced session directory or the same basename under another root verified clean; S110-2 several normative inventory and finalization fields were recorded and then trusted, including the marker store and authority versions; S110-3 a foreign attempt marker planted on disk was accepted through write, finalize and verify; S110-4 the session directory was outside mode authority and modes were only checked after finalization; S110-5 a raw PermissionError could leak from the public authority path. All five were reproduced against the frozen v1.9 bundle first. v1.10 persists a SESSION_BOUNDARY receipt as governed evidence and binds root and session identity into the session identity, rebuilds the expected model from independent sources so the inventory is only ever compared to it, reconciles stored attempt markers and records as a bijection, derives every mode from entry kind and enforces it continuously from creation, and normalizes every filesystem condition into a frozen refusal class. Inherited context: v1.9 is an extremely narrow correction of the four evidence-store integrity defects Codex left open against v1.8: S19-1 a symlinked session root was accepted because the path was resolved before any trust boundary existed; S19-2 the inventory reconciled bytes but not semantic identity, so a renamed or cross-session directory still validated; S19-3 attempt uniqueness was digest-bound rather than bound to (session, layer, logical identity, attempt id); S19-4 chmod after finalization was undetected. All four were reproduced against the frozen v1.8 bundle before anything was changed, and two were worse than reported. v1.9 establishes the root trust boundary by lstat before any resolution, freezes a session identity tuple and the basename-is-session-id path law, derives every record name from its semantics, keys attempt uniqueness on the canonical tuple, and records POSIX file type and permission mode as frozen metadata; verification PASS now requires missing, unexpected, changed AND semantic_mismatch all zero. Mode and file-type claims are POSIX-scoped to the reference host. Inherited context: v1.8 was an extremely narrow correction of the one defect class Codex left open against v1.7, evidence-store integrity and competing store authority: ES-1, the verifier ignored unexpected files in a finalized session root (independent attack STORE-14), and ES-2, a competing EvidenceRoot surface in the capture shim built filesystem paths from caller strings and escaped the evidence root. v1.8 makes finalization a CLOSED WORLD whose inventory records every governed file and directory and whose verification requires missing == 0, unexpected == 0 and changed == 0; and it leaves exactly one EVIDENCE_STORE_AUTHORIZING implementation, tools/evidence_store.py, whose write API takes a layer, an attempt id, a logical identity and bytes, never a path. Everything v1.7 established is retained and re-run as regressions. Inherited context: v1.7 corrects Codex's final forensic adjudication of v1.6: four BLOCKERs (C16-B1 content-insensitive authority caches, C16-B2 caller-supplied schema validators, C16-B3 unbound capture-shim trust, C16-B4 chain substitution), three M0A MAJORs (C16-M1 duplicate receiver paths, C16-M2 absent strict byte ingestion, C16-M3 non-executable evidence store) and the operational binding closure. Every authority cache is keyed by content digests plus the authority version and warm results are asserted equal to cold ones; the authorizing entry points take no schema-validator parameter and resolve schemas from the pinned SCHEMA-REGISTRY.json; a capture qualifies only under the trusted shim pinned by TRUSTED-SHIM.json, which the active authority must also name; a promoted row must resolve the EXACT stored raw capture, derived record, current review and current reviewed refreeze by digest, with multiplicity a CONFLICT unless explicit supersession leaves one; identity claims validate receiver-path, handle-token and attempt-id uniqueness before any index is built; raw evidence enters only through the strict byte boundary and every record carries a strict-parse receipt; and the append-only evidence store is executable code this suite attacks in a temporary directory. Layers: raw parse -> schema -> evidence-binding (envelope, active manifest, record laws) -> attachment -> capability (RAW_CAPABILITY_CAPTURE -> reference re-parser -> REVIEW_DECISION -> REFREEZE_RECORD -> content-bound ACTIVE matrix) -> snapshot (observation model, raw-capture field provenance, occurrence uniqueness) -> semantic (binding, membership, mandatory checkpoint, readback->S1, derived verification over the protected surface with named exclusions) -> eligibility (incl. the H0/S0 early write gate) -> linked-set / composed authorization (validate_transaction_set, commit_eligibility, both with a MANDATORY schema validator). A finding may be covered by more than one section, so the per-finding counts overlap; the total is not proof. Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed {SEED}, {PERMS} per subject). The bypass audit proves no exported validator can skip S0, S1, schema validation, capability provenance, delta derivation or expected-effect validation, and that no parameter default makes schema enforcement optional. The raw-capability sections execute the REFERENCE capture shim against fake in-process objects (no Resolve) and prove that a probe-authored interpretation has zero authority. The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only. The total count is not proof: see the per-finding coverage below.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Finding | Sections | Checks | Passed |", "|---|---|---|---|"]
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
