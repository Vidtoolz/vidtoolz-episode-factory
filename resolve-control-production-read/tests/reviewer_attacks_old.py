"""Runs the independent reviewer's attacks against the REJECTED candidate 4ae35e7c, in that candidate's own extracted bytes.

Executed as a subprocess by tests/test_reviewer_attacks_regression.py with OLD_ROOT pointing at the extraction. The attack logic is the
reviewer's (outputs/resolve-production-read-isolated-session-independent-review-2026-09-22/evidence/reviewer_attacks.py); only the root
is parameterised, so the reproduction is theirs, not ours.
"""
import builtins, io, json, os, subprocess, sys, tempfile
from unittest import mock

ROOT = os.environ["OLD_ROOT"]
sys.path[:0] = [os.path.join(ROOT, "tests"), os.path.join(ROOT, "worker"), os.path.join(ROOT, "tools")]
import test_production_read as T
import resolve_worker as rw

B_ONLY = "LIBRARY_B_ONLY_SECRET"


class Tl:
    def __init__(self, d): self.d = d
    def GetName(self): return self.d["name"]
    def GetUniqueId(self): return self.d["uuid"]
    def GetStartFrame(self): return 0
    def GetEndFrame(self): return 100
    def GetSetting(self, k=None): return {"timelineFrameRate": "60"} if k is None else "60"
    def GetTrackCount(self, t): return 1
    def GetMarkers(self): return {}


class LeakHandle:
    """Reports library A's identity (name, project, timelines — all shared with its clone B) while SERVING B's content."""
    def __init__(self, libname, project, timelines, project_names, settings):
        self.libname, self.project, self.timelines, self.project_names, self.settings = libname, project, timelines, project_names, settings
        self.attaches = 0
    def scriptapp(self, name, *host):
        assert not host
        self.attaches += 1; return self
    def GetProductName(self): return "DaVinci Resolve Studio"
    def GetVersionString(self): return "21.1.0.14"
    def GetCurrentPage(self): return "edit"
    def GetProjectManager(self): return self
    def GetCurrentDatabase(self): return {"DbName": self.libname, "DbType": "Disk"}
    def GetProjectListInCurrentFolder(self): return list(self.project_names)
    def GetCurrentProject(self): return self
    def GetName(self): return self.project["name"]
    def GetUniqueId(self): return self.project["uuid"]
    def GetTimelineCount(self): return len(self.timelines)
    def GetTimelineByIndex(self, i): return Tl(self.timelines[i - 1])
    def GetCurrentTimeline(self): return Tl(self.timelines[0])
    def GetSetting(self, k=None): return dict(self.settings) if k is None else self.settings.get(k)
    def GetMediaPool(self): return self

results = {}
fx = T.Fixture()
p = fx.profile()

try:
    rw.attest_isolated_session(T.FakeProbe(p, start_after=0), p.gov, p.prov)
    results["equal_start_epoch"] = {"accepted": True}
except rw.OpError as e:
    results["equal_start_epoch"] = {"accepted": False, "reason": e.detail.get("reason")}

binary = p.gov["resolve_binary"]["realpath"]
data = bytearray(open(binary, "rb").read()); data[-1] ^= 1
open(binary, "wb").write(data)
try:
    rw.attest_isolated_session(T.FakeProbe(p), p.gov, p.prov)
    results["same_size_executable_mutation"] = {"accepted": True}
except rw.OpError as e:
    results["same_size_executable_mutation"] = {"accepted": False, "reason": e.detail.get("reason")}

open(os.path.join(p.prov["profile_root"], "config", "unexpected-runtime-state"), "w").write("unsealed\n")
try:
    rw.verify_profile_files(p.prov, p.gov)
    results["unsealed_extra_profile_file"] = {"accepted": True}
except rw.OpError as e:
    results["unsealed_extra_profile_file"] = {"accepted": False, "reason": e.detail.get("reason")}

