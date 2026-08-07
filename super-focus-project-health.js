'use strict';

// Super Focus — project health & recovery summary (read-only).
//
// Answers, for one project or the whole picker, the operator questions the
// lifecycle controls alone cannot: what stage is this in, what exists, what is
// missing, is anything stale, is a queue busy or paused, is recovery needed,
// and what is the next SAFE action — without opening every project and reading
// multiple sections by hand.
//
// TRUTHFULNESS CONTRACT (see docs/super-focus.md):
//   * Every fact is computed from canonical project state (super-focus.json)
//     AND cheap current disk evidence — never invented.
//   * Direct facts (title/script saved, prompt counts) come from state.
//   * Disk facts (image/video counts, staleness, queue) reuse the SAME
//     read-only reconcilers the media views use (reconcileImages /
//     reconcileVideos / readVideoQueue), so a health count never disagrees
//     with what the operator sees inside the project.
//   * Legacy media with NO recorded provenance is reported as "unknown", never
//     mass-flagged stale (mirrors the media lane).
//   * Health state is NOT inferred from downstream artifacts alone: a video
//     file only counts toward completion when its upstream (still + i2v prompt)
//     exists, and unknown-provenance clips never promote a project to Healthy.
//   * READ-ONLY: no writes, no reconcile-by-writing, no manifest rebuild, no
//     stale-flag clearing, no stage advance, no restore, no selection change.
//   * A corrupt/unreadable project is surfaced as its own row (Recovery
//     needed), never silently omitted and never auto-repaired.
//
// Performance: existence checks + small JSON reads only. No ffprobe, no media
// decoding. The aggregate scans each project once; deeper per-clip inspection
// is left to the media views.

const fs = require('fs');
const path = require('path');
const superFocus = require('./super-focus.js');
const superFocusMedia = require('./super-focus-media.js');

// Health states, most-severe first for display ordering intuition. 'archived'
// and 'unreadable' are lifecycle/error states; the rest describe active work.
const HEALTH_STATES = {
  unreadable: 'Recovery needed',
  recovery_needed: 'Recovery needed',
  needs_review: 'Needs review',
  blocked: 'Blocked',
  in_progress: 'In progress',
  healthy: 'Healthy',
  archived: 'Archived',
};

const STAGE_LABELS = {
  title: 'Title',
  script: 'Script',
  image_prompts: 'Image prompts',
  images: 'Images',
  infographic_prompts: 'Infographics',
  i2v_prompts: 'Motion prompts',
  videos: 'Videos',
};

const VIDEO_SUBDIR = 'mp4';

function stageLabel(stage) {
  return STAGE_LABELS[stage] || 'Title';
}

function nonEmpty(text) {
  return typeof text === 'string' && text.trim().length > 0;
}

// Count image-prompt rows that carry real text (empty slots are not persisted,
// but a defensive filter keeps a hand-edited state honest).
function countImagePrompts(state) {
  return (Array.isArray(state.image_prompts) ? state.image_prompts : [])
    .filter((p) => p && nonEmpty(p.text)).length;
}

function countInfographicPrompts(state) {
  return (Array.isArray(state.infographic_prompts) ? state.infographic_prompts : [])
    .filter((p) => p && nonEmpty(p.text)).length;
}

function countI2vPrompts(state) {
  return (Array.isArray(state.image_prompts) ? state.image_prompts : [])
    .filter((p) => p && p.i2v_prompt && nonEmpty(p.i2v_prompt.text)).length;
}

