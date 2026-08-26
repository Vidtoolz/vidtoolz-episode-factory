'use strict';

/*
 * The Draft Assembly V0 input contract: which visuals and which music this run
 * assembles from.
 *
 * Deliberately modelled on scripts/package-run-story-binding.js, because the
 * problem is identical: a package run needs to say WHICH external, already
 * produced assets own its draft, and it must say so durably enough that a
 * rebuild months later uses the same bytes or fails loudly.
 *
 * The run stores a REFERENCE plus the byte hashes observed at bind time. It
 * never copies the media. Resolution always reads the assets back from their
 * owning root and re-hashes them, so a regenerated image, a swapped mix, or a
 * deleted clip is drift — never a silently different draft.
 *
 * What this is NOT:
 *   - not Edit Plan V1 (that is the approved production timeline authority)
 *   - not a selection authority: it records selections others already made
 *   - not permission to publish anything it names
 *
 * Deliberately absent: "latest package" lookup, title matching, glob discovery,
 * and any fallback that would let a run bind to media nobody chose.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BINDING_FILE = 'draft-assembly-binding.json';
const BINDING_SCHEMA = 'vidtoolz.draftAssemblyBinding.v1';
const ARTIFACT_TYPE = 'draft-assembly-binding';

// Where visuals may come from. Each kind names an existing canonical producer;
// adding a kind means teaching this module to read that producer, never
// inventing a new place for media to live.
const VISUAL_SOURCE_KINDS = Object.freeze([
  // <package>/resolve-handoff/media-manifest.json — ordered generated clips.
  'AIGEN_RESOLVE_HANDOFF',
  // <package>/selected-images.json — human-selected stills.
  'AIGEN_SELECTED_IMAGES',
  // An explicit ordered list of absolute paths. The escape hatch for media the
  // aigen lane does not own (Earth Studio renders, manual imports, screen
  // capture). Every entry is still hashed and re-verified.
  'EXPLICIT_ASSETS',
]);

const MUSIC_SOURCE_KINDS = Object.freeze([
  // A Scorecraft score project's approved/ directory.
  'SCORECRAFT_APPROVED_MIX',
  // An explicit path to an already accepted audio file.
  'EXPLICIT_ASSET',
]);

const MUSIC_VARIANTS = Object.freeze(['dialogue_safe', 'full']);

// What to do when there are fewer distinct visuals than narrated sections.
// FAIL is the default on purpose: a draft that silently repeats shots teaches
// the reviewer the wrong thing about pacing. CYCLE is available, and when it is
// used every reused segment is recorded as a warning.
const SHORTFALL_POLICIES = Object.freeze(['FAIL', 'CYCLE']);

const TRANSITIONS = Object.freeze(['CUT', 'CROSSFADE']);

// Scale-to-fit with padding never loses picture; COVER crops to fill. FIT is
// the default because a draft exists to judge content, not framing polish.
const FIT_MODES = Object.freeze(['FIT', 'COVER']);

const MEDIA_KINDS = Object.freeze(['VIDEO', 'IMAGE']);

const IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.mkv', '.webm']);

class DraftAssemblyBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftAssemblyBindingError';
    this.code = code;
  }
}

function fail(code, message) { throw new DraftAssemblyBindingError(code, message); }

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function bindingPath(runDir) {
  return path.join(path.resolve(runDir), BINDING_FILE);
}

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function mediaKindForPath(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return 'VIDEO';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'IMAGE';
  return null;
}

/* ------------------------------------------------------------- discovery -- */

/*
 * Read the ordered clip list an aigen package already published for Resolve.
 * That manifest is the closest thing the estate has to "these visuals, in this
 * order", so the draft uses it rather than re-deriving an order of its own.
 */
