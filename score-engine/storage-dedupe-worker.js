"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const dedupe = require("./storage-dedupe.js");

function run() {
  try {
    parentPort.postMessage({ ok: true, report: dedupe.audit(workerData || {}) });
  } catch (cause) {
    parentPort.postMessage({ ok: false, error: cause && cause.message || String(cause) });
  }
}

const delay = Math.max(0, Math.min(1000, Number(workerData && workerData.auditWorkerDelayMs) || 0));
if (delay) setTimeout(run, delay);
else run();
