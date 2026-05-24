# Resolve spine-cut marker map — draft only

## 1. Status

- Spine test result: works.
- A-roll role: main A-roll / bottom-right PiP / primary narration.
- Screen recording role: base visual layer.
- Screen-recording audio: muted by default except where specifically useful.
- Gate boundary: not production-ready, not publish-ready, not rough-cut ready, not second-cut ready, not final-ready, not approved.
- Source confidence: A-roll file facts, timeline test result, PiP placement, audio choice, and spine usability come from Mikko's explicit review notes. Active-run status, next-safe-action, rough-cut pickup state, evidence boundaries, and missing visual-support notes come from inspected local artifacts. Section placement below uses script structure and editorial suggestion only; exact Resolve timestamps are unknown and need a timeline check.

## 2. Current edit objective

Build a playable spine cut from the usable A-roll narration and screen recording. Preserve the A-roll audio as the spine, keep the screen recording as the main visual base, and use the bottom-right PiP for human presence. Do not polish yet. Add Resolve markers where the viewer needs proof support, screen focus, callouts, labels, diagrams, or pacing relief. Make missing visual/proof support visible before creating more B-roll. Identify the smallest insert package first, then decide whether any AI/Kling illustration is still needed.

## 3. Marker map

| Marker ID | Approx section / timestamp | Narration or topic cue | Current viewer risk | Needed insert type | Candidate source | Proof status | Resolve note | Mikko decision needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M01 | Hook / exact timestamp unknown / needs Resolve timeline check | "What will this video prove on screen?" | Opening may stay visually plain if only screen capture plus PiP carries the claim. | title/card/label | Script hook; screen spine | demonstration | Add a simple on-screen label: "Proof plan before script". Keep PiP visible. | Decide whether the hook label feels useful or too obvious. |
| M02 | Setup / exact timestamp unknown / needs Resolve timeline check | ChatGPT transcript boundary and prepared weak example warning | Viewer may misunderstand the prepared weak example as real ChatGPT output. | screen zoom/callout | `capture-transcript.md`; `screen-recording-checklist.md`; final script verification notes | real proof | Use zoom/callout on the transcript/evidence-boundary text. Do not use AI visuals here. | Confirm the label wording is strong enough: prepared/stress-test, not captured ChatGPT output. |
| M03 | Setup weak example / exact timestamp unknown / needs Resolve timeline check | `10 AI Tools Every Creator Should Try in 2026` | The weak example may look like fake tool output or actual AI evidence. | title/card/label | Prepared weak example in final script/final outline | do not imply | Show it as a prepared stress-test card, not a ChatGPT UI screenshot. | Decide whether the card needs a visible "prepared example" label. |
| M04 | Promise / exact timestamp unknown / needs Resolve timeline check | "A proof plan is the visible example, demo, comparison, or result..." | Concept may sound abstract if the screen does not show the check. | diagram | Proof-plan checklist demo; `proof-capture-plan.md` | demonstration | Use a simple five-part proof-plan diagram or table. Prefer local screenshot/table over generated B-roll. | Decide whether the checklist is readable enough as captured or needs a cleaner graphic. |
| M05 | Part 1 / exact timestamp unknown / needs Resolve timeline check | Why AI ideas can look more finished than they are | Screen recording alone may feel stale while explaining a conceptual risk. | human-presence reset | A-roll PiP already tested acceptable | demonstration | Briefly enlarge or hold PiP, or cut to a short face-forward beat if available. No extra proof implied. | Decide whether the existing PiP is enough or a short human reset is needed. |
| M06 | Part 1 evidence contrast / exact timestamp unknown / needs Resolve timeline check | ChatGPT gave practical workflow ideas, not the generic listicle | Viewer needs to see the evidence boundary, not just hear it. | proof visual | `capture-transcript.md`; captured/review-needed transcript screen recording | real proof | Add a callout around the actual transcript language. Keep any reproduced capture labeled. | Decide whether the transcript view is legible enough for the claim. |
| M07 | Part 2 proof-plan check / exact timestamp unknown / needs Resolve timeline check | Viewer promise / proof moment / visual evidence / production path / packaging fit | List of criteria may become dense narration over screen. | screen zoom/callout | Proof-plan checklist table; final script Part 2 | demonstration | Put one marker per criterion only if pacing needs it; otherwise use one table zoom with sequential callouts. | Decide whether all five criteria need separate beats or one compact table. |
| M08 | Part 2 production path / exact timestamp unknown / needs Resolve timeline check | Reproduced ChatGPT capture plus decision table does not approve shooting/editing | Boundary could be missed and accidentally imply readiness. | title/card/label | `resolve-edit-checklist.md`; `screen-recording-checklist.md` | do not imply | Add a small label: "planning evidence / not approval". Avoid PASS or readiness language. | Confirm whether this boundary needs an on-screen label or narration is enough. |
| M09 | Part 3 repair weak idea / exact timestamp unknown / needs Resolve timeline check | Weak idea becomes stronger package | Before/after may be hard to follow without a comparison visual. | proof visual | `before-after-package-revision.md`; final outline before/after structure | demonstration | Use split-screen or table: weak package -> proof-plan package. | Decide whether this comparison is the core proof visual for the second cut. |
| M10 | Part 3 visual plan / exact timestamp unknown / needs Resolve timeline check | Decision table, keep/reject result, production approach | Viewer may need a concrete workflow image, but AI footage could imply fake results. | diagram | Proof-plan table; local planning docs | demonstration | Use a simple diagram/table before considering Kling. Do not show fake UI behavior. | Decide if a diagram is enough or if one illustration-only clip would help pacing. |
| M11 | Part 4 creator judgment / exact timestamp unknown / needs Resolve timeline check | AI suggests; creator decides proof, usefulness, and worth producing | Conceptual section may benefit from atmosphere, but generated visuals could overclaim. | Kling/AI illustration clip | Selected prompt-03 stills / Kling candidates only after Mikko creates and tests clips | illustration-only | If used, place as brief atmosphere only, away from proof claims. No UI, results, or product capability implication. | Decide whether AI/Kling fits the trust standard here or should be skipped. |
| M12 | Recap / exact timestamp unknown / needs Resolve timeline check | Topic/title/outline is not enough; it needs a proof plan | Recap may repeat prior screen visuals. | no insert needed | Existing screen spine plus PiP | demonstration | Let narration carry this if pacing is acceptable. Consider only a subtle zoom back to the checklist. | Decide during watchdown whether the recap feels stale. |
| M13 | CTA / exact timestamp unknown / needs Resolve timeline check | "Before you script your next AI-assisted video idea..." | Ending needs a clean action, not more B-roll. | title/card/label | Final script CTA | demonstration | Add one simple CTA card: "Write the proof moment before the script." | Decide final CTA wording later; this is not title/thumbnail approval. |

