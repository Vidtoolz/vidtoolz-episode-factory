'use strict';

/*
 * Canonical background identity for V2 VISUAL_DRAFT script backgrounds.
 *
 * Repairs the Codex-certified provenance-laundering defect (ce919f3):
 * uniqueness was computed from whatever provenance object the caller supplied,
 * so a lossless re-encode with a stripped wrapper became a "new" background.
 *
 * Two identities, two purposes (both required; either colliding is reuse):
 *
 *   PIXEL FINGERPRINT — canonical decoded-pixel identity. Catches the exact
 *   same visual under a new filename, new encoding, new metadata, new
 *   compression, new asset id, new wrapper. Computed from the actual bytes by
 *   the trusted resolver, never accepted from the caller.
 *
 *   ROOT BACKGROUND IDENTITY — canonical source lineage. Catches canonical
 *   derivatives (crop/zoom/mirror/recolor/treatment) whose pixels legitimately
 *   differ but which are still the same human-rule background source.
 *
 * Authority model (same principle as the certified authority work):
 *   caller references an asset -> the trusted path establishes what it is.
 *   - A ROOT-class identity is CONTENT-ADDRESSED: root_background_identity is
 *     a fixed formula over the pixel fingerprint. The caller cannot mint,
 *     rename, or launder a root: identical decoded pixels always resolve to
 *     the identical root, and the formula is re-checked at validation.
 *   - A DERIVED asset inherits its parent's root through
 *     registerDerivedBackground(); it cannot omit lineage, and its claimed
 *     root must equal its verified parent's root.
 *
 * Honest trust boundary (documented, not hidden): if a human externally
 *  transforms an image beyond exact decoded-pixel equality, destroys all
 *  lineage, and imports it as a genuinely new opaque root, only perceptual
 *  similarity could prove the relationship — deliberately out of scope. The
 *  canonical pipeline's OWN paths cannot strip lineage, and exact decoded
 *  duplicates are caught regardless of wrapper.
 *
 * Pixel fingerprint canonicalization (PIXEL_FINGERPRINT_ALGORITHM):
 *   decode via ffmpeg -> first video frame (the whole image for stills) ->
 *   format=rgba (8-bit straight alpha, RGBA channel order, row-major
 *   top-to-bottom rawvideo, no metadata, no container) ->
 *   sha256("VIDTOOLZ_PIXELS_V1|w=<width>|h=<height>|fmt=rgba8_straight|" + raw pixel bytes).
 *   Width/height are part of the hashed header, so the byte stream is never
 *   ambiguous. Alpha is preserved (straight), so visually different alpha
 *   content never collapses to the same identity.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const IDENTITY_SCHEMA = 'vidtoolz.backgroundIdentity.v1';
const PIXEL_FINGERPRINT_ALGORITHM = 'VIDTOOLZ_PIXELS_V1';
const ROOT_IDENTITY_ALGORITHM = 'VIDTOOLZ_BACKGROUND_ROOT_V1';
const ROOT_SOURCE_CLASSES = Object.freeze(['ROOT_GENERATED_ASSET', 'ROOT_DETERMINISTIC_ASSET', 'REGISTERED_IMPORT']);
const SOURCE_CLASSES = Object.freeze([...ROOT_SOURCE_CLASSES, 'DERIVED_ASSET']);
const CANONICAL_TREATMENTS = Object.freeze(['CROP', 'ZOOM', 'REFRAME', 'MIRROR', 'RECOLOR', 'BLUR', 'TREATMENT_VARIANT']);
const SHA_RE = /^[a-f0-9]{64}$/;

class BackgroundIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackgroundIdentityError';
    this.code = code;
  }
}
function fail(code, message) { throw new BackgroundIdentityError(code, message); }

function probeDimensions(filePath) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath], { encoding: 'utf8', timeout: 60000 }).trim();
  const [width, height] = out.split(',').map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) fail('BACKGROUND_PIXELS_UNDECODABLE', `${filePath}: no decodable raster dimensions`);
  return { width, height };
}

/* Canonical decoded-pixel fingerprint. Trusted: always computed from bytes. */
function computePixelFingerprint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) fail('BACKGROUND_SOURCE_MISSING', String(filePath));
  const { width, height } = probeDimensions(filePath);
  let raw;
  try {
    raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-vf', 'format=rgba', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  } catch (error) { fail('BACKGROUND_PIXELS_UNDECODABLE', `${filePath}: ${String(error.message).slice(0, 200)}`); }
  if (!Buffer.isBuffer(raw) || raw.length !== width * height * 4) fail('BACKGROUND_PIXELS_UNDECODABLE', `${filePath}: decoded ${raw?.length ?? 0} bytes, expected ${width * height * 4}`);
  const hash = crypto.createHash('sha256');
  hash.update(`${PIXEL_FINGERPRINT_ALGORITHM}|w=${width}|h=${height}|fmt=rgba8_straight|`);
  hash.update(raw);
  return { algorithm: PIXEL_FINGERPRINT_ALGORITHM, pixel_fingerprint_sha256: hash.digest('hex'), width, height };
}

