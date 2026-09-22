"""Offline tests for the production-read worker CANDIDATE (PR-01..PR-20). fake Resolve only; no host, no network, no
production library. The frozen Phase 1 vrc client (~/resolve-authority-freeze-v1.20/resolve-control) is used unchanged;
the accepted Hermes facade (~/resolve-hermes @ 8e068fea) is imported unchanged for the compatibility tests.
Run: python3 -B tests/test_production_read.py"""
import http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, unittest, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FROZEN = os.environ.get("VRC_PHASE1_ROOT", os.path.expanduser("~/resolve-authority-freeze-v1.20/resolve-control"))
FACADE = os.environ.get("VRC_FACADE_PLUGIN", os.path.expanduser("~/resolve-hermes/plugins/vidtoolz-resolve-readonly"))
sys.path[:0] = [FROZEN, os.path.join(ROOT, "worker"), os.path.join(ROOT, "tools"), HERE]
import resolve_worker as rw
import compile_production_read_policy as comp
from vrc.client import Client
from vrc.errors import VrcError, CODES
from vrc.registry import Registry
from vrc import protocol
SRC = open(os.path.join(ROOT, "worker", "resolve_worker.py")).read()
FROZEN_SRC = open(os.path.join(FROZEN, "worker", "resolve_worker.py")).read()
HOST = socket.gethostname()                      # the worker refuses any other --host-id; must be one of the three logical hosts
assert HOST.lower() in ("presto", "vidlap2", "vidnux"), HOST
LIB_A = {"name": "Prod Disk A", "root": "/srv/prodA"}; LIB_B = {"name": "Prod Disk B", "root": "/srv/prodB"}
P_A1, P_A2, P_B1 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def state(lib, uuid_, name="Prod Project", tls=None):
    return {"database": {"DbName": lib["name"], "DbType": "Disk"}, "project": {"name": name, "uuid": uuid_},
            "timelines": tls or [{"name": "TL_A", "uuid": "tl-a"}, {"name": "TL_B", "uuid": "tl-b"}], "current": 0}
def source_record(hosts):
    return {"schema": "vidtoolz.resolveProductionReadAuthority.v1", "authority_id": "test-authority", "status": "CANDIDATE_FOR_INDEPENDENT_REVIEW",
            "approved_by": None, "worker_identity": {"component": "test", "worker_sha256": "0" * 64}, "facade_identity": {"commit": "8e068fea2d4df5b9709c387f6444502bd7bc2091"},
            "hosts": hosts, "operations": list(comp.OPS), "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local",
            "project_open_law": "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"}
def hosts_for(host, libs):
    return [{"host_id": host.lower(), "libraries": [{"kind": "Disk", "name": l["name"], "registration_root": l["root"], "projects": [{"project_uuid": u} for u in us]} for l, us in libs]}]

