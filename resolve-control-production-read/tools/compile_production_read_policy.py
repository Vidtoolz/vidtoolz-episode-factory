#!/usr/bin/env python3
"""Deterministic policy compiler for the vidnux-only ISOLATED_DISK_SESSION production-read model.
Source record (vidtoolz.resolveProductionReadAuthority.v1) -> runtime policy (vidtoolz.resolveProductionReadRuntimePolicy.v1).
A LIVE policy compiles ONLY from a record that is ACCEPTED, approved by an allowlisted human on a real calendar date, references its
acceptance record, pins the exact candidate worker bytes and the accepted facade, names host vidnux on Linux with the isolated session
profile type, one local Disk library with a canonical physical root and device/inode, and at least one RFC 4122 project UUID.
Anything else compiles only with --preview into a NON-LIVE deny-all artifact the worker refuses to serve.
Strict native closed-schema validation precedes everything; no wildcards; network libraries and Windows are structurally unsupported.
Usage: compile_production_read_policy.py SOURCE.json OUT.json --worker WORKER.py [--preview]"""
import datetime, hashlib, json, re, sys
HOSTS = ("vidnux",); PLATFORM = "Linux"; SESSION_PROFILE_TYPE = "ISOLATED_DISK_SESSION"
OPS = ("health", "identify", "get_current_project", "get_current_timeline", "list_timelines", "get_project_settings", "get_timeline_settings", "get_media_pool_summary", "get_project_fingerprint")
STATUSES = ("CANDIDATE_FOR_INDEPENDENT_REVIEW", "ACCEPTED", "SUPERSEDED", "REJECTED")
APPROVERS = ("Mikko",)
ACCEPTED_FACADE_COMMIT = "8e068fea2d4df5b9709c387f6444502bd7bc2091"
PROHIBITED_LIBRARIES = ("EKA", "EKA192.168.50.199", "nelja", "nelja192.168.50.199", "Local Database")
SCHEMA_SRC = "vidtoolz.resolveProductionReadAuthority.v1"; SCHEMA_OUT = "vidtoolz.resolveProductionReadRuntimePolicy.v1"
PROJECT_OPEN_LAW = "read the project the human already opened; never LoadProject/OpenProject/SetCurrentProject/SetCurrentDatabase"
NETWORK_LIBRARIES_TEXT = "DEFERRED — not authorized by v1 (EKA, nelja)"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"); HEX40 = re.compile(r"^[0-9a-f]{40}$"); HEX64 = re.compile(r"^[0-9a-f]{64}$")
class PolicyError(Exception): pass
def canon(o): return json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
def sha(b): return hashlib.sha256(b).hexdigest()
def req(c, msg):
    if not c: raise PolicyError(msg)
def real_date(v):
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v[:10] if len(v) >= 10 else ""): return False
    try: datetime.date.fromisoformat(v[:10]); return True
    except ValueError: return False
def lit(v, where):
    req(isinstance(v, str) and v.strip() and v == v.strip() and v != "*" and not any(c in v for c in "?*[]\"'\n\r\t"),
        f"{where}: must be a literal non-empty string without wildcard/quote/control characters")
def abs_local_dir(v, where):
    lit(v, where)
    req(v.startswith("/") and not v.startswith("//"), f"{where}: must be an absolute local path (UNC/network roots are refused)")
    req(not any(s in ("", ".", "..") for s in v.split("/")[1:]), f"{where}: no empty, '.' or '..' segments and no trailing separator")
def obj(o, allowed, required, where):
    req(isinstance(o, dict), f"{where}: must be an object")
    req(not set(o) - set(allowed), f"{where}: unknown field(s) {sorted(set(o) - set(allowed))}")
    req(not set(required) - set(o), f"{where}: missing required field(s) {sorted(set(required) - set(o))}")
