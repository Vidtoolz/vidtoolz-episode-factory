# May 2 evidence chain summary

Run: 2026-05-02-ai-video-idea-filter
Working title: Avoid Bad AI Video Ideas Before You Script

## 1. Current state

- Evidence accepted: no
- Creator QA: pass
- Creator QA score: 35/35
- Dashboard bucket/status: Needs production planning / BLOCKED
- Current inferred stage: Needs production planning
- Ready to shoot: no
- Production approved: no

The May 2 run remains blocked. The package has been repaired enough to pass Creator QA, but capture evidence is not accepted, score `94` remains unverified, and production readiness is still blocked by the repo doctor.

## 2. Browser/manual workflow proof

Proof file: `browser-workflow-proof.md`

Conclusion: partial pass.

What was proven:

- Local server was started with `./scripts/serve-local.sh`.
- Package engine URL opened: `http://127.0.0.1:8010/package-engine.html?run=2026-05-02-ai-video-idea-filter`.
- Main app URL opened: `http://127.0.0.1:8010/index.html`.
- Package engine loaded 10 candidates.
- Workflow controls were visible, including `Select winner`, selected JSON/Markdown export controls, thumbnail controls, and generation controls.
- Selecting winner #1 changed UI state to `Selected #1: Stop Letting AI Choose Your Video Strategy`.
- Screenshots and browser observation JSON were captured under `browser-captures/`.

Limitations:

- Built-in browser navigation failed, so proof was captured through a headless Chrome CDP helper.
- No screen recording was captured.
- The browser selection did not persist after reload; the UI returned to `No winner selected`.
- This proof did not create approval or ready-to-shoot state.

## 3. Export/import proof

Proof file: `export-import-proof.md`

Conclusion: partial pass.

What was proven:

- The main app `Export JSON` control was visible.
- Export produced usable JSON captured as `browser-captures/vidtoolz-episode-factory-captured-export.json`.
- Import preview opened when the captured export was fed back into the app.
- Merge/update mode was visible and selectable.
- Import was canceled intentionally to avoid changing local episode data.
- Reload confirmed the import preview was closed and controls remained visible.

Limitations:

- The import was not confirmed.
- The export/import flow did not approve the May 2 package run.
- The flow did not move evidence acceptance, Creator QA, or dashboard readiness.

## 4. Selection rationale proof

Proof file: `selection-rationale-proof.md`

Conclusion: partial pass.

Selected idea:

- A practical framework for using AI as a research assistant while keeping creator judgment in control.

Selected/repaired title:

- Original selected title: Stop Letting AI Choose Your Video Strategy
- Repaired draft title: Avoid Bad AI Video Ideas Before You Script

Thumbnail direction:

- Creator at desk rejecting a chaotic AI suggestion cloud and choosing one clear package card.
- Original on-thumbnail text: AI IS NOT THE BOSS.
- Repaired draft on-thumbnail text: AVOID BAD AI IDEAS.

What was proven:

- `selected-package.json` and `browser-captures/selected-package.json` identify the original selected package as `pkg-001` with score `94` and recommendation `Make`.
- Browser proof showed winner #1 selected in the live UI.
- Repo-root `package-candidates.json` contains the populated scored candidate set and matches `pkg-001`.
- Run-local `package-candidates.json` has been restored from the populated repo-root candidate set.
- `scoring-provenance-review.md` records that score `94` is unverified because no scoring calculation log or repeatable scorecard output was found.

Limitations/conflicts:

- No scoring calculation log was found for the `94` score.
- Repaired title, thumbnail text, and viewer promise are editorial repairs, not proof that the original score should remain `94`.
- `final-script.md` is a repaired draft, not production approval.
- `publish-pack.md` and `thumbnail-check.md` are draft repair artifacts, not final publish/thumbnail approval.
- `production-plan.md` now says `NOT READY TO SHOOT`.

## 5. Capture review proof

Proof file: `capture-review-proof.md`

Conclusion: fail for capture acceptance; partial for reviewability.

Command run:

```sh
node scripts/package-run-capture-evidence-review.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
```

Result:

- Review status: READY FOR HUMAN APPROVAL
- Capture evidence accepted: no
- Parser-detected capture references: yes
- Human-accepted production capture evidence: no
- Screen recording references identified by parser: yes
- Audio/A-roll/voiceover references identified by parser: yes
- Manual approval marker detected: no
- Stale approval marker detected: no
- Ready for rough-cut work: no

Blocker:

- Exact capture-stage approval marker is missing.
- `capture-stage-marker-analysis.md` documents the expected marker, expected location, current absence, and evidence needed before adding it.
- Parser-detected references in checklist files are not the same as human-accepted production capture evidence.

## 6. Creator QA rerun proof

Proof file: `creator-qa-rerun-proof.md`

Conclusion: pass after repair.

Requested command attempted:

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
```

The script rejected this replacement attempt and instructed use of `--force`.

Actual repo-supported replacement command run:

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --force
```

Result after 2026-05-14 repair:

- Overall result: PASS
- Score: 35/35
- Profile: ai_video_breakdown

Failed checks:

- None.

## 7. Dashboard truthfulness proof

Proof file: `dashboard-truthfulness-proof.md`

Conclusion: pass.

Commands run:

```sh
node scripts/package-runs-index.js
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter
./scripts/verify.sh
```

