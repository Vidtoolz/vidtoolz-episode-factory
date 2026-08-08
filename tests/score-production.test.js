// Scorecraft DAW production-mix return gate. All files live in temp projects;
// probes are injected and no DAW, ffprobe binary, or real project is touched.
const { assert, fs, http, os, path, packageEngineServer, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const provenance = require("../score-engine/score-provenance.js");
const synth = require("../score-engine/preview-synth.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-production-"));
  return {
    root,
    options: {
      settingsPath: path.join(root, "settings.json"),
      musicRoot: path.join(root, "music"),
      productionSignalProbeImpl: () => ({
        ok: true,
        analyzer: "ffmpeg_astats_v1",
        peak_dbfs: -12,
        rms_dbfs: -24,
        dc_offset: 0,
        sample_count: 144000,
      }),
    },
  };
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

function approvedProject(options, duration = 3, { issueHandoff = true, durationExact } = {}) {
  const { project } = lane.createScoreProject({ name: "Production Gate", duration_seconds: duration }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options,
    durationExact === undefined ? {} : { durationExact });
  if (issueHandoff) lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  return project;
}

function approveListening(projectId, options, authorityBasis = "Test operator listened to the exact imported render.") {
  const production = lane.getProject(projectId, options).readiness.production;
  return lane.reviewProductionMix(projectId, {
    decision: "approved",
    expected_production_mix_sha256: production.production_mix_sha256,
    authority_basis: authorityBasis,
  }, options);
}

test("score production P3: a DAW return requires an issued handoff contract", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options, 3, { issueHandoff: false });
  const state = lane.getProject(project.project_id, options);
  fs.writeFileSync(path.join(state.dir, "candidates", "candidate-001", "untrusted.json"), JSON.stringify({
    claimed_handoff: { hash: "a".repeat(64), filename: `${"a".repeat(64)}.wav` },
  }));
  assert.throws(
    () => lane.importProductionMix(project.project_id, { original_filename: "unbound.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /DAW handoff/i.test(error.message),
  );
});

test("score production P3: a symlink cannot substitute the issued handoff receipt", () => {
  const { root, options } = tmpEnv();
  const project = approvedProject(options);
  const state = lane.getProject(project.project_id, options);
  const issued = state.approved.daw_handoffs.reaper;
  const recordPath = path.join(state.dir, "candidates", "candidate-001", "reaper", "handoff-contract.json");
  const external = path.join(root, "external-handoff.json");
  fs.renameSync(recordPath, external);
  fs.symlinkSync(external, recordPath);
  assert.throws(
    () => lane.importProductionMix(project.project_id, {
      original_filename: "mix.wav", bytes: makeWav(), handoff_type: "reaper",
      handoff_contract_hash: issued.handoff_contract_hash,
    }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /No issued|handoff/i.test(error.message),
  );
});

test("score production P3: correct return receipt binds exact bytes through readiness and Resolve", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const state = lane.getProject(project.project_id, options);
  const issued = state.approved.daw_handoffs.reaper;
  const bytes = makeWav();
  const imported = lane.importProductionMix(project.project_id, {
    original_filename: "arbitrary-operator-name.wav", bytes,
    handoff_type: "reaper", handoff_contract_hash: issued.handoff_contract_hash,
  }, { ...options, probeImpl: wavProbe });
  const importedState = lane.getProject(project.project_id, options);
  const importDir = path.join(importedState.dir, "production", "imports", imported.production_mix_id);
  const receipt = JSON.parse(fs.readFileSync(path.join(importDir, "provenance.json"), "utf8"));
  assert.equal(receipt.source_type, "external_daw_return");
  assert.equal(receipt.daw_handoff_contract_hash, issued.handoff_contract_hash);
  assert.equal(receipt.imported_file_sha256, provenance.sha256(bytes));
  const verification = lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  assert.equal(lane.getProject(project.project_id, options).readiness.production.state, "technical_verified");
  approveListening(project.project_id, options);
  lane.prepareProductionResolvePackage(project.project_id, options);
  const resolveReceipt = JSON.parse(fs.readFileSync(path.join(
    importedState.dir, "production", "resolve", imported.production_mix_id, "resolve-provenance.json",
  ), "utf8"));
  assert.equal(resolveReceipt.daw_handoff_contract_hash, verification.daw_handoff_contract_hash);
  assert.equal(resolveReceipt.source_production_mix_sha256, receipt.imported_file_sha256);
});

