'use strict';

/*
 * Canonical background identity for V2 VISUAL_DRAFT script backgrounds.
 *
 * Two certified defects shaped this module:
 *
 *  ce919f3 (Codex: LOSSLESS_REENCODE_STRIPPED_SOURCE_IDENTITY) — uniqueness
 *  was computed from caller-supplied provenance. Closed by the canonical
 *  decoded-pixel fingerprint plus content-addressed roots.
 *
 *  ce2e6e1 (Codex: DERIVED ASSET PATH CAN DROP ROOT LINEAGE) — derivative
 *  registration accepted a caller-supplied parent RECORD; a fabricated but
 *  formula-valid parent re-rooted a real mirror derivative. Closed here by
 *  the canonical background asset registry: a derivative caller may NAME a
 *  parent (parent_asset_id); it may never DEFINE the parent. The trusted
 *  resolver establishes the parent from canonical registered state, and the
 *  child inherits exactly that parent's root. Integrity is not authority:
 *  valid hashes and valid formulas do not make a record canonical —
 *  registration in the registry does.
 *
 * Identity model (unchanged in meaning):
 *
 *   PIXEL FINGERPRINT — canonical decoded-pixel identity, always computed
 *   from actual bytes by trusted code. Catches the same visual under any
 *   filename/encoding/metadata/wrapper.
 *
 *   ROOT BACKGROUND IDENTITY — canonical source lineage. Roots are
 *   content-addressed by a fixed public formula; derivatives inherit their
 *   CANONICAL parent's root through the registry, for every canonical
 *   treatment (crop/zoom/reframe/mirror/recolor/blur/treatment variant),
 *   at every derivation depth.
 *
 * Canonical background asset registry (vidtoolz.backgroundAssetRegistry.v1):
 * one append-only, digest-chained record list per uniqueness domain (one
 * VISUAL_DRAFT programme/run). Every record is digest-bound and chained to
 * its predecessor; the registry file is hash-pinned by the composition and
 * re-verified by the renderer, which also re-derives used assets' and their
 * ancestors' fingerprints from bytes. Registration is the only legal writer.
 *
 * Honest trust boundary (documented, not hidden): a caller that lies to the
 * registration API about WHICH registered parent produced a derivative — or
 * externally transforms an image beyond exact decoded-pixel equality and
 * imports it as an opaque new root — can only be caught by perceptual
 * similarity, which is deliberately out of scope. What is closed: fabricated,
 * unregistered, copied, re-identified, or re-rooted parent STATE can never
 * establish lineage, and exact decoded duplicates are caught regardless of
 * wrapper.
 *
 * Pixel fingerprint canonicalization (PIXEL_FINGERPRINT_ALGORITHM):
 *   decode via ffmpeg -> first video frame (the whole image for stills) ->
 *   format=rgba (8-bit straight alpha, RGBA channel order, row-major
 *   top-to-bottom rawvideo, no metadata, no container) ->
 *   sha256("VIDTOOLZ_PIXELS_V1|w=<width>|h=<height>|fmt=rgba8_straight|" + raw pixel bytes).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const IDENTITY_SCHEMA = 'vidtoolz.backgroundIdentity.v2';
const REGISTRY_SCHEMA = 'vidtoolz.backgroundAssetRegistry.v1';
const PIXEL_FINGERPRINT_ALGORITHM = 'VIDTOOLZ_PIXELS_V1';
const ROOT_IDENTITY_ALGORITHM = 'VIDTOOLZ_BACKGROUND_ROOT_V1';
const ROOT_SOURCE_CLASSES = Object.freeze(['ROOT_GENERATED_ASSET', 'ROOT_DETERMINISTIC_ASSET', 'REGISTERED_IMPORT']);
const SOURCE_CLASSES = Object.freeze([...ROOT_SOURCE_CLASSES, 'DERIVED_ASSET']);
const CANONICAL_TREATMENTS = Object.freeze(['CROP', 'ZOOM', 'REFRAME', 'MIRROR', 'RECOLOR', 'BLUR', 'TREATMENT_VARIANT']);
const SHA_RE = /^[a-f0-9]{64}$/;
const IDENTITY_FIELDS = Object.freeze(['schema', 'asset_id', 'source_class', 'root_background_identity', 'pixel_fingerprint_sha256', 'fingerprint_algorithm', 'width', 'height', 'parent', 'materialization']);

class BackgroundIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackgroundIdentityError';
    this.code = code;
  }
}
function fail(code, message) { throw new BackgroundIdentityError(code, message); }

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }

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

/* Content-addressed root: the fixed public formula for ROOT-class assets. */
function deriveRootIdentity(pixelFingerprintSha256) {
  if (!SHA_RE.test(pixelFingerprintSha256 || '')) fail('BACKGROUND_FINGERPRINT_INVALID', String(pixelFingerprintSha256));
  return crypto.createHash('sha256').update(`${ROOT_IDENTITY_ALGORITHM}|${pixelFingerprintSha256}`).digest('hex');
}

