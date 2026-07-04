/**
 * VIDTOOLZ Episode Factory Tests — Supervised Capture
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: supervised-capture.js and CLI script
 */

const {
  assert,
  childProcess,
  fs,
  os,
  path,
  model,
  storage,
  packageEngine,
  packageRun,
  packageRunScript,
  packageOutlineScript,
  packageScriptPrepScript,
  packageProductionPrepScript,
  packageResearchPackScript,
  packageResearchEvidenceScript,
  packageScriptStructureScript,
  packageScriptReviewScript,
  packageProductionPlanScript,
  packageShotEditPlanReviewScript,
  packageCaptureChecklistScript,
  packageCaptureEvidenceReviewScript,
  packageCaptureGapScript,
  packageRunEvidenceLintScript,
  packageArtifactHygieneScript,
  packageRoughCutReviewScript,
  packageFinalReviewScript,
  packageRepurposeScript,
  packageBrollPromptsScript,
  packageExportChecklistScript,
  packagePublicationMetadataScript,
  packageArchiveManifestScript,
  packageRunCreatorQaScript,
  packageRunDoctorScript,
  packageRunNextActionScript,
  packageRunNextSafeActionScript,
  packageRunNextActionAuthorityScript,
  packageRunWorkflowMapScript,
  nextTaskClassifierScript,
  packageRunActiveStateAuditScript,
  packageRunStateProposalScript,
  packageProductionApprovalRepairScript,
  packageProductionApprovalReviewScript,
  packageRunsIndexScript,
  packageRunsDashboardLaunchScript,
  scriptImageAssetsDryRunScript,
  scriptImageAssetsReviewPageScript,
  topicScoutScript,
  oneOfTenInputHelper,
  packageEngineServer,
  packageRunsDashboard,
  episodeFactoryCli,
  proposalLoopGuard,
  proposalLoopRunner,
  trailerCueGenerator,
  trailerCueScript,
  musicCueGenerator,
  musicCueScript,
  supervisedCapture,
  supervisedCaptureScript,
  earthStudioJobPlanner,
  earthStudioJobScript,
  publishedVideosValidator,
  tests,
  test,
  captureConsole,
  createMemoryStorage,
  runGitCommand,
  writeTestFile,
  createNextSafeActionFixture,
  createNextTaskClassifierFixture,
  escapeRegExp,
  readJsonFile,
  createProposalGuardRepo,
  inspectProposalGuardRepo,
  runProposalGuardCommandPreflight,

} = require("./_helpers.js");


function createProcFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-proc-"));
  const pid = String(options.pid || 43210);
  const pidDir = path.join(root, pid);
  fs.mkdirSync(pidDir, { recursive: true });
  const cmdline = options.cmdline || ["ffmpeg", "-i", ":0.0", options.outputFile || "/tmp/capture.mp4"];
  fs.writeFileSync(path.join(pidDir, "cmdline"), `${cmdline.join("\0")}\0`, "utf8");
  const fieldsAfterComm = ["S"];
  while (fieldsAfterComm.length < 20) fieldsAfterComm.push("0");
  fieldsAfterComm[19] = String(options.startTime || "987654321");
  fs.writeFileSync(path.join(pidDir, "stat"), `${pid} (ffmpeg) ${fieldsAfterComm.join(" ")}\n`, "utf8");
  return { root, pid: Number(pid) };
}

