// Super Focus → VIDTOOLZ Production Kanban evaluation bridge.
//
// Doctrine: Episode Factory owns the script and its evaluation truth; the
// Kanban (:8070) owns production workflow state. This module transfers exactly
// one proven state transition — "this exact script content passed the script
// evaluator" — as an idempotent card upsert. It NEVER approves anything in EF,
// never advances EF stage, and a Kanban outage never invalidates a locally
// persisted evaluation (the outcome is recorded on the project for replay via
// scripts/super-focus-kanban-sync.js).
//
// Gate (the ONLY qualifying condition, always re-derived from persisted
// state, never from client input): script_evaluation.verdict === 'PRODUCE'
// (which already encodes total_score >= 80 AND no failing hard gate — see
// script-evaluator.js scoreScriptEvaluation) AND the evaluation is not stale
// (script_hash still matches the current script text). Advisory doctrine is
// preserved: a PRODUCE verdict changes nothing inside EF.

'use strict';

const crypto = require('crypto');
const superFocus = require('./super-focus');

const KANBAN_SOURCE_APP = 'vidtoolz-episode-factory';
const KANBAN_SOURCE_TYPE = 'super-focus-script';
const KANBAN_UPSERT_PATH = '/api/integrations/cards/upsert';
const KANBAN_STAGE = 'draft_script';
const QUALIFYING_VERDICT = 'PRODUCE';

// Deterministic JSON: recursively sorted object keys, no whitespace. Arrays
// keep their order (sentence rows are ordered data). undefined values are
// dropped exactly like JSON.stringify does.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// The evaluation identity: sha256 over the canonical JSON of the persisted
// evaluation MINUS volatile / self-referential fields:
//   - evaluation_hash        (self)
//   - evaluated_at           (timestamp — nondeterministic noise)
//   - stale / stale_reason   (derived freshness flags, not evaluation content)
//   - model.host             (which machine answered — environment, not identity;
//                             model.provider / model.model / model.lane stay IN)
// Everything else — script_hash (sha1 of the exact script string), verdict,
// total_score, score_band, verdict_capped_by_gate, categories, hard gates,
// checklist, sentence rows, warnings — is hashed. The embedded script_hash is
// what binds this identity to the exact evaluated script content: any script
// edit yields a different script_hash, therefore a different evaluation_hash,
// and the stale flag independently blocks the old approval from re-syncing.
function computeEvaluationHash(evaluation) {
  const src = Object.assign({}, evaluation || {});
  delete src.evaluation_hash;
  delete src.evaluated_at;
  delete src.stale;
  delete src.stale_reason;
  if (src.model && typeof src.model === 'object') {
    src.model = Object.assign({}, src.model);
    delete src.model.host;
  }
  return crypto.createHash('sha256').update(canonicalJson(src), 'utf8').digest('hex');
}

// The single definition of "this evaluation qualifies for production state".
function evaluationQualifies(evaluation) {
  return Boolean(evaluation)
    && evaluation.verdict === QUALIFYING_VERDICT
    && !evaluation.stale;
}

// Card payload, derived ONLY from persisted project state. synced_at is
// deliberately NOT part of the card metadata so a byte-identical re-sync is a
// true no-op on the Kanban side (updatedAt stays put).
function buildUpsertPayload(state, evaluation, evaluationHash) {
  const sourceProvenance = state.editorial_source
    ? Object.fromEntries(Object.entries(state.editorial_source).filter(([key, value]) => key !== 'editorial' && value !== undefined))
    : null;
  const exactSourceEditorial = state.editorial_source && state.editorial_source.editorial
    && state.editorial_source.source_script_hash === evaluation.script_hash
    ? state.editorial_source.editorial : null;
  const payload = {
    sourceApp: KANBAN_SOURCE_APP,
    sourceType: KANBAN_SOURCE_TYPE,
    sourceId: state.project_id,
    title: state.title && state.title.trim() ? state.title.trim() : state.project_id,
    stage: KANBAN_STAGE,
    metadata: {
      ef_project_id: state.project_id,
      super_focus_eval: {
        status: 'passed',
        evaluation_hash: evaluationHash,
        script_hash: evaluation.script_hash || null,
        total_score: Number.isFinite(evaluation.total_score) ? evaluation.total_score : null,
        score_band: evaluation.score_band || null,
        verdict: evaluation.verdict,
        evaluated_at: evaluation.evaluated_at || null,
        evaluator_model: evaluation.model && evaluation.model.model ? evaluation.model.model : null,
        ...(sourceProvenance ? {
          source_provenance: sourceProvenance,
          ...(exactSourceEditorial ? { editorial: Object.assign({}, exactSourceEditorial) } : {}),
        } : {}),
      },
    },
  };
  if (typeof state.kanban_card_id === 'string' && state.kanban_card_id) {
    payload.cardId = state.kanban_card_id;
  }
  return payload;
}