/* The identity projection of a registry record (envelope fields stripped) —
 * this is what a manifest's background_identity must equal exactly. */
function identityCore(record) {
  const core = {};
  for (const field of IDENTITY_FIELDS) if (record?.[field] !== undefined) core[field] = record[field];
  return core;
}

/*
 * Pure structural validation of an identity record. The root formula is
 * public and deterministic, so a laundered ROOT record cannot pass; a
 * DERIVED record must carry complete parent lineage (including the parent's
 * asset id) and inherit the parent's root. Structure alone is NOT canonical
 * authority — registry resolution establishes that.
 */
function validateBackgroundIdentityShape(record, label = 'background_identity') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: canonical background identity is required and {} is not evidence`);
  for (const key of Object.keys(record)) if (!IDENTITY_FIELDS.includes(key)) fail('BACKGROUND_IDENTITY_INVALID', `${label}.${key}`);
  if (record.schema !== IDENTITY_SCHEMA) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: schema ${record.schema || 'missing'} (required: ${IDENTITY_SCHEMA})`);
  if (typeof record.asset_id !== 'string' || !record.asset_id) fail('BACKGROUND_IDENTITY_INVALID', `${label}: asset_id required`);
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
    if (typeof parent.asset_id !== 'string' || !parent.asset_id) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: parent asset id required`);
    if (!SHA_RE.test(parent.pixel_fingerprint_sha256 || '') || !SHA_RE.test(parent.root_background_identity || '')) fail('BACKGROUND_LINEAGE_REQUIRED', `${label}: parent lineage incomplete`);
    if (!SOURCE_CLASSES.includes(parent.source_class)) fail('BACKGROUND_SOURCE_CLASS_INVALID', `${label}: parent ${parent.source_class}`);
    if (!CANONICAL_TREATMENTS.includes(parent.treatment)) fail('BACKGROUND_TREATMENT_INVALID', `${label}: ${parent.treatment}`);
    if (record.root_background_identity !== parent.root_background_identity) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: a derivative inherits its parent's root`);
    if (ROOT_SOURCE_CLASSES.includes(parent.source_class) && parent.root_background_identity !== deriveRootIdentity(parent.pixel_fingerprint_sha256)) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: parent root does not derive from canonical content`);
  }
  return true;
}

/* ----------------------------------------------------------------- registry */

function recordDigest(record) {
  const copy = { ...record };
  delete copy.record_digest_sha256;
  return digest(copy);
}

function readRegistryDocument(registryPath) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8')); }
  catch (error) { fail('BACKGROUND_REGISTRY_UNAVAILABLE', `${registryPath}: ${error.message} — derivative and root registration fail closed without the canonical registry`); }
  verifyRegistryDocument(parsed);
  return parsed;
}

/*
 * Full pure verification of a registry document: schema, per-record identity
 * shape and formulas, digest binding, predecessor chaining, unique asset ids,
 * and in-registry parent resolution (a DERIVED record's parent must be an
 * EARLIER record in the same registry whose identity matches the recorded
 * parent lineage exactly). A structurally valid but unchained, re-identified,
 * or copied record breaks here.
 */
function verifyRegistryDocument(document) {
  if (!document || document.schema !== REGISTRY_SCHEMA || !Array.isArray(document.records)) fail('BACKGROUND_REGISTRY_UNAVAILABLE', `registry schema ${document?.schema || 'missing'} (required: ${REGISTRY_SCHEMA})`);
  const byAssetId = new Map();
  let predecessor = null;
  for (let index = 0; index < document.records.length; index += 1) {
    const record = document.records[index];
    const envelope = { ...record };
    const label = `registry[${index}]`;
    for (const key of Object.keys(envelope)) if (![...IDENTITY_FIELDS, 'path', 'predecessor_record_digest_sha256', 'record_digest_sha256'].includes(key)) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${label}.${key}`);
    if (typeof record.path !== 'string' || !record.path) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${label}: canonical source path required`);
    if ((record.predecessor_record_digest_sha256 ?? null) !== predecessor) fail('BACKGROUND_REGISTRY_CHAIN_BROKEN', `${label}: predecessor linkage does not match the chain`);
    if (recordDigest(record) !== record.record_digest_sha256) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${label}: record digest mismatch`);
    validateBackgroundIdentityShape(identityCore(record), label);
    if (byAssetId.has(record.asset_id)) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${label}: duplicate asset id ${record.asset_id}`);
    if (record.source_class === 'DERIVED_ASSET') {
      const parentRecord = byAssetId.get(record.parent.asset_id);
      if (!parentRecord) fail('BACKGROUND_PARENT_NOT_REGISTERED', `${label}: parent ${record.parent.asset_id} is not an earlier canonical record in this registry`);
      if (parentRecord.pixel_fingerprint_sha256 !== record.parent.pixel_fingerprint_sha256 || parentRecord.root_background_identity !== record.parent.root_background_identity || parentRecord.source_class !== record.parent.source_class) fail('BACKGROUND_PARENT_IDENTITY_INVALID', `${label}: recorded parent lineage does not match the canonical parent record`);
      if (record.root_background_identity !== parentRecord.root_background_identity) fail('BACKGROUND_ROOT_IDENTITY_INVALID', `${label}: derivative root must equal the canonical parent's root`);
    }
    byAssetId.set(record.asset_id, record);
    predecessor = record.record_digest_sha256;
  }
  return byAssetId;
}

