#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.4.
Layers: raw parse (strict duplicate keys) -> schema (Draft 2020-12) -> evidence-binding (envelope + active manifest) -> attachment
(derived state, freshness, coherence) -> capability (qualification authenticity) -> snapshot (observation model + capability coupling)
-> semantic (binding, membership, derived verification) -> eligibility (evaluate_eligibility) -> linked-set (validate_transaction_set).
Every fixture records its expected failure layer; an exception in a check is a FAIL, never a pass. Order-independence is proven by
seeded random permutations of evidence maps, snapshot arrays and linked-set members. The exact-manifest binding is proven against the
REAL FREEZE-MANIFEST.json sha when present (the report never embeds that sha, so validate -> manifest -> validate converges).
Offline; no Resolve. Exit 0 only if every check passes. Writes VALIDATION-REPORT.md.
Run: python3 -B tools/validate_v1_4.py
"""
import copy
import glob
import hashlib
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

try:
    import jsonschema
except ImportError:  # pragma: no cover
    print("python jsonschema >= 4.10 required")
    sys.exit(2)

R = []
SEED = 20260909
PERMS = 4


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
    if isinstance(doc, list):
        return [e for d in doc for e in v.iter_errors(d)]
    return list(v.iter_errors(doc))


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


# ---- 3. frozen instances (schema + semantic) and v1.4 structural laws
tc = load("TARGET-CONTRACT.json"); perms = load("PERMISSIONS.json"); rp = load("READ-PRIMITIVES.json"); caps = load("CAPABILITIES.json")
INSTANCES = [("TARGET-CONTRACT.json", "resolveTargetContract", L.semantic_target_contract), ("TIMEBASE.json", "resolveTimebase", L.semantic_timebase), ("schemas/resolveTrackPolicy.v1.json", "resolveTrackPolicy", L.semantic_track_policy), ("CANARY-SOURCE-MANIFEST.json", "resolveCanarySourceManifest", L.semantic_canary_manifest), ("PERMISSIONS.json", "resolvePermissions", None), ("CAPABILITIES.json", "resolveCapabilityMatrix", L.semantic_capabilities), ("READ-PRIMITIVES.json", "resolveReadPrimitives", lambda d: L.semantic_read_primitives(d, caps, perms))]
for inst, sch, fn in INSTANCES:
    d = load(inst)
    errs = schema_errs(V[sch], d)
    rec("frozen-instance-schema", inst, not errs, msgs(errs[:2]))
    if fn:
        se, exc = safe(fn, d)
        rec("frozen-instance-semantic", inst, not se and not exc, "; ".join(se[:3]))
rec("frozen-instance", "TARGET-CONTRACT has no declared attachment_state", "attachment_state" not in tc and tc.get("attachment_state_is_declared") is False)
rec("frozen-instance", "TARGET-CONTRACT enumerates CONFLICT as an attachment state", set(tc["attachment_states"]) == set(L.ATTACHMENT_STATES) | {L.CONFLICT_STATE})
rec("frozen-instance", "TARGET-CONTRACT carries the evidence envelope law (levels, coherence fields, currency, binding)", {"levels", "record_levels", "coherence_fields", "currency", "binding", "max_observation_age_s"} <= set(tc.get("evidence_envelope_law", {})) and tc["evidence_envelope_law"]["levels"] == L.ENVELOPE_REQUIRED and tc["evidence_envelope_law"]["max_observation_age_s"] == L.MAX_OBSERVATION_AGE_S)
rec("frozen-instance", "CAPABILITIES has zero QUALIFIED_READ rows in v1.4", not any(r["evidence_class"] == "QUALIFIED_READ" for r in caps["rows"]))
rec("frozen-instance", "every read row is probe_candidate", all(r.get("probe_candidate") is True for r in caps["rows"] if r["operation"].startswith("read:")))
rec("frozen-instance", "CAPABILITIES refreeze block is unreviewed and promotes nothing", caps["refreeze"]["kind"] == "M0_READ_REQUALIFICATION" and caps["refreeze"]["reviewed"] is False and caps["refreeze"]["promoted_probe_ids"] == [] and caps["refreeze"]["review_decision_ref"] is None)
rec("frozen-instance", "CAPABILITIES declares the machine qualification pipeline (candidate -> review -> refreeze -> REFREEZE_RECORD -> active matrix)", len(caps.get("qualification_pipeline", [])) >= 5 and any("REFREEZE_RECORD" in s for s in caps["qualification_pipeline"]))
rec("frozen-instance", "no prior-version evidence record claims a probe result", all(x.get("result") == "UNQUALIFIED_PRIOR_VERSION" and x.get("probe_id") is None for r in caps["rows"] for x in r.get("evidence_records", [])))
probe = rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]
PROBE_METHODS = sorted({p["method"] for p in probe["primitives"]})
rec("frozen-instance", "probe produces CANDIDATE_EVIDENCE only and promotes nothing", probe.get("evidence_output") == "CANDIDATE_EVIDENCE" and probe.get("promotes_capability") is False and probe.get("read_only") is True and probe.get("purpose_is_qualification") is True)
rec("frozen-instance", "probe failure taxonomy equals the reference taxonomy", {k: sorted(v) for k, v in probe.get("failure_taxonomy", {}).items()} == {k: sorted(v) for k, v in L.PROBE_FAILURE_TAXONOMY.items()})
rec("frozen-instance", "every read primitive declares its receiver/object class", all(p.get("receiver") for spec in rp["logical_operations"].values() for p in spec["primitives"]))
snap_schema = load("schemas/resolveSnapshot.schema.json")
tl_fs = snap_schema["properties"]["payload"]["properties"]["timeline"]["properties"]["field_status"]
rec("frozen-instance", "timeline observation status model covers start/end frame, start timecode, width, height", {"start_frame", "end_frame", "start_timecode", "width", "height"} <= set(tl_fs["required"]) and set(tl_fs["required"]) == set(L.TIMELINE_STATUS_FIELDS) and "field_status" in snap_schema["properties"]["payload"]["properties"]["timeline"]["required"])
rec("frozen-instance", "timeline frame/geometry values are nullable in the schema (no fabricated values needed)", all("null" in snap_schema["properties"]["payload"]["properties"]["timeline"]["properties"][k]["type"] for k in ("start_frame", "end_frame", "width", "height", "start_timecode")))
rec("frozen-instance", "journal execution law: OP_STARTED -> APPLIED | OP_FAILED; READBACK_S1 after APPLIED", "APPLIED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "OP_FAILED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "READBACK_S1" in L.JOURNAL_TRANSITIONS["APPLIED"] and "APPLIED" not in L.JOURNAL_TRANSITIONS["PREFLIGHT_OK"] and L.OPERATION_BEARING_STATES == {"OP_STARTED", "APPLIED", "OP_FAILED"})

# ---- 4. active authority (fixtures are minted against a PLACEHOLDER manifest sha; the capability matrix sha must be current)
ACT = load("fixtures/evidence/ACTIVE-AUTHORITY-PLACEHOLDER.json")
CAPS_SHA = sha(os.path.join(B, "CAPABILITIES.json"))
HYP_PATH = "fixtures/eligibility/capabilities-hypothetical-refreeze.json"
HYP_SHA = sha(os.path.join(B, HYP_PATH))
rec("active-authority", "fixture placeholder is a well-formed sha256 and is not any real manifest", L.is_sha(ACT["placeholder_manifest_sha256"]) and ACT["placeholder_manifest_sha256"] == hashlib.sha256(b"VIDTOOLZ-FIXTURE-MANIFEST-PLACEHOLDER-v1.4").hexdigest())
rec("active-authority", "fixture capability matrix sha equals CAPABILITIES.json on disk", ACT["capability_matrix_sha256"] == CAPS_SHA)
rec("active-authority", "fixture hypothetical matrix sha equals the hypothetical file on disk", ACT["hypothetical_capability_matrix_sha256"] == HYP_SHA)
ACTIVE = {"authority_version": L.AUTHORITY_VERSION, "manifest_sha256": ACT["placeholder_manifest_sha256"], "capability_matrix_sha256": CAPS_SHA}
ACTIVE_HYP = dict(ACTIVE, capability_matrix_sha256=HYP_SHA)
CAPS_CACHE = {"CAPABILITIES.json": caps, HYP_PATH: load(HYP_PATH)}


def caps_for(path):
    return CAPS_CACHE[path]


def active_for(path):
    return ACTIVE_HYP if path == HYP_PATH else ACTIVE


hyp = caps_for(HYP_PATH)
rec("active-authority", "hypothetical matrix is labelled HYPOTHETICAL_NOT_AUTHORITY and is not the frozen matrix", "HYPOTHETICAL_NOT_AUTHORITY" in hyp["qualification_note"] and hyp["version"] != caps["version"] and HYP_SHA != CAPS_SHA)
se, exc = safe(L.semantic_capabilities, hyp)
rec("active-authority", "hypothetical refrozen matrix is internally consistent (reviewed refreeze block, SUCCESS evidence per row)", not se and not exc, "; ".join(se[:2]))

# ---- 5. evidence sets: schema, structural/binding validity, derived attachment state
EVS = {}
SCHEMA_NEG = {"invalid-provisioning-without-root": "library_root"}
BINDING_NEG = {"invalid-tampered-record": "content digest", "invalid-connection-wrong-manifest": "active reviewed manifest", "invalid-connection-other-authority": "bound to authority", "invalid-bundle-other-manifest-not-historical": "active reviewed manifest", "invalid-provisioning-without-root": "library_root"}
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
# adversarial references
base_es = EVS["attached"]
rid = next(iter(base_es["records"]))
for nm, ref, exp in (("empty string", "", "not a sha256"), ("boolean-string false", "false", "not a sha256"), ("uppercase sha", rid.upper(), "not a sha256"), ("unlinked sha", "9" * 64, "not in evidence set"), ("wrong type", rid, "has type"), ("short hex", rid[:63], "not a sha256"), ("sha with newline", rid + "\n", "not a sha256")):
    r_, e_ = L.resolve_ref(base_es, ref, "M3_AUTHORIZATION", active=ACTIVE)
    rec("evidence-ref-negative", nm, r_ is None and any(exp in x for x in e_), "; ".join(e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], {"host_name": "PRESTO"}, None, ACTIVE)
rec("evidence-ref-negative", "record for another host", r_ is None and bool(e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], None, None, dict(ACTIVE, manifest_sha256="9" * 64))
rec("evidence-ref-negative", "record bound to another manifest is not evidence for the active authority", r_ is None and any("active authority" in x for x in e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], None, None, dict(ACTIVE, authority_version="1.3.0"))
rec("evidence-ref-negative", "record bound to another authority version is not evidence", r_ is None and any("active authority" in x for x in e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], None, None, ACTIVE)
rec("evidence-ref-positive", "linked correct-type record bound to the active authority resolves", r_ is not None and not e_)
# derived attachment states (all evaluated against the ACTIVE placeholder authority; write-ready-* with hypothetical refreeze also under ACTIVE_HYP)
EXPECT_STATE = {
    "empty": "UNPROVISIONED", "provisioned-only": "PROVISIONED_NOT_VERIFIED", "ready": "ATTACHMENT_READY",
    "ready-wrong-binary-pin": "PROVISIONED_NOT_VERIFIED", "ready-self-verified-bundle": "PROVISIONED_NOT_VERIFIED", "ready-bundle-other-host": "PROVISIONED_NOT_VERIFIED", "ready-bundle-historical-only": "PROVISIONED_NOT_VERIFIED", "ready-no-current-session": "PROVISIONED_NOT_VERIFIED", "ready-launch-previous-session-only": "PROVISIONED_NOT_VERIFIED", "ready-ghost-session-without-launch": "PROVISIONED_NOT_VERIFIED",
    "attached": "ATTACHED_READ_ONLY", "attached-reversed-order": "ATTACHED_READ_ONLY", "attached-stale-good-current-eka": "ATTACHMENT_READY", "attached-current-good-stale-eka": "ATTACHED_READ_ONLY", "attached-duplicate-sequence-conflict": "CONFLICT", "attached-duplicate-timestamp-distinct-sequence": "ATTACHED_READ_ONLY", "attached-connection-previous-session-only": "ATTACHMENT_READY", "attached-ancient-observation": "ATTACHMENT_READY", "attached-sequence-timestamp-disorder": "CONFLICT", "attached-missing-root-in-connection": "ATTACHMENT_READY", "attached-changed-uuid-in-connection": "ATTACHMENT_READY", "attached-second-provisioning-other-uuid": "CONFLICT", "attached-cross-library-timeline-binding": "CONFLICT", "attached-binding-other-session": "ATTACHED_READ_ONLY", "attached-fatal-probe-failure": "CONFLICT", "attached-capability-failure-only": "ATTACHED_READ_ONLY",
    "attached-eka-observed": "ATTACHMENT_READY", "attached-local-database-observed": "ATTACHMENT_READY", "attached-version-mismatch": "ATTACHMENT_READY", "attached-no-ids": "ATTACHED_READ_ONLY",
    "attached-candidate-evidence-unreviewed": "ATTACHED_READ_ONLY", "attached-evidence-failed-getters": "ATTACHED_READ_ONLY", "attached-evidence-wrong-build": "ATTACHED_READ_ONLY", "attached-evidence-old-refreeze": "ATTACHED_READ_ONLY", "attached-evidence-old-authority": "ATTACHED_READ_ONLY", "attached-evidence-no-raw": "ATTACHED_READ_ONLY", "attached-evidence-raw-tampered": "ATTACHED_READ_ONLY", "attached-evidence-wrong-receiver": "ATTACHED_READ_ONLY", "attached-reviewed-evidence": "ATTACHED_READ_ONLY", "attached-reviewed-evidence-minus-getstartframe": "ATTACHED_READ_ONLY",
    "write-ready-without-authorization": "ATTACHED_READ_ONLY", "write-ready-authorization-old-authority": "ATTACHED_READ_ONLY", "write-ready-refreeze-unreviewed": "ATTACHED_READ_ONLY", "write-ready-refreeze-other-matrix": "ATTACHED_READ_ONLY", "write-ready-base": "SCRATCH_WRITE_READY",
    "write-ready-hyp": "ATTACHED_READ_ONLY", "write-ready-full": "ATTACHED_READ_ONLY", "write-ready-stale-guard-current": "ATTACHED_READ_ONLY", "write-ready-plan-validation-fail": "ATTACHED_READ_ONLY",
    "invalid-tampered-record": "CONFLICT", "invalid-provisioning-without-root": "CONFLICT", "invalid-connection-wrong-manifest": "CONFLICT", "invalid-connection-other-authority": "CONFLICT", "invalid-bundle-other-manifest-not-historical": "CONFLICT",
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
rec("attachment-derived", "refreeze for another capability matrix never reaches SCRATCH_WRITE_READY", DERIVED["write-ready-refreeze-other-matrix"]["state"] == "ATTACHED_READ_ONLY" and any("REFREEZE_RECORD" in f for f in DERIVED["write-ready-refreeze-other-matrix"]["failures"]))
rec("attachment-derived", "mismatched observation reports OBSERVED_TARGET_MISMATCH", any("OBSERVED_TARGET_MISMATCH" in f for f in DERIVED["attached-eka-observed"]["failures"]))
rec("attachment-derived", "stale observation is reported as STALE, not silently ignored", any("STALE" in f for f in DERIVED["attached-ancient-observation"]["failures"]))
rec("attachment-derived", "missing connection root and changed uuid are OBSERVED_TARGET_MISMATCH, not accepted", any("root" in f for f in DERIVED["attached-missing-root-in-connection"]["failures"]) and any("uuid" in f for f in DERIVED["attached-changed-uuid-in-connection"]["failures"]))
rec("attachment-derived", "same evidence reversed gives an identical derivation", L.canon(DERIVED["attached"]) == L.canon(DERIVED["attached-reversed-order"]))
rec("attachment-derived", "contract naming a prohibited library is UNPROVISIONED", L.derive_attachment_state(dict(tc, library=dict(tc["library"], name="EKA")), EVS["attached"], ACTIVE)["state"] == "UNPROVISIONED")
rec("attachment-derived", "historical BUNDLE_VERIFICATION never serves as current authority", DERIVED["ready-bundle-historical-only"]["state"] == "PROVISIONED_NOT_VERIFIED" and "bundle_verification" not in DERIVED["ready-bundle-historical-only"]["proofs"])
rec("attachment-derived", "CONFLICT ranks below every ladder state", L.STATE_RANK[L.CONFLICT_STATE] < min(L.STATE_RANK[s] for s in L.ATTACHMENT_STATES))

# ---- 6. capability evidence authenticity (records, qualification, primitive status, zero qualified reads)
bad = []
for n_, es in EVS.items():
    for k, r_ in es["records"].items():
        if r_.get("record_type") == "CAPABILITY_EVIDENCE":
            e_ = L.semantic_capability_record(r_)
            if e_:
                bad.append(f"{n_}:{k[:8]}:{e_[0]}")
rec("capability", "every fixture CAPABILITY_EVIDENCE record obeys the result/qualification law", not bad, "; ".join(bad[:3]))
good = next(r_ for r_ in EVS["attached-reviewed-evidence"]["records"].values() if r_.get("record_type") == "CAPABILITY_EVIDENCE" and r_["method"] == "GetVersionString")
for nm, mut, exp in (("SUCCESS with a failure code", lambda r: r["result"].update(code="GETTER_RAISED"), "code:null"), ("failed observation ACCEPTed", lambda r: r["result"].update(classification="CAPABILITY_FAILURE", success=False, code="GETTER_RAISED"), "never be ACCEPTed"), ("unreviewed candidate with a decision", lambda r: r["qualification"].update(reviewed=False), "unreviewed candidate"), ("ACCEPT without promotion", lambda r: r["qualification"].update(promoted_by=None), "promoted_by"), ("unknown classification", lambda r: r["result"].update(classification="FAILED: getter crashed"), "unknown classification"), ("fatal code under capability class", lambda r: r["result"].update(classification="CAPABILITY_FAILURE", success=False, code="WRONG_LIBRARY"), "does not belong")):
    r2 = copy.deepcopy(good); mut(r2)
    e_ = L.semantic_capability_record(r2)
    rec("capability-record-negative", nm, bool(e_) and any(exp in x for x in e_), "; ".join(e_[:2]) or "ACCEPTED (should be rejected)")
env = L._contract_env(tc)
rp_connect = next(p for p in rp["logical_operations"]["CONNECT"]["primitives"] if p["method"] == "GetVersionString")
es_rev = EVS["attached-reviewed-evidence"]
rec("capability", "reviewed, promoted, raw-backed SUCCESS record qualifies under the hypothetical active matrix", L.capability_record_qualifies(good, rp_connect, env, ACTIVE_HYP, es_rev))
for nm, mut, act, es_ in (
    ("wrong build", lambda r: r["envelope"].update(build=7), ACTIVE_HYP, es_rev), ("wrong version", lambda r: r["envelope"].update(resolve_version="21.0.3.0007"), ACTIVE_HYP, es_rev), ("wrong host", lambda r: r["envelope"].update(host_name="PRESTO"), ACTIVE_HYP, es_rev), ("wrong product", lambda r: r["envelope"].update(product="DaVinci Resolve"), ACTIVE_HYP, es_rev),
    ("wrong receiver/object class", lambda r: r.update(receiver_type="Fusion"), ACTIVE_HYP, es_rev), ("adjacent getter evidence (method renamed)", lambda r: r.update(method="GetProductName"), ACTIVE_HYP, es_rev),
    ("FAILED: getter crashed", lambda r: r["result"].update(classification="CAPABILITY_FAILURE", success=False, code="GETTER_RAISED"), ACTIVE_HYP, es_rev), ("candidate not reviewed", lambda r: r["qualification"].update(reviewed=False, decision=None, promoted_by=None), ACTIVE_HYP, es_rev), ("reviewed but REJECTed", lambda r: r["qualification"].update(decision="REJECT", promoted_by=None), ACTIVE_HYP, es_rev),
    ("promoted by an old refreeze (other matrix sha)", lambda r: r["qualification"]["promoted_by"].update(capability_matrix_sha256="0" * 64), ACTIVE_HYP, es_rev), ("promoted under another authority version", lambda r: r["qualification"]["promoted_by"].update(authority_version="1.3.0"), ACTIVE_HYP, es_rev), ("active refreeze differs from the promoting matrix", lambda r: None, ACTIVE, es_rev),
    ("raw evidence missing", lambda r: None, ACTIVE_HYP, EVS["attached-evidence-no-raw"]), ("raw evidence tampered", lambda r: None, ACTIVE_HYP, EVS["attached-evidence-raw-tampered"]), ("raw hash does not match the record", lambda r: r.update(raw_evidence_sha256="1" * 64), ACTIVE_HYP, es_rev),
):
    r2 = copy.deepcopy(good); mut(r2)
    if nm.startswith("adjacent"):
        # a record for another method must not qualify THIS method: check through primitive_status over a set without this method's record
        es_adj = {"schema": es_rev["schema"], "current_session_id": es_rev["current_session_id"], "evaluated_at": es_rev["evaluated_at"], "records": {k: v for k, v in es_rev["records"].items() if not (v.get("record_type") == "CAPABILITY_EVIDENCE" and v["method"] == "GetVersionString")}}
        ok = L.primitive_status(hyp, rp_connect, "GetVersionString", es_adj, env, ACTIVE_HYP) == "UNQUALIFIED"
        rec("capability-qualification-negative", nm, ok)
        continue
    rec("capability-qualification-negative", nm, not L.capability_record_qualifies(r2, rp_connect, env, act, es_))
rec("capability", "frozen matrix + reviewed evidence -> UNQUALIFIED (candidate evidence never qualifies without a refrozen matrix)", L.primitive_status(caps, rp_connect, "GetVersionString", es_rev, env, ACTIVE) == "UNQUALIFIED")
rec("capability", "hypothetical refrozen matrix + reviewed linked evidence -> QUALIFIED_CALLABLE", L.primitive_status(hyp, rp_connect, "GetVersionString", es_rev, env, ACTIVE_HYP) == "QUALIFIED_CALLABLE")
rec("capability", "hypothetical matrix + unreviewed candidates -> UNQUALIFIED", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS["attached-candidate-evidence-unreviewed"], env, ACTIVE_HYP) == "UNQUALIFIED")
rec("capability", "hypothetical matrix + failed getters -> UNQUALIFIED", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS["attached-evidence-failed-getters"], env, ACTIVE_HYP) == "UNQUALIFIED")
rec("capability", "hypothetical matrix + wrong build evidence -> UNQUALIFIED", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS["attached-evidence-wrong-build"], env, ACTIVE_HYP) == "UNQUALIFIED")
rec("capability", "hypothetical matrix + old refreeze evidence -> UNQUALIFIED", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS["attached-evidence-old-refreeze"], env, ACTIVE_HYP) == "UNQUALIFIED")
rp_probe_entry = next(p for p in probe["primitives"] if p["method"] == "GetCurrentDatabase")
rec("capability", "probe entry on a probe_candidate row -> PROBE_ALLOWED under the frozen matrix", L.primitive_status(caps, rp_probe_entry, "GetCurrentDatabase", EVS["ready"], env, ACTIVE) == "PROBE_ALLOWED")
rec("capability", "the same getter outside the probe -> UNQUALIFIED under the frozen matrix", L.primitive_status(caps, next(p for p in rp["logical_operations"]["CONNECT"]["primitives"] if p["method"] == "GetCurrentDatabase"), "GetCurrentDatabase", EVS["ready"], env, ACTIVE) == "UNQUALIFIED")
rec("capability", "unknown method -> UNKNOWN_METHOD", L.primitive_status(caps, None, "FrobnicateEverything", EVS["ready"], env, ACTIVE) == "UNKNOWN_METHOD")
CALL_FROZEN = L.callable_method_set(caps, rp, EVS["attached"], tc, ACTIVE)
CALL_HYP = L.callable_method_set(hyp, rp, es_rev, tc, ACTIVE_HYP)
rec("zero-qualified-reads", "nothing is callable under the frozen v1.4 matrix (0 of every read primitive)", CALL_FROZEN == set())
rec("zero-qualified-reads", "hypothetical refreeze makes every read primitive callable (positive path exists)", CALL_HYP == set(PROBE_METHODS) and set(m for v in L.FIELD_PRIMITIVE.values() for m in v) <= CALL_HYP)
rec("zero-qualified-reads", "GetStartFrame alone drops out when its evidence is absent (degraded timeline observation)", L.callable_method_set(hyp, rp, EVS["attached-reviewed-evidence-minus-getstartframe"], tc, ACTIVE_HYP) == CALL_HYP - {"GetStartFrame"})
rec("zero-qualified-reads", "CONNECT/TIMEBASE_OBSERVE carry REFUSE fallbacks; SNAPSHOT_CAPTURE degrades", all(p["fallback_if_unqualified"] == "REFUSE" for op in ("CONNECT", "TIMEBASE_OBSERVE") for p in rp["logical_operations"][op]["primitives"]) and all(p["fallback_if_unqualified"] in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE") for p in rp["logical_operations"]["SNAPSHOT_CAPTURE"]["primitives"]))

# ---- 7. layered fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_capabilities": L.semantic_capabilities}
layer_counts = {}
LAYERED = {}


def callable_from(fx):
    if not fx.get("capabilities") or not fx.get("evidence_set"):
        return None
    return L.callable_method_set(caps_for(fx["capabilities"]), rp, EVS[fx["evidence_set"]], tc, active_for(fx["capabilities"]))


def run_check(chk, doc, fx):
    if chk == "semantic_mutation_plan":
        return L.semantic_mutation_plan(doc, perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), fx.get("guard_digest"))
    if chk == "semantic_journal":
        return L.semantic_journal(doc, fx.get("plan"))
    if chk == "semantic_verification_result":
        return L.semantic_verification_result(doc, fx.get("plan"), fx.get("s0"), fx.get("s1"), fx.get("journal"))
    if chk == "semantic_conflict":
        return L.semantic_conflict(doc, fx.get("plan"))
    if chk == "semantic_commit_manifest":
        return L.semantic_commit_manifest(doc, fx.get("plan"), fx.get("journal"), fx.get("verification_result"), fx.get("conflicts") or [], fx.get("s0"), fx.get("s1"), ACTIVE)
    if chk == "semantic_snapshot":
        return L.semantic_snapshot(doc, callable_from(fx))
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

# ---- 8. linked-set fixtures (S0 -> plan -> journal -> S1 -> derived delta -> expected effect -> verification -> commit)
LINKED = {}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/linked-set/*.json"))):
    fx = load(rel)
    LINKED[fx["fixture"]] = fx
    es = EVS[fx["evidence_set"]]
    errs, exc = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, es, active_for(fx["capabilities"]), schema_validate, callable_from(fx))
    joined = "; ".join(errs)
    if exc:
        rec("linked-set", fx["fixture"], False, joined)
    elif fx["layer_expected_failure"] == "none":
        rec("linked-set-positive", fx["fixture"], not errs, joined)
    else:
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec("linked-set-negative", fx["fixture"], hit, joined if errs else "ACCEPTED (should be rejected)")
ts_ok = LINKED["linked-set-committed-consistent"]["set"]
rec("linked-set", "commit checker refuses hash-only verification", bool(L.semantic_commit_manifest(ts_ok["commit"], ts_ok["plan"], ts_ok["journal"], None, [], ts_ok["s0_snapshot"], ts_ok["s1_snapshot"], ACTIVE_HYP)))
rec("linked-set", "linked set without S0 is refused", bool(L.validate_transaction_set(dict(ts_ok, s0_snapshot=None), perms, rp, hyp, tc, EVS["write-ready-full"], ACTIVE_HYP)))
rec("linked-set", "plan_digest law: digest of body without refs", L.plan_digest_of(ts_ok["plan"]) == ts_ok["plan"]["plan_digest"] and L.plan_digest_of(dict(ts_ok["plan"], refs={})) == ts_ok["plan"]["plan_digest"])
rec("linked-set", "plan_digest changes when an operation changes", L.plan_digest_of(dict(ts_ok["plan"], operations=[])) != ts_ok["plan"]["plan_digest"])
# derived delta and APPEND expected effect
s0f, s1f, planf, journalf = ts_ok["s0_snapshot"], ts_ok["s1_snapshot"], ts_ok["plan"], ts_ok["journal"]
delta = L.derive_delta(s0f, s1f)
rec("derived-delta", "S0 -> S1 delta derives exactly one added occurrence, nothing removed or changed", delta is not None and [a["unique_id"] for a in delta["added"]] == ["it-new"] and delta["removed"] == [] and delta["changed"] == [] and delta["markers_added"] == [] and delta["markers_removed"] == [])
rec("derived-delta", "identical S0/S1 derives an empty delta", L.derive_delta(s0f, s0f) == {"added": [], "removed": [], "changed": [], "markers_added": [], "markers_removed": []})
s1_flip = copy.deepcopy(s1f); s1_flip["payload"]["tracks"][0]["items"][1]["enabled"] = False
d2 = L.derive_delta(s0f, s1_flip)
rec("derived-delta", "a property change is derived as changed (enabled before/after)", d2 is not None and len(d2["changed"]) == 1 and d2["changed"][0]["fields"] == {"enabled": {"before": True, "after": False}})
s1_rm = copy.deepcopy(s1f); s1_rm["payload"]["tracks"][0]["items"] = s1_rm["payload"]["tracks"][0]["items"][1:]
d3 = L.derive_delta(s0f, s1_rm)
rec("derived-delta", "a missing occurrence is derived as removed", d3 is not None and [r_["unique_id"] for r_ in d3["removed"]] == ["it-1"])
rec("derived-delta", "delta is not derivable when item identity is unobserved (returns None, never guesses)", L.derive_delta(s0f, load("fixtures/snapshot/full-read-partial-item-ledger.json")) is None and L.verify_transaction(planf, s0f, load("fixtures/snapshot/full-read-partial-item-ledger.json"), journalf)["verdict"] == "UNOBSERVABLE_STATE")
rec("derived-delta", "S1 with every occurrence gone derives removals, not an error", L.derive_delta(s0f, load("fixtures/snapshot/m0-minimal-nothing-qualified.json")) is not None and len(L.derive_delta(s0f, load("fixtures/snapshot/m0-minimal-nothing-qualified.json"))["removed"]) == sum(len(t["items"]) for t in s0f["payload"]["tracks"]))
vt = L.verify_transaction(planf, s0f, s1f, journalf)
rec("append-effect", "APPEND with the expected new occurrence -> VERIFIED with creation identity mapped", vt["verdict"] == "VERIFIED" and vt["creation_identity_map"] == {"op-1": "it-new"} and vt["missing_expected"] == [] and vt["unrelated"] == [])
vt0 = L.verify_transaction(planf, s0f, s0f, journalf)
rec("append-effect", "APPEND with no new occurrence -> EXPECTED_DELTA_MISSING, empty creation map, never VERIFIED", vt0["verdict"] == "EXPECTED_DELTA_MISSING" and vt0["added"] == [] and vt0["creation_identity_map"] == {} and any("no new occurrence" in m for m in vt0["missing_expected"]))
vt1 = L.verify_transaction(planf, s0f, s1_flip, journalf)
rec("append-effect", "APPEND plus an unrelated property change -> UNEXPECTED_DELTA", vt1["verdict"] == "UNEXPECTED_DELTA" and any("changed" in u for u in vt1["unrelated"]))
s1_wrong = copy.deepcopy(s1f); s1_wrong["payload"]["tracks"][0]["items"][-1]["media_pool_item_unique_id"] = "mp-wrong"
rec("append-effect", "APPEND whose new occurrence has the wrong media identity is not the expected effect", L.verify_transaction(planf, s0f, s1_wrong, journalf)["verdict"] != "VERIFIED")
s1_pos = copy.deepcopy(s1f); s1_pos["payload"]["tracks"][0]["items"][-1].update(start=110200, end=110547)
rec("append-effect", "APPEND whose new occurrence is at the wrong position/range is not the expected effect", L.verify_transaction(planf, s0f, s1_pos, journalf)["verdict"] != "VERIFIED")
rec("append-effect", "APPEND not APPLIED in the journal cannot verify", L.verify_transaction(planf, s0f, s1f, journalf[:3])["verdict"] != "VERIFIED" and any("not APPLIED" in m for m in L.verify_transaction(planf, s0f, s1f, journalf[:3])["missing_expected"]))
rec("append-effect", "incomplete S1 -> UNOBSERVABLE_STATE", L.verify_transaction(planf, s0f, dict(s1f, coverage=dict(s1f["coverage"], complete=False)), journalf)["verdict"] == "UNOBSERVABLE_STATE")
ex = L.expected_effects(planf)
rec("append-effect", "expected effect of APPEND is an ADDED_ITEM on the selector track at the planned range", ex and ex[0]["kind"] == "ADDED_ITEM" and ex[0]["track_type"] == "video" and ex[0]["track_index"] == 1 and ex[0]["start"] == 110194 and ex[0]["end"] == 110541)
rec("append-effect", "effects are specified only for APPEND/DELETE/DISABLE/ENABLE/UPSERT_MARKER; others are NOT_YET_SPECIFIED", L.EFFECT_SPECIFIED_OPS == {"APPEND", "DELETE", "DISABLE", "ENABLE", "UPSERT_MARKER"} and L.expected_effects({"operations": [{"operation_id": "x", "op": "SET_PROPERTIES", "selector": {}}]})[0]["kind"] == "NOT_YET_SPECIFIED")
vr_attack = dict(ts_ok["verification"], added=[], creation_identity_map={}, s1_guard_digest=s0f["guard_digest"], s1_payload_sha256=s0f["payload_sha256"], readback_snapshot_sha256=L.snapshot_object_digest(s0f))
rec("append-effect", "declared APPEND+VERIFIED+added:[]+empty creation map is rejected against derived truth", any("differs from derived truth" in e for e in L.semantic_verification_result(vr_attack, planf, s0f, s0f, journalf)))
rec("s0-s1-resolution", "verification whose S1 digests are syntactically valid but do not resolve to the S1 record is rejected", any("S1 digests do not resolve" in e for e in L.semantic_verification_result(dict(ts_ok["verification"], s1_payload_sha256="9" * 64), planf, s0f, s1f, journalf)))
rec("s0-s1-resolution", "verification whose S0 digests do not resolve to the plan's S0 is rejected", any("S0" in e or "guard mismatch" in e for e in L.semantic_verification_result(dict(ts_ok["verification"], h0_guard_digest="9" * 64, h0_payload_sha256="9" * 64), planf, s0f, s1f, journalf)))
rec("s0-s1-resolution", "S1 for another target epoch breaks lineage", any("target_epoch" in e for e in L.guard_lineage_errors(s0f, dict(s1f, target_epoch="epoch-other"), planf)))
rec("s0-s1-resolution", "S0 that is not the plan's H0 breaks lineage", any("h0_guard_digest" in e for e in L.guard_lineage_errors(dict(s0f, guard_digest="9" * 64), s1f, planf)))
rec("journal-membership", "journal APPLIED operation ids are derived from records, not declared", L.journal_applied_ops(journalf) == ["op-1"] and L.journal_applied_ops(journalf[:3]) == [])
rec("journal-membership", "op-NOT-IN-PLAN is rejected as an invented operation", any("not in the bound plan" in e for e in L.semantic_journal([dict(r_, operation_id=("op-NOT-IN-PLAN" if r_["operation_id"] else None)) for r_ in journalf], planf)))

# ---- 9. canonicalization vectors, rejections, f64 exactness
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
rec("canon-vector", "payload domain is v1.4 and guard domain v2 is registered; guard v1 is not", all(x["domain"] == "vidtoolz.resolveSnapshotPayload.v1.4" for x in vec["vectors"] if "resolveSnapshotPayload" in x["domain"]) and "vidtoolz.resolveGuard.v2" in L.HASH_DOMAINS and "vidtoolz.resolveGuard.v1" not in L.HASH_DOMAINS and "vidtoolz.resolveSnapshotPayload.v1.3" not in L.HASH_DOMAINS)
rec("canon-vector", "a timeline with every field UNAVAILABLE is representable and hashable", "unobserved_timeline_all_null_with_status" in by)
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
rec("f64-exact", "valid canonical value accepted", L.validate_f64("3ff0000000000000") == "3ff0000000000000")


def _rejects(fn):
    try:
        fn()
        return False
    except L.CanonError:
        return True


rec("f64-exact", "one bit pattern one text (uppercase rejected, -0 rejected, whitespace rejected)", all(_rejects(lambda v=v: L.validate_f64(v)) for v in ("3FF0000000000000", "8000000000000000", " 3ff0000000000000", "3ff0000000000000\n", "3ff0000000000000\t")))

# ---- 10. eligibility (evidence-derived, active-authority-bound)
CASES = load("fixtures/eligibility/cases.json")["cases"]
ELIG = {}
for c in CASES:
    cp = caps_for(c["capabilities"])
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
rec("eligibility-invariant", "declared attachment_state in request is ignored", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {}, "attachment_state": "SCRATCH_WRITE_READY"}, rp, caps, tc, EVS["empty"], ACTIVE)["derived_attachment_state"] == "UNPROVISIONED")
rec("eligibility-invariant", "capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not)", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE_HYP)["eligible"] and not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, caps, tc, es_rev, ACTIVE)["eligible"])
rec("eligibility-invariant", "active authority argument is consumed (hypothetical matrix under the frozen matrix sha does not flip CONNECT)", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE)["eligible"])
rec("eligibility-invariant", "probe expands only probe_allowed primitives (no QUALIFIED_CALLABLE needed)", all(x["status"] == "PROBE_ALLOWED" for x in L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": next(k for k, v in EVS["ready"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")}}, rp, caps, tc, EVS["ready"], ACTIVE)["expanded_primitives"]))
rec("eligibility-invariant", "CONFLICT short-circuits: nothing is eligible and the conflicts are reported", ELIG["m0-snapshot-deny-duplicate-sequence-conflict"]["derived_attachment_state"] == "CONFLICT" and "ATTACHMENT_CONFLICT" in ELIG["m0-snapshot-deny-duplicate-sequence-conflict"]["reason_codes"] and ELIG["m0-snapshot-deny-duplicate-sequence-conflict"]["attachment_conflicts"])
rec("eligibility-invariant", "operation-specific attachment: ENUMERATE_PROJECTS needs no project binding while SNAPSHOT_CAPTURE needs project+timeline", ELIG["m0-enumerate-projects-allow-without-any-binding-records"]["eligible"] and not ELIG["m0-snapshot-deny-no-expected-timeline"]["eligible"] and not ELIG["m0-snapshot-deny-no-expected-project"]["eligible"] and not ELIG["m0-enumerate-timelines-deny-no-project"]["eligible"])
rec("permission-invariant", "no_mutation_before_M3", all(not e["mutation_allowed"] for e in perms["entries"] if e["milestone"] != "M3"))
rec("permission-invariant", "every_M3_mutation_requires_authorization_and_write_ready", all({"MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY"} <= set(e["prerequisites"]) for e in perms["entries"] if e["mutation_allowed"]))
rec("permission-invariant", "no_shared_library_grant", all(e["shared_library_allowed"] is False for e in perms["entries"]))
rec("permission-invariant", "default_deny", perms["default"] == "DENY")
rec("permission-invariant", "every_entry_has_prerequisites_and_target_requirement", all(e["prerequisites"] and e.get("target_requirement") in L.TARGET_REQUIREMENTS for e in perms["entries"]))
rec("permission-invariant", "probe entry carries PROBE_ALLOWED_PRIMITIVES", all("PROBE_ALLOWED_PRIMITIVES" in e["prerequisites"] for e in perms["entries"] if e["operation"] == "READ_PRIMITIVE_QUALIFICATION_PROBE"))
rec("permission-invariant", "no non-probe entry carries PROBE_ALLOWED_PRIMITIVES", all("PROBE_ALLOWED_PRIMITIVES" not in e["prerequisites"] for e in perms["entries"] if e["operation"] != "READ_PRIMITIVE_QUALIFICATION_PROBE"))
rec("permission-invariant", "CONNECT/ENUMERATE_PROJECTS/probe are SESSION; ENUMERATE_TIMELINES is PROJECT; SNAPSHOT_CAPTURE is PROJECT_TIMELINE", all(e["target_requirement"] == {"CONNECT": "SESSION", "ENUMERATE_PROJECTS": "SESSION", "READ_PRIMITIVE_QUALIFICATION_PROBE": "SESSION", "ENUMERATE_TIMELINES": "PROJECT", "SNAPSHOT_CAPTURE": "PROJECT_TIMELINE"}.get(e["operation"], e["target_requirement"]) for e in perms["entries"]))
rec("permission-invariant", "prerequisite_codes == library set", set(perms["prerequisite_codes"]) == L.PREREQ_CODES)

# ---- 11. order-independence (seeded random permutations; same evidence in any order must give the same result)
rng = random.Random(SEED)


def shuffle_obj(o):
    """Recursively permute dict key order; lists are permuted only where the caller asks (arrays with semantic order stay)."""
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


bad_e, n_e = [], 0
for c in CASES:
    base = ELIG.get(c["name"])
    if base is None:
        continue
    for i in range(PERMS):
        n_e += 1
        r2, exc = safe(L.evaluate_eligibility, perms, shuffle_obj(c["request"]), rp, caps_for(c["capabilities"]), tc, shuffle_es(EVS[c["evidence_set"]]), active_for(c["capabilities"]))
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
rec("order-independence", f"attachment: {len(DERIVED)} evidence sets x {PERMS} record-map permutations give identical derivations (state, proofs, failures, conflicts)", not bad_a, ",".join(bad_a[:4]))
bad_s, n_s = [], 0
for rel in sorted(glob.glob(os.path.join(B, "fixtures/snapshot/*.json"))):
    snap = load(rel)
    base_err = L.semantic_snapshot(snap, CALL_HYP)
    for i in range(PERMS):
        n_s += 1
        s2 = shuffle_payload(snap)
        try:
            same = L.snapshot_payload_digest(s2["payload"]) == snap["payload_sha256"] and L.guard_digest(s2) == snap["guard_digest"] and L.semantic_snapshot(s2, CALL_HYP) == base_err
        except Exception:  # noqa: BLE001
            same = False
        if not same:
            bad_s.append(os.path.basename(rel))
            break
rec("order-independence", f"snapshots: every snapshot fixture x {PERMS} track/item/marker/ledger permutations keeps payload digest, guard digest and semantic result", not bad_s, ",".join(bad_s[:4]) or f"{n_s} permutations")
bad_l = []
for name, fx in sorted(LINKED.items()):
    base_err, _ = safe(L.validate_transaction_set, fx["set"], perms, rp, caps_for(fx["capabilities"]), tc, EVS[fx["evidence_set"]], active_for(fx["capabilities"]), schema_validate, callable_from(fx))
    for i in range(PERMS):
        ts2 = shuffle_obj(fx["set"])
        ts2["conflicts"] = list(ts2.get("conflicts") or [])
        rng.shuffle(ts2["conflicts"])
        for key in ("s0_snapshot", "s1_snapshot"):
            if ts2.get(key):
                ts2[key] = shuffle_payload(ts2[key])
        e2, exc = safe(L.validate_transaction_set, ts2, perms, rp, caps_for(fx["capabilities"]), tc, shuffle_es(EVS[fx["evidence_set"]]), active_for(fx["capabilities"]), schema_validate, callable_from(fx))
        if exc or sorted(e2) != sorted(base_err):
            bad_l.append(name)
            break
rec("order-independence", f"linked sets: {len(LINKED)} sets x {PERMS} permutations of evidence map, conflicts, snapshot arrays and key order give identical validation", not bad_l, ",".join(bad_l[:4]))
# duplicate "current" records and reversed input are decided by sequence/ambiguity, never by position
dup = EVS["attached-duplicate-sequence-conflict"]
rev = {"schema": dup["schema"], "current_session_id": dup["current_session_id"], "evaluated_at": dup["evaluated_at"], "records": dict(reversed(list(dup["records"].items())))}
rec("order-independence", "two current-sequence contradictions stay CONFLICT in both input orders (no record[-1] shortcut)", L.derive_attachment_state(tc, dup, ACTIVE)["state"] == "CONFLICT" and L.derive_attachment_state(tc, rev, ACTIVE)["state"] == "CONFLICT")
sg = EVS["attached-stale-good-current-eka"]
sg_rev = {"schema": sg["schema"], "current_session_id": sg["current_session_id"], "evaluated_at": sg["evaluated_at"], "records": dict(reversed(list(sg["records"].items())))}
rec("order-independence", "stale-good/current-bad decides by sequence in both input orders (current EKA wins -> not attached)", L.derive_attachment_state(tc, sg, ACTIVE)["state"] == "ATTACHMENT_READY" and L.derive_attachment_state(tc, sg_rev, ACTIVE)["state"] == "ATTACHMENT_READY")
_src = open(os.path.join(HERE, "authority_lib.py"), encoding="utf-8").read()
_tail_users = set(re.findall(r"(\w+)\[-1\]", _src))
rec("order-independence", "lib never selects evidence by position (array tail only on the ordered journal chain)", _tail_users <= {"journal_records", "journal"}, ",".join(sorted(_tail_users)))

# ---- 12. v1.3 independent attacks must fail at the intended layer
ATTACKS = [
    ("wrong manifest accepted", [("evidence-set-binding-negative", "invalid-connection-wrong-manifest"), ("eligibility", "m0-probe-deny-wrong-manifest-record"), ("evidence-set-binding-negative", "invalid-bundle-other-manifest-not-historical")]),
    ("v1.3 manifest used as current qualification authority", [("attachment-derived", "ready-bundle-historical-only -> PROVISIONED_NOT_VERIFIED"), ("eligibility", "m0-probe-deny-bundle-historical-only")]),
    ("verification for another authority version", [("evidence-set-binding-negative", "invalid-connection-other-authority"), ("eligibility", "m0-probe-deny-other-authority-record")]),
    ("other-host verification", [("attachment-derived", "ready-bundle-other-host -> PROVISIONED_NOT_VERIFIED"), ("eligibility", "m0-probe-deny-bundle-other-host")]),
    ("EKA timeline mixed with qualification library", [("attachment-derived", "attached-cross-library-timeline-binding -> CONFLICT"), ("eligibility", "m0-snapshot-deny-cross-library-timeline-binding")]),
    ("UUID mismatch", [("attachment-derived", "attached-changed-uuid-in-connection -> ATTACHMENT_READY"), ("attachment-derived", "attached-second-provisioning-other-uuid -> CONFLICT"), ("eligibility", "m0-snapshot-deny-changed-uuid-in-connection")]),
    ("missing connection root", [("attachment-derived", "attached-missing-root-in-connection -> ATTACHMENT_READY"), ("eligibility", "m0-snapshot-deny-missing-root-in-connection"), ("evidence-set-schema-negative", "invalid-provisioning-without-root")]),
    ("stale/current contradiction", [("attachment-derived", "attached-stale-good-current-eka -> ATTACHMENT_READY"), ("attachment-derived", "attached-duplicate-sequence-conflict -> CONFLICT"), ("attachment-derived", "attached-sequence-timestamp-disorder -> CONFLICT"), ("eligibility", "m0-snapshot-deny-ancient-observation"), ("eligibility", "m0-snapshot-deny-connection-previous-session-only")]),
    ("failed getter evidence", [("capability-qualification-negative", "FAILED: getter crashed"), ("eligibility", "m0-connect-deny-hyp-failed-getters"), ("fixture-semantic-negative", "capabilities-qualified-read-on-failed-evidence")]),
    ("old refreeze evidence", [("capability-qualification-negative", "promoted by an old refreeze (other matrix sha)"), ("eligibility", "m0-connect-deny-hyp-old-refreeze"), ("eligibility", "m3-append-deny-refreeze-for-other-matrix")]),
    ("unreviewed candidate evidence", [("capability-qualification-negative", "candidate not reviewed"), ("eligibility", "m0-connect-deny-hyp-unreviewed-candidates")]),
    ("unplanned journal operation", [("fixture-semantic-negative", "journal-applied-operation-not-in-plan"), ("linked-set-negative", "linked-set-journal-invented-operation"), ("journal-membership", "op-NOT-IN-PLAN is rejected as an invented operation")]),
    ("APPEND verified with no created item", [("fixture-semantic-negative", "verification-append-no-added-item-claims-verified"), ("linked-set-negative", "linked-set-append-without-effect"), ("append-effect", "declared APPEND+VERIFIED+added:[]+empty creation map is rejected against derived truth")]),
    ("arbitrary S1 hashes", [("fixture-semantic-negative", "verification-arbitrary-s1-hash"), ("fixture-semantic-negative", "verification-arbitrary-readback-hash"), ("linked-set-negative", "linked-set-s1-arbitrary-hash")]),
    ("declared attachment/capability state in the request", [("eligibility", "m0-probe-deny-declared-state-ignored"), ("eligibility", "m0-connect-deny-qualified-read-string-ignored")]),
    ("snapshot claims OBSERVED fields nothing can produce", [("fixture-snapshot-negative", "snapshot-full-read-claimed-under-frozen-matrix"), ("fixture-snapshot-negative", "snapshot-m0-complete-claimed-nothing-qualified"), ("linked-set-negative", "linked-set-s0-observed-fields-not-callable")]),
]
for attack, refs in ATTACKS:
    res = [(s, n, result_of(s, n)) for s, n in refs]
    rec("v1.3-attack", attack, all(x[2] is True for x in res), "; ".join(f"{s}/{n}={'PASS' if ok else ('MISSING' if ok is None else 'FAIL')}" for s, n, ok in res if ok is not True))

# ---- 13. milestone matrix + probes
mx = load("MILESTONE-MATRIX.json")
for m, spec in mx["milestones"].items():
    es_ = [e for e in perms["entries"] if e["milestone"] == m]
    rec("milestone-matrix", f"{m} read ops match PERMISSIONS", sorted(e["operation"] for e in es_ if not e["mutation_allowed"]) == spec["read_operations"])
    rec("milestone-matrix", f"{m} mutation ops match PERMISSIONS", sorted(e["operation"] for e in es_ if e["mutation_allowed"]) == spec["mutation_operations"])
    rec("milestone-matrix", f"{m} target requirements match PERMISSIONS", spec["target_requirements"] == {e["operation"]: e["target_requirement"] for e in es_})
for m in ("M0", "M1", "M2"):
    rec("milestone-matrix", f"{m} has no mutation ops", mx["milestones"][m]["mutation_operations"] == [])
rec("milestone-matrix", "M3 is the only mutation milestone", bool(mx["milestones"]["M3"]["mutation_operations"]))
rec("milestone-matrix", "EKA not a scope anywhere", all("EKA" not in sc for sc in perms["scopes"]))
probes = load("M3-PROBES.json")
m3_ops = set(mx["milestones"]["M3"]["mutation_operations"]) | set(mx["milestones"]["M3"]["read_operations"])
for p in probes["probes"]:
    rec("m3-probe-permission", p["id"], all(op in m3_ops for op in p["operations"]), ",".join(op for op in p["operations"] if op not in m3_ops))
rec("m3-probe-count", "19 probes P1..P19; P0 is M0 preflight", probes["count"] == 19 and len(probes["probes"]) == 19 and probes["preflight_reference"]["milestone"] == "M0")
md = open(os.path.join(B, "M3-MATRIX.md"), encoding="utf-8").read()
rec("m3-probe-count", "M3-MATRIX.md rows match M3-PROBES.json ids", all(re.search(rf"^\| {p['id']} \|", md, re.M) for p in probes["probes"]))
p15 = next(p for p in probes["probes"] if p["id"] == "P15")
rec("m3-probe", "P15 claims no rename (no rename operation exists)", "rename" not in p15["title"].lower() and not any("rename" in op.lower() for op in p15["operations"]) and not any("rename" in e["operation"].lower() for e in perms["entries"]))

# ---- 14. authority precedence
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
rec("precedence", "v1.4 supersessions present", any(s_["effective_version"] == "1.4.0" for s_ in prec["superseded_statements"]))
rec("precedence", "v1.3 changelog and finding matrix are HISTORICAL; v1.4 ones are active", {e["path"]: e["status"] for e in prec["documents"]}.get("CHANGELOG-v1.3.md") == "HISTORICAL" and {e["path"]: e["status"] for e in prec["documents"]}.get("FINDING-RESOLUTION-MATRIX-v1.3.md") == "HISTORICAL" and {e["path"]: e["status"] for e in prec["documents"]}.get("CHANGELOG-v1.4.md") == "STILL_ACTIVE" and {e["path"]: e["status"] for e in prec["documents"]}.get("FINDING-RESOLUTION-MATRIX-v1.4.md") == "STILL_ACTIVE")
scx = open(os.path.join(B, "SCORECRAFT-EXTRACTION.md"), encoding="utf-8").read()
rec("precedence", "SCORECRAFT-EXTRACTION.md cites v1.4 active schemas, not v1.1/v1.3", "resolveTargetContract.v1.4" in scx and "resolveSnapshot.v1.4" in scx and not any(x in scx for x in ("resolveTargetContract.v1.1", "resolveSnapshot.v1.1", "resolveTargetContract.v1.3", "resolveSnapshot.v1.3")))

# ---- 15. timebase, guard, degraded snapshots
fx = load("fixtures/timebase/canary-boundaries.json")
p_, q_, O_ = fx["fps"]["numerator"], fx["fps"]["denominator"], fx["start_frame_offset"]
rec("timebase", "canary_boundaries_ceil_law", all(((r["boundary_ms"] * p_ + 1000 * q_ - 1) // (1000 * q_)) == r["B"] and r["absolute_frame"] == O_ + r["B"] for r in fx["boundaries"]))
rec("timebase", "canary_total_6756", sum(b["duration_frames"] for b in fx["beats"]) == 6756)
rec("timebase", "half_up_gives_6755", (2 * 225183 * 30 + 1000) // 2000 == 6755)
g = load("fixtures/guard/guard-vectors.json")
rec("guard", "payload_equal_but_guard_differs (same payload, different project)", g["same_payload_different_project"]["payload_sha256_equal"] and not g["same_payload_different_project"]["guard_digest_equal"])
rec("guard", "UNAVAILABLE != ERROR project identity produces different guards over an identical payload", g["unavailable_vs_error_identity"]["payload_sha256_equal"] and not g["unavailable_vs_error_identity"]["guard_digest_equal"])
for sn in sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(B, "fixtures/snapshot/*.json"))):
    snap = load(f"fixtures/snapshot/{sn}.json")
    rec("guard", f"{sn} guard object validates against resolveGuard v2", not list(V["resolveGuard"].iter_errors(L.guard_object(snap))))
    rec("guard", f"{sn} digests recompute", L.snapshot_payload_digest(snap["payload"]) == snap["payload_sha256"] and L.guard_digest(snap) == snap["guard_digest"])
    go = L.guard_object(snap)
    rec("guard", f"{sn} guard carries identity observation status and reason", {"unique_id_status", "unique_id_reason", "name_status"} <= set(go["project"]) and {"unique_id_status", "unique_id_reason", "name_status"} <= set(go["timeline"]) and go["guard_version"] == 2)
m0s = load("fixtures/snapshot/m0-minimal-nothing-qualified.json")
rec("degraded-snapshot", "pre-qualification capture: every timeline/project field UNAVAILABLE with reason, no tracks, complete:false", all(m0s["payload"]["timeline"]["field_status"][k] == "UNAVAILABLE" and m0s["payload"]["timeline"][k] is None for k in L.TIMELINE_STATUS_FIELDS) and all(m0s["project"]["field_status"][k] == "UNAVAILABLE" for k in L.PROJECT_STATUS_FIELDS) and m0s["payload"]["tracks"] == [] and m0s["coverage"]["complete"] is False and set(m0s["coverage"]["observed_domains"]) == {"connection", "library"})
rec("degraded-snapshot", "pre-qualification capture classifies as INCOMPLETE_NOT_QUALIFIED and is schema-valid", L.snapshot_result_class(m0s) == "INCOMPLETE_NOT_QUALIFIED" and not list(V["resolveSnapshot"].iter_errors(m0s)))
rec("degraded-snapshot", "pre-qualification capture is canonical and hashable (no crash on all-null timeline)", L.snapshot_payload_digest(m0s["payload"]) == m0s["payload_sha256"])
pl = load("fixtures/snapshot/full-read-partial-item-ledger.json")
rec("degraded-snapshot", "partial item kept in canonical list with null end and ERROR status (not omitted, not invented)", any(it["end"] is None and it["field_status"]["end"] == "ERROR" for t in pl["payload"]["tracks"] for it in t["items"]))
rec("degraded-snapshot", "enumeration failure recorded in the ledger and forces complete:false", len(pl["payload"]["observation_failures"]) == 1 and pl["coverage"]["complete"] is False and pl["coverage"]["incomplete_reasons"])
dg = load("fixtures/snapshot/full-read-degraded-start-frame.json")
rec("degraded-snapshot", "GetStartFrame unavailable -> start_frame null, status UNAVAILABLE + reason, complete:false, reason recorded", dg["payload"]["timeline"]["start_frame"] is None and dg["payload"]["timeline"]["field_status"]["start_frame"] == "UNAVAILABLE" and dg["payload"]["timeline"]["field_status"].get("start_frame_reason") and dg["coverage"]["complete"] is False and any("start_frame" in r_ for r_ in dg["coverage"]["incomplete_reasons"]))
rec("degraded-snapshot", "degraded timeline snapshot passes the semantic layer under the matching (reduced) callable set", not L.semantic_snapshot(dg, CALL_HYP - {"GetStartFrame"}))
rec("degraded-snapshot", "degraded snapshot's guard differs from the complete snapshot's guard (coverage is in the guard)", dg["guard_digest"] != load("fixtures/snapshot/human-timeline-mixed-provenance.json")["guard_digest"])
wp = load("fixtures/snapshot/write-precheck-complete.json")
rec("degraded-snapshot", "a WRITE_PRECHECK snapshot with an UNSUPPORTED start_timecode can only be incomplete", any("unresolved timeline fields" in e for e in L.semantic_snapshot((lambda d: (d["payload"]["timeline"].update(start_timecode=None), d["payload"]["timeline"]["field_status"].update(start_timecode="UNSUPPORTED"), d.update(payload_sha256=L.snapshot_payload_digest(d["payload"])), d.update(guard_digest=L.guard_digest(d)), d)[-1])(copy.deepcopy(wp)), CALL_HYP)))

# ---- 16. exact manifest binding against the REAL manifest (never printed into the report)
man_path = os.path.join(B, "FREEZE-MANIFEST.json")
if os.path.exists(man_path):
    REAL = sha(man_path)
    ACTIVE_REAL = dict(ACTIVE, manifest_sha256=REAL)
    rec("exact-manifest", "real manifest sha differs from the fixture placeholder", REAL != ACTIVE["manifest_sha256"])
    d_ph = L.derive_attachment_state(tc, EVS["ready"], ACTIVE_REAL)
    rec("exact-manifest", "placeholder-bound fixture evidence does not derive against the real manifest (CONFLICT: not bound to active manifest)", d_ph["state"] == "CONFLICT" and any("manifest" in f for f in d_ph["failures"]))
    rec("exact-manifest", "placeholder-bound evidence makes the probe ineligible under the real manifest", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": next(k for k, v in EVS["ready"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")}}, rp, caps, tc, EVS["ready"], ACTIVE_REAL)["eligible"])
    MR = F.Mint(REAL, CAPS_SHA)
    SR, HR = F.base_sets(MR, PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "evidence re-minted against the real manifest derives ATTACHMENT_READY / ATTACHED_READ_ONLY", L.derive_attachment_state(tc, SR["ready"], ACTIVE_REAL)["state"] == "ATTACHMENT_READY" and L.derive_attachment_state(tc, SR["attached"], ACTIVE_REAL)["state"] == "ATTACHED_READ_ONLY")
    rec("exact-manifest", "probe eligible on re-minted ready evidence; SNAPSHOT_CAPTURE eligible (degraded) on re-minted attached evidence", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": HR["roj"]["record_id"]}}, rp, caps, tc, SR["ready"], ACTIVE_REAL)["eligible"] and L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE_, "expected_project_name": F.PROJ, "expected_timeline_name": F.TL, "refs": {"read_only_journal": HR["roj"]["record_id"]}}, rp, caps, tc, SR["attached"], ACTIVE_REAL)["eligible"])
    rec("exact-manifest", "re-minted evidence is structurally valid against the real manifest", not L.validate_evidence_set(SR["attached"], ACTIVE_REAL))
    MA = F.Mint("9" * 64, CAPS_SHA)
    SA, _ = F.base_sets(MA, PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "arbitrary 64-hex manifest sha is rejected (CONFLICT)", L.derive_attachment_state(tc, SA["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    M13 = F.Mint("ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc", CAPS_SHA, authority_version="1.3.0")
    S13, _ = F.base_sets(M13, PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "v1.3 manifest / authority 1.3.0 evidence is rejected as current authority (CONFLICT)", L.derive_attachment_state(tc, S13["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    hist13 = M13.bundle(historical=True)
    mixed = F.ES([HR["prov"], HR["bundle"], hist13, HR["launch"], HR["roj"]])
    dmx = L.derive_attachment_state(tc, mixed, ACTIVE_REAL)
    rec("exact-manifest", "a historical v1.3 verification alongside the real one is tolerated but never the proof", dmx["state"] == "ATTACHMENT_READY" and dmx["proofs"].get("bundle_verification") == HR["bundle"]["record_id"])
    rec("exact-manifest", "real-manifest verification for another host does not count", L.derive_attachment_state(tc, F.ES([HR["prov"], MR.bundle(env={"host_name": "PRESTO"}), HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED")
    rec("exact-manifest", "real-manifest verification claiming another authority version does not count", L.derive_attachment_state(tc, F.ES([HR["prov"], MR.bundle(authority_version="1.3.0"), HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED")
    rec("exact-manifest", "self-verified real-manifest bundle does not count", L.derive_attachment_state(tc, F.ES([HR["prov"], MR.bundle(verifier="Claude Code (Fable 5.1)"), HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED")
    # manifest itself
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.3", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.3", "FREEZE-MANIFEST.json")) == "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc")
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])
    rec("manifest", "validation tools listed as TOOL", all(any(e["path"] == p and e["authority_class"] == "TOOL" for e in man["files"]) for p in ("tools/authority_lib.py", "tools/validate_v1_4.py", "tools/build_v1_4.py", "tools/build_manifest.py", "tools/fixture_evidence.py")))

    def mutated(fn, disk=False):
        m2 = copy.deepcopy(man)
        fn(m2)
        se2 = L.semantic_manifest(m2, B if disk else None, sha if disk else None, parent, os.path.getsize)
        return bool(se2) or bool(list(V["resolveFreezeManifest"].iter_errors(m2)))
    tgt = next(e for e in man["files"] if e["path"] == "tools/authority_lib.py")
    rec("manifest-negative", "invalid status", mutated(lambda m: m["files"][0].update({"status": "FROZEN_MAYBE"})))
    rec("manifest-negative", "duplicate path", mutated(lambda m: m["files"].append(dict(m["files"][0]))))
    rec("manifest-negative", "missing hash", mutated(lambda m: m["files"][0].pop("sha256")))
    rec("manifest-negative", "malformed hash", mutated(lambda m: m["files"][0].update({"sha256": "xyz"})))
    rec("manifest-negative", "unknown authority classification", mutated(lambda m: m["files"][0].update({"authority_class": "VIBES"})))
    rec("manifest-negative", "broken parent lineage", mutated(lambda m: m["parent"].update({"head": "0" * 40})))
    rec("manifest-negative", "parent manifest sha changed", mutated(lambda m: m["parent"].update({"manifest_sha256": "0" * 64})))
    changed = next(e for e in man["files"] if e["changed_from_parent"])
    rec("manifest-negative", "changed file marked inherited", mutated(lambda m: next(e for e in m["files"] if e["path"] == changed["path"]).update({"inherited_from_parent": True})))
    rec("manifest-negative", "bytes +1", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": tgt["bytes"] + 1}), disk=True))
    rec("manifest-negative", "bytes -1", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": tgt["bytes"] - 1}), disk=True))
    rec("manifest-negative", "bytes zero", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": 0}), disk=True))
    rec("manifest-negative", "wrong size with correct sha", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": tgt["bytes"] * 2 + 7}), disk=True))
    rec("manifest-negative", "correct size with wrong sha", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"sha256": "0" * 64}), disk=True))
    rec("manifest-negative", "negative bytes", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": -1})))
    rec("manifest-negative", "bytes as string", mutated(lambda m: next(e for e in m["files"] if e["path"] == tgt["path"]).update({"bytes": str(tgt["bytes"])})))
    rec("manifest-positive", "actual bytes equal on disk for every file", all(os.path.getsize(os.path.join(B, e["path"])) == e["bytes"] for e in man["files"] if os.path.exists(os.path.join(B, e["path"]))))
else:
    rec("manifest", "present", False, "FREEZE-MANIFEST.json not built yet")

# ---- 17. determinism
rec("determinism", "vectors_rerun_identical", all(L.digest(L.normalize_snapshot_payload(x["input"]) if x["domain"].startswith("vidtoolz.resolveSnapshotPayload") else x["input"], x["domain"]) == x["sha256"] for x in vec["vectors"]))
rec("determinism", "evidence record ids recompute", all(L.record_id(r_) == k for n_, es in EVS.items() if n_ != "invalid-tampered-record" for k, r_ in es["records"].items()))
rec("determinism", "no_bytecode_cache_written", not os.path.exists(os.path.join(HERE, "__pycache__")))

passed = sum(1 for r in R if r[2])
total = len(R)
sections = {}
for sec, _, ok, _ in R:
    sections.setdefault(sec, [0, 0])
    sections[sec][0] += 1
    sections[sec][1] += ok
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.4", "", f"Result: **{passed}/{total} checks passed**. Layers: raw parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> evidence-binding (envelope + active manifest) -> attachment (derived, current, coherent) -> capability (qualification authenticity) -> snapshot (observation model + capability coupling) -> semantic (binding, membership, derived verification) -> eligibility (evaluate_eligibility) -> linked-set (validate_transaction_set). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed {SEED}, {PERMS} per subject). The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Section | Checks | Passed |", "|---|---|---|"]
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
