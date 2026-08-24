'use strict';

const NON_HUMAN_ID = /(^|[._-])(agent|hermes|codex|claude)([._-]|$)|director|editor|supervisor/i;

function verifyLocalHumanApprover(value) {
  return typeof value === 'string' && value.trim().length > 0 && !NON_HUMAN_ID.test(value.trim());
}

function canonicalStoryApprover(project, version) {
  return version?.approval?.approved_by || project?.approved_version?.approved_by || null;
}

module.exports = { verifyLocalHumanApprover, canonicalStoryApprover };
