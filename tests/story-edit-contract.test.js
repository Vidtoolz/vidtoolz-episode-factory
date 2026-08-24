'use strict';

// Story Edit Contract canaries.
//
// The contract is advisory. Its only safety obligation is the primary
// invariant: it must never tell the operator that text is safer to edit than
// STORY_EDITOR_SUCCESSOR_V1 would actually permit. Equally conservative or more
// conservative is fine; more permissive is a defect. Every agreement case below
// compares what the projection promises BEFORE an edit against what the
// enforcing validator does AFTER the corresponding edit.
//
// SEC1-SEC4 are preserved from the original contract commit (f880eb0), moved
// onto the canonical harness so they run from scripts/verify.sh.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('./_helpers.js');
const contract = require('../scripts/story-edit-contract.js');
const storySuccessor = require('../scripts/story-successor.js');

const BOUND = 'The render is 40% faster.';
const RHETORICAL = 'Now look at the workflow differently.';
const NEUTRAL_REWRITE = 'This line simply reads a little more plainly now.';

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-edit-contract-'));
  const sb = path.join(root, 'sb');
  fs.mkdirSync(path.join(sb, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'lib', 'versions.js'), `module.exports={listVersions:()=>[{id:'v1',content_hash:'${'a'.repeat(64)}'}]};\n`);
  const binding = {
    binding_id: 'b1',
    section_id: 'hook',
    assertion_text: options.assertion_text === undefined ? BOUND : options.assertion_text,
    assertion_text_sha256: options.assertion_text_sha256 === undefined ? 'd'.repeat(64) : options.assertion_text_sha256,
    claim_ref: { canonical_id: 'claim-speed' },
    research_result_ref: { result_id: 'research-speed' },
  };
  const story = {
    schema_version: 1,
    artifact_type: 'story-script-version',
    project_id: 'project-1',
    version_id: 'v1',
    parent_version: null,
    content_hash: 'a'.repeat(64),
    central_claim: 'A bounded workflow.',
    sections: [{ id: 'hook', order: 1, beat: 'Hook', dialogue: options.dialogue || `${BOUND} ${RHETORICAL}` }],
    approval: { state: 'approved' },
    research: { bindings: options.bindings === undefined ? [binding] : options.bindings, result_refs: [] },
  };
  return { task: { script_builder_root: sb, data_root: root }, story };
}

const projectOf = (f) => contract.project({ ...f, ownership: { current_owner: 'HUMAN', revision: 2 } });

function withDialogue(story, dialogue) {
  return { ...story, version_id: 'v2', parent_version: 'v1', sections: [{ ...story.sections[0], dialogue }] };
}

// What the ENFORCING validator actually does for an edit.
function enforce(before, after) {
  const carry = storySuccessor.carryResearchBindings(before, after);
  const unsupported = storySuccessor.potentialUnsupportedAssertions(before, after, carry.carried);
  return {
    research_review_required: carry.invalidated.length > 0,
    carried: carry.carried.length,
    new_unsupported: unsupported.map((item) => item.assertion_text),
  };
}

function sentences(projection) {
  return projection.sections.flatMap((section) => section.sentences);
}

// ---------------------------------------------------------------- SEC1..SEC4

test('SEC1 bound and rhetorical sentences are visibly distinct before editing', () => {
  const out = projectOf(fixture());
  assert.deepEqual(out.sections[0].sentences.map((x) => x.classification), ['RESEARCH_BOUND', 'HUMAN_EDITABLE']);
  assert.equal(out.sections[0].sentences[0].research_bindings[0].claim_ref, 'claim-speed');
  assert.match(out.handoff.url, /project_id=project-1&version_id=v1/);
  assert.equal(out.approval.edit_effect, 'STALE');
});

test('SEC2 whitespace normalization preserves exact bounded assertion continuity', () => {
  const f = fixture();
  const section = { ...f.story.sections[0], dialogue: `The render is   40% faster.\n\n${RHETORICAL}` };
  assert.equal(contract.classifySentence(f.story, section, BOUND).classification, 'RESEARCH_BOUND');
});

