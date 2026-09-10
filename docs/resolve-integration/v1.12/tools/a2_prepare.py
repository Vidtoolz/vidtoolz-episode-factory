#!/usr/bin/env python3
"""A2 PREPARER tool (v1.12) — adopt or record the provisioned qualification library and mint the preparer records.

No Resolve contact. No Store.v5 session is created, opened or read. The operator never hand-builds a record: every
envelope field is derived from the target contract, the active authority and the provisioning record, and every
record is registered through authority_lib.make_record.

    python3 -B tools/a2_prepare.py adopt   --session <id> --uuid <uuid> --root <abs path> --by "<actor>" \
                                           [--principal PREPARER:<actor>] [--journal-sha <sha256>] \
                                           [--launch-script <path> | --recipe-sha <sha256>] [--evidence-root <path>]
    python3 -B tools/a2_prepare.py prepare --session <id> [--principal ...] [--evidence-root ...]
    python3 -B tools/a2_prepare.py status  --session <id> [--evidence-root ...]

`adopt` is non-destructive: it records the identity of a library that ALREADY exists physically. It never creates,
renames or deletes a Resolve library, and it never requires recreating one.
"""
import argparse
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import authority_lib as L            # noqa: E402
import evidence_authoring as A       # noqa: E402

DEFAULT_PRINCIPAL = L.PRINCIPAL_REGISTRY["PREPARER"][0]


def _adopt(a):
    tc = A.target_contract()
    C = L._contract_env(tc)
    print(f"contract library : {C['library_name']!r} (Disk)")
    print(f"contract host    : {C['host_name']}   product {C['product']}   version {C['resolve_version']}")
    if C["library_name"] in tc["library"].get("prohibited_library_names", []):
        print("REFUSED: the contract library is a prohibited library"); return 2
    if not L.is_uuid(a.uuid):
        print(f"REFUSED: --uuid {a.uuid!r} is not a lowercase 8-4-4-4-12 uuid"); return 2
    if not L.is_abs_path(a.root):
        print(f"REFUSED: --root {a.root!r} is not an absolute traversal-free path"); return 2
    if a.recipe_sha:
        recipe = a.recipe_sha
    elif a.launch_script:
        if not os.path.exists(a.launch_script):
            print(f"REFUSED: --launch-script {a.launch_script} does not exist"); return 2
        recipe = hashlib.sha256(open(a.launch_script, "rb").read()).hexdigest()
        print(f"launch script    : {a.launch_script}  sha256 {recipe}")
    else:
        print("REFUSED: one of --launch-script or --recipe-sha is required (the LAUNCH_RECIPE binds the recorded script)")
        return 2
    p = A.create_evidence_set(a.session, a.principal, root=a.evidence_root)
    print(f"created OPEN      : {p}")
    prov = A.add_provisioning_record(a.session, a.principal, instance_uuid=a.uuid, root_path=a.root,
                                     provisioned_by=a.by, root=a.evidence_root)
    print(f"PROVISIONING_RECORD {prov['record_id']}")
    lr = A.add_launch_recipe(a.session, a.principal, recipe_sha256=recipe, root=a.evidence_root)
    print(f"LAUNCH_RECIPE       {lr['record_id']}  (version/binary/scripting derived from the contract)")
    if a.journal_sha:
        j = A.add_read_only_journal(a.session, a.principal, journal_path_sha256=a.journal_sha, root=a.evidence_root)
        print(f"READ_ONLY_JOURNAL   {j['record_id']}  (probe ELIGIBILITY, not attachment readiness)")
    return 0


def _prepare(a):
    d = A.mark_prepared(a.session, a.principal, root=a.evidence_root)
    print(f"state -> PREPARED   prepared_content_sha256 {d}")
    print("the preparer's write grants are now closed. Only a registered VERIFIER may write, and only")
    print("BUNDLE_VERIFICATION, via tools/a2_verify.py. Editing a preparer record from here invalidates verification.")
    return 0


def _status(a):
    wf = A.workflow_state(a.session, root=a.evidence_root)
    es = A.load_evidence_set(a.session, root=a.evidence_root)
    print(f"state            : {wf['state']}")
    print(f"governed root    : {wf['governed_root']}")
    print(f"document         : {A.set_path(a.session, a.evidence_root)}")
    for r in sorted(es["records"].values(), key=lambda r: r["record_type"]):
        print(f"  {r['record_type']:24s} {r['record_id']}")
    ve = A.validate_evidence_set(a.session, root=a.evidence_root)
    print(f"validate_evidence_set: {'OK' if not ve else str(len(ve)) + ' error(s)'}")
    for e in ve[:6]:
        print("   -", e[:180])
    d = A.derive_attachment_state(a.session, root=a.evidence_root)
    print(f"derived state    : {d['state']}")
    for f in d["failures"][:6]:
        print("   failure:", f[:180])
    for c in d["conflicts"][:6]:
        print("   conflict:", c[:180])
    return 0 if d["state"] == "ATTACHMENT_READY" else 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog="a2_prepare", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("adopt", "prepare", "status"):
        p = sub.add_parser(name)
        p.add_argument("--session", required=True)
        p.add_argument("--principal", default=DEFAULT_PRINCIPAL)
        p.add_argument("--evidence-root", default=None)
        if name == "adopt":
            p.add_argument("--uuid", required=True)
            p.add_argument("--root", required=True)
            p.add_argument("--by", required=True)
            p.add_argument("--launch-script", default=None)
            p.add_argument("--recipe-sha", default=None)
            p.add_argument("--journal-sha", default=None)
    a = ap.parse_args(argv)
    if L.principal_errors(a.principal, "PREPARER"):
        print(f"REFUSED: {a.principal!r} is not a registered PREPARER principal. Registered: "
              f"{list(L.PRINCIPAL_REGISTRY['PREPARER'])}")
        return 2
    try:
        return {"adopt": _adopt, "prepare": _prepare, "status": _status}[a.cmd](a)
    except A.AuthoringError as e:
        print(f"REFUSED {e.code}: {e.detail}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
