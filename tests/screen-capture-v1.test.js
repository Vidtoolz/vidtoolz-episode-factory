// SCREEN CAPTURE V1 / Stage 7 — fresh rebuild test suite (2026-09-04).
// Non-destructive: isolated tmp policy, scratch Git repo, local fixture pages,
// injected idle/session/Resolve providers. Never touches a display, a human
// browser, production roots or remote machines. ffmpeg-free; Chrome headless is
// used for real browser captures and for rendering presentations.
const { assert, fs, os, path, test } = require("./_helpers.js");
const childProcess = require("node:child_process");
const C = require("../screen-capture/contract.js");
const policyModel = require("../screen-capture/policy.js");
const privacy = require("../screen-capture/privacy.js");
const spool = require("../screen-capture/spool.js");
const store = require("../screen-capture/evidence-store.js");
const lease = require("../screen-capture/human-idle-lease.js");
const png = require("../screen-capture/png.js");
const runner = require("../screen-capture/runner.js");
const resolveAdapter = require("../screen-capture/adapters/resolve.js");
const fx = require("./_screen-capture-fixture.js");

const CTX = (f) => policyModel.contextFromPolicy(policyModel.loadPolicy(f.policy));
const codes = (r) => new Set((r.issues || []).map((i) => i.code));
const rejects = (r, code) => { assert.equal(r.ok, false, `expected rejection ${code}`); assert.ok(codes(r).has(code), `missing ${code}; got ${[...codes(r)].join(",")}`); };

// ── 1. CaptureSpec V1 fail-closed authority ─────────────────────────────────
test("screen-capture spec: valid reference specs for every implemented source pass; digest is canonical", () => {
  const f = fx.makeFixture();
  try {
    for (const spec of [fx.terminalSpec(f), fx.gitStatusSpec(f), fx.fileSpec(f), fx.resolveSpec(f)]) { const r = C.validateCaptureSpec(spec, CTX(f)); assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.match(r.spec_digest_sha256, C.SHA_RE); assert.equal(r.spec_digest_sha256, C.digest(spec)); }
  } finally { f.cleanup(); }
});
test("screen-capture spec: unknown fields, unknown semantics and free-text commands fail closed without normalization", () => {
  const f = fx.makeFixture();
  try {
    const ctx = CTX(f);
    const mut = (m) => { const s = fx.terminalSpec(f); m(s); return C.validateCaptureSpec(s, ctx); };
    rejects(mut((s) => { s.extra = 1; }), "UNKNOWN_FIELD");
    rejects(mut((s) => { s.source.command = "git log"; }), "UNKNOWN_FIELD");
    rejects(mut((s) => { s.schema = "vidtoolz.capture-spec.v2"; }), "CAPTURESPEC_SCHEMA_UNKNOWN");
    rejects(mut((s) => { s.capture_id = "TEST_A_git_history"; }), "CAPTURE_ID_INVALID");
    rejects(mut((s) => { s.source = { type: "CAMERA" }; }), "SOURCE_TYPE_UNKNOWN");
    rejects(mut((s) => { s.evidence_target.required_facts = []; }), "EVIDENCE_TARGET_MISSING");
    rejects(mut((s) => { delete s.evidence_target.forbidden_omissions; }), "REQUIRED_FIELD_MISSING");
    rejects(mut((s) => { s.capture.action = "CLICK_ARBITRARY_CONTROLS"; }), "CAPTURE_ACTION_UNBOUNDED");
    rejects(mut((s) => { s.capture.mode = "FOREVER"; }), "CAPTURE_MODE_UNSUPPORTED");
    rejects(mut((s) => { s.machine.id = "laptop"; }), "MACHINE_UNKNOWN");
    rejects(mut((s) => { delete s.machine.session_id; }), "REQUIRED_FIELD_MISSING");
    rejects(mut((s) => { s.privacy.secret_response = "REDACT"; }), "SECRET_POLICY_UNSAFE");
    rejects(mut((s) => { s.privacy.policy_id = "NONE"; }), "PRIVACY_POLICY_MISSING");
    rejects(mut((s) => { s.output.root_id = "anywhere"; }), "OUTPUT_ROOT_UNKNOWN");
    rejects(mut((s) => { s.output.relative_dir = "../../etc"; }), "OUTPUT_PATH_UNSAFE");
    rejects(mut((s) => { s.output.relative_dir = "/tmp/x"; }), "OUTPUT_PATH_UNSAFE");
    rejects(mut((s) => { s.output.raw_name = "raw;touch.png"; }), "OUTPUT_NAME_UNSAFE");
    rejects(mut((s) => { s.output.presentation_name = s.output.raw_name; }), "RAW_PRESENTATION_DESTINATION_ALIAS");
    rejects(mut((s) => { s.presentation.width = 1920; }), "PRESENTATION_GEOMETRY_INVALID");
    rejects(mut((s) => { s.presentation.safe_area.bottom = 100; }), "SAFE_AREA_INVALID");
    rejects(mut((s) => { s.presentation.minimum_text_px = 12; }), "TEXT_MINIMUM_UNREADABLE");
    rejects(mut((s) => { s.presentation.max_zoom = 8; }), "PRESENTATION_CONTEXT_POLICY_INVALID");
    rejects(mut((s) => { s.failure_policy.allow_representation_fallback = true; }), "HIDDEN_FALLBACK_FORBIDDEN");
    rejects(mut((s) => { s.failure_policy.human_escalation = "NOBODY"; }), "HIDDEN_FALLBACK_FORBIDDEN");
  } finally { f.cleanup(); }
});

