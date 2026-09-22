"""Offline tests for the production-read worker CANDIDATE 0.2.1 (repair of PRR-F01..F06, P301). fake Resolve only; no host, no
network, no production library. Frozen Phase 1 vrc client used unchanged; accepted facade (8e068fea) imported unchanged.
Run via ./run-tests.sh (pipefail-safe) or: python3 -B tests/test_production_read.py"""
import http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, unittest, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FROZEN = os.environ.get("VRC_PHASE1_ROOT", os.path.expanduser("~/resolve-authority-freeze-v1.20/resolve-control"))
FACADE = os.environ.get("VRC_FACADE_PLUGIN", os.path.expanduser("~/resolve-hermes/plugins/vidtoolz-resolve-readonly"))
sys.path[:0] = [FROZEN, os.path.join(ROOT, "worker"), os.path.join(ROOT, "tools"), HERE]
import resolve_worker as rw
import fake_resolve                       # test-only identity oracle, handed to Worker() directly (PRR-F06 seam)
import compile_production_read_policy as comp
from vrc.client import Client
from vrc.errors import VrcError, CODES
from vrc.registry import Registry
from vrc import protocol
WORKER_PATH = os.path.join(ROOT, "worker", "resolve_worker.py"); SRC = open(WORKER_PATH).read(); WSHA = rw.sha(open(WORKER_PATH, "rb").read())
FROZEN_SRC = open(os.path.join(FROZEN, "worker", "resolve_worker.py")).read()
HOST = socket.gethostname(); assert HOST.lower() in ("presto", "vidlap2", "vidnux"), HOST
FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"; LAW = "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"
P_A1, P_A2, P_B1 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
TLS = [{"name": "TL_A", "uuid": str(uuid.uuid4())}, {"name": "TL_B", "uuid": str(uuid.uuid4())}]
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def make_library(root, projects):
    """Create a physical Disk library: <root>/Resolve Projects/Users/guest/Projects/<name>/Project.db containing the given UUIDs."""
    for name, puuid, tls in projects:
        d = os.path.join(root, "Resolve Projects", "Users", "guest", "Projects", name); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "Project.db"), "wb").write(b"SQLite format 3\0" + puuid.encode() + b"\0" + b"\0".join(t["uuid"].encode() for t in tls) + b"\0pad")
def state(libname, puuid, name="Prod Project", tls=None, project_list=None):
    st = {"database": {"DbName": libname, "DbType": "Disk"}, "project": {"name": name, "uuid": puuid}, "timelines": tls if tls is not None else TLS, "current": 0}
    if project_list is not None: st["project_list"] = project_list
    return st
def record(hosts, status="ACCEPTED", approved_by="Mikko", approved_at="2026-09-22", acceptance="test-fixture/ACCEPTANCE.json", worker_sha=WSHA, facade=FACADE_COMMIT, **extra):
    r = {"schema": "vidtoolz.resolveProductionReadAuthority.v1", "authority_id": "test-authority", "status": status, "approved_by": approved_by, "approved_at": approved_at, "acceptance_record": acceptance,
         "worker_identity": {"component": "test", "worker_sha256": worker_sha}, "facade_identity": {"commit": facade}, "hosts": hosts, "operations": list(comp.OPS),
         "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local", "project_open_law": LAW}
    r.update(extra); return r
def lib(name, reg_root, canon_root, projects, **extra):
    return dict({"kind": "Disk", "name": name, "registration_root": reg_root, "canonical_root": canon_root, "projects": [{"project_uuid": u} for u in projects]}, **extra)
def hosts(*libs, host=None): return [{"host_id": (host or HOST).lower(), "libraries": list(libs)}]

