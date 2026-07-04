/*
 * VIDTOOLZ project state resolver (aigen script-packages media pipeline).
 *
 * Deterministic + file-driven: given a package directory it reads the package
 * files and returns a normalized state object (stage, status, counts, blockers,
 * warnings). The cockpit infers what to do from this — the operator never has to
 * remember the next step. Read-only; no network calls, no mutation.
 *
 * NOTE: this is the aigen media pipeline's stage model. It is intentionally
 * separate from pipeline-tracker.js (the package-runs 13-stage gate model), so
 * editing this never touches the canonical-spec guard.
 */

const fs = require('fs');
const path = require('path');

const { buildPackageMediaIndex } = require('./package-media-index.js');

// Normalized aigen-media stages, in pipeline order.
// Production pathways (tempo lanes). The aigen script-package lane is the
// short/vertical pipeline by design (workflow-path.js "vertical" — its stage
// flow IS this resolver's stage model), so an unmarked package defaults to
// vertical. Explicit markers always win; long-form packages must say so.
const PATHWAYS = {
  vertical: {
    key: 'vertical',
    label: 'Short vertical',
    tempo: '1-day build',
    aspect: '9:16',
    max_duration_minutes: 3,
    tempo_hint: 'Shorts tempo: aim to reach the Resolve handoff today — prefer fast, good-enough choices over polish.',
  },
  horizontal: {
    key: 'horizontal',
    label: 'Long-form',
    tempo: 'multi-week build',
    aspect: '16:9',
    max_duration_minutes: 30,
    tempo_hint: 'Long-form tempo: progress one stage at a time — approvals and evidence matter more than speed.',
  },
};

const STAGES = [
  'idea',
  'approved_topic',
  'script',
  'image_prompts',
  'image_generation',
  'image_review',
  'i2v_prompts',
  'video_generation',
  'video_review',
  'resolve_handoff',
  'editing',
  'publish_prep',
  'published',
];
const TERMINAL = ['parked', 'blocked', 'archived'];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function fileNonTrivial(p, minBytes = 40) {
  try { return fs.statSync(p).size >= minBytes; } catch (e) { return false; }
}
function firstExisting(packageDir, rels) {
  for (const rel of rels) {
    const full = path.join(packageDir, rel);
    if (fs.existsSync(full)) return full;
  }
  return '';
}

function readTitle(packageDir) {
  const sp = readJson(path.join(packageDir, 'selected-package.json'));
  if (sp) {
    const pkg = sp.package || sp;
    const t = (pkg.proposedTitle || pkg.title || sp.title || '').trim();
    if (t) return t;
  }
  const yt = readJson(path.join(packageDir, 'youtube-package.json'));
  if (yt && (yt.title || yt.proposedTitle)) return String(yt.title || yt.proposedTitle).trim();
  const man = readJson(path.join(packageDir, 'manifest.json'));
  if (man && (man.title || man.package_name)) return String(man.title || man.package_name).trim();
  return path.basename(packageDir);
}