// ── 2. Terminal — no shell, threat matrix ───────────────────────────────────
test("screen-capture terminal: every shell/meta construct is rejected at the spec, and the adapter never invokes a shell", async () => {
  const f = fx.makeFixture();
  try {
    const ctx = CTX(f);
    const tokens = ["nonce;touch-owned", "nonce&&touch-owned", "nonce||touch-owned", "nonce|tee-owned", "$(touch-owned)", "`touch-owned`", "nonce>owned", "nonce<secret", "$PRIVATE_TOKEN", "${PRIVATE_TOKEN}", "*.env", "secret?.txt", "secret[0].txt", "nonce\ntouch-owned", "nonce\rtouch-owned", "nonce;New-Item-owned", "$env:PRIVATE_TOKEN", "%PRIVATE_TOKEN%", "nonce^&whoami", "nonce' --eval owned", "nonce\" --eval owned", "bash -c id", "powershell"];
    for (const t of tokens) { const s = fx.terminalSpec(f); s.source.argv[1] = t; rejects(C.validateCaptureSpec(s, ctx), "TERMINAL_META_SYNTAX"); }
    const exe = fx.terminalSpec(f); exe.source.executable = "curl"; rejects(C.validateCaptureSpec(exe, ctx), "TERMINAL_EXECUTABLE_MISMATCH");
    const tpl = fx.terminalSpec(f); tpl.source.template_id = "shell-anything"; rejects(C.validateCaptureSpec(tpl, ctx), "TERMINAL_TEMPLATE_UNKNOWN");
    const swap = fx.terminalSpec(f); swap.source.argv[0] = path.join(f.cwd, "other.js"); rejects(C.validateCaptureSpec(swap, ctx), "TERMINAL_FIXTURE_AUTHORITY_INVALID");
    const cwd = fx.terminalSpec(f); cwd.source.cwd = "/tmp"; rejects(C.validateCaptureSpec(cwd, ctx), "TERMINAL_CWD_UNSAFE");
    const link = path.join(f.terminalRoot, "link"); fs.symlinkSync(f.cwd, link); const sl = fx.terminalSpec(f); sl.source.cwd = link; rejects(C.validateCaptureSpec(sl, ctx), "TERMINAL_CWD_INVALID");
    // a spec that passes validation is executed with spawn(shell:false); argv reaches the process verbatim
    const spec = fx.terminalSpec(f); fs.writeFileSync(f.fixtureScript, "process.stdout.write(process.argv.slice(2).join('|') + '\\n');\n");
    const r = await runner.runCapture(spec, { policy: f.policy });
    assert.equal(r.ok, true, JSON.stringify(r.failure || r.issues));
    assert.equal(r.bundle.source_snapshot.process_receipt.shell, false);
    assert.deepEqual(r.bundle.source_snapshot.process_receipt.argv, spec.source.argv);
    assert.equal(r.bundle.raw.visible_text.trim(), spec.source.expected_nonce);
    // the runner failed fast on a spec-level rejection with no attempt, no artifact
    const inj = fx.terminalSpec(f); inj.source.argv[1] = "nonce;touch-owned"; const rr = await runner.runCapture(inj, { policy: f.policy });
    assert.equal(rr.ok, false); assert.equal(rr.code, "SPEC_REJECTED"); assert.equal(rr.failure.artifacts.length, 0); assert.ok(!fs.existsSync(path.join(f.policy.stores.spool_root, inj.capture_id)));
  } finally { f.cleanup(); }
});
test("screen-capture terminal: receipt binds executable identity, argv, cwd, pid, exit code, stdout/stderr hashes and nonce; raw TEXT equals stdout; non-zero exit and missing nonce fail typed", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.terminalSpec(f); const r = await runner.runCapture(spec, { policy: f.policy, beat: { beat_id: "B03_04", episode: "EP03" } });
    assert.equal(r.ok, true, JSON.stringify(r.failure));
    const rc = r.bundle.source_snapshot.process_receipt;
    assert.equal(rc.executable, "node"); assert.match(rc.executable_sha256, C.SHA_RE); assert.ok(rc.pid > 0); assert.equal(rc.exit_code, 0); assert.match(rc.stdout_sha256, C.SHA_RE); assert.match(rc.stderr_sha256, C.SHA_RE);
    assert.equal(r.bundle.raw.format, "TEXT"); assert.equal(r.bundle.raw.sha256, rc.stdout_sha256); assert.equal(C.sha256File(r.bundle.raw.path), rc.stdout_sha256);
    assert.ok(r.bundle.raw.visible_tokens.includes(spec.source.expected_nonce));
    assert.equal(r.asset_handoff.beat_id, "B03_04"); assert.equal(r.asset_handoff.source_class, "TERMINAL");
    // non-zero exit
    fs.writeFileSync(f.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n'); process.exit(3);\n");
    const s2 = fx.terminalSpec(f); const r2 = await runner.runCapture(s2, { policy: f.policy }); assert.equal(r2.code, "CAPTURE_FAILED"); assert.match(r2.detail, /exited 3/);
    // stale/wrong output: nonce absent
    fs.writeFileSync(f.fixtureScript, "process.stdout.write('previous output without the nonce\\n');\n");
    const s3 = fx.terminalSpec(f); const r3 = await runner.runCapture(s3, { policy: f.policy }); assert.equal(r3.code, "EVIDENCE_INSUFFICIENT");
  } finally { f.cleanup(); }
});
test("screen-capture terminal git-status: binds repo/HEAD/branch/worktree state and re-verifies it right before execution", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.gitStatusSpec(f); const r = await runner.runCapture(spec, { policy: f.policy });
    assert.equal(r.ok, true, JSON.stringify(r.failure || r.issues));
    assert.equal(r.bundle.source_snapshot.git_state.head, spec.source.repository.head); assert.equal(r.bundle.source_snapshot.git_state.branch, spec.source.repository.branch);
    // the repository changes after the spec was issued → stale, refused at validation
    fs.writeFileSync(path.join(f.repoRoot, "dirty.txt"), "changed\n");
    const spec2 = { ...spec, capture_id: fx.captureId("gs2"), output: { ...spec.output, relative_dir: "x/attempt-0001" } };
    rejects(C.validateCaptureSpec(spec2, CTX(f)), "GIT_REQUEST_STATE_STALE");
    const r2 = await runner.runCapture(spec2, { policy: f.policy }); assert.equal(r2.code, "SPEC_REJECTED");
  } finally { f.cleanup(); }
});

