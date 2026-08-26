# Draft Assembly V0

Draft Assembly V0 is the path that turns an approved script, generated
narration, bound visual assets and a bound music bed into **one watchable MP4**,
automatically.

It exists because the estate could previously plan an episode, generate every
asset, verify each one, and still have nothing anybody could watch. Gate 9
(rough-cut review) had nothing to review: Editor V1 is explicit that it *never
renders media*, Edit Plan V1 is a timeline authority with no renderer beneath
it, and every route to a rough cut ended with a human opening Resolve.

## What a Draft V1 is, and is not

A Draft V1 **is** a deterministic assembly of already-verified assets, laid out
on the narration's own measured timing. It is adequate for judging story,
pacing, visual support, section length, and whether the music helps or fights
the words.

A Draft V1 is **not**, and is never recorded as: an edit, an approved rough cut,
a production cut, a mix, a colour pass, a Resolve timeline, or anything
publishable. It speaks DRAFT synthetic proxy narration and inherits every
boundary that narration already declares.

**A rendered Draft V1 does not complete gate 9. It makes gate 9 actionable.**
The gate still closes on Mikko's rough-cut watch notes.

## Ownership

The narration lane already had to separate these; assembly has the same hazard.

| Role | Who |
| --- | --- |
| Semantic producer | `editor` — the agent that owns gate 9 |
| Technical producer | `ffmpeg-draft-assembler v0` |
| Attester | `scripts/package-run-draft-assembly.js`, deterministically |

## Design principle

Intentionally boring: deterministic, inspectable, recoverable, file-based,
manifest-driven, ffmpeg-native. There is no visual director, no pacing
intelligence, no NLE, and no generative step anywhere in the assembler.

## The pieces

| File | Responsibility |
| --- | --- |
| `scripts/draft-assembly-binding.js` | The V0 input contract. Records which visuals and which music this run assembles from, hash-bound to their owning roots. |
| `scripts/draft-assembly-timeline.js` | Pure, deterministic plan: narration spine in, ordered segments out. No filesystem, no ffmpeg, no clock. |
| `scripts/draft-assembly-render.js` | ffmpeg renderer and ffprobe validator. Two-stage so it can resume. |
| `scripts/package-run-draft-assembly.js` | Eligibility, orchestration, manifest, typed evidence, run state, CLI. |
| `scripts/draft-review-intake.js` | Minimal typed place for what Mikko says about the draft. |

## Input contract

`draft-assembly-binding.json` lives in the package run and is modelled directly
on `story-binding.json`: the run stores a **reference plus the byte hashes seen
at bind time**, never a copy. Resolution re-reads and re-hashes every asset, so
a regenerated image, a swapped mix or a deleted clip is *drift*, not a silently
different draft.

Visual sources (`source_kind`):

- `AIGEN_RESOLVE_HANDOFF` — `<package>/resolve-handoff/media-manifest.json`, the
  ordered generated-clip list an aigen package already publishes.
- `AIGEN_SELECTED_IMAGES` — `<package>/selected-images.json`, human-selected stills.
- `EXPLICIT_ASSETS` — an ordered list of absolute paths. The escape hatch for
  media the aigen lane does not own (Earth Studio renders, manual imports,
  screen capture). Still hashed, still re-verified.

Music sources:

- `SCORECRAFT_APPROVED_MIX` — a score project's `approved/` directory. The
  `dialogue_safe` variant is the default. **`approved/provenance.json` is
  required**: an unprovenanced mix is not an approved mix, and binding refuses it.
- `EXPLICIT_ASSET` — a path to an already accepted audio file.

Policy fields, with their deliberately conservative defaults:

| Field | Default | Meaning |
| --- | --- | --- |
| `visual_shortfall` | `FAIL` | Fewer visuals than narrated sections is an error. `CYCLE` permits reuse and records every reused segment as a warning. |
| `transition` | `CUT` | `CROSSFADE` renders each segment one crossfade longer so the narration spine is preserved. |
| `fit` | `FIT` | Scale inside the frame and pad. `COVER` fills the frame and crops. |
| `music_gain_db` | `-14` | Fixed attenuation under narration. Not ducking, not a mix. |
| `review_slate` | `true` | Burn the DRAFT notice, section marker and timecode into every frame. |

## The timeline

**The spine is the narration, and nothing else.** Every duration comes from a
measured narration segment, in Story order. Nothing invents pacing or guesses a
shot length — so when Mikko thinks a section drags, the section really is that
long, because the words take that long to say.

- Shot assignment is positional: narrated section *N* takes visual *N*. A V0
  draft that guessed which shot belongs to which beat would be presenting a
  machine's editorial opinion as a plan.
- Fill is measured, not assumed: `TRIM` (source long enough), `LOOP` (motion
  source shorter than its slot), `HOLD` (still image).
