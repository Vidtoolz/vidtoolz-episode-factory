#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const ATTENTION_PRIORITY = Object.freeze({ DECISION: 0, REVIEW: 1 });
const IDLE_STATES = new Set(['COMPLETE', 'IDLE', 'READY', 'NO_RUNTIME_STATE', 'UNAVAILABLE']);

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} unavailable: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function modulePathFor(root, agentId) {
  return path.join(root, 'scripts', `${agentId.replaceAll('_', '-')}.js`);
}

function inspectImplementation(root, agent, options = {}) {
  const modulePath = modulePathFor(root, agent.agent_id);
  if (!fs.existsSync(modulePath)) {
    return {
      state: 'IMPLEMENTATION_MISSING', module_path: path.relative(root, modulePath),
      status_action_supported: false, control_room_view_supported: false,
      reason: 'No general registered-agent implementation module exists at the canonical convention path.',
    };
  }
  const source = fs.readFileSync(modulePath, 'utf8');
  if (!/require\.main\s*===\s*module/.test(source)) {
    return {
      state: 'UNSAFE_TO_IMPORT', module_path: path.relative(root, modulePath),
      status_action_supported: /["']status["']/.test(source), control_room_view_supported: /controlRoomView/.test(source),
      reason: 'Module executes on import, so the read-only control room will not load or run it.',
    };
  }
  try {
    const implementation = options.implementationLoader
      ? options.implementationLoader(agent, modulePath)
      : require(modulePath);
    const actions = Array.isArray(implementation.ACTIONS) ? implementation.ACTIONS : [];
    const statusSupported = actions.includes('status') || /["']status["']/.test(source);
    const viewSupported = typeof implementation.controlRoomView === 'function';
    const runSupported = typeof implementation.run === 'function';
    return {
      state: statusSupported && viewSupported && runSupported ? 'AVAILABLE' : 'STATUS_UNSUPPORTED',
      module_path: path.relative(root, modulePath), status_action_supported: statusSupported,
      control_room_view_supported: viewSupported, reason: statusSupported && viewSupported && runSupported
        ? null
        : 'Module does not expose the complete status action + controlRoomView runtime surface.',
      implementation,
    };
  } catch (error) {
    return {
      state: 'IMPLEMENTATION_UNUSABLE', module_path: path.relative(root, modulePath),
      status_action_supported: false, control_room_view_supported: false,
      reason: `Implementation load failed: ${error.message}`,
    };
  }
}

function oneLine(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ') || null;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value === undefined || value === null || value === '' ? null : String(value);
}

function currentArtifact(view) {
  const value = view.current_artifact || view.edit_plan || view.current_cue_or_artifact
    || view.current_result_id || view.plan_id || view.package_id || null;
  return value && typeof value === 'object' ? value : oneLine(value);
}

function normalizeProjection(agent, implementation, view) {
  if (!view || typeof view !== 'object' || Array.isArray(view) || typeof view.state !== 'string' || !view.state.trim()) {
    throw new Error('controlRoomView returned a malformed projection without a state');
  }
  const attention = String(view.attention_level || view.attention || 'INFORMATION').toUpperCase();
  const normalizedAttention = ['AUTONOMOUS', 'INFORMATION', 'REVIEW', 'DECISION'].includes(attention)
    ? attention : 'INFORMATION';
  const state = view.state.trim();
  return {
    agent_id: agent.agent_id, name: agent.name, role: view.role || agent.role,
    registry_index: agent.registry_index, registry_status: 'REGISTERED',
    implementation: implementation,
    state,
    current_task: oneLine(view.current_task || view.task_id || view.action),
    owner: oneLine(view.owner) || agent.agent_id,
    next_owner: oneLine(view.next_owner),
    attention: normalizedAttention,
    blocker: oneLine(view.blocker),
    disagreement: oneLine(view.unresolved_disagreement || view.disagreement),
    resource_dependency: oneLine(view.resource_dependency),
    current_artifact: currentArtifact(view),
    latest_event: view.latest_event || null,
    human_decision_required: normalizedAttention === 'DECISION' || /HUMAN_DECISION/.test(state),
    review_required: normalizedAttention === 'REVIEW' || /HUMAN_REVIEW/.test(state),
  };
}

function unavailableProjection(agent, implementation, state, blocker) {
  return {
    agent_id: agent.agent_id, name: agent.name, role: agent.role,
    registry_index: agent.registry_index, registry_status: 'REGISTERED',
    implementation: { ...implementation, implementation: undefined },
    state, current_task: null, owner: agent.agent_id, next_owner: null,
    attention: 'INFORMATION', blocker, disagreement: null,
    resource_dependency: null, current_artifact: null, latest_event: null,
    human_decision_required: false, review_required: false,
  };
}

function rankAgent(agent) {
  if (ATTENTION_PRIORITY[agent.attention] !== undefined) return ATTENTION_PRIORITY[agent.attention];
  if (agent.state === 'BLOCKED' || agent.state === 'UNAVAILABLE' || /MISSING|UNUSABLE/.test(agent.implementation.state)) return 2;
  if (!IDLE_STATES.has(agent.state)) return 3;
  return 4;
}

function sortAgents(agents) {
  return agents.sort((a, b) => rankAgent(a) - rankAgent(b) || a.registry_index - b.registry_index);
}

async function agentProjection(root, agent, options) {
  const inspected = inspectImplementation(root, agent, options);
  const publicImplementation = { ...inspected };
  delete publicImplementation.implementation;
  if (inspected.state !== 'AVAILABLE') {
    return unavailableProjection(agent, publicImplementation, 'UNAVAILABLE', inspected.reason);
  }
  const task = typeof options.statusTaskProvider === 'function'
    ? await options.statusTaskProvider(agent)
    : null;
  if (!task) {
    return unavailableProjection(
      agent, publicImplementation, 'NO_RUNTIME_STATE',
      'No canonical current-task/status context is available; the status action was not invoked with fabricated input.',
    );
  }
  try {
    const result = await inspected.implementation.run(task, options.agentRunOptions?.[agent.agent_id] || {});
    const view = inspected.implementation.controlRoomView(result);
    return normalizeProjection(agent, publicImplementation, view);
  } catch (error) {
    return unavailableProjection(
      agent, { ...publicImplementation, state: 'STATUS_INVOCATION_FAILED', reason: error.message },
      'UNAVAILABLE', `Status invocation failed: ${error.message}`,
    );
  }
}

function plannedRoles(contract, registeredIds) {
  return (contract.role_roster || [])
    .filter((role) => !registeredIds.has(role.role_id))
    .map((role) => ({
      role_id: role.role_id, name: role.role_name, architecture_status: role.status,
      runtime_status: 'PLANNED_NOT_REGISTERED', specialist: true,
    }));
}

async function buildAgentControlRoom(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const registry = options.registry || readJson(path.join(root, 'config', 'agent-registry.json'), 'agent registry');
  const contract = options.contract || readJson(path.join(root, 'config', 'agent-contract.json'), 'agent contract');
  if (!Array.isArray(registry.agents)) throw new Error('agent registry agents must be an array');
  const ids = new Set();
  const registered = registry.agents.map((entry, index) => {
    if (!entry || typeof entry.agent_id !== 'string' || !entry.agent_id || ids.has(entry.agent_id)) {
      throw new Error('agent registry contains a missing or duplicate agent_id');
    }
    ids.add(entry.agent_id);
    return { ...entry, registry_index: index };
  });
  const agents = sortAgents(await Promise.all(registered.map((agent) => agentProjection(root, agent, options))));
  const counts = agents.reduce((acc, agent) => {
    acc[agent.state] = (acc[agent.state] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: 1, artifact_type: 'agent-control-room', read_only: true,
    generated_at: (options.now || (() => new Date().toISOString()))(),
    registry: { schema_version: registry.schema_version, registered_count: registered.length },
    agents,
    planned_roles: plannedRoles(contract, ids),
    non_agent_roles: {
      hermes: contract.hermes ? {
        role_id: contract.hermes.role_id, name: contract.hermes.role_name,
        is_agent: false, is_specialist: false, purpose: 'Executive Producer / router',
      } : null,
      knowledge_steward: contract.knowledge_steward ? {
        role_id: contract.knowledge_steward.role_id, name: contract.knowledge_steward.role_name,
        architecture_status: contract.knowledge_steward.status,
        is_specialist: false, is_heavyweight_agent: false,
      } : null,
    },
    summary: {
      counts, decision: agents.filter((a) => a.attention === 'DECISION').length,
      review: agents.filter((a) => a.attention === 'REVIEW').length,
      unavailable: agents.filter((a) => a.state === 'UNAVAILABLE').length,
      runtime_state_missing: agents.filter((a) => a.state === 'NO_RUNTIME_STATE').length,
    },
  };
}

module.exports = {
  modulePathFor, inspectImplementation, normalizeProjection, sortAgents,
  plannedRoles, buildAgentControlRoom,
};
