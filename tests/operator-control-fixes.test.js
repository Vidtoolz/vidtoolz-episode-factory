// Operator-facing control audit fixes (2026-07-10).
// Static/structural assertions guarding the client-side control repairs made
// during the full button/control audit. These pages are vanilla HTML/JS served
// as static files, so we assert on their source the same way the existing
// topic-scout / new-video-build UI-wiring tests do.
const { assert, fs, path, test } = require("./_helpers.js");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── publish-gate: rough-cut result panel renders the real verdict ──
// Bug: renderResult read payload.summary, but the rough-cut route returns its
// verdict under payload.review (camelCase), so the panel rendered blank on PASS.
test("publish-gate.html renderResult falls back to payload.review for the rough-cut panel", () => {
  const html = read("publish-gate.html");
  assert.match(html, /payload\.summary\s*\|\|\s*payload\.review/);
  // The rough-cut call now uses the camelCase keys the server actually returns.
  assert.match(html, /roughCutReviewStatus:\s*"Review status"/);
  assert.match(html, /secondCutReady:\s*"Second-cut ready"/);
  // Booleans render as Yes/No rather than blank/true.
  assert.match(html, /function fmtResultValue/);
  assert.match(html, /return "Yes"[\s\S]*?return "No"/);
});

// ── media-gallery: lightbox is XSS-safe ──
// Bug: openLightbox templated src/name into innerHTML, so a filename/path with a
// double quote could break out of the attribute.
test("media-gallery.js openLightbox builds nodes via the DOM API, not innerHTML templating", () => {
  const js = read("media-gallery.js");
  const open = js.slice(js.indexOf("function openLightbox"), js.indexOf("function escapeHtml"));
  assert.match(open, /document\.createElement\("video"\)/);
  assert.match(open, /document\.createElement\("img"\)/);
  assert.match(open, /node\.src\s*=\s*src/);
  // No template-literal interpolation of src/name into an HTML string anymore.
  assert.doesNotMatch(open, /innerHTML\s*=\s*`<(video|img)[^`]*\$\{/);
});

// ── mission-control: no dead package-run script links ──
// Bug: two "Script" links pointed at purged package-runs/<run>/final-script.md.
test("mission-control.html has no dead package-runs/*/final-script.md links", () => {
  const html = read("mission-control.html");
  assert.doesNotMatch(html, /href="package-runs\/[^"]*\/final-script\.md"/);
});

// ── shorts-workflow: step containers are balanced (no visual nesting) ──
// Bug: Step 3's .shorts-step div was never closed, nesting steps 4-7 inside it.
test("shorts-workflow.html has balanced <div> tags", () => {
  const html = read("shorts-workflow.html");
  const opens = (html.match(/<div\b/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, "every <div> must be closed");
});

// ── package-engine: cancelling the confirm dialog clears the pending selection ──
test("package-engine.js cancel-confirm clears pendingSelectedId and re-renders", () => {
  const js = read("package-engine.js");
  assert.match(js, /cancelConfirmBtn\.addEventListener\("click",[\s\S]*?pendingSelectedId\s*=\s*""[\s\S]*?render\(\)/);
});

// ── package-engine: outline .md download releases its object URL ──
test("package-engine.js outline download revokes the blob object URL", () => {
  const js = read("package-engine.js");
  const dl = js.slice(js.indexOf("outline-prompt.md"), js.indexOf("outline-prompt.md") + 400);
  assert.match(js, /revokeObjectURL\(url\)/);
  assert.ok(dl.length > 0);
});

// ── package-runs-dashboard: media Refresh explains itself when no run is focused ──
test("package-runs-dashboard.js media Refresh shows a message when no run is focused", () => {
  const js = read("package-runs-dashboard.js");
  assert.match(js, /No active run — focus a run above to load its media gallery/);
});

// ── image-selector / shorts-workflow: manual upload confirms before replacing ──
test("upload clients confirm before replacing an occupied slot (confirm_replace)", () => {
  for (const rel of ["image-selector.html", "shorts-workflow.html"]) {
    const html = read(rel);
    assert.match(html, /confirm_replace/, `${rel} must resend with confirm_replace`);
    assert.match(html, /status === 409|res\.status === 409/, `${rel} must detect the 409 occupied response`);
    assert.match(html, /archived \(moved aside, not deleted\)/, `${rel} must explain the archive-on-replace behavior`);
  }
});
