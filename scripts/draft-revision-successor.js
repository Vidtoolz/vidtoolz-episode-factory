#!/usr/bin/env node
'use strict';

/*
 * Draft revision successor executor.
 *
 * Applies one immutable `vidtoolz.draftRevisionPlan.v1` to its run:
 *
 *   verified plan → selective regeneration (only the plan's work items) →
 *   derived immutable artifact set (visual plan / manifest / composition /
 *   alignment / music decision / release) under draft-revision/r{v}/ →
 *   successor assembly intake (chained onto the predecessor intake) →
 *   canonical Directed Draft handoff materialize/consume/execute →
 *   directed-draft-r{v}.mp4 → technical evidence → DRAFT_REVIEW_READY.
 *
 * Everything the review did not touch is REUSED by identity and hash — the
 * same in-run immutable files the predecessor draft rendered from — never
 * copied, never regenerated, never trusted by filename alone. Predecessor
 * artifacts (draft bytes, review, registry, plan, decisions, handoffs,
 * renders) are never mutated: the successor is a new intake revision in the
 * same run, and the review lifecycle authority supersedes the old review on
 * its own.
 *
 * Generation is delegated to injected domain adapters (visual / music /
 * narration). Their canonical live wirings are the existing authorities
 * (Generation Supervisor bespoke stills, the Stable-Audio-first Draft music
 * department, the synthetic Draft narration builder); executing without
 * injected adapters fails closed by design until the first authorized live
 * revision proof — no hidden generation, no mock fallback.
 *
 * Execution is journaled and resumable: each completed work item and derived
 * artifact records path + sha; a re-run verifies and skips finished work.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const planner = require('./draft-revision-plan.js');
const directed = require('./directed-draft-assembly-handoff.js');
const renderer = require('./production-assembly-renderer.js');
const releaseAuthority = require('./production-assembly-release-authority.js');
const compositionEngine = require('./production-assembly-composition.js');
const vp = require('./visual-plan.js');
const bespoke = require('./draft-bespoke-still-policy.js');
const storyBinding = require('./package-run-story-binding.js');
const scriptBuilderAuthority = require('./script-builder-authority.js');
const planningTask = require('./agent-task-visual-planning.js');

const SUCCESSOR_SCHEMA = 'vidtoolz.draftRevisionSuccessor.v1';
const DIFF_SCHEMA = 'vidtoolz.draftRevisionDiff.v1';
const JOURNAL_SCHEMA = 'vidtoolz.draftRevisionJournal.v1';

class DraftRevisionExecutionError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftRevisionExecutionError'; this.code = code; }
}
function fail(code, message) { throw new DraftRevisionExecutionError(code, message); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file, code = 'DRAFT_REVISION_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('DRAFT_REVISION_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, jsonBytes(value));
  fs.renameSync(tmp, file);
}
function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }

function revisionPaths(runDir, version) {
  const base = path.join(runDir, planner.REVISION_DIR);
  const derived = path.join(base, `r${version}`);
  return {
    base, derived,
    journal: path.join(base, `revision-r${version}-journal.json`),
    successor: path.join(base, `revision-r${version}-successor.json`),
    diff: path.join(base, `revision-r${version}-diff.json`),
    metrics: path.join(base, `revision-r${version}-cost-metrics.json`),
    media: path.join(runDir, 'media', `draft-revision-r${version}`),
    intake: path.join(runDir, `draft-revision-intake-r${version}.json`),
    plan: path.join(derived, 'visual-plan.json'),
    manifest: path.join(derived, 'asset-manifest.json'),
    composition: path.join(derived, 'composition.json'),
    alignment: path.join(derived, 'narration-alignment.json'),
    release: path.join(derived, 'release.json'),
    music: path.join(derived, 'music-decision.json'),
    registry: path.join(derived, 'revision-generation-registry.json'),
  };
}

/* ── journal (resume authority) ──────────────────────────────────────────── */

function loadJournal(paths, plan) {
  if (!fs.existsSync(paths.journal)) {
    return { schema: JOURNAL_SCHEMA, plan_id: plan.plan_id, plan_digest_sha256: plan.plan_digest_sha256, state: 'IN_PROGRESS', started_at: new Date().toISOString(), steps: {}, work: {} };
  }
  const journal = readJson(paths.journal, 'DRAFT_REVISION_JOURNAL_INVALID');
  if (journal.schema !== JOURNAL_SCHEMA) fail('DRAFT_REVISION_JOURNAL_INVALID', paths.journal);
  if (journal.plan_digest_sha256 !== plan.plan_digest_sha256) {
    fail('DRAFT_REVISION_JOURNAL_PLAN_MISMATCH', 'an execution journal exists for a DIFFERENT plan — refusing to mix revisions');
  }
  return journal;
}
function saveJournal(paths, journal) { atomicJson(paths.journal, journal); }
function stepDone(journal, name) {
  const step = journal.steps[name];
  if (!step || step.state !== 'DONE') return false;
  for (const [file, sha] of Object.entries(step.outputs || {})) {
    if (!fs.existsSync(file) || sha256File(file) !== sha) return false;
  }
  return true;
}
function recordStep(paths, journal, name, outputs = {}) {
  journal.steps[name] = { state: 'DONE', at: new Date().toISOString(), outputs };
  saveJournal(paths, journal);
}

/* Per-work-item completion: an interrupted run never redoes a finished
 * generation and never dispatches a duplicate uncontrolled job. */
function workDone(journal, workItemId) {
  const record = journal.work[workItemId];
  if (!record || record.state !== 'DONE') return null;
  if (record.output_path && (!fs.existsSync(record.output_path) || sha256File(record.output_path) !== record.output_sha256)) return null;
  return record;
}
function recordWork(paths, journal, workItemId, record) {
  journal.work[workItemId] = { state: 'DONE', at: new Date().toISOString(), ...record };
  saveJournal(paths, journal);
}

/* ── predecessor artifact resolution ─────────────────────────────────────── */

