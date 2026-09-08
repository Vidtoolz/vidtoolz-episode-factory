#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.3.
Layers: raw parse (strict duplicate keys) -> schema (Draft 2020-12) -> semantic (reference rules) -> eligibility (evidence-derived evaluator)
-> linked-set (validate_transaction_set). Every fixture records its expected failure layer; an exception in a check is a FAIL, never a pass.
Offline; no Resolve. Exit 0 only if every check passes. Writes VALIDATION-REPORT.md.
Run: python3 -B tools/validate_v1_3.py
"""
import copy
import glob
import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

try:
    import jsonschema
except ImportError:  # pragma: no cover
    print("python jsonschema >= 4.10 required")
    sys.exit(2)

R = []


def rec(section, name, ok, detail=""):
    R.append((section, name, bool(ok), str(detail)[:220]))


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


# ---- 3. frozen instances (schema + semantic)
tc = load("TARGET-CONTRACT.json"); perms = load("PERMISSIONS.json"); rp = load("READ-PRIMITIVES.json"); caps = load("CAPABILITIES.json")
INSTANCES = [("TARGET-CONTRACT.json", "resolveTargetContract", lambda d: L.semantic_target_contract(d)), ("TIMEBASE.json", "resolveTimebase", L.semantic_timebase), ("schemas/resolveTrackPolicy.v1.json", "resolveTrackPolicy", L.semantic_track_policy), ("CANARY-SOURCE-MANIFEST.json", "resolveCanarySourceManifest", L.semantic_canary_manifest), ("PERMISSIONS.json", "resolvePermissions", None), ("CAPABILITIES.json", "resolveCapabilityMatrix", L.semantic_capabilities), ("READ-PRIMITIVES.json", "resolveReadPrimitives", lambda d: L.semantic_read_primitives(d, caps, perms))]
for inst, sch, fn in INSTANCES:
    d = load(inst)
    errs = schema_errs(V[sch], d)
    rec("frozen-instance-schema", inst, not errs, msgs(errs[:2]))
    if fn:
        try:
            se = fn(d)
        except Exception as e:  # noqa: BLE001
            se = [f"exception: {e}"]
        rec("frozen-instance-semantic", inst, not se, "; ".join(se[:3]))
rec("frozen-instance", "TARGET-CONTRACT has no declared attachment_state", "attachment_state" not in tc and tc.get("attachment_state_is_declared") is False)
rec("frozen-instance", "CAPABILITIES has zero QUALIFIED_READ rows in v1.3", not any(r["evidence_class"] == "QUALIFIED_READ" for r in caps["rows"]))
rec("frozen-instance", "every read row is probe_candidate", all(r.get("probe_candidate") is True for r in caps["rows"] if r["operation"].startswith("read:")))

# ---- 4. evidence sets (schema + structural)
EVS = {}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/evidence/*.json"))):
    name = os.path.basename(rel)[:-5]
    es = load(f"fixtures/evidence/{name}.json")
    EVS[name] = es
    errs = schema_errs(V["resolveEvidenceSet"], es)
    if name == "provisioned-bad-uuid":
        rec("evidence-set-schema-negative", name, bool(errs) and "instance_uuid" in msgs(errs), msgs(errs[:1]) or "ACCEPTED (should be rejected)")
    else:
        rec("evidence-set-schema", name, not errs, msgs(errs[:2]))
    st = L.validate_evidence_set(es)
    if name.endswith("tampered-record"):
        rec("evidence-set-structural", name, bool(st) and any("content digest" in x for x in st), "; ".join(st[:2]) or "ACCEPTED (should be rejected)")
    else:
        rec("evidence-set-structural", name, not st, "; ".join(st[:2]))
# adversarial evidence: fabricated references
base_es = EVS["attached"]
rid = next(iter(base_es["records"]))
for nm, ref, exp in (("empty string", "", "not a sha256"), ("boolean-string false", "false", "not a sha256"), ("uppercase sha", rid.upper(), "not a sha256"), ("unlinked sha", "9" * 64, "not in evidence set"), ("wrong type", rid, "has type"), ("short hex", rid[:63], "not a sha256"), ("sha with newline", rid + "\n", "not a sha256")):
    r_, e_ = L.resolve_ref(base_es, ref, "M3_AUTHORIZATION")
    rec("evidence-ref-negative", nm, r_ is None and any(exp in x for x in e_), "; ".join(e_))
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"], {"host_name": "PRESTO"})
rec("evidence-ref-negative", "record for another host", r_ is None and e_)
r_, e_ = L.resolve_ref(base_es, rid, base_es["records"][rid]["record_type"])
rec("evidence-ref-positive", "linked correct-type record resolves", r_ is not None and not e_)
# derived attachment states
EXPECT_STATE = {"empty": "UNPROVISIONED", "provisioned-only": "PROVISIONED_NOT_VERIFIED", "provisioned-bad-uuid": "UNPROVISIONED", "ready": "ATTACHMENT_READY", "ready-wrong-binary-pin": "PROVISIONED_NOT_VERIFIED", "ready-self-verified-bundle": "PROVISIONED_NOT_VERIFIED", "ready-bundle-verified-for-v1.2-only": "PROVISIONED_NOT_VERIFIED", "attached": "ATTACHED_READ_ONLY", "attached-eka-observed": "ATTACHMENT_READY", "attached-local-database-observed": "ATTACHMENT_READY", "attached-version-mismatch": "ATTACHMENT_READY", "attached-wrong-host": "ATTACHMENT_READY", "write-ready-without-authorization": "ATTACHED_READ_ONLY", "write-ready-authorization-for-v1.2": "ATTACHED_READ_ONLY", "write-ready-refreeze-unreviewed": "ATTACHED_READ_ONLY", "write-ready-base": "SCRATCH_WRITE_READY", "write-ready-full": "SCRATCH_WRITE_READY"}
for name, exp in EXPECT_STATE.items():
    d = L.derive_attachment_state(tc, EVS[name])
    rec("attachment-derived", f"{name} -> {exp}", d["state"] == exp, f"got {d['state']}; failures={d['failures'][:2]}")
rec("attachment-derived", "mismatched observation reports OBSERVED_TARGET_MISMATCH", any("OBSERVED_TARGET_MISMATCH" in f for f in L.derive_attachment_state(tc, EVS["attached-eka-observed"])["failures"]))
rec("attachment-derived", "contract naming a prohibited library is UNPROVISIONED", L.derive_attachment_state(dict(tc, library=dict(tc["library"], name="EKA")), EVS["attached"])["state"] == "UNPROVISIONED")
rec("attachment-derived", "every state has required_records in TARGET-CONTRACT", set(tc["attachment_states"]) == set(L.ATTACHMENT_STATES))

# ---- 5. layered fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_snapshot": L.semantic_snapshot, "semantic_capabilities": L.semantic_capabilities}
layer_counts = {}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/layered/*.json"))):
    fx = load(rel)
    name, layer = fx["fixture"], fx["layer_expected_failure"]
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
    es = EVS.get(fx.get("evidence_set")) if fx.get("evidence_set") else None
    try:
        if chk == "semantic_mutation_plan":
            errs = L.semantic_mutation_plan(doc, perms, rp, caps, tc, es, fx.get("guard_digest"))
        elif chk == "semantic_journal":
            errs = L.semantic_journal(doc, fx.get("plan"))
        elif chk == "semantic_verification_result":
            errs = L.semantic_verification_result(doc, fx.get("plan"))
        elif chk == "semantic_conflict":
            errs = L.semantic_conflict(doc, fx.get("plan"))
        elif chk == "semantic_commit_manifest":
            errs = L.semantic_commit_manifest(doc, fx.get("plan"), fx.get("journal"), fx.get("verification_result"), fx.get("conflicts") or [], fx.get("guard_digest"))
        elif chk == "semantic_read_primitives":
            errs = L.semantic_read_primitives(doc, caps, perms)
        elif chk == "semantic_read_primitives_with_perms":
            errs = L.semantic_read_primitives(rp, caps, doc)
        else:
            errs = CHECKS[chk](doc)
        exc = False
    except Exception as e:  # noqa: BLE001
        errs, exc = [f"EXCEPTION {type(e).__name__}: {e}"], True
    joined = "; ".join(errs)
    if exc:
        rec(f"fixture-{layer}", name, False, "check raised instead of returning errors: " + joined)
    elif layer == "none":
        rec("fixture-semantic-positive", name, not errs, joined)
    elif layer in ("semantic", "eligibility"):
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec(f"fixture-{layer}-negative", name, hit, joined if errs else "ACCEPTED (should be rejected)")
    else:
        rec("fixture-layer", name, False, f"layer {layer} not valid for layered fixtures")
rec("fixture-layers", "layers present", {"none", "schema", "semantic", "eligibility"} <= set(layer_counts), str(layer_counts))

# ---- 6. linked-set fixtures
for rel in sorted(glob.glob(os.path.join(B, "fixtures/linked-set/*.json"))):
    fx = load(rel)
    es = EVS[fx["evidence_set"]]
    try:
        errs = L.validate_transaction_set(fx["set"], perms, rp, caps, tc, es, schema_validate)
        exc = False
    except Exception as e:  # noqa: BLE001
        errs, exc = [f"EXCEPTION {type(e).__name__}: {e}"], True
    joined = "; ".join(errs)
    if exc:
        rec("linked-set", fx["fixture"], False, joined)
    elif fx["layer_expected_failure"] == "none":
        rec("linked-set-positive", fx["fixture"], not errs, joined)
    else:
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec("linked-set-negative", fx["fixture"], hit, joined if errs else "ACCEPTED (should be rejected)")
ts_ok = load("fixtures/linked-set/linked-set-committed-consistent.json")["set"]
rec("linked-set", "commit checker refuses hash-only verification", bool(L.semantic_commit_manifest(ts_ok["commit"], ts_ok["plan"], ts_ok["journal"], None, [], ts_ok["guard_snapshot_digest"])))
rec("linked-set", "plan_digest law: digest of body without refs", L.plan_digest_of(ts_ok["plan"]) == ts_ok["plan"]["plan_digest"] and L.plan_digest_of(dict(ts_ok["plan"], refs={})) == ts_ok["plan"]["plan_digest"])
rec("linked-set", "plan_digest changes when an operation changes", L.plan_digest_of(dict(ts_ok["plan"], operations=[])) != ts_ok["plan"]["plan_digest"])

# ---- 7. canonicalization vectors, rejections, f64 exactness
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
rec("canon-vector", "payload domain is v1.3", all(x["domain"] == "vidtoolz.resolveSnapshotPayload.v1.3" for x in vec["vectors"] if "resolveSnapshotPayload" in x["domain"]) and any("resolveSnapshotPayload" in x["domain"] for x in vec["vectors"]))
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

# ---- 8. eligibility (evidence-derived)
CAPS_CACHE = {"CAPABILITIES.json": caps}
for c in load("fixtures/eligibility/cases.json")["cases"]:
    cp = CAPS_CACHE.setdefault(c["capabilities"], load(c["capabilities"]))
    req = c["request"]
    s_ok = not schema_errs(V["resolveEligibilityRequest"], req)
    rec("eligibility-request-schema", c["name"], s_ok == c["request_schema_valid"], "request schema-valid=" + str(s_ok))
    try:
        r = L.evaluate_eligibility(perms, req, rp, cp, tc, EVS[c["evidence_set"]])
        ok = r["eligible"] == c["expect_eligible"]
        if c.get("expect_failed_contains") and not c["expect_eligible"]:
            hay = " ".join(r["failed_prerequisites"] + r["reason_codes"])
            ok = ok and c["expect_failed_contains"] in hay
        rec("eligibility", c["name"], ok, f"eligible={r['eligible']} state={r['derived_attachment_state']} tr={r['target_requirement']} failed={r['failed_prerequisites'][:3]} codes={r['reason_codes'][:2]}")
    except Exception as e:  # noqa: BLE001
        rec("eligibility", c["name"], False, f"EXCEPTION {type(e).__name__}: {e}")
SCOPE_ = perms["scopes"][0]
rec("eligibility-invariant", "allowed_true_is_not_eligibility", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": SCOPE_, "refs": {}}, rp, caps, tc, EVS["empty"])["eligible"])
rec("eligibility-invariant", "declared attachment_state in request is ignored", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {}, "attachment_state": "SCRATCH_WRITE_READY"}, rp, caps, tc, EVS["empty"])["derived_attachment_state"] == "UNPROVISIONED")
rec("eligibility-invariant", "capabilities argument is consumed (hypothetical matrix flips CONNECT)", L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": next(k for k, v in EVS["attached"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")}}, rp, CAPS_CACHE["fixtures/eligibility/capabilities-hypothetical-refreeze.json"], tc, EVS["attached-reviewed-evidence"])["eligible"] and not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "CONNECT", "scope": SCOPE_, "refs": {"read_only_journal": next(k for k, v in EVS["attached"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")}}, rp, caps, tc, EVS["attached-reviewed-evidence"])["eligible"])
rec("eligibility-invariant", "probe expands only probe_allowed primitives (no QUALIFIED_CALLABLE needed)", all(x["status"] == "PROBE_ALLOWED" for x in L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "READ_PRIMITIVE_QUALIFICATION_PROBE", "scope": SCOPE_, "refs": {"read_only_journal": next(k for k, v in EVS["ready"]["records"].items() if v["record_type"] == "READ_ONLY_JOURNAL")}}, rp, caps, tc, EVS["ready"])["expanded_primitives"]))
rec("permission-invariant", "no_mutation_before_M3", all(not e["mutation_allowed"] for e in perms["entries"] if e["milestone"] != "M3"))
rec("permission-invariant", "every_M3_mutation_requires_authorization_and_write_ready", all({"MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY"} <= set(e["prerequisites"]) for e in perms["entries"] if e["mutation_allowed"]))
rec("permission-invariant", "no_shared_library_grant", all(e["shared_library_allowed"] is False for e in perms["entries"]))
rec("permission-invariant", "default_deny", perms["default"] == "DENY")
rec("permission-invariant", "every_entry_has_prerequisites_and_target_requirement", all(e["prerequisites"] and e.get("target_requirement") in L.TARGET_REQUIREMENTS for e in perms["entries"]))
rec("permission-invariant", "probe entry carries PROBE_ALLOWED_PRIMITIVES", all("PROBE_ALLOWED_PRIMITIVES" in e["prerequisites"] for e in perms["entries"] if e["operation"] == "READ_PRIMITIVE_QUALIFICATION_PROBE"))
rec("permission-invariant", "no non-probe entry carries PROBE_ALLOWED_PRIMITIVES", all("PROBE_ALLOWED_PRIMITIVES" not in e["prerequisites"] for e in perms["entries"] if e["operation"] != "READ_PRIMITIVE_QUALIFICATION_PROBE"))
rec("permission-invariant", "CONNECT/ENUMERATE_PROJECTS are SESSION scope; SNAPSHOT_CAPTURE is PROJECT_TIMELINE", all(e["target_requirement"] == ("SESSION" if e["operation"] in ("CONNECT", "ENUMERATE_PROJECTS", "READ_PRIMITIVE_QUALIFICATION_PROBE") else "PROJECT_TIMELINE" if e["operation"] == "SNAPSHOT_CAPTURE" else e["target_requirement"]) for e in perms["entries"]))
rec("permission-invariant", "prerequisite_codes == library set", set(perms["prerequisite_codes"]) == L.PREREQ_CODES)

# ---- 9. milestone matrix + probes
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
p15_row = next((ln for ln in md.splitlines() if ln.startswith("| P15 |")), "")
rec("m3-probe", "M3-MATRIX.md P15 row claims no rename", bool(p15_row) and "across rename" not in p15_row and "| rename;" not in p15_row and "rename claim removed" in p15_row, p15_row[:120])

# ---- 10. authority precedence
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
rec("precedence", "v1.3 supersessions present", any(s_["effective_version"] == "1.3.0" for s_ in prec["superseded_statements"]))
scx = open(os.path.join(B, "SCORECRAFT-EXTRACTION.md"), encoding="utf-8").read()
rec("precedence", "SCORECRAFT-EXTRACTION.md cites v1.3 active schemas, not v1.1", "resolveTargetContract.v1.3" in scx and "resolveSnapshot.v1.3" in scx and "resolveTargetContract.v1.1" not in scx and "resolveSnapshot.v1.1" not in scx)

# ---- 11. timebase fixture arithmetic
fx = load("fixtures/timebase/canary-boundaries.json")
p_, q_, O_ = fx["fps"]["numerator"], fx["fps"]["denominator"], fx["start_frame_offset"]
rec("timebase", "canary_boundaries_ceil_law", all(((r["boundary_ms"] * p_ + 1000 * q_ - 1) // (1000 * q_)) == r["B"] and r["absolute_frame"] == O_ + r["B"] for r in fx["boundaries"]))
rec("timebase", "canary_total_6756", sum(b["duration_frames"] for b in fx["beats"]) == 6756)
rec("timebase", "half_up_gives_6755", (2 * 225183 * 30 + 1000) // 2000 == 6755)

# ---- 12. guard
g = load("fixtures/guard/same-payload-different-project.json")
rec("guard", "payload_equal_but_guard_differs", g["payload_sha256_equal"] and not g["guard_digest_equal"])
for sn in ("human-timeline-mixed-provenance", "m0-minimal-partial-observation", "write-precheck-complete"):
    snap = load(f"fixtures/snapshot/{sn}.json")
    rec("guard", f"{sn} guard object validates", not list(V["resolveGuard"].iter_errors(L.guard_object(snap))))
    rec("guard", f"{sn} digests recompute", L.snapshot_payload_digest(snap["payload"]) == snap["payload_sha256"] and L.guard_digest(snap) == snap["guard_digest"])
m0s = load("fixtures/snapshot/m0-minimal-partial-observation.json")
rec("snapshot", "partial item kept in canonical list with null end (not omitted, not invented)", any(it["end"] is None and it["field_status"]["end"] == "UNAVAILABLE" for t in m0s["payload"]["tracks"] for it in t["items"]))
rec("snapshot", "enumeration failure recorded in ledger", len(m0s["payload"]["observation_failures"]) == 1 and m0s["coverage"]["complete"] is False and m0s["coverage"]["incomplete_reasons"])

# ---- 13. manifest (actual + negatives incl. byte counts)
man_path = os.path.join(B, "FREEZE-MANIFEST.json")
if os.path.exists(man_path):
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.2", "FREEZE-MANIFEST.json"))
    rec("manifest", "parent manifest sha pinned", sha(os.path.join(os.path.dirname(B), "v1.2", "FREEZE-MANIFEST.json")) == "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6")
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent, os.path.getsize)
    rec("manifest", "semantic (hashes, byte counts, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])

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

# ---- 14. determinism
rec("determinism", "vectors_rerun_identical", all(L.digest(L.normalize_snapshot_payload(x["input"]) if x["domain"].startswith("vidtoolz.resolveSnapshotPayload") else x["input"], x["domain"]) == x["sha256"] for x in vec["vectors"]))
rec("determinism", "evidence record ids recompute", all(L.record_id(r_) == k for n_, es in EVS.items() if n_ != "attached-tampered-record" for k, r_ in es["records"].items()))
rec("determinism", "no_bytecode_cache_written", not os.path.exists(os.path.join(HERE, "__pycache__")))

passed = sum(1 for r in R if r[2])
total = len(R)
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.3", "", f"Result: **{passed}/{total} checks passed**. Layers: raw parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> semantic (reference rules) -> eligibility (evidence-derived evaluate_eligibility) -> linked-set (validate_transaction_set). Every layered fixture records its expected failure layer; a check that raises is a FAIL. Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.", "", f"Layered fixture layers: {json.dumps(layer_counts, sort_keys=True)}", "", "| Section | Check | Result | Detail |", "|---|---|---|---|"]
for sec, name, ok, det in R:
    lines.append(f"| {sec} | {name} | {'PASS' if ok else 'FAIL'} | {det.replace('|', '/')} |")
with open(os.path.join(B, "VALIDATION-REPORT.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"{passed}/{total} passed")
for sec, name, ok, det in R:
    if not ok:
        print(f"FAIL [{sec}] {name}: {det}")
sys.exit(0 if passed == total else 1)
