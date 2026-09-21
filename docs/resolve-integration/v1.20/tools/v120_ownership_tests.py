"""F-120-04 ownership suite: validator and testkit cleanup may remove ONLY the filesystem object this exact run
created, proved by device+inode, anchored to a retained directory descriptor.

Deterministic, offline, private temporary roots only; the real governed root is never named or touched. The suite
exercises the SAME code the validator uses against the real root (evidence_authoring_testkit.owned_selftest_session),
and pins BOTH pre-repair cleanup shapes as regression fixtures that must demonstrably destroy foreign evidence:
  * the helper's old absent-root branch (removed in the first repair), and
  * the full validator's old core-positive branch `shutil.rmtree(QUALIFICATION_EVIDENCE_ROOT)` (removed here).
Not independent adjudication.
"""
import contextlib
import json
import os
import shutil
import re
import stat
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import authority_lib as L                    # noqa: E402
import evidence_authoring_testkit as TK      # noqa: E402

REAL_ROOT = L.GOVERNED_ATTACHMENT_ROOT
FOREIGN = {"owner": "independent-writer", "must_preserve": True}


@contextlib.contextmanager
def legacy_helper_cleanup(root, qroot, name):
    """FROZEN COPY of the 1e2ce233 helper seam: ownership derived from the ABSENCE of the qualification root at entry,
    whole tree removed at exit. Negative fixture only."""
    created_tree = not os.path.exists(qroot)
    if created_tree:
        os.makedirs(root, mode=L.GOVERNED_ROOT_MODE)
    try:
        yield name
    finally:
        shutil.rmtree(os.path.join(root, name), ignore_errors=True)
        if created_tree:
            shutil.rmtree(qroot, ignore_errors=True)


@contextlib.contextmanager
def legacy_validator_core_positive(root, qroot, name):
    """FROZEN COPY of the 06b204f7 full-validator core-positive branch: it ran only when the qualification root was
    absent, created the tree, and in `finally` did `shutil.rmtree(QUALIFICATION_EVIDENCE_ROOT, ignore_errors=True)`.
    Negative fixture only."""
    if os.path.exists(qroot):
        yield name
        return
    os.makedirs(root, mode=L.GOVERNED_ROOT_MODE)
    try:
        yield name
    finally:
        for dp, dns, fns in os.walk(qroot):
            for x in dns + fns:
                try:
                    os.chmod(os.path.join(dp, x), 0o700)
                except OSError:
                    pass
        shutil.rmtree(qroot, ignore_errors=True)


def _write_foreign(root, name, payload=None):
    """A session created by somebody who is not this run."""
    d = os.path.join(root, name)
    os.makedirs(d, mode=L.GOVERNED_ROOT_MODE, exist_ok=True)
    with open(os.path.join(d, "EVIDENCE-SET.json"), "w", encoding="utf-8") as f:
        json.dump(payload if payload is not None else FOREIGN, f)
    os.chmod(os.path.join(d, "EVIDENCE-SET.json"), 0o400)
    return d


def _fill_own(root, name):
    """The owned session directory already exists (the seam created it atomically); put sealed content inside it."""
    d = os.path.join(root, name)
    with open(os.path.join(d, "EVIDENCE-SET.json"), "w", encoding="utf-8") as f:
        json.dump({"own": True}, f)
    os.chmod(os.path.join(d, "EVIDENCE-SET.json"), 0o400)
    return d


def _intact(path, payload=None):
    try:
        with open(os.path.join(path, "EVIDENCE-SET.json"), encoding="utf-8") as f:
            return json.load(f) == (payload if payload is not None else FOREIGN)
    except (OSError, ValueError):
        return False


def _code_only(src):
    """Executable code text with comments and string literals removed. A raw-text grep would find this very audit's
    own pattern literal and report the thing it exists to forbid; tokenizing first makes the audit see what the
    interpreter would run. Defined locally on purpose: importing validate_v1_20 would re-execute the whole validator."""
    import io
    import tokenize
    out = []
    try:
        for t in tokenize.generate_tokens(io.StringIO(src).readline):
            if t.type in (tokenize.COMMENT, tokenize.STRING):
                continue
            out.append(t.string)
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return src
    return " ".join(out)


