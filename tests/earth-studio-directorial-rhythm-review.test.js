const { assert, test } = require('./_helpers.js');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');

test('rhythm review set is production-isolated and deterministic in structure', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'review-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'HUMAN REVIEW ONLY');
  assert.ok(manifest.groups.some((g) => g.group === 'DIRN-11'));
  for (const group of manifest.groups) for (const variant of group.variants) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', variant.path, 'earth-studio.esp')));
    if (variant.status.startsWith('EXPERIMENTAL')) assert.match(variant.label, /EXPERIMENTAL/);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'review-decisions.json'), 'utf8')).decisions, []);
});
