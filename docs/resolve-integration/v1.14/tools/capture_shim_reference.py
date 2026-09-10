"""REFERENCE capture shim (TOOL; NOT production adapter code; NOT runtime-qualified). Bundle v1.6.

Executable form of CAPTURE-SHIM.md: invoke ONE static-allowlisted getter on a receiver object and record only what mechanically
happened (RAW_CAPABILITY_CAPTURE, vidtoolz.resolveRawCapabilityCapture.v1). The shim never classifies success, never touches a
capability matrix, never reviews or refreezes, never calls eval/exec/run_script*, and refuses write-like or non-allowlisted
methods BEFORE invocation. The validator runs it only against fake in-process receivers (no Resolve). An M0A driver MUST conform
to CAPTURE-SHIM.md and record its own capture_shim_version/capture_shim_sha256; the refreeze binds whatever shim identity the
captures carry, so a substituted shim is visible in every downstream digest.
"""
import hashlib
import inspect
import json
import math
import os
import re
import struct
import threading
import time

import authority_lib as L

SHIM_VERSION = "vidtoolz.captureShim.reference.v1"


class UnsupportedValue(Exception):
    def __init__(self, reason, path):
        super().__init__(f"{reason} at {path}")
        self.reason, self.path = reason, path


class HandleRegistry:
    """Process-local tokens for opaque objects seen in one session, assigned in first-seen order. A token is NOT an identity
    claim about the Resolve object; it only says "the same Python object was seen again in this process". The registry holds a
    STRONG reference to every object it has tokenized, so an object identity can never be recycled into another object's token
    (without that, a freed receiver's address could be reused and two different objects would share a token, and the tokens
    would depend on allocation order rather than call order)."""

    def __init__(self):
        self._tokens, self._keep, self._n = {}, {}, 0

    def token(self, obj):
        k = id(obj)
        if k not in self._tokens:
            self._n += 1
            self._tokens[k] = f"h{self._n:04d}"
            self._keep[k] = obj
        return self._tokens[k]


def f64_hex(x):
    return struct.pack(">d", x).hex()


class Encoder:
    """Deterministic typed serialization (vidtoolz.resolvePyValue.v1). Unsupported/cyclic/callable values raise UnsupportedValue: never guessed."""

    def __init__(self, depth_limit=3, length_limit=64, string_limit=4096, handle_registry=None):
        self.depth_limit, self.length_limit, self.string_limit = depth_limit, length_limit, string_limit
        self.truncated, self.elided = False, []
        self.handles = handle_registry if handle_registry is not None else HandleRegistry()

    def encode(self, v, path="$", depth=0, seen=frozenset()):
        if v is None:
            return {"$t": "none"}
        if v is True or v is False:
            return {"$t": "bool", "v": v}
        if isinstance(v, int):
            if -(2 ** 53 - 1) <= v <= 2 ** 53 - 1:
                return {"$t": "int", "v": v}
            return {"$t": "bigint", "v": str(v)}
        if isinstance(v, float):
            if math.isnan(v):
                return {"$t": "f64_nonfinite", "v": "nan"}
            if math.isinf(v):
                return {"$t": "f64_nonfinite", "v": "+inf" if v > 0 else "-inf"}
            return {"$t": "f64", "v": f64_hex(v)}
        if isinstance(v, str):
            if len(v) > self.string_limit:
                self.truncated = True
                self.elided.append(path)
                return {"$t": "str", "v": v[: self.string_limit], "truncated": True, "full_len": len(v), "full_sha256": L.sha256_text(v)}
            return {"$t": "str", "v": v}
        if isinstance(v, (bytes, bytearray)):
            b = bytes(v)
            return {"$t": "bytes", "len": len(b), "sha256": hashlib.sha256(b).hexdigest(), "head_hex": b[:64].hex()}
        if isinstance(v, (list, tuple)):
            if id(v) in seen:
                raise UnsupportedValue("CYCLE", path)
            if depth >= self.depth_limit:
                self.truncated = True
                self.elided.append(path)
                return {"$t": "elided", "reason": "depth", "py": type(v).__name__, "len": len(v)}
            items = []
            for i, x in enumerate(v):
                if i >= self.length_limit:
                    self.truncated = True
                    self.elided.append(f"{path}[{i}..]")
                    items.append({"$t": "elided", "reason": "length", "omitted": len(v) - i})
                    break
                items.append(self.encode(x, f"{path}[{i}]", depth + 1, seen | {id(v)}))
            return {"$t": "list", "py": type(v).__name__, "v": items}
        if isinstance(v, dict):
            if id(v) in seen:
                raise UnsupportedValue("CYCLE", path)
            if depth >= self.depth_limit:
                self.truncated = True
                self.elided.append(path)
                return {"$t": "elided", "reason": "depth", "py": "dict", "len": len(v)}
            try:
                keys = sorted(v.keys(), key=lambda k: L.canon(self.encode(k, path + ".key", depth + 1, seen | {id(v)})))
            except L.CanonError as e:
                raise UnsupportedValue(f"UNENCODABLE_KEY:{e}", path)
            pairs = []
            for i, k in enumerate(keys):
                if i >= self.length_limit:
                    self.truncated = True
                    self.elided.append(f"{path}{{{i}..}}")
                    pairs.append([{"$t": "elided", "reason": "length", "omitted": len(v) - i}, {"$t": "none"}])
                    break
                pairs.append([self.encode(k, f"{path}.key[{i}]", depth + 1, seen | {id(v)}), self.encode(v[k], f"{path}[{i}]", depth + 1, seen | {id(v)})])
            return {"$t": "dict", "v": pairs}
        if callable(v) or inspect.ismodule(v) or inspect.isclass(v):
            raise UnsupportedValue("CALLABLE_OR_TYPE", path)
        return {"$t": "object", "class": type(v).__name__, "module": type(v).__module__, "handle_token": self.handles.token(v), "repr_sha256": L.sha256_text(repr(v))}