## 4. Minimum viable insert package

| Insert ID | Why it matters | Can this be handled by editing only? | Does Mikko need to choose, record, create, or approve something? | Risk if skipped | Recommended first action |
| --- | --- | --- | --- | --- | --- |
| I01 | Prevents the prepared weak example from being mistaken for captured ChatGPT output. | Yes, if the existing screen recording/text is legible. | Mikko needs to approve the boundary wording for the label. | High overclaim risk. | Place M02 and M03 labels first. |
| I02 | Makes the proof-plan method visible instead of only narrated. | Yes, with a screen zoom/callout or simple table graphic. | Mikko needs to choose whether to use captured table or cleaner diagram. | The video may feel like abstract advice. | Place M04 and M07 around the checklist/table. |
| I03 | Shows the before/after repair that proves the practical workflow. | Yes, if the existing comparison artifact is usable on screen. | Mikko needs to decide whether the before/after table is the core proof visual. | Viewer may not see the transformation clearly. | Place M09 as the main proof-support marker. |
| I04 | Reduces screen-only fatigue while keeping the edit trust-first. | Mostly yes, using PiP, screen zooms, and one human-presence reset. | Mikko needs to decide if existing PiP is enough or if a larger A-roll beat is needed. | The edit may remain visually flat. | Place M05 and watch whether it solves the pacing issue. |
| I05 | Adds optional variety without pretending generated media is proof. | No, only after Mikko creates/tests Kling clips manually. | Mikko must choose whether illustration-only AI/Kling is acceptable. | If used badly, it can imply fake proof; if skipped, less visual variety. | Leave M11 as optional until the first four inserts are placed. |

## 5. Missing proof / missing visuals

### Proof visuals needed to support claims

- Real screen recording or screenshot of `capture-transcript.md` showing the actual pasted transcript boundary.
- Real screen recording or screenshot of the proof-plan checklist/table.
- Real before/after package repair visual from local run artifacts.
- Real label or callout showing that the weak `10 AI Tools Every Creator Should Try in 2026` example is prepared/stress-test material.
- Actual Resolve timeline proof only if Mikko records or exports it later; do not imply the current marker map proves edit readiness.

### Pacing visuals needed to reduce screen-only fatigue

- Screen zooms for dense transcript/checklist/table moments.
- Callouts around evidence-boundary phrases.
- Simple labels for "prepared example", "controlled/reproduced evidence", and "planning evidence / not approval".
- Short human-presence reset using the tested bottom-right PiP or a larger A-roll moment if Mikko chooses.
- Timeline markers for proof gaps and visual-staleness checks.

