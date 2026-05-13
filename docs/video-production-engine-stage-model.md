# Video Production Engine Stage Model v1

The Video Production Engine stage model is an organizing layer over the existing Package Engine `package-runs/` workflow. It does not create a second run folder model, lifecycle, or approval system; readiness still follows the conservative package-run doctrine in `docs/package-run-state-machine.md`: files are evidence only after their contents and approval markers are inspected.

## Stage 1: Idea / Topic Selection

- Purpose: Turn raw creator notes into a candidate video package inside `package-runs/`.
- Existing input artifacts: `notes.md`, run-start context, copied creator notes, existing package candidates when present.
- Existing output artifacts: `generation-prompt.md`, `package-candidates.json`, `package-candidates.md`, `selected-package.json`, `selected-package.md`.
- Existing script/tool touchpoints: `package-engine-new-run.js`.
- Manual path: Mikko writes or pastes candidate packages and chooses the package to continue.
- Agent/draft-generation path: local prompts can help draft candidate packages, but output is pasted or saved manually.
- Human-edited intake path: manually edited `selected-package.json` or `selected-package.md` remains the source for later stages.
- Analysis/review path: inspect selected package promise, target viewer, problem, and evidence needs before outline work.
- Enhancement path: repair vague promise, unsupported angle, or weak target viewer in the selected package file.
- Acceptance check: a selected package exists and contains a concrete package title/promise, not just candidate options.
- Blocked actions: script approval, production prep, shooting, editing, publishing, upload prep, archive automation, Hermes brain write.

## Stage 2: Outline / Structure

- Purpose: Convert the selected package into a reviewed outline and script structure boundary.
- Existing input artifacts: `selected-package.json`, `selected-package.md`, `research-pack.md`, `research-sufficiency-review.md`, `research-evidence.md`, `source-support-map.md`, `proof-capture-plan.md`, `research-objections.md`.
- Existing output artifacts: `outline-prompt.md`, `outlines.md`, `final-outline.md`, `script-structure.md`.
- Existing script/tool touchpoints: `package-run-research-pack.js`, `package-run-research-evidence.js`, `package-run-script-structure.js`, `package-engine-new-outline.js`.
- Manual path: Mikko reviews outline options, edits `final-outline.md`, and resolves research or structure gaps.
- Agent/draft-generation path: scripts generate local prompts and draft structure artifacts without external API calls.
- Human-edited intake path: edited `final-outline.md` and `script-structure.md` are read by downstream review scripts.
- Analysis/review path: research sufficiency and script structure gates check whether the outline can support a script.
- Enhancement path: strengthen proof ladder, objections, act structure, examples, or unsupported-claim boundaries.
- Acceptance check: `final-outline.md` is non-placeholder and structure/research gates are ready or explicitly approved.
- Blocked actions: script approval without reviewed structure, production prep, shooting, editing, publishing, upload prep.

## Stage 3: Script

- Purpose: Produce and review a script that can safely feed production planning.
- Existing input artifacts: `final-outline.md`, `script-structure.md`, `research-pack.md`, research evidence artifacts, selected package artifacts.
- Existing output artifacts: `script-prompt.md`, `script-draft.md`, `final-script.md`, `production-notes.md`, `script-review.md`, `script-revision-plan.md`.
- Existing script/tool touchpoints: `package-engine-new-script.js`, `package-run-script-review.js`.
- Manual path: Mikko drafts or edits `final-script.md` and applies script revisions.
- Agent/draft-generation path: local prompt artifacts can be used for draft generation outside the repo, then pasted back manually.
- Human-edited intake path: `final-script.md` and manually repaired review/revision artifacts remain inspectable package-run files.
- Analysis/review path: `package-run-script-review.js` checks script readiness, research gate, structure gate, Creator QA status, and placeholder/claim signals.
- Enhancement path: apply `script-revision-plan.md` without treating script existence as approval.
- Acceptance check: `script-review.md` says `Script review status: PASS` and `Production planning ready: yes`, with upstream gates satisfied.
- Blocked actions: shooting approval, editing, publishing, upload prep, final title lock, final thumbnail lock.

## Stage 4: Shot Plan / Edit Plan

