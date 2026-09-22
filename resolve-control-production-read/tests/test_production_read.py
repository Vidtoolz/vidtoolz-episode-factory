"""Offline tests for the isolated-session production-read worker CANDIDATE 0.3.0 (successor to the REJECTED 59a5593d).

Everything here runs without Resolve, without a network, without the operator's configuration and without any production library:
real candidate worker bytes, the real compiler and generator invoked as subprocesses, real temp-directory Disk libraries, a fake
Resolve identity oracle and a deterministic process probe — both handed to Worker(...) by CONSTRUCTOR INJECTION only (there is no
environment switch and the production CLI can reach neither). The frozen Phase 1 vrc client and the accepted facade (8e068fea) are
imported unchanged.

Run via ./run-tests.sh (pipefail-safe) or: python3 -B tests/test_production_read.py
"""
import http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, unittest, uuid

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FROZEN = os.environ.get("VRC_PHASE1_ROOT", os.path.expanduser("~/resolve-authority-freeze-v1.20/resolve-control"))
FACADE = os.environ.get("VRC_FACADE_PLUGIN", os.path.expanduser("~/resolve-hermes/plugins/vidtoolz-resolve-readonly"))
sys.path[:0] = [FROZEN, os.path.join(ROOT, "worker"), os.path.join(ROOT, "tools"), HERE]
import resolve_worker as rw
import fake_resolve                                   # test-only identity oracle; never reachable from the production CLI
import compile_production_read_policy as comp
import generate_session_profile as gen
from vrc.client import Client
from vrc.errors import VrcError, CODES
from vrc.registry import Registry
from vrc import protocol

WORKER_PATH = os.path.join(ROOT, "worker", "resolve_worker.py"); SRC = open(WORKER_PATH).read()
WSHA = rw.sha(open(WORKER_PATH, "rb").read())
FROZEN_SRC = open(os.path.join(FROZEN, "worker", "resolve_worker.py")).read()
COMPILER = os.path.join(ROOT, "tools", "compile_production_read_policy.py")
GENERATOR = os.path.join(ROOT, "tools", "generate_session_profile.py")
BINDER = os.path.join(ROOT, "tools", "verify_deployment_binding.py")
FACADE_MANIFEST = os.path.join(ROOT, "data", "accepted-facade-8e068fea.manifest.json")
HOST = "vidnux"
assert socket.gethostname().lower() == HOST, f"production-read v1 is vidnux-only; this suite must run on vidnux (hostname: {socket.gethostname()})"
FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"
LAW = "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"
P_A1, P_A2, P_B1 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
TLS = [{"name": "TL_A", "uuid": str(uuid.uuid4())}, {"name": "TL_B", "uuid": str(uuid.uuid4())}]
HZ = os.sysconf("SC_CLK_TCK")
TMP = []


def tmpdir(prefix):
    d = tempfile.mkdtemp(prefix=prefix); TMP.append(d); return d


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def make_library(root, projects):
    """A physical Disk library: <root>/Resolve Projects/Users/guest/Projects/<name>/Project.db."""
    for name, puuid, tls in projects:
        d = os.path.join(root, "Resolve Projects", "Users", "guest", "Projects", name); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "Project.db"), "wb").write(b"SQLite format 3\0" + puuid.encode() + b"\0" + b"\0".join(t["uuid"].encode() for t in tls) + b"\0pad")


def state(libname, puuid, name="Prod Project", tls=None, project_list=None, libtype="Disk", host=None):
    db = {"DbName": libname, "DbType": libtype}
    if host: db["IpAddress"] = host
    st = {"database": db, "project": {"name": name, "uuid": puuid}, "timelines": tls if tls is not None else TLS, "current": 0}
    if project_list is not None: st["project_list"] = project_list
    return st


def record(library, projects, status="ACCEPTED", approved_by="Mikko", approved_at="2026-09-22",
           acceptance="test-fixture/ACCEPTANCE.json", worker_sha=WSHA, facade=FACADE_COMMIT,
           host_id=HOST, platform_="Linux", session_type="ISOLATED_DISK_SESSION", **extra):
    r = {"schema": "vidtoolz.resolveProductionReadAuthority.v1", "authority_id": "test-authority", "status": status,
         "approved_by": approved_by, "approved_at": approved_at, "acceptance_record": acceptance,
         "worker_identity": {"component": "test", "worker_sha256": worker_sha}, "facade_identity": {"commit": facade},
         "host_id": host_id, "platform": platform_, "session_profile_type": session_type,
         "library": library, "projects": [{"project_uuid": u} for u in projects], "operations": list(comp.OPS),
         "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local", "project_open_law": LAW}
    r.update(extra); return r


def libspec(name, root):
    st = os.stat(root)
    return {"kind": "Disk", "name": name, "canonical_root": os.path.realpath(root), "physical_dev": st.st_dev, "physical_ino": st.st_ino}


def source_config(scripting=1, extra_libraries=True):
    """An operator-shaped Resolve configuration directory: settings plus a MULTI-library registration and recent-project history that
    the generator must never copy."""
    d = tmpdir("srccfg-")
    open(os.path.join(d, "config.dat"), "w").write("Site.Count = 1\nSystem.Scripting.Mode = %d\nLocal.GPU.Scopes = 1\n" % scripting)
    open(os.path.join(d, "config.user.xml"), "w").write("<user/>\n")
    open(os.path.join(d, ".version"), "w").write("21.1.0\n")
    if extra_libraries:
        open(os.path.join(d, ".dblist"), "w").write(
            "Local Database:/home/op/.local/share/DaVinciResolve/Resolve Project Library::::DISK\n"
            "EKA192.168.50.199:192.168.50.199:postgres:DaVinci:EKA:QPSQL\n"
            "Other Disk:/srv/other::::DISK\n")
        open(os.path.join(d, ".activedb"), "w").write("network:EKA192.168.50.199\n")
        open(os.path.join(d, ".recentprojects"), "w").write("secret production project\n")
    return d


def fake_binary(size=4096):
    d = tmpdir("resolvebin-"); p = os.path.join(d, "resolve")
    open(p, "wb").write(b"\x7fELF" + b"\0" * (size - 4)); os.chmod(p, 0o755); return p


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout.strip()
    try: js = json.loads(out.split("\n#")[0])
    except ValueError: js = {"ok": False, "raw": (r.stdout + r.stderr)[-400:]}
    return r.returncode, js, r.stdout + r.stderr


