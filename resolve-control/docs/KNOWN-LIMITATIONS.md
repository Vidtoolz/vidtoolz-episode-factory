# Known limitations (Phase 1, 0.1.1)

Closed by the 0.1.1 repair (independent review 2026-09-20): **F-01** replay after worker restart (durable nonce guard),
**F-02** hung-Resolve pool exhaustion (saturation refusal + slot-free health), **F-03** abnormal-SSH-loss orphan window
(controller-path probe, bounded ≈3.5 min; clean teardown still via sshd anchor), **F-04** unjournaled security/protocol
failures (all refusals journaled, lock + fsync). Incidentally fixed inside that work: invalid `deadline_ms` now a structured 400
(F-05); worker journal fsync + lock (F-06). Still open (P3, documented, not repaired): duplicate timeline names resolve to the
first match (F-07); registry case-collapse and unstructured config errors (F-08); unauthenticated reply envelopes (F-09);
`VRC_FAKE_RESOLVE` hook present in the production file (F-10); Windows workers run as Administrators and `worker.key` keeps the
inherited profile ACL — hardening before persistent deployment (F-11); minor documentation drift risk (F-12).

Qualification status: Phase 1 acceptance qualification under v1.18 §A4 is **BLOCKED** (see `QUALIFICATION-GATE.md`).

1. **Operator-started, not boot-persistent.** Workers/tunnels live only while the vidnux ssh sessions / user process live
   (by doctrine: no cron/systemd/autostart/scheduled tasks). After a reboot or logout someone runs `vrc tunnel-up` again.
2. **Windows worker latency ~220–360 ms** per call: `resolve_process()` shells to PowerShell `Get-Process` on every request.
   Acceptable for Phase 1 read-only; cache-with-TTL is a Phase 2 option (must keep PID-change detection honest).
3. **TIMEOUT does not interrupt Resolve.** A stuck slot stays stuck until the native call returns; with all 4 slots stuck the
   worker truthfully reports `SATURATED` and refuses new Resolve work until they return (operator recovery: restart the worker).
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