def _refuses(fn):
    try:
        fn()
        return False
    except AssertionError:
        return True


def run(bundle, rec):
    def check(name, ok, detail=""):
        rec("selftest-ownership", name, bool(ok), detail)
    with tempfile.TemporaryDirectory(prefix="v120-ownership-") as td:
        assert not td.startswith(REAL_ROOT) and not REAL_ROOT.startswith(td)

        # ---------------- name law (incl. F-120-11) ----------------
        n1, n2 = TK.selftest_session_name("t04"), TK.selftest_session_name("t04")
        check("minted self-test ids are valid SESSION_ID_RE names, carry the self-test prefix and a 128-bit token, and two mints never collide",
              n1 != n2 and all(TK.is_selftest_session_name(n) and L.SESSION_ID_RE.match(n) for n in (n1, n2)), n1)
        check("F-120-11: a minted id is accepted by its own validator for EVERY tag length, including a one-character tag (acceptance is structural, never a length threshold)",
              all(TK.is_selftest_session_name(TK.selftest_session_name(t)) for t in ("A", "x", "t04", "v114ctl", "a" * 32)),
              "tags A, x, t04, v114ctl and a*32 all mint and all validate")
        qA = os.path.join(td, "present"); rA = os.path.join(qA, "attachment")
        for bad in ("sess-v113-prod-foreign", "foreign-existing", "", "../attachment", "sess-selftest-nohex-1-zz"):
            check(f"a name that is not a minted self-test id is refused before anything is touched: {bad!r}",
                  _refuses(lambda b=bad: TK.owned_selftest_session(rA, qA, b).__enter__()))

        # ---------------- T04-A: root already exists, unrelated session present ----------------
        os.makedirs(rA, mode=L.GOVERNED_ROOT_MODE)
        fA = _write_foreign(rA, "sess-v113-prod-unrelated")
        own = TK.selftest_session_name("t04a")
        with TK.owned_selftest_session(rA, qA, own) as name:
            check("T04-A: the seam creates the owned session ATOMICALLY at entry, so ownership is creation and not an observation that a pathname was free",
                  os.path.isdir(os.path.join(rA, name)))
            _fill_own(rA, name)
        check("T04-A: root pre-existing - own session removed, unrelated session intact, root retained",
              not os.path.lexists(os.path.join(rA, own)) and _intact(fA) and os.path.isdir(rA), sorted(os.listdir(rA)))

        # ---------------- T04-B: root initially ABSENT, foreign writer arrives mid-run ----------------
        qB = os.path.join(td, "absent"); rB = os.path.join(qB, "attachment")
        own = TK.selftest_session_name("t04b")
        with TK.owned_selftest_session(rB, qB, own) as name:
            check("T04-B: an absent qualification tree is created with the frozen mode",
                  os.path.isdir(rB) and (os.lstat(rB).st_mode & 0o777) == L.GOVERNED_ROOT_MODE
                  and (os.lstat(qB).st_mode & 0o777) == L.GOVERNED_ROOT_MODE)
            _fill_own(rB, name)
            fB = _write_foreign(rB, "sess-independent-writer-001")
        check("T04-B: root initially absent - the other writer's session SURVIVES cleanup, own session removed, the shared root REMAINS (an empty root is the correct end state; root absence at entry is not ownership)",
              _intact(fB) and not os.path.lexists(os.path.join(rB, own)) and os.path.isdir(rB) and os.path.isdir(qB),
              sorted(os.listdir(rB)))

        # ---------------- regression fixtures: both pre-repair shapes must destroy the arrival ----------------
        qL = os.path.join(td, "legacy-helper"); rL = os.path.join(qL, "attachment"); lname = TK.selftest_session_name("legacyhelper")
        with legacy_helper_cleanup(rL, qL, lname):
            _write_foreign(rL, lname, {"own": True})
            fL = _write_foreign(rL, "sess-independent-writer-002")
        check("REGRESSION FIXTURE 1: the pre-repair HELPER absent-root cleanup silently deletes the other writer's session and the whole tree - the defect is reproduced, so the fixture is a true negative",
              not os.path.lexists(fL) and not os.path.lexists(qL))
        qV = os.path.join(td, "legacy-validator"); rV = os.path.join(qV, "attachment"); vname = "sess-v114-authorizing-control"
        with legacy_validator_core_positive(rV, qV, vname):
            _write_foreign(rV, vname, {"own": True})
            fV = _write_foreign(rV, "sess-independent-writer-003")
        check("REGRESSION FIXTURE 2 (F-120-04 as it remained in 06b204f7): the FULL VALIDATOR core-positive branch rmtree'd the whole qualification root in its finally, destroying the other writer's session - reproduced, so the fixture is a true negative",
              not os.path.lexists(fV) and not os.path.lexists(qV))

        # ---------------- T04-C: exception path ----------------
        qC = os.path.join(td, "failure"); rC = os.path.join(qC, "attachment")
        own = TK.selftest_session_name("t04c"); raised = False
        try:
            with TK.owned_selftest_session(rC, qC, own) as name:
                _fill_own(rC, name)
                fC = _write_foreign(rC, "sess-independent-writer-004")
                raise AssertionError("forced self-test failure")
        except AssertionError as e:
            raised = "forced self-test failure" in str(e)
        check("T04-C: on an exception inside the block the seam still removes ONLY its own session; the other session and the root survive and the exception propagates",
              raised and _intact(fC) and not os.path.lexists(os.path.join(rC, own)) and os.path.isdir(rC))

        # ---------------- T04-D: two interleaved runs ----------------
        qD = os.path.join(td, "concurrent"); rD = os.path.join(qD, "attachment")
        a, b = TK.selftest_session_name("valA"), TK.selftest_session_name("valB")
        with TK.owned_selftest_session(rD, qD, a):
            _fill_own(rD, a)
            with TK.owned_selftest_session(rD, qD, b):
                _fill_own(rD, b)
                check("T04-D: both sessions coexist under the shared root",
                      os.path.isdir(os.path.join(rD, a)) and os.path.isdir(os.path.join(rD, b)))
            check("T04-D: B's cleanup removed B only; A survives",
                  not os.path.lexists(os.path.join(rD, b)) and _intact(os.path.join(rD, a), {"own": True}))
        check("T04-D: A's cleanup removed A only; the root A created remains for other writers (no cross-delete, no tree removal)",
              not os.path.lexists(os.path.join(rD, a)) and os.path.isdir(rD))

        # ---------------- T04-E: owned session path REPLACED before cleanup ----------------
        qE = os.path.join(td, "replace"); rE = os.path.join(qE, "attachment")
        own = TK.selftest_session_name("t04e"); refused = False
        try:
            with TK.owned_selftest_session(rE, qE, own) as name:
                _fill_own(rE, name)
                os.rename(os.path.join(rE, name), os.path.join(rE, "our-real-session-moved-aside"))
                fE = _write_foreign(rE, name)          # a FOREIGN real directory now occupies our pathname
        except AssertionError as e:
            refused = "NOT the object this run created" in str(e)
        check("T04-E: the owned session is renamed aside and a FOREIGN real directory is put at the same pathname - cleanup REFUSES on the device+inode mismatch and deletes nothing",
              refused)
        check("T04-E: the foreign replacement survives intact and our own moved-aside directory is untouched",
              _intact(fE) and os.path.isdir(os.path.join(rE, "our-real-session-moved-aside")), sorted(os.listdir(rE)))

        # ---------------- T04-F: parent root replaced by a symlink to a foreign tree ----------------
        qF = os.path.join(td, "symlink"); rF = os.path.join(qF, "attachment")
        foreignTree = os.path.join(td, "foreign-tree")
        own = TK.selftest_session_name("t04f"); exc = None
        os.makedirs(foreignTree, mode=0o700)
        try:
            with TK.owned_selftest_session(rF, qF, own) as name:
                _fill_own(rF, name)
                decoy = _write_foreign(foreignTree, name)      # same basename inside the foreign tree
                os.rename(rF, os.path.join(qF, "attachment-real-moved"))
                os.symlink(foreignTree, rF)                    # the PARENT is now a symlink to foreign evidence
        except AssertionError as e:
            exc = str(e)
        check("T04-F: with the attachment root replaced by a symlink to a foreign tree containing the same session basename, cleanup does NOT follow the symlink - the foreign object is untouched",
              _intact(decoy), "foreign decoy intact=" + str(_intact(decoy)) + (" exc=" + exc[:60] if exc else ""))
        check("T04-F: cleanup stayed anchored to the real directory object it opened at entry, so it removed its own session there and nothing outside that boundary",
              not os.path.lexists(os.path.join(qF, "attachment-real-moved", own)) and os.path.islink(rF),
              "own session removed from the real root; the symlink itself is left for the reviewer to see")
        os.unlink(rF)

        # ---------------- refusals: adoption, symlink at own path, foreign-name removal ----------------
        qG = os.path.join(td, "refusals"); rG = os.path.join(qG, "attachment"); os.makedirs(rG, mode=L.GOVERNED_ROOT_MODE)
        pre = TK.selftest_session_name("pre"); fG = _write_foreign(rG, pre)
        check("an existing session with a valid self-test name is refused by the ATOMIC create (EEXIST), never adopted, never removed",
              _refuses(lambda: TK.owned_selftest_session(rG, qG, pre).__enter__()) and _intact(fG))
        target = _write_foreign(rG, "sess-v113-prod-target")
        own = TK.selftest_session_name("symlink"); ok = False
        try:
            with TK.owned_selftest_session(rG, qG, own) as name:
                os.rmdir(os.path.join(rG, name))
                os.symlink(target, os.path.join(rG, name))     # a symlink planted at OUR path while we run
        except AssertionError as e:
            ok = "symlink" in str(e)
        check("a symlink planted at the own session path is refused and NOT followed: the link target survives intact and the refusal is visible",
              ok and _intact(target) and os.path.islink(os.path.join(rG, own)))
        os.unlink(os.path.join(rG, own))
        check("a root pair that is not canonical (root not directly under the qualification root) is refused",
              _refuses(lambda: TK.owned_selftest_session(os.path.join(td, "elsewhere"), qG, TK.selftest_session_name("x")).__enter__()))

        # ---------------- static law ----------------
        src = open(os.path.join(HERE, "evidence_authoring_testkit.py"), encoding="utf-8").read()
        vsrc = _code_only(open(os.path.join(HERE, "validate_v1_20.py"), encoding="utf-8").read())
        check("the seam derives ownership from atomic creation and device+inode identity, not from a pathname, and holds a retained root descriptor",
              "os.mkdir(name, L.GOVERNED_ROOT_MODE, dir_fd=rootfd)" in src and "(st.st_dev, st.st_ino) != ident" in src
              and "O_DIRECTORY | os.O_NOFOLLOW" in src and "dir_fd=rootfd" in src)
        check("no cleanup path in the seam or in the full validator recursively removes a shared qualification/attachment root",
              "rmtree(qroot" not in src and "created_tree" not in src
              and not any(re.search(r"rmtree\s*\(\s*" + re.escape(t), vsrc)
                          for t in ("_ROOTP", "L . QUALIFICATION_EVIDENCE_ROOT", "L . GOVERNED_ATTACHMENT_ROOT")))
        check("the real governed root was never named by this suite", REAL_ROOT not in td)
    return True


if __name__ == "__main__":
    results = []
    run(os.path.dirname(HERE), lambda sec, name, ok, detail="": results.append({"section": sec, "name": name, "pass": ok, "detail": str(detail)}))
    print(json.dumps({"passed": sum(r["pass"] for r in results), "total": len(results), "results": results}, indent=2))
    sys.exit(0 if all(r["pass"] for r in results) else 1)
