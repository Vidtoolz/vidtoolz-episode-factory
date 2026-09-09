#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.5.
Layers: raw parse (strict duplicate keys) -> schema (Draft 2020-12) -> evidence-binding (envelope + active manifest) -> attachment
(derived state, freshness, coherence) -> capability (DERIVED success pipeline: raw -> parse -> review -> refreeze -> active) -> snapshot
(observation model, field provenance, occurrence identity uniqueness) -> semantic (binding, membership, readback->S1, derived
verification over the protected surface) -> eligibility (evaluate_eligibility) -> linked-set / composed authorization
(validate_transaction_set / commit_eligibility). Every fixture records its expected failure layer; an exception in a check is a FAIL,
never a pass. Order-independence is proven by seeded random permutations. A bypass audit proves no exported validator can skip S0,
S1, capability provenance, delta derivation or expected-effect validation. The exact-manifest binding is proven against the REAL
FREEZE-MANIFEST.json sha when present (the report never embeds that sha, so validate -> manifest -> validate converges).
Offline; no Resolve. Exit 0 only if every check passes. Writes VALIDATION-REPORT.md.
Run: python3 -B tools/validate_v1_5.py
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


# ---- 3. frozen instances (schema + semantic) and v1.5 structural laws
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
rec("frozen-instance", "TARGET-CONTRACT carries the evidence envelope law", {"levels", "record_levels", "coherence_fields", "currency", "binding", "max_observation_age_s"} <= set(tc.get("evidence_envelope_law", {})) and tc["evidence_envelope_law"]["levels"] == L.ENVELOPE_REQUIRED)
rec("frozen-instance", "CAPABILITIES has zero QUALIFIED_READ rows in v1.5", not any(r["evidence_class"] == "QUALIFIED_READ" for r in caps["rows"]))
rec("frozen-instance", "every read row is probe_candidate", all(r.get("probe_candidate") is True for r in caps["rows"] if r["operation"].startswith("read:")))
rec("frozen-instance", "CAPABILITIES refreeze block is unreviewed and promotes nothing (no probe ids, no evidence hashes)", caps["refreeze"]["kind"] == "M0_READ_REQUALIFICATION" and caps["refreeze"]["reviewed"] is False and caps["refreeze"]["promoted_probe_ids"] == [] and caps["refreeze"]["promoted_evidence_sha256"] == [] and caps["refreeze"]["review_decision_ref"] is None)
rec("frozen-instance", "CAPABILITIES declares the machine pipeline RAW_EVIDENCE -> PARSE -> PARSED_RESULT -> REVIEW -> REFREEZE -> ACTIVE_CAPABILITY", len(caps.get("qualification_pipeline", [])) >= 7 and all(any(k in s_ for s_ in caps["qualification_pipeline"]) for k in ("RAW_EVIDENCE", "PARSE", "PARSED_RESULT", "REVIEW", "REFREEZE", "REFREEZE_RECORD", "ACTIVE_CAPABILITY")))
rec("frozen-instance", "no prior-version evidence record claims a probe result", all(x.get("result") == "UNQUALIFIED_PRIOR_VERSION" and x.get("probe_id") is None for r in caps["rows"] for x in r.get("evidence_records", [])))
probe = rp["logical_operations"]["READ_PRIMITIVE_QUALIFICATION_PROBE"]
PROBE_METHODS = sorted({p["method"] for p in probe["primitives"]})
rec("frozen-instance", "probe produces CANDIDATE_EVIDENCE only and promotes nothing", probe.get("evidence_output") == "CANDIDATE_EVIDENCE" and probe.get("promotes_capability") is False and probe.get("read_only") is True and probe.get("purpose_is_qualification") is True)
rec("frozen-instance", "probe failure taxonomy equals the reference taxonomy", {k: sorted(v) for k, v in probe.get("failure_taxonomy", {}).items()} == {k: sorted(v) for k, v in L.PROBE_FAILURE_TAXONOMY.items()})
rec("frozen-instance", "every read primitive declares receiver and expected_type", all(p.get("receiver") and p.get("expected_type") in L.EXPECTED_TYPES for spec in rp["logical_operations"].values() for p in spec["primitives"]))
snap_schema = load("schemas/resolveSnapshot.schema.json")
tl_fs = snap_schema["properties"]["payload"]["properties"]["timeline"]["properties"]["field_status"]
rec("frozen-instance", "timeline observation status model covers start/end frame, start timecode, width, height", {"start_frame", "end_frame", "start_timecode", "width", "height"} <= set(tl_fs["required"]) and set(tl_fs["required"]) == set(L.TIMELINE_STATUS_FIELDS))
rec("frozen-instance", "snapshot schema requires collection.method_provenance (field provenance model) and knows APPEND_VERIFY", "method_provenance" in snap_schema["properties"]["collection"]["required"] and "APPEND_VERIFY" in snap_schema["properties"]["coverage"]["properties"]["profile"]["enum"] and "primitive_status" not in snap_schema["properties"]["collection"]["properties"])
rec("frozen-instance", "guard schema is v3 and binds provenance_sha256", load("schemas/resolveGuard.schema.json")["properties"]["guard_version"]["const"] == 3 and "provenance_sha256" in load("schemas/resolveGuard.schema.json")["required"])
rec("frozen-instance", "journal execution law: OP_STARTED -> APPLIED | OP_FAILED; READBACK_S1 after APPLIED", "APPLIED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "OP_FAILED" in L.JOURNAL_TRANSITIONS["OP_STARTED"] and "READBACK_S1" in L.JOURNAL_TRANSITIONS["APPLIED"] and "APPLIED" not in L.JOURNAL_TRANSITIONS["PREFLIGHT_OK"])
for nm, sch, keys in (("plan", "provisional/resolveMutationPlan", {"session_id"}), ("journal", "provisional/resolveTransactionJournal", {"session_id", "readback_snapshot_sha256", "readback_guard_digest"}), ("verification", "provisional/resolveVerificationResult", {"session_id"}), ("commit", "provisional/resolveCommitManifest", {"session_id", "s1_snapshot_sha256", "s1_guard_digest"})):
    rec("frozen-instance", f"{nm} schema requires the v1.5 linked-identity fields {sorted(keys)}", keys <= set(load(f"schemas/{sch}.schema.json")["required"]))

# ---- 4. active authority
ACT = load("fixtures/evidence/ACTIVE-AUTHORITY-PLACEHOLDER.json")
CAPS_SHA = sha(os.path.join(B, "CAPABILITIES.json"))
HYP_SHA = sha(os.path.join(B, HYP_PATH))
rec("active-authority", "fixture placeholder is a well-formed sha256 and is not any real manifest", L.is_sha(ACT["placeholder_manifest_sha256"]) and ACT["placeholder_manifest_sha256"] == hashlib.sha256(b"VIDTOOLZ-FIXTURE-MANIFEST-PLACEHOLDER-v1.5").hexdigest())
rec("active-authority", "fixture capability matrix sha equals CAPABILITIES.json on disk", ACT["capability_matrix_sha256"] == CAPS_SHA)
rec("active-authority", "fixture hypothetical matrix sha equals the hypothetical file on disk", ACT["hypothetical_capability_matrix_sha256"] == HYP_SHA)
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
se, exc = safe(L.semantic_capabilities, hyp)
rec("active-authority", "hypothetical refrozen matrix is internally consistent (reviewed refreeze block promoting exact probe ids + raw hashes)", not se and not exc, "; ".join(se[:2]))
rec("active-authority", "hypothetical refreeze names every promoted raw evidence hash", set(hyp["refreeze"]["promoted_evidence_sha256"]) == {x["raw_evidence_sha256"] for r in hyp["rows"] if r["evidence_class"] == "QUALIFIED_READ" for x in r["evidence_records"]})

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
    "attached-candidate-evidence-unreviewed": ARO, "attached-evidence-failed-getters": ARO, "attached-evidence-wrong-build": ARO, "attached-evidence-old-refreeze": ARO, "attached-evidence-old-authority": ARO, "attached-evidence-no-raw": ARO, "attached-evidence-raw-tampered": ARO, "attached-evidence-wrong-receiver": ARO, "attached-reviewed-evidence": ARO, "attached-reviewed-evidence-minus-getstartframe": ARO,
    "attached-evidence-parse-failed-accepted": ARO, "attached-evidence-getter-exception-accepted": ARO, "attached-evidence-label-success-parse-failed": ARO, "attached-evidence-wrong-observed-type": ARO, "attached-evidence-review-other-raw": ARO, "attached-evidence-promoted-other-raw": ARO, "attached-evidence-null-result": ARO,
    "write-ready-without-authorization": ARO, "write-ready-authorization-old-authority": ARO, "write-ready-refreeze-unreviewed": ARO, "write-ready-refreeze-other-matrix": ARO, "write-ready-base": "SCRATCH_WRITE_READY",
    "write-ready-hyp": ARO, "write-ready-full": ARO, "write-ready-stale-guard-current": ARO, "write-ready-plan-validation-fail": ARO,
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
rec("attachment-derived", "same evidence reversed gives an identical derivation", L.canon(DERIVED["attached"]) == L.canon(DERIVED["attached-reversed-order"]))
rec("attachment-derived", "historical BUNDLE_VERIFICATION never serves as current authority", DERIVED["ready-bundle-historical-only"]["state"] == "PROVISIONED_NOT_VERIFIED" and "bundle_verification" not in DERIVED["ready-bundle-historical-only"]["proofs"])
rec("attachment-derived", "CONFLICT ranks below every ladder state", L.STATE_RANK[L.CONFLICT_STATE] < min(L.STATE_RANK[s] for s in L.ATTACHMENT_STATES))

# ---- 6. capability pipeline: DERIVED success (F1), exact upstream digests (F2)
CAPREC_NEG = {"attached-evidence-wrong-observed-type": "observed type different", "attached-evidence-label-success-parse-failed": "contradicts derived classification", "attached-evidence-parse-failed-accepted": "never be ACCEPTed", "attached-evidence-getter-exception-accepted": "never be ACCEPTed", "attached-evidence-review-other-raw": "reference its own raw", "attached-evidence-promoted-other-raw": "another raw evidence hash"}
rp_entries = {p["method"]: p for spec in rp["logical_operations"].values() for p in spec["primitives"]}
for n_ in sorted(EVS):
    recs = [r_ for r_ in EVS[n_]["records"].values() if r_.get("record_type") == "CAPABILITY_EVIDENCE"]
    if not recs:
        continue
    errs = [e for r_ in recs for e in L.semantic_capability_record(r_, rp_entries.get(r_["method"]))]
    if n_ in CAPREC_NEG:
        rec("capability-record-negative", n_, bool(errs) and any(CAPREC_NEG[n_] in e for e in errs), "; ".join(errs[:2]) or "ACCEPTED (should be rejected)")
    else:
        rec("capability-record", n_, not errs, "; ".join(errs[:2]))
good = next(r_ for r_ in EVS["attached-reviewed-evidence"]["records"].values() if r_.get("record_type") == "CAPABILITY_EVIDENCE" and r_["method"] == "GetVersionString")
rp_connect = rp_entries["GetVersionString"]
for nm, mut, exp in (("SUCCESS label with a failure code", lambda r: r["result"].update(code="GETTER_RAISED"), "code:null"), ("failed observation ACCEPTed", lambda r: (r["parse"].update(getter_exception="RuntimeError"), r["result"].update(classification="CAPABILITY_FAILURE", success=False, code="GETTER_RAISED")), "never be ACCEPTed"), ("unreviewed candidate with a decision", lambda r: r["qualification"].update(reviewed=False), "unreviewed candidate"), ("ACCEPT without promotion", lambda r: r["qualification"].update(promoted_by=None), "promoted_by"), ("unknown classification", lambda r: r["result"].update(classification="FAILED: getter crashed"), "unknown classification"), ("SUCCESS label over a parse failure", lambda r: r["parse"].update(succeeded=False, error="ParseError"), "contradicts derived"), ("SUCCESS label over a getter exception", lambda r: r["parse"].update(getter_exception="Timeout"), "contradicts derived"), ("SUCCESS label over a null result", lambda r: r["parsed_observation"].update(non_null=False), "contradicts derived"), ("parse block missing", lambda r: r.pop("parse"), "parse block missing"), ("review references another raw hash", lambda r: r["qualification"].update(review_raw_evidence_sha256="2" * 64), "reference its own raw")):
    r2 = copy.deepcopy(good); mut(r2)
    e_ = L.semantic_capability_record(r2, rp_connect)
    rec("capability-record-negative", nm, bool(e_) and any(exp in x for x in e_), "; ".join(e_[:2]) or "ACCEPTED (should be rejected)")
env = L._contract_env(tc)
es_rev = EVS["attached-reviewed-evidence"]
rec("capability", "canonical success predicate accepts the honest record (raw + parse + type + shape + label agree)", L.capability_success(good, rp_connect, es_rev)[0])
rec("capability", "reviewed, promoted, raw-backed derived-SUCCESS record qualifies under the hypothetical active matrix", L.capability_record_qualifies(good, rp_connect, env, ACTIVE_HYP, es_rev)[0])
for nm, mut, act, es_ in (
    ("parser failure + ACCEPT review", lambda r: r["parse"].update(succeeded=False, error="ParseError"), ACTIVE_HYP, es_rev),
    ("getter exception + ACCEPT review", lambda r: r["parse"].update(getter_exception="RuntimeError: getter crashed"), ACTIVE_HYP, es_rev),
    ("failed parsed result + current refreeze (label says SUCCESS)", lambda r: r["parse"].update(shape_ok=False), ACTIVE_HYP, es_rev),
    ("success label but raw/parsed facts indicate failure (non_null false)", lambda r: r["parsed_observation"].update(non_null=False), ACTIVE_HYP, es_rev),
    ("missing raw evidence", lambda r: None, ACTIVE_HYP, EVS["attached-evidence-no-raw"]),
    ("raw evidence tampered (hash mismatch)", lambda r: None, ACTIVE_HYP, EVS["attached-evidence-raw-tampered"]),
    ("raw evidence from another session", lambda r: r["envelope"].update(session_id=F.S_OLD), ACTIVE_HYP, es_rev),
    ("parsed output wrong type", lambda r: r["parse"].update(observed_type="object"), ACTIVE_HYP, es_rev),
    ("review references a different raw hash", lambda r: r["qualification"].update(review_raw_evidence_sha256="2" * 64), ACTIVE_HYP, es_rev),
    ("refreeze/promotion names a different raw hash", lambda r: r["qualification"]["promoted_by"].update(raw_evidence_sha256="2" * 64), ACTIVE_HYP, es_rev),
    ("wrong build", lambda r: r["envelope"].update(build=7), ACTIVE_HYP, es_rev), ("wrong version", lambda r: r["envelope"].update(resolve_version="21.0.3.0007"), ACTIVE_HYP, es_rev), ("wrong host", lambda r: r["envelope"].update(host_name="PRESTO"), ACTIVE_HYP, es_rev),
    ("wrong receiver/object class", lambda r: r.update(receiver_type="Fusion"), ACTIVE_HYP, es_rev),
    ("candidate not reviewed", lambda r: r["qualification"].update(reviewed=False, decision=None, promoted_by=None, review_raw_evidence_sha256=None), ACTIVE_HYP, es_rev), ("reviewed but REJECTed", lambda r: r["qualification"].update(decision="REJECT", promoted_by=None), ACTIVE_HYP, es_rev),
    ("promoted by an old refreeze (other matrix sha)", lambda r: r["qualification"]["promoted_by"].update(capability_matrix_sha256="0" * 64), ACTIVE_HYP, es_rev), ("promoted under another authority version", lambda r: r["qualification"]["promoted_by"].update(authority_version="1.4.0"), ACTIVE_HYP, es_rev), ("active refreeze differs from the promoting matrix", lambda r: None, ACTIVE, es_rev),
):
    r2 = copy.deepcopy(good); mut(r2)
    ok, why = L.capability_record_qualifies(r2, rp_connect, env, act, es_)
    rec("capability-qualification-negative", nm, not ok, "; ".join(why[:2]) if not ok else "QUALIFIED (should be rejected)")
es_adj = {"schema": es_rev["schema"], "current_session_id": es_rev["current_session_id"], "evaluated_at": es_rev["evaluated_at"], "records": {k: v for k, v in es_rev["records"].items() if not (v.get("record_type") == "CAPABILITY_EVIDENCE" and v["method"] == "GetVersionString")}}
rec("capability-qualification-negative", "adjacent getter evidence (a review of evidence A cannot promote evidence B)", L.primitive_status(hyp, rp_connect, "GetVersionString", es_adj, env, ACTIVE_HYP) == "UNQUALIFIED")
hyp_no_raw = copy.deepcopy(hyp); hyp_no_raw["refreeze"]["promoted_evidence_sha256"] = []
rec("capability-qualification-negative", "active refreeze that does not explicitly promote this raw evidence", L.primitive_status(hyp_no_raw, rp_connect, "GetVersionString", es_rev, env, ACTIVE_HYP) == "UNQUALIFIED")
hyp_unrev = copy.deepcopy(hyp); hyp_unrev["refreeze"]["reviewed"] = False
rec("capability-qualification-negative", "unreviewed refreeze block cannot qualify", L.primitive_status(hyp_unrev, rp_connect, "GetVersionString", es_rev, env, ACTIVE_HYP) == "UNQUALIFIED")
rec("capability", "frozen matrix + reviewed evidence -> UNQUALIFIED (candidate evidence never qualifies without a refrozen matrix)", L.primitive_status(caps, rp_connect, "GetVersionString", es_rev, env, ACTIVE) == "UNQUALIFIED")
rec("capability", "hypothetical refrozen matrix + reviewed linked evidence -> QUALIFIED_CALLABLE", L.primitive_status(hyp, rp_connect, "GetVersionString", es_rev, env, ACTIVE_HYP) == "QUALIFIED_CALLABLE")
for nm, set_ in (("unreviewed candidates", "attached-candidate-evidence-unreviewed"), ("failed getters", "attached-evidence-failed-getters"), ("wrong build", "attached-evidence-wrong-build"), ("old refreeze", "attached-evidence-old-refreeze"), ("parse failed + ACCEPT", "attached-evidence-parse-failed-accepted"), ("getter exception + ACCEPT", "attached-evidence-getter-exception-accepted"), ("label SUCCESS over parse failure", "attached-evidence-label-success-parse-failed"), ("wrong observed type", "attached-evidence-wrong-observed-type"), ("review references other raw", "attached-evidence-review-other-raw"), ("promotion names other raw", "attached-evidence-promoted-other-raw"), ("null result", "attached-evidence-null-result")):
    rec("capability", f"hypothetical matrix + {nm} -> UNQUALIFIED", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS[set_], env, ACTIVE_HYP) == "UNQUALIFIED")
