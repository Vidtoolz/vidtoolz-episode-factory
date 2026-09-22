#!/usr/bin/env python3
"""Deterministic policy compiler (PRR-F01/F02 repaired): governed source record (vidtoolz.resolveProductionReadAuthority.v1)
-> runtime policy (vidtoolz.resolveProductionReadRuntimePolicy.v1) for the production-read worker candidate.
LIVE policies compile ONLY from an explicitly ACCEPTED, human-approved, fully bound record whose worker_sha256 equals the actual
candidate worker bytes (--worker) and whose facade_identity.commit is the accepted facade. Anything else compiles only with
--preview into a NON-LIVE deny-all artifact (live=false, hosts={}) that the worker refuses to serve.
Strict native schema validation (closed objects, exact types/enums/patterns, required fields) precedes everything; no wildcards.
Usage: compile_production_read_policy.py SOURCE.json OUT.json --worker WORKER.py [--preview]"""
import hashlib, json, re, sys, os
HOSTS = ("presto", "vidlap2", "vidnux")
OPS = ("health", "identify", "get_current_project", "get_current_timeline", "list_timelines", "get_project_settings", "get_timeline_settings", "get_media_pool_summary", "get_project_fingerprint")
STATUSES = ("CANDIDATE_FOR_INDEPENDENT_REVIEW", "ACCEPTED", "SUPERSEDED", "REJECTED")
APPROVERS = ("Mikko",)
ACCEPTED_FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"
SCHEMA_SRC = "vidtoolz.resolveProductionReadAuthority.v1"; SCHEMA_OUT = "vidtoolz.resolveProductionReadRuntimePolicy.v1"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"); HEX40 = re.compile(r"^[0-9a-f]{40}$"); HEX64 = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T[0-9:.+Z-]+)?$")
class PolicyError(Exception): pass
def canon(o): return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
def sha(b): return hashlib.sha256(b).hexdigest()
def req(c, msg):
    if not c: raise PolicyError(msg)
def _obj(o, allowed, required, where):
    req(isinstance(o, dict), f"{where}: must be an object")
    unknown = sorted(set(o) - set(allowed)); req(not unknown, f"{where}: unknown field(s) {unknown}")
    missing = sorted(set(required) - set(o)); req(not missing, f"{where}: missing required field(s) {missing}")
def _lit(v, where):
    req(isinstance(v, str) and v.strip() and v == v.strip() and v != "*" and not any(ch in v for ch in "?*[]\"'\n\r\t"), f"{where}: must be a literal non-empty string without wildcard/quote/control characters")
