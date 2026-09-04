'use strict';
// SCREEN CAPTURE V1 — EVIDENCE FINALIZER (create-once protected evidence store).
//
// The finalizer is the ONLY authority that turns privacy-cleared spool bytes
// into accepted evidence. Destination = the exact CaptureSpec output identity
// (the frozen contract requires raw and presentation at
// <output_root>/<relative_dir>/<raw_name|presentation_name>); the requester
// gives every attempt/revision its own relative_dir (e.g.
// `<capture_id>/attempt-0001`), so paths are never reused:
//   <root>/<relative_dir>/<raw_name>             raw (0444)
//   <root>/<relative_dir>/manifest.json           finalizer manifest (0444)
//   <root>/<relative_dir>/receipt.json            Ed25519-signed receipt (0444)
//   <root>/<relative_dir>/<presentation_name>     derivative (0444)
//   <root>/<relative_dir>/presentation-manifest.json
// Every file is created with 'wx' (fails if it exists), fsync'd, read back and
// re-hashed; the directory is sealed 0555 when the attempt is complete. There
// is NO update, delete, rename-over or manifest-rewrite API in this module.
//
// Trust boundary (Codex production-readiness audit): create-once + read-only
// modes stop application mutation and accidental corruption. They do NOT stop
// the same Unix identity from chmod-ing and rewriting. Wholesale same-authority
// rewrite resistance requires the finalizer to run as the separate
// `vidtoolz-evidence` identity (deploy/screen-capture). describeProtection()
// reports which class is actually in force so no record can pretend otherwise.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { SCHEMA, digest, sha256Bytes, nowIso, unsafePathText, withinRoot, SAFE_NAME_RE } = require('./contract.js');

const FINALIZER_ID = 'vidtoolz-evidence-finalizer';
const FINALIZER_VERSION = '1.0.0';
const RAW_EXT = { PNG: 'png', MP4: 'mp4', TEXT: 'txt' };
function err(code, message) { return Object.assign(new Error(message), { code }); }

function loadSigningKey(keyPath) {
  if (!keyPath) throw err('TRUST_ANCHOR_UNAVAILABLE', 'evidence signing key path is not configured');
  let pem;
  try { pem = fs.readFileSync(keyPath, 'utf8'); } catch (e) { throw err('TRUST_ANCHOR_UNAVAILABLE', `evidence signing key unreadable: ${e.message}`); }
  if ((fs.statSync(keyPath).mode & 0o077) !== 0) throw err('TRUST_ANCHOR_UNAVAILABLE', 'evidence signing key must be mode 0600 (finalizer-only)');
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw err('TRUST_ANCHOR_UNAVAILABLE', 'evidence signing key must be Ed25519');
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }), key_id: sha256Bytes(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16) };
}
function generateSigningKey(keyPath) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(keyPath, 'wx', 0o600);
  try { fs.writeFileSync(fd, privateKey.export({ type: 'pkcs8', format: 'pem' })); } finally { fs.closeSync(fd); }
  return keyPath;
}

function createOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o644); } catch (e) { if (e.code === 'EEXIST') throw err('FINALIZATION_FAILED', `evidence path already exists (never replaced): ${file}`); throw e; }
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const back = fs.readFileSync(file);
  if (back.length !== bytes.length || sha256Bytes(back) !== sha256Bytes(bytes)) throw err('FINALIZATION_FAILED', 'readback hash mismatch after create-once write');
  fs.chmodSync(file, 0o444);
  return sha256Bytes(back);
}
function sealDirectory(dir) { try { fs.chmodSync(dir, 0o555); } catch (_) {} }
function destinationDir(root, relativeDir) {
  if (!root) throw err('TRUST_ANCHOR_UNAVAILABLE', 'evidence root is not configured');
  if (!relativeDir || unsafePathText(relativeDir) || path.isAbsolute(relativeDir)) throw err('FINALIZATION_FAILED', 'destination directory is not a bounded relative path');
  const dir = path.resolve(root, relativeDir);
  if (dir === path.resolve(root) || !withinRoot(root, dir)) throw err('FINALIZATION_FAILED', 'destination escapes the evidence root');
  return dir;
}

