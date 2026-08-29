'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tests, test } = require('./_helpers.js');
const assembler = require('../scripts/agent-task-visual-planning.js');
const director = require('../scripts/visual-planning-director.js');
const storyFixture = require('./story-authority-live-fixture.js');

// Project identity is stable (projects do not advance); the version/head is
// resolved live through the production authority at test time and is NEVER
// pinned here — a legitimate human-approved successor moves these tests
// without breaking them. Exact historical versions belong in hermetic
// fixtures (AVP20) or the negative predecessor proof (AVP21).
const REAL_PROJECT = '01M0QR9DGP5RRFTPVDA7WQP2XM';

function fakeBuilder(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-planning-assembler-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const sections = overrides.sections === undefined ? [
    { id: 's1', order: 1, beat: 'Hook', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'Exact hook.', visual_notes: '', media_refs: [] },
    { id: 's2', order: 2, beat: 'Proof', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'Exact proof.', visual_notes: '', media_refs: [] },
  ] : overrides.sections;
  const approval = overrides.approval === 'approved'
    ? { state: 'approved', approved_by: 'Mikko', at: '2026-08-23T12:00:00.000Z', note: 'accepted' }
    : { state: 'none', at: null, note: null };
  const fixture = {
    project: { id: 'p1', approved_version_id: overrides.approval === 'approved' ? 'v1' : null, output_class: { aspect_ratio: '9:16', orientation: 'vertical', length_class: 'short', max_duration_minutes: 3 } },
    version: { id: 'v1', project_id: 'p1', content_hash: overrides.contentHash || 'a'.repeat(64), computed_hash: overrides.computedHash || overrides.contentHash || 'a'.repeat(64), sections, central_claim: 'Exact claim', narrative_spine: Object.hasOwn(overrides, 'narrativeSpine') ? overrides.narrativeSpine : 'hook-proof', approval },
    latest: overrides.latest || 'v1',
  };
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const loader = `const fs=require('node:fs');const p=${JSON.stringify(fixturePath)};const f=()=>JSON.parse(fs.readFileSync(p,'utf8'));`;
  fs.writeFileSync(path.join(root, 'lib', 'store.js'), `${loader}exports.loadProject=()=>f().project;`);
  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), `${loader}exports.loadVersion=(d,p,v)=>v===f().version.id?f().version:null;exports.listVersions=()=>[{...f().version,id:f().latest}];exports.scriptContentHash=()=>f().version.computed_hash;`);
  return { root, fixturePath };
}

function assemble(root, overrides = {}) {
  return assembler.assembleVisualPlanningTask({ scriptBuilderRoot: root, projectId: 'p1', versionId: 'v1', runId: 'run-1', taskId: 'visual-plan-v1', ...overrides });
}

