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
Errors: `ok:false`, `error:{code,message,detail}`; HTTP 409 for operation errors, 401 for authentication, 400 malformed JSON.
Ordering inside the worker: auth → target check → `READ_ONLY_MODE`/`UNSUPPORTED_OPERATION` gate → Resolve snapshot →
expected-state guards → operation.
