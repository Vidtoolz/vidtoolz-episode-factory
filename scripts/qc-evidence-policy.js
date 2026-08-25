'use strict';

/*
 * qc-evidence-policy.js
 *
 * Declarative required-evidence applicability policy for QC Director.
 *
 * QC's required-evidence question used to have one half:
 *
 *   1. Can production create this evidence?          (producer reachability)
 *
 * This module adds the second half:
 *
 *   2. Is it required HERE, NOW, in THIS mode?       (applicability)
 *
 * Both must be true before absence becomes a blocker. The policy is data, not
 * `if (mode === ...)` scattered through QC; it never advances gates, never
 * redefines gate order, and never writes anything. QC remains evaluator; the
 * 14-gate engine remains lifecycle authority; production-mode.json remains
 * the run's mode authority (QC reads a task-declared mode, never guesses).
 *
 * Applicability classes
 *   GLOBAL_REQUIRED      required at/after earliest_gate in every declared mode
 *   MODE_REQUIRED        required only in the listed modes
 *   GATE_REQUIRED        required only at/after earliest_gate (mode-insensitive)
 *   MODE_AND_GATE_REQUIRED both dimensions apply
 *   OPTIONAL_ADVISORY    useful, never blocking
 *   HUMAN_EXTERNAL       legitimately human/external; tied to explicit human
 *                        gates; never a producer-less machine defect
 *
 * Fail-closed rules
 *   - a required kind with NO policy row is a policy violation, not a guess
 *   - a mode-sensitive kind without a declared mode blocks as
 *     QC_PRODUCTION_MODE_REQUIRED — never defaulted to DRAFT or PRODUCTION
 *   - a required kind before its earliest legitimate gate is
 *     NOT_APPLICABLE_YET (excluded from the missing list), because production
 *     cannot legitimately have produced it
 */

const GATE_ORDER = Object.freeze([
  'package-selection', 'research', 'script-structure', 'script-review',
  'production-plan', 'shot-edit-plan-review', 'capture-checklist',
  'capture-evidence', 'rough-cut-review', 'final-review', 'export-check',
  'publication-metadata', 'archive', 'repurposing',
]);
const MODES = Object.freeze(['DRAFT', 'REVIEW', 'PRODUCTION']);
const MODE_UNSPECIFIED = 'MODE_UNSPECIFIED';

const APPLICABILITY_CLASSES = Object.freeze([
  'GLOBAL_REQUIRED', 'MODE_REQUIRED', 'GATE_REQUIRED', 'MODE_AND_GATE_REQUIRED',
  'OPTIONAL_ADVISORY', 'HUMAN_EXTERNAL',
]);

/* ── audio render classes (fidelity axis) ──────────────────────────────────
 * Audio evidence has THREE orthogonal axes; conflating them is semantic
 * collapse and is prohibited:
 *   1. evidence kind      — WHAT is the artifact (AUDIO_RENDER,
 *                           DRAFT_SYNTHETIC_NARRATION, ...)
 *   2. render class       — at WHAT PRODUCTION LEVEL is the audio valid
 *   3. source/producer    — WHO/HOW it was produced
 *
 * The render-class vocabulary below is canonical for the AUDIO_RENDER kind.
 * DRAFT_SYNTHETIC_NARRATION is a distinct kind with its own declared fidelity
 * (DRAFT_SYNTHETIC_PROXY, owned by its producer) and never becomes
 * AUDIO_RENDER. Classes are NOT a quality ordering: a music candidate is not
 * a lower-grade production mix — they are different semantic branches, and
 * compatibility is encoded per requirement, not ranked.
 */
