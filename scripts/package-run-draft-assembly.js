#!/usr/bin/env node
'use strict';

/*
 * DRAFT ASSEMBLY V0 — the first path that turns an approved script, generated
 * narration, generated visuals and an approved music bed into ONE WATCHABLE
 * FILE, automatically.
 *
 * Until this existed the estate could plan an episode, generate every asset,
 * verify each one, and still have nothing anybody could watch. Gate 9
 * (rough-cut review) had nothing to review, because every path to a rough cut
 * ended at a human opening Resolve. Editor V1 is explicit that it "never renders
 * media"; Edit Plan V1 is a timeline authority with no renderer beneath it.
 * This module is that missing renderer, and only that.
 *
 * OWNERSHIP, stated the way the narration lane states it, because the same
 * confusion is available here:
 *
 *   semantic producer   editor           — the agent that owns gate 9
 *   technical producer  ffmpeg-draft-assembler v0
 *   attester            this module, deterministically
 *
 * WHAT A DRAFT V1 IS: a deterministic assembly of already-verified assets on
 * the narration's own measured timing, adequate for judging story, pacing,
 * visual support, section length and whether the music helps.
 *
 * WHAT IT IS NOT, and may never be recorded as: an edit, an approved rough cut,
 * a production cut, a mix, a colour pass, a Resolve timeline, or anything
 * publishable. It contains DRAFT proxy narration, so it inherits every boundary
 * that narration already declares.
 *
 * A rendered Draft V1 does not complete gate 9. It makes gate 9 ACTIONABLE:
 * the human review that closes the gate now has something to watch.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const productionMode = require('./package-run-production-mode.js');
const storyBinding = require('./package-run-story-binding.js');
const visualPlanningTask = require('./agent-task-visual-planning.js');
const narrationModule = require('./package-run-draft-narration.js');
const proxyCapture = require('./draft-proxy-capture-readiness.js');
const bindingModule = require('./draft-assembly-binding.js');
const timeline = require('./draft-assembly-timeline.js');
const renderModule = require('./draft-assembly-render.js');

const PLAN_FILE = 'draft-assembly-plan.json';
const STATE_FILE = 'draft-assembly-state.json';
const MANIFEST_FILE = 'draft-assembly.json';
const EVIDENCE_FILE = 'draft-assembly-evidence.json';

const PLAN_SCHEMA = timeline.PLAN_SCHEMA;
const STATE_SCHEMA = 'vidtoolz.draftAssemblyState.v1';
const MANIFEST_SCHEMA = 'vidtoolz.draftAssembly.v1';
const EVIDENCE_SCHEMA = 'vidtoolz.draftAssemblyEvidence.v1';

// A new typed evidence kind. Deliberately not AUDIO_RENDER, not VIDEO_RENDER and
// not any production class: those assert a finished mix or a finished edit, and
// carry no field in which a draft could declare itself a draft.
const EVIDENCE_KIND = 'DRAFT_ASSEMBLY';
const FIDELITY = 'DRAFT_AUTOMATED_ASSEMBLY';
const SEMANTIC_PRODUCER = 'editor';
const ATTESTER = 'package-run-draft-assembly.js';

const MEDIA_DIR = path.join('media', 'draft-assembly');
const WORK_DIR = path.join(MEDIA_DIR, 'work');

// Lifecycle states for one assembly attempt. PLANNED and RENDERING both mean
// "not watchable"; only COMPLETE names a validated file.
const STATES = Object.freeze(['PLANNED', 'RENDERING', 'COMPLETE', 'FAILED']);

const IS_NOT = Object.freeze([
  'an approved rough cut',
  'a production edit',
  'a final mix',
  'a colour or sound pass',
  'a Resolve timeline',
  'publishable media',
]);

class DraftAssemblyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftAssemblyError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftAssemblyError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function writeJson(target, value) {
  atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file, schema, code) {
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fail(code, `${path.basename(file)} is not valid JSON`); }
  if (schema && parsed?.schema !== schema) {
    fail(code, `${path.basename(file)} schema is not ${schema}`);
  }
  return parsed;
}

function relative(runDir, absolute) {
  return path.relative(runDir, absolute).replace(/\\/g, '/');
}

/* ------------------------------------------------------------ eligibility -- */

