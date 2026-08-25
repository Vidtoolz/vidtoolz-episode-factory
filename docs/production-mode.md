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

| mode | status | expected owner | next specialist | human performer | disposition |
| --- | --- | --- | --- | --- | --- |
| `DRAFT` | **BLOCKED** | `generation_supervisor` | — | — | `PROXY_CAPTURE_REQUIRED` |
| `REVIEW` | IMPLEMENTED | — (not re-entered) | — | — | `REUSE_PRIOR_CAPTURE` |
| `PRODUCTION` | **PLANNED** | `production_operations` | `presenter_director` | `mikko` | `REAL_CAPTURE_REQUIRED` |
| `MODE_UNSPECIFIED` | fails closed | none reported | — | — | — |

Ownership resolves through one authority, `resolveGateOwner(gateId, mode)` in
`scripts/gate-mode-policy.js`. Every consumer shares it, so `package-run-state`,
the control room and next-safe-action cannot disagree. An undeclared mode reports
**no** owner rather than a possibly-false one.

`owner_actionable` is tracked separately from having an owner: an enabled, proven
agent named against a gate whose inputs do not exist is not an actionable gate.

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

| mode | status | expected owner | human required | required disposition |
| --- | --- | --- | --- | --- |
| `DRAFT` | **BLOCKED** | `qc_director` | **no** | `PROXY_CAPTURE_READY` |
| `REVIEW` | IMPLEMENTED | — | no | `REUSE_PRIOR_CAPTURE` |
| `PRODUCTION` | IMPLEMENTED | `qc_director` | **yes** (`mikko`) | `REAL_CAPTURE_CONFIRMED` |

**Draft Mode is not "stop before the human gate" — it is "finish the automatic
draft without needing the human".** So DRAFT does not end before gate 8. It
crosses gate 8 on machine-verifiable proxy evidence, and the human marker is
*forbidden* there rather than required. The static `HUMAN_GATES` annotation still
lists gate 8, but a resolvable mode answer now wins over it, so a zero-human draft
is never told Mikko is needed.

`PROXY_CAPTURE_READY` and `REAL_CAPTURE_CONFIRMED` are permanently distinct
semantic classes; neither is derivable from the other, and a run's history always
shows which one it crossed. Proxy media may never be recorded as a physical take
or relabelled as real capture. The contract is
`config/proxy-capture-evidence-contract.json`.

Gate 8 reaches `PASS` only with an exact human approval marker recorded after
real capture evidence, and it explicitly refuses rows marked `dummy`,
`smoke-test`, `test-capture`, `test-screen`, `test-voiceover` or
`generated checklist row`. Synthetic capture cannot be presented as capture.

## Review entry and Production promotion

A DRAFT runs through gate 8 on proxy evidence; the lifecycle then reaches gate 9
`rough-cut-review`, which is the **first mandatory Mikko boundary**. Switching
`DRAFT -> REVIEW` triggers no recapture and does not move the gate. No fifteenth
gate was invented to hold Review Mode.

Promotion `REVIEW -> PRODUCTION` is Mikko's alone and means real performance is
now required. DRAFT proxy capture stays **historical evidence** and does not
satisfy PRODUCTION capture policy, so a run promoted with only proxy capture no
longer satisfies the capture gates and the canonical lifecycle reopens them.
Rough-cut and review artifacts are retained as provenance from the approved
draft — the same regression semantics gate 6 already uses for a superseded
approval.

## Human authority boundaries

- **Mikko** owns promotion into `PRODUCTION`, the physical performance itself, and
  the gate-8 confirmation that the captured material is what was intended.
- **`production_operations`** prepares capture bookkeeping.
- **`presenter_director`** owns delivery direction, take requirements and
  best-take proposals — proposals only; it never selects.
- **`editor`** consumes coverage gaps downstream and is barred from take
  selection.

## Synthetic narration (DRAFT proxy audio)

Status: **IMPLEMENTED**, at DRAFT fidelity.

Piper is not the Draft presenter. It is the Draft presenter's *voice*.

