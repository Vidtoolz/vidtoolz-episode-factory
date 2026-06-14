# Evidence Intake UI Project State

Read-only project-state note. This records the current dashboard implementation state and production boundary; it does not approve capture, edit package-run state, edit manifests, generate media, move media, or mark anything selected, approved, production-ready, or publish-ready.

## Current implementation state

Codex implemented a controlled Evidence Intake UI on the VIDTOOLZ Episode Factory dashboard.

## Purpose

Help Mikko record:

- what media exists,
- where it lives,
- what it proves,
- whether it has been tested in DaVinci Resolve,
- and what remains missing.

## Current active run behavior

- Evidence status: selected stills exist, Kling candidates missing.
- Next evidence action: Mikko manually creates Kling MP4s, moves them to VIDNAS, then records them in the Evidence Intake UI.
- Existing evidence rows detected: 25.
- Save target: `capture-evidence-intake-log.md` only.

## Current intended production loop

1. Mikko manually creates Kling b-roll candidates from the selected prompt-03 still images.
2. Mikko moves the downloaded MP4 files to VIDNAS.
3. Mikko imports the MP4 files into DaVinci Resolve.
4. Mikko tests the clips in the Resolve timeline.
5. Mikko records evidence/results in the Evidence Intake UI.

## Boundary

This is evidence logging only. It is not an approval UI.

The Evidence Intake UI does not and must not automatically:

- mark capture accepted,
- mark anything approved,
- mark anything selected,
- mark anything `production_ready`,
- mark anything `publish_ready`,
- edit package-run state,
- automate Kling,
- automate Resolve,
- generate media,
- move media.

## Status meaning

This note records project state only. It does not mean the Evidence Intake UI is approved for broader durable writes, and it does not mean any media, capture, edit, package run, or publishing stage is approved or production-ready.
