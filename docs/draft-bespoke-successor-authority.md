# Current-Story Draft bespoke successor authority

A Production package-run is immutable. A later Directed Draft iteration is represented by a separate `DRAFT` package-run whose `vidtoolz.draftBespokeSuccessor.v1` contract pins the Production predecessor, the canonical current approved Script Builder Story and its version bytes, inherited Draft narration/music inputs, and the non-final bespoke-still policy. The historical run's Story binding, release, render, and execution history are never rewritten.

## Authority sequence

The canonical sequence is:

```text
current approved Script Builder Story
  -> immutable DRAFT successor
  -> DRAFT_BESPOKE_STILL Visual Plan
  -> Generation Supervisor registry
  -> static Production Assembly composition projection
  -> non-final Draft release successor
  -> canonical Directed Draft Assembly Handoff
```

`scripts/draft-bespoke-successor-authority.js` owns the boundaries between those existing authorities. It does not generate media. The three mutating operations accept run IDs, resolve canonical artifacts internally, and write immutable records:

```bash
node scripts/draft-bespoke-successor-authority.js create \
  --predecessor-run-id <production-run-id> \
  --successor-run-id <new-draft-run-id>

node scripts/draft-bespoke-successor-authority.js plan \
  --run-id <new-draft-run-id>

node scripts/draft-bespoke-successor-authority.js assemble \
  --run-id <new-draft-run-id>
```

Use `create ... --dry-run` for a read-only eligibility check. Creation fails if the canonical current Story lacks exact current human approval, is not descended from the historical binding, or differs from its stored bytes/hash. An older release, Production state, prior render, or historical review cannot supply approval.

## Mode and successor rules

The predecessor must remain `PRODUCTION`. The successor is a distinct run whose canonical `production-mode.json` is `DRAFT`; this state—not a CLI override—selects `DRAFT_BESPOKE_STILL_V1`. Only one active successor for a predecessor is accepted, and lineage loops fail closed.

The successor contract sets production, publication, and final-asset authority to `false`. Synthetic Draft narration and Draft music are legal inputs. A final human performance is not required for this Draft boundary.

The successor's music decision starts its own local chain: history entry 0 is a root (`predecessor_decision_id: null`) and later local decisions point at the previous local `decision_id`. Inheritance from the Production predecessor's active human decision is provenance, recorded in `predecessor_source` (predecessor run, decision id, decision file path and hash) — never as local history linkage. `plan` retried after a director failure reuses the run's immutably materialized planning task, and the CLI budgets the routed planning model's measured latency (`--model-timeout-ms` overrides).

## Registry-to-composition projection

`assemble` consumes the successor's fixed Visual Plan and canonical `vidtoolz.draftBespokeStillRegistry.v1`. Every planned slot must have one registered IMAGE under the successor's own `media/draft-bespoke-stills` root with exact Story, prompt, attempt, hash, and dimension bindings. Unregistered assets, caller path injection, video/I2V/Kling provenance, or authority escalation are rejected.

The projection emits one full-canvas layer per slot with fixed `COVER` geometry and hard cuts. Motion, reveal, animated crop/position/scale, and temporal geometry are forbidden for this class. Existing V4 reveal remains unchanged for other classes.

The resulting release is an immutable, non-final `VISUAL_DRAFT` successor. Directed Draft Handoff materializes it from the run's canonical intake; operators do not supply media paths. A rendered successor will have its own exact-output-bound review subject and cannot inherit an older review or approval.
