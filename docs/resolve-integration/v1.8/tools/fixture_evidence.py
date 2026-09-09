"""Fixture evidence minting shared by build_v1_6.py and validate_v1_6.py (TOOL, not authority).
Mints content-addressed, envelope-bound evidence records for a given (manifest sha, capability matrix digest) so the validator
can prove that attachment derivation binds to the exact reviewed manifest and that capability qualification binds to the exact
active matrix content. v1.6: capability evidence is RAW_CAPABILITY_CAPTURE produced by the REFERENCE capture shim against fake
in-process receivers (no Resolve); REVIEW_DECISION / DERIVED_CAPABILITY_RESULT / REFREEZE_RECORD bind exact digests; GUARD_SNAPSHOT
carries the whole guard object + method_provenance; IDENTITY_*_OBSERVATION records carry pass lists of raw capture digests."""
import copy
import hashlib
import os
import sys
import time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import authority_lib as L  # noqa: E402
import capture_shim_reference as SHIM  # noqa: E402

HOST = "vidnux"
PRODUCT = "DaVinci Resolve Studio"
VER = "21.1.0.0014"
BUILD = 14
LIB = "VIDTOOLZ Resolve Qualification v1"
UU = "7e11aa60-fe44-4f3e-aa35-515e9a0d30ca"
UU2 = "0b3c9d2e-1111-4222-8333-444455556666"
ROOT = "/home/vidtoolz/resolve-qualification-library-v1"
PFX = "VIDTOOLZ_RESOLVE_QUAL_V1_"
PROJ = PFX + "FIXTURE"
TL = "VIDTOOLZ__fixture__r1"
S_CUR = "sess-2026-09-08-0001"
S_OLD = "sess-2026-09-08-0000"
EVALUATED_AT = "2026-09-08T12:00:00Z"
PLACEHOLDER_MANIFEST = hashlib.sha256(b"VIDTOOLZ-FIXTURE-MANIFEST-PLACEHOLDER-v1.6").hexdigest()
BIN_SHA = "124caa502547f85a2e17ad6a59269918ae561c0f82d701b9fc4e7f42127ffee7"
PROBE_ID = "probe-0001"
OPERATOR = "adapter-operator (M0A driver)"
REVIEWER = "Mikko (reviewer)"
REVIEWER2 = "Second Reviewer (independent)"
ENV = {"host_name": HOST, "product": PRODUCT, "resolve_version": VER, "build": BUILD, "library_name": LIB}

# ---- primitive spec authority (v1.6): explicit per-method expectation, all DOCUMENTED_HYPOTHESIS until a reviewed refreeze validates them
SRC = "DaVinci Resolve 21.1 scripting README / DaVinciResolveScript stub (documented return; not yet probe-validated on 21.1.0 build 14)"


def _spec(receiver, expected_type, arg_types=(), nullable=False, shape_rule="NONE", completeness="COMPLETE"):
    return {"receiver": receiver, "expected_type": expected_type, "arg_types": list(arg_types), "nullable": nullable, "shape_rule": shape_rule, "completeness": completeness, "expectation_status": "DOCUMENTED_HYPOTHESIS", "expectation_source": SRC}


PRIMITIVE_SPECS = {
    "GetVersionString": _spec("Resolve", "str", shape_rule="NON_EMPTY"), "GetProductName": _spec("Resolve", "str", shape_rule="NON_EMPTY"), "GetProjectManager": _spec("Resolve", "object"),
    "GetCurrentDatabase": _spec("ProjectManager", "dict", shape_rule="NON_EMPTY"), "GetProjectListInCurrentFolder": _spec("ProjectManager", "list"), "GetCurrentProject": _spec("ProjectManager", "object", nullable=True),
    "GetTimelineCount": _spec("Project", "int"), "GetTimelineByIndex": _spec("Project", "object", arg_types=("int",), nullable=True), "GetCurrentTimeline": _spec("Project", "object", nullable=True), "GetProjectLastModifiedTime": _spec("Project", "str", shape_rule="NON_EMPTY"),
    "Project.GetName": _spec("Project", "str", shape_rule="NON_EMPTY"), "Project.GetSettings": _spec("Project", "dict", shape_rule="NON_EMPTY"), "Project.GetUniqueId": _spec("Project", "str", shape_rule="NON_EMPTY"),
    "Folder.GetUniqueId": _spec("Folder", "str", shape_rule="NON_EMPTY"), "MediaPoolItem.GetUniqueId": _spec("MediaPoolItem", "str", shape_rule="NON_EMPTY"), "MediaPoolItem.GetMediaId": _spec("MediaPoolItem", "str", shape_rule="NON_EMPTY"),
    "GetTrackCount": _spec("Timeline", "int", arg_types=("str",)), "GetItemListInTrack": _spec("Timeline", "list", arg_types=("str", "int")), "GetTrackName": _spec("Timeline", "str", arg_types=("str", "int"), shape_rule="NON_EMPTY"),
    "GetStartFrame": _spec("Timeline", "int"), "GetEndFrame": _spec("Timeline", "int"), "GetStartTimecode": _spec("Timeline", "str", shape_rule="NON_EMPTY"),
    "GetIsTrackLocked": _spec("Timeline", "bool", arg_types=("str", "int")), "GetIsTrackEnabled": _spec("Timeline", "bool", arg_types=("str", "int")),
    "GetMarkers": _spec("Timeline", "dict"), "GetMarkerByCustomData": _spec("Timeline", "dict", arg_types=("str",)),
    "Timeline.GetName": _spec("Timeline", "str", shape_rule="NON_EMPTY"), "Timeline.GetSettings": _spec("Timeline", "dict", shape_rule="NON_EMPTY"), "Timeline.GetUniqueId": _spec("Timeline", "str", shape_rule="NON_EMPTY"),
    "TimelineItem.GetUniqueId": _spec("TimelineItem", "str", shape_rule="NON_EMPTY"), "TimelineItem.GetName": _spec("TimelineItem", "str", shape_rule="NON_EMPTY"),
    "GetStart": _spec("TimelineItem", "int"), "GetEnd": _spec("TimelineItem", "int"), "GetDuration": _spec("TimelineItem", "int"),
    "GetStart(True)": _spec("TimelineItem", "float", arg_types=("bool",)), "GetEnd(True)": _spec("TimelineItem", "float", arg_types=("bool",)), "GetDuration(True)": _spec("TimelineItem", "float", arg_types=("bool",)),
    "GetLeftOffset(True)": _spec("TimelineItem", "float", arg_types=("bool",)), "GetRightOffset(True)": _spec("TimelineItem", "float", arg_types=("bool",)),
    "GetSourceStartFrame": _spec("TimelineItem", "int"), "GetSourceEndFrame": _spec("TimelineItem", "int"), "GetSourceStartTime": _spec("TimelineItem", "float"), "GetSourceEndTime": _spec("TimelineItem", "float"),
    "GetClipEnabled": _spec("TimelineItem", "bool"), "GetMediaPoolItem": _spec("TimelineItem", "object", nullable=True), "GetClipProperty": _spec("TimelineItem", "dict", shape_rule="NON_EMPTY"), "TimelineItem.GetProperties": _spec("TimelineItem", "dict", shape_rule="NON_EMPTY"),
}
assert len(PRIMITIVE_SPECS) == 47, len(PRIMITIVE_SPECS)


