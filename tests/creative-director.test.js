'use strict';

const { assert, childProcess, fs, path, test } = require('./_helpers.js');
const os = require('os');
const director = require('../scripts/creative-director.js');
const cd = require('../scripts/creative-direction.js');
const assembler = require('../scripts/agent-task-creative-direction.js');
const runner = require('../scripts/agent-run.js');
const dispatchAuthority = require('../scripts/agent-dispatch-authority.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'creative-director');
const PACKAGE_FIXTURE = path.join(FIXTURE_DIR, 'discovery-package.json');
const STYLE_FIXTURE = path.join(__dirname, 'fixtures', 'style-reference', 'VIDTOOLZ_STYLE_REFERENCE_V1.json');
const STYLE_SHA = 'b357d23956bc3fd7a956372347e59cae4b10bb0064d3e9b19ec2819207fa8e41';
const STYLE_CONFIG = { referencePath: STYLE_FIXTURE, expectedBinding: { reference_id: 'VIDTOOLZ_STYLE_REFERENCE_V1', sha256: STYLE_SHA } };

const clone = (v) => structuredClone(v);
const ROUTE = { ok: true, decision: 'ROUTE', selected_host: 'test', endpoint: 'http://test', model: 'test-model' };
const routeSelector = () => ({ ...ROUTE });

/* ── hermetic Script Builder authority (pinned clone + two seeded versions) ── */
let SB = null;
function hermeticStore() {
  if (SB) return SB;
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'script-builder-authority.json'), 'utf8'));
  const source = '/home/vidtoolz/vidtoolz-script-builder';
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-authority-store-'));
  const root = path.join(out, 'authority');
  childProcess.execFileSync('git', ['clone', '--quiet', '--shared', source, root], { stdio: 'ignore' });
  childProcess.execFileSync('git', ['-C', root, 'checkout', '--quiet', lock.ref], { stdio: 'ignore' });
  const store = require(path.join(root, 'lib', 'store.js'));
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const config = require(path.join(root, 'lib', 'config.js'));
  const dataRoot = path.join(root, 'data');
  store.ensureLayout(dataRoot);
  const project = store.newProject({ id: '01MHOSTILEAUTH0REPAIRPROJ1', title: 'Authority Repair Hostile Story', length_class: 'short', source_handoff: null });
  store.saveProject(dataRoot, project);
  const sectionsV1 = [
    { id: null, order: 1, beat: 'Opening claim', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'The predecessor version of this argument.', visual_notes: '', media_refs: [] },
    { id: null, order: 2, beat: 'Supporting turn', type: 'composited', background: 'plate', framing_preset: 'right-third', dialogue: 'It develops in a second section.', visual_notes: '', media_refs: [] },
  ].map((s, i) => ({ ...s, id: `01HOSTILESECTION0000000${String(i + 1).padStart(3, '0')}` }));
  const a = versions.createVersion(dataRoot, project, sectionsV1, config.loadConfig(dataRoot), { label: 'predecessor', source_provenance: { source_system: 'authority-repair-test', source_id: 'v1' } });
  const sectionsV2 = sectionsV1.map((s) => ({ ...s, dialogue: `${s.dialogue} Revised for the current head.` }));
  const b = versions.createVersion(dataRoot, project, sectionsV2, config.loadConfig(dataRoot), { label: 'current head', source_provenance: { source_system: 'authority-repair-test', source_id: 'v2' } });
  // Same-millisecond ULIDs order arbitrarily: ask the store which one IS the
  // head rather than assuming creation order.
  const head = versions.listVersions(dataRoot, project.id).at(-1);
  const stale = [a, b].find((v) => v.id !== head.id);
  SB = { root, projectId: project.id, v1: stale.id, v2: head.id, v2Hash: head.content_hash };
  return SB;
}

