"""The confinement, proved against a real kernel — not described, and not faked.

Two levels:

  1. the SECCOMP FILTER, in this very process: a forked child installs it and then tries the calls that would undo an evidence mask
     or reach into the worker. No privileges are needed for this, so it runs everywhere the rest of the suite runs.
  2. the WHOLE CAPSULE, inside a real user/mount/pid/net namespace created by rootlesskit: a read-only library bind, a read-only
     frozen-runtime bind, a worker evidence directory holding a journal and the shared key, and a child started exactly the way the
     launcher starts Resolve. The worker side then re-derives the child's namespaces, confinement status and mount table from /proc
     and runs the candidate's OWN attest_capsule_process() law against them.

Nothing here touches the real capsule, the real broker, the approved runtime, a production library or Resolve. rootlesskit runs as the
operator, with --net=none, in a temporary directory.
"""
import ctypes, errno, json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [os.path.join(ROOT, "worker"), os.path.join(ROOT, "capsule"), HERE]
import resolve_worker as rw
import vrc_capsule_confine as cc

PROBE = os.path.join(HERE, "capsule_confinement_probe.py")
ROOTLESSKIT = shutil.which("rootlesskit")
TMP = []


def tmpdir(prefix):
    d = tempfile.mkdtemp(prefix=prefix); TMP.append(d); return d


class Filter(unittest.TestCase):
    """The filter itself: deterministic bytes, and real denials in a real child process."""
    @classmethod
    def setUpClass(cls):
        cls.report = child_report()

    def test_the_filter_is_deterministic_and_pinned(self):
        a, n = cc.seccomp_program()
        b, m = cc.seccomp_program()
        self.assertEqual(a, b); self.assertEqual(n, m)
        self.assertEqual(len(a), n * 8)
        self.assertEqual(rw.sha(a), "541c9bda1d4bc327a89c44276e3f6872c0f88ef8be3a222af5a147382ecbf361",
                         "the filter is pinned in every sealed profile; changing it must be a deliberate, visible change")

    def test_the_filter_installs_and_is_visible_in_proc(self):
        st = self.report["status"]
        self.assertEqual(st["Seccomp"], "2", "SECCOMP_MODE_FILTER — the fact the worker checks")
        self.assertEqual(st["Seccomp_filters"], "1")
        self.assertEqual(st["NoNewPrivs"], "1")

    def test_the_mount_and_namespace_family_is_refused(self):
        for call in ("mount", "umount2", "unshare_mnt", "unshare_user", "setns", "pivot_root", "chroot",
                     "clone_with_ns_flags", "open_by_handle_at", "name_to_handle_at"):
            self.assertEqual(self.report["after"][call], errno.EPERM, f"{call} must be refused after the filter")

    def test_reaching_into_another_process_is_refused(self):
        for call in ("ptrace", "process_vm_readv", "process_vm_writev"):
            self.assertEqual(self.report["after"][call], errno.EPERM, call)

    def test_the_premise_holds_before_the_filter(self):
        """Without the filter these are NOT EPERM here, so the test proves the filter and not the ambient environment."""
        self.assertEqual(self.report["before"]["ptrace"], errno.ESRCH, "before the filter the kernel answers, not the filter")
        self.assertNotEqual(self.report["before"]["mount"], errno.EPERM)

    def test_clone3_falls_back_instead_of_failing(self):
        self.assertEqual(self.report["after"]["clone3"], errno.ENOSYS,
                         "ENOSYS makes glibc fall back to clone(2), which is filtered on its flags; EPERM would break threads")

    def test_ordinary_work_still_runs_under_the_filter(self):
        self.assertTrue(self.report["threads_ok"], "a filter that broke thread creation could never run Resolve")
        self.assertTrue(self.report["file_io_ok"])
        self.assertEqual(self.report["clone_without_ns_flags"], 0, "plain fork/clone must still work")

    def test_a_foreign_architecture_is_killed_not_merely_denied(self):
        blob, _ = cc.seccomp_program()
        self.assertIn(cc.RET_KILL_PROCESS.to_bytes(4, "little"), blob)
        self.assertIn(cc.ARCH_X86_64.to_bytes(4, "little"), blob)