test('AVP1 reads the real current canonical Story live', () => {
  // LIVE-CURRENT-HEAD contract: resolve the canonical head through the SAME
  // authoritative mechanism production uses (the Script Builder authority's
  // own listVersions), assemble through the production assembler, and assert
  // invariant properties only. No version id or content hash is pinned, so a
  // legitimate human-approved successor keeps this test green by design.
  const live = storyFixture.resolveLiveCanonicalHead(REAL_PROJECT);
  assert.ok(live.project, 'canonical project must exist in the resolved Script Builder authority');
  assert.ok(live.head, 'canonical project must have at least one Story version');
  const out = assembler.assembleVisualPlanningTask({ projectId: REAL_PROJECT, versionId: live.head.id, runId: 'real-vpd-stage1', taskId: 'visual-plan-real-v1' });
  assert.equal(out.task.story.version_id, live.head.id);
  assert.equal(out.task.story.project_id, REAL_PROJECT);
  assert.equal(out.task.story.content_hash, live.versions.scriptContentHash(live.head.sections));
  assert.equal(out.task.story.sections.length, live.head.sections.length);
  assert.deepEqual(out.task.story.sections.map((section) => section.order), live.head.sections.map((section) => section.order));
  assert.equal(out.authority.current, true);
  assert.equal(out.authority.section_count, live.head.sections.length);
});
test('AVP2 maps exact native VPD task identity', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.equal(task.action, 'plan_visuals'); assert.equal(task.project_id, 'p1'); assert.equal(task.package_run_id, 'run-1'); assert.equal(task.story.version_id, 'v1'); });
test('AVP3 creates one required beat per ordered canonical section', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.deepEqual(task.required_beats.map((beat) => beat.section_id), ['s1', 's2']); assert.equal(task.required_beats.length, task.story.sections.length); });
test('AVP4 derived beats pass the unchanged VPD preflight', () => { const { root } = fakeBuilder(); assert.equal(director.preflight(assemble(root).task).ok, true); });
test('AVP5 refuses a non-head Story version', () => { const { root } = fakeBuilder({ latest: 'v2' }); assert.throws(() => assemble(root), /version is stale/); });
test('AVP6 refuses recomputed Story hash drift', () => { const { root } = fakeBuilder({ computedHash: 'b'.repeat(64) }); assert.throws(() => assemble(root), /content hash is invalid/); });
test('AVP7 approval none maps truthfully with explicit nulls', () => { const { root } = fakeBuilder(); const out = assemble(root); assert.deepEqual(out.task.story.approval, { state: 'none', approved_by: null, approved_at: null, version_id: 'v1', content_hash: 'a'.repeat(64) }); assert.equal(out.authority.human_approval_present, false); });
test('AVP8 exact approved Story evidence maps to production-intent approval', () => { const { root } = fakeBuilder({ approval: 'approved' }); const out = assemble(root); assert.equal(out.task.story.approval.state, 'approved'); assert.equal(out.task.story.approval.approved_by, 'Mikko'); assert.equal(out.authority.human_approval_present, true); });
test('AVP9 approved label without exact human evidence fails closed', () => { const { root, fixturePath } = fakeBuilder({ approval: 'approved' }); const fixture = JSON.parse(fs.readFileSync(fixturePath)); delete fixture.version.approval.approved_by; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.throws(() => assemble(root), (error) => error.code === 'PLAN_SCRIPT_APPROVER_NOT_HUMAN'); });
test('AVP10 null narrative spine passes through unchanged', () => { const { root } = fakeBuilder({ narrativeSpine: null }); assert.equal(assemble(root).task.story.narrative_spine, null); });
test('AVP11 central claim and exact section dialogue pass through', () => { const { root } = fakeBuilder(); const { story } = assemble(root).task; assert.equal(story.central_claim, 'Exact claim'); assert.deepEqual(story.sections.map((section) => section.dialogue), ['Exact hook.', 'Exact proof.']); });
test('AVP12 current approval is re-read on every assembly', () => { const { root, fixturePath } = fakeBuilder(); assert.equal(assemble(root).task.story.approval.state, 'none'); const fixture = JSON.parse(fs.readFileSync(fixturePath)); fixture.project.approved_version_id = 'v1'; fixture.version.approval = { state: 'approved', approved_by: 'Mikko', at: '2026-08-23T12:00:00.000Z' }; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.equal(assemble(root).task.story.approval.state, 'approved'); });
test('AVP13 operator instructions pass verbatim without Creative synthesis', () => { const { root } = fakeBuilder(); const text = 'Keep the exact supplied monochrome reference; ask if unavailable.'; const task = assemble(root, { operatorInstructions: text }).task; assert.equal(task.operator_instructions, text); assert.equal('creative_doctrine_ref' in task, false); });
test('AVP14 no Research bindings produces an exact empty authority block', () => { const { root } = fakeBuilder(); assert.deepEqual(assemble(root).task.research, { bindings_doc: { bindings: [] }, current_result_refs: [], required_constraint_ids: [], authority_by_binding: {} }); });
test('AVP15 output target comes from the canonical project', () => { const { root } = fakeBuilder(); assert.deepEqual(assemble(root).task.output_target, { aspect_ratio: '9:16', orientation: 'vertical', length_class: 'short', max_duration_minutes: 3 }); });
test('AVP16 assembler writes only the native task envelope', () => { const { root } = fakeBuilder(); const assembled = assemble(root); const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'visual-task-out-')), 'task.json'); assembler.writeTask(output, assembled.task); const persisted = JSON.parse(fs.readFileSync(output)); assert.deepEqual(persisted, assembled.task); assert.equal('authority' in persisted, false); assert.equal('visual_plan' in persisted, false); });
test('AVP17 assembler does not invoke a model or create a Visual Plan', () => { const { root } = fakeBuilder(); const { task } = assemble(root); assert.equal('visual_plan' in task, false); assert.equal('model' in task, false); assert.equal('approval_binding' in task, false); });
test('AVP18 exact Script Builder aliases and provenance survive assembly', () => { const { root } = fakeBuilder(); const beat = assemble(root).task.required_beats[0]; assert.deepEqual(beat.aliases, [{ namespace: 'vidtoolz-script-builder/section', id: 's1' }]); assert.deepEqual(beat.source_provenance, { source_system: 'vidtoolz-script-builder', source_id: 'p1/v1/s1' }); });
test('AVP19 agent-looking PLAN_SCRIPT_APPROVAL approver is rejected', () => { const { root, fixturePath } = fakeBuilder({ approval: 'approved' }); const fixture = JSON.parse(fs.readFileSync(fixturePath)); fixture.version.approval.approved_by = 'story_editor'; fs.writeFileSync(fixturePath, JSON.stringify(fixture)); assert.throws(() => assemble(root), (error) => error.code === 'PLAN_SCRIPT_APPROVER_NOT_HUMAN'); });

