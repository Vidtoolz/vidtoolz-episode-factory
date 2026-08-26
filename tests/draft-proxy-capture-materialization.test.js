'use strict';

/*
 * DRAFT PROXY CAPTURE MATERIALIZATION — proxy evidence into gate-7 paperwork.
 *
 * The Draft has a script, a voice and a body. This turns that into the five
 * canonical capture artifacts so the canonical gates can judge it — without ever
 * writing that a human captured anything.
 *
 * The invariants that matter most here are semantic, not structural: a proxy
 * render must never be readable as a human take, and synthetic narration must
 * never be readable as recorded presenter audio. Two tests are dedicated to
 * exactly that, because those are the sentences a tired reader would believe.
 */

const { assert, fs, os, path, test } = require('./_helpers.js');
const materializer = require('../scripts/draft-proxy-capture-materializer.js');
const narration = require('../scripts/package-run-draft-narration.js');
const presenter = require('../scripts/package-run-draft-proxy-presenter.js');
const narrationProvider = require('../scripts/synthetic-narration-provider.js');
const presenterRenderer = require('../scripts/draft-proxy-presenter-provider.js');
const proxyReadiness = require('../scripts/draft-proxy-capture-readiness.js');
const productionMode = require('../scripts/package-run-production-mode.js');
const captureChecklist = require('../scripts/package-run-capture-checklist.js');
const captureEvidence = require('../scripts/package-run-capture-evidence-review.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const stateProjection = require('../scripts/package-run-state-projection.js');
const packageRunsIndex = require('../scripts/package-runs-index.js');

const ROOT = path.resolve(__dirname, '..');
const CANARY_DIR = path.join(ROOT, 'package-runs', '2026-08-25-lifecycle-integration-canary-canary-not-for-publication');

const UPSTREAM = [
  'final-script.md', 'script-review.md', 'script-structure.md', 'research-pack.md',
  'research-evidence.md', 'research-sufficiency-review.md', 'source-support-map.md',
  'proof-capture-plan.md', 'research-objections.md', 'selected-package.json', 'notes.md',
  'production-plan.md', 'audio-notes.md', 'production-blockers.md', 'shot-list.md',
  'screen-capture-list.md', 'demo-list.md', 'b-roll-list.md', 'graphics-list.md',
  'shot-edit-plan-review.md', 'story-binding.json',
];

const SYNTHETIC_UPSTREAM = {
  'final-script.md': '# Final Script\n\nCommitted-fixture lifecycle canary script.\n',
  'selected-package.json': `${JSON.stringify({ package: { proposedTitle: 'Lifecycle canary', idea: 'Proxy capture fixture', viewerPromise: 'Fixture only' } }, null, 2)}\n`,
  'b-roll-list.md': '# B-Roll List\n\nNo b-roll required for this fixture.\n',
  'graphics-list.md': '# Graphics List\n\nNo graphics required for this fixture.\n',
};

const READY = narrationProvider.providerReadiness().actionable && presenterRenderer.rendererReadiness().actionable;

/*
 * A fully produced DRAFT run. Narration and presenter media are rendered once and
 * cloned per test: together they cost about ten seconds, which is too much to pay
 * per assertion.
 */
let template = null;
function producedRun(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `capmat-${label}-`));
  const runId = '2026-08-25-capmat-canary';
  const dir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(dir, { recursive: true });

  if (!template) {
    const seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capmat-template-'));
    const seed = path.join(seedRoot, 'package-runs', runId);
    fs.mkdirSync(seed, { recursive: true });
    for (const name of UPSTREAM) {
      if (Object.hasOwn(SYNTHETIC_UPSTREAM, name)) {
        fs.writeFileSync(path.join(seed, name), SYNTHETIC_UPSTREAM[name]);
        continue;
      }
      const src = path.join(CANARY_DIR, name);
      assert.ok(fs.existsSync(src), `committed proxy fixture source missing: ${name}`);
      fs.copyFileSync(src, path.join(seed, name));
    }
    const bindingPath = path.join(seed, 'story-binding.json');
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    binding.run_id = runId;
    fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2));
    productionMode.setProductionMode(seed, productionMode.DRAFT, { setBy: 'generation_supervisor (agent)' });
    narration.buildDraftNarration(seed, {});
    narration.attestDraftNarration(seed, {});
    presenter.buildDraftProxyPresenter(seed, {});
    presenter.attestProxyPresenter(seed, {});
    template = seed;
  }
  fs.cpSync(template, dir, { recursive: true });
  if (options.mode && options.mode !== productionMode.DRAFT) {
    if (options.mode === 'PRODUCTION') productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
    productionMode.setProductionMode(dir, options.mode, { setBy: options.mode === 'PRODUCTION' ? 'Mikko' : 'editor (agent)' });
  }
  return { root, dir, runId };
}

