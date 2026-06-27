/**
 * VIDTOOLZ Episode Factory Tests — Media Generators
 * Split from tests/run-tests.js (2026-06-12)
 * Tests for: trailer/music cue generators and Earth Studio planner
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


test("trailer cue folder names are deterministic and slugged", () => {
  assert.equal(
    trailerCueGenerator.buildCueFolderName("AI Video Workflow Trailer", "2026-05-06"),
    "2026-05-06-ai-video-workflow-trailer"
  );
});

test("trailer cue section and tempo maps cover a two minute trailer", () => {
  const sections = trailerCueGenerator.buildSectionMap();
  const tempoMap = trailerCueGenerator.buildTempoMap();

  assert.equal(sections[0].start, 0);
  assert.equal(sections[sections.length - 1].end, 120);
  assert.equal(sections.length, 8);
  assert.deepEqual(
    tempoMap.map((item) => item.bpm),
    [72, 84, 96, 108, 120, 132, 112, 72]
  );
});

test("trailer cue artifacts include planning files and six midi stems", () => {
  const artifacts = trailerCueGenerator.buildCueArtifacts("Local trailer cue");
  const filenames = Object.keys(artifacts).sort();

  assert.deepEqual(filenames, [
    "climax-hits.mid",
    "drone.mid",
    "final-sting.mid",
    "motif.mid",
    "patch-recommendations.md",
    "pulse.mid",
    "render-checklist.md",
    "resolve-markers.csv",
    "riser.mid",
    "section-map.md",
    "tempo-map.md",
    "test-notes.md",
  ]);
  assert.match(artifacts["section-map.md"], /Length: 02:00/);
  assert.match(artifacts["patch-recommendations.md"], /does not load plugins/);
  assert.match(artifacts["test-notes.md"], /Musical Usability/);
  assert.match(artifacts["test-notes.md"], /Patch Choices/);
  assert.match(artifacts["test-notes.md"], /Section Timing/);
  assert.match(artifacts["test-notes.md"], /Resolve Marker Usefulness/);
  assert.match(artifacts["test-notes.md"], /Final Sting Strength/);
});

test("trailer cue dark fairytale preset changes structure maps and text artifacts", () => {
  const artifacts = trailerCueGenerator.buildCueArtifacts("Red Riding Hood Trailer", {
    preset: "dark-fairytale-trailer",
  });
  const sections = trailerCueGenerator.buildSectionMap({ preset: "dark-fairytale-trailer" });
  const tempoMap = trailerCueGenerator.buildTempoMap({ preset: "dark-fairytale-trailer" });
  const markers = artifacts["resolve-markers.csv"];

  assert.equal(sections[0].name, "Forest whisper");
  assert.equal(sections[5].name, "Teeth in the dark");
  assert.equal(sections[7].name, "Blood moon sting");
  assert.match(sections[1].purpose, /stay on the path/);
  assert.match(sections[4].musicalDirection, /nursery motif/);
  assert.deepEqual(
    tempoMap.map((item) => item.bpm),
    [68, 78, 92, 104, 116, 138, 96, 68]
  );
  assert.match(tempoMap[4].feel, /Grandmother's house/);
  assert.match(markers, /Forest whisper/);
  assert.match(markers, /Blood moon sting.*Red/);
  assert.match(artifacts["patch-recommendations.md"], /wolf breath/);
  assert.match(artifacts["render-checklist.md"], /Red Riding Hood trailer edit/);
  assert.match(artifacts["test-notes.md"], /Does the cue clearly suggest Red Riding Hood/);
});

test("trailer cue dark fairytale preset changes midi ranges and rhythm density", () => {
  const defaultMotif = trailerCueGenerator.buildNotesForPart("motif");
  const presetMotif = trailerCueGenerator.buildNotesForPart("motif", {
    preset: "dark-fairytale-trailer",
  });
  const defaultPulse = trailerCueGenerator.buildNotesForPart("pulse");
  const presetPulse = trailerCueGenerator.buildNotesForPart("pulse", {
    preset: "dark-fairytale-trailer",
  });
  const defaultLowestMotif = Math.min(...defaultMotif.map((note) => note[2]));
  const presetLowestMotif = Math.min(...presetMotif.map((note) => note[2]));

  assert.ok(presetLowestMotif < defaultLowestMotif);
  assert.ok(presetPulse.length > defaultPulse.length);
  assert.notEqual(
    trailerCueGenerator.buildMidiFile("pulse").length,
    trailerCueGenerator.buildMidiFile("pulse", { preset: "dark-fairytale-trailer" }).length
  );
});

test("trailer cue test notes template supports manual validation fields", () => {
  const notes = trailerCueGenerator.buildTestNotesMarkdown("Validation cue");

  assert.match(notes, /DAW:/);
  assert.match(notes, /Omnisphere \/ UVI \/ Arturia \/ other/);
  assert.match(notes, /Rendered Stem Check/);
  assert.match(notes, /Fairlight Assembly Check/);
  assert.match(notes, /Do not connect this generator to a DAW/);
});

test("trailer cue validation docs describe the manual real-world pass without automation", () => {
  const docPath = path.join(__dirname, "..", "docs", "trailer-cue-validation-workflow.md");
  const doc = fs.readFileSync(docPath, "utf8");

  assert.match(doc, /Import `resolve-markers.csv` into Resolve/);
  assert.match(doc, /Import these MIDI files into a DAW as separate tracks/);
  assert.match(doc, /Assign local patches manually/);
  assert.match(doc, /Omnisphere, UVI, Arturia/);
  assert.match(doc, /Render separate audio stems manually/);
  assert.match(doc, /Resolve\/Fairlight/);
  assert.match(doc, /fill `test-notes.md`/i);
  assert.match(doc, /does not call AI APIs/);
  assert.match(doc, /automate DAWs/);
});

test("trailer cue resolve markers use one hour timecode and section rows", () => {
  const csv = trailerCueGenerator.buildResolveMarkerCsv();
  const lines = csv.trim().split("\n");

  assert.equal(lines[0], "Marker Name,Description,Start Timecode,Duration,Color");
  assert.match(lines[1], /^Cold open,Immediate stakes and sonic identity\.,01:00:00:00,00:12,Blue$/);
  assert.match(csv, /Final sting,"End card, logo, or hard stop\.",01:01:56:00,00:04,Red/);
});

test("trailer cue midi files are standard midi buffers with notes", () => {
  const motif = trailerCueGenerator.buildMidiFile("motif");
  const pulse = trailerCueGenerator.buildMidiFile("pulse");

  assert.equal(motif.subarray(0, 4).toString("ascii"), "MThd");
  assert.equal(motif.subarray(14, 18).toString("ascii"), "MTrk");
  assert.ok(motif.length > 80);
  assert.ok(pulse.length > motif.length);
});

test("trailer cue cli help documents supported options and current limits", () => {
  const output = captureConsole(() => trailerCueScript.main(["--help"]));

  assert.equal(output.result, 0);
  assert.equal(output.stderr.length, 0);
  assert.match(output.stdout.join("\n"), /Usage: node scripts\/trailer-cue-new\.js "Trailer cue title"/);
  assert.match(output.stdout.join("\n"), /--out <dir>/);
  assert.match(output.stdout.join("\n"), /--date <date>/);
  assert.match(output.stdout.join("\n"), /--preset <preset>/);
  assert.match(output.stdout.join("\n"), /dark-fairytale-trailer/);
  assert.match(output.stdout.join("\n"), /does not call AI APIs/);
});

test("trailer cue cli rejects unsupported presets clearly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-unknown-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Dark Fairytale Trailer",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
      "--preset",
      "space-opera-trailer",
    ])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Unsupported preset: space-opera-trailer/);
  assert.match(output.stderr.join("\n"), /Supported presets: dark-fairytale-trailer/);
  assert.equal(fs.existsSync(path.join(tempDir, "2026-05-06-dark-fairytale-trailer")), false);
});

test("trailer cue cli still rejects unknown options clearly", () => {
  const output = captureConsole(() => trailerCueScript.main(["Cue", "--bogus"]));

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Unknown option: --bogus/);
  assert.match(output.stderr.join("\n"), /--help/);
});

test("trailer cue cli creates dark fairytale preset cue folders", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-preset-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Red Riding Hood Trailer",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
      "--preset",
      "dark-fairytale-trailer",
    ])
  );
  const cueDir = path.join(tempDir, "2026-05-06-red-riding-hood-trailer");

  assert.equal(output.result, 0);
  assert.match(fs.readFileSync(path.join(cueDir, "section-map.md"), "utf8"), /Forest whisper/);
  assert.match(fs.readFileSync(path.join(cueDir, "tempo-map.md"), "utf8"), /dark-fairytale-trailer/);
  assert.match(fs.readFileSync(path.join(cueDir, "resolve-markers.csv"), "utf8"), /Blood moon sting/);
});

test("trailer cue script writes cue folders without overwriting changed files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trailer-cue-"));
  const output = captureConsole(() =>
    trailerCueScript.main([
      "Local Trailer Cue",
      "--out",
      tempDir,
      "--date",
      "2026-05-06",
    ])
  );
  const cueDir = path.join(tempDir, "2026-05-06-local-trailer-cue");
  const sectionPath = path.join(cueDir, "section-map.md");

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /Created trailer cue files in:/);
  assert.equal(fs.existsSync(path.join(cueDir, "motif.mid")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "test-notes.md")), true);
  fs.writeFileSync(sectionPath, "human edit", "utf8");
  assert.equal(
    trailerCueScript.main(["Local Trailer Cue", "--out", tempDir, "--date", "2026-05-06"]),
    2
  );
  assert.equal(fs.readFileSync(sectionPath, "utf8"), "human edit");
});

test("music cue low pulse starts at 15 seconds on beat 3 of bar 5", () => {
  const lowPulseRows = musicCueGenerator.expandNoteRows("02_LOW_PULSE");

  assert.equal(lowPulseRows[0].note_name, "D2");
  assert.equal(lowPulseRows[0].midi_note_number, 38);
  assert.equal(lowPulseRows[0].bar, 5);
  assert.equal(lowPulseRows[0].beat, 3);
  assert.equal(lowPulseRows[0].start_seconds, 15);
});

test("music cue arrangement contains populated midi schema and evaluation fields", () => {
  const arrangement = musicCueGenerator.buildArrangement("2026-05-26T00:00:00.000Z");

  assert.equal(arrangement.cue_name, "VT_CalmThinkingBed_01");
  assert.equal(arrangement.duration_seconds, 60);
  assert.equal(arrangement.tempo_bpm, 72);
  assert.equal(arrangement.mode, "D Dorian");
  assert.equal(arrangement.harmonic_center, "D");
  assert.equal(arrangement.tracks.length, 4);
  assert.ok(arrangement.midi_content_schema["01_PAD_MAIN"].length > 0);
  assert.ok(arrangement.midi_content_schema["02_LOW_PULSE"].length > 0);
  assert.ok(arrangement.midi_content_schema["03_SOFT_BASS"].length > 0);
  assert.ok(arrangement.midi_content_schema["04_GRAIN_SHIMMER"].length > 0);
  assert.ok(arrangement.ableton_import_notes.length > 0);
  assert.ok(arrangement.evaluation_questions.length > 0);
  assert.ok(arrangement.warnings.length > 0);
  assert.deepEqual(musicCueGenerator.validateArrangementPayload(arrangement), []);
});

test("music cue artifacts include required markdown, json, and four midi files", () => {
  const artifacts = musicCueGenerator.buildArtifacts("2026-05-26T00:00:00.000Z");
  const filenames = Object.keys(artifacts).sort();

  assert.deepEqual(filenames, [
    "README.md",
    "ableton-track-map.md",
    "arrangement.json",
    "evaluation-checklist.md",
    "midi/01_PAD_MAIN.mid",
    "midi/02_LOW_PULSE.mid",
    "midi/03_SOFT_BASS.mid",
    "midi/04_GRAIN_SHIMMER.mid",
    "render-checklist.md",
  ]);
  assert.match(artifacts["README.md"], /MIDI cue skeleton/);
  assert.match(artifacts["render-checklist.md"], /48 kHz/);
  assert.match(artifacts["render-checklist.md"], /VT_CalmThinkingBed_01_60s_FullMix\.wav/);
  assert.match(artifacts["render-checklist.md"], /PulseOnly is not required/);
  assert.match(artifacts["evaluation-checklist.md"], /Narration becomes more focused and credible/);
});

test("music cue midi files are standard midi buffers with note content", () => {
  const pad = musicCueGenerator.buildMidiFile("01_PAD_MAIN");
  const pulse = musicCueGenerator.buildMidiFile("02_LOW_PULSE");

  assert.equal(pad.subarray(0, 4).toString("ascii"), "MThd");
  assert.equal(pad.subarray(14, 18).toString("ascii"), "MTrk");
  assert.ok(pad.length > 100);
  assert.ok(pulse.length > 100);
});

test("music cue cli dry run writes nothing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-cue-dry-run-"));
  const output = captureConsole(() =>
    musicCueScript.main(["--cue", "VT_CalmThinkingBed_01", "--out", tempDir, "--dry-run"])
  );

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /No files written/);
  assert.equal(fs.existsSync(path.join(tempDir, "VT_CalmThinkingBed_01")), false);
});

test("music cue cli writes and verifies the required cue folder", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-cue-write-"));
  const writeOutput = captureConsole(() =>
    musicCueScript.main(["--cue", "VT_CalmThinkingBed_01", "--out", tempDir, "--write"])
  );
  const cueDir = path.join(tempDir, "VT_CalmThinkingBed_01");
  const arrangement = readJsonFile(path.join(cueDir, "arrangement.json"));
  const verifyOutput = captureConsole(() =>
    musicCueScript.main(["--cue", "VT_CalmThinkingBed_01", "--out", tempDir, "--verify"])
  );

  assert.equal(writeOutput.result, 0);
  assert.equal(fs.existsSync(path.join(cueDir, "README.md")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "ableton-track-map.md")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "render-checklist.md")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "evaluation-checklist.md")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "midi/01_PAD_MAIN.mid")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "midi/02_LOW_PULSE.mid")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "midi/03_SOFT_BASS.mid")), true);
  assert.equal(fs.existsSync(path.join(cueDir, "midi/04_GRAIN_SHIMMER.mid")), true);
  assert.equal(arrangement.midi_content_schema["02_LOW_PULSE"][0].start_seconds, 15);
  assert.equal(arrangement.midi_content_schema["02_LOW_PULSE"][0].bar, 5);
  assert.equal(arrangement.midi_content_schema["02_LOW_PULSE"][0].beat, 3);
  assert.equal(verifyOutput.result, 0);
  assert.match(verifyOutput.stdout.join("\n"), /Verification passed/);
});

test("music cue verify fails when an expected midi file is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-cue-missing-"));
  musicCueScript.main(["--cue", "VT_CalmThinkingBed_01", "--out", tempDir, "--write"]);
  fs.unlinkSync(path.join(tempDir, "VT_CalmThinkingBed_01", "midi/02_LOW_PULSE.mid"));

  const output = captureConsole(() =>
    musicCueScript.main(["--cue", "VT_CalmThinkingBed_01", "--out", tempDir, "--verify"])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /02_LOW_PULSE\.mid/);
});

test("music cue cli rejects unsupported cues clearly", () => {
  const output = captureConsole(() =>
    musicCueScript.main(["--cue", "VT_Unsupported_01", "--dry-run"])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /Unsupported cue: VT_Unsupported_01/);
  assert.match(output.stderr.join("\n"), /VT_CalmThinkingBed_01/);
});

const earthStudioExampleDescription =
  "Hover over Midtown Manhattan for 3 seconds, then fly to Downtown Boston in 5 seconds, then hover over Downtown Boston for 5 seconds.";

test("earth studio planner parses NYC to Boston example into three segments", () => {
  const plan = earthStudioJobPlanner.buildShotPlan("VT_Boston_Test_01", earthStudioExampleDescription, "2026-05-26T00:00:00.000Z");

  assert.equal(plan.segments.length, 3);
  assert.equal(plan.segments[0].action, "hover");
  assert.equal(plan.segments[1].action, "fly_to");
  assert.equal(plan.segments[2].action, "hover");
  assert.equal(plan.segments[0].location_name, "Midtown Manhattan");
  assert.equal(plan.segments[1].location_name, "Downtown Boston");
  assert.equal(plan.segments[2].location_name, "Downtown Boston");
  assert.equal(plan.unresolved_items.length, 0);
});

test("earth studio planner duration parser supports seconds sec and s", () => {
  assert.equal(earthStudioJobPlanner.extractDurationSeconds("hover for 3 seconds"), 3);
  assert.equal(earthStudioJobPlanner.extractDurationSeconds("hover for 5 sec"), 5);
  assert.equal(earthStudioJobPlanner.extractDurationSeconds("hover for 3s"), 3);
});

test("earth studio planner frame boundaries use inclusive exclusive convention", () => {
  const plan = earthStudioJobPlanner.buildShotPlan("VT_Boston_Test_01", earthStudioExampleDescription, "2026-05-26T00:00:00.000Z");

  assert.equal(plan.frame_convention.start_frame, "inclusive");
  assert.equal(plan.frame_convention.end_frame, "exclusive");
  assert.equal(plan.total_duration_seconds, 13);
  assert.equal(plan.total_frames, 390);
  assert.deepEqual(
    plan.segments.map((segment) => [segment.start_seconds, segment.end_seconds, segment.start_frame, segment.end_frame]),
    [
      [0, 3, 0, 90],
      [3, 8, 90, 240],
      [8, 13, 240, 390],
    ]
  );
});

test("earth studio planner Downtown Boston fixture uses corrected coordinates", () => {
  const downtown = earthStudioJobPlanner.resolveLocation("Downtown Boston");

  assert.equal(downtown.latitude, 42.3555);
  assert.equal(downtown.longitude, -71.0565);
});

test("earth studio planner KML uses longitude latitude altitude order", () => {
  const artifacts = earthStudioJobPlanner.buildArtifacts("VT_Boston_Test_01", earthStudioExampleDescription, "2026-05-26T00:00:00.000Z");
  const kml = artifacts["route.kml"];

  assert.match(kml, /-71\.0565,42\.3555,0/);
  assert.doesNotMatch(kml, /-1\.0565,42\.3555,0/);
  assert.match(kml, /reference asset only/);
});

test("earth studio planner unknown location becomes manual review", () => {
  const plan = earthStudioJobPlanner.buildShotPlan("Unknown_Test", "Hover over Imaginary City for 3 seconds.", "2026-05-26T00:00:00.000Z");

  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].resolution_status, "manual_review");
  assert.equal(plan.segments[0].location, null);
  assert.match(plan.warnings.join("\n"), /unknown location fixture: Imaginary City/);
});

test("earth studio planner orbit is a supported action (v0.2)", () => {
  const plan = earthStudioJobPlanner.buildShotPlan("Orbit_Test", "Orbit Downtown Boston for 3 seconds.", "2026-05-26T00:00:00.000Z");

  assert.equal(plan.segments[0].action, "orbit");
  assert.equal(plan.segments[0].requested_action, "orbit");
  assert.equal(plan.segments[0].resolution_status, "resolved");
});

test("earth studio planner dry run writes nothing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earth-studio-dry-run-"));
  const output = captureConsole(() =>
    earthStudioJobScript.main([
      "--job",
      "VT_Boston_Test_01",
      "--description",
      earthStudioExampleDescription,
      "--out",
      tempDir,
      "--dry-run",
    ])
  );

  assert.equal(output.result, 0);
  assert.match(output.stdout.join("\n"), /No files written/);
  assert.equal(fs.existsSync(path.join(tempDir, "VT_Boston_Test_01")), false);
});

test("earth studio planner generate mode writes expected files in temporary folder", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earth-studio-write-"));
  const output = captureConsole(() =>
    earthStudioJobScript.main([
      "--job",
      "VT_Boston_Test_01",
      "--description",
      earthStudioExampleDescription,
      "--out",
      tempDir,
      "--write",
    ])
  );
  const jobDir = path.join(tempDir, "VT_Boston_Test_01");
  const plan = readJsonFile(path.join(jobDir, "shot-plan.json"));

  assert.equal(output.result, 0);
  earthStudioJobPlanner.expectedFiles().forEach((filename) => {
    assert.equal(fs.existsSync(path.join(jobDir, filename)), true);
  });
  assert.equal(plan.total_frames, 390);
  assert.deepEqual(earthStudioJobPlanner.validateShotPlanPayload(plan), []);
});

test("earth studio planner verify mode catches missing artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "earth-studio-missing-"));
  earthStudioJobScript.main([
    "--job",
    "VT_Boston_Test_01",
    "--description",
    earthStudioExampleDescription,
    "--out",
    tempDir,
    "--write",
  ]);
  fs.unlinkSync(path.join(tempDir, "VT_Boston_Test_01", "route.kml"));

  const output = captureConsole(() =>
    earthStudioJobScript.main(["--job", "VT_Boston_Test_01", "--out", tempDir, "--verify"])
  );

  assert.equal(output.result, 1);
  assert.match(output.stderr.join("\n"), /route\.kml/);
});

test("earth studio planner shot-plan markdown includes segment table and KML limitation", () => {
  const artifacts = earthStudioJobPlanner.buildArtifacts("VT_Boston_Test_01", earthStudioExampleDescription, "2026-05-26T00:00:00.000Z");
  const markdown = artifacts["shot-plan.md"];

  assert.match(markdown, /## Segment Table/);
  assert.match(markdown, /Manual Earth Studio Build Summary/);
  assert.match(markdown, /KML import does not create a finished Earth Studio camera animation/);
});