test('SEC3 changed numbers and new factual assertions require Research or specialist review', () => {
  const f = fixture();
  const section = f.story.sections[0];
  assert.equal(contract.classifySentence(f.story, section, 'The render is 80% faster.').classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
  assert.equal(contract.classifySentence(f.story, section, 'The benchmark shows lower costs.').classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
});

test('SEC4 exact HUMAN-owned Story head is fenced against concurrent Script Builder versions', () => {
  const f = fixture();
  contract.assertExactHead(f.task, f.story);
  fs.writeFileSync(path.join(f.task.script_builder_root, 'lib', 'versions.js'), `module.exports={listVersions:()=>[{id:'v2',content_hash:'${'b'.repeat(64)}'}]};\n`);
  delete require.cache[require.resolve(path.join(f.task.script_builder_root, 'lib', 'versions.js'))];
  assert.throws(() => contract.assertExactHead(f.task, f.story), (e) => e.code === 'UPSTREAM_STORY_HEAD_CHANGED');
});

// ------------------------------------------------- editability + vocabulary

test('SEC5 restricted classifications never report editable:true', () => {
  assert.deepEqual(contract.EDITABLE_BY_CLASSIFICATION, {
    HUMAN_EDITABLE: true, RESEARCH_BOUND: false, REQUIRES_RESEARCH_OR_SPECIALIST: false,
  });
  const out = projectOf(fixture());
  for (const item of sentences(out)) {
    assert.equal(item.editable, item.classification === 'HUMAN_EDITABLE', `editable must track ${item.classification}`);
  }
});

test('SEC6 sentence vocabulary excludes system-managed metadata', () => {
  assert.deepEqual(Object.keys(contract.CLASSIFICATIONS).sort(),
    ['HUMAN_EDITABLE', 'REQUIRES_RESEARCH_OR_SPECIALIST', 'RESEARCH_BOUND']);
  assert.equal(Object.values(contract.CLASSIFICATIONS).includes('SYSTEM_MAINTAINED'), false);
  // System-managed metadata remains a separate, non-sentence domain.
  assert.ok(contract.SYSTEM_MAINTAINED_FIELDS.includes('content_hash'));
  assert.ok(projectOf(fixture()).system_maintained.includes('research.bindings'));
});

// ------------------------------------------------ advisory vs enforcement

test('SEC7 advisory projection stays readable when the Script Builder head moved', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.task.script_builder_root, 'lib', 'versions.js'), `module.exports={listVersions:()=>[{id:'v2',content_hash:'${'b'.repeat(64)}'}]};\n`);
  delete require.cache[require.resolve(path.join(f.task.script_builder_root, 'lib', 'versions.js'))];
  const out = projectOf(f);
  assert.equal(out.head.state, 'HEAD_CHANGED');
  assert.equal(out.head.revalidation_required, true);
  assert.match(out.head.explanation, /snapshot|reconcile/i);
  // Guidance is still legible, and enforcement is untouched.
  assert.equal(out.sections[0].sentences[0].classification, 'RESEARCH_BOUND');
  assert.throws(() => contract.assertExactHead(f.task, f.story), (e) => e.code === 'UPSTREAM_STORY_HEAD_CHANGED');
});

test('SEC8 the projection carries no write path', () => {
  for (const key of Object.keys(contract)) {
    assert.doesNotMatch(key, /^(apply|write|save|set|approve|update|create|delete)/i, `unexpected mutating export ${key}`);
  }
  assert.equal(projectOf(fixture()).read_only, true);
  assert.equal(projectOf(fixture()).authority, 'STORY_EDITOR_SUCCESSOR_V1');
});

// ---------------------------------------- projection / validator agreement

test('SEC9 case A: unbound rhetorical prose is editable and causes no Research escalation', () => {
  const f = fixture();
  const item = sentences(projectOf(f)).find((x) => x.text === RHETORICAL);
  assert.equal(item.classification, 'HUMAN_EDITABLE');
  assert.equal(item.editable, true);
  const enforced = enforce(f.story, withDialogue(f.story, `${BOUND} ${NEUTRAL_REWRITE}`));
  assert.equal(enforced.research_review_required, false);
  assert.equal(enforced.carried, 1);
  assert.deepEqual(enforced.new_unsupported, []);
});

