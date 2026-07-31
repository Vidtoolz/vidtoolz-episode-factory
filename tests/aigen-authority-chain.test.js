const {
  assert,
  fs,
  os,
  path,
  test,
} = require("./_helpers.js");

const authority = require("../aigen-authority-chain.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");
const authorityCli = require("../scripts/aigen-authority-chain.js");

function write(pkg, rel, content) {
  const target = path.join(pkg, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aigen-authority-"));
  const pkg = path.join(root, "authority-fixture");
  fs.mkdirSync(pkg, { recursive: true });
  write(pkg, "selected-package.json", JSON.stringify({ package: { title: "Authority Fixture" } }));
  write(pkg, "script/script-final.md", `# Final Script\n\n${"script authority ".repeat(20)}\n`);
  write(pkg, "image-prompts.json", JSON.stringify({
    image_prompts: [{ index: 1, prompt: "A concrete full-screen vertical scene tied to the current script." }],
  }));
  write(pkg, "images/flux-local/flux-001.png", "reviewed image bytes v1");
  write(pkg, "flux-generation-manifest.json", JSON.stringify({
    items: [{ prompt_index: 1, status: "complete", output_path: "images/flux-local/flux-001.png" }],
  }));
  write(pkg, "selected-images.json", JSON.stringify({
    selections: [{ prompt_index: 1, selected_path: "images/flux-local/flux-001.png" }],
  }));
  write(pkg, "video-prompts.json", JSON.stringify({
    prompts: [{ prompt_index: 1, prompt: "Slow push in with subtle atmospheric movement." }],
  }));
  write(pkg, "videos/mp4/001.mp4", "reviewed video bytes v1");
  write(pkg, "resolve-handoff/media-manifest.json", JSON.stringify({
    video_variant: "mp4",
    included_indexes: [1],
    clips: [{ prompt_index: 1, staged_video_relative_path: "videos/mp4/001.mp4" }],
  }));
  return { root, pkg };
}

function bindFull(pkg) {
  authority.recordStage(pkg, "image_prompts");
  authority.recordStage(pkg, "selected_images");
  authority.recordStage(pkg, "i2v_prompts");
  authority.recordVideoSlots(pkg, { variant: "mp4", indexes: [1] });
  authority.recordStage(pkg, "resolve_handoff", { variant: "mp4", indexes: [1] });
}

test("aigen authority: a fully bound chain reaches Resolve handoff", () => {
  const fx = fixture();
  try {
    bindFull(fx.pkg);
    const state = resolveProjectState(fx.pkg);
    assert.equal(state.authority.status, "fresh");
    assert.equal(state.stage, "resolve_handoff");
    assert.equal(state.blockers.length, 0);
    assert.equal(chooseNextTask(state).id, "edit_in_resolve");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority: final-script byte drift invalidates every downstream stage without deleting evidence", () => {
  const fx = fixture();
  try {
    bindFull(fx.pkg);
    const handoffBefore = fs.readFileSync(path.join(fx.pkg, "resolve-handoff/media-manifest.json"), "utf8");
    write(fx.pkg, "script/script-final.md", `# Revised Final Script\n\n${"new authority ".repeat(30)}\n`);
    const state = resolveProjectState(fx.pkg);
    assert.equal(state.stage, "image_prompts");
    assert.equal(state.authority.status, "stale");
    assert.equal(state.authority.first_invalid_stage, "image_prompts");
    assert.match(state.blockers[0], /obsolete upstream authority|stale/i);
    assert.equal(chooseNextTask(state).blocked, true);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "resolve-handoff/media-manifest.json"), "utf8"), handoffBefore);
    assert.equal(fs.existsSync(path.join(fx.pkg, "videos/mp4/001.mp4")), true);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority: reviewed-image byte drift invalidates selection before I2V or video use", () => {
  const fx = fixture();
  try {
    bindFull(fx.pkg);
    write(fx.pkg, "images/flux-local/flux-001.png", "reviewed image bytes v2");
    const selected = authority.validateStage(fx.pkg, "selected_images");
    assert.equal(selected.ok, false);
    assert.equal(selected.status, "stale");
    assert.equal(selected.code, "AUTHORITY_ARTIFACT_STALE");
    const state = resolveProjectState(fx.pkg);
    assert.equal(state.stage, "image_review");
    assert.equal(state.authority.first_invalid_stage, "selected_images");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority: clip byte drift invalidates the Resolve handoff", () => {
  const fx = fixture();
  try {
    bindFull(fx.pkg);
    write(fx.pkg, "videos/mp4/001.mp4", "reviewed video bytes v2");
    const video = authority.validateStage(fx.pkg, "videos");
    assert.equal(video.ok, false);
    assert.equal(video.code, "VIDEO_SLOT_BYTES_STALE");
    const handoff = authority.validateStage(fx.pkg, "resolve_handoff");
    assert.equal(handoff.ok, false);
    assert.match(handoff.message, /blocked by videos|video authority/i);
    const state = resolveProjectState(fx.pkg);
    assert.equal(state.stage, "video_generation");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority: recording an upstream replacement explicitly invalidates downstream records", () => {
  const fx = fixture();
  try {
    bindFull(fx.pkg);
    write(fx.pkg, "image-prompts.json", JSON.stringify({
      image_prompts: [{ index: 1, prompt: "A deliberately replaced current visual prompt." }],
    }));
    authority.recordStage(fx.pkg, "image_prompts");
    const ledger = authority.readAuthorityLedger(fx.pkg);
    assert.ok(ledger.stages.selected_images.invalidated_at);
    assert.ok(ledger.stages.i2v_prompts.invalidated_at);
    assert.ok(ledger.stages.videos.invalidated_at);
    assert.ok(ledger.stages.resolve_handoff.invalidated_at);
    assert.equal(authority.validateStage(fx.pkg, "image_prompts").ok, true);
    assert.equal(authority.validateStage(fx.pkg, "selected_images").code, "AUTHORITY_STAGE_INVALIDATED");
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority: malformed or duplicate slot arrays cannot be content-bound", () => {
  const fx = fixture();
  try {
    for (const malformed of [
      "{",
      JSON.stringify({ image_prompts: null }),
      JSON.stringify({ image_prompts: [{ index: 1 }, { index: 1 }] }),
      JSON.stringify({ image_prompts: [{ index: "not-a-slot" }] }),
    ]) {
      write(fx.pkg, "image-prompts.json", malformed);
      assert.throws(
        () => authority.recordStage(fx.pkg, "image_prompts"),
        (error) => error.code === "AUTHORITY_INPUT_CORRUPT",
      );
    }
    assert.equal(fs.existsSync(path.join(fx.pkg, authority.AUTHORITY_FILE)), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

for (const [name, malformed] of [
  ["unparseable JSON", "{"],
  ["null", "null"],
  ["array", "[]"],
  ["scalar", "7"],
  ["wrong-shaped stages", JSON.stringify({ schema_version: 1, project_id: "authority-fixture", stages: [] })],
  ["null history", JSON.stringify({ schema_version: 1, project_id: "authority-fixture", stages: {}, history: null })],
  ["object history", JSON.stringify({ schema_version: 1, project_id: "authority-fixture", stages: {}, history: {} })],
  ["scalar history", JSON.stringify({ schema_version: 1, project_id: "authority-fixture", stages: {}, history: 7 })],
]) {
  test(`aigen authority: malformed ledger ${name} fails closed and is not overwritten`, () => {
    const fx = fixture();
    try {
      const ledgerPath = path.join(fx.pkg, authority.AUTHORITY_FILE);
      write(fx.pkg, authority.AUTHORITY_FILE, malformed);
      const before = fs.readFileSync(ledgerPath, "utf8");
      const result = authority.validateStage(fx.pkg, "image_prompts");
      assert.equal(result.ok, false);
      assert.equal(result.status, "corrupt");
      assert.equal(result.code, "AUTHORITY_LEDGER_CORRUPT");
      assert.throws(
        () => authority.recordStage(fx.pkg, "image_prompts"),
        (error) => error.code === "AUTHORITY_LEDGER_CORRUPT",
      );
      assert.equal(fs.readFileSync(ledgerPath, "utf8"), before);
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  });
}

test("aigen authority: dispatch completion cannot bind outputs after source authority drifts", () => {
  const fx = fixture();
  try {
    authority.recordStage(fx.pkg, "image_prompts");
    authority.recordStage(fx.pkg, "selected_images");
    authority.recordStage(fx.pkg, "i2v_prompts");
    const dispatched = authority.captureSourceRevisions(fx.pkg, "videos");
    write(fx.pkg, "video-prompts.json", JSON.stringify({
      prompts: [{ prompt_index: 1, prompt: "A different motion prompt after dispatch." }],
    }));
    assert.throws(
      () => authority.recordVideoSlots(fx.pkg, {
        variant: "mp4",
        indexes: [1],
        expectedSourceRevisions: dispatched,
      }),
      (error) => error.code === "UPSTREAM_AUTHORITY_INVALID" || error.code === "VIDEO_DISPATCH_AUTHORITY_DRIFT",
    );
    assert.equal(authority.validateStage(fx.pkg, "videos").ok, false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority CLI: inspect is read-only and reports an unbound legacy package", () => {
  const fx = fixture();
  try {
    const before = fs.readdirSync(fx.pkg).sort();
    const result = authorityCli.run(["inspect", "--package-dir", fx.pkg, "--json"]);
    assert.equal(result.read_only, true);
    assert.equal(result.inspection.ok, false);
    assert.equal(result.inspection.first_invalid.status, "unbound");
    assert.deepEqual(fs.readdirSync(fx.pkg).sort(), before);
    assert.equal(fs.existsSync(path.join(fx.pkg, authority.AUTHORITY_FILE)), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority CLI: bind-current requires explicit confirmation and writes nothing without it", () => {
  const fx = fixture();
  try {
    assert.throws(
      () => authorityCli.run(["bind-current", "--package-dir", fx.pkg, "--through", "resolve_handoff"]),
      (error) => error.code === "CONFIRMATION_REQUIRED",
    );
    assert.equal(fs.existsSync(path.join(fx.pkg, authority.AUTHORITY_FILE)), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority CLI: confirmed legacy binding records the reviewed chain only", () => {
  const fx = fixture();
  try {
    const protectedBefore = {
      script: fs.readFileSync(path.join(fx.pkg, "script/script-final.md"), "utf8"),
      image: fs.readFileSync(path.join(fx.pkg, "images/flux-local/flux-001.png"), "utf8"),
      video: fs.readFileSync(path.join(fx.pkg, "videos/mp4/001.mp4"), "utf8"),
      handoff: fs.readFileSync(path.join(fx.pkg, "resolve-handoff/media-manifest.json"), "utf8"),
    };
    const result = authorityCli.run([
      "bind-current",
      "--package-dir", fx.pkg,
      "--through", "resolve_handoff",
      "--video-variant", "mp4",
      "--confirm-current-chain",
      "--json",
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.changed, ["image_prompts", "selected_images", "i2v_prompts", "videos", "resolve_handoff"]);
    assert.equal(result.inspection.ok, true);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "script/script-final.md"), "utf8"), protectedBefore.script);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "images/flux-local/flux-001.png"), "utf8"), protectedBefore.image);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "videos/mp4/001.mp4"), "utf8"), protectedBefore.video);
    assert.equal(fs.readFileSync(path.join(fx.pkg, "resolve-handoff/media-manifest.json"), "utf8"), protectedBefore.handoff);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("aigen authority CLI: a failed multi-stage bind rolls the ledger back byte-for-byte", () => {
  const fx = fixture();
  try {
    fs.rmSync(path.join(fx.pkg, "videos", "mp4", "001.mp4"));
    assert.throws(
      () => authorityCli.run([
        "bind-current",
        "--package-dir", fx.pkg,
        "--through", "resolve_handoff",
        "--video-variant", "mp4",
        "--confirm-current-chain",
      ]),
      /Authority input is missing/,
    );
    assert.equal(fs.existsSync(path.join(fx.pkg, authority.AUTHORITY_FILE)), false);

    authorityCli.run([
      "bind-current",
      "--package-dir", fx.pkg,
      "--through", "selected_images",
      "--confirm-current-chain",
    ]);
    const ledgerPath = path.join(fx.pkg, authority.AUTHORITY_FILE);
    const before = fs.readFileSync(ledgerPath);
    assert.throws(
      () => authorityCli.run([
        "bind-current",
        "--package-dir", fx.pkg,
        "--through", "resolve_handoff",
        "--video-variant", "mp4",
        "--confirm-current-chain",
      ]),
      /Authority input is missing/,
    );
    assert.deepEqual(fs.readFileSync(ledgerPath), before);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
