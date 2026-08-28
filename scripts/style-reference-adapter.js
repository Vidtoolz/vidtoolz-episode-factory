'use strict';

/*
 * style-reference-adapter.js
 *
 * Read-only consumption adapter for the human-approved VIDTOOLZ style
 * reference (schema vidtoolz.styleReference.v1, e.g. VIDTOOLZ_STYLE_REFERENCE_V1).
 *
 * Authority model (config/style-reference-contract.json is the contract):
 *   - The style reference is HUMAN_STYLE_REFERENCE authority (rank 3):
 *     an ENVELOPE, never a template. It sits BELOW live human decisions
 *     (rank 1) and episode-specific direction (rank 2), ABOVE agent taste.
 *   - Everything this module produces is ADVISORY. Findings are evidence
 *     (REFERENCE_MATCH / REFERENCE_WARNING / REFERENCE_OUTLIER, action
 *     "review" at most). Output never carries a disposition, a gate
 *     verdict, or any blocking field, and no caller may branch production
 *     behavior on it (ADVISORY FIREWALL).
 *   - All envelope numbers are READ from the reference artifact at load
 *     time. This module hard-codes no band values; evaluator tuning
 *     parameters live in the contract file with provenance.
 *
 * This module deliberately has no CLI and no AGENT_ID: it is a library,
 * never a 13th agent (config/agent-contract.json lifecycle_classification
 * forbids validator-shaped registry entries).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADAPTER_SCHEMA = 'vidtoolz.styleReferenceContext.v1';
const REFERENCE_SCHEMA = 'vidtoolz.styleReference.v1';
const CONTRACT_PATH = path.join(__dirname, '..', 'config', 'style-reference-contract.json');

const AUTHORITY_TIER = 'HUMAN_STYLE_REFERENCE';
const AUTHORITY_RANK = 3;

const ADVISORY_PREAMBLE =
  'STYLE REFERENCE (ADVISORY, rank 3 HUMAN_STYLE_REFERENCE): envelope, not template. ' +
  'Episode-specific direction and recorded human KEEP/CHANGE decisions outrank this reference. ' +
  'Deviation with an explicitly stated creative reason is always legal (P-01). ' +
  'Never restate this reference as your own output; cite principle/pattern ids.';

const VERDICTS = Object.freeze(['REFERENCE_MATCH', 'REFERENCE_WARNING', 'REFERENCE_OUTLIER']);
const FINDING_STATUSES = Object.freeze(['ACTIVE', 'DEVIATION_ACKNOWLEDGED', 'INFORMATIONAL_ONLY']);

// Level-C treatment classes considered "alive". STATIC is legal only with a
// reading-work justification or an explicit creative reason.
const ACTIVE_LEVEL_C_CLASSES = Object.freeze([
  'SLOW_SCALE', 'SLOW_PAN', 'PUSH_IN', 'DRIFT', 'PROXY_MOTION', 'GRAPHIC_EVOLUTION', 'LIVE_PRESENTER',
]);

/*
 * LEVEL-B EVENT CONTRACT (2026-08-28 authority repair).
 * LEVEL B means MEANINGFUL VISUAL EVENT — a semantic state change — never a
 * bare frame difference, never a cut for its own sake, never codec noise.
 * Events are admitted ONLY through these classes; a HARD_CUT is meaningful
 * ONLY when it declares semantic_change: true; measurement noise classes are
 * NEVER admissible; an unknown kind fails closed instead of counting.
 */
