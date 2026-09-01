#!/usr/bin/env node
'use strict';

/*
 * Final Production Package — the operational answer to one question:
 *
 *   "What exactly must be manually produced to turn the approved Draft into
 *    the publishable final video?"
 *
 * It derives ONLY from a current vidtoolz.finalProductionLock.v1 plus the
 * canonical upstream authorities the lock binds. It never promotes a
 * provisional Draft asset into Final authority: Draft stills are concept
 * prototypes, Draft music is provisional, and Draft narration — human-recorded
 * on this production as an exception — is never the final performance.
 *
 * It also refuses to automate away the decisions that are product doctrine.
 * Mikko selects final images, chooses which become video, selects Kling clips,
 * records and selects the performance take, edits in Resolve, approves music,
 * QC and publication. The package makes those steps deterministic and
 * ordered; it does not take them.
 *
 * Components (each lock-bound, each written immutably):
 *   final-script.json                vidtoolz.finalScriptPackage.v1
 *   final-performance-package.json   vidtoolz.finalPerformancePackage.v1
 *   final-visual-package.json        vidtoolz.finalVisualPackage.v1
 *   final-asset-tracker.json         vidtoolz.finalAssetTracker.v1   (mutable state)
 *   final-music-brief.json           vidtoolz.finalMusicBrief.v1
 *   final-resolve-blueprint.json     vidtoolz.finalResolveBlueprint.v1
 *   final-production-package.json    vidtoolz.finalProductionPackage.v1
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const lockAuthority = require('./final-production-lock.js');
const reviewSubject = require('./draft-review-subject.js');
const planningTask = require('./agent-task-visual-planning.js');
const directed = require('./directed-draft-assembly-handoff.js');

const PACKAGE_SCHEMA = 'vidtoolz.finalProductionPackage.v1';
const SCRIPT_SCHEMA = 'vidtoolz.finalScriptPackage.v1';
const PERFORMANCE_SCHEMA = 'vidtoolz.finalPerformancePackage.v1';
const VISUAL_SCHEMA = 'vidtoolz.finalVisualPackage.v1';
const TRACKER_SCHEMA = 'vidtoolz.finalAssetTracker.v1';
const MUSIC_SCHEMA = 'vidtoolz.finalMusicBrief.v1';
const BLUEPRINT_SCHEMA = 'vidtoolz.finalResolveBlueprint.v1';
const I2V_SCHEMA = 'vidtoolz.finalImageBoundMotionPrompt.v1';
const PACKAGE_DIR = 'final-production';

/* Asset lifecycle. GENERATED never implies SELECTED: a human selection is its
 * own transition, and only a SELECTED image may bind a motion prompt. */
const ASSET_STATES = Object.freeze([
  'REQUIRED', 'PROMPT_READY', 'GENERATED', 'SELECTED',
  'I2V_READY', 'VIDEO_GENERATED', 'FINAL_ASSET_SELECTED',
]);
const ASSET_KINDS = Object.freeze(['FINAL_STILL_CANDIDATE', 'FINAL_VIDEO_SOURCE_CANDIDATE']);
const OUTPUT_GEOMETRY = Object.freeze({ width: 1080, height: 1920, aspect_ratio: '9:16' });
/* Vertical safe regions the final edit relies on (fractions of frame height). */
const SAFE_REGIONS = Object.freeze({
  top_reserved: '0.00-0.12 (title / platform chrome)',
  bottom_reserved: '0.82-1.00 (captions, handles, platform UI)',
  primary_subject_band: '0.18-0.78',
  text_safe_band: '0.20-0.74',
});

class FinalPackageError extends Error {
  constructor(code, message) { super(message); this.name = 'FinalPackageError'; this.code = code; }
}
function fail(code, message) { throw new FinalPackageError(code, message); }
function canonicalize(value) { return lockAuthority.canonicalize(value); }
function digest(value) { return lockAuthority.digest(value); }
function sha256File(file) { return lockAuthority.sha256File(file); }
function readJson(file, code = 'FINAL_PACKAGE_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('FINAL_PACKAGE_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, jsonBytes(value));
  fs.renameSync(tmp, file);
}
function packagePaths(runDir) {
  const base = path.join(path.resolve(runDir), PACKAGE_DIR);
  return {
    base,
    package: path.join(base, 'final-production-package.json'),
    script: path.join(base, 'final-script.json'),
    performance: path.join(base, 'final-performance-package.json'),
    visual: path.join(base, 'final-visual-package.json'),
    tracker: path.join(base, 'final-asset-tracker.json'),
    music: path.join(base, 'final-music-brief.json'),
    blueprint: path.join(base, 'final-resolve-blueprint.json'),
    motion: path.join(base, 'motion-prompts'),
  };
}

/* ── locked script + timing, from canonical authorities only ─────────────── */

function loadLockedStory(runDir, lock, options = {}) {
  let loaded;
  try {
    loaded = planningTask.loadCanonicalStory({
      scriptBuilderRoot: options.scriptBuilderRoot,
      projectId: lock.locked_script.story_project_id,
      versionId: lock.locked_script.story_version_id,
    });
  } catch (error) {
    /* The canonical Story authority refuses a superseded version. That is the
     * correct answer and it is exactly script drift: a Story successor was
     * approved after the lock, so the locked script is no longer the project
     * head. Surface it as a TYPED failure rather than an upstream string. */
    fail('FINAL_PACKAGE_SCRIPT_DRIFT',
      `the locked Story version ${lock.locked_script.story_version_id} is no longer resolvable as the canonical head (${error.message}) — a locked script may not be superseded in place; break the lock and re-approve`);
  }
  if (loaded.story.content_hash !== lock.locked_script.story_content_hash) {
    fail('FINAL_PACKAGE_SCRIPT_DRIFT', `locked ${lock.locked_script.story_content_hash}, resolved ${loaded.story.content_hash}`);
  }
  return loaded.story;
}

/* Sentence segmentation for the performance package. Deliberately simple and
 * deterministic: it never rewrites a word, only marks where lines break. */
function segmentLines(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  return clean.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
}
function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }

/* ── final GPT image prompts (materially stronger than Draft prompts) ─────── */

const ROLE_DIRECTION = Object.freeze({
  METAPHOR: 'a single clear visual metaphor, one dominant subject, no literal illustration of the words',
  CONCEPTUAL: 'an abstract conceptual composition that reads instantly at thumbnail scale',
  SCENE: 'a grounded photographic scene with one unambiguous focal subject',
  INFOGRAPHIC: 'a designed information graphic with explicit typographic hierarchy',
  DIAGRAM: 'a clean explanatory diagram with labelled relationships',
  TEXTUAL_GRAPHIC: 'a typographic statement card',
  OTHER: 'a single-subject composition serving the stated purpose',
});
const TEXT_BEARING_ROLES = Object.freeze(['INFOGRAPHIC', 'DIAGRAM', 'TEXTUAL_GRAPHIC']);