const RENDER_CLASSES = Object.freeze({
  MUSIC_CANDIDATE: Object.freeze({
    meaning: 'Scorecraft music-lane candidate render (production.wav of a completed music candidate)',
    proves: 'a real music render exists, is technically valid, and carries complete generation provenance',
    does_not_prove: ['final program mix', 'dialogue/narration audio', 'human performance', 'publication approval'],
    authorized_producers: Object.freeze(['sound_music_director']),
    supersedes: null,
  }),
  DRAFT_TEMPORARY: Object.freeze({
    meaning: 'draft-grade temporary audio attested under AUDIO_RENDER (temporary music/temp mix in a DRAFT rough cut)',
    proves: 'a technically valid temporary render exists for DRAFT use',
    does_not_prove: ['production readiness', 'final program mix', 'human performance', 'publication approval'],
    authorized_producers: Object.freeze(['sound_music_director']),
    supersedes: null,
  }),
  PRODUCTION_MIX: Object.freeze({
    meaning: 'final program mix (dialogue/narration + music + effects) at production fidelity',
    proves: 'the complete production program audio exists and is technically valid',
    does_not_prove: ['human performance', 'capture evidence', 'publication approval'],
    authorized_producers: Object.freeze(['editor']),
    supersedes: null,
  }),
});

/*
 * Declarative producer → class authorization. A producer may only claim a
 * class it semantically owns; writing the field is not authorization.
 * PRODUCTION_MIX names exactly one semantic producer: editor — the edit owns
 * the assembled timeline and therefore the audible program. Resolve/ffmpeg is
 * the technical renderer (external); the attester validates bytes, never mixes.
 */
function producerAuthorizedForClass(producer, renderClass) {
  const cls = RENDER_CLASSES[renderClass];
  if (!cls) return false;
  return cls.authorized_producers.includes(producer);
}

/*
 * Known, declared producer gaps for class-sensitive requirements. A gap is
 * machine-readable and explained — it is never silently relaxed, and it is
 * never reported as an unexplained invariant violation.
 */
const KNOWN_CLASS_GAPS = Object.freeze({
  // PRODUCTION_MIX producer path CLOSED (mission 2026-08-25): semantic producer
  // = editor, attester = scripts/production-mix-evidence.js. What remains is an
  // UPSTREAM material gap, declared machine-readably: no canonical assembled
  // PRODUCTION timeline with real presenter audio has been rendered yet
  // (automatic edit/assembly upstream is incomplete; real presenter performance
  // belongs to the capture lane). Until those bytes exist, the class
  // requirement stays unsatisfiable — by absence of material, not by design.
  PRODUCTION_MIX: Object.freeze({
    class: 'PRODUCTION_MIX',
    status: 'UPSTREAM_MATERIAL_MISSING',
    note: 'Producer path closed (editor + production-mix-evidence.js attester). No canonical PRODUCTION-mode assembled timeline with real presenter audio has been rendered yet; automatic edit/assembly upstream is incomplete. PRODUCTION program audio cannot be satisfied by a music candidate or synthetic narration.',
  }),
});

/*
 * The policy itself. `producer` names the canonical producer proven in the
 * STORY_VALIDATION / AUDIO_RENDER missions; producer-less rows are only legal
 * for HUMAN_EXTERNAL / OPTIONAL_ADVISORY. `earliest_gate` is the earliest
 * canonical gate where the evidence can legitimately exist. `fidelity_note`
 * records known semantic gaps (e.g. AUDIO_RENDER draft vs production fidelity)
 * without silently resolving them.
 */
