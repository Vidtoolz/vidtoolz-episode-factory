"""Registry: logical target -> authenticated worker endpoint. Routing is by host_id ONLY, never by open project."""
import json, os, time
from .errors import VrcError
DEFAULT_PATH = os.path.expanduser("~/.config/vidtoolz-resolve-control/registry.json")
class Registry:
    def __init__(self, path=DEFAULT_PATH, current_s=15, stale_s=60):
        self.path, self.current_s, self.stale_s = path, current_s, stale_s
        cfg = json.load(open(path)); self.targets = {k.lower(): dict(v, host_id=k) for k, v in cfg["targets"].items()}
        self.last = {}   # host_id -> {"at": epoch, "ok": bool, "resolve_available": bool, "snapshot": {...}}
    def resolve_target(self, target):
        if target is None or str(target).strip() == "": raise VrcError("TARGET_REQUIRED", "every command must name a target host; there is no default")
        t = self.targets.get(str(target).lower().replace("resolve://", ""))
        if not t: raise VrcError("TARGET_UNKNOWN", f"{target!r} not in registry", {"known": sorted(self.targets)})
        return t
    def secret(self, t): return open(os.path.expanduser(t["secret_file"]), "rb").read().strip()
    def record(self, host_id, ok, resp=None):
        prev = self.last.get(host_id.lower()) or {}
        snap = resp if (resp and "resolve" in resp) else prev.get("snapshot")   # keep last Resolve-availability view unless this reply carries one
        self.last[host_id.lower()] = {"at": time.time(), "ok": ok, "snapshot": snap}
    def status(self, host_id):
        h = self.last.get(host_id.lower())
        if not h or not h["ok"]: return "OFFLINE"
        age = time.time() - h["at"]
        if age > self.stale_s: return "OFFLINE"
        if age > self.current_s: return "STALE"
        if not ((h["snapshot"] or {}).get("resolve") or {}).get("available", False): return "RESOLVE_UNAVAILABLE"
        return "ONLINE_CURRENT"
