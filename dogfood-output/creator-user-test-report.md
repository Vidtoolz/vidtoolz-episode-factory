# VIDTOOLZ Creator-User Dogfood Report

## 1. Executive summary

- Overall status: PARTIAL
- Biggest user-facing problem: The dashboard has a useful Focus Mode, but Full Dashboard presents multiple competing "current" frames at once: `Capture / b-roll candidate creation`, `Needs rough-cut review`, `Pickup / Edit-Fix Planning`, and `Rough-Cut Review`. Mikko can find an action, but he has to reconcile too many status systems.
- Biggest safety-boundary problem: Several browser panels include write-capable buttons and human approval markers in the same operational cockpit. The labels are mostly careful, but a real user can still land beside controls such as `PASS`, `Save watch notes`, `Save final-watch notes`, `Save delivery checks`, and `Apply to run files` while still trying to understand what is safe.
- Biggest friction point: The route from "what am I doing now?" to "what exactly do I do for 30 minutes?" is split between Focus Mode, Next Safe Action, Evidence Intake, Operator Cockpit, Production GPS, Lifecycle Review, and Historical run cards.
- Best next fix: Make one canonical creator-facing "Now / Next / Proof / Blocked / AI may / Mikko must" panel authoritative, then demote the other panels to evidence drill-downs that explicitly defer to that panel.

## 2. Tested surfaces

- `README.md`: Read local run instructions, dashboard workflow, Package Engine workflow, and documented safety claims.
- `AGENTS.md`: Read repo safety rules, evidence boundaries, and required verification command.
- `docs/smoke-test.md`: Read browser smoke expectations and optional headless browser note.
- `docs/package-runs-dashboard-workflow.md`: Read dashboard lifecycle, capture-evidence, and local write-flow documentation.
- `docs/package-engine-run-workflow.md`: Read Package Engine run expectations and selection export behavior.
- `index.html` / Episode Factory UI: Opened at `http://127.0.0.1:8010/` through the documented `./scripts/serve-local.sh` server. Static browser inspection only; no buttons clicked that mutate data.
- `package-runs-dashboard.html`: Opened at `http://127.0.0.1:8010/package-runs-dashboard.html`. Inspected Focus Mode, Full Dashboard, Active package run, Beginning Triage, Evidence Intake, Mikko Input Console, Production GPS, Final/Delivery gate controls, and Historical run cards. Did not preview/apply/save any run-file write.
- `package-engine.html`: Opened at `http://127.0.0.1:8010/package-engine.html` and `http://127.0.0.1:8010/package-engine.html?run=2026-05-06-ai-video-proof-plan`. Inspected candidate review, winner selection/export surface, and thumbnail-generation controls. Did not select, export, download, or generate thumbnails.
- `scripts/package-run-doctor.js`: Ran read-only doctor checks for `package-runs/2026-05-02-ai-video-idea-filter` and `package-runs/2026-05-06-ai-video-proof-plan`.
- `scripts/package-run-next-safe-action.js`: Ran read-only next-safe-action helper.
- `scripts/package-run-active-state-audit.js`: Ran read-only active-state audit.
- `package-runs-index.json`: Inspected existing generated dashboard index without regenerating it.
- `./scripts/verify.sh`: Ran documented verification.

## 3. Findings

### Finding DF-001

- ID: DF-001
- Severity: High
- Category: UX clarity
- Location: `package-runs-dashboard.html`, `package-runs-dashboard.js`, `package-runs-index.json`, `scripts/package-run-next-safe-action.js`, `scripts/package-run-doctor.js`
- What happened: The Focus panel says the current state is `Capture / b-roll candidate creation` and the human next action is to create Kling b-roll candidates, move MP4s to VIDNAS, and test in Resolve. The lifecycle card for the same active run says `Needs rough-cut review`; Production GPS says `Pickup / Edit-Fix Planning`; Historical cards say `Next: rough-cut-watch-notes.md with real notes`.
- Why it matters for Mikko: A creator-operator needs one operational truth. The current UI is defensible technically, but as a user Mikko has to translate between asset creation, rough-cut review, pickup planning, and lifecycle status before acting.
- Suggested fix: Add a canonical "Active Now" panel with one chosen stage label, one 30-minute action, one evidence source, and one blocked-until condition. Other panels should say "diagnostic detail" and link back to the canonical panel.
- Fix type: Expandable AI work, with Mikko accountable for confirming the chosen active action.

