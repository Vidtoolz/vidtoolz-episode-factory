#!/usr/bin/env python3
"""Operator-initiated governed STOP for a live production-read session.

Independent review of the host boundary left one gap open on the operator's side: once a capsule session was running, the operator had
no way to end it. The operator account cannot signal the capsule account, cannot enter its namespaces and cannot read its /proc — that
asymmetry is the point of the capsule, and weakening it to get a stop button would undo the boundary.

So the stop is not a signal. It is an authenticated request on the same loopback transport as a read, carrying the same HMAC key, and
the worker — which IS inside the capsule — is the only thing that signals anything. Before it does, it re-verifies the entire
production chain, exactly as it would before serving a read: accepted authority, policy digest, sealed profile and its exact tree, the
host primitive, the key placement, the capsule confinement facts and the endpoint attribution. A stop can therefore only ever end the
ONE session the launcher attested, it can name no pid, and it takes no parameters.

The worker SIGKILLs the attested Resolve and exits; the capsule init exits with it; pid 1 of the capsule pid namespace exiting takes
the whole capsule — processes, mounts, network — with it.

Usage:
  session_stop.py --port N --secret-file PATH [--host-id vidnux] [--timeout 30]
"""
import hashlib, hmac, http.client, json, os, secrets, sys, time

PROTOCOL = "vrc.v1"


def sign(secret, ts, nonce, method, path, body):
    digest = hashlib.sha256(body).hexdigest()
    return hmac.new(secret, f"{ts}.{nonce}.{method}.{path}.{digest}".encode(), hashlib.sha256).hexdigest()


def stop(port, secret_file, host_id="vidnux", timeout=30.0, conn=None):
    secret = open(secret_file, "rb").read().strip()
    if len(secret) < 32: raise SystemExit("REFUSED: secret too short")
    env = {"protocol": PROTOCOL, "op": "session_stop", "target_host": host_id, "caller": "operator-session-stop",
           "request_id": secrets.token_hex(8), "deadline_ms": int(timeout * 1000)}
    body = json.dumps(env).encode()
    ts, nonce = str(int(time.time())), secrets.token_hex(16)
    headers = {"Content-Type": "application/json", "X-VRC-Timestamp": ts, "X-VRC-Nonce": nonce,
               "X-VRC-Signature": sign(secret, ts, nonce, "POST", "/v1/op", body)}
    c = conn or http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    c.request("POST", "/v1/op", body, headers)
    r = c.getresponse()
    return r.status, json.loads(r.read() or b"{}")


def main(argv):
    args, i = {}, 1
    while i < len(argv):
        if argv[i] in ("--port", "--secret-file", "--host-id", "--timeout") and i + 1 < len(argv): args[argv[i][2:]] = argv[i + 1]; i += 2
        else: print(__doc__); return 2
    if "port" not in args or "secret-file" not in args: print(__doc__); return 2
    try:
        status, out = stop(int(args["port"]), args["secret-file"], args.get("host-id", "vidnux"), float(args.get("timeout", 30)))
    except (OSError, ValueError) as e:
        print(json.dumps({"ok": False, "error": "SESSION_STOP_UNREACHABLE", "message": str(e)[:300]})); return 2
    print(json.dumps({"http": status, "ok": out.get("ok"), "result": out.get("result"), "error": out.get("error"),
                      "authorization": ((out.get("resolve") or {}).get("authorization") or {}).get("decision")}, indent=1))
    return 0 if out.get("ok") else 1


if __name__ == "__main__": sys.exit(main(sys.argv))
