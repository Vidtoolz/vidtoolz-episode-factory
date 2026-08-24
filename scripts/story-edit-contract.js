'use strict';

const path = require('node:path');
const assertions = require('./story-assertion-continuity.js');
const storySuccessor = require('./story-successor.js');

const SCHEMA_ID = 'story-editor-human-edit-contract/v1';
const CLASSIFICATIONS = Object.freeze({
  HUMAN_EDITABLE: 'HUMAN_EDITABLE',
  RESEARCH_BOUND: 'RESEARCH_BOUND',
  REQUIRES_RESEARCH_OR_SPECIALIST: 'REQUIRES_RESEARCH_OR_SPECIALIST',
  SYSTEM_MAINTAINED: 'SYSTEM_MAINTAINED',
});

function typed(code, message) { const error = new Error(message); error.code = code; return error; }
function clean(value) { return value == null ? null : String(value); }

function bindingView(binding) {
  return {
    binding_id: clean(binding.binding_id),
    assertion_text: clean(binding.assertion_text),
    claim_ref: clean(binding.claim_ref?.canonical_id || binding.claim_ref?.id),
    research_result_ref: clean(binding.research_result_ref?.result_id),
    reason: 'This exact sentence is bound to Research evidence. Rewording, moving, or removing it requires Research or specialist review.',
  };
}

function factualSignal(previous, section, sentence) {
  const candidate = { sections: [{ id: section.id, dialogue: sentence }], research: { bindings: [], result_refs: [] } };
  const empty = { ...previous, sections: [{ id: section.id, dialogue: '' }] };
  return storySuccessor.potentialUnsupportedAssertions(empty, candidate, []).length > 0;
}

function classifySentence(story, section, sentence) {
  const matches = (story.research?.bindings || []).filter((binding) => {
    if (String(binding.section_id) !== String(section.id)) return false;
    const continuity = assertions.assertionContinuity(section.dialogue, sentence, binding.assertion_text);
    return continuity.retained;
  });
  if (matches.length) return {
    classification: CLASSIFICATIONS.RESEARCH_BOUND,
    editable: true,
    change_requires: 'RESEARCH_OR_SPECIALIST_REVIEW',
    consequence: 'PLAN_SCRIPT_APPROVAL becomes stale; Research continuity must be re-established before return.',
    research_bindings: matches.map(bindingView),
  };
  if (factualSignal(story, section, sentence)) return {
    classification: CLASSIFICATIONS.REQUIRES_RESEARCH_OR_SPECIALIST,
    editable: true,
    change_requires: 'RESEARCH_OR_SPECIALIST_REVIEW',
    consequence: 'This appears factual but has no current Research binding. It must be reviewed before PLAN_SCRIPT_APPROVAL.',
    research_bindings: [],
  };
  return {
    classification: CLASSIFICATIONS.HUMAN_EDITABLE,
    editable: true,
    change_requires: 'STORY_REVIEW',
    consequence: 'Stylistic edits remain subject to fresh PLAN_SCRIPT_APPROVAL.',
    research_bindings: [],
  };
}

function assertExactHead(task, story) {
  const root = path.resolve(task.script_builder_root || '/home/vidtoolz/vidtoolz-script-builder');
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const current = versions.listVersions(task.data_root, story.project_id).at(-1);
  if (!current || current.id !== story.version_id || current.content_hash !== story.content_hash) {
    throw typed('UPSTREAM_STORY_HEAD_CHANGED', 'The exact HUMAN-owned Story version is no longer the current Script Builder head. Reload and reconcile explicitly.');
  }
  return current;
}

function project({ task, story, ownership, title = null, operational_rationale = null, scriptBuilderUrl = 'http://127.0.0.1:8030/' }) {
  const shape = storySuccessor.validateShape(story);
  if (!shape.ok) throw typed('STORY_EDIT_CONTRACT_ARTIFACT_INVALID', shape.reason_codes.join(', '));
  assertExactHead(task, story);
  const sections = [...story.sections].sort((a, b) => a.order - b.order).map((section) => ({
    section_id: section.id,
    order: section.order,
    label: clean(section.beat || section.type || `Section ${section.order}`),
    sentences: assertions.sentenceUnits(section.dialogue).map((text, index) => ({
      sentence_id: `${section.id}:${index + 1}`,
      text,
      ...classifySentence(story, section, text),
    })),
  }));
  return {
    story_edit_contract_schema_id: SCHEMA_ID,
    story_edit_contract_schema_version: 1,
    identity: { project_id: story.project_id, version_id: story.version_id },
    title: { project: clean(title), story: clean(story.central_claim) },
    sections,
    approval: { scope: 'PLAN_SCRIPT_APPROVAL', state: story.approval?.state || 'none', edit_effect: 'STALE' },
    ownership: { current_owner: ownership?.current_owner || 'UNKNOWN', revision: ownership?.revision ?? null },
    operational_rationale,
    handoff: {
      kind: 'SCRIPT_BUILDER',
      project_id: story.project_id,
      version_id: story.version_id,
      url: `${scriptBuilderUrl}?project_id=${encodeURIComponent(story.project_id)}&version_id=${encodeURIComponent(story.version_id)}`,
      exact_identity_required: true,
    },
    system_maintained: ['version_id', 'parent_version', 'content_hash', 'research.bindings', 'research.result_refs', 'approval', 'ownership', 'task/result hashes', 'operator ledger'],
    warning: 'Manual text editing never records approval. Research-bound or new factual assertions require Research or specialist review.',
  };
}

module.exports = { SCHEMA_ID, CLASSIFICATIONS, classifySentence, assertExactHead, project };
