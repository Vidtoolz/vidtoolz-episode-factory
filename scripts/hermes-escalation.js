'use strict';

// Hermes Escalation Bridge V1 — receipt + routing + resume semantics for
// `next_owner: hermes` handoffs discovered in the Human Supervision canary
// (package-runs/2026-08-24-human-supervision-canary).
//
// Authority boundary (config/agent-contract.json):
//   - Hermes is NOT an agent and must never appear in config/agent-registry.json.
//   - Hermes receipts are ORCHESTRATION EVIDENCE, never approval evidence.
//     They are kept in a dedicated file, separate from the human operator
//     action ledger (scripts/operator-action-ledger.js) and separate from any
//     approval binding (verifyApprovalBinding in agent-contract-validator.js).
//   - Receipts may not contain approval metadata; the same structural ban the
//     operator ledger enforces applies here.
//   - Routing is policy-classified and deterministic. No automatic chaining:
//     automatic_chain_count stays 0 unless a separately authorized Hermes
//     routing action is recorded — and routing to a lifecycle-disabled role
//     is refused fail-closed.

const fs = require('node:fs');
const path = require('node:path');
const dispatchAuthority = require('./agent-dispatch-authority.js');

const SCHEMA_VERSION = 1;
const RECEIPTS_FILE = 'hermes-receipts.json';
const LOCK_SUFFIX = '.lock';

const ACTOR = Object.freeze({
  identity_type: 'AGENT_LAYER',
  identity: 'hermes',
  authenticated: true,
  context: 'executive producer orchestration layer — non-agent per agent contract',
});

const VERBS = Object.freeze([
  'RECEIVE', 'SUMMARIZE', 'ROUTE', 'REQUEST_SPECIALIST',
  'SURFACE_TO_HUMAN', 'AWAIT_HUMAN', 'RESUME_ORCHESTRATION',
]);

const PROHIBITED_VERBS = Object.freeze([
  'APPROVE', 'RECORD_HUMAN_APPROVAL', 'GREENLIGHT', 'FINAL_CUT_APPROVAL',
  'FINAL_MUSIC_APPROVAL', 'TITLE_APPROVAL', 'THUMBNAIL_APPROVAL', 'PUBLICATION',
  'ATTENTION_DOWNGRADE_TO_BYPASS_GATE', 'DISPATCH_DISABLED_ROLE',
]);

const ROUTING_CATEGORIES = Object.freeze([
  'SPECIALIST_REMEDIATION',      // A — route/request lifecycle-enabled specialist
  'HUMAN_REVIEW',                // B — surface to queue and wait
  'HUMAN_DECISION',              // C — surface to queue and wait
  'INFRASTRUCTURE_RESOURCE',     // D — route to canonical operational owner
  'UNRESOLVED_DISAGREEMENT',     // E — summarize conflict, human decides
]);

const RESUME_CONDITIONS = Object.freeze([
  'REQUIRED_APPROVAL_VALID',       // canonical approval binding verifies VALID
  'REMEDIATION_ARTIFACT_PRESENT',  // named remediation artifact exists at path
  'SPECIALIST_RERUN_REQUIRED',     // a later invocation of source agent exists
  'HUMAN_REJECTED',                // canonical rejection recorded by human
  'BLOCKER_RESOLVED',              // blocker no longer observable in latest state
  'WAITING_FOR_RESOURCE',          // resource dependency still unavailable
]);

const RECEIPT_STATUSES = Object.freeze(['OPEN', 'ROUTED', 'WAITING_FOR_HUMAN', 'RESUMED', 'SUPERSEDED']);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_REASON = 600;

class HermesEscalationError extends Error {
  constructor(code, message) { super(message); this.name = 'HermesEscalationError'; this.code = code; }
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new HermesEscalationError('HERMES_RECEIPT_INVALID', `${label} is not a safe identifier`);
  }
  return value;
}

function reasonText(value, label, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new HermesEscalationError('HERMES_RECEIPT_INVALID', `${label} must be text`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if ((required && !normalized) || normalized.length > MAX_REASON) {
    throw new HermesEscalationError('HERMES_RECEIPT_INVALID', `${label} is empty or exceeds ${MAX_REASON} characters`);
  }
  return normalized || null;
}

function sha256(value) { return require('node:crypto').createHash('sha256').update(value).digest('hex'); }

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'receipt contains a non-canonical value');
}

function receiptHash(receipt) {
  const copy = { ...receipt };
  delete copy.receipt_hash;
  return sha256(canonicalize(copy));
}