class Profile:
    """An ACCEPTED grant compiled to a LIVE policy and sealed into an isolated one-library session profile, using the real tools."""
    def __init__(self, library, projects, src=None, resolve_binary=None, cfg=None, port=1144):
        self.d = tmpdir("chain-")
        self.src = src if src is not None else record(library, projects)
        self.src_path = os.path.join(self.d, "authority.json")
        open(self.src_path, "wb").write(json.dumps(self.src, indent=1).encode())
        self.pol_path = os.path.join(self.d, "policy.json")
        rc, js, raw = run([sys.executable, "-B", COMPILER, self.src_path, self.pol_path, "--worker", WORKER_PATH])
        if rc != 0: raise comp.PolicyError(js.get("message") or raw)
        self.pol_sha = rw.sha(open(self.pol_path, "rb").read())
        self.binary = resolve_binary or fake_binary()
        self.cfg = cfg or source_config()
        self.root = os.path.join(self.d, "profile")
        self.session_path = os.path.join(self.d, "session-profile.json")
        rc, js, raw = run([sys.executable, "-B", GENERATOR, "--authority", self.src_path, "--policy", self.pol_path,
                           "--worker", WORKER_PATH, "--source-config", self.cfg, "--profile-root", self.root,
                           "--out", self.session_path, "--resolve-binary", self.binary, "--script-server-port", str(port)])
        if rc != 0: raise gen.GenerateError(js.get("message") or raw)
        self.gen_out = js
        self.session_sha = rw.sha(open(self.session_path, "rb").read())
        self.manifest = json.load(open(self.session_path))
        self.gov, self.prov = self.manifest["governed"], self.manifest["provenance"]

    def reseal(self):
        """Recompute the manifest digest after a deliberate edit (tests that pin an edited profile)."""
        self.session_sha = rw.sha(open(self.session_path, "rb").read())


class FakeProbe(rw.SystemProbe):
    """Deterministic /proc facts. Only the process-fact methods are faked; file identity still comes from the real filesystem."""
    def __init__(self, profile, start_after=60, uid=4242, boot=1_700_000_000, resolve_pids=(9001,), listener_pid=9002,
                 environ=None, exe=None, listener_parent=None):
        self.profile, self._uid, self._boot = profile, uid, boot
        self.resolve_pids = list(resolve_pids); self.listener_pid = listener_pid
        self._exe = exe or profile.gov["resolve_binary"]["realpath"]
        self.start_epoch = profile.prov["seal_epoch"] + start_after
        self._environ = environ if environ is not None else {v: os.path.join(profile.prov["profile_root"], rel) for v, rel in profile.gov["profile_env"].items()}
        self._listener_parent = listener_parent if listener_parent is not None else (self.resolve_pids[0] if self.resolve_pids else 1)
        self.port_owners = {profile.gov["script_server_port"]: {listener_pid} if listener_pid else set()}
    def uid(self): return self._uid
    def boot_time(self): return self._boot
    def pids(self): return sorted(set(self.resolve_pids + ([self.listener_pid] if self.listener_pid else []) + [1]))
    def exe(self, pid): return self._exe if pid in self.resolve_pids else ("/usr/bin/other" if pid != 1 else "/sbin/init")
    def proc_uid(self, pid): return self._uid
    def ppid(self, pid): return self._listener_parent if pid == self.listener_pid else (0 if pid == 1 else 1)
    def start_ticks(self, pid): return int((self.start_epoch - self._boot) * HZ)
    def environ(self, pid): return dict(self._environ) if pid in self.resolve_pids else {}
    def listening_socket_pids(self, port): return set(self.port_owners.get(port, set()))


class Env:
    """Real candidate worker over the frozen client: accepted chain + sealed profile + injected fake Resolve and probe."""
    def __init__(self, st, profile, probe=None, mode="PRODUCTION_READ", require_library=None, session_sha=None, api=None):
        self.d = tmpdir("env-"); self.profile = profile
        self.state_path = os.path.join(self.d, "state.json"); self.set_state(st)
        os.environ["VRC_FAKE_STATE"] = self.state_path
        self.cfg = os.path.join(self.d, "resolve-configs"); os.makedirs(self.cfg)
        open(os.path.join(self.cfg, ".dblist"), "w").write("Qual:/tmp/qual::::DISK\n")
        open(os.path.join(self.cfg, "config.dat"), "wb").write(b"xx System.Scripting.Mode = 1 yy")
        self._orig = rw.resolve_config_dir; rw.resolve_config_dir = lambda: self.cfg
        self.probe = probe or FakeProbe(profile)
        self.secret = os.urandom(32).hex().encode(); self.sf = os.path.join(self.d, "secret")
        open(self.sf, "wb").write(self.secret); os.chmod(self.sf, 0o600)
        self.port = free_port(); self.wstate = os.path.join(self.d, "wstate")
        prod = mode == "PRODUCTION_READ"
        try:
            self.worker = rw.Worker(HOST, self.secret, self.wstate, api or fake_resolve, require_library, mode,
                                    profile.pol_path if prod else None, profile.pol_sha if prod else None,
                                    profile.src_path if prod else None, profile.session_path if prod else None,
                                    (session_sha or profile.session_sha) if prod else None, self.probe)
        except BaseException:
            self.restore(); raise
        self.srv = rw.ThreadingHTTPServer(("127.0.0.1", self.port), rw.Handler); self.srv.worker = self.worker
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        reg = {"targets": {HOST: {"transport": "local", "port": self.port, "secret_file": self.sf}}}
        self.reg_path = os.path.join(self.d, "registry.json"); json.dump(reg, open(self.reg_path, "w"))
        self.jp = os.path.join(self.d, "journal.jsonl"); self.client = Client(Registry(self.reg_path), "test", self.jp)

    def set_state(self, st): json.dump(st, open(self.state_path, "w"))
    def call(self, op, **kw): return self.client.call(op, HOST, **kw)
    def err(self, op, **kw):
        try: self.client.call(op, HOST, **kw)
        except VrcError as e: return e
        raise AssertionError(f"{op} unexpectedly succeeded")
    def raw(self, env):
        body = json.dumps(env).encode(); c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("POST", "/v1/op", body, protocol.auth_headers(self.secret, "POST", "/v1/op", body))
        return json.loads(c.getresponse().read())
    def journal(self): return [json.loads(l) for l in open(os.path.join(self.wstate, "journal.jsonl")) if l.strip()]
    def last_op(self): return [j for j in self.journal() if j.get("event") == "OP"][-1]
    def authz(self): return self.last_op()["authorization"]
    def restore(self): rw.resolve_config_dir = self._orig
    def close(self):
        if hasattr(self, "srv"): self.srv.shutdown(); self.srv.server_close()
        self.restore()


class Fixture:
    """Two real physical Disk libraries: A (authorized) and B (a byte clone, so content alone can never separate them)."""
    def __init__(self, clone=True):
        self.base = tmpdir("lib-"); self.A = os.path.join(self.base, "libA"); self.B = os.path.join(self.base, "libB")
        os.makedirs(self.A); os.makedirs(self.B)
        make_library(self.A, [("Prod Project", P_A1, TLS), ("Second", P_A2, TLS)])
        if clone: shutil.copytree(os.path.join(self.A, "Resolve Projects"), os.path.join(self.B, "Resolve Projects"))
        else: make_library(self.B, [("Prod Project", P_B1, TLS)])
        self.name = "Prod Disk A"; self.bname = "Prod Disk B"
    def lib(self, root=None): return libspec(self.name, root or self.A)
    def profile(self, projects=(P_A1, P_A2), **kw): return Profile(self.lib(), list(projects), **kw)
    def st(self, puuid=P_A1, **kw): return state(self.name, puuid, project_list=["Prod Project", "Second"], **kw)


