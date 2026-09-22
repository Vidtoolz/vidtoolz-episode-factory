#!/usr/bin/env python3
"""VIDTOOLZ Resolve worker — production-read CANDIDATE 0.2.0 (derived from frozen Phase 1 0.1.1, READ ONLY).

Adds an explicit read profile (--mode). QUALIFICATION_READ keeps the frozen 0.1.1 library-gate behaviour unchanged.
PRODUCTION_READ (v1: vidnux/Linux only) authorizes reads ONLY inside an ISOLATED_DISK_SESSION: an ACCEPTED human authority is
compiled into a digest-pinned policy, a deterministic profile registering EXACTLY ONE authorized Disk library is sealed, and the
worker reads only a Resolve process that started AFTER that seal, under that exact profile, owned by this user, alone on the host,
and owning the scripting endpoint — then only the allowlisted project UUID. Registration text and project UUIDs can be forged or
cloned, so they never establish identity on their own; session provenance does. Never opens, loads or switches a project or
library. WRITE AUTHORITY = NONE. PERSISTENT WORKER AUTHORITY = NONE.

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
import argparse, datetime, hashlib, hmac, json, os, platform, re, socket, subprocess, sys, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORKER_VERSION = "0.3.0-production-read-isolated-session-candidate"
DERIVED_FROM = {"component": "resolve-control-plane phase1 0.1.1", "commit": "77c26103dfe88c448267a9c1efe7f34a20a39375", "worker_sha256": "371caf131e5d21cdb8b5f3e505934154b7ee835427d25d9683d51013d345f4b3"}
READ_PROFILES = ("QUALIFICATION_READ", "PRODUCTION_READ")
POLICY_SCHEMA = "vidtoolz.resolveProductionReadRuntimePolicy.v1"
AUTHORITY_SCHEMA = "vidtoolz.resolveProductionReadAuthority.v1"
PROFILE_SCHEMA = "vidtoolz.resolveProductionReadSessionProfile.v1"
AUTHORITY_STATUSES = ("CANDIDATE_FOR_INDEPENDENT_REVIEW", "ACCEPTED", "SUPERSEDED", "REJECTED")
SESSION_PROFILE_TYPE = "ISOLATED_DISK_SESSION"
PRODUCTION_HOSTS = ("vidnux",)          # v1 is structurally vidnux-only; PRESTO/VIDLAP2/Windows production reads are not authorizable
PRODUCTION_PLATFORM = "Linux"
PROJECT_OPEN_LAW = "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"
NETWORK_LIBRARIES_TEXT = "DEFERRED — not authorized by v1 (EKA, nelja)"
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

# ---------------------------------------------------------------- production-read: accepted authority, policy, sealed session profile
# v1 trust model (isolated session provenance). Registration metadata can be rewritten and a project UUID can be cloned, so neither can
# prove which PHYSICAL library an arbitrary pre-existing Resolve handle represents. This candidate therefore never authorizes an arbitrary
# session: an accepted authority is compiled into a policy, a deterministic profile registering EXACTLY ONE authorized Disk library is
# sealed, and only a Resolve process that was started AFTER that seal, under that exact profile, owned by this user, alone on the host and
# owning the scripting endpoint, may be read. Provenance replaces inference.
def canonical_sha256(obj): return sha(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode())

def _refuse(reason, message, **detail): raise OpError("LIBRARY_MISMATCH", message + "; fail closed", dict(detail, reason=reason))

def _iso_date(v):
    """A real calendar date, not merely a date-shaped string (RRR-P302: 2026-99-99 was accepted before)."""
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v[:10] if len(v) >= 10 else ""): return False
    try: datetime.date.fromisoformat(v[:10]); return True
    except ValueError: return False

def _lit(v):
    return isinstance(v, str) and bool(v.strip()) and v == v.strip() and v != "*" and not any(c in v for c in "?*[]\"'\n\r\t")

def _abs_local_dir(v):
    return _lit(v) and v.startswith("/") and not v.startswith("//") and not any(s in ("", ".", "..") for s in v.split("/")[1:])

def validate_authority_record(rec):
    """Closed-schema validation of the SOURCE record, performed by the worker itself (RRR-F02: the worker previously trusted the
    compiler's validation and could consume a hand-made source/policy pair). Mirrors schemas/resolveProductionReadAuthority.v1."""
    def obj(o, allowed, required, where):
        if not isinstance(o, dict): _refuse("AUTHORITY_INVALID", f"{where} is not an object")
        if set(o) - set(allowed): _refuse("AUTHORITY_INVALID", f"{where} has unknown field(s) {sorted(set(o) - set(allowed))}")
        if set(required) - set(o): _refuse("AUTHORITY_INVALID", f"{where} is missing {sorted(set(required) - set(o))}")
    obj(rec, ("schema", "authority_id", "status", "approved_by", "approved_at", "acceptance_record", "worker_identity", "facade_identity",
              "host_id", "platform", "session_profile_type", "library", "projects", "operations", "write_authority",
              "persistent_worker_authority", "external_scripting", "project_open_law", "network_libraries", "notes"),
        ("schema", "authority_id", "status", "approved_by", "worker_identity", "facade_identity", "host_id", "platform",
         "session_profile_type", "library", "projects", "operations", "write_authority", "persistent_worker_authority",
         "external_scripting", "project_open_law"), "authority record")
    if rec["schema"] != AUTHORITY_SCHEMA: _refuse("AUTHORITY_INVALID", "authority record has the wrong schema")
    if not _lit(rec["authority_id"]): _refuse("AUTHORITY_INVALID", "authority_id must be a literal string")
    if rec["status"] not in AUTHORITY_STATUSES: _refuse("AUTHORITY_INVALID", f"unknown status {rec['status']!r}")
    if rec["host_id"] not in PRODUCTION_HOSTS: _refuse("AUTHORITY_INVALID", f"host {rec['host_id']!r} is not a supported production-read host (v1: vidnux only)")
    if rec["platform"] != PRODUCTION_PLATFORM: _refuse("AUTHORITY_INVALID", "v1 supports Linux only; Windows production reads are structurally unsupported")
    if rec["session_profile_type"] != SESSION_PROFILE_TYPE: _refuse("AUTHORITY_INVALID", "only the isolated Disk session profile type is supported")
    w = rec["worker_identity"]; obj(w, ("component", "worker_sha256", "commit"), ("component", "worker_sha256"), "worker_identity")
    if not (isinstance(w["worker_sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", w["worker_sha256"])): _refuse("AUTHORITY_INVALID", "worker_identity.worker_sha256 must be a sha256")
    f = rec["facade_identity"]; obj(f, ("commit", "tree"), ("commit",), "facade_identity")
    if not (isinstance(f["commit"], str) and re.fullmatch(r"[0-9a-f]{40}", f["commit"])): _refuse("AUTHORITY_INVALID", "facade_identity.commit must be a 40-hex commit")
    lib = rec["library"]; obj(lib, ("kind", "name", "canonical_root", "physical_dev", "physical_ino"), ("kind", "name", "canonical_root", "physical_dev", "physical_ino"), "library")
    if lib["kind"] != "Disk": _refuse("AUTHORITY_INVALID", "v1 authorizes local Disk libraries only (EKA/nelja/PostgreSQL/QPSQL are unsupported)")
    if not _lit(lib["name"]) or lib["name"] in PROHIBITED_LIBRARIES: _refuse("AUTHORITY_INVALID", "library name is not a permitted literal name")
    if not _abs_local_dir(lib["canonical_root"]): _refuse("AUTHORITY_INVALID", "library canonical_root must be an absolute local path (UNC/network roots refused)")
    for k in ("physical_dev", "physical_ino"):
        if not isinstance(lib[k], int) or isinstance(lib[k], bool): _refuse("AUTHORITY_INVALID", f"library.{k} must be an integer")
    if not isinstance(rec["projects"], list) or not rec["projects"]: _refuse("AUTHORITY_INVALID", "projects must be a non-empty list (empty never means all)")
    seen = set()
    for p in rec["projects"]:
        obj(p, ("project_uuid", "label"), ("project_uuid",), "project")
        if not (isinstance(p["project_uuid"], str) and UUID_RE.match(p["project_uuid"])): _refuse("AUTHORITY_INVALID", "project_uuid must be a lowercase RFC 4122 UUID")
        if p["project_uuid"] in seen: _refuse("AUTHORITY_INVALID", "duplicate project_uuid")
        seen.add(p["project_uuid"])
    if sorted(rec["operations"]) != sorted(READ_ONLY_OPS): _refuse("AUTHORITY_INVALID", "operations must be exactly the nine read operations")
    if rec["write_authority"] != "NONE" or rec["persistent_worker_authority"] != "NONE" or rec["external_scripting"] != "Local":
        _refuse("AUTHORITY_INVALID", "authority does not retain NONE/NONE/Local boundaries")
    if rec["project_open_law"] != PROJECT_OPEN_LAW: _refuse("AUTHORITY_INVALID", "project_open_law text is not the governed law")
    if "network_libraries" in rec and rec["network_libraries"] != NETWORK_LIBRARIES_TEXT: _refuse("AUTHORITY_INVALID", "network_libraries text is not the governed v1 text")
    return rec

def verify_accepted_authority(raw):
    """Acceptance is semantic, never mere existence (PRR-F01). Returns the validated, ACCEPTED record."""
    try: rec = json.loads(raw)
    except ValueError: _refuse("AUTHORITY_INVALID", "authority record is not valid JSON")
    validate_authority_record(rec)
    if rec["status"] != "ACCEPTED": _refuse("AUTHORITY_NOT_ACCEPTED", f"authority status is {rec['status']!r}, not ACCEPTED (a candidate never authorizes)")
    if rec["approved_by"] not in APPROVERS: _refuse("AUTHORITY_NOT_ACCEPTED", "authority record has no valid human approver")
    if not _iso_date(rec.get("approved_at")): _refuse("AUTHORITY_NOT_ACCEPTED", "authority record has no real calendar approval date")
    if not (isinstance(rec.get("acceptance_record"), str) and rec["acceptance_record"].strip()): _refuse("AUTHORITY_NOT_ACCEPTED", "authority record names no acceptance record")
    return rec

def load_production_policy(path, expected_sha256, authority_path, host_id, own_sha256):
    """Policy + accepted authority, re-read and re-verified at EVERY operation. Nothing self-declared is trusted: the source record's
    BYTES are hashed here, its semantics revalidated, and the policy's grant must be a subset of the accepted grant on the FULL physical
    tuple (kind, name, canonical_root, dev, ino, projects) — RRR-F02."""
    try: raw = open(path, "rb").read()
    except OSError as e: _refuse("PRODUCTION_POLICY_MISSING", "production-read policy unavailable", cause=type(e).__name__)
    if sha(raw) != expected_sha256: _refuse("PRODUCTION_POLICY_PIN_MISMATCH", "policy digest does not match the pinned digest", expected=expected_sha256, actual=sha(raw))
    try: pol = json.loads(raw)
    except ValueError: _refuse("PRODUCTION_POLICY_INVALID", "policy is not valid JSON")
    if not isinstance(pol, dict) or pol.get("schema") != POLICY_SCHEMA: _refuse("PRODUCTION_POLICY_INVALID", "policy has the wrong schema")
    body = {k: v for k, v in pol.items() if k != "policy_sha256"}
    if pol.get("policy_sha256") != canonical_sha256(body): _refuse("PRODUCTION_POLICY_INVALID", "policy body does not match its embedded digest")
    if pol.get("live") is not True or pol.get("authority_status") != "ACCEPTED": _refuse("AUTHORITY_NOT_ACCEPTED", "policy is a non-live preview or was not compiled from an ACCEPTED authority")
    try: araw = open(authority_path, "rb").read()
    except OSError as e: _refuse("AUTHORITY_MISSING", "accepted authority record unavailable", cause=type(e).__name__)
    if sha(araw) != pol.get("source_record_sha256"): _refuse("AUTHORITY_SOURCE_MISMATCH", "authority bytes do not match the digest the policy was compiled from", expected=pol.get("source_record_sha256"), actual=sha(araw))
    rec = verify_accepted_authority(araw)
    if pol.get("worker_sha256") != own_sha256 or rec["worker_identity"]["worker_sha256"] != own_sha256:
        _refuse("WORKER_IDENTITY_MISMATCH", "policy/authority are not for this worker's bytes", expected=own_sha256, policy=pol.get("worker_sha256"))
    if pol.get("facade_commit") != ACCEPTED_FACADE_COMMIT or rec["facade_identity"]["commit"] != ACCEPTED_FACADE_COMMIT:
        _refuse("FACADE_IDENTITY_MISMATCH", "policy/authority name a facade this worker was not authored for", expected=ACCEPTED_FACADE_COMMIT, policy=pol.get("facade_commit"))
    if sorted(pol.get("operations") or []) != sorted(READ_ONLY_OPS): _refuse("PRODUCTION_POLICY_INVALID", "policy operations are not exactly the nine read operations")
    if pol.get("host_id") != host_id or host_id not in PRODUCTION_HOSTS: _refuse("HOST_NOT_AUTHORIZED", "policy does not grant this host", host=host_id, policy_host=pol.get("host_id"))
    if pol.get("host_id") != rec["host_id"]: _refuse("AUTHORITY_SOURCE_MISMATCH", "policy host differs from the accepted authority host")
    if pol.get("platform") != PRODUCTION_PLATFORM or pol.get("session_profile_type") != SESSION_PROFILE_TYPE: _refuse("PRODUCTION_POLICY_INVALID", "policy platform/session type is not the supported isolated Linux Disk session")
    plib, alib = pol.get("library"), rec["library"]
    if not isinstance(plib, dict): _refuse("PRODUCTION_POLICY_INVALID", "policy carries no library grant")
    for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino"):
        if plib.get(k) != alib[k]: _refuse("AUTHORITY_SOURCE_MISMATCH", f"policy library.{k} differs from the accepted authority", field=k)
    if plib["kind"] != "Disk" or not _abs_local_dir(plib["canonical_root"]) or plib["name"] in PROHIBITED_LIBRARIES:
        _refuse("PRODUCTION_POLICY_INVALID", "policy library is not a permitted local Disk library")
    pprojs, aprojs = pol.get("projects"), [p["project_uuid"] for p in rec["projects"]]
    if not isinstance(pprojs, list) or not pprojs: _refuse("PRODUCTION_POLICY_WILDCARD", "policy lists no project UUIDs (empty never means all)")
    for u in pprojs:
        if not (isinstance(u, str) and UUID_RE.match(u)): _refuse("PRODUCTION_POLICY_WILDCARD", "policy project entry is not an RFC 4122 UUID", entry=str(u)[:60])
    if set(pprojs) - set(aprojs): _refuse("AUTHORITY_SOURCE_MISMATCH", "policy grants a project the accepted authority does not")
    return pol, rec

# ---------------------------------------------------------------- sealed isolated session profile
def load_session_profile(path, expected_sha256, policy, policy_sha256, authority_sha256, own_sha256, host_id):
    """The sealed profile is the link between the accepted policy and a concrete Resolve session: it names the profile directory the
    session must be launched with, the exact one-library registration, the physical root identity and the seal instant the process must
    postdate. Governed content is deterministic and separately digested; runtime provenance (seal instant, absolute root) is recorded
    beside it, so regeneration from the same authority is reproducible."""
    try: raw = open(path, "rb").read()
    except OSError as e: _refuse("SESSION_PROFILE_MISSING", "session profile manifest unavailable", cause=type(e).__name__)
    if sha(raw) != expected_sha256: _refuse("SESSION_PROFILE_PIN_MISMATCH", "session profile digest does not match the pinned digest", expected=expected_sha256, actual=sha(raw))
    try: prof = json.loads(raw)
    except ValueError: _refuse("SESSION_PROFILE_INVALID", "session profile is not valid JSON")
    if not isinstance(prof, dict) or prof.get("schema") != PROFILE_SCHEMA: _refuse("SESSION_PROFILE_INVALID", "session profile has the wrong schema")
    gov, prov = prof.get("governed"), prof.get("provenance")
    if not isinstance(gov, dict) or not isinstance(prov, dict): _refuse("SESSION_PROFILE_INVALID", "session profile lacks governed/provenance blocks")
    if prof.get("governed_sha256") != canonical_sha256(gov): _refuse("SESSION_PROFILE_INVALID", "governed block does not match its digest")
    if gov.get("profile_type") != SESSION_PROFILE_TYPE: _refuse("SESSION_PROFILE_INVALID", "unsupported profile type")
    if gov.get("host_id") != host_id or gov.get("platform") != PRODUCTION_PLATFORM: _refuse("HOST_NOT_AUTHORIZED", "session profile is not for this host/platform")
    if gov.get("authority_sha256") != authority_sha256: _refuse("SESSION_PROFILE_MISMATCH", "session profile was generated from a different authority record")
    if gov.get("policy_sha256") != policy_sha256: _refuse("SESSION_PROFILE_MISMATCH", "session profile was generated from a different policy")
    if gov.get("worker_sha256") != own_sha256: _refuse("WORKER_IDENTITY_MISMATCH", "session profile is not for this worker's bytes")
    if gov.get("facade_commit") != ACCEPTED_FACADE_COMMIT: _refuse("FACADE_IDENTITY_MISMATCH", "session profile names another facade")
    glib = gov.get("library")
    if not isinstance(glib, dict) or any(glib.get(k) != policy["library"][k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")):
        _refuse("SESSION_PROFILE_MISMATCH", "session profile library differs from the policy grant")
    if sorted(gov.get("projects") or []) != sorted(policy["projects"]): _refuse("SESSION_PROFILE_MISMATCH", "session profile projects differ from the policy grant")
    if gov.get("registration_line") != f'{glib["name"]}:{glib["canonical_root"]}::::DISK': _refuse("SESSION_PROFILE_INVALID", "registration line is not the single authorized Disk registration")
    root = prov.get("profile_root")
    if not _abs_local_dir(root or ""): _refuse("SESSION_PROFILE_INVALID", "profile_root must be an absolute local directory")
    if not isinstance(prov.get("seal_epoch"), int) or prov["seal_epoch"] <= 0: _refuse("SESSION_PROFILE_INVALID", "profile has no seal instant")
    files = prov.get("files")
    if not isinstance(files, dict) or not files: _refuse("SESSION_PROFILE_INVALID", "profile records no file digests")
    return prof, gov, prov

def verify_profile_files(prov, gov):
    """Every sealed profile file must still hash to its recorded value, and the registration file must still be exactly the one
    authorized Disk line. A profile or registration edited after the seal fails the next operation."""
    root = prov["profile_root"]
    for rel, want in sorted(prov["files"].items()):
        p = os.path.join(root, rel)
        try: got = sha(open(p, "rb").read())
        except OSError as e: _refuse("SESSION_PROFILE_MUTATED", "sealed profile file is unreadable", file=rel, cause=type(e).__name__)
        if got != want: _refuse("SESSION_PROFILE_MUTATED", "sealed profile file changed after the seal", file=rel)
    regfile = os.path.join(root, prov["registration_relpath"])
    try: text = open(regfile, "rb").read().decode("utf-8", "replace")
    except OSError: _refuse("SESSION_PROFILE_MUTATED", "profile registration file unreadable")
    lines = [l for l in text.splitlines() if l.strip()]
    if lines != [gov["registration_line"]]:
        _refuse("SESSION_PROFILE_MUTATED", "profile registration is not exactly the one authorized Disk library", entries=len(lines))
    return regfile

def resolve_physical_root(path):
    """Canonical physical identity of the authorized root: strict realpath (symlinks resolved), must exist, must be a directory, plus
    device/inode. Textual aliases collapse; a different physical directory can never pass."""
    try: rp = os.path.realpath(path, strict=True); st = os.stat(rp)
    except (OSError, ValueError) as e: _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "authorized Disk root does not resolve to an existing directory", path=path, cause=type(e).__name__)
    if not os.path.isdir(rp): _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "authorized Disk root is not a directory", path=path)
    return {"realpath": rp, "dev": st.st_dev, "ino": st.st_ino}

# ---------------------------------------------------------------- Linux session/process attestation (real /proc facts only)
class SystemProbe:
    """The only source of process facts. Injected into Worker() so offline tests can supply a deterministic probe; the production CLI
    never passes one and never reads an environment switch (PRR-F06)."""
    def uid(self): return os.getuid()
    def boot_time(self):
        for l in open("/proc/stat"):
            if l.startswith("btime"): return int(l.split()[1])
        raise OSError("btime unavailable")
    def pids(self): return [int(p) for p in os.listdir("/proc") if p.isdigit()]
    def exe(self, pid):
        try: return os.path.realpath(os.readlink(f"/proc/{pid}/exe"))
        except OSError: return None
    def proc_uid(self, pid):
        try:
            for l in open(f"/proc/{pid}/status"):
                if l.startswith("Uid:"): return int(l.split()[1])
        except OSError: return None
        return None
    def ppid(self, pid):
        try:
            for l in open(f"/proc/{pid}/status"):
                if l.startswith("PPid:"): return int(l.split()[1])
        except OSError: return None
        return None
    def start_ticks(self, pid):
        try: return int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[19])   # field 22, same technique as frozen Phase 1
        except (OSError, IndexError, ValueError): return None
    def environ(self, pid):
        try: raw = open(f"/proc/{pid}/environ", "rb").read()
        except OSError: return None
        out = {}
        for item in raw.split(b"\0"):
            if b"=" in item:
                k, _, v = item.partition(b"=")
                out[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
        return out
    def listening_socket_pids(self, port):
        """PIDs holding a LISTEN socket on this TCP port, resolved through /proc/net/tcp inodes and /proc/<pid>/fd — the endpoint the
        Resolve scripting library connects to on 127.0.0.1."""
        inodes = set()
        for f in ("/proc/net/tcp", "/proc/net/tcp6"):
            try: lines = open(f).read().splitlines()[1:]
            except OSError: continue
            for ln in lines:
                p = ln.split()
                if len(p) < 10 or p[3] != "0A": continue
                try:
                    if int(p[1].split(":")[1], 16) == port: inodes.add(p[9])
                except (ValueError, IndexError): continue
        if not inodes: return set()
        owners = set()
        for pid in self.pids():
            try: fds = os.listdir(f"/proc/{pid}/fd")
            except OSError: continue
            for fd in fds:
                try: tgt = os.readlink(f"/proc/{pid}/fd/{fd}")
                except OSError: continue
                if tgt.startswith("socket:[") and tgt[8:-1] in inodes: owners.add(pid); break
        return owners
    def stat_file(self, path):
        try:
            st = os.stat(path); return {"realpath": os.path.realpath(path), "bytes": st.st_size, "uid": st.st_uid}
        except OSError: return None

def attest_isolated_session(probe, gov, prov, hz=None):
    """Bind the live Resolve session to the sealed profile. Every clause is a real, observable Linux fact; any failure refuses before the
    scripting library is touched. Returns the attested session identity."""
    binary = gov["resolve_binary"]["realpath"]
    pids = [p for p in probe.pids() if probe.exe(p) == binary]
    if len(pids) != 1:
        _refuse("SESSION_AMBIGUOUS" if pids else "SESSION_NOT_RUNNING",
                "exactly one Resolve process must be running for a production-read session" if pids else "no Resolve process is running for this session",
                resolve_processes=len(pids))
    pid = pids[0]
    if probe.proc_uid(pid) != probe.uid(): _refuse("SESSION_OWNER_MISMATCH", "the Resolve process is not owned by this user", pid=pid)
    st = probe.stat_file(binary)
    if not st or st["realpath"] != binary: _refuse("SESSION_EXECUTABLE_MISMATCH", "the pinned Resolve executable is missing or moved", expected=binary)
    if st["bytes"] != gov["resolve_binary"]["bytes"]: _refuse("SESSION_EXECUTABLE_MISMATCH", "the Resolve executable differs from the sealed identity", expected_bytes=gov["resolve_binary"]["bytes"], actual_bytes=st["bytes"])
    ticks = probe.start_ticks(pid)
    if ticks is None: _refuse("SESSION_PROCESS_UNREADABLE", "process start time unavailable", pid=pid)
    hz = hz or os.sysconf("SC_CLK_TCK")
    start_epoch = int(probe.boot_time() + ticks / hz)
    if start_epoch < prov["seal_epoch"]:
        _refuse("SESSION_PREDATES_PROFILE", "the Resolve process started before the isolated profile was sealed; a pre-existing session is never eligible",
                process_start_epoch=start_epoch, profile_seal_epoch=prov["seal_epoch"])
    env = probe.environ(pid)
    if not env: _refuse("SESSION_PROCESS_UNREADABLE", "process environment unavailable; the session cannot be attested", pid=pid)
    for var, rel in gov["profile_env"].items():
        want = os.path.join(prov["profile_root"], rel) if rel else prov["profile_root"]
        if env.get(var) != want:
            _refuse("SESSION_PROFILE_MISMATCH", "the Resolve process was not launched with the sealed isolated profile", variable=var, expected=want, actual=env.get(var))
    port = gov["script_server_port"]
    owners = probe.listening_socket_pids(port)
    if not owners: _refuse("SESSION_HANDLE_UNBOUND", "no process owns the Resolve scripting endpoint; the API handle cannot be bound to this session", port=port)
    for owner in sorted(owners):
        seen, cur, ok = set(), owner, False
        while cur and cur not in seen:
            if cur == pid: ok = True; break
            seen.add(cur); cur = probe.ppid(cur)
        if not ok:
            _refuse("SESSION_HANDLE_UNBOUND", "the Resolve scripting endpoint is owned by a process outside the attested session", port=port, owner_pid=owner, session_pid=pid)
    return {"pid": pid, "start_epoch": start_epoch, "executable": binary, "uid": probe.uid(), "script_server_port": port, "endpoint_owner_pids": sorted(owners)}

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
    def __init__(self, host_id, secret, state_dir, api, require_library=None, mode="QUALIFICATION_READ", policy_path=None, policy_sha256=None,
                 authority_path=None, session_path=None, session_sha256=None, probe=None):
        hn = socket.gethostname()
        if hn.lower() != host_id.lower(): raise SystemExit(f"HOST_ID_MISMATCH: --host-id {host_id} but hostname is {hn}")
        self.host_id, self.secret, self.state_dir, self.api = host_id, secret, state_dir, api
        self.require_library = require_library            # (name, root_or_None) or None  (QUALIFICATION_READ gate, frozen semantics)
        if mode not in READ_PROFILES: raise SystemExit(f"REFUSED: unknown --mode {mode!r}")
        self.mode, self.policy_path, self.policy_sha256, self.authority_path = mode, policy_path, policy_sha256, authority_path
        self.session_path, self.session_sha256 = session_path, session_sha256
        self.probe = probe or SystemProbe()          # constructor injection only; never selectable from the CLI or the environment
        self.session_identity, self._policy_cache = None, None
        self.own_sha256 = self.own_sha()             # reported identity; re-hashed per operation, never trusted from this cache
        if mode == "PRODUCTION_READ":
            if require_library: raise SystemExit("REFUSED: --require-library is a QUALIFICATION_READ gate; PRODUCTION_READ takes the production chain instead")
            if not (policy_path and policy_sha256 and authority_path and session_path and session_sha256):
                raise SystemExit("REFUSED: PRODUCTION_READ requires --production-authority, --production-policy, --production-policy-sha256, --production-session and --production-session-sha256")
            if host_id not in PRODUCTION_HOSTS: raise SystemExit(f"REFUSED: production-read v1 supports only {PRODUCTION_HOSTS}; {host_id!r} is not authorizable")
            if platform.system() != PRODUCTION_PLATFORM: raise SystemExit("REFUSED: production-read v1 supports Linux only; Windows production reads are structurally unsupported")
            try:                                      # startup: the whole chain must verify before the socket binds
                pol, _ = load_production_policy(policy_path, policy_sha256, authority_path, host_id, self.own_sha256)
                load_session_profile(session_path, session_sha256, pol, policy_sha256, sha(open(authority_path, "rb").read()), self.own_sha256, host_id)
            except OpError as e: raise SystemExit(f"REFUSED: {e.message} {json.dumps(e.detail)}")
        elif policy_path or policy_sha256 or authority_path or session_path or session_sha256:
            raise SystemExit("REFUSED: the production chain arguments are only valid with --mode PRODUCTION_READ")
        os.makedirs(state_dir, exist_ok=True)
        gpath = os.path.join(state_dir, "generation")
        gen = int(open(gpath).read() or 0) + 1 if os.path.exists(gpath) else 1
        open(gpath, "w").write(str(gen))
        self.identity = {"host_id": host_id, "hostname": hn, "platform": platform.system().lower(),
                         "worker_instance_id": uuid.uuid4().hex, "worker_generation": gen,
                         "worker_started_at": now_iso(), "worker_version": WORKER_VERSION, "protocol": PROTOCOL,
                         "read_profile": mode, "production_policy_sha256": policy_sha256, "session_profile_sha256": session_sha256,
                         "worker_sha256": self.own_sha256, "derived_from": DERIVED_FROM}
        self.replay = ReplayGuard(os.path.join(state_dir, "replay.jsonl"))
        self.pool = ResolvePool()
        self.jlock = threading.Lock(); self.journal = open(os.path.join(state_dir, "journal.jsonl"), "a")
        self.last_resolve = None                           # last successful snapshot summary {observed_at, available, version, project_uuid}
        self.journal_event({"event": "WORKER_START", "worker_instance_id": self.identity["worker_instance_id"], "worker_generation": gen,
                            "replay_entries_loaded": self.replay.loaded, "require_library": require_library and require_library[0],
                            "read_profile": mode, "production_policy_sha256": policy_sha256, "session_profile_sha256": session_sha256, "worker_sha256": self.own_sha256})

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
    # The authorization record is a PER-REQUEST slot owned by handle(), not a field of the snapshot dict: a refusal discards the snapshot,
    # so a decision recorded there would be lost exactly when it matters most (PRR-F04). Stages:
    # policy | authority | profile | session | library | project (gates), resolve (Resolve state insufficient), pre-resolve (refused earlier).
    def new_authz(self):
        return ({"read_profile": "PRODUCTION_READ", "decision": "NOT_REACHED", "stage": None, "policy_sha256": self.policy_sha256,
                 "session_profile_sha256": self.session_sha256} if self.mode == "PRODUCTION_READ"
                else {"read_profile": self.mode, "decision": "NOT_APPLICABLE"})
    def _deny(self, a, stage, err):
        a.update(decision="DENIED", stage=stage, reason=(err.detail or {}).get("reason") or err.code, code=err.code); raise err
    def _gates(self, a):
        if self.mode != "PRODUCTION_READ": return self.check_library, None
        return (lambda res: self.check_library_production(res, a)), (lambda res, proj, pm, p, tl: self.check_project_production(res, proj, pm, p, tl, a))

    def own_sha(self):
        """Re-hashed at EVERY operation, not cached at construction (RRR-P303): the bytes claiming authority are the bytes on disk now."""
        return sha(open(os.path.abspath(__file__), "rb").read())

    def production_chain(self, a):
        """Accepted authority -> policy -> sealed profile -> profile files -> physical root. Re-verified per operation."""
        own = self.own_sha()
        try: pol, rec = load_production_policy(self.policy_path, self.policy_sha256, self.authority_path, self.host_id, own)
        except OpError as e: self._deny(a, "authority" if (e.detail or {}).get("reason", "").startswith("AUTHORITY") else "policy", e)
        try: prof, gov, prov = load_session_profile(self.session_path, self.session_sha256, pol, self.policy_sha256, sha(open(self.authority_path, "rb").read()), own, self.host_id)
        except OpError as e: self._deny(a, "profile", e)
        try:
            verify_profile_files(prov, gov)
            phys = resolve_physical_root(gov["library"]["canonical_root"])
            if phys["realpath"] != gov["library"]["canonical_root"] or phys["dev"] != gov["library"]["physical_dev"] or phys["ino"] != gov["library"]["physical_ino"]:
                _refuse("LIBRARY_NOT_AUTHORIZED", "the authorized root no longer resolves to the pinned physical identity", expected=gov["library"], actual=phys)
        except OpError as e: self._deny(a, "profile" if (e.detail or {}).get("reason", "").startswith("SESSION_PROFILE") else "library", e)
        a["session_id"] = gov.get("session_id"); a["authority_sha256"] = gov.get("authority_sha256")
        a["library"] = {"kind": "Disk", "name": gov["library"]["name"], "canonical_root": phys["realpath"], "dev": phys["dev"], "ino": phys["ino"]}
        return pol, rec, gov, prov

    def attest_session(self, a):
        """Session provenance, established BEFORE the Resolve scripting library is touched. Also pins the attested process for this worker
        instance: a Resolve restart produces a different identity and every later read refuses until the operator seals/attests again."""
        pol, rec, gov, prov = self.production_chain(a)
        try: ident = attest_isolated_session(self.probe, gov, prov)
        except OpError as e: self._deny(a, "session", e)
        if self.session_identity is None: self.session_identity = ident
        elif (ident["pid"], ident["start_epoch"]) != (self.session_identity["pid"], self.session_identity["start_epoch"]):
            try: _refuse("SESSION_RESTARTED", "the attested Resolve session was replaced; a new session must be sealed and attested",
                         attested=self.session_identity, observed={"pid": ident["pid"], "start_epoch": ident["start_epoch"]})
            except OpError as e: self._deny(a, "session", e)
        a["session"] = {"pid": ident["pid"], "start_epoch": ident["start_epoch"], "executable": ident["executable"],
                        "endpoint_owner_pids": ident["endpoint_owner_pids"], "script_server_port": ident["script_server_port"]}
        a["allowed_projects"] = len(pol["projects"]); self._policy_cache = pol
        return pol

    def check_library_production(self, res, a):
        """The open library must be the single library the sealed profile registers. No discovery, no inference: the session could only
        have been born into a profile exposing this one Disk library."""
        res["authorization"] = a
        lib = res.get("library") or {}
        actual = {"name": lib.get("name"), "type": lib.get("type"), "host": lib.get("host")}; a["library_observed"] = actual
        try:
            want = a["library"]["name"]
            if not lib.get("name"): _refuse("LIBRARY_IDENTITY_UNAVAILABLE", "current library identity unavailable", actual=actual)
            if str(lib.get("type", "")).lower() != "disk" or str(lib.get("type", "")).upper() in NETWORK_TYPES or lib.get("host"):
                _refuse("LIBRARY_NOT_AUTHORIZED", "network/PostgreSQL libraries are not authorized by this candidate (v1: local Disk only)", actual=actual)
            if lib["name"] in PROHIBITED_LIBRARIES or lib["name"] != want:
                _refuse("LIBRARY_NOT_AUTHORIZED", "the open library is not the single library registered by the sealed session profile", expected=want, actual=actual)
        except OpError as e: self._deny(a, "library", e)

    def check_project_production(self, res, proj, pm, p, tl, a):
        """Session correctness is necessary, not sufficient: the CURRENT project UUID must also be in the accepted allowlist."""
        res["authorization"] = a
        try:
            a["project_observed"] = {"name": proj.get("name"), "uuid": proj.get("uuid")}
            allowed = (self._policy_cache or {}).get("projects") or []
            if not proj.get("uuid") or proj["uuid"] not in allowed:
                raise OpError("PROJECT_IDENTITY_MISMATCH", "current project is not an authorized production-read project",
                              {"reason": "PROJECT_NOT_AUTHORIZED", "actual": {"name": proj.get("name"), "uuid": proj.get("uuid")}, "library": a["library"]["name"]})
        except OpError as e: self._deny(a, "project", e)
        a.update(decision="ALLOWED", stage="project", project_uuid=proj["uuid"])

    def _snapshot_for(self, a):
        """One Resolve attachment per operation. In PRODUCTION_READ the whole chain and the session are attested first, so nothing is read
        from a session that was not born into the sealed profile."""
        if self.mode == "PRODUCTION_READ": self.attest_session(a)
        lib_check, proj_check = self._gates(a)
        return snapshot(self.api, lib_check, proj_check)

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
        proj = tl = None; a = a if a is not None else self.new_authz()
        if pool["state"] == "SATURATED": res["probe"] = "SKIPPED_SATURATED"
        else:
            try:
                _, _, _, r, proj, tl = self.pool.run(lambda: self._snapshot_for(a), min(HEALTH_PROBE_S, deadline_s))
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
        a = a if a is not None else self.new_authz()
        r, pm, p, res, proj, tl = self._snapshot_for(a)   # session attested first; then library gate before any project read, project gate before any timeline/settings/media read
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
        lib = a.get("library") or {}; a["library"] = {k: lib.get(k) for k in ("kind", "name", "canonical_root", "dev", "ino")} if lib else a.get("library_observed")
        a.pop("allowed_projects", None)
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
    ap.add_argument("--production-session", action=Once, help="PRODUCTION_READ: path to the sealed isolated session profile manifest")
    ap.add_argument("--production-session-sha256", action=Once, help="PRODUCTION_READ: pinned sha256 of the session profile manifest FILE; re-verified at every operation")
    a = ap.parse_args()
    if a.mode is None: a.mode = "QUALIFICATION_READ"
    if a.bind != BIND: raise SystemExit("LOOPBACK_ONLY: worker binds 127.0.0.1 only; refusing --bind " + a.bind)
    secret = open(a.secret_file, "rb").read().strip()
    if len(secret) < 32: raise SystemExit("REFUSED: secret too short")
    req = None
    if a.require_library:
        name, _, root = a.require_library.partition("="); req = (name, root or None)
        if name in PROHIBITED_LIBRARIES: raise SystemExit("REFUSED: --require-library names a prohibited library")
    srv = ThreadingHTTPServer((BIND, a.port), Handler); srv.worker = Worker(a.host_id, secret, a.state_dir, load_production_api(), req, a.mode, a.production_policy, a.production_policy_sha256,
                                                                       a.production_authority, a.production_session, a.production_session_sha256)
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
                      "require_library": req and req[0], "read_profile": a.mode, "production_policy_sha256": a.production_policy_sha256, "session_profile_sha256": a.production_session_sha256, "worker_sha256": srv.worker.own_sha256,
                      "replay_entries_loaded": srv.worker.replay.loaded}), flush=True); srv.serve_forever()

if __name__ == "__main__": main()
