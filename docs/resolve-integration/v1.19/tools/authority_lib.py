"""VIDTOOLZ Resolve authority bundle v1.6 — reference canonicalization, evidence-envelope binding, deterministic freshness,
evidence-derived attachment/eligibility, RAW capability captures re-parsed by the versioned reference parser
(RAW_CAPABILITY_CAPTURE -> derive_capability_result -> REVIEW_DECISION -> REFREEZE_RECORD -> ACTIVE matrix), content-bound
capability matrix (capability_matrix_digest == active.capability_matrix_sha256), H0 guard records that carry the guarded
fields (profile/completeness/provenance/target proven before any mutator), mandatory schema enforcement in the composed
path, occurrence identity uniqueness + identity observation claims A/B/C, protected-surface delta with an explicit
exclusion list, journal readback -> S1 binding with mandatory CHECKPOINTED, derived applied-operation comparison and ONE
authorizing commit path (commit_eligibility -> validate_transaction_set).

AUTHORITY SURFACE: only the functions listed in AUTHORITY_SURFACE["authorizing"] may be used to decide anything. Every
per-document helper is INTERNAL_NON_AUTHORIZING: it exists for layered fixtures and is composed by the authorizing path;
none of them may bless a commit, a verification or a snapshot on its own.

Reference implementation (Python, offline). Nothing here touches Resolve. Node conformance is M1 work.
Executable *contract* checks only; not runtime-qualified.
"""
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timezone
from fractions import Fraction

AUTHORITY_VERSION = "1.19.0"
CANONICALIZATION_VERSION = "1.5"  # canonical text law unchanged since v1.5 (v1.7 changes the implementation, never the output)
RECORD_TYPE_VERSION = "1.10"
MAX_OBSERVATION_AGE_S = 3600
TRACK_TYPE_ORDER = {"video": 0, "audio": 1, "subtitle": 2}
ITEM_KIND_ORDER = {"MEDIA_BACKED": 0, "GENERATOR": 1, "TITLE": 2, "COMPOUND": 3, "ADJUSTMENT": 4, "FUSION_OR_GENERATED": 5, "OTHER_OBSERVED": 6}
HASH_DOMAINS = {
    "vidtoolz.resolveSnapshotPayload.v1.5", "vidtoolz.resolveGuard.v3", "vidtoolz.resolveProvenance.v1", "vidtoolz.resolveMutationPlan.v1", "vidtoolz.resolveOperationSet.v1",
    "vidtoolz.resolveBindingSet.v1", "vidtoolz.resolveJournalRecord.v1", "vidtoolz.resolveEvidenceRecord.v1", "vidtoolz.resolveVerificationResult.v1",
    "vidtoolz.resolveSnapshotObject.v1", "vidtoolz.resolveGeneric.v1",
    "vidtoolz.resolveRawCapabilityCapture.v1", "vidtoolz.resolveDerivedCapabilityResult.v1", "vidtoolz.resolvePrimitiveSpec.v1", "vidtoolz.resolveCapabilityMatrix.v1",
    # ---- v1.7 additions (Codex v1.6 findings C16-B1..B4, C16-M1..M3)
    "vidtoolz.resolveReadPrimitiveAuthority.v1", "vidtoolz.resolveEvidenceSet.v1", "vidtoolz.resolveContentKey.v1",
    "vidtoolz.resolveSchemaRegistry.v1", "vidtoolz.resolveTrustedCaptureShim.v1", "vidtoolz.resolveShimAllowlist.v1",
    "vidtoolz.resolveRawIngestReceipt.v1", "vidtoolz.resolveEvidenceSession.v4", "vidtoolz.resolveEvidenceInventory.v4",
    "vidtoolz.resolveEvidenceSessionIdentity.v2", "vidtoolz.resolveEvidenceRecordKey.v1", "vidtoolz.resolveEvidenceAttemptKey.v1",
    "vidtoolz.resolveEvidenceBoundary.v1", "vidtoolz.resolveLocationReceipt.v1",
    # ---- v1.15 addition (V114-B1): the canonical digest of a governed document's PARSED semantic content
    "vidtoolz.resolveEvidenceSetSnapshot.v1",
    "vidtoolz.resolveIdentityClaimSet.v1", "vidtoolz.resolveStoredChain.v1", "vidtoolz.resolveRefreezeBlock.v1",
}
# ---- v1.6 raw-capability-evidence vocabulary (RAW-CAPTURE.md, CAPTURE-SHIM.md)
RAW_SCHEMA_ID = "vidtoolz.resolveRawCapabilityCapture.v1"
RAW_DOMAIN = "vidtoolz.resolveRawCapabilityCapture.v1"
DERIVED_DOMAIN = "vidtoolz.resolveDerivedCapabilityResult.v1"
SPEC_DOMAIN = "vidtoolz.resolvePrimitiveSpec.v1"
MATRIX_DOMAIN = "vidtoolz.resolveCapabilityMatrix.v1"
CODEC = "vidtoolz.resolvePyValue.v1"
PARSER_VERSION = "vidtoolz.resolveProbeParser.v1"
RP_DOMAIN = "vidtoolz.resolveReadPrimitiveAuthority.v1"
ES_DOMAIN = "vidtoolz.resolveEvidenceSet.v1"
CONTENT_KEY_DOMAIN = "vidtoolz.resolveContentKey.v1"
CHAIN_DOMAIN = "vidtoolz.resolveStoredChain.v1"
REFREEZE_BLOCK_DOMAIN = "vidtoolz.resolveRefreezeBlock.v1"
IDENTITY_CLAIM_DOMAIN = "vidtoolz.resolveIdentityClaimSet.v1"
SHIM_AUTHORITY_DOMAIN = "vidtoolz.resolveTrustedCaptureShim.v1"
SHIM_ALLOWLIST_DOMAIN = "vidtoolz.resolveShimAllowlist.v1"
SCHEMA_REGISTRY_DOMAIN = "vidtoolz.resolveSchemaRegistry.v1"
RAW_INGEST_RECEIPT_DOMAIN = "vidtoolz.resolveRawIngestReceipt.v1"
RAW_INGEST_VERSION = "vidtoolz.resolveRawIngest.v1"
SCHEMA_REGISTRY_VERSION = "vidtoolz.resolveSchemaRegistry.v1"
TRUSTED_SHIM_AUTHORITY_VERSION = "vidtoolz.resolveTrustedCaptureShim.v1"
SCHEMA_REGISTRY_FILE = "SCHEMA-REGISTRY.json"
# ---- v1.8: the ONE evidence-storage authority (Codex ES-2). Nothing else in this bundle may store evidence.
EVIDENCE_STORE_MODULE = "tools/evidence_store.py"
EVIDENCE_STORE_VERSION = "vidtoolz.resolveEvidenceStore.v5"
EVIDENCE_SESSION_SCHEMA = "vidtoolz.resolveEvidenceSession.v4"
EVIDENCE_BOUNDARY_SCHEMA = "vidtoolz.resolveEvidenceBoundary.v1"
EVIDENCE_INVENTORY_SCHEMA = "vidtoolz.resolveEvidenceInventory.v4"
EVIDENCE_FINALIZATION_SCHEMA = "vidtoolz.resolveEvidenceFinalization.v2"
EVIDENCE_STORE_PLATFORM_SCOPE = "POSIX"

# ================================================================ v1.12 pre-M0A workflow authority (V112-1..V112-4)
# The v1.11 gap was operational, not derivational: the resolveEvidenceSet document had no governed location, no
# lifecycle, no writer and no production constructor, so ATTACHMENT_READY was reachable only from fixtures. These
# constants are the frozen principal and grant law the authoring tools enforce and the derivation now binds.
#
# HONESTY (THREAT-MODEL.md v1.12): a principal is a ROLE-BOUND OPERATIONAL LABEL, not an authenticated identity.
# There is no key, no signature and no certificate. What the law buys is that the WRITING TOOL stamps the principal
# from a frozen registry for the role it implements, so a caller cannot invent two labels inside one record and no
# actor id may hold two roles. A human who runs both tools is still one human; that residual risk is stated, not
# closed, and only Mikko's approval and git history stand behind it.
PRINCIPAL_ROLES = ("PREPARER", "VERIFIER", "APPROVER")
PRINCIPAL_REGISTRY = {
    "PREPARER": ("PREPARER:hermes-m0a-driver", "PREPARER:mikko-operator"),
    "VERIFIER": ("VERIFIER:codex-independent",),
    "APPROVER": ("APPROVER:mikko",),
}
# Exactly which record types each role may author. No role may write any other type; APPROVER writes no records.
WRITE_GRANTS = {
    "PREPARER": ("LAUNCH_RECIPE", "PROVISIONING_RECORD", "READ_ONLY_JOURNAL"),
    "VERIFIER": ("BUNDLE_VERIFICATION",),
    "APPROVER": (),
}
# The evidence-set document lifecycle. Writes are granted by (state, role); VERIFIED grants nothing to anyone.
EVIDENCE_SET_STATES = ("OPEN", "PREPARED", "VERIFIED")
EVIDENCE_SET_STATE_GRANTS = {
    "OPEN": {"PREPARER": WRITE_GRANTS["PREPARER"]},
    "PREPARED": {"VERIFIER": WRITE_GRANTS["VERIFIER"]},
    "VERIFIED": {},
}
VERIFICATION_RESULTS = ("PASS", "FAIL")
QUALIFICATION_EVIDENCE_ROOT = "/home/vidtoolz/resolve-qualification-evidence"
# v1.13 (V112-RP1): THE one governed attachment evidence root. v1.12 froze this law in prose while the production
# authoring API and both CLIs still accepted a caller-supplied root, so a complete workflow under an arbitrary or
# SYMLINKED root derived ATTACHMENT_READY - a direct contradiction of the law. In v1.13 no authorizing function or
# CLI takes a root at all: this constant is the only source, and the authorizing derivation refuses any document
# whose recorded authority root is not exactly this value.
GOVERNED_ATTACHMENT_ROOT = QUALIFICATION_EVIDENCE_ROOT + "/attachment"
GOVERNED_ROOT_MODE = 0o700
# v1.14 (V113-B1): the governed-location law now lives in the AUTHORIZING CORE, not only in the authoring wrapper.
# v1.13 froze the root and enforced it in evidence_authoring's wrapper, while authority_lib.derive_attachment_state
# and evaluate_eligibility - the two functions actually declared AUTHORIZING - still accepted a bare evidence-set
# dict and returned ATTACHMENT_READY / eligible=true for a document authored under a forbidden root. The location
# check did not dominate the authorizing call graph. It does now: authorizing readiness and authorizing eligibility
# are reachable only through a GovernedEvidenceSet, which only the canonical loader below can construct and whose
# location receipt the core re-verifies against the real filesystem on every authorizing call.
LOCATION_RECEIPT_DOMAIN = "vidtoolz.resolveLocationReceipt.v1"
# v1.15 (V114-B1): the canonical digest of the PARSED semantic content of a governed document. The receipt binds the
# raw bytes; this binds what those bytes MEAN once strict-parsed, so the object an authorizing derivation consumes can
# be proved to be the parse of the exact validated bytes and of nothing else.
EVIDENCE_SNAPSHOT_DOMAIN = "vidtoolz.resolveEvidenceSetSnapshot.v1"
EVIDENCE_SET_FILE_NAME = "EVIDENCE-SET.json"
WORKFLOW_FILE_NAME = "WORKFLOW.json"
# The safe-basename session-id law (v1.13 section 5), held in the core so the authorizing path and the authoring
# layer share ONE implementation rather than two.
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
LOCATION_ERRORS = ("ROOT_NOT_GOVERNED", "ROOT_SYMLINK_REFUSED", "ROOT_NOT_A_DIRECTORY", "ROOT_NOT_FOUND",
                   "ROOT_MODE_INVALID", "SESSION_SYMLINK_REFUSED", "SESSION_NOT_A_DIRECTORY",
                   "SESSION_PATH_NOT_GOVERNED", "SESSION_ID_INVALID", "SESSION_NOT_FOUND", "DOCUMENT_NOT_FOUND",
                   "DOCUMENT_SYMLINK_REFUSED", "DOCUMENT_NOT_AT_CANONICAL_PATH", "SELF_LOCATION_MISMATCH",
                   "NOT_PRODUCTION_ROOT", "LOCATION_PROVENANCE_MISSING", "LOCATION_RECEIPT_INVALID",
                   # ---- v1.15 (V114-B4): WORKFLOW.json is authority-bearing and gets the same file-entry law as
                   # EVIDENCE-SET.json. v1.14 checked only that it existed and then opened it through strict_load,
                   # which follows a symlink, blocks forever on a FIFO and raises IsADirectoryError on a directory.
                   "WORKFLOW_NOT_FOUND", "WORKFLOW_SYMLINK_REFUSED", "WORKFLOW_NOT_A_REGULAR_FILE",
                   "WORKFLOW_NOT_AT_CANONICAL_PATH",
                   # ---- v1.15 (V114-M1): a structurally malformed carrier fails closed in the frozen vocabulary
                   # instead of leaking AttributeError from a public authorizing boundary.
                   "GOVERNED_EVIDENCE_INVALID",
                   # ---- v1.15 (V114-B1): the consumed semantic object is not the parse of the validated bytes.
                   "EVIDENCE_SNAPSHOT_MISMATCH",
                   # ---- v1.15 (V114-B2): an authorizing transaction/commit path was handed evidence with no
                   # governed provenance at all.
                   "GOVERNED_EVIDENCE_REQUIRED",
                   # ---- v1.16 (V115-M1): an internal-consistency refusal, raised (never normalised) if the receipt
                   # body and the declared RECEIPT_BOUND_FIELDS ever disagree.
                   "RECEIPT_BINDING_DRIFT")


def authority_attachment_root():
    """THE authority attachment root. Takes no argument and has NO override of any kind, not even for tests: the
    authorizing core resolves the frozen constant and nothing else. The authoring layer's sandbox (used only to
    exercise workflow mechanics offline) therefore cannot reach an authorizing result."""
    return GOVERNED_ATTACHMENT_ROOT


def canonical_session_dir(session_id):
    """<authority attachment root>/<session_id> - the ONE canonical location for one evaluated Resolve session."""
    return os.path.join(GOVERNED_ATTACHMENT_ROOT, session_id)


def canonical_document_path(session_id):
    return os.path.join(canonical_session_dir(session_id), EVIDENCE_SET_FILE_NAME)


def canonical_workflow_path(session_id):
    """v1.15 (V114-B4): the ONE canonical path of the authority-bearing workflow file for a session."""
    return os.path.join(canonical_session_dir(session_id), WORKFLOW_FILE_NAME)


def session_id_errors(session_id):
    """Safe basename only. Rejects empty, separators, .., leading dot, NUL, absolute syntax, drive letters,
    whitespace and over-length, so no traversal is possible through the session id."""
    if not isinstance(session_id, str) or not SESSION_ID_RE.match(session_id) or session_id in (".", ".."):
        return [f"SESSION_ID_INVALID: {session_id!r}"]
    return []


def _entry_lstat(p):
    """The directory ENTRY itself, never its target. lstat first; nothing is resolved before it is classified."""
    try:
        return os.lstat(p)
    except (FileNotFoundError, NotADirectoryError):
        return None


def governed_dir_errors(p, kind, want_mode=None):
    """THE single directory-entry trust implementation, shared by the authorizing core and the authoring layer.
    lstat-first classification, then an alias check; never a resolve-then-trust."""
    st = _entry_lstat(p)
    if st is None:
        return [f"{kind}_NOT_FOUND: {p}"]
    if stat.S_ISLNK(st.st_mode):
        return [f"{kind}_SYMLINK_REFUSED: {p} is a symlink; the governed path is never followed through one"]
    if not stat.S_ISDIR(st.st_mode):
        return [f"{kind}_NOT_A_DIRECTORY: {p} ({stat.S_IFMT(st.st_mode):#o})"]
    if want_mode is not None and stat.S_IMODE(st.st_mode) != want_mode:
        return [f"{kind}_MODE_INVALID: {p} mode {stat.S_IMODE(st.st_mode):#o} != {want_mode:#o}"]
    if os.path.realpath(p) != p:
        return [f"{kind}_NOT_GOVERNED: {p} resolves to {os.path.realpath(p)}; an aliased path is refused"]
    return []


def governed_file_errors(p, kind, want_modes=None):
    """THE single authority-FILE trust implementation (v1.15, V114-B4). INTERNAL_NON_AUTHORIZING: a predicate over a
    path, decided by the core's own callers; it never authorizes anything and no authorizing entry point takes a path.

    Symmetrical with governed_dir_errors: the directory ENTRY is classified by lstat before anything is opened or
    resolved, so a symlink is refused rather than followed, and a FIFO, socket, device or directory is refused rather
    than opened. v1.14 applied this to EVIDENCE-SET.json only; WORKFLOW.json got an existence check and then
    strict_load, which follows symlinks, blocks forever on a FIFO and raises a raw IsADirectoryError on a directory."""
    st = _entry_lstat(p)
    if st is None:
        return [f"{kind}_NOT_FOUND: {p}"]
    if stat.S_ISLNK(st.st_mode):
        return [f"{kind}_SYMLINK_REFUSED: {p} is a symlink; an authority file is never read through one"]
    if not stat.S_ISREG(st.st_mode):
        return [f"{kind}_NOT_A_REGULAR_FILE: {p} is {stat.S_IFMT(st.st_mode):#o}, not a regular file"]
    if want_modes is not None and stat.S_IMODE(st.st_mode) not in want_modes:
        return [f"{kind}_MODE_INVALID: {p} mode {stat.S_IMODE(st.st_mode):#o} not in "
                f"{'/'.join(oct(m) for m in want_modes)}"]
    if os.path.realpath(p) != p:
        return [f"{kind}_NOT_AT_CANONICAL_PATH: {p} resolves to {os.path.realpath(p)}"]
    return []


def read_governed_file(p, kind):
    """Read an authority file with no-follow semantics, returning (bytes, sha256, errors).
    INTERNAL_NON_AUTHORIZING: a reader, not a decider; the authorizing entry points take no path of any kind.

    The entry is classified first by governed_file_errors, then opened with O_NOFOLLOW and O_NONBLOCK where the
    platform provides them and the OPEN FILE is re-verified by fstat to be the same regular file (device, inode) the
    entry check saw. A symlink cannot be followed, a FIFO cannot block the authority, and an entry swapped between
    the check and the open is refused rather than trusted."""
    errs = governed_file_errors(p, kind)
    if errs:
        return None, None, errs
    lst = _entry_lstat(p)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(p, flags)
    except OSError as e:
        return None, None, [f"{kind}_NOT_AT_CANONICAL_PATH: {p} could not be opened no-follow ({e.errno})"]
    try:
        fst = os.fstat(fd)
        if not stat.S_ISREG(fst.st_mode):
            return None, None, [f"{kind}_NOT_A_REGULAR_FILE: {p} changed type before the read"]
        if lst is None or (fst.st_dev, fst.st_ino) != (lst.st_dev, lst.st_ino):
            return None, None, [f"{kind}_NOT_AT_CANONICAL_PATH: {p} was replaced between check and open"]
        chunks = []
        while True:
            b = os.read(fd, 1 << 20)
            if not b:
                break
            chunks.append(b)
    finally:
        os.close(fd)
    raw = b"".join(chunks)
    return raw, hashlib.sha256(raw).hexdigest(), []


def location_errors(session_id):
    """V113-B1 / v1.13 section 7, now in the core. Every location fact the authorizing path requires, computed from
    the REAL filesystem against the frozen constant. No caller input participates beyond the session id."""
    errs = session_id_errors(session_id)
    if errs:
        return errs
    root = authority_attachment_root()
    if not os.path.isabs(root) or os.path.normpath(root) != root:
        return [f"ROOT_NOT_GOVERNED: {root!r} is not an absolute normalised path"]
    errs += governed_dir_errors(root, "ROOT", want_mode=GOVERNED_ROOT_MODE)
    if errs:
        return errs
    d = canonical_session_dir(session_id)
    if os.path.basename(d) != session_id or os.path.dirname(d) != root:
        return [f"SESSION_PATH_NOT_GOVERNED: {d}"]
    errs += governed_dir_errors(d, "SESSION")
    if errs:
        return errs
    errs += governed_file_errors(canonical_document_path(session_id), "DOCUMENT")
    if errs:
        return errs
    # v1.15 (V114-B4): WORKFLOW.json carries authority-bearing session, location, lifecycle and seal claims that
    # participate in provenance minting, so it gets the SAME entry law as the evidence document. In v1.14 it was
    # checked for existence only and then opened through strict_load, which follows a symlink.
    errs += governed_file_errors(canonical_workflow_path(session_id), "WORKFLOW")
    return errs


def evidence_snapshot_digest(es):
    """The canonical digest of a governed document's PARSED semantic content (v1.15, V114-B1).

    This is what makes "the bytes I validated are the bytes I consumed" checkable: the same digest is recomputed from
    the object an authorizing derivation is about to consume and compared with the digest recorded when the validated
    bytes were parsed. It is computed over the parsed content, so it is insensitive to insignificant byte formatting
    and sensitive to every semantic difference."""
    return digest(es, EVIDENCE_SNAPSHOT_DOMAIN)


# v1.16 (V115-M1): THE runtime receipt binding, declared once, in the order location_receipt() digests it. Codex
# found EVIDENCE-SET-WORKFLOW.json publishing only the seven v1.14 fields while the runtime bound ten - the three
# v1.15 additions (workflow_path, workflow_sha256, evidence_snapshot_digest) were missing from the machine authority
# Hermes reads. The publication is now GENERATED from this tuple and machine-compared with what the function
# actually digests, in both directions, so an omission or an over-claim is a validation failure.
RECEIPT_BOUND_FIELDS = ("session_id", "document_path", "workflow_path", "governed_root", "authority_version",
                        "manifest_sha256", "document_sha256", "workflow_sha256", "evidence_snapshot_digest",
                        "location_validated")
# Per-field operational semantics (V115-M1 section 19): a name alone is not enough for a consumer to reproduce the
# receipt. source = where the value comes from; normative = whether authority depends on it; in_digest = whether it
# is inside the domain-tagged digest; revalidated_live = whether governed_consume re-derives it from the filesystem
# on every authorizing call; consumed_by_authorizing_core = whether the authorizing path reads it.
RECEIPT_FIELD_SEMANTICS = {
    "session_id": {"source": "caller-supplied session id, validated by session_id_errors and compared with both authority files' own claims",
                   "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "document_path": {"source": "DERIVED: canonical_document_path(session_id) from the frozen governed root",
                      "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "workflow_path": {"source": "DERIVED: canonical_workflow_path(session_id) from the frozen governed root (v1.15 V114-B4)",
                      "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "governed_root": {"source": "FROZEN CONSTANT: GOVERNED_ATTACHMENT_ROOT; no caller input participates",
                      "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "authority_version": {"source": "FROZEN CONSTANT: AUTHORITY_VERSION of this bundle",
                          "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "manifest_sha256": {"source": "active authority: active['manifest_sha256'] of the reviewed manifest",
                        "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "document_sha256": {"source": "sha256 of the exact EVIDENCE-SET.json bytes read no-follow from the canonical path",
                        "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "workflow_sha256": {"source": "sha256 of the exact WORKFLOW.json bytes read no-follow from the canonical path (v1.15 V114-B4)",
                        "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "evidence_snapshot_digest": {"source": "evidence_snapshot_digest(parse of those exact document bytes) under vidtoolz.resolveEvidenceSetSnapshot.v1 (v1.15 V114-B1)",
                                 "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": True},
    "location_validated": {"source": "CONSTANT True: the receipt is only ever computed after location_errors() returned empty; it is not a caller claim",
                           "normative": True, "in_digest": True, "revalidated_live": True, "consumed_by_authorizing_core": False},
}


# ================================================================ v1.16 (V115-B1): ONE canonical classification
# Codex found current TARGET-CONTRACT fields and a SCHEMA-REGISTRY sentence contradicting the four-class model that
# AUTHORITY_SURFACE declares in code. The classes were right; the ACTIVE ARTIFACTS disagreed with them, and authority
# selection is itself an authorizing decision. v1.16 derives ONE machine-readable classification map from
# AUTHORITY_SURFACE and publishes it, so every artifact quotes a generated fact instead of restating a claim.
FUNCTION_CLASS_LAW = {
    "authorizing": "may decide an authority question. Requires governed provenance (a GovernedEvidenceSet minted by "
                   "load_governed_evidence_set) wherever it consumes evidence.",
    "diagnostic_non_authorizing": "the same SEMANTIC derivation over a bare evidence set. No governed provenance, no "
                                  "location receipt. For fixtures, in-memory evidence and diagnosis. Its result may "
                                  "look like a readiness or eligibility answer and is never authority.",
    "provisional_until_m3_non_authorizing": "composed transaction/commit validation over a bare evidence set. Every "
                                            "stage law is identical to the authorizing pair, but without governed "
                                            "provenance the result is not write authority.",
    "internal_non_authorizing": "a helper composed by the authority; never a public decision point.",
}


def authority_function_classes():
    """THE canonical function -> authority_class map (v1.16, V115-B1). Derived from AUTHORITY_SURFACE, so there is no
    second list to keep in step. Exactly one class per function; the four classes are disjoint by construction."""
    out, dup = {}, []
    for cls in ("authorizing", "diagnostic_non_authorizing", "provisional_until_m3_non_authorizing",
                "internal_non_authorizing"):
        for fn in AUTHORITY_SURFACE[cls]:
            if fn in out:
                dup.append(fn)
            out[fn] = cls
    if dup:
        raise AuthorityTrustError(f"FUNCTION_CLASS_CONTRADICTION: {sorted(set(dup))} appear in more than one class")
    return out


def authority_function_class(name):
    """The one current class of a function name, or None if the surface does not classify it."""
    return authority_function_classes().get(name)


# The attachment/eligibility/transaction names every active artifact may speak about. Publishing the CLOSED list is
# what lets a consumer - and the validator - check an artifact exhaustively instead of by an exclusion list, which is
# precisely how the v1.15 contradiction survived its own audit.
CLASSIFIED_DECISION_FUNCTIONS = ("derive_attachment_state", "derive_attachment_state_authorizing",
                                 "derive_attachment_state_for_session", "evaluate_eligibility",
                                 "evaluate_eligibility_authorizing", "evaluate_eligibility_for_session",
                                 "validate_transaction_set", "validate_transaction_set_authorizing",
                                 "commit_eligibility", "commit_eligibility_authorizing",
                                 "load_governed_evidence_set", "governed_consume")


def receipt_binding_publication():
    """THE machine-readable receipt binding, generated from the runtime (v1.16, V115-M1).

    A consumer - Hermes's M0A package in particular - must be able to derive the exact receipt field set from frozen
    machine authority without reading Python. This function is the single source that the published document is
    generated from and validated against, so publication and runtime cannot drift."""
    return {"domain": LOCATION_RECEIPT_DOMAIN,
            "binds": list(RECEIPT_BOUND_FIELDS),
            "bound_fields": [dict(field=f, **RECEIPT_FIELD_SEMANTICS[f]) for f in RECEIPT_BOUND_FIELDS],
            "digest_law": "sha256(utf8(domain) + 0x0A + canonical_bytes(object of exactly these fields))",
            "recomputed_on_every_authorizing_call": True,
            "snapshot_domain_is_distinct": EVIDENCE_SNAPSHOT_DOMAIN,
            "parity_law": "RUNTIME_BOUND_FIELDS == PUBLISHED_BOUND_FIELDS exactly, in both directions and in order; "
                          "an omitted field or a claimed field the runtime does not bind is a validation failure"}


def location_receipt(session_id, document_sha256, active, workflow_sha256=None, snapshot_digest=None):
    """The authority-generated location receipt. Binds the session id, the canonical document path, the frozen
    governed root, the authority version, the active manifest, the evidence-document digest and the validation
    result - and, from v1.15, the WORKFLOW.json digest (V114-B4: its claims participate in provenance minting) and
    the digest of the PARSED semantic snapshot (V114-B1: the meaning of those exact bytes).

    It is a digest under a registered hash domain, recomputed by the core on every authorizing call, so a caller
    cannot hand-craft one: forging it would require the filesystem facts to be true anyway."""
    # v1.16 (V115-M1): the digest body is assembled FROM RECEIPT_BOUND_FIELDS, so the declared field set and the
    # digested field set are one thing rather than two that can drift. A mismatch is an internal programming error
    # and is raised, not normalised: the published binding would otherwise be a lie about the authority.
    values = {"session_id": session_id,
              "document_path": canonical_document_path(session_id),
              "workflow_path": canonical_workflow_path(session_id),
              "governed_root": GOVERNED_ATTACHMENT_ROOT,
              "authority_version": AUTHORITY_VERSION,
              "manifest_sha256": (active or {}).get("manifest_sha256"),
              "document_sha256": document_sha256,
              "workflow_sha256": workflow_sha256,
              "evidence_snapshot_digest": snapshot_digest,
              "location_validated": True}
    if tuple(values) != RECEIPT_BOUND_FIELDS:
        raise AuthorityTrustError(f"RECEIPT_BINDING_DRIFT: location_receipt assembles {tuple(values)} but "
                                  f"RECEIPT_BOUND_FIELDS declares {RECEIPT_BOUND_FIELDS}")
    return digest({f: values[f] for f in RECEIPT_BOUND_FIELDS}, LOCATION_RECEIPT_DOMAIN)


_GOVERNED_TOKEN = object()


_MISSING = object()
_GOVERNED_FIELDS = ("session_id", "document_path", "workflow_path", "governed_root", "authority_version",
                    "manifest_sha256", "document_sha256", "workflow_sha256", "evidence_snapshot_digest", "receipt")


class GovernedEvidenceSet:
    """A governed evidence CARRIER: the validated bytes of one canonical governed document, plus the provenance that
    validated them (V113-B1 model C + B; made byte-bound and immutable in v1.15 by V114-B1).

    v1.14 stored the parsed dict in a writable slot, so a caller could keep a valid receipt for document A and
    replace the semantic payload with B - or mutate the stored dict in place - and the authorizing derivation
    consumed the substituted object. Validation applied to byte stream A while authorization consumed object B.

    v1.15 therefore stores the EXACT VALIDATED BYTES (immutable) and no parsed object at all:

      * the carrier is frozen after construction: __setattr__ and __delattr__ refuse, so no slot can be replaced;
      * `document_bytes` is a bytes object, which cannot be mutated in place;
      * `evidence_set` is a read-only PROPERTY that strict-parses those bytes afresh on every access and returns a
        new object, so mutating what a caller received changes nothing any authorizing path will ever see;
      * `evidence_snapshot_digest` records the canonical digest of the parse of those bytes;
      * copy, deepcopy and pickle are refused, so provenance cannot be cloned out of the loader.

    Only load_governed_evidence_set() constructs one. Every authorizing entry point re-verifies the carrier against
    the live filesystem AND re-derives the semantic object from the validated bytes before any semantic work."""

    __slots__ = ("document_bytes",) + _GOVERNED_FIELDS

    def __init__(self, token, **kw):
        if token is not _GOVERNED_TOKEN:
            raise AuthorityTrustError("GovernedEvidenceSet is constructible only by "
                                      "authority_lib.load_governed_evidence_set (V113-B1)")
        for k in self.__slots__:
            object.__setattr__(self, k, kw[k])

    # ---- frozen: v1.14's writable slots were the V114-B1 substitution surface
    def __setattr__(self, name, value):
        raise AuthorityTrustError(f"GOVERNED_EVIDENCE_INVALID: a GovernedEvidenceSet is immutable; "
                                  f"{name!r} cannot be assigned after canonical loading (V114-B1)")

    def __delattr__(self, name):
        raise AuthorityTrustError(f"GOVERNED_EVIDENCE_INVALID: a GovernedEvidenceSet is immutable; "
                                  f"{name!r} cannot be deleted (V114-B1)")

    @property
    def evidence_set(self):
        """The semantic evidence set, strict-parsed FROM THE VALIDATED BYTES on every access, returned as a fresh
        object each time. There is no stored parsed object to substitute or mutate."""
        return strict_loads(self.document_bytes.decode("utf-8"))

    def __copy__(self):
        raise AuthorityTrustError("GOVERNED_EVIDENCE_INVALID: governed provenance is not copyable (V114-M1)")

    def __deepcopy__(self, _memo):
        raise AuthorityTrustError("GOVERNED_EVIDENCE_INVALID: governed provenance is not copyable (V114-M1)")

    def __reduce__(self):
        raise AuthorityTrustError("GOVERNED_EVIDENCE_INVALID: governed provenance is not serialisable (V114-M1)")

    def __repr__(self):
        sid = getattr(self, "session_id", "<unset>")
        rcp = getattr(self, "receipt", None)
        return f"<GovernedEvidenceSet {sid} at {getattr(self, 'document_path', '<unset>')} " \
               f"receipt {rcp[:12] if isinstance(rcp, str) else rcp}>"


def governed_structure_errors(governed):
    """Structural validation of an authorizing input BEFORE any attribute is dereferenced (v1.15, V114-M1).

    object.__new__(GovernedEvidenceSet) produces an instance that passes isinstance and has NO slots set; in v1.14
    the provenance check then dereferenced .session_id and leaked a raw AttributeError out of both public authorizing
    boundaries. copy, deepcopy and pickle reach the same nominal-instance state. Every field is fetched with a
    default and type-checked here, so a malformed carrier fails closed inside the frozen vocabulary."""
    if not isinstance(governed, GovernedEvidenceSet):
        return [f"LOCATION_PROVENANCE_MISSING: authorizing derivation requires a GovernedEvidenceSet from "
                f"authority_lib.load_governed_evidence_set, got {type(governed).__name__}"]
    if type(governed) is not GovernedEvidenceSet:
        return [f"GOVERNED_EVIDENCE_INVALID: {type(governed).__name__} is a subclass, not the governed carrier"]
    raw = getattr(governed, "document_bytes", _MISSING)
    if raw is _MISSING or not isinstance(raw, bytes) or not raw:
        return ["GOVERNED_EVIDENCE_INVALID: document_bytes missing, empty or not bytes"]
    for f in _GOVERNED_FIELDS:
        v = getattr(governed, f, _MISSING)
        if v is _MISSING:
            return [f"GOVERNED_EVIDENCE_INVALID: {f} is not set (nominal instance, not loader-created)"]
        if not isinstance(v, str) or not v:
            return [f"GOVERNED_EVIDENCE_INVALID: {f} is {type(v).__name__}, expected a non-empty string"]
    for f in ("document_sha256", "workflow_sha256", "evidence_snapshot_digest", "receipt", "manifest_sha256"):
        if not is_sha(getattr(governed, f)):
            return [f"GOVERNED_EVIDENCE_INVALID: {f} is not a sha256 digest"]
    return []


def _governed_document_claims(session_id, es, wf):
    """The self-location and production-root law both authority files must satisfy. Shared by the loader and by the
    per-call revalidation so the two can never drift (v1.15)."""
    if wf.get("session_id") != session_id or es.get("current_session_id") != session_id:
        return ["SELF_LOCATION_MISMATCH: document/workflow name another session"]
    claimed = os.path.abspath(os.path.join(wf.get("governed_root") or "", wf.get("session_id") or ""))
    if claimed != os.path.abspath(canonical_session_dir(session_id)):
        return [f"SELF_LOCATION_MISMATCH: document records {claimed} but was loaded from "
                f"{canonical_session_dir(session_id)}"]
    if wf.get("authority_root") != GOVERNED_ATTACHMENT_ROOT:
        return [f"ROOT_NOT_GOVERNED: document claims authority root {wf.get('authority_root')!r}"]
    if wf.get("written_under_production_root") is not True:
        return ["NOT_PRODUCTION_ROOT: document was not written under the frozen authority root"]
    return []


def load_governed_evidence_set(session_id, active):
    """THE canonical loader, and the only door to authorizing readiness or eligibility.

    In order: computes the canonical paths from the frozen root; validates the root, session directory and BOTH
    authority-file entries (lstat first, symlink refused, regular file required); reads each file no-follow with the
    open file re-verified by fstat; digests the exact bytes read; strict-parses THOSE EXACT BYTES; validates the
    evidence-set schema; checks the document's own self-location claims against where the core actually found it;
    requires the recorded authority root to be the frozen constant and written_under_production_root to be true;
    reconciles the digest sealed at VERIFIED; computes the canonical digest of the parsed snapshot; and mints the
    location receipt over all of it.

    The carrier it returns holds the VALIDATED BYTES, never a parsed object (V114-B1).

    Raises AuthorityTrustError with one of LOCATION_ERRORS. Returns a GovernedEvidenceSet."""
    errs = location_errors(session_id)
    if errs:
        raise AuthorityTrustError("; ".join(errs[:3]))
    doc, wfp = canonical_document_path(session_id), canonical_workflow_path(session_id)
    raw, document_sha256, errs = read_governed_file(doc, "DOCUMENT")
    if errs:
        raise AuthorityTrustError("; ".join(errs[:3]))
    wraw, workflow_sha256, errs = read_governed_file(wfp, "WORKFLOW")
    if errs:
        raise AuthorityTrustError("; ".join(errs[:3]))
    es = strict_loads(raw.decode("utf-8"))
    wf = strict_loads(wraw.decode("utf-8"))
    serrs = internal_schema_errors(EVIDENCE_SET_REGISTRY_KEY, es)
    if serrs:
        raise AuthorityTrustError(f"GOVERNED_EVIDENCE_INVALID: governed document fails its own schema: {serrs[0]}")
    errs = _governed_document_claims(session_id, es, wf)
    if errs:
        raise AuthorityTrustError("; ".join(errs[:3]))
    if wf.get("evidence_set_sha256") and wf["evidence_set_sha256"] != document_sha256:
        raise AuthorityTrustError("LOCATION_RECEIPT_INVALID: document bytes differ from the digest sealed at VERIFIED")
    snap = evidence_snapshot_digest(es)
    return GovernedEvidenceSet(_GOVERNED_TOKEN, document_bytes=raw, session_id=session_id, document_path=doc,
                               workflow_path=wfp, governed_root=GOVERNED_ATTACHMENT_ROOT,
                               authority_version=AUTHORITY_VERSION,
                               manifest_sha256=(active or {}).get("manifest_sha256"),
                               document_sha256=document_sha256, workflow_sha256=workflow_sha256,
                               evidence_snapshot_digest=snap,
                               receipt=location_receipt(session_id, document_sha256, active,
                                                        workflow_sha256=workflow_sha256, snapshot_digest=snap))


