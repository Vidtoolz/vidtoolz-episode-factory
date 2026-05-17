# Vidtoolz Production System Map

This document maps the current Vidtoolz package-run production system from existing repository evidence only. It separates proven behavior from intended or generated behavior, preserves the human approval gates, and uses the May 2 package run as the reference case for truthful state handling.

## 1. Purpose

The production system exists to turn a video idea into a reviewable Vidtoolz episode package without letting generated files overstate readiness.

The useful operating model is:

1. Generate or collect package candidates.
2. Select one package for review.
3. Build research, outline, script, and production-planning artifacts.
4. Run deterministic checks where the repo supports them.
5. Require human approval before capture, rough-cut progression, publishing, upload, archive, durable project-state promotion, or production approval.

The key doctrine from the state-machine and dashboard tooling is conservative: file existence is not proof. If downstream files claim readiness while upstream evidence or human approval is missing, the safer state wins.

For May 2, this matters because the run contains repaired package, research, script, production-planning, and shot/edit artifacts, while capture evidence remains unaccepted. Creator QA can pass and Stage 4 can be accepted while capture evidence is still missing. The system must preserve the distinction between draft repair, production planning, shot/edit approval, real capture evidence, capture evidence acceptance, dashboard readiness, and Mikko production approval.

## 2. Current tools

### Canonical or near-canonical tools

- `scripts/package-engine-new-run.js`
  - Creates the initial package-run material documented in `docs/package-engine-run-workflow.md`: `generation-prompt.md`, `package-candidates.json`, and `notes.md`.
- `package-engine.html`
  - Browser review surface for package/candidate work.
  - The documented workflow says browser selection downloads `selected-package.json` and `selected-package.md`; it does not automatically write those files back into the run folder.
- `scripts/package-engine-new-outline.js`
  - Creates outline-stage artifacts such as `outline-prompt.md`, `outlines.md`, and `final-outline.md`.
- `scripts/package-engine-new-script.js`
  - Creates script-stage artifacts such as `script-prompt.md`, `script-draft.md`, `final-script.md`, and `production-notes.md`.
- `scripts/package-engine-new-production.js`
  - Creates broader production-prep pack files and avoids overwriting different existing production artifacts.
- `scripts/package-run-creator-qa.js`
  - Local deterministic Creator QA runner.
  - Default profile observed in docs/scripts: `ai_video_breakdown`.
  - Outputs: `creator-qa-package.md`, `creator-qa-report.md`, and `creator-qa-report.json`.
  - Replacement flag is `--force`; `--overwrite` is not the supported replacement flag for this script.
- `scripts/package-run-capture-evidence-review.js`
  - Local read-only capture evidence review, except for writing `capture-evidence-review.md` when requested.
  - Reviews capture-related files: `capture-checklist.md`, `takes-log.md`, `screen-recording-checklist.md`, `audio-capture-checklist.md`, and `missing-shot-tracker.md`.
  - Does not call external APIs according to the inspected workflow and generated file fields.
- `scripts/package-runs-index.js`
  - Builds `package-runs-index.json`, the dashboard input and lifecycle summary.
  - Encodes conservative state logic and first-blocker behavior.
- `scripts/package-run-doctor.js`
  - Read-only local inspection for one run.
  - Reuses package-runs index/lifecycle logic and reports blockers, missing expected artifacts, approval markers, and unknown files.
- `package-runs-dashboard.html` plus `package-runs-dashboard.js`
  - Static dashboard UI.
  - Loads `package-runs-index.json` through the served local app.
  - Displays run status, workflow bucket, Creator QA, evidence gate, lifecycle review, capture evidence panel, next safe action, missing artifacts, and detected-but-not-trusted artifacts.
- `./scripts/verify.sh`
  - Repo regression check. Recent inspected output in this workspace reported `440/440 tests passed`; run it again when validating a code or workflow change.

### Supporting documentation

- `docs/package-run-state-machine.md`
  - Conservative lifecycle doctrine.
  - Later states require earlier valid state.
  - Conflicts resolve to the more conservative state until Mikko reviews.
- `docs/package-runs-dashboard-workflow.md`
  - Dashboard is static/read-only and reads generated index data.
- `docs/package-run-doctor.md`
  - Doctor is read-only and does not mutate state.
