# Hermes Resolve read-only integration — temporary worker operations (v1, 2026-09-22)

Operator guide for making ONE qualified Resolve host temporarily readable by Hermes through the accepted read-only facade
(candidate 8e068fea, deployed in `~/.hermes/plugins/vidtoolz-resolve-readonly`, nine tools). This document sits beside the frozen
v1.20 bundle and grants no authority: `WRITE AUTHORITY = NONE`, `PERSISTENT WORKER AUTHORITY = NONE`, External Scripting = Local,
no fallback, no generic executor. Workers are started by the operator, live only while needed, and are stopped afterwards.

## 0. What Hermes can read today (read this first)
Every production target carries the worker gate `--require-library "VIDTOOLZ Resolve Qualification v1"` (vidnux additionally `=/home/vidtoolz/outputs/resolve-qualification-library`).
The frozen worker (sha 371caf13) fails every Resolve op closed with `LIBRARY_MISMATCH` unless the OPEN Project Library is that Disk library, and it
hard-refuses `EKA`, `EKA192.168.50.199`, `nelja`, `Local Database` regardless of the flag (pinned `PROHIBITED_LIBRARIES`).
**Therefore Hermes can currently read only the three qualification fixtures** (`VIDTOOLZ_RESOLVE_QUAL_V1_PRESTO`, `…_PHASE1` on vidnux, `…_VIDLAP2`).
Reading real production projects requires a separate, independently reviewed library-authority extension (registry gate change = change to the
qualified control path; EKA/nelja/Local Database = new frozen worker + Phase 1 re-review). Do not edit `registry.json` or the worker flags to get around this.

## 1. Prerequisites (all targets)
- Resolve is ALREADY running on the target, started by a human. The worker never starts Resolve. If it is not running the facade answers `WORKER_OFFLINE` (no worker) or the worker answers `RESOLVE_UNAVAILABLE`.
- External Scripting = Local on the target (never change it; never Network).
- The Disk library `VIDTOOLZ Resolve Qualification v1` is the CURRENT library in Resolve (see §0), with the host's fixture project open.
- Exact worker bytes: sha256 `371caf131e5d21cdb8b5f3e505934154b7ee835427d25d9683d51013d345f4b3`. Check before every start; on mismatch STOP (`WORKER_SOURCE_MISMATCH`), never replace silently.
- No existing worker/tunnel for that target: `ss -ltn | grep -E ':(47021|47121|47221) '` empty for the ports involved; pid files under `~/.config/vidtoolz-resolve-control/{tunnels,state}` may be stale from earlier sessions — check the pid is alive before trusting them.
- Frozen tree on vidnux: `export PYTHONPATH=~/resolve-authority-freeze-v1.20/resolve-control` (all `python3 -m vrc …` commands below assume it).
- Secrets: `~/.config/vidtoolz-resolve-control/secrets/<host>.key` (0600) on vidnux; `%USERPROFILE%\.vidtoolz-resolve-worker\worker.key` on Windows. Never print or copy them.

## 2. PRESTO (Windows, target `presto`) — temporary worker + temporary SSH tunnel
Preflight (from vidnux):
```
ping -c1 192.168.50.187 && ssh -o BatchMode=yes presto hostname          # identity: hostname PRESTO, user presto
ssh presto 'powershell -NoProfile -Command "@(Get-Process Resolve).Count; (Get-FileHash -Algorithm SHA256 $env:USERPROFILE\.vidtoolz-resolve-worker\resolve_worker.py).Hash"'
#   -> 1 (Resolve running) and 371CAF13…  ; scripting mode is read live by the worker (health.external_scripting_mode must be LOCAL)
ss -ltn | grep ':47121 ' || echo free                                     # local forward port free
```
Start (one command; the worker runs INSIDE the ssh session with `--exit-with-session`, loopback 127.0.0.1:47021 on PRESTO, forwarded to 127.0.0.1:47121 on vidnux; controller pid written to `~/.config/vidtoolz-resolve-control/tunnels/presto.pid`):
```
python3 -m vrc tunnel-up --target presto
```
Verify (control plane first, then the Hermes facade path):
```
python3 -m vrc health --target presto        # expect ok, resolve.library.name == qualification library, external_scripting_mode LOCAL
python3 -m vrc identify --target presto      # expect host_id PRESTO, version 21.1.0.14, project VIDTOOLZ_RESOLVE_QUAL_V1_PRESTO 38609cb5…
```
Then in Hermes: `resolve_health(target="presto")`, `resolve_identify(target="presto")`.
Use: Hermes may issue only the nine read tools with `target="presto"`.
Stop:
```
kill $(cat ~/.config/vidtoolz-resolve-control/tunnels/presto.pid)      # ssh controller exits -> remote worker exits with the session
```
Verify cleanup: `ss -ltn | grep ':47121 '` empty; `ssh presto 'powershell -NoProfile -Command "@(Get-NetTCPConnection -State Listen -LocalPort 47021).Count"'` → 0; Hermes `resolve_health(presto)` → `WORKER_OFFLINE`. Leave Resolve running.

