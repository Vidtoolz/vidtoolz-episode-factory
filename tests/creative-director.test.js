'use strict';

const { assert, childProcess, fs, path, test } = require('./_helpers.js');
const os = require('os');
const director = require('../scripts/creative-director.js');
const cd = require('../scripts/creative-direction.js');
const assembler = require('../scripts/agent-task-creative-direction.js');
const runner = require('../scripts/agent-run.js');
const dispatchAuthority = require('../scripts/agent-dispatch-authority.js');

const ROOT = path.join(__dirname, '..');
const PACKAGE_FIXTURE = path.join(__dirname, 'fixtures', 'creative-director', 'discovery-package.json');
const STYLE_FIXTURE = path.join(__dirname, 'fixtures', 'style-reference', 'VIDTOOLZ_STYLE_REFERENCE_V1.json');
const STYLE_SHA = 'b357d23956bc3fd7a956372347e59cae4b10bb0064d3e9b19ec2819207fa8e41';
const STYLE_CONFIG = { referencePath: STYLE_FIXTURE, expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: STYLE_SHA } };

const clone = (v) => structuredClone(v);
const ROUTE = { ok: true, decision: 'ROUTE', selected_host: 'test', endpoint: 'http://test', model: 'test-model' };
const routeSelector = () => ({ ...ROUTE });

function makeTask(overrides = {}) {
  const task = assembler.assembleCreativeDirectionTask({
    taskId: 'task-cd-0001', requestedBy: 'mikko', projectId: 'project-cd-0001',
    script: { discoveryPackagePath: PACKAGE_FIXTURE },
    styleReference: STYLE_CONFIG,
    humanConstraints: overrides.humanConstraints || [],
  });
  return Object.assign(task, overrides.task || {});
}

const SECTION_REFS = ['beat-01', 'beat-02', 'beat-03', 'beat-04'];

function makeSemantic(overrides = {}) {
  const semantic = {
    creative_thesis: { statement: 'Consistency, not spectacle, is the channel-building act; the episode should feel like calm compounding.', experience_goal: 'The viewer leaves convinced that cadence beats peaks and knows the one habit to fix.' },
    tone: { register: 'serious, precise, quietly confident', energy_arc: 'steady build from contradiction to a settled, actionable close' },
    humor: { mode: 'NONE', placement_guidance: null, provenance: 'SCRIPT_EVIDENCE' },
    visual_mode_mix: [
      { mode: 'EXPLANATION', weight: 'DOMINANT', rationale: 'the argument is mechanism-driven (compounding)' },
      { mode: 'COMPARISON', weight: 'PRESENT', rationale: 'launch-vs-cadence is the core contrast' },
      { mode: 'PROOF', weight: 'MINIMAL', rationale: 'one compounding-curve moment suffices' },
      { mode: 'MOOD', weight: 'PRESENT', rationale: 'quiet, patient atmosphere between cards' },
      { mode: 'HUMOR', weight: 'ABSENT', rationale: '' },
      { mode: 'PUNCTUATION', weight: 'MINIMAL', rationale: 'hard stop on the final directive' },
    ],
    density_arc: { shape: 'QUIET open, READABLE middle, one DENSE synthesis before a QUIET close', movements: [
      { section_ref: 'beat-01', density_group: 'QUIET', note: 'contradiction breathes' },
      { section_ref: 'beat-02', density_group: 'READABLE', note: 'mechanism card' },
      { section_ref: 'beat-03', density_group: 'READABLE', note: 'reframe comparison' },
      { section_ref: 'beat-04', density_group: 'DENSE', note: 'action synthesis then relief' },
    ], relief_points: 'after the beat-04 synthesis card, no new information' },
    level_a_strategy: { macro_philosophy: 'backdrop states change on claim turns, not on a clock' },
    level_b_strategy: { evolution_philosophy: 'each state keeps evolving via card state changes and reframes', emphasis_moments: ['the reframe at beat-03', 'the directive at beat-04'] },
    level_c_strategy: { life_sources: ['GRAPHIC_EVOLUTION', 'DRIFT', 'SLOW_PAN'], static_policy: 'stillness only while a dense card is being read' },
    presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'persistent unboxed presenter in final style', compensation_directive: 'every hold carries plate drift or graphic evolution; the compounding curve animates continuously through beats 2-4', provenance: 'CD_JUDGMENT' },
    card_strategy: { role: 'cards carry the mechanism and the directive', argument_sections_needing_cards: ['beat-02', 'beat-04'], patterns_suggested: ['LABELLED_CONCEPT', 'SYNTHESIS_CARD', 'TAKEAWAY_FOOTER'], restraint: 'beat-01 stays cardless and atmospheric' },
    media_strategy: { generation_philosophy: 'one metaphor world (deposits/interest) generated once and reused at multiple scales', reuse_directive: 'prefer reframes and card evolution over new assets', locked_scopes: [], replacement_requests: [] },
    motion_character: { description: 'slow, single-vector, patient; motion mirrors compounding — small and continuous' },
    typography_mode: { register: 'hierarchical, short structured text', full_frame_moments: ['the reframe one-liner at beat-03'] },
    ending_strategy: { mode: 'SYNTHESIS_CARD', description: 'dense action card with footer takeaway, hard stop', footer_takeaway_seed: 'Cadence is the asset.' },
    coherence: { sound_music_intent: 'steady low-pulse bed that never peaks', music_locked: false, packaging_intent: 'sell the calm certainty of compounding, not urgency' },
    intentional_deviations: [],
    human_decisions_required: [],
    confidence: [{ aspect: 'density arc', level: 'HIGH', basis: 'SCRIPT_EVIDENCE' }],
    style_patterns_cited: ['P-02', 'P-15', 'PAT-14'],
    constraint_compliance: [],
  };
  return Object.assign(semantic, clone(overrides));
}

