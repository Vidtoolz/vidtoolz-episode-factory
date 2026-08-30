'use strict';

const { test, tests, assert, fs, os, path } = require('./_helpers.js');
const authority = require('../scripts/production-assembly-execution-successor.js');

function semantic(overrides = {}) {
  return {
    schema: 'vidtoolz.productionAssemblyRenderPlan.v1', run_id: 'run-1',
    release_packet: { sha256: 'a'.repeat(64) }, handoff: { sha256: 'b'.repeat(64) },
    timeline: [{ section_id: 'S1', in_ms: 0, out_ms: 1000 }],
    assets: [{ asset_id: 'asset-1', sha256: 'c'.repeat(64) }],
    narration: { sha256: 'd'.repeat(64) }, composition: { sha256: 'e'.repeat(64), reveal_ms: 100, typography: { max_lines: 2 } },
    music: { sha256: 'f'.repeat(64) }, output: { width: 1080, height: 1920, fps: 30 },
    ...overrides,
  };
}
function plan(overrides = {}, invocation = ['ffmpeg', '-filter_complex', "text='old'"]) {
  const value = semantic(overrides); return { ...value, plan_digest_sha256: authority.digest(value), ffmpeg_invocation: invocation };
}
const failed = { schema: 'vidtoolz.productionAssemblyRenderState.v1', state: 'INCOMPLETE', phase: 'RENDER_FAILED' };
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected); }
function files() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-successor-')); const output = path.join(root, 'candidate.mp4');
  const old = plan(); const current = plan({}, ['ffmpeg', '-filter_complex', "text='new'"]);
  const paths = authority.basePaths(output, current); fs.writeFileSync(paths.plan, `${JSON.stringify(old, null, 2)}\n`); fs.writeFileSync(paths.state, `${JSON.stringify(failed, null, 2)}\n`);
  const source = path.join(root, 'renderer.js'); fs.writeFileSync(source, 'renderer-v2\n'); const implementation = authority.runtimeIdentity({ renderer: source }, { serializer: 'v2' });
  return { root, output, old, current, paths, implementation };
}

