// Scorecraft v1.2 — Score Map analysis, staged readiness, and the deep
// package verifier. Everything runs in temp dirs with injected probes:
// no REAPER, no ffprobe binary required, no writes outside os.tmpdir().
const { assert, fs, os, path, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const { analyzeCueSheet } = require("../score-engine/cue-analysis.js");
const { assessReadiness, verifyApprovedExports, formatVerifierReport } = require("../score-engine/score-readiness.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "score-ready-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}
function makeProject(options, extra = {}) {
  return lane.createScoreProject({ name: "Readiness Test", duration_seconds: 60, ...extra }, options);
}
function readyProject(options, extra = {}) {
  const { project } = makeProject(options, extra);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.setPalette(project.project_id, "tech_noir_pulse", options);
  return project;
}
function approvedProject(options, extra = {}) {
  const project = readyProject(options, extra);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  return lane.getProject(project.project_id, options);
}
const okProbeFor = (state) => (file) => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: state.duration, ...state.overrides && state.overrides[path.basename(file)] });

// ── cue analysis ──

test("score map analysis: coverage, gaps and gap-warnings are found; full coverage has none", () => {
  const project = { duration_seconds: 60, dialogue_density: "light" };
  const cues = [
    { cue_id: "cue-01", name: "open", start_seconds: 0, end_seconds: 20, function: "hook", energy: 3, density: 2, dialogue_safe: true },
    { cue_id: "cue-02", name: "close", start_seconds: 35, end_seconds: 55, function: "outro", energy: 2, density: 1, dialogue_safe: true },
  ];
  const a = analyzeCueSheet(project, cues);
  assert.equal(a.gaps.length, 2, "mid gap + tail gap");
  assert.deepEqual([a.gaps[0].start_seconds, a.gaps[0].end_seconds], [20, 35]);
  assert.deepEqual([a.gaps[1].start_seconds, a.gaps[1].end_seconds], [55, 60]);
  assert.equal(a.coverage_pct, Math.round((40 / 60) * 100));
  assert.ok(a.warnings.filter((w) => w.kind === "music-gap").length === 2, "silence is visible, never accidental");
  const full = analyzeCueSheet(project, [{ cue_id: "c1", start_seconds: 0, end_seconds: 60, function: "hook", energy: 3, density: 2, dialogue_safe: true }]);
  assert.equal(full.gaps.length, 0);
  assert.equal(full.coverage_pct, 100);
});

test("score map analysis: dialogue risk grading is advisory and dialogue-density aware", () => {
  const heavy = { duration_seconds: 60, dialogue_density: "heavy" };
  const cues = [
    { cue_id: "busy", start_seconds: 0, end_seconds: 30, energy: 5, density: 4, dialogue_safe: false },
    { cue_id: "calm", start_seconds: 30, end_seconds: 60, energy: 2, density: 1, dialogue_safe: false },
  ];
  const a = analyzeCueSheet(heavy, cues);
  assert.equal(a.cues[0].dialogue_risk, "high", "busy unsafe music under heavy dialogue = high risk");
  assert.equal(a.cues[1].dialogue_risk, "medium");
  assert.ok(a.warnings.some((w) => w.kind === "dialogue-risk" && /fight the score/.test(w.message)));
  const light = analyzeCueSheet({ duration_seconds: 60, dialogue_density: "light" }, cues);
  assert.ok(light.cues.every((c) => c.dialogue_risk === "none"), "no dialogue pressure, no nagging");
  const safe = analyzeCueSheet(heavy, [{ cue_id: "s", start_seconds: 0, end_seconds: 60, energy: 5, density: 4, dialogue_safe: true }]);
  assert.equal(safe.cues[0].dialogue_risk, "none", "explicitly dialogue-safe cues are trusted");
});

test("score map analysis: short cues and out-of-range hit points warn", () => {
  const a = analyzeCueSheet({ duration_seconds: 30, dialogue_density: "light" }, [
    { cue_id: "blip", start_seconds: 0, end_seconds: 1.2, energy: 3, density: 2, dialogue_safe: true, hit_points: [5] },
  ]);
  assert.ok(a.warnings.some((w) => w.kind === "short-cue"));
  assert.ok(a.warnings.some((w) => w.kind === "hit-point" && /outside the cue/.test(w.message)));
});

// ── staged readiness ──

test("readiness: empty score is not ready but gives the exact next action", () => {
  const r = assessReadiness({ project: { duration_seconds: 60 }, cueSheet: null, musicPlan: null, candidates: [], dir: "/nonexistent" });
  assert.equal(r.ready_to_render, false);
  assert.equal(r.approved_export_exists, false);
  assert.match(r.next_action, /Generate the cue sheet/);
  assert.ok(r.stages.every((s) => s.state !== "done"));
  assert.ok(r.missing.length >= 3, "every missing stage is named");
  assert.match(r.verify_command, /verify-score-package\.js/);
});