rec("capability", "classification is derived from parse facts (getter exception -> CAPABILITY_FAILURE regardless of label)", L.classify_capability_record(dict(good, parse=dict(good["parse"], getter_exception="X"))) == "CAPABILITY_FAILURE" and L.classify_capability_record(good) == "SUCCESS")
rp_probe_entry = next(p for p in probe["primitives"] if p["method"] == "GetCurrentDatabase")
rec("capability", "probe entry on a probe_candidate row -> PROBE_ALLOWED under the frozen matrix", L.primitive_status(caps, rp_probe_entry, "GetCurrentDatabase", EVS["ready"], env, ACTIVE) == "PROBE_ALLOWED")
rec("capability", "unknown method -> UNKNOWN_METHOD", L.primitive_status(caps, None, "FrobnicateEverything", EVS["ready"], env, ACTIVE) == "UNKNOWN_METHOD")
CALL_FROZEN = L.callable_method_set(caps, rp, EVS["attached"], tc, ACTIVE)
CALL_HYP = L.callable_method_set(hyp, rp, es_rev, tc, ACTIVE_HYP)
rec("zero-qualified-reads", "nothing is callable under the frozen v1.5 matrix", CALL_FROZEN == set())
rec("zero-qualified-reads", "hypothetical refreeze makes every read primitive callable (positive path exists)", CALL_HYP == set(PROBE_METHODS))
rec("zero-qualified-reads", "GetStartFrame alone drops out when its evidence is absent", L.callable_method_set(hyp, rp, EVS["attached-reviewed-evidence-minus-getstartframe"], tc, ACTIVE_HYP) == CALL_HYP - {"GetStartFrame"})

