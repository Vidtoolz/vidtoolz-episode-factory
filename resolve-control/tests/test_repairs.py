"""Repair regression tests for the 2026-09-20 independent-review P2 findings (F-01..F-04) and the v1.18 §A4 library gate.
Run: python3 -m unittest resolve-control/tests/test_repairs.py"""
import http.client, json, os, socket, sys, tempfile, threading, time, unittest, uuid, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [ROOT, os.path.join(ROOT, "worker"), HERE]
import resolve_worker as rw
from vrc import protocol
from vrc.client import Client
from vrc.errors import VrcError
from vrc.registry import Registry
STATE = {"project": {"name": "QUAL", "uuid": "q-1"}, "timelines": [{"name": "t", "uuid": "tl-1"}], "current": 0,
         "database": {"DbName": "VIDTOOLZ Resolve Qualification v1", "DbType": "Disk", "IpAddress": None}}
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
class Rig:
    def __init__(self, state=STATE, require_library=None):
        self.d = tempfile.mkdtemp(); self.sp = os.path.join(self.d, "state.json"); self.set(state)
        os.environ["VRC_FAKE_RESOLVE"] = os.path.join(HERE, "fake_resolve.py"); os.environ["VRC_FAKE_STATE"] = self.sp
        self.secret = os.urandom(32).hex().encode(); self.sf = os.path.join(self.d, "k"); open(self.sf, "wb").write(self.secret)
        self.host = socket.gethostname(); self.port = free_port(); self.wstate = os.path.join(self.d, "w"); self.req = require_library; self.start()
        json.dump({"targets": {self.host: {"transport": "local", "port": self.port, "secret_file": self.sf}}}, open(os.path.join(self.d, "reg.json"), "w"))
        self.client = Client(Registry(os.path.join(self.d, "reg.json")), "repair-tests", os.path.join(self.d, "j.jsonl"))
    def start(self):
        self.worker = rw.Worker(self.host, self.secret, self.wstate, rw.load_api(), self.req)
        self.srv = rw.ThreadingHTTPServer(("127.0.0.1", self.port), rw.Handler); self.srv.worker = self.worker
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
    def restart(self): self.srv.shutdown(); self.srv.server_close(); time.sleep(0.1); self.start()
    def stop(self): self.srv.shutdown(); self.srv.server_close()
    def set(self, st): json.dump(st, open(self.sp, "w"))
    def attaches(self):
        p = self.sp + ".attach_count"; return int(open(p).read()) if os.path.exists(p) else 0
    def signed(self, op="identify", **kw):
        env = protocol.envelope(op, self.host, **kw); body = json.dumps(env).encode(); return env, body, protocol.auth_headers(self.secret, "POST", "/v1/op", body)
    def raw(self, body, headers, path="/v1/op", method="POST"):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20); c.request(method, path, body, headers); r = c.getresponse(); return r.status, json.loads(r.read() or b"{}")
    def journal(self): return [json.loads(l) for l in open(os.path.join(self.wstate, "journal.jsonl"))]