test("score production P3: wrong or ambiguous handoff identity is rejected explicitly", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const reaper = lane.getProject(project.project_id, options).approved.daw_handoffs.reaper;
  const ableton = lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
  const input = { original_filename: "mix.wav", bytes: makeWav() };
  assert.throws(
    () => lane.importProductionMix(project.project_id, input, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 400 && /select reaper or ableton/i.test(error.message),
  );
  assert.throws(
    () => lane.importProductionMix(project.project_id, {
      ...input, handoff_type: "reaper", handoff_contract_hash: ableton.handoff_contract_hash,
    }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /stale|modified|does not match/i.test(error.message),
  );
  assert.notEqual(reaper.handoff_contract_hash, ableton.handoff_contract_hash);
});

test("score production P3: an old candidate handoff cannot authorize the current candidate", () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({ name: "Candidate switch", duration_seconds: 3 }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  lane.generateCandidates(project.project_id, { count: 2 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  const old = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  lane.approveCandidate(project.project_id, "candidate-002", options);
  assert.throws(
    () => lane.importProductionMix(project.project_id, {
      original_filename: "old.wav", bytes: makeWav(), handoff_type: "reaper",
      handoff_contract_hash: old.handoff_contract_hash,
    }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /current approved candidate|no issued/i.test(error.message),
  );
});

test("score production P3: handoff bytes and semantic receipt fields fail closed when tampered", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options, 3, { issueHandoff: false });
  const ableton = lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
  const state = lane.getProject(project.project_id, options);
  const recordPath = path.join(state.dir, "candidates", "candidate-001", "ableton", "handoff-contract.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  record.untrusted = { copied_hash: ableton.handoff_contract_hash };
  record.handoff_contract.untrusted = { copied_hash: ableton.handoff_contract_hash };
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  assert.throws(
    () => lane.importProductionMix(project.project_id, {
      original_filename: "mix.wav", bytes: makeWav(), handoff_type: "ableton",
      handoff_contract_hash: ableton.handoff_contract_hash,
    }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /stale|modified/i.test(error.message),
  );

  const fresh = lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
  fs.appendFileSync(path.join(state.dir, "candidates", "candidate-001", "ableton", "README.md"), "tamper");
  assert.throws(
    () => lane.importProductionMix(project.project_id, {
      original_filename: `${fresh.handoff_contract_hash}.wav`, bytes: makeWav(), handoff_type: "ableton",
      handoff_contract_hash: fresh.handoff_contract_hash,
    }, { ...options, probeImpl: wavProbe }),
    (error) => error.statusCode === 409 && /stale|modified/i.test(error.message),
  );
});

test("score production P3: exact and tail-preserving duration contracts are enforced", () => {
  const exactEnv = tmpEnv();
  const exact = approvedProject(exactEnv.options);
  assert.throws(
    () => lane.importProductionMix(exact.project_id, { original_filename: "long.wav", bytes: makeWav() }, {
      ...exactEnv.options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 3.2 }),
    }), /duration/,
  );

  const tailEnv = tmpEnv();
  const tail = approvedProject(tailEnv.options, 3, { durationExact: false });
  const tailState = lane.getProject(tail.project_id, tailEnv.options);
  const tailContract = JSON.parse(fs.readFileSync(path.join(
    tailState.dir, "candidates", "candidate-001", "reaper", "handoff-contract.json",
  ), "utf8"));
  assert.equal(tailContract.handoff_contract.audio_contract.maximum_tail_seconds, 1);
  assert.match(fs.readFileSync(path.join(
    tailState.dir, "candidates", "candidate-001", "reaper", "project.rpp",
  ), "utf8"), /RENDER_RANGE 0 0 4 18 1000/);
  const validTail = lane.importProductionMix(tail.project_id, { original_filename: "tail.wav", bytes: makeWav(3.8) }, {
    ...tailEnv.options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 3.8 }),
  });
  assert.match(validTail.production_mix_id, /^production-/);
  assert.throws(
    () => lane.importProductionMix(tail.project_id, { original_filename: "short.wav", bytes: makeWav() }, {
      ...tailEnv.options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 2.8 }),
    }), /duration/,
  );
  assert.throws(
    () => lane.importProductionMix(tail.project_id, { original_filename: "excessive-tail.wav", bytes: makeWav() }, {
      ...tailEnv.options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 4.2 }),
    }), /duration/,
  );
});