/*
 * A final prompt is built from the LOCKED script line plus the approved
 * creative intent — never from an ephemeral Draft image path. Text-bearing
 * roles get an explicit allowed-text contract (GPT Image renders type well);
 * photographic roles are explicitly text-free, which is the estate's standing
 * rule for generated imagery.
 */
function buildFinalImagePrompt(beat) {
  const textBearing = TEXT_BEARING_ROLES.includes(beat.visual_role);
  const parts = [
    `Vertical ${OUTPUT_GEOMETRY.aspect_ratio} (${OUTPUT_GEOMETRY.width}x${OUTPUT_GEOMETRY.height}) final publication image for a narrated short-form video.`,
    `Narrative function: ${beat.purpose}. Treatment: ${ROLE_DIRECTION[beat.visual_role] || ROLE_DIRECTION.OTHER}.`,
    `Subject: ${beat.subject}.`,
    `Approved creative intent: ${beat.approved_concept}`,
    `Composition: one dominant subject centred in the ${SAFE_REGIONS.primary_subject_band} vertical band; keep ${SAFE_REGIONS.top_reserved} and ${SAFE_REGIONS.bottom_reserved} visually quiet for titles, captions and platform UI; generous negative space; no important detail near any frame edge.`,
    'Lighting and finish: deliberate directional lighting, controlled contrast, clean modern colour grade, no visual noise, publication-grade sharpness.',
    textBearing
      ? `Typography: render EXACTLY and ONLY this text, spelled as given — ${JSON.stringify(beat.allowed_text)}. Hierarchy: ${beat.text_hierarchy}. Set it inside the ${SAFE_REGIONS.text_safe_band} band in a single clean geometric sans; no other words, no captions, no watermarks, no logos, no invented labels.`
      : 'Typography: NO text, letters, numerals, labels, captions, watermarks or logos anywhere in the image.',
    'Avoid: collage or split panels, multiple competing subjects, busy backgrounds, stock-photo staging, distorted hands or faces, extra limbs or fingers, uncanny anatomy, cluttered edges, horizontal framing, letterboxing.',
  ];
  return parts.join(' ');
}

/*
 * Infographic beats carry a full information contract, not just a prompt.
 * Allowed text is derived verbatim from the locked script line — the package
 * never invents claims, and the exact-text list is what keeps a designed card
 * factually identical to the approved script.
 */
function infographicContract(beat) {
  if (!TEXT_BEARING_ROLES.includes(beat.visual_role)) return null;
  return {
    information_objective: beat.purpose,
    exact_allowed_text: beat.allowed_text,
    text_source: 'derived verbatim from the locked script line for this beat — no invented claims, no added numbers',
    hierarchy: beat.text_hierarchy,
    layout: 'single centred information block; one idea per card; no more than the allowed lines',
    typography_constraints: 'one geometric sans family, two weights maximum, sentence case, generous line spacing, no outline or drop shadow',
    background_requirement: 'flat or subtly graded background with sufficient contrast for the text; no photographic clutter behind type',
    safe_regions: SAFE_REGIONS,
    visual_grammar: 'V2 full-frame designed card grammar: the card carries the argument, geometry is static, typography must fit within the text-safe band without autoscaling below legibility',
  };
}

/*
 * Still vs video-source is a production RECOMMENDATION with a stated basis.
 * Mikko may override it; the tracker records the override as human authority.
 */
/*
 * Motion has to earn its place. Every beat turned into a Kling clip would mean
 * 20 video generations for a 20-beat programme, which is neither the cost nor
 * the look this format wants. A video source is recommended only where BOTH
 * conditions hold: concrete photographic-or-metaphorical imagery (which reads
 * naturally with parallax) AND a hold long enough that a still would start to
 * feel static. Everything else — abstract concepts, diagrams, designed text
 * cards, short holds — is a still.
 */
const MOTION_MIN_HOLD_MS = 9000;
const MOTION_FRIENDLY_ROLES = Object.freeze(['SCENE', 'METAPHOR']);
function classifyAssetKind(beat) {
  if (TEXT_BEARING_ROLES.includes(beat.visual_role)) {
    return { kind: 'FINAL_STILL_CANDIDATE', basis: 'text-bearing designed card: motion degrades legibility and risks re-rendering type' };
  }
  const motionFriendly = MOTION_FRIENDLY_ROLES.includes(beat.visual_role);
  const longHold = beat.duration_ms >= MOTION_MIN_HOLD_MS;
  if (motionFriendly && longHold) {
    return { kind: 'FINAL_VIDEO_SOURCE_CANDIDATE', basis: `${beat.duration_ms} ms hold on a concrete ${beat.visual_role} beat — long enough that subtle motion earns its generation cost` };
  }
  return {
    kind: 'FINAL_STILL_CANDIDATE',
    basis: !motionFriendly
      ? `${beat.visual_role} imagery reads better as a held still than as motion`
      : `${beat.duration_ms} ms hold is under the ${MOTION_MIN_HOLD_MS} ms motion threshold — a still reads cleanly and avoids unnecessary generation cost`,
  };
}

/* Provisional motion intent. NOT an authoritative I2V prompt: that may only
 * be minted against an actually selected final image (see bindMotionPrompt). */
function motionIntentFor(beat) {
  return {
    intended_motion: beat.visual_role === 'SCENE' ? 'slow parallax push into the focal subject' : 'slow drift with subtle depth separation',
    camera_behavior: 'single continuous move, no cuts, no rotation, no whip',
    duration_ms: beat.duration_ms,
    transformation_intent: 'the subject and composition must remain the selected image; motion adds life, never new content',
    motion_constraints: ['no new objects', 'no text appearing', 'no face or hand morphing', 'no style change', 'no camera shake', 'loopable start and end framing'],
    provisional_prompt_template: 'Animate the provided image with {intended_motion}. {camera_behavior}. Preserve the exact subject, composition, lighting and colour of the source image. No new elements, no text, no morphing. Duration {duration_ms} ms.',
    authoritative_prompt: null,
    authoritative_prompt_requires: 'the sha256 of the actually selected final image (bindMotionPrompt)',
  };
}

/* ── package construction ────────────────────────────────────────────────── */

