import argparse, json, sys
from .client import Client, READ_ONLY_OPS
from .errors import VrcError
from .registry import Registry
from . import tunnel
def main():
    ap = argparse.ArgumentParser(prog="vrc", description="VIDTOOLZ Resolve Control — Phase 1 READ ONLY")
    ap.add_argument("op", choices=list(READ_ONLY_OPS) + ["status", "tunnel-up"]); ap.add_argument("--target", default=None)
    ap.add_argument("--expect-project-uuid"); ap.add_argument("--expect-timeline-uuid"); ap.add_argument("--expect-resolve-pid", type=int)
    ap.add_argument("--expect-worker", dest="expect_worker"); ap.add_argument("--timeline-uuid"); ap.add_argument("--timeline-name")
    ap.add_argument("--deadline-ms", type=int, default=20000); ap.add_argument("--registry"); ap.add_argument("--caller", default="vrc-cli")
    a = ap.parse_args(); reg = Registry(a.registry) if a.registry else Registry(); c = Client(reg, a.caller)
    try:
        if a.op == "tunnel-up": print(json.dumps({"tunnel_pid": tunnel.start(reg.resolve_target(a.target))})); return 0
        if a.op == "status":
            out = {}
            for h in sorted(reg.targets):
                try: r = c.health(h, deadline_ms=8000); out[h] = {"status": reg.status(h), "worker": r["worker"]["worker_instance_id"][:8], "gen": r["worker"]["worker_generation"], "pool": (r.get("resolve", {}).get("pool") or {}).get("state"), "probe": r.get("resolve", {}).get("probe"), "library": (r.get("resolve", {}).get("library") or {}).get("name"), "resolve": r.get("resolve", {}).get("version"), "pid": (r.get("resolve", {}).get("process") or {}).get("pid"), "project": (r.get("project") or {}).get("name"), "timeline": (r.get("timeline") or {}).get("name")}
                except VrcError as e: out[h] = {"status": reg.status(h), "error": e.code}
            print(json.dumps(out, indent=1)); return 0
        exp = {k: v for k, v in {"project_uuid": a.expect_project_uuid, "timeline_uuid": a.expect_timeline_uuid, "resolve_pid": a.expect_resolve_pid, "worker_instance_id": a.expect_worker}.items() if v is not None}
        params = {k: v for k, v in {"timeline_uuid": a.timeline_uuid, "timeline_name": a.timeline_name}.items() if v}
        print(json.dumps(c.call(a.op, a.target, params, exp, a.deadline_ms), indent=1)); return 0
    except VrcError as e: print(json.dumps({"ok": False, "error": e.to_dict()}, indent=1)); return 2
if __name__ == "__main__": sys.exit(main())
