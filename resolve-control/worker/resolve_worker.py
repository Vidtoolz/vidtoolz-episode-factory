#!/usr/bin/env python3
"""VIDTOOLZ Resolve worker — Phase 1, READ ONLY, host-local Resolve attachment only.

One worker per host. Binds 127.0.0.1 only. Attaches to the LOCAL Resolve via
scriptapp("Resolve") with no host argument — a remote host argument is never
accepted or constructed. Public surface is an explicit read-only allowlist;
write-class operations are refused with READ_ONLY_MODE before any Resolve call.
stdlib only (Python >= 3.10)."""
import argparse, hashlib, hmac, json, os, platform, re, socket, subprocess, sys, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORKER_VERSION = "0.1.0"
PROTOCOL = "vrc.v1"
BIND = "127.0.0.1"            # hard requirement: loopback only
SKEW_S = 120
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

def external_scripting_mode():
    p = (os.path.join(os.environ.get("APPDATA", ""), "Blackmagic Design", "DaVinci Resolve", "Preferences", "config.dat")
         if platform.system() == "Windows" else os.path.expanduser("~/.local/share/DaVinciResolve/configs/config.dat"))
    try:
        m = re.search(rb"System\.Scripting\.Mode = (\d)", open(p, "rb").read())
        return {"0": "NONE", "1": "LOCAL", "2": "NETWORK"}.get(m.group(1).decode()) if m else "UNKNOWN"
    except OSError: return "UNKNOWN"

# ---------------------------------------------------------------- SSH-session lifetime anchor
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

def snapshot(api):
    """Fresh identity every call — project identity is never cached (PRESTO project-switch case)."""
    r = attach(api); pm = r.GetProjectManager(); p = pm.GetCurrentProject()
    res = {"available": True, "product": r.GetProductName(), "version": r.GetVersionString(), "page": r.GetCurrentPage()}
    if not p: return r, pm, None, res, None, None
    db = pm.GetCurrentDatabase() or {}
    proj = {"name": p.GetName(), "uuid": p.GetUniqueId(), "timeline_count": p.GetTimelineCount(),
            "library": db.get("DbName"), "library_type": db.get("DbType"), "library_host": db.get("IpAddress")}
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

# ---------------------------------------------------------------- Worker
class Worker:
    def __init__(self, host_id, secret, state_dir, api):
        hn = socket.gethostname()
        if hn.lower() != host_id.lower(): raise SystemExit(f"HOST_ID_MISMATCH: --host-id {host_id} but hostname is {hn}")
        self.host_id, self.secret, self.state_dir, self.api = host_id, secret, state_dir, api
        os.makedirs(state_dir, exist_ok=True)
        gpath = os.path.join(state_dir, "generation")
        gen = int(open(gpath).read() or 0) + 1 if os.path.exists(gpath) else 1
        open(gpath, "w").write(str(gen))
        self.identity = {"host_id": host_id, "hostname": hn, "platform": platform.system().lower(),
                         "worker_instance_id": uuid.uuid4().hex, "worker_generation": gen,
                         "worker_started_at": now_iso(), "worker_version": WORKER_VERSION, "protocol": PROTOCOL}
        self.nonces, self.lock, self.pool = {}, threading.Lock(), ThreadPoolExecutor(max_workers=4)
        self.journal = open(os.path.join(state_dir, "journal.jsonl"), "a")

    def verify(self, headers, method, path, body):
        ts, nonce, sig = headers.get("X-VRC-Timestamp"), headers.get("X-VRC-Nonce"), headers.get("X-VRC-Signature")
        if not (ts and nonce and sig): raise OpError("AUTHENTICATION_FAILED", "missing auth headers")
        try: skew = abs(time.time() - int(ts))
        except ValueError: raise OpError("AUTHENTICATION_FAILED", "bad timestamp")
        if skew > SKEW_S: raise OpError("AUTHENTICATION_FAILED", "clock skew")
        if not hmac.compare_digest(sig, sign(self.secret, ts, nonce, method, path, body)): raise OpError("AUTHENTICATION_FAILED", "bad signature")
        with self.lock:
            if nonce in self.nonces: raise OpError("AUTHENTICATION_FAILED", "replayed nonce")
            self.nonces[nonce] = time.time()
            if len(self.nonces) > 5000: self.nonces = {k: v for k, v in self.nonces.items() if time.time() - v < SKEW_S * 2}

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

    def execute(self, env):
        op, params = env.get("op"), env.get("params") or {}
        if not env.get("target_host"): raise OpError("TARGET_REQUIRED", "envelope has no target_host; there is no default target")
        if str(env["target_host"]).lower() != self.host_id.lower(): raise OpError("TARGET_MISMATCH", f"envelope targets {env.get('target_host')!r}, this worker is {self.host_id}")
        if op in FORBIDDEN_OPS: raise OpError("READ_ONLY_MODE", f"{op} is a write-class operation; Phase 1 worker has no write authority")
        if op not in READ_ONLY_OPS: raise OpError("UNSUPPORTED_OPERATION", str(op))
        base = {"process": resolve_process(), "external_scripting_mode": external_scripting_mode()}
        try: r, pm, p, res, proj, tl = snapshot(self.api)
        except OpError as e:
            if op == "health": return {"resolve": {"available": False, **base}, "project": None, "timeline": None, "result": {"note": e.code}}
            e.detail = {"resolve": {"available": False, **base}}; raise
        res.update(base); self.check_expected(env.get("expected"), res, proj, tl)
        if op in ("get_current_project", "get_current_timeline") and not p: raise OpError("PROJECT_NOT_OPEN", "no project open on this host")
        if op == "get_current_timeline" and not tl: raise OpError("TIMELINE_NOT_FOUND", "project has no current timeline")
        if op in ("health", "identify", "get_current_project", "get_current_timeline"): result = {}
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

    def handle(self, env, deadline_ms):
        t0 = time.time(); rid = env.get("request_id") or uuid.uuid4().hex
        out = {"protocol": PROTOCOL, "request_id": rid, "host_id": self.host_id, "worker": self.identity, "mode": "READ_ONLY",
               "write_authority": "NONE", "write_lease": None, "observed_at": now_iso()}
        try:
            fut = self.pool.submit(self.execute, env)
            out.update(fut.result(timeout=max(1, deadline_ms) / 1000)); out["ok"] = True
        except FutTimeout: out.update(ok=False, error={"code": "TIMEOUT", "message": f"operation exceeded {deadline_ms} ms (Resolve call not interruptible; thread left to finish)"})
        except OpError as e:
            out.update(ok=False, error={"code": e.code, "message": e.message, "detail": e.detail})
            if e.code == "RESOLVE_UNAVAILABLE" and e.detail: out["resolve"] = e.detail["resolve"]
        except Exception as e: out.update(ok=False, error={"code": "TRANSPORT_ERROR", "message": repr(e)[:300]})
        out["duration_ms"] = int((time.time() - t0) * 1000)
        self.journal.write(json.dumps({"ts": out["observed_at"], "request_id": rid, "op": env.get("op"), "target_host": env.get("target_host"),
            "caller": env.get("caller"), "ok": out.get("ok"), "error": (out.get("error") or {}).get("code"), "duration_ms": out["duration_ms"],
            "worker_instance_id": self.identity["worker_instance_id"], "resolve_pid": ((out.get("resolve") or {}).get("process") or {}).get("pid"),
            "project_uuid": (out.get("project") or {}).get("uuid"), "timeline_uuid": (out.get("timeline") or {}).get("uuid")}) + "\n"); self.journal.flush()
        return out

