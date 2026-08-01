// Scorecraft v1.2 — Score Map analysis, staged readiness, and the deep
// package verifier. Everything runs in temp dirs with injected probes:
// no REAPER, no ffprobe binary required, no writes outside os.tmpdir().
const { assert, fs, os, path, test } = require("./_helpers.js");
const lane = require("../score-engine/score-lane.js");
const provenanceLib = require("../score-engine/score-provenance.js");
const { analyzeCueSheet, cueBoundaryDiagnostics } = require("../score-engine/cue-analysis.js");
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
  const project = { duration_seconds: 60, dialogue_density: "low" };
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
  const heavy = { duration_seconds: 60, dialogue_density: "high" };
  const cues = [
    { cue_id: "busy", start_seconds: 0, end_seconds: 30, energy: 5, density: 4, dialogue_safe: false },
    { cue_id: "calm", start_seconds: 30, end_seconds: 60, energy: 2, density: 1, dialogue_safe: false },
  ];
  const a = analyzeCueSheet(heavy, cues);
  assert.equal(a.cues[0].dialogue_risk, "high", "busy unsafe music under heavy dialogue = high risk");
  assert.equal(a.cues[1].dialogue_risk, "medium");
  assert.ok(a.warnings.some((w) => w.kind === "dialogue-risk" && /fight the score/.test(w.message)));
  const light = analyzeCueSheet({ duration_seconds: 60, dialogue_density: "low" }, cues);
  assert.ok(light.cues.every((c) => c.dialogue_risk === "none"), "no dialogue pressure, no nagging");
  const safe = analyzeCueSheet(heavy, [{ cue_id: "s", start_seconds: 0, end_seconds: 60, energy: 5, density: 4, dialogue_safe: true }]);
  assert.equal(safe.cues[0].dialogue_risk, "none", "explicitly dialogue-safe cues are trusted");
});

test("score map analysis: short cues and out-of-range hit points warn", () => {
  const a = analyzeCueSheet({ duration_seconds: 30, dialogue_density: "low" }, [
    { cue_id: "blip", start_seconds: 0, end_seconds: 1.2, energy: 3, density: 2, dialogue_safe: true, hit_points: [5] },
  ]);
  assert.ok(a.warnings.some((w) => w.kind === "short-cue"));
  assert.ok(a.warnings.some((w) => w.kind === "hit-point" && /outside the cue/.test(w.message)));
});

test("cue boundary diagnostics: adjacent overlap flags both cues with rounded seconds", () => {
  const markers = cueBoundaryDiagnostics([
    { cue_id: "C001", start_seconds: 0, end_seconds: 10 },
    { cue_id: "C002", start_seconds: 8.8, end_seconds: 20 },
  ], 20);
  assert.deepEqual(markers, [
    { cue_id: "C001", overlap_with: { other_cue_id: "C002", seconds: 1.2 }, gap_before: null },
    { cue_id: "C002", overlap_with: { other_cue_id: "C001", seconds: 1.2 }, gap_before: null },
  ]);
});

test("cue boundary diagnostics: gap before next cue is advisory only", () => {
  const markers = cueBoundaryDiagnostics([
    { cue_id: "C003", start_seconds: 0, end_seconds: 12 },
    { cue_id: "C004", start_seconds: 12.75, end_seconds: 20 },
  ], 20);
  assert.deepEqual(markers, [
    { cue_id: "C004", overlap_with: null, gap_before: { seconds: 0.8 } },
  ]);
});

test("cue boundary diagnostics: sub-epsilon seams and tiny overlaps produce no marker", () => {
  assert.deepEqual(cueBoundaryDiagnostics([
    { cue_id: "C001", start_seconds: 0, end_seconds: 10 },
    { cue_id: "C002", start_seconds: 10.25, end_seconds: 20 },
    { cue_id: "C003", start_seconds: 19.75, end_seconds: 30 },
  ], 30), []);
});

