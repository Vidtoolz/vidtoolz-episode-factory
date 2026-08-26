# Registry-Driven Agent Runner V1

Registry-Driven Agent Runner V1 is a deterministic, single-specialist process boundary. It resolves an agent only from `config/agent-registry.json`, derives the conventional module under `scripts/`, verifies module identity and action support, invokes the module with `node <module> --task <persisted-task>`, records the exact task and returned result, reports the handoff, and stops.

## Invocation

```sh
node scripts/agent-run.js \
  --agent story_editor \
  --run-id <package-run-id> \
  --task <task.json>
```

The task must contain the same `package_run_id`, a safe `task_id`, and the specialist's native action. Executable paths in task data are ignored. The runner never invokes `next_owner`.

Use `--new-attempt` only to retry the exact same task bytes after preserving prior evidence. A completed invocation without that flag is returned idempotently. A changed task under the same agent/task identity is rejected.

## Enablement gate

A registry entry proves that a role's doctrine is defined. It never means the role may run. Before any module is resolved or loaded, the runner requires the registration's `lifecycle` to carry `proven: "PROVEN"` and `autonomous_dispatch: "ENABLED"`; anything else — including a registration with no lifecycle block at all — is refused fail-closed as `BLOCKED_AGENT_NOT_ENABLED`, with the registry's `dispatch_blocked_reason` reported.

`presenter_director` was enabled by Mikko's explicit decision on 2026-08-25 and is now `PROVEN` / `ENABLED`, implementation state `IMPLEMENTATION_PROVEN`, and contract status `BUILT`. Its authority boundaries did not change. `creative_director` remains deliberately `NOT_PROVEN` / `DISABLED` and contract status `PLANNED_LAST`. Enabling a role is Mikko's decision, and `scripts/agent-contract-validator.js` requires the registry lifecycle to agree with the contract's `role_roster` status, so a role cannot be enabled in one file alone. The Agent Control Room never loads or runs a role that remains `PLANNED_NOT_ENABLED`.

## Persistence and completion

Evidence is stored below:

```text
package-runs/<run-id>/agents/
  index.json
  <agent-id>/<task-id>/
    task.json
    result.json              # only for a valid envelope
    stdout.log               # malformed/overflow output evidence
    stderr.log
    artifacts/
    invocation.json          # final completion marker
    attempts/0002/           # explicit later attempts
```

`invocation.json` is written last. A task directory with `task.json` and no invocation marker is `INCOMPLETE` and is not silently rerun. The per-run `.lock` serializes only the invocation tree; it is not a compute/GPU lock. Dead local-PID lock evidence is renamed and preserved before recovery.

## Authority boundary

Exit code is recorded separately from semantic state. A valid specialist result such as `AWAITING_HUMAN_REVIEW`, `RETURN_TO_RESEARCH`, `PREVIEW_ONLY`, or `BLOCKED` remains the result. The runner does not repair output, construct canonical artifacts, approve work, select assets, advance a gate, retry automatically, or chain to another role.

Returned canonical artifacts on the small V1 allowlist are copied structurally unchanged into run-local evidence. Their specialist remains their writer and authority owner.

## Story Editor assembler

`scripts/agent-task-story-editor.js` reads the requested project/version from the canonical Script Builder store on every call and emits Story Editor's native `review_script` task. It copies exact version identity, content hash, sections, central claim, narrative spine, and the real unapproved/approved observation. It never manufactures approval or fills missing canonical Story fields.

```sh
node scripts/agent-task-story-editor.js \
  --project <project-id> \
  --version <version-id> \
  --run-id <package-run-id> \
  --task-id <task-id> \
  --out <task.json>
```

The runner's `agents/index.json` is the stable read-only seam for a future Agent Control Room runtime-context adapter. V1 deliberately does not modify the Control Room or add a write endpoint.
