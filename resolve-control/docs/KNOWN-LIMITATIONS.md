# Known limitations (Phase 1)

1. **Operator-started, not boot-persistent.** Workers/tunnels live only while the vidnux ssh sessions / user process live
   (by doctrine: no cron/systemd/autostart/scheduled tasks). After a reboot or logout someone runs `vrc tunnel-up` again.
2. **Windows worker latency ~220–360 ms** per call: `resolve_process()` shells to PowerShell `Get-Process` on every request.
   Acceptable for Phase 1 read-only; cache-with-TTL is a Phase 2 option (must keep PID-change detection honest).
3. **TIMEOUT does not interrupt Resolve.** The pool thread keeps running until the API returns; repeated timeouts could pile
   up threads (pool of 4). No live TIMEOUT case occurred.
4. **Fingerprint ≠ change detection.** Only a handful of settings/identity fields; timeline content changes are invisible.
   No revision counter exists in Resolve (v1.18 doctrine unchanged).
5. **Windows secret file ACL** relies on the user-profile default; `icacls` hardening not applied (would be a host change
   outside the stated "no host configuration changes" envelope — flagged for Mikko).
6. **`--exit-with-session` needs one PowerShell call at startup** (process-tree walk). If sshd's process model changes it
   refuses to start (`SESSION_ANCHOR_REQUIRED`) rather than running unanchored.
7. **Registry health is caller-local** (in-memory in the CLI/Client process); `vrc status` performs live health calls.
   A long-lived registry daemon is not part of Phase 1.
8. **Journals are append-only JSONL without rotation** (caller: `~/.config/vidtoolz-resolve-control/journal.jsonl`;
   worker: `<state-dir>/journal.jsonl`).
9. **Hermes adapter not built.** `vrc.client.Client` is the seam; TRANSPORT.md's MCP facade remains rhetorical.
10. **No write path at all** — by design. Nothing here evidences write safety; see v1.18 `EXCLUSIVE_SESSION_REQUIRED_FOR_WRITES`.