const EVIDENCE_POLICY = Object.freeze({
  STORY_VALIDATION: Object.freeze({
    class: 'MODE_AND_GATE_REQUIRED',
    modes: Object.freeze(['DRAFT', 'REVIEW', 'PRODUCTION']),
    earliest_gate: 'research',
    producer: 'story_validator',
    producer_module: 'scripts/package-run-story-validation.js',
    rationale: 'Story schema/lineage integrity is meaningful once a run is bound to a canonical Story (research/script gates).',
    reuse_note: 'Bound to exact Story version/content hash; remains valid across DRAFT->REVIEW->PRODUCTION while the Story is unchanged; stale on Story version change. No per-gate revalidation.',
  }),
  AUDIO_RENDER: Object.freeze({
    class: 'MODE_REQUIRED',
    modes: Object.freeze(['PRODUCTION']),
    earliest_gate: 'rough-cut-review',
    producer: 'sound_music_director',
    producer_module: 'scripts/audio-render-evidence.js',
    required_render_class: 'PRODUCTION_MIX',
    rationale: 'A final rendered program soundtrack is a production-fidelity requirement; before assembly no render can legitimately exist.',
    fidelity_contract: 'Mechanically enforced via render_class: PRODUCTION requires class PRODUCTION_MIX. The music attester emits MUSIC_CANDIDATE for Scorecraft candidate renders; the program-mix attester (scripts/production-mix-evidence.js) emits PRODUCTION_MIX bound to real assembled program audio + edit-plan identity. Producer path closed; upstream material gap (no canonical assembled PRODUCTION timeline with real presenter audio yet) is declared in KNOWN_CLASS_GAPS and never silently relaxed.',
  }),
  DRAFT_SYNTHETIC_NARRATION: Object.freeze({
    class: 'MODE_REQUIRED',
    modes: Object.freeze(['DRAFT', 'REVIEW']),
    earliest_gate: 'capture-checklist',
    producer: 'generation_supervisor',
    producer_module: 'scripts/package-run-draft-narration.js',
    rationale: 'Synthetic proxy narration is a DRAFT-mode capability; REVIEW reuses what the Draft produced without regenerating. It is its own evidence kind with its own declared fidelity (DRAFT_SYNTHETIC_PROXY) and never becomes AUDIO_RENDER.',
    fidelity_note: 'Declared fidelity is owned by its producer (DRAFT_SYNTHETIC_PROXY); it does not participate in the AUDIO_RENDER render-class vocabulary and cannot satisfy any AUDIO_RENDER class requirement.',
  }),
  CAMERA_QUALITY: Object.freeze({
    class: 'GATE_REQUIRED',
    earliest_gate: 'capture-evidence',
    producer: 'camera_director',
    producer_module: 'earth-studio-camera-quality.js',
    rationale: 'Camera/trajectory quality evidence exists only once camera work has been generated and reviewed.',
  }),
  GENERATION_RESULT: Object.freeze({
    class: 'GATE_REQUIRED',
    earliest_gate: 'production-plan',
    producer: 'generation_supervisor',
    producer_module: 'scripts/generation-supervisor.js',
    rationale: 'Generated media evidence exists only once the generation lane has produced outputs.',
  }),
  EDIT_QC_HANDOFF: Object.freeze({
    class: 'GATE_REQUIRED',
    earliest_gate: 'rough-cut-review',
    producer: 'editor',
    producer_module: 'scripts/edit-plan.js',
    rationale: 'Edit/timeline handoff evidence exists only once assembly has a timeline to hand off.',
  }),
  FINAL_CUT_APPROVAL: Object.freeze({
    class: 'HUMAN_EXTERNAL',
    earliest_gate: 'rough-cut-review',
    producer: null,
    producer_module: null,
    rationale: 'Durable human approval consumed by QC via HUMAN_AUTHORITY_GATES; never machine-produced, never a producer-less defect.',
  }),
  TITLE_THUMBNAIL_APPROVAL: Object.freeze({
    class: 'HUMAN_EXTERNAL',
    earliest_gate: 'publication-metadata',
    producer: null,
    producer_module: null,
    rationale: 'Publication packaging approval is Mikko-boundary evidence consumed at the publication gate.',
  }),
});

function gateIndex(gateId) {
  const i = GATE_ORDER.indexOf(gateId);
  if (i < 0) throw new Error(`QC_POLICY_GATE_UNKNOWN: ${gateId}`);
  return i;
}

function policyForKind(kind) {
  return EVIDENCE_POLICY[kind] || null;
}

/*
 * Resolve one required evidence kind for a gate + declared mode.
 *
 * mode must be DRAFT/REVIEW/PRODUCTION or MODE_UNSPECIFIED. A null mode is
 * treated as MODE_UNSPECIFIED (legacy tasks) — acceptable only for
 * mode-insensitive kinds.
 *
 * Returns { kind, class, status, reason, detail }:
 *   status REQUIRED            applicable now; absence blocks
 *   status NOT_APPLICABLE_YET  before earliest legitimate gate; absence is correct
 *   status MODE_NOT_REQUIRED   this mode does not require it
 *   status MODE_REQUIRED_BLOCKED  mode-sensitive kind, mode undeclared -> fail closed
 *   status POLICY_VIOLATION    required kind has no policy row -> fail closed
 */
