"""The DEDICATED_CAPSULE_V1 laws, offline.

Independent host review approved the dedicated capsule on 2026-09-22 (review manifest 84f5bcbc…, 31/31). This suite proves the
APPLICATION side of that boundary — the part the host review explicitly left open:

  * the scripting runtime is pinned to the frozen root-owned capsule copy, and the vendor loader's `/opt/resolve` fallback is
    unreachable from a production read;
  * the approved host primitive is re-derived from the running system, not trusted from the policy text, and every drift refuses;
  * the shared HMAC key crosses the account boundary read-only, with a pinned identity;
  * the Resolve child is confined — own mount namespace, worker evidence masked, no capabilities, seccomp — and the worker re-checks
    those facts itself at every operation;
  * the governed STOP exists, is bound to the attested session, names no process and takes no parameters.

It reuses the one harness in test_production_read.py: real candidate bytes, the real compiler/generator/launcher/verifier, real
temp-directory libraries, a deterministic process probe and a synthetic capsule — all injected explicitly. The REAL kernel proof of the
confinement (a real mount namespace, a real mask, real capability drops, a real seccomp filter) is in test_capsule_confinement.py.
"""
import json, os, shutil, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE]
import test_production_read as T
import resolve_worker as rw
import vrc_capsule_confine as confine_mod
import compile_production_read_policy as comp
import generate_session_profile as gen


class CapsuleProbe(rw.SystemProbe):
    """A real probe with only the facts a SYNTHETIC capsule cannot supply overridden: the capsule account's passwd entry, the root
    ownership of the frozen runtime and the broker, and the operator ownership of the shared key. Everything else — realpaths, sizes,
    digests, timestamps — comes from the real filesystem."""
    def __init__(self, pins, secret_path=None, secret_uid=T.OPERATOR_UID, secret_writable=False):
        self.pins, self.secret_path, self.secret_uid, self.secret_writable = pins, secret_path, secret_uid, secret_writable
        self.account_entry = {"uid": pins["capsule_uid"], "gid": pins["capsule_gid"], "shell": "/usr/sbin/nologin"}
    def uid(self): return self.pins["capsule_uid"]
    def account(self, name): return dict(self.account_entry) if (name == self.pins["capsule_account"] and self.account_entry) else None
    def stat_file(self, path):
        st = super().stat_file(path)
        if st and (path == self.pins["broker_path"] or path.startswith(self.pins["runtime_root"])): st["uid"] = 0
        if st and self.secret_path and os.path.abspath(path) == os.path.abspath(self.secret_path): st["uid"] = self.secret_uid
        return st
    def writable(self, path):
        if self.secret_path and os.path.abspath(path) == os.path.abspath(self.secret_path): return self.secret_writable
        return super().writable(path)


