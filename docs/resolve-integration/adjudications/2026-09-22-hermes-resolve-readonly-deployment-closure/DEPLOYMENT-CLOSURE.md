# Deployment closure — Hermes Resolve read-only integration (2026-09-22)

Additive continuation of the production deployment record (d8e1cf75…, 86ab3022). Machine form `DEPLOYMENT-CLOSURE.json`, record_id `668aeaf6182c1b5d…`. Descriptive only.

- Gateway manually restarted by Mikko (`sudo systemctl restart hermes-gateway`): pid 10461 → **172401**, active since 2026-09-22 07:57:58 EEST, result success, unit file unchanged; control socket `identify` → pid 172401, code 524041b9 (0.21.4).
- Served registry: gateway warm-up function reproduced with the gateway's venv/HERMES_HOME/config → 25 schemas, equal to the gateway's own log; registry holds exactly nine `resolve_*` tools (toolset vidtoolz_resolve, deferred behind tool_search), closed schemas, no write tool, no generic executor. Registered-handler probes: `WORKER_OFFLINE` (presto, vidlap2), `TARGET_REQUIRED` (no target).
- Status: **DEPLOYED AND ACTIVE IN GATEWAY**. Workers: none; operator-started temporary only.
- Library gate: qualification-library-only under the current registry and the frozen worker's prohibitions → Hermes can read the three qualification fixtures, not production projects. Broadening is a separate governance/authority step.
- Operations guide: `docs/resolve-integration/HERMES-RESOLVE-READONLY-OPERATIONS.md`.
- `WRITE AUTHORITY = NONE` · `PERSISTENT WORKER AUTHORITY = NONE` · External Scripting Local.
