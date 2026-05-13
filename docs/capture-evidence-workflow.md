# Capture Evidence Workflow

Capture Evidence v1 is the conservative manual-intake gate between Stage 4
approval and rough-cut work. It uses the existing package-run capture artifacts
and adds one review artifact: `capture-evidence-review.md`.

The workflow is local-first. It does not inspect media automatically, call
external APIs, write to Hermes, create GitHub/Linear/YouTube records, upload,
publish, archive, or promote project state.

## Artifacts

Manual evidence is recorded in the existing capture files:

- `capture-checklist.md`
- `takes-log.md`
- `screen-recording-checklist.md`
- `audio-capture-checklist.md`
- `missing-shot-tracker.md`

The review command writes only:

- `capture-evidence-review.md`

Generated checklist rows are not proof. Real evidence needs concrete references
such as captured take names, timestamps, screen recording files, audio files, or
local media paths.

## Review Command

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug --json
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
```

Statuses:

- `BLOCKED`: Stage 4 is not accepted or required capture artifacts are missing.
- `NEEDS CAPTURE`: capture artifacts exist, but real evidence, closed missing
  shots, resolved blockers, or concrete capture references are missing.
- `READY FOR HUMAN APPROVAL`: all required evidence categories are concrete,
  missing shots are closed or accepted, blockers are resolved, and exact capture
  approval is missing.
- `PASS`: Stage 4 is accepted, all required evidence categories are concrete,
  missing shots are closed or accepted, blockers are resolved, and exact capture
  approval is present.

Required evidence categories:

- concrete take / camera / A-roll evidence in `takes-log.md`
- concrete screen recording, screenshot, or screen proof evidence in
  `screen-recording-checklist.md`
- concrete audio or voiceover evidence in `audio-capture-checklist.md`

Accepted approval markers:

- `Capture approval: PASS`
- `Capture evidence approval: PASS`
- `Rough-cut assembly approval: PASS`

Approval markers alone do not pass the gate. They must be paired with all three
required evidence categories. The approval marker must appear after the
concrete take, screen, and audio evidence it approves, so an older marker in a
starter or checklist file cannot automatically approve newly added evidence
rows. Image-only references do not satisfy audio evidence.

## Dashboard Path

Regenerate the index and start the local server:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-runs-index.js
cd /home/vidtoolz/vidtoolz-episode-factory && ./scripts/serve-local.sh
```

Open:

```text
http://127.0.0.1:8010/package-runs-dashboard.html
```

Each run card includes a `Capture Evidence` panel inside the lifecycle review
area. It shows review status, accepted yes/no, real evidence detected yes/no,
missing capture evidence, open missing-shot/blocker detail, next safe action,
and a `Capture Evidence Intake` form.

The intake form has structured fields for:

- takes / A-roll / camera capture
- screen recording capture
- audio / voiceover capture

It generates exact Markdown rows for:

- `takes-log.md`
- `screen-recording-checklist.md`
- `audio-capture-checklist.md`

Each generated row has a copy button. The form validates required real-evidence
fields such as take identifier, media filename/path, screen recording
filename/path, and audio filename/path. Weak placeholders or generic generated
text should not be pasted as proof.

The dashboard also has a local-only write path:

- The browser first fetches a per-server local write nonce from the local status
  response.
- Preview and Apply must include that nonce.
- The server accepts only local `Host` / `Origin` values such as
  `http://127.0.0.1:8010` or `http://localhost:8010`.
- Missing `Origin` is allowed for intentional curl/local CLI tests.
- `Preview write` calls the local server and shows the exact marked Markdown
  sections that would be written.
- Preview performs no file writes.
- `Apply to run files` is disabled until a successful preview returns.
- Apply updates only the marked `capture-evidence-intake` section in
  `takes-log.md`, `screen-recording-checklist.md`, and
  `audio-capture-checklist.md`.
- Apply writes `capture-evidence-intake-log.md` in the same run folder for a
  local audit trail.
- Apply does not write approval markers and does not advance lifecycle state.

The approval helper can copy `Capture evidence approval: PASS`, but the
dashboard text deliberately says this marker is not enough without real evidence
rows. Do not add approval until after human review.

## Manual GUI Smoke Test

1. Find a run blocked at `Needs capture`.
2. Confirm the dashboard says real capture evidence is missing.
3. Confirm generated capture files are labelled `Not trusted as proof` or
   `Missing evidence`.
4. Open `Capture Evidence Intake`.
5. Fill concrete evidence fields such as `media/take-01-hook.mov`,
   `recordings/workflow-proof-001.mp4`, `audio/voiceover-main.wav`, take
   identifier, and quality notes.
6. Click `Preview write`.
7. Confirm the exact Markdown preview is visible and no files have changed yet.
8. Click `Apply to run files`.
9. Confirm only `takes-log.md`, `screen-recording-checklist.md`,
   `audio-capture-checklist.md`, and `capture-evidence-intake-log.md` changed.
10. Keep approval out until human review. Applied rows do not create PASS.
11. Run:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-run-capture-evidence-review.js package-runs/YYYY-MM-DD-topic-slug --overwrite
cd /home/vidtoolz/vidtoolz-episode-factory && node scripts/package-runs-index.js
```

12. Refresh the dashboard and confirm real evidence is detected.
13. Confirm the run remains blocked or `READY FOR HUMAN APPROVAL` until an exact
   approval marker is added after human review.
14. After approval, rerun the review and index. Confirm the dashboard only then
   allows progression toward rough-cut review, and still does not imply export,
   publishing, or archive readiness.
