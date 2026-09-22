#!/usr/bin/env python3
"""Ephemeral operator launcher for an isolated production-read Resolve session
(writes vidtoolz.resolveProductionReadRuntimeAttestation.v1).

This is the only thing that may create a session the worker will read. It is run by the operator, in the foreground, once per session;
it is NOT a service, it is NOT persistent, and it holds no authority of its own.

  1. re-verifies the accepted authority, the LIVE policy, the sealed profile manifest, the profile's EXACT tree and the profile root's
     physical identity, and the pinned Resolve executable by realpath, size and sha256;
  2. generates a FRESH, unpredictable session nonce — necessarily after the seal, so no pre-existing process can carry it;
  3. launches Resolve with an EXPLICIT environment: exactly one occurrence of each isolated-profile variable plus the nonce, built as a
     dict so duplicate keys are impossible;
  4. starts it CONFINED: in its own mount namespace with every sealed worker-evidence path covered by an empty read-only tmpfs, with
     an empty capability bounding set, `no_new_privs`, and a seccomp filter that refuses the mount and namespace family, `ptrace` and
     cross-process memory access — so the Resolve side of the capsule cannot reach the worker's journal, key or evidence spool, and
     cannot undo the mask either;
  5. waits for exactly one Resolve process that carries that nonce and owns the scripting endpoint;
  6. writes a runtime attestation recording the process it created — pid, start ticks, boot time, executable digest, profile identity,
     the capsule's namespaces, the child's confinement facts, and the sha256 of the nonce (never the nonce itself) — OUTSIDE the
     profile root, and prints its digest.

It runs INSIDE the approved dedicated capsule, as the capsule account, and refuses to run anywhere else.

The worker is then started with `--production-runtime-attestation` + `--production-runtime-attestation-sha256` and re-verifies this
record, and the live process against it, at every operation. Quitting Resolve invalidates the session permanently.

Usage:
  launch_isolated_session.py --authority A.json --policy P.json --worker W.py --session S.json --session-sha256 SHA --out ATT.json
                             [--display :1] [--timeout 180] [--cwd /opt/resolve]
"""
import hashlib, json, os, secrets, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(os.path.dirname(HERE), "worker"))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "capsule"))
import compile_production_read_policy as C
import resolve_worker as rw
import vrc_capsule_confine as confine_mod

ATTESTATION_SCHEMA = rw.ATTESTATION_SCHEMA
LAUNCHER_VERSION = "2.0.0-dedicated-capsule"
PASSTHROUGH = ("HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY")


class LaunchError(Exception): pass


def req(c, msg):
    if not c: raise LaunchError(msg)


def sha_bytes(b): return hashlib.sha256(b).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""): h.update(chunk)
    return h.hexdigest()


def canonical_sha256(o): return sha_bytes(json.dumps(o, sort_keys=True, separators=(",", ":")).encode())


def seccomp_filter_sha256():
    return sha_bytes(confine_mod.seccomp_program()[0])


def verify_chain(args, probe=None):
    """Exactly the worker's own chain, re-run before anything is launched: a session is never created for an unaccepted grant."""
    boundary = json.load(open(args["host_boundary"])) if args.get("host_boundary") else None
    worker_sha = sha_file(args["worker"])
    auth_raw = open(args["authority"], "rb").read(); auth_sha = sha_bytes(auth_raw)
    src = json.loads(auth_raw); C.validate_schema(src, boundary)
    gaps = C.acceptance_gaps(src, worker_sha)
    req(not gaps, "launch refused: the authority record is not an accepted human-authorized grant (" + "; ".join(gaps) + ")")
    pol_raw = open(args["policy"], "rb").read(); pol_sha = sha_bytes(pol_raw); pol = json.loads(pol_raw)
    req(pol.get("schema") == C.SCHEMA_OUT and pol.get("live") is True, "launch refused: policy is not a LIVE production-read policy")
    req(pol.get("source_record_sha256") == auth_sha, "launch refused: policy was compiled from a different authority record")
    req(pol.get("worker_sha256") == worker_sha, "launch refused: policy is pinned to different worker bytes")
    try:
        _, gov, prov = rw.load_session_profile(args["session"], args["session_sha256"], pol, pol_sha, auth_sha, worker_sha, pol["host_id"], boundary)
        rw.verify_profile_root(prov)
        rw.verify_profile_tree(prov, gov)
    except rw.OpError as e:
        raise LaunchError(f"launch refused: {(e.detail or {}).get('reason')} — {e.message}")
    try: rw.verify_host_primitive(gov["host_primitive"], probe or rw.SystemProbe())
    except rw.OpError as e:
        raise LaunchError(f"launch refused: {(e.detail or {}).get('reason')} — {e.message}")
    req(gov["confinement"]["seccomp_filter_sha256"] == seccomp_filter_sha256(),
        "launch refused: the sealed profile pins a different seccomp filter than this launcher builds")
    return gov, prov, pol, pol_sha, auth_sha, worker_sha