class HostPrimitive(unittest.TestCase):
    """The approved boundary is a set of facts about THIS machine, re-derived before a read and again at every operation."""
    def setUp(self):
        self.cap = T.synthetic_capsule()
        self.probe = CapsuleProbe(self.cap["pins"])

    def test_the_real_approved_boundary_verifies_on_this_host(self):
        facts = rw.verify_host_primitive(rw.CAPSULE_PINS, rw.SystemProbe(), {})
        self.assertEqual(facts["capsule_uid"], 981)
        self.assertEqual(facts["broker_sha256"], rw.BROKER_SHA256)
        self.assertEqual(facts["resolve_binary_sha256"], rw.RESOLVE_BINARY_SHA256)
        self.assertEqual(facts["script_lib_sha256"], rw.SCRIPT_LIB_SHA256)
        self.assertEqual(facts["host_review_manifest_sha256"], rw.HOST_REVIEW_MANIFEST_SHA256)
        self.assertNotEqual(facts["runtime_root"], rw.MUTABLE_RESOLVE_ROOT)

    def test_the_approved_boundary_is_frozen_in_the_worker_and_in_the_compiler(self):
        self.assertEqual(rw.CAPSULE_PINS, comp.HOST_PRIMITIVE, "the compiler and the worker must pin the SAME boundary")
        self.assertEqual(rw.EXECUTION_ENVIRONMENTS, ("DEDICATED_CAPSULE_V1",))
        rw.validate_host_primitive(dict(rw.CAPSULE_PINS), "test")

    def test_a_synthetic_boundary_is_refused_by_a_production_worker(self):
        """The injected boundary is a test seam, not a bypass: a record naming it is unusable against the frozen constants."""
        with self.assertRaises(rw.OpError) as cm: rw.validate_host_primitive(dict(self.cap["pins"]), "test")
        self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH")

    def test_every_field_of_the_boundary_is_pinned(self):
        for field in rw.CAPSULE_PINS:
            bad = dict(rw.CAPSULE_PINS)
            bad[field] = 4242 if isinstance(bad[field], int) else bad[field] + "x"
            with self.assertRaises(rw.OpError, msg=field) as cm: rw.validate_host_primitive(bad, "test")
            self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH", field)
            self.assertEqual(cm.exception.detail["field"], field)

    def test_an_unknown_or_missing_field_refuses(self):
        for bad in (dict(rw.CAPSULE_PINS, extra=1), {k: v for k, v in rw.CAPSULE_PINS.items() if k != "broker_path"}, None, [], "x"):
            with self.assertRaises(rw.OpError) as cm: rw.validate_host_primitive(bad, "test")
            self.assertIn(cm.exception.detail["reason"], ("HOST_PRIMITIVE_INVALID",))

    def test_a_missing_account_a_login_shell_or_a_wrong_uid_refuses(self):
        pins = self.cap["pins"]
        for account, why in ((None, "HOST_PRIMITIVE_MISSING"), ({"uid": 7, "gid": 7, "shell": "/usr/sbin/nologin"}, "HOST_PRIMITIVE_MISMATCH"),
                             ({"uid": pins["capsule_uid"], "gid": pins["capsule_gid"], "shell": "/bin/bash"}, "HOST_PRIMITIVE_MISMATCH")):
            probe = CapsuleProbe(pins); probe.account_entry = account
            with self.assertRaises(rw.OpError) as cm: rw.verify_host_primitive(pins, probe, {})
            self.assertEqual(cm.exception.detail["reason"], why)

    def test_a_broker_that_is_not_root_owned_or_not_the_approved_bytes_refuses(self):
        pins = dict(self.cap["pins"])
        probe = CapsuleProbe(pins)
        rw.verify_host_primitive(pins, probe, {})                       # the synthetic capsule verifies as it stands
        real = probe.stat_file
        probe.stat_file = lambda p, r=real, b=pins["broker_path"]: (dict(r(p), uid=1000) if p == b else r(p))
        with self.assertRaises(rw.OpError) as cm: rw.verify_host_primitive(pins, probe, {})
        self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH")
        probe.stat_file = real
        open(pins["broker_path"], "ab").write(b"tamper")
        with self.assertRaises(rw.OpError) as cm: rw.verify_host_primitive(pins, probe, {})
        self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH")

    def test_a_mutated_runtime_member_or_manifest_refuses(self):
        for member in ("bin/resolve", "libs/Fusion/fusionscript.so", "RUNTIME-MANIFEST.sha256"):
            cap = T.synthetic_capsule()
            probe = CapsuleProbe(cap["pins"])
            rw.verify_host_primitive(cap["pins"], probe, {})
            path = os.path.join(cap["pins"]["runtime_root"], member)
            data = bytearray(open(path, "rb").read()); data[-1] ^= 0xFF; open(path, "wb").write(data)
            with self.assertRaises(rw.OpError, msg=member) as cm: rw.verify_host_primitive(cap["pins"], probe, {})
            self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH", member)

    def test_the_operators_own_resolve_installation_can_never_be_the_runtime(self):
        pins = dict(self.cap["pins"], runtime_root=rw.MUTABLE_RESOLVE_ROOT)
        with self.assertRaises(rw.OpError) as cm: rw.verify_host_primitive(pins, CapsuleProbe(pins), {})
        self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH")

    def test_the_digest_cache_is_keyed_on_inode_identity(self):
        cap = T.synthetic_capsule(); probe = CapsuleProbe(cap["pins"]); cache = {}
        rw.verify_host_primitive(cap["pins"], probe, cache)
        self.assertGreaterEqual(len(cache), 3)
        calls = []; real = probe.hash_file
        probe.hash_file = lambda p, r=real: (calls.append(p), r(p))[1]
        rw.verify_host_primitive(cap["pins"], probe, cache)
        self.assertEqual(calls, [], "unchanged inode metadata must not re-hash a 688 MB runtime binary per operation")
        path = os.path.join(cap["pins"]["runtime_root"], "bin", "resolve")
        data = bytearray(open(path, "rb").read()); data[0] ^= 0xFF; open(path, "wb").write(data)
        with self.assertRaises(rw.OpError): rw.verify_host_primitive(cap["pins"], probe, cache)
        self.assertTrue(calls, "changed metadata must force a re-hash")


