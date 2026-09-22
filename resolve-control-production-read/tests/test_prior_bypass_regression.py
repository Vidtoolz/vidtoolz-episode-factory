"""Regression proof against the REJECTED predecessor 59a5593d.

The independent review rejected the previous candidate because registration metadata plus a project UUID cannot prove which physical
library an arbitrary pre-existing Resolve handle is actually backed by: the reviewer read B-only data while the worker verified A and
journaled ALLOWED. This suite does two things with real bytes:

  1. it extracts the REJECTED worker and compiler from git at 59a5593d and REPRODUCES that leak end to end, and
  2. it shows the successor refuses that exact session before any Resolve read, because the session itself is now the identity.

Everything is offline: two real temp-directory Disk libraries (B is a byte clone of A, so no content check can separate them), a fake
Resolve handle that reports A's metadata while serving B's data, and a deterministic process probe.
"""
import importlib.util, json, os, shutil, subprocess, sys, tempfile, unittest, uuid

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE]
import test_production_read as T                     # one harness: Fixture / Profile / Env / FakeProbe / record()

REPO = subprocess.run(["git", "-C", ROOT, "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
REJECTED = "59a5593d197757313cd360eb6bd585ed6f7a8021"
PREFIX = "resolve-control-production-read"
B_ONLY = "LIBRARY_B_ONLY_SECRET"
TMP = []


def git_show(path):
    r = subprocess.run(["git", "-C", REPO, "show", f"{REJECTED}:{PREFIX}/{path}"], capture_output=True, check=True)
    return r.stdout


def extract():
    """The rejected candidate's own bytes, materialised from git — never edited, never amended."""
    d = tempfile.mkdtemp(prefix="rejected-"); TMP.append(d)
    os.makedirs(os.path.join(d, "worker")); os.makedirs(os.path.join(d, "tools"))
    wp = os.path.join(d, "worker", "resolve_worker.py"); cp = os.path.join(d, "tools", "compile_production_read_policy.py")
    open(wp, "wb").write(git_show("worker/resolve_worker.py"))
    open(cp, "wb").write(git_show("tools/compile_production_read_policy.py"))
    spec = importlib.util.spec_from_file_location("rejected_worker_%s" % uuid.uuid4().hex, wp)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return d, wp, cp, mod


class LeakHandle:
    """A Resolve handle that REPORTS library A's identity (name, project, timelines — all of which A and its clone B share) while
    SERVING library B's content. This is the physical situation the predecessor could not see: the operator's own long-running session,
    whose open library was never established by anything the worker observed."""
    def __init__(self, libname, project, timelines, project_names, settings):
        self.libname, self.project, self.timelines, self.project_names, self.settings = libname, project, timelines, project_names, settings
        self.attaches = 0
    # --- module-level entry point used by the worker
    def scriptapp(self, name, *host):
        assert not host, "a remote host argument must never be passed"
        self.attaches += 1; return self
    # --- Resolve
    def GetProductName(self): return "DaVinci Resolve Studio"
    def GetVersionString(self): return "21.1.0.14"
    def GetCurrentPage(self): return "edit"
    def GetProjectManager(self): return self
    # --- ProjectManager
    def GetCurrentDatabase(self): return {"DbName": self.libname, "DbType": "Disk"}
    def GetProjectListInCurrentFolder(self): return list(self.project_names)
    def GetCurrentProject(self): return self
    # --- Project
    def GetName(self): return self.project["name"]
    def GetUniqueId(self): return self.project["uuid"]
    def GetTimelineCount(self): return len(self.timelines)
    def GetTimelineByIndex(self, i): return Tl(self.timelines[i - 1])
    def GetCurrentTimeline(self): return Tl(self.timelines[0])
    def GetSetting(self, k=None): return dict(self.settings) if k is None else self.settings.get(k)
    def GetMediaPool(self): return self


class Tl:
    def __init__(self, d): self.d = d
    def GetName(self): return self.d["name"]
    def GetUniqueId(self): return self.d["uuid"]
    def GetStartFrame(self): return 0
    def GetEndFrame(self): return 100
    def GetSetting(self, k=None): return {"timelineFrameRate": "60"} if k is None else "60"
    def GetTrackCount(self, t): return 1
    def GetMarkers(self): return {}


class PriorBypass(unittest.TestCase):
    def setUp(self):
        self.fx = T.Fixture(clone=True)                       # B is a byte clone of A: identical Project.db, identical UUIDs
        self.d, self.wp, self.cp, self.old = extract()
        self.old_sha = T.rw.sha(open(self.wp, "rb").read())

    def old_worker(self, handle):
        """The rejected candidate, driven exactly as it was designed to be driven: an accepted record naming library A, compiled by its
        own compiler, pinned by digest, with A's registration present in the configuration directory it reads."""
        cfg = os.path.join(self.d, "configs"); os.makedirs(cfg, exist_ok=True)
        open(os.path.join(cfg, ".dblist"), "w").write(f"{self.fx.name}:{self.fx.A}::::DISK\n")
        open(os.path.join(cfg, "config.dat"), "wb").write(b"System.Scripting.Mode = 1\n")
        self.old.resolve_config_dir = lambda: cfg
        st = os.stat(self.fx.A)
        rec = {"schema": "vidtoolz.resolveProductionReadAuthority.v1", "authority_id": "rejected-candidate-scope", "status": "ACCEPTED",
               "approved_by": "Mikko", "approved_at": "2026-09-22", "acceptance_record": "test-fixture/ACCEPTANCE.json",
               "worker_identity": {"component": "rejected 0.2.1", "worker_sha256": self.old_sha},
               "facade_identity": {"commit": T.FACADE_COMMIT},
               "hosts": [{"host_id": "vidnux", "libraries": [{"kind": "Disk", "name": self.fx.name, "registration_root": self.fx.A,
                                                             "canonical_root": os.path.realpath(self.fx.A), "physical_dev": st.st_dev,
                                                             "physical_ino": st.st_ino,
                                                             "projects": [{"project_uuid": T.P_A1}, {"project_uuid": T.P_A2}]}]}],
               "operations": list(T.comp.OPS), "write_authority": "NONE", "persistent_worker_authority": "NONE",
               "external_scripting": "Local", "project_open_law": T.LAW}
        sp = os.path.join(self.d, "authority.json"); pp = os.path.join(self.d, "policy.json")
        open(sp, "w").write(json.dumps(rec, indent=1))
        r = subprocess.run([sys.executable, "-B", self.cp, sp, pp, "--worker", self.wp], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        state_dir = os.path.join(self.d, "wstate-" + uuid.uuid4().hex)
        return self.old.Worker("vidnux", os.urandom(32), state_dir, handle, None, "PRODUCTION_READ",
                               pp, T.rw.sha(open(pp, "rb").read()), sp), state_dir

    def run_op(self, worker, op="get_project_settings"):
        return worker.handle({"protocol": worker.PROTOCOL if hasattr(worker, "PROTOCOL") else "vrc.v1", "op": op,
                              "target_host": "vidnux", "caller": "regression", "request_id": uuid.uuid4().hex}, 15000)

    def journal(self, state_dir):
        recs = [json.loads(l) for l in open(os.path.join(state_dir, "journal.jsonl")) if l.strip()]
        return [r for r in recs if r.get("event") == "OP"][-1]

    def test_the_rejected_candidate_really_did_leak_data_from_an_unattested_session(self):
        handle = LeakHandle(self.fx.name, {"name": "Prod Project", "uuid": T.P_A1}, T.TLS, ["Prod Project", "Second"],
                            {"timelineFrameRate": "23.976", "vidtoolzLibraryMarker": B_ONLY})
        worker, state_dir = self.old_worker(handle)
        out = self.run_op(worker)
        self.assertTrue(out["ok"], out.get("error"))
        self.assertEqual(out["result"]["settings"]["vidtoolzLibraryMarker"], B_ONLY,
                         "the predecessor returned the content of a library it never established")
        a = self.journal(state_dir)["authorization"]
        self.assertEqual(a["decision"], "ALLOWED"); self.assertEqual(a["stage"], "content")
        self.assertEqual(a["library"]["name"], self.fx.name)                      # it believed it had verified A
        self.assertGreaterEqual(handle.attaches, 1)

    def test_the_successor_refuses_that_same_session_before_touching_resolve(self):
        p = self.fx.profile()
        handle = LeakHandle(self.fx.name, {"name": "Prod Project", "uuid": T.P_A1}, T.TLS, ["Prod Project", "Second"],
                            {"timelineFrameRate": "23.976", "vidtoolzLibraryMarker": B_ONLY})
        operator_env = {"BMD_RESOLVE_CONFIG_DIR": "/home/vidtoolz/.local/share/DaVinciResolve/configs",
                        "BMD_RESOLVE_SUPPORT_DIR": "/home/vidtoolz/.local/share/DaVinciResolve",
                        "BMD_RESOLVE_LOGS_DIR": "/home/vidtoolz/.local/share/DaVinciResolve/logs",
                        "XDG_CACHE_HOME": "/home/vidtoolz/.cache"}
        for label, probe in (("pre-existing session", T.FakeProbe(p, start_after=-600, environ=operator_env)),
                             ("operator profile, started later", T.FakeProbe(p, start_after=30, environ=operator_env))):
            with self.subTest(label):
                e = T.Env(self.fx.st(), p, probe=probe, api=handle)
                try:
                    err = e.err("get_project_settings")
                    self.assertEqual(err.code, "LIBRARY_MISMATCH")
                    a = e.authz()
                    self.assertEqual(a["decision"], "DENIED"); self.assertEqual(a["stage"], "session")
                    self.assertIn(a["reason"], ("SESSION_PREDATES_PROFILE", "SESSION_PROFILE_MISMATCH"))
                    self.assertEqual(handle.attaches, 0, "the successor must refuse before attaching to Resolve")
                finally: e.close()

    def test_the_predecessor_had_no_session_provenance_and_the_successor_does_not_infer_identity(self):
        old_src = git_show("worker/resolve_worker.py").decode()
        for absent in ("attest_isolated_session", "SystemProbe", "profile_env", "seal_epoch", "SESSION_PREDATES_PROFILE"):
            self.assertNotIn(absent, old_src, f"{absent} is not part of the rejected predecessor")
        for present in ("attest_isolated_session", "SystemProbe", "SESSION_PREDATES_PROFILE", "SESSION_HANDLE_UNBOUND"):
            self.assertIn(present, T.SRC, f"{present} must exist in the successor")
        for inferred in ("project_content_anchor", "parse_registration_production", "unique_disk_registration"):
            self.assertIn(inferred, old_src, f"{inferred} was the predecessor's identity primitive")
            self.assertNotIn(inferred, T.SRC, f"{inferred} must no longer decide production identity")

    def test_the_successor_only_ever_reads_a_one_library_session(self):
        p = self.fx.profile()
        reg = open(os.path.join(p.prov["profile_root"], p.prov["registration_relpath"])).read().splitlines()
        self.assertEqual(reg, [p.gov["registration_line"]])
        self.assertEqual(len([l for l in reg if l.strip()]), 1, "a session born here can have no other library open")
        e = T.Env(self.fx.st(), p)
        try:
            out = e.call("get_project_settings")
            a = e.authz()
            self.assertEqual(a["decision"], "ALLOWED")
            self.assertEqual(a["session"]["pid"], e.probe.resolve_pids[0])
            self.assertEqual(a["library"]["canonical_root"], os.path.realpath(self.fx.A))
            self.assertNotIn("vidtoolzLibraryMarker", out["result"]["settings"])
        finally: e.close()


def tearDownModule():
    for d in TMP + T.TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
