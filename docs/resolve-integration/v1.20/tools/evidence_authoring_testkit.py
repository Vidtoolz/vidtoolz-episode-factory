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
import re
import secrets
import stat

SELFTEST_SESSION_PREFIX = "sess-selftest-"
SELFTEST_NAME_RE = re.compile(r"^" + re.escape(SELFTEST_SESSION_PREFIX) + r"[A-Za-z0-9._]{1,32}-[0-9]{1,10}-[0-9a-f]{32}$")


def selftest_session_name(tag):
    """Mint a run-unique, collision-resistant self-test session id: prefix + tag + pid + 128-bit random token. Valid
    under the frozen SESSION_ID_RE. Not a timestamp, not a sequence: two runs on one host or two hosts cannot collide."""
    tag = "".join(ch for ch in str(tag) if ch.isalnum() or ch in "._") [:32] or "run"
    name = f"{SELFTEST_SESSION_PREFIX}{tag}-{os.getpid()}-{secrets.token_hex(16)}"
    if not L.SESSION_ID_RE.match(name) or not is_selftest_session_name(name):
        raise AssertionError(f"minted self-test session id is not acceptable to its own validator: {name!r}")
    return name


def is_selftest_session_name(name):
    """v1.20 repair (F-120-11): accept on STRUCTURE, never on a length threshold. A minted id is the prefix, a tag of
    1-32 name characters, the pid and a 32-hex token. The old `len(name) > prefix+40` test rejected short tags at low
    pids, so a name this module minted could fail its own acceptance check."""
    return isinstance(name, str) and bool(SELFTEST_NAME_RE.match(name)) and bool(L.SESSION_ID_RE.match(name))


def _ensure_governed_tree(qroot, root):
    """Create the qualification tree and the attachment root if absent, with the frozen mode. Records NO ownership:
    nothing created here is ever removed by the testkit, and an empty root left behind is the correct end state.
    A pre-existing entry is inspected with lstat and refused if it is not a real directory (a symlink or a file at the
    root path is never followed or replaced)."""
    for d in (qroot, root):
        if os.path.lexists(d):
            st = os.lstat(d)
            if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
                raise AssertionError(f"governed path is not a real directory; refusing to use it: {d}")
        else:
            os.mkdir(d, L.GOVERNED_ROOT_MODE)
            os.chmod(d, L.GOVERNED_ROOT_MODE)


def _rm_tree_at(dirfd, name):
    """Recursively remove <dirfd>/<name>, anchored to the OPEN DIRECTORY dirfd rather than to a pathname. Every step
    uses dir_fd and follow_symlinks=False, so replacing any ancestor (including the root) with a symlink after we
    opened it cannot redirect a single unlink: the kernel resolves relative to the retained directory object."""
    st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    if not stat.S_ISDIR(st.st_mode):
        os.unlink(name, dir_fd=dirfd)
        return
    sub = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dirfd)
    try:
        try:
            os.fchmod(sub, 0o700)
        except OSError:
            pass
        for entry in os.listdir(sub):
            _rm_tree_at(sub, entry)
    finally:
        os.close(sub)
    os.rmdir(name, dir_fd=dirfd)


def _remove_owned_session(rootfd, name, ident):
    """Remove EXACTLY the filesystem OBJECT this run created, identified by (st_dev, st_ino) captured at creation and
    re-verified here, relative to the retained root descriptor.

    Pathname confinement is not ownership. If the object now at <root>/<name> is not the object we created - because it
    was renamed aside and replaced, because the parent was swapped for a symlink to a foreign tree, or because it was
    removed and recreated by someone else - cleanup REFUSES and deletes nothing. Leaving our own session behind is a
    visible failure; deleting somebody else's evidence is not an acceptable alternative."""
    if not is_selftest_session_name(name):
        raise AssertionError(f"not a self-test session name; the testkit will not remove it: {name!r}")
    try:
        st = os.stat(name, dir_fd=rootfd, follow_symlinks=False)
    except FileNotFoundError:
        return False                       # our object is already gone: nothing of ours to remove
    if stat.S_ISLNK(st.st_mode):
        raise AssertionError(f"own session path is now a symlink; refusing to remove or follow it: {name}")
    if not stat.S_ISDIR(st.st_mode):
        raise AssertionError(f"own session path is no longer a directory; refusing to remove it: {name}")
    if (st.st_dev, st.st_ino) != ident:
        raise AssertionError(
            "the object at the owned session path is NOT the object this run created "
            f"(created dev/ino {ident}, found {(st.st_dev, st.st_ino)}); refusing to remove foreign evidence: {name}")
    _rm_tree_at(rootfd, name)
    try:
        os.stat(name, dir_fd=rootfd, follow_symlinks=False)
    except FileNotFoundError:
        return True
    raise AssertionError(f"testkit failed to remove its own governed session: {name}")


@contextlib.contextmanager
def owned_selftest_session(root, qroot, name):
    """The ownership law against an explicit root pair. Used by governed_selftest_session with the frozen constants and
    by the ownership suite with private temporary roots.

    Ownership is established by ATOMIC CREATION, not by observing that a pathname is free: os.mkdir under the retained
    root descriptor either creates the object (we own it) or fails EEXIST (someone else owns it and we refuse - "the
    testkit will not adopt an existing governed session"). There is no window in which another writer can create the
    session we are about to claim. The (dev, ino) of what we created is retained and re-verified before any removal.

    INTERNAL_NON_AUTHORIZING: creates no records and decides nothing; the production constructors and the authorizing
    core do all the work, unchanged."""
    if not is_selftest_session_name(name):
        raise AssertionError(f"not a self-test session name minted by selftest_session_name(): {name!r}")
    if not (os.path.isabs(root) and os.path.normpath(root) == root and os.path.dirname(root) == qroot):
        raise AssertionError(f"governed root pair is not canonical: {qroot!r} / {root!r}")
    _ensure_governed_tree(qroot, root)
    rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.mkdir(name, L.GOVERNED_ROOT_MODE, dir_fd=rootfd)
        except FileExistsError:
            raise AssertionError(f"the testkit will not adopt an existing governed session: {os.path.join(root, name)}")
        st = os.stat(name, dir_fd=rootfd, follow_symlinks=False)
        ident = (st.st_dev, st.st_ino)
        try:
            yield name
        finally:
            _remove_owned_session(rootfd, name, ident)
    finally:
        os.close(rootfd)


@contextlib.contextmanager
def governed_selftest_session(name):
    """Yield a canonical self-test session id under the REAL governed root (frozen constants, not configurable):
    an absent root is created with the frozen mode and LEFT IN PLACE, the run owns and removes only the session object
    it atomically created, identified by device and inode, and the atomic create refuses an occupied name:
    "the testkit will not adopt an existing governed session". The shared root is never owned."""
    with owned_selftest_session(L.GOVERNED_ATTACHMENT_ROOT, L.QUALIFICATION_EVIDENCE_ROOT, name) as n:
        yield n
