/*
 * VIDTOOLZ unified package media index.
 *
 * Merges locally generated media (FLUX images, Wan2.2 videos) with manually
 * imported external media (GPT images, KlingAI videos) into ONE list per
 * package, each entry carrying explicit provenance. This is what the cockpit
 * gallery / review / Resolve handoff should read so local and external media
 * appear together and are never hidden just because they were not produced by
 * the local pipeline.
 *
 * Read-only. The external sidecar (external-media-manifest.json) is written by
 * the import scripts; this module only reads and merges.
 */

const fs = require('fs');
const path = require('path');

const provenance = require('./media-provenance.js');

const EXTERNAL_MANIFEST = 'external-media-manifest.json';
const FLUX_MANIFEST = 'flux-generation-manifest.json';

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function promptIndexFromName(name) {
  const m = String(name || '').match(/(\d{1,4})(?=\.[a-z0-9]+$)/i);
  return m ? Number(m[1]) : null;
}

// Local FLUX images, from the flux-generation-manifest.json + on-disk files.
function collectLocalImages(packageDir) {
  const manifest = safeReadJson(path.join(packageDir, FLUX_MANIFEST), null);
  const items = manifest && Array.isArray(manifest.items) ? manifest.items : [];
  const out = [];
  for (const it of items) {
    const rel = it.output_path || '';
    if (!rel) continue;
    out.push({
      media_type: 'image',
      generation_mode: 'local',
      generation_provider: 'flux',
      generation_host: 'vidnux',
      prompt_provider: 'ollama',
      prompt_host: 'vidnux',
      workflow: manifest.workflow || 'flux-gguf-1080x1920',
      variant: 'flux-local',
      path: rel,
      prompt_index: Number.isFinite(Number(it.prompt_index)) ? Number(it.prompt_index) : promptIndexFromName(rel),
      status: it.status || 'unknown',
      exists: fs.existsSync(path.join(packageDir, rel)),
    });
  }
  return out;
}

// Local Wan2.2 videos staged under videos/<variant>/<index>.mp4. 'mp4' is the
// legacy fast lane; other folders (e.g. 'mp4-hq-720p') are named generation
// variants — an HQ-only package must not report zero local videos.
const VIDEO_VARIANT_WORKFLOWS = {
  'mp4': 'wan22_i2v_vertical_1080x1920_30fps',
  'mp4-hq-720p': 'wan22_i2v_vertical_720x1280_25fps_101f_hq_no_lightx2v',
};
const SAFE_VARIANT_NAME = /^[A-Za-z0-9._-]+$/;

function collectLocalVideos(packageDir) {
  const videosRoot = path.join(packageDir, 'videos');
  const out = [];
  let variantDirs = [];
  try {
    variantDirs = fs.readdirSync(videosRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && SAFE_VARIANT_NAME.test(e.name));
  } catch (e) {
    return out;
  }
  for (const variantDir of variantDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(videosRoot, variantDir.name), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !provenance.isVideoFile(entry.name)) continue;
      const rel = path.join('videos', variantDir.name, entry.name);
      out.push({
        media_type: 'video',
        generation_mode: 'local',
        generation_provider: 'comfyui_wan22',
        generation_host: 'presto',
        prompt_provider: 'ollama',
        prompt_host: 'presto',
        workflow: VIDEO_VARIANT_WORKFLOWS[variantDir.name] || `wan22_i2v_${variantDir.name}`,
        variant: 'wan22-local',
        video_variant: variantDir.name,
        path: rel,
        prompt_index: promptIndexFromName(entry.name),
        status: 'complete',
        exists: true,
      });
    }
  }
  return out;
}

// Manually imported external media (sidecar manifest written by import scripts).
function collectExternal(packageDir) {
  const manifest = safeReadJson(path.join(packageDir, EXTERNAL_MANIFEST), null);
  const images = manifest && Array.isArray(manifest.images) ? manifest.images : [];
  const videos = manifest && Array.isArray(manifest.videos) ? manifest.videos : [];
  const tag = (arr, type) => arr.map((e) => Object.assign({ media_type: type, exists: e.path ? fs.existsSync(path.join(packageDir, e.path)) : false }, e));
  return { images: tag(images, 'image'), videos: tag(videos, 'video') };
}

function buildPackageMediaIndex(packageDir) {
  const localImages = collectLocalImages(packageDir);
  const localVideos = collectLocalVideos(packageDir);
  const external = collectExternal(packageDir);

  const images = localImages.concat(external.images);
  const videos = localVideos.concat(external.videos);

  const countBy = (arr, mode) => arr.filter((e) => e.generation_mode === mode).length;

  return {
    package: path.basename(packageDir),
    images,
    videos,
    counts: {
      images_total: images.length,
      images_local: countBy(images, 'local'),
      images_external: countBy(images, 'manual_external'),
      videos_total: videos.length,
      videos_local: countBy(videos, 'local'),
      videos_external: countBy(videos, 'manual_external'),
    },
  };
}

module.exports = {
  EXTERNAL_MANIFEST,
  FLUX_MANIFEST,
  safeReadJson,
  promptIndexFromName,
  collectLocalImages,
  collectLocalVideos,
  collectExternal,
  buildPackageMediaIndex,
};
