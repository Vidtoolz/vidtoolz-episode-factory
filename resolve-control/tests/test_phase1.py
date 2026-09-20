"""Phase 1 tests: unit + FakeResolve integration. Run: python3 -m pytest resolve-control/tests -q  (or python3 -m unittest)."""
import http.client, json, os, re, socket, subprocess, sys, tempfile, threading, time, unittest, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [ROOT, os.path.join(ROOT, "worker"), HERE]
import resolve_worker as rw
from vrc import protocol
from vrc.client import Client
from vrc.errors import VrcError
from vrc.registry import Registry
SRC = open(os.path.join(ROOT, "worker", "resolve_worker.py")).read()
def strip_comments(s): return "\n".join(l.split("#", 1)[0] for l in s.splitlines())
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
class Env:
    """Spins a real worker (ThreadingHTTPServer) against fake_resolve in-process."""
    def __init__(self, state, host_id=None):
        self.d = tempfile.mkdtemp(); self.state_path = os.path.join(self.d, "state.json"); self.set_state(state)
        os.environ["VRC_FAKE_RESOLVE"] = os.path.join(HERE, "fake_resolve.py"); os.environ["VRC_FAKE_STATE"] = self.state_path
        self.secret = os.urandom(32).hex().encode(); sf = os.path.join(self.d, "secret"); open(sf, "wb").write(self.secret)
        self.host = host_id or socket.gethostname(); self.port = free_port()
        self.worker = rw.Worker(self.host, self.secret, os.path.join(self.d, "wstate"), rw.load_api())
        self.srv = rw.ThreadingHTTPServer(("127.0.0.1", self.port), rw.Handler); self.srv.worker = self.worker
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        reg = {"targets": {self.host: {"transport": "local", "port": self.port, "secret_file": sf}, "otherhost": {"transport": "local", "port": free_port(), "secret_file": sf}}}
        self.reg_path = os.path.join(self.d, "registry.json"); json.dump(reg, open(self.reg_path, "w"))
        self.jp = os.path.join(self.d, "journal.jsonl"); self.client = Client(Registry(self.reg_path), "test", self.jp)
    def set_state(self, st): json.dump(st, open(self.state_path, "w"))
    def raw(self, env, headers=None, secret=None):
        body = json.dumps(env).encode(); h = headers if headers is not None else protocol.auth_headers(secret or self.secret, "POST", "/v1/op", body)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10); c.request("POST", "/v1/op", body, h); r = c.getresponse(); return r.status, json.loads(r.read())
    def close(self): self.srv.shutdown(); self.srv.server_close()
STATE = {"project": {"name": "PYSTY UHD", "uuid": "aaaaaaaa-1111"}, "timelines": [{"name": "problem 3", "uuid": "tl-1"}, {"name": "other", "uuid": "tl-2"}], "current": 0}

class Static(unittest.TestCase):
    def test_worker_never_passes_remote_host_to_scriptapp(self):
        code = strip_comments(SRC)
        calls = re.findall(r"\.scriptapp\(([^)]*)\)", code); self.assertTrue(calls)
        for args in calls: self.assertEqual([a.strip().strip('\'\"') for a in args.split(",")], ["Resolve"], args)
        self.assertNotIn("pinghosts", code)
    def test_worker_binds_loopback_only(self):
        self.assertIn('BIND = "127.0.0.1"', SRC); self.assertIn("LOOPBACK_ONLY", SRC)
    def test_read_only_gate_precedes_resolve_attach(self):
        ex = SRC[SRC.index("def execute"):]; self.assertLess(ex.index("READ_ONLY_MODE"), ex.index("snapshot("))
        self.assertLess(ex.index("UNSUPPORTED_OPERATION"), ex.index("snapshot("))
    def test_no_write_op_in_allowlist(self):
        for op in rw.READ_ONLY_OPS: self.assertFalse(re.match(r"^(Set|Add|Append|Delete|Import|Export|Create|Save|Start|Quit|Run)", op), op)
    def test_no_arbitrary_code_paths(self):
        code = strip_comments(SRC); self.assertNotRegex(code, r"\b(exec|eval)\("); self.assertNotIn("subprocess.Popen", code.replace("powershell", ""))  # only Get-Process probe via run
    def test_sign_parity_worker_vs_client(self):
        s = b"k" * 32; self.assertEqual(rw.sign(s, "1", "n", "POST", "/v1/op", b"{}"), protocol.sign(s, "1", "n", "POST", "/v1/op", b"{}"))

