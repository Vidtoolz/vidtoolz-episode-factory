#!/usr/bin/env python3
"""Confinement primitives for the Resolve child inside the approved dedicated capsule (x86_64 Linux, stdlib only).

The capsule gives the worker and Resolve the SAME dedicated account (`vrc-capsule`, uid 981). That closes the operator boundary, but
inside the capsule the two processes are the same uid: nothing in the file mode bits stops a compromised Resolve from rewriting the
worker's journal, reading the shared HMAC key out of the worker's memory, or simply deleting the evidence of what it did.

So the capsule init does not start Resolve directly. It starts it:

  1. in its OWN mount namespace, with every worker-evidence path covered by an empty READ-ONLY tmpfs — Resolve does not see the
     journal, the replay guard, the shared key or the evidence spool, it sees empty unwritable directories;
  2. with an EMPTY capability bounding set and `no_new_privs`, so no exec can regain privilege;
  3. under a SECCOMP FILTER that refuses the whole mount and namespace family (`mount`, `umount2`, `unshare`, `setns`, `pivot_root`,
     `chroot`, the new mount API, `clone` with any namespace flag) plus `ptrace`, `process_vm_readv/writev` and the file-handle API.

(3) is what makes (1) durable. Inside a user namespace a process is otherwise free to create another namespace and undo the mask, or
to bind the real directory back in from the host tree; the filter removes every one of those calls. The filter survives `exec`, cannot
be removed once `no_new_privs` is set, and is visible in `/proc/<pid>/status` as `Seccomp: 2` — so the worker does not take the
confinement on trust either: it re-reads those facts, and the child's own mount table, at every operation.

Nothing here needs root, and nothing here touches the host: the mounts exist only in the child's own namespace and disappear with it.
"""
import ctypes, errno, os, struct

ARCH_X86_64 = 0xC000003E
X32_BIT = 0x40000000
PR_SET_NO_NEW_PRIVS, PR_SET_SECCOMP, PR_CAPBSET_DROP = 38, 22, 24
SECCOMP_MODE_FILTER = 2
RET_KILL_PROCESS, RET_ALLOW = 0x80000000, 0x7FFF0000
RET_ERRNO = 0x00050000
CLONE_NEWNS = 0x00020000
NS_FLAGS = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000
MS_RDONLY, MS_NOSUID, MS_NODEV, MS_NOEXEC, MS_REMOUNT, MS_REC, MS_PRIVATE = 1, 2, 4, 8, 32, 16384, 262144

NR_CLONE, NR_CLONE3 = 56, 435
# Refused outright. Every one of these is either a way to undo the evidence mask, or a way to reach into the worker process.
DENY = {
    "ptrace": 101, "pivot_root": 155, "chroot": 161, "mount": 165, "umount2": 166, "unshare": 272, "setns": 308,
    "name_to_handle_at": 303, "open_by_handle_at": 304, "process_vm_readv": 310, "process_vm_writev": 311,
    "open_tree": 428, "move_mount": 429, "fsopen": 430, "fsconfig": 431, "fsmount": 432, "fspick": 433, "mount_setattr": 442,
}
# seccomp_data: int nr; u32 arch; u64 ip; u64 args[6]
OFF_NR, OFF_ARCH, OFF_ARG0 = 0, 4, 16
LD_ABS_W, JEQ_K, JGE_K, JA, AND_K, RET_K = 0x20, 0x15, 0x35, 0x05, 0x54, 0x06


class ConfinementError(Exception): pass


def _asm(program):
    """Tiny label assembler for classic BPF: ("op", k, jt_label, jf_label) with labels resolved to forward offsets."""
    labels = {}
    for i, ins in enumerate(program):
        if isinstance(ins, str): labels[ins] = i - len(labels)
    code, seen = [], 0
    for ins in program:
        if isinstance(ins, str): seen += 1; continue
        op, k, jt, jf = ins
        here = len(code)
        def off(lbl, limit=255):
            if lbl is None: return 0
            if lbl not in labels: raise ConfinementError("unknown label " + lbl)
            d = labels[lbl] - here - 1
            if not 0 <= d <= limit: raise ConfinementError(f"jump to {lbl} out of range ({d})")
            return d
        # BPF_JA takes its offset in k, NOT in jt/jf: a JA that carried its target in jt would silently fall through to the next
        # instruction, which is how an "allow" branch can turn into an unrelated test. Encode it explicitly.
        if op == JA: code.append(struct.pack("HBBI", op, 0, 0, off(k, 0xFFFFFFFF)))
        else: code.append(struct.pack("HBBI", op, off(jt), off(jf), k & 0xFFFFFFFF))
    return b"".join(code), len(code)


