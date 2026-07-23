/**
 * VIDTOOLZ Episode Factory Tests — project-scoped image-prompt generation.
 *
 * Build instruction (anti-text, vertical, full-frame composition, script extraction),
 * strict parse/normalize/validate (exact count, normalization, dedup reject,
 * screen-cap reject), canonical schema + resolver advance, and the editor panel.
 */

const {
  assert,
  fs,
  os,
  path,
  packageEngineServer,
  test,
} = require("./_helpers.js");

const pip = require("../project-image-prompts.js");
const { resolveProjectState } = require("../project-state-resolver.js");
const { chooseNextTask } = require("../next-task-engine.js");

// 30 distinct scenes (varied subjects, ≤0 screens) so a valid batch passes the
// dedup + screen gates.
const SCENES = [
  "A dim home studio at night with soft lamp glow and a coffee mug on a shelf",
  "Close-up of weathered hands shaping clay on a spinning pottery wheel",
  "A lone silhouette walking across a foggy rooftop at dawn",
  "A recording studio with session musicians around a grand piano and brass instruments",
  "An empty director chair under a single spotlight on a bare stage",
  "A faceless mannequin draped in a worn jacket beside a ring light",
  "A cluttered desk covered in handwritten sticky notes and a half-eaten sandwich",
  "A vibrant street market with blurred crowds and warm afternoon sun",
  "A pottery kiln glowing orange inside a dark workshop",
  "A vinyl record spinning under a warm turntable light",
  "A robotic arm sorting film reels in a sterile automated archive without people",
  "A rain-streaked window overlooking a neon city skyline at night",
  "Calloused fingertips pressing guitar strings in deep shadow",
  "A creator mid-laugh in a sunlit kitchen, candid and imperfect",
  "A chalkboard wall filled with abstract smudged illegible diagrams",
  "An old film projector casting a flickering beam across a dusty room",
  "Steaming coffee beside scattered Polaroid photographs on oak",
  "A quiet park bench under autumn trees with golden falling leaves",
  "Colorful bokeh lights reflected on a rain puddle at midnight",
  "A wall of blurred abstract picture frames in a dim gallery corridor",
  "A hand reaching toward a glowing doorway in a dark hallway",
  "A vintage microphone on a stand under moody blue stage light",
  "A workshop bench with woodworking tools and curled wood shavings",
  "A creator pacing on a balcony at sunset, the city far below",
  "A spilled box of cassette tapes scattered across a wooden floor",
  "Paint swirling together on an artist worn palette",
  "A lone surfer paddling out on a misty grey ocean at dawn",
  "A dog asleep under a desk in a cozy cluttered room",
  "A stack of well-worn notebooks on a windowsill in soft morning light",
  "A neon alley with steam rising from a grate at night",
];

function modelOutput(n, opts = {}) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    let scene = opts.dup ? SCENES[0] : SCENES[i % SCENES.length];
    if (opts.screens && i < opts.screens) scene = `${SCENES[i % SCENES.length]} with a glowing computer monitor on the desk`;
    arr.push({ index: i + 1, category: "cinematic", beat: "problem", intended_use: "u", prompt: scene + ", cinematic lighting" });
  }
  if (opts.mutate) opts.mutate(arr);
  return JSON.stringify({ prompts: arr });
}

// ── Build instruction ────────────────────────────────────────────────────────

test("imgprompts: build instruction carries vertical/photoreal/full-frame + script extraction", () => {
  const r = pip.buildImagePromptRequest({ title: "T", premise: "P", script: "SCRIPT BODY", count: 25 });
  assert.match(r.system, /1080x1920/);
  // Full-screen composition, not presenter-safe negative space.
  assert.match(r.system, /full-frame composition using the entire canvas/i);
  assert.match(r.system, /do NOT reserve[^\n]*presenter/i);
  assert.doesNotMatch(r.system, /presenter-safe|negative space|lower[- ]right|leave room for|sits (left|upper|off)/i);
  assert.match(r.system, /photorealistic/i);
  assert.match(r.system, /NO readable text/i);
  assert.match(r.system, /extract|metaphor|session players|recording studio/i); // script-specific extraction
  assert.match(r.user, /SCRIPT BODY/);
  assert.match(r.user, /exactly 25 DISTINCT/);
});

// ── Normalization + parse ─────────────────────────────────────────────────────

test("imgprompts: every parsed prompt is normalized to vertical/photoreal/full-frame/no-text", () => {
  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo", nowIso: "T" });
  assert.equal(recs.length, 25);
  assert.equal(recs[0].index, 1);
  assert.equal(recs[24].index, 25);
  assert.ok(recs.every((r) => /vertical 1080x1920/i.test(r.prompt)), "vertical");
  assert.ok(recs.every((r) => /photorealistic/i.test(r.prompt)), "photorealistic");
  assert.ok(recs.every((r) => /full-frame composition/i.test(r.prompt)), "full-frame");
  assert.ok(recs.every((r) => !/presenter-safe|negative space|lower[- ]right/i.test(r.prompt)), "no presenter-safe framing");
  assert.ok(recs.every((r) => /no readable text/i.test(r.prompt)), "no-text");
  assert.equal(recs[0].prompt_provider, "ollama");
  assert.equal(recs[0].source, "local_ollama_vidnux");
});

