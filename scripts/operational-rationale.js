'use strict';

const FIELDS = Object.freeze(['source', 'decision', 'reason', 'evidence_refs', 'confidence', 'escalation_reason']);
const SOURCES = Object.freeze(['AGENT', 'DERIVED']);
const CONFIDENCE_LABELS = Object.freeze(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
const MAX_TEXT_LENGTH = 600;
const MAX_REF_LENGTH = 256;
const MAX_EVIDENCE_REFS = 20;

function text(value, maximum = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null || value === '' || typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function evidenceRef(value) {
  if (typeof value === 'string') return text(value, MAX_REF_LENGTH);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !['ref', 'summary'].includes(key))) return null;
  const ref = text(value.ref, MAX_REF_LENGTH);
  if (!ref) return null;
  const out = { ref };
  const summary = text(value.summary);
  if (summary) out.summary = summary;
  return out;
}

function normalizeOperationalRationale(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !FIELDS.includes(key))) return null;
  const source = value.source === undefined ? 'AGENT' : text(value.source);
  const decision = text(value.decision);
  const reason = text(value.reason);
  if (!SOURCES.includes(source) || !decision || !reason || !Array.isArray(value.evidence_refs)
      || value.evidence_refs.length > MAX_EVIDENCE_REFS) return null;
  const evidence_refs = value.evidence_refs.map(evidenceRef);
  if (evidence_refs.some((ref) => ref === null)) return null;
  let confidence = null;
  if (value.confidence !== undefined && value.confidence !== null) {
    if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        && value.confidence >= 0 && value.confidence <= 1) confidence = value.confidence;
    else if (typeof value.confidence === 'string' && CONFIDENCE_LABELS.includes(value.confidence)) confidence = value.confidence;
    else return null;
  }
  const escalation_reason = text(value.escalation_reason);
  if (value.escalation_reason != null && !escalation_reason) return null;
  return { source, decision, reason, evidence_refs, confidence, escalation_reason };
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
    source: 'DERIVED',
    decision: state,
    reason: blocker || `${state} requires ${level} attention`,
    evidence_refs: projectionEvidenceRefs(view),
    confidence: null,
    escalation_reason: level === 'REVIEW' || level === 'DECISION' ? blocker : null,
  };
}

module.exports = {
  FIELDS, SOURCES, CONFIDENCE_LABELS, MAX_TEXT_LENGTH, MAX_REF_LENGTH, MAX_EVIDENCE_REFS,
  normalizeOperationalRationale, deriveOperationalRationale, projectionEvidenceRefs,
};
