#!/usr/bin/env node
"use strict";

/*
 * VIDTOOLZ script safety
 * Read/write behavior: MUTATES (acceptance proof package only).
 * This script creates and updates ONE Earth Studio v0.4 acceptance proof
 * package (plan artifacts, acceptance manifests, validation records, hashes,
 * report). It never touches any other package-run, never touches the pinned
 * 2026-06-27 London proof (hard refusal), never writes approval markers or
 * package-run state, and never contacts Google / Earth Studio / the network.
 */

// Earth Studio v0.4 real-world acceptance workflow (2026-08-07).
//
// v0.4's grammar, gazetteer, and camera keyframe engine are internally
// well-tested, but internal green is NOT external proof: the generated .esp
// follows OUR model of Earth Studio's import/playback semantics, and Earth
// Studio itself is browser-only with no API. This tool automates everything
// around the one manual browser step and keeps the evidence honest:
//
//   generate          — build the canonical diagnostic acceptance package
//                       (real Helsinki→Paris flight, explicit altitude+tilt,
//                       2× counterclockwise orbit, zoom-out to space, 9:16)
//                       via the SAME production write path the GUI uses
//                       (earth-studio-lane writeJob), plus acceptance
//                       manifest, per-segment diagnostics, a one-screen
//                       import checklist, and an observation template.
//   check             — pre-import semantic assertions on the generated .esp:
//                       proves exactly what we intend to send Earth Studio.
//                       Passing `check` is INTERNAL verification only.
//   ingest-observation— validate the human's structured import-observation
//                       record (the ONLY authority on Earth Studio behavior).
//   validate-frames   — audit the real Earth Studio frame export window
//                       before rendering (format, numbering, dimensions).
//   render            — run the PRODUCTION frames→MP4 path (lane.startRender,
//                       real ffmpeg) on the real frames, then ffprobe.
//   hash              — SHA-256 every proof artifact into hashes.sha256.
//   status            — compute the verification state machine and write
//                       acceptance-report.md.
//
// Verification states (docs/earth-studio-map-animation.md):
//   NOT_GENERATED → INTERNAL_VERIFIED → EARTH_STUDIO_IMPORT_VERIFIED →
//   END_TO_END_VERIFIED   (failure states: INTERNAL_CHECKS_FAILED,
//   IMPORT_DISCREPANCY_REPORTED)
//
// Usage:
//   node scripts/earth-studio-v04-acceptance.js <command> [--package-dir p]
//     [--min-frames N] [--force] [--json]

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const lane = require("../earth-studio-lane.js");
const planner = require("../earth-studio-job-planner.js");
const proofChecker = require("./verify-earth-studio-proof.js");

const REPO_ROOT = path.join(__dirname, "..");
const VIDNAS_AIGEN_ROOT = "/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen";
const LONDON_PROOF_DIR = path.join(REPO_ROOT, "package-runs", "2026-06-27-london-proof");

const PROOF_ID = "2026-08-07-earth-studio-v04-acceptance";
const DEFAULT_PACKAGE_DIR = path.join(REPO_ROOT, "package-runs", PROOF_ID);
const JOB_NAME = "v0.4 Real Import Paris";
const ASPECT = "9:16";
// Canonical diagnostic instruction. Deliberately a REAL geographic flight
// (Helsinki → Paris, ~1,910 km, triggers the long-flight arc) followed by the
// v0.4 behaviors most likely to expose wrong semantics: explicit altitude,
// explicit tilt, location carry-over, a multi-revolution counterclockwise
// orbit (accumulated pan + target-facing heading), and a zoom-out to space.
// Durations are intelligible-pace explicit values: round 2's real playback
// proved the original fast pacing "unusable — too fast to be intelligible".
const INSTRUCTION = "fly to Helsinki in 5 seconds, then fly to Paris at 2 km tilted 35 degrees in 18 seconds, then orbit twice counterclockwise for 24 seconds, then zoom out to space in 12 seconds";
// Real-export window: 90 frames ending 30 frames into the zoom-out, so the
// window spans genuine motion INCLUDING an action boundary (orbit → zoom).
function exportWindow(plan) {
  const zoom = plan.segments[plan.segments.length - 1];
  return { start: Math.max(0, zoom.start_frame - 60), end: zoom.start_frame + 29 };
}
const DEFAULT_MIN_FRAMES = 50;

const ACCEPTANCE_DIR = "acceptance";
const FILES = {
  manifest: path.join(ACCEPTANCE_DIR, "manifest.json"),
  expected: path.join(ACCEPTANCE_DIR, "expected.json"),
  checklist: path.join(ACCEPTANCE_DIR, "import-checklist.md"),
  observationTemplate: path.join(ACCEPTANCE_DIR, "import-observation.template.json"),
  observation: path.join(ACCEPTANCE_DIR, "import-observation.json"),
  framesValidation: path.join(ACCEPTANCE_DIR, "frames-validation.json"),
  renderResult: path.join(ACCEPTANCE_DIR, "render-result.json"),
  hashes: path.join(ACCEPTANCE_DIR, "hashes.sha256"),
  report: path.join(ACCEPTANCE_DIR, "acceptance-report.md"),
};

// ── path safety ──────────────────────────────────────────────────────────────

function usageError(message) { const e = new Error(message); e.exitCode = 2; return e; }

function allowedRoots() {
  const scriptPackages = process.env.AIGEN_SCRIPT_PACKAGES || path.join(VIDNAS_AIGEN_ROOT, "script-packages");
  const roots = [];
  for (const root of [path.join(REPO_ROOT, "package-runs"), scriptPackages]) {
    try { roots.push(fs.realpathSync(root)); } catch (_) { /* absent root unusable */ }
  }
  return roots;
}

