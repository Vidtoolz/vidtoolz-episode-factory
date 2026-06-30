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

- header: title, package id, stage + progress, status pill;
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

## Troubleshooting (fallback only)

The import/index also have CLI equivalents for troubleshooting:
`node scripts/import-manual-images.js --package <id> --dry-run` and
`node scripts/index-package-media.js --package <id>`. These are a fallback, not
the main production path — the GUI buttons are preferred.
