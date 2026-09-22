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

WORKER_VERSION = "0.2.1-production-read-candidate"
DERIVED_FROM = {"component": "resolve-control-plane phase1 0.1.1", "commit": "77c26103dfe88c448267a9c1efe7f34a20a39375", "worker_sha256": "371caf131e5d21cdb8b5f3e505934154b7ee835427d25d9683d51013d345f4b3"}
READ_PROFILES = ("QUALIFICATION_READ", "PRODUCTION_READ")
POLICY_SCHEMA = "vidtoolz.resolveProductionReadRuntimePolicy.v1"
AUTHORITY_SCHEMA = "vidtoolz.resolveProductionReadAuthority.v1"
ACCEPTED_FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"   # the only facade this worker candidate is authored for; a policy naming another facade is unusable here
APPROVERS = ("Mikko",)                                                  # repository convention: human acceptance is recorded by Mikko (see adjudications/*ACCEPTANCE.json decided_by)
NETWORK_TYPES = ("QPSQL", "POSTGRESQL", "POSTGRES", "NETWORK")
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
    """Root path registered for a Disk library in Resolve's .dblist (name:path::::DISK). Credential fields are never read."""
    try:
        for line in open(os.path.join(resolve_config_dir(), ".dblist"), "rb").read().decode("utf-8", "replace").splitlines():
            parts = line.split(":")
            if len(parts) >= 2 and parts[0] == name and line.rstrip().endswith("DISK"): return parts[1]
    except OSError: return None
    return None
# ^ FROZEN Phase 1 bytes, untouched: this is the QUALIFICATION_READ gate's parser. PRODUCTION_READ never calls it and uses the
# strict per-platform parser below instead (PRR-F03): a production repair must not change qualification semantics.

# ---------------------------------------------------------------- production-read authority + policy (accepted, pinned, deny by default)
def canonical_sha256(obj): return sha(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode())

def _refuse(reason, message, **detail): raise OpError("LIBRARY_MISMATCH", message + "; fail closed", dict(detail, reason=reason))