ARG_SAMPLE = {"str": {"GetMarkerByCustomData": "vidtoolz:resolve:binding:v1:epoch-fixture-1:b-001:o-1"}, "int": {}, "bool": {}, "float": {}}
ARG_DEFAULT = {"str": "video", "int": 1, "bool": True, "float": 1.0}


def sample_args(method):
    """Canonical argument values for the declared arg_types of a primitive (the documented call shape)."""
    return [ARG_SAMPLE[a].get(method, ARG_DEFAULT[a]) for a in PRIMITIVE_SPECS[method]["arg_types"]]


def receiver_of(method):
    return PRIMITIVE_SPECS[method]["receiver"] if method in PRIMITIVE_SPECS else ("TimelineItem" if "." not in method else method.split(".", 1)[0])


def expected_type_of(method):
    return PRIMITIVE_SPECS[method]["expected_type"] if method in PRIMITIVE_SPECS else "object"


# ---- fake receivers (in-process Python objects; no Resolve). Class-level methods only (the shim refuses instance-level overrides).
class FakeObj:
    def __init__(self, uid="obj-1"):
        self._uid = uid

    def __repr__(self):
        return f"<Fake {type(self).__name__} {self._uid}>"


OK_VALUES = {
    "GetVersionString": lambda s: VER, "GetProductName": lambda s: PRODUCT, "GetProjectManager": lambda s: FakeObj("pm"),
    "GetCurrentDatabase": lambda s: {"DbType": "Disk", "DbName": LIB}, "GetProjectListInCurrentFolder": lambda s: [PROJ], "GetCurrentProject": lambda s: FakeObj("proj"),
    "GetTimelineCount": lambda s: 1, "GetTimelineByIndex": lambda s, i: FakeObj("tl"), "GetCurrentTimeline": lambda s: FakeObj("tl"), "GetProjectLastModifiedTime": lambda s: "2026-09-08 11:50:00",
    "GetName": lambda s: {"Project": PROJ, "Timeline": TL, "TimelineItem": "still-001"}.get(type(s).__name__.replace("Fake", ""), "name"),
    "GetSettings": lambda s: {"useCustomSettings": "1", "timelineFrameRate": "30", "timelineResolutionWidth": "1080"}, "GetUniqueId": lambda s: s._uid,
    "GetMediaId": lambda s: "mid-" + s._uid, "GetTrackCount": lambda s, kind: 1, "GetItemListInTrack": lambda s, kind, i: [FakeTimelineItem("it-1"), FakeTimelineItem("it-2")], "GetTrackName": lambda s, kind, i: "V1",
    "GetStartFrame": lambda s: 108000, "GetEndFrame": lambda s: 114756, "GetStartTimecode": lambda s: "01:00:00:00", "GetIsTrackLocked": lambda s, kind, i: False, "GetIsTrackEnabled": lambda s, kind, i: True,
    "GetMarkers": lambda s: {108000: {"color": "Blue", "duration": 1, "name": "m", "note": "", "customData": "cd"}}, "GetMarkerByCustomData": lambda s, cd: {"color": "Blue", "duration": 1, "name": "m", "note": "", "customData": cd},
    "GetStart": lambda s, sub=False: 108000.0 if sub else 108000, "GetEnd": lambda s, sub=False: 108347.0 if sub else 108347, "GetDuration": lambda s, sub=False: 347.0 if sub else 347,
    "GetLeftOffset": lambda s, sub=False: 0.0 if sub else 0, "GetRightOffset": lambda s, sub=False: 0.0 if sub else 0,
    "GetSourceStartFrame": lambda s: 0, "GetSourceEndFrame": lambda s: 347, "GetSourceStartTime": lambda s: 0.0, "GetSourceEndTime": lambda s: 11.5666,
    "GetClipEnabled": lambda s: True, "GetMediaPoolItem": lambda s: FakeObj("mp-1"), "GetClipProperty": lambda s: {"Start": "108000", "End": "108347"}, "GetProperties": lambda s: {"ZoomX": 1.0, "Opacity": 100.0},
}
WRONG_TYPE_VALUES = {"str": 12345, "int": "not-an-int", "bool": "True", "float": "1.0", "list": {"not": "a list"}, "dict": ["not", "a", "dict"], "object": "not-an-object"}


def _cycle():
    x = []
    x.append(x)
    return x


def _deep():
    return {"a": {"b": {"c": {"d": {"e": 1}}}}}


def make_fake(behaviour):
    """behaviour: ok | raise | slow | none | wrong_type | cyclic | deep | empty | missing. Returns a dict receiver_class -> fake class."""
    classes = {}
    for cls_name in L.RECEIVER_CLASSES:
        ns = {}
        for method, spec in PRIMITIVE_SPECS.items():
            if spec["receiver"] != cls_name:
                continue
            attr = SHIM.parse_call(method)[0]
            fn = OK_VALUES[attr]
            et = spec["expected_type"]
            if behaviour == "ok":
                ns[attr] = fn
            elif behaviour == "raise":
                ns[attr] = (lambda *a, **k: (_ for _ in ()).throw(RuntimeError("getter crashed")))
            elif behaviour == "slow":
                ns[attr] = (lambda *a, **k: time.sleep(0.4) or 1)
            elif behaviour == "none":
                ns[attr] = (lambda *a, **k: None)
            elif behaviour == "wrong_type":
                ns[attr] = (lambda *a, _v=WRONG_TYPE_VALUES[et], **k: _v)
            elif behaviour == "cyclic":
                ns[attr] = (lambda *a, **k: _cycle())
            elif behaviour == "deep":
                ns[attr] = (lambda *a, **k: _deep())
            elif behaviour == "empty":
                ns[attr] = (lambda *a, _e={"str": "", "list": [], "dict": {}, "int": 0, "bool": False, "float": 0.0, "object": FakeObj("x")}[et], **k: _e)
            elif behaviour == "missing":
                continue
        ns["SetName"] = lambda s, n: True
        ns["AppendToTimeline"] = lambda s, x: True
        ns["DeleteClips"] = lambda s, x: True
        classes[cls_name] = type("Fake" + cls_name, (FakeObj,), ns)
    return classes


class FakeTimelineItem(FakeObj):
    pass


