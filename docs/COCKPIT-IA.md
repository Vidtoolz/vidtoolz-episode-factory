# Cockpit information architecture: overview → project → focus

The cockpit is a guided production workspace, not a system dashboard. It has
four levels of focus. Overview views are dense; the project workspace is calm
and single-project; focus mode is minimal and action-oriented.

## Level 1 — Ideas (dense)

Page: `daily-idea-scout.html` (the existing idea bank). Shows many candidate
ideas for fast scanning/scoring/promotion. A valid idea has at least a
title/hook, premise, source/date, and status.

## Level 2 — Projects board (dense)

Page: `projects.html` → reads `GET /api/projects`. A compact, sortable,
filterable table of every aigen package with its stage, status, next task, and
last-updated. Search by title/package; filter by status/stage; a checkbox
reveals test/diagnostic packages (hidden by default). Each row has **Open →**.

## Level 3 — Project workspace (single project)

Page: `project-workspace.html?id=<package-id>` → reads
`GET /api/project-state?package=<id>`. Shows only the chosen project:

- header: title, package id, stage + progress, status pill, pathway pill
  (short/1-day vs long-form/multi-week) with a tempo guidance line;
- a prominent **Next task** card with the reason and the GUI action(s);
- compact evidence (counts: prompts, local/external images, selected, I2V
  prompts, local/external videos, handoff);
- blockers/warnings;
- collapsed sections for media list and routing notes.

Unrelated projects/ideas/global clutter are not shown.

## Level 4 — Focus mode (minimal)

Page: `project-focus.html?id=<package-id>`. One screen: project title, stage,
the exact current task, why it is next, required inputs, ONE primary action
(plus a safe alternate where relevant), blockers, and the completion evidence.
After a mutating action it re-resolves state and advances to the next task.
Escape hatches: Refresh task · Project workspace · Exit focus.

## The state resolver and next-task engine

`project-state-resolver.js` reads a package directory and returns a normalized,
deterministic state (stage, status, counts, blockers, warnings). It is file
driven — the operator never has to remember the next step. Stages
(`idea → approved_topic → script → image_prompts → image_generation →
image_review → i2v_prompts → video_generation → video_review →
resolve_handoff → editing → publish_prep → published`) are derived from the
furthest coherent evidence on disk. This is independent of the package-runs
`pipeline-tracker.js` gate model.

`next-task-engine.js` maps the resolved stage to a single next task with a
reason, required inputs, GUI action, blocked flag, and completion evidence.
Missing earlier artifacts (e.g. no script although images exist) surface as
warnings rather than derailing the next task.

## Production pathway: short/1-day vs long-form/multi-week

Every resolved project state carries a `pathway` — which production tempo the
project runs on:

- **`vertical`** — short vertical video (9:16, ≤ 3 min), intended to be built
  in one day. This is the **lane default**: the aigen script-package pipeline
  is the short/vertical flow by design, so an unmarked package is labeled
  `Short vertical · 1-day build` with `source: "default"`.
- **`horizontal`** — long-form (16:9), multi-week tempo: staged progress,
  approvals and evidence over speed.

Explicit markers always win over the default, in precedence order:
`project-status.json` (`workflow_path`/`pathway`) → `manifest.json`
(`workflow_path`/`video_format`/`orientation`) → `selected-package.json`
(`workflowPath`/`videoFormat`) → `promoted-from-idea.json` (`videoFormat`).
Accepted values: `vertical|short|shorts|9:16` and
`horizontal|long|long-form|longform|16:9`. An unrecognized value is treated as
absent (falls through to the default) — a typo never silently relabels a
project. Unlike `workflow-path.js` (package-runs world, unset → horizontal),
the project lane default is vertical; the two defaults are intentionally
different.

The pathway is shown as a pill/chip on the projects board, the project
workspace (with the tempo hint line), and focus mode; hovering it explains the
tempo and whether the label is an explicit marker or the lane default.

## GUI action model (no terminal for ordinary tasks)

`project-action-registry.js` maps each task to a SAFE GUI action — either:

- `open`: navigate to an in-GUI page (interactive tasks: write script, edit
  image prompts, review/select images, generate I2V prompts, review clips); or
- `post`: call an existing nonce-gated endpoint (generate local images, generate
  local videos, import manual external media, prepare Resolve handoff, set
  project status).

There is deliberately no "run arbitrary command" action. Endpoints used:
`/api/flux/submit`, `/api/presto/submit`, `/api/aigen/resolve-assembly/create`,
and the cockpit additions `/api/project/import-media` and `/api/project/status`.

## Manual external media (GPT / KlingAI) from the GUI

External generation stays manual in the browser. The cockpit provides the GUI
support around it: copy buttons / prompt sheets on the prompt pages, source
image references, and the **Import manual external images/videos** action,
which calls `POST /api/project/import-media` (dry-run supported) to index
dropped files with provenance (see `docs/MEDIA-ROUTING.md`). No browser
automation, no third-party APIs.

## When a task is blocked

Local lanes never silently fall back. If a required local service is down (e.g.
PRESTO ComfyUI), the action returns a blocked state and the workspace/focus view
shows the reason instead of a run button. Start the service and refresh, or use
the manual external import path.

## Endpoints (read-only unless noted)

- `GET /api/projects` — projects board summaries.
- `GET /api/project-state?package=<id>` — resolved state + next task + media.
- `GET /api/aigen/package-media-index?package=<id>` — merged local+external media.
- `POST /api/project/import-media` — import manual external media (nonce-gated).
- `POST /api/project/status` — set status / park / unpark (nonce-gated).

## Idea → project flow (GUI, no terminal)

Start at **Ideas** (`daily-idea-scout.html`) or **Projects** (`projects.html`) —
both are in the shared cockpit nav on every page.

On the Ideas page each idea has GUI buttons:

- **Approve / Park / Unpark / Reject** — set the idea's triage status. This writes
  a non-destructive sidecar (`<archive>/<date>/idea-triage.json`) keyed by the
  idea's position; the validated `ideas.json` is never rewritten. Reject and Park
  only change status — nothing is deleted. Endpoint: `POST /api/ideas/status`.
- **Promote to project** — creates a script-package project from the idea via
  `POST /api/ideas/promote`. Promotion is idempotent: clicking again opens the
  existing project instead of creating a duplicate (the button becomes
  **Open project →**). The new package gets `selected-package.json`,
  `manifest.json`, `promoted-from-idea.json`, and `project-status.json`.

A promoted project then appears on **Projects** (tagged source
`daily_idea_scout`), opens in `project-workspace.html?id=<id>`, and resolves
through the state resolver. A freshly promoted, script-less project is NOT
broken — it shows stage `script` with the next task **Write / approve the
script** (the action opens `package-engine.html`, an in-GUI page, never a
terminal). From the workspace, **Focus mode** shows that one task.

If a promoted project has no script/media yet, that is expected: the next-task
engine returns the first meaningful task rather than an error.

## Troubleshooting (fallback only)

The import/index also have CLI equivalents for troubleshooting:
`node scripts/import-manual-images.js --package <id> --dry-run` and
`node scripts/index-package-media.js --package <id>`. These are a fallback, not
the main production path — the GUI buttons are preferred.
