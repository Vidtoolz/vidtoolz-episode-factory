const vm = require("node:vm");
const { assert, fs, http, os, packageEngineServer, path, test } = require("./_helpers.js");

const lane = require("../score-engine/score-lane.js");
const dispatch = require("../score-engine/music-dispatch.js");

function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-state-integrity-"));
  return { root, options: { settingsPath: path.join(root, "settings.json"), musicRoot: path.join(root, "music") } };
}

async function getScoreApi(options, requestPath) {
  const previousSettings = process.env.SCORE_ENGINE_SETTINGS_PATH;
  const previousRoot = process.env.SCORE_ENGINE_MUSIC_ROOT;
  process.env.SCORE_ENGINE_SETTINGS_PATH = options.settingsPath;
  process.env.SCORE_ENGINE_MUSIC_ROOT = options.musicRoot;
  const server = packageEngineServer.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return await new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: server.address().port, path: requestPath }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(body && body.data !== undefined ? body.data : body);
        });
      }).on("error", reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSettings === undefined) delete process.env.SCORE_ENGINE_SETTINGS_PATH;
    else process.env.SCORE_ENGINE_SETTINGS_PATH = previousSettings;
    if (previousRoot === undefined) delete process.env.SCORE_ENGINE_MUSIC_ROOT;
    else process.env.SCORE_ENGINE_MUSIC_ROOT = previousRoot;
  }
}

test("music creator lifecycle: plan revisions preserve history while current approval follows cue provenance", async () => {
  const { options } = tmpEnv();
  const script = "A grieving human remembers a loved one. The memory is intimate, tender, and full of care and loss.";
  const { project } = lane.createScoreProject({
    name: "Untitled 8472",
    duration_seconds: 12,
    script_text: script,
    overall_mood: "curious",
  }, options);

  // Flow A + E: the neutral project name cannot select the emotional family;
  // the persisted script snapshot must do it after project creation.
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  const firstGeneration = lane.generateCandidates(project.project_id, {
    count: 1,
    script_text: "A silly pratfall, a rubber chicken, and an absurd punchline.",
  }, options);
  assert.equal(firstGeneration.contrast_family, "emotional");
  assert.match(firstGeneration.candidates[0].interpretation.interpretation_id, /^emo-/);
  assert.equal(firstGeneration.candidates[0].plan_revision_id, firstGeneration.current_plan_revision);

  const prepared = dispatch.prepareMusicGeneration(project.project_id, { candidate_count: 1 }, options);
  assert.match(prepared.candidates[0].interpretation.interpretation_id, /^emo-/,
    "MiniMax preparation must use the same authoritative script snapshot");
  assert.equal(prepared.candidates[0].plan_revision_id, firstGeneration.current_plan_revision,
    "prepared MiniMax candidates retain the cue-plan revision before dispatch");

  lane.approveCandidate(project.project_id, "candidate-001", options);
  let state = lane.getProject(project.project_id, options);
  assert.equal(state.approval_current, true);
  assert.equal(state.state_integrity.plan_approved, true);
  assert.equal(state.state_integrity.current_candidate_count, 2,
    "Scorecraft and prepared MiniMax candidates share current revision truth");
  assert.equal(state.candidates[0].current_plan_revision, true);
  const firstRevision = state.state_integrity.current_plan_revision;
  const approvedMix = path.join(state.dir, "approved", "mix.wav");
  assert.equal(fs.existsSync(approvedMix), true);

  // Flow B: a cue edit issues a new plan revision. Nothing
  // historical is deleted, but generation and downstream approval are closed.
  const revision = lane.reviseCandidate(project.project_id, "candidate-001", "stronger ending", options);
  const revisedSnapshot = JSON.parse(fs.readFileSync(path.join(
    state.dir, "candidates", revision.candidate.candidate_id, "cue-sheet-used.json",
  ), "utf8"));
  lane.saveCueSheetEdits(project.project_id, revisedSnapshot.cues, options);
  state = lane.getProject(project.project_id, options);
  assert.equal(state.project.cue_sheet_approved, false);
  assert.notEqual(state.state_integrity.current_plan_revision, firstRevision);
  assert.equal(state.approval_current, false);
  assert.equal(state.state_integrity.approved_export_exists, true);
  assert.equal(state.state_integrity.current_candidate_count, 0);
  assert.equal(state.state_integrity.historical_candidate_count, 3);
  assert.equal(state.candidates[0].current_plan_revision, false);
  assert.equal(state.candidates.find((item) => item.candidate_id === revision.candidate.candidate_id).current_plan_revision, false,
    "a proposed revision remains historical until a candidate is generated from the approved adopted plan");
  assert.equal(fs.existsSync(approvedMix), true, "preserved historical export remains on disk");
  assert.throws(() => lane.generateCandidates(project.project_id, { count: 1 }, options), /Approve the cue sheet first/);
  const staleListEntry = lane.listProjects(options).find((item) => item.project_id === project.project_id);
  assert.equal(staleListEntry.approval_current, false);
  assert.equal(staleListEntry.approved, false);
  assert.equal(staleListEntry.approved_export_exists, true);
  const staleApi = await getScoreApi(options, `/api/score/project?id=${encodeURIComponent(project.project_id)}`);
  assert.equal(staleApi.approval_current, false, "HTTP state exposes stale approval truth");
  assert.equal(staleApi.state_integrity.plan_approved, false);
  assert.equal(staleApi.state_integrity.approved_export_exists, true);

  // Flow D: the stale/current distinction is derived entirely from persisted
  // hashes and flags, so reopening the project cannot repair it accidentally.
  const reopenedStale = lane.getProject(project.project_id, options);
  assert.equal(reopenedStale.approval_current, false);
  assert.equal(reopenedStale.state_integrity.plan_approved, false);

  // Flow C: reapprove the revised plan, generate a provenance-bound candidate,
  // and establish a new current approval while archiving the prior export.
  lane.approveCueSheet(project.project_id, options);
  const secondGeneration = lane.generateCandidates(project.project_id, { count: 1 }, options);
  assert.notEqual(secondGeneration.current_plan_revision, firstRevision);
  assert.equal(secondGeneration.candidates[0].plan_revision_id, secondGeneration.current_plan_revision);
  lane.approveCandidate(project.project_id, "candidate-003", options);
  const reopenedCurrent = lane.getProject(project.project_id, options);
  assert.equal(reopenedCurrent.approval_current, true);
  assert.equal(reopenedCurrent.state_integrity.plan_approved, true);
  assert.equal(reopenedCurrent.state_integrity.current_candidate_count, 1);
  assert.equal(reopenedCurrent.state_integrity.historical_candidate_count, 3);
  assert.equal(reopenedCurrent.candidates.find((item) => item.candidate_id === "candidate-003").current_plan_revision, true);
  assert.equal(reopenedCurrent.candidates.find((item) => item.candidate_id === "candidate-001").current_plan_revision, false);
  assert.ok(fs.readdirSync(reopenedCurrent.dir).some((name) => name.startsWith("approved-archive-")),
    "prior approved export is retained as history after replacement");
  const currentListEntry = lane.listProjects(options).find((item) => item.project_id === project.project_id);
  assert.equal(currentListEntry.approval_current, true);
  assert.equal(currentListEntry.approved, true);
  const currentApi = await getScoreApi(options, `/api/score/project?id=${encodeURIComponent(project.project_id)}`);
  assert.equal(currentApi.approval_current, true, "HTTP state survives restart/reload as current");
  assert.equal(currentApi.state_integrity.current_plan_revision, secondGeneration.current_plan_revision);
});