function resolveApplicability(kind, gateId, mode) {
  const row = policyForKind(kind);
  const declaredMode = mode || MODE_UNSPECIFIED;
  if (!row) {
    return {
      kind, class: null, status: 'POLICY_VIOLATION', gate: gateId || null, mode: declaredMode,
      reason: `required evidence ${kind} has no applicability policy row; QC fails closed rather than guessing`,
      detail: null,
    };
  }
  const gateKnown = Boolean(gateId);
  const early = gateKnown && row.earliest_gate && gateIndex(gateId) < gateIndex(row.earliest_gate);
  if (early) {
    return {
      kind, class: row.class, status: 'NOT_APPLICABLE_YET', gate: gateId, mode: declaredMode,
      reason: `${kind} cannot legitimately exist before gate ${row.earliest_gate}; the run is at ${gateId}`,
      detail: { earliest_gate: row.earliest_gate },
    };
  }
  // Human/external evidence is expected only at an explicit human boundary.
  // It is consumed by QC's human-authority mechanism, never machine-produced,
  // and must never be reported as a producer-less machine requirement.
  if (row.class === 'HUMAN_EXTERNAL') {
    return {
      kind, class: row.class, status: 'HUMAN_BOUNDARY', gate: gateId || null, mode: declaredMode,
      reason: `${kind} is human/external boundary evidence, consumed at its human gate; it is never a machine evidence requirement`,
      detail: { earliest_gate: row.earliest_gate || null },
    };
  }
  const modeSensitive = row.class === 'MODE_REQUIRED' || row.class === 'MODE_AND_GATE_REQUIRED';
  if (modeSensitive && declaredMode === MODE_UNSPECIFIED) {
    return {
      kind, class: row.class, status: 'MODE_REQUIRED_BLOCKED', gate: gateId || null, mode: declaredMode,
      reason: `${kind} applicability depends on production mode, but no mode is declared; QC does not guess`,
      detail: { modes: [...row.modes] },
    };
  }
  if (row.class === 'OPTIONAL_ADVISORY') {
    return { kind, class: row.class, status: 'OPTIONAL', gate: gateId || null, mode: declaredMode, reason: 'advisory evidence is never blocking', detail: null };
  }
  if (modeSensitive && !row.modes.includes(declaredMode)) {
    return {
      kind, class: row.class, status: 'MODE_NOT_REQUIRED', gate: gateId || null, mode: declaredMode,
      reason: `${kind} is not required in mode ${declaredMode}`,
      detail: { modes: [...row.modes] },
    };
  }
  return {
    kind, class: row.class, status: 'REQUIRED', gate: gateId || null, mode: declaredMode,
    reason: 'applicable at this gate in this mode; absence blocks',
    detail: { earliest_gate: row.earliest_gate || null, producer: row.producer },
  };
}

/*
 * Partition a required-evidence list. QC's check consumes this: only REQUIRED
 * kinds may produce QC_REQUIRED_EVIDENCE_MISSING; NOT_APPLICABLE_YET and
 * MODE_NOT_REQUIRED kinds are reported truthfully in the coverage audit;
 * MODE_REQUIRED_BLOCKED and POLICY_VIOLATION surface as blockers.
 */
function auditRequiredEvidence(kinds, gateId, mode) {
  const audit = {
    required: [], not_applicable_yet: [], mode_not_required: [],
    mode_blocked: [], policy_violations: [], optional: [], human_boundary: [],
  };
  for (const kind of kinds || []) {
    const resolved = resolveApplicability(kind, gateId, mode);
    switch (resolved.status) {
      case 'REQUIRED': audit.required.push(resolved); break;
      case 'NOT_APPLICABLE_YET': audit.not_applicable_yet.push(resolved); break;
      case 'MODE_NOT_REQUIRED': audit.mode_not_required.push(resolved); break;
      case 'MODE_REQUIRED_BLOCKED': audit.mode_blocked.push(resolved); break;
      case 'POLICY_VIOLATION': audit.policy_violations.push(resolved); break;
      case 'OPTIONAL': audit.optional.push(resolved); break;
      case 'HUMAN_BOUNDARY': audit.human_boundary.push(resolved); break;
      default: audit.policy_violations.push(resolved);
    }
  }
  return audit;
}

/* ------------------------------------------------------------- invariants -- */

/*
 * Invariant 1 (producer reachability, extended): every policy row that can be
 * REQUIRED must name a producer module that exists. HUMAN_EXTERNAL and
 * OPTIONAL_ADVISORY rows are legitimately producer-less.
 */
