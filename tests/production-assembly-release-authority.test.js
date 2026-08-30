'use strict';

const { assert, fs, os, path, test } = require('./_helpers.js');
const handoff = require('../scripts/directed-draft-assembly-handoff.js');
const authority = require('../scripts/production-assembly-release-authority.js');
const successor = require('../scripts/production-assembly-release-successor.js');

const H = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');
const GRAPHICS_BYTES = `${JSON.stringify({ schema: authority.GRAPHICS_DIRECTION_SCHEMA, authority: { type: 'HUMAN', id: 'human-1' }, decision: 'ALLOW_BOUNDED_GRAPHICS_REPAIR' }, null, 2)}\n`;
const GRAPHICS_SHA = H(GRAPHICS_BYTES);
const REVIEW_SHA = H('review');
function clone(value) { return structuredClone(value); }
function graphicsArtifact(overrides = {}) { return { path: 'graphics.json', sha256: GRAPHICS_SHA, schema: authority.GRAPHICS_DIRECTION_SCHEMA, status: 'ACTIVE', ...overrides }; }
function graphicsValue(overrides = {}) { return { schema: authority.GRAPHICS_DIRECTION_SCHEMA, authority: { type: 'HUMAN', id: 'human-1' }, decision: 'ALLOW_BOUNDED_GRAPHICS_REPAIR', ...overrides }; }
function packet(overrides = {}) {
  return {
    schema: authority.PACKET_SCHEMA, artifact_type: 'production-assembly-release-packet', draft_class: 'VISUAL_DRAFT', run_id: 'run-one',
    presenter_sources: [], human_review_binding_sha256: null,
    v4_successor: { direction_path: 'graphics.json', direction_sha256: GRAPHICS_SHA },
    ...overrides,
  };
}
function code(fn, expected) { assert.throws(fn, (error) => error.code === expected, expected); }

test('PARA01 presenter-free VISUAL_DRAFT with null presenter review is legal', () => assert.equal(authority.validateReleasePacketAuthority(packet(), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }).ok, true));
test('PARA02 presenter-free VISUAL_DRAFT with presenter review binding is rejected', () => code(() => authority.validateReleasePacketAuthority(packet({ human_review_binding_sha256: REVIEW_SHA }), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }), 'VISUAL_DRAFT_PRESENTER_PLACEHOLDER_FORBIDDEN'));
test('PARA03 portrait graphics direction is legal only through its canonical typed V4 field', () => assert.equal(authority.validateReleasePacketAuthority(packet(), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }).graphics_direction.schema, authority.GRAPHICS_DIRECTION_SCHEMA));
test('PARA04 graphics direction cannot satisfy presenter review', () => code(() => authority.validateReleasePacketAuthority(packet({ draft_class: 'PRESENTER_VALIDATION_DRAFT', presenter_sources: [{ id: 'p1' }], human_review_binding_sha256: GRAPHICS_SHA }), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue(), presenterReviewArtifact: graphicsArtifact(), presenterReviewValue: graphicsValue() }), 'GRAPHICS_DIRECTION_NOT_PRESENTER_REVIEW'));
test('PARA05 presenter-bearing draft without presenter review is rejected', () => code(() => authority.validateReleasePacketAuthority(packet({ draft_class: 'PRESENTER_VALIDATION_DRAFT', presenter_sources: [{ id: 'p1' }] }), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }), 'PRESENTER_REVIEW_REQUIRED'));
test('PARA06 valid presenter-bearing draft retains legitimate presenter review authority', () => { const value = packet({ draft_class: 'PRESENTER_VALIDATION_DRAFT', presenter_sources: [{ id: 'p1' }], human_review_binding_sha256: REVIEW_SHA }); const record = { path: 'review.json', sha256: REVIEW_SHA, schema: authority.PRESENTER_REVIEW_SCHEMA, status: 'ACTIVE' }; const review = { schema: authority.PRESENTER_REVIEW_SCHEMA, binding_digest_sha256: REVIEW_SHA, reviewer: { type: 'HUMAN', id: 'human-1' } }; assert.equal(authority.validateReleasePacketAuthority(value, { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue(), presenterReviewArtifact: record, presenterReviewValue: review }).presenter_review.sha256, REVIEW_SHA); });
test('PARA07 predecessor packet remains immutable when successor is built', () => { const value = packet({ human_review_binding_sha256: GRAPHICS_SHA }); const before = JSON.stringify(value); authority.buildVisualDraftGraphicsAuthoritySuccessor(value, { predecessorPath: 'release-r1.json', predecessorSha256: H('predecessor'), graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }); assert.equal(JSON.stringify(value), before); });
test('PARA08 successor binds exact immutable predecessor lineage', () => { const value = authority.buildVisualDraftGraphicsAuthoritySuccessor(packet({ human_review_binding_sha256: GRAPHICS_SHA }), { predecessorPath: 'release-r1.json', predecessorSha256: H('predecessor'), graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue() }); assert.equal(value.release_successor.predecessor_sha256, H('predecessor')); assert.equal(value.human_review_binding_sha256, null); });
test('PARA09 wrong graphics-direction schema is rejected', () => code(() => authority.validateReleasePacketAuthority(packet(), { graphicsArtifact: graphicsArtifact({ schema: 'wrong.schema' }), graphicsValue: graphicsValue() }), 'GRAPHICS_DIRECTION_SCHEMA_INVALID'));
test('PARA10 graphics-direction hash mismatch is rejected', () => code(() => authority.validateReleasePacketAuthority(packet(), { graphicsArtifact: graphicsArtifact({ sha256: H('wrong') }), graphicsValue: graphicsValue() }), 'GRAPHICS_DIRECTION_HASH_MISMATCH'));
test('PARA11 caller cannot relabel arbitrary artifact as graphics direction', () => code(() => authority.validateReleasePacketAuthority(packet(), { graphicsArtifact: graphicsArtifact(), graphicsValue: graphicsValue({ schema: 'arbitrary.artifact.v1' }) }), 'GRAPHICS_DIRECTION_SCHEMA_INVALID'));

function successorFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-successor-'));
  const run = path.join(root, 'run-one'); fs.mkdirSync(run, { recursive: true });
  const graphicsPath = path.join(run, 'graphics.json'); fs.writeFileSync(graphicsPath, GRAPHICS_BYTES);
  const release = packet({ human_review_binding_sha256: GRAPHICS_SHA });
  const releasePath = path.join(run, 'release-R1.json'); fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
  const intake = { schema: handoff.LEGACY_INTAKE_SCHEMA, run_id: 'run-one', created_at: '2026-08-30T00:00:00Z', predecessor: null, slots: [
    { slot: 7, name: 'visual_draft_successor_packet', artifacts: [{ path: 'release-R1.json', sha256: handoff.sha256FileSync(releasePath), schema: authority.PACKET_SCHEMA, status: 'ACTIVE' }] },
    { slot: 14, name: 'v4_human_portrait_graphics_direction', artifacts: [{ path: 'graphics.json', sha256: GRAPHICS_SHA, schema: authority.GRAPHICS_DIRECTION_SCHEMA, status: 'ACTIVE' }] },
  ] };
  const intakePath = path.join(run, 'intake-R1.json'); fs.writeFileSync(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  return { root, run, releasePath, intakePath };
}
test('PARA12 immutable intake successor becomes the one active head', () => { const fx = successorFixture(); const releaseBefore = handoff.sha256FileSync(fx.releasePath); const intakeBefore = handoff.sha256FileSync(fx.intakePath); const result = successor.createGraphicsAuthoritySuccessor(fx.run, { allowedRoots: [fx.run], createdAt: '2026-08-30T01:00:00Z' }); const head = handoff.discoverActiveIntake(fx.run); assert.equal(path.basename(head.path), 'intake-R2.json'); assert.equal(head.value.predecessor.sha256, intakeBefore); assert.equal(handoff.sha256FileSync(fx.releasePath), releaseBefore); assert.equal(handoff.sha256FileSync(fx.intakePath), intakeBefore); assert.equal(result.release_packet.human_review_binding_sha256, null); fs.rmSync(fx.root, { recursive: true, force: true }); });
