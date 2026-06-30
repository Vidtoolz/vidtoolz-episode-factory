#!/usr/bin/env node
/*
 * Import manually generated external videos (e.g. KlingAI image-to-video) into a
 * package's media flow with manual_external provenance.
 *
 * No automation, no external calls — it only indexes files Mikko has already
 * downloaded and dropped into the package's imports/manual-videos/ folder.
 * Validation uses ffprobe if present; missing metadata becomes a warning, not a
 * rejection. Local PRESTO/Wan2.2 clips in videos/mp4/ are never touched.
 *
 * Usage:
 *   node scripts/import-manual-videos.js --package <abs-path-or-id> [--dry-run]
 *        [--provider klingai_manual|unknown_manual] [--prompt-index N] [--drop-dir <path>]
 */

const childProcess = require('child_process');
const { importManualMedia } = require('../manual-media-import.js');

// Minimal ffprobe wrapper returning the shape media-provenance.validateVideo expects.
function ffprobe(filePath) {
  const result = childProcess.spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8', timeout: 8000 },
  );
  if (result.error || result.status !== 0 || !result.stdout) {
    return { metadataUnavailable: true };
  }
  let payload;
  try { payload = JSON.parse(result.stdout); } catch (e) { return { metadataUnavailable: true }; }
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((s) => s.codec_type === 'video') || {};
  const audioPresent = streams.some((s) => s.codec_type === 'audio');
  let frameRate = null;
  const rate = video.avg_frame_rate || video.r_frame_rate || '';
  if (/^\d+\/\d+$/.test(rate)) {
    const [n, d] = rate.split('/').map(Number);
    if (d) frameRate = Math.round((n / d) * 1000) / 1000;
  } else if (rate) {
    frameRate = Number(rate) || null;
  }
  return {
    duration: payload.format && payload.format.duration ? Math.round(Number(payload.format.duration) * 100) / 100 : null,
    codec: video.codec_name || null,
    resolution: video.width && video.height ? `${video.width}x${video.height}` : null,
    frameRate,
    audioPresent,
    metadataUnavailable: false,
  };
}

function parseArgs(argv) {
  const out = { kind: 'video', ffprobe };
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
    console.log('Usage: node scripts/import-manual-videos.js --package <abs-path-or-id> [--dry-run] [--provider klingai_manual|unknown_manual] [--prompt-index N] [--drop-dir <path>]');
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
  console.log(`${opts.dryRun ? 'DRY-RUN' : 'IMPORT'} manual videos -> ${result.destDir}`);
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

module.exports = { parseArgs, ffprobe };