| | |
| --- | --- |
| provider | Piper 1.7.0, local and offline, in a bounded venv at `~/vidtoolz-tools/piper` |
| voice | `en_US-lessac-medium`, one neutral synthetic narrator — **not Mikko**, not a clone |
| output | 48 kHz / 24-bit mono WAV, normalized from Piper's native 22.05 kHz via ffmpeg |
| location | `media/draft-narration/narration.wav` plus per-beat segments |
| manifest | `draft-narration.json` (`vidtoolz.syntheticNarration.v1`) |
| evidence | `DRAFT_SYNTHETIC_NARRATION` in `draft-synthetic-narration-evidence.json` |
| owner | `generation_supervisor`, action `generate_draft_narration` |
| speed | roughly 7 s of compute for 75 s of narration |

Neither the binary nor the voice model is committed to the repository.

**What it is sufficient for:** a temporary Draft VO, Scorecraft ducking and
timing, and the audio component of DRAFT proxy capture.

**What it is not, and the evidence says so in typed fields:** Mikko's
performance, real presenter capture, production audio, a final mix, or
publish-ready sound. `satisfies_real_capture` is `false` and
`human_authority_required` is `false`.

`AUDIO_RENDER` was deliberately **not** reused. It demands
`state: PRODUCTION_READY`, has no fidelity field, and attributes to
`sound_music_director` — so a draft proxy could only be recorded there by lying.
`DRAFT_SYNTHETIC_NARRATION` is its own kind, the way `CAMERA_QUALITY` and
`AUDIO_RENDER` are already separate.

Narration is bound to the exact Story version and content hash. A script change
makes it stale (`NARRATION_SCRIPT_DRIFT`); mutated bytes make it invalid
(`NARRATION_AUDIO_INVALID`). It is DRAFT-only: `MODE_UNSPECIFIED`, `REVIEW` and
`PRODUCTION` all refuse to generate it, and `REVIEW` reuses what the Draft
produced without regenerating.

Piper is not bit-deterministic, and that is not claimed. The *request* digest is
stable for the same script, voice and configuration; the resulting bytes are
recorded as measured.

**QC registration is pending.** `DRAFT_SYNTHETIC_NARRATION` was not added to
`qc-director.js` `SUPPORTED_EVIDENCE_KINDS` because that file is being modified
by another session's mode-aware QC work. The evidence is self-describing so that
policy can consume it without further changes here.

## Proxy presenter (DRAFT visible speaker)

Status: **IMPLEMENTED**, at DRAFT fidelity.

The Draft presenter is a stick figure, on purpose.

| | |
| --- | --- |
| renderer | `ffmpeg-stickman v1` — ffmpeg `lavfi` + `drawbox`/`drawtext`, local, no GPU |
| style | `STICK_FIGURE_SILHOUETTE`, with `PROXY PRESENTER — NOT FINAL` burned into every frame |
| motion | `DETERMINISTIC_IDLE_SINE` — declared heuristic |
| lip sync | `NONE`, and none is claimed |
| video | 30 fps h264 `yuv420p`; frame shape from the Story's own `output_class` |
| location | `media/draft-proxy-presenter/proxy-presenter.mp4` plus per-beat segments |
| manifest | `draft-proxy-presenter.json` (`vidtoolz.proxyPresenter.v1`) |
| evidence | `PROXY_PRESENTER` in `draft-proxy-presenter-evidence.json` |
| track role | `PROXY_PRESENTER` — never final A-roll |
| owner | `generation_supervisor`, action `generate_draft_proxy_presenter` |
| speed | ~22x realtime (74 s of video in 3.4 s, 279 KB) |

A generative video model was deliberately **not** used. A Draft has to be
producible for every run, cheaply, with exact beat alignment — so determinism,
speed and reliability beat realism. Photorealism would actively hurt: the proxy
must look like a placeholder.

Narration stays the audio authority. The presenter track is silent and is paired
downstream; speech is never re-encoded or regenerated here. Timing is not
invented either: every segment is cut to the measured duration of the narration
beat it covers, and total drift is checked against a one-frame-ish tolerance.