function makeTask(overrides = {}) {
  const task = assembler.assembleCreativeDirectionTask({
    taskId: overrides.taskId || 'task-cd-0001', requestedBy: 'mikko', projectId: 'project-cd-0001',
    script: overrides.script || { discoveryPackagePath: PACKAGE_FIXTURE, discoveryRoot: FIXTURE_DIR },
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
      { mode: 'EXPLANATION', weight: 'DOMINANT', rationale: 'the argument is mechanism-driven' },
      { mode: 'COMPARISON', weight: 'PRESENT', rationale: 'launch-vs-cadence is the core contrast' },
      { mode: 'PROOF', weight: 'MINIMAL', rationale: 'one compounding moment suffices' },
      { mode: 'MOOD', weight: 'PRESENT', rationale: 'quiet, patient atmosphere between cards' },
      { mode: 'HUMOR', weight: 'ABSENT', rationale: '' },
      { mode: 'PUNCTUATION', weight: 'MINIMAL', rationale: 'hard stop on the final directive' },
    ],
    density_arc: { shape: 'QUIET open, READABLE middle, one DENSE synthesis before a QUIET close', movements: [
      { section_ref: 'beat-01', density_group: 'QUIET', note: 'contradiction breathes' },
      { section_ref: 'beat-02', density_group: 'READABLE', note: 'mechanism card' },
      { section_ref: 'beat-03', density_group: 'READABLE', note: 'reframe comparison' },
      { section_ref: 'beat-04', density_group: 'DENSE', note: 'action synthesis then relief' },
    ], relief_points: 'after the final synthesis card, no new information' },
    level_a_strategy: { macro_philosophy: 'backdrop states change on claim turns, not on a clock' },
    level_b_strategy: { evolution_philosophy: 'each state keeps evolving via card state changes and reframes', emphasis_moments: ['the reframe in the third movement', 'the directive in the close'] },
    level_c_strategy: { life_sources: ['GRAPHIC_EVOLUTION', 'DRIFT', 'SLOW_PAN'], static_policy: 'stillness only while a dense card is being read' },
    presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'persistent unboxed presenter in final style', compensation_directive: 'every hold carries plate drift or graphic evolution; the central graphic keeps evolving through the middle movements', provenance: 'CD_JUDGMENT' },
    card_strategy: { role: 'cards carry the mechanism and the directive', argument_sections_needing_cards: ['beat-02', 'beat-04'], patterns_suggested: ['LABELLED_CONCEPT', 'SYNTHESIS_CARD', 'TAKEAWAY_FOOTER'], restraint: 'the opening stays cardless and atmospheric' },
    media_strategy: { generation_philosophy: 'one metaphor world generated once and reused at multiple scales', reuse_directive: 'prefer reframes and card evolution over new assets', locked_scopes: [], replacement_requests: [] },
    motion_character: { description: 'slow, single-vector, patient; motion mirrors compounding — small and continuous' },
    typography_mode: { register: 'hierarchical, short structured text', full_frame_moments: ['the reframe one-liner in the third movement'] },
    ending_strategy: { mode: 'SYNTHESIS_CARD', description: 'dense action card with footer takeaway, hard stop', footer_takeaway_seed: 'Cadence is the asset.' },
    coherence: { sound_music_intent: 'steady low-pulse bed that never peaks', music_locked: false, packaging_intent: 'sell the calm certainty of compounding, not urgency' },
    intentional_deviations: [],
    human_decisions_required: [],
    confidence: [{ aspect: 'density arc', level: 'HIGH', basis: 'SCRIPT_EVIDENCE' }],
    style_patterns_cited: ['P-02', 'P-15', 'PAT-14'],
    constraint_compliance: [],
    action_claims: [],
  };
  return Object.assign(semantic, clone(overrides));
}

const adapterFor = (semantic) => async () => JSON.stringify(semantic);
async function runDirector(task, semantic, options = {}) {
  return director.run(task, { routeSelector, modelAdapter: adapterFor(semantic), ...options });
}
function taskContext(task) {
  return { script_identity: task.script_identity, style_reference: task.style_reference ? task.style_reference.binding : null, human_constraints: task.human_constraints || [], section_refs: (task.script_content?.sections || []).map((s) => s.section_ref) };
}

/* ══ STORY AUTHORITY (Codex defect class A) ═════════════════════════════════ */

test('CDA1: wrong-project Story is refused (STORY_AUTHORITY_INVALID)', () => {
  const sb = hermeticStore();
  assert.throws(
    () => assembler.canonicalStoryScript({ project_id: '01M0FAKEPROJECT00000000000', version_id: sb.v2 }, { scriptBuilderRoot: sb.root }),
    (e) => e.code === 'STORY_AUTHORITY_INVALID' && /No project|not found/i.test(e.message)
  );
});

test('CDA2: stale predecessor Story is refused where current head is required', () => {
  const sb = hermeticStore();
  assert.throws(
    () => assembler.canonicalStoryScript({ project_id: sb.projectId, version_id: sb.v1 }, { scriptBuilderRoot: sb.root }),
    (e) => e.code === 'STORY_AUTHORITY_INVALID' && /stale/.test(e.message)
  );
});

test('CDA3: forged content hash is refused — identity comes FROM the store, never the caller', () => {
  const sb = hermeticStore();
  assert.throws(
    () => assembler.canonicalStoryScript({ project_id: sb.projectId, version_id: sb.v2, content_hash: 'f'.repeat(64) }, { scriptBuilderRoot: sb.root }),
    (e) => e.code === 'STORY_AUTHORITY_INVALID' && /content hash/.test(e.message)
  );
});

test('CDA4: valid canonical head Story passes with store-derived identity + authority_verified', () => {
  const sb = hermeticStore();
  const bound = assembler.canonicalStoryScript({ project_id: sb.projectId, version_id: sb.v2 }, { scriptBuilderRoot: sb.root });
  assert.equal(bound.script_identity.authority_verified, true);
  assert.equal(bound.script_identity.content_hash, sb.v2Hash);
  assert.equal(bound.script_identity.approval.state, 'none');
  assert.equal(bound.script_content.sections.length, 2);
});