/*
 * Can this run be assembled right now?
 *
 * Every condition here is owned by something else. Assembly asks the mode model
 * whether this is a DRAFT, the narration lane whether the voice is verified and
 * still bound to the Story, the proxy-capture contract whether gate 8's
 * disposition was actually earned, and the binding whether its assets still
 * hash as recorded. It invents no approval of its own, and it cannot pass a run
 * that the lifecycle has not already carried this far.
 */
function assemblyEligibility(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const blockers = [];
  const report = {
    run_id: path.basename(runDir),
    run_dir: runDir,
    mode: null,
    story: null,
    story_approval_state: null,
    narration: { present: false, valid: false, detail: null },
    proxy_capture: { disposition: null, ready: false },
    binding: { present: false, valid: false, detail: null },
    renderer: null,
    eligible: false,
    blockers,
  };

  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    blockers.push(`package run folder not found: ${runDirInput}`);
    return report;
  }

  try { report.mode = productionMode.readProductionMode(runDir).mode; }
  catch (error) { report.mode = productionMode.MODE_UNSPECIFIED; }
  if (report.mode !== productionMode.DRAFT) {
    // Fails closed for MODE_UNSPECIFIED on purpose: assembling a run that might
    // be a real production would present proxy narration as production audio.
    blockers.push(`draft assembly is DRAFT-only; this run declares ${report.mode}`);
  }

  try {
    const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
    report.story = { project_id: bound.projectId, version_id: bound.versionId, content_hash: bound.contentHash };
    try {
      const loaded = visualPlanningTask.loadCanonicalStory({
        scriptBuilderRoot: bound.scriptBuilderRoot,
        projectId: bound.projectId,
        versionId: bound.versionId,
      });
      report.story_approval_state = loaded.story.approval?.state ?? null;
      report.output_class = loaded.project.output_class || null;
      report.story_title = loaded.project.title || null;
    } catch (error) {
      blockers.push(`canonical Story could not be loaded: ${error.message}`);
    }
  } catch (error) {
    blockers.push(`no bound Story: ${error.message}`);
  }

  const narrationStatus = narrationModule.narrationStatus(runDir, options);
  report.narration = {
    present: narrationStatus.present,
    valid: narrationStatus.valid,
    code: narrationStatus.code ?? null,
    detail: narrationStatus.detail ?? null,
    duration_seconds: narrationStatus.evidence?.assembled?.duration_seconds ?? null,
  };
  if (!narrationStatus.present) blockers.push('no draft narration has been produced; there is no timing spine to assemble on');
  else if (!narrationStatus.valid) blockers.push(`draft narration is not valid (${narrationStatus.code}): ${narrationStatus.detail}`);

  try {
    const capture = proxyCapture.draftProxyCaptureReadiness(runDir, options);
    report.proxy_capture = { disposition: capture.disposition, ready: capture.disposition === proxyCapture.CAPTURE_READY };
    if (!report.proxy_capture.ready) {
      blockers.push(`gate 8 proxy capture is not ready (${capture.disposition}); assembly may not run ahead of capture`);
    }
  } catch (error) {
    report.proxy_capture = { disposition: null, ready: false, detail: error.message };
    blockers.push(`proxy capture readiness could not be determined: ${error.message}`);
  }

  const bindingStatus = bindingModule.bindingStatus(runDir);
  report.binding = {
    present: bindingStatus.present,
    valid: bindingStatus.valid,
    code: bindingStatus.code ?? null,
    detail: bindingStatus.detail ?? null,
    visual_count: bindingStatus.resolved?.visuals?.length ?? 0,
    music_present: Boolean(bindingStatus.resolved?.music),
  };
  if (!bindingStatus.present) blockers.push(`no ${bindingModule.BINDING_FILE}; nothing declares which visuals and music this draft uses`);
  else if (!bindingStatus.valid) blockers.push(`draft assembly binding is not usable (${bindingStatus.code}): ${bindingStatus.detail}`);

  const renderer = renderModule.rendererReadiness();
  report.renderer = { renderer: renderer.renderer, version: renderer.version, actionable: renderer.actionable, blockers: renderer.blockers };
  if (!renderer.actionable) blockers.push(`renderer not actionable: ${renderer.blockers.join('; ')}`);

  report.eligible = blockers.length === 0;
  return report;
}

/* ------------------------------------------------------------------ plan --- */

/*
 * Probe every bound asset, then hand pure data to the planner. Probing lives
 * here rather than in the planner so the plan stays a function of measurements
 * rather than of the filesystem.
 */