function gatePosition(root, dir) {
  const map = workflowMap.buildWorkflowMap(dir, { repoRoot: root });
  const current = map.gates.find((gate) => String(gate.status).startsWith('current'));
  return {
    gate: current ? current.id : null,
    index: current ? map.gates.indexOf(current) + 1 : null,
    complete: map.gates.filter((gate) => gate.status === 'complete').length,
  };
}

function artifactText(dir, name) { return fs.readFileSync(path.join(dir, name), 'utf8'); }

/* ==================== MATERIALIZATION (CM1-CM12) ========================== */

test('capture CM1/CM3: all five artifacts are generated with proxy provenance', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm1');
  const result = materializer.materializeDraftProxyCaptureArtifacts(dir, { taskId: 'cm1' });

  assert.deepEqual(result.written.map((w) => w.filename), materializer.OUTPUT_FILES);
  for (const filename of materializer.OUTPUT_FILES) {
    const text = artifactText(dir, filename);
    assert.ok(fs.existsSync(path.join(dir, filename)));
    // Provenance is stated in every artifact, not just the sidecar.
    assert.match(text, /Production mode: DRAFT/);
    assert.match(text, /Capture class: PROXY/);
    assert.match(text, new RegExp(materializer.MATERIALIZER_VERSION));
    assert.match(text, /DRAFT_SYNTHETIC_NARRATION \+ PROXY_PRESENTER/);
  }
  const sidecar = materializer.readSidecar(dir);
  assert.equal(sidecar.capture_class, 'PROXY');
  assert.equal(sidecar.human_performance, false);
  assert.equal(sidecar.satisfies_real_capture, false);
  assert.equal(sidecar.human_authority_required, false);
  assert.equal(sidecar.source_evidence.aggregate.disposition, 'PROXY_CAPTURE_READY');
  assert.equal(sidecar.artifacts.length, 5);
});

test('capture CM2/CM4: nothing is left TODO and nothing claims human capture', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm2');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  for (const filename of materializer.OUTPUT_FILES) {
    const text = artifactText(dir, filename);
    assert.ok(!/\b(?:TODO|TBD|placeholder)\b/i.test(text), `${filename} must carry no scaffold marker`);
    /*
     * The sentences a tired reader would believe. Denials are stripped first:
     * "not recorded presenter audio" is exactly what we want the file to say, so
     * scanning for the bare phrase would flag the safeguard as the danger.
     */
    const asserted = text
      .replace(/\bnot\s+(?:a\s+)?(?:recorded presenter audio|human take|real capture|presenter audio)/gi, '')
      .replace(/\bno human performance\b/gi, '')
      .replace(/^.*\b(?:is_not|does_not_assert)\b.*$/gim, '');
    for (const claim of [/mikko recorded/i, /human presenter captured/i, /camera capture complete/i, /\breal take\b/i, /recorded presenter audio/i]) {
      assert.ok(!claim.test(asserted), `${filename} must not assert ${claim}`);
    }
  }
});

test('capture CM5: the screen-recording absence is substantive and attributed', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm5');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const text = artifactText(dir, 'screen-recording-checklist.md');
  assert.match(text, /NO_SCREEN_RECORDING_REQUIRED/);
  assert.match(text, /Decided by: visual_planning_director/);
  assert.match(text, /Basis: /);
  assert.match(text, /deliberate absence, not an unfinished artifact/i);
  // It defers to the visual plan rather than inventing the decision.
  assert.match(text, /screen-capture-list\.md/);
  assert.ok(text.replace(/[^a-z]/gi, '').length > 300, 'a bare "none" would read as unfinished');
});