// Resolve (and on generate, create) the proof package dir inside an allowed
// root. The pinned London proof is hard-refused: its historical value is that
// it records pre-v0.4 generator behavior byte-for-byte.
function resolvePackageDir(packageDirArg, { create = false } = {}) {
  const candidate = path.resolve(REPO_ROOT, packageDirArg || DEFAULT_PACKAGE_DIR);
  if (create) fs.mkdirSync(candidate, { recursive: true });
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw usageError(`Package directory does not exist: ${candidate} (run generate first)`);
  }
  const real = fs.realpathSync(candidate);
  const roots = allowedRoots();
  if (!roots.some((root) => real === root || real.startsWith(root + path.sep))) {
    throw usageError(`Refusing package dir outside allowed roots (${roots.join(", ") || "none"}): ${real}`);
  }
  let london = null;
  try { london = fs.realpathSync(LONDON_PROOF_DIR); } catch (_) { /* absent */ }
  if (london && (real === london || real.startsWith(london + path.sep))) {
    throw usageError("Refusing to operate on the pinned 2026-06-27 London proof — it must stay byte-identical.");
  }
  return real;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function gitHead() {
  const r = childProcess.spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 15000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ── geometry helpers (assertion-side mirrors of the engine math) ────────────

function toRadians(d) { return (d * Math.PI) / 180; }
function toDegrees(r) { return (r * 180) / Math.PI; }

function initialBearing(from, to) {
  const p1 = toRadians(from.latitude);
  const p2 = toRadians(to.latitude);
  const dl = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function angleDelta(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

function trackValueAt(keyframes, time) {
  if (!keyframes.length) return null;
  if (time <= keyframes[0].time) return keyframes[0].value;
  for (let i = 1; i < keyframes.length; i += 1) {
    if (time <= keyframes[i].time) {
      const a = keyframes[i - 1];
      const b = keyframes[i];
      if (b.time === a.time) return b.value;
      return a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time);
    }
  }
  return keyframes[keyframes.length - 1].value;
}

// Parse the REAL .esp format (planner v0.5+, reverse-engineered modelVersion
// 17) back into absolute-value tracks keyed by frame. Assertions therefore
// verify the normalization round-trip: what Earth Studio will reconstruct,
// not what the engine intended to write.
//   time: fraction of scene duration → frames
//   longitude: min + v·(180−min)   latitude: min + v·(90−min)
//   altitude: v ÷ 1.5356706349899208e-08   tilt: v·180 (rotationY)
//   pan: min + v·(max−min) (rotationX)
const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08;

function espTracks(esp) {
  const scene = esp.scenes[0];
  const duration = scene.duration || (esp.settings && esp.settings.duration) || 1;
  const cam = scene.attributes.find((a) => a.type === "cameraGroup");
  const pos = cam.attributes.find((a) => a.type === "cameraPositionGroup");
  const rot = cam.attributes.find((a) => a.type === "cameraRotationGroup");
  const get = (group, type, denormalize) => {
    const attr = group.attributes.find((a) => a.type === type);
    if (!attr || !attr.keyframes) return [];
    return attr.keyframes.map((k) => ({ time: Math.round(k.time * duration), value: denormalize(k.value, attr.value || {}) }));
  };
  return {
    lng: get(pos, "longitude", (v, meta) => (meta.minValueRange ?? -180) + v * (180 - (meta.minValueRange ?? -180))),
    lat: get(pos, "latitude", (v, meta) => (meta.minValueRange ?? -90) + v * (90 - (meta.minValueRange ?? -90))),
    alt: get(pos, "altitude", (v) => v / ESP_ALTITUDE_SCALE),
    tilt: get(rot, "rotationY", (v) => v * 180),
    pan: get(rot, "rotationX", (v, meta) => (meta.minValueRange ?? 0) + v * ((meta.maxValueRange ?? 360) - (meta.minValueRange ?? 0))),
  };
}

function inWindow(keyframes, startFrame, endFrame, { excludeStart = false } = {}) {
  return keyframes.filter((k) => (excludeStart ? k.time > startFrame : k.time >= startFrame) && k.time <= endFrame);
}

// ── generate ─────────────────────────────────────────────────────────────────

function cameraStateAt(tracks, frame) {
  return {
    frame,
    latitude: trackValueAt(tracks.lat, frame),
    longitude: trackValueAt(tracks.lng, frame),
    altitude_m: trackValueAt(tracks.alt, frame),
    pan_deg: trackValueAt(tracks.pan, frame),
    tilt_deg: trackValueAt(tracks.tilt, frame),
  };
}

function buildExpected(plan, esp) {
  const tracks = espTracks(esp);
  const segments = plan.segments.map((seg) => {
    const window = { start_frame: seg.start_frame, end_frame: seg.end_frame };
    const keyframeCounts = Object.fromEntries(
      Object.entries(tracks).map(([name, kfs]) => [name, inWindow(kfs, seg.start_frame, seg.end_frame, { excludeStart: seg.segment_id !== 1 }).length])
    );
    const altSamples = inWindow(tracks.alt, seg.start_frame, seg.end_frame).map((k) => k.value);
    return {
      segment_id: seg.segment_id,
      action: seg.action,
      source_text: seg.source_text,
      location: seg.location ? { name: seg.location.name, latitude: seg.location.latitude, longitude: seg.location.longitude, source: seg.location.source } : null,
      duration_seconds: seg.duration_seconds,
      duration_source: seg.duration_source,
      altitude_m: seg.altitude_m,
      altitude_source: seg.altitude_source,
      tilt_deg: seg.tilt_deg,
      tilt_source: seg.tilt_source,
      orbit_degrees: seg.orbit_degrees || null,
      orbit_direction: seg.orbit_direction || null,
      window,
      start_state: cameraStateAt(tracks, seg.start_frame),
      end_state: cameraStateAt(tracks, seg.end_frame),
      keyframes_in_window: keyframeCounts,
      peak_altitude_m: altSamples.length ? Math.max(...altSamples) : null,
      notes: seg.notes || [],
    };
  });
  return {
    proof_id: PROOF_ID,
    planner_version: planner.VERSION,
    instruction: plan.source_description,
    aspect: plan.aspect,
    render_dimensions: plan.render_dimensions,
    frame_rate: plan.frame_rate,
    total_frames: plan.total_frames,
    total_duration_seconds: plan.total_duration_seconds,
    keyframe_totals: Object.fromEntries(Object.entries(tracks).map(([name, kfs]) => [name, kfs.length])),
    segments,
  };
}

function observationTemplate() {
  return {
    _instructions: "Fill after the REAL Google Earth Studio import (see import-checklist.md). Save as import-observation.json in this folder. Booleans must be true/false, not strings. Preserve raw notes verbatim — a failed observation is valuable evidence.",
    observedAt: null,
    observer: "Mikko",
    importSucceeded: null,
    earthStudioWarnings: [],
    flight: { correct: null, notes: "" },
    orbit: { correct: null, directionCorrect: null, targetFacing: null, revolutionsObserved: null, notes: "" },
    zoom: { correct: null, notes: "" },
    tilt: { correct: null, notes: "" },
    aspectRatio: { correct: null, notes: "" },
    rawNotes: "",
  };
}

function buildChecklist(plan) {
  const espPath = path.join("earth-studio", "earth-studio.esp");
  return `# Earth Studio v0.4 real-import acceptance — the one manual step

Everything below MUST happen in the real Google Earth Studio browser app.
This is the only externally authoritative test of the v0.4 camera engine.

Project: **${JOB_NAME}** · ${plan.total_frames} frames @ ${plan.frame_rate} fps · ${plan.aspect} (${plan.render_dimensions.width}x${plan.render_dimensions.height})
Instruction: \`${INSTRUCTION}\`

## 1 · Import
1. Open https://earth.google.com/studio/ (manual Google login).
2. File → Import → Earth Studio project → pick \`${espPath}\` from this folder.
3. Note whether the import succeeds, warns, silently changes values, or fails.

## 2 · Play the full animation and check
First sanity-check the timeline itself: it must read **${plan.total_frames} frames
(${plan.total_duration_seconds}s @ ${plan.frame_rate} fps)** — anything shorter means Earth Studio
reinterpreted the project duration and pacing will be wrong; report that.
- **A Flight** (frames 0–${plan.segments[1].end_frame}): starts high over Helsinki, descends; then flies
  Helsinki → Paris rising in a high arc (never skimming ground); ends over
  Paris at ~2 km, tilted ~35° from straight-down; no backwards jumps.
- **B Orbit** (frames ${plan.segments[2].start_frame}–${plan.segments[2].end_frame}): camera physically circles Paris TWICE with
  Paris staying centered (not a stationary heading spin); second revolution
  continues from the first (no reset). Direction note: the generator's
  "counterclockwise" = pan DECREASING — record the direction you actually see.
- **C Zoom-out** (frames ${plan.segments[3].start_frame}–${plan.segments[3].end_frame}): starts from the final orbit position with
  no static pause or snap, pulls smoothly away to a space-scale globe view.
- **D Composition**: the project/viewport is genuinely vertical 9:16
  (1080×1920) and Paris framing is usable vertically.

## 3 · Record
Copy \`acceptance/import-observation.template.json\` →
\`acceptance/import-observation.json\`, fill every field, save.

## 4 · Export real frames (only if playback is acceptable)
1. In Earth Studio: Render → image sequence, frames **${exportWindow(plan).start}–${exportWindow(plan).end}**
   (~${exportWindow(plan).end - exportWindow(plan).start + 1} frames spanning the orbit → zoom-out boundary), full ${plan.render_dimensions.width}x${plan.render_dimensions.height}.
2. Put the exported images (unzipped, no subfolders) into \`earth-studio/frames/\`.

## 5 · Back on vidnux
\`\`\`bash
cd ~/vidtoolz-episode-factory
node scripts/earth-studio-v04-acceptance.js ingest-observation
node scripts/earth-studio-v04-acceptance.js validate-frames
node scripts/earth-studio-v04-acceptance.js render
node scripts/earth-studio-v04-acceptance.js hash
node scripts/earth-studio-v04-acceptance.js status
\`\`\`
`;
}

function buildPackageReadme() {
  return `# ${PROOF_ID}

Acceptance proof package for the Earth Studio Animator **v0.4** camera engine
(EF c23b90f and descendants). Generated by
\`scripts/earth-studio-v04-acceptance.js\` — see \`acceptance/import-checklist.md\`
for the single manual browser step and \`acceptance/acceptance-report.md\` for
the current verification state.

This package is deliberately SEPARATE from the pinned 2026-06-27 London proof,
which records pre-v0.4 generator behavior and must stay byte-identical.

Policy: \`earth-studio/frames/\` (real Earth Studio export) and
\`earth-studio/renders/\` (production MP4) stay untracked like every other
package-run media payload; \`acceptance/hashes.sha256\` pins their integrity.
`;
}

// A --force regenerate starts a NEW acceptance round: the prior round's real
// evidence (observation, report) plus the exact artifacts it judged (.esp,
// manifest, expected) are archived under acceptance/rounds/<generated_at>/ —
// failed external proofs are valuable and must never be edited in place.
function archivePriorRound(packageDir) {
  let stamp = new Date().toISOString();
  try { stamp = readJson(path.join(packageDir, FILES.manifest)).generated_at || stamp; } catch (_) { /* keep now() */ }
  const roundDir = path.join(packageDir, ACCEPTANCE_DIR, "rounds", stamp.replace(/[:]/g, "-"));
  fs.mkdirSync(roundDir, { recursive: true });
  const preserve = [
    [FILES.observation, "move"],
    [FILES.report, "move"],
    [path.join("earth-studio", "earth-studio.esp"), "copy"],
    [FILES.manifest, "copy"],
    [FILES.expected, "copy"],
  ];
  for (const [rel, mode] of preserve) {
    const src = path.join(packageDir, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(roundDir, path.basename(rel));
    fs.copyFileSync(src, dest);
    if (mode === "move") fs.rmSync(src);
  }
  return roundDir;
}

function generate(packageDirArg, { force = false } = {}) {
  const packageDir = resolvePackageDir(packageDirArg, { create: true });
  const observationPath = path.join(packageDir, FILES.observation);
  let archivedRound = null;
  if (fs.existsSync(observationPath)) {
    if (!force) {
      throw usageError("import-observation.json already exists — refusing to regenerate over real evidence. Use --force only if you intend a NEW acceptance round (prior evidence is archived under acceptance/rounds/).");
    }
    archivedRound = archivePriorRound(packageDir);
  }
  // Production write path — identical to POST /api/earth-studio/plan.
  const writeResult = lane.writeJob(packageDir, { jobName: JOB_NAME, description: INSTRUCTION, aspect: ASPECT });
  const plan = readJson(path.join(packageDir, "earth-studio", "shot-plan.json"));
  const esp = readJson(path.join(packageDir, "earth-studio", "earth-studio.esp"));
  if (plan.unresolved_items.length) {
    throw new Error(`Canonical instruction did not fully resolve: ${JSON.stringify(plan.unresolved_items)}`);
  }
  const expected = buildExpected(plan, esp);
  const manifest = {
    proof_id: PROOF_ID,
    purpose: "Real Google Earth Studio import/playback acceptance of the v0.4 camera engine + real-frame render seam",
    planner_version: planner.VERSION,
    git_head: gitHead(),
    generated_at: plan.generated_at,
    job_name: JOB_NAME,
    instruction: INSTRUCTION,
    aspect: plan.aspect,
    render_dimensions: plan.render_dimensions,
    frame_rate: plan.frame_rate,
    total_frames: plan.total_frames,
    total_duration_seconds: plan.total_duration_seconds,
    export_window: exportWindow(plan),
    esp_sha256: sha256(path.join(packageDir, "earth-studio", "earth-studio.esp")),
    segment_boundaries: plan.segments.map((s) => ({ segment_id: s.segment_id, action: s.action, start_frame: s.start_frame, end_frame: s.end_frame })),
  };
  writeJson(path.join(packageDir, FILES.manifest), manifest);
  writeJson(path.join(packageDir, FILES.expected), expected);
  writeJson(path.join(packageDir, FILES.observationTemplate), observationTemplate());
  fs.writeFileSync(path.join(packageDir, FILES.checklist), buildChecklist(plan));
  fs.writeFileSync(path.join(packageDir, "README.md"), buildPackageReadme());
  return { ok: true, package_dir: packageDir, archived_round: archivedRound, manifest, lane: writeResult };
}

// ── check: pre-import semantic assertions ────────────────────────────────────
// These prove exactly what we are sending Earth Studio. They are INTERNAL
// verification only and never substitute for the real import.

function runSemanticChecks(packageDir) {
  const plan = readJson(path.join(packageDir, "earth-studio", "shot-plan.json"));
  const esp = readJson(path.join(packageDir, "earth-studio", "earth-studio.esp"));
  const tracks = espTracks(esp);
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: ok ? null : String(detail || "") });

  const segs = plan.segments;
  const [flyIn, flight, orbit, zoom] = segs;

  // identity / composition
  record("aspect: plan is 9:16", plan.aspect === "9:16", `plan.aspect=${plan.aspect}`);
  record("aspect: .esp dimensions are 1080x1920", esp.settings && esp.settings.dimensions
    && esp.settings.dimensions.width === 1080 && esp.settings.dimensions.height === 1920,
    esp.settings ? `${esp.settings.dimensions.width}x${esp.settings.dimensions.height}` : "no settings");
  record("esp: real project envelope present (modelVersion, settings, playbackManager)",
    esp.modelVersion === 17 && esp.settings && esp.settings.timeFormat === "frames"
    && esp.playbackManager && esp.playbackManager.range && esp.playbackManager.range.end === plan.total_frames,
    `modelVersion=${esp.modelVersion}`);
  record("esp: frame count and rate match the plan",
    esp.settings && esp.settings.duration === plan.total_frames && esp.settings.frameRate === plan.frame_rate,
    esp.settings ? `esp ${esp.settings.duration}f@${esp.settings.frameRate} vs plan ${plan.total_frames}f@${plan.frame_rate}` : "no settings");
  record("esp: keyframe times are duration fractions in [0,1]",
    (() => {
      const cam = esp.scenes[0].attributes.find((a) => a.type === "cameraGroup");
      const leafs = [];
      cam.attributes.forEach((g) => (g.attributes || []).forEach((a) => { if (a.keyframes) leafs.push(...a.keyframes); }));
      return leafs.length > 0 && leafs.every((k) => k.time >= 0 && k.time <= 1);
    })(), "raw keyframe times outside [0,1]");
  record("plan: all segments resolved", plan.unresolved_items.length === 0, JSON.stringify(plan.unresolved_items));
  record("plan: canonical action sequence", segs.length === 4
    && flyIn.action === "fly_to" && flight.action === "fly_to" && orbit.action === "orbit" && zoom.action === "zoom_out",
    segs.map((s) => s.action).join(","));
  record("plan: explicit altitude + tilt honored on the flight", flight.altitude_m === 2000 && flight.altitude_source === "explicit"
    && flight.tilt_deg === 35 && flight.tilt_source === "explicit",
    `alt=${flight.altitude_m}(${flight.altitude_source}) tilt=${flight.tilt_deg}(${flight.tilt_source})`);
  record("plan: orbit target carried over from the flight", orbit.location && orbit.location.source === "carried_over" && orbit.location_name === "Paris",
    `${orbit.location_name} (${orbit.location && orbit.location.source})`);
  record("plan: orbit is 2 revolutions counterclockwise", orbit.orbit_degrees === 720 && orbit.orbit_direction === -1,
    `${orbit.orbit_degrees}° dir ${orbit.orbit_direction}`);
  record("plan: zoom-out targets space altitude", zoom.altitude_m === planner.SPACE_ALTITUDE_M && zoom.altitude_source === "semantic_space",
    `${zoom.altitude_m} (${zoom.altitude_source})`);

  // tracks well-formed
  for (const [name, kfs] of Object.entries(tracks)) {
    const monotonic = kfs.every((k, i) => i === 0 || k.time > kfs[i - 1].time);
    const bounded = kfs.every((k) => k.time >= 0 && k.time <= plan.total_frames);
    record(`tracks: ${name} keyframe times strictly increasing and bounded`, monotonic && bounded,
      `${kfs.length} keyframes, times ${kfs.slice(0, 3).map((k) => k.time).join(",")}…`);
  }
  record("tracks: animation starts at frame 0", tracks.lat[0] && tracks.lat[0].time === 0 && tracks.alt[0] && tracks.alt[0].time === 0,
    `first lat kf ${tracks.lat[0] && tracks.lat[0].time}, first alt kf ${tracks.alt[0] && tracks.alt[0].time}`);

  // flight
  const dist = planner.haversineMeters(flyIn.location, flight.location);
  record("flight: source and destination differ by the real Helsinki→Paris distance", dist > 1700000 && dist < 2100000, `${Math.round(dist / 1000)} km`);
  const flightAlt = inWindow(tracks.alt, flight.start_frame, flight.end_frame);
  const flightPeak = flightAlt.length ? Math.max(...flightAlt.map((k) => k.value)) : 0;
  record("flight: long flight rises in a cinematic arc", flightPeak > Math.max(2500, 2000) + 100000, `peak ${Math.round(flightPeak)} m`);
  record("flight: arc peak stays inside the engine cap", flightPeak <= 2500000 + planner.SPACE_ALTITUDE_M, `peak ${flightPeak}`);
  record("terrain: no altitude keyframe below the global floor", tracks.alt.every((k) => k.value >= planner.MIN_ALTITUDE_M),
    `min ${Math.min(...tracks.alt.map((k) => k.value))}`);

  // orbit
  const center = { latitude: orbit.location.latitude, longitude: orbit.location.longitude };
  const orbitPts = inWindow(tracks.lat, orbit.start_frame, orbit.end_frame, { excludeStart: true })
    .map((k) => ({ time: k.time, latitude: k.value, longitude: trackValueAt(tracks.lng, k.time) }));
  record("orbit: emits circle position samples (spatial orbit, not a heading spin)", orbitPts.length >= 20, `${orbitPts.length} samples`);
  const latVals = orbitPts.map((p) => p.latitude);
  const lngVals = orbitPts.map((p) => p.longitude);
  record("orbit: path passes both sides of the target",
    Math.max(...latVals) > center.latitude && Math.min(...latVals) < center.latitude
    && Math.max(...lngVals) > center.longitude && Math.min(...lngVals) < center.longitude,
    `lat ${Math.min(...latVals).toFixed(4)}..${Math.max(...latVals).toFixed(4)} around ${center.latitude}`);
  const expectedRadius = planner.orbitRadiusMeters(orbit.altitude_m, orbit.tilt_deg);
  const radiusErrors = orbitPts.map((p) => Math.abs(planner.haversineMeters(p, center) - expectedRadius) / expectedRadius);
  record("orbit: camera stays at the intended radius from the target (±5%)", radiusErrors.every((e) => e < 0.05),
    `expected ${Math.round(expectedRadius)} m, worst error ${(Math.max(...radiusErrors) * 100).toFixed(1)}%`);
  const headingErrors = orbitPts.map((p) => angleDelta(initialBearing(p, center), ((trackValueAt(tracks.pan, p.time) % 360) + 360) % 360));
  record("orbit: heading faces the target throughout (±2.5°)", headingErrors.every((e) => e < 2.5),
    `worst heading error ${Math.max(...headingErrors).toFixed(2)}°`);
  const panDelta = trackValueAt(tracks.pan, orbit.end_frame) - trackValueAt(tracks.pan, orbit.start_frame);
  record("orbit: two revolutions accumulate (pan sweep = -720°, engine ccw = pan decreasing)", Math.abs(panDelta + 720) < 0.01, `pan sweep ${panDelta}°`);

  // zoom
  const zoomAlt = inWindow(tracks.alt, zoom.start_frame, zoom.end_frame);
  record("zoom: begins anchored at the orbit's end altitude (no static first stretch)",
    zoomAlt.length >= 4 && zoomAlt[0].time === zoom.start_frame && Math.abs(zoomAlt[0].value - orbit.altitude_m) < 0.5,
    `first zoom alt kf ${zoomAlt[0] && zoomAlt[0].time}:${zoomAlt[0] && zoomAlt[0].value}`);
  record("zoom: altitude strictly increases to space", zoomAlt.every((k, i) => i === 0 || k.value > zoomAlt[i - 1].value)
    && Math.abs(zoomAlt[zoomAlt.length - 1].value - planner.SPACE_ALTITUDE_M) < 1,
    zoomAlt.map((k) => Math.round(k.value)).join(" → "));
  record("zoom: interpolation has non-static intermediate states", zoomAlt.length >= 4, `${zoomAlt.length} keyframes`);

  // continuity
  const orbitAnchorLat = tracks.lat.find((k) => k.time === orbit.start_frame);
  record("continuity: orbit starts from the flight's resolved end position",
    Boolean(orbitAnchorLat) && Math.abs(orbitAnchorLat.value - flight.location.latitude) < 1e-6,
    `anchor ${orbitAnchorLat && orbitAnchorLat.value} vs Paris ${flight.location.latitude}`);
  const panAnchor = tracks.pan.find((k) => k.time === orbit.start_frame);
  record("continuity: pan change is anchored at the orbit start (no backward bleed)", Boolean(panAnchor), "no pan keyframe at orbit start");

  const ok = checks.every((c) => c.ok);
  return { ok, checks, plan_summary: { total_frames: plan.total_frames, frame_rate: plan.frame_rate, aspect: plan.aspect } };
}

// ── ingest-observation ───────────────────────────────────────────────────────

const OBSERVATION_BOOL_FIELDS = [
  ["importSucceeded"],
  ["flight", "correct"],
  ["orbit", "correct"],
  ["orbit", "directionCorrect"],
  ["orbit", "targetFacing"],
  ["zoom", "correct"],
  ["tilt", "correct"],
  ["aspectRatio", "correct"],
];

function evaluateObservation(observation) {
  // A failed import is a COMPLETE observation: the playback checks are
  // unobservable when Earth Studio refuses the file, and the failure itself
  // is the discrepancy to report.
  if (observation && observation.importSucceeded === false) {
    return {
      complete: true,
      accepted: false,
      missing: [],
      discrepancies: ["importSucceeded=false (Earth Studio rejected or failed to import the .esp)"],
      warnings: (observation.earthStudioWarnings) || [],
    };
  }
  const missing = [];
  const failed = [];
  for (const fieldPath of OBSERVATION_BOOL_FIELDS) {
    let value = observation;
    for (const key of fieldPath) value = value ? value[key] : undefined;
    if (typeof value !== "boolean") missing.push(fieldPath.join("."));
    else if (!value) failed.push(fieldPath.join("."));
  }
  const revolutions = observation && observation.orbit ? observation.orbit.revolutionsObserved : null;
  if (revolutions == null) missing.push("orbit.revolutionsObserved");
  else if (revolutions !== 2) failed.push(`orbit.revolutionsObserved=${revolutions} (expected 2)`);
  return {
    complete: missing.length === 0,
    accepted: missing.length === 0 && failed.length === 0,
    missing,
    discrepancies: failed,
    warnings: (observation && observation.earthStudioWarnings) || [],
  };
}

function ingestObservation(packageDir) {
  const observationPath = path.join(packageDir, FILES.observation);
  if (!fs.existsSync(observationPath)) {
    return { present: false, message: `No ${FILES.observation} yet — copy the template after the real Earth Studio import (see ${FILES.checklist}).` };
  }
  const observation = readJson(observationPath);
  const evaluated = evaluateObservation(observation);
  return { present: true, observation, ...evaluated };
}

// ── validate-frames ──────────────────────────────────────────────────────────

function validateFrames(packageDir, { minFrames = DEFAULT_MIN_FRAMES } = {}) {
  const manifest = readJson(path.join(packageDir, FILES.manifest));
  const framesDir = path.join(packageDir, "earth-studio", "frames");
  const failures = [];
  const warnings = [];
  const entries = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).sort() : [];
  const imageExts = ["png", "jpg", "jpeg"];
  const frames = entries.filter((f) => imageExts.includes(path.extname(f).slice(1).toLowerCase()));
  const ignored = entries.filter((f) => !frames.includes(f));
  if (ignored.length) warnings.push(`ignored ${ignored.length} non-frame entr${ignored.length === 1 ? "y" : "ies"}: ${ignored.slice(0, 5).join(", ")}`);

  if (frames.length === 0) failures.push("no frames found — export the Earth Studio image sequence into earth-studio/frames/ first");
  if (frames.length > 0 && frames.length < minFrames) failures.push(`only ${frames.length} frames — the acceptance window needs at least ${minFrames}`);

  const exts = new Set(frames.map((f) => path.extname(f).slice(1).toLowerCase()));
  if (exts.size > 1) failures.push(`mixed frame extensions ${[...exts].join(",")} — the render lane globs a single extension`);

  const numbered = frames.map((f) => ({ name: f, n: proofChecker.trailingNumber(f) }));
  let window = null;
  if (numbered.some((f) => f.n === null)) {
    failures.push(`unparseable frame numbering: ${numbered.filter((f) => f.n === null).slice(0, 5).map((f) => f.name).join(", ")}`);
  } else if (numbered.length) {
    const seen = new Map();
    for (const f of numbered) {
      if (seen.has(f.n)) failures.push(`duplicate frame number ${f.n}: ${f.name} and ${seen.get(f.n)}`);
      else seen.set(f.n, f.name);
    }
    const nums = [...seen.keys()].sort((a, b) => a - b);
    const gaps = [];
    for (let n = nums[0]; n <= nums[nums.length - 1]; n += 1) if (!seen.has(n)) gaps.push(n);
    if (gaps.length) failures.push(`gaps in the frame window: missing ${gaps.slice(0, 10).join(", ")}${gaps.length > 10 ? ", …" : ""}`);
    window = { first_number: nums[0], last_number: nums[nums.length - 1] };
  }

  // Header-level decode: PNG IHDR / JPEG SOF probes (dependency-free). This
  // proves format + dimensions, not full pixel decode — ffmpeg performs the
  // real decode at render time and its exit code is part of the proof.
  const dims = new Map();
  const unreadable = [];
  let previousBuf = null;
  let identicalRuns = 0;
  for (const f of frames) {
    const p = path.join(framesDir, f);
    if (fs.lstatSync(p).isSymbolicLink()) { failures.push(`symlinked frame refused: ${f}`); continue; }
    const d = proofChecker.imageDimensions(p);
    if (!d) { unreadable.push(f); continue; }
    dims.set(`${d.width}x${d.height}`, (dims.get(`${d.width}x${d.height}`) || 0) + 1);
    const buf = fs.readFileSync(p);
    if (previousBuf && buf.equals(previousBuf)) identicalRuns += 1;
    previousBuf = buf;
  }
  if (unreadable.length) failures.push(`frames with unreadable image headers: ${unreadable.slice(0, 5).join(", ")}`);
  if (dims.size > 1) failures.push(`inconsistent frame dimensions: ${JSON.stringify(Object.fromEntries(dims))}`);
  if (identicalRuns > 0) warnings.push(`${identicalRuns} byte-identical consecutive frame pair(s) — legitimate for held frames, suspicious for a full-motion window`);

  const expected = manifest.render_dimensions;
  if (dims.size === 1 && expected) {
    const [dimKey] = dims.keys();
    const [w, h] = dimKey.split("x").map(Number);
    if (w === expected.width && h === expected.height) { /* exact match */ }
    else if (Math.abs(w / h - expected.width / expected.height) < 0.01) {
      warnings.push(`frames are ${dimKey} — same ${manifest.aspect} ratio as the project but not the full ${expected.width}x${expected.height} (a reduced-scale Earth Studio export)`);
    } else {
      failures.push(`frame aspect ${dimKey} does not match the ${manifest.aspect} project (${expected.width}x${expected.height})`);
    }
  }

  const result = {
    ok: failures.length === 0,
    validated_at: new Date().toISOString(),
    frames_dir: framesDir,
    count: frames.length,
    first: frames[0] || null,
    last: frames[frames.length - 1] || null,
    window,
    extensions: [...exts],
    dimensions: [...dims.keys()],
    identical_consecutive_pairs: identicalRuns,
    ignored_entries: ignored,
    min_frames: minFrames,
    failures,
    warnings,
  };
  writeJson(path.join(packageDir, FILES.framesValidation), result);
  return result;
}

