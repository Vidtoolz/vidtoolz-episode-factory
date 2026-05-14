# Capture-Stage Marker Analysis

- Run: 2026-05-02-ai-video-idea-filter
- Review date: 2026-05-14
- Status: marker analysis only; no approval added

## Parser-Accepted Marker Strings

This section documents the strings the parser recognizes. It is not a capture approval and must not be copied into capture evidence until human review accepts real production capture evidence.

The capture evidence review script accepts one of these exact lines:

- `Capture approval: PASS`
- `Capture evidence approval: PASS`
- `Rough-cut assembly approval: PASS`

## Expected Location

The marker must appear after concrete take, screen-recording, and audio evidence rows in the combined capture-stage artifacts inspected by `scripts/package-run-capture-evidence-review.js`:

- `capture-checklist.md`
- `takes-log.md`
- `screen-recording-checklist.md`
- `audio-capture-checklist.md`
- `missing-shot-tracker.md`

## Why It Is Currently Missing

The current capture artifacts do not contain a parser-accepted approval marker after the concrete evidence rows the review script evaluates. They include capture-related references that the parser can detect, but parser-detected references are not human-accepted production capture evidence. Any smoke-test, dummy, or fixture-style media references are not enough to justify production capture acceptance unless source, license, checksum, and use in the May 2 workflow are documented and human-reviewed.

## Evidence Needed Before Adding It

Add an exact capture approval marker only after human review confirms real production capture evidence for:

- the A-roll or voiceover take used for this package
- the screen-recorded AI idea-filter comparison
- the concrete scorecard or selection criteria shown on screen
- the selected package and at least one rejected generic suggestion
- any missing shots marked closed with real file references

Until that evidence exists and is reviewed, capture evidence accepted must remain `no`.
