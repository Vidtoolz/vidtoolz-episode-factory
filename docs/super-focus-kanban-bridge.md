# Super Focus → Production Kanban evaluation bridge

When a Super Focus script's evaluation is persisted with verdict `PRODUCE`
(the evaluator's own top-level verdict: weighted score at or above the produce
band AND no failing hard gate) and the evaluation is not stale, Episode
Factory upserts the project's production card into the VIDTOOLZ Production
Kanban (`http://127.0.0.1:8070`, port via `KANBAN_PORT`). Kanban is the
production-state spine after the gate; EF remains the authority on the script
and its evaluation truth. The evaluator stays advisory inside EF: a PRODUCE
verdict changes nothing in EF state besides the recorded sync outcome.

Module: `super-focus-kanban-bridge.js`. Trigger: server-side, inside
`POST /api/super-focus/evaluate-script`, after `saveScriptEvaluation()`
persists the result. The gate is re-derived from persisted state inside the
bridge — request input can never forge a qualification.

## Evaluation identity

`script_evaluation.evaluation_hash` = SHA-256 over the canonical JSON
(recursively sorted keys) of the persisted evaluation minus volatile /
self-referential fields: `evaluation_hash` itself, `evaluated_at`, `stale`,
`stale_reason`, and `model.host`. Everything else is hashed — including
`script_hash` (SHA-1 of the exact script string, the existing staleness
identity), verdict, scores, gates, checklist, sentence rows, and the evaluator
model name. Any script edit changes `script_hash`, therefore the evaluation
hash; independently, the stale flag blocks an old approval from syncing after
the script changed. Stamped at persist time by the evaluate route; recomputed
from persisted bytes on every sync (a divergence is logged and the recomputed
value wins).

## Card contract

- Identity triple: `sourceApp: vidtoolz-episode-factory`,
  `sourceType: super-focus-script`, `sourceId: <project_id>`; the project's
  existing `kanban_card_id` travels as a `cardId` hint.
- Endpoint: Kanban `POST /api/integrations/cards/upsert` — idempotent
  (match by triple → cardId hint → `metadata.ef_project_id`), metadata-MERGING
  (never replaces the bag; `ef_project_id` and mindmap keys survive),
  advance-only (a card already past `draft_script` is never moved backwards;
  the archive is terminal), capacity-checked only on create.
- New cards land in `draft_script`. Card metadata carries `ef_project_id`
  (powers the existing Kanban → `super-focus.html?project=<id>` deep link) and
  `super_focus_eval` (status, full evaluation_hash, script_hash, total_score,
  score_band, verdict, evaluated_at, evaluator_model).
- Card titles on EXISTING cards are never touched — the operator owns the board.

## Editorial source continuity

The Kanban link endpoint fetches the canonical card and, for Mindmap-sourced
cards, snapshots its source system/kind/ID plus any explicit claim, topic,
category, taxonomy, and selected-script identity into
`super-focus.json.editorial_source`. The snapshot survives reload and travels
with every qualifying exact-script evaluation as
`metadata.super_focus_eval.source_provenance`.

An explicit controlled Mindmap classification travels separately as
`metadata.super_focus_eval.editorial` only when the current evaluator script
hash equals the selected Mindmap source script hash. Episode Factory never infers claim
type, hook type, or narrative spine from script text. Omitted fields do not
erase stored identity; contradictory durable identity returns a conflict
instead of overwriting the project.

## Failure and recovery

A Kanban outage never fails the evaluation: the eval response stays 200 and
carries `kanban_sync: { status: 'failed', error }`; the same outcome is
recorded durably on the project (`state.kanban_sync`) with the evaluation
hash. Replay:

```bash
node scripts/super-focus-kanban-sync.js --project <id>
node scripts/super-focus-kanban-sync.js --all [--dry-run]
```

The CLI re-derives qualification from persisted state (fresh PRODUCE only,
active projects only) and performs the identical idempotent upsert — safe for
downtime recovery, restarts, and historical pre-bridge passes. Exit 0 = no
failures, 1 = at least one sync failed.

## Re-evaluation semantics

- Identical script + result → identical hash → card no-op.
- Changed script with a new PRODUCE → same card, new `super_focus_eval`,
  downstream stage preserved.
- Changed script without re-evaluation → stale evaluation → bridge refuses
  (both in the route hook and the CLI).
- Failed evaluation → no bridge call; an earlier card is never deleted or
  regressed.

Tests: `tests/super-focus-kanban-sync.test.js` (EF side),
`test/eval-upsert.test.mjs` (Kanban side).