function discoverAigenResolveHandoff(packageDir) {
  const manifestFile = path.join(packageDir, 'resolve-handoff', 'media-manifest.json');
  if (!fs.existsSync(manifestFile)) {
    fail('DRAFT_BINDING_SOURCE_MISSING', `aigen package has no resolve-handoff/media-manifest.json: ${packageDir}`);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
  catch (_) { return fail('DRAFT_BINDING_SOURCE_UNREADABLE', `${manifestFile} is not valid JSON`); }
  const clips = Array.isArray(parsed.clips) ? parsed.clips : [];
  if (!clips.length) fail('DRAFT_BINDING_SOURCE_EMPTY', `${manifestFile} lists no clips`);
  return clips
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((clip, index) => {
      const relative = clip.staged_video_relative_path
        || (clip.staged_video_path ? path.relative(packageDir, clip.staged_video_path) : null);
      if (!relative) fail('DRAFT_BINDING_SOURCE_INVALID', `clip ${index + 1} has no staged video path`);
      return {
        order: index + 1,
        relative_path: String(relative).replace(/\\/g, '/'),
        prompt_index: clip.prompt_index ?? null,
        description: String(clip.prompt_text || '').trim().slice(0, 400) || null,
      };
    });
}

function discoverAigenSelectedImages(packageDir) {
  const manifestFile = path.join(packageDir, 'selected-images.json');
  if (!fs.existsSync(manifestFile)) {
    fail('DRAFT_BINDING_SOURCE_MISSING', `aigen package has no selected-images.json: ${packageDir}`);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
  catch (_) { return fail('DRAFT_BINDING_SOURCE_UNREADABLE', `${manifestFile} is not valid JSON`); }
  const selections = Array.isArray(parsed.selections) ? parsed.selections : [];
  if (!selections.length) fail('DRAFT_BINDING_SOURCE_EMPTY', `${manifestFile} records no selections`);
  return selections
    .slice()
    .sort((a, b) => (Number(a.prompt_index ?? a.index) || 0) - (Number(b.prompt_index ?? b.index) || 0))
    .map((selection, index) => {
      const relative = selection.selected_path || selection.path;
      if (!relative) fail('DRAFT_BINDING_SOURCE_INVALID', `selection ${index + 1} has no path`);
      return {
        order: index + 1,
        relative_path: String(relative).replace(/\\/g, '/'),
        prompt_index: selection.prompt_index ?? selection.index ?? null,
        description: String(selection.prompt || '').trim().slice(0, 400) || null,
      };
    });
}

/* ----------------------------------------------------------------- build --- */

/*
 * Hash every asset at bind time. An asset that cannot be read, is empty, or is
 * of an unsupported kind fails the whole bind: a partial binding would be a
 * draft with a hole in it, discovered only at render time.
 */
function hashAssets(root, entries) {
  return entries.map((entry) => {
    const absolute = path.resolve(root, entry.relative_path);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) && absolute !== path.resolve(root)) {
      fail('DRAFT_BINDING_PATH_ESCAPE', `asset path escapes its root: ${entry.relative_path}`);
    }
    if (!fs.existsSync(absolute)) fail('DRAFT_BINDING_ASSET_MISSING', `bound asset not found: ${absolute}`);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size === 0) fail('DRAFT_BINDING_ASSET_EMPTY', `bound asset is empty or not a file: ${absolute}`);
    const kind = mediaKindForPath(absolute);
    if (!kind) fail('DRAFT_BINDING_ASSET_KIND_UNSUPPORTED', `unsupported media kind: ${absolute}`);
    return {
      order: entry.order,
      asset_id: `visual-${String(entry.order).padStart(3, '0')}`,
      kind,
      relative_path: entry.relative_path,
      sha256: sha256File(absolute),
      bytes: stat.size,
      prompt_index: entry.prompt_index ?? null,
      description: entry.description ?? null,
    };
  });
}