test('CDA5: Discovery package outside the canonical store root is refused', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-outside-'));
  const rogue = path.join(tmp, 'rogue-package.json');
  fs.copyFileSync(PACKAGE_FIXTURE, rogue);
  assert.throws(
    () => assembler.candidateScriptFromDiscoveryPackage(rogue, 'structure_a', { discoveryRoot: FIXTURE_DIR }),
    (e) => e.code === 'STORY_AUTHORITY_INVALID' && /escapes the canonical Discovery store/.test(e.message)
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CDA6: valid Discovery package passes under its own authority contract (root-confined, fingerprints consistent)', () => {
  const bound = assembler.candidateScriptFromDiscoveryPackage(PACKAGE_FIXTURE, 'structure_a', { discoveryRoot: FIXTURE_DIR });
  assert.equal(bound.script_identity.authority_verified, true);
  assert.equal(bound.script_identity.authority_root, fs.realpathSync(FIXTURE_DIR));
});

test('CDA7: internally inconsistent Discovery fingerprints are refused', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-fp-'));
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FIXTURE, 'utf8'));
  pkg.validation = { datasheet: { status: 'PASS', fingerprint: 'a'.repeat(64) } };
  const p = path.join(tmp, 'inconsistent.json');
  fs.writeFileSync(p, JSON.stringify(pkg));
  assert.throws(
    () => assembler.candidateScriptFromDiscoveryPackage(p, 'structure_a', { discoveryRoot: tmp }),
    (e) => e.code === 'STORY_AUTHORITY_INVALID' && /internally inconsistent/.test(e.message)
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CDA8: a hand-built task with unverified identity is BLOCKED at module preflight', async () => {
  const task = makeTask();
  task.script_identity = { ...task.script_identity, authority_verified: false };
  const out = await runDirector(task, makeSemantic());
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /STORY_AUTHORITY_INVALID/);
});

/* ══ HUMAN CONSTRAINTS — STRUCTURAL ACK ≠ COMPLIANCE (defect class B) ═══════ */

const KEEP = { constraint_id: 'hc-keep', type: 'KEEP_MEDIA', scope: 'beat-03', text: 'KEEP all images in the reframe section' };
const MLOCK = { constraint_id: 'hc-music', type: 'MUSIC_LOCK', text: 'do not change music' };

test('CDB1: Codex exploit — KEEP_MEDIA echoed structurally, regeneration prescribed in generation_philosophy prose → HUMAN_KEEP_MEDIA_CONTRADICTION, immediate escalation', async () => {
  const task = makeTask({ humanConstraints: [KEEP] });
  const hostile = makeSemantic({
    media_strategy: { generation_philosophy: 'Acknowledged the lock. Regenerate the images in the reframe section with a colder palette.', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: [] },
    constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'lock echoed' }],
  });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.equal(out.next_owner, 'mikko');
  assert.equal(out.attempts, 1, 'no validator roulette: authority violations end the attempt series immediately');
  assert.match(out.reason, /HUMAN_KEEP_MEDIA_CONTRADICTION/);
  assert.ok(out.rejected_attempts[0].violations.some((v) => v.code === 'HUMAN_KEEP_MEDIA_CONTRADICTION'));
  assert.ok(out.rejected_attempts[0].rejected_semantic, 'offending output preserved as evidence');
});

test('CDB2: Codex exploit — MUSIC_LOCK with music_locked=true, replacement cue prescribed in sound_music_intent prose → HUMAN_MUSIC_LOCK_CONTRADICTION', async () => {
  const task = makeTask({ humanConstraints: [MLOCK] });
  const hostile = makeSemantic({
    coherence: { sound_music_intent: 'Respecting the lock; still, swap in a different track with a brighter cue for the close.', music_locked: true, packaging_intent: 'y' },
    constraint_compliance: [{ constraint_id: 'hc-music', compliance: 'lock echoed' }],
  });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_MUSIC_LOCK_CONTRADICTION/);
});

test('CDB3: prose contradiction is caught in ANY model field, not just the domain field', async () => {
  const task = makeTask({ humanConstraints: [KEEP] });
  const hostile = makeSemantic({
    level_b_strategy: { evolution_philosophy: 'replace the plates midway to reset attention', emphasis_moments: ['x'] },
    media_strategy: { generation_philosophy: 'reuse only', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: [] },
    constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }],
  });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_KEEP_MEDIA_CONTRADICTION/);
});

