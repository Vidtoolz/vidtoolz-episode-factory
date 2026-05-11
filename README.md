# VIDTOOLZ Episode Factory

VIDTOOLZ Episode Factory v1.7.4 is a local-first static web app for turning rough YouTube ideas into complete production packages and running a stable weekly creator workflow.

The purpose is practical creator discipline: keep the topic, promise, title options, thumbnail concept, hook, script outline, structured production checklists, Shorts extraction checks, publish checks, and notes in one compact place before a solo creator starts shooting.

It has no backend for the main episode app, no authentication, and no external API integrations. Episode data is saved in browser `localStorage` under `vidtoolz-episode-factory-v1`.

Important: browser `localStorage` is not a durable backup system. Export JSON regularly, especially before browser cleanup, import testing, or release work. The app shows backup health and recommends export when a recent JSON backup is missing.

For terminal-first work, the dependency-free CLI can also store inspectable episode JSON in `data/episodes.json` and write outline artifacts under `episodes/`. This is separate from browser `localStorage` until you import/export JSON manually.

## v1.7.4 Features

- Create, edit, delete, and duplicate episodes
- Manage episodes on a compact status board
- Track packaging, scripting, production, editing, shorts, publishing, and notes in one detail view
- Use structured checkbox groups for Packaging Gate, production, editing, Shorts extraction, and publishing
- See readiness scoring for packaging, script, production, publish, and overall readiness
- Use the Weekly Review dashboard to see pipeline counts, recent work, blockers, publish candidates, and the next focus session
- Use the Execution Queue to pick the next 30-minute task across active episodes
- Run a single active focus session with elapsed time tracking
- See active focus session progress against the task estimate
- Complete queue tasks with an inline form, record work sessions, and keep episode history
- See app and backup status: total episodes, total work sessions, backup health, last JSON export, last JSON import, and active session state
- See compact backup recommendations after meaningful local changes when no recent export exists
- Filter the board by All, Packaging blocked, Ready to shoot, Ready to publish, and Published
- Copy single-episode exports for Markdown, Hermes, Linear, production, YouTube, and Codex
- Copy selected-episode exports for Creator QA JSON and Creator QA Markdown
- Copy weekly review outputs for Hermes, Linear, and creator review markdown
- Download the selected episode as a full Markdown package
- Download the selected episode as Creator QA JSON or Creator QA Markdown
- Export all stored episode data as JSON
- See an active-session warning when exporting while a focus session draft exists
- Preview JSON imports before local data changes
- Import by replacing the library, merging new episodes only, or merging and updating matching episodes
- Confirm risky import modes when no recent JSON export exists
- Create a realistic VIDTOOLZ/DaVinci Resolve demo episode for manual testing without replacing existing data
- Run as plain HTML, CSS, and JavaScript with no build step
- Use a small local CLI for file-backed episode records, next-action review, packaging checks, and outline artifact generation

## Run Locally

Serve the app directory:

```sh
cd /home/vidtoolz/vidtoolz-episode-factory
./scripts/serve-local.sh
```

Then open:

```text
http://localhost:8010
```

You can also run:

```sh
PORT=8020 ./scripts/serve-local.sh
```

The local server also handles Package Engine thumbnail generation. Opening
`index.html` directly still works for normal editing, but Package Engine
thumbnail candidates require the local server. Do not use
`python3 -m http.server 8010` for Package Engine thumbnails; it can serve the
page, but it cannot handle `POST /api/package-engine/thumbnails`. If an old
Python static server is occupying `8010`, stop it or run `./scripts/serve-local.sh`
so the launcher can replace it.

By default, Package Engine thumbnails are local placeholder SVG previews. To use
external OpenAI image generation, start the server with:

```sh
THUMBNAIL_PROVIDER=openai OPENAI_API_KEY="$OPENAI_API_KEY" ./scripts/serve-local.sh
```

Optional image-generation settings:

```sh
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_SIZE=1536x1024
OPENAI_IMAGE_QUALITY=auto
OPENAI_IMAGE_FORMAT=png
```