function buildVisualBeats(runDir, lock, story, options = {}) {
  /* Beat identity and approved creative intent come from the SAME canonical
   * artifacts the approved Draft rendered from — resolved through the lock's
   * handoff, never from a caller-supplied path. */
  const intakeRecord = directed.discoverActiveIntake(runDir);
  const artifacts = directed.flattenArtifacts(intakeRecord.value);
  const planArtifact = artifacts.find((item) => item.slot_name === 'visual' && item.status === 'ACTIVE');
  if (!planArtifact) fail('FINAL_PACKAGE_VISUAL_PLAN_MISSING', 'the active assembly intake declares no visual plan');
  const planFile = path.isAbsolute(planArtifact.path) ? planArtifact.path : path.resolve(runDir, planArtifact.path);
  if (!fs.existsSync(planFile) || sha256File(planFile) !== planArtifact.sha256) fail('FINAL_PACKAGE_VISUAL_PLAN_DRIFT', planArtifact.path);
  const plan = readJson(planFile, 'FINAL_PACKAGE_VISUAL_PLAN_INVALID');
  if (plan.story?.version_id !== lock.locked_script.story_version_id || plan.story?.content_hash !== lock.locked_script.story_content_hash) {
    fail('FINAL_PACKAGE_VISUAL_PLAN_DRIFT', 'the approved visual plan is bound to a different Story version than the lock');
  }
  const slots = plan.draft_bespoke_still_policy?.slots || [];
  if (!slots.length) fail('FINAL_PACKAGE_VISUAL_PLAN_INVALID', 'no visual slots in the approved plan');
  const shotById = new Map((plan.shots || []).map((shot) => [shot.shot_id, shot]));
  const sectionById = new Map((story.sections || []).map((section) => [section.section_id ?? section.id, section]));
  const timingByBeat = new Map((lock.creative_direction.beat_identity || []).map((item) => [item.beat_id, item]));

  return slots.map((slot, index) => {
    const shot = shotById.get(slot.shot_id) || {};
    const timing = timingByBeat.get(slot.slot_id) || null;
    const sectionId = slot.script_binding.section_id;
    const section = sectionById.get(sectionId) || null;
    const lockedLine = String(section?.dialogue ?? slot.script_binding.source_text ?? '').trim();
    const durationMs = timing ? Math.round((timing.end_seconds - timing.start_seconds) * 1000) : slot.expected_timeline.duration_ms;
    const lines = segmentLines(lockedLine);
    const beat = {
      final_beat_id: `final-visual-${String(index + 1).padStart(3, '0')}`,
      draft_beat_id: slot.slot_id,
      section_id: sectionId,
      order: index + 1,
      purpose: slot.purpose,
      narrative_function: shot.narrative_function ?? slot.purpose,
      visual_role: slot.visual_role,
      subject: shot.subject ?? slot.visual_concept,
      approved_concept: slot.visual_concept,
      locked_script_line: lockedLine,
      start_ms: timing ? Math.round(timing.start_seconds * 1000) : null,
      end_ms: timing ? Math.round(timing.end_seconds * 1000) : null,
      duration_ms: durationMs,
      allowed_text: TEXT_BEARING_ROLES.includes(slot.visual_role) ? lines.slice(0, 3) : [],
      text_hierarchy: TEXT_BEARING_ROLES.includes(slot.visual_role)
        ? 'the first line is the dominant statement; any following line is supporting at clearly lower weight'
        : null,
      geometry: OUTPUT_GEOMETRY,
      safe_regions: SAFE_REGIONS,
      draft_reference: {
        draft_beat_id: slot.slot_id,
        draft_prompt_id: slot.prompt_id,
        purpose: 'CONCEPTUAL_CONTINUITY_ONLY — the Draft still is a prototype, never a final asset and never an input path',
      },
      manual_selection_required: true,
      final_asset_authority: false,
      publication_authority: false,
    };
    const classification = classifyAssetKind(beat);
    return {
      ...beat,
      final_image_prompt: buildFinalImagePrompt(beat),
      final_image_prompt_id: `final-image-prompt-${beat.final_beat_id}`,
      infographic_contract: infographicContract(beat),
      recommended_asset_kind: classification.kind,
      recommendation_basis: classification.basis,
      recommendation_is_human_overridable: true,
      motion_intent: classification.kind === 'FINAL_VIDEO_SOURCE_CANDIDATE' ? motionIntentFor(beat) : null,
    };
  });
}

function buildPerformancePackage(lock, story, beats) {
  const beatsBySection = new Map();
  for (const beat of beats) {
    const list = beatsBySection.get(beat.section_id) || [];
    list.push(beat);
    beatsBySection.set(beat.section_id, list);
  }
  const sections = (story.sections || []).map((section, index) => {
    const sectionId = section.section_id ?? section.id;
    const owned = beatsBySection.get(sectionId) || [];
    const lockedLine = String(section.dialogue || '').trim();
    const start = owned.length ? Math.min(...owned.map((beat) => beat.start_ms ?? 0)) : null;
    const end = owned.length ? Math.max(...owned.map((beat) => beat.end_ms ?? 0)) : null;
    return {
      section_id: sectionId,
      order: index + 1,
      beat_label: section.beat ?? null,
      locked_lines: segmentLines(lockedLine),
      word_count: wordCount(lockedLine),
      draft_reference_timing_ms: start !== null ? { start_ms: start, end_ms: end, duration_ms: end - start } : null,
      target_duration_ms: start !== null ? end - start : null,
      pacing_note: 'match the Draft reference duration within roughly +/-15%; the final edit re-times visuals to the delivered performance, not the reverse',
      pause_after_ms: index < (story.sections || []).length - 1 ? 350 : 600,
      emphasis_guidance: 'emphasise the load-bearing claim of this section; the Draft reference timing shows where it landed',
      covered_by_final_visual_beats: owned.map((beat) => beat.final_beat_id),
    };
  });
  return {
    schema: PERFORMANCE_SCHEMA,
    artifact_type: 'final-performance-package',
    run_id: lock.run_id,
    lock_id: lock.lock_id,
    lock_digest_sha256: lock.lock_digest_sha256,
    performer: 'Mikko Pakkala',
    requirement: 'A FRESH human performance of the locked script is required for Final Production.',
    draft_narration_cannot_satisfy_this: {
      draft_narration_fidelity: lock.draft_narration.fidelity,
      draft_narration_sha256: lock.draft_narration.audio_sha256,
      reason: 'This Draft carries a human-recorded narration as an EXCEPTION (normal Draft narration is synthetic). Neither synthetic Draft narration nor this exceptional Draft recording holds final performance authority: the final performance must be separately recorded and selected against this lock.',
      final_human_performance_authority: false,
    },
    locked_script: { story_version_id: lock.locked_script.story_version_id, story_content_hash: lock.locked_script.story_content_hash, script_sha256: lock.locked_script.script_sha256 },
    sections,
    total_target_duration_ms: sections.reduce((sum, section) => sum + (section.target_duration_ms || 0), 0),
    recording_checklist: [
      'Read from the locked script only — no ad-libs, no rewording; a wording change requires a lock break.',
      'Record the whole programme in one pass, then pick-ups per section as needed.',
      'Consistent mic position and level across all takes; note the mic/room if it changes.',
      'Leave the pause_after_ms gap between sections so the edit has handles.',
      'Record at least one alternate take of every section carrying a load-bearing claim.',
      'Keep room tone: 10 seconds of silence at the top for noise profiling.',
    ],
    takes: [],
    take_identity_placeholder: { take_id: null, path: null, sha256: null, recorded_at: null, sections_covered: [] },
    selected_take: null,
    selected_take_authority: { required: true, authority: 'HUMAN:Mikko Pakkala', state: 'PENDING', note: 'take selection is a human decision and is never automated' },
    state: 'REQUIRED',
    final_human_performance_complete: false,
  };
}