test('AVP20 hermetic successor anti-rot — the current-head invariant survives a canonical successor and the stale predecessor stays rejected', () => {
  // Successor anti-rot proof (§10): HEAD V1 → assembly binds V1; a canonical
  // successor V2 becomes current → the SAME live-current-head code path binds
  // V2 without any source change; using V1 where the current head is required
  // stays rejected with the certified stale refusal. Built with the real
  // pinned Script Builder implementation over an isolated data directory —
  // one authority, zero test-local head logic.
  const fixture = storyFixture.canonicalStoryFixture();
  const project = fixture.store.saveProject(fixture.dataRoot, fixture.store.newProject({ id: 'pfx-avp20', title: 'AVP20 anti-rot fixture', length_class: 'short' }));
  const sectionsV1 = [{ id: 's1', order: 1, beat: 'Hook', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'First canonical words.', visual_notes: '', media_refs: [] }];
  const v1 = fixture.versions.createVersion(fixture.dataRoot, project, sectionsV1, fixture.config.loadConfig(fixture.dataRoot), {});
  const asHead = (versionId) => assembler.assembleVisualPlanningTask({ scriptBuilderRoot: fixture.root, projectId: project.id, versionId, runId: 'run-avp20', taskId: 'task-avp20' });
  assert.equal(asHead(v1.id).task.story.version_id, v1.id);
  // Pace past the ULID millisecond boundary so the successor's creation
  // timestamp orders strictly after V1 (Script Builder head ordering is ULID
  // lexicographic; same-millisecond creations have random suffix order).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3);
  const sectionsV2 = [{ id: 's1', order: 1, beat: 'Hook', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'Amended canonical words.', visual_notes: '', media_refs: [] }];
  const v2 = fixture.versions.createVersion(fixture.dataRoot, project, sectionsV2, fixture.config.loadConfig(fixture.dataRoot), {});
  const afterSuccessor = asHead(fixture.versions.listVersions(fixture.dataRoot, project.id).at(-1).id);
  assert.equal(afterSuccessor.task.story.version_id, v2.id);
  assert.equal(afterSuccessor.task.story.content_hash, fixture.versions.scriptContentHash(sectionsV2));
  assert.throws(() => asHead(v1.id), /version is stale/);
});