Real image generation may cost money, take longer than placeholder mode, and may
require OpenAI organization verification. API keys stay on the local Node server
and are never sent to the browser.

Open the isolated Package Engine review UI:

```text
http://localhost:8010/package-engine.html
```

Generate the Package Runs dashboard index:

```sh
node scripts/package-runs-index.js
```

Or regenerate the index and print the exact local server command and dashboard
URL:

```sh
node scripts/package-runs-dashboard-launch.js
```

Then open the local status dashboard:

```text
http://localhost:8010/package-runs-dashboard.html
```

The dashboard shows Creator QA as a workflow gate: `FAIL` moves a run into
`Needs QA repair`, while complete production prep with no QA report appears as
`QA not run` with the local QA command.

Use [docs/package-run-state-machine.md](docs/package-run-state-machine.md)
for the conservative shared status language behind run review. File existence
does not prove shooting, editing, publishing, or proof-capture readiness.

Create a local Package Engine run folder and prompt:

```sh
node scripts/package-engine-new-run.js "AI video idea filter"
```

Then review that run:

```text
http://localhost:8010/package-engine.html?run=YYYY-MM-DD-ai-video-idea-filter
```

Run prep reads the Hermes workflow at
`/home/vidtoolz/hermes-organiser/brain/workflows/vidtoolz-package-engine.md`,
creates a local `package-runs/` folder, and prepares a paste-ready prompt. It
does not call AI APIs, write into Hermes brain, or create Episode Factory
episodes.

After selecting a winning package and saving `selected-package.json` or
`selected-package.md` into the run folder, create a review-first research pack:

```sh
node scripts/package-run-research-pack.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `research-pack.md` in the run folder. It does not call external
APIs or update Hermes brain. If `research-pack.md` already contains manual
edits, the script skips it unless `--overwrite` is explicit.

`research-pack.md` existing is only a file workflow state. Script prep checks
the `Research Sufficiency Gate`; `PARTIAL`, `BLOCKED`, missing, or unreadable
research stays marked as not ready to draft unless a human adds an explicit
`PASS` or equivalent approval marker.

Create the standalone script-structure gate artifact:

```sh
node scripts/package-run-script-structure.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes only `script-structure.md`. It does not create draft, final script,
or production notes files. The artifact includes the proof ladder, act
structure, beat-by-beat outline, required examples, objections, retention risks,
unsupported claims, local context inputs, and script-readiness gate.
`package-engine-new-script.js` also creates this file as a convenience during
script prep, but the standalone command is the primary review tool.

After the research pack exposes the proof gaps clearly enough to continue and
the script structure boundary is reviewed, create the outline prompt:

```sh
node scripts/package-engine-new-outline.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `outline-prompt.md`, `outlines.md`, and `final-outline.md` for a
manual three-outline drafting loop.

After approving `final-outline.md`, create reviewable script prep artifacts:

```sh
node scripts/package-engine-new-script.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `script-prompt.md`, `script-structure.md`, `script-draft.md`,
`final-script.md`, and `production-notes.md`. It does not call AI APIs, write
into Hermes brain, or create Episode Factory episode folders.

After drafting or approving the script, run the local script review:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `script-review.md` and `script-revision-plan.md` only. Production
planning remains blocked unless the review status is `PASS`.

To rebuild the revision plan from an existing review without regenerating the
review artifact:

```sh
node scripts/package-run-script-review.js package-runs/YYYY-MM-DD-ai-video-idea-filter --from-review
```

After script review passes, create the local production planning gate and work
lists:

```sh
node scripts/package-run-production-plan.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `production-plan.md`, `shot-list.md`,
`screen-capture-list.md`, `demo-list.md`, `b-roll-list.md`,
`graphics-list.md`, `audio-notes.md`, and `production-blockers.md`. It does
not create rough-cut review, final review, publish, archive, or Shorts
repurposing artifacts. Existing manually edited planning files are preserved
unless `--overwrite` is explicit.

`package-run-production-plan.js` is the review-first production planning gate.
It can only mark `READY TO SHOOT` when script review is `PASS`, production
planning is ready, research and script structure are approved, a script file
exists, and no blockers are detected. `package-engine-new-production.js` is the
broader production prep pack for brief, shooting plan, Resolve checklist,
thumbnail/title, and publish prep.

After production planning is approved, create the capture execution checklist:

```sh
node scripts/package-run-capture-checklist.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `capture-checklist.md`, `takes-log.md`,
`missing-shot-tracker.md`, `screen-recording-checklist.md`, and
`audio-capture-checklist.md`. It does not analyze media files or create
rough-cut, final-review, publish, archive, or repurposing artifacts.
`READY FOR ROUGH CUT` requires approved production planning, clear production
blockers, completed required planning rows, and an exact capture/audio
readiness approval marker after real capture review.

After a first watchable edit exists, create the local rough-cut review starter
and second-cut gate:

```sh
node scripts/package-run-rough-cut-review.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `rough-cut-watch-notes.md`, `rough-cut-review.md`,
`pickup-list.md`, and `edit-fix-list.md`. It does not analyze video files, call
external APIs, create final review, create publish/archive artifacts, create
Shorts plans, or create new production plan artifacts. If watch notes are
missing, it creates a starter template and blocks second-cut readiness until a
real manual watch review is recorded.

`package-run-rough-cut-review.js` can mark `READY FOR SECOND CUT` only when real
watch notes exist, production was approved for shooting or manually approved,
production blockers are not open, and no pickup/edit blockers remain unless an
exact approval marker is present.

After final watch review, create the local final review gate:

```sh
node scripts/package-run-final-review.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `final-watch-notes.md`, `final-review.md`, and
`publication-blockers.md`. It blocks publication readiness when rough-cut review
is blocked, final-watch notes are missing or still a starter template, or
publication blockers remain open. It also blocks when `publish-pack.md` is
missing or still placeholder/draft metadata. `READY TO PUBLISH` requires an
exact final approval marker in real final-watch notes.

After final review approves publication, create the local export/mastering
checklist:

```sh
node scripts/package-run-export-checklist.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `export-checklist.md`, `master-file-manifest.md`,
`caption-check.md`, `loudness-check.md`, and `delivery-readiness.md`. It does
not inspect video files, upload, publish, archive, call external APIs, or create
repurposing artifacts. `READY TO UPLOAD` requires final review approval, clear
publication blockers, concrete export/master metadata, loudness and captions
assessment, and an exact delivery approval marker.

After export/mastering readiness passes, validate publication metadata:

```sh
node scripts/package-run-publication-metadata.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `publish-metadata-review.md`, `title-check.md`,
`thumbnail-check.md`, `description-check.md`, `chapters-check.md`, and
`schedule-check.md`. It does not call YouTube APIs, upload, schedule, publish,
archive, or create scheduled jobs. `READY TO SCHEDULE` requires final review and
export readiness, clear publication blockers, complete title/thumbnail/
description/chapters/schedule metadata, and an exact metadata approval marker.

After the long-form episode has final approval, create repurposing candidates:

```sh
node scripts/package-run-repurpose.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `repurposing-plan.md`, `shorts-candidates.md`, and
`platform-variants.md`. It does not create final review, rough-cut review,
production planning, publish-pack, or archive artifacts. It can only mark
`READY TO CUT SHORTS` when final review is approved, publish readiness is `yes`,
publication blockers are clear, and `transcript.md` or `final-script.md`
exists. Blocked or starter states produce not-assessed shorts rows rather than
clean or closed candidate states.

After approving `final-script.md` and reviewing the production plan, create
local production prep artifacts:

```sh
node scripts/package-engine-new-production.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `production-brief.md`, `shooting-plan.md`, `b-roll-list.md`,
`graphics-list.md`, `resolve-edit-checklist.md`, `thumbnail-title-check.md`,
and `publish-pack.md`. Existing human-edited artifacts are skipped instead of
overwritten.

Run local Creator QA against a package run before shooting or publishing:

```sh
node scripts/package-run-creator-qa.js package-runs/YYYY-MM-DD-ai-video-idea-filter
```

