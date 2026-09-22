#!/usr/bin/env python3
"""Deterministic policy compiler: governed source record (vidtoolz.resolveProductionReadAuthority.v1) -> runtime policy
(vidtoolz.resolveProductionReadRuntimePolicy.v1) consumed by the production-read worker candidate.
stdlib only; no network; no Resolve. Refuses wildcards, empty project lists, non-Disk libraries, unknown hosts, unknown
operations, any write/persistence authority, and records the source digest so provenance is checkable.
Usage: compile_production_read_policy.py SOURCE.json OUT.json   (prints the pinned policy sha256 for --production-policy-sha256)"""
import hashlib, json, re, sys
HOSTS = ("presto", "vidlap2", "vidnux")
OPS = ("health", "identify", "get_current_project", "get_current_timeline", "list_timelines", "get_project_settings", "get_timeline_settings", "get_media_pool_summary", "get_project_fingerprint")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
class PolicyError(Exception): pass
def canon(o): return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
def sha(b): return hashlib.sha256(b).hexdigest()
def req(c, msg):
    if not c: raise PolicyError(msg)
def compile_record(raw_bytes):
    src = json.loads(raw_bytes)
    req(isinstance(src, dict), "source must be an object")
    req(src.get("schema") == "vidtoolz.resolveProductionReadAuthority.v1", "wrong source schema")
    req(src.get("status") in ("CANDIDATE_FOR_INDEPENDENT_REVIEW", "ACCEPTED"), "status must be CANDIDATE_FOR_INDEPENDENT_REVIEW or ACCEPTED")
    req(src.get("write_authority") == "NONE", "write_authority must be NONE")
    req(src.get("persistent_worker_authority") == "NONE", "persistent_worker_authority must be NONE")
    req(src.get("external_scripting") == "Local", "external_scripting must be Local")
    req(sorted(src.get("operations") or []) == sorted(OPS) and len(src["operations"]) == 9, "operations must be exactly the nine read operations")
    wid = src.get("worker_identity") or {}; req(re.fullmatch(r"[0-9a-f]{64}", str(wid.get("worker_sha256", ""))), "worker_identity.worker_sha256 must be a sha256")
    fid = src.get("facade_identity") or {}; req(re.fullmatch(r"[0-9a-f]{40}", str(fid.get("commit", ""))), "facade_identity.commit must be a 40-hex commit")
    hosts = src.get("hosts"); req(isinstance(hosts, list), "hosts must be a list")
    out_hosts, seen = {}, set()
    for h in hosts:
        hid = (h or {}).get("host_id"); req(hid in HOSTS, f"unknown host {hid!r}"); req(hid not in seen, f"duplicate host {hid!r}"); seen.add(hid)
        libs = h.get("libraries"); req(isinstance(libs, list), f"{hid}: libraries must be a list"); out_libs = []
        for lib in libs:
            req(isinstance(lib, dict), f"{hid}: library must be an object")
            req(lib.get("kind") == "Disk", f"{hid}: library kind {lib.get('kind')!r} not supported in v1 (Disk only; network libraries such as EKA/nelja are DEFERRED)")
            name, root = lib.get("name"), lib.get("registration_root")
            for v, what in ((name, "name"), (root, "registration_root")):
                req(isinstance(v, str) and v.strip() and v.strip() != "*" and not any(ch in v for ch in "?[]"), f"{hid}: library {what} must be a literal non-empty string (no wildcards)")
            projs = lib.get("projects"); req(isinstance(projs, list) and projs, f"{hid}/{name}: projects must be a non-empty list (empty never means all)")
            uuids = []
            for p in projs:
                u = (p or {}).get("project_uuid") if isinstance(p, dict) else p
                req(isinstance(u, str) and UUID_RE.match(u), f"{hid}/{name}: project entry {str(u)[:40]!r} is not an RFC 4122 UUID (names/wildcards refused)")
                req(u not in uuids, f"{hid}/{name}: duplicate project {u}"); uuids.append(u)
            req(not any(l["name"] == name and l["registration_root"] == root for l in out_libs), f"{hid}: duplicate library identity {name!r}@{root!r}")
            out_libs.append({"kind": "Disk", "name": name, "registration_root": root, "projects": sorted(uuids)})
        out_hosts[hid] = {"libraries": sorted(out_libs, key=lambda l: (l["name"], l["registration_root"]))}
    body = {"schema": "vidtoolz.resolveProductionReadRuntimePolicy.v1", "source_schema": src["schema"], "authority_id": src["authority_id"], "source_status": src["status"],
            "source_record_sha256": sha(raw_bytes), "worker_sha256": wid["worker_sha256"], "facade_commit": fid["commit"], "operations": list(OPS),
            "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local", "network_libraries": "DEFERRED", "hosts": out_hosts}
    body["policy_sha256"] = sha(canon({k: v for k, v in body.items() if k != "policy_sha256"}))
    return body
def main(argv):
    if len(argv) != 3: print(__doc__); return 2
    raw = open(argv[1], "rb").read()
    try: pol = compile_record(raw)
    except PolicyError as e: print(json.dumps({"ok": False, "error": "POLICY_REJECTED", "message": str(e)})); return 2
    data = canon(pol)                                   # canonical bytes on disk: the FILE digest is the pin the worker verifies
    open(argv[2], "wb").write(data)
    print(json.dumps({"ok": True, "out": argv[2], "policy_file_sha256": sha(data), "embedded_policy_sha256": pol["policy_sha256"], "source_record_sha256": pol["source_record_sha256"], "hosts": {h: sum(len(l["projects"]) for l in v["libraries"]) for h, v in pol["hosts"].items()}}, indent=1)); return 0
if __name__ == "__main__": sys.exit(main(sys.argv))
