# Earth Studio directorial time allocation

This is a directorial evidence handoff, not a cinematic approval. The camera
and sequence-execution lanes are treated as technically closed; the remaining
questions are whether travel, repeated grammar, and conclusion beats earn their
screen time.

## Current duration model

The live director uses an editorial travel duration for legs it invents:

- distance is log-compressed rather than mapped linearly to seconds;
- ordinary travel has an editorial cap around 15 seconds;
- pace is relative to the calm baseline, so `CALM` does not silently lengthen
  connective travel;
- the existing readability safeguard can raise a crossing above that editorial
  target when the selected travel shape cannot remain legible at its altitude;
- explicit movement and duration choices remain authoritative.

This explains the current results: ordinary high-transit legs in DIRN-14 and
DIRN-17 are 10s/9s, while the explicit direct Copenhagen→Berlin leg in DIRN-18
remains 30s because a 12s controlled variant produces a camera-quality warning
at destination framing altitude. That is a technical minimum for the chosen
explicit direct shape, not evidence that every long leg should be 30s.

## Current 19-project baseline

Measured from the existing sequence audit artifacts:

- median total duration: 17s;
- median travel share: 38.3%;
- grammar counts: HOLD 29, HIGH_TRANSIT 12, DIRECT 5, CINEMATIC 3,
  HALF_ORBIT 3, SLOW_ORBIT 2, ZOOM_OUT 3, plus isolated reveal/zoom beats.

Largest travel-share cases:

| Project | Total | Travel | Share | Subject view | Review question |
| --- | ---: | ---: | ---: | ---: | --- |
| DIRN-18 | 39s | 30s | 76.9% | 9s | Is the explicit direct move worth its technical floor, or should the director choose a different editorial shape? |
| DIRN-07 | 32s | 23s | 71.9% | 9s | Does the intercontinental crossing explain geography, or mainly connect Helsinki to Tokyo? |
| DIRN-14 | 46s | 28s | 60.9% | 18s | Do the return/conclusion and repeated holds earn the travel share? |
| DIRN-13 | 31s | 18s | 58.1% | 13s | Is the middle stop informative enough for the number of legs? |
| DIRN-16b | 16s | 8s | 50.0% | 8s | Does continuation need this much travel relative to the destination beat? |

## Flagship cases

### DIRN-18

Before/current: `39s = 4s HOLD + 30s explicit DIRECT + 5s HOLD`.

Controlled diagnostic candidate: `21s = 4s HOLD + 12s DIRECT + 5s HOLD`.
The 12s variant is not production-approved: the journey validator reports a
readability warning (`2.47 frame-widths/s`) for the direct low-altitude shape.
No duration change was made.

### DIRN-07

Before/current: `32s = 4s HOLD + 23s HIGH_TRANSIT + 5s HOLD`.

Controlled candidate: `26s` using a 12s crossing in place of the current 23s
crossing. This is an A/B candidate only; real import was not run because the
authenticated Earth Studio profile was occupied by concurrent capture work.

### DIRN-14

Current: `46s`, with `28s` travel, three destination/arrival holds, and a final
5–6s regional conclusion depending on the generated artifact revision.
The current director preserves the return-to-context beat. Review whether the
intermediate holds are distinct editorial views rather than default arrivals.

### DIRN-17

Current: `68s`, `28s` travel, Helsinki `15s HALF_ORBIT`, Stockholm `15s
HALF_ORBIT`, and a terminal Scandinavia pull-back of approximately `5–6s`.
The comparison is technically balanced. The open question is whether two
equivalent 15s orbits are fair but repetitive, and whether the conclusion is
strong enough after 40s of subject-view time.

### DIRN-11 control

Current: `19s`, with Helsinki and Stockholm at `5s HOLD` each and `9s` travel.
It is a useful simple comparison control and was not changed.

## Policy diagnostics added

The existing director audit now emits explainable warnings, without failing or
rewriting a plan:

- `travel_dominance`: connective-looking travel is at least 65% of runtime;
- `repeated_equivalent_grammar`: matched comparison beats repeat the same long
  grammar and duration;
- `weak_conclusion_emphasis`: the terminal conclusion is less than half the
  longest preceding subject-view beat.

These are review prompts, not universal limits. Explanatory travel can justify
a high share, and explicit user duration/grammar remains authoritative.

## Human A/B gate

The minimum useful review set is:

1. DIRN-18 current 39s vs the 21s controlled candidate — does the direct move
   need its long readability floor, or is the explicit direct shape itself the
   wrong editorial choice?
2. DIRN-07 current 32s vs a compressed crossing candidate — does the transit
   teach geography before attention drifts?
3. DIRN-17 current 68s vs a shorter equal-parity comparison variant — do two
   15s orbits feel informative or mechanical, and does the conclusion land?
4. DIRN-14 current 46s — does the final return feel conclusive, and are the
   repeated holds meaningfully different?
5. DIRN-11 current 19s — control: do the matched holds already feel fair and
   sufficiently informative?

No real A/B imports were completed in this pass because the authenticated Earth
Studio profile was actively occupied by concurrent capture jobs. The candidate
durations above are deterministic internal controls, not visual approvals.

## Classification

The current evidence does not show a compiler or camera-execution failure:
existing real imports and sequence audits preserve the plans. The remaining
issues are directorial review questions, with one technical interaction exposed
by DIRN-18: an explicit direct grammar has a long readability floor at the
selected framing altitude. Further policy work should wait for the human A/B
decision rather than silently overriding explicit intent.