def write_like(method):
    base = method.split(".", 1)[-1].split("(")[0]
    return base in L.SCRIPT_TOOLS or any(base.startswith(p) for p in L.WRITE_LIKE_PREFIXES) or base.startswith("_") or not base.startswith("Get")


def parse_call(method):
    """'GetDuration(True)' -> ('GetDuration', [True]); 'Timeline.GetName' -> ('GetName', [])."""
    base = method.split(".", 1)[-1]
    m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\((.*)\)", base)
    if not m:
        return base, []
    args = [json.loads(a.strip().lower()) if a.strip().lower() in ("true", "false") else a.strip().strip('"') for a in m.group(2).split(",") if a.strip()]
    return m.group(1), args


def shim_sha256():
    return L.sha256_text(inspect.getsource(capture) + inspect.getsource(Encoder) + inspect.getsource(write_like) + inspect.getsource(parse_call) + SHIM_VERSION)


class ShimContext:
    def __init__(self, probe_id, session_id, authority_version, manifest_sha256, host_name, product, resolve_version, build, library_uuid, library_root, operator, clock=None):
        self.probe_id, self.session_id = probe_id, session_id
        self.authority_version, self.manifest_sha256 = authority_version, manifest_sha256
        self.host_name, self.product, self.resolve_version, self.build = host_name, product, resolve_version, build
        self.library_uuid, self.library_root, self.operator = library_uuid, library_root, operator
        self.sequence, self.handles = 0, HandleRegistry()
        self.clock = clock or (lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        self.shim_sha256 = shim_sha256()


def capture(ctx, receiver, receiver_class, receiver_path, method, allowlist, args=None, timeout_s=5.0, encoder_limits=None):
    """Invoke ONE allowlisted getter; record the mechanical outcome only. Refuses write-like / non-allowlisted / monkeypatched methods before invocation."""
    ctx.sequence += 1
    attr, parsed_args = parse_call(method)
    args = list(parsed_args) if args is None else list(args)
    enc = Encoder(handle_registry=ctx.handles, **(encoder_limits or {}))
    rec = {"schema": L.RAW_SCHEMA_ID, "probe_id": ctx.probe_id, "getter_attempt_id": f"{ctx.probe_id}:{ctx.sequence:04d}", "sequence": ctx.sequence, "captured_at": ctx.clock(),
           "authority_version": ctx.authority_version, "manifest_sha256": ctx.manifest_sha256, "host_name": ctx.host_name, "product": ctx.product, "resolve_version": ctx.resolve_version, "build": ctx.build,
           "session_id": ctx.session_id, "library_uuid": ctx.library_uuid, "library_root": ctx.library_root,
           "receiver": {"class": receiver_class, "path": receiver_path, "handle_token": (ctx.handles.token(receiver) if receiver is not None else None), "runtime_type": (type(receiver).__name__ if receiver is not None else None)},
           "method": method, "args": [Encoder(handle_registry=ctx.handles).encode(a) for a in args], "outcome": None,
           "serialization": {"codec": L.CODEC, "depth_limit": enc.depth_limit, "length_limit": enc.length_limit, "string_limit": enc.string_limit, "truncated": False, "elided_paths": []},
           "stdout_sha256": None, "stderr_sha256": None, "duration_ms": None, "capture_shim_version": SHIM_VERSION, "capture_shim_sha256": ctx.shim_sha256, "operator": ctx.operator}
    if method not in allowlist or write_like(method):
        rec["outcome"] = "REFUSED"
        rec["refused"] = {"reason": "not allowlisted" if method not in allowlist else "write-like or non-getter method name", "invoked": False}
        return seal(rec)
    if receiver is None:
        rec["outcome"] = "TRANSPORT_FAILURE"
        rec["transport"] = {"reason": "receiver unavailable (no connection)"}
        return seal(rec)
    try:
        fn = getattr(receiver, attr)
    except AttributeError:
        rec["outcome"] = "ATTRIBUTE_MISSING"
        return seal(rec)
    if attr in getattr(receiver, "__dict__", {}):
        rec["outcome"] = "REFUSED"
        rec["refused"] = {"reason": "attribute is an instance-level override (monkeypatched callable)", "invoked": False}
        return seal(rec)
    box = {}

    def run():
        t0 = time.monotonic()
        try:
            box["value"] = fn(*args)
        except BaseException as e:  # noqa: BLE001 — the shim records, never interprets
            box["exc"] = e
        box["ms"] = int((time.monotonic() - t0) * 1000)
    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(timeout_s)
    if th.is_alive():
        rec["outcome"] = "TIMEOUT"
        rec["timeout_ms"] = int(round(timeout_s * 1000))
        return seal(rec)
    rec["duration_ms"] = box.get("ms")
    if "exc" in box:
        e = box["exc"]
        rec["outcome"] = "RAISED"
        rec["raised"] = {"exception_class": type(e).__name__, "module": type(e).__module__, "message": str(e)}
        return seal(rec)
    v = box.get("value")
    try:
        encoded = enc.encode(v)
    except UnsupportedValue as u:
        rec["outcome"] = "UNSERIALIZABLE"
        rec["unserializable"] = {"python_type": type(v).__name__, "reason": u.reason, "path": u.path, "repr_sha256": L.sha256_text(repr(v))}
        return seal(rec)
    rec["outcome"] = "RETURNED"
    rec["returned"] = {"python_type": type(v).__name__, "value": encoded}
    rec["serialization"].update(truncated=enc.truncated, elided_paths=sorted(enc.elided))
    return seal(rec)


def raw_frame_bytes(capture):
    """THE wire format of one raw capture frame (v1.7): sorted-key, minimal-separator UTF-8 JSON with a trailing newline.
    These exact bytes are what the shim writes into the evidence store's RAW layer, what sha256 addresses that record by,
    and what authority_lib.ingest_raw_frame() strictly re-parses. A frame is bytes on disk before it is ever an object."""
    return (json.dumps(capture, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def seal(rec):
    rec.pop("raw_digest", None)
    rec["raw_digest"] = L.raw_capture_digest(rec)
    return rec


# ------------------------------------------------------------------ storage is NOT this module's business (v1.8, Codex ES-2)
# v1.6 and v1.7 carried an EvidenceRoot class here: a SECOND evidence-storage implementation with its own layout, its own
# path construction and no verification or finalization law. All four of its write entry points (add_capture,
# add_derived, add_review, add_refreeze) built a filesystem path by interpolating a caller-supplied string, so
# add_derived({"raw_capture_sha256": "../../x"}) wrote outside the evidence root. Codex finding ES-2.
#
# It is REMOVED. This module captures facts and serializes frames; it never creates a directory, never derives an
# evidence path and never writes evidence. There is exactly one evidence-storage authority in this bundle:
#
#     tools/evidence_store.py   (EVIDENCE_STORE_AUTHORIZING)
#
# A driver captures with capture(), serializes with raw_frame_bytes(), and hands the BYTES to
# evidence_store.EvidenceStore.put_raw(attempt_id, frame_bytes). Derived results, reviews and promotions go to
# put_derived / put_review / put_promotion. No caller supplies a path to any of them.
EVIDENCE_STORE_MODULE = "tools/evidence_store.py"
STORAGE_AUTHORITY_NOTE = ("This shim has no storage authority. Evidence sessions, records, finalization and verification "
                          "are the sole responsibility of tools/evidence_store.py (EVIDENCE_STORE_AUTHORIZING).")