function adapterFor(semantic) {
  return async () => JSON.stringify(semantic);
}

async function runDirector(task, semantic, options = {}) {
  return director.run(task, { routeSelector, modelAdapter: adapterFor(semantic), ...options });
}

// ── schema + happy path ─────────────────────────────────────────────────────

test('CD1: a compliant semantic yields a validated direction, PREVIEW_ONLY for an unapproved candidate script, next_owner mikko', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  assert.equal(out.state, 'PREVIEW_ONLY');
  assert.equal(out.next_owner, 'mikko');
  assert.equal(out.validation.ok, true, out.validation.errors.join('; '));
  assert.equal(out.creative_direction.schema, 'vidtoolz.creativeDirection.v1');
  assert.match(out.creative_direction.direction_id, /^creative-direction-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  assert.equal(out.creative_direction.script_identity.kind, 'CANDIDATE_SCRIPT');
  assert.equal(out.creative_direction.style_reference_binding.status, 'ACTIVE_ADVISORY');
  assert.equal(out.creative_direction.style_reference_binding.sha256, STYLE_SHA);
});

test('CD2: direction digest is canonical and drift is detected', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const direction = clone(out.creative_direction);
  assert.equal(cd.directionDigest(direction), direction.direction_digest_sha256);
  direction.tone.register = 'tampered';
  const check = cd.validateDirection(direction, { task: { section_refs: SECTION_REFS } });
  assert.ok(check.errors.some((e) => /digest mismatch/.test(e)));
});

test('CD3: run envelope satisfies the canonical runner envelope contract', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const envelope = { ...out, control_room: director.controlRoomView(out) };
  assert.equal(runner.validateEnvelope(envelope, 'creative_director', 'task-cd-0001'), null);
});

// ── identity bindings ───────────────────────────────────────────────────────

test('CD4: script identity drift voids the direction (SCRIPT_IDENTITY_DRIFT)', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const direction = clone(out.creative_direction);
  const otherIdentity = clone(direction.script_identity);
  otherIdentity.script_sha256 = 'f'.repeat(64);
  const check = cd.validateDirection(direction, { task: { script_identity: otherIdentity, section_refs: SECTION_REFS } });
  assert.ok(check.errors.some((e) => /SCRIPT_IDENTITY_DRIFT/.test(e)));
});

test('CD5: script content that does not hash to the bound identity is refused at preflight', async () => {
  const task = makeTask();
  task.script_content.sections[0].text = 'mutated dialogue that no longer matches the bound script bytes';
  const out = await runDirector(task, makeSemantic());
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /SCRIPT_CONTENT_HASH_MISMATCH/);
});

