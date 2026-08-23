'use strict';

const { assert, fs, path, test, tests } = require('./_helpers.js');
const vp = require('../scripts/visual-plan.js');
const COMPAT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'visual-plan', 'compatibility.json'), 'utf8'));

const STORY_HASH = vp.sha256('canonical story bytes');
const STORY = {
  project_id: 'project-visual-001',
  version_id: 'script-version-01JSTORY0000000000000000',
  content_hash: STORY_HASH,
  approval: { state: 'approved', approved_by: 'TEST_HUMAN', approved_at: '2026-08-23T08:00:00.000Z', version_id: 'script-version-01JSTORY0000000000000000', content_hash: STORY_HASH },
  section_ids: ['sec-hook', 'sec-proof'],
};
const B1 = 'visual-beat-01HF7YAT010000000000000001';
const B2 = 'visual-beat-01HF7YAT020000000000000002';
const S1 = 'shot-01HF7YAT030000000000000003';
const S2 = 'shot-01HF7YAT040000000000000004';
const P1 = 'prompt-01HF7YAT050000000000000005';
const CLAIM = { namespace: 'vidtoolz-episode-factory/package-run-claim', canonical_id: 'claim-00000000-0000-4000-8000-000000000001', revision: 1 };
const RESULT_ID = 'research-result-00000000-0000-4000-8000-000000000001';
const RESULT_DIGEST = vp.sha256('research result');
const ASSERTION_HASH = vp.sha256('bounded visual assertion');

const clone = (value) => JSON.parse(JSON.stringify(value));

function makeBeat(id, section, alias = null) {
  return {
    canonical_beat_id: id,
    section_id: section,
    aliases: alias ? [{ namespace: alias.namespace, id: alias.id }] : [],
    source_provenance: alias ? { source_system: alias.namespace, source_id: alias.id } : null,
  };
}