def build_env(gov, prov, nonce, display, base=None):
    """An EXPLICIT environment: a dict cannot carry duplicate keys, so the process the worker attests is unambiguous by construction."""
    base = os.environ if base is None else base
    env = {k: base[k] for k in PASSTHROUGH if k in base}
    env["DISPLAY"] = display or base.get("DISPLAY", ":0")
    for var, rel in sorted(gov["profile_env"].items()):
        env[var] = os.path.join(prov["profile_root"], rel) if rel else prov["profile_root"]
    env[rw.NONCE_ENV_KEY] = nonce
    return env


def find_session(probe, gov, prov, nonce, deadline, poll=1.0):
    """Wait for exactly one Resolve process that carries this nonce exactly once and owns the scripting endpoint."""
    binary = gov["resolve_binary"]["realpath"]; last = "no Resolve process appeared"
    while time.time() < deadline:
        pids = [p for p in probe.pids() if probe.exe(p) == binary]
        if len(pids) == 1:
            pid = pids[0]
            entries = probe.environ_entries(pid) or []
            hits = [v for k, v in entries if k == rw.NONCE_ENV_KEY]
            if len(hits) == 1 and hits[0] == nonce:
                inodes = probe.listen_inodes(gov["script_server_port"])
                if inodes: return pid
                last = "the launched Resolve has not opened its scripting endpoint yet"
            else: last = f"the running Resolve does not carry exactly this session nonce ({len(hits)} occurrences)"
        elif len(pids) > 1: raise LaunchError("more than one Resolve process is running; quit them all and relaunch")
        time.sleep(poll)
    raise LaunchError("timed out waiting for the isolated Resolve session: " + last)


