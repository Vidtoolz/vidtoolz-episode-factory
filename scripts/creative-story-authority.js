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
  RESOLVED_IDENTITIES.add(identity);
  return { script_identity: identity, script_content: { title, sections } };
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
  RESOLVED_IDENTITIES.add(identity);
  return { script_identity: identity, script_content: { title: norm(loaded.project.title || story.central_claim || story.project_id), sections } };
}

// In-process capability check: is THIS identity object one this module resolved?
function isResolvedIdentity(identity) { return RESOLVED_IDENTITIES.has(identity); }

/*
 * Cross-process re-verification: a deserialized identity (from task.json) has
 * lost its capability membership, so RE-DERIVE from the pinned store and confirm
 * the deserialized identity matches exactly. Never trusts task fields.
 * Returns the trusted (freshly resolved) identity; throws on any mismatch.
 */
function reverifyIdentity(identity, scriptContent) {
  if (!identity || typeof identity !== 'object') fail('script identity required for re-verification');
  if (identity.kind === 'CANONICAL_STORY') {
    const resolved = resolveCanonicalStory({ projectId: identity.project_id, versionId: identity.version_id, expectedContentHash: identity.content_hash });
    const r = resolved.script_identity;
    if (r.project_id !== identity.project_id || r.version_id !== identity.version_id || r.content_hash !== identity.content_hash) {
      fail('canonical Story re-resolution does not match the task identity (forged or stale)');
    }
    return resolved;
  }
  if (identity.kind === 'CANDIDATE_SCRIPT') {
    const resolved = resolveDiscoveryCandidate({ canonicalIdeaId: identity.canonical_idea_id, variant: identity.script_variant });
    const r = resolved.script_identity;
    if (r.canonical_idea_id !== identity.canonical_idea_id || r.script_sha256 !== identity.script_sha256
      || r.source_fingerprint !== identity.source_fingerprint || r.datasheet_fingerprint !== identity.datasheet_fingerprint) {
      fail('candidate re-resolution does not match the task identity (forged or altered)');
    }
    // Bind the delivered script_content to the store-derived identity.
    if (scriptContent && Array.isArray(scriptContent.sections)) {
      const deliveredSha = sha256(scriptContent.sections.map((s) => norm(s.text)).join('\n\n'));
      if (deliveredSha !== r.script_sha256) fail('delivered script_content does not hash to the store-verified candidate identity');
    }
    return resolved;
  }
  fail(`unknown script identity kind ${identity.kind}`);
  return null;
}

module.exports = {
  PINNED_DISCOVERY_ROOT, StoryAuthorityError,
  pinnedDiscoveryRoot, pinnedScriptBuilderRoot,
  resolveCanonicalStory, resolveDiscoveryCandidate, isResolvedIdentity, reverifyIdentity,
  sha256,
};
