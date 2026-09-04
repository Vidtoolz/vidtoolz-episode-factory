'use strict';
// TERMINAL adapter — bounded structured-argv execution, no shell of any kind.
//
// The evidentiary source is the process's own stdout: the raw artifact is the
// exact stdout bytes (format TEXT) whose hash is the process receipt's
// stdout_sha256. No terminal window is drawn and no text is retyped; the
// presentation layer typesets those exact bytes as a derivative.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { TERMINAL_TEMPLATES, TERMINAL_META_RE, sha256Bytes, sha256File, gitIdentity, canonical } = require('../contract.js');

const ADAPTER = Object.freeze({ id: 'vidtoolz-terminal-adapter', version: '1.0.0' });
function fail(code, message) { return Object.assign(new Error(message), { code, stage: 'capture' }); }

function resolveExecutable(name) {
  if (name.includes('/') || name.includes('\\')) throw fail('SPEC_REJECTED', 'executable must be a bare template name, not a path');
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try { const st = fs.statSync(candidate); if (st.isFile() && (st.mode & 0o111)) return fs.realpathSync(candidate); } catch (_) {}
  }
  throw fail('SOURCE_UNAVAILABLE', `executable ${name} not found on PATH`);
}

function capture(spec, ctx) {
  const source = spec.source;
  const template = TERMINAL_TEMPLATES[source.template_id];
  if (!template) throw fail('SPEC_REJECTED', 'unknown terminal template');
  if (template.executable !== source.executable) throw fail('SPEC_REJECTED', 'executable differs from template');
  if (!Array.isArray(source.argv) || source.argv.length > template.maxArgs || template.prefix.some((a, i) => source.argv[i] !== a) || source.argv.some((a) => TERMINAL_META_RE.test(a))) throw fail('SPEC_REJECTED', 'argv outside template or carries shell/meta syntax');
  const executablePath = resolveExecutable(source.executable);
  const cwd = fs.realpathSync(source.cwd);
  if (cwd !== path.resolve(source.cwd)) throw fail('SOURCE_PREFLIGHT_FAILED', 'cwd resolves through a symlink');
  // Git evidence: bind and re-verify the repository's CURRENT state right before execution.
  let gitState = null;
  if (String(source.template_id).startsWith('git-')) {
    const actual = gitIdentity(source.repository.root);
    if (!actual || actual.head !== source.repository.head || actual.branch !== source.repository.branch || actual.worktree_state_sha256 !== source.repository.worktree_state_sha256) throw fail('SOURCE_PREFLIGHT_FAILED', 'repository state changed since the CaptureSpec was issued');
    gitState = { id: source.repository.id, root: source.repository.root, head: actual.head, branch: actual.branch, worktree_state_sha256: actual.worktree_state_sha256, tree: actual.tree, common_dir: actual.common_dir, remote_url: actual.remote_url, dirty: actual.dirty };
  }
  const startedAt = new Date().toISOString(); const t0 = process.hrtime.bigint();
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat', TERM: 'dumb' };
  const result = childProcess.spawnSync(executablePath, source.argv, { cwd, env, shell: false, timeout: ctx.limits.terminal_timeout_ms, maxBuffer: ctx.limits.max_stdout_bytes, encoding: 'buffer', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const completedAt = new Date().toISOString(); const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (result.error) throw fail('CAPTURE_FAILED', `process did not run: ${result.error.code === 'ETIMEDOUT' ? 'timeout' : result.error.message}`);
  const stdout = result.stdout || Buffer.alloc(0); const stderr = result.stderr || Buffer.alloc(0);
  const stdoutText = stdout.toString('utf8');
  if (result.status !== 0) throw fail('CAPTURE_FAILED', `process exited ${result.status}${result.signal ? ` (${result.signal})` : ''}; non-zero exit is not evidence`);
  if (!stdoutText.includes(source.expected_nonce)) throw fail('EVIDENCE_INSUFFICIENT', 'the expected process nonce is not present in the process output; stale or wrong source');
  const receipt = {
    template_id: source.template_id, executable: source.executable, executable_path: executablePath, executable_sha256: sha256File(executablePath), argv: source.argv, cwd,
    pid: result.pid || null, exit_code: result.status, signal: result.signal || null, started_at: startedAt, completed_at: completedAt, elapsed_ms: Math.round(elapsedMs * 1000) / 1000,
    stdout_sha256: sha256Bytes(stdout), stderr_sha256: sha256Bytes(stderr), stdout_bytes: stdout.length, stderr_bytes: stderr.length, shell: false, env_keys: Object.keys(env),
  };
  const tokens = [...new Set(stdoutText.split(/\s+/).filter((t) => t.length >= 4 && t.length <= 120))];
  return {
    adapter: ADAPTER,
    snapshot: { type: 'TERMINAL', machine_id: spec.machine.id, session_id: spec.machine.session_id, observed_at: completedAt, cache_state: 'FRESH', capture_id: spec.capture_id, process_receipt: receipt, raw_stdout_sha256: receipt.stdout_sha256, git_state: gitState, hostname: os.hostname(), process_user: os.userInfo().username },
    raw: { format: 'TEXT', bytes: stdout, visible_text: stdoutText, visible_tokens: tokens.includes(source.expected_nonce) ? tokens : [...tokens, source.expected_nonce] },
    surfaces: [{ id: 'stdout', text: stdoutText }, { id: 'stderr', text: stderr.toString('utf8') }],
    evidence: { visible_text: stdoutText, exit_code: result.status, git_head: gitState ? gitState.head : null },
    required_context_boxes: [{ id: 'process-identity', kind: 'annotation', text: `${source.executable} ${source.argv.join(' ')} @ ${cwd}` }],
    operations: ['SPAWN_TEMPLATE_ARGV', 'READ_STDOUT', 'READ_STDERR'],
    source_identity_line: `${os.hostname()} · ${source.executable} ${source.argv.join(' ')} · cwd ${cwd}${gitState ? ` · ${gitState.branch}@${gitState.head.slice(0, 12)}` : ''}`,
    started_at: startedAt, completed_at: completedAt,
  };
}

module.exports = { ADAPTER, capture, resolveExecutable, canonical };
