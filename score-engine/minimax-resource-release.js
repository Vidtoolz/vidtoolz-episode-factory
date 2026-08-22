// Bounded, queue-safe MiniMax model-cache release.
//
// Generation owns candidate truth. This helper runs only after terminal state
// is durable, and its outcome can never rewrite a completed/failed candidate.
"use strict";

const TARGET_FREE_VRAM_MIB = 15000;
const IDLE_WAIT_MS = 30000;
const RELEASE_WAIT_MS = 20000;
const POLL_MS = 1000;

function nowIso() { return new Date().toISOString(); }

function outcome(status, requestedAt, fields = {}) {
  return { status, requested_at: requestedAt, completed_at: nowIso(), ...fields };
}

function errorText(error) {
  return String(error && (error.message || error) || "unknown resource-release error").slice(0, 300);
}

async function releaseWhenIdle({
  transport,
  isLocallyIdle = () => true,
  targetFreeVramMiB = TARGET_FREE_VRAM_MIB,
  idleWaitMs = IDLE_WAIT_MS,
  releaseWaitMs = RELEASE_WAIT_MS,
  pollMs = POLL_MS,
} = {}) {
  const requestedAt = nowIso();
  if (!transport || transport.resourceLifecycle !== "comfyui-real"
    || typeof transport.inspectRuntime !== "function" || typeof transport.freeResources !== "function") {
    return outcome("skipped", requestedAt, { attempted: false, reason: "non_real_minimax_transport" });
  }

  const sleep = typeof transport.sleep === "function"
    ? transport.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const idleDeadline = Date.now() + Math.max(0, idleWaitMs);
  let before = null;
  try {
    while (true) {
      if (!isLocallyIdle()) {
        return outcome("skipped", requestedAt, { attempted: false, reason: "local_music_work_active" });
      }
      before = await transport.inspectRuntime();
      if (!before || before.healthy !== true) {
        return outcome("failed", requestedAt, { attempted: false, reason: "runtime_unhealthy", detail: before && before.reason || null });
      }
      const busy = Number(before.queue_running) > 0 || Number(before.queue_pending) > 0;
      if (!busy) break;
      if (Date.now() >= idleDeadline) {
        return outcome("skipped", requestedAt, {
          attempted: false, reason: "runtime_queue_busy", queue_running: Number(before.queue_running) || 0,
          queue_pending: Number(before.queue_pending) || 0, vram_before_mib: before.free_vram_mib ?? null,
        });
      }
      await sleep(Math.max(0, pollMs));
    }

    if (Number.isFinite(before.free_vram_mib) && before.free_vram_mib >= targetFreeVramMiB) {
      return outcome("skipped", requestedAt, {
        attempted: false, reason: "already_sufficiently_free", vram_before_mib: before.free_vram_mib,
        vram_after_mib: before.free_vram_mib, runtime_healthy: true,
      });
    }

    // Re-observe immediately before the destructive-to-cache operation. The
    // caller retains the local generation lock throughout; this second remote
    // check closes the queue-drain observation window for the dedicated worker.
    const confirmed = await transport.inspectRuntime();
    if (!isLocallyIdle() || !confirmed || confirmed.healthy !== true
      || Number(confirmed.queue_running) > 0 || Number(confirmed.queue_pending) > 0) {
      return outcome("skipped", requestedAt, {
        attempted: false, reason: "runtime_became_busy", queue_running: Number(confirmed && confirmed.queue_running) || 0,
        queue_pending: Number(confirmed && confirmed.queue_pending) || 0,
        vram_before_mib: before.free_vram_mib ?? null,
      });
    }

    await transport.freeResources();
    const releaseDeadline = Date.now() + Math.max(0, releaseWaitMs);
    let after = null;
    while (true) {
      after = await transport.inspectRuntime();
      if (after && after.healthy === true && Number(after.queue_running) === 0 && Number(after.queue_pending) === 0
        && (!Number.isFinite(after.free_vram_mib) || after.free_vram_mib >= targetFreeVramMiB)) break;
      if (Date.now() >= releaseDeadline) {
        return outcome("failed", requestedAt, {
          attempted: true, reason: "release_not_verified", vram_before_mib: before.free_vram_mib ?? null,
          vram_after_mib: (after && after.free_vram_mib) ?? null, runtime_healthy: Boolean(after && after.healthy),
        });
      }
      await sleep(Math.max(0, pollMs));
    }
    return outcome("released", requestedAt, {
      attempted: true, reason: "idle_model_cache_released", vram_before_mib: before.free_vram_mib ?? null,
      vram_after_mib: after.free_vram_mib ?? null, runtime_healthy: true,
      queue_running: 0, queue_pending: 0,
    });
  } catch (error) {
    return outcome("failed", requestedAt, {
      attempted: Boolean(before), reason: "release_request_failed", detail: errorText(error),
      vram_before_mib: (before && before.free_vram_mib) ?? null,
    });
  }
}

module.exports = {
  TARGET_FREE_VRAM_MIB,
  IDLE_WAIT_MS,
  RELEASE_WAIT_MS,
  POLL_MS,
  releaseWhenIdle,
};
