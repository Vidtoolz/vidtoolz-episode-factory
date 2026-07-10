/**
 * Homepage declutter (slice #2): the canonical orientation panel and a prominent
 * Open Super Focus action stay at the top, and the browser-local Episode Board is
 * moved behind ONE default-closed Planning disclosure. Presentation only — the
 * disclosure writes no state and calls no API. Also pins repository-truth counts
 * for the first slice so stale narrative numbers can't drift back in.
 */
const { assert, fs, path, test } = require("./_helpers.js");

const ROOT = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function idx(re) { const m = index.match(re); return m ? m.index : -1; }

test("homepage: orientation panel stays outside (above) the Planning disclosure", () => {
  const orientation = idx(/id="operatorOrientation"/);
  const planning = idx(/class="homepage-planning"/);
  assert.ok(orientation > -1, "orientation panel present");
  assert.ok(planning > -1, "planning disclosure present");
  assert.ok(orientation < planning, "orientation appears before/outside Planning");
});

test("homepage: prominent Open Super Focus action targets super-focus.html, outside Planning, same tab", () => {
  const cta = index.match(/<a href="super-focus\.html" class="open-super-focus"[^>]*>/);
  assert.ok(cta, "Open Super Focus anchor present, pointing at super-focus.html");
  assert.ok(idx(/class="open-super-focus"/) < idx(/class="homepage-planning"/), "CTA is above/outside Planning");
  assert.doesNotMatch(cta[0], /target=/, "opens in the same browser context (no new tab)");
  // no JS/API wired onto the action
  const block = index.slice(idx(/class="open-super-focus"/), idx(/class="open-super-focus"/) + 300);
  assert.doesNotMatch(block, /onclick=|fetch\(|\/api\//, "CTA is a plain anchor — no API/generation");
});

test("homepage: Episode Board is inside the Planning disclosure, which defaults closed", () => {
  assert.match(index, /<details class="homepage-planning">/, "Planning is a native <details>");
  assert.doesNotMatch(index, /<details class="homepage-planning"[^>]*\bopen\b/, "Planning defaults CLOSED");
  // app-shell / board live after the disclosure opener and before its close
  const open = idx(/<details class="homepage-planning">/);
  const close = index.indexOf("</details>", idx(/homepage-planning-content/));
  const board = idx(/id="episodeFocusPanel"/);
  const shell = idx(/class="app-shell"/);
  assert.ok(open < shell && shell < close, "app-shell is inside the disclosure");
  assert.ok(open < board && board < close, "Episode Board is inside the disclosure");
});

test("homepage: Planning summary is semantic and states browser-local (no nested interactive controls)", () => {
  const m = index.match(/<details class="homepage-planning">\s*<summary>([\s\S]*?)<\/summary>/);
  assert.ok(m, "disclosure has a <summary>");
  const summary = m[1];
  assert.match(summary, /not production truth/i, "summary states it is browser-local planning, not production truth");
  assert.doesNotMatch(summary, /<a\b|<button\b|<input\b|<select\b|<textarea\b/, "no interactive controls inside <summary>");
});

test("homepage: all planning panel IDs remain present exactly once (no loss, no duplication)", () => {
  for (const id of ["episodeFocusPanel", "board", "boardFilters", "executionQueue", "nextWorkBlock", "activeSessionPanel", "weeklyDashboard", "workSessions", "readinessGrid", "episodeForm"]) {
    const n = (index.match(new RegExp('id="' + id + '"', "g")) || []).length;
    assert.equal(n, 1, `#${id} present exactly once`);
  }
});

test("homepage: disclosure is inert — no localStorage/API/handler attached to it", () => {
  // The <details>/<summary> markup carries no script hooks; toggling is native.
  const region = index.slice(idx(/<details class="homepage-planning">/), idx(/homepage-planning-content/) + 40);
  assert.doesNotMatch(region, /onclick=|ontoggle=|localStorage|fetch\(|\/api\//, "disclosure markup has no state/API side effects");
});

test("homepage/first-slice: repository-truth counts (page guides all closed; shared nav mounted, not hardcoded)", () => {
  const htmls = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  let guideOpen = 0, guidePages = 0, hardcodedNav = 0, mounts = 0, scripts = 0;
  for (const f of htmls) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (/class="page-guide"/.test(s)) guidePages += 1;
    guideOpen += (s.match(/class="page-guide" open/g) || []).length;
    if (/<nav class="ef-nav">/.test(s)) hardcodedNav += 1; // bare, links-inline = not migrated
    if (/data-ef-nav/.test(s)) mounts += 1;
    if (/src="ef-nav\.js"/.test(s)) scripts += 1;
  }
  assert.equal(guideOpen, 0, "no page-guide is open by default");
  assert.ok(guidePages >= 22, "page-guides present across pages");
  assert.equal(hardcodedNav, 0, "no page retains a hardcoded inline nav link list");
  assert.equal(mounts, scripts, "every nav mount also loads the shared component");
  assert.ok(mounts >= 25, "shared nav mounted on the migrated pages");
});
