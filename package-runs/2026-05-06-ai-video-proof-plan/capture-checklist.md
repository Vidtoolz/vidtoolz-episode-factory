# Capture Checklist

- Run: 2026-05-06-ai-video-proof-plan
- Tool: package-run-capture-checklist.js
- Consistency repair: aligned with approved capture evidence review after Mikko capture-evidence approval.
- Shoot-readiness status: READY TO SHOOT
- Capture checklist status: READY FOR ROUGH CUT
- Ready for rough cut: yes
- External APIs called: no

## Input Warnings

- None. Required local capture-stage files are present: `takes-log.md`, `missing-shot-tracker.md`, `screen-recording-checklist.md`, `audio-capture-checklist.md`, and `capture-evidence-review.md`.

## Capture Boundary

- This checklist records capture-stage readiness only.
- `READY FOR ROUGH CUT` means the capture evidence gate is accepted and the package run may move to rough-cut assembly/review.
- This is not production approval.
- This is not rough-cut approval.
- This is not publish/upload/archive approval.
- This is not Hermes brain approval.
- This is not project-state promotion.
- This checklist does not analyze video or audio content; it relies on the inspected local artifacts and Mikko's explicit capture-evidence approval.

## Capture Evidence Basis

- `capture-evidence-review.md` reports `Review status: PASS`.
- `capture-evidence-review.md` reports `Capture evidence accepted: yes`.
- `missing-shot-tracker.md` contains `Capture evidence approval: PASS` from Mikko manual review.
- `screen-recording-checklist.md` contains accepted redo screen recording evidence: `/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/20260516-capture-session-01/screen-redo/01-main-redo.mp4`.
- Local artifact inspection found active-run media paths referenced by the capture-stage files present on disk.

## Required Shots

| item | source | priority | status |
| --- | --- | --- | --- |
| shot | shot-list.md | high | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Talking-head intro framing the problem: AI-assisted video ideas can look ready before there is proof. | shot-list.md; `aroll/aroll-01-intro-problem.MOV` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Over-shoulder or screen view of the proof-plan checklist with viewer promise, proof/demo moment, evidence source, production path, and packaging fit. | shot-list.md; `2026-05-16 19-59-50.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Controlled/reproduced ChatGPT capture shown with an on-screen label. | shot-list.md; `2026-05-16 19-57-58.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Prepared weak example card: `10 AI Tools Every Creator Should Try in 2026`. | shot-list.md; `2026-05-16 20-01-55.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Before/after package revision view comparing weak package framing against the proof-plan repaired version. | shot-list.md; `2026-05-16 20-04-16.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Title/thumbnail fit check showing `Stop Planning AI Videos Until You Have a Proof Plan` and `WHERE'S THE PROOF?`. | shot-list.md; `2026-05-16 20-05-37.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Final viewer takeaway: run the proof-plan check before scripting or shooting an AI-assisted idea. | shot-list.md; `aroll/aroll-04-final-takeaway.MOV` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |

## Required Screen Captures

| item | source | priority | status |
| --- | --- | --- | --- |
| capture | screen-capture-list.md | high | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Local view of `capture-transcript.md` showing the pasted ChatGPT prompt and response text. | screen-capture-list.md; `2026-05-16 19-55-01.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Controlled/reproduced ChatGPT capture with visible label. | screen-capture-list.md; `2026-05-16 19-57-58.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Proof-plan checklist table with the five criteria visible. | screen-capture-list.md; `2026-05-16 19-59-50.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Prepared weak example card and decision table. | screen-capture-list.md; `2026-05-16 20-01-55.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Before/after package revision comparison. | screen-capture-list.md; `2026-05-16 20-04-16.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Title/thumbnail fit check screen. | screen-capture-list.md; `2026-05-16 20-05-37.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Accepted redo screen recording evidence. | screen-recording-checklist.md; `/home/vidtoolz/Videos/vidtoolz-captures/2026-05-06-ai-video-proof-plan/20260516-capture-session-01/screen-redo/01-main-redo.mp4` | high | Mikko manually accepted as usable screen-recording evidence; included in accepted capture evidence; downstream approvals still separate |

## Required Demos

| item | source | priority | status |
| --- | --- | --- | --- |
| demo | demo-list.md | high | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Proof-plan checklist walkthrough. | demo-list.md; `2026-05-16 19-59-50.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Controlled/reproduced ChatGPT output inspection. | demo-list.md; `2026-05-16 19-57-58.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Prepared weak example stress test. | demo-list.md; `2026-05-16 20-01-55.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Before/after package revision. | demo-list.md; `2026-05-16 20-04-16.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |
| Title/thumbnail fit check. | demo-list.md; `2026-05-16 20-05-37.mp4` | medium | capture evidence accepted for narrow capture-evidence stage; downstream approvals still separate |

## Audio Capture

- Use `audio-capture-checklist.md` as the explicit audio evidence source.
- Active-run audio references exist in `audio-capture-checklist.md`.
- Capture evidence review reports audio/A-roll/voiceover captures identified: yes.
- Audio capture evidence is accepted only within the narrow capture-evidence stage; final voiceover, edit, publish, upload, and archive approvals remain separate.

## Capture Blockers

- None at the capture-evidence gate after Mikko capture-evidence approval.
- Downstream gates still apply.

## Rough-Cut Assembly Gate

- Status: READY FOR ROUGH CUT
- Reason: capture evidence review is PASS, capture evidence is accepted, concrete active-run capture evidence is logged, and Mikko explicitly approved the capture-evidence stage.
- Next action: begin rough-cut assembly/review from the approved captured material.
- Boundary: this is permission to start rough-cut work, not approval of any rough cut or downstream publishing action.
