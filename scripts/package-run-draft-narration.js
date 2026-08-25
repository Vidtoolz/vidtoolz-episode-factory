'use strict';

/*
 * DRAFT synthetic narration for a package run: canonical script -> real speech.
 *
 * Two responsibilities, deliberately kept distinguishable:
 *
 *   buildDraftNarration    renders the audio and writes the narration manifest
 *   attestDraftNarration   emits the typed DRAFT_SYNTHETIC_NARRATION evidence
 *
 * The semantic producer is generation_supervisor. The technical producer is the
 * Piper adapter. The attestation is deterministic. Those are three different
 * things and the records say so, because attributing Piper speech to
 * sound_music_director merely because it is audio is how a draft proxy would
 * eventually be mistaken for a production mix.
 *
 * What this narration IS: verified machine speech representing the exact bound
 * Story version, adequate for a DRAFT rough cut, Scorecraft ducking and timing.
 *
 * What it is NOT, and must never be recorded as: Mikko's performance, real
 * presenter capture, production audio, a final mix, or publish-ready sound.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const storyBinding = require('./package-run-story-binding.js');
const visualPlanningTask = require('./agent-task-visual-planning.js');
const productionMode = require('./package-run-production-mode.js');
const provider = require('./synthetic-narration-provider.js');
const { probeAudio } = require('./audio-render-evidence.js');

const MANIFEST_FILE = 'draft-narration.json';
const MANIFEST_SCHEMA = 'vidtoolz.syntheticNarration.v1';
const EVIDENCE_FILE = 'draft-synthetic-narration-evidence.json';
const EVIDENCE_SCHEMA = 'vidtoolz.draftSyntheticNarrationEvidence.v1';

// The new typed evidence kind. Deliberately NOT AUDIO_RENDER: that class means a
// production mix and has no field in which a proxy could declare itself.
const EVIDENCE_KIND = 'DRAFT_SYNTHETIC_NARRATION';
const SEMANTIC_PRODUCER = 'generation_supervisor';
const ATTESTER = 'package-run-draft-narration.js';
const FIDELITY = 'DRAFT_SYNTHETIC_PROXY';

// Where narration lives inside a run. One directory, discoverable by path
// convention rather than by search.
const MEDIA_DIR = path.join('media', 'draft-narration');
const ASSEMBLED_NAME = 'narration.wav';

class DraftNarrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftNarrationError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftNarrationError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sha256Text(text) { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/* ------------------------------------------------------- spoken surface ---- */

/*
 * The spoken surface is the Story section's `dialogue`, and nothing else.
 * Headings, visual notes, media refs and framing presets are production
 * instructions: speaking them would narrate the stage directions.
 */
function extractSpokenSegments(story) {
  const sections = Array.isArray(story?.sections) ? story.sections : [];
  if (!sections.length) fail('NARRATION_STORY_EMPTY', 'canonical Story carries no sections');
  return sections
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((section, index) => ({
      order: index + 1,
      section_id: section.section_id,
      beat: section.beat ?? null,
      text: String(section.dialogue ?? '').trim(),
    }));
}

/* --------------------------------------------------------------- resolve --- */

/*
 * Narration may only be produced for a run that has explicitly declared DRAFT.
 * MODE_UNSPECIFIED fails closed: generating proxy speech for a run that might be
 * a real production would be exactly the confusion the mode model exists to stop.
 */
