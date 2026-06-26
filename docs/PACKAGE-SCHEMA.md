# VIDTOOLZ Package Schema — Artifact Contracts

Documenting the expected artifacts at each stage of the episode production lifecycle, their schema, and who creates them.

## Package Run Artifacts (Episode Factory)

Location: `package-runs/<YYYY-MM-DD>-<slug>/`

| Artifact | Created by | Purpose | Required at stage |
|----------|-----------|---------|-------------------|
| STATUS.md | package-engine-run.js | Human-readable run status + current gate | All stages |
| status.json | package-engine-run.js | Machine-readable run state | All stages |
| research-pack.md | package-run-research-pack.js | Topic research with sources | Gate 1 |
| research-evidence.md | package-run-research-evidence.js | Evidence validation | Gate 1 |
| script-structure.md | package-run-script-structure.js | Script beat structure | Gate 2 |
| script-review.md | package-run-script-review.js | Script QA review | Gate 2 |
| production-plan.md | package-run-production-plan.js | Shot list + visual plan | Gate 3 |
| shot-edit-plan-review.md | package-run-shot-edit-plan-review.js | Edit plan review | Gate 3 |
| capture-checklist.md | package-run-capture-checklist.js | Camera capture checklist | Gate 3 |
| capture-evidence-review.md | package-run-capture-evidence-review.js | Capture proof review | Gate 4 |
| capture-gap.md | package-run-capture-gap.js | Missing capture items | Gate 4 |
| broll-prompts.md | package-run-broll-prompts.js | B-roll/AI background prompts | Gate 4 |
| rough-cut-review.md | package-run-rough-cut-review.js | Rough cut QA | Gate 5 |
| final-review.md | package-run-final-review.js | Final cut QA | Gate 5 |
| export-checklist.md | package-run-export-checklist.js | Export settings checklist | Gate 6 |
| publish-metadata-review.md | package-run-publication-metadata.js | Title, thumbnail, description, chapters | Gate 6 |
| newsletter.md | package-run-newsletter.js | Kit newsletter export | Gate 7 |
| archive-manifest.md | package-run-archive-manifest.js | Archive manifest | Gate 7 |
| repurpose.md | package-run-repurpose.js | Repurposing plan | Gate 7 |

## AIGEN Script Package Artifacts

Location: `VIDNAS:/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/<slug>/`

| Artifact | Created by | Purpose | Required at stage |
|----------|-----------|---------|-------------------|
| manifest.json | aigen pipeline | Package state + metadata | Package creation |
| selected-package.json | aigen pipeline | Selected idea metadata | Idea selection |
| selected-package.md | aigen pipeline | Human-readable selection record | Idea selection |
| image-prompts.json | aigen pipeline | FLUX image generation prompts | Pre Gate 4 |
| flux-generation-manifest.json | run-handoff.py | FLUX generation provenance | Gate 4 |
| selected-images.json | review-view PUT | Mikko's approved images | Gate 4 |
| prompts.txt | aigen pipeline | Raw prompt text (one per line) | Pre Gate 4 |
| decisions.log | aigen pipeline | Append-only decision log | All stages |
| friction-log-*.md | manual (Mikko) | Friction recording during runs | Validation runs |
| comfyui-handoff/ | aigen pipeline | ComfyUI handoff artifacts | Gate 4 |
| images/ | aigen pipeline | Generated images | Gate 4 |
| videos/ | aigen pipeline | Generated videos (Wan2.2) | Gate 4 |
| resolve-handoff/ | aigen pipeline | Staged media for Resolve import | Gate 5 |
| script/ | aigen pipeline | Script text files | Gate 2 |
| research/ | aigen pipeline | Research material | Gate 1 |

## Published Videos Registry

Location: `published-videos.json` (episode-factory root)

```json
[
  {
    "title": "Video title",
    "date": "YYYY-MM",
    "status": "Published on YouTube",
    "source": "Production path description",
    "notes": "Production notes",
    "youtube_url": "https://www.youtube.com/shorts/XXXXX",
    "run_folder": "package-runs/YYYY-MM-DD-slug"
  }
]
```

The `youtube_url` and `run_folder` fields link published videos back to their production run. Currently both published videos were produced outside the Episode Factory flow, so `run_folder` is empty.

## Package State Values

Package state transitions tracked in manifest.json:

```
IDEAS_IMPORTED → PACKAGE_SELECTED → SCRIPT_DRAFTED → SCRIPT_REVIEWED
→ PRODUCTION_PLANNED → CAPTURE_COMPLETE → VIDEO_GENERATED
→ READY_FOR_MANUAL_RESOLVE_EDIT → EXPORTED → PUBLISHED
```

## Gate Definitions (Canonical Spec)

| Gate | Name | Owner | Exit criterion |
|------|------|-------|----------------|
| 1 | Topic | Hermes + Mikko | Research pack with sources, Mikko approves topic |
| 2 | Script | Hermes + Mikko | Script passes structure + review checks |
| 3 | Production plan | Hermes + Mikko | Shot list, visual plan, capture checklist ready |
| 4 | Visual generation | Hermes + PRESTO | FLUX images generated, Mikko selects, Wan2.2 videos rendered |
| 5 | Assembly edit | Mikko | Resolve timeline assembled from A-roll + AI backgrounds |
| 6 | Export + publish | Mikko | Export checklist passed, metadata ready |
| 7 | Measure | Mikko | YouTube published, metrics captured, newsletter sent |