test('CD6: style-reference binding drift is refused; absence is never silently upgraded', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const direction = clone(out.creative_direction);
  const check = cd.validateDirection(direction, { task: { style_reference: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V2', sha256: 'a'.repeat(64) }, section_refs: SECTION_REFS } });
  assert.ok(check.errors.some((e) => /STYLE_REFERENCE_DRIFT/.test(e)));
  const fabricated = cd.validateDirection(direction, { task: { style_reference: null, section_refs: SECTION_REFS } });
  assert.ok(fabricated.errors.some((e) => /STYLE_AUTHORITY_FABRICATED/.test(e)));
});

test('CD7: a task claiming ACTIVE_ADVISORY without human-approval evidence is refused at preflight', async () => {
  const task = makeTask();
  task.style_reference.human_approved = false;
  const out = await runDirector(task, makeSemantic());
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /STYLE_AUTHORITY_FABRICATED/);
});

test('CD8: with no style reference the direction must declare ABSENT and still validates', async () => {
  const task = makeTask();
  task.style_reference = null;
  const out = await runDirector(task, makeSemantic({ style_patterns_cited: [] }));
  assert.equal(out.state, 'PREVIEW_ONLY');
  assert.equal(out.creative_direction.style_reference_binding.status, 'ABSENT');
});

// ── human override precedence (hard local constraints) ─────────────────────

const SERIOUS = { constraint_id: 'hc-serious', type: 'TONE_SERIOUS', text: 'make this one serious' };

test('CD9: TONE_SERIOUS contradicted by comic output is a validation failure, so the run escalates instead of shipping it', async () => {
  const task = makeTask({ humanConstraints: [SERIOUS] });
  const bad = makeSemantic({ humor: { mode: 'COMIC', placement_guidance: 'jokes everywhere', provenance: 'CD_JUDGMENT' }, constraint_compliance: [{ constraint_id: 'hc-serious', compliance: 'ignored' }] });
  const out = await runDirector(task, bad);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /CONSTRAINT_CONTRADICTION hc-serious/);
});

test('CD10: TONE_SERIOUS honored passes, with the constraint echoed and compliance recorded', async () => {
  const task = makeTask({ humanConstraints: [SERIOUS] });
  const good = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-serious', compliance: 'humor mode NONE; HUMOR visual weight ABSENT' }] });
  const out = await runDirector(task, good);
  assert.equal(out.state, 'PREVIEW_ONLY');
  const echo = out.creative_direction.human_directions_received.find((c) => c.constraint_id === 'hc-serious');
  assert.equal(echo.type, 'TONE_SERIOUS');
  assert.ok(echo.compliance.length > 0);
});

test('CD11: PRESENTER_FREE_DRAFT wins over house presenter pattern, and compensation is mandatory (P-02)', async () => {
  const constraint = { constraint_id: 'hc-pf', type: 'PRESENTER_FREE_DRAFT', text: 'no presenter in draft' };
  const task = makeTask({ humanConstraints: [constraint] });
  const live = makeSemantic({ presenter_policy: { draft_mode: 'LIVE', final_intent: 'x', compensation_directive: '', provenance: 'STYLE_REFERENCE' }, constraint_compliance: [{ constraint_id: 'hc-pf', compliance: 'noted' }] });
  const outLive = await runDirector(task, live);
  assert.equal(outLive.state, 'ESCALATED');
  assert.match(outLive.reason, /CONSTRAINT_CONTRADICTION hc-pf/);
  const noComp = makeSemantic({ presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'x', compensation_directive: '', provenance: 'HUMAN_DIRECTION' }, constraint_compliance: [{ constraint_id: 'hc-pf', compliance: 'presenter-free draft' }] });
  const outNoComp = await runDirector(task, noComp);
  assert.equal(outNoComp.state, 'ESCALATED');
  assert.match(outNoComp.reason, /compensation_directive/);
  const good = makeSemantic({ presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'persistent presenter later', compensation_directive: 'graphic evolution and plate drift carry every hold', provenance: 'HUMAN_DIRECTION' }, constraint_compliance: [{ constraint_id: 'hc-pf', compliance: 'presenter-free with continuous-life substitute' }] });
  const outGood = await runDirector(task, good);
  assert.equal(outGood.state, 'PREVIEW_ONLY');
});

