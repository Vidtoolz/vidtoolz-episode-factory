# Identity model

| Layer | Field(s) | Source | Changes when |
|---|---|---|---|
| Host | `host_id`, `hostname`, `platform` | `--host-id` must equal `socket.gethostname()` (case-insensitive) | never at runtime |
| Worker | `worker_instance_id` (uuid4), `worker_generation` (persisted counter in `state-dir/generation`), `worker_started_at`, `worker_version` | worker start | every worker restart (generation +1) |
| Resolve process | `resolve.process.pid`, `resolve.process.started_at` | Windows: `Get-Process Resolve` (Id, StartTime); Linux: `/proc` scan for `/opt/resolve/bin/resolve`, start from `btime`+stat | Resolve restart |
| Resolve session | `resolve.version`, `resolve.page`, `resolve.external_scripting_mode` (read from `config.dat`) | fresh per request | |
| Project | `project.uuid` (`Project.GetUniqueId()`), `name`, `timeline_count`, library db/type/host | fresh per request | operator switches project (PRESTO case) |
| Timeline | `timeline.uuid` (`Timeline.GetUniqueId()`), `name`, start/end | fresh per request | operator changes timeline |

Guards (caller supplies `expected`): `worker_instance_id` → `WORKER_GENERATION_MISMATCH`; `resolve_pid` /
`resolve_start_time` → `RESOLVE_SESSION_CHANGED`; `project_uuid` → `PROJECT_NOT_OPEN` / `PROJECT_IDENTITY_MISMATCH`;
`timeline_uuid` → `TIMELINE_IDENTITY_MISMATCH`. Live-proven 2026-09-20: worker restart on vidnux gen 1→2 with Resolve
PID 203012 unchanged; PRESTO with expected PYSTY UHD uuid → `PROJECT_IDENTITY_MISMATCH` (actual `iphone prores`).
`get_project_fingerprint` = sha256 over {uuid,name,timeline_count,current_timeline_uuid,fps,w,h}; a cheap change detector,
not a content hash and not a concurrency primitive (Resolve exposes no revision counter — v1.18 SNAPSHOT-CONCURRENCY-RECOVERY).