// Approval metadata is forbidden anywhere in a receipt. Mirrors the operator
// ledger's structural ban: orchestration evidence can never become approval.
function forbiddenApprovalMetadata(value, key = '') {
  if (/(^|_)(approved|approver|greenlight|greenlit|publication)(_|$)/i.test(key)) return true;
  if (key && /approval/i.test(key) && key !== 'approval_scope_required') return true;
  if (Array.isArray(value)) return value.some((item) => forbiddenApprovalMetadata(item));
  if (plain(value)) return Object.entries(value).some(([childKey, child]) => forbiddenApprovalMetadata(child, childKey));
  return false;
}

function receiptsPaths(repoRoot, runId) {
  safeId(runId, 'run_id');
  const packageRuns = path.resolve(repoRoot, 'package-runs');
  const runDir = path.resolve(packageRuns, runId);
  if (path.dirname(runDir) !== packageRuns) {
    throw new HermesEscalationError('HERMES_RECEIPT_PATH_INVALID', 'run path escapes package-runs');
  }
  const dir = path.join(runDir, 'orchestration');
  return { runDir, dir, filePath: path.join(dir, RECEIPTS_FILE), lockPath: path.join(dir, `${RECEIPTS_FILE}${LOCK_SUFFIX}`) };
}

function initialLedger(runId) {
  return { schema_version: SCHEMA_VERSION, kind: 'hermes_orchestration_receipts', run_id: runId, head_hash: null, receipts: [] };
}

function readReceipts(repoRoot, runId) {
  const paths = receiptsPaths(repoRoot, runId);
  if (!fs.existsSync(paths.filePath)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(paths.filePath, 'utf8')); }
  catch (_) { throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', 'hermes receipts file is corrupt'); }
  return verifyReceipts(parsed, runId);
}

function verifyReceipts(ledger, runId) {
  if (!plain(ledger) || ledger.schema_version !== SCHEMA_VERSION || ledger.kind !== 'hermes_orchestration_receipts'
    || ledger.run_id !== runId || !Array.isArray(ledger.receipts)) {
    throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', 'hermes receipts header is malformed');
  }
  let previous = null;
  const ids = new Set();
  ledger.receipts.forEach((receipt, index) => {
    validateReceipt(receipt, index, runId, previous, ids, ledger.receipts);
    previous = receipt.receipt_hash;
    ids.add(receipt.receipt_id);
  });
  if (ledger.head_hash !== previous) {
    throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', 'hermes receipts head does not match its records');
  }
  return ledger;
}

function validateReceipt(receipt, index, runId, previousHash, seenIds, all) {
  if (!plain(receipt) || receipt.schema_version !== SCHEMA_VERSION || receipt.sequence !== index + 1
    || receipt.run_id !== runId || !VERBS.includes(receipt.hermes_action)
    || PROHIBITED_VERBS.includes(receipt.hermes_action)
    || !ROUTING_CATEGORIES.includes(receipt.routing_category)
    || !RESUME_CONDITIONS.includes(receipt.resume_condition)
    || !RECEIPT_STATUSES.includes(receipt.status)
    || receipt.previous_receipt_hash !== previousHash
    || !ID_RE.test(String(receipt.receipt_id || '')) || seenIds.has(receipt.receipt_id)
    || typeof receipt.timestamp !== 'string' || !Number.isFinite(Date.parse(receipt.timestamp))
    || receipt.receipt_hash !== receiptHash(receipt)) {
    throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', `hermes receipt ${index + 1} is malformed or breaks the chain`);
  }
  safeId(receipt.source_agent_id, 'source_agent_id');
  safeId(receipt.source_invocation_id, 'source_invocation_id');
  if (receipt.source_task_id != null) safeId(receipt.source_task_id, 'source_task_id');
  if (receipt.route_target_agent_id != null) safeId(receipt.route_target_agent_id, 'route_target_agent_id');
  for (const hashField of ['source_result_sha256', 'source_invocation_sha256']) {
    if (receipt[hashField] != null && !HASH_RE.test(receipt[hashField])) {
      throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', `${hashField} is not a sha256`);
    }
  }
  reasonText(receipt.reason, 'reason', true);
  if (forbiddenApprovalMetadata(receipt.requested_parameters || {})) {
    throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', 'receipt contains forbidden approval metadata');
  }
  // Attention may never be downgraded below what the specialist emitted.
  const rank = { INFORMATION: 0, REVIEW: 1, DECISION: 2 };
  if (rank[receipt.attention_level] == null || rank[receipt.attention_level] < 1) {
    throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'only REVIEW/DECISION escalations are receivable');
  }
  if (receipt.supersedes != null) {
    const prior = all.slice(0, index).find((item) => item.receipt_id === receipt.supersedes);
    if (!prior || prior.source_invocation_id !== receipt.source_invocation_id
      || all.slice(0, index).some((item) => item.supersedes === receipt.supersedes)) {
      throw new HermesEscalationError('HERMES_RECEIPT_CORRUPT', 'supersession target missing, mismatched, or already superseded');
    }
  }
  return receipt;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${require('node:crypto').randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
}

