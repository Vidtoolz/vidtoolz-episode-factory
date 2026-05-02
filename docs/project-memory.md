# Project Memory

## 2026-05-01 Playwright MCP Verification And Audit Fix

- Repo: `/home/vidtoolz/vidtoolz-episode-factory`
- GitHub repo: `Vidtoolz/vidtoolz-episode-factory`
- Current branch: `main`
- Current main commit: `c33255d`
- Latest release tag before this fix: `v1.1.0` at `446d244`
- Fix branch: `fix/playwright-audit-issues`, now deleted
- Fix commit: `2c2b5bf`
- Tests: `./scripts/verify.sh` passed 67/67
- Status: clean `main` branch pushed to GitHub

Codex browser use through Playwright MCP was enabled and verified on Vidnux for VIDTOOLZ Episode Factory. Playwright MCP was used to open the local app, inspect layout and accessibility snapshots, click through visible user flows, verify import/export controls, exercise active session controls, check responsive layouts, and confirm console state after reload.

The Playwright audit fix was merged on 2026-05-01. The fix covered:

- Desktop board/detail overflow fixed at 1280x900.
- Active session controls fixed for running and paused states.
- Stale task package feedback fixed after session actions.
- Hidden JSON file input removed from visual and accessibility flow.
- CSS/JS static cache-busting query strings added.

Next recommended work: continue v1.2 using narrow Codex branches and Playwright verification before merge.

## 2026-05-01 v1.2.0 Backup Safety Guardrails Release

- Repo: `/home/vidtoolz/vidtoolz-episode-factory`
- GitHub repo: `Vidtoolz/vidtoolz-episode-factory`
- Current branch: `main`
- Current main commit: `072e4f3`
- Release tag: `v1.2.0`
- Feature branch: `v1.2-backup-guardrails`, now deleted
- Implementation commit: `b1c406d`
- Tests: `./scripts/verify.sh` passed 70/70
- Status: clean `main` branch pushed to GitHub, `v1.2.0` tag pushed
- Note: recent-export threshold is currently 7 days

The v1.2.0 release was completed on 2026-05-01. The release covered:

- Added backup health messaging.
- Added export-recommended state.
- Added warnings before risky import modes without recent export.
- Added active-session warning on JSON export.
- Added backup health helper tests.
- Updated README, changelog, known limitations, smoke test, release checklist, workflow docs, and data model docs.

Next possible patch: consider v1.2.1 to change backup recency threshold to 24 hours if stricter daily backup discipline is preferred.
