"""Offline tests for the attested isolated-session production-read worker CANDIDATE 0.4.0
(successor to the REJECTED 4ae35e7c, which was successor to the REJECTED 59a5593d).

Everything here runs without Resolve, without a network, without the operator's configuration and without any production library:
real candidate worker bytes, the real compiler, generator, launcher and verifier invoked as subprocesses or with injected
dependencies, real temp-directory Disk libraries, real child processes with real /proc facts for the launcher suite, a fake Resolve
identity oracle and a deterministic process probe — all handed to Worker(...) by CONSTRUCTOR INJECTION only (there is no environment
switch and the production CLI can reach neither). The frozen Phase 1 vrc client and the accepted facade (8e068fea) are imported
unchanged.

Run via ./run-tests.sh (pipefail-safe) or: python3 -B tests/test_production_read.py
"""
import http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, unittest, uuid

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FROZEN = os.environ.get("VRC_PHASE1_ROOT", os.path.expanduser("~/resolve-authority-freeze-v1.20/resolve-control"))
FACADE = os.environ.get("VRC_FACADE_PLUGIN", os.path.expanduser("~/resolve-hermes/plugins/vidtoolz-resolve-readonly"))
sys.path[:0] = [FROZEN, os.path.join(ROOT, "worker"), os.path.join(ROOT, "tools"), os.path.join(ROOT, "capsule"), HERE]
import resolve_worker as rw
import vrc_capsule_confine as confine_mod
import fake_resolve                                   # test-only identity oracle; never reachable from the production CLI
import compile_production_read_policy as comp
import generate_session_profile as gen
import launch_isolated_session as launcher
from vrc.client import Client
from vrc.errors import VrcError, CODES
from vrc.registry import Registry
from vrc import protocol

WORKER_PATH = os.path.join(ROOT, "worker", "resolve_worker.py"); SRC = open(WORKER_PATH).read()
WSHA = rw.sha(open(WORKER_PATH, "rb").read())
FROZEN_SRC = open(os.path.join(FROZEN, "worker", "resolve_worker.py")).read()
COMPILER = os.path.join(ROOT, "tools", "compile_production_read_policy.py")
GENERATOR = os.path.join(ROOT, "tools", "generate_session_profile.py")
LAUNCHER = os.path.join(ROOT, "tools", "launch_isolated_session.py")
BINDER = os.path.join(ROOT, "tools", "verify_deployment_binding.py")
FACADE_MANIFEST = os.path.join(ROOT, "data", "accepted-facade-8e068fea.manifest.json")
HOST = "vidnux"
assert socket.gethostname().lower() == HOST, f"production-read v1 is vidnux-only; this suite must run on vidnux (hostname: {socket.gethostname()})"
FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"
LAW = "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"
P_A1, P_A2, P_B1 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
TLS = [{"name": "TL_A", "uuid": str(uuid.uuid4())}, {"name": "TL_B", "uuid": str(uuid.uuid4())}]
HZ = os.sysconf("SC_CLK_TCK")
NONCE = "a1" * 32
TMP = []
# The cross-account HMAC key. One key per run, generated here, so the key IDENTITY the accepted authority names is the identity of the
# bytes the worker actually loads — the test cannot accidentally prove the property with a key nobody uses.
SECRET = os.urandom(32).hex().encode()
KEY_ID = rw.sha(SECRET)[:16]
OPERATOR_UID = 1000                     # the account Hermes runs as; deliberately NOT the capsule account
CAPSULE_UID = CAPSULE_GID = 981
CAPSULE_ACCOUNT = "vrc-capsule-synthetic"
SECCOMP_SHA = rw.sha(confine_mod.seccomp_program()[0])
NS = {"user": "user:[4026500001]", "pid": "pid:[4026500002]", "net": "net:[4026500003]",
      "worker_mnt": "mnt:[4026500004]", "resolve_mnt": "mnt:[4026500005]"}


def tmpdir(prefix):
    d = tempfile.mkdtemp(prefix=prefix); TMP.append(d); return d


def sha_file(path):
    return rw.sha(open(path, "rb").read())


def synthetic_capsule(spawnable=False):
    """A complete stand-in for the APPROVED dedicated-capsule host boundary: a broker, a frozen 'Resolve runtime' with its manifest, and
    the evidence directories a session masks. It is injected the same way FakeProbe is — explicitly, by parameter — so the whole chain
    can be driven offline without touching the real capsule, and so every refusal of the real one can be reproduced.

    A record naming this boundary is USELESS against a production worker: the worker compares the block against its own frozen
    constants and refuses anything else (proved by HostPrimitive.test_a_synthetic_boundary_is_refused_by_a_production_worker)."""
    base = tmpdir("capsule-")
    runtime = os.path.join(base, "resolve-runtime")
    os.makedirs(os.path.join(runtime, "bin")); os.makedirs(os.path.join(runtime, "libs", "Fusion"))
    binpath = os.path.join(runtime, "bin", "resolve")
    if spawnable: shutil.copyfile(sys.executable, binpath)
    else: open(binpath, "wb").write(b"\x7fELF" + b"\0" * 4092)
    os.chmod(binpath, 0o755)
    lib = os.path.join(runtime, "libs", "Fusion", "fusionscript.so")
    open(lib, "wb").write(b"\x7fELF" + b"\0" * 2044)
    broker = os.path.join(base, "vrc-capsule-launch"); open(broker, "wb").write(b"#!/bin/false\n# synthetic broker\n"); os.chmod(broker, 0o755)
    man = os.path.join(runtime, "RUNTIME-MANIFEST.sha256")
    open(man, "w").write(f"{sha_file(binpath)}  bin/resolve\n{sha_file(lib)}  libs/Fusion/fusionscript.so\n")
    pins = {"execution_environment": "DEDICATED_CAPSULE_V1", "capsule_account": CAPSULE_ACCOUNT,
            "capsule_uid": CAPSULE_UID, "capsule_gid": CAPSULE_GID, "broker_path": broker, "broker_sha256": sha_file(broker),
            "runtime_root": runtime, "runtime_manifest_sha256": sha_file(man), "resolve_binary_sha256": sha_file(binpath),
            "script_lib_relpath": "libs/Fusion/fusionscript.so", "script_lib_sha256": sha_file(lib),
            "host_boundary_schema": rw.HOST_BOUNDARY_SCHEMA, "host_review_manifest_sha256": rw.HOST_REVIEW_MANIFEST_SHA256}
    evidence = os.path.join(base, "evidence"); wstate = os.path.join(base, "worker-state")
    os.makedirs(evidence); os.makedirs(wstate)
    bpath = os.path.join(base, "host-boundary.json"); json.dump(pins, open(bpath, "w"))
    return {"base": base, "pins": pins, "boundary_path": bpath, "binary": binpath, "broker": broker,
            "runtime": runtime, "manifest": man, "script_lib": lib, "mask": [evidence, wstate]}


CAP = synthetic_capsule()


def secret_file(d, data=SECRET):
    """The shared HMAC key as the operator places it: readable, never writable by the capsule. The OWNER is supplied by the probe —
    this suite runs as one uid and cannot create a file owned by another."""
    p = os.path.join(d, "session.key"); open(p, "wb").write(data); os.chmod(p, 0o640); return p


def caller_identity(key_id=None, operator_uid=None):
    return {"operator_uid": OPERATOR_UID if operator_uid is None else operator_uid, "hmac_key_id": key_id or KEY_ID}