test('capture CM6: the sidecar binds Story, narration and presenter by hash', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm6');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const sidecar = materializer.readSidecar(dir);
  const narrationManifest = narration.readManifest(dir);
  const presenterManifest = presenter.readManifest(dir);

  assert.match(sidecar.story.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(sidecar.source_evidence.narration.audio_sha256, narrationManifest.assembled.audio_sha256);
  assert.equal(sidecar.source_evidence.proxy_presenter.video_sha256, presenterManifest.assembled.video_sha256);
  assert.equal(sidecar.source_evidence.narration.kind, 'DRAFT_SYNTHETIC_NARRATION');
  assert.equal(sidecar.source_evidence.proxy_presenter.kind, 'PROXY_PRESENTER');
  for (const artifact of sidecar.artifacts) assert.match(artifact.machine_sha256, /^[0-9a-f]{64}$/);
});

test('capture CM7/CM8: stale narration or presenter refuses materialization', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  // Stale narration.
  {
    const { dir } = producedRun('cm7');
    const target = path.join(dir, narration.MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    manifest.story.content_hash = '0'.repeat(64);
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
    assert.throws(() => materializer.materializeDraftProxyCaptureArtifacts(dir, {}),
      (error) => error.code === 'CAPTURE_MATERIALIZE_PROXY_NOT_READY');
  }
  // Mutated presenter media.
  {
    const { dir } = producedRun('cm8');
    const manifest = presenter.readManifest(dir);
    fs.appendFileSync(path.join(dir, manifest.assembled.video_path), Buffer.from([0, 0, 0]));
    assert.throws(() => materializer.materializeDraftProxyCaptureArtifacts(dir, {}),
      (error) => error.code === 'CAPTURE_MATERIALIZE_PROXY_NOT_READY');
  }
});

test('capture CM9: materialization is idempotent, and machine rows are restored', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm9');
  const first = materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const second = materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  assert.ok(second.written.every((w) => w.unchanged), 'second pass changes nothing');
  assert.deepEqual(second.written.map((w) => w.machine_sha256), first.written.map((w) => w.machine_sha256));

  // A human note survives; a tampered machine row does not.
  const target = path.join(dir, 'takes-log.md');
  fs.writeFileSync(target, artifactText(dir, 'takes-log.md')
    .replace('<!-- human-notes:start -->', '<!-- human-notes:start -->\nMikko: beat 2 feels long.')
    .replace(/\| PROXY_GENERATED render 1[^\n]*/, '| a real human take | beat 1 | media/captures/real.mp4 | great | closed |'));
  assert.equal(materializer.materializationStatus(dir).valid, false, 'tampering is detected');
  assert.equal(materializer.materializationStatus(dir).code, 'CAPTURE_MATERIALIZATION_DRIFT');

  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const restored = artifactText(dir, 'takes-log.md');
  assert.ok(restored.includes('Mikko: beat 2 feels long.'), 'the human note survives');
  assert.ok(!restored.includes('a real human take'), 'the smuggled human-take row is gone');
  assert.equal(materializer.materializationStatus(dir).valid, true);
});

test('capture CM10/CM11: PRODUCTION is refused and REVIEW does not regenerate', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  for (const mode of ['REVIEW', 'PRODUCTION']) {
    const { dir } = producedRun(`cm10-${mode.toLowerCase()}`, { mode });
    assert.throws(() => materializer.materializeDraftProxyCaptureArtifacts(dir, {}),
      (error) => error.code === 'CAPTURE_MATERIALIZE_MODE_NOT_DRAFT', `${mode} must be refused`);
  }
  const { dir } = producedRun('cm11-unspecified');
  fs.rmSync(productionMode.modePath(dir));
  assert.throws(() => materializer.materializeDraftProxyCaptureArtifacts(dir, {}),
    (error) => error.code === 'CAPTURE_MATERIALIZE_MODE_NOT_DRAFT');
});

test('capture CM12: the materializer only writes inside the run', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('cm12');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const written = fs.readdirSync(dir);
  for (const filename of [...materializer.OUTPUT_FILES, materializer.SIDECAR_FILE]) {
    assert.ok(written.includes(filename), `${filename} written into the run`);
  }
  assert.deepEqual(written.filter((n) => n.includes('.tmp-')), [], 'no temporary files left behind');
});

/* ============= SEMANTIC INVARIANTS (§39, §40) ============================== */

/*
 * These two deserve to be separate. Every other check could pass while the
 * paperwork still quietly said a person did the work.
 */

