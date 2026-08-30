'use strict';

/*
 * REUSABLE_DRAFT_PRESENTER_PROXY_V1 — the one reusable generic transparent
 * presenter proxy (doctrine presenter_proxy). This loader is the canonical way
 * a materializer references the proxy: it re-verifies the bytes against the
 * provenance record and returns a composition-ready asset descriptor.
 *
 * The proxy is GENERIC_HUMAN_PRESENTER_PROXY: not Mikko, not a likeness of
 * Mikko, not a human performance, and never a final presenter asset.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROXY_DIR = path.join(__dirname, '..', 'assets', 'draft-presenter-proxy');
const PROXY_ASSET_ID = 'REUSABLE_DRAFT_PRESENTER_PROXY_V1';
const CLASSIFICATION = 'GENERIC_HUMAN_PRESENTER_PROXY';
const PROVENANCE_SCHEMA = 'vidtoolz.draftPresenterProxyAsset.v1';

class ProxyAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProxyAssetError';
    this.code = code;
  }
}
function fail(code, message) { throw new ProxyAssetError(code, message); }

function loadProxyAsset(options = {}) {
  const dir = options.proxyDir || PROXY_DIR;
  const provenancePath = path.join(dir, `${PROXY_ASSET_ID}.provenance.json`);
  let provenance;
  try { provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8')); }
  catch (error) { fail('PROXY_PROVENANCE_UNREADABLE', `${provenancePath}: ${error.message}`); }
  if (provenance.schema !== PROVENANCE_SCHEMA || provenance.asset_id !== PROXY_ASSET_ID) fail('PROXY_PROVENANCE_INVALID', 'exact proxy provenance record required');
  if (provenance.classification !== CLASSIFICATION) fail('PROXY_CLASSIFICATION_INVALID', String(provenance.classification));
  if (!Array.isArray(provenance.not_classes) || !provenance.not_classes.includes('MIKKO_LIKENESS') || !provenance.not_classes.includes('FINAL_HUMAN_PERFORMANCE')) fail('PROXY_CLASSIFICATION_INVALID', 'the proxy must disclaim likeness and performance classes');
  const file = path.join(dir, provenance.file);
  if (!fs.existsSync(file)) fail('PROXY_ASSET_MISSING', file);
  const bytes = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== provenance.sha256) fail('PROXY_ASSET_DRIFT', 'proxy bytes do not match the provenance record');
  if (!(provenance.height >= 1920)) fail('PROXY_RESOLUTION_INSUFFICIENT', `source height ${provenance.height} < 1920`);
  return {
    asset_id: PROXY_ASSET_ID,
    role: 'GENERIC_PRESENTER_PROXY',
    path: file,
    sha256: sha,
    media_kind: 'IMAGE',
    width: provenance.width,
    height: provenance.height,
    alpha: { required: true, format: 'PNG_ALPHA' },
    provenance: { classification: CLASSIFICATION, record: provenancePath, generation: provenance.generation },
    status: 'ACCEPTED',
    policy: 'REQUIRED',
  };
}

module.exports = { PROXY_DIR, PROXY_ASSET_ID, CLASSIFICATION, PROVENANCE_SCHEMA, ProxyAssetError, loadProxyAsset };