function makeShot(overrides = {}) {
  return {
    shot_id: S1,
    section_ref: { section_id: 'sec-hook' },
    beat_ref: makeBeat(B1, 'sec-hook', { namespace: COMPAT.beat_sheet.alias_namespace, id: COMPAT.beat_sheet.beat_id }),
    narrative_function: 'establish the production problem',
    subject: 'editor waiting for cloud timeline response',
    media_type: 'GENERATED_STILL',
    generation_mode: 'STILL',
    shot_brief: 'A bounded editorial illustration of cursor lag under a heavy workload.',
    visual_assertion: null,
    presenter_relation: 'BROLL_OVERLAY',
    research_sensitive: false,
    research_refs: [],
    camera_intent: null,
    generation_requirements: { artifact_class: 'image', aspect_target: '9:16', duration_target_s: 4, input_artifact_refs: [], quality_constraints: ['no legible UI brand'], candidate_count_request: 2, generation_mode: 'STILL' },
    continuity_notes: ['retain workstation motif'],
    edit_placement: 'hook support',
    priority: 'HIGH',
    status: 'PROMPT_READY',
    prompt_refs: [P1],
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  const shot1 = makeShot();
  const shot2 = makeShot({
    shot_id: S2,
    section_ref: { section_id: 'sec-proof' },
    beat_ref: makeBeat(B2, 'sec-proof', { namespace: 'legacy/visual-beat-map', id: 'S02' }),
    narrative_function: 'deliver the evidence verbally',
    subject: 'presenter',
    media_type: 'PRESENTER_A_ROLL',
    generation_mode: 'NOT_APPLICABLE',
    shot_brief: 'Presenter delivers the qualified conclusion without generated media.',
    presenter_relation: 'PRESENT',
    generation_requirements: { artifact_class: 'presenter', input_artifact_refs: [], quality_constraints: [], generation_mode: 'NOT_APPLICABLE' },
    prompt_refs: [],
    status: 'PLANNED',
  });
  const plan = {
    schema_version: 1,
    artifact_type: 'visual-plan',
    plan_id: 'visual-plan-01HF7YAT000000000000000000',
    plan_revision: 1,
    supersedes: null,
    created_at: '2026-08-23T09:00:00.000Z',
    created_by: 'TEST_WRITER',
    lifecycle_state: 'AWAITING_HUMAN_REVIEW',
    story: clone(STORY),
    required_beats: [clone(shot1.beat_ref), clone(shot2.beat_ref)],
    coverage: [
      { beat_ref: clone(shot1.beat_ref), decision: 'PLAN_SHOTS', shot_ids: [S1], reason: null },
      { beat_ref: clone(shot2.beat_ref), decision: 'PLAN_SHOTS', shot_ids: [S2], reason: null },
    ],
    shots: [shot1, shot2],
    prompts: [],
    plan_digest_sha256: '',
  };
  plan.prompts = [{ prompt_id: P1, prompt_revision: 1, shot_id: S1, shot_intent_digest_sha256: vp.shotIntentDigest(shot1), prompt_text: 'Vertical editorial workstation, cursor visibly delayed, no logos.', prompt_type: 'PRESENTER_AWARE', created_by: 'visual-plan-prompt-adapter', origin: 'super-focus-import', legacy_aliases: [COMPAT.super_focus.prompt_id] }];
  Object.assign(plan, overrides);
  plan.plan_digest_sha256 = vp.planDigest(plan);
  return plan;
}

function refresh(plan) {
  for (const prompt of plan.prompts || []) {
    const shot = plan.shots.find((item) => item.shot_id === prompt.shot_id);
    if (shot) prompt.shot_intent_digest_sha256 = vp.shotIntentDigest(shot);
  }
  plan.plan_digest_sha256 = vp.planDigest(plan);
  return plan;
}

function makeResearchSensitive(plan = makePlan(), constraints = ['constraint-forbid-absolute']) {
  const shot = plan.shots[0];
  shot.research_sensitive = true;
  shot.visual_assertion = 'Cloud editing can introduce latency under high-resolution workloads.';
  shot.research_refs = [{ binding_id: 'binding-claim-1', claim_ref: clone(CLAIM), result_id: RESULT_ID, result_revision: 1, result_digest_sha256: RESULT_DIGEST, assertion_sha256: ASSERTION_HASH, required_constraint_ids: constraints, applied_constraint_ids: constraints, human_exception_ref: null }];
  return refresh(plan);
}

function researchAuthority(overrides = {}) {
  return {
    claim_ref: clone(CLAIM), result_id: RESULT_ID, result_revision: 1,
    result_digest_sha256: RESULT_DIGEST, assertion_sha256: ASSERTION_HASH,
    result_state: 'VALID', recommendation: 'ALLOW_USE_WITH_QUALIFICATION', authorization_ok: true,
    required_constraint_ids: ['constraint-forbid-absolute'], ...overrides,
  };
}

function makeApproval(plan) {
  const bytes = vp.planApprovalBytes(plan);
  return {
    schema_version: 1, approval_type: 'visual-plan-approval', plan_id: plan.plan_id,
    plan_revision: plan.plan_revision, plan_digest_sha256: plan.plan_digest_sha256,
    story: { project_id: plan.story.project_id, version_id: plan.story.version_id, content_hash: plan.story.content_hash },
    approved_by: 'TEST_HUMAN', approved_at: '2026-08-23T10:00:00.000Z', scope: 'generation-dispatch',
    binding: { artifact_path: 'test://visual-plan', artifact_sha256: vp.sha256(bytes), commit: 'TEST_COMMIT', approved_by: 'TEST_HUMAN', approved_at: '2026-08-23T10:00:00.000Z', scope: 'generation-dispatch' },
  };
}

function validate(plan, options = {}) {
  return vp.validatePlan(plan, { currentStory: options.currentStory === undefined ? STORY : options.currentStory });
}
function authorize(plan, options = {}) {
  return vp.evaluatePlanAuthority(plan, { currentStory: options.currentStory === undefined ? STORY : options.currentStory, approval: options.approval, researchAuthorityByBinding: options.researchAuthorityByBinding || {} });
}
function expectCode(output, code) { assert.ok(output.reason_codes.includes(code), `${code} absent: ${output.reason_codes.join(', ')}`); }

test('HVP-T1 strict root fields', () => { const p = makePlan(); p.master_metaphor = 'authority leak'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T2 strict Story fields', () => { const p = makePlan(); p.story.global_style = 'noir'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T3 strict shot fields', () => { const p = makePlan(); p.shots[0].episode_identity = 'new show'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T4 strict Camera fields', () => { const p = makePlan(); p.shots[0].camera_intent = { subject: 'desk', heading: 90 }; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T5 strict generation fields', () => { const p = makePlan(); p.shots[0].generation_requirements.backend = 'comfy'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T6 strict prompt fields', () => { const p = makePlan(); p.prompts[0].model = 'qwen'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T7 strict Research fields', () => { const p = makeResearchSensitive(); p.shots[0].research_refs[0].verdict = 'TRUE'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T8 project mismatch', () => { const p = makePlan(); const out = validate(p, { currentStory: { ...STORY, project_id: 'other' } }); expectCode(out, 'STORY_PROJECT_ID_MISMATCH'); assert.equal(out.current, false); });
test('HVP-T9 version mismatch', () => { const out = validate(makePlan(), { currentStory: { ...STORY, version_id: 'other-version' } }); expectCode(out, 'STORY_VERSION_ID_MISMATCH'); });
test('HVP-T10 hash mismatch', () => { const out = validate(makePlan(), { currentStory: { ...STORY, content_hash: vp.sha256('drift') } }); expectCode(out, 'STORY_CONTENT_HASH_MISMATCH'); });
test('HVP-T11 unknown section', () => { const p = makePlan(); p.shots[0].section_ref.section_id = 'unknown'; refresh(p); expectCode(validate(p), 'SECTION_REFERENCE_UNKNOWN'); });
test('HVP-T12 preview Story non-authoritative', () => { const p = makePlan(); p.story.approval = { state: 'none', approved_by: null, approved_at: null, version_id: p.story.version_id, content_hash: p.story.content_hash }; refresh(p); const out = authorize(p, { currentStory: { ...STORY, approval: p.story.approval }, approval: makeApproval(p) }); assert.equal(out.state, 'PREVIEW_ONLY'); assert.equal(out.authorization_ok, false); });
test('HVP-T13 approved Story eligibility', () => { const p = makePlan(); const out = authorize(p, { approval: makeApproval(p) }); assert.equal(out.state, 'READY_FOR_GENERATION'); assert.equal(out.authorization_ok, true); });
test('HVP-T14 canonical beat accepted', () => assert.equal(validate(makePlan()).ok, true));
test('HVP-T15 legacy alias is not canonical authority', () => { const p = makePlan(); p.required_beats[0].canonical_beat_id = 'S01'; refresh(p); expectCode(validate(p), 'BEAT_ID_MALFORMED'); });
test('HVP-T16 alias rebound blocked', () => { const p = makePlan(); p.required_beats[1].aliases = clone(p.required_beats[0].aliases); refresh(p); expectCode(validate(p), 'BEAT_ALIAS_REBOUND'); });
test('HVP-T17 duplicate beat blocked', () => { const p = makePlan(); p.required_beats[1].canonical_beat_id = B1; refresh(p); expectCode(validate(p), 'BEAT_ID_DUPLICATE'); });
test('HVP-T18 required beat exactly once', () => { const p = makePlan(); p.coverage.push(clone(p.coverage[0])); refresh(p); expectCode(validate(p), 'COVERAGE_DUPLICATE'); });
test('HVP-T19 missing beat fails', () => { const p = makePlan(); p.coverage.pop(); refresh(p); const out = validate(p); expectCode(out, 'COVERAGE_MISSING'); assert.equal(out.ok, false); });
test('HVP-T20 intentional-none valid', () => { const p = makePlan(); p.coverage[1] = { beat_ref: clone(p.required_beats[1]), decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: 'Presenter delivery is intentionally uninterrupted.' }; p.shots = p.shots.filter((s) => s.shot_id !== S2); refresh(p); assert.equal(validate(p).ok, true); });
test('HVP-T21 missing intentional-none reason fails', () => { const p = makePlan(); p.coverage[1] = { beat_ref: clone(p.required_beats[1]), decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: '' }; p.shots.pop(); refresh(p); expectCode(validate(p), 'INTENTIONAL_NO_VISUAL_INVALID'); });
test('HVP-T22 duplicate intentional-none fails', () => { const p = makePlan(); const none = { beat_ref: clone(p.required_beats[1]), decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: 'intentional' }; p.coverage = [p.coverage[0], none, clone(none)]; p.shots.pop(); refresh(p); expectCode(validate(p), 'COVERAGE_DUPLICATE'); });
test('HVP-T23 covered and intentional-none conflict fails', () => { const p = makePlan(); p.coverage.push({ beat_ref: clone(p.required_beats[0]), decision: 'INTENTIONAL_NO_VISUAL', shot_ids: [], reason: 'conflict' }); refresh(p); expectCode(validate(p), 'COVERAGE_DUPLICATE'); });
test('HVP-T24 generated shot ID valid', () => assert.ok(/^shot-/.test(vp.newShotId())));
test('HVP-T25 malformed shot ID fails', () => { const p = makePlan(); p.shots[0].shot_id = 'model-shot-one'; p.coverage[0].shot_ids = ['model-shot-one']; p.prompts[0].shot_id = 'model-shot-one'; refresh(p); expectCode(validate(p), 'SHOT_ID_MALFORMED'); });
test('HVP-T26 duplicate shot fails', () => { const p = makePlan(); p.shots[1].shot_id = S1; refresh(p); expectCode(validate(p), 'SHOT_ID_DUPLICATE'); });
test('HVP-T27 changed shot intent cannot reuse ID', () => { const a = makePlan(); const b = clone(a); b.plan_revision = 2; b.supersedes = { plan_revision: 1, plan_digest_sha256: a.plan_digest_sha256 }; b.shots[0].shot_brief = 'materially replaced intent'; refresh(b); expectCode(vp.validateSuccessorPlan(a, b), 'SHOT_ID_REUSED_FOR_CHANGED_INTENT'); });
test('HVP-T28 strict prompt record', () => { const p = makePlan(); p.prompts[0].workflow = 'secret'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); });
test('HVP-T29 prompt resolves to shot', () => assert.equal(validate(makePlan()).prompts_current, true));
test('HVP-T30 orphan prompt fails', () => { const p = makePlan(); p.prompts[0].shot_id = 'shot-01HF7YAT090000000000000009'; refresh(p); expectCode(validate(p), 'PROMPT_SHOT_ORPHAN'); });
test('HVP-T31 shared prompt fails', () => { const p = makePlan(); p.shots[1].prompt_refs = [P1]; refresh(p); expectCode(validate(p), 'PROMPT_SHOT_MISMATCH'); });
test('HVP-T32 prompt revision positive', () => { const p = makePlan(); p.prompts[0].prompt_revision = 0; refresh(p); expectCode(validate(p), 'PROMPT_REVISION_INVALID'); });
test('HVP-T33 shot-intent digest matches', () => { const p = makePlan(); assert.equal(p.prompts[0].shot_intent_digest_sha256, vp.shotIntentDigest(p.shots[0])); });
test('HVP-T34 shot mutation stales prompt', () => { const p = makePlan(); p.shots[0].shot_brief = 'changed without prompt update'; p.plan_digest_sha256 = vp.planDigest(p); const out = validate(p); expectCode(out, 'PROMPT_INTENT_STALE'); assert.equal(out.prompts_current, false); });
test('HVP-T35 exact Research binding valid', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority() } }); assert.equal(out.authorization_ok, true); });
test('HVP-T36 fake canonical claim fails', () => { const p = makeResearchSensitive(); p.shots[0].research_refs[0].claim_ref.canonical_id = 'fake'; refresh(p); expectCode(validate(p), 'RESEARCH_CLAIM_REF_INVALID'); });
test('HVP-T37 stale Research fails authority', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ result_state: 'STALE', authorization_ok: false }) } }); assert.equal(out.authorization_ok, false); expectCode(out, 'RESEARCH_STALE'); });
test('HVP-T38 RESEARCH_MORE returns upstream', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ recommendation: 'RESEARCH_MORE', authorization_ok: false }) } }); assert.equal(out.state, 'RETURN_TO_RESEARCH'); });
test('HVP-T39 Research result digest mismatch', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ result_digest_sha256: vp.sha256('different') }) } }); expectCode(out, 'RESEARCH_BINDING_MISMATCH'); });
test('HVP-T40 required qualifier missing', () => { const p = makeResearchSensitive(); p.shots[0].research_refs[0].applied_constraint_ids = []; refresh(p); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority() } }); expectCode(out, 'RESEARCH_CONSTRAINT_UNSATISFIED'); });
test('HVP-T41 human exception exact reference validates structurally', () => { const p = makeResearchSensitive(); p.shots[0].research_refs[0].human_exception_ref = { exception_id: 'research-exception-00000000-0000-4000-8000-000000000001', digest_sha256: vp.sha256('exception') }; refresh(p); assert.equal(validate(p).ok, true); });
test('HVP-T42 visual assertion retained in review', () => { const p = makeResearchSensitive(); const bundle = vp.buildReviewBundle(p, authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority() } })); assert.match(bundle.shots[0].visual_assertion, /latency/); });
test('HVP-T43 Camera injection rejected', () => { for (const key of ['heading', 'pitch', 'tilt', 'orbit', 'spiral', 'altitude', 'coordinates', 'path', 'easing', 'keyframes', 'trajectory', 'camera_grammar']) { const p = makePlan(); p.shots[0].camera_intent = { subject: 'desk', [key]: 'x' }; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); } });
test('HVP-T44 generation routing injection rejected', () => { for (const key of ['lane', 'backend', 'host', 'model', 'engine', 'workflow', 'seed', 'ip', 'fallback', 'worker']) { const p = makePlan(); p.shots[0].generation_requirements[key] = 'x'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); } });
test('HVP-T45 Creative injection rejected', () => { for (const key of ['master_metaphor', 'episode_identity', 'global_style', 'mood_authority']) { const p = makePlan(); p[key] = 'x'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); } });
test('HVP-T46 Presenter authority injection rejected', () => { for (const key of ['selected_take', 'wardrobe', 'performance_approved']) { const p = makePlan(); p.shots[0][key] = 'x'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); } });
test('HVP-T47 final selection injection rejected', () => { for (const key of ['selected', 'selected_asset_id', 'final_asset', 'approved_asset']) { const p = makePlan(); p.shots[0][key] = 'x'; refresh(p); expectCode(validate(p), 'UNKNOWN_FIELD'); } });
test('HVP-T48 plan revision one valid', () => assert.equal(validate(makePlan()).ok, true));
test('HVP-T49 monotonic successor valid', () => { const a = makePlan(); const b = clone(a); b.plan_revision = 2; b.supersedes = { plan_revision: 1, plan_digest_sha256: a.plan_digest_sha256 }; refresh(b); assert.equal(vp.validateSuccessorPlan(a, b).valid, true); });
test('HVP-T50 revision regression invalid', () => { const a = makePlan(); const b = clone(a); b.plan_revision = 1; b.supersedes = { plan_revision: 1, plan_digest_sha256: a.plan_digest_sha256 }; refresh(b); expectCode(vp.validateSuccessorPlan(a, b), 'PLAN_REVISION_NON_MONOTONIC'); });
test('HVP-T51 digest required', () => { const p = makePlan(); p.plan_digest_sha256 = ''; expectCode(validate(p), 'PLAN_DIGEST_MALFORMED'); });
test('HVP-T52 digest mismatch', () => { const p = makePlan(); p.plan_digest_sha256 = vp.sha256('wrong'); expectCode(validate(p), 'PLAN_DIGEST_MISMATCH'); });
test('HVP-T53 JSON ordering stable', () => { const p = makePlan(); const q = { prompts: p.prompts, shots: p.shots, coverage: p.coverage, required_beats: p.required_beats, story: p.story, lifecycle_state: p.lifecycle_state, created_by: p.created_by, created_at: p.created_at, supersedes: p.supersedes, plan_revision: p.plan_revision, plan_id: p.plan_id, artifact_type: p.artifact_type, schema_version: p.schema_version, plan_digest_sha256: p.plan_digest_sha256 }; assert.equal(vp.planDigest(p), vp.planDigest(q)); });
test('HVP-T54 plan mutation changes digest', () => { const p = makePlan(); const digest = p.plan_digest_sha256; p.shots[0].shot_brief = 'mutated'; assert.notEqual(vp.planDigest(p), digest); });
test('HVP-T55 approved mutation stales approval', () => { const p = makePlan(); const approval = makeApproval(p); p.shots[0].shot_brief = 'mutation'; refresh(p); assert.equal(vp.verifyPlanApprovalBinding(p, approval).state, 'STALE'); });
test('HVP-T56 no approval awaits human', () => { const out = authorize(makePlan()); assert.equal(out.state, 'AWAITING_HUMAN_REVIEW'); assert.equal(out.authorization_ok, false); });
test('HVP-T57 exact test-human approval', () => { const p = makePlan(); assert.equal(vp.verifyPlanApprovalBinding(p, makeApproval(p)).state, 'VALID'); });
test('HVP-T58 wrong digest approval fails', () => { const p = makePlan(); const approval = makeApproval(p); approval.plan_digest_sha256 = vp.sha256('wrong'); assert.equal(vp.verifyPlanApprovalBinding(p, approval).valid, false); });
test('HVP-T59 wrong Story approval fails', () => { const p = makePlan(); const approval = makeApproval(p); approval.story.project_id = 'other'; assert.equal(vp.verifyPlanApprovalBinding(p, approval).valid, false); });
test('HVP-T60 preview plan cannot gain authority', () => { const p = makePlan(); p.story.approval.state = 'none'; p.story.approval.approved_by = null; p.story.approval.approved_at = null; refresh(p); const out = authorize(p, { currentStory: clone(p.story), approval: makeApproval(p) }); assert.equal(out.authorization_ok, false); });
test('HVP-T61 planner cannot self-approve', () => { const p = makePlan(); const approval = makeApproval(p); approval.approved_by = 'visual-planning-agent'; assert.equal(vp.verifyPlanApprovalBinding(p, approval).valid, false); });
test('HVP-T62 all gates ready for generation', () => { const p = makePlan(); const out = authorize(p, { approval: makeApproval(p) }); assert.equal(out.state, 'READY_FOR_GENERATION'); });
test('HVP-T63 missing coverage prevents readiness', () => { const p = makePlan(); p.coverage.pop(); refresh(p); const out = authorize(p, { approval: makeApproval(p) }); assert.equal(out.authorization_ok, false); });
test('HVP-T64 stale Research prevents readiness', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ result_state: 'STALE', authorization_ok: false }) } }); assert.equal(out.authorization_ok, false); });
test('HVP-T65 stale prompt prevents readiness', () => { const p = makePlan(); p.shots[0].subject = 'new subject'; p.plan_digest_sha256 = vp.planDigest(p); const out = authorize(p, { approval: makeApproval(p) }); assert.equal(out.authorization_ok, false); expectCode(out, 'PROMPT_INTENT_STALE'); });
test('HVP-T66 Story drift prevents readiness', () => { const p = makePlan(); const out = authorize(p, { currentStory: { ...STORY, content_hash: vp.sha256('new') }, approval: makeApproval(p) }); assert.equal(out.authorization_ok, false); });
test('HVP-T67 real Beat Sheet alias preserved as provenance', () => { const p = makePlan(); assert.equal(p.required_beats[0].aliases[0].id, COMPAT.beat_sheet.beat_id); assert.equal(validate(p).ok, true); });
test('HVP-T68 real Super Focus prompt alias preserved', () => { const p = makePlan(); assert.equal(p.prompts[0].legacy_aliases[0], COMPAT.super_focus.prompt_id); assert.equal(validate(p).ok, true); });
test('HVP-T69 Unit B mapping fields complete', () => { const p = makePlan(); const shot = p.shots[0]; const prompt = p.prompts[0]; const values = { 'story.version_id': p.story.version_id, 'shot.section_ref.section_id': shot.section_ref.section_id, 'shot.beat_ref.canonical_beat_id': shot.beat_ref.canonical_beat_id, 'shot.shot_id': shot.shot_id, 'prompt.prompt_id': prompt.prompt_id, 'prompt.origin': prompt.origin }; assert.ok(COMPAT.unit_b.required_future_mapping.every((field) => values[field])); });
test('HVP-T70 review bundle exposes authority', () => { const p = makePlan(); const auth = authorize(p, { approval: makeApproval(p) }); const bundle = vp.buildReviewBundle(p, auth); assert.equal(bundle.authority.authorization_ok, true); assert.equal(bundle.plan.plan_digest_sha256, p.plan_digest_sha256); assert.equal(bundle.shots[0].prompt_revisions[0].current, true); });