function writeRegistryDocument(registryPath, document) {
  const temporary = `${registryPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, registryPath);
}

/* Create a new empty canonical registry for one uniqueness domain (one
 * VISUAL_DRAFT programme/run). Returns the registry handle. */
function createBackgroundRegistry(registryPath) {
  if (!registryPath) fail('BACKGROUND_REGISTRY_UNAVAILABLE', 'registry path required');
  if (fs.existsSync(registryPath)) fail('BACKGROUND_REGISTRY_UNAVAILABLE', `${registryPath}: already exists — open it instead of recreating it`);
  fs.mkdirSync(path.dirname(path.resolve(registryPath)), { recursive: true });
  writeRegistryDocument(registryPath, { schema: REGISTRY_SCHEMA, records: [] });
  return { registry_path: registryPath };
}

/* Open (and fully verify) an existing canonical registry. Fail closed. */
function openBackgroundRegistry(registryPath) {
  readRegistryDocument(registryPath);
  return { registry_path: registryPath };
}

function requireRegistryHandle(registry) {
  if (!registry || typeof registry.registry_path !== 'string' || !registry.registry_path) fail('BACKGROUND_REGISTRY_UNAVAILABLE', 'a canonical registry handle is required; inline parent objects are never a fallback');
  return registry.registry_path;
}

/*
 * Trusted parent/asset resolution: ID -> canonical registry -> trusted record.
 * The caller may reference an identity; only registered canonical state is
 * returned, and the whole chain is re-verified on every resolution.
 */
function resolveRegisteredBackgroundAsset(registry, assetId) {
  const registryPath = requireRegistryHandle(registry);
  const byAssetId = verifyRegistryDocument(readRegistryDocumentRaw(registryPath));
  const record = byAssetId.get(assetId);
  if (!record) fail('BACKGROUND_PARENT_NOT_REGISTERED', `${assetId}: not a canonical registered background asset in ${registryPath}`);
  return Object.freeze({ ...record });
}
function readRegistryDocumentRaw(registryPath) {
  try { return JSON.parse(fs.readFileSync(registryPath, 'utf8')); }
  catch (error) { fail('BACKGROUND_REGISTRY_UNAVAILABLE', `${registryPath}: ${error.message} — derivative and root registration fail closed without the canonical registry`); }
}

function refuseCallerIdentityFields(input, operation) {
  for (const key of ['root_background_identity', 'pixel_fingerprint_sha256', 'parent', 'canonical', 'trustedParent', 'canonicalParent', 'skipParentResolution', 'allowUnregisteredParent', 'rawRecord']) {
    if (input && key in input) fail(key === 'parent' ? 'BACKGROUND_PARENT_OBJECT_FORBIDDEN' : 'BACKGROUND_ROOT_NOT_CALLER_MINTABLE', `${operation}: '${key}' is not caller input — identity is resolved from canonical state, never asserted`);
  }
}

/*
 * Register a genuinely new ROOT background from its canonical
 * materialization. Identity derives from actual content; the record is
 * appended to the canonical registry. This operation NEVER runs as a
 * fallback for a failed derivative registration.
 */
function registerRootBackground(registry, { asset_id: assetId, path: filePath, source_class: sourceClass, materialization } = {}, options = {}) {
  const registryPath = requireRegistryHandle(registry);
  refuseCallerIdentityFields(arguments[1], 'registerRootBackground');
  if (typeof assetId !== 'string' || !assetId) fail('BACKGROUND_IDENTITY_INVALID', 'asset_id required');
  if (!ROOT_SOURCE_CLASSES.includes(sourceClass)) fail('BACKGROUND_SOURCE_CLASS_INVALID', `${sourceClass}: a root registration must be a root source class`);
  const document = readRegistryDocumentRaw(registryPath);
  const byAssetId = verifyRegistryDocument(document);
  if (byAssetId.has(assetId)) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${assetId}: already registered`);
  const fingerprint = (options.computePixelFingerprint || computePixelFingerprint)(filePath);
  const record = {
    schema: IDENTITY_SCHEMA,
    asset_id: assetId,
    source_class: sourceClass,
    root_background_identity: deriveRootIdentity(fingerprint.pixel_fingerprint_sha256),
    pixel_fingerprint_sha256: fingerprint.pixel_fingerprint_sha256,
    fingerprint_algorithm: PIXEL_FINGERPRINT_ALGORITHM,
    width: fingerprint.width,
    height: fingerprint.height,
    parent: null,
    materialization: materialization && typeof materialization === 'object' ? materialization : null,
    path: filePath,
    predecessor_record_digest_sha256: document.records.length ? document.records[document.records.length - 1].record_digest_sha256 : null,
  };
  record.record_digest_sha256 = recordDigest(record);
  writeRegistryDocument(registryPath, { ...document, records: [...document.records, record] });
  return Object.freeze({ ...record });
}

