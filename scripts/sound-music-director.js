#!/usr/bin/env node
'use strict';
// SOUND & MUSIC DIRECTOR — sixth specialist agent (first of the post-lock
// build order). Turns an APPROVED musical direction (Scorecraft approved cue
// sheet → MusicRenderBrief v1) into bounded, provenance-bound generation
// candidates through the EXISTING music_generation lane, evaluates them with
// deterministic validators + bounded musical judgment, and presents evidence
// for Mikko's human review. It never self-approves, never picks routing
// policy, never overrides QC, and never invents creative direction.
//
// Usage:
//   node scripts/sound-music-director.js --task <task.json> [--out <result.json>]
//
// Task envelope:
// {
//   "task_id": "SM-001", "project_id": "<scorecraft project id>",
//   "requested_by": "hermes",
//   "assignment": { "action": "generate" | "evaluate" | "status",
//                   "candidate_count": 2 },
//   "max_generation_attempts": 1,        // per-cue dispatch rounds (bounded)
//   "authorized_lane": "music_generation", // must match routing policy
//   "qc_signoff": true                    // supplied only by QC tooling
// }
//
// Scorecraft remains the engine: cue planning, brief export, the caption
// adapter, lane selection, candidate persistence and the two-step human gate
// all stay in score-engine/. This agent is the judgment + orchestration
// layer ON TOP: it validates authority preconditions, invokes the bridge's
// existing fail-closed entry points, interprets validator output, decides
// retry-vs-escalate inside its budget, and emits control-room state.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENT_ID = 'sound_music_director';

const scoreLane = require(path.join(REPO_ROOT, 'score-engine', 'score-lane.js'));
const dispatch = require(path.join(REPO_ROOT, 'score-engine', 'music-dispatch.js'));
const contractValidator = require(path.join(REPO_ROOT, 'scripts', 'agent-contract-validator.js'));

// Authorized execution route. Generation Supervisor owns general backend/
// machine ROUTING POLICY; Sound & Music may execute only through this
// registered music lane via score-engine/music-dispatch.js — which itself
// takes its host from the compute authority and NEVER falls back. Any task
// naming a different lane fails closed before anything is dispatched.
const AUTHORIZED_LANE = 'music_generation';

// Bounded autonomy.
const DEFAULT_MAX_ATTEMPTS = 1;
const MAX_ATTEMPTS_HARD_CAP = 3;

