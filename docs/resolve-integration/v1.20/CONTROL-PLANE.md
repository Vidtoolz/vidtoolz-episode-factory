# CONTROL-PLANE.md — Resolve Control Plane Phase 1, the accepted read-only control substrate (v1.20, FROZEN_NOW)

**WRITE AUTHORITY = NONE. AUTOMATED RESOLVE WRITES ARE NOT QUALIFIED. HERMES FACADE = ABSENT.**

This document freezes, as authority, the Resolve Control Plane Phase 1 that was implemented, repaired, independently reviewed
and qualified on 2026-09-20 under §A4/§A5 of `ADJUDICATION-FREEZE-CONTRACT.md` (scope adjudication commit `91bf571e`:
`resolve-control` is a **subordinate implementation layer** of this authority, not a parallel safety/control authority). The
implementation is pinned byte-exactly in `PHASE1-SOURCE-PIN.json` (commit `77c26103`, worker sha256
`371caf131e5d21cdb8b5f3e505934154b7ee835427d25d9683d51013d345f4b3`, component `resolve-control-plane phase1 0.1.1`, protocol
`vrc.v1`); its qualification is recorded in `PHASE1-QUALIFICATION-RECORD.json`. Nothing here weakens any earlier doctrine; where
this document is silent, the existing v1.19 doctrine (unchanged in v1.20) governs.

## 1. What the substrate is
VIDTOOLZ can identify and **read** from explicitly selected DaVinci Resolve instances (PRESTO, VIDLAP2, vidnux) through
authenticated, host-local workers. It cannot mutate anything. The architecture:

```
caller (operator CLI today; future Hermes facade — a later, separately gated capability)
   → explicit target (`presto` | `vidlap2` | `vidnux`)          no default target, no fallback, no "any"
   → registry (host_id → transport, port, secret file)          routing by host_id only, never by open project
   → authenticated vrc.v1 request (HMAC-SHA256)
   → transport: local loopback, or an SSH session from the controller forwarding controller-loopback → host-loopback
   → worker bound to 127.0.0.1 on that host
   → local `scriptapp("Resolve")` (no host argument, ever)
   → the Resolve process running on that host
```
Production use of native remote Resolve scripting (`scriptapp("Resolve", <remote host>)`, Resolve External Scripting = Network)
is **prohibited** as a VIDTOOLZ control path. Resolve External Scripting remains **Local** on every host. Local mode refuses
remote scripting sessions at the protocol layer; the vendor's scripting sockets (TCP 1144/49152/15000) may nonetheless remain
bound to non-loopback interfaces — "closed" in `TARGET-CONTRACT.json#session.network_port_1144` means *protocol-closed*, not
an unbound socket.

## 2. Identity model (frozen hierarchy)
1. `host_id` — must equal the worker host's hostname; every envelope names its `target_host`, the worker refuses a mismatch.
2. worker instance id + **generation** (persisted counter) — a restarted worker is a different worker; a pinned stale instance is refused.
3. Resolve process identity — PID + start time, reported on every reply; a caller may pin it.
4. **project UUID** — read fresh on every operation. *Resolve process identity does not imply project identity*: a human can
   switch projects without restarting Resolve (observed live on PRESTO, 2026-09-20). A pinned expected UUID is checked before
   any operation body.
5. **timeline UUID** — authoritative timeline identity; names are convenience selectors and may be ambiguous (duplicate names
   resolve to the first match — see KNOWN-LIMITATIONS-PHASE1.md F-07).
6. qualification library identity — when the library gate is configured, the open library must be the named **Disk** library
   (registration root cross-checked) before any project read; otherwise `LIBRARY_MISMATCH`.

## 3. Public capability — the complete read-only allowlist (exact names from the pinned source)
`health`, `identify`, `get_current_project`, `get_current_timeline`, `list_timelines`, `get_project_settings`,
`get_timeline_settings`, `get_media_pool_summary`, `get_project_fingerprint`. Each maps to Resolve getters only
(`GetProjectManager`, `GetCurrentProject`, `GetCurrentDatabase`, `GetProductName`, `GetVersionString`, `GetCurrentPage`,
`GetName`, `GetUniqueId`, `GetTimelineCount`, `GetTimelineByIndex`, `GetCurrentTimeline`, `GetSetting`, `GetStartFrame`,
`GetEndFrame`, `GetTrackCount`, `GetMarkers`, `GetMediaPool`, `GetRootFolder`, `GetClipList`, `GetSubFolderList`,
`GetIsFolderStale`). Dispatch is a fixed conditional over these nine names: there is no generic method dispatch, no
`getattr` on caller input, no `exec`/`eval`, no script upload, no `run_script`. Every write-class name (`AppendToTimeline`,
`SetSetting`, `ImportMedia`, `AddMarker`, `SaveProject`, `Quit`, `StartRendering`, `ExportProject`, `DeleteTimeline`, …) is
refused with `READ_ONLY_MODE`, and any unknown name with `UNSUPPORTED_OPERATION`, **before** the Resolve API is attached.
No write lease, no mutation verb, no concurrent-write qualification, no automated timeline or project-setting modification
authority exists. v1.19's M3 material is provisional *design* for a future mutation-capable milestone; it grants nothing today.