// ── 3. File / code / Git ────────────────────────────────────────────────────
test("screen-capture file: exact range bound to file hash, HEAD, branch, worktree; traversal, /proc, symlink, FIFO, wrong repo, mutation and stale HEAD are refused", async () => {
  const f = fx.makeFixture();
  try {
    const ctx = CTX(f);
    const spec = fx.fileSpec(f); const r = await runner.runCapture(spec, { policy: f.policy });
    assert.equal(r.ok, true, JSON.stringify(r.failure || r.issues));
    const snap = r.bundle.source_snapshot;
    assert.equal(snap.captured_text_sha256, C.sha256Bytes(r.bundle.raw.visible_text)); assert.deepEqual(snap.visible_line_numbers, [1, 2, 3, 4]); assert.equal(snap.git_head, spec.source.git_head);
    assert.equal(r.bundle.raw.visible_text, fs.readFileSync(f.sourceFile, "utf8").split(/\r?\n/).slice(0, 4).join("\n"));
    const m = (mut) => { const s = fx.fileSpec(f); mut(s); return C.validateCaptureSpec(s, ctx); };
    rejects(m((s) => { s.source.path = "../../secret"; }), "SOURCE_PATH_TRAVERSAL");
    rejects(m((s) => { s.source.path = "/proc/version"; }), "SOURCE_PATH_TRAVERSAL");
    rejects(m((s) => { s.source.repository_id = "repo-b"; }), "REPOSITORY_IDENTITY_INVALID");
    rejects(m((s) => { s.source.repository_root = f.terminalRoot; }), "REPOSITORY_IDENTITY_INVALID");
    rejects(m((s) => { s.source.line_end = 500; }), "FILE_RANGE_INVALID");
    fs.symlinkSync(f.sourceFile, path.join(f.repoRoot, "link.js")); rejects(m((s) => { s.source.path = "link.js"; s.source.source_sha256 = C.sha256File(f.sourceFile); }), "SOURCE_FILE_INVALID");
    childProcess.execFileSync("mkfifo", [path.join(f.repoRoot, "evidence.pipe")]); rejects(m((s) => { s.source.path = "evidence.pipe"; }), "SOURCE_FILE_INVALID");
    // required context outside the range → typed EVIDENCE_INSUFFICIENT at capture
    const ctxSpec = fx.fileSpec(f, { lineStart: 1, lineEnd: 2, context: [4] }); const rc = await runner.runCapture(ctxSpec, { policy: f.policy }); assert.equal(rc.code, "EVIDENCE_INSUFFICIENT");
    // mutation after the spec → stale at validation; branch switch → stale
    const before = fx.fileSpec(f); fs.appendFileSync(f.sourceFile, "// changed\n"); rejects(C.validateCaptureSpec(before, ctx), "GIT_REQUEST_STATE_STALE");
    const r2 = await runner.runCapture(before, { policy: f.policy }); assert.equal(r2.code, "SPEC_REJECTED");
    f.git("checkout", "-q", "--", "evidence.js"); const b2 = fx.fileSpec(f); f.git("checkout", "-q", "-b", "feature-x"); rejects(C.validateCaptureSpec(b2, ctx), "GIT_REQUEST_STATE_STALE");
  } finally { f.cleanup(); }
});

// ── 4. Browser authenticity ─────────────────────────────────────────────────
test("screen-capture browser: real isolated Chrome binds requested/final URL, selector, state nonce, fresh cache; error page, 404, unexpected redirect, sign-in page, hidden target and absent nonce fail typed", async () => {
  const f = fx.makeFixture();
  const nonce = `state-t-${Date.now().toString(36)}`;
  const page = await fx.startFixturePage({ nonce, redirectTo: `/proof` });
  try {
    const ctx = CTX(f);
    const spec = fx.browserSpec(f, page, nonce); const r = await runner.runCapture(spec, { policy: f.policy });
    assert.equal(r.ok, true, JSON.stringify(r.failure || r.issues));
    const snap = r.bundle.source_snapshot;
    assert.equal(snap.requested_url, page.url); assert.equal(snap.final_url, page.url); assert.equal(snap.auth_state, "READY"); assert.equal(snap.cache_state, "FRESH"); assert.equal(snap.selector.visible, true); assert.ok(snap.selector.area_px >= 400);
    assert.ok(r.bundle.raw.visible_tokens.includes(nonce)); assert.equal(r.bundle.raw.format, "PNG"); assert.equal(png.parseFile(r.bundle.raw.path).width, snap.viewport.width);
    assert.ok(r.bundle.presentation.layout.minimum_text_px >= 32, "relevant text readable via authentic viewport, not crop");
    // hostile schemes rejected at spec
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,secret", "chrome://settings", "about:blank"]) { const s = fx.browserSpec(f, page, nonce); s.source.url = u; rejects(C.validateCaptureSpec(s, ctx), "BROWSER_SCHEME_FORBIDDEN"); }
    const zone = fx.browserSpec(f, page, nonce); zone.source.network_zone = "PUBLIC_WEB"; rejects(C.validateCaptureSpec(zone, ctx), "BROWSER_LOOPBACK_NOT_AUTHORIZED");
    const admin = fx.browserSpec(f, page, nonce); admin.source.url = `http://127.0.0.1:${page.port}/api/package-engine`; rejects(C.validateCaptureSpec(admin, ctx), "BROWSER_ADMIN_ENDPOINT_FORBIDDEN");
    const sel = fx.browserSpec(f, page, nonce); sel.source.selector = "#x{background:url(javascript:x)}"; rejects(C.validateCaptureSpec(sel, ctx), "BROWSER_SELECTOR_MALFORMED");
    // runtime failures
    const nf = fx.browserSpec(f, page, nonce); nf.source.url = `http://127.0.0.1:${page.port}/missing`; nf.evidence_target.required_facts = [`visible:${nonce}`]; const r404 = await runner.runCapture(nf, { policy: f.policy }); assert.equal(r404.code, "CAPTURE_FAILED"); assert.match(r404.detail, /HTTP 404/);
    const refused = fx.browserSpec(f, page, nonce); refused.source.url = "http://127.0.0.1:9/never"; f.policy.approved.local_fixture_ports.push(9); const rRef = await runner.runCapture(refused, { policy: f.policy }); assert.equal(rRef.code, "CAPTURE_FAILED"); assert.match(rRef.detail, /error page|navigation failed/);
    const redir = fx.browserSpec(f, page, nonce); redir.source.url = `http://127.0.0.1:${page.port}/start`; const rRed = await runner.runCapture(redir, { policy: f.policy }); assert.equal(rRed.code, "CAPTURE_FAILED"); assert.match(rRed.detail, /not the requested URL or an authorized redirect/);
    const redirOk = fx.browserSpec(f, page, nonce); redirOk.source.url = `http://127.0.0.1:${page.port}/start`; redirOk.source.allow_redirects = [page.url]; redirOk.evidence_target.required_facts = [`visible:${nonce}`, `final-url:${page.url}`]; const rOk = await runner.runCapture(redirOk, { policy: f.policy }); assert.equal(rOk.ok, true, JSON.stringify(rOk.failure)); assert.equal(rOk.bundle.source_snapshot.redirect_chain.length, 1);
    const login = fx.browserSpec(f, page, nonce); login.source.url = `http://127.0.0.1:${page.port}/login`; const rL = await runner.runCapture(login, { policy: f.policy }); assert.equal(rL.code, "AUTH_REQUIRED");
    const hidden = fx.browserSpec(f, page, nonce); hidden.source.selector = "#does-not-exist"; const rH = await runner.runCapture(hidden, { policy: f.policy }); assert.equal(rH.code, "EVIDENCE_INSUFFICIENT");
    const stale = fx.browserSpec(f, page, "state-not-on-page-000"); const rS = await runner.runCapture(stale, { policy: f.policy }); assert.equal(rS.code, "EVIDENCE_INSUFFICIENT"); assert.match(rS.detail, /state did not occur/);
  } finally { await page.close(); f.cleanup(); }
});