function buildAssemblyPlan(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const eligibility = assemblyEligibility(runDir, options);
  if (!eligibility.eligible) {
    const error = new DraftAssemblyError('DRAFT_ASSEMBLY_NOT_ELIGIBLE',
      `run is not eligible for draft assembly: ${eligibility.blockers.join('; ')}`);
    error.eligibility = eligibility;
    throw error;
  }

  const resolved = bindingModule.resolveBinding(runDir);
  const narration = narrationModule.readManifest(runDir);

  const visuals = resolved.visuals.map((asset) => ({
    ...asset,
    probe: renderModule.probeMedia(asset.absolute_path),
  }));
  const music = resolved.music
    ? { ...resolved.music, probe: renderModule.probeMedia(resolved.music.absolute_path) }
    : null;

  if (music && !music.probe.has_audio) {
    fail('DRAFT_ASSEMBLY_MUSIC_NOT_AUDIO', 'the bound music asset carries no audio stream');
  }
  for (const asset of visuals) {
    if (!asset.probe.has_video) {
      fail('DRAFT_ASSEMBLY_VISUAL_NOT_VISUAL', `bound visual ${asset.asset_id} carries no image or video stream`);
    }
  }

  const plan = timeline.planDraftTimeline({
    runId: path.basename(runDir),
    story: eligibility.story,
    storyApprovalState: eligibility.story_approval_state,
    narration,
    visuals,
    music,
    output: resolved.binding.output,
    outputClass: eligibility.output_class,
    policy: resolved.binding.policy,
  });

  // The plan records where each asset lives so a later reader does not have to
  // re-resolve the binding to know what was used.
  plan.sources = {
    visual_root: resolved.binding.visuals.root,
    visual_source_kind: resolved.binding.visuals.source_kind,
    music_root: resolved.music ? resolved.music.root : null,
    music_source_kind: resolved.music ? resolved.music.source_kind : null,
    binding_file: bindingModule.BINDING_FILE,
    binding_sha256: sha256File(bindingModule.bindingPath(runDir)),
  };
  return { plan, resolved, narration, eligibility };
}

/* ----------------------------------------------------------------- state --- */

function readState(runDir) {
  return readJson(path.join(path.resolve(runDir), STATE_FILE), STATE_SCHEMA, 'DRAFT_ASSEMBLY_STATE_UNREADABLE');
}

function emptyState(runId) {
  return { schema: STATE_SCHEMA, run_id: runId, state: null, plan_digest_sha256: null, draft_version: null, updated_at: null, attempt: 0, last_error: null, history: [] };
}

function writeState(runDir, state) {
  writeJson(path.join(path.resolve(runDir), STATE_FILE), state);
}

/*
 * Which draft version does this plan get?
 *
 * A plan that has already completed keeps its version — rerunning an unchanged
 * assembly must not invent a v2 that is byte-identical to v1. A plan that
 * differs from every completed one gets the next number, so a reviewer's note
 * on "v1" can never silently refer to different pictures.
 */
function versionForPlan(state, planDigest) {
  const existing = (state.history || []).find((entry) => entry.plan_digest_sha256 === planDigest);
  if (existing) return existing.draft_version;
  const highest = (state.history || []).reduce((max, entry) => Math.max(max, Number(entry.draft_version) || 0), 0);
  return highest + 1;
}

function draftFileName(version) { return `draft-v${version}.mp4`; }

/* --------------------------------------------------------------- assemble -- */

/*
 * Plan, render, validate, record. Safe to rerun: an unchanged plan whose output
 * still validates is reported as reused rather than re-rendered, and a changed
 * plan renders a new version rather than overwriting the one someone may be
 * reviewing.
 */
