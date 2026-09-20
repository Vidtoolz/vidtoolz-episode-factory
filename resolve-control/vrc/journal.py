import json, os, time
DEFAULT = os.path.expanduser("~/.config/vidtoolz-resolve-control/journal.jsonl")
def append(rec, path=DEFAULT):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f: f.write(json.dumps(rec, sort_keys=True) + "\n"); f.flush(); os.fsync(f.fileno())
def record(env, target, resp, err, t0, path=DEFAULT):
    resp = resp or {}
    append({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "request_id": env["request_id"], "caller": env["caller"], "target_host": env["target_host"],
            "op": env["op"], "params": env["params"], "expected": env["expected"], "worker": resp.get("worker"), "resolve_process": (resp.get("resolve") or {}).get("process"),
            "project": resp.get("project"), "timeline": resp.get("timeline"), "start": env["created_at"], "duration_ms": int((time.time() - t0) * 1000),
            "status": "ok" if resp.get("ok") else "error", "error": err or (resp.get("error") or None), "result_summary": sorted((resp.get("result") or {}).keys())}, path)