test('CD12: NO_CARDS_SECTION beats style card suggestions for the constrained section', async () => {
  const constraint = { constraint_id: 'hc-nocards', type: 'NO_CARDS_SECTION', scope: 'beat-02', text: 'avoid cards in this section' };
  const task = makeTask({ humanConstraints: [constraint] });
  const bad = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-nocards', compliance: 'kept cards anyway' }] });
  const outBad = await runDirector(task, bad);
  assert.equal(outBad.state, 'ESCALATED');
  assert.match(outBad.reason, /CONSTRAINT_CONTRADICTION hc-nocards/);
  const good = makeSemantic({ card_strategy: { role: 'cards carry the directive only', argument_sections_needing_cards: ['beat-04'], patterns_suggested: ['SYNTHESIS_CARD'], restraint: 'beat-02 stays atmospheric per human direction' }, constraint_compliance: [{ constraint_id: 'hc-nocards', compliance: 'beat-02 excluded from card sections' }] });
  const outGood = await runDirector(task, good);
  assert.equal(outGood.state, 'PREVIEW_ONLY');
});

test('CD13: KEEP_MEDIA locks a scope — unechoed lock or replacement request is a contradiction', async () => {
  const constraint = { constraint_id: 'hc-keep', type: 'KEEP_MEDIA', scope: 'beat-03', text: 'KEEP all images in the reframe section' };
  const task = makeTask({ humanConstraints: [constraint] });
  const unechoed = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }] });
  const outUnechoed = await runDirector(task, unechoed);
  assert.equal(outUnechoed.state, 'ESCALATED');
  assert.match(outUnechoed.reason, /locked_scopes must echo beat-03/);
  const replacing = makeSemantic({ media_strategy: { generation_philosophy: 'x', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: ['beat-03'] }, constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }] });
  const outReplacing = await runDirector(task, replacing);
  assert.equal(outReplacing.state, 'ESCALATED');
  assert.match(outReplacing.reason, /replacement requested for locked scope/);
});

test('CD14: MUSIC_LOCK forces coherence.music_locked', async () => {
  const constraint = { constraint_id: 'hc-music', type: 'MUSIC_LOCK', text: 'do not change music' };
  const task = makeTask({ humanConstraints: [constraint] });
  const bad = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-music', compliance: 'noted' }] });
  const outBad = await runDirector(task, bad);
  assert.equal(outBad.state, 'ESCALATED');
  assert.match(outBad.reason, /music_locked/);
});

test('CD15: conflicting human constraints escalate with both positions preserved, before any model call', async () => {
  let calls = 0;
  const task = makeTask({ humanConstraints: [SERIOUS, { constraint_id: 'hc-funny', type: 'TONE_MORE_HUMOR', text: 'use more humor' }] });
  const out = await director.run(task, { routeSelector, modelAdapter: async () => { calls += 1; return '{}'; } });
  assert.equal(out.state, 'ESCALATED');
  assert.equal(out.next_owner, 'mikko');
  assert.match(out.reason, /CONSTRAINT_CONFLICT: TONE_SERIOUS vs TONE_MORE_HUMOR/);
  assert.equal(calls, 0, 'constraint conflicts must never be resolved by the model');
});

// ── specialist ownership boundaries ─────────────────────────────────────────

test('CD16: shot geometry, asset selection, script text, and timing vocabulary are forbidden output', async () => {
  for (const poison of [{ card_strategy: { role: 'x', shots: [{}] } }, { media_strategy: { generation_philosophy: 'x', selected_asset_id: 'a1' } }, { level_b_strategy: { evolution_philosophy: 'x', dialogue: 'rewrite' } }, { motion_character: { description: 'x', duration_s: 4 } }]) {
    const out = await runDirector(makeTask(), makeSemantic(poison));
    assert.equal(out.state, 'ESCALATED', JSON.stringify(poison));
    assert.match(out.reason, /forbidden field/);
  }
});

test('CD17: unknown semantic root keys are rejected (no scope creep)', async () => {
  const out = await runDirector(makeTask(), makeSemantic({ shot_list: [] }));
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /unknown root field shot_list|forbidden field/);
});

