# Architecture (Phase 1)

```
vidnux (operator / future Hermes adapter)
  python3 -m vrc <op> --target presto|vidlap2|vidnux      explicit target, no default, no fallback
      │  Registry (~/.config/vidtoolz-resolve-control/registry.json): host_id -> transport, port, secret file
      │  HMAC-SHA256 signed JSON envelope, POST /v1/op
      ├── vidnux  : 127.0.0.1:47021  ── worker (user process) ── scriptapp("Resolve") ── local Resolve 21.1.0.14
      ├── presto  : 127.0.0.1:47121 ══ ssh -L (session-bound) ══> PRESTO  127.0.0.1:47021 ── worker ── local Resolve
      └── vidlap2 : 127.0.0.1:47221 ══ ssh -L (session-bound) ══> VIDLAP2 127.0.0.1:47021 ── worker ── local Resolve
```

* **Worker** (`worker/resolve_worker.py`): binds `127.0.0.1` only (refuses any other `--bind` with `LOOPBACK_ONLY`);
  refuses to start if `--host-id` ≠ hostname (`HOST_ID_MISMATCH`); imports the vendor `DaVinciResolveScript` and calls
  `scriptapp("Resolve")` with **no host argument** — a static test asserts every `scriptapp(` call site has exactly one
  argument. Snapshot of Resolve/project/timeline identity is taken fresh on every request; nothing about the project is cached.
* **Session-bound remote workers**: on Windows the worker *is the remote command* of a vidnux-originated `ssh -L` session.
  `--exit-with-session` anchors the worker to its nearest `sshd.exe` ancestor and exits when that process exits
  (live finding: Windows OpenSSH leaves `cmd→py→python` alive after the session dies; the anchor closes that). No service,
  scheduled task, autostart, or firewall rule exists or is needed. Starting a worker is an operator act (`vrc tunnel-up`).
* **Control plane** (`vrc/`): `Registry` resolves the target *before anything else* (`TARGET_REQUIRED`, `TARGET_UNKNOWN`),
  `transport.send` speaks only to `127.0.0.1:<port>`, `Client` validates that the answering `host_id` is the requested one
  (`TARGET_MISMATCH`) and never retargets on failure. Every call is journaled (JSONL) on the caller and on the worker.
* **Expected-state guards**: the caller may pin `project_uuid`, `timeline_uuid`, `resolve_pid`, `resolve_start_time`,
  `worker_instance_id`; the worker refuses with the matching structured error when live state differs.
* **Timeouts**: the worker runs each operation in a pool thread and returns `TIMEOUT` at the deadline; the Resolve call
  itself is not interruptible (documented containment: the thread finishes in the background, result discarded).
* **Not in Phase 1**: Hermes adapter, MCP facade, write lease, any write operation, project switching, cross-host
  orchestration. Forbidden by design: `Hermes → worker → arbitrary Python → Resolve` (no `exec`/`eval`/script upload path).
