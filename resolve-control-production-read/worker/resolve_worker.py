#!/usr/bin/env python3
"""VIDTOOLZ Resolve worker — production-read CANDIDATE 0.2.0 (derived from frozen Phase 1 0.1.1, READ ONLY).

Adds an explicit read profile (--mode): QUALIFICATION_READ keeps the frozen 0.1.1 library-gate behaviour unchanged;
PRODUCTION_READ authorizes reads ONLY when the CURRENT library identity AND the CURRENT project UUID are listed in a
compiled, digest-pinned production-read policy (deny by default, no wildcards, Disk libraries only in v1, re-checked at
every operation). Never opens, loads or switches a project or library. WRITE AUTHORITY = NONE.

Phase 1, READ ONLY, host-local Resolve attachment only.

One worker per host. Binds 127.0.0.1 only. Attaches to the LOCAL Resolve via
scriptapp("Resolve") with no host argument — a remote host argument is never
accepted or constructed. Public surface is an explicit read-only allowlist;
write-class operations are refused with READ_ONLY_MODE before any Resolve call.
stdlib only (Python >= 3.10).

0.1.1 (P2 repair candidate): durable replay guard (F-01), bounded Resolve pool with
saturation state + health outside the Resolve path (F-02), controller-path liveness
probe (F-03), security/protocol failure journaling with lock+fsync (F-04), and the
qualification-library gate (--require-library) demanded by v1.18 §A4."""
import argparse, hashlib, hmac, json, os, platform, re, socket, subprocess, sys, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORKER_VERSION = "0.2.0-production-read-candidate"
DERIVED_FROM = {"component": "resolve-control-plane phase1 0.1.1", "commit": "77c26103dfe88c448267a9c1efe7f34a20a39375", "worker_sha256": "371caf131e5d21cdb8b5f3e505934154b7ee835427d25d9683d51013d345f4b3"}
READ_PROFILES = ("QUALIFICATION_READ", "PRODUCTION_READ")
POLICY_SCHEMA = "vidtoolz.resolveProductionReadRuntimePolicy.v1"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PROTOCOL = "vrc.v1"
BIND = "127.0.0.1"            # hard requirement: loopback only
SKEW_S = 120
REPLAY_WINDOW_S = SKEW_S * 2 + 60   # a nonce is remembered for longer than any timestamp the skew check can still accept
MAX_BODY = 1 << 20
POOL_CAPACITY = 4
HEALTH_PROBE_S = 3.0
PROHIBITED_LIBRARIES = ("EKA", "EKA192.168.50.199", "nelja", "Local Database")   # v1.18 TARGET-CONTRACT#library.prohibited_library_names
READ_ONLY_OPS = ("health", "identify", "get_current_project", "get_current_timeline", "list_timelines",
                 "get_project_settings", "get_timeline_settings", "get_media_pool_summary", "get_project_fingerprint")
# Names refused BEFORE any Resolve call. Kept as data so tests can prove the gate.
FORBIDDEN_OPS = ("AppendToTimeline", "AddItemListToMediaPool", "ImportMedia", "CreateTimeline", "DeleteTimeline",
                 "SetCurrentTimeline", "SetSetting", "AddMarker", "DeleteMarker", "SaveProject", "SetName", "Quit",
                 "StartRendering", "AddRenderJob", "DeleteAllRenderJobs", "ExportProject", "SetClipProperty",
                 "SetMetadata", "SetProperty", "run_script", "exec", "eval")

def now_iso(): return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
def sha(b): return hashlib.sha256(b).hexdigest()
def sign(secret, ts, nonce, method, path, body): return hmac.new(secret, f"{ts}.{nonce}.{method}.{path}.{sha(body)}".encode(), hashlib.sha256).hexdigest()

class OpError(Exception):
    def __init__(self, code, message="", detail=None): super().__init__(code); self.code, self.message, self.detail = code, message, detail