test('CDB4: action claim REPLACE on protected MEDIA scope is rejected even with clean prose', async () => {
  const task = makeTask({ humanConstraints: [KEEP] });
  const hostile = makeSemantic({
    media_strategy: { generation_philosophy: 'strategy stays gentle', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: [] },
    constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }],
    action_claims: [{ claim_id: 'ac-01', domain: 'MEDIA', operation: 'REPLACE', scope: 'beat-03', summary: 'refresh the section visuals' }],
  });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_KEEP_MEDIA_CONTRADICTION/);
});

test('CDB5: compliant KEEP_MEDIA + MUSIC_LOCK direction passes with claims and clean prose', async () => {
  const task = makeTask({ humanConstraints: [KEEP, MLOCK] });
  const good = makeSemantic({
    media_strategy: { generation_philosophy: 'existing assets carry the episode; treatments evolve, sources stay', reuse_directive: 'lean on reframes and card evolution', locked_scopes: ['beat-03'], replacement_requests: [] },
    coherence: { sound_music_intent: 'the locked bed already fits the patient register; shape dynamics around it', music_locked: true, packaging_intent: 'calm certainty' },
    constraint_compliance: [
      { constraint_id: 'hc-keep', compliance: 'media locked; treatments only' },
      { constraint_id: 'hc-music', compliance: 'music locked; no selection change' },
    ],
    action_claims: [{ claim_id: 'ac-01', domain: 'MEDIA', operation: 'KEEP', scope: 'beat-03', summary: 'keep protected media; evolve treatments' }],
  });
  const out = await runDirector(task, good);
  assert.equal(out.state, 'PREVIEW_ONLY');
  assert.equal(out.validation.ok, true, out.validation.errors.join('; '));
  assert.deepEqual(out.creative_direction.execution_contract, { executable_surface: 'action_claims', prose_classification: 'NON_EXECUTABLE_CREATIVE_RATIONALE' });
});

test('CDB6: model cannot narrow module-derived protected domains', async () => {
  const task = makeTask({ humanConstraints: [KEEP] });
  const good = makeSemantic({
    media_strategy: { generation_philosophy: 'reuse only', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: [] },
    constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }],
  });
  const out = await runDirector(task, good);
  const direction = clone(out.creative_direction);
  direction.protected_domains = [];
  direction.direction_digest_sha256 = cd.directionDigest(direction);
  const check = cd.validateDirection(direction, { task: taskContext(task) });
  assert.ok(check.errors.some((e) => /protected_domains must equal the module-derived domains/.test(e)));
});

/* ══ CUSTOM CONSTRAINTS ═════════════════════════════════════════════════════ */

test('CDC1: unstructured CUSTOM fails the assembly closed before any model call', () => {
  assert.throws(
    () => makeTask({ humanConstraints: [{ constraint_id: 'hc-x', type: 'CUSTOM', text: 'keep the current dark tone' }] }),
    (e) => e.code === 'HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION'
  );
});

test('CDC2: unstructured CUSTOM in a hand-built task escalates at preflight with zero model calls', async () => {
  const task = makeTask();
  task.human_constraints = [{ constraint_id: 'hc-x', type: 'CUSTOM', text: 'keep the current dark tone' }];
  let calls = 0;
  const out = await director.run(task, { routeSelector, modelAdapter: async () => { calls += 1; return '{}'; } });
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION/);
  assert.equal(calls, 0);
});

test('CDC3: Codex exploit — structured CUSTOM ending direction beats a contradicting ending_strategy (human simple ending wins over synthesis house tendency)', async () => {
  const custom = { constraint_id: 'hc-end', type: 'CUSTOM', text: 'keep the ending simple — no synthesis card', protected: { domain: 'ENDING', forbidden_operations: ['CHANGE'], required_field_values: [{ path: 'ending_strategy.mode', one_of: ['EXPLICIT_DEVIATION'] }] } };
  const task = makeTask({ humanConstraints: [custom] });
  const hostile = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-end', compliance: 'noted' }] }); // keeps SYNTHESIS_CARD
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_CUSTOM_CONSTRAINT_CONTRADICTION/);
  const good = makeSemantic({
    ending_strategy: { mode: 'EXPLICIT_DEVIATION', description: 'quiet, undesigned close per the human direction', footer_takeaway_seed: null },
    intentional_deviations: [{ pattern_ref: 'P-12', deviation: 'no designed ending card', creative_reason: 'explicit human direction for a simple ending', requires_human: true }],
    constraint_compliance: [{ constraint_id: 'hc-end', compliance: 'ending kept simple as directed' }],
  });
  const outGood = await runDirector(task, good);
  assert.equal(outGood.state, 'PREVIEW_ONLY');
});

/* ══ SPECIALIST EXECUTION BOUNDARY (defect: values hidden in prose) ═════════ */

test('CDS1: the exact Codex exploit string in motion_character prose is rejected', async () => {
  const hostile = makeSemantic({ motion_character: { description: 'Use asset file final-plate.png, crop to x=120 y=80, push in for 4.0 seconds, then cut at frame 90.' } });
  const out = await runDirector(makeTask(), hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /SPECIALIST_EXECUTION_BOUNDARY_VIOLATION/);
});

