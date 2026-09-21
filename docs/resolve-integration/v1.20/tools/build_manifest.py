#!/usr/bin/env python3
"""Build the v1.20 manifest with final external bytes and exact v1.19 lineage.
Run after validate_v1_19.py (so VALIDATION-REPORT.md is current): python3 -B tools/build_manifest.py
Converge: validate -> manifest -> validate -> manifest (the report never embeds the manifest sha, so two cycles are stable).
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

V116 = os.path.join(os.path.dirname(B), "v1.16")
V115 = os.path.join(os.path.dirname(B), "v1.15")
V114 = os.path.join(os.path.dirname(B), "v1.14")
V113 = os.path.join(os.path.dirname(B), "v1.13")
V112 = os.path.join(os.path.dirname(B), "v1.12")
V111 = os.path.join(os.path.dirname(B), "v1.11")
V110 = os.path.join(os.path.dirname(B), "v1.10")
V19 = os.path.join(os.path.dirname(B), "v1.9")
V18 = os.path.join(os.path.dirname(B), "v1.8")
V17 = os.path.join(os.path.dirname(B), "v1.7")
V16 = os.path.join(os.path.dirname(B), "v1.6")
V15 = os.path.join(os.path.dirname(B), "v1.5")
V14 = os.path.join(os.path.dirname(B), "v1.4")
V13 = os.path.join(os.path.dirname(B), "v1.3")
V12 = os.path.join(os.path.dirname(B), "v1.2")
V11 = os.path.join(os.path.dirname(B), "v1.1")
V10 = os.path.join(os.path.dirname(B), "v1")
PARENT_HEAD = "a03923cd4b09e8e11d40e8cf13819f8df763063a"            # inherited v1.16 lineage input; final v1.18 parent is applied below
PARENT_SEMANTIC_HEAD = "a03923cd4b09e8e11d40e8cf13819f8df763063a"   # v1.16 committed its bundle and its DOC-AUTHORITY registration together, so this IS the head
PARENT_MANIFEST = "ba77bfa2226696b61be27f2a7c74cf551720f601f57b8c11c9f2f6f50a159507"
V115_MANIFEST = "af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2"
V114_MANIFEST = "0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8"
V113_MANIFEST = "436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573"
V112_MANIFEST = "e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb"
V111_MANIFEST = "0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e"
V110_MANIFEST = "46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156"
V19_MANIFEST = "5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe"
V18_MANIFEST = "727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86"
V17_MANIFEST = "8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d"
V16_MANIFEST = "9f8a1a2e51f205409f8cb3f175144d21c59658221a42398612f982746a04ac29"
V15_MANIFEST = "a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


parent = L.strict_load(os.path.join(V116, "FREEZE-MANIFEST.json"))
pv = {e["path"]: e["sha256"] for e in parent["files"]}
PROVISIONAL = {"M3-MATRIX.md", "M3-PROBES.json"}
NOTES = {
    "TARGET-CONTRACT.json": ("attachment state is derived from an envelope-bound, current-session evidence set against the ACTIVE reviewed manifest (#derive_attachment_state_authorizing over a GovernedEvidenceSet; the bare-evidence #derive_attachment_state is DIAGNOSTIC / NON_AUTHORIZING); CONFLICT is a state; provisioning/launch/connection records are required future observations", "M0-provisioning"),
    "TIMEBASE.json": ("api_mapping is provisional", "M3"),
    "CAPABILITIES.json": ("zero QUALIFIED_READ rows; refreeze block reviewed:false with empty promotion lists; read rows DOCUMENTED_NOT_QUALIFIED + probe_candidate until a reviewed refreeze promotes exact raw-capture, derived-result and review-decision digests under the active parser and primitive spec; the ACTIVE capability authority is this object's canonical content digest; mutation rows NOT_TESTED", "M0/M3"),
    "READ-PRIMITIVES.json": ("target_requirement per operation; the full expectation spec per primitive (receiver, arg_types, nullable, expected_type, shape_rule, completeness) is DOCUMENTED_HYPOTHESIS with a pinned primitive_spec_sha256; probe_allowed only inside the probe; the failure taxonomy is derived-class based; unqualified primitives are never called silently", "M0"),
    "RAW-CAPTURE.md": ("canonical facts-only capture format and typed value codec for records that do not exist yet; real M0A captures must reconcile against it", "M0"),
    "CAPTURE-SHIM.md": ("contract for a capture driver that has not run; the reference implementation is exercised against fake in-process objects only", "M0"),
    "REFERENCE-PARSER.md": ("the derivation order and the closed class vocabulary are a reference; parser identity is the hash of the reference source", "M0"),
    "PRIMITIVE-SPEC.md": ("every expectation is DOCUMENTED_HYPOTHESIS; frozen_allowed is false until probe evidence refreezes it", "M0"),
    "REVIEW-REFREEZE.md": ("review, refreeze and promotion law for records that do not exist yet; M0C additionally requires Mikko's approval", "M0"),
    "IDENTITY-EVIDENCE.md": ("claims A/B/C are M0 observations; survival remains an M3 question", "M0/M3"),
    "EVIDENCE-ROOT.md": ("append-only layout for an M0 run that has not happened", "M0"),
    "M0-PHASES.md": ("no phase implies the next; M0A is not authorized and M0C requires Mikko's approval", "M0"),
    "M0A-PROBE-COMPATIBILITY.md": ("requirements on a driver; no driver is certified by this bundle", "M0"),
    "THREAT-MODEL.md": ("defensive controls and residual risks; the residuals are not closed", None),
    "tools/capture_shim_reference.py": ("TOOL: reference capture shim and append-only evidence root; NOT a production adapter and NOT runtime-qualified; executed only against fake in-process objects", "M0"),
    "PERMISSIONS.json": ("declaration only; eligibility via the AUTHORIZING evaluate_eligibility_authorizing over a GovernedEvidenceSet and the active authority (v1.15: the bare-evidence evaluate_eligibility is DIAGNOSTIC / NON_AUTHORIZING)", None),
    "M0-PROBE-CONTRACT.md": ("contract for a run that has not happened; produces raw captures only; promotion requires offline derivation + independent review + a Mikko-approved capability refreeze naming the successor matrix content digest", "M0"),
    "CLIENT-VERSION-INVENTORY.md": ("PRESTO/VIDLAP2 unverified", "M10.5"),
    "CANONICALIZATION.md": ("Node conformance not yet demonstrated", "M1"),
    "SEMANTIC-VALIDATION.md": ("reference validators incl. the AUTHORIZING commit_eligibility_authorizing / validate_transaction_set_authorizing, their PROVISIONAL_UNTIL_M3 non-authorizing counterparts and verify_transaction are not runtime-qualified; the APPEND expected-effect law, the APPEND_VERIFY profile, the mandatory checkpoint and the H0 early write gate are provisional", "M3"),
    "ELIGIBILITY.md": ("reference evaluator is not runtime-qualified", "M3"),
    "SNAPSHOT-COMPLETENESS.md": ("degraded capture before qualification carries connection/library only; capability->coverage coupling is a reference rule; item properties, fades, speed, takes, links and unowned media hashes are explicitly NOT represented", "M0"),
    "SNAPSHOT-CONCURRENCY-RECOVERY.md": ("STILL_ACTIVE for doctrine, guarantees, recovery and conflict codes only; its transaction state-machine and snapshot field enumerations are SUPERSEDED (AUTHORITY-PRECEDENCE S32, S33)", None),
    "tools/authority_lib.py": ("reference implementation; not runtime-qualified; AUTHORITY_SURFACE lists the authorizing entry points, everything else is INTERNAL_NON_AUTHORIZING", "M1"),
    "tools/fixture_evidence.py": ("TOOL: mints fixture evidence (raw captures through the reference shim against fake receivers, reviews, refreezes, guard records, identity observations) against the PLACEHOLDER manifest sha and re-mints against the real manifest sha inside the validator; never an authority", None),
    "schemas/resolveTrackPolicy.v1.json": ("enforcement by Resolve NOT_TESTED", "M3"),
    "schemas/resolveEvidenceSet.schema.json": ("envelope law for records that do not exist yet; real M0 captures must reconcile against it", "M0"),
    "fixtures/eligibility/capabilities-hypothetical-refreeze.json": ("HYPOTHETICAL_NOT_AUTHORITY: illustrates a future reviewed refreeze (rows QUALIFIED_READ citing raw-capture, derived-result and review-decision digests of fixture captures); never load as CAPABILITIES.json", None),
    "fixtures/evidence/ACTIVE-AUTHORITY-PLACEHOLDER.json": ("fixture evidence is minted against this PLACEHOLDER manifest sha; validate_v1_19.py proves placeholder-bound records do not derive against the real FREEZE-MANIFEST.json sha and that re-minted records do", None),
    "TRUSTED-SHIM.json": ("TRUST ROOT (v1.7, C16-B3): the ONE capture shim identity a promotable capture may carry - shim version, its own self-hash, its source path and source bytes, the allowlist digest, the codec, the raw schema and the raw-ingest version. trusted_capture_shim() re-verifies all of it against the files on disk on every resolution; no shim has run against Resolve", "M0"),
    "SCHEMA-REGISTRY.json": ("TRUST ROOT (v1.7, C16-B2): (authority_version, artifact_schema_id) -> exact schema bytes, digest and byte count. The authorizing entry points resolve schemas from here internally and take no validator parameter; one changed schema byte makes the registry untrusted", None),
    "M0A-BINDING-VALUES.json": ("the exact identities an M0A probe package must bind to under v1.7 (raw schema, codec, ingest, trusted shim and source, allowlist, reference parser, primitive spec, evidence store, schema registry, stdout/stderr retention). No placeholders; validate_v1_19.py re-derives every value. Publishing them is not authorization to run M0A", "M0"),
    "FINDING-RESOLUTION-MATRIX-v1.7.json": ("machine-readable Codex v1.6 review matrix: per finding the v1.6 defect, the v1.7 correction, a negative fixture, the expected failure layer and the validation sections that prove it", None),
    "AUTHORITY-CACHING.md": ("v1.7 caching law (C16-B1): no authority cache may be keyed on object identity; content keys only", None),
    "SCHEMA-REGISTRY.md": ("v1.7 schema-authority law (C16-B2): the authority owns the validator, the caller supplies artifacts only", None),
    "TRUSTED-SHIM.md": ("v1.7 shim-trust law (C16-B3): a capture qualifies only under the exact trusted shim identity this bundle pins", "M0"),
    "STORED-CHAIN.md": ("v1.7 chain law (C16-B4): the exact stored raw, derived, review and refreeze artifacts must resolve by digest; substitution and ambiguity are refusals", "M0"),
    "tools/evidence_store.py": ("TOOL (v1.11, F110-A..F110-D): complete BOUNDARY receipt reconciliation (four frozen constants compared outside the receipt, created_at classified INFORMATIONAL_NON_AUTHORIZING), exact BOUNDARY/INVENTORY/FINALIZATION field vocabularies with the six previously self-asserted inventory counters and paths recomputed from the independent model, marker/record bijection with exact cardinality in both directions, and boundary-first precedence on every public authority-bearing method. Original v1.10 note: (v1.10, S110-1..S110-5): persisted SESSION_BOUNDARY receipt re-checked before every authorizing operation, root identity inside session identity, inventory recomputed from independent sources, stored attempt markers reconciled as a bijection, continuous POSIX mode authority including the session directory, and one filesystem-error normalization boundary. Original v1.9 note: (v1.9, S19-1..S19-4): root trust boundary established by lstat before any resolution, canonical session identity and path law, semantic inventory reconciliation, attempt tuple binding, and POSIX file-type/permission-mode authority. Original v1.8 note: (v1.8, ES-1/ES-2): THE ONE evidence-storage authority (EVIDENCE_STORE_AUTHORIZING) - append-only, content-addressed, closed-world finalization; the legacy EvidenceRoot surface in the capture shim is REMOVED. Original v1.7 note: the executable append-only evidence store - the EVIDENCE-ROOT law as running code. Exercised only against temporary directories by the validator; no M0 evidence root exists", "M0"),
}


NOTES["evidence/sdk/DaVinciResolveScript.pyi"] = ("Pinned documentary SDK snapshot; read as text only. Not executable authority or operational qualification.", None)

# v1.20 repair (F-120-05, check 3): every top-level JSON member either validates against the schema its `schema` field names
# in SCHEMA-REGISTRY.json or carries, HERE, an explicit governed reason why it has none. validate_v1_20.py section
# registered-json enforces the dichotomy; a member with neither is a FAIL.
NO_SCHEMA = "NO_REGISTERED_SCHEMA: "
NOTES.update({
    "AUTHOR-REGRESSION-RESULTS.json": (NO_SCHEMA + "no schema field; author regression evidence generated under authority 1.19.0 and inherited byte-for-byte; registered GENERATED_EVIDENCE in AUTHORITY-PRECEDENCE.json; historical provenance, not a claim of current authority identity (F-120-07)", None),
    "V117-REPRODUCTION.json": (NO_SCHEMA + "vidtoolz.resolveAuthorReproduction.v1 is not pinned in SCHEMA-REGISTRY.json; author reproduction evidence from the v1.17 intake, inherited byte-for-byte; registered GENERATED_EVIDENCE; historical provenance, not a claim of current authority identity (F-120-07)", None),
    "AUTHORITY-DOCUMENT-UNIVERSE.json": (NO_SCHEMA + "vidtoolz.resolveDocumentUniverse.v1 is not pinned; the published universe is re-derived from the parent registration plus the explicit successor artifacts and compared row for row (release coherence PUBLISHED_UNIVERSE_PARITY, section v120-release-scanner)", None),
    "AUTHORITY-PRECEDENCE.json": (NO_SCHEMA + "vidtoolz.resolveAuthorityPrecedence.v1.6 is not pinned; statuses, roles, superseded rows and agreement with AUTHORITY-PRECEDENCE.md are asserted field by field in sections precedence and v120-release-scanner", None),
    "AUTHORITY-REFERENCE-METADATA.json": (NO_SCHEMA + "vidtoolz.resolveReferenceMetadata.v1 is not pinned; every declared reference is reconciled against an independent source walk (section v120-release-scanner)", None),
    "AUTHORITY-SLOT-INVENTORY.json": (NO_SCHEMA + "vidtoolz.resolveAuthoritySlotInventory.v3 is not pinned; generated by tools/authority_slots.py and required equal to a fresh derivation (section v120-release-scanner)", None),
    "EVIDENCE-SET-WORKFLOW.json": (NO_SCHEMA + "vidtoolz.resolveEvidenceSetWorkflowLaw.v1 is not pinned; its persistence, lifecycle, principal and TOCTOU fields are asserted individually by the workflow sections", None),
    "M3-PROBES.json": (NO_SCHEMA + "vidtoolz.resolveM3Probes.v1.10 is not pinned; PROVISIONAL_UNTIL_M3 probe list read by the milestone section; no runtime consumer", "M3"),
    "MILESTONE-MATRIX.json": (NO_SCHEMA + "vidtoolz.resolveMilestoneMatrix.v1.10 is not pinned; milestone rows are asserted by the milestone section against MILESTONES.md", None),
    "QUARANTINE-MANIFEST.json": (NO_SCHEMA + "vidtoolz.resolveQuarantineManifest.v1 is not pinned; frozen 2026-09-08 quarantine record (Mikko-authorized) inherited byte-for-byte since v1.1; historical record, no current consumer", None),
    "PHASE1-QUALIFICATION-RECORD.json": (NO_SCHEMA + "vidtoolz.resolveControlPlaneQualificationRecord.v1 is not pinned; content adjudicated by the Phase 1 freeze review and re-verified by the v1.20 independent review; its authority_version is checked by section authority-version; schema registration is a follow-up (F-120-06)", None),
    "REQUIRED-VALIDATION-CHECKS.json": (NO_SCHEMA + "vidtoolz.resolveRequiredValidationChecks.v1 is not pinned; exact check-id set parity with the executing suite is asserted by section required-check-plan", None),
})

def authority_class(p):
    if p.startswith("evidence/"):
        return "HISTORICAL_INPUT"
    if p.startswith("schemas/"):
        return "SCHEMA"
    if p.startswith("fixtures/"):
        return "FIXTURE"
    if p.startswith("tools/"):
        return "TOOL"
    if p in ("ADJUDICATION-FREEZE-CONTRACT.md", "AUTHORITY-ARCHITECTURE-ADJUDICATION-M0-M3.md", "CHANGELOG-v1.1.md", "FINDING-RESOLUTION-MATRIX.md", "CHANGELOG-v1.2.md", "FINDING-RESOLUTION-MATRIX-v1.2.md", "CHANGELOG-v1.3.md", "FINDING-RESOLUTION-MATRIX-v1.3.md", "CHANGELOG-v1.4.md", "FINDING-RESOLUTION-MATRIX-v1.4.md", "CHANGELOG-v1.5.md", "FINDING-RESOLUTION-MATRIX-v1.5.md", "CHANGELOG-v1.6.md", "FINDING-RESOLUTION-MATRIX-v1.6.md"):
        return "HISTORICAL_INPUT"
    if p in ("VALIDATION-REPORT.md",):
        return "REPORT"
    return "NORMATIVE"


files = sorted(os.path.relpath(p, B) for p in glob.glob(os.path.join(B, "**/*"), recursive=True) if os.path.isfile(p) and not p.endswith("FREEZE-MANIFEST.json") and "__pycache__" not in p)
entries = []
for p in files:
    full = os.path.join(B, p)
    h = sha(full)
    st = "PROVISIONAL_UNTIL_M3" if (p in PROVISIONAL or p.startswith("schemas/provisional/")) else "FROZEN_NOW"
    e = {"path": p, "sha256": h, "bytes": os.path.getsize(full), "status": st, "authority_class": authority_class(p), "inherited_from_parent": pv.get(p) == h, "changed_from_parent": (p in pv and pv[p] != h), "new_in_this_version": p not in pv}
    if p in NOTES:
        e["qualification_note"] = NOTES[p][0]
        if NOTES[p][1]:
            e["blocked_until"] = NOTES[p][1]
    if st == "PROVISIONAL_UNTIL_M3":
        e["blocked_until"] = "M3"
    entries.append(e)
ext = {"v1_16_parent_manifest": os.path.join(V116, "FREEZE-MANIFEST.json"), "v1_15_manifest": os.path.join(V115, "FREEZE-MANIFEST.json"), "v1_14_manifest": os.path.join(V114, "FREEZE-MANIFEST.json"), "v1_13_manifest": os.path.join(V113, "FREEZE-MANIFEST.json"), "v1_12_manifest": os.path.join(V112, "FREEZE-MANIFEST.json"), "v1_11_manifest": os.path.join(V111, "FREEZE-MANIFEST.json"), "v1_10_manifest": os.path.join(V110, "FREEZE-MANIFEST.json"), "v1_9_manifest": os.path.join(V19, "FREEZE-MANIFEST.json"), "v1_8_manifest": os.path.join(V18, "FREEZE-MANIFEST.json"), "v1_7_manifest": os.path.join(V17, "FREEZE-MANIFEST.json"), "v1_6_manifest": os.path.join(V16, "FREEZE-MANIFEST.json"), "v1_5_manifest": os.path.join(V15, "FREEZE-MANIFEST.json"), "v1_4_manifest": os.path.join(V14, "FREEZE-MANIFEST.json"), "v1_3_manifest": os.path.join(V13, "FREEZE-MANIFEST.json"), "v1_2_manifest": os.path.join(V12, "FREEZE-MANIFEST.json"), "v1_1_manifest": os.path.join(V11, "FREEZE-MANIFEST.json"), "v1_0_manifest": os.path.join(V10, "FREEZE-MANIFEST.json"), "doc_authority": os.path.join(os.path.dirname(os.path.dirname(B)), "DOC-AUTHORITY.md")}
exth = {k: {"path": os.path.relpath(v, B), "sha256": sha(v), "bytes": os.path.getsize(v)} for k, v in ext.items()}
assert exth["v1_16_parent_manifest"]["sha256"] == PARENT_MANIFEST, exth["v1_16_parent_manifest"]
assert exth["v1_15_manifest"]["sha256"] == V115_MANIFEST, exth["v1_15_manifest"]
assert exth["v1_14_manifest"]["sha256"] == V114_MANIFEST, exth["v1_14_manifest"]
assert exth["v1_13_manifest"]["sha256"] == V113_MANIFEST, exth["v1_13_manifest"]
assert exth["v1_12_manifest"]["sha256"] == V112_MANIFEST, exth["v1_12_manifest"]
assert exth["v1_11_manifest"]["sha256"] == V111_MANIFEST, exth["v1_11_manifest"]
assert exth["v1_10_manifest"]["sha256"] == V110_MANIFEST, exth["v1_10_manifest"]
assert exth["v1_9_manifest"]["sha256"] == V19_MANIFEST, exth["v1_9_manifest"]
assert exth["v1_8_manifest"]["sha256"] == V18_MANIFEST, exth["v1_8_manifest"]
assert exth["v1_7_manifest"]["sha256"] == V17_MANIFEST, exth["v1_7_manifest"]
assert exth["v1_6_manifest"]["sha256"] == V16_MANIFEST, exth["v1_6_manifest"]
assert exth["v1_5_manifest"]["sha256"] == V15_MANIFEST, exth["v1_5_manifest"]
assert exth["v1_4_manifest"]["sha256"] == "34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f"
assert exth["v1_3_manifest"]["sha256"] == "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc"
assert exth["v1_2_manifest"]["sha256"] == "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6"
assert exth["v1_1_manifest"]["sha256"] == "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5"
assert exth["v1_0_manifest"]["sha256"] == "d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821"
# v1.20 repair (F-120-02): the authority version is stated ONCE, in authority_lib.AUTHORITY_VERSION, and every statement
# of it in this manifest is derived from that constant; the bundle directory name must agree with it.
AUTHORITY_VERSION = L.AUTHORITY_VERSION
BUNDLE_DIR_NAME = "v" + ".".join(AUTHORITY_VERSION.split(".")[:2])
assert os.path.basename(B) == BUNDLE_DIR_NAME, (B, AUTHORITY_VERSION)
m = {"schema": "vidtoolz.resolveFreezeManifest.v1.10", "bundle": "docs/resolve-integration/" + BUNDLE_DIR_NAME, "version": AUTHORITY_VERSION, "frozen_at": "2026-09-20", "prepared_by": "Claude Code (Fable 5.1)", "approval_status": "CANDIDATE_FOR_INDEPENDENT_REVIEW", "approver": None,
     "parent": {"version": "1.16.0", "branch": "docs/resolve-authority-freeze-v1.16", "head": PARENT_HEAD, "semantic_head": PARENT_SEMANTIC_HEAD, "manifest_sha256": PARENT_MANIFEST, "immutable": True,
                "ancestors": [
                    {"version": "1.15.0", "branch": "docs/resolve-authority-freeze-v1.15", "head": "459bd29e358574896f0cf69f4b0bfb347bf2902d", "manifest_sha256": V115_MANIFEST},
                    {"version": "1.14.0", "branch": "docs/resolve-authority-freeze-v1.14", "head": "b61f248238ec7ed60deca79aa9728ec0cde86edd", "manifest_sha256": V114_MANIFEST},
                    {"version": "1.13.0", "branch": "docs/resolve-authority-freeze-v1.13", "head": "65895c6dedceadff012a08c1bafcdf9e92b65221", "manifest_sha256": V113_MANIFEST},
                    {"version": "1.12.0", "branch": "docs/resolve-authority-freeze-v1.12", "head": "73150d00a72820b155caf357c412f46b8ec4a9ba", "manifest_sha256": V112_MANIFEST},
                    {"version": "1.11.0", "branch": "docs/resolve-authority-freeze-v1.11", "head": "5889efa8ed12bd6626c43a657f27ea2367e54d23", "manifest_sha256": V111_MANIFEST},
                    {"version": "1.10.0", "branch": "docs/resolve-authority-freeze-v1.10", "head": "9c6643430d2dc66741afe9852668d8e6e19c0630", "manifest_sha256": V110_MANIFEST},
                    {"version": "1.9.0", "branch": "docs/resolve-authority-freeze-v1.9", "head": "863fe4fb5944935bad51a318a50b25ed748be22d", "manifest_sha256": V19_MANIFEST},
                    {"version": "1.8.0", "branch": "docs/resolve-authority-freeze-v1.8", "head": "41081f7f4f227255f44bbb3a94637928187289f0", "manifest_sha256": V18_MANIFEST},
                    {"version": "1.7.0", "branch": "docs/resolve-authority-freeze-v1.7", "head": "6a805181b14617c1b6259847b0905e21362a935c", "manifest_sha256": V17_MANIFEST},
                    {"version": "1.6.0", "branch": "docs/resolve-authority-freeze-v1.6", "head": "82976433875c8a68aff13f2d9a4071e913b8da29", "manifest_sha256": V16_MANIFEST},
                    {"version": "1.5.0", "branch": "docs/resolve-authority-freeze-v1.5", "head": "9d944e01358b4b88d6ee4c9993a4db4084ba23ad", "manifest_sha256": V15_MANIFEST},
                    {"version": "1.4.0", "branch": "docs/resolve-authority-freeze-v1.4", "head": "d2d77680047221f2dac52adce6938dd410e38b47", "manifest_sha256": "34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f"},
                    {"version": "1.3.0", "branch": "docs/resolve-authority-freeze-v1.3", "head": "1c9e090fcc8978e6e9b8f5dd538849448044d26b", "manifest_sha256": "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc"},
                    {"version": "1.2.0", "branch": "docs/resolve-authority-freeze-v1.2", "head": "c6d1284c6f395f5b21a6d14f8c2873bccfc065bb", "manifest_sha256": "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6"},
                    {"version": "1.1.0", "branch": "docs/resolve-authority-freeze-v1.1", "head": "47ddb225335b8c85ca5255b1de86ff508e0e8e91", "manifest_sha256": "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5"},
                    {"version": "1.0.0", "branch": "docs/resolve-authority-freeze-v1", "head": "e2874f6f67f5adb3a5ced0e0e138c370e38995cb", "manifest_sha256": "d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821", "baseline": "f30e4543b0af17d047f803ae9044aef859ef13bc"}]},
     "status_vocabulary": ["FROZEN_NOW", "PROVISIONAL_UNTIL_M3", "UNTESTED_BLOCKED"], "status_field_law": "status is a closed vocabulary; conditions live in qualification_note/blocked_until; parsers never inspect prose",
     "rules": ["a file whose sha256 or byte count differs from this manifest is not the frozen version", "v1.0 through v1.19 bytes and manifests are never modified; v1.20 supersedes by reference", "SCHEMA-VALID != AUTHORIZED TO MUTATE; PERMISSION DECLARATION != ELIGIBILITY; PROBE_ALLOWED != QUALIFIED_READ; A CAPTURE != EVIDENCE THAT SOMETHING WORKS; attachment state is derived from a coherent, current, envelope-bound evidence set against the ACTIVE reviewed manifest, never declared; contradictory evidence is CONFLICT", "a BUNDLE_VERIFICATION, MILESTONE_EXIT, M3_AUTHORIZATION or REFREEZE_RECORD counts only when bound to this manifest's sha256 and authority version " + AUTHORITY_VERSION + "; records for other manifests are historical", "mutation-capable schemas remain PROVISIONAL_UNTIL_M3; verification is derived from S0/S1 over the protected surface (verify_transaction) and never declared; commit_eligibility_authorizing -> validate_transaction_set_authorizing over a GovernedEvidenceSet is the ONLY authorizing commit path (v1.15 V114-B2; the bare-dict commit_eligibility/validate_transaction_set pair is PROVISIONAL_UNTIL_M3 and NON-AUTHORIZING, and every per-document helper is INTERNAL_NON_AUTHORIZING); capability meaning is DERIVED by the versioned reference parser from an immutable facts-only raw capture (never from a probe-written flag), the ACTIVE capability authority is the matrix's own content digest, a degraded H0 can never be a write precondition, and schema enforcement in the composed path is mandatory; no adapter mutation implementation exists; no Resolve write was executed; M0 has not begun",
              "v1.7 authority-integrity law: no authority cache may be keyed on Python object identity, mutable container identity or a process-local reference (content digests plus the authority version only); the authorizing entry points take NO schema-validator parameter and resolve schemas from the pinned SCHEMA-REGISTRY.json internally; a capture qualifies only under the exact trusted shim identity pinned by TRUSTED-SHIM.json, which the ACTIVE authority must also name; a promoted matrix row must resolve the EXACT stored raw capture, derived record, current review and current reviewed refreeze by digest, with multiplicity a CONFLICT unless explicit supersession leaves exactly one; identity claims validate receiver-path, handle-token and attempt-id uniqueness before any index exists; raw evidence enters only through the strict byte ingestion boundary; and the append-only evidence store is executable code the validator attacks", "v1.8 evidence-store law: there is exactly ONE evidence-storage authority (tools/evidence_store.py, EVIDENCE_STORE_AUTHORIZING); no other module may create a session, write a record, finalize or verify; no caller ever supplies a filesystem path; a FINALIZED session is a CLOSED WORLD whose inventory records every governed file and directory, and verification requires missing == 0, unexpected == 0 and changed == 0", "v1.11 evidence-store law (F110-A..F110-D): every normative BOUNDARY receipt field is independently reconciled against the frozen constant or filesystem fact it claims and created_at is explicitly INFORMATIONAL_NON_AUTHORIZING; the BOUNDARY, INVENTORY and FINALIZATION top-level field sets are EXACT, so a missing, unknown, duplicate or mistyped field is a refusal and semantic extension requires a schema version; attempt markers and authoritative records are a BIJECTION with exact cardinality in both directions, refused at the second write before any ambiguous state is persisted; and every public authority-bearing method checks the persisted boundary BEFORE any state, model or read precondition under the frozen precedence BOUNDARY > SESSION_STATE > MODEL > READ", "PERMISSIONS.json is default DENY; unknown milestone/operation/scope/prerequisite is denied; shared_library_allowed is never true; every entry declares a target_requirement", "nothing in this bundle is human approval of any run, gate or publication"],
     "files": entries, "removed_from_this_version_present_in_parent": sorted(p for p in pv if p not in {e["path"] for e in entries}), "external_pins": exth,
     "counts": {"files": len(entries), "bytes": sum(e["bytes"] for e in entries), "frozen_now": sum(e["status"] == "FROZEN_NOW" for e in entries), "provisional_until_m3": sum(e["status"] == "PROVISIONAL_UNTIL_M3" for e in entries), "inherited_unchanged": sum(e["inherited_from_parent"] for e in entries), "changed_from_parent": sum(e["changed_from_parent"] for e in entries), "new_in_this_version": sum(e["new_in_this_version"] for e in entries)}}
# v1.20 release lineage: inherited ancestors are immutable; current parent is exact v1.19 (accepted 2026-09-20).
PARENT_DIR = os.path.join(os.path.dirname(B), 'v1.19')
PARENT_MANIFEST_PATH = os.path.join(PARENT_DIR, 'FREEZE-MANIFEST.json')
V119_MANIFEST = '06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848'   # accepted v1.19 manifest digest
V118_MANIFEST = '80b108e4e142841af38827d3b6170c1260c543740f21b03ebb3d934278723ae9'   # frozen v1.18 manifest digest
assert sha(PARENT_MANIFEST_PATH) == V119_MANIFEST, ("the parent manifest on disk is not the accepted v1.19 manifest", PARENT_MANIFEST_PATH)


def external_pin(path, expected_sha256):
    """v1.20 repair (F-120-01): path, sha256 and byte count of an external pin all come from the SAME resolved file."""
    digest = sha(path)
    assert digest == expected_sha256, ("external pin digest mismatch", path, digest)
    return {'path': os.path.relpath(path, B).replace(os.sep, '/'), 'sha256': digest, 'bytes': os.path.getsize(path)}


_p17 = L.strict_load(PARENT_MANIFEST_PATH)
_out = os.path.join(B, 'FREEZE-MANIFEST.json')
_m18 = m
_m18['parent'] = dict(_p17['parent'])
_m18['parent'].update(version='1.19.0', branch='docs/resolve-authority-freeze-v1.19', head='5efbcae6a36b76d4a359f3e65e503336576575c7', semantic_head='5efbcae6a36b76d4a359f3e65e503336576575c7', manifest_sha256=V119_MANIFEST, immutable=True)
_m18['parent']['ancestors']=[{k:v for k,v in _p17['parent'].items() if k in ('version','branch','head','manifest_sha256')}]+_p17['parent']['ancestors']
_pv17={e['path']:e for e in _p17['files']}
for e in _m18['files']:
    old=_pv17.get(e['path']);same=old is not None and old['sha256']==e['sha256']
    e.update(inherited_from_parent=same, changed_from_parent=old is not None and not same, new_in_this_version=old is None)
_m18['removed_from_this_version_present_in_parent']=sorted(set(_pv17)-{e['path'] for e in _m18['files']})
_m18['prepared_by']='Claude Code — IMPLEMENTATION AUTHOR; independent review required'
_m18['external_pins']['v1_19_parent_manifest'] = external_pin(PARENT_MANIFEST_PATH, V119_MANIFEST)
_m18['external_pins']['v1_18_manifest'] = external_pin(os.path.join(os.path.dirname(B), 'v1.18', 'FREEZE-MANIFEST.json'), V118_MANIFEST)
# v1.20 repair (F-120-01/F-120-08): every ancestor manifest digest recorded in the parent block is pinned by construction,
# from its own frozen file (the accepted lineage names v1.17 as an ancestor, which no hand-written pin covered).
for _anc in _m18['parent']['ancestors']:
    if not any(_pin.get('sha256') == _anc['manifest_sha256'] for _pin in _m18['external_pins'].values()):
        _minor = _anc['version'].split('.')[1]
        _m18['external_pins']['v1_%s_manifest' % _minor] = external_pin(os.path.join(os.path.dirname(B), 'v1.%s' % _minor, 'FREEZE-MANIFEST.json'), _anc['manifest_sha256'])
_m18['counts'].update(inherited_unchanged=sum(e['inherited_from_parent'] for e in _m18['files']),changed_from_parent=sum(e['changed_from_parent'] for e in _m18['files']),new_in_this_version=sum(e['new_in_this_version'] for e in _m18['files']))
# v1.20 repair (F-120-01/02/05): the build refuses to write a manifest whose external pins do not re-verify (path, sha256,
# bytes; parent and ancestor parity) or whose own version statements disagree with the canonical authority version.
import release_authority as RELEASE  # noqa: E402
_self_check = RELEASE.pin_errors(B, _m18) + RELEASE.version_coherence_errors(B, _m18, manifest_only=True)
assert not _self_check, ("manifest self-check failed; not written", _self_check)
with open(_out,'w') as f: json.dump(_m18,f,indent=2);f.write('\n')
print('FINAL_V120_MANIFEST_SHA256',sha(_out))