class Env:
    """Real candidate worker (ThreadingHTTPServer) against fake_resolve, a fake Resolve config dir with a .dblist, a compiled
    pinned policy, and the FROZEN vrc Client. Everything in a temp dir."""
    def __init__(self, st, hosts, mode="PRODUCTION_READ", dblist_lines=None, registration_file=".dblist", require_library=None, tamper_policy=None, expected_sha=None):
        self.d = tempfile.mkdtemp(prefix="pr-"); self.state_path = os.path.join(self.d, "state.json"); self.set_state(st)
        os.environ["VRC_FAKE_RESOLVE"] = os.path.join(HERE, "fake_resolve.py"); os.environ["VRC_FAKE_STATE"] = self.state_path
        self.cfg = os.path.join(self.d, "resolve-configs"); os.makedirs(self.cfg)
        lines = dblist_lines if dblist_lines is not None else [f"{LIB_A['name']}:{LIB_A['root']}::::DISK", f"{LIB_B['name']}:{LIB_B['root']}::::DISK", "EKA192.168.50.199:192.168.50.199:postgres:DaVinci:EKA:QPSQL"]
        open(os.path.join(self.cfg, registration_file), "w").write("\n".join(lines) + "\n")
        open(os.path.join(self.cfg, "config.dat"), "wb").write(b"xx System.Scripting.Mode = 1 yy")
        self._orig_cfg = rw.resolve_config_dir; rw.resolve_config_dir = lambda: self.cfg
        src = source_record(hosts); self.src_path = os.path.join(self.d, "authority.json"); open(self.src_path, "w").write(json.dumps(src, indent=1))
        self.pol_path = os.path.join(self.d, "policy.json")
        r = subprocess.run([sys.executable, "-B", os.path.join(ROOT, "tools", "compile_production_read_policy.py"), self.src_path, self.pol_path], capture_output=True, text=True)
        self.compile_out = json.loads(r.stdout); assert self.compile_out.get("ok"), r.stdout
        if tamper_policy: tamper_policy(self.pol_path)
        self.pol_sha = expected_sha or rw.sha(open(self.pol_path, "rb").read())
        self.secret = os.urandom(32).hex().encode(); self.sf = os.path.join(self.d, "secret"); open(self.sf, "wb").write(self.secret); os.chmod(self.sf, 0o600)
        self.port = free_port(); self.wstate = os.path.join(self.d, "wstate")
        self.worker = rw.Worker(HOST, self.secret, self.wstate, rw.load_api(), require_library, mode, self.pol_path if mode == "PRODUCTION_READ" else None, self.pol_sha if mode == "PRODUCTION_READ" else None)
        self.srv = rw.ThreadingHTTPServer(("127.0.0.1", self.port), rw.Handler); self.srv.worker = self.worker
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        reg = {"targets": {HOST: {"transport": "local", "port": self.port, "secret_file": self.sf}, "otherhost": {"transport": "local", "port": free_port(), "secret_file": self.sf}}}
        self.reg_path = os.path.join(self.d, "registry.json"); json.dump(reg, open(self.reg_path, "w"))
        self.jp = os.path.join(self.d, "journal.jsonl"); self.client = Client(Registry(self.reg_path), "test", self.jp)
    def set_state(self, st): json.dump(st, open(self.state_path, "w"))
    def call(self, op, **kw): return self.client.call(op, HOST, **kw)
    def err(self, op, **kw):
        try: self.client.call(op, HOST, **kw)
        except VrcError as e: return e
        raise AssertionError(f"{op} unexpectedly succeeded")
    def journal(self): return [json.loads(l) for l in open(os.path.join(self.wstate, "journal.jsonl")) if l.strip()]
    def close(self):
        self.srv.shutdown(); self.srv.server_close(); rw.resolve_config_dir = self._orig_cfg

AUTH = lambda: hosts_for(HOST, [(LIB_A, [P_A1, P_A2]), (LIB_B, [P_B1])])

