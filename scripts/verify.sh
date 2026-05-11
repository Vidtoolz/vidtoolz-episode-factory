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
node --check package-engine-server.js
node --check package-runs-dashboard.js
node --check trailer-cue-generator.js
node --check scripts/episode-factory.js
node --check scripts/package-engine-new-run.js
node --check scripts/package-engine-new-outline.js
node --check scripts/package-engine-new-script.js
node --check scripts/package-engine-new-production.js
node --check scripts/package-run-research-pack.js
node --check scripts/package-run-script-structure.js
node --check scripts/package-run-script-review.js
node --check scripts/package-run-production-plan.js
node --check scripts/package-run-capture-checklist.js
node --check scripts/package-run-rough-cut-review.js
node --check scripts/package-run-final-review.js
node --check scripts/package-run-export-checklist.js
node --check scripts/package-run-publication-metadata.js
node --check scripts/package-run-repurpose.js
node --check scripts/package-run-creator-qa.js
node --check scripts/package-runs-index.js
node --check scripts/package-runs-dashboard-launch.js
node --check scripts/trailer-cue-new.js
