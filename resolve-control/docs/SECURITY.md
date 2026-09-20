# Security model (Phase 1)

Threat addressed: the audited 2026-09-20 state where PRESTO/VIDLAP2 ran Resolve External Scripting = Network, i.e. any LAN
peer could drive Resolve unauthenticated. Mikko set both to **Local**; this system keeps them there and never needs Network.

* **No remote Resolve API exposure.** Workers call `scriptapp("Resolve")` locally only (static test); Resolve's own ports
  (1144/49152/15000) are not forwarded, proxied or referenced. `pinghosts` discovery is not used.
* **Loopback only, twice.** Worker binds 127.0.0.1 (enforced in `main`, tested). Windows workers are reached only via
  `ssh -L 127.0.0.1:<local>:127.0.0.1:47021`, so the LAN sees only the pre-existing sshd:22. Verified 2026-09-20:
  TCP 47021 on 192.168.50.187 / .233 not reachable from vidnux.
* **Authenticated, replay-resistant transport.** Per-worker 32-byte secret, HMAC-SHA256 over ts+nonce+method+path+body
  hash, 120 s skew window, **durable** nonce guard (0.1.1; only signature-verified nonces are recorded, so invalid signatures
  cannot poison it), constant-time compare; 401 before any parsing. Wrong key → `AUTHENTICATION_FAILED`; replay → `REPLAY_DETECTED`.
  Replies are not authenticated (SSH + loopback are the integrity boundary).
* **Explicit target, no fallback, worker self-check.** `TARGET_REQUIRED` / `TARGET_UNKNOWN` at the caller,
  `TARGET_MISMATCH` at the worker (proven: envelope for vidlap2 sent over PRESTO's channel is refused by PRESTO).
* **Read-only by construction.** Allowlist of 9 operations; `FORBIDDEN_OPS` (Append/Import/Create/Delete/Set*/Save/Quit/
  Render/Export/exec/eval/run_script) refused with `READ_ONLY_MODE` *before* the Resolve snapshot (static ordering test +
  live proof: 0–1 ms, no `resolve` block in the reply). Unknown names → `UNSUPPORTED_OPERATION`. No code-upload or
  script-execution path exists.
* **Lifecycle containment.** No service/task/autostart/firewall change. The sshd-ancestor anchor ends the worker on clean session
  teardown; the controller-path probe (0.1.1) bounds abnormal-loss survival to ≈3.5 min (60 s × 3 misses + probe timeouts).
  Worker restart is visible (`worker_generation`, `worker_instance_id`) and pinnable; replay protection survives restart.
* **Secrets.** vidnux: `~/.config/vidtoolz-resolve-control/secrets/*.key` (0600, dir 0700). Windows:
  `%USERPROFILE%\.vidtoolz-resolve-worker\worker.key` (profile ACL only — NTFS ACL hardening not applied, see limitations).
  Secrets appear in no log, journal, response, report or repo file.
* **Residual / not addressed.** A process running as the same Windows user could read `worker.key` or talk to the local
  worker (read-only). sshd on the Windows hosts is the actual perimeter — its key policy is unchanged and out of scope.
  Resolve's own sockets still bind 0.0.0.0 with protocol-level refusal (Mode=Local) — Blackmagic behaviour, not ours.