### Finding DF-002

- ID: DF-002
- Severity: High
- Category: Safety boundary
- Location: Full Dashboard / `Capture / rough-cut / second-cut` and `Final / export / publishing` panels
- What happened: Full Dashboard exposes many write-capable controls and approval-marker fields while the run is blocked: `Save watch notes`, `Run rough-cut review`, `Save pickup plan`, `Save final-watch notes`, `Regenerate derived final review`, `Save delivery checks`, `PASS`, and delivery `PASS`. The copy says these are human gates and many buttons are guarded, but they still sit in the same cockpit as read-only orientation.
- Why it matters for Mikko: The system doctrine says AI prepares and Mikko approves. Dense approval/write controls increase the chance that Hermes/Codex or a tired operator treats a form field as a next action instead of a human accountability gate.
- Suggested fix: In Focus Mode, hide all downstream write/approval forms by default. In Full Dashboard, add a stage lock banner above each downstream form: "Not current gate; read-only orientation unless Mikko explicitly chooses this gate."
- Fix type: Expandable AI work for UI gating and copy; accountable Mikko work for actual approval choices.

### Finding DF-003

- ID: DF-003
- Severity: Medium
- Category: Proof integrity
- Location: `package-runs-dashboard.html` Evidence Gate and Lifecycle Review for active run
- What happened: The active run card simultaneously reports `Evidence Gate blocker: transcript captured; visual proof missing; narrow shooting approved` and lifecycle capture evidence as `PASS`, `accepted: yes`, `Real capture evidence detected: yes`, and `Ready for rough cut: yes`.
- Why it matters for Mikko: This looks like a boundary conflict between narrow shooting/visual proof and lifecycle capture approval. A user can read the system as both blocked for missing visual proof and cleared for rough-cut work.
- Suggested fix: Show a single reconciliation sentence near the top of the active card: "Capture evidence is accepted for rough-cut review, but generated/visual asset proof is still missing for the current Kling/Resolve pickup work." If that is not true, adjust the model so one blocker wins.
- Fix type: Expandable AI work to surface reconciliation; accountable Mikko work to decide whether the evidence truly supports rough-cut progression.

### Finding DF-004

- ID: DF-004
- Severity: Medium
- Category: User friction
- Location: `package-runs-dashboard.html` Full Dashboard
- What happened: Full Dashboard includes Current Focus, Diagnostics, Active package run, Beginning Triage, Evidence Intake, Mikko Input Console, Operator Cockpit, Production GPS, Second-Cut Inspector, Final Candidate, Delivery Gate, Lifecycle Review, Rough Cut, Pickup Plan, Media, and Historical cards. Many repeat similar facts with different labels.
- Why it matters for Mikko: This is useful as a system console, but heavy as a creator cockpit. It risks burying the creator under infrastructure before publishing.
- Suggested fix: Split the dashboard into `Creator Cockpit` and `Diagnostics`. Creator Cockpit should answer only: now, next 30 minutes, proof, missing, AI may, Mikko must, blocked actions.
- Fix type: Expandable AI work.

### Finding DF-005

- ID: DF-005
- Severity: Medium
- Category: Missing workflow
- Location: `package-engine.html?run=2026-05-06-ai-video-proof-plan`
- What happened: Opening Package Engine with the active run parameter loaded the root sample `package-candidates.json` rather than making the active run context obvious. The active run has `selected-package.md`, not run-local candidates, so the page falls back to generic candidate review.
- Why it matters for Mikko: From a user perspective, `?run=active-run` should either show the run package context or explicitly say "No run-local package candidates found; showing root sample." Without that, it is easy to review the wrong candidate set.
- Suggested fix: Add a visible run-source banner: loaded source file, run id, and whether the data came from the run folder or root sample. If no run-local candidates exist, disable "Select winner" until the user acknowledges the fallback.
- Fix type: Expandable AI work.

### Finding DF-006