function intakeArtifacts(runDir, intakeRecord) {
  const records = directed.flattenArtifacts(intakeRecord.value);
  const one = (predicate, label) => {
    const matches = records.filter((item) => item.status === 'ACTIVE' && predicate(item));
    if (matches.length !== 1) fail('DRAFT_REVISION_PREDECESSOR_ARTIFACT_AMBIGUOUS', `${label}: found ${matches.length}`);
    return matches[0];
  };
  const resolvePath = (artifact) => path.isAbsolute(artifact.path) ? artifact.path : path.resolve(runDir, artifact.path);
  const pick = (predicate, label) => {
    const artifact = one(predicate, label);
    const file = resolvePath(artifact);
    if (!fs.existsSync(file)) fail('DRAFT_REVISION_PREDECESSOR_ARTIFACT_MISSING', `${label}: ${artifact.path}`);
    if (sha256File(file) !== artifact.sha256) fail('DRAFT_REVISION_REUSE_HASH_MISMATCH', `${label}: ${artifact.path} no longer matches its declared hash`);
    return { artifact, file };
  };
  return {
    story: pick((item) => item.slot_name === 'story', 'story'),
    plan: pick((item) => item.slot_name === 'visual', 'visual plan'),
    alignment: pick((item) => item.slot_name === 'narration_alignment', 'narration alignment'),
    composition: pick((item) => item.slot_name === 'composition', 'composition'),
    manifest: pick((item) => item.slot_name === 'asset_manifest', 'asset manifest'),
    release: pick((item) => item.slot_name === 'visual_draft_successor_packet', 'release packet'),
    music_decision: pick((item) => item.slot_name === 'music_decision', 'music decision'),
    narration_asset: pick((item) => item.slot_name === 'narration_asset', 'narration asset'),
    music_asset: pick((item) => item.slot_name === 'music_asset', 'music asset'),
  };
}

/* ── SCRIPT: adopt a human-approved Story successor (never fabricate) ────── */

function resolveStoryForScriptWork(runDir, plan, scriptItems, options = {}) {
  const binding = storyBinding.readBinding(runDir);
  if (!binding) fail('DRAFT_REVISION_STORY_BINDING_MISSING', path.basename(runDir));
  const root = scriptBuilderAuthority.resolveScriptBuilderRoot(options.scriptBuilderRoot || binding.story.source_root).root;
  const dataRoot = path.join(root, 'data');
  const versions = require(path.join(root, 'lib', 'versions.js'));
  const all = versions.listVersions(dataRoot, plan.bindings.story.project_id);
  const head = all.at(-1);
  if (!head) fail('DRAFT_REVISION_STORY_MISSING', plan.bindings.story.project_id);
  if (head.id === plan.bindings.story.version_id) {
    return { blocked: true, reason: 'SCRIPT_SUCCESSOR_REQUIRED', detail: 'the review requires script changes, but no newer Story version exists — author and human-approve a Story successor first (approval is never fabricated)' };
  }
  const byId = new Map(all.map((item) => [item.id, item]));
  const seen = new Set(); let cursor = head; let found = false;
  while (cursor) {
    if (seen.has(cursor.id)) fail('DRAFT_REVISION_STORY_LINEAGE_LOOP', cursor.id);
    seen.add(cursor.id);
    if (cursor.id === plan.bindings.story.version_id) { found = true; break; }
    cursor = cursor.parent_version ? byId.get(cursor.parent_version) : null;
  }
  if (!found) fail('DRAFT_REVISION_STORY_LINEAGE_MISMATCH', `${head.id} does not descend from reviewed ${plan.bindings.story.version_id}`);
  if (head.approval?.state !== 'approved') {
    return { blocked: true, reason: 'SCRIPT_SUCCESSOR_UNAPPROVED', detail: `Story successor ${head.id} exists but is not human-approved` };
  }
  if (versions.scriptContentHash(head.sections) !== head.content_hash) fail('DRAFT_REVISION_STORY_CONTENT_INVALID', head.id);
  const reviewed = byId.get(plan.bindings.story.version_id);
  if (!reviewed) fail('DRAFT_REVISION_STORY_MISSING', plan.bindings.story.version_id);
  const oldById = new Map((reviewed.sections || []).map((section) => [section.id, section]));
  const newById = new Map((head.sections || []).map((section) => [section.id, section]));
  const changed = [...newById.keys()].filter((id) => oldById.has(id) && oldById.get(id).dialogue !== newById.get(id).dialogue);
  const removed = [...oldById.keys()].filter((id) => !newById.has(id));
  const added = [...newById.keys()].filter((id) => !oldById.has(id));
  if (added.length) {
    return { blocked: true, reason: 'SCRIPT_SUCCESSOR_ADDS_SECTIONS', detail: `Story successor adds sections (${added.join(', ')}); adding sections needs a fresh visual-planning pass, not a selective revision` };
  }
  for (const item of scriptItems) {
    if (item.target.section_id === null) continue; // whole-story rewrite: the human change set is authoritative
    if (item.kind === 'SCRIPT_SECTION_REWRITE' && !changed.includes(item.target.section_id)) {
      return { blocked: true, reason: 'SCRIPT_SUCCESSOR_MISMATCH', detail: `review asked to rewrite ${item.target.section_id}, but the approved successor leaves it unchanged` };
    }
    if (item.kind === 'SCRIPT_SECTION_CUT' && !removed.includes(item.target.section_id)) {
      return { blocked: true, reason: 'SCRIPT_SUCCESSOR_MISMATCH', detail: `review asked to cut ${item.target.section_id}, but the approved successor still contains it` };
    }
  }
  const versionFile = head._file || path.join(dataRoot, 'projects', plan.bindings.story.project_id, 'versions', `${head.id}.md`);
  if (!fs.existsSync(versionFile)) fail('DRAFT_REVISION_STORY_FILE_MISSING', versionFile);
  /* The canonical Story projection (approval carrying approved_by/version_id/
   * content_hash) is what every downstream authority validates against — the
   * raw version record's approval field is not that shape. */
  const loaded = planningTask.loadCanonicalStory({ scriptBuilderRoot: root, projectId: plan.bindings.story.project_id, versionId: head.id });
  if (loaded.story.approval?.state !== 'approved') {
    return { blocked: true, reason: 'SCRIPT_SUCCESSOR_UNAPPROVED', detail: `Story successor ${head.id} is not human-approved in the canonical projection` };
  }
  return {
    blocked: false,
    story: { project_id: plan.bindings.story.project_id, version_id: head.id, content_hash: head.content_hash, approval_state: 'approved' },
    approval: loaded.story.approval,
    sections: head.sections,
    changed_sections: changed,
    removed_sections: removed,
    version_file: versionFile,
    version_file_sha256: sha256File(versionFile),
  };
}

/* ── VISUAL: derive a successor visual plan ─────────────────────────────── */

function slotContext(plan, slotId) {
  const slot = (plan.draft_bespoke_still_policy?.slots || []).find((item) => item.slot_id === slotId);
  if (!slot) fail('DRAFT_REVISION_SLOT_UNKNOWN', slotId);
  const prompt = (plan.prompts || []).find((item) => item.prompt_id === slot.prompt_id);
  if (!prompt) fail('DRAFT_REVISION_SLOT_PROMPT_MISSING', slotId);
  const shot = (plan.shots || []).find((item) => item.shot_id === prompt.shot_id);
  if (!shot) fail('DRAFT_REVISION_SLOT_SHOT_MISSING', slotId);
  return { slot, prompt, shot };
}

