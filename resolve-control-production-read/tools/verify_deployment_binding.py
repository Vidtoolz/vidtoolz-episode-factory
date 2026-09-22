#!/usr/bin/env python3
"""Offline deployment-binding verifier for the isolated production-read chain.

Independently re-derives, from bytes on disk only, that one specific facade installation, one worker, one authority record, one
compiled policy and one sealed session profile are the SAME governed deployment — before anything is launched and without contacting
Resolve, the network or any project library. Every link is a digest equality, not a name match:

  facade install  == accepted facade manifest (exact file set + sha256, commit 8e068fea)
  worker bytes    == authority.worker_identity.worker_sha256 == policy.worker_sha256 == profile.governed.worker_sha256
  authority bytes == policy.source_record_sha256             == profile.governed.authority_sha256
  policy body     == policy.policy_sha256                    == profile.governed.policy_sha256
  profile         == its own governed_sha256, sealed files unchanged, exactly one Disk registration
  grant           == vidnux / Linux / ISOLATED_DISK_SESSION / WRITE NONE / PERSISTENT NONE / scripting Local

A mixed deployment (accepted facade + some other worker, a policy compiled from a different record, a profile regenerated against a
different grant, an edited registration) fails here instead of at the production library.

Usage: verify_deployment_binding.py --facade-dir DIR --facade-manifest JSON --worker WORKER.py --authority A.json --policy P.json --session S.json [--json]
"""
import hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compile_production_read_policy as C

PROFILE_SCHEMA = "vidtoolz.resolveProductionReadSessionProfile.v1"


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def canonical_sha256(o): return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Checks:
    def __init__(self): self.rows = []
    def check(self, name, ok, detail=""):
        self.rows.append({"check": name, "ok": bool(ok), "detail": str(detail)[:300]}); return bool(ok)
    @property
    def ok(self): return all(r["ok"] for r in self.rows)


def verify_facade(ck, facade_dir, manifest):
    if not ck.check("facade.manifest_schema", manifest.get("schema") == "vidtoolz.resolveFacadeManifest.v1", manifest.get("schema")): return
    ck.check("facade.commit_is_accepted", manifest.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, manifest.get("facade_commit"))
    want = manifest.get("files") or {}
    if not ck.check("facade.manifest_has_files", bool(want), len(want)): return
    found = {}
    for dirpath, dirnames, filenames in os.walk(facade_dir):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for n in sorted(filenames):
            if n.endswith(".pyc"): continue
            full = os.path.join(dirpath, n)
            found[os.path.relpath(full, facade_dir)] = full
    missing = sorted(set(want) - set(found)); extra = sorted(set(found) - set(want))
    ck.check("facade.no_missing_files", not missing, missing)
    ck.check("facade.no_extra_files", not extra, extra)
    bad = []
    for rel in sorted(set(want) & set(found)):
        got = sha_file(found[rel])
        if got != want[rel]["sha256"]: bad.append(rel)
    ck.check("facade.bytes_match_accepted_commit", not bad, bad)