function describeProtection(evidenceRoot) {
  let owner = null; let mode = null;
  try { const st = fs.statSync(evidenceRoot); owner = st.uid; mode = (st.mode & 0o777).toString(8); } catch (_) {}
  const sameIdentity = owner === null || owner === os.userInfo().uid;
  return {
    evidence_root: evidenceRoot, store_owner_uid: owner, store_mode: mode, process_uid: os.userInfo().uid, process_user: os.userInfo().username,
    software_create_once: true, read_only_modes: true, identity_separated: !sameIdentity,
    trust_anchor_class: sameIdentity ? 'SAME_AUTHORITY_SOFTWARE_ONLY' : 'IDENTITY_SEPARATED_FINALIZER', production_qualified: !sameIdentity,
    note: sameIdentity ? 'finalizer runs under the same Unix identity as the capture worker: create-once and read-only modes hold against application mutation, not against a same-user chmod+rewrite; deploy vidtoolz-evidence (deploy/screen-capture) for production' : 'finalizer identity differs from the capture worker',
  };
}

// request: { capture_id, attempt_id, spec_digest_sha256, format, bytes, privacy_disposition, privacy_receipt_digest, destination:{relative_dir, raw_name}, source_receipt, machine_id, session_id, adapter }
function finalizeRaw(store, request) {
  const key = loadSigningKey(store.signing_key_path);
  if (!/^capture-[a-z0-9][a-z0-9-]{5,80}$/.test(request.capture_id) || !/^attempt-\d{4}$/.test(request.attempt_id)) throw err('FINALIZATION_FAILED', 'capture/attempt identity is not bounded');
  if (!RAW_EXT[request.format]) throw err('FINALIZATION_FAILED', `unsupported raw format ${request.format}`);
  if (!Buffer.isBuffer(request.bytes) || request.bytes.length === 0) throw err('FINALIZATION_FAILED', 'raw bytes must be a non-empty buffer');
  if (request.privacy_disposition !== 'ALLOW') throw err('FINALIZATION_FAILED', 'only privacy-cleared bytes may be finalized');
  const dest = request.destination || {};
  if (!SAFE_NAME_RE.test(String(dest.raw_name || ''))) throw err('FINALIZATION_FAILED', 'unsafe raw name');
  const dir = destinationDir(store.evidence_root, dest.relative_dir);
  if (fs.existsSync(path.join(dir, 'manifest.json')) || fs.existsSync(path.join(dir, dest.raw_name))) throw err('FINALIZATION_FAILED', `destination already holds finalized evidence (never replaced): ${dir}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const rawPath = path.join(dir, dest.raw_name);
  const finalizedAt = nowIso();
  const written = createOnce(rawPath, request.bytes);
  const manifest = {
    schema: 'vidtoolz.evidence-manifest.v1', capture_id: request.capture_id, attempt_id: request.attempt_id, spec_digest_sha256: request.spec_digest_sha256,
    raw: { path: rawPath, sha256: written, bytes: request.bytes.length, format: request.format, content_address: `${request.capture_id}/${request.attempt_id}/raw/${written}.${RAW_EXT[request.format]}` },
    source_receipt: request.source_receipt || null, machine_id: request.machine_id, session_id: request.session_id, adapter: request.adapter || null, privacy_receipt_digest_sha256: request.privacy_receipt_digest || null,
    finalizer: { id: FINALIZER_ID, version: FINALIZER_VERSION, uid: os.userInfo().uid, user: os.userInfo().username, hostname: os.hostname(), pid: process.pid }, finalized_at: finalizedAt,
  };
  manifest.manifest_digest_sha256 = digest(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  createOnce(path.join(dir, 'manifest.json'), manifestBytes);
  const receiptBody = { schema: SCHEMA.receipt, capture_id: request.capture_id, attempt_id: request.attempt_id, raw_sha256: written, manifest_digest_sha256: manifest.manifest_digest_sha256, manifest_sha256: sha256Bytes(manifestBytes), key_id: key.key_id, finalized_at: finalizedAt };
  const signature = crypto.sign(null, Buffer.from(digest(receiptBody), 'utf8'), key.privateKey).toString('base64');
  const receipt = { ...receiptBody, signature_alg: 'ed25519', signature, public_key_pem: key.public_key_pem };
  createOnce(path.join(dir, 'receipt.json'), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  journal(store, { event: 'EVIDENCE_FINALIZED', capture_id: request.capture_id, attempt_id: request.attempt_id, relative_dir: dest.relative_dir, raw_sha256: written, manifest_digest_sha256: manifest.manifest_digest_sha256, key_id: key.key_id, at: finalizedAt });
  return { dir, raw_path: rawPath, raw_sha256: written, manifest, receipt, protection: describeProtection(store.evidence_root) };
}

// Presentation derivative: create-once beside the raw, then the attempt directory is sealed.
function finalizePresentation(store, request) {
  const dest = request.destination || {};
  if (!SAFE_NAME_RE.test(String(dest.presentation_name || ''))) throw err('FINALIZATION_FAILED', 'unsafe presentation name');
  const dir = destinationDir(store.evidence_root, dest.relative_dir);
  const file = path.join(dir, dest.presentation_name);
  if (!fs.existsSync(path.join(dir, 'receipt.json'))) throw err('FINALIZATION_FAILED', 'presentation may only be finalized beside a finalized raw');
  if (request.manifest.raw_sha256 !== request.raw_sha256) throw err('FINALIZATION_FAILED', 'presentation manifest does not reference the finalized raw');
  const sha = createOnce(file, request.bytes);
  if (sha !== request.manifest.presentation_sha256) throw err('FINALIZATION_FAILED', 'presentation bytes differ from the transformation manifest');
  createOnce(path.join(dir, 'presentation-manifest.json'), Buffer.from(`${JSON.stringify(request.manifest, null, 2)}\n`));
  sealDirectory(dir);
  journal(store, { event: 'PRESENTATION_FINALIZED', capture_id: request.capture_id, attempt_id: request.attempt_id, relative_dir: dest.relative_dir, presentation_sha256: sha, at: nowIso() });
  return { dir, path: file, sha256: sha };
}
function sealAttempt(store, relativeDir) { try { sealDirectory(destinationDir(store.evidence_root, relativeDir)); } catch (_) {} }

// Verifies a finalized destination end-to-end: raw bytes, manifest digest, receipt signature.
function verifyAttempt(evidenceRoot, relativeDir) {
  const problems = [];
  let dir; try { dir = destinationDir(evidenceRoot, relativeDir); } catch (e) { return { ok: false, problems: [e.message], manifest: null, receipt: null }; }
  let manifest = null; let receipt = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) { problems.push(`manifest unreadable: ${e.message}`); }
  try { receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8')); } catch (e) { problems.push(`receipt unreadable: ${e.message}`); }
  if (manifest) {
    const copy = { ...manifest }; delete copy.manifest_digest_sha256;
    if (digest(copy) !== manifest.manifest_digest_sha256) problems.push('manifest digest mismatch (manifest altered)');
    try { const bytes = fs.readFileSync(manifest.raw.path); if (sha256Bytes(bytes) !== manifest.raw.sha256 || bytes.length !== manifest.raw.bytes) problems.push('raw bytes differ from manifest'); } catch (e) { problems.push(`raw unreadable: ${e.message}`); }
  }
  if (receipt && manifest) {
    const body = { schema: receipt.schema, capture_id: receipt.capture_id, attempt_id: receipt.attempt_id, raw_sha256: receipt.raw_sha256, manifest_digest_sha256: receipt.manifest_digest_sha256, manifest_sha256: receipt.manifest_sha256, key_id: receipt.key_id, finalized_at: receipt.finalized_at };
    try { if (!crypto.verify(null, Buffer.from(digest(body), 'utf8'), crypto.createPublicKey(receipt.public_key_pem), Buffer.from(receipt.signature, 'base64'))) problems.push('receipt signature invalid'); } catch (e) { problems.push(`receipt signature unverifiable: ${e.message}`); }
    if (receipt.manifest_digest_sha256 !== manifest.manifest_digest_sha256 || receipt.raw_sha256 !== manifest.raw.sha256) problems.push('receipt does not bind this manifest/raw');
    try { if (sha256Bytes(fs.readFileSync(path.join(dir, 'manifest.json'))) !== receipt.manifest_sha256) problems.push('manifest bytes differ from receipt'); } catch (_) {}
  }
  return { ok: problems.length === 0, problems, manifest, receipt, dir };
}

function journal(store, entry) {
  const root = store.receipts_root || store.evidence_root;
  try { fs.mkdirSync(root, { recursive: true }); fs.appendFileSync(path.join(root, 'finalization-journal.ndjson'), `${JSON.stringify(entry)}\n`); } catch (_) {}
}

module.exports = { FINALIZER_ID, FINALIZER_VERSION, RAW_EXT, loadSigningKey, generateSigningKey, finalizeRaw, finalizePresentation, sealAttempt, verifyAttempt, describeProtection, destinationDir };