def verify_accepted_authority(raw):
    """Semantic acceptance check the WORKER performs itself on the source record bytes (PRR-F01/F02). Not a schema check
    (the compiler does that): this is the minimum set of facts that make a record a human-accepted grant. Returns the
    parsed record. Any defect refuses."""
    try: rec = json.loads(raw)
    except ValueError: _refuse("AUTHORITY_INVALID", "authority record is not valid JSON")
    if not isinstance(rec, dict) or rec.get("schema") != AUTHORITY_SCHEMA: _refuse("AUTHORITY_INVALID", "authority record has the wrong schema")
    if rec.get("status") != "ACCEPTED": _refuse("AUTHORITY_NOT_ACCEPTED", f"authority status is {rec.get('status')!r}, not ACCEPTED (a candidate never authorizes)")
    if rec.get("approved_by") not in APPROVERS: _refuse("AUTHORITY_NOT_ACCEPTED", "authority record has no valid human approver")
    if not isinstance(rec.get("approved_at"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T[0-9:.+Z-]+)?", rec["approved_at"]): _refuse("AUTHORITY_NOT_ACCEPTED", "authority record has no approval date")
    if not isinstance(rec.get("acceptance_record"), str) or not rec["acceptance_record"].strip(): _refuse("AUTHORITY_NOT_ACCEPTED", "authority record names no acceptance record")
    if rec.get("write_authority") != "NONE" or rec.get("persistent_worker_authority") != "NONE" or rec.get("external_scripting") != "Local": _refuse("AUTHORITY_INVALID", "authority record does not retain NONE/NONE/Local boundaries")
    if sorted(rec.get("operations") or []) != sorted(READ_ONLY_OPS): _refuse("AUTHORITY_INVALID", "authority operations are not exactly the nine read operations")
    if not isinstance(rec.get("hosts"), list) or not rec["hosts"]: _refuse("AUTHORITY_NOT_ACCEPTED", "accepted authority grants no host (empty is never a grant)")
    return rec

def _source_grants(rec, host_id):
    """{(name, registration_root): set(project_uuid)} the SOURCE record grants to this host."""
    out = {}
    for h in rec["hosts"]:
        if str(h.get("host_id", "")).lower() != host_id.lower(): continue
        for lib in h.get("libraries") or []:
            out[(lib.get("name"), lib.get("registration_root"))] = {p.get("project_uuid") if isinstance(p, dict) else p for p in (lib.get("projects") or [])}
    return out

def load_production_policy(path, expected_sha256, authority_path, host_id, own_sha256):
    """Load and verify the compiled runtime policy against: the pinned file digest, its embedded body digest, its schema, the
    ACCEPTED source authority bytes (digest AND semantics), this worker's own bytes, the accepted facade identity, the host,
    and the grant shape. Fails closed on any defect. Re-run at EVERY operation (nothing cached)."""
    try: raw = open(path, "rb").read()
    except OSError as e: _refuse("PRODUCTION_POLICY_MISSING", "production-read policy unavailable", cause=type(e).__name__)
    if sha(raw) != expected_sha256: _refuse("PRODUCTION_POLICY_PIN_MISMATCH", "production-read policy digest does not match the pinned digest", expected=expected_sha256, actual=sha(raw))
    try: pol = json.loads(raw)
    except ValueError: _refuse("PRODUCTION_POLICY_INVALID", "production-read policy is not valid JSON")
    if not isinstance(pol, dict) or pol.get("schema") != POLICY_SCHEMA: _refuse("PRODUCTION_POLICY_INVALID", "production-read policy has the wrong schema")
    body = {k: v for k, v in pol.items() if k != "policy_sha256"}
    if pol.get("policy_sha256") != canonical_sha256(body): _refuse("PRODUCTION_POLICY_INVALID", "production-read policy body does not match its embedded digest")
    if pol.get("live") is not True or pol.get("authority_status") != "ACCEPTED": _refuse("AUTHORITY_NOT_ACCEPTED", "policy is a non-live preview or was not compiled from an ACCEPTED authority")
    # -- source authority: bytes AND semantics, verified here, not trusted from the policy
    try: araw = open(authority_path, "rb").read()
    except OSError as e: _refuse("AUTHORITY_MISSING", "accepted authority record unavailable", cause=type(e).__name__)
    if sha(araw) != pol.get("source_record_sha256"): _refuse("AUTHORITY_SOURCE_MISMATCH", "authority record bytes do not match the digest the policy was compiled from", expected=pol.get("source_record_sha256"), actual=sha(araw))
    rec = verify_accepted_authority(araw)
    # -- identity pins: this worker's own bytes and the accepted facade
    if pol.get("worker_sha256") != own_sha256 or (rec.get("worker_identity") or {}).get("worker_sha256") != own_sha256: _refuse("WORKER_IDENTITY_MISMATCH", "policy/authority are not for this worker's bytes", expected=own_sha256, policy=pol.get("worker_sha256"))
    if pol.get("facade_commit") != ACCEPTED_FACADE_COMMIT or (rec.get("facade_identity") or {}).get("commit") != ACCEPTED_FACADE_COMMIT: _refuse("FACADE_IDENTITY_MISMATCH", "policy/authority name a facade this worker was not authored for", expected=ACCEPTED_FACADE_COMMIT, policy=pol.get("facade_commit"))
    if sorted(pol.get("operations") or []) != sorted(READ_ONLY_OPS): _refuse("PRODUCTION_POLICY_INVALID", "policy operations are not exactly the nine read operations")
    hosts = pol.get("hosts")
    if not isinstance(hosts, dict) or not hosts: _refuse("PRODUCTION_POLICY_INVALID", "policy grants no host")
    host = next((h for k, h in hosts.items() if k.lower() == host_id.lower()), None)
    if not host: _refuse("HOST_NOT_AUTHORIZED", "policy grants nothing to this host", host=host_id)
    libs = host.get("libraries")
    if not isinstance(libs, list) or not libs: _refuse("PRODUCTION_POLICY_INVALID", "policy host entry grants no library")
    src = _source_grants(rec, host_id); seen = set()
    for lib in libs:
        if not isinstance(lib, dict) or lib.get("kind") != "Disk": _refuse("PRODUCTION_POLICY_INVALID", "policy library is not a Disk library (v1 supports Disk only)")
        name, root, canon = lib.get("name"), lib.get("registration_root"), lib.get("canonical_root")
        for v in (name, root, canon):
            if not isinstance(v, str) or not v.strip() or v.strip() == "*" or any(ch in v for ch in "?[]"): _refuse("PRODUCTION_POLICY_WILDCARD", "policy library identity must be a literal non-empty string")
        if (name, root) in seen: _refuse("PRODUCTION_POLICY_INVALID", "duplicate library entry in policy"); seen.add((name, root))
        projs = lib.get("projects")
        if not isinstance(projs, list) or not projs: _refuse("PRODUCTION_POLICY_WILDCARD", "policy library lists no project UUIDs (empty never means all)", library=name)
        for u in projs:
            if not isinstance(u, str) or not UUID_RE.match(u): _refuse("PRODUCTION_POLICY_WILDCARD", "policy project entry is not an RFC 4122 UUID", library=name, entry=str(u)[:60])
        if set(projs) - src.get((name, root), set()): _refuse("AUTHORITY_SOURCE_MISMATCH", "policy grants a project the accepted authority does not", library=name)
    return pol, rec

# ---------------------------------------------------------------- production-read library identity (dedicated parser; frozen parser untouched)
def registration_file():
    return os.path.join(resolve_config_dir(), "dblist.conf" if platform.system() == "Windows" else ".dblist")

def parse_registration_production(text, plat=None):
    r"""STRICT registration grammar (PRR-F03), from the sealed vidnux/PRESTO/VIDLAP2 files. Every non-blank line must be one of:
      Linux   Disk:    name:/abs/path::::DISK                 -> 6 colon fields [name, path, "", "", "", "DISK"]
      Windows Disk:    name:X\path:*:::DISK                   -> 6 fields [name, X\path, "*", "", "", "DISK"]  (drive colon absent in the serialized field)
      network:         name:host:postgres:DaVinci:db:QPSQL   -> 6 fields, type QPSQL (recorded as kind NETWORK, never authorizable)
    Anything else (truncated record, unknown type suffix such as NOTDISK, wrong field count, relative/UNC/quoted root, empty name)
    makes the whole file INVALID -> refuse. Returns [{name, kind, root|None, raw}]."""
    plat = plat or platform.system(); out = []
    for ln, line in enumerate(text.splitlines(), 1):
        line = line.rstrip("\r\n")
        if not line.strip(): continue
        f = line.split(":")
        if len(f) != 6 or not f[0].strip() or f[0] != f[0].strip() or f[0] == "*": _refuse("REGISTRATION_INVALID", "registration file has a malformed record", line=ln)
        if f[5] == "DISK":
            root = f[1]
            if plat == "Windows":
                if f[2:5] != ["*", "", ""] or not re.fullmatch(r"[A-Za-z]\\[^\\\"'?*<>|][^\"'?*<>|]*", root) or "\\\\" in root or "/" in root: _refuse("REGISTRATION_INVALID", "malformed Windows Disk registration", line=ln)
                canon_in = root[0] + ":" + root[1:]
            else:
                if f[2:5] != ["", "", ""] or not root.startswith("/") or root.startswith("//") or '"' in root or "'" in root: _refuse("REGISTRATION_INVALID", "malformed Disk registration root (must be absolute, not UNC, unquoted)", line=ln)
                canon_in = root
            if any(seg in ("", ".", "..") for seg in re.split(r"[\\/]", canon_in.split(":", 1)[-1])[1:]): _refuse("REGISTRATION_INVALID", "registration root contains empty, '.' or '..' segments", line=ln)
            out.append({"name": f[0], "kind": "Disk", "root": root, "path": canon_in, "raw": line})
        elif f[5].upper() in NETWORK_TYPES: out.append({"name": f[0], "kind": "NETWORK", "root": None, "path": None, "raw": line})
        else: _refuse("REGISTRATION_INVALID", "unknown registration type suffix", line=ln, suffix=f[5][:20])
    return out

def resolve_physical_root(path):
    """Canonical physical identity of a registered Disk root: strict realpath (symlinks/junctions resolved, must exist, must be a
    directory) plus device/inode (Windows: volume serial / file index via os.stat). Returns {"realpath", "dev", "ino"}."""
    try: rp = os.path.realpath(path, strict=True); st = os.stat(rp)
    except (OSError, ValueError) as e: _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "registered Disk root does not resolve to an existing directory", path=path, cause=type(e).__name__)
    if not os.path.isdir(rp): _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "registered Disk root is not a directory", path=path)
    if platform.system() == "Windows": rp_cmp = os.path.normcase(rp)
    else: rp_cmp = rp
    return {"realpath": rp_cmp, "dev": st.st_dev, "ino": st.st_ino}

