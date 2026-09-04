#!/usr/bin/env node
'use strict';
// SCREEN CAPTURE V1 — FROZEN ORACLE CONFORMANCE.
//
// Runs the FROZEN Codex acceptance oracle (immutable; lives outside production)
// against records this implementation actually produces: real terminal,
// git-status, file/code and browser captures through the production runner in
// an isolated fixture, plus every typed failure the runner emits, are validated
// with the oracle's own validateCaptureSpec / validateBundle / validateFailure,
// and the oracle's 196-test harness is executed unchanged.
//
//   SCREEN_CAPTURE_ORACLE_ROOT=/path/to/oracle-checkout node scripts/screen-capture-oracle-conformance.js [--out DIR]
// Default oracle root: the frozen worktree recorded in FREEZE-MANIFEST (dc525e05…).
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../tests/_screen-capture-fixture.js');
const runner = require('../screen-capture/runner.js');

const ORACLE_SHA = 'dc525e05db4f78add86eda44848cb117a96e3628';
const ORACLE_ROOT = process.env.SCREEN_CAPTURE_ORACLE_ROOT || '/home/vidtoolz/ef-screen-capture-v1-oracle-20260904';
const OUT = (process.argv.indexOf('--out') > -1 ? process.argv[process.argv.indexOf('--out') + 1] : null);
const results = []; const check = (label, ok, detail) => { results.push({ label, ok: Boolean(ok), detail: detail || null }); console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}${ok || !detail ? '' : ` :: ${detail}`}`); };
const codes = (r) => [...new Set((r.issues || []).map((i) => i.code))].join(',');

async function main() {
  const oraclePath = path.join(ORACLE_ROOT, 'acceptance-oracles', 'screen-capture-v1', 'oracle.js');
  if (!fs.existsSync(oraclePath)) { console.error(`frozen oracle not found at ${oraclePath}`); process.exit(2); }
  const head = childProcess.execFileSync('git', ['-C', ORACLE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = childProcess.execFileSync('git', ['-C', ORACLE_ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  check(`oracle checkout is the frozen commit ${ORACLE_SHA.slice(0, 12)} and clean`, head === ORACLE_SHA && !dirty, `${head} ${dirty ? 'DIRTY' : 'clean'}`);
  const oracle = require(oraclePath);
  const fx = fixture.makeFixture();
  const ctx = () => ({ outputRoots: fx.policy.approved.output_roots, sourceRoots: { terminal: fx.policy.approved.terminal_root }, repositories: fx.policy.approved.repositories, localFixturePorts: fx.policy.approved.local_fixture_ports, terminalAuthorities: fx.policy.approved.terminal_authorities });
  const accepted = [];
  try {
    // real captures → oracle bundle validation
    const cases = [];
    const t = fixture.terminalSpec(fx); cases.push(['TERMINAL fixture-nonce', t]);
    const g = fixture.gitStatusSpec(fx); cases.push(['TERMINAL git-status', g]);
    const f = fixture.fileSpec(fx); cases.push(['FILE_OR_CODE range', f]);
    const nonce = `state-conf-${Date.now().toString(36)}`; const page = await fixture.startFixturePage({ nonce });
    try {
      const b = fixture.browserSpec(fx, page, nonce); cases.push(['BROWSER local fixture page', b]);
      for (const [label, spec] of cases) {
        const sr = oracle.validateCaptureSpec(spec, ctx()); check(`${label}: CaptureSpec accepted by the frozen oracle`, sr.ok, codes(sr));
        const r = await runner.runCapture(spec, { policy: fx.policy, beat: { beat_id: 'B_CONF', episode: 'CONFORMANCE' } });
        check(`${label}: runner reached READY_FOR_EPISODE_FACTORY`, r.ok, r.ok ? '' : `${r.code}: ${r.detail}`);
        if (r.ok) { const br = oracle.validateBundle(spec, r.bundle, ctx()); check(`${label}: evidence bundle accepted by the frozen oracle`, br.ok, codes(br)); check(`${label}: oracle evidence digest equals handoff digest`, br.ok && br.evidence_digest_sha256 === r.bundle.handoff.evidence_digest_sha256); accepted.push({ label, spec, bundle: r.bundle, handoff: r.asset_handoff }); }
      }
      // typed failures → oracle failure validation
      const fails = [];
      const inj = fixture.terminalSpec(fx); inj.source.argv[1] = 'nonce;touch-owned'; fails.push(['shell metacharacter in argv', inj, 'SPEC_REJECTED']);
      const bad = fixture.browserSpec(fx, page, nonce); bad.source.url = `http://127.0.0.1:${page.port}/missing`; fails.push(['browser 404 page', bad, 'CAPTURE_FAILED']);
      const login = fixture.browserSpec(fx, page, nonce); login.source.url = `http://127.0.0.1:${page.port}/login`; fails.push(['browser sign-in page', login, 'AUTH_REQUIRED']);
      const desk = fixture.baseSpec(fixture.captureId('desk'), { type: 'DESKTOP_APPLICATION', application_id: 'gedit', process_executable: 'gedit', window_title: 'x', session_id: 'test-session', monitor_id: 'm1', expected_state: 'idle', allow_focus_change: false }, ['visible:x']); desk.output.raw_name = 'raw.png'; fails.push(['generic desktop request', desk, 'SOURCE_UNAVAILABLE']);
      const sec = fixture.terminalSpec(fx, `nonce-sec-${Date.now().toString(36)}`); fs.writeFileSync(fx.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\nOPENAI_API_KEY=sk-test-FIXTURE0000000000000000\\n');\n"); fails.push(['synthetic secret in process output', sec, 'PRIVACY_BLOCKED']);
      for (const [label, spec, expectedCode] of fails) {
        const r = await runner.runCapture(spec, { policy: fx.policy });
        check(`${label}: typed ${expectedCode}`, !r.ok && r.code === expectedCode, `${r.code}: ${(r.detail || '').slice(0, 120)}`);
        if (r.failure && r.failure.spec_digest_sha256) { const fr = oracle.validateFailure(spec, r.failure, ctx()); check(`${label}: failure record accepted by the frozen oracle`, fr.ok, codes(fr)); }
        else check(`${label}: spec-level rejection carries no artifacts`, r.failure ? r.failure.artifacts.length === 0 : true);
      }
      fs.writeFileSync(fx.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n');\n");
    } finally { await page.close(); }
    // the oracle's own frozen harness, unchanged
    const resultsFile = path.join(fx.root, 'oracle-results.json');
    const run = childProcess.spawnSync(process.execPath, [path.join(ORACLE_ROOT, 'acceptance-oracles', 'screen-capture-v1', 'tests', 'run.js')], { cwd: ORACLE_ROOT, encoding: 'utf8', env: { ...process.env, SCREEN_CAPTURE_ORACLE_RESULTS: resultsFile, SCREEN_CAPTURE_ORACLE_EVIDENCE_DIR: path.join(fx.root, 'oracle-evidence') }, maxBuffer: 64 * 1024 * 1024 });
    let summary = null; try { summary = JSON.parse(fs.readFileSync(resultsFile, 'utf8')); } catch (_) {}
    check('frozen oracle harness 196/196 (145 critical, 48 high, 3 medium)', run.status === 0 && summary && summary.total === 196 && summary.passed === 196 && summary.counts.CRITICAL === 145 && summary.counts.HIGH === 48 && summary.counts.MEDIUM === 3, summary ? JSON.stringify({ total: summary.total, passed: summary.passed, failures: summary.failures }) : run.stderr.slice(-300));
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); if (summary) fs.copyFileSync(resultsFile, path.join(OUT, 'oracle-harness-results.json')); fs.writeFileSync(path.join(OUT, 'oracle-harness-run.log'), run.stdout + run.stderr); fs.writeFileSync(path.join(OUT, 'conformance-results.json'), JSON.stringify({ oracle_commit: head, results, accepted: accepted.map((a) => ({ label: a.label, capture_id: a.spec.capture_id, evidence_digest: a.bundle.handoff.evidence_digest_sha256, handoff_digest: a.handoff.handoff_digest_sha256 })) }, null, 2)); for (const a of accepted) { fs.writeFileSync(path.join(OUT, `${a.spec.capture_id}-spec.json`), JSON.stringify(a.spec, null, 2)); fs.writeFileSync(path.join(OUT, `${a.spec.capture_id}-bundle.json`), JSON.stringify(a.bundle, null, 2)); fs.writeFileSync(path.join(OUT, `${a.spec.capture_id}-asset-handoff.json`), JSON.stringify(a.handoff, null, 2)); fs.copyFileSync(a.bundle.presentation.path, path.join(OUT, `${a.spec.capture_id}-presentation.png`)); } }
  } finally { fx.cleanup(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${results.length - failed.length}/${results.length} conformance checks against frozen oracle ${ORACLE_SHA}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('CONFORMANCE ERROR', e); process.exit(1); });