for (const [name, field, text] of [
  ['filename in metaphor prose', 'creative_thesis', { statement: 'The episode is like img-flux-021-v2 slowly sharpening.', experience_goal: 'clarity' }],
  ['filesystem path in rationale', 'level_a_strategy', { macro_philosophy: 'anchor everything on /home/vidtoolz/plates/master.png as the base state' }],
  ['coordinates in prose', 'level_b_strategy', { evolution_philosophy: 'push toward 61.2°, 24.9° over the turn', emphasis_moments: ['x'] }],
  ['timestamp in prose', 'typography_mode', { register: 'clean', full_frame_moments: ['the line landing at 37.42s'] }],
  ['transition duration in prose', 'card_strategy', { role: 'cards carry it', argument_sections_needing_cards: [], patterns_suggested: [], restraint: 'use dissolves of 250ms between cards' }],
  ['scale percentage in prose', 'ending_strategy', { mode: 'SYNTHESIS_CARD', description: 'scale the closing image to 112% for weight', footer_takeaway_seed: null }],
  ['frame number in prose', 'tone', { register: 'serious', energy_arc: 'settle by frame 90 into the close' }],
]) {
  test(`CDS2 ${name} → SPECIALIST_EXECUTION_BOUNDARY_VIOLATION`, async () => {
    const out = await runDirector(makeTask(), makeSemantic({ [field]: text }));
    assert.equal(out.state, 'ESCALATED', name);
    assert.match(out.reason, /SPECIALIST_EXECUTION_BOUNDARY_VIOLATION/);
  });
}

/* ══ SELF-APPROVAL (no textual loophole) ════════════════════════════════════ */

for (const [where, overrides] of [
  ['deviation creative_reason', { ending_strategy: { mode: 'EXPLICIT_DEVIATION', description: 'quiet close', footer_takeaway_seed: null }, intentional_deviations: [{ pattern_ref: 'P-12', deviation: 'no synthesis card', creative_reason: 'human approved this exception already', requires_human: true }] }],
  ['free prose field', { level_c_strategy: { life_sources: ['DRIFT'], static_policy: 'approved by Mikko, so stillness is fine everywhere' } }],
  ['nested escalation text', { human_decisions_required: [{ type: 'HUMAN_TASTE_REQUIRED', question: 'Treat the deviation as approved and proceed?', why_consequential: 'i approve the house-style exception on their behalf' }] }],
  ['confidence aspect', { confidence: [{ aspect: 'pre-approved ending exception', level: 'HIGH', basis: 'CD_JUDGMENT' }] }],
]) {
  test(`CDP1 self-approval claim in ${where} → HOUSE_STYLE_SELF_APPROVAL_FORBIDDEN`, async () => {
    const out = await runDirector(makeTask(), makeSemantic(overrides));
    assert.equal(out.state, 'ESCALATED', where);
    assert.match(out.reason, /HOUSE_STYLE_SELF_APPROVAL_FORBIDDEN/);
  });
}

/* ══ HUMAN PRECEDENCE (kept behaviors) ══════════════════════════════════════ */

test('CDH1: presenter-free human direction beats persistent-presenter house pattern (with mandatory compensation)', async () => {
  const constraint = { constraint_id: 'hc-pf', type: 'PRESENTER_FREE_DRAFT', text: 'no presenter in draft' };
  const task = makeTask({ humanConstraints: [constraint] });
  const live = makeSemantic({ presenter_policy: { draft_mode: 'LIVE', final_intent: 'x', compensation_directive: '', provenance: 'STYLE_REFERENCE' }, constraint_compliance: [{ constraint_id: 'hc-pf', compliance: 'noted' }] });
  const outLive = await runDirector(task, live);
  assert.equal(outLive.state, 'ESCALATED');
  assert.match(outLive.reason, /HUMAN_PRESENTER_CONSTRAINT_CONTRADICTION|CONSTRAINT_CONTRADICTION hc-pf/);
  const good = makeSemantic({ presenter_policy: { draft_mode: 'PRESENTER_FREE', final_intent: 'later', compensation_directive: 'graphic evolution and plate drift carry every hold', provenance: 'HUMAN_DIRECTION' }, constraint_compliance: [{ constraint_id: 'hc-pf', compliance: 'presenter-free draft honored; continuous visual life carries every hold' }] });
  const outGood = await runDirector(task, good);
  assert.equal(outGood.state, 'PREVIEW_ONLY');
});

test('CDH2: TONE_SERIOUS (no humor) beats a humorous house example', async () => {
  const serious = { constraint_id: 'hc-serious', type: 'TONE_SERIOUS', text: 'make this one serious' };
  const task = makeTask({ humanConstraints: [serious] });
  const hostile = makeSemantic({ humor: { mode: 'COMIC', placement_guidance: 'jokes like the mug gag', provenance: 'STYLE_REFERENCE' }, constraint_compliance: [{ constraint_id: 'hc-serious', compliance: 'noted' }] });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_TONE_CONSTRAINT_CONTRADICTION|CONSTRAINT_CONTRADICTION hc-serious/);
});

