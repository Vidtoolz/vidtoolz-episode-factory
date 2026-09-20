"""Fake DaVinciResolveScript for deterministic tests. Controlled via env VRC_FAKE_STATE (JSON file)."""
import json, os
def _state(): return json.load(open(os.environ["VRC_FAKE_STATE"]))
def _count_attach():
    p = os.environ["VRC_FAKE_STATE"] + ".attach_count"
    n = int(open(p).read()) + 1 if os.path.exists(p) else 1
    open(p, "w").write(str(n))
class _TL:
    def __init__(s, d): s.d = d
    def GetName(s): return s.d["name"]
    def GetUniqueId(s): return s.d["uuid"]
    def GetStartFrame(s): return 0
    def GetEndFrame(s): return s.d.get("end", 100)
    def GetSetting(s, k=None): return {"timelineFrameRate": "60"} if k is None else "60"
    def GetTrackCount(s, t): return 1
    def GetMarkers(s): return {}
class _Folder:
    def GetName(s): return "root"
    def GetClipList(s): return [1, 2]
    def GetSubFolderList(s): return []
    def GetIsFolderStale(s): return False
class _MP:
    def GetRootFolder(s): return _Folder()
class _Proj:
    def __init__(s, st): s.st = st
    def GetName(s): return s.st["project"]["name"]
    def GetUniqueId(s): return s.st["project"]["uuid"]
    def GetTimelineCount(s): return len(s.st["timelines"])
    def GetTimelineByIndex(s, i): return _TL(s.st["timelines"][i - 1])
    def GetCurrentTimeline(s): return _TL(s.st["timelines"][s.st["current"]]) if s.st["timelines"] else None
    def GetSetting(s, k=None): return {"timelineFrameRate": "60", "timelineResolutionWidth": "1080", "timelineResolutionHeight": "1920"} if k is None else {"timelineFrameRate": "60", "timelineResolutionWidth": "1080", "timelineResolutionHeight": "1920"}.get(k)
    def GetMediaPool(s): return _MP()
    def AppendToTimeline(s, *a): raise AssertionError("WRITE CALLED — must never happen")
class _PM:
    def __init__(s, st): s.st = st
    def GetCurrentProject(s):
        if s.st.get("sleep_s"): import time; time.sleep(s.st["sleep_s"])     # synthetic hung Resolve (F-02 tests)
        return _Proj(s.st) if s.st.get("project") else None
    def GetCurrentDatabase(s): return s.st.get("database") or {"DbName": "EKA", "DbType": "PostgreSQL", "IpAddress": "192.168.50.199"}
class _R:
    def __init__(s, st): s.st = st
    def GetProductName(s): return "DaVinci Resolve Studio"
    def GetVersionString(s): return s.st.get("version", "21.1.0.14")
    def GetCurrentPage(s): return "edit"
    def GetProjectManager(s): return _PM(s.st)
def scriptapp(name, *host):
    assert not host, "remote host argument must never be passed by the worker"
    _count_attach(); st = _state(); return None if st.get("unavailable") else _R(st)