- A Story section carrying no dialogue occupies no draft time, and says so.
- Frame geometry comes from the Story's `output_class`, or from an explicit
  `output` in the binding. It is never guessed from the media: letting a stray
  vertical clip redefine the episode shape is exactly the failure to avoid.
- Everything that will be visible but was not chosen — a reused shot, a looped
  clip, an orientation mismatch, a silent section, a looped music bed — becomes
  a recorded `warning` in the plan and the manifest.

## Rendering

Two stages, for recovery rather than elegance:

1. **Segments.** Each segment becomes its own normalized, silent MP4 under
   `media/draft-assembly/work/`. The filename carries the digest of the inputs
   that produced it, so an interrupted run resumes: matching segments are reused
   untouched, and a segment whose inputs changed simply has a different name.
2. **Join and mux.** `CUT` concatenates without re-encoding video.
   Narration plays at unity, music is attenuated by the planned gain, the two
   are summed and passed through a limiter at −1 dBFS.

Everything is written to a `.part` file and renamed only *after* it validates,
so an interrupted render can never leave a file that looks finished.

The audio path is deliberately **not a mix**: no ducking, no EQ, no compression
beyond the safety limiter, no loudness target. It exists so a reviewer can hear
whether the music helps or fights the words — a judgement a real mix would then
have to earn separately.

### The review slate

Burned into every frame by default: a standing `DRAFT - NOT FOR PUBLICATION`
notice, the section position and beat name (`4/7 Evidence`), and a running
timecode a review note can cite. A reviewer asked "is section 3 too long?"
cannot answer without knowing where section 3 starts, and a file that leaves the
run must not be able to pass for a finished cut.

## Validation

After rendering, before the file is allowed to take the draft's name:

- exists, non-zero, decodable
- expected resolution, frame rate, and audio sample rate
- a video stream, an audio stream, and more than zero frames
- duration within tolerance of the narration spine
- a **full decode pass** (`ffmpeg -xerror -f null -`), which catches a truncated
  or corrupt stream that still probes cleanly

A render that fails validation is deleted, and the run state records `FAILED`.

## Recovery and idempotency

| State | Meaning |
| --- | --- |
| `PLANNED` / `RENDERING` | Not watchable. |
| `COMPLETE` | A validated file exists at the recorded path. |
| `FAILED` | An attempt was made and did not produce a usable draft. |

- Rerunning an unchanged assembly whose output still validates **reuses** it.
- A changed plan renders a **new version** (`draft-v2.mp4`) rather than
  overwriting one somebody may be reviewing. `draft-assembly-state.json` keeps
  the completed history.
- Staleness is detected by re-verification, never by mtime: a re-narrated
  script, a changed bound asset, an edited plan or a mutated byte all make the
  existing draft `INVALID`, with the reason named.
- `draft-assembly.json` always describes **the current draft**, so switching a
  binding back to an earlier configuration re-renders that version rather than
  adopting the old file. Segment reuse makes that cheap, and the render is
  deterministic enough that the bytes come back identical.

## Artifacts

| File | What it is |
| --- | --- |
| `draft-assembly-binding.json` | Input contract: which assets, which policy. |
| `draft-assembly-plan.json` | The deterministic timeline and its digest. |
| `draft-assembly-state.json` | Attempt state and completed-version history. |
| `draft-assembly.json` | The assembly manifest — enough to reconstruct exactly what was used without reading a terminal. |
| `draft-assembly-evidence.json` | Typed `DRAFT_ASSEMBLY` evidence, re-verified from bytes. |
| `media/draft-assembly/draft-v{N}.mp4` | The watchable draft. |
| `media/draft-assembly/work/` | Per-segment work products, for resume. |
| `draft-review/*.json` | Recorded reviews. |

## Eligibility — the predecessor handoff

Every condition is owned by something else. Assembly invents no approval of its
own and cannot pass a run the lifecycle has not already carried this far.

### Required predecessor state

Draft Assembly runs only after **gate 8 has reached `PROXY_CAPTURE_READY`**.
That disposition is the seam, and it is not a Draft Assembly concept:

| Question | Authority | Module |
| --- | --- | --- |
| Is this a DRAFT run? | production mode | `scripts/package-run-production-mode.js` |
| Which Story does this run own? | story binding | `scripts/package-run-story-binding.js` |
| Is the proxy voice verified and still bound to that Story? | `DRAFT_SYNTHETIC_NARRATION` | `scripts/package-run-draft-narration.js` |
| Is the proxy presenter verified? | `PROXY_PRESENTER` | `scripts/package-run-draft-proxy-presenter.js` |
| **Is gate-8 proxy capture ready as a whole?** | **`PROXY_CAPTURE_READY`** | **`scripts/draft-proxy-capture-readiness.js`** |
| Do the bound visuals and music still hash as recorded? | draft assembly binding | `scripts/draft-assembly-binding.js` |