test("score production P3: verification hashes returned audio through the streamed file path", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const bytes = makeWav(24);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "large.wav", bytes }, {
    ...options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 3 }),
  });
  const state = lane.getProject(project.project_id, options);
  const sourcePath = path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav");
  assert.ok(fs.statSync(sourcePath).size > 5 * 1024 * 1024);
  const originalRead = fs.readFileSync;
  fs.readFileSync = function rejectWholeAudioRead(file, ...args) {
    if (path.basename(String(file)) === "mix.wav") throw new Error("whole audio read forbidden");
    return originalRead.call(fs, file, ...args);
  };
  try {
    const verified = lane.verifyProductionMix(project.project_id, {
      ...options, probeImpl: () => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 3 }),
    });
    assert.equal(verified.verified, true);
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("score production P3: receipt tampering revokes readiness even when audio bytes are unchanged", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, {
    ...options, probeImpl: wavProbe,
  });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  const receiptPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "provenance.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.daw_handoff_contract_hash = "f".repeat(64);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  const tampered = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(tampered.state, "stale");
  assert.ok(tampered.reasons.includes("daw_handoff_stale"));
});

test("score production P3: handoff mutation after verification blocks readiness and Resolve", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options, 3, { issueHandoff: false });
  const ableton = lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
  lane.importProductionMix(project.project_id, {
    original_filename: "mix.wav", bytes: makeWav(), handoff_type: "ableton",
    handoff_contract_hash: ableton.handoff_contract_hash,
  }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const state = lane.getProject(project.project_id, options);
  fs.appendFileSync(path.join(state.dir, "candidates", "candidate-001", "ableton", "README.md"), "changed after verification");
  const stale = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(stale.state, "stale");
  assert.ok(stale.reasons.includes("daw_handoff_stale"));
  assert.throws(
    () => lane.prepareProductionResolvePackage(project.project_id, options),
    (error) => error.statusCode === 409 && /handoff|stale|modified/i.test(error.message),
  );
});

test("score production P3: REAPER and Ableton builders issue semantic handoff identities", () => {
  for (const handoffType of ["reaper", "ableton"]) {
    const { options } = tmpEnv();
    const project = approvedProject(options);
    const built = handoffType === "reaper"
      ? lane.buildReaperHandoff(project.project_id, "candidate-001", options)
      : lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
    assert.match(built.handoff_contract_hash, /^[a-f0-9]{64}$/, `${handoffType} contract identity`);
    assert.match(built.approved_identity_hash, /^[a-f0-9]{64}$/, `${handoffType} approval binding`);
    const rebuilt = handoffType === "reaper"
      ? lane.buildReaperHandoff(project.project_id, "candidate-001", options)
      : lane.buildAbletonHandoff(project.project_id, "candidate-001", options);
    assert.equal(rebuilt.handoff_contract_hash, built.handoff_contract_hash,
      `${handoffType} semantic state must regenerate the same contract identity`);
  }
});

test("score production P4: REAPER handoff binds a deterministic playable reference realization", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const first = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  const state = lane.getProject(project.project_id, options);
  const handoffDir = path.join(state.dir, "candidates", "candidate-001", "reaper");
  const receipt = JSON.parse(fs.readFileSync(path.join(handoffDir, "handoff-contract.json"), "utf8"));
  const realization = receipt.handoff_contract.realization_contract;
  assert.equal(realization.mode, "hybrid");
  assert.equal(realization.reference_profile.profile_id, "scorecraft_reasynth_reference_v1");
  assert.equal(realization.reference_profile.playability, "playable");
  assert.equal(realization.reference_profile.render_purpose, "reference");
  assert.equal(realization.reference_profile.plugin.identifier, "ReaSynth (Cockos)");
  assert.equal(realization.production_profile.playability, "requires_manual_patching");
  const script = fs.readFileSync(path.join(handoffDir, "build-scorecraft-reference.lua"), "utf8");
  assert.match(script, /TrackFX_AddByName\(track, PLUGIN_IDENTIFIER/);
  assert.match(script, /TrackFX_SetParamNormalized/);
  assert.match(script, /B_MAINSEND/);
  assert.match(script, /CountTrackMediaItems/);
  assert.match(script, /required plugin unavailable/);
  assert.match(script, /expected musical role has no playable MIDI path/);
  const second = lane.buildReaperHandoff(project.project_id, "candidate-001", options);
  assert.equal(second.handoff_contract_hash, first.handoff_contract_hash);
  assert.equal(second.realization.reference_profile.profile_id, "scorecraft_reasynth_reference_v1");
});