# ---------------------------------------------------------------- Resolve process/session identity (no psutil)
def resolve_process():
    try:
        if platform.system() == "Windows":
            out = subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-Process Resolve -ErrorAction SilentlyContinue | Select-Object -First 1 Id,@{n='S';e={$_.StartTime.ToString('o')}} | ConvertTo-Json -Compress"],
                capture_output=True, text=True, timeout=8).stdout.strip()
            if out: d = json.loads(out); return {"pid": d.get("Id"), "started_at": d.get("S")}
        else:
            btime = next((int(l.split()[1]) for l in open("/proc/stat") if l.startswith("btime")), None)
            hz = os.sysconf("SC_CLK_TCK")
            for pid in filter(str.isdigit, os.listdir("/proc")):
                try:
                    if os.readlink(f"/proc/{pid}/exe") == "/opt/resolve/bin/resolve":
                        st = int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[19])
                        return {"pid": int(pid), "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(btime + st / hz))}
                except OSError: continue
    except Exception: pass
    return {"pid": None, "started_at": None}

def resolve_config_dir():
    return (os.path.join(os.environ.get("APPDATA", ""), "Blackmagic Design", "DaVinci Resolve", "Preferences")
            if platform.system() == "Windows" else os.path.expanduser("~/.local/share/DaVinciResolve/configs"))

def external_scripting_mode():
    try:
        m = re.search(rb"System\.Scripting\.Mode = (\d)", open(os.path.join(resolve_config_dir(), "config.dat"), "rb").read())
        return {"0": "NONE", "1": "LOCAL", "2": "NETWORK"}.get(m.group(1).decode()) if m else "UNKNOWN"
    except OSError: return "UNKNOWN"

def dblist_root_for(name):
    """Root registered for a Disk library in Resolve's registration file (Linux `.dblist`, Windows `dblist.conf`;
    line `name:root...:DISK`). Returns the verbatim root field. Credential fields are never read."""
    for fn in (".dblist", "dblist.conf"):
        try:
            for line in open(os.path.join(resolve_config_dir(), fn), "rb").read().decode("utf-8", "replace").splitlines():
                parts = line.split(":")
                if len(parts) >= 2 and parts[0] == name and line.rstrip().endswith("DISK"): return parts[1]
        except OSError: continue
    return None

# ---------------------------------------------------------------- production-read policy (compiled, pinned, deny by default)
def canonical_sha256(obj): return sha(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode())

def load_production_policy(path, expected_sha256):
    """Load and verify the compiled runtime policy. Fails closed on any defect: missing file, bad JSON, wrong schema,
    digest mismatch (file vs pinned value, and embedded policy_sha256 vs recomputed body), wildcard or malformed entry."""
    try: raw = open(path, "rb").read()
    except OSError as e: raise OpError("LIBRARY_MISMATCH", "production-read policy unavailable; fail closed", {"reason": "PRODUCTION_POLICY_MISSING", "cause": type(e).__name__})
    if sha(raw) != expected_sha256: raise OpError("LIBRARY_MISMATCH", "production-read policy digest does not match the pinned digest; fail closed", {"reason": "PRODUCTION_POLICY_PIN_MISMATCH", "expected": expected_sha256, "actual": sha(raw)})
    try: pol = json.loads(raw)
    except ValueError: raise OpError("LIBRARY_MISMATCH", "production-read policy is not valid JSON; fail closed", {"reason": "PRODUCTION_POLICY_INVALID"})
    if not isinstance(pol, dict) or pol.get("schema") != POLICY_SCHEMA: raise OpError("LIBRARY_MISMATCH", "production-read policy has the wrong schema; fail closed", {"reason": "PRODUCTION_POLICY_INVALID", "schema": pol.get("schema") if isinstance(pol, dict) else None})
    body = {k: v for k, v in pol.items() if k != "policy_sha256"}
    if pol.get("policy_sha256") != canonical_sha256(body): raise OpError("LIBRARY_MISMATCH", "production-read policy body does not match its embedded digest; fail closed", {"reason": "PRODUCTION_POLICY_INVALID"})
    hosts = pol.get("hosts")
    if not isinstance(hosts, dict): raise OpError("LIBRARY_MISMATCH", "production-read policy has no hosts object; fail closed", {"reason": "PRODUCTION_POLICY_INVALID"})
    for hid, h in hosts.items():
        libs = (h or {}).get("libraries")
        if not isinstance(libs, list): raise OpError("LIBRARY_MISMATCH", "production-read policy host entry malformed; fail closed", {"reason": "PRODUCTION_POLICY_INVALID", "host": hid})
        for lib in libs:
            if not isinstance(lib, dict) or lib.get("kind") != "Disk" or not str(lib.get("name", "")).strip() or not str(lib.get("registration_root", "")).strip():
                raise OpError("LIBRARY_MISMATCH", "production-read policy library entry malformed or not a Disk library (v1 supports Disk only); fail closed", {"reason": "PRODUCTION_POLICY_INVALID", "host": hid})
            if any(w in (lib["name"], lib["registration_root"]) for w in ("*", "")): raise OpError("LIBRARY_MISMATCH", "wildcard library identity refused", {"reason": "PRODUCTION_POLICY_WILDCARD", "host": hid})
            projs = lib.get("projects")
            if not isinstance(projs, list) or not projs: raise OpError("LIBRARY_MISMATCH", "production-read policy library lists no project UUIDs (empty never means all); fail closed", {"reason": "PRODUCTION_POLICY_WILDCARD", "host": hid, "library": lib["name"]})
            for u in projs:
                if not isinstance(u, str) or not UUID_RE.match(u): raise OpError("LIBRARY_MISMATCH", "production-read policy project entry is not an RFC 4122 UUID (names and wildcards refused)", {"reason": "PRODUCTION_POLICY_WILDCARD", "host": hid, "library": lib["name"], "entry": str(u)[:60]})
    return pol

# ---------------------------------------------------------------- SSH-session lifetime anchor (F-03 part 1)
# Live finding (2026-09-20, VIDLAP2): when the controlling ssh session dies, Windows OpenSSH does NOT kill the
# cmd.exe -> py.exe -> python.exe chain; the worker would linger as an orphan on 127.0.0.1:47021. The worker
# therefore anchors itself to the nearest sshd.exe ancestor and exits the moment that ancestor exits.
def find_session_anchor():
    if platform.system() != "Windows": return os.getppid()
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"],
        capture_output=True, text=True, timeout=20).stdout
    procs = {int(d["ProcessId"]): d for d in json.loads(out)}
    pid, seen = os.getpid(), set()
    while pid in procs and pid not in seen:
        seen.add(pid); d = procs[pid]
        if str(d.get("Name", "")).lower() == "sshd.exe": return pid
        pid = int(d.get("ParentProcessId") or 0)
    return None

