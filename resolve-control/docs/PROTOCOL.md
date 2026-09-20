# Protocol `vrc.v1`

Transport: HTTP/1.1 `POST /v1/op` to a loopback address, body = JSON request envelope. Any other path → 404
`UNSUPPORTED_OPERATION`. GET is not implemented.

## Authentication (per request)
Headers `X-VRC-Timestamp` (unix seconds), `X-VRC-Nonce` (random hex), `X-VRC-Signature` =
`HMAC-SHA256(secret, "{ts}.{nonce}.{METHOD}.{PATH}.{sha256(body)}")`. Worker rejects with HTTP 401 `AUTHENTICATION_FAILED`
when headers are missing, |skew| > 120 s, signature mismatch (constant-time compare), or nonce already seen (replay cache).
One secret per worker (≥ 32 bytes), held only in `secret_file` (vidnux, 0600) and `worker.key` (host user profile).
Authentication is checked **before** the body is parsed or routed.

## Request envelope
```json
{"protocol":"vrc.v1","request_id":"<hex>","created_at":"<iso>","caller":"vrc-cli","op":"get_current_project",
 "target_host":"presto","params":{},"expected":{"project_uuid":"...","timeline_uuid":"...","resolve_pid":43100,
 "resolve_start_time":"...","worker_instance_id":"..."},"deadline_ms":20000}
```
`target_host` is mandatory; the worker refuses `TARGET_REQUIRED` if absent and `TARGET_MISMATCH` if it is not its own host_id.

## Response envelope
```json
{"protocol":"vrc.v1","request_id":"...","host_id":"PRESTO","worker":{"host_id","hostname","platform","worker_instance_id",
 "worker_generation","worker_started_at","worker_version","protocol"},"mode":"READ_ONLY","write_authority":"NONE",
 "write_lease":null,"observed_at":"<iso>","ok":true,
 "resolve":{"available":true,"product":"DaVinci Resolve Studio","version":"21.1.0.14","page":"edit",
            "process":{"pid":43100,"started_at":"..."},"external_scripting_mode":"LOCAL"},
 "project":{"name","uuid","timeline_count","library":"EKA","library_type":"PostgreSQL","library_host":"192.168.50.199"},
 "timeline":{"name","uuid","start_frame","end_frame"},"result":{...},"duration_ms":224}
```
Errors: `ok:false`, `error:{code,message,detail}`; HTTP 409 for operation errors, 401 for `AUTHENTICATION_FAILED` / `REPLAY_DETECTED`,
400 malformed JSON or invalid `deadline_ms` (integer 1..600000), 413 body > 1 MiB, 404 wrong path, 500 handler exception (all `TRANSPORT_ERROR`
except auth). New in 0.1.1: `REPLAY_DETECTED` (durable nonce guard, survives worker restart), `WORKER_SATURATED` (all Resolve slots busy —
refused immediately, never queued), `LIBRARY_MISMATCH` (§A4 qualification-library gate).

**Ordering inside the worker (0.1.1):** read body (size-bounded) → `verify()` = headers → skew → HMAC → **durable nonce record** → path →
JSON → `deadline_ms` → target check → `READ_ONLY_MODE`/`UNSUPPORTED_OPERATION` gate → [pool slot or `WORKER_SATURATED`] → Resolve
attach → `GetCurrentDatabase()` → **library gate** → project/timeline snapshot → expected-state guards → operation → **worker journal
(lock + fsync)** → respond. Every refusal before execution is also journaled (`AUTH_FAILED`, `REPLAY_DETECTED`, `BAD_PATH`,
`MALFORMED_JSON`, `BAD_ENVELOPE`, `BODY_TOO_LARGE`, `HANDLER_EXCEPTION`) with method/path/client port/request_id — never headers, keys or bodies.

**`health` (0.1.1)** never waits on a Resolve slot: it reports worker liveness, `resolve.pool {capacity,inflight,stuck,state}` and a bounded
(≤3 s) Resolve probe (`probe: OK | TIMEOUT | SKIPPED_SATURATED | RESOLVE_UNAVAILABLE | LIBRARY_MISMATCH`) plus `last_observed`.
A lost response after the worker journal line leaves both journals with the same `request_id` (worker: executed; caller: error).