This writes `creator-qa-package.md`, `creator-qa-report.md`, and
`creator-qa-report.json` into the run folder. It uses the local
`/home/vidtoolz/vidtoolz-creator-qa` CLI, defaults to the
`ai_video_breakdown` profile, maps only `final-script.md` into the generated
`# Script` section, and does not approve or publish anything automatically.

Create a deterministic 2-minute local trailer cue prep folder:

```sh
node scripts/trailer-cue-new.js "AI video workflow trailer"
```

Supported options are `--out`, `--date`, `--preset`, and `--help`. The initial
v1.1 preset is `dark-fairytale-trailer` for a Red Riding Hood / dark fairytale
cue. Unsupported presets fail clearly and no cue folder is created.

This writes `section-map.md`, `tempo-map.md`, `resolve-markers.csv`,
`patch-recommendations.md`, `render-checklist.md`, `test-notes.md`, and
separate MIDI files for motif, drone, pulse, riser, climax hits, and final sting under
`trailer-cues/YYYY-MM-DD-ai-video-workflow-trailer/`. It does not call AI APIs,
generate audio, control Resolve, control DAWs, load plugins, or render stems.
See [docs/trailer-cue-generator.md](docs/trailer-cue-generator.md).
Use [docs/trailer-cue-validation-workflow.md](docs/trailer-cue-validation-workflow.md)
for the manual DAW, patch, render, Resolve, and Fairlight validation pass.

## CLI Episode Workflow

Initialize local CLI storage on a fresh checkout:

```sh
node scripts/episode-factory.js init
```

This creates `data/episodes.json` using the same JSON export shape as browser/CLI import and export, with an empty `episodes` array. It creates the `data/` directory when needed and refuses to overwrite existing storage by default. If you intentionally want to replace only `data/episodes.json` with a fresh empty library, use:

```sh
node scripts/episode-factory.js init --force
```

Before init, `doctor` treats the missing default CLI library as a normal first-run state, prints “No episode library found yet,” suggests `init`, and exits `0`. Missing files passed with `doctor --file path/to/file.json` are still real errors and exit non-zero.

Recommended fresh CLI workflow:

1. `node scripts/episode-factory.js init`
2. `node scripts/episode-factory.js doctor`
3. `node scripts/episode-factory.js create --title "Fix flat DaVinci Resolve exports" --format long`
4. `node scripts/episode-factory.js block plan --episode "Fix flat DaVinci Resolve exports"`
5. `node scripts/episode-factory.js block next`

Create a file-backed episode record:

```sh
node scripts/episode-factory.js create \
  --title "Fix flat DaVinci Resolve exports" \
  --topic "Resolve export color workflow" \
  --format long \
  --audience "Solo creators editing in DaVinci Resolve" \
  --premise "A practical checklist for avoiding flat-looking exports"
```

List local file-backed episodes:

```sh
node scripts/episode-factory.js list
```

Show the next 30-minute task package:

```sh
node scripts/episode-factory.js next
```

Run the YouTube packaging gate:

```sh
node scripts/episode-factory.js check-packaging
```

Write a structured outline artifact:

```sh
node scripts/episode-factory.js outline
```

Export the CLI library for browser import:

```sh
node scripts/episode-factory.js export --out exports/episode-library.json
```

Import a browser export into the CLI library:

```sh
node scripts/episode-factory.js import exports/episode-library.json
```

The default CLI import mode is `merge-new`: it adds new episodes and skips matching, conflicting, or possible duplicate episodes. Use `--mode merge-update` to update same-id/same-title matches, or `--mode replace --yes` when you intentionally want to replace the CLI library.

By default the CLI writes `data/episodes.json` and `episodes/YYYY-MM-DD-title/outline.md`. Use `--data path/to/episodes.json` to keep a separate working set.

Check local data before it creates workflow friction:

```sh
node scripts/episode-factory.js doctor
node scripts/episode-factory.js doctor --file exports/episode-library.json
node scripts/episode-factory.js doctor --json
```