function buildVisualBinding(spec) {
  const kind = String(spec.source_kind || '');
  if (!VISUAL_SOURCE_KINDS.includes(kind)) {
    fail('DRAFT_BINDING_VISUAL_KIND_INVALID', `visual source_kind must be one of ${VISUAL_SOURCE_KINDS.join(', ')}`);
  }
  if (kind === 'EXPLICIT_ASSETS') {
    const list = Array.isArray(spec.assets) ? spec.assets : [];
    if (!list.length) fail('DRAFT_BINDING_SOURCE_EMPTY', 'EXPLICIT_ASSETS requires at least one asset');
    const root = path.resolve(spec.root || '/');
    const entries = list.map((item, index) => {
      const raw = typeof item === 'string' ? { path: item } : item;
      const absolute = path.resolve(raw.path || '');
      return {
        order: index + 1,
        relative_path: path.relative(root, absolute).replace(/\\/g, '/'),
        prompt_index: raw.prompt_index ?? null,
        description: raw.description ?? null,
      };
    });
    return { source_kind: kind, root, assets: hashAssets(root, entries) };
  }

  const packageDir = path.resolve(spec.package_dir || '');
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    fail('DRAFT_BINDING_SOURCE_MISSING', `aigen package directory not found: ${spec.package_dir}`);
  }
  const entries = kind === 'AIGEN_RESOLVE_HANDOFF'
    ? discoverAigenResolveHandoff(packageDir)
    : discoverAigenSelectedImages(packageDir);
  return { source_kind: kind, root: packageDir, assets: hashAssets(packageDir, entries) };
}

function buildMusicBinding(spec) {
  if (spec === null || spec === undefined) return null;
  const kind = String(spec.source_kind || '');
  if (!MUSIC_SOURCE_KINDS.includes(kind)) {
    fail('DRAFT_BINDING_MUSIC_KIND_INVALID', `music source_kind must be one of ${MUSIC_SOURCE_KINDS.join(', ')}`);
  }
  if (kind === 'EXPLICIT_ASSET') {
    const absolute = path.resolve(spec.path || '');
    if (!fs.existsSync(absolute)) fail('DRAFT_BINDING_ASSET_MISSING', `music asset not found: ${absolute}`);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size === 0) fail('DRAFT_BINDING_ASSET_EMPTY', `music asset is empty: ${absolute}`);
    return {
      source_kind: kind,
      root: path.dirname(absolute),
      variant: null,
      relative_path: path.basename(absolute),
      sha256: sha256File(absolute),
      bytes: stat.size,
      provenance_file: null,
      provenance_sha256: null,
    };
  }

  const projectDir = path.resolve(spec.project_dir || '');
  const variant = spec.variant || 'dialogue_safe';
  if (!MUSIC_VARIANTS.includes(variant)) {
    fail('DRAFT_BINDING_MUSIC_VARIANT_INVALID', `music variant must be one of ${MUSIC_VARIANTS.join(', ')}`);
  }
  const relative = path.join('approved', variant === 'dialogue_safe' ? 'mix-dialogue-safe.wav' : 'mix.wav');
  const absolute = path.join(projectDir, relative);
  if (!fs.existsSync(absolute)) {
    fail('DRAFT_BINDING_ASSET_MISSING', `approved score mix not found: ${absolute}`);
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size === 0) fail('DRAFT_BINDING_ASSET_EMPTY', `approved score mix is empty: ${absolute}`);

  // The provenance record is what makes this an APPROVED mix rather than a wav
  // that happens to sit in a folder called approved. Its absence is refused.
  const provenanceFile = path.join(projectDir, 'approved', 'provenance.json');
  if (!fs.existsSync(provenanceFile)) {
    fail('DRAFT_BINDING_MUSIC_PROVENANCE_MISSING',
      `score project has no approved/provenance.json; an unprovenanced mix is not an approved mix: ${projectDir}`);
  }
  return {
    source_kind: kind,
    root: projectDir,
    variant,
    relative_path: relative.replace(/\\/g, '/'),
    sha256: sha256File(absolute),
    bytes: stat.size,
    provenance_file: 'approved/provenance.json',
    provenance_sha256: sha256File(provenanceFile),
  };
}