`PRESENTER_A_ROLL` keeps its capture-class meaning — still absent from the
generation lane, still mapped to `PRESENTER_CAPTURE`. The Draft substitute is a
**distinct artifact type**, not a new fidelity on a capture class, so the final
edit can replace it when Mikko actually performs without either ever having been
confused for the other.

### Proxy capture

```
audio   PROXY_AUDIO_READY      DRAFT_SYNTHETIC_NARRATION
visual  PROXY_VISUAL_READY     PROXY_PRESENTER
-----------------------------------------------------
        PROXY_CAPTURE_READY = true      (no human involved)
```

Either component going stale takes the whole thing down: a Story revision stales
both, mutated bytes invalidate their own component, and narration changing after
the presenter was timed against it stales the presenter.

## Draft capture, end to end

DRAFT capture is now complete and machine-verifiable:

```
canonical script
  -> synthetic narration        (Piper)            DRAFT_SYNTHETIC_NARRATION
  -> proxy presenter            (ffmpeg-stickman)  PROXY_PRESENTER
  -> proxy capture aggregate                       PROXY_CAPTURE_READY
  -> gate-7 capture-artifact materialization       five canonical artifacts
  -> gate 7 READY FOR ROUGH CUT                    no human
  -> gate 8 PASS                                   no human, no marker
  -> gate 9 rough-cut-review                       Mikko's first real boundary
```

`scripts/draft-proxy-capture-materializer.js` projects the proxy evidence into
`capture-checklist.md`, `takes-log.md`, `missing-shot-tracker.md`,
`screen-recording-checklist.md` and `audio-capture-checklist.md`, with
`proxy-capture-materialization.json` as the provenance sidecar and commit marker.
It is pure projection: no model call, no media generation, no judgement.

**Proxy work is written as proxy work.** Every takes-log row is marked
`PROXY_GENERATED` and "not a human take"; every audio row is marked
`DRAFT_SYNTHETIC` and states "not recorded presenter audio". No capture-readiness
approval marker is written in any artifact, because a DRAFT is zero-human. The
real-capture predicate was tightened to reject proxy and synthetic markers, so
these artifacts can never satisfy a PRODUCTION requirement — genuine human
capture rows still pass unchanged.

Gates 7 and 8 read the machine proxy disposition in DRAFT and REVIEW; PRODUCTION
still means real capture preparation and real captured evidence with human
confirmation. Promoting a reviewed Draft to PRODUCTION reopens the capture gates
and keeps the proxy evidence as provenance. A script revision or a mutated byte
stales the materialization and reopens gates 7 and 8 together — completion is
never inherited.

**Gate 9 is where it stops, and that is correct** — it is Mikko's first mandatory
review boundary. But it is not yet *review-ready*: there is nothing assembled to
watch. No automatic rough-cut assembler exists (`edit-plan.js` is a typed schema
module, not a renderer), so nothing muxes the proxy presenter video with the
narration audio into one watchable draft. That is the remaining capability.

## Implementation status

- **IMPLEMENTED** — the run-mode contract, its transitions and authority rules;
  the declarative gate/mode policy; mode exposure in `package-run-state`;
  mode-aware ownership and mode-aware human-requirement resolution through one
  shared authority; the `PROXY_CAPTURE_READY` evidence contract as a definition.
- **PLANNED** — gate 7 in `PRODUCTION`, pending `presenter_director`
  (contract `PLANNED`, `NOT_PROVEN`, dispatch `DISABLED`).
- **IMPLEMENTED** — DRAFT synthetic narration (Piper) and the DRAFT proxy
  presenter (ffmpeg), with their typed `DRAFT_SYNTHETIC_NARRATION` and
  `PROXY_PRESENTER` evidence, both dispatched through `generation_supervisor`.
  DRAFT proxy capture aggregates to `PROXY_CAPTURE_READY` with no human.
- **IMPLEMENTED** — DRAFT gate-7 capture-artifact materialization. A zero-human
  DRAFT now completes gates 7 and 8 on machine evidence and reaches gate 9.