def governed_consume(governed, active):
    """THE one way an authorizing path obtains semantic evidence (v1.15, V114-B1). Returns (errors, evidence_set).

    THE EXACT BYTES VALIDATED AS GOVERNED EVIDENCE ARE THE EXACT BYTES CONSUMED BY AUTHORIZING DERIVATION.

    On every authorizing call this function:

      1. validates the carrier STRUCTURALLY, before dereferencing anything (V114-M1);
      2. revalidates the whole live location - root, session directory, and both authority-file entries, lstat first;
      3. re-reads BOTH authority files no-follow and digests the exact bytes read;
      4. requires those live digests to equal the digests the carrier was minted with;
      5. requires the carrier's own stored bytes to digest to the same value, so the bytes it holds are the live
         bytes and not an earlier version;
      6. strict-parses THOSE EXACT BYTES and schema-validates the result;
      7. requires the canonical snapshot digest of that parse to equal the one bound into the receipt;
      8. re-checks the document's self-location, production-root and sealed-digest claims;
      9. recomputes the receipt over all of it and requires it to match.

    Only then does it return the semantic object - the parse of the validated bytes, freshly built, never a stored
    or caller-supplied dict. In v1.14 the carrier held a mutable parsed dict that no check bound to the validated
    bytes, so provenance for document A could be presented with semantic evidence B."""
    errs = governed_structure_errors(governed)
    if errs:
        return errs, None
    session_id = governed.session_id
    errs = location_errors(session_id)
    if errs:
        return errs, None
    if governed.governed_root != GOVERNED_ATTACHMENT_ROOT or governed.authority_version != AUTHORITY_VERSION:
        return ["ROOT_NOT_GOVERNED: object binds another root or authority version"], None
    if governed.document_path != canonical_document_path(session_id):
        return [f"DOCUMENT_NOT_AT_CANONICAL_PATH: {governed.document_path}"], None
    if governed.workflow_path != canonical_workflow_path(session_id):
        return [f"WORKFLOW_NOT_AT_CANONICAL_PATH: {governed.workflow_path}"], None
    if (active or {}).get("manifest_sha256") != governed.manifest_sha256:
        return ["LOCATION_RECEIPT_INVALID: object binds another active manifest"], None
    raw, now, ferrs = read_governed_file(governed.document_path, "DOCUMENT")
    if ferrs:
        return ferrs, None
    wraw, wnow, ferrs = read_governed_file(governed.workflow_path, "WORKFLOW")
    if ferrs:
        return ferrs, None
    if now != governed.document_sha256:
        return ["LOCATION_RECEIPT_INVALID: the document changed since it was loaded"], None
    if wnow != governed.workflow_sha256:
        return ["LOCATION_RECEIPT_INVALID: the workflow file changed since it was loaded"], None
    if hashlib.sha256(governed.document_bytes).hexdigest() != now:
        return ["EVIDENCE_SNAPSHOT_MISMATCH: the carrier's bytes are not the live governed bytes"], None
    es = strict_loads(raw.decode("utf-8"))
    wf = strict_loads(wraw.decode("utf-8"))
    serrs = internal_schema_errors(EVIDENCE_SET_REGISTRY_KEY, es)
    if serrs:
        return [f"GOVERNED_EVIDENCE_INVALID: governed document fails its own schema: {serrs[0]}"], None
    if evidence_snapshot_digest(es) != governed.evidence_snapshot_digest:
        return ["EVIDENCE_SNAPSHOT_MISMATCH: the parse of the validated bytes is not the bound snapshot"], None
    errs = _governed_document_claims(session_id, es, wf)
    if errs:
        return errs, None
    if wf.get("evidence_set_sha256") and wf["evidence_set_sha256"] != now:
        return ["LOCATION_RECEIPT_INVALID: document bytes differ from the digest sealed at VERIFIED"], None
    if location_receipt(session_id, now, active, workflow_sha256=wnow,
                        snapshot_digest=governed.evidence_snapshot_digest) != governed.receipt:
        return ["LOCATION_RECEIPT_INVALID: receipt does not recompute"], None
    return [], es


def governed_provenance_errors(governed, active):
    """Re-verify a GovernedEvidenceSet against the filesystem NOW, discarding the semantic result. Retained as the
    published predicate; the authorizing entry points call governed_consume() so that the evidence they consume IS
    the parse of the bytes this check validated (v1.15, V114-B1)."""
    return governed_consume(governed, active)[0]

EVIDENCE_SET_SCHEMA_ID = "vidtoolz.resolveEvidenceSet.v1.12"
# The SCHEMA-REGISTRY.json key (file stem) under which that schema is pinned. v1.15 (V114-B1) schema-validates the
# governed document inside the canonical loader and on every authorizing consume, so the bytes that authorize are
# known to satisfy the pinned schema and not merely to parse.
EVIDENCE_SET_REGISTRY_KEY = "resolveEvidenceSet"
EVIDENCE_AUTHORING_MODULE = "tools/evidence_authoring.py"
PREPARER_TOOL = "tools/a2_prepare.py"
VERIFIER_TOOL = "tools/a2_verify.py"


def principal_role(pid):
    """The role a principal id belongs to, or None. A principal id is exactly '<ROLE>:<actor>'."""
    if not isinstance(pid, str) or pid.count(":") != 1:
        return None
    role, _actor = pid.split(":", 1)
    return role if role in PRINCIPAL_REGISTRY and pid in PRINCIPAL_REGISTRY[role] else None


def principal_actor(pid):
    """The actor half of a principal id. Role separation is enforced on the ACTOR, not on the label."""
    return pid.split(":", 1)[1] if isinstance(pid, str) and pid.count(":") == 1 else None


def principal_errors(pid, role):
    """A principal is valid for a role only if it is registered under exactly that role."""
    if not isinstance(pid, str) or not pid:
        return [f"principal must be a non-empty string, got {pid!r}"]
    if role not in PRINCIPAL_REGISTRY:
        return [f"unknown role {role!r}"]
    if principal_role(pid) != role:
        return [f"{pid!r} is not a registered {role} principal"]
    return []


def role_separation_errors():
    """Static law: no ACTOR id may appear in more than one role, or the inequality rule is defeatable by labelling."""
    seen, errs = {}, []
    for role, pids in sorted(PRINCIPAL_REGISTRY.items()):
        for pid in pids:
            a = principal_actor(pid)
            if a in seen and seen[a] != role:
                errs.append(f"actor {a!r} holds both {seen[a]} and {role}")
            seen[a] = role
    return errs


def may_write(state, role, record_type):
    """The frozen (state, role) -> record types grant. Everything else is refused."""
    return record_type in (EVIDENCE_SET_STATE_GRANTS.get(state, {}) or {}).get(role, ())

EVIDENCE_STORE_AUTHORITY_CLASS = "EVIDENCE_STORE_AUTHORIZING"
TRUSTED_SHIM_FILE = "TRUSTED-SHIM.json"
MECHANICAL_OUTCOMES = ("RETURNED", "RAISED", "TIMEOUT", "ATTRIBUTE_MISSING", "TRANSPORT_FAILURE", "REFUSED", "UNSERIALIZABLE")
FORBIDDEN_RAW_FIELDS = ("success", "qualified", "reviewed", "expected_type_match", "classification", "parse", "parsed_observation", "result", "decision", "promotion", "promoted", "shape_ok", "observed_type")
DERIVED_CLASSES = ("SUCCESS", "EXCEPTION", "TIMEOUT", "UNSUPPORTED", "MALFORMED", "BINDING_MISMATCH", "SHIM_UNTRUSTED", "RECEIVER_MISMATCH", "ARGS_MISMATCH", "TYPE_MISMATCH", "NULL_NOT_ALLOWED", "TRUNCATED", "TRANSPORT_FAILURE", "REFUSED", "UNSERIALIZABLE")
DERIVED_FAMILY = {"SUCCESS": "SUCCESS", "EXCEPTION": "EXCEPTION", "TIMEOUT": "TIMEOUT", "UNSUPPORTED": "UNSUPPORTED", "MALFORMED": "MALFORMED", "TRANSPORT_FAILURE": "TRANSPORT_FAILURE", "BINDING_MISMATCH": "FATAL_TARGET_FAILURE", "SHIM_UNTRUSTED": "FATAL_TARGET_FAILURE",
                  "RECEIVER_MISMATCH": "FAILURE", "ARGS_MISMATCH": "FAILURE", "TYPE_MISMATCH": "FAILURE", "NULL_NOT_ALLOWED": "FAILURE", "TRUNCATED": "FAILURE", "REFUSED": "FAILURE", "UNSERIALIZABLE": "FAILURE"}
EXPECTATION_STATUSES = ("DOCUMENTED_HYPOTHESIS", "PROBE_VALIDATED", "FROZEN")
SHAPE_RULES = ("NONE", "NON_EMPTY")
COMPLETENESS_RULES = ("COMPLETE", "PARTIAL_OK")
ARG_TYPES = ("str", "int", "bool", "float")
RECEIVER_CLASSES = ("Resolve", "ProjectManager", "Project", "MediaPool", "Folder", "Timeline", "TimelineItem", "MediaPoolItem")
REVIEW_DECISIONS = ("ACCEPT", "REJECT", "DEFER")
PROMOTION_STATES = ("CANDIDATE", "REVIEWED_ACCEPTED", "REVIEWED_REJECTED", "PROMOTED_IN_REFREEZE", "ACTIVE_QUALIFIED_READ")
PROMOTION_TRANSITIONS = {"CANDIDATE": {"REVIEWED_ACCEPTED", "REVIEWED_REJECTED"}, "REVIEWED_ACCEPTED": {"PROMOTED_IN_REFREEZE"}, "REVIEWED_REJECTED": set(), "PROMOTED_IN_REFREEZE": {"ACTIVE_QUALIFIED_READ"}, "ACTIVE_QUALIFIED_READ": set()}
WRITE_LIKE_PREFIXES = ("Set", "Create", "Delete", "Remove", "Add", "Import", "Export", "Append", "Insert", "Replace", "Relink", "Unlink", "Move", "Close", "Save", "Load", "Start", "Run", "Execute", "Duplicate", "Refresh", "Update", "Finalize", "Select", "Link", "Open", "Apply", "Grab", "Stop", "Play", "Cut", "Copy", "Paste", "Lock", "Unlock", "Clear", "Reset", "Rename")
SCRIPT_TOOLS = ("run_script", "run_script_unsafe", "execute_python", "execute_lua", "StartRendering", "AddRenderJob")
M0_PHASES = ("M0A_PROBE", "M0B_REVIEW", "M0C_REFREEZE", "M0D_QUALIFIED_READ")
# protected-surface EXCLUSIONS (F15-05, honest narrowing): these item domains are NOT observed, NOT compared and NOT covered by any zero-unintended-change claim at v1.6
PROTECTED_SURFACE_EXCLUSIONS = ("item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes")
F64_RE = re.compile(r"[0-9a-f]{16}")
RATIONAL_RE = re.compile(r"(0|[1-9][0-9]*)/([1-9][0-9]*)")
SHA_RE = re.compile(r"[a-f0-9]{64}")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
OBS_STATUS = ("OBSERVED", "UNAVAILABLE", "UNSUPPORTED", "ERROR", "NOT_REQUESTED")
STATUS_RANK = {"OBSERVED": 0, "UNAVAILABLE": 1, "UNSUPPORTED": 2, "ERROR": 3, "NOT_REQUESTED": 4}
ITEM_STATUS_FIELDS = ("unique_id", "name", "start", "end", "duration", "enabled", "media_pool_item_unique_id", "media_id", "source_start", "source_end")
TIMELINE_STATUS_FIELDS = ("unique_id", "name", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "is_current", "settings")
PROJECT_STATUS_FIELDS = ("unique_id", "name", "last_modified_time")
TRACK_STATUS_FIELDS = ("name", "enabled", "locked")
# which primitive produces which observed field (OBSERVED requires the primitive to be callable in the collecting session)
FIELD_PRIMITIVE = {
    "timeline.unique_id": ["Timeline.GetUniqueId"], "timeline.name": ["Timeline.GetName"], "timeline.start_frame": ["GetStartFrame"], "timeline.end_frame": ["GetEndFrame"], "timeline.start_timecode": ["GetStartTimecode"], "timeline.fps": ["Timeline.GetSettings"], "timeline.width": ["Timeline.GetSettings"], "timeline.height": ["Timeline.GetSettings"], "timeline.is_current": ["GetCurrentTimeline"], "timeline.settings": ["Timeline.GetSettings"],
    "project.unique_id": ["Project.GetUniqueId"], "project.name": ["Project.GetName"], "project.last_modified_time": ["GetProjectLastModifiedTime"],
    "track.name": ["GetTrackName"], "track.enabled": ["GetIsTrackEnabled"], "track.locked": ["GetIsTrackLocked"],
    "item.unique_id": ["TimelineItem.GetUniqueId"], "item.name": ["TimelineItem.GetName"], "item.start": ["GetStart"], "item.end": ["GetEnd"], "item.duration": ["GetDuration"], "item.enabled": ["GetClipEnabled"], "item.media_pool_item_unique_id": ["GetMediaPoolItem", "MediaPoolItem.GetUniqueId"], "item.media_id": ["GetMediaPoolItem", "MediaPoolItem.GetMediaId"], "item.source_start": ["GetSourceStartFrame"], "item.source_end": ["GetSourceEndFrame"],
}
DOMAIN_PRIMITIVE = {"tracks": ["GetTrackCount"], "items": ["GetItemListInTrack"], "markers": ["GetMarkers"], "settings": ["Timeline.GetSettings", "Project.GetSettings"], "track_locks": ["GetIsTrackLocked"], "item_identity": ["TimelineItem.GetUniqueId"], "item_source_bounds": ["GetSourceStartFrame", "GetSourceEndFrame"]}
KNOWN_DOMAINS = {"connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy", "grades", "fusion_graphs", "caches", "nested_timelines", "keyframe_curves", "item_properties", "fades", "speed", "takes", "linked_items", "unowned_media_hashes", "render_queue"}
COVERAGE_PROFILES = {
    "MINIMAL_M0": {"mandatory_domains": ["connection", "library", "project", "timeline"], "mandatory_item_fields": [], "mandatory_timeline_fields": [], "identity_required": [], "track_locks_required": False, "guard_required": False},
    "FULL_TIMELINE_READ": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "markers", "settings"], "mandatory_item_fields": ["start", "end", "enabled"], "mandatory_timeline_fields": ["name", "start_frame", "end_frame", "fps", "width", "height"], "identity_required": ["timeline.unique_id"], "track_locks_required": False, "guard_required": False},
    "WRITE_PRECHECK": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "mandatory_item_fields": ["start", "end", "enabled", "unique_id", "media_pool_item_unique_id", "source_start", "source_end"], "mandatory_timeline_fields": ["name", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "is_current", "settings"], "identity_required": ["project.unique_id", "timeline.unique_id"], "track_locks_required": True, "guard_required": True},
    "APPEND_VERIFY": {"mandatory_domains": ["connection", "library", "project", "timeline", "tracks", "items", "item_identity", "item_source_bounds", "markers", "settings", "track_locks", "adapter_bin_media", "guard", "policy"], "mandatory_item_fields": ["start", "end", "enabled", "unique_id", "media_pool_item_unique_id", "source_start", "source_end"], "mandatory_timeline_fields": ["name", "start_frame", "end_frame", "fps", "width", "height", "settings"], "identity_required": ["project.unique_id", "timeline.unique_id"], "track_locks_required": True, "guard_required": True},
}
PROFILE_KEYS = ("mandatory_domains", "mandatory_item_fields", "mandatory_timeline_fields", "identity_required")
S0_REQUIRED_PROFILE = "WRITE_PRECHECK"
PLAN_VALIDATOR_ID = "tools/authority_lib.py#validate_transaction_set"
OPERATION_VERIFY_PROFILE = {"APPEND": "APPEND_VERIFY", "DELETE": None, "DISABLE": None, "ENABLE": None, "UPSERT_MARKER": None, "SET_TAKE": None, "SET_PROPERTIES": None, "IMPORT_MEDIA": None, "CHECKPOINT_DUPLICATE": None, "CHECKPOINT_EXPORT_DRT": None, "SAVE_PROJECT": None}
OBSERVATION_CLASSES = ("QUALIFIED_OBSERVATION", "CANDIDATE_OBSERVATION", "NOT_CALLABLE")
# protected observation surface for transaction verification (S0 vs S1); anything here that changes without an explaining plan operation is UNRELATED
PROTECTED_ITEM_FIELDS = ("track_type", "track_index", "start", "end", "duration", "enabled", "media_pool_item_unique_id", "media_id", "source_start", "source_end", "source_sha256", "source_locator", "source_status", "name", "provenance_kind", "markers")
PROTECTED_TIMELINE_FIELDS = ("unique_id", "name", "start_frame", "end_frame", "start_timecode", "fps", "width", "height", "settings")
UNPROTECTED_TIMELINE_FIELDS = ("is_current", "duration_convention")
PROTECTED_TRACK_FIELDS = ("name", "enabled", "locked")
EXPECTED_TYPES = ("str", "int", "bool", "float", "list", "dict", "object")
AUTHORITY_SURFACE = {
    # v1.14 (V113-B1): derive_attachment_state and evaluate_eligibility are NO LONGER authorizing. They are the
    # semantic derivation only and cannot establish where the evidence came from. Authorizing readiness and
    # eligibility are reachable exclusively through the governed loader and the *_authorizing entry points, which
    # re-verify the location receipt against the real filesystem before any semantic work.
    # v1.15 (V114-B2): validate_transaction_set and commit_eligibility are NO LONGER authorizing either. They consume
    # a bare evidence dict, so they cannot establish governed provenance; the authorizing transaction and commit
    # entry points require a GovernedEvidenceSet and route plan-time eligibility through the authorizing gate.
    "authorizing": [
        "load_governed_evidence_set", "derive_attachment_state_authorizing", "derive_attachment_state_for_session",
        "evaluate_eligibility_authorizing", "evaluate_eligibility_for_session", "location_errors",
        "governed_provenance_errors", "governed_consume", "governed_structure_errors", "location_receipt",
        "evidence_snapshot_digest",
        "validate_transaction_set_authorizing", "commit_eligibility_authorizing",
        # v1.12: the production evidence-set authoring and verification entry points. Unlike v1.11, where the
        # only record constructor was tools/fixture_evidence.py ("never an authority"), these are normative,
        # executable and role-permissioned (tools/evidence_authoring.py, tools/a2_prepare.py, tools/a2_verify.py).
        "evidence_set_create", "evidence_set_add_provisioning", "evidence_set_add_launch_recipe",
        "evidence_set_mark_prepared", "evidence_set_add_bundle_verification",
        "evidence_set_derive_attachment_state", "principal_errors", "may_write",
        "primitive_status", "callable_method_set", "promotion_state",
                    "internal_schema_errors", "schema_registry", "trusted_capture_shim", "resolve_stored_chain", "ingest_raw_frame", "session_manifest_errors"],
    "internal_non_authorizing": ["governed_file_errors", "read_governed_file", "derive_delta_errors", "journal_applied_ops", "journal_head", "semantic_mutation_plan", "semantic_journal", "semantic_verification_result", "semantic_conflict", "semantic_commit_manifest", "semantic_snapshot", "verify_transaction", "derive_delta", "occurrence_index", "expected_effects", "guard_lineage_errors", "journal_readback", "profile_satisfies", "required_s1_profile",
                                 "capability_qualification", "derive_capability_result", "semantic_raw_capture", "semantic_review_decision", "semantic_refreeze_record", "semantic_derived_result_record", "semantic_identity_observation", "identity_claims", "guard_record_errors", "active_authority_errors", "capability_matrix_digest", "primitive_spec_digest", "primitive_spec", "codec_errors", "codec_broad_type", "codec_contains_elision", "raw_capture_digest", "raw_capture_digest_ok", "promotion_step", "classification_family",
                                 "validate_transaction_set_diagnostic", "historical_schema_errors", "compute_schema_registry", "compute_trusted_capture_shim", "canon_reference", "canon_string_reference",
                                 "content_digest", "content_key", "clear_authority_caches", "authority_cache_stats", "supersession_resolve", "stored_chain_digest", "identity_claim_inputs",
                                 "identity_claim_input_errors", "strict_parse_raw_frame", "raw_ingest_receipt", "ingest_receipt_errors", "capture_shim_trust_errors", "shim_allowlist",
                                 "shim_allowlist_digest", "schema_registry_digest", "trusted_shim_digest", "read_primitive_authority_digest", "evidence_set_digest", "parser_sha256"],
    # v1.14: DEMOTED from authorizing by V113-B1. Semantic derivation only; no location authority.
    "diagnostic_non_authorizing": ["derive_attachment_state", "evaluate_eligibility"],
    # v1.15: DEMOTED from authorizing by V114-B2. Composed transaction/commit validation over a bare evidence
    # dict: every stage law is unchanged, but without governed provenance the result is not write authority.
    "provisional_until_m3_non_authorizing": ["validate_transaction_set", "commit_eligibility"],
}
ATTACHMENT_STATES = ["UNPROVISIONED", "PROVISIONED_NOT_VERIFIED", "ATTACHMENT_READY", "ATTACHED_READ_ONLY", "SCRATCH_WRITE_READY"]
CONFLICT_STATE = "CONFLICT"
STATE_RANK = {s: i for i, s in enumerate(ATTACHMENT_STATES)}
STATE_RANK[CONFLICT_STATE] = -1
RECORD_TYPES = {"PROVISIONING_RECORD", "LAUNCH_RECIPE", "BUNDLE_VERIFICATION", "CONNECTION_OBSERVATION", "PROJECT_BINDING_OBSERVATION", "TIMELINE_BINDING_OBSERVATION", "OPERATOR_PROVISIONED_PROJECT", "RAW_CAPABILITY_CAPTURE", "DERIVED_CAPABILITY_RESULT", "REVIEW_DECISION", "RAW_EVIDENCE", "REFREEZE_RECORD", "IDENTITY_UNIQUENESS_OBSERVATION", "IDENTITY_STABILITY_OBSERVATION", "MILESTONE_EXIT", "M3_AUTHORIZATION", "JOURNAL_PREPARED", "READ_ONLY_JOURNAL", "EXCLUSIVE_SESSION_ATTESTATION", "GUARD_SNAPSHOT", "PLAN_VALIDATION", "MEDIA_CLASS_ATTESTATION", "DESTINATION_TIMELINE"}
RETIRED_RECORD_TYPES = ("CAPABILITY_EVIDENCE",)
ENVELOPE_LEVEL = {"BUNDLE_VERIFICATION": "BUNDLE", "MILESTONE_EXIT": "BUNDLE", "M3_AUTHORIZATION": "BUNDLE", "REFREEZE_RECORD": "BUNDLE", "PLAN_VALIDATION": "BUNDLE", "MEDIA_CLASS_ATTESTATION": "BUNDLE", "REVIEW_DECISION": "BUNDLE", "DERIVED_CAPABILITY_RESULT": "BUNDLE",
                  "PROVISIONING_RECORD": "LIBRARY", "OPERATOR_PROVISIONED_PROJECT": "LIBRARY",
                  "LAUNCH_RECIPE": "SESSION", "CONNECTION_OBSERVATION": "SESSION", "PROJECT_BINDING_OBSERVATION": "SESSION", "TIMELINE_BINDING_OBSERVATION": "SESSION", "RAW_CAPABILITY_CAPTURE": "SESSION", "RAW_EVIDENCE": "SESSION", "IDENTITY_UNIQUENESS_OBSERVATION": "SESSION", "IDENTITY_STABILITY_OBSERVATION": "SESSION", "JOURNAL_PREPARED": "SESSION", "READ_ONLY_JOURNAL": "SESSION", "EXCLUSIVE_SESSION_ATTESTATION": "SESSION", "GUARD_SNAPSHOT": "SESSION", "DESTINATION_TIMELINE": "SESSION"}
