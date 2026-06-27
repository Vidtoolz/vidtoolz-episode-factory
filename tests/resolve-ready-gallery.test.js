// Tests for media-gallery Resolve-readiness (ASCII-safe filename) flagging, 2026-06-27.
const { assert, packageEngineServer, test } = require("./_helpers.js");

test("media gallery: isResolveSafeFilename passes clean ASCII-safe names", () => {
  const ok = packageEngineServer.isResolveSafeFilename;
  assert.equal(ok("wan-scene01-81f.mp4"), true);
  assert.equal(ok("IntroSting.mp4"), true);
  assert.equal(ok("clip_02-final.mov"), true);
  assert.equal(ok("intro.mp4"), true);
});

test("media gallery: isResolveSafeFilename flags spaces, parentheses, and non-ASCII", () => {
  const ok = packageEngineServer.isResolveSafeFilename;
  assert.equal(ok("My Clip (1).mp4"), false); // spaces + parentheses
  assert.equal(ok("a b.mp4"), false); // space
  assert.equal(ok("kling输出.mp4"), false); // non-ASCII (the documented Resolve failure)
  assert.equal(ok("scene[2].mov"), false); // brackets
  assert.equal(ok(""), false);
});
