#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const ATTENTION_PRIORITY = Object.freeze({ DECISION: 0, REVIEW: 1 });
const IDLE_STATES = new Set(['COMPLETE', 'IDLE', 'READY', 'NO_RUNTIME_STATE', 'UNAVAILABLE', 'PLANNED_NOT_ENABLED']);
const JSON_READ_CAP = 16 * 1024 * 1024;
const INDEX_READ_CAP = 4 * 1024 * 1024;

function readBytes(filePath, label, cap = JSON_READ_CAP) {
  const size = fs.statSync(filePath).size;
  if (size > cap) throw new Error(`${label} exceeds the ${cap}-byte read limit`);
  return fs.readFileSync(filePath);
}

function readJson(filePath, label, cap) {
  let value;
  try {
    value = JSON.parse(readBytes(filePath, label, cap).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} unavailable: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function containedPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function regularFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (_error) {
    return false;
  }
}

function safeTaskDirectory(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part));
}

function discoveryDiagnostic(discovery, code, detail = {}) {
  discovery.ignored_records += 1;
  if (discovery.diagnostics.length < 100) discovery.diagnostics.push({ code, ...detail });
  else discovery.diagnostics_truncated = true;
}

function runnerContextFromRecord(root, runId, agentsRoot, record, discovery) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || typeof record.agent_id !== 'string' || typeof record.task_id !== 'string'
      || !safeTaskDirectory(record.task_directory)) {
    discoveryDiagnostic(discovery, 'RUNNER_INDEX_RECORD_INVALID', { run_id: runId });
    return null;
  }
  const taskDirectory = path.resolve(agentsRoot, record.task_directory);
  if (record.task_directory.split('/')[0] !== record.agent_id || !containedPath(agentsRoot, taskDirectory)) {
    discoveryDiagnostic(discovery, 'RUNNER_PATH_ESCAPE_REJECTED', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  let realTaskDirectory;
  try {
    const taskStat = fs.lstatSync(taskDirectory);
    if (!taskStat.isDirectory() || taskStat.isSymbolicLink()) throw new Error('not a regular directory');
    realTaskDirectory = fs.realpathSync(taskDirectory);
    if (!containedPath(fs.realpathSync(agentsRoot), realTaskDirectory)) throw new Error('resolved outside agents root');
  } catch (_error) {
    discoveryDiagnostic(discovery, 'RUNNER_INVOCATION_DIRECTORY_INVALID', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  const invocationPath = path.join(realTaskDirectory, 'invocation.json');
  if (!regularFile(invocationPath)) {
    discoveryDiagnostic(discovery, 'RUNNER_INVOCATION_INCOMPLETE', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  let invocation;
  try {
    invocation = readJson(invocationPath, 'runner invocation');
  } catch (error) {
    discoveryDiagnostic(discovery, 'RUNNER_INVOCATION_MALFORMED', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id, reason: error.message });
    return null;
  }
  if (invocation.agent_id !== record.agent_id || invocation.task_id !== record.task_id
      || invocation.invocation_id !== record.invocation_id || invocation.attempt_number !== record.attempt_number
      || invocation.infrastructure_state !== 'COMPLETE'
      || typeof invocation.ended_at !== 'string' || !Number.isFinite(Date.parse(invocation.ended_at))
      || (record.completed_at && record.completed_at !== invocation.ended_at)) {
    discoveryDiagnostic(discovery, 'RUNNER_INVOCATION_IDENTITY_INVALID', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  const taskPath = path.join(realTaskDirectory, 'task.json');
  const resultPath = path.join(realTaskDirectory, 'result.json');
  if (!regularFile(taskPath) || !regularFile(resultPath)) {
    discoveryDiagnostic(discovery, 'RUNNER_EVIDENCE_MISSING', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  let task;
  let result;
  let taskBytes;
  let resultBytes;
  try {
    taskBytes = readBytes(taskPath, 'runner task');
    resultBytes = readBytes(resultPath, 'runner result');
    task = JSON.parse(taskBytes.toString('utf8'));
    result = JSON.parse(resultBytes.toString('utf8'));
  } catch (error) {
    discoveryDiagnostic(discovery, 'RUNNER_EVIDENCE_MALFORMED', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id, reason: error.message });
    return null;
  }
  if (!task || !result || typeof task !== 'object' || typeof result !== 'object'
      || (task.agent_id !== undefined && task.agent_id !== record.agent_id) || task.task_id !== record.task_id
      || (task.package_run_id !== undefined && task.package_run_id !== runId)
      || result.agent_id !== record.agent_id || result.task_id !== record.task_id
      || typeof result.state !== 'string' || !Array.isArray(result.events)
      || !result.control_room || typeof result.control_room !== 'object'
      || invocation.semantic_state !== result.state || record.state !== result.state
      || !/^[a-f0-9]{64}$/.test(invocation.task_sha256 || '') || invocation.task_sha256 !== sha256(taskBytes)
      || !/^[a-f0-9]{64}$/.test(invocation.result_sha256 || '') || invocation.result_sha256 !== sha256(resultBytes)) {
    discoveryDiagnostic(discovery, 'RUNNER_EVIDENCE_IDENTITY_INVALID', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
    return null;
  }
  let extractedArtifact = null;
  if (Array.isArray(invocation.artifacts)) {
    for (const artifact of invocation.artifacts) {
      if (!artifact || typeof artifact.field !== 'string' || !safeTaskDirectory(artifact.path)
          || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
        discoveryDiagnostic(discovery, 'RUNNER_ARTIFACT_REFERENCE_INVALID', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id });
        continue;
      }
      const artifactPath = path.resolve(realTaskDirectory, artifact.path);
      let artifactValid = false;
      try {
        artifactValid = containedPath(realTaskDirectory, artifactPath) && regularFile(artifactPath)
          && sha256(readBytes(artifactPath, 'runner artifact')) === artifact.sha256;
      } catch (_error) { artifactValid = false; }
      if (!artifactValid) {
        discoveryDiagnostic(discovery, 'RUNNER_ARTIFACT_REFERENCE_STALE', { run_id: runId, agent_id: record.agent_id, task_id: record.task_id, field: artifact.field });
        continue;
      }
      if (!extractedArtifact) extractedArtifact = {
        field: artifact.field, path: path.relative(root, artifactPath), sha256: artifact.sha256,
      };
    }
  }
  const handoff = invocation.handoff_summary && typeof invocation.handoff_summary === 'object'
    ? invocation.handoff_summary : {};
  const view = result.control_room;
  const event = view.latest_event || result.events[result.events.length - 1] || null;
  return {
    run_id: runId,
    package_run_id: oneLine(task.package_run_id) || runId,
    project_id: oneLine(task.project_id || result.project_id),
    agent_id: record.agent_id,
    task_id: record.task_id,
    state: result.state,
    attention: oneLine(result.attention || view.attention_level || view.attention || handoff.attention) || 'INFORMATION',
    owner: oneLine(view.owner) || record.agent_id,
    next_owner: oneLine(handoff.next_owner || result.handoff?.next_owner || result.next_owner || view.next_owner),
    blocker: oneLine(handoff.blocker || result.reason || view.blocker),
    // The contract's control_room_contract requires unresolved disagreement and
    // resource dependency per agent. Both are reported by the specialist in its
    // own control_room projection, so runner evidence must carry them through
    // rather than dropping the only signal that specialists disagree.
    disagreement: oneLine(view.unresolved_disagreement || view.disagreement),
    resource_dependency: oneLine(view.resource_dependency),
    latest_event: event,
    current_artifact: currentArtifact(view) || extractedArtifact,
    started_at: oneLine(invocation.started_at),
    completed_at: invocation.ended_at,
    completed_epoch: Date.parse(invocation.ended_at),
    invocation_id: oneLine(record.invocation_id),
    attempt_number: record.attempt_number,
    infrastructure_state: oneLine(invocation.infrastructure_state),
    semantic_state: oneLine(invocation.semantic_state) || result.state,
    exit_code: invocation.exit_code,
    module_path: oneLine(invocation.module_path),
    repository_head: oneLine(invocation.repository_head),
    human_gate: Boolean(handoff.human_gate),
    next_action: oneLine(handoff.next_action),
    next_owner_implementation_at_completion: oneLine(handoff.next_owner_implementation),
    auto_executed: handoff.auto_executed === true || invocation.automatic_chain_count > 0,
    sort_key: `${runId}\u0000${record.task_id}\u0000${String(record.attempt_number || 0).padStart(8, '0')}\u0000${record.invocation_id || ''}`,
  };
}

function discoverRunnerContexts(root, registeredIds) {
  const discovery = {
    source: 'package-runs/*/agents/index.json', scanned_runs: 0, indexes_found: 0,
    valid_invocations: 0, ignored_records: 0, diagnostics: [], diagnostics_truncated: false,
  };
  const latestByAgent = new Map();
  const seen = new Set();
  const packageRunsRoot = path.join(root, 'package-runs');
  let entries = [];
  try { entries = fs.readdirSync(packageRunsRoot, { withFileTypes: true }); } catch (_error) { return { latestByAgent, discovery }; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    discovery.scanned_runs += 1;
    const runId = entry.name;
    const agentsRoot = path.join(packageRunsRoot, runId, 'agents');
    try {
      const agentsStat = fs.lstatSync(agentsRoot);
      if (!agentsStat.isDirectory() || agentsStat.isSymbolicLink()) continue;
    } catch (_error) { continue; }
    const indexPath = path.join(agentsRoot, 'index.json');
    if (!regularFile(indexPath)) continue;
    discovery.indexes_found += 1;
    let index;
    try { index = readJson(indexPath, 'runner index', INDEX_READ_CAP); } catch (error) {
      discoveryDiagnostic(discovery, 'RUNNER_INDEX_MALFORMED', { run_id: runId, reason: error.message });
      continue;
    }
    if (!Array.isArray(index.invocations)) {
      discoveryDiagnostic(discovery, 'RUNNER_INDEX_INVALID', { run_id: runId });
      continue;
    }
    for (const record of index.invocations) {
      const context = runnerContextFromRecord(root, runId, agentsRoot, record, discovery);
      if (!context) continue;
      const evidenceKey = `${runId}\u0000${context.agent_id}\u0000${context.task_id}\u0000${context.invocation_id || context.attempt_number || ''}`;
      if (seen.has(evidenceKey)) {
        discoveryDiagnostic(discovery, 'RUNNER_DUPLICATE_INVOCATION', { run_id: runId, agent_id: context.agent_id, task_id: context.task_id });
        continue;
      }
      seen.add(evidenceKey);
      if (!registeredIds.has(context.agent_id)) {
        discoveryDiagnostic(discovery, 'UNREGISTERED_AGENT_EVIDENCE', { run_id: runId, agent_id: context.agent_id, task_id: context.task_id });
        continue;
      }
      discovery.valid_invocations += 1;
      const prior = latestByAgent.get(context.agent_id);
      if (!prior || context.completed_epoch > prior.completed_epoch
          || (context.completed_epoch === prior.completed_epoch && context.sort_key.localeCompare(prior.sort_key) > 0)) {
        latestByAgent.set(context.agent_id, context);
      }
    }
  }
  return { latestByAgent, discovery };
}

function modulePathFor(root, agentId) {
  return path.join(root, 'scripts', `${agentId.replaceAll('_', '-')}.js`);
}

// Registry presence proves doctrine, never executability. A role whose
// lifecycle does not grant autonomous dispatch is never inspected, loaded, or
// run by the read-only control room, and never presented as a live specialist.
// A registration with no lifecycle block predates the lifecycle contract and
// keeps its previous behavior; the contract validator is what forbids that.
function dispatchEnabled(agent) {
  const lifecycle = agent && typeof agent.lifecycle === 'object' && !Array.isArray(agent.lifecycle) ? agent.lifecycle : null;
  if (!lifecycle) return true;
  return lifecycle.proven === 'PROVEN' && lifecycle.autonomous_dispatch === 'ENABLED';
}

function notEnabledImplementation(root, agent) {
  return {
    state: 'DISPATCH_NOT_ENABLED', module_path: path.relative(root, modulePathFor(root, agent.agent_id)),
    status_action_supported: false, control_room_view_supported: false,
    reason: agent.lifecycle?.dispatch_blocked_reason
      || 'Doctrine is registered but autonomous dispatch is not enabled for this role.',
  };
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

function normalizedAttention(value) {
  const attention = String(value || 'INFORMATION').toUpperCase();
  return ['AUTONOMOUS', 'INFORMATION', 'REVIEW', 'DECISION'].includes(attention) ? attention : 'INFORMATION';
}

function normalizeRunnerProjection(agent, implementation, context, implementationsById) {
  const attention = normalizedAttention(context.attention);
  const nextImplementation = context.next_owner && implementationsById.has(context.next_owner)
    ? implementationsById.get(context.next_owner) : null;
  return {
    agent_id: agent.agent_id, name: agent.name, role: agent.role,
    registry_index: agent.registry_index, registry_status: 'REGISTERED',
    implementation,
    runtime_source: 'AGENT_RUNNER',
    runtime_status: 'LATEST_COMPLETED_INVOCATION',
    runtime_active: false,
    state: context.state,
    run_id: context.run_id,
    package_run_id: context.package_run_id,
    project_id: context.project_id,
    task_id: context.task_id,
    current_task: context.task_id,
    owner: context.owner,
    next_owner: context.next_owner,
    attention,
    blocker: context.blocker,
    disagreement: context.disagreement ?? null,
    resource_dependency: context.resource_dependency ?? null,
    current_artifact: context.current_artifact,
    latest_event: context.latest_event,
    started_at: context.started_at,
    completed_at: context.completed_at,
    human_decision_required: attention === 'DECISION' || /HUMAN_DECISION/.test(context.state),
    review_required: attention === 'REVIEW' || /HUMAN_REVIEW/.test(context.state),
    human_gate: context.human_gate,
    automatic_chaining: context.auto_executed,
    invocation: {
      invocation_id: context.invocation_id,
      attempt_number: context.attempt_number,
      infrastructure_state: context.infrastructure_state,
      semantic_state: context.semantic_state,
      exit_code: context.exit_code,
      module_path: context.module_path,
      repository_head: context.repository_head,
    },
    handoff: {
      next_action: context.next_action,
      human_gate: context.human_gate,
      automatic_chaining: context.auto_executed,
      implementation_at_completion: context.next_owner_implementation_at_completion,
      current_implementation_state: nextImplementation?.state || (context.next_owner ? 'NOT_REGISTERED' : null),
      current_implementation_reason: nextImplementation?.reason || null,
    },
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

async function agentProjection(root, agent, inspected, runtimeContext, implementationsById, options) {
  const publicImplementation = { ...inspected };
  delete publicImplementation.implementation;
  if (!dispatchEnabled(agent)) {
    return {
      ...unavailableProjection(agent, publicImplementation, 'PLANNED_NOT_ENABLED', publicImplementation.reason),
      registry_status: 'DOCTRINE_REGISTERED',
      lifecycle: {
        doctrine: agent.lifecycle?.doctrine ?? null,
        proven: agent.lifecycle?.proven ?? null,
        autonomous_dispatch: agent.lifecycle?.autonomous_dispatch ?? null,
      },
    };
  }
  if (runtimeContext) {
    const publicImplementations = new Map();
    for (const [id, value] of implementationsById) {
      const publicValue = { ...value };
      delete publicValue.implementation;
      publicImplementations.set(id, publicValue);
    }
    return normalizeRunnerProjection(agent, publicImplementation, runtimeContext, publicImplementations);
  }
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
  const implementationsById = new Map(registered.map((agent) => [
    agent.agent_id,
    dispatchEnabled(agent) ? inspectImplementation(root, agent, options) : notEnabledImplementation(root, agent),
  ]));
  const { latestByAgent, discovery } = discoverRunnerContexts(root, ids);
  const agents = sortAgents(await Promise.all(registered.map((agent) => agentProjection(
    root, agent, implementationsById.get(agent.agent_id), latestByAgent.get(agent.agent_id), implementationsById, options,
  ))));
  const counts = agents.reduce((acc, agent) => {
    acc[agent.state] = (acc[agent.state] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: 1, artifact_type: 'agent-control-room', read_only: true,
    generated_at: (options.now || (() => new Date().toISOString()))(),
    registry: { schema_version: registry.schema_version, registered_count: registered.length },
    runtime_discovery: discovery,
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
      counts,
      dispatch_enabled: agents.filter((a) => a.state !== 'PLANNED_NOT_ENABLED').length,
      doctrine_only: agents.filter((a) => a.state === 'PLANNED_NOT_ENABLED').length,
      decision: agents.filter((a) => a.attention === 'DECISION').length,
      review: agents.filter((a) => a.attention === 'REVIEW').length,
      unavailable: agents.filter((a) => a.state === 'UNAVAILABLE').length,
      runtime_state_missing: agents.filter((a) => a.state === 'NO_RUNTIME_STATE').length,
      runner_context: agents.filter((a) => a.runtime_source === 'AGENT_RUNNER').length,
    },
  };
}

module.exports = {
  modulePathFor, inspectImplementation, normalizeProjection, sortAgents,
  discoverRunnerContexts, normalizeRunnerProjection, plannedRoles, buildAgentControlRoom,
};