ENVELOPE_REQUIRED = {"BUNDLE": ["authority_version", "manifest_sha256", "host_name"], "LIBRARY": ["authority_version", "manifest_sha256", "host_name", "library_name", "library_uuid", "library_root"], "SESSION": ["authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id"]}
PROJECT_SCOPED = {"PROJECT_BINDING_OBSERVATION", "TIMELINE_BINDING_OBSERVATION", "GUARD_SNAPSHOT", "DESTINATION_TIMELINE", "JOURNAL_PREPARED", "IDENTITY_UNIQUENESS_OBSERVATION", "IDENTITY_STABILITY_OBSERVATION"}
TIMELINE_SCOPED = {"TIMELINE_BINDING_OBSERVATION", "GUARD_SNAPSHOT", "DESTINATION_TIMELINE", "IDENTITY_UNIQUENESS_OBSERVATION", "IDENTITY_STABILITY_OBSERVATION"}
ENVELOPE_FIELDS = ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id", "project_name", "project_unique_id", "timeline_name", "timeline_unique_id", "target_epoch", "sequence", "captured_at", "record_type_version")
COHERENCE_FIELDS = ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "library_name", "library_uuid", "library_root", "session_id", "provisioning_id")
TARGET_REQUIREMENTS = ("SESSION", "PROJECT", "PROJECT_TIMELINE")
FIXTURE_LAYERS = ("none", "parse", "schema", "evidence-binding", "attachment", "capability", "snapshot", "semantic", "eligibility", "linked-set")
# v1.6: the probe never classifies; these are the DERIVED classes (reference parser) that a review/refreeze may encounter, grouped by consequence
PROBE_FAILURE_TAXONOMY = {"CAPABILITY_FAILURE": ["EXCEPTION", "TIMEOUT", "UNSUPPORTED", "MALFORMED", "RECEIVER_MISMATCH", "ARGS_MISMATCH", "TYPE_MISMATCH", "NULL_NOT_ALLOWED", "TRUNCATED", "TRANSPORT_FAILURE", "REFUSED", "UNSERIALIZABLE"], "FATAL_TARGET_FAILURE": ["BINDING_MISMATCH", "SHIM_UNTRUSTED", "WRONG_HOST", "WRONG_LIBRARY", "WRONG_LIBRARY_UUID", "WRONG_LIBRARY_ROOT", "STALE_SESSION", "CONFLICTING_TARGET", "WRONG_MANIFEST", "WRONG_AUTHORITY_VERSION", "WRONG_RESOLVE_VERSION"]}
WRITE_OPS = {"IMPORT_MEDIA", "APPEND", "DELETE", "DISABLE", "ENABLE", "SET_TAKE", "UPSERT_MARKER", "SET_PROPERTIES", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT", "SAVE_PROJECT"}
GUARD_REQUIRED_OPS = WRITE_OPS - {"IMPORT_MEDIA"}
EFFECT_SPECIFIED_OPS = {"APPEND", "DELETE", "DISABLE", "ENABLE", "UPSERT_MARKER"}
PREREQ_CODES = {
    "BUNDLE_INDEPENDENTLY_VERIFIED", "TARGET_STATE_ATTACHMENT_READY", "TARGET_STATE_ATTACHED_READ_ONLY", "TARGET_STATE_SCRATCH_WRITE_READY",
    "HOST_MATCHES_CONTRACT", "LIBRARY_NOT_SHARED", "LIBRARY_MATCHES_CONTRACT", "RESOLVE_VERSION_MATCHES", "M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE",
    "MIKKO_M3_AUTHORIZATION", "JOURNAL_PREPARED", "READ_ONLY_JOURNAL_OPEN", "GUARD_CURRENT", "EXCLUSIVE_SESSION_ATTESTED", "PROJECT_ADAPTER_PREFIXED",
    "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED", "PROBE_ALLOWED_PRIMITIVES", "PLAN_VALIDATED", "SYNTHETIC_MEDIA_ONLY", "TIMELINE_IS_DESTINATION", "TARGET_REQUIREMENT_SATISFIED",
}


class CanonError(ValueError):
    pass


class ParseError(ValueError):
    pass


# ------------------------------------------------------------------ strict parse boundary (policy A)
def _no_dup_pairs(pairs):
    seen = set()
    out = {}
    for k, v in pairs:
        if k in seen:
            raise ParseError(f"duplicate JSON key at parse boundary: {k!r}")
        seen.add(k)
        out[k] = v
    return out


def strict_loads(text):
    return json.loads(text, object_pairs_hook=_no_dup_pairs)


def strict_load(path):
    with open(path, "r", encoding="utf-8") as f:
        return strict_loads(f.read())


# ------------------------------------------------------------------ exact syntax helpers (full-string semantics)
def is_sha(s):
    return isinstance(s, str) and SHA_RE.fullmatch(s) is not None


def is_uuid(s):
    return isinstance(s, str) and UUID_RE.fullmatch(s) is not None


def is_abs_path(s):
    return isinstance(s, str) and s.startswith("/") and len(s) > 1 and "/../" not in s and not s.endswith("/..")


def parse_ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def validate_f64(s):
    if not isinstance(s, str) or F64_RE.fullmatch(s) is None:
        raise CanonError("$f64 must be exactly 16 lowercase hex characters, no surrounding whitespace (IEEE-754 binary64 big-endian)")
    bits = int(s, 16)
    if (bits >> 52) & 0x7FF == 0x7FF:
        raise CanonError("$f64 NaN/Infinity rejected")
    if bits == 0x8000000000000000:
        raise CanonError("$f64 negative zero must be normalized to 0000000000000000")
    return s


def validate_rational(s):
    if not isinstance(s, str) or RATIONAL_RE.fullmatch(s) is None:
        raise CanonError("$rational must fully match (0|[1-9][0-9]*)/([1-9][0-9]*) with no surrounding whitespace")
    p, q = (int(x) for x in s.split("/"))
    f = Fraction(p, q)
    if f.numerator != p or f.denominator != q:
        raise CanonError("$rational must be reduced")
    return f


def _num(v):
    if isinstance(v, bool):
        raise CanonError("boolean is not a frame quantity")
    if isinstance(v, int):
        return Fraction(v)
    if isinstance(v, dict) and set(v.keys()) == {"$rational"}:
        return validate_rational(v["$rational"])
    raise CanonError(f"not a numeric quantity: {v!r}")


def _s(v):
    return "" if v is None else str(v)


# ------------------------------------------------------------------ typed ordering (observation-status aware, option A)
def sort_tracks(tracks):
    for t in tracks:
        if t.get("type") not in TRACK_TYPE_ORDER:
            raise CanonError(f"unknown track type {t.get('type')!r}")
        if not isinstance(t.get("index"), int) or isinstance(t.get("index"), bool) or t["index"] < 1:
            raise CanonError(f"track index must be integer >= 1, got {t.get('index')!r}")
    keys = [(TRACK_TYPE_ORDER[t["type"]], t["index"]) for t in tracks]
    if len(set(keys)) != len(keys):
        raise CanonError("duplicate (type,index) track address")
    return sorted(tracks, key=lambda t: (TRACK_TYPE_ORDER[t["type"]], t["index"]))


def _frame_key(it, field):
    st = (it.get("field_status") or {}).get(field, "OBSERVED" if it.get(field) is not None else "UNAVAILABLE")
    if st == "OBSERVED":
        return (0, _num(it[field]))
    return (STATUS_RANK.get(st, 9), Fraction(0))


def item_sort_key(it):
    kind = (it.get("provenance") or {}).get("kind", "OTHER_OBSERVED")
    ordinal = it.get("observation_ordinal")
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0:
        raise CanonError("item.observation_ordinal (position in GetItemListInTrack) is required for total ordering")
    return (_frame_key(it, "start"), _frame_key(it, "end"), ITEM_KIND_ORDER.get(kind, 99), _s(it.get("unique_id")), ordinal)


def sort_items(items):
    keys = [item_sort_key(it) for it in items]
    if len(set(keys)) != len(keys):
        raise CanonError("two items share the full sort key: identity collision")
    ords = [k[4] for k in keys]
    if len(set(ords)) != len(ords):
        raise CanonError("duplicate observation_ordinal within a track")
    return sorted(items, key=item_sort_key)


def marker_sort_key(m):
    return (_s(m.get("object_address")), _num(m["frame"]), _num(m["duration"]), _s(m.get("custom_data")), _s(m.get("name")), _s(m.get("color")), _s(m.get("note")))


def sort_markers(markers):
    addr_frame = [(_s(m.get("object_address")), _num(m["frame"])) for m in markers]
    if len(set(addr_frame)) != len(addr_frame):
        raise CanonError("MARKER_COLLISION: two markers share (object_address, frame)")
    keys = [marker_sort_key(m) for m in markers]
    if len(set(keys)) != len(keys):
        raise CanonError("MARKER_COLLISION: exact duplicate marker records")
    return sorted(markers, key=marker_sort_key)


def sort_media_dependencies(deps):
    keys = [(_s(d.get("logical_locator")), _s(d.get("source_sha256"))) for d in deps]
    if len(set(keys)) != len(keys):
        raise CanonError("duplicate media dependency record")
    return sorted(deps, key=lambda d: (_s(d.get("logical_locator")), _s(d.get("source_sha256"))))


def normalize_snapshot_payload(payload):
    p = json.loads(json.dumps(payload))
    p["tracks"] = sort_tracks(p.get("tracks", []))
    for t in p["tracks"]:
        t["items"] = sort_items(t.get("items", []))
        for it in t["items"]:
            it["markers"] = sort_markers(it.get("markers", []))
    p["markers"] = sort_markers(p.get("markers", []))
    p["media_dependencies"] = sort_media_dependencies(p.get("media_dependencies", []))
    p["observation_failures"] = sorted(p.get("observation_failures", []), key=lambda f: (_s(f.get("track_address")), f.get("observation_ordinal") if isinstance(f.get("observation_ordinal"), int) else -1, _s(f.get("reason"))))
    return p


# ------------------------------------------------------------------ canonical text + digests
_CANON_TR = {0x22: '\\"', 0x5C: "\\\\", 0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r"}
for _i in range(0x20):
    _CANON_TR.setdefault(_i, "\\u%04x" % _i)


def canon_string_reference(v):
    """INTERNAL_NON_AUTHORIZING. The v1.5/v1.6 canonical string escaper, character by character. Retained verbatim as the reference: validate_v1_19.py
    proves canon() produces byte-identical output to canon_reference() over the whole bundle plus an adversarial corpus."""
    out = ['"']
    for ch in v:
        o = ord(ch)
        if 0xD800 <= o <= 0xDFFF:
            raise CanonError("lone surrogate")
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif o == 8:
            out.append("\\b")
        elif o == 9:
            out.append("\\t")
        elif o == 10:
            out.append("\\n")
        elif o == 12:
            out.append("\\f")
        elif o == 13:
            out.append("\\r")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canon_reference(v):
    """INTERNAL_NON_AUTHORIZING. The v1.5/v1.6 canonicalizer, unchanged. canon() must equal this for every value; the validator proves it."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, int):
        if not (-(2 ** 53 - 1) <= v <= 2 ** 53 - 1):
            raise CanonError("integer outside safe range")
        return str(v)
    if isinstance(v, float):
        raise CanonError("bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'}")
    if isinstance(v, str):
        return canon_string_reference(v)
    if isinstance(v, list):
        return "[" + ",".join(canon_reference(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = list(v.keys())
        if len(set(keys)) != len(keys):
            raise CanonError("duplicate keys")
        if set(keys) == {"$rational"}:
            validate_rational(v["$rational"])
        if set(keys) == {"$f64"}:
            validate_f64(v["$f64"])
        return "{" + ",".join(canon_reference(k) + ":" + canon_reference(v[k]) for k in sorted(keys)) + "}"
    raise CanonError(f"unsupported type {type(v)}")


def canon(v):
    """CANONICALIZATION_VERSION 1.5 canonical text. v1.7 changes only the implementation: str.translate replaces the
    per-character loop and duplicate keys are detected on the canonicalized key strings (a strictly stronger check, since a
    Python dict cannot hold two equal keys but two distinct keys could in principle canonicalize alike). Output is
    byte-identical to canon_reference() and the validator proves it over the whole bundle and an adversarial corpus."""
    t = type(v)
    if t is str:
        if not v.isascii():
            try:
                v.encode("utf-8")
            except UnicodeEncodeError:
                raise CanonError("lone surrogate")
        return '"' + v.translate(_CANON_TR) + '"'
    if t is bool:
        return "true" if v else "false"
    if v is None:
        return "null"
    if t is int:
        if not (-(2 ** 53 - 1) <= v <= 2 ** 53 - 1):
            raise CanonError("integer outside safe range")
        return str(v)
    if t is float:
        raise CanonError("bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'}")
    if t is list:
        return "[" + ",".join([canon(x) for x in v]) + "]"
    if t is dict:
        if len(v) == 1:
            k0 = next(iter(v))
            if k0 == "$rational":
                validate_rational(v[k0])
            elif k0 == "$f64":
                validate_f64(v[k0])
        parts = []
        prev = None
        for k in sorted(v):
            ck = canon(k)
            if ck == prev:
                raise CanonError("duplicate keys")
            prev = ck
            parts.append(ck + ":" + canon(v[k]))
        return "{" + ",".join(parts) + "}"
    if v is True or v is False:
        return "true" if v else "false"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return canon(int(v))
    if isinstance(v, str):
        return canon(str(v))
    if isinstance(v, float):
        raise CanonError("bare float forbidden; use {'$rational':'p/q'} or {'$f64':'hex16'}")
    if isinstance(v, list):
        return canon(list(v))
    if isinstance(v, dict):
        return canon(dict(v))
    raise CanonError(f"unsupported type {type(v)}")


def digest(obj, domain):
    if domain not in HASH_DOMAINS:
        raise CanonError(f"unregistered hash domain {domain!r}")
    return hashlib.sha256(domain.encode("utf-8") + b"\n" + canon(obj).encode("utf-8")).hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ v1.7 authority caching law (Codex v1.6 BLOCKER C16-B1)
# No authority cache in this module may be keyed on Python object identity, mutable dict identity, a process-local
# reference or a caller container. Every cache below is keyed ONLY by content digests of the inputs plus AUTHORITY_VERSION,
# so mutating any input in place necessarily misses the cache and a warm result can never differ from a cold one.
CACHE_LIMIT = 4096
_QUAL_CACHE = {}
_CALLABLE_CACHE = {}
_SPEC_CACHE = {}
_PARSER_SHA = {}
_SHIM_AUTHORITY = {}
_REGISTRY_CACHE = {}
_AUTHORITY_CACHES = {"qualification": _QUAL_CACHE, "callable_set": _CALLABLE_CACHE, "primitive_spec_digest": _SPEC_CACHE,
                     "parser_identity": _PARSER_SHA, "trusted_shim": _SHIM_AUTHORITY, "schema_registry": _REGISTRY_CACHE}


def clear_authority_caches():
    """INTERNAL_NON_AUTHORIZING. Drop every content-keyed cache. Calling this can never change a result: it only removes
    memoized values that are pure functions of input content. The validator asserts warm == cold for every attack."""
    for d in _AUTHORITY_CACHES.values():
        d.clear()


def authority_cache_stats():
    """INTERNAL_NON_AUTHORIZING. {cache name: entry count}, for cache-pollution assertions in the validator."""
    return {k: len(v) for k, v in sorted(_AUTHORITY_CACHES.items())}


def _cache_put(d, key, value):
    if len(d) >= CACHE_LIMIT:
        d.clear()
    d[key] = value
    return value


def content_digest(obj):
    """INTERNAL_NON_AUTHORIZING. Content digest of an arbitrary JSON-shaped value, used ONLY as an authority-cache key (v1.7, C16-B1).
    Deterministic sha256 over a domain tag and a sorted-key, minimal-separator UTF-8 JSON serialization. It is NOT a
    canonical authority digest: it is never recorded, published, compared against a stored digest or used to authorize
    anything. Its only job is to make every cache key a pure function of input content. Returns None when the value is
    not serializable, and a None key disables caching for that call (fail-closed: recompute)."""
    try:
        return hashlib.sha256(CONTENT_KEY_DOMAIN.encode("utf-8") + b"\n" + json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
    except (TypeError, ValueError):
        return None


def content_key(caps, rp, es, env, active, extra=None):
    """INTERNAL_NON_AUTHORIZING. The one content-only key for every derived-authority cache: AUTHORITY_VERSION plus the content digests of the
    capability matrix, the read-primitive authority, the evidence set, the contract environment and the active authority,
    plus the identity of the reference parser and the trusted capture shim. Returns None if any part is unserializable."""
    parts = [AUTHORITY_VERSION, content_digest(caps), content_digest(rp), content_digest(es), content_digest(env), content_digest(active), parser_sha256(), trusted_shim_digest(), extra]
    if any(p is None for p in parts[1:6]):
        return None
    return tuple(parts)


def snapshot_payload_digest(payload):
    return digest(normalize_snapshot_payload(payload), "vidtoolz.resolveSnapshotPayload.v1.5")


def _ident(obj, fs_key="field_status"):
    fs = obj.get(fs_key) or {}
    return {"unique_id": obj.get("unique_id"), "unique_id_status": fs.get("unique_id"), "unique_id_reason": fs.get("unique_id_reason"), "name": obj.get("name"), "name_status": fs.get("name")}


def guard_object(snapshot):
    """v1.5 guard (v3): identity carries observation status AND reason; the guard binds the snapshot's field-provenance authority
    (digest of collection.method_provenance) and the capability matrix it was collected under."""
    return {"hash_domain": "vidtoolz.resolveGuard.v3", "guard_version": 3, "library": snapshot["library"], "project": _ident(snapshot["project"]), "timeline": _ident(snapshot["payload"]["timeline"]), "target_epoch": snapshot["target_epoch"], "coverage": snapshot["coverage"], "policy": snapshot["policy"], "provenance_sha256": provenance_digest(snapshot), "payload_sha256": snapshot["payload_sha256"]}


def provenance_digest(snapshot):
    return digest((snapshot.get("collection") or {}).get("method_provenance") or {}, "vidtoolz.resolveProvenance.v1")


def guard_digest(snapshot):
    return digest(guard_object(snapshot), "vidtoolz.resolveGuard.v3")


def snapshot_object_digest(snapshot):
    """Digest of the whole snapshot object with its payload in canonical order (the readback identity used by verification)."""
    s = dict(snapshot)
    s["payload"] = normalize_snapshot_payload(snapshot["payload"])
    return digest(s, "vidtoolz.resolveSnapshotObject.v1")


def operation_set_digest(operations):
    return digest(operations, "vidtoolz.resolveOperationSet.v1")


# ------------------------------------------------------------------ evidence records: envelope, content addressing, binding
def record_id(rec):
    body = {k: v for k, v in rec.items() if k != "record_id"}
    return digest(body, "vidtoolz.resolveEvidenceRecord.v1")


def make_record(rec):
    r = dict(rec)
    r["record_id"] = record_id(r)
    return r


def envelope_errors(rec):
    """Structural envelope law: every record binds to the identity envelope required by its level."""
    errs = []
    rt = rec.get("record_type")
    env = rec.get("envelope")
    if not isinstance(env, dict):
        return [f"{rt}: envelope missing"]
    extra = set(env) - set(ENVELOPE_FIELDS)
    if extra:
        errs.append(f"{rt}: unknown envelope fields {sorted(extra)}")
    if env.get("record_type_version") != RECORD_TYPE_VERSION:
        errs.append(f"{rt}: envelope.record_type_version must be {RECORD_TYPE_VERSION}")
    level = ENVELOPE_LEVEL.get(rt)
    for k in ENVELOPE_REQUIRED.get(level, []):
        if env.get(k) in (None, ""):
            errs.append(f"{rt}: envelope.{k} required at level {level}")
    if not is_sha(env.get("manifest_sha256")):
        errs.append(f"{rt}: envelope.manifest_sha256 malformed")
    if env.get("library_uuid") is not None and not is_uuid(env["library_uuid"]):
        errs.append(f"{rt}: envelope.library_uuid malformed")
    if env.get("library_root") is not None and not is_abs_path(env["library_root"]):
        errs.append(f"{rt}: envelope.library_root must be absolute and traversal-free")
    if env.get("provisioning_id") is not None and not is_sha(env["provisioning_id"]):
        errs.append(f"{rt}: envelope.provisioning_id malformed")
    if not isinstance(env.get("sequence"), int) or isinstance(env.get("sequence"), bool) or env["sequence"] < 0:
        errs.append(f"{rt}: envelope.sequence must be a non-negative integer")
    if parse_ts(env.get("captured_at")) is None:
        errs.append(f"{rt}: envelope.captured_at must be ISO-8601")
    if rt in PROJECT_SCOPED and not env.get("project_name"):
        errs.append(f"{rt}: envelope.project_name required")
    if rt in TIMELINE_SCOPED and not env.get("timeline_name"):
        errs.append(f"{rt}: envelope.timeline_name required")
    if env.get("build") is not None and (not isinstance(env["build"], int) or isinstance(env["build"], bool)):
        errs.append(f"{rt}: envelope.build must be integer")
    return errs


def validate_evidence_set(es, active=None):
    """Structural + binding validity. `active` = {authority_version, manifest_sha256, capability_matrix_sha256}: every record must
    bind to the active authority (a BUNDLE_VERIFICATION for another manifest is tolerated only with historical:true and never counts)."""
    errs = []
    if not isinstance(es, dict) or not isinstance(es.get("records"), dict):
        return ["evidence set must be {records: {record_id: record}}"]
    if es.get("current_session_id") is not None and not isinstance(es["current_session_id"], str):
        errs.append("current_session_id must be a string or null")
    if parse_ts(es.get("evaluated_at")) is None:
        errs.append("evaluated_at must be ISO-8601")
    for rid, rec in es["records"].items():
        if not is_sha(rid):
            errs.append(f"record id {rid!r} is not a sha256")
            continue
        if isinstance(rec, dict) and rec.get("record_type") in RETIRED_RECORD_TYPES:
            errs.append(f"{rid[:12]}: record_type {rec['record_type']} is RETIRED in v1.6 (capability evidence is RAW_CAPABILITY_CAPTURE + derived result + review)")
            continue
        if not isinstance(rec, dict) or rec.get("record_type") not in RECORD_TYPES:
            errs.append(f"{rid[:12]}: unknown record_type")
            continue
        if rec.get("record_id") != rid or record_id(rec) != rid:
            errs.append(f"{rid[:12]}: record_id does not match content digest")
        errs += [f"{rid[:12]}: {e}" for e in envelope_errors(rec)]
        if rec.get("record_type") == "RAW_CAPABILITY_CAPTURE":
            errs += [f"{rid[:12]}: {e}" for e in semantic_raw_capture(rec, None, active)[:3]]
        elif rec.get("record_type") == "DERIVED_CAPABILITY_RESULT":
            d = rec.get("derived")
            if not isinstance(d, dict) or not derived_result_digest_ok(d) or d.get("derived_result_sha256") != rec.get("derived_result_sha256") or d.get("parser_version") != PARSER_VERSION:
                errs.append(f"{rid[:12]}: DERIVED_CAPABILITY_RESULT body missing, not re-hashing, mismatched or bound to another parser")
        elif rec.get("record_type") == "REVIEW_DECISION":
            if rec.get("decision") not in REVIEW_DECISIONS or not rec.get("reviewer") or not rec.get("rationale") or not is_sha(rec.get("raw_capture_sha256")) or not is_sha(rec.get("derived_result_sha256")):
                errs.append(f"{rid[:12]}: REVIEW_DECISION requires decision, reviewer, rationale and raw/derived digests")
        elif rec.get("record_type") == "REFREEZE_RECORD":
            if not is_sha(rec.get("capability_matrix_sha256")) or not is_sha(rec.get("parent_capability_matrix_sha256")) or rec.get("parser_version") != PARSER_VERSION or not rec.get("approver"):
                errs.append(f"{rid[:12]}: REFREEZE_RECORD requires parent + successor matrix digests, the active parser version and an approver")
        elif rec.get("record_type") in ("IDENTITY_UNIQUENESS_OBSERVATION", "IDENTITY_STABILITY_OBSERVATION"):
            if not isinstance(rec.get("passes"), list) or not rec["passes"] or not isinstance(rec.get("claims"), dict):
                errs.append(f"{rid[:12]}: identity observation requires pass lists of raw capture digests and recomputed claims")
        elif rec.get("record_type") == "GUARD_SNAPSHOT":
            if not isinstance(rec.get("guard"), dict) or not isinstance(rec.get("method_provenance"), dict) or not is_sha(rec.get("snapshot_object_sha256")):
                errs.append(f"{rid[:12]}: GUARD_SNAPSHOT must carry the guard object, method_provenance and snapshot_object_sha256")
        env = rec.get("envelope") or {}
        if active is not None and isinstance(env, dict):
            hist = rec.get("record_type") == "BUNDLE_VERIFICATION" and rec.get("historical") is True
            if not hist and env.get("manifest_sha256") != active.get("manifest_sha256"):
                errs.append(f"{rid[:12]}: {rec.get('record_type')} bound to manifest {str(env.get('manifest_sha256'))[:12]} != active reviewed manifest")
            if not hist and env.get("authority_version") != active.get("authority_version"):
                errs.append(f"{rid[:12]}: {rec.get('record_type')} bound to authority {env.get('authority_version')} != active {active.get('authority_version')}")
    return sorted(errs)  # deterministic order: the result must not depend on record-map iteration order


def envelope_conflicts(records, fields=COHERENCE_FIELDS):
    """Fields with more than one distinct non-null value across the records: inconsistent records must not compose."""
    out = []
    for f in fields:
        vals = {json.dumps((r.get("envelope") or {}).get(f), sort_keys=True) for r in records if (r.get("envelope") or {}).get(f) is not None}
        if len(vals) > 1:
            out.append(f)
    return out


def find_records(es, rtype, **match):
    """Records of `rtype` matching every field in `match`, whose content still re-hashes to the id they are stored under.
    v1.7 (C16-B1): there is NO index cached on the identity of the evidence-set object. Every call re-reads the mapping and
    re-derives record_id for each candidate from its current content, so a record mutated in place stops resolving
    immediately. Order is by record_id, never by map insertion order."""
    out = []
    for rid, rec in (es or {}).get("records", {}).items():
        if not isinstance(rec, dict) or rec.get("record_type") != rtype:
            continue
        ok = True
        for k, v in match.items():
            if k.startswith("env."):
                ok = ok and (rec.get("envelope") or {}).get(k[4:]) == v
            else:
                ok = ok and rec.get(k) == v
        if ok and record_id(rec) == rid:
            out.append(rec)
    out.sort(key=lambda r: r["record_id"])
    return out


def session_records(es, session_id):
    return [r for r in (es or {}).get("records", {}).values() if (r.get("envelope") or {}).get("session_id") == session_id]


def current_record(es, rtype, session_id, **match):
    """Deterministic CURRENT selection: among records of `rtype` in `session_id` (plus extra field matches) the highest
    envelope.sequence wins; two distinct records sharing the highest sequence => AMBIGUOUS; a record older than
    MAX_OBSERVATION_AGE_S relative to es.evaluated_at is STALE. Map/array order never matters."""
    cands = [r for r in find_records(es, rtype, **match) if (r.get("envelope") or {}).get("session_id") == session_id]
    if not cands:
        return None, "NONE"
    top = max(r["envelope"]["sequence"] for r in cands)
    winners = [r for r in cands if r["envelope"]["sequence"] == top]
    if len(winners) > 1:
        return None, "AMBIGUOUS"
    w = winners[0]
    ev = parse_ts(es.get("evaluated_at"))
    ca = parse_ts(w["envelope"].get("captured_at"))
    if ev and ca and (ev - ca).total_seconds() > MAX_OBSERVATION_AGE_S:
        return None, "STALE"
    if ev and ca and (ca - ev).total_seconds() > 60:
        return None, "FUTURE"
    return w, "CURRENT"


def session_order_errors(es, session_id):
    """Within one session, captured_at must be non-decreasing with envelope.sequence per record type (a later sequence may
    never carry an earlier capture time). Equal sequences are resolved by current_record: two distinct candidates sharing the
    highest sequence are AMBIGUOUS (CONFLICT)."""
    errs = []
    recs = session_records(es, session_id)
    by_type = {}
    for r in recs:
        by_type.setdefault(r["record_type"], []).append(r)
    for rt, rs in by_type.items():
        rs = sorted(rs, key=lambda r: (r["envelope"]["sequence"], r["record_id"]))
        prev = None
        for r in rs:
            ts = parse_ts(r["envelope"]["captured_at"])
            if prev is not None and ts is not None and prev[1] is not None and ts < prev[1] and r["envelope"]["sequence"] > prev[0]:
                errs.append(f"{rt}: captured_at decreases while sequence increases")
            prev = (r["envelope"]["sequence"], ts)
    return errs


def resolve_ref(es, ref, expected_type, envelope=None, extra=None, active=None):
    """A ref is evidence only if it is a sha256, exists, has the expected type, re-hashes, binds to the active authority,
    and matches the required envelope/extra fields."""
    errs = []
    if not is_sha(ref):
        return None, [f"{expected_type}: reference is not a sha256 ({ref!r})"]
    rec = (es or {}).get("records", {}).get(ref)
    if rec is None:
        return None, [f"{expected_type}: referenced record {ref[:12]} not in evidence set"]
    if rec.get("record_type") != expected_type:
        return None, [f"{expected_type}: record {ref[:12]} has type {rec.get('record_type')}"]
    if record_id(rec) != ref:
        return None, [f"{expected_type}: record {ref[:12]} content does not match its id"]
    env = rec.get("envelope") or {}
    if active is not None and (env.get("manifest_sha256") != active.get("manifest_sha256") or env.get("authority_version") != active.get("authority_version")):
        errs.append(f"{expected_type}: record {ref[:12]} not bound to the active authority")
    for k, v in (envelope or {}).items():
        if env.get(k) != v:
            errs.append(f"{expected_type}: record {ref[:12]} envelope.{k}={env.get(k)!r} != {v!r}")
    for k, v in (extra or {}).items():
        if rec.get(k) != v:
            errs.append(f"{expected_type}: record {ref[:12]} {k}={rec.get(k)!r} != {v!r}")
    return (rec if not errs else None), errs


# ------------------------------------------------------------------ attachment state DERIVED from a coherent, current evidence set
def _contract_env(tc):
    return {"host_name": tc["host"]["name"], "product": tc["resolve"]["product"], "resolve_version": f"{tc['resolve']['version']}.{tc['resolve']['build']:04d}", "build": tc["resolve"]["build"], "library_name": tc["library"]["name"]}


def _safe_session_id(governed):
    """The carrier's session id if it has one, else None. Never dereferences unsafely: V114-M1 was a raw
    AttributeError leaking out of a public authorizing boundary from exactly this kind of access."""
    v = getattr(governed, "session_id", None)
    return v if isinstance(v, str) else None


def derive_attachment_state_authorizing(tc, governed, active):
    """THE authorizing attachment derivation (V113-B1).

    Accepts ONLY a GovernedEvidenceSet minted by load_governed_evidence_set, and re-verifies its location receipt
    against the real filesystem BEFORE any semantic work. Precedence is therefore
    LOCATION AUTHORITY -> ATTACHMENT SEMANTICS -> ELIGIBILITY: a forbidden-location evidence set never reaches the
    point of computing ATTACHMENT_READY at all, rather than computing it and being rejected afterwards by a wrapper.

    v1.15 (V114-B1): the semantic evidence it derives from is the value RETURNED by governed_consume - the parse of
    the exact bytes that call just located, read no-follow and digested - and never a field read off the carrier.
    The carrier holds bytes, not a parsed object, so there is nothing to substitute; and a malformed carrier fails
    closed here rather than raising (V114-M1).

    Returns the derivation dict plus authorizing=True, the location receipt, the canonical document path and the
    consumed snapshot digest. On any provenance failure it returns state CONFLICT with authorizing=False and the
    failures, and never a readiness value."""
    errs, es = governed_consume(governed, active)
    if errs:
        return {"state": CONFLICT_STATE, "proofs": {}, "failures": ["LOCATION_AUTHORITY_INVALID"] + errs[:4],
                "conflicts": [], "session_id": _safe_session_id(governed),
                "authorizing": False, "location_receipt": None, "document_path": None,
                "evidence_snapshot_digest": None}
    out = derive_attachment_state(tc, es, active)
    out["authorizing"] = True
    out["location_receipt"] = governed.receipt
    out["document_path"] = governed.document_path
    out["evidence_snapshot_digest"] = governed.evidence_snapshot_digest
    return out


def derive_attachment_state_for_session(session_id, tc, active):
    """Convenience authorizing path: load by canonical session id and derive. The core does its own loading, so no
    caller-parsed evidence-set object participates at all."""
    return derive_attachment_state_authorizing(tc, load_governed_evidence_set(session_id, active), active)


def evaluate_eligibility_authorizing(perms, request, rp, caps, tc, governed, active):
    """THE authorizing eligibility gate (V113-B1). FAIL-CLOSED.

    Accepts ONLY a GovernedEvidenceSet and re-verifies its location receipt first. It never trusts a precomputed
    attachment_state, a raw evidence-set dict, or a diagnostic derivation result: the attachment state it uses is
    recomputed here from the governed document. Absent or invalid location provenance yields eligible=false with
    reason code LOCATION_AUTHORITY_INVALID.

    v1.15 (V114-B1): the evidence it evaluates is the value RETURNED by governed_consume, so the eligibility decision
    is bound to the exact validated bytes; a malformed carrier fails closed rather than raising (V114-M1)."""
    errs, es = governed_consume(governed, active)
    if errs:
        return {"eligible": False, "permitted_by_policy": False, "prerequisites_satisfied": False,
                "derived_attachment_state": None, "authorizing": False, "location_receipt": None,
                "reason_codes": ["LOCATION_AUTHORITY_INVALID"], "errors": errs[:4],
                "evidence_snapshot_digest": None}
    out = evaluate_eligibility(perms, request, rp, caps, tc, es, active)
    out["authorizing"] = True
    out["location_receipt"] = governed.receipt
    out["evidence_snapshot_digest"] = governed.evidence_snapshot_digest
    return out


def evaluate_eligibility_for_session(session_id, perms, request, rp, caps, tc, active):
    """Convenience authorizing path: load by canonical session id and evaluate."""
    return evaluate_eligibility_authorizing(perms, request, rp, caps, tc,
                                            load_governed_evidence_set(session_id, active), active)


def derive_attachment_state(tc, es, active):
    """DIAGNOSTIC / NON-AUTHORIZING attachment derivation (v1.14, V113-B1).

    This is the semantic derivation only. It knows nothing about where the evidence set came from, so it is NOT
    authority: in v1.13 it was declared authorizing and returned ATTACHMENT_READY for a document authored under a
    forbidden root, which is exactly the defect v1.14 corrects. Use it for fixtures, in-memory evidence sets and
    diagnostics. For authority use derive_attachment_state_authorizing() / derive_attachment_state_for_session().

    Never trusts a declared state; never depends on record order. Returns {state, proofs, failures, conflicts, session_id}."""
    out = {"state": "UNPROVISIONED", "proofs": {}, "failures": [], "conflicts": [], "session_id": None}
    ev_errs = validate_evidence_set(es, active)
    if ev_errs:
        out.update(state=CONFLICT_STATE, failures=["EVIDENCE_SET_INVALID"] + ev_errs[:4])
        return out
    C = _contract_env(tc)
    lib = tc["library"]
    if lib["name"] in lib.get("prohibited_library_names", []):
        out["failures"].append("contract library is a prohibited library")
        return out
    provs = [r for r in find_records(es, "PROVISIONING_RECORD", **{"env.host_name": C["host_name"], "env.library_name": lib["name"]}) if r.get("library_kind") == "Disk" and r.get("provisioned_by") and is_uuid(r.get("instance_uuid")) and is_abs_path(r.get("root_path")) and r["envelope"].get("library_uuid") == r["instance_uuid"] and r["envelope"].get("library_root") == r["root_path"]]
    if not provs:
        out["failures"].append("no valid PROVISIONING_RECORD for contract host/library (Disk, uuid, absolute root, provisioned_by, envelope == body)")
        return out
    idents = {(r["instance_uuid"], r["root_path"]) for r in provs}
    if len(idents) > 1:
        out.update(state=CONFLICT_STATE, conflicts=["multiple PROVISIONING_RECORDs with different uuid/root for the contract library"])
        return out
    prov = provs[0]
    out["proofs"]["provisioning"] = prov["record_id"]
    out["state"] = "PROVISIONED_NOT_VERIFIED"
    bundles = [r for r in find_records(es, "BUNDLE_VERIFICATION", **{"env.host_name": C["host_name"]}) if r.get("historical") is not True and r["envelope"].get("manifest_sha256") == active["manifest_sha256"] and r["envelope"].get("authority_version") == active["authority_version"] and r.get("manifest_sha256") == active["manifest_sha256"] and r.get("authority_version") == active["authority_version"] and r.get("verifier") and r.get("verifier") != r.get("prepared_by")
               # ---- v1.12 (V112-4) workflow binding. RESULT: only PASS ever satisfies the gate. PRINCIPALS: both
               # must be registered under exactly their role and must be different ACTORS, so two labels written by
               # one caller no longer satisfy independence. TOCTOU: the bundle names the exact provisioning record it
               # verified, and a record_id is a content digest, so any later edit of that record breaks the binding.
               # PINS: the digest map the verifier computed must equal the contract's own pinned set.
               and r.get("verification_result") == "PASS"
               and principal_role(r.get("verifier_principal")) == "VERIFIER"
               and principal_role(r.get("preparer_principal")) == "PREPARER"
               and principal_actor(r.get("verifier_principal")) != principal_actor(r.get("preparer_principal"))
               and is_sha(r.get("verified_provisioning_id")) and r.get("verified_provisioning_id") == prov["record_id"]
               and is_sha(r.get("verified_launch_recipe_id"))
               and r.get("pinned_file_digests") == tc["resolve"]["pins"]]
    if not bundles:
        out["failures"].append("no independent BUNDLE_VERIFICATION bound to the active reviewed manifest for this host (v1.12: result PASS, registered distinct-actor principals, the exact verified provisioning record and the contract pinned-file digest set)")
    sid = es.get("current_session_id")
    out["session_id"] = sid
    launch = None
    if sid is None:
        out["failures"].append("no current_session_id")
    else:
        ls = [r for r in find_records(es, "LAUNCH_RECIPE", **{"env.session_id": sid, "env.host_name": C["host_name"]}) if is_sha(r.get("recipe_sha256")) and r.get("resolve_version") == C["resolve_version"] and r.get("resolve_binary_sha256") == tc["resolve"]["pins"].get("/opt/resolve/bin/resolve") and r.get("external_scripting_preference") == "Local" and r["envelope"].get("provisioning_id") == prov["record_id"] and r["envelope"].get("library_uuid") == prov["instance_uuid"] and r["envelope"].get("library_root") == prov["root_path"] and r["envelope"].get("library_name") == lib["name"]]
        if len(ls) > 1 and len({r["record_id"] for r in ls}) > 1:
            out.update(state=CONFLICT_STATE, conflicts=["multiple LAUNCH_RECIPEs for the current session"])
            return out
        launch = ls[0] if ls else None
        if launch is None:
            out["failures"].append("no LAUNCH_RECIPE for the current session bound to this provisioning record, contract version, binary pin and Local scripting")
    if out["failures"]:
        return out
    # v1.12 (V112-4): the bundle must name the exact LAUNCH_RECIPE that resolved for this session. Editing the
    # launch recipe after verification changes its record_id and breaks this binding.
    bundles = [b for b in bundles if b.get("verified_launch_recipe_id") == launch["record_id"]]
    if not bundles:
        out["failures"].append("no BUNDLE_VERIFICATION naming the LAUNCH_RECIPE of the current session (v1.12: the verified inputs changed after verification)")
        return out
    out["proofs"]["bundle_verification"] = bundles[0]["record_id"]
    out["proofs"]["launch_recipe"] = launch["record_id"]
    out["proofs"]["verifier_principal"] = bundles[0]["verifier_principal"]
    out["proofs"]["preparer_principal"] = bundles[0]["preparer_principal"]
    # coherence of everything in the current session with the contract, the provisioning record and each other
    srecs = session_records(es, sid)
    conf = envelope_conflicts(srecs)
    for r in srecs:
        e = r["envelope"]
        for k in ("host_name", "product", "resolve_version", "build", "library_name"):
            if e.get(k) is not None and e.get(k) != C[k] and k not in conf:
                conf.append(k)
        if e.get("library_uuid") not in (None, prov["instance_uuid"]) and "library_uuid" not in conf:
            conf.append("library_uuid")
        if e.get("library_root") not in (None, prov["root_path"]) and "library_root" not in conf:
            conf.append("library_root")
        if e.get("provisioning_id") not in (None, prov["record_id"]) and "provisioning_id" not in conf:
            conf.append("provisioning_id")
    conf += session_order_errors(es, sid)
    fatal = [r for r in srecs if r["record_type"] == "RAW_CAPABILITY_CAPTURE" and _capture_binding_conflicts(r, C, active)]
    if fatal:
        conf.append("FATAL_TARGET_FAILURE: raw capability capture(s) in the current session bind to another target/authority: " + ",".join(sorted({",".join(_capture_binding_conflicts(r, C, active)) for r in fatal}))[:200])
    if conf:
        out.update(state=CONFLICT_STATE, conflicts=conf)
        return out
    out["state"] = "ATTACHMENT_READY"
    conn, status = current_record(es, "CONNECTION_OBSERVATION", sid)
    if status == "AMBIGUOUS":
        out.update(state=CONFLICT_STATE, conflicts=["two CONNECTION_OBSERVATIONs share the highest sequence in the current session"])
        return out
    if status in ("STALE", "FUTURE"):
        out["failures"].append(f"latest CONNECTION_OBSERVATION is {status}")
        return out
    if conn is None:
        out["failures"].append("no CONNECTION_OBSERVATION in the current session")
        return out
    cf = []
    if conn.get("db_type") != "Disk":
        cf.append(f"observed db_type {conn.get('db_type')} is not Disk")
    if conn.get("db_name") != lib["name"]:
        cf.append(f"observed database {conn.get('db_name')!r} != contract library")
    if conn.get("db_name") in lib.get("prohibited_library_names", []):
        cf.append("observed database is a prohibited (shared/user) library")
    if conn.get("product") != C["product"] or conn.get("resolve_version") != C["resolve_version"]:
        cf.append(f"observed product/version {conn.get('product')} {conn.get('resolve_version')} != contract")
    if conn.get("root_path") != prov["root_path"]:
        cf.append("observed library root differs from provisioning record (or missing)")
    if conn.get("instance_uuid") != prov["instance_uuid"]:
        cf.append("observed library uuid differs from provisioning record (or missing)")
    if cf:
        out["failures"].append("OBSERVED_TARGET_MISMATCH: " + "; ".join(cf))
        return out
    out["proofs"]["connection"] = conn["record_id"]
    out["state"] = "ATTACHED_READ_ONLY"
    auth = [r for r in find_records(es, "M3_AUTHORIZATION", **{"env.host_name": C["host_name"]}) if r.get("scope") == "SCRATCH_QUALIFICATION_LIBRARY" and r.get("approver") and r.get("authority_version") == active["authority_version"] and r.get("library_name") == lib["name"]]
    excl, est = current_record(es, "EXCLUSIVE_SESSION_ATTESTATION", sid)
    refz = [r for r in find_records(es, "REFREEZE_RECORD") if r.get("reviewed") is True and r.get("kind") == "M0_READ_REQUALIFICATION" and r.get("authority_version") == active["authority_version"] and r.get("capability_matrix_sha256") == active.get("capability_matrix_sha256") and r.get("parser_version") == PARSER_VERSION and r.get("parser_sha256") == parser_sha256()]
    wf = []
    if not auth:
        wf.append("no M3_AUTHORIZATION for scratch scope under the active authority")
    if excl is None or not excl.get("attested_by"):
        wf.append(f"no current EXCLUSIVE_SESSION_ATTESTATION ({est})")
    if not refz:
        wf.append("no reviewed M0_READ_REQUALIFICATION REFREEZE_RECORD for the active capability matrix")
    if wf:
        out["failures"] = wf
        return out
    out["proofs"].update({"m3_authorization": auth[0]["record_id"], "exclusive_session": excl["record_id"], "m0_requalification": refz[0]["record_id"]})
    out["state"] = "SCRATCH_WRITE_READY"
    return out


def semantic_target_contract(tc):
    errs = []
    lib = tc["library"]
    if lib["name"] in lib.get("prohibited_library_names", []):
        errs.append("qualification library name is a prohibited library")
    if tc.get("accepts_current_open_session_as_target") is not False:
        errs.append("target must never accept whatever session is open")
    if tc.get("attachment_state_is_declared") is not False:
        errs.append("attachment state MUST be derived from evidence (attachment_state_is_declared must be false)")
    required_denied = {"SetCurrentDatabase", "CloseProject", "ImportProject", "ReplaceClip", "run_script", "run_script_unsafe", "execute_python", "execute_lua"}
    missing = required_denied - set(tc["denied_calls_all_scopes"])
    if missing:
        errs.append(f"denied_calls_all_scopes missing {sorted(missing)}")
    if lib["provisioning_status"] == "UNPROVISIONED" and (lib["root_path"] is not None or lib["instance_uuid"] is not None):
        errs.append("UNPROVISIONED library must have null root_path/instance_uuid")
    if set(tc.get("attachment_states", {})) != set(ATTACHMENT_STATES) | {CONFLICT_STATE}:
        errs.append("attachment_states must enumerate the five ladder states and CONFLICT")
    return errs


# ------------------------------------------------------------------ v1.6 typed value codec (structural validity of shim-encoded values; no semantics)
CODEC_TAG_TYPES = {"str": "str", "int": "int", "bigint": "int", "bool": "bool", "none": "none", "f64": "float", "f64_nonfinite": "float", "bytes": "bytes", "list": "list", "dict": "dict", "object": "object", "elided": "elided"}


def codec_errors(v, path="$"):
    """INTERNAL_NON_AUTHORIZING. Structural validity of a vidtoolz.resolvePyValue.v1 encoded value. Never interprets meaning."""
    if not isinstance(v, dict) or "$t" not in v or v["$t"] not in CODEC_TAG_TYPES:
        return [f"{path}: bad codec tag"]
    t, errs = v["$t"], []
    if t in ("str", "int", "bool", "bigint", "f64", "f64_nonfinite") and "v" not in v:
        errs.append(f"{path}: {t} missing v")
    if t == "str" and not isinstance(v.get("v"), str):
        errs.append(f"{path}: str v must be a string")
    if t == "int" and (not isinstance(v.get("v"), int) or isinstance(v.get("v"), bool) or not (-(2 ** 53 - 1) <= v.get("v") <= 2 ** 53 - 1)):
        errs.append(f"{path}: int v must be a safe integer")
    if t == "bigint" and not (isinstance(v.get("v"), str) and re.fullmatch(r"-?[0-9]+", v["v"])):
        errs.append(f"{path}: bigint v must be a decimal string")
    if t == "bool" and not isinstance(v.get("v"), bool):
        errs.append(f"{path}: bool v")
    if t == "f64" and not (isinstance(v.get("v"), str) and re.fullmatch(r"[0-9a-f]{16}", v["v"])):
        errs.append(f"{path}: f64 v must be 16 lowercase hex")
    if t == "f64_nonfinite" and v.get("v") not in ("nan", "+inf", "-inf"):
        errs.append(f"{path}: nonfinite tag")
    if t == "bytes" and not (isinstance(v.get("len"), int) and is_sha(v.get("sha256"))):
        errs.append(f"{path}: bytes descriptor")
    if t == "list":
        if v.get("py") not in ("list", "tuple") or not isinstance(v.get("v"), list):
            errs.append(f"{path}: list descriptor")
        for i, x in enumerate(v.get("v") or []):
            errs += codec_errors(x, f"{path}[{i}]")
    if t == "dict":
        if not isinstance(v.get("v"), list):
            errs.append(f"{path}: dict pairs")
        for i, pair in enumerate(v.get("v") or []):
            if not isinstance(pair, list) or len(pair) != 2:
                errs.append(f"{path}.{i}: pair")
            else:
                errs += codec_errors(pair[0], f"{path}.k{i}") + codec_errors(pair[1], f"{path}.v{i}")
    if t == "object" and not (v.get("class") and is_sha(v.get("repr_sha256", ""))):
        errs.append(f"{path}: object descriptor requires class and repr_sha256")
    if t == "elided" and v.get("reason") not in ("depth", "length"):
        errs.append(f"{path}: elision reason")
    return errs


def codec_broad_type(v):
    """INTERNAL_NON_AUTHORIZING."""
    return CODEC_TAG_TYPES.get((v or {}).get("$t"), "unknown") if isinstance(v, dict) else "unknown"


def codec_contains_elision(v):
    """INTERNAL_NON_AUTHORIZING. True when any part of the encoded value was elided or truncated by the shim."""
    if not isinstance(v, dict):
        return False
    if v.get("$t") == "elided" or v.get("truncated") is True:
        return True
    if v.get("$t") == "list":
        return any(codec_contains_elision(x) for x in v.get("v") or [])
    if v.get("$t") == "dict":
        return any(codec_contains_elision(a) or codec_contains_elision(b) for a, b in v.get("v") or [])
    return False


# ------------------------------------------------------------------ v1.6 RAW_CAPABILITY_CAPTURE (facts only; content-addressed)
RAW_CAPTURE_REQUIRED = ("schema", "probe_id", "getter_attempt_id", "sequence", "captured_at", "authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "session_id", "library_uuid", "library_root", "receiver", "method", "args", "outcome", "serialization", "stdout_sha256", "stderr_sha256", "duration_ms", "capture_shim_version", "capture_shim_sha256", "operator", "raw_digest")
OUTCOME_BLOCK = {"RETURNED": "returned", "RAISED": "raised", "TIMEOUT": "timeout_ms", "TRANSPORT_FAILURE": "transport", "REFUSED": "refused", "UNSERIALIZABLE": "unserializable", "ATTRIBUTE_MISSING": None}


def raw_capture_digest(capture):
    """INTERNAL_NON_AUTHORIZING. Content digest of a capture body without its raw_digest field."""
    return digest({k: v for k, v in capture.items() if k != "raw_digest"}, RAW_DOMAIN)


def raw_capture_digest_ok(capture):
    """INTERNAL_NON_AUTHORIZING."""
    return isinstance(capture, dict) and is_sha(capture.get("raw_digest")) and raw_capture_digest(capture) == capture["raw_digest"]


def _capture_structure_errors(c):
    errs = []
    if not isinstance(c, dict):
        return ["capture is not an object"]
    for k in RAW_CAPTURE_REQUIRED:
        if k not in c:
            errs.append(f"capture missing {k}")
    for k in FORBIDDEN_RAW_FIELDS:
        if k in c:
            errs.append(f"capture carries forbidden interpretation field {k!r}")
    if c.get("schema") != RAW_SCHEMA_ID:
        errs.append("capture schema is not the v1.6 raw capture schema")
    oc = c.get("outcome")
    if oc not in MECHANICAL_OUTCOMES:
        errs.append(f"unknown mechanical outcome {oc!r}")
    else:
        need = OUTCOME_BLOCK[oc]
        for o2, blk in OUTCOME_BLOCK.items():
            if blk and blk in c and o2 != oc:
                errs.append(f"outcome {oc} but block {blk!r} present")
        if need and need not in c:
            errs.append(f"outcome {oc} without its {need!r} block")
    if oc == "RETURNED":
        r = c.get("returned")
        if not isinstance(r, dict) or not r.get("python_type") or "value" not in r:
            errs.append("returned block requires python_type and value")
        else:
            errs += ["codec: " + e for e in codec_errors(r["value"])[:3]]
    if oc == "RAISED":
        r = c.get("raised")
        if not isinstance(r, dict) or not r.get("exception_class") or "message" not in r:
            errs.append("raised block requires exception_class and message")
    if oc == "REFUSED" and (not isinstance(c.get("refused"), dict) or c["refused"].get("invoked") is not False):
        errs.append("refused block must record invoked:false")
    rcv = c.get("receiver")
    if not isinstance(rcv, dict) or rcv.get("class") not in RECEIVER_CLASSES or not rcv.get("path"):
        errs.append("receiver requires class (known receiver class) and navigation path")
    if not isinstance(c.get("args"), list):
        errs.append("args must be a list of encoded values")
    else:
        for i, a in enumerate(c["args"]):
            errs += [f"args[{i}] codec: {e}" for e in codec_errors(a)[:1]]
    ser = c.get("serialization")
    if not isinstance(ser, dict) or ser.get("codec") != CODEC or not isinstance(ser.get("truncated"), bool) or not isinstance(ser.get("elided_paths"), list):
        errs.append("serialization block requires codec vidtoolz.resolvePyValue.v1, truncated flag and elided_paths")
    if not is_sha(c.get("capture_shim_sha256")) or not c.get("capture_shim_version"):
        errs.append("capture shim version and sha256 required")
    for k in ("stdout_sha256", "stderr_sha256"):
        if c.get(k) is not None and not is_sha(c.get(k)):
            errs.append(f"{k} must be a sha256 or null")
    if not isinstance(c.get("sequence"), int) or isinstance(c.get("sequence"), bool) or c.get("sequence") < 1:
        errs.append("sequence must be a positive integer")
    if parse_ts(c.get("captured_at")) is None:
        errs.append("captured_at must be ISO-8601")
    if not c.get("operator"):
        errs.append("operator identity required")
    return errs


def _capture_binding_conflicts(rec, env, active):
    """Fields where the capture body disagrees with its envelope, the contract environment or the active authority."""
    c = rec.get("capture") or {}
    e = rec.get("envelope") or {}
    out = []
    for k in ("authority_version", "manifest_sha256", "host_name", "product", "resolve_version", "build", "session_id", "library_uuid", "library_root"):
        if c.get(k) != e.get(k):
            out.append(k)
    if active is not None and (c.get("authority_version") != active.get("authority_version") or c.get("manifest_sha256") != active.get("manifest_sha256")):
        out.append("active_authority")
    if env is not None:
        for k in ("host_name", "product", "resolve_version", "build"):
            if c.get(k) != env.get(k):
                out.append(f"contract.{k}")
    return sorted(set(out))


def semantic_raw_capture(rec, env=None, active=None, rp=None):
    """INTERNAL_NON_AUTHORIZING. Record law for RAW_CAPABILITY_CAPTURE: the capture body is structurally a facts-only capture, its
    raw_digest re-hashes, the record's raw_capture_sha256 names it, and every binding field agrees with the envelope (and, when
    given, the contract environment and the active authority).
    v1.7 adds two admissibility conditions that v1.6 lacked:
      * C16-B3: the capture must carry the identity of the ACTIVE TRUSTED capture shim (version, sha256, codec, raw schema).
        A record produced by any other shim, or by a shim with the right version and the wrong sha, is not evidence.
      * C16-M2: the record must carry a strict-parse receipt binding it to the exact frame bytes it was ingested from
        (ingest_raw_frame). A pre-parsed caller dictionary is not equivalent authority, because a parsed object cannot show
        that duplicate JSON keys, control characters or trailing bytes were ever rejected."""
    errs = []
    c = rec.get("capture")
    errs += _capture_structure_errors(c)
    if isinstance(c, dict) and not raw_capture_digest_ok(c):
        errs.append("capture raw_digest does not re-hash")
    if isinstance(c, dict) and rec.get("raw_capture_sha256") != c.get("raw_digest"):
        errs.append("record raw_capture_sha256 != capture raw_digest")
    if isinstance(c, dict):
        for k in _capture_binding_conflicts(rec, env, active):
            errs.append(f"capture binding {k} disagrees with envelope/contract/active authority")
        errs += ["untrusted capture shim: " + e for e in capture_shim_trust_errors(c, rp)]
        errs += ["raw ingestion: " + e for e in ingest_receipt_errors(rec.get("ingest_receipt"), c)]
    return errs


# ------------------------------------------------------------------ v1.6 primitive spec authority (hypotheses until PROBE_VALIDATED / FROZEN)
SPEC_FIELDS = ("method", "receiver", "arg_types", "nullable", "expected_type", "shape_rule", "completeness", "expectation_status")


def primitive_spec(rp_entry):
    """INTERNAL_NON_AUTHORIZING. The normalized expectation spec of one READ-PRIMITIVES entry (the re-parser's only input besides the capture)."""
    if rp_entry is None:
        return None
    return {k: rp_entry.get(k) for k in SPEC_FIELDS}


def spec_errors(spec):
    errs = []
    if spec is None:
        return ["missing spec"]
    if spec.get("receiver") not in RECEIVER_CLASSES:
        errs.append(f"{spec.get('method')}: receiver {spec.get('receiver')!r} unknown")
    if spec.get("expected_type") not in EXPECTED_TYPES:
        errs.append(f"{spec.get('method')}: expected_type {spec.get('expected_type')!r} invalid")
    if not isinstance(spec.get("arg_types"), list) or any(a not in ARG_TYPES for a in spec.get("arg_types") or []):
        errs.append(f"{spec.get('method')}: arg_types must list {ARG_TYPES}")
    if not isinstance(spec.get("nullable"), bool):
        errs.append(f"{spec.get('method')}: nullable must be boolean")
    if spec.get("shape_rule") not in SHAPE_RULES or spec.get("completeness") not in COMPLETENESS_RULES:
        errs.append(f"{spec.get('method')}: shape_rule/completeness invalid")
    if spec.get("expectation_status") not in EXPECTATION_STATUSES:
        errs.append(f"{spec.get('method')}: expectation_status invalid")
    return errs


def spec_entry_digest(spec):
    return digest(primitive_spec(spec), SPEC_DOMAIN)


def primitive_spec_digest(rp):
    """INTERNAL_NON_AUTHORIZING. Digest of the whole probe primitive-spec authority (sorted by method); bound by reviews and refreezes so
    any change of an expectation invalidates promotions made under the old expectation. v1.7 (C16-B1): memoized ONLY under the
    content digest of the probe primitive list, never under the identity of the authority object, so editing one expectation in
    place changes the key and the digest is recomputed."""
    probe = (rp or {}).get("logical_operations", {}).get("READ_PRIMITIVE_QUALIFICATION_PROBE") or {}
    prims = probe.get("primitives", [])
    ck = content_digest(prims)
    if ck is not None:
        hit = _SPEC_CACHE.get(ck)
        if hit is not None:
            return hit
    specs = sorted((primitive_spec(p) for p in prims), key=lambda s: s["method"])
    out = digest(specs, SPEC_DOMAIN)
    return _cache_put(_SPEC_CACHE, ck, out) if ck is not None else out


def read_primitive_authority_digest(rp):
    """INTERNAL_NON_AUTHORIZING. Canonical content digest of the whole READ-PRIMITIVES authority object."""
    return digest(rp, RP_DOMAIN)


def evidence_set_digest(es):
    """INTERNAL_NON_AUTHORIZING. Canonical content digest of a whole evidence set object (used by refusal messages and by the
    stored-chain resolver to name exactly which evidence set a chain was resolved against)."""
    return digest(es, ES_DOMAIN)


def probe_spec_index(rp):
    probe = (rp or {}).get("logical_operations", {}).get("READ_PRIMITIVE_QUALIFICATION_PROBE") or {}
    return {p["method"]: primitive_spec(p) for p in probe.get("primitives", [])}


# ================================================================== v1.7 TRUST ROOTS (Codex v1.6 BLOCKERS C16-B2, C16-B3)
class AuthorityTrustError(ValueError):
    """A pinned trust root of this bundle (the schema registry or the trusted capture shim) is missing, unreadable or does
    not match the code and bytes it pins. Nothing may be authorized while this is raised: it is a fail-closed refusal."""


def bundle_dir():
    """The bundle directory this authority module belongs to (its own parent). Trust roots are read from here, never from a
    caller-supplied path: a caller may supply artifacts, never the law."""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_bytes(rel):
    with open(os.path.join(bundle_dir(), rel), "rb") as f:
        return f.read()


def _file_sha256(rel):
    return hashlib.sha256(_read_bytes(rel)).hexdigest()


# ------------------------------------------------------------------ trusted capture shim (section 6/7/8)
SHIM_SOURCE_PATH = "tools/capture_shim_reference.py"
TRUSTED_SHIM_FIELDS = ("schema", "authority_version", "shim_version", "shim_sha256", "shim_source_path", "shim_source_sha256",
                       "allowlist_digest", "allowlist_method_count", "codec_version", "raw_schema_version",
                       "raw_ingest_version", "evidence_store_version")


def shim_allowlist(rp):
    """INTERNAL_NON_AUTHORIZING. The ONE static getter allowlist a trusted capture may have been invoked under: every probe-allowed primitive of the
    READ_PRIMITIVE_QUALIFICATION_PROBE, sorted. The shim can never widen it; the authority owns it."""
    probe = (rp or {}).get("logical_operations", {}).get("READ_PRIMITIVE_QUALIFICATION_PROBE") or {}
    return sorted({p["method"] for p in probe.get("primitives", []) if p.get("probe_allowed") is True})


def shim_allowlist_digest(rp):
    """INTERNAL_NON_AUTHORIZING. Canonical content digest of the trusted capture allowlist."""
    return digest(shim_allowlist(rp), SHIM_ALLOWLIST_DOMAIN)


def compute_trusted_capture_shim(rp):
    """INTERNAL_NON_AUTHORIZING. Build the canonical trusted-shim authority record from the live shim code and the read-primitive allowlist. Used by
    build_v1_19.py to WRITE TRUSTED-SHIM.json; never used to authorize (authorization reads the pinned file)."""
    import capture_shim_reference as SHIM
    rec = {
        "schema": TRUSTED_SHIM_AUTHORITY_VERSION,
        "authority_version": AUTHORITY_VERSION,
        "shim_version": SHIM.SHIM_VERSION,
        "shim_sha256": SHIM.shim_sha256(),
        "shim_source_path": SHIM_SOURCE_PATH,
        "shim_source_sha256": _file_sha256(SHIM_SOURCE_PATH),
        "allowlist_digest": shim_allowlist_digest(rp),
        "allowlist_method_count": len(shim_allowlist(rp)),
        "codec_version": CODEC,
        "raw_schema_version": RAW_SCHEMA_ID,
        "raw_ingest_version": RAW_INGEST_VERSION,
        "evidence_store_version": EVIDENCE_STORE_VERSION,
    }
    rec["trusted_shim_sha256"] = digest(rec, SHIM_AUTHORITY_DOMAIN)
    return rec


def trusted_capture_shim():
    """AUTHORIZING trust root (C16-B3). The exact capture shim this authority version trusts, read from the bundle's pinned
    TRUSTED-SHIM.json and verified against reality on every resolution:
      * the record's own digest re-derives (trusted_shim_sha256),
      * the pinned authority version is this authority version,
      * the pinned shim source file's bytes hash to shim_source_sha256,
      * the loaded shim module's own shim_sha256() equals the pinned shim_sha256,
      * codec, raw schema, raw ingest and evidence-store versions are the ones this module implements.
    Any mismatch raises AuthorityTrustError. Memoized ONLY under the content of the two files it verifies, so editing
    either one is detected on the next call (C16-B1)."""
    try:
        reg = _read_bytes(TRUSTED_SHIM_FILE)
        srcb = _read_bytes(SHIM_SOURCE_PATH)
    except OSError as e:
        raise AuthorityTrustError(f"trusted capture shim authority not readable: {e}")
    ck = hashlib.sha256(b"trusted-shim\n" + reg + b"\n" + srcb).hexdigest()
    hit = _SHIM_AUTHORITY.get(ck)
    if hit is not None:
        if isinstance(hit, str):
            raise AuthorityTrustError(hit)
        return hit
    try:
        rec = strict_loads(reg.decode("utf-8"))
    except (ParseError, UnicodeDecodeError, ValueError) as e:
        raise AuthorityTrustError(_cache_put(_SHIM_AUTHORITY, ck, f"TRUSTED-SHIM.json is not strictly parseable: {e}"))
    errs = []
    if not isinstance(rec, dict) or sorted(rec) != sorted(TRUSTED_SHIM_FIELDS + ("trusted_shim_sha256",)):
        errs.append("TRUSTED-SHIM.json field set is not the canonical trusted-shim authority field set")
    else:
        if rec.get("trusted_shim_sha256") != digest({k: v for k, v in rec.items() if k != "trusted_shim_sha256"}, SHIM_AUTHORITY_DOMAIN):
            errs.append("trusted_shim_sha256 is not the digest of this record")
        if rec.get("schema") != TRUSTED_SHIM_AUTHORITY_VERSION:
            errs.append("wrong schema")
        if rec.get("authority_version") != AUTHORITY_VERSION:
            errs.append(f"pinned for authority {rec.get('authority_version')!r}, not {AUTHORITY_VERSION!r}")
        if rec.get("shim_source_path") != SHIM_SOURCE_PATH:
            errs.append("shim_source_path is not the pinned reference shim path")
        if rec.get("shim_source_sha256") != hashlib.sha256(srcb).hexdigest():
            errs.append("shim source bytes do not hash to the pinned shim_source_sha256")
        if rec.get("codec_version") != CODEC or rec.get("raw_schema_version") != RAW_SCHEMA_ID or rec.get("raw_ingest_version") != RAW_INGEST_VERSION:
            errs.append("pinned codec / raw schema / raw ingest version is not the one this authority implements")
        if not errs:
            try:
                import capture_shim_reference as SHIM
                live = SHIM.shim_sha256()
                lver = SHIM.SHIM_VERSION
            except Exception as e:  # noqa: BLE001 - a shim that cannot even load is untrusted
                errs.append(f"reference shim not loadable: {e!r}")
            else:
                if lver != rec.get("shim_version"):
                    errs.append(f"loaded shim version {lver!r} is not the trusted {rec.get('shim_version')!r}")
                if live != rec.get("shim_sha256"):
                    errs.append(f"loaded shim identity {live[:12]}... is not the trusted {str(rec.get('shim_sha256'))[:12]}...")
    if errs:
        raise AuthorityTrustError(_cache_put(_SHIM_AUTHORITY, ck, "untrusted capture shim authority: " + "; ".join(errs)))
    return _cache_put(_SHIM_AUTHORITY, ck, dict(rec))


def trusted_shim_digest():
    """INTERNAL_NON_AUTHORIZING. The trusted-shim authority digest, or a fixed non-sha marker when no trust root is resolvable. Used inside content
    cache keys so a changed trust root always changes every derived-authority key."""
    try:
        return trusted_capture_shim()["trusted_shim_sha256"]
    except AuthorityTrustError as e:
        return "UNTRUSTED:" + hashlib.sha256(str(e).encode("utf-8")).hexdigest()


def capture_shim_trust_errors(capture, rp=None):
    """INTERNAL_NON_AUTHORIZING (composed by the reference parser, the raw-capture record law and resolve_stored_chain). Section 7. A capture may be promoted only if the shim that produced it IS the active trusted shim: recorded shim
    version and shim sha256 must equal the trusted ones, the serialization codec must be the trusted codec, the raw frame
    schema must be the trusted raw schema, and (when the read-primitive authority is supplied) the method must be inside
    the trusted allowlist whose digest the trust root pins. Returns a list of refusal strings; empty means trusted."""
    try:
        t = trusted_capture_shim()
    except AuthorityTrustError as e:
        return [str(e)]
    errs = []
    c = capture if isinstance(capture, dict) else {}
    if c.get("capture_shim_version") != t["shim_version"]:
        errs.append(f"capture_shim_version {c.get('capture_shim_version')!r} is not the trusted {t['shim_version']!r}")
    if c.get("capture_shim_sha256") != t["shim_sha256"]:
        errs.append(f"capture_shim_sha256 {str(c.get('capture_shim_sha256'))[:12]}... is not the trusted {t['shim_sha256'][:12]}...")
    if (c.get("serialization") or {}).get("codec") != t["codec_version"]:
        errs.append(f"serialization codec {(c.get('serialization') or {}).get('codec')!r} is not the trusted {t['codec_version']!r}")
    if c.get("schema") != t["raw_schema_version"]:
        errs.append(f"raw frame schema {c.get('schema')!r} is not the trusted {t['raw_schema_version']!r}")
    if rp is not None:
        if shim_allowlist_digest(rp) != t["allowlist_digest"]:
            errs.append("the read-primitive allowlist does not hash to the trusted allowlist_digest")
        elif c.get("method") not in shim_allowlist(rp):
            errs.append(f"method {c.get('method')!r} is not in the trusted capture allowlist")
    return errs


# ------------------------------------------------------------------ internally pinned schema registry (section 3/4/5)
SCHEMA_REGISTRY_FIELDS = ("schema", "authority_version", "registry_version", "schema_count", "schemas")


def compute_schema_registry(schema_dir=None):
    """INTERNAL_NON_AUTHORIZING. Build the registry record from the bundle's schema files. Used by build_v1_19.py to WRITE SCHEMA-REGISTRY.json."""
    base = schema_dir or os.path.join(bundle_dir(), "schemas")
    entries = {}
    for root, _dirs, files in os.walk(base):
        for fn in sorted(files):
            if not fn.endswith(".schema.json"):
                continue
            p = os.path.join(root, fn)
            sid = os.path.relpath(p, base).replace(os.sep, "/")[: -len(".schema.json")]
            with open(p, "rb") as f:
                b = f.read()
            entries[sid] = {"path": "schemas/" + os.path.relpath(p, base).replace(os.sep, "/"), "sha256": hashlib.sha256(b).hexdigest(), "byte_count": len(b)}
    rec = {"schema": SCHEMA_REGISTRY_VERSION, "authority_version": AUTHORITY_VERSION, "registry_version": SCHEMA_REGISTRY_VERSION, "schema_count": len(entries), "schemas": entries}
    rec["schema_registry_sha256"] = digest(rec, SCHEMA_REGISTRY_DOMAIN)
    return rec


def schema_registry():
    """AUTHORIZING trust root (C16-B2/section 3). The registry maps (authority_version, artifact_schema_id) to the EXACT
    schema bytes this authority version validates that artifact against. Resolution verifies, every time:
      * the registry record's own digest re-derives,
      * the registry is pinned for this exact authority version,
      * every listed schema file's bytes hash to the pinned digest and byte count.
    One changed byte of one schema file is therefore detected. Callers cannot select, supply, widen or replace a schema:
    there is no parameter here and no parameter on the authorizing functions that use it. Memoized only under the content
    of the registry file plus the bytes of every schema it pins."""
    try:
        regb = _read_bytes(SCHEMA_REGISTRY_FILE)
    except OSError as e:
        raise AuthorityTrustError(f"schema registry not readable: {e}")
    h = hashlib.sha256(b"schema-registry\n" + regb)
    try:
        rec = strict_loads(regb.decode("utf-8"))
    except (ParseError, UnicodeDecodeError, ValueError) as e:
        raise AuthorityTrustError(f"SCHEMA-REGISTRY.json is not strictly parseable: {e}")
    if not isinstance(rec, dict) or sorted(rec) != sorted(SCHEMA_REGISTRY_FIELDS + ("schema_registry_sha256",)) or not isinstance(rec.get("schemas"), dict):
        raise AuthorityTrustError("SCHEMA-REGISTRY.json field set is not the canonical schema-registry field set")
    files = {}
    for sid in sorted(rec["schemas"]):
        ent = rec["schemas"][sid]
        try:
            b = _read_bytes(ent["path"]) if isinstance(ent, dict) and isinstance(ent.get("path"), str) else b""
        except OSError:
            b = b""
        files[sid] = b
        h.update(sid.encode("utf-8"))
        h.update(b"\x00")
        h.update(b)
    ck = h.hexdigest()
    hit = _REGISTRY_CACHE.get(ck)
    if hit is not None:
        if isinstance(hit, str):
            raise AuthorityTrustError(hit)
        return hit
    errs = []
    if rec.get("schema") != SCHEMA_REGISTRY_VERSION or rec.get("registry_version") != SCHEMA_REGISTRY_VERSION:
        errs.append("wrong registry schema")
    if rec.get("authority_version") != AUTHORITY_VERSION:
        errs.append(f"registry pinned for authority {rec.get('authority_version')!r}, not {AUTHORITY_VERSION!r}")
    if rec.get("schema_registry_sha256") != digest({k: v for k, v in rec.items() if k != "schema_registry_sha256"}, SCHEMA_REGISTRY_DOMAIN):
        errs.append("schema_registry_sha256 is not the digest of this registry")
    if rec.get("schema_count") != len(rec["schemas"]):
        errs.append("schema_count does not match the number of pinned schemas")
    for sid in sorted(rec["schemas"]):
        ent = rec["schemas"][sid]
        b = files[sid]
        if not isinstance(ent, dict) or not is_sha(ent.get("sha256")) or not isinstance(ent.get("path"), str):
            errs.append(f"{sid}: malformed registry entry")
            continue
        if not b:
            errs.append(f"{sid}: pinned schema file {ent['path']} is missing or empty")
            continue
        if hashlib.sha256(b).hexdigest() != ent["sha256"]:
            errs.append(f"{sid}: schema file bytes do not hash to the pinned digest")
        if ent.get("byte_count") != len(b):
            errs.append(f"{sid}: schema file byte count {len(b)} != pinned {ent.get('byte_count')}")
    if errs:
        raise AuthorityTrustError(_cache_put(_REGISTRY_CACHE, ck, "schema registry not trusted: " + "; ".join(errs[:4])))
    try:
        import jsonschema
    except ImportError:
        raise AuthorityTrustError(_cache_put(_REGISTRY_CACHE, ck, "SCHEMA_ENGINE_UNAVAILABLE: jsonschema is not importable; nothing can be authorized without schema enforcement"))
    validators = {}
    for sid in sorted(rec["schemas"]):
        try:
            validators[sid] = jsonschema.Draft202012Validator(json.loads(files[sid].decode("utf-8")))
        except Exception as e:  # noqa: BLE001 - an unusable schema is an untrusted registry
            errs.append(f"{sid}: schema is not a usable Draft 2020-12 schema ({e!r})")
    if errs:
        raise AuthorityTrustError(_cache_put(_REGISTRY_CACHE, ck, "schema registry not trusted: " + "; ".join(errs[:4])))
    out = {"authority_version": AUTHORITY_VERSION, "schema_registry_sha256": rec["schema_registry_sha256"], "entries": {sid: dict(rec["schemas"][sid]) for sid in rec["schemas"]}, "validators": validators}
    return _cache_put(_REGISTRY_CACHE, ck, out)


def schema_registry_digest():
    """INTERNAL_NON_AUTHORIZING. The pinned schema-registry digest, or a fixed non-sha marker when no registry is resolvable."""
    try:
        return schema_registry()["schema_registry_sha256"]
    except AuthorityTrustError as e:
        return "UNREGISTERED:" + hashlib.sha256(str(e).encode("utf-8")).hexdigest()


def internal_schema_errors(artifact_schema_id, doc):
    """AUTHORIZING (section 3/4). Validate `doc` against the EXACT schema the registry pins for this authority version and
    this artifact schema id. There is no validator parameter anywhere on this path. Errors are returned as sorted strings
    keyed by (validator, instance path, message), so the refusal text of a run is deterministic. An unknown artifact
    schema id is itself a refusal (fail-closed), never a pass."""
    try:
        reg = schema_registry()
    except AuthorityTrustError as e:
        return [f"SCHEMA_REGISTRY_UNTRUSTED: {e}"]
    v = reg["validators"].get(artifact_schema_id)
    if v is None:
        return [f"SCHEMA_NOT_REGISTERED: {artifact_schema_id!r} is not pinned by the {AUTHORITY_VERSION} schema registry"]
    errs = list(v.iter_errors(doc)) if not isinstance(doc, list) else [e for d in doc for e in v.iter_errors(d)]
    errs.sort(key=lambda e: (str(e.validator), "/".join(str(x) for x in e.absolute_path), e.message))
    return [e.message for e in errs]


def historical_schema_errors(authority_version, artifact_schema_id, doc, bundle_root=None):
    """INTERNAL_NON_AUTHORIZING (section 5). Validate a HISTORICAL artifact against the schema registry of the authority
    version it was written under. Historical schemas validate historical artifacts only: this function can never authorize
    anything under the active authority, and the active path never calls it."""
    root = bundle_root or os.path.dirname(bundle_dir())
    reg_path = os.path.join(root, "v" + str(authority_version).rsplit(".", 1)[0], SCHEMA_REGISTRY_FILE)
    if not os.path.exists(reg_path):
        return [f"NO_HISTORICAL_REGISTRY: {authority_version}"]
    try:
        import jsonschema
        with open(reg_path, "rb") as f:
            rec = strict_loads(f.read().decode("utf-8"))
        ent = (rec.get("schemas") or {}).get(artifact_schema_id)
        if not ent:
            return [f"SCHEMA_NOT_REGISTERED: {artifact_schema_id!r} in {authority_version}"]
        with open(os.path.join(os.path.dirname(reg_path), *ent["path"].split("/")), "rb") as f:
            b = f.read()
        if hashlib.sha256(b).hexdigest() != ent["sha256"]:
            return [f"HISTORICAL_SCHEMA_TAMPERED: {artifact_schema_id}"]
        v = jsonschema.Draft202012Validator(json.loads(b.decode("utf-8")))
    except Exception as e:  # noqa: BLE001
        return [f"HISTORICAL_REGISTRY_UNUSABLE: {e!r}"]
    errs = sorted(v.iter_errors(doc), key=lambda e: (str(e.validator), "/".join(str(x) for x in e.absolute_path), e.message))
    return [e.message for e in errs]


# ------------------------------------------------------------------ strict raw byte ingestion (C16-M2, sections 15/16/17)
RAW_FRAME_MAX_BYTES = 1 << 20
RAW_INGEST_CODES = ("NOT_BYTES", "FRAME_TOO_LARGE", "EMPTY_FRAME", "MALFORMED_UTF8", "BOM_PRESENT", "CONTROL_CHARACTER",
                    "DUPLICATE_JSON_KEY", "INVALID_NUMBER_SYNTAX", "NON_FINITE_NUMBER", "TRAILING_BYTES",
                    "MULTIPLE_JSON_VALUES", "NOT_A_JSON_OBJECT", "UNKNOWN_SCHEMA_VERSION", "STRUCTURE_INVALID",
                    "DIGEST_MISMATCH", "PARSED_OBJECT_NOT_AUTHORITY")


class RawIngestError(ValueError):
    """A raw capture frame was refused at the byte boundary. `code` is one of RAW_INGEST_CODES; nothing downstream ever
    sees the frame, so no later stage can be tricked into treating it as evidence."""

    def __init__(self, code, detail=""):
        assert code in RAW_INGEST_CODES, code
        self.code = code
        self.detail = str(detail)
        super().__init__(f"{code}: {self.detail}" if detail else code)


def _reject_constant(name):
    raise RawIngestError("NON_FINITE_NUMBER", name)


def strict_parse_raw_frame(raw_bytes):
    """INTERNAL_NON_AUTHORIZING (composed by ingest_raw_frame, the one authorizing boundary). Section 15. Turn frame BYTES into exactly one JSON object or refuse, detecting: non-bytes input, an oversized frame,
    malformed UTF-8, a byte-order mark, raw control characters, duplicate JSON keys, invalid number syntax (leading zeros,
    a leading plus, a bare '.', a trailing '.'), the non-finite constants NaN/Infinity/-Infinity, trailing garbage, a
    second JSON value after the first, and a top-level value that is not an object. This is the only parse a raw frame
    ever gets: json.loads on a caller's string is not equivalent, because it silently keeps the LAST duplicate key."""
    if not isinstance(raw_bytes, (bytes, bytearray)):
        raise RawIngestError("NOT_BYTES", type(raw_bytes).__name__)
    b = bytes(raw_bytes)
    if not b.strip():
        raise RawIngestError("EMPTY_FRAME", len(b))
    if len(b) > RAW_FRAME_MAX_BYTES:
        raise RawIngestError("FRAME_TOO_LARGE", f"{len(b)} > {RAW_FRAME_MAX_BYTES}")
    if b.startswith(b"\xef\xbb\xbf"):
        raise RawIngestError("BOM_PRESENT", "UTF-8 BOM")
    try:
        text = b.decode("utf-8")
    except UnicodeDecodeError as e:
        raise RawIngestError("MALFORMED_UTF8", str(e))
    for i, ch in enumerate(text):
        o = ord(ch)
        if o < 0x20 and ch not in "\t\n\r":
            raise RawIngestError("CONTROL_CHARACTER", f"U+{o:04X} at offset {i}")
    dec = json.JSONDecoder(object_pairs_hook=_no_dup_pairs, parse_constant=_reject_constant)
    try:
        obj, end = dec.raw_decode(text.lstrip())
    except ParseError as e:
        raise RawIngestError("DUPLICATE_JSON_KEY", str(e))
    except RawIngestError:
        raise
    except json.JSONDecodeError as e:
        msg = str(e)
        if "Expecting" in msg or "Invalid" in msg or "Extra data" in msg:
            raise RawIngestError("INVALID_NUMBER_SYNTAX" if "number" in msg.lower() else "STRUCTURE_INVALID", msg)
        raise RawIngestError("STRUCTURE_INVALID", msg)
    rest = text.lstrip()[end:]
    if rest.strip():
        try:
            dec.raw_decode(rest.lstrip())
        except (ValueError, RawIngestError):
            raise RawIngestError("TRAILING_BYTES", repr(rest[:24]))
        raise RawIngestError("MULTIPLE_JSON_VALUES", repr(rest.strip()[:24]))
    if not isinstance(obj, dict):
        raise RawIngestError("NOT_A_JSON_OBJECT", type(obj).__name__)
    return obj


def raw_ingest_receipt(raw_bytes, capture):
    """INTERNAL_NON_AUTHORIZING (composed by ingest_raw_frame). The strict-parse receipt of one ingested frame: what bytes were parsed, how many, under which ingest, codec, raw
    schema and authority version, and which capture digest those exact bytes produced. Its own digest closes it."""
    rec = {
        "schema": RAW_INGEST_RECEIPT_DOMAIN,
        "ingest_version": RAW_INGEST_VERSION,
        "authority_version": AUTHORITY_VERSION,
        "raw_schema_version": RAW_SCHEMA_ID,
        "codec_version": CODEC,
        "raw_bytes_sha256": hashlib.sha256(bytes(raw_bytes)).hexdigest(),
        "byte_count": len(bytes(raw_bytes)),
        "strict_parse": True,
        "duplicate_keys_rejected": True,
        "control_characters_rejected": True,
        "single_json_object": True,
        "capture_digest": raw_capture_digest(capture),
    }
    rec["receipt_sha256"] = digest(rec, RAW_INGEST_RECEIPT_DOMAIN)
    return rec


def ingest_raw_frame(raw_bytes, env=None, active=None, rp=None):
    """AUTHORIZING raw-evidence boundary (C16-M2, section 16). THE ONE canonical way raw capture bytes become authority:
        bytes -> strict single-object parse -> raw-frame structure validation -> trusted-shim check -> content digest
        -> immutable stored record carrying a strict-parse receipt.
    Returns {record, receipt}. A caller-supplied PARSED dict is not equivalent authority and there is no entry point that
    accepts one: see raw_capture_ingest_errors, which refuses any RAW_CAPABILITY_CAPTURE record that cannot show a receipt
    binding it to the exact bytes it was parsed from."""
    capture = strict_parse_raw_frame(raw_bytes)
    if capture.get("schema") != RAW_SCHEMA_ID:
        raise RawIngestError("UNKNOWN_SCHEMA_VERSION", repr(capture.get("schema")))
    errs = _capture_structure_errors(capture)
    if errs:
        raise RawIngestError("STRUCTURE_INVALID", "; ".join(errs[:3]))
    if not raw_capture_digest_ok(capture):
        raise RawIngestError("DIGEST_MISMATCH", "raw_digest does not re-hash the frame content")
    st = capture_shim_trust_errors(capture, rp)
    if st:
        raise RawIngestError("STRUCTURE_INVALID", "untrusted shim: " + st[0])
    receipt = raw_ingest_receipt(raw_bytes, capture)
    return {"capture": capture, "raw_capture_sha256": capture["raw_digest"], "ingest_receipt": receipt}


def ingest_receipt_errors(receipt, capture):
    """INTERNAL_NON_AUTHORIZING (composed by semantic_raw_capture). Section 16. A receipt is admissible only if it is internally closed and binds THESE capture bytes: its own digest
    re-derives, it declares this ingest/codec/raw-schema/authority version, it asserts every strict-parse property, and
    its capture_digest is the digest of the capture it travels with."""
    errs = []
    if not isinstance(receipt, dict):
        return ["PARSED_OBJECT_NOT_AUTHORITY: no strict-parse receipt (a pre-parsed object is not raw evidence)"]
    if receipt.get("schema") != RAW_INGEST_RECEIPT_DOMAIN or receipt.get("ingest_version") != RAW_INGEST_VERSION:
        errs.append("receipt is not a v1.7 strict raw-ingest receipt")
    if receipt.get("authority_version") != AUTHORITY_VERSION:
        errs.append("receipt was written under another authority version")
    if receipt.get("raw_schema_version") != RAW_SCHEMA_ID or receipt.get("codec_version") != CODEC:
        errs.append("receipt names another raw schema or codec")
    for k in ("strict_parse", "duplicate_keys_rejected", "control_characters_rejected", "single_json_object"):
        if receipt.get(k) is not True:
            errs.append(f"receipt does not assert {k}")
    if not is_sha(receipt.get("raw_bytes_sha256")) or not isinstance(receipt.get("byte_count"), int) or receipt["byte_count"] <= 0:
        errs.append("receipt does not name the exact frame bytes it parsed")
    if receipt.get("receipt_sha256") != digest({k: v for k, v in receipt.items() if k != "receipt_sha256"}, RAW_INGEST_RECEIPT_DOMAIN):
        errs.append("receipt_sha256 is not the digest of this receipt")
    try:
        cd = raw_capture_digest(capture)
    except (CanonError, KeyError, TypeError):
        cd = None
    if cd is None or receipt.get("capture_digest") != cd:
        errs.append("receipt capture_digest is not the digest of the capture it travels with")
    return errs


# ------------------------------------------------------------------ pinned evidence session manifest (section 21)
SESSION_MANIFEST_FIELDS = ("schema", "evidence_store_version", "evidence_session_schema", "evidence_inventory_schema", "evidence_finalization_schema", "evidence_boundary_schema", "session_identity_sha256", "session_dir_basename", "platform_scope", "session_id", "probe_id", "operator",
                           "created_at", "authority_version", "authority_manifest_sha256", "schema_registry_sha256",
                           "capability_matrix_sha256", "raw_schema_version", "codec_version", "raw_ingest_version",
                           "trusted_shim_version", "trusted_shim_sha256", "trusted_shim_allowlist_digest",
                           "trusted_shim_sha256_of_source", "parser_version", "parser_sha256", "primitive_spec_sha256",
                           "host_name", "product", "resolve_version", "build", "library_name", "library_uuid",
                           "library_root", "stdout_retention", "stderr_retention")
STDOUT_RETENTION_RULES = ("CONTENT_ADDRESSED_RAW_LAYER", "NOT_CAPTURED")


def session_manifest_errors(sm, env, active, rp):
    """AUTHORIZING support (section 21). An evidence session's pinned manifest must name exactly the active authority: the
    active manifest and schema registry, the active capability matrix, the trusted shim identity, allowlist and source, the
    active reference parser and primitive spec, the contract host/product/version/build/library, and a closed
    stdout/stderr retention rule. Any mismatch makes every record of that session inadmissible."""
    errs = []
    if not isinstance(sm, dict):
        return ["session manifest missing"]
    missing = [k for k in SESSION_MANIFEST_FIELDS if k not in sm]
    if missing:
        errs.append(f"session manifest is missing {missing[:4]}")
    extra = [k for k in sm if k not in SESSION_MANIFEST_FIELDS]
    if extra:
        errs.append(f"session manifest carries unknown fields {sorted(extra)[:4]}")
    if errs:
        return errs
    try:
        t = trusted_capture_shim()
    except AuthorityTrustError as e:
        return [str(e)]
    a, e_ = active or {}, env or {}
    checks = [
        ("schema", sm["schema"], EVIDENCE_SESSION_SCHEMA),
        ("evidence_store_version", sm["evidence_store_version"], EVIDENCE_STORE_VERSION),
        ("evidence_session_schema", sm["evidence_session_schema"], EVIDENCE_SESSION_SCHEMA),
        ("evidence_inventory_schema", sm["evidence_inventory_schema"], EVIDENCE_INVENTORY_SCHEMA),
        ("evidence_finalization_schema", sm["evidence_finalization_schema"], EVIDENCE_FINALIZATION_SCHEMA),
        ("evidence_boundary_schema", sm["evidence_boundary_schema"], EVIDENCE_BOUNDARY_SCHEMA),
        ("platform_scope", sm["platform_scope"], EVIDENCE_STORE_PLATFORM_SCOPE),
        ("session_dir_basename", sm["session_dir_basename"], sm.get("session_id")),
        ("authority_version", sm["authority_version"], AUTHORITY_VERSION),
        ("authority_manifest_sha256", sm["authority_manifest_sha256"], a.get("manifest_sha256")),
        ("schema_registry_sha256", sm["schema_registry_sha256"], schema_registry_digest()),
        ("capability_matrix_sha256", sm["capability_matrix_sha256"], a.get("capability_matrix_sha256")),
        ("raw_schema_version", sm["raw_schema_version"], RAW_SCHEMA_ID),
        ("codec_version", sm["codec_version"], CODEC),
        ("raw_ingest_version", sm["raw_ingest_version"], RAW_INGEST_VERSION),
        ("trusted_shim_version", sm["trusted_shim_version"], t["shim_version"]),
        ("trusted_shim_sha256", sm["trusted_shim_sha256"], t["shim_sha256"]),
        ("trusted_shim_allowlist_digest", sm["trusted_shim_allowlist_digest"], t["allowlist_digest"]),
        ("trusted_shim_sha256_of_source", sm["trusted_shim_sha256_of_source"], t["shim_source_sha256"]),
        ("parser_version", sm["parser_version"], PARSER_VERSION),
        ("parser_sha256", sm["parser_sha256"], parser_sha256()),
        ("host_name", sm["host_name"], e_.get("host_name")),
        ("product", sm["product"], e_.get("product")),
        ("resolve_version", sm["resolve_version"], e_.get("resolve_version")),
        ("build", sm["build"], e_.get("build")),
        ("library_name", sm["library_name"], e_.get("library_name")),
        ("library_uuid", sm["library_uuid"], e_.get("library_uuid")),
        ("library_root", sm["library_root"], e_.get("library_root")),
    ]
    if rp is not None:
        checks.append(("primitive_spec_sha256", sm["primitive_spec_sha256"], primitive_spec_digest(rp)))
        checks.append(("trusted_shim_allowlist_digest", sm["trusted_shim_allowlist_digest"], shim_allowlist_digest(rp)))
    for name, got, want in checks:
        if got != want:
            errs.append(f"session manifest {name}={str(got)[:20]!r} is not the active {str(want)[:20]!r}")
    for k in ("stdout_retention", "stderr_retention"):
        if sm[k] not in STDOUT_RETENTION_RULES:
            errs.append(f"session manifest {k} is not one of {list(STDOUT_RETENTION_RULES)}")
    if not isinstance(sm["session_id"], str) or not sm["session_id"]:
        errs.append("session manifest has no session id")
    if not isinstance(sm["probe_id"], str) or not sm["probe_id"]:
        errs.append("session manifest has no probe id")
    if not isinstance(sm["operator"], str) or not sm["operator"]:
        errs.append("session manifest has no operator")
    return errs



# ------------------------------------------------------------------ v1.6 reference re-parser (deterministic; ignores every probe-authored interpretation)
PARSER_FUNCTION_NAMES = ("derive_capability_result", "codec_errors", "codec_broad_type", "codec_contains_elision", "_capture_structure_errors")


def _parser_code_key():
    """Content key of the live parser code: the compiled bytecode, constants and names of every function whose source the
    parser identity is a hash of. Replacing or monkeypatching any of them changes this key, so the memoized identity below
    can never keep serving the hash of code that is no longer the code that would run (C16-B1, section 2 'parser identity')."""
    h = hashlib.sha256(("vidtoolz.resolveParserCode.v1\n" + PARSER_VERSION + "\n").encode("utf-8"))
    for name in PARSER_FUNCTION_NAMES:
        f = globals().get(name)
        c = getattr(f, "__code__", None)
        if c is None:
            h.update(("!missing:" + name + "\n").encode("utf-8"))
            continue
        h.update(c.co_code)
        h.update(repr(c.co_consts).encode("utf-8", "surrogatepass"))
        h.update(repr(c.co_names).encode("utf-8"))
        h.update((c.co_qualname if hasattr(c, "co_qualname") else c.co_name).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def parser_sha256():
    """INTERNAL_NON_AUTHORIZING. Identity of the reference parser: sha256 of the source of derive_capability_result and the codec
    helpers plus PARSER_VERSION. v1.7 (C16-B1): memoized under the content key of the live parser code objects, not under a
    process-local flag, so a replaced or patched parser function is detected and the identity is recomputed from source."""
    k = _parser_code_key()
    hit = _PARSER_SHA.get(k)
    if hit is not None:
        return hit
    import inspect
    try:
        text = "".join(inspect.getsource(globals()[name]) for name in PARSER_FUNCTION_NAMES) + PARSER_VERSION
    except (OSError, TypeError, KeyError):
        return "PARSER_SOURCE_UNAVAILABLE"
    return _cache_put(_PARSER_SHA, k, sha256_text(text))


def classification_family(cls):
    """INTERNAL_NON_AUTHORIZING. Closed family of a derived class (FAILURE groups the spec-relative failures)."""
    return DERIVED_FAMILY.get(cls, "MALFORMED")


def derive_capability_result(capture, spec, env, active):
    """INTERNAL_NON_AUTHORIZING (composed by capability_qualification and every validator). Derive the meaning of ONE raw capture
    against ONE primitive spec in a fixed order: structure/forbidden fields/digest -> binding (authority, manifest, host, product,
    version, build) -> mechanical outcome -> method/receiver/args vs spec -> codec validity -> truncation -> null -> type ->
    shape -> SUCCESS. Stored derived results are a cache: validators recompute and require byte equality."""
    facts, reasons, cls = {}, [], None
    errs = _capture_structure_errors(capture)
    if errs:
        cls, reasons = "MALFORMED", errs[:3]
    elif not raw_capture_digest_ok(capture):
        cls, reasons = "MALFORMED", ["raw_digest does not re-hash"]
    if cls is None:
        bind = {"authority_version": (active or {}).get("authority_version"), "manifest_sha256": (active or {}).get("manifest_sha256"), "host_name": (env or {}).get("host_name"), "product": (env or {}).get("product"), "resolve_version": (env or {}).get("resolve_version"), "build": (env or {}).get("build")}
        for k, want in bind.items():
            if capture.get(k) != want:
                cls, reasons = "BINDING_MISMATCH", [f"{k}={capture.get(k)!r} != active/contract {want!r}"]
                break
    if cls is None:
        st = capture_shim_trust_errors(capture)
        if st:
            cls, reasons = "SHIM_UNTRUSTED", st[:2]
    if cls is None:
        oc = capture["outcome"]
        facts["outcome"] = oc
        if oc == "RAISED":
            cls, reasons = "EXCEPTION", [f"{capture['raised']['exception_class']}: {str(capture['raised'].get('message', ''))[:80]}"]
            facts["exception_class"] = capture["raised"]["exception_class"]
        elif oc == "TIMEOUT":
            cls = "TIMEOUT"
        elif oc == "ATTRIBUTE_MISSING":
            cls = "UNSUPPORTED"
        elif oc == "TRANSPORT_FAILURE":
            cls = "TRANSPORT_FAILURE"
        elif oc == "REFUSED":
            cls = "REFUSED"
        elif oc == "UNSERIALIZABLE":
            cls = "UNSERIALIZABLE"
    if cls is None:
        if spec is None or spec_errors(spec):
            cls, reasons = "MALFORMED", ["no valid primitive spec for method"]
        elif capture.get("method") != spec["method"]:
            cls, reasons = "MALFORMED", [f"raw method {capture.get('method')!r} evaluated against spec {spec['method']!r}"]
        elif capture["receiver"]["class"] != spec["receiver"]:
            cls, reasons = "RECEIVER_MISMATCH", [f"{capture['receiver']['class']} != {spec['receiver']}"]
        elif [codec_broad_type(a) for a in capture["args"]] != list(spec["arg_types"]):
            cls, reasons = "ARGS_MISMATCH", [f"{[codec_broad_type(a) for a in capture['args']]} != {list(spec['arg_types'])}"]
    if cls is None:
        val = capture["returned"]["value"]
        bt = codec_broad_type(val)
        facts.update(python_type=capture["returned"]["python_type"], broad_type=bt, truncated=bool(capture["serialization"]["truncated"]) or codec_contains_elision(val))
        if facts["truncated"] and spec["completeness"] == "COMPLETE":
            cls, reasons = "TRUNCATED", ["value truncated/elided but the primitive requires a complete value"]
        elif bt == "none":
            if spec["nullable"]:
                cls = "SUCCESS"
                facts["null"] = True
            else:
                cls, reasons = "NULL_NOT_ALLOWED", ["None returned; primitive is non-nullable"]
        elif bt != spec["expected_type"]:
            cls, reasons = "TYPE_MISMATCH", [f"{bt} != expected {spec['expected_type']}"]
        elif val.get("$t") == "f64_nonfinite":
            cls, reasons = "TYPE_MISMATCH", ["non-finite float"]
        elif spec["shape_rule"] == "NON_EMPTY" and ((bt in ("list", "dict") and not val["v"]) or (bt == "str" and val["v"] == "")):
            cls, reasons = "TYPE_MISMATCH", ["empty value where NON_EMPTY required"]
        else:
            cls = "SUCCESS"
            if bt in ("list", "dict"):
                facts["length"] = len(val["v"])
    out = {"schema": "vidtoolz.resolveDerivedCapabilityResult.v1", "parser_version": PARSER_VERSION, "parser_sha256": parser_sha256(), "raw_capture_sha256": (capture or {}).get("raw_digest") if isinstance(capture, dict) else None,
           "spec_digest": (spec_entry_digest(spec) if spec and not spec_errors(spec) else None), "method": (capture or {}).get("method") if isinstance(capture, dict) else None, "receiver_class": ((capture or {}).get("receiver") or {}).get("class") if isinstance(capture, dict) else None,
           "expectation_status": (spec or {}).get("expectation_status"), "classification": cls, "family": classification_family(cls), "facts": facts, "reasons": reasons}
    out["derived_result_sha256"] = digest(out, DERIVED_DOMAIN)
    return out


def derived_result_digest_ok(d):
    return isinstance(d, dict) and digest({k: v for k, v in d.items() if k != "derived_result_sha256"}, DERIVED_DOMAIN) == d.get("derived_result_sha256")


# ------------------------------------------------------------------ v1.6 active capability matrix is content-bound
def capability_matrix_digest(caps):
    """INTERNAL_NON_AUTHORIZING. Canonical content digest of a capability matrix object. active.capability_matrix_sha256 IS this digest;
    a matrix object whose digest differs is not the active matrix whatever its schema validity or labels say."""
    return digest(caps, MATRIX_DOMAIN)


def active_authority_errors(caps, active):
    """INTERNAL_NON_AUTHORIZING. The supplied capability matrix must be the exact content named by the active authority."""
    errs = []
    if not isinstance(active, dict) or not is_sha(active.get("manifest_sha256")) or not is_sha(active.get("capability_matrix_sha256")) or not active.get("authority_version"):
        return ["active authority must carry authority_version, manifest_sha256 and capability_matrix_sha256"]
    if not is_sha(active.get("trusted_shim_sha256")):
        return ["active authority must carry trusted_shim_sha256 (v1.7, C16-B3: the active authority names the ONE capture shim a promotable capture may have been produced by)"]
    try:
        if active["trusted_shim_sha256"] != trusted_capture_shim()["trusted_shim_sha256"]:
            errs.append("TRUSTED_SHIM_NOT_ACTIVE: active.trusted_shim_sha256 is not the trusted capture shim authority pinned by this bundle")
    except AuthorityTrustError as e:
        return [str(e)]
    try:
        d = capability_matrix_digest(caps)
    except CanonError as e:
        return [f"capability matrix not canonicalizable: {e}"]
    if d != active["capability_matrix_sha256"]:
        errs.append("CAPABILITY_MATRIX_NOT_ACTIVE: supplied matrix content digest differs from active.capability_matrix_sha256")
    if (caps or {}).get("version") != active.get("authority_version") and not str((caps or {}).get("version", "")).startswith(active.get("authority_version", "?")):
        errs.append("capability matrix version is not the active authority version")
    return errs


def refreeze_block_digest(caps):
    """INTERNAL_NON_AUTHORIZING. v1.7 (section 12). Canonical content digest of the matrix's own refreeze block. A promoted evidence entry binds THIS,
    not the refreeze record's id: the record's id depends on the matrix digest, which depends on the entries, so an entry
    naming the record id would be a digest cycle. The block is a sibling of the rows, so binding it is acyclic - and it is
    the block that carries the promoted probe, raw, derived and review digests the row rests on."""
    return digest((caps or {}).get("refreeze") or {}, REFREEZE_BLOCK_DOMAIN)


def refreeze_block_errors(caps, rp):
    """INTERNAL_NON_AUTHORIZING. The matrix's own refreeze block must be coherent with its rows and the active parser/spec."""
    errs = []
    rf = caps.get("refreeze") or {}
    if rf.get("kind") != "M0_READ_REQUALIFICATION":
        errs.append("refreeze.kind")
    if rf.get("parser_version") != PARSER_VERSION or rf.get("parser_sha256") != parser_sha256():
        errs.append("refreeze block bound to another parser version/hash")
    if rp is not None and rf.get("primitive_spec_sha256") != primitive_spec_digest(rp):
        errs.append("refreeze block bound to another primitive spec digest")
    return errs


_QUAL_CACHE = {}


ENTRY_BOUND_FIELDS = ("method", "receiver_class", "probe_id", "session_id", "raw_capture_sha256", "derived_result_sha256",
                      "derived_record_sha256", "review_decision_sha256", "refreeze_block_sha256", "parser_version",
                      "parser_sha256", "primitive_spec_sha256", "capture_shim_version", "capture_shim_sha256",
                      "trusted_shim_sha256", "host", "product", "resolve_version", "build", "version_match",
                      "reviewed_refreeze_version")


def supersession_resolve(records, label):
    """INTERNAL_NON_AUTHORIZING (composed by resolve_stored_chain). Sections 10/11. Deterministic CURRENT selection among candidate records of one kind for one chain. A record retires
    another only by naming its record id in `supersedes`. Exactly one non-superseded record must remain:
      none            -> (None, '<label>_NONE')
      exactly one     -> (record, '<label>_CURRENT')
      more than one   -> (None, '<label>_CONFLICT')   explicit supersession is required
      all superseded  -> (None, '<label>_CONFLICT')   a supersession cycle resolves to nothing
    Insertion order, array order, map order and record age never decide anything. There is no first-wins and no last-wins."""
    if not records:
        return None, label + "_NONE", []
    ids = {r["record_id"] for r in records}
    superseded = set()
    for r in records:
        sup = r.get("supersedes") or []
        if not isinstance(sup, list):
            return None, label + "_CONFLICT", [f"{label}: supersedes must be a list of record ids"]
        if r["record_id"] in sup:
            return None, label + "_CONFLICT", [f"{label}: record {r['record_id'][:12]} supersedes itself"]
        superseded.update(sup)
    live = sorted((r for r in records if r["record_id"] not in superseded), key=lambda r: r["record_id"])
    notes = []
    dangling = sorted(superseded - ids)
    if dangling:
        notes.append(f"{label}: supersedes {dangling[0][:12]} which is absent from this evidence set")
    if len(live) == 1:
        return live[0], label + "_CURRENT", notes
    if not live:
        return None, label + "_CONFLICT", notes + [f"{label}: every candidate is superseded (supersession cycle); nothing is current"]
    return None, label + "_CONFLICT", notes + [f"{label}: {len(live)} current candidates ({', '.join(x['record_id'][:12] for x in live[:3])}); an explicit supersession is required and insertion order never decides"]


def stored_chain_digest(chain):
    """INTERNAL_NON_AUTHORIZING. Content digest of a resolved chain: the exact stored identities a promotion rests on. Published in refusal
    diagnostics and by the matrix binding check, never used as authority on its own."""
    return digest({k: chain.get(k) for k in ("raw_capture_sha256", "derived_result_sha256", "derived_record_sha256", "review_decision_sha256", "refreeze_block_sha256", "probe_id", "session_id", "parser_sha256", "primitive_spec_sha256", "trusted_shim_sha256", "capability_matrix_sha256")}, CHAIN_DOMAIN)


def resolve_stored_chain(entry, method, caps, rp, es, env, active, spec=None):
    """AUTHORIZING support (Codex v1.6 BLOCKER C16-B4, sections 9-12). Resolve the EXACT stored artifacts that one promoted
    matrix evidence entry names, by digest, and refuse every substitution:

      RAW        exactly one RAW_CAPABILITY_CAPTURE resolves under entry.raw_capture_sha256, is well formed, was produced
                 by the active trusted shim, carries a strict-parse receipt, and belongs to entry.probe_id / session_id
                 and to this method.
      DERIVED    entry.derived_result_sha256 and entry.derived_record_sha256 must BOTH resolve, to the same single stored
                 DERIVED_CAPABILITY_RESULT record. That record must belong to this raw capture, be bound to the active
                 parser version/hash and primitive-spec digest, and be byte-equal to the recomputation. A derived artifact
                 the chain claims exists is never silently replaced by a fresh recomputation, and a stored derived result
                 for a DIFFERENT raw capture can never be substituted even if it recomputes to the same class.
      REVIEW     exactly one CURRENT REVIEW_DECISION resolves under entry.review_decision_sha256 and references EXACTLY
                 this stored derived digest and this raw digest. Review A cannot serve derived B even when both recompute
                 to SUCCESS. Duplicate or conflicting current reviews are a CONFLICT, never a first/last selection.
      REFREEZE   exactly one CURRENT reviewed REFREEZE_RECORD resolves under entry.refreeze_record_sha256, promotes
                 exactly this raw/derived/review triple and this probe id, and names the active capability matrix.
      BINDING    the entry itself binds all of the above plus the trusted shim identity, the parser, the primitive spec and
                 the host/product/resolve_version/build of the contract environment (section 12).

    Returns {ok, errors, raw, capture, derived_record, derived, review, refreeze, chain_sha256}."""
    out = {"ok": False, "errors": [], "raw": None, "capture": None, "derived_record": None, "derived": None, "review": None, "refreeze": None, "chain_sha256": None}
    errs = out["errors"]
    if not isinstance(entry, dict):
        errs.append("no v1.7 evidence entry for this method")
        return out
    try:
        trusted = trusted_capture_shim()
    except AuthorityTrustError as e:
        errs.append(str(e))
        return out
    missing = [k for k in ENTRY_BOUND_FIELDS if entry.get(k) is None]
    if missing:
        errs.append(f"evidence entry does not bind {missing[:4]} (section 12: a promoted row binds the exact stored chain)")
    for k in ("raw_capture_sha256", "derived_result_sha256", "derived_record_sha256", "review_decision_sha256", "refreeze_block_sha256", "parser_sha256", "primitive_spec_sha256", "trusted_shim_sha256"):
        if entry.get(k) is not None and not is_sha(entry.get(k)):
            errs.append(f"evidence entry {k} is not a sha256")
    if entry.get("method") != method:
        errs.append("evidence entry is for another method")
    if entry.get("parser_version") != PARSER_VERSION or entry.get("parser_sha256") != parser_sha256():
        errs.append("evidence entry bound to another reference parser")
    if entry.get("primitive_spec_sha256") != primitive_spec_digest(rp):
        errs.append("evidence entry bound to another primitive spec digest")
    if entry.get("capture_shim_version") != trusted["shim_version"] or entry.get("capture_shim_sha256") != trusted["shim_sha256"] or entry.get("trusted_shim_sha256") != trusted["trusted_shim_sha256"]:
        errs.append("evidence entry bound to another capture shim than the active trusted shim")
    if entry.get("host") != env.get("host_name") or entry.get("product") != env.get("product") or entry.get("build") != env.get("build") or (isinstance(entry.get("build"), int) and f"{entry.get('resolve_version')}.{entry['build']:04d}" != env.get("resolve_version")):
        errs.append("evidence entry host/product/resolve_version/build differ from the contract environment")
    if entry.get("version_match") is not True or entry.get("reviewed_refreeze_version") != (caps or {}).get("version"):
        errs.append("evidence entry not version-matched to this matrix version")
    if entry.get("refreeze_block_sha256") != refreeze_block_digest(caps):
        errs.append("evidence entry binds another refreeze block than the one this matrix carries")
    if errs:
        return out

    raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=entry["raw_capture_sha256"]) if not semantic_raw_capture(r, env, active, rp)]
    if len(raws) != 1:
        errs.append("raw capture missing, malformed, unbound, untrusted or ambiguous")
        return out
    raw = raws[0]
    cap = raw["capture"]
    out["raw"], out["capture"] = raw, cap
    if cap.get("method") != method or cap.get("probe_id") != entry["probe_id"] or cap.get("session_id") != entry["session_id"]:
        errs.append("raw capture belongs to another method, probe or session than the entry names")
    if entry.get("receiver_class") != (cap.get("receiver") or {}).get("class"):
        errs.append("receiver class differs between entry and capture")
    if spec is None:
        spec = probe_spec_index(rp).get(method)
    if spec is None:
        errs.append("method has no primitive spec in the read-primitive authority")
        return out
    if spec.get("receiver") != (cap.get("receiver") or {}).get("class"):
        errs.append("receiver class differs between capture and primitive spec")
    recomputed = derive_capability_result(cap, spec, env, active)
    if recomputed["classification"] != "SUCCESS":
        errs.append(f"reference parser derives {recomputed['classification']} ({'; '.join(recomputed['reasons'][:1])}); not SUCCESS")
    if recomputed["derived_result_sha256"] != entry["derived_result_sha256"]:
        errs.append("promoted derived_result_sha256 is not the recomputation under the active parser/spec")

    stored = [r for r in find_records(es, "DERIVED_CAPABILITY_RESULT", derived_result_sha256=entry["derived_result_sha256"])]
    by_id = [r for r in stored if r["record_id"] == entry["derived_record_sha256"]]
    if not stored:
        errs.append("DERIVED_ARTIFACT_MISSING: the chain claims a DERIVED_CAPABILITY_RESULT that this evidence set does not contain; a missing derived artifact is never replaced by a fresh recomputation")
        return out
    if len(stored) != 1:
        errs.append(f"DERIVED_ARTIFACT_AMBIGUOUS: {len(stored)} stored derived results share this digest")
        return out
    if not by_id:
        errs.append("DERIVED_ARTIFACT_SUBSTITUTED: entry.derived_record_sha256 does not name the stored derived record that carries this derived digest")
        return out
    dr = by_id[0]
    out["derived_record"], out["derived"] = dr, dr.get("derived")
    if dr.get("raw_capture_sha256") != entry["raw_capture_sha256"] or (dr.get("derived") or {}).get("raw_capture_sha256") != entry["raw_capture_sha256"]:
        errs.append("DERIVED_ARTIFACT_SUBSTITUTED: the stored derived result belongs to another raw capture")
    d = dr.get("derived") or {}
    if d.get("parser_version") != PARSER_VERSION or d.get("parser_sha256") != parser_sha256() or d.get("spec_digest") != spec_entry_digest(spec):
        errs.append("stored derived result was produced by another parser or primitive spec than the active one")
    if canon(d) != canon(recomputed):
        errs.append("stored DERIVED_CAPABILITY_RESULT differs from the recomputation (cache invalid)")
    derr = semantic_derived_result_record(dr, es, rp, env, active)
    if derr:
        errs.append("stored derived result invalid: " + derr[0])

    rvs = find_records(es, "REVIEW_DECISION", derived_result_sha256=entry["derived_result_sha256"], raw_capture_sha256=entry["raw_capture_sha256"])
    review, rstate, rnotes = supersession_resolve(rvs, "REVIEW")
    errs += rnotes
    if review is None:
        errs.append(f"REVIEW_{rstate.split('_', 1)[1]}: no single current REVIEW_DECISION of exactly this raw+derived pair")
    else:
        out["review"] = review
        if review["record_id"] != entry["review_decision_sha256"]:
            errs.append("REVIEW_SUBSTITUTED: the current review is not the review the entry names")
        if review.get("derived_result_sha256") != entry["derived_result_sha256"] or review.get("raw_capture_sha256") != entry["raw_capture_sha256"]:
            errs.append("REVIEW_SUBSTITUTED: the review does not reference the exact stored derived digest and raw digest")
        if review.get("decision") != "ACCEPT":
            errs.append(f"review decision is {review.get('decision')}, not ACCEPT")
        rerr = semantic_review_decision(review, es, rp, env, active)
        if rerr:
            errs.append("review invalid: " + rerr[0])
    conflicting = [r for r in find_records(es, "REVIEW_DECISION", raw_capture_sha256=entry["raw_capture_sha256"]) if r.get("derived_result_sha256") != entry["derived_result_sha256"]]
    if conflicting:
        cur2, st2, _ = supersession_resolve(conflicting, "REVIEW_OTHER_DERIVED")
        if cur2 is not None:
            errs.append("REVIEW_CONFLICT: a current review of this raw capture references a different derived digest; the conflict must be resolved by explicit supersession")

    rfs = [r for r in find_records(es, "REFREEZE_RECORD") if r.get("reviewed") is True and r.get("kind") == "M0_READ_REQUALIFICATION" and entry["raw_capture_sha256"] in (r.get("promoted_raw_capture_sha256") or [])]
    refreeze, fstate, fnotes = supersession_resolve(rfs, "REFREEZE")
    errs += fnotes
    if refreeze is None:
        errs.append(f"REFREEZE_{fstate.split('_', 1)[1]}: no single current reviewed REFREEZE_RECORD promotes this raw capture")
    else:
        out["refreeze"] = refreeze
        if refreeze_block_digest(caps) != digest({k: v for k, v in ((caps or {}).get("refreeze") or {}).items()}, REFREEZE_BLOCK_DOMAIN):
            errs.append("refreeze block digest does not re-derive")
        for k, v in (("promoted_derived_result_sha256", entry["derived_result_sha256"]), ("promoted_review_decision_sha256", entry["review_decision_sha256"])):
            if v not in (refreeze.get(k) or []):
                errs.append(f"refreeze record does not promote this {k[9:]}")
        if entry["probe_id"] not in (refreeze.get("promoted_probe_ids") or []):
            errs.append("refreeze record does not promote this probe id")
        if refreeze.get("capability_matrix_sha256") != (active or {}).get("capability_matrix_sha256"):
            errs.append("refreeze record names another capability matrix than the active one")
        if refreeze.get("session_id") != entry["session_id"] or refreeze.get("probe_id") != entry["probe_id"]:
            errs.append("refreeze record names another probe/session than the entry")
        if refreeze.get("authority_version") != (active or {}).get("authority_version") or refreeze.get("manifest_sha256") != (active or {}).get("manifest_sha256"):
            errs.append("refreeze record bound to another authority")
        if refreeze.get("parser_version") != PARSER_VERSION or refreeze.get("parser_sha256") != parser_sha256() or refreeze.get("primitive_spec_sha256") != primitive_spec_digest(rp):
            errs.append("refreeze record bound to another parser/spec")

    out["chain_sha256"] = stored_chain_digest({**{k: entry.get(k) for k in ("raw_capture_sha256", "derived_result_sha256", "derived_record_sha256", "review_decision_sha256", "refreeze_block_sha256", "probe_id", "session_id", "parser_sha256", "primitive_spec_sha256", "trusted_shim_sha256")}, "capability_matrix_sha256": (active or {}).get("capability_matrix_sha256")})
    out["errors"] = [e for e in errs if e]
    out["ok"] = not out["errors"]
    return out


def capability_qualification(caps, rp, method, es, env, active, _ck=None):
    """INTERNAL_NON_AUTHORIZING (composed by primitive_status/callable_method_set/provenance_errors). Full derivation for one method.
    Returns {status, reasons, raw_capture_sha256, derived_result_sha256, review_decision_sha256, promotion_state, chain_sha256}.
    QUALIFIED_CALLABLE requires, all recomputed NOW: the supplied matrix IS the active matrix (content digest); the row is
    QUALIFIED_READ under a reviewed refreeze block bound to the active parser + primitive spec; and resolve_stored_chain
    resolves the EXACT stored raw capture, stored derived result, current review and current reviewed refreeze record the
    row's evidence entry names, with no substitution anywhere (C16-B4).
    v1.7 caching law (C16-B1): the memo key is `content_key(...)` plus the method - content digests of the matrix, the
    read-primitive authority, the evidence set, the contract environment and the active authority, plus the identity of the
    live parser and trusted shim. No part of the key is an object identity, so mutating any input in place always misses the
    cache and a warm result is always equal to a cold one. Cached values are stored as JSON text and re-parsed on return, so
    a caller can never mutate another caller's cached result."""
    ck = _ck if _ck is not None else content_key(caps, rp, es, env, active, method)
    if ck is not None:
        hit = _QUAL_CACHE.get((ck, method))
        if hit is not None:
            return json.loads(hit)
    out = _capability_qualification_now(caps, rp, method, es, env, active)
    if ck is not None:
        _cache_put(_QUAL_CACHE, (ck, method), json.dumps(out, sort_keys=True))
    return out


def _capability_qualification_now(caps, rp, method, es, env, active):
    """The whole derivation, always computed from the current content of the inputs. Never consults a cache."""
    out = {"status": "UNQUALIFIED", "reasons": [], "raw_capture_sha256": None, "derived_result_sha256": None, "review_decision_sha256": None, "promotion_state": None, "chain_sha256": None}
    ae = active_authority_errors(caps, active)
    if ae:
        out["reasons"] = ae
        return out
    row = next((r for r in caps["rows"] if method in r["primitives"]), None)
    if row is None:
        out["status"] = "UNKNOWN_METHOD"
        return out
    specs = probe_spec_index(rp)
    spec = specs.get(method)
    if row["evidence_class"] != "QUALIFIED_READ":
        if spec is not None and row.get("probe_candidate") is True and any(p.get("probe_allowed") is True and p["method"] == method for p in (rp.get("logical_operations", {}).get("READ_PRIMITIVE_QUALIFICATION_PROBE") or {}).get("primitives", [])):
            out["status"] = "PROBE_ALLOWED"
        return out
    rf = caps.get("refreeze") or {}
    errs = refreeze_block_errors(caps, rp)
    if rf.get("reviewed") is not True:
        errs.append("refreeze block not reviewed")
    entries = [x for x in row.get("evidence_records", []) if x.get("method") == method and x.get("result") is None]
    if len(entries) != 1:
        out["reasons"] = errs + [f"row carries {len(entries)} v1.7 evidence entries for this method (exactly one is required)"]
        return out
    x = entries[0]
    out.update(raw_capture_sha256=x.get("raw_capture_sha256"), derived_result_sha256=x.get("derived_result_sha256"), review_decision_sha256=x.get("review_decision_sha256"))
    for k, lst in (("raw_capture_sha256", "promoted_raw_capture_sha256"), ("derived_result_sha256", "promoted_derived_result_sha256"), ("review_decision_sha256", "promoted_review_decision_sha256")):
        if x.get(k) not in (rf.get(lst) or []):
            errs.append(f"refreeze block does not promote this {k}")
    if x.get("probe_id") not in (rf.get("promoted_probe_ids") or []):
        errs.append("refreeze block does not promote this probe id")
    if (es or {}).get("session_manifest") is not None:
        errs += [f"session authority: {e}" for e in session_manifest_errors(es["session_manifest"], env, active, rp)[:2]]
    chain = resolve_stored_chain(x, method, caps, rp, es, env, active, spec)
    errs += chain["errors"]
    out["chain_sha256"] = chain["chain_sha256"]
    errs = [e for e in errs if e]
    out["reasons"] = errs
    out["status"] = "QUALIFIED_CALLABLE" if not errs else "UNQUALIFIED"
    return out


def primitive_status(caps, rp_or_entry, method, es, env, active, rp=None, _ck=None):
    """QUALIFIED_CALLABLE | PROBE_ALLOWED | UNQUALIFIED | UNKNOWN_METHOD, fully derived by capability_qualification (content-bound
    active matrix, reviewed refreeze naming exact digests, raw capture re-parsed NOW to SUCCESS, valid ACCEPT review). The second
    argument is the READ-PRIMITIVES authority (a bare primitive entry is accepted only for PROBE_ALLOWED/UNQUALIFIED decisions)."""
    rp_auth = rp if rp is not None else (rp_or_entry if isinstance(rp_or_entry, dict) and "logical_operations" in rp_or_entry else None)
    if rp_auth is None:
        ae = active_authority_errors(caps, active)
        if ae:
            return "UNQUALIFIED"
        row = next((r for r in caps["rows"] if method in r["primitives"]), None)
        if row is None:
            return "UNKNOWN_METHOD"
        if row["evidence_class"] == "QUALIFIED_READ":
            return "UNQUALIFIED"
        if isinstance(rp_or_entry, dict) and rp_or_entry.get("probe_allowed") is True and row.get("probe_candidate") is True:
            return "PROBE_ALLOWED"
        return "UNQUALIFIED"
    return capability_qualification(caps, rp_auth, method, es, env, active, _ck)["status"]


# ------------------------------------------------------------------ v1.6 REVIEW_DECISION / REFREEZE_RECORD / DERIVED_CAPABILITY_RESULT record laws
def semantic_review_decision(rec, es, rp, env, active):
    """INTERNAL_NON_AUTHORIZING. A REVIEW_DECISION binds raw digest, derived digest, parser, spec, method, receiver, reviewer,
    decision, rationale. ACCEPT is valid only when the raw capture resolves and the reference parser recomputes SUCCESS with the
    bound derived digest; a reviewer can never turn a derived failure into success; reviewer != capture operator."""
    errs = []
    if rec.get("decision") not in REVIEW_DECISIONS:
        errs.append("unknown decision")
    if not rec.get("reviewer") or not rec.get("rationale"):
        errs.append("reviewer and rationale required")
    if rec.get("parser_version") != PARSER_VERSION or rec.get("parser_sha256") != parser_sha256():
        errs.append("review bound to another parser version/hash")
    if rp is not None and rec.get("primitive_spec_sha256") != primitive_spec_digest(rp):
        errs.append("review bound to another primitive spec digest")
    raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=rec.get("raw_capture_sha256")) if not semantic_raw_capture(r, env, active)]
    if len(raws) != 1:
        errs.append("review references a raw capture that is missing, malformed or ambiguous")
        return errs
    cap = raws[0]["capture"]
    if cap.get("method") != rec.get("method") or cap["receiver"]["class"] != rec.get("receiver_class"):
        errs.append("review method/receiver differ from the raw capture")
    if rec.get("reviewer") == cap.get("operator"):
        errs.append("reviewer must differ from the probe operator")
    if rec.get("probe_id") != cap.get("probe_id") or rec.get("session_id") != cap.get("session_id"):
        errs.append("review probe/session differ from the raw capture")
    spec = probe_spec_index(rp).get(cap.get("method")) if rp is not None else None
    derived = derive_capability_result(cap, spec, env, active)
    if rec.get("derived_result_sha256") != derived["derived_result_sha256"]:
        errs.append("review references a derived result that does not recompute under the active parser/spec")
    if rec.get("decision") == "ACCEPT" and derived["classification"] != "SUCCESS":
        errs.append(f"ACCEPT over derived {derived['classification']} is not permitted")
    return errs