test("imgprompts: drops too-short + baked-in-text prompts (still reaches exact count)", () => {
  const out = modelOutput(27, { mutate: (a) => { a[3].prompt = "too short"; a[5].prompt = "A neon sign that says HELLO over a desk"; } });
  const recs = pip.parseImagePrompts(out, 25, { projectId: "demo" });
  assert.equal(recs.length, 25);
  assert.ok(!recs.some((r) => /sign that says HELLO/i.test(r.prompt)));
});

// ── Batch rejection gates ─────────────────────────────────────────────────────

test("imgprompts: duplicate/near-duplicate batch is rejected (502, no write)", () => {
  assert.throws(() => pip.parseImagePrompts(modelOutput(25, { dup: true }), 25, {}), (e) => e.statusCode === 502 && /duplicate/i.test(e.message));
});

test("imgprompts: screen/interface prompts are CAPPED, not fatal, given candidate headroom", () => {
  // 30 distinct candidates, first 5 are screens/monitors. Greedy selection keeps
  // at most MAX_SCREEN_PROMPTS screens and fills the rest from non-screen scenes,
  // so it still reaches exactly 25 with the screen cap honored.
  const recs = pip.parseImagePrompts(modelOutput(30, { screens: 5 }), 25, {});
  assert.equal(recs.length, 25);
  const screens = recs.filter((r) => pip.isScreenScene(r.prompt.replace(/Photorealistic.*/s, ""))).length;
  assert.ok(screens <= pip.MAX_SCREEN_PROMPTS, `screens ${screens} <= ${pip.MAX_SCREEN_PROMPTS}`);
});

test("imgprompts: too few distinct prompts after dedup -> 502 (no partial write)", () => {
  // Only 20 distinct candidates for a target of 25 -> cannot reach count.
  assert.throws(() => pip.parseImagePrompts(modelOutput(20), 25, {}), (e) => e.statusCode === 502 && /distinct/i.test(e.message));
});

test("imgprompts: malformed JSON -> 502; too few usable -> 502 (no partial)", () => {
  assert.throws(() => pip.parseImagePrompts("not json", 25), (e) => e.statusCode === 502);
  assert.throws(() => pip.parseImagePrompts(modelOutput(10), 25), (e) => e.statusCode === 502);
});

test("imgprompts: screen + face detectors behave", () => {
  assert.equal(pip.isScreenScene("a glowing monitor on a desk"), true);
  assert.equal(pip.isScreenScene("a foggy rooftop at dawn"), false);
  assert.equal(pip.bakesInText("a sign that says OPEN"), true);
  assert.equal(pip.bakesInText("cinematic rooftop, no readable text"), false);
});

// ── Canonical schema + resolver advance (integration) ─────────────────────────

test("imgprompts: generated records pass saveImagePrompts and advance the resolver", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pip-int-"));
  const pkgs = path.join(root, "script-packages");
  const pkg = path.join(pkgs, "demo");
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Demo" } }));
  fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "# Final\n" + "x".repeat(120));
  assert.equal(resolveProjectState(pkg).stage, "image_prompts");

  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo" });
  const saved = packageEngineServer.saveImagePrompts({ package_id: "demo", model: { image_prompts: recs } }, { scriptPackages: pkgs, aigenRoot: root });
  assert.equal(saved.count, 25);
  assert.equal(path.basename(saved.written_to), "image-prompts.json");

  const state = resolveProjectState(pkg);
  assert.equal(state.counts.image_prompts, 25);
  assert.equal(state.stage, "image_generation");
  assert.equal(chooseNextTask(state).id, "submit_image_generation");
});

test("imgprompts: validateImagePromptsPayload accepts generated records", () => {
  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo" });
  const v = packageEngineServer.validateImagePromptsPayload({ image_prompts: recs });
  assert.equal(v.valid, true);
  assert.equal(v.count, 25);
});

test("imgprompts: manifest records provenance + count", () => {
  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo", model: "qwen3:14b" });
  const m = pip.buildManifest(recs, { projectId: "demo", model: "qwen3:14b", nowIso: "T" });
  assert.equal(m.provider, "ollama");
  assert.equal(m.provider_host, "vidnux");
  assert.equal(m.prompt_count, 25);
});

// ── Editor generation panel ───────────────────────────────────────────────────

test("imgprompts: editor exposes a generation panel wired to the endpoint", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-prompts-editor.html"), "utf8");
  assert.match(html, /Generate from approved script/);
  assert.match(html, /\/api\/project\/image-prompts\/generate/);
  assert.match(html, /function generateFromScript/);
  assert.match(html, /Ollama on vidnux unavailable/);
  assert.match(html, /Replace the existing/);
});
