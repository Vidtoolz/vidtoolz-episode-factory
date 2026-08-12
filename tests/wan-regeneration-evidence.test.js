const { test, assert, fs, os, path } = require('./_helpers.js');
const evidence = require('../wan-regeneration-evidence.js');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wan-evidence-')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function attempt(id, index, regeneration, projectTime = '2026-08-12T10:00:00Z') {
  return {
    evidence_schema_version: 1,
    generation_semantics: regeneration ? 'intentional_regeneration' : 'first_generation',
    attempt_id: id, index, status: 'completed', profile: 'hq',
    dispatched_at: projectTime, finished_at: '2026-08-12T11:00:00Z',
    source: { sha256: `source-${id}` }, i2v: { sha256: `prompt-${id}` },
    output_rel: `videos/hq/${index}.mp4`, output: { sha256: `output-${id}` }, regeneration,
  };
}

test('wan regeneration reporter: empty evidence is read-only NOT_READY', () => {
  const r = root();
  const result = evidence.analyze({ aigenRoot: path.join(r, 'aigen'), superFocusRoot: path.join(r, 'sf') });
  assert.equal(result.readiness, 'NOT_READY');
  assert.equal(result.coverage.total_regeneration_events, 0);
  assert.equal(result.coverage.coverage_percent, null);
});

test('wan regeneration reporter: separates legacy objective delta from operator reason', () => {
  const r = root(); const file = path.join(r, 'sf', 'legacy-project', 'video-attempts.json');
  const a = attempt('a', 1, null); delete a.evidence_schema_version; delete a.generation_semantics;
  const b = attempt('b', 1, null); delete b.evidence_schema_version; delete b.generation_semantics;
  write(file, { version: 1, active: { 1: 'b' }, attempts: { a, b } });
  const result = evidence.analyze({ aigenRoot: path.join(r, 'aigen'), superFocusRoot: path.join(r, 'sf') });
  assert.equal(result.coverage.total_regeneration_events, 0);
  assert.equal(result.coverage.legacy_uninstrumented, 1);
  assert.equal(result.legacy_uninstrumented[0].historical_objective_delta.source_changed, true);
});

test('wan regeneration reporter: normalizes current Super Focus and AIGEN events', () => {
  const r = root(); const sf = path.join(r, 'sf', 'p1', 'video-attempts.json');
  const regen = { schema_version: 1, reason_code: 'motion_prompt_revision', previous_attempt_id: 'old', previous_output_sha256: 'oldhash', previous_output_path: 'old.mp4', prompt_changed: true };
  write(sf, { version: 1, active: { 1: 'new' }, attempts: { new: attempt('new', 1, regen) } });
  write(path.join(r, 'aigen', 'p2', 'videos', 'wan-regeneration-events.json'), { version: 1, events: [{ event_id: 'aigen:e1', project: 'p2', surface: 'aigen', reason: 'profile_or_configuration', previous_attempt_id: 'run-old', previous_output_sha256: 'old2', profile_changed: true, gpu_duration_hours: 0.5 }] });
  const result = evidence.analyze({ aigenRoot: path.join(r, 'aigen'), superFocusRoot: path.join(r, 'sf') });
  assert.equal(result.coverage.total_regeneration_events, 2);
  assert.equal(result.coverage.diagnosed, 2);
  assert.equal(result.surfaces.super_focus, 1);
  assert.equal(result.surfaces.aigen, 1);
  assert.equal(result.objective_deltas.prompt_changed_only, 1);
  assert.equal(result.objective_deltas.profile_changed_only, 1);
});

test('wan regeneration reporter: readiness boundary requires 20 events, 3 projects, 3 categories, 10 durations, and <=70% concentration', () => {
  const r = root();
  const reasons = ['source_image_revision', 'motion_prompt_revision', 'stochastic_alternate'];
  for (let p = 0; p < 3; p += 1) {
    const attempts = {};
    const count = p === 0 ? 10 : 5;
    for (let i = 0; i < count; i += 1) {
      const id = `p${p}-${i}`;
      attempts[id] = attempt(id, i + 1, { schema_version: 1, reason_code: reasons[i % reasons.length], previous_attempt_id: `old-${id}`, previous_output_sha256: `hash-${id}`, previous_output_path: `old-${id}.mp4` });
    }
    write(path.join(r, 'sf', `p${p}`, 'video-attempts.json'), { version: 1, active: {}, attempts });
  }
  const result = evidence.analyze({ aigenRoot: path.join(r, 'aigen'), superFocusRoot: path.join(r, 'sf') });
  assert.equal(result.coverage.diagnosed, 20);
  assert.equal(result.readiness, 'READY_FOR_PARETO_REVIEW');
});

test('wan regeneration reporter: broken current lineage is surfaced without mutating evidence', () => {
  const r = root(); const file = path.join(r, 'sf', 'p1', 'video-attempts.json');
  write(file, { version: 1, active: {}, attempts: { x: attempt('x', 1, { schema_version: 1, reason_code: 'other', note: 'known operator note' }) } });
  const before = fs.readFileSync(file, 'utf8');
  const result = evidence.analyze({ aigenRoot: path.join(r, 'aigen'), superFocusRoot: path.join(r, 'sf') });
  assert.ok(result.lineage_integrity.issues.some((x) => x.predecessor === 'missing_predecessor_attempt'));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