test('EXEC-01 failed attempt plus identical semantics and permitted serialization drift authorizes a successor', () => { assert.equal(authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed).retry_required, true); });
test('EXEC-02 completed predecessor rejects retry succession', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), { state: 'COMPLETE' }), 'EXECUTION_PREDECESSOR_COMPLETE'); });
test('EXEC-03 running predecessor rejects retry succession', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), { state: 'INCOMPLETE', phase: 'PLAN_FROZEN' }), 'EXECUTION_PREDECESSOR_RUNNING'); });
test('EXEC-04 changed semantic digest rejects', () => { code(() => authority.validateEligibility(plan(), plan({ run_id: 'run-2' }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-05 changed release rejects', () => { code(() => authority.validateEligibility(plan(), plan({ release_packet: { sha256: '1'.repeat(64) } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-06 changed handoff rejects', () => { code(() => authority.validateEligibility(plan(), plan({ handoff: { sha256: '1'.repeat(64) } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-07 changed asset hash rejects', () => { code(() => authority.validateEligibility(plan(), plan({ assets: [{ asset_id: 'asset-1', sha256: '1'.repeat(64) }] }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-08 changed narration rejects', () => { code(() => authority.validateEligibility(plan(), plan({ narration: { sha256: '1'.repeat(64) } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-09 changed composition rejects', () => { code(() => authority.validateEligibility(plan(), plan({ composition: { sha256: '1'.repeat(64), reveal_ms: 100, typography: { max_lines: 2 } } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-10 changed reveal semantics rejects', () => { code(() => authority.validateEligibility(plan(), plan({ composition: { sha256: 'e'.repeat(64), reveal_ms: 101, typography: { max_lines: 2 } } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-11 changed typography semantics rejects', () => { code(() => authority.validateEligibility(plan(), plan({ composition: { sha256: 'e'.repeat(64), reveal_ms: 100, typography: { max_lines: 3 } } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-12 changed music rejects', () => { code(() => authority.validateEligibility(plan(), plan({ music: { sha256: '1'.repeat(64) } }, ['ffmpeg', 'new']), failed), 'EXECUTION_SEMANTIC_DRIFT'); });
test('EXEC-13 unbound field drift cannot masquerade as execution drift', () => { const current = plan({}, ['ffmpeg', 'new']); current.environment = { threads: 2 }; code(() => authority.validateEligibility(plan(), current, failed), 'EXECUTION_SEMANTIC_DIGEST_INVALID'); });
test('EXEC-14 ffmpeg invocation is the sole accepted execution drift', () => { assert.deepEqual(authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed).changed_fields, ['ffmpeg_invocation[1]', 'ffmpeg_invocation[2]']); });
test('EXEC-15 missing predecessor rejects', () => { code(() => authority.validateEligibility(null, plan(), failed), 'EXECUTION_PREDECESSOR_REQUIRED'); });
test('EXEC-16 fabricated predecessor identity rejects', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed, { predecessorIdentityValid: false }), 'EXECUTION_PREDECESSOR_IDENTITY_INVALID'); });
test('EXEC-17 modified predecessor artifact rejects', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed, { predecessorModified: true }), 'EXECUTION_PREDECESSOR_MODIFIED'); });
test('EXEC-18 successor lineage loop rejects', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed, { lineageLoop: true }), 'EXECUTION_SUCCESSOR_LINEAGE_LOOP'); });
test('EXEC-19 duplicate different active successor rejects', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed, { duplicateActiveSuccessor: true }), 'EXECUTION_SUCCESSOR_ALREADY_ACTIVE'); });
test('EXEC-20 identical successor resolution is idempotent', () => { const f = files(); const first = authority.bindCurrentPlan(authority.resolveContext(f.paths, f.current, f.implementation, { now: '2026-08-30T10:00:00.000Z' }), f.current); authority.activateContext(first, f.paths); const second = authority.resolveContext(f.paths, f.current, f.implementation); assert.equal(first.attempt.attempt_id, second.attempt.attempt_id); assert.equal(second.created, false); });
test('EXEC-21 execution attempt and plan are immutable after creation', () => { const f = files(); const context = authority.bindCurrentPlan(authority.resolveContext(f.paths, f.current, f.implementation, { now: '2026-08-30T10:00:00.000Z' }), f.current); authority.activateContext(context, f.paths); const changed = { ...context.attempt, status: 'CHANGED' }; code(() => authority.writeImmutableJson(context.paths.attempt, changed), 'EXECUTION_ATTEMPT_IMMUTABLE'); });
test('EXEC-22 successful completion binding names the successor and predecessor', () => { const f = files(); const context = authority.resolveContext(f.paths, f.current, f.implementation, { now: '2026-08-30T10:00:00.000Z' }); const binding = authority.completionBinding(context); assert.equal(binding.attempt_id, context.attempt.attempt_id); assert.equal(binding.predecessor_attempt_id, context.attempt.predecessor.attempt_id); });
test('EXEC-23 failed predecessor plan remains byte-identical after activation', () => { const f = files(); const before = fs.readFileSync(f.paths.plan); const context = authority.bindCurrentPlan(authority.resolveContext(f.paths, f.current, f.implementation, { now: '2026-08-30T10:00:00.000Z' }), f.current); authority.activateContext(context, f.paths); assert.deepEqual(fs.readFileSync(f.paths.plan), before); });
test('EXEC-24 successor staging is attempt-scoped and does not consume legacy partial bytes', () => { const f = files(); fs.mkdirSync(path.dirname(f.paths.staged), { recursive: true }); fs.writeFileSync(f.paths.staged, 'legacy-partial'); const context = authority.resolveContext(f.paths, f.current, f.implementation); assert.notEqual(context.paths.staged, f.paths.staged); assert.equal(fs.readFileSync(f.paths.staged, 'utf8'), 'legacy-partial'); });
test('EXEC-25 caller cannot provide arbitrary ffmpeg invocation authority', () => { code(() => authority.validateEligibility(plan(), plan({}, ['ffmpeg', 'new']), failed, { callerInvocation: ['evil'] }), 'EXECUTION_INVOCATION_CALLER_FORBIDDEN'); });

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; process.stdout.write(`ok - ${item.name}\n`); }
      catch (caught) { process.stderr.write(`not ok - ${item.name}\n${caught.stack || caught}\n`); process.exitCode = 1; break; }
    }
    if (!process.exitCode) process.stdout.write(`${passed}/${tests.length} tests passed\n`);
  })();
}
