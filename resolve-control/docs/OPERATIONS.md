# Operations

Prereqs (already in place 2026-09-20): `~/.config/vidtoolz-resolve-control/{registry.json,secrets/*.key}` on vidnux;
`%USERPROFILE%\.vidtoolz-resolve-worker\{resolve_worker.py,worker.key,state\}` on PRESTO (user `presto`) and VIDLAP2
(user `mjp77`). Deploy/update a Windows worker: `scp resolve-control/worker/resolve_worker.py <alias>:.vidtoolz-resolve-worker/`.

```bash
export PYTHONPATH=~/resolve-control-plane-phase1/resolve-control      # or the merged checkout
# vidnux worker (user process, loopback)
setsid nohup python3 $PYTHONPATH/worker/resolve_worker.py --host-id vidnux \
  --secret-file ~/.config/vidtoolz-resolve-control/secrets/vidnux.key \
  --state-dir  ~/.config/vidtoolz-resolve-control/state/vidnux > ~/.config/vidtoolz-resolve-control/state/vidnux-worker.log 2>&1 &
# Windows workers, each bound to one ssh session
python3 -m vrc tunnel-up --target presto
python3 -m vrc tunnel-up --target vidlap2
python3 -m vrc status
python3 -m vrc get_current_project --target presto
python3 -m vrc get_current_timeline --target vidnux --expect-project-uuid 1082f8ac-0803-4335-a0d7-f42bbbe207b6
```
Stop: `kill $(cat ~/.config/vidtoolz-resolve-control/tunnels/<host>.pid)` — the remote worker exits with the session;
vidnux worker: `kill $(cat ~/.config/vidtoolz-resolve-control/state/vidnux-worker.pid)`.
Never start a worker with `--bind` other than 127.0.0.1 (it refuses). Never re-enable Resolve Network scripting.
