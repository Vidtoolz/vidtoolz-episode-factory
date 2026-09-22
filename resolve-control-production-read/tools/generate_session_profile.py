#!/usr/bin/env python3
"""Deterministic isolated Resolve session-profile generator (vidtoolz.resolveProductionReadSessionProfile.v1).

Input: an ACCEPTED production-read authority record + its compiled LIVE policy + the exact candidate worker bytes.
Output: a sealed, self-contained Resolve profile directory whose Project Library list contains EXACTLY ONE entry — the authorized
local Disk library — plus a separate manifest binding that directory to the authority, the policy, the worker and the accepted facade.

The generator never reads, opens, mutates or registers a production project, never touches the operator's live Resolve configuration
(the source configuration directory is read-only and is never written to), never starts Resolve, and never grants write authority.
It refuses to fabricate: the authorized Disk root must physically exist and match the device/inode pinned by the accepted authority,
External Scripting must already be Local in the source configuration, and the destination profile directory must be empty or absent.

Governed content (deterministic, separately digested) is what the worker enforces; runtime provenance (absolute profile root, seal
instant, per-file digests) is recorded beside it. Regenerating from the same inputs yields a byte-identical governed block.

Usage:
  generate_session_profile.py --authority AUTH.json --policy POLICY.json --worker WORKER.py \
      --source-config DIR --profile-root DIR --out MANIFEST.json [--resolve-binary PATH] [--script-server-port N]
"""
import datetime, hashlib, json, os, shutil, socket, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compile_production_read_policy as C  # single source of truth for the authority schema

PROFILE_SCHEMA = "vidtoolz.resolveProductionReadSessionProfile.v1"
GENERATOR_VERSION = "1.0.0-isolated-session"
PROFILE_ENV = {"BMD_RESOLVE_CONFIG_DIR": "config", "BMD_RESOLVE_SUPPORT_DIR": "support", "BMD_RESOLVE_LOGS_DIR": "logs", "XDG_CACHE_HOME": "cache"}
SUBDIRS = ("config", "support", "logs", "cache")
REGISTRATION_RELPATH = "config/.dblist"
ACTIVE_RELPATH = "config/.activedb"
# copied verbatim from the operator configuration: settings only. The library list, the active-database pointer and recent-project
# history are NEVER copied — they are the whole reason this profile exists.
COPY_REQUIRED = ("config.dat",)
COPY_OPTIONAL = ("config.user.xml", "config.user.presets.xml", "keyboard.preset.xml", "mediametadata.preset.xml", "primaryhdr.preset.xml", ".version")
NEVER_COPY = (".dblist", ".activedb", ".recentprojects", "UI.preset", ".fsbookmarklist", "usersmartfolder.xml", "usersmartfilter.xml")
SCRIPTING_LOCAL = "System.Scripting.Mode = 1"
DEFAULT_RESOLVE_BINARY = "/opt/resolve/bin/resolve"
DEFAULT_SCRIPT_SERVER_PORT = 1144


class GenerateError(Exception): pass


def req(c, msg):
    if not c: raise GenerateError(msg)


def sha_bytes(b): return hashlib.sha256(b).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def canonical_sha256(o): return sha_bytes(json.dumps(o, sort_keys=True, separators=(",", ":")).encode())


def physical(path):
    try: rp = os.path.realpath(path, strict=True); st = os.stat(rp)
    except (OSError, ValueError) as e: raise GenerateError(f"{path}: does not resolve to an existing path ({type(e).__name__})")
    return rp, st


def load_authority(path, worker_sha256):
    raw = open(path, "rb").read()
    src = json.loads(raw)
    C.validate_schema(src)
    gaps = C.acceptance_gaps(src, worker_sha256)
    req(not gaps, "session profile refused: the authority record is not an accepted human-authorized grant (" + "; ".join(gaps) + ")")
    return raw, src