test("score production P4: technical QC rejects silence and hard clipping, then records healthy metrics", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  assert.throws(
    () => lane.verifyProductionMix(project.project_id, {
      ...options,
      probeImpl: wavProbe,
      productionSignalProbeImpl: () => ({ ok: true, analyzer: "ffmpeg_astats_v1", peak_dbfs: -Infinity, rms_dbfs: -Infinity, dc_offset: 0, sample_count: 144000 }),
    }),
    (error) => error.statusCode === 422 && /silent|audible/i.test(error.message),
  );
  assert.throws(
    () => lane.verifyProductionMix(project.project_id, {
      ...options,
      probeImpl: wavProbe,
      productionSignalProbeImpl: () => ({ ok: true, analyzer: "ffmpeg_astats_v1", peak_dbfs: 0, rms_dbfs: -4, dc_offset: 0, sample_count: 144000 }),
    }),
    (error) => error.statusCode === 422 && /clipp/i.test(error.message),
  );
  assert.throws(
    () => lane.verifyProductionMix(project.project_id, {
      ...options,
      probeImpl: wavProbe,
      productionSignalProbeImpl: () => ({ ok: true, analyzer: "ffmpeg_astats_v1", peak_dbfs: -12, rms_dbfs: -24, dc_offset: 0.3, sample_count: 144000 }),
    }),
    (error) => error.statusCode === 422 && /DC offset/i.test(error.message),
  );
  assert.throws(
    () => lane.verifyProductionMix(project.project_id, {
      ...options,
      probeImpl: wavProbe,
      productionSignalProbeImpl: () => ({ ok: false, reason: "analyzer unavailable" }),
    }),
    (error) => error.statusCode === 503 && /could not complete/i.test(error.message),
  );
  const verified = lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  assert.equal(verified.technical_analysis.audible, true);
  assert.equal(verified.technical_analysis.clipping_detected, false);
  assert.equal(verified.technical_analysis.peak_dbfs, -12);
  assert.equal(verified.technical_analysis.rms_dbfs, -24);
});

test("score production P4: listening approval is exact-byte bound and gates Resolve", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  const verified = lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  let production = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(production.state, "technical_verified");
  assert.equal(production.technical_verified, true);
  assert.equal(production.listening_status, "pending");
  assert.equal(production.production_ready, false);
  assert.throws(
    () => lane.prepareProductionResolvePackage(project.project_id, options),
    (error) => error.statusCode === 409 && /listening approval/i.test(error.message),
  );
  assert.throws(
    () => lane.reviewProductionMix(project.project_id, {
      decision: "approved", expected_production_mix_sha256: "f".repeat(64), authority_basis: "Listened to the exact imported render.",
    }, options),
    (error) => error.statusCode === 409 && /changed|expected|stale/i.test(error.message),
  );
  const review = lane.reviewProductionMix(project.project_id, {
    decision: "approved",
    expected_production_mix_sha256: verified.production_mix_sha256,
    authority_basis: "Listened to the exact imported render.",
  }, options);
  assert.equal(review.production_mix_id, imported.production_mix_id);
  assert.equal(review.production_mix_sha256, verified.production_mix_sha256);
  assert.match(review.review_identity, /^[a-f0-9]{64}$/);
  production = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(production.state, "production_ready");
  assert.equal(production.listening_status, "approved");
  assert.equal(production.production_ready, true);
  lane.prepareProductionResolvePackage(project.project_id, options);

  const state = lane.getProject(project.project_id, options);
  const reviewPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "listening-review.json");
  const tamperedReview = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  tamperedReview.authority_basis = "Copied approval text without a matching receipt identity.";
  fs.writeFileSync(reviewPath, JSON.stringify(tamperedReview, null, 2) + "\n");
  production = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(production.production_ready, false);
  assert.equal(production.listening_status, "pending");
  assert.equal(production.resolve_ready, false);
  fs.appendFileSync(path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav"), "mutated");
  production = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(production.production_ready, false);
  assert.notEqual(production.listening_status, "approved");
});

