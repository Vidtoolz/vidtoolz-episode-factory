'use strict';

const path = require('node:path');
const scriptBuilderAuthority = require('./script-builder-authority.js');
const assertions = require('./story-assertion-continuity.js');
const storySuccessor = require('./story-successor.js');

const SCHEMA_ID = 'story-editor-human-edit-contract/v1';

// Sentence classifications only. System-managed metadata is NOT a sentence
// class -- it is non-text and lives in SYSTEM_MAINTAINED_FIELDS below, so it is
// deliberately absent here rather than a dead enum member.
const CLASSIFICATIONS = Object.freeze({
  HUMAN_EDITABLE: 'HUMAN_EDITABLE',
  RESEARCH_BOUND: 'RESEARCH_BOUND',
  REQUIRES_RESEARCH_OR_SPECIALIST: 'REQUIRES_RESEARCH_OR_SPECIALIST',
});

// Non-text, system-managed metadata domain. Never a sentence classification.
const SYSTEM_MAINTAINED_FIELDS = Object.freeze(['version_id', 'parent_version', 'content_hash',
  'research.bindings', 'research.result_refs', 'approval', 'ownership', 'task/result hashes', 'operator ledger']);

// `editable` answers exactly one operator question: "may I rewrite this
// sentence myself right now without Research or specialist review?" It is
// therefore true only for HUMAN_EDITABLE. Restricted classifications must never
// report editable:true -- a consumer switching on this field would otherwise
// present Research-bound prose as free to change.
const EDITABLE_BY_CLASSIFICATION = Object.freeze({
  [CLASSIFICATIONS.HUMAN_EDITABLE]: true,
  [CLASSIFICATIONS.RESEARCH_BOUND]: false,
  [CLASSIFICATIONS.REQUIRES_RESEARCH_OR_SPECIALIST]: false,
});

// Evidence placement states for one section.
const EVIDENCE_RESOLVED = 'RESOLVED';
const EVIDENCE_UNRESOLVED = 'UNRESOLVED';

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

function classified(classification, change_requires, consequence, research_bindings, reason) {
  return {
    classification,
    editable: EDITABLE_BY_CLASSIFICATION[classification],
    change_requires,
    consequence,
    research_bindings,
    ...(reason ? { reason } : {}),
  };
}

// options.evidenceUnresolved: this section owns Research evidence whose exact
// sentence cannot be established. We must not guess which sentence carries it,
// and we must not present the absence of a bound marker as proof of safety, so
// every sentence that is not itself resolvably bound fails conservative.
function classifySentence(story, section, sentence, options = {}) {
  const matches = (story.research?.bindings || []).filter((binding) => {
    if (String(binding.section_id) !== String(section.id)) return false;
    const continuity = assertions.assertionContinuity(section.dialogue, sentence, binding.assertion_text);
    return continuity.retained;
  });
  if (matches.length) return classified(
    CLASSIFICATIONS.RESEARCH_BOUND,
    'RESEARCH_OR_SPECIALIST_REVIEW',
    'PLAN_SCRIPT_APPROVAL becomes stale; Research continuity must be re-established before return.',
    matches.map(bindingView),
  );
  if (options.evidenceUnresolved) return classified(
    CLASSIFICATIONS.REQUIRES_RESEARCH_OR_SPECIALIST,
    'RESEARCH_OR_SPECIALIST_REVIEW',
    'This section has Research evidence whose exact sentence cannot be established, so no sentence here may be treated as safe to rewrite.',
    [],
    'Research evidence exists for this section but its exact sentence placement is unresolved. Do not read the absence of a Research marker as permission to edit.',
  );
  if (factualSignal(story, section, sentence)) return classified(
    CLASSIFICATIONS.REQUIRES_RESEARCH_OR_SPECIALIST,
    'RESEARCH_OR_SPECIALIST_REVIEW',
    'This appears factual but has no current Research binding. It must be reviewed before PLAN_SCRIPT_APPROVAL.',
    [],
  );
  return classified(
    CLASSIFICATIONS.HUMAN_EDITABLE,
    'STORY_REVIEW',
    'Stylistic edits remain subject to fresh PLAN_SCRIPT_APPROVAL.',
    [],
  );
}