// ── Disk evidence ───────────────────────────────────────────────────────────
// All optional: when the media root is not configured or a read throws, every
// disk-derived fact is null (UNKNOWN) and media_available is false. We never
// report "0 images" for "could not read". A media dir that simply does not
// exist yet is a verifiable zero (the reconcilers return done: 0), which is a
// different, honest fact.
function gatherEvidence(projectId, state, options = {}) {
  const facts = {
    title_saved: nonEmpty(state.title),
    script_saved: nonEmpty(state.script),
    script_eval_status: scriptEvalStatus(projectId, state, options),
    image_prompt_count: countImagePrompts(state),
    infographic_prompt_count: countInfographicPrompts(state),
    i2v_prompt_count: countI2vPrompts(state),
    media_available: false,
    image_count: null,
    missing_file_image_count: null,
    stale_image_count: null,
    video_total: null,
    video_count: null,
    failed_video_count: null,
    stale_video_count: null,
    unknown_provenance_video_count: null,
    queue_state: 'unknown',
    busy: false,
  };

  const mediaRoot = options.sfMediaRoot || options.mediaRoot;
  if (!mediaRoot) return facts;
  const mediaOpt = { mediaRoot };
  const imagePrompts = Array.isArray(state.image_prompts) ? state.image_prompts : [];
  try {
    const img = superFocusMedia.reconcileImages(projectId, imagePrompts, mediaOpt);
    facts.image_count = img.done;
    facts.missing_file_image_count = img.images.filter((r) => r.status === 'missing_file').length;
    facts.stale_image_count = img.images.filter((r) => r.prompt_changed).length;

    const vid = superFocusMedia.reconcileVideos(projectId, imagePrompts, VIDEO_SUBDIR, mediaOpt);
    facts.video_total = vid.total;
    facts.video_count = vid.done;
    facts.failed_video_count = vid.failed;
    facts.stale_video_count = vid.stale;
    facts.unknown_provenance_video_count = vid.videos
      .filter((v) => v.has_video && v.generated_i2v_hash == null).length;

    const queue = superFocusMedia.readVideoQueue(projectId, mediaOpt);
    const items = Array.isArray(queue.items) ? queue.items : [];
    const live = items.filter((it) => it && (it.status === 'queued' || it.status === 'running'));
    facts.busy = items.some((it) => it && it.status === 'running');
    facts.queue_state = live.length === 0 ? 'none' : (queue.paused ? 'paused' : 'active');
    facts.media_available = true;
  } catch (_) {
    // Media root misconfigured / unreadable → leave disk facts UNKNOWN (null).
    facts.media_available = false;
  }
  return facts;
}

// Advisory script-evaluation freshness, recomputed against the current script
// (never trusts a persisted flag alone). 'none' | 'current' | 'stale'.
function scriptEvalStatus(projectId, state, options = {}) {
  if (!state.script_evaluation) return 'none';
  try {
    const ev = superFocus.readScriptEvaluation(projectId, { root: options.sfRoot || options.root });
    if (!ev) return 'none';
    return ev.stale ? 'stale' : 'current';
  } catch (_) {
    // Fall back to the persisted flag if a lifecycle-aware reload is unavailable.
    return state.script_evaluation.stale ? 'stale' : 'current';
  }
}

// ── Classification (PURE) ─────────────────────────────────────────────────────
// deriveHealth turns state + evidence + lifecycle into a compact, honest
// summary. No disk, no I/O — fully unit-testable in isolation. The health-state
// ladder is evaluated in priority order so the most action-relevant state wins.
function deriveHealth(state, facts, lifecycle) {
  const stage = superFocus.inferStage(state);
  const health_state = classify(facts, lifecycle);
  const next_safe_action = nextSafeAction(facts, health_state, stage, lifecycle);
  return {
    lifecycle: lifecycle === 'archived' ? 'archived' : 'active',
    readable: true,
    stage,
    stage_label: stageLabel(stage),
    health_state,
    health_label: HEALTH_STATES[health_state] || 'In progress',
    facts,
    next_safe_action,
    summary_line: summaryLine(facts, stage, lifecycle),
  };
}

function classify(facts, lifecycle) {
  if (lifecycle === 'archived') return 'archived';
  // Recovery: a partial/interrupted operation left artifacts inconsistent.
  if ((facts.failed_video_count || 0) > 0) return 'recovery_needed';
  if ((facts.missing_file_image_count || 0) > 0) return 'recovery_needed';
  // Review: something upstream changed after a derived asset existed.
  if ((facts.stale_image_count || 0) > 0) return 'needs_review';
  if ((facts.stale_video_count || 0) > 0) return 'needs_review';
  if (facts.script_eval_status === 'stale') return 'needs_review';
  // Blocked: work is stalled behind an operator-paused queue.
  if (facts.queue_state === 'paused') return 'blocked';
  // Healthy: the media spine is complete AND current — established from BOTH
  // upstream prompts and current disk, never from downstream files alone. A
  // project with no eligible video rows yet is never "Healthy" (it is still
  // in progress toward that point).
  if (isSpineComplete(facts)) return 'healthy';
  return 'in_progress';
}