function buildDraftAssembly(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const runId = path.basename(runDir);
  const { plan, resolved, narration, eligibility } = buildAssemblyPlan(runDir, options);

  const state = readState(runDir) || emptyState(runId);
  const version = versionForPlan(state, plan.plan_digest_sha256);
  const mediaDir = path.join(runDir, MEDIA_DIR);
  const workDir = path.join(runDir, WORK_DIR);
  const targetPath = path.join(mediaDir, draftFileName(version));

  writeJson(path.join(runDir, PLAN_FILE), plan);

  // Reuse path: same plan, output present, output still valid. Cheap to check
  // and it is the difference between a resumable pipeline and one that redoes
  // twenty minutes of encoding because someone pressed the button twice.
  if (!options.force && fs.existsSync(targetPath)) {
    const validation = renderModule.validateDraft(targetPath, plan);
    if (validation.ok) {
      const manifest = readManifest(runDir);
      if (manifest && manifest.plan_digest_sha256 === plan.plan_digest_sha256
        && manifest.output.sha256 === sha256File(targetPath)) {
        return { manifest, plan, path: path.join(runDir, MANIFEST_FILE), reused: true, rendered: false };
      }
    }
  }

  writeState(runDir, {
    ...state,
    state: 'RENDERING',
    plan_digest_sha256: plan.plan_digest_sha256,
    draft_version: version,
    attempt: (Number(state.attempt) || 0) + 1,
    updated_at: new Date().toISOString(),
    last_error: null,
  });

  const sourceById = new Map(resolved.visuals.map((asset) => [asset.asset_id, asset.absolute_path]));
  let render;
  try {
    render = renderModule.renderDraft({
      plan,
      workDir,
      targetPath,
      narrationPath: path.join(runDir, narration.assembled.audio_path),
      musicPath: resolved.music ? resolved.music.absolute_path : null,
      sourceFor: (segment) => sourceById.get(segment.visual.asset_id),
      onProgress: options.onProgress,
    });
  } catch (error) {
    writeState(runDir, {
      ...readState(runDir),
      state: 'FAILED',
      updated_at: new Date().toISOString(),
      last_error: { code: error.code || 'DRAFT_RENDER_FAILED', message: String(error.message).slice(0, 500) },
    });
    throw error;
  }

  const manifest = composeManifest({ runDir, runId, version, plan, resolved, narration, eligibility, render });
  writeJson(path.join(runDir, MANIFEST_FILE), manifest);

  const current = readState(runDir);
  const history = (current.history || []).filter((entry) => entry.plan_digest_sha256 !== plan.plan_digest_sha256);
  history.push({
    draft_version: version,
    plan_digest_sha256: plan.plan_digest_sha256,
    output_path: relative(runDir, targetPath),
    output_sha256: render.output_sha256,
    duration_seconds: plan.timeline.total_duration_seconds,
    completed_at: new Date().toISOString(),
  });
  writeState(runDir, {
    ...current,
    state: 'COMPLETE',
    plan_digest_sha256: plan.plan_digest_sha256,
    draft_version: version,
    updated_at: new Date().toISOString(),
    last_error: null,
    history: history.sort((a, b) => a.draft_version - b.draft_version),
  });

  return { manifest, plan, path: path.join(runDir, MANIFEST_FILE), reused: false, rendered: true };
}

/*
 * The assembly manifest: enough to reconstruct exactly what was used without
 * reading a terminal, and enough to refuse to believe it later if any byte moved.
 */
