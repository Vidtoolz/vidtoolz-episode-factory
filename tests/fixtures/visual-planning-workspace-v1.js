'use strict';

// Deterministic positive fixture for the frozen Visual Planning Workspace V1
// contract. Tests materialize these immutable inputs in an isolated root; no
// mutable historical package run is required.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const visualPlan = require('../../scripts/visual-plan.js');

const RUN_ID = '2026-08-24-workspace-v1-fixture';
const AGENT_ID = 'visual_planning_director';
const TASK_ID = 'visual-planning-workspace-v1-task';
const INVOCATION_ID = `${AGENT_ID}:${TASK_ID}:1`;
const B1 = 'visual-beat-01HF7YAT010000000000000001';
const B2 = 'visual-beat-01HF7YAT020000000000000002';
const S1 = 'shot-01HF7YAT030000000000000003';
const S2 = 'shot-01HF7YAT040000000000000004';
const P1 = 'prompt-01HF7YAT050000000000000005';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function writeJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { bytes, sha256: sha256(bytes) };
}
function beat(id, sectionId) {
  return { canonical_beat_id: id, section_id: sectionId, aliases: [], source_provenance: null };
}

function buildPlan() {
  const storyHash = visualPlan.sha256('workspace fixture Story bytes');
  const story = {
    project_id: 'workspace-fixture-project',
    version_id: 'script-version-01JWORKSPACE000000000000',
    content_hash: storyHash,
    approval: {
      state: 'approved', approved_by: 'FIXTURE_HUMAN', approved_at: '2026-08-24T08:00:00.000Z',
      version_id: 'script-version-01JWORKSPACE000000000000', content_hash: storyHash,
    },
    section_ids: ['sec-hook', 'sec-proof'],
  };
  const shot1 = {
    shot_id: S1, section_ref: { section_id: 'sec-hook' }, beat_ref: beat(B1, 'sec-hook'),
    narrative_function: 'establish the production problem', subject: 'editor workstation',
    media_type: 'GENERATED_STILL', generation_mode: 'STILL',
    shot_brief: 'A bounded editorial illustration of an editor waiting for a render.', visual_assertion: null,
    presenter_relation: 'BROLL_OVERLAY', research_sensitive: false, research_refs: [], camera_intent: null,
    generation_requirements: {
      artifact_class: 'image', aspect_target: '16:9', duration_target_s: 4,
      input_artifact_refs: [], quality_constraints: ['no legible brands'], candidate_count_request: 2, generation_mode: 'STILL',
    },
    continuity_notes: ['retain workstation motif'], edit_placement: 'hook support', priority: 'HIGH', status: 'PROMPT_READY', prompt_refs: [P1],
  };
  const shot2 = {
    shot_id: S2, section_ref: { section_id: 'sec-proof' }, beat_ref: beat(B2, 'sec-proof'),
    narrative_function: 'deliver the qualified conclusion', subject: 'presenter',
    media_type: 'PRESENTER_A_ROLL', generation_mode: 'NOT_APPLICABLE',
    shot_brief: 'Presenter delivers the qualified conclusion without generated media.', visual_assertion: null,
    presenter_relation: 'PRESENT', research_sensitive: false, research_refs: [], camera_intent: null,
    generation_requirements: {
      artifact_class: 'presenter', input_artifact_refs: [], quality_constraints: [], generation_mode: 'NOT_APPLICABLE',
    },
    continuity_notes: [], edit_placement: 'proof section', priority: 'NORMAL', status: 'PLANNED', prompt_refs: [],
  };
  const plan = {
    schema_version: 1, artifact_type: 'visual-plan', plan_id: 'visual-plan-01HF7YAT000000000000000000', plan_revision: 1,
    supersedes: null, created_at: '2026-08-24T09:00:00.000Z', created_by: 'VISUAL_PLANNING_WORKSPACE_FIXTURE',
    lifecycle_state: 'AWAITING_HUMAN_REVIEW', story,
    required_beats: [beat(B1, 'sec-hook'), beat(B2, 'sec-proof')],
    coverage: [
      { beat_ref: beat(B1, 'sec-hook'), decision: 'PLAN_SHOTS', shot_ids: [S1], reason: null },
      { beat_ref: beat(B2, 'sec-proof'), decision: 'PLAN_SHOTS', shot_ids: [S2], reason: null },
    ],
    shots: [shot1, shot2],
    prompts: [{
      prompt_id: P1, prompt_revision: 1, shot_id: S1, shot_intent_digest_sha256: visualPlan.shotIntentDigest(shot1),
      prompt_text: 'Editorial workstation awaiting a render, restrained lighting, no logos.', prompt_type: 'FULL_FRAME',
      created_by: 'visual-planning-director', origin: 'visual-planning-director', legacy_aliases: [],
    }],
    plan_digest_sha256: '',
  };
  plan.plan_digest_sha256 = visualPlan.planDigest(plan);
  return plan;
}

