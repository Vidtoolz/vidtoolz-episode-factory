# STORY-VALIDATION BRIDGE

REVIEW MATERIAL / PROOF DOCUMENT — not an approval.

## The defect

QC Director correctly refused to inspect the retained lifecycle canary's
research evidence:

    disposition: BLOCKED
    blockers:    QC_REQUIRED_EVIDENCE_MISSING
    missing:     STORY_VALIDATION

The requirement was real, but no production path in Episode Factory ever
produced the evidence. QC was asking for evidence nobody owned.

## Semantics of STORY_VALIDATION

STORY_VALIDATION is **schema/lineage integrity evidence** for the run's bound
canonical Story:

- the binding resolves to exactly one Script Builder version
- that version is the project's append-only head
- the version's content hashes to its recorded content_hash
- section identity (ids unique, dense order, dialogue present) is intact

It is NOT narrative judgment, NOT Story Editor opinion, NOT Mikko approval.
The QC adapter (`storyAdapter`) consumes `schema_version: 1` plus a verdict —
a structural contract, which is exactly what a deterministic validator
produces truthfully and a model dispatch cannot improve.

## Canonical producer

`story_validator` — `scripts/package-run-story-validation.js`.

Deterministic by design:

- reads the run's `story-binding.json`
- resolves through `package-run-story-binding.resolveBoundStory` (fail-closed
  on absent/wrong/superseded/hash-drifted Story)
- verifies section identity and lineage via Script Builder's canonical reader
  through `script-builder-compat.js`
- emits `story-validation.json` into the run, atomic write, digest-bound

Why not story_editor: `review_script` is semantic judgment over the
large_text lane and its preflight requires `central_claim` +
`narrative_spine`; the retained canary's registered Story legitimately lacks
both (dispatch attempt BLOCKED — honest, documented; its evidence is archived
at `story-editor-dispatch-evidence/` in this proof package). Semantic review
remains a separate artifact for gates that need it.

Why not Script Builder: Script Builder is the cross-repo Story authority;
Episode Factory owns package-run lifecycle evidence. The validator only READS
Script Builder through the sanctioned contract.

## Lifecycle trigger (future runs)

`scripts/package-run-story-registration.js` now materializes STORY_VALIDATION
immediately after writing the Story binding (and backfills idempotently on
the reuse path). A future genuine package run therefore obtains the evidence
during its normal script/story phase — no operator memory required.

## RED → GREEN on the retained canary

Both through the real runner (`scripts/agent-run.js --agent qc_director`):

| task                          | evidence | disposition | missing |
|-------------------------------|----------|-------------|---------|
| canary-qc-storyval-red-01     | none     | BLOCKED     | STORY_VALIDATION |
| canary-qc-storyval-green-01   | real     | PASS        | (none)  |

Persisted under `agents/qc_director/` of the retained canary.

## Gate state

Unchanged. Gate 7 `capture-checklist` current-blocked, 6/14 complete. This
mission granted no capture-checklist completion, no human approval, no
capture artifacts. Gate-7 ownership remains the separate Claude mission.

## Drift and supersession

Covered by `tests/story-validation-bridge.test.js` (13/13): wrong project,
superseded version, bound-hash drift, post-evidence content drift, malformed
payload, verdict-less hand-authored payload, idempotency, and the
architecture invariant that every QC-required evidence kind names a
reachable canonical producer.

## Remaining inventory flag

AUDIO_RENDER has a director module but no durable record emission path was
found (`production_mix_sha256` + `PRODUCTION_READY`). Flagged for next work;
not implemented here.