function acquireLock(paths) {
  fs.mkdirSync(paths.dir, { recursive: true });
  const token = `${process.pid}-${require('node:crypto').randomBytes(6).toString('hex')}`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = fs.openSync(paths.lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, token);
      fs.closeSync(fd);
      return token;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(paths.lockPath);
        if (Date.now() - stat.mtimeMs > 15000) { fs.unlinkSync(paths.lockPath); continue; }
      } catch (_) { /* lock vanished */ }
      if (Date.now() > deadline) throw new HermesEscalationError('HERMES_RECEIPT_LOCKED', 'receipts lock held elsewhere');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function releaseLock(paths, token) {
  try {
    if (fs.readFileSync(paths.lockPath, 'utf8') === token) fs.unlinkSync(paths.lockPath);
  } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Routing policy — deterministic classification from a queue item.
// ---------------------------------------------------------------------------

function implementationReadiness(root, targetAgentId) {
  let registration = null;
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'config', 'agent-registry.json'), 'utf8'));
    registration = registry.agents?.find((agent) => agent.agent_id === targetAgentId) || null;
  } catch (_) { registration = null; }
  if (!registration) return { module_exists: false, implementation_state: null, ready_for_route: false, code: 'HERMES_ROUTE_TARGET_UNKNOWN', reason: `route target ${targetAgentId} is not registered` };
  const readiness = dispatchAuthority.implementationReadiness(root, registration);
  return {
    module_exists: readiness.module_exists,
    implementation_state: readiness.implementation_state,
    ready_for_route: readiness.authorized,
    code: readiness.code,
    reason: readiness.reason,
  };
}

function classifyRouting(queueItem, registryAgents, options = {}) {
  const attention = queueItem.attention;
  if (!['REVIEW', 'DECISION'].includes(attention)) {
    throw new HermesEscalationError('HERMES_ROUTING_REJECTED', 'only REVIEW/DECISION items escalate through Hermes');
  }
  const category = attention === 'DECISION'
    ? (queueItem.disagreement ? 'UNRESOLVED_DISAGREEMENT' : 'HUMAN_DECISION')
    : 'HUMAN_REVIEW';
  const registration = (registryAgents || []).find((agent) => agent.agent_id === queueItem.agent_id) || {};
  const lifecycle = registration.lifecycle || {};
  const enabled = lifecycle.proven === 'PROVEN' && lifecycle.autonomous_dispatch === 'ENABLED';
  const blocker = String(queueItem.reason || '').toLowerCase();
  const infrastructure = /fetch failed|model_failed|unreachable|timeout|resource|vram|disk/.test(blocker);

  let recommendedAction = 'SURFACE_TO_HUMAN';
  let routeOptions = [];
  const readinessFor = (target) => implementationReadiness(options.root || path.resolve(__dirname, '..'), target);
  if (infrastructure) {
    recommendedAction = queueItem.agent_id === 'production_operations' || enabled ? 'AWAIT_HUMAN' : 'SURFACE_TO_HUMAN';
    // Production Operations is the canonical infrastructure route target.
    // Authorization now reflects both lifecycle enablement and implementation
    // readiness — a CANDIDATE module is visible as a route candidate but is
    // not authorized for launch until its proof completes.
    const registration = (registryAgents || []).find((agent) => agent.agent_id === 'production_operations') || {};
    const lc = registration.lifecycle || {};
    const lifecycleEnabled = lc.proven === 'PROVEN' && lc.autonomous_dispatch === 'ENABLED';
    const readiness = readinessFor('production_operations');
    routeOptions = [{
      target: 'production_operations', verb: 'ROUTE',
      authorized: Boolean(lifecycleEnabled && readiness.ready_for_route),
      implementation_state: readiness.implementation_state,
      module_exists: readiness.module_exists,
      reason: readiness.reason,
      note: readiness.ready_for_route
        ? 'route available; launching the task remains a separate authorized orchestration action'
        : 'route target exists as an implementation candidate; launch refused until proof completes',
    }];
  } else if (category === 'HUMAN_REVIEW' && /preflight|missing|remediat/.test(blocker)) {
    recommendedAction = 'REQUEST_SPECIALIST';
    routeOptions = remediationTargets(queueItem, registryAgents, options);
  }

  return {
    category,
    recommended_action: recommendedAction,
    route_options: routeOptions,
    waiting_for: attention === 'DECISION'
      ? { kind: 'HUMAN_DECISION', gate: queueItem.owning_gate, scope: queueItem.approval_scope_required }
      : { kind: 'HUMAN_REVIEW', gate: queueItem.owning_gate, scope: queueItem.approval_scope_required },
  };
}