/*
 * Concept change: the shot's intent changes, so the canonical successor-plan
 * rules require a NEW shot identity and a NEW prompt bound to it; the SLOT
 * identity (and therefore beat/asset identity) is preserved so everything
 * downstream stays addressable. Execution-only change: the plan is untouched.
 */
function deriveVisualPlan(predecessorPlan, conceptRevisions, cutSlotIds, storyChange, now) {
  const changed = conceptRevisions.length > 0 || cutSlotIds.length > 0 || Boolean(storyChange);
  if (!changed) return { plan: predecessorPlan, changed: false };
  const next = structuredClone(predecessorPlan);
  next.plan_revision = predecessorPlan.plan_revision + 1;
  next.supersedes = { plan_revision: predecessorPlan.plan_revision, plan_digest_sha256: predecessorPlan.plan_digest_sha256 };
  next.created_at = now;
  if (storyChange) {
    next.story = {
      ...next.story,
      version_id: storyChange.story.version_id,
      content_hash: storyChange.story.content_hash,
      ...(storyChange.approval ? { approval: structuredClone(storyChange.approval) } : {}),
    };
    if (Array.isArray(next.story.section_ids)) next.story.section_ids = storyChange.sections.map((section) => section.id);
    /* A slot pins the EXACT script text it was planned against; a Story
     * successor must move that binding, not leave stale bytes behind. */
    const dialogueById = new Map(storyChange.sections.map((section) => [section.id, String(section.dialogue || '').trim()]));
    for (const slot of next.draft_bespoke_still_policy?.slots || []) {
      if (!slot.script_binding) continue;
      slot.script_binding.story_version_id = storyChange.story.version_id;
      slot.script_binding.story_content_hash = storyChange.story.content_hash;
      const dialogue = dialogueById.get(slot.script_binding.section_id);
      if (dialogue !== undefined) {
        slot.script_binding.source_text = dialogue;
        slot.script_binding.source_text_sha256 = bespoke.digest(dialogue);
      }
    }
  }
  for (const revision of conceptRevisions) {
    const { slot, prompt, shot } = slotContext(next, revision.slot_id);
    const newShotId = vp.newShotId();
    const newPromptId = vp.newPromptId();
    const revisedShot = {
      ...shot,
      shot_id: newShotId,
      subject: revision.subject ?? shot.subject,
      shot_brief: revision.shot_brief ?? shot.shot_brief,
      narrative_function: revision.narrative_function ?? shot.narrative_function,
      status: 'PLANNED',
      prompt_refs: [newPromptId],
    };
    next.shots = next.shots.map((item) => (item.shot_id === shot.shot_id ? revisedShot : item));
    const revisedPrompt = {
      ...prompt,
      prompt_id: newPromptId,
      prompt_revision: 1,
      shot_id: newShotId,
      shot_intent_digest_sha256: vp.shotIntentDigest(revisedShot),
      prompt_text: revision.prompt_text,
      origin: 'draft-revision-successor',
      legacy_aliases: [],
    };
    next.prompts = next.prompts.filter((item) => item.prompt_id !== prompt.prompt_id).concat(revisedPrompt);
    for (const coverage of next.coverage || []) {
      coverage.shot_ids = (coverage.shot_ids || []).map((id) => (id === shot.shot_id ? newShotId : id));
    }
    slot.prompt_id = newPromptId;
    slot.prompt_sha256 = bespoke.digest(revision.prompt_text);
    slot.shot_id = newShotId;
    /* The slot's own concept fields are its identity to a human reader; a
     * concept revision must move them with the shot, not leave the rejected
     * concept described in the successor plan. */
    if (revision.shot_brief) slot.visual_concept = revision.shot_brief;
    if (revision.narrative_function) slot.purpose = revision.narrative_function;
  }
  for (const slotId of cutSlotIds) {
    const { slot, prompt, shot } = slotContext(next, slotId);
    next.draft_bespoke_still_policy.slots = next.draft_bespoke_still_policy.slots.filter((item) => item.slot_id !== slotId);
    if (Number.isInteger(next.draft_bespoke_still_policy.planned_visual_slots)) {
      next.draft_bespoke_still_policy.planned_visual_slots -= 1;
    }
    next.prompts = next.prompts.filter((item) => item.prompt_id !== prompt.prompt_id);
    next.shots = next.shots.filter((item) => item.shot_id !== shot.shot_id);
    for (const coverage of next.coverage || []) {
      if ((coverage.shot_ids || []).includes(shot.shot_id)) {
        coverage.shot_ids = coverage.shot_ids.filter((id) => id !== shot.shot_id);
        if (!coverage.shot_ids.length) {
          coverage.decision = 'INTENTIONAL_NO_VISUAL';
          coverage.reason = 'removed by human Draft review CUT';
        }
      }
    }
  }
  next.plan_digest_sha256 = vp.planDigest(next);
  const validation = vp.validatePlan(next, storyChange ? { currentStory: { ...storyChange.story, approval: { state: 'approved' } } } : {});
  if (!validation.ok) fail('DRAFT_REVISION_DERIVED_PLAN_INVALID', validation.reason_codes?.join(',') || validation.issues?.map((issue) => issue.code).join(',') || 'invalid');
  const succession = vp.validateSuccessorPlan(predecessorPlan, next);
  if (!succession.valid) fail('DRAFT_REVISION_DERIVED_PLAN_SUCCESSION_INVALID', succession.reason_codes.join(','));
  const policyCheck = bespoke.validatePlanPolicy(next);
  if (!policyCheck.ok || !policyCheck.applicable) fail('DRAFT_REVISION_DERIVED_PLAN_POLICY_INVALID', policyCheck.code || 'policy invalid');
  return { plan: next, changed: true };
}

/* ── composition derivation ──────────────────────────────────────────────── */

function retileSection(beats, sectionInterval, mode) {
  if (!beats.length) return [];
  const total = sectionInterval.out_ms - sectionInterval.in_ms;
  if (total < beats.length) fail('DRAFT_REVISION_SECTION_TOO_DENSE', `${sectionInterval.section_id}: ${total}ms for ${beats.length} beats`);
  const weights = mode === 'EQUAL' ? beats.map(() => 1) : beats.map((beat) => Math.max(1, beat.end_ms - beat.start_ms));
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  let cursor = sectionInterval.in_ms; let remaining = total;
  return beats.map((beat, index) => {
    const left = beats.length - index;
    const duration = index === beats.length - 1
      ? remaining
      : Math.max(1, Math.min(remaining - (left - 1), Math.floor((total * weights[index]) / weightTotal)));
    const tiled = { ...beat, start_ms: cursor, end_ms: cursor + duration };
    cursor += duration; remaining -= duration;
    return tiled;
  });
}