def check_policy(pol_raw, pol, src, src_sha, worker_sha256):
    req(pol.get("schema") == C.SCHEMA_OUT, "policy: wrong schema")
    req(pol.get("live") is True, "policy: not a LIVE policy")
    req(pol.get("source_record_sha256") == src_sha, "policy: compiled from a different authority record")
    req(pol.get("worker_sha256") == worker_sha256, "policy: pinned to different worker bytes")
    req(pol.get("facade_commit") == C.ACCEPTED_FACADE_COMMIT, "policy: pinned to a different facade")
    req(pol.get("host_id") == src["host_id"] and pol.get("platform") == C.PLATFORM, "policy: host/platform disagree with the authority record")
    req(pol.get("session_profile_type") == C.SESSION_PROFILE_TYPE, "policy: wrong session profile type")
    body = {k: v for k, v in pol.items() if k != "policy_sha256"}
    req(pol.get("policy_sha256") == canonical_sha256(body), "policy: embedded policy_sha256 does not match its own body")
    lib = pol["library"]
    req(all(lib[k] == src["library"][k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")), "policy: library differs from the authority grant")
    req(sorted(pol["projects"]) == sorted(p["project_uuid"] for p in src["projects"]), "policy: projects differ from the authority grant")
    return lib


def prepare_root(root):
    req(os.path.isabs(root), "--profile-root must be absolute")
    if os.path.exists(root):
        req(os.path.isdir(root), "--profile-root exists and is not a directory")
        req(not os.listdir(root), "--profile-root is not empty; refusing to overwrite an existing profile")
    else:
        os.makedirs(root)
    for d in SUBDIRS: os.makedirs(os.path.join(root, d), exist_ok=True)


def copy_settings(source_config, root):
    src_rp, _ = physical(source_config)
    dst_rp = os.path.realpath(root)
    req(os.path.isdir(src_rp), "--source-config is not a directory")
    req(src_rp != dst_rp and not dst_rp.startswith(src_rp + os.sep), "--profile-root must not live inside --source-config")
    copied = []
    for name in COPY_REQUIRED + COPY_OPTIONAL:
        req(name not in NEVER_COPY, f"internal: {name} is on the never-copy list")
        s = os.path.join(src_rp, name)
        if not os.path.isfile(s):
            req(name not in COPY_REQUIRED, f"--source-config: required settings file {name} is missing")
            continue
        shutil.copyfile(s, os.path.join(root, "config", name))
        copied.append(name)
    cfg = open(os.path.join(root, "config", "config.dat"), "rb").read().decode("utf-8", "replace")
    lines = [l.strip() for l in cfg.splitlines()]
    req(SCRIPTING_LOCAL in lines,
        "--source-config: External Scripting is not Local (System.Scripting.Mode = 1); the generator never changes this setting — set it in Resolve first")
    return src_rp, copied


def write_registration(root, lib):
    line = f'{lib["name"]}:{lib["canonical_root"]}::::DISK'
    req("\n" not in line and "\r" not in line, "library registration would span multiple lines")
    with open(os.path.join(root, REGISTRATION_RELPATH), "w", encoding="utf-8") as fh: fh.write(line + "\n")
    with open(os.path.join(root, ACTIVE_RELPATH), "w", encoding="utf-8") as fh: fh.write(f'disk*:{lib["name"]}\n')
    return line


def seal(root):
    files = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if os.path.islink(full) or not os.path.isfile(full): raise GenerateError(f"unexpected non-regular file in profile: {full}")
            files[os.path.relpath(full, root)] = sha_file(full)
    req(files, "sealed profile contains no files")
    return files


def build(args):
    worker_sha = sha_file(args["worker"])
    auth_raw, src = load_authority(args["authority"], worker_sha)
    auth_sha = sha_bytes(auth_raw)
    pol_raw = open(args["policy"], "rb").read()
    pol = json.loads(pol_raw)
    lib = check_policy(pol_raw, pol, src, auth_sha, worker_sha)
    pol_sha = sha_bytes(pol_raw)          # the policy FILE digest: exactly what the worker is pinned to on its command line
    rp, st = physical(lib["canonical_root"])
    req(os.path.isdir(rp), "library.canonical_root is not a directory")
    req(rp == lib["canonical_root"], f"library.canonical_root is not canonical: {lib['canonical_root']} resolves to {rp}")
    req(st.st_dev == lib["physical_dev"] and st.st_ino == lib["physical_ino"],
        f"library.canonical_root physical identity differs from the accepted authority (dev/ino {st.st_dev}/{st.st_ino} vs {lib['physical_dev']}/{lib['physical_ino']})")
    bin_rp, bin_st = physical(args["resolve_binary"])
    out = os.path.abspath(args["out"])
    root = os.path.abspath(args["profile_root"])
    req(not out.startswith(root + os.sep), "--out manifest must live outside --profile-root (it seals that directory)")

    prepare_root(root)
    source_config, copied = copy_settings(args["source_config"], root)
    line = write_registration(root, lib)
    files = seal(root)
    now = int(time.time())
    governed = {
        "session_id": canonical_sha256({"authority": auth_sha, "policy": pol_sha, "worker": worker_sha,
                                        "library": lib, "projects": sorted(pol["projects"]), "profile_type": C.SESSION_PROFILE_TYPE})[:32],
        "profile_type": C.SESSION_PROFILE_TYPE, "host_id": pol["host_id"], "platform": C.PLATFORM,
        "authority_sha256": auth_sha, "policy_sha256": pol_sha, "worker_sha256": worker_sha,
        "facade_commit": C.ACCEPTED_FACADE_COMMIT,
        "library": {k: lib[k] for k in ("kind", "name", "canonical_root", "physical_dev", "physical_ino")},
        "projects": sorted(pol["projects"]), "registration_line": line, "profile_env": dict(PROFILE_ENV),
        "script_server_port": args["script_server_port"],
        "resolve_binary": {"path": args["resolve_binary"], "realpath": bin_rp, "bytes": bin_st.st_size, "sha256": sha_file(bin_rp)},
        "write_authority": "NONE", "persistent_worker_authority": "NONE", "external_scripting": "Local",
        "project_open_law": C.PROJECT_OPEN_LAW,
    }
    provenance = {"profile_root": root, "registration_relpath": REGISTRATION_RELPATH, "active_relpath": ACTIVE_RELPATH,
                  "seal_epoch": now, "sealed_at": datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "generator_version": GENERATOR_VERSION, "generated_on_host": socket.gethostname(),
                  "source_config": source_config, "copied_settings": copied, "files": files}
    manifest = {"schema": PROFILE_SCHEMA, "governed": governed, "governed_sha256": canonical_sha256(governed), "provenance": provenance}
    data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    with open(out, "wb") as fh: fh.write(data)
    return manifest, out, sha_bytes(data)


def launch_recipe(gov, prov):
    env = " ".join(f'{v}="{os.path.join(prov["profile_root"], rel)}"' for v, rel in sorted(gov["profile_env"].items()))
    return [
        "# launch the isolated production-read Resolve session (operator action, on vidnux, under the operator's own account):",
        f'cd /opt/resolve && env {env} DISPLAY="${{DISPLAY:-:1}}" {gov["resolve_binary"]["path"]} &',
        "# the worker refuses any process that predates the seal, is not launched with exactly these variables,",
        "# or does not own the scripting endpoint on port %d." % gov["script_server_port"],
    ]


def main(argv):
    keys = {"--authority": "authority", "--policy": "policy", "--worker": "worker", "--source-config": "source_config",
            "--profile-root": "profile_root", "--out": "out", "--resolve-binary": "resolve_binary", "--script-server-port": "script_server_port"}
    args = {"resolve_binary": DEFAULT_RESOLVE_BINARY, "script_server_port": DEFAULT_SCRIPT_SERVER_PORT}
    i = 1
    while i < len(argv):
        if argv[i] not in keys or i + 1 >= len(argv): print(__doc__); return 2
        args[keys[argv[i]]] = argv[i + 1]; i += 2
    if any(k not in args for k in ("authority", "policy", "worker", "source_config", "profile_root", "out")): print(__doc__); return 2
    try:
        args["script_server_port"] = int(args["script_server_port"])
        manifest, out, file_sha = build(args)
    except (GenerateError, OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({"ok": False, "error": "SESSION_PROFILE_REFUSED", "message": str(e)[:400]})); return 2
    gov, prov = manifest["governed"], manifest["provenance"]
    print(json.dumps({"ok": True, "out": out, "manifest_sha256": file_sha, "governed_sha256": manifest["governed_sha256"],
                      "session_id": gov["session_id"], "profile_root": prov["profile_root"], "seal_epoch": prov["seal_epoch"],
                      "library": gov["library"]["name"], "registrations": 1, "projects": len(gov["projects"]),
                      "files_sealed": len(prov["files"])}, indent=1))
    print("\n".join(launch_recipe(gov, prov)))
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv))
