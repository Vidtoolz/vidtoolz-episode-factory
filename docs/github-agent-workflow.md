# GitHub Agent Workflow

VIDTOOLZ Episode Factory stays local-first: local files, local package-run evidence, and `./scripts/verify.sh` remain the source of truth. GitHub issues and pull requests are coordination surfaces for narrow Codex work and review, not replacements for package-run gates or human approval.

## Local-First Development

- Start from the local repo and existing docs.
- Keep changes narrow and issue-driven.
- Run `./scripts/verify.sh` before reporting work complete.
- Do not treat GitHub status, a passing CI run, or a PR review as publishing approval.
- Keep package-run artifacts inspectable and separate from claims about readiness.

## When To Use Codex CLI

Use local Codex CLI when work depends on local files, package-run evidence, browser checks, or private creator context.

Good fits:

- Small implementation tasks with clear target files.
- Local docs and workflow support updates.
- Package-run artifact inspection.
- Browser/manual verification that needs local state.
- Preparing a PR from local changes after human approval.

## When To Use Codex Cloud Or PR Review

Use Codex Cloud or PR-based review only when the task can be safely represented by repository files and issue context.

Good fits:

- Reviewing a focused PR.
- Implementing a narrow GitHub issue that does not require private local evidence.
- CI-driven fixes where `./scripts/verify.sh` explains the failure.
- Docs, templates, and workflow support changes.

Do not use Codex Cloud as the authority for private package-run evidence, Hermes brain updates, publishing decisions, or creator strategy decisions that are only present locally.

## Human Approval Requirements

Human approval is required before:

- Publishing, upload prep, final title lock, or final thumbnail lock.
- Shooting approval or production readiness claims.
- Durable package-run state promotion.
- Hermes brain or project-state updates.
- Pushing branches or merging PRs when the change affects production workflow, package-run evidence, or creator positioning.
- Adding dependencies, backend services, authentication, or external API integrations.

## Mapping Hermes Handoffs Into GitHub Issues

Use Hermes handoffs as source context, then reduce them into a narrow GitHub issue:

1. Identify the handoff title, source path, and current lifecycle status.
2. Extract the concrete task, not the whole conversation.
3. Add links or paths to local docs/package-run files when they are safe to reference.
4. State what is in scope and out of scope.
5. Add acceptance checks, including `./scripts/verify.sh`.
6. Add evidence boundaries if package-run files are involved.
7. Keep human approvals outside the issue unless they are already explicitly recorded.

Issue template choice:

- Use `Codex implementation task` for code, docs, or workflow-support changes that should produce a PR.
- Use `Verification task` for browser proof, manual inspection, package-run review, or evidence validation.

## PR Review Boundary

A PR is ready for review when:

- The summary says what changed.
- Verification includes `./scripts/verify.sh`.
- UI changes include screenshots or browser proof.
- Package-run impact is explicitly marked.
- Safety/approval boundaries are stated.

A PR is not ready if it claims proof, readiness, publishing approval, or production completion without package-run evidence.