class Env:
    """Real candidate worker + fake Resolve + REAL temp-dir Disk libraries + fake registration file + compiled pinned policy + frozen client."""
    def __init__(self, st, src, dblist_lines, plat=None, mode="PRODUCTION_READ", require_library=None, tamper_policy=None, expected_sha=None, worker_sha=WSHA, preview=False):
        self.d = tempfile.mkdtemp(prefix="pr-"); self.state_path = os.path.join(self.d, "state.json"); self.set_state(st)
        os.environ["VRC_FAKE_STATE"] = self.state_path
        self.cfg = os.path.join(self.d, "resolve-configs"); os.makedirs(self.cfg)
        self.regfile = "dblist.conf" if plat == "Windows" else ".dblist"
        open(os.path.join(self.cfg, self.regfile), "w").write("\n".join(dblist_lines) + "\n")
        open(os.path.join(self.cfg, "config.dat"), "wb").write(b"xx System.Scripting.Mode = 1 yy")
        self._orig = (rw.resolve_config_dir, rw.platform.system); rw.resolve_config_dir = lambda: self.cfg
        if plat: rw.platform.system = lambda: plat
        self.src_path = os.path.join(self.d, "authority.json"); open(self.src_path, "wb").write(json.dumps(src, indent=1).encode())
        self.pol_path = os.path.join(self.d, "policy.json")
        cmd = [sys.executable, "-B", os.path.join(ROOT, "tools", "compile_production_read_policy.py"), self.src_path, self.pol_path, "--worker", WORKER_PATH] + (["--preview"] if preview else [])
        r = subprocess.run(cmd, capture_output=True, text=True); self.compile_out = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {"ok": False, "raw": (r.stdout + r.stderr)[-400:]}
        if not self.compile_out.get("ok"): self.restore(); raise comp.PolicyError(self.compile_out.get("message") or self.compile_out.get("raw"))
        if tamper_policy: tamper_policy(self.pol_path)
        self.pol_sha = expected_sha or rw.sha(open(self.pol_path, "rb").read())
        self.secret = os.urandom(32).hex().encode(); self.sf = os.path.join(self.d, "secret"); open(self.sf, "wb").write(self.secret); os.chmod(self.sf, 0o600)
        self.port = free_port(); self.wstate = os.path.join(self.d, "wstate")
        try:
            self.worker = rw.Worker(HOST, self.secret, self.wstate, fake_resolve, require_library, mode, self.pol_path if mode == "PRODUCTION_READ" else None, self.pol_sha if mode == "PRODUCTION_READ" else None, self.src_path if mode == "PRODUCTION_READ" else None)
        except BaseException: self.restore(); raise
        self.srv = rw.ThreadingHTTPServer(("127.0.0.1", self.port), rw.Handler); self.srv.worker = self.worker
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        reg = {"targets": {HOST: {"transport": "local", "port": self.port, "secret_file": self.sf}, "otherhost": {"transport": "local", "port": free_port(), "secret_file": self.sf}}}
        self.reg_path = os.path.join(self.d, "registry.json"); json.dump(reg, open(self.reg_path, "w"))
        self.jp = os.path.join(self.d, "journal.jsonl"); self.client = Client(Registry(self.reg_path), "test", self.jp)
    def set_state(self, st): json.dump(st, open(self.state_path, "w"))
    def set_registration(self, lines): open(os.path.join(self.cfg, self.regfile), "w").write("\n".join(lines) + "\n")
    def call(self, op, **kw): return self.client.call(op, HOST, **kw)
    def err(self, op, **kw):
        try: self.client.call(op, HOST, **kw)
        except VrcError as e: return e
        raise AssertionError(f"{op} unexpectedly succeeded")
    def raw(self, env):
        body = json.dumps(env).encode(); c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10); c.request("POST", "/v1/op", body, protocol.auth_headers(self.secret, "POST", "/v1/op", body)); return json.loads(c.getresponse().read())
    def journal(self): return [json.loads(l) for l in open(os.path.join(self.wstate, "journal.jsonl")) if l.strip()]
    def last_op(self): return [j for j in self.journal() if j.get("event") == "OP"][-1]
    def restore(self): rw.resolve_config_dir, rw.platform.system = self._orig
    def close(self):
        if hasattr(self, "srv"): self.srv.shutdown(); self.srv.server_close()
        self.restore()

class Fixture:
    """Two REAL physical Disk libraries A (authorized) and B (unauthorized clone or other), registration lines, an accepted record."""
    def __init__(self, clone=False):
        self.base = tempfile.mkdtemp(prefix="lib-"); self.A = os.path.join(self.base, "libA"); self.B = os.path.join(self.base, "libB"); os.makedirs(self.A); os.makedirs(self.B)
        make_library(self.A, [("Prod Project", P_A1, TLS), ("Second", P_A2, TLS)])
        if clone: shutil.copytree(os.path.join(self.A, "Resolve Projects"), os.path.join(self.B, "Resolve Projects"))
        else: make_library(self.B, [("Prod Project", P_B1, TLS)])
        self.A_real, self.B_real = os.path.realpath(self.A), os.path.realpath(self.B)
        self.name = "Prod Disk A"
    def lines(self, root=None): return [f"{self.name}:{root or self.A}::::DISK", "EKA192.168.50.199:192.168.50.199:postgres:DaVinci:EKA:QPSQL"]
    def src(self, canon=None, projects=(P_A1, P_A2), **kw): return record(hosts(lib(self.name, self.A, canon or self.A_real, list(projects))), **kw)
    def st(self, puuid=P_A1, **kw): return state(self.name, puuid, project_list=["Prod Project", "Second"], **kw)