def verify(facade_dir, facade_manifest, worker, authority, policy, session):
    ck = Checks()
    fman = json.load(open(facade_manifest))
    verify_facade(ck, facade_dir, fman)

    worker_sha = sha_file(worker)
    auth_raw = open(authority, "rb").read(); auth_sha = hashlib.sha256(auth_raw).hexdigest()
    src = json.loads(auth_raw)
    try:
        C.validate_schema(src); ck.check("authority.schema_valid", True, src.get("authority_id"))
    except C.PolicyError as e:
        ck.check("authority.schema_valid", False, e); return ck
    gaps = C.acceptance_gaps(src, worker_sha)
    ck.check("authority.accepted_and_pinned", not gaps, "; ".join(gaps))

    pol_raw = open(policy, "rb").read(); pol = json.loads(pol_raw)
    ck.check("policy.schema", pol.get("schema") == C.SCHEMA_OUT, pol.get("schema"))
    ck.check("policy.live", pol.get("live") is True, pol.get("live"))
    ck.check("policy.self_digest", pol.get("policy_sha256") == canonical_sha256({k: v for k, v in pol.items() if k != "policy_sha256"}), pol.get("policy_sha256"))
    ck.check("policy.binds_authority_bytes", pol.get("source_record_sha256") == auth_sha, pol.get("source_record_sha256"))
    ck.check("policy.binds_worker_bytes", pol.get("worker_sha256") == worker_sha, pol.get("worker_sha256"))
    ck.check("policy.binds_accepted_facade", pol.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, pol.get("facade_commit"))
    ck.check("policy.host_is_vidnux", pol.get("host_id") in C.HOSTS and pol.get("platform") == C.PLATFORM, f'{pol.get("host_id")}/{pol.get("platform")}')
    ck.check("policy.session_profile_type", pol.get("session_profile_type") == C.SESSION_PROFILE_TYPE, pol.get("session_profile_type"))
    ck.check("policy.no_write_authority", pol.get("write_authority") == "NONE" and pol.get("persistent_worker_authority") == "NONE" and pol.get("external_scripting") == "Local",
             f'{pol.get("write_authority")}/{pol.get("persistent_worker_authority")}/{pol.get("external_scripting")}')
    ck.check("policy.operations_are_the_nine_reads", sorted(pol.get("operations") or []) == sorted(C.OPS), len(pol.get("operations") or []))
    ck.check("policy.library_matches_authority",
             isinstance(pol.get("library"), dict) and all(pol["library"].get(k) == (src.get("library") or {}).get(k) for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")),
             (pol.get("library") or {}).get("name"))
    ck.check("policy.projects_match_authority", sorted(pol.get("projects") or []) == sorted(p["project_uuid"] for p in (src.get("projects") or [])), len(pol.get("projects") or []))

    prof_raw = open(session, "rb").read(); prof = json.loads(prof_raw)
    ck.check("session.schema", prof.get("schema") == PROFILE_SCHEMA, prof.get("schema"))
    gov, prov = prof.get("governed") or {}, prof.get("provenance") or {}
    ck.check("session.governed_digest", prof.get("governed_sha256") == canonical_sha256(gov), prof.get("governed_sha256"))
    ck.check("session.binds_authority_bytes", gov.get("authority_sha256") == auth_sha, gov.get("authority_sha256"))
    ck.check("session.binds_policy_file", gov.get("policy_sha256") == hashlib.sha256(pol_raw).hexdigest(), gov.get("policy_sha256"))
    ck.check("session.binds_worker_bytes", gov.get("worker_sha256") == worker_sha, gov.get("worker_sha256"))
    ck.check("session.binds_accepted_facade", gov.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, gov.get("facade_commit"))
    ck.check("session.profile_type", gov.get("profile_type") == C.SESSION_PROFILE_TYPE, gov.get("profile_type"))
    ck.check("session.host", gov.get("host_id") in C.HOSTS and gov.get("platform") == C.PLATFORM, f'{gov.get("host_id")}/{gov.get("platform")}')
    lib = gov.get("library") or {}
    ck.check("session.library_matches_policy",
             isinstance(pol.get("library"), dict) and all(lib.get(k) == pol["library"].get(k) for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")), lib.get("name"))
    ck.check("session.projects_match_policy", sorted(gov.get("projects") or []) == sorted(pol.get("projects") or []), len(gov.get("projects") or []))
    ck.check("session.single_disk_registration", gov.get("registration_line") == f'{lib.get("name")}:{lib.get("canonical_root")}::::DISK', gov.get("registration_line"))

    root = prov.get("profile_root") or ""
    ck.check("session.profile_root_absolute", isinstance(root, str) and root.startswith("/") and not root.startswith("//"), root)
    ck.check("session.seal_instant", isinstance(prov.get("seal_epoch"), int) and prov["seal_epoch"] > 0, prov.get("seal_epoch"))
    files = prov.get("files") or {}
    bad = []
    for rel, want in sorted(files.items()):
        p = os.path.join(root, rel)
        try: got = sha_file(p)
        except OSError: bad.append(rel + " (unreadable)"); continue
        if got != want: bad.append(rel)
    ck.check("session.sealed_files_unchanged", files and not bad, bad or len(files))
    regfile = os.path.join(root, prov.get("registration_relpath") or "")
    try:
        lines = [l for l in open(regfile, encoding="utf-8", errors="replace").read().splitlines() if l.strip()]
    except OSError as e:
        lines = None; ck.check("session.registration_readable", False, type(e).__name__)
    if lines is not None:
        ck.check("session.registration_readable", True, regfile)
        ck.check("session.registration_is_exactly_one_authorized_library", lines == [gov.get("registration_line")], lines)
    return ck


def main(argv):
    keys = {"--facade-dir": "facade_dir", "--facade-manifest": "facade_manifest", "--worker": "worker",
            "--authority": "authority", "--policy": "policy", "--session": "session"}
    args = {}; i = 1; as_json = False
    while i < len(argv):
        if argv[i] == "--json": as_json = True; i += 1; continue
        if argv[i] not in keys or i + 1 >= len(argv): print(__doc__); return 2
        args[keys[argv[i]]] = argv[i + 1]; i += 2
    if set(args) != set(keys.values()): print(__doc__); return 2
    try: ck = verify(**args)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({"ok": False, "error": "BINDING_UNVERIFIABLE", "message": f"{type(e).__name__}: {str(e)[:300]}"})); return 2
    out = {"ok": ck.ok, "verdict": "DEPLOYMENT BINDING VERIFIED" if ck.ok else "DEPLOYMENT BINDING REFUSED",
           "checks_passed": sum(1 for r in ck.rows if r["ok"]), "checks_total": len(ck.rows),
           "failures": [r for r in ck.rows if not r["ok"]]}
    if as_json: out["checks"] = ck.rows
    print(json.dumps(out, indent=1))
    return 0 if ck.ok else 1


if __name__ == "__main__": sys.exit(main(sys.argv))