def MASK(p):
    """The --evidence-mask arguments a sealed profile is generated with."""
    return [a for m in p.mask for a in ("--evidence-mask", m)]


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def make_library(root, projects):
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
           host_id=HOST, platform_="Linux", session_type="ISOLATED_DISK_SESSION", capsule=None,
           execution_environment="DEDICATED_CAPSULE_V1", caller=None, control=("session_stop",), **extra):
    r = {"schema": "vidtoolz.resolveProductionReadAuthority.v1", "authority_id": "test-authority", "status": status,
         "approved_by": approved_by, "approved_at": approved_at, "acceptance_record": acceptance,
         "worker_identity": {"component": "test", "worker_sha256": worker_sha}, "facade_identity": {"commit": facade},
         "host_id": host_id, "platform": platform_, "session_profile_type": session_type,
         "execution_environment": execution_environment, "host_primitive": dict(CAP["pins"] if capsule is None else capsule),
         "caller_identity": dict(caller_identity() if caller is None else caller), "control_operations": list(control),
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


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    out = r.stdout.strip()
    try: js = json.loads(out.split("\n#")[0])
    except ValueError: js = {"ok": False, "raw": (r.stdout + r.stderr)[-400:]}
    return r.returncode, js, r.stdout + r.stderr


class Profile:
    """An ACCEPTED grant compiled to a LIVE policy and sealed into an isolated one-library session profile, using the real tools."""
    def __init__(self, library, projects, src=None, resolve_binary=None, cfg=None, port=1144, root=None, capsule=None, mask=None):
        self.d = tmpdir("chain-")
        self.cap = capsule or CAP
        self.src = src if src is not None else record(library, projects, capsule=self.cap["pins"])
        self.src_path = os.path.join(self.d, "authority.json")
        open(self.src_path, "wb").write(json.dumps(self.src, indent=1).encode())
        self.pol_path = os.path.join(self.d, "policy.json")
        rc, js, raw = run([sys.executable, "-B", COMPILER, self.src_path, self.pol_path, "--worker", WORKER_PATH,
                           "--host-boundary", self.cap["boundary_path"]])
        if rc != 0: raise comp.PolicyError(js.get("message") or raw)
        self.pol_sha = rw.sha(open(self.pol_path, "rb").read())
        self.binary = resolve_binary or self.cap["binary"]
        self.cfg = cfg or source_config()
        self.root = root or os.path.join(self.d, "profile")
        self.session_path = os.path.join(self.d, "session-profile.json")
        self.port = port
        self.mask = list(mask if mask is not None else self.cap["mask"])
        mask_args = [a for m in self.mask for a in ("--evidence-mask", m)]
        rc, js, raw = run([sys.executable, "-B", GENERATOR, "--authority", self.src_path, "--policy", self.pol_path,
                           "--worker", WORKER_PATH, "--source-config", self.cfg, "--profile-root", self.root,
                           "--out", self.session_path, "--resolve-binary", self.binary, "--script-server-port", str(port),
                           "--host-boundary", self.cap["boundary_path"]] + mask_args)
        if rc != 0: raise gen.GenerateError(js.get("message") or raw)
        self.gen_out = js
        self.session_sha = rw.sha(open(self.session_path, "rb").read())
        self.manifest = json.load(open(self.session_path))
        self.gov, self.prov = self.manifest["governed"], self.manifest["provenance"]
        self.att_path = os.path.join(self.d, "runtime-attestation.json")
        self.attest()

    def attest(self, probe=None, nonce=NONCE, **over):
        """The record the launcher writes. Built here with the same fields so the refusal paths can be driven deterministically; the
        REAL launcher is exercised end to end, against real /proc facts, by the Launcher suite."""
        p = probe or FakeProbe(self)
        body = {"schema": rw.ATTESTATION_SCHEMA, "launcher_version": "test", "session_id": self.gov["session_id"],
                "profile_sha256": self.session_sha, "policy_sha256": self.pol_sha, "authority_sha256": self.gov["authority_sha256"],
                "worker_sha256": WSHA, "facade_commit": FACADE_COMMIT, "profile_root": self.prov["profile_root"],
                "profile_root_dev": self.prov["profile_root_dev"], "profile_root_ino": self.prov["profile_root_ino"],
                "script_server_port": self.gov["script_server_port"], "nonce_sha256": rw.sha(nonce.encode()),
                "executable": {k: self.gov["resolve_binary"][k] for k in ("realpath", "sha256", "bytes")},
                "launcher_pid": 4000, "spawn_pid": 4001, "resolve_pid": p.resolve_pids[0] if p.resolve_pids else 9001,
                "resolve_start_ticks": p.start_ticks(0), "boot_time": p.boot_time(),
                "clock_ticks_per_second": HZ, "created_epoch": self.prov["seal_epoch"] + 1,
                "profile_seal_epoch": self.prov["seal_epoch"],
                "execution_environment": self.gov["execution_environment"], "host_primitive": dict(self.gov["host_primitive"]),
                "capsule_uid": self.gov["host_primitive"]["capsule_uid"], "user_ns": NS["user"], "pid_ns": NS["pid"],
                "net_ns": NS["net"], "worker_mnt_ns": NS["worker_mnt"], "resolve_mnt_ns": NS["resolve_mnt"],
                "resolve_no_new_privs": 1, "resolve_seccomp": 2, "resolve_seccomp_filters": 1,
                "seccomp_filter_sha256": self.gov["confinement"]["seccomp_filter_sha256"],
                "evidence_mask": sorted(self.gov["evidence_mask"])}
        body.update(over)
        body["attestation_sha256"] = gen.canonical_sha256({k: v for k, v in body.items() if k != "attestation_sha256"})
        open(self.att_path, "w").write(json.dumps(body, sort_keys=True, separators=(",", ":")))
        self.att = body; self.att_sha = rw.sha(open(self.att_path, "rb").read())
        return body

    def reseal_attestation(self): self.att_sha = rw.sha(open(self.att_path, "rb").read())


class FakeProbe(rw.SystemProbe):
    """Deterministic /proc facts. Only the process-fact methods are faked; file identity and hashing still come from the real
    filesystem. Environment entries are an ORDERED LIST, exactly as /proc/<pid>/environ delivers them."""
    def __init__(self, profile, start_after=60, uid=None, boot=None, resolve_pids=(9001,), listener_pid=9002,
                 env_entries=None, exe=None, listener_parent=None, nonce=NONCE, extra_env=(), owners=None,
                 unattributed=(), tables=True, unstable=False, secret_path=None, secret_uid=OPERATOR_UID,
                 secret_writable=False, ns=None, status=None, mask=None, readonly=None, worker_mask=()):
        self.profile = profile
        self._uid = profile.gov["host_primitive"]["capsule_uid"] if uid is None else uid
        self.hp = profile.gov["host_primitive"]
        self.secret_path, self.secret_uid, self.secret_writable = secret_path, secret_uid, secret_writable
        self._ns = dict(ns or {})
        self._status = dict(status if status is not None else {"NoNewPrivs": 1, "Seccomp": 2, "Seccomp_filters": 1,
                                                               "CapBnd": 0, "CapEff": 0, "CapPrm": 0, "CapInh": 0, "CapAmb": 0})
        self.mask = list(profile.gov["evidence_mask"] if mask is None else mask)
        self.worker_mask = list(worker_mask)
        self.readonly = list(readonly if readonly is not None else [profile.gov["library"]["canonical_root"], self.hp["runtime_root"]])
        self._boot = profile.prov["seal_boot_time"] if boot is None else boot
        self.resolve_pids = list(resolve_pids); self.listener_pid = listener_pid
        self._exe = exe or profile.gov["resolve_binary"]["realpath"]
        self.start_uptime = profile.prov["seal_uptime"] + start_after      # same monotonic clock as the seal
        self.port = profile.gov["script_server_port"]
        base = [(v, os.path.join(profile.prov["profile_root"], rel)) for v, rel in sorted(profile.gov["profile_env"].items())]
        base.append((rw.NONCE_ENV_KEY, nonce))
        self._entries = list(env_entries) if env_entries is not None else base + list(extra_env)
        self._listener_parent = listener_parent if listener_parent is not None else (self.resolve_pids[0] if self.resolve_pids else 1)
        self.owners = dict(owners) if owners is not None else ({"111": {listener_pid}} if listener_pid else {})
        self.unattributed = set(unattributed); self.tables = tables; self.unstable = unstable; self._calls = 0
        self.gone = False                       # set by the governed-stop tests: after SIGKILL the process facts disappear
    def uid(self): return self._uid
    def account(self, name):
        return {"uid": self.hp["capsule_uid"], "gid": self.hp["capsule_gid"], "shell": "/usr/sbin/nologin"} if name == self.hp["capsule_account"] else None
    def stat_file(self, path):
        """Real file identity, with two facts the running machine cannot supply for a SYNTHETIC capsule: the frozen runtime and the
        broker are root-owned, and the shared HMAC key belongs to the operator account rather than to this test user."""
        st = super().stat_file(path)
        if st and (path == self.hp["broker_path"] or path.startswith(self.hp["runtime_root"])): st["uid"] = 0
        if st and self.secret_path and os.path.abspath(path) == os.path.abspath(self.secret_path): st["uid"] = self.secret_uid
        return st
    def writable(self, path):
        if self.secret_path and os.path.abspath(path) == os.path.abspath(self.secret_path): return self.secret_writable
        return super().writable(path)
    def ns(self, pid, kind):
        if kind in self._ns: return self._ns[kind]
        if kind == "mnt": return NS["resolve_mnt"] if pid in self.resolve_pids else NS["worker_mnt"]
        return NS.get(kind)
    def status_fields(self, pid):
        return dict(self._status) if pid in self.resolve_pids else {"NoNewPrivs": 0, "Seccomp": 0, "CapBnd": 0, "CapEff": 0}
    def mountinfo(self, pid):
        rows = [{"mount_point": "/", "options": "rw,relatime", "fstype": "ext4", "source": "/dev/root", "super_options": "rw"}]
        for ro in self.readonly:
            rows.append({"mount_point": ro, "options": "ro,relatime", "fstype": "ext4", "source": "/dev/root", "super_options": "ro"})
        masked = self.mask if pid in self.resolve_pids else self.worker_mask
        for m in masked:
            rows.append({"mount_point": m, "options": "ro,nosuid,nodev,noexec,relatime", "fstype": "tmpfs", "source": "tmpfs", "super_options": "ro,size=0k"})
        return rows
    def statvfs_flag(self, path):
        return rw.ST_RDONLY if any(path == r or path.startswith(r.rstrip("/") + "/") for r in self.readonly) else 0
    def boot_time(self): return self._boot
    def pids(self): return sorted(set(self.resolve_pids + ([self.listener_pid] if self.listener_pid else []) + [1]))
    def exe(self, pid): return self._exe if pid in self.resolve_pids else ("/usr/bin/other" if pid != 1 else "/sbin/init")
    def proc_uid(self, pid): return self._uid
    def ppid(self, pid): return self._listener_parent if pid == self.listener_pid else (0 if pid == 1 else 1)
    def start_ticks(self, pid=None): return None if self.gone else int(self.start_uptime * HZ)
    def environ_entries(self, pid): return list(self._entries) if pid in self.resolve_pids else []
    def listen_inodes(self, port):
        if not self.tables: return None
        if port != self.port: return set()
        self._calls += 1
        base = set(self.owners) | self.unattributed
        return base | {"999"} if (self.unstable and self._calls % 2 == 0) else base
    def socket_inode_owners(self, inodes):
        return {i: set(p) for i, p in self.owners.items() if i in inodes}, [7777]


class Env:
    """Real candidate worker over the frozen client: accepted chain + sealed profile + runtime attestation + injected fake Resolve."""
    def __init__(self, st, profile, probe=None, mode="PRODUCTION_READ", require_library=None, session_sha=None, api=None, att_sha=None,
                 wstate=None, evidence_final=None):
        self.d = tmpdir("env-"); self.profile = profile
        self.state_path = os.path.join(self.d, "state.json"); self.set_state(st)
        os.environ["VRC_FAKE_STATE"] = self.state_path
        self.cfg = os.path.join(self.d, "resolve-configs"); os.makedirs(self.cfg)
        open(os.path.join(self.cfg, ".dblist"), "w").write("Qual:/tmp/qual::::DISK\n")
        open(os.path.join(self.cfg, "config.dat"), "wb").write(b"xx System.Scripting.Mode = 1 yy")
        self._orig = rw.resolve_config_dir; rw.resolve_config_dir = lambda: self.cfg
        self.probe = probe or FakeProbe(profile)
        self.secret = SECRET; self.sf = os.path.join(self.d, "secret")
        open(self.sf, "wb").write(self.secret); os.chmod(self.sf, 0o640)
        self.probe.secret_path = getattr(self.probe, "secret_path", None) or self.sf   # the key the worker must find operator-owned
        self.port = free_port(); self.wstate = wstate or os.path.join(self.d, "wstate")
        self.evidence_final = evidence_final
        prod = mode == "PRODUCTION_READ"
        try:
            self.worker = rw.Worker(HOST, self.secret, self.wstate, api or fake_resolve, require_library, mode,
                                    profile.pol_path if prod else None, profile.pol_sha if prod else None,
                                    profile.src_path if prod else None, profile.session_path if prod else None,
                                    (session_sha or profile.session_sha) if prod else None,
                                    profile.att_path if prod else None, (att_sha or profile.att_sha) if prod else None, self.probe,
                                    self.sf if prod else None, profile.gov["host_primitive"] if prod else None, evidence_final)
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
    def private_profile(self, projects=(P_A1, P_A2), spawnable=False, **kw):
        """A profile sealed against its OWN synthetic capsule — for the tests that deliberately mutate or delete the sealed executable.
        The approved runtime is root-owned and immutable to this suite, which is the point of freezing it; the law still has to be
        proved somewhere the suite can actually break it."""
        cap = synthetic_capsule(spawnable=spawnable)
        return Profile(self.lib(), list(projects), capsule=cap, mask=cap["mask"], **kw)
    def st(self, puuid=P_A1, **kw): return state(self.name, puuid, project_list=["Prod Project", "Second"], **kw)


class Authority(unittest.TestCase):
    """The compiler is the only door to a LIVE policy, and v1 is structurally vidnux/Linux/one-Disk-library/ISOLATED_DISK_SESSION."""
    def setUp(self): self.fx = Fixture()
    def c(self, src, preview=False): return comp.compile_record(json.dumps(src).encode(), WSHA, preview=preview, boundary=CAP["pins"])

    def test_accepted_record_compiles_to_a_deterministic_live_policy(self):
        src = record(self.fx.lib(), [P_A1, P_A2])
        pol = self.c(src)
        self.assertTrue(pol["live"]); self.assertEqual(pol["authority_status"], "ACCEPTED")
        self.assertEqual(pol["worker_sha256"], WSHA); self.assertEqual(pol["facade_commit"], FACADE_COMMIT)
        self.assertEqual(pol["host_id"], "vidnux"); self.assertEqual(pol["platform"], "Linux")
        self.assertEqual(pol["session_profile_type"], "ISOLATED_DISK_SESSION")
        self.assertEqual(pol["projects"], sorted([P_A1, P_A2])); self.assertEqual(pol["library"], self.fx.lib())
        self.assertEqual(self.c(src), self.c(src))

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
        with self.assertRaises(comp.PolicyError): self.c(record(self.fx.lib(), [P_A1]), preview=True)

    def test_unscoped_candidate_is_valid_but_never_live_and_accepted_must_be_scoped(self):
        unscoped = record(None, [], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None, approved_at=None, acceptance=None)
        pv = self.c(unscoped, preview=True); self.assertFalse(pv["live"]); self.assertIsNone(pv["library"])
        with self.assertRaises(comp.PolicyError): self.c(unscoped)
        for bad in (record(None, [P_A1]), record(self.fx.lib(), []), record(None, [])):
            with self.assertRaises(comp.PolicyError): self.c(bad)

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
        comp.validate_schema(src)
        self.assertEqual(src["status"], "CANDIDATE_FOR_INDEPENDENT_REVIEW"); self.assertIsNone(src["approved_by"])
        self.assertIsNone(src["library"]); self.assertEqual(src["projects"], [])
        self.assertEqual(src["worker_identity"]["worker_sha256"], WSHA, "the shipped record must pin THESE candidate bytes")
        with self.assertRaises(comp.PolicyError): comp.compile_record(raw, WSHA)
        pv = comp.compile_record(raw, WSHA, preview=True)
        self.assertFalse(pv["live"]); self.assertIsNone(pv["library"]); self.assertEqual(pv["projects"], [])

    def test_compiler_cli_writes_canonical_bytes_and_refuses_on_stdout(self):
        d = tmpdir("cli-"); sp = os.path.join(d, "a.json"); op = os.path.join(d, "p.json")
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1])))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, op, "--worker", WORKER_PATH, "--host-boundary", CAP["boundary_path"]])
        self.assertEqual(rc, 0); self.assertTrue(js["live"])
        self.assertEqual(open(op, "rb").read(), comp.canon(json.load(open(op))))
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1], status="REJECTED")))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, os.path.join(d, "p2.json"), "--worker", WORKER_PATH, "--host-boundary", CAP["boundary_path"]])
        self.assertEqual(rc, 2); self.assertEqual(js["error"], "POLICY_REJECTED")
        self.assertFalse(os.path.exists(os.path.join(d, "p2.json")))