/* Content-addressed root: the fixed public formula. Identical decoded pixels
 * always resolve to the identical root; a caller-invented root cannot satisfy
 * the formula, so root identity is never free text. */
function deriveRootIdentity(pixelFingerprintSha256) {
  if (!SHA_RE.test(pixelFingerprintSha256 || '')) fail('BACKGROUND_FINGERPRINT_INVALID', String(pixelFingerprintSha256));
  return crypto.createHash('sha256').update(`${ROOT_IDENTITY_ALGORITHM}|${pixelFingerprintSha256}`).digest('hex');
}

/*
 * Register a genuinely new ROOT background from its canonical materialization.
 * Identity is derived from actual content — caller-supplied root/fingerprint
 * fields are refused, not merged.
 */
function registerRootBackground({ path: filePath, source_class: sourceClass, materialization } = {}, options = {}) {
  if (!ROOT_SOURCE_CLASSES.includes(sourceClass)) fail('BACKGROUND_SOURCE_CLASS_INVALID', `${sourceClass}: a root registration must be a root source class`);
  if (arguments[0] && ('root_background_identity' in arguments[0] || 'pixel_fingerprint_sha256' in arguments[0])) fail('BACKGROUND_ROOT_NOT_CALLER_MINTABLE', 'identity is derived from canonical content, never accepted from the caller');
  const fingerprint = (options.computePixelFingerprint || computePixelFingerprint)(filePath);
  return {
    schema: IDENTITY_SCHEMA,
    source_class: sourceClass,
    root_background_identity: deriveRootIdentity(fingerprint.pixel_fingerprint_sha256),
    pixel_fingerprint_sha256: fingerprint.pixel_fingerprint_sha256,
    fingerprint_algorithm: PIXEL_FINGERPRINT_ALGORITHM,
    width: fingerprint.width,
    height: fingerprint.height,
    parent: null,
    materialization: materialization && typeof materialization === 'object' ? materialization : null,
  };
}

/*
 * Register a canonical derivative (crop/zoom/mirror/recolor/...). The
 * derivative INHERITS the parent's root — a fresh root is never minted just
 * because pixels changed. The parent record is re-verified first.
 */
function registerDerivedBackground({ parent, path: filePath, treatment } = {}, options = {}) {
  validateBackgroundIdentityShape(parent, 'parent');
  if (!CANONICAL_TREATMENTS.includes(treatment)) fail('BACKGROUND_TREATMENT_INVALID', String(treatment));
  const fingerprint = (options.computePixelFingerprint || computePixelFingerprint)(filePath);
  return {
    schema: IDENTITY_SCHEMA,
    source_class: 'DERIVED_ASSET',
    root_background_identity: parent.root_background_identity,
    pixel_fingerprint_sha256: fingerprint.pixel_fingerprint_sha256,
    fingerprint_algorithm: PIXEL_FINGERPRINT_ALGORITHM,
    width: fingerprint.width,
    height: fingerprint.height,
    parent: {
      pixel_fingerprint_sha256: parent.pixel_fingerprint_sha256,
      root_background_identity: parent.root_background_identity,
      source_class: parent.source_class,
      treatment,
    },
    materialization: null,
  };
}

/*
 * Pure structural validation of an identity record — usable by the pure
 * composition engine. The root formula is public and deterministic, so even
 * without file access a laundered record cannot pass:
 *   - a ROOT-class record's root must equal deriveRootIdentity(fingerprint);
 *   - a DERIVED record must carry its parent lineage and match the parent's
 *     root, and the parent's own root must satisfy the formula when the
 *     parent is a root class.
 * The trusted resolver (renderer) additionally recomputes the fingerprint
 * from the actual bytes, closing the last laundering path.
 */
