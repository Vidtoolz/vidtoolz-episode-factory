#!/usr/bin/env python3
"""Place the shared HMAC key for a cross-account production-read session, and prove its placement.

The capsule closes the operator boundary by giving the worker its own account. That leaves exactly one artifact both sides touch: the
HMAC key Hermes signs requests with and the worker verifies them with. Its placement is the whole cross-account trust model:

  * the OPERATOR owns the key. Hermes runs as the operator and needs it to sign.
  * the CAPSULE may READ it and may never WRITE it. A capsule that could rewrite the key could mint its own caller, and a compromised
    Resolve inside the capsule could then drive the worker as if it were Hermes.
  * the key is reachable only by an explicit ACL, never by group or world bits, and the directories above it are traverse-only
    (`--x`) for the capsule: the capsule can open the one file it was given, and cannot list the operator's secrets directory.

The key IDENTITY (the first 16 hex of its sha256) goes into the accepted authority record as `caller_identity.hmac_key_id`. The worker
recomputes it from the bytes it actually loaded and refuses any other key, so swapping the file is not a silent substitution.

This tool never runs as the capsule account, never prints key material, and needs no root: the ACL is on the operator's own file.

Usage:
  prepare_session_key.py --out PATH [--capsule-account vrc-capsule] [--rotate]
  prepare_session_key.py --verify PATH [--capsule-account vrc-capsule]
"""
import grp, hashlib, json, os, pwd, secrets, stat, subprocess, sys

CAPSULE_ACCOUNT = "vrc-capsule"


class KeyError_(Exception): pass


def req(c, msg):
    if not c: raise KeyError_(msg)


def sha(b): return hashlib.sha256(b).hexdigest()


def acl_of(path):
    r = subprocess.run(["getfacl", "-cE", "--absolute-names", path], capture_output=True, text=True)
    req(r.returncode == 0, f"getfacl failed for {path}: {r.stderr.strip()[:200]}")
    return [l.strip() for l in r.stdout.splitlines() if l.strip() and not l.startswith("#")]


def set_acl(path, entry):
    r = subprocess.run(["setfacl", "-m", entry, path], capture_output=True, text=True)
    req(r.returncode == 0, f"setfacl {entry} failed for {path}: {r.stderr.strip()[:200]}")


def capsule_uid(account):
    try: return pwd.getpwnam(account).pw_uid
    except KeyError: raise KeyError_(f"the capsule account {account!r} does not exist on this host")


def verify(path, account=CAPSULE_ACCOUNT):
    """Everything a reviewer would check by hand, as a machine-checkable verdict."""
    cuid = capsule_uid(account)
    me = os.getuid()
    req(me != cuid, "this tool must run as the operator, never as the capsule account")
    st = os.stat(path)
    req(stat.S_ISREG(st.st_mode), f"{path} is not a regular file")
    req(st.st_uid == me, f"{path} is not owned by this operator account (uid {st.st_uid})")
    mode = stat.S_IMODE(st.st_mode)
    req(not mode & (stat.S_IWGRP | stat.S_IWOTH), f"{path} is group- or world-writable (mode {mode:04o})")
    req(not mode & stat.S_IROTH, f"{path} is world-readable (mode {mode:04o})")
    data = open(path, "rb").read().strip()
    req(len(data) >= 32, "the key is shorter than 32 bytes")
    acl = acl_of(path)
    want_read = f"user:{account}:r--"
    req(want_read in acl, f"{path} does not grant the capsule account read access ({acl})")
    for e in acl:
        if e.startswith(f"user:{account}:"):
            req(e == want_read, f"{path} grants the capsule more than read ({e})")
    mask = [e for e in acl if e.startswith("mask::")]
    req(not mask or "w" not in mask[0].split(":")[-1], f"the ACL mask would allow the capsule to write ({mask})")
    parents, p = [], os.path.dirname(os.path.abspath(path))
    while p != "/":
        pacl = acl_of(p)
        ent = [e for e in pacl if e.startswith(f"user:{account}:")]
        pst = os.stat(p)
        traversable = bool(stat.S_IMODE(pst.st_mode) & stat.S_IXOTH) or bool(ent)
        req(traversable, f"the capsule cannot traverse {p}")
        for e in ent: req(e.split(":")[-1] in ("--x", "r-x"), f"{p} grants the capsule more than traversal ({e})")
        req(not stat.S_IMODE(pst.st_mode) & stat.S_IWOTH, f"{p} is world-writable")
        parents.append({"path": p, "mode": oct(stat.S_IMODE(pst.st_mode)), "capsule_acl": ent})
        p = os.path.dirname(p)
    return {"ok": True, "path": os.path.abspath(path), "owner_uid": st.st_uid, "mode": oct(mode),
            "hmac_key_id": sha(data)[:16], "capsule_account": account, "capsule_uid": cuid,
            "capsule_access": "read-only (POSIX ACL)", "acl": acl, "parents": parents[:6]}


def place(path, account=CAPSULE_ACCOUNT, rotate=False):
    cuid = capsule_uid(account)
    req(os.getuid() != cuid, "this tool must run as the operator, never as the capsule account")
    path = os.path.abspath(path)
    req(rotate or not os.path.exists(path), f"{path} already exists; pass --rotate to replace it (every live session must then be re-sealed)")
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh: fh.write(secrets.token_hex(32).encode())
    os.chmod(path, 0o640)
    set_acl(path, f"u:{account}:r")
    p = d                     # traverse-only, only where traversal is actually missing, and only on directories this operator owns:
    while p != "/" and os.stat(p).st_uid == os.getuid():      # a world-traversable parent is left exactly as it is
        if not stat.S_IMODE(os.stat(p).st_mode) & stat.S_IXOTH: set_acl(p, f"u:{account}:x")
        p = os.path.dirname(p)
    return verify(path, account)


def main(argv):
    args, i = {}, 1
    while i < len(argv):
        if argv[i] == "--rotate": args["rotate"] = True; i += 1; continue
        if argv[i] in ("--out", "--verify", "--capsule-account") and i + 1 < len(argv): args[argv[i][2:]] = argv[i + 1]; i += 2; continue
        print(__doc__); return 2
    account = args.get("capsule-account", CAPSULE_ACCOUNT)
    try:
        if "verify" in args: out = verify(args["verify"], account)
        elif "out" in args: out = place(args["out"], account, args.get("rotate", False))
        else: print(__doc__); return 2
    except (KeyError_, OSError) as e:
        print(json.dumps({"ok": False, "error": "KEY_PLACEMENT_REFUSED", "message": str(e)[:400]})); return 2
    print(json.dumps(out, indent=1))
    print("# put this in the authority record: \"caller_identity\": {\"operator_uid\": %d, \"hmac_key_id\": \"%s\"}" % (out["owner_uid"], out["hmac_key_id"]))
    return 0


if __name__ == "__main__": sys.exit(main(sys.argv))
