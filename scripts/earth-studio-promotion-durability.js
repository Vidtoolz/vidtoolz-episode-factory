#!/usr/bin/env node
'use strict';
// CLEAN-TREE PROMOTION DURABILITY GATE for Earth Studio promotion packages.
//
// Invariant: approved behavior must be reproducible from the source-control
// state recorded as the promoted implementation. Human approval alone is not
// promotion.
//
// Usage:
//   node scripts/earth-studio-promotion-durability.js --package <package-run-dir>
//        [--source-commit <sha>]     (default: current HEAD)
//        [--artifact <path>]         (default: <pkg>/earth-studio/earth-studio.esp
//                                     or the single *.esp under earth-studio/)
//
// What it does (read-only on the repo; writes only to a temp dir):
// 1. Reads the package's accepted artifact + shot-plan.
// 2. Records provenance: source commit, dirty flag, artifact hash, approval file.
// 3. Extracts a PURE tree of the recorded source commit via `git archive`
//    (works regardless of how dirty the live worktree is).
// 4. Regenerates the ESP from that pure tree via planner.buildEsp(plan).
// 5. Compares bytes with the accepted artifact.
// Exit 0 + verdict DURABLE on byte identity; exit 1 + clear reason otherwise.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
// Git commands must run against a repository that CONTAINS the recorded source
// commit. Resolution order:
//   1. --repo <path> argument (explicit)
//   2. nearest ancestor of this script with a .git directory (normal checkout)
//   3. process.cwd() if it is a git repository (pure-tree invocation: the
//      operator runs the gate FROM their real checkout)
function findGitRoot(explicit) {
  const candidates = [explicit, __dirname, process.cwd()].filter(Boolean);
  for (const start of candidates) {
    let dir = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('no git repository found — pass --repo <path>');
}
let GIT_REPO_ROOT = null;

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: GIT_REPO_ROOT, encoding: 'utf8', timeout: 60000, ...options });
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function findEsp(pkgDir) {
  const lane = path.join(pkgDir, 'earth-studio');
  const direct = path.join(lane, 'earth-studio.esp');
  if (fs.existsSync(direct)) return direct;
  // fall back: first .esp in the lane dir
  if (fs.existsSync(lane)) {
    const esp = fs.readdirSync(lane).find((f) => f.endsWith('.esp'));
    if (esp) return path.join(lane, esp);
  }
  return null; // caller reports a clear refusal instead of crashing
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--package') args.package = argv[++i];
    else if (argv[i] === '--source-commit') args.sourceCommit = argv[++i];
    else if (argv[i] === '--artifact') args.artifact = argv[++i];
    else if (argv[i] === '--repo') args.repo = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.package) {
    console.error('usage: earth-studio-promotion-durability.js --package <dir> [--source-commit <sha>] [--artifact <path>] [--repo <path>]');
    process.exit(2);
  }
  GIT_REPO_ROOT = findGitRoot(args.repo);
  const pkgDir = path.resolve(args.package);
  const artifactPath = args.artifact
    ? path.resolve(args.artifact)
    : (findEsp(pkgDir) || path.join(pkgDir, 'earth-studio', 'earth-studio.esp'));
  const planPath = path.join(path.dirname(artifactPath), 'shot-plan.json');
  if (!fs.existsSync(artifactPath)) {
    fail({ reason: `no .esp artifact found under ${path.join(path.relative(REPO_ROOT, pkgDir), 'earth-studio')} — nothing to verify` }, null);
  }
  if (!fs.existsSync(planPath)) {
    fail({ reason: `shot-plan.json missing beside artifact (${planPath}) — regeneration input unavailable` }, null);
  }

  // ── provenance ────────────────────────────────────────────────────────────
  let head = null;
  try { head = git(['rev-parse', 'HEAD']).trim(); } catch { head = null; }
  let dirtyCount = null;
  try {
    dirtyCount = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  } catch { dirtyCount = null; }
  const sourceCommit = args.sourceCommit || head;
  const acceptedBytes = fs.readFileSync(artifactPath);
  const approvalPath = ['human-review.json', 'human-review', 'review']
    .map((n) => path.join(pkgDir, `${n}.json`))
    .find((p) => fs.existsSync(p));

  const record = {
    schema_version: 1,
    gate: 'earth-studio clean-tree promotion durability',
    package_dir: path.relative(REPO_ROOT, pkgDir),
    artifact: {
      path: path.relative(REPO_ROOT, artifactPath),
      sha256: sha256(acceptedBytes),
      bytes: acceptedBytes.length,
    },
    plan: path.relative(REPO_ROOT, planPath),
    source_commit: sourceCommit,
    source_commit_is_head: sourceCommit === head,
    worktree_dirty_files_at_check: dirtyCount,
    human_review_record: approvalPath ? path.relative(REPO_ROOT, approvalPath) : null,
    checks: {},
  };

  if (!sourceCommit || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    fail(record, `recorded source identity is not a full commit SHA: ${sourceCommit}`);
  }

  // Approval is recorded separately from durability — never conflated.
  record.checks.human_approval_recorded = !!approvalPath;

  // ── pure-tree reconstruction ──────────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'es-durability-'));
  try {
    // Extract the pure tree of the recorded commit (no dirty worktree state).
    execFileSync('bash', ['-c',
      `git -C '${GIT_REPO_ROOT}' archive '${sourceCommit}' | tar -x -C '${tmp}'`],
      { timeout: 300000 });

    // The regeneration needs the shot-plan + accepted artifact as INPUT
    // evidence (byte-frozen data), copied beside the pure code tree.
    const evDir = path.join(tmp, path.dirname(path.relative(REPO_ROOT, artifactPath)));
    fs.mkdirSync(evDir, { recursive: true });
    fs.copyFileSync(planPath, path.join(evDir, 'shot-plan.json'));
    fs.copyFileSync(artifactPath, path.join(evDir, path.basename(artifactPath)));

    // Regenerate from PURE committed code.
    const regenCode = [
      `const planner = require(${JSON.stringify(path.join(tmp, 'earth-studio-job-planner.js'))});`,
      `const fs = require('node:fs');`,
      `const plan = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(evDir, 'shot-plan.json'))}, 'utf8'));`,
      `process.stdout.write(JSON.stringify(planner.buildEsp(plan)));`,
    ].join('\n');
    const regenPath = path.join(tmp, '__regen.js');
    fs.writeFileSync(regenPath, regenCode);
    let regenJson;
    try {
      regenJson = execFileSync('node', [regenPath], { cwd: tmp, encoding: 'utf8', timeout: 120000 });
    } catch (e) {
      fail(record, `clean-tree regeneration crashed: ${String(e.stderr || e.message).slice(0, 300)}`);
    }
    const regenBytes = Buffer.from(`${JSON.stringify(JSON.parse(regenJson), null, 2)}\n`);
    record.regenerated = {
      sha256: sha256(regenBytes),
      bytes: regenBytes.length,
    };
    record.checks.clean_tree_regeneration = true;
    record.checks.byte_identity = regenBytes.equals(acceptedBytes);

    record.verdict = record.checks.byte_identity ? 'DURABLE' : 'NOT_DURABLE';
    console.log(JSON.stringify(record, null, 2));
    process.exit(record.checks.byte_identity ? 0 : 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function fail(record, reason) {
  record.verdict = 'NOT_DURABLE';
  if (reason) record.reason = reason;
  console.log(JSON.stringify(record, null, 2));
  process.exit(1);
}

if (require.main === module) main();
module.exports = { REPO_ROOT };
