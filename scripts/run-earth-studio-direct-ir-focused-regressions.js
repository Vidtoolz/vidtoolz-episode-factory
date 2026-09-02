#!/usr/bin/env node
"use strict";

process.env.VIDTOOLZ_TEST_NO_REMOTE_HOSTS = "1";

const { tests } = require("../tests/_helpers.js");

require("../tests/earth-studio-orbit-travel-handoff.test.js");
require("../tests/earth-studio-directorial-plan.test.js");

const names = [
  "settle-then-launch: serialized handles match the human-approved candidate",
  "coherence: known-good directed canaries have zero interior ground-path reversals",
];

async function main() {
  let passed = 0;
  for (const name of names) {
    const row = tests.find((item) => item.name === name);
    if (!row) throw new Error(`focused regression is not registered: ${name}`);
    await row.fn();
    process.stdout.write(`ok - ${name}\n`);
    passed += 1;
  }
  process.stdout.write(`${passed}/${names.length} focused registered tests passed\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
