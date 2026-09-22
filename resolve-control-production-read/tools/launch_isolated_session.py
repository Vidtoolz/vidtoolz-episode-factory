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
  4. waits for exactly one Resolve process that carries that nonce and owns the scripting endpoint;
  5. writes a runtime attestation recording the process it created — pid, start ticks, boot time, executable digest, profile identity,
     and the sha256 of the nonce (never the nonce itself) — OUTSIDE the profile root, and prints its digest.

The worker is then started with `--production-runtime-attestation` + `--production-runtime-attestation-sha256` and re-verifies this
record, and the live process against it, at every operation. Quitting Resolve invalidates the session permanently.

Usage:
  launch_isolated_session.py --authority A.json --policy P.json --worker W.py --session S.json --session-sha256 SHA --out ATT.json
                             [--display :1] [--timeout 180] [--cwd /opt/resolve]
"""
import hashlib, json, os, secrets, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(os.path.dirname(HERE), "worker"))
import compile_production_read_policy as C
import resolve_worker as rw

ATTESTATION_SCHEMA = rw.ATTESTATION_SCHEMA
LAUNCHER_VERSION = "1.0.0-attested-session"
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


def verify_chain(args):
    """Exactly the worker's own chain, re-run before anything is launched: a session is never created for an unaccepted grant."""
    worker_sha = sha_file(args["worker"])
    auth_raw = open(args["authority"], "rb").read(); auth_sha = sha_bytes(auth_raw)
    src = json.loads(auth_raw); C.validate_schema(src)
    gaps = C.acceptance_gaps(src, worker_sha)
    req(not gaps, "launch refused: the authority record is not an accepted human-authorized grant (" + "; ".join(gaps) + ")")
    pol_raw = open(args["policy"], "rb").read(); pol_sha = sha_bytes(pol_raw); pol = json.loads(pol_raw)
    req(pol.get("schema") == C.SCHEMA_OUT and pol.get("live") is True, "launch refused: policy is not a LIVE production-read policy")
    req(pol.get("source_record_sha256") == auth_sha, "launch refused: policy was compiled from a different authority record")
    req(pol.get("worker_sha256") == worker_sha, "launch refused: policy is pinned to different worker bytes")
    try:
        _, gov, prov = rw.load_session_profile(args["session"], args["session_sha256"], pol, pol_sha, auth_sha, worker_sha, pol["host_id"])
        rw.verify_profile_root(prov)
        rw.verify_profile_tree(prov, gov)
    except rw.OpError as e:
        raise LaunchError(f"launch refused: {(e.detail or {}).get('reason')} — {e.message}")
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


def default_spawn(binary, env, cwd):
    return subprocess.Popen([binary], env=env, cwd=cwd, start_new_session=True,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def launch(args, spawn=default_spawn, probe=None, nonce=None):
    probe = probe or rw.SystemProbe()
    gov, prov, pol, pol_sha, auth_sha, worker_sha = verify_chain(args)
    out = os.path.abspath(args["out"])
    req(not out.startswith(os.path.realpath(prov["profile_root"]) + os.sep), "--out must live outside the profile root")
    running = [p for p in probe.pids() if probe.exe(p) == gov["resolve_binary"]["realpath"]]
    req(not running, f"Resolve is already running (pid {running[0] if running else ''}); an isolated production-read session must be the only Resolve instance — quit it first")
    try: rw.verify_executable(probe, gov)
    except rw.OpError as e: raise LaunchError(f"launch refused: {(e.detail or {}).get('reason')} — {e.message}")
    nonce = nonce or secrets.token_hex(32)
    env = build_env(gov, prov, nonce, args.get("display"))
    proc = spawn(gov["resolve_binary"]["realpath"], env, args.get("cwd") or os.path.dirname(os.path.dirname(gov["resolve_binary"]["realpath"])))
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
            "--session-sha256": "session_sha256", "--out": "out", "--display": "display", "--timeout": "timeout", "--cwd": "cwd"}
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
                      "script_server_port": body["script_server_port"]}, indent=1))
    print(f'# start the worker with: --production-runtime-attestation "{out}" --production-runtime-attestation-sha256 {file_sha}')
    print("# quitting Resolve ends the session permanently: a new seal + launch is required.")
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv))
