#!/usr/bin/env node
/*
 * Print the unified package media index: local (FLUX images, Wan2.2 videos)
 * and manually imported external (GPT images, KlingAI videos) media together,
 * each with explicit provenance. Read-only.
 *
 * Usage:
 *   node scripts/index-package-media.js --package <abs-path-or-id> [--json]
 */

const { buildPackageMediaIndex } = require('../package-media-index.js');
const { resolvePackageDir } = require('../manual-media-import.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') out.package = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.packagesRoot = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.package) {
    console.log('Usage: node scripts/index-package-media.js --package <abs-path-or-id> [--json]');
    process.exit(opts.help ? 0 : 1);
  }
  let dir;
  try {
    dir = resolvePackageDir(opts.package, opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  const index = buildPackageMediaIndex(dir);
  if (opts.json) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }
  const c = index.counts;
  console.log(`Package: ${index.package}`);
  console.log(`Images: ${c.images_total} (local ${c.images_local} · external ${c.images_external})`);
  console.log(`Videos: ${c.videos_total} (local ${c.videos_local} · external ${c.videos_external})`);
  for (const m of index.images.concat(index.videos)) {
    console.log(`  [${m.media_type}] ${m.path}  ${m.generation_mode}/${m.generation_provider}@${m.generation_host}`);
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
