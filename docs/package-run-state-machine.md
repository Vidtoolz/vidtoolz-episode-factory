# Package Run State Machine

This document defines shared package-run status language for Episode Factory, Hermes, Codex, ChatGPT, and the markdown knowledge base. It is documentation-first and does not change run behavior. The core rule is conservative: file existence can suggest a milestone, but it does not prove readiness by itself.

Use this state machine when reviewing `package-runs/*`, writing handoffs, updating dashboards, or asking Hermes for weekly review. Treat it as a shared vocabulary until scripts are deliberately updated to enforce it.

## Principles

- A state is a review judgment, not just a filename match.
- Evidence must be inspectable in the run folder or in a cited reviewed artifact.
- Draft planning files do not approve shooting, editing, publishing, upload prep, or Hermes memory writes.
- A later state requires the earlier state to be valid, not merely present.
- When files conflict, use the more conservative state until Mikko reviews the conflict.
- A `package-run-state.md` marker can classify a run as `active`, `parked`, or `superseded`.
- Missing, malformed, or unknown package-run state markers are treated conservatively as active.
- `parked` and `superseded` runs remain visible as inactive diagnostics, but they do not count as active dashboard, doctor, or cockpit blockers.
- A parked or superseded marker does not approve production, capture, rough cut, publishing, upload, archive, Hermes brain writes, project-state promotion, final title, final thumbnail, or ready-to-shoot state.

## Package Run State Marker

The optional local marker file is `package-run-state.md`.

Recognized format:

```markdown
# Package Run State

- Package run state: active
```

Recognized values are `active`, `parked`, and `superseded`.

`active` preserves normal behavior. `parked` means work is intentionally inactive and should not appear as an active blocker. `superseded` means a newer package run has replaced this run. Both inactive states become the primary run status while keeping the underlying reactivation status visible as diagnostics. Downstream readiness stays false unless the run is reactivated and the real evidence gates independently pass.

## State Names

### 1. Intake Created

Meaning: A run folder exists and the initial prompt or notes exist.

Minimum evidence:
- `generation-prompt.md` or equivalent run-start note.
- `notes.md` identifying run focus or workflow source.

Does not count as evidence:
- Placeholder candidate JSON only.
- A folder name without notes.

Allowed next actions:
- Generate or paste package candidates.
- Review candidate structure.

Blocked next actions:
- Outline approval.
- Script approval.
- Production prep.
- Shooting, editing, publishing, upload prep.

### 2. Package Selected

Meaning: A specific package has been chosen for outline work.

Minimum evidence:
- `selected-package.json` or `selected-package.md`.
- Human-readable package title/promise in the selected package file.

Does not count as evidence:
- Candidate list alone.
- A note saying a package is likely to win.

Allowed next actions:
- Create or review outline prep artifacts.
- Draft final outline.

Blocked next actions:
- Script approval without a reviewed outline.
- Production prep.
- Shooting, editing, publishing, upload prep.

### 3. Outline Prep Started

Meaning: Outline-prep files exist, but no reviewed final outline exists yet.

Minimum evidence:
- `selected-package.json` or `selected-package.md`.
- `outline-prompt.md`, `outlines.md`, or `final-outline.md`.
- `final-outline.md`, if present, is still placeholder, incomplete, or explicitly not selected/written.

Does not count as evidence:
- `final-outline.md` that says "Not selected yet", "Not written yet", or equivalent placeholder wording.
- Script-prep placeholder files generated before the outline is actually reviewed.

Allowed next actions:
- Review outline options.
- Write or repair `final-outline.md`.

Blocked next actions:
- Script approval.
- Production prep.
- Shooting, editing, publishing, upload prep.

### 4. Outline Ready

Meaning: A final outline exists and is ready for script work.

Minimum evidence:
- `final-outline.md`.
- The outline is not only placeholder text.
- The outline does not say "Not selected yet", "Not written yet", or equivalent placeholder wording.
- Any known outline QA blockers are resolved or explicitly accepted by Mikko.

Does not count as evidence:
- `outline-prompt.md` by itself.
- `outlines.md` containing options without a chosen final outline.

Allowed next actions:
- Create or review script prep artifacts.
- Draft or revise `final-script.md`.

Blocked next actions:
- Production prep without a reviewed final script.
- Shooting, editing, publishing, upload prep.

### 5. Script Ready

Meaning: A final script exists and can be reviewed for production planning.

