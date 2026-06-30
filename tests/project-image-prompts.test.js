/**
 * VIDTOOLZ Episode Factory Tests — project-scoped image-prompt generation.
 *
 * Covers prompt build, strict parse/validation (exact count, anti-text doctrine,
 * provenance), that generated records pass the canonical saveImagePrompts
 * validation and advance the resolver, and the editor's generation panel.
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

function modelOutput(n, mutate) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ index: i + 1, category: "cinematic", beat: "problem", intended_use: "u",
      prompt: `Photorealistic vertical scene ${i + 1} of a solo creator in a dim studio, cinematic lighting, shallow depth of field, strong negative space upper-left.` });
  }
  if (mutate) mutate(arr);
  return JSON.stringify({ prompts: arr });
}

// ── Prompt build ────────────────────────────────────────────────────────────

test("imgprompts: build request carries anti-text + vertical rules and the script", () => {
  const r = pip.buildImagePromptRequest({ title: "T", premise: "P", script: "SCRIPT BODY", count: 25 });
  assert.match(r.system, /NO readable text/i);
  assert.match(r.system, /1080x1920/);
  assert.match(r.user, /SCRIPT BODY/);
  assert.match(r.user, /exactly 25/);
});

// ── Parse / validate ─────────────────────────────────────────────────────────

test("imgprompts: parse yields exactly N records, indexed 1..N, with provenance", () => {
  const recs = pip.parseImagePrompts(modelOutput(27), 25, { projectId: "demo", model: "qwen3:14b", nowIso: "T" });
  assert.equal(recs.length, 25);
  assert.equal(recs[0].index, 1);
  assert.equal(recs[24].index, 25);
  assert.equal(recs[0].prompt_provider, "ollama");
  assert.equal(recs[0].prompt_host, "vidnux");
  assert.equal(recs[0].source, "local_ollama_vidnux");
  assert.equal(recs[0].generated_from, "approved_script");
});

test("imgprompts: drops too-short + baked-in-text prompts and enforces a no-text clause", () => {
  const out = modelOutput(27, (arr) => {
    arr[3].prompt = "too short";
    arr[5].prompt = "A neon sign that says HELLO over a desk, photorealistic vertical.";
  });
  const recs = pip.parseImagePrompts(out, 25, { projectId: "demo" });
  assert.equal(recs.length, 25);
  assert.ok(recs.every((r) => /no readable text/i.test(r.prompt)), "every prompt enforces no-text");
  assert.ok(!recs.some((r) => /sign that says HELLO/i.test(r.prompt)), "baked-text prompt dropped");
});

test("imgprompts: malformed JSON -> 502; too few usable -> 502 (no partial)", () => {
  assert.throws(() => pip.parseImagePrompts("not json", 25), (e) => e.statusCode === 502);
  assert.throws(() => pip.parseImagePrompts(modelOutput(10), 25), (e) => e.statusCode === 502);
});

test("imgprompts: bakesInText flags positive text instructions, not 'no readable text'", () => {
  assert.equal(pip.bakesInText("a sign that says OPEN"), true);
  assert.equal(pip.bakesInText("cinematic scene, no readable text"), false);
});

// ── Canonical schema + resolver advance (integration) ───────────────────────

test("imgprompts: generated records pass saveImagePrompts and advance the resolver", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pip-int-"));
  const pkgs = path.join(root, "script-packages");
  const pkg = path.join(pkgs, "demo");
  fs.mkdirSync(path.join(pkg, "script"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "selected-package.json"), JSON.stringify({ package: { proposedTitle: "Demo" } }));
  fs.writeFileSync(path.join(pkg, "script", "script-final.md"), "# Final\n" + "x".repeat(120));

  assert.equal(resolveProjectState(pkg).stage, "image_prompts"); // before prompts

  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo" });
  const saved = packageEngineServer.saveImagePrompts({ package_id: "demo", model: { image_prompts: recs } }, { scriptPackages: pkgs, aigenRoot: root });
  assert.equal(saved.count, 25);
  assert.equal(path.basename(saved.written_to), "image-prompts.json");

  const state = resolveProjectState(pkg);
  assert.equal(state.counts.image_prompts, 25);
  assert.equal(state.stage, "image_generation"); // advanced
  assert.equal(chooseNextTask(state).id, "submit_image_generation");
});

test("imgprompts: validateImagePromptsPayload accepts generated records (valid, no errors)", () => {
  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo" });
  const v = packageEngineServer.validateImagePromptsPayload({ image_prompts: recs });
  assert.equal(v.valid, true);
  assert.equal(v.errors.length, 0);
  assert.equal(v.count, 25);
});

test("imgprompts: manifest records provenance + count", () => {
  const recs = pip.parseImagePrompts(modelOutput(25), 25, { projectId: "demo" });
  const m = pip.buildManifest(recs, { projectId: "demo", model: "qwen3:14b", nowIso: "T", scriptPath: "script/script-final.md" });
  assert.equal(m.provider, "ollama");
  assert.equal(m.provider_host, "vidnux");
  assert.equal(m.source, "local_ollama_vidnux");
  assert.equal(m.prompt_count, 25);
  assert.equal(m.project_id, "demo");
});

// ── Editor generation panel ─────────────────────────────────────────────────

test("imgprompts: editor exposes a generation panel wired to the endpoint", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-prompts-editor.html"), "utf8");
  assert.match(html, /Generate from approved script/);
  assert.match(html, /Generate image prompts from approved script/);
  assert.match(html, /\/api\/project\/image-prompts\/generate/);
  assert.match(html, /function generateFromScript/);
  assert.match(html, /local Ollama on vidnux/);
  assert.match(html, /Ollama on vidnux unavailable/); // blocked-state message
  assert.match(html, /Replace the existing/);          // replace confirmation
});
