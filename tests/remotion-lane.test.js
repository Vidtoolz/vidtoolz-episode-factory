// Tests for the Remotion brandkit render lane (2026-06-27).
// Uses an injected fake spawn + temp dirs — no real renders, no brandkit invocation.
const { assert, fs, os, path, test } = require("./_helpers.js");
const remotion = require("../remotion-lane.js");

function fakeChild() {
  const handlers = {};
  return {
    pid: 4242,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (ev, cb) => { handlers[ev] = cb; },
    kill: () => {},
    _fire: (ev, ...args) => handlers[ev] && handlers[ev](...args),
  };
}

function makeAvailableBrandkitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-brandkit-root-"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "index.tsx"), "// fixture\n", "utf8");
  return root;
}

test("remotion availability: default root reflects local install state", () => {
  const expected = fs.existsSync(path.join(remotion.BRANDKIT_ROOT, "package.json"))
    && fs.existsSync(path.join(remotion.BRANDKIT_ROOT, "node_modules"))
    && fs.existsSync(path.join(remotion.BRANDKIT_ROOT, "src", "index.tsx"))
    ? "available"
    : "unavailable";
  const actual = remotion.availability();
  assert.equal(actual.root, remotion.BRANDKIT_ROOT);
  assert.equal(actual.status, expected);
  assert.match(actual.detail, expected === "available" ? /brandkit installed/ : /missing or has no node_modules/);
});

test("remotion availability: available for an installed brandkit root", () => {
  assert.equal(remotion.availability({ root: makeAvailableBrandkitRoot() }).status, "available");
});

test("remotion availability: unavailable for a missing root", () => {
  assert.equal(remotion.availability({ root: "/nonexistent/brandkit" }).status, "unavailable");
});

test("remotion status exposes the 5 compositions and the render targets", () => {
  const s = remotion.status({ root: "/nonexistent/brandkit", mp4Dir: "/nonexistent/mp4" });
  assert.equal(s.ok, true);
  assert.equal(s.compositions.length, 5);
  assert.ok(s.targets.some((t) => t.key === "all"));
  assert.deepEqual(s.renders, []); // bogus mp4 dir -> empty
});

test("remotion listRenders reads mp4 files from a directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-renders-"));
  fs.writeFileSync(path.join(dir, "IntroSting.mp4"), "x");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
  const renders = remotion.listRenders({ mp4Dir: dir });
  assert.equal(renders.length, 1);
  assert.equal(renders[0].file, "IntroSting.mp4");
});

test("remotion startRender rejects an unknown target with 400", () => {
  remotion.STATE.activeJob = null;
  assert.throws(
    () => remotion.startRender({ target: "rm -rf" }, { root: remotion.BRANDKIT_ROOT, spawn: () => fakeChild() }),
    /Unknown render target/,
  );
});

test("remotion startRender rejects when the brandkit is unavailable (503)", () => {
  remotion.STATE.activeJob = null;
  assert.throws(
    () => remotion.startRender({ target: "all" }, { root: "/nonexistent/brandkit", spawn: () => fakeChild() }),
    /not available/,
  );
});

test("remotion startRender spawns npm run <script> and tracks an active job", () => {
  remotion.STATE.activeJob = null;
  const root = makeAvailableBrandkitRoot();
  const calls = [];
  const child = fakeChild();
  const out = remotion.startRender(
    { target: "all" },
    { root, spawn: (bin, args, opts) => { calls.push({ bin, args, cwd: opts.cwd }); return child; } },
  );
  assert.equal(out.ok, true);
  assert.ok(out.job_id);
  assert.equal(calls[0].bin, "npm");
  assert.deepEqual(calls[0].args, ["run", "render:all"]);
  assert.equal(calls[0].cwd, root);
  assert.equal(remotion.currentJobStatus().active, true);

  // a second concurrent render is refused
  assert.throws(
    () => remotion.startRender({ target: "all" }, { root, spawn: () => fakeChild() }),
    /already running/,
  );

  // close handler marks the job completed
  child._fire("close", 0);
  const after = remotion.currentJobStatus();
  assert.equal(after.active, false);
  assert.equal(after.exit_state, "completed");
});

test("remotion cancelRender signals an active job", () => {
  remotion.STATE.activeJob = null;
  const root = makeAvailableBrandkitRoot();
  const child = fakeChild();
  let sig = null;
  child.kill = (s) => { sig = s; };
  remotion.startRender({ target: "all" }, { root, spawn: () => child });
  const res = remotion.cancelRender();
  assert.equal(res.ok, true);
  assert.equal(sig, "SIGTERM");
  assert.equal(remotion.currentJobStatus().exit_state, "cancelled");
  remotion.STATE.activeJob = null;
});