test("readiness: approved plan without candidates is ready-to-render, not Resolve-ready", () => {
  const { options } = tmpEnv();
  const project = readyProject(options);
  const st = lane.getProject(project.project_id, options);
  assert.equal(st.readiness.ready_to_render, true);
  assert.equal(st.readiness.approved_export_exists, false);
  assert.match(st.readiness.next_action, /Generate music candidates/);
  assert.ok(st.analysis && st.analysis.cues.length > 0, "analysis rides along on the project GET");
  assert.match(st.readiness.resolve_ready_requires, /verify-score-package/, "Resolve readiness is only claimed by the verifier");
});

test("readiness: approved export flips the stage but still points at verification", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options);
  assert.equal(st.readiness.approved_export_exists, true);
  assert.ok(st.readiness.stages.every((s) => s.state === "done"));
  assert.match(st.readiness.next_action, /Run the deep verifier/);
});

test("readiness: listProjects cue_count comes from the cue sheet (was always 0 before v1.2)", () => {
  const { options } = tmpEnv();
  const project = readyProject(options);
  const listed = lane.listProjects(options).find((p) => p.project_id === project.project_id);
  assert.ok(listed.cue_count > 0, `cue_count honest, got ${listed.cue_count}`);
});

// ── deep verifier ──

test("verifier: real approved export passes with a contract-matching probe", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options, { duration_seconds: 30 });
  const r = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 30 }) });
  assert.equal(r.verified, true, `expected PASS: ${r.failures.join("; ")}`);
  assert.ok(r.checks.length >= 15, "a real battery of checks");
  assert.match(formatVerifierReport(r, st.dir), /^PASS — approved export verified/m);
});

test("verifier: missing stem, diverged Resolve mirror, wrong rate, wrong duration all fail loudly", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options, { duration_seconds: 30 });
  const probe = okProbeFor({ duration: 30 });

  const stems = fs.readdirSync(path.join(st.dir, "approved", "stems"));
  fs.rmSync(path.join(st.dir, "approved", "resolve-import", "stems", stems[0]));
  let r = verifyApprovedExports(st.dir, { probeImpl: probe });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((f) => /resolve mirror present/.test(f)), `mirror gap caught: ${r.failures}`);

  fs.copyFileSync(path.join(st.dir, "approved", "stems", stems[0]), path.join(st.dir, "approved", "resolve-import", "stems", stems[0]));
  fs.appendFileSync(path.join(st.dir, "approved", "resolve-import", "mix.wav"), "TAMPER");
  r = verifyApprovedExports(st.dir, { probeImpl: probe });
  assert.ok(r.failures.some((f) => /byte-identical/.test(f)), "diverged copy is a silent lie — caught");

  const st2 = approvedProject(tmpEnv().options, { duration_seconds: 30 });
  r = verifyApprovedExports(st2.dir, { probeImpl: (f) => ({ ok: true, sample_rate: 44100, channels: 2, codec: "pcm_s24le", duration: 30 }) });
  assert.ok(r.failures.some((f) => /sample rate 48000/.test(f)));
  r = verifyApprovedExports(st2.dir, { probeImpl: (f) => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: 31.2 }) });
  assert.ok(r.failures.some((f) => /duration exact 30s/.test(f)), "duration-exact contract enforced from provenance");
});

test("verifier: probe failure blocks Resolve readiness; no approved export is NOT a pass", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options, { duration_seconds: 30 });
  const r = verifyApprovedExports(st.dir, { probeImpl: () => ({ ok: false, reason: "no audio stream" }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((f) => /no audio stream/.test(f)));

  const bare = tmpEnv();
  const { project } = makeProject(bare.options);
  const dir = lane.getProject(project.project_id, bare.options).dir;
  const none = verifyApprovedExports(dir, { probeImpl: () => { throw new Error("must not probe"); } });
  assert.equal(none.no_approved_export, true);
  assert.equal(none.verified, false);
  assert.match(formatVerifierReport(none, dir), /NOT READY — no approved export/);
  assert.match(formatVerifierReport(none, dir), /NOT a pass/);
});

// ── UI (grep-based like the other page tests) ──

test("ui: score workspace has the Score Map, readiness panel, and honest empty state", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.ok(html.includes('id="score-map"'), "map container");
  assert.ok(html.includes("renderScoreMap"), "map renderer");
  assert.ok(html.includes("height = energy"), "legend explains the encoding");
  assert.ok(html.includes("dlg-risk"), "dialogue-risk striping");
  assert.ok(html.includes("smap-gap"), "silence gaps visualized");
  assert.ok(html.includes("No cues yet — the Score Map appears"), "empty state explains next step");
  assert.ok(html.includes('id="step-readiness"'), "readiness panel");
  assert.ok(html.includes("Copy command"), "copyable verifier command");
  assert.ok(html.includes("never claims that without probed evidence"), "no unverified Resolve-ready light");
});
