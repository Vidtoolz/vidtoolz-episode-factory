'use strict';
// SCREEN CAPTURE V1 — PUBLIC CONTRACT (records, digests, CaptureSpec V1 authority).
//
// This module IS the contract Stage 7 executes against. Record shapes and digest
// formulas are the public `vidtoolz.capture-spec.v1` / `capture-evidence.v1` /
// `capture-failure.v1` records frozen by the independent acceptance oracle
// (codex/screen-capture-v1-acceptance-oracle-20260904, dc525e05…). The oracle is
// not imported here (it is immutable and lives outside production); the
// conformance script validates real records against it.
//
// The CaptureSpec validator fails closed: unknown fields, unknown semantics,
// free-text commands, unapproved roots and unbounded actions are rejected, and
// nothing is normalized into meaning it did not carry.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const SCHEMA = Object.freeze({
  spec: 'vidtoolz.capture-spec.v1',
  bundle: 'vidtoolz.capture-evidence.v1',
  failure: 'vidtoolz.capture-failure.v1',
  handoff: 'vidtoolz.screenCaptureAssetHandoff.v1',
  receipt: 'vidtoolz.evidence-finalization-receipt.v1',
  blocked: 'vidtoolz.capture-blocked-receipt.v1',
  qc: 'vidtoolz.capture-qc.v1',
});
const SOURCE_TYPES = Object.freeze(['BROWSER', 'TERMINAL', 'FILE_OR_CODE', 'DESKTOP_APPLICATION', 'DAVINCI_RESOLVE']);
const CAPTURE_MODES = Object.freeze(['STATIC_FRAME', 'SHORT_MOTION']);
const KNOWN_MACHINES = Object.freeze(['vidnux', 'presto']);
const PRIVACY_POLICIES = Object.freeze(['BLOCK_SECRETS_V1', 'REDACT_PERSONAL_V1']);
const RAW_FORMATS = Object.freeze(['PNG', 'MP4', 'TEXT']);
const PRESENTATION_FORMATS = Object.freeze(['PNG', 'MP4']);
const SHA_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const ID_RE = /^capture-[a-z0-9][a-z0-9-]{5,80}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._:+@=-]{1,160}$/;
const NONCE_RE = /^nonce-[a-z0-9-]{8,80}$/;
const STATE_NONCE_RE = /^state-[a-z0-9-]{8,80}$/;
// Every shell/meta construct that could change how argv is interpreted, in any shell.
const TERMINAL_META_RE = /(?:[;&|`<>'"\n\r]|\$\(|\$\{|\$[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|\*|\?|\[|\]|\^|\b(?:powershell|pwsh|cmd\.exe|bash|sh|zsh)\b)/i;
const SOURCE_ACTIONS = Object.freeze({
  BROWSER: new Set(['OBSERVE_ONLY', 'NAVIGATE_AND_WAIT', 'MOVE_FIXTURE_MARKER']),
  TERMINAL: new Set(['EXECUTE_TEMPLATE']),
  FILE_OR_CODE: new Set(['READ_RANGE']),
  DESKTOP_APPLICATION: new Set(['OBSERVE_ONLY']),
  DAVINCI_RESOLVE: new Set(['OBSERVE_ONLY']),
});
// Read-only terminal templates. argv must start with the template prefix and
// stay within maxArgs; no other executable is reachable through this class.
const TERMINAL_TEMPLATES = Object.freeze({
  'git-status': { executable: 'git', prefix: ['status', '--porcelain=v1', '--branch'], maxArgs: 3, readOnly: true },
  'git-log': { executable: 'git', prefix: ['log', '--oneline', '--decorate=no'], maxArgs: 3, readOnly: true },
  'git-diff': { executable: 'git', prefix: ['diff', '--no-ext-diff'], maxArgs: 2, readOnly: true },
  'node-version': { executable: 'node', prefix: ['--version'], maxArgs: 1, readOnly: true },
  'fixture-nonce': { executable: 'node', prefix: [], maxArgs: 2, readOnly: true, fixtureAuthorityRequired: true },
});
const FAILURE_CODES = Object.freeze([
  'SPEC_REJECTED', 'POLICY_DISABLED', 'SOURCE_PREFLIGHT_FAILED', 'SOURCE_UNAVAILABLE', 'HUMAN_BUSY', 'AUTH_REQUIRED',
  'CAPTURE_FAILED', 'PRIVACY_BLOCKED', 'INTEGRITY_FAILED', 'PRESENTATION_FAILED', 'EVIDENCE_INSUFFICIENT', 'QC_BLOCKED',
  'FINALIZATION_FAILED', 'TRUST_ANCHOR_UNAVAILABLE', 'CONCURRENCY_CONFLICT',
]);

// ── canonical JSON + digests (byte-identical to the oracle's formulas) ───────
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
function digest(value) { return sha256Bytes(canonical(value)); }
function nowIso() { return new Date().toISOString(); }
function issue(code, field, detail, severity = 'CRITICAL') { return { code, field, detail, severity }; }

function strictObject(value, allowed, required, field, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { issues.push(issue('OBJECT_REQUIRED', field, `${field} must be an object`)); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue('UNKNOWN_FIELD', `${field}.${key}`, 'unknown fields are not normalized'));
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(issue('REQUIRED_FIELD_MISSING', `${field}.${key}`, 'required field missing'));
  return true;
}
function validIso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function withinRoot(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function unsafePathText(value) {
  const text = String(value || '');
  return text.includes('\0') || /^(?:\\\\|\/[a-z]|[A-Za-z]:[\\/])/.test(text) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text) || /^(?:\/proc|\/dev|\/sys)(?:\/|$)/.test(text);
}
function lstatSafe(file) { try { return fs.lstatSync(file); } catch (_) { return null; } }

// Real Git identity of a root: HEAD, branch (or DETACHED), hash of the porcelain
// status (worktree state), tree, common dir and remote — the same query the
// oracle performs, so a stale declaration is detected at validation time.
function gitIdentity(root) {
  const git = (args) => childProcess.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const head = git(['rev-parse', 'HEAD']);
    let branch = 'DETACHED';
    try { branch = git(['symbolic-ref', '--short', 'HEAD']); } catch (_) { /* detached is explicit */ }
    const status = childProcess.execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--branch'], { encoding: 'utf8', timeout: 5000 });
    let tree = null; let commonDir = null; let remote = null;
    try { tree = git(['rev-parse', 'HEAD^{tree}']); } catch (_) {}
    try { commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir'])); } catch (_) {}
    try { remote = git(['remote', 'get-url', 'origin']); } catch (_) { remote = null; }
    return { head, branch, worktree_state_sha256: sha256Bytes(status), tree, common_dir: commonDir, remote_url: remote, dirty: status.split('\n').some((l) => l && !l.startsWith('##')) };
  } catch (_) { return null; }
}

// ── CaptureSpec V1 validation ───────────────────────────────────────────────
function validateOutputDestination(output, context, issues) {
  if (!strictObject(output, ['root_id', 'relative_dir', 'raw_name', 'presentation_name'], ['root_id', 'relative_dir', 'raw_name', 'presentation_name'], 'output', issues)) return;
  const root = context.outputRoots && context.outputRoots[output.root_id];
  if (!root) issues.push(issue('OUTPUT_ROOT_UNKNOWN', 'output.root_id', 'output root is not approved'));
  for (const key of ['relative_dir', 'raw_name', 'presentation_name']) {
    const value = String(output[key] || '');
    if (!value || unsafePathText(value) || path.isAbsolute(value)) issues.push(issue('OUTPUT_PATH_UNSAFE', `output.${key}`, 'path must be a bounded relative path'));
  }
  for (const key of ['raw_name', 'presentation_name']) if (output[key] && !SAFE_NAME_RE.test(output[key])) issues.push(issue('OUTPUT_NAME_UNSAFE', `output.${key}`, 'unsafe output filename'));
  if (output.raw_name && output.raw_name === output.presentation_name) issues.push(issue('RAW_PRESENTATION_DESTINATION_ALIAS', 'output', 'raw and presentation destinations must differ'));
  if (root && output.relative_dir && !unsafePathText(output.relative_dir)) {
    const target = path.resolve(root, output.relative_dir);
    if (target !== path.resolve(root) && !withinRoot(root, target)) issues.push(issue('OUTPUT_TRAVERSAL', 'output.relative_dir', 'destination escapes approved root'));
  }
}

function validateTerminalSource(source, context, issues) {
  const allowed = ['type', 'template_id', 'executable', 'argv', 'cwd', 'expected_nonce', 'repository'];
  strictObject(source, allowed, ['type', 'template_id', 'executable', 'argv', 'cwd', 'expected_nonce'], 'source', issues);
  const template = TERMINAL_TEMPLATES[source.template_id];
  if (!template) issues.push(issue('TERMINAL_TEMPLATE_UNKNOWN', 'source.template_id', 'terminal execution must use a read-only template'));
  if (template && source.executable !== template.executable) issues.push(issue('TERMINAL_EXECUTABLE_MISMATCH', 'source.executable', 'executable differs from template'));
  if (!Array.isArray(source.argv) || source.argv.some((arg) => typeof arg !== 'string')) issues.push(issue('TERMINAL_ARGV_REQUIRED', 'source.argv', 'structured argv is required'));
  if (Array.isArray(source.argv)) {
    if (template && (source.argv.length > template.maxArgs || template.prefix.some((arg, index) => source.argv[index] !== arg))) issues.push(issue('TERMINAL_TEMPLATE_MISMATCH', 'source.argv', 'argv is outside the template'));
    source.argv.forEach((arg, index) => { if (TERMINAL_META_RE.test(arg)) issues.push(issue('TERMINAL_META_SYNTAX', `source.argv.${index}`, 'shell/meta expansion is forbidden')); });
  }
  if (template && template.fixtureAuthorityRequired) {
    const authority = context.terminalAuthorities && context.terminalAuthorities[source.template_id];
    if (!authority || source.executable !== authority.executable || canonical(source.argv) !== canonical(authority.argv) || path.resolve(source.cwd || '') !== path.resolve(authority.cwd || '')) issues.push(issue('TERMINAL_FIXTURE_AUTHORITY_INVALID', 'source', 'fixture command must exactly match its explicit test authority'));
  }
  const cwdRoot = context.sourceRoots && context.sourceRoots.terminal;
  if (!cwdRoot || typeof source.cwd !== 'string' || source.cwd.includes('\0') || /^(?:\/proc|\/dev|\/sys)(?:\/|$)/.test(source.cwd) || !withinRoot(cwdRoot, source.cwd)) issues.push(issue('TERMINAL_CWD_UNSAFE', 'source.cwd', 'cwd must be a real approved directory'));
  if (source.cwd) { const st = lstatSafe(source.cwd); if (!st || !st.isDirectory() || st.isSymbolicLink()) issues.push(issue('TERMINAL_CWD_INVALID', 'source.cwd', 'cwd must be an existing non-symlink directory')); }
  if (!NONCE_RE.test(String(source.expected_nonce || ''))) issues.push(issue('SOURCE_NONCE_INVALID', 'source.expected_nonce', 'a unique visible nonce is required'));
  if (String(source.template_id || '').startsWith('git-')) {
    const repo = source.repository;
    if (!repo || !repo.id || !repo.root || !GIT_SHA_RE.test(String(repo.head || '')) || !repo.branch || !SHA_RE.test(String(repo.worktree_state_sha256 || ''))) issues.push(issue('GIT_EVIDENCE_IDENTITY_REQUIRED', 'source.repository', 'git evidence requires repo/root/HEAD/branch/worktree-state identity'));
    else if (path.resolve(repo.root) !== path.resolve(source.cwd)) issues.push(issue('GIT_CWD_REPOSITORY_MISMATCH', 'source.repository.root', 'git command cwd must be the declared repository'));
    else {
      const approved = context.repositories && context.repositories[repo.id];
      if (!approved || path.resolve(approved.root) !== path.resolve(repo.root)) issues.push(issue('REPOSITORY_IDENTITY_INVALID', 'source.repository', 'Git repository is not an approved identity/root'));
      const actual = gitIdentity(repo.root);
      if (!actual || actual.head !== repo.head || actual.branch !== repo.branch || actual.worktree_state_sha256 !== repo.worktree_state_sha256) issues.push(issue('GIT_REQUEST_STATE_STALE', 'source.repository', "declared Git identity is not the repository's current state"));
    }
  }
}

function validateBrowserSource(source, context, issues) {
  const allowed = ['type', 'url', 'selector', 'expected_state_nonce', 'network_zone', 'allow_redirects', 'authenticated_identity'];
  strictObject(source, allowed, ['type', 'url', 'selector', 'expected_state_nonce', 'network_zone', 'allow_redirects'], 'source', issues);
  let parsed = null;
  try { parsed = new URL(source.url); } catch (_) { issues.push(issue('BROWSER_URL_INVALID', 'source.url', 'URL must parse exactly')); }
  if (parsed) {
    if (!['http:', 'https:'].includes(parsed.protocol)) issues.push(issue('BROWSER_SCHEME_FORBIDDEN', 'source.url', 'only http/https are captureable'));
    if (parsed.username || parsed.password) issues.push(issue('BROWSER_CREDENTIALS_IN_URL', 'source.url', 'credentials may not be embedded'));
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    if (loopback) {
      const allowedPorts = context.localFixturePorts || [];
      if (source.network_zone !== 'LOCAL_FIXTURE' || !allowedPorts.includes(Number(parsed.port))) issues.push(issue('BROWSER_LOOPBACK_NOT_AUTHORIZED', 'source.url', 'loopback requires an exact fixture authority'));
      if (/\/(?:admin|debug|internal|api\/package-engine)(?:\/|$)/i.test(parsed.pathname)) issues.push(issue('BROWSER_ADMIN_ENDPOINT_FORBIDDEN', 'source.url', 'local admin/control endpoints are not capture targets'));
    } else if (source.network_zone !== 'PUBLIC_WEB') issues.push(issue('BROWSER_NETWORK_ZONE_INVALID', 'source.network_zone', 'public URLs require PUBLIC_WEB'));
  }
  const selector = String(source.selector || '');
  if (!selector || selector.length > 240 || /[{};]|javascript:|expression\s*\(/i.test(selector)) issues.push(issue('BROWSER_SELECTOR_MALFORMED', 'source.selector', 'selector is missing or unsafe'));
  if (!STATE_NONCE_RE.test(String(source.expected_state_nonce || ''))) issues.push(issue('BROWSER_STATE_NONCE_INVALID', 'source.expected_state_nonce', 'state nonce required'));
  if (!Array.isArray(source.allow_redirects) || source.allow_redirects.some((u) => typeof u !== 'string')) issues.push(issue('BROWSER_REDIRECT_POLICY_REQUIRED', 'source.allow_redirects', 'redirect policy must be explicit'));
}

function validateFileSource(source, context, issues) {
  const fields = ['type', 'repository_id', 'repository_root', 'path', 'source_sha256', 'git_head', 'git_branch', 'git_worktree_state_sha256', 'line_start', 'line_end', 'required_context_lines'];
  strictObject(source, fields, fields, 'source', issues);
  const approved = context.repositories && context.repositories[source.repository_id];
  if (!approved || path.resolve(source.repository_root || '') !== path.resolve(approved.root)) issues.push(issue('REPOSITORY_IDENTITY_INVALID', 'source.repository_id', 'repository/root is not approved'));
  if (!SHA_RE.test(String(source.source_sha256 || ''))) issues.push(issue('SOURCE_HASH_INVALID', 'source.source_sha256', 'full SHA-256 required'));
  if (!GIT_SHA_RE.test(String(source.git_head || ''))) issues.push(issue('GIT_HEAD_INVALID', 'source.git_head', 'full Git HEAD required'));
  if (!source.git_branch) issues.push(issue('GIT_BRANCH_REQUIRED', 'source.git_branch', 'branch or DETACHED required'));
  if (!SHA_RE.test(String(source.git_worktree_state_sha256 || ''))) issues.push(issue('GIT_WORKTREE_STATE_INVALID', 'source.git_worktree_state_sha256', 'full working-tree state hash required'));
  if (!Number.isInteger(source.line_start) || !Number.isInteger(source.line_end) || source.line_start < 1 || source.line_end < source.line_start || source.line_end - source.line_start > 300) issues.push(issue('FILE_RANGE_INVALID', 'source.line_start', 'line range must be bounded'));
  if (!Array.isArray(source.required_context_lines) || source.required_context_lines.some((n) => !Number.isInteger(n))) issues.push(issue('FILE_CONTEXT_REQUIRED', 'source.required_context_lines', 'protected context lines required'));
  if (approved && source.path) {
    const absolute = path.resolve(source.repository_root, source.path);
    if (unsafePathText(source.path) || !withinRoot(source.repository_root, absolute)) issues.push(issue('SOURCE_PATH_TRAVERSAL', 'source.path', 'file escapes repository'));
    const st = lstatSafe(absolute);
    if (!st || !st.isFile() || st.isSymbolicLink()) issues.push(issue('SOURCE_FILE_INVALID', 'source.path', 'source must be a regular non-symlink file'));
    const actual = gitIdentity(source.repository_root);
    if (!actual || actual.head !== source.git_head || actual.branch !== source.git_branch || actual.worktree_state_sha256 !== source.git_worktree_state_sha256) issues.push(issue('GIT_REQUEST_STATE_STALE', 'source.repository_root', 'declared Git HEAD/branch/worktree state is not current'));
  }
}

function validateDesktopSource(source, issues, resolve) {
  const base = ['type', 'application_id', 'process_executable', 'window_title', 'session_id', 'monitor_id', 'expected_state', 'allow_focus_change'];
  const extra = resolve ? ['project_id', 'timeline_id', 'playhead_frame'] : [];
  strictObject(source, [...base, ...extra], [...base, ...extra], 'source', issues);
  if (!source.application_id || source.application_id === 'unknown' || !source.process_executable || !source.window_title || !source.session_id || !source.monitor_id || !source.expected_state) issues.push(issue('APPLICATION_IDENTITY_AMBIGUOUS', 'source', 'application/window/session/state identity must be exact'));
  if (source.allow_focus_change !== false) issues.push(issue('DESKTOP_MUTATION_FORBIDDEN', 'source.allow_focus_change', 'capture may not steal focus'));
  if (resolve) {
    if (source.application_id !== 'davinci-resolve' || !/resolve/i.test(String(source.process_executable))) issues.push(issue('RESOLVE_IDENTITY_INVALID', 'source.application_id', 'exact Resolve identity required'));
    if (!source.project_id || !source.timeline_id || !Number.isInteger(source.playhead_frame) || source.playhead_frame < 0) issues.push(issue('RESOLVE_STATE_INCOMPLETE', 'source', 'project/timeline/playhead required'));
  }
}

const ROOT_FIELDS = ['schema', 'capture_id', 'requested_at', 'evidence_target', 'source', 'capture', 'machine', 'privacy', 'output', 'presentation', 'failure_policy'];
function validateCaptureSpec(spec, context = {}) {
  const issues = [];
  if (!strictObject(spec, ROOT_FIELDS, ROOT_FIELDS, 'spec', issues)) return { ok: false, issues, spec_digest_sha256: null };
  if (spec.schema !== SCHEMA.spec) issues.push(issue('CAPTURESPEC_SCHEMA_UNKNOWN', 'spec.schema', 'exact V1 schema required'));
  if (!ID_RE.test(String(spec.capture_id || ''))) issues.push(issue('CAPTURE_ID_INVALID', 'spec.capture_id', 'bounded unique capture_id required'));
  if (!validIso(spec.requested_at)) issues.push(issue('REQUEST_TIME_INVALID', 'spec.requested_at', 'ISO timestamp required'));
  strictObject(spec.evidence_target, ['claim', 'required_facts', 'forbidden_omissions'], ['claim', 'required_facts', 'forbidden_omissions'], 'evidence_target', issues);
  const target = spec.evidence_target || {};
  if (!target.claim || !Array.isArray(target.required_facts) || !target.required_facts.length || target.required_facts.some((f) => typeof f !== 'string' || !f)) issues.push(issue('EVIDENCE_TARGET_MISSING', 'evidence_target', 'claim and required facts are mandatory'));
  if (!Array.isArray(target.forbidden_omissions)) issues.push(issue('EVIDENCE_OMISSION_POLICY_MISSING', 'evidence_target.forbidden_omissions', 'context omissions must be explicit'));
  const type = spec.source && spec.source.type;
  if (!SOURCE_TYPES.includes(type)) issues.push(issue('SOURCE_TYPE_UNKNOWN', 'source.type', 'unsupported source class'));
  else if (type === 'TERMINAL') validateTerminalSource(spec.source, context, issues);
  else if (type === 'BROWSER') validateBrowserSource(spec.source, context, issues);
  else if (type === 'FILE_OR_CODE') validateFileSource(spec.source, context, issues);
  else if (type === 'DESKTOP_APPLICATION') validateDesktopSource(spec.source, issues, false);
  else if (type === 'DAVINCI_RESOLVE') validateDesktopSource(spec.source, issues, true);
  strictObject(spec.capture, ['mode', 'duration_seconds', 'fps', 'action', 'action_completed_at'], ['mode', 'duration_seconds', 'fps', 'action', 'action_completed_at'], 'capture', issues);
  const cap = spec.capture || {};
  if (!CAPTURE_MODES.includes(cap.mode)) issues.push(issue('CAPTURE_MODE_UNSUPPORTED', 'capture.mode', 'unsupported capture mode'));
  const duration = Number(cap.duration_seconds);
  if (cap.mode === 'STATIC_FRAME' && duration !== 0) issues.push(issue('STATIC_DURATION_INVALID', 'capture.duration_seconds', 'static frame duration must be zero'));
  if (cap.mode === 'SHORT_MOTION' && (!Number.isFinite(duration) || duration < 0.25 || duration > 10)) issues.push(issue('MOTION_DURATION_INVALID', 'capture.duration_seconds', 'motion must be 0.25–10 seconds'));
  if (cap.mode === 'SHORT_MOTION' && (!Number.isInteger(cap.fps) || cap.fps < 24 || cap.fps > 60)) issues.push(issue('CAPTURE_FPS_INVALID', 'capture.fps', 'motion fps must be 24–60'));
  if (!validIso(cap.action_completed_at)) issues.push(issue('ACTION_COMPLETION_TIME_REQUIRED', 'capture.action_completed_at', 'capture must follow a bounded completed action'));
  if (SOURCE_ACTIONS[type] && !SOURCE_ACTIONS[type].has(cap.action)) issues.push(issue('CAPTURE_ACTION_UNBOUNDED', 'capture.action', 'source class permits only bounded Stage 7 actions'));
  strictObject(spec.machine, ['id', 'session_id'], ['id', 'session_id'], 'machine', issues);
  if (!KNOWN_MACHINES.includes(spec.machine && spec.machine.id)) issues.push(issue('MACHINE_UNKNOWN', 'machine.id', 'unknown capture machine'));
  if (!(spec.machine && spec.machine.session_id)) issues.push(issue('MACHINE_SESSION_REQUIRED', 'machine.session_id', 'machine session identity required'));
  strictObject(spec.privacy, ['policy_id', 'allow_personal_redaction', 'secret_response'], ['policy_id', 'allow_personal_redaction', 'secret_response'], 'privacy', issues);
  if (!PRIVACY_POLICIES.includes(spec.privacy && spec.privacy.policy_id)) issues.push(issue('PRIVACY_POLICY_MISSING', 'privacy.policy_id', 'known privacy policy required'));
  if (!(spec.privacy && spec.privacy.secret_response === 'BLOCK')) issues.push(issue('SECRET_POLICY_UNSAFE', 'privacy.secret_response', 'V1 secrets must block, never be shipped or silently redacted'));
  validateOutputDestination(spec.output || {}, context, issues);
  strictObject(spec.presentation, ['width', 'height', 'safe_area', 'minimum_text_px', 'max_zoom', 'retain_context'], ['width', 'height', 'safe_area', 'minimum_text_px', 'max_zoom', 'retain_context'], 'presentation', issues);
  const pres = spec.presentation || {};
  if (pres.width !== 1080 || pres.height !== 1920) issues.push(issue('PRESENTATION_GEOMETRY_INVALID', 'presentation', 'production presentation must be 1080x1920'));
  if (!pres.safe_area || pres.safe_area.left < 72 || pres.safe_area.right < 72 || pres.safe_area.top < 96 || pres.safe_area.bottom < 144) issues.push(issue('SAFE_AREA_INVALID', 'presentation.safe_area', 'mobile safe area is insufficient'));
  if (!(pres.minimum_text_px >= 32)) issues.push(issue('TEXT_MINIMUM_UNREADABLE', 'presentation.minimum_text_px', 'minimum text must be at least 32px'));
  if (!(pres.max_zoom >= 1 && pres.max_zoom <= 4) || pres.retain_context !== true) issues.push(issue('PRESENTATION_CONTEXT_POLICY_INVALID', 'presentation', 'bounded zoom and context retention required'));
  strictObject(spec.failure_policy, ['on_capture_failure', 'allow_representation_fallback', 'human_escalation'], ['on_capture_failure', 'allow_representation_fallback', 'human_escalation'], 'failure_policy', issues);
  const fp = spec.failure_policy || {};
  if (fp.on_capture_failure !== 'FAIL_AND_REPLAN' || fp.allow_representation_fallback !== false || !['VISUAL_DIRECTOR', 'HUMAN'].includes(fp.human_escalation)) issues.push(issue('HIDDEN_FALLBACK_FORBIDDEN', 'failure_policy', 'failure must replan/escalate without substitution'));
  return { ok: issues.length === 0, issues, spec_digest_sha256: issues.length ? null : digest(spec) };
}

// ── record digests (must equal the oracle's) ────────────────────────────────
function provenanceManifestDigest(provenance) { const copy = { ...provenance }; delete copy.manifest_digest_sha256; return digest(copy); }
function qcBundleDigest(bundle) {
  return digest({ capture_id: bundle.capture_id, spec_digest_sha256: bundle.spec_digest_sha256, source_snapshot: bundle.source_snapshot, raw_sha256: bundle.raw.sha256, presentation_sha256: bundle.presentation.sha256, intent: bundle.intent, privacy: bundle.privacy });
}
function evidenceDigest(bundle) {
  return digest({ spec: bundle.spec_digest_sha256, raw: bundle.raw.sha256, presentation: bundle.presentation.sha256, provenance: bundle.provenance.manifest_digest_sha256, qc: bundle.qc.bundle_digest_sha256 });
}

// Typed failure record (oracle `vidtoolz.capture-failure.v1`). Never carries artifacts.
function failureRecord(spec, specDigest, code, failedStage, detail, extra = {}) {
  if (!FAILURE_CODES.includes(code)) throw new Error(`unknown failure code ${code}`);
  return {
    schema: SCHEMA.failure, capture_id: spec.capture_id, spec_digest_sha256: specDigest, state: 'CAPTURE_FAILED', code, failed_stage: failedStage,
    detail: String(detail || code).slice(0, 2000), fallback_created: false, replan_required: true,
    human_escalation: (spec.failure_policy && spec.failure_policy.human_escalation) || 'VISUAL_DIRECTOR', artifacts: [],
    ...extra,
  };
}

// Concurrency: the same lock policy the oracle encodes.
function concurrencyDecision(requests) {
  const locks = new Set(); const outputs = new Set(); const conflicts = [];
  for (const req of requests) {
    let lock;
    if (req.source.type === 'DAVINCI_RESOLVE') lock = `resolve:${req.machine.session_id}`;
    else if (req.source.type === 'DESKTOP_APPLICATION') lock = `desktop:${req.machine.session_id}:${req.source.application_id}`;
    else if (req.source.type === 'BROWSER') lock = `browser:${req.capture_id}`;
    else if (req.source.type === 'TERMINAL') lock = `terminal:${req.capture_id}`;
    else lock = `file:${req.capture_id}`;
    if (locks.has(lock)) conflicts.push(lock); else locks.add(lock);
    const key = `${req.output && req.output.root_id}:${req.output && req.output.relative_dir}:${req.output && req.output.raw_name}:${req.output && req.output.presentation_name}`;
    if (outputs.has(key)) conflicts.push(`output:${key}`); else outputs.add(key);
  }
  return { safe: conflicts.length === 0, conflicts, policy: conflicts.length ? 'SERIALIZE' : 'PARALLEL_ISOLATED' };
}

// Evidence-fact grammar. Facts are machine-checkable claims about the raw
// transcript/snapshot; unknown grammar is never guessed (fail closed).
//   visible:<token>       token appears in raw visible text
//   exit-code:<n>         terminal process exit code
//   git-head:<sha40>      snapshot git head equals
//   final-url:<url>       browser final URL equals
//   line-range:<a>-<b>    file capture range equals
//   selector-visible      browser target selector was visible
function evaluateFact(fact, evidence) {
  const m = /^([a-z-]+):(.*)$/.exec(fact);
  if (!m) return fact === 'selector-visible' ? Boolean(evidence.selector_visible) : null;
  const [, kind, value] = m;
  switch (kind) {
    case 'visible': return typeof evidence.visible_text === 'string' && value.length > 0 && evidence.visible_text.includes(value);
    case 'exit-code': return Number(value) === evidence.exit_code;
    case 'git-head': return evidence.git_head === value;
    case 'final-url': return evidence.final_url === value;
    case 'line-range': { const r = /^(\d+)-(\d+)$/.exec(value); return Boolean(r) && Number(r[1]) === evidence.line_start && Number(r[2]) === evidence.line_end; }
    default: return null; // unknown grammar → not provable
  }
}

module.exports = {
  SCHEMA, SOURCE_TYPES, CAPTURE_MODES, KNOWN_MACHINES, PRIVACY_POLICIES, RAW_FORMATS, PRESENTATION_FORMATS, TERMINAL_TEMPLATES, SOURCE_ACTIONS, FAILURE_CODES,
  SHA_RE, GIT_SHA_RE, ID_RE, SAFE_NAME_RE, NONCE_RE, STATE_NONCE_RE, TERMINAL_META_RE,
  canonical, sha256Bytes, sha256File, digest, nowIso, issue, strictObject, validIso, withinRoot, unsafePathText, lstatSafe, gitIdentity,
  validateCaptureSpec, provenanceManifestDigest, qcBundleDigest, evidenceDigest, failureRecord, concurrencyDecision, evaluateFact,
};