def watch_session_anchor(anchor, on_exit):
    def run():
        if platform.system() == "Windows":
            import ctypes; k = ctypes.windll.kernel32
            h = k.OpenProcess(0x00100000, False, anchor)          # SYNCHRONIZE
            if h: k.WaitForSingleObject(h, 0xFFFFFFFF)
        else:
            while os.getppid() == anchor: time.sleep(2)
        on_exit()
    threading.Thread(target=run, daemon=True).start()

# ---------------------------------------------------------------- controller-path liveness (F-03 part 2)
# The anchor only fires when sshd notices the session is gone. On a host whose sshd has no ClientAlive keepalive
# (PRESTO), a dead network path leaves the session — and the worker — alive until TCP gives up. The worker therefore
# probes, through the SAME ssh connection, a reverse-forwarded loopback port (ssh -R <port>:127.0.0.1:22) and expects
# the controller's sshd banner within a bounded time. Consecutive failures => the controlling path is gone => exit.
def probe_controller_path(port, timeout_s=10.0):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout_s) as s:
            s.settimeout(timeout_s); return bool(s.recv(64))
    except OSError: return False

def watch_controller_path(port, interval_s, strikes, on_lost, on_event=None):
    def run():
        misses = 0
        while True:
            time.sleep(interval_s)
            if probe_controller_path(port): misses = 0; continue
            misses += 1
            if on_event: on_event({"event": "CONTROLLER_PROBE_MISS", "port": port, "misses": misses, "strikes": strikes})
            if misses >= strikes: on_lost(misses); return
    threading.Thread(target=run, daemon=True).start()

