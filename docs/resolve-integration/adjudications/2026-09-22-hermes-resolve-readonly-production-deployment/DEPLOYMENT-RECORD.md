# Production deployment record — Hermes Resolve read-only integration (2026-09-22)

Descriptive evidence only; grants no authority beyond `../2026-09-22-hermes-resolve-readonly-final-acceptance/` (record_id 43fc21e3…, commit f8be0e23).
Machine form `DEPLOYMENT-RECORD.json`, record_id `d8e1cf75653a71c8…`. Frozen v1.20 bytes unchanged.

| Item | Value |
|---|---|
| Deployed | facade 8e068fea (tree ba9d4316), plugin `vidtoolz-resolve-readonly` (standalone), 10 files from `git archive` of the exact commit into `~/.hermes/plugins/vidtoolz-resolve-readonly`; every installed byte == accepted blob |
| Provenance | facade branch and authority branch pushed as new remote branches (no merge, no force) |
| Enablement | `hermes plugins enable vidtoolz-resolve-readonly`; config diff: `plugins.enabled [] -> [vidtoolz-resolve-readonly]`, `plugins.disabled: []` added; nothing else |
| Hermes core | 524041b9 before and after, clean |
| Gateway | hermes-gateway.service pid 10461 **not reloaded** (sudo password required). Operator: `sudo systemctl restart hermes-gateway`. New CLI sessions already expose the nine tools |
| Production registry | real loader + ToolRegistry, default HERMES_HOME: exactly 9 `resolve_*` tools, toolset vidtoolz_resolve, schemas closed (target required, enum presto/vidlap2/vidnux, additionalProperties false, timeline_uuid required), no prohibited surface |
| Probe | registered handler `resolve_health(presto)` → WORKER_OFFLINE; no target → TARGET_REQUIRED |
| Workers | none started; no tunnels; no services; workers remain operator-started, temporary |
| Housekeeping | isolated vidnux qualification Resolve session closed via API Quit(); fixture intact |
| Boundaries | WRITE AUTHORITY = NONE · PERSISTENT WORKER AUTHORITY = NONE · External Scripting Local · no fallback · no generic executor |
| Rollback | disable plugin → restore config (sha 9e1bf835…) → restart gateway if reloaded → remove plugin dir → verify 0 resolve_* tools; sources untouched |