function remediationTargets(queueItem, registryAgents, options = {}) {
  // Deterministic remediation map: which lifecycle-enabled specialist owns the
  // class of preflight failure described in the escalation reason.
  const blocker = String(queueItem.reason || '').toLowerCase();
  const map = [];
  if (/narrative_spine|script structure|spine missing/.test(blocker)) {
    map.push({ target: 'story_editor', verb: 'REQUEST_SPECIALIST', note: 'Story Editor owns narrative spine completeness upstream of its own review' });
  }
  if (/research|citation|source/.test(blocker)) {
    map.push({ target: 'research_director', verb: 'REQUEST_SPECIALIST', note: 'Research Director owns research sufficiency' });
  }
  return map.filter((option) => {
    const registration = (registryAgents || []).find((agent) => agent.agent_id === option.target);
    const readiness = registration
      ? dispatchAuthority.implementationReadiness(options.root || path.resolve(__dirname, '..'), registration)
      : { authorized: false, code: 'HERMES_ROUTE_TARGET_UNKNOWN' };
    option.authorized = readiness.authorized;
    option.implementation_state = readiness.implementation_state ?? null;
    option.reason = readiness.reason || null;
    return option.authorized;
  });
}

function assertRouteTargetAuthorized(registryAgents, targetAgentId, options = {}) {
  const registration = (registryAgents || []).find((agent) => agent.agent_id === targetAgentId);
  if (!registration) throw new HermesEscalationError('HERMES_ROUTE_TARGET_UNKNOWN', `route target ${targetAgentId} is not registered`);
  const readiness = dispatchAuthority.implementationReadiness(options.root || path.resolve(__dirname, '..'), registration);
  if (!readiness.authorized) {
    const code = readiness.code === 'BLOCKED_AGENT_NOT_ENABLED' ? 'HERMES_ROUTE_TARGET_DISABLED' : readiness.code;
    throw new HermesEscalationError(code, `${readiness.reason} — dispatch refused`);
  }
  return registration;
}

// ---------------------------------------------------------------------------
// Receipt creation — binds exact source invocation/result bytes.
// ---------------------------------------------------------------------------

