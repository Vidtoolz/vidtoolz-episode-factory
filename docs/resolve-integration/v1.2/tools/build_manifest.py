#!/usr/bin/env python3
"""Build FREEZE-MANIFEST.json for bundle v1.2 with machine-readable status, authority class and lineage flags vs v1.1.
Run after validate_v1_2.py (so VALIDATION-REPORT.md is current): python3 -B tools/build_manifest.py
"""
import glob
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L  # noqa: E402

V11 = os.path.join(os.path.dirname(B), "v1.1")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


parent = L.strict_load(os.path.join(V11, "FREEZE-MANIFEST.json"))
pv = {e["path"]: e["sha256"] for e in parent["files"]}
PROVISIONAL = {"M3-MATRIX.md", "M3-PROBES.json"}
NOTES = {
    "TARGET-CONTRACT.json": ("attachment_state UNPROVISIONED; library root/uuid, launch recipe and observed database/version are required future observations", "M0-provisioning"),
    "TIMEBASE.json": ("api_mapping is provisional", "M3"),
    "CAPABILITIES.json": ("every read row is DOCUMENTED_NOT_QUALIFIED until M0 probe evidence on 21.1.0 b14; mutation rows NOT_TESTED", "M0/M3"),
    "READ-PRIMITIVES.json": ("evidence classes mirror CAPABILITIES; unqualified primitives are never called silently", "M0"),
    "PERMISSIONS.json": ("declaration only; eligibility via evaluate_eligibility", None),
    "CLIENT-VERSION-INVENTORY.md": ("PRESTO/VIDLAP2 unverified", "M10.5"),
    "CANONICALIZATION.md": ("Node conformance not yet demonstrated", "M1"),
    "SEMANTIC-VALIDATION.md": ("reference validators are not runtime-qualified", "M3"),
    "ELIGIBILITY.md": ("reference evaluator is not runtime-qualified", "M3"),
    "tools/authority_lib.py": ("reference implementation; not runtime-qualified", "M1"),
    "schemas/resolveTrackPolicy.v1.json": ("enforcement by Resolve NOT_TESTED", "M3"),
}


def authority_class(p):
    if p.startswith("schemas/"):
        return "SCHEMA"
    if p.startswith("fixtures/"):
        return "FIXTURE"
    if p.startswith("tools/"):
        return "TOOL"
    if p in ("ADJUDICATION-FREEZE-CONTRACT.md", "AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md", "CHANGELOG-v1.1.md", "FINDING-RESOLUTION-MATRIX.md"):
        return "HISTORICAL_INPUT"
    if p in ("VALIDATION-REPORT.md",):
        return "REPORT"
    return "NORMATIVE"


files = sorted(os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p) and not p.endswith("FREEZE-MANIFEST.json") and "__pycache__" not in p)
entries = []
for p in files:
    h = sha(os.path.join(B, p))
    st = "PROVISIONAL_UNTIL_M3" if (p in PROVISIONAL or p.startswith("schemas/provisional/")) else "FROZEN_NOW"
    e = {"path": p, "sha256": h, "bytes": os.path.getsize(os.path.join(B, p)), "status": st, "authority_class": authority_class(p), "inherited_from_parent": pv.get(p) == h, "changed_from_parent": (p in pv and pv[p] != h), "new_in_this_version": p not in pv}
    if p in NOTES:
        e["qualification_note"] = NOTES[p][0]
        if NOTES[p][1]:
            e["blocked_until"] = NOTES[p][1]
    if st == "PROVISIONAL_UNTIL_M3":
        e["blocked_until"] = "M3"
    entries.append(e)
ext = {"v1_1_parent_manifest": os.path.join(V11, "FREEZE-MANIFEST.json"), "v1_0_grandparent_manifest": os.path.join(os.path.dirname(B), "v1", "FREEZE-MANIFEST.json"), "doc_authority": os.path.join(os.path.dirname(os.path.dirname(B)), "DOC-AUTHORITY.md")}
exth = {k: {"path": os.path.relpath(v, B), "sha256": sha(v)} for k, v in ext.items()}
assert exth["v1_1_parent_manifest"]["sha256"] == "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5"
assert exth["v1_0_grandparent_manifest"]["sha256"] == "d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821"
m = {"schema": "vidtoolz.resolveFreezeManifest.v1.2", "bundle": "docs/resolve-integration/v1.2", "version": "1.2.0", "frozen_at": "2026-09-08", "prepared_by": "Claude Code (Fable 5.1)", "approval_status": "CANDIDATE_FOR_INDEPENDENT_REVIEW", "approver": None,
     "parent": {"version": "1.1.0", "branch": "docs/resolve-authority-freeze-v1.1", "head": "47ddb225335b8c85ca5255b1de86ff508e0e8e91", "manifest_sha256": "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5", "immutable": True, "grandparent": {"version": "1.0.0", "branch": "docs/resolve-authority-freeze-v1", "head": "e2874f6f67f5adb3a5ced0e0e138c370e38995cb", "manifest_sha256": "d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821", "baseline": "f30e4543b0af17d047f803ae9044aef859ef13bc"}},
     "status_vocabulary": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"], "status_field_law": "status is a closed vocabulary; conditions live in qualification_note/blocked_until; parsers never inspect prose",
     "rules": ["a file whose sha256 differs from this manifest is not the frozen version", "v1.0 and v1.1 bytes and manifests are never modified; v1.2 supersedes by reference", "SCHEMA-VALID != AUTHORIZED TO MUTATE; PERMISSION DECLARATION != ELIGIBILITY", "mutation-capable schemas remain PROVISIONAL_UNTIL_M3; no adapter mutation implementation exists; no Resolve write was executed; M0 has not begun", "PERMISSIONS.json is default DENY; unknown milestone/operation/scope/prerequisite is denied; shared_library_allowed is never true", "nothing in this bundle is human approval of any run, gate or publication"],
     "files": entries, "removed_from_this_version_present_in_parent": sorted(p for p in pv if p not in {e["path"] for e in entries}), "external_pins": exth,
     "counts": {"files": len(entries), "frozen_now": sum(e["status"] == "FROZEN_NOW" for e in entries), "provisional_until_m3": sum(e["status"] == "PROVISIONAL_UNTIL_M3" for e in entries), "inherited_unchanged": sum(e["inherited_from_parent"] for e in entries), "changed_from_parent": sum(e["changed_from_parent"] for e in entries), "new_in_this_version": sum(e["new_in_this_version"] for e in entries)}}
with open(os.path.join(B, "FREEZE-MANIFEST.json"), "w", encoding="utf-8") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print("counts", m["counts"])
print("removed", m["removed_from_this_version_present_in_parent"])
print("MANIFEST_SHA256", sha(os.path.join(B, "FREEZE-MANIFEST.json")))
