'use strict';

// Downstream intent-contract audit. It consumes normalized director artifacts;
// it deliberately does not parse raw user text or invent missing contracts.
const { auditSequence } = require('./earth-studio-sequence-audit.js');

const STATUS = Object.freeze({ SATISFIED: 'SATISFIED', VIOLATED: 'VIOLATED', UNVERIFIABLE: 'UNVERIFIABLE' });

function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function result(type, source, scope, status, evidence, message) {
  return { type, source, scope, status, evidence: evidence || {}, message: message || null };
}
function actualGrammars(report) { return report.trace.map((b) => norm(b.grammar_actual)); }

function auditIntentContracts(input = {}) {
  const direction = input.direction || {};
  const plan = direction.plan || {};
  const parsed = direction.parsed_intent || {};
  const journey = input.journey || {};
  const shotPlan = input.shotPlan || {};
  const report = input.sequenceReport || auditSequence(input);
  const contracts = [];
  const grammars = actualGrammars(report);
  const planBeats = Array.isArray(plan.beats) ? plan.beats : [];

  const negatives = Array.isArray(parsed.negatives) ? parsed.negatives : [];
  if (negatives.includes('orbit')) {
    const forbidden = planBeats.filter((b) => /orbit/i.test(String(b.grammar || '')));
    const observed = grammars.filter((g) => g.includes('orbit'));
    contracts.push(result('NO_ORBIT', 'user-specified', 'sequence', forbidden.length || observed.length ? STATUS.VIOLATED : STATUS.SATISFIED,
      { parsed_negative: 'orbit', plan_violations: forbidden.map((b) => b.subject), observed_grammars: observed },
      forbidden.length || observed.length ? 'Orbit survived despite an explicit negative constraint.' : 'No orbit grammar or orbit execution was observed.'));
  }
  if (negatives.includes('spiral')) {
    const forbidden = planBeats.filter((b) => /spiral/i.test(String(b.grammar || '')));
    const observed = grammars.filter((g) => g.includes('spiral'));
    contracts.push(result('NO_SPIRAL', 'user-specified', 'sequence', forbidden.length || observed.length ? STATUS.VIOLATED : STATUS.SATISFIED,
      { parsed_negative: 'spiral', plan_violations: forbidden.map((b) => b.subject), observed_grammars: observed },
      forbidden.length || observed.length ? 'Spiral survived despite an explicit negative constraint.' : 'No spiral grammar or spiral execution was observed.'));
  }

  if (plan.continuation) {
    const startIsContinuation = journey.start && journey.start.source === 'continuation';
    const hasCamera = Boolean(plan.continuation.camera && input.continuation && input.continuation.camera);
    const firstIsContinue = planBeats[0] && (planBeats[0].beat === 'CONTINUE' || planBeats[0].purpose === 'CONTINUE');
    const satisfied = startIsContinuation && hasCamera && firstIsContinue && shotSegmentsPresent(shotPlan);
    contracts.push(result('CONTINUE_FROM_PREVIOUS', plan.continuation.provenance || 'carried-over', 'handoff', satisfied ? STATUS.SATISFIED : STATUS.UNVERIFIABLE,
      { plan_continuation: true, journey_start_source: journey.start && journey.start.source, first_beat: planBeats[0] && planBeats[0].beat, exact_camera_present: hasCamera },
      satisfied ? 'Continuation metadata and first semantic handoff are present.' : 'The current artifacts do not prove exact first-frame authority end-to-end.'));
  }

  if (plan.compare_match) {
    const stops = Array.isArray(plan.compare_match.stops) ? plan.compare_match.stops : [];
    const members = stops.map((subject) => report.trace.filter((b) => norm(b.subject) === norm(subject)));
    const present = members.every((m) => m.length > 0);
    const durations = members.map((m) => m.reduce((s, b) => s + b.actual_duration_seconds, 0));
    const matchedDuration = durations.length > 1 && Math.max(...durations) === Math.min(...durations);
    contracts.push(result('MATCHED_COMPARISON', 'user-specified/directorial', 'comparison-group', present ? STATUS.SATISFIED : STATUS.VIOLATED,
      { anchor: plan.compare_match.anchor || null, scale: plan.compare_match.scale || null, stops, durations, matched_duration: matchedDuration },
      present ? 'All declared comparison subjects survive compilation.' : 'A declared comparison subject is absent from the compiled trace.'));
  }

  if (plan.globe && plan.globe.allowed === false) {
    // The current plan records the prohibition, but journey/shot-plan do not
    // carry a globe-scale contract. Do not infer satisfaction from altitude.
    contracts.push(result('NO_GLOBE', 'computed', 'sequence', STATUS.UNVERIFIABLE,
      { plan_allowed: false, reason: plan.globe.reason || null, downstream_field: null },
      'The plan prohibits a globe shot, but downstream artifacts expose no explicit globe-scale field.'));
  }

  planBeats.forEach((beat, index) => {
    const provenance = beat.provenance || {};
    if (provenance.grammar === 'user-specified') {
      const trace = report.trace[index];
      contracts.push(result('EXPLICIT_GRAMMAR', 'user-specified', `beat:${index}`, trace ? STATUS.SATISFIED : STATUS.UNVERIFIABLE,
        { requested: beat.grammar, actual: trace && trace.grammar_actual }, trace ? 'Beat reached compiled timeline.' : 'Beat could not be mapped.'));
    }
    if (provenance.duration === 'user-specified') {
      const trace = report.trace[index];
      const delta = trace && trace.duration_delta_seconds;
      contracts.push(result('EXPLICIT_DURATION', 'user-specified', `beat:${index}`, trace && Math.abs(delta || 0) <= (1 / 30 + 1e-6) ? STATUS.SATISFIED : STATUS.UNVERIFIABLE,
        { requested_seconds: beat.duration_seconds, actual_seconds: trace && trace.actual_duration_seconds, delta_seconds: delta }, trace ? 'Duration survived within frame quantization.' : 'Beat could not be mapped.'));
    }
  });

  const coverage = { total: contracts.length, satisfied: 0, violated: 0, unverifiable: 0 };
  contracts.forEach((c) => { if (c.status === STATUS.SATISFIED) coverage.satisfied += 1; else if (c.status === STATUS.VIOLATED) coverage.violated += 1; else coverage.unverifiable += 1; });
  return { schema_version: 1, contracts, coverage, hard_violations: contracts.filter((c) => c.status === STATUS.VIOLATED), sequence_execution_ok: report.execution_ok };
}

function shotSegmentsPresent(shotPlan) { return Array.isArray(shotPlan.segments) && shotPlan.segments.length > 0; }

module.exports = { STATUS, auditIntentContracts };