function buildMusicBrief(lock, story, beats, options = {}) {
  const functionMap = (story.sections || []).map((section, index) => {
    const sectionId = section.section_id ?? section.id;
    const owned = beats.filter((beat) => beat.section_id === sectionId);
    const purposes = [...new Set(owned.map((beat) => beat.purpose))];
    return {
      section_id: sectionId, order: index + 1,
      start_ms: owned.length ? Math.min(...owned.map((beat) => beat.start_ms ?? 0)) : null,
      end_ms: owned.length ? Math.max(...owned.map((beat) => beat.end_ms ?? 0)) : null,
      narrative_purpose: purposes.join(' / ') || (section.beat ?? 'section'),
      music_function: index === 0 ? 'OPENING_TENSION'
        : index === (story.sections || []).length - 1 ? 'RESOLUTION'
          : /reveal|reframe|moat/i.test(purposes.join(' ')) ? 'REFRAME'
            : /humor|joke|analog/i.test(purposes.join(' ')) ? 'HUMOR' : 'FORWARD_MOTION',
    };
  });
  return {
    schema: MUSIC_SCHEMA,
    artifact_type: 'final-music-brief',
    run_id: lock.run_id,
    lock_id: lock.lock_id,
    lock_digest_sha256: lock.lock_digest_sha256,
    state: 'REQUIRED',
    final_music_authority: false,
    draft_music_is_not_promoted: {
      draft_music_decision: lock.creative_direction.draft_music_decision,
      rule: 'DRAFT_SELECTED_MUSIC is provisional and is NEVER automatically promoted to FINAL_MUSIC_AUTHORITY. Final music is re-made or re-selected and separately approved.',
      draft_reference_use: 'INSPIRATION_ONLY',
    },
    target_duration_ms: lock.approved_draft.duration_seconds ? Math.round(lock.approved_draft.duration_seconds * 1000) : null,
    music_function_map: functionMap,
    emotional_progression: functionMap.map((item) => item.music_function),
    style_guidance: {
      role: 'underlay beneath continuous narration',
      instrumentation: 'follow the approved creative direction of the programme; one coherent instrumental identity across the whole piece',
      narration_compatibility: ['no lead vocals', 'no dominant midrange melody competing with speech', 'no constant dense percussion', 'controlled dynamics'],
      coherence_requirement: 'one intentional piece of music, not disconnected generated sections (the Draft music department\'s SOLID_SONG standard applies)',
      ending_requirement: 'a deliberate, intentional ending — a resolved button or a controlled fade, never an abrupt stop',
    },
    selection_authority: { required: true, authority: 'HUMAN:Mikko Pakkala', state: 'PENDING' },
    publication_authority: false,
  };
}

function buildResolveBlueprint(lock, story, beats, performance) {
  const timeline = beats.map((beat) => ({
    order: beat.order,
    final_beat_id: beat.final_beat_id,
    section_id: beat.section_id,
    draft_reference_start_ms: beat.start_ms,
    draft_reference_end_ms: beat.end_ms,
    draft_reference_duration_ms: beat.duration_ms,
    visual_role: beat.visual_role,
    planned_asset_kind: beat.recommended_asset_kind,
    visual_placeholder: { asset_id: null, sha256: null, state: 'AWAITING_FINAL_ASSET_SELECTION' },
    transition_in: beat.order === 1 ? 'FROM_BLACK' : 'CUT',
    transition_intent: beat.recommended_asset_kind === 'FINAL_VIDEO_SOURCE_CANDIDATE' ? 'let the motion carry; cut on the narration beat' : 'hard cut on the narration beat',
    graphic_overlay: beat.infographic_contract ? { kind: 'DESIGNED_CARD', carries_argument: true } : null,
    safe_areas: SAFE_REGIONS,
  }));
  return {
    schema: BLUEPRINT_SCHEMA,
    artifact_type: 'final-resolve-blueprint',
    run_id: lock.run_id,
    lock_id: lock.lock_id,
    lock_digest_sha256: lock.lock_digest_sha256,
    edit_mode: 'MANUAL — this blueprint organises Mikko\'s Resolve edit; it does not drive automated editing',
    output: { ...OUTPUT_GEOMETRY, fps: 30 },
    format: {
      structure: 'Mikko\'s recorded performance is the spine; final visuals (Kling clips, final stills, designed infographic cards) are cut against it; final music sits underneath as a dialogue-subordinate bed.',
      not_assumed: ['full-screen B-roll only', 'the r2 voiceover or r2 composition as the final edit'],
      audio_relationships: 'performance at programme level; music ducked beneath speech; room tone used to smooth pick-up joins',
    },
    audio: {
      performance_track: { source: 'FINAL_HUMAN_PERFORMANCE (selected take)', state: 'AWAITING_SELECTED_TAKE', placeholder: true },
      music_track: { source: 'FINAL_MUSIC (approved)', state: 'AWAITING_FINAL_MUSIC', role: 'DIALOGUE_SUBORDINATE_BED', placeholder: true },
    },
    timeline,
    section_order: performance.sections.map((section) => ({ section_id: section.section_id, order: section.order, locked_lines: section.locked_lines.length, target_duration_ms: section.target_duration_ms })),
    reference_only: { draft_output_sha256: lock.approved_draft.output_sha256, note: 'the approved Draft is a timing and intent reference; none of its media is a final asset' },
    final_edit_complete: false,
    publication_authority: false,
  };
}

function buildTracker(lock, beats) {
  return {
    schema: TRACKER_SCHEMA,
    artifact_type: 'final-asset-tracker',
    run_id: lock.run_id,
    lock_id: lock.lock_id,
    lock_digest_sha256: lock.lock_digest_sha256,
    states: ASSET_STATES,
    state_rules: {
      GENERATED_does_not_imply_SELECTED: 'a generated candidate is never automatically the selected asset; selection is a recorded human decision',
      selection_requires_hash: 'a selected asset must exist and its sha256 must match what the selector declared',
      i2v_requires_selected_image: 'a motion prompt may only be bound to an already SELECTED final image',
      final_asset_selected_requires: 'a still beat needs a SELECTED image; a video beat needs a SELECTED video clip generated from the bound motion prompt',
    },
    beats: beats.map((beat) => ({
      final_beat_id: beat.final_beat_id,
      draft_beat_id: beat.draft_beat_id,
      section_id: beat.section_id,
      required_asset_type: beat.recommended_asset_kind === 'FINAL_VIDEO_SOURCE_CANDIDATE' ? 'IMAGE_THEN_VIDEO' : 'IMAGE',
      recommended_asset_kind: beat.recommended_asset_kind,
      human_override_asset_kind: null,
      final_image_prompt_id: beat.final_image_prompt_id,
      state: 'PROMPT_READY',
      generated_images: [],
      selected_image: null,
      selection_authority: null,
      motion_prompt: null,
      generated_videos: [],
      selected_video: null,
      final_asset: null,
      final_asset_authority: false,
    })),
    final_assets_complete: false,
    publication_authority: false,
  };
}

/* ── the package ─────────────────────────────────────────────────────────── */

