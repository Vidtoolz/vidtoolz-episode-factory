const assert = require("node:assert/strict");
const model = require("../episode-model.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("creates a normalized episode with required defaults", () => {
  const episode = model.createEpisode({ workingTitle: "Test episode" });

  assert.equal(episode.workingTitle, "Test episode");
  assert.equal(episode.status, "Idea");
  assert.equal(model.getGateSummary(episode).total, model.PACKAGING_GATE.length);
  assert.match(episode.productionChecklist, /Record A-roll/);
});

test("normalizes invalid status back to Idea", () => {
  const episode = model.normalizeEpisode({ status: "Unknown" });

  assert.equal(episode.status, "Idea");
});

test("duplicates reset status and preserve package fields", () => {
  const original = model.createEpisode({
    workingTitle: "Original",
    status: "Editing",
    corePromise: "Promise",
  });
  const copy = model.duplicateEpisode(original);

  assert.notEqual(copy.id, original.id);
  assert.equal(copy.status, "Idea");
  assert.equal(copy.corePromise, "Promise");
  assert.match(copy.workingTitle, /copy$/);
});

test("packaging gate reports pass fail state", () => {
  const episode = model.createEpisode({
    packagingGate: {
      "Viewer and problem are specific": true,
      "Promise is useful and believable": { passed: true },
    },
  });
  const summary = model.getGateSummary(episode);

  assert.equal(summary.passed, 2);
  assert.equal(summary.isComplete, false);
});

test("copy payloads include integration-ready context", () => {
  const episode = model.createEpisode({
    workingTitle: "Workflow video",
    topic: "Local-first production",
    corePromise: "Build faster packages",
  });

  assert.match(model.buildCopyPayload("linear", episode), /# Workflow video/);
  assert.match(model.buildCopyPayload("codex", episode), /VIDTOOLZ/);
  assert.match(model.buildCopyPayload("hermes", episode), /Packaging gate/);
  assert.match(model.buildCopyPayload("youtube", episode), /Build faster packages/);
});

test("state normalization accepts raw episode arrays", () => {
  const state = model.normalizeState({
    episodes: [{ id: "one", workingTitle: "One" }],
    selectedId: "one",
  });

  assert.equal(state.episodes.length, 1);
  assert.equal(state.selectedId, "one");
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`${passed}/${tests.length} tests passed`);
}