test('HVP-T71 unknown beat coverage fails', () => { const p = makePlan(); p.coverage[0].beat_ref.canonical_beat_id = 'visual-beat-01HF7YAT990000000000000099'; refresh(p); expectCode(validate(p), 'COVERAGE_BEAT_UNKNOWN'); });
test('HVP-T72 wrong beat-section pairing fails', () => { const p = makePlan(); p.shots[0].beat_ref.section_id = 'sec-proof'; refresh(p); expectCode(validate(p), 'BEAT_SECTION_MISMATCH'); });
test('HVP-T73 I2V requires exact input image', () => { const p = makePlan(); p.shots[0].media_type = 'GENERATED_VIDEO'; p.shots[0].generation_mode = 'IMAGE_TO_VIDEO'; p.shots[0].generation_requirements.generation_mode = 'IMAGE_TO_VIDEO'; p.shots[0].generation_requirements.artifact_class = 'video'; p.shots[0].generation_requirements.input_artifact_refs = []; refresh(p); expectCode(validate(p), 'I2V_INPUT_REQUIRED'); });
test('HVP-T74 direct video needs no I2V input', () => { const p = makePlan(); p.shots[0].media_type = 'GENERATED_VIDEO'; p.shots[0].generation_mode = 'DIRECT_VIDEO'; p.shots[0].generation_requirements.generation_mode = 'DIRECT_VIDEO'; p.shots[0].generation_requirements.artifact_class = 'video'; refresh(p); assert.equal(validate(p).ok, true); });
test('HVP-T75 prompt wording mutation changes plan digest', () => { const p = makePlan(); const before = p.plan_digest_sha256; p.prompts[0].prompt_text = 'changed prompt wording'; assert.notEqual(vp.planDigest(p), before); });
test('HVP-T76 unknown media type rejected', () => { const p = makePlan(); p.shots[0].media_type = 'GENERIC_MEDIA'; refresh(p); expectCode(validate(p), 'MEDIA_TYPE_INVALID'); });
test('HVP-T77 planner READY state rejected', () => { const p = makePlan(); p.lifecycle_state = 'READY_FOR_GENERATION'; refresh(p); expectCode(validate(p), 'LIFECYCLE_STATE_INVALID'); });
test('HVP-T78 current Story is required for authority', () => { const p = makePlan(); const out = authorize(p, { currentStory: null, approval: makeApproval(p) }); assert.equal(out.authorization_ok, false); expectCode(out, 'CURRENT_STORY_REQUIRED'); });
test('HVP-T79 invalid Research cannot authorize', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ result_state: 'INVALID', authorization_ok: false }) } }); expectCode(out, 'RESEARCH_INVALID'); assert.equal(out.authorization_ok, false); });
test('HVP-T80 superseded Research cannot authorize', () => { const p = makeResearchSensitive(); const out = authorize(p, { approval: makeApproval(p), researchAuthorityByBinding: { 'binding-claim-1': researchAuthority({ result_state: 'SUPERSEDED', authorization_ok: false }) } }); expectCode(out, 'RESEARCH_SUPERSEDED'); assert.equal(out.authorization_ok, false); });
test('HVP-T81 unknown approval binding field rejected', () => { const p = makePlan(); const approval = makeApproval(p); approval.binding.agent_approval = true; assert.equal(vp.verifyPlanApprovalBinding(p, approval).valid, false); });
test('HVP-T82 approval bytes bind exact Story identity', () => { const p = makePlan(); const approval = makeApproval(p); p.story.version_id = 'changed'; refresh(p); assert.equal(vp.verifyPlanApprovalBinding(p, approval).state, 'STALE'); });
test('HVP-T83 generated still requires prompt', () => { const p = makePlan(); p.shots[0].prompt_refs = []; p.prompts = []; refresh(p); expectCode(validate(p), 'PROMPT_REQUIRED'); });
test('HVP-T84 planner final status taxonomy excludes selected', () => { const p = makePlan(); p.shots[0].status = 'SELECTED'; refresh(p); expectCode(validate(p), 'SHOT_STATUS_INVALID'); });

if (require.main === module) {
  (async () => {
    let passed = 0;
    let failed = 0;
    for (const item of tests) {
      try {
        await item.fn();
        passed += 1;
        console.log(`ok ${passed} - ${item.name}`);
      } catch (error) {
        failed += 1;
        console.error(`not ok - ${item.name}`);
        console.error(error.stack || error.message);
      }
    }
    console.log(`${passed}/${passed + failed} Visual Plan V1 tests passed`);
    if (failed) process.exitCode = 1;
  })();
}

module.exports = { tests };
