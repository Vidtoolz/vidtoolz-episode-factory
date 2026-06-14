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
require("./published-videos.test.js");
require("./aigen-production-pipeline.test.js");
require("./aigen-resolve-assembly.test.js");
require("./presto-batch-control.test.js");
require("./image-selector.test.js");
require("./flux-batch-control.test.js");
require("./image-prompts-editor.test.js");

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