function createFinalProductionPackage(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const { lock } = lockAuthority.loadFinalProductionLock(runDir);
  lockAuthority.verifyLockCurrent(runDir, lock, options); // typed stale failure
  const paths = packagePaths(runDir);
  if (fs.existsSync(paths.package)) {
    const existing = readJson(paths.package);
    if (existing.lock_digest_sha256 !== lock.lock_digest_sha256) fail('FINAL_PACKAGE_LOCK_MISMATCH', 'an existing package belongs to a different lock');
    return { state: 'ALREADY_PACKAGED', package: existing, package_path: paths.package, paths };
  }
  const story = loadLockedStory(runDir, lock, options);
  const beats = buildVisualBeats(runDir, lock, story, options);

  const scriptPackage = {
    schema: SCRIPT_SCHEMA, artifact_type: 'final-script-package',
    run_id: lock.run_id, lock_id: lock.lock_id, lock_digest_sha256: lock.lock_digest_sha256,
    story: { project_id: lock.locked_script.story_project_id, version_id: lock.locked_script.story_version_id, content_hash: lock.locked_script.story_content_hash, approval_state: lock.locked_script.story_approval_state },
    script_sha256: lock.locked_script.script_sha256,
    performed_by: 'Mikko Pakkala — this locked script must be performed by Mikko for Final Production',
    synthetic_narration_permitted: false,
    sections: (story.sections || []).map((section, index) => {
      const sectionId = section.section_id ?? section.id;
      const owned = beats.filter((beat) => beat.section_id === sectionId);
      return {
        section_id: sectionId, order: index + 1, beat_label: section.beat ?? null,
        exact_locked_text: String(section.dialogue || '').trim(),
        lines: segmentLines(section.dialogue),
        word_count: wordCount(section.dialogue),
        draft_reference_timing_ms: owned.length ? { start_ms: Math.min(...owned.map((b) => b.start_ms ?? 0)), end_ms: Math.max(...owned.map((b) => b.end_ms ?? 0)) } : null,
        final_visual_beats: owned.map((beat) => beat.final_beat_id),
      };
    }),
    immutable_after_lock: true,
  };

  const performance = buildPerformancePackage(lock, story, beats);
  const visualPackage = {
    schema: VISUAL_SCHEMA, artifact_type: 'final-visual-package',
    run_id: lock.run_id, lock_id: lock.lock_id, lock_digest_sha256: lock.lock_digest_sha256,
    rebuild_doctrine: 'Final visuals are rebuilt from the locked script. The approved Draft stills are concept prototypes and are never publication assets.',
    generation_method: 'MANUAL — Mikko generates final images with GPT Image using these prompts. This package never calls an image API.',
    geometry: OUTPUT_GEOMETRY, safe_regions: SAFE_REGIONS,
    beat_count: beats.length,
    still_candidates: beats.filter((beat) => beat.recommended_asset_kind === 'FINAL_STILL_CANDIDATE').length,
    video_source_candidates: beats.filter((beat) => beat.recommended_asset_kind === 'FINAL_VIDEO_SOURCE_CANDIDATE').length,
    infographic_beats: beats.filter((beat) => beat.infographic_contract).length,
    beats,
    final_asset_authority: false, publication_authority: false,
  };
  const musicBrief = buildMusicBrief(lock, story, beats, options);
  const blueprint = buildResolveBlueprint(lock, story, beats, performance);
  const tracker = buildTracker(lock, beats);

  writeImmutable(paths.script, scriptPackage);
  writeImmutable(paths.performance, performance);
  writeImmutable(paths.visual, visualPackage);
  writeImmutable(paths.music, musicBrief);
  writeImmutable(paths.blueprint, blueprint);
  atomicJson(paths.tracker, tracker); // the tracker is living state, not immutable

  const core = {
    schema: PACKAGE_SCHEMA, artifact_type: 'final-production-package',
    run_id: lock.run_id, project_id: lock.project_id,
    lock_id: lock.lock_id, lock_digest_sha256: lock.lock_digest_sha256,
    approved_draft: { draft_version: lock.approved_draft.draft_version, output_sha256: lock.approved_draft.output_sha256 },
    human_approval: { review_id: lock.human_approval.review_id, authority: lock.human_approval.authority, derived_state: lock.human_approval.derived_state },
    components: {
      final_script: { path: path.relative(runDir, paths.script), sha256: sha256File(paths.script), schema: SCRIPT_SCHEMA },
      final_performance_package: { path: path.relative(runDir, paths.performance), sha256: sha256File(paths.performance), schema: PERFORMANCE_SCHEMA },
      final_visual_package: { path: path.relative(runDir, paths.visual), sha256: sha256File(paths.visual), schema: VISUAL_SCHEMA },
      final_asset_tracker: { path: path.relative(runDir, paths.tracker), schema: TRACKER_SCHEMA, mutable: true, note: 'living state — hash intentionally not pinned' },
      final_music_brief: { path: path.relative(runDir, paths.music), sha256: sha256File(paths.music), schema: MUSIC_SCHEMA },
      final_resolve_blueprint: { path: path.relative(runDir, paths.blueprint), sha256: sha256File(paths.blueprint), schema: BLUEPRINT_SCHEMA },
    },
    state: 'FINAL_PRODUCTION_PACKAGE_READY',
    production_state: {
      DRAFT_APPROVED: true,
      FINAL_PRODUCTION_LOCKED: true,
      FINAL_PRODUCTION_PACKAGE_READY: true,
      FINAL_ASSETS_COMPLETE: false,
      FINAL_HUMAN_PERFORMANCE_COMPLETE: false,
      FINAL_EDIT_COMPLETE: false,
      FINAL_QC_PASS: false,
      PUBLICATION_APPROVED: false,
    },
    manual_human_authority: [
      'select/approve final GPT images',
      'choose which images become video',
      'select Kling clips',
      'record the final performance',
      'select the final take',
      'perform and control the final Resolve edit',
      'approve final music',
      'approve final QC',
      'approve publication',
    ],
    authority: {
      publication_ready: false, publication_authority: false, publish_approved: false, youtube_approved: false,
      final_master_exists: false, final_qc_pass: false,
      grants_final_asset_authority: false, grants_final_music_authority: false, grants_final_performance_authority: false,
    },
    created_at: options.now || new Date().toISOString(),
  };
  const packageValue = { ...core, package_digest_sha256: digest(core) };
  writeImmutable(paths.package, packageValue);
  return { state: 'PACKAGED', package: packageValue, package_path: paths.package, paths, beats, tracker, performance, musicBrief, blueprint, scriptPackage };
}

/* ── tracker transitions (each is a recorded human decision) ─────────────── */

