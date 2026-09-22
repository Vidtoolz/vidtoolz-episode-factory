"""Executable closure proof for the independent review of candidate 4ae35e7c.

The review's decisive finding was that Linux permits duplicate environment entries: glibc `getenv()` consumes the FIRST occurrence
while the candidate's `/proc/<pid>/environ` parser kept the LAST. With an unauthorized cloned-B profile first and the sealed-A value
last, the worker accepted the process, attached, returned `LIBRARY_B_ONLY_SECRET` and journaled `ALLOWED`.

This suite does three things with real bytes:

  1. proves the PREMISE on this machine: a real `execve` with duplicate entries, where glibc's `getenv()` and a dict-based parser
     disagree while `/proc/<pid>/environ` shows both;
  2. REPRODUCES all eight reviewer results against the rejected candidate extracted from git at 4ae35e7c — including the B leak;
  3. shows every one of them refused by this successor, with the B-only data never returned and never even fetched.
"""
import ctypes, json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE]
import test_production_read as T                      # one harness: Fixture / Profile / Env / FakeProbe / record()
import test_prior_bypass_regression as P              # LeakHandle: reports A's identity, serves B's content
import resolve_worker as rw

REPO = subprocess.run(["git", "-C", ROOT, "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
REJECTED = "4ae35e7c42896ee7c6ca2c4cac703ff366fab617"
PREFIX = "resolve-control-production-read"
REVIEW = os.path.expanduser("~/outputs/resolve-production-read-isolated-session-independent-review-2026-09-22/evidence/REVIEWER-ATTACKS.json")
OLD = []


def extract_rejected():
    """The rejected candidate's own bytes, materialised from git — never edited, never amended."""
    if OLD: return OLD[0]
    d = tempfile.mkdtemp(prefix="rejected-4ae35e7c-"); OLD.append(d)
    names = subprocess.run(["git", "-C", REPO, "ls-tree", "-r", "--name-only", REJECTED, PREFIX + "/"],
                           capture_output=True, text=True, check=True).stdout.split()
    for name in names:
        rel = name[len(PREFIX) + 1:]
        dst = os.path.join(d, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
        blob = subprocess.run(["git", "-C", REPO, "show", f"{REJECTED}:{name}"], capture_output=True, check=True).stdout
        open(dst, "wb").write(blob)
        if rel.endswith(".sh") or rel.endswith(".py"): os.chmod(dst, 0o755)
    shutil.copyfile(os.path.join(HERE, "reviewer_attacks_old.py"), os.path.join(d, "tests", "reviewer_attacks_old.py"))
    return d


def old_results():
    d = extract_rejected()
    env = dict(os.environ); env["OLD_ROOT"] = d; env["PYTHONDONTWRITEBYTECODE"] = "1"; env.pop("VRC_FAKE_STATE", None)
    r = subprocess.run([sys.executable, "-B", os.path.join(d, "tests", "reviewer_attacks_old.py")],
                       capture_output=True, text=True, env=env, cwd=d)
    assert r.returncode == 0, (r.stdout + r.stderr)[-2000:]
    return json.loads(r.stdout)


class Premise(unittest.TestCase):
    """The defect was real because the platform is: this is measured here, not assumed."""
    def test_the_kernel_really_allows_duplicate_environment_entries(self):
        """A real execve with a repeated key, on this machine: glibc reads the FIRST entry, the REJECTED candidate's own dict-building
        algorithm reads the LAST, and /proc shows both. That gap is the bypass."""
        worker_dir = os.path.join(ROOT, "worker")
        script = (
            "import ctypes, os, sys\n"
            f"sys.path.insert(0, {worker_dir!r})\n"
            "import resolve_worker as rw\n"
            "raw = open('/proc/self/environ','rb').read()\n"
            "entries = rw.SystemProbe().environ_entries(os.getpid())\n"
            "print('successor_entries=' + repr([v for k, v in entries if k == 'K']))\n"
            "libc = ctypes.CDLL(None); libc.getenv.restype = ctypes.c_char_p\n"
            "print('glibc_getenv=' + (libc.getenv(b'K') or b'').decode())\n"
            "collapsed = {}\n"
            "for item in raw.split(b'\\x00'):\n"
            "    if b'=' in item:\n"
            "        k, _, v = item.partition(b'=')\n"
            "        collapsed[k.decode()] = v.decode()\n"
            "print('rejected_parser=' + collapsed['K'])\n")
        d = tempfile.mkdtemp(prefix="dupenv-"); path = os.path.join(d, "child.py"); out_path = os.path.join(d, "out")
        open(path, "w").write(script)
        pid = os.fork()
        if pid == 0:
            libc = ctypes.CDLL(None, use_errno=True)
            argv = (ctypes.c_char_p * 4)(sys.executable.encode(), b"-B", path.encode(), None)
            envp = (ctypes.c_char_p * 4)(b"K=/unauthorized-clone-b", b"K=/sealed-profile", b"PATH=/usr/bin:/bin", None)
            fd = os.open(out_path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            os.dup2(fd, 1); os.dup2(fd, 2)
            libc.execve(sys.executable.encode(), argv, envp)
            os._exit(3)
        os.waitpid(pid, 0)
        out = open(out_path).read(); shutil.rmtree(d, ignore_errors=True)
        self.assertIn("successor_entries=['/unauthorized-clone-b', '/sealed-profile']", out,
                      "the successor's parser must see BOTH entries, in order")
        self.assertIn("glibc_getenv=/unauthorized-clone-b", out, "glibc — and therefore Resolve — consumes the FIRST duplicate")
        self.assertIn("rejected_parser=/sealed-profile", out,
                      "the rejected candidate's dict-building parser read the LAST duplicate: exactly the divergence that leaked B")

    def test_the_successors_parser_never_collapses_duplicates(self):
        self.assertFalse(hasattr(rw.SystemProbe, "environ"), "the collapsing parser must not exist")
        self.assertTrue(hasattr(rw.SystemProbe, "environ_entries"))
        entries = [("K", "/unauthorized"), ("K", "/sealed")]
        with self.assertRaises(rw.OpError) as cm: rw.env_value(entries, "K")
        self.assertEqual(cm.exception.detail["reason"], "SESSION_ENV_AMBIGUOUS")
        self.assertEqual(rw.env_value([("K", "/only")], "K"), "/only")


class ReviewerAttacks(unittest.TestCase):
    """All eight reviewer results, reproduced on the rejected bytes and closed on this candidate."""
    @classmethod
    def setUpClass(cls): cls.old = old_results()

    def test_the_rejected_candidate_reproduces_every_reviewer_result(self):
        recorded = json.load(open(REVIEW)) if os.path.exists(REVIEW) else None
        old = self.old
        self.assertEqual(old["duplicate_environment_parser"], {"BMD_RESOLVE_CONFIG_DIR": "/sealed"},
                         "the rejected parser keeps the last duplicate, which glibc never reads")
        leak = old["duplicate_env_clone_b_end_to_end"]
        self.assertTrue(leak["ok"]); self.assertEqual(leak["b_only_data"], P.B_ONLY)
        self.assertEqual(leak["decision"], "ALLOWED"); self.assertEqual(leak["stage"], "project")
        self.assertGreaterEqual(leak["attaches"], 1)
        self.assertTrue(old["equal_start_epoch"]["accepted"])
        self.assertTrue(old["same_size_executable_mutation"]["accepted"])
        self.assertTrue(old["unsealed_extra_profile_file"]["accepted"])
        self.assertTrue(old["relative_profile_root"]["accepted"])
        self.assertTrue(old["symlink_profile_root_manifest_inside_physical_root"]["accepted"])
        self.assertTrue(old["symlink_profile_root_manifest_inside_physical_root"]["manifest_physically_inside"])
        self.assertEqual(old["inaccessible_listener_owner"]["reported_owners"], [100])
        if recorded:
            for key in recorded:
                self.assertIn(key, old, f"the reviewer's result {key} was not reproduced")

    def test_the_successor_refuses_the_duplicate_environment_clone_b_attack(self):
        fx = T.Fixture(); p = fx.profile()
        handle = P.LeakHandle(fx.name, {"name": "Prod Project", "uuid": T.P_A1}, T.TLS, ["Prod Project", "Second"],
                              {"timelineFrameRate": "23.976", "vidtoolzLibraryMarker": P.B_ONLY})
        probe = T.FakeProbe(p)
        unauthorized = "/tmp/unauthorized-clone-b/config"
        probe._entries = [("BMD_RESOLVE_CONFIG_DIR", unauthorized)] + probe._entries      # exactly the reviewer's ordering
        env = T.Env(fx.st(), p, probe=probe, api=handle)
        try:
            err = env.err("get_project_settings")
            a = env.authz()
            self.assertEqual(err.code, "LIBRARY_MISMATCH")
            self.assertEqual(a["decision"], "DENIED"); self.assertEqual(a["stage"], "session")
            self.assertEqual(a["reason"], "SESSION_ENV_AMBIGUOUS")
            self.assertEqual(handle.attaches, 0, "the successor must refuse before attaching to Resolve")
            self.assertNotIn(P.B_ONLY, json.dumps(a), "no B-only data may appear anywhere")
            journal = json.dumps(env.journal())
            self.assertNotIn(P.B_ONLY, journal)
            self.assertIn("SESSION_ENV_AMBIGUOUS", journal)
        finally: env.close()

    def test_the_successor_closes_the_other_seven_results(self):
        fx = T.Fixture(); p = fx.profile()
        def refuse(fn, reason, label):
            try: fn()
            except rw.OpError as e:
                self.assertEqual(e.detail.get("reason"), reason, f"{label}: {e.detail}"); return
            raise AssertionError(f"{label} was accepted by the successor")
        probe = T.FakeProbe(p, start_after=0); p.attest(probe=probe)
        refuse(lambda: rw.attest_isolated_session(probe, p.gov, p.prov, p.att), "SESSION_PREDATES_PROFILE", "equal_start_epoch")
        p.attest()
        binary = p.gov["resolve_binary"]["realpath"]
        data = bytearray(open(binary, "rb").read()); data[-1] ^= 1; open(binary, "wb").write(data)
        refuse(lambda: rw.attest_isolated_session(T.FakeProbe(p), p.gov, p.prov, p.att), "SESSION_EXECUTABLE_MISMATCH", "same_size_executable_mutation")
        fx2 = T.Fixture(); p2 = fx2.profile()
        open(os.path.join(p2.prov["profile_root"], "config", "unexpected-runtime-state"), "w").write("unsealed\n")
        refuse(lambda: rw.verify_profile_tree(p2.prov, p2.gov), "SESSION_PROFILE_EXTRANEOUS", "unsealed_extra_profile_file")
        parent = tempfile.mkdtemp(prefix="succ-rel-"); T.TMP.append(parent)
        rc, js, _ = T.run([sys.executable, "-B", T.GENERATOR, "--authority", p2.src_path, "--policy", p2.pol_path,
                           "--worker", T.WORKER_PATH, "--source-config", p2.cfg, "--profile-root", "relative-profile",
                           "--out", os.path.join(parent, "s.json"), "--resolve-binary", p2.binary], cwd=parent)
        self.assertEqual(rc, 2, "relative_profile_root must be refused"); self.assertIn("absolute", js["message"])
        real = os.path.join(parent, "real"); link = os.path.join(parent, "link"); os.mkdir(real); os.symlink(real, link)
        rc, js, _ = T.run([sys.executable, "-B", T.GENERATOR, "--authority", p2.src_path, "--policy", p2.pol_path,
                           "--worker", T.WORKER_PATH, "--source-config", p2.cfg, "--profile-root", link,
                           "--out", os.path.join(real, "session.json"), "--resolve-binary", p2.binary])
        self.assertEqual(rc, 2, "symlink_profile_root must be refused")
        self.assertFalse(os.path.isfile(os.path.join(real, "session.json")), "no manifest may be written inside the profile")
        refuse(lambda: rw.attest_isolated_session(T.FakeProbe(p2, unattributed={"222"}), p2.gov, p2.prov, p2.att),
               "SESSION_ENDPOINT_UNATTRIBUTED", "inaccessible_listener_owner")


def tearDownModule():
    for d in OLD: shutil.rmtree(d, ignore_errors=True)
    for d in T.TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
