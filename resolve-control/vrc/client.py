"""Typed READ-ONLY client. Every call requires an explicit target. Never routes to another host on failure."""
import time
from . import journal, transport
from .errors import VrcError
from .protocol import envelope
READ_ONLY_OPS = ("health", "identify", "get_current_project", "get_current_timeline", "list_timelines",
                 "get_project_settings", "get_timeline_settings", "get_media_pool_summary", "get_project_fingerprint")
class Client:
    def __init__(self, registry, caller="vrc-cli", journal_path=journal.DEFAULT): self.reg, self.caller, self.journal_path = registry, caller, journal_path
    def call(self, op, target, params=None, expected=None, deadline_ms=20000):
        if op not in READ_ONLY_OPS: raise VrcError("READ_ONLY_MODE" if op and op[0].isupper() else "UNSUPPORTED_OPERATION", f"{op!r} is not a Phase 1 read-only operation")
        try: t = self.reg.resolve_target(target)                  # TARGET_REQUIRED / TARGET_UNKNOWN before anything else
        except VrcError as e:
            journal.append({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "caller": self.caller, "op": op, "target_host": target, "status": "error", "error": e.to_dict()}, self.journal_path); raise
        env = envelope(op, t["host_id"], params, expected, deadline_ms, self.caller); t0 = time.time(); resp = err = None
        try:
            resp = transport.send(t, self.reg.secret(t), env); self.reg.record(t["host_id"], bool(resp.get("ok")) or "error" in resp, resp)
            if resp.get("host_id", "").lower() != t["host_id"].lower(): raise VrcError("TARGET_MISMATCH", f"answered by {resp.get('host_id')!r}, wanted {t['host_id']!r}")
            if not resp.get("ok"): e = resp.get("error") or {}; raise VrcError(e.get("code", "TRANSPORT_ERROR"), e.get("message", ""), e.get("detail"))
            return resp
        except VrcError as e:
            err = e.to_dict()
            if e.code == "WORKER_OFFLINE": self.reg.record(t["host_id"], False)
            raise                                                   # NO FALLBACK: never retarget another host
        finally: journal.record(env, t, resp, err, t0, self.journal_path)
    def __getattr__(self, op):
        if op in READ_ONLY_OPS: return lambda target, **kw: self.call(op, target, **kw)
        raise AttributeError(op)
