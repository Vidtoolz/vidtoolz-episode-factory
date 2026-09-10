#!/usr/bin/env python3
"""A2V INDEPENDENT VERIFIER tool (v1.12) — the only production path that authors a BUNDLE_VERIFICATION.

A2V is a DISTINCT named human authorization, not part of A2 and not part of A1 or M0B. It requires a registered
VERIFIER principal whose ACTOR differs from the preparer's, and it may write no record type but BUNDLE_VERIFICATION.

No Resolve contact is required or performed. Everything the record asserts is computed here:
  - the active manifest digest, hashed from this bundle's own FREEZE-MANIFEST.json
  - the 9 target-contract pinned file digests, hashed from disk (never taken from the preparer)
  - the exact provisioning and launch record ids read from the governed document
  - the preparer principal read from the workflow transitions
Only verification_result PASS satisfies the attachment gate; a FAIL record is written for audit and refused by
derive_attachment_state.

    python3 -B tools/a2_verify.py check  --session <id> [--principal VERIFIER:<actor>]
    python3 -B tools/a2_verify.py verify --session <id> [--principal ...]
"""
import argparse
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import authority_lib as L            # noqa: E402
import evidence_authoring as A       # noqa: E402

DEFAULT_PRINCIPAL = L.PRINCIPAL_REGISTRY["VERIFIER"][0]


def _independent_checks(a, quiet=False):
    """Everything the verifier must establish for itself. Returns a list of failures."""
    tc = A.target_contract()
    active = A.active_authority()
    fails = []
    say = (lambda *x: None) if quiet else print
    say(f"authority_version   {active['authority_version']}")
    say(f"manifest_sha256     {active['manifest_sha256']}  (hashed from FREEZE-MANIFEST.json here)")
    say("pinned files (hashed from disk by the verifier):")
    for p, want in sorted(tc["resolve"]["pins"].items()):
        got = hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.exists(p) else None
        ok = got == want
        say(f"  {'OK ' if ok else 'BAD'} {p}")
        if not ok:
            fails.append(f"pinned file {p}: {'absent' if got is None else got[:12]} != {want[:12]}")
    try:
        es, wf = A._load(a.session)
    except A.AuthoringError as e:
        fails.append(f"{e.code}: {e.detail}")
        return fails, None, None
    say(f"document state      {wf['state']}  at {A.set_path(a.session)}")
    if wf["state"] != "PREPARED":
        fails.append(f"document state is {wf['state']}, not PREPARED")
    prov = A._only(es, "PROVISIONING_RECORD")
    launch = A._only(es, "LAUNCH_RECIPE")
    if prov is None:
        fails.append("no unique PROVISIONING_RECORD")
    if launch is None:
        fails.append("no unique LAUNCH_RECIPE")
    ve = L.validate_evidence_set(es, active)
    if ve:
        fails += [f"evidence set invalid: {e}" for e in ve[:3]]
    if prov is not None:
        C = L._contract_env(tc)
        say(f"target identity     library {prov['envelope'].get('library_name')!r} uuid {prov.get('instance_uuid')} root {prov.get('root_path')}")
        for label, cond in (("library_kind is Disk", prov.get("library_kind") == "Disk"),
                            ("library name matches the contract", prov["envelope"].get("library_name") == C["library_name"]),
                            ("uuid is a uuid", L.is_uuid(prov.get("instance_uuid"))),
                            ("root is absolute", L.is_abs_path(prov.get("root_path"))),
                            ("envelope uuid == body uuid", prov["envelope"].get("library_uuid") == prov.get("instance_uuid")),
                            ("envelope root == body root", prov["envelope"].get("library_root") == prov.get("root_path")),
                            ("library is not prohibited", C["library_name"] not in tc["library"].get("prohibited_library_names", []))):
            say(f"  {'OK ' if cond else 'BAD'} {label}")
            if not cond:
                fails.append(f"provisioning: {label} failed")
    if launch is not None:
        C = L._contract_env(tc)
        for label, cond in (("resolve_version is the computed contract form", launch.get("resolve_version") == C["resolve_version"]),
                            ("resolve_binary_sha256 is the contract pin", launch.get("resolve_binary_sha256") == tc["resolve"]["pins"]["/opt/resolve/bin/resolve"]),
                            ("external scripting is Local", launch.get("external_scripting_preference") == tc["session"]["external_scripting_preference_required"]),
                            ("cites the provisioning record", prov is not None and launch["envelope"].get("provisioning_id") == prov["record_id"])):
            say(f"  {'OK ' if cond else 'BAD'} {label}")
            if not cond:
                fails.append(f"launch recipe: {label} failed")
    prep = next((t["principal"] for t in reversed(wf["transitions"]) if t["state"] == "PREPARED"), None)
    if L.principal_actor(prep) == L.principal_actor(a.principal):
        fails.append(f"preparer and verifier are the same actor ({L.principal_actor(prep)})")
    say(f"preparer principal  {prep}")
    say(f"verifier principal  {a.principal}")
    return fails, es, wf


def main(argv=None):
    ap = argparse.ArgumentParser(prog="a2_verify", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--session", required=True)
        p.add_argument("--principal", default=DEFAULT_PRINCIPAL)
    a = ap.parse_args(argv)
    if L.principal_errors(a.principal, "VERIFIER"):
        print(f"REFUSED: {a.principal!r} is not a registered VERIFIER principal. Registered: "
              f"{list(L.PRINCIPAL_REGISTRY['VERIFIER'])}")
        return 2
    fails, _es, _wf = _independent_checks(a)
    if a.cmd == "check":
        print()
        print("CHECK:", "ALL PASS — verify would write a PASS BUNDLE_VERIFICATION" if not fails else f"{len(fails)} FAILURE(S)")
        for f in fails:
            print("   -", f[:200])
        return 0 if not fails else 1
    try:
        r = A.add_bundle_verification(a.session, a.principal)
    except A.AuthoringError as e:
        print()
        print(f"REFUSED {e.code}: {e.detail}")
        return 2
    print()
    print(f"BUNDLE_VERIFICATION {r['record_id']}  result {r['verification_result']}")
    print("state -> VERIFIED (document sealed 0400; no role may write any record type from here)")
    try:
        d = A.derive_attachment_state(a.session)
    except A.AuthoringError as e:
        # V112-RP1: the authorizing derivation re-states the governed-location law. A document that is well formed,
        # correctly sequenced and independently verified is still not authority outside the frozen root.
        print(f"REFUSED {e.code}: {e.detail}")
        return 2
    print(f"derived state       {d['state']}")
    for f in d["failures"][:4]:
        print("   failure:", f[:200])
    return 0 if d["state"] == "ATTACHMENT_READY" else 1


if __name__ == "__main__":
    sys.exit(main())