Minimum evidence:
- `final-script.md`.
- Script is not only placeholder text.
- The script does not say "Not finalized yet", "Not written yet", or equivalent placeholder wording.
- Known script QA blockers are resolved or explicitly accepted by Mikko.

Does not count as evidence:
- `script-prompt.md`.
- `script-draft.md` alone.
- `production-notes.md` with placeholder sections only.

Allowed next actions:
- Review script.
- Create production prep artifacts only after script approval.
- Add practical production notes.

Blocked next actions:
- Shooting approval.
- Editing.
- Publishing or upload prep.

### 6. Proof Planning

Meaning: The run has identified what needs to be captured or verified, but proof has not yet been captured.

Minimum evidence:
- `capture-verification-note.md` or `evidence-capture-plan.md`.
- The note identifies the tool, prompt, expected proof, or capture target.

Does not count as evidence:
- `capture-verification-note.md` as captured proof.
- A planned prompt.
- A checklist of what should be recorded.

Allowed next actions:
- Perform or document the actual capture.
- Create a result note.
- Review whether the proof plan still matches the script.

Blocked next actions:
- Treating proof as captured.
- Production readiness.
- Shooting, editing, publishing, upload prep.

### 7. Proof Missing

Meaning: A proof requirement exists, but the run does not contain durable captured proof.

Minimum evidence:
- A capture plan exists with no result note, or
- `capture-result-note.md` says no captured output is available, or
- a result note lacks transcript, screenshot, or recording evidence required by the claim.

Does not count as evidence:
- A result note that explicitly says "no output available".
- Temporary screenshots that are not imported or cited as durable evidence.
- Agent claims that a capture happened without an inspectable artifact.

Allowed next actions:
- Capture or import proof evidence.
- Rewrite claims to avoid unsupported proof language.
- Ask Mikko whether prepared examples can be labeled as prepared examples.

Blocked next actions:
- Production readiness.
- Shooting approval based on proof.
- Publishing claims that depend on missing proof.

### 8. Transcript Captured, Visual Proof Missing

Meaning: Text output was captured, but no durable screenshot or recording has been imported.

Minimum evidence:
- `capture-transcript.md` or a result note citing a pasted transcript.
- `capture-result-note.md` clearly states whether screenshot or recording evidence exists.

Does not count as evidence:
- Claims that a screenshot was temporarily taken but not imported.
- Transcript text as visual proof.
- Transcript text as proof of tool capabilities beyond what was captured.

Allowed next actions:
- Review transcript claims.
- Decide whether transcript-only evidence is enough for planning.
- Capture or import visual proof if the video needs visual proof.

Blocked next actions:
- Claiming original visual proof exists.
- Shooting approval that relies on original visual proof.
- Publishing tool-capability claims without separate fact check.

### 9. Reproduced Visual Evidence Available, Original Visual Proof Missing

Meaning: Durable screenshot or recording evidence exists, but it is reproduced, controlled, partial, or otherwise not original visual proof for the original transcript/session.

Minimum evidence:
- Screenshot or recording files exist in the run folder or a cited evidence folder.
- An evidence index or review note labels the evidence boundary.
- The evidence is explicitly limited as reproduced, controlled, partial, planning-only, or not original transcript evidence.

Does not count as evidence:
- Reproduced evidence as original transcript proof.
- Screenshot existence as shooting approval.
- A privacy check as claim/factual approval.
- A proof-capture instruction pack as completed proof capture.

Allowed next actions:
- Use the evidence for planning only within its stated boundary.
- Review whether a separate shooting approval can be requested.
- Capture/import original visual proof only if still needed and explicitly approved.

Blocked next actions:
- Claiming original visual proof exists.
- Treating reproduced evidence as production approval.
- Shooting, editing, publishing, upload prep without separate approval.

### 10. Production Planning Draft

Meaning: Production prep artifacts exist, but they are planning drafts only.

Minimum evidence:
- `production-brief.md`.
- `shooting-plan.md`.
- `b-roll-list.md`.
- `graphics-list.md`.
- `resolve-edit-checklist.md`.
- `thumbnail-title-check.md`.
- `publish-pack.md`.
- A review note or QA state that does not block planning.

Does not count as evidence:
- Existence of production files as production approval.
- Draft shooting list as shooting approval.
- Draft publish pack as publish approval.

Allowed next actions:
- Review production plan.
- Run or review Creator QA.
- Repair evidence, title, thumbnail, script, or claims.
- Prepare a separate shooting approval request.

