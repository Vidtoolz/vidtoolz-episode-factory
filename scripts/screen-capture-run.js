#!/usr/bin/env node
'use strict';
// Stage 7 CLI: run one CaptureSpec V1 through the Screen Capture execution
// authority and print the typed outcome. Request-only entry point for Episode
// Factory / the Visual Director; policy comes from config/screen-capture-policy.json
// unless --policy names another policy file (activation is configuration).
//
//   node scripts/screen-capture-run.js --spec <capture-spec.json> [--policy <policy.json>] [--beat <beat_id>] [--episode <id>] [--run <run_id>] [--out <dir>]
const fs = require('node:fs');
const path = require('node:path');
const runner = require('../screen-capture/runner.js');
const policyModel = require('../screen-capture/policy.js');

function arg(name, fallback = null) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; }
async function main() {
  const specFile = arg('--spec');
  if (!specFile) { console.error('usage: screen-capture-run.js --spec <capture-spec.json> [--policy <policy.json>] [--beat <beat_id>] [--episode <id>] [--run <run_id>] [--out <dir>]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const policy = arg('--policy', policyModel.DEFAULT_POLICY_FILE);
  const outcome = await runner.runCapture(spec, { policy, beat: { beat_id: arg('--beat'), episode: arg('--episode'), run_id: arg('--run') } });
  const out = arg('--out');
  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `${spec.capture_id || 'capture'}-outcome.json`), `${JSON.stringify(outcome, null, 2)}\n`); }
  const summary = outcome.ok ? { state: outcome.state, capture_id: spec.capture_id, raw: outcome.bundle.raw.path, raw_sha256: outcome.bundle.raw.sha256, presentation: outcome.bundle.presentation.path, evidence_digest_sha256: outcome.bundle.handoff.evidence_digest_sha256, qc: outcome.qc.verdict, trust_anchor_class: outcome.protection.trust_anchor_class } : { state: outcome.state, code: outcome.code, stage: outcome.stage, detail: outcome.detail, issues: outcome.issues };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(outcome.ok ? 0 : 1);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
