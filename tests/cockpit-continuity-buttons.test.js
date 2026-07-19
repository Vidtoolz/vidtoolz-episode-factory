/**
 * Continuity buttons (usability slice): three dead-ends where a screen showed a
 * next action / path but gave the operator nothing to click. All additions are
 * clipboard- or navigation-only — no durable state, no API writes.
 *
 *  B1  project-resolve-handoff.html — Copy import path / Copy handoff summary
 *  B2  index.html "Where am I?"      — Copy next command
 *  B3  super-focus.html             — Continue -> AIGEN Review / Pipeline
 */
const { assert, fs, path, test } = require("./_helpers.js");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---- B1: Resolve handoff copy buttons ----
test("B1 resolve-handoff: Copy import path + Copy handoff summary buttons present", () => {
  const html = read("project-resolve-handoff.html");
  assert.match(html, /id="rh-copy-path"[^>]*>[^<]*Copy import path/, "Copy import path button present");
  assert.match(html, /id="rh-copy-summary"[^>]*>[^<]*Copy handoff summary/, "Copy handoff summary button present");
  assert.match(html, /id="rh-copy-status"/, "copy status element present");
  // Buttons only render inside the has_resolve_handoff card (no handoff -> nothing to copy).
  assert.ok(
    html.indexOf('id="rh-copy-path"') > html.indexOf("s.has_resolve_handoff ? `"),
    "copy buttons live inside the has_resolve_handoff card"
  );
});

test("B1 resolve-handoff: copy buttons are clipboard-only and wired to the rendered paths", () => {
  const html = read("project-resolve-handoff.html");
  assert.match(html, /<script src="clipboard\.js/, "loads the shared clipboard helper");
  assert.match(html, /function copyText\(/, "copyText helper present");
  assert.match(html, /window\.copyToClipboard\(/, "delegates to the shared clipboard helper");
  assert.match(html, /function buildHandoffSummary\(/, "summary builder present");
  assert.match(
    html,
    /pathBtn\.addEventListener\('click', \(\) => copyText\(clipDir, statusEl\)\)/,
    "path button copies the clip import dir"
  );
  assert.match(
    html,
    /sumBtn\.addEventListener\('click', \(\) => copyText\(buildHandoffSummary\(/,
    "summary button copies the built summary"
  );
  // The summary builder must not call any API — it assembles already-rendered state.
  const start = html.indexOf("function buildHandoffSummary(");
  const body = html.slice(start, start + 1000);
  assert.doesNotMatch(body, /fetch\(|\/api\//, "summary builder makes no network calls");
});

test("B1 resolve-handoff: handoff summary carries the VIDNAS paths and Resolve import steps", () => {
  const html = read("project-resolve-handoff.html");
  assert.match(html, /Handoff folder \(VIDNAS\): ' \+ handoffDir/, "includes handoff dir");
  assert.match(html, /Clip import folder \(VIDNAS\): ' \+ clipDir/, "includes clip dir");
  assert.match(html, /Media Pool -> Import Media/, "includes an import step");
  assert.match(html, /1080x1920 timeline/, "includes the vertical timeline note");
});

// ---- B2: homepage orientation "Copy next command" ----
test("B2 homepage orientation: Copy next command button appears only when a nextCommand exists", () => {
  const html = read("index.html");
  assert.match(html, /id="ooCopyCmd"/, "copy button present");
  assert.match(html, /Copy next command/, "button label present");
  assert.match(html, /if \(o\.nextCommand\)/, "only rendered when nextCommand is set");
  assert.match(html, /ooCopy\(o\.nextCommand/, "wired to copy the nextCommand value");
});

test("B2 homepage orientation: the copy helper is clipboard-only (no API write)", () => {
  const html = read("index.html");
  assert.match(html, /<script src="clipboard\.js/, "loads the shared clipboard helper");
  assert.match(html, /function ooCopy\(/, "ooCopy helper present");
  assert.match(html, /window\.copyToClipboard\(/, "delegates to the shared clipboard helper");
  const start = html.indexOf("function ooCopy(");
  const end = html.indexOf("\n        }", start); // helper's closing brace (8-space indent)
  const body = html.slice(start, end > start ? end : start + 700);
  assert.doesNotMatch(body, /fetch\(|\/api\//, "copy helper makes no network calls");
});

// ---- B3: Super Focus continue links ----
test("B3 super-focus: continue block links to AIGEN Review and Pipeline after the video step", () => {
  const html = read("super-focus.html");
  assert.match(html, /id="sf-continue"/, "continue section present");
  assert.match(html, /<a href="aigen-review\.html" id="sf-continue-review"/, "review link present");
  assert.match(html, /<a href="production-pipeline\.html" id="sf-continue-pipeline"/, "pipeline link present");
  assert.ok(
    html.indexOf('id="vidgen-generate"') < html.indexOf('id="sf-continue"'),
    "continue block comes after the video-generation step"
  );
});

test("B3 super-focus: continue links are plain navigation (no API / generation)", () => {
  const html = read("super-focus.html");
  const at = html.indexOf('id="sf-continue"');
  const end = html.indexOf("</section>", at); // continue block is the last section
  const block = html.slice(at, end > at ? end : at + 800);
  assert.doesNotMatch(block, /fetch\(|\/api\/|onclick=/, "no API calls or JS handlers on the continue links");
});

test("B3 super-focus: continue section participates in per-project collapse state", () => {
  // The block carries data-section (so it gets the collapse machinery); it must
  // therefore also be in SECTION_KEYS, or applySectionState never restores/resets
  // it and a collapsed 'continue' leaks from one open project into the next.
  const html = read("super-focus.html");
  assert.match(html, /data-section="continue"/, "continue block is a collapsible section");
  const keysAt = html.indexOf("var SECTION_KEYS =");
  const keysLine = html.slice(keysAt, html.indexOf("\n", keysAt));
  assert.match(keysLine, /'continue'/, "'continue' is listed in SECTION_KEYS");
});