test('CDH3: NO_CARDS_SECTION beats style card suggestions', async () => {
  const constraint = { constraint_id: 'hc-nocards', type: 'NO_CARDS_SECTION', scope: 'beat-02', text: 'avoid cards in this section' };
  const task = makeTask({ humanConstraints: [constraint] });
  const hostile = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-nocards', compliance: 'kept cards anyway' }] });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_CARDS_CONSTRAINT_CONTRADICTION|CONSTRAINT_CONTRADICTION hc-nocards/);
});

/* ══ RETRY SAFETY ═══════════════════════════════════════════════════════════ */

test('CDR1: schema noise retries within budget then escalates with every rejected attempt preserved', async () => {
  let calls = 0;
  const out = await director.run(makeTask({ task: { retry_budget: 2 } }), { routeSelector, modelAdapter: async () => { calls += 1; return JSON.stringify(makeSemantic({ shot_list: [] })); } });
  assert.equal(out.state, 'ESCALATED');
  assert.equal(calls, 2);
  assert.equal(out.rejected_attempts.length, 2);
});

test('CDR2: an authority violation never retries — one attempt, typed escalation, evidence kept', async () => {
  let calls = 0;
  const hostile = makeSemantic({ motion_character: { description: 'cut at 12.5s exactly' } });
  const out = await director.run(makeTask({ task: { retry_budget: 3 } }), { routeSelector, modelAdapter: async () => { calls += 1; return JSON.stringify(hostile); } });
  assert.equal(calls, 1);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_AUTHORITY_VIOLATION/);
});

/* ══ SEMANTIC ADJUDICATOR BOUNDS ════════════════════════════════════════════ */

test('CDJ1: adjudicator may reject or declare ambiguity; a PASS cannot override deterministic failure', async () => {
  const task = makeTask();
  const outReject = await runDirector(task, makeSemantic(), { semanticAdjudicator: () => ({ verdict: 'REJECT', code: 'HUMAN_CUSTOM_CONSTRAINT_CONTRADICTION', reason: 'contradiction detected' }) });
  assert.equal(outReject.state, 'ESCALATED');
  const outAmbiguous = await runDirector(task, makeSemantic(), { semanticAdjudicator: () => ({ verdict: 'AMBIGUOUS', reason: 'cannot establish compliance' }) });
  assert.equal(outAmbiguous.state, 'ESCALATED');
  assert.match(outAmbiguous.reason, /HUMAN_CONSTRAINT_AMBIGUITY/);
  // PASS cannot rescue a deterministic violation:
  const hostile = makeSemantic({ motion_character: { description: 'use final-plate.png as the base' } });
  const outHostile = await runDirector(task, hostile, { semanticAdjudicator: () => ({ verdict: 'PASS' }) });
  assert.equal(outHostile.state, 'ESCALATED');
  assert.match(outHostile.reason, /SPECIALIST_EXECUTION_BOUNDARY_VIOLATION/);
});

/* ══ FALSE-POSITIVE AUDIT (legal creative language must pass) ═══════════════ */

test('CDF1: legal conceptual prose passes — including the words cut, frame, music, and 9:16', async () => {
  const task = makeTask({ humanConstraints: [KEEP, MLOCK] });
  const legal = makeSemantic({
    creative_thesis: { statement: 'Use imagery that feels tightly controlled; frame the argument as a discipline.', experience_goal: 'increase conceptual pressure through the middle' },
    tone: { register: 'a colder mood, precise and patient', energy_arc: 'cut the visual noise as the argument narrows on the 9:16 canvas' },
    card_strategy: { role: 'favor comparison cards through the central argument', argument_sections_needing_cards: ['beat-02'], patterns_suggested: ['COMPARISON_TWO_COLUMN'], restraint: 'reduce visual density during the reflective turn' },
    ending_strategy: { mode: 'SYNTHESIS_CARD', description: 'give the ending more visual density and let the music resolve without changing it', footer_takeaway_seed: 'discipline compounds' },
    media_strategy: { generation_philosophy: 'existing imagery carries the middle; treatments evolve', reuse_directive: 'one world, several scales', locked_scopes: ['beat-03'], replacement_requests: [] },
    coherence: { sound_music_intent: 'the locked music should feel patient and low', music_locked: true, packaging_intent: 'calm authority' },
    constraint_compliance: [
      { constraint_id: 'hc-keep', compliance: 'protected media kept' },
      { constraint_id: 'hc-music', compliance: 'music selection untouched' },
    ],
  });
  const out = await runDirector(task, legal);
  assert.equal(out.state, 'PREVIEW_ONLY', JSON.stringify(out.rejected_attempts?.[0]?.errors || out.reason));
});

