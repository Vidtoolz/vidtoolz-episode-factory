#!/usr/bin/env node
/*
 * Import manually generated external images (e.g. GPT image generation) into a
 * package's media flow with manual_external provenance.
 *
 * No automation, no external calls — it only indexes files Mikko has already
 * downloaded and dropped into the package's imports/manual-images/ folder.
 *
 * Usage:
 *   node scripts/import-manual-images.js --package <abs-path-or-id> [--dry-run]
 *        [--provider gpt_manual|unknown_manual] [--prompt-index N] [--drop-dir <path>]
 */

const { importManualMedia } = require('../manual-media-import.js');

function parseArgs(argv) {
  const out = { kind: 'image' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') out.package = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--provider') out.provider = argv[++i];
    else if (a === '--prompt-index') out.promptIndex = Number(argv[++i]);
    else if (a === '--drop-dir') out.dropDir = argv[++i];
    else if (a === '--root') out.packagesRoot = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.package) {
    console.log('Usage: node scripts/import-manual-images.js --package <abs-path-or-id> [--dry-run] [--provider gpt_manual|unknown_manual] [--prompt-index N] [--drop-dir <path>]');
    process.exit(opts.help ? 0 : 1);
  }
  let result;
  try {
    result = importManualMedia(opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  const list = opts.dryRun ? result.wouldImport : result.imported;
  console.log(`${opts.dryRun ? 'DRY-RUN' : 'IMPORT'} manual images -> ${result.destDir}`);
  console.log(`Scanned ${result.scanned} file(s) in ${result.dropDir}`);
  console.log(`${opts.dryRun ? 'Would import' : 'Imported'}: ${list.length} | duplicates skipped: ${result.duplicates.length} | warnings: ${result.warningsCount}`);
  for (const e of list) {
    const w = e.validation && e.validation.warnings && e.validation.warnings.length ? `  ⚠ ${e.validation.warnings.join('; ')}` : '';
    console.log(`  ${e.original_filename} -> ${e.path}  [${e.generation_provider}]${w}`);
  }
  for (const d of result.duplicates) {
    console.log(`  (duplicate, skipped) ${d.original_filename}`);
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