def validate_schema(src):
    """Closed-schema validation equivalent to schemas/resolveProductionReadAuthority.v1.schema.json (no external library)."""
    _obj(src, ("schema", "authority_id", "status", "approved_by", "approved_at", "acceptance_record", "worker_identity", "facade_identity", "hosts", "operations", "write_authority", "persistent_worker_authority", "external_scripting", "project_open_law", "network_libraries", "notes"),
         ("schema", "authority_id", "status", "approved_by", "worker_identity", "facade_identity", "hosts", "operations", "write_authority", "persistent_worker_authority", "external_scripting", "project_open_law"), "record")
    req(src["schema"] == SCHEMA_SRC, "record.schema: wrong schema")
    _lit(src["authority_id"], "record.authority_id")
    req(src["status"] in STATUSES, f"record.status: {src['status']!r} not in {STATUSES}")
    req(src["approved_by"] is None or (isinstance(src["approved_by"], str) and src["approved_by"] in APPROVERS), "record.approved_by: must be null or an allowlisted human approver")
    if "approved_at" in src: req(src["approved_at"] is None or (isinstance(src["approved_at"], str) and DATE_RE.match(src["approved_at"])), "record.approved_at: must be null or an ISO date")
    if "acceptance_record" in src: req(src["acceptance_record"] is None or (isinstance(src["acceptance_record"], str) and src["acceptance_record"].strip()), "record.acceptance_record: must be null or a non-empty path")
    w = src["worker_identity"]; _obj(w, ("component", "worker_sha256", "commit"), ("component", "worker_sha256"), "worker_identity")
    req(isinstance(w["component"], str) and w["component"].strip(), "worker_identity.component: string"); req(isinstance(w["worker_sha256"], str) and HEX64.match(w["worker_sha256"]), "worker_identity.worker_sha256: sha256 hex")
    if "commit" in w: req(w["commit"] is None or isinstance(w["commit"], str), "worker_identity.commit: string or null")
    f = src["facade_identity"]; _obj(f, ("commit", "tree"), ("commit",), "facade_identity"); req(isinstance(f["commit"], str) and HEX40.match(f["commit"]), "facade_identity.commit: 40-hex")
    if "tree" in f: req(isinstance(f["tree"], str) and HEX40.match(f["tree"]), "facade_identity.tree: 40-hex")
    req(isinstance(src["hosts"], list), "record.hosts: list"); seen_h = set()
    for i, h in enumerate(src["hosts"]):
        _obj(h, ("host_id", "libraries"), ("host_id", "libraries"), f"hosts[{i}]"); req(h["host_id"] in HOSTS, f"hosts[{i}].host_id: unknown host"); req(h["host_id"] not in seen_h, f"hosts[{i}]: duplicate host"); seen_h.add(h["host_id"])
        req(isinstance(h["libraries"], list), f"hosts[{i}].libraries: list"); seen_l = set()
        for j, lib in enumerate(h["libraries"]):
            _obj(lib, ("kind", "name", "registration_root", "canonical_root", "physical_dev", "physical_ino", "projects"), ("kind", "name", "registration_root", "canonical_root", "projects"), f"hosts[{i}].libraries[{j}]")
            req(lib["kind"] == "Disk", f"hosts[{i}].libraries[{j}].kind: {lib['kind']!r} not supported in v1 (Disk only; network libraries such as EKA/nelja are DEFERRED)")
            _lit(lib["name"], f"hosts[{i}].libraries[{j}].name"); _lit(lib["registration_root"], f"hosts[{i}].libraries[{j}].registration_root"); _lit(lib["canonical_root"], f"hosts[{i}].libraries[{j}].canonical_root")
            cr = lib["canonical_root"]; req(cr.startswith("/") and not cr.startswith("//") or re.match(r"^[A-Za-z]:\\", cr), f"hosts[{i}].libraries[{j}].canonical_root: must be an absolute local path (Linux '/…' or Windows 'X:\\…'); UNC refused")
            req(not any(seg in ("", ".", "..") for seg in re.split(r"[\\/]", cr.split(":", 1)[-1])[1:]), f"hosts[{i}].libraries[{j}].canonical_root: no empty/./.. segments or trailing separator")
            for k in ("physical_dev", "physical_ino"):
                if k in lib: req(isinstance(lib[k], int) and not isinstance(lib[k], bool), f"hosts[{i}].libraries[{j}].{k}: integer")
            key = (lib["name"], lib["registration_root"]); req(key not in seen_l, f"hosts[{i}].libraries[{j}]: duplicate library identity"); seen_l.add(key)
            req(isinstance(lib["projects"], list) and lib["projects"], f"hosts[{i}].libraries[{j}].projects: non-empty list (empty never means all)"); seen_p = set()
            for k, p in enumerate(lib["projects"]):
                _obj(p, ("project_uuid", "label"), ("project_uuid",), f"hosts[{i}].libraries[{j}].projects[{k}]")
                req(isinstance(p["project_uuid"], str) and UUID_RE.match(p["project_uuid"]), f"hosts[{i}].libraries[{j}].projects[{k}].project_uuid: RFC 4122 lowercase UUID (names/wildcards refused)")
                req(p["project_uuid"] not in seen_p, "duplicate project uuid"); seen_p.add(p["project_uuid"])
                if "label" in p: req(isinstance(p["label"], str), "label: string")
    req(isinstance(src["operations"], list) and len(src["operations"]) == 9 and sorted(src["operations"]) == sorted(OPS), "record.operations: exactly the nine read operations")
    req(src["write_authority"] == "NONE", "record.write_authority: must be NONE"); req(src["persistent_worker_authority"] == "NONE", "record.persistent_worker_authority: must be NONE")
    req(src["external_scripting"] == "Local", "record.external_scripting: must be Local")
    req(src["project_open_law"] == "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase", "record.project_open_law: exact law text required")
    if "network_libraries" in src: req(src["network_libraries"] == "DEFERRED — not authorized by v1 (EKA, nelja)", "record.network_libraries: exact v1 text")
    if "notes" in src: req(isinstance(src["notes"], str), "record.notes: string")
