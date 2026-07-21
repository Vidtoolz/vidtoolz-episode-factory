#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Read/write behavior: READ-ONLY.
 * This script must not create, modify, delete, rename, or move package-run files,
 * package-run-state.md, approval markers, media files, generated indexes, or docs.
 * If future behavior needs writes, create a separate mutating script or add an
 * explicit MUTATES header and update the read/write guard test in the same PR.
 */

// B2 Earth Studio proof evidence checker (2026-07-21).
//
// Audits one Earth Studio lane directory (<package>/earth-studio/) against the
// B2 proof evidence contract WITHOUT executing anything in the pipeline: it
// never renders, never stages, never touches the .esp, never modifies frames.
// It exists so the supervised proof run (see
// reports/handoffs/b2-earth-studio-supervised-proof-handoff-2026-07-21.md and
// ~/outputs/b2-proof-protocol-2026-07-21.md) produces deterministic, auditable
// evidence at each phase:
//
//   baseline  — untouched .esp present, hashed; job metadata consistent
//   frames    — manual Earth Studio export landed: count, continuity, dims
//   mp4       — Frames -> MP4 lane output: hash + ffprobe cross-check
//   staged    — VIDNAS sandbox copy: containment + byte-identity
//
// A phase that has not happened yet reports PENDING (exit 0) — "not run yet"
// is not a failure. A contradiction (wrong count, gap, hash mismatch,
// containment breach) reports FAIL (exit 1). --require-complete turns PENDING
// mandatory evidence into FAIL for the final audit. Usage errors exit 2.
//
// Usage:
//   node scripts/verify-earth-studio-proof.js --package-dir package-runs/2026-06-27-london-proof \
//     [--expected-frames 210] [--expected-fps 30] [--expected-duration 7] \
//     [--staged /path/to/staged.mp4] [--require-complete] [--json]
//   node scripts/verify-earth-studio-proof.js --package-id <aigen-package-id> ...
//
// Path safety: the package dir must realpath-resolve inside an allowed root —
// the repo's package-runs/ or the aigen script-packages root (same roots the
// server uses). Symlinked frame files are refused, not followed.

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const lane = require("../earth-studio-lane.js");

