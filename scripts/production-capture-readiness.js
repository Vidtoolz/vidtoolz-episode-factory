'use strict';

/*
 * production-capture-readiness.js
 *
 * Machine-preparation readiness for a PRODUCTION presenter capture session.
 *
 * The supervised-capture lane has three phases:
 *
 *   1. MACHINE PREPARATION   — everything the system owns before Mikko records
 *   2. HUMAN PERFORMANCE     — Mikko physically performs; no agent may do this
 *   3. MACHINE POST-CAPTURE  — validation, manifesting, handoff, QC
 *
 * This module answers exactly one question: has phase 1 been completed?
 *
 *   READY_FOR_HUMAN_PERFORMANCE
 *     means: every machine-owned prerequisite is green AND the human
 *     recording still does not exist. It is NOT capture complete, NOT a
 *     take, and NOT an approval. The moment real media is registered the
 *     state is no longer READY_FOR_HUMAN_PERFORMANCE.
 *
 * Invariants enforced here:
 *
 *   HUMAN_REQUEST_ONLY_AFTER_MACHINE_GREEN
 *     The human performance is requested only after every machine-owned
 *     prerequisite is green. A readiness report with any unmet prerequisite
 *     is NOT_READY and names each machine blocker.
 *
 *   NO_PROXY_SUBSTITUTE
 *     Draft proxy presenter and synthetic narration evidence can never
 *     satisfy a PRODUCTION prerequisite. They are historical DRAFT evidence.
 *
 * Deliberate non-goals: this module does not touch Presenter Director
 * (disabled until Mikko authorizes enablement), does not write lifecycle
 * state, and does not create media. It reads canonical run artifacts only.
 */

const fs = require('node:fs');
const path = require('node:path');

const READINESS_SCHEMA = 'vidtoolz.productionCaptureReadiness.v1';

const STATE_READY = 'READY_FOR_HUMAN_PERFORMANCE';
const STATE_NOT_READY = 'NOT_READY_FOR_HUMAN_PERFORMANCE';
const STATE_MODE_BLOCKED = 'MODE_BLOCKED';

const PREREQUISITE_IDS = Object.freeze([
  'PRODUCTION_MODE_DECLARED',
  'STORY_BINDING_PRESENT',
  'STORY_VALIDATION_PASS',
  'STORY_IDENTITY_CONSISTENT',
  'DELIVERY_SCRIPT_BOUND',
  'PRESENTER_TAKE_MANIFEST_INITIALIZED',
  'CAPTURE_ARTIFACTS_GENERATED',
]);

/*
 * source_artifact is an identity field, not prose.  CAP-1 was caused by adding
 * an annotation to that string ("final-script.md (...)") and then using the
 * annotated value as a path.  Keep annotations in source_artifact_annotation;
 * never trim, parse, or guess a filename out of an identity value.
 */
function resolveDeliveryScript(binding, runDir) {
  const provenance = binding?.provenance || {};
  const artifact = provenance.source_artifact;
  if (typeof artifact !== 'string' || artifact.length === 0) {
    return { ok: false, code: 'DELIVERY_SCRIPT_ARTIFACT_ID_MISSING', detail: 'story binding provenance.source_artifact is required' };
  }
  if (artifact !== path.basename(artifact) || artifact === '.' || artifact === '..' || !/^[A-Za-z0-9._-]+$/.test(artifact)) {
    return { ok: false, code: 'DELIVERY_SCRIPT_ARTIFACT_ID_INVALID', detail: 'source_artifact must be one exact run-local filename; annotations belong in source_artifact_annotation' };
  }
  const file = path.join(path.resolve(runDir), artifact);
  return {
    ok: true,
    artifact,
    file,
    annotation: typeof provenance.source_artifact_annotation === 'string'
      ? provenance.source_artifact_annotation : null,
    expected_sha256: provenance.source_artifact_sha256 || null,
  };
}

