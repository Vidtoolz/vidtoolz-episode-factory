'use strict';
// EARTH STUDIO AGENT PILOT — Hermes-native production organization view.
//
// Read-only. Consumes canonical truth (promotion.json via the promote/durability
// tooling) and the agent registry, and produces a structured status envelope
// per specialist plus a Hermes synthesis. It NEVER writes promotion state.
//
// Usage:
//   node scripts/earth-studio-agent-status.js --package <package-run-dir>
//        [--source-commit <sha>] [--repo <path>]
//
// Output: machine-readable JSON on stdout (Hermes/control-room contract).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(REPO_ROOT, 'config', 'agent-registry.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function runPromote(pkgDir, sourceCommit, repo) {
  const args = [path.join(REPO_ROOT, 'scripts', 'earth-studio-promote.js'),
    '--package', pkgDir, '--dry-run'];
  if (sourceCommit) args.push('--source-commit', sourceCommit);
  if (repo) args.push('--repo', repo);
  try {
    const stdout = execFileSync('node', args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 });
    return { code: 0, record: JSON.parse(stdout) };
  } catch (e) {
    let record = null; try { record = JSON.parse(e.stdout); } catch {}
    return { code: e.status === undefined ? -1 : e.status, record: record || {} };
  }
}

function qcDirectorView(record) {
  const durable = record.durability && record.durability.byte_identity === true;
  const approved = record.human_approval && record.human_approval.state === 'APPROVED';
  const rejected = record.human_approval && record.human_approval.state === 'REJECTED';
  if (record.promotion_status === 'ARTIFACT_MISSING' || record.promotion_status === 'PLAN_MISSING') {
    return { state: 'TECHNICAL_QC_FAILED', verdict: 'FAIL',
      blocking_findings: [record.reason || record.promotion_status] };
  }
  if (rejected) {
    return { state: 'PASS_WITH_HUMAN_REJECTION', verdict: 'FAIL',
      blocking_findings: [`human review rejected candidate (${record.human_approval.verdict})`] };
  }
  if (!durable) {
    return { state: 'TECHNICAL_QC_FAILED', verdict: 'FAIL',
      blocking_findings: [
        `clean-tree durability FAILED for recorded commit ${record.source_binding.source_commit}`,
        `regenerated ${record.durability.regenerated_sha256} != accepted ${record.artifact.sha256}` ] };
  }
  return { state: 'PASS', verdict: approved ? 'PASS' : 'PASS_TECHNICAL_ONLY',
    durability: 'DURABLE',
    note: approved ? null : 'durability proven; creative approval outstanding (QC cannot supply it)' };
}

function cameraDirectorView(record, registry) {
  void registry;
  const approved = record.human_approval && record.human_approval.state === 'APPROVED';
  const rejected = record.human_approval && record.human_approval.state === 'REJECTED';
  if (rejected) {
    return { state: 'CANDIDATE_REJECTED', recommendation: 'NEW_CANDIDATE_REQUIRED',
      confidence: null,
      rationale: 'human review rejected this treatment; a new camera candidate is required — the rejection stands regardless of technical merit' };
  }
  if (approved) {
    return { state: 'REVIEW_COMPLETE', recommendation: record.human_approval.verdict,
      confidence: null,
      rationale: 'human creative authority has already chosen the camera treatment; Camera Director records and applies it, never substitutes its own' };
  }
  return { state: 'CAMERA_REVIEW_REQUIRED', recommendation: 'ROUTE_TO_HUMAN_REVIEW',
    confidence: null,
    rationale: 'no human camera decision on record for this artifact; Camera Director may propose candidates but approval belongs to Mikko' };
}

function productionOpsView(record) {
  switch (record.promotion_status) {
    case 'PROMOTED':
      return { state: 'COMPLETE', next_owner: null, attention: 'INFORMATION',
        detail: 'canonical promotion path fully satisfied; no open steps' };
    case 'APPROVED_NOT_DURABLE': {
      return { state: 'BLOCKED_BY_DURABILITY', next_owner: 'production_operations',
        attention: 'AUTONOMOUS',
        remediation_route: 'SOURCE_DURABILITY_FIX',
        detail: 'approved behavior is not reproducible from recorded commit — route to source remediation; no new creative choice introduced' };
    }
    case 'DURABLE_NOT_APPROVED':
      return { state: 'WAITING_FOR_HUMAN', next_owner: 'mikko', attention: 'DECISION',
        detail: 'technical/source gates pass; promotion blocked solely on human approval' };
    case 'HUMAN_REJECTED':
      return { state: 'BLOCKED_HUMAN_REJECTED', next_owner: 'camera_director',
        attention: 'AUTONOMOUS',
        remediation_route: 'NEW_CANDIDATE_REQUIRED',
        detail: 'rejection stands; mechanical retry is prohibited — new candidate required' };
    case 'ARTIFACT_MISSING':
    case 'PLAN_MISSING':
      return { state: record.promotion_status, next_owner: 'production_operations',
        attention: 'AUTONOMOUS', remediation_route: 'ARTIFACT_RESTORATION',
        detail: record.reason };
    default:
      return { state: 'NOT_PROMOTED', next_owner: 'hermes', attention: 'INFORMATION',
        detail: record.reason || 'promotion prerequisites incomplete' };
  }
}

