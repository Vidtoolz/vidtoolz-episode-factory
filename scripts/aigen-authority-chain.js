#!/usr/bin/env node

/*
 * Inspect or explicitly bind one existing AIGEN package authority chain.
 *
 * `inspect` is read-only. `bind-current` writes only authority-chain.json and
 * requires an explicit confirmation flag because it declares existing media to
 * be the operator-approved current chain. It never generates, queues, stages,
 * replaces, or deletes media.
 */

const fs = require('fs');
const path = require('path');

const authority = require('../aigen-authority-chain.js');

const DEFAULT_PACKAGES_ROOT = '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages';
const THROUGH = ['image_prompts', 'selected_images', 'i2v_prompts', 'videos', 'resolve_handoff'];

function usage() {
  return `AIGEN authority chain

Usage:
  node scripts/aigen-authority-chain.js inspect --package <id> [--json]
  node scripts/aigen-authority-chain.js inspect --package-dir <absolute-path> [--json]
  node scripts/aigen-authority-chain.js bind-current --package <id> --through <stage> --confirm-current-chain [--video-variant <name>] [--json]

Stages:
  ${THROUGH.join(', ')}

Safety:
  inspect is read-only.
  bind-current writes only authority-chain.json. It does not generate, queue,
  stage, replace, or delete media. The confirmation means the operator has
  reviewed the existing files and accepts their current content as authority.
`;
}

function parseArgs(argv) {
  const args = { command: argv[0] || '', json: false, confirm: false };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') args.json = true;
    else if (token === '--confirm-current-chain') args.confirm = true;
    else if (token === '--package') args.package = argv[++i];
    else if (token === '--package-dir') args.packageDir = argv[++i];
    else if (token === '--packages-root') args.packagesRoot = argv[++i];
    else if (token === '--through') args.through = argv[++i];
    else if (token === '--video-variant') args.videoVariant = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function resolvePackageDir(args) {
  if (args.packageDir) {
    if (!path.isAbsolute(args.packageDir)) throw new Error('--package-dir must be absolute.');
    return path.resolve(args.packageDir);
  }
  const id = String(args.package || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) throw new Error('--package must be a safe package id.');
  const root = path.resolve(args.packagesRoot || DEFAULT_PACKAGES_ROOT);
  const resolved = path.resolve(root, id);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Package resolves outside the packages root.');
  return resolved;
}

function assertPackageDir(packageDir) {
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error(`Package directory not found: ${packageDir}`);
  }
}

function readJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function selectedIndexes(packageDir) {
  const selected = readJson(path.join(packageDir, 'selected-images.json'));
  return (Array.isArray(selected.selections) ? selected.selections : [])
    .map((item) => Number(item && (item.prompt_index == null ? item.index : item.prompt_index)))
    .filter((index) => Number.isInteger(index) && index > 0);
}

function handoffInfo(packageDir) {
  const manifest = readJson(path.join(packageDir, 'resolve-handoff', 'media-manifest.json'));
  return {
    variant: String(manifest.video_variant || '').trim(),
    indexes: Array.isArray(manifest.included_indexes)
      ? manifest.included_indexes.map(Number).filter((index) => Number.isInteger(index) && index > 0)
      : [],
  };
}

function restoreAuthorityLedger(packageDir, original) {
  const ledgerPath = path.join(packageDir, authority.AUTHORITY_FILE);
  if (!original.exists) {
    if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
    return;
  }
  const tmp = `${ledgerPath}.${process.pid}.${Date.now()}.rollback`;
  fs.writeFileSync(tmp, original.bytes);
  fs.chmodSync(tmp, original.mode);
  fs.renameSync(tmp, ledgerPath);
}

function bindCurrent(packageDir, args) {
  const throughIndex = THROUGH.indexOf(args.through);
  if (throughIndex < 0) throw new Error(`--through must be one of: ${THROUGH.join(', ')}`);
  if (!args.confirm) {
    const error = new Error('bind-current requires --confirm-current-chain after operator review.');
    error.code = 'CONFIRMATION_REQUIRED';
    throw error;
  }
  const ledgerPath = path.join(packageDir, authority.AUTHORITY_FILE);
  const original = fs.existsSync(ledgerPath)
    ? {
      exists: true,
      bytes: fs.readFileSync(ledgerPath),
      mode: fs.statSync(ledgerPath).mode,
    }
    : { exists: false, bytes: null, mode: null };
  const changed = [];
  const handoff = handoffInfo(packageDir);
  const variant = String(args.videoVariant || handoff.variant || '').trim();
  const indexes = handoff.indexes.length ? handoff.indexes : selectedIndexes(packageDir);
  try {
    authority.recordStage(packageDir, 'image_prompts');
    changed.push('image_prompts');
    if (throughIndex >= THROUGH.indexOf('selected_images')) {
      authority.recordStage(packageDir, 'selected_images');
      changed.push('selected_images');
    }
    if (throughIndex >= THROUGH.indexOf('i2v_prompts')) {
      authority.recordStage(packageDir, 'i2v_prompts');
      changed.push('i2v_prompts');
    }
    if (throughIndex >= THROUGH.indexOf('videos')) {
      if (!variant) throw new Error('--video-variant is required when the handoff does not record one.');
      authority.recordVideoSlots(packageDir, { variant, indexes });
      changed.push('videos');
    }
    if (throughIndex >= THROUGH.indexOf('resolve_handoff')) {
      authority.recordStage(packageDir, 'resolve_handoff', { variant, indexes });
      changed.push('resolve_handoff');
    }
  } catch (error) {
    try {
      restoreAuthorityLedger(packageDir, original);
    } catch (rollbackError) {
      error.message = `${error.message} Authority-ledger rollback also failed: ${rollbackError.message}`;
      error.code = 'AUTHORITY_BIND_ROLLBACK_FAILED';
    }
    throw error;
  }
  return {
    ok: true,
    command: 'bind-current',
    project_id: path.basename(packageDir),
    package_dir: packageDir,
    wrote: authority.AUTHORITY_FILE,
    changed,
    through: args.through,
    video_variant: variant || null,
    indexes,
    inspection: authority.inspectAuthorityChain(packageDir),
    safety: 'No media, queue, database, service, or external generation was changed.',
  };
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.command) return { help: true, text: usage() };
  if (args.command !== 'inspect' && args.command !== 'bind-current') {
    throw new Error('Command must be inspect or bind-current.');
  }
  const packageDir = resolvePackageDir(args);
  assertPackageDir(packageDir);
  if (args.command === 'inspect') {
    return {
      ok: true,
      command: 'inspect',
      package_dir: packageDir,
      inspection: authority.inspectAuthorityChain(packageDir),
      read_only: true,
    };
  }
  return bindCurrent(packageDir, args);
}

function main() {
  try {
    const result = run();
    if (result.help) {
      process.stdout.write(result.text);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'AIGEN_AUTHORITY_COMMAND_FAILED',
      error: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_PACKAGES_ROOT,
  THROUGH,
  bindCurrent,
  handoffInfo,
  parseArgs,
  resolvePackageDir,
  restoreAuthorityLedger,
  run,
  selectedIndexes,
  usage,
};