function mockCommandRunner(commands = {}) {
  return (command, args = []) => {
    const key = [command, ...args].join(" ");
    if (commands[key]) return commands[key];
    if (command === "sh" && args[1] === "command -v ffmpeg") return { status: 0, stdout: "/usr/bin/ffmpeg\n", stderr: "" };
    if (command === "sh" && args[1] === "command -v ffprobe") return { status: 1, stdout: "", stderr: "" };
    if (command === "sh" && args[1] === "command -v pactl") return { status: 1, stdout: "", stderr: "" };
    if (command === "sh" && args[1] === "command -v xrandr") return { status: 1, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
}

test("supervised capture filename and sidecar use approved convention", () => {
  const paths = supervisedCapture.buildCapturePaths({
    profile: "vidnux-screen-4k30-noaudio",
    outputDir: "/tmp/captures",
    timestamp: "20260526-143012",
  });

  assert.equal(paths.captureId, "VT_capture_vidnux_20260526-143012_profile-screen-4k30");
  assert.equal(path.basename(paths.outputFile), "VT_capture_vidnux_20260526-143012_profile-screen-4k30.mp4");
  assert.equal(path.basename(paths.metadataFile), "VT_capture_vidnux_20260526-143012_profile-screen-4k30.json");
  assert.equal(supervisedCapture.inferMetadataPath(paths.outputFile), paths.metadataFile);
});

test("supervised capture primary noaudio command uses full 4k geometry", () => {
  const command = supervisedCapture.buildFfmpegCommand({
    profile: "vidnux-screen-4k30-noaudio",
    outputFile: "/tmp/capture.mp4",
    display: ":0.0",
  });

  assert.equal(command[0], "ffmpeg");
  assert.match(command.join(" "), /x11grab/);
  assert.match(command.join(" "), /3840x2160/);
  assert.doesNotMatch(command.join(" "), /pulse/);
  assert.equal(command[command.length - 1], "/tmp/capture.mp4");
});

test("supervised capture primary mic command uses full 4k geometry and explicit audio source", () => {
  const command = supervisedCapture.buildFfmpegCommand({
    profile: "vidnux-screen-4k30-mic",
    micSource: "alsa_input.test-mic",
    outputFile: "/tmp/capture.mp4",
    display: ":0.0",
  });

  assert.match(command.join(" "), /3840x2160/);
  assert.match(command.join(" "), /pulse/);
  assert.match(command.join(" "), /alsa_input\.test-mic/);
});

test("supervised capture system audio command requires and uses explicit monitor source", () => {
  assert.throws(
    () =>
      supervisedCapture.buildFfmpegCommand({
        profile: "vidnux-screen-4k30-systemaudio",
        outputFile: "/tmp/capture.mp4",
        display: ":0.0",
      }),
    /System audio source is required/
  );

  const command = supervisedCapture.buildFfmpegCommand({
    profile: "vidnux-screen-4k30-systemaudio",
    systemAudioSource: "alsa_output.pci-test.monitor",
    outputFile: "/tmp/capture.mp4",
    display: ":0.0",
  });

  assert.match(command.join(" "), /3840x2160/);
  assert.match(command.join(" "), /alsa_output\.pci-test\.monitor/);
  assert.doesNotMatch(command.join(" "), /amix/);
});

test("supervised capture systemaudio mic command uses both audio inputs and amix", () => {
  assert.throws(
    () =>
      supervisedCapture.buildFfmpegCommand({
        profile: "vidnux-screen-4k30-systemaudio-mic",
        systemAudioSource: "alsa_output.pci-test.monitor",
        outputFile: "/tmp/capture.mp4",
        display: ":0.0",
      }),
    /Microphone source is required/
  );

  const command = supervisedCapture.buildFfmpegCommand({
    profile: "vidnux-screen-4k30-systemaudio-mic",
    systemAudioSource: "alsa_output.pci-test.monitor",
    micSource: "alsa_input.usb-test-mic",
    outputFile: "/tmp/capture.mp4",
    display: ":0.0",
  });

  assert.match(command.join(" "), /alsa_output\.pci-test\.monitor/);
  assert.match(command.join(" "), /alsa_input\.usb-test-mic/);
  assert.match(command.join(" "), /filter_complex/);
  assert.match(command.join(" "), /amix=inputs=2/);
  assert.match(command.join(" "), /-map 0:v -map \[aout\]/);
});

test("supervised capture mic profile requires explicit audio source", () => {
  assert.throws(
    () =>
      supervisedCapture.buildFfmpegCommand({
        profile: "vidnux-screen-4k30-mic",
        outputFile: "/tmp/capture.mp4",
        display: ":0.0",
      }),
    /Microphone source is required/
  );
});

test("supervised capture preflight lists audio candidates without choosing one", () => {
  const runner = mockCommandRunner({
    "sh -lc command -v pactl": { status: 0, stdout: "/usr/bin/pactl\n", stderr: "" },
    "pactl list short sources": {
      status: 0,
      stdout: "1\talsa_input.usb-Elgato_Wave_3.mono-fallback\tPipeWire\tfloat32le 1ch 48000Hz\tRUNNING\n",
      stderr: "",
    },
  });
  const report = supervisedCapture.buildPreflightReport(
    { profile: "vidnux-screen-4k30-mic", outputDir: "/tmp/captures", env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } },
    { runner }
  );

  assert.equal(report.audioCandidates.length, 1);
  assert.equal(report.audioCandidates[0].source, "alsa_input.usb-Elgato_Wave_3.mono-fallback");
  assert.equal(report.groupedAudioCandidates.microphoneCandidates.length, 1);
  assert.equal(report.groupedAudioCandidates.systemAudioCandidates.length, 0);
  assert.match(report.warnings.join("\n"), /Microphone source is required/);
  assert.match(report.ffmpegCommand.join(" "), /<required-mic-source>/);
  assert.equal(report.recordingStarted, false);
  assert.equal(report.writesPerformed, false);
});

test("supervised capture preflight groups system monitor and microphone candidates", () => {
  const runner = mockCommandRunner({
    "sh -lc command -v pactl": { status: 0, stdout: "/usr/bin/pactl\n", stderr: "" },
    "pactl list short sources": {
      status: 0,
      stdout: [
        "1\talsa_output.pci-0000_00_1f.3.analog-stereo.monitor\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING",
        "2\talsa_input.usb-Elgato_Wave_3.mono-fallback\tPipeWire\tfloat32le 1ch 48000Hz\tRUNNING",
      ].join("\n"),
      stderr: "",
    },
  });
  const report = supervisedCapture.buildPreflightReport(
    {
      profile: "vidnux-screen-4k30-systemaudio-mic",
      outputDir: "/tmp/captures",
      env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
    },
    { runner }
  );

  assert.equal(report.groupedAudioCandidates.systemAudioCandidates[0].source, "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor");
  assert.equal(report.groupedAudioCandidates.microphoneCandidates[0].source, "alsa_input.usb-Elgato_Wave_3.mono-fallback");
  assert.match(report.warnings.join("\n"), /--system-audio-source/);
  assert.match(report.warnings.join("\n"), /--mic-source/);
  assert.match(report.ffmpegCommand.join(" "), /<required-system-audio-source>/);
  assert.match(report.ffmpegCommand.join(" "), /<required-mic-source>/);
});

test("supervised capture warns on Wayland instead of pretending x11grab is supported", () => {
  const report = supervisedCapture.buildPreflightReport(
    { profile: "vidnux-screen-4k30-noaudio", outputDir: "/tmp/captures", env: { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } },
    { runner: mockCommandRunner() }
  );

  assert.match(report.warnings.join("\n"), /Wayland detected/);
  assert.match(report.warnings.join("\n"), /Xorg login/);
});

test("supervised capture parses xrandr geometry and warns when profile crops display", () => {
  const runner = mockCommandRunner({
    "sh -lc command -v xrandr": { status: 0, stdout: "/usr/bin/xrandr\n", stderr: "" },
    "xrandr --current": {
      status: 0,
      stdout: "Screen 0: current 3840 x 2160, maximum 16384 x 16384\nHDMI-1 connected primary 3840x2160+0+0\n   3840x2160     60.00*+\n",
      stderr: "",
    },
  });
  const report = supervisedCapture.buildPreflightReport(
    { profile: "vidnux-screen-1080p30-noaudio", outputDir: "/tmp/captures", env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } },
    { runner }
  );

  assert.equal(report.detectedDisplayGeometry.width, 3840);
  assert.equal(report.detectedDisplayGeometry.height, 2160);
  assert.equal(report.requestedWidth, 1920);
  assert.equal(report.requestedHeight, 1080);
  assert.match(report.warnings.join("\n"), /does not match detected display geometry 3840x2160/);
  assert.equal(supervisedCapture.PROFILES["vidnux-screen-1080p30-noaudio"].primary, false);
  assert.equal(supervisedCapture.PROFILES["vidnux-screen-4k30-noaudio"].primary, true);
});

