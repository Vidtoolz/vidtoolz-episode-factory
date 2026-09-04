"use strict";

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const oracle = require("../oracle.js");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function makePng(file, width, height, rgb = [20, 30, 40]) {
  const row = Buffer.alloc(1 + width * 3); row[0] = 0;
  for (let x = 0; x < width; x += 1) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function tmpFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "screen-capture-oracle-"));
  const sourceRoot = path.join(root, "sources"); const terminalRoot = path.join(sourceRoot, "terminal"); const cwd = path.join(terminalRoot, "work");
  const repoRoot = path.join(sourceRoot, "repo-a"); const outputRoot = path.join(root, "outputs");
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(repoRoot, { recursive: true }); fs.mkdirSync(outputRoot, { recursive: true });
  const sourceFile = path.join(repoRoot, "evidence.js");
  fs.writeFileSync(sourceFile, "// repository: repo-a\nconst state = 'CURRENT';\nconst contradiction = false;\nmodule.exports = state;\n");
  const git = (...args) => childProcess.execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-04T10:00:00Z", GIT_COMMITTER_DATE: "2026-09-04T10:00:00Z" } });
  git("init", "-b", "main"); git("config", "user.email", "oracle@example.invalid"); git("config", "user.name", "Oracle Fixture"); git("add", "evidence.js"); git("commit", "-m", "authentic source fixture");
  const repoHead = git("rev-parse", "HEAD").trim(); const repoBranch = git("symbolic-ref", "--short", "HEAD").trim();
  const fixtureScript = path.join(cwd, "emit-nonce.js");
  fs.writeFileSync(fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n');\n");
  const context = {
    outputRoots: { evidence: outputRoot },
    sourceRoots: { terminal: terminalRoot },
    repositories: { "repo-a": { root: repoRoot } },
    localFixturePorts: [18443],
    terminalAuthorities: { "fixture-nonce": { executable: "node", argv: [fixtureScript, "nonce-authentic-001"], cwd } },
  };
  return { root, sourceRoot, terminalRoot, cwd, repoRoot, outputRoot, sourceFile, fixtureScript, context, repoHead, repoBranch };
}

function sourceFor(type, fx) {
  if (type === "TERMINAL") return { type, template_id: "fixture-nonce", executable: "node", argv: [fx.fixtureScript, "nonce-authentic-001"], cwd: fx.cwd, expected_nonce: "nonce-authentic-001" };
  if (type === "BROWSER") return { type, url: "http://127.0.0.1:18443/proof", selector: "#proof", expected_state_nonce: "state-browser-001", network_zone: "LOCAL_FIXTURE", allow_redirects: [] };
  if (type === "FILE_OR_CODE") {
    const state = childProcess.execFileSync("git", ["-C", fx.repoRoot, "status", "--porcelain=v1", "--branch"]);
    return { type, repository_id: "repo-a", repository_root: fx.repoRoot, path: "evidence.js", source_sha256: oracle.sha256File(fx.sourceFile), git_head: fx.repoHead, git_branch: fx.repoBranch, git_worktree_state_sha256: oracle.sha256Bytes(state), line_start: 1, line_end: 4, required_context_lines: [1, 2, 3] };
  }
  const common = { type, application_id: type === "DAVINCI_RESOLVE" ? "davinci-resolve" : "fixture-editor", process_executable: type === "DAVINCI_RESOLVE" ? "/opt/resolve/bin/resolve" : "/usr/bin/fixture-editor", window_title: type === "DAVINCI_RESOLVE" ? "Resolve — Project Alpha" : "Fixture Editor — Document A", session_id: "display-session-1", monitor_id: "monitor-1", expected_state: "READY_DOCUMENT", allow_focus_change: false };
  if (type === "DAVINCI_RESOLVE") Object.assign(common, { project_id: "resolve-project-alpha", timeline_id: "timeline-main", playhead_frame: 120 });
  return common;
}