// Evidence placement is trustworthy only when a binding's assertion text
// resolves to exactly one sentence unit -- the same uniqueness rule
// assertionContinuity uses for retention. Zero and many are both unresolved:
// neither lets us point at a sentence, so both must fail conservative. We never
// rewrite the binding, repair its hash, or guess a sentence.
function resolveSectionEvidence(story, section) {
  const diagnostics = [];
  for (const binding of story.research?.bindings || []) {
    if (String(binding.section_id) !== String(section.id)) continue;
    const occurrences = assertions.containingUnits(section.dialogue, binding.assertion_text).length;
    if (occurrences === 1) continue;
    diagnostics.push({
      code: occurrences === 0 ? 'STORY_EDIT_CONTRACT_EVIDENCE_UNLOCATED' : 'STORY_EDIT_CONTRACT_EVIDENCE_AMBIGUOUS',
      section_id: String(section.id),
      explanation: occurrences === 0
        ? 'Research evidence is recorded for this section but its assertion no longer appears in the text.'
        : 'Research evidence for this section matches more than one sentence, so its exact placement is unresolved.',
      technical: {
        binding_id: clean(binding.binding_id),
        claim_ref: clean(binding.claim_ref?.canonical_id || binding.claim_ref?.id),
        research_result_ref: clean(binding.research_result_ref?.result_id),
        assertion_text_sha256: clean(binding.assertion_text_sha256),
        match_count: occurrences,
      },
    });
  }
  return { state: diagnostics.length ? EVIDENCE_UNRESOLVED : EVIDENCE_RESOLVED, diagnostics };
}

function assertExactHead(task, story) {
  const root = scriptBuilderAuthority.resolveScriptBuilderRoot(task.script_builder_root).root;
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const current = versions.listVersions(task.data_root, story.project_id).at(-1);
  if (!current || current.id !== story.version_id || current.content_hash !== story.content_hash) {
    throw typed('UPSTREAM_STORY_HEAD_CHANGED', 'The exact HUMAN-owned Story version is no longer the current Script Builder head. Reload and reconcile explicitly.');
  }
  return current;
}

// Advisory freshness status. The projection must stay readable when the
// Script Builder head has legitimately moved (the operator snapshotting a new
// version is the expected workflow), so head drift is reported as state here
// rather than raised as an exception. assertExactHead keeps throwing for the
// enforcing callers -- mutation, return preview and successor validation.
function headStatus(task, story) {
  try {
    const current = assertExactHead(task, story);
    return {
      state: 'CURRENT',
      current_version_id: clean(current.id),
      revalidation_required: false,
      explanation: 'This is the current script in Script Builder.',
    };
  } catch (error) {
    if (error.code === 'UPSTREAM_STORY_HEAD_CHANGED') {
      return {
        state: 'HEAD_CHANGED',
        current_version_id: null,
        revalidation_required: true,
        explanation: 'Script Builder has moved on from this version, usually because a newer version was snapshotted. This view still describes the version you opened; reconcile before returning the work to automation.',
      };
    }
    return {
      state: 'UNAVAILABLE',
      current_version_id: null,
      revalidation_required: true,
      explanation: 'The current Script Builder version could not be read, so this view cannot confirm the script is still current.',
      technical: { code: clean(error.code) || 'UNKNOWN' },
    };
  }
}

function project({ task, story, ownership, title = null, operational_rationale = null, scriptBuilderUrl = 'http://127.0.0.1:8030/' }) {
  const shape = storySuccessor.validateShape(story);
  if (!shape.ok) throw typed('STORY_EDIT_CONTRACT_ARTIFACT_INVALID', shape.reason_codes.join(', '));
  const head = headStatus(task, story);
  const diagnostics = [];
  const sections = [...story.sections].sort((a, b) => a.order - b.order).map((section) => {
    const evidence = resolveSectionEvidence(story, section);
    diagnostics.push(...evidence.diagnostics);
    return {
      section_id: section.id,
      order: section.order,
      label: clean(section.beat || section.type || `Section ${section.order}`),
      evidence_placement: evidence.state,
      diagnostics: evidence.diagnostics,
      sentences: assertions.sentenceUnits(section.dialogue).map((text, index) => ({
        sentence_id: `${section.id}:${index + 1}`,
        text,
        ...classifySentence(story, section, text, { evidenceUnresolved: evidence.state === EVIDENCE_UNRESOLVED }),
      })),
    };
  });
  return {
    head,
    diagnostics,
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
    system_maintained: [...SYSTEM_MAINTAINED_FIELDS],
    read_only: true,
    authority: 'STORY_EDITOR_SUCCESSOR_V1',
    warning: 'Manual text editing never records approval. Research-bound or new factual assertions require Research or specialist review.',
  };
}

module.exports = {
  SCHEMA_ID, CLASSIFICATIONS, SYSTEM_MAINTAINED_FIELDS, EDITABLE_BY_CLASSIFICATION,
  EVIDENCE_RESOLVED, EVIDENCE_UNRESOLVED,
  classifySentence, resolveSectionEvidence, assertExactHead, headStatus, project,
};