test("supervised capture 4k profile follows detected full-display geometry", () => {
  const runner = mockCommandRunner({
    "sh -lc command -v xrandr": { status: 0, stdout: "/usr/bin/xrandr\n", stderr: "" },
    "xrandr --current": {
      status: 0,
      stdout: "Screen 0: current 4096 x 2160, maximum 16384 x 16384\nDP-1 connected primary 4096x2160+0+0\n   4096x2160     60.00*+\n",
      stderr: "",
    },
  });
  const report = supervisedCapture.buildPreflightReport(
    { profile: "vidnux-screen-4k30-noaudio", outputDir: "/tmp/captures", env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" } },
    { runner }
  );

  assert.equal(report.requestedWidth, 4096);
  assert.equal(report.requestedHeight, 2160);
  assert.match(report.ffmpegCommand.join(" "), /4096x2160/);
  assert.doesNotMatch(report.warnings.join("\n"), /does not match detected display geometry/);
});

test("supervised capture metadata stores full ffmpeg command and approval boundary", () => {
  const metadata = supervisedCapture.buildMetadata({
    captureId: "VT_capture_vidnux_20260526-143012_profile-screen-4k30",
    profile: "vidnux-screen-4k30-noaudio",
    startedAt: "2026-05-26T14:30:12.000Z",
    pid: 123,
    processStartTime: "987654321",
    outputFile: "/tmp/capture.mp4",
    metadataFile: "/tmp/capture.json",
    ffmpegCommand: ["ffmpeg", "-f", "x11grab", "/tmp/capture.mp4"],
    requestedWidth: 3840,
    requestedHeight: 2160,
    detectedDisplayGeometry: { width: 3840, height: 2160, source: "xrandr-active-mode" },
    audioMode: "systemaudio-mic",
    systemAudioSource: "alsa_output.pci-test.monitor",
    micSource: "alsa_input.usb-test-mic",
    audioMixStrategy: "ffmpeg_amix_single_aac_track",
  });

  assert.deepEqual(metadata.ffmpeg_command, ["ffmpeg", "-f", "x11grab", "/tmp/capture.mp4"]);
  assert.equal(metadata.approval_boundary, supervisedCapture.APPROVAL_BOUNDARY);
  assert.equal(metadata.requested_width, 3840);
  assert.equal(metadata.requested_height, 2160);
  assert.equal(metadata.detected_display_geometry.width, 3840);
  assert.equal(metadata.audio_mode, "systemaudio-mic");
  assert.equal(metadata.system_audio_source, "alsa_output.pci-test.monitor");
  assert.equal(metadata.mic_source, "alsa_input.usb-test-mic");
  assert.equal(metadata.audio_mix_strategy, "ffmpeg_amix_single_aac_track");
  assert.equal(Object.hasOwn(metadata, "duration_limit"), false);
});

test("supervised capture active-state validation checks process start time", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-state-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.json");
  const proc = createProcFixture({ outputFile, startTime: "111" });
  const state = supervisedCapture.buildMetadata({
    captureId: "VT_capture_vidnux_20260526-143012_profile-screen-4k30",
    profile: "vidnux-screen-4k30-noaudio",
    startedAt: "2026-05-26T14:30:12.000Z",
    pid: proc.pid,
    processStartTime: "222",
    outputFile,
    metadataFile,
    ffmpegCommand: ["ffmpeg", outputFile],
  });
  fs.writeFileSync(metadataFile, JSON.stringify(state), "utf8");

  const validation = supervisedCapture.validateActiveState(state, { procRoot: proc.root });

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /possible PID reuse/);
});