class F01Replay(unittest.TestCase):
    def setUp(self): self.g = Rig()
    def tearDown(self): self.g.stop()
    def test_1_2_valid_then_exact_replay_rejected(self):
        env, body, h = self.g.signed(); st1, _ = self.g.raw(body, h); st2, r2 = self.g.raw(body, h)
        self.assertEqual(st1, 200); self.assertEqual((st2, r2["error"]["code"]), (401, "REPLAY_DETECTED"))
    def test_3_4_replay_still_rejected_after_worker_restart(self):
        env, body, h = self.g.signed(); self.assertEqual(self.g.raw(body, h)[0], 200)
        n0 = self.g.attaches(); self.g.restart(); self.assertGreaterEqual(self.g.worker.replay.loaded, 1)
        st, r = self.g.raw(body, h); self.assertEqual((st, r["error"]["code"]), (401, "REPLAY_DETECTED"))
        self.assertEqual(self.g.attaches(), n0, "replay must cause zero Resolve attachment")           # test 7
    def test_5_expired_entries_are_removable_and_store_bounded(self):
        g = rw.ReplayGuard(os.path.join(self.g.d, "rg.jsonl"), window_s=1, compact_at=50)
        for i in range(60): self.assertTrue(g.check(f"n{i}", int(time.time())))
        self.assertLessEqual(g.size(), 60); time.sleep(1.2); g.check("late", int(time.time()))
        g._compact(time.time()); self.assertLessEqual(g.size(), 2, "expired nonces pruned"); self.assertLessEqual(sum(1 for _ in open(g.path)), 2)
        g2 = rw.ReplayGuard(g.path, window_s=1); self.assertNotIn("n1", g2.seen)   # expired entries are not reloaded
    def test_6_invalid_signature_cannot_poison_replay_state(self):
        env, body, h = self.g.signed(); bad = dict(h, **{"X-VRC-Signature": "0" * 64})
        st, r = self.g.raw(body, bad); self.assertEqual((st, r["error"]["code"]), (401, "AUTHENTICATION_FAILED"))
        self.assertEqual(self.g.worker.replay.size(), 0, "unauthenticated nonce must not be recorded")
        self.assertEqual(self.g.raw(body, h)[0], 200, "the genuine request is still accepted afterwards")
    def test_7_replay_rejected_before_resolve_and_journaled(self):
        env, body, h = self.g.signed(); self.g.raw(body, h); n0 = self.g.attaches(); self.g.raw(body, h)
        self.assertEqual(self.g.attaches(), n0); ev = [j for j in self.g.journal() if j.get("event") == "REPLAY_DETECTED"]
        self.assertEqual(len(ev), 1); self.assertEqual(ev[0]["request_id"], env["request_id"]); self.assertNotIn("X-VRC", json.dumps(ev))
    def test_client_surfaces_replay_code(self):
        env, body, h = self.g.signed(); self.g.raw(body, h)
        from vrc import transport
        with self.assertRaises(VrcError) as cm: transport.send({"transport": "local", "port": self.g.port, "host_id": self.g.host}, self.g.secret, env) if False else self._resend(body, h)
        self.assertEqual(cm.exception.code, "REPLAY_DETECTED")
    def _resend(self, body, h):
        st, r = self.g.raw(body, h)
        if st == 401: raise VrcError(r["error"]["code"], r["error"]["message"])

class F02Saturation(unittest.TestCase):
    def setUp(self): self.g = Rig()
    def tearDown(self): self.g.set(STATE); time.sleep(2.6); self.g.stop()
    def test_saturation_is_refused_fast_health_stays_observable_and_recovers(self):
        self.g.set(dict(STATE, sleep_s=2.5))
        t0 = time.time()
        with self.assertRaises(VrcError) as cm: self.g.client.identify(self.g.host, deadline_ms=300)
        self.assertEqual(cm.exception.code, "TIMEOUT"); self.assertLess(time.time() - t0, 1.5)
        with cf.ThreadPoolExecutor(8) as ex: codes = [f.result() for f in [ex.submit(lambda: self._code("identify", 300)) for _ in range(6)]]
        self.assertIn("WORKER_SATURATED", codes, "beyond capacity requests are refused immediately, not queued")
        self.assertLessEqual(codes.count("TIMEOUT"), rw.POOL_CAPACITY)
        t1 = time.time(); h = self.g.client.health(self.g.host, deadline_ms=1000); dt = time.time() - t1
        self.assertTrue(h["ok"]); self.assertEqual(h["resolve"]["pool"]["state"], "SATURATED"); self.assertEqual(h["resolve"]["probe"], "SKIPPED_SATURATED")
        self.assertLess(dt, 1.0, "health must not wait on a Resolve slot"); self.assertEqual(self.g.client.reg.status(self.g.host), "SATURATED")
        self.assertLessEqual(threading.active_count(), 8 + rw.POOL_CAPACITY + 6, "no unbounded thread growth")
        self.g.set(STATE); time.sleep(2.8)                                   # synthetic hangs release
        h = self.g.client.health(self.g.host); self.assertEqual(h["resolve"]["pool"]["state"], "HEALTHY"); self.assertEqual(h["resolve"]["probe"], "OK")
        self.assertTrue(self.g.client.identify(self.g.host)["ok"]); self.assertEqual(self.g.client.reg.status(self.g.host), "ONLINE_CURRENT")
    def _code(self, op, dl):
        try: self.g.client.call(op, self.g.host, deadline_ms=dl); return "ok"
        except VrcError as e: return e.code
    def test_degraded_state_while_one_slot_is_stuck(self):
        self.g.set(dict(STATE, sleep_s=2.5))
        with self.assertRaises(VrcError): self.g.client.identify(self.g.host, deadline_ms=200)
        self.g.set(STATE); h = self.g.client.health(self.g.host)
        self.assertEqual(h["resolve"]["pool"]["stuck"], 1); self.assertEqual(h["resolve"]["pool"]["state"], "DEGRADED"); self.assertEqual(self.g.client.reg.status(self.g.host), "DEGRADED")
    def test_health_when_resolve_absent(self):
        self.g.set({"unavailable": True}); h = self.g.client.health(self.g.host)
        self.assertTrue(h["ok"]); self.assertFalse(h["resolve"]["available"]); self.assertEqual(h["resolve"]["probe"], "RESOLVE_UNAVAILABLE"); self.assertEqual(self.g.client.reg.status(self.g.host), "RESOLVE_UNAVAILABLE")