function deriveComposition(predecessorComposition, sections, changes) {
  const { cutAssetIds, pacingSections, retimeAll } = changes;
  const bySection = new Map();
  for (const beat of predecessorComposition.beats) {
    if (cutAssetIds.has(beat.beat_id)) continue;
    const list = bySection.get(beat.section_id) || [];
    list.push(beat);
    bySection.set(beat.section_id, list);
  }
  const beats = [];
  for (const section of sections) {
    const sectionBeats = bySection.get(section.section_id) || [];
    if (!sectionBeats.length) fail('DRAFT_REVISION_SECTION_UNCOVERED', section.section_id);
    const touched = retimeAll
      || pacingSections.has(section.section_id)
      || sectionBeats.some((beat) => cutAssetIds.size && !predecessorComposition.beats.every((item) => item.section_id !== section.section_id || !cutAssetIds.has(item.beat_id)));
    const needsRetile = touched
      || sectionBeats[0].start_ms !== section.in_ms
      || sectionBeats.at(-1).end_ms !== section.out_ms;
    const mode = pacingSections.has(section.section_id) ? 'EQUAL' : 'WEIGHTED';
    beats.push(...(needsRetile ? retileSection(sectionBeats, section, mode) : sectionBeats));
  }
  return beats;
}

/* ── the execution ───────────────────────────────────────────────────────── */

function requireAdapter(adapters, name, method) {
  const adapter = adapters?.[name]?.[method];
  if (typeof adapter !== 'function') {
    fail('DRAFT_REVISION_ADAPTER_REQUIRED',
      `revision execution needs adapters.${name}.${method}. Canonical live wirings: visual -> Generation Supervisor DRAFT_BESPOKE_STILL (scripts/package-run-draft-bespoke-stills.js), music -> Stable-Audio-first Draft music department (scripts/generate-draft-music.js), narration -> synthetic Draft narration (scripts/package-run-draft-narration.js). No hidden generation and no mock fallback exists by design.`);
  }
  return adapter;
}

