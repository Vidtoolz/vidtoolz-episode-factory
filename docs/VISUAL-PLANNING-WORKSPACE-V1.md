# Visual Planning Workspace V1 backend contract

The Visual Planning Workspace is a bounded, read-only projection of one exact `visual_planning_director` invocation. `workspace_schema_version: 1` and `workspace_schema_id: visual-planning-workspace/v1` freeze the public shape consumed by the cockpit UI; adding or renaming a stable field requires a new schema version.

## Exact request identity

`GET /api/visual-planning-workspace` requires `run_id`, `agent_id`, `task_id`, and `invocation_id`. `agent_id` must be `visual_planning_director`. Optional artifact assertions may narrow the request, but a client path never selects the artifact. The server derives and verifies the artifact through canonical runner evidence. An omitted schema request deterministically selects V1; an explicit version must be numeric `1` and an explicit schema ID must equal `visual-planning-workspace/v1`. Unsupported versions fail instead of downgrading.

The executable contract is `scripts/visual-planning-workspace-contract.js`. It validates the exact stable field sets, authority fields, identity and hashes, explicit Story freshness, queue-binding state, execution ownership, central control capabilities, successor-adapter identity, and truthful resource values.

## Stable V1 payload

The stable top-level fields are:

* `workspace_schema_version`
* `workspace_schema_id`
* `schema_version`
* `workspace_type`
* `read_only`
* `context`
* `visual_plan`
* `human_attention`
* `queue_binding`
* `decision_queue_diagnostics`
* `ownership`
* `resource_tool`
* `links`

`context` binds the exact run, agent, task, invocation, runtime/semantic state, lifecycle, and implementation readiness. `visual_plan` binds artifact identity/hash, revision, Story dependency/freshness, approval/gate state, coverage, and bounded shots. `human_attention` contains only canonical queue obligations matching that exact context. `queue_binding` distinguishes `VERIFIED`, `HISTORICAL`, `UNAVAILABLE`, and `NOT_BOUND`; queue failure can never masquerade as an active obligation. `ownership` projects the existing ownership and central control authorization truth plus the registered Visual Planning successor adapter. `resource_tool` uses `UNKNOWN` when live evidence is absent. `links` contains only established bounded control and reveal endpoints.

The backend returns no arbitrary file content or write endpoint. Manual editing remains an explicit trusted handoff while HUMAN ownership fences automation.
