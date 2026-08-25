'use strict';

/*
 * Run-level production mode.
 *
 * The lifecycle kept asking "who owns capture?" before it could answer "what
 * kind of production is this?". Gate 7 therefore conflated machine preparation,
 * proxy delivery, real human performance, and take logging into one meaning.
 *
 * This module makes the missing distinction canonical:
 *
 *   DRAFT       machine performance — proxy presenter, synthetic delivery
 *   REVIEW      human judgment over an already produced draft
 *   PRODUCTION  real Mikko performance replaces the proxy
 *
 * Deliberate boundaries:
 *  - mode is RUN-level durable metadata, never a workstation setting and never
 *    owned by a projection (package-run-state, tracker and the control room read
 *    it, they do not decide it);
 *  - mode is orthogonal to the canonical 14 gates. This is not a second
 *    lifecycle engine: gate order never changes, only what evidence a gate
 *    requires and who owns it;
 *  - a legacy run without a mode is MODE_UNSPECIFIED, never guessed. Guessing
 *    PRODUCTION would silently commit Mikko to a real performance; guessing DRAFT
 *    would silently claim a proxy is acceptable;
 *  - promotion into PRODUCTION is human-only, because it is what commits Mikko to
 *    physically record. An agent may drive DRAFT and REVIEW, never that.
 */

const fs = require('node:fs');
const path = require('node:path');

const humanIdentity = require('./human-approval-identity.js');

const MODE_FILE = 'production-mode.json';
const MODE_SCHEMA = 'vidtoolz.packageRunProductionMode.v1';

const DRAFT = 'DRAFT';
const REVIEW = 'REVIEW';
const PRODUCTION = 'PRODUCTION';
const MODE_UNSPECIFIED = 'MODE_UNSPECIFIED';

const MODES = Object.freeze([DRAFT, REVIEW, PRODUCTION]);

// Allowed transitions. PRODUCTION -> REVIEW exists so a promoted run can be sent
// back for rework; there is no PRODUCTION -> DRAFT, because discarding a locked
// human performance back to proxy delivery is a new run, not a mode change.
const TRANSITIONS = Object.freeze({
  [DRAFT]: [REVIEW],
  [REVIEW]: [DRAFT, PRODUCTION],
  [PRODUCTION]: [REVIEW],
});

// Modes an agent may set on its own. Promotion to PRODUCTION is excluded on
// purpose: it commits a human to perform.
const AGENT_SETTABLE = Object.freeze([DRAFT, REVIEW]);
const HUMAN_ONLY = Object.freeze([PRODUCTION]);

class ProductionModeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionModeError';
    this.code = code;
  }
}

function fail(code, message) { throw new ProductionModeError(code, message); }

function modePath(runDir) { return path.join(path.resolve(runDir), MODE_FILE); }

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/* ------------------------------------------------------------------ read ---- */

/*
 * Read the run's declared mode. A run with no record is MODE_UNSPECIFIED — an
 * explicit answer, not a default. Callers whose behaviour depends on mode must
 * fail closed on it rather than picking one.
 */
function readProductionMode(runDirInput) {
  const runDir = path.resolve(runDirInput);
  const file = modePath(runDir);
  if (!fs.existsSync(file)) {
    return { mode: MODE_UNSPECIFIED, declared: false, record: null };
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { fail('PRODUCTION_MODE_UNREADABLE', `${MODE_FILE} is not valid JSON`); }
  if (parsed?.schema !== MODE_SCHEMA) {
    fail('PRODUCTION_MODE_SCHEMA_UNSUPPORTED', `${MODE_FILE} schema is not ${MODE_SCHEMA}`);
  }
  if (!MODES.includes(parsed.mode)) {
    fail('PRODUCTION_MODE_INVALID', `${MODE_FILE} declares an unknown mode: ${parsed.mode}`);
  }
  if (parsed.run_id !== path.basename(runDir)) {
    fail('PRODUCTION_MODE_RUN_MISMATCH', `${MODE_FILE} was recorded for run ${parsed.run_id}`);
  }
  return { mode: parsed.mode, declared: true, record: parsed };
}

function isDeclared(runDir) {
  try { return readProductionMode(runDir).declared; } catch (_) { return true; }
}

/* ----------------------------------------------------------------- write ---- */

function assertTransitionAllowed(from, to) {
  if (!MODES.includes(to)) fail('PRODUCTION_MODE_INVALID', `unknown mode: ${to}`);
  if (from === MODE_UNSPECIFIED) return; // first declaration may pick any mode
  if (from === to) return;
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    fail('PRODUCTION_MODE_TRANSITION_REFUSED', `${from} -> ${to} is not an allowed mode transition`);
  }
}