Blocked next actions:
- Shooting.
- Editing.
- Publishing.
- Upload prep.
- Final title/final thumbnail lock.

### 10a. Shot/Edit Plan Review Gate

Meaning: Stage 4 planning has been reviewed after Mikko's manual edits, but it is accepted only when the Stage 4 review explicitly passes.

Minimum evidence:
- `production-plan.md` has `Shoot-readiness status: READY TO SHOOT`.
- `shot-edit-plan-review.md` exists.
- `shot-edit-plan-review.md` says `Review status: PASS`.
- `shot-edit-plan-review.md` says `Stage accepted: yes`.
- The approval marker was added in a Stage 4 planning artifact, not only in upstream research, structure, or script-review files.

Does not count as evidence:
- `production-plan.md` by itself.
- `Shoot-readiness status: READY TO SHOOT` without `shot-edit-plan-review.md`.
- `shot-edit-plan-review.md` with `READY FOR HUMAN APPROVAL` and `Stage accepted: no`.
- Upstream `Manual approval: PASS` markers from research, structure, or script review.
- Capture checklist files created before Stage 4 is accepted.

Allowed next actions:
- If `shot-edit-plan-review.md` is missing, run `node scripts/package-run-shot-edit-plan-review.js package-runs/<run-id>`.
- If review status is `BLOCKED` or `NEEDS WORK`, repair planning artifacts and rerun the review.
- If review status is `READY FOR HUMAN APPROVAL`, ask Mikko for an explicit Stage 4 decision.
- If review status is `PASS` and `Stage accepted: yes`, create or review capture checklist artifacts.

Blocked next actions:
- Shooting.
- Editing.
- Publishing.
- Upload prep.
- Final title/final thumbnail lock.
- Hermes brain write.
- Project-state promotion.

### 11. QA Repair Needed

Meaning: Creator QA or a review artifact found blocking issues.

Minimum evidence:
- `creator-qa-report.md` or `creator-qa-report.json` with `FAIL`, `NEEDS WORK`, or another blocking status, or
- a review note explicitly blocking readiness.

Does not count as evidence:
- High numeric score alone if the report still says `NEEDS WORK`.
- Production artifacts existing beside a blocking QA result.

Allowed next actions:
- Repair package, script, title, thumbnail, proof, or claims.
- Re-run review after repair.

Blocked next actions:
- Shooting approval.
- Publishing.
- Upload prep.

### 12. Shooting Approval Candidate

Meaning: The run may be reviewed for a narrow shooting approval, but is not approved yet.

Minimum evidence:
- Production planning drafts exist.
- Known evidence boundaries are written down.
- Final script is coherent enough for a shooting review.
- Open blockers are narrow enough for Mikko to approve or reject explicitly.

Does not count as evidence:
- A shooting plan file by itself.
- A dashboard "Ready to shoot" label without evidence review.
- A previous planning approval.

Allowed next actions:
- Ask Mikko for a separate shooting approval decision.
- Define exact shooting scope and forbidden claims.

Blocked next actions:
- Recording before approval.
- Editing.
- Publishing.
- Upload prep.

### 13. Ready To Shoot

Meaning: Mikko has explicitly approved a shooting scope.

Minimum evidence:
- Explicit Mikko approval for shooting.
- Final script or approved shooting script.
- Evidence boundary accepted.
- Title/thumbnail language is either approved or excluded from the shooting decision.
- No blocking Creator QA or proof-capture status remains for the approved shooting scope.

Does not count as evidence:
- Complete production prep artifacts.
- No QA report.
- A planning note that says "continue production planning".

Allowed next actions:
- Shoot only the approved scope.
- Capture only approved screen evidence.

Blocked next actions:
- Editing beyond approved capture organization.
- Publishing.
- Upload prep.
- Final title/final thumbnail lock unless separately approved.

### 14. Ready For Edit

Meaning: Approved footage or captures exist and editing may begin.

Minimum evidence:
- Shooting was approved.
- Captured media or screen evidence exists.
- Mikko approved moving into edit.

Does not count as evidence:
- Resolve edit checklist by itself.
- B-roll list by itself.

Allowed next actions:
- Create or update Resolve project.
- Import approved media.
- Edit within approved scope.

Blocked next actions:
- Publishing.
- Upload prep.
- Final release claims without review.

### 15. Ready For Publish Prep

Meaning: The edit has been reviewed enough to prepare final publish materials.

