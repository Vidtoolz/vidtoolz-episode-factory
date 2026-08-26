'use strict';

// Reject role/agent identities across ordinary separators as well as machine
// identifiers. The former expression missed values such as "Claude agent"
// because a space was not treated as an identity boundary.
const NON_HUMAN_ID = /(^|[^a-z0-9])(agent|hermes|codex|claude)([^a-z0-9]|$)|director|editor|supervisor/i;

function verifyLocalHumanApprover(value) {
  return typeof value === 'string' && value.trim().length > 0 && !NON_HUMAN_ID.test(value.trim());
}

function canonicalStoryApprover(project, version) {
  return version?.approval?.approved_by || project?.approved_version?.approved_by || null;
}

module.exports = { verifyLocalHumanApprover, canonicalStoryApprover };