- `docs/capture-evidence-workflow.md`
  - Defines capture evidence workflow, approval marker boundaries, and review status handling.
- `docs/package-run-creator-qa-workflow.md`
  - Defines local Creator QA workflow and its effect on dashboard readiness.
- `docs/package-engine-run-workflow.md`
  - Defines package-engine run creation, browser review, selection export, and later command flow.
- `docs/video-production-engine-stage-model.md`
  - Treats the Video Production Engine as an organizing layer over `package-runs/`, not a second approval system.

### Optional, generated, or stage-specific surfaces

These are useful only when their stage is actually active and supported by evidence:

- Capture intake controls in `package-runs-dashboard.js`.
  - They generate helper rows and can preview local writes.
  - The UI text explicitly says generated rows do not approve capture.
- Publication, archive, and repurposing artifacts.
  - These are downstream and should not be trusted before real capture, edit, export, and approval evidence exists.
- Review-only proof files inside a run folder.
  - Useful for auditability.
  - Not automatically accepted as production evidence unless a repo script or human approval gate explicitly treats them that way.

## 3. End-to-end workflow

### Proven or documented package-run workflow

1. Create package run.
   - Command family: `scripts/package-engine-new-run.js`.
   - Expected initial files: `generation-prompt.md`, `package-candidates.json`, `notes.md`.

2. Review/select package in browser.
   - Surface: `package-engine.html` served locally.
   - Selection export is a browser download, not an automatic repo write.
   - If the selected package should become durable repo state, the downloaded `selected-package.json` / `selected-package.md` must be intentionally copied into the run folder and reviewed.

3. Build outline.
   - Command family: `scripts/package-engine-new-outline.js`.
   - Expected files include `outline-prompt.md`, `outlines.md`, `final-outline.md`.

4. Build script.
   - Command family: `scripts/package-engine-new-script.js`.
   - Expected files include `script-prompt.md`, `script-draft.md`, `final-script.md`, `production-notes.md`.

5. Run or inspect research/script gates where present.
   - Examples in May 2 include `research-sufficiency-review.md`, `script-structure.md`, `script-review.md`, and `script-revision-plan.md`.
   - These can support production planning, but they do not approve capture by themselves.

6. Build production planning.
   - Current observed artifacts include `production-plan.md`, `production-blockers.md`, `shot-list.md`, `screen-capture-list.md`, `demo-list.md`, `audio-notes.md`, `b-roll-list.md`, and `graphics-list.md`.
   - Production planning can prepare a shoot, but capture still requires the later shot/edit and capture evidence gates if the lifecycle model demands them.

7. Run Creator QA.
   - Use `node scripts/package-run-creator-qa.js <run> --force` when replacing existing QA artifacts.
   - Creator QA PASS means the package/script satisfies that deterministic QA profile. It does not mean production approved, captured, edited, uploaded, or published.

8. Review capture evidence.
   - Use `node scripts/package-run-capture-evidence-review.js <run> --overwrite` when regenerating the review.
   - The review can detect capture-looking rows and references.
   - Human acceptance requires the exact capture-stage approval marker after real concrete evidence, as described by the capture workflow.

9. Rebuild index and inspect dashboard/doctor.
   - `node scripts/package-runs-index.js`
   - `node scripts/package-run-doctor.js <run>`
   - Dashboard displays the generated index state; it should not be treated as an independent approval authority.

10. Verify repo health.
   - `./scripts/verify.sh`

### What is not proven by the workflow alone

- A pasted transcript is not screen capture.
- Generated text is not captured media evidence.
- A screenshot path is not proof unless the screenshot actually exists and is tied to the workflow.
- A screen recording reference is not proof unless the recording exists and is tied to the workflow.
- Parser-detected capture rows are not human acceptance.
- Creator QA PASS is not Mikko production approval.
- Dashboard readiness is not production approval.
- A generated production plan is not a production-script approval.

## 4. Run states

The current state model is conservative and stage-gated. Important visible states and buckets include:

- `Idea run` / `Needs package selection`
- `Package selected` / `Needs research pack`
- `Research pack ready` / `Needs outline`
- `Final outline ready` / `Needs script`
- `Final script ready` / `Needs production prep`
- `Needs production planning`
- `Needs shot/edit plan review`
- `Needs shot/edit plan approval`
- `Ready for capture checklist`
- `Needs capture`
- `Ready for rough cut`
- `Needs rough-cut review`
- `Ready to publish`
- `Needs export check`
- `Ready to upload`
- `Needs publication metadata`
- `Ready to schedule`
- `Needs archive data`
- `Ready to archive`
- `Needs repurposing approval`
- `Ready to cut shorts`