function loadTracker(runDir) {
  const paths = packagePaths(runDir);
  if (!fs.existsSync(paths.tracker)) fail('FINAL_PACKAGE_TRACKER_MISSING', paths.tracker);
  const tracker = readJson(paths.tracker, 'FINAL_PACKAGE_TRACKER_INVALID');
  if (tracker.schema !== TRACKER_SCHEMA) fail('FINAL_PACKAGE_TRACKER_INVALID', String(tracker.schema));
  return { tracker, paths };
}
function trackerBeat(tracker, finalBeatId) {
  const beat = tracker.beats.find((item) => item.final_beat_id === finalBeatId);
  if (!beat) fail('FINAL_PACKAGE_BEAT_UNKNOWN', String(finalBeatId));
  return beat;
}
function requireLockCurrent(runDir, options = {}) {
  const { lock } = lockAuthority.loadFinalProductionLock(runDir);
  lockAuthority.verifyLockCurrent(runDir, lock, options);
  return lock;
}
function verifiedAsset(runDir, asset, label) {
  if (!asset?.path || typeof asset.path !== 'string') fail('FINAL_PACKAGE_ASSET_PATH_REQUIRED', label);
  const file = path.isAbsolute(asset.path) ? asset.path : path.resolve(runDir, asset.path);
  const real = fs.existsSync(file) ? fs.realpathSync(file) : fail('FINAL_PACKAGE_ASSET_MISSING', asset.path);
  if (!fs.statSync(real).isFile()) fail('FINAL_PACKAGE_ASSET_MISSING', asset.path);
  /* No caller-supplied path becomes authority on assertion alone: it must live
   * inside the run and its declared hash must match its actual bytes. */
  const root = fs.realpathSync(runDir);
  if (!(real === root || real.startsWith(`${root}${path.sep}`))) fail('FINAL_PACKAGE_ASSET_OUTSIDE_RUN', asset.path);
  const actual = sha256File(real);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 || '')) fail('FINAL_PACKAGE_ASSET_SHA_REQUIRED', label);
  if (actual !== asset.sha256) fail('FINAL_PACKAGE_ASSET_SHA_MISMATCH', `${label}: declared ${asset.sha256}, actual ${actual}`);
  return { path: path.relative(root, real), absolute_path: real, sha256: actual };
}

function recordGeneratedImages(runDirInput, finalBeatId, images, options = {}) {
  const runDir = path.resolve(runDirInput);
  requireLockCurrent(runDir, options);
  const { tracker, paths } = loadTracker(runDir);
  const beat = trackerBeat(tracker, finalBeatId);
  if (!Array.isArray(images) || !images.length) fail('FINAL_PACKAGE_NO_IMAGES', finalBeatId);
  for (const image of images) {
    const verified = verifiedAsset(runDir, image, `${finalBeatId} generated image`);
    if (beat.generated_images.some((item) => item.sha256 === verified.sha256)) continue;
    beat.generated_images.push({ ...verified, recorded_at: new Date().toISOString(), prompt_id: beat.final_image_prompt_id });
  }
  // GENERATED is explicitly NOT SELECTED.
  if (['PROMPT_READY', 'REQUIRED'].includes(beat.state)) beat.state = 'GENERATED';
  atomicJson(paths.tracker, tracker);
  return { state: beat.state, beat };
}

function selectFinalImage(runDirInput, finalBeatId, image, options = {}) {
  const runDir = path.resolve(runDirInput);
  requireLockCurrent(runDir, options);
  const { tracker, paths } = loadTracker(runDir);
  const beat = trackerBeat(tracker, finalBeatId);
  if (!options.authority || typeof options.authority !== 'string') fail('FINAL_PACKAGE_SELECTION_AUTHORITY_REQUIRED', 'image selection is a human decision and must name its authority');
  const verified = verifiedAsset(runDir, image, `${finalBeatId} selected image`);
  if (!beat.generated_images.some((item) => item.sha256 === verified.sha256)) {
    fail('FINAL_PACKAGE_SELECTION_UNREGISTERED', `${finalBeatId}: only a recorded generated candidate may be selected`);
  }
  beat.selected_image = { ...verified, selected_at: new Date().toISOString() };
  beat.selection_authority = { type: 'HUMAN', id: options.authority, note: options.note || null };
  if (options.assetKindOverride) {
    if (!ASSET_KINDS.includes(options.assetKindOverride)) fail('FINAL_PACKAGE_ASSET_KIND_INVALID', String(options.assetKindOverride));
    beat.human_override_asset_kind = options.assetKindOverride;
  }
  const kind = beat.human_override_asset_kind || beat.recommended_asset_kind;
  beat.state = 'SELECTED';
  if (kind === 'FINAL_STILL_CANDIDATE') {
    beat.final_asset = { kind: 'FINAL_STILL', ...verified };
    beat.state = 'FINAL_ASSET_SELECTED';
  }
  atomicJson(paths.tracker, tracker);
  return { state: beat.state, beat };
}

/*
 * The image-bound motion prompt. This is the mission's hard boundary: an
 * authoritative I2V/Kling prompt may not exist before the actual selected
 * final image exists, because the prompt must describe THAT image.
 */
function bindMotionPrompt(runDirInput, finalBeatId, options = {}) {
  const runDir = path.resolve(runDirInput);
  const lock = requireLockCurrent(runDir, options);
  const { tracker, paths } = loadTracker(runDir);
  const beat = trackerBeat(tracker, finalBeatId);
  const kind = beat.human_override_asset_kind || beat.recommended_asset_kind;
  if (kind !== 'FINAL_VIDEO_SOURCE_CANDIDATE') fail('FINAL_PACKAGE_NOT_A_VIDEO_SOURCE', `${finalBeatId} is a ${kind}`);
  if (!beat.selected_image) fail('FINAL_PACKAGE_I2V_REQUIRES_SELECTED_IMAGE', `${finalBeatId}: no final image has been selected — an authoritative motion prompt cannot exist yet`);
  const verified = verifiedAsset(runDir, beat.selected_image, `${finalBeatId} selected image`);
  const packageValue = readJson(packagePaths(runDir).visual, 'FINAL_PACKAGE_VISUAL_INVALID');
  const source = packageValue.beats.find((item) => item.final_beat_id === finalBeatId);
  if (!source?.motion_intent) fail('FINAL_PACKAGE_MOTION_INTENT_MISSING', finalBeatId);
  const intent = source.motion_intent;
  const prompt = intent.provisional_prompt_template
    .replace('{intended_motion}', intent.intended_motion)
    .replace('{camera_behavior}', intent.camera_behavior)
    .replace('{duration_ms}', String(intent.duration_ms));
  const core = {
    schema: I2V_SCHEMA, artifact_type: 'final-image-bound-motion-prompt',
    run_id: lock.run_id, lock_id: lock.lock_id, lock_digest_sha256: lock.lock_digest_sha256,
    final_beat_id: finalBeatId, draft_beat_id: beat.draft_beat_id, section_id: beat.section_id,
    selected_image: { path: verified.path, sha256: verified.sha256 },
    motion_intent: { intended_motion: intent.intended_motion, camera_behavior: intent.camera_behavior, duration_ms: intent.duration_ms, constraints: intent.motion_constraints },
    authoritative_prompt: prompt,
    generation_method: 'MANUAL — Mikko submits the selected image plus this prompt to Kling; this module never calls a video API',
    binds_selected_image: true,
    final_asset_authority: false, publication_authority: false,
    created_at: options.now || new Date().toISOString(),
  };
  const record = { ...core, motion_prompt_digest_sha256: digest(core) };
  const file = path.join(paths.motion, `${finalBeatId}-${verified.sha256.slice(0, 16)}.json`);
  writeImmutable(file, record);
  beat.motion_prompt = { path: path.relative(runDir, file), sha256: sha256File(file), digest_sha256: record.motion_prompt_digest_sha256, bound_image_sha256: verified.sha256 };
  beat.state = 'I2V_READY';
  atomicJson(paths.tracker, tracker);
  return { state: beat.state, record, path: file, beat };
}

