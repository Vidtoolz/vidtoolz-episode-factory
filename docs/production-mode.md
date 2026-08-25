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

Status: **BLOCKED — provider missing.** No audio has been produced and no
placeholder exists.

What it would be, when it exists: machine-generated speech representing the
canonical script, adequate for a temporary draft VO, for Scorecraft's ducking and
timing, and as the audio component of DRAFT proxy capture. What it would never be:
Mikko's performance, production capture, or final mix. That distinction has to
live in provenance, not in a filename.

Two independent blockers, both verified rather than assumed:

**1. No TTS producer.** Nothing in the repository synthesizes speech. On this
machine `libespeak-ng1`, `espeak-ng-data` and the `sd_espeak-ng` module are
installed as *libraries*, but neither package ships a CLI and no `espeak-ng`,
`piper`, `flite` or `festival` executable exists under `/usr/bin`,
`/usr/local/bin` or `/opt`. `spd-say` is present but is a speech-dispatcher
client: it speaks to an audio device and has no file output. No Python TTS package
is importable. The ComfyUI registry contains no audio node, and the compute
registry provisions a `music_generation` lane but **no speech lane at all**.
MiniMax is music-caption only and unapproved. Scorecraft consumes narration
timing; it never produces speech. `ffmpeg`/`ffprobe` are present, so validation is
not the blocker.

The smallest unblock is `espeak-ng` (~4 MB; its library and voice data are already
installed, only the binary is missing) — robotic but fully intelligible, which is
all a draft VO needs. `piper` is the better-quality option at ~60–120 MB. Both are
local and free. Installing either is a dependency change, which is approval-gated
in this workspace.

**2. `AUDIO_RENDER` cannot express draft fidelity.** Even with real speech bytes,
the existing attestation path has nowhere truthful to record what they are. The
adapter raises `AUDIO_NOT_PRODUCTION_READY` for any state other than
`PRODUCTION_READY`, so draft narration would have to claim production readiness or
omit state and attest nothing. It has no `fidelity`, `source_class` or `mix_kind`
field, and it attributes defects to `sound_music_director` rather than the
`generation_supervisor` that would render a draft. `EVIDENCE_CLASSES`
(`DETERMINISTIC | SPECIALIST | HUMAN | UNVERIFIED`) is a verification-provenance
axis and cannot express proxy versus real.

The fix is a distinct typed evidence kind, `DRAFT_SYNTHETIC_NARRATION`, with its
own QC adapter — the way `CAMERA_QUALITY` and `AUDIO_RENDER` are already separate.
Overloading `AUDIO_RENDER` is how proxy audio would eventually be mistaken for a
production mix.

Once narration exists, the honest DRAFT state is `PROXY_AUDIO_READY` plus
`PROXY_VISUAL_MISSING`, and gate 8 stays blocked. Narration alone is not a
presenter.

## Implementation status

- **IMPLEMENTED** — the run-mode contract, its transitions and authority rules;
  the declarative gate/mode policy; mode exposure in `package-run-state`;
  mode-aware ownership and mode-aware human-requirement resolution through one
  shared authority; the `PROXY_CAPTURE_READY` evidence contract as a definition.
- **PLANNED** — gate 7 in `PRODUCTION`, pending `presenter_director`
  (contract `PLANNED`, `NOT_PROVEN`, dispatch `DISABLED`).
- **BLOCKED** — gate 7 and gate 8 in `DRAFT`, on a missing producer and nothing
  else. The evidence contract exists; the synthetic narration and proxy presenter
  producers that would attest it do not.

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
