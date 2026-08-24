'use strict';

/*
 * Human Decision Queue V2 — obligation semantics.
 *
 * A queue item is an UNRESOLVED HUMAN OBLIGATION bound to one exact
 * invocation, not "the latest result per agent". The V1 aggregation dropped a
 * still-valid DECISION the moment the same agent completed another run (live
 * defect: production_operations storage DECISION pushed off-screen by a later
 * PO infrastructure REVIEW). This module replaces that behavior.
 *
 * Identity binds: run + agent + invocation + task + gate + approval scope +
 * artifact + result hash. Resolution is evidence-derived and audited:
 *
 *   ACTIVE     — unresolved; requires human attention now
 *   SUPERSEDED — the exact obligation was closed by a later canonical
 *                completion of the same task lineage whose result no longer
 *                requires human attention (e.g. proven resume-loop rerun)
 *   RESOLVED   — the exact required approval became VALID, or the owning
 *                workflow withdrew the obligation under policy
 *   STALE      — the run itself is inactive/archived; the obligation is
 *                preserved in history, never silently discarded
 *   INVALID    — the recorded result evidence no longer verifies
 *
 * No human approval is ever fabricated here: approval resolution consumes an
 * externally supplied canonical binding and verifies it against exact bytes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { scopeForAgent, scopeForHumanGate } = require('./approval-scopes.js');

const ATTENTION_RANK = Object.freeze({ AUTONOMOUS: 0, INFORMATION: 1, REVIEW: 2, DECISION: 3 });
const OBLIGATION_ATTENTION = Object.freeze(['REVIEW', 'DECISION']);
const QUEUE_ITEM_STATES = Object.freeze(['ACTIVE', 'RESOLVED', 'SUPERSEDED', 'STALE', 'INVALID']);
const SCOPE_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

class DecisionQueueError extends Error {
  constructor(code, message) { super(message); this.name = 'DecisionQueueError'; this.code = code; }
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function canonicalGate(registration, agentId) {
  return scopeForHumanGate(registration?.human_gate_type) || scopeForAgent(agentId);
}

// Hermes orchestration receipts live under the run's orchestration/ dir
// (Hermes Escalation Bridge V1). A RESUME_ORCHESTRATION receipt bound to this
// obligation's source invocation proves a sanctioned rerun lineage.
function findResumeReceipt(root, obligation) {
  const receiptsPath = path.join(root, 'package-runs', obligation.run_id, 'orchestration', 'hermes-receipts.json');
  const ledger = readJsonSafe(receiptsPath);
  if (!ledger || !Array.isArray(ledger.receipts)) return null;
  return [...ledger.receipts].reverse().find((receipt) => receipt.hermes_action === 'RESUME_ORCHESTRATION'
    && receipt.source_agent_id === obligation.agent_id
    && (receipt.source_invocation_id === obligation.invocation_id || receipt.source_task_id === obligation.task_id)) || null;
}

function artifactBinding(invocation, attemptDir) {
  const artifacts = Array.isArray(invocation.artifacts) ? invocation.artifacts : [];
  return artifacts.map((artifact) => ({
    artifact_id: artifact.field || artifact.artifact_id || null,
    path: artifact.path || null,
    sha256: artifact.sha256 || null,
    exists: artifact.path ? fs.existsSync(path.join(attemptDir, artifact.path)) : false,
  }));
}

function obligationFromInvocation(root, runId, registration, record, attemptDir) {
  const invocation = readJsonSafe(path.join(attemptDir, 'invocation.json'));
  if (!invocation || invocation.infrastructure_state !== 'COMPLETE') return null;
  const handoff = invocation.handoff_summary || {};
  const attention = String(handoff.attention || '').toUpperCase();
  if (!OBLIGATION_ATTENTION.includes(attention)) return null;
  const result = readJsonSafe(path.join(attemptDir, 'result.json'));
  const gate = canonicalGate(registration, record.agent_id) || null;
  return {
    queue_item_id: `${attention}:${runId}:${record.agent_id}:${invocation.invocation_id}`,
    state: 'ACTIVE',
    run_id: runId,
    agent_id: record.agent_id,
    invocation_id: invocation.invocation_id,
    task_id: invocation.task_id,
    predecessor_task_id: invocation.predecessor_task_id || null,
    attention,
    reason: handoff.blocker || invocation.semantic_state || null,
    blocker: handoff.blocker || null,
    human_gate: handoff.human_gate === true,
    owning_gate: gate,
    approval_scope_required: gate,
    semantic_state: invocation.semantic_state || null,
    lifecycle_state: invocation.infrastructure_state,
    dispatch_enabled: dispatchEnabledFor(registration),
    task_sha256: invocation.task_sha256 || null,
    result_sha256: invocation.result_sha256 || null,
    artifacts: artifactBinding(invocation, attemptDir),
    operational_rationale: result?.operational_rationale || result?.control_room?.operational_rationale || null,
    handoff,
    completed_at: invocation.ended_at || record.completed_at || null,
    completed_epoch: Date.parse(invocation.ended_at || record.completed_at || '') || 0,
    attempt_dir: path.relative(root, attemptDir),
    workspace: workspaceLink(runId, record.agent_id, invocation.task_id),
    resolution: null,
  };
}

// Only dispatch-enabled roles produce live obligations. Evidence from a
// DISABLED/NOT_PROVEN role is preserved (never silently discarded) but cannot
// become an actionable human obligation — a disabled agent cannot own a
// resolution path.
function dispatchEnabledFor(registration) {
  const lifecycle = registration?.lifecycle || {};
  return lifecycle.proven === 'PROVEN' && lifecycle.autonomous_dispatch === 'ENABLED';
}

// Queue→workspace navigation must carry the exact run/agent/task context so a
// click lands on the precise workspace state, never a generic page.
function workspaceLink(runId, agentId, taskId) {
  const base = agentId === 'visual_planning_director'
    ? '/visual-planning-workspace.html'
    : '/package-runs-dashboard.html';
  return `${base}?run=${encodeURIComponent(runId)}&agent=${encodeURIComponent(agentId)}&task=${encodeURIComponent(taskId || '')}`;
}

function scanObligations(root, registeredIds, registrations) {
  const obligations = [];
  const diagnostics = [];
  const seenInvocations = new Set();
  const packageRunsRoot = path.join(root, 'package-runs');
  let entries = [];
  try { entries = fs.readdirSync(packageRunsRoot, { withFileTypes: true }); } catch (_) { return { obligations, diagnostics }; }
  const byId = new Map(registrations.map((entry) => [entry.agent_id, entry]));
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const runId = entry.name;
    const indexPath = path.join(packageRunsRoot, runId, 'agents', 'index.json');
    if (!fs.existsSync(indexPath)) continue;
    const index = readJsonSafe(indexPath);
    if (!index || !Array.isArray(index.invocations)) { diagnostics.push({ run_id: runId, code: 'QUEUE_INDEX_INVALID' }); continue; }
    for (const record of index.invocations) {
      if (!record || !registeredIds.has(record.agent_id)) continue;
      const taskDir = path.join(packageRunsRoot, runId, 'agents', record.agent_id, String(record.task_id || ''));
      if (!fs.existsSync(taskDir)) continue;
      const attempts = [];
      const baseInvocation = path.join(taskDir, 'invocation.json');
      if (fs.existsSync(baseInvocation)) attempts.push({ dir: taskDir, number: 1 });
      const attemptsRoot = path.join(taskDir, 'attempts');
      if (fs.existsSync(attemptsRoot)) {
        for (const attemptEntry of fs.readdirSync(attemptsRoot).sort()) {
          const attemptDir = path.join(attemptsRoot, attemptEntry);
          if (fs.existsSync(path.join(attemptDir, 'invocation.json'))) {
            attempts.push({ dir: attemptDir, number: Number(attemptEntry) || attempts.length + 1 });
          }
        }
      }
      for (const attempt of attempts) {
        // Dedupe by invocation_id: the runner index can list the same attempt
        // once per attempt record, and the base dir mirrors attempt 1.
        if (seenInvocations.has(`${runId}\u0000${record.agent_id}\u0000${attempt.dir}`)) continue;
        const obligation = obligationFromInvocation(root, runId, byId.get(record.agent_id), record, attempt.dir);
        if (!obligation) continue;
        if (seenInvocations.has(obligation.invocation_id)) continue;
        seenInvocations.add(obligation.invocation_id);
        seenInvocations.add(`${runId}\u0000${record.agent_id}\u0000${attempt.dir}`);
        obligations.push(obligation);
      }
    }
  }
  obligations.sort((a, b) => b.completed_epoch - a.completed_epoch);
  return { obligations, diagnostics };
}

function runInactive(root, runId) {
  const statePath = path.join(root, 'package-runs', runId, 'package-run-state.md');
  if (!fs.existsSync(statePath)) return false;
  const text = fs.readFileSync(statePath, 'utf8').toLowerCase();
  return /archived|inactive|superseded run/.test(text);
}

function resultEvidenceVerifies(root, obligation) {
  const resultPath = path.join(root, obligation.attempt_dir, 'result.json');
  if (!obligation.result_sha256) return true;
  if (!fs.existsSync(resultPath)) return false;
  const crypto = require('node:crypto');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(resultPath)).digest('hex');
  return actual === obligation.result_sha256;
}

// A later canonical completion closes an obligation only when it belongs to
// the SAME task lineage: same run+agent+task with a lower-attention result,
// or same run+agent whose predecessor_task_id names the obligated task.
function supersessionEvidence(obligationsByAgentRun, obligation) {
  const siblings = obligationsByAgentRun.get(`${obligation.run_id}\u0000${obligation.agent_id}`) || [];
  for (const sibling of siblings) {
    if (sibling === obligation) continue;
    const sameTaskLaterAttempt = sibling.task_id === obligation.task_id
      && sibling.completed_epoch >= obligation.completed_epoch
      && ATTENTION_RANK[sibling.attention] < ATTENTION_RANK[obligation.attention];
    const successorLineage = sibling.predecessor_task_id === obligation.task_id
      && ATTENTION_RANK[sibling.attention] < ATTENTION_RANK[obligation.attention];
    if (sameTaskLaterAttempt || successorLineage) {
      return {
        resolved_by: 'SUPERSEDING_INVOCATION',
        resolving_invocation_id: sibling.invocation_id,
        resolving_task_id: sibling.task_id,
        resolving_attention: sibling.attention,
        resolved_at: sibling.completed_at,
        reason: successorLineage
          ? 'successor task completed without requiring human attention'
          : 'same task recompleted without requiring human attention',
      };
    }
  }
  // Also scan non-obligation completions of the same lineage: a later attempt
  // or successor that resolved to INFORMATION/AUTONOMOUS carries no queue
  // item of its own, so it is looked up through the completion index.
  return null;
}

function approvalResolution(evidenceProviders, obligation) {
  // Approval resolution is supplied exclusively by canonical approval
  // bindings verified against exact artifact bytes. Nothing in this module
  // records or manufactures approval.
  const provider = (evidenceProviders || [])
    .map((providerEntry) => typeof providerEntry === 'function' ? providerEntry(obligation) : null)
    .find(Boolean);
  if (!provider || provider.verdict !== 'VALID') return null;
  return {
    resolved_by: 'APPROVAL_VALID',
    scope: provider.scope || obligation.approval_scope_required,
    artifact_sha256: provider.artifact_sha256 || null,
    resolved_at: provider.approved_at || null,
    reason: 'exact required approval binding verified VALID for this obligation',
  };
}

function resolveObligations(root, obligations, options = {}) {
  const byAgentRun = new Map();
  for (const obligation of obligations) {
    const key = `${obligation.run_id}\u0000${obligation.agent_id}`;
    if (!byAgentRun.has(key)) byAgentRun.set(key, []);
    byAgentRun.get(key).push(obligation);
  }
  for (const obligation of obligations) {
    if (!obligation.dispatch_enabled) {
      obligation.state = 'INVALID';
      obligation.resolution = { resolved_by: 'DISPATCH_NOT_ENABLED', reason: 'evidence from a role whose autonomous dispatch is disabled cannot become a live human obligation', resolved_at: null };
      continue;
    }
    if (!resultEvidenceVerifies(root, obligation)) {
      obligation.state = 'INVALID';
      obligation.resolution = { resolved_by: 'EVIDENCE_TAMPERED', reason: 'recorded result bytes no longer verify', resolved_at: null };
      continue;
    }
    const approval = approvalResolution(options.approvalEvidenceProviders, obligation);
    if (approval) {
      obligation.state = 'RESOLVED';
      obligation.resolution = approval;
      continue;
    }
    const superseded = supersessionEvidence(byAgentRun, obligation)
      || supersessionEvidenceFromCompletions(root, obligation);
    if (superseded) {
      obligation.state = 'SUPERSEDED';
      obligation.resolution = superseded;
      continue;
    }
    if (runInactive(root, obligation.run_id)) {
      obligation.state = 'STALE';
      obligation.resolution = { resolved_by: 'RUN_INACTIVE', reason: 'owning package run is inactive or archived; obligation preserved in history', resolved_at: null };
    }
  }
  return obligations;
}

// Non-obligation completions (INFORMATION/AUTONOMOUS results of the same task
// lineage) do not appear in the obligation list; scan their invocation files
// directly so an explicit resume rerun can close the original obligation.
// Lineage is established either through predecessor_task_id or through a
// Hermes RESUME_ORCHESTRATION receipt bound to the obligation's invocation.
function supersessionEvidenceFromCompletions(root, obligation) {
  const agentsDir = path.join(root, 'package-runs', obligation.run_id, 'agents', obligation.agent_id);
  if (!fs.existsSync(agentsDir)) return null;
  const resumeReceipt = findResumeReceipt(root, obligation);
  let best = null;
  for (const taskId of fs.readdirSync(agentsDir)) {
    const taskDir = path.join(agentsDir, taskId);
    if (!fs.existsSync(path.join(taskDir, 'invocation.json'))) continue;
    // Same-task lineage can recomplete at any attempt level.
    const candidateDirs = [taskDir];
    const attemptsRoot = path.join(taskDir, 'attempts');
    if (fs.existsSync(attemptsRoot)) {
      for (const attemptEntry of fs.readdirSync(attemptsRoot)) {
        const attemptDir = path.join(attemptsRoot, attemptEntry);
        if (fs.existsSync(path.join(attemptDir, 'invocation.json'))) candidateDirs.push(attemptDir);
      }
    }
    for (const candidateDir of candidateDirs) {
      const invocation = readJsonSafe(path.join(candidateDir, 'invocation.json'));
      if (!invocation || invocation.infrastructure_state !== 'COMPLETE') continue;
      if (invocation.invocation_id === obligation.invocation_id) continue;
      const attention = String(invocation.handoff_summary?.attention || 'INFORMATION').toUpperCase();
      if (ATTENTION_RANK[attention] >= ATTENTION_RANK[obligation.attention]) continue;
      const taskLineage = invocation.task_id === obligation.task_id
        || invocation.predecessor_task_id === obligation.task_id;
      const receiptLineage = Boolean(resumeReceipt && Date.parse(invocation.ended_at || '') >= Date.parse(resumeReceipt.timestamp || ''));
      if (!taskLineage && !receiptLineage) continue;
      const endedAt = invocation.ended_at || '';
      const epoch = Date.parse(endedAt) || 0;
      if (epoch < obligation.completed_epoch) continue;
      if (!best || epoch > best.epoch) {
        best = {
          epoch,
          resolved_by: receiptLineage && !taskLineage ? 'HERMES_RESUME_LOOP' : 'SUPERSEDING_INVOCATION',
          resolving_invocation_id: invocation.invocation_id,
          resolving_task_id: invocation.task_id,
          resolving_attention: attention,
          resolved_at: endedAt || null,
          reason: invocation.predecessor_task_id === obligation.task_id
            ? 'successor task completed without requiring human attention'
            : receiptLineage && !taskLineage
              ? 'proven Hermes resume loop: blocker resolved, rerun completed without requiring human attention'
              : 'same task recompleted without requiring human attention',
          hermes_receipt_id: receiptLineage && !taskLineage && resumeReceipt ? resumeReceipt.receipt_id : null,
        };
      }
    }
  }
  if (!best) return null;
  const { epoch, ...evidence } = best;
  return evidence;
}

function buildDecisionQueue(root, registry, options = {}) {
  const registeredIds = new Set((registry.agents || []).map((agent) => agent.agent_id));
  const { obligations, diagnostics } = scanObligations(root, registeredIds, registry.agents || []);
  resolveObligations(root, obligations, options);
  const providers = Array.isArray(options.resolutionEvidenceProviders) ? options.resolutionEvidenceProviders : [];
  for (const obligation of obligations) {
    if (obligation.state !== 'ACTIVE') continue;
    for (const provider of providers) {
      const evidence = typeof provider === 'function' ? provider(obligation) : null;
      if (evidence && evidence.resolving_invocation_id && evidence.resolved_by) {
        obligation.state = 'SUPERSEDED';
        obligation.resolution = { resolved_by: evidence.resolved_by, ...evidence };
        break;
      }
    }
  }
  const active = obligations.filter((obligation) => obligation.state === 'ACTIVE');
  const history = obligations
    .filter((obligation) => obligation.state !== 'ACTIVE')
    .map((obligation) => ({
      queue_item_id: obligation.queue_item_id, state: obligation.state,
      run_id: obligation.run_id, agent_id: obligation.agent_id,
      invocation_id: obligation.invocation_id, task_id: obligation.task_id,
      attention: obligation.attention, resolution: obligation.resolution,
    }));
  return {
    schema_version: 2,
    queue_identity: 'obligation: run + agent + invocation + task + gate + scope + artifact + result hash',
    states: [...QUEUE_ITEM_STATES],
    human_decision_queue: active,
    human_decision_history: history,
    diagnostics,
    counts: {
      active: active.length,
      resolved: history.filter((entry) => entry.state === 'RESOLVED').length,
      superseded: history.filter((entry) => entry.state === 'SUPERSEDED').length,
      stale: history.filter((entry) => entry.state === 'STALE').length,
      invalid: history.filter((entry) => entry.state === 'INVALID').length,
    },
  };
}

module.exports = {
  QUEUE_ITEM_STATES, OBLIGATION_ATTENTION, DecisionQueueError,
  scanObligations, resolveObligations, buildDecisionQueue,
  obligationFromInvocation, supersessionEvidence, approvalResolution,
};
