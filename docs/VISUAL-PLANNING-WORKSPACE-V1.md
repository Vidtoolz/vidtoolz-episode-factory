# Visual Planning Workspace V1 backend contract

The Visual Planning Workspace is a bounded, read-only projection of one exact `visual_planning_director` invocation. `workspace_schema_version: 1` and `workspace_schema_id: visual-planning-workspace/v1` freeze the public shape consumed by the cockpit UI; adding or renaming a stable field requires a new schema version.

## Exact request identity

`GET /api/visual-planning-workspace` requires `run_id`, `agent_id`, `task_id`, and `invocation_id`. `agent_id` must be `visual_planning_director`. Optional artifact assertions may narrow the request, but a client path never selects the artifact. The server derives and verifies the artifact through canonical runner evidence.

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
* `decision_queue_diagnostics`
* `ownership`
* `resource_tool`
* `links`

`context` binds the exact run, agent, task, invocation, runtime/semantic state, lifecycle, and implementation readiness. `visual_plan` binds artifact identity/hash, revision, Story dependency, approval/gate state, coverage, and bounded shots. `human_attention` contains only canonical queue obligations matching that exact context. `ownership` projects the existing ownership and control authorization truth. `resource_tool` uses `UNKNOWN` when live evidence is absent. `links` contains only established bounded control and reveal endpoints.

The backend returns no arbitrary file content or write endpoint. Manual editing remains an explicit trusted handoff while HUMAN ownership fences automation.