class SessionProfile(unittest.TestCase):
    """The generator turns an accepted grant into a sealed directory that can host exactly one Project Library — and nothing else."""
    def setUp(self): self.fx = Fixture()

    def test_generated_profile_registers_exactly_one_disk_library_and_seals_its_exact_tree(self):
        p = self.fx.profile()
        reg = open(os.path.join(p.prov["profile_root"], "config", ".dblist")).read().splitlines()
        self.assertEqual(reg, [f"{self.fx.name}:{os.path.realpath(self.fx.A)}::::DISK"])
        self.assertEqual(open(os.path.join(p.prov["profile_root"], "config", ".activedb")).read(), f"disk*:{self.fx.name}\n")
        self.assertEqual(sorted(p.gov["tree"]), ["config/.activedb", "config/.dblist", "config/config.dat"])
        self.assertEqual(sorted(p.gov["dirs"]), ["cache", "config", "logs", "support"])
        self.assertEqual(p.gov["constrained"], ["config/.activedb"])
        self.assertEqual(p.gov["library"], self.fx.lib()); self.assertEqual(p.gov["projects"], sorted([P_A1, P_A2]))
        self.assertEqual(p.manifest["governed_sha256"], gen.canonical_sha256(p.gov))
        self.assertEqual(p.prov["profile_root_ino"], os.stat(p.prov["profile_root"]).st_ino)
        self.assertEqual(sorted(p.gov["profile_env"]), ["BMD_RESOLVE_CONFIG_DIR", "BMD_RESOLVE_LOGS_DIR", "BMD_RESOLVE_SUPPORT_DIR", "XDG_CACHE_HOME"])
        self.assertNotIn(rw.NONCE_ENV_KEY, p.gov["profile_env"])

    def test_operator_library_list_and_history_are_never_copied_and_the_source_is_untouched(self):
        cfg = source_config()
        before = {n: rw.sha(open(os.path.join(cfg, n), "rb").read()) for n in sorted(os.listdir(cfg))}
        p = self.fx.profile(cfg=cfg)
        after = {n: rw.sha(open(os.path.join(cfg, n), "rb").read()) for n in sorted(os.listdir(cfg))}
        self.assertEqual(before, after, "the operator configuration directory must never be written to")
        blob = b"".join(open(os.path.join(p.prov["profile_root"], rel), "rb").read() for rel in p.gov["tree"])
        for forbidden in (b"EKA", b"Local Database", b"Other Disk", b"secret production project", b"192.168.50.199"):
            self.assertNotIn(forbidden, blob, f"{forbidden!r} leaked into the isolated profile")

    def test_governed_block_is_deterministic_across_regeneration(self):
        p1 = self.fx.profile()
        p2 = Profile(self.fx.lib(), [P_A1, P_A2], src=p1.src, cfg=p1.cfg)
        self.assertEqual(p1.manifest["governed_sha256"], p2.manifest["governed_sha256"])
        self.assertEqual(p1.gov["session_id"], p2.gov["session_id"])
        self.assertNotEqual(p1.prov["profile_root"], p2.prov["profile_root"])

    def test_generator_refuses_unaccepted_grants_drifted_roots_and_disabled_scripting(self):
        with self.assertRaises(comp.PolicyError):
            Profile(self.fx.lib(), [P_A1], src=record(self.fx.lib(), [P_A1], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None))
        with self.assertRaises(gen.GenerateError):
            Profile(dict(self.fx.lib(), physical_ino=self.fx.lib()["physical_ino"] + 1), [P_A1])
        with self.assertRaises(gen.GenerateError):
            Profile(dict(self.fx.lib(), canonical_root="/nonexistent/library/root"), [P_A1])
        with self.assertRaises(gen.GenerateError):
            self.fx.profile(cfg=source_config(scripting=0))
        alias = os.path.join(tmpdir("alias-"), "linkA"); os.symlink(self.fx.A, alias)
        with self.assertRaises(gen.GenerateError):
            Profile(dict(self.fx.lib(), canonical_root=alias), [P_A1])

    def test_profile_root_must_be_absolute_canonical_and_never_contain_its_own_manifest(self):
        p = self.fx.profile()
        base = tmpdir("roots-")
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", "relative-profile",
                         "--out", os.path.join(base, "s.json"), "--resolve-binary", p.binary,
                         "--host-boundary", p.cap["boundary_path"]] + MASK(p), cwd=base)
        self.assertEqual(rc, 2, "a relative --profile-root must be refused, not silently made absolute")
        self.assertIn("absolute", js["message"])
        real = os.path.join(base, "real"); link = os.path.join(base, "link"); os.mkdir(real); os.symlink(real, link)
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", link,
                         "--out", os.path.join(real, "inside.json"), "--resolve-binary", p.binary,
                         "--host-boundary", p.cap["boundary_path"]] + MASK(p))
        self.assertEqual(rc, 2, "a symlinked profile root must be refused")
        self.assertFalse(os.path.exists(os.path.join(real, "inside.json")))
        root2 = os.path.join(base, "p2")
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", root2,
                         "--out", os.path.join(root2, "inside.json"), "--resolve-binary", p.binary,
                         "--host-boundary", p.cap["boundary_path"]] + MASK(p))
        self.assertEqual(rc, 2); self.assertIn("outside", js["message"])
        rc, js, _ = run([sys.executable, "-B", GENERATOR, "--authority", p.src_path, "--policy", p.pol_path, "--worker", WORKER_PATH,
                         "--source-config", p.cfg, "--profile-root", p.prov["profile_root"],
                         "--out", os.path.join(base, "again.json"), "--resolve-binary", p.binary,
                         "--host-boundary", p.cap["boundary_path"]] + MASK(p))
        self.assertEqual(rc, 2); self.assertIn("not empty", js["message"])

    def test_generated_profile_and_attestation_match_their_schemas(self):
        p = self.fx.profile()
        schema = json.load(open(os.path.join(ROOT, "schemas", "resolveProductionReadSessionProfile.v1.schema.json")))
        self.assertEqual(p.manifest["schema"], schema["title"])
        self.assertEqual(sorted(p.gov), sorted(schema["properties"]["governed"]["required"]))
        self.assertEqual(sorted(p.prov), sorted(schema["properties"]["provenance"]["required"]))
        att_schema = json.load(open(os.path.join(ROOT, "schemas", "resolveProductionReadRuntimeAttestation.v1.schema.json")))
        self.assertEqual(p.att["schema"], att_schema["title"])
        self.assertEqual(sorted(p.att), sorted(att_schema["required"]))


