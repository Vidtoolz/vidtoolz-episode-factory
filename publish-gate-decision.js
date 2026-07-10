'use strict';

/*
 * VIDTOOLZ publish-gate operator decision — durable, package-run-scoped.
 *
 * The publish gate's AUTOMATED evaluation (rough-cut / final review artifacts +
 * required media/selection present) is distinct from the OPERATOR DECISION
 * (an explicit, human "approved / rejected / revoked" that survives reload and
 * service restart). This module owns that decision as authoritative workflow
 * state:
 *
 *   - `evaluatePublishGate(runDir)`  — deterministic, live automated result +
 *     blockers, computed from on-disk artifacts (no script spawn, no network).
 *   - `computeEvidenceRevision(runDir)` — a stable sha256 over the material
 *     publish inputs; a decision is bound to the revision it was made against and
 *     becomes STALE (derived at read time) when that revision changes.
 *   - approve / reject / revoke — explicit, server-validated transitions with an
 *     append-only history. Never publishes, uploads, renders, or advances
 *     irreversible state.
 *
 * Local-first, dependency-free. Package-run-scoped: one project can never touch
 * another's decision (the caller resolves + path-guards the run dir).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DECISION_FILE = 'publish-gate-decision.json';
const SCHEMA_VERSION = 1;
const NOTE_MAX = 500;
const DECISION_STATES = ['undecided', 'approved', 'rejected', 'revoked'];

// Material inputs that affect publish readiness. A change to any of these
// re-computes the evidence revision and stales an existing decision. UI-only or
// non-authoritative state (panel toggles, display prefs, report formatting) is
// deliberately excluded. Text files contribute their content hash; the staged
// final media contributes name+size (never its full bytes — large clips are not
// read into memory).
const EVIDENCE_TEXT_FILES = [
  'final-script.md',
  'selected-images.json',
  'video-prompts.json',
  'rough-cut-review.md',
  'final-review.md',
  'publication-blockers.md',
  'publish-metadata-review.md',
  'export-checklist.md',
  'package-run-state.md',
];
// Prerequisites whose ABSENCE blocks an automated PASS.
const REQUIRED_FOR_PASS = ['final-review.md', 'selected-images.json'];
const VIDEO_DIRS = ['videos'];

function nowIso() { return new Date().toISOString(); }

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// A staged final video is any videos/<variant>/NNN.mp4 (or a symlink to one).
function stagedVideoManifest(runDir) {
  const out = [];
  for (const top of VIDEO_DIRS) {
    const base = path.join(runDir, top);
    let variants = [];
    try { variants = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
    for (const v of variants) {
      if (!v.isDirectory()) continue;
      const vdir = path.join(base, v.name);
      let files = [];
      try { files = fs.readdirSync(vdir, { withFileTypes: true }); } catch (_) { continue; }
      for (const f of files) {
        if (!/\.mp4$/i.test(f.name)) continue;
        let size = 0;
        try { size = fs.statSync(path.join(vdir, f.name)).size; } catch (_) { size = -1; }
        out.push({ path: `${top}/${v.name}/${f.name}`, size });
      }
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

// Deterministic evidence revision over the material inputs. Identical relevant
// state => identical revision; a materially changed input => a different one.
// The server always computes this; a client-supplied revision is never trusted.
function computeEvidenceRevision(runDir) {
  const manifest = { schema: SCHEMA_VERSION, files: {}, videos: stagedVideoManifest(runDir) };
  for (const name of EVIDENCE_TEXT_FILES) {
    const p = path.join(runDir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) manifest.files[name] = sha256(fs.readFileSync(p));
      else manifest.files[name] = null;
    } catch (_) {
      manifest.files[name] = null; // absent inputs are part of the revision
    }
  }
  return sha256(Buffer.from(JSON.stringify(manifest), 'utf8'));
}

// Live automated evaluation from on-disk artifacts (deterministic; no spawn).
// result: 'pass' | 'fail' | 'not_evaluated'. `blockers` explains a non-pass.
function evaluatePublishGate(runDir) {
  const has = (name) => { try { return fs.statSync(path.join(runDir, name)).isFile(); } catch (_) { return false; } };
  const finalReviewed = has('final-review.md');
  const videos = stagedVideoManifest(runDir);
  const blockers = [];
  if (!has('final-review.md')) blockers.push('final review not run (final-review.md missing)');
  if (!has('selected-images.json')) blockers.push('no selected media (selected-images.json missing)');
  if (videos.length === 0) blockers.push('no staged final video');
  let result;
  if (!finalReviewed) result = 'not_evaluated';
  else result = blockers.length === 0 ? 'pass' : 'fail';
  const summary = result === 'pass'
    ? 'Automated gate PASS: final review present, media selected, final video staged.'
    : result === 'not_evaluated'
      ? 'Not evaluated: run the final review first.'
      : `Automated gate FAIL: ${blockers.join('; ')}.`;
  return { result, blockers, summary, evaluated: finalReviewed };
}

function defaultState() {
  return { schema_version: SCHEMA_VERSION, decision_version: 0, decision: { status: 'undecided' }, history: [] };
}

function decisionPath(runDir) { return path.join(runDir, DECISION_FILE); }

// Read the persisted decision. Missing file => undecided (legacy projects are
// NOT rewritten by a read). Malformed authoritative state surfaces a 422-coded
// error (never a silent approval).
function readDecisionState(runDir) {
  const p = decisionPath(runDir);
  if (!fs.existsSync(p)) return defaultState();
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) {
    const err = new Error('Could not read publish-gate decision state.'); err.statusCode = 500; err.code = 'DECISION_WRITE_FAILED'; throw err;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    const err = new Error('Publish-gate decision state is corrupt (invalid JSON).'); err.statusCode = 422; err.code = 'MALFORMED_DECISION_STATE'; throw err;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.decision || typeof parsed.decision !== 'object'
    || !DECISION_STATES.includes(parsed.decision.status)) {
    const err = new Error('Publish-gate decision state is malformed.'); err.statusCode = 422; err.code = 'MALFORMED_DECISION_STATE'; throw err;
  }
  return {
    schema_version: parsed.schema_version || SCHEMA_VERSION,
    decision_version: Number.isInteger(parsed.decision_version) ? parsed.decision_version : 0,
    decision: parsed.decision,
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

function writeDecisionState(runDir, state) {
  const p = decisionPath(runDir);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, p);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    const err = new Error(`Failed to persist publish-gate decision: ${e.message}`); err.statusCode = 500; err.code = 'DECISION_WRITE_FAILED'; throw err;
  }
}

function sanitizeNote(note) {
  if (note == null) return '';
  const s = String(note);
  if (s.length > NOTE_MAX) { const e = new Error(`Note exceeds ${NOTE_MAX} characters.`); e.statusCode = 400; e.code = 'DECISION_NOTE_TOO_LONG'; throw e; }
  return s;
}

// Compose the authoritative VIEW: live evaluation + current revision + the
// persisted decision with a freshly-derived `stale` flag + history. Pure read.
function buildView(runDir) {
  const evaluation = evaluatePublishGate(runDir);
  const currentRevision = computeEvidenceRevision(runDir);
  const state = readDecisionState(runDir);
  const d = state.decision;
  const boundStatuses = ['approved', 'rejected'];
  const stale = boundStatuses.includes(d.status) && d.evidence_revision !== currentRevision;
  const decision = Object.assign({}, d, {
    stale,
    stale_reason: stale ? 'Project evidence changed after this decision. Re-evaluate and decide again.' : undefined,
  });
  return {
    evaluation: {
      result: evaluation.result,
      summary: evaluation.summary,
      blockers: evaluation.blockers,
      evidence_revision: currentRevision,
    },
    decision,
    decision_version: state.decision_version,
    history: state.history,
    // Authoritative: is publishing currently operator-approved on current evidence?
    publish_approved: isPublishApproved({ evaluation, currentRevision, decision: d }),
  };
}

// The ONE authoritative resolver. Publishing is approved only when a durable
// operator approval exists, is bound to the CURRENT evidence revision (not
// stale), and the current automated gate still passes. An automated PASS alone
// is never approval.
function isPublishApproved(input) {
  if (!input || !input.decision) return false;
  const { evaluation, currentRevision, decision } = input;
  if (decision.status !== 'approved') return false;
  if (decision.evidence_revision !== currentRevision) return false; // stale
  if (!evaluation || evaluation.result !== 'pass') return false;
  return true;
}

// Convenience resolver from a run dir (used by downstream consumers).
function isPublishApprovedForRun(runDir) {
  return buildView(runDir).publish_approved === true;
}

function pushHistory(state, event) {
  state.history.push(Object.assign({ schema_version: SCHEMA_VERSION, at: nowIso(), by: 'operator' }, event));
  if (state.history.length > 200) state.history = state.history.slice(-200);
}

// Shared optimistic-concurrency guard. The client sends the decision_version it
// last saw; the server compares against the on-disk version. A synchronous
// read-validate-write (no await between) makes concurrent writers deterministic:
// the first wins, later writers see a bumped version and get DECISION_CONFLICT.
function assertDecisionVersion(state, payload) {
  if (payload.base_decision_version !== undefined && payload.base_decision_version !== null) {
    if (Number(payload.base_decision_version) !== state.decision_version) {
      const e = new Error('The decision changed since you loaded it. Refresh and retry.'); e.statusCode = 409; e.code = 'DECISION_CONFLICT'; throw e;
    }
  }
}

// APPROVE — allowed only for a current automated PASS on current evidence.
function approve(runDir, payload = {}) {
  const evaluation = evaluatePublishGate(runDir);
  const currentRevision = computeEvidenceRevision(runDir);
  if (evaluation.result === 'not_evaluated') { const e = new Error('Run the final review before approving.'); e.statusCode = 422; e.code = 'PUBLISH_GATE_NOT_EVALUATED'; throw e; }
  if (evaluation.result === 'fail') { const e = new Error(`Automated gate failed: ${evaluation.blockers.join('; ')}.`); e.statusCode = 422; e.code = evaluation.blockers.length ? 'PUBLISH_GATE_BLOCKED' : 'PUBLISH_GATE_FAILED'; throw e; }
  // Optimistic evidence check: the client approves a revision it saw; if evidence
  // changed since, refuse (cannot approve stale evidence).
  if (payload.base_evidence_revision && payload.base_evidence_revision !== currentRevision) {
    const e = new Error('Evidence changed since evaluation. Re-evaluate before approving.'); e.statusCode = 409; e.code = 'PUBLISH_GATE_EVIDENCE_STALE'; throw e;
  }
  const note = sanitizeNote(payload.note);
  const state = readDecisionState(runDir);
  assertDecisionVersion(state, payload);
  const prev = state.decision.status;
  state.decision = { status: 'approved', decided_at: nowIso(), decided_by: 'operator', evidence_revision: currentRevision, note };
  state.decision_version += 1;
  pushHistory(state, { type: 'approve', evidence_revision: currentRevision, previous_status: prev, note, route: 'publish-gate/approve' });
  writeDecisionState(runDir, state);
  return buildView(runDir);
}

// REJECT — the operator may reject even when the automated gate passes. Distinct
// from an automated failure. Requires that an evaluation exists.
function reject(runDir, payload = {}) {
  const evaluation = evaluatePublishGate(runDir);
  const currentRevision = computeEvidenceRevision(runDir);
  if (evaluation.result === 'not_evaluated') { const e = new Error('Run the final review before recording a decision.'); e.statusCode = 422; e.code = 'PUBLISH_GATE_NOT_EVALUATED'; throw e; }
  const note = sanitizeNote(payload.note);
  const state = readDecisionState(runDir);
  assertDecisionVersion(state, payload);
  const prev = state.decision.status;
  state.decision = { status: 'rejected', decided_at: nowIso(), decided_by: 'operator', evidence_revision: currentRevision, note };
  state.decision_version += 1;
  pushHistory(state, { type: 'reject', evidence_revision: currentRevision, previous_status: prev, note, route: 'publish-gate/reject' });
  writeDecisionState(runDir, state);
  return buildView(runDir);
}

// REVOKE — withdraw a current approval explicitly. Preserves history.
function revoke(runDir, payload = {}) {
  const state = readDecisionState(runDir);
  if (state.decision.status !== 'approved') {
    const e = new Error('There is no current approval to revoke.'); e.statusCode = 409; e.code = 'INVALID_DECISION'; throw e;
  }
  assertDecisionVersion(state, payload);
  const note = sanitizeNote(payload.note);
  const prev = state.decision.status;
  const priorRevision = state.decision.evidence_revision;
  state.decision = { status: 'revoked', decided_at: nowIso(), decided_by: 'operator', evidence_revision: priorRevision, note };
  state.decision_version += 1;
  pushHistory(state, { type: 'revoke', evidence_revision: priorRevision, previous_status: prev, note, route: 'publish-gate/revoke' });
  writeDecisionState(runDir, state);
  return buildView(runDir);
}

module.exports = {
  DECISION_FILE,
  SCHEMA_VERSION,
  NOTE_MAX,
  DECISION_STATES,
  EVIDENCE_TEXT_FILES,
  REQUIRED_FOR_PASS,
  computeEvidenceRevision,
  evaluatePublishGate,
  readDecisionState,
  writeDecisionState,
  buildView,
  isPublishApproved,
  isPublishApprovedForRun,
  approve,
  reject,
  revoke,
};