- ID: DF-006
- Severity: Medium
- Category: Safety boundary
- Location: `index.html` Episode Factory export panel
- What happened: The Episode Factory detail view includes `Copy Hermes memory update`, `Copy YouTube publish package`, and readiness labels such as `Ready to Publish`. It does not visibly connect those exports to package-run proof gates or Mikko-only approval boundaries.
- Why it matters for Mikko: The static Episode Factory is separate from package-run evidence. Copying a publish or memory payload from an episode record could overclaim if the package-run proof path is not checked.
- Suggested fix: Add a small export-boundary note near memory/publish exports: "Episode exports are planning payloads unless package-run proof and Mikko approval are recorded."
- Fix type: Expandable AI work.

### Finding DF-007

- ID: DF-007
- Severity: Low
- Category: Technical
- Location: Browser console for `package-runs-dashboard.html`
- What happened: The only observed console error was a 404 for `/favicon.ico`.
- Why it matters for Mikko: It does not affect the workflow, but it adds noise to browser smoke checks.
- Suggested fix: Add a favicon or suppress the request with a valid link if desired.
- Fix type: Expandable AI work.

### Finding DF-008

- ID: DF-008
- Severity: Low
- Category: Technical
- Location: Git working tree before audit
- What happened: The repo was already dirty before the audit: modified dashboard/UI/test files and untracked package-run/report files existed.
- Why it matters for Mikko: The audit could not cleanly distinguish pre-existing in-progress work from stable workflow behavior by git state alone.
- Suggested fix: Before future dogfood runs, either start from a clean branch or explicitly snapshot the expected dirty files.
- Fix type: Accountable Mikko work to decide what state should be preserved; expandable AI work can prepare the snapshot.

## 4. User-flow notes

- Can Mikko find the next 30-minute action? Yes, in Focus Mode and `node scripts/package-run-next-safe-action.js`: create Kling b-roll candidates from selected prompt-03 stills, move MP4s to VIDNAS, then test them in DaVinci Resolve. In Full Dashboard this becomes less clear because other panels frame the run as rough-cut review and pickup/edit-fix planning.
- Can Mikko tell what is safe for AI to do? Mostly yes. The best surfaces explicitly say AI may prepare handoffs, inspect files, summarize status, and create read-only reports. Full Dashboard still exposes too many write forms for a read-only AI/operator mental model.
- Can Mikko tell what only he can approve? Mostly yes. The UI repeatedly says PASS is a human marker and blocks approval/publish/state actions. The risk is not missing copy; the risk is density and proximity of approval controls to diagnostic views.
- Can Mikko see proof gaps? Yes. The dashboard clearly flags missing Kling MP4 candidates, missing Resolve test evidence, selected/reviewed/approved/production_ready counts, and downstream publishing/export locks. Some proof-gap language conflicts with lifecycle capture PASS language.
- Can Mikko avoid tool/workflow bloat? Partially. Focus Mode helps, but Full Dashboard currently feels like a system console rather than a creator cockpit.

## 5. Verification notes

Commands run:

```sh
git status --short
sed -n '1,220p' README.md
sed -n '1,220p' AGENTS.md
sed -n '1,220p' docs/smoke-test.md
sed -n '1,220p' docs/package-runs-dashboard-workflow.md
sed -n '1,220p' docs/package-engine-run-workflow.md
rg -n "production_ready|publish_ready|production ready|publish ready|ready|approval|approve|accepted|proof|evidence|Capture Evidence|Apply|Preview|AI|Mikko|next safe|next action|planning|QA|publishable|metadata" ...
node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter
node scripts/package-run-doctor.js package-runs/2026-05-06-ai-video-proof-plan
node scripts/package-run-next-safe-action.js
node scripts/package-run-active-state-audit.js
sed -n '1,220p' package-runs-index.json
./scripts/serve-local.sh
./scripts/verify.sh
git status --short
git diff --stat
```

Browser/UI testing:

- Used the documented local server: `./scripts/serve-local.sh`
- Opened `http://127.0.0.1:8010/`
- Opened `http://127.0.0.1:8010/package-runs-dashboard.html`
- Opened `http://127.0.0.1:8010/package-engine.html`
- Opened `http://127.0.0.1:8010/package-engine.html?run=2026-05-06-ai-video-proof-plan`
- Did not click mutation buttons, did not preview/apply local writes, did not save forms, did not export/download packages, did not generate thumbnails, did not approve anything.