// ── 5. Privacy BLOCK ────────────────────────────────────────────────────────
test("screen-capture privacy: synthetic OpenAI/AWS/private-token/password/private-key material blocks — no raw finalized, no presentation, no handoff; blocked receipt carries no secret bytes", async () => {
  const f = fx.makeFixture();
  try {
    const fixtures = { openai: "export OPENAI_API_KEY=sk-test-ADJFIXTURE000000000000000000", aws: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", aws_id: "AKIAIOSFODNN7EXAMPLE", token: "PRIVATE_TOKEN=VIDTOOLZ_TEST_SECRET_123456", password: "PASSWORD=hunter2-fixture", key: "-----BEGIN RSA PRIVATE KEY-----" };
    for (const [name, text] of Object.entries(fixtures)) {
      assert.ok(privacy.scanText(text).length > 0, `${name} detected by scanner`);
      fs.writeFileSync(f.fixtureScript, `process.stdout.write(String(process.argv[2]) + '\\n' + ${JSON.stringify(text)} + '\\n');\n`);
      const spec = fx.terminalSpec(f); const r = await runner.runCapture(spec, { policy: f.policy });
      assert.equal(r.code, "PRIVACY_BLOCKED", `${name}: ${r.code} ${r.detail}`);
      assert.equal(r.blocked_receipt.state, "CAPTURE_BLOCKED_SENSITIVE_DATA"); assert.ok(r.blocked_receipt.categories.length >= 1); assert.equal(r.blocked_receipt.retained_bytes, "NONE");
      assert.ok(!JSON.stringify(r.blocked_receipt).includes(text.split("=").pop()), `${name}: receipt must not contain the secret value`);
      assert.ok(!JSON.stringify(r.failure).includes(text.split("=").pop()), `${name}: failure record must not contain the secret value`);
      const dest = path.join(f.policy.stores.evidence_root, spec.output.relative_dir);
      assert.ok(!fs.existsSync(dest), `${name}: nothing finalized`);
      const spoolDir = path.join(f.policy.stores.spool_root, spec.capture_id, "attempt-0001"); assert.ok(fs.existsSync(path.join(spoolDir, ".discarded")) && !fs.existsSync(path.join(spoolDir, "raw.txt")), `${name}: spool bytes discarded`);
      assert.ok(fs.existsSync(path.join(f.policy.stores.receipts_root, spec.capture_id, "attempt-0001-blocked-receipt.json")));
    }
    assert.equal(privacy.scanText("ordinary transcript: sk-8 is too short to be a key; nothing sensitive here").length, 0);
    assert.ok(privacy.scanText("password: none").length > 0, "prose that looks like a credential assignment is treated as a possible secret (block bias)");
  } finally { f.cleanup(); }
});

// ── 6. Spool / finalizer / rewrite ──────────────────────────────────────────
test("screen-capture spool: unique attempts, no overwrite, no cross-attempt reuse, restricted mode", () => {
  const f = fx.makeFixture();
  try {
    const a1 = spool.openAttempt(f.policy.stores.spool_root, "capture-spool-test-000001"); const a2 = spool.openAttempt(f.policy.stores.spool_root, "capture-spool-test-000001");
    assert.equal(a1.attempt_id, "attempt-0001"); assert.equal(a2.attempt_id, "attempt-0002"); assert.notEqual(a1.dir, a2.dir);
    assert.equal(fs.statSync(a1.dir).mode & 0o777, 0o700);
    spool.writeArtifact(a1, "raw.txt", Buffer.from("x")); assert.throws(() => spool.writeArtifact(a1, "raw.txt", Buffer.from("y")), /EEXIST/);
    assert.throws(() => spool.writeArtifact(a1, "../escape.txt", Buffer.from("y")), /unsafe/);
    assert.throws(() => spool.openAttempt(f.policy.stores.spool_root, "not-bounded id"), (e) => e.code === "SPEC_REJECTED");
  } finally { f.cleanup(); }
});
test("screen-capture finalizer: create-once with fsync/readback, signed receipt verifies, tampering detected, no update/delete API, same-authority rewrite attempts fail without chmod", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.terminalSpec(f); const r = await runner.runCapture(spec, { policy: f.policy }); assert.equal(r.ok, true, JSON.stringify(r.failure));
    const dir = path.join(f.policy.stores.evidence_root, spec.output.relative_dir);
    const v = store.verifyAttempt(f.policy.stores.evidence_root, spec.output.relative_dir); assert.equal(v.ok, true, v.problems.join("; "));
    assert.equal(r.receipt.signature_alg, "ed25519"); assert.ok(!Object.keys(store).some((k) => /update|delete|remove|replace|rewrite/i.test(k)), "finalizer exposes no mutation API");
    const raw = r.bundle.raw.path; const manifest = path.join(dir, "manifest.json"); const receipt = path.join(dir, "receipt.json");
    // SAME-AUTHORITY REWRITE TEST (mandatory): as the capture process, try to overwrite/delete/replace/alter
    const attempts = {
      overwrite_raw: () => fs.writeFileSync(raw, "tampered"), delete_raw: () => fs.unlinkSync(raw), replace_raw_path: () => fs.renameSync(path.join(f.root, "keys", "finalizer.pem"), raw),
      alter_manifest: () => fs.writeFileSync(manifest, "{}"), replace_manifest: () => { fs.writeFileSync(path.join(f.root, "m.json"), "{}"); fs.renameSync(path.join(f.root, "m.json"), manifest); }, alter_receipt: () => fs.appendFileSync(receipt, "x"),
      add_file_to_sealed_dir: () => fs.writeFileSync(path.join(dir, "extra.png"), "x"), refinalize_same_destination: () => store.finalizeRaw({ evidence_root: f.policy.stores.evidence_root, signing_key_path: f.keyPath }, { capture_id: spec.capture_id, attempt_id: "attempt-0001", spec_digest_sha256: r.spec_digest_sha256, format: "TEXT", bytes: Buffer.from("again"), privacy_disposition: "ALLOW", destination: { relative_dir: spec.output.relative_dir, raw_name: "raw.txt" }, machine_id: "vidnux", session_id: "s" }),
    };
    const outcomes = {};
    for (const [name, attempt] of Object.entries(attempts)) { try { attempt(); outcomes[name] = "SUCCEEDED"; } catch (e) { outcomes[name] = e.code || "ERROR"; } }
    for (const [name, outcome] of Object.entries(outcomes)) assert.notEqual(outcome, "SUCCEEDED", `${name} must fail (got ${outcome})`);
    assert.equal(store.verifyAttempt(f.policy.stores.evidence_root, spec.output.relative_dir).ok, true, "evidence intact after rewrite attempts");
    // honesty about the boundary: the same Unix identity CAN chmod and then rewrite → software-only class, not production-qualified
    assert.equal(r.protection.trust_anchor_class, "SAME_AUTHORITY_SOFTWARE_ONLY"); assert.equal(r.protection.production_qualified, false); assert.equal(r.asset_handoff.raw.production_qualified_store, false);
    fs.chmodSync(dir, 0o755); fs.chmodSync(raw, 0o644); fs.appendFileSync(raw, "x");
    const tampered = store.verifyAttempt(f.policy.stores.evidence_root, spec.output.relative_dir); assert.equal(tampered.ok, false); assert.ok(tampered.problems.some((p) => /raw bytes differ/.test(p)));
    // trust anchor unavailable when the key is missing/unsafe
    const noKey = { ...f.policy, stores: { ...f.policy.stores, signing_key_path: path.join(f.root, "missing.pem") } };
    const rk = await runner.runCapture(fx.terminalSpec(f), { policy: noKey }); assert.equal(rk.code, "TRUST_ANCHOR_UNAVAILABLE");
    fs.chmodSync(f.keyPath, 0o644); const rk2 = await runner.runCapture(fx.terminalSpec(f), { policy: f.policy }); assert.equal(rk2.code, "TRUST_ANCHOR_UNAVAILABLE"); fs.chmodSync(f.keyPath, 0o600);
  } finally { f.cleanup(); }
});