# ---- 7. layered fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_capabilities": L.semantic_capabilities}
layer_counts = {}
LAYERED = {}


def ctx_from(fx):
    if not fx.get("capabilities") or not fx.get("evidence_set"):
        return None
    return ctx_for(fx["capabilities"], fx["evidence_set"])


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
rec("bypass-audit", "commit_eligibility composes validate_transaction_set (source-level)", "validate_transaction_set(" in inspect.getsource(L.commit_eligibility))
rec("bypass-audit", "semantic_commit_manifest refuses hash-only / missing S0 / missing S1 / missing journal / missing active", all(bool(L.semantic_commit_manifest(cmf, planf, journalf, vrf, [], *args)) for args in ((None, s1f, ACTIVE_HYP), (s0f, None, ACTIVE_HYP), (s0f, s1f, None))) and bool(L.semantic_commit_manifest(cmf, planf, [], vrf, [], s0f, s1f, ACTIVE_HYP)) and bool(L.semantic_commit_manifest(cmf, planf, journalf, None, [], s0f, s1f, ACTIVE_HYP)))
rec("bypass-audit", "semantic_verification_result refuses missing plan / S0 / S1 / journal", all(bool(L.semantic_verification_result(vrf, *args)) for args in ((None, s0f, s1f, journalf), (planf, None, s1f, journalf), (planf, s0f, None, journalf), (planf, s0f, s1f, None))))
rec("bypass-audit", "validate_transaction_set refuses a set without S0", bool(L.validate_transaction_set(dict(TS_OK, s0_snapshot=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)))
rec("bypass-audit", "validate_transaction_set refuses a commit without linked S1 and verification", any("INELIGIBLE without linked S1" in e for e in L.validate_transaction_set(dict(TS_OK, s1_snapshot=None, verification=None), perms, rp, hyp, tc, ES_FULL, ACTIVE_HYP)))
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
rec("eligibility-invariant", "capabilities argument is consumed (hypothetical matrix flips CONNECT; frozen matrix does not)", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE_HYP)["eligible"] and not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, caps, tc, es_rev, ACTIVE)["eligible"])
rec("eligibility-invariant", "active authority argument is consumed", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": ROJ_REF}}, rp, hyp, tc, es_rev, ACTIVE)["eligible"])
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

# ---- 17. Codex v1.4 confirmed attacks must fail at the intended layer
ATTACKS = [
    ("F1 parsed capability failure qualifies under a reviewed/refrozen matrix", [("capability-qualification-negative", "parser failure + ACCEPT review"), ("capability-qualification-negative", "getter exception + ACCEPT review"), ("capability-qualification-negative", "failed parsed result + current refreeze (label says SUCCESS)"), ("capability-qualification-negative", "success label but raw/parsed facts indicate failure (non_null false)"), ("capability-qualification-negative", "missing raw evidence"), ("capability-qualification-negative", "parsed output wrong type"), ("capability-qualification-negative", "review references a different raw hash"), ("eligibility", "m0-connect-deny-hyp-parse-failed-accepted"), ("eligibility", "m0-connect-deny-hyp-getter-exception-accepted"), ("eligibility", "m0-connect-deny-hyp-label-success-parse-failed"), ("eligibility", "m0-connect-deny-hyp-wrong-observed-type"), ("eligibility", "m0-connect-deny-hyp-review-references-other-raw"), ("capability-record-negative", "attached-evidence-label-success-parse-failed"), ("fixture-snapshot-negative", "snapshot-provenance-cites-failed-evidence")]),
    ("F2 duplicate occurrence ids make verification order-dependent / false VERIFIED", [("occurrence-uniqueness", "duplicate rejection is identical in reversed input order"), ("occurrence-uniqueness", "derive_delta refuses duplicates (None) and verification is UNOBSERVABLE_STATE, never first/last pick"), ("fixture-snapshot-negative", "snapshot-duplicate-occurrence-identity"), ("fixture-snapshot-negative", "snapshot-duplicate-occurrence-identity-reversed-order"), ("fixture-semantic-negative", "verification-duplicate-identity-claims-verified"), ("fixture-semantic-negative", "verification-duplicate-identity-reversed-claims-verified"), ("linked-set-negative", "linked-set-duplicate-occurrence-identity"), ("linked-set-negative", "linked-set-duplicate-occurrence-identity-reversed")]),
    ("F3 unrelated source-bound and timeline metadata changes escape delta detection", [("delta-surface", "source bound change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("delta-surface", "timeline width change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("delta-surface", "timeline start change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("delta-surface", "track topology change: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("delta-surface", "unrelated marker: derived delta records it and verification is UNEXPECTED_DELTA (unrelated), never VERIFIED"), ("fixture-semantic-negative", "verification-hides-unrelated-source-bound-change"), ("fixture-semantic-negative", "verification-hides-unrelated-timeline-dimension-change"), ("linked-set-negative", "linked-set-source-bound-unrelated-change"), ("linked-set-negative", "linked-set-timeline-dimension-unrelated-change"), ("linked-set-negative", "linked-set-track-topology-unrelated-change"), ("linked-set-negative", "linked-set-marker-unrelated-change")]),
    ("F4 BLOCKER direct commit validation accepts false VERIFIED without S0/S1", [("bypass-audit", "semantic_commit_manifest refuses hash-only / missing S0 / missing S1 / missing journal / missing active"), ("bypass-audit", "commit_eligibility rejects a false VERIFIED object even when its digest is what the commit cites"), ("bypass-audit", "a syntactically valid verification hash alone never makes a commit eligible"), ("fixture-semantic-negative", "commit-without-s0-object"), ("fixture-semantic-negative", "commit-without-s1-object"), ("fixture-semantic-negative", "commit-direct-false-verified-consistent-hashes"), ("linked-set-negative", "linked-set-direct-false-verified-consistent-hashes"), ("linked-set-negative", "linked-set-commit-without-s1")]),
    ("F5 journal readback/session not bound to supplied S1", [("journal-s1-binding", "journal validated against a different S1 fails (journal points to S1 A, validator receives S1 B)"), ("fixture-semantic-negative", "journal-readback-names-other-s1"), ("fixture-semantic-negative", "verification-journal-readback-names-other-s1"), ("fixture-semantic-negative", "journal-duplicate-readback-events"), ("fixture-semantic-negative", "verification-without-readback-event"), ("fixture-semantic-negative", "journal-s1-from-other-session"), ("fixture-semantic-negative", "verification-s1-from-other-session"), ("linked-set-negative", "linked-set-journal-names-other-s1"), ("linked-set-negative", "linked-set-s1-from-other-session"), ("linked-set-negative", "linked-set-missing-readback-event-with-verification")]),
    ("F6 composed validation omits capability-to-snapshot enforcement", [("bypass-audit", "callable set and provenance context are derived inside validate_transaction_set (no caller-supplied callable set)"), ("fixture-snapshot-negative", "snapshot-observed-without-provenance-entry"), ("fixture-snapshot-negative", "snapshot-observed-backed-by-candidate-observation"), ("fixture-snapshot-negative", "snapshot-provenance-cites-unreviewed-evidence"), ("fixture-snapshot-negative", "snapshot-provenance-cites-adjacent-getter"), ("fixture-snapshot-negative", "snapshot-provenance-matrix-not-active"), ("linked-set-negative", "linked-set-s0-observed-fields-not-callable"), ("linked-set-negative", "linked-set-s0-observed-fields-without-provenance")]),
    ("F7 weaker S1 coverage profile bypasses write-readback completeness", [("s1-profile-law", "WRITE_PRECHECK satisfies APPEND_VERIFY; FULL_TIMELINE_READ and MINIMAL_M0 do not"), ("linked-set-negative", "linked-set-s1-weaker-profile"), ("linked-set-negative", "linked-set-s1-incomplete"), ("linked-set-negative", "linked-set-s1-minimal-m0-profile"), ("linked-set-negative", "linked-set-combined-weak-s1-other-session-hidden-change")]),
    ("combinations", [("linked-set-negative", "linked-set-combined-weak-s1-other-session-hidden-change"), ("linked-set-negative", "linked-set-combined-duplicate-identity-other-session")]),
]
for attack, refs in ATTACKS:
    res = [(s, n, result_of(s, n)) for s, n in refs]
    rec("v1.4-attack", attack, all(x[2] is True for x in res), "; ".join(f"{s}/{n}={'PASS' if ok else ('MISSING' if ok is None else 'FAIL')}" for s, n, ok in res if ok is not True))

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
rec("precedence", "v1.4 changelog and finding matrix are HISTORICAL; v1.5 ones are active", st_.get("CHANGELOG-v1.4.md") == "HISTORICAL" and st_.get("FINDING-RESOLUTION-MATRIX-v1.4.md") == "HISTORICAL" and st_.get("CHANGELOG-v1.5.md") == "STILL_ACTIVE" and st_.get("FINDING-RESOLUTION-MATRIX-v1.5.md") == "STILL_ACTIVE")
scx = open(os.path.join(B, "SCORECRAFT-EXTRACTION.md"), encoding="utf-8").read()
rec("precedence", "SCORECRAFT-EXTRACTION.md cites v1.5 active schemas, not v1.1/v1.4", "resolveTargetContract.v1.5" in scx and "resolveSnapshot.v1.5" in scx and not any(x in scx for x in ("resolveTargetContract.v1.1", "resolveSnapshot.v1.1", "resolveTargetContract.v1.4", "resolveSnapshot.v1.4")))

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
rec("probe-vs-qualified", "probe output (unreviewed candidates) cannot qualify a primitive nor back OBSERVED fields, even under the hypothetical matrix", L.primitive_status(hyp, rp_connect, "GetVersionString", EVS["attached-candidate-evidence-unreviewed"], env, ACTIVE_HYP) == "UNQUALIFIED" and result_of("fixture-snapshot-negative", "snapshot-provenance-cites-unreviewed-evidence") is True)

# ---- 20. exact manifest binding against the REAL manifest (never printed into the report)
man_path = os.path.join(B, "FREEZE-MANIFEST.json")
if os.path.exists(man_path):
    REAL = sha(man_path)
    ACTIVE_REAL = dict(ACTIVE, manifest_sha256=REAL)
    rec("exact-manifest", "real manifest sha differs from the fixture placeholder", REAL != ACTIVE["manifest_sha256"])
    d_ph = L.derive_attachment_state(tc, EVS["ready"], ACTIVE_REAL)
    rec("exact-manifest", "placeholder-bound fixture evidence does not derive against the real manifest (CONFLICT)", d_ph["state"] == "CONFLICT" and any("manifest" in f for f in d_ph["failures"]))
    MR = F.Mint(REAL, CAPS_SHA)
    SR, HR = F.base_sets(MR, PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "evidence re-minted against the real manifest derives ATTACHMENT_READY / ATTACHED_READ_ONLY", L.derive_attachment_state(tc, SR["ready"], ACTIVE_REAL)["state"] == "ATTACHMENT_READY" and L.derive_attachment_state(tc, SR["attached"], ACTIVE_REAL)["state"] == "ATTACHED_READ_ONLY")
    rec("exact-manifest", "probe eligible on re-minted ready evidence", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": HR["roj"]["record_id"]}}, rp, caps, tc, SR["ready"], ACTIVE_REAL)["eligible"])
    rec("exact-manifest", "re-minted evidence is structurally valid against the real manifest", not L.validate_evidence_set(SR["attached"], ACTIVE_REAL))
    SA, _ = F.base_sets(F.Mint("9" * 64, CAPS_SHA), PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "arbitrary 64-hex manifest sha is rejected (CONFLICT)", L.derive_attachment_state(tc, SA["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    S14, _ = F.base_sets(F.Mint("34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f", CAPS_SHA, authority_version="1.4.0"), PROBE_METHODS, HYP_SHA)
    rec("exact-manifest", "v1.4 manifest / authority 1.4.0 evidence is rejected as current authority (CONFLICT)", L.derive_attachment_state(tc, S14["ready"], ACTIVE_REAL)["state"] == "CONFLICT")
    rec("exact-manifest", "real-manifest verification for another host / other version / self-verified does not count", all(L.derive_attachment_state(tc, F.ES([HR["prov"], b_, HR["launch"], HR["roj"]]), ACTIVE_REAL)["state"] == "PROVISIONED_NOT_VERIFIED" for b_ in (MR.bundle(env={"host_name": "PRESTO"}), MR.bundle(authority_version="1.4.0"), MR.bundle(verifier="Claude Code (Fable 5.1)"))))
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.4", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.4", "FREEZE-MANIFEST.json")) == "34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f")
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])
    rec("manifest", "validation tools listed as TOOL", all(any(e["path"] == p and e["authority_class"] == "TOOL" for e in man["files"]) for p in ("tools/authority_lib.py", "tools/validate_v1_5.py", "tools/build_v1_5.py", "tools/build_manifest.py", "tools/fixture_evidence.py")))

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

passed = sum(1 for r in R if r[2])
total = len(R)
sections = {}
for sec, _, ok, _ in R:
    sections.setdefault(sec, [0, 0])
    sections[sec][0] += 1
    sections[sec][1] += ok
FINDINGS = {"F1 capability success derived": ["capability", "capability-record", "capability-record-negative", "capability-qualification-negative"], "F2 occurrence uniqueness": ["occurrence-uniqueness"], "F3 delta surface / unrelated law": ["delta-surface", "unrelated-change-law", "append-effect"], "F4 commit single authority (BLOCKER)": ["bypass-audit", "commit-eligibility"], "F5 journal/S1 binding": ["journal-s1-binding"], "F6 capability -> snapshot provenance": ["probe-vs-qualified", "degraded-snapshot", "guard"], "F7 S1 coverage profile law": ["s1-profile-law"], "attack matrix": ["v1.4-attack"], "order independence": ["order-independence"]}
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.5", "", f"Result: **{passed}/{total} checks passed**. Layers: raw parse -> schema -> evidence-binding -> attachment -> capability (derived success pipeline) -> snapshot (observation model, field provenance, occurrence uniqueness) -> semantic (binding, membership, readback->S1, derived verification over the protected surface) -> eligibility -> linked-set / composed authorization (validate_transaction_set, commit_eligibility). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Order-independence: seeded permutations (seed {SEED}, {PERMS} per subject). The bypass audit proves no exported validator can skip S0, S1, capability provenance, delta derivation or expected-effect validation. The exact-manifest section binds against the real FREEZE-MANIFEST.json sha without printing it. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only. The total count is not proof: see the per-finding coverage below.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Finding | Sections | Checks | Passed |", "|---|---|---|---|"]
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
