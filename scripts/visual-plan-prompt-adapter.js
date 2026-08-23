'use strict';

const dryRun = require('./script-image-assets-dry-run.js');
const visualPlan = require('./visual-plan.js');

const PROMPT_MEDIA = new Set(['GENERATED_STILL', 'GENERATED_VIDEO', 'INFOGRAPHIC', 'MAP_ANIMATION', 'TEXT_GRAPHIC']);

function promptTypeFor(shot) {
  if (shot.media_type === 'MAP_ANIMATION') return 'MAP';
  if (shot.media_type === 'INFOGRAPHIC') return 'INFOGRAPHIC';
  if (shot.media_type === 'GENERATED_VIDEO') return 'VIDEO';
  if (shot.media_type === 'TEXT_GRAPHIC') return 'TEXT_GRAPHIC';
  return shot.presenter_relation === 'BROLL_OVERLAY' || shot.presenter_relation === 'PICTURE_IN_PICTURE' ? 'PRESENTER_AWARE' : 'FULL_FRAME';
}

function promptTextFor(shot, index) {
  if (shot.media_type === 'MAP_ANIMATION') return `CAMERA HANDOFF ONLY. Geographic subject: ${shot.subject}. Story purpose: ${shot.narrative_function}. Desired reveal: ${shot.camera_intent?.desired_reveal || 'none specified'}. No camera mechanics.`;
  if (shot.media_type === 'SCREEN_CAPTURE' || shot.media_type === 'PRESENTER_A_ROLL' || shot.media_type === 'ARCHIVAL_EXTERNAL') return null;
  const block = { block_id: `block-${String(index + 1).padStart(3, '0')}`, text: `${shot.shot_brief} Purpose: ${shot.narrative_function}. Subject: ${shot.subject}.` };
  const built = dryRun.buildPromptForBlock(block, shot.presenter_relation === 'NONE' || shot.presenter_relation === 'REPLACE' ? 1 : 3);
  const presenterAware = shot.presenter_relation === 'BROLL_OVERLAY' || shot.presenter_relation === 'PICTURE_IN_PICTURE';
  if (!presenterAware) return built.full_prompt;
  return `${built.full_prompt} Presenter-composite requirement: treat this as a calm supporting plate, reserve clear negative space for the presenter, and avoid a busy full-frame composition.`;
}

function buildPromptRecords(shots, options = {}) {
  const prompts = [];
  for (const [index, shot] of shots.entries()) {
    if (!PROMPT_MEDIA.has(shot.media_type)) continue;
    const text = promptTextFor(shot, index);
    if (!text) continue;
    const promptId = (options.newPromptId || visualPlan.newPromptId)();
    shot.prompt_refs.push(promptId);
    shot.status = 'PROMPT_READY';
    prompts.push({
      prompt_id: promptId,
      prompt_revision: 1,
      shot_id: shot.shot_id,
      shot_intent_digest_sha256: visualPlan.shotIntentDigest(shot),
      prompt_text: text,
      prompt_type: promptTypeFor(shot),
      created_by: 'visual_planning_director',
      origin: shot.media_type === 'MAP_ANIMATION' ? 'camera-intent-handoff' : 'super-focus-builder',
      legacy_aliases: [`block-${String(index + 1).padStart(3, '0')}-prompt-01`],
    });
  }
  return prompts;
}

function generationSupervisorProjection(task, plan, shot) {
  const prompts = plan.prompts.filter((prompt) => shot.prompt_refs.includes(prompt.prompt_id));
  return {
    task_id: `${task.task_id}:${shot.shot_id}`,
    project_id: task.project_id,
    artifact_class: shot.generation_requirements.artifact_class,
    requested_by: 'visual_planning_director',
    brief: {
      purpose: shot.narrative_function,
      shot_ref: shot.shot_id,
      prompt_ref: prompts[0]?.prompt_id || null,
      story_beat_ref: shot.beat_ref.canonical_beat_id,
      aspect_target: shot.generation_requirements.aspect_target || null,
      duration_target_s: shot.generation_requirements.duration_target_s || null,
      quality_constraints: shot.generation_requirements.quality_constraints,
      input_artifacts: shot.generation_requirements.input_artifact_refs,
      candidate_count: shot.generation_requirements.candidate_count_request || null,
    },
    package_context: task.package_run_id || null,
    max_attempts: Math.min(task.retry_budget || 2, 3),
  };
}

function cameraProjection(plan, shot) {
  return shot.camera_intent ? { plan_id: plan.plan_id, shot_ref: shot.shot_id, beat_ref: shot.beat_ref.canonical_beat_id, camera_intent: structuredClone(shot.camera_intent) } : null;
}

module.exports = { PROMPT_MEDIA, promptTypeFor, promptTextFor, buildPromptRecords, generationSupervisorProjection, cameraProjection };