function recordGeneratedVideos(runDirInput, finalBeatId, videos, options = {}) {
  const runDir = path.resolve(runDirInput);
  requireLockCurrent(runDir, options);
  const { tracker, paths } = loadTracker(runDir);
  const beat = trackerBeat(tracker, finalBeatId);
  if (!beat.motion_prompt) fail('FINAL_PACKAGE_VIDEO_REQUIRES_MOTION_PROMPT', finalBeatId);
  for (const video of videos || []) {
    const verified = verifiedAsset(runDir, video, `${finalBeatId} generated video`);
    if (beat.generated_videos.some((item) => item.sha256 === verified.sha256)) continue;
    beat.generated_videos.push({ ...verified, recorded_at: new Date().toISOString(), motion_prompt_digest_sha256: beat.motion_prompt.digest_sha256 });
  }
  if (beat.generated_videos.length) beat.state = 'VIDEO_GENERATED';
  atomicJson(paths.tracker, tracker);
  return { state: beat.state, beat };
}

function selectFinalVideo(runDirInput, finalBeatId, video, options = {}) {
  const runDir = path.resolve(runDirInput);
  requireLockCurrent(runDir, options);
  const { tracker, paths } = loadTracker(runDir);
  const beat = trackerBeat(tracker, finalBeatId);
  if (!options.authority) fail('FINAL_PACKAGE_SELECTION_AUTHORITY_REQUIRED', 'clip selection is a human decision');
  const verified = verifiedAsset(runDir, video, `${finalBeatId} selected video`);
  if (!beat.generated_videos.some((item) => item.sha256 === verified.sha256)) fail('FINAL_PACKAGE_SELECTION_UNREGISTERED', `${finalBeatId}: only a recorded generated clip may be selected`);
  beat.selected_video = { ...verified, selected_at: new Date().toISOString() };
  beat.selection_authority = { type: 'HUMAN', id: options.authority, note: options.note || null };
  beat.final_asset = { kind: 'FINAL_VIDEO', ...verified };
  beat.state = 'FINAL_ASSET_SELECTED';
  atomicJson(paths.tracker, tracker);
  return { state: beat.state, beat };
}

/* ── deterministic next-action projection ────────────────────────────────── */

/*
 * Answers "what is the next Final Production task?" concretely. It resolves
 * dependencies; it never schedules or executes anything.
 */