class Authority(unittest.TestCase):
    """PRR-F01 / F02: only an ACCEPTED, human-approved, fully bound record compiles to a LIVE policy."""
    def setUp(self): self.fx = Fixture()
    def c(self, src, preview=False): return comp.compile_record(json.dumps(src).encode(), WSHA, preview=preview)
    def test_accepted_correct_compiles_live(self):
        pol = self.c(self.fx.src()); self.assertTrue(pol["live"]); self.assertEqual(pol["authority_status"], "ACCEPTED"); self.assertEqual(pol["worker_sha256"], WSHA); self.assertEqual(pol["facade_commit"], FACADE_COMMIT)
        self.assertEqual(pol["hosts"][HOST.lower()]["libraries"][0]["projects"], sorted([P_A1, P_A2]))
        self.assertEqual(self.c(self.fx.src()), self.c(self.fx.src()))
    def test_every_non_accepted_or_unbound_variant_refuses_live(self):
        variants = {"candidate_populated": dict(status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None), "candidate_with_approver": dict(status="CANDIDATE_FOR_INDEPENDENT_REVIEW"),
                    "accepted_null_approver": dict(approved_by=None), "rejected": dict(status="REJECTED"), "superseded": dict(status="SUPERSEDED"), "accepted_no_date": dict(approved_at=None),
                    "accepted_no_acceptance_record": dict(acceptance=None), "wrong_worker_pin": dict(worker_sha="0" * 64), "wrong_facade_pin": dict(facade="a" * 40)}
        for name, kw in variants.items():
            with self.assertRaises(comp.PolicyError, msg=name): self.c(self.fx.src(**kw))
            pv = self.c(self.fx.src(**kw), preview=True); self.assertFalse(pv["live"], name); self.assertEqual(pv["hosts"], {}, name)   # preview never carries grants
        with self.assertRaises(comp.PolicyError): self.c(record([]))                                           # accepted + empty hosts
        with self.assertRaises(comp.PolicyError): self.c(record(hosts(lib(self.fx.name, self.fx.A, self.fx.A_real, []))))   # empty projects
        with self.assertRaises(comp.PolicyError): self.c(self.fx.src(), preview=True)                          # accepted must not be downgraded to preview silently
    def test_schema_is_enforced(self):
        good = self.fx.src()
        bad = []
        for k in ("status", "hosts", "operations", "schema", "worker_identity"): b = dict(good); del b[k]; bad.append(("missing " + k, b))
        b = dict(good); b["unknown_field"] = 1; bad.append(("unknown top field", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["extra"] = 1; bad.append(("unknown lib field", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["projects"][0]["project_uuid"] = P_A1.upper(); bad.append(("uppercase uuid", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["projects"] = ["*"]; bad.append(("wildcard project", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["name"] = "*"; bad.append(("wildcard name", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["kind"] = "PostgreSQL"; bad.append(("network kind", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["canonical_root"] = "//nas/share/lib"; bad.append(("UNC root", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["canonical_root"] = "relative/dir"; bad.append(("relative root", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["libraries"][0]["canonical_root"] = self.fx.A_real + "/"; bad.append(("trailing sep", b))
        b = json.loads(json.dumps(good)); b["hosts"][0]["host_id"] = "rojekti"; bad.append(("unknown host", b))
        b = json.loads(json.dumps(good)); b["operations"] = list(comp.OPS) + ["SaveProject"]; bad.append(("extra op", b))
        b = json.loads(json.dumps(good)); b["status"] = "PENDING"; bad.append(("unknown status", b))
        b = json.loads(json.dumps(good)); b["approved_by"] = 42; bad.append(("numeric approver", b))
        b = json.loads(json.dumps(good)); b["approved_by"] = "someone"; bad.append(("non-allowlisted approver", b))
        b = json.loads(json.dumps(good)); b["write_authority"] = "READ"; bad.append(("write authority", b))
        b = json.loads(json.dumps(good)); b["persistent_worker_authority"] = "SYSTEMD"; bad.append(("persistence", b))
        b = json.loads(json.dumps(good)); b["external_scripting"] = "Network"; bad.append(("network scripting", b))
        for name, b in bad:
            with self.assertRaises(comp.PolicyError, msg=name): self.c(b)
        self.c(good)
    def test_windows_canonical_root_accepted_by_schema(self):
        self.c(record(hosts(lib("Local Database", r"C\Users\presto\AppData\Roaming\Blackmagic Design\DaVinci Resolve\Support\Resolve Project Library", r"c:\users\presto\appdata\roaming\blackmagic design\davinci resolve\support\resolve project library", [P_A1]), host="presto")))

class Runtime(unittest.TestCase):
    def setUp(self): self.fx = Fixture()
    def tearDown(self):
        if hasattr(self, "e"): self.e.close()
    # --- positive + journal (PR-01, F04)
    def test_authorized_reads_succeed_and_journal_allowed_with_identity(self):
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines())
        for op in rw.READ_ONLY_OPS:
            kw = {"params": {"timeline_uuid": TLS[1]["uuid"]}} if op == "get_timeline_settings" else {}
            r = self.e.call(op, **kw); self.assertTrue(r["ok"], (op, r.get("error")))
            self.assertEqual((r["protocol"], r["mode"], r["write_authority"], r["write_lease"], r["read_profile"]), ("vrc.v1", "READ_ONLY", "NONE", None, "PRODUCTION_READ"))
            self.assertEqual(r["worker"]["worker_sha256"], WSHA)
            if op != "health": a = r["resolve"]["authorization"]; self.assertEqual(a["decision"], "ALLOWED"); self.assertEqual(a["project_uuid"], P_A1); self.assertEqual(a["library"]["realpath"], self.fx.A_real); self.assertTrue(a["content_anchor"]["project_db_sha256"])
            j = self.e.last_op()["authorization"]; self.assertEqual((j["decision"], j["stage"], j["project_uuid"], j["library"]["realpath"], j["policy_sha256"], j["target"], j["op"]), ("ALLOWED", "content", P_A1, self.fx.A_real, self.e.pol_sha, HOST, op))
            self.assertIn("dev", j["library"]); self.assertIn("ino", j["library"]); self.assertTrue(self.e.last_op()["transport_ok"])
    # --- runtime authority semantics (F01/F02 at runtime)
    def test_runtime_refuses_preview_policy_and_authority_edits(self):
        with self.assertRaises(SystemExit): Env(self.fx.st(), self.fx.src(status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None), self.fx.lines(), preview=True)
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); self.assertTrue(self.e.call("identify")["ok"])
        src = json.load(open(self.e.src_path)); src["status"] = "REJECTED"; open(self.e.src_path, "w").write(json.dumps(src))   # authority bytes changed after start
        e = self.e.err("identify"); self.assertEqual(e.code, "LIBRARY_MISMATCH"); self.assertEqual(e.detail["reason"], "AUTHORITY_SOURCE_MISMATCH")
        j = self.e.last_op()["authorization"]; self.assertEqual((j["decision"], j["stage"], j["reason"]), ("DENIED", "policy", "AUTHORITY_SOURCE_MISMATCH"))
        os.remove(self.e.src_path); self.assertEqual(self.e.err("identify").detail["reason"], "AUTHORITY_MISSING")
    def test_runtime_refuses_policy_for_other_worker_facade_or_host_even_when_repinned(self):
        # a correctly re-pinned policy (attacker controls the file AND the CLI digest) still fails: worker/facade/source bindings are checked against reality
        for field, val, reason in (("worker_sha256", "0" * 64, "WORKER_IDENTITY_MISMATCH"), ("facade_commit", "a" * 40, "FACADE_IDENTITY_MISMATCH"), ("source_record_sha256", "b" * 64, "AUTHORITY_SOURCE_MISMATCH"), ("live", False, "AUTHORITY_NOT_ACCEPTED")):
            def tamper(p, field=field, val=val):
                pol = json.loads(open(p).read()); pol[field] = val; body = {k: v for k, v in pol.items() if k != "policy_sha256"}; pol["policy_sha256"] = rw.canonical_sha256(body); open(p, "wb").write(comp.canon(pol))
            with self.assertRaises(SystemExit, msg=field): Env(self.fx.st(), self.fx.src(), self.fx.lines(), tamper_policy=tamper)
        def widen(p):   # grant not present in the accepted source
            pol = json.loads(open(p).read()); pol["hosts"][HOST.lower()]["libraries"][0]["projects"].append(P_B1); body = {k: v for k, v in pol.items() if k != "policy_sha256"}; pol["policy_sha256"] = rw.canonical_sha256(body); open(p, "wb").write(comp.canon(pol))
        with self.assertRaises(SystemExit): Env(self.fx.st(), self.fx.src(), self.fx.lines(), tamper_policy=widen)
        other = "presto" if HOST.lower() != "presto" else "vidlap2"
        with self.assertRaises(SystemExit): Env(self.fx.st(), record(hosts(lib(self.fx.name, self.fx.A, self.fx.A_real, [P_A1]), host=other)), self.fx.lines())
    def test_policy_tamper_after_start_fails_next_op_and_is_journaled(self):
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); self.assertTrue(self.e.call("identify")["ok"])
        open(self.e.pol_path, "ab").write(b" "); e = self.e.err("identify"); self.assertEqual(e.detail["reason"], "PRODUCTION_POLICY_PIN_MISMATCH")
        j = self.e.last_op()["authorization"]; self.assertEqual((j["decision"], j["stage"], j["reason"]), ("DENIED", "policy", "PRODUCTION_POLICY_PIN_MISMATCH")); self.assertNotIn("projects", json.dumps(j))
        os.remove(self.e.pol_path); self.assertEqual(self.e.err("identify").detail["reason"], "PRODUCTION_POLICY_MISSING")
    # --- F03 library identity
    def test_wrong_library_denied_and_health_journals_denied_separately(self):
        self.e = Env({**self.fx.st(), "database": {"DbName": "Unlisted Disk", "DbType": "Disk"}}, self.fx.src(), self.fx.lines() + [f"Unlisted Disk:{self.fx.B}::::DISK"])
        e = self.e.err("get_current_project"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "LIBRARY_NOT_AUTHORIZED"))
        h = self.e.call("health"); self.assertTrue(h["ok"]); self.assertEqual(h["resolve"]["probe"], "LIBRARY_MISMATCH"); self.assertIsNone(h["project"])
        j = self.e.last_op(); self.assertEqual(j["op"], "health"); self.assertTrue(j["transport_ok"]); self.assertEqual(j["probe"], "LIBRARY_MISMATCH")
        self.assertEqual((j["authorization"]["decision"], j["authorization"]["stage"], j["authorization"]["reason"]), ("DENIED", "library", "LIBRARY_NOT_AUTHORIZED")); self.assertEqual(j["authorization"]["library"]["name"], "Unlisted Disk")
    def test_network_library_refused_regardless_of_name(self):
        for db in ({"DbName": "EKA192.168.50.199", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}, {"DbName": "nelja192.168.50.199", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}, {"DbName": self.fx.name, "DbType": "PostgreSQL", "IpAddress": "10.0.0.1"}, {"DbName": self.fx.name, "DbType": "Disk", "IpAddress": "10.0.0.1"}):
            self.e = Env({**self.fx.st(), "database": db}, self.fx.src(), self.fx.lines()); e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "LIBRARY_NOT_AUTHORIZED"), db)
            self.assertEqual(self.e.last_op()["authorization"]["decision"], "DENIED"); self.e.close(); del self.e
    def test_duplicate_or_conflicting_registrations_refused(self):
        cases = {"duplicate_name_conflicting_root": self.fx.lines() + [f"{self.fx.name}:{self.fx.B}::::DISK"], "duplicate_identical": self.fx.lines() + [self.fx.lines()[0]],
                 "same_root_other_name": self.fx.lines() + [f"Other:{self.fx.A}::::DISK"], "same_root_alias_trailing_sep_other_name": self.fx.lines() + [f"Other:{self.fx.A}/::::DISK"]}
        for name, lines in cases.items():
            if name.endswith("trailing_sep_other_name"):
                self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); self.e.set_registration(lines); e = self.e.err("identify"); self.assertEqual(e.detail["reason"], "REGISTRATION_INVALID", name); self.e.close(); del self.e; continue
            self.e = Env(self.fx.st(), self.fx.src(), lines); e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "REGISTRATION_AMBIGUOUS"), name); self.e.close(); del self.e
    def test_malformed_registration_records_invalidate_file(self):
        bad = [f"{self.fx.name}:{self.fx.A}:DISK", f"{self.fx.name}:{self.fx.A}::::NOTDISK", f"{self.fx.name}:{self.fx.A}::::", f"{self.fx.name}:relative/dir::::DISK", f"{self.fx.name}://nas/share::::DISK", f'{self.fx.name}:"{self.fx.A}"::::DISK', f"{self.fx.name}:{self.fx.A}/../libA::::DISK", f"{self.fx.name}:{self.fx.A}/::::DISK", f":{self.fx.A}::::DISK", f"*:{self.fx.A}::::DISK", f" {self.fx.name}:{self.fx.A}::::DISK", f"{self.fx.name}:{self.fx.A}:::::DISK", "garbage"]
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines())
        for line in bad:
            self.e.set_registration([line]); e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "REGISTRATION_INVALID"), line)
        self.e.set_registration(self.fx.lines()); self.assertTrue(self.e.call("identify")["ok"])
        self.e.set_registration([]); self.assertEqual(self.e.err("identify").detail["reason"], "REGISTRATION_AMBIGUOUS")
    def test_windows_strict_parser_on_sealed_fixtures_and_attacks(self):
        P = rw.parse_registration_production
        presto = "Local Database:C\\Users\\presto\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Resolve Project Library:*:::DISK"
        vidlap2 = "Local Database:C\\Users\\mjp77\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Resolve Disk Database:*:::DISK"
        text = presto + "\r\nEKA192.168.50.199:192.168.50.199:postgres:DaVinci:EKA:QPSQL\r\nnelja192.168.50.199:192.168.50.199:postgres:DaVinci:nelja:QPSQL\r\n"
        ents = P(text, "Windows"); self.assertEqual([e["kind"] for e in ents], ["Disk", "NETWORK", "NETWORK"]); self.assertEqual(ents[0]["path"], "C:\\Users\\presto\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Resolve Project Library")
        self.assertEqual(P(vidlap2 + "\n", "Windows")[0]["path"][:9], "C:\\Users\\"); self.assertEqual(P("Qual Ünïcode lib:D\\Prod Libs\\Qual 2026:*:::DISK\n", "Windows")[0]["path"], "D:\\Prod Libs\\Qual 2026")
        for bad in ("Local Database:C:\\Users\\presto\\lib:*:::DISK", "Local Database:C\\Users\\presto\\lib::::DISK", "Local Database:C\\Users\\presto\\lib:*:::NOTDISK", "Local Database:C\\Users\\presto\\lib:DISK", "Local Database:\\\\nas\\share:*:::DISK",
                    "Local Database:Users\\presto\\lib:*:::DISK", "Local Database:C\\Users\\..\\lib:*:::DISK", "Local Database:C\\Users\\presto\\lib\\:*:::DISK", "Local Database:C/Users/presto/lib:*:::DISK", 'Local Database:"C\\Users\\presto\\lib":*:::DISK', "Local Database:C\\Users\\presto\\lib:*::DISK"):
            with self.assertRaises(rw.OpError, msg=bad): P(bad + "\n", "Windows")
        for bad in (f"{self.fx.name}:C\\Users\\x::::DISK", f"{self.fx.name}:/a/b:*:::DISK"):     # platform grammar not interchangeable
            with self.assertRaises(rw.OpError, msg=bad): P(bad, "Linux")
    def test_symlink_retarget_and_alias_roots(self):
        link = os.path.join(self.fx.base, "allowed-root"); os.symlink(self.fx.A, link, target_is_directory=True)
        src = record(hosts(lib(self.fx.name, link, self.fx.A_real, [P_A1, P_A2])))            # policy pins the PHYSICAL root (realpath of A), registration uses the alias
        self.e = Env(self.fx.st(), src, [f"{self.fx.name}:{link}::::DISK"]); self.assertTrue(self.e.call("identify")["ok"])
        os.unlink(link); os.symlink(self.fx.B, link, target_is_directory=True)                # attacker retargets the alias to B without touching policy or registration bytes
        e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "LIBRARY_NOT_AUTHORIZED")); self.assertEqual(e.detail["actual"]["realpath"], self.fx.B_real)
        os.unlink(link); os.symlink(self.fx.A, link, target_is_directory=True); self.assertTrue(self.e.call("identify")["ok"])
        os.unlink(link); e = self.e.err("identify"); self.assertEqual(e.detail["reason"], "LIBRARY_IDENTITY_UNAVAILABLE")              # dangling
    def test_registration_redirection_with_stale_handle_to_other_library_fails(self):
        # reviewer attack: Resolve keeps unauthorized library B open (same name, project 'Prod Project' with a DIFFERENT uuid P_B1); registration is rewritten to point at authorized A
        self.e = Env(self.fx.st(P_B1), self.fx.src(), [f"{self.fx.name}:{self.fx.B}::::DISK"])
        self.assertEqual(self.e.err("identify").detail["reason"], "LIBRARY_NOT_AUTHORIZED")
        self.e.set_registration(self.fx.lines())                                              # text now claims the authorized root
        e = self.e.err("identify"); self.assertEqual(e.code, "PROJECT_IDENTITY_MISMATCH"); self.assertEqual(e.detail["reason"], "PROJECT_NOT_AUTHORIZED")   # UUID gate
        # same attack where the open project's UUID IS an authorized one but the handle's content differs from A (diverged clone: extra timeline)
        self.e.set_state(state(self.fx.name, P_A1, tls=TLS + [{"name": "TL_C", "uuid": str(uuid.uuid4())}], project_list=["Prod Project", "Second"]))
        e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "CONTENT_ANCHOR_MISMATCH")); self.assertEqual(self.e.last_op()["authorization"]["stage"], "content")
        # diverged clone: extra project in the open library not present under A
        self.e.set_state(state(self.fx.name, P_A1, project_list=["Prod Project", "Second", "Third"])); self.assertEqual(self.e.err("identify").detail["reason"], "CONTENT_ANCHOR_MISMATCH")
        # handle's project not present under A at all
        self.e.set_state(state(self.fx.name, P_A1, name="Ghost", project_list=["Ghost"])); self.assertEqual(self.e.err("identify").detail["reason"], "CONTENT_ANCHOR_MISMATCH")
    def test_cloned_library_same_uuid_registered_separately_is_not_authorized(self):
        fx = Fixture(clone=True)                                                               # B is a byte-identical clone of A
        self.e = Env({**fx.st(), "database": {"DbName": "Prod Disk B", "DbType": "Disk"}}, fx.src(), fx.lines() + [f"Prod Disk B:{fx.B}::::DISK"])
        e = self.e.err("identify"); self.assertEqual((e.code, e.detail["reason"]), ("LIBRARY_MISMATCH", "LIBRARY_NOT_AUTHORIZED"))   # same UUID X under root B: root B not authorized
        self.e.set_state(fx.st()); self.assertTrue(self.e.call("identify")["ok"])
    def test_project_and_library_switch_between_operations(self):
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); self.assertTrue(self.e.call("get_current_project")["ok"])
        self.e.set_state(self.fx.st(P_B1)); self.assertEqual(self.e.err("get_current_project").code, "PROJECT_IDENTITY_MISMATCH"); self.assertEqual(self.e.err("list_timelines").code, "PROJECT_IDENTITY_MISMATCH")
        j = self.e.last_op()["authorization"]; self.assertEqual((j["decision"], j["stage"], j["reason"]), ("DENIED", "project", "PROJECT_NOT_AUTHORIZED")); self.assertEqual(j["project_observed"]["uuid"], P_B1)
        self.e.set_state(self.fx.st(P_A2, name="Second")); self.assertTrue(self.e.call("get_current_project")["ok"])     # second authorized project, its own Project.db
        self.e.set_state({**self.fx.st(), "database": {"DbName": "Local Database", "DbType": "Disk"}}); self.assertEqual(self.e.err("identify").detail["reason"], "REGISTRATION_AMBIGUOUS")
        self.e.set_state(self.fx.st()); self.assertTrue(self.e.call("identify")["ok"])
        self.e.set_state(self.fx.st(str(uuid.uuid4()), name="Prod Project")); self.assertEqual(self.e.err("identify").detail["reason"], "PROJECT_NOT_AUTHORIZED")   # same name, different uuid
    def test_no_project_open_is_project_not_open(self):
        self.e = Env({"database": {"DbName": self.fx.name, "DbType": "Disk"}, "project": None, "timelines": [], "current": 0, "project_list": []}, self.fx.src(), self.fx.lines())
        self.assertEqual(self.e.err("get_current_project").code, "PROJECT_NOT_OPEN")
        j = self.e.last_op()["authorization"]; self.assertEqual((j["decision"], j["stage"]), ("NOT_REACHED", "resolve"))    # authorization never evaluated != denied (PRR-F04)
        h = self.e.call("health"); self.assertTrue(h["ok"]); self.assertEqual(self.e.last_op()["authorization"]["decision"], "NOT_REACHED")
    # --- read-only enforcement and qualification regression
    def test_write_and_generic_ops_refused_before_attach_and_source_has_no_switch_calls(self):
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); ac = self.e.state_path + ".attach_count"; n0 = int(open(ac).read()) if os.path.exists(ac) else 0
        for op in ("AppendToTimeline", "SaveProject", "SetCurrentTimeline", "LoadProject", "SetCurrentDatabase", "run_script", "exec", "frobnicate"):
            out = self.e.raw({"protocol": "vrc.v1", "request_id": "w", "op": op, "target_host": HOST, "params": {}, "expected": {}, "deadline_ms": 5000}); self.assertFalse(out["ok"]); self.assertIn(out["error"]["code"], ("READ_ONLY_MODE", "UNSUPPORTED_OPERATION"))
        self.assertEqual(n0, int(open(ac).read()) if os.path.exists(ac) else 0)
        code = "\n".join(l.split("#", 1)[0] for l in SRC.splitlines())
        for m in ("LoadProject(", "OpenProject(", "SetCurrentProject(", "SetCurrentDatabase(", "SaveProject(", "SetCurrentTimeline(", "CreateProject(", "ImportMedia(", "AddMarker(", "SetSetting("): self.assertNotIn("." + m, code, m)
        for k in ("READ_ONLY_OPS", "FORBIDDEN_OPS"): self.assertEqual(re.search(k + r" = \((.*?)\)", SRC, re.S).group(1), re.search(k + r" = \((.*?)\)", FROZEN_SRC, re.S).group(1))
        for args in re.findall(r"\.scriptapp\(([^)]*)\)", code): self.assertEqual([a.strip().strip('\'\"') for a in args.split(",")], ["Resolve"])
        self.assertIn('BIND = "127.0.0.1"', SRC); self.assertIn("LOOPBACK_ONLY", SRC)
        for bad in ("systemd", "schtasks", "New-Service", "Register-ScheduledTask"): self.assertNotIn(bad, SRC)
        self.assertTrue(set(re.findall(r'OpError\("([A-Z_]+)"', SRC)) <= set(CODES), set(re.findall(r'OpError\("([A-Z_]+)"', SRC)) - set(CODES))
    def test_qualification_mode_frozen_parser_parity_including_reviewer_counterexample(self):
        q = "VIDTOOLZ Resolve Qualification v1"; root = "/home/vidtoolz/outputs/resolve-qualification-library"
        # frozen parser semantics: .dblist ONLY. Reviewer counterexample: registration present only in dblist.conf -> frozen returns None -> root-gated qualification refuses.
        self.e = Env({**state(q, P_A1), "database": {"DbName": q, "DbType": "Disk"}}, record([], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None), [f"{q}:{root}::::DISK"], mode="QUALIFICATION_READ", require_library=(q, root), preview=True)
        self.assertTrue(self.e.call("identify")["ok"]); self.assertEqual(self.e.call("identify")["read_profile"], "QUALIFICATION_READ"); self.assertEqual(self.e.last_op()["authorization"], {"read_profile": "QUALIFICATION_READ", "decision": "NOT_APPLICABLE"})
        os.rename(os.path.join(self.e.cfg, ".dblist"), os.path.join(self.e.cfg, "dblist.conf"))            # counterexample: dblist.conf-only registration
        self.assertIsNone(rw.dblist_root_for(q)); self.assertEqual(self.e.err("identify").code, "LIBRARY_MISMATCH")
        self.assertEqual(re.search(r"def dblist_root_for\(name\):.*?return None\n", SRC, re.S).group(0), re.search(r"def dblist_root_for\(name\):.*?return None\n", FROZEN_SRC, re.S).group(0))   # frozen parser bytes identical
        os.rename(os.path.join(self.e.cfg, "dblist.conf"), os.path.join(self.e.cfg, ".dblist"))
        for name in ("EKA", "Local Database", self.fx.name):
            self.e.set_state({**state(q, P_A1), "database": {"DbName": name, "DbType": "Disk"}}); self.assertEqual(self.e.err("identify").code, "LIBRARY_MISMATCH")
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), fake_resolve, (q, None), "PRODUCTION_READ", self.e.pol_path, self.e.pol_sha, self.e.src_path)
        with self.assertRaises(SystemExit): rw.Worker(HOST, b"x" * 40, tempfile.mkdtemp(), fake_resolve, None, "QUALIFICATION_READ", self.e.pol_path, self.e.pol_sha, self.e.src_path)
    # --- F06 production CLI has no fake seam; P301 duplicate flags
    def test_production_cli_refuses_fake_env_and_duplicate_flags(self):
        self.assertNotIn("VRC_FAKE", re.search(r"def load_production_api\(\):.*?return _load_real_api\(\)", SRC, re.S).group(0).replace('startswith("VRC_FAKE")', ""))   # only the refusal check mentions it
        main_src = SRC[SRC.index("def main():"):]; self.assertIn("load_production_api()", main_src); self.assertNotIn("load_api()", main_src); self.assertNotIn("VRC_FAKE", main_src)
        env = dict(os.environ, VRC_FAKE_RESOLVE=os.path.join(HERE, "fake_resolve.py"), VRC_FAKE_STATE=self.fx.base + "/x.json")
        sf = os.path.join(self.fx.base, "s"); open(sf, "wb").write(b"x" * 40)
        r = subprocess.run([sys.executable, "-B", WORKER_PATH, "--host-id", HOST, "--secret-file", sf, "--state-dir", self.fx.base + "/st", "--port", str(free_port())], capture_output=True, text=True, env=env, timeout=30)
        self.assertNotEqual(r.returncode, 0); self.assertIn("test substitution variables present", r.stderr + r.stdout)
        clean = {k: v for k, v in os.environ.items() if not k.upper().startswith("VRC_FAKE")}
        for flags in (["--mode", "QUALIFICATION_READ", "--mode", "PRODUCTION_READ"], ["--production-policy", "a", "--production-policy", "b"], ["--host-id", HOST, "--host-id", "presto"]):
            r = subprocess.run([sys.executable, "-B", WORKER_PATH, "--host-id", HOST, "--secret-file", sf, "--state-dir", self.fx.base + "/st"] + flags, capture_output=True, text=True, env=clean, timeout=30)
            self.assertNotEqual(r.returncode, 0); self.assertIn("given more than once", r.stderr + r.stdout, flags)
        r = subprocess.run([sys.executable, "-B", WORKER_PATH, "--host-id", HOST, "--secret-file", sf, "--state-dir", self.fx.base + "/st", "--mode", "PRODUCTION_READ"], capture_output=True, text=True, env=clean, timeout=30)
        self.assertNotEqual(r.returncode, 0); self.assertIn("requires --production-policy", r.stderr + r.stdout)
    # --- accepted facade compatibility (unchanged bytes)
    @unittest.skipUnless(os.path.isdir(FACADE), "accepted facade not present")
    def test_accepted_facade_unchanged_reads_and_maps_refusals(self):
        self.e = Env(self.fx.st(), self.fx.src(), self.fx.lines()); sys.path.insert(0, FACADE); from vrcfacade.facade import ResolveReadOnlyFacade
        f = ResolveReadOnlyFacade(registry_path=self.e.reg_path, phase1_root=FROZEN, journal_path=os.path.join(self.e.d, "fj.jsonl"))
        for tool in ("resolve_health", "resolve_identify", "resolve_get_current_project", "resolve_get_current_timeline", "resolve_list_timelines", "resolve_get_project_settings", "resolve_get_media_pool_summary", "resolve_get_project_fingerprint"):
            r = f.call(tool, HOST); self.assertTrue(r["ok"], (tool, r.get("error")))
        r = f.call("resolve_get_timeline_settings", HOST, timeline_uuid=TLS[1]["uuid"]); self.assertTrue(r["ok"]); self.assertEqual(r["result"]["timeline"]["uuid"], TLS[1]["uuid"])
        r = f.call("resolve_get_current_project", HOST, expected={"project_uuid": str(uuid.uuid4())}); self.assertEqual(r["error"]["code"], "PROJECT_IDENTITY_MISMATCH")
        self.e.set_state(self.fx.st(P_B1)); r = f.call("resolve_get_current_project", HOST); self.assertEqual((r["error"]["code"], r["error"]["details"]["reason"]), ("PROJECT_IDENTITY_MISMATCH", "PROJECT_NOT_AUTHORIZED"))
        self.e.set_state({**self.fx.st(), "database": {"DbName": "EKA192.168.50.199", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}}); r = f.call("resolve_identify", HOST); self.assertEqual((r["error"]["code"], r["error"]["details"]["reason"]), ("LIBRARY_MISMATCH", "LIBRARY_NOT_AUTHORIZED"))
if __name__ == "__main__": unittest.main(verbosity=1)