// ── C2 safe Creative Direction consumption for VPD (Approval C, 2026-08-29) ─
// Consumption is explicit-canonical-id only: canonical registry →
// certified projectForSpecialistById → CURRENT human authority at use time →
// enum-only VPD projection. No caller objects, no raw prose, no dispatch.

const cdDirector = require('../scripts/creative-director.js');
const cdAssembler = require('../scripts/agent-task-creative-direction.js');
const cdContract = require('../scripts/creative-direction.js');
const osNode = require('node:os');

const CD_FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creative-director', 'discovery-package.json'), 'utf8'));
const CD_CANON_ID = CD_FIXTURE.canonical_idea_id;
const STYLE_FIXTURE_C2 = path.join(__dirname, 'fixtures', 'style-reference', 'VIDTOOLZ_STYLE_REFERENCE_V1.json');
const STYLE_SHA_C2 = 'b357d23956bc3fd7a956372347e59cae4b10bb0064d3e9b19ec2819207fa8e41';
const CD_DISCOVERY = fs.mkdtempSync(path.join(osNode.tmpdir(), 'avp-c2-discovery-'));
fs.writeFileSync(path.join(CD_DISCOVERY, `${CD_CANON_ID}.json`), JSON.stringify(CD_FIXTURE));

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  let result;
  try { result = fn(); } catch (error) { restore(); throw error; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

function cdHermeticStoryBuilder() {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'script-builder-authority.json'), 'utf8'));
  const out = fs.mkdtempSync(path.join(osNode.tmpdir(), 'avp-c2-sb-'));
  const root = path.join(out, 'authority');
  require('node:child_process').execFileSync('git', ['clone', '--quiet', '--shared', '/home/vidtoolz/vidtoolz-script-builder', root], { stdio: 'ignore' });
  require('node:child_process').execFileSync('git', ['-C', root, 'checkout', '--quiet', lock.ref], { stdio: 'ignore' });
  const store = require(path.join(root, 'lib', 'store.js'));
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const config = require(path.join(root, 'lib', 'config.js'));
  const dataRoot = path.join(root, 'data');
  store.ensureLayout(dataRoot);
  const project = store.newProject({ id: 'c2-vpd-project', title: 'C2 VPD wiring fixture', length_class: 'short' });
  store.saveProject(dataRoot, project);
  const sections = [
    { id: 's-c2-01', order: 1, beat: 'Hook', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'C2 fixture opening.', visual_notes: '', media_refs: [] },
    { id: 's-c2-02', order: 2, beat: 'Proof', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'C2 fixture support.', visual_notes: '', media_refs: [] },
  ];
  versions.createVersion(dataRoot, project, sections, config.loadConfig(dataRoot), {});
  const head = versions.listVersions(dataRoot, project.id).at(-1);
  return { root, projectId: project.id, versionId: head.id };
}

function cdSemantic(overrides = {}) {
  return Object.assign({
    creative_thesis: { statement: 'C2 wiring thesis.', experience_goal: 'Goal.' },
    tone: { register: 'serious', energy_arc: 'steady' },
    humor: { mode: 'NONE', placement_guidance: null, provenance: 'SCRIPT_EVIDENCE' },
    visual_mode_mix: [
      { mode: 'EXPLANATION', weight: 'DOMINANT', rationale: 'x' },
      { mode: 'COMPARISON', weight: 'PRESENT', rationale: 'x' },
      { mode: 'PROOF', weight: 'MINIMAL', rationale: 'x' },
      { mode: 'MOOD', weight: 'PRESENT', rationale: 'x' },
      { mode: 'HUMOR', weight: 'ABSENT', rationale: '' },
      { mode: 'PUNCTUATION', weight: 'MINIMAL', rationale: 'x' },
    ],
    density_arc: { shape: 'QUIET', movements: [{ section_ref: 'beat-01', density_group: 'QUIET', note: 'x' }], relief_points: 'end' },
    level_a_strategy: { macro_philosophy: 'x' },
    level_b_strategy: { evolution_philosophy: 'x', emphasis_moments: ['x'] },
    level_c_strategy: { life_sources: ['GRAPHIC_EVOLUTION'], static_policy: 'x' },
    presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'x', compensation_directive: 'x', provenance: 'CD_JUDGMENT' },
    card_strategy: { role: 'x', argument_sections_needing_cards: [], patterns_suggested: [], restraint: 'x' },
    media_strategy: { generation_philosophy: 'x', reuse_directive: 'x', locked_scopes: [], replacement_requests: [] },
    motion_character: { description: 'x' },
    typography_mode: { register: 'x', full_frame_moments: [] },
    ending_strategy: { mode: 'SYNTHESIS_CARD', description: 'x', footer_takeaway_seed: 'x' },
    coherence: { sound_music_intent: 'x', music_locked: false, packaging_intent: 'x' },
    intentional_deviations: [],
    human_decisions_required: [],
    confidence: [{ aspect: 'x', level: 'HIGH', basis: 'SCRIPT_EVIDENCE' }],
    style_patterns_cited: [],
    constraint_compliance: [],
    action_claims: [],
  }, structuredClone(overrides));
}