function checkProducerReachability(repoRoot) {
  const fs = require('node:fs');
  const path = require('node:path');
  const violations = [];
  for (const [kind, row] of Object.entries(EVIDENCE_POLICY)) {
    const mayBeRequired = row.class !== 'HUMAN_EXTERNAL' && row.class !== 'OPTIONAL_ADVISORY';
    if (!mayBeRequired) continue;
    if (!row.producer || !row.producer_module) {
      violations.push({ kind, reason: 'required-class evidence has no declared producer' });
      continue;
    }
    if (!fs.existsSync(path.join(repoRoot, row.producer_module))) {
      violations.push({ kind, reason: `producer module missing: ${row.producer_module}` });
    }
  }
  return { ok: violations.length === 0, violations };
}

/*
 * Invariant 2 (applicability sanity): QC may not classify evidence as
 * required before its earliest legitimate lifecycle point or in a mode its
 * producer cannot satisfy. Verified mechanically:
 *   - every row with earliest_gate names a canonical gate
 *   - for each required class, a gate BEFORE earliest_gate never resolves REQUIRED
 *   - for each MODE_REQUIRED row, an unlisted mode never resolves REQUIRED
 *   - MODE_UNSPECIFIED never resolves REQUIRED for mode-sensitive rows
 */
function checkApplicabilityConsistency() {
  const violations = [];
  for (const [kind, row] of Object.entries(EVIDENCE_POLICY)) {
    if (row.earliest_gate && !GATE_ORDER.includes(row.earliest_gate)) {
      violations.push({ kind, reason: `earliest_gate not canonical: ${row.earliest_gate}` });
      continue;
    }
    if (row.earliest_gate) {
      const before = GATE_ORDER[gateIndex(row.earliest_gate) - 1];
      if (before) {
        const r = resolveApplicability(kind, before, 'PRODUCTION');
        if (r.status === 'REQUIRED') violations.push({ kind, reason: `resolves REQUIRED before earliest gate (at ${before})` });
      }
    }
    const modeSensitive = row.class === 'MODE_REQUIRED' || row.class === 'MODE_AND_GATE_REQUIRED';
    if (modeSensitive) {
      const atGate = row.earliest_gate || GATE_ORDER.at(-1);
      for (const mode of MODES) {
        const r = resolveApplicability(kind, atGate, mode);
        if (!row.modes.includes(mode) && r.status === 'REQUIRED') {
          violations.push({ kind, reason: `resolves REQUIRED in unlisted mode ${mode}` });
        }
      }
      const rUnspecified = resolveApplicability(kind, atGate, MODE_UNSPECIFIED);
      if (rUnspecified.status === 'REQUIRED') {
        violations.push({ kind, reason: 'resolves REQUIRED with MODE_UNSPECIFIED' });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/*
 * Invariant 3 (audio fidelity): every class-sensitive QC audio requirement
 * names a canonical render class, and every such class has at least one
 * authorized producer path — OR is an explicitly declared known gap. No
 * class-sensitive requirement may point at an unknown class, and no
 * unexplained producer-less class requirement may exist.
 */
function checkAudioFidelityConsistency() {
  const violations = [];
  for (const [kind, row] of Object.entries(EVIDENCE_POLICY)) {
    if (!row.required_render_class) continue;
    const cls = RENDER_CLASSES[row.required_render_class];
    if (!cls) {
      violations.push({ kind, reason: `required_render_class is not canonical: ${row.required_render_class}` });
      continue;
    }
    const declaredGap = KNOWN_CLASS_GAPS[row.required_render_class];
    if (cls.authorized_producers.length === 0 && !declaredGap) {
      violations.push({ kind, reason: `render class ${row.required_render_class} has no authorized producer and is not a declared known gap` });
    }
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  GATE_ORDER, MODES, MODE_UNSPECIFIED, APPLICABILITY_CLASSES, EVIDENCE_POLICY,
  RENDER_CLASSES, KNOWN_CLASS_GAPS, producerAuthorizedForClass,
  gateIndex, policyForKind, resolveApplicability, auditRequiredEvidence,
  checkProducerReachability, checkApplicabilityConsistency, checkAudioFidelityConsistency,
};
