'use strict';
// VIDTOOLZ ComfyUI Production Gateway — scoped requalification permits.
//
// The one legitimate deadlock in the qualification model: when a registry
// workflow is deliberately updated (new canonical sha), the previous
// LIVE_PASSED record pins the old sha, so the dispatch gate blocks with
// QUALIFICATION_STALE — but for Wan the only sanctioned requalification
// evidence is the next real production render, which that very block would
// prevent. A permit is the narrow, supervised escape:
//
//   - exact workflow id + version + canonical sha (a permit for wan-hq@1
//     cannot authorize wan-fast@1, another version, or a different graph);
//   - tied to an upgrade session for the audit trail;
//   - bypasses ONLY qualification staleness in the sync dispatch gate —
//     never workflow drift, missing models/nodes, schema mismatch, render
//     contracts, or output validation (those gates run independently);
//   - limited dispatches (default 2), decremented per bypassed dispatch;
//   - CONSUMED permanently by the first successful qualification capture;
//   - persisted atomically (a ~50-minute render or a cockpit restart must
//     not erase the fact that the attempt was authorized).
//
// This is fundamentally different from SUPER_FOCUS_COMFYUI_DRIFT_OVERRIDE=1,
// which weakens every gate and exists for supervised development only.
const fs = require('fs');
const path = require('path');
const provenance = require('./provenance.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PERMIT_ROOT = path.join(REPO_ROOT, 'state', 'comfyui-upgrades', 'permits');
const DEFAULT_USES = 2;

function permitRoot(options = {}) {
  return options.permitRoot || DEFAULT_PERMIT_ROOT;
}

function permitPath(workflowId, options = {}) {
  return path.join(permitRoot(options), `${workflowId}.json`);
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writePermit(permit, options = {}) {
  fs.mkdirSync(permitRoot(options), { recursive: true });
  provenance.writeJsonAtomic(permitPath(permit.workflow.id, options), permit);
  return permit;
}

// Issue a requalification permit for one exact workflow revision. One active
// permit per workflow — issuing replaces any previous (superseded is noted).
function issuePermit({ entry, upgradeSessionId, uses }, options = {}) {
  if (!entry || !entry.id || !entry.canonical_sha256) throw new Error('permit requires a resolved registry entry');
  const now = new Date().toISOString();
  const previous = readJsonSafe(permitPath(entry.id, options));
  const permit = {
    schema_version: 1,
    permit_id: `permit-${entry.id}-${now.replace(/[:.]/g, '-')}`,
    workflow: { id: entry.id, version: entry.version, sha256: entry.canonical_sha256 },
    upgrade_session_id: upgradeSessionId || null,
    status: 'ISSUED',
    uses_remaining: Number.isInteger(uses) && uses > 0 ? uses : DEFAULT_USES,
    issued_at: now,
    events: [
      ...(previous ? [{ at: now, event: 'superseded_previous', previous_permit_id: previous.permit_id, previous_status: previous.status }] : []),
      { at: now, event: 'issued', session: upgradeSessionId || null },
    ],
  };
  return writePermit(permit, options);
}

// The permit valid for THIS entry right now, or null. Exactness is the
// entire point: id, version, and canonical sha must all match.
function findActivePermit(entry, options = {}) {
  const permit = readJsonSafe(permitPath(entry.id, options));
  if (!permit || permit.status !== 'ISSUED' || !(permit.uses_remaining > 0)) return null;
  const w = permit.workflow || {};
  if (w.id !== entry.id || w.version !== entry.version || w.sha256 !== entry.canonical_sha256) return null;
  return permit;
}

// One bypassed dispatch spends one use. At zero the permit is EXHAUSTED —
// further attempts need an explicit operator reissue, never an open bypass.
function recordPermitDispatch(entry, options = {}) {
  const permit = findActivePermit(entry, options);
  if (!permit) return null;
  permit.uses_remaining -= 1;
  permit.events.push({ at: new Date().toISOString(), event: 'dispatch_bypassed_staleness', uses_remaining: permit.uses_remaining });
  if (permit.uses_remaining <= 0) permit.status = 'EXHAUSTED';
  return writePermit(permit, options);
}

// A successful qualification capture retires the permit permanently.
function consumePermit(entry, { qualificationId } = {}, options = {}) {
  const permit = readJsonSafe(permitPath(entry.id, options));
  if (!permit || permit.status === 'CONSUMED') return null;
  const w = permit.workflow || {};
  if (w.id !== entry.id || w.version !== entry.version || w.sha256 !== entry.canonical_sha256) return null;
  permit.status = 'CONSUMED';
  permit.consumed_at = new Date().toISOString();
  permit.consumed_by = qualificationId || null;
  permit.events.push({ at: permit.consumed_at, event: 'consumed_by_successful_qualification', qualification_id: qualificationId || null });
  return writePermit(permit, options);
}

function readPermit(workflowId, options = {}) {
  return readJsonSafe(permitPath(workflowId, options));
}

module.exports = {
  DEFAULT_PERMIT_ROOT,
  DEFAULT_USES,
  permitRoot,
  permitPath,
  issuePermit,
  findActivePermit,
  recordPermitDispatch,
  consumePermit,
  readPermit,
};
