# REVIEW MATERIAL — NOT AN APPROVAL

Prepared for Mikko. Nothing here records or implies a decision.

## Headline: your decision was executed faithfully, and it cannot work

You decided: **DISPATCH visual_planning_director.** That was dispatched through the
real canonical runner against the retained canary. The agent refused, honestly:

```
state:  BLOCKED
reason: task identity incomplete; canonical Story identity/sections invalid;
        required_beats required
```

The refusal is not a bug in the agent. The agent is `IMPLEMENTATION_PROVEN`,
`dispatch_enabled: true`, and the runner reported `infrastructure_state: COMPLETE`
— the dispatch path is healthy. The agent cannot do this job because **it was
never wired to this gate's artifacts.**

You were asked to choose between two options, and the option presented as the
machine-owned one does not exist as a code path. That is the finding.

## The defect, precisely

Three facts, each verified in live code:

**1. The gate evaluates five markdown files.**
`scripts/package-run-shot-edit-plan-review.js` grades `shot-list.md`,
`screen-capture-list.md`, `demo-list.md`, `b-roll-list.md`, `graphics-list.md`.
Concreteness requires `!placeholder && todos === 0 && !openBlocked`.

**2. Those files are written by a scaffold generator that always emits TODO.**
`scripts/package-run-production-plan.js` → `buildTemplateRows()` hardcodes `TODO`
in the status column of *every row it emits*, for all five list types:

```js
if (columns === "shots")    return `| ${item} | Supports a visible script beat. | ${priority} | TODO |`;
if (columns === "captures") return `| ${item} | Proves or documents the on-screen claim. | ... | TODO |`;
```

Its row text is a regex keyword grep over script prose
(`relevantLines(context.productionText, [/shot/i, /a-roll/i, ...])`), which is why
rows read as broken half-sentences. So the generator's output can *never* satisfy
the evaluator — not for this canary, not for any run, regardless of script
quality. The generator is a scaffold producer by design; the evaluator's own next
action says so: *"Edit the planning artifacts manually, then run this review again."*

**3. visual_planning_director is bound to a different lane entirely.**

| | the gate | the agent |
| --- | --- | --- |
| input | package-run markdown (`final-script.md`) | canonical Story from `/home/vidtoolz/vidtoolz-script-builder` (project + version + content hash + derived beats) |
| output | five `.md` files at the run root | `visual-plan.json` under `agents/visual_planning_director/<task>/artifacts/` |

`grep` confirms the two sides never reference each other: `package-run-production-plan.js`
and `package-run-shot-edit-plan-review.js` contain no mention of `visual-plan`, and
no agent module writes any of the five files — only deterministic `package-run-*`
tools do. **No adapter exists in either direction.**

The canary has no Story identity at all (no `project_id`/`version_id` anywhere in
it), and no Script Builder project corresponds to it. Task assembly refuses before
the agent is even reached:

```
assembleVisualPlanningTask(...) -> "No project with id 2026-08-25-lifecycle-integration-canary-..."
```

The one prior successful `plan_visuals` dispatch (`2026-08-24-workspace-canary`)
ran off a real Script Builder Story — and its "run" directory contains only
`agents/`, no package-run artifacts. **This agent has never operated on a genuine
package run.**

## Where the misleading instruction came from

`scripts/package-run-state-projection.js:61`:

```js
"shot-edit-plan-review": "visual_planning_director",
```

That one line is surfaced to you as `expected_owner`, alongside
`owner_readiness: {dispatch_enabled: true, implementation_state: "IMPLEMENTATION_PROVEN"}`
— which together read as "dispatch this proven agent." That is the same
proven-on-paper defect class as before, moved up a layer: not a missing
implementation, but an **ownership attribution no code path can honor.**

Notably, the *same projection object* already contradicts it:

```
expected_owner:          visual_planning_director
next_safe_human_action:  { actor: "codex", mode: "draft-only",
                           label: "Prepare a shot/edit planning repair brief..." }
pending_human_decision:  "Prepare a shot/edit planning repair brief for the thin shot-list..."
```

