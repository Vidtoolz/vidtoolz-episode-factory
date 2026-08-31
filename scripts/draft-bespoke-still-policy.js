'use strict';

/*
 * Draft bespoke-still policy authority.
 *
 * This is deliberately an extension of the canonical Visual Plan and the
 * existing Generation Supervisor / Production Assembly path.  It does not
 * define a second visual plan, asset selector, final-asset registry, or review
 * authority.  Final Production never consumes this class as publication media.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const PLAN_SCHEMA = 'vidtoolz.draftBespokeStillPlan.v1';
const ATTEMPT_SCHEMA = 'vidtoolz.draftBespokeStillGenerationAttempt.v1';
const REGISTRY_SCHEMA = 'vidtoolz.draftBespokeStillRegistry.v1';
const METRICS_SCHEMA = 'vidtoolz.draftBespokeStillThroughputMetrics.v1';
const ASSET_CLASS = 'DRAFT_BESPOKE_STILL';
const PRODUCTION_SCOPE = 'DRAFT_DIRECTED_DRAFT_REVIEW';
const MOTION_POLICY = 'NONE';
const CAMERA_MOTION = 'NOT_APPLICABLE';
const DEFAULT_TARGET = 20;
const NORMAL_MIN = 16;
const NORMAL_MAX = 24;
const HARD_MAX = 39;
const MIN_DIMENSION = 256;
const VISUAL_ROLES = Object.freeze(['SCENE', 'CONCEPTUAL', 'METAPHOR', 'INFOGRAPHIC', 'DIAGRAM', 'TEXTUAL_GRAPHIC', 'OTHER']);
const ALLOWED_MEDIA_TYPES = Object.freeze(['GENERATED_STILL', 'INFOGRAPHIC', 'TEXT_GRAPHIC']);
const SHA_RE = /^[a-f0-9]{64}$/;
const SLOT_RE = /^draft-still-[0-9]{3}$/;

const POLICY_FIELDS = Object.freeze([
  'schema', 'production_scope', 'asset_class', 'target_visual_slots', 'target_tolerance',
  'planned_visual_slots', 'count_rationale', 'normal_generation_attempts',
  'technical_retry_limit', 'motion_policy', 'i2v_allowed', 'video_generation_allowed',
  'kling_allowed', 'publication_authority', 'final_asset_authority',
  'approved_script_at', 'visual_plan_wall_clock_ms', 'slots',
]);
const SLOT_FIELDS = Object.freeze([
  'slot_id', 'shot_id', 'prompt_id', 'prompt_sha256', 'script_binding', 'purpose',
  'visual_concept', 'visual_role', 'repetition_rationale', 'expected_timeline',
  'script_specific', 'temporal_media', 'motion_policy', 'camera_motion',
  'normal_generation_attempts', 'publication_authority', 'final_asset_authority',
]);
const SCRIPT_BINDING_FIELDS = Object.freeze([
  'story_version_id', 'story_content_hash', 'canonical_segment_id', 'section_id',
  'canonical_beat_ids', 'source_text', 'source_text_sha256',
]);
const TIMELINE_FIELDS = Object.freeze(['duration_ms', 'coverage']);

class DraftBespokeStillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftBespokeStillError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftBespokeStillError(code, message); }
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function exact(value, allowed, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(code, `${label}.${key} is not allowed`);
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }

function targetForDuration(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return { target: DEFAULT_TARGET, min: NORMAL_MIN, max: NORMAL_MAX };
  if (seconds >= 180 && seconds <= 240) return { target: DEFAULT_TARGET, min: NORMAL_MIN, max: NORMAL_MAX };
  if (seconds < 180) {
    const target = Math.max(6, Math.min(18, Math.round(seconds / 10)));
    return { target, min: Math.max(4, target - 3), max: target + 3 };
  }
  const target = Math.min(24, Math.round(seconds / 11));
  return { target, min: Math.max(16, target - 4), max: Math.min(28, target + 4) };
}

function validateSlot(slot, plan, index, promptById, shotById) {
  const label = `draft_bespoke_still_policy.slots[${index}]`;
  exact(slot, SLOT_FIELDS, 'DRAFT_STILL_SLOT_FIELD_FORBIDDEN', label);
  if (!SLOT_RE.test(slot.slot_id || '')) fail('DRAFT_STILL_SLOT_ID_INVALID', label);
  const shot = shotById.get(slot.shot_id);
  if (!shot) fail('DRAFT_STILL_SHOT_BINDING_INVALID', `${slot.slot_id} does not bind a canonical shot`);
  const prompt = promptById.get(slot.prompt_id);
  if (!prompt || prompt.shot_id !== slot.shot_id || !shot.prompt_refs?.includes(slot.prompt_id)) {
    fail('DRAFT_STILL_PROMPT_BINDING_INVALID', `${slot.slot_id} does not bind one canonical prompt`);
  }
  if (slot.prompt_sha256 !== digest(prompt.prompt_text)) fail('DRAFT_STILL_PROMPT_HASH_MISMATCH', slot.slot_id);
  exact(slot.script_binding, SCRIPT_BINDING_FIELDS, 'DRAFT_STILL_SCRIPT_BINDING_INVALID', `${label}.script_binding`);
  const binding = slot.script_binding;
  if (binding.story_version_id !== plan.story.version_id || binding.story_content_hash !== plan.story.content_hash
      || binding.section_id !== shot.section_ref.section_id || binding.canonical_segment_id !== binding.section_id
      || !SHA_RE.test(binding.story_content_hash || '') || !nonempty(binding.source_text)
      || binding.source_text_sha256 !== digest(binding.source_text)) {
    fail('DRAFT_STILL_SCRIPT_BINDING_INVALID', `${slot.slot_id} is not bound to exact current Story text`);
  }
  if (!Array.isArray(binding.canonical_beat_ids) || binding.canonical_beat_ids.length < 1
      || !binding.canonical_beat_ids.includes(shot.beat_ref.canonical_beat_id)
      || new Set(binding.canonical_beat_ids).size !== binding.canonical_beat_ids.length) {
    fail('DRAFT_STILL_SCRIPT_BINDING_INVALID', `${slot.slot_id} beat binding is invalid`);
  }
  if (!nonempty(slot.purpose) || !nonempty(slot.visual_concept)) fail('DRAFT_STILL_CONCEPT_REQUIRED', slot.slot_id);
  if (!VISUAL_ROLES.includes(slot.visual_role)) fail('DRAFT_STILL_VISUAL_ROLE_INVALID', slot.slot_id);
  if (slot.repetition_rationale !== null && !nonempty(slot.repetition_rationale)) fail('DRAFT_STILL_REPETITION_RATIONALE_INVALID', slot.slot_id);
  exact(slot.expected_timeline, TIMELINE_FIELDS, 'DRAFT_STILL_TIMELINE_INVALID', `${label}.expected_timeline`);
  if (!Number.isInteger(slot.expected_timeline.duration_ms) || slot.expected_timeline.duration_ms <= 0 || !nonempty(slot.expected_timeline.coverage)) {
    fail('DRAFT_STILL_TIMELINE_INVALID', slot.slot_id);
  }
  if (slot.script_specific !== true) fail('DRAFT_STILL_GENERIC_VISUAL_FORBIDDEN', slot.slot_id);
  if (slot.temporal_media !== false || slot.motion_policy !== MOTION_POLICY || slot.camera_motion !== CAMERA_MOTION
      || slot.normal_generation_attempts !== 1 || slot.publication_authority !== false || slot.final_asset_authority !== false) {
    fail('DRAFT_STILL_SEMANTICS_INVALID', slot.slot_id);
  }
  if (!ALLOWED_MEDIA_TYPES.includes(shot.media_type)) fail('DRAFT_STILL_MEDIA_TYPE_FORBIDDEN', `${slot.slot_id}:${shot.media_type}`);
  if ((shot.media_type === 'GENERATED_STILL' && shot.generation_mode !== 'STILL')
      || (shot.media_type !== 'GENERATED_STILL' && shot.generation_mode !== 'NOT_APPLICABLE')) {
    fail('DRAFT_STILL_GENERATION_MODE_FORBIDDEN', `${slot.slot_id}:${shot.generation_mode}`);
  }
  const requirements = shot.generation_requirements || {};
  if (requirements.artifact_class !== ASSET_CLASS || requirements.candidate_count_request !== 1
      || (requirements.input_artifact_refs || []).length !== 0) {
    fail('DRAFT_STILL_GENERATION_REQUIREMENTS_INVALID', slot.slot_id);
  }
  if (shot.camera_intent !== null) fail('DRAFT_STILL_TEMPORAL_CAMERA_FORBIDDEN', slot.slot_id);
}

function validatePlanPolicy(plan) {
  const policy = plan?.draft_bespoke_still_policy;
  if (policy === undefined) return { applicable: false, ok: true, slots: [] };
  try {
    exact(policy, POLICY_FIELDS, 'DRAFT_STILL_POLICY_FIELD_FORBIDDEN', 'draft_bespoke_still_policy');
    if (policy.schema !== PLAN_SCHEMA || policy.production_scope !== PRODUCTION_SCOPE || policy.asset_class !== ASSET_CLASS) fail('DRAFT_STILL_POLICY_IDENTITY_INVALID', 'policy identity');
    exact(policy.target_tolerance, ['min', 'max'], 'DRAFT_STILL_COUNT_POLICY_INVALID', 'target_tolerance');
    if (![policy.target_visual_slots, policy.target_tolerance.min, policy.target_tolerance.max, policy.planned_visual_slots].every(Number.isInteger)
        || policy.target_visual_slots < 1 || policy.target_tolerance.min < 1 || policy.target_tolerance.max < policy.target_tolerance.min) {
      fail('DRAFT_STILL_COUNT_POLICY_INVALID', 'slot counts must be positive integers');
    }
    if (!Array.isArray(policy.slots) || policy.slots.length !== policy.planned_visual_slots) fail('DRAFT_STILL_COUNT_MISMATCH', 'planned count differs from slots');
    if (policy.planned_visual_slots > HARD_MAX) fail('DRAFT_STILL_EXCESSIVE_SLOT_COUNT', `${policy.planned_visual_slots} exceeds the hard Draft ceiling`);
    const inTolerance = policy.planned_visual_slots >= policy.target_tolerance.min && policy.planned_visual_slots <= policy.target_tolerance.max;
    if (!inTolerance && (!nonempty(policy.count_rationale) || policy.count_rationale.trim().length < 20)) {
      fail('DRAFT_STILL_COUNT_RATIONALE_REQUIRED', 'out-of-band slot count requires explicit bounded rationale');
    }
    if (inTolerance && policy.count_rationale !== null && !nonempty(policy.count_rationale)) fail('DRAFT_STILL_COUNT_RATIONALE_INVALID', 'count rationale must be null or text');
    if (policy.normal_generation_attempts !== 1 || policy.technical_retry_limit !== 1 || policy.motion_policy !== MOTION_POLICY
        || policy.i2v_allowed !== false || policy.video_generation_allowed !== false || policy.kling_allowed !== false
        || policy.publication_authority !== false || policy.final_asset_authority !== false) {
      fail('DRAFT_STILL_POLICY_SEMANTICS_INVALID', 'one-shot/static/non-final semantics are mandatory');
    }
    if (!Number.isInteger(policy.visual_plan_wall_clock_ms) || policy.visual_plan_wall_clock_ms < 0) fail('DRAFT_STILL_PLAN_TIMING_INVALID', 'visual plan timing');
    if (!nonempty(policy.approved_script_at) || !Number.isFinite(Date.parse(policy.approved_script_at))) fail('DRAFT_STILL_SCRIPT_APPROVAL_TIME_INVALID', 'approved_script_at');
    const promptById = new Map((plan.prompts || []).map((item) => [item.prompt_id, item]));
    const shotById = new Map((plan.shots || []).map((item) => [item.shot_id, item]));
    const slotIds = new Set(); const shotIds = new Set(); const promptIds = new Set(); const concepts = new Map();
    policy.slots.forEach((slot, index) => {
      validateSlot(slot, plan, index, promptById, shotById);
      if (slotIds.has(slot.slot_id)) fail('DRAFT_STILL_SLOT_ID_DUPLICATE', slot.slot_id); slotIds.add(slot.slot_id);
      if (shotIds.has(slot.shot_id)) fail('DRAFT_STILL_SHOT_REUSED', slot.shot_id); shotIds.add(slot.shot_id);
      if (promptIds.has(slot.prompt_id)) fail('DRAFT_STILL_PROMPT_REUSED', slot.prompt_id); promptIds.add(slot.prompt_id);
      const concept = slot.visual_concept.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
      const prior = concepts.get(concept);
      if (prior && (!nonempty(prior.repetition_rationale) || !nonempty(slot.repetition_rationale))) fail('DRAFT_STILL_REPETITIVE_CONCEPT_UNJUSTIFIED', `${prior.slot_id}/${slot.slot_id}`);
      concepts.set(concept, slot);
    });
    const represented = (plan.shots || []).filter((shot) => ALLOWED_MEDIA_TYPES.includes(shot.media_type));
    if (represented.length !== policy.slots.length || represented.some((shot) => !shotIds.has(shot.shot_id))) fail('DRAFT_STILL_SLOT_COVERAGE_INCOMPLETE', 'every Draft visual shot requires exactly one slot');
    return { applicable: true, ok: true, slots: policy.slots };
  } catch (error) {
    if (!(error instanceof DraftBespokeStillError)) throw error;
    return { applicable: true, ok: false, code: error.code, detail: error.message, slots: policy?.slots || [] };
  }
}

function buildPlanPolicy(task, plan, options = {}) {
  const durationSeconds = Number(task.output_target?.duration_seconds)
    || (Number(task.output_target?.max_duration_minutes) > 0 ? Number(task.output_target.max_duration_minutes) * 60 : 210);
  const target = targetForDuration(durationSeconds);
  const sectionById = new Map((task.story.sections || []).map((section) => [section.section_id, section]));
  const promptByShot = new Map((plan.prompts || []).map((prompt) => [prompt.shot_id, prompt]));
  const semanticShots = (options.semantic?.beats || []).flatMap((beat) => (beat.shots || []).map((shot) => ({ beatId: beat.canonical_beat_id, proposal: shot })));
  const proposalByIndex = semanticShots;
  const slots = plan.shots.map((shot, index) => {
    const prompt = promptByShot.get(shot.shot_id);
    const section = sectionById.get(shot.section_ref.section_id);
    const proposal = proposalByIndex[index]?.proposal || {};
    const sourceText = String(section?.dialogue || '').trim();
    return {
      slot_id: `draft-still-${String(index + 1).padStart(3, '0')}`,
      shot_id: shot.shot_id,
      prompt_id: prompt.prompt_id,
      prompt_sha256: digest(prompt.prompt_text),
      script_binding: {
        story_version_id: plan.story.version_id,
        story_content_hash: plan.story.content_hash,
        canonical_segment_id: shot.section_ref.section_id,
        section_id: shot.section_ref.section_id,
        canonical_beat_ids: [shot.beat_ref.canonical_beat_id],
        source_text: sourceText,
        source_text_sha256: digest(sourceText),
      },
      purpose: shot.narrative_function,
      visual_concept: shot.shot_brief,
      visual_role: proposal.visual_role || (shot.media_type === 'INFOGRAPHIC' ? 'INFOGRAPHIC' : shot.media_type === 'TEXT_GRAPHIC' ? 'TEXTUAL_GRAPHIC' : 'SCENE'),
      repetition_rationale: proposal.repetition_rationale || null,
      expected_timeline: {
        duration_ms: Math.max(1, Math.round((shot.generation_requirements.duration_target_s || durationSeconds / Math.max(1, plan.shots.length)) * 1000)),
        coverage: shot.edit_placement,
      },
      script_specific: true,
      temporal_media: false,
      motion_policy: MOTION_POLICY,
      camera_motion: CAMERA_MOTION,
      normal_generation_attempts: 1,
      publication_authority: false,
      final_asset_authority: false,
    };
  });
  const countRationale = options.semantic?.slot_count_rationale ?? null;
  return {
    schema: PLAN_SCHEMA,
    production_scope: PRODUCTION_SCOPE,
    asset_class: ASSET_CLASS,
    target_visual_slots: target.target,
    target_tolerance: { min: target.min, max: target.max },
    planned_visual_slots: slots.length,
    count_rationale: countRationale,
    normal_generation_attempts: 1,
    technical_retry_limit: 1,
    motion_policy: MOTION_POLICY,
    i2v_allowed: false,
    video_generation_allowed: false,
    kling_allowed: false,
    publication_authority: false,
    final_asset_authority: false,
    approved_script_at: task.story.approval?.approved_at,
    visual_plan_wall_clock_ms: Math.max(0, Math.round(options.visualPlanWallClockMs || 0)),
    slots,
  };
}

function generationTaskForSlot(task, plan, slot) {
  const prompt = (plan.prompts || []).find((item) => item.prompt_id === slot.prompt_id);
  return {
    task_id: `${task.task_id}:${slot.slot_id}`,
    action: 'generate_draft_bespoke_still',
    assignment: { action: 'generate_draft_bespoke_still' },
    project_id: task.project_id,
    package_run_id: task.package_run_id || null,
    run_dir: task.run_dir || null,
    artifact_class: ASSET_CLASS,
    requested_by: 'visual_planning_director',
    visual_plan: { plan_id: plan.plan_id, plan_digest_sha256: plan.plan_digest_sha256, story: plan.story },
    policy: {
      planned_visual_slots: plan.draft_bespoke_still_policy.planned_visual_slots,
      approved_script_at: plan.draft_bespoke_still_policy.approved_script_at,
      visual_plan_wall_clock_ms: plan.draft_bespoke_still_policy.visual_plan_wall_clock_ms,
    },
    slot: structuredClone(slot),
    prompt: { prompt_id: prompt.prompt_id, prompt_sha256: digest(prompt.prompt_text), prompt_text: prompt.prompt_text },
    normal_generation_attempts: 1,
    technical_retry_limit: 1,
  };
}

function inspectImage(file, options = {}) {
  if (typeof options.inspectImage === 'function') return options.inspectImage(file);
  let probe;
  try {
    probe = JSON.parse(childProcess.execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file], { encoding: 'utf8', timeout: 30000 }));
  } catch (_) { return { ok: false, code: 'DRAFT_STILL_IMAGE_UNREADABLE' }; }
  const stream = probe.streams?.[0];
  if (!stream || !Number.isInteger(stream.width) || !Number.isInteger(stream.height)) return { ok: false, code: 'DRAFT_STILL_IMAGE_UNREADABLE' };
  const decoded = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-'], { timeout: 30000 });
  if (decoded.status !== 0) return { ok: false, code: 'DRAFT_STILL_IMAGE_CORRUPT' };
  if (stream.width < MIN_DIMENSION || stream.height < MIN_DIMENSION) return { ok: false, code: 'DRAFT_STILL_DIMENSIONS_UNUSABLE', width: stream.width, height: stream.height };
  return { ok: true, width: stream.width, height: stream.height, codec: stream.codec_name };
}

function writeExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o644);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { fs.closeSync(fd); }
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }

function evidencePaths(runDir) {
  const root = path.join(path.resolve(runDir), 'media', 'draft-bespoke-stills');
  return { root, attempts: path.join(root, 'attempts'), registry: path.join(root, 'registry.json'), metrics: path.join(root, 'throughput-metrics.json') };
}

function validateGenerationTask(task) {
  const allowed = ['task_id', 'action', 'assignment', 'project_id', 'package_run_id', 'run_dir', 'artifact_class', 'requested_by', 'visual_plan', 'policy', 'slot', 'prompt', 'normal_generation_attempts', 'technical_retry_limit'];
  exact(task, allowed, 'DRAFT_STILL_TASK_FIELD_FORBIDDEN', 'generation task');
  if (task.action !== 'generate_draft_bespoke_still' || task.assignment?.action !== task.action || task.artifact_class !== ASSET_CLASS
      || !nonempty(task.project_id) || !nonempty(task.package_run_id)
      || task.normal_generation_attempts !== 1 || task.technical_retry_limit !== 1) fail('DRAFT_STILL_GENERATION_TASK_INVALID', task.task_id || 'task');
  exact(task.visual_plan, ['plan_id', 'plan_digest_sha256', 'story'], 'DRAFT_STILL_GENERATION_TASK_INVALID', 'visual_plan');
  exact(task.policy, ['planned_visual_slots', 'approved_script_at', 'visual_plan_wall_clock_ms'], 'DRAFT_STILL_GENERATION_TASK_INVALID', 'policy');
  exact(task.prompt, ['prompt_id', 'prompt_sha256', 'prompt_text'], 'DRAFT_STILL_GENERATION_TASK_INVALID', 'prompt');
  if (!nonempty(task.prompt.prompt_text) || task.prompt.prompt_sha256 !== digest(task.prompt.prompt_text)
      || task.slot?.prompt_id !== task.prompt.prompt_id || task.slot?.prompt_sha256 !== task.prompt.prompt_sha256
      || task.slot?.script_binding?.story_content_hash !== task.visual_plan.story?.content_hash
      || task.slot?.script_binding?.story_version_id !== task.visual_plan.story?.version_id) fail('DRAFT_STILL_GENERATION_TASK_INVALID', 'prompt/Story binding');
  if (!Number.isInteger(task.policy.planned_visual_slots) || task.policy.planned_visual_slots < 1
      || !nonempty(task.policy.approved_script_at) || !Number.isFinite(Date.parse(task.policy.approved_script_at))
      || !Number.isInteger(task.policy.visual_plan_wall_clock_ms) || task.policy.visual_plan_wall_clock_ms < 0) fail('DRAFT_STILL_GENERATION_TASK_INVALID', 'policy timing/count');
  if (task.slot?.motion_policy !== MOTION_POLICY || task.slot?.camera_motion !== CAMERA_MOTION
      || task.slot?.publication_authority !== false || task.slot?.final_asset_authority !== false) fail('DRAFT_STILL_GENERATION_TASK_INVALID', 'slot authority');
  return true;
}

async function defaultGenerate(context) {
  const packageEngine = require('../package-engine-server.js');
  const media = require('../super-focus-media.js');
  fs.mkdirSync(context.attempt_dir, { recursive: true });
  const promptPayload = media.imagePromptsPayload([{ index: 1, text: context.prompt.prompt_text }]);
  atomicJson(path.join(context.attempt_dir, media.IMAGE_PROMPTS_FILENAME), promptPayload);
  const job = await packageEngine.startSuperFocusImageJob(context.attempt_dir, {
    projectId: `${context.run_id}-${context.slot.slot_id}`.slice(0, 120), limit: 1, skipExisting: false,
  });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const current = packageEngine.currentFluxJobStatus();
    if (current.job_id === job.job_id && current.active === false) {
      if (current.exit_state !== 'completed') fail('DRAFT_STILL_GENERATOR_FAILED', `FLUX ${current.exit_state}`);
      return { generator_id: 'vidnux-comfyui-flux', outputs: [path.join(context.attempt_dir, 'images', 'flux-local', 'flux-001.png')] };
    }
  }
  fail('DRAFT_STILL_GENERATOR_TIMEOUT', context.slot.slot_id);
}

function registryValue(runId, projectId, existing = null) {
  return existing || { schema: REGISTRY_SCHEMA, run_id: runId, project_id: projectId, asset_class: ASSET_CLASS, publication_authority: false, final_asset_authority: false, assets: [], attempts: [] };
}

function metricsValue(policy, registry, timestamps = {}) {
  const attempts = registry.attempts || [];
  const successes = attempts.filter((item) => item.status === 'SUCCEEDED');
  const start = attempts.map((item) => Date.parse(item.generation_started_at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const end = attempts.map((item) => Date.parse(item.generation_ended_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return {
    schema: METRICS_SCHEMA,
    run_id: registry.run_id,
    planned_still_count: policy.planned_visual_slots,
    generated_still_count: registry.assets.length,
    first_attempt_success_count: successes.filter((item) => item.attempt_number === 1).length,
    technical_failure_count: attempts.filter((item) => item.status === 'TECHNICAL_FAILURE').length,
    retry_count: attempts.filter((item) => item.attempt_number === 2).length,
    creative_weakness_count: successes.filter((item) => item.creative_assessment === 'CREATIVE_WEAKNESS').length,
    per_image_generation_wall_clock_ms: attempts.map((item) => ({ slot_id: item.slot_id, attempt_number: item.attempt_number, status: item.status, wall_clock_ms: item.generation_wall_clock_ms })),
    total_image_generation_wall_clock_ms: attempts.reduce((sum, item) => sum + item.generation_wall_clock_ms, 0),
    approved_script_at: policy.approved_script_at,
    visual_plan_wall_clock_ms: policy.visual_plan_wall_clock_ms,
    draft_visual_production_wall_clock_ms: Number.isFinite(start) && Number.isFinite(end) ? policy.visual_plan_wall_clock_ms + Math.max(0, end - start) : policy.visual_plan_wall_clock_ms,
    editor_render_wall_clock_ms: timestamps.editor_render_wall_clock_ms ?? null,
    draft_review_ready_at: timestamps.draft_review_ready_at ?? null,
    approved_script_to_draft_review_ready_wall_clock_ms: timestamps.approved_script_to_draft_review_ready_wall_clock_ms ?? null,
  };
}

function recordReviewReadyTiming(runDirInput, timings) {
  const paths = evidencePaths(runDirInput);
  const metrics = readJson(paths.metrics, null);
  if (!metrics) return { applicable: false, metrics: null };
  if (metrics.schema !== METRICS_SCHEMA || !nonempty(metrics.approved_script_at)) fail('DRAFT_STILL_METRICS_IDENTITY_INVALID', paths.metrics);
  const readyAt = timings?.draft_review_ready_at || new Date().toISOString();
  const readyMs = Date.parse(readyAt); const approvedMs = Date.parse(metrics.approved_script_at);
  if (!Number.isFinite(readyMs) || !Number.isFinite(approvedMs) || readyMs < approvedMs
      || !Number.isInteger(timings?.editor_render_wall_clock_ms) || timings.editor_render_wall_clock_ms < 0) fail('DRAFT_STILL_PIPELINE_TIMING_INVALID', paths.metrics);
  metrics.editor_render_wall_clock_ms = timings.editor_render_wall_clock_ms;
  metrics.draft_review_ready_at = readyAt;
  metrics.approved_script_to_draft_review_ready_wall_clock_ms = readyMs - approvedMs;
  atomicJson(paths.metrics, metrics);
  return { applicable: true, metrics };
}

async function executeSlot(task, options = {}) {
  validateGenerationTask(task);
  const runDir = task.run_dir ? path.resolve(task.run_dir) : null;
  if (!runDir || !fs.existsSync(runDir) || path.basename(runDir) !== task.package_run_id) fail('DRAFT_STILL_RUN_IDENTITY_INVALID', task.package_run_id || 'missing run');
  const paths = evidencePaths(runDir);
  const registry = registryValue(task.package_run_id, task.project_id, readJson(paths.registry, null));
  if (registry.schema !== REGISTRY_SCHEMA || registry.run_id !== task.package_run_id || registry.project_id !== task.project_id
      || registry.asset_class !== ASSET_CLASS || registry.publication_authority !== false || registry.final_asset_authority !== false
      || !Array.isArray(registry.assets) || !Array.isArray(registry.attempts)) fail('DRAFT_STILL_REGISTRY_IDENTITY_INVALID', task.package_run_id);
  const existingAsset = registry.assets.find((item) => item.slot_id === task.slot.slot_id);
  if (existingAsset) return { state: 'COMPLETE', asset: existingAsset, registry, metrics: readJson(paths.metrics, null), attempts_created: 0 };
  const priorAttempts = registry.attempts.filter((item) => item.slot_id === task.slot.slot_id);
  if (priorAttempts.length > 0) fail('DRAFT_STILL_ATTEMPT_STATE_INVALID', `${task.slot.slot_id} has incomplete prior invocation evidence`);
  const generate = options.generate || defaultGenerate;
  let last = null;
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    if (attemptNumber === 2 && (last?.status !== 'TECHNICAL_FAILURE' || !Array.isArray(last.technical_failures) || last.technical_failures.length === 0)) {
      fail('DRAFT_STILL_TECHNICAL_RETRY_UNAUTHORIZED', task.slot.slot_id);
    }
    const attemptId = `${task.slot.slot_id}-attempt-${attemptNumber}`;
    const attemptDir = path.join(paths.attempts, attemptId);
    const startedAt = new Date(); const monotonicStart = process.hrtime.bigint();
    let result = null; let policyFailure = null; let technicalFailures = [];
    try {
      result = await generate({ run_id: task.package_run_id, run_dir: runDir, attempt_id: attemptId, attempt_number: attemptNumber, attempt_dir: attemptDir, slot: task.slot, prompt: task.prompt });
      if (!result || !Array.isArray(result.outputs)) technicalFailures.push('DRAFT_STILL_OUTPUT_MISSING');
      else if (result.outputs.length !== 1) policyFailure = 'DRAFT_STILL_MULTIPLE_CANDIDATES_FORBIDDEN';
      else if (/kling|i2v|image.to.video|video/i.test(String(result.generator_id || ''))) policyFailure = 'DRAFT_STILL_VIDEO_DISPATCH_FORBIDDEN';
      else {
        const output = path.resolve(result.outputs[0]);
        const attemptRoot = path.resolve(attemptDir);
        if (!(output === attemptRoot || output.startsWith(`${attemptRoot}${path.sep}`))) policyFailure = 'DRAFT_STILL_OUTPUT_PATH_INVALID';
        else if (!fs.existsSync(output)) {
          result.validated = { path: output, sha256: null, width: null, height: null, codec: null };
          technicalFailures.push('DRAFT_STILL_OUTPUT_MISSING');
        }
        else {
          const inspected = inspectImage(output, options);
          result.validated = { path: output, sha256: sha256File(output), width: inspected.width ?? null, height: inspected.height ?? null, codec: inspected.codec || null };
          if (!inspected.ok) technicalFailures.push(inspected.code || 'DRAFT_STILL_IMAGE_INVALID');
        }
      }
    } catch (error) {
      if (error instanceof DraftBespokeStillError && /FORBIDDEN|INVALID/.test(error.code)) policyFailure = error.code;
      else technicalFailures.push(error.code || 'DRAFT_STILL_GENERATOR_FAILURE');
    }
    const endedAt = new Date();
    const elapsedMs = Number((process.hrtime.bigint() - monotonicStart) / 1000000n);
    let status = policyFailure ? 'POLICY_VIOLATION' : technicalFailures.length ? 'TECHNICAL_FAILURE' : 'SUCCEEDED';
    if (status === 'SUCCEEDED' && registry.assets.some((item) => item.sha256 === result.validated.sha256 && item.slot_id !== task.slot.slot_id)) {
      status = 'TECHNICAL_FAILURE';
      technicalFailures = ['DRAFT_STILL_DUPLICATE_OUTPUT_BYTES'];
    }
    const attempt = {
      schema: ATTEMPT_SCHEMA,
      attempt_id: attemptId,
      run_id: task.package_run_id,
      project_id: task.project_id,
      slot_id: task.slot.slot_id,
      script_binding: task.slot.script_binding,
      prompt_id: task.prompt.prompt_id,
      prompt_sha256: task.prompt.prompt_sha256,
      generator_id: result?.generator_id || null,
      attempt_number: attemptNumber,
      attempt_kind: attemptNumber === 1 ? 'NORMAL' : 'TECHNICAL_REPLACEMENT',
      replaces_attempt_id: attemptNumber === 1 ? null : last.attempt_id,
      status,
      technical_failures: technicalFailures,
      policy_failure: policyFailure,
      generation_started_at: startedAt.toISOString(),
      generation_ended_at: endedAt.toISOString(),
      generation_wall_clock_ms: elapsedMs,
      output: result?.validated || null,
      creative_assessment: status === 'SUCCEEDED' && result?.creative_assessment === 'CREATIVE_WEAKNESS' ? 'CREATIVE_WEAKNESS' : 'NOT_ASSESSED',
      asset_class: ASSET_CLASS,
      publication_authority: false,
      final_asset_authority: false,
    };
    writeExclusive(path.join(attemptDir, 'attempt.json'), attempt);
    registry.attempts.push(attempt);
    last = attempt;
    if (status === 'POLICY_VIOLATION') {
      atomicJson(paths.registry, registry);
      fail(policyFailure, task.slot.slot_id);
    }
    if (status === 'SUCCEEDED') {
      const asset = {
        asset_id: task.slot.slot_id,
        slot_id: task.slot.slot_id,
        project_id: task.project_id,
        path: attempt.output.path,
        sha256: attempt.output.sha256,
        width: attempt.output.width,
        height: attempt.output.height,
        media_kind: 'IMAGE',
        asset_class: ASSET_CLASS,
        script_specific: true,
        temporal_media: false,
        motion_policy: MOTION_POLICY,
        source_attempt_id: attempt.attempt_id,
        visual_plan: task.visual_plan,
        script_binding: task.slot.script_binding,
        prompt_id: task.prompt.prompt_id,
        prompt_sha256: task.prompt.prompt_sha256,
        publication_authority: false,
        final_asset_authority: false,
      };
      registry.assets.push(asset);
      atomicJson(paths.registry, registry);
      const policy = options.policy || task.policy;
      const metrics = metricsValue(policy, registry, options.pipelineTimings || {});
      atomicJson(paths.metrics, metrics);
      return { state: 'COMPLETE', asset, attempt, registry, metrics, attempts_created: attemptNumber };
    }
  }
  atomicJson(paths.registry, registry);
  const policy = options.policy || task.policy;
  const metrics = metricsValue(policy, registry, options.pipelineTimings || {});
  atomicJson(paths.metrics, metrics);
  return { state: 'OUTPUT_INVALID', attempt: last, registry, metrics, attempts_created: 2 };
}

function editorBeatFor(slot, assetId, placement) {
  if (!slot || slot.motion_policy !== MOTION_POLICY || slot.camera_motion !== CAMERA_MOTION) fail('DRAFT_STILL_EDITOR_SLOT_INVALID', slot?.slot_id || 'slot');
  if (!placement || !Number.isInteger(placement.start_ms) || !Number.isInteger(placement.end_ms) || placement.end_ms <= placement.start_ms || !nonempty(placement.beat_id) || !nonempty(placement.section_id)) {
    fail('DRAFT_STILL_EDITOR_PLACEMENT_INVALID', slot.slot_id);
  }
  return {
    beat_id: placement.beat_id,
    section_id: placement.section_id,
    start_ms: placement.start_ms,
    end_ms: placement.end_ms,
    primary_owner: 'GENERATED_VISUAL',
    layers: [{
      layer_id: `${placement.beat_id}-still`, type: 'FULL_CANVAS_VISUAL', primary: true, z: 0,
      asset_id: assetId, fit: placement.fit || 'COVER', duration_policy: 'STILL', asset_in_ms: 0,
      geometry: { x: 0, y: 0, width: placement.width || 1080, height: placement.height || 1920, anchor: 'TOP_LEFT' },
    }],
    transition_in: 'HARD_CUT',
    transition_out: 'HARD_CUT',
  };
}

function productionAssetRecord(asset, intendedBeatIds) {
  if (!asset || asset.asset_class !== ASSET_CLASS || asset.publication_authority !== false || asset.final_asset_authority !== false
      || !Array.isArray(intendedBeatIds) || intendedBeatIds.length < 1 || new Set(intendedBeatIds).size !== intendedBeatIds.length) {
    fail('DRAFT_STILL_ASSET_PROJECTION_INVALID', asset?.slot_id || 'asset');
  }
  return {
    asset_id: asset.asset_id,
    role: ASSET_CLASS,
    path: asset.path,
    sha256: asset.sha256,
    media_kind: 'IMAGE',
    width: asset.width,
    height: asset.height,
    provenance: {
      asset_class: ASSET_CLASS,
      script_specific: true,
      temporal_media: false,
      motion_policy: MOTION_POLICY,
      normal_generation_attempts: 1,
      source_attempt_id: asset.source_attempt_id,
      script_binding: asset.script_binding,
      prompt_id: asset.prompt_id,
      prompt_sha256: asset.prompt_sha256,
      publication_authority: false,
      final_asset_authority: false,
    },
    status: 'ACCEPTED',
    policy: 'REQUIRED',
    intended_beat_ids: intendedBeatIds.slice(),
  };
}

function staticGeometryEvidence(beat) {
  const layer = beat?.layers?.find((item) => item.type === 'FULL_CANVAS_VISUAL');
  if (!layer || layer.motion !== undefined || layer.reveal !== undefined || beat.reveal_contract !== undefined
      || layer.geometry?.ramp !== undefined || layer.geometry?.keyframes !== undefined
      || layer.geometry?.animation !== undefined) fail('DRAFT_STILL_STATIC_EVIDENCE_INVALID', beat?.beat_id || 'beat');
  const geometry = { fit: layer.fit, x: layer.geometry?.x ?? 0, y: layer.geometry?.y ?? 0, width: layer.geometry?.width ?? null, height: layer.geometry?.height ?? null, crop: 'CONSTANT_FIT' };
  const sample = { first: geometry, middle: geometry, last: geometry };
  const hashes = Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, digest(value)]));
  return { beat_id: beat.beat_id, samples: sample, geometry_digests: hashes, stable: new Set(Object.values(hashes)).size === 1 };
}

module.exports = {
  PLAN_SCHEMA, ATTEMPT_SCHEMA, REGISTRY_SCHEMA, METRICS_SCHEMA, ASSET_CLASS,
  PRODUCTION_SCOPE, MOTION_POLICY, CAMERA_MOTION, DEFAULT_TARGET, NORMAL_MIN,
  NORMAL_MAX, HARD_MAX, MIN_DIMENSION, VISUAL_ROLES, ALLOWED_MEDIA_TYPES,
  DraftBespokeStillError, canonicalize, digest, sha256File, targetForDuration,
  validatePlanPolicy, buildPlanPolicy, generationTaskForSlot, validateGenerationTask,
  inspectImage, evidencePaths, metricsValue, executeSlot, defaultGenerate,
  recordReviewReadyTiming, productionAssetRecord, editorBeatFor, staticGeometryEvidence,
};