function composeManifest({ runDir, runId, version, plan, resolved, narration, eligibility, render }) {
  const targetPath = path.join(runDir, MEDIA_DIR, draftFileName(version));
  return {
    schema: MANIFEST_SCHEMA,
    run_id: runId,
    draft_version: version,
    production_mode: productionMode.DRAFT,
    fidelity: FIDELITY,
    purpose: 'automatically assembled DRAFT V1 for human structural review',
    is_not: IS_NOT,
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: { renderer: render.renderer.renderer, version: render.renderer.version, ffmpeg_version: render.renderer.ffmpeg_version },
    attested_by: ATTESTER,

    script: {
      source_system: 'vidtoolz-script-builder',
      project_id: plan.story.project_id,
      version_id: plan.story.version_id,
      content_hash: plan.story.content_hash,
      approval_state: plan.story.approval_state,
      title: eligibility.story_title ?? null,
    },
    narration: {
      manifest_file: narrationModule.MANIFEST_FILE,
      manifest_sha256: sha256File(path.join(runDir, narrationModule.MANIFEST_FILE)),
      evidence_kind: narrationModule.EVIDENCE_KIND,
      fidelity: narration.fidelity,
      voice: narration.voice,
      audio_path: narration.assembled.audio_path,
      audio_sha256: narration.assembled.audio_sha256,
      duration_seconds: narration.assembled.duration_seconds,
      sample_rate: narration.assembled.sample_rate,
      is_presenter_voice: false,
    },
    visuals: {
      source_kind: plan.sources.visual_source_kind,
      root: plan.sources.visual_root,
      assets: resolved.visuals.map((asset) => ({
        asset_id: asset.asset_id,
        kind: asset.kind,
        relative_path: asset.relative_path,
        sha256: asset.sha256,
        bytes: asset.bytes,
        description: asset.description ?? null,
      })),
    },
    music: resolved.music
      ? {
        present: true,
        source_kind: resolved.music.source_kind,
        root: resolved.music.root,
        relative_path: resolved.music.relative_path,
        sha256: resolved.music.sha256,
        variant: resolved.music.variant,
        provenance_file: resolved.music.provenance_file,
        provenance_sha256: resolved.music.provenance_sha256,
        gain_db: plan.music.gain_db,
        fill: plan.music.fill,
      }
      : { present: false },

    binding: { file: plan.sources.binding_file, sha256: plan.sources.binding_sha256 },
    plan_file: PLAN_FILE,
    plan_digest_sha256: plan.plan_digest_sha256,
    render_settings: plan.output,
    policy: plan.policy,
    timeline: plan.timeline,
    segments: plan.segments.map((segment) => ({
      order: segment.order,
      section_id: segment.section_id,
      beat: segment.beat,
      beat_source: segment.beat_source ?? null,
      start_seconds: segment.start_seconds,
      end_seconds: segment.end_seconds,
      duration_seconds: segment.duration_seconds,
      visual_asset_id: segment.visual.asset_id,
      visual_sha256: segment.visual.sha256,
      visual_kind: segment.visual.kind,
      fill: segment.visual.fill,
      reused_visual: segment.visual.reused,
    })),

    output: {
      path: relative(runDir, targetPath),
      sha256: render.output_sha256,
      bytes: render.bytes,
      container: plan.output.container,
      probe: render.validation.probe,
    },
    render_report: {
      segments_rendered: render.segments.length,
      segments_reused: render.reused_segments,
      validation: {
        ok: render.validation.ok,
        decode_pass: render.validation.decode_ok,
        failures: render.validation.failures,
      },
      segment_files: render.segments,
    },

    warnings: plan.warnings,
    placeholders_used: [],
    missing_or_failed_assets: [],
    lineage: {
      // Assembly consumes capture and precedes human rough-cut review. Naming
      // both ends keeps a draft from being read as the start of the workflow.
      predecessors: [
        { kind: narrationModule.EVIDENCE_KIND, file: narrationModule.EVIDENCE_FILE },
        { kind: 'PROXY_CAPTURE_READY', disposition: eligibility.proxy_capture.disposition },
      ],
      successors: [
        { gate: 'rough-cut-review', requires: 'human watch notes by mikko', satisfied_by_this_artifact: false },
      ],
      supersedes: version > 1 ? `draft-v${version - 1}.mp4` : null,
    },
    approval: {
      state: 'UNREVIEWED',
      human_approval_present: false,
      note: 'a rendered draft is material for review, never a review outcome',
    },
    created_at: new Date().toISOString(),
  };
}

function readManifest(runDir) {
  return readJson(path.join(path.resolve(runDir), MANIFEST_FILE), MANIFEST_SCHEMA, 'DRAFT_ASSEMBLY_MANIFEST_UNREADABLE');
}

function readPlan(runDir) {
  return readJson(path.join(path.resolve(runDir), PLAN_FILE), PLAN_SCHEMA, 'DRAFT_ASSEMBLY_PLAN_UNREADABLE');
}

/* ----------------------------------------------------------------- attest -- */

/*
 * Re-verify from bytes, never from the manifest's own claims. A manifest that
 * says the draft is 94 seconds long is not evidence that it is.
 */
