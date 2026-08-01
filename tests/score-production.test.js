// Scorecraft DAW production-mix return gate. All files live in temp projects;
// probes are injected and no DAW, ffprobe binary, or real project is touched.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const synth = require("../score-engine/preview-synth.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-production-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

function makeWav(duration = 3, sampleRate = 48000, bitDepth = 24, amplitude = 0.1) {
  const frames = Math.round(duration * sampleRate);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  left[0] = amplitude; right[0] = -amplitude;
  return synth.writeWavBuffer(left, right, sampleRate, bitDepth);
}

function wavProbe(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return { ok: false, reason: "invalid WAV" };
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitDepth = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  return { ok: true, sample_rate: sampleRate, channels, codec: bitDepth === 24 ? "pcm_s24le" : "pcm_s16le", duration: dataBytes / (sampleRate * channels * (bitDepth / 8)) };
}

function approvedProject(options, duration = 3) {
  const { project } = lane.createScoreProject({ name: "Production Gate", duration_seconds: duration }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  return project;
}

test("score production: valid WAV imports atomically and identical content is idempotent", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const input = { original_filename: "reaper-final.wav", bytes: makeWav() };
  const first = lane.importProductionMix(project.project_id, input, { ...options, probeImpl: wavProbe });
  const second = lane.importProductionMix(project.project_id, input, { ...options, probeImpl: wavProbe });
  assert.equal(first.production_mix_id, second.production_mix_id);
  assert.equal(second.idempotent, true);
  const different = lane.importProductionMix(project.project_id, { original_filename: "alternate.wav", bytes: makeWav(3, 48000, 24, 0.2) }, { ...options, probeImpl: wavProbe });
  assert.notEqual(different.production_mix_id, first.production_mix_id);
  const state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.production.state, "imported");
  assert.equal(state.readiness.resolve_ready, false);
  assert.ok(fs.existsSync(path.join(state.dir, "production", "imports", first.production_mix_id, "mix.wav")));
});

test("score production: idempotent import refuses rewritten immutable provenance", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const bytes = makeWav();
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes }, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const provenancePath = path.join(state.dir, "production", "imports", imported.production_mix_id, "provenance.json");
  const record = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  record.render_contract_hash = "0".repeat(64);
  fs.writeFileSync(provenancePath, JSON.stringify(record, null, 2) + "\n");
  assert.throws(
    () => lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes }, { ...options, probeImpl: wavProbe }),
    /does not match its content identity/,
  );
});

test("score production: corrupt or contract-mismatched audio is rejected without a durable import", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "bad.wav", bytes: Buffer.from("not wav") }, { ...options, probeImpl: wavProbe }), /valid WAV/);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "wrong-rate.wav", bytes: makeWav() }, { ...options, probeImpl: () => ({ ok: true, sample_rate: 44100, channels: 2, codec: "pcm_s24le", duration: 3 }) }), /sample rate/);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "mono.wav", bytes: makeWav() }, { ...options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 1, codec: "pcm_s24le", duration: 3 }) }), /channel/);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "sixteen.wav", bytes: makeWav() }, { ...options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s16le", duration: 3 }) }), /bit depth/);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "short.wav", bytes: makeWav() }, { ...options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 2 }) }), /duration/);
  const dir = lane.getProject(project.project_id, options).dir;
  assert.ok(!fs.existsSync(path.join(dir, "production", "current.json")), "failed imports leave no current pointer");
});

test("score production: import requires a current hash-bound sketch approval", () => {
  const bare = tmpEnv();
  const { project } = lane.createScoreProject({ name: "No approval", duration_seconds: 3 }, bare.options);
  assert.throws(() => lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...bare.options, probeImpl: wavProbe }), /current sketch approval/);

  const stale = tmpEnv();
  const approved = approvedProject(stale.options);
  const state = lane.getProject(approved.project_id, stale.options);
  const cues = state.cue_sheet.cues.map((cue, i) => i === 0 ? { ...cue, tempo_bpm: cue.tempo_bpm + 1 } : cue);
  lane.saveCueSheetEdits(approved.project_id, cues, stale.options);
  assert.throws(() => lane.importProductionMix(approved.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...stale.options, probeImpl: wavProbe }), /current sketch approval/);
});

