'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const authority = require('../scripts/script-builder-authority.js');
const preflight = require('../scripts/verify-dependencies.js');

const { test } = require('./_helpers.js');

function tempRoot() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-builder-authority-')); fs.mkdirSync(path.join(root, 'lib')); return root; }

test('Script Builder dependency preflight resolves the pinned executable authority', () => {
  const result = preflight.verifyDependencies();
  assert.equal(result.required, true);
  assert.equal(result.compatible, true);
  assert.equal(result.contract_id, 'vidtoolz-script-builder/story-version-authority/v1');
  assert.match(result.pinned_commit, /^[0-9a-f]{40}$/);
});

test('Script Builder dependency resolution gives an actionable missing-root error', () => {
  const missing = path.join(os.tmpdir(), `missing-script-builder-${process.pid}`);
  assert.throws(() => authority.resolveScriptBuilderRoot(null, { env: { [authority.ENV_NAME]: missing } }),
    (error) => error.code === 'SCRIPT_BUILDER_ROOT_MISSING' && error.message.includes(authority.ENV_NAME));
});

test('an explicit wrong Script Builder path fails instead of falling back', () => {
  const missing = path.join(os.tmpdir(), `wrong-script-builder-${process.pid}`);
  assert.throws(() => authority.resolveScriptBuilderRoot(missing),
    (error) => error.code === 'SCRIPT_BUILDER_ROOT_MISSING' && error.message.includes(missing));
});

test('a Script Builder checkout missing a required file fails at preflight', () => {
  const root = tempRoot();
  const canonical = authority.resolveScriptBuilderRoot().root;
  fs.copyFileSync(path.join(canonical, 'lib', 'versions.js'), path.join(root, 'lib', 'versions.js'));
  assert.throws(() => authority.verifyPinnedAuthority(root),
    (error) => error.code === 'SCRIPT_BUILDER_REQUIRED_FILE_MISSING' && error.message.includes('lib/store.js'));
});

test('a behaviorally incompatible Script Builder version reports pin evidence', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), 'module.exports = { VERSION_AUTHORITY_CONTRACT: { contract_id: "wrong/v2" } };\n');
  fs.writeFileSync(path.join(root, 'lib', 'store.js'), 'module.exports = {};\n');
  assert.throws(() => authority.verifyPinnedAuthority(root),
    (error) => error.code === 'SCRIPT_BUILDER_AUTHORITY_VERSION_MISMATCH'
      && error.message.includes('expected sha256') && error.message.includes('got'));
});

test('VIDTOOLZ_SCRIPT_BUILDER_ROOT wins over repository-local fallbacks', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'lib', 'versions.js'), 'module.exports = {};\n');
  const resolved = authority.resolveScriptBuilderRoot(null, { env: { [authority.ENV_NAME]: root } });
  assert.equal(resolved.root, root);
  assert.equal(resolved.source, authority.ENV_NAME);
});

test('the canonical workflow rejects a missing credential before private checkout', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'verify.yml'), 'utf8');
  const credentialGate = workflow.indexOf('Require private Script Builder read credential');
  const privateCheckout = workflow.indexOf('Check out pinned Script Builder authority');
  assert.ok(credentialGate > 0 && privateCheckout > credentialGate);
  assert.match(workflow, /secrets\.SCRIPT_BUILDER_DEPLOY_KEY != ''/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target/);
});