function materialize(root, identity = {}) {
  const runId = identity.run_id || RUN_ID;
  const taskId = identity.task_id || TASK_ID;
  const invocationId = identity.invocation_id || INVOCATION_ID;
  const registry = { schema_version: 1, agents: [{
    agent_id: AGENT_ID, name: 'Visual Planning Director', role: 'visual_planning',
    human_gate_type: 'VISUAL_PLAN_APPROVAL', implementation: 'scripts/visual-planning-director.js',
    implementation_state: 'IMPLEMENTATION_PROVEN',
    lifecycle: { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED' },
  }] };
  writeJson(path.join(root, 'config', 'agent-registry.json'), registry);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'visual-planning-director.js'), "'use strict'; module.exports = {};\n");
  const directory = path.join(root, 'package-runs', runId, 'agents', AGENT_ID, taskId);
  const plan = buildPlan();
  const task = {
    task_id: taskId, package_run_id: runId, project_id: plan.story.project_id,
    assignment: { action: 'review_visual_plan' }, story: plan.story,
  };
  const result = {
    agent_id: AGENT_ID, task_id: taskId, state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW',
    events: [], visual_plan: plan,
    operational_rationale: {
      source: 'AGENT', decision: 'REVIEW', reason: 'Review complete beat coverage and the exact planned shots.',
      evidence_refs: [{ ref: 'visual_plan', summary: plan.plan_id }], confidence: null,
      escalation_reason: 'Visual Plan approval remains a human gate.',
    },
    control_room: { state: 'AWAITING_HUMAN_REVIEW', attention_level: 'REVIEW' },
    semantic: { beats: [
      { canonical_beat_id: B1, shots: [{ why_it_serves_story: 'Establishes the production constraint before the proof.' }] },
      { canonical_beat_id: B2, shots: [{ why_it_serves_story: 'Preserves the qualified conclusion in presenter delivery.' }] },
    ] },
    authority: { state: 'AWAITING_HUMAN_REVIEW', authorization_ok: false, approval: { state: 'MISSING', valid: false, reason_codes: ['PLAN_APPROVAL_MISSING'] } },
  };
  const taskWrite = writeJson(path.join(directory, 'task.json'), task);
  const resultWrite = writeJson(path.join(directory, 'result.json'), result);
  const artifactWrite = writeJson(path.join(directory, 'artifacts', 'visual-plan.json'), plan);
  const endedAt = '2026-08-24T09:00:01.000Z';
  const invocation = {
    schema_version: 1, runner_version: 'agent-runner-v1', invocation_id: invocationId,
    infrastructure_state: 'COMPLETE', agent_id: AGENT_ID, task_id: taskId, attempt_number: 1,
    module_path: 'scripts/visual-planning-director.js', repository_head: 'fixture',
    task_sha256: taskWrite.sha256, result_sha256: resultWrite.sha256,
    started_at: '2026-08-24T09:00:00.000Z', ended_at: endedAt, exit_code: 0,
    semantic_state: 'AWAITING_HUMAN_REVIEW',
    handoff_summary: { next_owner: 'mikko', next_action: 'Review Visual Plan', attention: 'REVIEW', human_gate: true, blocker: null, auto_executed: false },
    artifacts: [{ field: 'visual_plan', path: 'artifacts/visual-plan.json', sha256: artifactWrite.sha256 }],
  };
  writeJson(path.join(directory, 'invocation.json'), invocation);
  writeJson(path.join(root, 'package-runs', runId, 'agents', 'index.json'), {
    schema_version: 1, runner_version: 'agent-runner-v1', invocations: [{
      invocation_id: invocationId, agent_id: AGENT_ID, task_id: taskId, attempt_number: 1,
      state: 'AWAITING_HUMAN_REVIEW', attention: 'REVIEW', next_owner: 'mikko',
      task_directory: `${AGENT_ID}/${taskId}`, completed_at: endedAt,
    }],
  });
  return {
    root, plan, artifact_sha256: artifactWrite.sha256,
    request: { run_id: runId, agent_id: AGENT_ID, task_id: taskId, invocation_id: invocationId },
  };
}

module.exports = { RUN_ID, AGENT_ID, TASK_ID, INVOCATION_ID, buildPlan, materialize };