function hermesSynthesis(record, views) {
  const ops = views.production_operations;
  const needsHuman = ops.next_owner === 'mikko';
  let attention = ops.attention;
  if (views.qc_director.state !== 'PASS' && ops.next_owner !== 'mikko') attention = 'AUTONOMOUS';
  const ownerInvariant = ops.next_owner || 'none (terminal)';
  return {
    attention,
    needs_human: needsHuman,
    current_owner: ops.next_owner === 'mikko' ? 'mikko'
      : (record.promotion_status === 'PROMOTED' ? null : ops.next_owner),
    next_owner: ownerInvariant,
    recommendation: needsHuman
      ? `Mikko must decide: ${record.human_question || 'approve or reject the pending candidate'}`
      : (record.promotion_status === 'PROMOTED'
        ? 'No action required.'
        : `Route to ${ops.next_owner}: ${ops.remediation_route || ops.detail}`),
    // Disagreement preservation: specialists are reported individually; Hermes
    // synthesizes routing but never merges their conclusions into one opinion.
    specialist_views_preserved: true,
  };
}

function renderHumanSummary(projectLabel, record, views, synth) {
  const lines = [];
  lines.push(`EARTH STUDIO — ${projectLabel}`);
  lines.push('');
  lines.push(`Status: ${record.promotion_status}`);
  lines.push(`Attention: ${synth.attention}`);
  lines.push('');
  lines.push('Production Operations');
  lines.push(`${opsLine(views)}`);
  lines.push('');
  lines.push('Camera Director');
  lines.push(cameraLine(views));
  lines.push('');
  lines.push('QC Director');
  lines.push(qcLine(views));
  lines.push('');
  lines.push('Hermes');
  lines.push(synth.recommendation);
  return lines.join('\n');
}
function opsLine(v) { return `${v.production_operations.state}.${v.production_operations.detail ? ' ' + v.production_operations.detail : ''}`; }
function cameraLine(v) { return `${v.camera_director.recommendation} — ${v.camera_director.rationale}`; }
function qcLine(v) { return v.qc_director.verdict === 'FAIL' ? `FAIL. ${(v.qc_director.blocking_findings || []).join('; ')}` : `PASS. Durability: ${v.qc_director.durability || 'n/a'}.`; }

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--package') args.package = process.argv[++i];
    else if (process.argv[i] === '--source-commit') args.sourceCommit = process.argv[++i];
    else if (process.argv[i] === '--repo') args.repo = process.argv[++i];
  }
  if (!args.package) {
    console.error('usage: earth-studio-agent-status.js --package <dir> [--source-commit <sha>] [--repo <path>]');
    process.exit(2);
  }
  const registry = loadRegistry();
  const pkgDir = path.resolve(args.package);
  const promo = runPromote(pkgDir, args.sourceCommit, args.repo);
  const record = promo.record;

  const views = {
    production_operations: productionOpsView(record),
    camera_director: cameraDirectorView(record, registry),
    qc_director: qcDirectorView(record),
  };
  const synth = hermesSynthesis(record, views);

  const envelope = {
    schema_version: 1,
    system: 'earth_studio',
    package_dir: path.relative(REPO_ROOT, pkgDir),
    artifact: record.artifact || null,
    promotion_status: record.promotion_status,
    source_commit: record.source_binding ? record.source_binding.source_commit : null,
    agents: views,
    hermes: synth,
    needs_human: synth.needs_human,
    human_question: synth.needs_human ? 'Approve the pending camera treatment?' : null,
    canonical_truth: 'package promotion.json / promote gate output — consumed, never overridden',
    registry_schema_version: registry.schema_version,
  };

  console.log(JSON.stringify(envelope, null, 2));
  console.error('\n' + renderHumanSummary(path.basename(pkgDir), record, views, synth));
  process.exit(0); // organizational view always succeeds; failures live in state
}

if (require.main === module) main();
module.exports = { qcDirectorView, cameraDirectorView, productionOpsView, hermesSynthesis };