class Attest(unittest.TestCase):
    """Base for the attestation suites: one fixture, one sealed profile, one attestation, and a refusal helper."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.profile()
    def attest(self, probe, **kw): return rw.attest_isolated_session(probe, self.p.gov, self.p.prov, kw.pop("att", self.p.att), **kw)
    def refuse(self, probe, reason, **kw):
        try: self.attest(probe, **kw)
        except rw.OpError as e:
            self.assertEqual(e.code, "LIBRARY_MISMATCH", "candidate must emit only frozen error codes")
            self.assertEqual(e.detail["reason"], reason, e.detail); return e
        raise AssertionError(f"attestation unexpectedly succeeded (expected {reason})")


class Environment(Attest):
    """ISOR-F01. /proc/<pid>/environ is an ORDERED list that may repeat a key; glibc getenv() takes the FIRST, a dict keeps the LAST.
    Any duplicate of a security-relevant key is AMBIGUOUS and must deny — the predecessor collapsed them and leaked cloned-B data."""
    def entries(self, **over):
        base = [(v, os.path.join(self.p.prov["profile_root"], rel)) for v, rel in sorted(self.p.gov["profile_env"].items())]
        base.append((rw.NONCE_ENV_KEY, NONCE))
        return [(k, over.get(k, v)) for k, v in base]

    def test_the_raw_parser_preserves_order_and_duplicates(self):
        probe = rw.SystemProbe()
        path = os.path.join(tmpdir("env-"), "environ")
        open(path, "wb").write(b"BMD_RESOLVE_CONFIG_DIR=/unauthorized\0BMD_RESOLVE_CONFIG_DIR=/sealed\0X=1\0")
        real_open = open
        probe.environ_entries = lambda pid: [(k.decode(), v.decode()) for k, _, v in
                                             (i.partition(b"=") for i in real_open(path, "rb").read().split(b"\0") if b"=" in i)]
        self.assertEqual(probe.environ_entries(1), [("BMD_RESOLVE_CONFIG_DIR", "/unauthorized"), ("BMD_RESOLVE_CONFIG_DIR", "/sealed"), ("X", "1")])
        self.assertFalse(hasattr(rw.SystemProbe, "environ"), "the collapsing dict parser must not exist any more")

    def test_duplicate_protected_keys_refuse_in_both_orders(self):
        sealed = {v: os.path.join(self.p.prov["profile_root"], rel) for v, rel in self.p.gov["profile_env"].items()}
        for var in sorted(sealed):
            with self.subTest(var=var):
                unauthorized = "/tmp/unauthorized-clone-b/" + var.lower()
                first_bad = [(var, unauthorized)] + self.entries()                      # glibc reads the malicious first entry
                self.refuse(FakeProbe(self.p, env_entries=first_bad), "SESSION_ENV_AMBIGUOUS")
                last_bad = self.entries() + [(var, unauthorized)]                       # a dict parser would read the malicious last entry
                self.refuse(FakeProbe(self.p, env_entries=last_bad), "SESSION_ENV_AMBIGUOUS")
                twice_correct = self.entries() + [(var, sealed[var])]                   # ambiguity itself is invalid, even when identical
                self.refuse(FakeProbe(self.p, env_entries=twice_correct), "SESSION_ENV_AMBIGUOUS")

    def test_a_duplicate_session_nonce_refuses(self):
        self.refuse(FakeProbe(self.p, env_entries=self.entries() + [(rw.NONCE_ENV_KEY, NONCE)]), "SESSION_ENV_AMBIGUOUS")
        self.refuse(FakeProbe(self.p, env_entries=[(rw.NONCE_ENV_KEY, "b" * 64)] + self.entries()), "SESSION_ENV_AMBIGUOUS")

    def test_missing_or_empty_protected_keys_refuse(self):
        for var in sorted(self.p.gov["profile_env"]):
            missing = [(k, v) for k, v in self.entries() if k != var]
            self.refuse(FakeProbe(self.p, env_entries=missing), "SESSION_ENV_MISSING")
            self.refuse(FakeProbe(self.p, env_entries=self.entries(**{var: ""})), "SESSION_PROFILE_MISMATCH")
        self.refuse(FakeProbe(self.p, env_entries=[(k, v) for k, v in self.entries() if k != rw.NONCE_ENV_KEY]), "SESSION_ENV_MISSING")
        self.refuse(FakeProbe(self.p, env_entries=[]), "SESSION_PROCESS_UNREADABLE")

    def test_a_wrong_profile_value_refuses_and_unrelated_duplicates_are_tolerated(self):
        for var in sorted(self.p.gov["profile_env"]):
            self.refuse(FakeProbe(self.p, env_entries=self.entries(**{var: "/home/op/.local/share/DaVinciResolve"})), "SESSION_PROFILE_MISMATCH")
        ok = FakeProbe(self.p, extra_env=[("LANG", "en_US.UTF-8"), ("LANG", "C"), ("TERM", "xterm")])   # not security-relevant
        self.assertEqual(self.attest(ok)["pid"], 9001)


class ProfileTree(Attest):
    """ISOR-F05 / ISOR-F04. The seal describes the profile EXACTLY; only a bounded runtime allowlist may appear afterwards."""
    def root(self, *parts): return os.path.join(self.p.prov["profile_root"], *parts)
    def refuse_tree(self, reason):
        try: rw.verify_profile_tree(self.p.prov, self.p.gov)
        except rw.OpError as e:
            self.assertEqual(e.detail["reason"], reason, e.detail); return e
        raise AssertionError(f"profile verification unexpectedly passed (expected {reason})")

    def test_a_freshly_sealed_profile_verifies(self):
        self.assertTrue(rw.verify_profile_tree(self.p.prov, self.p.gov).endswith(".dblist"))
        self.assertEqual(rw.verify_profile_root(self.p.prov)["realpath"], self.p.prov["profile_root"])

    def test_any_unsealed_authority_relevant_addition_refuses(self):
        for name, make in (("extra registration", lambda: open(self.root("config", "dblist.conf"), "w").write("X:/srv/x:*:::DISK\n")),
                           ("second dblist", lambda: open(self.root("config", ".dblist.2"), "w").write("Y:/srv/y::::DISK\n")),
                           ("hidden discovery file", lambda: open(self.root("config", ".dbcache"), "w").write("z\n")),
                           ("extra config file", lambda: open(self.root("config", "unexpected-runtime-state"), "w").write("unsealed\n")),
                           ("config-like directory", lambda: os.makedirs(self.root("config", "configs"))),
                           ("top-level stray", lambda: open(self.root("stray.txt"), "w").write("x"))):
            with self.subTest(name):
                self.fx = Fixture(); self.p = self.fx.profile()
                make(); self.refuse_tree("SESSION_PROFILE_EXTRANEOUS")

    def test_symlinks_are_refused_anywhere_in_the_profile(self):
        os.symlink("/etc", self.root("config", "elsewhere"))
        self.refuse_tree("SESSION_PROFILE_SYMLINK")
        self.fx = Fixture(); self.p = self.fx.profile()
        os.symlink("/etc/hostname", self.root("config", "linked.dat"))
        self.refuse_tree("SESSION_PROFILE_SYMLINK")

    def test_replacing_or_removing_a_sealed_member_refuses(self):
        open(self.root("config", "config.dat"), "a").write("System.Scripting.Mode = 0\n")
        self.refuse_tree("SESSION_PROFILE_MUTATED")
        self.fx = Fixture(); self.p = self.fx.profile()
        os.remove(self.root("config", ".dblist")); self.refuse_tree("SESSION_PROFILE_MUTATED")
        self.fx = Fixture(); self.p = self.fx.profile()
        os.rmdir(self.root("logs")); self.refuse_tree("SESSION_PROFILE_MUTATED")

    def test_an_extra_library_registration_refuses(self):
        open(self.root("config", ".dblist"), "a").write("Other Disk:/srv/other::::DISK\n")
        self.refuse_tree("SESSION_PROFILE_MUTATED")

    def test_runtime_volatile_state_is_allowed_but_bounded(self):
        os.makedirs(self.root("logs", "rolling")); open(self.root("logs", "rolling", "resolve.log"), "w").write("runtime\n")
        open(self.root("cache", "shader.bin"), "wb").write(b"\0" * 32)
        open(self.root("config", ".recentprojects"), "w").write("Prod Project\n")
        open(self.root("config", "UI.preset"), "w").write("<ui/>\n")
        os.makedirs(self.root("config", ".update")); open(self.root("config", ".update", "state"), "w").write("x")
        rw.verify_profile_tree(self.p.prov, self.p.gov)                      # all of this is legitimate Resolve runtime state
        self.assertNotIn("config/**", self.p.gov["volatile_patterns"], "the registration area may never be wildcarded")
        for pat in self.p.gov["volatile_patterns"]: self.assertNotIn(pat, ("*", "**", "/**"))

    def test_the_active_database_pointer_stays_bound_to_the_one_library(self):
        open(self.root("config", ".activedb"), "w").write(f'disk:{self.fx.name}\n')       # a rewrite Resolve may legitimately do
        rw.verify_profile_tree(self.p.prov, self.p.gov)
        open(self.root("config", ".activedb"), "w").write(f'disk*:{self.fx.name}\nnetwork:EKA192.168.50.199\n')
        self.refuse_tree("SESSION_PROFILE_MUTATED")
        open(self.root("config", ".activedb"), "w").write(f'disk*:{self.fx.bname}\n')
        self.refuse_tree("SESSION_PROFILE_MUTATED")

    def test_the_profile_root_itself_is_pinned(self):
        root = self.p.prov["profile_root"]; moved = root + "-moved"
        os.rename(root, moved); os.makedirs(root)                                          # same path, different physical directory
        try:
            with self.assertRaises(rw.OpError) as cm: rw.verify_profile_root(self.p.prov)
            self.assertEqual(cm.exception.detail["reason"], "SESSION_ROOT_IDENTITY_MISMATCH")
        finally:
            os.rmdir(root); os.rename(moved, root)
        rw.verify_profile_root(self.p.prov)
        os.rename(root, moved)
        try:
            with self.assertRaises(rw.OpError) as cm: rw.verify_profile_root(self.p.prov)
            self.assertEqual(cm.exception.detail["reason"], "LIBRARY_IDENTITY_UNAVAILABLE")
        finally: os.rename(moved, root)


class ProcessOrdering(Attest):
    """ISOR-F03. The profile must be sealed strictly BEFORE the process starts, and the session nonce proves it independently of the
    one-second resolution of the seal instant."""
    def test_a_launcher_created_session_attests(self):
        ident = self.attest(FakeProbe(self.p))
        self.assertEqual(ident["pid"], 9001); self.assertEqual(ident["endpoint_owner_pids"], [9002])
        self.assertGreater(ident["start_ticks"] / HZ, self.p.prov["seal_uptime"])
        self.assertEqual(ident["nonce_id"], rw.sha(NONCE.encode())[:16])

    def test_a_process_that_predates_or_equals_the_seal_is_refused(self):
        for label, after in (("a second before", -1.0), ("a day before", -86400.0), ("the same instant", 0.0), ("10 ms before", -0.01)):
            with self.subTest(label):
                probe = FakeProbe(self.p, start_after=after)
                self.p.attest(probe=probe)                                        # even a launcher record forged for that process
                self.refuse(probe, "SESSION_PREDATES_PROFILE")
        self.p.attest()
        self.assertGreater(FakeProbe(self.p).start_ticks() / HZ, self.p.prov["seal_uptime"])

    def test_a_process_the_launcher_did_not_create_is_refused(self):
        probe = FakeProbe(self.p, resolve_pids=(9100,), listener_parent=9100)
        self.refuse(probe, "SESSION_NOT_ATTESTED")                                # pid differs from the attested one
        probe = FakeProbe(self.p, nonce="c" * 64)
        self.refuse(probe, "SESSION_NONCE_MISMATCH")                              # right pid, wrong/copied nonce
        stale = FakeProbe(self.p); self.p.attest(probe=stale, resolve_start_ticks=stale.start_ticks() + 10)
        self.refuse(stale, "SESSION_RESTARTED")                                   # pid reused, different start instant
        self.p.attest()

    def test_an_edited_or_foreign_attestation_is_refused(self):
        def load(**over):
            body = dict(self.p.att); body.update(over)
            body["attestation_sha256"] = gen.canonical_sha256({k: v for k, v in body.items() if k != "attestation_sha256"})
            path = os.path.join(self.p.d, "att-variant.json"); open(path, "w").write(json.dumps(body, sort_keys=True, separators=(",", ":")))
            return path, rw.sha(open(path, "rb").read())
        for name, over, reason in (("another session", {"session_id": "f" * 32}, "SESSION_PROFILE_MISMATCH"),
                                   ("another policy", {"policy_sha256": "0" * 64}, "SESSION_PROFILE_MISMATCH"),
                                   ("another authority", {"authority_sha256": "0" * 64}, "SESSION_PROFILE_MISMATCH"),
                                   ("another worker", {"worker_sha256": "0" * 64}, "WORKER_IDENTITY_MISMATCH"),
                                   ("another facade", {"facade_commit": "a" * 40}, "FACADE_IDENTITY_MISMATCH"),
                                   ("another root", {"profile_root_ino": 1}, "SESSION_ROOT_IDENTITY_MISMATCH"),
                                   ("another port", {"script_server_port": 9999}, "RUNTIME_ATTESTATION_INVALID"),
                                   ("another executable", {"executable": {"realpath": "/bin/true", "sha256": "0" * 64, "bytes": 1}}, "SESSION_EXECUTABLE_MISMATCH"),
                                   ("no nonce digest", {"nonce_sha256": "not-a-digest"}, "RUNTIME_ATTESTATION_INVALID"),
                                   ("created before the seal", {"created_epoch": self.p.prov["seal_epoch"] - 5}, "RUNTIME_ATTESTATION_INVALID")):
            with self.subTest(name):
                path, sha256 = load(**over)
                with self.assertRaises(rw.OpError) as cm:
                    rw.load_runtime_attestation(path, sha256, self.p.gov, self.p.prov, self.p.session_sha, self.p.pol_sha, self.p.gov["authority_sha256"], WSHA)
                self.assertEqual(cm.exception.detail["reason"], reason)
        path, _ = load()
        with self.assertRaises(rw.OpError) as cm:                                  # digest pin
            rw.load_runtime_attestation(path, "0" * 64, self.p.gov, self.p.prov, self.p.session_sha, self.p.pol_sha, self.p.gov["authority_sha256"], WSHA)
        self.assertEqual(cm.exception.detail["reason"], "RUNTIME_ATTESTATION_PIN_MISMATCH")
        body = dict(self.p.att); body["resolve_pid"] = 12345                        # body edited without re-deriving its digest
        path = os.path.join(self.p.d, "att-tampered.json"); open(path, "w").write(json.dumps(body, sort_keys=True, separators=(",", ":")))
        with self.assertRaises(rw.OpError) as cm:
            rw.load_runtime_attestation(path, rw.sha(open(path, "rb").read()), self.p.gov, self.p.prov, self.p.session_sha, self.p.pol_sha, self.p.gov["authority_sha256"], WSHA)
        self.assertEqual(cm.exception.detail["reason"], "RUNTIME_ATTESTATION_INVALID")

    def test_a_reboot_invalidates_the_attestation(self):
        self.refuse(FakeProbe(self.p, boot=self.p.prov["seal_boot_time"] + 100), "SESSION_NOT_ATTESTED")

    def test_zero_or_several_resolve_processes_refuse(self):
        self.refuse(FakeProbe(self.p, resolve_pids=()), "SESSION_NOT_RUNNING")
        self.refuse(FakeProbe(self.p, resolve_pids=(9001, 9005)), "SESSION_AMBIGUOUS")
        probe = FakeProbe(self.p); probe.proc_uid = lambda pid: 0
        self.refuse(probe, "SESSION_OWNER_MISMATCH")


class Executable(Attest):
    """ISOR-F06. Realpath, size AND sha256 — the digest is recomputed whenever the inode's identity, size, mtime or ctime changes.

    These tests edit and delete the sealed executable, so they get their OWN synthetic capsule: the approved runtime is root-owned and
    the suite could not mutate it even if it wanted to — which is the point of freezing it, and exactly why the law still has to be
    proved somewhere the suite can actually break it."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.private_profile(); self.cap = self.p.cap
    def test_a_same_size_byte_mutation_is_caught(self):
        path = self.p.gov["resolve_binary"]["realpath"]
        data = bytearray(open(path, "rb").read()); data[-1] ^= 1
        open(path, "wb").write(data)
        self.refuse(FakeProbe(self.p), "SESSION_EXECUTABLE_MISMATCH")

    def test_a_resized_or_missing_executable_is_caught(self):
        path = self.p.gov["resolve_binary"]["realpath"]
        open(path, "ab").write(b"\0" * 16)
        self.refuse(FakeProbe(self.p), "SESSION_EXECUTABLE_MISMATCH")
        os.remove(path)
        self.refuse(FakeProbe(self.p), "SESSION_EXECUTABLE_MISMATCH")

    def test_a_different_running_binary_is_not_this_session(self):
        self.refuse(FakeProbe(self.p, exe=fake_binary(size=8192)), "SESSION_NOT_RUNNING")

    def test_the_digest_cache_is_bounded_by_inode_size_and_timestamps(self):
        cache = {}
        probe = FakeProbe(self.p)
        rw.verify_executable(probe, self.p.gov, cache); self.assertEqual(len(cache), 1)
        calls = []
        real_hash = probe.hash_file
        probe.hash_file = lambda p: (calls.append(p), real_hash(p))[1]
        rw.verify_executable(probe, self.p.gov, cache); self.assertEqual(calls, [], "unchanged metadata must not re-hash")
        path = self.p.gov["resolve_binary"]["realpath"]
        data = bytearray(open(path, "rb").read()); data[0] ^= 0xFF; open(path, "wb").write(data)   # in-place edit bumps ctime
        with self.assertRaises(rw.OpError): rw.verify_executable(probe, self.p.gov, cache)
        self.assertEqual(len(calls), 1, "changed metadata must force a re-hash")


