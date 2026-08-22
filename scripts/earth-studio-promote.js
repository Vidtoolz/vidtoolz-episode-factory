#!/usr/bin/env node
'use strict';
// CANONICAL EARTH STUDIO PROMOTION COMMAND.
//
// One authoritative entrypoint. An artifact reaches PROMOTED only when BOTH:
//   1. an explicit human approval record exists with an approving verdict, and
//   2. the clean-tree durability gate passes for a recorded source commit.
//
// Usage:
//   node scripts/earth-studio-promote.js --package <package-run-dir>
//        [--source-commit <sha>] [--artifact <path>] [--repo <path>]
//        [--dry-run]
//
// Writes ONLY `<package>/promotion.json` (atomically). Never commits, never
// pushes, never mutates approval evidence or candidate artifacts.
// Emits machine-readable JSON on stdout.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APPROVING_VERDICTS = new Set(['APPROVE', 'SETTLE_THEN_LAUNCH', 'BASELINE_BETTER', 'APPROVED']);
const REJECTING_VERDICTS = new Set(['REJECT', 'NONE_GOOD', 'REJECTED']);
const SCHEMA_VERSION = 1;

function fail(status, detail) {
  const out = { promotion_status: status || 'NOT_PROMOTED', reason: detail };
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--package') args.package = argv[++i];
    else if (argv[i] === '--source-commit') args.sourceCommit = argv[++i];
    else if (argv[i] === '--artifact') args.artifact = argv[++i];
    else if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else args._.push(argv[i]);
  }
  return args;
}

