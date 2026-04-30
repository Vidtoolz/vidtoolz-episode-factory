#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

node tests/run-tests.js
node --check episode-model.js
node --check storage-adapter.js
node --check app.js
