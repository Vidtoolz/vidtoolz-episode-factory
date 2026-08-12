#!/usr/bin/env node
'use strict';

const path = require('path');
const { analyze } = require('../wan-regeneration-evidence');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const aigenRoot = arg('--aigen-root', process.env.AIGEN_VIDNAS_ROOT || '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen');
const result = analyze({
  aigenRoot,
  superFocusRoot: arg('--super-focus-root', process.env.SUPER_FOCUS_MEDIA_ROOT || path.join(aigenRoot, 'super-focus')),
});
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  console.log(result.readiness);
  console.log(`diagnosed ${result.coverage.diagnosed}/${result.coverage.total_regeneration_events}; packages ${result.sample.packages_represented}; categories ${result.sample.categories_represented}; GPU durations ${result.gpu_attribution.events_with_duration}`);
}
