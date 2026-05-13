# Package Runs Dashboard Workflow

Package Run Status Dashboard v1 is a local read-only browser view for checking
where each `package-runs/*` folder is in the Package Engine workflow and what
local command should run next.

The dashboard itself is static. It only reads `package-runs-index.json`.

## Generate The Index

Run this from the repo root:

```sh
node scripts/package-runs-index.js
```

To inspect a single run without regenerating the dashboard index or writing any
files, run:

```sh
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-doctor.js package-runs/YYYY-MM-DD-topic-slug --json
```

The doctor uses the same lifecycle logic as the index and reports the current
status, first blocking gate, detected artifacts, missing expected artifacts, and
next recommended command. It is read-only and calls no external APIs.

For daily use, run the launch helper from any current working directory:

```sh
node /home/vidtoolz/vidtoolz-episode-factory/scripts/package-runs-dashboard-launch.js
```

It regenerates `package-runs-index.json` and prints:

```text
package-runs-index.json updated
cd /home/vidtoolz/vidtoolz-episode-factory
PORT=8010 HOST=127.0.0.1 node package-engine-server.js
http://127.0.0.1:8010/package-runs-dashboard.html
```

It does not start a server unless `--serve` is passed. With `--serve`, the
server is started from the repo root.

This scans `package-runs/*` and writes:

```text
package-runs-index.json
```

No AI/API calls are made. The command does not write to Hermes brain, GitHub,
Linear, or any episode folder.

## Open The Dashboard

Serve the repo locally:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && ./scripts/serve-local.sh
```

Then open:

```text
http://localhost:8010/package-runs-dashboard.html
```

## Manual Lifecycle Gate Smoke Test

Use this browser path when manually accepting Stage 4 and downstream evidence
gate behavior. The dashboard is still read-only; it only displays the current
`package-runs-index.json` state.

1. Regenerate the index:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-runs-index.js
```

2. Start the local server:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && ./scripts/serve-local.sh
```

3. Open:

```text
http://localhost:8010/package-runs-dashboard.html
```

4. Find a run grouped under `Needs shot/edit plan review`, `Needs shot/edit
plan approval`, `Needs capture`, `Needs export check`, or another blocked
downstream bucket.

5. On the run card, confirm the `Lifecycle Review` panel shows:

- current inferred stage
- workflow bucket
- overall status
- first blocker
- next recommended command
- Stage 4 review status
- Stage 4 accepted `yes` / `no`
- Stage 4 next safe action
- conservative blocked actions
- missing expected artifacts
- `Detected but not trusted yet`

6. For a Stage 4 blocked run, confirm the panel labels the Stage 4 status as
`BLOCKED`, `NEEDS WORK`, or `READY FOR HUMAN APPROVAL`, and shows `Human
approval required` until the review is `PASS` and `Stage accepted: yes`.

7. For a run with generated downstream artifacts, confirm the panel lists those
files under `Detected but not trusted yet`, for example:

- `capture-checklist.md` exists but real capture evidence is missing
- `rough-cut-review.md` exists but capture evidence or real watch notes are
  missing
- `final-review.md` exists but upstream physical edit evidence is not proven
- export artifacts exist but concrete export evidence and approvals are missing
- archive artifacts exist but publication/export/archive evidence is missing

8. Confirm conservative blocked actions are visible. Blocked downstream states
must not visually imply upload, publishing, archive, Hermes brain write, or
project-state promotion are allowed.

9. Confirm the dashboard does not imply capture, edit, export, publication, or
archive readiness from generated files alone. The current inferred stage should
stay at the earliest unproven physical production gate.

## Capture Evidence Panel

The lifecycle review area also includes a `Capture Evidence` panel. Use it for
manual GUI testing after Stage 4 is accepted.

The panel shows:

- capture evidence review status
- capture evidence accepted `yes` / `no`
- real capture evidence detected `yes` / `no`
- missing capture evidence
- missing shots or open capture blockers
- next safe action
- conservative blocked actions from the lifecycle panel

It also includes a `Capture Evidence Intake` form. The form collects
structured evidence for takes/A-roll, screen recordings, and audio/voiceover,
then generates exact Markdown rows for `takes-log.md`,
`screen-recording-checklist.md`, and `audio-capture-checklist.md`. Each row has
a copy button.

The form also supports a narrow local-only write flow through the existing local
server:

- The dashboard fetches a per-server local write nonce from
  `/api/package-engine/status`.
- Preview and Apply include that nonce and are rejected without it.
- The server accepts only local `Host` / `Origin` values such as
  `http://127.0.0.1:8010` or `http://localhost:8010`; missing `Origin` is
  allowed for intentional curl/local CLI tests.