class ScriptingRuntime(unittest.TestCase):
    """MANDATORY REPAIR. The vendor loader tries `import fusionscript`, then $RESOLVE_SCRIPT_LIB, then a hardcoded
    /opt/resolve/libs/Fusion/ — all three reachable by the operator account. Production mode never runs it."""
    def setUp(self):
        self.cap = T.synthetic_capsule()
        self.probe = CapsuleProbe(self.cap["pins"])
        # The capsule broker clearenv()s before it execs, so the loader starts from an empty environment. This suite runs in the
        # OPERATOR's shell, which on this host already exports RESOLVE_SCRIPT_API, RESOLVE_SCRIPT_LIB and a PYTHONPATH pointing into
        # /opt/resolve — precisely the ambient state the pin exists for. Clear it here and restore it afterwards.
        self._saved = {k: os.environ.pop(k, None) for k in tuple(rw.SCRIPT_ENV_REFUSED) + ("VRC_FAKE_STATE",)}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

    def test_the_operators_ambient_environment_is_exactly_what_the_pin_exists_for(self):
        """Not a hypothetical: on this host the operator shell exports the vendor scripting variables. A production read that honoured
        them — as the 0.4.0 loader's `setdefault` did — would import the operator's own, rewritable, /opt/resolve modules."""
        ambient = {k: v for k, v in self._saved.items() if v and rw.MUTABLE_RESOLVE_ROOT in v}
        if not ambient: self.skipTest("this shell exports no /opt/resolve scripting variables")
        for k, v in ambient.items():
            os.environ[k] = v
            try:
                with self.assertRaises(SystemExit, msg=k) as cm: rw.load_capsule_api(self.cap["pins"], self.probe)
                self.assertIn("constructed, never inherited", str(cm.exception))
            finally: os.environ.pop(k, None)

    def test_the_production_loader_refuses_any_test_substitution_variable(self):
        for var in ("VRC_FAKE_RESOLVE", "VRC_FAKE_STATE", "RESOLVE_FAKE_API", "VRC_TEST_API"):
            os.environ[var] = "x"
            try:
                with self.assertRaises(SystemExit, msg=var) as cm: rw.load_capsule_api(self.cap["pins"], self.probe)
                self.assertIn("test substitution variables", str(cm.exception))
            finally: os.environ.pop(var, None)

    def test_the_frozen_runtime_really_does_carry_the_dormant_opt_resolve_fallback(self):
        """The finding, verified in the approved runtime's own bytes: this is why the pin exists."""
        loader = os.path.join(rw.RUNTIME_ROOT, "Developer", "Scripting", "Modules", "DaVinciResolveScript.py")
        src = open(loader, encoding="utf-8", errors="replace").read()
        self.assertIn('"/opt/resolve/libs/Fusion/"', src)
        self.assertIn("RESOLVE_SCRIPT_LIB", src)

    def test_the_production_loader_never_touches_the_vendor_loader_or_opt_resolve(self):
        src = open(os.path.join(ROOT, "worker", "resolve_worker.py"), encoding="utf-8").read()
        body = src[src.index("def load_capsule_api"):src.index("def verify_loaded_from")]
        code = body[body.index('"""', body.index('"""') + 3) + 3:]          # the code, not the docstring that names the vendor loader
        self.assertNotIn("import DaVinciResolveScript", code)
        self.assertNotIn("RESOLVE_SCRIPT_API", code.replace("SCRIPT_ENV_REFUSED", ""))
        self.assertNotIn(MUTABLE := "/opt/resolve", code)
        self.assertIn("ExtensionFileLoader", body)
        self.assertIn("MUTABLE_RESOLVE_ROOT", body)
        prod = src[src.index("def load_production_api"):src.index("def load_api")]
        self.assertIn("load_capsule_api(CAPSULE_PINS)", prod)
        self.assertIn('if mode == "PRODUCTION_READ"', prod)

    def test_the_production_loader_refuses_an_inherited_scripting_path(self):
        for var in rw.SCRIPT_ENV_REFUSED:
            old = os.environ.get(var); os.environ[var] = "/opt/resolve/libs/Fusion/fusionscript.so"
            try:
                with self.assertRaises(SystemExit, msg=var) as cm: rw.load_capsule_api(self.cap["pins"], self.probe)
                self.assertIn(var, str(cm.exception))
            finally:
                if old is None: os.environ.pop(var, None)
                else: os.environ[var] = old

    def test_the_production_loader_refuses_a_preloaded_module(self):
        for name in ("fusionscript", "DaVinciResolveScript"):
            sys.modules[name] = object()
            try:
                with self.assertRaises(SystemExit) as cm: rw.load_capsule_api(self.cap["pins"], self.probe)
                self.assertIn(name, str(cm.exception))
            finally: sys.modules.pop(name, None)

    def test_the_production_loader_refuses_a_library_outside_the_frozen_runtime(self):
        probe = self.probe
        outside = os.path.join(T.tmpdir("elsewhere-"), "fusionscript.so"); open(outside, "wb").write(b"\x7fELF")
        link = os.path.join(self.cap["pins"]["runtime_root"], "libs", "Fusion", "linked.so"); os.symlink(outside, link)
        pins = dict(self.cap["pins"], script_lib_relpath="libs/Fusion/linked.so")
        with self.assertRaises(SystemExit) as cm: rw.load_capsule_api(pins, probe)
        self.assertIn("outside the approved runtime", str(cm.exception))

    def test_the_production_loader_refuses_a_library_that_is_not_root_owned(self):
        probe = self.probe
        real = probe.stat_file
        probe.stat_file = lambda p, r=real: (dict(r(p), uid=1000) if p.endswith("fusionscript.so") else r(p))
        with self.assertRaises(SystemExit) as cm: rw.load_capsule_api(self.cap["pins"], probe)
        self.assertIn("root-owned", str(cm.exception))

    def test_the_production_loader_refuses_a_digest_or_manifest_mismatch(self):
        probe = self.probe
        with self.assertRaises(SystemExit) as cm: rw.load_capsule_api(dict(self.cap["pins"], script_lib_sha256="0" * 64), probe)
        self.assertIn("runtime manifest", str(cm.exception))
        open(os.path.join(self.cap["pins"]["runtime_root"], "RUNTIME-MANIFEST.sha256"), "w").write("deadbeef  libs/Fusion/fusionscript.so\n")
        with self.assertRaises(SystemExit) as cm: rw.load_capsule_api(self.cap["pins"], probe)
        self.assertIn("runtime manifest", str(cm.exception))

    def test_a_mapping_from_the_mutable_installation_refuses_after_load(self):
        maps = os.path.join(T.tmpdir("maps-"), "maps")
        lib = os.path.join(self.cap["pins"]["runtime_root"], "libs", "Fusion", "fusionscript.so")
        row = "7f0000000000-7f0000001000 r-xp 00000000 00:1b 1 %s\n"
        open(maps, "w").write(row % lib)
        self.assertTrue(rw.verify_loaded_from(lib, lib, maps))
        open(maps, "w").write((row % lib) + (row % "/opt/resolve/libs/Fusion/fusionscript.so"))
        with self.assertRaises(SystemExit) as cm: rw.verify_loaded_from(lib, lib, maps)
        self.assertIn("mutable Resolve installation", str(cm.exception))
        open(maps, "w").write(row % "/somewhere/else.so")
        with self.assertRaises(SystemExit): rw.verify_loaded_from(lib, lib, maps)

    def test_a_module_reporting_another_origin_refuses(self):
        lib = os.path.join(self.cap["pins"]["runtime_root"], "libs", "Fusion", "fusionscript.so")
        with self.assertRaises(SystemExit) as cm: rw.verify_loaded_from(lib, "/opt/resolve/libs/Fusion/fusionscript.so")
        self.assertIn("another origin", str(cm.exception))