Command results:

- `node scripts/package-run-doctor.js package-runs/2026-05-02-ai-video-idea-filter`: completed read-only. Reported parked/inactive, Creator QA PASS, effective readiness blocked, no publish/upload/archive/project-state actions allowed.
- `node scripts/package-run-doctor.js package-runs/2026-05-06-ai-video-proof-plan`: completed read-only. Reported active run, `Needs rough-cut review`, overall `BLOCKED`, Creator QA not run, next command `node scripts/package-run-rough-cut-review.js package-runs/2026-05-06-ai-video-proof-plan`, upload/publishing/archive blocked.
- `node scripts/package-run-next-safe-action.js`: completed read-only. Reported active state `Capture / b-roll candidate creation`; human next action is manual Kling MP4 creation, VIDNAS move, and Resolve testing; AI must not approve assets or operate Kling/Resolve automatically.
- `node scripts/package-run-active-state-audit.js`: completed read-only. Reported exactly one active run: `package-runs/2026-05-06-ai-video-proof-plan`.
- `./scripts/verify.sh`: passed, `641/641 tests passed`.

Git status before:

```text
 M package-runs-dashboard.html
 M package-runs-dashboard.js
 M styles.css
 M tests/run-tests.js
?? .playwright-mcp/
?? package-runs/2026-05-02-ai-video-idea-filter/capture-board.html
?? package-runs/2026-05-06-ai-video-proof-plan/media-creation-plan.md
?? reports/evidence-intake-ui-project-state.md
?? reports/next-safe-action-dashboard-project-state.md
?? reports/production-timeline-cockpit-project-state.md
?? reports/prompt-03-image-contact-sheet.html
?? reports/prompt-03-kling-video-candidate-handoff.md
```

Git status after, before writing this report:

```text
 M package-runs-dashboard.html
 M package-runs-dashboard.js
 M styles.css
 M tests/run-tests.js
?? .playwright-mcp/
?? package-runs/2026-05-02-ai-video-idea-filter/capture-board.html
?? package-runs/2026-05-06-ai-video-proof-plan/media-creation-plan.md
?? reports/evidence-intake-ui-project-state.md
?? reports/next-safe-action-dashboard-project-state.md
?? reports/production-timeline-cockpit-project-state.md
?? reports/prompt-03-image-contact-sheet.html
?? reports/prompt-03-kling-video-candidate-handoff.md
```

Git status after writing this report:

```text
 M package-runs-dashboard.html
 M package-runs-dashboard.js
 M styles.css
 M tests/run-tests.js
?? .playwright-mcp/
?? dogfood-output/
?? package-runs/2026-05-02-ai-video-idea-filter/capture-board.html
?? package-runs/2026-05-06-ai-video-proof-plan/media-creation-plan.md
?? reports/evidence-intake-ui-project-state.md
?? reports/next-safe-action-dashboard-project-state.md
?? reports/production-timeline-cockpit-project-state.md
?? reports/prompt-03-image-contact-sheet.html
?? reports/prompt-03-kling-video-candidate-handoff.md
```

Files changed by this audit:

- Intended new report file: `dogfood-output/creator-user-test-report.md`
- I did not intentionally modify code, package-run state, approval markers, media, durable memory, git index, or generated package-run index.
- Browser testing used Playwright MCP, which records its own scratch snapshots/logs under an existing `.playwright-mcp` area. No workflow data, package-run approval state, or media was intentionally changed.

## 6. Recommended next 3 fixes

1. Trust/proof protection: Make the canonical `Now / Next / Proof / Missing / AI may / Mikko must / Blocked` panel authoritative and reconcile the active run's `Kling candidate`, `rough-cut review`, `pickup planning`, and `capture evidence PASS` labels into one creator-facing state.
2. Publishing throughput: Hide downstream write and approval forms until their gate is current, or wrap them in explicit "diagnostic only, not current gate" locks. Keep the current 30-minute action visible while drilling into details.
3. Reduction of creator friction: Add visible source banners to Package Engine and dashboard panels showing which file or model is driving the view, especially when `package-engine.html?run=...` falls back to root `package-candidates.json`.