def semantic_derived_result_record(rec, es, rp, env, active):
    """INTERNAL_NON_AUTHORIZING. A stored DERIVED_CAPABILITY_RESULT is a cache: it must equal the recomputation byte for byte."""
    errs = []
    d = rec.get("derived")
    if not isinstance(d, dict) or not derived_result_digest_ok(d) or d.get("derived_result_sha256") != rec.get("derived_result_sha256"):
        errs.append("derived body missing / digest does not re-hash / record digest mismatch")
    raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=rec.get("raw_capture_sha256")) if not semantic_raw_capture(r, env, active)]
    if len(raws) != 1:
        errs.append("derived result references a raw capture that is missing, malformed or ambiguous")
        return errs
    cap = raws[0]["capture"]
    spec = probe_spec_index(rp).get(cap.get("method")) if rp is not None else None
    rec_d = derive_capability_result(cap, spec, env, active)
    if canon(d) != canon(rec_d):
        errs.append("stored derived result differs from the recomputation (stale parser/spec or forged)")
    return errs


def semantic_refreeze_record(rec, caps, es, rp, env, active):
    """INTERNAL_NON_AUTHORIZING. A REFREEZE_RECORD binds parent + successor matrix, parser, spec, probe/session, the promoted raw,
    derived and review digests and the contract environment. Every promotion must resolve to a raw capture that re-parses to
    SUCCESS, a valid ACCEPT review of exactly that raw+derived pair, and the successor matrix must list the same digests."""
    errs = []
    if rec.get("kind") != "M0_READ_REQUALIFICATION":
        errs.append("kind")
    if rec.get("authority_version") != active["authority_version"] or rec.get("manifest_sha256") != active["manifest_sha256"]:
        errs.append("refreeze not bound to the active authority")
    if rec.get("parser_version") != PARSER_VERSION or rec.get("parser_sha256") != parser_sha256():
        errs.append("refreeze bound to another parser version/hash")
    if rp is not None and rec.get("primitive_spec_sha256") != primitive_spec_digest(rp):
        errs.append("refreeze bound to another primitive spec digest")
    for k in ("host_name", "product", "resolve_version", "build"):
        if rec.get(k) != env.get(k):
            errs.append(f"refreeze {k} differs from the contract environment")
    if not rec.get("approver"):
        errs.append("refreeze requires a human approver")
    if caps is not None:
        if rec.get("capability_matrix_sha256") != capability_matrix_digest(caps):
            errs.append("refreeze does not name the supplied successor matrix")
        rf = caps.get("refreeze") or {}
        for k in ("promoted_raw_capture_sha256", "promoted_derived_result_sha256", "promoted_review_decision_sha256", "promoted_probe_ids"):
            if sorted(rec.get(k) or []) != sorted(rf.get(k) or []):
                errs.append(f"refreeze record {k} differs from the matrix refreeze block")
        if rf.get("parent_capability_matrix_sha256") != rec.get("parent_capability_matrix_sha256"):
            errs.append("parent matrix differs between record and matrix block")
        if rec.get("reviewed") is True and rf.get("reviewed") is not True:
            errs.append("record reviewed but matrix block unreviewed")
    promoted = rec.get("promoted_raw_capture_sha256") or []
    if len(set(promoted)) != len(promoted):
        errs.append("duplicate promoted raw digests")
    for rsha in promoted:
        raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=rsha) if not semantic_raw_capture(r, env, active)]
        if len(raws) != 1:
            errs.append(f"{rsha[:12]}: promoted raw capture missing/malformed/ambiguous")
            continue
        cap = raws[0]["capture"]
        if cap.get("probe_id") != rec.get("probe_id") or cap.get("session_id") != rec.get("session_id"):
            errs.append(f"{cap.get('method')}: raw capture from another probe/session")
        spec = probe_spec_index(rp).get(cap.get("method")) if rp is not None else None
        d = derive_capability_result(cap, spec, env, active)
        if d["classification"] != "SUCCESS":
            errs.append(f"{cap.get('method')}: derived {d['classification']} cannot be promoted")
        if d["derived_result_sha256"] not in (rec.get("promoted_derived_result_sha256") or []):
            errs.append(f"{cap.get('method')}: recomputed derived digest is not among the promoted derived digests")
        rvs = [r for r in find_records(es, "REVIEW_DECISION", raw_capture_sha256=rsha) if r["record_id"] in (rec.get("promoted_review_decision_sha256") or [])]
        if len(rvs) != 1:
            errs.append(f"{cap.get('method')}: no promoted REVIEW_DECISION for this raw capture")
            continue
        rv = rvs[0]
        if rv.get("decision") != "ACCEPT" or rv.get("derived_result_sha256") != d["derived_result_sha256"] or semantic_review_decision(rv, es, rp, env, active):
            errs.append(f"{cap.get('method')}: promoted review is not a valid ACCEPT of exactly this raw+derived pair")
    return errs