class Endpoint(Attest):
    """ISOR-F02. Every LISTEN socket on the scripting port must be attributable to the attested process tree; 'unknown' is a refusal."""
    def test_a_child_owned_endpoint_attests(self):
        self.assertEqual(self.attest(FakeProbe(self.p))["endpoint_owner_pids"], [9002])
        deep = FakeProbe(self.p, listener_pid=9100, owners={"111": {9100}})
        deep.ppid = lambda pid: {9100: 9050, 9050: 9001, 9001: 1, 1: 0}.get(pid, 1)
        self.assertEqual(self.attest(deep)["endpoint_owner_pids"], [9100])

    def test_an_unattributed_listener_refuses(self):
        self.refuse(FakeProbe(self.p, unattributed={"222"}), "SESSION_ENDPOINT_UNATTRIBUTED")
        self.refuse(FakeProbe(self.p, listener_pid=None, owners={}, unattributed={"222"}), "SESSION_ENDPOINT_UNATTRIBUTED")

    def test_an_unrelated_or_missing_owner_refuses(self):
        self.refuse(FakeProbe(self.p, listener_parent=1), "SESSION_HANDLE_UNBOUND")
        self.refuse(FakeProbe(self.p, owners={"111": {9002}, "112": {4321}}, listener_parent=9001), "SESSION_HANDLE_UNBOUND")
        self.refuse(FakeProbe(self.p, listener_pid=None, owners={}), "SESSION_HANDLE_UNBOUND")

    def test_an_unreadable_socket_table_is_unverifiable_not_empty(self):
        self.refuse(FakeProbe(self.p, tables=False), "SESSION_ENDPOINT_UNVERIFIABLE")

    def test_a_listener_set_that_keeps_changing_refuses(self):
        self.refuse(FakeProbe(self.p, unstable=True), "SESSION_ENDPOINT_UNSTABLE")

    def test_both_socket_tables_are_parsed(self):
        probe = rw.SystemProbe()
        d = tmpdir("net-")
        v4 = "  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n" \
             "   0: 0100007F:0478 00000000:0000 0A 0 0 0 0 0 111\n"
        v6 = "  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n" \
             "   0: 00000000000000000000000000000000:0478 00000000000000000000000000000000:0000 0A 0 0 0 0 0 222\n"
        open(os.path.join(d, "tcp"), "w").write(v4); open(os.path.join(d, "tcp6"), "w").write(v6)
        real_open = open
        probe_open = lambda p, *a, **k: real_open(os.path.join(d, os.path.basename(p)), *a, **k) if p.startswith("/proc/net/") else real_open(p, *a, **k)
        import builtins
        orig = builtins.open; builtins.open = probe_open
        try: inodes = probe.listen_inodes(0x478)
        finally: builtins.open = orig
        self.assertEqual(inodes, {"111", "222"}, "an IPv6 listener on the same port must be seen")