The dashboard also has workflow filters for special blockers:

- `Needs QA repair`
- `Needs proof capture`
- `Narrow shooting approved`
- `QA not run`

The doctor and index logic treat blocking gates conservatively. If Creator QA is blocking, it becomes the first visible blocker. If production planning is not ready, downstream capture and publication readiness can be overridden. If capture evidence is not accepted, rough cut, edit progression, publishing, upload prep, archive, Hermes brain writes, and project-state promotion remain blocked.

### May 2 current state from inspected evidence

The current read-only doctor and capture-gap outputs for May 2 report:

- Run: `2026-05-02-ai-video-idea-filter`
- Title: `Avoid Bad AI Video Ideas Before You Script`
- Current inferred stage: `Needs capture`
- Workflow bucket: `Needs capture`
- Creator QA status: `PASS`
- Overall status: `BLOCKED`
- Next recommended command: `node scripts/package-run-capture-evidence-review.js package-runs/2026-05-02-ai-video-idea-filter`
- Next safe action: add real capture evidence rows with concrete media references, then rerun capture evidence review.
- First blocker reason: `Capture evidence review status is NEEDS CAPTURE; Capture evidence accepted is no.`
- Conservative blocked actions: upload, publishing, archive, Hermes brain write, project-state promotion.
- Capture gap blocked actions also include rough-cut assembly and editing progression.
- Missing expected artifact/evidence: real capture evidence and `capture-evidence-review.md` PASS.

The inspected `creator-qa-report.md` reports:

- Overall result: `PASS`
- Score: `35/35`
- Checked package: `Avoid Bad AI Video Ideas Before You Script`
- Failed checks: none.

The inspected capture proof/report boundary shows:

- `capture-evidence-review.md` currently reports `Review status: NEEDS CAPTURE`.
- `Capture evidence accepted: no`.
- `Real capture evidence detected: no`.
- Take/camera/A-roll evidence, screen recording evidence, and audio/voiceover evidence are missing or not concrete.
- Missing-shot tracker and capture blockers are not closed/accepted.
- The exact capture-stage approval marker is missing.
- Ready for rough-cut remains `no`.

The inspected production planning and shot/edit files currently support reaching the capture stage:

- `production-plan.md` says `Shoot-readiness status: READY TO SHOOT` and `Status: READY TO SHOOT`.
- `production-blockers.md` says blockers are closed and `Shoot-readiness status: READY TO SHOOT`.
- `research-sufficiency-review.md` says `Research sufficiency status: PASS` and `Research approval marker: PASS`.
- `script-structure.md` says `READY TO DRAFT`.
- `script-review.md` says `PASS` and `Production planning ready: yes`.
- `shot-edit-plan-review.md` says `Review status: PASS` and `Stage accepted: yes`.

That does not approve downstream work. The current blocker is capture evidence, not production planning. Until concrete take/screen/audio evidence exists, the missing-shot/capture blockers are closed, the capture evidence review passes, and human capture acceptance is recorded, May 2 remains blocked for rough-cut, edit progression, publishing, upload, archive, Hermes brain writes, and project-state promotion.

Mikko production approval is still not proven by the inspected files. The system should not infer production approval from Creator QA, Stage 4 acceptance, dashboard status, doctor output, or generated readiness text.

## 5. Required files

### Minimum usable package-run file set

For a package run to be usable at the package/script planning level, the minimum practical file set is:

- `notes.md`
  - Run notes, context, and caveats.
- `package-candidates.json`
  - Candidate package data.
- `selected-package.json` or `selected-package.md`
  - The durable selected package, if a selection has been made.
- `final-outline.md`
  - Required once outline stage is complete.
- `final-script.md`
  - Required once script stage is complete.
- `production-notes.md` or equivalent planning notes
  - Useful bridge into production planning.
- `creator-qa-report.md` and `creator-qa-report.json`
  - Required before claiming Creator QA status.
- `production-plan.md`
  - Required before claiming production planning readiness.
- `production-blockers.md`
  - Required to make production blockers explicit and reviewable.