test("score production: verification binds exact audio and upstream authority", () => {
  const first = tmpEnv();
  const project = approvedProject(first.options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...first.options, probeImpl: wavProbe });
  const verified = lane.verifyProductionMix(project.project_id, { ...first.options, probeImpl: wavProbe });
  assert.equal(verified.verified, true);
  let state = lane.getProject(project.project_id, first.options);
  assert.equal(state.readiness.production.state, "verified");
  const mixPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav");
  fs.appendFileSync(mixPath, "tamper");
  state = lane.getProject(project.project_id, first.options);
  assert.equal(state.readiness.production.state, "stale");
  assert.ok(state.readiness.production.reasons.includes("production_mix_hash_mismatch"));

  const second = tmpEnv();
  const project2 = approvedProject(second.options);
  lane.importProductionMix(project2.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...second.options, probeImpl: wavProbe });
  lane.verifyProductionMix(project2.project_id, { ...second.options, probeImpl: wavProbe });
  const current = lane.getProject(project2.project_id, second.options);
  lane.saveCueSheetEdits(project2.project_id, current.cue_sheet.cues.map((cue, i) => i === 0 ? { ...cue, key: "E minor" } : cue), second.options);
  assert.equal(lane.getProject(project2.project_id, second.options).readiness.production.state, "stale");

  const raced = tmpEnv();
  const project3 = approvedProject(raced.options);
  lane.importProductionMix(project3.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...raced.options, probeImpl: wavProbe });
  assert.throws(() => lane.verifyProductionMix(project3.project_id, { ...raced.options, probeImpl: (file) => { const result = wavProbe(file); fs.appendFileSync(file, "race"); return result; } }), /changed during verification/);
  const racedState = lane.getProject(project3.project_id, raced.options);
  assert.equal(racedState.readiness.production.state, "imported", "only the disposable verification snapshot was mutated");
  assert.equal(racedState.readiness.production.verified, false);
});

test("score production: a generated REAPER handoff is approval-bound and corruption fails closed", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const built = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.sketch_approval_current, true);

  const bytes = fs.readFileSync(built.rpp);
  bytes[Math.min(100, bytes.length - 1)] ^= 1;
  fs.writeFileSync(built.rpp, bytes);

  state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.sketch_approval_current, false);
  assert.ok(state.readiness.approval_authority.reasons.includes("candidate_artifact_hash_mismatch"));
  assert.throws(
    () => lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe }),
    /current sketch approval/,
  );
});

test("score production: candidate render-contract metadata is checked against its identity", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const state = lane.getProject(project.project_id, options);
  const candidatePath = path.join(state.dir, "candidates", "candidate-001", "candidate.json");
  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  candidate.render_contract.target_duration_seconds -= 1;
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n");

  const changed = lane.getProject(project.project_id, options);
  assert.equal(changed.readiness.sketch_approval_current, false);
  assert.ok(changed.readiness.approval_authority.reasons.includes("render_contract_changed"));
});

test("score production: mutation during verification-record publication cannot return verified", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const mixPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav");
  const originalWrite = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = function mutateBeforeVerificationWrite(file, ...args) {
    if (!raced && String(file).includes("verification.json.tmp-")) {
      raced = true;
      fs.appendFileSync(mixPath, "race-after-inspection");
    }
    return originalWrite.call(fs, file, ...args);
  };
  try {
    assert.throws(
      () => lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe }),
      /changed during verification/,
    );
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(raced, true);
  assert.equal(fs.existsSync(path.join(path.dirname(mixPath), "verification.json")), false, "no stale verification authority remains");
});

test("score production: verification probes an immutable snapshot of the imported bytes", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const sourcePath = path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav");
  const verified = lane.verifyProductionMix(project.project_id, {
    ...options,
    probeImpl: (inspectedPath) => {
      assert.notEqual(inspectedPath, sourcePath, "ffprobe must inspect a controlled snapshot, not the mutable current pathname");
      assert.deepEqual(fs.readFileSync(inspectedPath), fs.readFileSync(sourcePath));
      return wavProbe(inspectedPath);
    },
  });
  assert.equal(verified.verified, true);
  assert.equal(fs.readdirSync(path.dirname(sourcePath)).some((name) => name.startsWith(".verify-")), false, "verification snapshots are cleaned");
});

test("score production: upstream mutation during verification publishes no verification authority", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  let mutated = false;
  assert.throws(() => lane.verifyProductionMix(project.project_id, {
    ...options,
    probeImpl: (file) => {
      const result = wavProbe(file);
      const state = lane.getProject(project.project_id, options);
      lane.saveCueSheetEdits(project.project_id, state.cue_sheet.cues.map((cue, index) => index ? cue : { ...cue, name: `${cue.name} changed` }), options);
      mutated = true;
      return result;
    },
  }), /current sketch approval|changed during production verification/);
  assert.equal(mutated, true);
  const state = lane.getProject(project.project_id, options);
  assert.equal(fs.existsSync(path.join(state.dir, "production", "imports", imported.production_mix_id, "verification.json")), false);
});

test("score production: malformed persisted current pointers fail closed inside project storage", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const pointerPath = path.join(state.dir, "production", "current.json");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  pointer.provenance_path = "approved/provenance.json";
  fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2) + "\n");
  const malformed = lane.getProject(project.project_id, options);
  assert.equal(malformed.readiness.production.state, "stale");
  assert.ok(malformed.readiness.production.reasons.includes("production_provenance_invalid"));
  assert.throws(() => lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe }), /No current production mix/);
});

test("score production: Resolve package requires current verification and copy hash remains authoritative", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  assert.throws(() => lane.prepareProductionResolvePackage(project.project_id, options), /verified production mix/);
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const prepared = lane.prepareProductionResolvePackage(project.project_id, options);
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.resolve_ready, true);
  fs.appendFileSync(path.join(state.dir, prepared.relative_dir, "mix.wav"), "tamper");
  state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.resolve_ready, false);
  assert.ok(state.readiness.production.reasons.includes("resolve_copy_hash_mismatch"));
});

