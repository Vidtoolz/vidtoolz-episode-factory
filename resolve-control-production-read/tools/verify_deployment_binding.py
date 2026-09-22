#!/usr/bin/env python3
"""Offline deployment-binding verifier for the attested isolated production-read chain.

Independently re-derives, from bytes on disk only, that one facade installation, one worker, one authority record, one compiled policy,
one sealed session profile and one runtime session attestation are the SAME governed deployment — without contacting Resolve, the
network or any project library. Every link is a digest equality, not a name match:

  facade install  == accepted facade manifest (exact file set + sha256, commit 8e068fea)
  worker bytes    == authority.worker_identity.worker_sha256 == policy.worker_sha256 == profile.worker_sha256 == attestation.worker_sha256
  authority bytes == policy.source_record_sha256             == profile.authority_sha256 == attestation.authority_sha256
  policy file     == profile.policy_sha256                   == attestation.policy_sha256   (and policy body == its embedded digest)
  profile file    == attestation.profile_sha256
  profile on disk == the EXACT sealed tree, no extras, no symlinks, root physical identity intact   (the worker's own law, imported)
  executable      == the sealed realpath + size + sha256, hashed here
  attestation     == its own digest, a nonce digest, one scripting port, one profile root, created at/after the seal
  grant           == vidnux / Linux / ISOLATED_DISK_SESSION / WRITE NONE / PERSISTENT NONE / scripting Local / nine ops

A mixed deployment (accepted facade + some other worker, a policy compiled from a different record, a profile regenerated against a
different grant, an attestation from another session, an edited registration, an added unsealed file) fails here instead of at the
production library.

Usage: verify_deployment_binding.py --facade-dir DIR --facade-manifest JSON --worker WORKER.py --authority A.json --policy P.json
                                    --session S.json [--attestation ATT.json | --pre-launch] [--json]
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(os.path.dirname(HERE), "worker"))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "capsule"))
import compile_production_read_policy as C
import resolve_worker as rw                       # the profile law is IMPORTED, so the verifier and the worker cannot diverge
import vrc_capsule_confine as confine_mod         # ...and so is the seccomp filter, so a re-built filter cannot drift from the seal

PROFILE_SCHEMA = rw.PROFILE_SCHEMA
ATTESTATION_SCHEMA = rw.ATTESTATION_SCHEMA


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""): h.update(chunk)
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
    bad = [rel for rel in sorted(set(want) & set(found)) if sha_file(found[rel]) != want[rel]["sha256"]]
    ck.check("facade.bytes_match_accepted_commit", not bad, bad)


def verify(facade_dir, facade_manifest, worker, authority, policy, session, attestation=None, pre_launch=False, secret_file=None,
           host_boundary=None):
    boundary = json.load(open(host_boundary)) if host_boundary else C.HOST_PRIMITIVE
    ck = Checks()
    verify_facade(ck, facade_dir, json.load(open(facade_manifest)))

    worker_sha = sha_file(worker)
    auth_raw = open(authority, "rb").read(); auth_sha = hashlib.sha256(auth_raw).hexdigest()
    src = json.loads(auth_raw)
    try:
        C.validate_schema(src, boundary); ck.check("authority.schema_valid", True, src.get("authority_id"))
    except C.PolicyError as e:
        ck.check("authority.schema_valid", False, e); return ck
    ck.check("authority.accepted_and_pinned", not C.acceptance_gaps(src, worker_sha), "; ".join(C.acceptance_gaps(src, worker_sha)))

    pol_raw = open(policy, "rb").read(); pol = json.loads(pol_raw); pol_sha = hashlib.sha256(pol_raw).hexdigest()
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
    ck.check("policy.execution_environment_is_the_approved_capsule",
             pol.get("execution_environment") == src.get("execution_environment") and pol.get("execution_environment") in C.EXECUTION_ENVIRONMENTS,
             pol.get("execution_environment"))
    ck.check("policy.host_primitive_is_the_approved_boundary",
             pol.get("host_primitive") == src.get("host_primitive") == boundary,
             (pol.get("host_primitive") or {}).get("host_review_manifest_sha256"))
    ck.check("policy.caller_identity_matches_authority", pol.get("caller_identity") == src.get("caller_identity"),
             (pol.get("caller_identity") or {}).get("hmac_key_id"))
    ck.check("policy.caller_is_not_the_capsule_account",
             isinstance(pol.get("caller_identity"), dict) and pol["caller_identity"].get("operator_uid") != (pol.get("host_primitive") or {}).get("capsule_uid"),
             (pol.get("caller_identity") or {}).get("operator_uid"))
    ck.check("policy.control_operations_are_the_governed_stop", sorted(pol.get("control_operations") or []) == sorted(C.CONTROL_OPS), pol.get("control_operations"))

    prof_raw = open(session, "rb").read(); prof = json.loads(prof_raw); prof_sha = hashlib.sha256(prof_raw).hexdigest()
    gov, prov = prof.get("governed") or {}, prof.get("provenance") or {}
    ck.check("session.schema", prof.get("schema") == PROFILE_SCHEMA, prof.get("schema"))
    ck.check("session.governed_digest", prof.get("governed_sha256") == canonical_sha256(gov), prof.get("governed_sha256"))
    ck.check("session.binds_authority_bytes", gov.get("authority_sha256") == auth_sha, gov.get("authority_sha256"))
    ck.check("session.binds_policy_file", gov.get("policy_sha256") == pol_sha, gov.get("policy_sha256"))
    ck.check("session.binds_worker_bytes", gov.get("worker_sha256") == worker_sha, gov.get("worker_sha256"))
    ck.check("session.binds_accepted_facade", gov.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, gov.get("facade_commit"))
    ck.check("session.profile_type", gov.get("profile_type") == C.SESSION_PROFILE_TYPE, gov.get("profile_type"))
    ck.check("session.host", gov.get("host_id") in C.HOSTS and gov.get("platform") == C.PLATFORM, f'{gov.get("host_id")}/{gov.get("platform")}')
    lib = gov.get("library") or {}
    ck.check("session.library_matches_policy",
             isinstance(pol.get("library"), dict) and all(lib.get(k) == pol["library"].get(k) for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")), lib.get("name"))
    ck.check("session.projects_match_policy", sorted(gov.get("projects") or []) == sorted(pol.get("projects") or []), len(gov.get("projects") or []))
    ck.check("session.single_disk_registration", gov.get("registration_line") == f'{lib.get("name")}:{lib.get("canonical_root")}::::DISK', gov.get("registration_line"))
    tree = gov.get("tree") or {}
    ck.check("session.exact_tree_sealed", bool(tree) and prov.get("registration_relpath") in tree, len(tree))
    ck.check("session.constrained_paths_are_sealed", not (set(gov.get("constrained") or []) - set(tree)), gov.get("constrained"))
    ck.check("session.volatile_allowlist_is_bounded",
             isinstance(gov.get("volatile_patterns"), list) and all(isinstance(p, str) and p not in ("*", "**", "/**") and not p.startswith("config/**") for p in gov.get("volatile_patterns") or []),
             len(gov.get("volatile_patterns") or []))
    ck.check("session.scripting_port", isinstance(gov.get("script_server_port"), int) and 0 < gov["script_server_port"] < 65536, gov.get("script_server_port"))
    ck.check("session.seal_instant", isinstance(prov.get("seal_epoch"), int) and prov["seal_epoch"] > 0, prov.get("seal_epoch"))
    hp = gov.get("host_primitive") or {}
    ck.check("session.binds_host_primitive", hp == pol.get("host_primitive") == boundary, hp.get("runtime_root"))
    ck.check("session.binds_caller_identity", gov.get("caller_identity") == pol.get("caller_identity"), (gov.get("caller_identity") or {}).get("hmac_key_id"))
    mask = gov.get("evidence_mask") or []
    ck.check("session.evidence_mask_is_bounded_and_absolute",
             isinstance(mask, list) and mask and len(set(mask)) == len(mask) and all(isinstance(m, str) and m.startswith("/") and m != "/" and m == os.path.normpath(m) for m in mask), mask)
    ck.check("session.evidence_mask_does_not_hide_the_read",
             all(not (t == m or t.startswith(m.rstrip("/") + "/")) for m in mask
                 for t in (lib.get("canonical_root") or "/x", hp.get("runtime_root") or "/x", prov.get("profile_root") or "/x")), mask)
    conf = gov.get("confinement") or {}
    ck.check("session.confinement_pins_this_seccomp_filter",
             conf.get("seccomp_filter_sha256") == hashlib.sha256(confine_mod.seccomp_program()[0]).hexdigest(), conf.get("seccomp_filter_sha256"))
    ck.check("session.confinement_denies_the_mask_removal_calls",
             all(n in (conf.get("denied_syscalls") or []) for n in ("mount", "umount2", "unshare", "setns", "pivot_root", "ptrace")), len(conf.get("denied_syscalls") or []))
    ck.check("session.executable_is_the_frozen_capsule_runtime",
             (gov.get("resolve_binary") or {}).get("realpath") == os.path.join(hp.get("runtime_root") or "/x", "bin", "resolve")
             and (gov.get("resolve_binary") or {}).get("sha256") == hp.get("resolve_binary_sha256"),
             (gov.get("resolve_binary") or {}).get("realpath"))
    if boundary == C.HOST_PRIMITIVE:
        try:
            facts = rw.verify_host_primitive(hp) if hp else None
            ck.check("host.approved_primitive_verifies_on_this_host", bool(facts), (facts or {}).get("broker_sha256"))
        except (rw.OpError, KeyError, TypeError) as e:
            ck.check("host.approved_primitive_verifies_on_this_host", False, (getattr(e, "detail", None) or {}).get("reason") or repr(e)[:120])
    else:
        # An injected boundary is checked structurally only: it names a capsule that does not exist on this machine, and a worker
        # compiled against the approved constants refuses it outright. It is a staging/offline artifact, never a deployment.
        ck.check("host.boundary_is_injected_and_not_the_approved_one", hp == boundary != C.HOST_PRIMITIVE, hp.get("runtime_root"))
    if secret_file:
        try:
            key = open(secret_file, "rb").read().strip()
            facts = rw.verify_secret_placement(os.path.abspath(secret_file), key, gov.get("caller_identity") or {}, rw.SystemProbe(), self_uid=hp.get("capsule_uid"))
            ck.check("key.cross_account_placement", True, facts["hmac_key_id"])
        except (rw.OpError, OSError, KeyError, TypeError) as e:
            ck.check("key.cross_account_placement", False, (getattr(e, "detail", None) or {}).get("reason") or repr(e)[:120])

    # the profile ON DISK, under the worker's own law
    try:
        rw.verify_profile_root(prov); ck.check("session.profile_root_identity", True, prov.get("profile_root"))
    except rw.OpError as e:
        ck.check("session.profile_root_identity", False, (e.detail or {}).get("reason"))
    try:
        rw.verify_profile_tree(prov, gov); ck.check("session.profile_tree_is_exact_on_disk", True, f'{len(tree)} sealed files')
    except (rw.OpError, KeyError, OSError) as e:
        ck.check("session.profile_tree_is_exact_on_disk", False, (getattr(e, "detail", None) or {}).get("reason") or repr(e)[:120])

    binary = (gov.get("resolve_binary") or {})
    if os.path.isfile(binary.get("realpath") or ""):
        st = os.stat(binary["realpath"])
        ck.check("session.executable_size", st.st_size == binary.get("bytes"), st.st_size)
        ck.check("session.executable_sha256", sha_file(binary["realpath"]) == binary.get("sha256"), binary.get("sha256"))
    else:
        ck.check("session.executable_present", False, binary.get("realpath"))

    if pre_launch:
        ck.check("attestation.not_required_pre_launch", True, "pre-launch verification: no session has been created yet")
        return ck
    if not attestation:
        ck.check("attestation.provided", False, "no runtime attestation given and --pre-launch not requested"); return ck
    att_raw = open(attestation, "rb").read(); att = json.loads(att_raw)
    ck.check("attestation.schema", att.get("schema") == ATTESTATION_SCHEMA, att.get("schema"))
    ck.check("attestation.self_digest", att.get("attestation_sha256") == canonical_sha256({k: v for k, v in att.items() if k != "attestation_sha256"}), att.get("attestation_sha256"))
    ck.check("attestation.binds_session_profile", att.get("profile_sha256") == prof_sha and att.get("session_id") == gov.get("session_id"), att.get("profile_sha256"))
    ck.check("attestation.binds_policy_file", att.get("policy_sha256") == pol_sha, att.get("policy_sha256"))
    ck.check("attestation.binds_authority_bytes", att.get("authority_sha256") == auth_sha, att.get("authority_sha256"))
    ck.check("attestation.binds_worker_bytes", att.get("worker_sha256") == worker_sha, att.get("worker_sha256"))
    ck.check("attestation.binds_accepted_facade", att.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, att.get("facade_commit"))
    ck.check("attestation.binds_profile_root",
             att.get("profile_root") == prov.get("profile_root") and att.get("profile_root_dev") == prov.get("profile_root_dev") and att.get("profile_root_ino") == prov.get("profile_root_ino"),
             att.get("profile_root"))
    ck.check("attestation.binds_scripting_port", att.get("script_server_port") == gov.get("script_server_port"), att.get("script_server_port"))
    ck.check("attestation.binds_executable",
             (att.get("executable") or {}).get("sha256") == binary.get("sha256") and (att.get("executable") or {}).get("realpath") == binary.get("realpath"),
             (att.get("executable") or {}).get("realpath"))
    ck.check("attestation.carries_nonce_digest", isinstance(att.get("nonce_sha256"), str) and len(att.get("nonce_sha256") or "") == 64, bool(att.get("nonce_sha256")))
    ck.check("attestation.nonce_plaintext_absent", "nonce" not in att and not any(k for k in att if k.endswith("nonce")), sorted(k for k in att if "nonce" in k))
    ck.check("attestation.created_after_seal", isinstance(att.get("created_epoch"), int) and att["created_epoch"] >= (prov.get("seal_epoch") or 0), att.get("created_epoch"))
    ck.check("attestation.names_one_process", isinstance(att.get("resolve_pid"), int) and att["resolve_pid"] > 0 and isinstance(att.get("resolve_start_ticks"), int), att.get("resolve_pid"))
    ck.check("attestation.binds_host_primitive", att.get("host_primitive") == hp and att.get("execution_environment") == gov.get("execution_environment"), att.get("execution_environment"))
    ck.check("attestation.capsule_account", att.get("capsule_uid") == hp.get("capsule_uid"), att.get("capsule_uid"))
    ck.check("attestation.resolve_has_its_own_mount_namespace",
             isinstance(att.get("resolve_mnt_ns"), str) and isinstance(att.get("worker_mnt_ns"), str) and att["resolve_mnt_ns"] != att["worker_mnt_ns"],
             f'{att.get("worker_mnt_ns")} vs {att.get("resolve_mnt_ns")}')
    ck.check("attestation.resolve_is_confined",
             att.get("resolve_no_new_privs") == 1 and att.get("resolve_seccomp") == confine_mod.SECCOMP_MODE_FILTER
             and att.get("seccomp_filter_sha256") == conf.get("seccomp_filter_sha256") and att.get("resolve_seccomp_filters") == conf.get("seccomp_filters"),
             f'nnp={att.get("resolve_no_new_privs")} seccomp={att.get("resolve_seccomp")} filters={att.get("resolve_seccomp_filters")}')
    ck.check("attestation.evidence_mask_matches_the_seal", sorted(att.get("evidence_mask") or []) == sorted(mask), att.get("evidence_mask"))
    return ck


def main(argv):
    keys = {"--facade-dir": "facade_dir", "--facade-manifest": "facade_manifest", "--worker": "worker",
            "--authority": "authority", "--policy": "policy", "--session": "session", "--attestation": "attestation",
            "--secret-file": "secret_file", "--host-boundary": "host_boundary"}
    args = {}; i = 1; as_json = False; pre = False
    while i < len(argv):
        if argv[i] == "--json": as_json = True; i += 1; continue
        if argv[i] == "--pre-launch": pre = True; i += 1; continue
        if argv[i] not in keys or i + 1 >= len(argv): print(__doc__); return 2
        args[keys[argv[i]]] = argv[i + 1]; i += 2
    if set(args) - set(keys.values()) or any(k not in args for k in ("facade_dir", "facade_manifest", "worker", "authority", "policy", "session")):
        print(__doc__); return 2
    try: ck = verify(pre_launch=pre, **args)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({"ok": False, "error": "BINDING_UNVERIFIABLE", "message": f"{type(e).__name__}: {str(e)[:300]}"})); return 2
    out = {"ok": ck.ok, "verdict": "DEPLOYMENT BINDING VERIFIED" if ck.ok else "DEPLOYMENT BINDING REFUSED",
           "checks_passed": sum(1 for r in ck.rows if r["ok"]), "checks_total": len(ck.rows),
           "failures": [r for r in ck.rows if not r["ok"]]}
    if as_json: out["checks"] = ck.rows
    print(json.dumps(out, indent=1))
    return 0 if ck.ok else 1


if __name__ == "__main__": sys.exit(main(sys.argv))