class Authority(unittest.TestCase):
    """The compiler is the only door to a LIVE policy, and v1 is structurally vidnux/Linux/one-Disk-library/ISOLATED_DISK_SESSION."""
    def setUp(self): self.fx = Fixture()
    def c(self, src, preview=False): return comp.compile_record(json.dumps(src).encode(), WSHA, preview=preview)

    def test_accepted_record_compiles_to_a_deterministic_live_policy(self):
        src = record(self.fx.lib(), [P_A1, P_A2])
        pol = self.c(src)
        self.assertTrue(pol["live"]); self.assertEqual(pol["authority_status"], "ACCEPTED")
        self.assertEqual(pol["worker_sha256"], WSHA); self.assertEqual(pol["facade_commit"], FACADE_COMMIT)
        self.assertEqual(pol["host_id"], "vidnux"); self.assertEqual(pol["platform"], "Linux")
        self.assertEqual(pol["session_profile_type"], "ISOLATED_DISK_SESSION")
        self.assertEqual(pol["projects"], sorted([P_A1, P_A2]))
        self.assertEqual(pol["library"], self.fx.lib())
        self.assertEqual(pol["write_authority"], "NONE"); self.assertEqual(pol["persistent_worker_authority"], "NONE")
        self.assertEqual(self.c(src), self.c(src))                       # deterministic

    def test_only_an_accepted_and_fully_bound_record_can_go_live(self):
        variants = {"candidate": dict(status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None),
                    "candidate_with_approver": dict(status="CANDIDATE_FOR_INDEPENDENT_REVIEW"),
                    "accepted_null_approver": dict(approved_by=None), "rejected": dict(status="REJECTED"),
                    "superseded": dict(status="SUPERSEDED"), "accepted_no_date": dict(approved_at=None),
                    "accepted_no_acceptance_record": dict(acceptance=None),
                    "wrong_worker_pin": dict(worker_sha="0" * 64), "wrong_facade_pin": dict(facade="a" * 40)}
        for name, kw in variants.items():
            src = record(self.fx.lib(), [P_A1], **kw)
            with self.assertRaises(comp.PolicyError, msg=name): self.c(src)
            pv = self.c(src, preview=True)
            self.assertFalse(pv["live"], name); self.assertIsNone(pv["library"], name); self.assertEqual(pv["projects"], [], name)
        with self.assertRaises(comp.PolicyError): self.c(record(self.fx.lib(), [P_A1]), preview=True)   # accepted never silently downgraded

    def test_unscoped_candidate_is_valid_but_never_live_and_accepted_must_be_scoped(self):
        unscoped = record(None, [], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None, approved_at=None, acceptance=None)
        pv = self.c(unscoped, preview=True); self.assertFalse(pv["live"]); self.assertIsNone(pv["library"])
        with self.assertRaises(comp.PolicyError): self.c(unscoped)
        for bad in (record(None, [P_A1]), record(self.fx.lib(), []), record(None, [])):
            with self.assertRaises(comp.PolicyError): self.c(bad)          # ACCEPTED must name one library and >=1 project

    def test_schema_is_enforced_natively(self):
        good = record(self.fx.lib(), [P_A1])
        bad = [("unknown field", dict(good, surprise=1))]
        for k in ("status", "host_id", "platform", "session_profile_type", "library", "projects", "operations", "schema", "worker_identity", "facade_identity"):
            b = dict(good); del b[k]; bad.append(("missing " + k, b))
        bad += [("other host presto", record(self.fx.lib(), [P_A1], host_id="presto")),
                ("other host vidlap2", record(self.fx.lib(), [P_A1], host_id="vidlap2")),
                ("windows", record(self.fx.lib(), [P_A1], platform_="Windows")),
                ("other session model", record(self.fx.lib(), [P_A1], session_type="ATTACH_EXISTING")),
                ("impossible date", record(self.fx.lib(), [P_A1], approved_at="2026-02-30")),
                ("shaped but unreal date", record(self.fx.lib(), [P_A1], approved_at="2026-99-99")),
                ("network kind", record(dict(self.fx.lib(), kind="PostgreSQL"), [P_A1])),
                ("prohibited name EKA", record(dict(self.fx.lib(), name="EKA192.168.50.199"), [P_A1])),
                ("prohibited name Local Database", record(dict(self.fx.lib(), name="Local Database"), [P_A1])),
                ("wildcard name", record(dict(self.fx.lib(), name="*"), [P_A1])),
                ("relative root", record(dict(self.fx.lib(), canonical_root="libs/A"), [P_A1])),
                ("UNC root", record(dict(self.fx.lib(), canonical_root="//vidnas/public/A"), [P_A1])),
                ("dotdot root", record(dict(self.fx.lib(), canonical_root="/srv/../srv/A"), [P_A1])),
                ("trailing separator", record(dict(self.fx.lib(), canonical_root="/srv/A/"), [P_A1])),
                ("no dev pin", record({k: v for k, v in self.fx.lib().items() if k != "physical_dev"}, [P_A1])),
                ("bool dev pin", record(dict(self.fx.lib(), physical_dev=True), [P_A1])),
                ("project name instead of uuid", record(self.fx.lib(), ["Prod Project"])),
                ("uppercase uuid", record(self.fx.lib(), [P_A1.upper()])),
                ("duplicate project", record(self.fx.lib(), [P_A1, P_A1])),
                ("eight operations", record(self.fx.lib(), [P_A1], operations=list(comp.OPS)[:8])),
                ("write authority", record(self.fx.lib(), [P_A1], write_authority="LIMITED")),
                ("persistent worker", record(self.fx.lib(), [P_A1], persistent_worker_authority="ALLOWED")),
                ("remote scripting", record(self.fx.lib(), [P_A1], external_scripting="Network")),
                ("law reworded", record(self.fx.lib(), [P_A1], project_open_law=LAW.replace("never", "prefer not to")))]
        for name, b in bad:
            with self.assertRaises((comp.PolicyError, KeyError, TypeError), msg=name): self.c(b)
            with self.assertRaises((comp.PolicyError, KeyError, TypeError), msg=name + " (preview)"): self.c(b, preview=True)

    def test_the_shipped_candidate_record_authorizes_nothing(self):
        path = os.path.join(os.path.dirname(ROOT), "docs", "resolve-integration", "production-read", "PRODUCTION-READ-AUTHORITY-v1.candidate.json")
        raw = open(path, "rb").read(); src = json.loads(raw)
        comp.validate_schema(src)                                              # the shipped record is schema-valid
        self.assertEqual(src["status"], "CANDIDATE_FOR_INDEPENDENT_REVIEW"); self.assertIsNone(src["approved_by"])
        self.assertIsNone(src["library"]); self.assertEqual(src["projects"], [])
        self.assertEqual(src["host_id"], "vidnux"); self.assertEqual(src["platform"], "Linux")
        self.assertEqual(src["worker_identity"]["worker_sha256"], WSHA, "the shipped record must pin THESE candidate bytes")
        self.assertEqual(src["facade_identity"]["commit"], FACADE_COMMIT)
        with self.assertRaises(comp.PolicyError): comp.compile_record(raw, WSHA)
        pv = comp.compile_record(raw, WSHA, preview=True)
        self.assertFalse(pv["live"]); self.assertIsNone(pv["library"]); self.assertEqual(pv["projects"], [])

    def test_compiler_cli_writes_canonical_bytes_and_refuses_on_stdout(self):
        d = tmpdir("cli-"); sp = os.path.join(d, "a.json"); op = os.path.join(d, "p.json")
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1])))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, op, "--worker", WORKER_PATH])
        self.assertEqual(rc, 0); self.assertTrue(js["ok"]); self.assertTrue(js["live"])
        self.assertEqual(js["policy_file_sha256"], rw.sha(open(op, "rb").read()))
        self.assertEqual(open(op, "rb").read(), comp.canon(json.load(open(op))))       # canonical on disk
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1], status="REJECTED")))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, os.path.join(d, "p2.json"), "--worker", WORKER_PATH])
        self.assertEqual(rc, 2); self.assertFalse(js["ok"]); self.assertEqual(js["error"], "POLICY_REJECTED")
        self.assertFalse(os.path.exists(os.path.join(d, "p2.json")))