# ---------------------------------------------------------------- Resolve API attachment (LOCAL ONLY)
def load_api():
    if os.environ.get("VRC_FAKE_RESOLVE"):
        sys.path.insert(0, os.path.dirname(os.environ["VRC_FAKE_RESOLVE"])); import fake_resolve; return fake_resolve
    if platform.system() == "Windows":
        os.environ.setdefault("RESOLVE_SCRIPT_API", r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting")
        os.environ.setdefault("RESOLVE_SCRIPT_LIB", r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll")
    else:
        os.environ.setdefault("RESOLVE_SCRIPT_API", "/opt/resolve/Developer/Scripting")
        os.environ.setdefault("RESOLVE_SCRIPT_LIB", "/opt/resolve/libs/Fusion/fusionscript.so")
    sys.path.append(os.path.join(os.environ["RESOLVE_SCRIPT_API"], "Modules"))
    import DaVinciResolveScript as dvr; return dvr

def attach(api):
    r = api.scriptapp("Resolve")       # LOCAL attachment only; a host argument is never passed here.
    if not r: raise OpError("RESOLVE_UNAVAILABLE", "scriptapp('Resolve') returned no handle")
    return r

def tl_identity(t, index=None):
    if not t: return None
    d = {"name": t.GetName(), "uuid": t.GetUniqueId(), "start_frame": t.GetStartFrame(), "end_frame": t.GetEndFrame()}
    if index is not None: d["index"] = index
    return d

def snapshot(api, library_check=None, project_check=None):
    """Fresh identity every call — project identity is never cached (PRESTO project-switch case). When a library gate is
    configured it runs right after GetCurrentDatabase(), BEFORE any project or timeline read (v1.18 §A4 fail-closed).
    In PRODUCTION_READ the project gate runs right after the current project is read, BEFORE any timeline/settings/media read."""
    r = attach(api); pm = r.GetProjectManager(); db = pm.GetCurrentDatabase() or {}
    res = {"available": True, "product": r.GetProductName(), "version": r.GetVersionString(), "page": r.GetCurrentPage(),
           "library": {"name": db.get("DbName"), "type": db.get("DbType"), "host": db.get("IpAddress")}}
    if library_check: library_check(res)
    p = pm.GetCurrentProject()
    if not p: return r, pm, None, res, None, None
    proj = {"name": p.GetName(), "uuid": p.GetUniqueId(), "timeline_count": p.GetTimelineCount(),
            "library": db.get("DbName"), "library_type": db.get("DbType"), "library_host": db.get("IpAddress")}
    if project_check: project_check(res, proj)
    tl = tl_identity(p.GetCurrentTimeline())
    return r, pm, p, res, proj, tl

def find_timeline(p, params):
    want_uuid, want_name = params.get("timeline_uuid"), params.get("timeline_name")
    if not (want_uuid or want_name): raise OpError("TIMELINE_NOT_FOUND", "timeline_uuid or timeline_name required")
    for i in range(1, p.GetTimelineCount() + 1):
        t = p.GetTimelineByIndex(i)
        if (want_uuid and t.GetUniqueId() == want_uuid) or (not want_uuid and t.GetName() == want_name): return t, i
    raise OpError("TIMELINE_NOT_FOUND", str(want_uuid or want_name))

def fingerprint(p, proj, tl):
    core = {"uuid": proj["uuid"], "name": proj["name"], "timeline_count": proj["timeline_count"],
            "current_timeline_uuid": tl and tl["uuid"], "fps": p.GetSetting("timelineFrameRate"),
            "w": p.GetSetting("timelineResolutionWidth"), "h": p.GetSetting("timelineResolutionHeight")}
    return {"core": core, "fingerprint": sha(json.dumps(core, sort_keys=True).encode())}

# ---------------------------------------------------------------- F-01 durable replay guard
class ReplayGuard:
    """Nonces are appended (fsync) to <state>/replay.jsonl BEFORE a request is accepted, reloaded on start, expired after
    REPLAY_WINDOW_S and the file compacted when it grows. Only signature-verified nonces reach check(); an invalid
    signature therefore cannot poison the cache. Per worker state dir, i.e. per host key."""
    def __init__(self, path, window_s=REPLAY_WINDOW_S, compact_at=20000):
        self.path, self.window_s, self.compact_at, self.lock, self.seen, self.inserts = path, window_s, compact_at, threading.Lock(), {}, 0
        now = time.time()
        try:
            for line in open(path):
                try: d = json.loads(line)
                except ValueError: continue
                if now - float(d.get("t", 0)) <= window_s: self.seen[d["n"]] = float(d["t"])
        except OSError: pass
        self.loaded = len(self.seen)
    def _prune(self, now): self.seen = {n: t for n, t in self.seen.items() if now - t <= self.window_s}
    def check(self, nonce, ts):
        """True = fresh and now recorded; False = replay."""
        now = time.time()
        with self.lock:
            if nonce in self.seen: return False
            with open(self.path, "a") as f: f.write(json.dumps({"n": nonce, "t": ts}) + "\n"); f.flush(); os.fsync(f.fileno())
            self.seen[nonce] = ts; self.inserts += 1
            if self.inserts % 256 == 0: self._prune(now)
            if self.inserts >= self.compact_at: self._compact(now)
            return True
    def _compact(self, now):
        self._prune(now); tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            for n, t in self.seen.items(): f.write(json.dumps({"n": n, "t": t}) + "\n")
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, self.path); self.inserts = 0
    def size(self): return len(self.seen)

# ---------------------------------------------------------------- F-02 bounded Resolve pool with truthful state
class ResolvePool:
    """All Resolve API work runs here. Capacity is fixed; when every slot is occupied new Resolve work is refused
    immediately (WORKER_SATURATED) instead of queueing into a TIMEOUT. A slot whose call outlived its deadline is
    counted as 'stuck' until the native call returns (Python cannot interrupt it). health never depends on a slot."""
    def __init__(self, capacity=POOL_CAPACITY):
        self.capacity, self.inflight, self.stuck, self.lock = capacity, 0, 0, threading.RLock()   # RLock: snapshot() is read under the lock in run()
        self.ex = ThreadPoolExecutor(max_workers=capacity)
    def run(self, fn, timeout_s):
        with self.lock:
            if self.inflight >= self.capacity: raise OpError("WORKER_SATURATED", f"all {self.capacity} Resolve slots busy ({self.stuck} stuck past deadline); refusing rather than queueing", self.snapshot())
            self.inflight += 1
        marked = [False]
        def done(_):
            with self.lock:
                self.inflight -= 1
                if marked[0]: self.stuck -= 1
        fut = self.ex.submit(fn); fut.add_done_callback(done)
        try: return fut.result(timeout=timeout_s)
        except FutTimeout:
            with self.lock:
                if not fut.done(): marked[0] = True; self.stuck += 1
            raise
    def state(self):
        with self.lock:
            if self.inflight >= self.capacity: return "SATURATED"
            return "DEGRADED" if self.stuck > 0 else "HEALTHY"
    def snapshot(self):
        with self.lock: return {"capacity": self.capacity, "inflight": self.inflight, "stuck": self.stuck, "state": "SATURATED" if self.inflight >= self.capacity else ("DEGRADED" if self.stuck > 0 else "HEALTHY")}

# ---------------------------------------------------------------- Worker
class Worker:
    def __init__(self, host_id, secret, state_dir, api, require_library=None, mode="QUALIFICATION_READ", policy_path=None, policy_sha256=None):
        hn = socket.gethostname()
        if hn.lower() != host_id.lower(): raise SystemExit(f"HOST_ID_MISMATCH: --host-id {host_id} but hostname is {hn}")
        self.host_id, self.secret, self.state_dir, self.api = host_id, secret, state_dir, api
        self.require_library = require_library            # (name, root_or_None) or None  (QUALIFICATION_READ gate, frozen semantics)
        if mode not in READ_PROFILES: raise SystemExit(f"REFUSED: unknown --mode {mode!r}")
        self.mode, self.policy_path, self.policy_sha256 = mode, policy_path, policy_sha256
        if mode == "PRODUCTION_READ":
            if require_library: raise SystemExit("REFUSED: --require-library is a QUALIFICATION_READ gate; PRODUCTION_READ takes only --production-policy")
            if not (policy_path and policy_sha256): raise SystemExit("REFUSED: PRODUCTION_READ requires --production-policy PATH and --production-policy-sha256 DIGEST")
            try: pol = load_production_policy(policy_path, policy_sha256)          # startup: fail closed before binding
            except OpError as e: raise SystemExit(f"REFUSED: {e.message} {json.dumps(e.detail)}")
            if host_id.lower() not in {k.lower() for k in pol["hosts"]}: raise SystemExit(f"REFUSED: production-read policy grants nothing to host {host_id!r}; fail closed")
        elif policy_path or policy_sha256: raise SystemExit("REFUSED: --production-policy is only valid with --mode PRODUCTION_READ")
        os.makedirs(state_dir, exist_ok=True)
        gpath = os.path.join(state_dir, "generation")
        gen = int(open(gpath).read() or 0) + 1 if os.path.exists(gpath) else 1
        open(gpath, "w").write(str(gen))
        self.identity = {"host_id": host_id, "hostname": hn, "platform": platform.system().lower(),
                         "worker_instance_id": uuid.uuid4().hex, "worker_generation": gen,
                         "worker_started_at": now_iso(), "worker_version": WORKER_VERSION, "protocol": PROTOCOL,
                         "read_profile": mode, "production_policy_sha256": policy_sha256, "derived_from": DERIVED_FROM}
        self.replay = ReplayGuard(os.path.join(state_dir, "replay.jsonl"))
        self.pool = ResolvePool()
        self.jlock = threading.Lock(); self.journal = open(os.path.join(state_dir, "journal.jsonl"), "a")
        self.last_resolve = None                           # last successful snapshot summary {observed_at, available, version, project_uuid}
        self.journal_event({"event": "WORKER_START", "worker_instance_id": self.identity["worker_instance_id"], "worker_generation": gen,
                            "replay_entries_loaded": self.replay.loaded, "require_library": require_library and require_library[0],
                            "read_profile": mode, "production_policy_sha256": policy_sha256})

    # ---- journaling (F-04): one lock, fsync per line, never headers/keys/bodies
    def journal_event(self, rec):
        rec = {"ts": now_iso(), **rec}
        with self.jlock:
            self.journal.write(json.dumps(rec, default=str) + "\n"); self.journal.flush(); os.fsync(self.journal.fileno())

    # ---- authentication
    def verify(self, headers, method, path, body):
        ts, nonce, sig = headers.get("X-VRC-Timestamp"), headers.get("X-VRC-Nonce"), headers.get("X-VRC-Signature")
        if not (ts and nonce and sig): raise OpError("AUTHENTICATION_FAILED", "missing auth headers")
        try: tsi = int(ts); skew = abs(time.time() - tsi)
        except ValueError: raise OpError("AUTHENTICATION_FAILED", "bad timestamp")
        if skew > SKEW_S: raise OpError("AUTHENTICATION_FAILED", "clock skew")
        if not hmac.compare_digest(sig, sign(self.secret, ts, nonce, method, path, body)): raise OpError("AUTHENTICATION_FAILED", "bad signature")
        if len(nonce) > 128: raise OpError("AUTHENTICATION_FAILED", "nonce too long")
        if not self.replay.check(nonce, tsi): raise OpError("REPLAY_DETECTED", "nonce already accepted by this worker (durable replay guard)")

    # ---- guards
    def check_expected(self, exp, res, proj, tl):
        if not exp: return
        if exp.get("worker_instance_id") and exp["worker_instance_id"] != self.identity["worker_instance_id"]: raise OpError("WORKER_GENERATION_MISMATCH", "worker restarted", {"actual": self.identity["worker_instance_id"]})
        proc = res.get("process") or {}
        if exp.get("resolve_pid") is not None and exp["resolve_pid"] != proc.get("pid"): raise OpError("RESOLVE_SESSION_CHANGED", "pid differs", {"actual": proc})
        if exp.get("resolve_start_time") and exp["resolve_start_time"] != proc.get("started_at"): raise OpError("RESOLVE_SESSION_CHANGED", "start time differs", {"actual": proc})
        if exp.get("project_uuid"):
            if not proj: raise OpError("PROJECT_NOT_OPEN", "no project open")
            if exp["project_uuid"] != proj["uuid"]: raise OpError("PROJECT_IDENTITY_MISMATCH", "project differs", {"actual": {"name": proj["name"], "uuid": proj["uuid"]}})
        if exp.get("timeline_uuid") and (not tl or exp["timeline_uuid"] != tl["uuid"]): raise OpError("TIMELINE_IDENTITY_MISMATCH", "current timeline differs", {"actual": tl})

    def check_library(self, res):
        """Library gate, dispatched by read profile. QUALIFICATION_READ: the frozen 0.1.1 v1.18 §A4 gate, unchanged — when
        configured, the open library MUST be the named Disk qualification library (and, when a root is configured, the
        registration of that name must point at that root). PRODUCTION_READ: the CURRENT library must be one of the policy's
        Disk libraries for THIS host, matched on kind + name + registered root, re-verified against the pinned policy every call."""
        if self.mode == "PRODUCTION_READ": return self.check_library_production(res)
        if not self.require_library: return
        name, root = self.require_library; lib = res.get("library") or {}
        actual = {"name": lib.get("name"), "type": lib.get("type"), "host": lib.get("host")}
        if not lib.get("name"): raise OpError("LIBRARY_MISMATCH", "current library identity unavailable; fail closed", {"required": name, "actual": actual})
        if lib["name"] in PROHIBITED_LIBRARIES or lib["name"] != name: raise OpError("LIBRARY_MISMATCH", "open library is not the configured qualification library", {"required": name, "actual": actual})
        if str(lib.get("type", "")).lower() != "disk": raise OpError("LIBRARY_MISMATCH", "qualification library must be a Disk library", {"required": name, "actual": actual})
        if root:
            reg = dblist_root_for(name)
            if reg is None or os.path.normpath(reg) != os.path.normpath(root): raise OpError("LIBRARY_MISMATCH", "library registration root does not match configured root", {"required_root": root, "registered_root": reg})

    # ---- PRODUCTION_READ gates (operation-time; nothing cached across calls)
    def _policy_libraries(self):
        pol = load_production_policy(self.policy_path, self.policy_sha256)     # re-read + re-pin EVERY call (a local edit must not silently broaden)
        host = next((h for k, h in pol["hosts"].items() if k.lower() == self.host_id.lower()), None)
        if not host: raise OpError("LIBRARY_MISMATCH", "production-read policy grants nothing to this host; fail closed", {"reason": "HOST_NOT_AUTHORIZED", "host": self.host_id})
        return host["libraries"]

    def check_library_production(self, res):
        lib = res.get("library") or {}
        actual = {"name": lib.get("name"), "type": lib.get("type"), "host": lib.get("host")}
        if not lib.get("name"): raise OpError("LIBRARY_MISMATCH", "current library identity unavailable; fail closed", {"reason": "LIBRARY_IDENTITY_UNAVAILABLE", "actual": actual})
        if str(lib.get("type", "")).lower() != "disk": raise OpError("LIBRARY_MISMATCH", "network/PostgreSQL libraries are not authorized by this candidate (v1: Disk only)", {"reason": "LIBRARY_NOT_AUTHORIZED", "actual": actual})
        reg_root = dblist_root_for(lib["name"])
        if reg_root is None: raise OpError("LIBRARY_MISMATCH", "current library has no readable Disk registration on this host; identity cannot be established; fail closed", {"reason": "LIBRARY_IDENTITY_UNAVAILABLE", "actual": actual})
        match = [l for l in self._policy_libraries() if l["kind"] == "Disk" and l["name"] == lib["name"] and l["registration_root"] == reg_root]
        if len(match) != 1: raise OpError("LIBRARY_MISMATCH", "current library is not an authorized production-read library on this host", {"reason": "LIBRARY_NOT_AUTHORIZED", "actual": dict(actual, registration_root=reg_root), "candidates_matched": len(match)})
        res["authorization"] = {"read_profile": "PRODUCTION_READ", "library": {"kind": "Disk", "name": lib["name"], "registration_root": reg_root}, "policy_sha256": self.policy_sha256}

    def check_project_production(self, res, proj):
        """Double gate: the CURRENT project UUID must be listed under the CURRENT (already authorized) library. Names are informational."""
        lib = (res.get("authorization") or {}).get("library")
        if not lib: raise OpError("LIBRARY_MISMATCH", "project gate reached without an authorized library; fail closed", {"reason": "LIBRARY_NOT_AUTHORIZED"})
        entry = [l for l in self._policy_libraries() if l["kind"] == "Disk" and l["name"] == lib["name"] and l["registration_root"] == lib["registration_root"]]
        allowed = entry[0]["projects"] if len(entry) == 1 else []
        if not proj.get("uuid") or proj["uuid"] not in allowed:
            raise OpError("PROJECT_IDENTITY_MISMATCH", "current project is not an authorized production-read project in this library", {"reason": "PROJECT_NOT_AUTHORIZED", "actual": {"name": proj.get("name"), "uuid": proj.get("uuid")}, "library": lib["name"]})
        res["authorization"]["project_uuid"] = proj["uuid"]

    def _project_gate(self):
        return self.check_project_production if self.mode == "PRODUCTION_READ" else None

    # ---- request execution
    def execute(self, env, deadline_s):
        op, params = env.get("op"), env.get("params") or {}
        if not env.get("target_host"): raise OpError("TARGET_REQUIRED", "envelope has no target_host; there is no default target")
        if str(env["target_host"]).lower() != self.host_id.lower(): raise OpError("TARGET_MISMATCH", f"envelope targets {env.get('target_host')!r}, this worker is {self.host_id}")
        if op in FORBIDDEN_OPS: raise OpError("READ_ONLY_MODE", f"{op} is a write-class operation; Phase 1 worker has no write authority")
        if op not in READ_ONLY_OPS: raise OpError("UNSUPPORTED_OPERATION", str(op))
        base = {"process": resolve_process(), "external_scripting_mode": external_scripting_mode()}
        if op == "health": return self.health(base, deadline_s)
        try: return self.pool.run(lambda: self.resolve_section(op, params, env.get("expected"), base), deadline_s)
        except OpError as e:
            if e.code == "RESOLVE_UNAVAILABLE": e.detail = {"resolve": {"available": False, **base}}
            raise

    def health(self, base, deadline_s):
        """Worker liveness + pool state + a BOUNDED Resolve probe that is skipped when the pool is saturated.
        Never blocks on Resolve longer than HEALTH_PROBE_S; never fails because Resolve is hung or absent."""
        pool = self.pool.snapshot(); res = {"available": None, "probe": None, "pool": pool, "last_observed": self.last_resolve, **base}
        proj = tl = None
        if pool["state"] == "SATURATED": res["probe"] = "SKIPPED_SATURATED"
        else:
            try:
                _, _, _, r, proj, tl = self.pool.run(lambda: snapshot(self.api, self.check_library, self._project_gate()), min(HEALTH_PROBE_S, deadline_s))
                res.update(r); res["probe"] = "OK"; self.note_resolve(r, proj)
            except FutTimeout: res["probe"] = "TIMEOUT"
            except OpError as e:
                res["probe"] = e.code; res["available"] = None if e.code in ("LIBRARY_MISMATCH", "PROJECT_IDENTITY_MISMATCH") else False   # not authorized: Resolve is there, but this worker may not read it
                if e.code == "LIBRARY_MISMATCH": res["library_gate"] = e.detail
                if e.code == "PROJECT_IDENTITY_MISMATCH": res["project_gate"] = e.detail
        res["pool"] = self.pool.snapshot()
        return {"resolve": res, "project": proj, "timeline": tl, "result": {"worker_alive": True, "pool_state": res["pool"]["state"]}}

    def note_resolve(self, res, proj):
        self.last_resolve = {"observed_at": now_iso(), "available": True, "version": res.get("version"), "library": (res.get("library") or {}).get("name"), "project_uuid": proj and proj["uuid"]}

    def resolve_section(self, op, params, expected, base):
        r, pm, p, res, proj, tl = snapshot(self.api, self.check_library, self._project_gate())   # the only Resolve attachment; library gate before any project read, project gate before any timeline/settings/media read
        if self.mode == "PRODUCTION_READ" and not p: raise OpError("PROJECT_NOT_OPEN", "no project open; production reads never open or switch a project")
        res.update(base); self.check_expected(expected, res, proj, tl); self.note_resolve(res, proj)
        if op in ("get_current_project", "get_current_timeline") and not p: raise OpError("PROJECT_NOT_OPEN", "no project open on this host")
        if op == "get_current_timeline" and not tl: raise OpError("TIMELINE_NOT_FOUND", "project has no current timeline")
        if op in ("identify", "get_current_project", "get_current_timeline"): result = {}
        elif op == "list_timelines":
            result = {"timelines": [tl_identity(p.GetTimelineByIndex(i), i) for i in range(1, (proj or {}).get("timeline_count", 0) + 1)]} if p else {"timelines": []}
        elif op == "get_project_settings":
            if not p: raise OpError("PROJECT_NOT_OPEN")
            result = {"settings": p.GetSetting()}
        elif op == "get_timeline_settings":
            if not p: raise OpError("PROJECT_NOT_OPEN")
            t, i = find_timeline(p, params); result = {"timeline": tl_identity(t, i), "settings": t.GetSetting(), "tracks": {"video": t.GetTrackCount("video"), "audio": t.GetTrackCount("audio")}, "marker_count": len(t.GetMarkers() or {})}
        elif op == "get_media_pool_summary":
            if not p: raise OpError("PROJECT_NOT_OPEN")
            root = p.GetMediaPool().GetRootFolder()
            result = {"root_clips": len(root.GetClipList() or []), "bins": [{"name": f.GetName(), "clips": len(f.GetClipList() or []), "stale": f.GetIsFolderStale()} for f in (root.GetSubFolderList() or [])]}
        elif op == "get_project_fingerprint":
            if not p: raise OpError("PROJECT_NOT_OPEN")
            result = fingerprint(p, proj, tl)
        return {"resolve": res, "project": proj, "timeline": tl, "result": result}

    def handle(self, env, deadline_ms, client=None):
        """Ordering: (auth + replay already verified by the handler) → gates → execute → JOURNAL → respond."""
        t0 = time.time(); rid = env.get("request_id") or uuid.uuid4().hex
        out = {"protocol": PROTOCOL, "request_id": rid, "host_id": self.host_id, "worker": self.identity, "mode": "READ_ONLY",
               "write_authority": "NONE", "write_lease": None, "observed_at": now_iso(), "read_profile": self.mode}
        try:
            out.update(self.execute(env, max(1, deadline_ms) / 1000)); out["ok"] = True
        except FutTimeout: out.update(ok=False, error={"code": "TIMEOUT", "message": f"operation exceeded {deadline_ms} ms (Resolve call not interruptible; slot counted as stuck until it returns)", "detail": {"pool": self.pool.snapshot()}})
        except OpError as e:
            out.update(ok=False, error={"code": e.code, "message": e.message, "detail": e.detail})
            if e.code == "RESOLVE_UNAVAILABLE" and e.detail: out["resolve"] = e.detail["resolve"]
        except Exception as e: out.update(ok=False, error={"code": "TRANSPORT_ERROR", "message": "internal error: " + repr(e)[:200]})
        out["duration_ms"] = int((time.time() - t0) * 1000)
        self.journal_event({"event": "OP", "request_id": rid, "op": env.get("op"), "target_host": env.get("target_host"),
            "caller": env.get("caller"), "client_port": client and client[1], "ok": out.get("ok"), "error": (out.get("error") or {}).get("code"), "duration_ms": out["duration_ms"],
            "worker_instance_id": self.identity["worker_instance_id"], "resolve_pid": ((out.get("resolve") or {}).get("process") or {}).get("pid"),
            "pool_state": self.pool.state(), "project_uuid": (out.get("project") or {}).get("uuid"), "timeline_uuid": (out.get("timeline") or {}).get("uuid"),
            "read_profile": self.mode, "authorization": ((out.get("resolve") or {}).get("authorization") or {}).get("project_uuid") and "AUTHORIZED" or ((out.get("error") or {}).get("detail") or {}).get("reason")})
        return out

class Handler(BaseHTTPRequestHandler):
    server_version = "vrc-worker/" + WORKER_VERSION
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _reject(self, http, code, message, event, body=None, extra=None):
        """Every refusal before execution is journaled (F-04) — sanitized: no headers, no key material, no body bytes."""
        rid = None
        if body and len(body) <= 65536:
            try: rid = json.loads(body).get("request_id")
            except (ValueError, AttributeError): rid = None
        self.server.worker.journal_event({"event": event, "code": code, "http": http, "reason": message[:120], "client_port": self.client_address[1],
                                          "method": self.command, "path": self.path[:200], "content_length": self.headers.get("Content-Length"), "request_id": rid, **(extra or {})})
        self._send(http, {"ok": False, "host_id": self.server.worker.host_id, "error": {"code": code, "message": message}})
    def do_POST(self):
        w = self.server.worker
        try:
            try: n = int(self.headers.get("Content-Length") or 0)
            except ValueError: return self._reject(400, "TRANSPORT_ERROR", "bad Content-Length", "MALFORMED_REQUEST")
            if n > MAX_BODY: return self._reject(413, "TRANSPORT_ERROR", "body too large", "BODY_TOO_LARGE")
            body = self.rfile.read(n)
            try: w.verify(self.headers, "POST", self.path, body)
            except OpError as e: return self._reject(401, e.code, e.message, "REPLAY_DETECTED" if e.code == "REPLAY_DETECTED" else "AUTH_FAILED", body)
            if self.path != "/v1/op": return self._reject(404, "UNSUPPORTED_OPERATION", self.path[:100], "BAD_PATH", body)
            try: env = json.loads(body or b"{}"); assert isinstance(env, dict)
            except (ValueError, AssertionError): return self._reject(400, "TRANSPORT_ERROR", "malformed JSON envelope", "MALFORMED_JSON")
            dl = env.get("deadline_ms", 20000)
            if not isinstance(dl, int) or isinstance(dl, bool) or not (1 <= dl <= 600000): return self._reject(400, "TRANSPORT_ERROR", "deadline_ms must be an integer 1..600000", "BAD_ENVELOPE", body)
            out = w.handle(env, dl, self.client_address); self._send(200 if out.get("ok") else 409, out)
        except Exception as e:
            try: self._reject(500, "TRANSPORT_ERROR", "handler exception", "HANDLER_EXCEPTION", extra={"exception": type(e).__name__})
            except Exception: pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--host-id", required=True); ap.add_argument("--port", type=int, default=47021)
    ap.add_argument("--secret-file", required=True); ap.add_argument("--state-dir", required=True); ap.add_argument("--bind", default=BIND)
    ap.add_argument("--exit-with-session", action="store_true", help="exit when the controlling ssh session (nearest sshd ancestor) exits; refuse to start without one")
    ap.add_argument("--liveness-port", type=int, help="reverse-forwarded loopback port that reaches the controller's sshd through the owning ssh connection; probed periodically")
    ap.add_argument("--liveness-interval", type=int, default=60); ap.add_argument("--liveness-strikes", type=int, default=3)
    ap.add_argument("--require-library", help="QUALIFICATION_READ gate: NAME or NAME=ROOT; every Resolve op fails closed (LIBRARY_MISMATCH) unless the open library is this Disk library")
    ap.add_argument("--mode", default="QUALIFICATION_READ", choices=READ_PROFILES, help="explicit read profile; PRODUCTION_READ requires a compiled, pinned policy and never infers itself from the open library")
    ap.add_argument("--production-policy", help="PRODUCTION_READ: path to the compiled runtime policy (vidtoolz.resolveProductionReadRuntimePolicy.v1)")
    ap.add_argument("--production-policy-sha256", help="PRODUCTION_READ: pinned sha256 of the policy FILE; re-verified at every operation")
    a = ap.parse_args()
    if a.bind != BIND: raise SystemExit("LOOPBACK_ONLY: worker binds 127.0.0.1 only; refusing --bind " + a.bind)
    secret = open(a.secret_file, "rb").read().strip()
    if len(secret) < 32: raise SystemExit("REFUSED: secret too short")
    req = None
    if a.require_library:
        name, _, root = a.require_library.partition("="); req = (name, root or None)
        if name in PROHIBITED_LIBRARIES: raise SystemExit("REFUSED: --require-library names a prohibited library")
    srv = ThreadingHTTPServer((BIND, a.port), Handler); srv.worker = Worker(a.host_id, secret, a.state_dir, load_api(), req, a.mode, a.production_policy, a.production_policy_sha256)
    anchor = None
    if a.exit_with_session:
        anchor = find_session_anchor()
        if not anchor: raise SystemExit("SESSION_ANCHOR_REQUIRED: --exit-with-session given but no controlling ssh session found")
        def bye():
            srv.worker.journal_event({"event": "SESSION_ANCHOR_EXITED", "anchor_pid": anchor, "worker_instance_id": srv.worker.identity["worker_instance_id"]}); os._exit(0)
        watch_session_anchor(anchor, bye)
    if a.liveness_port:
        def lost(misses):
            srv.worker.journal_event({"event": "CONTROLLER_PATH_LOST", "port": a.liveness_port, "misses": misses, "worker_instance_id": srv.worker.identity["worker_instance_id"]}); os._exit(0)
        watch_controller_path(a.liveness_port, a.liveness_interval, a.liveness_strikes, lost, srv.worker.journal_event)
    print(json.dumps({"worker_up": srv.worker.identity, "bind": f"{BIND}:{a.port}", "session_anchor_pid": anchor, "liveness_port": a.liveness_port,
                      "require_library": req and req[0], "read_profile": a.mode, "production_policy_sha256": a.production_policy_sha256,
                      "replay_entries_loaded": srv.worker.replay.loaded}), flush=True); srv.serve_forever()

if __name__ == "__main__": main()
