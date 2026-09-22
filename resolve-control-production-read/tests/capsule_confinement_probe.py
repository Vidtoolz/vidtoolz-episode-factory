"""The 'worker' side of the real capsule proof. Runs as pid 1-ish inside a real rootlesskit capsule.

It builds a miniature of the production layout — a read-only library bind, a read-only frozen-runtime bind, a worker evidence
directory holding a journal and the shared key — then starts a child exactly the way the launcher starts Resolve: confined into its own
mount namespace with the evidence masked, with an empty capability bounding set and under the seccomp filter, and EXECs.

Then it does what the worker does at every operation: re-derives the child's namespaces, confinement status and mount table from /proc
and runs the candidate's own attest_capsule_process() law against them. The result is printed as JSON for the test to assert on.
"""
import ctypes, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "worker"), os.path.join(ROOT, "capsule"), HERE]
import resolve_worker as rw
import vrc_capsule_confine as cc

libc = ctypes.CDLL("libc.so.6", use_errno=True)
MS_BIND, MS_REC, MS_REMOUNT, MS_RDONLY = 4096, 16384, 32, 1


def bind_ro(path):
    for args in ((path.encode(), path.encode(), None, ctypes.c_ulong(MS_BIND | MS_REC), None),
                 (None, path.encode(), None, ctypes.c_ulong(MS_REMOUNT | MS_BIND | MS_RDONLY), None)):
        if libc.mount(*args) != 0: raise OSError(ctypes.get_errno(), "mount " + path)


def observe(probe, pid, ev, lib):
    """Exactly the facts the worker re-derives at every operation."""
    st = probe.status_fields(pid) or {}
    mounts = probe.mountinfo(pid) or []
    m = rw._mount_for(ev, mounts)
    return {"ns": {k: probe.ns(pid, k) for k in ("user", "mnt", "pid", "net")},
            "status": {k: st.get(k) for k in ("NoNewPrivs", "Seccomp", "Seccomp_filters", "CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb")},
            "mask_mount": m and {"mount_point": m["mount_point"], "fstype": m["fstype"], "options": m["options"]},
            "worker_mask_mount": (lambda x: x and {"mount_point": x["mount_point"], "fstype": x["fstype"]})(rw._mount_for(ev, probe.mountinfo(os.getpid()) or []))}


def run_law(probe, pid, ev, lib, runtime, binary):
    """The candidate's OWN capsule law, executed against a real kernel: same function the worker calls before it reads anything."""
    st = os.stat(lib)
    gov = {"host_primitive": {"capsule_uid": os.getuid(), "capsule_gid": os.getgid(), "runtime_root": runtime},
           "evidence_mask": [ev],
           "library": {"kind": "Disk", "name": "Probe Library", "canonical_root": lib, "physical_dev": st.st_dev, "physical_ino": st.st_ino},
           "resolve_binary": {"realpath": binary},
           "confinement": {"seccomp_filters": 1}}
    att = {"user_ns": probe.ns(os.getpid(), "user"), "pid_ns": probe.ns(os.getpid(), "pid"),
           "net_ns": probe.ns(os.getpid(), "net"), "worker_mnt_ns": probe.ns(os.getpid(), "mnt"),
           "resolve_mnt_ns": probe.ns(pid, "mnt")}
    try:
        return {"verdict": "ATTESTED", "facts": rw.attest_capsule_process(probe, gov, {}, att, pid)}
    except rw.OpError as e:
        return {"verdict": "REFUSED", "code": e.code, "detail": e.detail}


