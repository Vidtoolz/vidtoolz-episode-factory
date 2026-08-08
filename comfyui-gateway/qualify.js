'use strict';
// VIDTOOLZ ComfyUI Production Gateway — qualification runner.
//
// Executes one canonical fixture through the full production chain and turns
// the result into a qualification record:
//
//   fixture → registry → render contract → static gate → live preflight
//     → environment fingerprint → dispatch → output → technical validation
//     → render provenance → qualification record
//
// GPU SAFETY: nothing in this module renders implicitly. The real executor is
// used only when the caller passes `allowLiveRender: true` (the CLI's explicit
// --qualify-render flag). Unit tests inject `options.executor` fakes; the
// ordinary test suite can never reach `comfy run` or POST /prompt.
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('./registry.js');
const fixturesMod = require('./fixtures.js');
const fingerprintMod = require('./fingerprint.js');
const qualification = require('./qualification.js');
const preflightMod = require('./preflight.js');
const failures = require('./failures.js');
const provenance = require('./provenance.js');
const client = require('./client.js');

const DEFAULT_RENDER_TIMEOUT_SECONDS = 600;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- output validation -------------------------------------------------------

// Width/height straight from the PNG IHDR — no image library needed.
function readPngDimensions(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error(`not a PNG file: ${filePath}`);
    }
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

// Technical validation of a qualification image output: exists, decodes as
// PNG, dimensions match the fixture's contract. Editorial quality is out of
// scope by design.
function validateImageOutput(outputPath, expected) {
  const problems = [];
  if (!fs.existsSync(outputPath)) return { ok: false, problems: [`output missing: ${outputPath}`] };
  let dims = null;
  try { dims = readPngDimensions(outputPath); } catch (err) {
    return { ok: false, problems: [`output does not decode: ${err.message}`] };
  }
  if (expected.width != null && dims.width !== expected.width) problems.push(`width ${dims.width} ≠ expected ${expected.width}`);
  if (expected.height != null && dims.height !== expected.height) problems.push(`height ${dims.height} ≠ expected ${expected.height}`);
  return { ok: problems.length === 0, problems, ...dims };
}

// Video outputs are validated against ffprobe-style metadata (the Wan lane's
// existing evidence format). `probe` is injectable; live use reuses the
// ffprobe JSON the lane already writes.
function validateVideoOutput(outputPath, expected, ffprobe) {
  const problems = [];
  if (!fs.existsSync(outputPath)) return { ok: false, problems: [`output missing: ${outputPath}`] };
  const summary = provenance.summarizeFfprobe(ffprobe);
  if (expected.width != null && summary.width !== expected.width) problems.push(`width ${summary.width} ≠ expected ${expected.width}`);
  if (expected.height != null && summary.height !== expected.height) problems.push(`height ${summary.height} ≠ expected ${expected.height}`);
  if (expected.frames != null && summary.frames !== expected.frames) problems.push(`frames ${summary.frames} ≠ expected ${expected.frames}`);
  if (expected.duration_seconds != null && summary.duration_seconds != null) {
    const tol = expected.duration_tolerance_seconds || 0.25;
    if (Math.abs(summary.duration_seconds - expected.duration_seconds) > tol) {
      problems.push(`duration ${summary.duration_seconds}s outside ${expected.duration_seconds}±${tol}s`);
    }
  }
  return { ok: problems.length === 0, problems, ...summary };
}

// ---- UI-graph patching -------------------------------------------------------

