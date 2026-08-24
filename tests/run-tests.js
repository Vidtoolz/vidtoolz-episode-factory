const { tests } = require("./_helpers.js");

// Hard isolation: no test may contact a real GPU host. P10 puts source
// verification on the production dispatch path, so this must be set BEFORE
// any test module loads. The gateway's two remote executors refuse outright.
process.env.VIDTOOLZ_TEST_NO_REMOTE_HOSTS = "1";

require("./proposal-loop.test.js");
require("./episode-model.test.js");
require("./storage-adapter.test.js");
require("./copy-payloads.test.js");
require("./import-export.test.js");
require("./package-engine.test.js");
require("./package-run-scripts.test.js");
require("./package-runs-dashboard.test.js");
require("./media-generators.test.js");
require("./supervised-capture.test.js");
require("./topic-scout.test.js");
require("./submitted-topics.test.js");
require("./published-videos.test.js");
require("./aigen-production-pipeline.test.js");
require("./aigen-authority-chain.test.js");
require("./aigen-authority-review.test.js");
require("./aigen-resolve-assembly.test.js");
require("./presto-batch-control.test.js");
require("./image-selector.test.js");
require("./flux-batch-control.test.js");
require("./image-prompts-editor.test.js");
require("./daily-idea-scout.test.js");
require("./visual-beat-map-parser.test.js");
require("./visual-beat-map-panel.test.js");
require("./friction-log-nonce.test.js");
require("./topic-scout-nonce.test.js");
require("./outline-prompt-nonce.test.js");
require("./pipeline-status.test.js");
require("./video-prompts.test.js");
require("./package-run-candidate-discovery.test.js");
require("./package-run-archive.test.js");
require("./execution-ownership-authority-anchor.test.js");
require("./media-routing.test.js");
require("./project-cockpit.test.js");
require("./idea-promotion.test.js");
require("./homepage-declutter.test.js");
require("./topic-idea-scout.test.js");
require("./project-script.test.js");
require("./backfill-score-explanation.test.js");
require("./image-prompts-action.test.js");
require("./project-image-prompts.test.js");
require("./project-i2v-prompts.test.js");
require("./aigen-review-routing.test.js");
require("./project-video-review.test.js");
require("./presto-video-profile.test.js");
require("./project-media-kit.test.js");
require("./earth-studio.test.js");
require("./earth-studio-journey.test.js");
require("./earth-studio-camera-quality.test.js");
require("./earth-studio-orbit-geometry.test.js");
require("./earth-studio-shot-intent.test.js");
require("./earth-studio-orbit-entry.test.js");
require("./earth-studio-motion-shape.test.js");
require("./earth-studio-orbit-staging.test.js");
require("./earth-studio-orbit-exit.test.js");
require("./earth-studio-visual-review.test.js");
require("./earth-studio-terrain-motion.test.js");
require("./earth-studio-smoothness-doctrine.test.js");
require("./earth-studio-orbit-travel-handoff.test.js");
require("./earth-studio-movement-intent.test.js");
require("./earth-studio-promotion-durability.test.js");
require("./earth-studio-promotion-state.test.js");
require("./earth-studio-agent-pilot.test.js");
require("./generation-supervisor.test.js");
require("./generation-package-bridge.test.js");
require("./music-launcher.test.js");
require("./music-launcher-deployment.test.js");
require("./music-data-backup.test.js");
require("./music-storage-lifecycle.test.js");
require("./music-storage-dedupe.test.js");
require("./music-creator.test.js");
require("./music-creator-state-integrity.test.js");
require("./music-creator-minimax-integration.test.js");
require("./score-diversity.test.js");
require("./earth-studio-director.test.js");
require("./earth-studio-directorial-plan.test.js");
require("./earth-studio-opening-composition.test.js");
require("./earth-studio-sequence-audit.test.js");
require("./earth-studio-intent-contract-audit.test.js");
require("./earth-studio-directorial-rhythm.test.js");
require("./earth-studio-directorial-rhythm-review.test.js");
require("./comfyui-gateway.test.js");
require("./comfyui-qualification.test.js");
require("./earth-studio-proof.test.js");
require("./earth-studio-v04-acceptance.test.js");
require("./earth-studio-template-derivation.test.js");
require("./earth-studio-native-templates.test.js");
require("./score-engine.test.js");
require("./score-provenance.test.js");
require("./score-production.test.js");
require("./score-narration.test.js");
require("./score-resolve-roundtrip.test.js");
require("./score-resolve-production.test.js");
require("./score-editor.test.js");
require("./score-readiness.test.js");
require("./score-verify.test.js");
require("./score-brief-exporter.test.js");
require("./score-minimax-adapter.test.js");
require("./score-music-dispatch.test.js");
require("./sound-music-director.test.js");
require("./research-result-validator.test.js");
require("./research-result-phase-b.test.js");
require("./research-director.test.js");
require("./story-revision-review.test.js");
require("./story-editor.test.js");
require("./story-successor.test.js");
require("./story-takeover-canary.test.js");
require("./visual-plan.test.js");
require("./visual-planning-director.test.js");
require("./agent-task-visual-planning.test.js");
require("./audience-packaging-director.test.js");
require("./presenter-take-manifest.test.js");
require("./presenter-director.test.js");
require("./edit-plan.test.js");
require("./editor-agent.test.js");
require("./agent-control-room.test.js");
require("./operator-action-ledger.test.js");
require("./hermes-escalation.test.js");
require("./production-operations.test.js");
require("./production-operations-production-path.test.js");
require("./production-operations-promotion-governance.test.js");
require("./execution-ownership.test.js");
require("./successor-task-contract.test.js");
require("./agent-cancellation-adapters.test.js");
require("./execution-ownership-canary.test.js");
require("./agent-controls.test.js");
require("./operator-controls-canary.test.js");
require("./agent-run.test.js");
require("./agent-task-story-editor.test.js");
require("./workflow-path.test.js");
require("./script-commitment-check.test.js");
require("./resolve-handoff-readiness.test.js");
require("./resolve-ready-gallery.test.js");
require("./quick-action-endpoints.test.js");
require("./artifact-access-foundation.test.js");
require("./remotion-lane.test.js");
require("./super-focus.test.js");
require("./super-focus-project-io.test.js");
require("./super-focus-lifecycle.test.js");
require("./super-focus-lifecycle-ui.test.js");
require("./super-focus-visual-plan.test.js");
require("./super-focus-visual-plan-routes.test.js");
require("./super-focus-image-review.test.js");
require("./super-focus-image-review-routes.test.js");
require("./super-focus-image-review-workbench.test.js");
require("./super-focus-video-review.test.js");
require("./super-focus-video-review-routes.test.js");
require("./super-focus-video-attempts.test.js");
require("./wan-regeneration-evidence.test.js");
require("./super-focus-video-queue-audit.test.js");
require("./super-focus-slot-density.test.js");
require("./super-focus-compute-gate.test.js");
require("./super-focus-media-viewer.test.js");
require("./super-focus-media-mount-guard.test.js");
require("./kanban-bridge.test.js");
require("./super-focus-kanban-sync.test.js");
require("./image-prompt-full-screen.test.js");
require("./super-focus-visual-required.test.js");
require("./super-focus-visual-plan-authority.test.js");
require("./agent-contract.test.js");
require("./script-evaluator.test.js");
require("./motion-graphics-studio.test.js");
require("./operator-control-fixes.test.js");
require("./mission-control-parked.test.js");
require("./presto-eligibility.test.js");
require("./manual-upload-provenance.test.js");
require("./publish-gate-decision.test.js");
require("./cockpit-continuity-buttons.test.js");
require("./test-compute-registry-gate.js");
require("./idea-engine.test.js");
require("./idea-engine-ui.test.js");
require("./idea-engine-phase2.test.js");
require("./idea-engine-phase3.test.js");
require("./idea-engine-readiness.test.js");
require("./idea-engine-status.test.js");
require("./idea-engine-provenance.test.js");
require("./module-nav.test.js");
require("./worker-capacity-lock.test.js");
require("./super-focus-routing-integration.test.js");

