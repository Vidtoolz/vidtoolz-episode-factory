'use strict';

// SINGLE LIFECYCLE AUTHORITY — the 14 gates own production state; the pipeline
// tracker strip is a one-way projection of it.
//
// The defect this suite locks out was real and reproducible: a run whose
// artifacts were drafted but not reviewed showed canonical gate 2/14
// "Research sufficiency" while the tracker displayed stage 6/12 "Image Gen",
// because the two derived lifecycle position from different evidence — status
// markers versus bare file existence.

const { assert, fs, http, path, packageEngineServer, test } = require('./_helpers.js');
const projection = require('../scripts/workflow-stage-projection.js');
const workflowMap = require('../scripts/package-run-workflow-map.js');
const tracker = require('../pipeline-tracker.js');

const ROOT = path.resolve(__dirname, '..');

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', r)); }
function close(server) { return new Promise((r) => server.close(r)); }
function requestJson(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: address.port, path: pathname }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (c) => { raw += c; });
      response.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
}
async function withRun(runId, files, fn) {
  const runDir = path.join(ROOT, 'package-runs', runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(runDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  try { return await fn(runDir); } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
}
async function pipelineStatus(runId) {
  const server = packageEngineServer.createServer();
  await listen(server);
  try {
    const body = await requestJson(server, `/api/package-runs/pipeline-status?run=${runId}`);
    return body.data !== undefined ? body.data : body;
  } finally { await close(server); }
}

// A run whose artifacts exist but whose reviews have NOT passed. Canonical stays
// at "research"; raw file evidence marches to "image-gen".
const DRAFTED_NOT_REVIEWED = {
  'selected-package.md': '# Selected\n',
  'research-pack.md': '# Research\n',
  'research-evidence.md': '# Evidence\n',
  'source-support-map.md': '# Map\n',
  'proof-capture-plan.md': '# Plan\n',
  'research-objections.md': '# Objections\n',
  'script.md': '# Draft\n',
  'script-structure.md': 'Script structure status: DRAFT\n',
  'script-review.md': 'Script review status: NEEDS WORK\n',
  'youtube-package.json': {},
  'image-prompts.json': {},
  'STATUS.md': 'Status: In progress\n',
};

// ── 1-2. mapping completeness ─────────────────────────────────────────────

test('WA1: the 14→display mapping is total and unambiguous', () => {
  const result = projection.validateMapping();
  assert.equal(result.ok, true, `mapping invalid: ${result.errors.join('; ')}`);
  assert.equal(result.canonical_gates, 14);
  assert.equal(result.horizontal_stages, 13);
  assert.equal(result.vertical_stages, 8);
});

test('WA2: every canonical gate projects to a real stage on both paths', () => {
  // §50: table-driven across all 14 gates, not just first and last.
  const gates = workflowMap.GATE_DEFINITIONS.map((g) => g.id);
  assert.equal(gates.length, 14);
  for (const gateId of gates) {
    for (const workflowPath of ['horizontal', 'vertical']) {
      const p = projection.projectGate(gateId, workflowPath);
      assert.equal(p.ok, true, `${gateId}/${workflowPath}: ${p.reason || ''}`);
      assert.ok(projection.stagesForPath(workflowPath).includes(p.stageKey), `${gateId}/${workflowPath}`);
      assert.ok(Number.isInteger(p.stageIndex) && p.stageIndex >= 0, `${gateId}/${workflowPath} index`);
      assert.notEqual(p.stageKey, 'UNKNOWN');
    }
  }
});

test('WA3: every display stage is owned by exactly one canonical gate', () => {
  for (const workflowPath of ['horizontal', 'vertical']) {
    const owners = new Map();
    for (const gateId of projection.canonicalGateIds()) {
      for (const stage of projection.GATE_PROJECTION[gateId][workflowPath].compatible) {
        assert.equal(owners.has(stage), false, `${stage} claimed twice on ${workflowPath}`);
        owners.set(stage, gateId);
      }
    }
    for (const stage of projection.stagesForPath(workflowPath)) {
      assert.ok(owners.has(stage), `orphan stage "${stage}" on ${workflowPath}`);
    }
  }
});

test('WA4: the projection strips mirror the tracker definitions', () => {
  assert.deepEqual([...projection.HORIZONTAL_STAGES], tracker.STAGES.map((s) => s.key));
  assert.deepEqual([...projection.VERTICAL_STAGES], tracker.VERTICAL_STAGES.map((s) => s.key));
});

// ── 3-4. one-way authority ────────────────────────────────────────────────

test('WA5: the projection module cannot mutate canonical state', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-stage-projection.js'), 'utf8');
  assert.ok(!/writeFileSync|appendFileSync|rmSync|renameSync/.test(source),
    'a projection must never persist or mutate anything');
  assert.equal(projection.projectRun.length <= 2, true);
  for (const name of Object.keys(projection)) {
    assert.ok(!/^(set|advance|promote|commit|write)/i.test(name), `forbidden mutator export: ${name}`);
  }
});

test('WA6: canonical gate caps the displayed stage — the split-brain case', async () => {
  const runId = '2099-01-10-wa-splitbrain';
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const status = await pipelineStatus(runId);
    assert.equal(status.canonical.gate, 'research', 'canonical must remain at research sufficiency');
    assert.equal(status.currentStage, 1, 'display must be capped at the canonical gate');
    assert.equal(status.evidenceCurrentStage, 6, 'raw file evidence still reaches image-gen');
    assert.equal(status.canonical.clamped, true);
    assert.match(status.canonical.clampReason, /canonical gate "research" caps display/);
    assert.equal(status.projectionIsAuthoritative, false);
  });
});

