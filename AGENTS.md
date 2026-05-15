# AGENTS.md

## Repo Purpose

VIDTOOLZ Episode Factory is a dependency-free, local-first static web app and package-run workflow for a solo YouTube creator. It supports episode planning, package generation, review gates, Creator QA exports, and local production evidence without requiring a backend.

## Safety Rules

- Keep the local-first workflow intact.
- No backend, authentication, or external API integration unless explicitly requested and reviewed.
- Do not add external dependencies unless the reason is concrete and documented.
- Do not delete, reset, clean, rewrite package-run history, or mutate durable workflow state unless the task explicitly asks for it.
- Preserve compatibility with the existing `localStorage` key: `vidtoolz-episode-factory-v1`.
- Preserve compatibility with the current episode object shape unless a migration path is added.
- Do not break existing Markdown package exports.
- Keep Creator QA JSON exports tolerant of missing optional fields.
- Every Episode Factory to Creator QA field mapping must be documented.
- Every new input, export shape, state transition, or validation rule needs tests.

## No Fake Readiness Or Proof

- Do not claim production readiness, publishing readiness, shooting approval, visual proof, or evidence completion unless the relevant package-run artifacts explicitly support it.
- Transcript text is not visual proof.
- Reproduced mockups, plans, and review notes are not original capture evidence.
- A passing script check is not approval to publish, shoot, promote state, or update Hermes memory.
- If evidence is missing or ambiguous, say so plainly and keep the workflow blocked.

## Package-Run Evidence Rules

- Treat `package-runs/` as durable creator workflow evidence.
- Do not edit package-run files casually. If a task touches package-run state, name the exact run and reason.
- Keep boundary language clear: planning, QA, proof capture, production prep, shooting approval, editing, and publishing are separate states.
- Do not mark downstream work complete unless the package-run gate files and review artifacts justify it.
- Keep generated reviews, checklists, and exports inspectable as local files.

## Engineering Rules

- Prefer simple HTML, CSS, and JavaScript.
- Keep data normalization and import/export validation in `episode-model.js`.
- Keep storage access behind `storage-adapter.js`.
- Keep UI event wiring in `app.js`.
- Add or update dependency-free tests when changing model, export, import, copy payload, or validation behavior.
- Update docs when changing workflow, data model, project rules, or package-run semantics.

## Required Verification

Always run this command before reporting implementation complete:

```sh
./scripts/verify.sh
```

If a command cannot be run, report why and what risk remains.

## PR Review Guidelines For Codex

- Keep PRs issue-driven and narrow.
- State whether the change affects UI, data shape, package-run evidence, Creator QA export, or only docs/workflow support.
- Include `./scripts/verify.sh` output in the PR.
- If UI changed, include browser screenshots or describe why browser proof was not possible.
- If package-run files changed, identify the affected run and the evidence boundary.
- Do not approve or merge changes that fake readiness, skip evidence gates, or blur human approval boundaries.
