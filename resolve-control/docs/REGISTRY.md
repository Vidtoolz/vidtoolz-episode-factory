# Registry and health states

`~/.config/vidtoolz-resolve-control/registry.json` (example: `registry.example.json`). Keys are logical targets
(`presto`, `vidlap2`, `vidnux`); `host_id` is the key. Fields: `transport` (`local` | `ssh`), `port` / `local_port` +
`remote_port`, `secret_file`, and for ssh: `ssh_alias` (from `~/.ssh/config`) and `remote_command` (the worker command, with
`--exit-with-session`). Secrets never live in the registry.

Routing rule: **by host_id only**. Which project a host has open is reported, never used for routing. There is no
"default", "any", "first available", or "the host that has project X" resolution and none must be added.

Health states (from the most recent reply to that host; thresholds `current_s=15`, `stale_s=60`):
`ONLINE_CURRENT` (reply ≤ 15 s ago, Resolve available) · `STALE` (15–60 s) · `OFFLINE` (no reply / > 60 s / unreachable)
· `RESOLVE_UNAVAILABLE` (worker answered but `scriptapp` returned no handle). Live-proven with tightened thresholds
(5 s / 12 s): ONLINE_CURRENT → STALE at 6 s → OFFLINE at 13 s → ONLINE_CURRENT on the next successful call; killing the ssh
session → `WORKER_OFFLINE` within 4 s and the remote worker exits itself (`SESSION_ANCHOR_EXITED` in its journal).
