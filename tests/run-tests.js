const { tests } = require("./_helpers.js");

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
require("./media-routing.test.js");
require("./project-cockpit.test.js");
require("./workflow-path.test.js");
require("./script-commitment-check.test.js");
require("./resolve-handoff-readiness.test.js");
require("./resolve-ready-gallery.test.js");
require("./quick-action-endpoints.test.js");
require("./artifact-access-foundation.test.js");
require("./remotion-lane.test.js");

async function runTests() {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`ok - ${item.name}`);
    } catch (error) {
      console.error(`not ok - ${item.name}`);
      console.error(error);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(`${passed}/${tests.length} tests passed`);
  }
}

runTests();