const CD_ROUTE = { ok: true, decision: 'ROUTE', selected_host: 'test', endpoint: 'http://test', model: 'test-model' };
async function mintCanonicalDirection(sb, overrides = {}) {
  return withEnv({ VIDTOOLZ_DISCOVERY_ROOT: CD_DISCOVERY, VIDTOOLZ_SCRIPT_BUILDER_ROOT: sb.root }, async () => {
    const task = cdAssembler.assembleCreativeDirectionTask({
      taskId: 'task-c2-vpd', requestedBy: 'mikko', projectId: 'project-c2-vpd',
      script: { canonicalIdeaId: CD_CANON_ID, variant: 'structure_a' },
      styleReference: { referencePath: STYLE_FIXTURE_C2, expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: STYLE_SHA_C2 } },
      humanConstraints: [],
    });
    const out = await cdDirector.run(task, { routeSelector: () => ({ ...CD_ROUTE }), modelAdapter: async () => JSON.stringify(cdSemantic(overrides.semantic || {})) });
    assert.ok(out.creative_direction_id, `canonical direction must be minted (state=${out.state} reason=${out.reason})`);
    return { directionId: out.creative_direction_id, sb, task };
  });
}

function assembleVpd(sb, extra = {}) {
  return withEnv({ VIDTOOLZ_SCRIPT_BUILDER_ROOT: sb.root }, () => assembler.assembleVisualPlanningTask({
    scriptBuilderRoot: sb.root, projectId: sb.projectId, versionId: sb.versionId, runId: 'run-c2-vpd', taskId: 'task-c2-vpd', ...extra,
  }));
}

test('C2-VPD1: no creative_direction_id preserves exact pre-C behavior (NO_CREATIVE_DIRECTION_CONTEXT)', () => {
  const sb = cdHermeticStoryBuilder();
  const out = assembleVpd(sb);
  assert.equal(out.creative_direction_state, 'NO_CREATIVE_DIRECTION_CONTEXT');
  assert.equal('creative_direction' in out.task, false, 'no context field without an explicit canonical id');
  assert.equal(director.preflight(out.task).ok, true, 'legacy task remains preflight-valid');
});

test('C2-VPD2: explicit canonical id resolves to the certified safe projection with receipt', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb);
  const out = assembleVpd(sb, { creativeDirectionId: minted.directionId });
  assert.equal(out.creative_direction_state, 'CANONICAL_SAFE_PROJECTION');
  assert.equal(out.task.creative_direction.receipt.canonical_direction_id, minted.directionId);
  assert.equal(out.task.creative_direction.role, 'visual_planning_director');
  assert.ok(out.task.creative_direction.executable);
  assert.equal(out.task.creative_direction.executable.execution_contract.executable_surface, 'enum_action_claims_plus_enum_fields');
  assert.equal(director.preflight(out.task).ok, true, 'projection-bearing task remains preflight-valid');
});