// Default loopback client (mirrors the server's kanbanRequest semantics:
// 5 s bound, errors carry .statusCode/.code, unreachable -> 502
// kanban_unreachable). Port read at call time so tests/CLI env apply.
async function defaultKanbanRequest(method, apiPath, body) {
  const port = Number(process.env.KANBAN_PORT) || 8070;
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const error = new Error(`Kanban server unreachable: ${err.message}`);
    error.statusCode = 502;
    error.code = 'kanban_unreachable';
    throw error;
  }
  let parsed = null;
  try { parsed = await response.json(); } catch (_) { /* non-JSON body */ }
  if (response.ok) return parsed;
  const message = parsed && (parsed.message || parsed.error)
    ? (parsed.message || parsed.error)
    : `Kanban request failed (HTTP ${response.status}).`;
  const error = new Error(message);
  error.statusCode = response.status;
  error.code = parsed && parsed.error ? parsed.error : null;
  throw error;
}

// Sync one project's qualifying evaluation to the Kanban. Idempotent and
// non-throwing: every outcome (synced / skipped / failed) is returned as a
// plain object, and synced/failed outcomes are durably recorded on the project
// (state.kanban_sync) so an operator can see and replay failures. Skipped
// outcomes (not qualified / not active) write nothing — the bridge must never
// stamp production-sync state onto a project that never qualified.
async function syncProjectToKanban(projectId, options = {}) {
  const root = options.root;
  const requestFn = options.requestFn || defaultKanbanRequest;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const attemptedAt = new Date().toISOString();

  const lifecycle = superFocus.projectLifecycle(projectId, { root });
  if (lifecycle !== 'active') {
    return { status: 'skipped', reason: lifecycle === 'archived' ? 'project_archived' : 'project_missing', project_id: projectId };
  }

  // Re-derive the gate from persisted state (readScriptEvaluation recomputes
  // staleness against the CURRENT script text) — client input can never forge
  // a qualification, and a script edited after its pass is refused here.
  const evaluation = superFocus.readScriptEvaluation(projectId, { root });
  if (!evaluationQualifies(evaluation)) {
    return {
      status: 'skipped',
      reason: !evaluation ? 'no_evaluation' : (evaluation.stale ? 'evaluation_stale' : 'verdict_not_produce'),
      project_id: projectId,
      verdict: evaluation ? evaluation.verdict : null,
    };
  }

  // Identity is always recomputed from the persisted evaluation bytes; the
  // stored evaluation_hash (stamped at persist time) is cross-checked so any
  // divergence (hand-edited state) is loud instead of silently trusted.
  const evaluationHash = computeEvaluationHash(evaluation);
  if (evaluation.evaluation_hash && evaluation.evaluation_hash !== evaluationHash) {
    log(`project ${projectId}: stored evaluation_hash differs from recomputed identity; using recomputed.`);
  }

  const state = superFocus.loadProject(projectId, { root });
  const payload = buildUpsertPayload(state, evaluation, evaluationHash);

  try {
    const response = await requestFn('POST', KANBAN_UPSERT_PATH, payload);
    const card = response && response.card ? response.card : null;
    const outcome = {
      status: 'synced',
      evaluation_hash: evaluationHash,
      card_id: card ? card.id : null,
      card_stage: card ? card.stage : null,
      card_existing: response ? Boolean(response.existing) : null,
      card_stage_changed: response ? Boolean(response.stageChanged) : null,
      attempted_at: attemptedAt,
    };
    superFocus.recordKanbanSync(projectId, outcome, { root });
    return outcome;
  } catch (err) {
    const outcome = {
      status: 'failed',
      evaluation_hash: evaluationHash,
      error: {
        code: err.code || null,
        statusCode: err.statusCode || null,
        message: err.message,
      },
      attempted_at: attemptedAt,
    };
    log(`project ${projectId}: Kanban sync failed (${err.code || err.statusCode || 'error'}): ${err.message}`);
    try {
      superFocus.recordKanbanSync(projectId, outcome, { root });
    } catch (recordErr) {
      log(`project ${projectId}: could not record failed sync: ${recordErr.message}`);
    }
    return outcome;
  }
}

module.exports = {
  KANBAN_SOURCE_APP,
  KANBAN_SOURCE_TYPE,
  KANBAN_UPSERT_PATH,
  KANBAN_STAGE,
  QUALIFYING_VERDICT,
  canonicalJson,
  computeEvaluationHash,
  evaluationQualifies,
  buildUpsertPayload,
  defaultKanbanRequest,
  syncProjectToKanban,
};
