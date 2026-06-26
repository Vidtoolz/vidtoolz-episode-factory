/**
 * VIDTOOLZ Episode Factory Tests — Submitted Topics
 * Tests for: scripts/submitted-topics.js
 *
 * Tests the submitted-topics CRUD manager: save, list, get, review, update status.
 * This module is separate from topic-scout.js (the YouTube/news research tool).
 */

const {
  assert,
  fs,
  os,
  path,
  submittedTopicsScript,
  test,
} = require("./_helpers.js");

function createTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "submitted-topics-"));
  const runId = "2026-06-25-test-ideation";
  const runDir = path.join(tmp, "package-runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  return { tmp, runId, runDir };
}

test("submitted topics: save creates a JSON file in submitted-topics/", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const record = submittedTopicsScript.saveSubmittedTopic(tmp, runId, "AI editing workflow for Resolve");

    assert.ok(record.id, "record must have an id");
    assert.equal(record.topicText, "AI editing workflow for Resolve");
    assert.equal(record.status, "submitted");
    assert.ok(record.review, "record must have a review");
    assert.equal(record.review.totalCount, 7);

    // File exists
    const dir = path.join(tmp, "package-runs", runId, "submitted-topics");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    assert.equal(files.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: list returns all saved topics", () => {
  const { tmp, runId } = createTempRepo();
  try {
    submittedTopicsScript.saveSubmittedTopic(tmp, runId, "Green screen AI background workflow");
    submittedTopicsScript.saveSubmittedTopic(tmp, runId, "Color grading with ComfyUI generated images");

    const topics = submittedTopicsScript.listSubmittedTopics(tmp, runId);
    assert.equal(topics.length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: get retrieves a single topic by id", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const saved = submittedTopicsScript.saveSubmittedTopic(tmp, runId, "Kling vs Wan 2.2 comparison");
    const fetched = submittedTopicsScript.getSubmittedTopic(tmp, runId, saved.id);
    assert.deepEqual(fetched, saved);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: get returns null for non-existent topic", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const fetched = submittedTopicsScript.getSubmittedTopic(tmp, runId, "nonexistent-id");
    assert.equal(fetched, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: duplicate submission returns duplicate flag", () => {
  const { tmp, runId } = createTempRepo();
  try {
    submittedTopicsScript.saveSubmittedTopic(tmp, runId, "AI B-roll labeling workflow");
    const dup = submittedTopicsScript.saveSubmittedTopic(tmp, runId, "AI B-roll labeling workflow");
    assert.equal(dup.duplicate, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: review has 7 criteria checks", () => {
  const review = submittedTopicsScript.reviewTopic("Show how to use ComfyUI for video editing workflow");
  assert.equal(review.checks.length, 7);
  assert.equal(review.totalCount, 7);
  assert.ok(review.passedCount > 0, "should pass at least some checks");
  assert.ok(review.recommendation, "must have a recommendation string");
  assert.match(review.note, /not an approval/);
});

test("submitted topics: review flags blanket anti-AI language", () => {
  const review = submittedTopicsScript.reviewTopic("AI is bad for video editing");
  const trustCheck = review.checks.find(c => c.criterion.includes("Trust Risk"));
  assert.equal(trustCheck.passed, false);
});

test("submitted topics: review flags abandoned proof-plan topic", () => {
  const review = submittedTopicsScript.reviewTopic("Proof plan for AI videos before you start");
  const echoCheck = review.checks.find(c => c.criterion.includes("Abandoned"));
  assert.equal(echoCheck.passed, false);
});

test("submitted topics: save rejects empty text", () => {
  const { tmp, runId } = createTempRepo();
  try {
    assert.throws(() => submittedTopicsScript.saveSubmittedTopic(tmp, runId, ""), /Topic text is required/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: save rejects text under 5 characters", () => {
  const { tmp, runId } = createTempRepo();
  try {
    assert.throws(() => submittedTopicsScript.saveSubmittedTopic(tmp, runId, "AI"), /at least 5 characters/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: save rejects text over 500 characters", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const longText = "A".repeat(501);
    assert.throws(() => submittedTopicsScript.saveSubmittedTopic(tmp, runId, longText), /under 500 characters/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: save throws 404 for non-existent run", () => {
  const { tmp } = createTempRepo();
  try {
    assert.throws(
      () => submittedTopicsScript.saveSubmittedTopic(tmp, "nonexistent-run", "AI editing workflow"),
      /Run not found/
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: updateTopicStatus changes status", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const saved = submittedTopicsScript.saveSubmittedTopic(tmp, runId, "OBS recording workflow for Resolve");
    const updated = submittedTopicsScript.updateTopicStatus(tmp, runId, saved.id, "selected");
    assert.equal(updated.status, "selected");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: updateTopicStatus returns null for non-existent topic", () => {
  const { tmp, runId } = createTempRepo();
  try {
    const result = submittedTopicsScript.updateTopicStatus(tmp, runId, "nonexistent", "selected");
    assert.equal(result, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: list returns empty array for non-existent run", () => {
  const { tmp } = createTempRepo();
  try {
    const topics = submittedTopicsScript.listSubmittedTopics(tmp, "nonexistent-run");
    assert.deepEqual(topics, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("submitted topics: list returns empty array for null runId", () => {
  const { tmp } = createTempRepo();
  try {
    const topics = submittedTopicsScript.listSubmittedTopics(tmp, null);
    assert.deepEqual(topics, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