const REPO_ROOT = path.join(__dirname, "..");
const VIDNAS_AIGEN_ROOT = "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen";
// Same guard the lane applies before staging (earth-studio-lane.js stageToVidnas).
const APPROVED_MEDIA_PATTERN = /v\d+-approved|v1-approved|03_SHARED_MEDIA_LIBRARY\/.*approved/i;

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function parseArgs(argv) {
  const args = {
    packageDir: null,
    packageId: null,
    expectedFrames: null,
    expectedFps: null,
    expectedDuration: null,
    staged: null,
    stageRoot: lane.VIDNAS_STAGE_DIR,
    json: false,
    requireComplete: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw usageError(`${a} requires a value.`);
      return argv[i];
    };
    if (a === "--package-dir") args.packageDir = next();
    else if (a === "--package-id") args.packageId = next();
    else if (a === "--expected-frames") args.expectedFrames = Number(next());
    else if (a === "--expected-fps") args.expectedFps = Number(next());
    else if (a === "--expected-duration") args.expectedDuration = Number(next());
    else if (a === "--staged") args.staged = next();
    else if (a === "--stage-root") args.stageRoot = next();
    else if (a === "--json") args.json = true;
    else if (a === "--require-complete") args.requireComplete = true;
    else if (a === "--help" || a === "-h") { args.help = true; }
    else throw usageError(`Unknown argument: ${a}`);
  }
  for (const key of ["expectedFrames", "expectedFps", "expectedDuration"]) {
    if (args[key] !== null && (!Number.isFinite(args[key]) || args[key] <= 0)) {
      throw usageError(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a positive number.`);
    }
  }
  return args;
}

function allowedRoots() {
  const scriptPackages = process.env.AIGEN_SCRIPT_PACKAGES || path.join(VIDNAS_AIGEN_ROOT, "script-packages");
  const roots = [path.join(REPO_ROOT, "package-runs"), scriptPackages];
  const resolved = [];
  for (const root of roots) {
    try { resolved.push(fs.realpathSync(root)); } catch (_) { /* unmounted/absent root is simply not usable */ }
  }
  return resolved;
}

function resolvePackageDir(args) {
  let candidate;
  if (args.packageId) {
    if (!/^[A-Za-z0-9._-]+$/.test(args.packageId) || args.packageId.includes("..")) {
      throw usageError("Invalid --package-id.");
    }
    const scriptPackages = process.env.AIGEN_SCRIPT_PACKAGES || path.join(VIDNAS_AIGEN_ROOT, "script-packages");
    candidate = path.join(scriptPackages, args.packageId);
  } else if (args.packageDir) {
    candidate = path.resolve(REPO_ROOT, args.packageDir);
  } else {
    throw usageError("Provide --package-dir <path> or --package-id <aigen-package-id>.");
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw usageError(`Package directory does not exist: ${candidate}`);
  }
  const real = fs.realpathSync(candidate);
  const roots = allowedRoots();
  const inside = roots.some((root) => real === root || real.startsWith(root + path.sep));
  if (!inside) {
    throw usageError(`Refusing package dir outside allowed roots (${roots.join(", ") || "none available"}): ${real}`);
  }
  return real;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Dependency-free image header probes (read-only, first bytes only).
function pngDimensions(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1];
    // SOF0-SOF15 except DHT(C4)/JPG(C8)/DAC(CC) carry frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function imageDimensions(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, read);
    return pngDimensions(head) || jpegDimensions(head);
  } finally {
    fs.closeSync(fd);
  }
}

function trailingNumber(name) {
  const stem = name.replace(/\.[^.]+$/, "");
  const match = stem.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}

function ffprobeMp4(filePath) {
  const probe = childProcess.spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,nb_frames",
    "-show_entries", "format=duration",
    "-of", "json", filePath,
  ], { encoding: "utf8", timeout: 30000 });
  if (probe.error || probe.status !== 0) {
    return { available: false, reason: probe.error ? probe.error.message : (probe.stderr || "ffprobe failed").trim() };
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const video = (parsed.streams || []).find((s) => s.codec_type === "video") || null;
    const audio = (parsed.streams || []).filter((s) => s.codec_type === "audio").length;
    let fps = null;
    if (video && video.r_frame_rate && /^\d+\/\d+$/.test(video.r_frame_rate)) {
      const [num, den] = video.r_frame_rate.split("/").map(Number);
      if (den > 0) fps = num / den;
    }
    return {
      available: true,
      codec: video ? video.codec_name : null,
      pix_fmt: video ? video.pix_fmt : null,
      width: video ? video.width : null,
      height: video ? video.height : null,
      fps,
      nb_frames: video && video.nb_frames ? Number(video.nb_frames) : null,
      duration_s: parsed.format && parsed.format.duration ? Number(parsed.format.duration) : null,
      audio_streams: audio,
    };
  } catch (error) {
    return { available: false, reason: `ffprobe output unparsable: ${error.message}` };
  }
}

function gitEvidence() {
  const run = (cmdArgs) => childProcess.spawnSync("git", cmdArgs, { cwd: REPO_ROOT, encoding: "utf8", timeout: 15000 });
  const head = run(["rev-parse", "HEAD"]);
  const dirty = run(["status", "--porcelain"]);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty_files: dirty.status === 0 ? dirty.stdout.split("\n").filter(Boolean).length : null,
  };
}

function audit(args) {
  const packageDir = resolvePackageDir(args);
  const laneDir = lane.laneDir(packageDir);
  const failures = [];
  const warnings = [];
  const checks = [];
  const phases = { baseline: "ok", frames: "pending", mp4: "pending", staged: "pending" };
  const record = (phase, name, ok, detail) => {
    checks.push({ phase, name, ok, detail: detail || null });
    if (!ok) {
      failures.push(`${phase}: ${name}${detail ? ` — ${detail}` : ""}`);
      phases[phase] = "fail";
    }
  };

  // ── baseline ──────────────────────────────────────────────────────────────
  const result = {
    package_dir: packageDir,
    lane_dir: laneDir,
    esp: null,
    job: null,
    expected: null,
    frames: null,
    mp4: null,
    staged: null,
    git: gitEvidence(),
    generated_at: new Date().toISOString(),
  };

  if (!fs.existsSync(laneDir)) {
    record("baseline", "lane dir exists", false, `${laneDir} missing — no Earth Studio job in this package`);
    return { result, phases, failures, warnings, checks };
  }
  const espPath = path.join(laneDir, "earth-studio.esp");
  if (fs.existsSync(espPath)) {
    result.esp = { path: espPath, sha256: sha256File(espPath), bytes: fs.statSync(espPath).size };
    record("baseline", "untouched .esp present + hashed", true);
  } else {
    record("baseline", ".esp present", false, `${espPath} missing`);
  }
  record("baseline", "shot-plan.json present", fs.existsSync(path.join(laneDir, "shot-plan.json")), "shot-plan.json missing");

  const job = lane.readJob(packageDir);
  result.job = job;
  if (!job) {
    record("baseline", "job.json readable", false, "job.json missing or unparsable");
    return { result, phases, failures, warnings, checks };
  }
  const fps = Number(job.frame_rate) || null;
  const totalFrames = Number(job.total_frames) || null;
  const durationS = Number(job.total_duration_seconds) || null;
  if (fps && totalFrames && durationS) {
    record("baseline", "job metadata internally consistent", totalFrames === fps * durationS,
      `total_frames ${totalFrames} != frame_rate ${fps} × duration ${durationS}`);
  }
  const expected = {
    frames: args.expectedFrames != null ? args.expectedFrames : totalFrames,
    fps: args.expectedFps != null ? args.expectedFps : fps,
    duration_s: args.expectedDuration != null ? args.expectedDuration : durationS,
  };
  result.expected = expected;
  if (args.expectedFrames != null && totalFrames != null) {
    record("baseline", "expected frames matches job.json", args.expectedFrames === totalFrames,
      `--expected-frames ${args.expectedFrames} vs job total_frames ${totalFrames}`);
  }
  if (args.expectedFps != null && fps != null) {
    record("baseline", "expected fps matches job.json", args.expectedFps === fps,
      `--expected-fps ${args.expectedFps} vs job frame_rate ${fps}`);
  }
  if (args.expectedDuration != null && durationS != null) {
    record("baseline", "expected duration matches job.json", args.expectedDuration === durationS,
      `--expected-duration ${args.expectedDuration} vs job total_duration_seconds ${durationS}`);
  }

  // ── frames ────────────────────────────────────────────────────────────────
  const framesDir = path.join(laneDir, "frames");
  const frameFiles = fs.existsSync(framesDir)
    ? fs.readdirSync(framesDir).filter((f) => ["jpeg", "jpg", "png"].includes(path.extname(f).slice(1).toLowerCase())).sort()
    : [];
  if (frameFiles.length === 0) {
    result.frames = { count: 0, status: "not run yet — Earth Studio export has not landed in frames/" };
  } else {
    phases.frames = "ok";
    const byExt = new Map();
    for (const f of frameFiles) {
      const ext = path.extname(f).slice(1).toLowerCase();
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
    }
    // The render lane globs ONE extension (first of jpeg/jpg/png present) —
    // mixed extensions mean silently ignored frames, which is a contradiction.
    const laneChoice = lane.frameGlob(packageDir);
    if (byExt.size > 1) {
      record("frames", "single frame extension", false,
        `mixed extensions ${JSON.stringify(Object.fromEntries(byExt))} — the render lane would glob only *.${laneChoice ? laneChoice.ext : "?"} and ignore the rest`);
    }
    const symlinked = frameFiles.filter((f) => fs.lstatSync(path.join(framesDir, f)).isSymbolicLink());
    record("frames", "no symlinked frames", symlinked.length === 0, `refusing symlinks: ${symlinked.slice(0, 5).join(", ")}`);

    const numbered = frameFiles.map((f) => ({ name: f, n: trailingNumber(f) }));
    let gaps = [];
    let duplicates = [];
    if (numbered.every((f) => f.n !== null)) {
      const seen = new Map();
      for (const f of numbered) {
        if (seen.has(f.n)) duplicates.push(`${f.name} duplicates #${f.n} (${seen.get(f.n)})`);
        else seen.set(f.n, f.name);
      }
      const nums = [...seen.keys()].sort((a, b) => a - b);
      for (let n = nums[0]; n <= nums[nums.length - 1]; n += 1) {
        if (!seen.has(n)) gaps.push(n);
      }
      record("frames", "no duplicate frame numbers", duplicates.length === 0, duplicates.slice(0, 5).join("; "));
      record("frames", "no gaps in frame sequence", gaps.length === 0,
        `${gaps.length} missing number(s): ${gaps.slice(0, 10).join(", ")}${gaps.length > 10 ? ", …" : ""}`);
    } else {
      warnings.push("frames: filenames carry no usable numeric sequence — continuity judged by count only");
    }

    const dims = new Map();
    let unreadable = [];
    for (const f of frameFiles) {
      if (fs.lstatSync(path.join(framesDir, f)).isSymbolicLink()) continue;
      const d = imageDimensions(path.join(framesDir, f));
      if (!d) { unreadable.push(f); continue; }
      dims.set(`${d.width}x${d.height}`, (dims.get(`${d.width}x${d.height}`) || 0) + 1);
    }
    record("frames", "all frames readable as PNG/JPEG", unreadable.length === 0, `unreadable headers: ${unreadable.slice(0, 5).join(", ")}`);
    record("frames", "uniform frame dimensions", dims.size <= 1, `mixed dimensions ${JSON.stringify(Object.fromEntries(dims))}`);
    if (expected.frames != null) {
      record("frames", "frame count matches expectation", frameFiles.length === expected.frames,
        `found ${frameFiles.length}, expected ${expected.frames}`);
    }
    result.frames = {
      count: frameFiles.length,
      first: frameFiles[0],
      last: frameFiles[frameFiles.length - 1],
      extensions: Object.fromEntries(byExt),
      dimensions: [...dims.keys()],
      gaps: gaps.slice(0, 50),
      duplicates: duplicates.slice(0, 50),
      lane_render_glob: laneChoice ? laneChoice.glob : null,
    };
  }

  // ── mp4 ───────────────────────────────────────────────────────────────────
  const mp4Path = lane.renderPath(packageDir);
  if (!fs.existsSync(mp4Path)) {
    result.mp4 = { path: mp4Path, status: "not run yet — Frames → MP4 lane has not produced this file" };
  } else {
    phases.mp4 = "ok";
    const mp4 = { path: mp4Path, sha256: sha256File(mp4Path), bytes: fs.statSync(mp4Path).size };
    const probe = ffprobeMp4(mp4Path);
    mp4.probe = probe;
    if (!probe.available) {
      warnings.push(`mp4: ffprobe unavailable/failed (${probe.reason}) — stream checks skipped, hash still recorded`);
    } else {
      record("mp4", "video stream present", Boolean(probe.codec), "no video stream");
      if (expected.fps != null && probe.fps != null) {
        record("mp4", "frame rate matches expectation", Math.abs(probe.fps - expected.fps) < 0.01,
          `ffprobe ${probe.fps} vs expected ${expected.fps}`);
      }
      if (expected.frames != null && probe.nb_frames != null) {
        record("mp4", "frame count matches expectation", probe.nb_frames === expected.frames,
          `ffprobe nb_frames ${probe.nb_frames} vs expected ${expected.frames}`);
      }
      if (expected.duration_s != null && probe.duration_s != null) {
        record("mp4", "duration matches expectation", Math.abs(probe.duration_s - expected.duration_s) <= 0.35,
          `ffprobe ${probe.duration_s}s vs expected ${expected.duration_s}s`);
      }
      if (probe.audio_streams > 0) warnings.push(`mp4: ${probe.audio_streams} audio stream(s) present — the lane renders silent video`);
    }
    result.mp4 = mp4;
  }

  // ── staged ────────────────────────────────────────────────────────────────
  let stagedPath = args.staged ? path.resolve(args.staged) : null;
  if (!stagedPath) {
    const projectId = path.basename(packageDir);
    const slug = (job && job.slug) || "map-animation";
    const candidate = path.join(args.stageRoot, `${projectId}-${slug}.mp4`);
    if (fs.existsSync(candidate)) stagedPath = candidate;
  }
  if (!stagedPath || !fs.existsSync(stagedPath)) {
    result.staged = { status: "not run yet — no staged copy found", searched: stagedPath || path.join(args.stageRoot, "<package>-<slug>.mp4") };
  } else {
    phases.staged = "ok";
    const staged = { path: stagedPath, sha256: sha256File(stagedPath), bytes: fs.statSync(stagedPath).size };
    let stageRootReal = null;
    try { stageRootReal = fs.realpathSync(args.stageRoot); } catch (_) { /* recorded below */ }
    const stagedReal = fs.realpathSync(stagedPath);
    record("staged", "staged copy inside the sandbox stage root", Boolean(stageRootReal) && stagedReal.startsWith(stageRootReal + path.sep),
      `${stagedReal} is not under ${args.stageRoot}`);
    record("staged", "staged path is not approved media", !APPROVED_MEDIA_PATTERN.test(stagedReal), stagedReal);
    if (result.mp4 && result.mp4.sha256) {
      record("staged", "staged copy byte-identical to local MP4", staged.sha256 === result.mp4.sha256,
        `staged ${staged.sha256.slice(0, 12)}… vs local ${result.mp4.sha256.slice(0, 12)}…`);
    } else {
      record("staged", "local MP4 exists for comparison", false, "staged copy exists but the local render is missing — cannot prove provenance");
    }
    result.staged = staged;
  }

  if (args.requireComplete) {
    for (const [phase, status] of Object.entries(phases)) {
      if (status === "pending") {
        failures.push(`${phase}: mandatory evidence missing (--require-complete)`);
        phases[phase] = "fail";
      }
    }
  }

  return { result, phases, failures, warnings, checks };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode || 2);
  }
  if (args.help) {
    console.log("See header comment for usage. Read-only: audits Earth Studio proof evidence, never mutates it.");
    process.exit(0);
  }
  let out;
  try {
    out = audit(args);
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode || 2);
  }
  const { result, phases, failures, warnings, checks } = out;
  const ok = failures.length === 0;
  if (args.json) {
    console.log(JSON.stringify({ ok, phases, failures, warnings, checks, ...result }, null, 2));
  } else {
    console.log(`Earth Studio proof evidence — ${result.package_dir}`);
    if (result.esp) console.log(`  .esp  ${result.esp.sha256}  (${result.esp.bytes} bytes)`);
    for (const c of checks) console.log(`  ${c.ok ? " ok " : "FAIL"} [${c.phase}] ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ""}`);
    for (const [phase, status] of Object.entries(phases)) {
      if (status === "pending") console.log(`  PEND [${phase}] not run yet`);
    }
    for (const w of warnings) console.log(`  WARN ${w}`);
    console.log(ok
      ? `PASS — phases: ${Object.entries(phases).map(([k, v]) => `${k}=${v}`).join(" ")}`
      : `FAIL — ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { audit, parseArgs, imageDimensions, trailingNumber, APPROVED_MEDIA_PATTERN };
