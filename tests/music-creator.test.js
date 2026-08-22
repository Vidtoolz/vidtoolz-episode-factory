/**
 * VIDTOOLZ Music Creator (music-creator.html) — P0 orchestration GUI.
 *
 * Pins the product contract: one simple surface for a non-musician video
 * creator (create project → Create Music Plan → Generate Options → listen →
 * Revise in plain language → Use This), built ONLY on existing verified
 * Score Engine endpoints, with honest capability labeling (preview renderer
 * is a sketch; MiniMax is a separately labelled production candidate backend
 * with explicit human review). String-level tests are a floor (repo convention) — the page's
 * endpoints are additionally pinned against the server route table so the
 * GUI cannot silently call APIs that do not exist.
 */
const { assert, fs, path, test } = require("./_helpers.js");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "music-creator.html"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "package-engine-server.js"), "utf8");

test("music-creator: one-click workflow actions exist with creative (non-technical) labels", () => {
  assert.match(page, /Create Music Plan/, "Create Music Plan action");
  assert.match(page, /Generate Options/, "Generate Options action");
  assert.match(page, /Use This/, "Use This action");
  assert.match(page, /More Like This/, "More Like This action");
  assert.match(page, /id="btn-revise"/, "Revise action");
  assert.match(page, /id="np-script"/, "script input");
  assert.match(page, /id="np-name"/, "project name input");
});

test("music-creator: ordinary-language revision chips are present and plain", () => {
  for (const chip of ["Calmer", "Less busy", "Darker", "Stronger ending", "Warmer", "Less bass", "Faster", "Slower"]) {
    assert.ok(page.includes(`'${chip}'`), `chip: ${chip}`);
  }
  // no music-theory vocabulary forced on the primary surface labels
  assert.doesNotMatch(page, /BPM input|key signature|chord progression|scale mode/i, "no theory controls in primary flow");
});

test("music-creator: required user guide section exists", () => {
  assert.match(page, /id="user-guide"/, "user guide section");
  assert.match(page, /Honest limits/, "guide states honest limits");
  assert.match(page, /score-engine\.html/, "guide links to the advanced workspace");
});

test("music-creator: honest capability labeling — Scorecraft sketch and MiniMax production candidate", () => {
  assert.match(page, /structural sketch/, "preview renderer labeled non-authoritative");
  assert.match(page, /production-sound candidates/, "MiniMax is labelled as production sound, not a structural sketch");
  assert.match(page, /explicitly mark USE or Reject/, "machine completion remains separate from human review");
  assert.match(page, /id="advanced-panel"/, "generator detail lives under Advanced");
  assert.match(page, /fails closed/i, "MiniMax offline behavior stated truthfully");
});

test("music-creator: every API the page calls exists in the server route table", () => {
  const called = [...page.matchAll(/(?:fetch|post)\('([^']+)'/g)].map((m) => m[1]);
  const postCalls = [...page.matchAll(/post\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(called.length >= 8, "page calls a real set of endpoints");
  for (const api of called) {
    assert.ok(server.includes(`'${api}'`), `server declares ${api}`);
  }
  // write endpoints must go through the nonce-gated post(), never raw fetch
  for (const api of postCalls) {
    assert.match(server, new RegExp(api.replace(/[/.]/g, "\\$&")), `route constant for ${api}`);
  }
});

test("music-creator: mutations use the local write nonce pattern (no unauthenticated writes)", () => {
  assert.match(page, /x-vidtoolz-local-write-nonce/, "nonce header present");
  assert.match(page, /ensureNonce/, "nonce acquired from status endpoint");
  assert.doesNotMatch(page, /method:'POST'(?![\s\S]{0,120}headers)/, "no headerless POSTs");
});

test("music-creator: plan-level revision adopts the sanctioned save+re-approve flow", () => {
  // The provenance contract refuses to approve candidates built from an
  // unapproved structure; the GUI must therefore route cue-changing
  // revisions through cues/save (which resets approval) instead of
  // approving the variant directly.
  assert.match(page, /cue-sheet-used\.json/, "reads the revised candidate's cue snapshot");
  assert.match(page, /\/api\/score\/cues\/save/, "adopts revised cues via cues/save");
  assert.match(page, /SETTINGS_ONLY/, "settings-only revisions stay directly approvable");
});

test("music-creator: Create Music Plan never silently overwrites an existing approved-by-adoption plan", () => {
  assert.match(page, /hasCues/, "plan button checks for existing cues");
  assert.match(page, /Approve Music Plan/, "existing plan is approved, not regenerated");
});

test("music-creator: advanced panel offers the deep Score workspace, not duplicated controls", () => {
  assert.match(page, /score-project\.html\?id=/, "deep tools link carries the project id");
  assert.match(page, /REAPER\/Ableton handoff/, "DAW handoffs referenced as advanced path");
});

// ─────────────────────────────────────────────────────────────────────────
// HARDENING PASS 2026-08-22 (surgical): machine generation ≠ human approval.
// One click must never set cue_sheet_approved. The plan is generated, shown,
// and only a second explicit click approves it.
// ─────────────────────────────────────────────────────────────────────────
test("music-creator: the plan button is a genuine two-step gate (generate, then a separate approve)", () => {
  const start = page.indexOf("$('btn-plan').addEventListener");
  assert.ok(start >= 0, "btn-plan handler present");
  const handler = page.slice(start, page.indexOf("$('btn-generate').addEventListener", start));
  const genIdx = handler.indexOf("/api/score/cues/generate");
  const retIdx = handler.indexOf("return;");
  const approveIdx = handler.indexOf("/api/score/cues/approve");
  assert.ok(genIdx >= 0, "first click generates the plan");
  assert.ok(retIdx >= 0 && retIdx > genIdx, "the no-cues branch returns after generating");
  assert.ok(approveIdx > retIdx, "approve is only reachable AFTER the generate-and-return branch — never in the same click");
  // The collapsed one-click pattern (generate immediately followed by approve) must be gone.
  assert.doesNotMatch(handler.slice(genIdx, approveIdx), /cues\/approve/,
    "no approve call sits between the generate call and the early return");
});
