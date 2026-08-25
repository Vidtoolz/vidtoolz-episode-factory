# Audio Evidence: Three Orthogonal Axes

Audio evidence in the 12-Agent Production System answers three separate
questions. They must never be conflated — collapsing any two is semantic
corruption:

1. **Evidence kind** — WHAT is this artifact?
   (`AUDIO_RENDER`, `DRAFT_SYNTHETIC_NARRATION`, ...)
2. **Render class / fidelity** — at WHAT PRODUCTION LEVEL is this audio valid?
   (the canonical `RENDER_CLASSES` vocabulary)
3. **Source / producer** — WHO/HOW was it produced?
   (`sound_music_director`, `generation_supervisor`, deterministic attester...)

Examples of correct separation:

```
DRAFT_SYNTHETIC_NARRATION  +  DRAFT_SYNTHETIC_PROXY        (own fidelity axis)
AUDIO_RENDER               +  MUSIC_CANDIDATE
AUDIO_RENDER               +  DRAFT_TEMPORARY
AUDIO_RENDER               +  PRODUCTION_MIX
```

`DRAFT_SYNTHETIC_NARRATION` is a distinct kind. It is never `AUDIO_RENDER`.
Its fidelity is declared by its producer and does not participate in the
AUDIO_RENDER render-class vocabulary.

## Canonical render-class vocabulary (AUDIO_RENDER kind)

Declared once in `scripts/qc-evidence-policy.js` (`RENDER_CLASSES`). Classes
are semantic branches, NOT a quality ordering — a music candidate is not a
lower-grade production mix. Compatibility is encoded per requirement, not
ranked.

| Class | Meaning | Authorized producers | Proves | Explicitly does NOT prove |
|---|---|---|---|---|
| `MUSIC_CANDIDATE` | Scorecraft music-lane candidate render (production.wav of a completed candidate) | `sound_music_director` | a real music render exists, is technically valid, carries complete generation provenance | final program mix; dialogue/narration; human performance; publication approval |
| `DRAFT_TEMPORARY` | draft-grade temporary audio attested under AUDIO_RENDER | `sound_music_director` | a technically valid temporary render exists for DRAFT use | production readiness; final mix; human performance; publication approval |
| `PRODUCTION_MIX` | final program mix (dialogue + music + effects) at production fidelity | **none (declared gap)** | the complete production program audio exists and is technically valid | human performance; capture evidence; publication approval |

### PRODUCTION_MIX producer gap (declared, not relaxed)

No final program-mix render path exists yet. That is recorded as
`KNOWN_CLASS_GAPS.PRODUCTION_MIX = { status: 'PRODUCER_MISSING' }`. The
Sound & Music Director attester must never impersonate a final mix engine:
`producerAuthorizedForClass` rejects every producer for `PRODUCTION_MIX`
until a legitimate program-mix path lands and is declared authorized. The
fidelity invariant treats a declared gap as honest, and an unexplained
producer-less class requirement as a violation.

## Schema versioning

- AUDIO_RENDER evidence schema_version 1 (legacy): proven render attestation,
  no fidelity class. Remains readable and technically valid as history.
- schema_version 2: adds `render_class` from the canonical vocabulary,
  validated and producer-authorized at attestation. A class-sensitive QC
  requirement can only be satisfied by v2 evidence carrying the required
  class.

Legacy v1 evidence never satisfies a class-sensitive requirement: QC reports
`AUDIO_RENDER_CLASS_UNKNOWN` and directs a re-attestation, never a silent
promotion.

## QC enforcement

QC Director consumes the fidelity contract at the required-evidence level:

- `AUDIO_RENDER_CLASS_INSUFFICIENT` — evidence satisfies the kind but carries
  a weaker/different class than the requirement (e.g. `MUSIC_CANDIDATE` vs
  required `PRODUCTION_MIX`).
- `AUDIO_RENDER_CLASS_UNKNOWN` — legacy class-less evidence against a
  class-sensitive requirement.

The adapter additionally re-checks (v2 payloads) that the claimed class is
canonical and the producing identity is authorized — a hand-edited file
cannot smuggle a free-text or unauthorized class.

The applicability policy row `AUDIO_RENDER.required_render_class =
PRODUCTION_MIX` ties the PRODUCTION-mode requirement to the class.
DRAFT/REVIEW do not require AUDIO_RENDER; DRAFT audio is handled by the
narration kind (or is advisory), never by a fake final-audio requirement.

## Invariants

1. Every class-sensitive QC audio requirement names a canonical render class.
2. Every such class has an authorized producer OR is an explicitly declared
   known gap.
3. No render class ever asserts human performance, capture evidence, or
   publication approval.
4. Mode switches never mutate `render_class` of existing evidence.
