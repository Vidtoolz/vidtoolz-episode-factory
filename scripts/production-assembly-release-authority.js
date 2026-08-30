'use strict';

/*
 * Production Assembly release-packet authority.
 *
 * Presenter review and portrait/graphics direction are independent human
 * authorities.  This module validates their canonical registry records and
 * creates the one bounded VISUAL_DRAFT successor needed when an historical
 * packet put a graphics-direction digest in the presenter-review field.
 */

const PACKET_SCHEMA = 'vidtoolz.productionAssemblyReleasePacket.v1';
const GRAPHICS_DIRECTION_SCHEMA = 'codex.humanV4GraphicsDirection.v1';
const PRESENTER_REVIEW_SCHEMA = 'vidtoolz.humanPerformanceReview.v2';
const SHA_RE = /^[a-f0-9]{64}$/;

class ProductionAssemblyReleaseAuthorityError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductionAssemblyReleaseAuthorityError'; this.code = code; }
}

function fail(code, message) { throw new ProductionAssemblyReleaseAuthorityError(code, message); }
function assertSha(value, label) { if (!SHA_RE.test(String(value || ''))) fail('RELEASE_AUTHORITY_SHA_INVALID', label); }
function samePath(a, b) { return typeof a === 'string' && typeof b === 'string' && a === b; }

function graphicsDirectionPin(packet) {
  const successor = packet?.v4_successor;
  if (!successor?.direction_path && !successor?.direction_sha256) return null;
  if (!successor?.direction_path || !successor?.direction_sha256) fail('GRAPHICS_DIRECTION_BINDING_INCOMPLETE', 'both V4 direction path and digest are required');
  return { path: successor.direction_path, sha256: successor.direction_sha256, schema: GRAPHICS_DIRECTION_SCHEMA };
}

function validateGraphicsDirection(pin, artifact, value) {
  if (!pin) return null;
  assertSha(pin.sha256, 'graphics direction pin');
  if (!artifact || artifact.status !== 'ACTIVE') fail('GRAPHICS_DIRECTION_AUTHORITY_MISSING', pin.path);
  if (artifact.schema !== GRAPHICS_DIRECTION_SCHEMA || value?.schema !== GRAPHICS_DIRECTION_SCHEMA) fail('GRAPHICS_DIRECTION_SCHEMA_INVALID', artifact.schema || value?.schema || 'missing');
  if (!samePath(artifact.path, pin.path)) fail('GRAPHICS_DIRECTION_PATH_MISMATCH', `${artifact.path} != ${pin.path}`);
  if (artifact.sha256 !== pin.sha256) fail('GRAPHICS_DIRECTION_HASH_MISMATCH', `${artifact.sha256} != ${pin.sha256}`);
  if (value?.authority?.type !== 'HUMAN' || !value.authority.id || typeof value.decision !== 'string' || !value.decision) fail('GRAPHICS_DIRECTION_HUMAN_AUTHORITY_INVALID', pin.path);
  return { path: artifact.path, sha256: artifact.sha256, schema: artifact.schema, authority: value.authority, decision: value.decision };
}

function validatePresenterReview(packet, artifact, value, graphics) {
  const sources = packet.presenter_sources || [];
  const binding = packet.human_review_binding_sha256;
  if (sources.length === 0) {
    if (binding != null) fail('VISUAL_DRAFT_PRESENTER_PLACEHOLDER_FORBIDDEN', 'presenter-free release packet retains a human-presenter review binding');
    return null;
  }
  if (binding == null) fail('PRESENTER_REVIEW_REQUIRED', 'presenter-bearing release requires human performance review');
  assertSha(binding, 'presenter review binding');
  if (graphics && binding === graphics.sha256) fail('GRAPHICS_DIRECTION_NOT_PRESENTER_REVIEW', 'portrait/graphics direction cannot satisfy presenter review');
  if (!artifact || artifact.status !== 'ACTIVE' || artifact.sha256 !== binding) fail('PRESENTER_REVIEW_AUTHORITY_MISSING', binding);
  if (artifact.schema !== PRESENTER_REVIEW_SCHEMA || value?.schema !== PRESENTER_REVIEW_SCHEMA) fail('PRESENTER_REVIEW_SCHEMA_INVALID', artifact.schema || value?.schema || 'missing');
  if (value.binding_digest_sha256 !== binding || value.reviewer?.type !== 'HUMAN') fail('PRESENTER_REVIEW_AUTHORITY_INVALID', binding);
  return { path: artifact.path, sha256: artifact.sha256, schema: artifact.schema };
}

function validateReleasePacketAuthority(packet, options = {}) {
  if (packet?.schema !== PACKET_SCHEMA || packet?.artifact_type !== 'production-assembly-release-packet') fail('RELEASE_PACKET_SCHEMA_INVALID', String(packet?.schema));
  if (!packet.run_id || !Array.isArray(packet.presenter_sources)) fail('RELEASE_PACKET_IDENTITY_INVALID', String(packet?.run_id));
  const graphics = validateGraphicsDirection(graphicsDirectionPin(packet), options.graphicsArtifact, options.graphicsValue);
  const presenterReview = validatePresenterReview(packet, options.presenterReviewArtifact, options.presenterReviewValue, graphics);
  return { ok: true, graphics_direction: graphics, presenter_review: presenterReview };
}

function buildVisualDraftGraphicsAuthoritySuccessor(predecessor, input = {}) {
  if (predecessor?.schema !== PACKET_SCHEMA || predecessor?.draft_class !== 'VISUAL_DRAFT') fail('RELEASE_SUCCESSOR_PREDECESSOR_INVALID', String(predecessor?.draft_class));
  if (!Array.isArray(predecessor.presenter_sources) || predecessor.presenter_sources.length !== 0) fail('RELEASE_SUCCESSOR_PRESENTER_STATE_INVALID', 'bounded correction requires presenter-free VISUAL_DRAFT');
  const graphics = validateGraphicsDirection(graphicsDirectionPin(predecessor), input.graphicsArtifact, input.graphicsValue);
  if (!graphics || predecessor.human_review_binding_sha256 !== graphics.sha256) fail('RELEASE_AUTHORITY_DEFECT_NOT_PRESENT', 'predecessor is not the graphics-as-presenter-review defect');
  if (!input.predecessorPath) fail('RELEASE_SUCCESSOR_PREDECESSOR_INVALID', 'predecessor path required');
  assertSha(input.predecessorSha256, 'predecessor release packet');
  const successor = structuredClone(predecessor);
  successor.human_review_binding_sha256 = null;
  successor.release_successor = {
    predecessor_path: input.predecessorPath,
    predecessor_sha256: input.predecessorSha256,
    status: 'HISTORICAL',
    correction: 'SEPARATE_PORTRAIT_GRAPHICS_DIRECTION_FROM_PRESENTER_REVIEW',
  };
  validateReleasePacketAuthority(successor, { graphicsArtifact: input.graphicsArtifact, graphicsValue: input.graphicsValue });
  return successor;
}

module.exports = {
  PACKET_SCHEMA,
  GRAPHICS_DIRECTION_SCHEMA,
  PRESENTER_REVIEW_SCHEMA,
  ProductionAssemblyReleaseAuthorityError,
  graphicsDirectionPin,
  validateGraphicsDirection,
  validateReleasePacketAuthority,
  buildVisualDraftGraphicsAuthoritySuccessor,
};
