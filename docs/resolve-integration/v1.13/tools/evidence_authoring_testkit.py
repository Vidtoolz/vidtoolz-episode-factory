#!/usr/bin/env python3
"""INTERNAL_NON_AUTHORIZING scratch-root harness for the validation suite (v1.13, V112-RP1 section 15).

WHY THIS EXISTS SEPARATELY. v1.12 let the validation suite point the production authoring API at a temporary
directory by passing `root=`. That parameter was on the AUTHORIZING surface, so a production CLI could use it too,
and Codex's runtime-parity oracle proved a complete workflow under an arbitrary or symlinked root still derived
ATTACHMENT_READY. v1.13 removes root selection from the authorizing surface entirely and puts the scratch-root
mechanism here instead, where three properties hold:

  1. NOT AUTHORIZING. Nothing in this module decides anything. `evidence_authoring.derive_attachment_state` - the
     authorizing gate - refuses every document produced under a sandbox, because such a document records
     written_under_production_root=false and an authority_root that is not the frozen constant.
  2. NOT REACHABLE FROM PRODUCTION. tools/a2_prepare.py and tools/a2_verify.py neither import this module nor accept
     any root option; validate_v1_13.py asserts both statically.
  3. AUTHORITY-PRESERVING. The sandbox changes ONE thing: the root prefix. Every check the production path performs -
     lstat-first root trust, session entry trust, the basename and containment law, the alias check, the
     self-location check, the lifecycle grants, the principal law, the TOCTOU seals - runs unchanged, on the same
     code. A sandbox therefore cannot establish a state that production location policy forbids; it can only fail to
     be authority.

Usage is limited to the validation suite:

    import evidence_authoring_testkit as TK
    with TK.sandbox(scratch_dir) as root:
        ...                                   # the real production functions, under the scratch root
        TK.derive_nonauthorizing(session_id)  # workflow mechanics only; NEVER an authority decision
"""
import contextlib
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import authority_lib as L          # noqa: E402
import evidence_authoring as A     # noqa: E402

AUTHORITY_CLASS = "INTERNAL_NON_AUTHORIZING"


@contextlib.contextmanager
def sandbox(root):
    """Point the authoring module's root resolver at a scratch directory for the duration of the block.

    The directory is created with the frozen governed mode so the production root-trust checks apply unchanged.
    Refuses to sandbox the real authority root: the suite must never write evidence there."""
    root = os.path.abspath(root)
    if root == L.GOVERNED_ATTACHMENT_ROOT or root.startswith(L.GOVERNED_ATTACHMENT_ROOT + os.sep):
        raise AssertionError("the testkit must never sandbox the frozen authority root")
    os.makedirs(root, mode=L.GOVERNED_ROOT_MODE, exist_ok=True)
    os.chmod(root, L.GOVERNED_ROOT_MODE)
    prev = A._SANDBOX_ROOT
    A._SANDBOX_ROOT = root
    try:
        assert not A.is_production_root(), "sandbox must report a non-production root"
        yield root
    finally:
        A._SANDBOX_ROOT = prev


def derive_nonauthorizing(session_id):
    """Run the frozen derivation over a sandboxed governed document. INTERNAL_NON_AUTHORIZING: this exists so the
    suite can prove the workflow MECHANICS reach ATTACHMENT_READY, and it is not an authority decision. The
    authorizing entry point, evidence_authoring.derive_attachment_state, refuses this same document."""
    es, _wf = A._load(session_id)
    A.require_fresh(es)      # the same document-freshness law the authorizing derivation applies
    return L.derive_attachment_state(A.target_contract(), es, A.active_authority())
