#!/usr/bin/env python3
"""Capsule init: pid 1 of the approved dedicated capsule's own pid namespace.

NOT DEPLOYED. This is the application-side half of the approved host boundary: the root-owned broker
(/usr/local/libexec/vrc-capsule-launch) drops to the capsule account and starts the capsule; this file is what runs inside it. No host
change is required to install it beyond the deployment step itself, and it grants nothing: it holds no capability the capsule account
does not already have, opens no socket, and reads no production library.

What it does, in order:

  1. proves it really is pid 1 of a capsule pid namespace, running as the capsule account;
  2. creates the confined Resolve session by calling the launcher — Resolve lands in its own mount namespace, evidence masked,
     capabilities empty, under the seccomp filter;
  3. starts the worker as a sibling, in the capsule's own mount namespace, where the journal and the shared key are still reachable;
  4. reaps whatever dies. When the WORKER exits — because the operator issued the governed stop, because the session was refused, or
     because it crashed — init SIGKILLs Resolve and exits.

(4) is the whole teardown story, and it needs no new authority: pid 1 of a pid namespace exiting kills every process in it, and the
capsule's namespaces, mounts and network are destroyed with the last process. That is why the governed stop can be a plain worker
operation instead of a privileged helper, a host signal path or a sudo rule.
"""
import json, os, signal, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE, os.path.join(ROOT, "tools"), os.path.join(ROOT, "worker")]
import launch_isolated_session as launcher
import resolve_worker as rw

REQUIRED = ("authority", "policy", "worker", "session", "session_sha256", "attestation_out", "state_dir", "secret_file", "port")


class InitError(Exception): pass


def req(c, msg):
    if not c: raise InitError(msg)


def check_capsule(probe=None, pid=None):
    """pid 1 of our own pid namespace, as the capsule account. Anything else means this is not the capsule and must not proceed."""
    probe = probe or rw.SystemProbe()
    pid = pid or os.getpid()
    req(pid == 1, f"capsule init must be pid 1 of the capsule pid namespace (it is pid {pid}); the capsule was not created")
    req(probe.uid() == rw.CAPSULE_UID, f"capsule init must run as the capsule account uid {rw.CAPSULE_UID} (it is {probe.uid()})")
    st = probe.status_fields(pid)
    req(st is not None, "capsule init cannot read its own status")
    return {"pid": pid, "uid": probe.uid(), "pid_ns": probe.ns(pid, "pid"), "mnt_ns": probe.ns(pid, "mnt"),
            "user_ns": probe.ns(pid, "user"), "net_ns": probe.ns(pid, "net")}


def start_worker(cfg, attestation_out, attestation_sha256, spawn=subprocess.Popen):
    """The worker runs in the capsule's own mount namespace — unmasked — so it can write its journal and read the operator-owned key
    the Resolve child can reach neither."""
    cmd = [sys.executable, "-B", os.path.join(ROOT, "worker", "resolve_worker.py"),
           "--host-id", cfg.get("host_id", "vidnux"), "--port", str(cfg["port"]),
           "--secret-file", cfg["secret_file"], "--state-dir", cfg["state_dir"], "--mode", "PRODUCTION_READ",
           "--production-authority", cfg["authority"], "--production-policy", cfg["policy"],
           "--production-policy-sha256", cfg["policy_sha256"], "--production-session", cfg["session"],
           "--production-session-sha256", cfg["session_sha256"],
           "--production-runtime-attestation", attestation_out, "--production-runtime-attestation-sha256", attestation_sha256]
    return spawn(cmd, stdin=subprocess.DEVNULL)


def supervise(resolve_pid, worker_proc, on_event=lambda e: None, poll=0.25, killer=os.kill):
    """Reap orphans (pid 1's job) until the worker exits, then end the session. Resolve is never asked to quit gracefully: a graceful
    quit is the one path in which Resolve writes, and this session has no write authority."""
    while True:
        rc = worker_proc.poll()
        if rc is not None:
            on_event({"event": "WORKER_EXITED", "returncode": rc})
            try: killer(resolve_pid, signal.SIGKILL); on_event({"event": "RESOLVE_KILLED", "pid": resolve_pid})
            except ProcessLookupError: on_event({"event": "RESOLVE_ALREADY_GONE", "pid": resolve_pid})
            return rc
        try:
            while True:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0: break
                if pid == resolve_pid: on_event({"event": "RESOLVE_EXITED", "pid": pid})
        except ChildProcessError: pass
        time.sleep(poll)


def main(argv):
    if len(argv) != 2: print(__doc__); return 2
    cfg = json.load(open(argv[1]))
    missing = [k for k in REQUIRED if k not in cfg]
    if missing: print(json.dumps({"ok": False, "error": "CAPSULE_INIT_REFUSED", "message": "missing: " + ",".join(missing)})); return 2
    def emit(e): print(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **e}), flush=True)
    try:
        ident = check_capsule()
        emit({"event": "CAPSULE_INIT", **ident})
        body, out, att_sha = launcher.launch({k: cfg[k] for k in ("authority", "policy", "worker", "session", "session_sha256")
                                              } | {"out": cfg["attestation_out"], "display": cfg.get("display"),
                                                   "timeout": cfg.get("timeout"), "cwd": cfg.get("cwd")})
        emit({"event": "RESOLVE_CONFINED", "resolve_pid": body["resolve_pid"], "resolve_mnt_ns": body["resolve_mnt_ns"],
              "seccomp": body["resolve_seccomp"], "evidence_masked": body["evidence_mask"], "attestation_sha256": att_sha})
        proc = start_worker(cfg, out, att_sha)
        emit({"event": "WORKER_STARTED", "pid": proc.pid, "port": cfg["port"]})
        rc = supervise(body["resolve_pid"], proc, emit)
        emit({"event": "CAPSULE_TEARDOWN", "worker_returncode": rc})
        return 0 if rc == 0 else 1
    except (InitError, launcher.LaunchError, OSError, ValueError, KeyError) as e:
        emit({"event": "CAPSULE_INIT_REFUSED", "error": type(e).__name__, "message": str(e)[:400]})
        return 2


if __name__ == "__main__": sys.exit(main(sys.argv))
