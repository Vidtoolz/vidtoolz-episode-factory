'use strict';

/*
 * Test harness for live-current-head Story canaries (hygiene 2026-08-29).
 *
 * Contract:
 *   - LIVE-CURRENT-HEAD tests resolve the canonical Story through the SAME
 *     authoritative mechanism production uses (the Script Builder authority
 *     checkout's own lib/versions.js, exactly as the task assemblers call it).
 *     They assert invariant properties only and never pin version ids or
 *     content hashes — a legitimate human-approved successor must move them.
 *   - EXACT-VERSION assertions live in hermetic fixtures built with the real
 *     pinned Script Builder implementation over isolated data directories
 *     (canonicalStoryFixture), never against the mutable live store.
 *   - No Story authority logic is duplicated here: head resolution, content
 *     hashing, and stale refusal all come from the one certified authority.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scriptBuilderAuthority = require('../scripts/script-builder-authority.js');

/*
 * Resolve the canonical project's current head the way production does:
 * loadCanonicalStory / loadStoryAuthority call versions.listVersions(...).at(-1)
 * inside the resolved Script Builder authority root. Returns the authority
 * primitives themselves so tests can assert invariant properties (identity,
 * recomputed hash, section shape) without restating head-selection logic.
 */
function resolveLiveCanonicalHead(projectId) {
  const resolved = scriptBuilderAuthority.resolveScriptBuilderRoot();
  const dataRoot = path.join(resolved.root, 'data');
  const versions = require(path.join(resolved.root, 'lib', 'versions.js'));
  const store = require(path.join(resolved.root, 'lib', 'store.js'));
  const project = store.loadProject(dataRoot, projectId);
  const list = project ? versions.listVersions(dataRoot, projectId) : [];
  return { root: resolved.root, dataRoot, versions, store, project, list, head: list.at(-1) || null };
}

/*
 * Hermetic Story fixture rooted at an isolated data directory but built with
 * the REAL pinned Script Builder authority implementation (one authority —
 * the fixture's lib/ modules are proxies to the resolved authority checkout,
 * so head resolution, hashing, version creation and stale refusal are the
 * certified production behavior, not test-local imitations).
 */
function canonicalStoryFixture() {
  const authorityRoot = scriptBuilderAuthority.resolveScriptBuilderRoot().root;
  const versionsPath = path.join(authorityRoot, 'lib', 'versions.js');
  const storePath = path.join(authorityRoot, 'lib', 'store.js');
  const configPath = path.join(authorityRoot, 'lib', 'config.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-authority-fixture-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), `module.exports = require(${JSON.stringify(versionsPath)});\n`);
  fs.writeFileSync(path.join(root, 'lib', 'store.js'), `module.exports = require(${JSON.stringify(storePath)});\n`);
  const versions = require(versionsPath);
  const store = require(storePath);
  const config = require(configPath);
  const dataRoot = path.join(root, 'data');
  store.ensureLayout(dataRoot);
  return { root, dataRoot, versions, store, config };
}

module.exports = { resolveLiveCanonicalHead, canonicalStoryFixture };