Use `doctor` before importing browser JSON, after manual edits to `data/episodes.json`, or when browser/CLI data looks wrong. It is read-only by default. Exit code is `0` when there are no serious errors, including the first-run “not initialized yet” state for the default CLI storage. It exits non-zero when an explicit file cannot be read, JSON is invalid, or the file cannot be safely used or imported. Warnings mean the data is usable but needs attention.

## 30-Minute Work Blocks

Work blocks are persisted inside each episode and are included in normal CLI/browser JSON export and import. The CLI is the primary work-block interface for now.

The browser app also shows work blocks for the selected episode. Use it to review planned blocks, add a custom block, plan starter blocks, start a block, mark it done, skip it, and edit block notes while reviewing the broader episode package.

Plan starter blocks for an episode:

```sh
node scripts/episode-factory.js block plan --episode "Fix flat DaVinci Resolve exports"
```

Add a custom block:

```sh
node scripts/episode-factory.js block add \
  --episode "Fix flat DaVinci Resolve exports" \
  --category publish \
  --objective "Finalize title and thumbnail promise" \
  --inputs "Title ideas|Thumbnail concept|Outline" \
  --steps "Pick strongest promise|Check promise against outline|Write final shortlist" \
  --done "Title shortlist is ready for review"
```

Pick the next focused block:

```sh
node scripts/episode-factory.js block next
```

Start, complete, or skip a block:

```sh
node scripts/episode-factory.js block start block-id
node scripts/episode-factory.js block done block-id --notes "Finished title shortlist"
node scripts/episode-factory.js block skip block-id --notes "Blocked until footage exists"
node scripts/episode-factory.js block list
```

Priority order is deterministic and local: `publish`, then `close-loop`, then `system`, then `admin`. Done and skipped blocks are ignored. Within a category, active blocks come first, then open blocks, then older `createdAt`.

Recommended daily use:

1. `node scripts/episode-factory.js block next`
2. Do the work for 30 minutes.
3. Use the browser when you want to review or edit the episode plan and work blocks visually.
4. `node scripts/episode-factory.js block done <block-id> --notes "..."`
5. Export/import JSON when switching between CLI and browser storage.
6. Repeat if energy and time remain.

## Browser And CLI Storage

The browser app stores its working library in `localStorage` under `vidtoolz-episode-factory-v1`. The CLI stores an inspectable JSON library at `data/episodes.json`. Both surfaces use the same export shape:

```js
{
  app: "VIDTOOLZ Episode Factory",
  appVersion: "1.7.4",
  schemaVersion: 1,
  storageKey: "vidtoolz-episode-factory-v1",
  exportedAt: "...",
  version: 1,
  selectedId: "episode-id",
  counts: { episodes: 1 },
  episodes: []
}
```

Recommended Vidtoolz workflow:

- Use the CLI for quick capture, next-action checks, packaging review, and outline file generation.
- Use the browser UI when visual board review, work-block review/editing, checklist editing, work sessions, or copy/download package actions are useful.
- Export/import JSON when switching surfaces. Browser `Export JSON` can be imported by the CLI, and CLI `export --out` can be imported by the browser.

## Verification

Run the full verification set:

```sh
./scripts/verify.sh
```

This runs dependency-free model tests and JavaScript syntax checks.

## Smoke Test

After automated verification, run the manual browser checklist in [docs/smoke-test.md](docs/smoke-test.md).

High-level browser checks:

- Create a new episode and confirm it appears under Idea.
- Edit every detail field and refresh the page to confirm localStorage persistence.
- Move an episode through each board status.
- Toggle structured checklist items and confirm readiness scores update.
- Use each board filter and confirm the visible cards match the filter.
- Confirm the Weekly Review dashboard updates after status, checklist, and work-session changes.
- Copy each Weekly Review output.
- Copy each Execution Queue task package format.
- Start, pause, reset, complete, and abandon an active focus session.
- Confirm the active focus session progress bar moves against the estimated minutes.
- Complete a queue task and confirm selected checklist items, session history, and next action update.
- Confirm completed active sessions record start and end timestamps.
- Edit and delete a recent work session.
- Use Resume blocker and Repeat task from a recent session.
- Duplicate and delete an episode.
- Use each copy button through a local server page.
- Download a Markdown package and confirm it includes readiness scores and checklist states.
- Export JSON and confirm the file contains an `episodes` array.
- Confirm the status strip updates the last JSON export timestamp.
- Import a valid backup, review the preview, and confirm each import mode changes the current browser state as expected.
- Confirm the status strip updates the last JSON import timestamp.
- Create a demo episode and confirm existing episodes remain.
- Import invalid JSON and confirm the current browser state remains unchanged.

