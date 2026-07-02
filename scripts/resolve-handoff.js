#!/usr/bin/env node
/*
 * Prepare (or dry-run) a DaVinci Resolve assembly handoff for a package run,
 * choosing an explicit video variant / source folder under videos/<variant>/.
 *
 * The default variant is "mp4" (the legacy fast Wan2.2 clips) for backward
 * compatibility. Pass --video-variant mp4-hq-720p to hand off the HQ clips.
 *
 * A --dry-run enumerates exactly which clips WOULD be included from the chosen
 * variant folder and which selections are missing/held, and writes nothing. A
 * real run (no --dry-run) shells out to the aigen assembler and records the
 * chosen variant in resolve-handoff/media-manifest.json.
 *
 * Usage:
 *   node scripts/resolve-handoff.js --package <id> [--video-variant <name>] \
 *        [--dry-run] [--exclude 21,22]
 *
 * Examples:
 *   # Dry-run the HQ handoff for a project (writes nothing):
 *   node scripts/resolve-handoff.js --package why-i-...-20260630 \
 *        --video-variant mp4-hq-720p --dry-run
 */

"use strict";

const server = require("../package-engine-server.js");

function parseArgs(argv) {
  const out = { videoVariant: undefined, dryRun: false, exclude: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--package") out.package = argv[++i];
    else if (a === "--video-variant" || a === "--variant") out.videoVariant = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--exclude" || a === "--exclude-indexes") out.exclude = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

const USAGE =
  "Usage: node scripts/resolve-handoff.js --package <id> " +
  "[--video-variant <name>] [--dry-run] [--exclude 21,22] [--json]";

function clipLine(item) {
  const idx = String(item.prompt_index).padStart(3, "0");
  return `    - ${idx}  ${item.label || ""}  (${item.mp4_rel || "no path"})`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.package) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
    return;
  }

  let result;
  try {
    result = await server.runResolveAssemblyCreate(opts.package, {
      videoVariant: opts.videoVariant,
      dryRun: opts.dryRun,
      excludeIndexes: opts.exclude,
    });
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(error.statusCode ? 1 : 1);
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (result.dry_run) {
    console.log(`Resolve handoff DRY-RUN for package: ${result.package_id}`);
    console.log(`  chosen video variant: ${result.video_variant}`);
    console.log(`  source folder:        ${result.video_dir}/`);
    console.log(`  selections:           ${result.selection_count}`);
    console.log(`  would include ${result.included_clips.length} clip(s):`);
    result.included_clips.forEach((item) => console.log(clipLine(item)));
    if (result.excluded_clips.length) {
      console.log(`  explicitly excluded ${result.excluded_clips.length} clip(s):`);
      result.excluded_clips.forEach((item) => console.log(clipLine(item)));
    }
    if (result.missing_clips.length) {
      console.log(`  MISSING / held ${result.missing_clips.length} clip(s) (not in ${result.video_dir}/):`);
      result.missing_clips.forEach((item) => console.log(clipLine(item)));
      console.log("  -> a real run is blocked until these are rendered or explicitly --exclude'd.");
    } else {
      console.log("  no missing clips: a real run would proceed.");
    }
    console.log(`  would write (only on a real run): ${result.would_write.join(", ")}`);
    console.log("  wrote: no (dry-run)");
    process.exit(0);
    return;
  }

  if (result.ok) {
    console.log(`Resolve handoff created for package: ${result.package_id}`);
    console.log(`  video variant: ${result.video_variant} (${result.video_dir}/)`);
    console.log(`  files: ${result.files.join(", ")}`);
    console.log(`  variant recorded in manifest: ${result.manifest_variant_recorded ? "yes" : "no"}`);
    if (result.excluded_indexes && result.excluded_indexes.length) {
      console.log(`  excluded indexes: ${result.excluded_indexes.join(", ")}`);
    }
    process.exit(0);
    return;
  }

  console.error(`FAILED: ${result.error}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
