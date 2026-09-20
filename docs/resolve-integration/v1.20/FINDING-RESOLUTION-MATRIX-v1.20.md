# v1.20 finding map

Bounded P3 items from the v1.19 independent review and the Phase 1 freeze review, with dispositions (severity MINOR = non-blocking P3):

- V119-F1 (MINOR): v1.18 rejection and v1.19 repairs authored by the same agent -> CLOSED: all seven findings independently re-derived (review manifest b9247a558304bc40778b5ce7773cda2db82c82be91d5c717687c8b3c25dd8a13)
- V119-F2 (MINOR): v1.19 self-labelled CURRENT candidate -> CLOSED: 1.19.0 registered HISTORICAL - ACCEPTED; SUPERSEDED after human acceptance
- V119-F3 (MINOR): stale inherited prose and build-log label -> CLOSED in v1.20 README and tooling
- V119-F4 (MINOR): TARGET-CONTRACT library observations null; fixture placeholders -> CLOSED: real observations bound; placeholders remain fixture-only
- V119-F5 (MINOR): silence on 2026-09-20 live multi-client findings -> CLOSED: CONTROL-PLANE.md section 10; TRANSPORT.md and SNAPSHOT-CONCURRENCY-RECOVERY.md v1.20 observations
- P1-F07 (MINOR): duplicate timeline names resolve to first match -> OPEN; gate BEFORE WRITE CAPABILITY
- P1-F08 (MINOR): registry case-collapse and unstructured config errors -> OPEN; gate BEFORE HERMES FACADE
- P1-F09 (MINOR): replies not independently signed -> OPEN; gate BEFORE WRITE CAPABILITY
- P1-F10 (MINOR): fake-Resolve test hook in production module -> OPEN; gate BEFORE PERSISTENT WORKER DEPLOYMENT
- P1-F11 (MINOR): Windows Administrator context and inherited key ACL -> OPEN; gate BEFORE PERSISTENT WORKER DEPLOYMENT
- P1-F12 (MINOR): Phase 1 documentation drift -> CLOSED in v1.20 (CONTROL-PLANE.md from pinned source)
- P1-R01 (MINOR): precondition capture hygiene -> CLOSED by hash-pinned evidence index
- P1-R02 (MINOR): A3 and launch recipe not minted through the evidence store -> DOCUMENTED evidence class; canonical minting BEFORE WRITE CAPABILITY
- P1-R03 (MINOR): port-1144 wording: Local scripting is protocol-closed while vendor sockets may stay bound -> CLOSED: TARGET-CONTRACT session network_port_1144 semantics field
- P1-R04 (MINOR): worker reads live configuration paths -> DOCUMENTED; stronger pinning BEFORE WRITE CAPABILITY
- P1-R05 (MINOR): fixture playback fps 24 vs timeline fps 25 -> RECORDED fixture observation; no effect on read-only qualification

No operational qualification, write authority or human authorization beyond the recorded v1.19 acceptance is implied.
