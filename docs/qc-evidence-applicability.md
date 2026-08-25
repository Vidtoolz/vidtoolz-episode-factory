# QC Required-Evidence Applicability Policy

QC's required-evidence question has two halves, and BOTH must be true before
absence becomes a blocker:

1. **Can production create this evidence?** — producer reachability
   (closed by the STORY_VALIDATION and AUDIO_RENDER missions).
2. **Is it required here, now, in this mode?** — applicability
   (this policy; `scripts/qc-evidence-policy.js`).

## The rule

A missing evidence artifact blocks QC only when all three hold:

1. the evidence has a legitimate producer;
2. the run has reached the point where it should exist
   (not before its earliest legitimate gate);
3. the run's production mode actually requires that semantic evidence.

Applicability is not an escape hatch: once applicable, absence still blocks
with QC_REQUIRED_EVIDENCE_MISSING.

## Applicability classes

| Class | Meaning |
|---|---|
| GLOBAL_REQUIRED | required at/after earliest gate in every declared mode |
| MODE_REQUIRED | required only in listed modes |
| GATE_REQUIRED | required only at/after earliest gate (mode-insensitive) |
| MODE_AND_GATE_REQUIRED | both dimensions apply |
| OPTIONAL_ADVISORY | useful, never blocking |
| HUMAN_EXTERNAL | human/external boundary evidence; consumed at explicit human gates; never a producer-less machine defect |

## Current policy rows

| Evidence | Class | Modes | Earliest gate | Producer |
|---|---|---|---|---|
| STORY_VALIDATION | MODE_AND_GATE_REQUIRED | all | research | story_validator |
| AUDIO_RENDER | MODE_REQUIRED | PRODUCTION | rough-cut-review | sound_music_director |
| CAMERA_QUALITY | GATE_REQUIRED | — | capture-evidence | camera_director |
| GENERATION_RESULT | GATE_REQUIRED | — | production-plan | generation_supervisor |
| EDIT_QC_HANDOFF | GATE_REQUIRED | — | rough-cut-review | editor |
| FINAL_CUT_APPROVAL | HUMAN_EXTERNAL | — | rough-cut-review | Mikko (human gate) |
| TITLE_THUMBNAIL_APPROVAL | HUMAN_EXTERNAL | — | publication-metadata | Mikko (human gate) |

## Fail-closed rules

- required kind with **no policy row** → QC_EVIDENCE_POLICY_VIOLATION
  (never guessed).
- mode-sensitive kind with **no declared mode** → QC_PRODUCTION_MODE_REQUIRED
  (QC reads a task-declared mode; it never sets, promotes, or guesses one).
- required kind **before its earliest legitimate gate** → NOT_APPLICABLE_YET
  (excluded from the missing list — production cannot legitimately have
  produced it yet); absence is correct, not a blocker.
- unknown `run_mode` value → QC_TASK_INVALID.

## Mode semantics

- **DRAFT** is zero-human: QC in DRAFT never requires Mikko performance,
  capture confirmation, or real-human-only evidence. Machine-verifiable
  proxy evidence is what Draft policy defines.
- **REVIEW** consumes a completed Draft: valid Draft-era evidence is reused
  while the governed inputs are unchanged; no redundant production is
  triggered by the mode change.
- **PRODUCTION** substitutes real performance for proxy: weaker Draft
  semantics do not carry forward as final evidence where PRODUCTION fidelity
  is required (e.g. AUDIO_RENDER is PRODUCTION-only; a Draft render does not
  satisfy it).

## Known fidelity gap (flagged, not silently resolved)

AUDIO_RENDER evidence records render provenance and technical facts but no
draft/production fidelity class. Until the evidence schema gains a
render_class/fidelity field, DRAFT synthetic/temporary audio is advisory
material only, and PRODUCTION satisfaction requires production-fidelity
evidence from the canonical producer. The gap is documented in the policy
row (`fidelity_note`), not papered over.

## Authority boundaries

- QC remains evaluator. It never advances gates, never redefines gate order,
  never creates a second stage model.
- production-mode.json remains the run's mode authority. QC consumes a
  task-declared mode read-only.
- The 14-gate engine remains lifecycle authority; earliest_gate values are
  drawn from its canonical gate identities.
- The gate-mode policy (config/gate-mode-policy.json, gates 7–8) remains the
  sibling mission's capture-ownership surface; this policy does not touch it.

## Tasks without run_mode

Keep exact legacy semantics (every required kind is required). The policy is
consulted if and only if `run_mode` is declared, so existing integrations are
undisturbed until they opt in.
