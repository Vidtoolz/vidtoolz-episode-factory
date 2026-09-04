#!/usr/bin/env node
'use strict';
// SCREEN CAPTURE V1 — LIVE CANARIES (safe order) + FROZEN FIVE-BEAT DISPOSITION.
//
//   A. terminal: structured argv, unique nonce            (real process)
//   B. file/git: scratch repository with known HEAD/file  (real git + file)
//   C. browser: deterministic local page, state nonce     (real isolated Chrome)
//   D. PRESTO current telemetry: NOT run here — requires authorized SSH to PRESTO
//   E. Resolve: NOT run here — requires a deployed observe-only provider + lease
// Generic desktop is never run. Canaries use an isolated canary policy (tmp
// roots, generated finalizer key) — the production policy stays MERGED-BUT-
// DISABLED. Then every frozen human-KEEP beat is dispositioned against the
// production policy and the current deployment state: available sources would
// be captured, unavailable ones produce typed replan records (no substitutes).
//
//   node scripts/screen-capture-canaries.js --out <dir>
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../tests/_screen-capture-fixture.js');
const runner = require('../screen-capture/runner.js');
const policyModel = require('../screen-capture/policy.js');
const beats = require('../screen-capture/frozen-beats.js');
const C = require('../screen-capture/contract.js');

const OUT = process.argv.indexOf('--out') > -1 ? process.argv[process.argv.indexOf('--out') + 1] : null;
const rows = []; const note = (label, ok, detail) => { rows.push({ label, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}${detail ? ' :: ' + detail : ''}`); };
function save(name, obj) { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : `${JSON.stringify(obj, null, 2)}\n`); } }

async function main() {
  const fx = fixture.makeFixture();
  try {
    const nonceA = `nonce-canary-a-${Date.now().toString(36)}`;
    const a = fixture.terminalSpec(fx, nonceA); const ra = await runner.runCapture(a, { policy: fx.policy, beat: { beat_id: 'CANARY_A' } });
    note('A terminal: structured argv nonce → READY', ra.ok, ra.ok ? `${ra.bundle.raw.sha256.slice(0, 12)} pid ${ra.bundle.source_snapshot.process_receipt.pid} nonce visible` : `${ra.code} ${ra.detail}`);
    if (ra.ok) { save('canary-a-bundle.json', ra.bundle); save('canary-a-asset-handoff.json', ra.asset_handoff); if (OUT) fs.copyFileSync(ra.bundle.presentation.path, path.join(OUT, 'canary-a-presentation.png')); }
    const b = fixture.gitStatusSpec(fx); const rb = await runner.runCapture(b, { policy: fx.policy, beat: { beat_id: 'CANARY_B' } });
    note('B file/git: scratch repo git-status bound to HEAD/branch/worktree → READY', rb.ok, rb.ok ? `${rb.bundle.source_snapshot.git_state.branch}@${rb.bundle.source_snapshot.git_state.head.slice(0, 12)}` : `${rb.code} ${rb.detail}`);
    const b2 = fixture.fileSpec(fx); const rb2 = await runner.runCapture(b2, { policy: fx.policy, beat: { beat_id: 'CANARY_B2' } });
    note('B file/code: exact range bound to file hash/HEAD → READY', rb2.ok, rb2.ok ? rb2.bundle.source_snapshot.captured_text_sha256.slice(0, 12) : `${rb2.code} ${rb2.detail}`);
    if (rb2.ok) { save('canary-b-bundle.json', rb2.bundle); if (OUT) fs.copyFileSync(rb2.bundle.presentation.path, path.join(OUT, 'canary-b-presentation.png')); }
    const nonceC = `state-canary-c-${Date.now().toString(36)}`; const page = await fixture.startFixturePage({ nonce: nonceC });
    try { const c = fixture.browserSpec(fx, page, nonceC); const rc = await runner.runCapture(c, { policy: fx.policy, beat: { beat_id: 'CANARY_C' } }); note('C browser: deterministic local page with state nonce → READY', rc.ok, rc.ok ? `${rc.bundle.source_snapshot.final_url} viewport ${rc.bundle.source_snapshot.viewport.width}` : `${rc.code} ${rc.detail}`); if (rc.ok) { save('canary-c-bundle.json', rc.bundle); save('canary-c-asset-handoff.json', rc.asset_handoff); if (OUT) fs.copyFileSync(rc.bundle.presentation.path, path.join(OUT, 'canary-c-presentation.png')); if (OUT) fs.copyFileSync(rc.bundle.raw.path, path.join(OUT, 'canary-c-raw.png')); } } finally { await page.close(); }
    note('D PRESTO current telemetry: not executed (requires authorized SSH to PRESTO; current telemetry would prove current state only, never a failover transition)', true, 'skipped by authorization boundary');
    note('E Resolve: not executed (no deployed observe-only provider; gate OFF)', true, 'skipped by authorization/deployment boundary');
    // frozen five beats against the PRODUCTION policy and deployment state
    const prod = policyModel.loadPolicy(policyModel.DEFAULT_POLICY_FILE);
    const env = {}; // no Resolve provider, no stall-log authority, no GitHub evidence identity, no routing receipts, no mapped review console
    const dispositions = beats.FROZEN_BEATS.map((beat) => { const authority = beats.verifyPlanAuthority(beat); const decision = beats.availability(beat, prod, env); const rec = decision.available ? { episode: beat.episode, beat_id: beat.beat_id, state: 'CAPTURE_POSSIBLE' } : beats.unavailableRecord(beat, decision); note(`frozen beat ${beat.episode}/${beat.beat_id}: plan authority ${authority.sha256_matches ? 'verified' : 'MISSING'} → ${rec.state} ${rec.code || ''}`, authority.sha256_matches, rec.detail || ''); return rec; });
    save('frozen-five-beat-dispositions.json', dispositions);
    save('canary-results.json', { at: new Date().toISOString(), rows, production_policy_feature_flag: prod.feature_flag, production_gates: prod.source_gates });
  } finally { fx.cleanup(); }
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${rows.length - failed.length}/${rows.length} canary rows`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