def canon_compare(a, b): return (os.path.normcase(a) == os.path.normcase(b)) if platform.system() == "Windows" else (a == b)

def unique_disk_registration(entries, name):
    """Exactly one Disk entry with this name AND no other entry (any name) sharing its canonical path; else AMBIGUOUS."""
    same = [e for e in entries if e["name"] == name]
    if len(same) != 1 or same[0]["kind"] != "Disk": _refuse("REGISTRATION_AMBIGUOUS", "registration does not hold exactly one Disk entry for the current library name", name=name, matches=len(same))
    e = same[0]
    if any(o is not e and o["kind"] == "Disk" and canon_compare(o["path"], e["path"]) for o in entries): _refuse("REGISTRATION_AMBIGUOUS", "another registration shares this library's root", name=name)
    return e

UUID_BYTES_RE = None
def project_content_anchor(realpath, proj, tls, project_names):
    """Bind the OPEN handle to the PHYSICAL root (PRR-F03 redirection/clone law): under <root>/Resolve Projects/Users/*/Projects/
    exactly one project directory carries the current project's name, its Project.db contains the current project UUID and every
    reported timeline UUID, and the on-disk project set equals Resolve's project list for the current library. A registration
    pointing at a different physical library, or a diverged clone, fails. (A byte-identical clone is indistinguishable by any
    read-only observation and discloses nothing beyond the authorized bytes — documented residual.)"""
    base = os.path.join(realpath, "Resolve Projects", "Users")
    try: users = sorted(os.listdir(base))
    except OSError: _refuse("CONTENT_ANCHOR_MISSING", "physical root has no Resolve Projects/Users tree", realpath=realpath)
    hits, on_disk = [], set()
    for u in users:
        pdir = os.path.join(base, u, "Projects")
        try: names = os.listdir(pdir)
        except OSError: continue
        for n in names:
            if os.path.isdir(os.path.join(pdir, n)): on_disk.add(n)
            if n == proj["name"] and os.path.isfile(os.path.join(pdir, n, "Project.db")): hits.append(os.path.join(pdir, n, "Project.db"))
    if len(hits) != 1: _refuse("CONTENT_ANCHOR_MISMATCH", "current project is not present exactly once under the physical root", project=proj["name"], hits=len(hits))
    try: blob = open(hits[0], "rb").read()
    except OSError: _refuse("CONTENT_ANCHOR_MISSING", "cannot read Project.db under the physical root")
    low = blob.lower()
    want = [proj["uuid"]] + [t["uuid"] for t in (tls or []) if t.get("uuid")]
    missing = [u for u in want if u.lower().encode() not in low]
    if missing: _refuse("CONTENT_ANCHOR_MISMATCH", "Project.db under the physical root does not contain the identities Resolve reports (redirected registration or diverged clone)", missing=missing[:4])
    if project_names is not None and set(project_names) != on_disk: _refuse("CONTENT_ANCHOR_MISMATCH", "project set on disk differs from the project list Resolve reports for the current library", on_disk=len(on_disk), reported=len(project_names))
    return {"project_db": hits[0], "project_db_sha256": sha(blob), "project_db_bytes": len(blob)}

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
def load_production_api():
    """Production loader: the real DaVinciResolveScript ONLY. Refuses to start if any test-substitution variable is present
    (F06): a fake identity oracle must never be selectable from the production CLI or environment."""
    bad = sorted(k for k in os.environ if k.upper().startswith("VRC_FAKE") or k.upper() in ("RESOLVE_FAKE_API", "VRC_TEST_API"))
    if bad: raise SystemExit("REFUSED: test substitution variables present in production environment: " + ",".join(bad))
    return _load_real_api()

