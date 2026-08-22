'use strict';

const { assert, fs, test } = require('./_helpers.js');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// CANONICAL EARTH STUDIO PROMOTION STATE MACHINE.
//
// Invariant: PROMOTED is derivable ONLY from
//   human_approval == APPROVED  AND  durability == durable (clean-tree byte
//   identity for the recorded source commit).
// Every other combination is a distinct, explicit non-promoted state.

const REPO = path.join(__dirname, '..');
const CMD = path.join(REPO, 'scripts', 'earth-studio-promote.js');
const SRC_PKG = path.join(REPO, 'package-runs', '2026-08-22-earth-studio-orbit-travel-promotion');
const APPROVAL_SRC = path.join(REPO, 'package-runs',
  '2026-08-21-earth-studio-orbit-travel-handoff', 'human-review.json');
const DURABLE_COMMIT = '2586bc491377d1a3c8d584a10ac9be427cd24e2f';
const PRE_COMMIT = 'ff43a625102b1a6ffec659cce44afcf057fab0f0';
const ACCEPTED_SHA = 'b940fa48380ff32fb88b5e537c03ef719b0a9973f4c804bf45038a31444b2be7';
const PRE_REGEN_SHA = '1f0676872f652f8055ffe28a099a1718886fd522bfa8a60fa0c7581bc3e2c308';
const os = require('node:os');

function run(args) {
  try {
    return { code: 0, out: JSON.parse(execFileSync('node', [CMD, ...args],
      { cwd: REPO, encoding: 'utf8', timeout: 300000 })) };
  } catch (e) {
    let out = null; try { out = JSON.parse(e.stdout); } catch {}
    return { code: e.status === undefined ? -1 : e.status, out };
  }
}

function scratch(withApproval, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-promote-test-'));
  execFileSync('cp', ['-r', `${SRC_PKG}/.`, `${dir}/`]);
  if (withApproval) fs.copyFileSync(APPROVAL_SRC, path.join(dir, 'human-review.json'));
  if (mutate) mutate(dir);
  return dir;
}

test('P1: approval + durable source commit -> PROMOTED with bound artifact hash', () => {
  const dir = scratch(true);
  const r = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.code, 0);
  assert.equal(r.out.promotion_status, 'PROMOTED');
  assert.equal(r.out.human_approval.state, 'APPROVED');
  assert.equal(r.out.durability.byte_identity, true);
  assert.equal(r.out.artifact.sha256, ACCEPTED_SHA);
  assert.equal(r.out.source_binding.source_commit, DURABLE_COMMIT);
  assert.equal(fs.existsSync(path.join(dir, 'promotion.json')), true);
});

test('P2: exact historical pre-durability source -> APPROVED_NOT_DURABLE (permanent regression)', () => {
  const dir = scratch(true);
  const r = run(['--package', dir, '--source-commit', PRE_COMMIT]);
  assert.equal(r.code, 1);
  assert.equal(r.out.promotion_status, 'APPROVED_NOT_DURABLE');
  assert.equal(r.out.durability.byte_identity, false);
  assert.equal(r.out.durability.regenerated_sha256, PRE_REGEN_SHA,
    'must be the historically observed clean-tree mismatch');
  assert.notEqual(r.out.promotion_status, 'PROMOTED');
});

test('P3/P4: durable but no approval -> DURABLE_NOT_APPROVED, never PROMOTED', () => {
  const dir = scratch(false);
  const r = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.code, 1);
  assert.equal(r.out.promotion_status, 'DURABLE_NOT_APPROVED');
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'promotion.json'), 'utf8'));
  assert.notEqual(written.promotion_status, 'PROMOTED');
});

test('P5: explicit human rejection -> HUMAN_REJECTED regardless of durability', () => {
  const dir = scratch(true, (d) => {
    const hr = JSON.parse(fs.readFileSync(path.join(d, 'human-review.json'), 'utf8'));
    hr.verdict = 'NONE_GOOD'; hr.operator = 'Mikko';
    fs.writeFileSync(path.join(d, 'human-review.json'), JSON.stringify(hr, null, 2));
  });
  const r = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.code, 1);
  assert.equal(r.out.promotion_status, 'HUMAN_REJECTED');
});

test('P6/P7: missing artifact fails closed with actionable status', () => {
  const dir = scratch(true, (d) => fs.rmSync(path.join(d, 'earth-studio', 'earth-studio.esp')));
  const r = run(['--package', dir]);
  assert.equal(r.code, 1);
  assert.equal(r.out.promotion_status, 'ARTIFACT_MISSING');
});

test('P8: verification depends only on the recorded commit, not live sibling dirt', () => {
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  assert.ok(porcelain.split('\n').filter(Boolean).length > 50, 'precondition: heavy sibling dirt');
  const dir = scratch(true);
  const r = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  assert.equal(r.out.promotion_status, 'PROMOTED');
});

test('P9: rerun with identical inputs is idempotent (stable record apart from timestamp)', () => {
  const dir = scratch(true);
  run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  const a = fs.readFileSync(path.join(dir, 'promotion.json'), 'utf8')
    .replace(/"verified_at": "[^"]*"/g, '"X"');
  const r2 = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  const b = fs.readFileSync(path.join(dir, 'promotion.json'), 'utf8')
    .replace(/"verified_at": "[^"]*"/g, '"X"');
  assert.equal(r2.out.promotion_status, 'PROMOTED');
  assert.equal(a, b);
});

test('P10: source identity change invalidates the previous proof', () => {
  const dir = scratch(true);
  const good = run(['--package', dir, '--source-commit', DURABLE_COMMIT]);
  assert.equal(good.out.promotion_status, 'PROMOTED');
  const changed = run(['--package', dir, '--source-commit', PRE_COMMIT]);
  assert.equal(changed.out.promotion_status, 'APPROVED_NOT_DURABLE');
  assert.equal(changed.out.source_binding.source_commit, PRE_COMMIT);
});
