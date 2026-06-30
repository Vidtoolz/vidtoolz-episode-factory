/**
 * VIDTOOLZ Episode Factory Tests — image-prompts action URL + project-aware editor.
 *
 * Regression guard for the "Missing ?package=<id>" bug: the action emitted
 * ?package_id= but the editor read ?package=.
 */

const {
  assert,
  fs,
  path,
  test,
} = require("./_helpers.js");

const { resolveAction, REGISTRY } = require("../project-action-registry.js");

test("action: generate_image_prompts opens the editor with canonical ?package= (and ?package_id= alias)", () => {
  const a = resolveAction("generate_image_prompts", "demo-proj");
  assert.equal(a.type, "open");
  assert.match(a.href, /^image-prompts-editor\.html\?/);
  assert.match(a.href, /[?&]package=demo-proj(?:&|$)/);   // canonical
  assert.match(a.href, /[?&]package_id=demo-proj(?:&|$)/); // backward-compatible alias
});

test("action: every open action URL includes a ?package= param (no contextless links)", () => {
  for (const id of Object.keys(REGISTRY)) {
    const a = resolveAction(id, "x");
    if (a.type !== "open") continue;
    assert.match(a.href, /[?&]package=x(?:&|$)/, `${id} must pass ?package=`);
  }
});

test("editor: image-prompts-editor.html reads package || package_id || id, keeps clear missing message", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-prompts-editor.html"), "utf8");
  assert.match(html, /params\.get\("package"\)\s*\|\|\s*params\.get\("package_id"\)\s*\|\|\s*params\.get\("id"\)/);
  assert.match(html, /Missing \?package=<id> query parameter\./);
});

test("editor: shows project context — title/stage, approved-script status, workspace + focus links", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-prompts-editor.html"), "utf8");
  assert.match(html, /loadProjectContext/);
  assert.match(html, /\/api\/project-state\?id=/);
  assert.match(html, /Approved script found/);
  assert.match(html, /No approved script found/);
  assert.match(html, /project-workspace\.html\?id=/);
  assert.match(html, /project-focus\.html\?id=/);
});

test("selector: image-selector.html tolerates ?package_id= alias too", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-selector.html"), "utf8");
  assert.match(html, /params\.get\("package"\)\s*\|\|\s*params\.get\("package_id"\)/);
});

test("label: image prompt action label is honest (does not claim auto-generation)", () => {
  assert.equal(REGISTRY.generate_image_prompts.label, "Open image prompts editor");
});
