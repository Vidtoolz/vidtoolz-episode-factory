/**
 * LOCAL_AUTO routing integration for the Episode Factory script evaluator.
 *
 * Bridges the EF evaluate-script path to the proven routing decision engine in
 * ~/vidtoolz-compute (canary/routing_canary.py). This module owns NO routing
 * policy: task-type ceilings, residency gates, role gates, capacity rules and
 * scoring all live in the vidtoolz-compute registry + canary. The adapter only
 * builds the canonical descriptor, invokes the router, maps the decision back
 * to EF provider semantics, and enforces the local-only + no-bypass contract.
 *
 * Scope (authorized 2026-08-19): task_type=script_evaluation, LOCAL_AUTO only.
 * No LOCAL_PARALLEL, no queueing, no frontier automation, no direct fallback.
 *
 * Feature flag: SUPER_FOCUS_EVAL_ROUTING ('1'/'true' to enable; default off).
 * OFF -> the legacy direct evaluator path runs unchanged.
 * ON  -> the router decision is authoritative; LOCAL_NOT_READY returns a
 *        controlled 503 and NEVER falls back to the direct evaluator.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROUTER_REPO = process.env.VIDTOOLZ_COMPUTE_REPO || '/home/vidtoolz/vidtoolz-compute';
const ROUTER_CLI = path.join(ROUTER_REPO, 'canary', 'routing_canary.py');
const PYTHON_BIN = process.env.SUPER_FOCUS_ROUTING_PYTHON || 'python3';
const ROUTER_TIMEOUT_MS = Number(process.env.SUPER_FOCUS_ROUTING_TIMEOUT_MS) > 0
  ? Number(process.env.SUPER_FOCUS_ROUTING_TIMEOUT_MS)
  : 90000;

// Operational freshness floor for the marginal vidnux 16K fit (seconds).
// The registry max_age is a backstop; this floor is the production rule for
// the eval lane: evidence older than this fails closed (no silent dispatch on
// stale residency). Override via SUPER_FOCUS_EVAL_ROUTING_FRESHNESS_S.
const RESIDENCY_FRESHNESS_S = Number(process.env.SUPER_FOCUS_EVAL_ROUTING_FRESHNESS_S) > 0
  ? Number(process.env.SUPER_FOCUS_EVAL_ROUTING_FRESHNESS_S)
  : 24 * 3600;

// Semantic adoption window for identical evaluations (ms). A fresh evaluation
// with the same script_hash + evaluator model is reused, never re-executed.
const ADOPT_WINDOW_MS = Number(process.env.SUPER_FOCUS_EVAL_ADOPT_WINDOW_MS) > 0
  ? Number(process.env.SUPER_FOCUS_EVAL_ADOPT_WINDOW_MS)
  : 30 * 60 * 1000;

function routingEnabled(options = {}) {
  if (options.superFocusEvalRouting != null) return Boolean(options.superFocusEvalRouting);
  const env = String(process.env.SUPER_FOCUS_EVAL_ROUTING || '').toLowerCase();
  return env === '1' || env === 'true' || env === 'on' || env === 'yes';
}

/**
 * Build the canonical routing task descriptor for a script evaluation.
 * local_only=true is structural: script content must never become a frontier
 * handoff. minimum_context is the num_ctx contract (16384) — never lowered.
 */
function buildScriptEvaluationTaskDescriptor({ scriptText, scriptHash, sentencesCount, projectId } = {}) {
  const chars = String(scriptText || '').length;
  const estimatedInputTokens = Math.max(100, Math.ceil(chars / 4) + (Number(sentencesCount) || 0) * 4);
  return {
    id: `ef-script-eval-${projectId || 'unknown'}-${String(scriptHash || '').slice(0, 16)}`,
    task_type: 'script_evaluation',
    execution_class: { requested: 'LOCAL_AUTO' },
    model_capability: { family: 'qwen3.8', minimum_context: 16384 },
    workload: {
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: 1400,
      parallelizable: false,
    },
    privacy: { local_only: true },
    constraints: {
      require_full_gpu_residency: true,
      allow_cpu_offload: false,
      lane: 'chat',
      max_residency_age_seconds: RESIDENCY_FRESHNESS_S,
    },
    idempotency: { key: `script-eval:${scriptHash}`, adopt_existing: true },
    priority: { class: 'interactive' },
  };
}

/** Invoke the vidtoolz-compute router CLI. Returns the parsed decision JSON.
 * Throws a 503-tagged Error on any router failure (fail-closed: an unknown
 * routing state must never become a silent direct dispatch). */