Results:

- `package-runs-index.js`: pass; wrote `package-runs-index.json`; indexed 3 package runs.
- `package-run-doctor.js`: pass as a diagnostic; run remains blocked.
- `verify.sh`: pass; 418/418 tests passed.

Current dashboard/index/doctor state:

- Workflow bucket: Needs production planning
- Current inferred stage: Needs production planning
- Overall status: BLOCKED
- Creator QA status: PASS
- Evidence gate status: not evaluated
- First blocker: Shoot-readiness status is NOT READY TO SHOOT, not READY TO SHOOT.

Effective readiness:

- captureApproved: false
- readyForRoughCut: false
- publishReady: false
- readyToUpload: false
- readyToSchedule: false
- readyToArchive: false
- readyToCutShorts: false
- downstreamReadinessOverridden: true

The dashboard/index/doctor chain truthfully overrides stale raw readiness markers and does not falsely mark the run ready.

## 8. Remaining blockers

- Shoot-readiness status is NOT READY TO SHOOT.
- Exact capture-stage approval marker is missing.
- Capture evidence accepted: no.
- Evidence gate status: not evaluated.
- No score calculation log was found for the selected package score `94`.
- Final script is a repaired draft, not production approval.
- Publish, upload, schedule, archive, rough-cut, and final-review artifacts remain blocked/draft.
- Mikko production approval has not been given.

## 9. Files created or modified

Run proof files created or updated:

- `package-runs/2026-05-02-ai-video-idea-filter/browser-workflow-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/export-import-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/selection-rationale-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/capture-review-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/creator-qa-rerun-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/dashboard-truthfulness-proof.md`
- `package-runs/2026-05-02-ai-video-idea-filter/evidence-chain-summary.md`
- `package-runs/2026-05-02-ai-video-idea-filter/scoring-provenance-review.md`
- `package-runs/2026-05-02-ai-video-idea-filter/capture-stage-marker-analysis.md`

Tracked file modified according to final `git status`:

- `package-runs/2026-05-02-ai-video-idea-filter/notes.md`

Repo-generated/updated artifacts present as untracked according to final `git status` include the May 2 run artifacts listed by the package-run doctor, including capture, QA, planning, archive, publish, repurposing, and proof files. These were not committed.

Repo-generated/updated artifacts from this evidence-chain pass:

- `package-runs/2026-05-02-ai-video-idea-filter/capture-evidence-review.md`
- `package-runs/2026-05-02-ai-video-idea-filter/creator-qa-report.md`
- `package-runs/2026-05-02-ai-video-idea-filter/creator-qa-report.json`
- `package-runs-index.json` was rebuilt by `node scripts/package-runs-index.js`, but it does not appear as modified in final `git status`.

Browser proof artifacts captured:

- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/browser-export-import-observations.json`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/package-engine-initial.png`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/package-engine-selected.png`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-export-import-initial.png`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-import-preview.png`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/episode-factory-import-merge-update-mode.png`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/vidtoolz-episode-factory-captured-export.json`
- `package-runs/2026-05-02-ai-video-idea-filter/browser-captures/selected-package.json`

Temporary helper scripts left in place because deletion was not permitted:

- `tmp-may2-browser-export-import.js`
- `tmp-may2-cdp-check.js`

## 10. Commands run

Initial inspection:

```sh
git status --short --branch
find package-runs/2026-05-02-ai-video-idea-filter -maxdepth 1 -type f -print | sort
sed -n '1,220p' package-runs/2026-05-02-ai-video-idea-filter/notes.md || true
sed -n '1,220p' package-runs/2026-05-02-ai-video-idea-filter/capture-evidence-review.md || true
sed -n '1,220p' package-runs/2026-05-02-ai-video-idea-filter/creator-qa.md || true
```

Server/browser proof:

```sh
./scripts/serve-local.sh
curl -sS http://127.0.0.1:8010/api/package-engine/status
curl -sS http://127.0.0.1:8010/package-engine.html
google-chrome --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/vidtoolz-may2-chrome-9333 --disable-gpu --no-first-run --no-default-browser-check about:blank
CDP_PORT=9333 node tmp-may2-browser-export-import.js
```

Selection provenance:

```sh
grep -RIn "score.*94\|recommendation.*Make\|Stop Letting AI Choose Your Video Strategy\|AI IS NOT THE BOSS" \
  package-runs/2026-05-02-ai-video-idea-filter package-candidates.json . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  | sed -n '1,240p'
```

Capture review:

```sh
node scripts/package-run-capture-evidence-review.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
```

Creator QA:

```sh
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --overwrite
node scripts/package-run-creator-qa.js package-runs/2026-05-02-ai-video-idea-filter --force
```

Dashboard truthfulness:

```sh
node scripts/package-runs-index.js
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter
./scripts/verify.sh
```

Final verification commands are recorded after this summary was written.

## 11. Final recommendation

Recommendation: ready for Mikko review of the repaired draft package; keep blocked for production.

Why:

- The package now passes Creator QA, but the repo checks do not support production readiness.
- Capture evidence is not accepted.
- The dashboard truthfully reports `Needs production planning` and `BLOCKED`.
- Score `94` remains unverified and must not be used as readiness proof.
- Production approval remains Mikko-only and was not performed.
