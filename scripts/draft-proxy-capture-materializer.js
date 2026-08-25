'use strict';

/*
 * Project proven DRAFT proxy-capture evidence into the five canonical gate-7
 * capture artifacts.
 *
 * Pure materialization: no model call, no media generation, no judgement. Every
 * row is derived from typed evidence that already exists, so this is the gate-6
 * pattern applied one gate later — the semantic authority stays in
 * DRAFT_SYNTHETIC_NARRATION and PROXY_PRESENTER, and these five markdown files
 * are their package-run representation.
 *
 * The one rule that matters more than any other here: proxy work is written as
 * proxy work. Nothing produced by this module may read as a human take, a camera
 * capture, recorded presenter audio, or Mikko performing. Every generated row
 * carries an explicit PROXY_GENERATED / DRAFT_SYNTHETIC marker, and the
 * real-capture predicate in the gate-8 evaluator rejects those markers outright —
 * so even if a run were promoted to PRODUCTION, none of this could be mistaken
 * for capture that actually happened.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const productionMode = require('./package-run-production-mode.js');
const narration = require('./package-run-draft-narration.js');
const presenter = require('./package-run-draft-proxy-presenter.js');
const proxyReadiness = require('./draft-proxy-capture-readiness.js');
const storyBinding = require('./package-run-story-binding.js');
// Human-notes semantics are already defined once; reuse rather than redefine.
const visualPlanMaterializer = require('./visual-plan-package-materializer.js');

const MATERIALIZER_VERSION = 'draft-proxy-capture-materializer-v1';
const SIDECAR_FILE = 'proxy-capture-materialization.json';
const SIDECAR_SCHEMA = 'vidtoolz.proxyCaptureMaterialization.v1';

// Row markers that make proxy provenance unmistakable, and that the gate-8
// real-capture predicate explicitly refuses.
const PROXY_TAKE_MARKER = 'PROXY_GENERATED';
const PROXY_AUDIO_MARKER = 'DRAFT_SYNTHETIC';

const OUTPUT_FILES = Object.freeze([
  'capture-checklist.md',
  'takes-log.md',
  'missing-shot-tracker.md',
  'screen-recording-checklist.md',
  'audio-capture-checklist.md',
]);

const HUMAN_START = visualPlanMaterializer.HUMAN_REGION_START;
const HUMAN_END = visualPlanMaterializer.HUMAN_REGION_END;

class DraftCaptureMaterializationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftCaptureMaterializationError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftCaptureMaterializationError(code, message); }

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(file) { return sha256(fs.readFileSync(file)); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function cell(value, limit = 200) {
  let text = String(value == null ? '' : value).replace(/\r?\n+/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
  return text || '—';
}

/* ---------------------------------------------------------------- sources -- */

/*
 * Every input is re-verified here, not trusted. Stale narration, a mutated video,
 * a drifted Story or incomplete coverage all refuse materialization: writing
 * capture paperwork from evidence that no longer holds is exactly how a lifecycle
 * starts lying.
 */