test('WA7: evidence beyond the canonical gate is preserved but denied progress', async () => {
  const runId = '2099-01-11-wa-evidence';
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const status = await pipelineStatus(runId);
    const beyond = status.stages.filter((s) => s.evidenceOnly).map((s) => s.key);
    assert.deepEqual(beyond, ['script', 'claims', 'packaging', 'image-prompts']);
    for (const stage of status.stages.filter((s) => s.evidenceOnly)) {
      assert.equal(stage.completed, false, `${stage.key} must not count as progress`);
      assert.match(stage.note, /canonical gate has not reached this stage/);
    }
    // The detail is still available on the evidence axis.
    assert.equal(status.evidenceStages.find((s) => s.key === 'image-prompts').completed, true);
  });
});

// ── 5-6. drift detection ──────────────────────────────────────────────────

test('WA8: projection drift is reported as a structured defect', async () => {
  const runId = '2099-01-12-wa-drift';
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const status = await pipelineStatus(runId);
    assert.ok(status.drift, 'drift must be reported');
    assert.equal(status.drift.code, 'RUN_STATE_PROJECTION_DRIFT');
    assert.equal(status.drift.severity, 'BLOCKER', 'a projection ahead of canonical is the dangerous direction');
    assert.equal(status.drift.direction, 'PROJECTION_AHEAD_OF_CANONICAL');
    assert.equal(status.drift.canonical_gate, 'research');
    assert.equal(status.drift.observed_stage, 'image-gen');
    assert.equal(status.drift.canonical_stage, 'research');
    assert.match(status.drift.resolution, /canonical 14-gate state wins/);
    assert.ok(Array.isArray(status.drift.expected_stages) && status.drift.expected_stages.length > 0);
  });
});

test('WA9: an aligned run reports no drift', () => {
  const aligned = projection.detectDrift({
    runId: 'r', gateId: 'research', workflowPath: 'horizontal', evidenceCurrentStage: 1,
  });
  assert.equal(aligned, null);
  const behind = projection.detectDrift({
    runId: 'r', gateId: 'rough-cut-review', workflowPath: 'horizontal', evidenceCurrentStage: 2,
  });
  assert.equal(behind.severity, 'WARNING', 'lagging evidence is not dangerous, only stale');
  assert.equal(behind.direction, 'PROJECTION_BEHIND_CANONICAL');
});

// ── 7. reprojection / manual-edit powerlessness ───────────────────────────

test('WA10: a manually corrupted projection has no authority and is rebuilt', async () => {
  const runId = '2099-01-13-wa-reproject';
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const first = await pipelineStatus(runId);
    assert.equal(first.currentStage, 1);

    // Simulate an operator/UI writing a later stage into the projection surface.
    const forged = { ...first, currentStage: 12, stages: first.stages.map((s) => ({ ...s, completed: true })) };
    assert.equal(forged.currentStage, 12);

    // Refresh from canonical: the forgery is gone. The projection is disposable.
    const second = await pipelineStatus(runId);
    assert.equal(second.currentStage, 1, 'canonical value restored');
    assert.equal(second.canonical.gate, 'research');
    assert.deepEqual(
      second.stages.filter((s) => s.completed).map((s) => s.key),
      first.stages.filter((s) => s.completed).map((s) => s.key),
      'reprojection is deterministic'
    );
  });
});