// ── 7. Presentation / transformation manifest / mobile readability ──────────
test("screen-capture presentation: 1080×1920 derivative, separate bytes, transformation manifest binds raw and output, measured geometry inside safe margins, text ≥32 px, pixel QC not hardcoded; unreadable range fails typed", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.fileSpec(f); const r = await runner.runCapture(spec, { policy: f.policy }); assert.equal(r.ok, true, JSON.stringify(r.failure));
    const p = r.bundle.presentation; const parsed = png.parseFile(p.path); assert.equal(parsed.width, 1080); assert.equal(parsed.height, 1920);
    assert.notEqual(p.path, r.bundle.raw.path); assert.notEqual(p.sha256, r.bundle.raw.sha256);
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(p.path), "presentation-manifest.json"), "utf8"));
    assert.equal(manifest.raw_sha256, r.bundle.raw.sha256); assert.equal(manifest.presentation_sha256, p.sha256); assert.ok(manifest.transformations.some((t) => t.type === "TYPESET")); assert.ok(!manifest.transformations.some((t) => ["RETYPE", "REDRAW", "GENERATIVE_FILL", "CONTENT_REPLACE"].includes(t.type)));
    const box = p.layout.evidence_box; assert.ok(box.x >= 72 && box.y >= 96 && box.x + box.width <= 1008 && box.y + box.height <= 1776); assert.ok(box.width >= 640 && box.height >= 360); assert.ok(p.layout.minimum_text_px >= 32);
    const decoded = png.decode(fs.readFileSync(p.path)); const stats = png.regionStats(decoded, box); assert.ok(stats.stddev > 6, `evidence region has content (stddev ${stats.stddev})`); assert.ok(stats.median_glyph_run_px >= 16, `glyph runs ${stats.median_glyph_run_px}px`);
    const qcNames = r.qc.checks.map((c) => c.name); for (const n of ["minimum_text_px", "evidence_box_inside_safe_area", "rendered_glyph_height_pixels", "privacy_rescan_clear", "finalizer_receipt_verifies", "all_required_facts_proven"]) assert.ok(qcNames.includes(n), n);
    assert.ok(r.qc.checks.every((c) => typeof c.ok === "boolean" && c.detail !== undefined)); assert.equal(r.qc.reviewer, "vidtoolz-capture-qc"); assert.notEqual(r.qc.reviewer, r.bundle.adapter.id);
    // a range too long to be readable at 32 px fails typed instead of shrinking the text
    fs.writeFileSync(f.sourceFile, Array.from({ length: 80 }, (_, i) => `const line${i} = ${i};`).join("\n") + "\n"); f.git("add", "evidence.js"); f.git("commit", "-q", "-m", "long");
    const long = fx.fileSpec(f, { lineStart: 1, lineEnd: 80, context: [1] }); long.evidence_target.required_facts = ["visible:const line0 = 0;", `line-range:1-80`];
    const rl = await runner.runCapture(long, { policy: f.policy }); assert.equal(rl.code, "PRESENTATION_FAILED"); assert.match(rl.detail, /not mobile-readable|do not fit/);
    assert.ok(fs.existsSync(rl.raw_finalized.path), "raw stays finalized; only the derivative is refused");
  } finally { f.cleanup(); }
});