test('C2-VPD3: RAW CREATIVE PROSE TO VPD = 0 — prompt carries the enum-only projection only', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb, { semantic: { action_claims: [{ claim_id: 'c2-1', domain: 'CARDS', operation: 'ADD', scope: 's-c2-01', summary: 'a labelled concept card' }] } });
  const out = assembleVpd(sb, { creativeDirectionId: minted.directionId });
  const prompt = director.buildPrompt(out.task);
  assert.match(prompt, /canonical safe projection/, 'structured context present');
  const prohibited = /creative_thesis|statement|sound_music_intent|packaging_intent|energy_arc|motion_character|non_executable_rationale|HUMAN_REVIEW_ONLY/;
  assert.equal(prohibited.test(prompt), false, 'no raw rationale/prose field may reach VPD');
  assert.equal(/"summary"/.test(JSON.stringify(out.task.creative_direction.executable)), false, 'action claims carry no free-text summary');
  assert.equal(out.task.creative_direction.executable.execution_contract.raw_creative_prose_included, false);
  assert.equal(out.task.creative_direction.executable.execution_contract.free_text_action_summary_included, false);
  assert.equal(out.task.creative_direction.executable.execution_contract.consume_rationale_for_actions, false);
});

test('C2-VPD4: nonexistent / noncanonical id is rejected — no fallback, no latest, no dispatch', () => {
  const sb = cdHermeticStoryBuilder();
  assert.throws(() => assembleVpd(sb, { creativeDirectionId: 'creative-direction-nonexistent-000' }), (e) => e.code === 'CREATIVE_DIRECTION_CONTEXT_REJECTED' && e.cause_code === 'CREATIVE_DIRECTION_NOT_FOUND');
  const handBuilt = { direction_id: 'hand-built', action_claims: [] };
  assert.throws(() => assembleVpd(sb, { creativeDirectionId: handBuilt }), (e) => e.code === 'CREATIVE_DIRECTION_CONTEXT_REJECTED');
  assert.throws(() => assembleVpd(sb, { creativeDirectionId: '   ' }), (e) => e.code === 'CREATIVE_DIRECTION_CONTEXT_REJECTED');
});

test('C2-VPD5: production authority store EMPTY — a genuinely never-recorded subject yields explicit EMPTY authority, no record created', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb);
  const before = JSON.stringify(require('node:fs').readdirSync(path.join(__dirname, '..', 'human-authority-store')).sort());
  const out = assembleVpd(sb, { creativeDirectionId: minted.directionId });
  const auth = out.task.creative_direction.executable.current_human_authority;
  assert.equal(auth.head, 'EMPTY');
  assert.equal(auth.authority_id, null);
  assert.deepEqual(auth.denials, [], 'an EMPTY head denies nothing and mints nothing');
  assert.ok(auth.sources.includes('CANONICAL_CURRENT_AUTHORITY_STORE'));
  const after = JSON.stringify(require('node:fs').readdirSync(path.join(__dirname, '..', 'human-authority-store')).sort());
  assert.equal(before, after, 'VPD consumption must never create human authority (read-only)');
});