- `Preview write` shows the exact Markdown sections before any file changes.
- `Apply to run files` is disabled until preview succeeds.
- Apply writes only the marked intake section in the three approved capture
  files.
- Apply also writes `capture-evidence-intake-log.md` in the same run folder.
- Apply never writes `Capture evidence approval: PASS`.

Required real-evidence fields include concrete media references such as local
filenames, folder paths, take identifiers, or recording names. The form also
shows an approval marker helper, but approval alone is not proof and must only
be pasted after human review.

Manual capture smoke test:

1. Start the local server:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-runs-index.js
cd /home/vidtoolz/vidtoolz-episode-factory && ./scripts/serve-local.sh
```

2. Open:

```text
http://127.0.0.1:8010/package-runs-dashboard.html
```

3. Find a run blocked at `Needs capture`.
4. Confirm the Capture Evidence panel shows missing real capture evidence.
5. Confirm generated capture files are marked `Not trusted as proof` or
   `Missing evidence`.
6. Open `Capture Evidence Intake`.
7. Enter concrete evidence references such as `media/take-01-hook.mov`,
   `recordings/workflow-proof-001.mp4`, and `audio/voiceover-main.wav`.
8. Click `Preview write`.
9. Confirm exact Markdown preview is visible and no files changed before Apply.
10. Click `Apply to run files`.
11. Confirm only `takes-log.md`, `screen-recording-checklist.md`,
    `audio-capture-checklist.md`, and `capture-evidence-intake-log.md` changed.
12. Confirm the wording does not imply applied rows equal approved proof.
13. Run:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-runs-index.js
```

14. Refresh the dashboard. Real evidence can move the review to `READY FOR HUMAN
APPROVAL`, but rough-cut readiness still requires exact human approval.
15. Confirm the next safe action remains conservative and the dashboard does
not imply rough-cut, export, publish, or archive
readiness prematurely.

## Detected Files

For each run folder, the index records whether these files exist:

```text
package-candidates.json
selected-package.json
selected-package.md
outline-prompt.md
final-outline.md
script-prompt.md
script-structure.md
final-script.md
production-plan.md
production-blockers.md
shot-edit-plan-review.md
shot-edit-plan-enhancement-plan.md
capture-checklist.md
takes-log.md
missing-shot-tracker.md
screen-recording-checklist.md
audio-capture-checklist.md
capture-evidence-review.md
rough-cut-watch-notes.md
rough-cut-review.md
pickup-list.md
edit-fix-list.md
final-watch-notes.md
final-review.md
publication-blockers.md
export-checklist.md
master-file-manifest.md
caption-check.md
loudness-check.md
delivery-readiness.md
publish-metadata-review.md
title-check.md
thumbnail-check.md
description-check.md
chapters-check.md
schedule-check.md
archive-manifest.md
archive-source-files.md
archive-assets-manifest.md
archive-export-manifest.md
reusable-clips-manifest.md
archive-blockers.md
capture-verification-note.md
capture-result-note.md
capture-transcript.md
production-brief.md
shooting-plan.md
b-roll-list.md
graphics-list.md
resolve-edit-checklist.md
thumbnail-title-check.md
publish-pack.md
repurposing-plan.md
shorts-candidates.md
platform-variants.md
```

