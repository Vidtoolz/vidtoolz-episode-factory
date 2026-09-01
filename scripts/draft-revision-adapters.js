'use strict';

/*
 * Live domain adapters for Draft revision execution.
 *
 * The revision executor never generates media itself: it asks a domain adapter
 * and then verifies the result (bytes exist, hash matches, output lands inside
 * the run, dimensions are real). This module wires those adapter slots to the
 * EXISTING canonical authorities — it adds no generation policy of its own and
 * introduces no second generator.
 *
 * WIRED (canonical authority is directly callable with revision inputs):
 *
 *   visual.generateStill  → draft-bespoke-still-policy.generationTaskForSlot +
 *                           generation-supervisor.run. One normal attempt and
 *                           one technical retry are the policy's own bounds;
 *                           this adapter adds none.
 *   music.generateDraftMusic → the Stable-Audio-first Draft music department
 *                           (draft-music-orchestrator.generateDraftMusic) with
 *                           the successor script text passed explicitly, so it
 *                           never depends on the run's Story binding.
 *
 * NOT WIRED — open doctrine question, deliberately not answered here:
 *
 *   narration.generateNarration
 *     package-run-draft-narration resolves the Story from the RUN'S BINDING
 *     (storyBinding.resolveBoundStory), by design: synthetic Draft narration
 *     is bound to exactly one approved Story. A revision that adopts a Story
 *     successor inside the SAME run therefore needs a human doctrine decision:
 *       (a) the run rebinds to the successor Story version — which changes
 *           durable run state and must define what preserves the predecessor
 *           Draft's own binding provenance; or
 *       (b) the narration authority gains an explicit story-override input.
 *     Both are policy, not plumbing. Until Mikko decides, script-driven
 *     revisions fail closed with this exact question rather than a guess.
 *
 *   visual.reviseSlot (new concept + prompt for one slot)
 *     Visual Planning is out of scope for this mission (§43) and its director
 *     authors WHOLE plans, not single-slot revisions. Whatever authors a
 *     replacement concept, the executor validates its output through the
 *     canonical visual-plan, successor-plan and bespoke-policy authorities,
 *     so an unproven authoring path can never produce an invalid successor.
 */

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const bespoke = require('./draft-bespoke-still-policy.js');

const WIRED = Object.freeze(['visual.generateStill', 'music.generateDraftMusic']);
const UNWIRED = Object.freeze({
  'narration.generateNarration': 'BLOCKED_ON_DOCTRINE: synthetic Draft narration binds one approved Story via the run binding; a same-run Story successor needs Mikko to choose run-rebinding vs an explicit story-override input',
  'visual.reviseSlot': 'BLOCKED_ON_AUTHORING_PATH: single-slot concept authoring has no canonical authority yet (Visual Planning authors whole plans and is out of scope for this mission)',
});

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/*
 * The bounded still adapter. `deps` exists so the wiring contract is testable
 * without a GPU: the default is the canonical Generation Supervisor.
 */
function visualStillAdapter(deps = {}) {
  const supervisor = deps.supervisor || require('./generation-supervisor.js');
  return async function generateStill({ runDir, plan, slot, outputDir }) {
    const base = {
      task_id: `draft-revision-still:${plan.plan_id}:${slot.slot_id}`,
      project_id: plan.story.project_id,
      package_run_id: path.basename(runDir),
      run_dir: runDir,
    };
    const task = bespoke.generationTaskForSlot(base, plan, slot);
    bespoke.validateGenerationTask(task);
    const result = await supervisor.run(task, deps.supervisorOptions || {});
    if (result?.state !== 'COMPLETE') {
      const error = new Error(`${slot.slot_id}: ${result?.reason || result?.state || 'generation did not complete'}`);
      error.code = 'DRAFT_REVISION_STILL_GENERATION_FAILED';
      throw error;
    }
    const output = result.outputs?.[0];
    if (!output?.path) {
      const error = new Error(`${slot.slot_id}: supervisor reported no output`);
      error.code = 'DRAFT_REVISION_STILL_GENERATION_FAILED';
      throw error;
    }
    const inspected = deps.inspectImage ? deps.inspectImage(output.path) : bespoke.inspectImage(output.path);
    return {
      path: output.path,
      sha256: output.sha256 || sha256File(output.path),
      width: inspected.width,
      height: inspected.height,
      generator_id: result.generator_id || output.generator_id || null,
      outputDirDeclared: outputDir,
    };
  };
}

/*
 * The Draft music adapter. The music department owns its own bounded
 * generation, coherence gate and human-calibrated ranking; this adapter only
 * hands it the successor script and returns the selected bed.
 */
function musicAdapter(deps = {}) {
  const orchestrator = deps.orchestrator || require('./draft-music-orchestrator.js');
  return async function generateDraftMusic({ runDir, scriptText, narrationWav, outputDir }) {
    if (typeof scriptText !== 'string' || !scriptText.trim()) {
      const error = new Error('the Draft music department requires the successor script text');
      error.code = 'DRAFT_REVISION_MUSIC_SCRIPT_REQUIRED';
      throw error;
    }
    const result = await orchestrator.generateDraftMusic({
      scriptText, outRoot: outputDir, runId: path.basename(runDir), narrationWav: narrationWav || null,
    }, deps.musicOptions || {});
    if (result.state !== 'COMPLETE' || !result.package?.draft_selected_music) {
      const error = new Error(`Draft music produced no usable selection (${result.state})`);
      error.code = 'DRAFT_REVISION_MUSIC_NO_USABLE_SELECTION';
      throw error;
    }
    const selected = result.package.draft_selected_music;
    return {
      path: selected.output_path,
      sha256: selected.output_sha256,
      duration_ms: Math.round((result.package.candidates.find((item) => item.candidate_id === selected.candidate_id)?.qc?.duration_s || 0) * 1000),
      basis: `${result.package.routing_policy} / ${result.package.selection_mode}`,
    };
  };
}

function unwired(slot) {
  return async function refuse() {
    const error = new Error(UNWIRED[slot]);
    error.code = 'DRAFT_REVISION_ADAPTER_NOT_WIRED';
    throw error;
  };
}

/*
 * The adapter set the canonical CLI passes to the executor. Unwired slots are
 * present and refuse with their exact open question — never absent (which
 * would read as an accidental omission) and never faked.
 */
function liveAdapters(deps = {}) {
  return {
    visual: {
      generateStill: visualStillAdapter(deps),
      reviseSlot: deps.reviseSlot || unwired('visual.reviseSlot'),
    },
    music: { generateDraftMusic: musicAdapter(deps) },
    narration: { generateNarration: deps.generateNarration || unwired('narration.generateNarration') },
  };
}

function wiringReport() {
  return {
    schema: 'vidtoolz.draftRevisionAdapterWiring.v1',
    wired: WIRED,
    unwired: UNWIRED,
    live_proven: false,
    live_proven_note: 'no real Draft revision has executed; the wiring is contract-tested against injected authority stubs only',
  };
}

module.exports = { WIRED, UNWIRED, visualStillAdapter, musicAdapter, unwired, liveAdapters, wiringReport, sha256File };
