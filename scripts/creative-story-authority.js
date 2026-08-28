'use strict';

/*
 * creative-story-authority.js — the unforgeable Story-authority boundary for
 * the Creative Director stack (successor repair of fc2c6f0).
 *
 * DOCTRINE: caller-supplied authority claims have ZERO authority. Authority is
 * CAPABILITY-DERIVED: the canonical Story / Discovery source is RESOLVED through
 * the pinned deployment authority, never selected by the caller, and the
 * runtime module RE-RESOLVES to confirm identity rather than trusting a boolean.
 *
 * - The Script Builder root is resolved ONLY from the pinned deployment
 *   authority (script-builder-authority: env VIDTOOLZ_SCRIPT_BUILDER_ROOT or
 *   the repo-pinned sibling). A caller cannot pass a store path.
 * - The Discovery root is resolved ONLY from env VIDTOOLZ_DISCOVERY_ROOT or the
 *   pinned constant. A candidate package must be STORE-ADDRESSABLE: its file is
 *   <root>/<canonical_idea_id>.json, so a hand-copied package under a caller
 *   directory cannot masquerade as canonical.
 * - resolve* returns a plain identity plus a non-forgeable in-process RECEIPT
 *   (module-private WeakSet membership). reverify* independently re-derives the
 *   identity from the pinned store and confirms a deserialized (cross-process)
 *   identity matches — so `authority_verified` on task JSON is never trusted.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const scriptBuilderAuthority = require('./script-builder-authority.js');
const { loadCanonicalStory } = require('./agent-task-visual-planning.js');

const PINNED_DISCOVERY_ROOT = '/home/vidtoolz/vidtoolz-mindmap/data-gdocs/claim-packages';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// Module-private capability registry: an identity object is trusted ONLY if it
// is a member of this WeakSet, which the caller cannot reach or reconstruct.
const RESOLVED_IDENTITIES = new WeakSet();

// BOUNDARY REDESIGN (2026-08-28): a TRUSTED STORY SNAPSHOT is the ONLY object
// that carries Story authority downstream. Its trusted status originates INSIDE
// the canonical resolver (module-private WeakSet membership). A plain JSON copy
// of every field is NOT a member and is therefore NOT trusted; there is no
// public constructor that can mint one. Callers pass a STABLE STORY REFERENCE
// (opaque ids); the module resolves the snapshot from the pinned store.
const TRUSTED_SNAPSHOTS = new WeakSet();

// A Story REFERENCE is the only Story authority a caller may supply: opaque
// identifiers, never content/hash/approval/lineage/flags. Any extra key is a
// caller attempt to inject authority and is refused before resolution.
const CANONICAL_STORY_REF_KEYS = Object.freeze(['kind', 'project_id', 'version_id']);
const CANDIDATE_REF_KEYS = Object.freeze(['kind', 'source', 'canonical_idea_id', 'script_variant']);

function assertReferenceShape(reference) {
  if (!reference || typeof reference !== 'object') fail('a Story reference object is required');
  const keys = Object.keys(reference);
  if (reference.kind === 'CANONICAL_STORY') {
    const extra = keys.filter((k) => !CANONICAL_STORY_REF_KEYS.includes(k));
    if (extra.length) fail(`Story reference over-specified: caller may not supply [${extra.join(', ')}] — content, hash, approval, lineage, and canonical/authority flags are resolved internally, never accepted from the task`);
  } else if (reference.kind === 'CANDIDATE_SCRIPT') {
    const extra = keys.filter((k) => !CANDIDATE_REF_KEYS.includes(k));
    if (extra.length) fail(`Candidate reference over-specified: caller may not supply [${extra.join(', ')}] — fingerprints, hashes, and validation state are resolved internally`);
    if (reference.source !== 'DISCOVERY_PACKAGE') fail('candidate reference.source must be DISCOVERY_PACKAGE');
  } else {
    fail(`unknown Story reference kind ${reference.kind}`);
  }
}

// The minimal reference derivable from a resolved snapshot — what a task may
// legally carry. Everything authoritative stays inside the snapshot.
function storyReferenceOf(identity) {
  if (identity?.kind === 'CANONICAL_STORY') {
    return { kind: 'CANONICAL_STORY', project_id: identity.project_id, version_id: identity.version_id };
  }
  if (identity?.kind === 'CANDIDATE_SCRIPT') {
    return { kind: 'CANDIDATE_SCRIPT', source: 'DISCOVERY_PACKAGE', canonical_idea_id: identity.canonical_idea_id, script_variant: identity.script_variant };
  }
  fail(`cannot derive a reference from identity kind ${identity?.kind}`);
  return null;
}

function sectionsSha(sections) {
  return sha256((sections || []).map((s) => norm(s.text)).join('\n\n'));
}

// Register a freshly-resolved snapshot as trusted. The snapshot object (and its
// identity) become WeakSet members; a serialized copy loses this membership.
function makeTrustedSnapshot(snapshot) {
  RESOLVED_IDENTITIES.add(snapshot.script_identity);
  TRUSTED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

function isTrustedSnapshot(value) {
  return TRUSTED_SNAPSHOTS.has(value);
}

class StoryAuthorityError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}
function fail(message) { throw new StoryAuthorityError('STORY_AUTHORITY_INVALID', message); }

// The Discovery root is a DEPLOYMENT authority, never a caller/task field.
function pinnedDiscoveryRoot() {
  const envRoot = process.env.VIDTOOLZ_DISCOVERY_ROOT;
  return path.resolve(envRoot && envRoot.trim() ? envRoot.trim() : PINNED_DISCOVERY_ROOT);
}

// The Script Builder root is resolved ONLY through the pinned deployment
// authority — the caller may not select it.
function pinnedScriptBuilderRoot() {
  return scriptBuilderAuthority.resolveScriptBuilderRoot().root;
}

const CANON_IDEA_ID_RE = /^[A-Za-z0-9_.-]{3,120}$/;

function readStorePackage(canonicalIdeaId) {
  const id = norm(canonicalIdeaId);
  if (!CANON_IDEA_ID_RE.test(id)) fail(`candidate canonical_idea_id is malformed: ${id}`);
  const root = pinnedDiscoveryRoot();
  // Store-addressable: the package MUST live at <root>/<id>.json inside the
  // pinned store. A hand-copied package under a caller directory cannot match.
  const file = path.join(root, `${id}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(root)) fail('candidate path escapes the pinned Discovery store');
  if (!fs.existsSync(resolved)) fail(`candidate package ${id} is not present in the pinned Discovery store`);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (error) { fail(`candidate package unreadable: ${error.message}`); }
  return { pkg, path: resolved, root };
}

function candidateIdentityFromPackage(pkg, variant) {
  if (pkg.generation_state !== 'COMPLETE') fail(`candidate generation_state ${pkg.generation_state}`);
  const idea = norm(pkg.canonical_idea_id);
  const title = norm(pkg.datasheet?.best_title || pkg.claim_snapshot?.title);
  const script = pkg[`${variant}_script`];
  if (!idea || !title || !script || !Array.isArray(script.beats) || !script.beats.length) fail('candidate missing idea id, title, or script beats');
  if (/canary|not for publication|lifecycle integration/i.test(title)) throw new StoryAuthorityError('CANDIDATE_PACKAGE_IS_CANARY', 'canary/shell/trial scripts are not valid subjects');
  const sourceFingerprint = pkg.source_fingerprint;
  const datasheetFingerprint = pkg.generation_metadata?.datasheet_fingerprint;
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint || '') || !/^[a-f0-9]{64}$/.test(datasheetFingerprint || '')) fail('candidate lacks canonical fingerprints');
  const recorded = pkg.validation?.datasheet?.fingerprint;
  if (recorded && recorded !== datasheetFingerprint) fail('candidate datasheet fingerprint is internally inconsistent');
  if (pkg.validation?.datasheet && pkg.validation.datasheet.status !== 'PASS') fail('candidate datasheet validation is not PASS');
  if (pkg.validation?.scripts && pkg.validation.scripts.status !== 'PASS') fail('candidate script validation is not PASS');
  const sections = script.beats.map((text, index) => ({ section_ref: `beat-${String(index + 1).padStart(2, '0')}`, text: norm(text) }));
  const scriptSha = sha256(sections.map((s) => s.text).join('\n\n'));
  return {
    identity: {
      kind: 'CANDIDATE_SCRIPT', source: 'DISCOVERY_PACKAGE',
      canonical_idea_id: idea, source_fingerprint: sourceFingerprint,
      datasheet_fingerprint: datasheetFingerprint, script_variant: variant, script_sha256: scriptSha,
      authority_source: 'pinned Discovery store (store-addressable, fingerprints verified)',
    },
    sections, title,
  };
}

/*
 * Resolve a Discovery candidate through the PINNED store by canonical_idea_id.
 * Returns a trusted identity registered in the capability WeakSet.
 */
