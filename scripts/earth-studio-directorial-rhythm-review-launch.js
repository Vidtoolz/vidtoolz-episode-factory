#!/usr/bin/env node
'use strict';

// Small terminal launcher for the human gate. It does not alter production
// policy and does not claim a project is reviewable before import verification.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(process.argv[2] || 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'review-manifest.json'), 'utf8'));
const decisionsFile = path.join(root, manifest.decisions_file || 'review-decisions.json');
const choices = ['PREFER_A', 'PREFER_B', 'PREFER_C', 'NO_MEANINGFUL_DIFFERENCE', 'BOTH_BAD', 'REPLAY_UNDECIDED'];
const ask = (rl, q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Earth Studio Directorial Rhythm Review — HUMAN REVIEW ONLY');
  manifest.groups.forEach((g, i) => console.log(`${i + 1}. ${g.group}`));
  const n = Number(await ask(rl, 'Select comparison: ')) - 1;
  const group = manifest.groups[n];
  if (!group) { rl.close(); throw new Error('unknown comparison'); }
  if (group.variants.some((v) => v.import_status !== 'IMPORT_VERIFIED')) {
    rl.close(); throw new Error(`${group.group}: real Earth Studio import is still pending; no verdict recorded.`);
  }
  console.log(`\n${group.group}`);
  for (const v of group.variants) {
    console.log(`\n${v.label}`);
    console.log(`  ${v.duration_seconds}s total; ${v.path}`);
    console.log(`  ${v.hypothesis}`);
    console.log(`  import/technical status: ${v.import_status || 'IMPORT_PENDING'} / ${v.technical_ok ? 'TECHNICALLY_VALID' : 'TECHNICAL_REVIEW_REQUIRED'}`);
  }
  console.log('\nImport and play the labeled variants in Earth Studio before recording a verdict.');
  const verdict = await ask(rl, `Verdict (${choices.join(', ')}): `);
  if (!choices.includes(verdict)) { rl.close(); throw new Error(`invalid verdict: ${verdict}`); }
  const comment = await ask(rl, 'Comment (optional): ');
  const data = JSON.parse(fs.readFileSync(decisionsFile, 'utf8'));
  data.decisions = (data.decisions || []).filter((d) => d.group !== group.group);
  data.decisions.push({ group: group.group, verdict, comment, recorded_at: new Date().toISOString() });
  data.decisions.sort((a, b) => a.group.localeCompare(b.group));
  fs.writeFileSync(decisionsFile, `${JSON.stringify(data, null, 2)}\n`);
  rl.close();
  console.log(`Recorded ${verdict} for ${group.group}. This does not change production policy.`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