function createReceipt(repoRoot, runId, input, options = {}) {
  const paths = receiptsPaths(repoRoot, runId);
  const token = acquireLock(paths);
  try {
    const current = readReceipts(repoRoot, runId) || initialLedger(runId);

    // Duplicate handling is deterministic: the same source invocation with the
    // same action returns the existing receipt idempotently.
    const duplicate = current.receipts.find((r) =>
      r.source_invocation_id === input.source_invocation_id && r.hermes_action === input.action);
    if (duplicate && !options.forceSupersede) {
      return { duplicate: true, receipt: duplicate, receipts_path: path.relative(repoRoot, paths.filePath), head_hash: current.head_hash };
    }

    if (!plain(input)) throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'receipt input must be an object');
    if (!VERBS.includes(input.action) || PROHIBITED_VERBS.includes(input.action)) {
      throw new HermesEscalationError('HERMES_ACTION_PROHIBITED', `action ${input.action} is not an allowed Hermes orchestration verb`);
    }
    if (!['REVIEW', 'DECISION'].includes(input.attention_level)) {
      throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'escalation attention must be REVIEW or DECISION');
    }
    if (input.routing_category === 'INFRASTRUCTURE_RESOURCE' || input.action === 'ROUTE') {
      assertRouteTargetAuthorized(options.registryAgents || [], input.route_target_agent_id || input.source_agent_id, { root: repoRoot });
    }
    if (input.approval_scope_required != null) {
      // Canonical scope names legitimately contain "APPROVAL" — validate the
      // scope field against the canonical list instead of the blanket scan,
      // and run the metadata ban on everything else.
      const scopes = require('./approval-scopes.js');
      if (!scopes.isApprovalScope(input.approval_scope_required)) {
        throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'approval_scope_required is not a canonical scope');
      }
    }
    const { approval_scope_required, ...rest } = input;
    if (forbiddenApprovalMetadata(rest)) {
      throw new HermesEscalationError('HERMES_RECEIPT_INVALID', 'receipt must not contain approval metadata');
    }
    if (input.source_result_sha256 != null && !HASH_RE.test(String(input.source_result_sha256))) {
      throw new HermesEscalationError('HERMES_SOURCE_MISMATCH', 'source result hash is not a sha256');
    }

    const receipt = {
      schema_version: SCHEMA_VERSION,
      sequence: current.receipts.length + 1,
      run_id: runId,
      receipt_id: options.receiptId || `hermes-receipt-${require('node:crypto').randomUUID()}`,
      timestamp: options.now || new Date().toISOString(),
      actor: { ...ACTOR },
      source_agent_id: safeId(input.source_agent_id, 'source_agent_id'),
      source_invocation_id: safeId(input.source_invocation_id, 'source_invocation_id'),
      source_task_id: input.source_task_id == null ? null : safeId(input.source_task_id, 'source_task_id'),
      source_result_sha256: input.source_result_sha256 == null ? null : String(input.source_result_sha256),
      source_invocation_sha256: input.source_invocation_sha256 == null ? null : String(input.source_invocation_sha256),
      attention_level: input.attention_level,
      owning_gate: input.owning_gate || null,
      approval_scope_required: input.approval_scope_required || null,
      next_owner: input.next_owner || 'hermes',
      hermes_action: input.action,
      routing_category: input.routing_category,
      route_target_agent_id: input.route_target_agent_id == null ? null : safeId(input.route_target_agent_id, 'route_target_agent_id'),
      status: input.status || (input.action === 'AWAIT_HUMAN' || input.action === 'SURFACE_TO_HUMAN' ? 'WAITING_FOR_HUMAN' : 'OPEN'),
      resume_condition: input.resume_condition,
      resume_binding: plain(input.resume_binding) ? input.resume_binding : {},
      reason: reasonText(input.reason, 'reason', true),
      requested_parameters: {},
      supersedes: input.supersedes || null,
      previous_receipt_hash: current.head_hash,
    };
    receipt.receipt_hash = receiptHash(receipt);
    validateReceipt(receipt, current.receipts.length, runId, current.head_hash, new Set(current.receipts.map((r) => r.receipt_id)), [...current.receipts, receipt]);

    // Supersession is recorded by pointer on the new receipt only. The
    // predecessor's bytes are never mutated (that would break its hash);
    // consumers derive SUPERSEDED state by checking whether any later receipt
    // points at it.
    const next = { ...current };
    next.receipts = [...next.receipts, receipt];
    next.head_hash = receipt.receipt_hash;
    verifyReceipts(next, runId);
    atomicJson(paths.filePath, next);
    return { duplicate: false, receipt, receipts_path: path.relative(repoRoot, paths.filePath), head_hash: next.head_hash };
  } finally { releaseLock(paths, token); }
}

// ---------------------------------------------------------------------------
// Resume semantics — deterministic observation of the exact condition.
// ---------------------------------------------------------------------------