test("cue boundary diagnostics: unsorted input is sorted internally", () => {
  const markers = cueBoundaryDiagnostics([
    { cue_id: "C002", start_seconds: 11, end_seconds: 20 },
    { cue_id: "C001", start_seconds: 0, end_seconds: 10 },
  ], 20);
  assert.deepEqual(markers, [
    { cue_id: "C002", overlap_with: null, gap_before: { seconds: 1 } },
  ]);
});

test("cue boundary diagnostics: empty or single cue has no markers", () => {
  assert.deepEqual(cueBoundaryDiagnostics([], 0), []);
  assert.deepEqual(cueBoundaryDiagnostics([{ cue_id: "C001", start_seconds: 0, end_seconds: 10 }], 10), []);
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
  assert.match(st.readiness.resolve_ready_requires, /verified production WAV \+ hash-checked Resolve copy/, "Resolve readiness requires the production gate");
});

test("readiness: approved export flips the stage but still points at verification", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options);
  assert.equal(st.readiness.approved_export_exists, true);
  assert.equal(st.readiness.approval_authority.state, "current");
  assert.equal(st.readiness.stages.find((s) => s.id === "approval").state, "done");
  assert.match(st.readiness.next_action, /Import a DAW production mix/);
});

test("readiness provenance: cue edits make an existing sketch approval stale without deleting history", () => {
  const { options } = tmpEnv();
  const before = approvedProject(options, { duration_seconds: 30 });
  const cues = before.cue_sheet.cues.map((cue, i) => i === 0 ? { ...cue, name: "CHANGED AFTER EXPORT" } : cue);
  lane.saveCueSheetEdits(before.project.project_id, cues, options);
  const after = lane.getProject(before.project.project_id, options);
  assert.equal(after.readiness.approved_export_exists, true, "historical sketch export is preserved");
  assert.equal(after.readiness.approval_authority.state, "stale");
  assert.ok(after.readiness.approval_authority.reasons.includes("cue_sheet_changed"));
  assert.notEqual(after.readiness.stages.find((s) => s.id === "approval").state, "done");
});

test("readiness provenance: music-plan and render-contract changes stale exact approvals", () => {
  const first = tmpEnv();
  const planState = approvedProject(first.options, { duration_seconds: 30 });
  lane.setPalette(planState.project.project_id, "broadcast_explainer", first.options);
  let after = lane.getProject(planState.project.project_id, first.options);
  assert.ok(after.readiness.approval_authority.reasons.includes("music_plan_changed"));

  const second = tmpEnv();
  const renderState = approvedProject(second.options, { duration_seconds: 30 });
  lane.saveSettings({ default_export_sample_rate: 44100 }, second.options);
  after = lane.getProject(renderState.project.project_id, second.options);
  assert.ok(after.readiness.approval_authority.reasons.includes("render_contract_changed"));
});

test("readiness provenance: approved candidate artifact mutation and deletion fail closed", () => {
  const first = tmpEnv();
  const mutated = approvedProject(first.options, { duration_seconds: 30 });
  fs.appendFileSync(path.join(mutated.dir, "candidates", "candidate-001", "midi", "all-lanes.mid"), "tamper");
  let after = lane.getProject(mutated.project.project_id, first.options);
  assert.ok(after.readiness.approval_authority.reasons.includes("candidate_artifact_hash_mismatch"));

  const second = tmpEnv();
  const missing = approvedProject(second.options, { duration_seconds: 30 });
  fs.rmSync(path.join(missing.dir, "candidates", "candidate-001", "renders", "preview-mix.wav"));
  after = lane.getProject(missing.project.project_id, second.options);
  assert.ok(after.readiness.approval_authority.reasons.includes("candidate_artifact_missing"));
});