def validate_schema(src):
    obj(src, ("schema", "authority_id", "status", "approved_by", "approved_at", "acceptance_record", "worker_identity", "facade_identity",
              "host_id", "platform", "session_profile_type", "library", "projects", "operations", "write_authority",
              "persistent_worker_authority", "external_scripting", "project_open_law", "network_libraries", "notes"),
        ("schema", "authority_id", "status", "approved_by", "worker_identity", "facade_identity", "host_id", "platform",
         "session_profile_type", "library", "projects", "operations", "write_authority", "persistent_worker_authority",
         "external_scripting", "project_open_law"), "record")
    req(src["schema"] == SCHEMA_SRC, "record.schema: wrong schema"); lit(src["authority_id"], "record.authority_id")
    req(src["status"] in STATUSES, f"record.status: {src['status']!r} not in {STATUSES}")
    req(src["approved_by"] is None or src["approved_by"] in APPROVERS, "record.approved_by: must be null or an allowlisted human approver")
    if src.get("approved_at") is not None: req(real_date(src["approved_at"]), "record.approved_at: must be a real calendar date")
    if src.get("acceptance_record") is not None: lit(src["acceptance_record"], "record.acceptance_record")
    req(src["host_id"] in HOSTS, f"record.host_id: {src['host_id']!r} is not a supported production-read host (v1: vidnux only; PRESTO/VIDLAP2 are not authorizable)")
    req(src["platform"] == PLATFORM, "record.platform: v1 supports Linux only; Windows production reads are structurally unsupported")
    req(src["session_profile_type"] == SESSION_PROFILE_TYPE, "record.session_profile_type: only ISOLATED_DISK_SESSION is supported")
    w = src["worker_identity"]; obj(w, ("component", "worker_sha256", "commit"), ("component", "worker_sha256"), "worker_identity")
    lit(w["component"], "worker_identity.component"); req(isinstance(w["worker_sha256"], str) and HEX64.match(w["worker_sha256"]), "worker_identity.worker_sha256: sha256 hex")
    if "commit" in w: req(w["commit"] is None or isinstance(w["commit"], str), "worker_identity.commit: string or null")
    f = src["facade_identity"]; obj(f, ("commit", "tree"), ("commit",), "facade_identity")
    req(isinstance(f["commit"], str) and HEX40.match(f["commit"]), "facade_identity.commit: 40-hex")
    if "tree" in f: req(isinstance(f["tree"], str) and HEX40.match(f["tree"]), "facade_identity.tree: 40-hex")
    accepted = src["status"] == "ACCEPTED"
    lib = src["library"]
    if lib is None or src["projects"] == []:
        # an unaccepted record may still be awaiting its human scope selection; it can never compile to a LIVE policy
        req(not accepted, "record: an ACCEPTED record must name exactly one Disk library and at least one project UUID")
        req(lib is None and src["projects"] == [], "record: library and projects must be selected together (both null/empty, or both populated)")
        req(isinstance(src["projects"], list), "record.projects: must be a list")
        _tail(src); return
    obj(lib, ("kind", "name", "canonical_root", "physical_dev", "physical_ino"), ("kind", "name", "canonical_root", "physical_dev", "physical_ino"), "library")
    req(lib["kind"] == "Disk", f"library.kind: {lib['kind']!r} not supported (v1: local Disk only; EKA/nelja/PostgreSQL/QPSQL are DEFERRED)")
    lit(lib["name"], "library.name"); req(lib["name"] not in PROHIBITED_LIBRARIES, f"library.name: {lib['name']!r} is a prohibited library")
    abs_local_dir(lib["canonical_root"], "library.canonical_root")
    for k in ("physical_dev", "physical_ino"):
        req(isinstance(lib[k], int) and not isinstance(lib[k], bool), f"library.{k}: integer required (physical identity is mandatory)")
    req(isinstance(src["projects"], list) and src["projects"], "record.projects: non-empty list (empty never means all)")
    seen = set()
    for i, p in enumerate(src["projects"]):
        obj(p, ("project_uuid", "label"), ("project_uuid",), f"projects[{i}]")
        req(isinstance(p["project_uuid"], str) and UUID_RE.match(p["project_uuid"]), f"projects[{i}].project_uuid: lowercase RFC 4122 UUID (names/wildcards refused)")
        req(p["project_uuid"] not in seen, f"projects[{i}]: duplicate project_uuid"); seen.add(p["project_uuid"])
        if "label" in p: req(isinstance(p["label"], str), f"projects[{i}].label: string")
    _tail(src)
