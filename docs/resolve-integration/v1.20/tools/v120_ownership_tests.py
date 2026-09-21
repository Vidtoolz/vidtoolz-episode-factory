"""F-120-04 ownership suite: the self-test evidence seam may remove ONLY the one session this run created.

Deterministic, offline, private temporary roots only; the real governed root is never named or touched. Exercises the
SAME code path the validator uses against the real root (evidence_authoring_testkit.owned_selftest_session), plus a
frozen copy of the pre-repair (1e2ce233) cleanup semantics as a regression fixture that must demonstrably delete a
foreign arrival, so the defect is pinned and cannot silently return. Not independent adjudication."""
import contextlib
import json
import os
import shutil
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


@contextlib.contextmanager
def legacy_cleanup_fixture(root, qroot, name):
    """FROZEN COPY of the 1e2ce233 seam's cleanup semantics (F-120-04): `created_tree` derived from the ABSENCE of the
    qualification root at entry, and the WHOLE tree removed at exit when it was. Kept only as the negative fixture the
    suite proves wrong; never used by the validator's positive control."""
    created_tree = not os.path.exists(qroot)
    sdir = os.path.join(root, name)
    if created_tree:
        os.makedirs(root, mode=L.GOVERNED_ROOT_MODE)
    try:
        yield name
    finally:
        shutil.rmtree(sdir, ignore_errors=True)
        if created_tree:
            for dp, dns, fns in os.walk(qroot):
                for x in dns + fns:
                    try:
                        os.chmod(os.path.join(dp, x), 0o700)
                    except OSError:
                        pass
            shutil.rmtree(qroot, ignore_errors=True)


