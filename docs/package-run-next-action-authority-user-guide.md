# Package-Run Next Action Authority User Guide

Episode Factory is the local-first VIDTOOLZ production system for package runs, scripts, planning artifacts, evidence gates, and dashboard tooling.

Current audited state: Episode Factory exists and is healthy. The active package run is `package-runs/2026-05-06-ai-video-proof-plan`, and it is blocked at capture evidence. Capture approval, rough-cut readiness, publishing, upload, archive, final title, and final thumbnail state are not approved by this guide.

Mikko approves durable state changes. Treat generated readiness text as planning status unless a manual approval marker explicitly exists.

## Main UI Paths

- Package engine and local dashboard entry points live in the Episode Factory repo.
- Package-run dashboard tooling reads local package-run artifacts.
- Cockpit routing should use the Next Action Authority rather than guessing from isolated files.

## Read-Only Commands

```bash
node scripts/package-run-doctor.js package-runs/2026-05-06-ai-video-proof-plan --json
node scripts/package-run-next-action-authority.js package-runs/2026-05-06-ai-video-proof-plan --json
```

These commands inspect local state. They should not approve, promote, move, publish, or modify package-run artifacts.

## Verification

```bash
./scripts/verify.sh
```

## Gate Meanings

- Creator QA: checks package quality before downstream production work.
- Research sufficiency: verifies research support and local evidence boundaries before script-stage trust.
- Production planning: creates planning artifacts, but generated `READY TO SHOOT` wording is not manual production approval.
- Shot/edit plan review: reviews shot and edit planning before capture checklist work.
- Capture checklist: prepares capture logging and checklist artifacts; it is not capture approval.
- Capture evidence review: requires real captured media evidence before rough-cut work can proceed.
- Rough cut: blocked until capture evidence review passes.
- Final review: blocked until rough-cut review is legitimately ready.
- Publishing/export/archive: blocked until final approval gates pass.

## Mutating Commands

Production, capture, review, approval, export, archive, and artifact-generation scripts can write durable files. Run them only when Mikko has approved that specific durable state change or draft artifact generation.

## What Not To Do

- Do not create fake readiness.
- Do not treat checklists as evidence.
- Do not approve capture without real captured media.
- Do not start rough-cut work until capture evidence review passes.
- Do not treat VLM/media analysis as accepted proof.
- Do not move media or update external state from Episode Factory routing.