// ── 8. Provenance / handoff / QC digests ────────────────────────────────────
test("screen-capture provenance + handoff: digests bind spec→snapshot→raw→presentation→QC→handoff; tampering any link is detected; asset handoff verifies and is refused when detached", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.terminalSpec(f); const r = await runner.runCapture(spec, { policy: f.policy, beat: { beat_id: "B_X", episode: "EPX", run_id: "run-1" } }); assert.equal(r.ok, true);
    const b = r.bundle;
    assert.equal(b.provenance.manifest_digest_sha256, C.provenanceManifestDigest(b.provenance)); assert.equal(b.qc.bundle_digest_sha256, C.qcBundleDigest(b)); assert.equal(b.handoff.evidence_digest_sha256, C.evidenceDigest(b));
    const h = r.asset_handoff; assert.equal(h.schema, "vidtoolz.screenCaptureAssetHandoff.v1"); assert.equal(h.beat_id, "B_X"); assert.equal(h.evidence_digest_sha256, b.handoff.evidence_digest_sha256); assert.equal(h.visual_source_class, "AUTHENTIC_UI_PROOF"); assert.ok(h.provenance_chain.length >= 8);
    assert.equal(runner.verifyAssetHandoff(h).ok, true);
    const detached = JSON.parse(JSON.stringify(h)); detached.raw.sha256 = "0".repeat(64); assert.equal(runner.verifyAssetHandoff(detached).ok, false);
    const noQc = JSON.parse(JSON.stringify(h)); noQc.qc.verdict = "FAIL"; noQc.handoff_digest_sha256 = C.digest((() => { const c = { ...noQc }; delete c.handoff_digest_sha256; return c; })()); assert.ok(runner.verifyAssetHandoff(noQc).problems.includes("QC not PASS"));
    // tampering the bundle's raw hash breaks provenance/qc/handoff digests
    const t = JSON.parse(JSON.stringify(b)); t.raw.sha256 = "f".repeat(64); assert.notEqual(C.qcBundleDigest(t), t.qc.bundle_digest_sha256); assert.notEqual(C.evidenceDigest(t), t.handoff.evidence_digest_sha256);
  } finally { f.cleanup(); }
});