function resolveSources(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('CAPTURE_MATERIALIZE_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const mode = productionMode.readProductionMode(runDir).mode;
  if (mode !== productionMode.DRAFT) {
    fail('CAPTURE_MATERIALIZE_MODE_NOT_DRAFT',
      `proxy capture materialization is DRAFT-only; this run declares ${mode}`);
  }

  const readiness = proxyReadiness.draftProxyCaptureReadiness(runDir, options);
  if (!readiness.capture_ready) {
    fail('CAPTURE_MATERIALIZE_PROXY_NOT_READY',
      `proxy capture is not ready: ${readiness.blockers.join('; ')}`);
  }

  const narrationManifest = narration.readManifest(runDir);
  const narrationEvidence = narration.readEvidence(runDir);
  const presenterManifest = presenter.readManifest(runDir);
  const presenterEvidence = presenter.readEvidence(runDir);
  if (!narrationEvidence || narrationEvidence.state !== 'VERIFIED') fail('CAPTURE_MATERIALIZE_NARRATION_UNVERIFIED', 'narration evidence is not VERIFIED');
  if (!presenterEvidence || presenterEvidence.state !== 'VERIFIED') fail('CAPTURE_MATERIALIZE_PRESENTER_UNVERIFIED', 'proxy presenter evidence is not VERIFIED');
  if (!presenterManifest.coverage.complete) fail('CAPTURE_MATERIALIZE_COVERAGE_INCOMPLETE', 'proxy presenter coverage is incomplete');
  if (!presenterManifest.alignment.aligned) fail('CAPTURE_MATERIALIZE_NOT_ALIGNED', 'proxy presenter is not aligned to narration');

  const bound = storyBinding.resolveBoundStory(runDir, { scriptBuilderRoot: options.scriptBuilderRoot });

  // Screen capture is a visual-plan decision, not a proxy-capture one. If the
  // plan actually requires screen recordings, proxy presenter readiness cannot
  // stand in for them and this must not pretend otherwise.
  const screenPlanPath = path.join(runDir, 'screen-capture-list.md');
  const screenPlan = fs.existsSync(screenPlanPath) ? fs.readFileSync(screenPlanPath, 'utf8') : '';
  const screenRows = tableRows(screenPlan);
  const screenDeliberatelyNone = /NO_SCREEN_CAPTURE_REQUIRED/.test(screenPlan) && screenRows.length === 0;
  if (screenRows.length > 0) {
    fail('CAPTURE_MATERIALIZE_SCREEN_CAPTURE_REQUIRED',
      `the visual plan requires ${screenRows.length} screen recording(s); proxy presenter readiness cannot satisfy screen capture`);
  }

  // Same source the gate-7 generator uses, so the line is not invented here.
  const productionPlanText = (() => {
    const file = path.join(runDir, 'production-plan.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  })();
  const shootReadiness = (/^-?\s*Shoot-readiness status:\s*(.+)$/im.exec(productionPlanText) || [])[1]?.trim() || 'MISSING';

  return {
    runDir,
    runId: path.basename(runDir),
    mode,
    shootReadiness,
    readiness,
    narrationManifest,
    narrationEvidence,
    presenterManifest,
    presenterEvidence,
    story: { project_id: bound.projectId, version_id: bound.versionId, content_hash: bound.contentHash },
    screenDeliberatelyNone,
    screenPlanAuthority: screenDeliberatelyNone ? 'screen-capture-list.md (visual plan: NO_SCREEN_CAPTURE_REQUIRED)' : null,
  };
}

function tableRows(markdown = '') {
  return String(markdown).split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'))
    .filter((l) => !/^\|\s*:?-{3,}/.test(l))
    .filter((l) => !/\|\s*(?:capture|shot|demo|b-roll item|graphic|blocker|take|item|screen recording|audio item|missing shot\/content)\s*\|/i.test(l));
}

/* -------------------------------------------------------------- rendering -- */

function header(sources, title) {
  const p = sources.presenterManifest;
  const n = sources.narrationManifest;
  return [
    `# ${title}`,
    '',
    `- Run: ${sources.runId}`,
    `- Production mode: DRAFT`,
    `- Capture class: PROXY (machine-generated) — no human performance and no real capture`,
    `- Materializer: ${MATERIALIZER_VERSION}`,
    `- Source evidence: ${narration.EVIDENCE_KIND} + ${presenter.EVIDENCE_KIND}`,
    `- Narration audio: ${n.assembled.audio_path} (${n.assembled.audio_sha256.slice(0, 16)}…, ${n.assembled.duration_seconds.toFixed(2)}s)`,
    `- Proxy presenter: ${p.assembled.video_path} (${p.assembled.video_sha256.slice(0, 16)}…, ${p.assembled.duration_seconds.toFixed(2)}s)`,
    `- Story: ${sources.story.project_id} @ ${sources.story.version_id}`,
    '',
  ];
}

function withHumanRegion(body, preserved) {
  return [body.replace(/\s+$/, ''), '', HUMAN_START, preserved || '', HUMAN_END, ''].join('\n');
}

/*
 * capture-checklist.md carries the two status lines the lifecycle reader parses
 * (`Capture checklist status` and `Ready for rough cut`). They are part of the
 * artifact contract, not decoration: without them the run's status label never
 * leaves "Needs capture" no matter how complete the evidence is.
 */
function renderCaptureChecklist(sources) {
  const p = sources.presenterManifest;
  const n = sources.narrationManifest;
  const rows = [
    `| ${PROXY_AUDIO_MARKER} narration rendered for every spoken beat | ${cell(narration.EVIDENCE_KIND)} | high | closed |`,
    `| ${PROXY_TAKE_MARKER} proxy presenter rendered for every spoken beat | ${cell(presenter.EVIDENCE_KIND)} | high | closed |`,
    `| Proxy beat coverage complete (${p.coverage.covered_beats}/${p.coverage.spoken_beats}) | proxy presenter manifest | high | closed |`,
    `| Proxy presenter aligned to narration (delta ${p.alignment.delta_seconds}s within ${p.alignment.tolerance_seconds}s) | proxy presenter manifest | high | closed |`,
    `| Media bytes verified by hash and probe | technical validation in both evidence records | high | closed |`,
    `| Human presenter capture NOT required in DRAFT | production mode policy | high | closed |`,
  ];
  return [
    ...header(sources, 'Capture Checklist'),
    // Canonical status lines, in the shape the lifecycle reader expects.
    `- Shoot-readiness status: ${cell(sources.shootReadiness, 60)}`,
    '- Capture checklist status: READY FOR ROUGH CUT',
    '- Ready for rough cut: yes',
    '- External APIs called: no',
    '',
    '## Draft Proxy Capture',
    '',
    'This run is a zero-human DRAFT. Capture readiness here means machine-generated',
    'proxy media exists and verifies. It does NOT mean anyone recorded anything.',
    '',
    '| item | source | priority | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `Narration provider: ${n.technical_producer.provider} ${n.technical_producer.version || ''} (voice ${n.voice.id}, ${n.voice.identity}).`,
    `Proxy presenter renderer: ${p.technical_producer.renderer} ${p.technical_producer.version} (${p.technical_producer.style}, motion ${p.technical_producer.motion_model}, lip sync ${p.technical_producer.lip_sync}).`,
    '',
  ].join('\n');
}

function renderTakesLog(sources) {
  const p = sources.presenterManifest;
  // Each row is a GENERATED segment, typed as such in both the take column and
  // the notes. These are renders, not performances, and the wording never says
  // otherwise.
  const rows = p.segments.map((segment) => (
    `| ${PROXY_TAKE_MARKER} render ${segment.order} (not a human take) | ${cell(segment.beat ? `beat ${segment.order} — ${segment.beat}` : `beat ${segment.order}`)} | ${cell(segment.video_path)} | proxy render, ${segment.duration_seconds.toFixed(2)}s, ${segment.frames} frames, no performance | closed |`
  ));
  return [
    ...header(sources, 'Takes Log'),
    '## Draft Proxy Renders',
    '',
    'Every entry below is a machine render, not a take. Nobody performed. There is',
    'no camera, no room, no presenter and no delivery to judge. In PRODUCTION this',
    'file records real human takes; in DRAFT it records what the machine generated',
    'so the edit knows which bytes cover which beat.',
    '',
    '| take | source item | file/reference | quality notes | status |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Assembled proxy presenter track: ${p.assembled.video_path} (${p.assembled.duration_seconds.toFixed(2)}s, ${p.assembled.frames} frames).`,
    'Take selection is not applicable: there is exactly one deterministic render per beat and no performance variation to choose between.',
    '',
  ].join('\n');
}

function renderMissingShotTracker(sources) {
  const p = sources.presenterManifest;
  const uncovered = p.coverage.uncovered || [];
  const body = uncovered.length
    ? uncovered.map((entry) => `| ${cell(entry)} | proxy presenter coverage gap | render the missing beat before the draft edit | open |`)
    : [];
  return [
    ...header(sources, 'Missing Shot Tracker'),
    '## Draft Proxy Coverage',
    '',
    `Every spoken narration beat carries a proxy presenter render: ${p.coverage.covered_beats} of ${p.coverage.spoken_beats}.`,
    'This tracks DRAFT proxy coverage only. It makes no claim about final production',
    'shots, b-roll, graphics or screen recordings, none of which are captured here.',
    '',
    '| missing shot/content | why it matters | required fix | status |',
    '| --- | --- | --- | --- |',
    ...(body.length ? body : [`| None for DRAFT proxy coverage | all ${p.coverage.spoken_beats} spoken beat(s) have a proxy render | keep the proxy evidence with the run | closed |`]),
    '',
  ].join('\n');
}

function renderScreenRecordingChecklist(sources) {
  if (!sources.screenDeliberatelyNone) {
    // resolveSources refuses this case; belt and braces.
    fail('CAPTURE_MATERIALIZE_SCREEN_CAPTURE_REQUIRED', 'screen recordings are required and proxy readiness cannot satisfy them');
  }
  return [
    ...header(sources, 'Screen Recording Checklist'),
    '## No Screen Recording Required',
    '',
    '- Decision: NO_SCREEN_RECORDING_REQUIRED',
    `- Decided by: visual_planning_director, recorded in ${sources.screenPlanAuthority}`,
    '- Basis: the approved visual plan assigns every covered beat to generated, graphic or presenter coverage rather than recordings of an application, so there is nothing to record.',
    `- Coverage checked: ${sources.presenterManifest.coverage.spoken_beats} spoken beat(s), 0 requiring a screen recording.`,
    '',
    'This is a deliberate absence, not an unfinished artifact. If a later plan',
    'revision introduces a SCREEN_CAPTURE shot, proxy presenter readiness will not',
    'satisfy it and this gate reopens on real screen-recording evidence.',
    '',
  ].join('\n');
}

function renderAudioCaptureChecklist(sources) {
  const n = sources.narrationManifest;
  const rows = [
    `| ${PROXY_AUDIO_MARKER} narration track | machine-generated speech for the approved script — not recorded presenter audio | ${cell(n.assembled.audio_path)} | closed |`,
    `| ${PROXY_AUDIO_MARKER} per-beat segments (${n.coverage.spoken_segments}) | one synthetic render per spoken beat, for edit placement | ${cell(narration.MEDIA_DIR)} | closed |`,
    `| Technical validation | ${n.assembled.sample_rate} Hz ${n.assembled.codec}, ${n.assembled.duration_seconds.toFixed(2)}s, hash verified | ${cell(n.assembled.audio_sha256.slice(0, 24))}… | closed |`,
    `| Human voice capture | not required in DRAFT; a real recording is a PRODUCTION requirement | production mode policy | closed |`,
  ];
  return [
    ...header(sources, 'Audio Capture Checklist'),
    '## Draft Proxy Audio',
    '',
    `The DRAFT audio source is synthetic narration produced by ${n.technical_producer.provider}`,
    `using the voice ${n.voice.id} (${n.voice.identity}). It is a proxy voice track:`,
    'nobody spoke, no microphone was used, and this is not presenter audio, not a',
    'final mix and not publish-ready sound.',
    '',
    '| audio item | capture requirement | file/reference | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'No capture readiness approval marker appears in this file by design. A DRAFT is',
    'zero-human, so its capture evidence is machine-verified rather than approved.',
    '',
  ].join('\n');
}

const RENDERERS = Object.freeze({
  'capture-checklist.md': renderCaptureChecklist,
  'takes-log.md': renderTakesLog,
  'missing-shot-tracker.md': renderMissingShotTracker,
  'screen-recording-checklist.md': renderScreenRecordingChecklist,
  'audio-capture-checklist.md': renderAudioCaptureChecklist,
});

function buildArtifacts(sources) {
  const files = {};
  for (const filename of OUTPUT_FILES) files[filename] = RENDERERS[filename](sources);
  return files;
}

/* ----------------------------------------------------------- materialize --- */

function materializeDraftProxyCaptureArtifacts(runDirInput, options = {}) {
  const sources = resolveSources(runDirInput, options);
  const { runDir } = sources;

  // Prepare and validate everything before touching disk, so a failure can never
  // leave a half-updated five-file set.
  const rendered = buildArtifacts(sources);
  for (const filename of OUTPUT_FILES) {
    const body = rendered[filename];
    if (!body || body.length < 200) fail('CAPTURE_MATERIALIZE_ARTIFACT_TOO_THIN', `${filename} rendered empty or too thin`);
    if (/\b(?:TODO|TBD|placeholder)\b/i.test(body)) fail('CAPTURE_MATERIALIZE_SCAFFOLD_EMITTED', `${filename} contains a scaffold marker`);
    // Nothing may claim human capture.
    if (/\b(?:mikko recorded|human presenter captured|camera capture complete|real take)\b/i.test(body)) {
      fail('CAPTURE_MATERIALIZE_HUMAN_CLAIM', `${filename} asserts human capture`);
    }
    const target = path.join(runDir, filename);
    if (path.dirname(target) !== runDir) fail('CAPTURE_MATERIALIZE_PATH_UNSAFE', `refusing to write outside the run: ${filename}`);
  }

  const written = [];
  for (const filename of OUTPUT_FILES) {
    const target = path.join(runDir, filename);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const contents = withHumanRegion(rendered[filename], visualPlanMaterializer.extractHumanRegion(existing));
    const unchanged = existing === contents;
    if (!options.dryRun && !unchanged) atomicWrite(target, contents);
    written.push({
      filename,
      sha256: sha256(contents),
      // Machine-owned bytes only, so a preserved human note never reads as drift.
      machine_sha256: sha256(visualPlanMaterializer.machineCanonicalText(contents)),
      bytes: Buffer.byteLength(contents),
      unchanged,
      human_notes_preserved: Boolean(visualPlanMaterializer.extractHumanRegion(existing)),
    });
  }

  const sidecar = {
    schema: SIDECAR_SCHEMA,
    materializer_version: MATERIALIZER_VERSION,
    run_id: sources.runId,
    production_mode: productionMode.DRAFT,
    capture_class: 'PROXY',
    human_performance: false,
    satisfies_real_capture: false,
    human_authority_required: false,
    story: sources.story,
    source_evidence: {
      narration: {
        kind: narration.EVIDENCE_KIND,
        state: sources.narrationEvidence.state,
        manifest_sha256: sha256File(path.join(runDir, narration.MANIFEST_FILE)),
        audio_sha256: sources.narrationManifest.assembled.audio_sha256,
        duration_seconds: sources.narrationManifest.assembled.duration_seconds,
      },
      proxy_presenter: {
        kind: presenter.EVIDENCE_KIND,
        state: sources.presenterEvidence.state,
        manifest_sha256: sha256File(path.join(runDir, presenter.MANIFEST_FILE)),
        video_sha256: sources.presenterManifest.assembled.video_sha256,
        duration_seconds: sources.presenterManifest.assembled.duration_seconds,
      },
      aggregate: {
        disposition: sources.readiness.disposition,
        capture_ready: sources.readiness.capture_ready,
      },
    },
    coverage: sources.presenterManifest.coverage,
    alignment: sources.presenterManifest.alignment,
    screen_recording: sources.screenDeliberatelyNone
      ? { decision: 'NO_SCREEN_RECORDING_REQUIRED', authority: sources.screenPlanAuthority }
      : null,
    artifacts: written.map(({ filename, sha256: digest, machine_sha256: machine, bytes }) => ({ filename, sha256: digest, machine_sha256: machine, bytes })),
    task_id: options.taskId || null,
  };
  // Sidecar last: it is the commit marker for the whole five-file set.
  if (!options.dryRun) atomicWrite(path.join(runDir, SIDECAR_FILE), `${JSON.stringify(sidecar, null, 2)}\n`);

  return { sidecar, written, sources };
}

/* ---------------------------------------------------------------- verify --- */

function readSidecar(runDir) {
  const file = path.join(path.resolve(runDir), SIDECAR_FILE);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
  return parsed?.schema === SIDECAR_SCHEMA ? parsed : null;
}

/*
 * Is the materialization still true? Re-derives the expected artifacts from the
 * current evidence and compares machine-owned bytes, so a stale source or an
 * edited machine row is caught rather than inherited.
 */
function materializationStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const sidecar = readSidecar(runDir);
  if (!sidecar) return { present: false, valid: false, code: 'CAPTURE_MATERIALIZATION_MISSING', detail: 'no proxy capture materialization sidecar' };
  if (sidecar.run_id !== path.basename(runDir)) {
    return { present: true, valid: false, code: 'CAPTURE_MATERIALIZATION_RUN_MISMATCH', detail: `sidecar was recorded for run ${sidecar.run_id}` };
  }

  let expected;
  try { expected = materializeDraftProxyCaptureArtifacts(runDir, { ...options, dryRun: true }); }
  catch (error) {
    return { present: true, valid: false, code: error.code || 'CAPTURE_MATERIALIZATION_INVALID', detail: error.message };
  }

  const failures = [];
  const expectedByName = new Map(expected.written.map((entry) => [entry.filename, entry]));
  for (const filename of OUTPUT_FILES) {
    const file = path.join(runDir, filename);
    if (!fs.existsSync(file)) { failures.push(`${filename} is missing`); continue; }
    const actual = sha256(visualPlanMaterializer.machineCanonicalText(fs.readFileSync(file, 'utf8')));
    if (actual !== expectedByName.get(filename).machine_sha256) {
      failures.push(`${filename} is not what the current proxy evidence materializes to`);
    }
  }
  if (failures.length) return { present: true, valid: false, code: 'CAPTURE_MATERIALIZATION_DRIFT', detail: failures.join('; '), sidecar };
  return { present: true, valid: true, code: null, detail: null, sidecar };
}

module.exports = {
  MATERIALIZER_VERSION,
  SIDECAR_FILE,
  SIDECAR_SCHEMA,
  PROXY_TAKE_MARKER,
  PROXY_AUDIO_MARKER,
  OUTPUT_FILES,
  DraftCaptureMaterializationError,
  resolveSources,
  buildArtifacts,
  materializeDraftProxyCaptureArtifacts,
  readSidecar,
  materializationStatus,
};