def load_api():
    """TEST SEAM (offline suites only; never called by main()). Honors VRC_FAKE_RESOLVE so the frozen Phase 1 suites run unchanged."""
    if os.environ.get("VRC_FAKE_RESOLVE"):
        sys.path.insert(0, os.path.dirname(os.environ["VRC_FAKE_RESOLVE"])); import fake_resolve; return fake_resolve
    return _load_real_api()

def _load_real_api():
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
    tl = tl_identity(p.GetCurrentTimeline())
    if project_check: project_check(res, proj, pm, p, tl)
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
    def __init__(self, host_id, secret, state_dir, api, require_library=None, mode="QUALIFICATION_READ", policy_path=None, policy_sha256=None, authority_path=None):
        hn = socket.gethostname()
        if hn.lower() != host_id.lower(): raise SystemExit(f"HOST_ID_MISMATCH: --host-id {host_id} but hostname is {hn}")
        self.host_id, self.secret, self.state_dir, self.api = host_id, secret, state_dir, api
        self.require_library = require_library            # (name, root_or_None) or None  (QUALIFICATION_READ gate, frozen semantics)
        if mode not in READ_PROFILES: raise SystemExit(f"REFUSED: unknown --mode {mode!r}")
        self.mode, self.policy_path, self.policy_sha256, self.authority_path = mode, policy_path, policy_sha256, authority_path
        self.own_sha256 = sha(open(os.path.abspath(__file__), "rb").read())      # this worker's own bytes: the identity policies must name
        if mode == "PRODUCTION_READ":
            if require_library: raise SystemExit("REFUSED: --require-library is a QUALIFICATION_READ gate; PRODUCTION_READ takes only --production-policy/--production-authority")
            if not (policy_path and policy_sha256 and authority_path): raise SystemExit("REFUSED: PRODUCTION_READ requires --production-policy PATH, --production-policy-sha256 DIGEST and --production-authority PATH")
            try: load_production_policy(policy_path, policy_sha256, authority_path, host_id, self.own_sha256)   # startup: fail closed before binding
            except OpError as e: raise SystemExit(f"REFUSED: {e.message} {json.dumps(e.detail)}")
        elif policy_path or policy_sha256 or authority_path: raise SystemExit("REFUSED: --production-policy/--production-authority are only valid with --mode PRODUCTION_READ")
        os.makedirs(state_dir, exist_ok=True)
        gpath = os.path.join(state_dir, "generation")
        gen = int(open(gpath).read() or 0) + 1 if os.path.exists(gpath) else 1
        open(gpath, "w").write(str(gen))
        self.identity = {"host_id": host_id, "hostname": hn, "platform": platform.system().lower(),
                         "worker_instance_id": uuid.uuid4().hex, "worker_generation": gen,
                         "worker_started_at": now_iso(), "worker_version": WORKER_VERSION, "protocol": PROTOCOL,
                         "read_profile": mode, "production_policy_sha256": policy_sha256, "worker_sha256": self.own_sha256, "derived_from": DERIVED_FROM}
        self.replay = ReplayGuard(os.path.join(state_dir, "replay.jsonl"))
        self.pool = ResolvePool()
        self.jlock = threading.Lock(); self.journal = open(os.path.join(state_dir, "journal.jsonl"), "a")
        self.last_resolve = None                           # last successful snapshot summary {observed_at, available, version, project_uuid}
        self.journal_event({"event": "WORKER_START", "worker_instance_id": self.identity["worker_instance_id"], "worker_generation": gen,
                            "replay_entries_loaded": self.replay.loaded, "require_library": require_library and require_library[0],
                            "read_profile": mode, "production_policy_sha256": policy_sha256, "worker_sha256": self.own_sha256})

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

    # ---- PRODUCTION_READ gates (operation-time; nothing cached across calls; every decision journaled)
    # The authorization record is a PER-REQUEST slot owned by handle(), not a field of the snapshot dict: a refusal discards the
    # snapshot, so a decision recorded there would be lost exactly when it matters most (PRR-F04). Stages: policy | library |
    # project | content (gates), resolve (Resolve state insufficient), pre-resolve (refused before any Resolve attach).
    def new_authz(self):
        return ({"read_profile": "PRODUCTION_READ", "decision": "NOT_REACHED", "stage": None, "policy_sha256": self.policy_sha256}
                if self.mode == "PRODUCTION_READ" else {"read_profile": self.mode, "decision": "NOT_APPLICABLE"})
    def _deny(self, a, stage, err):
        a.update(decision="DENIED", stage=stage, reason=(err.detail or {}).get("reason") or err.code, code=err.code); raise err
    def _gates(self, a):
        """(library_check, project_check) for snapshot(); production gates are bound to this request's authorization slot."""
        if self.mode != "PRODUCTION_READ": return self.check_library, None
        return (lambda res: self.check_library_production(res, a)), (lambda res, proj, pm, p, tl: self.check_project_production(res, proj, pm, p, tl, a))

    def _policy_libraries(self):
        pol, _ = load_production_policy(self.policy_path, self.policy_sha256, self.authority_path, self.host_id, self.own_sha256)   # re-verified EVERY call
        return next(h for k, h in pol["hosts"].items() if k.lower() == self.host_id.lower())["libraries"]

    def check_library_production(self, res, a):
        res["authorization"] = a                     # same object: a success mirrors into the envelope, a refusal survives in handle()'s slot
        lib = res.get("library") or {}
        actual = {"name": lib.get("name"), "type": lib.get("type"), "host": lib.get("host")}; a["library_observed"] = actual
        try:
            libs = self._policy_libraries()
        except OpError as e: self._deny(a, "policy", e)
        try:
            if not lib.get("name"): _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "current library identity unavailable", actual=actual)
            if str(lib.get("type", "")).lower() != "disk" or str(lib.get("type", "")).upper() in NETWORK_TYPES or lib.get("host"): _refuse("LIBRARY_NOT_AUTHORIZED", "network/PostgreSQL libraries are not authorized by this candidate (v1: Disk only)", actual=actual)
            try: text = open(registration_file(), "rb").read().decode("utf-8", "replace")
            except OSError: _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "library registration file unreadable", actual=actual)
            entries = parse_registration_production(text)
            e = unique_disk_registration(entries, lib["name"])
            phys = resolve_physical_root(e["path"])
            match = [l for l in libs if l["kind"] == "Disk" and l["name"] == lib["name"] and l["registration_root"] == e["root"] and canon_compare(l["canonical_root"], phys["realpath"])]
            if len(match) != 1: _refuse("LIBRARY_NOT_AUTHORIZED", "current library (name + registration root + physical root) is not an authorized production-read library on this host", actual=dict(actual, registration_root=e["root"], realpath=phys["realpath"]), candidates_matched=len(match))
            pin = match[0]
            for k in ("physical_dev", "physical_ino"):
                if pin.get(k) is not None and pin[k] != phys["dev" if k.endswith("dev") else "ino"]: _refuse("LIBRARY_NOT_AUTHORIZED", "physical root device/inode differs from the pinned identity", actual=phys)
            a.update(library={"kind": "Disk", "name": lib["name"], "registration_root": e["root"], "realpath": phys["realpath"], "dev": phys["dev"], "ino": phys["ino"]}, allowed_projects=len(pin["projects"]))
        except OpError as e: self._deny(a, "library", e)

    def check_project_production(self, res, proj, pm, p, tl, a):
        """Double gate + content anchor: the CURRENT project UUID must be listed under the CURRENT (authorized) library, and the
        open handle must be evidenced under the physical root (Project.db contains the project and timeline UUIDs; project set matches)."""
        res["authorization"] = a; libm = a.get("library")
        try:
            if not libm: _refuse("LIBRARY_NOT_AUTHORIZED", "project gate reached without an authorized library")
        except OpError as e: self._deny(a, "library", e)
        try:
            entry = [l for l in self._policy_libraries() if l["kind"] == "Disk" and l["name"] == libm["name"] and l["registration_root"] == libm["registration_root"]]
        except OpError as e: self._deny(a, "policy", e)
        try:
            allowed = entry[0]["projects"] if len(entry) == 1 else []
            a["project_observed"] = {"name": proj.get("name"), "uuid": proj.get("uuid")}
            if not proj.get("uuid") or proj["uuid"] not in allowed:
                raise OpError("PROJECT_IDENTITY_MISMATCH", "current project is not an authorized production-read project in this library", {"reason": "PROJECT_NOT_AUTHORIZED", "actual": {"name": proj.get("name"), "uuid": proj.get("uuid")}, "library": libm["name"]})
        except OpError as e: self._deny(a, "project", e)
        try:
            tls = [tl_identity(p.GetTimelineByIndex(i), i) for i in range(1, (proj.get("timeline_count") or 0) + 1)]
            lister = getattr(pm, "GetProjectListInCurrentFolder", None)
            names = lister() if callable(lister) else None
            if names is None: _refuse("CONTENT_ANCHOR_MISSING", "Resolve does not expose the current library's project list; handle cannot be bound to the physical root")
            anchor = project_content_anchor(libm["realpath"], proj, tls, names)
        except OpError as e: self._deny(a, "content", e)
        a.update(decision="ALLOWED", stage="content", project_uuid=proj["uuid"], content_anchor=anchor)

    # ---- request execution
    def execute(self, env, deadline_s, a):
        op, params = env.get("op"), env.get("params") or {}
        if not env.get("target_host"): raise OpError("TARGET_REQUIRED", "envelope has no target_host; there is no default target")
        if str(env["target_host"]).lower() != self.host_id.lower(): raise OpError("TARGET_MISMATCH", f"envelope targets {env.get('target_host')!r}, this worker is {self.host_id}")
        if op in FORBIDDEN_OPS: raise OpError("READ_ONLY_MODE", f"{op} is a write-class operation; Phase 1 worker has no write authority")
        if op not in READ_ONLY_OPS: raise OpError("UNSUPPORTED_OPERATION", str(op))
        base = {"process": resolve_process(), "external_scripting_mode": external_scripting_mode()}
        if op == "health": return self.health(base, deadline_s, a)
        try: return self.pool.run(lambda: self.resolve_section(op, params, env.get("expected"), base, a), deadline_s)
        except OpError as e:
            if e.code == "RESOLVE_UNAVAILABLE": e.detail = {"resolve": {"available": False, **base}}
            raise

    def health(self, base, deadline_s, a=None):
        """Worker liveness + pool state + a BOUNDED Resolve probe that is skipped when the pool is saturated.
        Never blocks on Resolve longer than HEALTH_PROBE_S; never fails because Resolve is hung or absent."""
        pool = self.pool.snapshot(); res = {"available": None, "probe": None, "pool": pool, "last_observed": self.last_resolve, **base}
        proj = tl = None; a = a if a is not None else self.new_authz(); lib_check, proj_check = self._gates(a)
        if pool["state"] == "SATURATED": res["probe"] = "SKIPPED_SATURATED"
        else:
            try:
                _, _, _, r, proj, tl = self.pool.run(lambda: snapshot(self.api, lib_check, proj_check), min(HEALTH_PROBE_S, deadline_s))
                res.update(r); res["probe"] = "OK"; self.note_resolve(r, proj)
            except FutTimeout: res["probe"] = "TIMEOUT"
            except OpError as e:
                res["probe"] = e.code; res["available"] = None if e.code in ("LIBRARY_MISMATCH", "PROJECT_IDENTITY_MISMATCH") else False   # not authorized: Resolve is there, but this worker may not read it
                if e.code == "LIBRARY_MISMATCH": res["library_gate"] = e.detail
                if e.code == "PROJECT_IDENTITY_MISMATCH": res["project_gate"] = e.detail
                if self.mode == "PRODUCTION_READ" and a.get("decision") not in ("DENIED", "ALLOWED"):
                    a.update(decision="NOT_REACHED", stage="resolve", reason=e.code, code=e.code)   # Resolve state insufficient: authorization was never evaluated
        if self.mode == "PRODUCTION_READ": res["authorization"] = a
        res["pool"] = self.pool.snapshot()
        return {"resolve": res, "project": proj, "timeline": tl, "result": {"worker_alive": True, "pool_state": res["pool"]["state"]}}

    def note_resolve(self, res, proj):
        self.last_resolve = {"observed_at": now_iso(), "available": True, "version": res.get("version"), "library": (res.get("library") or {}).get("name"), "project_uuid": proj and proj["uuid"]}

    def resolve_section(self, op, params, expected, base, a=None):
        a = a if a is not None else self.new_authz(); lib_check, proj_check = self._gates(a)
        r, pm, p, res, proj, tl = snapshot(self.api, lib_check, proj_check)   # the only Resolve attachment; library gate before any project read, project gate before any timeline/settings/media read
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

    def _journal_authorization(self, out, env, a):
        """PRR-F04: one explicit authorization decision per PRODUCTION_READ request, taken from this request's slot and recorded
        separately from transport/Resolve health. ALLOWED | DENIED | NOT_REACHED | NOT_APPLICABLE, with the deciding stage."""
        if self.mode != "PRODUCTION_READ": return {"read_profile": self.mode, "decision": "NOT_APPLICABLE"}
        a = dict(a); err = out.get("error") or {}
        if a.get("decision") in (None, "PENDING", "NOT_REACHED") and err:
            code = a.get("code") or err.get("code")
            a.update(decision="NOT_REACHED" if code in ("RESOLVE_UNAVAILABLE", "TIMEOUT", "WORKER_SATURATED", "PROJECT_NOT_OPEN", "TIMELINE_NOT_FOUND") else "DENIED",
                     stage=a.get("stage") or ("resolve" if (a.get("library") or code in ("RESOLVE_UNAVAILABLE", "TIMEOUT", "WORKER_SATURATED", "PROJECT_NOT_OPEN", "TIMELINE_NOT_FOUND")) else "pre-resolve"),
                     reason=a.get("reason") or (err.get("detail") or {}).get("reason") or err.get("code"), code=code)
        a["target"] = env.get("target_host"); a["op"] = env.get("op")
        lib = a.get("library") or {}; a["library"] = {k: lib.get(k) for k in ("kind", "name", "registration_root", "realpath", "dev", "ino")} if lib else a.get("library_observed")
        a.pop("allowed_projects", None); ca = a.get("content_anchor"); a["content_anchor"] = {"project_db_sha256": ca.get("project_db_sha256")} if isinstance(ca, dict) else None
        return a

    def handle(self, env, deadline_ms, client=None):
        """Ordering: (auth + replay already verified by the handler) → gates → execute → JOURNAL → respond."""
        t0 = time.time(); rid = env.get("request_id") or uuid.uuid4().hex
        out = {"protocol": PROTOCOL, "request_id": rid, "host_id": self.host_id, "worker": self.identity, "mode": "READ_ONLY",
               "write_authority": "NONE", "write_lease": None, "observed_at": now_iso(), "read_profile": self.mode}
        authz = self.new_authz()
        try:
            out.update(self.execute(env, max(1, deadline_ms) / 1000, authz)); out["ok"] = True
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
            "read_profile": self.mode, "transport_ok": True, "probe": (out.get("resolve") or {}).get("probe"), "authorization": self._journal_authorization(out, env, authz)})
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