- `package-runs-index.json`
  - Generated at repo root, not inside the run, but required for dashboard truthfulness.

### Required before capture or rough-cut progression

A run should not move into capture/rough-cut claims without the appropriate stage evidence. Relevant files include:

- `shot-edit-plan-review.md`
- `shot-edit-plan-enhancement-plan.md` when repairs are needed
- `capture-checklist.md`
- `takes-log.md`
- `screen-recording-checklist.md`
- `audio-capture-checklist.md`
- `missing-shot-tracker.md`
- `capture-evidence-review.md`

For capture acceptance, the files must contain concrete evidence and the required human approval marker in the right place. Merely having the files is not enough.

The minimum usable capture evidence set is:

- One concrete take/camera/A-roll row in `takes-log.md`.
- One concrete screen recording or screenshot row in `screen-recording-checklist.md`.
- One concrete audio/A-roll/voiceover row in `audio-capture-checklist.md`.
- `missing-shot-tracker.md` closed or explicitly accepted.
- No open capture blockers in `capture-checklist.md` or `missing-shot-tracker.md`.
- `capture-evidence-review.md` with `Review status: PASS`, `Capture evidence accepted: yes`, and `Real capture evidence detected: yes`.
- An exact capture-stage approval marker after the concrete evidence it approves.

### Required before publish/upload/archive claims

These downstream files should only matter after real edit/export/publish stages exist:

- `rough-cut-watch-notes.md`
- `rough-cut-review.md`
- `final-watch-notes.md`
- `final-review.md`
- `export-checklist.md`
- `master-file-manifest.md`
- `caption-check.md`
- `loudness-check.md`
- `delivery-readiness.md`
- `publish-metadata-review.md`
- `title-check.md`
- `thumbnail-check.md`
- `description-check.md`
- `chapters-check.md`
- `schedule-check.md`
- `archive-manifest.md`
- `archive-source-files.md`
- `archive-assets-manifest.md`
- `archive-export-manifest.md`
- `reusable-clips-manifest.md`
- `archive-blockers.md`
- `repurposing-plan.md`
- `shorts-candidates.md`
- `platform-variants.md`

## 6. Optional/generated files

Optional/generated files are useful for review but risky if they imply progress before a stage exists.

### Draft/package-stage files

- `generation-prompt.md`
- `outline-prompt.md`
- `script-prompt.md`
- `script-draft.md`
- `outlines.md`
- `selected-package.md`
- `research-pack.md`
- `research-evidence.md`
- `source-support-map.md`
- `research-objections.md`
- `proof-capture-plan.md`

These support planning and review. They do not prove capture, edit, or publishing.

### Production-prep files

- `production-brief.md`
- `shooting-plan.md`
- `shot-list.md`
- `screen-capture-list.md`
- `demo-list.md`
- `audio-notes.md`
- `b-roll-list.md`
- `graphics-list.md`
- `resolve-edit-checklist.md`
- `thumbnail-title-check.md`
- `publish-pack.md`

These can be helpful once production planning is the current stage. They should be labeled as prep, not completed production.

### Review-only proof files

May 2 includes review-only proof files such as:

- `browser-workflow-proof.md`
- `export-import-proof.md`
- `selection-rationale-proof.md`
- `capture-review-proof.md`
- `creator-qa-rerun-proof.md`
- `dashboard-truthfulness-proof.md`
- `evidence-chain-summary.md`

These are durable audit notes. They help explain what was checked. They do not automatically satisfy capture approval, Creator QA, dashboard readiness, or Mikko production approval unless the repo tools and human gates explicitly agree.

### Files that should not be generated too early

To reduce false readiness, avoid generating or committing these before their stage exists:

- Rough-cut review files before capture evidence is accepted.
- Final-review files before a rough cut exists and has real watch notes.
- Export/upload readiness files before final review and concrete export evidence exist.
- Publication metadata approval files before title, thumbnail, description, chapters, schedule, and approval are real.
- Archive files before publication/export evidence exists.
- Repurposing/Shorts files before archive or repurposing approval exists.
- Durable Hermes/project-state promotion notes before human approval gates are satisfied.

## 7. Human approval gates

The system should preserve these approval boundaries:

1. Package selection approval
   - A selected package artifact shows what was chosen.
   - It does not prove the score calculation unless scoring provenance is present.