test('capture §39: a proxy render can never be read as a human take', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('takeslog');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const text = artifactText(dir, 'takes-log.md');

  // Every data row declares itself a render, not a take.
  const rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'))
    .filter((l) => !/^\|\s*:?-{3,}/.test(l.trim()))
    .filter((l) => !/\|\s*take\s*\|/i.test(l));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.match(row, new RegExp(materializer.PROXY_TAKE_MARKER), `row must be marked proxy: ${row}`);
    assert.match(row, /not a human take/i);
  }
  // The prose says it too, in case a reader skims the table.
  assert.match(text, /machine render, not a take/i);
  assert.match(text, /Nobody performed/i);

  // And the real-capture predicate refuses every one of those rows, so the same
  // file cannot satisfy a PRODUCTION capture requirement.
  for (const row of rows) {
    assert.equal(captureEvidence.hasRealCaptureRows(row, 'take'), false,
      `a proxy row must never read as real capture: ${row}`);
  }
});

test('capture §40: synthetic narration can never be read as recorded presenter audio', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { dir } = producedRun('audiolog');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  const text = artifactText(dir, 'audio-capture-checklist.md');

  assert.match(text, new RegExp(materializer.PROXY_AUDIO_MARKER));
  assert.match(text, /not recorded presenter audio/i);
  assert.match(text, /nobody spoke, no microphone/i);
  assert.ok(!/recorded presenter audio\b(?! )/i.test(text.replace(/not recorded presenter audio/gi, '')));
  // No capture-readiness marker is written, by design.
  assert.ok(!/^(?:[-*]\s*)?(?:Manual approval|Capture approval|Audio capture readiness|Rough-cut assembly approval):\s*PASS\s*$/im.test(text),
    'a DRAFT must never carry a human capture approval marker');
  const rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'))
    .filter((l) => !/^\|\s*:?-{3,}/.test(l.trim())).filter((l) => !/\|\s*audio item\s*\|/i.test(l));
  for (const row of rows.filter((r) => /media\//.test(r))) {
    assert.equal(captureEvidence.hasRealCaptureRows(row, 'audio'), false,
      `synthetic audio must never read as real capture: ${row}`);
  }
});

/* ================= GATE 7 / GATE 8 END TO END (§41, §42) ================== */

test('capture §41/§42: the zero-human DRAFT completes gates 7 and 8 and reaches gate 9', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { root, dir } = producedRun('e2e');

  // RED: proxy capture is ready, but the paperwork does not exist.
  assert.equal(proxyReadiness.draftProxyCaptureReadiness(dir).capture_ready, true);
  assert.equal(captureChecklist.buildOutputs(dir).readiness.status, 'NEEDS CAPTURE');
  assert.equal(captureEvidence.evaluateCaptureEvidence(dir).status, 'BLOCKED');

  materializer.materializeDraftProxyCaptureArtifacts(dir, { taskId: 'e2e' });

  // GREEN: gate 7 reaches its terminal machine state with no human marker.
  const gate7 = captureChecklist.buildOutputs(dir);
  assert.equal(gate7.readiness.status, 'READY FOR ROUGH CUT');
  assert.equal(gate7.readiness.readyForRoughCut, true);
  assert.match(gate7.readiness.reason, /machine-verified/i);
  assert.match(gate7.readiness.reason, /no human approval/i);
  captureChecklist.writeOutputs(dir, gate7, true);

  // Gate 8 passes on the same real proxy evidence, still with no marker.
  const gate8 = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(gate8.status, 'PASS');
  assert.equal(gate8.captureEvidenceAccepted, true);
  assert.equal(gate8.approvalMarkerDetected, false, 'no human marker may be involved');
  assert.equal(gate8.realCaptureEvidence, false, 'proxy must not register as real capture');
  assert.equal(gate8.proxyCapture.capture_ready, true);
  assert.equal(gate8.proxyCapture.human_authority_required, false);
  captureEvidence.writeReview(dir, captureEvidence.buildReviewMarkdown(gate8), true);

  // The canonical lifecycle advances on evidence alone.
  const position = gatePosition(root, dir);
  assert.equal(position.gate, 'rough-cut-review');
  assert.equal(position.index, 9);
  assert.equal(position.complete, 8);

  // And the run's own status label advanced, not just the gate predicates.
  assert.equal(packageRunsIndex.scanRun(dir, root).status, 'Ready for rough cut');
});