/* ══ PROPERTY / FUZZ (bounded families, not one brittle phrase) ═════════════ */

test('CDPF1: forbidden mutation phrasings across verb x object variants are all caught (protected domains)', () => {
  const verbs = ['replace', 'swap', 'regenerate', 'discard', 'switch', 'redo'];
  const objects = { MEDIA: ['the plates', 'this image', 'the footage', 'those assets'], MUSIC: ['the track', 'the soundtrack', 'the score', 'the music bed'] };
  const domains = cd.deriveProtectedDomains([KEEP, MLOCK]).domains;
  let caught = 0; let total = 0;
  for (const [domainName, objs] of Object.entries(objects)) {
    for (const verb of verbs) for (const obj of objs) {
      total += 1;
      const prose = [{ path: '$.x', text: `Later we should quietly ${verb} ${obj} for a fresher feel.` }];
      const hits = cd.proseGuardHits(prose, domains.filter((d) => d.domain === domainName));
      if (hits.length) caught += 1;
    }
  }
  assert.equal(caught, total, `${caught}/${total} forbidden phrasings caught`);
});

test('CDPF2: legal strategy phrasings across the same objects are NOT flagged', () => {
  const verbs = ['favor', 'soften', 'respect', 'echo', 'lean on', 'protect'];
  const objects = ['the plates', 'the music bed', 'this image', 'the score'];
  const domains = cd.deriveProtectedDomains([KEEP, MLOCK]).domains;
  for (const verb of verbs) for (const obj of objects) {
    const hits = cd.proseGuardHits([{ path: '$.x', text: `We should ${verb} ${obj} throughout the middle movement.` }], domains);
    assert.equal(hits.length, 0, `false positive: ${verb} ${obj}`);
  }
});

test('CDPF3: numeric/id specialist content is caught across randomized variants', () => {
  const rng = (n) => Math.floor(Math.random() * n);
  const templates = [
    () => `hold the reveal until ${rng(200) + 1}.${rng(9)}${rng(9)} s into the section`,
    () => `anchor at ${rng(90)}.${rng(9)}°, ${rng(90)}.${rng(9)}°`,
    () => `use plate-${rng(999)}.png as the ground`,
    () => `crossfade of ${rng(900) + 100}ms feels right`,
    () => `zoom to ${rng(80) + 101}% by the end`,
    () => `land it on frame ${rng(500)}`,
    () => `read /home/media/${rng(99)}/final.mp4 first`,
  ];
  for (let i = 0; i < 35; i += 1) {
    const text = templates[i % templates.length]();
    const hits = cd.specialistBoundaryHits([{ path: '$.x', text }]);
    assert.ok(hits.length > 0, `escaped: ${text}`);
  }
});

/* ══ DOWNSTREAM EXECUTION SAFETY ════════════════════════════════════════════ */

test('CDD1: specialist projections carry the execution contract; prose stays non-executable rationale', async () => {
  const out = await runDirector(makeTask(), makeSemantic({ action_claims: [{ claim_id: 'ac-01', domain: 'CARDS', operation: 'ADD', scope: 'beat-02', summary: 'a labelled concept card carries the mechanism' }] }));
  for (const role of ['visual_planning_director', 'editor', 'sound_music_director', 'audience_packaging_director']) {
    const projection = director.specialistProjection(out.creative_direction, role);
    assert.equal(projection.execution_contract.executable_surface, 'action_claims', role);
    assert.equal(projection.execution_contract.prose_classification, 'NON_EXECUTABLE_CREATIVE_RATIONALE', role);
    assert.ok(Array.isArray(projection.action_claims), role);
  }
});

/* ══ REGRESSIONS KEPT FROM v1 (dispatch fences, envelope, style firewall) ═══ */

test('CDK1: live dispatch remains refused fail-closed; module exists but lifecycle gates hold', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agent-registry.json'), 'utf8'));
  const registration = registry.agents.find((a) => a.agent_id === 'creative_director');
  const readiness = dispatchAuthority.implementationReadiness(ROOT, registration);
  assert.equal(readiness.authorized, false);
  assert.equal(readiness.code, 'BLOCKED_AGENT_NOT_ENABLED');
  assert.throws(() => runner.resolveAgent(ROOT, 'creative_director'), (e) => e.code === 'BLOCKED_AGENT_NOT_ENABLED');
});

test('CDK2: run envelope still satisfies the canonical runner contract; digest is canonical', async () => {
  const out = await runDirector(makeTask(), makeSemantic());
  const envelope = { ...out, control_room: director.controlRoomView(out) };
  assert.equal(runner.validateEnvelope(envelope, 'creative_director', 'task-cd-0001'), null);
  assert.equal(cd.directionDigest(out.creative_direction), out.creative_direction.direction_digest_sha256);
  assert.equal(out.creative_direction.schema, 'vidtoolz.creativeDirection.v2');
});