function observeResumeCondition(repoRoot, runId, receipt, evidence = {}) {
  const condition = receipt.resume_condition;
  switch (condition) {
    case 'REQUIRED_APPROVAL_VALID': {
      // Requires a canonical approval binding that verifies VALID against the
      // exact artifact bytes. Anything else — including any Hermes-side record
      // — leaves the condition unmet. Never satisfied by receipt existence.
      const validator = require('./agent-contract-validator.js');
      const binding = evidence.approval_binding || null;
      const bytes = evidence.artifact_bytes || null;
      if (!binding || !bytes) return { met: false, detail: 'no canonical approval binding/artifact presented' };
      const verdict = validator.verifyApprovalBinding(binding, bytes, receipt.approval_scope_required || undefined);
      return { met: verdict.verdict === 'VALID', detail: verdict.verdict === 'VALID' ? 'approval binding VALID for required scope' : `approval binding ${verdict.verdict}: ${verdict.reason}` };
    }
    case 'REMEDIATION_ARTIFACT_PRESENT': {
      const rel = receipt.resume_binding?.artifact_path;
      if (!rel) return { met: false, detail: 'no remediation artifact path bound' };
      const runDir = receiptsPaths(repoRoot, runId).runDir;
      const abs = path.resolve(runDir, rel);
      if (path.dirname(abs) !== runDir && !abs.startsWith(`${runDir}${path.sep}`)) {
        return { met: false, detail: 'bound artifact path escapes run directory' };
      }
      if (!fs.existsSync(abs)) return { met: false, detail: `remediation artifact absent: ${rel}` };
      const expected = receipt.resume_binding?.sha256;
      if (expected) {
        const actual = sha256(fs.readFileSync(abs));
        if (actual !== expected) return { met: false, detail: 'remediation artifact hash mismatch' };
      }
      return { met: true, detail: `remediation artifact present${expected ? ' and hash-bound' : ''}` };
    }
    case 'SPECIALIST_RERUN_REQUIRED': {
      const invocations = Array.isArray(evidence.later_invocations) ? evidence.later_invocations : [];
      const match = invocations.find((inv) => inv.agent_id === receipt.source_agent_id
        && inv.task_id === receipt.source_task_id
        && inv.invocation_id !== receipt.source_invocation_id
        && inv.infrastructure_state === 'COMPLETE');
      return match
        ? { met: true, detail: `later complete invocation observed: ${match.invocation_id}` }
        : { met: false, detail: 'no later complete invocation of the source specialist/task' };
    }
    case 'BLOCKER_RESOLVED':
      return evidence.blocker_resolved === true
        ? { met: true, detail: 'blocker reported resolved by observing layer' }
        : { met: false, detail: 'blocker still present' };
    case 'HUMAN_REJECTED':
      return evidence.human_rejected === true
        ? { met: true, detail: 'canonical human rejection recorded' }
        : { met: false, detail: 'no human rejection recorded' };
    case 'WAITING_FOR_RESOURCE':
      return evidence.resource_available === true
        ? { met: true, detail: 'resource dependency now available' }
        : { met: false, detail: 'resource still unavailable/unknown' };
    default:
      return { met: false, detail: `unknown resume condition ${condition}` };
  }
}

// ---------------------------------------------------------------------------
// Orchestration projection for the Control Room / Human Decision Queue.
// ---------------------------------------------------------------------------

function buildOrchestrationProjection(repoRoot, runId, queueItems, registryAgents, evidenceProviders = {}) {
  const ledger = (() => { try { return readReceipts(repoRoot, runId); } catch (_) { return null; } })();
  const byInvocation = new Map();
  for (const receipt of (ledger?.receipts || [])) byInvocation.set(receipt.source_invocation_id, receipt);
  return {
    schema_version: SCHEMA_VERSION,
    actor: { role_id: 'hermes', is_agent: false, authority: 'orchestration_only' },
    allowed_verbs: [...VERBS],
    prohibited_verbs: [...PROHIBITED_VERBS],
    items: (queueItems || []).map((item) => {
      const existing = byInvocation.get(item.invocation_id);
      const classification = classifyRouting(item, registryAgents);
      let resume = null;
      if (existing) {
        const provider = evidenceProviders[item.agent_id] || (() => ({}));
        resume = { condition: existing.resume_condition, ...observeResumeCondition(repoRoot, runId, existing, provider(item)) };
      }
      return {
        invocation_id: item.invocation_id,
        receipt_status: existing ? existing.status : 'NOT_RECEIVED',
        receipt_id: existing ? existing.receipt_id : null,
        recommended_orchestration_action: existing ? existing.hermes_action : classification.recommended_action,
        route_options: classification.route_options,
        waiting_for: classification.waiting_for,
        resume_condition: existing ? existing.resume_condition : null,
        resume_observation: resume,
      };
    }),
  };
}

module.exports = {
  SCHEMA_VERSION, RECEIPTS_FILE, ACTOR, VERBS, PROHIBITED_VERBS, ROUTING_CATEGORIES,
  RESUME_CONDITIONS, RECEIPT_STATUSES, HermesEscalationError, implementationReadiness,
  canonicalize, receiptHash, receiptsPaths, readReceipts, verifyReceipts,
  classifyRouting, assertRouteTargetAuthorized, createReceipt,
  observeResumeCondition, buildOrchestrationProjection,
};
