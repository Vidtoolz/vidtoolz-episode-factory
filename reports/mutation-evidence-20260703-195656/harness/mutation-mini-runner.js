// Mutation harness mini-runner: replicates tests/run-tests.js for a subset of
// test files passed as argv. Lives only in the temp mutation workspace.
"use strict";
const path = require("node:path");
const { tests } = require(path.join(__dirname, "tests", "_helpers.js"));
for (const f of process.argv.slice(2)) require(path.resolve(__dirname, "tests", f));
(async () => {
  for (const item of tests) {
    try { await item.fn(); } catch (e) {
      console.error(`not ok - ${item.name}`);
      console.error(e && e.message ? e.message : e);
      process.exit(1);
    }
  }
  console.log(`ok ${tests.length}`);
  process.exit(0);
})();