function sha256File(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function check(id, ok, detail) {
  return Object.freeze({ prerequisite_id: id, ok: Boolean(ok), detail: String(detail || '') });
}

/*
 * Evaluate the machine-preparation prerequisites for one package run.
 * Read-only: every input is a canonical run artifact; nothing is written.
 */
function evaluateReadiness(runDir, options = {}) {
  const dir = path.resolve(runDir);
  const checks = [];

  // 1. Mode: readiness only has meaning for a declared PRODUCTION run.
  const modeModule = require('./package-run-production-mode.js');
  let mode;
  try {
    mode = modeModule.readProductionMode(dir);
  } catch (error) {
    return finish(dir, STATE_MODE_BLOCKED, [], `production mode unreadable: ${error.code || error.message}`);
  }
  if (mode.mode !== modeModule.PRODUCTION) {
    return finish(dir, STATE_MODE_BLOCKED, [
      check('PRODUCTION_MODE_DECLARED', mode.declared, `mode is ${mode.mode}`),
    ], `capture readiness applies only to PRODUCTION runs; this run is ${mode.mode}`);
  }
  checks.push(check('PRODUCTION_MODE_DECLARED', true, `set by ${mode.record.set_by}`));

  // 2-4. Story binding + validation + identity consistency.
  const bindingFile = path.join(dir, 'story-binding.json');
  const validationFile = path.join(dir, 'story-validation.json');
  let binding = null;
  if (!fs.existsSync(bindingFile)) {
    checks.push(check('STORY_BINDING_PRESENT', false, 'story-binding.json missing'));
  } else {
    try {
      binding = readJson(bindingFile);
      checks.push(check('STORY_BINDING_PRESENT', Boolean(binding.story?.content_hash), 'canonical story version bound'));
    } catch (error) {
      checks.push(check('STORY_BINDING_PRESENT', false, `story-binding.json unreadable: ${error.message}`));
    }
  }

  let validation = null;
  if (!fs.existsSync(validationFile)) {
    checks.push(check('STORY_VALIDATION_PASS', false, 'story-validation.json missing'));
    checks.push(check('STORY_IDENTITY_CONSISTENT', false, 'no story validation to compare'));
  } else {
    try {
      validation = readJson(validationFile);
      checks.push(check('STORY_VALIDATION_PASS', validation.verdict === 'PASS', `verdict ${validation.verdict || 'MISSING'}`));
      const sameStory = Boolean(binding?.story && validation.story
        && binding.story.project_id === validation.story.project_id
        && binding.story.version_id === validation.story.version_id
        && binding.story.content_hash === validation.story.content_hash);
      checks.push(check('STORY_IDENTITY_CONSISTENT', sameStory,
        sameStory ? 'binding and validation reference the same story version' : 'binding and validation disagree on story identity'));
    } catch (error) {
      checks.push(check('STORY_VALIDATION_PASS', false, `story-validation.json unreadable: ${error.message}`));
      checks.push(check('STORY_IDENTITY_CONSISTENT', false, 'validation unreadable'));
    }
  }

  // 5. Delivery script: the exact file Mikko performs, bound by hash.
  const delivery = resolveDeliveryScript(binding, dir);
  if (!delivery.ok) {
    checks.push(check('DELIVERY_SCRIPT_BOUND', false, `${delivery.code}: ${delivery.detail}`));
  } else if (!fs.existsSync(delivery.file)) {
    checks.push(check('DELIVERY_SCRIPT_BOUND', false, `delivery script ${delivery.artifact} missing from run`));
  } else {
    const actualHash = sha256File(delivery.file);
    const bound = delivery.expected_sha256 ? actualHash === delivery.expected_sha256 : false;
    checks.push(check('DELIVERY_SCRIPT_BOUND', bound,
      bound ? `${delivery.artifact} present, sha256 matches story-binding provenance` : delivery.expected_sha256
        ? 'sha256 mismatch: delivery script changed after binding'
        : 'story binding provenance.source_artifact_sha256 is required; delivery identity cannot be guessed'));
  }

  // 6. Presenter take manifest initialized — the ingestion contract exists
  //    before recording starts. Its recording_units define what Mikko performs.
  const manifestFiles = ['presenter-take-manifest.json', 'presenter-take-manifest'];
  const manifestFile = manifestFiles.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file)) || null;
  if (!manifestFile) {
    checks.push(check('PRESENTER_TAKE_MANIFEST_INITIALIZED', false,
      'presenter take manifest not initialized — recording units must exist before the session'));
  } else {
    try {
      const manifest = readJson(manifestFile);
      const units = Array.isArray(manifest.recording_units) ? manifest.recording_units.length : 0;
      const hasTakes = Array.isArray(manifest.takes) && manifest.takes.length > 0;
      // A manifest that already holds takes is past the readiness boundary:
      // READY_FOR_HUMAN_PERFORMANCE means the performance still has not happened.
      checks.push(check('PRESENTER_TAKE_MANIFEST_INITIALIZED', units > 0 && !hasTakes,
        hasTakes ? 'manifest already contains takes — performance happened; state is no longer readiness' : `${units} recording units defined, no takes yet`));
    } catch (error) {
      checks.push(check('PRESENTER_TAKE_MANIFEST_INITIALIZED', false, `manifest unreadable: ${error.message}`));
    }
  }

  // 7. Capture artifacts: the five gate-7 PRODUCTION files. Deterministically
  //    generated by package-run-capture-checklist.js — machine-owned, no PD.
  const captureArtifacts = ['capture-checklist.md', 'takes-log.md', 'missing-shot-tracker.md', 'screen-recording-checklist.md', 'audio-capture-checklist.md'];
  const missingArtifacts = captureArtifacts.filter((name) => !fs.existsSync(path.join(dir, name)));
  checks.push(check('CAPTURE_ARTIFACTS_GENERATED', missingArtifacts.length === 0,
    missingArtifacts.length === 0 ? 'all five capture artifacts exist' : `missing: ${missingArtifacts.join(', ')}`));

  const failed = checks.filter((entry) => !entry.ok);
  const state = failed.length === 0 ? STATE_READY : STATE_NOT_READY;
  return finish(dir, state, checks,
    failed.length === 0
      ? 'all machine-owned capture prerequisites are green; human performance is still absent'
      : `machine preparation incomplete: ${failed.map((entry) => entry.prerequisite_id).join(', ')}`);
}

function finish(runDir, state, checks, reason) {
  const unmet = checks.filter((entry) => !entry.ok).map((entry) => entry.prerequisite_id);
  const ready = state === STATE_READY;
  return Object.freeze({
    schema: READINESS_SCHEMA,
    run_id: path.basename(runDir),
    state,
    checks: Object.freeze(checks),
    unmet_prerequisites: Object.freeze(unmet),
    human_performance_recorded: false,
    capture_complete: false,
    // The boundary itself: who acts next, and only after machine readiness.
    next_authority: ready ? 'mikko' : 'production_operations',
    next_action: ready
      ? 'record the real presenter performance (machine preparation is complete)'
      : `complete machine preparation: ${unmet.join(', ') || 'unknown blocker'}`,
    human_requested_before_machine_ready: ready ? false : unmet.length > 0,
    reason,
  });
}

module.exports = {
  READINESS_SCHEMA,
  STATE_READY,
  STATE_NOT_READY,
  STATE_MODE_BLOCKED,
  PREREQUISITE_IDS,
  resolveDeliveryScript,
  evaluateReadiness,
};