test('C2-VPD6: CURRENT human authority wins — a later KEEP lock suppresses the historical direction operation at projection time', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb, { semantic: { action_claims: [
    { claim_id: 'stale-add', domain: 'MEDIA', operation: 'ADD', scope: 'S03', summary: 'historical add' },
    { claim_id: 'ok-add', domain: 'MEDIA', operation: 'ADD', scope: 'S05', summary: 'unlocked add' },
  ] } });
  // Historical projection with no lock: ADD S03 projects.
  const unlocked = assembleVpd(sb, { creativeDirectionId: minted.directionId });
  assert.ok(unlocked.task.creative_direction.executable.action_claims.some((c) => c.scope === 'S03' && c.operation === 'ADD'));
  // A human KEEP_MEDIA S03 recorded in an isolated authority store after the
  // direction existed: assembly must re-resolve current authority and suppress
  // the stale operation while preserving target-scoped unrelated ones.
  const authStore = fs.mkdtempSync(path.join(osNode.tmpdir(), 'avp-c2-auth-'));
  await withEnv({ VIDTOOLZ_HUMAN_AUTHORITY_STORE: authStore, VIDTOOLZ_HUMAN_AUTHORITY_WRITER_IDENTITY: 'mikko@decision-tooling' }, async () => {
    cdDirector.recordHumanAuthoritySuccessor(CD_CANON_ID, { human_constraints: [] });
    cdDirector.recordHumanAuthoritySuccessor(CD_CANON_ID, { human_constraints: [{ constraint_id: 'keep-s03', type: 'KEEP_MEDIA', scope: 'S03', text: 'Keep S03.' }] });
  });
  const locked = withEnv({ VIDTOOLZ_HUMAN_AUTHORITY_STORE: authStore }, () => assembleVpd(sb, { creativeDirectionId: minted.directionId }));
  const exec = locked.task.creative_direction.executable;
  assert.equal(exec.action_claims.some((c) => c.scope === 'S03' && c.operation === 'ADD'), false, 'stale ADD S03 suppressed by current human authority');
  assert.ok(exec.action_claims.some((c) => c.scope === 'S05' && c.operation === 'ADD'), 'target-scoped S05 remains legal');
  assert.ok(exec.capability_suppressions.some((s) => s.claim_id === 'stale-add'));
  assert.equal(exec.current_human_authority.authority_id, 'ha-2', 'projection binds the RESOLVED current head, never direction-time state');
  assert.equal(exec.current_human_authority.version, 2);
});

test('C2-VPD7: unresolvable current authority fails safely — never falls back to historical or caller authority', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb);
  assert.throws(
    () => withEnv({ VIDTOOLZ_HUMAN_AUTHORITY_STORE: '/tmp/avp-c2-missing-store-root' }, () => assembleVpd(sb, { creativeDirectionId: minted.directionId })),
    (e) => e.code === 'CREATIVE_DIRECTION_CONTEXT_REJECTED'
  );
});

test('C2-VPD8: writer gate — runtime without trusted writer identity cannot mint human authority through the VPD path', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb);
  const authStore = fs.mkdtempSync(path.join(osNode.tmpdir(), 'avp-c2-writer-'));
  await withEnv({ VIDTOOLZ_HUMAN_AUTHORITY_STORE: authStore }, async () => {
    assert.throws(() => cdDirector.recordHumanAuthoritySuccessor(CD_CANON_ID, { human_constraints: [] }), (e) => e.code === 'HUMAN_AUTHORITY_WRITER_UNCONFIGURED');
  });
  // ordinary assembly under that store still succeeds with EMPTY authority
  const out = withEnv({ VIDTOOLZ_HUMAN_AUTHORITY_STORE: authStore }, () => assembleVpd(sb, { creativeDirectionId: minted.directionId }));
  assert.equal(out.task.creative_direction.executable.current_human_authority.head, 'EMPTY');
});

test('C2-VPD9: the projection survives writeTask as the native task envelope (bounded plumbing only)', async () => {
  const sb = cdHermeticStoryBuilder();
  const minted = await mintCanonicalDirection(sb);
  const out = assembleVpd(sb, { creativeDirectionId: minted.directionId });
  const target = path.join(fs.mkdtempSync(path.join(osNode.tmpdir(), 'avp-c2-out-')), 'task.json');
  assembler.writeTask(target, out.task);
  const persisted = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(persisted.creative_direction.receipt.canonical_direction_id, minted.directionId);
  assert.deepEqual(persisted, out.task);
});

if (require.main === module) {
  (async () => { let passed = 0, failed = 0; for (const item of tests) { try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); } catch (error) { failed += 1; console.error(`not ok - ${item.name}`); console.error(error.stack || error.message); } } console.log(`${passed}/${passed + failed} Visual Planning Task Assembler tests passed`); if (failed) process.exitCode = 1; })();
}

module.exports = { tests };