## 3. VIDLAP2 (Windows, target `vidlap2`) — same pattern, ports 47221→47021
Preflight: identity by host key (`ssh-keyscan -t ed25519 <addr>` must show SHA256:CCko0i+bWyHtzmGywsY8STtNgF1DWURuegL/4QtBUIo; hostname vidlap2, user mjp77; the address can move with DHCP — never trust `192.168.50.233` alone); Resolve running; worker hash 371caf13 at `C:\Users\mjp77\.vidtoolz-resolve-worker\resolve_worker.py`; `ss -ltn | grep ':47221 '` empty.
Start: `python3 -m vrc tunnel-up --target vidlap2` (controller pid → `tunnels/vidlap2.pid`).
Verify: `python3 -m vrc health --target vidlap2`, `identify` → host_id VIDLAP2, project VIDTOOLZ_RESOLVE_QUAL_V1_VIDLAP2 5bd68676…; then Hermes `resolve_health/identify(target="vidlap2")`.
Stop: `kill $(cat ~/.config/vidtoolz-resolve-control/tunnels/vidlap2.pid)`; verify 47221 gone locally and 47021 gone on VIDLAP2; Hermes → `WORKER_OFFLINE`.

## 4. vidnux (local, target `vidnux`) — temporary local worker, no tunnel
Preflight: Resolve running (`readlink /proc/<pid>/exe` = /opt/resolve/bin/resolve; note `pgrep -x resolve` does NOT match — the process comm is "GUI Thread"); for qualification-fixture reads use the isolated session recipe (cwd /opt/resolve, DISPLAY=:1, `BMD_RESOLVE_{SUPPORT,CONFIG,LOGS}_DIR` + `XDG_CACHE_HOME` under `~/resolve-qualification-session/`; its `.dblist` registers only the qualification library) — a human starts it; scripting Mode=1 in `~/.local/share/DaVinciResolve/configs/config.dat` (R-04: the worker reads the live config path); `sha256sum ~/resolve-authority-freeze-v1.20/resolve-control/worker/resolve_worker.py` = 371caf13…; `ss -ltn | grep ':47021 '` empty.
Start (session-owned, no systemd, no restart policy):
```
ST=~/.config/vidtoolz-resolve-control/state/vidnux
PYTHONDONTWRITEBYTECODE=1 setsid nohup python3 -B ~/resolve-authority-freeze-v1.20/resolve-control/worker/resolve_worker.py \
  --host-id vidnux --secret-file ~/.config/vidtoolz-resolve-control/secrets/vidnux.key --state-dir $ST \
  --require-library "VIDTOOLZ Resolve Qualification v1=/home/vidtoolz/outputs/resolve-qualification-library" \
  > $ST/vidnux-worker.log 2>&1 < /dev/null & echo $! > $ST/vidnux-worker.pid
```
Verify: `python3 -m vrc health --target vidnux`, `identify` → host_id vidnux, project VIDTOOLZ_RESOLVE_QUAL_V1_PHASE1 7ac4210e…; Hermes `resolve_health/identify(target="vidnux")`.
Stop: `kill $(cat $ST/vidnux-worker.pid)`; verify `ss -ltn | grep ':47021 '` empty and `pgrep -af resolve_worker.py` empty; Hermes → `WORKER_OFFLINE`. Leave Resolve as the human left it.