- Purpose: Convert the approved script into concrete production planning artifacts, then review Mikko's manual edits before shooting or edit assembly.
- Existing input artifacts: `final-script.md`, `script-review.md`, `script-revision-plan.md`, `script-structure.md`, `research-pack.md`, `research-sufficiency-review.md`, `research-evidence.md`, `source-support-map.md`, `proof-capture-plan.md`, `research-objections.md`, `selected-package.json`, `selected-package.md`, `creator-qa-report.json`, `creator-qa-report.md`.
- Existing output artifacts: `production-plan.md`, `shot-list.md`, `screen-capture-list.md`, `demo-list.md`, `b-roll-list.md`, `graphics-list.md`, `audio-notes.md`, `production-blockers.md`, `shot-edit-plan-review.md`, `shot-edit-plan-enhancement-plan.md`.
- Existing script/tool touchpoints: `package-run-production-plan.js`, `package-run-shot-edit-plan-review.js`.
- Manual path: Mikko edits the planning artifacts after the planner creates them.
- Agent/draft-generation path: `package-run-production-plan.js` creates first-pass local planning lists from existing run artifacts.
- Human-edited intake path: `package-run-shot-edit-plan-review.js` reads the edited planning artifacts and never overwrites them.
- Analysis/review path: the Stage 4 review checks upstream gates, placeholder/TODO content, concrete planning coverage, blockers, and exact approval markers.
- Enhancement path: `shot-edit-plan-enhancement-plan.md` suggests repairs without applying them.
- Acceptance check: upstream gates are satisfied, all planning artifacts are concrete, and an exact marker exists: `Manual approval: PASS`, `Production planning approval: PASS`, or `Shot/edit plan approval: PASS`.
- Blocked actions: shooting, editing, publishing, upload prep, final title lock, final thumbnail lock, Hermes brain write, project-state promotion without explicit approval.

## Stage 5: Edit Draft

- Purpose: Move from approved capture scope into rough-cut assembly and review.
- Existing input artifacts: approved Stage 4 planning artifacts, `capture-checklist.md`, `takes-log.md`, `missing-shot-tracker.md`, `screen-recording-checklist.md`, `audio-capture-checklist.md`.
- Existing output artifacts: `rough-cut-watch-notes.md`, `rough-cut-review.md`, `pickup-list.md`, `edit-fix-list.md`.
- Existing script/tool touchpoints: `package-run-capture-checklist.js`, `package-run-rough-cut-review.js`.
- Manual path: Mikko captures footage, assembles the edit, and writes watch notes.
- Agent/draft-generation path: scripts create local checklists and review starters, not media edits.
- Human-edited intake path: edited watch notes and checklist rows are inspected by review scripts.
- Analysis/review path: rough-cut review checks second-cut readiness and pickup/edit-fix needs.
- Enhancement path: repair missing shots, rough edits, audio issues, or proof gaps.
- Acceptance check: rough-cut approval is explicit and blockers are closed.
- Blocked actions: publishing, upload prep, final release claims, archive automation.

## Stage 6: Packaging

- Purpose: Prepare title, thumbnail, description, metadata, export checks, and repurposing candidates after edit review.
- Existing input artifacts: final/rough-cut review artifacts, `publish-pack.md`, `thumbnail-title-check.md`, `final-watch-notes.md`, edit review outputs.
- Existing output artifacts: `final-review.md`, `publish-metadata-review.md`, `export-checklist.md`, `repurposing-plan.md`, platform variant artifacts.
- Existing script/tool touchpoints: `package-run-final-review.js`, `package-run-publication-metadata.js`, `package-run-export-checklist.js`, `package-run-repurpose.js`, `package-run-broll-prompts.js`.
- Manual path: Mikko selects and approves final title, thumbnail, description, chapters, and export decisions.
- Agent/draft-generation path: scripts produce local review and checklist artifacts only.
- Human-edited intake path: manually edited publish/export artifacts are inspected, not auto-published.
- Analysis/review path: final review, metadata review, export checklist, and repurposing checks identify blockers.
- Enhancement path: repair packaging gaps, evidence-sensitive claims, title/thumbnail mismatch, loudness/export issues.
- Acceptance check: required packaging review artifacts explicitly pass with human approval where required.
- Blocked actions: upload, publish, archive, external sync, Hermes brain write unless separately approved.

## Stage 7: Publish-Ready Review

- Purpose: Decide whether the completed package is ready for upload/publish.
- Existing input artifacts: final review, export checklist, publication metadata review, delivery/loudness checks, final title/thumbnail decisions, master manifest when present.
- Existing output artifacts: publish-ready decision notes, archive manifest artifacts, release check outputs when created.
- Existing script/tool touchpoints: `package-run-final-review.js`, `package-run-publication-metadata.js`, `package-run-export-checklist.js`, `package-run-archive-manifest.js`.
- Manual path: Mikko inspects final render, metadata, claims, and release timing.
- Agent/draft-generation path: local scripts can assemble checklists and manifests; they do not upload or publish.
- Human-edited intake path: final human decisions remain in package-run artifacts.
- Analysis/review path: publish-ready review checks final approval, metadata completeness, export readiness, and unresolved blockers.
- Enhancement path: repair final title/thumbnail, description, chapters, tags, loudness/export defects, or unsupported claims.
- Acceptance check: explicit publish approval exists and all required final/export/metadata checks pass.
- Blocked actions: upload/publish without explicit approval, post-approval claim/title/thumbnail changes without re-review, memory-write automation.
