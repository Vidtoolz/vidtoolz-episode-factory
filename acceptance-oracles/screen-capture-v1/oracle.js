"use strict";

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_TYPES = Object.freeze(["BROWSER", "TERMINAL", "FILE_OR_CODE", "DESKTOP_APPLICATION", "DAVINCI_RESOLVE"]);
const CAPTURE_MODES = Object.freeze(["STATIC_FRAME", "SHORT_MOTION"]);
const KNOWN_MACHINES = Object.freeze(["vidnux", "presto"]);
const PRIVACY_POLICIES = Object.freeze(["BLOCK_SECRETS_V1", "REDACT_PERSONAL_V1"]);
const RAW_FORMATS = Object.freeze(["PNG", "MP4", "TEXT"]);
const PRESENTATION_FORMATS = Object.freeze(["PNG", "MP4"]);
const SHA_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^capture-[a-z0-9][a-z0-9-]{5,80}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._:+@=-]{1,160}$/;
const TERMINAL_META_RE = /(?:[;&|`<>'"\n\r]|\$\(|\$\{|\$[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|\*|\?|\[|\]|\^|\b(?:powershell|pwsh|cmd\.exe|bash|sh|zsh)\b)/i;
const SOURCE_ACTIONS = Object.freeze({
  BROWSER: new Set(["OBSERVE_ONLY", "NAVIGATE_AND_WAIT", "MOVE_FIXTURE_MARKER"]),
  TERMINAL: new Set(["EXECUTE_TEMPLATE"]),
  FILE_OR_CODE: new Set(["READ_RANGE"]),
  DESKTOP_APPLICATION: new Set(["OBSERVE_ONLY"]),
  DAVINCI_RESOLVE: new Set(["OBSERVE_ONLY"]),
});
const SECRET_PATTERNS = Object.freeze([
  { type: "OPENAI_API_KEY", re: /\bsk-(?:test-)?[A-Za-z0-9_-]{8,}\b/g },
  { type: "AWS_SECRET_ACCESS_KEY", re: /\bAWS_SECRET_ACCESS_KEY\s*=\s*[^\s]+/gi },
  { type: "PRIVATE_TOKEN", re: /\bPRIVATE_TOKEN\s*=\s*[^\s]+/gi },
  { type: "PASSWORD", re: /\b(?:PASSWORD|PASSWD)\s*=\s*[^\s]+/gi },
  { type: "PRIVATE_KEY", re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g },
]);

const TERMINAL_TEMPLATES = Object.freeze({
  "git-status": { executable: "git", prefix: ["status", "--porcelain=v1", "--branch"], maxArgs: 3, readOnly: true },
  "git-log": { executable: "git", prefix: ["log", "--oneline", "--decorate=no"], maxArgs: 3, readOnly: true },
  "git-diff": { executable: "git", prefix: ["diff", "--no-ext-diff"], maxArgs: 2, readOnly: true },
  "node-version": { executable: "node", prefix: ["--version"], maxArgs: 1, readOnly: true },
  "fixture-nonce": { executable: "node", prefix: [], maxArgs: 2, readOnly: true, fixtureAuthorityRequired: true },
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function sha256Bytes(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function sha256File(file) { return sha256Bytes(fs.readFileSync(file)); }
function digest(value) { return sha256Bytes(canonical(value)); }
function issue(code, field, detail, severity = "CRITICAL") { return { code, field, detail, severity }; }
function fail(code, field, detail, severity) { return { ok: false, issues: [issue(code, field, detail, severity)] }; }
function strictObject(value, allowed, required, field, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("OBJECT_REQUIRED", field, `${field} must be an object`)); return false;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue("UNKNOWN_FIELD", `${field}.${key}`, "unknown fields are not normalized"));
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(issue("REQUIRED_FIELD_MISSING", `${field}.${key}`, "required field missing"));
  return true;
}
function validIso(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function withinRoot(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const rel = path.relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function unsafePathText(value) {
  const text = String(value || "");
  return text.includes("\0") || /^(?:\\\\|\/[a-z]|[A-Za-z]:[\\/])/.test(text) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text)
    || /^(?:\/proc|\/dev|\/sys)(?:\/|$)/.test(text);
}
function lstatSafe(file) { try { return fs.lstatSync(file); } catch (_) { return null; } }
function gitIdentity(root) {
  try {
    const head = childProcess.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
    let branch = "DETACHED";
    try { branch = childProcess.execFileSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (_) { /* explicit detached state */ }
    const status = childProcess.execFileSync("git", ["-C", root, "status", "--porcelain=v1", "--branch"], { encoding: "utf8", timeout: 5000 });
    return { head, branch, worktree_state_sha256: sha256Bytes(status) };
  } catch (_) { return null; }
}

function validateOutputDestination(output, context, issues) {
  if (!strictObject(output, ["root_id", "relative_dir", "raw_name", "presentation_name"], ["root_id", "relative_dir", "raw_name", "presentation_name"], "output", issues)) return;
  const root = context.outputRoots && context.outputRoots[output.root_id];
  if (!root) issues.push(issue("OUTPUT_ROOT_UNKNOWN", "output.root_id", "output root is not approved"));
  for (const key of ["relative_dir", "raw_name", "presentation_name"]) {
    const value = String(output[key] || "");
    if (!value || unsafePathText(value) || path.isAbsolute(value)) issues.push(issue("OUTPUT_PATH_UNSAFE", `output.${key}`, "path must be a bounded relative path"));
  }
  for (const key of ["raw_name", "presentation_name"]) if (output[key] && !SAFE_NAME_RE.test(output[key])) issues.push(issue("OUTPUT_NAME_UNSAFE", `output.${key}`, "unsafe output filename"));
  if (root && output.relative_dir && !unsafePathText(output.relative_dir)) {
    const target = path.resolve(root, output.relative_dir);
    if (target !== path.resolve(root) && !withinRoot(root, target)) issues.push(issue("OUTPUT_TRAVERSAL", "output.relative_dir", "destination escapes approved root"));
  }
}

function validateTerminalSource(source, context, issues) {
  const allowed = ["type", "template_id", "executable", "argv", "cwd", "expected_nonce", "repository"];
  strictObject(source, allowed, ["type", "template_id", "executable", "argv", "cwd", "expected_nonce"], "source", issues);
  const template = TERMINAL_TEMPLATES[source.template_id];
  if (!template) issues.push(issue("TERMINAL_TEMPLATE_UNKNOWN", "source.template_id", "terminal execution must use a read-only template"));
  if (template && source.executable !== template.executable) issues.push(issue("TERMINAL_EXECUTABLE_MISMATCH", "source.executable", "executable differs from template"));
  if (!Array.isArray(source.argv) || source.argv.some((arg) => typeof arg !== "string")) issues.push(issue("TERMINAL_ARGV_REQUIRED", "source.argv", "structured argv is required"));
  if (Array.isArray(source.argv)) {
    if (template && (source.argv.length > template.maxArgs || template.prefix.some((arg, index) => source.argv[index] !== arg))) issues.push(issue("TERMINAL_TEMPLATE_MISMATCH", "source.argv", "argv is outside the template"));
    source.argv.forEach((arg, index) => { if (TERMINAL_META_RE.test(arg)) issues.push(issue("TERMINAL_META_SYNTAX", `source.argv.${index}`, "shell/meta expansion is forbidden")); });
  }
  if (template?.fixtureAuthorityRequired) {
    const authority = context.terminalAuthorities && context.terminalAuthorities[source.template_id];
    if (!authority || source.executable !== authority.executable || canonical(source.argv) !== canonical(authority.argv) || path.resolve(source.cwd || "") !== path.resolve(authority.cwd || "")) issues.push(issue("TERMINAL_FIXTURE_AUTHORITY_INVALID", "source", "fixture command must exactly match its explicit test authority"));
  }
  const cwdRoot = context.sourceRoots && context.sourceRoots.terminal;
  if (!cwdRoot || typeof source.cwd !== "string" || source.cwd.includes("\0") || /^(?:\/proc|\/dev|\/sys)(?:\/|$)/.test(source.cwd) || !withinRoot(cwdRoot, source.cwd)) issues.push(issue("TERMINAL_CWD_UNSAFE", "source.cwd", "cwd must be a real approved directory"));
  if (source.cwd) {
    const st = lstatSafe(source.cwd);
    if (!st || !st.isDirectory() || st.isSymbolicLink()) issues.push(issue("TERMINAL_CWD_INVALID", "source.cwd", "cwd must be an existing non-symlink directory"));
  }
  if (!/^nonce-[a-z0-9-]{8,80}$/.test(String(source.expected_nonce || ""))) issues.push(issue("SOURCE_NONCE_INVALID", "source.expected_nonce", "a unique visible nonce is required"));
  if (String(source.template_id || "").startsWith("git-")) {
    if (!source.repository || !source.repository.id || !source.repository.root || !/^[a-f0-9]{40}$/.test(String(source.repository.head || "")) || !source.repository.branch || !SHA_RE.test(String(source.repository.worktree_state_sha256 || ""))) {
      issues.push(issue("GIT_EVIDENCE_IDENTITY_REQUIRED", "source.repository", "git evidence requires repo/root/HEAD/branch/worktree-state identity"));
    } else if (path.resolve(source.repository.root) !== path.resolve(source.cwd)) {
      issues.push(issue("GIT_CWD_REPOSITORY_MISMATCH", "source.repository.root", "git command cwd must be the declared repository"));
    } else {
      const approved = context.repositories && context.repositories[source.repository.id];
      if (!approved || path.resolve(approved.root) !== path.resolve(source.repository.root)) issues.push(issue("REPOSITORY_IDENTITY_INVALID", "source.repository", "Git repository is not an approved identity/root"));
      const actual = gitIdentity(source.repository.root);
      if (!actual || actual.head !== source.repository.head || actual.branch !== source.repository.branch || actual.worktree_state_sha256 !== source.repository.worktree_state_sha256) issues.push(issue("GIT_REQUEST_STATE_STALE", "source.repository", "declared Git identity is not the repository's current state"));
    }
  }
}

function validateBrowserSource(source, context, issues) {
  const allowed = ["type", "url", "selector", "expected_state_nonce", "network_zone", "allow_redirects", "authenticated_identity"];
  strictObject(source, allowed, ["type", "url", "selector", "expected_state_nonce", "network_zone", "allow_redirects"], "source", issues);
  let parsed;
  try { parsed = new URL(source.url); } catch (_) { issues.push(issue("BROWSER_URL_INVALID", "source.url", "URL must parse exactly")); }
  if (parsed) {
    if (!["http:", "https:"].includes(parsed.protocol)) issues.push(issue("BROWSER_SCHEME_FORBIDDEN", "source.url", "only http/https are captureable"));
    if (parsed.username || parsed.password) issues.push(issue("BROWSER_CREDENTIALS_IN_URL", "source.url", "credentials may not be embedded"));
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (loopback) {
      const allowedPorts = context.localFixturePorts || [];
      if (source.network_zone !== "LOCAL_FIXTURE" || !allowedPorts.includes(Number(parsed.port))) issues.push(issue("BROWSER_LOOPBACK_NOT_AUTHORIZED", "source.url", "loopback requires an exact fixture authority"));
      if (/\/(?:admin|debug|internal|api\/package-engine)(?:\/|$)/i.test(parsed.pathname)) issues.push(issue("BROWSER_ADMIN_ENDPOINT_FORBIDDEN", "source.url", "local admin/control endpoints are not capture targets"));
    } else if (source.network_zone !== "PUBLIC_WEB") issues.push(issue("BROWSER_NETWORK_ZONE_INVALID", "source.network_zone", "public URLs require PUBLIC_WEB"));
  }
  const selector = String(source.selector || "");
  if (!selector || selector.length > 240 || /[{};]|javascript:|expression\s*\(/i.test(selector)) issues.push(issue("BROWSER_SELECTOR_MALFORMED", "source.selector", "selector is missing or unsafe"));
  if (!/^state-[a-z0-9-]{8,80}$/.test(String(source.expected_state_nonce || ""))) issues.push(issue("BROWSER_STATE_NONCE_INVALID", "source.expected_state_nonce", "state nonce required"));
  if (!Array.isArray(source.allow_redirects)) issues.push(issue("BROWSER_REDIRECT_POLICY_REQUIRED", "source.allow_redirects", "redirect policy must be explicit"));
}

function validateFileSource(source, context, issues) {
  const allowed = ["type", "repository_id", "repository_root", "path", "source_sha256", "git_head", "git_branch", "git_worktree_state_sha256", "line_start", "line_end", "required_context_lines"];
  strictObject(source, allowed, ["type", "repository_id", "repository_root", "path", "source_sha256", "git_head", "git_branch", "git_worktree_state_sha256", "line_start", "line_end", "required_context_lines"], "source", issues);
  const approved = context.repositories && context.repositories[source.repository_id];
  if (!approved || path.resolve(source.repository_root || "") !== path.resolve(approved.root)) issues.push(issue("REPOSITORY_IDENTITY_INVALID", "source.repository_id", "repository/root is not approved"));
  if (!SHA_RE.test(String(source.source_sha256 || ""))) issues.push(issue("SOURCE_HASH_INVALID", "source.source_sha256", "full SHA-256 required"));
  if (!/^[a-f0-9]{40}$/.test(String(source.git_head || ""))) issues.push(issue("GIT_HEAD_INVALID", "source.git_head", "full Git HEAD required"));
  if (!source.git_branch) issues.push(issue("GIT_BRANCH_REQUIRED", "source.git_branch", "branch or DETACHED required"));
  if (!SHA_RE.test(String(source.git_worktree_state_sha256 || ""))) issues.push(issue("GIT_WORKTREE_STATE_INVALID", "source.git_worktree_state_sha256", "full working-tree state hash required"));
  if (!Number.isInteger(source.line_start) || !Number.isInteger(source.line_end) || source.line_start < 1 || source.line_end < source.line_start || source.line_end - source.line_start > 300) issues.push(issue("FILE_RANGE_INVALID", "source.line_start", "line range must be bounded"));
  if (!Array.isArray(source.required_context_lines) || source.required_context_lines.some((n) => !Number.isInteger(n))) issues.push(issue("FILE_CONTEXT_REQUIRED", "source.required_context_lines", "protected context lines required"));
  if (approved && source.path) {
    const absolute = path.resolve(source.repository_root, source.path);
    if (unsafePathText(source.path) || !withinRoot(source.repository_root, absolute)) issues.push(issue("SOURCE_PATH_TRAVERSAL", "source.path", "file escapes repository"));
    const st = lstatSafe(absolute);
    if (!st || !st.isFile() || st.isSymbolicLink()) issues.push(issue("SOURCE_FILE_INVALID", "source.path", "source must be a regular non-symlink file"));
    const actualGit = gitIdentity(source.repository_root);
    if (!actualGit || actualGit.head !== source.git_head || actualGit.branch !== source.git_branch || actualGit.worktree_state_sha256 !== source.git_worktree_state_sha256) issues.push(issue("GIT_REQUEST_STATE_STALE", "source.repository_root", "declared Git HEAD/branch/worktree state is not current"));
  }
}

function validateDesktopSource(source, issues, resolve = false) {
  const base = ["type", "application_id", "process_executable", "window_title", "session_id", "monitor_id", "expected_state", "allow_focus_change"];
  const extra = resolve ? ["project_id", "timeline_id", "playhead_frame"] : [];
  strictObject(source, [...base, ...extra], [...base, ...extra], "source", issues);
  if (!source.application_id || source.application_id === "unknown" || !source.process_executable || !source.window_title || !source.session_id || !source.monitor_id || !source.expected_state) issues.push(issue("APPLICATION_IDENTITY_AMBIGUOUS", "source", "application/window/session/state identity must be exact"));
  if (source.allow_focus_change !== false) issues.push(issue("DESKTOP_MUTATION_FORBIDDEN", "source.allow_focus_change", "capture may not steal focus"));
  if (resolve) {
    if (source.application_id !== "davinci-resolve" || !/resolve/i.test(source.process_executable)) issues.push(issue("RESOLVE_IDENTITY_INVALID", "source.application_id", "exact Resolve identity required"));
    if (!source.project_id || !source.timeline_id || !Number.isInteger(source.playhead_frame) || source.playhead_frame < 0) issues.push(issue("RESOLVE_STATE_INCOMPLETE", "source", "project/timeline/playhead required"));
  }
}

function validateCaptureSpec(spec, context = {}) {
  const issues = [];
  const rootFields = ["schema", "capture_id", "requested_at", "evidence_target", "source", "capture", "machine", "privacy", "output", "presentation", "failure_policy"];
  if (!strictObject(spec, rootFields, rootFields, "spec", issues)) return { ok: false, issues };
  if (spec.schema !== "vidtoolz.capture-spec.v1") issues.push(issue("CAPTURESPEC_SCHEMA_UNKNOWN", "spec.schema", "exact V1 schema required"));
  if (!ID_RE.test(String(spec.capture_id || ""))) issues.push(issue("CAPTURE_ID_INVALID", "spec.capture_id", "bounded unique capture_id required"));
  if (!validIso(spec.requested_at)) issues.push(issue("REQUEST_TIME_INVALID", "spec.requested_at", "ISO timestamp required"));
  strictObject(spec.evidence_target, ["claim", "required_facts", "forbidden_omissions"], ["claim", "required_facts", "forbidden_omissions"], "evidence_target", issues);
  if (!spec.evidence_target?.claim || !Array.isArray(spec.evidence_target?.required_facts) || !spec.evidence_target.required_facts.length) issues.push(issue("EVIDENCE_TARGET_MISSING", "evidence_target", "claim and required facts are mandatory"));
  if (!Array.isArray(spec.evidence_target?.forbidden_omissions)) issues.push(issue("EVIDENCE_OMISSION_POLICY_MISSING", "evidence_target.forbidden_omissions", "context omissions must be explicit"));
  const type = spec.source && spec.source.type;
  if (!SOURCE_TYPES.includes(type)) issues.push(issue("SOURCE_TYPE_UNKNOWN", "source.type", "unsupported source class"));
  else if (type === "TERMINAL") validateTerminalSource(spec.source, context, issues);
  else if (type === "BROWSER") validateBrowserSource(spec.source, context, issues);
  else if (type === "FILE_OR_CODE") validateFileSource(spec.source, context, issues);
  else if (type === "DESKTOP_APPLICATION") validateDesktopSource(spec.source, issues, false);
  else if (type === "DAVINCI_RESOLVE") validateDesktopSource(spec.source, issues, true);
  strictObject(spec.capture, ["mode", "duration_seconds", "fps", "action", "action_completed_at"], ["mode", "duration_seconds", "fps", "action", "action_completed_at"], "capture", issues);
  if (!CAPTURE_MODES.includes(spec.capture?.mode)) issues.push(issue("CAPTURE_MODE_UNSUPPORTED", "capture.mode", "unsupported capture mode"));
  const duration = Number(spec.capture?.duration_seconds);
  if (spec.capture?.mode === "STATIC_FRAME" && duration !== 0) issues.push(issue("STATIC_DURATION_INVALID", "capture.duration_seconds", "static frame duration must be zero"));
  if (spec.capture?.mode === "SHORT_MOTION" && (!Number.isFinite(duration) || duration < 0.25 || duration > 10)) issues.push(issue("MOTION_DURATION_INVALID", "capture.duration_seconds", "motion must be 0.25–10 seconds"));
  if (spec.capture?.mode === "SHORT_MOTION" && (!Number.isInteger(spec.capture.fps) || spec.capture.fps < 24 || spec.capture.fps > 60)) issues.push(issue("CAPTURE_FPS_INVALID", "capture.fps", "motion fps must be 24–60"));
  if (!validIso(spec.capture?.action_completed_at)) issues.push(issue("ACTION_COMPLETION_TIME_REQUIRED", "capture.action_completed_at", "capture must follow a bounded completed action"));
  if (SOURCE_ACTIONS[type] && !SOURCE_ACTIONS[type].has(spec.capture?.action)) issues.push(issue("CAPTURE_ACTION_UNBOUNDED", "capture.action", "source class permits only bounded Stage 7 actions"));
  strictObject(spec.machine, ["id", "session_id"], ["id", "session_id"], "machine", issues);
  if (!KNOWN_MACHINES.includes(spec.machine?.id)) issues.push(issue("MACHINE_UNKNOWN", "machine.id", "unknown capture machine"));
  if (!spec.machine?.session_id) issues.push(issue("MACHINE_SESSION_REQUIRED", "machine.session_id", "machine session identity required"));
  strictObject(spec.privacy, ["policy_id", "allow_personal_redaction", "secret_response"], ["policy_id", "allow_personal_redaction", "secret_response"], "privacy", issues);
  if (!PRIVACY_POLICIES.includes(spec.privacy?.policy_id)) issues.push(issue("PRIVACY_POLICY_MISSING", "privacy.policy_id", "known privacy policy required"));
  if (spec.privacy?.secret_response !== "BLOCK") issues.push(issue("SECRET_POLICY_UNSAFE", "privacy.secret_response", "V1 secrets must block, never be shipped or silently redacted"));
  validateOutputDestination(spec.output || {}, context, issues);
  strictObject(spec.presentation, ["width", "height", "safe_area", "minimum_text_px", "max_zoom", "retain_context"], ["width", "height", "safe_area", "minimum_text_px", "max_zoom", "retain_context"], "presentation", issues);
  if (spec.presentation?.width !== 1080 || spec.presentation?.height !== 1920) issues.push(issue("PRESENTATION_GEOMETRY_INVALID", "presentation", "production presentation must be 1080x1920"));
  if (!spec.presentation?.safe_area || spec.presentation.safe_area.left < 72 || spec.presentation.safe_area.right < 72 || spec.presentation.safe_area.top < 96 || spec.presentation.safe_area.bottom < 144) issues.push(issue("SAFE_AREA_INVALID", "presentation.safe_area", "mobile safe area is insufficient"));
  if (spec.presentation?.minimum_text_px < 32) issues.push(issue("TEXT_MINIMUM_UNREADABLE", "presentation.minimum_text_px", "minimum text must be at least 32px"));
  if (!(spec.presentation?.max_zoom >= 1 && spec.presentation.max_zoom <= 4) || spec.presentation?.retain_context !== true) issues.push(issue("PRESENTATION_CONTEXT_POLICY_INVALID", "presentation", "bounded zoom and context retention required"));
  strictObject(spec.failure_policy, ["on_capture_failure", "allow_representation_fallback", "human_escalation"], ["on_capture_failure", "allow_representation_fallback", "human_escalation"], "failure_policy", issues);
  if (spec.failure_policy?.on_capture_failure !== "FAIL_AND_REPLAN" || spec.failure_policy?.allow_representation_fallback !== false) issues.push(issue("HIDDEN_FALLBACK_FORBIDDEN", "failure_policy", "failure must replan/escalate without substitution"));
  return { ok: issues.length === 0, issues, spec_digest_sha256: issues.length ? null : digest(spec) };
}

function scanSecrets(text) {
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const match of String(text || "").matchAll(pattern.re)) findings.push({ type: pattern.type, offset: match.index, length: match[0].length });
  }
  return findings;
}

function parsePng(file) {
  const bytes = fs.readFileSync(file);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(sig)) throw new Error("PNG_SIGNATURE_INVALID");
  let at = 8; let width = null; let height = null; let hasIend = false;
  while (at + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(at); const type = bytes.subarray(at + 4, at + 8).toString("ascii");
    if (at + 12 + len > bytes.length) throw new Error("PNG_TRUNCATED");
    const storedCrc = bytes.readUInt32BE(at + 8 + len);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(at + 4, at + 8 + len)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    if (((crc ^ 0xffffffff) >>> 0) !== storedCrc) throw new Error("PNG_CRC_INVALID");
    if (type === "IHDR") { width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12); }
    if (type === "IEND") { hasIend = true; break; }
    at += 12 + len;
  }
  if (!width || !height || !hasIend) throw new Error("PNG_STRUCTURE_INVALID");
  return { width, height, bytes: bytes.length };
}

function validateArtifact(record, expectedFormats, issues, field) {
  if (!record || typeof record !== "object") { issues.push(issue("ARTIFACT_RECORD_MISSING", field, "artifact record required")); return null; }
  const allowed = ["path", "sha256", "bytes", "format", "width", "height", "duration_seconds", "fps", "codec", "frame_count", "visible_text", "visible_tokens", "black_frame_ratio", "frozen_frame_ratio", "action_start_seconds", "action_end_seconds", "transformations", "layout"];
  strictObject(record, allowed, ["path", "sha256", "bytes", "format"], field, issues);
  if (!expectedFormats.includes(record.format)) issues.push(issue("ARTIFACT_FORMAT_UNEXPECTED", `${field}.format`, "unexpected artifact format"));
  const st = lstatSafe(record.path);
  if (!st || !st.isFile() || st.isSymbolicLink()) { issues.push(issue("ARTIFACT_FILE_INVALID", `${field}.path`, "regular file required")); return null; }
  if (st.size <= 0 || st.size !== record.bytes) issues.push(issue("ARTIFACT_SIZE_MISMATCH", `${field}.bytes`, "zero/truncated/changed artifact"));
  if (!SHA_RE.test(String(record.sha256 || "")) || sha256File(record.path) !== record.sha256) issues.push(issue("ARTIFACT_HASH_MISMATCH", `${field}.sha256`, "artifact bytes do not match manifest"));
  if (record.format === "PNG") {
    try {
      const parsed = parsePng(record.path);
      if (parsed.width !== record.width || parsed.height !== record.height) issues.push(issue("PNG_DIMENSION_MISMATCH", field, "PNG dimensions differ from manifest"));
    } catch (error) { issues.push(issue(error.message, field, "malformed or truncated PNG")); }
  }
  if (record.format === "MP4") {
    if (!record.codec || !["h264", "hevc", "vp9"].includes(record.codec) || !(record.duration_seconds > 0) || !(record.fps >= 24 && record.fps <= 60) || !(record.frame_count > 0)) issues.push(issue("MP4_TECHNICAL_INVALID", field, "codec/duration/fps/frame count invalid"));
    try {
      const probe = JSON.parse(childProcess.execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate,nb_read_frames,duration:format=duration", "-of", "json", record.path], { encoding: "utf8", timeout: 15000 }));
      const stream = probe.streams && probe.streams[0]; const rate = String(stream?.avg_frame_rate || "0/1").split("/").map(Number);
      const fps = rate[1] ? rate[0] / rate[1] : 0; const duration = Number(stream?.duration ?? probe.format?.duration); const frames = Number(stream?.nb_read_frames);
      if (!stream || stream.codec_name !== record.codec || stream.width !== record.width || stream.height !== record.height || Math.abs(fps - record.fps) > 0.01 || Math.abs(duration - record.duration_seconds) > 0.15 || frames !== record.frame_count) issues.push(issue("MP4_PROBE_MISMATCH", field, "ffprobe differs from declared media identity"));
    } catch (_) { issues.push(issue("MP4_UNDECODABLE", field, "ffprobe could not decode capture")); }
  }
  return st;
}

function validateTransformations(spec, bundle, issues) {
  const transforms = bundle.presentation.transformations;
  if (!Array.isArray(transforms)) { issues.push(issue("TRANSFORM_MANIFEST_MISSING", "presentation.transformations", "presentation operations must be declared")); return; }
  const forbidden = new Set(["RETYPE", "REDRAW", "GENERATIVE_FILL", "CONTENT_REPLACE"]);
  const requiredBoxes = bundle.intent.required_context_boxes || [];
  for (const [index, op] of transforms.entries()) {
    if (!op || typeof op !== "object" || !op.type) { issues.push(issue("TRANSFORM_INVALID", `transformations.${index}`, "typed transform required")); continue; }
    if (forbidden.has(op.type)) issues.push(issue("SEMANTIC_TRANSFORM_FORBIDDEN", `transformations.${index}`, "source pixels may not be re-created"));
    if (op.type === "ZOOM" && (!(op.scale >= 1) || op.scale > spec.presentation.max_zoom)) issues.push(issue("ZOOM_UNBOUNDED", `transformations.${index}`, "zoom exceeds declared maximum"));
    if (op.type === "CROP" || op.type === "ZOOM") {
      const retained = new Set(op.retained_context_ids || []);
      for (const box of requiredBoxes) if (!retained.has(box.id)) issues.push(issue("CONTRADICTORY_CONTEXT_REMOVED", `transformations.${index}`, `required context ${box.id} was removed`));
    }
    if (["CALLOUT", "HIGHLIGHT"].includes(op.type)) {
      const covered = new Set(op.covers_context_ids || []);
      for (const box of requiredBoxes) if (covered.has(box.id)) issues.push(issue("ANNOTATION_OBSCURES_EVIDENCE", `transformations.${index}`, `annotation covers ${box.id}`));
    }
    if (["BLUR", "REDACTION"].includes(op.type) && (!op.reason || !Array.isArray(op.region_ids) || !op.region_ids.length)) issues.push(issue("REDACTION_UNTRACEABLE", `transformations.${index}`, "redaction needs exact regions and reason"));
  }
}

function validateAppState(spec, bundle, issues) {
  const state = bundle.source_snapshot.application_state || {};
  if (state.session_id !== spec.machine.session_id || state.window_title !== spec.source.window_title || state.application_id !== spec.source.application_id) issues.push(issue("APPLICATION_STATE_MISMATCH", "source_snapshot.application_state", "wrong application/window/session"));
  if (!state.visible || state.minimized || state.obscured_ratio > 0.02) issues.push(issue("APPLICATION_NOT_VISIBLE", "source_snapshot.application_state", "window is minimized or obscured"));
  if (!state.ready || state.modal_present || state.focused_window_id !== state.window_id) issues.push(issue("APPLICATION_NOT_READY", "source_snapshot.application_state", "ready, modal-free focused target required"));
  if (state.human_activity_within_seconds < 15) issues.push(issue("HUMAN_ACTIVITY_PRIORITY", "source_snapshot.application_state", "recent human activity blocks desktop capture"));
  if (spec.source.type === "DAVINCI_RESOLVE") {
    if (!state.process_running) issues.push(issue("RESOLVE_NOT_RUNNING", "source_snapshot.application_state", "Resolve is not running"));
    if (state.project_id !== spec.source.project_id) issues.push(issue("RESOLVE_PROJECT_MISMATCH", "source_snapshot.application_state", "wrong Resolve project"));
    if (state.timeline_id !== spec.source.timeline_id) issues.push(issue("RESOLVE_TIMELINE_MISMATCH", "source_snapshot.application_state", "wrong Resolve timeline"));
    if (state.playhead_frame !== spec.source.playhead_frame) issues.push(issue("RESOLVE_PLAYHEAD_MISMATCH", "source_snapshot.application_state", "wrong playhead"));
    if (state.rendering || state.playing || state.background_task_active) issues.push(issue("RESOLVE_BUSY", "source_snapshot.application_state", "Resolve is rendering/playing/busy"));
    if (bundle.provenance.operations.some((op) => !["OBSERVE_WINDOW", "CAPTURE_PIXELS"].includes(op))) issues.push(issue("RESOLVE_MUTATION_FORBIDDEN", "provenance.operations", "Stage 7 may not mutate editorial state"));
  }
}

function validateSourceAuthenticity(spec, bundle, context, issues) {
  const snap = bundle.source_snapshot || {};
  if (snap.type !== spec.source.type || snap.machine_id !== spec.machine.id || snap.session_id !== spec.machine.session_id) issues.push(issue("SOURCE_IDENTITY_MISMATCH", "source_snapshot", "wrong source/machine/session"));
  if (!validIso(snap.observed_at) || Date.parse(snap.observed_at) < Date.parse(spec.capture.action_completed_at) || Date.parse(snap.observed_at) < Date.parse(spec.requested_at)) issues.push(issue("SOURCE_STATE_STALE", "source_snapshot.observed_at", "capture predates request/action completion"));
  if (snap.cache_state === "STALE" || snap.capture_id !== spec.capture_id) issues.push(issue("STALE_CAPTURE_REUSED", "source_snapshot.capture_id", "snapshot is not current for this capture"));
  if (spec.source.type === "TERMINAL") {
    const receipt = snap.process_receipt;
    if (!receipt || receipt.template_id !== spec.source.template_id || receipt.executable !== spec.source.executable || canonical(receipt.argv) !== canonical(spec.source.argv) || path.resolve(receipt.cwd || "") !== path.resolve(spec.source.cwd) || receipt.exit_code !== 0 || !SHA_RE.test(String(receipt.stdout_sha256 || ""))) issues.push(issue("TERMINAL_PROCESS_PROVENANCE_INVALID", "source_snapshot.process_receipt", "real exact process receipt required"));
    const visible = new Set([...(bundle.raw.visible_tokens || []), ...(bundle.presentation.visible_tokens || [])]);
    if (!visible.has(spec.source.expected_nonce)) issues.push(issue("TERMINAL_NONCE_NOT_VISIBLE", "raw.visible_tokens", "expected process nonce is not visible"));
    if (receipt && snap.raw_stdout_sha256 !== receipt.stdout_sha256) issues.push(issue("TERMINAL_OUTPUT_DETACHED", "source_snapshot.raw_stdout_sha256", "captured transcript differs from process output"));
    if (String(spec.source.template_id || "").startsWith("git-")) {
      const expected = spec.source.repository || {}; const got = snap.git_state || {};
      for (const key of ["id", "root", "head", "branch", "worktree_state_sha256"]) if (got[key] !== expected[key]) issues.push(issue("GIT_STATE_MISMATCH", `source_snapshot.git_state.${key}`, `git ${key} differs from request`));
    }
    if (receipt && scanSecrets(bundle.raw.visible_text || "").length) issues.push(issue("SECRET_LEAK", "raw.visible_text", "synthetic secret detected"));
  } else if (spec.source.type === "BROWSER") {
    if (snap.requested_url !== spec.source.url) issues.push(issue("BROWSER_REQUEST_IDENTITY_MISMATCH", "source_snapshot.requested_url", "wrong requested URL"));
    const allowed = new Set([spec.source.url, ...(spec.source.allow_redirects || [])]);
    if (!allowed.has(snap.final_url)) issues.push(issue("BROWSER_REDIRECT_UNEXPECTED", "source_snapshot.final_url", "redirect was not authorized"));
    if (snap.auth_state !== "READY") issues.push(issue("BROWSER_AUTH_REQUIRED", "source_snapshot.auth_state", "authentication requirement must surface"));
    if (!snap.selector || snap.selector.query !== spec.source.selector || !snap.selector.visible || snap.selector.area_px < 400) issues.push(issue("BROWSER_TARGET_NOT_VISIBLE", "source_snapshot.selector", "target selector was not visibly captured"));
    if (!(bundle.raw.visible_tokens || []).includes(spec.source.expected_state_nonce)) issues.push(issue("BROWSER_STATE_NOT_PROVEN", "raw.visible_tokens", "requested page state did not occur"));
  } else if (spec.source.type === "FILE_OR_CODE") {
    const repo = context.repositories && context.repositories[spec.source.repository_id];
    const sourceFile = repo && path.resolve(repo.root, spec.source.path);
    if (!sourceFile || sha256File(sourceFile) !== spec.source.source_sha256 || snap.source_sha256 !== spec.source.source_sha256) issues.push(issue("FILE_SOURCE_HASH_MISMATCH", "source_snapshot.source_sha256", "requested/current/captured file hash differs"));
    if (snap.repository_id !== spec.source.repository_id || snap.repository_root !== spec.source.repository_root || snap.git_head !== spec.source.git_head || snap.git_branch !== spec.source.git_branch || snap.git_worktree_state_sha256 !== spec.source.git_worktree_state_sha256) issues.push(issue("GIT_SOURCE_IDENTITY_MISMATCH", "source_snapshot", "wrong repository/HEAD/branch/worktree state"));
    if (snap.line_start !== spec.source.line_start || snap.line_end !== spec.source.line_end) issues.push(issue("FILE_RANGE_MISMATCH", "source_snapshot", "captured wrong line range"));
    const visibleLines = new Set(snap.visible_line_numbers || []);
    for (const line of spec.source.required_context_lines) if (!visibleLines.has(line)) issues.push(issue("FILE_CONTEXT_OMITTED", "source_snapshot.visible_line_numbers", `required line ${line} omitted`));
    if (sourceFile) {
      const selected = fs.readFileSync(sourceFile, "utf8").split(/\r?\n/).slice(spec.source.line_start - 1, spec.source.line_end).join("\n");
      if (snap.captured_text_sha256 !== sha256Bytes(selected) || sha256Bytes(bundle.raw.visible_text || "") !== snap.captured_text_sha256) issues.push(issue("FILE_RENDER_DETACHED", "source_snapshot.captured_text_sha256", "rendered text is not the requested file range"));
    }
  } else validateAppState(spec, bundle, issues);
}

function validateBundle(spec, bundle, context = {}) {
  const specResult = validateCaptureSpec(spec, context);
  if (!specResult.ok) return { ok: false, issues: specResult.issues };
  const issues = [];
  const fields = ["schema", "capture_id", "spec_digest_sha256", "status", "adapter", "source_snapshot", "raw", "presentation", "provenance", "privacy", "intent", "qc", "handoff"];
  strictObject(bundle, fields, fields, "bundle", issues);
  if (bundle.schema !== "vidtoolz.capture-evidence.v1" || bundle.capture_id !== spec.capture_id || bundle.spec_digest_sha256 !== specResult.spec_digest_sha256) issues.push(issue("BUNDLE_SPEC_BINDING_INVALID", "bundle", "bundle is detached from CaptureSpec"));
  if (bundle.status !== "COMPLETE") issues.push(issue("CAPTURE_NOT_COMPLETE", "bundle.status", "only COMPLETE can qualify"));
  strictObject(bundle.adapter, ["id", "version"], ["id", "version"], "adapter", issues);
  if (!bundle.adapter?.id || !bundle.adapter?.version) issues.push(issue("ADAPTER_IDENTITY_INVALID", "adapter", "adapter id and version are required"));
  const rawSt = validateArtifact(bundle.raw, RAW_FORMATS, issues, "raw");
  const presSt = validateArtifact(bundle.presentation, PRESENTATION_FORMATS, issues, "presentation");
  const outputRoot = context.outputRoots && context.outputRoots[spec.output.root_id];
  if (outputRoot) {
    const expectedDir = path.resolve(outputRoot, spec.output.relative_dir);
    if (path.resolve(bundle.raw?.path || "") !== path.join(expectedDir, spec.output.raw_name) || path.resolve(bundle.presentation?.path || "") !== path.join(expectedDir, spec.output.presentation_name)) issues.push(issue("ARTIFACT_DESTINATION_MISMATCH", "bundle", "artifacts must occupy the exact approved CaptureSpec destinations"));
  }
  if (spec.output.raw_name === spec.output.presentation_name) issues.push(issue("RAW_PRESENTATION_DESTINATION_ALIAS", "output", "raw and presentation destinations must differ"));
  if (rawSt && presSt && path.resolve(bundle.raw.path) === path.resolve(bundle.presentation.path)) issues.push(issue("RAW_PRESENTATION_ALIAS", "presentation.path", "raw and presentation must be separate immutable files"));
  if (bundle.presentation?.source_raw_sha256 !== undefined) issues.push(issue("UNKNOWN_FIELD", "presentation.source_raw_sha256", "raw binding belongs in provenance"));
  strictObject(bundle.provenance, ["raw_sha256", "presentation_sha256", "spec_digest_sha256", "adapter_id", "adapter_version", "machine_id", "session_id", "capture_started_at", "capture_completed_at", "operations", "manifest_digest_sha256"], ["raw_sha256", "presentation_sha256", "spec_digest_sha256", "adapter_id", "adapter_version", "machine_id", "session_id", "capture_started_at", "capture_completed_at", "operations", "manifest_digest_sha256"], "provenance", issues);
  if (bundle.provenance?.adapter_id !== bundle.adapter?.id || bundle.provenance?.adapter_version !== bundle.adapter?.version || !Array.isArray(bundle.provenance?.operations)) issues.push(issue("PROVENANCE_ADAPTER_INVALID", "provenance", "provenance must bind the exact adapter and bounded operations"));
  if (bundle.provenance?.raw_sha256 !== bundle.raw?.sha256 || bundle.provenance?.presentation_sha256 !== bundle.presentation?.sha256 || bundle.provenance?.spec_digest_sha256 !== specResult.spec_digest_sha256) issues.push(issue("PROVENANCE_ARTIFACT_BINDING_INVALID", "provenance", "raw/presentation/spec hashes differ"));
  if (bundle.provenance?.machine_id !== spec.machine.id || bundle.provenance?.session_id !== spec.machine.session_id || !validIso(bundle.provenance?.capture_started_at) || !validIso(bundle.provenance?.capture_completed_at) || Date.parse(bundle.provenance.capture_completed_at) < Date.parse(bundle.provenance.capture_started_at)) issues.push(issue("PROVENANCE_SESSION_INVALID", "provenance", "machine/session/times invalid"));
  const manifestCopy = bundle.provenance ? { ...bundle.provenance } : {};
  delete manifestCopy.manifest_digest_sha256;
  if (bundle.provenance?.manifest_digest_sha256 !== digest(manifestCopy)) issues.push(issue("PROVENANCE_MANIFEST_TAMPERED", "provenance.manifest_digest_sha256", "manifest digest invalid"));
  validateSourceAuthenticity(spec, bundle, context, issues);
  strictObject(bundle.privacy, ["policy_id", "scanner_id", "scanner_version", "raw_findings", "presentation_findings", "disposition"], ["policy_id", "scanner_id", "scanner_version", "raw_findings", "presentation_findings", "disposition"], "privacy", issues);
  const searchable = [bundle.raw?.visible_text, bundle.presentation?.visible_text, ...(bundle.raw?.visible_tokens || []), ...(bundle.presentation?.visible_tokens || [])].join("\n");
  if (scanSecrets(searchable).length || bundle.privacy?.raw_findings?.length || bundle.privacy?.presentation_findings?.length || bundle.privacy?.disposition !== "ALLOW") issues.push(issue("PRIVACY_SCAN_NOT_CLEAR", "privacy", "secrets/privacy findings block production handoff"));
  strictObject(bundle.intent, ["technical_state", "evidence_state", "observed_facts", "required_context_boxes", "explanation"], ["technical_state", "evidence_state", "observed_facts", "required_context_boxes", "explanation"], "intent", issues);
  if (bundle.intent?.technical_state !== "CAPTURE_TECHNICALLY_VALID" || bundle.intent?.evidence_state !== "EVIDENCE_INTENT_SATISFIED") issues.push(issue("EVIDENCE_INTENT_NOT_SATISFIED", "intent", "technical capture alone is insufficient"));
  const observed = new Set(bundle.intent?.observed_facts || []);
  for (const fact of spec.evidence_target.required_facts) if (!observed.has(fact)) issues.push(issue("REQUIRED_FACT_UNPROVEN", "intent.observed_facts", fact));
  validateTransformations(spec, bundle, issues);
  if (bundle.presentation?.width !== 1080 || bundle.presentation?.height !== 1920) issues.push(issue("MOBILE_GEOMETRY_INVALID", "presentation", "presentation must be 1080x1920"));
  const layout = bundle.presentation?.layout || {};
  if (!layout.evidence_box || layout.evidence_box.x < spec.presentation.safe_area.left || layout.evidence_box.y < spec.presentation.safe_area.top || layout.evidence_box.x + layout.evidence_box.width > 1080 - spec.presentation.safe_area.right || layout.evidence_box.y + layout.evidence_box.height > 1920 - spec.presentation.safe_area.bottom) issues.push(issue("EVIDENCE_OUTSIDE_SAFE_AREA", "presentation.layout", "evidence clipped/overlapping mobile unsafe region"));
  if (layout.minimum_text_px < spec.presentation.minimum_text_px || layout.evidence_box?.width < 640 || layout.evidence_box?.height < 360) issues.push(issue("EVIDENCE_UNREADABLE", "presentation.layout", "safe area alone is not readable evidence"));
  if (spec.capture.mode === "SHORT_MOTION") {
    const p = bundle.presentation || {};
    if (Math.abs(p.duration_seconds - spec.capture.duration_seconds) > 0.15 || p.black_frame_ratio > 0.02 || p.frozen_frame_ratio > 0.05 || p.action_start_seconds > 0.5 || spec.capture.duration_seconds - p.action_end_seconds > 0.5 || p.frame_count < Math.floor(p.duration_seconds * p.fps) - 1) issues.push(issue("MOTION_EVIDENCE_INVALID", "presentation", "motion is black/frozen/truncated/dead or misses action"));
  }
  strictObject(bundle.qc, ["qc_id", "reviewer", "independent_of_adapter", "verdict", "bundle_digest_sha256", "checked_at"], ["qc_id", "reviewer", "independent_of_adapter", "verdict", "bundle_digest_sha256", "checked_at"], "qc", issues);
  const expectedBundleDigest = digest({ capture_id: bundle.capture_id, spec_digest_sha256: bundle.spec_digest_sha256, source_snapshot: bundle.source_snapshot, raw_sha256: bundle.raw?.sha256, presentation_sha256: bundle.presentation?.sha256, intent: bundle.intent, privacy: bundle.privacy });
  if (bundle.qc?.reviewer === bundle.adapter?.id || bundle.qc?.independent_of_adapter !== true || bundle.qc?.verdict !== "PASS" || bundle.qc?.bundle_digest_sha256 !== expectedBundleDigest || !validIso(bundle.qc?.checked_at)) issues.push(issue("INDEPENDENT_QC_INVALID", "qc", "independent exact-bundle PASS required"));
  strictObject(bundle.handoff, ["state", "capture_id", "evidence_digest_sha256", "visual_source_class", "next_owner"], ["state", "capture_id", "evidence_digest_sha256", "visual_source_class", "next_owner"], "handoff", issues);
  if (bundle.handoff?.state !== "READY_FOR_EPISODE_FACTORY" || bundle.handoff?.capture_id !== spec.capture_id || bundle.handoff?.visual_source_class !== "AUTHENTIC_UI_PROOF" || bundle.handoff?.next_owner !== "editor") issues.push(issue("EPISODE_FACTORY_HANDOFF_INVALID", "handoff", "bounded editor handoff required"));
  const evidenceDigest = digest({ spec: specResult.spec_digest_sha256, raw: bundle.raw?.sha256, presentation: bundle.presentation?.sha256, provenance: bundle.provenance?.manifest_digest_sha256, qc: bundle.qc?.bundle_digest_sha256 });
  if (bundle.handoff?.evidence_digest_sha256 !== evidenceDigest) issues.push(issue("HANDOFF_DIGEST_INVALID", "handoff.evidence_digest_sha256", "handoff does not bind evidence chain"));
  return { ok: issues.length === 0, issues, evidence_digest_sha256: issues.length ? null : evidenceDigest };
}

function validateFailure(spec, record, context = {}) {
  const sr = validateCaptureSpec(spec, context);
  if (!sr.ok) return sr;
  const issues = [];
  strictObject(record, ["schema", "capture_id", "spec_digest_sha256", "state", "code", "failed_stage", "detail", "fallback_created", "replan_required", "human_escalation", "artifacts"], ["schema", "capture_id", "spec_digest_sha256", "state", "code", "failed_stage", "detail", "fallback_created", "replan_required", "human_escalation", "artifacts"], "failure", issues);
  if (record.schema !== "vidtoolz.capture-failure.v1" || record.capture_id !== spec.capture_id || record.spec_digest_sha256 !== sr.spec_digest_sha256 || record.state !== "CAPTURE_FAILED") issues.push(issue("FAILURE_BINDING_INVALID", "failure", "failure must bind exact spec"));
  if (!record.code || !record.failed_stage || !record.detail) issues.push(issue("FAILURE_UNSTRUCTURED", "failure", "typed stage/code/detail required"));
  if (record.fallback_created !== false || record.replan_required !== true || !["VISUAL_DIRECTOR", "HUMAN"].includes(record.human_escalation) || (record.artifacts || []).length) issues.push(issue("HIDDEN_REPRESENTATION_FALLBACK", "failure", "failure may not create substitute evidence"));
  return { ok: issues.length === 0, issues };
}

function concurrencyDecision(requests) {
  const locks = new Set(); const outputs = new Set(); const conflicts = [];
  for (const req of requests) {
    let lock;
    if (req.source.type === "DAVINCI_RESOLVE") lock = `resolve:${req.machine.session_id}`;
    else if (req.source.type === "DESKTOP_APPLICATION") lock = `desktop:${req.machine.session_id}:${req.source.application_id}`;
    else if (req.source.type === "BROWSER") lock = `browser:${req.capture_id}`;
    else if (req.source.type === "TERMINAL") lock = `terminal:${req.capture_id}`;
    else lock = `file:${req.capture_id}`;
    if (locks.has(lock)) conflicts.push(lock); else locks.add(lock);
    const outputKey = `${req.output?.root_id}:${req.output?.relative_dir}:${req.output?.raw_name}:${req.output?.presentation_name}`;
    if (outputs.has(outputKey)) conflicts.push(`output:${outputKey}`); else outputs.add(outputKey);
  }
  return { safe: conflicts.length === 0, conflicts, policy: conflicts.length ? "SERIALIZE" : "PARALLEL_ISOLATED" };
}

function semanticFingerprint(bundle) {
  return digest({
    spec_digest_sha256: bundle.spec_digest_sha256,
    source_snapshot: { ...bundle.source_snapshot, observed_at: undefined, capture_id: undefined },
    raw_sha256: bundle.raw.sha256,
    presentation_sha256: bundle.presentation.sha256,
    intent: bundle.intent,
    privacy: bundle.privacy,
  });
}

module.exports = {
  SOURCE_TYPES, CAPTURE_MODES, KNOWN_MACHINES, PRIVACY_POLICIES, TERMINAL_TEMPLATES,
  canonical, digest, sha256Bytes, sha256File, scanSecrets, parsePng,
  validateCaptureSpec, validateBundle, validateFailure, concurrencyDecision, semanticFingerprint,
};