function validSpec(type, fx, overrides = {}) {
  const spec = {
    schema: "vidtoolz.capture-spec.v1",
    capture_id: `capture-${type.toLowerCase().replaceAll("_", "-")}-oracle-001`,
    requested_at: "2026-09-04T10:00:00.000Z",
    evidence_target: { claim: "The requested real source visibly proves its current state.", required_facts: ["fact-current-state"], forbidden_omissions: ["context-header"] },
    source: sourceFor(type, fx),
    capture: { mode: "STATIC_FRAME", duration_seconds: 0, fps: 30, action: type === "TERMINAL" ? "EXECUTE_TEMPLATE" : type === "FILE_OR_CODE" ? "READ_RANGE" : "OBSERVE_ONLY", action_completed_at: "2026-09-04T10:00:01.000Z" },
    machine: { id: type === "DAVINCI_RESOLVE" ? "presto" : "vidnux", session_id: type === "DAVINCI_RESOLVE" || type === "DESKTOP_APPLICATION" ? "display-session-1" : "audit-session-1" },
    privacy: { policy_id: "BLOCK_SECRETS_V1", allow_personal_redaction: false, secret_response: "BLOCK" },
    output: { root_id: "evidence", relative_dir: `captures/${type.toLowerCase()}`, raw_name: "raw.png", presentation_name: "presentation.png" },
    presentation: { width: 1080, height: 1920, safe_area: { left: 72, right: 72, top: 96, bottom: 144 }, minimum_text_px: 32, max_zoom: 4, retain_context: true },
    failure_policy: { on_capture_failure: "FAIL_AND_REPLAN", allow_representation_fallback: false, human_escalation: "VISUAL_DIRECTOR" },
  };
  return Object.assign(spec, overrides);
}

function artifactRecord(file, format, width, height, visibleText, tokens) {
  const st = fs.statSync(file);
  return { path: file, sha256: oracle.sha256File(file), bytes: st.size, format, width, height, visible_text: visibleText, visible_tokens: tokens };
}
function applicationState(spec) {
  const state = {
    application_id: spec.source.application_id, window_title: spec.source.window_title,
    session_id: spec.machine.session_id, window_id: "window-1", focused_window_id: "window-1",
    visible: true, minimized: false, obscured_ratio: 0, ready: true, modal_present: false,
    human_activity_within_seconds: 60, process_running: true, playing: false, rendering: false, background_task_active: false,
  };
  if (spec.source.type === "DAVINCI_RESOLVE") Object.assign(state, { project_id: spec.source.project_id, timeline_id: spec.source.timeline_id, playhead_frame: spec.source.playhead_frame });
  return state;
}

function sourceSnapshot(spec, fx, raw) {
  const base = { type: spec.source.type, machine_id: spec.machine.id, session_id: spec.machine.session_id, observed_at: "2026-09-04T10:00:02.000Z", capture_id: spec.capture_id, cache_state: "FRESH" };
  if (spec.source.type === "TERMINAL") {
    const stdout = `${spec.source.expected_nonce}\n`;
    Object.assign(base, { process_receipt: { template_id: spec.source.template_id, executable: spec.source.executable, argv: spec.source.argv, cwd: spec.source.cwd, exit_code: 0, stdout_sha256: oracle.sha256Bytes(stdout) }, raw_stdout_sha256: oracle.sha256Bytes(stdout) });
  } else if (spec.source.type === "BROWSER") {
    Object.assign(base, { requested_url: spec.source.url, final_url: spec.source.url, auth_state: "READY", selector: { query: spec.source.selector, visible: true, area_px: 5000 } });
  } else if (spec.source.type === "FILE_OR_CODE") {
    const selected = fs.readFileSync(fx.sourceFile, "utf8").split(/\r?\n/).slice(spec.source.line_start - 1, spec.source.line_end).join("\n");
    Object.assign(base, { repository_id: spec.source.repository_id, repository_root: spec.source.repository_root, git_head: spec.source.git_head, git_branch: spec.source.git_branch, git_worktree_state_sha256: spec.source.git_worktree_state_sha256, source_sha256: spec.source.source_sha256, line_start: spec.source.line_start, line_end: spec.source.line_end, visible_line_numbers: [1, 2, 3, 4], captured_text_sha256: oracle.sha256Bytes(selected) });
  } else base.application_state = applicationState(spec);
  return base;
}

function refreshIntegrity(spec, bundle) {
  bundle.spec_digest_sha256 = oracle.digest(spec);
  bundle.raw.sha256 = oracle.sha256File(bundle.raw.path); bundle.raw.bytes = fs.statSync(bundle.raw.path).size;
  bundle.presentation.sha256 = oracle.sha256File(bundle.presentation.path); bundle.presentation.bytes = fs.statSync(bundle.presentation.path).size;
  Object.assign(bundle.provenance, { raw_sha256: bundle.raw.sha256, presentation_sha256: bundle.presentation.sha256, spec_digest_sha256: bundle.spec_digest_sha256 });
  const p = { ...bundle.provenance }; delete p.manifest_digest_sha256; bundle.provenance.manifest_digest_sha256 = oracle.digest(p);
  bundle.qc.bundle_digest_sha256 = oracle.digest({ capture_id: bundle.capture_id, spec_digest_sha256: bundle.spec_digest_sha256, source_snapshot: bundle.source_snapshot, raw_sha256: bundle.raw.sha256, presentation_sha256: bundle.presentation.sha256, intent: bundle.intent, privacy: bundle.privacy });
  bundle.handoff.evidence_digest_sha256 = oracle.digest({ spec: bundle.spec_digest_sha256, raw: bundle.raw.sha256, presentation: bundle.presentation.sha256, provenance: bundle.provenance.manifest_digest_sha256, qc: bundle.qc.bundle_digest_sha256 });
  return bundle;
}