test('SEC10 case B: whitespace-only change keeps the binding on both sides', () => {
  const f = fixture();
  const enforced = enforce(f.story, withDialogue(f.story, `The render is   40% faster.\n\n${RHETORICAL}`));
  assert.equal(enforced.research_review_required, false);
  assert.equal(enforced.carried, 1);
  const out = projectOf(fixture({ dialogue: `The render is   40% faster. ${RHETORICAL}` }));
  assert.equal(out.sections[0].sentences[0].classification, 'RESEARCH_BOUND');
});

test('SEC11 case C: rewording a bound assertion is warned about and escalated', () => {
  const f = fixture();
  const warned = sentences(projectOf(f)).find((x) => x.text === BOUND);
  assert.equal(warned.classification, 'RESEARCH_BOUND');
  assert.equal(warned.editable, false);
  assert.match(warned.consequence, /Research continuity/i);
  const reworded = 'The render finishes 40% quicker.';
  const enforced = enforce(f.story, withDialogue(f.story, `${reworded} ${RHETORICAL}`));
  assert.equal(enforced.research_review_required, true);
  assert.equal(enforced.carried, 0);
});

test('SEC12 case D: changing the factual value never retains the old binding', () => {
  const f = fixture();
  const mutated = 'The render is 80% faster.';
  const enforced = enforce(f.story, withDialogue(f.story, `${mutated} ${RHETORICAL}`));
  assert.equal(enforced.carried, 0, '40% evidence must not carry an 80% claim');
  assert.equal(enforced.research_review_required, true);
  assert.deepEqual(enforced.new_unsupported, [mutated]);
  assert.equal(contract.classifySentence(f.story, f.story.sections[0], mutated).classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
});

test('SEC13 case E: removing a bound assertion escalates as evidence loss', () => {
  const f = fixture();
  const enforced = enforce(f.story, withDialogue(f.story, RHETORICAL));
  assert.equal(enforced.research_review_required, true);
  assert.equal(enforced.carried, 0);
  assert.deepEqual(enforced.new_unsupported, [], 'removal loses evidence without inventing a claim');
  // The projection warned the sentence was restricted before removal.
  assert.equal(sentences(projectOf(f)).find((x) => x.text === BOUND).editable, false);
});

test('SEC14 case F: a new factual claim is flagged while the untouched binding survives', () => {
  const f = fixture();
  const added = 'Independent research shows it is cheaper.';
  const enforced = enforce(f.story, withDialogue(f.story, `${BOUND} ${RHETORICAL} ${added}`));
  assert.equal(enforced.carried, 1, 'the untouched bound sentence keeps its evidence');
  assert.equal(enforced.research_review_required, false);
  assert.deepEqual(enforced.new_unsupported, [added], 'the new claim is flagged on its own');
  const out = projectOf(fixture({ dialogue: `${BOUND} ${RHETORICAL} ${added}` }));
  const map = new Map(out.sections[0].sentences.map((x) => [x.text, x.classification]));
  assert.equal(map.get(BOUND), 'RESEARCH_BOUND');
  assert.equal(map.get(added), 'REQUIRES_RESEARCH_OR_SPECIALIST');
});

test('SEC15 case G: zero-match binding drift fails conservative with a typed diagnostic', () => {
  const out = projectOf(fixture({ dialogue: `${RHETORICAL} The pipeline simply behaves differently.` }));
  const section = out.sections[0];
  assert.equal(section.evidence_placement, contract.EVIDENCE_UNRESOLVED);
  const diagnostic = section.diagnostics.find((d) => d.code === 'STORY_EDIT_CONTRACT_EVIDENCE_UNLOCATED');
  assert.ok(diagnostic, 'unlocated evidence must be reported');
  assert.equal(diagnostic.technical.match_count, 0);
  assert.equal(diagnostic.technical.binding_id, 'b1');
  assert.doesNotMatch(diagnostic.explanation, /sha256|[0-9a-f]{32}/i, 'the human explanation must not lead with hashes');
  for (const item of section.sentences) {
    assert.equal(item.classification, 'REQUIRES_RESEARCH_OR_SPECIALIST');
    assert.equal(item.editable, false, 'no prose may read as free while evidence placement is unresolved');
    assert.match(item.reason, /placement is unresolved/i);
  }
  assert.ok(out.diagnostics.some((d) => d.code === 'STORY_EDIT_CONTRACT_EVIDENCE_UNLOCATED'));
});

test('SEC16 case H: multi-match binding drift fails conservative the same way', () => {
  const out = projectOf(fixture({
    assertion_text: '40% faster',
    dialogue: `The render is 40% faster. Exports are 40% faster as well. ${RHETORICAL}`,
  }));
  const section = out.sections[0];
  assert.equal(section.evidence_placement, contract.EVIDENCE_UNRESOLVED);
  const diagnostic = section.diagnostics.find((d) => d.code === 'STORY_EDIT_CONTRACT_EVIDENCE_AMBIGUOUS');
  assert.ok(diagnostic, 'ambiguous evidence must be reported');
  assert.equal(diagnostic.technical.match_count, 2);
  for (const item of section.sentences) {
    assert.equal(item.editable, false, 'ambiguous placement must not leave any sentence free');
  }
});

test('SEC17 case I: tampered binding metadata never implies safe editability', () => {
  // Assertion hash no longer matches the text it claims to bind. The advisory
  // layer must not repair or trust it; enforcement still catches the drift.
  const f = fixture({ assertion_text_sha256: '0'.repeat(64) });
  const bound = sentences(projectOf(f)).find((x) => x.text === BOUND);
  assert.equal(bound.editable, false);
  assert.equal(bound.classification, 'RESEARCH_BOUND');
  // Retargeting the binding to text that is absent collapses to unresolved.
  const retargeted = projectOf(fixture({ assertion_text: 'A claim that was never written here.' }));
  assert.equal(retargeted.sections[0].evidence_placement, contract.EVIDENCE_UNRESOLVED);
  for (const item of retargeted.sections[0].sentences) assert.equal(item.editable, false);
});

// --------------------------------------------------------- primary invariant

test('SEC18 PRIMARY INVARIANT: nothing the projection calls editable escapes Research enforcement', () => {
  // Property test rather than a fixed list: for every sentence the projection
  // presents as freely editable, perform a neutral rewrite of exactly that
  // sentence and require the enforcing validator to raise no Research
  // escalation. A projection that were ever more permissive than the validator
  // fails here.
  const cases = [
    { dialogue: `${BOUND} ${RHETORICAL}` },
    { dialogue: `${RHETORICAL} ${BOUND} It reads better this way.` },
    { dialogue: `${BOUND} ${RHETORICAL} The pipeline simply behaves differently.` },
    { assertion_text: '40% faster', dialogue: `The render is 40% faster. Exports are 40% faster as well. ${RHETORICAL}` },
    { dialogue: `${RHETORICAL} The pipeline simply behaves differently.` },
    { bindings: [], dialogue: `${RHETORICAL} The pipeline simply behaves differently.` },
  ];
  let checked = 0;
  for (const options of cases) {
    const f = fixture(options);
    const projection = projectOf(f);
    for (const item of sentences(projection)) {
      if (!item.editable) continue;
      assert.equal(item.classification, 'HUMAN_EDITABLE');
      const after = withDialogue(f.story, f.story.sections[0].dialogue.replace(item.text, NEUTRAL_REWRITE));
      const enforced = enforce(f.story, after);
      assert.equal(enforced.research_review_required, false,
        `projection called "${item.text}" editable but the validator required Research review`);
      assert.deepEqual(enforced.new_unsupported, [],
        `projection called "${item.text}" editable but the validator flagged a new unsupported claim`);
      checked += 1;
    }
  }
  assert.ok(checked >= 4, `expected several editable sentences to verify, checked ${checked}`);
});