test("score production: verification identities and Resolve pointers are self-authenticating", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const verificationPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "verification.json");
  const verification = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
  verification.detected_media.duration = 2.5;
  fs.writeFileSync(verificationPath, JSON.stringify(verification, null, 2) + "\n");
  assert.equal(lane.getProject(project.project_id, options).readiness.production.verified, false);

  verification.detected_media.duration = 3;
  verification.verification_identity = require("../score-engine/score-provenance.js").productionVerificationIdentity({
    productionMixSha256: verification.production_mix_sha256,
    approvedCandidateContentHash: verification.approved_candidate_content_hash,
    renderContractHash: verification.render_contract_hash,
    detectedMedia: verification.detected_media,
  });
  fs.writeFileSync(verificationPath, JSON.stringify(verification, null, 2) + "\n");
  const prepared = lane.prepareProductionResolvePackage(project.project_id, options);
  const pointerPath = path.join(state.dir, "production", "resolve", "current.json");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
  pointer.relative_dir = `${prepared.relative_dir}/../${imported.production_mix_id}`;
  fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2) + "\n");
  assert.equal(lane.getProject(project.project_id, options).readiness.resolve_ready, false);
});

test("score production: Resolve markers are bound to the approved marker bytes across copy races", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const markerPath = path.join(state.dir, "approved", "resolve-import", "cue-markers.csv");
  const originalMarkers = fs.readFileSync(markerPath);
  const originalCopy = fs.copyFileSync;
  let raced = false;
  fs.copyFileSync = function substituteMarkersDuringCopy(source, destination, ...args) {
    if (!raced && String(source) === markerPath) {
      raced = true;
      fs.writeFileSync(markerPath, 'Name,Start (seconds),End (seconds)\n"WRONG",0,3\n');
      try { return originalCopy.call(fs, source, destination, ...args); }
      finally { fs.writeFileSync(markerPath, originalMarkers); }
    }
    return originalCopy.call(fs, source, destination, ...args);
  };
  try {
    assert.throws(() => lane.prepareProductionResolvePackage(project.project_id, options), /cue markers changed/i);
  } finally {
    fs.copyFileSync = originalCopy;
  }
  assert.equal(raced, true);
  assert.equal(lane.getProject(project.project_id, options).readiness.resolve_ready, false);
});

test("score production API: nonce-gated base64 upload accepts bytes and never accepts a server path", async () => {
  assert.equal(typeof packageEngineServer.createServer, "function");
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const oldSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const oldRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer({ scoreEngine: { probeImpl: wavProbe } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const nonce = packageEngineServer.localWriteNonce();
    const request = (body) => new Promise((resolve, reject) => {
      const bytes = Buffer.from(JSON.stringify(body));
      const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: "/api/score/production/import", method: "POST", headers: { Host: "127.0.0.1:8010", "Content-Type": "application/json", "Content-Length": bytes.length, "x-vidtoolz-local-write-nonce": nonce } }, (res) => { let raw = ""; res.on("data", (c) => { raw += c; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) })); });
      req.on("error", reject); req.end(bytes);
    });
    const denied = await request({ project_id: project.project_id, original_filename: "mix.wav", path: "/tmp/mix.wav" });
    assert.notEqual(denied.status, 200);
    const accepted = await request({ project_id: project.project_id, original_filename: "mix.wav", data_base64: makeWav().toString("base64") });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = oldSettings;
    if (oldRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT; else process.env.SCORE_ENGINE_MUSIC_ROOT = oldRoot;
  }
});

test("score production API: import rejects non-JSON content types and unsafe filename metadata", async () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const oldSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const oldRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer({ scoreEngine: { probeImpl: wavProbe } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const send = (body, contentType = "application/json") => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: "/api/score/production/import", method: "POST", headers: { Host: "127.0.0.1:8010", "Content-Type": contentType, "Content-Length": bytes.length, "x-vidtoolz-local-write-nonce": packageEngineServer.localWriteNonce() } }, (res) => { let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) })); });
    req.on("error", reject); req.end(bytes);
  });
  try {
    const payload = { project_id: project.project_id, original_filename: "mix.wav", data_base64: makeWav().toString("base64") };
    assert.equal((await send(payload, "text/plain")).status, 415);
    assert.equal((await send({ ...payload, original_filename: "../mix.wav" })).status, 400);
    assert.equal((await send({ ...payload, original_filename: "C:\\temp\\mix.wav" })).status, 400);
    assert.equal((await send({ ...payload, original_filename: "bad\u0000.wav" })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH; else process.env.SCORE_ENGINE_SETTINGS_PATH = oldSettings;
    if (oldRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT; else process.env.SCORE_ENGINE_MUSIC_ROOT = oldRoot;
  }
});

test("score production UI keeps sketch approval, production verification, and Resolve delivery distinct", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.match(html, />Approve sketch</);
  assert.match(html, />Import production render</);
  assert.match(html, />Verify production mix</);
  assert.match(html, />Prepare Resolve package</);
  assert.match(html, /Sketch audio is never promoted to Resolve-ready/);
});