function resolveDiscoveryCandidate({ canonicalIdeaId, variant = 'structure_a' }) {
  const { pkg } = readStorePackage(canonicalIdeaId);
  const { identity, sections, title } = candidateIdentityFromPackage(pkg, variant);
  return makeTrustedSnapshot({ script_identity: identity, script_content: { title, sections } });
}

/*
 * Resolve a canonical Story through the PINNED Script Builder authority.
 * Caller-supplied hash is only an expectation cross-checked against the store.
 */
function resolveCanonicalStory({ projectId, versionId, expectedContentHash }) {
  const project = norm(projectId);
  const version = norm(versionId);
  if (!project || !version) fail('canonical Story requests must name project_id and version_id');
  let loaded;
  try { loaded = loadCanonicalStory({ scriptBuilderRoot: pinnedScriptBuilderRoot(), projectId: project, versionId: version }); }
  catch (error) { fail(`canonical Story authority refused: ${error.message}`); }
  const story = loaded.story;
  if (expectedContentHash && norm(expectedContentHash) !== story.content_hash) {
    fail(`caller-supplied content hash does not match the canonical Story (expected ${story.content_hash})`);
  }
  const sections = story.sections.map((s) => ({ section_ref: s.section_id, text: norm(s.dialogue) })).filter((s) => s.text);
  if (!sections.length) throw new StoryAuthorityError('STORY_SECTIONS_EMPTY', 'Story carries no dialogue sections');
  const identity = {
    kind: 'CANONICAL_STORY', project_id: story.project_id, version_id: story.version_id,
    content_hash: story.content_hash, approval: structuredClone(story.approval),
    authority_source: 'pinned Script Builder store (current head, hash recomputed)',
  };
  return makeTrustedSnapshot({ script_identity: identity, script_content: { title: norm(loaded.project.title || story.central_claim || story.project_id), sections } });
}