function callRouter(taskDescriptor, options = {}) {
  const spawnImpl = options.routingSpawn || defaultRouterSpawn;
  const tmp = path.join(os.tmpdir(), `ef-routing-task-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(taskDescriptor));
    let raw;
    try {
      raw = spawnImpl([ROUTER_CLI, 'route', '--task-json', tmp, '--json'], ROUTER_TIMEOUT_MS);
    } catch (err) {
      // Fail closed on ANY router failure (crash, timeout, spawn error):
      // an unknown routing state must never become a silent direct dispatch.
      const e = new Error(`routing canary failed: ${(err && err.message) || 'spawn error'}`);
      e.statusCode = 503;
      e.code = 'ROUTING_UNAVAILABLE';
      e.routing_state = 'LOCAL_NOT_READY';
      throw e;
    }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { /* handled below */ }
    if (!parsed || typeof parsed !== 'object' || !parsed.final_state) {
      const e = new Error('routing decision unavailable (router returned no decision)');
      e.statusCode = 503;
      e.code = 'ROUTING_UNAVAILABLE';
      e.routing_state = 'LOCAL_NOT_READY';
      throw e;
    }
    return parsed;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function defaultRouterSpawn(args, timeoutMs) {
  const result = spawnSync(PYTHON_BIN, args, { encoding: 'utf8', timeout: timeoutMs });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || (result.error && result.error.message) || '').trim();
    const e = new Error(`routing canary failed: ${detail || `exit ${result.status}`}`);
    e.statusCode = 503;
    e.code = 'ROUTING_UNAVAILABLE';
    e.routing_state = 'LOCAL_NOT_READY';
    throw e;
  }
  return result.stdout;
}

/**
 * Find a fresh, adoptable prior evaluation for this exact script + model.
 * Read-only. Returns { evaluation } or null.
 */
function findAdoptableEvaluation(scriptHash, evalModel, loadEvalFn, options = {}) {
  if (!scriptHash || !loadEvalFn) return null;
  let prior = null;
  try { prior = loadEvalFn(options); } catch (_) { prior = null; }
  if (!prior) return null;
  if (prior.stale) return null; // script changed since -> must re-evaluate
  if (prior.script_hash !== scriptHash) return null;
  const modelMatch = (prior.model || {}).model === evalModel;
  if (!modelMatch) return null; // different evaluator contract -> re-evaluate
  const at = Date.parse(prior.evaluated_at || '');
  if (!Number.isFinite(at) || (Date.now() - at) > ADOPT_WINDOW_MS) return null;
  return { evaluation: prior };
}

/**
 * Map a router decision to EF provider semantics. Never falls back, never
 * fabricates a frontier provider. Throws 503s for every non-dispatch state.
 */
function providerFromDecision(decision, options = {}) {
  const state = decision && decision.final_state;
  const localOnly = true; // script_evaluation payloads never leave the estate

  if (state === 'ADOPTED') {
    return { kind: 'adopted', decision };
  }
  if (state === 'WOULD_DISPATCH_LOCAL_AUTO') {
    const sel = decision.selected || {};
    const host = sel.host || '';
    const endpoint = sel.endpoint;
    const model = sel.chat_tag; // eval lane requires the chat-capable tag
    if (!endpoint || !model) {
      const e = new Error('router selection incomplete (missing endpoint or chat-capable tag)');
      e.statusCode = 503;
      e.code = 'ROUTING_SELECTION_INCOMPLETE';
      e.routing_state = 'LOCAL_NOT_READY';
      throw e;
    }
    return {
      kind: 'dispatch',
      decision,
      provider: {
        provider_id: `${host}_ollama`,
        label: `${host} Ollama (LOCAL_AUTO router)`,
        base_url: endpoint,
        model,
        reason: sel.reason || 'router selection',
      },
    };
  }
  if (state === 'BLOCKED_LOCAL_ONLY') {
    // Structurally impossible for script_evaluation (allowed task type); if it
    // appears it is a policy defect. Fail closed, never hand off content.
    const e = new Error('POLICY VIOLATION: local-only task blocked locally');
    e.statusCode = 503;
    e.code = 'ROUTING_POLICY_VIOLATION';
    e.routing_state = state;
    throw e;
  }
  if (state === 'FRONTIER_RECOMMENDED') {
    // local_only=true makes this unreachable by contract; reaching it means a
    // policy/config defect. Record and fail closed — no frontier invocation.
    const e = new Error('POLICY VIOLATION: frontier recommendation for local-only task');
    e.statusCode = 503;
    e.code = 'ROUTING_POLICY_VIOLATION';
    e.routing_state = state;
    throw e;
  }
  // LOCAL_NOT_READY / WOULD_QUEUE / anything else: explicit not-ready. No
  // direct bypass, no context downgrade, no cloud.
  const reason = decision.local_not_ready_reason
    || (decision.candidates ? summarizeRejections(decision) : 'router not ready');
  const e = new Error(`local evaluator not ready: ${reason}`);
  e.statusCode = 503;
  e.code = 'LOCAL_NOT_READY';
  e.routing_state = state || 'LOCAL_NOT_READY';
  throw e;
}

/** Compact per-host rejection summary for operator-readable error/provenance. */
function summarizeRejections(decision) {
  const parts = [];
  const cands = decision.candidates || {};
  for (const [host, c] of Object.entries(cands)) {
    if (c.result === 'ELIGIBLE') continue;
    const reasons = [];
    for (const [gate, g] of Object.entries(c.gates || {})) {
      if (g && g.result && g.result !== 'PASS') {
        const r = Array.isArray(g.reason) ? g.reason.join('; ') : String(g.reason || '');
        reasons.push(`${gate}:${r}`);
      }
    }
    parts.push(`${host}=${c.result}${reasons.length ? ` (${reasons.join(' | ')})` : ''}`);
  }
  return parts.join('; ') || 'no eligible host';
}

module.exports = {
  routingEnabled,
  buildScriptEvaluationTaskDescriptor,
  callRouter,
  findAdoptableEvaluation,
  providerFromDecision,
  summarizeRejections,
  ROUTER_CLI,
  RESIDENCY_FRESHNESS_S,
  ADOPT_WINDOW_MS,
};