/*
 * Register a canonical derivative. THE CALLER NAMES THE PARENT BY ID ONLY:
 * parent state is resolved from the canonical registry, never accepted from
 * the caller (BACKGROUND_PARENT_OBJECT_FORBIDDEN). The child inherits the
 * resolved canonical parent's root — at every derivation depth. A missing or
 * unregistered parent fails closed; it never silently becomes a new root.
 */
function registerDerivedBackground(registry, { asset_id: assetId, parent_asset_id: parentAssetId, path: filePath, treatment } = {}, options = {}) {
  const registryPath = requireRegistryHandle(registry);
  refuseCallerIdentityFields(arguments[1], 'registerDerivedBackground');
  if (typeof assetId !== 'string' || !assetId) fail('BACKGROUND_IDENTITY_INVALID', 'asset_id required');
  if (typeof parentAssetId !== 'string' || !parentAssetId) fail('BACKGROUND_PARENT_NOT_REGISTERED', 'parent_asset_id required: a derivative names its canonical parent; it cannot define one');
  if (!CANONICAL_TREATMENTS.includes(treatment)) fail('BACKGROUND_TREATMENT_INVALID', String(treatment));
  const document = readRegistryDocumentRaw(registryPath);
  const byAssetId = verifyRegistryDocument(document);
  const parentRecord = byAssetId.get(parentAssetId);
  if (!parentRecord) fail('BACKGROUND_PARENT_NOT_REGISTERED', `${parentAssetId}: not a canonical registered background asset — a formula-valid object is not a parent`);
  if (byAssetId.has(assetId)) fail('BACKGROUND_REGISTRY_RECORD_INVALID', `${assetId}: already registered`);
  const fingerprint = (options.computePixelFingerprint || computePixelFingerprint)(filePath);
  const record = {
    schema: IDENTITY_SCHEMA,
    asset_id: assetId,
    source_class: 'DERIVED_ASSET',
    root_background_identity: parentRecord.root_background_identity,
    pixel_fingerprint_sha256: fingerprint.pixel_fingerprint_sha256,
    fingerprint_algorithm: PIXEL_FINGERPRINT_ALGORITHM,
    width: fingerprint.width,
    height: fingerprint.height,
    parent: {
      asset_id: parentRecord.asset_id,
      pixel_fingerprint_sha256: parentRecord.pixel_fingerprint_sha256,
      root_background_identity: parentRecord.root_background_identity,
      source_class: parentRecord.source_class,
      treatment,
    },
    materialization: null,
    path: filePath,
    predecessor_record_digest_sha256: document.records.length ? document.records[document.records.length - 1].record_digest_sha256 : null,
  };
  record.record_digest_sha256 = recordDigest(record);
  writeRegistryDocument(registryPath, { ...document, records: [...document.records, record] });
  return Object.freeze({ ...record });
}