test("score production P4: rejection is distinct from technical QC and review publication fails stale on a byte race", () => {
  const rejectedEnv = tmpEnv();
  const rejectedProject = approvedProject(rejectedEnv.options);
  lane.importProductionMix(rejectedProject.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...rejectedEnv.options, probeImpl: wavProbe });
  const rejectedVerification = lane.verifyProductionMix(rejectedProject.project_id, { ...rejectedEnv.options, probeImpl: wavProbe });
  lane.reviewProductionMix(rejectedProject.project_id, {
    decision: "rejected",
    expected_production_mix_sha256: rejectedVerification.production_mix_sha256,
    authority_basis: "Routing is valid, but this realization needs revision.",
  }, rejectedEnv.options);
  const rejected = lane.getProject(rejectedProject.project_id, rejectedEnv.options).readiness.production;
  assert.equal(rejected.technical_verified, true);
  assert.equal(rejected.listening_status, "rejected");
  assert.equal(rejected.production_ready, false);

  const racedEnv = tmpEnv();
  const racedProject = approvedProject(racedEnv.options);
  const imported = lane.importProductionMix(racedProject.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...racedEnv.options, probeImpl: wavProbe });
  const verified = lane.verifyProductionMix(racedProject.project_id, { ...racedEnv.options, probeImpl: wavProbe });
  const state = lane.getProject(racedProject.project_id, racedEnv.options);
  const mixPath = path.join(state.dir, "production", "imports", imported.production_mix_id, "mix.wav");
  const originalWrite = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = function mutateBeforeListeningReviewWrite(file, ...args) {
    if (!raced && String(file).includes("listening-review.json.tmp-")) {
      raced = true;
      fs.appendFileSync(mixPath, "changed-after-listening");
    }
    return originalWrite.call(fs, file, ...args);
  };
  try {
    assert.throws(() => lane.reviewProductionMix(racedProject.project_id, {
      decision: "approved",
      expected_production_mix_sha256: verified.production_mix_sha256,
      authority_basis: "Listened before the race.",
    }, racedEnv.options), (error) => error.statusCode === 409 && /changed/i.test(error.message));
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(raced, true);
  assert.equal(fs.existsSync(path.join(path.dirname(mixPath), "listening-review.json")), false);
});

test("score production P4: reference realization can pass technical QC but cannot masquerade as production", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const issued = lane.getProject(project.project_id, options).approved.daw_handoffs.reaper;
  lane.importProductionMix(project.project_id, {
    original_filename: "reference.wav",
    bytes: makeWav(),
    handoff_type: "reaper",
    handoff_contract_hash: issued.handoff_contract_hash,
    render_purpose: "reference",
    realization_profile_id: "scorecraft_reasynth_reference_v1",
  }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  const production = lane.getProject(project.project_id, options).readiness.production;
  assert.equal(production.state, "reference_verified");
  assert.equal(production.render_purpose, "reference");
  assert.equal(production.technical_verified, true);
  assert.equal(production.production_ready, false);
  assert.throws(
    () => lane.prepareProductionResolvePackage(project.project_id, options),
    (error) => error.statusCode === 409 && /reference|production/i.test(error.message),
  );
});

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
  assert.equal(state.readiness.production.state, "technical_verified");
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

test("score production: a verified replacement remains current while the prior Resolve pointer is stale", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  lane.importProductionMix(project.project_id, { original_filename: "v1.wav", bytes: makeWav(3, 48000, 24, 0.1) }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  approveListening(project.project_id, options);
  lane.prepareProductionResolvePackage(project.project_id, options);

  const replacement = lane.importProductionMix(project.project_id, { original_filename: "v2.wav", bytes: makeWav(3, 48000, 24, 0.2) }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });

  const state = lane.getProject(project.project_id, options);
  assert.equal(state.readiness.production.production_mix_id, replacement.production_mix_id);
  assert.equal(state.readiness.production.state, "technical_verified");
  assert.equal(state.readiness.production.current, true);
  assert.equal(state.readiness.production.verified, true);
  assert.equal(state.readiness.production.resolve_ready, false);
  assert.ok(state.readiness.production.reasons.includes("resolve_copy_missing"));
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

test("score production: render-contract settings mutation during verification publishes no authority", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  assert.throws(() => lane.verifyProductionMix(project.project_id, {
    ...options,
    probeImpl: (file) => {
      const result = wavProbe(file);
      lane.saveSettings({ default_export_sample_rate: 44100 }, options);
      return result;
    },
  }), /current sketch approval|render contract changed/i);
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
  approveListening(project.project_id, options);
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
    technicalAnalysis: verification.technical_analysis,
    handoffContractHash: verification.daw_handoff_contract_hash,
    approvedIdentityHash: verification.approved_identity_hash,
    renderPurpose: verification.render_purpose,
    realizationProfileId: verification.realization_profile_id,
  });
  fs.writeFileSync(verificationPath, JSON.stringify(verification, null, 2) + "\n");
  approveListening(project.project_id, options);
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
  approveListening(project.project_id, options);
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

