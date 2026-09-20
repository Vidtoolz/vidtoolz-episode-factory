# Transport responsibilities v1 (FROZEN_NOW)

| Layer | MUST | MUST NOT |
|---|---|---|
| AGENT (Hermes, Codex, Claude) | propose plans from canonical EF state; request inspections; submit authorized frozen plan ids; read transactions/drift; escalate to Mikko | emit Resolve verbs or Python; hold Resolve credentials; treat Resolve state as approval |
| MCP (agent boundary only) | typed VIDTOOLZ facade over the adapter service: `inspect_target`, `propose_plan`, `submit_authorized_plan`, `read_transaction`, `reconcile_incomplete`; asynchronous, returns transaction ids; disconnect never replays | expose `run_script`, `run_script_unsafe`, `execute_python`, `execute_lua`, raw LUT/library/admin tools in production. Official Blackmagic server (`/opt/resolve/DaVinciResolve.mcpb`) only in a separately authorized scratch-exploration scope |
| VIDTOOLZ RESOLVE ADAPTER (Node service + Python worker; single writer; durable jobs) | authority checks against EF pins; canonicalization/hashing; plan freezing; journal PREPARED before any mutator; lease; preflight; guarded apply; readback; expected-delta verification; publication under EF compare-and-swap; conflict/recovery state machine | accept script strings, free-form paths or raw verbs; operate without a frozen plan digest; write outside destination/owned objects |
| RESOLVE SCRIPTING API (`DaVinciResolveScript` via `/opt/resolve/bin/ResolvePython` 3.14 or external interpreter with `RESOLVE_SCRIPT_API`/`RESOLVE_SCRIPT_LIB`) | bounded typed observations and single mutators; every result captured; `False`/`nil`/timeout → `MUTATION_OUTCOME_UNKNOWN` pending readback | be assumed atomic, undoable or transactional |
| DAVINCI RESOLVE 21.1 Studio | execution environment; authoritative only for what Mikko did inside it | be treated as production truth |

Decision: the deterministic adapter calls the scripting API directly. MCP is a protocol, not a nondeterminism source; the vendor server is excluded from production because raw script execution bypasses VIDTOOLZ governance and has a 60 s per-call ceiling.


## v1.20 realisation and observations (2026-09-20)

The deterministic read path now exists as the Resolve Control Plane Phase 1 (`CONTROL-PLANE.md`): per-host workers bound to
127.0.0.1 attach to their own Resolve with a local `scriptapp("Resolve")`; remote hosts are reached only through SSH-forwarded
loopback ports with authenticated `vrc.v1` requests; the target is always explicit. Native network scripting
(External Scripting = Network) was observed live to be unauthenticated LAN control and is prohibited as a production control
path; Local mode refuses remote scripting sessions at the protocol layer even though the vendor sockets may remain bound to
non-loopback interfaces. The MCP facade remains rhetorical; the Hermes facade is ABSENT. WRITE AUTHORITY = NONE.