## File Structure

- `index.html` defines the static app shell.
- `styles.css` contains the compact responsive UI.
- `episode-model.js` owns statuses, field definitions, checklist definitions, normalization, duplication, readiness scoring, weekly review generation, execution queue generation, work sessions, and package export builders.
- `scripts/episode-factory.js` provides the local file-backed CLI.
- `scripts/package-engine-new-script.js` creates local Script Prep artifacts from a selected package and final outline.
- `scripts/package-engine-new-production.js` creates local Production Prep artifacts from a selected package, final outline, and final script.
- `scripts/package-run-creator-qa.js` runs local Creator QA over Package Engine run artifacts.
- `scripts/package-run-production-plan.js` turns approved script/review state into local production planning lists and a conservative shoot-readiness gate.
- `scripts/package-run-rough-cut-review.js` turns manual rough-cut watch notes into pickup/edit-fix lists and a conservative second-cut readiness gate.
- `scripts/package-runs-index.js` generates the local Package Runs dashboard index.
- `scripts/package-runs-dashboard-launch.js` regenerates the Package Runs index and prints the local dashboard launch command.
- `scripts/trailer-cue-new.js` creates local deterministic trailer cue prep folders with text maps, Resolve marker CSV, checklists, and MIDI files.
- `trailer-cue-generator.js` owns the trailer cue section map, tempo map, marker CSV, patch/checklist builders, and dependency-free MIDI writer.
- `package-runs-dashboard.html` and `package-runs-dashboard.js` render the static Package Runs dashboard.
- `storage-adapter.js` wraps `localStorage` behind a small interface for later storage changes.
- `app.js` renders the board and detail view, wires editing, persistence, duplication, deletion, JSON export/import, and clipboard actions.
- `tests/run-tests.js` verifies core model behavior without browser dependencies.
- `scripts/serve-local.sh` starts the local app server.
- `package-engine-server.js` serves the local app and the Package Engine thumbnail-generation API.
- `scripts/verify.sh` runs all automated tests and syntax checks.
- `CHANGELOG.md` documents release history.
- `docs/data-model.md` documents the episode state shape and status flow.
- `docs/smoke-test.md` documents the manual smoke test.
- `docs/weekly-review.md` documents the weekly review workflow.
- `docs/release-checklist.md` documents release testing, tagging, backup, and publishing steps.
- `docs/known-limitations.md` documents current limits.
- `docs/episode-workflow.md` documents the intended YouTube workflow.
- `docs/package-engine-script-prep-workflow.md` documents the Script Prep workflow.
- `docs/package-engine-production-prep-workflow.md` documents the Production Prep workflow.
- `docs/package-run-creator-qa-workflow.md` documents the Package Run Creator QA workflow.
- `docs/package-runs-dashboard-workflow.md` documents the Package Runs dashboard workflow.
- `docs/trailer-cue-generator.md` documents the Trailer Cue Generator workflow and limits.
- `docs/trailer-cue-validation-workflow.md` documents the manual real-world trailer cue validation pass.
- `docs/packaging-gate.md` documents the gate criteria.
- `docs/creator-qa-export.md` documents the Creator QA export mapping.

## Current Limitations

- Data is local to the current browser profile unless exported and imported elsewhere.
- JSON import now requires preview and explicit confirmation before replacing or merging local data.
- No backend, account sync, collaboration, or cloud backup.
- No Linear, GitHub, Hermes, or YouTube API integration yet.
- No drag-and-drop between board columns yet.
- Legacy text checklist fields are still stored for compatibility, but the UI uses structured checklist groups.