def _tail(src):
    req(isinstance(src["operations"], list) and len(src["operations"]) == 9 and sorted(src["operations"]) == sorted(OPS), "record.operations: exactly the nine read operations")
    req(src["write_authority"] == "NONE", "record.write_authority: must be NONE")
    req(src["persistent_worker_authority"] == "NONE", "record.persistent_worker_authority: must be NONE")
    req(src["external_scripting"] == "Local", "record.external_scripting: must be Local")
    req(src["project_open_law"] == PROJECT_OPEN_LAW, "record.project_open_law: exact law text required")
    if "network_libraries" in src: req(src["network_libraries"] == NETWORK_LIBRARIES_TEXT, "record.network_libraries: exact v1 text")
    if "notes" in src: req(isinstance(src["notes"], str), "record.notes: string")
def acceptance_gaps(src, worker_sha256):
    why = []
    if src["status"] != "ACCEPTED": why.append(f"status {src['status']}")
    if src["approved_by"] not in APPROVERS: why.append("no human approver")
    if not real_date(src.get("approved_at")): why.append("no real calendar approval date")
    if not (isinstance(src.get("acceptance_record"), str) and src["acceptance_record"].strip()): why.append("no acceptance record reference")
    if src["worker_identity"]["worker_sha256"] != worker_sha256: why.append("worker pin does not match the candidate worker bytes")
    if src["facade_identity"]["commit"] != ACCEPTED_FACADE_COMMIT: why.append("facade pin is not the accepted facade")
    return why
def compile_record(raw_bytes, worker_sha256, preview=False):
    src = json.loads(raw_bytes); validate_schema(src)
    base = {"schema": SCHEMA_OUT, "source_schema": SCHEMA_SRC, "authority_id": src["authority_id"], "source_record_sha256": sha(raw_bytes),
            "worker_sha256": worker_sha256, "facade_commit": ACCEPTED_FACADE_COMMIT, "host_id": src["host_id"], "platform": PLATFORM,
            "session_profile_type": SESSION_PROFILE_TYPE, "operations": list(OPS), "write_authority": "NONE",
            "persistent_worker_authority": "NONE", "external_scripting": "Local", "network_libraries": "DEFERRED"}
    gaps = acceptance_gaps(src, worker_sha256)
    if gaps:
        req(preview, "LIVE policy refused: record is not an accepted human-authorized grant (" + "; ".join(gaps) + "). Use --preview for a non-live deny-all artifact.")
        body = dict(base, live=False, authority_status=src["status"], approved_by=src["approved_by"], library=None, projects=[], preview_reasons=gaps)
    else:
        req(not preview, "an ACCEPTED record compiles to a LIVE policy; --preview is only for non-accepted records")
        body = dict(base, live=True, authority_status="ACCEPTED", approved_by=src["approved_by"], approved_at=src["approved_at"],
                    acceptance_record=src["acceptance_record"],
                    library={k: src["library"][k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")},
                    projects=sorted(p["project_uuid"] for p in src["projects"]))
    body["policy_sha256"] = sha(canon({k: v for k, v in body.items() if k != "policy_sha256"}))
    return body
def main(argv):
    flags = [a for a in argv[1:] if a.startswith("--")]; worker = None
    if "--worker" in argv: worker = argv[argv.index("--worker") + 1]
    args = [a for a in argv[1:] if not a.startswith("--") and a != worker]
    if len(args) != 2 or not worker or any(f not in ("--worker", "--preview") for f in flags): print(__doc__); return 2
    raw = open(args[0], "rb").read(); wsha = sha(open(worker, "rb").read())
    try: pol = compile_record(raw, wsha, preview="--preview" in flags)
    except (PolicyError, ValueError, KeyError, TypeError) as e: print(json.dumps({"ok": False, "error": "POLICY_REJECTED", "message": str(e)[:400]})); return 2
    data = canon(pol); open(args[1], "wb").write(data)
    print(json.dumps({"ok": True, "live": pol["live"], "out": args[1], "policy_file_sha256": sha(data), "embedded_policy_sha256": pol["policy_sha256"],
                      "source_record_sha256": pol["source_record_sha256"], "worker_sha256": wsha, "host_id": pol["host_id"],
                      "library": (pol["library"] or {}).get("name"), "projects": len(pol["projects"])}, indent=1)); return 0
if __name__ == "__main__": sys.exit(main(sys.argv))
