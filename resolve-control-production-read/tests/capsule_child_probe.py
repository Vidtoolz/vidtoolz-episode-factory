"""The 'Resolve' side of the real capsule proof: runs AFTER exec, confined, and reports what it can and cannot do.

Everything it attempts here is something a compromised Resolve would attempt: write the worker's journal, read the shared key,
unmount the mask, bind the real directory back in, make itself a new namespace, or reach into the worker process.
"""
import ctypes, json, os, sys, time

libc = ctypes.CDLL("libc.so.6", use_errno=True)


def call(fn, *a):
    ctypes.set_errno(0)
    return {"rc": fn(*a), "errno": ctypes.get_errno()}


def main(masked, worker_pid):
    out = {"pid": os.getpid(), "uid": os.getuid(), "ns": {}, "status": {}}
    for k in ("user", "mnt", "pid", "net"):
        try: out["ns"][k] = os.readlink("/proc/self/ns/" + k)
        except OSError as e: out["ns"][k] = "unreadable:" + str(e.errno)
    for line in open("/proc/self/status"):
        k, _, v = line.partition(":")
        if k in ("Seccomp", "Seccomp_filters", "NoNewPrivs", "CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb", "Uid"):
            out["status"][k] = v.strip()
    try: out["listdir_masked"] = sorted(os.listdir(masked))
    except OSError as e: out["listdir_masked"] = "error:" + str(e.errno)
    try:
        open(os.path.join(masked, "attack"), "w").write("x"); out["write_masked"] = "SUCCEEDED"
    except OSError as e: out["write_masked"] = "errno:" + str(e.errno)
    try:
        out["read_key"] = open(os.path.join(masked, "session.key"), "rb").read().decode()
    except OSError as e: out["read_key"] = "errno:" + str(e.errno)
    out["umount_mask"] = call(libc.umount2, masked.encode(), ctypes.c_int(2))
    out["lazy_umount_mask"] = call(libc.umount2, masked.encode(), ctypes.c_int(2 | 1))
    out["rebind_real_path"] = call(libc.mount, masked.encode(), b"/tmp", None, ctypes.c_ulong(4096 | 8192), None)
    out["new_mount_ns"] = call(libc.unshare, ctypes.c_int(0x00020000))
    out["new_user_ns"] = call(libc.unshare, ctypes.c_int(0x10000000))
    out["clone_with_ns_flags"] = call(libc.syscall, ctypes.c_long(56), ctypes.c_ulong(0x00020000), None, None, None, None)
    out["setns"] = call(libc.setns, ctypes.c_int(0), ctypes.c_int(0))
    out["ptrace_worker"] = call(libc.ptrace, ctypes.c_long(16), ctypes.c_long(worker_pid), None, None)
    out["pivot_root"] = call(libc.syscall, ctypes.c_long(155), b"/", b"/")
    try:
        with open("/proc/%d/mem" % worker_pid, "rb") as fh: fh.seek(0); fh.read(1)
        out["read_worker_memory"] = "SUCCEEDED"
    except OSError as e: out["read_worker_memory"] = "errno:" + str(e.errno)
    out["mountinfo_at_mask"] = [l.strip() for l in open("/proc/self/mountinfo") if (" " + masked + " ") in l]
    out["ordinary_work_still_possible"] = os.path.isdir("/") and len(os.listdir("/")) > 0
    print(json.dumps(out), flush=True)
    time.sleep(120)              # stay alive: the worker must attest a LIVE process, not a corpse
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv[1], int(sys.argv[2])))