### Optional illustrative visuals

- Kling/AI metaphor shots for creator workflow pressure, only as illustration.
- Abstract creator workflow atmosphere, only away from proof claims.
- Short non-UI visual analogy clips for "polished plan vs real proof", only if narration makes the illustrative role clear.

### Risky visuals to avoid

- Fake ChatGPT UI showing the prepared weak example as if ChatGPT generated it.
- AI visuals implying real screen recordings, real tool behavior, real user results, or real product capabilities.
- Generated "proof" dashboards, charts, metrics, or before/after results not backed by local artifacts.
- Kling clips placed directly over proof claims where the viewer may read them as evidence.
- Any graphic that uses PASS, approved, production-ready, publish-ready, final-ready, or similar readiness language.

## 6. AI/Kling/B-roll policy

- AI/Kling visuals may be used only as illustration or atmosphere unless real evidence supports the claim.
- AI visuals must not imply actual proof, real UI behavior, real user results, real product capabilities, or real production evidence unless verified.
- Prefer real screen recording, screenshots, callouts, and simple diagrams before generated visuals.
- If an AI visual is used, label it editorially as illustrative through context, placement, or narration.
- Do not let beautiful AI visuals replace the proof standard.

## 7. Resolve build instructions for Mikko

1. Duplicate the current spine/test timeline.
2. Keep screen recording as base visual layer.
3. Keep A-roll as bottom-right PiP.
4. Use A-roll audio as primary narration.
5. Mute screen audio by default.
6. Cut for pacing only enough to make the spine watchable.
7. Add markers from this map.
8. Add only the minimum viable insert package first.
9. Use real screenshots/callouts before AI illustration where possible.
10. Export only a candidate review file if Mikko decides to proceed.

Practical Resolve notes:

- Watch for PiP blocking interface details.
- Add screen zooms before adding decorative B-roll.
- Use markers to flag missing proof, not to approve it.
- Keep this as a candidate spine cut, not a final cut.

## 8. Do-not-cross boundaries

- no package-run approval
- no production_ready
- no publish_ready
- no rough-cut ready
- no second-cut ready
- no final-ready
- no proof acceptance
- no media mutation
- no git staging
- no git commit/push
- no dashboard/index/project-state mutation
- no Hermes memory update
- no claim that the edit is ready

## 9. Next 30-minute task

Open the duplicated spine timeline and place markers for the minimum viable insert package first.

- M02: Place this first because the transcript/evidence boundary protects the main trust claim; Mikko needs to decide the exact label wording.
- M03: Place this next because the prepared weak example must not look like captured ChatGPT output; Mikko needs to decide whether the label is visible enough.
- M04: Place this because the proof-plan method needs to be seen, not only described; Mikko needs to decide whether the existing table is readable or needs a cleaner diagram.
- M09: Place this because the before/after repair is the clearest workflow proof; Mikko needs to decide whether it is the central visual insert.
- M05: Place this if the first pass still feels screen-only; Mikko needs to decide whether PiP is enough or a larger human-presence reset is needed.

## 10. Verification report

- active run detected: package-runs/2026-05-06-ai-video-proof-plan
- exact files read: package-runs-index.json; package-runs/2026-05-06-ai-video-proof-plan/package-run-state.md; package-runs/2026-05-06-ai-video-proof-plan/rough-cut-watch-notes.md; package-runs/2026-05-06-ai-video-proof-plan/rough-cut-review.md; package-runs/2026-05-06-ai-video-proof-plan/pickup-list.md; package-runs/2026-05-06-ai-video-proof-plan/edit-fix-list.md; package-runs/2026-05-06-ai-video-proof-plan/smallest-trustworthy-publishable-version.md; package-runs/2026-05-06-ai-video-proof-plan/final-outline.md; package-runs/2026-05-06-ai-video-proof-plan/final-script.md; package-runs/2026-05-06-ai-video-proof-plan/proof-capture-plan.md; package-runs/2026-05-06-ai-video-proof-plan/screen-recording-checklist.md; package-runs/2026-05-06-ai-video-proof-plan/resolve-edit-checklist.md; reports/prompt-03-kling-video-candidate-handoff.md
- exact file written, if any: package-runs/2026-05-06-ai-video-proof-plan/resolve-spine-cut-marker-map.md
- whether active run was unambiguous: yes
- whether existing output file was present: no
- whether any package-run state files were changed: no
- whether any media files were changed: no
- whether any git staging/commit/push happened: no
- whether package-runs-index.json was changed: no
- whether dashboard/project-state/memory was changed: no