// Patch a UI-format graph copy through the registry's graph bindings. The
// canonical file is never touched; the caller gets a new object to serialize
// into a temp workflow. Prompts pass through byte-for-byte.
function patchUiGraph(canonicalGraph, entry, { prompt, seed, filenamePrefix }) {
  const graph = JSON.parse(JSON.stringify(canonicalGraph));
  const bindings = entry.graph_bindings || {};
  function nodeFor(binding, name) {
    const node = (graph.nodes || []).find((n) => n.id === binding.node_id);
    if (!node || (binding.node_type && node.type !== binding.node_type)) {
      throw new Error(`graph binding "${name}" no longer matches the canonical graph (node ${binding.node_id} ${binding.node_type}) — WORKFLOW_SCHEMA_DRIFT`);
    }
    return node;
  }
  if (prompt != null) {
    const node = nodeFor(bindings.prompt, 'prompt');
    node.widgets_values[0] = prompt;
  }
  if (filenamePrefix != null && bindings.filename_prefix) {
    const node = nodeFor(bindings.filename_prefix, 'filename_prefix');
    node.widgets_values[0] = filenamePrefix;
  }
  if (seed != null && bindings.seed) {
    const node = nodeFor(bindings.seed, 'seed');
    // RandomNoise widgets are [seed, control_after_generate] — fix both so
    // the qualification render is repeatable.
    node.widgets_values[0] = seed;
    if (node.widgets_values.length > 1) node.widgets_values[1] = 'fixed';
  }
  return graph;
}

// ---- executors ----------------------------------------------------------------

const DEFAULT_COMFYUI_OUTPUT_ROOT = path.join(os.homedir(), 'comfy', 'ComfyUI', 'output');

