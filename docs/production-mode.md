# Production mode

The lifecycle used to ask *who owns capture?* before it could answer *what kind
of production is this?* Gate 7 therefore meant machine preparation, proxy
delivery, real human performance and take logging all at once, and its single
declared owner could only be correct for one of them.

Production mode is the missing distinction, made canonical.

| mode | meaning |
| --- | --- |
| `DRAFT` | machine performance — proxy presenter, synthetic delivery, no human intervention |
| `REVIEW` | human judgment over a draft that already exists |
| `PRODUCTION` | real Mikko performance replaces the proxy |
| `MODE_UNSPECIFIED` | the run has not declared one; never guessed |

## What mode controls

Presenter type, whether human capture is required, whether proxy delivery is
acceptable, what gate 7 means, what capture evidence gate 8 requires, who owns
machine preparation, whether take logging applies, and whether entering a mode
triggers recapture. It controls nothing editorial.

## Authority

`package-runs/<run>/production-mode.json` — durable, per run, schema
`vidtoolz.packageRunProductionMode.v1`, holding `run_id`, `mode`, `set_by`,
`set_at`, `predecessor` and `rationale`.

Mode is **not** owned by `package-run-state.md`, the tracker, the control room, or
any UI state. Those read it. Deleting the projection does not change the mode;
deleting the canonical record does.

Read or set it with:

```
node scripts/package-run-production-mode.js package-runs/<run>
node scripts/package-run-production-mode.js package-runs/<run> --set REVIEW --by "<authority>"
```

## Who may change it

Agents may set `DRAFT` and `REVIEW`. Promotion to `PRODUCTION` requires an
explicit local human identity, because it is the decision that commits Mikko to
physically record. An agent attempting it is refused with
`PRODUCTION_MODE_HUMAN_AUTHORITY_REQUIRED`.

Allowed transitions:

```
DRAFT      -> REVIEW
REVIEW     -> DRAFT | PRODUCTION   (PRODUCTION is human-only)
PRODUCTION -> REVIEW               (explicit rework)
```

There is no `PRODUCTION -> DRAFT`: discarding a locked human performance back to
proxy delivery is a new run, not a mode change. `DRAFT -> PRODUCTION` is refused
too — a draft has not been reviewed yet.

## Relation to the 14-gate lifecycle

Mode is an orthogonal run dimension, not a second lifecycle engine. The canonical
14 gates, their identity and their order are unchanged; mode changes only what
evidence a gate requires and who owns it. A mode change never advances, reopens
or reorders a gate.

Mode-conditional behaviour lives in `config/gate-mode-policy.json` as data, read
by `scripts/gate-mode-policy.js`. Only gates whose behaviour genuinely varies are
governed; everything else is mode-independent.

## Gate 7 `capture-checklist` per mode

| mode | status | machine owner | human performance | human approval |
| --- | --- | --- | --- | --- |
| `DRAFT` | **BLOCKED** | `generation_supervisor` | no | no |
| `REVIEW` | IMPLEMENTED | — | no | no |
| `PRODUCTION` | **PLANNED** | `presenter_director` (+ `production_operations` preparing) | yes | no |
| `MODE_UNSPECIFIED` | fails closed | — | — | — |

Gate 7 never requires an approval in any mode. That matters: human capture
authority belongs at gate 8, not here.

**DRAFT is BLOCKED** — not by gate wiring, by three absent capabilities:

- `presenter-take-manifest` models real human delivery only (human transcript
  sources, `HUMAN_VERIFIED` fidelity, `createHumanSelection`)
- `PRESENTER_A_ROLL` is excluded from `visual-plan-prompt-adapter` `PROMPT_MEDIA`,
  so presenter delivery is contractually not machine-generable
- no text-to-speech, avatar or synthetic-voice producer exists in the repository

**PRODUCTION is PLANNED** — `presenter_director` is contract status `PLANNED`
(build_order 7), `NOT_PROVEN`, dispatch `DISABLED`, and its enablement
prerequisites include an explicit decision by Mikko.

## Gate 8 `capture-evidence` per mode

| mode | status | human approval |
| --- | --- | --- |
| `DRAFT` | **BLOCKED** | required — collides with zero-human doctrine |
| `REVIEW` | IMPLEMENTED | not re-evaluated because mode changed |
| `PRODUCTION` | IMPLEMENTED | Mikko confirms the captured material |

Gate 8 reaches `PASS` only with an exact human approval marker recorded after
real capture evidence, and it explicitly refuses rows marked `dummy`,
`smoke-test`, `test-capture`, `test-screen`, `test-voiceover` or
`generated checklist row`. Synthetic capture cannot be presented as capture.

## Human authority boundaries

- **Mikko** owns promotion into `PRODUCTION`, the physical performance itself, and
  the gate-8 confirmation that the captured material is what was intended.
- **`production_operations`** prepares capture bookkeeping.
- **`presenter_director`** owns delivery direction, take requirements and
  best-take proposals — proposals only; it never selects.
- **`editor`** consumes coverage gaps downstream and is barred from take
  selection.

## Implementation status

- **IMPLEMENTED** — the run-mode contract, its transitions and authority rules;
  the declarative gate/mode policy; mode exposure in `package-run-state`.
- **PLANNED** — gate 7 in `PRODUCTION`, pending `presenter_director`.
- **PLANNED** — a mode-aware `expected_owner` projection. The need is proven (the
  one static owner is wrong for `DRAFT` and `REVIEW`) but the projection still
  reports the static owner.
- **BLOCKED** — gate 7 and gate 8 in `DRAFT`, pending a synthetic delivery
  capability and a decision about whether a draft ends before gate 8.

Nothing above is described as working because it is intended to.