// ── render (production frames→MP4 path) ─────────────────────────────────────

function startAcceptanceRender(packageDir, options = {}) {
  const validationPath = path.join(packageDir, FILES.framesValidation);
  if (!fs.existsSync(validationPath)) throw usageError("Run validate-frames first — the render only runs against a validated real frame set.");
  const validation = readJson(validationPath);
  if (!validation.ok) throw usageError(`frames-validation.json reports failures — fix the frame export first: ${validation.failures.join("; ")}`);
  // The PRODUCTION path: the same lane.startRender the POST /render endpoint calls.
  return { start: lane.startRender(packageDir, PROOF_ID, options), validation };
}

function finalizeRenderResult(packageDir, startInfo, jobStatus, options = {}) {
  const validation = startInfo.validation;
  const mp4Path = lane.renderPath(packageDir);
  const failures = [];
  const warnings = [...(startInfo.start.warnings || [])];
  if (jobStatus.exit_state !== "completed" || jobStatus.exit_code !== 0) {
    failures.push(`render did not complete cleanly: ${jobStatus.exit_state} (exit ${jobStatus.exit_code}) — ${String(jobStatus.stderr_tail || "").slice(-400)}`);
  }
  let probe = null;
  if (fs.existsSync(mp4Path)) {
    probe = (options.probe || proofChecker.ffprobeMp4)(mp4Path);
    if (!probe.available) failures.push(`ffprobe failed on the render: ${probe.reason}`);
    else {
      if (!probe.codec) failures.push("no video stream in the rendered MP4");
      if (probe.fps != null && Math.abs(probe.fps - startInfo.start.fps) > 0.01) failures.push(`fps ${probe.fps} != render fps ${startInfo.start.fps}`);
      if (probe.nb_frames != null && probe.nb_frames !== validation.count) failures.push(`MP4 frame count ${probe.nb_frames} != validated frame count ${validation.count}`);
      if (probe.duration_s != null && Math.abs(probe.duration_s - validation.count / startInfo.start.fps) > 0.35) {
        failures.push(`duration ${probe.duration_s}s != expected ${(validation.count / startInfo.start.fps).toFixed(2)}s`);
      }
      if (probe.width != null && validation.dimensions.length === 1) {
        const [w, h] = validation.dimensions[0].split("x").map(Number);
        if (probe.width !== w || probe.height !== h) failures.push(`MP4 ${probe.width}x${probe.height} != frame dimensions ${w}x${h}`);
      }
    }
  } else {
    failures.push(`rendered MP4 missing: ${mp4Path}`);
  }
  const result = {
    ok: failures.length === 0,
    rendered_at: new Date().toISOString(),
    production_path: "earth-studio-lane.startRender (same code path as POST /api/earth-studio/render)",
    frame_glob: startInfo.start.frame_glob,
    fps: startInfo.start.fps,
    frame_count: validation.count,
    output: fs.existsSync(mp4Path) ? path.relative(packageDir, mp4Path) : null,
    mp4_sha256: fs.existsSync(mp4Path) ? sha256(mp4Path) : null,
    mp4_bytes: fs.existsSync(mp4Path) ? fs.statSync(mp4Path).size : null,
    exit_state: jobStatus.exit_state,
    exit_code: jobStatus.exit_code,
    stderr_tail: String(jobStatus.stderr_tail || "").slice(-1500),
    probe,
    failures,
    warnings,
  };
  writeJson(path.join(packageDir, FILES.renderResult), result);
  return result;
}

