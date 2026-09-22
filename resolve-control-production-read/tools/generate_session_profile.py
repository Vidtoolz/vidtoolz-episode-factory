#!/usr/bin/env python3
"""Deterministic isolated Resolve session-profile generator (vidtoolz.resolveProductionReadSessionProfile.v1).

Input: an ACCEPTED production-read authority record + its compiled LIVE policy + the exact candidate worker bytes.
Output: a sealed, self-contained Resolve profile directory whose Project Library list contains EXACTLY ONE entry — the authorized
local Disk library — plus a separate manifest that binds that directory, its EXACT tree, its physical identity and the pinned Resolve
executable to the authority, the policy, the worker and the accepted facade.

The generator never reads, opens, mutates or registers a production project, never writes to the operator's live Resolve configuration,
never starts Resolve, and never grants write authority. It refuses to fabricate: the profile root must be an ABSOLUTE, NON-SYMLINKED
path (a symlinked root would let a manifest hide physically inside the profile), the authorized Disk root must physically exist and
match the device/inode pinned by the accepted authority, External Scripting must already be Local in the source configuration, and the
destination profile directory must be empty or absent.

The seal describes the profile EXACTLY: every governed file with its digest, every governed directory, the one file Resolve may
legitimately rewrite (`config/.activedb`, constrained to still name only the authorized library) and a bounded allowlist of runtime
paths Resolve creates for itself. Anything else appearing under the root after sealing refuses the next operation.

Usage:
  generate_session_profile.py --authority AUTH.json --policy POLICY.json --worker WORKER.py \
      --source-config DIR --profile-root ABS_DIR --out MANIFEST.json --evidence-mask ABS_DIR [--evidence-mask ABS_DIR ...] \
      [--resolve-binary PATH] [--script-server-port N]

The sealed executable is the FROZEN ROOT-OWNED capsule runtime binary; every --evidence-mask path is a worker-evidence directory the
capsule init must hide from Resolve's own mount namespace.
"""
import datetime, hashlib, json, os, shutil, socket, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "capsule"))
import compile_production_read_policy as C  # single source of truth for the authority schema
import vrc_capsule_confine as confine_mod   # the seccomp filter the capsule init will install on the Resolve child

PROFILE_SCHEMA = "vidtoolz.resolveProductionReadSessionProfile.v1"
GENERATOR_VERSION = "3.0.0-dedicated-capsule"
PROFILE_ENV = {"BMD_RESOLVE_CONFIG_DIR": "config", "BMD_RESOLVE_SUPPORT_DIR": "support", "BMD_RESOLVE_LOGS_DIR": "logs", "XDG_CACHE_HOME": "cache"}
SUBDIRS = ("config", "support", "logs", "cache")
REGISTRATION_RELPATH = "config/.dblist"
ACTIVE_RELPATH = "config/.activedb"
CONSTRAINED = (ACTIVE_RELPATH,)            # sealed, but Resolve may rewrite it; content stays bound to the one authorized library
# Only the settings file that carries External Scripting is copied. Everything else the operator has is deliberately left behind, and
# everything Resolve creates for itself at runtime is confined to this bounded allowlist. Nothing here is ever authority-bearing.
COPY_REQUIRED = ("config.dat",)
NEVER_COPY = (".dblist", ".activedb", ".recentprojects", "UI.preset", ".fsbookmarklist", "usersmartfolder.xml", "usersmartfilter.xml")
VOLATILE_PATTERNS = (
    "logs/**", "cache/**", "support/**",
    "config/.recentprojects", "config/.audiobusingmode", "config/.config.data", "config/.version", "config/.update/**",
    "config/UI.preset", "config/log-conf.xml", "config/OFXPluginCacheV2.xml", "config/*.preset.xml", "config/Fairlight/**",
    "config/config.dat.bak", "config/config-fairlight.dat", "config/config.user.xml", "config/config.user.presets.xml",
    "config/usersmartfolder.xml", "config/usersmartfilter.xml", "config/.fsbookmarklist", "config/user.data.xml",
)
SCRIPTING_LOCAL = "System.Scripting.Mode = 1"
# The executable is the FROZEN ROOT-OWNED capsule runtime, never the operator's own installation: /opt/resolve is writable by the
# operator, so a session launched from it could be changed between the seal and the launch.
DEFAULT_RESOLVE_BINARY = C.HOST_PRIMITIVE["runtime_root"] + "/bin/resolve"
DEFAULT_SCRIPT_SERVER_PORT = 1144
GENERATOR_VERSION_CAPSULE = "3.0.0-dedicated-capsule"


