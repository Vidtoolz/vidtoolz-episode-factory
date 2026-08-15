// EXPERIMENTAL MiniMax reference adapter tests — pure brief→caption
// translation only. All trajectory/aggregation reasoning is tested in
// score-brief-exporter.test.js; the adapter must never do any of it.
const { assert, fs, path, test } = require("./_helpers.js");
const adapter = require("../score-engine/adapters/minimax-caption-reference.js");

const FIXTURE = path.join(__dirname, "fixtures/music-render-brief/example-brief.json");

function minimalBrief(extra = {}) {
  return {
    brief_id: "adapter-test-brief-v1",
    brief_version: 1,
    purpose: "Background score for adapter tests.",
    target_duration_s: 60,
    tempo: "96",
    key_mode: "D minor",
    energy_curve: "flat-low",
    emotion_curve: ["curious", "warm"],
    instrumentation: { required: [], allowed: [] },
    avoid: [],
    sections: [{ name: "low-energy bed", start_s: 0, end_s: 60, notes: "static harmonic bed" }],
    narration_density: [{ start_s: 0, end_s: 60, density: "high" }],
    ending: "clear-button",
    loopability: false,
    mix_role: "underlay",
    ...extra,
  };
}

test("adapter renders one section into the Arrangement block", () => {
  const { caption, blocks } = adapter.renderMiniMaxCaption(minimalBrief());
  assert.match(blocks.arrangement, /0:00-1:00 low-energy bed: static harmonic bed\./);
  assert.match(blocks.global_metadata, /96 BPM, D minor, 60 seconds/);
  assert.match(blocks.global_metadata, /Must stay behind continuous narration\./);
  assert.ok(caption.startsWith("[Global Metadata]\n"));
  assert.ok(caption.includes("\n\n[Vocal Details]\n"));
  assert.ok(caption.includes("\n\n[Arrangement]\n"));
});

test("multiple sections preserve order and timing exactly", () => {
  const brief = minimalBrief({
    sections: [
      { name: "restrained under narration", start_s: 0, end_s: 42, notes: "sparse" },
      { name: "tension build", start_s: 42, end_s: 75, notes: "add texture" },
      { name: "closing resolution", start_s: 75, end_s: 90, notes: "resolve" },
    ],
    target_duration_s: 90,
  });
  const { blocks } = adapter.renderMiniMaxCaption(brief);
  const a = blocks.arrangement;
  assert.ok(a.indexOf("0:00-0:42 restrained under narration") < a.indexOf("0:42-1:15 tension build"));
  assert.ok(a.indexOf("0:42-1:15 tension build") < a.indexOf("1:15-1:30 closing resolution"));
});

test("vocal details are always explicitly instrumental", () => {
  const { blocks } = adapter.renderMiniMaxCaption(minimalBrief());
  assert.equal(blocks.vocal_details, "Instrumental. No vocals of any kind.");
});

test("instrumentation and avoid propagate; required lands in the first section", () => {
  const brief = minimalBrief({
    instrumentation: { required: ["soft electric piano", "warm sub bass"], allowed: ["muted pad"] },
    avoid: ["brass", "risers"],
  });
  const { blocks } = adapter.renderMiniMaxCaption(brief);
  assert.match(blocks.arrangement, /low-energy bed: soft electric piano and warm sub bass; static harmonic bed\./);
  assert.match(blocks.arrangement, /Allowed colors: muted pad\./);
  assert.match(blocks.arrangement, /Avoid: brass, risers\.$/);
});

test("every ending enum translates to its sentence", () => {
  const expectations = {
    "clear-button": /End on a clear button, not a fade\./,
    "fade": /End with a gentle fade\./,
    "sting": /End with a short sting\./,
    "loop-ready-tail": /End with a loop-ready tail\./,
  };
  for (const [ending, pattern] of Object.entries(expectations)) {
    const { blocks } = adapter.renderMiniMaxCaption(minimalBrief({ ending }));
    assert.match(blocks.arrangement, pattern, ending);
  }
});

test("loopability adds a loop requirement without changing section structure", () => {
  const plain = adapter.renderMiniMaxCaption(minimalBrief());
  const loopy = adapter.renderMiniMaxCaption(minimalBrief({ loopability: true }));
  assert.ok(!plain.blocks.arrangement.includes("loop cleanly"));
  assert.match(loopy.blocks.arrangement, /The cue must loop cleanly from end back to start\./);
  assert.match(loopy.blocks.arrangement, /0:00-1:00 low-energy bed/);
});

test("identical brief produces a byte-identical caption (deterministic)", () => {
  const brief = minimalBrief();
  const a = adapter.renderMiniMaxCaption(JSON.parse(JSON.stringify(brief)));
  const b = adapter.renderMiniMaxCaption(JSON.parse(JSON.stringify(brief)));
  assert.equal(a.caption, b.caption);
});

test("adapter refuses invalid briefs with field-specific errors", () => {
  const broken = minimalBrief({ energy_curve: "wavy" });
  assert.throws(() => adapter.renderMiniMaxCaption(broken), /energy_curve: invalid enum value/);
  const extra = minimalBrief();
  extra.scorecraft_project = "leak";
  assert.throws(() => adapter.renderMiniMaxCaption(extra), /additional property not allowed/);
});

test("adapter does not mutate the brief and needs no Scorecraft context", () => {
  // Isolation proof: a standalone parsed JSON object with no project id,
  // no directory, no cue sheet, no filesystem access — and the module source
  // itself never touches Scorecraft internals or the filesystem.
  const brief = minimalBrief();
  const frozen = JSON.stringify(brief);
  adapter.renderMiniMaxCaption(brief);
  assert.equal(JSON.stringify(brief), frozen, "brief mutated");
  const source = fs.readFileSync(path.join(__dirname, "../score-engine/adapters/minimax-caption-reference.js"), "utf8");
  for (const banned of ["score-lane", "score-schemas", "cue-planner", "readFile", "writeFile", "require(\"node:fs\")", "require('node:fs')"]) {
    assert.ok(!source.includes(banned), `adapter must not reference ${banned}`);
  }
});

test("VIDLAP2 example-brief fixture renders the reference caption", () => {
  const brief = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const { caption } = adapter.renderMiniMaxCaption(brief);
  const expected = "[Global Metadata]\n"
    + "Instrumental cue, 76 BPM, D minor, 60 seconds. Calm focus, quiet confidence, settled resolution. "
    + "Energy: flat low, underlay character. Must stay behind continuous narration.\n"
    + "\n"
    + "[Vocal Details]\n"
    + "Instrumental. No vocals of any kind.\n"
    + "\n"
    + "[Arrangement]\n"
    + "0:00-0:48 bed: soft electric piano and warm sub bass; static harmonic loop, minimal movement, no fills. "
    + "0:48-1:00 settle: thin out, resolve harmonically, leave air. "
    + "Allowed colors: light vinyl texture, muted pad, sparse rim clicks. "
    + "End on a clear button, not a fade. "
    + "Avoid: vocals, lead melody, brass, risers, trap hi-hats, sidechain pumping.\n";
  assert.equal(caption, expected);
});