function readImagePromptCount(packageDir) {
  for (const rel of ['image-prompts.json', path.join('prompts', 'image-prompts.json')]) {
    const j = readJson(path.join(packageDir, rel));
    if (j) {
      if (Array.isArray(j.image_prompts)) return j.image_prompts.length;
      if (Array.isArray(j.prompts)) return j.prompts.length;
      if (Array.isArray(j)) return j.length;
    }
  }
  // CSV fallback
  const csv = firstExisting(packageDir, [path.join('prompts', 'prompts.csv')]);
  if (csv) {
    try {
      const lines = fs.readFileSync(csv, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      return Math.max(0, lines.length - 1);
    } catch (e) { /* ignore */ }
  }
  return 0;
}

function readI2vPromptCount(packageDir) {
  const j = readJson(path.join(packageDir, 'video-prompts.json'));
  if (j && Array.isArray(j.prompts)) return j.prompts.length;
  return 0;
}

function readSelectedCount(packageDir) {
  const j = readJson(path.join(packageDir, 'selected-images.json'));
  return j && Array.isArray(j.selections) ? j.selections.length : 0;
}

// Optional GUI-written status override (park/unpark/mark stage). Single file in
// the package so the GUI can change status without touching pipeline files.
function readStatusOverride(packageDir) {
  const j = readJson(path.join(packageDir, 'project-status.json'));
  return j && typeof j.status === 'string' ? j.status.trim().toLowerCase() : '';
}

// Project provenance. Promoted-from-idea projects carry promoted-from-idea.json;
// otherwise fall back to manifest.source, else a plain script package. A
// malformed/missing sidecar degrades to { source: 'package' } and never throws.
function readProvenance(packageDir) {
  const marker = readJson(path.join(packageDir, 'promoted-from-idea.json'));
  if (marker && marker.source) {
    return {
      source: marker.source,
      idea_date: marker.date || marker.source_date || '',
      idea_index: Number.isInteger(marker.index) ? marker.index : (Number.isInteger(marker.source_idea_index) ? marker.source_idea_index : null),
      premise: marker.premise || '',
      score: typeof marker.score === 'number' ? marker.score : null,
      promoted_at: marker.promoted_at || '',
      // user_topic_scout extras (empty for daily promotions)
      seed_topic: marker.seed_topic || '',
      run_id: marker.run_id || '',
      // Structured "why this scored X" breakdown (null on older projects).
      score_explanation: (marker.score_explanation && typeof marker.score_explanation === 'object') ? marker.score_explanation : null,
    };
  }
  const man = readJson(path.join(packageDir, 'manifest.json'));
  if (man && man.source) return { source: man.source };
  return { source: 'package' };
}

// Explicit pathway tokens only. Unlike workflow-path.js normalizeWorkflowPath
// (which maps ANY unknown value to horizontal for legacy package-runs), an
// unrecognized marker here is treated as absent — a typo must never silently
// relabel a short as long-form or vice versa.
function explicitPathwayKey(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  if (v === 'vertical' || v === 'short' || v === 'shorts' || v === '9:16') return 'vertical';
  if (v === 'horizontal' || v === 'long' || v === 'long-form' || v === 'longform' || v === '16:9') return 'horizontal';
  return '';
}

// Pathway = which production tempo this project runs on (short/1-day vertical
// vs long-form/multi-week). Read from explicit package markers in precedence
// order; without any marker the aigen lane default (vertical) applies and the
// source is reported honestly as 'default'.
function readPathway(packageDir) {
  const statusFile = readJson(path.join(packageDir, 'project-status.json')) || {};
  const manifest = readJson(path.join(packageDir, 'manifest.json')) || {};
  const sp = readJson(path.join(packageDir, 'selected-package.json')) || {};
  const spPkg = (sp && typeof sp.package === 'object' && sp.package) ? sp.package : sp;
  const idea = readJson(path.join(packageDir, 'promoted-from-idea.json')) || {};
  const candidates = [
    ['project-status', statusFile.workflow_path || statusFile.pathway],
    ['manifest', manifest.workflow_path || manifest.video_format || manifest.orientation],
    ['selected-package', spPkg.workflowPath || spPkg.videoFormat || spPkg.video_format],
    ['promoted-idea', idea.videoFormat || idea.video_format],
  ];
  for (const [source, raw] of candidates) {
    const key = explicitPathwayKey(raw);
    if (key) return Object.assign({}, PATHWAYS[key], { source, is_default: false });
  }
  return Object.assign({}, PATHWAYS.vertical, { source: 'default', is_default: true });
}

function resolveProjectState(packageDir, options = {}) {
  const exists = fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory();
  if (!exists) {
    const e = new Error(`Package directory not found: ${packageDir}`);
    e.statusCode = 404;
    throw e;
  }
  const title = readTitle(packageDir);
  const manifest = readJson(path.join(packageDir, 'manifest.json')) || {};

  const hasMetadata = Boolean(
    readJson(path.join(packageDir, 'selected-package.json')) ||
    readJson(path.join(packageDir, 'manifest.json')) ||
    readJson(path.join(packageDir, 'youtube-package.json')),
  );
  const scriptFile = firstExisting(packageDir, [
    path.join('script', 'script-final.md'),
    'script-final.md',
    'final-script.md',
    path.join('script', 'script-draft.md'),
  ]);
  const hasScript = Boolean(scriptFile) && fileNonTrivial(scriptFile);

  const mediaIndex = buildPackageMediaIndex(packageDir);
  const counts = {
    image_prompts: readImagePromptCount(packageDir),
    local_images: mediaIndex.counts.images_local,
    manual_external_images: mediaIndex.counts.images_external,
    selected_images: readSelectedCount(packageDir),
    i2v_prompts: readI2vPromptCount(packageDir),
    local_videos: mediaIndex.counts.videos_local,
    manual_external_videos: mediaIndex.counts.videos_external,
  };
  counts.total_images = counts.local_images + counts.manual_external_images;
  counts.total_videos = counts.local_videos + counts.manual_external_videos;

  const hasHandoff = fs.existsSync(path.join(packageDir, 'resolve-handoff', 'media-manifest.json'));
  // Which clip lane the handoff was built from (recorded in the manifest since
  // the variant work; null for legacy manifests). Purely informational here.
  let handoffVideoVariant = null;
  if (hasHandoff) {
    try {
      const handoffManifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'resolve-handoff', 'media-manifest.json'), 'utf8'));
      if (handoffManifest && handoffManifest.video_variant) handoffVideoVariant = String(handoffManifest.video_variant);
    } catch (e) { /* legacy or unreadable manifest — variant stays unknown */ }
  }

  // Stage = the next action implied by the FURTHEST evidence on disk. Sequential
  // (not else-if) so a gap in an earlier artifact (e.g. images exist but no
  // image-prompts.json) does not drag the project back to an early stage; the
  // furthest milestone wins and the gap is reported as a warning below.
  let stage = 'idea';
  if (hasMetadata) stage = 'script';
  if (hasScript) stage = 'image_prompts';
  if (counts.image_prompts > 0) stage = 'image_generation';
  if (counts.total_images > 0) stage = 'image_review';
  if (counts.selected_images > 0) stage = 'i2v_prompts';
  // Advance to video generation ONLY when every selected image has an I2V prompt
  // (PRESTO Wan2.2 needs a 1:1 prompt-per-image map). A partial set stays in the
  // i2v_prompts stage and is surfaced as a warning below — never advance on a gap.
  if (counts.i2v_prompts > 0 && counts.i2v_prompts >= counts.selected_images) stage = 'video_generation';
  if (counts.total_videos > 0) stage = 'video_review';
  if (hasHandoff) stage = 'resolve_handoff';

  // Status: GUI override wins; else derive from package_state / handoff.
  const override = readStatusOverride(packageDir);
  let status = 'active';
  const pkgState = String(manifest.package_state || '').toLowerCase();
  if (override) status = override;
  else if (/archiv/.test(pkgState)) status = 'archived';
  else if (/publish/.test(pkgState)) status = 'published';
  else if (/park/.test(pkgState)) status = 'parked';

  const blockers = [];
  const warnings = [];
  // Data-gap warnings: later artifacts exist but an earlier one is missing.
  const stageIdx = STAGES.indexOf(stage);
  if (!hasMetadata && stageIdx > STAGES.indexOf('approved_topic')) {
    warnings.push('Project metadata (selected-package.json / manifest.json) is missing although later artifacts exist.');
  }
  if (!hasScript && stageIdx > STAGES.indexOf('script')) {
    warnings.push('No final script found although later artifacts exist.');
  }
  // Partial I2V coverage: some but not all selected images have a prompt. PRESTO
  // needs one prompt per selected image, so the project stays in i2v_prompts.
  if (counts.selected_images > 0 && counts.i2v_prompts > 0 && counts.i2v_prompts < counts.selected_images) {
    warnings.push(`I2V prompt count (${counts.i2v_prompts}) does not match selected image count (${counts.selected_images}). Generate a prompt for every selected image before PRESTO video generation.`);
  }
  // Surface validation warnings from imported external media.
  for (const m of mediaIndex.images.concat(mediaIndex.videos)) {
    if (m.validation && Array.isArray(m.validation.warnings) && m.validation.warnings.length) {
      warnings.push(`${m.path}: ${m.validation.warnings.join('; ')}`);
    }
    if (m.exists === false) warnings.push(`Missing file referenced in manifest: ${m.path}`);
  }

  return {
    project_id: path.basename(packageDir),
    title,
    package_path: packageDir,
    provenance: readProvenance(packageDir),
    pathway: readPathway(packageDir),
    status,
    stage,
    stage_index: STAGES.indexOf(stage),
    stage_total: STAGES.length,
    has_metadata: hasMetadata,
    has_script: hasScript,
    has_resolve_handoff: hasHandoff,
    handoff_video_variant: handoffVideoVariant,
    counts,
    blockers,
    warnings,
  };
}

module.exports = {
  STAGES,
  TERMINAL,
  PATHWAYS,
  resolveProjectState,
  readPathway,
  readProvenance,
  readTitle,
  readImagePromptCount,
  readI2vPromptCount,
  readSelectedCount,
};