def seccomp_program():
    """The filter, as (bytes, instruction_count). Deterministic: the same bytes every time, so it can be digested and reviewed."""
    p = [(LD_ABS_W, OFF_ARCH, None, None),
         (JEQ_K, ARCH_X86_64, None, "kill"),          # a foreign personality is never merely denied, it is killed
         (LD_ABS_W, OFF_NR, None, None),
         (JGE_K, X32_BIT, "kill", None),              # x32 aliases the same numbers with different semantics
         (JEQ_K, NR_CLONE3, "enosys", None),          # glibc falls back to clone(2), which is filtered on its flags
         (JEQ_K, NR_CLONE, "clone_flags", None)]
    for name in sorted(DENY, key=lambda n: DENY[n]):
        p.append((JEQ_K, DENY[name], "eperm", None))
    p += [(JA, "allow", None, None),
          "clone_flags", (LD_ABS_W, OFF_ARG0, None, None), (AND_K, NS_FLAGS, None, None),
          (JEQ_K, 0, "allow", "eperm"),
          "allow", (RET_K, RET_ALLOW, None, None),
          "eperm", (RET_K, RET_ERRNO | errno.EPERM, None, None),
          "enosys", (RET_K, RET_ERRNO | errno.ENOSYS, None, None),
          "kill", (RET_K, RET_KILL_PROCESS, None, None)]
    return _asm(p)


def _libc():
    return ctypes.CDLL("libc.so.6", use_errno=True)


def install_seccomp():
    """no_new_privs + the filter. Both are inherited across exec and cannot be undone."""
    libc = _libc()
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise ConfinementError("PR_SET_NO_NEW_PRIVS failed: " + os.strerror(ctypes.get_errno()))
    blob, count = seccomp_program()
    buf = ctypes.create_string_buffer(blob, len(blob))
    prog = struct.pack("HxxxxxxP", count, ctypes.cast(buf, ctypes.c_void_p).value)
    if libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.c_char_p(prog), 0, 0) != 0:
        raise ConfinementError("PR_SET_SECCOMP failed: " + os.strerror(ctypes.get_errno()))
    return count


def drop_bounding_set(required=True):
    """An empty bounding set: nothing this process execs can hold a capability. Dropping needs CAP_SETPCAP, which the capsule account
    holds inside its own user namespace and nowhere else — so `required=False` exists only for proving the seccomp filter offline,
    never on the path that starts Resolve."""
    libc = _libc(); dropped = 0
    for cap in range(64):
        ctypes.set_errno(0)
        if libc.prctl(PR_CAPBSET_DROP, cap, 0, 0, 0) == 0: dropped += 1
        elif ctypes.get_errno() in (errno.EINVAL, errno.ENOENT): continue
        elif required: raise ConfinementError(f"PR_CAPBSET_DROP({cap}) failed: " + os.strerror(ctypes.get_errno()))
        else: break
    return dropped


def mask_evidence(paths):
    """A private mount namespace for this process, with every named path covered by an empty read-only tmpfs. Requires CAP_SYS_ADMIN
    in the CURRENT user namespace — inside the capsule that is exactly what the capsule account has, and nowhere else."""
    libc = _libc()
    def mount(src, tgt, fs, flags, data):
        r = libc.mount(src.encode() if src else None, tgt.encode(), fs.encode() if fs else None, ctypes.c_ulong(flags),
                       data.encode() if data else None)
        if r != 0: raise ConfinementError(f"mount({src},{tgt},{fs}) failed: " + os.strerror(ctypes.get_errno()))
    if libc.unshare(ctypes.c_int(CLONE_NEWNS)) != 0:
        raise ConfinementError("unshare(CLONE_NEWNS) failed: " + os.strerror(ctypes.get_errno()))
    mount(None, "/", None, MS_REC | MS_PRIVATE, None)     # the masks must never propagate back to the capsule root
    masked = []
    for path in paths:
        if not os.path.isdir(path): raise ConfinementError(f"evidence path is not a directory: {path}")
        mount("tmpfs", path, "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, "size=0k,mode=0000,nr_inodes=0")
        mount(None, path, None, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC, None)
        masked.append(path)
    return masked


def confine(paths):
    """The whole confinement, in the order that makes each step irreversible: mask, then drop capabilities, then seccomp."""
    masked = mask_evidence(paths)
    dropped = drop_bounding_set()
    count = install_seccomp()
    return {"masked": masked, "capabilities_dropped": dropped, "seccomp_instructions": count}


def confine_without_mounts(drop_caps=True):
    """Confinement for a process that needs no mount namespace of its own (and for proving the filter offline)."""
    dropped = drop_bounding_set(required=drop_caps)
    count = install_seccomp()
    return {"masked": [], "capabilities_dropped": dropped, "seccomp_instructions": count}


if __name__ == "__main__":
    import json
    blob, count = seccomp_program()
    import hashlib
    print(json.dumps({"instructions": count, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(),
                      "denied": sorted(DENY), "clone_namespace_flags_denied": hex(NS_FLAGS)}, indent=1))
