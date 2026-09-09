"""Fixture evidence minting shared by build_v1_4.py and validate_v1_4.py (TOOL, not authority).
Mints content-addressed, envelope-bound evidence records for a given (manifest sha, capability matrix sha) so the validator
can prove that attachment derivation binds to the exact reviewed manifest: fixtures minted against the placeholder manifest
must NOT derive a usable state against the real manifest, and records re-minted against the real manifest must."""
import hashlib
import sys
import os

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import authority_lib as L  # noqa: E402

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
PLACEHOLDER_MANIFEST = hashlib.sha256(b"VIDTOOLZ-FIXTURE-MANIFEST-PLACEHOLDER-v1.4").hexdigest()
BIN_SHA = "124caa502547f85a2e17ad6a59269918ae561c0f82d701b9fc4e7f42127ffee7"
RECEIVER_RULES = [("Resolve", {"GetVersionString", "GetProductName", "GetProjectManager"}), ("ProjectManager", {"GetCurrentDatabase", "GetProjectListInCurrentFolder", "GetCurrentProject"}), ("Project", {"GetTimelineCount", "GetTimelineByIndex", "GetCurrentTimeline", "GetProjectLastModifiedTime"}), ("Timeline", {"GetTrackCount", "GetItemListInTrack", "GetTrackName", "GetStartFrame", "GetEndFrame", "GetStartTimecode", "GetIsTrackLocked", "GetIsTrackEnabled", "GetMarkers", "GetMarkerByCustomData"})]


def receiver_of(method):
    if "." in method:
        return method.split(".", 1)[0]
    for recv, methods in RECEIVER_RULES:
        if method in methods:
            return recv
    return "TimelineItem"


def ts(minutes_before=0, base=EVALUATED_AT):
    from datetime import timedelta
    t = L.parse_ts(base) - timedelta(minutes=minutes_before)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


class Mint:
    def __init__(self, manifest_sha, caps_sha, authority_version=L.AUTHORITY_VERSION):
        self.M, self.C, self.AV = manifest_sha, caps_sha, authority_version
        self.prov = self.R("PROVISIONING_RECORD", level="LIBRARY", library_kind="Disk", root_path=ROOT, instance_uuid=UU, provisioned_by="Mikko (operator)")
        self.prov_uu2 = self.R("PROVISIONING_RECORD", level="LIBRARY", env={"library_uuid": UU2}, library_kind="Disk", root_path=ROOT, instance_uuid=UU2, provisioned_by="Mikko (operator)")

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

    # ---- bundle / library / session building blocks
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

    def refz(self, caps_sha=None, reviewed=True, authority_version=None):
        return self.R("REFREEZE_RECORD", kind="M0_READ_REQUALIFICATION", reviewed=reviewed, manifest_sha256=self.M, authority_version=authority_version or self.AV, capability_matrix_sha256=caps_sha or self.C)

    def media(self):
        return self.R("MEDIA_CLASS_ATTESTATION", media_class="SYNTHETIC", media_sha256="1" * 64)

    def dest(self, project=PROJ, timeline=TL, uid="tl-fixture-0001", session=S_CUR):
        return self.R("DESTINATION_TIMELINE", env={"session_id": session, "sequence": 1, "captured_at": ts(13), "project_name": project, "timeline_name": timeline, "timeline_unique_id": uid}, project_name=project, timeline_name=timeline, timeline_unique_id=uid)

    def guard(self, guard_digest, payload_sha, project=PROJ, timeline=TL, seq=2, session=S_CUR, **kw):
        env = {"session_id": session, "sequence": seq, "captured_at": ts(10), "project_name": project, "timeline_name": timeline}
        env.update(kw.pop("env", {}))
        return self.R("GUARD_SNAPSHOT", env=env, guard_digest=guard_digest, payload_sha256=payload_sha, project_name=project, timeline_name=timeline)

    def journal_prepared(self, transaction_id, plan_digest, project=PROJ, session=S_CUR):
        return self.R("JOURNAL_PREPARED", env={"session_id": session, "sequence": 3, "captured_at": ts(9), "project_name": project}, transaction_id=transaction_id, plan_digest=plan_digest, journal_path_sha256="d" * 64)

    def plan_validation(self, plan_digest, result="PASS"):
        return self.R("PLAN_VALIDATION", plan_digest=plan_digest, result=result, authority_version=self.AV, validator="tools/authority_lib.py#semantic_mutation_plan")

    # ---- capability evidence (probe output) + raw evidence
    def raw(self, method, content=None, session=S_CUR):
        content = content if content is not None else f"probe-0001 {method} -> <non-null value of expected type>"
        return self.R("RAW_EVIDENCE", env={"session_id": session, "sequence": 5, "captured_at": ts(25)}, content=content, content_sha256=L.sha256_text(content))

    def capev(self, method, promoted_caps_sha=None, classification="SUCCESS", code=None, reviewed=True, decision="ACCEPT", build=BUILD, resolve_version=VER, receiver=None, raw_sha=None, promoted_authority=None, session=S_CUR, probe_id="probe-0001"):
        content = f"probe-0001 {method} -> <non-null value of expected type>"
        rsha = raw_sha or L.sha256_text(content)
        success = classification == "SUCCESS"
        q = {"reviewed": reviewed, "decision": (decision if reviewed else None), "promoted_by": ({"authority_version": promoted_authority or self.AV, "capability_matrix_sha256": promoted_caps_sha or self.C} if reviewed and decision == "ACCEPT" else None)}
        return self.R("CAPABILITY_EVIDENCE", env={"session_id": session, "sequence": 5, "captured_at": ts(25), "build": build, "resolve_version": resolve_version}, method=method, receiver_type=receiver or receiver_of(method), probe_id=probe_id, probe_authority_version=self.AV, raw_evidence_sha256=rsha, parsed_observation={"type": "str" if "Name" in method or "Version" in method else "object", "non_null": success}, result={"classification": classification, "success": success, "code": code}, qualification=q)


