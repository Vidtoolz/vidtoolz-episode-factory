'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// CLEAN-TREE PROMOTION DURABILITY GATE.
//
// Invariant (established after the DIRN17 durability defect): approved
// behavior must be reproducible from the source-control state recorded as the
// promoted implementation. Human approval alone is not promotion; a dirty
// working tree is not a source identity.
//
// The gate lives in scripts/earth-studio-promotion-durability.js. These tests
// prove the historical failure class is deterministically rejected.

const REPO = path.join(__dirname, '..');
const GATE = path.join(REPO, 'scripts', 'earth-studio-promotion-durability.js');
const PROMO_PKG = 'package-runs/2026-08-22-earth-studio-orbit-travel-promotion';
const ACCEPTED_SHA = 'b940fa48380ff32fb88b5e537c03ef719b0a9973f4c804bf45038a31444b2be7';
// The commit that made SETTLE_THEN_LAUNCH source-durable.
const DURABLE_COMMIT = '2586bc491377d1a3c8d584a10ac9be427cd24e2f';
// The immediately preceding state: behavior lived only in the dirty worktree.
const PRE_DURABLE_COMMIT = 'ff43a625102b1a6ffec659cce44afcf057fab0f0';
// The clean-tree regeneration of the pre-durable planner (the exact failure).
const PRE_DURABLE_REGEN_SHA = '1f0676872f652f8055ffe28a099a1718886fd522bfa8a60fa0c7581bc3e2c308';

function runGate(args) {
  try {
    const stdout = execFileSync('node', [GATE, ...args], {
      cwd: REPO, encoding: 'utf8', timeout: 300000,
    });
    return { code: 0, record: JSON.parse(stdout) };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, record: JSON.parse(e.stdout) };
  }
}

test('promotion durability: accepted DIRN17 artifact reproduces from its recorded durable commit (Case B)', () => {
  const r = runGate(['--package', PROMO_PKG, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.code, 0, 'gate must pass when the committed tree reproduces the artifact');
  assert.equal(r.record.verdict, 'DURABLE');
  assert.equal(r.record.checks.byte_identity, true);
  assert.equal(r.record.regenerated.sha256, ACCEPTED_SHA);
});

test('promotion durability: dirty-only implementation is rejected — the exact DIRN17 failure (Case A)', () => {
  const r = runGate(['--package', PROMO_PKG, '--source-commit', PRE_DURABLE_COMMIT]);
  assert.equal(r.code, 1, 'gate must refuse the pre-2586bc4 state');
  assert.equal(r.record.verdict, 'NOT_DURABLE');
  assert.equal(r.record.checks.byte_identity, false);
  // The mismatch must be the historically observed one — proving this test
  // pins the real failure class, not just any failure.
  assert.equal(r.record.regenerated.sha256, PRE_DURABLE_REGEN_SHA);
  assert.notEqual(r.record.regenerated.sha256, r.record.artifact.sha256);
});

test('promotion durability: any changed source that alters output fails byte identity (Case C)', () => {
  // A commit that never contained the handoff produces different bytes; the
  // gate reports both hashes so the operator can act on the difference.
  const r = runGate(['--package', PROMO_PKG, '--source-commit', PRE_DURABLE_COMMIT]);
  assert.ok(r.record.regenerated && r.record.artifact);
  assert.ok(r.record.regenerated.bytes !== r.record.artifact.bytes,
    `regen ${r.record.regenerated.bytes}B vs accepted ${r.record.artifact.bytes}B must be observable`);
});

test('promotion durability: verification works while the live worktree is heavily dirty (Case D)', () => {
  // This repository IS heavily dirty right now (~200+ sibling entries). If the
  // previous tests passed, the gate demonstrably ran isolated clean-tree
  // reconstruction despite that dirt. Assert it explicitly:
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  const dirtyCount = porcelain.split('\n').filter(Boolean).length;
  assert.ok(dirtyCount > 50, 'precondition: live worktree has substantial sibling dirt');
  const r = runGate(['--package', PROMO_PKG, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.code, 0, 'sibling dirt must not block isolated clean-tree proof');
});

test('promotion durability: approval provenance is recorded separately from durability (Case E)', () => {
  const r = runGate(['--package', PROMO_PKG, '--source-commit', DURABLE_COMMIT]);
  // The gate reports whether an approval record exists in the package but
  // NEVER lets its presence influence the durability verdict.
  assert.equal(typeof r.record.checks.human_approval_recorded, 'boolean');
  assert.equal(r.record.verdict, 'DURABLE',
    'verdict reflects regeneration identity only — approval is a separate axis');
});

test('promotion durability: missing shot-plan input is a clear refusal, not a crash (input integrity)', () => {
  const r = runGate(['--package', 'package-runs']);
  assert.equal(r.code, 1);
  assert.equal(r.record.verdict, 'NOT_DURABLE');
  assert.match((r.record.reason || '') + JSON.stringify(r.record), /shot-plan|\.esp/);
});