`PROXY_CAPTURE_READY` is emitted by `draftProxyCaptureReadiness()` and is the
**single** readiness constant for this seam. Draft Assembly imports that module
and compares against `proxyCapture.CAPTURE_READY`; it does not define a second
constant, re-derive the answer, or accept narration alone. The same relationship
is recorded as data in `config/gate-mode-policy.json` under
`gates["rough-cut-review"].modes.DRAFT`, as
`required_predecessor_disposition` and `required_predecessor_authority`.

### How assembly validates it

`assemblyEligibility(runDir)` asks each authority above in turn and returns a
report with an explicit `blockers` array. Nothing is inferred from the presence
of a file.

### Expected failure when readiness is absent

Assembly refuses and names which half is missing, for example:

- no narration → `no draft narration has been produced; there is no timing spine to assemble on`
- narration only, no proxy presenter → `gate 8 proxy capture is not ready (PROXY_VISUAL_MISSING); assembly may not run ahead of capture`
- narration re-rendered after binding → `draft narration is not valid (NARRATION_SCRIPT_DRIFT): …`
- no binding → `no draft-assembly-binding.json; nothing declares which visuals and music this draft uses`

`buildAssemblyPlan` throws `DRAFT_ASSEMBLY_NOT_ELIGIBLE` carrying the whole
report, so a caller never has to guess which condition failed.

### Why rendering a draft does not advance the human gate

Gate 9 exists so that a person watches the cut. Producing the thing to be
watched is the machine's half; watching it is not. `DRAFT_ASSEMBLY` evidence
therefore carries `completes_rough_cut_gate: false` and
`human_authority_required: true`, the gate policy carries
`satisfies_gate: false`, and the run-state projection reports
`review_can_begin` separately from any gate status. Gate 9's completion rules —
real watch notes plus a second-cut readiness marker — are unchanged by this
work.

### Story approval

The Story's approval state is **recorded**, not enforced: DRAFT mode exists
precisely so an unapproved script can be seen before it is approved. Anyone
reading the manifest can see exactly what the script's approval state was.

## Usage

```sh
# 1. declare what the draft is made of
node scripts/package-run-draft-assembly.js bind package-runs/<run-id> \
  --visual-kind AIGEN_RESOLVE_HANDOFF \
  --visual-package /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/<package> \
  --music-project /home/vidtoolz/vidtoolz-score-projects/projects/<score-project> \
  --bound-by mikko

# 2. check eligibility without doing anything
node scripts/package-run-draft-assembly.js status package-runs/<run-id>

# 3. render and attest
node scripts/package-run-draft-assembly.js build package-runs/<run-id>

# 4. record what you thought of it
node scripts/draft-review-intake.js open package-runs/<run-id> --reviewer mikko
node scripts/draft-review-intake.js note package-runs/<run-id> --review-id <id> \
  --at 1:12 --disposition CUT --comment "this beat drags"
node scripts/draft-review-intake.js rate package-runs/<run-id> --review-id <id> --axis pacing --score 3
node scripts/draft-review-intake.js submit package-runs/<run-id> --review-id <id> --comment "structure holds"
```

## Review intake

`scripts/draft-review-intake.js` records a human review of one assembled draft.
Its shape is not invented: the First Real Production Run had to hand-author a
`vidtoolz.frr.humanReview.v1` wrapper because the first version of this module
could hold only notes and ratings. Every field that wrapper needed is now native.

| Field | What it holds |
| --- | --- |
| `reviewer_authority` / `recorded_by` | who judged, and separately who wrote it down |
| `draft_verdict` | the whole-draft verdict (`KEEP`/`CHANGE`/`CUT`/`REWRITE`) |
| `notes[]` | timestamped, per-section, with disposition and optional `target_domain` |
| `ratings` | seven axes, **integers 1–10**, or absent |
| `rating_scale` | self-describing, so a consumer never infers the scale |
| `overall_comment` | freeform judgement |
| `approvals.research` / `approvals.script` | the reviewer's declaration, **not** the canonical markers |
| `completion_status` | `OPEN` / `SUBMITTED` |
| `binding_digest_sha256` | digest over the immutable identity, so later edits are detectable |

### The rating scale is 1–10

Integers, minimum 1, maximum 10. This is the estate's existing judgement scale —
`scripts/daily-idea-scout.js` and the topic scout both validate 1–10 — not a new
one. An earlier revision of this module used 1–5, which had no authority behind
it and which forced the First Real Production Run to record `ratings_1_to_10` in
a wrapper of its own.

There is **no rescaling anywhere**: no normalisation into another range, no
percentage conversion, and no default. An unrated axis stays `null`; clearing a
rating restores `null` rather than writing a zero. An out-of-range value is
refused with an error naming the valid range.