function validateBackgroundIdentityShape(record, label = 'background_identity') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: canonical background identity is required and {} is not evidence`);
  for (const key of Object.keys(record)) if (!['schema', 'source_class', 'root_background_identity', 'pixel_fingerprint_sha256', 'fingerprint_algorithm', 'width', 'height', 'parent', 'materialization'].includes(key)) fail('BACKGROUND_IDENTITY_INVALID', `${label}.${key}`);
  if (record.schema !== IDENTITY_SCHEMA) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: schema ${record.schema || 'missing'}`);
  if (!SOURCE_CLASSES.includes(record.source_class)) fail('BACKGROUND_SOURCE_CLASS_INVALID', `${label}: ${record.source_class}`);
  if (!SHA_RE.test(record.pixel_fingerprint_sha256 || '')) fail('BACKGROUND_FINGERPRINT_INVALID', label);
  if (record.fingerprint_algorithm !== PIXEL_FINGERPRINT_ALGORITHM) fail('BACKGROUND_FINGERPRINT_INVALID', `${label}: algorithm ${record.fingerprint_algorithm}`);
  if (!SHA_RE.test(record.root_background_identity || '')) fail('BACKGROUND_ROOT_IDENTITY_INVALID', label);
  if (!Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width <= 0 || record.height <= 0) fail('BACKGROUND_IDENTITY_INVALID', `${label}: dimensions`);
  if (ROOT_SOURCE_CLASSES.includes(record.source_class)) {
    if (record.parent != null) fail('BACKGROUND_IDENTITY_INVALID', `${label}: a root carries no parent`);
    if (record.root_background_identity !== deriveRootIdentity(record.pixel_fingerprint_sha256)) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: root does not derive from canonical content — caller-minted roots are refused`);
  } else {
    const parent = record.parent;
    if (!parent || typeof parent !== 'object') fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: a derived asset cannot omit its parent lineage`);
    if (!SHA_RE.test(parent.pixel_fingerprint_sha256 || '') || !SHA_RE.test(parent.root_background_identity || '')) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: parent lineage incomplete`);
    if (!SOURCE_CLASSES.includes(parent.source_class)) fail('BACKGROUND_SOURCE_CLASS_INVALID', `${label}: parent ${parent.source_class}`);
    if (!CANONICAL_TREATMENTS.includes(parent.treatment)) fail('BACKGROUND_TREATMENT_INVALID', `${label}: ${parent.treatment}`);
    if (record.root_background_identity !== parent.root_background_identity) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: a derivative inherits its parent's root`);
    if (ROOT_SOURCE_CLASSES.includes(parent.source_class) && parent.root_background_identity !== deriveRootIdentity(parent.pixel_fingerprint_sha256)) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: parent root does not derive from canonical content`);
  }
  return true;
}

/*
 * Trusted resolution for one manifest asset: recompute the fingerprint from
 * the actual bytes and require the claimed record to match it exactly. Any
 * wrapper that lies about content fails closed here.
 */
function resolveBackgroundIdentity(asset, options = {}) {
  validateBackgroundIdentityShape(asset?.background_identity, asset?.asset_id || 'asset');
  const record = asset.background_identity;
  const measured = (options.computePixelFingerprint || computePixelFingerprint)(asset.path);
  if (measured.pixel_fingerprint_sha256 !== record.pixel_fingerprint_sha256) fail('BACKGROUND_FINGERPRINT_MISMATCH', `${asset.asset_id}: claimed decoded-pixel identity does not match the actual bytes`);
  if (measured.width !== record.width || measured.height !== record.height) fail('BACKGROUND_FINGERPRINT_MISMATCH', `${asset.asset_id}: claimed dimensions do not match decoded content`);
  return { ...record, verified_from_bytes: true };
}

module.exports = {
  IDENTITY_SCHEMA,
  PIXEL_FINGERPRINT_ALGORITHM,
  ROOT_IDENTITY_ALGORITHM,
  ROOT_SOURCE_CLASSES,
  SOURCE_CLASSES,
  CANONICAL_TREATMENTS,
  BackgroundIdentityError,
  computePixelFingerprint,
  deriveRootIdentity,
  registerRootBackground,
  registerDerivedBackground,
  validateBackgroundIdentityShape,
  resolveBackgroundIdentity,
};