test("supervised capture active-state validation passes for matching wrapper ffmpeg", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-state-ok-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.json");
  const proc = createProcFixture({ outputFile, startTime: "333" });
  const state = supervisedCapture.buildMetadata({
    captureId: "VT_capture_vidnux_20260526-143012_profile-screen-4k30",
    profile: "vidnux-screen-4k30-noaudio",
    startedAt: "2026-05-26T14:30:12.000Z",
    pid: proc.pid,
    processStartTime: "333",
    outputFile,
    metadataFile,
    ffmpegCommand: ["ffmpeg", outputFile],
  });
  fs.writeFileSync(metadataFile, JSON.stringify(state), "utf8");

  const validation = supervisedCapture.validateActiveState(state, { procRoot: proc.root });

  assert.equal(validation.ok, true);
});

test("supervised capture verify fails missing output cleanly", () => {
  const report = supervisedCapture.verifyCaptureFile("/tmp/missing-supervised-capture.mp4", {
    runner: mockCommandRunner(),
  });

  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /output file missing/);
  assert.equal(report.approvalGranted, false);
});

test("supervised capture verify enforces sidecar metadata and size threshold", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-verify-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.json");
  fs.writeFileSync(outputFile, Buffer.alloc(supervisedCapture.MIN_CAPTURE_BYTES + 1));
  fs.writeFileSync(
    metadataFile,
    JSON.stringify({
      capture_id: "VT_capture_vidnux_20260526-143012_profile-screen-4k30",
      output_file: outputFile,
      metadata_file: metadataFile,
      approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
      audio_mode: "none",
    }),
    "utf8"
  );

  const report = supervisedCapture.verifyCaptureFile(outputFile, { runner: mockCommandRunner() });

  assert.equal(report.ok, true);
  assert.equal(report.ffprobeAvailable, false);
  assert.match(report.warnings.join("\n"), /degraded verification/);
  assert.equal(report.approvalGranted, false);
});