test('CD18: specialist projections carry WHY/WHAT-EXPERIENCE, never another domain\'s executables', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const direction = out.creative_direction;
  const editor = director.specialistProjection(direction, 'editor');
  assert.ok(editor.pace_character && editor.density_arc && editor.ending_strategy);
  assert.equal('card_strategy' in editor, false);
  assert.equal('media_strategy' in editor, false);
  const sound = director.specialistProjection(direction, 'sound_music_director');
  assert.ok(sound.sound_music_intent);
  assert.equal('density_arc' in sound, false);
  const qc = director.specialistProjection(direction, 'qc_director');
  assert.equal(qc.full_artifact_required, true);
  assert.ok(qc.direction_ref.direction_digest_sha256);
  assert.equal(director.specialistProjection(direction, 'renderer'), null);
});

// ── escalation discipline ───────────────────────────────────────────────────

test('CD19: consequential ambiguity escalates as NEEDS_HUMAN_DECISION with typed questions', async () => {
  const semantic = makeSemantic({ human_decisions_required: [{ type: 'ENDING_TONE_REQUIRES_HUMAN', question: 'Synthesis card or a dry joke button?', why_consequential: 'the script supports both closes and they read very differently' }] });
  const out = await runDirector(makeTask(), semantic);
  assert.equal(out.state, 'NEEDS_HUMAN_DECISION');
  assert.equal(out.next_owner, 'mikko');
  assert.match(out.reason, /ENDING_TONE_REQUIRES_HUMAN/);
});

test('CD20: over-escalation is invalid — at most four consequential human decisions', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ type: 'HUMAN_TASTE_REQUIRED', question: `q${i}`, why_consequential: 'w' }));
  const out = await runDirector(makeTask(), makeSemantic({ human_decisions_required: many }));
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /over-escalation/);
});

test('CD21: intentional deviations need a pattern ref, a creative reason, and requires_human', async () => {
  const bad = makeSemantic({ intentional_deviations: [{ pattern_ref: 'VIBES', deviation: 'x', creative_reason: 'y', requires_human: false }] });
  const outBad = await runDirector(makeTask(), bad);
  assert.equal(outBad.state, 'ESCALATED');
  assert.match(outBad.reason, /pattern_ref invalid|requires_human/);
  const good = makeSemantic({ ending_strategy: { mode: 'EXPLICIT_DEVIATION', description: 'ends on raw atmospheric footage by intent', footer_takeaway_seed: null }, intentional_deviations: [{ pattern_ref: 'P-12', deviation: 'no designed ending card', creative_reason: 'the episode argues for quiet consistency; a designed crescendo would contradict it', requires_human: true }] });
  const outGood = await runDirector(makeTask(), good);
  assert.equal(outGood.state, 'PREVIEW_ONLY');
});

// ── local model safety ──────────────────────────────────────────────────────

test('CD22: malformed and overconfident model output fails closed to ESCALATED after retries — no artifact ships', async () => {
  const garbage = await director.run(makeTask(), { routeSelector, modelAdapter: async () => 'not json at all' });
  assert.equal(garbage.state, 'ESCALATED');
  assert.equal(garbage.creative_direction, null);
  const overreach = await runDirector(makeTask(), makeSemantic({ coherence: { sound_music_intent: 'x', music_locked: false, packaging_intent: 'y', approval: 'GRANTED' } }));
  assert.equal(overreach.state, 'ESCALATED');
  assert.match(overreach.reason, /forbidden field .*approval/);
});

test('CD23: the module performs no direct state mutation — no filesystem writes exist in its source', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'creative-director.js'), 'utf8');
  for (const forbidden of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'mkdirSync', 'renameSync']) {
    assert.equal(source.includes(forbidden), false, `module must not call ${forbidden}`);
  }
  assert.equal('AGENT_ID' in cd, false, 'validation library must not be an agent');
  assert.equal('AGENT_ID' in assembler, false, 'assembler must not be an agent');
});

// ── dispatch stays fail-closed on the live registry ─────────────────────────