// Complete-and-current requires: media readable, images present for every image
// prompt, at least one eligible video row, every eligible video done, and no
// staleness or script-eval drift. Unknown-provenance clips are allowed (not
// flagged) but they do not, by themselves, satisfy completion because a clip
// only counts as done when it exists AND its upstream is intact.
function isSpineComplete(facts) {
  if (!facts.media_available) return false;
  if (facts.script_eval_status === 'stale') return false;
  if ((facts.image_prompt_count || 0) === 0) return false;
  if (facts.image_count == null || facts.image_count < facts.image_prompt_count) return false;
  if ((facts.video_total || 0) === 0) return false;
  if (facts.video_count !== facts.video_total) return false;
  if ((facts.stale_video_count || 0) > 0) return false;
  if ((facts.stale_image_count || 0) > 0) return false;
  return true;
}

// Conservative, workflow-named guidance. It never asserts a disk fact it could
// not read (media_available === false → guidance stays stage-based), never
// claims readiness for publish, and prefers "review/confirm" verbs when
// evidence is ambiguous.
function nextSafeAction(facts, health_state, stage, lifecycle) {
  if (lifecycle === 'archived') {
    return 'Archived. Open to inspect, or restore it to the normal project list to continue.';
  }
  if (health_state === 'recovery_needed') {
    if ((facts.failed_video_count || 0) > 0) {
      return 'Review the failed or interrupted renders in Video Review, then re-queue those clips.';
    }
    return 'Some images are recorded as generated but missing on disk. Regenerate them in Image Review.';
  }
  if (health_state === 'needs_review') {
    if ((facts.stale_video_count || 0) > 0) {
      return 'Review clips flagged stale (their motion prompt changed) and regenerate what no longer matches.';
    }
    if ((facts.stale_image_count || 0) > 0) {
      return 'Review images flagged stale (their prompt changed) and regenerate what no longer matches.';
    }
    return 'Re-run the script evaluation — the script changed since it was last evaluated.';
  }
  if (health_state === 'blocked') {
    return 'The video queue is paused. Resume it to finish rendering the queued clips.';
  }
  if (health_state === 'healthy') {
    return 'All eligible clips are rendered and current. Review them and prepare the Resolve handoff.';
  }
  // in_progress — forward step by furthest verifiable evidence.
  if (!facts.script_saved) return 'Write the script.';
  if ((facts.image_prompt_count || 0) === 0) return 'Generate image prompts from the script.';
  if (!facts.media_available) {
    return 'Continue in the project — media evidence is unavailable, so open it to see per-asset status.';
  }
  if (facts.image_count != null && facts.image_count < facts.image_prompt_count) {
    return 'Generate the remaining B-roll images.';
  }
  if ((facts.i2v_prompt_count || 0) === 0) {
    return 'Write the image-to-video motion prompts for the generated stills.';
  }
  if ((facts.video_total || 0) === 0) {
    return 'No clips are eligible yet — each clip needs both a still and a saved motion prompt.';
  }
  if (facts.video_count != null && facts.video_count < facts.video_total) {
    return 'Queue the remaining eligible clips for video generation.';
  }
  return 'Continue in the project.';
}

