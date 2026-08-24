'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IMPLEMENTATION_STATES = Object.freeze(['CANDIDATE', 'IMPLEMENTATION_PROVEN']);

function modulePathFor(root, agentId) {
  return path.join(path.resolve(root), 'scripts', `${String(agentId).replaceAll('_', '-')}.js`);
}

function implementationReadiness(root, registration) {
  const lifecycle = registration?.lifecycle || {};
  const implementationState = registration?.implementation_state ?? null;
  const modulePath = modulePathFor(root, registration?.agent_id || 'invalid');
  let moduleExists = false;
  try { moduleExists = fs.existsSync(modulePath); } catch (_) { moduleExists = false; }

  if (lifecycle.proven !== 'PROVEN' || lifecycle.autonomous_dispatch !== 'ENABLED') {
    return {
      authorized: false, code: 'BLOCKED_AGENT_NOT_ENABLED', module_exists: moduleExists,
      implementation_state: implementationState, module_path: modulePath,
      reason: lifecycle.dispatch_blocked_reason || (registration?.lifecycle
        ? 'agent lifecycle does not authorize autonomous dispatch'
        : 'agent registration carries no lifecycle block'),
    };
  }
  if (implementationState !== 'IMPLEMENTATION_PROVEN') {
    return {
      authorized: false, code: 'BLOCKED_IMPLEMENTATION_NOT_PROVEN', module_exists: moduleExists,
      implementation_state: implementationState, module_path: modulePath,
      reason: implementationState === 'CANDIDATE'
        ? 'implementation is a proof candidate and is not authorized for production dispatch'
        : 'implementation readiness is missing or not canonically proven',
    };
  }
  if (!moduleExists) {
    return {
      authorized: false, code: 'BLOCKED_IMPLEMENTATION_MISSING', module_exists: false,
      implementation_state: implementationState, module_path: modulePath,
      reason: 'implementation is marked proven but the canonical module is missing',
    };
  }
  return {
    authorized: true, code: null, module_exists: true,
    implementation_state: implementationState, module_path: modulePath, reason: null,
  };
}

module.exports = { IMPLEMENTATION_STATES, modulePathFor, implementationReadiness };