class Handler(BaseHTTPRequestHandler):
    server_version = "vrc-worker/" + WORKER_VERSION
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)); w = self.server.worker
        try: w.verify(self.headers, "POST", self.path, body)
        except OpError as e: return self._send(401, {"ok": False, "error": {"code": e.code, "message": e.message}})
        if self.path != "/v1/op": return self._send(404, {"ok": False, "error": {"code": "UNSUPPORTED_OPERATION", "message": self.path}})
        try: env = json.loads(body or b"{}")
        except ValueError: return self._send(400, {"ok": False, "error": {"code": "TRANSPORT_ERROR", "message": "malformed JSON"}})
        out = w.handle(env, int(env.get("deadline_ms") or 20000)); self._send(200 if out.get("ok") else 409, out)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--host-id", required=True); ap.add_argument("--port", type=int, default=47021)
    ap.add_argument("--secret-file", required=True); ap.add_argument("--state-dir", required=True); ap.add_argument("--bind", default=BIND)
    ap.add_argument("--exit-with-session", action="store_true", help="exit when the controlling ssh session (nearest sshd ancestor) exits; refuse to start without one")
    a = ap.parse_args()
    if a.bind != BIND: raise SystemExit("LOOPBACK_ONLY: worker binds 127.0.0.1 only; refusing --bind " + a.bind)
    secret = open(a.secret_file, "rb").read().strip()
    if len(secret) < 32: raise SystemExit("REFUSED: secret too short")
    srv = ThreadingHTTPServer((BIND, a.port), Handler); srv.worker = Worker(a.host_id, secret, a.state_dir, load_api())
    anchor = None
    if a.exit_with_session:
        anchor = find_session_anchor()
        if not anchor: raise SystemExit("SESSION_ANCHOR_REQUIRED: --exit-with-session given but no controlling ssh session found")
        def bye():
            srv.worker.journal.write(json.dumps({"ts": now_iso(), "event": "SESSION_ANCHOR_EXITED", "anchor_pid": anchor, "worker_instance_id": srv.worker.identity["worker_instance_id"]}) + "\n"); srv.worker.journal.flush(); os._exit(0)
        watch_session_anchor(anchor, bye)
    print(json.dumps({"worker_up": srv.worker.identity, "bind": f"{BIND}:{a.port}", "session_anchor_pid": anchor}), flush=True); srv.serve_forever()

if __name__ == "__main__": main()
