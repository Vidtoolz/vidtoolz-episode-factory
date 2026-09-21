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
     any root option; validate_v1_18.py asserts both statically.
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
# v1.20 repair (F-120-04, P2). The v1.15 seam still removed the WHOLE tree when the root had been absent at entry, so a
# session created by ANY other writer after the root appeared was silently deleted (independently reproduced 2026-09-21).
# Root absence at entry is not ownership of what later appears beneath the root. The law is now:
#
#   A self-test run owns EXACTLY ONE filesystem object: <root>/<name>, where <name> is a run-unique, collision-resistant
#   self-test id minted here that did not exist at entry. Cleanup removes exactly that directory (lstat-checked: a real
#   directory, not a symlink, directly under the root, basename == name) and NOTHING else - never the root, never a
#   sibling, never the qualification tree - whether or not the root existed at entry and whether the block exits
#   normally or by exception. An absent root is created with the frozen mode and LEFT IN PLACE (possibly empty).
#
# The production law is untouched: authority_lib.authority_attachment_root() still takes no argument and has no
# override of any kind; owned_selftest_session() is parameterised by root ONLY so that the suite can prove the
# ownership law against private temporary roots (tools/v120_ownership_tests.py) with the same code that runs against
# the real root.
import secrets
import stat

SELFTEST_SESSION_PREFIX = "sess-selftest-"


def selftest_session_name(tag):
    """Mint a run-unique, collision-resistant self-test session id: prefix + tag + pid + 128-bit random token. Valid
    under the frozen SESSION_ID_RE. Not a timestamp, not a sequence: two runs on one host or two hosts cannot collide."""
    tag = "".join(ch for ch in str(tag) if ch.isalnum() or ch in "._-")[:32] or "run"
    name = f"{SELFTEST_SESSION_PREFIX}{tag}-{os.getpid()}-{secrets.token_hex(16)}"
    if not L.SESSION_ID_RE.match(name):
        raise AssertionError(f"minted self-test session id violates SESSION_ID_RE: {name!r}")
    return name


def is_selftest_session_name(name):
    return isinstance(name, str) and name.startswith(SELFTEST_SESSION_PREFIX) and bool(L.SESSION_ID_RE.match(name)) \
        and len(name) > len(SELFTEST_SESSION_PREFIX) + 40


def _ensure_governed_tree(qroot, root):
    """Create the qualification tree and the attachment root if absent, with the frozen mode. Records NO ownership:
    nothing created here is ever removed by the testkit. A pre-existing entry is inspected with lstat and refused
    if it is not a real directory (a symlink or file at the root path is never followed or replaced)."""
    for d in (qroot, root):
        if os.path.lexists(d):
            st = os.lstat(d)
            if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
                raise AssertionError(f"governed path is not a real directory; refusing to use it: {d}")
        else:
            os.mkdir(d, L.GOVERNED_ROOT_MODE)
            os.chmod(d, L.GOVERNED_ROOT_MODE)


def _remove_owned_session(root, name):
    """Remove EXACTLY <root>/<name>, the one object this run owns. Refuses (loudly) if the path is not a real directory
    directly under root with that basename, if it is a symlink, or if removal leaves anything behind. Never touches
    root, its siblings or anything else. Nothing to do if the session was never created."""
    if not is_selftest_session_name(name):
        raise AssertionError(f"not a self-test session name; the testkit will not remove it: {name!r}")
    sdir = os.path.join(root, name)
    if os.path.dirname(sdir) != root or os.path.basename(sdir) != name or sdir == root:
        raise AssertionError(f"own session path does not resolve directly under the root: {sdir}")
    if not os.path.lexists(sdir):
        return False
    st = os.lstat(sdir)
    if stat.S_ISLNK(st.st_mode):
        raise AssertionError(f"own session path is a symlink; refusing to remove or follow it: {sdir}")
    if not stat.S_ISDIR(st.st_mode):
        raise AssertionError(f"own session path is not a directory; refusing to remove it: {sdir}")
    # sealed evidence is 0400/0500; make our own tree writable without following any symlink inside it
    for dp, dns, fns in os.walk(sdir, followlinks=False):
        for x in dns + fns:
            px = os.path.join(dp, x)
            try:
                if not os.path.islink(px):
                    os.chmod(px, 0o700 if os.path.isdir(px) else 0o600)
            except OSError:
                pass
    os.chmod(sdir, L.GOVERNED_ROOT_MODE)
    shutil.rmtree(sdir)                       # no ignore_errors: a failure to remove our own session is visible
    if os.path.lexists(sdir):
        raise AssertionError(f"testkit failed to remove its own governed session: {sdir}")
    return True


@contextlib.contextmanager
def owned_selftest_session(root, qroot, name):
    """The ownership law (above) against an explicit root pair. Used by governed_selftest_session with the frozen
    constants and by the ownership suite with private temporary roots. INTERNAL_NON_AUTHORIZING: creates no records
    and decides nothing; the production constructors and the authorizing core do all the work, unchanged."""
    if not is_selftest_session_name(name):
        raise AssertionError(f"not a self-test session name minted by selftest_session_name(): {name!r}")
    if not (os.path.isabs(root) and os.path.normpath(root) == root and os.path.dirname(root) == qroot):
        raise AssertionError(f"governed root pair is not canonical: {qroot!r} / {root!r}")
    sdir = os.path.join(root, name)
    _ensure_governed_tree(qroot, root)
    if os.path.lexists(sdir):
        # never adopt: an operator's or a reviewer's evidence is never used, overwritten or deleted
        raise AssertionError(f"the testkit will not adopt an existing governed session: {sdir}")
    try:
        yield name
    finally:
        _remove_owned_session(root, name)


@contextlib.contextmanager
def governed_selftest_session(name):
    """Yield a canonical self-test session id under the REAL governed root (frozen constants, not configurable):
    the root is created if absent and left in place; the run owns and removes ONLY <root>/<name>; it refuses if the
    name already exists ("the testkit will not adopt an existing governed session") or is not a minted self-test id."""
    with owned_selftest_session(L.GOVERNED_ATTACHMENT_ROOT, L.QUALIFICATION_EVIDENCE_ROOT, name) as n:
        yield n
