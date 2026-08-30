'use strict';

/*
 * V2 full-frame prompt route: presenter-aware composition language is disabled
 * and forbidden for primary visuals (doctrine full_frame_composition), while
 * the default route keeps the FINAL_PERFORMANCE presenter-aware capability
 * exactly as before (VP58/VP72/VP75 pin that).
 */
const { assert, test } = require('./_helpers.js');
const promptAdapter = require('../scripts/visual-plan-prompt-adapter.js');
const director = require('../scripts/visual-planning-director.js');

function adapterShot(over = {}) {
  return {
    shot_id: 'shot-01HF7YAT000000000000000000',
    section_ref: { section_id: 'hook' },
    beat_ref: { canonical_beat_id: 'visual-beat-01HF7YCT000000000000000000', section_id: 'hook', aliases: [], source_provenance: null },
    narrative_function: 'make the production tradeoff immediately legible',
    subject: 'a precise visual subject',
    media_type: 'GENERATED_STILL',
    generation_mode: 'STILL',
    shot_brief: 'Vertical 9:16 composition with the subject camera-left and deliberate low-key lighting.',
    visual_assertion: null,
    presenter_relation: 'BROLL_OVERLAY',
    research_sensitive: false,
    research_refs: [],
    camera_intent: null,
    generation_requirements: { artifact_class: 'generated_still', aspect_target: '9:16', input_artifact_refs: [], quality_constraints: [], candidate_count_request: 1, generation_mode: 'STILL' },
    continuity_notes: [],
    edit_placement: 'hook',
    priority: 'HIGH',
    status: 'PLANNED',
    prompt_refs: [],
    ...over,
  };
}
function onePrompt(shotValue, options = {}) {
  return promptAdapter.buildPromptRecords([shotValue], { newPromptId: () => 'prompt-01HF7YBT000000000000000000', ...options })[0];
}
const V2 = { grammar: promptAdapter.FULL_FRAME_GRAMMAR };

test('PAV1 V2 route: a BROLL_OVERLAY shot composes FULL_FRAME with zero presenter language', () => {
  const prompt = onePrompt(adapterShot(), V2);
  assert.equal(prompt.prompt_type, 'FULL_FRAME');
  assert.doesNotMatch(prompt.prompt_text, /presenter/i);
  assert.match(prompt.prompt_text, /Full-frame composition requirement:/);
  assert.match(prompt.prompt_text, /no region of the frame is off-limits/);
});

test('PAV2 default route unchanged: presenter-aware capability retained for the final workflow', () => {
  const prompt = onePrompt(adapterShot());
  assert.equal(prompt.prompt_type, 'PRESENTER_AWARE');
  assert.match(prompt.prompt_text, /reserve clear negative space in the presenter-safe region/);
});

test('PAV3 hostile: a brief that reserves space for the presenter is refused on V2', () => {
  assert.throws(() => onePrompt(adapterShot({ shot_brief: 'Vertical 9:16, leave space for presenter in the lower right corner of the frame.' }), V2), { code: 'V2_PRESENTER_AWARE_PROMPT_FORBIDDEN' });
});

test('PAV4 hostile: VP75-style presenter-safe composition language is refused on V2', () => {
  assert.throws(() => onePrompt(adapterShot({ shot_brief: 'Vertical 9:16, subject camera-left with presenter-safe right-third negative space.' }), V2), { code: 'V2_PRESENTER_AWARE_PROMPT_FORBIDDEN' });
});

test('PAV5 V2 fidelity validation rejects presenter language and requires the full-frame line', () => {
  const shot = adapterShot();
  const verdictMissing = promptAdapter.validatePromptFidelity(shot, `Canonical subject: ${shot.subject}\nCanonical shot brief: ${shot.shot_brief}\nStory purpose: ${shot.narrative_function}\nExecution mode: STILL_IMAGE`, promptAdapter.FULL_FRAME_GRAMMAR);
  assert.ok(verdictMissing.errors.includes('V2_FULL_FRAME_REQUIREMENT_DROPPED'));
  const verdictSmuggled = promptAdapter.validatePromptFidelity(shot, `Canonical subject: ${shot.subject}\nCanonical shot brief: ${shot.shot_brief}\nStory purpose: ${shot.narrative_function}\nExecution mode: STILL_IMAGE\n${promptAdapter.FULL_FRAME_SPECIFICATION}\nkeep the presenter region clear`, promptAdapter.FULL_FRAME_GRAMMAR);
  assert.ok(verdictSmuggled.errors.includes('V2_PRESENTER_LANGUAGE_FORBIDDEN'));
});

test('PAV6 unknown grammar values are refused, not silently ignored', () => {
  assert.throws(() => onePrompt(adapterShot(), { grammar: 'V3_SOMETHING' }), { code: 'PROMPT_GRAMMAR_UNSUPPORTED' });
});

test('PAV7 VPD prompt carries the V2 grammar contract only when the task declares it', () => {
  const task = {
    production_grammar: 'VISUAL_DRAFT_V2_FULL_FRAME',
    story: { central_claim: 'claim', narrative_spine: 'spine', sections: [] },
    required_beats: [],
    output_target: { aspect_ratio: '9:16' },
  };
  const prompt = director.buildPrompt(task);
  const grammarLine = prompt.split('\n').find((line) => line.startsWith('Production grammar (V2 VISUAL_DRAFT)'));
  assert.ok(grammarLine, 'grammar contract line present');
  assert.match(grammarLine, /unique, one-use/);
  // The proxy is invisible to primary visual reasoning: the grammar line
  // itself never mentions the presenter concept.
  assert.doesNotMatch(grammarLine, /presenter|proxy/i);
  const defaultPrompt = director.buildPrompt({ ...task, production_grammar: undefined });
  assert.doesNotMatch(defaultPrompt, /Production grammar \(V2 VISUAL_DRAFT\)/);
});

test('PAV8 preflight rejects an unknown production grammar', () => {
  const verdict = director.preflight({ action: 'plan_visuals', task_id: 't', requested_by: 'r', project_id: 'p', privacy: { local_only: true }, production_grammar: 'V9', story: null });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.includes('production_grammar invalid'));
});

module.exports = { tests: require('./_helpers.js').tests };