function validBundle(spec, fx) {
  const dir = path.join(fx.outputRoot, spec.output.relative_dir); fs.mkdirSync(dir, { recursive: true });
  const rawFile = makePng(path.join(dir, spec.output.raw_name), 1280, 720, [10, 30, 60]);
  const presentationFile = makePng(path.join(dir, spec.output.presentation_name), 1080, 1920, [20, 40, 80]);
  const token = spec.source.expected_nonce || spec.source.expected_state_nonce || "fact-current-state";
  const raw = artifactRecord(rawFile, "PNG", 1280, 720, `${token} fact-current-state`, [token, "fact-current-state"]);
  const presentation = artifactRecord(presentationFile, "PNG", 1080, 1920, `${token} fact-current-state`, [token, "fact-current-state"]);
  Object.assign(presentation, {
    transformations: [{ type: "BACKGROUND_FRAME" }, { type: "CROP", retained_context_ids: ["context-header"] }, { type: "ZOOM", scale: 1.5, retained_context_ids: ["context-header"] }],
    layout: { evidence_box: { x: 72, y: 96, width: 936, height: 1680 }, minimum_text_px: 36 },
  });
  if (spec.source.type === "FILE_OR_CODE") {
    const selected = fs.readFileSync(fx.sourceFile, "utf8").split(/\r?\n/).slice(spec.source.line_start - 1, spec.source.line_end).join("\n");
    raw.visible_text = selected; presentation.visible_text = selected;
  }
  const bundle = {
    schema: "vidtoolz.capture-evidence.v1", capture_id: spec.capture_id, spec_digest_sha256: oracle.digest(spec), status: "COMPLETE",
    adapter: { id: `adapter-${spec.source.type.toLowerCase()}`, version: "1.0.0" },
    source_snapshot: sourceSnapshot(spec, fx, raw), raw, presentation,
    provenance: { raw_sha256: raw.sha256, presentation_sha256: presentation.sha256, spec_digest_sha256: oracle.digest(spec), adapter_id: `adapter-${spec.source.type.toLowerCase()}`, adapter_version: "1.0.0", machine_id: spec.machine.id, session_id: spec.machine.session_id, capture_started_at: "2026-09-04T10:00:02.000Z", capture_completed_at: "2026-09-04T10:00:03.000Z", operations: ["OBSERVE_WINDOW", "CAPTURE_PIXELS"], manifest_digest_sha256: "" },
    privacy: { policy_id: spec.privacy.policy_id, scanner_id: "oracle-secret-scanner", scanner_version: "1.0.0", raw_findings: [], presentation_findings: [], disposition: "ALLOW" },
    intent: { technical_state: "CAPTURE_TECHNICALLY_VALID", evidence_state: "EVIDENCE_INTENT_SATISFIED", observed_facts: [...spec.evidence_target.required_facts], required_context_boxes: [{ id: "context-header" }], explanation: "Current source state and required context are visible." },
    qc: { qc_id: "qc-independent-001", reviewer: "qc-director", independent_of_adapter: true, verdict: "PASS", bundle_digest_sha256: "", checked_at: "2026-09-04T10:00:04.000Z" },
    handoff: { state: "READY_FOR_EPISODE_FACTORY", capture_id: spec.capture_id, evidence_digest_sha256: "", visual_source_class: "AUTHENTIC_UI_PROOF", next_owner: "editor" },
  };
  return refreshIntegrity(spec, bundle);
}

function validFailure(spec) {
  return { schema: "vidtoolz.capture-failure.v1", capture_id: spec.capture_id, spec_digest_sha256: oracle.digest(spec), state: "CAPTURE_FAILED", code: "SOURCE_NOT_READY", failed_stage: "SOURCE_PREFLIGHT", detail: "Requested source state was not observable.", fallback_created: false, replan_required: true, human_escalation: "VISUAL_DIRECTOR", artifacts: [] };
}

module.exports = { oracle, clone, tmpFixture, makePng, validSpec, validBundle, validFailure, refreshIntegrity, applicationState };
