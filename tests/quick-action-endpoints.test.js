// Tests for the two GUI "quick action" endpoints added 2026-06-27:
//   POST /api/package-runs/reindex     -> rebuildPackageRunsIndex()
//   POST /api/daily-idea-scout/run     -> runDailyIdeaScoutNow()
// Both spawn a local script; here we inject a fake runner so the tests have no
// side effects (no real index rewrite, no VIDNAS archive write).

const { assert, packageEngineServer, test } = require("./_helpers.js");

function fakeRunner(result) {
  const calls = [];
  const runner = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return result;
  };
  runner.calls = calls;
  return runner;
}

test("rebuildPackageRunsIndex spawns the index script and reports ok on exit 0", () => {
  const runner = fakeRunner({ status: 0, stdout: "wrote package-runs-index.json\n", stderr: "" });
  const out = packageEngineServer.rebuildPackageRunsIndex({ runner });
  assert.equal(out.ok, true);
  assert.equal(out.exitCode, 0);
  assert.equal(out.command, "node scripts/package-runs-index.js");
  assert.match(out.stdout, /package-runs-index\.json/);
  assert.deepEqual(runner.calls[0].args, ["scripts/package-runs-index.js"]);
});

test("rebuildPackageRunsIndex reports ok:false on a non-zero exit", () => {
  const runner = fakeRunner({ status: 1, stdout: "", stderr: "boom" });
  const out = packageEngineServer.rebuildPackageRunsIndex({ runner });
  assert.equal(out.ok, false);
  assert.equal(out.exitCode, 1);
  assert.equal(out.stderr, "boom");
});

test("rebuildPackageRunsIndex throws 500 when the runner cannot launch", () => {
  const runner = fakeRunner({ error: new Error("ENOENT") });
  assert.throws(() => packageEngineServer.rebuildPackageRunsIndex({ runner }), /failed to launch/);
});

test("runDailyIdeaScoutNow spawns the scout launcher with no --date by default", () => {
  const runner = fakeRunner({ status: 0, stdout: "Daily Idea Scout — ok\n", stderr: "" });
  const out = packageEngineServer.runDailyIdeaScoutNow({}, { runner });
  assert.equal(out.ok, true);
  assert.deepEqual(runner.calls[0].args, ["scripts/daily-idea-scout-launch.js"]);
  assert.equal(out.command, "node scripts/daily-idea-scout-launch.js");
});

test("runDailyIdeaScoutNow passes a well-formed --date through", () => {
  const runner = fakeRunner({ status: 0, stdout: "", stderr: "" });
  packageEngineServer.runDailyIdeaScoutNow({ date: "2026-06-27" }, { runner });
  assert.deepEqual(runner.calls[0].args, ["scripts/daily-idea-scout-launch.js", "--date=2026-06-27"]);
});

test("runDailyIdeaScoutNow ignores a malformed date (no injection)", () => {
  const runner = fakeRunner({ status: 0, stdout: "", stderr: "" });
  packageEngineServer.runDailyIdeaScoutNow({ date: "; rm -rf /" }, { runner });
  assert.deepEqual(runner.calls[0].args, ["scripts/daily-idea-scout-launch.js"]);
});

test("runDailyIdeaScoutNow throws 500 when the runner cannot launch", () => {
  const runner = fakeRunner({ error: new Error("ENOENT") });
  assert.throws(() => packageEngineServer.runDailyIdeaScoutNow({}, { runner }), /failed to launch/);
});