Minimum evidence:
- Edited video or render candidate exists.
- Final title/thumbnail direction is approved.
- Publish pack is reviewed as a draft.

Does not count as evidence:
- `publish-pack.md` existing.
- Draft description or chapters.

Allowed next actions:
- Finalize title, thumbnail, description, chapters, tags, pinned comment.
- Prepare upload checklist.

Blocked next actions:
- Upload without Mikko approval.
- Publishing claims not supported by evidence.

### 16. Ready To Publish

Meaning: Mikko has approved upload/publish.

Minimum evidence:
- Final export exists.
- Final title and thumbnail are approved.
- Publish pack is complete and reviewed.
- Evidence-sensitive claims are checked.
- Mikko explicitly approves publishing.

Does not count as evidence:
- Draft publish pack.
- Completed edit alone.

Allowed next actions:
- Upload/publish within approved scope.

Blocked next actions:
- Changing promise, claims, title, or thumbnail after approval without re-review.

## Cross-State Evidence Rules

The following do not count as readiness evidence by themselves:

- File existence without inspected content.
- Placeholder sections.
- Draft planning language.
- Generated downstream artifacts without real physical production evidence.
- Agent summaries without cited source files.
- Dashboard labels without evidence review.
- `capture-verification-note.md` as captured proof.
- `capture-result-note.md` saying no output is available.
- Temporary screenshots that are not imported or cited in the run folder.
- Proof-capture instructions or templates without pasted output.
- Claims that ChatGPT, Codex, or Hermes produced something unless the output is preserved.
- A local transcript as original visual proof.
- Placeholder final files as reviewed final outline/script evidence.

After Stage 4 acceptance, downstream review artifacts remain scaffolds until
the physical production evidence is present:

- Capture requires real captured-source evidence, such as non-placeholder
  `takes-log.md` rows, completed screen/audio capture rows, and an exact capture
  readiness marker. `capture-checklist.md` existing is not proof of capture.
- Rough-cut progress requires real `rough-cut-watch-notes.md`. A generated
  `rough-cut-review.md` with `READY FOR SECOND CUT` is not enough if the watch
  notes are starter, placeholder, or empty.
- Final-review progress requires real `final-watch-notes.md`. A generated
  `final-review.md` with `PASS` is not enough without final-watch evidence.
- Export/upload readiness requires concrete `master-file-manifest.md`,
  `loudness-check.md`, `caption-check.md`, and `delivery-readiness.md` evidence
  plus exact export/mastering/delivery approval markers.
- Publication metadata readiness requires complete non-placeholder title,
  thumbnail, description, chapters, and schedule artifacts plus exact metadata
  approval.
- Archive readiness requires real publication/export evidence and concrete
  archive manifests with exact archive approval. Archive files cannot become the
  next blocker while earlier physical production stages are unproven.

Special capture rules:

- `capture-verification-note.md` is proof planning, not proof capture.
- `capture-result-note.md` saying "no output available" is evidence of missing proof, not captured proof.
- A transcript can support transcript-level claims, but it does not prove original screen capture or recording exists.
- A screenshot or recording must be imported or cited as durable evidence before it counts as visual evidence.
- Reproduced or controlled visual evidence still does not count as original captured proof.

## Allowed Next Actions By State

- Intake Created: generate or paste candidates.
- Package Selected: create or review outline.
- Outline Prep Started: review outline options and write/repair final outline.
- Outline Ready: create or review script.
- Script Ready: review script, then consider production prep.
- Proof Planning: perform proof capture or write a result note.
- Proof Missing: capture/import proof or rewrite unsupported claims.
- Transcript Captured, Visual Proof Missing: review transcript and decide whether visual proof is required.
- Reproduced Visual Evidence Available, Original Visual Proof Missing: use evidence for planning only or request a separate approval decision.
- Production Planning Draft: review/repair plan, QA, evidence, title, thumbnail.
- QA Repair Needed: repair and re-review.
- Shooting Approval Candidate: request explicit Mikko shooting approval.
- Ready To Shoot: shoot approved scope only.
- Ready For Edit: edit approved material.
- Ready For Publish Prep: prepare final publishing assets.
- Ready To Publish: publish only after explicit approval.

## Blocked Next Actions By State

The default blocked actions before explicit approval are:

- shooting
- editing
- publishing
- upload prep
- final title lock
- final thumbnail lock
- Hermes brain write
- project-state promotion