// Diagnostic run-all mode (opt-in): pass `--all` or `--continue`, or set
// RUN_ALL=1, to keep running after failures and list every failing test in a
// final summary — so one failure cannot hide independent later failures.
// Default (no trigger) stays fail-fast: stop at the first failure, exit 1.
const continueAfterFailure =
  process.argv.includes("--all") ||
  process.argv.includes("--continue") ||
  process.env.RUN_ALL === "1";

async function runTests() {
  let passed = 0;
  const failedTests = [];
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`ok - ${item.name}`);
    } catch (error) {
      console.error(`not ok - ${item.name}`);
      console.error(error);
      process.exitCode = 1;
      if (!continueAfterFailure) break;
      failedTests.push(item.name);
    }
  }

  if (continueAfterFailure) {
    console.log(`${passed}/${tests.length} tests passed, ${failedTests.length} failed`);
    if (failedTests.length > 0) {
      console.error("Failed tests:");
      for (const name of failedTests) console.error(`- ${name}`);
      // Re-assert AFTER the loop: a full run crosses tests that can touch
      // process.exitCode, so the aggregate verdict is derived from the
      // tracked failures, never from ambient exit-code state.
      process.exitCode = 1;
    }
  } else if (process.exitCode !== 1) {
    console.log(`${passed}/${tests.length} tests passed`);
  }
}

runTests();