Available artifacts are rendered as direct local preview links from each run
card. Clicking one opens the artifact inside the dashboard. The preview panel
keeps an `Open raw file` link for the original Markdown file.

When `creator-qa-report.json` exists, each card also shows:

```text
Creator QA: PASS / NEEDS WORK / FAIL / not run
```

When `creator-qa-report.md` exists, the report is available as a preview link.
Regenerate the index after running Creator QA so the dashboard sees the new
status.

Creator QA is conservative. `PASS` does not block production readiness.
`FAIL`, `NEEDS WORK`, and any unknown non-empty Creator QA status are blocking
dashboard states. A run with complete Production Prep artifacts and a blocking
Creator QA report is grouped under `Needs QA repair` instead of `Ready to
shoot`. A run with complete Production Prep artifacts and no Creator QA report
is still artifact-ready, but it is grouped under `QA not run` and shows the
local Creator QA command.

## Evidence Gate

The Evidence Gate is a conservative local-only status layer for proof capture.
It separates a planned proof from durable captured proof, so production-prep
filenames alone cannot make a run production-ready when the run has an open
capture requirement.

The index detects:

- `capture-verification-note.md` as a capture plan
- `capture-result-note.md` as the documented capture result
- result notes that say no captured output exists
- local transcript, screenshot, or recording references when present

Supported Evidence Gate statuses:

- `not evaluated`: no capture plan/result files were detected
- `planned proof only`: a capture plan exists, but no capture result exists
- `capture missing`: a capture result exists, but it says no captured output
  exists or no transcript/screenshot/recording reference was detected
- `transcript captured; visual proof missing`: a capture transcript exists, but
  no durable screenshot or recording reference was detected
- `proof captured`: a capture result has a detected screenshot or recording
  reference

Blocking Evidence Gate states show a warning such as:

```text
Not production-ready: proof capture missing
```

If a run otherwise scans as `Ready to shoot`, a blocking Evidence Gate moves it
to the `Needs proof capture` workflow bucket. This prevents a run from being
treated as production-ready based only on a capture plan or production artifact
filenames.

## Artifact Preview

The preview panel renders a small safe Markdown subset:

- headings
- paragraphs
- bullet lists
- disabled checkboxes
- inline code and bold text
- fenced code blocks

The dashboard fetches files from the same local static server as the page. If a
preview fails, serve the repo root and reopen the dashboard:

```sh
./scripts/serve-local.sh
```

## Status Rules

The status is the highest completed workflow milestone:

- `Idea run`: no selected package yet
- `Package selected`: `selected-package.json` or `selected-package.md` exists
- `Research pack ready`: `research-pack.md` exists. This is only a file state;
  script prep still inspects the `Research Sufficiency Gate` before marking
  script structure ready to draft.
- `Outline prep ready`: `outline-prompt.md` exists
- `Final outline ready`: `final-outline.md` exists
- `Script prep ready`: `script-prompt.md` exists
- `Final script ready`: `final-script.md` exists
- `Production prep ready`: `production-brief.md` exists
- `Ready to shoot`: all Production Prep artifacts exist, Creator QA is `PASS`
  or `not run`, and Creator QA has no blocking status

After the older Production Prep milestone, the index also reads conservative
gate text from the dedicated package-run tools. It uses the first unmet gate as
the run status, so downstream smoke artifacts cannot make an earlier blocked
stage look ready:

- `Needs production planning` / `Ready for capture checklist`
- `Needs capture` / `Ready for rough cut`
- `Needs rough-cut review` / `Ready for second cut`
- `Needs final review` / `Ready to publish`
- `Needs export check` / `Ready to upload`
- `Needs publication metadata` / `Ready to schedule`
- `Needs archive data` / `Ready to archive`
- `Needs repurposing approval` / `Ready to cut shorts`

## Daily Filters

The dashboard groups runs into daily workflow filters:

- `Needs package selection`: no selected package exists yet
- `Needs research pack`: selected package exists, but `research-pack.md` does
  not exist yet
