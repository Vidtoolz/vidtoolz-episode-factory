# Durable Publish-Gate Operator Decisions (Backlog B3) — 2026-07-10

Make the operator's publish-gate decision authoritative, durable workflow state
— distinct from the automated evaluation — instead of transient DOM checkboxes
lost on reload. Never publishes, uploads, renders, or advances irreversible state.

## Baseline

- Branch `feat/publish-gate-decision-persistence` from `main` @ `2a57a72` (PRs #16/#17/#18 merged).
- Tests at start: `1829/1829`; `verify.sh` exit 0; working tree clean; unrelated stash preserved.

## Current workflow map (before)

| Entry | Automated source | Visible result | Operator action | Persistence | Downstream | Defect |
| --- | --- | --- | --- | --- | --- | --- |
| publish-gate.html gates 1–5 | rough-cut/final-review/export/metadata scripts | PASS/FAIL badges | checkboxes (`roughApproved`, `finalApproved`, `metadataConfirmed`, `publishedConfirm`) | **DOM only — lost on reload/run-switch** | none (advisory) | operator decision is not durable; a green PASS badge conflated automated result with human approval |
| package-run doctor / index / next-safe-action | final-review status | "publish-ready on paper" | — | read-only | dashboards | describe automated readiness only; conservative "does not mark publish_ready" |

The system is deliberately conservative (nothing auto-publishes or auto-advances from a PASS), so B3 adds the missing durable operator-decision layer without changing that behavior.

## Previous transient-state problem

The publish gate could show a PASS and let the operator tick approval, but the decision was pure browser state: a reload, run switch, or restart cleared it, and no server/downstream logic could distinguish "the system calculated PASS" from "the operator approved."

## State schema (`package-runs/<run>/publish-gate-decision.json`)

```
{ schema_version, decision_version,
  decision: { status, decided_at, decided_by:"operator", evidence_revision, note },
  history: [ { type, at, by, evidence_revision, previous_status, note, route, schema_version } ] }
```

- **Evaluation states:** `pass`, `fail`, `not_evaluated` (live-computed, never persisted).
- **Decision states:** `undecided`, `approved`, `rejected`, `revoked`.
- **Persistence:** dedicated project(run)-scoped JSON, atomic tmp+rename, schema-validated; malformed → 422; legacy runs (no file) read as `undecided` and are never rewritten by a read; per-run isolated.

## Evaluation vs decision

`evaluatePublishGate(runDir)` computes the automated result deterministically from on-disk artifacts (final-review.md present + selected-images.json + a staged final video), with explicit blockers. The **decision** is the separate, explicit, durable operator call. `isPublishApproved()` is the single authoritative resolver: true only when a durable `approved` decision is bound to the current evidence revision AND the current automated gate still passes. An automated PASS alone is never approval.

## Evidence-revision inputs

`computeEvidenceRevision(runDir)` = sha256 over a canonical manifest of the material publish inputs: `final-script.md`, `selected-images.json`, `video-prompts.json`, `rough-cut-review.md`, `final-review.md`, `publication-blockers.md`, `publish-metadata-review.md`, `export-checklist.md`, `package-run-state.md` (each contributes a content hash; absence is part of the revision), plus the staged final video listing (path + **size only** — clips are never read into memory). Identical relevant state → identical revision; any material change → a different revision. Irrelevant/UI files do not affect it. The server always computes it; a client-supplied revision is never trusted (only accepted as an optimistic `base_evidence_revision` to compare).

## Staleness

Derived at read time: an `approved`/`rejected` decision is stale when `decision.evidence_revision !== current`. Stale decisions are preserved in place and history, clearly labelled ("Approval STALE — project changed after approval"), and never count as publish authorization; a new explicit decision on fresh evidence is required.

## Approve / reject / revoke

- **Approve** — only for a current automated PASS on current evidence; `not_evaluated` → 422, `fail`/blocked → 422, evidence changed since eval → 409 `PUBLISH_GATE_EVIDENCE_STALE`. Writes one `approve` event. Never publishes/uploads/renders/clears blockers/rewrites evaluation.
- **Reject** — allowed even when automated PASSes (distinct from an automated failure); requires an evaluation exists; preserved durably with the current revision and optional note.
- **Revoke** — withdraws a current approval; 409 `INVALID_DECISION` if none; preserves prior decision in history.
- **Replace** — a later decision supersedes a prior one; history is append-only (approve→reject→approve preserved). No silent "undo".

## API contract

`GET /api/package-runs/publish-gate/decision?runId=` (read-only; returns separate `evaluation` + `decision` + `publish_approved` + `history`); `POST …/approve|reject|revoke` (nonce-gated). Reason codes: `PUBLISH_GATE_NOT_EVALUATED`, `PUBLISH_GATE_FAILED`, `PUBLISH_GATE_BLOCKED`, `PUBLISH_GATE_EVIDENCE_STALE`, `DECISION_CONFLICT`, `INVALID_DECISION`, `DECISION_NOTE_TOO_LONG`, `MALFORMED_DECISION_STATE`, `DECISION_WRITE_FAILED`, plus `resolvePackageRunDir` 400/404. Statuses: 400/404/409/422/500 as specified; never a 200 with a false approval.

## UI behavior

New "Operator Decision" panel (distinct from the gate badges): shows `Automated gate: PASS/FAIL/not evaluated` and `Operator decision: Approved/Rejected/Revoked/No decision recorded` on separate lines, with a distinct STALE label. Approve enabled only for a current PASS (disabled with a reason otherwise); Reject when an evaluation exists; Revoke only for a current approval. Pending requests disable the buttons; a conflict/stale response shows the server message and refreshes; reload/restart reconstruct the same decision; notes and server messages are escaped; decision history is shown. No publish/upload button added.

## Downstream workflow integration

`isPublishApproved()` / `isPublishApprovedForRun()` are exposed as the single truthful resolver for any consumer. The conservative no-auto-publish behavior is unchanged; existing dashboards/doctor still describe automated readiness. `Gate passed` (automated), `Approved for publishing` (durable operator decision), and `Published` (a real publication event, tracked separately by the archive/published flow) remain distinct.

## Legacy compatibility

Missing decision = `undecided`; automated PASS never becomes approval; no fabricated history; reading a legacy run never writes a decision file; malformed authoritative state fails safely (422, visible); non-publishing workflows are unaffected. No bulk migration.

## Concurrency model

The write boundary is a synchronous read-validate-write (no `await` between reading the decision file and the atomic rename), so within the single Node process concurrent writers are serialized. Optimistic concurrency via `decision_version`: a writer sends `base_decision_version`; a mismatch → 409 `DECISION_CONFLICT` (first writer wins). An evidence-change race is caught by `base_evidence_revision` vs the server-computed current revision → 409. A failed write (tmp+rename) leaves the previous decision file intact.

## Tests

`tests/publish-gate-decision.test.js` (22): state model (undecided/legacy/persist/restart/reject/supersede/malformed/no-write-on-read); evidence revision (determinism, material vs irrelevant change, server-authoritative); approval (PASS-required, not-evaluated/fail/blocked, evidence-stale 409, one event); revoke (+ 409 without approval, history preserved); note length limit; staleness (goes stale, not authorization, fresh re-approval); concurrency (version conflict); `isPublishApproved` resolver; API (404/400/422/200 separation, no-mutation GET, no leaked paths, nonce 403); UI separation + wiring + escaping.

## Verification

- `./scripts/verify.sh` → exit 0, **`1851/1851 tests passed`** (baseline 1829; +22), canonical-spec in sync, doc-authority passed, 59 unique test modules.
- Browser workflow smoke → exit 0, `{"ok": true, …}`.
- `git diff --check` → clean.
- Fixture-only live smoke: temporary run evaluated → PASS; approve stored; reload shows same approval; evidence mutation → stale (not authorization); revoke on fixture; missing project → 404. No external publish, render, or queue activity.

## Safety

No video published or uploaded; no external publishing API called; no real FLUX/PRESTO/Wan2.2/ComfyUI generation; no cloud; no real project decision changed (fixtures only); no production queue/media state changed; unrelated stash intact; Hermes Mission Control and brain untouched. B1 remains unimplemented.

## Remaining limitations

- The automated evaluation is derived from artifact presence (final-review.md + selected media + staged video), not by parsing review prose; running the review scripts still happens through the existing gate buttons.
- `isPublishApproved` is available to downstream consumers but, respecting the repo's conservative "Mikko approves durable state" model, is not force-wired to auto-advance any workflow; consumers opt in.
