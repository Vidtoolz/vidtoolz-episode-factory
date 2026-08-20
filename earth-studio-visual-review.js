'use strict';

// Pure review-session model. Browser control lives in the existing CDP import
// harness; this module owns only authoritative project order, state labels and
// safe selection logic.
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_ORDER = [
  'A-local-landmark-to-landmark-16x9',
  'B-city-to-city-helsinki-stockholm-16x9',
  'D-long-distance-helsinki-new-york-orbit-16x9',
  'E-multi-destination-helsinki-stockholm-copenhagen-16x9',
  'F1-continuation-source-helsinki-stockholm-16x9',
  'F2-continuation-target-stockholm-copenhagen-16x9',
  'C-region-to-city-finland-helsinki-16x9',
];

const STATES = Object.freeze({
  NOT_PREPARED: 'NOT_PREPARED',
  IMPORTING: 'IMPORTING',
  IMPORT_FAILED: 'IMPORT_FAILED',
  READY_TO_PLAY: 'READY_TO_PLAY',
  HUMAN_PASS: 'HUMAN_PASS',
  HUMAN_FAIL: 'HUMAN_FAIL',
});

function loadManifest(root) {
  const dir = path.join(root, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2');
  const file = path.join(dir, 'generation-manifest.json');
  if (!fs.existsSync(file)) throw new Error('ARTIFACT_MISSING — generation-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map((manifest.records || []).map((record) => [record.id, record]));
  const records = REVIEW_ORDER.map((id) => {
    const record = byId.get(id);
    if (!record) throw new Error(`ARTIFACT_MISSING — authoritative project ${id}`);
    const esp = path.join(root, record.esp);
    const plan = path.join(root, path.dirname(record.esp), 'shot-plan.json');
    if (!fs.existsSync(esp)) throw new Error(`ARTIFACT_MISSING — ${record.esp}`);
    if (!fs.existsSync(plan)) throw new Error(`ARTIFACT_MISSING — ${path.relative(root, plan)}`);
    return { ...record, esp_absolute: esp, plan_absolute: plan, state: STATES.NOT_PREPARED };
  });
  return { directory: dir, generated_at: manifest.generated_at, records };
}

function indexOf(records, id) {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error(`UNKNOWN_PROJECT — ${id}`);
  return index;
}

function adjacent(records, currentId, delta) {
  const next = indexOf(records, currentId) + delta;
  return records[next] || null;
}

function transition(record, state, evidence = {}) {
  if (!Object.values(STATES).includes(state)) throw new Error(`UNKNOWN_REVIEW_STATE — ${state}`);
  return { ...record, state, evidence: { ...(record.evidence || {}), ...evidence } };
}

function freshSession(manifest) {
  return {
    schema_version: 1,
    review_order: REVIEW_ORDER,
    current_id: manifest.records[0].id,
    records: Object.fromEntries(manifest.records.map((record) => [record.id, {
      state: STATES.NOT_PREPARED,
      human_decision: null,
      notes: '',
      evidence: null,
    }])),
  };
}

module.exports = { REVIEW_ORDER, STATES, loadManifest, indexOf, adjacent, transition, freshSession };