def default_spawn(binary, env, cwd, confinement):
    """The child confines ITSELF between fork and exec: the mask, the empty bounding set and the seccomp filter are all installed in
    the child, so the launcher's own namespace, capabilities and evidence access are untouched."""
    return subprocess.Popen([binary], env=env, cwd=cwd, start_new_session=True,
                            preexec_fn=lambda: confine_mod.confine(confinement["evidence_mask"]),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def capsule_facts(probe, gov, pid, self_pid=None):
    """What the kernel says about the child the launcher just created. The launcher records these; the worker re-derives them itself at
    every operation and compares — the attestation is a witness statement, never the evidence."""
    self_pid = self_pid or os.getpid()
    ns = {k: probe.ns(self_pid, k) for k in ("user", "pid", "net", "mnt")}
    req(all(ns.values()), "the capsule namespaces of this launcher are unreadable")
    rns = probe.ns(pid, "mnt")
    req(rns, "the launched Resolve's mount namespace is unreadable")
    req(rns != ns["mnt"], "the launched Resolve shares this namespace's mounts; the evidence mask did not take effect")
    for k in ("user", "pid", "net"):
        req(probe.ns(pid, k) == ns[k], f"the launched Resolve is not inside this capsule's {k} namespace")
    st = probe.status_fields(pid)
    req(st, "the launched Resolve's status is unreadable")
    req(st.get("NoNewPrivs") == 1, "the launched Resolve can still gain privileges")
    req(st.get("Seccomp") == confine_mod.SECCOMP_MODE_FILTER, "the launched Resolve is not under a seccomp filter")
    for cap in ("CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb"):
        req(not st.get(cap), f"the launched Resolve still holds capabilities ({cap}={st.get(cap)})")
    mounts = probe.mountinfo(pid)
    req(mounts is not None, "the launched Resolve's mount table is unreadable")
    for masked in gov["evidence_mask"]:
        m = rw._mount_for(masked, mounts)
        req(m and m["mount_point"] == masked and m["fstype"] == "tmpfs" and "ro" in m["options"].split(","),
            f"worker evidence path {masked} is not masked read-only in the launched Resolve's namespace")
    return {"capsule_uid": probe.uid(), "user_ns": ns["user"], "pid_ns": ns["pid"], "net_ns": ns["net"],
            "worker_mnt_ns": ns["mnt"], "resolve_mnt_ns": rns, "resolve_no_new_privs": st["NoNewPrivs"],
            "resolve_seccomp": st["Seccomp"], "resolve_seccomp_filters": st.get("Seccomp_filters"),
            "seccomp_filter_sha256": seccomp_filter_sha256(), "evidence_mask": sorted(gov["evidence_mask"])}


def launch(args, spawn=default_spawn, probe=None, nonce=None):
    probe = probe or rw.SystemProbe()
    gov, prov, pol, pol_sha, auth_sha, worker_sha = verify_chain(args, probe)
    req(probe.uid() == gov["host_primitive"]["capsule_uid"],
        f"launch refused: this launcher runs INSIDE the dedicated capsule as uid {gov['host_primitive']['capsule_uid']}, not as uid {probe.uid()}")
    out = os.path.abspath(args["out"])
    req(not out.startswith(os.path.realpath(prov["profile_root"]) + os.sep), "--out must live outside the profile root")
    running = [p for p in probe.pids() if probe.exe(p) == gov["resolve_binary"]["realpath"]]
    req(not running, f"Resolve is already running (pid {running[0] if running else ''}); an isolated production-read session must be the only Resolve instance — quit it first")
    try: rw.verify_executable(probe, gov)
    except rw.OpError as e: raise LaunchError(f"launch refused: {(e.detail or {}).get('reason')} — {e.message}")
    nonce = nonce or secrets.token_hex(32)
    env = build_env(gov, prov, nonce, args.get("display"))
    proc = spawn(gov["resolve_binary"]["realpath"], env, args.get("cwd") or os.path.dirname(os.path.dirname(gov["resolve_binary"]["realpath"])),
                 {"evidence_mask": list(gov["evidence_mask"]), "confinement": dict(gov["confinement"])})
    pid = find_session(probe, gov, prov, nonce, time.time() + float(args.get("timeout") or 180), float(args.get("poll") or 1.0))
    ticks, boot = probe.start_ticks(pid), probe.boot_time()
    req(ticks is not None, "the launched Resolve process start time could not be read")
    body = {
        "schema": ATTESTATION_SCHEMA, "launcher_version": LAUNCHER_VERSION,
        "session_id": gov["session_id"], "profile_sha256": args["session_sha256"], "policy_sha256": pol_sha,
        "authority_sha256": auth_sha, "worker_sha256": worker_sha, "facade_commit": C.ACCEPTED_FACADE_COMMIT,
        "profile_root": prov["profile_root"], "profile_root_dev": prov["profile_root_dev"], "profile_root_ino": prov["profile_root_ino"],
        "script_server_port": gov["script_server_port"],
        "nonce_sha256": sha_bytes(nonce.encode()),          # the nonce itself never leaves the process environment
        "executable": {"realpath": gov["resolve_binary"]["realpath"], "sha256": gov["resolve_binary"]["sha256"], "bytes": gov["resolve_binary"]["bytes"]},
        "launcher_pid": os.getpid(), "spawn_pid": getattr(proc, "pid", 0), "resolve_pid": pid,
        "resolve_start_ticks": ticks, "boot_time": boot, "clock_ticks_per_second": os.sysconf("SC_CLK_TCK"),
        "created_epoch": int(time.time()), "profile_seal_epoch": prov["seal_epoch"],
        "execution_environment": gov["execution_environment"], "host_primitive": dict(gov["host_primitive"]),
        **capsule_facts(probe, gov, pid),
    }
    body["attestation_sha256"] = canonical_sha256(body)
    data = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    with open(out, "wb") as fh: fh.write(data)
    try:                                                     # the record must describe a session that passes the worker's own gate
        rw.attest_isolated_session(probe, gov, prov, body)
    except rw.OpError as e:
        raise LaunchError(f"the launched session does not satisfy attestation: {(e.detail or {}).get('reason')} — {e.message}")
    return body, out, sha_bytes(data)


def main(argv):
    keys = {"--authority": "authority", "--policy": "policy", "--worker": "worker", "--session": "session",
            "--session-sha256": "session_sha256", "--out": "out", "--display": "display", "--timeout": "timeout", "--cwd": "cwd",
            "--host-boundary": "host_boundary"}
    args = {}; i = 1
    while i < len(argv):
        if argv[i] not in keys or i + 1 >= len(argv): print(__doc__); return 2
        args[keys[argv[i]]] = argv[i + 1]; i += 2
    if any(k not in args for k in ("authority", "policy", "worker", "session", "session_sha256", "out")): print(__doc__); return 2
    try: body, out, file_sha = launch(args)
    except (LaunchError, OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({"ok": False, "error": "SESSION_LAUNCH_REFUSED", "message": str(e)[:400]})); return 2
    print(json.dumps({"ok": True, "out": out, "attestation_sha256": file_sha, "session_id": body["session_id"],
                      "resolve_pid": body["resolve_pid"], "nonce_id": body["nonce_sha256"][:16],
                      "script_server_port": body["script_server_port"], "execution_environment": body["execution_environment"],
                      "capsule_uid": body["capsule_uid"], "resolve_mnt_ns": body["resolve_mnt_ns"],
                      "resolve_seccomp": body["resolve_seccomp"], "evidence_masked": body["evidence_mask"]}, indent=1))
    print(f'# start the worker with: --production-runtime-attestation "{out}" --production-runtime-attestation-sha256 {file_sha}')
    print("# quitting Resolve ends the session permanently: a new seal + launch is required.")
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv))
