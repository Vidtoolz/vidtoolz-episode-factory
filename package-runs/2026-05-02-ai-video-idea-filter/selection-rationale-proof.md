# Selection rationale proof

Run: 2026-05-02-ai-video-idea-filter
Working title: Stop Letting AI Choose Your Video Strategy

## Files inspected

- `notes.md`
- `selected-package.json`
- `package-candidates.json`
- `browser-captures/selected-package.json`
- `production-plan.md`
- `research-evidence.md`
- `proof-capture-plan.md`
- `final-script.md`
- `publish-pack.md`
- `thumbnail-check.md`
- Browser observation log: `browser-captures/browser-export-import-observations.json`

## Selected idea

A practical framework for using AI as a research assistant while keeping creator judgment in control.

Evidence:

- `selected-package.json` records this as `package.idea`.
- `browser-captures/selected-package.json` captured the same idea from the live package-engine selection action.
- `research-evidence.md` says the selected package records the local package decision and that local evidence supports the package premise and planned workflow only.

## Selected title

- Original selected title: Stop Letting AI Choose Your Video Strategy
- Repaired draft title: Avoid Bad AI Video Ideas Before You Script

Evidence:

- `browser-captures/selected-package.json` records the original selected title.
- `selected-package.json` now records the repaired draft title and preserves the original scored title in `package.originalScoredTitle`.
- The live package engine selection proof records the UI state: `Selected #1: Stop Letting AI Choose Your Video Strategy`.
- `production-plan.md` now lists the repaired draft package title.

Repair update:

- `publish-pack.md` records draft repaired metadata and explicitly says publication is not approved.
- Therefore the repaired package title is reviewable as draft package repair, but not final publish metadata approval.

## Thumbnail direction

Selected-package thumbnail direction:

- Thumbnail concept: Creator at desk rejecting a chaotic AI suggestion cloud and choosing one clear package card.
- Original on-thumbnail text: AI IS NOT THE BOSS.
- Repaired draft on-thumbnail text: AVOID BAD AI IDEAS.

Evidence:

- `browser-captures/selected-package.json` records the original thumbnail concept and on-thumbnail text.
- `selected-package.json` now records the repaired draft on-thumbnail text and preserves the original text in `package.originalOnThumbnailText`.
- `browser-captures/selected-package.json` captured the same fields from the live package-engine selection action.
- The package-engine UI displayed thumbnail candidate controls with pending image states; no final thumbnail image file was accepted as production proof in this session.

Repair update:

- `thumbnail-check.md` records the draft visual promise and explicitly blocks final thumbnail approval.
- `publish-pack.md` records the same draft thumbnail promise and keeps publication blocked.

## Rationale evidenced

`selected-package.json` provides the following rationale fields:

- Score: 94
- Recommendation: Make
- Viewer promise: Learn how to use AI for faster video ideation without outsourcing taste, positioning, or final judgment.
- Target viewer: Serious solo creator experimenting with AI tools but worried about generic content.
- Main risk: Could become abstract unless grounded in a real example workflow.
- Why this matters now: Creators are rapidly adopting AI ideation tools and need a sane way to use them without flattening their voice.
- Why this stays relevant: The principle of separating research speed from editorial judgment remains useful across tool cycles.
- Why this fits VIDTOOLZ: It matches VIDTOOLZ as practical video creation in the AI era with critical tester instincts.
- Why VIDTOOLZ can make it better: VIDTOOLZ can show the real workflow, the veto points, and the tradeoffs instead of selling AI hype.
- Audience demand rationale: Solo creators are searching for AI workflows but still need confidence that the output will not feel generic.
- Suggested production approach: Use a screen-recorded comparison of raw AI suggestions, a structured package scorecard, and a final human-selected package.

## Rationale support level

Supported by captured workflow evidence:

- The browser proof confirms the package engine loaded the May 2 run, displayed candidates, allowed selecting winner #1, and displayed the selected title in UI.
- The browser proof confirms the UI did not turn that selection into durable approval and returned to `No winner selected` after reload.

Supported only by prepared draft/package text:

- Score 94 and `Make` recommendation are recorded in `selected-package.json`, the restored run-local `package-candidates.json`, and the repo-root `package-candidates.json`, but this session did not verify the full scoring calculation from candidate pool to selected winner.
- Audience demand rationale is not supported by external evidence in this run.
- Research evidence explicitly says local evidence supports only the package premise and planned workflow, not external truth claims about creator behavior or AI tools.
- The suggested production approach requires a screen-recorded comparison of raw AI suggestions, scorecard/selection criteria, selected package, and rejected generic suggestion. That production proof was not captured as a screen recording in this session.

## Scoring provenance check

Search command run:

```sh
grep -RIn "score.*94\|recommendation.*Make\|Stop Letting AI Choose Your Video Strategy\|AI IS NOT THE BOSS" \
  package-runs/2026-05-02-ai-video-idea-filter package-candidates.json . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  | sed -n '1,240p'
```

Findings:

- The run-local `selected-package.json` records score `94`, recommendation `Make`, title `Stop Letting AI Choose Your Video Strategy`, and thumbnail text `AI IS NOT THE BOSS`.
- The browser-captured `browser-captures/selected-package.json` records the same selected package fields.
- The repo-root `package-candidates.json` also contains populated candidates and records `pkg-001` with score `94`, recommendation `Make`, title `Stop Letting AI Choose Your Video Strategy`, and thumbnail text `AI IS NOT THE BOSS`.
- The run-local `package-candidates.json` was restored from the populated root candidate file during repair.
- No additional scoring calculation log or scorecard provenance file was found in the searched paths. `generation-prompt.md` defines the candidate schema and allowed recommendation values, but does not prove how score `94` was calculated.

Interpretation:

- The selected package can be traced to the populated repo-root `package-candidates.json`, the restored run-local `package-candidates.json`, and `selected-package.json`, so the score/recommendation are not isolated to the selected artifact only.
- The full scoring path from generated candidate pool to selected winner is still only partially proven because no calculation log or repeatable scorecard output was found.
- This is sufficient to identify the selected package for review, but not strong enough to treat the score `94` or recommendation `Make` as independently verified production-readiness evidence.

## Unsupported or conflicting claims

- The previous run-local blank candidate template has been replaced with the populated candidate set from repo-root. This resolves the run-local/root artifact conflict but does not prove the scoring calculation.
- No score calculation log was found for the `94` score.
- `final-script.md` is repaired as a draft script and passes Creator QA, but it is not production approval.
- `publish-pack.md` and `thumbnail-check.md` are repaired as draft artifacts and explicitly block final publishing/thumbnail approval.
- `production-plan.md` says `NOT READY TO SHOOT`; the evidence chain must defer to the stricter evidence/QA/dashboard gates before any ready-to-shoot claim.

## Production planning strength

Partial. The selected package is coherent and evidenced as a draft/local package decision. It is strong enough for further repair and Mikko review of the package direction, but not strong enough to mark production approved or ready-to-shoot because the scoring/candidate provenance, production proof capture, final script, and publish metadata contain gaps or conflicts.

## Conclusion

Partial pass. The selected idea, title, and thumbnail direction are identifiable and file-backed, but the rationale is only partly supported by actual captured workflow evidence and remains blocked for production readiness.