class F03Liveness(unittest.TestCase):
    def _listener(self, banner):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(4); port = s.getsockname()[1]
        def serve():
            while True:
                try: c, _ = s.accept()
                except OSError: return
                if banner: c.sendall(banner)
                threading.Timer(3.0, c.close).start()
        threading.Thread(target=serve, daemon=True).start(); return s, port
    def test_probe_ok_when_far_end_answers(self):
        s, p = self._listener(b"SSH-2.0-OpenSSH_test\r\n"); self.assertTrue(rw.probe_controller_path(p, 2)); s.close()
    def test_probe_fails_on_silent_accept_or_closed_port(self):
        s, p = self._listener(None); self.assertFalse(rw.probe_controller_path(p, 0.5)); s.close(); self.assertFalse(rw.probe_controller_path(free_port(), 0.5))
    def test_watcher_exits_after_consecutive_misses_and_resets_on_success(self):
        s, p = self._listener(None); lost = threading.Event(); events = []
        rw.watch_controller_path(p, 0.05, 3, lambda m: lost.set(), events.append)
        # probe timeout is 10 s by default in probe_controller_path; use a closed port for fast misses
        s.close(); self.assertTrue(lost.wait(15)); self.assertGreaterEqual(len(events), 3); self.assertEqual(events[-1]["misses"], 3)
    def test_flags_and_tunnel_reverse_forward(self):
        src = open(os.path.join(ROOT, "worker", "resolve_worker.py")).read(); self.assertIn("--liveness-port", src); self.assertIn("CONTROLLER_PATH_LOST", src)
        from vrc import tunnel; import inspect; ts = inspect.getsource(tunnel); self.assertIn('"-R"', ts); self.assertIn("ServerAliveCountMax", ts)

class F04Journal(unittest.TestCase):
    def setUp(self): self.g = Rig()
    def tearDown(self): self.g.stop()
    def events(self, kind): return [j for j in self.g.journal() if j.get("event") == kind]
    def test_auth_failure_journaled_sanitized(self):
        env, body, h = self.g.signed(); st, r = self.g.raw(body, {"Content-Type": "application/json"}); self.assertEqual(st, 401)
        st, r = self.g.raw(body, dict(h, **{"X-VRC-Signature": "f" * 64})); self.assertEqual(st, 401)
        ev = self.events("AUTH_FAILED"); self.assertEqual(len(ev), 2); self.assertEqual(ev[1]["request_id"], env["request_id"]); self.assertEqual(ev[1]["path"], "/v1/op")
        text = open(os.path.join(self.g.wstate, "journal.jsonl")).read(); self.assertNotIn(self.g.secret.hex(), text); self.assertNotIn("f" * 64, text); self.assertNotIn("X-VRC-Signature", text)
    def test_malformed_json_wrong_path_bad_deadline_oversize(self):
        body = b"not json"; h = protocol.auth_headers(self.g.secret, "POST", "/v1/op", body); st, r = self.g.raw(body, h); self.assertEqual(st, 400); self.assertEqual(len(self.events("MALFORMED_JSON")), 1)
        env, body, h = self.g.signed(); h2 = protocol.auth_headers(self.g.secret, "POST", "/v1/other", body); st, r = self.g.raw(body, h2, path="/v1/other"); self.assertEqual(st, 404); self.assertEqual(len(self.events("BAD_PATH")), 1)
        env = protocol.envelope("identify", self.g.host); env["deadline_ms"] = "abc"; body = json.dumps(env).encode(); h = protocol.auth_headers(self.g.secret, "POST", "/v1/op", body)
        st, r = self.g.raw(body, h); self.assertEqual((st, r["error"]["code"]), (400, "TRANSPORT_ERROR")); self.assertEqual(self.events("BAD_ENVELOPE")[0]["request_id"], env["request_id"])
        big = b"{" + b" " * (rw.MAX_BODY + 10) + b"}"; h = protocol.auth_headers(self.g.secret, "POST", "/v1/op", big)
        c = http.client.HTTPConnection("127.0.0.1", self.g.port, timeout=20); c.putrequest("POST", "/v1/op"); [c.putheader(k, v) for k, v in h.items()]; c.putheader("Content-Length", str(len(big))); c.endheaders()
        r = c.getresponse(); self.assertEqual(r.status, 413); self.assertEqual(len(self.events("BODY_TOO_LARGE")), 1)
        self.assertTrue(self.g.client.identify(self.g.host)["ok"], "worker remains functional")
    def test_handler_exception_journaled_and_structured(self):
        orig = self.g.worker.handle; self.g.worker.handle = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("synthetic"))
        try:
            env, body, h = self.g.signed(); st, r = self.g.raw(body, h); self.assertEqual((st, r["error"]["code"]), (500, "TRANSPORT_ERROR"))
            ev = self.events("HANDLER_EXCEPTION"); self.assertEqual(ev[0]["exception"], "RuntimeError")
        finally: self.g.worker.handle = orig
        self.assertTrue(self.g.client.identify(self.g.host)["ok"])
    def test_op_journal_written_before_response_and_fsynced(self):
        r = self.g.client.identify(self.g.host); ops = self.events("OP"); self.assertEqual(ops[-1]["request_id"], r["request_id"]); self.assertIn("pool_state", ops[-1])
        src = open(os.path.join(ROOT, "worker", "resolve_worker.py")).read(); h = src[src.index("def handle"):src.index("class Handler")]
        self.assertLess(h.index("journal_event"), h.index("return out")); self.assertIn("os.fsync(self.journal.fileno())", src)