function normalizePolicy(policy = {}) {
  const shortfall = String(policy.visual_shortfall || 'FAIL').toUpperCase();
  if (!SHORTFALL_POLICIES.includes(shortfall)) {
    fail('DRAFT_BINDING_POLICY_INVALID', `visual_shortfall must be one of ${SHORTFALL_POLICIES.join(', ')}`);
  }
  const transition = String(policy.transition || 'CUT').toUpperCase();
  if (!TRANSITIONS.includes(transition)) {
    fail('DRAFT_BINDING_POLICY_INVALID', `transition must be one of ${TRANSITIONS.join(', ')}`);
  }
  const fit = String(policy.fit || 'FIT').toUpperCase();
  if (!FIT_MODES.includes(fit)) {
    fail('DRAFT_BINDING_POLICY_INVALID', `fit must be one of ${FIT_MODES.join(', ')}`);
  }
  const crossfade = Number(policy.crossfade_seconds ?? 0.5);
  if (!Number.isFinite(crossfade) || crossfade < 0 || crossfade > 3) {
    fail('DRAFT_BINDING_POLICY_INVALID', 'crossfade_seconds must be between 0 and 3');
  }
  const musicGain = Number(policy.music_gain_db ?? -14);
  if (!Number.isFinite(musicGain) || musicGain > 0 || musicGain < -40) {
    fail('DRAFT_BINDING_POLICY_INVALID', 'music_gain_db must be between -40 and 0');
  }
  // On by default. A draft that leaves this run without a standing DRAFT mark
  // and without section boundaries is both less reviewable and easier to
  // mistake for a cut, so switching it off has to be a deliberate act.
  const reviewSlate = policy.review_slate === undefined ? true : Boolean(policy.review_slate);
  return {
    visual_shortfall: shortfall,
    transition,
    fit,
    crossfade_seconds: Number(crossfade.toFixed(3)),
    music_gain_db: Number(musicGain.toFixed(2)),
    review_slate: reviewSlate,
  };
}

function normalizeOutput(output) {
  if (!output) return null;
  const width = Number(output.width);
  const height = Number(output.height);
  const fps = Number(output.fps ?? 30);
  if (!Number.isInteger(width) || width <= 0 || width % 2 !== 0) fail('DRAFT_BINDING_OUTPUT_INVALID', 'output width must be a positive even integer');
  if (!Number.isInteger(height) || height <= 0 || height % 2 !== 0) fail('DRAFT_BINDING_OUTPUT_INVALID', 'output height must be a positive even integer');
  if (!Number.isInteger(fps) || fps <= 0 || fps > 120) fail('DRAFT_BINDING_OUTPUT_INVALID', 'output fps must be a positive integer up to 120');
  return { width, height, fps };
}

function buildBinding(fields) {
  const runId = String(fields.runId || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) fail('DRAFT_BINDING_INVALID', 'run_id is not a safe identifier');
  if (!fields.boundBy) fail('DRAFT_BINDING_INVALID', 'boundBy is required');
  return {
    schema: BINDING_SCHEMA,
    artifact_type: ARTIFACT_TYPE,
    run_id: runId,
    bound_at: fields.boundAt || new Date().toISOString(),
    bound_by: String(fields.boundBy),
    visuals: buildVisualBinding(fields.visuals || {}),
    music: buildMusicBinding(fields.music ?? null),
    output: normalizeOutput(fields.output),
    policy: normalizePolicy(fields.policy),
    notes: typeof fields.notes === 'string' ? fields.notes : null,
  };
}

function writeBinding(runDir, binding, options = {}) {
  const target = bindingPath(runDir);
  if (fs.existsSync(target) && !options.replace) {
    fail('DRAFT_BINDING_EXISTS', `${BINDING_FILE} already exists; pass replace to rebind`);
  }
  atomicWrite(target, `${JSON.stringify(binding, null, 2)}\n`);
  return target;
}