The projection's own next-safe-action already knows the real path is a
**draft-only repair brief by codex**, not an agent dispatch. Two different owner
answers in one object.

## What I did not do

I did not hand-author the five artifacts (you forbade it, and it would have hidden
this defect behind content I wrote). I did not fabricate a Script Builder Story for
the canary — that is durable state in another repository and would manufacture
canonical Story identity and content hashes. I did not build the missing adapter:
deciding what turns a `visual-plan.json` into lifecycle-gate markdown, or whether
this gate should be agent-owned at all, is your architecture decision.

No approval marker written. No gate advanced. Gate remains 6/14.

## Current canonical state — unchanged

| surface | value |
| --- | --- |
| canonical gate | `shot-edit-plan-review` (6/14), `current-blocked` |
| gates complete | 5/14 |
| evaluator | `NEEDS WORK`, accepted `false`, approvalMarker `none` |
| package-run-state | `shot-edit-plan-review`, BLOCKED |
| tracker | stage 5, `TRACKER_CONSISTENT` |
| projection drift | none |
| consistency report | `ok: true`, `defects: []` |
| your research approval | still `RESEARCH_ONLY`, did not leak |

## Also surfaced: an open QC blocker on the research gate

`qc_director` (task `canary-qc-01`) currently reports:

```
QC_REQUIRED_EVIDENCE_MISSING (BLOCKER)
required evidence STORY_VALIDATION was never produced or does not validly bind
to this artifact; absence of a known defect is not proof of quality
affected_gate: research   next_gate_allowed: false
```

Not part of this mission's scope, but it is live and you should know it exists.

## The decision now in front of you

Not the shot/edit plan — there is no plan to judge. One of these:

**A. Correct the ownership map.** Change `GATE_OWNERS["shot-edit-plan-review"]`
to reflect reality (the projection's own next-safe-action suggests a draft-only
codex path with human authorship). Smallest change; makes the system stop
recommending an impossible dispatch.

**B. Build the missing bridge.** Give package runs a canonical Story identity and
write a `visual-plan.json` → five-markdown adapter, making the gate genuinely
agent-owned. Largest change; needs your design decision on what the adapter is
allowed to assert.

**C. Accept the gate as human-authored.** Keep the scaffold generator as a
starting template and treat filling it in as your creative work, as the
evaluator's next-safe-action already says.

For this canary specifically, C unblocks the lifecycle test fastest; A is the
honest repair regardless of which path you pick for the product.

## Planning package as it stands (for inspection, not approval)

All paths under `package-runs/2026-08-25-lifecycle-integration-canary-canary-not-for-publication/`

| artifact | sha256 | evaluator finding |
| --- | --- | --- |
| `shot-list.md` | `9ff05130c1191004…` | placeholder-only / TODO rows |
| `screen-capture-list.md` | `c51dc341dc0120d0…` | placeholder-only / TODO rows |
| `demo-list.md` | `2fcdf21ce5977fc7…` | placeholder-only / TODO rows |
| `b-roll-list.md` | `9b2617ab7d568e88…` | placeholder-only / TODO rows |
| `graphics-list.md` | `70402402a498a27d…` | placeholder-only / TODO rows |
| `production-plan.md` | `1995ba56a191d24a…` | concrete |
| `audio-notes.md` | `f64883c0a9c11ccc…` | concrete |
| `production-blockers.md` | `d75f9a5a2d3c5056…` | concrete |

Dispatch evidence: `package-runs/2026-08-25-lifecycle-integration-canary-canary-not-for-publication/agents/visual_planning_director/vpd-canary-lifecycle-1/`

## Status

`REVIEW MATERIAL — NOT AN APPROVAL` · no marker written · no gate advanced ·
run remains at gate 6 · verdict: ARCHITECTURE DEFECT FOUND.
