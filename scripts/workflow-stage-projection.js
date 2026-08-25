'use strict';

/*
 * WORKFLOW STAGE PROJECTION — the 14 gates are the only lifecycle authority.
 *
 * The system carries two production vocabularies:
 *
 *   canonical : the 14 gates in scripts/package-run-workflow-map.js
 *               (GATE_DEFINITIONS). Derived from run artifacts and their
 *               status markers. This is the ONLY lifecycle authority.
 *   display   : the pipeline tracker's stage strips in pipeline-tracker.js —
 *               13 stages for the horizontal path, 8 for vertical. Operator
 *               presentation only.
 *
 * Historically each side derived lifecycle position INDEPENDENTLY: the gates
 * from status markers ("Script review status: PASS"), the tracker from bare
 * file existence. So a run whose artifacts were drafted but not reviewed showed
 * canonical gate 2/14 "Research sufficiency" while the tracker displayed stage
 * 6/12 "Image Gen" — both presented as truth. That is the split-brain this
 * module removes.
 *
 * The rule is one-way and absolute:
 *
 *     canonical gate  ->  projection  ->  displayed stage
 *
 * A tracker stage can never advance, prove, or imply lifecycle progress. The
 * canonical gate sets a CEILING; richer file evidence may still be surfaced
 * below it, but anything beyond the ceiling is labelled evidence-only and is
 * never counted as progress.
 */

const workflowMap = require('./package-run-workflow-map.js');

const MAPPING_VERSION = 'workflow-stage-projection-v1';
const DRIFT_CODE = 'RUN_STATE_PROJECTION_DRIFT';

// Display strips, mirrored from pipeline-tracker.js. The tracker owns the
// labels; this module owns which gate each stage belongs under.
const HORIZONTAL_STAGES = Object.freeze([
  'idea', 'research', 'script', 'claims', 'packaging', 'image-prompts',
  'image-gen', 'image-select', 'video-gen', 'a-roll', 'assembly',
  'publish-gate', 'published',
]);
const VERTICAL_STAGES = Object.freeze([
  'idea', 'script', 'image-prompts', 'image-gen', 'image-select',
  'i2v-prompts', 'video-gen', 'view',
]);

/*
 * The mapping is TOTAL in both directions:
 *   - all 14 canonical gates have a default display stage per path
 *   - every display stage is owned by exactly one canonical gate per path
 *
 * `compatible` lists the stages that may legitimately show while the run sits
 * at that gate — this is what allows finer display granularity inside one gate
 * without letting the strip imply the run has moved on.
 */
const GATE_PROJECTION = Object.freeze({
  'package-selection':      { horizontal: { default: 'idea',          compatible: ['idea'] },
                              vertical:   { default: 'idea',          compatible: ['idea'] } },
  research:                 { horizontal: { default: 'research',      compatible: ['research'] },
                              vertical:   { default: 'idea',          compatible: [] } },
  'script-structure':       { horizontal: { default: 'script',        compatible: ['script'] },
                              vertical:   { default: 'script',        compatible: ['script'] } },
  'script-review':          { horizontal: { default: 'claims',        compatible: ['claims'] },
                              vertical:   { default: 'script',        compatible: [] } },
  'production-plan':        { horizontal: { default: 'packaging',     compatible: ['packaging'] },
                              vertical:   { default: 'image-prompts', compatible: [] } },
  'shot-edit-plan-review':  { horizontal: { default: 'image-prompts', compatible: ['image-prompts'] },
                              vertical:   { default: 'image-prompts', compatible: ['image-prompts'] } },
  'capture-checklist':      { horizontal: { default: 'image-gen',     compatible: ['image-gen', 'image-select'] },
                              vertical:   { default: 'image-gen',     compatible: ['image-gen', 'image-select'] } },
  'capture-evidence':       { horizontal: { default: 'video-gen',     compatible: ['video-gen', 'a-roll'] },
                              vertical:   { default: 'i2v-prompts',   compatible: ['i2v-prompts', 'video-gen'] } },
  'rough-cut-review':       { horizontal: { default: 'assembly',      compatible: ['assembly'] },
                              vertical:   { default: 'video-gen',     compatible: [] } },
  'final-review':           { horizontal: { default: 'assembly',      compatible: [] },
                              vertical:   { default: 'view',          compatible: ['view'] } },
  'export-check':           { horizontal: { default: 'publish-gate',  compatible: ['publish-gate'] },
                              vertical:   { default: 'view',          compatible: [] } },
  'publication-metadata':   { horizontal: { default: 'publish-gate',  compatible: [] },
                              vertical:   { default: 'view',          compatible: [] } },
  archive:                  { horizontal: { default: 'published',     compatible: ['published'] },
                              vertical:   { default: 'view',          compatible: [] } },
  repurposing:              { horizontal: { default: 'published',     compatible: [] },
                              vertical:   { default: 'view',          compatible: [] } },
});