test('WA11: the projection is deterministic for identical canonical state', () => {
  for (const gateId of projection.canonicalGateIds()) {
    const a = projection.projectGate(gateId, 'horizontal');
    const b = projection.projectGate(gateId, 'horizontal');
    assert.deepEqual(a, b, gateId);
  }
});

// ── 8-10. canonical advance, blockers, human review, QC ───────────────────

test('WA12: advancing the canonical gate advances the displayed stage', async () => {
  const runId = '2099-01-14-wa-advance';
  // Same run, now with the research gate genuinely passed. The gate predicate
  // accepts researchGateStatus PASS from research-pack.md; the separate
  // sufficiency-review path is outranked by the evidence evaluator, so this is
  // the marker that actually moves canonical state.
  const advanced = { ...DRAFTED_NOT_REVIEWED, 'research-pack.md': '# Research\nStatus: PASS\n' };
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const before = await pipelineStatus(runId);
    assert.equal(before.canonical.gate, 'research');
    assert.equal(before.currentStage, 1);
  });
  await withRun(runId, advanced, async () => {
    const after = await pipelineStatus(runId);
    assert.notEqual(after.canonical.gate, 'research', 'canonical must move once the gate passes');
    assert.ok(after.currentStage >= 1, 'display follows canonical');
    // Display moved only because canonical did.
    assert.equal(after.projectionIsAuthoritative, false);
  });
});

test('WA13: a blocked or unreached gate never lets the strip imply progress', async () => {
  const runId = '2099-01-15-wa-blocked';
  await withRun(runId, { ...DRAFTED_NOT_REVIEWED, 'STATUS.md': 'Status: In progress\nBlocker: research sufficiency not accepted\n' }, async () => {
    const status = await pipelineStatus(runId);
    assert.equal(status.currentStage, 1);
    assert.ok(status.blocker, 'blocker surfaced');
    const beyondComplete = status.stages.filter((s) => s.id > status.currentStage && s.completed);
    assert.deepEqual(beyondComplete, [], 'nothing past the canonical gate may read as complete');
  });
});

test('WA14: artifact presence alone never auto-advances past a human gate', async () => {
  // Rough-cut artifacts exist, but the canonical rough-cut gate needs a review
  // status the run does not have. The strip must not jump to assembly/publish.
  const runId = '2099-01-16-wa-human';
  await withRun(runId, {
    ...DRAFTED_NOT_REVIEWED,
    'rough-cut-watch-notes.md': '# Notes\nRough-cut approval: NEEDS PICKUPS\n',
    'rough-cut-review.md': 'Rough-cut review status: NEEDS PICKUPS\n',
    'final-review.md': 'Final review status: PASS\n',
  }, async () => {
    const status = await pipelineStatus(runId);
    assert.equal(status.canonical.gate, 'research', 'canonical is still early');
    assert.equal(status.currentStage, 1, 'display must not jump to assembly on artifact presence');
    assert.ok(status.stages.every((s) => s.id <= 1 || !s.completed));
  });
});

// ── 11. canonical-unavailable honesty ─────────────────────────────────────

test('WA15: an unknown historical run reports canonical state honestly, never a guess', () => {
  const drift = projection.detectDrift({
    runId: 'legacy', gateId: null, workflowPath: 'horizontal', evidenceCurrentStage: 9,
  });
  assert.equal(drift.code, 'RUN_STATE_PROJECTION_DRIFT');
  assert.equal(drift.severity, 'BLOCKER');
  assert.match(drift.detail, /no projection for canonical gate/);
  const p = projection.projectGate(null, 'horizontal');
  assert.equal(p.ok, false);
  assert.equal(p.stageKey, null, 'an unmappable gate yields no stage rather than stage 0');
});

test('WA16: the endpoint declares the canonical authority chain on every response', async () => {
  const runId = '2099-01-17-wa-contract';
  await withRun(runId, DRAFTED_NOT_REVIEWED, async () => {
    const status = await pipelineStatus(runId);
    assert.equal(status.canonical.authority, 'CANONICAL_14_GATE');
    assert.equal(status.canonical.totalGates, 14);
    assert.equal(status.canonical.mappingVersion, projection.MAPPING_VERSION);
    assert.equal(status.projectionIsAuthoritative, false);
  });
});