@unittest.skipIf(not ROOTLESSKIT, "rootlesskit is not installed; the real-capsule proof cannot run")
class RealCapsule(unittest.TestCase):
    """A real user/mount/pid/net namespace, a real mask, a real exec, and the candidate's own law run against the result."""
    @classmethod
    def setUpClass(cls):
        d = tmpdir("realcapsule-")
        r = subprocess.run([ROOTLESSKIT, "--net=none", "--pidns", sys.executable, "-B", PROBE, d],
                           capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, (r.stdout + r.stderr)[-3000:]
        cls.out = json.loads(r.stdout.strip().splitlines()[-1])
        cls.base = d

    def test_the_child_is_in_its_own_mount_namespace_inside_the_same_capsule(self):
        child, worker = self.out["child"]["ns"], self.out["worker"]
        self.assertNotEqual(child["mnt"], worker["mnt_ns"], "Resolve must not share the worker's mounts")
        for k in ("user", "pid", "net"):
            self.assertEqual(child[k], worker[k + "_ns"], f"Resolve must stay inside the capsule's {k} namespace")

    def test_the_child_holds_no_capabilities_and_cannot_gain_any(self):
        st = self.out["child"]["status"]
        for cap in ("CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb"):
            self.assertEqual(st[cap], "0000000000000000", cap)
        self.assertEqual(st["NoNewPrivs"], "1"); self.assertEqual(st["Seccomp"], "2"); self.assertEqual(st["Seccomp_filters"], "1")

    def test_the_child_cannot_see_read_or_write_worker_evidence(self):
        c = self.out["child"]
        self.assertEqual(c["listdir_masked"], "error:%d" % errno.EACCES, "the masked directory is mode 000")
        self.assertIn(c["write_masked"], ("errno:%d" % errno.EROFS, "errno:%d" % errno.EACCES))
        self.assertIn(c["read_key"], ("errno:%d" % errno.ENOENT, "errno:%d" % errno.EACCES),
                      "the shared HMAC key must not be readable from inside Resolve's namespace")
        self.assertNotIn("SHARED-KEY", json.dumps(c))

    def test_the_child_cannot_remove_the_mask_or_bring_the_real_directory_back(self):
        c = self.out["child"]
        for call in ("umount_mask", "lazy_umount_mask", "rebind_real_path", "new_mount_ns", "new_user_ns",
                     "clone_with_ns_flags", "setns", "pivot_root"):
            self.assertEqual(c[call]["errno"], errno.EPERM, f"{call} must be refused: it would undo the evidence mask")

    def test_the_child_cannot_replace_any_governed_artifact(self):
        c = self.out["child"]
        for key in ("replace_AUTHORITY_json", "replace_policy_json", "replace_session-profile_json",
                    "replace_journal_jsonl", "replace_final_sealed_jsonl"):
            self.assertNotEqual(c[key], "SUCCEEDED", key)
            self.assertTrue(c[key].startswith("errno:"), f"{key} = {c[key]}")
        self.assertTrue(all(self.out["governed_artifacts_unchanged"].values()), self.out["governed_artifacts_unchanged"])
        self.assertIs(self.out["journal_grew_by_worker_only"], True,
                      "the journal may only grow by the worker's own appends, never carry a byte the child wrote")
        self.assertIs(self.out["sealed_final_unchanged"], True, "sealed final evidence must survive the child byte for byte")

    def test_the_child_cannot_reach_into_the_worker_process(self):
        c = self.out["child"]
        self.assertEqual(c["ptrace_worker"]["errno"], errno.EPERM)
        self.assertEqual(c["read_worker_memory"], "errno:%d" % errno.EACCES,
                         "the shared key lives in the worker's memory; /proc/<worker>/mem must stay closed")

    def test_the_mask_is_a_read_only_tmpfs_in_the_childs_namespace_only(self):
        m = self.out["observed_by_worker"]["mask_mount"]
        self.assertEqual(m["fstype"], "tmpfs")
        self.assertIn("ro", m["options"].split(","))
        self.assertNotEqual(self.out["observed_by_worker"]["worker_mask_mount"]["fstype"], "tmpfs",
                            "the worker's own view of its evidence must NOT be masked")

    def test_the_worker_keeps_its_evidence_and_its_key(self):
        self.assertIs(self.out["worker_journal_writable"], True)
        self.assertIs(self.out["worker_sees_key"], True)

    def test_the_library_is_read_only_for_everyone_in_the_capsule(self):
        self.assertIs(self.out["library_readonly_for_worker"], True)
        self.assertEqual(self.out["worker_can_write_library"], "errno:%d" % errno.EROFS,
                         "WRITE AUTHORITY = NONE is enforced by the filesystem, not only by the code")

    def test_the_candidates_own_capsule_law_attests_this_real_capsule(self):
        law = self.out["law"]
        self.assertEqual(law["verdict"], "ATTESTED", law)
        f = law["facts"]
        self.assertEqual(f["seccomp"], 2); self.assertEqual(f["no_new_privs"], 1); self.assertEqual(f["capabilities"], 0)
        self.assertNotEqual(f["worker_mnt_ns"], f["resolve_mnt_ns"])
        self.assertEqual(len(f["evidence_masked"]), 1)

    def test_the_confined_child_can_still_do_ordinary_work(self):
        self.assertTrue(self.out["child"]["ordinary_work_still_possible"])

    def test_the_capsule_leaves_the_host_untouched(self):
        ev = os.path.join(self.base, "evidence")
        self.assertTrue(os.path.isfile(os.path.join(ev, "session.key")), "the host-side evidence survives the capsule")
        self.assertFalse(os.path.exists(os.path.join(ev, "attack")), "nothing the child attempted reached the host")
        m = rw._mount_for(ev, rw.SystemProbe().mountinfo(os.getpid()) or [])
        self.assertTrue(m is None or m["fstype"] != "tmpfs", "no mount from the capsule may survive in this namespace")


def child_report():
    """Run the filter in a forked child of THIS process and report what changed. No privileges required."""
    script = r'''
import ctypes, errno, json, os, sys, threading
sys.path.insert(0, %r)
import vrc_capsule_confine as cc
libc = ctypes.CDLL("libc.so.6", use_errno=True)
def call(fn, *a):
    ctypes.set_errno(0); fn(*a); return ctypes.get_errno()
def syscall(nr, *a): return call(libc.syscall, ctypes.c_long(nr), *a)
# PTRACE_PEEKDATA against pid 0 — never PTRACE_TRACEME, which would really attach this process to its parent and deadlock it on
# the first signal. Before the filter the kernel answers ESRCH; after it, the filter answers EPERM without the call running.
before = {"mount": call(libc.mount, b"tmpfs", b"/definitely/absent", b"tmpfs", ctypes.c_ulong(0), None),
          "ptrace": call(libc.ptrace, ctypes.c_long(2), ctypes.c_long(0), None, None)}
cc.confine_without_mounts(drop_caps=False)
after = {
 "mount": call(libc.mount, b"tmpfs", b"/definitely/absent", b"tmpfs", ctypes.c_ulong(0), None),
 "umount2": call(libc.umount2, b"/definitely/absent", ctypes.c_int(0)),
 "unshare_mnt": call(libc.unshare, ctypes.c_int(0x00020000)),
 "unshare_user": call(libc.unshare, ctypes.c_int(0x10000000)),
 "setns": call(libc.setns, ctypes.c_int(0), ctypes.c_int(0)),
 "pivot_root": syscall(155, b"/", b"/"),
 "chroot": call(libc.chroot, b"/"),
 "clone_with_ns_flags": syscall(56, ctypes.c_ulong(0x00020000), None, None, None, None),
 "clone3": syscall(435, None, ctypes.c_ulong(0)),
 "open_by_handle_at": syscall(304, ctypes.c_int(-1), None, ctypes.c_int(0)),
 "name_to_handle_at": syscall(303, ctypes.c_int(-1), b"/", None, None, ctypes.c_int(0)),
 "ptrace": call(libc.ptrace, ctypes.c_long(2), ctypes.c_long(0), None, None),
 "process_vm_readv": syscall(310, ctypes.c_long(os.getpid()), None, ctypes.c_ulong(0), None, ctypes.c_ulong(0), ctypes.c_ulong(0)),
 "process_vm_writev": syscall(311, ctypes.c_long(os.getpid()), None, ctypes.c_ulong(0), None, ctypes.c_ulong(0), ctypes.c_ulong(0)),
}
ok = []
t = threading.Thread(target=lambda: ok.append(1)); t.start(); t.join()
pid = os.fork()
if pid == 0: os._exit(0)
os.waitpid(pid, 0)
status = {}
for l in open("/proc/self/status"):
    k, _, v = l.partition(":")
    if k in ("Seccomp", "Seccomp_filters", "NoNewPrivs"): status[k] = v.strip()
print(json.dumps({"before": before, "after": after, "status": status, "threads_ok": ok == [1],
                  "file_io_ok": bool(open("/proc/self/stat").read()), "clone_without_ns_flags": 0}))
''' % (os.path.join(ROOT, "capsule"),)
    r = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, (r.stdout + r.stderr)[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def tearDownModule():
    for d in TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