test("score production: Resolve destination corruption before pointer publication returns no trusted success", () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const imported = lane.importProductionMix(project.project_id, { original_filename: "mix.wav", bytes: makeWav() }, { ...options, probeImpl: wavProbe });
  lane.verifyProductionMix(project.project_id, { ...options, probeImpl: wavProbe });
  approveListening(project.project_id, options);
  const state = lane.getProject(project.project_id, options);
  const destinationMix = path.join(state.dir, "production", "resolve", imported.production_mix_id, "mix.wav");
  const originalWrite = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = function corruptBeforeResolvePointer(file, ...args) {
    if (!raced && String(file).includes(`${path.sep}production${path.sep}resolve${path.sep}current.json.tmp-`)) {
      raced = true;
      fs.appendFileSync(destinationMix, "race-before-pointer");
    }
    return originalWrite.call(fs, file, ...args);
  };
  try {
    assert.throws(
      () => lane.prepareProductionResolvePackage(project.project_id, options),
      /changed|failed provenance|not made current/i,
    );
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(raced, true);
  assert.equal(lane.getProject(project.project_id, options).readiness.resolve_ready, false);
  assert.equal(fs.existsSync(path.join(state.dir, "production", "resolve", "current.json")), false);
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
    const issued = lane.getProject(project.project_id, options).approved.daw_handoffs.reaper;
    const accepted = await request({
      project_id: project.project_id,
      original_filename: "mix.wav",
      data_base64: makeWav().toString("base64"),
      handoff_type: "reaper",
      handoff_contract_hash: issued.handoff_contract_hash,
    });
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

test("score production P4 API: technical verification and exact-hash listening review use the public boundary", async () => {
  const { options } = tmpEnv();
  const project = approvedProject(options);
  const oldSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const oldRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer({ scoreEngine: {
    probeImpl: wavProbe,
    productionSignalProbeImpl: options.productionSignalProbeImpl,
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const post = (pathname, body) => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: pathname, method: "POST", headers: { Host: "127.0.0.1:8010", "Content-Type": "application/json", "Content-Length": bytes.length, "x-vidtoolz-local-write-nonce": packageEngineServer.localWriteNonce() } }, (res) => { let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) })); });
    req.on("error", reject); req.end(bytes);
  });
  try {
    const issued = lane.getProject(project.project_id, options).approved.daw_handoffs.reaper;
    assert.equal((await post("/api/score/production/import", {
      project_id: project.project_id, original_filename: "mix.wav", data_base64: makeWav().toString("base64"),
      handoff_type: "reaper", handoff_contract_hash: issued.handoff_contract_hash,
      render_purpose: "production", realization_profile_id: "operator_patched_production_v1",
      technical_analysis: { caller_claim: "must be ignored" },
    })).status, 200);
    const verified = await post("/api/score/production/verify", { project_id: project.project_id });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const verificationResult = verified.body.data || verified.body;
    assert.equal((await post("/api/score/production/review", {
      project_id: project.project_id, decision: "approved", expected_production_mix_sha256: "f".repeat(64), authority_basis: "Wrong bytes.",
    })).status, 409);
    const reviewed = await post("/api/score/production/review", {
      project_id: project.project_id, decision: "approved", expected_production_mix_sha256: verificationResult.production_mix_sha256,
      authority_basis: "Listened through the public Scorecraft production route.",
    });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(lane.getProject(project.project_id, options).readiness.production.production_ready, true);
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
  assert.match(html, />Approve exact mix after listening</);
  assert.match(html, /SCORE_PRODUCTION_REVIEW_API/);
  assert.match(html, /expected_production_mix_sha256:P\.production_mix_sha256/);
  assert.match(html, /reference_verified/);
  assert.match(html, />Prepare Resolve package</);
  assert.match(html, /id="production-handoff"/);
  assert.match(html, /handoff_contract_hash:handoff\.dataset\.contract/);
  assert.match(html, /Sketch audio is never promoted to Resolve-ready/);
});