test("music creator provenance: re-saving identical cues still issues a new approval revision", () => {
  const { options } = tmpEnv();
  const { project } = lane.createScoreProject({
    name: "Untitled 9136",
    duration_seconds: 6,
    script_text: "A restrained and serious reflection on irreversible loss.",
  }, options);
  lane.generateCuesForProject(project.project_id, {}, options);
  lane.approveCueSheet(project.project_id, options);
  lane.generateCandidates(project.project_id, { count: 1 }, options);
  lane.approveCandidate(project.project_id, "candidate-001", options);
  const before = lane.getProject(project.project_id, options);

  lane.saveCueSheetEdits(project.project_id, before.project.cues, options);
  const after = lane.getProject(project.project_id, options);
  assert.notEqual(after.state_integrity.current_plan_revision, before.state_integrity.current_plan_revision);
  assert.equal(after.approval_current, false);
  assert.equal(after.state_integrity.current_candidate_count, 0);
  assert.throws(() => lane.generateCandidates(project.project_id, { count: 1 }, options), /Approve the cue sheet first/);

  lane.approveCueSheet(project.project_id, options);
  assert.throws(() => lane.approveCandidate(project.project_id, "candidate-001", options), /plan_revision_changed/,
    "content equality must not let a candidate cross a newly issued human-approval revision");
});

test("music creator UI: independent facts keep stale history from reopening current actions", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "music-creator.html"), "utf8");
  const start = page.indexOf("function projectFacts()");
  const end = page.indexOf("function planWords()", start);
  assert.ok(start >= 0 && end > start, "projectFacts is extractable for regression testing");
  const source = page.slice(start, end);
  const ST = {
    project: { cues: [{ cue_id: "cue-01" }], cue_sheet_approved: false },
    candidates: [
      { candidate_id: "candidate-001", current_plan_revision: false },
      { candidate_id: "candidate-002", current_plan_revision: true },
    ],
    approved: { approved_candidate: "candidate-001" },
    approval_current: false,
    state_integrity: {
      has_cues: true,
      plan_approved: false,
      has_current_candidates: true,
      approved_export_exists: true,
    },
  };
  const facts = vm.runInNewContext(`let ST=${JSON.stringify(ST)}; ${source}; projectFacts();`);
  assert.equal(facts.hasCues, true);
  assert.equal(facts.planApproved, false);
  assert.equal(facts.hasCurrentCandidates, true);
  assert.equal(facts.currentCandidates.length, 1);
  assert.equal(facts.historicalCandidates.length, 1);
  assert.equal(facts.approvedExportExists, true);
  assert.equal(facts.approvalCurrent, false);
  assert.doesNotMatch(page, /function projectState\(|\.phase\s*[<>]=?/,
    "Music Creator must not regress to one ordinal phase");
  assert.match(page, /btn-plan'\)\.disabled = busy \|\| !ST \|\| facts\.planApproved/);
  assert.match(page, /btn-generate'\)\.disabled = busy \|\| !ST \|\| !facts\.planApproved/);
  assert.match(page, /Historical approval:/);
  assert.match(page, /isCurrentApproval/,
    "only the exact current approved candidate receives the approved UI treatment");
});