## 5. Status vocabulary (frozen protocol, do not rename)
`python3 -m vrc status` prints per target: `status` (registry view), `probe` (OK / LIBRARY_MISMATCH / RESOLVE_UNAVAILABLE / TIMEOUT / SKIPPED_SATURATED), `pool` (HEALTHY / DEGRADED / SATURATED), worker instance, gen, library, Resolve version/pid, project, timeline. Facade/client error codes: TARGET_REQUIRED, TARGET_UNKNOWN, TARGET_MISMATCH, WORKER_OFFLINE, WORKER_STALE, WORKER_GENERATION_MISMATCH, WORKER_SATURATED, RESOLVE_UNAVAILABLE, LIBRARY_MISMATCH, PROJECT_IDENTITY_MISMATCH, TIMELINE_IDENTITY_MISMATCH, READ_ONLY_MODE, UNSUPPORTED_OPERATION, TRANSPORT_ERROR, … (frozen `vrc/errors.py`).
Operator mapping: OFFLINE = `WORKER_OFFLINE`; STARTING = tunnel/worker launched but port not yet listening (wait ≤ 40 s); ONLINE_CURRENT = health ok + probe OK; STALE = `WORKER_STALE`/generation mismatch (stop and restart the worker); SATURATED = pool SATURATED / `WORKER_SATURATED` (wait, do not add a second worker); RESOLVE_UNAVAILABLE = worker up, Resolve down/unreachable (human starts Resolve).

## 6. Failure procedure (no fallback, no authority-expanding "repair")
| Symptom | Meaning | Operator response |
|---|---|---|
| `WORKER_OFFLINE` | no worker/tunnel for that target | start per §2–4; never route to another host |
| `RESOLVE_UNAVAILABLE` | worker up, Resolve not running/attachable | human starts Resolve; do not auto-launch |
| `LIBRARY_MISMATCH` | open library ≠ qualification library, or a prohibited library | in Resolve, switch to the qualification library (human, GUI). The facade hides the `actual` library (P3-A): read `~/.config/vidtoolz-resolve-control/journal.jsonl` / worker `state/journal.jsonl` or `python3 -m vrc health` |
| `WORKER_SOURCE_MISMATCH` (preflight hash) | worker bytes differ from 371caf13 | STOP; do not start; restore from the frozen tree only after recording what was found |
| port occupied | stale/foreign listener on 47021/47121/47221 | identify the owner (`ss -ltnp`); stop only a stale vrc worker/controller of yours; never rebind elsewhere |
| host unreachable / SSH failure | network or host down | fix reachability by human means; identity by host key before reuse |
| `WORKER_STALE` / `WORKER_GENERATION_MISMATCH` | worker restarted under the caller | stop and restart the worker; re-verify |
| `WORKER_SATURATED` / pool SATURATED | 2 in-flight Resolve calls | wait; do not add workers |
| `TARGET_MISMATCH` | envelope target ≠ worker host_id | configuration/routing problem — stop, inspect registry; never "fix" by retargeting |
| `PROJECT_IDENTITY_MISMATCH` | caller's expected project ≠ open project | expected behaviour; re-check which project is open; never switch projects from Hermes |
| `TARGET_REQUIRED` | Hermes call without target | expected; name the host |

## 7. Multi-host
Ports are distinct per target (vidnux 47021 local; PRESTO via 47121; VIDLAP2 via 47221), routing is explicit with no fallback, and all three workers ran concurrently during Phase 1 qualification (2026-09-20). Facade-level cross-target isolation with two live workers was NOT exercised in R5–R7 (N/A). **Conservative current mode: one host at a time.** Simultaneous read workers are architecturally permitted for explicit targets; confirm with a two-host isolation run before relying on it.

## 8. Hermes-side notes
- The nine tools are registered in toolset `vidtoolz_resolve` and are deferred behind `tool_search` in the model-facing set (Hermes finds them by searching "resolve"); the registry itself always holds exactly nine.
- P3-A: facade health omits `library_gate` detail — use `python3 -m vrc health` or the journals for the actual library name. P3-B: facade `worker.generation`/`version` show null; the raw envelope and `vrc status` show the real values. Do not patch the deployed plugin.
- There are no Hermes tools to start/stop workers or tunnels, by design; lifecycle stays operator-side.
- Future Stream Deck mapping (not implemented, no authority granted): "<host> Resolve Read Worker ON" = §2/§3 `tunnel-up` or §4 start block; "OFF" = the matching kill + cleanup check. Each button would wrap the exact commands above, nothing more.

## 9. Safety boundaries (restated)
No writes, no markers, no imports, no project/timeline switching from Hermes, no renders/exports, no Network scripting, no persistent/boot workers, no services or scheduled tasks, no restart supervisors, no fallback, no generic executor. Housekeeping: after use, `~/.config/vidtoolz-resolve-control/{tunnels,state}` keep dead pid files; that is expected.