function canonicalGateIds() {
  return workflowMap.GATE_DEFINITIONS.map((gate) => gate.id);
}

function stagesForPath(workflowPath) {
  return String(workflowPath || '') === 'vertical' ? VERTICAL_STAGES : HORIZONTAL_STAGES;
}

/**
 * Deterministic mapping validator. Runs in tests and can be called at startup.
 * Refuses an incomplete or ambiguous mapping rather than projecting a guess.
 */
function validateMapping() {
  const errors = [];
  const gates = canonicalGateIds();

  for (const gateId of gates) {
    if (!GATE_PROJECTION[gateId]) { errors.push(`canonical gate "${gateId}" has no projection`); continue; }
    for (const pathKey of ['horizontal', 'vertical']) {
      const entry = GATE_PROJECTION[gateId][pathKey];
      const strip = stagesForPath(pathKey);
      if (!entry) { errors.push(`gate "${gateId}" has no ${pathKey} projection`); continue; }
      if (!strip.includes(entry.default)) {
        errors.push(`gate "${gateId}" ${pathKey} default "${entry.default}" is not a known stage`);
      }
      for (const stage of entry.compatible) {
        if (!strip.includes(stage)) errors.push(`gate "${gateId}" ${pathKey} compatible stage "${stage}" is unknown`);
      }
    }
  }
  for (const mapped of Object.keys(GATE_PROJECTION)) {
    if (!gates.includes(mapped)) errors.push(`projection references unknown gate "${mapped}"`);
  }

  // Every display stage must be owned by exactly one gate, per path.
  for (const pathKey of ['horizontal', 'vertical']) {
    const owners = new Map();
    for (const gateId of gates) {
      for (const stage of GATE_PROJECTION[gateId]?.[pathKey]?.compatible || []) {
        if (owners.has(stage)) errors.push(`${pathKey} stage "${stage}" is claimed by both "${owners.get(stage)}" and "${gateId}"`);
        else owners.set(stage, gateId);
      }
    }
    for (const stage of stagesForPath(pathKey)) {
      if (!owners.has(stage)) errors.push(`${pathKey} stage "${stage}" is an orphan — no canonical gate owns it`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    mapping_version: MAPPING_VERSION,
    canonical_gates: gates.length,
    horizontal_stages: HORIZONTAL_STAGES.length,
    vertical_stages: VERTICAL_STAGES.length,
  };
}

/** The canonical gate a run currently sits at, derived from the gate map. */
function currentCanonicalGate(gates = []) {
  const current = gates.find((gate) => gate.status === 'current');
  if (current) return current;
  const incomplete = gates.find((gate) => gate.status !== 'complete');
  if (incomplete) return incomplete;
  return gates.length ? gates[gates.length - 1] : null;
}

/**
 * Project canonical gate state onto a display strip.
 * Returns the authoritative ceiling: the furthest stage index the run may show.
 */
function projectGate(gateId, workflowPath) {
  const pathKey = String(workflowPath || '') === 'vertical' ? 'vertical' : 'horizontal';
  const strip = stagesForPath(pathKey);
  const entry = GATE_PROJECTION[gateId]?.[pathKey];
  if (!entry) {
    return { ok: false, gate: gateId, path: pathKey, stageKey: null, stageIndex: null,
      reason: `no projection for canonical gate "${gateId}"` };
  }
  return {
    ok: true,
    gate: gateId,
    path: pathKey,
    stageKey: entry.default,
    stageIndex: strip.indexOf(entry.default),
    compatibleStages: [...entry.compatible],
    mapping_version: MAPPING_VERSION,
  };
}

/**
 * Clamp a display projection to canonical authority.
 *
 * `evidenceStages` are the tracker's own file-evidence flags. They are kept for
 * operator context but may never push the displayed position past the canonical
 * ceiling; anything beyond it is relabelled evidence-only.
 */
function clampToCanonical(evidenceStages, evidenceCurrentStage, projection) {
  if (!projection.ok) {
    return { currentStage: 0, stages: evidenceStages, clamped: false, reason: projection.reason };
  }
  const ceiling = projection.stageIndex;
  const clamped = Number.isInteger(evidenceCurrentStage) && evidenceCurrentStage > ceiling;
  const stages = (evidenceStages || []).map((stage) => {
    if (stage.id <= ceiling) return { ...stage, active: stage.id === ceiling, evidenceOnly: false };
    // Beyond the canonical ceiling: keep the evidence, deny it progress meaning.
    return {
      ...stage,
      completed: false,
      active: false,
      evidenceOnly: Boolean(stage.completed),
      note: stage.completed
        ? 'artifact evidence exists, but the canonical gate has not reached this stage'
        : stage.note || '',
    };
  });
  return {
    currentStage: ceiling,
    stages,
    clamped,
    evidenceCurrentStage: evidenceCurrentStage ?? null,
    reason: clamped
      ? `file evidence suggested stage ${evidenceCurrentStage}, but canonical gate "${projection.gate}" caps display at stage ${ceiling}`
      : null,
  };
}

/**
 * Structured drift defect. Uses the operations-state defect shape rather than
 * inventing a second vocabulary.
 */
function detectDrift({ runId, gateId, workflowPath, evidenceCurrentStage }) {
  const projection = projectGate(gateId, workflowPath);
  if (!projection.ok) {
    return { code: DRIFT_CODE, severity: 'BLOCKER', run_id: runId, canonical_gate: gateId,
      detail: projection.reason, mapping_version: MAPPING_VERSION };
  }
  const strip = stagesForPath(projection.path);
  const observed = Number.isInteger(evidenceCurrentStage) ? evidenceCurrentStage : null;
  if (observed === null || observed === projection.stageIndex) return null;
  const ahead = observed > projection.stageIndex;
  return {
    code: DRIFT_CODE,
    // A projection claiming lifecycle progress the canonical gate has not
    // reached is the dangerous direction: it can imply a run is further along
    // than production authority allows.
    severity: ahead ? 'BLOCKER' : 'WARNING',
    run_id: runId,
    canonical_gate: gateId,
    canonical_stage: projection.stageKey,
    canonical_stage_index: projection.stageIndex,
    observed_stage: strip[observed] ?? null,
    observed_stage_index: observed,
    expected_stages: [projection.stageKey, ...projection.compatibleStages],
    direction: ahead ? 'PROJECTION_AHEAD_OF_CANONICAL' : 'PROJECTION_BEHIND_CANONICAL',
    resolution: 'canonical 14-gate state wins; reproject the display from it',
    mapping_version: MAPPING_VERSION,
  };
}

/**
 * Full projection for one run, derived from the canonical gate map.
 * Read-only: builds the workflow map and returns a display view.
 */
function projectRun(runDirInput, options = {}) {
  const map = workflowMap.buildWorkflowMap(runDirInput, options);
  const gate = currentCanonicalGate(map.gates || []);
  const workflowPath = options.workflowPath || map.workflowPath || 'horizontal';
  const projection = projectGate(gate ? gate.id : null, workflowPath);
  return {
    schema: 'vidtoolz.workflowStageProjection.v1',
    mapping_version: MAPPING_VERSION,
    runId: map.runId,
    canonical: {
      gate: gate ? gate.id : null,
      label: gate ? gate.label : null,
      status: gate ? gate.status : null,
      completeGates: (map.gates || []).filter((g) => g.status === 'complete').map((g) => g.id),
      totalGates: (map.gates || []).length,
    },
    projection,
    authority: 'CANONICAL_14_GATE',
    projection_is_authoritative: false,
  };
}

module.exports = {
  MAPPING_VERSION, DRIFT_CODE, HORIZONTAL_STAGES, VERTICAL_STAGES, GATE_PROJECTION,
  canonicalGateIds, stagesForPath, validateMapping, currentCanonicalGate,
  projectGate, clampToCanonical, detectDrift, projectRun,
};
