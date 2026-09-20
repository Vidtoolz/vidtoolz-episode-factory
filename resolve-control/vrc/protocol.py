"""Envelope + HMAC signing shared with the worker (worker duplicates sign() to stay single-file; tests assert parity)."""
import hashlib, hmac, json, time, uuid
PROTOCOL = "vrc.v1"
def sha(b): return hashlib.sha256(b).hexdigest()
def sign(secret, ts, nonce, method, path, body): return hmac.new(secret, f"{ts}.{nonce}.{method}.{path}.{sha(body)}".encode(), hashlib.sha256).hexdigest()
def envelope(op, target_host, params=None, expected=None, deadline_ms=20000, caller="vrc-cli"):
    return {"protocol": PROTOCOL, "request_id": uuid.uuid4().hex, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "caller": caller, "op": op, "target_host": target_host, "params": params or {}, "expected": expected or {}, "deadline_ms": deadline_ms}
def auth_headers(secret, method, path, body):
    ts, nonce = str(int(time.time())), uuid.uuid4().hex
    return {"X-VRC-Timestamp": ts, "X-VRC-Nonce": nonce, "X-VRC-Signature": sign(secret, ts, nonce, method, path, body), "Content-Type": "application/json"}