# ------------------------------------------------------------------ v1.6 promotion state (derived, never declared)
def promotion_state(raw_capture_sha256, caps, es, rp, env, active):
    """Derived promotion state of one raw capture: CANDIDATE (capture resolves) -> REVIEWED_ACCEPTED | REVIEWED_REJECTED (valid
    review) -> PROMOTED_IN_REFREEZE (valid reviewed REFREEZE_RECORD + matrix entry) -> ACTIVE_QUALIFIED_READ (that matrix is the
    active one and the method is QUALIFIED_CALLABLE through this capture). Returns {state, reasons}. No jump is possible: each
    state requires the previous one's evidence to still hold."""
    out = {"state": None, "reasons": []}
    raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=raw_capture_sha256) if not semantic_raw_capture(r, env, active)]
    if len(raws) != 1:
        out["reasons"].append("no well-formed raw capture")
        return out
    out["state"] = "CANDIDATE"
    cap = raws[0]["capture"]
    reviews = [r for r in find_records(es, "REVIEW_DECISION", raw_capture_sha256=raw_capture_sha256) if not semantic_review_decision(r, es, rp, env, active)]
    if not reviews:
        out["reasons"].append("no valid review")
        return out
    if any(r.get("decision") == "REJECT" for r in reviews):
        out["state"] = "REVIEWED_REJECTED"
        return out
    if not any(r.get("decision") == "ACCEPT" for r in reviews):
        out["reasons"].append("review deferred")
        return out
    out["state"] = "REVIEWED_ACCEPTED"
    refz = [r for r in find_records(es, "REFREEZE_RECORD") if r.get("reviewed") is True and raw_capture_sha256 in (r.get("promoted_raw_capture_sha256") or []) and not semantic_refreeze_record(r, None, es, rp, env, active)]
    if not refz:
        out["reasons"].append("no valid reviewed refreeze promotes this capture")
        return out
    out["state"] = "PROMOTED_IN_REFREEZE"
    q = capability_qualification(caps, rp, cap.get("method"), es, env, active) if caps is not None else {"status": "UNQUALIFIED", "reasons": ["no matrix"], "raw_capture_sha256": None}
    if q["status"] == "QUALIFIED_CALLABLE" and q["raw_capture_sha256"] == raw_capture_sha256 and any(r.get("capability_matrix_sha256") == active.get("capability_matrix_sha256") for r in refz):
        out["state"] = "ACTIVE_QUALIFIED_READ"
    else:
        out["reasons"] += q["reasons"][:2] or ["matrix not active"]
    return out


