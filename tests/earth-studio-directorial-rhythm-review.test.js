const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');

test('rhythm review set is production-isolated and deterministic in structure', () => {
  const manifestPath = path.join(root, 'review-manifest.json');
  const decisionsPath = path.join(root, 'review-decisions.json');
  // This is an optional human-review experiment set, not a committed runtime
  // fixture. A clean trunk clone must remain verifiable without local review
  // media; when installed, the complete structure is still checked below.
  if (!fs.existsSync(manifestPath)) {
    assert.equal(fs.existsSync(decisionsPath), false);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.status, 'HUMAN REVIEW ONLY');
  assert.ok(manifest.groups.some((g) => g.group === 'DIRN-11'));
  for (const group of manifest.groups) for (const variant of group.variants) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', variant.path, 'earth-studio.esp')));
    if (variant.status.startsWith('EXPERIMENTAL')) assert.match(variant.label, /EXPERIMENTAL/);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(decisionsPath, 'utf8')).decisions, []);
});
