/**
 * VIDTOOLZ Episode Factory Tests — AIGEN Review routing.
 *
 * Regression: aigen-review.html embedded the AIGEN service ROOT
 * (http://127.0.0.1:8099/) which serves a bare directory listing, instead of the
 * real review UI at /review-view/. These tests pin the route to /review-view/,
 * package-param forwarding, distinct offline/missing messages, and the
 * project-action mapping for video review.
 */

const { assert, fs, path, test } = require("./_helpers.js");
const { resolveAction } = require("../project-action-registry.js");

function readPage(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

test("aigen-review: does NOT embed the AIGEN service root as the review UI", () => {
  const html = readPage("aigen-review.html");
  // The old bug set the iframe/link to the bare service root "…:8099/".
  assert.doesNotMatch(html, /127\.0\.0\.1:8099\/'/, "no bare 8099 root string literal");
  assert.doesNotMatch(html, /localhost:8099"/, "no bare 8099 root href");
  // It must not point the iframe at the service root path.
  assert.doesNotMatch(html, /frame\.src\s*=\s*['"]https?:\/\/127\.0\.0\.1:8099\/['"]/);
});

test("aigen-review: routes to /review-view/ for both the iframe and the external link", () => {
  const html = readPage("aigen-review.html");
  assert.match(html, /127\.0\.0\.1:8099\/review-view\//, "review-view path present");
  assert.match(html, /id="openReviewLink"[^>]*href="http:\/\/127\.0\.0\.1:8099\/review-view\//, "external link defaults to /review-view/");
  assert.match(html, /frame\.src\s*=\s*REVIEW_URL/, "iframe src is the review-view URL");
});

test("aigen-review: accepts package/package_id/id and forwards them to review-view", () => {
  const html = readPage("aigen-review.html");
  assert.match(html, /params\.get\('package'\)/);
  assert.match(html, /params\.get\('package_id'\)/);
  assert.match(html, /params\.get\('id'\)/);
  // All three aliases are appended to the forwarded query string.
  assert.match(html, /package=['"]?\s*\+\s*encodeURIComponent\(pkg\)/);
  assert.match(html, /package_id=['"]?\s*\+\s*encodeURIComponent\(pkg\)/);
  assert.match(html, /id=['"]?\s*\+\s*encodeURIComponent\(pkg\)/);
});

test("aigen-review: shows distinct offline vs review-view-missing messages", () => {
  const html = readPage("aigen-review.html");
  assert.match(html, /AIGEN Review service is offline on port 8099\./);
  assert.match(html, /AIGEN service is online, but review-view\/ was not found\./);
  // Probe distinguishes the two via the same-origin proxy status.
  assert.match(html, /\/aigen-review\/review-view\//);
  assert.match(html, /r\.status === 404/);
});

test("aigen-review: project video-review action opens the package-scoped review page", () => {
  const a = resolveAction("review_videos", "demo-project");
  assert.equal(a.type, "open");
  assert.match(a.href, /^aigen-review\.html\?/);
  assert.match(a.href, /package=demo-project/);
  assert.match(a.href, /package_id=demo-project/);
  assert.match(a.href, /id=demo-project/);
  assert.doesNotMatch(a.href, /production-pipeline\.html/);
});

test("aigen-review: sibling 'Open AIGEN Review View' links also target /review-view/", () => {
  for (const page of ["production-pipeline.html", "new-video-build.html"]) {
    const html = readPage(page);
    assert.doesNotMatch(html, /href="http:\/\/localhost:8099"/, `${page}: no bare 8099 root link`);
    assert.match(html, /127\.0\.0\.1:8099\/review-view\//, `${page}: links to /review-view/`);
  }
});