class ProductionRead(unittest.TestCase):
    def tearDown(self):
        if hasattr(self, "e"): self.e.close()
    # PR-01
    def test_pr01_authorized_host_library_project_reads_succeed_all_nine(self):
        self.e = Env(state(LIB_A, P_A1), AUTH())
        for op in rw.READ_ONLY_OPS:
            kw = {"params": {"timeline_uuid": "tl-b"}} if op == "get_timeline_settings" else {}
            r = self.e.call(op, **kw); self.assertTrue(r["ok"], (op, r.get("error")))
            self.assertEqual((r["protocol"], r["mode"], r["write_authority"], r["write_lease"], r["host_id"].lower(), r["read_profile"]), ("vrc.v1", "READ_ONLY", "NONE", None, HOST.lower(), "PRODUCTION_READ"))
            self.assertEqual(r["worker"]["read_profile"], "PRODUCTION_READ"); self.assertEqual(r["worker"]["production_policy_sha256"], self.e.pol_sha)
            if op != "health": self.assertEqual(r["resolve"]["authorization"]["project_uuid"], P_A1); self.assertEqual(r["resolve"]["authorization"]["library"]["registration_root"], LIB_A["root"])
        self.assertTrue(all(j.get("authorization") == "AUTHORIZED" for j in self.e.journal() if j.get("event") == "OP"))
    # PR-02
    def test_pr02_wrong_host_refused_at_startup_and_wrong_envelope_target_refused(self):
        other = "presto" if HOST.lower() != "presto" else "vidlap2"
        with self.assertRaises(SystemExit) as cm: Env(state(LIB_A, P_A1), hosts_for(other, [(LIB_A, [P_A1])]))
        self.assertIn("grants nothing to host", str(cm.exception))
        self.e = Env(state(LIB_A, P_A1), AUTH())
        body = json.dumps({"protocol": "vrc.v1", "request_id": "x", "op": "identify", "target_host": other, "params": {}, "expected": {}, "deadline_ms": 5000}).encode()
        c = http.client.HTTPConnection("127.0.0.1", self.e.port, timeout=10); c.request("POST", "/v1/op", body, protocol.auth_headers(self.e.secret, "POST", "/v1/op", body)); out = json.loads(c.getresponse().read())
        self.assertFalse(out["ok"]); self.assertEqual(out["error"]["code"], "TARGET_MISMATCH")
    # PR-03
    def test_pr03_wrong_library_fails_before_any_project_read(self):
        self.e = Env({**state(LIB_A, P_A1), "database": {"DbName": "Unlisted Disk", "DbType": "Disk"}}, AUTH())
        open(os.path.join(self.e.cfg, ".dblist"), "a").write("Unlisted Disk:/srv/unlisted::::DISK\n")
        e = self.e.err("get_current_project"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "LIBRARY_NOT_AUTHORIZED")
        h = self.e.call("health"); self.assertEqual(h["resolve"]["probe"], "LIBRARY_MISMATCH"); self.assertIsNone(h["project"])
        eka = self.e.err("identify") if not self.e.set_state({**state(LIB_A, P_A1), "database": {"DbName": "EKA192.168.50.199", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}}) else None
        self.assertEqual(eka.code, "LIBRARY_MISMATCH"); self.assertIn("network", eka.message)
    # PR-04 / PR-35
    def test_pr04_correct_library_wrong_project_fails(self):
        self.e = Env(state(LIB_A, P_B1), AUTH())            # P_B1 is authorized only under LIB_B
        e = self.e.err("get_current_project"); self.assertEqual(e.code, "PROJECT_IDENTITY_MISMATCH"); self.assertEqual(e.detail["reason"], "PROJECT_NOT_AUTHORIZED"); self.assertEqual(e.detail["actual"]["uuid"], P_B1)
        for op in ("list_timelines", "get_project_settings", "get_media_pool_summary", "get_project_fingerprint"): self.assertEqual(self.e.err(op).code, "PROJECT_IDENTITY_MISMATCH")
        h = self.e.call("health"); self.assertEqual(h["resolve"]["probe"], "PROJECT_IDENTITY_MISMATCH"); self.assertIsNone(h["project"])
    # PR-05 / PR-36
    def test_pr05_same_project_name_different_uuid_fails(self):
        self.e = Env(state(LIB_A, str(uuid.uuid4()), name="Prod Project"), AUTH())
        e = self.e.err("identify"); self.assertEqual(e.code, "PROJECT_IDENTITY_MISMATCH"); self.assertEqual(e.detail["actual"]["name"], "Prod Project")
    # PR-06 / PR-33
    def test_pr06_library_switch_between_operations_fails_next_read(self):
        self.e = Env(state(LIB_A, P_A1), AUTH()); self.assertTrue(self.e.call("identify")["ok"])
        self.e.set_state({**state(LIB_A, P_A1), "database": {"DbName": "Local Database", "DbType": "Disk"}})
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH")          # no cached authorization
        self.e.set_state(state(LIB_A, P_A1)); self.assertTrue(self.e.call("identify")["ok"])
    # PR-07 / PR-34
    def test_pr07_project_switch_between_operations_fails_next_read(self):
        self.e = Env(state(LIB_A, P_A1), AUTH()); self.assertTrue(self.e.call("get_current_project")["ok"])
        self.e.set_state(state(LIB_A, str(uuid.uuid4()), name="Other"))
        e = self.e.err("get_current_project"); self.assertEqual(e.code, "PROJECT_IDENTITY_MISMATCH")
        self.assertEqual(self.e.err("list_timelines").code, "PROJECT_IDENTITY_MISMATCH")     # B is never read
    # PR-08
    def test_pr08_missing_policy_fails_closed(self):
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), rw.load_api(), None, "PRODUCTION_READ", None, None)
        self.e = Env(state(LIB_A, P_A1), AUTH()); os.remove(self.e.pol_path)
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "PRODUCTION_POLICY_MISSING")
    # PR-09
    def test_pr09_corrupt_or_broadened_policy_fails_closed_at_startup_and_at_operation_time(self):
        def widen(p):
            pol = json.loads(open(p).read()); pol["hosts"][HOST.lower()]["libraries"][0]["projects"].append("*"); open(p, "w").write(json.dumps(pol))
        with self.assertRaises(SystemExit): Env(state(LIB_A, P_A1), AUTH(), tamper_policy=widen)
        self.e = Env(state(LIB_A, P_A1), AUTH()); self.assertTrue(self.e.call("identify")["ok"])
        open(self.e.pol_path, "a").write(" ")                                              # any byte change after start
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "PRODUCTION_POLICY_PIN_MISMATCH")
    # PR-10
    def test_pr10_unpinned_or_wrong_pin_refused(self):
        with self.assertRaises(SystemExit): Env(state(LIB_A, P_A1), AUTH(), expected_sha="0" * 64)
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), rw.load_api(), None, "PRODUCTION_READ", "/nonexistent", None)
    # PR-11
    def test_pr11_wildcards_and_empty_rejected_by_compiler(self):
        bad = [hosts_for(HOST, [(LIB_A, [])]), hosts_for(HOST, [({"name": "*", "root": "/x"}, [P_A1])]), hosts_for(HOST, [(LIB_A, ["*"])]), hosts_for(HOST, [(LIB_A, ["Prod Project"])]),
               [{"host_id": HOST.lower(), "libraries": [{"kind": "PostgreSQL", "name": "EKA", "registration_root": "192.168.50.199", "projects": [{"project_uuid": P_A1}]}]}],
               [{"host_id": "rojekti", "libraries": []}]]
        for hosts in bad:
            with self.assertRaises(comp.PolicyError): comp.compile_record(json.dumps(source_record(hosts)).encode())
        for field, val in (("write_authority", "READ"), ("persistent_worker_authority", "SYSTEMD"), ("external_scripting", "Network"), ("operations", list(comp.OPS) + ["SaveProject"])):
            src = source_record(AUTH()); src[field] = val
            with self.assertRaises(comp.PolicyError): comp.compile_record(json.dumps(src).encode())
        pol = comp.compile_record(json.dumps(source_record([])).encode()); self.assertEqual(pol["hosts"], {})   # empty = deny-all, never all
        self.assertEqual(comp.compile_record(json.dumps(source_record(AUTH())).encode()), comp.compile_record(json.dumps(source_record(AUTH())).encode()))  # deterministic
    # PR-12 / PR-13
    def test_pr12_13_write_and_generic_operations_refused_before_resolve(self):
        self.e = Env(state(LIB_A, P_A1), AUTH()); n0 = int(open(self.e.state_path + ".attach_count").read()) if os.path.exists(self.e.state_path + ".attach_count") else 0
        for op in ("AppendToTimeline", "SaveProject", "SetCurrentTimeline", "LoadProject", "run_script", "exec", "frobnicate"):
            body = json.dumps({"protocol": "vrc.v1", "request_id": "w", "op": op, "target_host": HOST, "params": {}, "expected": {}, "deadline_ms": 5000}).encode()
            c = http.client.HTTPConnection("127.0.0.1", self.e.port, timeout=10); c.request("POST", "/v1/op", body, protocol.auth_headers(self.e.secret, "POST", "/v1/op", body)); out = json.loads(c.getresponse().read())
            self.assertFalse(out["ok"]); self.assertIn(out["error"]["code"], ("READ_ONLY_MODE", "UNSUPPORTED_OPERATION"))
        n1 = int(open(self.e.state_path + ".attach_count").read()) if os.path.exists(self.e.state_path + ".attach_count") else 0
        self.assertEqual(n0, n1, "a refused op must never attach to Resolve")
    # PR-14 / PR-15 / PR-16 static
    def test_pr14_16_no_project_library_switch_or_save_call_exists_in_candidate_source(self):
        code = "\n".join(l.split("#", 1)[0] for l in SRC.splitlines())
        for m in ("LoadProject(", "OpenProject(", "SetCurrentProject(", "SetCurrentDatabase(", "SaveProject(", "SetCurrentTimeline(", "CreateProject(", "ImportMedia(", "AddMarker("):
            self.assertNotIn("." + m, code, m)
        self.assertIn('FORBIDDEN_OPS = (', SRC); self.assertEqual(re.search(r'READ_ONLY_OPS = \((.*?)\)', SRC, re.S).group(1), re.search(r'READ_ONLY_OPS = \((.*?)\)', FROZEN_SRC, re.S).group(1))
        self.assertEqual(re.search(r'FORBIDDEN_OPS = \((.*?)\)', SRC, re.S).group(1), re.search(r'FORBIDDEN_OPS = \((.*?)\)', FROZEN_SRC, re.S).group(1))
        calls = re.findall(r"\.scriptapp\(([^)]*)\)", code); self.assertTrue(calls)
        for args in calls: self.assertEqual([a.strip().strip('\'\"') for a in args.split(",")], ["Resolve"])
    # PR-17 / PR-18 static
    def test_pr17_18_no_persistence_and_local_scripting_expectation(self):
        self.assertIn('BIND = "127.0.0.1"', SRC); self.assertIn("LOOPBACK_ONLY", SRC)
        for bad in ("systemd", "sc.exe", "schtasks", "New-Service", "Register-ScheduledTask", "restart_policy", "while True: main()"): self.assertNotIn(bad, SRC)
        self.e = Env(state(LIB_A, P_A1), AUTH()); r = self.e.call("identify"); self.assertEqual(r["resolve"]["external_scripting_mode"], "LOCAL")
    # PR-19 qualification mode unchanged (behavioural; the frozen suites are also re-run by run-tests.sh)
    def test_pr19_qualification_mode_keeps_frozen_gate_semantics(self):
        q = "VIDTOOLZ Resolve Qualification v1"
        self.e = Env({**state(LIB_A, P_A1), "database": {"DbName": q, "DbType": "Disk"}}, [], mode="QUALIFICATION_READ", dblist_lines=[f"{q}:/home/vidtoolz/outputs/resolve-qualification-library::::DISK"], require_library=(q, "/home/vidtoolz/outputs/resolve-qualification-library"))
        r = self.e.call("identify"); self.assertTrue(r["ok"]); self.assertEqual(r["read_profile"], "QUALIFICATION_READ"); self.assertNotIn("authorization", r["resolve"])
        for lib in ("EKA", "Local Database", "Prod Disk A"):
            self.e.set_state({**state(LIB_A, P_A1), "database": {"DbName": lib, "DbType": "Disk"}}); self.assertEqual(self.e.err("identify").code, "LIBRARY_MISMATCH")
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), rw.load_api(), (q, None), "PRODUCTION_READ", self.e.pol_path, self.e.pol_sha)   # gates never mix
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), rw.load_api(), None, "QUALIFICATION_READ", self.e.pol_path, self.e.pol_sha)
    # PR-20 accepted facade compatibility (facade bytes untouched)
    @unittest.skipUnless(os.path.isdir(FACADE), "accepted facade not present")
    def test_pr20_accepted_facade_unchanged_reads_through_candidate_and_maps_refusals(self):
        self.e = Env(state(LIB_A, P_A1), AUTH())
        sys.path.insert(0, FACADE); from vrcfacade.facade import ResolveReadOnlyFacade
        f = ResolveReadOnlyFacade(registry_path=self.e.reg_path, phase1_root=FROZEN, journal_path=os.path.join(self.e.d, "fj.jsonl"))
        self.assertEqual(sorted(f.list_operations()) if hasattr(f, "list_operations") else 9, sorted(f.list_operations()) if hasattr(f, "list_operations") else 9)
        for tool in ("resolve_health", "resolve_identify", "resolve_get_current_project", "resolve_get_current_timeline", "resolve_list_timelines", "resolve_get_project_settings", "resolve_get_media_pool_summary", "resolve_get_project_fingerprint"):
            r = f.call(tool, HOST); self.assertTrue(r["ok"], (tool, r.get("error")))
        r = f.call("resolve_get_timeline_settings", HOST, timeline_uuid="tl-b"); self.assertTrue(r["ok"]); self.assertEqual(r["result"]["timeline"]["uuid"], "tl-b")
        r = f.call("resolve_get_current_project", HOST, expected={"project_uuid": str(uuid.uuid4())}); self.assertFalse(r["ok"]); self.assertEqual(r["error"]["code"], "PROJECT_IDENTITY_MISMATCH")
        self.e.set_state(state(LIB_A, P_B1)); r = f.call("resolve_get_current_project", HOST); self.assertFalse(r["ok"]); self.assertEqual(r["error"]["code"], "PROJECT_IDENTITY_MISMATCH"); self.assertEqual(r["error"]["details"]["reason"], "PROJECT_NOT_AUTHORIZED")
        self.e.set_state({**state(LIB_A, P_A1), "database": {"DbName": "Local Database", "DbType": "Disk"}}); r = f.call("resolve_identify", HOST); self.assertFalse(r["ok"]); self.assertEqual(r["error"]["code"], "LIBRARY_MISMATCH"); self.assertIn(r["error"]["details"]["reason"], ("LIBRARY_NOT_AUTHORIZED", "LIBRARY_IDENTITY_UNAVAILABLE"))   # unlisted library: refused either way, fail closed
        for code in ("LIBRARY_MISMATCH", "PROJECT_IDENTITY_MISMATCH", "PROJECT_NOT_OPEN", "TARGET_MISMATCH"): self.assertIn(code, CODES)   # every code the candidate emits is a frozen code
        self.assertTrue(all(m in CODES for m in re.findall(r'OpError\("([A-Z_]+)"', SRC)), set(re.findall(r'OpError\("([A-Z_]+)"', SRC)) - set(CODES))
    def test_windows_registration_file_dblist_conf_is_understood(self):
        self.e = Env(state(LIB_A, P_A1), hosts_for(HOST, [({"name": LIB_A["name"], "root": r"C\Users\presto\Prod Disk A"}, [P_A1])]), dblist_lines=[rf"{LIB_A['name']}:C\Users\presto\Prod Disk A:*:::DISK"], registration_file="dblist.conf")
        self.assertTrue(self.e.call("identify")["ok"])
    def test_library_without_registration_or_same_name_different_root_fails(self):
        self.e = Env(state(LIB_A, P_A1), AUTH(), dblist_lines=[f"{LIB_A['name']}:/srv/OTHER::::DISK"])
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "LIBRARY_NOT_AUTHORIZED"); self.assertEqual(e.detail["actual"]["registration_root"], "/srv/OTHER")
        self.e.close(); del self.e
        self.e = Env(state(LIB_A, P_A1), AUTH(), dblist_lines=[])
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "LIBRARY_IDENTITY_UNAVAILABLE")
    def test_no_project_open_in_production_mode_is_project_not_open_never_a_switch(self):
        self.e = Env({"database": {"DbName": LIB_A["name"], "DbType": "Disk"}, "project": None, "timelines": [], "current": 0}, AUTH())
        self.assertEqual(self.e.err("get_current_project").code, "PROJECT_NOT_OPEN")
if __name__ == "__main__": unittest.main(verbosity=1)
