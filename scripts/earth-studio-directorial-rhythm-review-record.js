#!/usr/bin/env node
'use strict';

// Minimal human verdict recorder. It never edits production plans or policy.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');
const file = path.join(root, 'review-decisions.json');
const [groupId, verdict, comment = ''] = process.argv.slice(3);
const allowed = new Set(['PREFER_A', 'PREFER_B', 'PREFER_C', 'NO_MEANINGFUL_DIFFERENCE', 'BOTH_BAD', 'REPLAY_UNDECIDED']);
if (!groupId || !allowed.has(verdict)) {
  console.error('Usage: node scripts/earth-studio-directorial-rhythm-review-record.js <root> <group> <PREFER_A|PREFER_B|PREFER_C|NO_MEANINGFUL_DIFFERENCE|BOTH_BAD|REPLAY_UNDECIDED> [comment]');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'review-manifest.json'), 'utf8'));
const selected = manifest.groups.find((g) => g.group === groupId);
if (!selected || selected.variants.some((v) => v.import_status !== 'IMPORT_VERIFIED')) {
  console.error('Cannot record a visual verdict before every variant in the group has verified real Earth Studio import.');
  process.exit(3);
}
data.decisions = (data.decisions || []).filter((d) => d.group !== groupId);
data.decisions.push({ group: groupId, verdict, comment, recorded_at: new Date().toISOString() });
data.decisions.sort((a, b) => a.group.localeCompare(b.group));
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify(data, null, 2));