class Integration(unittest.TestCase):
    @classmethod
    def setUpClass(c): c.e = Env(STATE)
    @classmethod
    def tearDownClass(c): c.e.close()
    def setUp(self): self.e.set_state(STATE)
    def test_identify_and_project(self):
        r = self.e.client.identify(self.e.host); self.assertTrue(r["ok"]); self.assertEqual(r["mode"], "READ_ONLY"); self.assertEqual(r["write_authority"], "NONE")
        self.assertEqual(r["project"]["uuid"], "aaaaaaaa-1111"); self.assertEqual(r["timeline"]["name"], "problem 3"); self.assertEqual(r["host_id"], self.e.host)
        self.assertEqual(r["resolve"]["version"], "21.1.0.14"); self.assertIn("worker_generation", r["worker"])
    def test_list_timelines_and_lookup(self):
        r = self.e.client.list_timelines(self.e.host); self.assertEqual([t["uuid"] for t in r["result"]["timelines"]], ["tl-1", "tl-2"])
        r = self.e.client.get_timeline_settings(self.e.host, params={"timeline_uuid": "tl-2"}); self.assertEqual(r["result"]["timeline"]["name"], "other")
        with self.assertRaises(VrcError) as cm: self.e.client.get_timeline_settings(self.e.host, params={"timeline_uuid": "nope"})
        self.assertEqual(cm.exception.code, "TIMELINE_NOT_FOUND")
    def test_target_required_and_unknown_no_fallback(self):
        for bad in (None, ""):
            with self.assertRaises(VrcError) as cm: self.e.client.identify(bad)
            self.assertEqual(cm.exception.code, "TARGET_REQUIRED")
        with self.assertRaises(VrcError) as cm: self.e.client.identify("nosuchhost")
        self.assertEqual(cm.exception.code, "TARGET_UNKNOWN"); self.assertEqual(json.loads(open(self.e.jp).readlines()[-1])["error"]["code"], "TARGET_UNKNOWN")
        with self.assertRaises(VrcError) as cm: self.e.client.identify("otherhost")   # registered but no worker: must be OFFLINE, never re-routed
        self.assertEqual(cm.exception.code, "WORKER_OFFLINE"); self.assertEqual(self.e.client.reg.status("otherhost"), "OFFLINE")
    def test_worker_refuses_wrong_target_host(self):
        env = protocol.envelope("identify", "presto-not-me"); st, r = self.e.raw(env); self.assertEqual(st, 409); self.assertEqual(r["error"]["code"], "TARGET_MISMATCH")
        env = protocol.envelope("identify", None); st, r = self.e.raw(env); self.assertEqual(r["error"]["code"], "TARGET_REQUIRED")
    def test_read_only_mode_rejected_before_resolve(self):
        self.e.set_state({"unavailable": True})  # if the gate leaked, RESOLVE_UNAVAILABLE would surface instead
        for op in ("AppendToTimeline", "SaveProject", "Quit", "SetSetting", "exec"):
            st, r = self.e.raw(protocol.envelope(op, self.e.host)); self.assertEqual(r["error"]["code"], "READ_ONLY_MODE", op); self.assertEqual(st, 409)
        st, r = self.e.raw(protocol.envelope("GetSomethingOdd", self.e.host)); self.assertEqual(r["error"]["code"], "UNSUPPORTED_OPERATION")
        with self.assertRaises(VrcError) as cm: self.e.client.call("AppendToTimeline", self.e.host)
        self.assertEqual(cm.exception.code, "READ_ONLY_MODE")
    def test_auth_failures(self):
        env = protocol.envelope("identify", self.e.host); body = json.dumps(env).encode()
        st, r = self.e.raw(env, headers={"Content-Type": "application/json"}); self.assertEqual((st, r["error"]["code"]), (401, "AUTHENTICATION_FAILED"))
        st, r = self.e.raw(env, secret=b"x" * 32); self.assertEqual(st, 401)
        h = protocol.auth_headers(self.e.secret, "POST", "/v1/op", body); st, _ = self.e.raw(env, headers=h); self.assertEqual(st, 200)
        st, r = self.e.raw(env, headers=h); self.assertEqual(st, 401, "nonce replay must be refused")
        old = str(int(time.time()) - 1000); n = uuid.uuid4().hex
        h = {"X-VRC-Timestamp": old, "X-VRC-Nonce": n, "X-VRC-Signature": protocol.sign(self.e.secret, old, n, "POST", "/v1/op", body), "Content-Type": "application/json"}
        st, _ = self.e.raw(env, headers=h); self.assertEqual(st, 401, "stale timestamp must be refused")
    def test_expected_state_guards(self):
        with self.assertRaises(VrcError) as cm: self.e.client.identify(self.e.host, expected={"project_uuid": "wrong"})
        self.assertEqual(cm.exception.code, "PROJECT_IDENTITY_MISMATCH")
        with self.assertRaises(VrcError) as cm: self.e.client.identify(self.e.host, expected={"timeline_uuid": "tl-2"})
        self.assertEqual(cm.exception.code, "TIMELINE_IDENTITY_MISMATCH")
        with self.assertRaises(VrcError) as cm: self.e.client.identify(self.e.host, expected={"worker_instance_id": "stale-worker"})
        self.assertEqual(cm.exception.code, "WORKER_GENERATION_MISMATCH")
        with self.assertRaises(VrcError) as cm: self.e.client.identify(self.e.host, expected={"resolve_pid": -5})
        self.assertEqual(cm.exception.code, "RESOLVE_SESSION_CHANGED")
        self.assertTrue(self.e.client.identify(self.e.host, expected={"project_uuid": "aaaaaaaa-1111", "timeline_uuid": "tl-1"})["ok"])
    def test_project_switch_is_seen_fresh(self):
        self.assertEqual(self.e.client.get_current_project(self.e.host)["project"]["name"], "PYSTY UHD")
        self.e.set_state({"project": {"name": "iphone prores", "uuid": "bbbb"}, "timelines": [{"name": "Timeline 1", "uuid": "t"}], "current": 0})
        self.assertEqual(self.e.client.get_current_project(self.e.host)["project"]["name"], "iphone prores")
    def test_resolve_unavailable_and_no_project(self):
        self.e.set_state({"unavailable": True})
        with self.assertRaises(VrcError) as cm: self.e.client.identify(self.e.host)
        self.assertEqual(cm.exception.code, "RESOLVE_UNAVAILABLE"); self.assertEqual(self.e.client.reg.status(self.e.host), "RESOLVE_UNAVAILABLE")
        self.assertTrue(self.e.client.health(self.e.host)["ok"])  # health answers even without Resolve
        self.e.set_state({"project": None, "timelines": [], "current": 0})
        with self.assertRaises(VrcError) as cm: self.e.client.get_current_project(self.e.host)
        self.assertEqual(cm.exception.code, "PROJECT_NOT_OPEN")
    def test_fingerprint_stable_and_journal(self):
        a = self.e.client.get_project_fingerprint(self.e.host)["result"]["fingerprint"]; b = self.e.client.get_project_fingerprint(self.e.host)["result"]["fingerprint"]
        self.assertEqual(a, b); self.assertEqual(len(a), 64)
        rows = [json.loads(l) for l in open(self.e.jp)]; self.assertTrue(rows); r = rows[-1]
        for k in ("request_id", "target_host", "op", "worker", "project", "timeline", "status", "duration_ms"): self.assertIn(k, r)
        wrows = [json.loads(l) for l in open(os.path.join(self.e.worker.state_dir, "journal.jsonl"))]; self.assertEqual(wrows[-1]["request_id"], r["request_id"])
    def test_generation_increments_on_restart(self):
        g1 = self.e.worker.identity["worker_generation"]; w2 = rw.Worker(self.e.host, self.e.secret, self.e.worker.state_dir, self.e.worker.api)
        self.assertEqual(w2.identity["worker_generation"], g1 + 1); self.assertNotEqual(w2.identity["worker_instance_id"], self.e.worker.identity["worker_instance_id"])
    def test_stale_state_by_clock(self):
        self.e.client.health(self.e.host); reg = self.e.client.reg; reg.last[self.e.host.lower()]["at"] -= 30; self.assertEqual(reg.status(self.e.host), "STALE")
        reg.last[self.e.host.lower()]["at"] -= 40; self.assertEqual(reg.status(self.e.host), "OFFLINE")

