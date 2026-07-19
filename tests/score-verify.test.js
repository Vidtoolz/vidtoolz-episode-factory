// Route coverage for Scorecraft deep verifier UI endpoint.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-verify-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function closeServer(server) { return new Promise((resolve) => server.close(resolve)); }
function unwrap(r) { return r.body && r.body.data !== undefined ? r.body.data : r.body; }
function requestJson(server, pathname, options = {}) {
  const address = server.address();
  const body = options.body ? JSON.stringify(options.body) : "";
  const headers = Object.assign(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}, options.headers || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; });
      res.on("end", () => { try { resolve({ statusCode: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ statusCode: res.statusCode, body: raw }); } });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withScoreServer(options, fn) {
  const previousSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const previousRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer();
  try {
    await listen(server);
    const host = { host: "127.0.0.1:8010" };
    const nonce = packageEngineServer.localWriteNonce();
    const headers = { ...host, "x-vidtoolz-local-write-nonce": nonce };
    await fn(server, headers);
  } finally {
    await closeServer(server);
    if (previousSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = previousSettings;
    if (previousRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT; else process.env.SCORE_ENGINE_MUSIC_ROOT = previousRoot;
  }
}

function makeReadyProject(options, extra = {}) {
  const { project } = lane.createScoreProject({ name: "Verify Route", duration_seconds: 6, ...extra }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  return project;
}

function makeApprovedProject(options) {
  const project = makeReadyProject(options);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options, { durationExact: true });
  return lane.getProject(project.project_id, options);
}

test("score verify API: approved export PASSes through the real verifier", async () => {
  const { options } = tmpEnv();
  const state = makeApprovedProject(options);
  await withScoreServer(options, async (server, headers) => {
    const res = await requestJson(server, "/api/score/verify", { method: "POST", body: { project_id: state.project.project_id }, headers });
    assert.equal(res.statusCode, 200);
    const body = unwrap(res);
    assert.equal(body.project_id, state.project.project_id);
    assert.equal(body.dir, state.dir);
    assert.equal(body.verified, true, body.report);
    assert.equal(body.no_approved_export, false);
    assert.match(body.report, /PASS — approved export verified/);
    assert.ok(body.checks.length > 0, "real checks returned to UI");
  });
});

test("score verify API: damaged approved WAV returns verified false with failures", async () => {
  const { options } = tmpEnv();
  const state = makeApprovedProject(options);
  fs.writeFileSync(path.join(state.dir, "approved", "mix.wav"), "not a wav");
  await withScoreServer(options, async (server, headers) => {
    const res = await requestJson(server, "/api/score/verify", { method: "POST", body: { project_id: state.project.project_id }, headers });
    assert.equal(res.statusCode, 200);
    const body = unwrap(res);
    assert.equal(body.verified, false);
    assert.ok(body.failures.some((f) => /byte-identical|probe: mix\.wav/.test(f)), body.failures.join("; "));
    assert.match(body.report, /FAIL —/);
  });
});

test("score verify API: project with no approval is a clear non-pass", async () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({ name: "No Approval", duration_seconds: 6 }, options);
  await withScoreServer(options, async (server, headers) => {
    const res = await requestJson(server, "/api/score/verify", { method: "POST", body: { project_id: project.project_id }, headers });
    assert.equal(res.statusCode, 200);
    const body = unwrap(res);
    assert.equal(body.verified, false);
    assert.equal(body.no_approved_export, true);
    assert.ok(body.failures.some((f) => /no approved export/.test(f)));
    assert.match(body.report, /NOT READY — no approved export/);
  });
});

test("score verify API: malformed and unknown project requests are honest errors", async () => {
  const { options } = tmpEnv();
  await withScoreServer(options, async (server, headers) => {
    const malformed = await requestJson(server, "/api/score/verify", { method: "POST", body: {}, headers });
    assert.notEqual(malformed.statusCode, 200);
    assert.match(JSON.stringify(malformed.body), /Unknown score project/);
    const unknown = await requestJson(server, "/api/score/verify", { method: "POST", body: { project_id: "missing-project" }, headers });
    assert.equal(unknown.statusCode, 404);
    assert.match(JSON.stringify(unknown.body), /Unknown score project: missing-project/);
  });
});