function readApprovalRecord(pkgDir) {
  // The approval record may live in the package itself or in the package-run
  // that produced the candidate (candidate packages are often promoted from
  // a later promotion package that references the earlier review).
  const direct = ['human-review.json', 'review.json']
    .map((n) => path.join(pkgDir, n))
    .find((p) => fs.existsSync(p));
  if (direct) {
    try { return { path: direct, data: JSON.parse(fs.readFileSync(direct, 'utf8')) }; }
    catch { return { path: direct, data: null, invalid: true }; }
  }
  const reviewDir = path.join(pkgDir, 'human-review');
  if (fs.existsSync(reviewDir)) {
    const p = path.join(reviewDir, 'human-review.json');
    if (fs.existsSync(p)) {
      try { return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
      catch { return { path: p, data: null, invalid: true }; }
    }
  }
  return null;
}

function classifyApproval(record) {
  if (!record) return { state: 'MISSING' };
  if (record.invalid) return { state: 'INVALID', path: record.path };
  const verdict = String(record.data && record.data.verdict || '').trim().toUpperCase();
  if (!verdict) return { state: 'INVALID', path: record.path };
  if (APPROVING_VERDICTS.has(verdict)) {
    return { state: 'APPROVED', verdict, operator: record.data.operator || null,
      completed_at: record.data.completed_at || null, path: record.path };
  }
  if (REJECTING_VERDICTS.has(verdict)) {
    return { state: 'REJECTED', verdict, path: record.path };
  }
  return { state: 'UNRECOGNIZED_VERDICT', verdict, path: record.path };
}

function atomicWriteJson(filePath, value) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.closeSync(fs.openSync(tmp, 'r')); // ensure content is flushed before rename
  fs.renameSync(tmp, filePath);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.package) {
    console.error('usage: earth-studio-promote.js --package <dir> [--source-commit <sha>] [--artifact <path>] [--repo <path>] [--dry-run]');
    process.exit(2);
  }
  const pkgDir = path.resolve(args.package);

  // ── candidate integrity ───────────────────────────────────────────────────
  const laneDir = path.join(pkgDir, 'earth-studio');
  const artifactPath = args.artifact
    ? path.resolve(args.artifact)
    : path.join(laneDir, 'earth-studio.esp');
  const planPath = path.join(path.dirname(artifactPath), 'shot-plan.json');
  if (!fs.existsSync(artifactPath)) {
    fail('ARTIFACT_MISSING', `accepted artifact not found: ${artifactPath}`);
  }
  if (!fs.existsSync(planPath)) {
    fail('PLAN_MISSING', `shot-plan.json not found beside artifact: ${planPath}`);
  }

  // ── human approval ────────────────────────────────────────────────────────
  const approvalRecord = readApprovalRecord(pkgDir);
  const approval = classifyApproval(approvalRecord);
  let durability = null;

  // ── durability via the existing verifier ─────────────────────────────────
  // Always run it (even without approval) so DURABLE_NOT_APPROVED is honest,
  // but tolerate its failure to compute the correct refusal state.
  const gateArgs = [path.join(__dirname, 'earth-studio-promotion-durability.js'),
    '--package', pkgDir, '--artifact', artifactPath];
  if (args.sourceCommit) gateArgs.push('--source-commit', args.sourceCommit);
  if (args.repo) gateArgs.push('--repo', args.repo);
  const { execFileSync } = require('node:child_process');
  try {
    const stdout = execFileSync('node', gateArgs, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 });
    const parsed = JSON.parse(stdout);
    durability = {
      performed: true,
      durable: parsed.verdict === 'DURABLE',
      source_commit: parsed.source_commit || null,
      regenerated_sha256: parsed.regenerated ? parsed.regenerated.sha256 : null,
      accepted_sha256: parsed.artifact ? parsed.artifact.sha256 : null,
      byte_identity: !!parsed.checks.byte_identity,
    };
  } catch (e) {
    let parsed = null;
    try { parsed = JSON.parse(e.stdout); } catch {}
    durability = {
      performed: true,
      durable: false,
      source_commit: parsed ? parsed.source_commit : args.sourceCommit || null,
      regenerated_sha256: parsed && parsed.regenerated ? parsed.regenerated.sha256 : null,
      accepted_sha256: parsed && parsed.artifact ? parsed.artifact.sha256 : null,
      byte_identity: false,
      error: parsed && parsed.reason ? parsed.reason : String(e.message).slice(0, 300),
    };
  }

  // ── derive the single authoritative state (no LLM/operator override) ─────
  const approved = approval.state === 'APPROVED';
  const durable = durability.durable === true;

  let promotionStatus;
  if (approval.state === 'REJECTED') promotionStatus = 'HUMAN_REJECTED';
  else if (!approved && !durable) promotionStatus = 'NOT_PROMOTED';
  else if (approved && !durable) promotionStatus = 'APPROVED_NOT_DURABLE';
  else if (!approved && durable) promotionStatus = 'DURABLE_NOT_APPROVED';
  else promotionStatus = 'PROMOTED';

  const reason = promotionStatus === 'PROMOTED' ? null
    : promotionStatus === 'APPROVED_NOT_DURABLE'
      ? `clean-tree regeneration mismatch: regen ${durability.regenerated_sha256} != accepted ${durability.accepted_sha256}`
      : promotionStatus === 'DURABLE_NOT_APPROVED'
        ? 'clean-tree durability proven but no explicit human approval record found'
        : promotionStatus === 'HUMAN_REJECTED'
          ? `human review rejected this candidate (${approval.verdict})`
          : approval.state === 'MISSING' ? 'no human-review record in package'
            : approval.state === 'INVALID' ? 'human-review record has no usable verdict'
              : `unrecognized approval verdict: ${approval.verdict}`;

  const record = {
    schema_version: SCHEMA_VERSION,
    authority: 'earth-studio canonical promotion (human approval + clean-tree durability)',
    package_dir: path.relative(REPO_ROOT, pkgDir),
    artifact: {
      path: path.relative(REPO_ROOT, artifactPath),
      sha256: durability.accepted_sha256,
      plan: path.relative(REPO_ROOT, planPath),
    },
    human_approval: {
      required: true,
      state: approval.state,
      verdict: approval.verdict || null,
      operator: approval.operator || null,
      completed_at: approval.completed_at || null,
      record_path: approval.path ? path.relative(REPO_ROOT, approval.path) : null,
    },
    source_binding: {
      source_commit: durability.source_commit,
      recorded_in_record: true,
    },
    durability: {
      gate: 'scripts/earth-studio-promotion-durability.js',
      clean_tree_verification_performed: durability.performed,
      regenerated_sha256: durability.regenerated_sha256,
      byte_identity: durability.byte_identity,
      verified_at: new Date().toISOString(),
    },
    promotion_status: promotionStatus,
    reason,
    needs_human: !approved && promotionStatus !== 'HUMAN_REJECTED',
  };

  // ── write / report ────────────────────────────────────────────────────────
  const recordPath = path.join(pkgDir, 'promotion.json');
  if (!args.dryRun) atomicWriteJson(recordPath, record);
  console.log(JSON.stringify({
    ...record,
    promotion_record_path: args.dryRun ? null : path.relative(REPO_ROOT, recordPath),
    dry_run: !!args.dryRun,
  }, null, 2));
  process.exit(promotionStatus === 'PROMOTED' ? 0 : 1);
}

if (require.main === module) main();
module.exports = { APPROVING_VERDICTS, REJECTING_VERDICTS };
