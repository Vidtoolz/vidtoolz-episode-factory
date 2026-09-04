'use strict';
// SCREEN CAPTURE V1 — PRIVACY GATE (secrets BLOCK; never redact-and-continue).
//
// Scans every text surface of a transient capture (process transcript, file
// range, page text) BEFORE finalization. Any secret finding makes the
// disposition CAPTURE_BLOCKED_SENSITIVE_DATA: no raw is finalized, no
// presentation is rendered, no handoff exists. The blocked receipt records only
// detector id/version, category, offset and length — never the matched bytes.
const { SCHEMA, digest, nowIso } = require('./contract.js');

const SCANNER_ID = 'vidtoolz-screen-capture-secret-scanner';
const SCANNER_VERSION = '1.0.0';
const SECRET_PATTERNS = Object.freeze([
  { type: 'OPENAI_API_KEY', re: /\bsk-(?:proj-|test-|live-)?[A-Za-z0-9_-]{8,}\b/g },
  { type: 'AWS_ACCESS_KEY_ID', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { type: 'AWS_SECRET_ACCESS_KEY', re: /\bAWS_SECRET_ACCESS_KEY\s*[=:]\s*["']?[^\s"']+/gi },
  { type: 'PRIVATE_TOKEN', re: /\b(?:PRIVATE|ACCESS|AUTH|API|BEARER|SECRET)_?(?:TOKEN|KEY)\s*[=:]\s*["']?[^\s"']{6,}/gi },
  { type: 'GITHUB_TOKEN', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: 'SLACK_TOKEN', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { type: 'PASSWORD', re: /\b(?:PASSWORD|PASSWD|PWD)\s*[=:]\s*["']?[^\s"']+/gi },
  { type: 'URL_CREDENTIALS', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi },
  { type: 'PRIVATE_KEY', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { type: 'BEARER_HEADER', re: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
]);

function scanText(text) {
  const findings = [];
  const value = String(text || '');
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of value.matchAll(pattern.re)) findings.push({ type: pattern.type, offset: match.index, length: match[0].length });
  }
  return findings;
}

// Scan every declared text surface; returns the privacy record fragment used by
// the bundle plus the disposition. Surfaces are { id, text }.
function evaluate(surfaces, policyId) {
  const perSurface = surfaces.map((s) => ({ id: s.id, findings: scanText(s.text) }));
  const findings = perSurface.flatMap((s) => s.findings.map((f) => ({ surface: s.id, ...f })));
  return {
    policy_id: policyId, scanner_id: SCANNER_ID, scanner_version: SCANNER_VERSION,
    disposition: findings.length ? 'BLOCK' : 'ALLOW', findings,
  };
}

// Non-sensitive blocked receipt: categories/offsets only; no matched bytes, no transcript.
function blockedReceipt(spec, specDigest, attemptId, evaluation) {
  const receipt = {
    schema: SCHEMA.blocked, state: 'CAPTURE_BLOCKED_SENSITIVE_DATA', capture_id: spec.capture_id, spec_digest_sha256: specDigest, attempt_id: attemptId,
    scanner_id: evaluation.scanner_id, scanner_version: evaluation.scanner_version, policy_id: evaluation.policy_id,
    categories: [...new Set(evaluation.findings.map((f) => f.type))].sort(),
    findings: evaluation.findings.map((f) => ({ surface: f.surface, type: f.type, offset: f.offset, length: f.length })),
    blocked_at: nowIso(), retained_bytes: 'NONE', human_escalation: (spec.failure_policy && spec.failure_policy.human_escalation) || 'VISUAL_DIRECTOR',
  };
  receipt.receipt_digest_sha256 = digest(receipt);
  return receipt;
}

module.exports = { SCANNER_ID, SCANNER_VERSION, SECRET_PATTERNS, scanText, evaluate, blockedReceipt };
