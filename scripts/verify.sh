#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

node tests/run-tests.js
node --check episode-model.js
node --check storage-adapter.js
node --check app.js
node --check package-engine-model.js
node --check package-engine-run.js
node --check package-engine.js
node --check package-runs-dashboard.js
node --check scripts/episode-factory.js
node --check scripts/package-engine-new-run.js
node --check scripts/package-engine-new-outline.js
node --check scripts/package-engine-new-script.js
node --check scripts/package-engine-new-production.js
node --check scripts/package-run-creator-qa.js
node --check scripts/package-runs-index.js
node --check scripts/package-runs-dashboard-launch.js
