# ARCHITECTURE REVIEW — NO GATE-7 IMPLEMENTATION

Read-only audit of gate 7 `capture-checklist`. Nothing was built, no artifact was
fabricated, and the retained canary was left at gate 7 untouched.

## Classification

**E — MIXED MACHINE/HUMAN GATE**, whose machine half is in state **B (owner
correct, implementation missing)**.

E is the governing answer, and the distinction matters: B alone would imply
"build the bridge and the gate completes". That is false here. Even a perfect
machine bridge leaves gate 7 incomplete, because the gate also requires real
capture work and an exact human capture-approval marker.

## Gate 7 canonical contract

| field | value |
| --- | --- |
| gate id | `capture-checklist` |
| gate number | 7 of 14 |
| status on canary | `current-blocked` |
| evaluator | `scripts/package-run-capture-checklist.js` |
| ladder | `BLOCKED` → `NEEDS CAPTURE` → `READY FOR ROUGH CUT` |
| declared owner | `presenter_director` |
| is a HUMAN_GATE | **no** (gate 8 `capture-evidence` is, owned by `qc_director`) |

Note the ladder differs from gate 6: there is no `READY FOR HUMAN APPROVAL` /
`PASS` pair here. Gate 7's terminal machine state is `READY FOR ROUGH CUT`.

## Required artifacts and who actually writes them

| artifact | intended writer (contract) | current writer | machine/human | adapter? | reachable? |
| --- | --- | --- | --- | --- | --- |
| `capture-checklist.md` | presenter_director ("recording readiness") | `package-run-capture-checklist.js` | machine-derivable | none | no |
| `takes-log.md` | presenter_director ("take logging") | `package-run-capture-checklist.js` | records real capture | none | no |
| `missing-shot-tracker.md` | presenter_director / consumed by editor | `package-run-capture-checklist.js` | machine-derivable | none | no |
| `screen-recording-checklist.md` | presenter_director ("recording readiness") | `package-run-capture-checklist.js` | machine-derivable | none | no |
| `audio-capture-checklist.md` | presenter_director ("recording readiness") | `package-run-capture-checklist.js` | machine + **human marker** | none | no |

All five exist on the canary as: **absent**. None has ever been produced for it.

## Declared owner — identity

The brief referred to owner "`E`". That is not a role: it came from the
classification list A–F in the previous report. The live declared owner is

```
GATE_OWNERS["capture-checklist"] = "presenter_director"
```

`scripts/package-run-state-projection.js`. Canonical identity: **Presenter /
Performance Director**.

## Owner readiness

```
contract role_roster : status PLANNED, build_order 7
registry lifecycle   : doctrine DEFINED, proven NOT_PROVEN, autonomous_dispatch DISABLED
dispatch authority   : BLOCKED_AGENT_NOT_ENABLED
module               : scripts/presenter-director.js EXISTS (31 KB, 4 actions)
```

`dispatch_blocked_reason`, recorded in the registry:

> Presenter / Performance Director is contract status PLANNED (build_order 7).
> Doctrine is complete so authority is unambiguous the moment it is built;
> execution stays refused until Mikko authorizes enablement.

`enablement_prerequisites`:

1. canonical presenter take/delivery artifact contract proven end to end
2. Editor take-selection boundary demonstrated against real evidence
3. **explicit human enablement decision by Mikko**

## Is the owner correct?

**Yes.** The contract gives `presenter_director` exactly this work:

```
owns: script-for-delivery preparation, recording readiness,
      take logging, best-take proposals
```

`editor` owns "coverage-gap detection" and explicitly does **not** own
"Presenter take selection" — so Editor *consumes* `missing-shot-tracker.md`
rather than producing it. `production_operations` has no capture-related allowed
action at all. The ownership assignment is doctrinally right; only the
implementation is absent.

## Does the gate-6 defect repeat?

Structurally, yes — the same shape:

```
presenter_director -> presenter-take-manifest.js   (its own typed artifact lane)
gate 7 evaluates   -> five package-run markdown files
adapter between    -> NONE
```

`grep` confirms `scripts/presenter-director.js` contains **zero** references to
any of the five gate-7 artifacts. Only deterministic `package-run-*.js` tools
write them. That is precisely the gate-6 pattern: a semantic specialist with a
typed artifact, deterministic markdown generators, and nothing connecting them.

**But three differences make this materially less bad than gate 6:**

1. **The system is honest here.** Gate 6's owner claimed `IMPLEMENTATION_PROVEN`
   and `dispatch_enabled: true` while being unable to do the work. Gate 7's owner
   declares `NOT_PROVEN`, `DISABLED`, names its blocker, and lists its
   prerequisites. Nobody is told to dispatch it.
