#!/usr/bin/env python3
"""Deterministic authority-validation suite for bundle v1.1. No Resolve access.

Checks: frozen-schema positive/negative fixtures; canonicalization vectors (byte-for-byte);
semantic-rule fixtures; fail-closed permission lookups; timebase boundary fixture; snapshot guard demo.
Exit 0 only if every check passes. Writes VALIDATION-REPORT.md next to the bundle.
"""
import glob
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

try:
    import jsonschema
except ImportError:  # pragma: no cover
    print("python jsonschema required (pip package 'jsonschema' >= 4.10)")
    sys.exit(2)

RESULTS = []


def rec(section, name, ok, detail=""):
    RESULTS.append((section, name, ok, detail))


def load(rel):
    with open(os.path.join(B, rel)) as f:
        return json.load(f)


SCHEMAS = {
    "resolveTargetContract": "schemas/resolveTargetContract.schema.json",
    "resolveTimebase": "schemas/resolveTimebase.schema.json",
    "resolveTrackPolicy": "schemas/resolveTrackPolicy.schema.json",
    "resolveCanarySourceManifest": "schemas/resolveCanarySourceManifest.schema.json",
    "resolveSnapshot": "schemas/resolveSnapshot.schema.json",
    "resolveGuard": "schemas/resolveGuard.schema.json",
    "resolvePermissions": "schemas/resolvePermissions.schema.json",
    "resolveCapabilityMatrix": "schemas/resolveCapabilityMatrix.schema.json",
}
validators = {}
for name, rel in SCHEMAS.items():
    sch = load(rel)
    try:
        jsonschema.Draft202012Validator.check_schema(sch)
        validators[name] = jsonschema.Draft202012Validator(sch)
        rec("schema-wellformed", name, True)
    except Exception as e:  # noqa: BLE001
        rec("schema-wellformed", name, False, str(e)[:200])
for rel in sorted(glob.glob(os.path.join(B, "schemas/provisional/*.schema.json"))):
    try:
        jsonschema.Draft202012Validator.check_schema(json.load(open(rel)))
        rec("schema-wellformed(provisional)", os.path.basename(rel), True)
    except Exception as e:  # noqa: BLE001
        rec("schema-wellformed(provisional)", os.path.basename(rel), False, str(e)[:200])

# frozen instances validate against their schemas
for inst, sch in (("TARGET-CONTRACT.json", "resolveTargetContract"), ("TIMEBASE.json", "resolveTimebase"), ("schemas/resolveTrackPolicy.v1.json", "resolveTrackPolicy"), ("CANARY-SOURCE-MANIFEST.json", "resolveCanarySourceManifest"), ("PERMISSIONS.json", "resolvePermissions"), ("CAPABILITIES.json", "resolveCapabilityMatrix")):
    errs = sorted(validators[sch].iter_errors(load(inst)), key=lambda e: e.path)
    rec("frozen-instance", inst, not errs, "; ".join(e.message[:120] for e in errs[:3]))

# schema fixtures
for kind in ("positive", "negative"):
    for rel in sorted(glob.glob(os.path.join(B, f"fixtures/schema/{kind}/*.json"))):
        fx = json.load(open(rel))
        v = validators.get(fx["schema"])
        if v is None:
            rec(f"fixture-{kind}", fx["fixture"], False, "unknown schema")
            continue
        errs = list(v.iter_errors(fx["document"]))
        if kind == "positive":
            rec("fixture-positive", fx["fixture"], not errs, "; ".join(e.message[:100] for e in errs[:2]))
        else:
            msgs = " | ".join(f"{e.validator}:{e.message}" for e in errs)
            hit = bool(errs) and (fx.get("expect_error_contains") is None or fx["expect_error_contains"].lower() in msgs.lower())
            rec("fixture-negative", fx["fixture"], hit, msgs[:160] if errs else "ACCEPTED (should have been rejected)")

# canonicalization vectors
vec = load("fixtures/canonicalization/vectors.json")
for x in vec["vectors"]:
    obj = x["input"]
    if x["domain"] == "vidtoolz.resolveSnapshotPayload.v1.1":
        obj = L.normalize_snapshot_payload(obj)
    c = L.canon(obj)
    ok = c == x["canonical_utf8"] and len(c.encode("utf-8")) == x["canonical_byte_length"] and L.digest(obj, x["domain"]) == x["sha256"]
    rec("canonicalization-vector", x["name"], ok)
va = next(x for x in vec["vectors"] if x["name"] == "permutation_invariance_A")
vb = next(x for x in vec["vectors"] if x["name"] == "permutation_invariance_B_same_digest")
rec("canonicalization-property", "permutation_invariance", va["sha256"] == vb["sha256"])
v2 = next(x for x in vec["vectors"] if x["name"] == "numeric_track_index_2_before_10")
rec("canonicalization-property", "numeric_index_order", v2["canonical_utf8"].find('"index":2') < v2["canonical_utf8"].find('"index":10'))
vt = next(x for x in vec["vectors"] if x["name"] == "track_type_order_video_audio_subtitle")
s = vt["canonical_utf8"]
rec("canonicalization-property", "type_order", s.find('"type":"video"') < s.find('"type":"audio"') < s.find('"type":"subtitle"'))
# typed sorting rejects string index
try:
    L.sort_tracks([{"type": "video", "index": "2"}])
    rec("canonicalization-typed", "reject_string_track_index", False)