## 4. Structured errors (vrc.v1, exact set)
`TARGET_REQUIRED`, `TARGET_UNKNOWN`, `TARGET_MISMATCH`, `WORKER_OFFLINE`, `WORKER_STALE`, `WORKER_GENERATION_MISMATCH`,
`RESOLVE_UNAVAILABLE`, `RESOLVE_SESSION_CHANGED`, `PROJECT_NOT_OPEN`, `PROJECT_IDENTITY_MISMATCH`, `TIMELINE_NOT_FOUND`,
`TIMELINE_IDENTITY_MISMATCH`, `UNSUPPORTED_OPERATION`, `READ_ONLY_MODE`, `TIMEOUT`, `TRANSPORT_ERROR`, `AUTHENTICATION_FAILED`,
`REPLAY_DETECTED`, `WORKER_SATURATED`, `LIBRARY_MISMATCH`. Every reply carries `mode: READ_ONLY`, `write_authority: NONE`,
`write_lease: null`.

## 5. Security model
Requests: HMAC-SHA256 over timestamp·nonce·method·path·body-hash with a per-host 32-byte key; ±120 s skew; **durable**
replay guard (accepted nonces persisted with fsync before acceptance, reloaded on restart, expired after 300 s) — a captured
request cannot be replayed even across a worker restart; only signature-verified nonces are recorded. Workers bind 127.0.0.1
only; remote hosts are reached solely through SSH forwarding of loopback ports; no LAN-facing RPC exists. Windows workers run
inside the controller's SSH session, anchored to their sshd ancestor, and additionally probe the controller path through a
reverse-forwarded loopback port (three consecutive misses ⇒ exit; bounded orphan window ≈3.5 min, live-proven 2 min 55 s).
Body size is bounded (1 MiB); malformed envelopes are refused structurally. **Not protected against** (outside the trust
model): a compromised controller account, root/Administrator on a worker host, a stolen per-host worker key (read-only on that
host only), the machine owner. Replies are not independently signed (integrity boundary = loopback + SSH; revisit before writes).

## 6. Session and health model
Health is a poll-age model, not push telemetry: `ONLINE_CURRENT` / `STALE` / `OFFLINE` derive from the age of the last reply;
`RESOLVE_UNAVAILABLE`, `DEGRADED`, `SATURATED`, `LIBRARY_MISMATCH` derive from the last reply's content. A hung Resolve call
occupies one of four fixed slots until it returns; when all slots are busy new Resolve work is refused at once with
`WORKER_SATURATED` and `health` still answers (it never waits on a slot). Worker restart, Resolve restart and project switch are
each detectable from every reply (generation/instance, PID/start time, project UUID).

## 7. Journal model
Caller journal (JSONL, fsync) and worker journal (JSONL, lock + fsync) share `request_id`; each operation records target,
worker identity, Resolve PID, project and timeline UUIDs, operation, result or error code, duration. Every refusal before
execution is journaled (`AUTH_FAILED`, `REPLAY_DETECTED`, `BAD_PATH`, `MALFORMED_JSON`, `BAD_ENVELOPE`, `BODY_TOO_LARGE`,
`HANDLER_EXCEPTION`) without headers, keys or body bytes. Ordering: **validate → execute → journal → respond**. Adequate for
reads; it does not provide write idempotency.

## 8. Configuration is mutable operational input
The worker reads its registry, key files, `.dblist` registration and Resolve preference file at runtime; identity gates
validate the relevant *state* (library name/type/root, project UUID, process identity) on every operation rather than
trusting configuration. Future write authority will require stronger pinning of these inputs where they influence a mutation.

## 9. Qualification (see PHASE1-QUALIFICATION-RECORD.json)
Qualified under §A4 in a dedicated isolated Resolve session on vidnux against Disk library `VIDTOOLZ Resolve Qualification v1`
(canonical `7bebd326-63b5-4359-8811-23626d862be6`) and project `VIDTOOLZ_RESOLVE_QUAL_V1_PHASE1`
(`7ac4210e-5ada-46a3-9821-831bfa83a4cc`): Q1–Q10 PASS, Q11–Q14 PASS, fixture fingerprint identical before/after, EKA contact 0.
The earlier 2026-09-20 run against `EKA` is HISTORICAL ENGINEERING EVIDENCE — NOT ACCEPTANCE QUALIFICATION. Qualification
rules (isolated session, Disk qualification library, no EKA, production session never a qualification target) are distinct
from runtime rules: production *reads* through the substrate are governed by the operator, the library gate when configured,
and the explicit-target law; they are not qualification.

## 10. Observations from the 2026-09-20 live audits carried into authority
Multiple Resolve instances can open the same shared (PostgreSQL) project simultaneously; this proves nothing about safe
autonomous mutation. Collaboration project locks are GUI/session locks that are released and re-acquired during collaboration-mesh
flicker and are not automation-grade write authority. A project may be switched without a Resolve restart. Native Network
scripting is unauthenticated LAN control and is not used by the production control architecture.
