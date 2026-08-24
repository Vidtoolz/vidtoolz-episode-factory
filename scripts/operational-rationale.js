'use strict';

const FIELDS = Object.freeze(['decision', 'reason', 'evidence_refs', 'confidence', 'escalation_reason']);

function text(value) {
  return value === undefined || value === null || value === '' ? null : String(value).replace(/\s+/g, ' ').trim();
}

function evidenceRef(value) {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = text(value.ref);
  if (!ref) return null;
  const out = { ref };
  const summary = text(value.summary);
  if (summary) out.summary = summary;
  return out;
}

function normalizeOperationalRationale(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !FIELDS.includes(key))) return null;
  const decision = text(value.decision);
  const reason = text(value.reason);
  if (!decision || !reason || !Array.isArray(value.evidence_refs)) return null;
  const evidence_refs = value.evidence_refs.map(evidenceRef);
  if (evidence_refs.some((ref) => ref === null)) return null;
  const confidence = value.confidence === undefined || value.confidence === null
    ? null : (typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1
      ? value.confidence : text(value.confidence));
  if (confidence !== null && confidence === '') return null;
  return { decision, reason, evidence_refs, confidence, escalation_reason: text(value.escalation_reason) };
}

function projectionEvidenceRefs(view = {}) {
  const refs = [];
  for (const [name, value] of [
    ['artifact', view.current_artifact], ['edit_plan', view.edit_plan], ['result', view.current_result_id],
    ['visual_plan', view.plan_id], ['audience_package', view.package_plan_id],
  ]) {
    if (!value) continue;
    refs.push({ ref: name, summary: typeof value === 'object' ? JSON.stringify(value) : String(value) });
  }
  for (const item of view.story_rationale || []) refs.push(evidenceRef(item));
  for (const item of view.package_findings || []) refs.push(evidenceRef(item));
  return refs.filter(Boolean);
}

function deriveOperationalRationale(view = {}, attention = null) {
  const explicit = normalizeOperationalRationale(view.operational_rationale);
  if (explicit) return explicit;
  const level = text(attention || view.attention_level || view.attention) || 'INFORMATION';
  const state = text(view.state) || 'UNKNOWN';
  const blocker = text(view.blocker || view.reason);
  return {
    decision: state,
    reason: blocker || `${state} requires ${level} attention`,
    evidence_refs: projectionEvidenceRefs(view),
    confidence: null,
    escalation_reason: level === 'REVIEW' || level === 'DECISION' ? blocker : null,
  };
}

module.exports = { FIELDS, normalizeOperationalRationale, deriveOperationalRationale, projectionEvidenceRefs };