FAKES = {b: make_fake(b) for b in ("ok", "raise", "slow", "none", "wrong_type", "cyclic", "deep", "empty", "missing")}
PATHS = {"Resolve": "Resolve", "ProjectManager": "Resolve->GetProjectManager()", "Project": "Resolve->GetProjectManager()->GetCurrentProject()", "MediaPool": "...->GetMediaPool()", "Folder": "...->GetMediaPool()->GetRootFolder()", "Timeline": "...->GetCurrentProject()->GetTimelineByIndex(1)", "TimelineItem": "...->GetTimelineByIndex(1)->GetItemListInTrack('video',1)[0]", "MediaPoolItem": "...->GetItemListInTrack('video',1)[0]->GetMediaPoolItem()"}
UIDS = {"Project": "proj-fixture-0001", "Timeline": "tl-fixture-0001", "TimelineItem": "it-1", "MediaPoolItem": "mp-1", "Folder": "folder-root", "Resolve": "resolve", "ProjectManager": "pm", "MediaPool": "mediapool"}


def ts(minutes_before=0, base=EVALUATED_AT):
    from datetime import timedelta
    t = L.parse_ts(base) - timedelta(minutes=minutes_before)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def rp_probe_specs(rp):
    return L.probe_spec_index(rp)


class Mint:
    def __init__(self, manifest_sha, caps_sha, authority_version=L.AUTHORITY_VERSION, rp=None):
        self.M, self.C, self.AV, self.rp = manifest_sha, caps_sha, authority_version, rp
        self.prov = self.R("PROVISIONING_RECORD", level="LIBRARY", library_kind="Disk", root_path=ROOT, instance_uuid=UU, provisioned_by="Mikko (operator)")
        self.prov_uu2 = self.R("PROVISIONING_RECORD", level="LIBRARY", env={"library_uuid": UU2}, library_kind="Disk", root_path=ROOT, instance_uuid=UU2, provisioned_by="Mikko (operator)")
        self._ctx = {}

    def env(self, level, **over):
        e = {"authority_version": self.AV, "manifest_sha256": self.M, "host_name": HOST, "product": PRODUCT, "resolve_version": VER, "build": BUILD, "library_name": LIB, "library_uuid": UU, "library_root": ROOT, "session_id": None, "provisioning_id": None, "project_name": None, "project_unique_id": None, "timeline_name": None, "timeline_unique_id": None, "target_epoch": None, "sequence": 0, "captured_at": ts(30), "record_type_version": L.RECORD_TYPE_VERSION}
        if level == "BUNDLE":
            e.update(library_name=None, library_uuid=None, library_root=None, product=None, resolve_version=None, build=None)
        if level == "SESSION":
            e.update(session_id=S_CUR, provisioning_id=getattr(self, "prov", {}).get("record_id"))
        e.update(over)
        return e

    def R(self, rtype, level=None, env=None, **body):
        level = level or L.ENVELOPE_LEVEL[rtype]
        rec = {"record_type": rtype, "envelope": self.env(level, **(env or {})), "recorded_at": ts(30)}
        rec.update(body)
        return L.make_record(rec)

    # ---- bundle / library / session building blocks (unchanged law)
    def bundle(self, **kw):
        body = {"authority_version": self.AV, "manifest_sha256": self.M, "verifier": "Codex (independent)", "prepared_by": "Claude Code (Fable 5.1)", "historical": False}
        env = kw.pop("env", {})
        body.update(kw)
        return self.R("BUNDLE_VERIFICATION", env=env, **body)

    def launch(self, session=S_CUR, **kw):
        body = {"recipe_sha256": "a" * 64, "resolve_version": VER, "resolve_binary_sha256": BIN_SHA, "external_scripting_preference": "Local"}
        env = {"session_id": session, "sequence": 0, "captured_at": ts(59)}
        env.update(kw.pop("env", {}))
        body.update(kw)
        return self.R("LAUNCH_RECIPE", env=env, **body)

    def conn(self, session=S_CUR, seq=1, minutes_before=20, **kw):
        body = {"db_type": "Disk", "db_name": LIB, "product": PRODUCT, "resolve_version": VER, "root_path": ROOT, "instance_uuid": UU}
        env = {"session_id": session, "sequence": seq, "captured_at": ts(minutes_before)}
        env.update(kw.pop("env", {}))
        body.update(kw)
        return self.R("CONNECTION_OBSERVATION", env=env, **body)

    def conn_eka(self, session=S_CUR, seq=1, minutes_before=20, **kw):
        return self.conn(session, seq, minutes_before, db_type="PostgreSQL", db_name="EKA", root_path=None, instance_uuid=None, **kw)

    def pb(self, project=PROJ, uid="proj-fixture-0001", status="OBSERVED", session=S_CUR, seq=1, minutes_before=15, **kw):
        env = {"session_id": session, "sequence": seq, "captured_at": ts(minutes_before), "project_name": project, "project_unique_id": uid}
        env.update(kw.pop("env", {}))
        return self.R("PROJECT_BINDING_OBSERVATION", env=env, project_name=project, project_unique_id=uid, project_unique_id_status=status, **kw)

    def tb(self, project=PROJ, timeline=TL, uid="tl-fixture-0001", status="OBSERVED", project_uid="proj-fixture-0001", session=S_CUR, seq=1, minutes_before=14, **kw):
        env = {"session_id": session, "sequence": seq, "captured_at": ts(minutes_before), "project_name": project, "project_unique_id": project_uid, "timeline_name": timeline, "timeline_unique_id": uid}
        env.update(kw.pop("env", {}))
        return self.R("TIMELINE_BINDING_OBSERVATION", env=env, project_name=project, timeline_name=timeline, timeline_unique_id=uid, timeline_unique_id_status=status, project_unique_id=project_uid, **kw)

    def roj(self, session=S_CUR):
        return self.R("READ_ONLY_JOURNAL", env={"session_id": session, "sequence": 0, "captured_at": ts(58)}, journal_path_sha256="d" * 64)

    def excl(self, session=S_CUR, seq=1):
        return self.R("EXCLUSIVE_SESSION_ATTESTATION", env={"session_id": session, "sequence": seq, "captured_at": ts(19)}, attested_by="adapter preflight (single resolve pid)", pid_observed=4242)

    def opp(self, project="Mikko human scratch"):
        return self.R("OPERATOR_PROVISIONED_PROJECT", project_name=project, provisioned_by="Mikko (operator)")

    def exit_(self, milestone):
        return self.R("MILESTONE_EXIT", milestone=milestone, authority_version=self.AV, evidence_dir_sha256="e" * 64)

    def auth(self, authority_version=None):
        return self.R("M3_AUTHORIZATION", scope="SCRATCH_QUALIFICATION_LIBRARY", approver="Mikko", authority_version=authority_version or self.AV, library_name=LIB)

    def media(self):
        return self.R("MEDIA_CLASS_ATTESTATION", media_class="SYNTHETIC", media_sha256="1" * 64)

    def dest(self, project=PROJ, timeline=TL, uid="tl-fixture-0001", session=S_CUR):
        return self.R("DESTINATION_TIMELINE", env={"session_id": session, "sequence": 1, "captured_at": ts(13), "project_name": project, "timeline_name": timeline, "timeline_unique_id": uid}, project_name=project, timeline_name=timeline, timeline_unique_id=uid)

    def journal_prepared(self, transaction_id, plan_digest, project=PROJ, session=S_CUR):
        return self.R("JOURNAL_PREPARED", env={"session_id": session, "sequence": 3, "captured_at": ts(9), "project_name": project}, transaction_id=transaction_id, plan_digest=plan_digest, journal_path_sha256="d" * 64)

    def plan_validation(self, plan_digest, result="PASS", h0_guard_digest=None, h0_snapshot_sha256=None, validator=L.PLAN_VALIDATOR_ID, stages=("evidence_authority", "capability_provenance", "schema", "s0", "plan")):
        return self.R("PLAN_VALIDATION", plan_digest=plan_digest, result=result, authority_version=self.AV, validator=validator, h0_guard_digest=h0_guard_digest, h0_snapshot_sha256=h0_snapshot_sha256, stages_completed=list(stages))

    # ---- v1.6 GUARD_SNAPSHOT: the record carries the guard object and the provenance map so the evaluator can recompute both digests
    def guard(self, snap, project=PROJ, timeline=TL, seq=2, session=S_CUR, guard_override=None, **kw):
        env = {"session_id": session, "sequence": seq, "captured_at": ts(10), "project_name": project, "timeline_name": timeline}
        env.update(kw.pop("env", {}))
        g = guard_override if guard_override is not None else L.guard_object(snap)
        return self.R("GUARD_SNAPSHOT", env=env, guard_digest=snap["guard_digest"], payload_sha256=snap["payload_sha256"], snapshot_object_sha256=L.snapshot_object_digest(snap), project_name=project, timeline_name=timeline, guard=g, method_provenance=copy.deepcopy((snap.get("collection") or {}).get("method_provenance") or {}), authority_version=self.AV, **kw)

    # ---- v1.6 raw capability captures via the reference shim against fake receivers
    def ctx(self, session=S_CUR, probe_id=PROBE_ID, build=BUILD, resolve_version=VER, minutes_before=25, operator=OPERATOR, manifest=None, authority=None):
        key = (session, probe_id, build, resolve_version, operator, manifest, authority)
        if key not in self._ctx:
            clock = iter(ts(minutes_before, EVALUATED_AT) for _ in range(10 ** 6)).__next__
            self._ctx[key] = SHIM.ShimContext(probe_id, session, authority or self.AV, manifest or self.M, HOST, PRODUCT, resolve_version, build, UU, ROOT, operator, clock=clock)
        return self._ctx[key]

    def capture(self, method, behaviour="ok", session=S_CUR, receiver_class=None, allow=None, args=None, encoder_limits=None, timeout_s=5.0, ctx=None, probe_id=PROBE_ID, **ctxkw):
        """A RAW capture object (not yet a record) of `method` against the fake receiver of the given behaviour. Arguments default to the
        canonical sample for the primitive's declared arg_types (the probe always calls the documented argument shape)."""
        c = ctx or self.ctx(session=session, probe_id=probe_id, **ctxkw)
        rc = PRIMITIVE_SPECS[method]["receiver"] if method in PRIMITIVE_SPECS else receiver_of(method)
        if args is None and method in PRIMITIVE_SPECS and not SHIM.parse_call(method)[1]:
            args = sample_args(method)
        fakes = FAKES[behaviour]
        recv = None if behaviour == "transport" else fakes[rc](UIDS.get(rc, "x"))
        allowlist = list(PRIMITIVE_SPECS) if allow is None else allow
        return SHIM.capture(c, recv, receiver_class or rc, PATHS[rc], method, allowlist, args=args, timeout_s=timeout_s, encoder_limits=encoder_limits)

    def raw_rec(self, capture, session=None, seq=5, build=None, resolve_version=None):
        sid = session or capture["session_id"]
        env = {"session_id": sid, "sequence": seq, "captured_at": capture["captured_at"]}
        if build is not None:
            env["build"] = build
        if resolve_version is not None:
            env["resolve_version"] = resolve_version
        return self.R("RAW_CAPABILITY_CAPTURE", env=env, capture=capture, raw_capture_sha256=capture["raw_digest"], ingest_receipt=self.receipt(capture))

    def receipt(self, capture, frame=None):
        """The strict-parse receipt of the exact frame bytes this capture was ingested from (v1.7, C16-M2). Fixtures mint the
        canonical frame with the shim's own wire format, so a fixture record is byte-traceable to a frame exactly as an M0A
        record is. Deliberately malformed captures still get a coherent receipt, so the fixture fails for the defect it is
        testing and not merely for a missing receipt."""
        return L.raw_ingest_receipt(frame if frame is not None else SHIM.raw_frame_bytes(capture), capture)

    def derived_rec(self, capture, spec, derived_override=None):
        d = derived_override if derived_override is not None else L.derive_capability_result(capture, spec, ENV, {"authority_version": self.AV, "manifest_sha256": self.M})
        return self.R("DERIVED_CAPABILITY_RESULT", raw_capture_sha256=capture["raw_digest"], derived_result_sha256=d["derived_result_sha256"], derived=d)

    def review(self, capture, spec, decision="ACCEPT", reviewer=REVIEWER, rationale="raw capture inspected; derived result agrees with documented expectation", derived_sha=None, raw_sha=None, parser_version=None, parser_sha=None, spec_sha=None, method=None, receiver_class=None, probe_id=None, session_id=None, **over):
        d = L.derive_capability_result(capture, spec, ENV, {"authority_version": self.AV, "manifest_sha256": self.M})
        return self.R("REVIEW_DECISION", raw_capture_sha256=raw_sha or capture["raw_digest"], derived_result_sha256=derived_sha or d["derived_result_sha256"], parser_version=parser_version or L.PARSER_VERSION, parser_sha256=parser_sha or L.parser_sha256(), primitive_spec_sha256=spec_sha or L.primitive_spec_digest(self.rp), method=method or capture["method"], receiver_class=receiver_class or capture["receiver"]["class"], probe_id=probe_id or capture["probe_id"], session_id=session_id or capture["session_id"], reviewer=reviewer, decision=decision, rationale=rationale, reviewed_at=ts(5), **over)

    def refz(self, caps_hyp, parent_sha, reviewed=True, authority_version=None, caps_sha=None, parser_version=None, parser_sha=None, spec_sha=None, probe_id=PROBE_ID, session=S_CUR, approver="Mikko", **over):
        rf = caps_hyp.get("refreeze") or {}
        body = {"kind": "M0_READ_REQUALIFICATION", "reviewed": reviewed, "manifest_sha256": self.M, "authority_version": authority_version or self.AV, "parent_capability_matrix_sha256": parent_sha, "capability_matrix_sha256": caps_sha or L.capability_matrix_digest(caps_hyp),
                "parser_version": parser_version or L.PARSER_VERSION, "parser_sha256": parser_sha or L.parser_sha256(), "primitive_spec_sha256": spec_sha or L.primitive_spec_digest(self.rp), "probe_id": probe_id, "session_id": session,
                "promoted_probe_ids": list(rf.get("promoted_probe_ids") or []), "promoted_raw_capture_sha256": list(rf.get("promoted_raw_capture_sha256") or []), "promoted_derived_result_sha256": list(rf.get("promoted_derived_result_sha256") or []), "promoted_review_decision_sha256": list(rf.get("promoted_review_decision_sha256") or []),
                "host_name": HOST, "product": PRODUCT, "resolve_version": VER, "build": BUILD, "approver": approver}
        body.update(over)
        return self.R("REFREEZE_RECORD", **body)

    def refz_legacy(self, caps_sha=None, reviewed=True, authority_version=None):
        """A refreeze record naming a matrix digest without promotions (used for write-ready state fixtures under the frozen matrix)."""
        return self.R("REFREEZE_RECORD", kind="M0_READ_REQUALIFICATION", reviewed=reviewed, manifest_sha256=self.M, authority_version=authority_version or self.AV, parent_capability_matrix_sha256="0" * 64, capability_matrix_sha256=caps_sha or self.C, parser_version=L.PARSER_VERSION, parser_sha256=L.parser_sha256(), primitive_spec_sha256=L.primitive_spec_digest(self.rp), probe_id=PROBE_ID, session_id=S_CUR, promoted_probe_ids=[], promoted_raw_capture_sha256=[], promoted_derived_result_sha256=[], promoted_review_decision_sha256=[], host_name=HOST, product=PRODUCT, resolve_version=VER, build=BUILD, approver="Mikko")

    def identity_obs(self, kind, passes, claims, method="TimelineItem.GetUniqueId", project=PROJ, timeline=TL, session=S_CUR, seq=6):
        env = {"session_id": session, "sequence": seq, "captured_at": ts(8), "project_name": project, "timeline_name": timeline}
        return self.R(kind, env=env, method=method, passes=[[c["raw_digest"] for c in p] for p in passes], claims=claims, project_name=project, timeline_name=timeline)