test("supervised capture verify checks ffprobe stream metadata when available", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-ffprobe-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30.json");
  fs.writeFileSync(outputFile, Buffer.alloc(supervisedCapture.MIN_CAPTURE_BYTES + 1));
  fs.writeFileSync(
    metadataFile,
    JSON.stringify({
      capture_id: "VT_capture_vidnux_20260526-143012_profile-screen-4k30",
      output_file: outputFile,
      metadata_file: metadataFile,
      approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
      audio_mode: "none",
    }),
    "utf8"
  );
  const runner = mockCommandRunner({
    "sh -lc command -v ffprobe": { status: 0, stdout: "/usr/bin/ffprobe\n", stderr: "" },
    [`ffprobe -v error -show_format -show_streams -of json ${outputFile}`]: {
      status: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264", avg_frame_rate: "30/1" }],
        format: { duration: "12.5" },
      }),
      stderr: "",
    },
  });

  const report = supervisedCapture.verifyCaptureFile(outputFile, { runner });

  assert.equal(report.ok, true);
  assert.equal(report.ffprobeAvailable, true);
});

test("supervised capture verify requires audio stream for audio profiles", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-audio-verify-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio-mic.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio-mic.json");
  fs.writeFileSync(outputFile, Buffer.alloc(supervisedCapture.MIN_CAPTURE_BYTES + 1));
  fs.writeFileSync(
    metadataFile,
    JSON.stringify({
      capture_id: "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio-mic",
      output_file: outputFile,
      metadata_file: metadataFile,
      approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
      audio_mode: "systemaudio-mic",
    }),
    "utf8"
  );
  const runner = mockCommandRunner({
    "sh -lc command -v ffprobe": { status: 0, stdout: "/usr/bin/ffprobe\n", stderr: "" },
    [`ffprobe -v error -show_format -show_streams -of json ${outputFile}`]: {
      status: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264", avg_frame_rate: "30/1" }],
        format: { duration: "12.5" },
      }),
      stderr: "",
    },
  });

  const report = supervisedCapture.verifyCaptureFile(outputFile, { runner });

  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /audio stream/);
});