Production prep artifacts can exist before those actions are allowed. They are drafts until an approval note says otherwise.

## Example Classifications

These examples are based on the current files and review notes in the repo. They are examples only; they do not write status into the run folders.

### `package-runs/2026-05-02-next-vidtoolz-video`

Classification: `QA Repair Needed`.

Evidence:
- Production prep artifacts exist: `production-brief.md`, `shooting-plan.md`, `b-roll-list.md`, `graphics-list.md`, `resolve-edit-checklist.md`, `thumbnail-title-check.md`, and `publish-pack.md`.
- `creator-qa-report.md` says `Overall result: NEEDS WORK`.
- The report flags title benefit and thumbnail promise issues.

Allowed next action:
- Review `creator-qa-report.md` and repair title/thumbnail/package issues.

Blocked:
- Shooting.
- Editing.
- Publishing.
- Upload prep.

### `package-runs/2026-05-02-ai-video-idea-filter`

Classification: `Outline Prep Started`.

Evidence:
- `selected-package.json` exists.
- `outline-prompt.md`, `outlines.md`, and `final-outline.md` exist.
- `final-outline.md` says `Not selected yet` and `Not written yet`.
- `final-script.md` exists, but says `Not finalized yet`.
- `production-notes.md` exists but contains placeholder planning sections such as `Not prepared yet`.
- Production prep artifacts are not present.

Allowed next action:
- Review outline options and write or repair `final-outline.md`.

Blocked:
- Script approval.
- Production prep.
- Production readiness.
- Shooting.
- Editing.
- Publishing.
- Upload prep.

### `package-runs/2026-05-06-ai-video-proof-plan`

Classification: `Production Planning Draft` with evidence boundary: `Reproduced Visual Evidence Available, Original Visual Proof Missing`.

Evidence:
- Production prep artifacts exist.
- `capture-verification-note.md` documents a proof plan.
- `capture-result-note.md` says a pasted transcript exists in `capture-transcript.md`.
- `capture-result-note.md` says no durable screen recording or screenshot was imported at that point.
- `evidence/evidence-index.md` now lists imported screenshot files and says capture 6 is sufficient for production planning as reproduced evidence.
- `evidence/evidence-index.md` also says original transcript visual proof is not available and shooting approval is not approved.
- `proof-capture-pack.md` exists, but it says it is an instruction pack only and does not claim proof has been captured.
- `production-prep-review.md` says production readiness remains `FAIL`, final title/final thumbnail are not approved, and shooting/editing/publishing/upload prep are blocked.
- `shooting-approval-readiness-review.md` says the run is not approved for shooting.

Allowed next action:
- Use the reproduced visual evidence for planning only within its stated boundary.
- Continue bounded review or prepare a separate narrow shooting approval request if Mikko wants to consider shooting.

Blocked:
- Shooting.
- Editing.
- Publishing.
- Upload prep.
- Final title/final thumbnail lock.
- Hermes brain write.

## Relationship To The Dashboard Evidence Gate

The dashboard evidence gate is the current local status layer that detects proof-related files and warns when a run should not be treated as production-ready. This state machine gives that gate shared vocabulary and stricter interpretation rules.

The dashboard can detect:

- proof plan files
- result notes
- missing captured output language
- transcripts
- screenshot or recording references
- Creator QA status

The state machine adds:

- proof planning is not proof capture
- transcript evidence is not visual proof
- production artifacts are not production approval
- dashboard readiness should not override explicit review blockers
- Mikko approval is required for shooting, editing, publishing, and remote project-state promotion

If dashboard file detection and a human review note disagree, use the more conservative state until Mikko resolves it.

## Relationship To Hermes Weekly Review

Hermes weekly review should use these state names when summarizing package runs. It should not infer readiness from filenames alone.

Hermes should report:

- current state
- exact evidence files
- blockers
- allowed next 30-minute task
- blocked actions
- whether any claim depends on missing capture, unresolved QA, or Mikko approval

Hermes should not:

- promote a run to durable memory based only on file existence
- treat production prep drafts as approval
- treat `capture-verification-note.md` as captured proof
- treat a "no output available" result note as proof captured
- start production prep or publish prep from the weekly review

## Manual Finish Test

A package-run state review is complete when:

- the state name is assigned from inspected files, not assumptions
- evidence files are named
- non-evidence is called out
- allowed next action is one bounded task
- blocked actions are explicit
- Mikko approval requirements are preserved