function resolveNarrationContext(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('NARRATION_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const mode = productionMode.readProductionMode(runDir);
  if (mode.mode !== productionMode.DRAFT) {
    fail('NARRATION_MODE_NOT_DRAFT',
      `synthetic narration is DRAFT-only; this run declares ${mode.mode}`);
  }

  // Exact bound Story, or nothing. No latest lookup, no title match.
  const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  const loaded = visualPlanningTask.loadCanonicalStory({
    scriptBuilderRoot: bound.scriptBuilderRoot,
    projectId: bound.projectId,
    versionId: bound.versionId,
  });
  const segments = extractSpokenSegments(loaded.story);
  const spoken = segments.filter((segment) => segment.text.length > 0);
  if (!spoken.length) fail('NARRATION_NO_SPOKEN_TEXT', 'no Story section carries dialogue to narrate');

  return {
    runDir,
    runId: path.basename(runDir),
    mode: mode.mode,
    story: {
      project_id: bound.projectId,
      version_id: bound.versionId,
      content_hash: bound.contentHash,
    },
    segments,
    spoken,
  };
}

/* ----------------------------------------------------------------- build --- */

function buildDraftNarration(runDirInput, options = {}) {
  const context = resolveNarrationContext(runDirInput, options);
  const readiness = provider.providerReadiness({ voice: options.voice });
  if (!readiness.actionable) {
    fail('NARRATION_PROVIDER_UNAVAILABLE', `provider not actionable: ${readiness.blockers.join('; ')}`);
  }

  const mediaDir = path.join(context.runDir, MEDIA_DIR);
  fs.mkdirSync(mediaDir, { recursive: true });

  const rendered = [];
  for (const segment of context.segments) {
    if (!segment.text) {
      // An intentionally silent beat is declared, never synthesized as silence.
      rendered.push({ ...segment, spoken: false, reason: 'section carries no dialogue', audio: null });
      continue;
    }
    const target = path.join(mediaDir, `segment-${String(segment.order).padStart(2, '0')}.wav`);
    const result = provider.renderSyntheticNarration({
      text: segment.text,
      outputPath: target,
      voice: options.voice,
      timeoutMs: options.timeoutMs,
    });
    rendered.push({ ...segment, spoken: true, reason: null, audio: result });
  }

  const spokenRendered = rendered.filter((entry) => entry.spoken);
  const assembledPath = path.join(mediaDir, ASSEMBLED_NAME);
  const assembled = assembleNarration(spokenRendered.map((entry) => entry.audio.audio_path), assembledPath, options);

  // Beat timing comes from measured per-segment durations, in render order.
  let cursor = 0;
  const segmentRecords = rendered.map((entry) => {
    if (!entry.spoken) {
      return {
        order: entry.order, section_id: entry.section_id, beat: entry.beat,
        spoken: false, reason: entry.reason,
        source_text_sha256: null, audio_path: null, audio_sha256: null,
        duration_seconds: 0, start_seconds: cursor, end_seconds: cursor,
      };
    }
    const start = cursor;
    const end = start + entry.audio.duration_seconds;
    cursor = end;
    return {
      order: entry.order,
      section_id: entry.section_id,
      beat: entry.beat,
      spoken: true,
      reason: null,
      source_text: entry.text,
      source_text_sha256: entry.audio.source_text_sha256,
      audio_path: path.relative(context.runDir, entry.audio.audio_path).replace(/\\/g, '/'),
      audio_sha256: entry.audio.audio_sha256,
      duration_seconds: entry.audio.duration_seconds,
      start_seconds: Number(start.toFixed(6)),
      end_seconds: Number(end.toFixed(6)),
      request_digest: entry.audio.request_digest,
    };
  });

  const manifest = {
    schema: MANIFEST_SCHEMA,
    run_id: context.runId,
    production_mode: productionMode.DRAFT,
    fidelity: FIDELITY,
    purpose: 'temporary proxy narration for a DRAFT rough cut',
    is_not: ['mikko performance', 'real presenter capture', 'production audio', 'final mix', 'publish-ready audio'],
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: { provider: readiness.provider, version: readiness.version },
    voice: {
      id: readiness.voice,
      identity: readiness.voice_identity,
      model_sha256: readiness.voice_model_sha256,
      language: readiness.voice_metadata?.language ?? null,
      is_presenter_voice: false,
    },
    story: context.story,
    audio_standard: readiness.target_format,
    assembled: assembled,
    coverage: {
      story_sections: context.segments.length,
      spoken_segments: spokenRendered.length,
      intentionally_silent: rendered.length - spokenRendered.length,
      complete: spokenRendered.length > 0 && rendered.every((entry) => entry.spoken || entry.reason),
    },
    segments: segmentRecords,
    task_id: options.taskId || null,
  };
  atomicWrite(path.join(context.runDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifest, path: path.join(context.runDir, MANIFEST_FILE), context };
}

function assembleNarration(segmentPaths, targetPath, options = {}) {
  if (!segmentPaths.length) fail('NARRATION_NOTHING_TO_ASSEMBLE', 'no rendered segments to assemble');
  const listFile = `${targetPath}.concat.txt`;
  fs.writeFileSync(listFile, segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile, '-c', 'copy', targetPath], { timeout: options.timeoutMs || 180000 });
  } catch (error) {
    fail('NARRATION_ASSEMBLE_FAILED', `ffmpeg concat failed: ${String(error.message).slice(0, 200)}`);
  } finally {
    try { fs.rmSync(listFile); } catch (_) { /* best effort */ }
  }
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
    fail('NARRATION_ASSEMBLE_EMPTY', 'assembled narration is missing or empty');
  }
  const probe = probeAudio(targetPath);
  return {
    audio_path: path.basename(path.dirname(targetPath)) === 'draft-narration'
      ? path.join(MEDIA_DIR, path.basename(targetPath)).replace(/\\/g, '/')
      : path.basename(targetPath),
    absolute_path: targetPath,
    audio_sha256: sha256File(targetPath),
    bytes: fs.statSync(targetPath).size,
    duration_seconds: probe.duration_seconds,
    codec: probe.codec,
    sample_rate: probe.sample_rate,
    channels: probe.channels,
  };
}

/* ----------------------------------------------------------------- attest -- */