// In-process capability check: is THIS identity object one this module resolved?
function isResolvedIdentity(identity) { return RESOLVED_IDENTITIES.has(identity); }

/*
 * Resolve a TRUSTED STORY SNAPSHOT from a caller-supplied STABLE REFERENCE.
 * This is the ONLY way a downstream module obtains Story authority. The
 * reference carries opaque ids only (assertReferenceShape refuses any
 * authoritative field); resolution re-derives content, hash, approval, and
 * lineage from the pinned store. The returned snapshot is a WeakSet member;
 * a serialized copy of it is not trusted.
 */
function resolveTrustedSnapshotFromReference(reference) {
  assertReferenceShape(reference);
  if (reference.kind === 'CANONICAL_STORY') {
    return resolveCanonicalStory({ projectId: reference.project_id, versionId: reference.version_id });
  }
  return resolveDiscoveryCandidate({ canonicalIdeaId: reference.canonical_idea_id, variant: reference.script_variant });
}

/*
 * Cross-process re-verification, now snapshot-producing. A deserialized
 * reference (from task.json) has no capability, so RE-DERIVE the trusted
 * snapshot from the pinned store. Any caller-supplied script_content is treated
 * as UNTRUSTED: it must hash-equal the canonical resolved content or the whole
 * request is refused. The RETURNED snapshot (never the caller's content) is the
 * authoritative object callers must use downstream.
 */
function reverifyIdentity(reference, scriptContent) {
  const snapshot = resolveTrustedSnapshotFromReference(reference);
  if (scriptContent && Array.isArray(scriptContent.sections)) {
    const deliveredSha = sectionsSha(scriptContent.sections);
    const canonicalSha = sectionsSha(snapshot.script_content.sections);
    if (deliveredSha !== canonicalSha) {
      fail('delivered script_content does not match the canonical resolved Story/candidate — caller-supplied content is never authoritative');
    }
  }
  return snapshot;
}

module.exports = {
  PINNED_DISCOVERY_ROOT, StoryAuthorityError,
  pinnedDiscoveryRoot, pinnedScriptBuilderRoot,
  resolveCanonicalStory, resolveDiscoveryCandidate, isResolvedIdentity, reverifyIdentity,
  resolveTrustedSnapshotFromReference, isTrustedSnapshot, storyReferenceOf, assertReferenceShape,
  sha256,
};