def is_accepted(src, worker_sha256):
    """Semantic acceptance: only this makes a record a grant."""
    return (src["status"] == "ACCEPTED" and src["approved_by"] in APPROVERS and isinstance(src.get("approved_at"), str) and bool(DATE_RE.match(src["approved_at"]))
            and isinstance(src.get("acceptance_record"), str) and bool(src["acceptance_record"].strip()) and src["worker_identity"]["worker_sha256"] == worker_sha256
            and src["facade_identity"]["commit"] == ACCEPTED_FACADE_COMMIT and bool(src["hosts"]) and all(h["libraries"] for h in src["hosts"]))
def compile_record(raw_bytes, worker_sha256, preview=False):
    src = json.loads(raw_bytes); validate_schema(src)
    base = {"schema": SCHEMA_OUT, "source_schema": SCHEMA_SRC, "authority_id": src["authority_id"], "source_record_sha256": sha(raw_bytes), "worker_sha256": worker_sha256,
            "facade_commit": ACCEPTED_FACADE_COMMIT, "operations": list(OPS), "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local", "network_libraries": "DEFERRED"}
    if not is_accepted(src, worker_sha256):
        why = []
        if src["status"] != "ACCEPTED": why.append(f"status {src['status']}")
        if src["approved_by"] not in APPROVERS: why.append("no human approver")
        if not (isinstance(src.get("approved_at"), str) and DATE_RE.match(src["approved_at"])): why.append("no approval date")
        if not (isinstance(src.get("acceptance_record"), str) and src["acceptance_record"].strip()): why.append("no acceptance record reference")
        if src["worker_identity"]["worker_sha256"] != worker_sha256: why.append("worker pin does not match the candidate worker bytes")
        if src["facade_identity"]["commit"] != ACCEPTED_FACADE_COMMIT: why.append("facade pin is not the accepted facade")
        if not src["hosts"] or not all(h["libraries"] for h in src["hosts"]): why.append("no explicit host/library grant")
        req(preview, "LIVE policy refused: record is not an accepted human-authorized grant (" + "; ".join(why) + "). Use --preview for a non-live deny-all artifact.")
        body = dict(base, live=False, authority_status=src["status"], approved_by=src["approved_by"], hosts={}, preview_reasons=why)
    else:
        req(not preview, "an ACCEPTED record compiles to a LIVE policy; --preview is only for non-accepted records")
        hosts = {}
        for h in src["hosts"]:
            libs = [{"kind": "Disk", "name": l["name"], "registration_root": l["registration_root"], "canonical_root": l["canonical_root"], "physical_dev": l.get("physical_dev"), "physical_ino": l.get("physical_ino"),
                     "projects": sorted(p["project_uuid"] for p in l["projects"])} for l in h["libraries"]]
            hosts[h["host_id"]] = {"libraries": sorted(libs, key=lambda l: (l["name"], l["registration_root"]))}
        body = dict(base, live=True, authority_status="ACCEPTED", approved_by=src["approved_by"], approved_at=src["approved_at"], acceptance_record=src["acceptance_record"], hosts=hosts)
    body["policy_sha256"] = sha(canon({k: v for k, v in body.items() if k != "policy_sha256"}))
    return body
def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]; flags = [a for a in argv[1:] if a.startswith("--")]
    worker = None
    if "--worker" in argv: worker = argv[argv.index("--worker") + 1]; args = [a for a in args if a != worker]
    if len(args) != 2 or not worker or any(f not in ("--worker", "--preview") for f in flags): print(__doc__); return 2
    raw = open(args[0], "rb").read(); wsha = sha(open(worker, "rb").read())
    try: pol = compile_record(raw, wsha, preview="--preview" in flags)
    except (PolicyError, ValueError, KeyError, TypeError) as e: print(json.dumps({"ok": False, "error": "POLICY_REJECTED", "message": str(e)[:400]})); return 2
    data = canon(pol); open(args[1], "wb").write(data)
    print(json.dumps({"ok": True, "live": pol["live"], "out": args[1], "policy_file_sha256": sha(data), "embedded_policy_sha256": pol["policy_sha256"], "source_record_sha256": pol["source_record_sha256"], "worker_sha256": wsha,
                      "hosts": {h: sum(len(l["projects"]) for l in v["libraries"]) for h, v in pol["hosts"].items()}}, indent=1)); return 0
if __name__ == "__main__": sys.exit(main(sys.argv))