class SessionAnchor(unittest.TestCase):
    def test_linux_anchor_is_parent_and_watch_fires_on_reparent(self):
        self.assertEqual(rw.find_session_anchor(), os.getppid())
        fired = threading.Event(); rw.watch_session_anchor(-1, fired.set); self.assertTrue(fired.wait(3), "watch must fire when anchor pid is not our parent")
    def test_flag_present_and_refuses_without_anchor(self):
        self.assertIn("--exit-with-session", SRC); self.assertIn("SESSION_ANCHOR_REQUIRED", SRC)

class Bind(unittest.TestCase):
    def test_main_refuses_non_loopback_bind(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "worker", "resolve_worker.py"), "--host-id", socket.gethostname(), "--secret-file", "/dev/null", "--state-dir", tempfile.mkdtemp(), "--bind", "0.0.0.0"], capture_output=True, text=True, env={**os.environ, "VRC_FAKE_RESOLVE": "1"})
        self.assertNotEqual(r.returncode, 0); self.assertIn("LOOPBACK_ONLY", r.stderr + r.stdout)
    def test_host_id_mismatch_refused(self):
        with self.assertRaises(SystemExit): rw.Worker("definitely-not-this-host", b"k" * 32, tempfile.mkdtemp(), None)
if __name__ == "__main__": unittest.main()