except L.CanonError:
    rec("canonicalization-typed", "reject_string_track_index", True)
try:
    L.canon({"x": 1.5})
    rec("canonicalization-typed", "reject_bare_float", False)
except L.CanonError:
    rec("canonicalization-typed", "reject_bare_float", True)
try:
    L.digest({}, "vidtoolz.unregistered")
    rec("canonicalization-typed", "reject_unregistered_domain", False)
except L.CanonError:
    rec("canonicalization-typed", "reject_unregistered_domain", True)

# semantic fixtures
CHECKS = {"semantic_target_contract": L.semantic_target_contract, "semantic_timebase": L.semantic_timebase, "semantic_track_policy": L.semantic_track_policy, "semantic_canary_manifest": L.semantic_canary_manifest, "semantic_snapshot": L.semantic_snapshot, "semantic_verification_result": L.semantic_verification_result, "semantic_journal": L.semantic_journal}
perms = load("PERMISSIONS.json")
for rel in sorted(glob.glob(os.path.join(B, "fixtures/semantic/*.json"))):
    fx = json.load(open(rel))
    chk = fx["check"]
    try:
        if chk == "semantic_mutation_plan":
            errs = L.semantic_mutation_plan(fx["document"], perms, fx.get("guard_digest"))
        elif chk == "semantic_commit_manifest":
            errs = L.semantic_commit_manifest(fx["document"], fx["terminal_journal_state"])
        else:
            errs = CHECKS[chk](fx["document"])
    except Exception as e:  # noqa: BLE001
        errs = [f"exception: {e}"]
    ok = bool(errs) == fx["expect_errors"]
    rec("semantic-fixture", fx["fixture"], ok, "; ".join(errs[:3])[:200])

# permission lookups (fail closed)
for c in load("fixtures/permissions/lookups.json")["cases"]:
    r = L.permission_lookup(perms, c["milestone"], c["operation"], c["scope"])
    rec("permission-lookup", f"{c['milestone']}/{c['operation']}/{c['scope']}", r["allowed"] == c["expect_allowed"], r["reason"])
# no entry may grant mutation outside M3 or shared library ever
rec("permission-invariant", "no_mutation_before_M3", all(not e["mutation_allowed"] for e in perms["entries"] if e["milestone"] != "M3"))
rec("permission-invariant", "no_shared_library_grant", all(e["shared_library_allowed"] is False for e in perms["entries"]))
rec("permission-invariant", "default_deny", perms["default"] == "DENY")

# timebase fixture arithmetic
fx = load("fixtures/timebase/canary-boundaries.json")
p, q, O = fx["fps"]["numerator"], fx["fps"]["denominator"], fx["start_frame_offset"]
ok = all(((r["boundary_ms"] * p + 1000 * q - 1) // (1000 * q)) == r["B"] and r["absolute_frame"] == O + r["B"] for r in fx["boundaries"])
rec("timebase", "canary_boundaries_ceil_law", ok)
rec("timebase", "canary_total_6756", sum(b["duration_frames"] for b in fx["beats"]) == 6756 and fx["programme"]["video_frames"] == 6756)
neg = load("fixtures/timebase/negative-profiles.json")
rec("timebase", "half_up_gives_6755_not_6756", (2 * 225183 * 30 + 1000) // 2000 == 6755)
rec("timebase", "negative_profiles_present", len(neg["cases"]) >= 5)

# guard demo
g = load("fixtures/guard/same-payload-different-project.json")
rec("guard", "payload_equal_but_guard_differs", g["payload_sha256_equal"] and not g["guard_digest_equal"])
snap = load("fixtures/snapshot/human-timeline-mixed-provenance.json")
rec("guard", "guard_digest_recomputes", L.guard_digest(snap) == snap["guard_digest"])
rec("guard", "guard_object_validates", not list(validators["resolveGuard"].iter_errors(L.guard_object(snap))))

# report
passed = sum(1 for r in RESULTS if r[2])
total = len(RESULTS)
lines = ["# VALIDATION REPORT — Resolve authority bundle v1.1", "", f"Result: **{passed}/{total} checks passed**. Generated by `tools/validate_v1_1.py` (Python jsonschema Draft 2020-12; reference canonicalization `tools/authority_lib.py`). No Resolve access. Node conformance to the canonicalization vectors is M1 work and is NOT claimed here.", "", "| Section | Check | Result | Detail |", "|---|---|---|---|"]
for sec, name, ok, det in RESULTS:
    lines.append(f"| {sec} | {name} | {'PASS' if ok else 'FAIL'} | {det.replace('|', '/')} |")
lines.append("")
lines.append("SCHEMA-VALID != AUTHORIZED TO MUTATE. Passing this suite proves internal consistency of the authority documents, not Resolve runtime behaviour. Every mutation-capable schema remains PROVISIONAL_UNTIL_M3.")
with open(os.path.join(B, "VALIDATION-REPORT.md"), "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"validate_v1_1: {passed}/{total} passed")
for sec, name, ok, det in RESULTS:
    if not ok:
        print(f"  FAIL {sec} :: {name} :: {det}")
sys.exit(0 if passed == total else 1)