2. Research sufficiency approval
   - Research/source review can support script and production planning.
   - It does not prove production capture.

3. Script approval
   - Script structure/review can support production planning.
   - It does not equal final production-script approval unless Mikko explicitly approves it for recording.

4. Production planning approval
   - A production plan can list shots and required assets.
   - It does not approve downstream capture evidence, editing, publishing, or upload.

5. Shot/edit plan approval
   - Required before capture intake should be treated as safe in the lifecycle model.

6. Capture evidence approval
   - Requires concrete capture evidence and the exact approval marker after human review.
   - Parser detection or generated helper rows are not enough.

7. Rough-cut approval
   - Requires real rough-cut review/watch evidence.

8. Final review approval
   - Required before publish readiness.

9. Export/upload approval
   - Requires concrete export evidence and delivery checks.

10. Publication metadata/schedule approval
    - Requires real title, thumbnail, description, chapters, schedule, and approval.

11. Archive/repurposing approval
    - Downstream of publication/export/archive proof.

12. Mikko production approval
    - Separate from all generated files and deterministic checks.
    - Must not be inferred from QA, dashboard, doctor, or generated text.

### Tool consistency boundaries

- `package-runs-index.js` is the canonical lifecycle parser for dashboard state. It determines the current inferred stage, workflow bucket, detected-but-not-trusted downstream artifacts, and next recommended command.
- `package-runs-dashboard.js` is a display layer over `package-runs-index.json`. It can normalize and present missing fields, but it should not be treated as a separate approval source.
- `package-run-doctor.js` is the canonical read-only single-run inspector. It reuses the package-run index logic and is the best CLI for explaining why a run is blocked.
- `package-run-creator-qa.js` is the Creator QA bridge. Its PASS/FAIL result blocks or clears package/script QA only; it does not approve capture, rough cut, publish, archive, or Mikko production approval.
- `package-run-capture-evidence-review.js` is the canonical capture evidence evaluator. It distinguishes generated/dummy/ambiguous rows from concrete take, screen, and audio evidence, and it requires exact human approval after evidence.
- `package-run-capture-gap.js` is a read-only capture blocker reporter. It should agree with doctor on capture status and blocked downstream actions.

For May 2, these tools are currently consistent on the key boundary:

- Creator QA: `PASS`.
- Doctor current inferred stage: `Needs capture`.
- Capture-gap current inferred stage: `Needs capture`.
- Capture evidence accepted: `false`.
- Real capture evidence: `false`.
- Ready for rough cut: `false`.
- Dashboard should display the same state after `package-runs-index.json` is regenerated.

## 8. Commands/checks

Use these commands for the current workflow.

### Local app

```sh
./scripts/serve-local.sh
```

Then open relevant pages such as:

- `http://127.0.0.1:8010/`
- `http://127.0.0.1:8010/package-engine.html`
- `http://127.0.0.1:8010/package-runs-dashboard.html`

### Package-run index/dashboard

```sh
node scripts/package-runs-index.js
```

This regenerates `package-runs-index.json`, which the dashboard consumes.

### Doctor

```sh
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter --json
```

Doctor is read-only and should be used to inspect state, blockers, approval markers, missing artifacts, and unknown files.