def promotion_step(state, event, ctx):
    """INTERNAL_NON_AUTHORIZING. Transition table with fail-closed guards: REVIEW_ACCEPT | REVIEW_REJECT | REFREEZE | ACTIVATE."""
    target = {"REVIEW_ACCEPT": "REVIEWED_ACCEPTED", "REVIEW_REJECT": "REVIEWED_REJECTED", "REFREEZE": "PROMOTED_IN_REFREEZE", "ACTIVATE": "ACTIVE_QUALIFIED_READ"}.get(event)
    if target is None or target not in PROMOTION_TRANSITIONS.get(state, set()):
        return state, f"illegal transition {state} --{event}--> {target}"
    if event == "REVIEW_ACCEPT" and (ctx.get("review_errors") or ctx.get("derived_class") != "SUCCESS"):
        return state, "REVIEW_ACCEPT guard failed (review invalid or derived not SUCCESS)"
    if event == "REFREEZE" and (ctx.get("refreeze_errors") or not ctx.get("promoted")):
        return state, "REFREEZE guard failed"
    if event == "ACTIVATE" and (ctx.get("active_matrix_sha256") != ctx.get("refreeze_matrix_sha256") or ctx.get("qualification_status") != "QUALIFIED_CALLABLE"):
        return state, "ACTIVATE guard failed (matrix not active or primitive not derivable as QUALIFIED_CALLABLE)"
    return target, None


# ------------------------------------------------------------------ v1.6 identity evidence (claims A/B/C derived from re-parsed captures)
IDENTITY_CLAIM_CODES = ("DUPLICATE_RECEIVER_PATH", "PATH_HANDLE_CONFLICT", "PATH_ID_CONFLICT", "DUPLICATE_ATTEMPT_ID",
                        "NULL_RECEIVER_PATH", "MISSING_HANDLE_TOKEN", "PASS_SET_MISMATCH", "EMPTY_PASS")


def identity_claim_inputs(captures, spec, env, active):
    """INTERNAL_NON_AUTHORIZING. Section 14 (C16-M1). Build the identity observations of ONE read pass as an ORDERED LIST, one entry per capture, in
    capture order, BEFORE any map or index exists. Nothing is written into a dictionary keyed by receiver path here, so no
    observation can overwrite another and no conflict can disappear. Returns (observations, errors)."""
    obs, errs = [], []
    for i, raw in enumerate(captures or []):
        d = derive_capability_result(raw, spec, env, active)
        rcv = raw.get("receiver") or {}
        obs.append({
            "ordinal": i,
            "receiver_path": rcv.get("path"),
            "handle_token": rcv.get("handle_token"),
            "attempt_id": raw.get("getter_attempt_id"),
            "raw_capture_sha256": raw.get("raw_digest"),
            "derived_result_sha256": d["derived_result_sha256"],
            "classification": d["classification"],
            "identity_value": (raw.get("returned") or {}).get("value", {}).get("v") if d["classification"] == "SUCCESS" else None,
        })
    if not obs:
        errs.append("EMPTY_PASS: a read pass carries no identity captures")
    return obs, errs


def identity_claim_input_errors(obs):
    """INTERNAL_NON_AUTHORIZING. Section 13 (C16-M1). Validate the ordered observation list of one pass BEFORE any uniqueness or stability map is
    built. Every one of these was silently survivable in v1.6, where `ids[path] = value` let a second observation overwrite
    the first and the conflict vanished:
      DUPLICATE_RECEIVER_PATH  the same receiver path observed twice in one pass
      PATH_HANDLE_CONFLICT     the same receiver path under two different handle tokens
      PATH_ID_CONFLICT         the same receiver path returning two different identity values
      DUPLICATE_ATTEMPT_ID     two observations sharing one getter attempt id
      NULL_RECEIVER_PATH       an observation with no receiver path to be unique about
      MISSING_HANDLE_TOKEN     an observation with no handle token to bind the path to a live object
    A pass with any of these produces no claims at all; there is no first-wins and no last-wins."""
    errs = []
    seen_path, seen_attempt = {}, {}
    for o in obs:
        p, h, a = o["receiver_path"], o["handle_token"], o["attempt_id"]
        if not isinstance(p, str) or not p:
            errs.append(f"NULL_RECEIVER_PATH: observation {o['ordinal']} has no receiver path")
            continue
        if not isinstance(h, str) or not h:
            errs.append(f"MISSING_HANDLE_TOKEN: {p}")
        if isinstance(a, str) and a:
            if a in seen_attempt:
                errs.append(f"DUPLICATE_ATTEMPT_ID: {a} used by observations {seen_attempt[a]} and {o['ordinal']}")
            else:
                seen_attempt[a] = o["ordinal"]
        prev = seen_path.get(p)
        if prev is None:
            seen_path[p] = o
            continue
        errs.append(f"DUPLICATE_RECEIVER_PATH: {p} observed by observations {prev['ordinal']} and {o['ordinal']}")
        if prev["handle_token"] != h:
            errs.append(f"PATH_HANDLE_CONFLICT: {p} under handle tokens {prev['handle_token']!r} and {h!r}")
        if prev["identity_value"] != o["identity_value"]:
            errs.append(f"PATH_ID_CONFLICT: {p} returned {prev['identity_value']!r} and {o['identity_value']!r}")
    return sorted(set(errs))


def identity_claims(captures_by_pass, spec, env, active):
    """INTERNAL_NON_AUTHORIZING. captures_by_pass: list (one per consecutive no-mutation read pass) of lists of RAW captures of the
    identity getter, one per receiver (item). Claims: A callable (every capture derives SUCCESS); B unique within one pass; C stable
    across >= 3 passes (same receiver path -> same id). Mutation/save survival is never inferred (M3).

    v1.7 corrections (C16-M1):
      * each pass is first built as an ORDERED LIST and validated for receiver-path, handle-token and attempt-id uniqueness
        (identity_claim_input_errors) BEFORE any uniqueness or stability index exists. A duplicate receiver path is a
        refusal, not a dictionary overwrite that makes the duplicate disappear;
      * claim C can never be asserted while claim B is false: identity that is not unique within a single pass is not
        identity, so its apparent stability across passes says nothing;
      * every pass must observe exactly the same receiver-path set, otherwise stability compares different populations."""
    passes, raw_shas, derived_shas, errs = [], [], [], []
    for pi, caps in enumerate(captures_by_pass or []):
        obs, oerr = identity_claim_inputs(caps, spec, env, active)
        errs += [f"pass {pi}: {e}" for e in oerr + identity_claim_input_errors(obs)]
        for o in obs:
            raw_shas.append(o["raw_capture_sha256"])
            derived_shas.append(o["derived_result_sha256"])
        passes.append({"observations": obs, "all_success": bool(obs) and all(o["classification"] == "SUCCESS" for o in obs)})
    first_obs = passes[0]["observations"] if passes else []
    first = {o["receiver_path"]: o["identity_value"] for o in first_obs}
    paths = [o["receiver_path"] for o in first_obs]
    for pi, p in enumerate(passes[1:], start=1):
        if sorted(o["receiver_path"] for o in p["observations"]) != sorted(paths):
            errs.append(f"pass {pi}: PASS_SET_MISMATCH: this pass observes a different receiver-path set than pass 0")
    errs = sorted(set(errs))
    vals = [v for v in first.values() if v is not None]
    dups = sorted({v for v in vals if vals.count(v) > 1})
    nulls = sorted(p for p, v in first.items() if v is None)
    a = (not errs) and bool(passes) and all(p["all_success"] for p in passes) and bool(vals)
    b = a and not dups and not nulls
    c = b and len(passes) >= 3 and all({o["receiver_path"]: o["identity_value"] for o in p["observations"]} == first for p in passes[1:])
    return {"claim_A_callable": a, "claim_B_unique_within_pass": b, "claim_C_stable_across_passes": c, "passes": len(passes), "items": len(first), "duplicates": dups, "null_paths": nulls, "input_errors": errs, "observation_count": sum(len(p["observations"]) for p in passes), "raw_capture_sha256s": sorted(set(raw_shas)), "derived_result_sha256s": sorted(set(derived_shas)),
            "not_claimed": ["survival across append/replace/delete (M3 P6)", "survival across save/reopen (M3 P15)", "uniqueness across timelines or projects"]}


def semantic_identity_observation(rec, es, rp, env, active):
    """INTERNAL_NON_AUTHORIZING. IDENTITY_UNIQUENESS_OBSERVATION / IDENTITY_STABILITY_OBSERVATION carry pass lists of raw capture digests;
    the declared claims are a cache and must equal the claims recomputed from the re-parsed captures in the evidence set."""
    errs = []
    rt = rec.get("record_type")
    passes_sha = rec.get("passes") or []
    if not isinstance(passes_sha, list) or not passes_sha:
        return ["passes must be a non-empty list of raw capture digest lists"]
    if rt == "IDENTITY_STABILITY_OBSERVATION" and len(passes_sha) < 3:
        errs.append("stability requires >= 3 passes")
    method = rec.get("method")
    spec = probe_spec_index(rp).get(method) if rp is not None else None
    if spec is None:
        errs.append("identity method has no primitive spec")
    caps_by_pass = []
    for i, lst in enumerate(passes_sha):
        caps = []
        for sha in lst or []:
            raws = [r for r in find_records(es, "RAW_CAPABILITY_CAPTURE", raw_capture_sha256=sha) if not semantic_raw_capture(r, env, active)]
            if len(raws) != 1:
                errs.append(f"pass {i}: raw capture {str(sha)[:12]} missing/malformed/ambiguous")
                continue
            c = raws[0]["capture"]
            if c.get("method") != method or c.get("session_id") != (rec.get("envelope") or {}).get("session_id"):
                errs.append(f"pass {i}: capture {str(sha)[:12]} is another method or session")
            caps.append(c)
        caps_by_pass.append(caps)
    if errs:
        return errs
    claims = identity_claims(caps_by_pass, spec, env, active)
    if claims["input_errors"]:
        errs.append("identity claim inputs refused: " + claims["input_errors"][0])
    for k in ("claim_A_callable", "claim_B_unique_within_pass", "claim_C_stable_across_passes", "duplicates", "null_paths", "items", "input_errors", "observation_count"):
        if canon(rec.get("claims", {}).get(k)) != canon(claims[k]):
            errs.append(f"declared claims.{k} differs from the recomputation")
    if rt == "IDENTITY_UNIQUENESS_OBSERVATION" and rec.get("claims", {}).get("claim_C_stable_across_passes") not in (None, False, claims["claim_C_stable_across_passes"]):
        errs.append("uniqueness observation may not assert stability")
    if any("surviv" in str(k).lower() for k in (rec.get("claims") or {})):
        errs.append("identity observation may not claim survival (M3)")
    return errs


# ------------------------------------------------------------------ v1.6 GUARD_SNAPSHOT record law (H0 proven before any mutator)
def guard_record_errors(rec, active, env, es, rp, caps, request_target=None, plan_h0_guard=None, required_profile=None):
    """INTERNAL_NON_AUTHORIZING (composed by evaluate_eligibility GUARD_CURRENT). The record carries the whole guard object (v3) and
    the snapshot's method_provenance; the evaluator recomputes guard_digest and provenance_sha256 from them, so profile,
    completeness, provenance, matrix, target and authority are PROVEN fields of the guarded snapshot, not declarations."""
    errs = []
    g = rec.get("guard")
    mp = rec.get("method_provenance")
    if not isinstance(g, dict) or not isinstance(mp, dict):
        return ["guard record must carry the guard object and method_provenance"]
    try:
        if digest(g, "vidtoolz.resolveGuard.v3") != rec.get("guard_digest"):
            errs.append("guard object does not re-hash to guard_digest")
        if digest(mp, "vidtoolz.resolveProvenance.v1") != g.get("provenance_sha256"):
            errs.append("method_provenance does not re-hash to guard.provenance_sha256")
    except CanonError as e:
        return [f"guard record not canonicalizable: {e}"]
    if g.get("payload_sha256") != rec.get("payload_sha256"):
        errs.append("record payload_sha256 != guard payload_sha256")
    if not is_sha(rec.get("snapshot_object_sha256")):
        errs.append("snapshot_object_sha256 required")
    cov = g.get("coverage") or {}
    pol = g.get("policy") or {}
    if plan_h0_guard is not None and rec.get("guard_digest") != plan_h0_guard:
        errs.append("plan H0 guard digest is not this guard record")
    if required_profile is not None:
        if not profile_satisfies(cov.get("profile"), required_profile):
            errs.append(f"H0_PROFILE: snapshot profile {cov.get('profile')!r} does not satisfy {required_profile} (degraded/M0-only snapshot can never be a write precondition)")
        if cov.get("complete") is not True:
            errs.append("H0_INCOMPLETE: guarded snapshot is not complete")
        prof = COVERAGE_PROFILES.get(required_profile) or {}
        missing = set(prof.get("mandatory_domains", [])) - set(cov.get("observed_domains") or [])
        if missing:
            errs.append(f"H0_DOMAINS: mandatory domains not observed {sorted(missing)}")
        for k in ("project", "timeline"):
            if (g.get(k) or {}).get("unique_id_status") != "OBSERVED" or not (g.get(k) or {}).get("unique_id"):
                errs.append(f"H0_IDENTITY: {k} unique_id not OBSERVED in the guarded snapshot")
    if pol.get("capability_matrix_sha256") != active.get("capability_matrix_sha256"):
        errs.append("H0_MATRIX: guarded snapshot collected under another capability matrix")
    if caps is not None and pol.get("capabilities_version") != caps.get("version"):
        errs.append("H0_MATRIX: guarded snapshot policy names another capability matrix version")
    if rec.get("authority_version") != active.get("authority_version"):
        errs.append("H0_AUTHORITY: guard record bound to another authority version")
    if request_target is not None:
        tgt = {"library_instance_uuid": (g.get("library") or {}).get("instance_uuid"), "project_unique_id": (g.get("project") or {}).get("unique_id"), "timeline_unique_id": (g.get("timeline") or {}).get("unique_id"), "target_epoch": g.get("target_epoch")}
        want = {k: (request_target or {}).get(k) for k in tgt}
        if tgt != want:
            errs.append("H0_TARGET: guarded snapshot identity differs from the plan target")
    _ck = content_key(caps, rp, es, env, active)
    for m, pv in sorted(mp.items()):
        if not isinstance(pv, dict) or pv.get("observation_class") not in OBSERVATION_CLASSES:
            errs.append(f"H0_PROVENANCE: {m} unknown observation_class")
            continue
        if required_profile is not None and pv.get("observation_class") != "QUALIFIED_OBSERVATION":
            errs.append(f"H0_PROVENANCE: {m} is {pv.get('observation_class')}; a write precondition requires QUALIFIED_OBSERVATION for every provenance entry")
            continue
        if pv.get("observation_class") == "QUALIFIED_OBSERVATION" and caps is not None and rp is not None:
            q = capability_qualification(caps, rp, m, es, env, active, _ck)
            rid = pv.get("raw_capture_record_id")
            rr = (es or {}).get("records", {}).get(rid) if is_sha(rid) else None
            if q["status"] != "QUALIFIED_CALLABLE" or rr is None or rr.get("record_type") != "RAW_CAPABILITY_CAPTURE" or rr.get("raw_capture_sha256") != q["raw_capture_sha256"] or pv.get("capability_matrix_sha256") != active.get("capability_matrix_sha256"):
                errs.append(f"H0_PROVENANCE: {m} QUALIFIED_OBSERVATION does not resolve to the active qualified capture ({(q['reasons'] or ['record/matrix mismatch'])[0][:60]})")
    if required_profile is not None:
        prof = COVERAGE_PROFILES.get(required_profile) or {}
        needed = set()
        for fld in prof.get("mandatory_timeline_fields", []):
            needed.update(FIELD_PRIMITIVE.get("timeline." + fld, []))
        for fld in prof.get("mandatory_item_fields", []):
            needed.update(FIELD_PRIMITIVE.get("item." + fld, []))
        for d in prof.get("mandatory_domains", []):
            needed.update(DOMAIN_PRIMITIVE.get(d, []))
        for k in prof.get("identity_required", []):
            needed.update(FIELD_PRIMITIVE.get(k, []))
        if prof.get("track_locks_required"):
            needed.update(FIELD_PRIMITIVE["track.locked"])
        absent = sorted(m for m in needed if (mp.get(m) or {}).get("observation_class") != "QUALIFIED_OBSERVATION")
        if absent:
            errs.append(f"H0_PROVENANCE: producing primitives of mandatory fields lack QUALIFIED_OBSERVATION provenance {absent[:4]}")
    return errs


# ------------------------------------------------------------------ eligibility (consumes validated authority only)
def permission_lookup(perms, milestone, operation, scope):
    if perms.get("default") != "DENY":
        return {"allowed": False, "reason": "permission authority default is not DENY"}
    if milestone not in perms["milestones"] or scope not in perms["scopes"]:
        return {"allowed": False, "reason": "unknown milestone or scope"}
    if operation in perms["denied_all_scopes"]:
        return {"allowed": False, "reason": "denied in all scopes"}
    for e in perms["entries"]:
        if e["milestone"] == milestone and e["operation"] == operation and e["scope"] == scope:
            return {"allowed": bool(e["allowed"]), "reason": "explicit entry", "entry": e}
    return {"allowed": False, "reason": "no explicit entry (default DENY)"}


def _target_binding(request, tc, es, requirement, need_ids, derived):
    """PROJECT/PROJECT_TIMELINE are proven by CURRENT binding observations of the current session, coherent with the
    provisioning record; never by whatever project/timeline is active."""
    errs = []
    if requirement == "SESSION":
        return errs
    sid = derived.get("session_id")
    prov_id = derived["proofs"].get("provisioning")
    if sid is None or prov_id is None:
        return ["no current session/provisioning to bind a project to"]
    pname = request.get("expected_project_name")
    if not pname:
        return ["target requirement PROJECT: expected_project_name missing"]
    pb, st = current_record(es, "PROJECT_BINDING_OBSERVATION", sid, project_name=pname)
    if pb is None:
        errs.append(f"no CURRENT PROJECT_BINDING_OBSERVATION for expected project {pname!r} in the current session ({st})")
    else:
        e = pb["envelope"]
        if e.get("library_name") != tc["library"]["name"] or e.get("provisioning_id") != prov_id or e.get("project_name") != pname:
            errs.append("project binding observation is not bound to the contract library / provisioning / expected project")
    prefixed = pname.startswith(tc["naming"]["project_prefix"])
    if not prefixed and not [r for r in find_records(es, "OPERATOR_PROVISIONED_PROJECT", project_name=pname) if r["envelope"].get("library_name") == tc["library"]["name"]]:
        errs.append(f"project {pname!r} is neither adapter-prefixed nor operator-provisioned in the contract library")
    if need_ids and pb and (pb.get("project_unique_id_status") != "OBSERVED" or not pb.get("project_unique_id")):
        errs.append("write-capable target requires OBSERVED project_unique_id")
    if requirement == "PROJECT_TIMELINE":
        tname = request.get("expected_timeline_name")
        if not tname:
            return errs + ["target requirement PROJECT_TIMELINE: expected_timeline_name missing"]
        tb, st2 = current_record(es, "TIMELINE_BINDING_OBSERVATION", sid, project_name=pname, timeline_name=tname)
        if tb is None:
            errs.append(f"no CURRENT TIMELINE_BINDING_OBSERVATION for {pname!r}/{tname!r} in the current session ({st2})")
        else:
            e = tb["envelope"]
            if e.get("library_name") != tc["library"]["name"] or e.get("provisioning_id") != prov_id or e.get("project_name") != pname or e.get("timeline_name") != tname:
                errs.append("timeline binding observation is not bound to the same library / provisioning / project / timeline")
            if pb and pb.get("project_unique_id") and tb.get("project_unique_id") not in (None, pb.get("project_unique_id")):
                errs.append("timeline binding names a different project id than the project binding")
            if need_ids and (tb.get("timeline_unique_id_status") != "OBSERVED" or not tb.get("timeline_unique_id")):
                errs.append("write-capable target requires OBSERVED timeline_unique_id")
    return errs


