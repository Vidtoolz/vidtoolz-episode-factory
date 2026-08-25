'use strict';

/*
 * HUMAN_AUTHORED gate-6 planning provenance.
 *
 * Hardening gate 6 against stale approval bound every approval to a
 * visual-plan digest, which correctly killed the old bare-marker path but also
 * removed a legitimate capability: a planning package Mikko wrote himself has no
 * plan to bind to, so it could no longer be approved at all.
 *
 * The security rule was never "planning must come from an agent". It is that
 * Mikko's approval must bind to exactly what Mikko reviewed. So:
 *
 *   AGENT_GENERATED  approval binds to the visual-plan digest
 *                    (declared by visual-plan-materialization.json)
 *   HUMAN_AUTHORED   approval binds to a deterministic snapshot digest over the
 *                    five reviewed planning artifacts (declared by this module)
 *
 * A bare marker is never sufficient in either mode.
 *
 * Deliberate boundaries:
 *  - the snapshot digests the MACHINE-OWNED body of each artifact only, so the
 *    sanctioned human-notes region stays editable after approval exactly as it
 *    is on the agent path;
 *  - creating a snapshot is NOT approval. It records what is currently awaiting
 *    review. Only Mikko's marker completes the gate;
 *  - the marker binding uses its own field name ("Approved planning snapshot"),
 *    so an agent-path digest can never be reused to satisfy the human path, or
 *    the reverse;
 *  - mode is always explicitly declared. It is never inferred from the mere
 *    absence of a visual plan.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The five governed artifacts, the machine/human text split, and the approval
// marker surface all come from the materializer: one definition, not two.
const materializer = require('./visual-plan-package-materializer.js');

const RECORD_FILE = 'human-planning-approval.json';
const RECORD_SCHEMA = 'vidtoolz.humanPlanningApproval.v1';
const SNAPSHOT_SCHEMA = 'vidtoolz.humanPlanningSnapshot.v1';
const PLANNING_SOURCE = 'HUMAN_AUTHORED';
const GATE_ID = 'shot-edit-plan-review';

// Governed set == the artifacts gate 6 grades as the shot/edit plan. Nothing
// else in the run may affect the digest.
const GOVERNED_ARTIFACTS = materializer.OUTPUT_FILES;

// Human-path marker binding. Distinct from the agent path's "Approved plan
// digest" on purpose: the two digests mean different things and must never be
// interchangeable.
const SNAPSHOT_BINDING_PATTERN = /Approved planning snapshot:\s*([0-9a-f]{64})/i;

class HumanPlanningApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HumanPlanningApprovalError';
    this.code = code;
  }
}

function fail(code, message) { throw new HumanPlanningApprovalError(code, message); }

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function recordPath(runDir) { return path.join(path.resolve(runDir), RECORD_FILE); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/* -------------------------------------------------------------- snapshot ---- */

/*
 * Deterministic digest over the reviewed planning content.
 *
 * Ordering is fixed by GOVERNED_ARTIFACTS rather than by directory listing, the
 * body is the machine-owned text only, and nothing volatile (mtime, generation
 * time) participates. The same five files therefore always produce the same
 * digest, on any machine, in any order they happen to be written.
 */
function buildHumanPlanningApprovalSnapshot(runDirInput) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('HUMAN_PLAN_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const runId = path.basename(runDir);

  const artifacts = GOVERNED_ARTIFACTS.map((filename) => {
    const file = path.join(runDir, filename);
    // Path safety: the governed set is a fixed list of basenames, so a resolved
    // path must still sit directly in the run.
    if (path.dirname(file) !== runDir) fail('HUMAN_PLAN_PATH_UNSAFE', `refusing to read outside the run: ${filename}`);
    if (!fs.existsSync(file)) fail('HUMAN_PLAN_ARTIFACT_MISSING', `${filename} is missing; the governed planning set is incomplete`);
    const machineText = materializer.machineCanonicalText(fs.readFileSync(file, 'utf8'));
    return { filename, machine_sha256: sha256(machineText) };
  });

  // Canonical serialization: schema + gate + run + ordered (filename, digest)
  // pairs. Explicit and stable; no general content-addressing framework needed.
  const canonical = [
    SNAPSHOT_SCHEMA,
    GATE_ID,
    runId,
    ...artifacts.map((entry) => `${entry.filename}:${entry.machine_sha256}`),
  ].join('\n');

  return {
    schema: SNAPSHOT_SCHEMA,
    gate: GATE_ID,
    run_id: runId,
    planning_source: PLANNING_SOURCE,
    artifacts,
    digest: sha256(canonical),
  };
}

