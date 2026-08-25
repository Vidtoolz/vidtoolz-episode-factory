'use strict';

/*
 * PACKAGE-RUNS INDEX — LIVE AUTHORITY CANARY
 *
 * Companion to package-runs/2026-08-25-package-runs-index-proof. Proves the
 * index is a rebuildable, non-authoritative discovery projection:
 *
 *   1. empty root               -> index 0
 *   2. proof package only       -> index still 0 (excluded, reported)
 *   3. genuine run appears      -> index 1
 *   4. another proof package    -> still 1
 *   5. forge a ghost entry       -> check detects stale/ghost
 *   6. rebuild                  -> ghost removed, truth restored
 *   7. delete the index         -> runs remain usable; check reports missing
 *   8. rebuild                  -> restores the entry
 *   9. canonical evidence       -> unchanged by every step (sha256 proof)
 *  10. determinism              -> same source, same sourceDigest
 *
 * Everything runs in a scratch root under os.tmpdir(); the real repository
 * tree, real index, and real runs are never touched. The real repository is
 * exercised only read-only at the end (--check equivalent via the module).
 *
 * Usage: node scripts/package-runs-index-canary.js --emit <dir>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const indexModule = require('./package-runs-index.js');

const sha256 = (v) => crypto.createHash('sha256').update(Buffer.isBuffer(v) ? v : String(v)).digest('hex');

function canonicalEvidenceSnapshot(root, runId) {
  const runDir = path.join(root, 'package-runs', runId);
  if (!fs.existsSync(runDir)) return null;
  const entries = fs.readdirSync(runDir).sort();
  return sha256(JSON.stringify(entries.map((name) => ({
    name,
    bytes: sha256(fs.readFileSync(path.join(runDir, name))),
  }))));
}

function run() {
  const proof = { schema_version: 1, proof: 'PACKAGE_RUNS_INDEX_AUTHORITY_CANARY' };
  const failures = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prsi-canary-'));
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  const genuineId = '2026-08-25-index-canary-run';
  try {
    // 1. empty root -> 0
    const empty = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.empty_root = { count: empty.count, scanned: empty.scope.directoriesScanned };
    if (empty.count !== 0) failures.push('empty root did not index 0');

    // 2. proof package only -> still 0, excluded + reported
    const proofDir = path.join(root, 'package-runs', '2026-08-25-canary-proof');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'README.md'), 'canary proof evidence\n');
    const proofOnly = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.proof_only = { count: proofOnly.count, excluded: proofOnly.scope.excluded };
    if (proofOnly.count !== 0 || proofOnly.scope.excluded.proof !== 1) failures.push('proof package leaked into the index');

    // 3. genuine run appears -> 1
    const runDir = path.join(root, 'package-runs', genuineId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'package-candidates.json'), JSON.stringify({ topic: 'canary', candidates: [] }, null, 2));
    fs.writeFileSync(path.join(runDir, 'package-run-state.md'), '# Package Run State\n\n- Package run state: active\n- Workflow path: horizontal\n');
    const withRun = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.genuine_run = { count: withRun.count, runId: withRun.runs[0] ? withRun.runs[0].runId : null };
    if (withRun.count !== 1 || (withRun.runs[0] || {}).runId !== genuineId) failures.push('genuine run was not indexed');

    // 4. another proof package -> still 1
    const proofDir2 = path.join(root, 'package-runs', '2026-08-25-canary-proof-two');
    fs.mkdirSync(proofDir2, { recursive: true });
    fs.writeFileSync(path.join(proofDir2, 'summary.md'), 'more proof evidence\n');
    const stillOne = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.second_proof = { count: stillOne.count, excluded: stillOne.scope.excluded };
    if (stillOne.count !== 1) failures.push('second proof package changed the indexed count');

    const snapshotBefore = canonicalEvidenceSnapshot(root, genuineId);

    // 5. forge a ghost entry -> check detects
    const indexPath = path.join(root, 'package-runs-index.json');
    const forged = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    forged.runs.push({ runId: '2026-01-01-ghost-run', path: 'package-runs/2026-01-01-ghost-run', status: 'ghost' });
    forged.count = forged.runs.length;
    fs.writeFileSync(indexPath, `${JSON.stringify(forged, null, 2)}\n`);
    const ghostCheck = indexModule.checkPackageRunsIndex({ repoRoot: root });
    proof.ghost_forged = { ok: ghostCheck.ok, defects: ghostCheck.defects.map((d) => d.code) };
    if (ghostCheck.ok || !ghostCheck.defects.some((d) => d.code === 'INDEX_GHOST_ENTRY')) failures.push('forged ghost entry not detected');

    // 6. rebuild removes the ghost
    const ghostRepaired = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    const ghostCheckAfter = indexModule.checkPackageRunsIndex({ repoRoot: root });
    proof.ghost_repair = { count: ghostRepaired.count, ok: ghostCheckAfter.ok };
    if (ghostRepaired.count !== 1 || !ghostCheckAfter.ok) failures.push('rebuild did not remove the ghost entry');

    // 7. delete the index -> runs remain usable; check reports missing
    fs.unlinkSync(indexPath);
    const missingCheck = indexModule.checkPackageRunsIndex({ repoRoot: root });
    proof.deleted_index = {
      run_still_usable: indexModule.isPackageRunDir(runDir),
      check_defects: missingCheck.defects.map((d) => d.code),
    };
    if (!proof.deleted_index.run_still_usable) failures.push('deleting the index destroyed run identity');
    if (!missingCheck.defects.some((d) => d.code === 'INDEX_MISSING')) failures.push('missing index not reported');

    // 8. rebuild restores the entry
    const restored = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.restored = { count: restored.count, ok: indexModule.checkPackageRunsIndex({ repoRoot: root }).ok };
    if (restored.count !== 1) failures.push('rebuild did not restore the genuine run');

    // 9. canonical evidence unchanged by every index operation
    const snapshotAfter = canonicalEvidenceSnapshot(root, genuineId);
    proof.canonical_unchanged = { before: (snapshotBefore || '').slice(0, 16), after: (snapshotAfter || '').slice(0, 16), equal: snapshotBefore === snapshotAfter };
    if (snapshotBefore !== snapshotAfter) failures.push('index maintenance mutated canonical run evidence');

    // 10. determinism: same source, same sourceDigest
    const a = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    const b = indexModule.rebuildPackageRunsIndex({ repoRoot: root });
    proof.deterministic = { digest: a.sourceDigest.slice(0, 16), stable: a.sourceDigest === b.sourceDigest };
    if (a.sourceDigest !== b.sourceDigest) failures.push('index sourceDigest is not deterministic');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Read-only classification of the real repository tree (never mutates).
  const real = indexModule.checkPackageRunsIndex({ repoRoot: ROOT });
  proof.real_repository = {
    directoriesScanned: real.directoriesScanned,
    genuineRuns: real.genuineRuns,
    indexedCount: real.indexedCount,
    excluded: real.excluded,
    check_ok: real.ok,
    defects: real.defects.map((d) => d.code),
    statement: 'Directory count under package-runs/ is not the run count: proof/canary/acceptance/legacy directories carry no package-run identity and are excluded by design.',
  };

  proof.index_authority = [
    'filesystem package-run evidence',
    'package-run scanner (scripts/package-runs-index.js buildPackageRunsIndex)',
    'package-runs-index.json — rebuildable, disposable, non-authoritative',
  ];
  proof.failures = failures;
  proof.verdict = failures.length === 0 ? 'PACKAGE_RUNS_INDEX_CANARY_PROVEN' : `PACKAGE_RUNS_INDEX_CANARY_FAIL — ${failures.join('; ')}`;
  return proof;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: package-runs-index-canary.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  const proof = run();
  proof.generated_at = new Date().toISOString();
  proof.module_sha256 = sha256(fs.readFileSync(path.join(ROOT, 'scripts', 'package-runs-index.js')));
  fs.writeFileSync(path.join(emitDir, 'index-canary-summary.json'), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: proof.verdict, failures: proof.failures, real: proof.real_repository }, null, 2)}\n`);
  process.exitCode = proof.failures.length === 0 ? 0 : 1;
}

module.exports = { run };