// The production FLUX dispatch chain shells out to `comfy run` (same as aigen
// run-handoff.py). Reached ONLY via allowLiveRender — see module header.
//
// Output location: the CLI's "Outputs:" stdout line gets wrapped by its rich
// terminal renderer when the path is long (observed live 2026-08-08), so the
// authoritative lookup is the SaveImage filename prefix we patched in — every
// qualification uses a unique per-run prefix, making the prefix directory
// scan exact, with the stdout parse kept as a first-chance shortcut.
function liveComfyCliExecutor({ workflowPath, timeoutSeconds, filenamePrefix, comfyOutputRoot, startedAtMs }) {
  const extraPath = path.join(os.homedir(), '.local', 'bin');
  const env = { ...process.env, PATH: `${process.env.PATH || ''}:${extraPath}` };
  const result = spawnSync('comfy', ['run', '--workflow', workflowPath, '--timeout', String(timeoutSeconds)], {
    encoding: 'utf8', env, timeout: (timeoutSeconds + 120) * 1000,
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) {
    const e = new Error(`comfy run failed (exit ${result.status}): ${combined.slice(-1500)}`);
    e.raw = combined;
    throw e;
  }
  const m = combined.match(/Outputs:\s*\n(.+\.(?:png|jpg|jpeg|webp|mp4))/);
  if (m && fs.existsSync(m[1].trim())) return { outputPath: m[1].trim(), raw: combined };

  if (filenamePrefix) {
    const root = comfyOutputRoot || DEFAULT_COMFYUI_OUTPUT_ROOT;
    const prefixDir = path.join(root, path.dirname(filenamePrefix));
    const base = path.basename(filenamePrefix);
    let candidates = [];
    try {
      candidates = fs.readdirSync(prefixDir)
        .filter((n) => n.startsWith(base))
        .map((n) => path.join(prefixDir, n))
        .filter((p) => fs.statSync(p).mtimeMs >= (startedAtMs || 0))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    } catch (_) { /* prefix dir missing — fall through to the error below */ }
    if (candidates.length) return { outputPath: candidates[0], raw: combined };
  }

  const e = new Error('comfy run finished but the output could not be located (stdout parse and prefix scan both empty)');
  e.raw = combined.slice(-1500);
  throw e;
}

function resolveExecutor(options) {
  if (options.executor) return options.executor;
  if (options.allowLiveRender === true) return liveComfyCliExecutor;
  const e = new Error(
    'qualification render refused: no executor injected and allowLiveRender is not set. '
    + 'GPU work requires explicit intent — use scripts/comfyui-workflow-check.js <id> --qualify-render.'
  );
  e.code = 'comfyui_qualification_render_not_authorized';
  e.statusCode = 403;
  throw e;
}

// ---- record assembly -----------------------------------------------------------

function newQualificationId(workflowId) {
  return `qual-${workflowId}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function failedRecord({ entry, fixture, fingerprint, qualificationId, startedAt, err }) {
  return {
    schema_version: qualification.QUALIFICATION_SCHEMA_VERSION,
    qualification_id: qualificationId,
    result: 'FAILED',
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    environment_fingerprint: fingerprint || { unavailable: true },
    fixture: fixture ? { id: fixture.id, parameter_sha256: fixturesMod.parameterSha256(fixture), seed: fixture.seed, source_sha256: fixture.source_sha256 || null } : null,
    execution: { job_id: qualificationId, started_at: startedAt, completed_at: new Date().toISOString() },
    failure: { class: failures.classifyFailure(err).failure_class, raw: String(err.raw || err.message || err).slice(0, 4000) },
    generated_by: 'comfyui-gateway/qualify.js',
  };
}

// ---- FLUX qualification ----------------------------------------------------------

// Run one FLUX qualification render end-to-end and persist the evidence.
// Returns { record, written, evidenceDir }. Throws only on refusal to start
// (unauthorized render / blocked gate); render/validation failures are
// captured as FAILED records and returned with ok=false.
async function runFluxQualification(options = {}) {
  const fixture = options.fixture
    || (options.fixtureId ? fixturesMod.getFixture(options.fixtureId, options) : fixturesMod.getFixtureForWorkflow('flux-gguf-1080x1920', options));
  const validated = fixturesMod.validateFixture(fixture, options);
  if (!validated.ok) {
    const e = new Error(`fixture ${fixture.id} invalid: ${validated.problems.join('; ')}`);
    e.code = 'comfyui_fixture_invalid';
    throw e;
  }
  const entry = validated.entry;
  const executor = resolveExecutor(options);
  const qualificationId = options.qualificationId || newQualificationId(entry.id);
  const startedAt = new Date().toISOString();

  // static production gate — a drifted/unqualified workflow cannot qualify
  const gate = registry.assertProductionAllowed(entry, options);
  if (!gate.ok) {
    const e = new Error(`qualification refused: ${gate.blocked_reason}`);
    e.code = gate.code;
    throw e;
  }

  // never queue behind (or interfere with) live production work
  const endpoint = options.endpoint || preflightMod.endpointFor(entry);
  if (!options.skipQueueCheck) {
    const queue = await client.getQueue(endpoint, options);
    const busy = (queue.queue_running || []).length + (queue.queue_pending || []).length;
    if (busy > 0) {
      const e = new Error(`qualification refused: ComfyUI queue at ${endpoint} is not idle (${busy} job(s)) — never interrupt production work`);
      e.code = 'comfyui_queue_busy';
      e.statusCode = 409;
      throw e;
    }
  }

  const fingerprint = options.fingerprint || await fingerprintMod.collectFingerprint(entry, options);
  const preflight = await preflightMod.runPreflight(entry.id, { ...options, entry: undefined, params: validated.params });
  if (!preflight.ok) {
    const record = failedRecord({
      entry, fixture, fingerprint, qualificationId, startedAt,
      err: Object.assign(new Error(`live preflight failed: ${preflight.checks.filter((c) => c.status === 'failed').map((c) => c.name).join(', ')}`), { raw: JSON.stringify(preflight.checks) }),
    });
    const written = qualification.writeQualificationRecord(record, options);
    return { ok: false, record, written, preflight };
  }

  const evidenceDir = path.join(qualification.workflowDir(entry.id, options), 'evidence', qualificationId);
  fs.mkdirSync(evidenceDir, { recursive: true });

  try {
    const canonicalGraph = JSON.parse(fs.readFileSync(registry.canonicalAbsolutePath(entry, options), 'utf8'));
    const filenamePrefix = `vidtoolz-qualification/${qualificationId}`;
    const patched = patchUiGraph(canonicalGraph, entry, {
      prompt: validated.params.prompt,
      seed: fixture.seed,
      filenamePrefix,
    });
    const workflowPath = path.join(evidenceDir, 'patched-workflow.json');
    fs.writeFileSync(workflowPath, JSON.stringify(patched, null, 2));

    const execStartMs = Date.now();
    const execution = await executor({
      workflowPath,
      timeoutSeconds: options.timeoutSeconds || DEFAULT_RENDER_TIMEOUT_SECONDS,
      filenamePrefix,
      comfyOutputRoot: options.comfyOutputRoot,
      startedAtMs: Date.parse(startedAt),
      entry, fixture, endpoint,
    });
    const execElapsedSeconds = Math.round((Date.now() - execStartMs) / 10) / 100;

    const validation = validateImageOutput(execution.outputPath, fixture.expected);
    if (!validation.ok) {
      const err = Object.assign(new Error(`technical validation failed: ${validation.problems.join('; ')}`), { code: 'comfyui_output_invalid' });
      throw err;
    }

    // retain the artifact inside the evidence dir — ComfyUI's own output
    // folder is not a durable evidence store
    const keptOutput = path.join(evidenceDir, `output${path.extname(execution.outputPath) || '.png'}`);
    fs.copyFileSync(execution.outputPath, keptOutput);
    const outputSha = registry.sha256File(keptOutput);

    // normal render-provenance manifest (same atomic infrastructure) — the
    // qualification record references it rather than duplicating it
    const provenancePath = path.join(evidenceDir, 'render-provenance.json');
    provenance.writeJsonAtomic(provenancePath, {
      schema_version: provenance.PROVENANCE_SCHEMA_VERSION,
      kind: 'flux-qualification-render',
      job_id: qualificationId,
      comfyui_prompt_id: execution.promptId || null,
      workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
      environment: { host: fingerprint.host.name, comfyui_version: fingerprint.comfyui.version },
      parameters: { prompt: validated.params.prompt, seed: fixture.seed },
      output: { path: keptOutput, sha256: outputSha, bytes: fs.statSync(keptOutput).size, width: validation.width, height: validation.height },
      generated_by: 'comfyui-gateway/qualify.js',
      generated_at: new Date().toISOString(),
    });

    const record = {
      schema_version: qualification.QUALIFICATION_SCHEMA_VERSION,
      qualification_id: qualificationId,
      result: 'LIVE_PASSED',
      evidence_source: 'canonical_fixture',
      workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
      environment_fingerprint: fingerprint,
      fixture: {
        id: fixture.id,
        parameter_sha256: fixturesMod.parameterSha256(fixture),
        seed: fixture.seed,
        source_sha256: fixture.source_sha256 || null,
      },
      execution: {
        job_id: qualificationId,
        comfyui_prompt_id: execution.promptId || null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        elapsed_seconds: execElapsedSeconds,
        // honest: a sub-threshold wall clock means ComfyUI may have served
        // its execution cache — that is 'unknown', never claimed 'executed'
        execution_mode: execElapsedSeconds >= 10 ? 'executed' : 'unknown',
      },
      output: {
        path: keptOutput,
        sha256: outputSha,
        bytes: fs.statSync(keptOutput).size,
        width: validation.width,
        height: validation.height,
        media_type: fixture.expected.media_type,
        technical_validation: 'passed',
      },
      render_provenance: { path: provenancePath, sha256: registry.sha256File(provenancePath) },
      generated_by: 'comfyui-gateway/qualify.js',
    };
    const written = qualification.writeQualificationRecord(record, options);
    return { ok: true, record, written, evidenceDir, preflight };
  } catch (err) {
    const record = failedRecord({ entry, fixture, fingerprint, qualificationId, startedAt, err });
    const written = qualification.writeQualificationRecord(record, options);
    return { ok: false, record, written, evidenceDir, error: err };
  }
}

// ---- Wan qualification harness ------------------------------------------------

// The complete Wan qualification chain with the GPU step injectable. There is
// deliberately NO default live executor here: a Wan HQ render costs ~50 GPU
// minutes and must go through the existing production lane under operator
// supervision. The executor receives the fully validated semantic request and
// must return { outputPath, jobId, promptId?, ffprobe } — everything else
// (fixture validation, registry gate, fingerprint, preflight, technical
// validation, provenance linkage, record) is the real production code path.
async function runWanQualification(options = {}) {
  const fixture = options.fixture || fixturesMod.getFixture(options.fixtureId || 'wan22-hq-smoke-v1', options);
  const validated = fixturesMod.validateFixture(fixture, options);
  if (!validated.ok) {
    const e = new Error(`fixture ${fixture.id} invalid: ${validated.problems.join('; ')}`);
    e.code = 'comfyui_fixture_invalid';
    throw e;
  }
  const entry = validated.entry;
  if (!options.executor) {
    const e = new Error(
      `Wan qualification has no default live executor — the ${entry.id} render runs through the existing PRESTO production lane under operator supervision. `
      + 'Qualification evidence for it is LIVE_RENDER_PENDING until that run happens.'
    );
    e.code = 'comfyui_qualification_render_not_authorized';
    e.statusCode = 403;
    throw e;
  }
  const qualificationId = options.qualificationId || newQualificationId(entry.id);
  const startedAt = new Date().toISOString();

  const gate = registry.assertProductionAllowed(entry, options);
  if (!gate.ok) {
    const e = new Error(`qualification refused: ${gate.blocked_reason}`);
    e.code = gate.code;
    throw e;
  }
  const fingerprint = options.fingerprint || await fingerprintMod.collectFingerprint(entry, options);
  const preflight = options.preflight || await preflightMod.runPreflight(entry.id, { ...options, params: validated.params });
  if (!preflight.ok) {
    const record = failedRecord({
      entry, fixture, fingerprint, qualificationId, startedAt,
      err: Object.assign(new Error('live preflight failed'), { raw: JSON.stringify(preflight.checks) }),
    });
    return { ok: false, record, written: qualification.writeQualificationRecord(record, options), preflight };
  }

  try {
    const execution = await options.executor({
      entry, fixture, params: { ...validated.params, seed: fixture.seed }, qualificationId,
    });
    const validation = validateVideoOutput(execution.outputPath, fixture.expected, execution.ffprobe);
    if (!validation.ok) {
      throw Object.assign(new Error(`technical validation failed: ${validation.problems.join('; ')}`), { code: 'comfyui_output_invalid' });
    }
    const record = {
      schema_version: qualification.QUALIFICATION_SCHEMA_VERSION,
      qualification_id: qualificationId,
      result: 'LIVE_PASSED',
      evidence_source: 'canonical_fixture',
      workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
      environment_fingerprint: fingerprint,
      fixture: {
        id: fixture.id,
        parameter_sha256: fixturesMod.parameterSha256(fixture),
        seed: fixture.seed,
        source_sha256: fixture.source_sha256 || null,
      },
      execution: {
        job_id: execution.jobId || qualificationId,
        comfyui_prompt_id: execution.promptId || null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        execution_mode: execution.executionMode || 'unknown',
      },
      output: {
        path: execution.outputPath,
        sha256: registry.sha256File(execution.outputPath),
        bytes: fs.statSync(execution.outputPath).size,
        width: validation.width,
        height: validation.height,
        media_type: fixture.expected.media_type,
        technical_validation: 'passed',
      },
      render_provenance: execution.renderProvenancePath
        ? { path: execution.renderProvenancePath, sha256: registry.sha256File(execution.renderProvenancePath) }
        : null,
      generated_by: 'comfyui-gateway/qualify.js',
    };
    return { ok: true, record, written: qualification.writeQualificationRecord(record, options), preflight };
  } catch (err) {
    const record = failedRecord({ entry, fixture, fingerprint, qualificationId, startedAt, err });
    return { ok: false, record, written: qualification.writeQualificationRecord(record, options), error: err };
  }
}

module.exports = {
  DEFAULT_RENDER_TIMEOUT_SECONDS,
  readPngDimensions,
  validateImageOutput,
  validateVideoOutput,
  patchUiGraph,
  resolveExecutor,
  runFluxQualification,
  runWanQualification,
};