- **BLOCKED** — gate 9 review-readiness, on one remaining capability: an
  automatic DRAFT rough-cut assembler. Capture is done; there is simply nothing
  assembled for Mikko to watch yet.
- **IMPLEMENTED** — the supervised-capture → presenter-take adapter. PRODUCTION
  capture is now machine-ready up to Mikko's performance, and a verified
  recording becomes a canonical presenter take with no human bookkeeping.

## PRODUCTION presenter capture

A verified human recording and a canonical presenter take used to be two
separate truths with nothing joining them. `supervised-capture.js` recorded and
verified real media and deliberately never touched package-run state;
`presenter-take-manifest.js` owned take identity and had no producer. So a
successful capture left the upstream audit still reporting
`REAL_PRESENTER_AUDIO_MISSING`. `scripts/supervised-presenter-take-adapter.js`
is that seam.

**Four acts, deliberately distinct — the adapter performs exactly one:**

| Act | Owner | Module |
|---|---|---|
| Verification | capture subsystem | `supervised-capture.js` — are these bytes a valid recording? |
| **Registration** | capture subsystem (deterministic) | **the adapter — is this recording a take of this unit, in this run?** |
| Selection | a verified human (Mikko) | `presenter-take-manifest.createHumanSelection` |
| Approval | the lifecycle gates | unchanged |

```
PRODUCTION run -> machine preflight -> READY_FOR_HUMAN_PERFORMANCE
              -> Mikko records            <-- only a human can do this
              -> capture verified -> take registered -> presenter source canonical
              -> REAL_PRESENTER_AUDIO_MISSING clears -> next: EDIT_PLAN_MISSING
```

`READY_FOR_HUMAN_PERFORMANCE` means the machine is ready and **nothing has been
recorded** (`media_recorded: false`, `takes_registered: 0`). It never reads as
capture complete.

**The run binding comes from the destination, not the sidecar.** The capture
sidecar carries no `run_id`, so the run declares its capture destination at
preflight and a recording belongs to the run because it was written where that
run said to write it. The alternative — teaching the capture tool about package
runs — would break the boundary that keeps it from mutating lifecycle state.

**Presenter audio is the take's own audio stream.** No extraction, no parallel
presenter-audio artifact, nothing for the Editor to reconcile. A silent capture
profile is refused at preflight rather than after Mikko has performed.

**Registration is not selection.** Every valid take is registered and none is
chosen; the adapter writes no recommendation and no human selection. Craft
judgement belongs to `presenter_director` (still `DISABLED`, pending Mikko's
explicit enablement) and the choice belongs to Mikko — `verifierValid` refuses an
`AGENT` selector and refuses any agent id posing as `HUMAN`.

**Registration is also not the end of the lane.** With a genuine human selection
in place, the Editor handoff still reports `TRANSCRIPT_OR_HUMAN_FIDELITY_REQUIRED`
and `FIDELITY_UNRESOLVED`: a take must be transcribed and its fidelity resolved
before the Editor can use it. None of that is fabricated.

One honest limit: because the sidecar records no media hash, byte mutation
between capture and *first* registration cannot be detected from the sidecar
alone. The adapter hashes what it registers, so every later change surfaces as
`PRESENTER_CAPTURE_MEDIA_DRIFT` — reported distinctly from
`PRESENTER_CAPTURE_ALREADY_REGISTERED`, because those are different facts.

Verified absent rather than assumed: a hard search across `*.js`, `*.json`,
`*.md`, `*.py` and `*.sh` found no TTS producer (the only MiniMax integration is
music-caption work, and Scorecraft's narration references duck music *under*
speech), and no avatar producer (every hit is prose in a checklist, a topic list,
or one text classifier). `PRESENTER_A_ROLL` is absent from the generation lane
**by design** — `edit-plan.js` maps it to the `PRESENTER_CAPTURE` source class
alongside `SCREEN_CAPTURE` and `ARCHIVAL_EXTERNAL`, which are captured or sourced,
never generated. Removing that exclusion would not create a producer; it would
only let the system claim one exists.

Nothing above is described as working because it is intended to.