test("supervised capture verify accepts audio stream for audio profiles", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-audio-ok-"));
  const outputFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio.mp4");
  const metadataFile = path.join(tempDir, "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio.json");
  fs.writeFileSync(outputFile, Buffer.alloc(supervisedCapture.MIN_CAPTURE_BYTES + 1));
  fs.writeFileSync(
    metadataFile,
    JSON.stringify({
      capture_id: "VT_capture_vidnux_20260526-143012_profile-screen-4k30-systemaudio",
      output_file: outputFile,
      metadata_file: metadataFile,
      approval_boundary: supervisedCapture.APPROVAL_BOUNDARY,
      audio_mode: "systemaudio",
    }),
    "utf8"
  );
  const runner = mockCommandRunner({
    "sh -lc command -v ffprobe": { status: 0, stdout: "/usr/bin/ffprobe\n", stderr: "" },
    [`ffprobe -v error -show_format -show_streams -of json ${outputFile}`]: {
      status: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264", avg_frame_rate: "30/1" },
          { codec_type: "audio", codec_name: "aac" },
        ],
        format: { duration: "12.5" },
      }),
      stderr: "",
    },
  });

  const report = supervisedCapture.verifyCaptureFile(outputFile, { runner });

  assert.equal(report.ok, true);
});

test("supervised capture cli start without confirm does not record", () => {
  const output = captureConsole(() =>
    supervisedCaptureScript.main(["start", "--profile", "vidnux-screen-4k30-noaudio"])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /requires --confirm/);
});

test("supervised capture cli status reports no active capture", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-capture-status-"));
  const output = captureConsole(() =>
    supervisedCaptureScript.main(["status", "--state-file", path.join(tempDir, "active.json")])
  );

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /No active supervised capture/);
});

test("capture PROFILES pin their audio and display configuration", () => {
  // Mutation audit survivors (supervised-capture.js:24-97): every audio /
  // fullDisplay / primary boolean in PROFILES could be flipped without a test
  // noticing — i.e. the capture profiles themselves were unverified.
  const expected = {
    "vidnux-screen-4k30-noaudio": { audio: false, audioMode: "none", fullDisplay: true, primary: true },
    "vidnux-screen-4k30-mic": { audio: true, audioMode: "mic", fullDisplay: true, primary: true },
    "vidnux-screen-4k30-systemaudio": { audio: true, audioMode: "systemaudio", fullDisplay: true, primary: true },
    "vidnux-screen-4k30-systemaudio-mic": { audio: true, audioMode: "systemaudio-mic", fullDisplay: true, primary: true },
    "vidnux-screen-1080p30-noaudio": { audio: false, audioMode: "none", fullDisplay: false, primary: false },
    "vidnux-screen-1080p30-mic": { audio: true, audioMode: "mic", fullDisplay: false, primary: false },
  };
  assert.deepEqual(Object.keys(supervisedCapture.PROFILES).sort(), Object.keys(expected).sort());
  for (const [name, want] of Object.entries(expected)) {
    const got = supervisedCapture.PROFILES[name];
    assert.deepEqual(
      { audio: got.audio, audioMode: got.audioMode, fullDisplay: got.fullDisplay, primary: got.primary },
      want,
      name
    );
  }
});

test("supervised capture cli help documents supervised safety", () => {
  const output = captureConsole(() => supervisedCaptureScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /start --confirm/);
  assert.match(output.stdout.join("\n"), /does not approve footage/);
});