/* ---------------------------------------------------------------- record ---- */

function readRecord(runDir) {
  const file = recordPath(runDir);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { fail('HUMAN_PLAN_RECORD_UNREADABLE', `${RECORD_FILE} is not valid JSON`); }
  if (parsed?.schema !== RECORD_SCHEMA) {
    fail('HUMAN_PLAN_RECORD_SCHEMA_UNSUPPORTED', `${RECORD_FILE} schema is not ${RECORD_SCHEMA}`);
  }
  return parsed;
}

/*
 * Only an ACTIVE record declares human planning authority. A retired record is
 * kept as evidence of what was once reviewed, but it no longer governs the gate —
 * otherwise handing authority back to the agent path would leave a human approval
 * silently covering machine-generated content.
 */
function hasRecord(runDir) {
  if (!fs.existsSync(recordPath(runDir))) return false;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(recordPath(runDir), 'utf8')); }
  catch (_) { return true; } // unreadable but present: let verification fail loudly
  return !parsed?.retired;
}

/*
 * Hand gate-6 planning authority back to the agent path. Explicit in both
 * directions: taking human ownership needs supersedeAgent, releasing it needs
 * this. Nothing switches as a side effect of writing planning content.
 */
function retireHumanPlanningDeclaration(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const record = readRecord(runDir);
  if (!record) fail('HUMAN_PLAN_RECORD_MISSING', `${RECORD_FILE} does not exist; nothing to retire`);
  if (record.retired) return { record, path: recordPath(runDir), unchanged: true };
  const retired = {
    ...record,
    retired: {
      reason: options.reason || 'human planning authority released to the agent path',
      retired_by: options.retiredBy || 'operator',
    },
  };
  if (!options.dryRun) atomicWrite(recordPath(runDir), `${JSON.stringify(retired, null, 2)}\n`);
  return { record: retired, path: recordPath(runDir), unchanged: false };
}

/*
 * Declare this run's planning as human-authored and record what is on the table.
 * This is explicitly NOT an approval: the record carries no verdict and no
 * approver. It says "this is the content currently awaiting review".
 */
function prepareHumanPlanningReview(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const snapshot = buildHumanPlanningApprovalSnapshot(runDir);

  // Switching away from an agent-generated package is a real decision, not a
  // side effect of writing a file.
  const agentDeclared = fs.existsSync(path.join(runDir, materializer.PROVENANCE_FILE));
  if (agentDeclared && !options.supersedeAgent) {
    fail('PLANNING_AUTHORITY_AMBIGUOUS',
      `${materializer.PROVENANCE_FILE} declares agent-generated planning; pass supersedeAgent to take human ownership`);
  }

  const record = {
    schema: RECORD_SCHEMA,
    gate: GATE_ID,
    run_id: snapshot.run_id,
    planning_source: PLANNING_SOURCE,
    governed_artifacts: [...GOVERNED_ARTIFACTS],
    snapshot,
    // Present only when a human deliberately took over an agent-generated set.
    supersedes: agentDeclared ? { planning_source: 'AGENT_GENERATED', declared_by: materializer.PROVENANCE_FILE } : null,
    prepared_by: options.preparedBy || 'operator',
    // No verdict here by design: approval is Mikko's marker, not this file.
    approval: null,
  };

  const existing = hasRecord(runDir) ? readRecord(runDir) : null;
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const unchanged = existing && JSON.stringify(existing) === JSON.stringify(record);
  if (!options.dryRun && !unchanged) atomicWrite(recordPath(runDir), contents);

  return { record, path: recordPath(runDir), unchanged: Boolean(unchanged), snapshotDigest: snapshot.digest };
}

/* ---------------------------------------------------------------- verify ---- */

function readSnapshotBinding(runDir) {
  const approval = materializer.readApprovalBinding(runDir);
  if (!approval) return null;
  const file = path.join(path.resolve(runDir), approval.filename);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const match = SNAPSHOT_BINDING_PATTERN.exec(text);
  return { marker_file: approval.filename, snapshot_digest: match ? match[1].toLowerCase() : null };
}

/*
 * Verify that a recorded human approval still applies to the artifacts on disk.
 * Mirrors the agent path's contract: the marker must name a digest, the record
 * must agree, and the artifacts must still hash to it.
 */
