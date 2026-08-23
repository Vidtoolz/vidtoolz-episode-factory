# Visual Plan V1 authority contract

Visual Plan V1 is the deterministic bridge from an exact Script Builder version to visual beats, shots, prompts, Research authority, Camera intent, and neutral generation requirements. It does not perform semantic visual planning and does not grant itself generation or asset-selection authority.

## Validation and authorization

`validatePlan()` checks schema, identity, coverage, prompt provenance, digest integrity, and Story drift. A structurally valid plan can still be unauthorized. `evaluatePlanAuthority()` is the only generation-authority projection. It requires the exact current Story, a human-approved Story snapshot, complete beat coverage, current prompts, authorized canonical Research for sensitive shots, and an exact human plan approval.

`READY_FOR_GENERATION` is derived. It is not a persisted planner state. An unapproved Story produces `PREVIEW_ONLY`, even when its plan is structurally valid.

## Identity and revisions

Plan, canonical beat, shot, and prompt IDs use prefixed ULIDs written outside a semantic model. Parser and Beat Sheet IDs remain aliases or imported provenance. Canonical beats are bound to exact Story sections. Plan revisions are immutable and monotonically increasing; a successor points to the prior revision and digest. Reusing a shot ID for materially changed intent is invalid.

The stored `plan_digest_sha256` covers all authoritative plan fields except itself using recursively key-sorted canonical JSON. Prompt records bind positive prompt revisions to one shot and to a digest of prompt-relevant shot intent.

## Coverage

Every required canonical beat is assessed exactly once as either `PLAN_SHOTS` with at least one matching shot or `INTENTIONAL_NO_VISUAL` with a reason. Missing, duplicate, unknown, and conflicting coverage fail closed.

## Authority boundaries

Camera data is limited to narrative intent such as subject, purpose, reveal, scale, movement need, and context. Camera paths, headings, coordinates, easing, and keyframes are prohibited. Generation requirements may describe artifact class, aspect, duration, inputs, quality constraints, candidate count, and mode; routing, host, backend, model, workflow, seed, and resource assignment are prohibited.

Planner shot state ends at `PROMPT_READY`. Final asset selection and approval live downstream. Presenter relation is planning-only and cannot carry take, wardrobe, performance, or recording authority. Global creative identity is outside the contract.

## Research-sensitive visuals

A sensitive shot records a bounded `visual_assertion` and exact Script binding, claim, Research Result ID/revision/digest, assertion hash, required/applied constraint IDs, and optional exact human-exception reference. The plan stores references, not Research Results. `evaluatePlanAuthority()` consumes canonical Research authority output and canonical constraint validation; it does not judge evidence.

## Prompt and downstream provenance

The traceable chain is Story project/version/hash → Story section → canonical beat → shot → prompt. Legacy Super Focus prompt IDs are aliases. The future Unit B adapter can add the generated artifact identity without duplicating Unit B provenance records. `DIRECT_VIDEO` and `IMAGE_TO_VIDEO` are distinct; I2V requires one exact input artifact reference.

## Human approval

Plan approval is separate from the plan and binds exact plan ID, revision, digest, Story project/version/hash, approver, timestamp, scope, and canonical approval bytes. Tests use `TEST_HUMAN`; this contract never records a production approval. Mutation of the plan or Story makes the approval stale.

## Non-goals

V1 does not build Visual Planning Director, call a model, choose a visual concept, route generation, author Camera mechanics, select media assets, approve Story, or modify Research authority.

Standalone verification:

```bash
node tests/visual-plan.test.js
node --check scripts/visual-plan.js
```