function attestDraftAssembly(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const manifest = readManifest(runDir);
  if (!manifest) fail('DRAFT_ASSEMBLY_MANIFEST_MISSING', `${MANIFEST_FILE} not found; nothing to attest`);
  if (manifest.run_id !== path.basename(runDir)) {
    fail('DRAFT_ASSEMBLY_MANIFEST_RUN_MISMATCH', `${MANIFEST_FILE} was recorded for run ${manifest.run_id}`);
  }

  const drift = [];
  const checks = [];

  // Upstream: the narration must still be the one this draft speaks.
  const narrationStatus = narrationModule.narrationStatus(runDir, options);
  if (!narrationStatus.present) drift.push('draft narration is missing');
  else if (!narrationStatus.valid) drift.push(`draft narration is no longer valid (${narrationStatus.code})`);
  else if (narrationStatus.evidence.assembled.audio_sha256 !== manifest.narration.audio_sha256) {
    drift.push('draft narration was re-rendered after this draft was assembled');
  }

  // Upstream: the bound assets must still hash as they did.
  const bindingStatus = bindingModule.bindingStatus(runDir);
  if (!bindingStatus.present) drift.push('draft assembly binding is missing');
  else if (!bindingStatus.valid) drift.push(`draft assembly binding is no longer valid (${bindingStatus.code}): ${bindingStatus.detail}`);
  else {
    const bindingSha = sha256File(bindingModule.bindingPath(runDir));
    if (bindingSha !== manifest.binding.sha256) drift.push('the binding changed after this draft was assembled');
  }

  // The plan must still be the plan that produced these bytes.
  const plan = (() => { try { return readPlan(runDir); } catch (_) { return null; } })();
  if (!plan) checks.push(`${PLAN_FILE} is missing or unreadable`);
  else if (plan.plan_digest_sha256 !== manifest.plan_digest_sha256) drift.push('the assembly plan changed after this draft was rendered');

  // The artifact itself.
  const outputPath = path.join(runDir, manifest.output.path);
  let validation = null;
  if (!fs.existsSync(outputPath)) checks.push('rendered draft is missing');
  else if (fs.statSync(outputPath).size === 0) checks.push('rendered draft is zero bytes');
  else {
    if (sha256File(outputPath) !== manifest.output.sha256) checks.push('rendered draft hash does not match the manifest');
    if (plan) {
      validation = renderModule.validateDraft(outputPath, plan);
      if (!validation.ok) checks.push(...validation.failures);
    }
  }

  const valid = drift.length === 0 && checks.length === 0;
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    kind: EVIDENCE_KIND,
    fidelity: FIDELITY,
    production_mode: productionMode.DRAFT,
    asserts: 'a real, decodable, duration-verified video file was assembled deterministically from the exact recorded assets',
    does_not_assert: [
      'edit quality',
      'production readiness',
      'approved rough cut',
      'mix quality or loudness compliance',
      'visual approval',
      'publish readiness',
    ],
    satisfies_real_capture: false,
    completes_rough_cut_gate: false,
    human_authority_required: true,
    human_authority_note: 'gate 9 closes on Mikko\'s watch notes; this artifact is what he watches',
    run_id: manifest.run_id,
    draft_version: manifest.draft_version,
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: manifest.technical_producer,
    attested_by: ATTESTER,
    script: manifest.script,
    narration: { audio_sha256: manifest.narration.audio_sha256, fidelity: manifest.narration.fidelity, is_presenter_voice: false },
    assembly_manifest: { file: MANIFEST_FILE, sha256: sha256File(path.join(runDir, MANIFEST_FILE)) },
    output: {
      path: manifest.output.path,
      sha256: manifest.output.sha256,
      bytes: manifest.output.bytes,
      duration_seconds: manifest.output.probe?.duration_seconds ?? null,
      width: manifest.output.probe?.width ?? null,
      height: manifest.output.probe?.height ?? null,
      fps: manifest.output.probe?.fps ?? null,
      has_audio: manifest.output.probe?.has_audio ?? null,
    },
    technical_validation: {
      ok: checks.length === 0,
      failures: checks,
      decode_pass: validation ? validation.decode_ok : null,
    },
    source_binding: { ok: drift.length === 0, drift },
    warnings: manifest.warnings,
    state: valid ? 'VERIFIED' : 'INVALID',
  };
  if (!options.dryRun) {
    writeJson(path.join(runDir, EVIDENCE_FILE), evidence);
  }
  return evidence;
}

function readEvidence(runDir) {
  const file = path.join(path.resolve(runDir), EVIDENCE_FILE);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
  return parsed?.schema === EVIDENCE_SCHEMA ? parsed : null;
}

/*
 * Is this run's Draft V1 currently valid? Re-verifies rather than trusting the
 * recorded state, so a re-narrated script or a mutated byte makes it stale.
 */
function draftAssemblyStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const state = (() => { try { return readState(runDir); } catch (_) { return null; } })();
  const manifest = (() => { try { return readManifest(runDir); } catch (_) { return null; } })();
  if (!manifest) {
    return {
      present: false, valid: false, state: state?.state ?? null,
      code: 'DRAFT_ASSEMBLY_MISSING', detail: 'no draft has been assembled for this run', draft_path: null,
    };
  }
  let evidence;
  try { evidence = attestDraftAssembly(runDir, { ...options, dryRun: true }); }
  catch (error) {
    return { present: true, valid: false, state: state?.state ?? null, code: error.code || 'DRAFT_ASSEMBLY_INVALID', detail: error.message, draft_path: manifest.output.path };
  }
  if (evidence.state !== 'VERIFIED') {
    const detail = [...evidence.source_binding.drift, ...evidence.technical_validation.failures].join('; ');
    return {
      present: true, valid: false, state: state?.state ?? null,
      code: evidence.source_binding.ok ? 'DRAFT_ASSEMBLY_ARTIFACT_INVALID' : 'DRAFT_ASSEMBLY_SOURCE_DRIFT',
      detail, draft_path: manifest.output.path, evidence,
    };
  }
  return {
    present: true, valid: true, state: state?.state ?? null, code: null, detail: null,
    draft_path: manifest.output.path,
    draft_version: manifest.draft_version,
    duration_seconds: manifest.output.probe?.duration_seconds ?? null,
    evidence,
  };
}

/* -------------------------------------------------------------------- cli -- */

function usage() {
  return `Draft Assembly V0

Turns one DRAFT package run's approved script, generated narration, bound
visuals and bound music into one watchable MP4, deterministically.

Usage:
  node scripts/package-run-draft-assembly.js status  <run-dir>
  node scripts/package-run-draft-assembly.js plan    <run-dir>
  node scripts/package-run-draft-assembly.js build   <run-dir> [--force]
  node scripts/package-run-draft-assembly.js attest  <run-dir>
  node scripts/package-run-draft-assembly.js bind    <run-dir> [bind options]

Bind options:
  --visual-kind <AIGEN_RESOLVE_HANDOFF|AIGEN_SELECTED_IMAGES|EXPLICIT_ASSETS>
  --visual-package <dir>          aigen script-package directory
  --visual-asset <path>           repeatable; EXPLICIT_ASSETS only
  --music-project <dir>           Scorecraft score-project directory
  --music-variant <dialogue_safe|full>
  --music-asset <path>            explicit audio file instead of a score project
  --no-music                      assemble narration only
  --visual-shortfall <FAIL|CYCLE> what to do with fewer visuals than sections
  --transition <CUT|CROSSFADE>    default CUT
  --crossfade <seconds>           default 0.5
  --fit <FIT|COVER>               default FIT
  --no-slate                      omit the burned-in DRAFT / section / timecode slate
  --music-gain-db <db>            default -14
  --width <px> --height <px> --fps <n>   override the Story output class
  --bound-by <who>                default: current operator
  --replace                       rebind a run that already has a binding

A rendered draft NEVER completes gate 9 (rough-cut review). It is the material
that human review watches.
`;
}

function parseArgs(argv) {
  const args = { command: argv[0] || '', runDir: '', options: {}, visualAssets: [] };
  let i = 1;
  while (i < argv.length) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { args.help = true; i += 1; continue; }
    if (token === '--force') { args.options.force = true; i += 1; continue; }
    if (token === '--replace') { args.options.replace = true; i += 1; continue; }
    if (token === '--json') { args.options.json = true; i += 1; continue; }
    if (token === '--no-music') { args.options.noMusic = true; i += 1; continue; }
    if (token === '--no-slate') { args.options['no-slate'] = true; i += 1; continue; }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail('DRAFT_ASSEMBLY_CLI_INVALID', `${token} requires a value`);
      if (key === 'visual-asset') args.visualAssets.push(value);
      else args.options[key] = value;
      i += 2;
      continue;
    }
    if (!args.runDir) args.runDir = token;
    i += 1;
  }
  return args;
}