function verifyHumanApprovalBinding(runDirInput) {
  const runDir = path.resolve(runDirInput);
  const binding = readSnapshotBinding(runDir);
  if (!binding) return { present: false, ok: false, code: null, detail: 'no approval marker' };

  const base = {
    present: true,
    planning_source: PLANNING_SOURCE,
    marker_file: binding.marker_file,
    approved_digest: binding.snapshot_digest,
    current_digest: null,
  };
  const reject = (code, detail) => ({ ...base, ok: false, code, detail });

  let record;
  try { record = readRecord(runDir); }
  catch (error) { return reject('HUMAN_PLAN_ARTIFACT_DRIFT', error.message); }
  if (!record) {
    return reject('HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN', `no ${RECORD_FILE}, so this approval is not bound to any reviewed planning set`);
  }
  if (record.retired) {
    return reject('HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN', `${RECORD_FILE} is retired; human planning authority was released`);
  }
  if (record.run_id !== path.basename(runDir) || record.gate !== GATE_ID) {
    return reject('HUMAN_PLAN_ARTIFACT_DRIFT', `${RECORD_FILE} was recorded for a different run or gate`);
  }

  // Recompute from the artifacts as they are now. A missing governed artifact is
  // a hard failure: approval cannot survive the disappearance of what it covered.
  let current;
  try { current = buildHumanPlanningApprovalSnapshot(runDir); }
  catch (error) { return reject('HUMAN_PLAN_ARTIFACT_DRIFT', error.message); }
  base.current_digest = current.digest;

  if (record.snapshot?.digest !== current.digest) {
    return reject('HUMAN_PLAN_ARTIFACT_DRIFT',
      `the reviewed planning set has changed since it was recorded (${record.snapshot?.digest} -> ${current.digest})`);
  }
  if (!binding.snapshot_digest) {
    return reject('HUMAN_PLAN_APPROVAL_DIGEST_UNKNOWN',
      `${binding.marker_file} records an approval with no approved planning snapshot digest`);
  }
  if (binding.snapshot_digest !== current.digest) {
    return reject('HUMAN_PLAN_APPROVAL_SUPERSEDED',
      `the approval names planning snapshot ${binding.snapshot_digest} but the current set is ${current.digest}`);
  }

  return {
    ...base,
    ok: true,
    code: null,
    detail: 'approval is bound to the exact human-authored planning set on disk',
    artifacts: current.artifacts,
  };
}

/* -------------------------------------------------------------- CLI ------- */

function usage() {
  return [
    'Usage: node scripts/package-run-human-planning-approval.js <package-run> [--supersede-agent] [--retire] [--dry-run] [--json]',
    '',
    'Declares a run\'s shot/edit planning as HUMAN_AUTHORED and records a deterministic',
    'snapshot of the five governed artifacts for review. This is not an approval:',
    'Mikko still records the verdict, bound to the snapshot digest printed here.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = { json: false, dryRun: false, supersedeAgent: false };
  let runFolder = null;
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--supersede-agent') options.supersedeAgent = true;
    else if (arg === '--retire') options.retire = true;
    else if (arg === '--help') { console.log(usage()); return 0; }
    else if (!runFolder) runFolder = arg;
    else { console.error(usage()); return 1; }
  }
  if (!runFolder) { console.error(usage()); return 1; }
  try {
    if (options.retire) {
      const retired = retireHumanPlanningDeclaration(path.resolve(runFolder), options);
      if (options.json) console.log(JSON.stringify(retired, null, 2));
      else console.log(`human planning authority retired${retired.unchanged ? ' (already retired)' : ''}; the agent path governs gate 6 again`);
      return 0;
    }
    const result = prepareHumanPlanningReview(path.resolve(runFolder), options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`planning source: ${PLANNING_SOURCE}${result.unchanged ? ' (unchanged)' : ''}`);
      console.log(`approved planning snapshot digest: ${result.snapshotDigest}`);
      console.log('');
      console.log('To approve, Mikko records both lines in a governed or human-owned planning artifact:');
      console.log('  Shot/edit plan approval: PASS');
      console.log(`  - Approved planning snapshot: ${result.snapshotDigest}`);
    }
    return 0;
  } catch (error) {
    console.error(`${error.code || 'HUMAN_PLAN_PREPARE_FAILED'}: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  RECORD_FILE,
  RECORD_SCHEMA,
  SNAPSHOT_SCHEMA,
  PLANNING_SOURCE,
  GATE_ID,
  GOVERNED_ARTIFACTS,
  SNAPSHOT_BINDING_PATTERN,
  HumanPlanningApprovalError,
  sha256,
  recordPath,
  buildHumanPlanningApprovalSnapshot,
  readRecord,
  hasRecord,
  prepareHumanPlanningReview,
  retireHumanPlanningDeclaration,
  readSnapshotBinding,
  verifyHumanApprovalBinding,
  usage,
  main,
};