relative_parent = tempfile.mkdtemp(prefix="isor-relative-")
r = subprocess.run([sys.executable, "-B", T.GENERATOR, "--authority", p.src_path, "--policy", p.pol_path,
                    "--worker", T.WORKER_PATH, "--source-config", p.cfg, "--profile-root", "relative-profile",
                    "--out", os.path.join(relative_parent, "relative-session.json"), "--resolve-binary", p.binary],
                   cwd=relative_parent, capture_output=True, text=True)
results["relative_profile_root"] = {"returncode": r.returncode, "accepted": r.returncode == 0}

symlink_parent = tempfile.mkdtemp(prefix="isor-symlink-")
real_root = os.path.join(symlink_parent, "real"); link_root = os.path.join(symlink_parent, "link")
os.mkdir(real_root); os.symlink(real_root, link_root)
inside_manifest = os.path.join(real_root, "session.json")
r = subprocess.run([sys.executable, "-B", T.GENERATOR, "--authority", p.src_path, "--policy", p.pol_path,
                    "--worker", T.WORKER_PATH, "--source-config", p.cfg, "--profile-root", link_root,
                    "--out", inside_manifest, "--resolve-binary", p.binary], capture_output=True, text=True)
results["symlink_profile_root_manifest_inside_physical_root"] = {
    "returncode": r.returncode, "accepted": r.returncode == 0, "manifest_physically_inside": os.path.isfile(inside_manifest)}

probe = rw.SystemProbe()
real_open = builtins.open
def fake_env_open(path, mode="r", *a, **k):
    if path == "/proc/77/environ":
        return io.BytesIO(b"BMD_RESOLVE_CONFIG_DIR=/unauthorized\0BMD_RESOLVE_CONFIG_DIR=/sealed\0")
    return real_open(path, mode, *a, **k)
with mock.patch("builtins.open", side_effect=fake_env_open):
    results["duplicate_environment_parser"] = probe.environ(77)

handle = LeakHandle(fx.name, {"name": "Prod Project", "uuid": T.P_A1}, T.TLS, ["Prod Project", "Second"],
                      {"timelineFrameRate": "23.976", "vidtoolzLibraryMarker": B_ONLY})
env = T.Env(fx.st(), p, probe=T.FakeProbe(p), api=handle)
try:
    out = env.call("get_project_settings"); authz = env.authz()
    results["duplicate_env_clone_b_end_to_end"] = {
        "ok": out["ok"], "b_only_data": out["result"]["settings"].get("vidtoolzLibraryMarker"),
        "decision": authz["decision"], "stage": authz["stage"], "attaches": handle.attaches}
except Exception as e:
    results["duplicate_env_clone_b_end_to_end"] = {"ok": False, "error": repr(e)[:200], "attaches": handle.attaches}
finally:
    env.close()

tcp = ("  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n"
       "   0: 0100007F:0478 00000000:0000 0A 0 0 0 0 0 111\n"
       "   1: 0100007F:0478 00000000:0000 0A 0 0 0 0 0 222\n")
class SocketProbe(rw.SystemProbe):
    def pids(self): return [100, 200]
def fake_proc_open(path, mode="r", *a, **k):
    if path == "/proc/net/tcp": return io.StringIO(tcp)
    if path == "/proc/net/tcp6": return io.StringIO("header\n")
    return real_open(path, mode, *a, **k)
real_listdir = os.listdir
def fake_listdir(path):
    if path == "/proc/100/fd": return ["3"]
    if path == "/proc/200/fd": raise PermissionError("review injection")
    return real_listdir(path)
def fake_readlink(path):
    if path == "/proc/100/fd/3": return "socket:[111]"
    raise OSError("review injection")
with mock.patch("builtins.open", side_effect=fake_proc_open), \
     mock.patch("os.listdir", side_effect=fake_listdir), \
     mock.patch("os.readlink", side_effect=fake_readlink):
    owners = SocketProbe().listening_socket_pids(1144)
results["inaccessible_listener_owner"] = {"reported_owners": sorted(owners), "unattributed_listen_inode": 222}

print(json.dumps(results, indent=1, sort_keys=True))