function readManifest(runDir) {
  const file = path.join(path.resolve(runDir), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { fail('NARRATION_MANIFEST_UNREADABLE', `${MANIFEST_FILE} is not valid JSON`); }
  if (parsed?.schema !== MANIFEST_SCHEMA) {
    fail('NARRATION_MANIFEST_SCHEMA_UNSUPPORTED', `${MANIFEST_FILE} schema is not ${MANIFEST_SCHEMA}`);
  }
  return parsed;
}

/*
 * Emit the typed evidence, re-verifying the bytes rather than trusting the
 * manifest. The evidence is self-describing so a QC policy can recognise it
 * without this module knowing anything about QC.
 */
function attestDraftNarration(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const manifest = readManifest(runDir);
  if (!manifest) fail('NARRATION_MANIFEST_MISSING', `${MANIFEST_FILE} not found; nothing to attest`);
  if (manifest.run_id !== path.basename(runDir)) {
    fail('NARRATION_MANIFEST_RUN_MISMATCH', `${MANIFEST_FILE} was recorded for run ${manifest.run_id}`);
  }

  // The bound Story must still be the one the narration was rendered from.
  const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });
  const drift = [];
  if (manifest.story.project_id !== bound.projectId) drift.push('Story project changed');
  if (manifest.story.version_id !== bound.versionId) drift.push('Story version changed');
  if (manifest.story.content_hash !== bound.contentHash) drift.push('Story content hash changed');

  const assembledPath = path.join(runDir, manifest.assembled.audio_path);
  const checks = [];
  if (!fs.existsSync(assembledPath)) checks.push('assembled narration file is missing');
  else {
    if (fs.statSync(assembledPath).size === 0) checks.push('assembled narration is zero bytes');
    else {
      const actual = sha256File(assembledPath);
      if (actual !== manifest.assembled.audio_sha256) checks.push('assembled narration hash does not match the manifest');
      try {
        const probe = probeAudio(assembledPath);
        if (probe.sample_rate !== manifest.audio_standard.sample_rate) checks.push('assembled sample rate does not match the declared standard');
        if (!(probe.duration_seconds > 0)) checks.push('assembled duration is not positive');
      } catch (error) { checks.push(`assembled narration is not decodable: ${error.message}`); }
    }
  }
  for (const segment of manifest.segments.filter((s) => s.spoken)) {
    const file = path.join(runDir, segment.audio_path);
    if (!fs.existsSync(file)) { checks.push(`segment ${segment.order} audio is missing`); continue; }
    if (sha256File(file) !== segment.audio_sha256) checks.push(`segment ${segment.order} hash does not match the manifest`);
  }

  const valid = drift.length === 0 && checks.length === 0;
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    kind: EVIDENCE_KIND,
    // Self-describing so a mode-aware QC policy can consume it without this
    // module importing QC, and so it can never be read as a production mix.
    fidelity: FIDELITY,
    production_mode: productionMode.DRAFT,
    asserts: 'verified machine-generated speech representing the exact canonical script, for DRAFT use',
    does_not_assert: ['mikko performance', 'real presenter capture', 'production-final audio', 'final mix', 'publish readiness'],
    satisfies_real_capture: false,
    human_authority_required: false,
    run_id: manifest.run_id,
    semantic_producer: SEMANTIC_PRODUCER,
    technical_producer: manifest.technical_producer,
    attested_by: ATTESTER,
    voice: manifest.voice,
    story: manifest.story,
    narration_manifest: { file: MANIFEST_FILE, sha256: sha256File(path.join(runDir, MANIFEST_FILE)) },
    assembled: manifest.assembled,
    coverage: manifest.coverage,
    audio_standard: manifest.audio_standard,
    technical_validation: { ok: checks.length === 0, failures: checks },
    script_binding: { ok: drift.length === 0, drift },
    state: valid ? 'VERIFIED' : 'INVALID',
    task_id: manifest.task_id || options.taskId || null,
  };
  if (!options.dryRun) {
    atomicWrite(path.join(runDir, EVIDENCE_FILE), `${JSON.stringify(evidence, null, 2)}\n`);
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
 * Is this run's narration currently valid? Re-verifies rather than trusting the
 * recorded state, so a script change or a mutated byte makes it stale.
 */
function narrationStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const manifest = (() => { try { return readManifest(runDir); } catch (_) { return null; } })();
  if (!manifest) return { present: false, valid: false, code: 'NARRATION_MISSING', detail: 'no draft narration manifest' };
  let evidence;
  try { evidence = attestDraftNarration(runDir, { ...options, dryRun: true }); }
  catch (error) { return { present: true, valid: false, code: error.code || 'NARRATION_INVALID', detail: error.message }; }
  if (evidence.state !== 'VERIFIED') {
    const detail = [...evidence.script_binding.drift, ...evidence.technical_validation.failures].join('; ');
    return { present: true, valid: false, code: evidence.script_binding.ok ? 'NARRATION_AUDIO_INVALID' : 'NARRATION_SCRIPT_DRIFT', detail, evidence };
  }
  return { present: true, valid: true, code: null, detail: null, evidence };
}

module.exports = {
  MANIFEST_FILE,
  MANIFEST_SCHEMA,
  EVIDENCE_FILE,
  EVIDENCE_SCHEMA,
  EVIDENCE_KIND,
  SEMANTIC_PRODUCER,
  ATTESTER,
  FIDELITY,
  MEDIA_DIR,
  ASSEMBLED_NAME,
  DraftNarrationError,
  extractSpokenSegments,
  resolveNarrationContext,
  buildDraftNarration,
  assembleNarration,
  readManifest,
  attestDraftNarration,
  readEvidence,
  narrationStatus,
};
