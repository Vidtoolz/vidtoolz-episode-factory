'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REFUSAL = 'BLOCKED_AGENT_NOT_ENABLED';

function executableLifecycle(agentId, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'agent-registry.json'), 'utf8'));
  const registration = Array.isArray(registry.agents)
    ? registry.agents.find((agent) => agent.agent_id === agentId)
    : null;
  if (!registration) return { allowed: false, code: 'RUNNER_AGENT_UNKNOWN', agent_id: agentId, reason: 'agent is not registered' };
  const lifecycle = registration.lifecycle || {};
  if (lifecycle.proven !== 'PROVEN' || lifecycle.autonomous_dispatch !== 'ENABLED') {
    return {
      allowed: false, code: REFUSAL, agent_id: agentId,
      reason: `registered doctrine exists but autonomous dispatch is not enabled: ${agentId}`,
      lifecycle: {
        proven: lifecycle.proven ?? null,
        autonomous_dispatch: lifecycle.autonomous_dispatch ?? null,
        dispatch_blocked_reason: lifecycle.dispatch_blocked_reason ?? null,
      },
    };
  }
  return { allowed: true, code: null, agent_id: agentId, lifecycle: { proven: lifecycle.proven, autonomous_dispatch: lifecycle.autonomous_dispatch } };
}

function guardExecutableLifecycle(agentId, options = {}) {
  const result = executableLifecycle(agentId, options);
  if (result.allowed) return true;
  (options.stdout || process.stdout).write(`${JSON.stringify({
    runner_version: 'agent-runner-v1', infrastructure_state: result.code,
    agent_id: agentId, reason: result.reason, details: result.lifecycle || null,
  }, null, 2)}\n`);
  if (options.setExitCode !== false) process.exitCode = 1;
  return false;
}

module.exports = { REFUSAL, executableLifecycle, guardExecutableLifecycle };
