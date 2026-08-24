'use strict';

// Presentation-only contract for operator previews. This never replaces the
// authoritative specialist validation payload and never carries approval.

const SCHEMA_VERSION = 1;
const MAX_TEXT = 600;

class HumanChangePreviewError extends Error {
  constructor(code, message) { super(message); this.name = 'HumanChangePreviewError'; this.code = code; }
}

function text(value, label, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', `${label} must be text`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if ((required && !normalized) || normalized.length > MAX_TEXT) throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', `${label} is empty or too long`);
  return normalized || null;
}

function list(value, label, mapper) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', `${label} must be a bounded array`);
  return value.map(mapper);
}

function scalar(value, label) {
  if (typeof value === 'string' && value.length > 4000) throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', `${label} is too long`);
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value) && value.length <= 20 && value.every((item) => item == null || ['number', 'boolean'].includes(typeof item) || (typeof item === 'string' && item.length <= 1000))) return value;
  throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', `${label} must be an operator-readable scalar value`);
}

function buildHumanChangePreview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', 'preview input must be an object');
  const technical = input.technical_details && typeof input.technical_details === 'object' && !Array.isArray(input.technical_details)
    ? structuredClone(input.technical_details) : {};
  const serializedTechnical = JSON.stringify(technical);
  if (serializedTechnical.length > 12000 || /"(?:chain_of_thought|hidden_reasoning|internal_reasoning)"\s*:/i.test(serializedTechnical)) {
    throw new HumanChangePreviewError('HUMAN_CHANGE_PREVIEW_INVALID', 'technical details are unbounded or contain private reasoning');
  }
  const preview = {
    schema_version: SCHEMA_VERSION,
    kind: 'human_change_preview',
    title: text(input.title, 'title', true),
    summary: text(input.summary, 'summary', true),
    changed_fields: list(input.changed_fields, 'changed_fields', (item, index) => ({
      label: text(item?.label, `changed_fields[${index}].label`, true),
      before: scalar(item?.before, `changed_fields[${index}].before`),
      after: scalar(item?.after, `changed_fields[${index}].after`),
      significance: text(item?.significance, `changed_fields[${index}].significance`),
    })),
    system_changes: list(input.system_changes, 'system_changes', (item, index) => text(item, `system_changes[${index}]`, true)),
    stale_consequences: list(input.stale_consequences, 'stale_consequences', (item, index) => text(item, `stale_consequences[${index}]`, true)),
    warnings: list(input.warnings, 'warnings', (item, index) => text(item, `warnings[${index}]`, true)),
    next_action: text(input.next_action, 'next_action', true),
    technical_details: technical,
  };
  return Object.freeze(preview);
}

module.exports = { SCHEMA_VERSION, HumanChangePreviewError, buildHumanChangePreview };