def _write_session(root, name, payload):
    d = os.path.join(root, name)
    os.makedirs(d, mode=L.GOVERNED_ROOT_MODE)
    with open(os.path.join(d, "EVIDENCE-SET.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.chmod(os.path.join(d, "EVIDENCE-SET.json"), 0o400)      # sealed, like real evidence
    return d


def _intact(path, payload):
    try:
        with open(os.path.join(path, "EVIDENCE-SET.json"), encoding="utf-8") as f:
            return json.load(f) == payload
    except (OSError, ValueError):
        return False


def run(bundle, rec):
    def check(name, ok, detail=""):
        rec("selftest-ownership", name, bool(ok), detail)
    with tempfile.TemporaryDirectory(prefix="v120-ownership-") as td:
        assert not td.startswith(REAL_ROOT) and not REAL_ROOT.startswith(td)
        FOREIGN = {"owner": "independent-writer", "must_preserve": True}

        # ---- name law
        n1, n2 = TK.selftest_session_name("t04"), TK.selftest_session_name("t04")
        check("minted self-test ids are valid SESSION_ID_RE names, carry the self-test prefix and a 128-bit token, and two mints never collide",
              n1 != n2 and all(TK.is_selftest_session_name(n) and L.SESSION_ID_RE.match(n) for n in (n1, n2)) and len(n1.rsplit("-", 1)[1]) == 32, n1)
        qA = os.path.join(td, "present"); rA = os.path.join(qA, "attachment")
        for bad in ("sess-v113-prod-foreign", "foreign-existing", "", "../attachment", "sess-selftest-short"):
            try:
                with TK.owned_selftest_session(rA, qA, bad):
                    ok = False
            except AssertionError:
                ok = True
            check(f"a name that is not a minted self-test id is refused before anything is touched: {bad!r}", ok)

        # ---- T04-A: root already exists with an unrelated session
        os.makedirs(rA, mode=L.GOVERNED_ROOT_MODE)
        fA = _write_session(rA, "sess-v113-prod-unrelated", FOREIGN)
        own = TK.selftest_session_name("t04a")
        with TK.owned_selftest_session(rA, qA, own) as name:
            check("T04-A: the seam creates nothing but the (already present) root; the session directory is the caller's to create", not os.path.lexists(os.path.join(rA, name)))
            _write_session(rA, name, {"own": True})
        check("T04-A: root pre-existing - own session removed, unrelated session intact, root retained",
              not os.path.lexists(os.path.join(rA, own)) and _intact(fA, FOREIGN) and os.path.isdir(rA), sorted(os.listdir(rA)))

        # ---- T04-B: root initially ABSENT; another writer arrives after the seam created the root (the reviewer's P2 case)
        qB = os.path.join(td, "absent"); rB = os.path.join(qB, "attachment")
        own = TK.selftest_session_name("t04b")
        with TK.owned_selftest_session(rB, qB, own) as name:
            check("T04-B: an absent qualification tree is created with the frozen mode", os.path.isdir(rB) and (os.lstat(rB).st_mode & 0o777) == L.GOVERNED_ROOT_MODE and (os.lstat(qB).st_mode & 0o777) == L.GOVERNED_ROOT_MODE)
            _write_session(rB, name, {"own": True})
            fB = _write_session(rB, "sess-independent-writer-001", FOREIGN)      # arrives AFTER the root was created by us
        check("T04-B: root initially absent - the other writer's session SURVIVES cleanup, own session removed, root remains (empty root is acceptable; root absence at entry is not ownership)",
              _intact(fB, FOREIGN) and not os.path.lexists(os.path.join(rB, own)) and os.path.isdir(rB) and os.path.isdir(qB), sorted(os.listdir(rB)))

        # ---- old behaviour regression fixture: the frozen 1e2ce233 semantics DO delete the arrival (proves the fixture reproduces the defect)
        qL = os.path.join(td, "legacy"); rL = os.path.join(qL, "attachment"); lname = TK.selftest_session_name("legacy")
        with legacy_cleanup_fixture(rL, qL, lname):
            _write_session(rL, lname, {"own": True})
            fL = _write_session(rL, "sess-independent-writer-002", FOREIGN)
        check("REGRESSION FIXTURE: the pre-repair (1e2ce233) absent-root cleanup silently deletes the other writer's session and the whole tree - the defect is reproduced, so the fixture is a true negative",
              not os.path.lexists(fL) and not os.path.lexists(qL))

        # ---- T04-C: the block exits by exception; only the own session is removed
        qC = os.path.join(td, "failure"); rC = os.path.join(qC, "attachment")
        own = TK.selftest_session_name("t04c"); raised = False
        try:
            with TK.owned_selftest_session(rC, qC, own) as name:
                _write_session(rC, name, {"own": True})
                fC = _write_session(rC, "sess-independent-writer-003", FOREIGN)
                raise AssertionError("forced self-test failure")
        except AssertionError as e:
            raised = "forced self-test failure" in str(e)
        check("T04-C: on an exception inside the block the seam still removes ONLY its own session; the other session and the root survive and the exception propagates",
              raised and _intact(fC, FOREIGN) and not os.path.lexists(os.path.join(rC, own)) and os.path.isdir(rC))

        # ---- T04-D: two concurrent independent self-test runs under one private root (absent at first) cannot cross-delete
        qD = os.path.join(td, "concurrent"); rD = os.path.join(qD, "attachment")
        a, b = TK.selftest_session_name("valA"), TK.selftest_session_name("valB")
        with TK.owned_selftest_session(rD, qD, a):
            _write_session(rD, a, {"A": True})
            with TK.owned_selftest_session(rD, qD, b):
                _write_session(rD, b, {"B": True})
                check("T04-D: both sessions coexist under the shared root", os.path.isdir(os.path.join(rD, a)) and os.path.isdir(os.path.join(rD, b)))
            check("T04-D: B's cleanup removed B only; A survives", not os.path.lexists(os.path.join(rD, b)) and _intact(os.path.join(rD, a), {"A": True}))
        check("T04-D: A's cleanup removed A only; the root created by A remains for other writers (no cross-delete, no tree removal)", not os.path.lexists(os.path.join(rD, a)) and os.path.isdir(rD))
        # interleaved: A enters first, B enters and LEAVES while A is inside - no assertion about departed siblings any more
        with TK.owned_selftest_session(rD, qD, TK.selftest_session_name("valA2")) as a2:
            _write_session(rD, a2, {"A2": True})
            b2 = TK.selftest_session_name("valB2")
            with TK.owned_selftest_session(rD, qD, b2):
                _write_session(rD, b2, {"B2": True})
            check("T04-D: a sibling run finishing while we are inside is not a failure (ownership, not root-listing, is the law)", not os.path.lexists(os.path.join(rD, b2)) and os.path.isdir(os.path.join(rD, a2)))

        # ---- refusals: adoption, symlink at the own path, tampered own path
        qE = os.path.join(td, "refusals"); rE = os.path.join(qE, "attachment"); os.makedirs(rE, mode=L.GOVERNED_ROOT_MODE)
        pre = TK.selftest_session_name("pre"); fE = _write_session(rE, pre, FOREIGN)
        try:
            with TK.owned_selftest_session(rE, qE, pre):
                ok = False
        except AssertionError as e:
            ok = "will not adopt an existing governed session" in str(e)
        check("an existing session with a valid self-test name is still refused, never adopted, never removed", ok and _intact(fE, FOREIGN))
        target = _write_session(rE, "sess-v113-prod-target", FOREIGN)
        own = TK.selftest_session_name("symlink"); ok = False
        try:
            with TK.owned_selftest_session(rE, qE, own) as name:
                os.symlink(target, os.path.join(rE, name))            # an attacker plants a symlink at OUR path while we run
        except AssertionError as e:
            ok = "symlink" in str(e)
        check("a symlink planted at the own session path is refused and NOT followed: the link target survives intact and the refusal is visible",
              ok and _intact(target, FOREIGN) and os.path.islink(os.path.join(rE, own)))
        os.unlink(os.path.join(rE, own))
        check("removing a name outside the self-test namespace through the cleanup primitive is refused",
              (lambda: (TK._remove_owned_session(rE, "sess-v113-prod-target"), False)[1] if False else _refuses(lambda: TK._remove_owned_session(rE, "sess-v113-prod-target")))() and _intact(target, FOREIGN))
        check("a root pair that is not canonical (root not directly under the qualification root) is refused", _refuses(lambda: TK.owned_selftest_session(os.path.join(td, "elsewhere"), qE, TK.selftest_session_name("x")).__enter__()))
        # ---- static law on the seam source
        src = open(os.path.join(HERE, "evidence_authoring_testkit.py"), encoding="utf-8").read()
        check("the seam source contains no whole-tree removal and no root-absence ownership test any more",
              "rmtree(qroot" not in src and "created_tree" not in src and "shutil.rmtree(sdir)" in src and "ignore_errors=True" not in src.split("def _remove_owned_session")[1].split("def owned_selftest_session")[0])
        check("the real governed root was never named by this suite", REAL_ROOT not in td)
    return True


def _refuses(fn):
    try:
        fn()
        return False
    except AssertionError:
        return True


if __name__ == "__main__":
    results = []
    run(os.path.dirname(HERE), lambda sec, name, ok, detail="": results.append({"section": sec, "name": name, "pass": ok, "detail": str(detail)}))
    print(json.dumps({"passed": sum(r["pass"] for r in results), "total": len(results), "results": results}, indent=2))
    sys.exit(0 if all(r["pass"] for r in results) else 1)