test('capture §34: package-run state tells the same story through gate 8', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { root, dir, runId } = producedRun('state');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  captureChecklist.writeOutputs(dir, captureChecklist.buildOutputs(dir), true);
  const gate8 = captureEvidence.evaluateCaptureEvidence(dir);
  captureEvidence.writeReview(dir, captureEvidence.buildReviewMarkdown(gate8), true);

  const opts = { repoRoot: root, runId, runDir: dir };
  const projection = stateProjection.buildProjection(opts);
  assert.equal(projection.production_mode, 'DRAFT');
  assert.equal(projection.current_gate, 'rough-cut-review');
  assert.equal(stateProjection.trackerDivergence(opts).code, 'TRACKER_CONSISTENT');
  assert.deepEqual(stateProjection.consistencyReport(opts).defects, []);
});

/* ================== MODE BEHAVIOUR (§43, §44, §45) ======================== */

test('capture §44: REVIEW reuses the DRAFT capture and holds at gate 9', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { root, dir } = producedRun('review');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  captureChecklist.writeOutputs(dir, captureChecklist.buildOutputs(dir), true);
  captureEvidence.writeReview(dir, captureEvidence.buildReviewMarkdown(captureEvidence.evaluateCaptureEvidence(dir)), true);
  const before = gatePosition(root, dir);
  assert.equal(before.gate, 'rough-cut-review');

  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  // Entering REVIEW must not reopen capture the Draft legitimately earned.
  assert.deepEqual(gatePosition(root, dir), before);
  // And it must not regenerate anything either.
  assert.throws(() => materializer.materializeDraftProxyCaptureArtifacts(dir, {}),
    (error) => error.code === 'CAPTURE_MATERIALIZE_MODE_NOT_DRAFT');
});

test('capture §43: promoting to PRODUCTION reopens capture and keeps proxy as history', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { root, dir } = producedRun('promote');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  captureChecklist.writeOutputs(dir, captureChecklist.buildOutputs(dir), true);
  captureEvidence.writeReview(dir, captureEvidence.buildReviewMarkdown(captureEvidence.evaluateCaptureEvidence(dir)), true);
  assert.equal(gatePosition(root, dir).index, 9);

  productionMode.setProductionMode(dir, 'REVIEW', { setBy: 'editor (agent)' });
  productionMode.setProductionMode(dir, 'PRODUCTION', { setBy: 'Mikko' });

  // Real capture is now required, so the capture gates reopen.
  const after = gatePosition(root, dir);
  assert.equal(after.gate, 'capture-evidence');
  assert.ok(after.complete < 8, 'capture no longer counts as complete');
  const gate8 = captureEvidence.evaluateCaptureEvidence(dir);
  assert.equal(gate8.realCaptureEvidence, false);
  assert.equal(gate8.proxyCapture, null, 'proxy readiness is not applicable in PRODUCTION');
  assert.notEqual(gate8.status, 'PASS');

  // The proxy evidence survives as provenance from the approved draft.
  assert.equal(presenter.readEvidence(dir).state, 'VERIFIED');
  assert.equal(presenter.readEvidence(dir).satisfies_real_capture, false);
  assert.ok(fs.existsSync(path.join(dir, materializer.SIDECAR_FILE)));
});

test('capture §45: a script revision reopens gates 7 and 8 together', () => {
  if (!READY) { assert.ok(true, 'producers unavailable; skipped'); return; }
  const { root, dir } = producedRun('revision');
  materializer.materializeDraftProxyCaptureArtifacts(dir, {});
  captureChecklist.writeOutputs(dir, captureChecklist.buildOutputs(dir), true);
  captureEvidence.writeReview(dir, captureEvidence.buildReviewMarkdown(captureEvidence.evaluateCaptureEvidence(dir)), true);
  assert.equal(gatePosition(root, dir).index, 9);

  const target = path.join(dir, narration.MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  manifest.story.content_hash = '0'.repeat(64);
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));

  assert.equal(narration.narrationStatus(dir).valid, false);
  assert.equal(materializer.materializationStatus(dir).valid, false);
  assert.equal(captureChecklist.buildOutputs(dir).readiness.status, 'NEEDS CAPTURE');
  assert.notEqual(captureEvidence.evaluateCaptureEvidence(dir).status, 'PASS');
  assert.ok(gatePosition(root, dir).complete < 8, 'no inherited Draft completion');
});