/*
 * Trusted resolution for one manifest asset: recompute the fingerprint from
 * the actual bytes and require the claimed record to match it exactly,
 * including the asset identity it claims to describe.
 */
function resolveBackgroundIdentity(asset, options = {}) {
  validateBackgroundIdentityShape(asset?.background_identity, asset?.asset_id || 'asset');
  const record = asset.background_identity;
  if (record.asset_id !== asset.asset_id) fail('BACKGROUND_IDENTITY_INVALID', `${asset.asset_id}: identity record describes ${record.asset_id}`);
  const measured = (options.computePixelFingerprint || computePixelFingerprint)(asset.path);
  if (measured.pixel_fingerprint_sha256 !== record.pixel_fingerprint_sha256) fail('BACKGROUND_FINGERPRINT_MISMATCH', `${asset.asset_id}: claimed decoded-pixel identity does not match the actual bytes`);
  if (measured.width !== record.width || measured.height !== record.height) fail('BACKGROUND_FINGERPRINT_MISMATCH', `${asset.asset_id}: claimed dimensions do not match decoded content`);
  return { ...record, verified_from_bytes: true };
}

/*
 * Renderer-side lineage byte verification: walk a used asset's ancestor chain
 * inside the verified registry and re-derive every ancestor's fingerprint
 * from its canonical source bytes. A registry hand-crafted around a parent
 * that never materialized fails closed here.
 */
function verifyLineageFromBytes(byAssetId, assetId, options = {}) {
  const compute = options.computePixelFingerprint || computePixelFingerprint;
  let current = byAssetId.get(assetId);
  if (!current) fail('BACKGROUND_ASSET_NOT_REGISTERED', `${assetId}: not a canonical registered background asset`);
  const seen = new Set();
  while (current.source_class === 'DERIVED_ASSET') {
    if (seen.has(current.asset_id)) fail('BACKGROUND_REGISTRY_CHAIN_BROKEN', `${current.asset_id}: lineage cycle`);
    seen.add(current.asset_id);
    const parent = byAssetId.get(current.parent.asset_id);
    if (!parent) fail('BACKGROUND_PARENT_NOT_REGISTERED', `${current.parent.asset_id}: ancestor not registered`);
    const measured = compute(parent.path);
    if (measured.pixel_fingerprint_sha256 !== parent.pixel_fingerprint_sha256) fail('BACKGROUND_PARENT_FINGERPRINT_MISMATCH', `${parent.asset_id}: canonical ancestor bytes do not match its registered identity`);
    current = parent;
  }
  return true;
}

module.exports = {
  IDENTITY_SCHEMA,
  REGISTRY_SCHEMA,
  PIXEL_FINGERPRINT_ALGORITHM,
  ROOT_IDENTITY_ALGORITHM,
  ROOT_SOURCE_CLASSES,
  SOURCE_CLASSES,
  CANONICAL_TREATMENTS,
  BackgroundIdentityError,
  computePixelFingerprint,
  deriveRootIdentity,
  identityCore,
  recordDigest,
  createBackgroundRegistry,
  openBackgroundRegistry,
  verifyRegistryDocument,
  resolveRegisteredBackgroundAsset,
  registerRootBackground,
  registerDerivedBackground,
  validateBackgroundIdentityShape,
  resolveBackgroundIdentity,
  verifyLineageFromBytes,
};