// Compact, human one-liner for the picker row. Skips unknowns and zero-noise.
function summaryLine(facts, stage, lifecycle) {
  const parts = [];
  parts.push(stageLabel(stage));
  if ((facts.image_prompt_count || 0) > 0) parts.push(`${facts.image_prompt_count} prompt${plural(facts.image_prompt_count)}`);
  if (!facts.media_available) {
    parts.push('media evidence unavailable');
  } else {
    if ((facts.image_count || 0) > 0) parts.push(`${facts.image_count} image${plural(facts.image_count)}`);
    if ((facts.video_count || 0) > 0) parts.push(`${facts.video_count} video${plural(facts.video_count)}`);
    const stale = (facts.stale_image_count || 0) + (facts.stale_video_count || 0);
    if (stale > 0) parts.push(`${stale} stale`);
    if ((facts.failed_video_count || 0) > 0) parts.push(`${facts.failed_video_count} failed`);
    if (facts.queue_state === 'active') parts.push('queue active');
    else if (facts.queue_state === 'paused') parts.push('queue paused');
  }
  if (lifecycle === 'archived') parts.unshift('Archived');
  return parts.join(' · ');
}

function plural(n) { return n === 1 ? '' : 's'; }

// ── Single-project health ─────────────────────────────────────────────────────
// Loads canonical state lifecycle-aware, gathers cheap disk evidence, derives.
// Throws the same 404 (missing) / 422 (corrupt) as loadProject so the single
// endpoint can map them to controlled errors.
function computeProjectHealth(projectId, options = {}) {
  const id = superFocus.assertValidProjectId(projectId);
  const lifecycle = superFocus.projectLifecycle(id, { root: options.sfRoot || options.root });
  const state = superFocus.loadProject(id, { root: options.sfRoot || options.root });
  const facts = gatherEvidence(id, state, options);
  const health = deriveHealth(state, facts, lifecycle);
  return Object.assign({ project_id: state.project_id || id, title: state.title || '', updated_at: state.updated_at || '' }, health);
}

// An unreadable/corrupt project row: surfaced, never omitted, never repaired.
function unreadableRow(projectId, lifecycle, error) {
  return {
    project_id: projectId,
    title: '',
    updated_at: '',
    lifecycle: lifecycle === 'archived' ? 'archived' : 'active',
    readable: false,
    stage: null,
    stage_label: null,
    health_state: 'unreadable',
    health_label: HEALTH_STATES.unreadable,
    facts: null,
    next_safe_action: 'Project state could not be read. Recovery inspection required before it can be opened.',
    summary_line: 'Project state could not be read. Recovery inspection required.',
    error: error && error.message ? String(error.message).slice(0, 200) : 'unreadable',
  };
}

// ── Aggregate health ──────────────────────────────────────────────────────────
// Scans one lifecycle root. UNLIKE super-focus.listProjects (which silently
// skips corrupt entries), this includes every project-id-named directory that
// carries a state file, emitting an unreadable row for any that fail to parse —
// so a corrupt project can still be seen and recovered from the picker. Order
// mirrors listProjects: readable rows newest-first by updated_at, with
// unreadable rows appended (name-sorted) so they never hide behind a sort key
// they cannot supply.
function scanHealthRoot(root, lifecycle, options = {}) {
  if (!fs.existsSync(root)) return [];
  const readable = [];
  const unreadable = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!superFocus.PROJECT_ID_RE.test(entry.name)) continue;
    const stateFile = path.join(root, entry.name, superFocus.STATE_FILENAME);
    if (!fs.existsSync(stateFile)) continue;
    try {
      readable.push(computeProjectHealth(entry.name, options));
    } catch (err) {
      unreadable.push(unreadableRow(entry.name, lifecycle, err));
    }
  }
  readable.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  unreadable.sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)));
  return readable.concat(unreadable);
}

function listProjectsHealth(options = {}) {
  const sfRoot = options.sfRoot || options.root;
  return {
    active: scanHealthRoot(superFocus.resolveRoot({ root: sfRoot }), 'active', options),
    archived: scanHealthRoot(superFocus.resolveArchivedRoot({ root: sfRoot }), 'archived', options),
  };
}

module.exports = {
  HEALTH_STATES,
  STAGE_LABELS,
  stageLabel,
  countImagePrompts,
  countInfographicPrompts,
  countI2vPrompts,
  gatherEvidence,
  scriptEvalStatus,
  deriveHealth,
  classify,
  isSpineComplete,
  nextSafeAction,
  summaryLine,
  computeProjectHealth,
  unreadableRow,
  scanHealthRoot,
  listProjectsHealth,
};