- `Needs outline`: `research-pack.md` exists, but final outline is not complete.
  If the Research Sufficiency Gate is `PARTIAL` or `BLOCKED`, run
  `node scripts/package-run-research-evidence.js package-runs/<run-id>` to
  collect local human-provided source, proof, and objection evidence before
  rerunning script structure or script review. Use
  `node scripts/package-run-script-structure.js package-runs/<run-id>` to
  inspect whether the research gate is actually ready to draft.
- `Needs script`: final outline exists, but final script is not complete
- `Needs production prep`: final script exists, but full Production Prep is not complete.
  Run `node scripts/package-run-script-review.js package-runs/<run-id>` before
  production planning; production planning is ready only when script review is
  `PASS`. Then run
  `node scripts/package-run-production-plan.js package-runs/<run-id>` to create
  the review-first production plan and blocker list before the broader
  production prep pack.
- Rough-cut review is a manual watch-notes workflow. Run
  `node scripts/package-run-rough-cut-review.js package-runs/<run-id>` after a
  first watchable edit exists. If watch notes are missing, the tool creates a
  starter `rough-cut-watch-notes.md` and blocks second-cut readiness until real
  notes are added.
- `Needs QA repair`: Creator QA returned `FAIL`, `NEEDS WORK`, or an unknown
  non-empty status
- `Needs proof capture`: full Production Prep artifacts exist, but the Evidence
  Gate is blocking production readiness
- `QA not run`: all Production Prep artifacts exist, but Creator QA has not run
- `Ready to shoot`: all Production Prep artifacts exist and Creator QA is
  `PASS`, with no blocking Evidence Gate status
- `Needs production planning`: `production-plan.md` exists but does not say
  `Shoot-readiness status: READY TO SHOOT`
- `Needs capture checklist`: production planning is ready, but capture
  execution artifacts have not been created
- `Needs capture`: capture artifacts exist, but the capture checklist is not
  `READY FOR ROUGH CUT`
- `Needs rough-cut review`: capture is ready or rough-cut artifacts exist, but
  the rough-cut review is not ready for second cut
- `Needs final review`: rough-cut review is ready or final-review artifacts
  exist, but final review is not publish-ready
- `Needs export check`: final review is publish-ready, but export/mastering is
  missing or not ready to upload
- `Needs publication metadata`: export is ready, but publication metadata is
  missing or not ready to schedule
- `Needs archive manifest`: publication metadata is ready, but archive data is
  missing or not ready to archive
- `Needs repurposing approval`: archive is ready or repurposing artifacts
  exist, but shorts are not ready to cut
- `Ready to archive`: publication/export metadata are complete enough for the
  archive manifest tool to run
- `Ready to cut shorts`: repurposing gate is ready

## Recommended Commands

When the next step is a local deterministic generator, each run card shows the
exact command:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-capture-checklist.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-rough-cut-review.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-final-review.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-export-checklist.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-publication-metadata.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-archive-manifest.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-repurpose.js package-runs/YYYY-MM-DD-topic-slug
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-topic-slug
```

When the next step is manual review or writing, the card shows the next expected
file instead.

If Creator QA returned `FAIL`, the next action is:

```text
Review creator-qa-report.md and repair package/script before shooting.
```

If Creator QA returned `NEEDS WORK` or another unknown non-empty status, the
next action is:

```text
Review Creator QA status NEEDS WORK and repair package/script before shooting.
```

If the Evidence Gate blocks production readiness, the next action is:

```text
Capture or import durable proof evidence before production approval.
```

## Finish Test

The dashboard is current when:

- `node scripts/package-runs-index.js` has been run after the latest package run
  file changes.
- `package-runs-index.json` exists at the repo root.
- `package-runs-dashboard.html` loads without a missing-index warning.
- The visible status for each run matches the files present in that run folder.
- Artifact links open existing local files.
- The workflow filter and recommended command point to the next practical local
  action.