test('CDK3: assembler refuses canary/trial packages and fabricated ACTIVE style authority (kept)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-canary2-'));
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FIXTURE, 'utf8'));
  pkg.datasheet.best_title = 'CANARY — trial (NOT FOR PUBLICATION)';
  fs.writeFileSync(path.join(tmp, 'c.json'), JSON.stringify(pkg));
  assert.throws(() => assembler.candidateScriptFromDiscoveryPackage(path.join(tmp, 'c.json'), 'structure_a', { discoveryRoot: tmp }), (e) => e.code === 'CANDIDATE_PACKAGE_IS_CANARY');
  fs.rmSync(tmp, { recursive: true, force: true });
  const task = makeTask();
  task.style_reference.human_approved = false;
  const out = await runDirector(task, makeSemantic());
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /STYLE_AUTHORITY_FABRICATED/);
});

/* ══ HOSTILE SELF-AUDIT REGRESSIONS (escapes found and closed in repair) ════ */

test('CDX1: long-distance mutation phrasing within one sentence is caught; cross-sentence compliance is not', async () => {
  const task = makeTask({ humanConstraints: [KEEP] });
  const hostile = makeSemantic({
    level_a_strategy: { macro_philosophy: 'replace, at the earliest tasteful opportunity we can find, every one of the plates' },
    media_strategy: { generation_philosophy: 'reuse only', reuse_directive: 'x', locked_scopes: ['beat-03'], replacement_requests: [] },
    constraint_compliance: [{ constraint_id: 'hc-keep', compliance: 'kept' }],
  });
  const out = await runDirector(task, hostile);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_KEEP_MEDIA_CONTRADICTION/);
  const crossSentence = cd.proseGuardHits(
    [{ path: '$.x', text: 'We will replace nothing here. The music stays exactly as locked.' }],
    cd.deriveProtectedDomains([{ constraint_id: 'm', type: 'MUSIC_LOCK', text: 'lock' }]).domains
  );
  assert.equal(crossSentence.length, 0, 'sentence boundaries stop proximity matching');
});

test('CDX2: spelled-out timing and spelled-out filenames are specialist content', async () => {
  const spelledTime = await runDirector(makeTask(), makeSemantic({ tone: { register: 'serious', energy_arc: 'let the first cut land at thirty-seven seconds for rhythm' } }));
  assert.equal(spelledTime.state, 'ESCALATED');
  assert.match(spelledTime.reason, /SPECIALIST_EXECUTION_BOUNDARY_VIOLATION/);
  const spelledFile = await runDirector(makeTask(), makeSemantic({ creative_thesis: { statement: 'ground everything on the plate called final dash plate dot png', experience_goal: 'x' } }));
  assert.equal(spelledFile.state, 'ESCALATED');
  assert.match(spelledFile.reason, /SPECIALIST_EXECUTION_BOUNDARY_VIOLATION/);
});

test('CDX3: structured CUSTOM on a domain with no deterministic coverage escalates without an adjudicator, and defers to a bounded adjudicator when one exists', async () => {
  const toneCustom = { constraint_id: 'hc-tone', type: 'CUSTOM', text: 'keep the current dark tone', protected: { domain: 'TONE', forbidden_operations: ['CHANGE'] } };
  const task = makeTask({ humanConstraints: [toneCustom] });
  const semantic = makeSemantic({ constraint_compliance: [{ constraint_id: 'hc-tone', compliance: 'dark tone preserved' }] });
  const out = await runDirector(task, semantic);
  assert.equal(out.state, 'ESCALATED');
  assert.match(out.reason, /HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION/);
  const outWithAdjudicator = await runDirector(task, semantic, { semanticAdjudicator: () => ({ verdict: 'PASS' }) });
  assert.equal(outWithAdjudicator.state, 'PREVIEW_ONLY', 'bounded adjudicator resolves the residual-coverage case');
});

test('CDX4: malformed model output (array fields returned as scalars/objects) fails closed, never crashes', async () => {
  const shapes = [
    { confidence: { level: 'HIGH' } },
    { style_patterns_cited: 'P-02' },
    { visual_mode_mix: 'all six' },
    { human_decisions_required: 'none' },
    { intentional_deviations: {} },
    { action_claims: 'no claims' },
    { density_arc: { shape: 'x', movements: 'four', relief_points: 'y' } },
    { card_strategy: { role: 'x', argument_sections_needing_cards: 'beat-02', patterns_suggested: [], restraint: 'y' } },
  ];
  for (const shape of shapes) {
    const out = await runDirector(makeTask(), makeSemantic(shape));
    assert.ok(['ESCALATED', 'BLOCKED'].includes(out.state), `${JSON.stringify(shape)} => ${out.state}`);
    assert.equal(out.creative_direction, null, 'no artifact ships from malformed output');
  }
});
