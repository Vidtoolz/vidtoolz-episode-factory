# Earth Studio technical closure and directorial handoff

Codex closure record for the validated Earth Studio Stage-1 technical lanes. This is an evidence handoff, not cinematic approval and not a replacement for director policy.

## Closure matrix

| Area | Status | Evidence | Reopen only if |
| --- | --- | --- | --- |
| Direct travel | CLOSED | reversal/seam/endpoint tests and real playback evidence | a new real wobble, reversal, or endpoint regression appears |
| HOLD | CLOSED | semantic anchors, HOLD invariants, real H verification | a declared hold moves or develops pre/post-roll |
| Fly→orbit | CLOSED | ~5° tangent class and real H playback | real steering/aim snap appears |
| Orbit→travel | CLOSED | real orbit-exit validation and continuity diagnostics | real pause, reverse, or orientation pulse appears |
| Polar orbit | CLOSED | spherical destination geometry at polar cases | non-finite or inaccurate polar coordinates appear |
| High transit | CLOSED | dense real C trace; no material altitude defect | new real playback shows a dive, kink, or late correction |
| Continuation | CLOSED | exact settled pose and continuation tests | a real handoff changes the first pose |
| 16:9 framing | CLOSED | landmark/city/country/region and comparison evidence | a new subject class clips or becomes illegible |
| 9:16 framing | CLOSED | fresh vertical imports; physical Scandinavia extent fix | a new vertical subject class fails fit or legibility |
| Sequence execution | CLOSED | 19-project plan→timeline audit | plan and compiled timeline diverge |
| Real sequence fidelity | CLOSED | fresh DIRN-17, DIRN-14, DIRN-11 imports | Earth Studio differs from the compiled map |
| Intent contracts | PARTIAL TRACEABILITY | contract auditor; 0 observed violations | an explicit contract is contradicted, or metadata is carried downstream |

## Reopen discipline

Closed lanes should be reopened only by a new observed regression, failed invariant, or real Earth Studio mismatch. The existence of a more elaborate mathematical optimization is not evidence to reopen a lane.

## Directorial handoff

The execution layer faithfully produces the current time allocations. These are director-level questions, not compiler defects:

| Case | Total | Travel | Travel share | Subject time | Pattern | Review question |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| DIRN-07 | 32s | 23s | 71.9% | 9s | HOLD → TRAVEL → HOLD | Does the transit communicate enough geography to earn its duration? |
| DIRN-14 | 46s | 28s | 60.9% | 18s | HOLD → TRAVEL → HOLD → TRAVEL → HOLD → FLY → PULL_BACK | Does travel dominate the conclusion, and are repeated holds too static? |
| DIRN-17 | 68s | 28s | 41.2% | 40s | HOLD → TRAVEL → ORBIT → TRAVEL → ORBIT → FLY → PULL_BACK | Do two 15s orbit beats earn their repetition, and does the 6s conclusion land strongly? |
| DIRN-11 | 19s | 9s | 47.4% | 10s | HOLD → TRAVEL → HOLD | Do Helsinki and Stockholm feel genuinely comparable? |
| DIRN-18 | 39s | 30s | 76.9% | 9s | HOLD → FLY → HOLD | Has restraint become transit-dominated? |

The values above were confirmed against the compiled reports and, for DIRN-11/14/17, exact real Earth Studio duration and segment-boundary observations.

## Intent-contract status

The downstream auditor supports explicit `NO_ORBIT`, `NO_SPIRAL`, continuation, matched comparison, explicit grammar, and explicit duration when those fields are serialized. Synthetic `NO_ORBIT` contradictions fail correctly.

Current corpus coverage recorded 22 contracts: 3 satisfied, 0 violated, and 19 unverifiable. The unverifiable records are the computed no-globe policy because journey/shot-plan artifacts do not carry an explicit globe-scale field. Other upstream traceability gaps include normalized negative constraints, orbit-direction provenance, explicit altitude/tilt authority, explicit duration authority, and final-scale contracts.

These are metadata gaps, not demonstrated camera failures. Parser/director ownership should decide whether to serialize them further.

## Technical conclusion

No known material Codex-owned Earth Studio technical defects remain in the tested Stage-1 surface. Further Codex implementation work should begin only after human review, Hermes/Claude directorial work, or a regression reveals a concrete technical failure.

Human visual approval remains open.