function nextActions(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const status = lockAuthority.lockStatus(runDir, options);
  if (status.state !== 'FINAL_PRODUCTION_LOCKED') {
    return {
      run_id: status.run_id, package_state: status.state,
      ready: [], blocked: [{ task: 'CREATE_FINAL_PRODUCTION_LOCK', blocked_by: status.state === 'DRAFT_APPROVED' ? 'lock not yet created' : `run state is ${status.state}` }],
      waiting_on_mikko: [], completed: [], next_action: status.state === 'DRAFT_APPROVED' ? 'Create the Final Production Lock for the approved Draft' : `Resolve run state ${status.state}`,
    };
  }
  const paths = packagePaths(runDir);
  if (!fs.existsSync(paths.package)) {
    return { run_id: status.run_id, package_state: 'FINAL_PRODUCTION_LOCKED', ready: [{ task: 'CREATE_FINAL_PRODUCTION_PACKAGE' }], blocked: [], waiting_on_mikko: [], completed: [], next_action: 'Create the Final Production Package from the current lock' };
  }
  let tracker = { beats: [] }; let visualFailure = null;
  try { ({ tracker } = loadTracker(runDir)); } catch (error) { visualFailure = error; }
  let performance = { sections: [], total_target_duration_ms: 0 }; let performancePackageFailure = null;
  try { performance = readJson(paths.performance, 'FINAL_PACKAGE_PERFORMANCE_INVALID'); } catch (error) { performancePackageFailure = error; }
  /* Final performance has its own immutable take/selection authority. The
   * package remains the requirement declaration; this projection reads the
   * current performance lane without making visual production depend on it. */
  const finalPerformance = require('./final-performance.js');
  const performanceStatus = performancePackageFailure
    ? { state: performancePackageFailure.code || 'FINAL_PACKAGE_PERFORMANCE_INVALID', error: performancePackageFailure.message }
    : finalPerformance.status(runDir, options);
  /* Final Music completion belongs to the live candidate/selection authority,
   * not to the immutable requirement brief. Keep this lookup here (rather
   * than duplicating completion logic) so shared readiness agrees with the
   * Final Music lane after Mikko selects or re-selects a candidate. */
  const finalMusicAuthority = require('./final-music-production.js');
  let musicCompletion = { complete: false }; let musicFailure = null;
  try {
    const musicContext = finalMusicAuthority.context(runDir, options);
    const musicRegistry = finalMusicAuthority.loadRegistry(musicContext, options);
    musicCompletion = finalMusicAuthority.finalMusicComplete(musicContext, musicRegistry);
  } catch (error) { musicFailure = error; }
  const ready = []; const blocked = []; const waiting = []; const completed = [];

  if (visualFailure) blocked.push({ task: 'FINAL_VISUAL_ASSETS', lane: 'VISUAL', code: visualFailure.code || 'FINAL_PACKAGE_VISUAL_INVALID', blocked_by: visualFailure.message });
  for (const beat of tracker.beats) {
    const kind = beat.human_override_asset_kind || beat.recommended_asset_kind;
    const label = `${beat.final_beat_id} (${beat.section_id})`;
    if (beat.state === 'FINAL_ASSET_SELECTED') { completed.push({ task: 'FINAL_ASSET_SELECTED', beat: beat.final_beat_id, kind: beat.final_asset?.kind }); continue; }
    if (beat.state === 'PROMPT_READY' || beat.state === 'REQUIRED') {
      ready.push({ task: 'GENERATE_FINAL_IMAGE', beat: beat.final_beat_id, section_id: beat.section_id, prompt_id: beat.final_image_prompt_id, instruction: `Generate final image for beat ${beat.final_beat_id} using prompt ${beat.final_image_prompt_id}`, method: 'GPT Image, manual' });
      continue;
    }
    if (beat.state === 'GENERATED') { waiting.push({ task: 'SELECT_FINAL_IMAGE', beat: beat.final_beat_id, candidates: beat.generated_images.length, instruction: `Select the final GPT image for beat ${label}` }); continue; }
    // 'SELECTED_IMAGE' is the canonical spelling used by the Final Asset
    // Production workflow; 'SELECTED' remains accepted as its predecessor.
    if (beat.state === 'SELECTED' || beat.state === 'SELECTED_IMAGE') {
      ready.push({ task: 'BIND_MOTION_PROMPT', beat: beat.final_beat_id, instruction: `Bind the image-bound Kling motion prompt for ${label} to the selected image`, requires_selected_image: true });
      continue;
    }
    if (beat.state === 'I2V_READY') { ready.push({ task: 'GENERATE_KLING_CLIP', beat: beat.final_beat_id, instruction: `Submit the selected image plus the bound motion prompt to Kling for ${label}`, method: 'Kling, manual' }); continue; }
    if (beat.state === 'VIDEO_GENERATED') { waiting.push({ task: 'SELECT_FINAL_CLIP', beat: beat.final_beat_id, candidates: beat.generated_videos.length, instruction: `Select the final Kling clip for ${label}` }); continue; }
    blocked.push({ task: 'UNKNOWN_BEAT_STATE', beat: beat.final_beat_id, state: beat.state, kind });
  }
  if (performanceStatus.state === 'INCOMPLETE' && performanceStatus.takes === 0) {
    ready.push({ task: 'RECORD_FINAL_PERFORMANCE', state: 'WAITING_FOR_MIKKO', instruction: `Record the locked script (${performance.sections.length} sections, ~${Math.round(performance.total_target_duration_ms / 1000)}s) — a fresh Mikko performance is required`, sections: performance.sections.map((section) => section.section_id) });
  } else if (performanceStatus.state === 'INCOMPLETE') {
    waiting.push({ task: 'SELECT_PERFORMANCE_TAKE', state: 'READY', instruction: performanceStatus.next_action, takes: performanceStatus.takes, missing_sections: performanceStatus.coverage.filter((item) => item.status === 'UNCOVERED').map((item) => item.section_id) });
  } else if (performanceStatus.state === 'COMPLETE') completed.push({ task: 'FINAL_HUMAN_PERFORMANCE_COMPLETE' });
  else blocked.push({ task: 'FINAL_HUMAN_PERFORMANCE', lane: 'PERFORMANCE', code: performanceStatus.error_code || performanceStatus.state, blocked_by: performanceStatus.error || performanceStatus.state });
  if (musicFailure) {
    blocked.push({ task: 'FINAL_MUSIC', lane: 'MUSIC', code: musicFailure.code || 'FINAL_MUSIC_AUTHORITY_INVALID', blocked_by: musicFailure.message });
  } else if (!musicCompletion.complete) {
    ready.push({ task: 'PRODUCE_FINAL_MUSIC', instruction: 'Produce or select final music against the final music brief (Draft music is provisional and is not promoted)' });
  }
  const assetsComplete = !visualFailure && tracker.beats.length > 0 && tracker.beats.every((beat) => beat.state === 'FINAL_ASSET_SELECTED');
  if (assetsComplete && performanceStatus.state === 'COMPLETE' && musicCompletion.complete) {
    ready.push({ task: 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE', instruction: 'Assemble the final edit in Resolve using the blueprint' });
  } else if (assetsComplete) {
    blocked.push({ task: 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE', blocked_by: [performanceStatus.state !== 'COMPLETE' ? 'final performance take' : null, !musicCompletion.complete ? 'final music' : null].filter(Boolean) });
  } else {
    blocked.push({ task: 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE', blocked_by: [`${tracker.beats.filter((beat) => beat.state !== 'FINAL_ASSET_SELECTED').length} final visual assets outstanding`] });
  }
  const order = ['GENERATE_FINAL_IMAGE', 'BIND_MOTION_PROMPT', 'GENERATE_KLING_CLIP', 'RECORD_FINAL_PERFORMANCE', 'PRODUCE_FINAL_MUSIC', 'ASSEMBLE_FINAL_EDIT_IN_RESOLVE'];
  const sortedReady = [...ready].sort((left, right) => (order.indexOf(left.task) - order.indexOf(right.task)) || String(left.beat || '').localeCompare(String(right.beat || '')));
  return {
    run_id: status.run_id, package_state: 'FINAL_PRODUCTION_PACKAGE_READY',
    ready: sortedReady, blocked, waiting_on_mikko: waiting, completed,
    next_action: sortedReady[0]?.instruction || waiting[0]?.instruction || 'All Final Production tasks in this projection are complete or blocked',
    counts: { ready: sortedReady.length, blocked: blocked.length, waiting_on_mikko: waiting.length, completed: completed.length },
    final_assets_complete: assetsComplete,
    final_human_performance_complete: performanceStatus.state === 'COMPLETE',
    final_music_complete: musicCompletion.complete,
    final_edit_complete: false, final_qc_pass: false, publication_approved: false,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..') };
  if (!['lock', 'package', 'status', 'next'].includes(out.command)) fail('FINAL_PACKAGE_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else if (argv[index] === '--expect-draft-sha') out.expectDraftSha = argv[++index];
    else fail('FINAL_PACKAGE_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('FINAL_PACKAGE_ARGUMENT_INVALID', `${out.command} requires --run-id`);
  return out;
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const runDir = directed.resolveRunDir(args.repo, args.runId);
    if (args.command === 'lock') {
      const result = lockAuthority.createFinalProductionLock(runDir, { expectedDraftSha256: args.expectDraftSha });
      process.stdout.write(`${JSON.stringify({ state: result.state, lock_id: result.lock.lock_id, approved_draft_sha256: result.lock.approved_draft.output_sha256, research_source: result.lock.research_approval.source, lock_path: result.lock_path }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'package') {
      const result = createFinalProductionPackage(runDir);
      process.stdout.write(`${JSON.stringify({ state: result.state, lock_id: result.package.lock_id, components: Object.keys(result.package.components), production_state: result.package.production_state }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'next') { process.stdout.write(`${JSON.stringify(nextActions(runDir), null, 2)}\n`); return 0; }
    process.stdout.write(`${JSON.stringify(lockAuthority.lockStatus(runDir), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'FINAL_PACKAGE_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  PACKAGE_SCHEMA, SCRIPT_SCHEMA, PERFORMANCE_SCHEMA, VISUAL_SCHEMA, TRACKER_SCHEMA,
  MUSIC_SCHEMA, BLUEPRINT_SCHEMA, I2V_SCHEMA, PACKAGE_DIR, ASSET_STATES, ASSET_KINDS,
  OUTPUT_GEOMETRY, SAFE_REGIONS, TEXT_BEARING_ROLES, MOTION_MIN_HOLD_MS, MOTION_FRIENDLY_ROLES,
  FinalPackageError, packagePaths, segmentLines, buildFinalImagePrompt, infographicContract,
  classifyAssetKind, motionIntentFor, buildVisualBeats, buildPerformancePackage,
  buildMusicBrief, buildResolveBlueprint, buildTracker, createFinalProductionPackage,
  loadTracker, recordGeneratedImages, selectFinalImage, bindMotionPrompt,
  recordGeneratedVideos, selectFinalVideo, nextActions, parseArgs, main,
};

if (require.main === module) { process.exitCode = main(); }