/*
 * Record the run's mode. `setBy` is the authority: promotion into PRODUCTION
 * requires an explicit local human identity, so no agent can commit Mikko to a
 * real performance by writing a file.
 */
function setProductionMode(runDirInput, mode, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('PRODUCTION_MODE_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const setBy = options.setBy;
  if (typeof setBy !== 'string' || !setBy.trim()) {
    fail('PRODUCTION_MODE_AUTHORITY_MISSING', 'setBy is required: a mode change must name its authority');
  }
  if (HUMAN_ONLY.includes(mode) && !humanIdentity.verifyLocalHumanApprover(setBy)) {
    fail('PRODUCTION_MODE_HUMAN_AUTHORITY_REQUIRED',
      `promotion to ${mode} requires an explicit local human authority; "${setBy}" is not one`);
  }

  const current = readProductionMode(runDir);
  assertTransitionAllowed(current.mode, mode);

  const record = {
    schema: MODE_SCHEMA,
    run_id: path.basename(runDir),
    mode,
    set_by: setBy,
    set_at: options.setAt || null,
    predecessor: current.declared ? { mode: current.mode, set_by: current.record.set_by } : null,
    rationale: options.rationale || null,
  };
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const unchanged = current.declared && JSON.stringify(current.record) === JSON.stringify(record);
  if (!options.dryRun && !unchanged) atomicWrite(modePath(runDir), contents);
  return { record, path: modePath(runDir), unchanged: Boolean(unchanged), previous: current.mode };
}

/* ------------------------------------------------------------------- CLI ---- */

function usage() {
  return [
    `Usage: node scripts/package-run-production-mode.js <package-run> [--set ${MODES.join('|')}] --by <authority> [--rationale <text>] [--json]`,
    '',
    'Reads or records the run-level production mode. A run with no record is',
    `${MODE_UNSPECIFIED}; it is never guessed. Promotion to ${PRODUCTION} requires a`,
    'human authority, because it commits Mikko to a real performance.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = { json: false };
  let runFolder = null;
  let mode = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--set') mode = argv[++i];
    else if (arg === '--by') options.setBy = argv[++i];
    else if (arg === '--rationale') options.rationale = argv[++i];
    else if (arg === '--help') { console.log(usage()); return 0; }
    else if (!runFolder) runFolder = arg;
    else { console.error(usage()); return 1; }
  }
  if (!runFolder) { console.error(usage()); return 1; }
  try {
    if (!mode) {
      const current = readProductionMode(path.resolve(runFolder));
      if (options.json) console.log(JSON.stringify(current, null, 2));
      else console.log(`production mode: ${current.mode}${current.declared ? '' : ' (not declared)'}`);
      return 0;
    }
    const result = setProductionMode(path.resolve(runFolder), mode, options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`production mode: ${result.previous} -> ${result.record.mode}${result.unchanged ? ' (unchanged)' : ''}`);
    return 0;
  } catch (error) {
    console.error(`${error.code || 'PRODUCTION_MODE_FAILED'}: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  MODE_FILE,
  MODE_SCHEMA,
  DRAFT,
  REVIEW,
  PRODUCTION,
  MODE_UNSPECIFIED,
  MODES,
  TRANSITIONS,
  AGENT_SETTABLE,
  HUMAN_ONLY,
  ProductionModeError,
  modePath,
  readProductionMode,
  isDeclared,
  assertTransitionAllowed,
  setProductionMode,
  usage,
  main,
};