// State progression uses repository-native candidate states where they exist
// (prepared/queued/generating/completed/failed/blocked) and adds only the
// agent-level orchestration states below.
const STATE_OWNERS = {
  INPUT_MISSING: 'production_operations',
  PLAN_UNAPPROVED: 'mikko',                 // approved brief is a human gate
  NO_AUTHORIZED_ROUTE: 'production_operations',
  RESOURCE_UNAVAILABLE: 'production_operations',
  GENERATION_FAILED: 'sound_music_director', // owns retry-vs-escalate inside budget
  RETRY_BUDGET_EXHAUSTED: 'hermes',          // escalation, not silent retry
  EVALUATION_COMPLETE: 'mikko',              // awaiting human review
  AWAITING_HUMAN_REVIEW: 'mikko',
  QC_FAILED: 'sound_music_director',         // repairs/regenerates, never overrides
  COMPLETE: null,
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function nowIso() { return new Date().toISOString(); }

function baseResult(task) {
  return {
    schema_version: 1,
    agent_id: AGENT_ID,
    role_id: 'sound_music_director',
    task_id: task.task_id || null,
    project_id: task.project_id || null,
    requested_by: task.requested_by || null,
    state: null,
    attention: 'AUTONOMOUS',
    disagreement_state: 'NONE',
    attempts: 0,
    max_attempts: Math.min(MAX_ATTEMPTS_HARD_CAP,
      Number.isInteger(task.max_generation_attempts) ? task.max_generation_attempts : DEFAULT_MAX_ATTEMPTS),
    candidates: [],
    recommendation: null,
    approval_binding_status: 'NOT_PRESENT',
    qc: { state: 'NOT_RUN', findings: [], signoff_source: null },
    handoff: null,
    provenance: null,
    events: [],
  };
}

// ── input validation: mandatory inputs produce explicit states, never
//    invented direction ──────────────────────────────────────────────────────
function validateInputs(task, result) {
  if (!task.task_id || !task.project_id) {
    result.state = 'INPUT_MISSING';
    result.reason = 'task_id and project_id are required';
    return false;
  }
  const action = (task.assignment && task.assignment.action) || 'generate';
  if (!['generate', 'evaluate', 'status'].includes(action)) {
    result.state = 'INPUT_MISSING';
    result.reason = `assignment.action "${action}" is not one of generate|evaluate|status`;
    return false;
  }
  const lane = task.authorized_lane || AUTHORIZED_LANE;
  if (lane !== AUTHORIZED_LANE) {
    result.state = 'NO_AUTHORIZED_ROUTE';
    result.reason = `lane "${lane}" is not the authorized music execution route ("${AUTHORIZED_LANE}") — Generation Supervisor owns routing policy; fail-closed`;
    return false;
  }
  return true;
}

// The approved musical direction is a HUMAN GATE: Scorecraft's cue-sheet
// approval flag (set only by Mikko's two-step gate in Scorecraft) is the
// canonical signal. Missing/unapproved ⇒ PLAN_UNAPPROVED, never invention.
function requireApprovedBrief(task, options, result) {
  let g;
  try {
    g = scoreLane.getProject(task.project_id, options);
  } catch (e) {
    result.state = 'INPUT_MISSING';
    result.reason = `Scorecraft project not found: ${e.message}`;
    return null;
  }
  const project = g.project;
  if (!project.cue_sheet_approved) {
    result.state = 'PLAN_UNAPPROVED';
    result.reason = 'cue sheet is not approved — Sound & Music cannot invent musical direction; route to Mikko for approval first';
    result.attention = 'DECISION';
    return null;
  }
  return project;
}

// ── deterministic evaluation services (measured, never aesthetic claims) ────
// Reuses the engine's own deterministic analyzers; adds artifact-level checks.
function evaluateCandidateDeterministic(candidateMeta, recordDir, projectDurationS) {
  const checks = { duration: null, file_integrity: null, provenance: null };
  const wavPath = path.join(recordDir, 'production.wav');
  if (!fs.existsSync(wavPath)) {
    checks.file_integrity = { state: 'FAIL', reason: 'production.wav missing' };
    return checks;
  }
  const bytes = fs.readFileSync(wavPath);
  const actualHash = sha256(bytes);
  checks.file_integrity = {
    state: actualHash === candidateMeta.output_sha256 ? 'PASS' : 'FAIL',
    sha256: actualHash,
    recorded_sha256: candidateMeta.output_sha256 || null,
  };
  if (candidateMeta.requested_duration_s && Number(candidateMeta.measured_duration_seconds) > 0) {
    const err = Number(candidateMeta.measured_duration_seconds) - Number(candidateMeta.requested_duration_s);
    checks.duration = {
      state: Math.abs(err) <= 0.5 ? 'PASS' : 'WARN',
      requested_seconds: Number(candidateMeta.requested_duration_s),
      measured_seconds: Number(candidateMeta.measured_duration_seconds),
      deviation_seconds: Math.round(err * 1000) / 1000,
      source: 'engine ffprobe measurement recorded at generation time',
    };
  } else {
    checks.duration = { state: 'UNKNOWN', reason: 'no measured duration recorded' };
  }
  checks.provenance = {
    state: (candidateMeta.generation_job_id && candidateMeta.workflow_hash && candidateMeta.brief_hash) ? 'PASS' : 'FAIL',
    generation_job_id: candidateMeta.generation_job_id || null,
    brief_hash: candidateMeta.brief_hash || null,
    plan_revision_id: candidateMeta.plan_revision_id || null,
  };
  void projectDurationS;
  return checks;
}

// ── bounded musical judgment: INTERPRETS deterministic output; it never
//    pretends a metric proves aesthetic quality ──────────────────────────────
function judgeCandidate(meta, detChecks) {
  const notes = [];
  let verdict = 'RECOMMEND'; // agent-level recommendation only — never approval

  if (detChecks.file_integrity && detChecks.file_integrity.state === 'FAIL') { verdict = 'REJECT_TECHNICAL'; notes.push('artifact hash mismatch or missing file — technical corruption'); }
  if (detChecks.provenance && detChecks.provenance.state === 'FAIL') { verdict = 'REJECT_TECHNICAL'; notes.push('provenance incomplete — cannot trace generation identity'); }
  if (detChecks.duration && detChecks.duration.state === 'WARN') {
    notes.push(`duration deviates ${detChecks.duration.deviation_seconds}s from target — acceptable within tolerance but flagged`);
  }

  const interpretation = meta.interpretation;
  if (interpretation) {
    notes.push(`candidate follows concept "${interpretation.label || interpretation.interpretation_id}" (axes: ${JSON.stringify(interpretation.axes || {})})`);
  }
  if (/aggress|heavy|dense/i.test(String(meta.caption || ''))) {
    notes.push('caption indicates high-energy material — narration intelligibility check required against dialogue density before final use');
  }
  return { verdict, notes, basis: 'deterministic validator results + bounded craft interpretation; NOT a substitute for human taste' };
}

// Approval binding status via the CANONICAL mechanism. Sound & Music verifies
// whether a valid binding exists; it can never create one.
function approvalBindingStatus(meta, recordDir) {
  const wavPath = path.join(recordDir, 'production.wav');
  if (meta.human_verdict !== 'use') return { state: 'AWAITING_HUMAN_REVIEW', detail: 'human verdict not yet recorded in Scorecraft two-step gate' };
  const binding = {
    artifact_path: wavPath,
    artifact_sha256: meta.approval_artifact_sha256 || meta.output_sha256,
    commit: meta.approval_source_commit || null,
    approved_by: meta.approved_by || null,
    approved_at: meta.approved_at || null,
    scope: `music candidate ${meta.candidate_id}`,
  };
  const currentBytes = fs.existsSync(wavPath) ? fs.readFileSync(wavPath) : null;
  const r = contractValidator.verifyApprovalBinding(binding, currentBytes);
  return { state: r.verdict, detail: r.reason || 'binding verified against exact artifact bytes', verifier: 'agent-contract verifyApprovalBinding' };
}

async function run(task, options = {}) {
  const result = baseResult(task);
  const ev = (state, detail) => result.events.push({ at: nowIso(), actor: AGENT_ID, state, detail: detail || null });

  ev('ASSIGNMENT_RECEIVED', `${(task.assignment && task.assignment.action) || 'generate'} from ${result.requested_by}`);
  if (!validateInputs(task, result)) {
    finish(result, ev);
    return result;
  }

  // Scorecraft options pass-through (settingsPath/musicRoot) for hermetic runs.
  const scOptions = {};
  for (const k of ['settingsPath', 'musicRoot']) if (task[k]) scOptions[k] = task[k];
  Object.assign(options, scOptions);

  const action = task.assignment.action;
  if (action === 'status') return await statusOnly(task, options, result, ev);

  const project = requireApprovedBrief(task, options, result);
  if (!project) { finish(result, ev); return result; }
  ev('APPROVED_BRIEF_CONFIRMED', `cue sheet approved, ${project.cues.length} cues, ${project.duration_seconds}s`);

  if (action === 'evaluate') return evaluateExisting(task, options, result, ev);

  // ── generate: bounded rounds through the authorized lane ──────────────────
  while (result.attempts < result.max_attempts) {
    result.attempts += 1;
    result.state = 'GENERATING';
    ev('DISPATCH_ROUND', `attempt ${result.attempts}/${result.max_attempts} via ${AUTHORIZED_LANE}`);
    try {
      const prepared = await dispatch.requestMusicGeneration(task.project_id, {
        candidate_count: Math.min(3, Math.max(1, Number(task.assignment.candidate_count) || 2)),
        prepare_only: false,
      }, options);
      ev('DISPATCH_ACCEPTED', `job ${prepared.generation_job_id}, host chosen by compute authority`);
      result.dispatch = { job_id: prepared.generation_job_id, lane: AUTHORIZED_LANE, host: prepared.selected_host || null };
    } catch (e) {
      const msg = String(e.message || e);
      ev('DISPATCH_REFUSED', msg.slice(0, 300));
      if (e.statusCode === 503 || /not admitted|unreachable|BLOCKED/i.test(msg)) {
        result.state = 'RESOURCE_UNAVAILABLE';
        result.reason = `music_generation lane refused admission: ${msg.slice(0, 200)}`;
        result.attention = 'INFORMATION';
        finish(result, ev);
        return result;
      }
      if (e.statusCode === 409) {
        result.state = 'RESOURCE_UNAVAILABLE';
        result.reason = 'another generation job holds the single-job lock';
        finish(result, ev);
        return result;
      }
      // mechanical failure inside budget → retry; else escalate
      if (result.attempts < result.max_attempts) continue;
      result.state = 'RETRY_BUDGET_EXHAUSTED';
      result.disagreement_state = 'NONE';
      result.reason = `generation failed after ${result.attempts} attempt(s): ${msg.slice(0, 200)} — escalating rather than silently retrying`;
      result.attention = 'REVIEW';
      finish(result, ev);
      return result;
    }
    break;
  }
  return evaluateExisting(task, options, result, ev);
}

// Evaluate whatever candidates exist for the project (fresh or prior rounds).
async function evaluateExisting(task, options, result, ev) {
  result.state = 'EVALUATING';
  const settings = scoreLane.loadSettings(options);
  const { dir } = scoreLane.resolveProjectDir(settings, task.project_id);
  const project = scoreLane.getProject(task.project_id, options).project;
  const records = [];
  try {
    // recordLocations shape ({dir, file, meta}) is internal; derive it the same
    // way production-candidates does via its public root() + list() metadata.
    const pc = require(path.join(REPO_ROOT, 'score-engine', 'production-candidates.js'));
    for (const name of fs.readdirSync(pc.root(dir)).sort()) {
      const cdir = path.join(pc.root(dir), name);
      const file = path.join(cdir, 'music-candidate.json');
      if (!fs.existsSync(file)) continue;
      records.push({ dir: cdir, meta: JSON.parse(fs.readFileSync(file, 'utf8')) });
    }
  } catch (e) {
    result.state = 'INPUT_MISSING';
    result.reason = `no candidate records readable: ${e.message}`;
    finish(result, ev);
    return result;
  }
  if (!records.length) {
    result.state = 'INPUT_MISSING';
    result.reason = 'no generation candidates exist to evaluate';
    finish(result, ev);
    return result;
  }

  for (const rec of records) {
    const det = evaluateCandidateDeterministic(rec.meta, rec.dir, project.duration_seconds);
    const judgment = judgeCandidate(rec.meta, det);
    const approval = approvalBindingStatus(rec.meta, rec.dir);
    result.candidates.push({
      candidate_id: rec.meta.candidate_id,
      backend: rec.meta.backend,
      seed: rec.meta.seed ?? null,
      interpretation: rec.meta.interpretation ? rec.meta.interpretation.label : null,
      requested_duration_s: rec.meta.requested_duration_s ?? null,
      measured_duration_s: rec.meta.measured_duration_seconds ?? null,
      generation_status: rec.meta.status,
      human_verdict: rec.meta.human_verdict,
      deterministic_checks: det,
      agent_judgment: judgment,
      approval_binding: approval,
    });
  }
  ev('EVALUATED', `${result.candidates.length} candidates`);

  // Recommendation: best technically-clean candidate by deterministic order,
  // expressed as a proposal for human review — never as approval.
  const usable = result.candidates.filter((c) => c.agent_judgment.verdict === 'RECOMMEND'
    && c.generation_status === 'completed');
  if (usable.length) {
    result.recommendation = {
      recommended_candidate: usable[0].candidate_id,
      alternatives: usable.slice(1).map((c) => c.candidate_id),
      rationale: 'technically clean per deterministic checks; final taste decision belongs to Mikko',
      action: 'ROUTE_TO_HUMAN',
    };
    result.state = 'AWAITING_HUMAN_REVIEW';
    result.attention = 'REVIEW';
    // External QC sign-off axis: only QC tooling supplies qc_signoff=true.
    result.qc = { state: task.qc_signoff === true ? 'QC_PASS_PENDING_SIGNOFF_RECORDED' : 'QC_PENDING', findings: [], signoff_source: task.qc_signoff === true ? 'task_envelope' : null };
  } else {
    const anyCompleted = result.candidates.some((c) => c.generation_status === 'completed');
    if (anyCompleted) {
      result.state = 'QC_FAILED';
      result.qc = { state: 'QC_FAILED', findings: result.candidates.flatMap((c) => c.agent_judgment.notes), signoff_source: null };
      result.reason = 'all completed candidates have technical findings — repair/regenerate within remaining budget or escalate';
    } else {
      result.state = 'RETRY_BUDGET_EXHAUSTED';
      result.reason = 'no completed candidates available for evaluation';
      result.attention = 'REVIEW';
    }
  }
  finish(result, ev);
  return result;
}

async function statusOnly(task, options, result, ev) {
  const settings = scoreLane.loadSettings(options);
  let dir;
  try { ({ dir } = scoreLane.resolveProjectDir(settings, task.project_id)); }
  catch (e) { result.state = 'INPUT_MISSING'; result.reason = e.message; finish(result, ev); return result; }
  const records = [];
  try {
    const pc = require(path.join(REPO_ROOT, 'score-engine', 'production-candidates.js'));
    for (const name of fs.readdirSync(pc.root(dir)).sort()) {
      const cdir = path.join(pc.root(dir), name);
      const file = path.join(cdir, 'music-candidate.json');
      if (!fs.existsSync(file)) continue;
      records.push({ dir: cdir, meta: JSON.parse(fs.readFileSync(file, 'utf8')) });
    }
  } catch (e) {
    result.state = 'INPUT_MISSING';
    result.reason = `no candidate records readable: ${e.message}`;
    finish(result, ev);
    return result;
  }
  const anyGenerating = records.some((r) => ['queued', 'submitting', 'generating'].includes(r.meta.status));
  result.state = anyGenerating
    ? 'GENERATING' : (records.length ? 'EVALUATION_COMPLETE' : 'INPUT_MISSING');
  result.candidates = records.map((r) => ({ candidate_id: r.meta.candidate_id, status: r.meta.status }));
  finish(result, ev);
  return result;
}

function finish(result, ev) {
  if (!result.state) result.state = 'COMPLETE';
  const owner = STATE_OWNERS[result.state];
  result.handoff = {
    next_owner: owner === undefined ? 'production_operations' : owner,
    next_action: owner === 'mikko' ? 'HUMAN_REVIEW_OR_APPROVAL'
      : owner === 'hermes' ? 'ESCALATE_WITH_EVIDENCE'
      : owner ? 'REMEDIATE' : 'NONE',
  };
  result.provenance = {
    acting_agent: AGENT_ID,
    authorized_lane: AUTHORIZED_LANE,
    attempts_used: result.attempts,
    source_commit: (() => { try { return require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    recorded_at: nowIso(),
  };
  ev(result.state, result.reason || null);
}

// Control-room projection (contract §control_room_contract): summary only.
function controlRoomView(result) {
  return {
    role: 'Sound & Music Director',
    state: result.state,
    current_task: result.task_id,
    current_cue_or_artifact: result.candidates.length ? result.candidates[0].candidate_id : null,
    owner: AGENT_ID,
    next_owner: result.handoff ? result.handoff.next_owner : null,
    attention_level: result.attention,
    blocker: result.reason || null,
    unresolved_disagreement: result.disagreement_state,
    resource_dependency: result.dispatch ? `${result.dispatch.lane}@${result.dispatch.host}` : AUTHORIZED_LANE,
    latest_event: result.events.length ? result.events[result.events.length - 1] : null,
    music_summary: {
      generating_or_evaluating: ['GENERATING', 'EVALUATING'].includes(result.state),
      awaiting_approval: result.state === 'AWAITING_HUMAN_REVIEW',
      attempt_number: result.attempts,
      recommended_candidate: result.recommendation ? result.recommendation.recommended_candidate : null,
      approval_states: Object.fromEntries(result.candidates.map((c) => [c.candidate_id, c.approval_binding.state])),
    },
  };
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--task') args.task = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
  }
  if (!args.task) { console.error('usage: sound-music-director.js --task <task.json> [--out result.json]'); process.exit(2); }
  const task = JSON.parse(fs.readFileSync(args.task, 'utf8'));
  const result = await run(task);
  const payload = { ...result, control_room: controlRoomView(result) };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify(payload, null, 2));
  const okStates = ['COMPLETE', 'AWAITING_HUMAN_REVIEW', 'EVALUATION_COMPLETE', 'RESOURCE_UNAVAILABLE'];
  process.exit(okStates.includes(result.state) ? 0 : 1);
}

module.exports = {
  AGENT_ID, AUTHORIZED_LANE, STATE_OWNERS,
  MAX_ATTEMPTS_HARD_CAP, DEFAULT_MAX_ATTEMPTS,
  validateInputs, requireApprovedBrief, evaluateCandidateDeterministic,
  judgeCandidate, approvalBindingStatus, run, controlRoomView,
};

if (require.main === module) main();