class SharedKey(unittest.TestCase):
    """The ONE artifact both accounts touch. Owned by the operator, readable — never writable — by the capsule, identity pinned."""
    def setUp(self):
        self.cap = T.synthetic_capsule()
        self.p = T.Fixture().profile(capsule=self.cap, mask=self.cap["mask"])
        self.d = T.tmpdir("key-"); self.sf = T.secret_file(self.d)
        self.ci = self.p.gov["caller_identity"]

    def probe(self, **kw): return CapsuleProbe(self.cap["pins"], secret_path=self.sf, **kw)

    def test_a_correctly_placed_key_verifies(self):
        facts = rw.verify_secret_placement(self.sf, T.SECRET, self.ci, self.probe())
        self.assertEqual(facts["hmac_key_id"], T.KEY_ID)
        self.assertEqual(facts["owner_uid"], T.OPERATOR_UID)
        self.assertFalse(facts["capsule_writable"])

    def test_a_key_the_capsule_owns_or_can_write_refuses(self):
        with self.assertRaises(rw.OpError) as cm:
            rw.verify_secret_placement(self.sf, T.SECRET, self.ci, self.probe(secret_uid=self.cap["pins"]["capsule_uid"]))
        self.assertEqual(cm.exception.detail["reason"], "SECRET_PLACEMENT_INVALID")
        with self.assertRaises(rw.OpError) as cm:
            rw.verify_secret_placement(self.sf, T.SECRET, self.ci, self.probe(secret_writable=True))
        self.assertEqual(cm.exception.detail["reason"], "SECRET_PLACEMENT_INVALID")

    def test_a_key_owned_by_a_third_account_refuses(self):
        with self.assertRaises(rw.OpError) as cm:
            rw.verify_secret_placement(self.sf, T.SECRET, self.ci, self.probe(secret_uid=1234))
        self.assertEqual(cm.exception.detail["reason"], "SECRET_PLACEMENT_INVALID")

    def test_a_substituted_key_is_not_a_silent_substitution(self):
        other = os.urandom(32).hex().encode()
        with self.assertRaises(rw.OpError) as cm: rw.verify_secret_placement(self.sf, other, self.ci, self.probe())
        self.assertEqual(cm.exception.detail["reason"], "HMAC_KEY_IDENTITY_MISMATCH")

    def test_a_short_or_missing_key_refuses(self):
        with self.assertRaises(rw.OpError): rw.verify_secret_placement(self.sf, b"tooshort", self.ci, self.probe())
        with self.assertRaises(rw.OpError) as cm:
            rw.verify_secret_placement(os.path.join(self.d, "absent"), T.SECRET, self.ci, self.probe())
        self.assertEqual(cm.exception.detail["reason"], "SECRET_PLACEMENT_INVALID")

    def test_the_caller_may_never_be_the_capsule_account(self):
        bad = T.record(T.libspec("L", self.d), [T.P_A1], capsule=self.cap["pins"],
                       caller={"operator_uid": self.cap["pins"]["capsule_uid"], "hmac_key_id": T.KEY_ID})
        with self.assertRaises(comp.PolicyError) as cm:
            comp.compile_record(json.dumps(bad).encode(), T.WSHA, boundary=self.cap["pins"])
        self.assertIn("caller_identity.operator_uid", str(cm.exception))
        src = open(os.path.join(ROOT, "tools", "compile_production_read_policy.py"), encoding="utf-8").read()
        self.assertIn("the caller and the capsule may not be the same account", src)

    def test_the_placement_tool_refuses_to_run_as_the_capsule_and_reports_the_key_identity(self):
        tool = os.path.join(ROOT, "tools", "prepare_session_key.py")
        r = subprocess.run([sys.executable, "-B", tool, "--verify", self.sf, "--capsule-account", "root"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("KEY_PLACEMENT_REFUSED", r.stdout)
        src = open(tool, encoding="utf-8").read()
        self.assertIn("never as the capsule account", src)
        self.assertNotIn("print(data", src, "the tool must never print key material")


class CapsuleProcess(unittest.TestCase):
    """The confinement laws, all of them observable in /proc and all of them re-derived by the worker, not taken from the attestation."""
    def setUp(self):
        self.cap = T.synthetic_capsule()
        self.fx = T.Fixture(); self.p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"])

    def attest(self, probe=None): return rw.attest_isolated_session(probe or T.FakeProbe(self.p), self.p.gov, self.p.prov, self.p.att)

    def refuse(self, probe, reason):
        with self.assertRaises(rw.OpError) as cm: self.attest(probe)
        self.assertEqual(cm.exception.code, "LIBRARY_MISMATCH", "only frozen vrc.v1 codes")
        self.assertEqual(cm.exception.detail["reason"], reason, cm.exception.detail)
        return cm.exception

    def test_a_correctly_confined_session_attests_and_reports_the_capsule(self):
        ident = self.attest()
        c = ident["capsule"]
        self.assertEqual(c["capsule_uid"], self.cap["pins"]["capsule_uid"])
        self.assertNotEqual(c["worker_mnt_ns"], c["resolve_mnt_ns"])
        self.assertEqual(c["seccomp"], 2); self.assertEqual(c["no_new_privs"], 1); self.assertEqual(c["capabilities"], 0)
        self.assertEqual(sorted(c["evidence_masked"]), sorted(self.p.gov["evidence_mask"]))

    def test_a_worker_or_resolve_outside_the_capsule_account_refuses(self):
        self.refuse(T.FakeProbe(self.p, uid=1000), "CAPSULE_IDENTITY_MISMATCH")
        probe = T.FakeProbe(self.p); probe.proc_uid = lambda pid: 1000
        self.refuse(probe, "SESSION_OWNER_MISMATCH")

    def test_resolve_sharing_the_workers_mount_namespace_refuses(self):
        probe = T.FakeProbe(self.p); probe.ns = lambda pid, kind: T.NS["worker_mnt"] if kind == "mnt" else T.NS[kind]
        self.refuse(probe, "CAPSULE_EVIDENCE_EXPOSED")

    def test_resolve_outside_the_capsules_user_pid_or_network_namespace_refuses(self):
        for kind in ("user", "pid", "net"):
            probe = T.FakeProbe(self.p)
            probe.ns = lambda pid, k, kk=kind: ("other:[1]" if (k == kk and pid in probe.resolve_pids)
                                                else (T.NS["resolve_mnt"] if (k == "mnt" and pid in probe.resolve_pids) else (T.NS["worker_mnt"] if k == "mnt" else T.NS[k])))
            self.refuse(probe, "CAPSULE_NAMESPACE_MISMATCH")

    def test_unreadable_namespace_identity_refuses(self):
        probe = T.FakeProbe(self.p); probe.ns = lambda pid, kind: None
        self.refuse(probe, "CAPSULE_NAMESPACE_UNREADABLE")

    def test_a_resolve_that_is_not_confined_refuses(self):
        for field, value, reason in (("NoNewPrivs", 0, "CAPSULE_CONFINEMENT_MISSING"),
                                     ("Seccomp", 0, "CAPSULE_CONFINEMENT_MISSING"),
                                     ("Seccomp", 1, "CAPSULE_CONFINEMENT_MISSING"),
                                     ("CapBnd", 1 << 21, "CAPSULE_CONFINEMENT_MISSING"),
                                     ("CapEff", 1, "CAPSULE_CONFINEMENT_MISSING"),
                                     ("CapInh", 1, "CAPSULE_CONFINEMENT_MISSING")):
            status = {"NoNewPrivs": 1, "Seccomp": 2, "Seccomp_filters": 1, "CapBnd": 0, "CapEff": 0, "CapPrm": 0, "CapInh": 0, "CapAmb": 0}
            status[field] = value
            self.refuse(T.FakeProbe(self.p, status=status), reason)

    def test_a_second_seccomp_filter_refuses(self):
        status = {"NoNewPrivs": 1, "Seccomp": 2, "Seccomp_filters": 2, "CapBnd": 0, "CapEff": 0, "CapPrm": 0, "CapInh": 0, "CapAmb": 0}
        self.refuse(T.FakeProbe(self.p, status=status), "CAPSULE_CONFINEMENT_MISSING")

    def test_an_unmasked_or_wrongly_masked_evidence_path_refuses(self):
        self.refuse(T.FakeProbe(self.p, mask=[]), "CAPSULE_EVIDENCE_EXPOSED")
        self.refuse(T.FakeProbe(self.p, mask=self.p.gov["evidence_mask"][:1]), "CAPSULE_EVIDENCE_EXPOSED")

    def test_a_mask_that_also_hides_the_workers_own_evidence_refuses(self):
        self.refuse(T.FakeProbe(self.p, worker_mask=self.p.gov["evidence_mask"]), "CAPSULE_EVIDENCE_MASKED_FOR_WORKER")

    def test_a_writable_library_or_runtime_mount_refuses(self):
        self.refuse(T.FakeProbe(self.p, readonly=[self.cap["pins"]["runtime_root"]]), "LIBRARY_MOUNT_NOT_READONLY")
        self.refuse(T.FakeProbe(self.p, readonly=[self.p.gov["library"]["canonical_root"]]), "RUNTIME_MOUNT_NOT_READONLY")

    def test_a_read_write_filesystem_under_a_read_only_mount_entry_still_refuses(self):
        probe = T.FakeProbe(self.p); probe.statvfs_flag = lambda path: 0
        self.refuse(probe, "LIBRARY_MOUNT_NOT_READONLY")

    def test_the_attested_namespaces_must_be_the_live_ones(self):
        for field in ("user_ns", "pid_ns", "net_ns", "worker_mnt_ns", "resolve_mnt_ns"):
            p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"])
            p.attest(**{field: "other:[9]"})
            with self.assertRaises(rw.OpError, msg=field) as cm:
                rw.attest_isolated_session(T.FakeProbe(p), p.gov, p.prov, p.att)
            self.assertIn(cm.exception.detail["reason"], ("SESSION_NOT_ATTESTED", "CAPSULE_EVIDENCE_EXPOSED", "RUNTIME_ATTESTATION_INVALID"), field)

    def test_an_attestation_that_claims_an_unconfined_child_is_refused_before_any_process_is_read(self):
        for over, reason in (({"resolve_seccomp": 0}, "CAPSULE_CONFINEMENT_MISSING"),
                             ({"resolve_no_new_privs": 0}, "CAPSULE_CONFINEMENT_MISSING"),
                             ({"seccomp_filter_sha256": "0" * 64}, "CAPSULE_CONFINEMENT_MISSING"),
                             ({"resolve_seccomp_filters": 3}, "CAPSULE_CONFINEMENT_MISSING"),
                             ({"capsule_uid": 1000}, "CAPSULE_IDENTITY_MISMATCH"),
                             ({"evidence_mask": []}, "CAPSULE_EVIDENCE_EXPOSED"),
                             ({"host_primitive": dict(self.cap["pins"], capsule_uid=7)}, "HOST_PRIMITIVE_MISMATCH"),
                             ({"execution_environment": "ISOLATED_SESSION_V1"}, "RUNTIME_ATTESTATION_INVALID")):
            p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"]); p.attest(**over)
            with self.assertRaises(rw.OpError, msg=str(over)) as cm:
                rw.load_runtime_attestation(p.att_path, p.att_sha, p.gov, p.prov, p.session_sha, p.pol_sha,
                                            p.gov["authority_sha256"], T.WSHA)
            self.assertEqual(cm.exception.detail["reason"], reason, over)

    def test_the_sealed_executable_must_be_the_frozen_runtime_binary(self):
        gov = json.loads(json.dumps(self.p.gov))
        gov["resolve_binary"]["realpath"] = "/opt/resolve/bin/resolve"
        with self.assertRaises(rw.OpError) as cm:
            rw.attest_capsule_process(T.FakeProbe(self.p), gov, self.p.prov, self.p.att, T.FakeProbe(self.p).resolve_pids[0])
        self.assertEqual(cm.exception.detail["reason"], "SESSION_EXECUTABLE_MISMATCH")


class Governance(unittest.TestCase):
    """The capsule is governed, not configured: the accepted authority names it, the compiler transcribes it, the seal carries it."""
    def setUp(self):
        self.cap = T.synthetic_capsule(); self.fx = T.Fixture()

    def c(self, **kw):
        src = T.record(self.fx.lib(), [T.P_A1], capsule=self.cap["pins"], **kw)
        return comp.compile_record(json.dumps(src).encode(), T.WSHA, boundary=self.cap["pins"])

    def test_the_only_authorizable_environment_is_the_dedicated_capsule(self):
        self.assertEqual(self.c()["execution_environment"], "DEDICATED_CAPSULE_V1")
        for bad in ("ISOLATED_SESSION_V1", "DIRECT", "", None):
            with self.assertRaises(comp.PolicyError, msg=str(bad)): self.c(execution_environment=bad)

    def test_the_control_operation_is_exactly_the_governed_stop(self):
        self.assertEqual(self.c()["control_operations"], ["session_stop"])
        for bad in ([], ["session_stop", "quit"], ["kill"], ["health"]):
            with self.assertRaises(comp.PolicyError, msg=str(bad)): self.c(control=bad)

    def test_the_nine_read_operations_are_unchanged_by_the_capsule(self):
        self.assertEqual(sorted(self.c()["operations"]), sorted(rw.READ_ONLY_OPS))
        self.assertEqual(len(rw.READ_ONLY_OPS), 9)
        self.assertNotIn("session_stop", rw.READ_ONLY_OPS)
        self.assertEqual(rw.CONTROL_OPS, ("session_stop",))

    def test_a_policy_or_seal_carrying_a_different_boundary_than_the_authority_refuses(self):
        p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"])
        pol = json.load(open(p.pol_path))
        pol["host_primitive"] = dict(pol["host_primitive"], capsule_uid=1000)
        pol["policy_sha256"] = gen.canonical_sha256({k: v for k, v in pol.items() if k != "policy_sha256"})
        raw = json.dumps(pol, sort_keys=True, separators=(",", ":")).encode()
        open(p.pol_path, "wb").write(raw)
        with self.assertRaises(rw.OpError) as cm:
            rw.load_production_policy(p.pol_path, rw.sha(raw), p.src_path, T.HOST, T.WSHA, self.cap["pins"])
        self.assertEqual(cm.exception.detail["reason"], "HOST_PRIMITIVE_MISMATCH")

    def test_the_seal_binds_the_evidence_mask_and_the_confinement(self):
        p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"])
        self.assertEqual(sorted(p.gov["evidence_mask"]), sorted(self.cap["mask"]))
        conf = p.gov["confinement"]
        self.assertEqual(conf["seccomp_filter_sha256"], T.SECCOMP_SHA)
        self.assertEqual(conf["seccomp_filters"], 1); self.assertEqual(conf["no_new_privs"], 1)
        for call in ("mount", "umount2", "unshare", "setns", "pivot_root", "ptrace", "process_vm_readv", "process_vm_writev"):
            self.assertIn(call, conf["denied_syscalls"])
        self.assertEqual(conf["clone_namespace_flags_denied"], confine_mod.NS_FLAGS)

    def test_a_mask_that_would_hide_the_library_runtime_or_profile_is_refused_at_seal_time(self):
        for bad in (self.fx.A, self.cap["pins"]["runtime_root"], "/"):
            with self.assertRaises(gen.GenerateError, msg=bad):
                self.fx.profile(capsule=self.cap, mask=self.cap["mask"] + [bad])
        with self.assertRaises(gen.GenerateError): self.fx.profile(capsule=self.cap, mask=[])

    def test_the_generator_refuses_an_executable_that_is_not_the_frozen_runtime_binary(self):
        other = T.fake_binary()
        with self.assertRaises(gen.GenerateError) as cm:
            self.fx.profile(capsule=self.cap, mask=self.cap["mask"], resolve_binary=other)
        self.assertIn("frozen capsule runtime binary", str(cm.exception))

    def test_the_shipped_candidate_record_names_the_real_approved_capsule(self):
        path = os.path.join(os.path.dirname(ROOT), "docs", "resolve-integration", "production-read",
                            "PRODUCTION-READ-AUTHORITY-v1.candidate.json")
        rec = json.load(open(path))
        self.assertEqual(rec["execution_environment"], "DEDICATED_CAPSULE_V1")
        self.assertEqual(rec["host_primitive"], rw.CAPSULE_PINS)
        self.assertEqual(rec["control_operations"], ["session_stop"])
        self.assertEqual(rec["caller_identity"]["hmac_key_id"], "0" * 16, "the shipped record must name no real key")
        self.assertEqual(rec["worker_identity"]["worker_sha256"], T.WSHA)
        self.assertEqual(rec["status"], "CANDIDATE_FOR_INDEPENDENT_REVIEW")


class GovernedStop(unittest.TestCase):
    """The operator's only way to end a capsule session — and it is not a signal."""
    def setUp(self):
        self.cap = T.synthetic_capsule(); self.fx = T.Fixture()
        self.p = self.fx.profile(capsule=self.cap, mask=self.cap["mask"]); self.envs = []

    def tearDown(self):
        for e in self.envs:
            try: e.close()
            except Exception: pass

    def env(self, **kw):
        e = T.Env(self.fx.st(), self.p, **kw); self.envs.append(e)
        e.signals, e.exits = [], []
        e.worker.stop_signal = lambda pid, sig: (e.signals.append((pid, sig)), setattr(e.probe, "gone", True))[0]
        e.worker.stop_exit = lambda: e.exits.append(True)
        return e

    def stop(self, e, **over):
        env = {"protocol": "vrc.v1", "op": "session_stop", "target_host": T.HOST, "caller": "test", "deadline_ms": 20000}
        env.update(over)
        return e.raw(env)

    def test_the_governed_stop_ends_the_attested_session_and_signals_nothing_else(self):
        e = self.env()
        out = self.stop(e)
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["result"]["stopped"], True)
        self.assertEqual(out["result"]["signal"], "SIGKILL")
        self.assertEqual(out["result"]["resolve_pid"], e.probe.resolve_pids[0])
        self.assertTrue(out["result"]["resolve_exited"])
        self.assertEqual(e.signals, [(e.probe.resolve_pids[0], 9)], "exactly one signal, to exactly the attested pid")
        self.assertEqual(e.exits, [True], "the worker exits, and the capsule init collapses the capsule with it")

    def test_the_stop_is_journaled_as_an_authorization_decision(self):
        e = self.env(); self.stop(e)
        stopped = [j for j in e.journal() if j.get("event") == "SESSION_STOPPED"]
        self.assertEqual(len(stopped), 1, "exactly one stop record")
        rec = stopped[0]
        self.assertEqual(rec["signal"], "SIGKILL"); self.assertTrue(rec["resolve_exited"])
        self.assertEqual(rec["authorization"]["decision"], "ALLOWED")
        self.assertEqual(rec["authorization"]["stage"], "session_stop")
        self.assertEqual(rec["authorization"]["control_op"], "session_stop")
        self.assertEqual(rec["authorization"]["execution_environment"], "DEDICATED_CAPSULE_V1")
        op = e.last_op()
        self.assertEqual(op["op"], "session_stop"); self.assertTrue(op["ok"])

    def test_the_stop_takes_no_parameters_and_can_name_no_process(self):
        for params in ({"pid": 1}, {"signal": "SIGTERM"}, {"resolve_pid": 9001}, {"any": "thing"}):
            e = self.env()
            out = self.stop(e, params=params)
            self.assertFalse(out["ok"], params)
            self.assertEqual(out["error"]["code"], "UNSUPPORTED_OPERATION")
            self.assertEqual(out["error"]["detail"]["reason"], "GOVERNED_STOP_PARAMETERS_REFUSED")
            self.assertEqual(e.signals, [], "a parameterised stop must never signal anything")
        src = open(os.path.join(ROOT, "worker", "resolve_worker.py"), encoding="utf-8").read()
        body = src[src.index("def session_stop"):src.index("def _snapshot_for")]
        self.assertNotIn("params.get", body); self.assertNotIn("SIGTERM", body)
        self.assertIn('self.stop_signal(pid, signal.SIGKILL)', body)

    def test_a_stop_is_gated_by_the_whole_production_chain(self):
        e = self.env(probe=T.FakeProbe(self.p, resolve_pids=()))
        out = self.stop(e)
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["detail"]["reason"], "SESSION_NOT_RUNNING")
        self.assertEqual(e.signals, [], "an unattestable session is never signalled")
        self.assertEqual(e.authz()["decision"], "DENIED"); self.assertEqual(e.authz()["stage"], "session")

    def test_a_stop_is_refused_when_the_capsule_confinement_is_missing(self):
        status = {"NoNewPrivs": 0, "Seccomp": 2, "Seccomp_filters": 1, "CapBnd": 0, "CapEff": 0, "CapPrm": 0, "CapInh": 0, "CapAmb": 0}
        e = self.env(probe=T.FakeProbe(self.p, status=status))
        out = self.stop(e)
        self.assertFalse(out["ok"]); self.assertEqual(out["error"]["detail"]["reason"], "CAPSULE_CONFINEMENT_MISSING")
        self.assertEqual(e.signals, [])

    def test_nothing_is_served_after_a_stop(self):
        e = self.env(); self.stop(e)
        for op in ("health", "identify", "get_project_settings", "session_stop"):
            out = e.raw({"protocol": "vrc.v1", "op": op, "target_host": T.HOST, "caller": "test", "deadline_ms": 20000})
            self.assertFalse(out["ok"], op)
            self.assertEqual(out["error"]["detail"]["reason"], "SESSION_STOPPED", op)
        self.assertEqual(len(e.signals), 1, "a second stop must not signal again")

    def test_the_stop_is_not_available_in_qualification_mode(self):
        e = T.Env(self.fx.st(), self.p, mode="QUALIFICATION_READ", require_library=None); self.envs.append(e)
        out = e.raw({"protocol": "vrc.v1", "op": "session_stop", "target_host": T.HOST, "caller": "test", "deadline_ms": 20000})
        self.assertFalse(out["ok"])
        self.assertEqual(out["error"]["code"], "UNSUPPORTED_OPERATION")

    def test_the_stop_never_touches_the_resolve_api(self):
        handle = _CountingApi()
        e = self.env(api=handle)
        self.stop(e)
        self.assertEqual(handle.attaches, 0, "the governed stop must never attach to Resolve")

    def test_the_accepted_facade_does_not_expose_the_stop(self):
        facade = os.environ.get("VRC_FACADE_PLUGIN", os.path.expanduser("~/resolve-hermes/plugins/vidtoolz-resolve-readonly"))
        hits = []
        for dirpath, dirnames, filenames in os.walk(facade):
            dirnames[:] = [d for d in dirnames if d != "__pycache__"]
            for n in filenames:
                if n.endswith(".py") and "session_stop" in open(os.path.join(dirpath, n), encoding="utf-8", errors="replace").read():
                    hits.append(os.path.join(dirpath, n))
        self.assertEqual(hits, [], "the accepted facade must stay byte-identical and expose only the nine reads")

    def test_the_stop_client_signs_with_the_same_key_and_names_no_process(self):
        tool = open(os.path.join(ROOT, "tools", "session_stop.py"), encoding="utf-8").read()
        self.assertIn('"op": "session_stop"', tool)
        self.assertNotIn("os.kill", tool); self.assertNotIn("SIGKILL", tool.split('"""')[2])
        self.assertIn("hmac.new", tool)


class _CountingApi:
    attaches = 0
    def scriptapp(self, name):
        _CountingApi.attaches += 1
        raise AssertionError("the governed stop must never attach to Resolve")


def tearDownModule():
    for d in T.TMP: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
