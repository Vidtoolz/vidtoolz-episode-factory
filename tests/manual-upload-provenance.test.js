// B4 — manual-upload provenance & storage classification (2026-07-10).
//
// The aigen image model previously stored operator-supplied uploads under
// images/flux-local/, giving them false FLUX-generated provenance. These tests
// pin the corrected authoritative contract: truthful storage namespace, explicit
// metadata precedence, evidence-based legacy classification, non-destructive
// replacement, and truthful downstream/UI representation. No real generation.
const { assert, fs, os, path, packageEngineServer, test } = require("./_helpers.js");
const idx = require("../package-media-index.js");
const audit = require("../scripts/manual-upload-provenance-audit.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(tag) { return Buffer.concat([PNG, Buffer.from(String(tag))]).toString("base64"); }
function tmpPkg(id) {
  const scriptPackages = fs.mkdtempSync(path.join(os.tmpdir(), "b4-"));
  const dir = path.join(scriptPackages, id);
  fs.mkdirSync(dir, { recursive: true });
  return { scriptPackages, dir, id };
}
function writeJson(p, d) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

// ── Provenance contract (classifyImageSource) ────────────────────────────────

test("provenance: FLUX-manifest membership → generated (proven)", () => {
  const ev = { fluxRelSet: new Set(["images/flux-local/flux-001.png"]), sidecarByPath: new Map() };
  assert.equal(idx.classifyImageSource("images/flux-local/flux-001.png", ev), "generated");
});

test("provenance: explicit sidecar record wins over path/directory inference", () => {
  // A file physically under flux-local/ but recorded as a manual upload in the
  // sidecar is manual_upload — the directory name must NOT win.
  const ev = { fluxRelSet: new Set(), sidecarByPath: new Map([["images/flux-local/flux-002.png", { generation_mode: "manual_external" }]]) };
  assert.equal(idx.classifyImageSource("images/flux-local/flux-002.png", ev), "manual_upload");
});

test("provenance: a file in the manual-upload namespace → manual_upload", () => {
  const ev = { fluxRelSet: new Set(), sidecarByPath: new Map() };
  assert.equal(idx.classifyImageSource("images/manual-upload/manual-003.png", ev), "manual_upload");
});

test("provenance: bare flux-local file with NO evidence → legacy_unknown (never fabricated 'generated')", () => {
  const ev = { fluxRelSet: new Set(), sidecarByPath: new Map() };
  assert.equal(idx.classifyImageSource("images/flux-local/flux-009.png", ev), "legacy_unknown");
});

test("provenance: sidecar explicitly recording 'local' is respected as generated", () => {
  const ev = { fluxRelSet: new Set(), sidecarByPath: new Map([["images/flux-local/flux-004.png", { generation_mode: "local" }]]) };
  assert.equal(idx.classifyImageSource("images/flux-local/flux-004.png", ev), "generated");
});

test("provenance: sourceLabel maps to concise operator-facing labels", () => {
  assert.equal(idx.sourceLabel("generated"), "Generated · FLUX local");
  assert.equal(idx.sourceLabel("manual_upload"), "Manual upload");
  assert.equal(idx.sourceLabel("legacy_unknown"), "Legacy · source unknown");
});

// ── Index truthfulness + reading a legacy project does not rewrite it ────────

test("index: manual sidecar image is source_type manual_upload; flux-manifest image is generated", () => {
  const { dir } = tmpPkg("pkg-idx");
  writeJson(path.join(dir, "flux-generation-manifest.json"), { workflow: "flux", items: [{ prompt_index: 1, output_path: "images/flux-local/flux-001.png", status: "complete" }] });
  fs.mkdirSync(path.join(dir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-001.png"), PNG);
  writeJson(path.join(dir, "external-media-manifest.json"), { version: 1, images: [{ path: "images/manual-upload/manual-002.png", source_type: "manual_upload", generation_mode: "manual_external", generation_provider: "gpt-manual" }] });
  fs.mkdirSync(path.join(dir, "images", "manual-upload"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "manual-upload", "manual-002.png"), PNG);
  const index = idx.buildPackageMediaIndex(dir);
  const flux = index.images.find((i) => i.path === "images/flux-local/flux-001.png");
  const manual = index.images.find((i) => i.path === "images/manual-upload/manual-002.png");
  assert.equal(flux.source_type, "generated");
  assert.equal(manual.source_type, "manual_upload");
});

test("index: reading a legacy project does not rewrite its manifests", () => {
  const { dir } = tmpPkg("pkg-legacy-read");
  const sidecarPath = path.join(dir, "external-media-manifest.json");
  writeJson(sidecarPath, { version: 1, images: [{ path: "images/flux-local/flux-002.png", generation_mode: "manual_external" }] });
  const before = fs.readFileSync(sidecarPath, "utf8");
  idx.buildPackageMediaIndex(dir);
  idx.buildImageEvidence(dir);
  assert.equal(fs.readFileSync(sidecarPath, "utf8"), before, "manifest must be untouched by a read");
});

// ── Storage: new uploads land in the truthful namespace; legacy stays readable ─

test("storage: a new manual upload is stored under images/manual-upload/, never flux-local/", () => {
  const { scriptPackages } = tmpPkg("pkg-store");
  const res = packageEngineServer.uploadAigenImage({ package_id: "pkg-store", prompt_index: 8, data_base64: png("A") }, { scriptPackages });
  assert.equal(res.path, "images/manual-upload/manual-008.png");
  assert.ok(fs.existsSync(path.join(scriptPackages, "pkg-store", "images", "manual-upload", "manual-008.png")));
  assert.ok(!fs.existsSync(path.join(scriptPackages, "pkg-store", "images", "flux-local", "flux-008.png")));
});

test("storage: a legacy manual upload under flux-local/ remains readable + selectable, labeled manual", () => {
  const { scriptPackages, dir } = tmpPkg("pkg-legacy-sel");
  // Simulate a pre-B4 manual upload: file at flux-local + sidecar recording it.
  fs.mkdirSync(path.join(dir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-006.png"), PNG);
  writeJson(path.join(dir, "external-media-manifest.json"), { version: 1, images: [{ path: "images/flux-local/flux-006.png", generation_mode: "manual_external", generation_provider: "gpt-manual" }] });
  const listed = packageEngineServer.listFluxImages("pkg-legacy-sel", { scriptPackages });
  const row = listed.images.find((i) => i.index === 6);
  assert.ok(row, "legacy image still listed");
  assert.equal(row.source_type, "manual_upload");
  packageEngineServer.writeSelectedImages({ package_id: "pkg-legacy-sel", selected_indices: [6] }, { scriptPackages });
  const sel = JSON.parse(fs.readFileSync(path.join(dir, "selected-images.json"), "utf8"));
  assert.equal(sel.selections[0].selected_path, "images/flux-local/flux-006.png"); // legacy path preserved
  assert.equal(sel.selections[0].source_type, "manual_upload");
});

test("storage: listFluxImages surfaces BOTH namespaces with truthful source_type", () => {
  const { scriptPackages, dir } = tmpPkg("pkg-both");
  writeJson(path.join(dir, "flux-generation-manifest.json"), { workflow: "flux", items: [{ prompt_index: 1, output_path: "images/flux-local/flux-001.png", status: "complete" }] });
  fs.mkdirSync(path.join(dir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-001.png"), PNG);
  packageEngineServer.uploadAigenImage({ package_id: "pkg-both", prompt_index: 2, data_base64: png("M") }, { scriptPackages });
  const listed = packageEngineServer.listFluxImages("pkg-both", { scriptPackages });
  assert.equal(listed.images.find((i) => i.index === 1).source_type, "generated");
  assert.equal(listed.images.find((i) => i.index === 2).source_type, "manual_upload");
});

// ── Replacement: cross-namespace, non-destructive, atomic ────────────────────

test("replacement: manual upload replacing a legacy flux slot archives the flux file (non-destructive)", () => {
  const { scriptPackages, dir } = tmpPkg("pkg-repl-legacy");
  fs.mkdirSync(path.join(dir, "images", "flux-local"), { recursive: true });
  const fluxBytes = Buffer.concat([PNG, Buffer.from("GEN")]);
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-003.png"), fluxBytes);
  const res = packageEngineServer.uploadAigenImage({ package_id: "pkg-repl-legacy", prompt_index: 3, confirm_replace: true, data_base64: png("NEW") }, { scriptPackages });
  assert.equal(res.replaced, true);
  assert.equal(res.path, "images/manual-upload/manual-003.png");
  // Old flux file archived (never deleted), new manual file in place.
  assert.ok(!fs.existsSync(path.join(dir, "images", "flux-local", "flux-003.png")));
  assert.deepEqual(fs.readFileSync(path.join(dir, res.superseded_path)), fluxBytes);
  // Superseded history preserves the prior asset's provenance.
  const sc = JSON.parse(fs.readFileSync(path.join(dir, "external-media-manifest.json"), "utf8"));
  assert.ok((sc.superseded || []).some((s) => s.prompt_index === 3 && s.prior_path === "images/flux-local/flux-003.png"));
});

// ── API contract + security ──────────────────────────────────────────────────

test("api: invalid slot → 400 INVALID_SLOT; unsupported type → 415 UNSUPPORTED_MEDIA_TYPE", () => {
  const { scriptPackages } = tmpPkg("pkg-api");
  let e1; try { packageEngineServer.uploadAigenImage({ package_id: "pkg-api", prompt_index: 0, data_base64: png("x") }, { scriptPackages }); } catch (e) { e1 = e; }
  assert.equal(e1.statusCode, 400); assert.equal(e1.code, "INVALID_SLOT");
  let e2; try { packageEngineServer.uploadAigenImage({ package_id: "pkg-api", prompt_index: 1, data_base64: Buffer.from("not an image").toString("base64") }, { scriptPackages }); } catch (e) { e2 = e; }
  assert.equal(e2.statusCode, 415); assert.equal(e2.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("api: missing project → 404; oversized → 413", () => {
  const { scriptPackages } = tmpPkg("pkg-api2");
  let e1; try { packageEngineServer.uploadAigenImage({ package_id: "ghost", prompt_index: 1, data_base64: png("x") }, { scriptPackages }); } catch (e) { e1 = e; }
  assert.equal(e1.statusCode, 404);
  const big = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]).toString("base64");
  let e2; try { packageEngineServer.uploadAigenImage({ package_id: "pkg-api2", prompt_index: 1, data_base64: big }, { scriptPackages }); } catch (e) { e2 = e; }
  assert.equal(e2.statusCode, 413);
});

// ── Read-only audit tool ─────────────────────────────────────────────────────

test("audit: read-only, classifies proven/ambiguous, never mutates, no apply mode", () => {
  const { dir } = tmpPkg("pkg-audit");
  writeJson(path.join(dir, "flux-generation-manifest.json"), { workflow: "flux", items: [{ prompt_index: 1, output_path: "images/flux-local/flux-001.png", status: "complete" }] });
  fs.mkdirSync(path.join(dir, "images", "flux-local"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-001.png"), PNG); // generated
  fs.writeFileSync(path.join(dir, "images", "flux-local", "flux-009.png"), PNG); // legacy_unknown
  fs.mkdirSync(path.join(dir, "images", "manual-upload"), { recursive: true });
  fs.writeFileSync(path.join(dir, "images", "manual-upload", "manual-002.png"), PNG); // manual_upload
  const snapshot = JSON.stringify({
    flux: fs.readdirSync(path.join(dir, "images", "flux-local")),
    manual: fs.readdirSync(path.join(dir, "images", "manual-upload")),
  });
  const report = audit.auditPackage(dir);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.summary.generated, 1);
  assert.equal(report.summary.manual_upload, 1);
  assert.equal(report.summary.legacy_unknown, 1);
  // Idempotent + non-mutating: files unchanged, no apply mode on the module.
  const after = JSON.stringify({
    flux: fs.readdirSync(path.join(dir, "images", "flux-local")),
    manual: fs.readdirSync(path.join(dir, "images", "manual-upload")),
  });
  assert.equal(after, snapshot);
  assert.equal(typeof audit.apply, "undefined", "no mutation/apply entry point exists");
});

// ── UI truthfulness (media-gallery prefers explicit provenance over path) ────

test("ui: media-gallery classifyMedia prefers explicit source_type over the flux-local path", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "media-gallery.js"), "utf8");
  const fn = html.slice(html.indexOf("function classifyMedia"), html.indexOf("function mount"));
  // Explicit-provenance branch exists and precedes the path/name heuristics.
  assert.match(fn, /entry\.source_type/);
  assert.match(fn, /Manual upload/);
  assert.match(fn, /Generated · FLUX local/);
  assert.match(fn, /Legacy · source unknown/);
  assert.ok(fn.indexOf("entry.source_type") < fn.indexOf('ctx.includes("flux-local")'), "explicit provenance checked before path heuristics");
});

test("ui: image-selector shows a truthful per-image source label and a non-flux upload button", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "image-selector.html"), "utf8");
  assert.match(html, /image\.source_type/);
  assert.match(html, /Manual upload/);
  assert.match(html, /Generated · FLUX local/);
  assert.doesNotMatch(html, />Upload as flux image</);
});
