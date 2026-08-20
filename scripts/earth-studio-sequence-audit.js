#!/usr/bin/env node
'use strict';

// Per-evaluation sequence audit. This is intentionally a report generator,
// not a policy engine: warnings are evidence for director/human review and
// errors are plan-to-compiled-timeline contract failures.
const fs = require('fs');
const path = require('path');
const { auditSequence, formatSequenceSummary } = require('../earth-studio-sequence-audit.js');
const { auditIntentContracts } = require('../earth-studio-intent-contract-audit.js');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function auditDir(dir) {
  const direction = readJson(path.join(dir, 'direction.json'));
  const shotPlan = readJson(path.join(dir, 'shot-plan.json'));
  const journeyFile = path.join(dir, 'journey.json');
  const continuationFile = path.join(dir, 'continuation-state.json');
  const jobFile = path.join(dir, 'job.json');
  const input = { direction, shotPlan, journey: fs.existsSync(journeyFile) ? readJson(journeyFile) : {}, continuation: fs.existsSync(continuationFile) ? readJson(continuationFile) : {}, job: fs.existsSync(jobFile) ? readJson(jobFile) : {} };
  const report = auditSequence(input);
  const contracts = auditIntentContracts({ ...input, sequenceReport: report });
  fs.writeFileSync(path.join(dir, 'sequence-execution.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'sequence-execution.md'), `# Sequence execution audit\n\n\`\`\`text\n${formatSequenceSummary(report)}\n\`\`\`\n`);
  fs.writeFileSync(path.join(dir, 'intent-contracts.json'), `${JSON.stringify(contracts, null, 2)}\n`);
  return { report, contracts };
}

const root = path.resolve(process.argv[2] || '.');
function candidateDirs(dir) {
  if (fs.existsSync(path.join(dir, 'direction.json')) && fs.existsSync(path.join(dir, 'shot-plan.json'))) return [dir];
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out = out.concat(candidateDirs(path.join(dir, entry.name)));
  }
  return out;
}
const dirs = candidateDirs(root);
const results = [];
dirs.forEach((dir) => {
  if (!fs.existsSync(path.join(dir, 'direction.json')) || !fs.existsSync(path.join(dir, 'shot-plan.json'))) return;
  try {
    const out = auditDir(dir);
    const report = out.report;
    results.push({ case: path.basename(path.dirname(dir)), dir, execution_ok: report.execution_ok, errors: report.errors.map((e) => e.code), warnings: report.warnings.map((w) => w.code), contract_coverage: out.contracts.coverage, total_seconds: report.timeline.total_duration_seconds, travel_fraction: report.shares.travel_fraction });
  } catch (err) {
    results.push({ case: path.basename(dir), dir, execution_ok: false, errors: ['AUDIT_ERROR'], message: err.message });
  }
});
console.log(JSON.stringify({ root, count: results.length, results }, null, 2));