function bindFromArgs(args) {
  const runDir = path.resolve(args.runDir);
  const opts = args.options;
  const visualKind = opts['visual-kind'] || (args.visualAssets.length ? 'EXPLICIT_ASSETS' : 'AIGEN_RESOLVE_HANDOFF');
  const visuals = visualKind === 'EXPLICIT_ASSETS'
    ? { source_kind: visualKind, root: opts['visual-root'] || '/', assets: args.visualAssets }
    : { source_kind: visualKind, package_dir: opts['visual-package'] };
  if (visualKind !== 'EXPLICIT_ASSETS' && !opts['visual-package']) {
    fail('DRAFT_ASSEMBLY_CLI_INVALID', '--visual-package is required unless --visual-asset is used');
  }

  let music = null;
  if (!opts.noMusic) {
    if (opts['music-asset']) music = { source_kind: 'EXPLICIT_ASSET', path: opts['music-asset'] };
    else if (opts['music-project']) music = { source_kind: 'SCORECRAFT_APPROVED_MIX', project_dir: opts['music-project'], variant: opts['music-variant'] };
    else fail('DRAFT_ASSEMBLY_CLI_INVALID', 'bind requires --music-project, --music-asset, or --no-music');
  }

  const output = (opts.width || opts.height)
    ? { width: Number(opts.width), height: Number(opts.height), fps: Number(opts.fps || 30) }
    : null;

  const binding = bindingModule.buildBinding({
    runId: path.basename(runDir),
    boundBy: opts['bound-by'] || process.env.USER || 'operator',
    visuals,
    music,
    output,
    policy: {
      visual_shortfall: opts['visual-shortfall'],
      transition: opts.transition,
      crossfade_seconds: opts.crossfade,
      fit: opts.fit,
      music_gain_db: opts['music-gain-db'],
      review_slate: opts['no-slate'] ? false : undefined,
    },
    notes: opts.notes,
  });
  const file = bindingModule.writeBinding(runDir, binding, { replace: Boolean(opts.replace) });
  return { binding, file };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.command || args.help || args.command === 'help') {
    process.stdout.write(usage());
    return 0;
  }
  if (!args.runDir) {
    process.stderr.write(`${usage()}\nA package-run directory is required.\n`);
    return 2;
  }

  try {
    if (args.command === 'status') {
      const eligibility = assemblyEligibility(args.runDir);
      const status = draftAssemblyStatus(args.runDir);
      process.stdout.write(`${JSON.stringify({ eligibility, draft: status }, null, 2)}\n`);
      return status.valid || eligibility.eligible ? 0 : 1;
    }
    if (args.command === 'bind') {
      const { binding, file } = bindFromArgs(args);
      process.stdout.write(`${JSON.stringify({ wrote: file, visuals: binding.visuals.assets.length, music: Boolean(binding.music), policy: binding.policy }, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'plan') {
      const { plan } = buildAssemblyPlan(args.runDir);
      writeJson(path.join(path.resolve(args.runDir), PLAN_FILE), plan);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    }
    if (args.command === 'build') {
      const result = buildDraftAssembly(args.runDir, {
        force: Boolean(args.options.force),
        onProgress: (event) => {
          if (event.stage === 'segment') process.stderr.write(`  segment ${event.order}/${event.total}${event.reused ? ' (reused)' : ''}\n`);
          else process.stderr.write(`  ${event.stage}\n`);
        },
      });
      const evidence = attestDraftAssembly(args.runDir);
      process.stdout.write(`${JSON.stringify({
        draft_version: result.manifest.draft_version,
        output: result.manifest.output.path,
        duration_seconds: result.manifest.output.probe.duration_seconds,
        resolution: `${result.manifest.output.probe.width}x${result.manifest.output.probe.height}`,
        rendered: result.rendered,
        reused: result.reused,
        evidence_state: evidence.state,
        warnings: result.manifest.warnings.map((w) => `${w.code}: ${w.detail}`),
      }, null, 2)}\n`);
      return evidence.state === 'VERIFIED' ? 0 : 1;
    }
    if (args.command === 'attest') {
      const evidence = attestDraftAssembly(args.runDir);
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
      return evidence.state === 'VERIFIED' ? 0 : 1;
    }
    process.stderr.write(`Unknown command: ${args.command}\n\n${usage()}`);
    return 2;
  } catch (error) {
    process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    if (error.eligibility) process.stderr.write(`${JSON.stringify(error.eligibility, null, 2)}\n`);
    return 1;
  }
}

module.exports = {
  PLAN_FILE,
  STATE_FILE,
  MANIFEST_FILE,
  EVIDENCE_FILE,
  MANIFEST_SCHEMA,
  EVIDENCE_SCHEMA,
  STATE_SCHEMA,
  EVIDENCE_KIND,
  FIDELITY,
  SEMANTIC_PRODUCER,
  ATTESTER,
  MEDIA_DIR,
  WORK_DIR,
  STATES,
  DraftAssemblyError,
  assemblyEligibility,
  buildAssemblyPlan,
  buildDraftAssembly,
  composeManifest,
  readManifest,
  readPlan,
  readState,
  writeState,
  versionForPlan,
  draftFileName,
  attestDraftAssembly,
  readEvidence,
  draftAssemblyStatus,
  usage,
  main,
};

if (require.main === module) {
  process.exitCode = main();
}
