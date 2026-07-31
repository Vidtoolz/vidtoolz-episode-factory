/*
 * Content-bound authority for the AIGEN package lane.
 *
 * Derived media is never authority merely because a file exists.  This module
 * records the exact upstream and artifact byte revisions accepted at each human
 * or dispatch gate in <package>/authority-chain.json.  Validation is read-only:
 * stale/unbound/corrupt state is reported without deleting historical outputs.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTHORITY_FILE = 'authority-chain.json';
const SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 100;
const STAGE_ORDER = [
  'image_prompts',
  'selected_images',
  'i2v_prompts',
  'videos',
  'resolve_handoff',
];
const FINAL_SCRIPT_PATHS = [
  path.join('script', 'script-final.md'),
  'script-final.md',
  'final-script.md',
];
const FILE_HASH_CACHE = new Map();
const FILE_HASH_CACHE_LIMIT = 2048;

function authorityError(message, code = 'AUTHORITY_INVALID', statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableHash(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function sha256File(filePath) {
  const stat = fs.statSync(filePath);
  const cached = FILE_HASH_CACHE.get(filePath);
  if (cached
      && cached.size === stat.size
      && cached.mtime_ms === stat.mtimeMs
      && cached.ctime_ms === stat.ctimeMs) {
    return cached.sha256;
  }
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const sha256 = hash.digest('hex');
  FILE_HASH_CACHE.set(filePath, {
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    ctime_ms: stat.ctimeMs,
    sha256,
  });
  if (FILE_HASH_CACHE.size > FILE_HASH_CACHE_LIMIT) {
    FILE_HASH_CACHE.delete(FILE_HASH_CACHE.keys().next().value);
  }
  return sha256;
}

function confinedFile(packageDir, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || path.posix.isAbsolute(rel) || rel.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw authorityError(`Authority path is invalid: ${rel || '(empty)'}`, 'AUTHORITY_PATH_INVALID');
  }
  const root = path.resolve(packageDir);
  const absolute = path.resolve(root, rel);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw authorityError(`Authority path escapes the package: ${rel}`, 'AUTHORITY_PATH_INVALID');
  }
  return { rel, absolute };
}

function fileSnapshot(packageDir, relativePath) {
  const target = confinedFile(packageDir, relativePath);
  let stat;
  try {
    stat = fs.statSync(target.absolute);
  } catch (_) {
    throw authorityError(`Authority input is missing: ${target.rel}`, 'AUTHORITY_INPUT_MISSING');
  }
  if (!stat.isFile()) {
    throw authorityError(`Authority input is not a file: ${target.rel}`, 'AUTHORITY_INPUT_INVALID');
  }
  return {
    path: target.rel,
    sha256: sha256File(target.absolute),
    size_bytes: stat.size,
  };
}

function jsonObject(packageDir, relativePath) {
  const target = confinedFile(packageDir, relativePath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target.absolute, 'utf8'));
  } catch (_) {
    throw authorityError(`Authority input is unreadable JSON: ${target.rel}`, 'AUTHORITY_INPUT_CORRUPT');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw authorityError(`Authority input has an invalid shape: ${target.rel}`, 'AUTHORITY_INPUT_CORRUPT');
  }
  return parsed;
}

function finalScriptSnapshot(packageDir) {
  for (const rel of FINAL_SCRIPT_PATHS) {
    const target = path.join(packageDir, rel);
    if (fs.existsSync(target)) return fileSnapshot(packageDir, rel);
  }
  throw authorityError('No final script exists to serve as AIGEN authority.', 'SCRIPT_AUTHORITY_MISSING', 422);
}

function simpleArtifactSnapshot(packageDir, relativePath) {
  const file = fileSnapshot(packageDir, relativePath);
  return { revision: stableHash(file), files: [file] };
}

function slottedJsonArtifactSnapshot(packageDir, relativePath, arrayKey, indexKeys) {
  const data = jsonObject(packageDir, relativePath);
  const items = data[arrayKey];
  if (!Array.isArray(items) || items.length === 0) {
    throw authorityError(
      `${relativePath} has no valid ${arrayKey} array to bind.`,
      'AUTHORITY_INPUT_CORRUPT',
    );
  }
  const seen = new Set();
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw authorityError(`${relativePath} ${arrayKey} item ${position + 1} is malformed.`, 'AUTHORITY_INPUT_CORRUPT');
    }
    const rawIndex = indexKeys.map((key) => item[key]).find((value) => value != null);
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index <= 0 || seen.has(index)) {
      throw authorityError(
        `${relativePath} ${arrayKey} item ${position + 1} has an invalid or duplicate slot identity.`,
        'AUTHORITY_INPUT_CORRUPT',
      );
    }
    seen.add(index);
  }
  return simpleArtifactSnapshot(packageDir, relativePath);
}

function selectedImagesSnapshot(packageDir) {
  const data = jsonObject(packageDir, 'selected-images.json');
  if (!Array.isArray(data.selections) || data.selections.length === 0) {
    throw authorityError('selected-images.json has no selections to bind.', 'SELECTION_AUTHORITY_MISSING', 422);
  }
  const manifest = fileSnapshot(packageDir, 'selected-images.json');
  const assets = data.selections.map((selection, position) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw authorityError(`selected-images.json selection ${position + 1} is malformed.`, 'SELECTION_AUTHORITY_CORRUPT');
    }
    const index = Number(selection.prompt_index == null ? selection.index : selection.prompt_index);
    if (!Number.isInteger(index) || index <= 0) {
      throw authorityError(`selected-images.json selection ${position + 1} has no valid slot identity.`, 'SELECTION_AUTHORITY_CORRUPT');
    }
    const source = fileSnapshot(packageDir, selection.selected_path || selection.path);
    return { prompt_index: index, ...source };
  }).sort((a, b) => a.prompt_index - b.prompt_index);
  return {
    revision: stableHash({ manifest, assets }),
    files: [manifest],
    assets,
  };
}

function selectedIndexes(packageDir) {
  return selectedImagesSnapshot(packageDir).assets.map((item) => item.prompt_index);
}

function normalizeIndexes(indexes) {
  const normalized = [...new Set((Array.isArray(indexes) ? indexes : [])
    .map(Number)
    .filter((index) => Number.isInteger(index) && index > 0))].sort((a, b) => a - b);
  if (!normalized.length) {
    throw authorityError('At least one positive slot index is required.', 'AUTHORITY_INDEXES_MISSING', 422);
  }
  return normalized;
}

function videoSlotSnapshot(packageDir, variant, index) {
  const safeVariant = String(variant || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(safeVariant)) {
    throw authorityError(`Invalid video variant: ${safeVariant || '(empty)'}`, 'AUTHORITY_VARIANT_INVALID', 400);
  }
  const rel = path.posix.join('videos', safeVariant, `${String(index).padStart(3, '0')}.mp4`);
  const file = fileSnapshot(packageDir, rel);
  return {
    prompt_index: index,
    variant: safeVariant,
    revision: stableHash({ prompt_index: index, variant: safeVariant, file }),
    file,
  };
}

function currentSourceRevisions(packageDir, stage) {
  const script = finalScriptSnapshot(packageDir);
  const sources = { script: stableHash(script) };
  if (stage === 'image_prompts') return sources;
  const imagePrompts = simpleArtifactSnapshot(packageDir, 'image-prompts.json');
  sources.image_prompts = imagePrompts.revision;
  if (stage === 'selected_images') return sources;
  const selections = selectedImagesSnapshot(packageDir);
  sources.selected_images = selections.revision;
  if (stage === 'i2v_prompts') return sources;
  const i2v = simpleArtifactSnapshot(packageDir, 'video-prompts.json');
  sources.i2v_prompts = i2v.revision;
  return sources;
}

function captureSourceRevisions(packageDir, stage) {
  return currentSourceRevisions(packageDir, stage);
}

function stageArtifactSnapshot(packageDir, stage) {
  if (stage === 'image_prompts') {
    return slottedJsonArtifactSnapshot(packageDir, 'image-prompts.json', 'image_prompts', ['index', 'prompt_index']);
  }
  if (stage === 'selected_images') return selectedImagesSnapshot(packageDir);
  if (stage === 'i2v_prompts') {
    return slottedJsonArtifactSnapshot(packageDir, 'video-prompts.json', 'prompts', ['prompt_index', 'index']);
  }
  if (stage === 'resolve_handoff') {
    return slottedJsonArtifactSnapshot(
      packageDir,
      path.join('resolve-handoff', 'media-manifest.json'),
      'clips',
      ['prompt_index', 'index'],
    );
  }
  throw authorityError(`Unsupported authority stage: ${stage}`, 'AUTHORITY_STAGE_INVALID', 400);
}

function readAuthorityLedger(packageDir, options = {}) {
  const ledgerPath = path.join(packageDir, AUTHORITY_FILE);
  if (!fs.existsSync(ledgerPath)) return null;
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (_) {
    throw authorityError(
      `${AUTHORITY_FILE} exists but is unreadable; refusing to treat authority as empty.`,
      'AUTHORITY_LEDGER_CORRUPT',
    );
  }
  const valid = ledger
    && typeof ledger === 'object'
    && !Array.isArray(ledger)
    && ledger.schema_version === SCHEMA_VERSION
    && ledger.stages
    && typeof ledger.stages === 'object'
    && !Array.isArray(ledger.stages)
    && (!Object.prototype.hasOwnProperty.call(ledger, 'history') || Array.isArray(ledger.history));
  if (!valid) {
    throw authorityError(
      `${AUTHORITY_FILE} has an invalid shape; refusing to treat authority as empty.`,
      'AUTHORITY_LEDGER_CORRUPT',
    );
  }
  if (!options.allowProjectMismatch && ledger.project_id !== path.basename(packageDir)) {
    throw authorityError(
      `${AUTHORITY_FILE} belongs to project "${ledger.project_id}", not "${path.basename(packageDir)}".`,
      'AUTHORITY_PROJECT_MISMATCH',
    );
  }
  return ledger;
}

function newLedger(packageDir, nowIso) {
  return {
    schema_version: SCHEMA_VERSION,
    project_id: path.basename(packageDir),
    updated_at: nowIso,
    stages: {},
    history: [],
  };
}

function writeAuthorityLedger(packageDir, ledger) {
  const ledgerPath = path.join(packageDir, AUTHORITY_FILE);
  const tmp = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, ledgerPath);
  return ledgerPath;
}

function invalidResult(stage, status, message, code, extra = {}) {
  return {
    ok: false,
    stage,
    status,
    code,
    message,
    ...extra,
  };
}

function validatePrerequisite(packageDir, stage, ledger) {
  if (stage === 'selected_images') return validateStage(packageDir, 'image_prompts', { ledger });
  if (stage === 'i2v_prompts') return validateStage(packageDir, 'selected_images', { ledger });
  if (stage === 'videos') return validateStage(packageDir, 'i2v_prompts', { ledger });
  if (stage === 'resolve_handoff') return validateStage(packageDir, 'videos', { ledger });
  return { ok: true };
}

function validateVideoStage(packageDir, record, ledger, options = {}) {
  const prerequisite = validatePrerequisite(packageDir, 'videos', ledger);
  if (!prerequisite.ok) {
    return invalidResult('videos', 'stale', `Video authority is blocked by ${prerequisite.stage}: ${prerequisite.message}`, 'UPSTREAM_AUTHORITY_INVALID', { upstream: prerequisite });
  }
  if (!record || typeof record !== 'object' || Array.isArray(record) || !record.slots || typeof record.slots !== 'object' || Array.isArray(record.slots)) {
    return invalidResult('videos', 'unbound', 'Rendered clips are not content-bound to the current selected images and I2V prompts.', 'VIDEO_AUTHORITY_UNBOUND');
  }
  if (record.invalidated_at) {
    return invalidResult('videos', 'stale', record.invalidation_reason || 'Rendered clip authority was invalidated by an upstream change.', 'VIDEO_AUTHORITY_INVALIDATED');
  }
  let indexes;
  try {
    indexes = normalizeIndexes(options.indexes || record.indexes || selectedIndexes(packageDir));
  } catch (error) {
    return invalidResult('videos', 'stale', error.message, error.code || 'VIDEO_AUTHORITY_INVALID');
  }
  const variant = String(options.variant || record.variant || '').trim();
  const sources = currentSourceRevisions(packageDir, 'videos');
  for (const index of indexes) {
    const slot = record.slots[String(index)];
    if (!slot || slot.variant !== variant) {
      return invalidResult('videos', 'unbound', `Video slot ${index} (${variant}) has no recorded content authority.`, 'VIDEO_SLOT_AUTHORITY_UNBOUND', { prompt_index: index, variant });
    }
    if (slot.invalidated_at) {
      return invalidResult('videos', 'stale', slot.invalidation_reason || `Video slot ${index} authority was invalidated.`, 'VIDEO_SLOT_AUTHORITY_INVALIDATED', { prompt_index: index, variant });
    }
    let current;
    try {
      current = videoSlotSnapshot(packageDir, variant, index);
    } catch (error) {
      return invalidResult('videos', 'stale', error.message, error.code || 'VIDEO_SLOT_MISSING', { prompt_index: index, variant });
    }
    if (current.revision !== slot.artifact_revision) {
      return invalidResult('videos', 'stale', `Video slot ${index} bytes changed after authority was recorded.`, 'VIDEO_SLOT_BYTES_STALE', { prompt_index: index, variant });
    }
    if (stableHash(sources) !== stableHash(slot.source_revisions || {})) {
      return invalidResult('videos', 'stale', `Video slot ${index} was rendered from obsolete selected-image or I2V authority.`, 'VIDEO_SLOT_SOURCE_STALE', { prompt_index: index, variant });
    }
  }
  return { ok: true, stage: 'videos', status: 'fresh', code: 'AUTHORITY_FRESH', variant, indexes };
}

function validateStage(packageDir, stage, options = {}) {
  let ledger = options.ledger;
  try {
    if (!ledger) ledger = readAuthorityLedger(packageDir);
  } catch (error) {
    return invalidResult(stage, 'corrupt', error.message, error.code || 'AUTHORITY_LEDGER_CORRUPT');
  }
  if (!ledger) {
    return invalidResult(stage, 'unbound', `${AUTHORITY_FILE} is missing; derived AIGEN work is not content-bound.`, 'AUTHORITY_LEDGER_MISSING');
  }
  const record = ledger.stages[stage];
  if (stage === 'videos') return validateVideoStage(packageDir, record, ledger, options);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return invalidResult(stage, 'unbound', `${stage} has no recorded content authority.`, 'AUTHORITY_STAGE_UNBOUND');
  }
  if (record.invalidated_at) {
    return invalidResult(stage, 'stale', record.invalidation_reason || `${stage} authority was invalidated by an upstream change.`, 'AUTHORITY_STAGE_INVALIDATED');
  }
  const prerequisite = validatePrerequisite(packageDir, stage, ledger);
  if (!prerequisite.ok) {
    return invalidResult(stage, 'stale', `${stage} authority is blocked by ${prerequisite.stage}: ${prerequisite.message}`, 'UPSTREAM_AUTHORITY_INVALID', { upstream: prerequisite });
  }
  let artifact;
  let sources;
  try {
    artifact = stageArtifactSnapshot(packageDir, stage);
    sources = currentSourceRevisions(packageDir, stage);
  } catch (error) {
    return invalidResult(stage, 'stale', error.message, error.code || 'AUTHORITY_INPUT_INVALID');
  }
  if (artifact.revision !== record.artifact_revision) {
    return invalidResult(stage, 'stale', `${stage} bytes changed after authority was recorded.`, 'AUTHORITY_ARTIFACT_STALE');
  }
  if (stableHash(sources) !== stableHash(record.source_revisions || {})) {
    return invalidResult(stage, 'stale', `${stage} was derived from obsolete upstream authority.`, 'AUTHORITY_SOURCE_STALE');
  }
  if (stage === 'resolve_handoff') {
    const videoCheck = validateVideoStage(packageDir, ledger.stages.videos, ledger, {
      variant: record.video_variant,
      indexes: record.included_indexes,
    });
    if (!videoCheck.ok) {
      return invalidResult(stage, 'stale', `Resolve handoff is blocked by video authority: ${videoCheck.message}`, 'UPSTREAM_AUTHORITY_INVALID', { upstream: videoCheck });
    }
  }
  return { ok: true, stage, status: 'fresh', code: 'AUTHORITY_FRESH' };
}

function archiveRecord(ledger, stage, record, nowIso) {
  if (!record) return;
  ledger.history = Array.isArray(ledger.history) ? ledger.history : [];
  ledger.history.push({ stage, superseded_at: nowIso, record });
  if (ledger.history.length > HISTORY_LIMIT) {
    ledger.history = ledger.history.slice(ledger.history.length - HISTORY_LIMIT);
  }
}

function invalidateDownstreamRecords(ledger, stage, nowIso, reason) {
  const index = stage === 'script' ? -1 : STAGE_ORDER.indexOf(stage);
  for (let i = index + 1; i < STAGE_ORDER.length; i += 1) {
    const downstream = ledger.stages[STAGE_ORDER[i]];
    if (!downstream || downstream.invalidated_at) continue;
    downstream.invalidated_at = nowIso;
    downstream.invalidation_reason = reason || `${STAGE_ORDER[i]} invalidated because ${stage} changed.`;
    if (STAGE_ORDER[i] === 'videos' && downstream.slots && typeof downstream.slots === 'object') {
      Object.values(downstream.slots).forEach((slot) => {
        if (!slot.invalidated_at) {
          slot.invalidated_at = nowIso;
          slot.invalidation_reason = downstream.invalidation_reason;
        }
      });
    }
  }
}

function recordStage(packageDir, stage, options = {}) {
  if (!STAGE_ORDER.includes(stage) || stage === 'videos') {
    throw authorityError(`Unsupported record stage: ${stage}`, 'AUTHORITY_STAGE_INVALID', 400);
  }
  const nowIso = options.nowIso || new Date().toISOString();
  let ledger = readAuthorityLedger(packageDir) || newLedger(packageDir, nowIso);
  const prerequisite = validatePrerequisite(packageDir, stage, ledger);
  if (!prerequisite.ok) {
    throw authorityError(
      `Cannot bind ${stage}: ${prerequisite.message}`,
      'UPSTREAM_AUTHORITY_INVALID',
    );
  }
  const artifact = stageArtifactSnapshot(packageDir, stage);
  const sourceRevisions = currentSourceRevisions(packageDir, stage);
  const previous = ledger.stages[stage];
  archiveRecord(ledger, stage, previous, nowIso);
  const record = {
    recorded_at: nowIso,
    artifact_revision: artifact.revision,
    source_revisions: sourceRevisions,
  };
  if (stage === 'selected_images') {
    record.selected_indexes = artifact.assets.map((item) => item.prompt_index);
    record.selected_asset_revisions = artifact.assets.map((item) => ({
      prompt_index: item.prompt_index,
      path: item.path,
      sha256: item.sha256,
    }));
  }
  if (stage === 'resolve_handoff') {
    record.video_variant = String(options.variant || '').trim();
    record.included_indexes = normalizeIndexes(options.indexes);
  }
  ledger.stages[stage] = record;
  invalidateDownstreamRecords(ledger, stage, nowIso, `${stage} was re-recorded; downstream evidence requires explicit re-approval.`);
  ledger.updated_at = nowIso;
  ledger.script_authority = finalScriptSnapshot(packageDir);
  writeAuthorityLedger(packageDir, ledger);
  return record;
}

function recordVideoSlots(packageDir, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const variant = String(options.variant || '').trim();
  const indexes = normalizeIndexes(options.indexes);
  let ledger = readAuthorityLedger(packageDir) || newLedger(packageDir, nowIso);
  const prerequisite = validatePrerequisite(packageDir, 'videos', ledger);
  if (!prerequisite.ok) {
    throw authorityError(`Cannot bind rendered clips: ${prerequisite.message}`, 'UPSTREAM_AUTHORITY_INVALID');
  }
  const sources = currentSourceRevisions(packageDir, 'videos');
  if (options.expectedSourceRevisions
      && stableHash(sources) !== stableHash(options.expectedSourceRevisions)) {
    throw authorityError(
      'Rendered clip inputs changed after dispatch; refusing to bind the outputs to newer authority.',
      'VIDEO_DISPATCH_AUTHORITY_DRIFT',
    );
  }
  let record = ledger.stages.videos;
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.variant !== variant || record.invalidated_at) {
    archiveRecord(ledger, 'videos', record, nowIso);
    record = { recorded_at: nowIso, variant, indexes: [], slots: {} };
  }
  for (const index of indexes) {
    const snapshot = videoSlotSnapshot(packageDir, variant, index);
    record.slots[String(index)] = {
      recorded_at: nowIso,
      variant,
      artifact_revision: snapshot.revision,
      artifact: snapshot.file,
      source_revisions: sources,
    };
  }
  record.recorded_at = nowIso;
  record.indexes = [...new Set(Object.keys(record.slots).map(Number))].sort((a, b) => a - b);
  delete record.invalidated_at;
  delete record.invalidation_reason;
  ledger.stages.videos = record;
  invalidateDownstreamRecords(ledger, 'videos', nowIso, 'Rendered video authority changed; the Resolve handoff requires explicit regeneration.');
  ledger.updated_at = nowIso;
  ledger.script_authority = finalScriptSnapshot(packageDir);
  writeAuthorityLedger(packageDir, ledger);
  return record;
}

function invalidateFrom(packageDir, stage, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  let ledger = readAuthorityLedger(packageDir);
  if (!ledger) ledger = newLedger(packageDir, nowIso);
  invalidateDownstreamRecords(
    ledger,
    stage,
    nowIso,
    options.reason || `${stage} authority changed; downstream evidence is stale until explicitly regenerated or re-approved.`,
  );
  ledger.updated_at = nowIso;
  if (stage === 'script') ledger.script_authority = finalScriptSnapshot(packageDir);
  writeAuthorityLedger(packageDir, ledger);
  return ledger;
}

function assertStageFresh(packageDir, stage, options = {}) {
  const result = validateStage(packageDir, stage, options);
  if (!result.ok) {
    throw authorityError(
      `${stage} authority is ${result.status}: ${result.message}`,
      result.code || 'AUTHORITY_STALE',
    );
  }
  return result;
}

function inspectAuthorityChain(packageDir) {
  const results = {};
  let firstInvalid = null;
  for (const stage of STAGE_ORDER) {
    const result = validateStage(packageDir, stage);
    results[stage] = result;
    if (!firstInvalid && !result.ok) firstInvalid = result;
  }
  return {
    ok: !firstInvalid,
    project_id: path.basename(packageDir),
    authority_file: AUTHORITY_FILE,
    first_invalid: firstInvalid,
    stages: results,
  };
}

module.exports = {
  AUTHORITY_FILE,
  FINAL_SCRIPT_PATHS,
  HISTORY_LIMIT,
  SCHEMA_VERSION,
  STAGE_ORDER,
  assertStageFresh,
  captureSourceRevisions,
  fileSnapshot,
  finalScriptSnapshot,
  inspectAuthorityChain,
  invalidateFrom,
  readAuthorityLedger,
  recordStage,
  recordVideoSlots,
  selectedImagesSnapshot,
  sha256File,
  stableHash,
  validateStage,
  videoSlotSnapshot,
  writeAuthorityLedger,
};