### Raw text stays raw

Comments are stored exactly as given. Over-long input is **refused**, never
truncated — a trimmed note is a rewritten note.

### Lifecycle, computed and never stored

A review file records what was said, and what was said does not change when a
new draft appears. `reviewStatus()` reports one of:

| Lifecycle | Meaning |
| --- | --- |
| `ACTIVE` | bound to the draft the run currently holds |
| `SUPERSEDED` | the run moved to a different draft **version** |
| `STALE_FOR_CURRENT_DRAFT` | same version, different bytes (re-rendered), or no valid current draft |

The stored review is never rewritten and remains historically valid for the
draft it was made against. A new draft requires a new review.

### Input for a V1→V2 revision plan

`revisionPlanInput(runDir, reviewId)` exposes, per assembled section: section id,
beat, segment order, start/end, the predecessor draft version and hash, the
predecessor visual asset id and hash, the decisions attached, any target domains,
and the raw notes.

It reports one of three `feedback_state` values, and the distinction is the
whole point:

- `EXPLICIT_KEEP` — the reviewer accepted this section. A V2 must **preserve**
  it rather than regenerate it.
- `CHANGE_REQUESTED` — something was asked for here.
- `NO_FEEDBACK` — nobody mentioned it. **Not the same as KEEP.**

This function chooses nothing. It does not decide what to regenerate, rank
changes, or interpret free text — that is a revision planner's job, and V0 does
not contain one.

Recording a review is **input to gate 9, never its completion**.

## Gate integration

`config/gate-mode-policy.json` now governs `rough-cut-review` (gate 9):

- **DRAFT** — machine owner `editor`, technical producer
  `ffmpeg-draft-assembler v0`, disposition `DRAFT_ASSEMBLY_READY`,
  `human_approval_required: true`, `satisfies_gate: false`.
- **PRODUCTION** — `PLANNED`. A production rough cut is a real edit of real
  captured material, assembled by Mikko in an NLE. Resolve automation is
  deliberately out of scope, and nothing in the DRAFT assembler may stand in
  for it.

`scripts/package-run-state-projection.js` reports a `draft_assembly` block:
whether inputs exist, whether assembly is eligible, the render state, where
Draft V1 is, and whether review can begin. It is strictly additive and strictly
read-only — it never changes a gate status, and runs with no draft-assembly
artifacts project exactly as they always did.

## QC integration

`DRAFT_ASSEMBLY` is a first-class QC evidence kind, registered the same way
`DRAFT_SYNTHETIC_NARRATION` was:

- `scripts/qc-evidence-policy.js` declares it `MODE_REQUIRED` for DRAFT/REVIEW,
  earliest gate `rough-cut-review`, producer `editor`.
- `scripts/qc-director.js` carries a `draftAssemblyAdapter` in the adapter table.

QC consumes the typed envelope directly — no wrapper needed. It verifies the
kind, the `VERIFIED` state, that the rendered draft identifies itself by sha256,
the recorded technical validation, the full-decode result, and source binding;
assembler warnings travel through as QC warnings. It never re-renders and never
infers edit quality. A verified draft sets `human_review_required: true`, because
a verified draft is precisely the point at which a person must watch it.

Deliberately **not** `GENERATION_RESULT`: that kind means generated source media,
and wrapping an assembled draft in it would claim the draft is another generated
asset rather than the assembly *of* those assets. The `GENERATION_RESULT` path is
untouched.

## Known limitations

These are limitations of V0, not defects, and none of them are hidden from the
manifest:

- **Narration quality is unjudged.** Piper produces intelligible machine speech
  adequate for structural review. It is not approved for anything, and it is
  not Mikko.
- **Shot assignment is positional.** It carries no editorial intent. Whether a
  shot supports its beat is a human judgement the draft makes visible, not one
  it makes.
- **Stills are held, not moved.** No Ken Burns, no motion on stills.
- **Looped clips are visibly looped.** A 2.7-second generated clip under a
  20-second beat repeats, and the manifest says so.
- **The audio is a sum, not a mix.** No ducking, no loudness target.
- **Edit quality is not asserted.** There is no edit grammar, no J/L cuts, no
  pacing intelligence.
- **No Resolve project is created, opened, or controlled.**
- **Beat names are only as good as the Story.** The draft shows the beat name
  the canonical Story carries. If a Story was registered from a flat script its
  beats may read `Source script paragraph 07`, and the draft shows exactly that.
  When a Story carries no beat at all the slate shows the position only
  (`7/11`) and the plan records a `SECTION_BEAT_UNNAMED` warning — a section id
  is an identifier, and the draft will not dress one up as editorial
  information. Better beat names are a Story-registration improvement, not a
  Draft Assembly one.