async function renderCommand(packageDir) {
  const current = lane.currentJobStatus();
  if (current.active) throw usageError("An Earth Studio render is already running — wait for it or cancel it first.");
  const startInfo = startAcceptanceRender(packageDir);
  const startedAt = Date.now();
  let status = lane.currentJobStatus();
  while (status.active) {
    if (Date.now() - startedAt > 15 * 60 * 1000) {
      lane.cancelRender();
      throw new Error("Render exceeded 15 minutes — cancelled.");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = lane.currentJobStatus();
  }
  return finalizeRenderResult(packageDir, startInfo, status);
}

// ── hash + status ────────────────────────────────────────────────────────────

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function proofArtifactPaths(packageDir) {
  const fixed = [
    path.join("earth-studio", "shot-plan.json"),
    path.join("earth-studio", "earth-studio.esp"),
    path.join("earth-studio", "job.json"),
    FILES.manifest,
    FILES.expected,
    FILES.checklist,
    FILES.observation,
    FILES.framesValidation,
    FILES.renderResult,
  ].filter((rel) => fs.existsSync(path.join(packageDir, rel)));
  const framesDir = path.join(packageDir, "earth-studio", "frames");
  const frames = fs.existsSync(framesDir)
    ? fs.readdirSync(framesDir).sort().filter((f) => ["png", "jpg", "jpeg"].includes(path.extname(f).slice(1).toLowerCase()))
      .map((f) => path.join("earth-studio", "frames", f))
    : [];
  const mp4 = lane.renderPath(packageDir);
  const mp4Rel = fs.existsSync(mp4) ? [path.relative(packageDir, mp4)] : [];
  return [...fixed, ...frames, ...mp4Rel];
}

function writeHashes(packageDir) {
  const rels = proofArtifactPaths(packageDir);
  const lines = rels.map((rel) => `${sha256(path.join(packageDir, rel))}  ${rel}`);
  fs.writeFileSync(path.join(packageDir, FILES.hashes), `${lines.join("\n")}\n`);
  return { ok: true, hashed: rels.length, file: path.join(packageDir, FILES.hashes) };
}

function verifyHashes(packageDir) {
  const hashPath = path.join(packageDir, FILES.hashes);
  if (!fs.existsSync(hashPath)) return { present: false, ok: false, mismatches: [], missing: [] };
  const mismatches = [];
  const missing = [];
  for (const line of fs.readFileSync(hashPath, "utf8").split("\n").filter(Boolean)) {
    const m = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
    if (!m) { mismatches.push(`unparseable line: ${line}`); continue; }
    const p = path.join(packageDir, m[2]);
    if (!fs.existsSync(p)) missing.push(m[2]);
    else if (sha256(p) !== m[1]) mismatches.push(m[2]);
  }
  return { present: true, ok: mismatches.length === 0 && missing.length === 0, mismatches, missing };
}

// The verification state machine. Internal green (INTERNAL_VERIFIED) must
// never be read as external proof — only the human's structured observation
// of REAL Earth Studio, plus real frames rendered through the production
// path, can advance the state.
function computeStatus(packageDir) {
  const hasLane = fs.existsSync(path.join(packageDir, "earth-studio", "earth-studio.esp"))
    && fs.existsSync(path.join(packageDir, FILES.manifest));
  if (!hasLane) return { state: "NOT_GENERATED", detail: "run: node scripts/earth-studio-v04-acceptance.js generate" };

  const semantic = runSemanticChecks(packageDir);
  if (!semantic.ok) {
    return { state: "INTERNAL_CHECKS_FAILED", detail: semantic.checks.filter((c) => !c.ok).map((c) => c.name).join("; "), semantic };
  }
  const observation = ingestObservation(packageDir);
  if (!observation.present || !observation.complete) {
    return {
      state: "INTERNAL_VERIFIED",
      detail: "parser/generator/.esp structure verified internally — real Earth Studio import NOT yet observed; camera semantics remain best-effort assumptions",
      semantic, observation,
    };
  }
  if (!observation.accepted) {
    return {
      state: "IMPORT_DISCREPANCY_REPORTED",
      detail: `real Earth Studio observation reports: ${observation.discrepancies.join("; ")} — diagnose narrowly, fix, regenerate a NEW proof round`,
      semantic, observation,
    };
  }
  const framesValidationPath = path.join(packageDir, FILES.framesValidation);
  const renderResultPath = path.join(packageDir, FILES.renderResult);
  const framesValidation = fs.existsSync(framesValidationPath) ? readJson(framesValidationPath) : null;
  const renderResult = fs.existsSync(renderResultPath) ? readJson(renderResultPath) : null;
  const hashes = verifyHashes(packageDir);
  if (!framesValidation || !framesValidation.ok || !renderResult || !renderResult.ok || !hashes.present || !hashes.ok) {
    const pending = [];
    if (!framesValidation) pending.push("real frame export not validated");
    else if (!framesValidation.ok) pending.push("frame validation failing");
    if (!renderResult) pending.push("production render not run");
    else if (!renderResult.ok) pending.push("render result failing");
    if (!hashes.present) pending.push("hashes.sha256 not written");
    else if (!hashes.ok) pending.push(`hash mismatches: ${[...hashes.mismatches, ...hashes.missing].join(", ")}`);
    return { state: "EARTH_STUDIO_IMPORT_VERIFIED", detail: pending.join("; "), semantic, observation, framesValidation, renderResult, hashes };
  }
  return { state: "END_TO_END_VERIFIED", detail: "full chain proven with preserved evidence", semantic, observation, framesValidation, renderResult, hashes };
}

function writeReport(packageDir, status) {
  const manifest = readJson(path.join(packageDir, FILES.manifest));
  const lines = [
    `# Earth Studio v0.4 acceptance report — ${PROOF_ID}`,
    "",
    `**Verification state: ${status.state}**`,
    "",
    status.detail,
    "",
    `- Planner version: ${manifest.planner_version}`,
    `- Generated at: ${manifest.generated_at} (git ${manifest.git_head ? manifest.git_head.slice(0, 12) : "?"})`,
    `- Instruction: \`${manifest.instruction}\``,
    `- Aspect: ${manifest.aspect} (${manifest.render_dimensions.width}x${manifest.render_dimensions.height}) · ${manifest.total_frames} frames @ ${manifest.frame_rate} fps`,
    `- .esp sha256: \`${manifest.esp_sha256}\``,
    "",
    "## Gates",
    `- Internal semantic checks: ${status.semantic ? (status.semantic.ok ? `PASS (${status.semantic.checks.length} assertions)` : "FAIL") : "not run"}`,
    `- Real Earth Studio import observation: ${status.observation && status.observation.present ? (status.observation.accepted ? "ACCEPTED" : status.observation.complete ? `DISCREPANCIES: ${status.observation.discrepancies.join("; ")}` : `INCOMPLETE (missing ${status.observation.missing.join(", ")})`) : "PENDING — the one manual browser step (see import-checklist.md)"}`,
    `- Real frame export validated: ${status.framesValidation ? (status.framesValidation.ok ? `PASS (${status.framesValidation.count} frames, ${status.framesValidation.dimensions.join(",")})` : "FAIL") : "PENDING"}`,
    `- Production frames→MP4 render: ${status.renderResult ? (status.renderResult.ok ? `PASS (${status.renderResult.output}, ${status.renderResult.mp4_sha256 ? status.renderResult.mp4_sha256.slice(0, 12) : "?"}…)` : "FAIL") : "PENDING"}`,
    `- Evidence hashes: ${status.hashes ? (status.hashes.present ? (status.hashes.ok ? "VERIFIED" : "MISMATCH") : "not written") : "not written"}`,
    "",
    "Internal green is NOT external proof: only the real Earth Studio import",
    "observation and real exported frames advance the state past INTERNAL_VERIFIED.",
    "",
    `_Report regenerated ${new Date().toISOString()} by scripts/earth-studio-v04-acceptance.js status._`,
  ];
  fs.writeFileSync(path.join(packageDir, FILES.report), `${lines.join("\n")}\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { command: null, packageDir: null, minFrames: DEFAULT_MIN_FRAMES, force: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; if (i >= argv.length) throw usageError(`${a} requires a value.`); return argv[i]; };
    if (!args.command && !a.startsWith("--")) args.command = a;
    else if (a === "--package-dir") args.packageDir = next();
    else if (a === "--min-frames") { args.minFrames = Number(next()); if (!Number.isInteger(args.minFrames) || args.minFrames < 1) throw usageError("--min-frames must be a positive integer."); }
    else if (a === "--force") args.force = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.command = "help";
    else throw usageError(`Unknown argument: ${a}`);
  }
  if (!args.command) args.command = "help";
  return args;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(error.exitCode || 2); }

  const emit = (value, human) => {
    if (args.json) console.log(JSON.stringify(value, null, 2));
    else console.log(human != null ? human : JSON.stringify(value, null, 2));
  };

  try {
    if (args.command === "help") {
      console.log("Commands: generate | check | ingest-observation | validate-frames | render | hash | status");
      console.log("See the header comment for the workflow. The real Earth Studio import is the only external authority.");
      return;
    }
    if (args.command === "generate") {
      const out = generate(args.packageDir, { force: args.force });
      emit(out, `Generated ${PROOF_ID} at ${out.package_dir}\n- ${out.manifest.total_frames} frames @ ${out.manifest.frame_rate} fps, ${out.manifest.aspect}\n- .esp sha256 ${out.manifest.esp_sha256}\nNext: node scripts/earth-studio-v04-acceptance.js check`);
      return;
    }
    const packageDir = resolvePackageDir(args.packageDir);
    if (args.command === "check") {
      const out = runSemanticChecks(packageDir);
      const lines = out.checks.map((c) => `  ${c.ok ? " ok " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
      emit(out, `Pre-import semantic assertions (INTERNAL only — not external proof):\n${lines.join("\n")}\n${out.ok ? "PASS" : "FAIL"} — ${out.checks.filter((c) => c.ok).length}/${out.checks.length}`);
      process.exitCode = out.ok ? 0 : 1;
    } else if (args.command === "ingest-observation") {
      const out = ingestObservation(packageDir);
      emit(out, out.present
        ? (out.accepted ? "Observation ACCEPTED — real Earth Studio import verified by the human record."
          : out.complete ? `Observation reports DISCREPANCIES: ${out.discrepancies.join("; ")}` : `Observation INCOMPLETE — missing: ${out.missing.join(", ")}`)
        : out.message);
      process.exitCode = out.present && out.complete ? (out.accepted ? 0 : 1) : 1;
    } else if (args.command === "validate-frames") {
      const out = validateFrames(packageDir, { minFrames: args.minFrames });
      emit(out, `${out.ok ? "PASS" : "FAIL"} — ${out.count} frames ${out.window ? `#${out.window.first_number}–#${out.window.last_number}` : ""} ${out.dimensions.join(",")}\n${out.failures.map((f) => `  FAIL ${f}`).join("\n")}${out.warnings.map((w) => `  WARN ${w}`).join("\n")}`);
      process.exitCode = out.ok ? 0 : 1;
    } else if (args.command === "render") {
      const out = await renderCommand(packageDir);
      emit(out, `${out.ok ? "PASS" : "FAIL"} — ${out.output || "no output"} (${out.frame_count} frames @ ${out.fps} fps)\n${out.probe && out.probe.available ? `  ffprobe: ${out.probe.codec} ${out.probe.width}x${out.probe.height} ${out.probe.fps}fps ${out.probe.nb_frames}f ${out.probe.duration_s}s` : ""}\n${out.failures.map((f) => `  FAIL ${f}`).join("\n")}`);
      process.exitCode = out.ok ? 0 : 1;
    } else if (args.command === "hash") {
      const out = writeHashes(packageDir);
      emit(out, `Hashed ${out.hashed} artifacts → ${out.file}`);
    } else if (args.command === "status") {
      const out = computeStatus(packageDir);
      writeReport(packageDir, out);
      emit({ state: out.state, detail: out.detail }, `${out.state}\n  ${out.detail}\n  report: ${path.join(packageDir, FILES.report)}`);
      process.exitCode = ["INTERNAL_CHECKS_FAILED", "IMPORT_DISCREPANCY_REPORTED"].includes(out.state) ? 1 : 0;
    } else {
      throw usageError(`Unknown command: ${args.command}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode || 1);
  }
}

if (require.main === module) main();

module.exports = {
  PROOF_ID, DEFAULT_PACKAGE_DIR, JOB_NAME, INSTRUCTION, ASPECT, exportWindow, FILES,
  resolvePackageDir, generate, runSemanticChecks, buildExpected,
  ingestObservation, evaluateObservation, observationTemplate,
  validateFrames, startAcceptanceRender, finalizeRenderResult,
  writeHashes, verifyHashes, computeStatus, writeReport,
  espTracks, trackValueAt, initialBearing, angleDelta,
};