def evaluate_eligibility(perms, request, rp, caps, tc, es, active):
    """DIAGNOSTIC / NON-AUTHORIZING eligibility (v1.14, V113-B1): it consumes a bare evidence set and therefore
    cannot establish location authority. In v1.13 it was declared authorizing and returned eligible=true for
    forbidden-location evidence. For authority use evaluate_eligibility_authorizing() /
    evaluate_eligibility_for_session()."""
    """Deterministic, fail-closed, order-independent. Attachment state, primitive qualification and every prerequisite
    are DERIVED from (tc, caps, rp, perms, evidence set, active authority); the request carries names and sha256 refs only."""
    out = {"permitted_by_policy": False, "prerequisites_satisfied": False, "eligible": False, "failed_prerequisites": [], "reason_codes": [], "derived_attachment_state": None, "target_requirement": None, "expanded_primitives": [], "attachment_conflicts": []}
    m, op, sc = request.get("milestone"), request.get("operation"), request.get("scope")
    look = permission_lookup(perms, m, op, sc)
    if not look["allowed"]:
        out["reason_codes"].append("NOT_PERMITTED_BY_POLICY:" + look["reason"])
        return out
    entry = look["entry"]
    out["permitted_by_policy"] = True
    ae = active_authority_errors(caps, active)
    if ae:
        out["reason_codes"] += ["CAPABILITY_MATRIX_NOT_ACTIVE"] + ae[:2]
        return out
    derived = derive_attachment_state(tc, es, active)
    out["derived_attachment_state"] = derived["state"]
    out["attachment_conflicts"] = derived["conflicts"]
    if derived["state"] == CONFLICT_STATE:
        out["reason_codes"] += ["ATTACHMENT_CONFLICT"] + derived["failures"][:2] + derived["conflicts"][:3]
        return out
    rp_op = (rp or {}).get("logical_operations", {}).get(op)
    requirement = entry.get("target_requirement") or (rp_op or {}).get("target_requirement")
    out["target_requirement"] = requirement
    if requirement not in TARGET_REQUIREMENTS:
        out["reason_codes"].append("OPERATION_WITHOUT_TARGET_REQUIREMENT")
        return out
    C = _contract_env(tc)
    refs = request.get("refs") or {}
    sid = derived.get("session_id")
    failed = []
    rank = STATE_RANK[derived["state"]]
    codes = list(entry.get("prerequisites", []))
    if "TARGET_REQUIREMENT_SATISFIED" not in codes:
        codes.append("TARGET_REQUIREMENT_SATISFIED")
    for code in codes:
        if code not in PREREQ_CODES:
            failed.append(f"UNKNOWN_PREREQUISITE_CODE:{code}")
            continue
        ok, why = False, ""
        if code == "BUNDLE_INDEPENDENTLY_VERIFIED":
            ok = "bundle_verification" in derived["proofs"]
        elif code.startswith("TARGET_STATE_"):
            ok = rank >= STATE_RANK[code[len("TARGET_STATE_"):]]; why = "; ".join(derived["failures"])
        elif code == "HOST_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"]
        elif code == "LIBRARY_NOT_SHARED":
            ok = tc["library"]["name"] not in tc["library"]["prohibited_library_names"] and not any("prohibited" in f for f in derived["failures"])
        elif code == "LIBRARY_MATCHES_CONTRACT":
            ok = "provisioning" in derived["proofs"] and not any("OBSERVED_TARGET_MISMATCH" in f for f in derived["failures"])
        elif code == "RESOLVE_VERSION_MATCHES":
            ok = "connection" in derived["proofs"]
        elif code in ("M0_EXIT_EVIDENCE", "M1_EXIT_EVIDENCE", "M2_EXIT_EVIDENCE"):
            rec, e = resolve_ref(es, refs.get(code[:2].lower() + "_exit"), "MILESTONE_EXIT", {"host_name": C["host_name"]}, {"milestone": code[:2], "authority_version": active["authority_version"]}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "MIKKO_M3_AUTHORIZATION":
            rec, e = resolve_ref(es, refs.get("authorization"), "M3_AUTHORIZATION", {"host_name": C["host_name"]}, {"scope": "SCRATCH_QUALIFICATION_LIBRARY", "authority_version": active["authority_version"], "library_name": tc["library"]["name"]}, active); ok = rec is not None and bool(rec.get("approver")); why = "; ".join(e)
        elif code == "JOURNAL_PREPARED":
            rec, e = resolve_ref(es, refs.get("journal_prepared"), "JOURNAL_PREPARED", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name")}, {"transaction_id": request.get("transaction_id"), "plan_digest": request.get("plan_digest")}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "READ_ONLY_JOURNAL_OPEN":
            rec, e = resolve_ref(es, refs.get("read_only_journal"), "READ_ONLY_JOURNAL", {"host_name": C["host_name"], "session_id": sid}, None, active); ok = rec is not None; why = "; ".join(e)
        elif code == "GUARD_CURRENT":
            rec, e = resolve_ref(es, refs.get("guard"), "GUARD_SNAPSHOT", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, None, active)
            ok = rec is not None and is_sha(request.get("plan_h0_guard_digest")) and rec.get("guard_digest") == request.get("plan_h0_guard_digest"); why = "; ".join(e) or "guard digest mismatch"
            if ok:
                cur, st = current_record(es, "GUARD_SNAPSHOT", sid, project_name=request.get("expected_project_name"), timeline_name=request.get("expected_timeline_name"))
                ok = cur is not None and cur["record_id"] == rec["record_id"]; why = f"guard record is not the CURRENT guard observation ({st})"
            if ok:
                # v1.6 early write gate (F15-03 / M-H0): the guard record must PROVE profile, completeness, provenance, matrix, target and
                # authority of the guarded snapshot BEFORE any mutator can run; a degraded MINIMAL_M0 / FULL_TIMELINE_READ / incomplete /
                # unqualified-provenance guard can never satisfy write eligibility, whatever the later composed validation would say
                ge = guard_record_errors(rec, active, C, es, rp, caps, request.get("plan_target"), request.get("plan_h0_guard_digest"), S0_REQUIRED_PROFILE if (entry.get("mutation_allowed") or op in GUARD_REQUIRED_OPS) else None)
                ok = not ge; why = "; ".join(ge[:3])
        elif code == "EXCLUSIVE_SESSION_ATTESTED":
            rec, e = resolve_ref(es, refs.get("exclusive_session"), "EXCLUSIVE_SESSION_ATTESTATION", {"host_name": C["host_name"], "session_id": sid}, None, active); ok = rec is not None and bool(rec.get("attested_by")); why = "; ".join(e)
        elif code == "PROJECT_ADAPTER_PREFIXED":
            ok = str(request.get("expected_project_name", "")).startswith(tc["naming"]["project_prefix"])
        elif code == "PRIMITIVES_QUALIFIED_OR_DECLARED_UNOBSERVED":
            exp = []
            for p in (rp_op or {}).get("primitives", []):
                st = primitive_status(caps, p, p["method"], es, C, active, rp=rp)
                exp.append({"method": p["method"], "status": st, "callable": st == "QUALIFIED_CALLABLE", "fallback": p.get("fallback_if_unqualified")})
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] or x["fallback"] in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE") for x in exp)
            why = "REFUSE fallback on unqualified primitive(s): " + ",".join(x["method"] for x in exp if not x["callable"] and x["fallback"] == "REFUSE")
        elif code == "PROBE_ALLOWED_PRIMITIVES":
            exp = []
            for p in (rp_op or {}).get("primitives", []):
                st = primitive_status(caps, p, p["method"], es, C, active, rp=rp)
                exp.append({"method": p["method"], "status": st, "callable": st in ("PROBE_ALLOWED", "QUALIFIED_CALLABLE"), "fallback": "PROBE_ONLY"})
            out["expanded_primitives"] = exp
            ok = bool(exp) and all(x["callable"] for x in exp) and (rp_op or {}).get("purpose_is_qualification") is True and (rp_op or {}).get("read_only") is True
        elif code == "PLAN_VALIDATED":
            rec, e = resolve_ref(es, refs.get("plan_validation"), "PLAN_VALIDATION", {"host_name": C["host_name"]}, {"plan_digest": request.get("plan_digest"), "result": "PASS", "authority_version": active["authority_version"], "validator": PLAN_VALIDATOR_ID}, active)
            ok = rec is not None and (request.get("plan_h0_guard_digest") is None or rec.get("h0_guard_digest") == request.get("plan_h0_guard_digest")) and {"s0", "plan"} <= set(rec.get("stages_completed") or [])
            why = "; ".join(e) or "PLAN_VALIDATION must come from the composed validator (stages s0+plan) and name this plan's H0 guard"
        elif code == "SYNTHETIC_MEDIA_ONLY":
            rec, e = resolve_ref(es, refs.get("media_class"), "MEDIA_CLASS_ATTESTATION", {"host_name": C["host_name"]}, {"media_class": "SYNTHETIC"}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "TIMELINE_IS_DESTINATION":
            rec, e = resolve_ref(es, refs.get("destination_timeline"), "DESTINATION_TIMELINE", {"host_name": C["host_name"], "session_id": sid, "project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, {"project_name": request.get("expected_project_name"), "timeline_name": request.get("expected_timeline_name")}, active); ok = rec is not None; why = "; ".join(e)
        elif code == "TARGET_REQUIREMENT_SATISFIED":
            e = _target_binding(request, tc, es, requirement, bool(entry.get("mutation_allowed")), derived); ok = not e; why = "; ".join(e)
        if not ok:
            failed.append(code + (f" ({why})" if why else ""))
    out["failed_prerequisites"] = failed
    out["prerequisites_satisfied"] = not failed
    out["eligible"] = out["permitted_by_policy"] and not failed
    out["reason_codes"].append("ELIGIBLE" if out["eligible"] else "PREREQUISITES_FAILED")
    return out


# ------------------------------------------------------------------ snapshot observation model, completeness, capability coupling
def _status_value_errors(prefix, status, value, reason):
    if status not in OBS_STATUS:
        return [f"{prefix}: unknown status {status!r}"]
    errs = []
    if status == "OBSERVED" and value is None:
        errs.append(f"{prefix}: status OBSERVED but value null")
    if status != "OBSERVED" and value is not None:
        errs.append(f"{prefix}: status {status} but value present (fabrication)")
    if status in ("UNAVAILABLE", "ERROR") and not reason:
        errs.append(f"{prefix}: status {status} requires a reason")
    return errs


def _observed_needs_callable(prefix, key, fs, callable_methods, errs):
    if callable_methods is None:
        return
    for fld, methods in FIELD_PRIMITIVE.items():
        if not fld.startswith(key + "."):
            continue
        name = fld.split(".", 1)[1]
        if fs.get(name) == "OBSERVED" and not all(m in callable_methods for m in methods):
            errs.append(f"{prefix}.{name}: OBSERVED but producing primitive(s) {methods} not callable in this session")


def _observed_methods(snap):
    """Every primitive that some OBSERVED field or observed domain of this snapshot relies on -> set of methods."""
    used = set()
    proj, tl = snap["project"], snap["payload"]["timeline"]
    for key, fs in (("project", proj.get("field_status") or {}), ("timeline", tl.get("field_status") or {})):
        for fld, methods in FIELD_PRIMITIVE.items():
            if fld.startswith(key + ".") and fs.get(fld.split(".", 1)[1]) == "OBSERVED":
                used.update(methods)
    for t in snap["payload"]["tracks"]:
        tfs = t.get("field_status") or {}
        for fld, methods in FIELD_PRIMITIVE.items():
            if fld.startswith("track.") and tfs.get(fld.split(".", 1)[1]) == "OBSERVED":
                used.update(methods)
        for it in t["items"]:
            fs = it.get("field_status") or {}
            for fld, methods in FIELD_PRIMITIVE.items():
                if fld.startswith("item.") and fs.get(fld.split(".", 1)[1]) == "OBSERVED":
                    used.update(methods)
    for d in set(snap["coverage"]["observed_domains"]) & set(DOMAIN_PRIMITIVE):
        used.update(DOMAIN_PRIMITIVE[d])
    return used


def provenance_errors(snap, ctx):
    """Field provenance law (v1.6): every method an OBSERVED field/domain relies on must appear in collection.method_provenance as a
    QUALIFIED_OBSERVATION whose raw_capture_record_id names the RAW_CAPABILITY_CAPTURE record that the ACTIVE matrix promotes for
    that method (capability_qualification -> QUALIFIED_CALLABLE through exactly that capture, re-parsed NOW to SUCCESS, reviewed
    and refrozen) and whose capability_matrix_sha256 is the active matrix. CANDIDATE_OBSERVATION methods can never back an
    OBSERVED field. ctx = {caps, rp, es, active, tc}."""
    errs = []
    mp = (snap.get("collection") or {}).get("method_provenance")
    if not isinstance(mp, dict):
        return ["collection.method_provenance missing"]
    es, active, caps, rp = ctx["es"], ctx["active"], ctx["caps"], ctx["rp"]
    env = _contract_env(ctx["tc"])
    ae = active_authority_errors(caps, active)
    if ae:
        return ["provenance: " + ae[0]]
    _ck = content_key(caps, rp, es, env, active)
    for m, pv in mp.items():
        if not isinstance(pv, dict) or pv.get("observation_class") not in OBSERVATION_CLASSES:
            errs.append(f"method_provenance[{m}]: unknown observation_class")
    for m in sorted(_observed_methods(snap)):
        pv = mp.get(m)
        if not isinstance(pv, dict):
            errs.append(f"OBSERVED data relies on {m} but collection.method_provenance has no entry (value exists != OBSERVED)")
            continue
        if pv.get("observation_class") != "QUALIFIED_OBSERVATION":
            errs.append(f"OBSERVED data relies on {m} whose observation_class is {pv.get('observation_class')} (candidate/probe output is never OBSERVED)")
            continue
        if pv.get("capability_matrix_sha256") != active.get("capability_matrix_sha256"):
            errs.append(f"method_provenance[{m}]: capability_matrix_sha256 is not the active matrix")
        rid = pv.get("raw_capture_record_id")
        rec = (es or {}).get("records", {}).get(rid) if is_sha(rid) else None
        if rec is None or rec.get("record_type") != "RAW_CAPABILITY_CAPTURE" or record_id(rec) != rid:
            errs.append(f"method_provenance[{m}]: raw_capture_record_id does not resolve to a RAW_CAPABILITY_CAPTURE record")
            continue
        if (rec.get("capture") or {}).get("method") != m:
            errs.append(f"method_provenance[{m}]: cited capture is for {(rec.get('capture') or {}).get('method')} (adjacent getter)")
            continue
        q = capability_qualification(caps, rp, m, es, env, active, _ck)
        if q["status"] != "QUALIFIED_CALLABLE":
            errs.append(f"method_provenance[{m}]: primitive is not QUALIFIED_CALLABLE under the active capability matrix ({(q['reasons'] or ['?'])[0][:80]})")
        elif q["raw_capture_sha256"] != rec.get("raw_capture_sha256"):
            errs.append(f"method_provenance[{m}]: cited capture is not the capture the active matrix promotes for this method")
    return errs


def semantic_snapshot(snap, ctx=None):
    """INTERNAL_NON_AUTHORIZING (composed by validate_transaction_set). ctx = {caps, rp, es, active, tc}: when given, the
    callable set is derived from the active capability authority + evidence set, no field may be OBSERVED unless its producing
    primitive is callable AND cited with qualifying provenance (provenance_errors). Occurrence identity must be unique."""
    errs = []
    callable_methods = callable_method_set(ctx["caps"], ctx["rp"], ctx["es"], ctx["tc"], ctx["active"]) if ctx else None
    coll = snap.get("collection") or {}
    if not isinstance(coll.get("method_provenance"), dict):
        errs.append("collection.method_provenance missing")
    else:
        for m, pv in coll["method_provenance"].items():
            if not isinstance(pv, dict) or pv.get("observation_class") not in OBSERVATION_CLASSES:
                errs.append(f"method_provenance[{m}]: unknown observation_class")
            elif pv["observation_class"] == "QUALIFIED_OBSERVATION" and (not is_sha(pv.get("raw_capture_record_id")) or not is_sha(pv.get("capability_matrix_sha256"))):
                errs.append(f"method_provenance[{m}]: QUALIFIED_OBSERVATION requires raw_capture_record_id and capability_matrix_sha256")
            elif pv["observation_class"] == "NOT_CALLABLE" and pv.get("raw_capture_record_id") is not None:
                errs.append(f"method_provenance[{m}]: NOT_CALLABLE cannot cite a capture")
    _idx, id_errs = occurrence_index(snap, require_identity=False)
    errs += id_errs
    if ctx:
        errs += provenance_errors(snap, ctx)
    cov = snap["coverage"]
    prof = COVERAGE_PROFILES.get(cov.get("profile"))
    if prof is None:
        return [f"unknown coverage profile {cov.get('profile')!r}"]
    obs, unob, deff = set(cov["observed_domains"]), set(cov["unobservable_domains"]), set(cov["deferred_domains"])
    for d in obs | unob | deff:
        if d not in KNOWN_DOMAINS:
            errs.append(f"invented domain name {d!r}")
    excluded = obs & set(PROTECTED_SURFACE_EXCLUSIONS)
    if excluded:
        errs.append(f"domain(s) {sorted(excluded)} are in PROTECTED_SURFACE_EXCLUSIONS: v1.6 does not represent, compare or claim them; they may only be deferred/unobservable")
    if obs & unob or obs & deff:
        errs.append("a domain cannot be both observed and unobservable/deferred")
    mandatory = set(prof["mandatory_domains"])
    proj, tl = snap["project"], snap["payload"]["timeline"]
    pfs, tfs = proj.get("field_status") or {}, tl.get("field_status") or {}
    for f in PROJECT_STATUS_FIELDS:
        errs += _status_value_errors(f"project.{f}", pfs.get(f), proj.get(f), pfs.get(f + "_reason"))
    for f in TIMELINE_STATUS_FIELDS:
        errs += _status_value_errors(f"timeline.{f}", tfs.get(f), tl.get(f), tfs.get(f + "_reason"))
    _observed_needs_callable("project", "project", pfs, callable_methods, errs)
    _observed_needs_callable("timeline", "timeline", tfs, callable_methods, errs)
    if tfs.get("start_frame") == "OBSERVED" and tfs.get("end_frame") == "OBSERVED" and tl.get("end_frame") is not None and tl.get("start_frame") is not None and tl["end_frame"] < tl["start_frame"]:
        errs.append("timeline end_frame < start_frame")
    conv = tl.get("duration_convention")
    if conv not in ("UNQUALIFIED", "END_EXCLUSIVE", "END_INCLUSIVE"):
        errs.append("timeline.duration_convention missing")
    unresolved_tl = {f for f in prof["mandatory_timeline_fields"] if tfs.get(f) != "OBSERVED"}
    unresolved_items = set()
    unresolved_locks = False
    mp_ = (snap.get("collection") or {}).get("method_provenance") or {}
    if callable_methods is not None:
        for mth, pv in mp_.items():
            if isinstance(pv, dict) and pv.get("observation_class") == "QUALIFIED_OBSERVATION" and mth not in callable_methods:
                errs.append(f"collection.method_provenance claims {mth} QUALIFIED_OBSERVATION but the active authority does not qualify it")
        for d in obs & set(DOMAIN_PRIMITIVE):
            if not all(m in callable_methods for m in DOMAIN_PRIMITIVE[d]):
                errs.append(f"domain {d} observed but producing primitive(s) {DOMAIN_PRIMITIVE[d]} not callable")
    for t in snap["payload"]["tracks"]:
        trfs = t.get("field_status") or {}
        for f in TRACK_STATUS_FIELDS:
            errs += _status_value_errors(f"track[{t.get('type')}:{t.get('index')}].{f}", trfs.get(f), t.get(f), trfs.get(f + "_reason"))
        _observed_needs_callable(f"track[{t.get('type')}:{t.get('index')}]", "track", trfs, callable_methods, errs)
        if trfs.get("locked") != "OBSERVED" and prof["track_locks_required"]:
            unresolved_locks = True
        for it in t["items"]:
            fs = it["field_status"]
            pre = f"item[{t.get('type')}:{t.get('index')}#{it.get('observation_ordinal')}]"
            for fld in ITEM_STATUS_FIELDS:
                errs += _status_value_errors(f"{pre}.{fld}", fs.get(fld), it.get(fld), fs.get(fld + "_reason"))
                if fld in prof["mandatory_item_fields"] and fs.get(fld) != "OBSERVED":
                    unresolved_items.add(fld)
            _observed_needs_callable(pre, "item", fs, callable_methods, errs)
            if fs.get("start") == "OBSERVED" and fs.get("end") == "OBSERVED" and it.get("start") is not None and it.get("end") is not None:
                try:
                    s, e = _num(it["start"]), _num(it["end"])
                    if e < s:
                        errs.append(f"{pre}: end < start")
                    if fs.get("duration") == "OBSERVED" and it.get("duration") is not None:
                        d = _num(it["duration"])
                        if conv == "END_EXCLUSIVE" and d != e - s:
                            errs.append(f"{pre}: duration inconsistent with END_EXCLUSIVE convention")
                        elif conv == "END_INCLUSIVE" and d != e - s + 1:
                            errs.append(f"{pre}: duration inconsistent with END_INCLUSIVE convention")
                        elif conv == "UNQUALIFIED" and d not in (e - s, e - s + 1):
                            errs.append(f"{pre}: duration inconsistent with both candidate conventions")
                except CanonError as ce:
                    errs.append(f"{pre}: {ce}")
            if fs.get("source_start") == "OBSERVED" and fs.get("source_end") == "OBSERVED" and it.get("source_start") is not None and it.get("source_end") is not None and _num(it["source_end"]) < _num(it["source_start"]):
                errs.append(f"{pre}: source_end < source_start")
            kind = it["provenance"]["kind"]
            if kind == "MEDIA_BACKED":
                if it["source_status"] == "HASHED" and not it.get("source_sha256"):
                    errs.append("HASHED item without sha")
                if it["source_status"] != "HASHED" and it.get("source_sha256"):
                    errs.append("sha present but status not HASHED")
            elif it["source_status"] != "NOT_APPLICABLE" or it.get("source_sha256") is not None:
                errs.append(f"{kind} item must have NOT_APPLICABLE source and null sha")
    for f in snap["payload"].get("observation_failures", []):
        if not f.get("reason") or f.get("track_address") is None:
            errs.append("observation_failures entries require track_address and reason")
    ident = {"project.unique_id": pfs.get("unique_id"), "timeline.unique_id": tfs.get("unique_id")}
    if cov["complete"]:
        if not obs:
            errs.append("complete:true with empty observed_domains")
        if not mandatory <= obs:
            errs.append(f"complete:true but mandatory domains not observed: {sorted(mandatory - obs)}")
        if unresolved_items:
            errs.append(f"complete:true under {cov['profile']} with unresolved item fields {sorted(unresolved_items)}")
        if unresolved_tl:
            errs.append(f"complete:true under {cov['profile']} with unresolved timeline fields {sorted(unresolved_tl)}")
        for k in prof["identity_required"]:
            if ident[k] != "OBSERVED":
                errs.append(f"complete:true under {cov['profile']} but {k} not OBSERVED")
        if prof["track_locks_required"] and unresolved_locks:
            errs.append("complete:true under WRITE_PRECHECK with unresolved track locks")
        if prof["guard_required"] and not is_sha(snap.get("guard_digest")):
            errs.append("complete:true under WRITE_PRECHECK without guard")
        if snap["payload"].get("observation_failures"):
            errs.append("complete:true with observation_failures present")
        if cov.get("incomplete_reasons"):
            errs.append("complete:true with incomplete_reasons listed")
    else:
        if not cov.get("incomplete_reasons"):
            errs.append("complete:false must list incomplete_reasons")
        degraded_levels = [v for fs_ in [tfs, pfs] + [t.get("field_status") or {} for t in snap["payload"]["tracks"]] for v in fs_.values() if v in ("UNAVAILABLE", "UNSUPPORTED", "ERROR")]
        unresolved_identity = any(ident[k] != "OBSERVED" for k in prof["identity_required"])
        if not (unob or deff or (mandatory - obs) or unresolved_items or unresolved_tl or unresolved_identity or (prof["track_locks_required"] and unresolved_locks) or snap["payload"].get("observation_failures") or degraded_levels):
            errs.append("complete:false must name missing domains/fields (profile-mandatory gaps, degraded timeline/project/track fields or a failure ledger)")
    try:
        if snapshot_payload_digest(snap["payload"]) != snap["payload_sha256"]:
            errs.append("payload_sha256 does not match canonical payload")
        if guard_digest(snap) != snap["guard_digest"]:
            errs.append("guard_digest does not match guard object")
    except CanonError as e:
        errs.append(f"canonicalization error: {e}")
    return errs


def snapshot_result_class(snap):
    """INCOMPLETE / NOT_QUALIFIED vs COMPLETE: a snapshot never claims complete authority when its profile's requirements fail."""
    errs = semantic_snapshot(snap)
    if errs:
        return "INVALID"
    return "COMPLETE" if snap["coverage"]["complete"] else "INCOMPLETE_NOT_QUALIFIED"


# ------------------------------------------------------------------ other frozen-authority semantics (unchanged laws)
def semantic_timebase(tb):
    errs = []
    p = tb["profile_v1"]
    if p["fps"] != {"numerator": 30, "denominator": 1} or p["output_fps"] != 30:
        errs.append("profile_v1 must be exactly 30/1")
    if tb["law"]["name"] != "CEIL_BOUNDARY_V1" or tb["law"]["rounding"] != "CEIL":
        errs.append("rounding law substitution")
    if tb["tolerance"]["planned_vs_observed_frames"] != 0:
        errs.append("exactness redefined")
    for m, expect in ((0, 0), (16, 1), (34, 2), (225183, 6756)):
        if (m * 30 + 999) // 1000 != expect:
            errs.append(f"law arithmetic broken at {m}")
    return errs


def semantic_track_policy(tp):
    errs = []
    for kind in ("video", "audio"):
        idx = [t["index"] for t in tp[kind]]
        if idx != sorted(idx) or len(set(idx)) != len(idx):
            errs.append(f"{kind} indexes must be unique and ascending")
    rv = {t["index"]: t["role"] for t in tp["video"]}
    ra = {t["index"]: t["role"] for t in tp["audio"]}
    if rv.get(1) != "FULL_CANVAS_VISUAL":
        errs.append("video 1 must be FULL_CANVAS_VISUAL")
    if ra.get(1) != "NARRATION" or ra.get(2) != "MUSIC":
        errs.append("audio 1/2 must be NARRATION/MUSIC")
    return errs


def semantic_canary_manifest(cm):
    errs = []
    media = cm["media"]
    roles = [m["role"] for m in media]
    if roles.count("DRAFT_BESPOKE_STILL") != 20 or roles.count("NARRATION") != 1 or roles.count("MUSIC") != 1:
        errs.append("media cardinality must be 20 stills + 1 narration + 1 music")
    ids = [m.get("asset_id") for m in media if m["role"] == "DRAFT_BESPOKE_STILL"]
    if len(set(ids)) != len(ids):
        errs.append("duplicate asset_id")
    for m in media:
        if m["declared_sha256"] != m["preserved_sha256"]:
            errs.append(f"hash mismatch {m.get('asset_id', m['role'])}")
        for k in ("declared_path", "preserved_path"):
            if "/../" in m[k] or m[k].endswith("/..") or not m[k].startswith("/"):
                errs.append(f"bad path {k}")
    shas = [m["declared_sha256"] for m in media]
    if len(set(shas)) != len(shas):
        errs.append("duplicate media record (same sha)")
    return errs


def semantic_capabilities(caps, contract_version="21.1.0", contract_build=14, rp=None):
    """Matrix law (v1.6): QUALIFIED_READ rows need a reviewed refreeze block bound to the active parser + primitive spec and
    v1.6 evidence entries (method, receiver_class, probe_id, raw_capture_sha256, derived_result_sha256, review_decision_sha256,
    parser/spec digests, version-matched, promoted by THIS matrix version) whose digests the refreeze block lists. No entry has a
    writable success/result flag: SUCCESS is derived by capability_qualification from the raw capture. Prior-version records stay
    marked result UNQUALIFIED_PRIOR_VERSION."""
    errs = []
    rf = caps.get("refreeze") or {}
    for k in ("promoted_probe_ids", "promoted_raw_capture_sha256", "promoted_derived_result_sha256", "promoted_review_decision_sha256"):
        if not isinstance(rf.get(k), list):
            errs.append(f"refreeze block lacks {k}")
    if rf.get("reviewed") is True and not (rf.get("review_decision_ref") and rf.get("promoted_raw_capture_sha256")):
        errs.append("reviewed refreeze block must name review_decision_ref and promote at least one raw capture")
    if rf.get("reviewed") is not True and (rf.get("promoted_raw_capture_sha256") or rf.get("promoted_probe_ids")):
        errs.append("unreviewed refreeze block promotes evidence")
    errs += ["refreeze block: " + e for e in refreeze_block_errors(caps, rp)]
    for r in caps["rows"]:
        v16 = [x for x in r.get("evidence_records", []) if x.get("result") is None]
        if r["evidence_class"] == "QUALIFIED_READ":
            good = [x for x in v16 if x.get("version_match") is True and x.get("resolve_version") == contract_version and x.get("build") == contract_build and x.get("method") in r["primitives"] and is_sha(x.get("raw_capture_sha256")) and is_sha(x.get("derived_result_sha256")) and is_sha(x.get("review_decision_sha256")) and x.get("probe_id") and x.get("reviewed_refreeze_version") == caps.get("version")]
            if not good:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ without exact version-matched v1.6 evidence entry (raw/derived/review digests) promoted by this matrix version")
            if rf.get("kind") != "M0_READ_REQUALIFICATION" or rf.get("reviewed") is not True:
                errs.append(f"row '{r['operation']}': QUALIFIED_READ requires a reviewed refreeze block on the matrix")
            for x in good:
                if x["probe_id"] not in (rf.get("promoted_probe_ids") or []) or x["raw_capture_sha256"] not in (rf.get("promoted_raw_capture_sha256") or []) or x["derived_result_sha256"] not in (rf.get("promoted_derived_result_sha256") or []) or x["review_decision_sha256"] not in (rf.get("promoted_review_decision_sha256") or []):
                    errs.append(f"row '{r['operation']}': evidence {x['method']} is not explicitly promoted by the refreeze block (probe id + raw + derived + review digests)")
        elif v16:
            errs.append(f"row '{r['operation']}': v1.6 evidence entry on a row that is not QUALIFIED_READ")
        for x in r.get("evidence_records", []):
            for k in ("host", "resolve_version", "run_ref", "method", "evidence_path"):
                if not x.get(k):
                    errs.append(f"row '{r['operation']}': evidence record missing {k}")
            if x.get("version_match") is True and (x.get("resolve_version") != contract_version or x.get("build") != contract_build):
                errs.append(f"row '{r['operation']}': version_match true but version differs from contract")
            if x.get("result") is None:
                for k in ("receiver_class", "probe_id", "raw_capture_sha256", "derived_result_sha256", "review_decision_sha256", "parser_version", "parser_sha256", "primitive_spec_sha256", "product"):
                    if not x.get(k):
                        errs.append(f"row '{r['operation']}': v1.6 evidence entry missing {k}")
                if x.get("reviewed_refreeze_version") != caps.get("version"):
                    errs.append(f"row '{r['operation']}': evidence promoted under another refreeze version")
                for k in ("success", "classification", "observed_result", "qualified"):
                    if k in x:
                        errs.append(f"row '{r['operation']}': v1.6 evidence entry carries forbidden interpretation field {k}")
            elif x.get("result") != "UNQUALIFIED_PRIOR_VERSION":
                errs.append(f"row '{r['operation']}': evidence result {x.get('result')!r} is not a v1.6 vocabulary (only null or UNQUALIFIED_PRIOR_VERSION)")
        if r.get("probe_candidate") is True and r["evidence_class"] not in ("DOCUMENTED_NOT_QUALIFIED",):
            errs.append(f"row '{r['operation']}': probe_candidate only allowed on DOCUMENTED_NOT_QUALIFIED rows")
    return errs


def semantic_read_primitives(rp, caps, perms=None):
    errs = []
    method_class, probe_rows = {}, {}
    for r in caps["rows"]:
        for p in r["primitives"]:
            method_class.setdefault(p, r["evidence_class"])
            probe_rows.setdefault(p, r.get("probe_candidate") is True)
    for op, spec in rp["logical_operations"].items():
        if spec.get("target_requirement") not in TARGET_REQUIREMENTS:
            errs.append(f"{op}: missing/invalid target_requirement")
        for p in spec["primitives"]:
            cls = method_class.get(p["method"])
            if cls is None:
                errs.append(f"{op}: primitive {p['method']} has no capability row")
            elif cls != p["evidence_class"]:
                errs.append(f"{op}: primitive {p['method']} evidence_class {p['evidence_class']} != matrix {cls}")
            if p["evidence_class"] != "QUALIFIED_READ" and p.get("fallback_if_unqualified") not in ("MARK_UNAVAILABLE", "DOWNGRADE_COVERAGE", "REFUSE", "PROBE_ONLY"):
                errs.append(f"{op}: unqualified primitive {p['method']} without declared fallback")
            if p.get("probe_allowed") and not probe_rows.get(p["method"]):
                errs.append(f"{op}: primitive {p['method']} probe_allowed but matrix row is not probe_candidate")
            if p.get("probe_allowed") and op != "READ_PRIMITIVE_QUALIFICATION_PROBE":
                errs.append(f"{op}: probe_allowed primitives only inside READ_PRIMITIVE_QUALIFICATION_PROBE")
            if not p.get("receiver"):
                errs.append(f"{op}: primitive {p['method']} lacks receiver type")
            if p.get("expected_type") not in EXPECTED_TYPES:
                errs.append(f"{op}: primitive {p['method']} lacks a valid expected_type")
            if op == "READ_PRIMITIVE_QUALIFICATION_PROBE":
                errs += [f"{op}: {e}" for e in spec_errors(primitive_spec(p))]
                if p.get("expectation_status") == "FROZEN" and rp.get("primitive_spec_law", {}).get("frozen_allowed") is not True:
                    errs.append(f"{op}: primitive {p['method']} claims FROZEN expectation without probe-validated refreeze")
        if op == "READ_PRIMITIVE_QUALIFICATION_PROBE":
            if not (spec.get("purpose_is_qualification") is True and spec.get("read_only") is True and spec.get("promotes_capability") is False):
                errs.append("probe operation must declare purpose_is_qualification, read_only and promotes_capability:false")
            if spec.get("evidence_output") != "RAW_CAPABILITY_CAPTURE":
                errs.append("probe evidence_output must be RAW_CAPABILITY_CAPTURE (facts only; the probe never classifies)")
            if rp.get("primitive_spec_sha256") != primitive_spec_digest(rp):
                errs.append("READ-PRIMITIVES.primitive_spec_sha256 does not equal the digest of the probe primitive specs")
            tax = spec.get("failure_taxonomy") or {}
            if {k: sorted(v) for k, v in tax.items()} != {k: sorted(v) for k, v in PROBE_FAILURE_TAXONOMY.items()}:
                errs.append("probe failure_taxonomy differs from authority_lib.PROBE_FAILURE_TAXONOMY")
    if perms is not None:
        for e in perms["entries"]:
            spec = rp["logical_operations"].get(e["operation"])
            if spec and e.get("target_requirement") != spec.get("target_requirement"):
                errs.append(f"PERMISSIONS/{e['milestone']}/{e['operation']}: target_requirement differs from READ-PRIMITIVES")
    return errs


# ------------------------------------------------------------------ plan / journal / verification / conflict / commit (binding + membership + derived delta)
def plan_digest_of(plan):
    return digest({k: v for k, v in plan.items() if k not in ("plan_digest", "refs")}, "vidtoolz.resolveMutationPlan.v1")


def semantic_mutation_plan(plan, perms, rp, caps, tc, es, active, current_guard_digest=None):
    """INTERNAL_NON_AUTHORIZING (composed by the transaction validators).

    v1.15 (V114-B2): `es` may be a GovernedEvidenceSet or a bare evidence-set dict, and the eligibility law is chosen
    BY TYPE, never by a caller-supplied callback (which would be the C16-B2 defect class):

      * GovernedEvidenceSet -> evaluate_eligibility_authorizing, so plan acceptance under the authorizing transaction
        entry point rests on provenance-bearing eligibility;
      * bare dict -> the DIAGNOSTIC evaluate_eligibility, reachable only from the demoted PROVISIONAL_UNTIL_M3
        composition and from fixtures, whose results are not write authority.

    Everything else about mutation-plan semantics is unchanged."""
    errs = []
    governed = es if isinstance(es, GovernedEvidenceSet) else None
    if governed is not None:
        perrs, es = governed_consume(governed, active)
        if perrs:
            return ["LOCATION_AUTHORITY_INVALID: " + e for e in perrs[:3]]
    if plan.get("authority_version") != active["authority_version"]:
        errs.append("plan authority_version != active authority")
    if not is_sha(plan.get("plan_digest")) or not plan.get("transaction_id"):
        errs.append("plan lacks plan_digest/transaction_id")
    elif plan.get("plan_digest") != plan_digest_of(plan):
        errs.append("plan_digest does not match plan body digest")
    if plan.get("operation_set_digest") != operation_set_digest(plan.get("operations", [])):
        errs.append("operation_set_digest does not match operations")
    ids = [o.get("operation_id") for o in plan.get("operations", [])]
    if len(set(ids)) != len(ids) or not all(ids):
        errs.append("operation ids must be unique and non-empty")
    if plan.get("permission_class") == "RESOLVE_READ" and any(o["op"] in WRITE_OPS for o in plan["operations"]):
        errs.append("RESOLVE_READ permission class cannot carry write operations")
    if not plan.get("session_id"):
        errs.append("plan lacks session_id (execution session)")
    elif es is not None and plan.get("session_id") != es.get("current_session_id"):
        errs.append("plan session_id != evidence set current_session_id (execution session mismatch)")
    tgt = plan.get("target") or {}
    for o in plan["operations"]:
        req = {"milestone": plan["milestone"], "operation": o["op"], "scope": plan["scope"], "expected_project_name": tgt.get("project_name"), "expected_timeline_name": tgt.get("timeline_name"), "refs": plan.get("refs") or {}, "transaction_id": plan.get("transaction_id"), "plan_digest": plan.get("plan_digest"), "plan_h0_guard_digest": plan.get("h0_guard_digest"), "plan_target": {k: tgt.get(k) for k in ("library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch")}}
        el = (evaluate_eligibility_authorizing(perms, req, rp, caps, tc, governed, active) if governed is not None
              else evaluate_eligibility(perms, req, rp, caps, tc, es, active))
        if not el["permitted_by_policy"]:
            errs.append(f"operation {o['op']} not permitted at {plan['milestone']}/{plan['scope']}: {el['reason_codes']}")
        elif not plan.get("dry_run") and not el["eligible"]:
            errs.append(f"operation {o['op']} not eligible: {el['failed_prerequisites'] or el['reason_codes']}")
        sel = o.get("selector") or {}
        if o["op"] in WRITE_OPS:
            need = {"library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch", "track_type", "track_index"}
            if o["op"] not in ("APPEND", "IMPORT_MEDIA", "SAVE_PROJECT", "CHECKPOINT_DUPLICATE", "CHECKPOINT_EXPORT_DRT"):
                need |= {"item_unique_id", "expected_start", "expected_end"}
            missing = need - set(sel.keys())
            if missing:
                errs.append(f"selector incomplete for {o['op']}: missing {sorted(missing)}")
            for k in ("library_instance_uuid", "project_unique_id", "timeline_unique_id", "target_epoch"):
                if k in sel and tgt.get(k) is not None and sel[k] != tgt[k]:
                    errs.append(f"selector {k} does not match plan target")
            if o["op"] == "APPEND" and not (isinstance(o.get("expected_new"), dict) and "start" in o["expected_new"] and "end" in o["expected_new"]):
                errs.append("APPEND requires expected_new {start, end}")
        if o["op"] in GUARD_REQUIRED_OPS and not is_sha(plan.get("h0_guard_digest")):
            errs.append(f"operation {o['op']} requires h0_guard_digest")
    if current_guard_digest is not None and plan.get("h0_guard_digest") != current_guard_digest:
        errs.append("plan bound to a different guard digest than the current snapshot (STALE_SNAPSHOT)")
    if plan.get("dry_run") is not True and plan["milestone"] in ("M0", "M1", "M2"):
        errs.append("non-dry-run plan before M3")
    if plan.get("h0_guard_digest") and plan.get("h0_payload_sha256") and plan["h0_guard_digest"] == plan["h0_payload_sha256"]:
        errs.append("payload digest used as guard digest")
    return errs


TERMINAL_STATES = {"COMMITTED", "COMMITTED_RECOVERED", "NOT_APPLIED", "CONFLICT", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS", "ABORTED"}
OPERATION_BEARING_STATES = {"OP_STARTED", "APPLIED", "OP_FAILED"}
JOURNAL_TRANSITIONS = {
    None: {"PREPARED"},
    "PREPARED": {"LEASED", "CONFLICT", "NOT_APPLIED", "ABORTED", "RECOVERY_RECONCILING"},
    "LEASED": {"PREFLIGHT_OK", "CONFLICT", "ABORTED", "RECOVERY_RECONCILING"},
    "PREFLIGHT_OK": {"CHECKPOINTED", "CONFLICT", "RECOVERY_RECONCILING"},  # v1.6 (F15-07): CHECKPOINTED is mandatory before the first OP_STARTED
    "CHECKPOINTED": {"OP_STARTED", "CONFLICT", "RECOVERY_RECONCILING"},
    "OP_STARTED": {"APPLIED", "OP_FAILED", "RECOVERY_RECONCILING"},
    "APPLIED": {"OP_STARTED", "READBACK_S1", "RECOVERY_RECONCILING"},
    "OP_FAILED": {"RECOVERY_RECONCILING", "ABORTED"},
    "READBACK_S1": {"VERIFIED", "CONFLICT", "RECOVERY_RECONCILING"},
    "VERIFIED": {"SAVED", "RECOVERY_RECONCILING"},
    "SAVED": {"PUBLISHED", "RECOVERY_RECONCILING"},
    "PUBLISHED": {"COMMITTED", "RECOVERY_RECONCILING"},
    "RECOVERY_RECONCILING": {"NOT_APPLIED", "COMMITTED_RECOVERED", "ORPHANED_PARTIAL", "ORPHANED_AMBIGUOUS", "RECOVERY_RECONCILING"},
}


def semantic_journal(records, plan=None, s1=None):
    """INTERNAL_NON_AUTHORIZING (composed by validate_transaction_set). Chain, binding, OPERATION MEMBERSHIP, execution
    session and READBACK -> S1 binding: every record carries the transaction's session_id (== plan.session_id); exactly one
    READBACK_S1 record may exist and it must name readback_snapshot_sha256 + readback_guard_digest; when S1 is supplied they
    must equal snapshot_object_digest(S1) and S1.guard_digest and S1 must belong to the same session."""
    errs = []
    if not records:
        return ["empty journal"]
    first = records[0]
    tx, pd, tgt, gd, osd, sid = first.get("transaction_id"), first.get("plan_digest"), first.get("target_ref"), first.get("guard_digest"), first.get("operation_set_digest"), first.get("session_id")
    plan_ops = {}
    if not sid:
        errs.append("journal records lack session_id")
    if plan is not None:
        plan_ops = {o["operation_id"]: o for o in plan.get("operations", [])}
        if pd != plan.get("plan_digest"):
            errs.append("journal plan_digest != plan")
        if tx != plan.get("transaction_id"):
            errs.append("journal transaction_id != plan")
        if gd != plan.get("h0_guard_digest"):
            errs.append("journal guard_digest != plan h0_guard_digest")
        if osd != plan.get("operation_set_digest"):
            errs.append("journal operation_set_digest != plan")
        if sid != plan.get("session_id"):
            errs.append("journal session_id != plan execution session")
        if tgt != {k: (plan.get("target") or {}).get(k) for k in ("project_unique_id", "timeline_unique_id", "library_instance_uuid")}:
            errs.append("journal target_ref != plan target")
    prev_state, prev_hash, expected_seq = None, None, 0
    started, applied = set(), set()
    readbacks = []
    for r in records:
        seq = r.get("sequence")
        if r.get("transaction_id") != tx:
            errs.append(f"seq {seq}: transaction_id changed mid-chain")
        if r.get("plan_digest") != pd:
            errs.append(f"seq {seq}: plan_digest changed mid-chain")
        if r.get("operation_set_digest") != osd:
            errs.append(f"seq {seq}: operation_set_digest changed mid-chain")
        if r.get("target_ref") != tgt:
            errs.append(f"seq {seq}: target_ref changed mid-chain")
        if r.get("session_id") != sid:
            errs.append(f"seq {seq}: session_id changed mid-chain")
        if r.get("guard_digest") != gd and r.get("state") != "RECOVERY_RECONCILING":
            errs.append(f"seq {seq}: guard_digest changed without a recovery transition")
        if seq != expected_seq:
            errs.append(f"seq {seq}: sequence not contiguous (expected {expected_seq})")
        expected_seq = (seq if isinstance(seq, int) else expected_seq) + 1
        if r.get("previous_record_sha256") != prev_hash:
            errs.append(f"seq {seq}: hash chain broken")
        st = r.get("state")
        if st not in JOURNAL_TRANSITIONS.get(prev_state, set()):
            errs.append(f"seq {seq}: illegal transition {prev_state} -> {st}")
        oid = r.get("operation_id")
        if st in OPERATION_BEARING_STATES:
            if oid is None:
                errs.append(f"seq {seq}: {st} without operation_id")
            elif plan is not None and oid not in plan_ops:
                errs.append(f"seq {seq}: operation_id {oid} is not in the bound plan operation set (journal invented an operation)")
            elif plan is not None and r.get("op") != plan_ops[oid]["op"]:
                errs.append(f"seq {seq}: op {r.get('op')} inconsistent with plan entry {plan_ops[oid]['op']}")
            if st == "OP_STARTED":
                if oid in started:
                    errs.append(f"seq {seq}: operation {oid} started twice")
                started.add(oid)
            elif st == "APPLIED":
                if oid in applied:
                    errs.append(f"seq {seq}: operation_id {oid} applied twice")
                if oid not in started:
                    errs.append(f"seq {seq}: APPLIED without a preceding OP_STARTED for {oid}")
                applied.add(oid)
        elif oid is not None or r.get("op") is not None:
            errs.append(f"seq {seq}: non-operation state {st} carries operation_id/op")
        if st == "CHECKPOINTED":
            cp = r.get("checkpoint")
            if not isinstance(cp, dict) or not is_sha(cp.get("checkpoint_sha256")):
                errs.append(f"seq {seq}: CHECKPOINTED must carry checkpoint {{checkpoint_sha256}} (DuplicateTimeline + DRT export + SaveProject evidence)")
        elif r.get("checkpoint") is not None:
            errs.append(f"seq {seq}: only CHECKPOINTED may carry a checkpoint")
        if st == "READBACK_S1":
            readbacks.append(r)
            if not is_sha(r.get("readback_snapshot_sha256")) or not is_sha(r.get("readback_guard_digest")):
                errs.append(f"seq {seq}: READBACK_S1 must name readback_snapshot_sha256 and readback_guard_digest")
            if plan is not None and applied != set(plan_ops):
                errs.append(f"seq {seq}: READBACK_S1 before all plan operations applied (missing {sorted(set(plan_ops) - applied)})")
        elif r.get("readback_snapshot_sha256") is not None or r.get("readback_guard_digest") is not None:
            errs.append(f"seq {seq}: only READBACK_S1 may carry readback digests")
        if st == "RECOVERY_RECONCILING" and r.get("recovery_of_transaction_id") != tx:
            errs.append(f"seq {seq}: recovery record not linked to original transaction")
        if prev_state in TERMINAL_STATES:
            errs.append(f"seq {seq}: record after terminal state {prev_state}")
        prev_state = st
        prev_hash = digest(r, "vidtoolz.resolveJournalRecord.v1")
    if len(readbacks) > 1:
        errs.append("multiple READBACK_S1 records (ambiguous readback)")
    if s1 is not None:
        if not readbacks:
            errs.append("S1 supplied but the journal has no READBACK_S1 event")
        elif len(readbacks) == 1:
            rb = readbacks[0]
            if rb.get("readback_snapshot_sha256") != snapshot_object_digest(s1):
                errs.append("journal READBACK_S1 names a different S1 than the one supplied")
            if rb.get("readback_guard_digest") != s1.get("guard_digest"):
                errs.append("journal READBACK_S1 guard differs from the supplied S1 guard")
        if (s1.get("collection") or {}).get("session_id") != sid:
            errs.append("supplied S1 was collected in a different session than the journal's execution session")
    return errs


def journal_readback(records):
    """INTERNAL_NON_AUTHORIZING. The single READBACK_S1 record, or None when absent/ambiguous."""
    rbs = [r for r in records if r.get("state") == "READBACK_S1"]
    return rbs[0] if len(rbs) == 1 else None


def journal_head(records):
    """INTERNAL_NON_AUTHORIZING. Chain head digest."""
    h = None
    for r in records:
        h = digest(r, "vidtoolz.resolveJournalRecord.v1")
    return h


def journal_applied_ops(records):
    """INTERNAL_NON_AUTHORIZING. Applied operation ids derived from the records."""
    return sorted({r["operation_id"] for r in records if r.get("state") == "APPLIED" and r.get("operation_id")})


# ---- derived delta and expected effects
def occurrence_index(snap, require_identity=True):
    """INTERNAL_NON_AUTHORIZING. Canonical occurrence index keyed by OBSERVED item unique_id. Identity domain = the timeline
    payload. Duplicate OBSERVED ids are an error (DUPLICATE_OCCURRENCE_IDENTITY, addresses listed in canonical order) and the
    index is never built from them; unobserved identity is an error when require_identity. Input order is irrelevant."""
    errs = []
    idx, seen = {}, {}
    for t in sorted(snap["payload"]["tracks"], key=lambda t: (TRACK_TYPE_ORDER.get(t.get("type"), 9), t.get("index", 0))):
        for it in sorted(t["items"], key=lambda it: it.get("observation_ordinal", 0)):
            addr = f"{t['type']}:{t['index']}#{it.get('observation_ordinal')}"
            uid = it.get("unique_id")
            if (it.get("field_status") or {}).get("unique_id") != "OBSERVED" or not uid:
                if require_identity:
                    errs.append(f"{addr}: occurrence identity not OBSERVED")
                continue
            seen.setdefault(uid, []).append(addr)
            idx[uid] = {"unique_id": uid, "track_type": t["type"], "track_index": t["index"], "start": it.get("start"), "end": it.get("end"), "duration": it.get("duration"), "enabled": it.get("enabled"), "media_pool_item_unique_id": it.get("media_pool_item_unique_id"), "media_id": it.get("media_id"), "source_start": it.get("source_start"), "source_end": it.get("source_end"), "source_sha256": it.get("source_sha256"), "source_locator": it.get("source_locator"), "source_status": it.get("source_status"), "name": it.get("name"), "provenance_kind": (it.get("provenance") or {}).get("kind"), "markers": sorted(canon(m) for m in it.get("markers", []))}
    for uid in sorted(seen):
        if len(seen[uid]) > 1:
            errs.append(f"DUPLICATE_OCCURRENCE_IDENTITY: {uid} at {','.join(sorted(seen[uid]))}")
    if errs:
        return None, errs
    return idx, []


def _track_index(snap):
    return {f"{t['type']}:{t['index']}": {k: t.get(k) for k in PROTECTED_TRACK_FIELDS} for t in snap["payload"]["tracks"]}


def _timeline_view(snap):
    tl = snap["payload"]["timeline"]
    return {k: tl.get(k) for k in PROTECTED_TIMELINE_FIELDS}


def _media_view(snap):
    return {canon({"locator": d.get("logical_locator"), "sha": d.get("source_sha256"), "status": d.get("status")}): d for d in snap["payload"].get("media_dependencies", [])}


def derive_delta(s0, s1):
    """INTERNAL_NON_AUTHORIZING. The verifier computes the protected-surface delta from S0 and S1; callers never declare it.
    Returns None (with reasons in derive_delta_errors) when identity is unobserved or duplicated. Order-independent."""
    i0, e0 = occurrence_index(s0)
    i1, e1 = occurrence_index(s1)
    if i0 is None or i1 is None:
        return None
    added = sorted((i1[k] for k in set(i1) - set(i0)), key=lambda x: x["unique_id"])
    removed = sorted((i0[k] for k in set(i0) - set(i1)), key=lambda x: x["unique_id"])
    changed = []
    for k in sorted(set(i0) & set(i1)):
        diff = {f: {"before": i0[k][f], "after": i1[k][f]} for f in PROTECTED_ITEM_FIELDS if i0[k][f] != i1[k][f]}
        if diff:
            changed.append({"unique_id": k, "fields": diff})
    m0 = {marker_sort_key(m): m for m in s0["payload"]["markers"]}
    m1 = {marker_sort_key(m): m for m in s1["payload"]["markers"]}
    t0, t1 = _timeline_view(s0), _timeline_view(s1)
    tr0, tr1 = _track_index(s0), _track_index(s1)
    md0, md1 = _media_view(s0), _media_view(s1)
    return {
        "added": added, "removed": removed, "changed": changed,
        "markers_added": [m1[k] for k in sorted(set(m1) - set(m0))], "markers_removed": [m0[k] for k in sorted(set(m0) - set(m1))],
        "timeline_changed": {f: {"before": t0[f], "after": t1[f]} for f in PROTECTED_TIMELINE_FIELDS if t0[f] != t1[f]},
        "tracks_added": sorted(set(tr1) - set(tr0)), "tracks_removed": sorted(set(tr0) - set(tr1)),
        "tracks_changed": {a: {f: {"before": tr0[a][f], "after": tr1[a][f]} for f in PROTECTED_TRACK_FIELDS if tr0[a][f] != tr1[a][f]} for a in sorted(set(tr0) & set(tr1)) if tr0[a] != tr1[a]},
        "media_added": [md1[k] for k in sorted(set(md1) - set(md0))], "media_removed": [md0[k] for k in sorted(set(md0) - set(md1))],
    }


def derive_delta_errors(s0, s1):
    """INTERNAL_NON_AUTHORIZING. Identity errors (unobserved/duplicate) that make the delta non-derivable."""
    return [f"S0: {e}" for e in occurrence_index(s0)[1]] + [f"S1: {e}" for e in occurrence_index(s1)[1]]


def _q(v):
    return _num(v) if v is not None else None


def expected_effects(plan):
    """INTERNAL_NON_AUTHORIZING. Provisional expected-effect law per operation. Ops outside EFFECT_SPECIFIED_OPS have no derivable effect yet."""
    out = []
    for o in plan.get("operations", []):
        op, sel = o["op"], o.get("selector") or {}
        if op == "APPEND":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "ADDED_ITEM", "track_type": sel.get("track_type"), "track_index": sel.get("track_index"), "start": (o.get("expected_new") or {}).get("start"), "end": (o.get("expected_new") or {}).get("end"), "media_pool_item_unique_id": sel.get("expected_media_pool_item_unique_id")})
        elif op == "DELETE":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "REMOVED_ITEM", "unique_id": sel.get("item_unique_id")})
        elif op in ("DISABLE", "ENABLE"):
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "ENABLED_FLAG", "unique_id": sel.get("item_unique_id"), "after": op == "ENABLE"})
        elif op == "UPSERT_MARKER":
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "MARKER_PRESENT", "custom_data": sel.get("expected_marker_custom_data")})
        else:
            out.append({"operation_id": o["operation_id"], "op": op, "kind": "NOT_YET_SPECIFIED"})
    return out


