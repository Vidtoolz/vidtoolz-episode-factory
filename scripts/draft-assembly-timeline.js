'use strict';

/*
 * Draft Assembly V0 timeline: a deterministic, pure function from already
 * verified inputs to an ordered plan of segments.
 *
 * THE SPINE IS THE NARRATION. Every timing in a V0 draft comes from measured
 * narration durations, in Story order. Nothing here invents pacing, guesses a
 * shot length, or decides that a beat "feels" long. That is the whole point:
 * when Mikko watches the draft and thinks a section drags, the section really
 * is that long, because the words take that long to say.
 *
 * What this is NOT:
 *   - not Edit Plan V1: no approvals, no tracks, no frame-exact ranges, no
 *     transitions beyond a declared cut or a fixed crossfade
 *   - not a visual director: shot-to-beat assignment is positional, declared,
 *     and boring
 *   - not a mixer: it records the music gain it was given, it does not choose it
 *
 * No filesystem access, no ffmpeg, no clock. Same inputs in, same plan out,
 * same digest — which is what makes rerun-detection and staleness honest.
 */

const crypto = require('node:crypto');

const PLAN_SCHEMA = 'vidtoolz.draftAssemblyPlan.v1';

// How a visual is made to cover its segment.
const FILL_TRIM = 'TRIM';        // source is long enough; play its head
const FILL_LOOP = 'LOOP';        // motion source is short; repeat it
const FILL_HOLD = 'HOLD';        // still image held for the segment

class DraftAssemblyTimelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftAssemblyTimelineError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftAssemblyTimelineError(code, message); }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => { out[key] = stableValue(value[key]); return out; }, {});
  }
  return value;
}