## Integration Path

The app intentionally keeps integration-ready text generation inside `episode-model.js`. Later Linear, GitHub, and Hermes integrations can call the same package builders or replace copy buttons with API-backed actions without changing the core episode shape.

## Episode Package Exports

The selected episode can produce:

- Full Episode Markdown Package: complete portable episode artifact.
- Hermes memory update: compact state summary for project memory.
- Linear issue body: task-ready issue text with readiness and remaining work.
- Production brief: shoot/edit focused handoff.
- YouTube publish package: title, thumbnail, description, Shorts, and publish checklist.
- Codex follow-up task: prompt for the next useful production/package improvement.
- Creator QA JSON: selected episode export for `creator-qa check-episode-json`.
- Creator QA Markdown Package: selected episode export for `creator-qa check`.

These are local copy/download actions only. They do not call Linear, GitHub, Hermes, Codex, or YouTube APIs.

## Creator QA Export

Use `Copy Creator QA JSON` or `Download Creator QA JSON` when the selected episode should be checked by Vidtoolz Creator QA v0.5:

```sh
cd /home/vidtoolz/vidtoolz-creator-qa
source .venv/bin/activate
creator-qa check-episode-json /path/to/export.json --hermes-report
```

Use `Copy Creator QA Markdown` or `Download Creator QA Markdown` when the package should be inspected or edited as Markdown first:

```sh
cd /home/vidtoolz/vidtoolz-creator-qa
source .venv/bin/activate
creator-qa check /path/to/export.md --hermes-report
```

Creator QA export mapping is documented in [docs/creator-qa-export.md](docs/creator-qa-export.md).

## Execution Queue

The Execution Queue generates one recommended 30-minute task per active episode when useful. Tasks are sorted by practical urgency:

1. Packaging blocked
2. Script not ready
3. Ready to shoot
4. Editing incomplete
5. Ready to publish

Each task includes a title, episode title, reason, source blocker, concrete steps, success criteria, and copy buttons for Human, Hermes, Linear, and Codex task packages.

Completing a task opens an inline form on the queue. It records a work session on the episode and asks for actual minutes, result, remaining blocker, notes, next action, and selected checklist items to mark complete. Checklist items are never marked complete unless selected by the user.

Recent sessions can be copied as Hermes session updates, Linear progress comments, Codex follow-up prompts, or episode history markdown.

Recent sessions can also be edited, deleted after confirmation, resumed from the recorded blocker, or repeated as a fresh task package.

## Weekly Review Dashboard

The Weekly Review dashboard summarizes the full local episode library without storing new source-of-truth records. It shows pipeline counts by status, completed sessions from the last 7 days, focused minutes, episodes touched, the most recent completed session, blocked episodes, closest-to-publish episodes, and the top Execution Queue task as the recommended next focus session.

Weekly copy outputs are local clipboard text only:

- Hermes weekly memory update
- Linear weekly progress summary
- Creator review markdown

## Focus Session Runner

Use `Start Session` on a queue task to create one active focus session. The runner shows the episode, task, type, reason, estimate, elapsed time, steps, success criteria, source blocker, and relevant checklist items.

The active session draft is stored separately in `localStorage` under `vidtoolz-episode-factory-active-session-v1`, so refreshing the page does not lose the timer state. Active sessions are app-level drafts and are not included in episode JSON exports. Completing an active session opens the same completion form and turns the work into a normal episode `workSessions` entry.

The runner shows a progress bar capped at 100% against the task estimate. Completing an active session carries the active session start time into the completed work session and records an end time.

## Backup And App Status

The status strip shows total episodes, total work sessions, last JSON export, last JSON import, and active session state. Export/import timestamps are stored separately in `localStorage` under `vidtoolz-episode-factory-backup-status-v1`; they are local browser metadata and do not change the JSON backup payload.

Backup health reports whether the library has never been exported, was exported today, how many days old the last export is, or whether export is recommended. Replace and merge-update import modes warn when there is no recent export. JSON export still excludes active focus session drafts, and the export status calls that out when a session is active.