const MEANINGFUL_EVENT_CLASSES = Object.freeze([
  'NEW_EXPLANATORY_ELEMENT', 'COMPOSITION_CHANGE', 'CARD_STATE_CHANGE', 'LABEL_REVEAL',
  'REFRAME', 'PUSH_IN_ONSET', 'NEW_VISUAL_RELATIONSHIP', 'GRAPHIC_ACCUMULATION',
  'SEMANTIC_TRANSITION', 'PRESENTER_TIER_CHANGE', 'HARD_CUT',
]);
const EVENT_KIND_ALIASES = Object.freeze({
  card_evolution: 'CARD_STATE_CHANGE',
  reframe: 'REFRAME',
  push_in: 'PUSH_IN_ONSET',
  push_in_onset: 'PUSH_IN_ONSET',
  beat_transition: 'SEMANTIC_TRANSITION',
  cut: 'HARD_CUT',
  hard_cut: 'HARD_CUT',
  label_reveal: 'LABEL_REVEAL',
  presenter_tier_change: 'PRESENTER_TIER_CHANGE',
});
const NEVER_MEANINGFUL_EVENT_CLASSES = Object.freeze([
  'ENCODER_DRIFT', 'ENCODER_NOISE', 'COMPRESSION_NOISE', 'FRAME_NOISE', 'CODEC_NOISE', 'MEASUREMENT_CANDIDATE',
]);
// Legitimate declarations of continuous motion: these belong to LEVEL C and
// are silently non-counting as Level-B events (not an error — the caller is
// stating a fact about motion, not claiming a meaningful event).
const CONTINUOUS_MOTION_NON_EVENT_CLASSES = Object.freeze([
  'DRIFT', 'CONTINUOUS_MOTION', 'SLOW_PAN', 'SLOW_SCALE', 'PAN', 'ZOOM', 'PUSH_IN_CONTINUATION',
]);

function normalizeEventKind(kind) {
  const upper = String(kind || '').toUpperCase();
  if (MEANINGFUL_EVENT_CLASSES.includes(upper)) return upper;
  const alias = EVENT_KIND_ALIASES[String(kind || '').toLowerCase()];
  return alias || null;
}

/*
 * Admit semantic Level-B events from a caller-supplied list. Fail-closed:
 * unknown kinds and never-meaningful classes are ERRORS, not silent counts;
 * HARD_CUT admits only with semantic_change === true; an explicit
 * meaningful:false demotes any event to non-counting.
 */
function admitSemanticEvents(events) {
  const admitted = [];
  const errors = [];
  for (const [index, event] of (events || []).entries()) {
    const rawKind = String(event?.kind ?? '');
    if (NEVER_MEANINGFUL_EVENT_CLASSES.includes(rawKind.toUpperCase())) {
      if (event?.meaningful === true) errors.push(`STYLE_EVENT_CLASS_INADMISSIBLE: b_events[${index}] claims ${rawKind} as meaningful — measurement noise is never a Level-B event`);
      continue; // never counted, with or without the claim
    }
    if (CONTINUOUS_MOTION_NON_EVENT_CLASSES.includes(rawKind.toUpperCase())) {
      if (event?.semantic_change === true) { admitted.push({ ...event, kind: 'SEMANTIC_TRANSITION' }); }
      continue; // continuous motion is Level C unless it crosses a semantic boundary
    }
    const kind = normalizeEventKind(rawKind);
    if (!kind) { errors.push(`STYLE_EVENT_CLASS_UNKNOWN: b_events[${index}] kind ${rawKind || '(missing)'} is not an admissible meaningful-event class`); continue; }
    if (event?.meaningful === false) continue;
    if (kind === 'HARD_CUT' && event?.semantic_change !== true) continue; // a cut is only Level B when it changes the visual state meaningfully
    admitted.push({ ...event, kind });
  }
  return { admitted, errors };
}

// A PIXEL_SIGNAL candidate that represents a real, non-noise visual change and
// could therefore support a planned semantic manifestation. Noise classes and
// pure continuous motion can NEVER support a Level-B confirmation.
const CONFIRMING_SIGNAL_CLASSES = Object.freeze([
  'VISUAL_CHANGE', 'FRAME_CHANGE', 'COMPOSITION_CHANGE', 'HARD_CUT', 'CONTENT_CHANGE', 'REVEAL', 'STATE_CHANGE',
]);
function isConfirmingSignal(candidate) {
  const kind = String(candidate?.kind || '').toUpperCase();
  if (NEVER_MEANINGFUL_EVENT_CLASSES.includes(kind)) return false; // encoder/compression/frame noise never confirms
  if (CONTINUOUS_MOTION_NON_EVENT_CLASSES.includes(kind)) return false; // motion is Level C, cannot alone confirm B
  if (CONFIRMING_SIGNAL_CLASSES.includes(kind)) return true;
  // A candidate carrying an admissible semantic class is also a valid support.
  return normalizeEventKind(kind) !== null;
}

