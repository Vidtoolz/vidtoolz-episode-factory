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
     any root option; validate_v1_15.py asserts both statically.
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
import shutil
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


# ================================================================ v1.15: the reviewer-environment seam (section 35)
# Hermes created the frozen governed root between two validation runs, so the v1.14 positive control - which ran only
# when the root was ABSENT and then removed the whole tree - silently skipped, and candidate tests that asserted
# root absence failed. Codex classified that a REVIEW_ENVIRONMENT_EFFECT, not a defect.
#
# The production law is untouched: authority_lib.authority_attachment_root() still takes no argument and has no
# override of any kind. What changes is only how the SUITE obtains a session to exercise it with, so a deterministic
# candidate validation no longer depends on whether a reviewer happened to create the root first.
@contextlib.contextmanager
def governed_selftest_session(name):
    """Yield a canonical session id under the REAL governed root, in whichever of the two environments applies.

      * root absent  -> create it with the frozen mode, and remove the whole tree afterwards (v1.14 behaviour);
      * root present -> create ONLY this uniquely named session directory, and remove only that.

    It refuses if the name already exists, so an operator's or a reviewer's evidence is never adopted, overwritten
    or deleted. INTERNAL_NON_AUTHORIZING: it creates no records and decides nothing; the production constructors and
    the authorizing core do all the work, unchanged, at the real canonical location."""
    root, qroot = L.GOVERNED_ATTACHMENT_ROOT, L.QUALIFICATION_EVIDENCE_ROOT
    created_tree = not os.path.exists(qroot)
    sdir = L.canonical_session_dir(name)
    if os.path.lexists(sdir):
        raise AssertionError(f"the testkit will not adopt an existing governed session: {sdir}")
    if created_tree:
        os.makedirs(root, mode=L.GOVERNED_ROOT_MODE)
        os.chmod(qroot, L.GOVERNED_ROOT_MODE)
        os.chmod(root, L.GOVERNED_ROOT_MODE)
    before = sorted(os.listdir(root))
    try:
        yield name
    finally:
        for p_ in (os.path.join(sdir, f) for f in (A.EVIDENCE_SET_FILE, A.WORKFLOW_FILE, "LOCK")):
            try:
                os.chmod(p_, 0o600)
            except OSError:
                pass
            try:
                if os.path.isdir(p_) and not os.path.islink(p_):
                    os.rmdir(p_)
                elif os.path.lexists(p_):
                    os.remove(p_)
            except OSError:
                pass
        try:
            os.chmod(sdir, L.GOVERNED_ROOT_MODE)
        except OSError:
            pass
        shutil.rmtree(sdir, ignore_errors=True)
        if created_tree:
            for dp, dns, fns in os.walk(qroot):
                for x in dns + fns:
                    try:
                        os.chmod(os.path.join(dp, x), 0o700)
                    except OSError:
                        pass
            shutil.rmtree(qroot, ignore_errors=True)
        else:
            # Only two things are asserted, so that nested self-test sessions compose: OUR session directory is gone,
            # and every entry that existed when we entered is still there. Sessions created by an enclosing seam are
            # neither adopted nor removed here.
            now = set(os.listdir(root))
            if os.path.lexists(sdir):
                raise AssertionError(f"testkit failed to remove its own governed session: {sdir}")
            leftover = (set(before) - {name}) - now
            if leftover:
                raise AssertionError(f"testkit removed governed sessions it did not create: {sorted(leftover)}")