class Launcher(unittest.TestCase):
    """The ephemeral launcher, exercised END TO END against REAL /proc facts and a REAL listening child process: only the Resolve
    executable is stood in for (a copy of this interpreter), because no production Resolve may be started by a test."""
    def setUp(self):
        self.fx = Fixture(); self.port = free_port()
        self.p = self.fx.private_profile(spawnable=True, port=self.port)   # the "frozen runtime binary" is a copy of this interpreter
        self.cap = self.p.cap; self.binary = self.cap["binary"]
        self.children = []
    def tearDown(self):
        for c in self.children:
            try: c.kill(); c.wait(timeout=10)
            except Exception: pass

    def spawn(self, binary, env, cwd, confinement=None):
        self.confinement = confinement
        script = ("import socket,time\n"
                  "s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\n"
                  f"s.bind(('127.0.0.1',{self.port})); s.listen(5)\n"
                  "time.sleep(600)\n")
        c = subprocess.Popen([binary, "-c", script], env=env, cwd=cwd, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.children.append(c); return c

    def args(self, **over):
        a = {"authority": self.p.src_path, "policy": self.p.pol_path, "worker": WORKER_PATH, "session": self.p.session_path,
             "session_sha256": self.p.session_sha, "out": os.path.join(self.p.d, "runtime.json"), "timeout": 30, "poll": 0.1,
             "cwd": os.path.dirname(self.binary), "host_boundary": self.cap["boundary_path"]}
        a.update(over); return a

    def probe(self, **over):
        """The REAL probe — real /proc, real sockets — with only the facts a synthetic capsule cannot supply overridden: the capsule
        account's identity, the root ownership of the frozen runtime, and the confinement of a child this unprivileged test user is not
        allowed to create. The REAL confinement (mount namespace, mask, capabilities, seccomp) is proved for real, in a real kernel
        namespace, by tests/test_capsule_confinement.py."""
        cap, port_pid = self.cap, over.get("resolve_pid")
        class P(rw.SystemProbe):
            def uid(self): return cap["pins"]["capsule_uid"]
            def proc_uid(self, pid): return cap["pins"]["capsule_uid"]
            def account(self, name):
                return {"uid": cap["pins"]["capsule_uid"], "gid": cap["pins"]["capsule_gid"], "shell": "/usr/sbin/nologin"} if name == cap["pins"]["capsule_account"] else None
            def stat_file(self, path):
                st = super().stat_file(path)
                if st and (path == cap["pins"]["broker_path"] or path.startswith(cap["pins"]["runtime_root"])): st["uid"] = 0
                return st
            def ns(self, pid, kind):
                real = super().ns(pid, kind)
                if kind == "mnt" and pid != os.getpid(): return NS["resolve_mnt"]
                if kind == "mnt": return NS["worker_mnt"]
                return real
            def status_fields(self, pid):
                st = super().status_fields(pid) or {}
                if pid != os.getpid(): st.update({"NoNewPrivs": 1, "Seccomp": 2, "Seccomp_filters": 1, "CapBnd": 0, "CapEff": 0, "CapPrm": 0, "CapInh": 0, "CapAmb": 0})
                return st
            def mountinfo(self, pid):
                rows = [{"mount_point": "/", "options": "rw,relatime", "fstype": "ext4", "source": "/dev/root", "super_options": "rw"}]
                for ro in (self_p.gov["library"]["canonical_root"], cap["pins"]["runtime_root"]):
                    rows.append({"mount_point": ro, "options": "ro,relatime", "fstype": "ext4", "source": "/dev/root", "super_options": "ro"})
                if pid != os.getpid():
                    for m in self_p.gov["evidence_mask"]:
                        rows.append({"mount_point": m, "options": "ro,nosuid,nodev,noexec,relatime", "fstype": "tmpfs", "source": "tmpfs", "super_options": "ro"})
                return rows
            def statvfs_flag(self, path):
                return rw.ST_RDONLY if any(path == r or path.startswith(r.rstrip("/") + "/") for r in (self_p.gov["library"]["canonical_root"], cap["pins"]["runtime_root"])) else 0
        self_p = self.p
        return P()

    def test_the_launcher_creates_a_session_the_worker_attests(self):
        probe = self.probe()
        body, out, file_sha = launcher.launch(self.args(), spawn=self.spawn, probe=probe)
        self.assertEqual(self.confinement["evidence_mask"], self.p.gov["evidence_mask"], "the launcher must hand the sealed mask to the spawn")
        self.assertEqual(body["execution_environment"], "DEDICATED_CAPSULE_V1")
        self.assertEqual(body["host_primitive"], self.cap["pins"])
        self.assertEqual(body["capsule_uid"], self.cap["pins"]["capsule_uid"])
        self.assertNotEqual(body["resolve_mnt_ns"], body["worker_mnt_ns"])
        self.assertEqual(body["resolve_seccomp"], 2); self.assertEqual(body["resolve_no_new_privs"], 1)
        self.assertEqual(body["seccomp_filter_sha256"], SECCOMP_SHA)
        self.assertEqual(body["evidence_mask"], sorted(self.p.gov["evidence_mask"]))
        self.assertEqual(body["schema"], rw.ATTESTATION_SCHEMA)
        self.assertEqual(body["session_id"], self.p.gov["session_id"])
        self.assertEqual(body["profile_sha256"], self.p.session_sha)
        self.assertEqual(body["script_server_port"], self.port)
        self.assertGreater(body["resolve_pid"], 0)
        self.assertEqual(file_sha, rw.sha(open(out, "rb").read()))
        ident = rw.attest_isolated_session(probe, self.p.gov, self.p.prov, body)   # real /proc, real sockets, real child
        self.assertEqual(ident["pid"], body["resolve_pid"])
        self.assertIn(body["resolve_pid"], ident["endpoint_owner_pids"])
        self.assertGreater(ident["start_ticks"] / HZ, self.p.prov["seal_uptime"])
        entries = probe.environ_entries(body["resolve_pid"])
        for var in self.p.gov["profile_env"]:
            self.assertEqual(len([1 for k, _ in entries if k == var]), 1, f"{var} must appear exactly once")
        self.assertEqual(len([1 for k, _ in entries if k == rw.NONCE_ENV_KEY]), 1)

    def test_the_nonce_never_reaches_the_record_or_the_worker(self):
        probe = self.probe()
        body, out, _ = launcher.launch(self.args(), spawn=self.spawn, probe=probe)
        raw = open(out, "rb").read()
        nonce = dict(probe.environ_entries(body["resolve_pid"]))[rw.NONCE_ENV_KEY]
        self.assertEqual(rw.sha(nonce.encode()), body["nonce_sha256"])
        self.assertNotIn(nonce.encode(), raw, "the session nonce must never be written to disk")
        ident = rw.attest_isolated_session(probe, self.p.gov, self.p.prov, body)
        self.assertNotIn(nonce, json.dumps(ident), "the session nonce must never reach the worker's own identity block")
        self.assertEqual(ident["nonce_id"], body["nonce_sha256"][:16])

    def test_the_launcher_refuses_a_second_session_and_an_unaccepted_grant(self):
        launcher.launch(self.args(), spawn=self.spawn, probe=self.probe())
        with self.assertRaises(launcher.LaunchError) as cm:                        # Resolve already running
            launcher.launch(self.args(out=os.path.join(self.p.d, "second.json")), spawn=self.spawn, probe=self.probe())
        self.assertIn("already running", str(cm.exception))
        bad = json.loads(open(self.p.src_path).read()); bad["status"] = "CANDIDATE_FOR_INDEPENDENT_REVIEW"; bad["approved_by"] = None
        path = os.path.join(self.p.d, "unaccepted.json"); open(path, "w").write(json.dumps(bad))
        with self.assertRaises(launcher.LaunchError) as cm:
            launcher.launch(self.args(authority=path, out=os.path.join(self.p.d, "third.json")), spawn=self.spawn, probe=self.probe())
        self.assertIn("not an accepted", str(cm.exception))

    def test_the_launcher_refuses_a_mutated_profile_and_a_wrong_pin(self):
        open(os.path.join(self.p.prov["profile_root"], "config", "smuggled"), "w").write("x\n")
        with self.assertRaises(launcher.LaunchError) as cm: launcher.launch(self.args(), spawn=self.spawn, probe=self.probe())
        self.assertIn("SESSION_PROFILE_EXTRANEOUS", str(cm.exception))
        os.remove(os.path.join(self.p.prov["profile_root"], "config", "smuggled"))
        with self.assertRaises(launcher.LaunchError) as cm: launcher.launch(self.args(session_sha256="0" * 64), spawn=self.spawn, probe=self.probe())
        self.assertIn("SESSION_PROFILE_PIN_MISMATCH", str(cm.exception))
        self.assertEqual(self.children, [], "nothing may be launched before the chain verifies")

    def test_the_launched_environment_cannot_contain_duplicates(self):
        env = launcher.build_env(self.p.gov, self.p.prov, "n" * 8, ":1", base={"HOME": "/home/op", "PATH": "/usr/bin"})
        self.assertEqual(len(env), len(set(env)), "a dict environment cannot carry duplicate keys by construction")
        for var, rel in self.p.gov["profile_env"].items():
            self.assertEqual(env[var], os.path.join(self.p.prov["profile_root"], rel))
        self.assertEqual(env[rw.NONCE_ENV_KEY], "n" * 8)
        self.assertNotIn("VRC_FAKE_STATE", env)


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
        self.assertEqual(a["session"]["nonce_id"], rw.sha(NONCE.encode())[:16])
        self.assertEqual(a["session_id"], self.p.gov["session_id"])
        self.assertEqual(a["policy_sha256"], self.p.pol_sha)
        self.assertEqual(a["session_profile_sha256"], self.p.session_sha)
        self.assertEqual(a["runtime_attestation_sha256"], self.p.att_sha)
        self.assertEqual(a["profile_sha256"], self.p.session_sha)
        self.assertEqual(a["executable_sha256"], self.p.gov["resolve_binary"]["sha256"])
        self.assertEqual(a["profile_root"]["realpath"], self.p.prov["profile_root"])
        self.assertEqual(out["worker"]["runtime_attestation_sha256"], self.p.att_sha)
        self.assertNotIn(NONCE, json.dumps(out) + json.dumps(a), "the session nonce must never appear in a reply or the journal")

    def test_the_worker_refuses_to_start_without_the_whole_chain(self):
        d = tmpdir("start-"); sec = SECRET; sf = secret_file(d)
        def start(**kw):
            args = dict(policy_path=self.p.pol_path, policy_sha256=self.p.pol_sha, authority_path=self.p.src_path,
                        session_path=self.p.session_path, session_sha256=self.p.session_sha,
                        attestation_path=self.p.att_path, attestation_sha256=self.p.att_sha, secret_path=sf)
            args.update(kw)
            return rw.Worker(HOST, sec, os.path.join(d, uuid.uuid4().hex), fake_resolve, None, "PRODUCTION_READ",
                             args["policy_path"], args["policy_sha256"], args["authority_path"], args["session_path"],
                             args["session_sha256"], args["attestation_path"], args["attestation_sha256"],
                             FakeProbe(self.p, secret_path=sf), args["secret_path"], self.p.gov["host_primitive"])
        for kw in ({"session_path": None}, {"session_sha256": None}, {"policy_path": None}, {"authority_path": None},
                   {"policy_sha256": None}, {"attestation_path": None}, {"attestation_sha256": None}, {"secret_path": None}):
            with self.assertRaises(SystemExit): start(**kw)
        for kw in ({"session_sha256": "0" * 64}, {"policy_sha256": "0" * 64}, {"attestation_sha256": "0" * 64}):
            with self.assertRaises(SystemExit): start(**kw)
        with self.assertRaises(SystemExit):
            rw.Worker(HOST, sec, os.path.join(d, "q"), fake_resolve, ("Prod Disk A", None), "PRODUCTION_READ",
                      self.p.pol_path, self.p.pol_sha, self.p.src_path, self.p.session_path, self.p.session_sha,
                      self.p.att_path, self.p.att_sha, FakeProbe(self.p, secret_path=sf), sf, self.p.gov["host_primitive"])
        with self.assertRaises(SystemExit):
            rw.Worker(HOST, sec, os.path.join(d, "x"), fake_resolve, None, "QUALIFICATION_READ", None, None, None, None, None,
                      self.p.att_path, self.p.att_sha, FakeProbe(self.p, secret_path=sf))
        self.assertEqual(start().identity["read_profile"], "PRODUCTION_READ")

    def test_production_read_is_structurally_linux_and_vidnux_only(self):
        self.assertEqual(rw.PRODUCTION_HOSTS, ("vidnux",)); self.assertEqual(rw.PRODUCTION_PLATFORM, "Linux")
        orig = rw.platform.system
        try:
            rw.platform.system = lambda: "Windows"
            with self.assertRaises(SystemExit):
                rw.Worker(HOST, SECRET, tmpdir("win-"), fake_resolve, None, "PRODUCTION_READ", self.p.pol_path,
                          self.p.pol_sha, self.p.src_path, self.p.session_path, self.p.session_sha,
                          self.p.att_path, self.p.att_sha, FakeProbe(self.p), secret_file(tmpdir("winsec-")), self.p.gov["host_primitive"])
        finally: rw.platform.system = orig

    def test_a_non_live_preview_policy_is_refused_at_startup(self):
        d = tmpdir("prev-"); sp = os.path.join(d, "a.json"); pp = os.path.join(d, "p.json"); sf = secret_file(d)
        open(sp, "w").write(json.dumps(record(self.fx.lib(), [P_A1], status="CANDIDATE_FOR_INDEPENDENT_REVIEW", approved_by=None)))
        rc, js, _ = run([sys.executable, "-B", COMPILER, sp, pp, "--worker", WORKER_PATH, "--preview", "--host-boundary", CAP["boundary_path"]])
        self.assertEqual(rc, 0); self.assertFalse(js["live"])
        with self.assertRaises(SystemExit) as cm:
            rw.Worker(HOST, SECRET, os.path.join(d, "w"), fake_resolve, None, "PRODUCTION_READ", pp,
                      rw.sha(open(pp, "rb").read()), sp, self.p.session_path, self.p.session_sha,
                      self.p.att_path, self.p.att_sha, FakeProbe(self.p, secret_path=sf), sf, self.p.gov["host_primitive"])
        self.assertIn("AUTHORITY_NOT_ACCEPTED", str(cm.exception))

    def test_any_link_edited_after_start_refuses_the_next_operation(self):
        for name, mutate, stage, reason in (
                ("policy", lambda p: open(p.pol_path, "ab").write(b" "), "policy", "PRODUCTION_POLICY_PIN_MISMATCH"),
                ("authority", lambda p: open(p.src_path, "ab").write(b"\n"), "authority", "AUTHORITY_SOURCE_MISMATCH"),
                ("manifest", lambda p: open(p.session_path, "ab").write(b" "), "profile", "SESSION_PROFILE_PIN_MISMATCH"),
                ("attestation", lambda p: open(p.att_path, "ab").write(b" "), "attestation", "RUNTIME_ATTESTATION_PIN_MISMATCH"),
                ("sealed file", lambda p: open(os.path.join(p.prov["profile_root"], "config", "config.dat"), "a").write("x"), "profile", "SESSION_PROFILE_MUTATED"),
                ("registration", lambda p: open(os.path.join(p.prov["profile_root"], "config", ".dblist"), "a").write("Other:/srv/o::::DISK\n"), "profile", "SESSION_PROFILE_MUTATED"),
                ("unsealed addition", lambda p: open(os.path.join(p.prov["profile_root"], "config", "extra.dat"), "w").write("x"), "profile", "SESSION_PROFILE_EXTRANEOUS")):
            with self.subTest(name):
                self.fx = Fixture(); self.p = self.fx.profile()
                e = self.env(); self.assertTrue(e.call("identify")["ok"])
                mutate(self.p)
                self.denied(e, stage=stage, reason=reason)

    def test_a_policy_repinned_to_another_worker_facade_or_record_is_refused(self):
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
            e.worker.policy_sha256 = rw.sha(open(self.p.pol_path, "rb").read())
            self.denied(e, stage="authority" if reason.startswith("AUTHORITY") else "policy", reason=reason)

    def test_an_open_library_that_is_not_the_profiles_single_library_is_refused(self):
        self.denied(self.env(state(self.fx.bname, P_A1)), stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        self.denied(self.env(state("EKA192.168.50.199", P_A1, libtype="PostgreSQL", host="192.168.50.199")), stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        self.denied(self.env(state(self.fx.name, P_A1, libtype="PostgreSQL", host="192.168.50.199")), stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        self.denied(self.env(state(None, P_A1)), stage="library", reason="LIBRARY_IDENTITY_UNAVAILABLE")

    def test_the_authorized_root_must_still_be_the_pinned_physical_directory(self):
        e = self.env(); e.call("identify")
        moved = self.fx.A + "-moved"; os.rename(self.fx.A, moved); os.makedirs(self.fx.A)
        self.denied(e, stage="library", reason="LIBRARY_NOT_AUTHORIZED")
        os.rmdir(self.fx.A); os.rename(moved, self.fx.A)
        e.call("identify")
        os.rename(self.fx.A, moved)
        self.denied(e, stage="library", reason="LIBRARY_IDENTITY_UNAVAILABLE")
        os.rename(moved, self.fx.A)

    def test_the_profile_root_must_still_be_the_pinned_physical_directory(self):
        e = self.env(); e.call("identify")
        root = self.p.prov["profile_root"]; moved = root + "-moved"
        os.rename(root, moved); os.makedirs(root)
        try: self.denied(e, stage="profile", reason="SESSION_ROOT_IDENTITY_MISMATCH")
        finally: os.rmdir(root); os.rename(moved, root)
        e.call("identify")

    def test_only_allowlisted_projects_are_readable_and_a_switch_is_caught_between_operations(self):
        e = self.env()
        self.assertEqual(e.call("get_current_project")["project"]["uuid"], P_A1)
        e.set_state(state(self.fx.name, P_B1))
        self.denied(e, stage="project", reason="PROJECT_NOT_AUTHORIZED", code="PROJECT_IDENTITY_MISMATCH")
        e.set_state(self.fx.st(P_A2))
        self.assertEqual(e.call("get_current_project")["project"]["uuid"], P_A2)

    def test_no_project_open_never_opens_one(self):
        e = self.env(state(self.fx.name, P_A1))
        e.set_state({"database": {"DbName": self.fx.name, "DbType": "Disk"}, "project": None, "timelines": [], "current": 0})
        err = e.err("get_current_project"); self.assertEqual(err.code, "PROJECT_NOT_OPEN")
        a = e.authz(); self.assertEqual(a["decision"], "NOT_REACHED"); self.assertEqual(a["stage"], "resolve")
        self.assertNotIn("SetCurrentProject(", SRC); self.assertNotIn("LoadProject(", SRC)

    def test_a_replaced_or_vanished_session_refuses_every_later_read(self):
        e = self.env(); e.call("identify")
        e.probe.start_uptime += 5
        self.denied(e, stage="session", reason="SESSION_RESTARTED")
        e.probe.resolve_pids = []
        self.denied(e, stage="session", reason="SESSION_NOT_RUNNING")

    def test_a_duplicate_environment_entry_denies_at_the_session_stage(self):
        e = self.env(); e.call("identify")
        var = sorted(self.p.gov["profile_env"])[0]
        e.probe._entries = [(var, "/tmp/unauthorized-clone-b")] + e.probe._entries
        a = self.denied(e, stage="session", reason="SESSION_ENV_AMBIGUOUS")
        self.assertNotIn("project_uuid", a)

    def test_health_reports_and_journals_the_refusal_without_claiming_liveness(self):
        e = self.env(state(self.fx.bname, P_A1))
        out = e.call("health")
        self.assertTrue(out["result"]["worker_alive"]); self.assertEqual(out["resolve"]["probe"], "LIBRARY_MISMATCH")
        self.assertIsNone(out["resolve"]["available"])
        self.assertEqual(out["resolve"]["library_gate"]["reason"], "LIBRARY_NOT_AUTHORIZED")
        self.assertEqual(out["resolve"]["authorization"]["decision"], "DENIED")
        a = e.authz(); self.assertEqual(a["decision"], "DENIED"); self.assertEqual(a["stage"], "library"); self.assertEqual(a["op"], "health")

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
    """The offline binder proves, from bytes alone, that facade + worker + authority + policy + profile + attestation are one deployment."""
    def setUp(self):
        self.fx = Fixture(); self.p = self.fx.profile()
    def bind(self, extra=(), **kw):
        args = {"--facade-dir": FACADE, "--facade-manifest": FACADE_MANIFEST, "--worker": WORKER_PATH,
                "--authority": self.p.src_path, "--policy": self.p.pol_path, "--session": self.p.session_path,
                "--attestation": self.p.att_path, "--host-boundary": self.p.cap["boundary_path"]}
        args.update(kw)
        cmd = [sys.executable, "-B", BINDER]
        for k, v in args.items(): cmd += [k, v]
        return run(cmd + list(extra))

    def test_a_coherent_deployment_verifies(self):
        rc, js, raw = self.bind()
        self.assertEqual(rc, 0, raw); self.assertTrue(js["ok"]); self.assertEqual(js["failures"], [])
        self.assertGreaterEqual(js["checks_total"], 40)

    def test_the_accepted_facade_bytes_are_pinned(self):
        man = json.load(open(FACADE_MANIFEST))
        self.assertEqual(man["facade_commit"], FACADE_COMMIT); self.assertEqual(len(man["files"]), 10)
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
        rc, js, _ = self.bind(**{"--worker": os.path.join(FROZEN, "worker", "resolve_worker.py")})
        self.assertEqual(rc, 1); self.assertTrue(any("worker" in f["check"] or "accepted_and_pinned" in f["check"] for f in js["failures"]), js)
        other = Profile(self.fx.lib(), [P_A2])
        rc, js, _ = self.bind(**{"--policy": other.pol_path})
        self.assertEqual(rc, 1); self.assertIn("policy.binds_authority_bytes", [f["check"] for f in js["failures"]])
        rc, js, _ = self.bind(**{"--session": other.session_path})
        self.assertEqual(rc, 1); self.assertTrue(any("session.binds" in f["check"] for f in js["failures"]), js)
        rc, js, _ = self.bind(**{"--attestation": other.att_path})
        self.assertEqual(rc, 1); self.assertTrue(any(f["check"].startswith("attestation.binds") for f in js["failures"]), js)

    def test_an_edited_seal_or_missing_attestation_is_refused(self):
        rc, js, _ = self.bind(extra=("--pre-launch",), **{"--attestation": self.p.att_path})
        self.assertEqual(rc, 0, "a pre-launch verification is legitimate before a session exists")
        cmd = [sys.executable, "-B", BINDER, "--facade-dir", FACADE, "--facade-manifest", FACADE_MANIFEST, "--worker", WORKER_PATH,
               "--authority", self.p.src_path, "--policy", self.p.pol_path, "--session", self.p.session_path,
               "--host-boundary", self.p.cap["boundary_path"]]
        rc, js, _ = run(cmd)
        self.assertEqual(rc, 1); self.assertIn("attestation.provided", [f["check"] for f in js["failures"]])
        open(os.path.join(self.p.prov["profile_root"], "config", ".dblist"), "a").write("Other Disk:/srv/other::::DISK\n")
        rc, js, _ = self.bind()
        self.assertEqual(rc, 1); self.assertIn("session.profile_tree_is_exact_on_disk", [f["check"] for f in js["failures"]])


class FrozenParity(unittest.TestCase):
    """Nothing the accepted qualification system depends on may drift, and the accepted facade stays unchanged."""
    def test_the_qualification_registration_parser_is_byte_identical_to_frozen(self):
        def fn(src, name):
            lines = src.splitlines(True); i = next(k for k, l in enumerate(lines) if l.startswith(f"def {name}("))
            out = [lines[i]]
            for l in lines[i + 1:]:
                if l.strip() and not l[0].isspace(): break
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
        from vrcfacade import response
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
        self.assertEqual(e.err("get_current_project").code, "LIBRARY_MISMATCH")


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
                            ("--production-runtime-attestation", "/tmp/r.json"), ("--production-runtime-attestation-sha256", "0" * 64),
                            ("--require-library", "X")):
            r = self.cli(["--host-id", HOST, "--secret-file", "/dev/null", "--state-dir", tmpdir("cli-"), flag, value, flag, value])
            self.assertNotEqual(r.returncode, 0, flag)
            self.assertIn("once", (r.stdout + r.stderr).lower(), flag)

    def test_the_session_arguments_exist_and_are_documented(self):
        r = self.cli(["--help"])
        for flag in ("--production-session", "--production-session-sha256", "--production-authority",
                     "--production-policy-sha256", "--production-runtime-attestation", "--production-runtime-attestation-sha256"):
            self.assertIn(flag, r.stdout)


def tearDownModule():
    for d in TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
