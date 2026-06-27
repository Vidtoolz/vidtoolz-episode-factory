// Shared plain-language translation of the next-safe-action (Fix #2, 2026-06-27).
// Single source of truth used by BOTH the dashboard cockpit (package-runs-dashboard.js)
// and the Build New Video page (new-video-build.html), so guidance stays consistent.
// Maps the engineer-oriented stage/blocker into a creator sentence naming the workflow
// step; falls back to the raw text when nothing matches.
(function (root) {
  function plainNextAction(stage, blockedUntil, fallback) {
    const b = String(blockedUntil || "");
    const s = String(stage || "");
    if (/package run folder exists/i.test(b)) return "Pick and confirm a topic so the project folder is created (Step 1).";
    if (/selected-package\.json exists/i.test(b)) return "Generate your package candidates and select the winning package (Step 1).";
    if (/final-outline\.md exists/i.test(b)) return "Research the topic and finalize your outline (Step 2).";
    if (/final-script\.md exists/i.test(b)) return "Write and finalize your script (Step 3).";
    if (/image-prompts\.json exists/i.test(b)) return "Run the claims check and packaging, then write your image prompts (Steps 4–6).";
    if (/generation-manifest|prompt-03 items/i.test(b)) return "Write image prompts and generate your B-roll images (Steps 6–7).";
    if (/selects prompt-03 still images|selected-image handoff/i.test(b)) return "Choose the best B-roll image for each prompt (Step 8).";
    if (/Capture \/ b-roll|Kling video candidates/i.test(s + " " + b)) return "Turn your selected images into B-roll video clips, move the MP4s to VIDNAS, then test them in Resolve (Step 9).";
    if (/Resolve timeline test/i.test(s)) return "Import the B-roll clips into DaVinci Resolve and check the motion works (Step 11).";
    if (/Resolve test review/i.test(s)) return "Review your Resolve test notes — you're ready for the publish gate (Step 12).";
    return String(fallback || "");
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { plainNextAction };
  if (root) root.plainNextAction = plainNextAction;
})(typeof window !== "undefined" ? window : this);
