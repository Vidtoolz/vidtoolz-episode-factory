'use strict';

const visualPlan = require('./visual-plan.js');

// Prompt composition translates canonical shot intent. It does not invent a
// scene, choose generation infrastructure, or weaken the Visual Plan.
const PROMPT_MEDIA = new Set(['GENERATED_STILL', 'GENERATED_VIDEO', 'INFOGRAPHIC', 'MAP_ANIMATION', 'TEXT_GRAPHIC']);
const PRESENTER_AWARE = new Set(['BROLL_OVERLAY', 'PICTURE_IN_PICTURE']);
const FIELD_LIMITS = Object.freeze({ subject: 1000, shot_brief: 4000, narrative_function: 2000, visual_assertion: 2000 });

class PromptCompositionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PromptCompositionError';
    this.code = code;
  }
}

function requiredText(value, field, minimum = 3) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new PromptCompositionError('SHOT_INTENT_INCOMPLETE', `${field} is too underspecified for prompt composition`);
  }
  const text = value.trim();
  if (text.length > FIELD_LIMITS[field]) {
    throw new PromptCompositionError('SHOT_INTENT_TOO_LONG', `${field} exceeds the explicit prompt-composition limit; it was not truncated`);
  }
  return text;
}

function promptTypeFor(shot) {
  if (shot.media_type === 'MAP_ANIMATION') return 'MAP';
  if (shot.media_type === 'INFOGRAPHIC') return 'INFOGRAPHIC';
  if (shot.media_type === 'GENERATED_VIDEO') return 'VIDEO';
  if (shot.media_type === 'TEXT_GRAPHIC') return 'TEXT_GRAPHIC';
  return PRESENTER_AWARE.has(shot.presenter_relation) ? 'PRESENTER_AWARE' : 'FULL_FRAME';
}

function modeSpecification(shot) {
  if (shot.media_type === 'GENERATED_STILL' && shot.generation_mode === 'STILL') {
    return 'Execution mode: STILL_IMAGE. Compose one deliberate still frame; preserve every explicit subject, lighting, and framing requirement.';
  }
  if (shot.media_type === 'GENERATED_VIDEO' && shot.generation_mode === 'DIRECT_VIDEO') {
    return 'Execution mode: DIRECT_VIDEO. Create one continuous generated-video shot; preserve the specified action, movement, pace, and temporal behavior. Do not reduce the intent to a still photograph or introduce unrelated cuts.';
  }
  if (shot.media_type === 'GENERATED_VIDEO' && shot.generation_mode === 'IMAGE_TO_VIDEO') {
    const inputs = shot.generation_requirements?.input_artifact_refs;
    if (!Array.isArray(inputs) || inputs.length !== 1 || !String(inputs[0]).trim()) {
      throw new PromptCompositionError('I2V_INPUT_REQUIRED', 'IMAGE_TO_VIDEO prompt composition requires exactly one source image artifact');
    }
    return `Execution mode: I2V_MOTION. Use exact source image artifact ${inputs[0]}. Preserve its subject and composition; animate only the motion specified by the canonical shot brief.`;
  }
  if (shot.media_type === 'INFOGRAPHIC' && shot.generation_mode === 'NOT_APPLICABLE') {
    return 'Execution mode: INFOGRAPHIC. Produce a structured graphic specification with clear hierarchy; do not substitute photorealistic creator-workspace imagery or rely on generated mission-critical readable text.';
  }
  if (shot.media_type === 'TEXT_GRAPHIC' && shot.generation_mode === 'NOT_APPLICABLE') {
    return 'Execution mode: TEXT_GRAPHIC. Produce a deterministic text-graphic specification with explicit hierarchy and safe placement; do not substitute a photorealistic scene.';
  }
  throw new PromptCompositionError('GENERATION_MODE_UNSUPPORTED', `${shot.media_type}/${shot.generation_mode} has no prompt-composition mode`);
}

function presenterSpecification(shot) {
  if (!PRESENTER_AWARE.has(shot.presenter_relation)) return null;
  return 'Presenter-composite requirement: preserve the canonical subject and framing, reserve clear negative space in the presenter-safe region, keep important subjects and details outside that region, and place no critical generated text beneath the presenter.';
}