async function executeRevisionPlan(runDirInput, options = {}) {
  const startedAt = Date.now();
  const runDir = fs.realpathSync(runDirInput);
  const runId = path.basename(runDir);
  const targetVersion = options.targetVersion
    || (() => { const view = require('./draft-review-intake.js').promotionDecisionView(runDir, options); return view.current_draft ? view.current_draft.draft_version + 1 : null; })();
  if (!targetVersion) fail('DRAFT_REVISION_NO_DRAFT', runId);
  const paths = revisionPaths(runDir, targetVersion);

  // Duplicate-successor guard: a completed revision is returned, never redone.
  if (fs.existsSync(paths.successor)) {
    const record = readJson(paths.successor);
    return { state: 'ALREADY_COMPLETE', successor: record, successor_path: paths.successor };
  }
  /* Re-invoked after a completed revision the run has already advanced, so
   * this version has no plan yet — report the finished revision instead of a
   * bare missing-plan error, and never start a duplicate. */
  const priorPaths = targetVersion > 1 ? revisionPaths(runDir, targetVersion - 1) : null;
  if (!fs.existsSync(planner.planPathFor(runDir, targetVersion)) && priorPaths && fs.existsSync(priorPaths.successor)) {
    return { state: 'ALREADY_COMPLETE', successor: readJson(priorPaths.successor), successor_path: priorPaths.successor };
  }

  const { plan } = planner.loadRevisionPlan(runDir, targetVersion);
  planner.verifyRevisionPlanCurrent(runDir, plan, options); // typed stale failure
  if (!plan.revision_required) {
    return { state: 'NO_REVISION_REQUIRED', plan_id: plan.plan_id, note: 'the review requires no change; producing a duplicate Draft would be pointless — the run keeps its current reviewed Draft' };
  }
  if (plan.decision === 'REVISION_BLOCKED') {
    return { state: 'REVISION_BLOCKED', plan_id: plan.plan_id, blocking: plan.blocking };
  }

  const timings = { started_at: new Date(startedAt).toISOString() };
  const journal = loadJournal(paths, plan);
  saveJournal(paths, journal);
  const adapters = options.adapters || {};
  const intakeRecord = directed.discoverActiveIntake(runDir);
  const artifacts = intakeArtifacts(runDir, intakeRecord);
  const predecessorPlan = readJson(artifacts.plan.file);
  const predecessorManifest = readJson(artifacts.manifest.file);
  const predecessorComposition = readJson(artifacts.composition.file);
  const predecessorAlignment = readJson(artifacts.alignment.file);
  const predecessorRelease = readJson(artifacts.release.file);
  const predecessorMusicDecision = readJson(artifacts.music_decision.file);

  const items = plan.work_items;
  const scriptItems = items.filter((item) => item.domain === 'SCRIPT');
  const visualConceptItems = items.filter((item) => item.kind === 'VISUAL_CONCEPT_REVISION');
  const visualExecItems = items.filter((item) => item.kind === 'VISUAL_EXECUTION_REGENERATION');
  const visualCutItems = items.filter((item) => item.kind === 'VISUAL_CUT');
  const musicItems = items.filter((item) => item.domain === 'MUSIC');
  const pacingItems = items.filter((item) => item.kind === 'EDIT_PACING_REBALANCE');
  const narrationItems = items.filter((item) => item.kind === 'NARRATION_REGENERATION');

  /* 1. SCRIPT: adopt the human-approved Story successor (or block). */
  let storyChange = null;
  if (scriptItems.length) {
    const resolvedStory = resolveStoryForScriptWork(runDir, plan, scriptItems, options);
    if (resolvedStory.blocked) {
      journal.state = 'BLOCKED'; journal.blocked = { reason: resolvedStory.reason, detail: resolvedStory.detail }; saveJournal(paths, journal);
      return { state: 'REVISION_BLOCKED', plan_id: plan.plan_id, blocking: [{ work_item_id: scriptItems[0].work_item_id, kind: scriptItems[0].kind, reason: `${resolvedStory.reason}: ${resolvedStory.detail}` }] };
    }
    storyChange = resolvedStory;
  }
  timings.script_ms = Date.now() - startedAt;

  const storyProjection = storyChange ? storyChange.story : plan.bindings.story;

  /* 2. NARRATION: regenerate only when the script changed or the review
   * asked; otherwise the exact predecessor narration + alignment are reused. */
  const narrationNeeded = Boolean(storyChange) || narrationItems.length > 0;
  let narration; let narrationSections;
  const narrationStarted = Date.now();
  if (narrationNeeded) {
    const workId = narrationItems[0]?.work_item_id || `script-cone-narration-r${targetVersion}`;
    let record = workDone(journal, workId);
    if (!record) {
      const generate = requireAdapter(adapters, 'narration', 'generateNarration');
      fs.mkdirSync(paths.media, { recursive: true });
      const produced = await generate({
        runDir, story: storyProjection,
        sections: storyChange ? storyChange.sections : null,
        workItem: narrationItems[0] || null, outputDir: paths.media,
      });
      if (!produced?.path || !fs.existsSync(produced.path) || sha256File(produced.path) !== produced.sha256) fail('DRAFT_REVISION_NARRATION_OUTPUT_INVALID', workId);
      if (!inside(runDir, fs.realpathSync(produced.path))) fail('DRAFT_REVISION_OUTPUT_OUTSIDE_RUN', produced.path);
      record = { output_path: produced.path, output_sha256: produced.sha256, duration_ms: produced.duration_ms, source_class: produced.source_class, sections: produced.sections };
      recordWork(paths, journal, workId, record);
    }
    narration = { path: record.output_path, sha256: record.output_sha256, duration_ms: record.duration_ms, source_class: record.source_class };
    narrationSections = record.sections;
  } else {
    narration = { path: artifacts.narration_asset.file, sha256: artifacts.narration_asset.artifact.sha256, duration_ms: artifacts.narration_asset.artifact.duration_ms, source_class: artifacts.narration_asset.artifact.class };
    narrationSections = predecessorAlignment.sections;
  }
  timings.narration_ms = Date.now() - narrationStarted;

  /* 3. VISUAL: derive the successor plan, regenerate ONLY affected slots. */
  const visualStarted = Date.now();
  const conceptRevisionInputs = [];
  const scriptDrivenSlots = storyChange
    ? (predecessorPlan.draft_bespoke_still_policy?.slots || []).filter((slot) => storyChange.changed_sections.includes(slot.script_binding.section_id)).map((slot) => slot.slot_id)
    : [];
  const removedSectionSlots = storyChange
    ? (predecessorPlan.draft_bespoke_still_policy?.slots || []).filter((slot) => storyChange.removed_sections.includes(slot.script_binding.section_id)).map((slot) => slot.slot_id)
    : [];
  for (const item of visualConceptItems) {
    const workId = `${item.work_item_id}-concept`;
    let record = workDone(journal, workId);
    if (!record) {
      const revise = requireAdapter(adapters, 'visual', 'reviseSlot');
      const context = slotContext(predecessorPlan, item.target.visual_asset_id);
      const produced = await revise({ runDir, plan: predecessorPlan, ...context, workItem: item, section: storyChange?.sections?.find((section) => section.id === item.target.section_id) || null });
      if (typeof produced?.prompt_text !== 'string' || !produced.prompt_text.trim()) fail('DRAFT_REVISION_CONCEPT_OUTPUT_INVALID', item.work_item_id);
      record = { concept: produced };
      recordWork(paths, journal, workId, record);
    }
    conceptRevisionInputs.push({ slot_id: item.target.visual_asset_id, ...record.concept });
  }
  for (const slotId of scriptDrivenSlots) {
    if (conceptRevisionInputs.some((entry) => entry.slot_id === slotId)) continue;
    const workId = `script-cone-${slotId}-concept`;
    let record = workDone(journal, workId);
    if (!record) {
      const revise = requireAdapter(adapters, 'visual', 'reviseSlot');
      const context = slotContext(predecessorPlan, slotId);
      const scriptItem = scriptItems.find((item) => item.target.section_id === context.slot.script_binding.section_id) || scriptItems[0];
      const produced = await revise({ runDir, plan: predecessorPlan, ...context, workItem: scriptItem, section: storyChange.sections.find((section) => section.id === context.slot.script_binding.section_id) || null });
      if (typeof produced?.prompt_text !== 'string' || !produced.prompt_text.trim()) fail('DRAFT_REVISION_CONCEPT_OUTPUT_INVALID', workId);
      record = { concept: produced };
      recordWork(paths, journal, workId, record);
    }
    conceptRevisionInputs.push({ slot_id: slotId, ...record.concept });
  }
  const cutSlotIds = [...visualCutItems.map((item) => item.target.visual_asset_id), ...removedSectionSlots];
  const derivedPlan = deriveVisualPlan(predecessorPlan, conceptRevisionInputs, cutSlotIds, storyChange, options.now || new Date().toISOString());
  let planFile = artifacts.plan.file;
  if (derivedPlan.changed) { writeImmutable(paths.plan, derivedPlan.plan); planFile = paths.plan; }

  const regenerateSlotIds = [
    ...conceptRevisionInputs.map((entry) => entry.slot_id),
    ...visualExecItems.map((item) => item.target.visual_asset_id),
  ];
  const regenerated = new Map();
  const generationRecords = [];
  for (const slotId of regenerateSlotIds) {
    const workId = `generate-${slotId}`;
    let record = workDone(journal, workId);
    if (!record) {
      const generate = requireAdapter(adapters, 'visual', 'generateStill');
      const context = slotContext(derivedPlan.plan, slotId);
      fs.mkdirSync(path.join(paths.media, 'stills'), { recursive: true });
      const produced = await generate({ runDir, plan: derivedPlan.plan, ...context, outputDir: path.join(paths.media, 'stills') });
      if (!produced?.path || !fs.existsSync(produced.path) || sha256File(produced.path) !== produced.sha256) fail('DRAFT_REVISION_STILL_OUTPUT_INVALID', slotId);
      if (!inside(runDir, fs.realpathSync(produced.path))) fail('DRAFT_REVISION_OUTPUT_OUTSIDE_RUN', produced.path);
      if (!Number.isInteger(produced.width) || !Number.isInteger(produced.height) || produced.width <= 0 || produced.height <= 0) fail('DRAFT_REVISION_STILL_OUTPUT_INVALID', `${slotId}: dimensions`);
      record = { output_path: produced.path, output_sha256: produced.sha256, width: produced.width, height: produced.height, generator_id: produced.generator_id || null };
      recordWork(paths, journal, workId, record);
    }
    regenerated.set(slotId, record);
    generationRecords.push({ slot_id: slotId, ...record });
  }
  writeImmutable(paths.registry, {
    schema: 'vidtoolz.draftRevisionGenerationRegistry.v1', run_id: runId, revision: targetVersion,
    plan_id: plan.plan_id, policy: 'one normal DRAFT_BESPOKE_STILL generation per affected slot; no artistic retry loop; motion NONE; publication_authority false; final_asset_authority false',
    generations: generationRecords,
  });
  timings.visual_ms = Date.now() - visualStarted;

  /* 4. MUSIC: reuse the exact predecessor decision+asset unless the review
   * asked for a change. */
  const musicStarted = Date.now();
  let musicDecisionFile = artifacts.music_decision.file;
  let musicAsset = { path: artifacts.music_asset.file, sha256: artifacts.music_asset.artifact.sha256, duration_ms: artifacts.music_asset.artifact.duration_ms };
  let musicDecision = predecessorMusicDecision;
  if (musicItems.length) {
    const workId = musicItems[0].work_item_id;
    let record = workDone(journal, workId);
    if (!record) {
      const generate = requireAdapter(adapters, 'music', 'generateDraftMusic');
      fs.mkdirSync(paths.media, { recursive: true });
      const produced = await generate({ runDir, workItem: musicItems[0], scope: musicItems[0].kind, outputDir: paths.media });
      if (!produced?.path || !fs.existsSync(produced.path) || sha256File(produced.path) !== produced.sha256) fail('DRAFT_REVISION_MUSIC_OUTPUT_INVALID', workId);
      if (!inside(runDir, fs.realpathSync(produced.path))) fail('DRAFT_REVISION_OUTPUT_OUTSIDE_RUN', produced.path);
      record = { output_path: produced.path, output_sha256: produced.sha256, duration_ms: produced.duration_ms, basis: produced.basis || null };
      recordWork(paths, journal, workId, record);
    }
    const entry = {
      decision_id: `draft-revision-music-${runId}-r${targetVersion}`,
      predecessor_decision_id: null,
      policy: 'FULL_PROGRAMME', status: 'ACTIVE',
      authority: { type: 'HUMAN', id: 'Mikko Pakkala' },
      decided_at: options.now || new Date().toISOString(),
      basis: `AUTONOMOUS_DRAFT_MUSIC_SELECTION under human doctrine VISUAL_DRAFT_PRODUCTION_DOCTRINE v1; regenerated because human review ${plan.review.review_id} note ${musicItems[0].review_ref.note_id} requested ${musicItems[0].kind}: ${musicItems[0].verbatim_comment.slice(0, 200)}`,
      music_sha256: record.output_sha256, music_path: record.output_path, music_duration_measured_ms: record.duration_ms,
    };
    entry.binding_digest_sha256 = renderer.musicDecisionDigest(entry);
    renderer.activeMusicDecision({ policy: entry.policy, sha256: entry.music_sha256, policy_history: [entry] });
    musicDecision = {
      schema: 'vidtoolz.visualDraftMusicDecision.v1', artifact_type: 'music-policy-decision-chain', run_id: runId,
      created_at: entry.decided_at, policy_history: [entry], active_decision: entry.decision_id, active_policy: entry.policy,
      music_asset: { path: entry.music_path, sha256: entry.music_sha256, expected_sha256: entry.music_sha256, sha_verified: true, duration_measured_ms: entry.music_duration_measured_ms },
      predecessor_source: { run_id: runId, decision_id: predecessorMusicDecision.active_decision, path: artifacts.music_decision.file, sha256: artifacts.music_decision.artifact.sha256 },
      draft_selected_music: true, final_music_authority: false, publication_authority: false,
    };
    writeImmutable(paths.music, musicDecision);
    musicDecisionFile = paths.music;
    musicAsset = { path: record.output_path, sha256: record.output_sha256, duration_ms: record.duration_ms };
  }
  timings.music_ms = Date.now() - musicStarted;

  /* 5. Derived manifest: reused assets verified by hash; regenerated swapped;
   * cut/removed excluded from successor use (bytes preserved in place). */
  const deriveStarted = Date.now();
  const cutSet = new Set(cutSlotIds);
  const manifestAssets = [];
  const reusedAssets = [];
  for (const asset of predecessorManifest.assets) {
    if (cutSet.has(asset.asset_id)) continue;
    if (regenerated.has(asset.asset_id)) {
      const record = regenerated.get(asset.asset_id);
      manifestAssets.push({
        ...asset,
        path: record.output_path, sha256: record.output_sha256, width: record.width, height: record.height,
        provenance: { ...(asset.provenance || {}), revision: { plan_id: plan.plan_id, draft_version: targetVersion, generator_id: record.generator_id, predecessor_sha256: asset.sha256 } },
      });
    } else {
      const file = path.isAbsolute(asset.path) ? asset.path : path.resolve(runDir, asset.path);
      if (!fs.existsSync(file) || sha256File(file) !== asset.sha256) fail('DRAFT_REVISION_REUSE_HASH_MISMATCH', `${asset.asset_id}: predecessor asset no longer matches its immutable hash`);
      manifestAssets.push(asset);
      reusedAssets.push(asset.asset_id);
    }
  }
  const manifest = {
    ...predecessorManifest,
    story: storyProjection,
    assets: manifestAssets,
    revision_provenance: { predecessor_manifest_sha256: artifacts.manifest.artifact.sha256, plan_id: plan.plan_id, draft_version: targetVersion },
  };
  writeImmutable(paths.manifest, manifest);
  const manifestSha = sha256File(paths.manifest);

  /* 6. Derived composition: swap/cut/retile deterministically, then the
   * narration alignment's script_beat_ids are reconciled with the FINAL beat
   * set (the composition authority requires every beat to be owned by its
   * section). The alignment file is only derived when it actually changes;
   * otherwise the predecessor's exact bytes are reused. */
  const sections = narrationSections.map((section) => ({ section_id: section.section_id, in_ms: section.in_ms, out_ms: section.out_ms }));
  const pacingSections = new Set(pacingItems.map((item) => item.target.section_id).filter(Boolean));
  const beats = deriveComposition(predecessorComposition, sections, { cutAssetIds: cutSet, pacingSections, retimeAll: narrationNeeded });
  const beatIdsBySection = new Map();
  for (const beat of beats) {
    const list = beatIdsBySection.get(beat.section_id) || [];
    list.push(beat.beat_id);
    beatIdsBySection.set(beat.section_id, list);
  }
  const alignmentSections = narrationSections.map((section) => ({ ...section, script_beat_ids: beatIdsBySection.get(section.section_id) || [] }));
  let alignment = predecessorAlignment;
  let alignmentFile = artifacts.alignment.file;
  const alignmentChanged = narrationNeeded
    || predecessorAlignment.sections.length !== alignmentSections.length
    || predecessorAlignment.sections.some((section, index) => JSON.stringify(section.script_beat_ids || []) !== JSON.stringify(alignmentSections[index].script_beat_ids));
  if (alignmentChanged) {
    const alignmentCore = {
      ...predecessorAlignment, run_id: runId, story: storyProjection,
      source_class: narration.source_class, narration_sha256: narration.sha256,
      narration_duration_measured_ms: narration.duration_ms, sections: alignmentSections,
    };
    delete alignmentCore.alignment_digest_sha256;
    alignment = { ...alignmentCore, alignment_digest_sha256: renderer.narrationAlignmentDigest(alignmentCore) };
    writeImmutable(paths.alignment, alignment);
    alignmentFile = paths.alignment;
  }
  const composition = {
    ...predecessorComposition,
    approved_visual_plan: derivedPlan.changed
      ? { path: paths.plan, file_sha256: sha256File(paths.plan), plan_id: derivedPlan.plan.plan_id, digest_sha256: derivedPlan.plan.plan_digest_sha256 }
      : predecessorComposition.approved_visual_plan,
    asset_manifest: { path: paths.manifest, sha256: manifestSha },
    expected_beat_count: beats.length,
    beats,
    forbidden_asset_ids: [...new Set([...(predecessorComposition.forbidden_asset_ids || []), ...cutSet])],
  };
  const rendererTimeline = alignment.sections.map((section) => ({ ...section, programme_in_ms: section.in_ms, programme_out_ms: section.out_ms, presenter_authority: 'NOT_APPLICABLE' }));
  compositionEngine.validateComposition(composition, rendererTimeline, { width: 1080, height: 1920, fps: 30 }, manifest);
  writeImmutable(paths.composition, composition);

  /* 7. Derived release packet: identical authority shape, updated pins. */
  const release = {
    ...predecessorRelease,
    story: { ...predecessorRelease.story, ...storyProjection },
    visual_plan: derivedPlan.changed
      ? { ...predecessorRelease.visual_plan, plan_id: derivedPlan.plan.plan_id, version: derivedPlan.plan.plan_revision, digest_sha256: derivedPlan.plan.plan_digest_sha256, file_sha256: sha256File(paths.plan), path: paths.plan }
      : predecessorRelease.visual_plan,
    narration: {
      ...predecessorRelease.narration,
      source_class: narration.source_class, path: narration.path, sha256: narration.sha256,
      alignment: { path: alignmentFile, sha256: sha256File(alignmentFile), digest: alignment.alignment_digest_sha256 },
    },
    music_policy: { ...predecessorRelease.music_policy, sha256: musicAsset.sha256, path: musicAsset.path, duration_ms: musicAsset.duration_ms },
    composition_validation: { schema: composition.schema, composition_digest_sha256: compositionEngine.digest(composition) },
    revision_provenance: { predecessor_release_sha256: artifacts.release.artifact.sha256, plan_id: plan.plan_id, draft_version: targetVersion },
    publication_authority: false, final_asset_authority: false, production_authority: false,
  };
  releaseAuthority.validateReleasePacketAuthority(release);
  writeImmutable(paths.release, release);

  /* 8. Successor intake: an explicit chain member superseding the
   * predecessor intake — the predecessor stays immutable and inspectable. */
  const scriptAuthorityPath = storyChange ? storyChange.version_file : artifacts.story.file;
  const artifactEntry = (slot, name, file, schema, extra = {}) => ({ slot, name, artifacts: [{ path: file, sha256: sha256File(file), schema, status: 'ACTIVE', ...extra }] });
  const intake = {
    schema: directed.LEGACY_INTAKE_SCHEMA, run_id: runId, created_at: options.now || new Date().toISOString(),
    predecessor: { path: path.relative(runDir, intakeRecord.path), sha256: directed.sha256FileSync(intakeRecord.path) },
    revision_plan: { path: path.relative(runDir, planner.planPathFor(runDir, targetVersion)), sha256: sha256File(planner.planPathFor(runDir, targetVersion)), plan_id: plan.plan_id },
    slots: [
      artifactEntry(1, 'story', scriptAuthorityPath, 'vidtoolz-script-builder.story-version.v1', { story: storyProjection }),
      artifactEntry(2, 'visual', planFile, 'vidtoolz.successorVisualPlan.v3'),
      artifactEntry(3, 'narration_alignment', alignmentFile, renderer.NARRATION_ALIGNMENT_SCHEMA),
      artifactEntry(4, 'composition', paths.composition, 'vidtoolz.productionAssemblyComposition.v1'),
      artifactEntry(5, 'asset_manifest', paths.manifest, 'vidtoolz.productionAssemblyAssetManifest.v1'),
      artifactEntry(6, 'visual_draft_successor_packet', paths.release, releaseAuthority.PACKET_SCHEMA),
      artifactEntry(7, 'music_decision', musicDecisionFile, 'vidtoolz.visualDraftMusicDecision.v1'),
      artifactEntry(8, 'narration_asset', narration.path, 'vidtoolz.audioAsset.v1', { class: narration.source_class, duration_ms: narration.duration_ms }),
      artifactEntry(9, 'music_asset', musicAsset.path, 'vidtoolz.audioAsset.v1', { class: 'DRAFT_MUSIC', duration_ms: musicAsset.duration_ms }),
    ],
  };
  writeImmutable(paths.intake, intake);
  recordStep(paths, journal, 'derived_artifacts', { [paths.intake]: sha256File(paths.intake), [paths.composition]: sha256File(paths.composition), [paths.manifest]: manifestSha });
  timings.derive_ms = Date.now() - deriveStarted;

  /* 9. Canonical assembly + Editor render + technical evidence. */
  const renderStarted = Date.now();
  const executed = await directed.execute(runDir, {
    ...(options.handoffOptions || {}),
    renderFromSpec: options.renderFromSpec,
    rendererOptions: options.rendererOptions || {},
  });
  if (executed.completion.state !== 'COMPLETE_REVIEWABLE_DRAFT') fail('DRAFT_REVISION_RENDER_FAILED', executed.completion.state);
  if (executed.consumed.handoff.revision !== targetVersion) {
    fail('DRAFT_REVISION_VERSION_MISMATCH', `handoff revision ${executed.consumed.handoff.revision} != planned target draft version ${targetVersion}`);
  }
  timings.render_ms = Date.now() - renderStarted;

  /* 10. Revision diff + successor record + cost metrics. */
  const diff = {
    schema: DIFF_SCHEMA, run_id: runId,
    predecessor_draft_version: plan.predecessor_draft.draft_version,
    successor_draft_version: targetVersion,
    plan_id: plan.plan_id, review_id: plan.review.review_id,
    preserved: [
      ...reusedAssets.map((assetId) => ({ kind: 'VISUAL_ASSET', id: assetId, reason: 'no change requested by the human review', review_ref: null })),
      ...(musicItems.length ? [] : [{ kind: 'MUSIC', id: predecessorMusicDecision.active_decision, reason: 'music not touched by the review', review_ref: null }]),
      ...(narrationNeeded ? [] : [{ kind: 'NARRATION', id: narration.sha256, reason: 'script unchanged; narration not touched by the review', review_ref: null }]),
      ...(scriptItems.length ? [] : [{ kind: 'SCRIPT', id: plan.bindings.story.version_id, reason: 'script not touched by the review', review_ref: null }]),
    ],
    regenerated: [
      ...generationRecords.map((record) => {
        const item = items.find((entry) => entry.target.visual_asset_id === record.slot_id) || scriptItems[0] || null;
        return { kind: 'VISUAL_ASSET', id: record.slot_id, sha256: record.output_sha256, reason: item?.verbatim_comment || 'script-change dependency cone', review_ref: item?.review_ref?.note_id ?? null };
      }),
      ...(musicItems.length ? [{ kind: 'MUSIC', id: musicDecision.active_decision, sha256: musicAsset.sha256, reason: musicItems[0].verbatim_comment, review_ref: musicItems[0].review_ref.note_id }] : []),
      ...(narrationNeeded ? [{ kind: 'NARRATION', id: narration.sha256, reason: narrationItems[0]?.verbatim_comment || 'script-change dependency cone', review_ref: narrationItems[0]?.review_ref?.note_id ?? null }] : []),
    ],
    modified: [
      ...pacingItems.map((item) => ({ kind: 'TIMELINE', id: item.target.section_id, reason: item.verbatim_comment, review_ref: item.review_ref.note_id })),
      ...(storyChange ? [{ kind: 'SCRIPT', id: storyChange.story.version_id, reason: 'human-approved Story successor adopted', review_ref: scriptItems[0]?.review_ref?.note_id ?? null }] : []),
    ],
    removed: [
      ...visualCutItems.map((item) => ({ kind: 'VISUAL_ASSET', id: item.target.visual_asset_id, reason: item.verbatim_comment, review_ref: item.review_ref.note_id, note: 'bytes preserved in predecessor evidence; excluded from successor use (forbidden_asset_ids)' })),
      ...(storyChange ? storyChange.removed_sections.map((sectionId) => ({ kind: 'SCRIPT_SECTION', id: sectionId, reason: 'removed by the approved Story successor', review_ref: scriptItems.find((item) => item.target.section_id === sectionId)?.review_ref?.note_id ?? null })) : []),
    ],
    added: [],
  };
  writeImmutable(paths.diff, diff);

  const successor = {
    schema: SUCCESSOR_SCHEMA, run_id: runId,
    predecessor: {
      draft_version: plan.predecessor_draft.draft_version,
      output_sha256: plan.predecessor_draft.output_sha256,
      review_id: plan.review.review_id,
      review_submission_digest_sha256: plan.review.submission_digest_sha256,
      intake: plan.bindings.intake,
      handoff: plan.bindings.handoff,
    },
    revision_plan: { plan_id: plan.plan_id, plan_digest_sha256: plan.plan_digest_sha256, path: path.relative(runDir, planner.planPathFor(runDir, targetVersion)) },
    story: storyProjection,
    story_changed: Boolean(storyChange),
    successor_draft: {
      draft_version: targetVersion,
      handoff_id: executed.consumed.handoff.handoff_id,
      handoff_digest_sha256: executed.consumed.handoff.handoff_digest_sha256,
      output_path: executed.completion.output_path,
      output_sha256: executed.completion.output_sha256,
      renderer_plan_digest_sha256: executed.completion.renderer_plan_digest_sha256,
      execution_attempt: executed.completion.renderer_execution_attempt,
      review_evidence_path: executed.reviewEvidencePath,
      evidence_state: executed.reviewEvidence.state,
    },
    census: {
      visual_preserved: reusedAssets.length,
      visual_regenerated: generationRecords.length,
      visual_removed: cutSet.size,
      music: musicItems.length ? 'REGENERATED' : 'REUSED',
      narration: narrationNeeded ? 'REGENERATED' : 'REUSED',
      script: storyChange ? 'STORY_SUCCESSOR_ADOPTED' : 'REUSED',
    },
    state: 'DRAFT_REVIEW_READY',
    human_review: 'NONE',
    publication_ready: false,
    final_production_locked: false,
    authority: { publication_authority: false, final_asset_authority: false, production_authority: false, completes_rough_cut_gate: false },
    created_at: options.now || new Date().toISOString(),
  };
  writeImmutable(paths.successor, successor);
  journal.state = 'COMPLETE'; saveJournal(paths, journal);

  const metrics = {
    schema: 'vidtoolz.draftRevisionCostMetrics.v1', run_id: runId, plan_id: plan.plan_id,
    script_resolution_ms: timings.script_ms, narration_ms: timings.narration_ms,
    visual_ms: timings.visual_ms, music_ms: timings.music_ms,
    derive_artifacts_ms: timings.derive_ms, assemble_render_ms: timings.render_ms,
    total_wall_clock_ms: Date.now() - startedAt,
    census: successor.census,
    economics_note: `preserved ${reusedAssets.length} visual assets, regenerated ${generationRecords.length}, removed ${cutSet.size}; music ${successor.census.music}; narration ${successor.census.narration}`,
  };
  atomicJson(paths.metrics, metrics);
  return { state: 'REVISION_COMPLETE', successor, successor_path: paths.successor, diff, diff_path: paths.diff, metrics, journal_path: paths.journal, executed };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..') };
  if (!['plan', 'execute', 'status'].includes(out.command)) fail('DRAFT_REVISION_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else fail('DRAFT_REVISION_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('DRAFT_REVISION_ARGUMENT_INVALID', `${out.command} requires --run-id`);
  return out;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const runDir = directed.resolveRunDir(args.repo, args.runId);
    if (args.command === 'plan') return planner.main(['plan', '--run-id', args.runId, '--repo', args.repo]);
    if (args.command === 'status') { process.stdout.write(`${JSON.stringify(planner.revisionStatus(runDir), null, 2)}\n`); return 0; }
    const result = await executeRevisionPlan(runDir);
    process.stdout.write(`${JSON.stringify({ state: result.state, plan_id: result.successor?.revision_plan?.plan_id || result.plan_id || null, census: result.successor?.census || null, output: result.successor?.successor_draft?.output_path || null, blocking: result.blocking || null }, null, 2)}\n`);
    return ['REVISION_COMPLETE', 'ALREADY_COMPLETE', 'NO_REVISION_REQUIRED'].includes(result.state) ? 0 : 3;
  } catch (error) {
    process.stderr.write(`${error.code || 'DRAFT_REVISION_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = {
  SUCCESSOR_SCHEMA, DIFF_SCHEMA, JOURNAL_SCHEMA,
  DraftRevisionExecutionError, revisionPaths, sha256File,
  intakeArtifacts, resolveStoryForScriptWork, slotContext, deriveVisualPlan,
  retileSection, deriveComposition, executeRevisionPlan, parseArgs, main,
};

if (require.main === module) main().then((code) => { process.exitCode = code; });