class GenerateError(Exception): pass


def req(c, msg):
    if not c: raise GenerateError(msg)


def sha_bytes(b): return hashlib.sha256(b).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""): h.update(chunk)
    return h.hexdigest()


def canonical_sha256(o): return sha_bytes(json.dumps(o, sort_keys=True, separators=(",", ":")).encode())


def boot_time():
    for line in open("/proc/stat"):
        if line.startswith("btime"): return int(line.split()[1])
    raise GenerateError("/proc/stat carries no btime; the seal instant cannot be anchored to this boot")


def physical(path):
    try: rp = os.path.realpath(path, strict=True); st = os.stat(rp)
    except (OSError, ValueError) as e: raise GenerateError(f"{path}: does not resolve to an existing path ({type(e).__name__})")
    return rp, st


def load_authority(path, worker_sha256, boundary=None):
    raw = open(path, "rb").read()
    src = json.loads(raw)
    C.validate_schema(src, boundary)
    gaps = C.acceptance_gaps(src, worker_sha256)
    req(not gaps, "session profile refused: the authority record is not an accepted human-authorized grant (" + "; ".join(gaps) + ")")
    return raw, src


def check_policy(pol_raw, pol, src, src_sha, worker_sha256, boundary=None):
    boundary = boundary or C.HOST_PRIMITIVE
    req(pol.get("schema") == C.SCHEMA_OUT, "policy: wrong schema")
    req(pol.get("live") is True, "policy: not a LIVE policy")
    req(pol.get("source_record_sha256") == src_sha, "policy: compiled from a different authority record")
    req(pol.get("worker_sha256") == worker_sha256, "policy: pinned to different worker bytes")
    req(pol.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, "policy: pinned to a different facade")
    req(pol.get("host_id") == src["host_id"] and pol.get("platform") == C.PLATFORM, "policy: host/platform disagree with the authority record")
    req(pol.get("session_profile_type") == C.SESSION_PROFILE_TYPE, "policy: wrong session profile type")
    req(pol.get("execution_environment") == src["execution_environment"] and pol["execution_environment"] in C.EXECUTION_ENVIRONMENTS,
        "policy: execution environment disagrees with the authority record")
    req(pol.get("host_primitive") == src["host_primitive"] == boundary, "policy: host primitive is not the approved dedicated-capsule boundary")
    req(pol.get("caller_identity") == src["caller_identity"], "policy: caller identity differs from the authority grant")
    req(sorted(pol.get("control_operations") or []) == sorted(C.CONTROL_OPS), "policy: control operations are not exactly the governed stop")
    body = {k: v for k, v in pol.items() if k != "policy_sha256"}
    req(pol.get("policy_sha256") == canonical_sha256(body), "policy: embedded policy_sha256 does not match its own body")
    lib = pol["library"]
    req(all(lib[k] == src["library"][k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")), "policy: library differs from the authority grant")
    req(sorted(pol["projects"]) == sorted(p["project_uuid"] for p in src["projects"]), "policy: projects differ from the authority grant")
    return lib


def prepare_root(root):
    """The profile root must be an ABSOLUTE path that is already its own realpath. A relative root is refused outright (never silently
    made absolute) and a symlinked root is refused, because a link lets a file be lexically 'outside' the root while physically inside."""
    req(os.path.isabs(root), "--profile-root must be an absolute path")
    req(root == os.path.normpath(root) and not root.endswith("/"), "--profile-root must be a normalised path without a trailing separator")
    parent = os.path.dirname(root)
    req(os.path.isdir(parent), f"--profile-root parent directory does not exist: {parent}")
    req(os.path.realpath(parent) == parent, "--profile-root has a symlinked parent directory; give a fully canonical path")
    if os.path.exists(root):
        req(not os.path.islink(root), "--profile-root is a symlink; give the real directory")
        req(os.path.isdir(root), "--profile-root exists and is not a directory")
        req(not os.listdir(root), "--profile-root is not empty; refusing to overwrite an existing profile")
    else:
        os.makedirs(root)
    req(os.path.realpath(root) == root, "--profile-root is not canonical (symlinked path component)")
    for d in SUBDIRS: os.makedirs(os.path.join(root, d), exist_ok=True)
    st = os.stat(root)
    return {"realpath": root, "dev": st.st_dev, "ino": st.st_ino}


def copy_settings(source_config, root):
    src_rp, _ = physical(source_config)
    dst_rp = os.path.realpath(root)
    req(os.path.isdir(src_rp), "--source-config is not a directory")
    req(src_rp != dst_rp and not dst_rp.startswith(src_rp + os.sep), "--profile-root must not live inside --source-config")
    copied = []
    for name in COPY_REQUIRED:
        req(name not in NEVER_COPY, f"internal: {name} is on the never-copy list")
        s = os.path.join(src_rp, name)
        req(os.path.isfile(s), f"--source-config: required settings file {name} is missing")
        shutil.copyfile(s, os.path.join(root, "config", name))
        copied.append(name)
    cfg = open(os.path.join(root, "config", "config.dat"), "rb").read().decode("utf-8", "replace")
    req(SCRIPTING_LOCAL in [l.strip() for l in cfg.splitlines()],
        "--source-config: External Scripting is not Local (System.Scripting.Mode = 1); the generator never changes this setting — set it in Resolve first")
    return src_rp, copied


def write_registration(root, lib):
    line = f'{lib["name"]}:{lib["canonical_root"]}::::DISK'
    req("\n" not in line and "\r" not in line, "library registration would span multiple lines")
    with open(os.path.join(root, REGISTRATION_RELPATH), "w", encoding="utf-8") as fh: fh.write(line + "\n")
    with open(os.path.join(root, ACTIVE_RELPATH), "w", encoding="utf-8") as fh: fh.write(f'disk*:{lib["name"]}\n')
    return line


def seal(root):
    """The EXACT tree: every regular file with its digest and every directory. No symlinks, no special files."""
    files, dirs = {}, []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in sorted(dirnames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full): raise GenerateError(f"symlinked directory in profile: {full}")
            dirs.append(os.path.relpath(full, root))
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full) or not os.path.isfile(full): raise GenerateError(f"unexpected non-regular file in profile: {full}")
            files[os.path.relpath(full, root)] = {"sha256": sha_file(full)}
    req(files, "sealed profile contains no files")
    return files, sorted(dirs)


def build(args):
    worker_sha = sha_file(args["worker"])
    boundary = json.load(open(args["host_boundary"])) if args.get("host_boundary") else None
    auth_raw, src = load_authority(args["authority"], worker_sha, boundary)
    auth_sha = sha_bytes(auth_raw)
    pol_raw = open(args["policy"], "rb").read()
    pol = json.loads(pol_raw)
    lib = check_policy(pol_raw, pol, src, auth_sha, worker_sha, boundary)
    pol_sha = sha_bytes(pol_raw)          # the policy FILE digest: exactly what the worker is pinned to on its command line
    rp, st = physical(lib["canonical_root"])
    req(os.path.isdir(rp), "library.canonical_root is not a directory")
    req(rp == lib["canonical_root"], f"library.canonical_root is not canonical: {lib['canonical_root']} resolves to {rp}")
    req(st.st_dev == lib["physical_dev"] and st.st_ino == lib["physical_ino"],
        f"library.canonical_root physical identity differs from the accepted authority (dev/ino {st.st_dev}/{st.st_ino} vs {lib['physical_dev']}/{lib['physical_ino']})")
    hp = pol["host_primitive"]
    bin_rp, bin_st = physical(args["resolve_binary"])
    req(bin_rp == args["resolve_binary"], f"--resolve-binary is not a canonical path: it resolves to {bin_rp}")
    req(bin_rp == os.path.join(hp["runtime_root"], "bin", "resolve"),
        f"--resolve-binary must be the frozen capsule runtime binary {os.path.join(hp['runtime_root'], 'bin', 'resolve')}; the operator's own installation is never sealed into a production session")
    bin_sha = sha_file(bin_rp)
    req(bin_sha == hp["resolve_binary_sha256"], "--resolve-binary does not match the approved capsule runtime digest")
    mask = args["evidence_mask"]
    req(mask, "--evidence-mask is required: name every worker-evidence path that must be masked out of Resolve's mount namespace")
    for m in mask:
        req(os.path.isabs(m) and m == os.path.normpath(m) and not m.endswith("/") and m != "/", f"--evidence-mask {m!r}: absolute normalised path required")
        req(not (lib["canonical_root"] == m or lib["canonical_root"].startswith(m.rstrip("/") + "/")), f"--evidence-mask {m!r} would also hide the authorized library")
        req(not (hp["runtime_root"] == m or hp["runtime_root"].startswith(m.rstrip("/") + "/")), f"--evidence-mask {m!r} would also hide the frozen capsule runtime")
    req(len(set(mask)) == len(mask), "--evidence-mask contains duplicates")
    root = args["profile_root"]
    for m in mask:
        req(not (root == m or root.startswith(m.rstrip("/") + "/")), f"--evidence-mask {m!r} would also hide the sealed profile Resolve must read")
    req(os.path.isabs(args["out"]), "--out must be an absolute path")
    identity = prepare_root(root)
    out_parent = os.path.realpath(os.path.dirname(args["out"]))
    req(out_parent != root and not out_parent.startswith(root + os.sep),
        "--out manifest must live physically outside --profile-root (it seals that directory)")

    source_config, copied = copy_settings(args["source_config"], root)
    line = write_registration(root, lib)
    tree, dirs = seal(root)
    now = int(time.time()); uptime = float(open("/proc/uptime").read().split()[0]); boot = boot_time()
    governed = {
        "session_id": canonical_sha256({"authority": auth_sha, "policy": pol_sha, "worker": worker_sha,
                                        "library": lib, "projects": sorted(pol["projects"]), "profile_type": C.SESSION_PROFILE_TYPE,
                                        "execution_environment": pol["execution_environment"], "host_primitive": hp,
                                        "caller_identity": pol["caller_identity"], "evidence_mask": sorted(mask)})[:32],
        "profile_type": C.SESSION_PROFILE_TYPE, "host_id": pol["host_id"], "platform": C.PLATFORM,
        "authority_sha256": auth_sha, "policy_sha256": pol_sha, "worker_sha256": worker_sha,
        "facade_commit": C.ACCEPTED_FACADE_COMMIT,
        "execution_environment": pol["execution_environment"], "host_primitive": dict(hp),
        "caller_identity": dict(pol["caller_identity"]), "evidence_mask": sorted(mask),
        "confinement": {"seccomp_filter_sha256": sha_bytes(confine_mod.seccomp_program()[0]),
                        "seccomp_instructions": confine_mod.seccomp_program()[1], "seccomp_filters": 1,
                        "no_new_privs": 1, "capability_sets_empty": True,
                        "denied_syscalls": sorted(confine_mod.DENY), "clone_namespace_flags_denied": confine_mod.NS_FLAGS},
        "library": {k: lib[k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")},
        "projects": sorted(pol["projects"]), "registration_line": line, "profile_env": dict(PROFILE_ENV),
        "script_server_port": args["script_server_port"],
        "resolve_binary": {"path": args["resolve_binary"], "realpath": bin_rp, "bytes": bin_st.st_size, "sha256": bin_sha},
        "tree": tree, "dirs": dirs, "volatile_patterns": list(VOLATILE_PATTERNS), "constrained": list(CONSTRAINED),
        "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local",
        "project_open_law": C.PROJECT_OPEN_LAW,
    }
    provenance = {"profile_root": root, "profile_root_dev": identity["dev"], "profile_root_ino": identity["ino"],
                  "registration_relpath": REGISTRATION_RELPATH, "active_relpath": ACTIVE_RELPATH,
                  "seal_epoch": now, "seal_uptime": uptime, "seal_boot_time": boot, "sealed_at": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "generator_version": GENERATOR_VERSION, "generated_on_host": socket.gethostname(),
                  "source_config": source_config, "copied_settings": copied}
    manifest = {"schema": PROFILE_SCHEMA, "governed": governed, "governed_sha256": canonical_sha256(governed), "provenance": provenance}
    data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    with open(args["out"], "wb") as fh: fh.write(data)
    return manifest, args["out"], sha_bytes(data)


def next_steps(gov, prov, out, out_sha):
    return [
        "# next: create the isolated session with the launcher (it generates a fresh session nonce and writes the runtime attestation):",
        f'tools/launch_isolated_session.py --session "{out}" --session-sha256 {out_sha} \\',
        '    --authority AUTHORITY.json --policy policy.json --worker worker/resolve_worker.py --out RUNTIME-ATTESTATION.json',
        "# the worker then needs BOTH digests: --production-session-sha256 and --production-runtime-attestation-sha256.",
        "# Resolve is single-instance on Linux: quit the normal Resolve session first.",
    ]


def main(argv):
    keys = {"--authority": "authority", "--policy": "policy", "--worker": "worker", "--source-config": "source_config",
            "--profile-root": "profile_root", "--out": "out", "--resolve-binary": "resolve_binary", "--script-server-port": "script_server_port",
            "--host-boundary": "host_boundary"}
    args = {"resolve_binary": DEFAULT_RESOLVE_BINARY, "script_server_port": DEFAULT_SCRIPT_SERVER_PORT, "evidence_mask": []}
    i = 1
    while i < len(argv):
        if argv[i] == "--evidence-mask" and i + 1 < len(argv): args["evidence_mask"].append(argv[i + 1]); i += 2; continue
        if argv[i] not in keys or i + 1 >= len(argv): print(__doc__); return 2
        args[keys[argv[i]]] = argv[i + 1]; i += 2
    if any(k not in args for k in ("authority", "policy", "worker", "source_config", "profile_root", "out")): print(__doc__); return 2
    try:
        args["script_server_port"] = int(args["script_server_port"])
        manifest, out, file_sha = build(args)
    except (GenerateError, C.PolicyError, OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({"ok": False, "error": "SESSION_PROFILE_REFUSED", "message": str(e)[:400]})); return 2
    gov, prov = manifest["governed"], manifest["provenance"]
    print(json.dumps({"ok": True, "out": out, "manifest_sha256": file_sha, "governed_sha256": manifest["governed_sha256"],
                      "session_id": gov["session_id"], "profile_root": prov["profile_root"], "seal_epoch": prov["seal_epoch"],
                      "library": gov["library"]["name"], "registrations": 1, "projects": len(gov["projects"]),
                      "sealed_files": len(gov["tree"]), "sealed_dirs": len(gov["dirs"]),
                      "volatile_patterns": len(gov["volatile_patterns"]), "execution_environment": gov["execution_environment"],
                      "capsule_uid": gov["host_primitive"]["capsule_uid"], "evidence_mask": gov["evidence_mask"],
                      "resolve_binary": gov["resolve_binary"]["realpath"]}, indent=1))
    print("\n".join(next_steps(gov, prov, out, file_sha)))
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv))