def ES(records, current_session=S_CUR, evaluated_at=EVALUATED_AT):
    return {"schema": "vidtoolz.resolveEvidenceSet.v1.4", "current_session_id": current_session, "evaluated_at": evaluated_at, "records": {r["record_id"]: r for r in records}}


def base_sets(m, probe_methods, hyp_caps_sha):
    """The evidence-set catalogue used by eligibility, attachment and freshness fixtures."""
    prov, prov2 = m.prov, m.prov_uu2
    bundle, launch, roj = m.bundle(), m.launch(), m.roj()
    conn = m.conn(seq=2, minutes_before=10)
    pb, tb = m.pb(), m.tb()
    pb_human, pb_oper, opp = m.pb("PYSTY UHD", None, "UNAVAILABLE", seq=1), m.pb("Mikko human scratch", None, "UNAVAILABLE", seq=1), m.opp()
    core = [prov, bundle, launch, roj]
    attached = core + [conn, pb, tb, pb_human, pb_oper, opp]
    caps_ok = [m.capev(x, promoted_caps_sha=hyp_caps_sha) for x in probe_methods] + [m.raw(x) for x in probe_methods]
    caps_unrev = [m.capev(x, reviewed=False, decision=None) for x in probe_methods] + [m.raw(x) for x in probe_methods]
    caps_failed = [m.capev(x, promoted_caps_sha=hyp_caps_sha, classification="CAPABILITY_FAILURE", code="GETTER_RAISED", decision="REJECT") for x in probe_methods] + [m.raw(x) for x in probe_methods]
    # wrong-build evidence is minted in a PREVIOUS session (a build-7 record inside the current build-14 session would already be an envelope CONFLICT)
    caps_wrong_build = [m.capev(x, promoted_caps_sha=hyp_caps_sha, build=7, resolve_version="21.0.3.0007", session=S_OLD) for x in probe_methods] + [m.raw(x, session=S_OLD) for x in probe_methods]
    caps_ok_minus_startframe = [m.capev(x, promoted_caps_sha=hyp_caps_sha) for x in probe_methods if x != "GetStartFrame"] + [m.raw(x) for x in probe_methods if x != "GetStartFrame"]
    caps_old_refreeze = [m.capev(x, promoted_caps_sha="0" * 64) for x in probe_methods] + [m.raw(x) for x in probe_methods]
    caps_old_authority = [m.capev(x, promoted_caps_sha=hyp_caps_sha, promoted_authority="1.3.0") for x in probe_methods] + [m.raw(x) for x in probe_methods]
    caps_no_raw = [m.capev(x, promoted_caps_sha=hyp_caps_sha) for x in probe_methods]
    caps_raw_tampered = [m.capev(x, promoted_caps_sha=hyp_caps_sha) for x in probe_methods] + [m.raw(x, content=f"TAMPERED {x}") for x in probe_methods]
    caps_wrong_receiver = [m.capev(x, promoted_caps_sha=hyp_caps_sha, receiver="Fusion") for x in probe_methods] + [m.raw(x) for x in probe_methods]
    m0, m1, m2, auth, excl, media, dest = m.exit_("M0"), m.exit_("M1"), m.exit_("M2"), m.auth(), m.excl(), m.media(), m.dest()
    write_base = attached + [m0, m1, m2, auth, excl, media, dest]
    sets = {
        "empty": ES([]),
        "provisioned-only": ES([prov], current_session=None),
        "ready": ES(core),
        "ready-wrong-binary-pin": ES([prov, bundle, m.launch(resolve_binary_sha256="b" * 64), roj]),
        "ready-self-verified-bundle": ES([prov, m.bundle(verifier="Claude Code (Fable 5.1)"), launch, roj]),
        "ready-bundle-other-host": ES([prov, m.bundle(env={"host_name": "PRESTO"}), launch, roj]),
        "ready-bundle-historical-only": ES([prov, m.bundle(env={"manifest_sha256": "ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc", "authority_version": "1.3.0"}, manifest_sha256="ad1e6bfcbcb41d79c230795d64e031438e8e39a194f640daca68532d798a55dc", authority_version="1.3.0", historical=True), launch, roj]),
        "ready-no-current-session": ES(core, current_session=None),
        "ready-launch-previous-session-only": ES([prov, bundle, m.launch(S_OLD), roj], current_session=S_CUR),
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
        "attached-fatal-probe-failure": ES(attached + [m.capev("GetCurrentDatabase", classification="FATAL_TARGET_FAILURE", code="WRONG_LIBRARY", decision="REJECT")]),
        "attached-capability-failure-only": ES(attached + [m.capev("GetEnd", classification="CAPABILITY_FAILURE", code="GETTER_RAISED", decision="REJECT"), m.raw("GetEnd")]),
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
        "attached-reviewed-evidence": ES(attached + caps_ok),
        "attached-reviewed-evidence-minus-getstartframe": ES(attached + caps_ok_minus_startframe),
        "ready-ghost-session-without-launch": ES([prov, bundle, roj], current_session="sess-ghost"),
        "write-ready-without-authorization": ES(attached + [m0, m1, m2, excl, m.refz(), media, dest]),
        "write-ready-authorization-old-authority": ES(attached + [m0, m1, m2, m.auth("1.3.0"), excl, m.refz(), media, dest]),
        "write-ready-refreeze-unreviewed": ES(write_base + [m.refz(reviewed=False)]),
        "write-ready-refreeze-other-matrix": ES(write_base + [m.refz(caps_sha="0" * 64)]),
        "write-ready-base": ES(write_base + [m.refz()]),
        "write-ready-hyp": ES(write_base + [m.refz(caps_sha=hyp_caps_sha)] + caps_ok),
    }
    handles = {"prov": prov, "bundle": bundle, "launch": launch, "roj": roj, "conn": conn, "pb": pb, "tb": tb, "m0": m0, "m1": m1, "m2": m2, "auth": auth, "excl": excl, "media": media, "dest": dest, "caps_ok": caps_ok, "write_base": write_base}
    return sets, handles
