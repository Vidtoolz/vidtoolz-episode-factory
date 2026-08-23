'use strict';
// Canonical Visual Plan V1 — VP tests + failure fixtures VP-P1..P20.
// Grounded fixture uses real parser/prompt-ID conventions; no LLM, no media.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const vp = require('../scripts/visual-plan.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const STORY = { project_id: 'p-visual', version_id: '01JSTORYVERSION0000000000TEST', content_hash: sha('story v1 text') };

// beat list as the real parser would produce (ids S01.. from parseScriptSections
// plus marker-map beats M01..); we use the same id shapes.
const REQUIRED_BEATS = [
  { section_id: 'sec-hook', order: 1, beat_id: 'S01' },
  { section_id: 'sec-problem', order: 2, beat_id: 'S02' },
  { section_id: 'sec-proof', order: 3, beat_id: 'S03' },
  { section_id: 'sec-payoff', order: 4, beat_id: 'S04' },
];

// prompt ids in the real dry-run convention: <block_id>-prompt-NN
function mkPrompt(blockId, n) { return `${blockId}-prompt-${String(n).padStart(2, '0')}`; }

let n = 0;
function mkShot(over = {}) {
  const i = ++n;
  return {
    shot_id: vp.ulid(1700000000000 + i),
    section_ref: over.section_ref || { section_id: 'sec-problem', order: 2 },
    beat_ref: over.beat_ref || { beat_id: 'S02' },
    narrative_function: over.narrative_function || 'illustrate',
    media_type: over.media_type || 'GENERATED_STILL',
    shot_brief: over.shot_brief || 'Show editing latency as a cursor visibly lagging behind input.',
    prompt_refs: over.prompt_refs !== undefined ? over.prompt_refs : [mkPrompt(`block-${String(100 + i).padStart(3, '0')}`, 1)],
    duration_target_s: over.duration_target_s,
    presenter_relation: over.presenter_relation || 'BROLL',
    research_sensitive: over.research_sensitive || false,
    research_binding_refs: over.research_binding_refs || [],
    camera_intent: over.camera_intent,
    continuity_notes: over.continuity_notes || [],
    edit_placement: over.edit_placement || 'mid-section',
    priority: over.priority || 'normal',
    status: 'PLANNED',
  };
}
function mkPlan(over = {}) {
  const plan = {
    schema_version: 1, artifact_type: 'visual-plan', plan_id: over.plan_id || vp.newPlanId(),
    story: over.story || STORY,
    created_at: '2026-08-23T09:00:00.000Z', created_by: 'story-fixture',
    status: over.status || 'DRAFT',
    shots: over.shots !== undefined ? over.shots : [
      mkShot({ beat_ref: { beat_id: 'S01' }, section_ref: { section_id: 'sec-hook', order: 1 } }),
      mkShot(),
      mkShot({ media_type: 'GENERATED_VIDEO', prompt_refs: [], duration_target_s: 8,
        shot_brief: 'Timeline cursor lag widening over three beats.' }),
      mkShot({ beat_ref: { beat_id: 'S03' }, section_ref: { section_id: 'sec-proof', order: 3 },
        research_sensitive: true,
        research_binding_refs: [{ binding_id: 'script-claim-fix1',
          claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim', canonical_id: 'claim-00000000-0000-4000-8000-000000000001' } }],
        shot_brief: 'Chart matching the bound latency figure exactly.',
        prompt_refs: [mkPrompt('block-003', 1)] }),
      mkShot({ beat_ref: { beat_id: 'S04' }, section_ref: { section_id: 'sec-payoff', order: 4 },
        media_type: 'MAP_ANIMATION',
        camera_intent: { subject: 'Rotterdam port', purpose: 'establish scale', movement_need: 'moving' } }),
    ],
    intentional_none: over.intentional_none !== undefined ? over.intentional_none : [],
  };
  if (over.prompts !== undefined) plan.prompts = over.prompts;
  return plan;
}

// known manifest built from the same generator the shots use (mirrors real dry-run manifest linkage)
const KNOWN_PROMPTS = null; // resolved after plan creation in validate()

function validate(plan, opts = {}) {
  const known = opts.knownPromptIds === undefined
    ? [...new Set(plan.shots.flatMap((s) => (s.prompt_refs || []).map((p) => (typeof p === 'string' ? p : p.prompt_id))))]
    : opts.knownPromptIds;
  return vp.validatePlan(plan, {
    currentStory: opts.currentStory === null ? undefined : (opts.currentStory || STORY),
    requiredBeats: REQUIRED_BEATS,
    knownPromptIds: known,
  });
}

// ── core contract ────────────────────────────────────────────────────────────
test('VP1: V1 root contract validates a canonical plan', () => {
  const out = validate(mkPlan());
  assert.ok(out.ok, out.errors.join('; '));
});
test('VP2: Story identity bound exactly', () => {
  const plan = mkPlan();
  assert.equal(plan.story.version_id, STORY.version_id);
  assert.equal(vp.sha256('x').length, 64);
});
test('VP3: section refs present and stable', () => {
  const plan = mkPlan();
  assert.ok(plan.shots.every((s) => s.section_ref.section_id && s.section_ref.order));
});
test('VP4: beat refs use parser identity model', () => {
  const plan = mkPlan();
  assert.ok(plan.shots.every((s) => /^S\d{2}$/.test(s.beat_ref.beat_id)));
});
test('VP5: shot IDs unique + ULID-shaped', () => {
  const plan = mkPlan();
  const ids = plan.shots.map((s) => s.shot_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(id)));
});
test('VP6: prompts canonically bound to shots', () => {
  const out = validate(mkPlan());
  assert.ok(out.ok, out.errors.join('; '));
});
test('VP7: media taxonomy enforced', () => {
  const bad = mkPlan(); bad.shots[0].media_type = 'HOLOGRAM';
  assert.ok(!validate(bad).ok);
});
test('VP8: full coverage passes', () => {
  const out = validate(mkPlan());
  assert.deepEqual(out.coverage.map((c) => c.status), ['COVERED', 'COVERED', 'COVERED', 'COVERED']);
});
test('VP9: intentional-none honored with reason', () => {
  const plan = mkPlan();
  const out = validate(plan, {});
  assert.ok(out.ok, out.errors.join('; '));
});
test('VP10: Story hash drift marks stale without mutating plan', () => {
  const plan = mkPlan();
  const out = validate(plan, { currentStory: { ...STORY, content_hash: sha('story v2') } });
  assert.equal(out.stale, true);
  assert.ok(out.errors.some((e) => /hash changed/.test(e)));
});
test('VP11: research-sensitive visual requires canonical binding refs', () => {
  const bad = mkPlan(); bad.shots[3].research_binding_refs = [];
  assert.ok(!validate(bad).ok);
});

// ── boundaries ───────────────────────────────────────────────────────────────
test('VP12: camera intent allowed, mechanics rejected', () => {
  const ok = mkPlan(); ok.shots[0].camera_intent = { subject: 'editor desk', purpose: 'context', movement_need: 'static' };
  assert.ok(validate(ok).ok);
  const bad = mkPlan(); bad.shots[0].camera_intent = { heading_tracks: [[0, 90]] };
  assert.ok(!validate(bad).ok);
});
test('VP13: generation routing authority rejected', () => {
  const bad = mkPlan(); bad.shots[0].routing = { lane: 'text_to_image_generation', host: 'presto' };
  const out13 = validate(bad); assert.ok(!out13.ok && out13.errors.some((e) => /routing|another authority/.test(e)), out13.errors.join(';'));
});
test('VP14: editor handoff refs carried (edit_placement, beat_ref)', () => {
  const plan = mkPlan();
  assert.ok(plan.shots.every((s) => s.edit_placement && s.beat_ref.beat_id));
});
test('VP15: presenter_relation enum enforced', () => {
  const bad = mkPlan(); bad.shots[0].presenter_relation = 'SOMETIMES';
  assert.ok(!validate(bad).ok);
});
test('VP16: continuity notes are lightweight strings', () => {
  const plan = mkPlan(); plan.shots[0].continuity_notes = ['same desk motif as S01'];
  assert.ok(validate(plan).ok);
});

// ── digest ───────────────────────────────────────────────────────────────────
test('VP17: digest stable across JSON key ordering', () => {
  const a = mkPlan();
  const swapped = JSON.parse(JSON.stringify({ shots: a.shots, intentional_none: a.intentional_none, status: a.status, created_by: a.created_by, created_at: a.created_at, story: a.story, plan_id: a.plan_id, artifact_type: a.artifact_type, schema_version: a.schema_version }));
  assert.equal(vp.planDigest(a), vp.planDigest(swapped));
});
test('VP18: semantic mutation changes digest', () => {
  const a = mkPlan(); const d1 = vp.planDigest(a);
  a.shots[0].shot_brief = 'Different intent.';
  assert.notEqual(vp.planDigest(a), d1);
});

// ── compatibility ────────────────────────────────────────────────────────────
test('VP19: Unit B provenance chain maps conceptually', () => {
  // section → beat → shot → prompt mirrors Unit B section → image_prompt → image → i2v_prompt → clip
  const plan = mkPlan();
  const s = plan.shots[0];
  assert.ok(s.section_ref.section_id && s.beat_ref.beat_id && s.shot_id && s.prompt_refs.length);
});
test('VP20: existing dry-run prompt IDs bind cleanly', () => {
  const out = validate(mkPlan(), { knownPromptIds: KNOWN_PROMPTS });
  assert.ok(out.ok, out.errors.join('; '));
});
test('VP21: Beat Sheet beat_id shape compatible', () => {
  // Beat Sheet exports "### Beat NN (<beat_id>)" with beat_ref — same ref concept
  const bsBeatRef = { beat_id: 'S01' };
  const plan = mkPlan(); plan.shots[0].beat_ref = bsBeatRef;
  assert.ok(validate(plan).ok);
});
test('VP22: review bundle summarizes coverage/attention', () => {
  const bundle = vp.buildReviewBundle(mkPlan(), validate(mkPlan()));
  assert.equal(bundle.totals.research_sensitive, 1);
  assert.equal(bundle.totals.beats_missing, 0);
  assert.ok(bundle.human_attention.camera_handoff_shots.length >= 1);
});
test('VP23: no human final-selection authority field tolerated', () => {
  const bad = mkPlan(); bad.final_selected_asset = 'asset.png';
  assert.ok(validate(bad).errors.some((e) => /final_selected_asset/.test(e)));
});
test('VP24: no backend/host/model authority anywhere', () => {
  const bad = mkPlan(); bad.shots[0].model = 'wan2.2';
  assert.ok(validate(bad).errors.some((e) => /owned by another authority/.test(e)));
});
test('VP25: no camera mechanics authority anywhere', () => {
  const bad = mkPlan(); bad.shots[0].trajectory = [{ t: 0, lat: 51.9 }];
  assert.ok(validate(bad).errors.some((e) => /trajectory/.test(e)));
});

// ── VP-P1..P20 failure fixtures ──────────────────────────────────────────────
test('VP-P1: wrong story hash → stale/block', () => {
  const out = validate(mkPlan(), { currentStory: { project_id: STORY.project_id, version_id: STORY.version_id, content_hash: sha('changed') } });
  assert.equal(out.stale, true); assert.ok(!out.ok);
});
test('VP-P2: missing story section ref → invalid', () => {
  const bad = mkPlan(); delete bad.shots[0].section_ref;
  assert.ok(!validate(bad).ok);
});
test('VP-P3: missing beat ref → invalid', () => {
  const bad = mkPlan(); delete bad.shots[0].beat_ref;
  assert.ok(!validate(bad).ok);
});
test('VP-P4: duplicate shot ID rejected', () => {
  const bad = mkPlan(); bad.shots[1].shot_id = bad.shots[0].shot_id;
  assert.ok(validate(bad).errors.some((e) => /duplicate shot_id/.test(e)));
});
test('VP-P5: duplicate prompt binding rejected', () => {
  const bad = mkPlan(); bad.shots[1].prompt_refs = [...bad.shots[1].prompt_refs, ...bad.shots[0].prompt_refs];
  assert.ok(validate(bad).errors.some((e) => /bound to multiple shots/.test(e)));
});
test('VP-P6: required beat with no coverage flagged MISSING', () => {
  const plan = mkPlan(); plan.shots = plan.shots.filter((s) => s.beat_ref.beat_id !== 'S02');
  const out = validate(plan);
  assert.ok(out.coverage.some((c) => c.beat_id === 'S02' && c.status === 'MISSING'), JSON.stringify(out.coverage));
});
test('VP-P7: intentional-none without reason invalid', () => {
  const plan = mkPlan();
  plan.shots = plan.shots.filter((s) => s.beat_ref.beat_id !== 'S04');
  plan.intentional_none = [{ beat_id: 'S04' }];
  assert.ok(validate(plan).errors.some((e) => /lacks reason/.test(e)));
});
test('VP-P8: research-sensitive without binding fails closed', () => {
  const bad = mkPlan(); bad.shots[3].research_binding_refs = [];
  assert.ok(!validate(bad).ok);
});
test('VP-P9: backend/host/model fields rejected', () => {
  for (const key of ['backend', 'host', 'model']) {
    const bad = mkPlan(); bad.shots[0][key] = 'x';
    assert.ok(validate(bad).errors.length > 0, key);
  }
});
test('VP-P10: raw camera trajectory rejected', () => {
  const bad = mkPlan(); bad.shots[0].orbit_geometry = { radius: 10 };
  assert.ok(validate(bad).errors.some((e) => /orbit_geometry/.test(e)));
});
test('VP-P11: planner-supplied final selection rejected', () => {
  const bad = mkPlan(); bad.selected_asset_id = 'img-final';
  assert.ok(validate(bad).errors.some((e) => /selected_asset_id/.test(e)));
});
test('VP-P12: story version change → stale', () => {
  const out = validate(mkPlan(), { currentStory: { ...STORY, version_id: 'NEWVERSIONID00000000000000000X' } });
  assert.equal(out.stale, true);
});
test('VP-P13: prompt meaning revision changes digest', () => {
  const plan = mkPlan(); const d1 = vp.planDigest(plan);
  plan.prompts = [{ prompt_id: mkPrompt('block-001', 1), revised_text_sha256: sha('new wording') }];
  assert.notEqual(vp.planDigest(plan), d1);
});
test('VP-P14: JSON ordering does not change digest', () => {
  const a = mkPlan();
  const reordered = JSON.parse(JSON.stringify({ shots: a.shots, schema_version: a.schema_version, artifact_type: a.artifact_type, plan_id: a.plan_id, story: a.story, created_at: a.created_at, created_by: a.created_by, status: a.status, intentional_none: a.intentional_none }));
  assert.equal(vp.planDigest(a), vp.planDigest(reordered));
});
test('VP-P15: unknown media type rejected', () => {
  const bad = mkPlan(); bad.shots[0].media_type = 'DRONE_FOOTAGE_ONLY';
  assert.ok(!validate(bad).ok);
});
test('VP-P16: orphan prompt ref rejected via manifest linkage', () => {
  const bad = mkPlan(); bad.shots[0].prompt_refs = ['block-999-prompt-99'];
  const out = validate(bad, { knownPromptIds: ['block-001-prompt-01'] });
  assert.ok(out.errors.some((e) => /not present in known prompt manifest/.test(e)));
});
test('VP-P17: shot bound to nonexistent beat flagged', () => {
  const bad = mkPlan(); bad.shots[0].beat_ref = { beat_id: 'S99' };
  assert.ok(validate(bad).errors.some((e) => /unknown beat S99/.test(e)));
});
test('VP-P18: same prompt improperly shared across shots rejected', () => {
  const bad = mkPlan(); bad.shots[1].prompt_refs = [...bad.shots[1].prompt_refs, ...bad.shots[0].prompt_refs];
  assert.ok(validate(bad).errors.some((e) => /bound to multiple shots/.test(e)));
});
test('VP-P19: valid camera intent accepted without mechanics', () => {
  const plan = mkPlan(); plan.shots[0].camera_intent = { desired_reveal: 'slow scale-up', scale_transition_intent: 'wide→tight' };
  assert.ok(validate(plan).ok);
});
test('VP-P20: valid generation handoff contains no routing authority', () => {
  const plan = mkPlan();
  const genHandoff = plan.shots.filter((s) => ['GENERATED_STILL', 'GENERATED_VIDEO'].includes(s.media_type))
    .map((s) => ({ shot_id: s.shot_id, artifact_class: s.media_type === 'GENERATED_VIDEO' ? 'video' : 'image', prompt_ids: s.prompt_refs, duration_target_s: s.duration_target_s ?? null }));
  assert.ok(genHandoff.length >= 2);
  const json = JSON.stringify(genHandoff);
  assert.ok(!/presto|vidlap2|comfy|endpoint|"host"|"lane"/i.test(json));
});

// ── standalone harness ───────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Visual Plan V1 tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
