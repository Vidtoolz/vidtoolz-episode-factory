'use strict';
// Shared fixture for Screen Capture V1 tests, oracle conformance and canaries:
// an isolated policy (all gates ON, tmp roots, generated finalizer key), a
// scratch Git repository, a terminal nonce fixture and CaptureSpec builders.
// Nothing here touches production roots, displays or remote machines.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const C = require('../screen-capture/contract.js');
const store = require('../screen-capture/evidence-store.js');

function makeFixture({ gates } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-v1-'));
  const terminalRoot = path.join(root, 'sources', 'terminal'); const cwd = path.join(terminalRoot, 'work'); const repoRoot = path.join(root, 'sources', 'repo-a');
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(repoRoot, { recursive: true });
  const sourceFile = path.join(repoRoot, 'evidence.js');
  fs.writeFileSync(sourceFile, "// repository: repo-a\nconst state = 'CURRENT';\nconst contradiction = false;\nmodule.exports = state;\n");
  const git = (...args) => childProcess.execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-04T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-04T10:00:00Z' } });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture'); git('add', 'evidence.js'); git('commit', '-q', '-m', 'authentic source fixture');
  const fixtureScript = path.join(cwd, 'emit-nonce.js'); fs.writeFileSync(fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n');\n");
  const keyPath = path.join(root, 'keys', 'finalizer.pem'); store.generateSigningKey(keyPath);
  const policy = {
    schema: 'vidtoolz.screen-capture-policy.v1', feature_flag: true,
    source_gates: { TERMINAL: true, FILE_OR_CODE: true, BROWSER: true, DESKTOP_APPLICATION: true, DAVINCI_RESOLVE: true, ...(gates || {}) },
    machine: { id: 'vidnux', session_id: 'test-session' },
    approved: { terminal_root: terminalRoot, repositories: { 'repo-a': { root: repoRoot } }, output_roots: { evidence: path.join(root, 'evidence') }, local_fixture_ports: [], terminal_authorities: {}, browser_profile_root: path.join(root, 'profiles') },
    stores: { spool_root: path.join(root, 'spool'), evidence_root: path.join(root, 'evidence'), signing_key_path: keyPath, presentation_root: path.join(root, 'evidence'), receipts_root: path.join(root, 'receipts') },
    idle: { minimum_idle_seconds: 60, sample_gap_seconds: 5, samples: 2 }, limits: { terminal_timeout_ms: 15000, browser_timeout_ms: 30000, max_stdout_bytes: 1048576 },
    deployment: { presto: { machine_uuid_sha256: 'bbb75fc75c06e0999d64765ad997cb7c90d1efbc3fbdfc47b83be5b0abf675bd', address_role: 'control' } },
  };
  return { root, terminalRoot, cwd, repoRoot, sourceFile, fixtureScript, keyPath, policy, git, cleanup: () => { try { fs.chmodSync(root, 0o700); } catch (_) {} for (let i = 0; i < 6; i += 1) { childProcess.spawnSync('chmod', ['-R', 'u+rwX', root]); try { fs.rmSync(root, { recursive: true, force: true }); return; } catch (e) { if (i === 5) throw e; childProcess.spawnSync('sleep', ['0.3']); } } } };
}

