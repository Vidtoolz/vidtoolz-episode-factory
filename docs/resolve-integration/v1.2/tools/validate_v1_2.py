#!/usr/bin/env python3
"""Layered, deterministic authority-validation suite for bundle v1.2 (parse -> schema -> semantic -> eligibility).
Offline; no Resolve. Exit 0 only if every check passes. Writes VALIDATION-REPORT.md.
Run: python3 -B tools/validate_v1_2.py   (bytecode caching disabled inside as well)
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
    R.append((section, name, ok, str(detail)[:200]))


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def load(rel):
    return L.strict_load(os.path.join(B, rel))


# ---- parse boundary (policy A)
for name, ok_expected in (("clean.json.txt", True), ("duplicate-key.json.txt", False)):
    try:
        L.strict_loads(open(os.path.join(B, "fixtures/parse", name), encoding="utf-8").read())
        rec("parse", name, ok_expected, "parsed")
    except L.ParseError as e:
        rec("parse", name, not ok_expected, str(e))
# every authority JSON must parse strictly
for rel in sorted(glob.glob(os.path.join(B, "**/*.json"), recursive=True)):
    try:
        L.strict_load(rel)
    except Exception as e:  # noqa: BLE001
        rec("parse", os.path.relpath(rel, B), False, str(e))

# ---- schemas
SCHEMAS = {n: f"schemas/{n}.schema.json" for n in ["resolveTargetContract", "resolveTimebase", "resolveTrackPolicy", "resolveCanarySourceManifest", "resolveSnapshot", "resolveGuard", "resolvePermissions", "resolveCapabilityMatrix", "resolveReadPrimitives", "resolveFreezeManifest"]}
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

# ---- frozen instances
INSTANCES = [("TARGET-CONTRACT.json", "resolveTargetContract", L.semantic_target_contract), ("TIMEBASE.json", "resolveTimebase", L.semantic_timebase), ("schemas/resolveTrackPolicy.v1.json", "resolveTrackPolicy", L.semantic_track_policy), ("CANARY-SOURCE-MANIFEST.json", "resolveCanarySourceManifest", L.semantic_canary_manifest), ("PERMISSIONS.json", "resolvePermissions", None), ("CAPABILITIES.json", "resolveCapabilityMatrix", L.semantic_capabilities), ("READ-PRIMITIVES.json", "resolveReadPrimitives", None)]
DOCS = {}
for inst, sch, fn in INSTANCES:
    d = load(inst)
    DOCS[inst] = d
    errs = list(V[sch].iter_errors(d))
    rec("frozen-instance-schema", inst, not errs, "; ".join(e.message[:100] for e in errs[:2]))
    if fn:
        se = fn(d)
        rec("frozen-instance-semantic", inst, not se, "; ".join(se[:3]))
rec("frozen-instance-semantic", "READ-PRIMITIVES.json vs CAPABILITIES", not L.semantic_read_primitives(DOCS["READ-PRIMITIVES.json"], DOCS["CAPABILITIES.json"]), "; ".join(L.semantic_read_primitives(DOCS["READ-PRIMITIVES.json"], DOCS["CAPABILITIES.json"])[:3]))
perms = DOCS["PERMISSIONS.json"]
rp = DOCS["READ-PRIMITIVES.json"]

# ---- layered fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_snapshot": L.semantic_snapshot, "semantic_verification_result": L.semantic_verification_result, "semantic_journal": L.semantic_journal, "semantic_capabilities": L.semantic_capabilities}
for rel in sorted(glob.glob(os.path.join(B, "fixtures/layered/*.json"))):
    fx = load(rel)
    name, layer = fx["fixture"], fx["layer_expected_failure"]
    doc = fx["document"]
    v = V.get(fx["schema"]) if fx.get("schema") else None
    if v and isinstance(doc, list):
        schema_errs = [e for d_ in doc for e in v.iter_errors(d_)]
    else:
        schema_errs = list(v.iter_errors(doc)) if v else []
    schema_msgs = " | ".join(f"{e.validator}:{e.message}" for e in schema_errs)
    if layer == "schema":
        hit = bool(schema_errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in schema_msgs.lower())
        rec("fixture-schema-negative", name, hit, schema_msgs if schema_errs else "ACCEPTED (should be rejected)")
        continue
    if schema_errs:
        rec("fixture-schema-positive", name, False, "positive/semantic fixture is schema-invalid: " + schema_msgs)
        continue
    rec("fixture-schema-positive", name, True)
    chk = fx.get("check")
    if not chk:
        rec("fixture-none", name, layer == "none")
        continue
    try:
        if chk == "semantic_mutation_plan":
            errs = L.semantic_mutation_plan(doc, perms, fx.get("guard_digest"), rp)
        elif chk == "semantic_commit_manifest":
            errs = L.semantic_commit_manifest(doc, fx["journal"], fx["verification_result"], fx["guard_digest"])
        elif chk == "semantic_read_primitives":
            errs = L.semantic_read_primitives(doc, DOCS["CAPABILITIES.json"])
        else:
            errs = CHECKS[chk](doc)
    except Exception as e:  # noqa: BLE001
        errs = [f"exception: {e}"]
    joined = "; ".join(errs)
    if layer == "none":
        rec("fixture-semantic-positive", name, not errs, joined)
    elif layer in ("semantic", "eligibility"):
        hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in joined.lower())
        rec(f"fixture-{layer}-negative", name, hit, joined if errs else "ACCEPTED (should be rejected)")
    else:
        rec("fixture-layer", name, False, f"unknown layer {layer}")

# ---- canonicalization vectors + rejections
vec = load("fixtures/canonicalization/vectors.json")
for x in vec["vectors"]:
    obj = x["input"]
    if x["domain"] == "vidtoolz.resolveSnapshotPayload.v1.2":
        obj = L.normalize_snapshot_payload(obj)
    c = L.canon(obj)
    rec("canonicalization-vector", x["name"], c == x["canonical_utf8"] and len(c.encode("utf-8")) == x["canonical_byte_length"] and L.digest(obj, x["domain"]) == x["sha256"])
by = {x["name"]: x for x in vec["vectors"]}
rec("canonicalization-property", "permutation_invariance", by["permutation_invariance_A"]["sha256"] == by["permutation_invariance_B_same_digest"]["sha256"])
rec("canonicalization-property", "markers_reversed_same_digest", by["markers_total_order_A"]["sha256"] == by["markers_total_order_B_reversed_same_digest"]["sha256"])
rec("canonicalization-property", "numeric_index_order", by["numeric_track_index_2_before_10"]["canonical_utf8"].find('"index":2') < by["numeric_track_index_2_before_10"]["canonical_utf8"].find('"index":10'))
s = by["track_type_order_video_audio_subtitle"]["canonical_utf8"]
rec("canonicalization-property", "type_order", s.find('"type":"video"') < s.find('"type":"audio"') < s.find('"type":"subtitle"'))
rec("canonicalization-property", "unicode_not_normalized", by["unicode_byte_distinct_strings"]["canonical_utf8"] == '{"a":"ä","b":"ä"}')
for case in load("fixtures/canonicalization/rejections.json")["cases"]:
    try:
        if case["kind"] == "markers":
            L.sort_markers(case["input"])
        elif case["kind"] == "tracks":
            L.sort_tracks(case["input"])
        elif case["kind"] == "domain":
            L.digest(case["input"], case["domain"])
        else:
            L.canon(case["input"])
        rec("canonicalization-rejection", case["name"], False, "ACCEPTED (should be rejected)")
    except L.CanonError as e:
        rec("canonicalization-rejection", case["name"], case["expect"].lower() in str(e).lower(), str(e))

# ---- eligibility fixtures (declaration vs eligibility)
for c in load("fixtures/eligibility/cases.json")["cases"]:
    r = L.evaluate_eligibility(perms, c["request"], rp)
    rec("eligibility", c["name"], r["eligible"] == c["expect_eligible"], f"policy={r['permitted_by_policy']} failed={r['failed_prerequisites']} codes={r['reason_codes']}")
rec("eligibility-invariant", "allowed_true_is_not_eligibility", not L.evaluate_eligibility(perms, {"milestone": "M0", "operation": "SNAPSHOT_CAPTURE", "scope": perms["scopes"][0], "target": {}, "evidence": {}}, rp)["eligible"])
rec("permission-invariant", "no_mutation_before_M3", all(not e["mutation_allowed"] for e in perms["entries"] if e["milestone"] != "M3"))
rec("permission-invariant", "every_M3_mutation_requires_authorization_and_write_ready", all({"MIKKO_M3_AUTHORIZATION", "TARGET_STATE_SCRATCH_WRITE_READY"} <= set(e["prerequisites"]) for e in perms["entries"] if e["mutation_allowed"]))
rec("permission-invariant", "no_shared_library_grant", all(e["shared_library_allowed"] is False for e in perms["entries"]))
rec("permission-invariant", "default_deny", perms["default"] == "DENY")
rec("permission-invariant", "every_entry_has_prerequisites", all(e["prerequisites"] for e in perms["entries"]))

# ---- milestone matrix consistency
mx = load("MILESTONE-MATRIX.json")
for m, spec in mx["milestones"].items():
    es = [e for e in perms["entries"] if e["milestone"] == m]
    rec("milestone-matrix", f"{m} read ops match PERMISSIONS", sorted(e["operation"] for e in es if not e["mutation_allowed"]) == spec["read_operations"])
    rec("milestone-matrix", f"{m} mutation ops match PERMISSIONS", sorted(e["operation"] for e in es if e["mutation_allowed"]) == spec["mutation_operations"])
rec("milestone-matrix", "M0 has no mutation ops", mx["milestones"]["M0"]["mutation_operations"] == [])
rec("milestone-matrix", "M1 has no mutation ops", mx["milestones"]["M1"]["mutation_operations"] == [])
rec("milestone-matrix", "M2 has no mutation ops", mx["milestones"]["M2"]["mutation_operations"] == [])
rec("milestone-matrix", "M3 is the only mutation milestone", bool(mx["milestones"]["M3"]["mutation_operations"]))
rec("milestone-matrix", "EKA not a scope anywhere", all("EKA" not in sc for sc in perms["scopes"]))
probes = load("M3-PROBES.json")
m3_ops = set(mx["milestones"]["M3"]["mutation_operations"]) | set(mx["milestones"]["M3"]["read_operations"])
for p in probes["probes"]:
    rec("m3-probe-permission", p["id"], all(op in m3_ops for op in p["operations"]), ",".join(op for op in p["operations"] if op not in m3_ops))
rec("m3-probe-count", "19 probes P1..P19; P0 is M0 preflight", probes["count"] == 19 and probes["preflight_reference"]["milestone"] == "M0")
md = open(os.path.join(B, "M3-MATRIX.md"), encoding="utf-8").read()
rec("m3-probe-count", "M3-MATRIX.md rows match M3-PROBES.json ids", all(re.search(rf"^\| {p['id']} \|", md, re.M) for p in probes["probes"]))

# ---- authority precedence
prec = load("AUTHORITY-PRECEDENCE.json")
active = {e["path"] for e in prec["documents"] if e["status"] == "STILL_ACTIVE"}
retired_terms = prec["retired_terms"]
for e in prec["documents"]:
    rec("precedence", f"{e['path']} classified", e["status"] in ("STILL_ACTIVE", "SUPERSEDED", "HISTORICAL") and (e["path"] == "VALIDATION-REPORT.md" or os.path.exists(os.path.join(B, e["path"]))))
for path in sorted(active):
    if not os.path.exists(os.path.join(B, path)):
        continue
    txt = open(os.path.join(B, path), encoding="utf-8").read()
    hits = [t for t in retired_terms if t in txt and path not in prec.get("retired_term_exempt", [])]
    rec("precedence-retired-terms", path, not hits, ",".join(hits))
bundle_docs = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "*.md"))}
rec("precedence", "every top-level document has an entry", bundle_docs <= {e["path"] for e in prec["documents"]}, ",".join(sorted(bundle_docs - {e["path"] for e in prec["documents"]})))
for s_ in prec["superseded_statements"]:
    targets = [t.strip().split("#")[0] for t in s_["new_authority"].split(";")]
    rec("precedence-supersession", s_["id"], all(os.path.exists(os.path.join(B, t)) for t in targets) and s_["status"] == "SUPERSEDED", ",".join(t for t in targets if not os.path.exists(os.path.join(B, t))))

# ---- timebase fixture arithmetic
fx = load("fixtures/timebase/canary-boundaries.json")
p_, q_, O_ = fx["fps"]["numerator"], fx["fps"]["denominator"], fx["start_frame_offset"]
rec("timebase", "canary_boundaries_ceil_law", all(((r["boundary_ms"] * p_ + 1000 * q_ - 1) // (1000 * q_)) == r["B"] and r["absolute_frame"] == O_ + r["B"] for r in fx["boundaries"]))
rec("timebase", "canary_total_6756", sum(b["duration_frames"] for b in fx["beats"]) == 6756)
rec("timebase", "half_up_gives_6755", (2 * 225183 * 30 + 1000) // 2000 == 6755)

# ---- guard
g = load("fixtures/guard/same-payload-different-project.json")
rec("guard", "payload_equal_but_guard_differs", g["payload_sha256_equal"] and not g["guard_digest_equal"])
snap = load("fixtures/snapshot/human-timeline-mixed-provenance.json")
rec("guard", "guard_object_validates", not list(V["resolveGuard"].iter_errors(L.guard_object(snap))))

# ---- manifest (actual + mutated negatives)
man_path = os.path.join(B, "FREEZE-MANIFEST.json")
if os.path.exists(man_path):
    man = load("FREEZE-MANIFEST.json")
    parent = L.strict_load(os.path.join(os.path.dirname(B), "v1.1", "FREEZE-MANIFEST.json"))
    rec("manifest", "schema", not list(V["resolveFreezeManifest"].iter_errors(man)), "; ".join(e.message[:100] for e in V["resolveFreezeManifest"].iter_errors(man)))
    se = L.semantic_manifest(man, B, sha, parent)
    rec("manifest", "semantic (hashes, lineage, inheritance flags)", not se, "; ".join(se[:3]))
    listed = {e["path"] for e in man["files"]}
    on_disk = {os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p)} - {"FREEZE-MANIFEST.json", "VALIDATION-REPORT.md"}
    rec("manifest", "every file on disk is listed", on_disk <= listed, ",".join(sorted(on_disk - listed))[:200])
    rec("manifest", "no listed file missing on disk", listed <= on_disk | {"VALIDATION-REPORT.md"}, ",".join(sorted(listed - on_disk))[:200])

    def mutated(fn):
        m2 = copy.deepcopy(man)
        fn(m2)
        return bool(L.semantic_manifest(m2, None, None, parent)) or bool(list(V["resolveFreezeManifest"].iter_errors(m2)))
    rec("manifest-negative", "invalid status", mutated(lambda m: m["files"][0].update({"status": "FROZEN_MAYBE"})))
    rec("manifest-negative", "duplicate path", mutated(lambda m: m["files"].append(dict(m["files"][0]))))
    rec("manifest-negative", "missing hash", mutated(lambda m: m["files"][0].pop("sha256")))
    rec("manifest-negative", "malformed hash", mutated(lambda m: m["files"][0].update({"sha256": "xyz"})))
    rec("manifest-negative", "unknown authority classification", mutated(lambda m: m["files"][0].update({"authority_class": "VIBES"})))
    rec("manifest-negative", "broken parent lineage", mutated(lambda m: m["parent"].update({"head": "0" * 40})))
    changed = next(e for e in man["files"] if e["changed_from_parent"])
    rec("manifest-negative", "changed file marked inherited", bool(L.semantic_manifest(json.loads(json.dumps(man)) | {"files": [dict(e, inherited_from_parent=True) if e["path"] == changed["path"] else e for e in man["files"]]}, None, None, parent)))
else:
    rec("manifest", "present", False, "FREEZE-MANIFEST.json not built yet")

# ---- determinism: rerun the vector digests a second time in-process (fresh normalization) and compare
rec("determinism", "vectors_rerun_identical", all(L.digest(L.normalize_snapshot_payload(x["input"]) if x["domain"].startswith("vidtoolz.resolveSnapshotPayload") else x["input"], x["domain"]) == x["sha256"] for x in vec["vectors"]))
rec("determinism", "no_bytecode_cache_written", not os.path.exists(os.path.join(HERE, "__pycache__")))

passed = sum(1 for r in R if r[2])
total = len(R)
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.2", "", f"Result: **{passed}/{total} checks passed**. Layers: parse (strict duplicate-key rejection) -> schema (Draft 2020-12) -> semantic (reference rules) -> eligibility (evaluate_eligibility). Offline; no Resolve. Node conformance = M1. SCHEMA-VALID != AUTHORIZED TO MUTATE; passing proves internal consistency of the authority documents only.", "", "| Section | Check | Result | Detail |", "|---|---|---|---|"]
for sec, name, ok, det in R:
    lines.append(f"| {sec} | {name} | {'PASS' if ok else 'FAIL'} | {det.replace('|', '/')} |")
with open(os.path.join(B, "VALIDATION-REPORT.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"validate_v1_2: {passed}/{total} passed")
for sec, name, ok, det in R:
    if not ok:
        print(f"  FAIL {sec} :: {name} :: {det}")
sys.exit(0 if passed == total else 1)
