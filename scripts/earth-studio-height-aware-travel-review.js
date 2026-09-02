#!/usr/bin/env node
'use strict';

const path = require('node:path');
const review = require('./earth-studio-travel-altitude-review.js');

const packageDir = path.resolve(__dirname, '../package-runs/2026-08-25-earth-studio-travel-altitude-height-aware');
const options = { ...review.parseArgs(), packageDir };
const app = new review.TravelAltitudeReviewServer(options);

const stop = async () => { await app.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

app.run().then(() => {
  console.log(`Height-aware travel review: http://127.0.0.1:${options.port}/`);
  console.log(`Review session: ${app.sessionPath}`);
}).catch(async (error) => {
  await app.stop();
  console.error(`HEIGHT_AWARE_REVIEW_LAUNCH_FAILED — ${error.message}`);
  process.exitCode = 1;
});