function digestOf(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function round(value, places = 6) {
  return Number(Number(value).toFixed(places));
}

/*
 * Target geometry. Explicit output wins; otherwise it is derived from the
 * Story's declared output class, because the Story is where the creator already
 * said what shape this episode is. There is no guess-from-the-media fallback:
 * letting the assets decide the frame would let a stray vertical clip silently
 * redefine the episode.
 */
function resolveOutput({ output, outputClass }) {
  if (output) return { ...output, source: 'BINDING' };
  const orientation = String(outputClass?.orientation || '').toLowerCase();
  const aspect = String(outputClass?.aspect_ratio || '').trim();
  if (orientation === 'horizontal' || aspect === '16:9') {
    return { width: 1920, height: 1080, fps: 30, source: 'STORY_OUTPUT_CLASS', aspect_ratio: '16:9' };
  }
  if (orientation === 'vertical' || aspect === '9:16') {
    return { width: 1080, height: 1920, fps: 30, source: 'STORY_OUTPUT_CLASS', aspect_ratio: '9:16' };
  }
  fail('DRAFT_PLAN_OUTPUT_UNDETERMINED',
    'no output geometry: the Story declares no usable output_class and the binding sets no explicit output');
  return null;
}

/*
 * Positional assignment: narrated section N takes visual N. Not clever, and
 * deliberately so — a V0 draft that guessed which shot belongs to which beat
 * would be presenting a machine's editorial opinion as if it were a plan.
 */
function assignVisuals(spokenSegments, visuals, shortfallPolicy) {
  const pool = visuals.filter((asset) => asset.present !== false);
  if (!pool.length) fail('DRAFT_PLAN_NO_VISUALS', 'the binding resolved no usable visual assets');

  const gaps = [];
  const assignments = spokenSegments.map((segment, index) => {
    if (index < pool.length) return { segment, asset: pool[index], reused: false };
    if (shortfallPolicy === 'CYCLE') {
      return { segment, asset: pool[index % pool.length], reused: true };
    }
    gaps.push({
      order: segment.order,
      section_id: segment.section_id,
      beat: segment.beat ?? null,
      reason: 'no visual asset is bound for this narrated section',
    });
    return { segment, asset: null, reused: false };
  });

  if (gaps.length) {
    const error = new DraftAssemblyTimelineError('DRAFT_PLAN_VISUAL_GAP',
      `${gaps.length} narrated section(s) have no bound visual and visual_shortfall is FAIL`);
    error.gaps = gaps;
    error.available = pool.length;
    error.required = spokenSegments.length;
    throw error;
  }
  return assignments;
}

/*
 * How much source a segment must actually cover. With CROSSFADE every segment
 * renders one crossfade longer than its timeline slot, because the overlap is
 * eaten by the dissolve into the next one. Ignoring that would make the last
 * crossfade of every clip a frozen or black tail.
 */
function renderDurationFor(durationSeconds, policy) {
  const overlap = policy.transition === 'CROSSFADE' ? policy.crossfade_seconds : 0;
  return round(durationSeconds + overlap);
}

function fillModeFor(asset, durationSeconds) {
  if (asset.kind === 'IMAGE') return FILL_HOLD;
  const source = Number(asset.probe?.duration_seconds);
  if (!Number.isFinite(source) || source <= 0) {
    fail('DRAFT_PLAN_SOURCE_DURATION_UNKNOWN', `visual ${asset.asset_id} has no measured duration`);
  }
  // A tiny epsilon keeps a source that is exactly segment-length from being
  // called a loop by float noise.
  return source + 0.001 >= durationSeconds ? FILL_TRIM : FILL_LOOP;
}

/*
 * Build the plan.
 *
 * narration is the DRAFT_SYNTHETIC_NARRATION manifest: its `segments` already
 * carry measured start/end/duration per Story section, and sections that
 * intentionally carry no dialogue are marked spoken:false. Silent sections take
 * no timeline time in V0 — a beat with nothing said has no measured length, and
 * inventing one would be inventing pacing.
 */
function planDraftTimeline(input) {
  const {
    runId, story, narration, visuals, music, output, outputClass, policy, storyApprovalState,
  } = input;

  if (!runId) fail('DRAFT_PLAN_INPUT_INVALID', 'runId is required');
  if (!narration || !Array.isArray(narration.segments)) fail('DRAFT_PLAN_INPUT_INVALID', 'a narration manifest with segments is required');
  if (!policy) fail('DRAFT_PLAN_INPUT_INVALID', 'a normalized policy is required');

  const frame = resolveOutput({ output, outputClass });
  const spoken = narration.segments.filter((segment) => segment.spoken);
  if (!spoken.length) fail('DRAFT_PLAN_NO_SPOKEN_SEGMENTS', 'the narration manifest carries no spoken segments');

  const silent = narration.segments.filter((segment) => !segment.spoken);
  const assignments = assignVisuals(spoken, visuals, policy.visual_shortfall);

  const warnings = [];
  let cursor = 0;
  const segments = assignments.map(({ segment, asset, reused }, index) => {
    const duration = Number(segment.duration_seconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      fail('DRAFT_PLAN_SEGMENT_DURATION_INVALID', `narration segment ${segment.order} has no positive duration`);
    }
    const renderDuration = renderDurationFor(duration, policy);
    const fill = fillModeFor(asset, renderDuration);
    const start = cursor;
    cursor = round(cursor + duration);

    if (reused) {
      warnings.push({
        code: 'VISUAL_REUSED',
        segment_order: index + 1,
        section_id: segment.section_id,
        detail: `visual ${asset.asset_id} is reused because fewer visuals are bound than narrated sections (visual_shortfall=CYCLE)`,
      });
    }
    if (fill === FILL_LOOP) {
      warnings.push({
        code: 'VISUAL_LOOPED',
        segment_order: index + 1,
        section_id: segment.section_id,
        detail: `visual ${asset.asset_id} is ${round(asset.probe.duration_seconds, 3)}s and is looped to cover ${round(renderDuration, 3)}s`,
      });
    }
    if (asset.probe && Number.isFinite(asset.probe.width) && asset.probe.width > 0) {
      const sourceLandscape = asset.probe.width >= asset.probe.height;
      const frameLandscape = frame.width >= frame.height;
      if (sourceLandscape !== frameLandscape) {
        warnings.push({
          code: 'VISUAL_ORIENTATION_MISMATCH',
          segment_order: index + 1,
          section_id: segment.section_id,
          detail: `visual ${asset.asset_id} is ${asset.probe.width}x${asset.probe.height} in a ${frame.width}x${frame.height} frame; it is ${policy.fit === 'COVER' ? 'cropped' : 'padded'}`,
        });
      }
    }

    // Where the human-readable name came from. A Story that carries no beat
    // gives us nothing to call this section, and dressing the section id up as
    // a name would present an identifier as editorial information.
    const beat = typeof segment.beat === 'string' && segment.beat.trim() ? segment.beat.trim() : null;
    if (!beat) {
      warnings.push({
        code: 'SECTION_BEAT_UNNAMED',
        segment_order: index + 1,
        section_id: segment.section_id,
        detail: 'the canonical Story carries no beat name for this section; the draft shows its position only, never the section id dressed up as a name',
      });
    }

    return {
      order: index + 1,
      section_id: segment.section_id,
      beat,
      beat_source: beat ? 'STORY_BEAT' : 'NONE',
      narration_order: segment.order,
      start_seconds: round(start),
      end_seconds: round(start + duration),
      duration_seconds: round(duration),
      render_duration_seconds: renderDuration,
      visual: {
        asset_id: asset.asset_id,
        kind: asset.kind,
        relative_path: asset.relative_path,
        sha256: asset.sha256,
        source_duration_seconds: asset.kind === 'VIDEO' ? round(asset.probe.duration_seconds, 3) : null,
        source_width: asset.probe?.width ?? null,
        source_height: asset.probe?.height ?? null,
        fill,
        reused,
        description: asset.description ?? null,
      },
    };
  });

  for (const segment of silent) {
    warnings.push({
      code: 'SECTION_SILENT',
      segment_order: null,
      section_id: segment.section_id,
      detail: `Story section carries no dialogue (${segment.reason || 'no reason recorded'}) and therefore occupies no draft time`,
    });
  }

  const totalDuration = round(cursor);
  const totalFrames = Math.round(totalDuration * frame.fps);

  const musicPlan = music
    ? {
      present: true,
      source_kind: music.source_kind,
      relative_path: music.relative_path,
      sha256: music.sha256,
      variant: music.variant ?? null,
      source_duration_seconds: Number.isFinite(Number(music.probe?.duration_seconds))
        ? round(music.probe.duration_seconds, 3) : null,
      start_seconds: 0,
      end_seconds: totalDuration,
      fill: null,
      gain_db: policy.music_gain_db,
      fade_in_seconds: 0,
      fade_out_seconds: 0,
    }
    : { present: false };

  if (musicPlan.present) {
    const sourceDuration = musicPlan.source_duration_seconds;
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
      fail('DRAFT_PLAN_MUSIC_DURATION_UNKNOWN', 'the bound music asset has no measured duration');
    }
    musicPlan.fill = sourceDuration + 0.001 >= totalDuration ? FILL_TRIM : FILL_LOOP;
    if (musicPlan.fill === FILL_LOOP) {
      warnings.push({
        code: 'MUSIC_LOOPED',
        segment_order: null,
        section_id: null,
        detail: `music bed is ${sourceDuration}s and is looped to cover ${totalDuration}s`,
      });
    }
    // Deterministic, bounded fades. Short drafts get proportionally shorter
    // ones so a 6-second canary is not all fade.
    const fade = round(Math.min(1.5, totalDuration / 8), 3);
    musicPlan.fade_in_seconds = fade;
    musicPlan.fade_out_seconds = fade;
  } else {
    warnings.push({
      code: 'MUSIC_ABSENT',
      segment_order: null,
      section_id: null,
      detail: 'no music is bound; the draft carries narration only',
    });
  }

  if (policy.transition === 'CROSSFADE' && policy.crossfade_seconds > 0) {
    const shortest = Math.min(...segments.map((s) => s.duration_seconds));
    if (policy.crossfade_seconds * 2 >= shortest) {
      fail('DRAFT_PLAN_CROSSFADE_TOO_LONG',
        `crossfade of ${policy.crossfade_seconds}s does not fit the shortest segment (${shortest}s)`);
    }
  }

  const plan = {
    schema: PLAN_SCHEMA,
    run_id: runId,
    story: {
      project_id: story?.project_id ?? null,
      version_id: story?.version_id ?? null,
      content_hash: story?.content_hash ?? null,
      approval_state: storyApprovalState ?? null,
    },
    narration: {
      manifest_schema: narration.schema ?? null,
      fidelity: narration.fidelity ?? null,
      relative_path: narration.assembled?.audio_path ?? null,
      sha256: narration.assembled?.audio_sha256 ?? null,
      duration_seconds: Number.isFinite(Number(narration.assembled?.duration_seconds))
        ? round(narration.assembled.duration_seconds, 3) : null,
      sample_rate: narration.assembled?.sample_rate ?? null,
      channels: narration.assembled?.channels ?? null,
    },
    output: {
      width: frame.width,
      height: frame.height,
      fps: frame.fps,
      aspect_ratio: frame.aspect_ratio ?? null,
      geometry_source: frame.source,
      video_codec: 'libx264',
      pixel_format: 'yuv420p',
      audio_codec: 'aac',
      audio_sample_rate: 48000,
      audio_channels: 2,
      container: 'mp4',
    },
    policy,
    timeline: {
      segment_count: segments.length,
      total_duration_seconds: totalDuration,
      total_frames: totalFrames,
      silent_section_count: silent.length,
    },
    segments,
    music: musicPlan,
    warnings,
  };

  // The digest covers everything that changes the rendered bytes and nothing
  // that does not, so a rerun with identical inputs is recognisably identical.
  plan.plan_digest_sha256 = digestOf({
    run_id: plan.run_id,
    story: plan.story,
    narration: plan.narration,
    output: plan.output,
    policy: plan.policy,
    segments: plan.segments,
    music: plan.music,
  });
  return plan;
}

module.exports = {
  PLAN_SCHEMA,
  FILL_TRIM,
  FILL_LOOP,
  FILL_HOLD,
  DraftAssemblyTimelineError,
  digestOf,
  resolveOutput,
  assignVisuals,
  renderDurationFor,
  fillModeFor,
  planDraftTimeline,
};