def verify_transaction(plan, s0, s1, journal):
    """INTERNAL_NON_AUTHORIZING (composed by validate_transaction_set). Derive the verification truth from S0, plan, journal
    and S1 over the PROTECTED SURFACE. Every protected change not explained by an APPLIED plan operation is UNRELATED."""
    applied = set(journal_applied_ops(journal))
    unobs = sorted(set(PROTECTED_SURFACE_EXCLUSIONS) | set((s0.get("coverage") or {}).get("deferred_domains") or []) | set((s0.get("coverage") or {}).get("unobservable_domains") or []) | set((s1.get("coverage") or {}).get("deferred_domains") or []) | set((s1.get("coverage") or {}).get("unobservable_domains") or []))
    base = {"added": [], "removed": [], "changed": [], "creation_identity_map": {}, "missing_expected": [], "unrelated": [], "applied_operation_ids": sorted(applied), "unobserved_domains": unobs}
    id_errs = derive_delta_errors(s0, s1)
    if id_errs:
        base["verdict"] = "UNOBSERVABLE_STATE"
        base["missing_expected"] = ["occurrence identity unobserved or ambiguous: " + "; ".join(id_errs[:3])]
        return base
    delta = derive_delta(s0, s1)
    if delta is None or not s0["coverage"]["complete"] or not s1["coverage"]["complete"]:
        base["verdict"] = "UNOBSERVABLE_STATE"
        base["missing_expected"] = ["S0/S1 incomplete"]
        return base
    base.update({"added": delta["added"], "removed": delta["removed"], "changed": delta["changed"]})
    unmatched_added = {a["unique_id"]: a for a in delta["added"]}
    unmatched_removed = {r["unique_id"] for r in delta["removed"]}
    unmatched_changed = {c["unique_id"]: c for c in delta["changed"]}
    unmatched_markers = {marker_sort_key(m): m for m in delta["markers_added"]}
    tl_changed = dict(delta["timeline_changed"])
    media_added = list(delta["media_added"])
    not_specified = False
    created_sources = []
    for ex in expected_effects(plan):
        oid = ex["operation_id"]
        if oid not in applied:
            base["missing_expected"].append(f"{oid}: not APPLIED in journal")
            continue
        if ex["kind"] == "ADDED_ITEM":
            hit = None
            for uid, a in sorted(unmatched_added.items()):
                if a["track_type"] == ex["track_type"] and a["track_index"] == ex["track_index"] and _q(a["start"]) == _q(ex["start"]) and _q(a["end"]) == _q(ex["end"]) and (ex["media_pool_item_unique_id"] is None or a["media_pool_item_unique_id"] == ex["media_pool_item_unique_id"]):
                    hit = uid
                    break
            if hit is None:
                base["missing_expected"].append(f"{oid}: APPEND produced no new occurrence on {ex['track_type']}:{ex['track_index']} [{ex['start']},{ex['end']}]")
            else:
                base["creation_identity_map"][oid] = hit
                created_sources.append(unmatched_added.pop(hit))
                # an APPEND may extend the timeline: end_frame is explained only if it becomes exactly the new occurrence end (or end+1 under the unqualified convention)
                if "end_frame" in tl_changed:
                    before, after = tl_changed["end_frame"]["before"], tl_changed["end_frame"]["after"]
                    try:
                        if before is not None and after is not None and _num(after) > _num(before) and _num(after) in (_num(ex["end"]), _num(ex["end"]) + 1):
                            tl_changed.pop("end_frame")
                    except CanonError:
                        pass
        elif ex["kind"] == "REMOVED_ITEM":
            if ex["unique_id"] in unmatched_removed:
                unmatched_removed.discard(ex["unique_id"])
            else:
                base["missing_expected"].append(f"{oid}: DELETE target {ex['unique_id']} still present")
        elif ex["kind"] == "ENABLED_FLAG":
            c = unmatched_changed.get(ex["unique_id"])
            if c and set(c["fields"]) == {"enabled"} and c["fields"]["enabled"]["after"] is ex["after"]:
                unmatched_changed.pop(ex["unique_id"])
            else:
                base["missing_expected"].append(f"{oid}: {ex['op']} did not flip only the enabled flag of {ex['unique_id']}")
        elif ex["kind"] == "MARKER_PRESENT":
            k = next((k for k, m in unmatched_markers.items() if m.get("custom_data") == ex["custom_data"]), None)
            if k is None:
                base["missing_expected"].append(f"{oid}: marker with custom_data {ex['custom_data']!r} not added")
            else:
                unmatched_markers.pop(k)
        else:
            not_specified = True
            base["missing_expected"].append(f"{oid}: effect of {ex['op']} NOT_YET_SPECIFIED; cannot verify")
    # media dependencies gained for a created occurrence are explained; anything else is unrelated
    media_added = [d for d in media_added if not any((d.get("logical_locator") and d.get("logical_locator") == c.get("source_locator")) or (d.get("source_sha256") and d.get("source_sha256") == c.get("source_sha256")) for c in created_sources)]
    base["unrelated"] += [f"added {u}" for u in sorted(unmatched_added)] + [f"removed {u}" for u in sorted(unmatched_removed)] + [f"changed {u}: {','.join(sorted(unmatched_changed[u]['fields']))}" for u in sorted(unmatched_changed)]
    base["unrelated"] += [f"marker added {m.get('custom_data')!r}@{m.get('frame')}" for m in unmatched_markers.values()] + [f"marker removed {m.get('custom_data')!r}@{m.get('frame')}" for m in delta["markers_removed"]]
    base["unrelated"] += [f"timeline.{f} changed" for f in sorted(tl_changed)]
    base["unrelated"] += [f"track added {a}" for a in delta["tracks_added"]] + [f"track removed {a}" for a in delta["tracks_removed"]] + [f"track {a} changed: {','.join(sorted(ch))}" for a, ch in sorted(delta["tracks_changed"].items())]
    base["unrelated"] += [f"media dependency added {d.get('logical_locator')!r}" for d in media_added] + [f"media dependency removed {d.get('logical_locator')!r}" for d in delta["media_removed"]]
    if not_specified:
        base["verdict"] = "EFFECT_NOT_SPECIFIED"
    elif base["missing_expected"]:
        base["verdict"] = "EXPECTED_DELTA_MISSING"
    elif base["unrelated"]:
        base["verdict"] = "UNEXPECTED_DELTA"
    else:
        base["verdict"] = "VERIFIED"
    return base


def guard_lineage_errors(s0, s1, plan=None):
    """INTERNAL_NON_AUTHORIZING. S1 must share library, project, timeline identity, target epoch AND execution session with S0."""
    errs = []
    if s0["library"] != s1["library"]:
        errs.append("S1 library identity differs from S0")
    if s0["project"].get("unique_id") != s1["project"].get("unique_id") or s0["project"].get("name") != s1["project"].get("name"):
        errs.append("S1 project identity differs from S0")
    if s0["payload"]["timeline"].get("unique_id") != s1["payload"]["timeline"].get("unique_id"):
        errs.append("S1 timeline identity differs from S0")
    if s0["target_epoch"] != s1["target_epoch"]:
        errs.append("S1 target_epoch differs from S0")
    if (s0.get("collection") or {}).get("session_id") != (s1.get("collection") or {}).get("session_id"):
        errs.append("S1 was collected in a different session than S0")
    if plan is not None:
        tgt = plan.get("target") or {}
        if s0["guard_digest"] != plan.get("h0_guard_digest"):
            errs.append("S0 guard is not the plan's h0_guard_digest")
        if s0["library"].get("instance_uuid") != tgt.get("library_instance_uuid") or s0["project"].get("unique_id") != tgt.get("project_unique_id") or s0["payload"]["timeline"].get("unique_id") != tgt.get("timeline_unique_id") or s0["target_epoch"] != tgt.get("target_epoch"):
            errs.append("S0 identity differs from plan target")
        if (s0.get("collection") or {}).get("session_id") != plan.get("session_id"):
            errs.append("S0 session differs from the plan's execution session")
        if (s1.get("collection") or {}).get("session_id") != plan.get("session_id"):
            errs.append("S1 session differs from the plan's execution session")
    return errs


def semantic_verification_result(vr, plan, s0, s1, journal):
    """INTERNAL_NON_AUTHORIZING (composed by validate_transaction_set). Declared lists are never authority: the result must
    equal the truth derived from S0, plan, journal and S1. All five inputs are mandatory; a missing one is an error, never a pass."""
    errs = []
    if plan is None or s0 is None or s1 is None or journal is None:
        return ["verification cannot be validated without plan, S0, S1 and journal objects (hash-only or partial input refused)"]
    if vr["verdict"] == "VERIFIED" and (vr["unrelated"] or vr["missing_expected"]):
        errs.append("VERIFIED with unrelated or missing_expected non-empty")
    if vr["is_human_approval"] is not False:
        errs.append("verification can never be human approval")
    if vr.get("plan_digest") != plan.get("plan_digest"):
        errs.append("verification refers to another plan")
    if vr.get("transaction_id") != plan.get("transaction_id"):
        errs.append("verification refers to another transaction")
    if vr.get("target") != plan.get("target"):
        errs.append("verification refers to another target")
    if vr.get("h0_guard_digest") != plan.get("h0_guard_digest"):
        errs.append("verification guard mismatch")
    if vr.get("expected_delta_digest") != plan.get("operation_set_digest"):
        errs.append("verification expected-delta authority != plan operation set")
    if vr.get("session_id") != plan.get("session_id"):
        errs.append("verification session_id != plan execution session")
    if vr["verdict"] == "VERIFIED" and any(o["op"] not in EFFECT_SPECIFIED_OPS for o in plan.get("operations", [])):
        errs.append("VERIFIED claimed for an operation whose effect law is NOT_YET_SPECIFIED")
    if vr.get("h0_payload_sha256") != s0.get("payload_sha256") or vr.get("h0_guard_digest") != s0.get("guard_digest"):
        errs.append("verification S0 digests do not resolve to the supplied S0 snapshot")
    if vr.get("s1_payload_sha256") != s1.get("payload_sha256") or vr.get("s1_guard_digest") != s1.get("guard_digest") or vr.get("readback_snapshot_sha256") != snapshot_object_digest(s1):
        errs.append("verification S1 digests do not resolve to the supplied S1 snapshot")
    rb = journal_readback(journal)
    if rb is None:
        errs.append("journal has no single READBACK_S1 event to bind the verification to")
    elif rb.get("readback_snapshot_sha256") != vr.get("readback_snapshot_sha256"):
        errs.append("verification readback digest != journal READBACK_S1 digest")
    errs += [f"lineage: {e}" for e in guard_lineage_errors(s0, s1, plan)]
    derived = verify_transaction(plan, s0, s1, journal)
    for k in ("added", "removed", "changed", "creation_identity_map", "missing_expected", "unrelated", "applied_operation_ids", "unobserved_domains", "verdict"):
        if canon(vr.get(k)) != canon(derived[k]):
            errs.append(f"verification.{k} differs from derived truth (declared {canon(vr.get(k))[:80]} vs derived {canon(derived[k])[:80]})")
    return errs


def semantic_conflict(cf, plan=None):
    """INTERNAL_NON_AUTHORIZING (composed by validate_transaction_set)."""
    errs = []
    if cf.get("authority_effect") != "NONE_UNTIL_HUMAN_ADJUDICATION":
        errs.append("conflict must have no authority effect")
    if plan is not None and (cf.get("plan_digest") != plan.get("plan_digest") or cf.get("transaction_id") != plan.get("transaction_id")):
        errs.append("conflict not bound to this plan/transaction")
    return errs


def semantic_commit_manifest(cm, plan, journal_records, verification_result, conflicts, s0, s1, active):
    """INTERNAL_NON_AUTHORIZING. Commit-manifest field law, composed by validate_transaction_set. It re-validates the journal
    (with S1) and the verification (against S0/S1-derived truth); every input is mandatory. It never authorizes a commit on its
    own: the ONLY authorizing entry point is commit_eligibility."""
    errs = []
    if plan is None or not journal_records or verification_result is None or s0 is None or s1 is None or active is None:
        return ["commit requires plan, journal, verification, S0, S1 objects and the active authority (hash-only or partial input refused)"]
    errs += [f"journal: {e}" for e in semantic_journal(journal_records, plan, s1)]
    errs += [f"verification: {e}" for e in semantic_verification_result(verification_result, plan, s0, s1, journal_records)]
    for c in conflicts or []:
        errs += [f"conflict: {e}" for e in semantic_conflict(c, plan)]
        if c.get("resolved") is not True:
            errs.append("commit with unresolved conflict")
    if cm.get("plan_digest") != plan.get("plan_digest"):
        errs.append("commit plan_digest != plan")
    if cm.get("transaction_id") != plan.get("transaction_id") or cm.get("transaction_id") != journal_records[0].get("transaction_id"):
        errs.append("commit transaction_id mismatch")
    if cm.get("target") != plan.get("target"):
        errs.append("commit target != plan target")
    if cm.get("operation_set_digest") != plan.get("operation_set_digest"):
        errs.append("commit operation_set_digest != plan")
    if cm.get("session_id") != plan.get("session_id"):
        errs.append("commit session_id != plan execution session")
    if cm.get("guard_digest") != plan.get("h0_guard_digest") or cm.get("guard_digest") != s0.get("guard_digest"):
        errs.append("commit guard_digest does not match plan/S0 guard")
    if cm.get("s1_guard_digest") != s1.get("guard_digest"):
        errs.append("commit s1_guard_digest does not match S1")
    if cm.get("s1_snapshot_sha256") != snapshot_object_digest(s1):
        errs.append("commit s1_snapshot_sha256 does not match the supplied S1")
    if cm.get("journal_head_sha256") != journal_head(journal_records):
        errs.append("commit journal_head_sha256 does not match journal chain head")
    if cm.get("verification_result_sha256") != digest(verification_result, "vidtoolz.resolveVerificationResult.v1"):
        errs.append("verification_result_sha256 does not match the validated verification object")
    if verification_result.get("verdict") != "VERIFIED":
        errs.append("commit without VERIFIED verification")
    terminal = journal_records[-1]["state"]
    if terminal not in ("PUBLISHED", "COMMITTED", "COMMITTED_RECOVERED"):
        errs.append(f"commit for journal whose last state is {terminal}")
    if cm.get("terminal_state") not in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("invalid terminal_state")
    if cm.get("unresolved_conflicts"):
        errs.append("commit with unresolved_conflicts listed")
    for k in ("binding_observation_sha256", "binding_set_digest", "receipt_sha256"):
        if not is_sha(cm.get(k)):
            errs.append(f"missing required evidence {k}")
    if cm.get("authority_version") != active["authority_version"]:
        errs.append("commit authority_version != active authority")
    return errs


def profile_satisfies(actual, required):
    """INTERNAL_NON_AUTHORIZING. actual profile is at least as strong as required (every mandatory set is a superset)."""
    a, r = COVERAGE_PROFILES.get(actual), COVERAGE_PROFILES.get(required)
    if a is None or r is None:
        return False
    return all(set(a[k]) >= set(r[k]) for k in PROFILE_KEYS) and (a["track_locks_required"] or not r["track_locks_required"]) and (a["guard_required"] or not r["guard_required"])


def required_s1_profile(plan):
    """INTERNAL_NON_AUTHORIZING. The strongest operation-specific verify profile required by the plan's operations, or None
    when some operation has no verify profile (then no S1 can verify it)."""
    req = None
    for o in plan.get("operations", []):
        p = OPERATION_VERIFY_PROFILE.get(o["op"])
        if p is None:
            return None
        req = p if req is None or profile_satisfies(p, req) else req
    return req


VALIDATION_STAGES = ("evidence_authority", "capability_provenance", "schema", "s0", "plan", "journal", "s1", "delta", "effects", "verification", "conflicts", "commit")


FORBIDDEN_VALIDATOR_KWARGS = ("schema_validate", "validator", "schema_validator", "validate", "schema", "schemas", "registry", "callable_set", "s0_override", "s1_override")


def _forbidden_authority_arguments(args, kwargs):
    """Section 4 (C16-B2). An authorizing entry point takes artifacts, never law. Any extra positional argument and any
    keyword naming a validator, a schema, a registry or an override is refused by name, loudly, instead of being accepted
    (v1.6) or silently ignored. This is what makes `commit_eligibility(..., always_true_callback)` a refusal rather than an
    authorization."""
    bad = []
    if args:
        bad.append(f"{len(args)} extra positional argument(s) (v1.6 accepted a caller-supplied schema validator in this position)")
    for k in sorted(kwargs):
        bad.append(f"keyword {k!r}" + (" (a known validator/override keyword)" if k in FORBIDDEN_VALIDATOR_KWARGS else ""))
    if not bad:
        return []
    return ["schema: CALLER_SUPPLIED_VALIDATOR_REFUSED (v1.7, C16-B2): " + "; ".join(bad) +
            ". Schemas are resolved internally from the pinned SCHEMA-REGISTRY.json for this authority version; a caller may supply artifacts, never the law. "
            "For diagnostics with a custom validator use validate_transaction_set_diagnostic, which is INTERNAL_NON_AUTHORIZING and returns no eligibility."]


def validate_transaction_set_authorizing(ts, perms, rp, caps, tc, governed, active, *forbidden, _stages=None,
                                          **forbidden_kwargs):
    """THE AUTHORIZING composed transaction validation (v1.15, V114-B2). FAIL-CLOSED on governed provenance.

    v1.14 classified validate_transaction_set and commit_eligibility as authorizing while they still accepted a bare
    evidence-set dict. Codex reproduced the consequence: the complete committed-consistent fixture, supplied as a raw
    dict with no governed provenance, completed all twelve stages and produced commit_eligibility.eligible=true -
    diagnostic eligibility reaching commit authority.

    v1.15 requires a GovernedEvidenceSet here. The evidence consumed is the value returned by governed_consume (the
    parse of the exact validated bytes), and the plan stage's eligibility is evaluated by the AUTHORIZING gate, so no
    diagnostic eligibility result can influence transaction validity, mutation-plan acceptance or a commit decision.
    Everything else - the twelve stages, the internally pinned schemas, S0/S1, journal, delta, effects, verification,
    conflicts and H0 - is unchanged and re-run exactly as before.

    Returns the same error list shape as the composed validator, with a frozen refusal when provenance is absent."""
    fb = _forbidden_authority_arguments(forbidden, forbidden_kwargs)
    if fb:
        return fb
    stages = _stages if _stages is not None else []
    if not isinstance(governed, GovernedEvidenceSet):
        return [f"GOVERNED_EVIDENCE_REQUIRED: authorizing transaction validation requires a GovernedEvidenceSet from "
                f"authority_lib.load_governed_evidence_set, got {type(governed).__name__}"]
    errs, es = governed_consume(governed, active)
    if errs:
        return ["LOCATION_AUTHORITY_INVALID: " + e for e in errs[:3]]
    try:
        schema_registry()
    except AuthorityTrustError as e:
        return [f"schema: {e}"]
    return _validate_transaction_set_impl(ts, perms, rp, caps, tc, es, active, internal_schema_errors, stages,
                                          governed=governed)


def commit_eligibility_authorizing(ts, perms, rp, caps, tc, governed, active, *forbidden, **forbidden_kwargs):
    """THE ONE AUTHORIZING commit entry point (v1.15, V114-B2). A commit is eligible only when the complete linked
    set passes validate_transaction_set_authorizing with zero errors under the internally pinned schemas AND the
    evidence carries governed location provenance whose validated bytes are the bytes consumed.

    Returns {eligible, errors, stages_completed, authorizing, location_receipt}."""
    stages = []
    fb = _forbidden_authority_arguments(forbidden, forbidden_kwargs)
    if fb:
        return {"eligible": False, "errors": ["commit INELIGIBLE: " + fb[0]], "stages_completed": stages,
                "authorizing": False, "location_receipt": None}
    if not isinstance(governed, GovernedEvidenceSet):
        return {"eligible": False, "authorizing": False, "location_receipt": None, "stages_completed": stages,
                "errors": [f"commit INELIGIBLE: GOVERNED_EVIDENCE_REQUIRED: authorizing commit eligibility requires "
                           f"a GovernedEvidenceSet, got {type(governed).__name__}"]}
    perrs, _es = governed_consume(governed, active)
    if perrs:
        return {"eligible": False, "authorizing": False, "location_receipt": None, "stages_completed": stages,
                "errors": ["commit INELIGIBLE: LOCATION_AUTHORITY_INVALID: " + e for e in perrs[:3]]}
    errs = []
    for k in ("s0_snapshot", "plan", "journal", "s1_snapshot", "verification", "commit"):
        if not ts.get(k):
            errs.append(f"commit INELIGIBLE: linked {k} missing")
    if errs:
        return {"eligible": False, "errors": errs, "stages_completed": stages, "authorizing": True,
                "location_receipt": governed.receipt}
    errs = validate_transaction_set_authorizing(ts, perms, rp, caps, tc, governed, active, _stages=stages)
    return {"eligible": not errs and stages == list(VALIDATION_STAGES), "errors": errs,
            "stages_completed": stages, "authorizing": True, "location_receipt": governed.receipt}


def validate_transaction_set(ts, perms, rp, caps, tc, es, active, *forbidden, _stages=None, **forbidden_kwargs):
    """PROVISIONAL_UNTIL_M3 / NON-AUTHORIZING composed validation (demoted in v1.15 by V114-B2).

    It consumes a bare evidence-set dict, so it cannot establish where that evidence came from; in v1.14 it was
    declared AUTHORIZING and a complete fixture supplied as a raw dict passed all twelve stages and yielded a
    positive commit decision. It is retained unchanged for fixtures, schema work and diagnosis, and every inherited
    negative and positive transaction regression still runs against it. For authority use
    validate_transaction_set_authorizing() / commit_eligibility_authorizing().

    Composed validation of a linked transaction set, in this order:
    evidence authority -> capability provenance context -> schema -> S0 coverage/provenance -> plan -> journal membership/session
    (+ readback binding) -> S1 coverage/provenance/profile law -> protected delta -> operation-specific effects -> verification
    object vs derived truth -> conflicts -> commit eligibility. No stage can be skipped; there is no callable-set or S0/S1
    override parameter. ts = {s0_snapshot, plan, journal, s1_snapshot, verification, commit|None, conflicts}.

    v1.7 (Codex v1.6 BLOCKER C16-B2): there is NO schema_validate parameter. In v1.6 the caller supplied the validator, so an
    always-empty, partial, wrong-schema or stale-schema callback authorized artifacts the real schemas reject. Schemas are now
    resolved internally by internal_schema_errors() from the bundle's pinned schema registry, and any attempt to pass a
    validator is refused by name."""
    fb = _forbidden_authority_arguments(forbidden, forbidden_kwargs)
    if fb:
        return fb
    try:
        schema_registry()
    except AuthorityTrustError as e:
        return [f"schema: {e}"]
    return _validate_transaction_set_impl(ts, perms, rp, caps, tc, es, active, internal_schema_errors, _stages if _stages is not None else [])


def _validate_transaction_set_impl(ts, perms, rp, caps, tc, es, active, schema_validate, stages, governed=None):
    """INTERNAL. The composed validation body. The authorizing wrapper always passes the internally pinned
    internal_schema_errors; validate_transaction_set_diagnostic is the only other caller and its result carries no
    eligibility. Keeping the seam here means the AUTHORIZING signature has no validator parameter at all.

    v1.15 (V114-B2): `governed` is the GovernedEvidenceSet when this body runs under the AUTHORIZING entry point. It
    is threaded to the plan stage so plan-time eligibility is evaluated by evaluate_eligibility_authorizing. It is
    not a caller-supplied law: it is a provenance object only the canonical loader can mint, and the public
    authorizing signature has no such parameter."""
    errs = []
    s0, plan, journal, s1, vr, cm, conflicts = ts.get("s0_snapshot"), ts.get("plan"), ts.get("journal") or [], ts.get("s1_snapshot"), ts.get("verification"), ts.get("commit"), ts.get("conflicts") or []
    ev = validate_evidence_set(es, active)
    if ev:
        return [f"evidence: {e}" for e in ev[:5]]
    stages.append("evidence_authority")
    ae = active_authority_errors(caps, active)
    if ae:
        return [f"capability_provenance: {e}" for e in ae]
    ctx = {"caps": caps, "rp": rp, "es": es, "active": active, "tc": tc}
    stages.append("capability_provenance")
    for name, doc, tag in (("resolveSnapshot", s0, "s0"), ("provisional/resolveMutationPlan", plan, "plan"), ("resolveSnapshot", s1, "s1"), ("provisional/resolveVerificationResult", vr, "verification"), ("provisional/resolveCommitManifest", cm, "commit")):
        if doc is not None:
            errs += [f"schema/{tag}: {e}" for e in schema_validate(name, doc)]
    for r in journal:
        errs += [f"schema/journal: {e}" for e in schema_validate("provisional/resolveTransactionJournal", r)]
    for c in conflicts:
        errs += [f"schema/conflict: {e}" for e in schema_validate("provisional/resolveConflict", c)]
    if errs:
        return errs
    stages.append("schema")
    if s0 is None or plan is None:
        return ["linked set requires s0_snapshot and plan"]
    errs += [f"s0: {e}" for e in semantic_snapshot(s0, ctx)]
    if s0["coverage"]["profile"] != S0_REQUIRED_PROFILE or not s0["coverage"]["complete"]:
        errs.append(f"s0: mutation requires a complete {S0_REQUIRED_PROFILE} snapshot")
    stages.append("s0")
    errs += [f"plan: {e}" for e in semantic_mutation_plan(plan, perms, rp, caps, tc,
                                                          governed if governed is not None else es,
                                                          active, s0["guard_digest"])]
    stages.append("plan")
    errs += [f"journal: {e}" for e in semantic_journal(journal, plan, s1)]
    stages.append("journal")
    if s1 is not None:
        errs += [f"s1: {e}" for e in semantic_snapshot(s1, ctx)]
        errs += [f"lineage: {e}" for e in guard_lineage_errors(s0, s1, plan)]
        req = required_s1_profile(plan)
        if req is None:
            errs.append("s1: no verify profile exists for an operation in the plan (effect NOT_YET_SPECIFIED); S1 cannot verify it")
        elif not profile_satisfies(s1["coverage"]["profile"], req):
            errs.append(f"s1: coverage profile {s1['coverage']['profile']} is weaker than the required {req} verify profile")
        if not s1["coverage"]["complete"]:
            errs.append("s1: verification requires a complete S1 (incomplete readback cannot prove the effect)")
        stages.append("s1")
        errs += [f"delta: {e}" for e in derive_delta_errors(s0, s1)]
        stages.append("delta")
        derived = verify_transaction(plan, s0, s1, journal)
        if derived["verdict"] != "VERIFIED" and cm is not None:
            errs.append(f"effects: derived verdict is {derived['verdict']} (missing={derived['missing_expected'][:2]} unrelated={derived['unrelated'][:3]}); commit impossible")
        stages.append("effects")
    if vr is not None:
        if s1 is None:
            errs.append("verification without an S1 snapshot")
        else:
            errs += [f"verification: {e}" for e in semantic_verification_result(vr, plan, s0, s1, journal)]
        stages.append("verification")
    for c in conflicts:
        errs += [f"conflict: {e}" for e in semantic_conflict(c, plan)]
    stages.append("conflicts")
    if cm is not None:
        if s1 is None or vr is None:
            errs.append("commit: INELIGIBLE without linked S1 and verification objects")
        else:
            errs += [f"commit: {e}" for e in semantic_commit_manifest(cm, plan, journal, vr, conflicts, s0, s1, active)]
        stages.append("commit")
    elif journal and journal[-1]["state"] in ("COMMITTED", "COMMITTED_RECOVERED"):
        errs.append("journal reached COMMITTED without a commit manifest")
    return errs


def commit_eligibility(ts, perms, rp, caps, tc, es, active, *forbidden, **forbidden_kwargs):
    """PROVISIONAL_UNTIL_M3 / NON-AUTHORIZING commit composition (demoted in v1.15 by V114-B2: it consumes a bare
    evidence dict and therefore cannot establish governed provenance; Codex reproduced eligible=true from a raw
    fixture dict). Retained unchanged so every inherited commit regression still runs. THE authorizing commit entry
    point is commit_eligibility_authorizing().

    A commit is composed-eligible only when the complete linked set (S0, plan, journal, S1,
    verification, conflicts, commit manifest) passes validate_transaction_set with zero errors under the INTERNALLY PINNED
    schemas of this authority version. Returns {eligible, errors, stages_completed}. A verification object, a hash or a
    receipt is never sufficient on its own.

    v1.7 (C16-B2): the v1.6 `schema_validate` parameter is gone. Passing anything in its place - an always-true callback, an
    always-empty callback, a partial callback that only validates some artifacts, a permissive schema, or a stale schema from
    an older bundle - is refused by name and the commit stays INELIGIBLE."""
    stages = []
    errs = []
    fb = _forbidden_authority_arguments(forbidden, forbidden_kwargs)
    if fb:
        return {"eligible": False, "errors": ["commit INELIGIBLE: " + fb[0]], "stages_completed": stages}
    for k in ("s0_snapshot", "plan", "journal", "s1_snapshot", "verification", "commit"):
        if not ts.get(k):
            errs.append(f"commit INELIGIBLE: linked {k} missing")
    if errs:
        return {"eligible": False, "errors": errs, "stages_completed": stages}
    errs = validate_transaction_set(ts, perms, rp, caps, tc, es, active, _stages=stages)
    return {"eligible": not errs and stages == list(VALIDATION_STAGES), "errors": errs, "stages_completed": stages}


def validate_transaction_set_diagnostic(ts, perms, rp, caps, tc, es, active, schema_validate=None):
    """INTERNAL_NON_AUTHORIZING (section 4). Run the composed validation with a caller-supplied schema validator for
    DIAGNOSIS ONLY: schema-authoring work, bundle bring-up, reviewer harnesses. It deliberately returns no `eligible` key and
    no stage list a caller could mistake for an authorization, and it stamps every result as non-authorizing. Nothing in the
    authorizing path calls it, and its result can never be turned into a commit decision."""
    stages = []
    if not callable(schema_validate):
        schema_validate = internal_schema_errors
    errs = _validate_transaction_set_impl(ts, perms, rp, caps, tc, es, active, schema_validate, stages)
    return {"authorizing": False, "surface": "INTERNAL_NON_AUTHORIZING", "errors": errs, "stages_reached": list(stages),
            "note": "DIAGNOSTIC ONLY: a caller-supplied validator was used. This result is not an eligibility decision and commit_eligibility ignores it."}


# ------------------------------------------------------------------ manifest validation (bytes + sha + lineage)
def semantic_manifest(m, bundle_dir=None, sha_fn=None, parent_manifest=None, size_fn=None):
    errs = []
    if m.get("schema") != "vidtoolz.resolveFreezeManifest.v1.10":
        errs.append("wrong manifest schema")
    vocab = set(m.get("status_vocabulary", []))
    paths = [e["path"] for e in m["files"]]
    if len(set(paths)) != len(paths):
        errs.append("duplicate path in manifest")
    pv = {x["path"]: x["sha256"] for x in parent_manifest["files"]} if parent_manifest else {}
    for e in m["files"]:
        if e.get("status") not in vocab:
            errs.append(f"{e['path']}: invalid status {e.get('status')!r}")
        if not is_sha(e.get("sha256")):
            errs.append(f"{e['path']}: missing/malformed sha256")
        if not isinstance(e.get("bytes"), int) or isinstance(e.get("bytes"), bool) or e.get("bytes") < 0:
            errs.append(f"{e['path']}: missing/invalid byte count")
        if e.get("authority_class") not in ("NORMATIVE", "SCHEMA", "FIXTURE", "TOOL", "HISTORICAL_INPUT", "REPORT"):
            errs.append(f"{e['path']}: unknown authority classification")
        if bundle_dir and sha_fn:
            p = f"{bundle_dir}/{e['path']}"
            if sha_fn(p) != e.get("sha256"):
                errs.append(f"{e['path']}: sha mismatch on disk")
            actual_size = size_fn(p) if size_fn else os.path.getsize(p)
            if actual_size != e.get("bytes"):
                errs.append(f"{e['path']}: byte count {e.get('bytes')} != on-disk size {actual_size}")
        if parent_manifest is not None:
            if e.get("inherited_from_parent") and pv.get(e["path"]) != e.get("sha256"):
                errs.append(f"{e['path']}: marked inherited but bytes differ from parent")
            if e.get("changed_from_parent") and pv.get(e["path"]) in (None, e.get("sha256")):
                errs.append(f"{e['path']}: marked changed but identical/absent in parent")
            if e.get("new_in_this_version") and e["path"] in pv:
                errs.append(f"{e['path']}: marked new but present in parent")
    par = m.get("parent", {})
    if par.get("version") != "1.18.0" or par.get("branch") != "docs/resolve-authority-freeze-v1.18" or par.get("head") != "5d9dbba7c9f136caf694debe177f61168e5c4271" or par.get("manifest_sha256") != "80b108e4e142841af38827d3b6170c1260c543740f21b03ebb3d934278723ae9" or par.get("immutable") is not True:
        errs.append("broken parent lineage")
    # v1.10 is a single semantic commit: its bundle and its DOC-AUTHORITY registration were committed together, so
    # semantic_head IS head. The field is retained so the lineage shape stays uniform across versions.
    if par.get("semantic_head") != "5d9dbba7c9f136caf694debe177f61168e5c4271":
        errs.append("broken parent lineage: inherited semantic v1.18 commit not recorded")
    anc = {a.get("version"): a for a in (par.get("ancestors") or [])}
    for v_, h_, m_ in (("1.16.0", "a03923cd4b09e8e11d40e8cf13819f8df763063a", "ba77bfa2226696b61be27f2a7c74cf551720f601f57b8c11c9f2f6f50a159507"), ("1.15.0", "459bd29e358574896f0cf69f4b0bfb347bf2902d", "af2c1b11485233f5c2b6b5447a6695a3b6cbe6ba4cbdb06f3727973f4b2c9fe2"),
                       ("1.14.0", "b61f248238ec7ed60deca79aa9728ec0cde86edd", "0d4fc9915923d17ef6ec469cc01fb164b4d2ee1001fc7983d557bf4c9d9032b8"),
                       ("1.13.0", "65895c6dedceadff012a08c1bafcdf9e92b65221", "436e12c8616ea6704fef2dbd0e14517cf33092aec1a7ff064dd4b10fb3dad573"),
                       ("1.12.0", "73150d00a72820b155caf357c412f46b8ec4a9ba", "e5eace278a1b6130971a38f55ef207620cdc97d7b3872d11ce9ab8909e4014fb"),
                       ("1.11.0", "5889efa8ed12bd6626c43a657f27ea2367e54d23", "0c47f0cefdd63b971489a46274e3b782927f2c6ad26e4251de21860abc50c44e"),
                       ("1.10.0", "9c6643430d2dc66741afe9852668d8e6e19c0630", "46491cee979dc59a306993de8cc66308884967dca46304168096f935939f6156"),
                       ("1.9.0", "863fe4fb5944935bad51a318a50b25ed748be22d", "5aac34dae6c2ec9842aaa3499d7c20ffd104f65966ba7cb8b0c79d32d42eb9fe"),
                       ("1.8.0", "41081f7f4f227255f44bbb3a94637928187289f0", "727bcaad6ee49f1439eb84b33bf36cb11d2c94d41165b4b092f728a167626d86"),
                       ("1.7.0", "6a805181b14617c1b6259847b0905e21362a935c", "8da668fcb3df771b645e7feb092e88ce381d9fa5a4f9de931bfaf1bc2f55fb5d"),
                       ("1.6.0", "82976433875c8a68aff13f2d9a4071e913b8da29", "9f8a1a2e51f205409f8cb3f175144d21c59658221a42398612f982746a04ac29"),
                       ("1.5.0", "9d944e01358b4b88d6ee4c9993a4db4084ba23ad", "a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a"),
                       ("1.4.0", "d2d77680047221f2dac52adce6938dd410e38b47", "34a7d0507a5d7f31769a46561d97219869e3525889f121424623eab4ff1dd84f"),
                       ("1.3.0", "1c9e090fcc8978e6e9b8f5dd538849448044d26b", "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc"),
                       ("1.2.0", "c6d1284c6f395f5b21a6d14f8c2873bccfc065bb", "69e1caecf9ba9bd16875b7625c58902e3e5f613372165c8d11d80ff48939b5e6"),
                       ("1.1.0", "47ddb225335b8c85ca5255b1de86ff508e0e8e91", "83d8a307098cdc18931f6f09de2ce782afa0bdef94ec8540c2a143910cd448c5"),
                       ("1.0.0", "e2874f6f67f5adb3a5ced0e0e138c370e38995cb", "d9cd54780e0a123ae2045ac575bbc41638039ef3e878f1b608afbce3989a8821")):
        if (anc.get(v_) or {}).get("head") != h_ or (anc.get(v_) or {}).get("manifest_sha256") != m_:
            errs.append(f"broken ancestor lineage at {v_}")
    return errs


def callable_method_set(caps, rp, es, tc, active):
    """All methods QUALIFIED_CALLABLE for the contract environment under the active capability authority and evidence set (empty
    when the supplied matrix is not the active matrix). v1.7: one content key is derived for the whole set and shared by every
    per-method derivation, and the set itself is memoized under that same content key - never under the identity of the
    matrix, evidence-set or read-primitive objects (C16-B1)."""
    env = _contract_env(tc)
    ck = content_key(caps, rp, es, env, active)
    if ck is not None:
        hit = _CALLABLE_CACHE.get(ck)
        if hit is not None:
            return set(hit)
    out = set()
    if not active_authority_errors(caps, active):
        for spec in rp.get("logical_operations", {}).values():
            for p in spec.get("primitives", []):
                if capability_qualification(caps, rp, p["method"], es, env, active, ck)["status"] == "QUALIFIED_CALLABLE":
                    out.add(p["method"])
    if ck is not None:
        _cache_put(_CALLABLE_CACHE, ck, sorted(out))
    return set(out)
