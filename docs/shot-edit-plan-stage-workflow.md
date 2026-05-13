# Stage 4 Workflow: Script → Shot/Edit Plan

Stage 4 is the manual-intake review loop between an approved script and any shooting or edit-plan acceptance. It reuses the existing `package-runs/` container, the Package Engine lifecycle language, and the conservative rule that artifact existence is not readiness.

## Upstream Inputs

Existing upstream inputs include:

- `final-script.md`
- `script-review.md`
- `script-revision-plan.md`
- `script-structure.md`
- `research-pack.md`
- `research-sufficiency-review.md`
- `research-evidence.md`
- `source-support-map.md`
- `proof-capture-plan.md`
- `research-objections.md`
- `selected-package.json` or `selected-package.md`
- `creator-qa-report.json` or `creator-qa-report.md` when present

## Planning Artifacts

Existing Stage 4 planning artifacts are:

- `production-plan.md`
- `shot-list.md`
- `screen-capture-list.md`
- `demo-list.md`
- `b-roll-list.md`
- `graphics-list.md`
- `audio-notes.md`
- `production-blockers.md`

## Review Loop

1. `package-run-production-plan.js` creates the initial planning artifacts from the existing script, research, structure, and review state.
2. Mikko edits the planning artifacts manually.
3. `package-run-shot-edit-plan-review.js` inspects the edited planning artifacts.
4. The review script writes `shot-edit-plan-review.md` and `shot-edit-plan-enhancement-plan.md`.
5. The review script does not overwrite the human-edited planning files.
6. The review script does not approve shooting merely because files exist.

## Commands

```sh
node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug --json
node scripts/package-run-shot-edit-plan-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
```

`--overwrite` only applies to `shot-edit-plan-review.md` and `shot-edit-plan-enhancement-plan.md`. It never overwrites `production-plan.md`, `shot-list.md`, `screen-capture-list.md`, `demo-list.md`, `b-roll-list.md`, `graphics-list.md`, `audio-notes.md`, or `production-blockers.md`.

## Status Rules

- `BLOCKED`: required upstream gates are missing or failing.
- `NEEDS WORK`: planning artifacts exist but are placeholder-only, TODO-heavy, incomplete, or blocked.
- `READY FOR HUMAN APPROVAL`: the plan appears concrete but lacks explicit approval.
- `PASS`: required upstream gates are satisfied and an exact approval marker exists.

Accepted approval markers:

```text
Manual approval: PASS
Production planning approval: PASS
Shot/edit plan approval: PASS
```

## Outputs

`shot-edit-plan-review.md` records the inspected evidence, missing required files, upstream gate findings, placeholder/TODO findings, concrete planning coverage, blockers, enhancement summary, next safe action, and blocked actions.

`shot-edit-plan-enhancement-plan.md` suggests repairs in this table format:

```md
| priority | artifact | issue | suggested repair | reason |
| --- | --- | --- | --- | --- |
```

The enhancement plan suggests edits only. It does not apply them.

## Blocked Actions

Until Stage 4 reaches explicit human approval, these actions remain blocked:

- shooting
- editing
- publishing
- upload prep
- final title lock
- final thumbnail lock
- Hermes brain write
- project-state promotion