class Once(argparse.Action):
    """PRR-P301: a security-relevant flag given twice is a configuration conflict, not a preference; refuse instead of last-wins."""
    def __call__(self, parser, ns, values, option_string=None):
        if getattr(ns, self.dest, None) is not None: parser.error(f"{option_string} given more than once")
        setattr(ns, self.dest, values)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--host-id", required=True, action=Once); ap.add_argument("--port", type=int, default=47021)
    ap.add_argument("--secret-file", required=True); ap.add_argument("--state-dir", required=True); ap.add_argument("--bind", default=BIND)
    ap.add_argument("--exit-with-session", action="store_true", help="exit when the controlling ssh session (nearest sshd ancestor) exits; refuse to start without one")
    ap.add_argument("--liveness-port", type=int, help="reverse-forwarded loopback port that reaches the controller's sshd through the owning ssh connection; probed periodically")
    ap.add_argument("--liveness-interval", type=int, default=60); ap.add_argument("--liveness-strikes", type=int, default=3)
    ap.add_argument("--require-library", action=Once, help="QUALIFICATION_READ gate: NAME or NAME=ROOT; every Resolve op fails closed (LIBRARY_MISMATCH) unless the open library is this Disk library")
    ap.add_argument("--mode", action=Once, choices=READ_PROFILES, help="explicit read profile (default QUALIFICATION_READ); PRODUCTION_READ requires a compiled, pinned policy AND the accepted authority record and never infers itself from the open library")
    ap.add_argument("--production-policy", action=Once, help="PRODUCTION_READ: path to the compiled runtime policy (vidtoolz.resolveProductionReadRuntimePolicy.v1)")
    ap.add_argument("--production-policy-sha256", action=Once, help="PRODUCTION_READ: pinned sha256 of the policy FILE; re-verified at every operation")
    ap.add_argument("--production-authority", action=Once, help="PRODUCTION_READ: path to the ACCEPTED source authority record the policy was compiled from; bytes and acceptance semantics re-verified at every operation")
    a = ap.parse_args()
    if a.mode is None: a.mode = "QUALIFICATION_READ"
    if a.bind != BIND: raise SystemExit("LOOPBACK_ONLY: worker binds 127.0.0.1 only; refusing --bind " + a.bind)
    secret = open(a.secret_file, "rb").read().strip()
    if len(secret) < 32: raise SystemExit("REFUSED: secret too short")
    req = None
    if a.require_library:
        name, _, root = a.require_library.partition("="); req = (name, root or None)
        if name in PROHIBITED_LIBRARIES: raise SystemExit("REFUSED: --require-library names a prohibited library")
    srv = ThreadingHTTPServer((BIND, a.port), Handler); srv.worker = Worker(a.host_id, secret, a.state_dir, load_production_api(), req, a.mode, a.production_policy, a.production_policy_sha256, a.production_authority)
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
                      "require_library": req and req[0], "read_profile": a.mode, "production_policy_sha256": a.production_policy_sha256, "worker_sha256": srv.worker.own_sha256,
                      "replay_entries_loaded": srv.worker.replay.loaded}), flush=True); srv.serve_forever()

if __name__ == "__main__": main()