def ES(records, current_session=S_CUR, evaluated_at=EVALUATED_AT):
    return {"schema": "vidtoolz.resolveEvidenceSet.v1.8", "current_session_id": current_session, "evaluated_at": evaluated_at, "records": {r["record_id"]: r for r in records}}


def tamper(capture, **changes):
    """Modify a sealed capture WITHOUT re-sealing (raw_digest goes stale)."""
    c = copy.deepcopy(capture)
    c.update(changes)
    return c


def reseal(capture, **changes):
    """Modify a sealed capture and re-seal it (content-consistent but different facts)."""
    c = copy.deepcopy(capture)
    c.update(changes)
    return SHIM.seal(c)


def base_sets(m, probe_methods, caps_hyp, parent_caps_sha):
    """The evidence-set catalogue used by eligibility, attachment, capability, identity and freshness fixtures.
    Mutates caps_hyp: fills its refreeze block and QUALIFIED_READ evidence entries from the honest captures/reviews minted here."""
    specs = rp_probe_specs(m.rp)
    active = {"authority_version": m.AV, "manifest_sha256": m.M}
    prov, prov2 = m.prov, m.prov_uu2
    bundle, launch, roj = m.bundle(), m.launch(), m.roj()
    conn = m.conn(seq=2, minutes_before=10)
    pb, tb = m.pb(), m.tb()
    pb_human, pb_oper, opp = m.pb("PYSTY UHD", None, "UNAVAILABLE", seq=1), m.pb("Mikko human scratch", None, "UNAVAILABLE", seq=1), m.opp()
    core = [prov, bundle, launch, roj]
    attached = core + [conn, pb, tb, pb_human, pb_oper, opp]
    # honest captures (sorted methods -> deterministic sequences)
    caps_ok_c = {x: m.capture(x) for x in probe_methods}
    raws_ok = [m.raw_rec(caps_ok_c[x]) for x in probe_methods]
    deriveds_ok = {x: L.derive_capability_result(caps_ok_c[x], specs[x], ENV, active) for x in probe_methods}
    assert all(d["classification"] == "SUCCESS" for d in deriveds_ok.values()), {x: d["classification"] + ":" + ";".join(d["reasons"]) for x, d in deriveds_ok.items() if d["classification"] != "SUCCESS"}
    reviews_ok = {x: m.review(caps_ok_c[x], specs[x]) for x in probe_methods}
    # v1.7 (C16-B4): the stored DERIVED_CAPABILITY_RESULT is part of every chain. A chain that claims one and cannot resolve
    # it by digest is refused, so every fixture family below carries the derived artifacts its captures actually produce.
    der_ok = {x: m.derived_rec(caps_ok_c[x], specs[x]) for x in probe_methods}

    def der_of(cs, sp=None):
        return [m.derived_rec(cs[x], (sp or specs)[x]) for x in cs]
    # hypothetical successor matrix: fill refreeze block + evidence entries from the honest evidence
    caps_hyp["refreeze"] = {"kind": "M0_READ_REQUALIFICATION", "reviewed": True, "review_decision_ref": "HYPOTHETICAL review decisions (fixtures/evidence/attached-reviewed-evidence.json)", "parent_capability_matrix_sha256": parent_caps_sha, "parser_version": L.PARSER_VERSION, "parser_sha256": L.parser_sha256(), "primitive_spec_sha256": L.primitive_spec_digest(m.rp), "promoted_probe_ids": [PROBE_ID],
                            "promoted_raw_capture_sha256": sorted(caps_ok_c[x]["raw_digest"] for x in probe_methods), "promoted_derived_result_sha256": sorted(deriveds_ok[x]["derived_result_sha256"] for x in probe_methods), "promoted_review_decision_sha256": sorted(reviews_ok[x]["record_id"] for x in probe_methods), "note": "hypothetical"}
    RFB = L.refreeze_block_digest(caps_hyp)
    TSHIM = L.trusted_capture_shim()
    for r in caps_hyp["rows"]:
        if r["operation"].startswith("read:"):
            r["evidence_class"] = "QUALIFIED_READ"
            r.pop("probe_candidate", None)
            r["evidence_records"] = [{"host": HOST, "product": PRODUCT, "resolve_version": "21.1.0", "build": 14, "run_ref": "HYPOTHETICAL M0A probe run probe-0001", "method": x, "receiver_class": specs[x]["receiver"], "evidence_path": "/HYPOTHETICAL/RAW", "evidence_sha256": caps_ok_c[x]["raw_digest"], "version_match": True, "reviewed_refreeze_version": caps_hyp["version"], "probe_id": PROBE_ID, "session_id": caps_ok_c[x]["session_id"], "raw_capture_sha256": caps_ok_c[x]["raw_digest"], "derived_result_sha256": deriveds_ok[x]["derived_result_sha256"], "derived_record_sha256": der_ok[x]["record_id"], "review_decision_sha256": reviews_ok[x]["record_id"], "refreeze_block_sha256": RFB, "capture_shim_version": TSHIM["shim_version"], "capture_shim_sha256": TSHIM["shim_sha256"], "trusted_shim_sha256": TSHIM["trusted_shim_sha256"], "parser_version": L.PARSER_VERSION, "parser_sha256": L.parser_sha256(), "primitive_spec_sha256": L.primitive_spec_digest(m.rp), "result": None} for x in r["primitives"] if x in specs]
    hyp_sha = L.capability_matrix_digest(caps_hyp)
    refz_ok = m.refz(caps_hyp, parent_caps_sha)
    caps_ok = raws_ok + list(der_ok.values()) + list(reviews_ok.values()) + [refz_ok]
    caps_unrev = list(raws_ok) + list(der_ok.values())
    # ---- v1.6 capability attacks (raw-first): every set uses the SAME hypothetical matrix and refreeze shape; only the evidence differs
    def variant(behaviour, decision="ACCEPT", **capkw):
        cs = {x: m.capture(x, behaviour, **capkw) for x in probe_methods}
        recs = [m.raw_rec(cs[x]) for x in probe_methods] + der_of(cs) + [m.review(cs[x], specs[x], decision=decision) for x in probe_methods]
        return cs, recs
    _, caps_raised_accept = variant("raise")                       # raw RAISED + ACCEPT review  (F15-01 core)
    _, caps_failed = variant("raise", decision="REJECT")          # honest: raised + REJECT
    _, caps_none_accept = variant("none")
    _, caps_wrongtype_accept = variant("wrong_type")
    _, caps_missing_accept = variant("missing")
    _, caps_cyclic_accept = variant("cyclic")
    _, caps_deep_accept = variant("deep", encoder_limits={"depth_limit": 1})
    slow_c = {x: m.capture(x, "slow", timeout_s=0.05) for x in ("GetVersionString",)}
    caps_timeout_accept = [m.raw_rec(slow_c["GetVersionString"]), m.derived_rec(slow_c["GetVersionString"], specs["GetVersionString"]), m.review(slow_c["GetVersionString"], specs["GetVersionString"])] + [r for r in caps_ok if not (r["record_type"] in ("RAW_CAPABILITY_CAPTURE", "REVIEW_DECISION") and (r.get("capture") or r).get("method", r.get("method")) == "GetVersionString") and not (r["record_type"] == "DERIVED_CAPABILITY_RESULT" and r["raw_capture_sha256"] == caps_ok_c["GetVersionString"]["raw_digest"])]
    # raw failure + fake probe-authored parse/success block injected INTO the capture (the v1.5 defect shape)
    fake_parse = {"parse": {"parser": "probe", "succeeded": True, "error": None, "getter_exception": None, "observed_type": "str", "shape_ok": True}, "result": {"classification": "SUCCESS", "success": True, "code": None}}
    raised_c = {x: m.capture(x, "raise", probe_id="probe-0002") for x in probe_methods}
    fake_parsed_c = {x: reseal(raised_c[x], **fake_parse) for x in probe_methods}
    caps_raised_fake_parse = [m.raw_rec(fake_parsed_c[x]) for x in probe_methods] + der_of(fake_parsed_c) + [m.review(fake_parsed_c[x], specs[x]) for x in probe_methods] + [refz_ok]
    # wrong build (previous session); wrong receiver label; tampered raw; missing raw; review other raw; stale parser; stale spec; reviewer == operator; other session refreeze; forged derived cache; unlisted raw
    wb_c = {x: m.capture(x, session=S_OLD, build=7, resolve_version="21.0.3.0007") for x in probe_methods}
    caps_wrong_build = [m.raw_rec(wb_c[x], session=S_OLD, build=7, resolve_version="21.0.3.0007") for x in probe_methods] + der_of(wb_c) + [m.review(wb_c[x], specs[x]) for x in probe_methods] + [refz_ok]
    wr_c = {x: reseal(caps_ok_c[x], receiver=dict(caps_ok_c[x]["receiver"], **{"class": "Folder" if specs[x]["receiver"] != "Folder" else "Timeline"})) for x in probe_methods}
    caps_wrong_receiver = [m.raw_rec(wr_c[x]) for x in probe_methods] + der_of(wr_c) + [m.review(wr_c[x], specs[x], receiver_class=wr_c[x]["receiver"]["class"]) for x in probe_methods] + [refz_ok]
    tampered_c = {x: tamper(caps_ok_c[x], returned=dict(caps_ok_c[x].get("returned") or {"python_type": "str", "value": {"$t": "str", "v": "x"}}, python_type="tampered")) for x in probe_methods}
    caps_raw_tampered = [m.raw_rec(tampered_c[x]) for x in probe_methods] + list(der_ok.values()) + list(reviews_ok.values()) + [refz_ok]
    caps_no_raw = list(der_ok.values()) + list(reviews_ok.values()) + [refz_ok]
    D_OK = list(der_ok.values())
    caps_review_other_raw = raws_ok + D_OK + [m.review(caps_ok_c[x], specs[x], raw_sha=L.sha256_text("some other capture " + x)) for x in probe_methods] + [refz_ok]
    caps_review_stale_parser = raws_ok + D_OK + [m.review(caps_ok_c[x], specs[x], parser_version="vidtoolz.resolveProbeParser.v0", parser_sha=L.sha256_text("old parser")) for x in probe_methods] + [refz_ok]
    caps_review_stale_spec = raws_ok + D_OK + [m.review(caps_ok_c[x], specs[x], spec_sha=L.sha256_text("old spec")) for x in probe_methods] + [refz_ok]
    caps_reviewer_is_operator = raws_ok + D_OK + [m.review(caps_ok_c[x], specs[x], reviewer=OPERATOR) for x in probe_methods] + [refz_ok]
    caps_review_reject = raws_ok + D_OK + [m.review(caps_ok_c[x], specs[x], decision="REJECT", rationale="operator asked to reject") for x in probe_methods] + [refz_ok]
    caps_refreeze_stale_parser = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, parser_sha=L.sha256_text("old parser"))]
    caps_refreeze_stale_spec = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, spec_sha=L.sha256_text("old spec"))]
    caps_refreeze_other_session = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, session=S_OLD)]
    caps_refreeze_unreviewed = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, reviewed=False)]
    caps_refreeze_unlisted_raw = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, promoted_raw_capture_sha256=[])]
    caps_old_refreeze = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, caps_sha="0" * 64)]
    caps_old_authority = raws_ok + D_OK + list(reviews_ok.values()) + [m.refz(caps_hyp, parent_caps_sha, authority_version="1.5.0")]
    caps_no_refreeze = raws_ok + D_OK + list(reviews_ok.values())
    # ---- v1.7 chain-substitution families (C16-B4): each keeps a coherent matrix, refreeze and review and attacks ONE link
    caps_derived_missing = raws_ok + list(reviews_ok.values()) + [refz_ok]
    other_c = {x: m.capture(x, probe_id="probe-0004") for x in probe_methods}
    caps_derived_other_raw = raws_ok + [m.raw_rec(other_c[x]) for x in probe_methods] + der_of(other_c) + list(reviews_ok.values()) + [refz_ok]
    caps_duplicate_review = raws_ok + D_OK + list(reviews_ok.values()) + [m.review(caps_ok_c[x], specs[x], reviewer=REVIEWER2, rationale="a second, independent current review of the same evidence") for x in probe_methods] + [refz_ok]
    caps_superseded_review = raws_ok + D_OK + list(reviews_ok.values()) + [m.review(caps_ok_c[x], specs[x], reviewer=REVIEWER2, rationale="a second review that explicitly retires the first", supersedes=[reviews_ok[x]["record_id"]]) for x in probe_methods] + [refz_ok]
    caps_conflicting_reviews = raws_ok + D_OK + list(reviews_ok.values()) + [m.review(caps_ok_c[x], specs[x], decision="REJECT", reviewer=REVIEWER2, rationale="a conflicting current REJECT of the same raw capture", derived_sha=L.sha256_text("another derived " + x)) for x in probe_methods] + [refz_ok]
    caps_duplicate_refreeze = raws_ok + D_OK + list(reviews_ok.values()) + [refz_ok, m.refz(caps_hyp, parent_caps_sha, approver="Second Approver")]
    forged_d = {x: dict(L.derive_capability_result(raised_c[x], specs[x], ENV, active)) for x in probe_methods}
    for x, d in forged_d.items():
        d.update(classification="SUCCESS", family="SUCCESS", reasons=[])
        d["derived_result_sha256"] = L.digest({k: v for k, v in d.items() if k != "derived_result_sha256"}, L.DERIVED_DOMAIN)
    caps_derived_cache_forged = [m.raw_rec(raised_c[x]) for x in probe_methods] + [m.derived_rec(raised_c[x], specs[x], derived_override=forged_d[x]) for x in probe_methods] + [m.review(raised_c[x], specs[x], derived_sha=forged_d[x]["derived_result_sha256"]) for x in probe_methods] + [refz_ok]
    caps_derived_cache_honest = raws_ok + [m.derived_rec(caps_ok_c[x], specs[x]) for x in probe_methods] + list(reviews_ok.values()) + [refz_ok]
    caps_ok_minus_startframe = [r for r in caps_ok if not ((r["record_type"] == "RAW_CAPABILITY_CAPTURE" and r["capture"]["method"] == "GetStartFrame") or (r["record_type"] == "REVIEW_DECISION" and r["method"] == "GetStartFrame"))]
    # ---- identity observations (A/B/C) over three consecutive no-mutation passes of TimelineItem.GetUniqueId on three items
    ictx = m.ctx(probe_id="probe-0001")
    items = [FAKES["ok"]["TimelineItem"](u) for u in ("it-1", "it-2", "it-3")]
    passes = [[SHIM.capture(ictx, it, "TimelineItem", f"...->GetItemListInTrack('video',1)[{i}]", "TimelineItem.GetUniqueId", list(PRIMITIVE_SPECS)) for i, it in enumerate(items)] for _ in range(3)]
    claims = L.identity_claims(passes, specs["TimelineItem.GetUniqueId"], ENV, active)
    id_raws = [m.raw_rec(c, seq=7) for p in passes for c in p]
    id_uniq = m.identity_obs("IDENTITY_UNIQUENESS_OBSERVATION", passes, claims)
    id_stab = m.identity_obs("IDENTITY_STABILITY_OBSERVATION", passes, claims, seq=7)
    dup_items = [FAKES["ok"]["TimelineItem"](u) for u in ("it-1", "it-1", "it-3")]
    dctx = m.ctx(probe_id="probe-0003")
    dpasses = [[SHIM.capture(dctx, it, "TimelineItem", f"...->GetItemListInTrack('video',1)[{i}]", "TimelineItem.GetUniqueId", list(PRIMITIVE_SPECS)) for i, it in enumerate(dup_items)] for _ in range(3)]
    dclaims = L.identity_claims(dpasses, specs["TimelineItem.GetUniqueId"], ENV, active)
    dup_raws = [m.raw_rec(c, seq=8) for p in dpasses for c in p]
    forged_claims = dict(dclaims, claim_B_unique_within_pass=True, duplicates=[])
    m0, m1, m2, auth, excl, media, dest = m.exit_("M0"), m.exit_("M1"), m.exit_("M2"), m.auth(), m.excl(), m.media(), m.dest()
    write_base = attached + [m0, m1, m2, auth, excl, media, dest]
    sets = {
        "empty": ES([]),
        "provisioned-only": ES([prov], current_session=None),
        "ready": ES(core),
        "ready-wrong-binary-pin": ES([prov, bundle, m.launch(resolve_binary_sha256="b" * 64), roj]),
        "ready-self-verified-bundle": ES([prov, m.bundle(verifier="Claude Code (Fable 5.1)"), launch, roj]),
        "ready-bundle-other-host": ES([prov, m.bundle(env={"host_name": "PRESTO"}), launch, roj]),
        "ready-bundle-historical-only": ES([prov, m.bundle(env={"manifest_sha256": "a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a", "authority_version": "1.5.0"}, manifest_sha256="a40c6954fbe7f72d48eaf3957c0ac036c471a7a92496e277660530386e7aba5a", authority_version="1.5.0", historical=True), launch, roj]),
        "ready-no-current-session": ES(core, current_session=None),
        "ready-launch-previous-session-only": ES([prov, bundle, m.launch(S_OLD), roj], current_session=S_CUR),
        "ready-ghost-session-without-launch": ES([prov, bundle, roj], current_session="sess-ghost"),
        "attached": ES(attached),
        "attached-reversed-order": ES(list(reversed(attached))),
        "attached-stale-good-current-eka": ES(core + [m.conn(seq=1, minutes_before=20), m.conn_eka(seq=2, minutes_before=5), pb, tb]),
        "attached-current-good-stale-eka": ES(core + [m.conn_eka(seq=1, minutes_before=20), m.conn(seq=2, minutes_before=5), pb, tb]),
        "attached-duplicate-sequence-conflict": ES(core + [m.conn(seq=2, minutes_before=10), m.conn_eka(seq=2, minutes_before=10), pb, tb]),
        "attached-duplicate-timestamp-distinct-sequence": ES(core + [m.conn(seq=1, minutes_before=10), m.conn(seq=2, minutes_before=10, root_path=ROOT), pb, tb]),
        "attached-connection-previous-session-only": ES(core + [m.conn(S_OLD, seq=9, minutes_before=10), pb, tb]),
        "attached-ancient-observation": ES(core + [m.conn(seq=2, minutes_before=60 * 48), pb, tb]),
        "attached-sequence-timestamp-disorder": ES(core + [m.conn(seq=1, minutes_before=5), m.conn(seq=2, minutes_before=20, root_path=ROOT), pb, tb]),
        "attached-missing-root-in-connection": ES(core + [m.conn(seq=2, root_path=None), pb, tb]),
        "attached-changed-uuid-in-connection": ES(core + [m.conn(seq=2, instance_uuid=UU2), pb, tb]),
        "attached-second-provisioning-other-uuid": ES(attached + [prov2]),
        "attached-cross-library-timeline-binding": ES(core + [conn, pb, m.tb(env={"library_name": "EKA"})]),
        "attached-binding-other-session": ES(core + [conn, m.pb(session=S_OLD), m.tb(session=S_OLD), m.launch(S_OLD)]),
        "attached-fatal-probe-failure": ES(attached + [m.raw_rec(reseal(caps_ok_c["GetCurrentDatabase"], library_uuid=UU2, library_root="/other/library"))]),
        "attached-capability-failure-only": ES(attached + [m.raw_rec(m.capture("GetEnd", "raise", probe_id="probe-0004"))]),
        "attached-eka-observed": ES(core + [m.conn_eka(seq=2), pb, tb]),
        "attached-local-database-observed": ES(core + [m.conn(seq=2, db_name="Local Database", root_path="/home/vidtoolz/.local/share/DaVinciResolve/Resolve Disk Database", instance_uuid=None), pb, tb]),
        "attached-version-mismatch": ES(core + [m.conn(seq=2, resolve_version="21.0.3.0007"), pb, tb]),
        "attached-no-ids": ES(core + [conn, m.pb(uid=None, status="UNAVAILABLE"), m.tb(uid=None, status="UNAVAILABLE", project_uid=None)]),
        "attached-candidate-evidence-unreviewed": ES(attached + caps_unrev),
        "attached-evidence-failed-getters": ES(attached + caps_failed),
        "attached-evidence-wrong-build": ES(attached + caps_wrong_build),
        "attached-evidence-old-refreeze": ES(attached + caps_old_refreeze),
        "attached-evidence-old-authority": ES(attached + caps_old_authority),
        "attached-evidence-no-raw": ES(attached + caps_no_raw),
        "attached-evidence-raw-tampered": ES(attached + caps_raw_tampered),
        "attached-evidence-wrong-receiver": ES(attached + caps_wrong_receiver),
        "attached-evidence-raised-accepted": ES(attached + caps_raised_accept + [refz_ok]),
        "attached-evidence-raised-fake-parse-block": ES(attached + caps_raised_fake_parse),
        "attached-evidence-timeout-accepted": ES(attached + caps_timeout_accept),
        "attached-evidence-attribute-missing-accepted": ES(attached + caps_missing_accept + [refz_ok]),
        "attached-evidence-wrong-type-accepted": ES(attached + caps_wrongtype_accept + [refz_ok]),
        "attached-evidence-null-accepted": ES(attached + caps_none_accept + [refz_ok]),
        "attached-evidence-truncated-accepted": ES(attached + caps_deep_accept + [refz_ok]),
        "attached-evidence-unserializable-accepted": ES(attached + caps_cyclic_accept + [refz_ok]),
        "attached-evidence-review-other-raw": ES(attached + caps_review_other_raw),
        "attached-evidence-review-stale-parser": ES(attached + caps_review_stale_parser),
        "attached-evidence-review-stale-spec": ES(attached + caps_review_stale_spec),
        "attached-evidence-reviewer-is-operator": ES(attached + caps_reviewer_is_operator),
        "attached-evidence-review-reject": ES(attached + caps_review_reject),
        "attached-evidence-refreeze-stale-parser": ES(attached + caps_refreeze_stale_parser),
        "attached-evidence-refreeze-stale-spec": ES(attached + caps_refreeze_stale_spec),
        "attached-evidence-refreeze-other-session": ES(attached + caps_refreeze_other_session),
        "attached-evidence-refreeze-unreviewed": ES(attached + caps_refreeze_unreviewed),
        "attached-evidence-refreeze-unlisted-raw": ES(attached + caps_refreeze_unlisted_raw),
        "attached-evidence-no-refreeze-record": ES(attached + caps_no_refreeze),
        "attached-evidence-derived-cache-forged": ES(attached + caps_derived_cache_forged),
        # ---- v1.7 chain-substitution families (Codex v1.6 BLOCKER C16-B4)
        "attached-evidence-derived-artifact-missing": ES(attached + caps_derived_missing),
        "attached-evidence-derived-artifact-of-other-raw": ES(attached + caps_derived_other_raw),
        "attached-evidence-duplicate-current-review": ES(attached + caps_duplicate_review),
        "attached-evidence-superseded-review": ES(attached + caps_superseded_review),
        "attached-evidence-conflicting-current-reviews": ES(attached + caps_conflicting_reviews),
        "attached-evidence-duplicate-current-refreeze": ES(attached + caps_duplicate_refreeze),
        "attached-evidence-derived-cache-honest": ES(attached + caps_derived_cache_honest),
        "attached-reviewed-evidence": ES(attached + caps_ok),
        "attached-reviewed-evidence-minus-getstartframe": ES(attached + caps_ok_minus_startframe),
        "attached-identity-observations": ES(attached + caps_ok + id_raws + [id_uniq, id_stab]),
        "attached-identity-duplicates-honest": ES(attached + caps_ok + dup_raws + [m.identity_obs("IDENTITY_UNIQUENESS_OBSERVATION", dpasses, dclaims)]),
        "attached-identity-duplicates-claimed-unique": ES(attached + caps_ok + dup_raws + [m.identity_obs("IDENTITY_UNIQUENESS_OBSERVATION", dpasses, forged_claims)]),
        "attached-identity-stability-two-passes": ES(attached + caps_ok + id_raws + [m.identity_obs("IDENTITY_STABILITY_OBSERVATION", passes[:2], dict(claims, claim_C_stable_across_passes=True, passes=2))]),
        "write-ready-without-authorization": ES(attached + [m0, m1, m2, excl, m.refz_legacy(), media, dest]),
        "write-ready-authorization-old-authority": ES(attached + [m0, m1, m2, m.auth("1.5.0"), excl, m.refz_legacy(), media, dest]),
        "write-ready-refreeze-unreviewed": ES(write_base + [m.refz_legacy(reviewed=False)]),
        "write-ready-refreeze-other-matrix": ES(write_base + [m.refz_legacy(caps_sha="0" * 64)]),
        "write-ready-base": ES(write_base + [m.refz_legacy()]),
        "write-ready-hyp": ES(write_base + caps_ok),
    }
    handles = {"prov": prov, "bundle": bundle, "launch": launch, "roj": roj, "conn": conn, "pb": pb, "tb": tb, "m0": m0, "m1": m1, "m2": m2, "auth": auth, "excl": excl, "media": media, "dest": dest, "caps_ok": caps_ok, "caps_unrev": caps_unrev, "raws_ok": raws_ok, "captures_ok": caps_ok_c, "reviews_ok": reviews_ok, "refz_ok": refz_ok, "hyp_sha": hyp_sha, "write_base": write_base, "raised_captures": raised_c, "identity_passes": passes, "identity_claims": claims, "dup_passes": dpasses, "dup_claims": dclaims, "specs": specs, "slow_capture": slow_c["GetVersionString"]}
    return sets, handles