class SessionProfile(unittest.TestCase):
    """The generator turns an accepted grant into a sealed directory that can host exactly one Project Library."""
    def setUp(self): self.fx = Fixture()

    def test_generated_profile_registers_exactly_one_disk_library(self):
        p = self.fx.profile()
        reg = open(os.path.join(p.prov["profile_root"], "config", ".dblist")).read().splitlines()
        self.assertEqual(reg, [f"{self.fx.name}:{os.path.realpath(self.fx.A)}::::DISK"])
        self.assertEqual(open(os.path.join(p.prov["profile_root"], "config", ".activedb")).read(), f"disk*:{self.fx.name}\n")
        self.assertEqual(p.gov["library"], self.fx.lib()); self.assertEqual(p.gov["projects"], sorted([P_A1, P_A2]))
        self.assertEqual(p.gov["facade_commit"], FACADE_COMMIT); self.assertEqual(p.gov["worker_sha256"], WSHA)
        self.assertEqual(p.gov["host_id"], "vidnux"); self.assertEqual(p.gov["profile_type"], "ISOLATED_DISK_SESSION")
        self.assertEqual(p.manifest["governed_sha256"], gen.canonical_sha256(p.gov))
        for d in ("config", "support", "logs", "cache"): self.assertTrue(os.path.isdir(os.path.join(p.prov["profile_root"], d)))
        self.assertEqual(sorted(p.gov["profile_env"]), ["BMD_RESOLVE_CONFIG_DIR", "BMD_RESOLVE_LOGS_DIR", "BMD_RESOLVE_SUPPORT_DIR", "XDG_CACHE_HOME"])

    def test_operator_library_list_and_history_are_never_copied_and_the_source_is_untouched(self):
        cfg = source_config()
        before = {n: rw.sha(open(os.path.join(cfg, n), "rb").read()) for n in sorted(os.listdir(cfg))}
        p = self.fx.profile(cfg=cfg)
        after = {n: rw.sha(open(os.path.join(cfg, n), "rb").read()) for n in sorted(os.listdir(cfg))}
        self.assertEqual(before, after, "the operator configuration directory must never be written to")
        blob = b""
        for rel in p.prov["files"]: blob += open(os.path.join(p.prov["profile_root"], rel), "rb").read()
        for forbidden in (b"EKA", b"Local Database", b"Other Disk", b"secret production project", b"192.168.50.199"):
            self.assertNotIn(forbidden, blob, f"{forbidden!r} leaked into the isolated profile")
        self.assertNotIn(".recentprojects", p.prov["files"])
        self.assertIn("config/config.dat", p.prov["files"])

    def test_governed_block_is_deterministic_across_regeneration(self):
        p1 = self.fx.profile()
        p2 = Profile(self.fx.lib(), [P_A1, P_A2], src=p1.src, resolve_binary=p1.binary, cfg=p1.cfg)
        self.assertEqual(p1.manifest["governed_sha256"], p2.manifest["governed_sha256"])
        self.assertEqual(p1.gov["session_id"], p2.gov["session_id"])
        self.assertNotEqual(p1.prov["profile_root"], p2.prov["profile_root"])

    def test_generator_refuses_unaccepted_grants_drifted_roots_and_disabled_scripting(self):
        with self.assertRaises(comp.PolicyError):                                  # never even compiles
            Profile(self.fx.lib(), [P_A1], src=record(self.fx.lib(), [P_A1], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None))
        with self.assertRaises(gen.GenerateError):                                 # inode pin does not match the real directory
            Profile(dict(self.fx.lib(), physical_ino=self.fx.lib()["physical_ino"] + 1), [P_A1])
        with self.assertRaises(gen.GenerateError):                                 # authorized root does not exist
            Profile(dict(self.fx.lib(), canonical_root="/nonexistent/library/root"), [P_A1])
        with self.assertRaises(gen.GenerateError):                                 # External Scripting is not Local
            self.fx.profile(cfg=source_config(scripting=0))
        alias = os.path.join(tmpdir("alias-"), "linkA"); os.symlink(self.fx.A, alias)
        with self.assertRaises(gen.GenerateError):                                 # a symlink alias is not a canonical root
            Profile(dict(self.fx.lib(), canonical_root=alias), [P_A1])

    def test_generator_refuses_to_overwrite_or_seal_itself(self):
        p = self.fx.profile()
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", p.prov["profile_root"],
                         "--out", os.path.join(p.d, "again.json"), "--resolve-binary", p.binary])
        self.assertEqual(rc, 2); self.assertIn("not empty", js["message"])
        root2 = os.path.join(p.d, "profile2")
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", root2,
                         "--out", os.path.join(root2, "inside.json"), "--resolve-binary", p.binary])
        self.assertEqual(rc, 2); self.assertIn("outside", js["message"])

    def test_generated_profile_passes_its_own_schema_shape(self):
        p = self.fx.profile()
        schema = json.load(open(os.path.join(ROOT, "schemas", "resolveProductionReadSessionProfile.v1.schema.json")))
        self.assertEqual(p.manifest["schema"], schema["title"])
        self.assertEqual(sorted(p.gov), sorted(schema["properties"]["governed"]["required"]))
        self.assertEqual(sorted(p.prov), sorted(schema["properties"]["provenance"]["required"]))