test("readiness provenance: rewriting manifests cannot bless changed artifacts or render contracts", () => {
  const first = tmpEnv();
  const changed = approvedProject(first.options, { duration_seconds: 3 });
  const candidateDir = path.join(changed.dir, "candidates", "candidate-001");
  const candidatePath = path.join(candidateDir, "candidate.json");
  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  const previewPath = path.join(candidateDir, "renders", "preview-mix.wav");
  fs.appendFileSync(previewPath, "same-file-and-manifest-tamper");
  const previewEntry = candidate.artifact_manifest.entries.find((entry) => entry.relative_path === "renders/preview-mix.wav");
  previewEntry.byte_size = fs.statSync(previewPath).size;
  previewEntry.sha256 = provenanceLib.sha256File(previewPath);
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n");
  let after = lane.getProject(changed.project.project_id, first.options);
  assert.equal(after.readiness.approval_authority.current, false);
  assert.ok(after.readiness.approval_authority.reasons.includes("approved_candidate_hash_mismatch"), after.readiness.approval_authority.reasons.join(", "));

  const second = tmpEnv();
  const contractState = approvedProject(second.options, { duration_seconds: 3 });
  const approvalPath = path.join(contractState.dir, "approved", "provenance.json");
  const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  approval.render_contract.sample_rate = 44100;
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n");
  after = lane.getProject(contractState.project.project_id, second.options);
  assert.equal(after.readiness.approval_authority.current, false);
  assert.ok(after.readiness.approval_authority.reasons.includes("render_contract_changed"), after.readiness.approval_authority.reasons.join(", "));
});