### Creator QA

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --force
```

Use `--force` when replacing existing QA artifacts. Do not use `--overwrite` for Creator QA replacement unless the script changes to support it.

### Capture evidence review

```sh
node scripts/package-run-capture-evidence-review.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
```

This writes/regenerates `capture-evidence-review.md`. It does not grant human approval by itself.

### Repo verification

```sh
./scripts/verify.sh
```

### Safe inspection commands for doc-only work

```sh
git status --short --branch
git diff -- docs/vidtoolz-production-system-map.md
git diff --check docs/vidtoolz-production-system-map.md
```

## 9. Current friction points

1. Too many generated files can imply progress that did not happen.
   - Production, publish, archive, and repurposing artifacts should be generated only when their stage exists.

2. Readiness language can still be overread across stages.
   - May 2 currently has `READY TO SHOOT` production-planning language and Stage 4 acceptance, but capture evidence review still reports `NEEDS CAPTURE`.

3. Creator QA is easy to overread.
   - PASS 35/35 means the deterministic creator QA profile passed. It does not mean capture, editing, publishing, upload, or Mikko approval passed.

4. Capture review status is easy to overread.
   - `READY FOR HUMAN APPROVAL` is not the same as `Capture evidence accepted: yes`.
   - `NEEDS CAPTURE` means real concrete take/screen/audio evidence or required closure/approval is missing.

5. Parser-detected evidence is not human acceptance.
   - A row that looks like a screen recording or audio file reference still needs real file/source proof and human approval.

6. Browser selection export is not automatically durable repo state.
   - Downloaded selection files must be intentionally copied and reviewed.

7. Score provenance is weak when only stored as selected package data.
   - May 2 selected package score `94` exists as artifact data, but no independent scoring calculation/log was inspected here.

8. Dashboard, index, and doctor are close but not the same thing.
   - Index generates the model.
   - Dashboard displays it.
   - Doctor inspects one run read-only.
   - None of them is Mikko production approval.

9. Downstream artifacts can become detected-but-not-trusted.
   - Capture, rough-cut, final-review, export, publication metadata, archive, and repurposing files should not be trusted before the upstream physical-production stage exists and has accepted evidence.

10. The local server/browser route matters.
    - Dashboard and package-engine behavior depends on served JSON and fetch paths. `file://` inspection can mislead.

## 10. Next improvements

### Highest priority

1. Make the lifecycle source of truth easier to inspect.
   - Add or document one command that prints: status, workflow bucket, first blocker, Creator QA, capture acceptance, ready-to-shoot, ready-for-rough-cut, publish/upload/archive readiness, and next safe action.

2. Reduce premature artifact generation.
   - Gate downstream file generation by current lifecycle stage.
   - Prefer explicit placeholders or checklists over publish/archive files before real stage evidence exists.

3. Clarify May 2 capture-evidence boundary.
   - Do not proceed to rough-cut/edit progression until real take, screen, and audio evidence exists and capture evidence review reaches PASS with human acceptance.
   - Keep production approval separate from Creator QA, Stage 4 acceptance, and capture evidence acceptance.

4. Add a minimum file policy.
   - Define which files are canonical at each stage.
   - Mark proof/audit files as review-only unless the lifecycle code reads them.

5. Improve score provenance.
   - If package score affects decisions, store the scoring rubric, inputs, and calculation output next to `selected-package.json`.

### Practical operator-guide improvements

1. Write a short guide: `How to take a package run from candidates to Creator QA`.
2. Write a short guide: `How to repair a blocked run without over-approving it`.
3. Write a short guide: `How to approve capture evidence safely`.
4. Write a short guide: `How to read the dashboard and doctor output`.

### Dashboard/tooling improvements

1. Show explicit distinction between:
   - draft package material,
   - captured evidence,
   - accepted evidence,
   - Creator QA pass,
   - dashboard readiness,
   - Mikko production approval.

2. Highlight conflicting readiness markers.
   - Example: production files say `READY TO SHOOT`, but index says blocked.

3. Add a visible `Mikko approval: not recorded` field.
   - This would reduce accidental promotion from generated readiness to human approval.

4. Treat review-only proof files as audit support, not lifecycle gates, unless intentionally wired into lifecycle logic.

## May 2 final interpretation

Current May 2 state should be treated as:

- Repaired package/research/script/production-planning material: yes.
- Creator QA: PASS, 35/35, based on `creator-qa-report.md`.
- Stage 4 shot/edit plan accepted: yes, based on `shot-edit-plan-review.md`.
- Current inferred stage from doctor/capture-gap: `Needs capture`.
- Capture evidence status: `NEEDS CAPTURE`.
- Capture evidence accepted: no.
- Real capture evidence detected: no.
- Ready for rough-cut work: no.
- Dashboard/index bucket after regeneration should be `Needs capture`.
- Overall status: `BLOCKED`.
- Ready to shoot: production planning and Stage 4 now say yes, but this is not capture, rough-cut, edit, publish, upload, archive, or production approval.
- Production approved: no.
- Ready for Mikko review: yes, for capture-evidence intake/review boundaries and any separate production approval decision.

The safest recommendation is to keep May 2 blocked from rough-cut, editing progression, publishing, upload, archive, Hermes memory updates, and project-state promotion until capture evidence contains concrete media references, missing-shot/capture blockers are closed, capture evidence review passes, and human acceptance is recorded. Do not infer Mikko production approval from any deterministic gate.