/*
 * SUCCESSOR REPAIR (fc2c6f0 child) — EVENT AUTHORITY PIPELINE.
 * Four distinct concepts:
 *   PLANNED_EVENT               semantic event authored in the plan (with id)
 *   PIXEL_SIGNAL (candidate)    raw measurement that something changed (with id)
 *   CONFIRMED_MEANINGFUL_EVENT  a planned event whose expected manifestation is
 *                               supported by a NON-NOISE pixel signal near it
 *   UNPLANNED_EVENT_CANDIDATE   a non-noise signal not matching any planned
 *                               event — requires semantic adjudication, never
 *                               auto-counts.
 * A pixel signal NEVER self-certifies. Noise candidates confirm nothing and are
 * discarded. Provenance ids (event_id + candidate_id) are preserved.
 */
function admitMeasuredEvents(candidates, plannedEvents, options = {}) {
  const tolerance = options.toleranceS ?? 0.5;
  const planned = admitSemanticEvents(plannedEvents);
  const remaining = planned.admitted.map((p, i) => ({ ...p, event_id: p.event_id ?? `planned-${i + 1}` }));
  const confirmed = [];
  const unplanned = [];
  const discarded_noise = [];
  (candidates || []).forEach((candidate, i) => {
    const candidateId = candidate?.candidate_id ?? `signal-${i + 1}`;
    if (!isConfirmingSignal(candidate)) {
      // Noise / continuous-motion / unusable signal: can never confirm a
      // semantic event and never becomes an unplanned candidate.
      discarded_noise.push({ candidate_id: candidateId, t_s: candidate?.t_s, kind: candidate?.kind, reason: 'non-confirming signal class (noise or continuous motion)' });
      return;
    }
    const index = remaining.findIndex((p) => Math.abs((p.t_s ?? NaN) - (candidate?.t_s ?? NaN)) <= tolerance);
    if (index >= 0) {
      const plan = remaining.splice(index, 1)[0];
      confirmed.push({ event_id: plan.event_id, candidate_id: candidateId, t_s: plan.t_s, kind: plan.kind, authority: 'PLANNED_SEMANTIC_CONFIRMED', measured_t_s: candidate?.t_s, supporting_signal_kind: candidate?.kind });
    } else {
      // A real change with no planned counterpart: adjudication required, never
      // auto-counted as meaningful.
      unplanned.push({ candidate_id: candidateId, t_s: candidate?.t_s, kind: candidate?.kind, authority: 'UNPLANNED_EVENT_CANDIDATE', meaningful: false, requires_semantic_adjudication: true });
    }
  });
  return { confirmed, unplanned_candidates: unplanned, discarded_noise, unconfirmed_planned: remaining, errors: planned.errors };
}

/*
 * Explicit LEVEL-A macro-state counter. A macro state is a backdrop/composition
 * state; it changes only at declared macro boundaries, NOT at every beat and
 * NOT from pixel signal. Consecutive spans that declare the same macro_state_id
 * (or same plate/backdrop identity) are ONE state.
 */
function countMacroStates(spans) {
  let count = 0;
  let prev = null;
  for (const span of spans || []) {
    const id = span.macro_state_id ?? span.backdrop_id ?? span.plate ?? span.state ?? null;
    const isBoundary = span.macro_boundary === true || id == null || id !== prev;
    if (isBoundary) count += 1;
    prev = id;
  }
  return count;
}

/*
 * Explicit A/B/C classification for regression certification. Level B counts
 * ONLY admitted semantic events; Level C is active-motion coverage; Level A is
 * the macro-state count. The three are never conflated.
 */
function classifyProgrammeLevels(programme) {
  const bAdmission = admitSemanticEvents(programme.b_events || []);
  const activeC = (programme.spans || []).some((s) => ACTIVE_LEVEL_C_CLASSES.includes((s.level_c || {}).class));
  return {
    level_a_macro_states: countMacroStates(programme.spans || []),
    level_b_meaningful_events: bAdmission.admitted.length,
    level_b_errors: bAdmission.errors,
    level_c_active: activeC,
  };
}

const DENSITY_GROUPS = Object.freeze({
  D0: 'QUIET', D1: 'QUIET', D2: 'READABLE', D3: 'READABLE', D4: 'DENSE', D5: 'DENSE',
  QUIET: 'QUIET', READABLE: 'READABLE', DENSE: 'DENSE',
});