test("readiness provenance: legacy approval files remain visible but are never current", () => {
  const { options } = tmpEnv();
  const st = approvedProject(options, { duration_seconds: 30 });
  const provenancePath = path.join(st.dir, "approved", "provenance.json");
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  delete provenance.identity;
  delete provenance.provenance_schema_version;
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  const legacy = lane.getProject(st.project.project_id, options);
  assert.equal(legacy.readiness.approval_authority.state, "legacy_unverified");
  assert.ok(legacy.readiness.approval_authority.reasons.includes("legacy_approval_unverified"));
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
  assert.match(formatVerifierReport(r, st.dir), /^PASS — approved sketch package verified/m);
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

test("verifier completeness: deleting the same expected lane stem from approved and Resolve fails", () => {
  const st = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  fs.rmSync(path.join(st.dir, "approved", "stems", "bass.wav"));
  fs.rmSync(path.join(st.dir, "approved", "resolve-import", "stems", "bass.wav"));
  const r = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(r.verified, false, "one remaining stem must never satisfy a declared six-lane contract");
  assert.ok(r.failures.some((failure) => /bass/.test(failure)), r.failures.join("; "));
});

test("verifier completeness: missing MIDI, undeclared stem, and manifest hash mismatch fail", () => {
  const missing = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  fs.rmSync(path.join(missing.dir, "approved", "midi", "bass.mid"));
  let r = verifyApprovedExports(missing.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((failure) => /bass\.mid|midi_lane_bass/.test(failure)), r.failures.join("; "));

  const extra = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  fs.copyFileSync(path.join(extra.dir, "approved", "stems", "bass.wav"), path.join(extra.dir, "approved", "stems", "undeclared.wav"));
  fs.copyFileSync(path.join(extra.dir, "approved", "stems", "bass.wav"), path.join(extra.dir, "approved", "resolve-import", "stems", "undeclared.wav"));
  r = verifyApprovedExports(extra.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((failure) => /undeclared/.test(failure)), r.failures.join("; "));

  const changed = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  fs.appendFileSync(path.join(changed.dir, "approved", "stems", "bass.wav"), "tamper");
  fs.appendFileSync(path.join(changed.dir, "approved", "resolve-import", "stems", "bass.wav"), "tamper");
  r = verifyApprovedExports(changed.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((failure) => /hash|manifest/.test(failure)), r.failures.join("; "));
});

test("verifier completeness: rewritten manifests and render contracts cannot bless changed approval bytes", () => {
  const st = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  const provenancePath = path.join(st.dir, "approved", "provenance.json");
  const approval = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  const mixPath = path.join(st.dir, "approved", "mix.wav");
  fs.appendFileSync(mixPath, "rewritten");
  const mixEntry = approval.artifact_manifest.entries.find((entry) => entry.logical_role === "sketch_mix");
  mixEntry.byte_size = fs.statSync(mixPath).size;
  mixEntry.sha256 = require("../score-engine/score-provenance.js").sha256File(mixPath);
  approval.render_contract.sample_rate = 44100;
  fs.writeFileSync(provenancePath, JSON.stringify(approval, null, 2) + "\n");
  const result = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(result.verified, false);
  assert.ok(result.failures.some((failure) => /manifest identity|render contract identity/.test(failure)), result.failures.join("; "));
});

test("verifier completeness: marker CSV supports quoted punctuation and rejects a wrong header", () => {
  const fixture = tmpEnv();
  const st = approvedProject(fixture.options, { duration_seconds: 3 });
  const markerPath = path.join(st.dir, "approved", "resolve-import", "cue-markers.csv");
  const approvalPath = path.join(st.dir, "approved", "provenance.json");
  const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  approval.cue_sheet[0].name = 'A comma, a "quote"';
  const csvName = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const markerRows = approval.cue_sheet.map((cue) => `${csvName(`${cue.cue_id} ${cue.name}`)},${cue.start},${cue.end}`);
  fs.writeFileSync(markerPath, `Name,Start (seconds),End (seconds)\n${markerRows.join("\n")}\n`);
  const markerEntry = approval.artifact_manifest.entries.find((entry) => entry.logical_role === "cue_markers");
  markerEntry.byte_size = fs.statSync(markerPath).size;
  markerEntry.sha256 = require("../score-engine/score-provenance.js").sha256File(markerPath);
  approval.identity.approval_artifact_manifest_hash = require("../score-engine/score-provenance.js").artifactManifestHash(approval.artifact_manifest);
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n");
  let result = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(result.failures.some((failure) => /cue marker/.test(failure)), false, result.failures.join("; "));

  fs.writeFileSync(markerPath, `Wrong,Header,Fields\n${markerRows.join("\n")}\n`);
  markerEntry.byte_size = fs.statSync(markerPath).size;
  markerEntry.sha256 = require("../score-engine/score-provenance.js").sha256File(markerPath);
  approval.identity.approval_artifact_manifest_hash = require("../score-engine/score-provenance.js").artifactManifestHash(approval.artifact_manifest);
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n");
  result = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.ok(result.failures.some((failure) => /cue markers header/.test(failure)), result.failures.join("; "));
});

test("verifier completeness: cue markers must match IDs, names, values, and order", () => {
  for (const mutation of [
    (rows) => { const values = rows[1].split(","); values[1] = "0.5"; rows[1] = values.join(","); },
    (rows) => { if (rows.length > 2) [rows[1], rows[2]] = [rows[2], rows[1]]; else rows[1] = rows[1].replace(/^"[^"]+"/, '"WRONG cue"'); },
    (rows) => { rows[1] = rows[1].replace(/^"[^"]+"/, '"WRONG cue"'); },
  ]) {
    const st = approvedProject(tmpEnv().options, { duration_seconds: 3 });
    const markerPath = path.join(st.dir, "approved", "resolve-import", "cue-markers.csv");
    const rows = fs.readFileSync(markerPath, "utf8").trim().split("\n");
    mutation(rows);
    fs.writeFileSync(markerPath, `${rows.join("\n")}\n`);
    const r = verifyApprovedExports(st.dir, { probeImpl: okProbeFor({ duration: 3 }) });
    assert.equal(r.verified, false);
    assert.ok(r.failures.some((failure) => /cue marker|manifest/.test(failure)), r.failures.join("; "));
  }
});

test("verifier completeness: a required truncated stem and legacy manifest absence fail closed", () => {
  const truncated = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  let r = verifyApprovedExports(truncated.dir, { probeImpl: (file) => ({ ok: true, sample_rate: 48000, channels: 2, codec: "pcm_s24le", duration: /stems[\\/]bass\.wav$/.test(file) ? 2 : 3 }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((failure) => /bass\.wav/.test(failure) && /duration/.test(failure)), r.failures.join("; "));

  const legacy = approvedProject(tmpEnv().options, { duration_seconds: 3 });
  const provenancePath = path.join(legacy.dir, "approved", "provenance.json");
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  delete provenance.artifact_manifest;
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  r = verifyApprovedExports(legacy.dir, { probeImpl: okProbeFor({ duration: 3 }) });
  assert.equal(r.verified, false);
  assert.ok(r.failures.some((failure) => /legacy|manifest/.test(failure)), r.failures.join("; "));
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
  assert.ok(html.includes("Verify sketch package"), "in-page verifier remains available");
  assert.ok(html.includes("Sketch audio is never promoted to Resolve-ready"), "no unverified Resolve-ready light");
  assert.ok(!html.includes("ST.dir"), "raw server project paths are not rendered into the workspace");
});

test("ui: score workspace robustness — no inline onclick paths, in-flight guards, stale-load guard", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  // No path is interpolated into an inline click handler.
  assert.ok(!/onclick="copyText\(/.test(html), "no inline onclick copy handlers");
  assert.ok(!html.includes("data-copy-label=\"project path\""), "server project paths are not copyable from the page");
  // Heavy actions cannot be double-clicked into concurrent runs.
  assert.ok(html.includes("if (btn.disabled) return;"), "in-flight guard on heavy buttons");
  assert.match(html, /cands-generate[\s\S]{0,400}btn\.disabled=true/, "candidate generation guarded");
  // A slow project fetch must not overwrite newer state.
  assert.ok(html.includes("let loadSeq = 0;"), "monotonic load counter");
  assert.ok(html.includes("if (seq !== loadSeq) return;"), "superseded loads bail");
});

test("ui: score workspace wires verifier button safely without exposing terminal paths", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.ok(!html.includes('id="ready-cmd"'), "absolute terminal command is not sent to the browser");
  assert.ok(!html.includes('id="ready-copy"'), "absolute terminal command is not copyable from the browser");
  assert.ok(html.includes('id="ready-verify"'), "verify button present");
  assert.ok(html.includes("Verify sketch package"), "button label is explicit about sketch scope");
  assert.ok(html.includes("const SCORE_VERIFY_API = '/api/score/verify';"), "UI posts to verify route");
  assert.ok(html.includes("if(verifyInFlight) return;"), "double submit guard");
  assert.ok(html.includes("btn.disabled = state==='verifying'"), "verifying disables the button");
  assert.ok(html.includes("Verifying…"), "verifying label wired");
  assert.ok(html.includes("result && result.verified===true"), "PASS requires verified true");
  assert.ok(html.includes("state==='request-error'"), "request-error state exists");
  assert.ok(html.includes("report.textContent"), "report uses textContent");
  assert.ok(!/ready-report[\s\S]{0,400}innerHTML/.test(html), "report is not rendered with innerHTML");
});

test("ui: score workspace confirms reject with candidate id and reversible status", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.ok(html.includes("window.confirm(`Reject ${cand}?"), "reject confirmation interpolates candidate id");
  assert.ok(html.includes("reversible — you can flip status back"), "confirmation explains reversible status");
  assert.ok(html.includes("status:'rejected'"), "reject still posts reversible status");
});

test("ui: score workspace renders cue boundary diagnostics from the shared analysis module", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "score-project.html"), "utf8");
  assert.ok(html.includes('<script src="score-engine/cue-analysis.js"></script>'), "shared analysis module loaded");
  assert.ok(html.includes("ScoreCueAnalysis.cueBoundaryDiagnostics"), "shared boundary diagnostics used");
  assert.ok(!html.includes("cueBoundaryDiagnosticsClient"), "no drift-prone client mirror remains");
  assert.ok(html.includes("addEventListener('input'"), "input event delegation wired");
  assert.ok(html.includes("addEventListener('change'"), "change event delegation wired");
  assert.ok(html.includes("renderCueBoundaryDiagnostics"), "diagnostics renderer present");
  assert.ok(html.includes("Overlap with ${m.overlap_with.other_cue_id}: ${m.overlap_with.seconds.toFixed(2)}s"), "overlap advisory format exact");
  assert.ok(html.includes("Gap before ${m.cue_id}: ${m.gap_before.seconds.toFixed(2)}s"), "gap advisory format exact");
  assert.ok(html.includes("document.createElement('span')"), "diagnostic text nodes built safely");
  assert.ok(html.includes("span.textContent=line"), "diagnostics use textContent");
});