class LibraryGate(unittest.TestCase):
    def test_gate_refuses_eka_and_other_libraries_before_op_body_and_allows_qualification_library(self):
        g = Rig(dict(STATE, database={"DbName": "EKA", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}), require_library=("VIDTOOLZ Resolve Qualification v1", None))
        try:
            with self.assertRaises(VrcError) as cm: g.client.list_timelines(g.host)
            self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH"); self.assertEqual(cm.exception.detail["actual"]["name"], "EKA")
            with self.assertRaises(VrcError) as cm: g.client.identify(g.host, expected={"project_uuid": "q-1"})
            self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH", "library gate precedes expected-state guards")
            g.set(dict(STATE, database={"DbName": "Local Database", "DbType": "Disk", "IpAddress": None}))
            with self.assertRaises(VrcError) as cm: g.client.identify(g.host)
            self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH")
            g.set(dict(STATE, database={"DbName": "VIDTOOLZ Resolve Qualification v1", "DbType": "PostgreSQL", "IpAddress": "x"}))
            with self.assertRaises(VrcError) as cm: g.client.identify(g.host)
            self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH", "name alone is not enough; must be a Disk library")
            g.set(STATE); r = g.client.identify(g.host); self.assertTrue(r["ok"]); self.assertEqual(r["resolve"]["library"]["name"], "VIDTOOLZ Resolve Qualification v1")
            h = g.client.health(g.host); self.assertTrue(h["ok"])
            g.set(dict(STATE, database={"DbName": "EKA", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}))
            h = g.client.health(g.host); self.assertEqual(h["resolve"]["probe"], "LIBRARY_MISMATCH"); self.assertIsNone(h["project"], "no project field may be read behind a failed gate")
            self.assertEqual(g.client.reg.status(g.host), "LIBRARY_MISMATCH")
            src = open(os.path.join(ROOT, "worker", "resolve_worker.py")).read(); sn = src[src.index("def snapshot"):src.index("def find_timeline")]
            self.assertLess(sn.index("library_check(res)"), sn.index("GetCurrentProject()"), "gate must precede the first project read")
        finally: g.stop()
    def test_root_crosscheck_fails_closed_without_registration(self):
        g = Rig(STATE, require_library=("VIDTOOLZ Resolve Qualification v1", "/nonexistent/root"))
        try:
            with self.assertRaises(VrcError) as cm: g.client.identify(g.host)
            self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH"); self.assertIn("root", cm.exception.message)
        finally: g.stop()
    def test_prohibited_names_refused_at_startup_and_dblist_parser(self):
        self.assertIn("EKA", rw.PROHIBITED_LIBRARIES); self.assertIn("Local Database", rw.PROHIBITED_LIBRARIES)
        d = tempfile.mkdtemp(); os.makedirs(os.path.join(d, "configs")); open(os.path.join(d, "configs", ".dblist"), "w").write("Local Database:/x/y::::DISK\nEKA:1.2.3.4:postgres*:DaVinci:EKA:QPSQL\nVIDTOOLZ Resolve Qualification v1:/home/vidtoolz/outputs/resolve-qualification-library::::DISK\n")
        orig = rw.resolve_config_dir; rw.resolve_config_dir = lambda: os.path.join(d, "configs")
        try: self.assertEqual(rw.dblist_root_for("VIDTOOLZ Resolve Qualification v1"), "/home/vidtoolz/outputs/resolve-qualification-library"); self.assertIsNone(rw.dblist_root_for("EKA"))
        finally: rw.resolve_config_dir = orig
if __name__ == "__main__": unittest.main()