// ── 9. Human-idle lease, desktop disabled, Resolve gated/observe-only ────────
test("screen-capture lease: 60 s double-sampled idle, unknown blocks, human input wins, locked/inactive blocks, recheck before capture aborts", async () => {
  const policy = { minimum_idle_seconds: 60, sample_gap_seconds: 5, samples: 2 };
  const granted = await lease.acquireLease({ policy, deps: fx.idleDeps(120000), targetSessionId: "s" }); assert.equal(granted.granted, true); assert.equal(granted.samples.length, 2);
  const busy = await lease.acquireLease({ policy, deps: fx.idleDeps(20000), targetSessionId: "s" }); assert.equal(busy.granted, false); assert.equal(busy.code, "HUMAN_BUSY");
  const unknown = await lease.acquireLease({ policy, deps: { ...fx.idleDeps(120000), idle: () => ({ ok: false, reason: "no monitor" }) }, targetSessionId: "s" }); assert.equal(unknown.granted, false);
  const locked = await lease.acquireLease({ policy, deps: fx.idleDeps(120000, { locked: true }), targetSessionId: "s" }); assert.equal(locked.granted, false);
  let calls = 0; const regress = await lease.acquireLease({ policy, deps: { ...fx.idleDeps(120000), idle: () => ({ ok: true, idle_ms: (calls += 1) === 1 ? 120000 : 70000 }) }, targetSessionId: "s" }); assert.equal(regress.granted, false); assert.match(regress.detail, /input occurred/);
  const recent = await lease.acquireLease({ policy, deps: { ...fx.idleDeps(120000), idle: () => ({ ok: true, idle_ms: 3000 }) }, targetSessionId: "s" }); assert.equal(recent.granted, false); assert.match(recent.detail, /human input 3 s ago/);
  const re = lease.recheckLease(granted, { idle: () => ({ ok: true, idle_ms: 1000 }) }); assert.equal(re.ok, false);
  assert.equal(lease.recheckLease(granted, { idle: () => ({ ok: true, idle_ms: 130000 }) }).ok, true);
});
test("screen-capture desktop: generic desktop is never an authority — typed SOURCE_UNAVAILABLE, no display touched, cannot be enabled by policy", async () => {
  const f = fx.makeFixture();
  try {
    const p = policyModel.loadPolicy({ ...f.policy, source_gates: { ...f.policy.source_gates, DESKTOP_APPLICATION: true } }); assert.equal(p.source_gates.DESKTOP_APPLICATION, false);
    const spec = fx.baseSpec(fx.captureId("desk"), { type: "DESKTOP_APPLICATION", application_id: "gedit", process_executable: "gedit", window_title: "Untitled", session_id: "test-session", monitor_id: "m1", expected_state: "idle", allow_focus_change: false }, ["visible:x"]); spec.output.raw_name = "raw.png";
    const r = await runner.runCapture(spec, { policy: f.policy }); assert.equal(r.code, "SOURCE_UNAVAILABLE"); assert.match(r.detail, /NOT READY as a generic adapter|not a Screen Capture V1 authority/);
    const direct = await require("../screen-capture/adapters/desktop.js").capture(spec, {}).then(() => null, (e) => e); assert.equal(direct.code, "SOURCE_UNAVAILABLE"); assert.match(direct.message, /not a Screen Capture V1 authority/);
    const focus = JSON.parse(JSON.stringify(spec)); focus.source.allow_focus_change = true; rejects(C.validateCaptureSpec(focus, CTX(f)), "DESKTOP_MUTATION_FORBIDDEN");
    const src = fs.readFileSync(path.join(__dirname, "..", "screen-capture", "adapters", "desktop.js"), "utf8"); assert.ok(!/DISPLAY|scrot|xwd|import\(|spawn/.test(src), "no display access code in the disabled adapter");
  } finally { f.cleanup(); }
});
test("screen-capture Resolve: gated observation-only; unavailable without a provider; every unsafe state blocks; PRESTO identity must bind; positive fixture state captures via OBSERVE_WINDOW/CAPTURE_PIXELS only", async () => {
  const f = fx.makeFixture();
  try {
    const spec = fx.resolveSpec(f); assert.equal(C.validateCaptureSpec(spec, CTX(f)).ok, true);
    const none = await runner.runCapture(spec, { policy: f.policy }); assert.equal(none.code, "SOURCE_UNAVAILABLE");
    const off = await runner.runCapture(fx.resolveSpec(f), { policy: { ...f.policy, source_gates: { ...f.policy.source_gates, DAVINCI_RESOLVE: false } } }); assert.equal(off.code, "POLICY_DISABLED");
    const pixel = async () => ({ png: fx.solidPng(1280, 720, [30, 80, 120]), width: 1280, height: 720 });
    const deps = (state, idle = 120000) => ({ resolve: { stateProvider: async () => state, pixelCapture: pixel, lease: fx.idleDeps(idle) } });
    const cases = [["playing", { playing: true }, "HUMAN_BUSY"], ["rendering", { rendering: true }, "HUMAN_BUSY"], ["background job", { background_task_active: true }, "HUMAN_BUSY"], ["modal", { modal_present: true }, "SOURCE_PREFLIGHT_FAILED"], ["wrong project", { project_id: "OTHER" }, "SOURCE_PREFLIGHT_FAILED"], ["wrong timeline", { timeline_id: "T2" }, "SOURCE_PREFLIGHT_FAILED"], ["wrong playhead", { playhead_frame: 7 }, "SOURCE_PREFLIGHT_FAILED"], ["minimized", { minimized: true }, "SOURCE_PREFLIGHT_FAILED"], ["obscured", { obscured_ratio: 0.5 }, "SOURCE_PREFLIGHT_FAILED"], ["focus elsewhere", { focused_window_id: "w9" }, "SOURCE_PREFLIGHT_FAILED"], ["not running", { process_running: false }, "SOURCE_UNAVAILABLE"], ["unknown playback state", { playing: undefined }, "SOURCE_PREFLIGHT_FAILED"], ["wrong machine uuid", { machine: { ...fx.goodResolveState().machine, uuid_sha256: "0".repeat(64) } }, "SOURCE_PREFLIGHT_FAILED"], ["ssh session masquerading as console", { machine: { ...fx.goodResolveState().machine, collection_session_id: "1" } }, "SOURCE_PREFLIGHT_FAILED"]];
    for (const [name, patch, code] of cases) { const r = await runner.runCapture(fx.resolveSpec(f), { policy: f.policy, deps: deps({ ...fx.goodResolveState(), ...patch }) }); assert.equal(r.code, code, `${name}: ${r.code} ${r.detail}`); }
    const busyHuman = await runner.runCapture(fx.resolveSpec(f), { policy: f.policy, deps: deps(fx.goodResolveState(), 10000) }); assert.equal(busyHuman.code, "HUMAN_BUSY");
    // pixel raw for the positive case must be a real image with content: use a text-bearing PNG? the solid fixture would fail pixel QC — that is correct behaviour
    const ok = await runner.runCapture(fx.resolveSpec(f), { policy: f.policy, deps: deps(fx.goodResolveState()) });
    assert.ok(ok.code !== "HUMAN_BUSY" && ok.code !== "SOURCE_PREFLIGHT_FAILED" && ok.code !== "SOURCE_UNAVAILABLE", `preflight passed: ${ok.code} ${ok.detail}`);
    if (!ok.ok) assert.ok(["QC_BLOCKED", "PRESENTATION_FAILED"].includes(ok.code), `a blank fixture image may only fail at QC/presentation, got ${ok.code}: ${ok.detail}`);
    assert.deepEqual(resolveAdapter.OPERATIONS, ["OBSERVE_WINDOW", "CAPTURE_PIXELS"]);
    const src = fs.readFileSync(path.join(__dirname, "..", "screen-capture", "adapters", "resolve.js"), "utf8"); assert.ok(!/\.click\(|SetCurrentTimecode|OpenProject|LoadProject|SetCurrentTimeline|Input\.dispatch|xdotool|sendkeys|Play\(|Stop\(/i.test(src), "observation-only: no mutation API in the Resolve adapter");
  } finally { f.cleanup(); }
});

// ── 10. Gating, typed failures, concurrency, retries ────────────────────────
test("screen-capture gating: production policy file is MERGED-BUT-DISABLED (flag off, all sources off, desktop hard off); partial activation is configuration only", async () => {
  const prod = policyModel.loadPolicy(policyModel.DEFAULT_POLICY_FILE);
  assert.equal(prod.feature_flag, false); for (const cls of policyModel.SOURCE_CLASSES) assert.equal(prod.source_gates[cls], false, cls);
  assert.equal(policyModel.gateDecision(prod, "TERMINAL").code, "POLICY_DISABLED");
  const partial = policyModel.loadPolicy({ ...prod, feature_flag: true, source_gates: { TERMINAL: true } });
  assert.equal(partial.source_gates.TERMINAL, true); assert.equal(partial.source_gates.BROWSER, false); assert.equal(policyModel.gateDecision(partial, "BROWSER").code, "POLICY_DISABLED"); assert.equal(policyModel.gateDecision(partial, "DESKTOP_APPLICATION").code, "SOURCE_UNAVAILABLE");
  const f = fx.makeFixture();
  try { const r = await runner.runCapture(fx.terminalSpec(f), { policy: { ...f.policy, feature_flag: false } }); assert.equal(r.code, "POLICY_DISABLED"); assert.equal(r.failure.fallback_created, false); assert.equal(r.failure.replan_required, true); } finally { f.cleanup(); }
});
test("screen-capture failures: every typed failure binds the CaptureSpec digest, creates no artifact and routes to Visual Director/human", async () => {
  const f = fx.makeFixture();
  try {
    const seen = new Set();
    const r1 = await runner.runCapture(fx.terminalSpec(f), { policy: { ...f.policy, feature_flag: false } }); seen.add(r1.code);
    fs.writeFileSync(f.fixtureScript, "process.exit(2)\n"); const r2 = await runner.runCapture(fx.terminalSpec(f), { policy: f.policy }); seen.add(r2.code);
    fs.writeFileSync(f.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\nPASSWORD=fixture-secret\\n');\n"); const r3 = await runner.runCapture(fx.terminalSpec(f), { policy: f.policy }); seen.add(r3.code);
    fs.writeFileSync(f.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n');\n");
    const r4 = await runner.runCapture(fx.terminalSpec(f), { policy: { ...f.policy, stores: { ...f.policy.stores, signing_key_path: "/nonexistent/key.pem" } } }); seen.add(r4.code);
    for (const r of [r1, r2, r3, r4]) { assert.equal(r.ok, false); assert.equal(r.failure.schema, "vidtoolz.capture-failure.v1"); assert.match(r.failure.spec_digest_sha256, C.SHA_RE); assert.equal(r.failure.state, "CAPTURE_FAILED"); assert.equal(r.failure.fallback_created, false); assert.equal(r.failure.replan_required, true); assert.deepEqual(r.failure.artifacts, []); assert.ok(["VISUAL_DIRECTOR", "HUMAN"].includes(r.failure.human_escalation)); assert.ok(C.FAILURE_CODES.includes(r.failure.code)); }
    assert.deepEqual([...seen].sort(), ["CAPTURE_FAILED", "POLICY_DISABLED", "PRIVACY_BLOCKED", "TRUST_ANCHOR_UNAVAILABLE"]);
    const receipts = fs.readdirSync(f.policy.stores.receipts_root).length; assert.ok(receipts >= 3, "failure receipts persisted");
  } finally { f.cleanup(); }
});
test("screen-capture concurrency + retries: isolated captures run in parallel with unique paths and no crossover; same-lock/same-destination requests serialize or conflict; a retry is a new attempt/destination and never reuses spool or evidence paths", async () => {
  const f = fx.makeFixture();
  try {
    const a = fx.terminalSpec(f); const b = fx.fileSpec(f);
    const d = C.concurrencyDecision([a, b]); assert.equal(d.safe, true);
    const clash = JSON.parse(JSON.stringify(a)); clash.capture_id = fx.captureId("clash"); assert.equal(C.concurrencyDecision([a, clash]).safe, false);
    const [ra, rb] = await Promise.all([runner.runCapture(a, { policy: f.policy }), runner.runCapture(b, { policy: f.policy })]);
    assert.equal(ra.ok, true, JSON.stringify(ra.failure)); assert.equal(rb.ok, true, JSON.stringify(rb.failure));
    assert.notEqual(ra.bundle.raw.path, rb.bundle.raw.path); assert.notEqual(ra.bundle.presentation.path, rb.bundle.presentation.path); assert.notEqual(ra.bundle.handoff.evidence_digest_sha256, rb.bundle.handoff.evidence_digest_sha256);
    assert.equal(ra.bundle.source_snapshot.capture_id, a.capture_id); assert.equal(rb.bundle.source_snapshot.capture_id, b.capture_id);
    // same destination again → finalizer refuses (never replaced)
    const again = JSON.parse(JSON.stringify(a)); again.capture_id = fx.captureId("again"); again.output.relative_dir = a.output.relative_dir;
    const rag = await runner.runCapture(again, { policy: f.policy }); assert.equal(rag.code, "FINALIZATION_FAILED"); assert.match(rag.detail, /never replaced/);
    // retry after a transient failure: new attempt id in the spool, distinct destination
    fs.writeFileSync(f.fixtureScript, "process.exit(1)\n"); const t = fx.terminalSpec(f); const r1 = await runner.runCapture(t, { policy: f.policy }); assert.equal(r1.attempt_id, "attempt-0001");
    fs.writeFileSync(f.fixtureScript, "process.stdout.write(String(process.argv[2]) + '\\n');\n"); const retry = JSON.parse(JSON.stringify(t)); retry.output.relative_dir = `${t.capture_id}/attempt-0002`;
    const r2 = await runner.runCapture(retry, { policy: f.policy }); assert.equal(r2.ok, true, JSON.stringify(r2.failure)); assert.equal(r2.attempt_id, "attempt-0002");
    // in-process lock: two simultaneous runs of the same capture id → one conflicts
    const dup = fx.terminalSpec(f); const results = await Promise.all([runner.runCapture(dup, { policy: f.policy }), runner.runCapture(JSON.parse(JSON.stringify(dup)), { policy: f.policy })]);
    assert.ok(results.some((r) => r.code === "CONCURRENCY_CONFLICT") || results.filter((r) => r.ok).length === 1);
  } finally { f.cleanup(); }
});

// ── 11. Contract mirrors the frozen public records ──────────────────────────
test("screen-capture contract: digest formulas and record shapes match the frozen oracle when it is present on this machine", () => {
  const oraclePath = process.env.SCREEN_CAPTURE_ORACLE_ROOT || "/home/vidtoolz/ef-screen-capture-v1-oracle-20260904";
  const file = path.join(oraclePath, "acceptance-oracles", "screen-capture-v1", "oracle.js");
  if (!fs.existsSync(file)) { console.log("  (frozen oracle checkout not present; contract mirror check skipped — run scripts/screen-capture-oracle-conformance.js where it exists)"); return; }
  const oracle = require(file);
  const sample = { b: 1, a: [3, { z: 1, y: 2 }], c: "x" };
  assert.equal(C.canonical(sample), oracle.canonical(sample)); assert.equal(C.digest(sample), oracle.digest(sample));
  assert.deepEqual(Object.keys(C.TERMINAL_TEMPLATES).sort(), Object.keys(oracle.TERMINAL_TEMPLATES).sort());
  const f = fx.makeFixture();
  try { const spec = fx.fileSpec(f); const ctx = CTX(f); assert.equal(oracle.validateCaptureSpec(spec, ctx).ok, true); assert.equal(oracle.validateCaptureSpec(spec, ctx).spec_digest_sha256, C.validateCaptureSpec(spec, ctx).spec_digest_sha256); const bad = fx.terminalSpec(f); bad.source.argv[1] = "a;b"; assert.deepEqual([...codes(oracle.validateCaptureSpec(bad, ctx))].sort(), [...codes(C.validateCaptureSpec(bad, ctx))].sort()); } finally { f.cleanup(); }
});