class StyleReferenceError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}`);
    this.name = 'StyleReferenceError';
    this.code = code;
    this.details = details || {};
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function loadContract(contractPath) {
  const raw = fs.readFileSync(contractPath || CONTRACT_PATH, 'utf8');
  return JSON.parse(raw);
}

/*
 * Load and verify a style reference against an expected binding.
 * Fail-closed: any identity, hash, schema, supersession, or approval gap is
 * an error, never a silent degrade.
 *
 * expectedBinding: { reference_id, sha256 }
 */
function loadStyleReference(options) {
  const { referencePath, expectedBinding } = options || {};
  if (!referencePath) {
    throw new StyleReferenceError('STYLE_REFERENCE_PATH_REQUIRED', 'referencePath is required');
  }
  if (!expectedBinding || !expectedBinding.reference_id || !/^[a-f0-9]{64}$/.test(String(expectedBinding.sha256 || ''))) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_REQUIRED',
      'expectedBinding {reference_id, sha256 (64 hex)} is required; unbound style consumption is forbidden');
  }

  let bytes;
  try {
    bytes = fs.readFileSync(referencePath);
  } catch (err) {
    throw new StyleReferenceError('STYLE_REFERENCE_UNREADABLE', `cannot read ${referencePath}`, { cause: String(err) });
  }

  const observed = sha256(bytes);
  if (observed !== expectedBinding.sha256) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_MISMATCH',
      'reference bytes do not match the pinned binding; refusing to consume (possible successor or tampering — re-resolve the ACTIVE reference and re-bind)',
      { expected_sha256: expectedBinding.sha256, observed_sha256: observed, path: referencePath });
  }

  let reference;
  try {
    reference = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new StyleReferenceError('STYLE_REFERENCE_INVALID_JSON', `${referencePath} is not valid JSON`, { cause: String(err) });
  }

  if (reference.schema !== REFERENCE_SCHEMA) {
    throw new StyleReferenceError('STYLE_REFERENCE_SCHEMA_UNSUPPORTED',
      `expected schema ${REFERENCE_SCHEMA}`, { observed_schema: reference.schema });
  }
  if (reference.id !== expectedBinding.reference_id) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_MISMATCH',
      'reference id does not match the pinned binding', { expected_id: expectedBinding.reference_id, observed_id: reference.id });
  }
  if (reference.status !== 'ACTIVE') {
    throw new StyleReferenceError('STYLE_REFERENCE_STALE_BINDING',
      `reference status is ${reference.status}; a superseded reference has no authority — re-resolve the ACTIVE successor and re-bind`,
      { reference_id: reference.id, status: reference.status });
  }

  // Human approval is load-bearing: an unapproved reference is not authority.
  const approvalGaps = [];
  if (!reference.approved_by) approvalGaps.push('approved_by');
  if (!reference.approved_at) approvalGaps.push('approved_at');
  if (!reference.decision_record) approvalGaps.push('decision_record');
  if (!reference.authority_scope || !Array.isArray(reference.authority_scope.is_not)) approvalGaps.push('authority_scope.is_not');
  if (approvalGaps.length > 0) {
    throw new StyleReferenceError('STYLE_REFERENCE_NOT_HUMAN_APPROVED',
      'reference lacks explicit human-approval fields; refusing to treat it as authority', { missing: approvalGaps });
  }
  if (!reference.event_model || !Array.isArray(reference.principles)) {
    throw new StyleReferenceError('STYLE_REFERENCE_INCOMPLETE', 'reference is missing event_model or principles');
  }

  return deepFreeze({
    reference,
    binding: {
      reference_id: reference.id,
      sha256: observed,
      approved_by: reference.approved_by,
      approved_at: reference.approved_at,
      authority_tier: AUTHORITY_TIER,
      authority_rank: AUTHORITY_RANK,
    },
  });
}

/*
 * Confidence-class powers: what a pattern of a given class is ALLOWED to do.
 * This is the anti-overfitting gate: only STRONG patterns shape defaults or
 * warn on envelope exit; nothing ever warns on ABSENCE of a non-required
 * pattern; a single-video device is never a rule.
 */
function patternPowers(patternClass) {
  switch (patternClass) {
    case 'STRONG_REFERENCE_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: true, may_warn_on_exit: true, warn_on_absence: false });
    case 'LIKELY_REFERENCE_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, suggestion: true });
    case 'OPTIONAL':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false });
    case 'SINGLE_VIDEO_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, inspiration_only: true });
    case 'UNCERTAIN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, context_only: true });
    default:
      throw new StyleReferenceError('STYLE_REFERENCE_UNKNOWN_PATTERN_CLASS', `unknown pattern class ${patternClass}`);
  }
}

const ROLE_PRINCIPLE_SELECTION = Object.freeze({
  // Creative Director reasons over tendencies; numeric bands are withheld so
  // taste is never planned to metrics (they belong to visual planning and QC).
  creative_director: { principles: 'ALL', include_event_bands: false },
  visual_planning_director: { principles: 'ALL', include_event_bands: true },
  editor: {
    principles: ['P-01', 'P-03', 'P-08', 'P-09', 'P-10', 'P-12', 'P-15', 'P-16', 'P-17'],
    include_event_bands: true,
  },
  qc_director: { principles: ['P-01', 'P-02', 'P-03', 'P-15', 'P-17', 'P-20', 'P-21'], include_event_bands: true },
});

function projectForRole(loaded, role) {
  if (!loaded || !loaded.reference || !loaded.binding) {
    throw new StyleReferenceError('STYLE_REFERENCE_LOAD_REQUIRED', 'projectForRole requires the result of loadStyleReference');
  }
  const selection = ROLE_PRINCIPLE_SELECTION[role];
  if (!selection) {
    throw new StyleReferenceError('STYLE_REFERENCE_UNKNOWN_ROLE', `no projection defined for role ${role}`, {
      known_roles: Object.keys(ROLE_PRINCIPLE_SELECTION),
    });
  }
  const { reference, binding } = loaded;
  const principles = selection.principles === 'ALL'
    ? reference.principles
    : reference.principles.filter((p) => selection.principles.includes(p.id));

  const projection = {
    schema: ADAPTER_SCHEMA,
    role,
    identity: binding,
    advisory_preamble: ADVISORY_PREAMBLE,
    nature: reference.nature,
    authority_scope: reference.authority_scope,
    doctrine: reference.doctrine,
    principles,
    succession: reference.source_basis ? reference.source_basis.succession : undefined,
  };
  if (selection.include_event_bands) {
    projection.event_model = reference.event_model;
  } else {
    projection.event_model_note =
      'Numeric Level A/B/C bands are deliberately withheld from this role: reason over tendencies, never plan taste to metrics.';
  }
  return deepFreeze(projection);
}

function densityGroup(density) {
  const group = DENSITY_GROUPS[String(density || '').toUpperCase()];
  return group || 'UNKNOWN';
}

function spanIsAlive(span) {
  // Presenter PRESENCE alone never proves Level-C adequacy (Codex escape):
  // presenter motion counts only when explicitly claimed as the span's
  // Level-C treatment (LIVE_PRESENTER / PROXY_MOTION class).
  const levelC = span.level_c || {};
  if (ACTIVE_LEVEL_C_CLASSES.includes(levelC.class)) return true;
  return false;
}

function spanReadingJustified(span) {
  const levelC = span.level_c || {};
  return levelC.class === 'STATIC'
    && levelC.reason === 'reading_work'
    && span.text_bearing === true
    && densityGroup(span.density) === 'DENSE';
}

function resolveStatus(dimension, context) {
  const ctx = context || {};
  const keeps = ctx.human_keeps || [];
  if (keeps.some((k) => k && k.dimension === dimension)) return 'INFORMATIONAL_ONLY';
  const deviations = ctx.deviations || [];
  if (deviations.some((d) => d && d.dimension === dimension)) return 'DEVIATION_ACKNOWLEDGED';
  return 'ACTIVE';
}

function finding(context, fields) {
  const status = resolveStatus(fields.dimension, context);
  return {
    metric: fields.metric,
    warning_id: fields.warning_id || null,
    level: fields.level,
    dimension: fields.dimension,
    verdict: fields.verdict,
    action: fields.verdict === 'REFERENCE_MATCH' ? 'none' : 'review',
    status,
    measured: fields.measured,
    band: fields.band === undefined ? null : fields.band,
    evidence: fields.evidence,
  };
}

/*
 * Evaluate a neutral programme summary against the reference envelope.
 * ADVISORY ONLY: the result carries findings and evidence, never a
 * disposition, gate verdict, score, or blocking field.
 *
 * programme:
 *   duration_s            total runtime
 *   spans[]               { start_s, end_s, presenter: LIVE|PROXY|ABSENT,
 *                           level_c: {class, reason?}, density, text_bearing }
 *   b_events[]            { t_s, kind, asset_id?, meaningful (default true), reason? }
 *   ending?               { designed_card, generic_cta, text_only_close }
 *
 * context:
 *   deviations[]          rank-2 episode direction: { dimension, reason }
 *   human_keeps[]         rank-1 recorded decisions: { dimension, decision }
 */
function evaluateAdvisory(loaded, programme, context, params) {
  if (!loaded || !loaded.reference) {
    throw new StyleReferenceError('STYLE_REFERENCE_LOAD_REQUIRED', 'evaluateAdvisory requires the result of loadStyleReference');
  }
  if (!programme || !(programme.duration_s > 0)) {
    throw new StyleReferenceError('STYLE_PROGRAMME_INVALID', 'programme.duration_s must be > 0');
  }
  const contract = params && params.contract ? params.contract : loadContract(params && params.contractPath);
  const evalParams = contract.evaluator_parameters || {};
  const denseMinReadS = evalParams.dense_min_read_s;
  const noEventReviewS = evalParams.no_event_review_s;
  if (!(denseMinReadS > 0) || !(noEventReviewS > 0)) {
    throw new StyleReferenceError('STYLE_REFERENCE_CONTRACT_INCOMPLETE',
      'contract evaluator_parameters must define dense_min_read_s and no_event_review_s');
  }

  const eventModel = loaded.reference.event_model;
  const levelB = eventModel.LEVEL_B_MEANINGFUL_VISUAL_EVENT || {};
  const bBand = levelB.advisory_band_per_min;
  if (!Array.isArray(bBand) || bBand.length !== 2) {
    throw new StyleReferenceError('STYLE_REFERENCE_INCOMPLETE', 'reference lacks LEVEL_B advisory_band_per_min');
  }

  const spans = (programme.spans || []).slice().sort((a, b) => a.start_s - b.start_s);
  // LEVEL-B CONTRACT: only admissible semantic event classes count; noise
  // classes and unknown kinds fail closed rather than inflating density.
  const admission = admitSemanticEvents(programme.b_events || []);
  if (admission.errors.length) {
    throw new StyleReferenceError('STYLE_EVENT_CONTRACT_VIOLATION', admission.errors.join('; '));
  }
  const meaningfulEvents = admission.admitted.slice().sort((a, b) => a.t_s - b.t_s);

  const findings = [];

  // LEVEL_B density. Every treatment transition of one asset counts on its
  // own (P-09): counting is by event, never deduplicated by asset_id.
  const perMin = meaningfulEvents.length / (programme.duration_s / 60);
  if (perMin < bBand[0]) {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', warning_id: 'W-02', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_WARNING', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: `meaningful events ${meaningfulEvents.length} over ${programme.duration_s}s => ${perMin.toFixed(2)}/min, below advisory band`,
    }));
  } else if (perMin > bBand[1]) {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_OUTLIER', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: 'above advisory band; normal variation is not failure — review pacing intent',
    }));
  } else {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_MATCH', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: 'within advisory band',
    }));
  }

  // W-01: >10s with no Level-B event and no Level-C / reading justification.
  // A long macro state whose interior keeps producing B events or stays
  // alive at Level C is explicitly legal (P-17).
  const timestamps = [0, ...meaningfulEvents.map((e) => e.t_s), programme.duration_s];
  for (let i = 0; i + 1 < timestamps.length; i += 1) {
    const gapStart = timestamps[i];
    const gapEnd = timestamps[i + 1];
    if (gapEnd - gapStart <= noEventReviewS) continue;
    const covering = spans.filter((s) => s.end_s > gapStart && s.start_s < gapEnd);
    const justified = covering.length > 0 && covering.every((s) => spanIsAlive(s) || spanReadingJustified(s));
    if (!justified) {
      findings.push(finding(context, {
        metric: 'LONGEST_NO_MEANINGFUL_EVENT_SPAN', warning_id: 'W-01', level: 'B', dimension: 'no_event_span',
        verdict: 'REFERENCE_WARNING', measured: Number((gapEnd - gapStart).toFixed(2)), band: { review_over_s: noEventReviewS },
        evidence: `no meaningful visual evolution ${gapStart}s-${gapEnd}s and no Level-C or reading-work justification in the covering span(s)`,
      }));
    }
  }

  // W-08: presenter-free span with no compensating visual life (P-02).
  // Presenter absence ALONE never fires; the equivalence principle only asks
  // that something carries the life the presenter would have carried.
  for (const span of spans) {
    if (span.presenter !== 'ABSENT') continue;
    if (spanIsAlive(span) || spanReadingJustified(span)) continue;
    const levelC = span.level_c || {};
    if (levelC.class === 'STATIC' && levelC.reason === 'explicit_creative_choice') continue;
    findings.push(finding(context, {
      metric: 'PRESENTER_OR_CONTINUOUS_VISUAL_LIFE_COVERAGE', warning_id: 'W-08', level: 'C',
      dimension: 'presenter_free_compensation',
      verdict: 'REFERENCE_WARNING', measured: `uncovered span ${span.start_s}s-${span.end_s}s`, band: null,
      evidence: 'presenter absent (legal) but span has no active Level-C treatment and no reading-work justification',
    }));
  }

  // W-09: high density replaced faster than reading time.
  for (const span of spans) {
    if (densityGroup(span.density) !== 'DENSE') continue;
    const duration = span.end_s - span.start_s;
    if (duration >= denseMinReadS) continue;
    findings.push(finding(context, {
      metric: 'DENSITY_FAST_CUT_COMBINATION', warning_id: 'W-09', level: 'A', dimension: 'density_pace',
      verdict: 'REFERENCE_WARNING', measured: Number(duration.toFixed(2)), band: { dense_min_read_s: denseMinReadS },
      evidence: `dense card (${span.density}) held ${duration}s at ${span.start_s}s — shorter than reading time; the forbidden combination unless deliberately reasoned`,
    }));
  }

  // W-07: ending grammar (only when the caller supplies ending facts).
  if (programme.ending) {
    const e = programme.ending;
    if (e.generic_cta === true || e.text_only_close === true) {
      findings.push(finding(context, {
        metric: 'ENDING_SYNTHESIS_CARD_PRESENCE', warning_id: 'W-07', level: 'GRAMMAR', dimension: 'ending',
        verdict: 'REFERENCE_WARNING', measured: e.generic_cta ? 'generic CTA/outro close' : 'plain text-only close', band: null,
        evidence: 'references end on designed cards with a footer takeaway and a hard stop; generic or text-only closes are the negative tendency (0/3)',
      }));
    } else if (e.designed_card === true) {
      findings.push(finding(context, {
        metric: 'ENDING_SYNTHESIS_CARD_PRESENCE', level: 'GRAMMAR', dimension: 'ending',
        verdict: 'REFERENCE_MATCH', measured: 'designed ending card', band: null, evidence: 'matches the designed-ending tendency',
      }));
    }
  }

  return deepFreeze({
    schema: 'vidtoolz.styleReferenceAdvisoryReport.v1',
    tier: 'ADVISORY_ONLY',
    style_binding: loaded.binding,
    no_aggregate_score: true,
    findings,
  });
}

module.exports = {
  ADAPTER_SCHEMA,
  REFERENCE_SCHEMA,
  ADVISORY_PREAMBLE,
  AUTHORITY_TIER,
  AUTHORITY_RANK,
  VERDICTS,
  FINDING_STATUSES,
  ACTIVE_LEVEL_C_CLASSES,
  MEANINGFUL_EVENT_CLASSES,
  NEVER_MEANINGFUL_EVENT_CLASSES,
  CONTINUOUS_MOTION_NON_EVENT_CLASSES,
  EVENT_KIND_ALIASES,
  normalizeEventKind,
  admitSemanticEvents,
  admitMeasuredEvents,
  countMacroStates,
  classifyProgrammeLevels,
  CONFIRMING_SIGNAL_CLASSES,
  StyleReferenceError,
  sha256,
  loadContract,
  loadStyleReference,
  patternPowers,
  projectForRole,
  densityGroup,
  evaluateAdvisory,
};