2. **The projection does not contradict itself.** At gate 6 the same object said
   `expected_owner: visual_planning_director` while `next_safe_human_action`
   pointed at codex draft-only. At gate 7, owner-disabled and
   `{actor: "codex", mode: "draft-only"}` are consistent statements.
3. **The generator is not a permanent scaffold producer.** Unlike
   `package-run-production-plan.js`, which hardcoded `TODO` into every row it
   emitted, this generator's rows are conditional:
   `const status = readiness.readyForRoughCut ? "closed" : "TODO";`
   It projects capture state rather than manufacturing unsatisfiable scaffolding.

## Gate-7 evaluator, exactly

```
BLOCKED           production-plan.md missing, shoot-readiness != READY TO SHOOT,
                  or production-blockers.md has open rows
NEEDS CAPTURE     capture artifacts missing, shot/screen/demo rows incomplete,
                  or no exact capture readiness approval marker
READY FOR ROUGH CUT  all of the above satisfied
```

Next action it emits: *"Complete real capture work, update capture artifacts, and
add an exact capture approval marker only after review."*

Accepted human markers (`hasExactCaptureApprovalMarker`):
`Manual approval: PASS`, `Capture approval: PASS`, `Audio capture readiness: PASS`,
`Rough-cut assembly approval: PASS`.

## What Mikko must actually do at gate 7

Two distinct things, and only the second is a decision:

1. **Real capture must happen** — the takes exist or they do not. No agent can
   assert this into being.
2. **Record an exact capture-readiness approval marker** after reviewing the
   captured material.

He does not approve a checklist here. Gate 7 is not a HUMAN_GATE in the
projection's sense; the human confirmation of captured material is gate 8
`capture-evidence`, owned by `qc_director`.

## Draft / Review / Production modes — the real gap

**The three-tier production model does not exist in this codebase.** A repo-wide
search for `draft mode`, `review mode`, `production mode`, `proxy presenter`, and
`synthetic presenter` across `*.js`, `*.json` and `*.md` returns nothing (the one
CHANGELOG hit is "weekly review model", unrelated).

Consequence: **gate 7 has exactly one capture semantics — real capture.** It
cannot express "this is a Draft-Mode run, so proxy presenter media satisfies
capture". Supporting evidence that the presenter lane assumes a real performance:
`presenter-take-manifest.js` carries `FIDELITY_CLASSES`
(`SCRIPT_FAITHFUL`, `MINOR_DELIVERY_VARIATION`, `HUMAN_VERIFIED_REQUIRED`, …) and
`FIDELITY_METHODS` (`EXACT_TEXT_MATCH`, `SEMANTIC_TRANSCRIPT_REVIEW`,
`HUMAN_VERIFIED`) — machinery for comparing a transcribed human delivery against
the approved script.

So the lifecycle model conflates the modes by having only one. **This is the
architecture gap to decide before building anything at gate 7**, because the
correct owner depends on it:

- a Draft-Mode capture gate would be machine-satisfiable (proxy media)
- a Production-Mode capture gate is inherently human and cannot be automated

Flagged, not redesigned.

## Relationships

**Presenter Director.** Gate 7 is not merely presentation-adjacent — the contract
explicitly assigns it "recording readiness" and "take logging". Gate 7 is
plausibly one of the *reasons* the role exists, and its own prerequisite #1
("canonical presenter take/delivery artifact contract proven end to end") is
essentially a gate-7/8 concern. Not enabled, not assigned work here.

**Editor.** Consumes coverage gaps; owns "coverage-gap detection" and is barred
from take selection. Producing `missing-shot-tracker.md` is upstream of Editor,
not Editor's job.

**Production Operations.** No capture-related allowed action in the contract. The
hypothesis that it should own checklist bookkeeping is **not supported** by the
current contract; assigning it would be a doctrine change, not an implementation.

## Recommended design choice (not implemented)

Decide the mode question first, then the ownership follows:

1. **Introduce an explicit run-level capture mode** (Draft / Review / Production)
   in the lifecycle model, so gate 7 can state which capture semantics apply.
2. Only then decide the gate-7 machine half. If Draft Mode exists, a
   `presenter-take-manifest → five artifacts` adapter mirroring the gate-6 bridge
   becomes coherent and `presenter_director` is the right owner to enable. If
   there is only Production Mode, gate 7 stays human-executed and the honest fix
   is to keep the deterministic generator as preparation and treat capture as
   Mikko's work.

Do not build the gate-7 bridge before the mode decision: it would encode an
answer to a question the architecture has not yet asked.

## Status

`ARCHITECTURE REVIEW — NO GATE-7 IMPLEMENTATION` · no artifacts created · canary
left at gate 7 · no Mikko decision exists for gate 7.
