#!/usr/bin/env node
'use strict';
// Verify Mikko's durable human decision record for the Sound & Music Director
// production baseline. Read-only. Reuses the CANONICAL approval-binding
// mechanism (scripts/agent-contract-validator.js verifyApprovalBinding) — no
// parallel approval doctrine.
//
// Usage: node scripts/verify-agent-acceptance.js [--record <path>]
// Exit 0 only when the exact approved commit bytes still match the binding.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const validator = require('./agent-contract-validator.js');

function main() {
  const args = process.argv.slice(2);
  let recordPath = path.join(__dirname, '..', 'approvals', 'sound-music-director-acceptance.json');
  const i = args.indexOf('--record');
  if (i >= 0 && args[i + 1]) recordPath = path.resolve(args[i + 1]);

  const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const b = rec.artifact_binding;
  const errors = [];
  if (rec.decision !== 'ACCEPT') errors.push(`decision is ${rec.decision}, expected ACCEPT`);
  if (!rec.approved_commit) errors.push('missing approved_commit');
  if (b.commit !== rec.approved_commit) errors.push('binding.commit != approved_commit');
  if (b.scope !== rec.scope) errors.push('binding.scope != record scope');
  if (b.approved_by !== rec.deciding_human) errors.push('binding.approved_by != deciding_human');
  if (b.approved_at !== rec.decided_at) errors.push('binding.approved_at != decided_at');
  for (const f of ['artifact_path', 'artifact_sha256', 'commit', 'approved_by', 'approved_at', 'scope']) {
    if (!b[f]) errors.push(`artifact_binding missing ${f}`);
  }

  let bytes = null;
  try {
    bytes = execFileSync('git', ['cat-file', 'commit', rec.approved_commit]);
  } catch {
    errors.push(`approved commit ${rec.approved_commit} not retrievable`);
  }
  if (bytes) {
    const v = validator.verifyApprovalBinding(b, bytes);
    if (v.verdict !== 'VALID') errors.push(`approval binding not VALID: ${v.verdict} — ${v.reason || ''}`);
  }
  // Approved commit must remain an ancestor of the recorded commit itself (immutability is inherent).
  const out = { record: path.relative(process.cwd(), recordPath), decision: rec.decision,
    approved_commit: rec.approved_commit, scope: rec.scope,
    binding: bytes ? validator.verifyApprovalBinding(b, bytes) : null };
  if (errors.length) {
    console.error(JSON.stringify({ ...out, verdict: 'INVALID', errors }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ...out, verdict: 'VALID' }, null, 2));
}

if (require.main === module) main();
module.exports = { main };