function researchSpecification(shot) {
  if (!shot.research_sensitive) return [];
  const assertion = requiredText(shot.visual_assertion, 'visual_assertion');
  const required = [...new Set((shot.research_refs || []).flatMap((ref) => ref.required_constraint_ids || []))];
  const applied = [...new Set((shot.research_refs || []).flatMap((ref) => ref.applied_constraint_ids || []))];
  if (required.some((id) => !applied.includes(id))) {
    throw new PromptCompositionError('RESEARCH_CONSTRAINTS_INCOMPLETE', 'Research-sensitive prompt is missing an applied required constraint');
  }
  const specification = [`Bounded visual assertion: ${assertion}`];
  if (required.length) specification.push(`Required Research constraints (preserve exactly; do not broaden or absolutize the assertion): ${required.join(', ')}.`);
  return specification;
}

function promptTextFor(shot) {
  if (shot.media_type === 'SCREEN_CAPTURE' || shot.media_type === 'PRESENTER_A_ROLL' || shot.media_type === 'ARCHIVAL_EXTERNAL') return null;
  const subject = requiredText(shot.subject, 'subject');
  const brief = requiredText(shot.shot_brief, 'shot_brief', 12);
  const purpose = requiredText(shot.narrative_function, 'narrative_function');
  if (shot.media_type === 'MAP_ANIMATION') {
    const parts = [
      `Camera/Earth Studio handoff only. Canonical subject: ${subject}`,
      `Canonical shot brief: ${brief}`,
      `Story purpose: ${purpose}`,
      'Execution mode: MAP_ANIMATION. Preserve geographic and reveal intent; this is not a generic image/video generation prompt and contains no Camera mechanics.',
    ];
    const presenter = presenterSpecification(shot);
    if (presenter) parts.push(presenter);
    parts.push(...researchSpecification(shot));
    return parts.join('\n');
  }
  const parts = [
    `Canonical subject: ${subject}`,
    `Canonical shot brief: ${brief}`,
    `Story purpose: ${purpose}`,
    modeSpecification(shot),
  ];
  const presenter = presenterSpecification(shot);
  if (presenter) parts.push(presenter);
  parts.push(...researchSpecification(shot));
  const quality = shot.generation_requirements?.quality_constraints || [];
  if (quality.length) parts.push(`Quality constraints: ${quality.join('; ')}.`);
  parts.push('Fidelity rule: do not add unrelated props, people, settings, metaphors, or global style; do not replace or generalize the canonical subject or shot brief.');
  return parts.join('\n');
}

function validatePromptFidelity(shot, promptText) {
  const errors = [];
  if (typeof promptText !== 'string' || !promptText.trim()) return { ok: false, errors: ['PROMPT_TEXT_MISSING'] };
  const requiredComponents = [shot.subject, shot.shot_brief, shot.narrative_function];
  if (shot.research_sensitive) {
    requiredComponents.push(shot.visual_assertion);
    for (const ref of shot.research_refs || []) requiredComponents.push(...(ref.required_constraint_ids || []));
  }
  for (const component of requiredComponents.filter(Boolean)) {
    if (!promptText.includes(String(component).trim())) errors.push(`CANONICAL_COMPONENT_DROPPED:${String(component).trim()}`);
  }
  const expectedMode = {
    STILL: 'STILL_IMAGE',
    DIRECT_VIDEO: 'DIRECT_VIDEO',
    IMAGE_TO_VIDEO: 'I2V_MOTION',
    NOT_APPLICABLE: shot.media_type,
  }[shot.generation_mode];
  if (!expectedMode || !promptText.includes(`Execution mode: ${expectedMode}`)) errors.push('GENERATION_MODE_DROPPED');
  if (PRESENTER_AWARE.has(shot.presenter_relation) && !promptText.includes('Presenter-composite requirement:')) errors.push('PRESENTER_SAFE_COMPOSITION_DROPPED');
  return { ok: errors.length === 0, errors };
}

function buildPromptRecords(shots, options = {}) {
  const prompts = [];
  for (const [index, shot] of shots.entries()) {
    if (!PROMPT_MEDIA.has(shot.media_type)) continue;
    const text = promptTextFor(shot);
    if (!text) continue;
    const fidelity = validatePromptFidelity(shot, text);
    if (!fidelity.ok) throw new PromptCompositionError('PROMPT_INTENT_FIDELITY_FAILED', fidelity.errors.join('; '));
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
      origin: shot.media_type === 'MAP_ANIMATION' ? 'camera-intent-handoff' : 'visual-plan-fidelity-adapter',
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

module.exports = {
  PROMPT_MEDIA,
  PromptCompositionError,
  promptTypeFor,
  promptTextFor,
  validatePromptFidelity,
  buildPromptRecords,
  generationSupervisorProjection,
  cameraProjection,
};