function readBinding(runDir) {
  const file = bindingPath(runDir);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fail('DRAFT_BINDING_UNREADABLE', `${BINDING_FILE} is not valid JSON`); }
  if (parsed?.schema !== BINDING_SCHEMA) {
    fail('DRAFT_BINDING_SCHEMA_UNSUPPORTED', `${BINDING_FILE} schema is not ${BINDING_SCHEMA}`);
  }
  return parsed;
}

/* -------------------------------------------------------------- resolve ---- */

/*
 * Read the binding back and re-verify every byte it named. Returns absolute
 * paths so callers never re-derive them, and a drift list so a stale binding is
 * a reported condition rather than a surprise mid-render.
 */
function resolveBinding(runDirInput) {
  const runDir = path.resolve(runDirInput);
  const binding = readBinding(runDir);
  if (!binding) fail('DRAFT_BINDING_MISSING', `${BINDING_FILE} not found in ${runDir}`);
  if (binding.run_id !== path.basename(runDir)) {
    fail('DRAFT_BINDING_RUN_MISMATCH', `${BINDING_FILE} was recorded for run ${binding.run_id}`);
  }

  const drift = [];
  const visuals = binding.visuals.assets.map((asset) => {
    const absolute = path.resolve(binding.visuals.root, asset.relative_path);
    let present = fs.existsSync(absolute);
    let actual = null;
    if (!present) drift.push(`visual ${asset.asset_id} is missing: ${absolute}`);
    else {
      actual = sha256File(absolute);
      if (actual !== asset.sha256) drift.push(`visual ${asset.asset_id} bytes changed since binding`);
    }
    return { ...asset, absolute_path: absolute, present, actual_sha256: actual };
  });

  let music = null;
  if (binding.music) {
    const absolute = path.resolve(binding.music.root, binding.music.relative_path);
    const present = fs.existsSync(absolute);
    let actual = null;
    if (!present) drift.push(`music asset is missing: ${absolute}`);
    else {
      actual = sha256File(absolute);
      if (actual !== binding.music.sha256) drift.push('music bytes changed since binding');
    }
    if (binding.music.provenance_file) {
      const provenance = path.resolve(binding.music.root, binding.music.provenance_file);
      if (!fs.existsSync(provenance)) drift.push('music provenance record is missing');
      else if (sha256File(provenance) !== binding.music.provenance_sha256) drift.push('music provenance record changed since binding');
    }
    music = { ...binding.music, absolute_path: absolute, present, actual_sha256: actual };
  }

  return { runDir, binding, visuals, music, drift, ok: drift.length === 0 };
}

function bindingStatus(runDirInput) {
  const runDir = path.resolve(runDirInput);
  let resolved;
  try { resolved = resolveBinding(runDir); }
  catch (error) {
    return { present: error.code !== 'DRAFT_BINDING_MISSING', valid: false, code: error.code || 'DRAFT_BINDING_INVALID', detail: error.message };
  }
  if (!resolved.ok) {
    return { present: true, valid: false, code: 'DRAFT_BINDING_DRIFT', detail: resolved.drift.join('; '), resolved };
  }
  return { present: true, valid: true, code: null, detail: null, resolved };
}

module.exports = {
  BINDING_FILE,
  BINDING_SCHEMA,
  ARTIFACT_TYPE,
  VISUAL_SOURCE_KINDS,
  MUSIC_SOURCE_KINDS,
  MUSIC_VARIANTS,
  SHORTFALL_POLICIES,
  TRANSITIONS,
  FIT_MODES,
  MEDIA_KINDS,
  DraftAssemblyBindingError,
  sha256File,
  bindingPath,
  mediaKindForPath,
  discoverAigenResolveHandoff,
  discoverAigenSelectedImages,
  normalizePolicy,
  buildBinding,
  writeBinding,
  readBinding,
  resolveBinding,
  bindingStatus,
};