let counter = 0;
function captureId(prefix = 'test') { counter += 1; return `capture-${prefix}-${Date.now().toString(36)}-${counter}-${crypto.randomBytes(2).toString('hex')}`; }
function baseSpec(id, source, facts) {
  return {
    schema: C.SCHEMA.spec, capture_id: id, requested_at: new Date(Date.now() - 2000).toISOString(),
    evidence_target: { claim: 'Fixture claim: the requested current state is visible', required_facts: facts, forbidden_omissions: ['surrounding context'] },
    source, capture: { mode: 'STATIC_FRAME', duration_seconds: 0, fps: 0, action: source.type === 'TERMINAL' ? 'EXECUTE_TEMPLATE' : source.type === 'FILE_OR_CODE' ? 'READ_RANGE' : source.type === 'BROWSER' ? 'NAVIGATE_AND_WAIT' : 'OBSERVE_ONLY', action_completed_at: new Date(Date.now() - 1000).toISOString() },
    machine: { id: 'vidnux', session_id: 'test-session' }, privacy: { policy_id: 'BLOCK_SECRETS_V1', allow_personal_redaction: false, secret_response: 'BLOCK' },
    output: { root_id: 'evidence', relative_dir: `${id}/attempt-0001`, raw_name: 'raw.txt', presentation_name: 'presentation.png' },
    presentation: { width: 1080, height: 1920, safe_area: { left: 72, right: 72, top: 96, bottom: 144 }, minimum_text_px: 32, max_zoom: 4, retain_context: true },
    failure_policy: { on_capture_failure: 'FAIL_AND_REPLAN', allow_representation_fallback: false, human_escalation: 'VISUAL_DIRECTOR' },
  };
}
// TERMINAL via the fixture-nonce template (explicit authority in policy).
function terminalSpec(fx, nonce = `nonce-fx-${crypto.randomBytes(4).toString('hex')}`) {
  const id = captureId('terminal');
  fx.policy.approved.terminal_authorities['fixture-nonce'] = { executable: 'node', argv: [fx.fixtureScript, nonce], cwd: fx.cwd };
  const spec = baseSpec(id, { type: 'TERMINAL', template_id: 'fixture-nonce', executable: 'node', argv: [fx.fixtureScript, nonce], cwd: fx.cwd, expected_nonce: nonce }, [`visible:${nonce}`, 'exit-code:0']);
  return spec;
}
// TERMINAL git-status in the scratch repo (branch name carries the nonce, like the oracle fixture).
function gitStatusSpec(fx, nonce = `nonce-git-${crypto.randomBytes(3).toString('hex')}`) {
  fx.git('checkout', '-q', '-b', nonce);
  const g = C.gitIdentity(fx.repoRoot);
  fx.policy.approved.terminal_root = path.join(fx.root, 'sources');
  const id = captureId('gitstatus');
  return baseSpec(id, { type: 'TERMINAL', template_id: 'git-status', executable: 'git', argv: ['status', '--porcelain=v1', '--branch'], cwd: fx.repoRoot, expected_nonce: nonce, repository: { id: 'repo-a', root: fx.repoRoot, head: g.head, branch: g.branch, worktree_state_sha256: g.worktree_state_sha256 } }, [`visible:${nonce}`, 'exit-code:0', `git-head:${g.head}`]);
}
function fileSpec(fx, { lineStart = 1, lineEnd = 4, context = [2, 3] } = {}) {
  const g = C.gitIdentity(fx.repoRoot); const id = captureId('file');
  return baseSpec(id, { type: 'FILE_OR_CODE', repository_id: 'repo-a', repository_root: fx.repoRoot, path: 'evidence.js', source_sha256: C.sha256File(fx.sourceFile), git_head: g.head, git_branch: g.branch, git_worktree_state_sha256: g.worktree_state_sha256, line_start: lineStart, line_end: lineEnd, required_context_lines: context }, ["visible:const state = 'CURRENT';", `git-head:${g.head}`, `line-range:${lineStart}-${lineEnd}`]);
}
// Deterministic local page with a current-state nonce; returns { server, port, url }.
function startFixturePage({ nonce, html, redirectTo = null, status = 200, fontPx = 28 } = {}) {
  const body = html || `<!doctype html><meta charset="utf-8"><title>Fixture proof page</title><style>body{font-family:sans-serif;font-size:${fontPx}px;margin:24px}#proof{padding:16px;border:2px solid #333}</style><h1>Deterministic current state</h1><div id="proof">state token: ${nonce}</div><p>context line kept</p>`;
  const server = http.createServer((req, res) => {
    if (redirectTo && req.url === '/start') { res.writeHead(302, { Location: redirectTo }); res.end(); return; }
    if (req.url === '/missing') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
    if (req.url === '/login') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<form><input type="password" name="p"><div id="proof">' + nonce + '</div></form>'); return; }
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { const port = server.address().port; resolve({ server, port, url: `http://127.0.0.1:${port}/proof`, close: () => new Promise((r) => server.close(r)) }); }));
}
function browserSpec(fx, page, nonce, overrides = {}) {
  fx.policy.approved.local_fixture_ports = [...new Set([...(fx.policy.approved.local_fixture_ports || []), page.port])];
  const id = captureId('browser');
  const spec = baseSpec(id, { type: 'BROWSER', url: page.url, selector: '#proof', expected_state_nonce: nonce, network_zone: 'LOCAL_FIXTURE', allow_redirects: [], ...overrides }, [`visible:${nonce}`, `final-url:${overrides.finalUrl || page.url}`, 'selector-visible']);
  spec.output.raw_name = 'raw.png';
  return spec;
}
function resolveSpec(fx) {
  const id = captureId('resolve');
  const spec = baseSpec(id, { type: 'DAVINCI_RESOLVE', application_id: 'davinci-resolve', process_executable: 'Resolve.exe', window_title: 'DaVinci Resolve - EP01 Timeline', session_id: 'test-session', monitor_id: 'monitor-1', expected_state: 'edit-page-idle', allow_focus_change: false, project_id: 'EP01_PROMPT_HYPE', timeline_id: 'EP01 Timeline', playhead_frame: 1200 }, ['visible:EP01_PROMPT_HYPE']);
  spec.machine = { id: 'presto', session_id: 'test-session' }; spec.output.raw_name = 'raw.png';
  return spec;
}
function goodResolveState() {
  return { application_id: 'davinci-resolve', process_executable: 'Resolve.exe', window_id: 'w1', focused_window_id: 'w1', window_title: 'DaVinci Resolve - EP01 Timeline', session_id: 'test-session', monitor_id: 'monitor-1', visible: true, minimized: false, obscured_ratio: 0, ready: true, modal_present: false, process_running: true, project_id: 'EP01_PROMPT_HYPE', timeline_id: 'EP01 Timeline', playhead_frame: 1200, page: 'edit', rendering: false, playing: false, background_task_active: false, machine: { uuid_sha256: 'bbb75fc75c06e0999d64765ad997cb7c90d1efbc3fbdfc47b83be5b0abf675bd', address_role: 'control', user: 'presto', console_session_id: '1', collection_session_id: 'ssh-9' } };
}
// A tiny valid PNG (solid colour) for fixture pixel sources.
function solidPng(width, height, rgb = [40, 60, 90]) {
  const zlib = require('node:zlib'); const png = require('../screen-capture/png.js');
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x += 1) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.alloc(row.length * height); for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const name = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(png.crc32(Buffer.concat([name, data]))); return Buffer.concat([len, name, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const idleDeps = (idleMs = 120000, { active = true, locked = false } = {}) => ({ idle: () => ({ ok: true, idle_ms: idleMs }), session: () => ({ ok: true, active, locked }), sleep: async () => {}, now: () => Date.now() });

module.exports = { makeFixture, captureId, baseSpec, terminalSpec, gitStatusSpec, fileSpec, startFixturePage, browserSpec, resolveSpec, goodResolveState, solidPng, idleDeps };