test('CD24: live dispatch is refused fail-closed even though the module now exists', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const registration = registry.agents.find((a) => a.agent_id === 'creative_director');
  const readiness = dispatchAuthority.implementationReadiness(ROOT, registration);
  assert.equal(readiness.authorized, false);
  assert.equal(readiness.code, 'BLOCKED_AGENT_NOT_ENABLED');
  assert.equal(readiness.module_exists, true, 'the module exists; only the lifecycle gate refuses');
  assert.throws(() => runner.resolveAgent(ROOT, 'creative_director'), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
});

test('CD25: in an isolated enabled test root the canonical runner loads the module (proves enablement-readiness without touching the live registry)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-enabled-root-'));
  fs.mkdirSync(path.join(tmp, 'config'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-contract.json'), 'utf8'));
  const cdReg = registry.agents.find((a) => a.agent_id === 'creative_director');
  cdReg.lifecycle = { doctrine: 'DEFINED', proven: 'PROVEN', autonomous_dispatch: 'ENABLED', enablement_decision: { decision: 'ENABLE', authority: 'TEST_FIXTURE (isolated root only)', decided_on: '2026-08-28', governance_record: 'governance/creative-director-enablement.json' } };
  cdReg.implementation_state = 'IMPLEMENTATION_PROVEN';
  contract.role_roster.find((r) => r.role_id === 'creative_director').status = 'BUILT';
  fs.writeFileSync(path.join(tmp, 'config', 'agent-registry.json'), JSON.stringify(registry, null, 2));
  fs.writeFileSync(path.join(tmp, 'config', 'agent-contract.json'), JSON.stringify(contract, null, 2));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'creative-director.js'), path.join(tmp, 'scripts', 'creative-director.js'));
  const resolved = runner.resolveAgent(tmp, 'creative_director', { loadModule: () => director });
  assert.equal(resolved.registration.agent_id, 'creative_director');
  assert.ok(Array.isArray(resolved.actions) && resolved.actions.includes('recommend_direction'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── assembler guards ────────────────────────────────────────────────────────

test('CD26: the assembler refuses canary/trial scripts and incomplete packages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-assembler-'));
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FIXTURE, 'utf8'));
  pkg.datasheet.best_title = 'CANARY — Lifecycle Integration Test Package (NOT FOR PUBLICATION)';
  const canaryPath = path.join(tmp, 'canary.json');
  fs.writeFileSync(canaryPath, JSON.stringify(pkg));
  assert.throws(() => assembler.candidateScriptFromDiscoveryPackage(canaryPath), (e) => e.code === 'CANDIDATE_PACKAGE_IS_CANARY');
  const incomplete = { ...JSON.parse(fs.readFileSync(PACKAGE_FIXTURE, 'utf8')), generation_state: 'FAILED' };
  const incompletePath = path.join(tmp, 'incomplete.json');
  fs.writeFileSync(incompletePath, JSON.stringify(incomplete));
  assert.throws(() => assembler.candidateScriptFromDiscoveryPackage(incompletePath), (e) => e.code === 'CANDIDATE_PACKAGE_INCOMPLETE');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CD27: the assembler loads the style reference fail-closed and the creative projection withholds numeric bands', () => {
  const task = makeTask();
  assert.equal(task.style_reference.binding.sha256, STYLE_SHA);
  assert.equal(task.style_reference.human_approved, true);
  assert.equal('event_model' in task.style_reference.projection, false, 'creative_director projection must not carry numeric bands');
  assert.throws(
    () => assembler.assembleCreativeDirectionTask({ taskId: 't', requestedBy: 'mikko', projectId: 'p', script: { discoveryPackagePath: PACKAGE_FIXTURE }, styleReference: { referencePath: PACKAGE_FIXTURE, expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: STYLE_SHA } } }),
    (e) => e.code === 'STYLE_REFERENCE_BINDING_MISMATCH'
  );
});

test('CD28: altering a human-constraint echo inside the artifact is detected', async () => {
  const task = makeTask({ humanConstraints: [SERIOUS] });
  const out = await runDirector(task, makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-serious', compliance: 'humor NONE' }] }));
  const direction = clone(out.creative_direction);
  direction.human_directions_received[0].text = 'make this one funny';
  direction.direction_digest_sha256 = cd.directionDigest(direction);
  const check = cd.validateDirection(direction, { task: { human_constraints: [SERIOUS], section_refs: SECTION_REFS } });
  assert.ok(check.errors.some((e) => /echo altered/.test(e)));
});