def main(base):
    out = {"capsule": {"uid": os.getuid(), "pid": os.getpid()}}
    lib = os.path.join(base, "library"); runtime = os.path.join(base, "runtime"); ev = os.path.join(base, "evidence")
    for d in (lib, runtime, os.path.join(runtime, "bin"), ev): os.makedirs(d, exist_ok=True)
    binary = os.path.join(runtime, "bin", "resolve")
    open(binary, "wb").write(b"\x7fELF" + b"\0" * 1020); os.chmod(binary, 0o755)
    open(os.path.join(lib, "Project.db"), "wb").write(b"SQLite format 3\0")
    journal = os.path.join(ev, "journal.jsonl"); open(journal, "w").write('{"event":"WORKER_START"}\n')
    open(os.path.join(ev, "session.key"), "w").write("SHARED-KEY-THE-CHILD-MUST-NEVER-SEE")
    os.makedirs(os.path.join(ev, "final"), exist_ok=True)
    open(os.path.join(ev, "final", "sealed.jsonl"), "w").write('{"event":"SESSION_STOPPED"}\n')
    for name in ("AUTHORITY.json", "policy.json", "session-profile.json"):
        open(os.path.join(ev, name), "w").write('{"governed":"artifact the child must not be able to replace"}\n')
    originals = {n: open(os.path.join(ev, n), "rb").read() for n in
                 ("AUTHORITY.json", "policy.json", "session-profile.json", "journal.jsonl", "session.key")}
    bind_ro(lib); bind_ro(runtime)

    r, w = os.pipe()
    child = os.fork()
    if child == 0:
        try:
            os.close(r); os.dup2(w, 1); os.close(w)
            cc.confine([ev])
            os.execv(sys.executable, [sys.executable, "-B", os.path.join(HERE, "capsule_child_probe.py"), ev, str(os.getpid() and os.getppid())])
        except BaseException as e:
            os.write(2, ("child failed: %r\n" % e).encode()); os._exit(97)
    os.close(w)
    line = b""
    with os.fdopen(r, "rb", buffering=0) as fh:                  # ONE line, then the child waits: the worker must observe it ALIVE
        while not line.endswith(b"\n"):
            ch = fh.read(1)
            if not ch: break
            line += ch
        try: out["child"] = json.loads(line.decode().strip())
        except ValueError: out["child_raw"] = line.decode(errors="replace")[-1500:]

        probe = rw.SystemProbe()
        out["observed_by_worker"] = observe(probe, child, ev, lib)
        out["law"] = run_law(probe, child, ev, lib, runtime, binary)
    try:
        os.kill(child, 9)
    except ProcessLookupError: pass
    _, status = os.waitpid(child, 0)
    out["child_exit"] = status

    probe = rw.SystemProbe()
    out["worker"] = {"mnt_ns": probe.ns(os.getpid(), "mnt"), "user_ns": probe.ns(os.getpid(), "user"),
                     "pid_ns": probe.ns(os.getpid(), "pid"), "net_ns": probe.ns(os.getpid(), "net")}
    out["worker_journal_writable"] = None
    try:
        open(journal, "a").write('{"event":"OP"}\n'); out["worker_journal_writable"] = True
    except OSError as e: out["worker_journal_writable"] = "errno:%d" % e.errno
    out["worker_sees_key"] = os.path.isfile(os.path.join(ev, "session.key"))
    # the journal legitimately grows: the WORKER appends to it above. What must never happen is the CHILD's bytes appearing in it.
    out["governed_artifacts_unchanged"] = {n: open(os.path.join(ev, n), "rb").read() == b
                                           for n, b in originals.items() if n != "journal.jsonl"}
    jr = open(journal, "rb").read()
    out["journal_grew_by_worker_only"] = jr.startswith(originals["journal.jsonl"]) and b"REWRITTEN-BY-RESOLVE" not in jr
    out["sealed_final_unchanged"] = open(os.path.join(ev, "final", "sealed.jsonl"), "rb").read() == b'{"event":"SESSION_STOPPED"}\n' 
    out["library_readonly_for_worker"] = bool(probe.statvfs_flag(lib) & rw.ST_RDONLY)
    try:
        open(os.path.join(lib, "written-by-worker"), "w").write("x"); out["worker_can_write_library"] = "SUCCEEDED"
    except OSError as e: out["worker_can_write_library"] = "errno:%d" % e.errno
    print(json.dumps(out))
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv[1]))