class Attestation(unittest.TestCase):
    """Session provenance: every clause is an observable Linux fact, and every failure refuses before Resolve is touched."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.profile()
    def attest(self, probe): return rw.attest_isolated_session(probe, self.p.gov, self.p.prov)
    def refuse(self, probe, reason):
        try: self.attest(probe)
        except rw.OpError as e:
            self.assertEqual(e.code, "LIBRARY_MISMATCH", "candidate must emit only frozen error codes")
            self.assertEqual(e.detail["reason"], reason); return e
        raise AssertionError(f"attestation unexpectedly succeeded (expected {reason})")

    def test_a_session_born_into_the_sealed_profile_attests(self):
        probe = FakeProbe(self.p)
        ident = self.attest(probe)
        self.assertEqual(ident["pid"], 9001); self.assertEqual(ident["endpoint_owner_pids"], [9002])
        self.assertEqual(ident["executable"], self.p.gov["resolve_binary"]["realpath"])
        self.assertGreaterEqual(ident["start_epoch"], self.p.prov["seal_epoch"])

    def test_missing_ambiguous_or_foreign_sessions_refuse(self):
        self.refuse(FakeProbe(self.p, resolve_pids=()), "SESSION_NOT_RUNNING")
        self.refuse(FakeProbe(self.p, resolve_pids=(9001, 9005)), "SESSION_AMBIGUOUS")
        probe = FakeProbe(self.p); probe.proc_uid = lambda pid: 0
        self.refuse(probe, "SESSION_OWNER_MISMATCH")

    def test_a_pre_existing_session_is_never_eligible(self):
        self.refuse(FakeProbe(self.p, start_after=-1), "SESSION_PREDATES_PROFILE")
        self.refuse(FakeProbe(self.p, start_after=-86400), "SESSION_PREDATES_PROFILE")

    def test_a_session_launched_with_another_profile_refuses(self):
        self.refuse(FakeProbe(self.p, environ={}), "SESSION_PROCESS_UNREADABLE")
        env = {v: os.path.join(self.p.prov["profile_root"], rel) for v, rel in self.p.gov["profile_env"].items()}
        for var in sorted(env):
            bad = dict(env); bad[var] = "/home/op/.local/share/DaVinciResolve"
            self.refuse(FakeProbe(self.p, environ=bad), "SESSION_PROFILE_MISMATCH")
            missing = {k: v for k, v in env.items() if k != var}
            self.refuse(FakeProbe(self.p, environ=missing), "SESSION_PROFILE_MISMATCH")

    def test_the_scripting_endpoint_must_belong_to_the_attested_session(self):
        self.refuse(FakeProbe(self.p, listener_pid=None), "SESSION_HANDLE_UNBOUND")
        self.refuse(FakeProbe(self.p, listener_parent=1), "SESSION_HANDLE_UNBOUND")         # listener outside the session tree
        probe = FakeProbe(self.p); probe.port_owners[self.p.gov["script_server_port"]].add(4321)
        probe.ppid = lambda pid: 1 if pid == 4321 else (9001 if pid == 9002 else 0)
        self.refuse(probe, "SESSION_HANDLE_UNBOUND")
        deep = FakeProbe(self.p, listener_pid=9100)                                          # grandchild is inside the session tree
        deep.ppid = lambda pid: {9100: 9050, 9050: 9001, 9001: 1, 1: 0}.get(pid, 1)
        self.assertEqual(self.attest(deep)["endpoint_owner_pids"], [9100])

    def test_executable_identity_is_pinned(self):
        other = fake_binary(size=8192)
        self.refuse(FakeProbe(self.p, exe=other), "SESSION_NOT_RUNNING")                     # a different binary is not this session
        open(self.p.gov["resolve_binary"]["realpath"], "ab").write(b"\0" * 16)               # binary changed under us
        self.refuse(FakeProbe(self.p), "SESSION_EXECUTABLE_MISMATCH")

    def test_a_sealed_profile_edited_after_sealing_refuses(self):
        reg = os.path.join(self.p.prov["profile_root"], self.p.prov["registration_relpath"])
        open(reg, "a").write("Other Disk:/srv/other::::DISK\n")
        try: rw.verify_profile_files(self.p.prov, self.p.gov)
        except rw.OpError as e: self.assertEqual(e.detail["reason"], "SESSION_PROFILE_MUTATED")
        else: raise AssertionError("mutated registration accepted")


class Runtime(unittest.TestCase):
    """End to end over the frozen client: the whole chain is re-verified per operation and every decision is journaled."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.profile(); self.envs = []
    def tearDown(self):
        for e in self.envs: e.close()
    def env(self, st=None, **kw):
        e = Env(st if st is not None else self.fx.st(), self.p, **kw); self.envs.append(e); return e
    def denied(self, e, op="get_current_project", stage=None, reason=None, code="LIBRARY_MISMATCH", decision="DENIED", **kw):
        err = e.err(op, **kw); a = e.authz()
        self.assertEqual(err.code, code, a)
        self.assertEqual(a["decision"], decision, a)
        if stage: self.assertEqual(a["stage"], stage, a)
        if reason: self.assertEqual(a["reason"], reason, a)
        return a

    def test_an_authorized_read_succeeds_and_journals_the_full_identity(self):
        e = self.env()
        out = e.call("get_current_project")
        self.assertEqual(out["project"]["uuid"], P_A1)
        self.assertEqual(out["resolve"]["library"]["name"], self.fx.name)
        self.assertEqual(out["read_profile"], "PRODUCTION_READ")
        self.assertEqual(out["write_authority"], "NONE"); self.assertIsNone(out["write_lease"])
        a = e.authz()
        self.assertEqual(a["decision"], "ALLOWED"); self.assertEqual(a["stage"], "project")
        self.assertEqual(a["project_uuid"], P_A1)
        self.assertEqual(a["library"], {"kind": "Disk", "name": self.fx.name, "canonical_root": os.path.realpath(self.fx.A),
                                        "dev": self.fx.lib()["physical_dev"], "ino": self.fx.lib()["physical_ino"]})
        self.assertEqual(a["session"]["pid"], 9001); self.assertEqual(a["session"]["endpoint_owner_pids"], [9002])
        self.assertEqual(a["session_id"], self.p.gov["session_id"])
        self.assertEqual(a["policy_sha256"], self.p.pol_sha); self.assertEqual(a["session_profile_sha256"], self.p.session_sha)
        self.assertEqual(a["authority_sha256"], self.p.gov["authority_sha256"])
        self.assertEqual(out["worker"]["worker_sha256"], WSHA)
        self.assertEqual(out["worker"]["session_profile_sha256"], self.p.session_sha)

    def test_the_worker_refuses_to_start_without_the_whole_chain(self):
        d = tmpdir("start-"); sec = os.urandom(32)
        def start(**kw):
            args = dict(policy_path=self.p.pol_path, policy_sha256=self.p.pol_sha, authority_path=self.p.src_path,
                        session_path=self.p.session_path, session_sha256=self.p.session_sha)
            args.update(kw)
            return rw.Worker(HOST, sec, os.path.join(d, uuid.uuid4().hex), fake_resolve, None, "PRODUCTION_READ",
                             args["policy_path"], args["policy_sha256"], args["authority_path"], args["session_path"],
                             args["session_sha256"], FakeProbe(self.p))
        for kw in ({"session_path": None}, {"session_sha256": None}, {"policy_path": None}, {"authority_path": None}, {"policy_sha256": None}):
            with self.assertRaises(SystemExit): start(**kw)
        with self.assertRaises(SystemExit): start(session_sha256="0" * 64)            # profile digest pin must match
        with self.assertRaises(SystemExit): start(policy_sha256="0" * 64)
        with self.assertRaises(SystemExit):                                           # a qualification gate is not a production grant
            rw.Worker(HOST, sec, os.path.join(d, "q"), fake_resolve, ("Prod Disk A", None), "PRODUCTION_READ",
                      self.p.pol_path, self.p.pol_sha, self.p.src_path, self.p.session_path, self.p.session_sha, FakeProbe(self.p))
        with self.assertRaises(SystemExit):                                           # chain arguments are meaningless outside PRODUCTION_READ
            rw.Worker(HOST, sec, os.path.join(d, "x"), fake_resolve, None, "QUALIFICATION_READ", self.p.pol_path, self.p.pol_sha,
                      self.p.src_path, self.p.session_path, self.p.session_sha, FakeProbe(self.p))
        w = start(); self.assertEqual(w.identity["read_profile"], "PRODUCTION_READ")   # the positive control really does start

    def test_production_read_is_structurally_linux_and_vidnux_only(self):
        self.assertEqual(rw.PRODUCTION_HOSTS, ("vidnux",)); self.assertEqual(rw.PRODUCTION_PLATFORM, "Linux")
        orig = rw.platform.system
        try:
            rw.platform.system = lambda: "Windows"
            with self.assertRaises(SystemExit):
                rw.Worker(HOST, os.urandom(32), tmpdir("win-"), fake_resolve, None, "PRODUCTION_READ", self.p.pol_path,
                          self.p.pol_sha, self.p.src_path, self.p.session_path, self.p.session_sha, FakeProbe(self.p))
        finally: rw.platform.system = orig

    def test_a_non_live_preview_policy_is_refused_at_startup(self):
        d = tmpdir("prev-"); sp = os.path.join(d, "a.json"); pp = os.path.join(d, "p.json")
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None)))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, pp, "--worker", WORKER_PATH, "--preview"])
        self.assertEqual(rc, 0); self.assertFalse(js["live"])
        with self.assertRaises(SystemExit) as cm:
            rw.Worker(HOST, os.urandom(32), os.path.join(d, "w"), fake_resolve, None, "PRODUCTION_READ", pp,
                      rw.sha(open(pp, "rb").read()), sp, self.p.session_path, self.p.session_sha, FakeProbe(self.p))
        self.assertIn("AUTHORITY_NOT_ACCEPTED", str(cm.exception))

    def test_policy_authority_or_profile_edited_after_start_refuse_the_next_operation(self):
        for name, mutate, stage, reason in (
                ("policy", lambda p: open(p.pol_path, "ab").write(b" "), "policy", "PRODUCTION_POLICY_PIN_MISMATCH"),
                ("authority", lambda p: open(p.src_path, "ab").write(b"\n"), "authority", "AUTHORITY_SOURCE_MISMATCH"),
                ("manifest", lambda p: open(p.session_path, "ab").write(b" "), "profile", "SESSION_PROFILE_PIN_MISMATCH"),
                ("sealed file", lambda p: open(os.path.join(p.prov["profile_root"], "config", "config.dat"), "a").write("x"), "profile", "SESSION_PROFILE_MUTATED"),
                ("registration", lambda p: open(os.path.join(p.prov["profile_root"], "config", ".dblist"), "a").write("Other:/srv/o::::DISK\n"), "profile", "SESSION_PROFILE_MUTATED")):
            with self.subTest(name):
                self.fx = Fixture(); self.p = self.fx.profile()
                e = self.env(); self.assertTrue(e.call("identify")["ok"])
                mutate(self.p)
                self.denied(e, stage=stage, reason=reason)

    def test_a_policy_repinned_to_another_worker_facade_or_record_is_refused(self):
        other = record(self.fx.lib(), [P_A1], worker_sha="1" * 64)
        with self.assertRaises(comp.PolicyError): comp.compile_record(json.dumps(other).encode(), WSHA)
        e = self.env()
        pol = json.load(open(self.p.pol_path))
        for field, value, reason in (("worker_sha256", "2" * 64, "WORKER_IDENTITY_MISMATCH"),
                                     ("facade_commit", "b" * 40, "FACADE_IDENTITY_MISMATCH"),
                                     ("source_record_sha256", "3" * 64, "AUTHORITY_SOURCE_MISMATCH"),
                                     ("host_id", "presto", "HOST_NOT_AUTHORIZED"),
                                     ("projects", [P_B1], "AUTHORITY_SOURCE_MISMATCH")):
            body = dict(pol); body[field] = value; body.pop("policy_sha256")
            body["policy_sha256"] = rw.canonical_sha256(body)
            open(self.p.pol_path, "wb").write(comp.canon(body))
            e.worker.policy_sha256 = rw.sha(open(self.p.pol_path, "rb").read())        # even a correctly re-pinned policy
            self.denied(e, stage="authority" if reason.startswith("AUTHORITY") else "policy", reason=reason)

    def test_an_open_library_that_is_not_the_profiles_single_library_is_refused(self):
        e = self.env(state(self.fx.bname, P_A1))
        self.denied(e, stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        e2 = self.env(state("EKA192.168.50.199", P_A1, libtype="PostgreSQL", host="192.168.50.199"))
        self.denied(e2, stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        e3 = self.env(state(self.fx.name, P_A1, libtype="PostgreSQL", host="192.168.50.199"))
        self.denied(e3, stage="library", reason="LIBRARY_NOT_AUTHORIZED")              # name alone never authorizes
        e4 = self.env(state(None, P_A1))
        self.denied(e4, stage="library", reason="LIBRARY_IDENTITY_UNAVAILABLE")

    def test_the_authorized_root_must_still_be_the_pinned_physical_directory(self):
        e = self.env(); e.call("identify")
        moved = self.fx.A + "-moved"; os.rename(self.fx.A, moved); os.makedirs(self.fx.A)   # same path, new inode
        self.denied(e, stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        os.rmdir(self.fx.A); os.rename(moved, self.fx.A)
        e.call("identify")
        os.rename(self.fx.A, moved)                                                        # path gone entirely
        self.denied(e, stage="library", reason="LIBRARY_IDENTITY_UNAVAILABLE")
        os.rename(moved, self.fx.A)

    def test_only_allowlisted_projects_are_readable_and_a_switch_is_caught_between_operations(self):
        e = self.env()
        self.assertEqual(e.call("get_current_project")["project"]["uuid"], P_A1)
        e.set_state(state(self.fx.name, P_B1))                                             # human switched to another project
        self.denied(e, stage="project", reason="PROJECT_NOT_AUTHORIZED", code="PROJECT_IDENTITY_MISMATCH")
        e.set_state(self.fx.st(P_A2))
        self.assertEqual(e.call("get_current_project")["project"]["uuid"], P_A2)            # the second granted project still reads

    def test_no_project_open_never_opens_one(self):
        e = self.env(state(self.fx.name, P_A1)); e.set_state({"database": {"DbName": self.fx.name, "DbType": "Disk"}, "project": None, "timelines": [], "current": 0})
        err = e.err("get_current_project"); self.assertEqual(err.code, "PROJECT_NOT_OPEN")
        a = e.authz(); self.assertEqual(a["decision"], "NOT_REACHED"); self.assertEqual(a["stage"], "resolve")
        self.assertNotIn("SetCurrentProject(", SRC); self.assertNotIn("LoadProject(", SRC)

    def test_a_replaced_or_vanished_session_refuses_every_later_read(self):
        e = self.env(); e.call("identify")
        e.probe.start_epoch += 5                                                           # same binary, new process instant
        self.denied(e, stage="session", reason="SESSION_RESTARTED")
        e.probe.resolve_pids = []
        self.denied(e, stage="session", reason="SESSION_NOT_RUNNING")

    def test_health_reports_and_journals_the_refusal_without_claiming_liveness(self):
        e = self.env(state(self.fx.bname, P_A1))
        out = e.call("health")
        self.assertTrue(out["result"]["worker_alive"]); self.assertEqual(out["resolve"]["probe"], "LIBRARY_MISMATCH")
        self.assertIsNone(out["resolve"]["available"])
        self.assertEqual(out["resolve"]["library_gate"]["reason"], "LIBRARY_NOT_AUTHORIZED")
        self.assertEqual(out["resolve"]["authorization"]["decision"], "DENIED")
        a = e.authz(); self.assertEqual(a["decision"], "DENIED"); self.assertEqual(a["stage"], "library")
        self.assertEqual(a["op"], "health")

    def test_write_class_operations_are_refused_before_resolve_is_touched(self):
        e = self.env()
        before = e.state_path + ".attach_count"
        n0 = int(open(before).read()) if os.path.exists(before) else 0
        for op in sorted(rw.FORBIDDEN_OPS) + ["do_something_else"]:
            out = e.raw({"protocol": rw.PROTOCOL, "op": op, "target_host": HOST, "caller": "test", "request_id": uuid.uuid4().hex})
            self.assertFalse(out["ok"], op)
            self.assertIn(out["error"]["code"], ("READ_ONLY_MODE", "UNSUPPORTED_OPERATION"))
        n1 = int(open(before).read()) if os.path.exists(before) else 0
        self.assertEqual(n0, n1, "a refused operation must never attach to Resolve")
        a = e.authz(); self.assertEqual(a["decision"], "DENIED"); self.assertEqual(a["stage"], "pre-resolve")


class DeploymentBinding(unittest.TestCase):
    """The offline binder proves, from bytes alone, that one facade install + worker + authority + policy + profile are one deployment."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.profile()
    def bind(self, **kw):
        args = {"--facade-dir": FACADE, "--facade-manifest": FACADE_MANIFEST, "--worker": WORKER_PATH,
                "--authority": self.p.src_path, "--policy": self.p.pol_path, "--session": self.p.session_path}
        args.update(kw)
        cmd = [sys.executable, "-B", BINDER]
        for k, v in args.items(): cmd += [k, v]
        return run(cmd)

    def test_a_coherent_deployment_verifies(self):
        rc, js, raw = self.bind()
        self.assertEqual(rc, 0, raw); self.assertTrue(js["ok"]); self.assertEqual(js["failures"], [])
        self.assertEqual(js["verdict"], "DEPLOYMENT BINDING VERIFIED")
        self.assertGreaterEqual(js["checks_total"], 20)

    def test_the_accepted_facade_bytes_are_pinned(self):
        man = json.load(open(FACADE_MANIFEST))
        self.assertEqual(man["facade_commit"], FACADE_COMMIT)
        self.assertEqual(len(man["files"]), 10)
        d = tmpdir("facade-"); copy = os.path.join(d, "plugin"); shutil.copytree(FACADE, copy)
        rc, js, _ = self.bind(**{"--facade-dir": copy}); self.assertEqual(rc, 0)
        open(os.path.join(copy, "vrcfacade", "facade.py"), "a").write("# drift\n")
        rc, js, _ = self.bind(**{"--facade-dir": copy})
        self.assertEqual(rc, 1); self.assertIn("facade.bytes_match_accepted_commit", [f["check"] for f in js["failures"]])
        os.remove(os.path.join(copy, "vrcfacade", "facade.py"))
        rc, js, _ = self.bind(**{"--facade-dir": copy})
        self.assertIn("facade.no_missing_files", [f["check"] for f in js["failures"]])
        open(os.path.join(copy, "vrcfacade", "facade.py"), "w").write("")
        open(os.path.join(copy, "extra_tool.py"), "w").write("# smuggled\n")
        rc, js, _ = self.bind(**{"--facade-dir": copy})
        self.assertIn("facade.no_extra_files", [f["check"] for f in js["failures"]])

    def test_a_mixed_deployment_is_refused(self):
        frozen_worker = os.path.join(FROZEN, "worker", "resolve_worker.py")
        rc, js, _ = self.bind(**{"--worker": frozen_worker})
        self.assertEqual(rc, 1); self.assertTrue(any(f["check"].endswith("binds_worker_bytes") or "accepted_and_pinned" in f["check"] for f in js["failures"]), js)
        other = Profile(self.fx.lib(), [P_A2])                                        # a different grant entirely
        rc, js, _ = self.bind(**{"--policy": other.pol_path})
        self.assertEqual(rc, 1); self.assertIn("policy.binds_authority_bytes", [f["check"] for f in js["failures"]])
        rc, js, _ = self.bind(**{"--session": other.session_path})
        self.assertEqual(rc, 1); self.assertTrue(any("session.binds" in f["check"] for f in js["failures"]), js)

    def test_an_edited_seal_is_refused(self):
        open(os.path.join(self.p.prov["profile_root"], "config", ".dblist"), "a").write("Other Disk:/srv/other::::DISK\n")
        rc, js, _ = self.bind()
        self.assertEqual(rc, 1)
        names = [f["check"] for f in js["failures"]]
        self.assertIn("session.sealed_files_unchanged", names)
        self.assertIn("session.registration_is_exactly_one_authorized_library", names)


class FrozenParity(unittest.TestCase):
    """Nothing the accepted qualification system depends on may drift, and the accepted facade stays unchanged."""
    def test_the_qualification_registration_parser_is_byte_identical_to_frozen(self):
        def fn(src, name):
            lines = src.splitlines(True); i = next(k for k, l in enumerate(lines) if l.startswith(f"def {name}("))
            out = [lines[i]]
            for l in lines[i + 1:]:
                if l.strip() and not l[0].isspace(): break          # first dedented line ends the function
                out.append(l)
            return "".join(out).rstrip() + "\n"
        for name in ("dblist_root_for", "resolve_config_dir"):
            self.assertEqual(fn(SRC, name), fn(FROZEN_SRC, name), f"{name} drifted from frozen Phase 1")

    def test_the_frozen_parser_is_never_used_by_production_mode(self):
        qual = SRC[SRC.index("def check_library(self"):SRC.index("# ---- PRODUCTION_READ gates")]
        prod = SRC[SRC.index("# ---- PRODUCTION_READ gates"):SRC.index("# ---- request execution")]
        chain = SRC[SRC.index("def load_production_policy"):SRC.index("class SystemProbe")]
        self.assertIn("dblist_root_for(", qual)
        for region, label in ((prod, "production gates"), (chain, "production chain")):
            self.assertNotIn("dblist_root_for", region, f"the frozen qualification parser must not be used by the {label}")

    def test_read_only_op_sets_are_frozen(self):
        for const in ("READ_ONLY_OPS = ", "FORBIDDEN_OPS = "):
            line = [l for l in SRC.splitlines() if l.startswith(const)][0]
            self.assertIn(line, FROZEN_SRC, f"{const.strip()} drifted from frozen Phase 1")
        self.assertEqual(len(rw.READ_ONLY_OPS), 9)

    def test_the_candidate_contains_no_write_or_project_switching_call(self):
        for banned in ("LoadProject(", "OpenProject(", "SetCurrentProject(", "SetCurrentDatabase(", "DeleteProject(",
                       "SaveProject(", "ImportProject(", "ExportProject(", "AddTimeline(", "CreateProject(", "StartRender("):
            self.assertNotIn(banned, SRC, f"{banned} must not exist in a read-only worker")

    def test_every_candidate_refusal_uses_a_frozen_error_code(self):
        self.assertIn("LIBRARY_MISMATCH", CODES); self.assertIn("PROJECT_IDENTITY_MISMATCH", CODES)
        for m in set(re.findall(r'OpError\("([A-Z_]+)"', SRC)):
            self.assertIn(m, CODES, f"{m} is not a frozen vrc.v1 error code")

    def test_the_accepted_facade_validates_this_workers_envelopes_unchanged(self):
        sys.path.insert(0, FACADE)
        from vrcfacade import response                                     # the accepted facade, imported unchanged
        fx = Fixture(); p = fx.profile(); e = Env(fx.st(), p)
        try:
            ok = e.raw({"protocol": rw.PROTOCOL, "op": "get_current_project", "target_host": HOST, "caller": "test", "request_id": uuid.uuid4().hex})
            self.assertIs(response.validate(ok, "get_current_project", expect_target=HOST), ok)
            e.set_state(state(fx.bname, P_A1))
            bad = e.raw({"protocol": rw.PROTOCOL, "op": "get_current_project", "target_host": HOST, "caller": "test", "request_id": uuid.uuid4().hex})
            self.assertFalse(bad["ok"])
            self.assertIs(response.validate(bad, "get_current_project", expect_target=HOST), bad)
            self.assertEqual(bad["error"]["code"], "LIBRARY_MISMATCH")
            self.assertEqual(bad["error"]["detail"]["reason"], "LIBRARY_NOT_AUTHORIZED")
        finally: e.close()


class Qualification(unittest.TestCase):
    """The frozen qualification lane still behaves exactly as accepted, including the reviewer's counterexample."""
    def setUp(self): self.fx = Fixture(); self.p = self.fx.profile(); self.envs = []
    def tearDown(self):
        for e in self.envs: e.close()

    def qenv(self, lines, require):
        e = Env(self.fx.st(), self.p, mode="QUALIFICATION_READ", require_library=require); self.envs.append(e)
        open(os.path.join(e.cfg, ".dblist"), "w").write("\n".join(lines) + "\n")
        return e

    def test_qualification_mode_gates_on_the_frozen_dblist_only(self):
        e = self.qenv([f"{self.fx.name}:{self.fx.A}::::DISK"], (self.fx.name, self.fx.A))
        self.assertEqual(e.call("get_current_project")["project"]["uuid"], P_A1)
        self.assertEqual(e.authz(), {"read_profile": "QUALIFICATION_READ", "decision": "NOT_APPLICABLE"})
        e2 = self.qenv([f"{self.fx.name}:{self.fx.B}::::DISK"], (self.fx.name, self.fx.A))
        self.assertEqual(e2.err("get_current_project").code, "LIBRARY_MISMATCH")

    def test_the_reviewer_counterexample_stays_refused_on_linux(self):
        e = self.qenv(["# no matching entry"], (self.fx.name, self.fx.A))
        os.remove(os.path.join(e.cfg, ".dblist"))
        open(os.path.join(e.cfg, "dblist.conf"), "w").write(f"{self.fx.name}:{self.fx.A}:*:::DISK\n")
        self.assertEqual(e.err("get_current_project").code, "LIBRARY_MISMATCH")     # Windows grammar is not read on Linux


class CommandLine(unittest.TestCase):
    """The production CLI can reach neither the fake API seam nor a last-value-wins flag."""
    def cli(self, args, env=None):
        e = dict(os.environ); e.pop("VRC_FAKE_STATE", None); e.update(env or {})
        return subprocess.run([sys.executable, "-B", WORKER_PATH] + args, capture_output=True, text=True, env=e)

    def test_the_fake_api_seam_is_unreachable_from_the_cli(self):
        for var in ("VRC_FAKE_STATE", "VRC_FAKE_API", "RESOLVE_FAKE_API", "VRC_TEST_API"):
            r = self.cli(["--host-id", HOST, "--secret-file", "/dev/null", "--state-dir", tmpdir("cli-"), "--mode", "PRODUCTION_READ"], {var: "1"})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("REFUSED", r.stdout + r.stderr)

    def test_duplicate_flags_are_refused(self):
        for flag, value in (("--mode", "PRODUCTION_READ"), ("--host-id", HOST), ("--production-policy", "/tmp/p.json"),
                            ("--production-policy-sha256", "0" * 64), ("--production-authority", "/tmp/a.json"),
                            ("--production-session", "/tmp/s.json"), ("--production-session-sha256", "0" * 64),
                            ("--require-library", "X")):
            r = self.cli(["--host-id", HOST, "--secret-file", "/dev/null", "--state-dir", tmpdir("cli-"), flag, value, flag, value])
            self.assertNotEqual(r.returncode, 0, flag)
            self.assertIn("once", (r.stdout + r.stderr).lower(), flag)

    def test_the_session_arguments_exist_and_are_documented(self):
        r = self.cli(["--help"])
        for flag in ("--production-session", "--production-session-sha256", "--production-authority", "--production-policy-sha256"):
            self.assertIn(flag, r.stdout)


def tearDownModule():
    for d in TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
