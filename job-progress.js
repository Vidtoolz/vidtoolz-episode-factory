/**
 * VIDTOOLZ Job Progress Bars
 * Polls FLUX and PRESTO job status endpoints and renders animated progress bars with ETA.
 * Mount: JobProgress.mount(container) — auto-polls every 3s.
 */
(function JobProgressModule(globalScope) {
  "use strict";

  const POLL_INTERVAL_MS = 3000;
  const FLUX_API = '/api/flux/job-status';
  const PRESTO_API = '/api/presto/job-status';

  let pollTimer = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  }

  function mount(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="job-progress-panel">
        <div class="job-progress-header">
          <p class="eyebrow">Render Jobs</p>
          <h2>FLUX &amp; PRESTO Status</h2>
        </div>
        <div id="fluxJobBar" class="job-bar-container">
          <div class="job-bar-empty">No active FLUX job</div>
        </div>
        <div id="prestoJobBar" class="job-bar-container">
          <div class="job-bar-empty">No active PRESTO job</div>
        </div>
      </div>
    `;
    startPolling(container);
  }

  function startPolling(container) {
    if (pollTimer) clearInterval(pollTimer);
    poll(container);
    pollTimer = setInterval(() => poll(container), POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function poll(container) {
    Promise.all([
      fetch(FLUX_API, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(PRESTO_API, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([flux, presto]) => {
      renderFlux(container, flux);
      renderPresto(container, presto);
    });
  }

  function renderFlux(container, data) {
    const bar = container.querySelector('#fluxJobBar');
    if (!bar) return;
    if (!data || !data.active) {
      bar.innerHTML = `
        <div class="job-bar-empty">
          <span class="job-bar-label">FLUX</span>
          <span class="muted">Idle — no active image generation</span>
        </div>
      `;
      return;
    }
    const pct = data.progress_pct || 0;
    const elapsed = fmtTime(data.elapsed_seconds);
    const eta = data.eta_label || '--';
    bar.innerHTML = `
      <div class="job-bar-header">
        <span class="job-bar-label job-bar-active">FLUX</span>
        <span class="job-bar-title">Image gen — ${escapeHtml(data.mode || 'batch')}</span>
        <span class="job-bar-time">${elapsed} / ETA ${eta}</span>
      </div>
      <div class="job-bar-track">
        <div class="job-bar-fill job-bar-flux" style="width:${pct}%"></div>
        <span class="job-bar-pct">${pct}%</span>
      </div>
      <div class="job-bar-meta">
        <span class="muted">pkg: ${escapeHtml(data.package_id || '--')}</span>
        <span class="muted">pid: ${escapeHtml(String(data.pid || '--'))}</span>
      </div>
      ${data.stderr_tail ? `<details class="job-bar-stderr"><summary>stderr</summary><pre>${escapeHtml(data.stderr_tail)}</pre></details>` : ''}
    `;
  }

  function renderPresto(container, data) {
    const bar = container.querySelector('#prestoJobBar');
    if (!bar) return;
    if (!data || (!data.active && !data.completed)) {
      bar.innerHTML = `
        <div class="job-bar-empty">
          <span class="job-bar-label">PRESTO</span>
          <span class="muted">Idle — no active Wan2.2 render</span>
        </div>
      `;
      return;
    }
    const job = data.active || data.completed;
    const running = !!data.active;
    const pct = job.progress_pct || (running ? 0 : 100);
    const elapsed = fmtTime(job.running_seconds || 0);
    const eta = running ? (job.eta_label || '--') : 'Done';
    const stateClass = running ? 'job-bar-active' : (job.exit_code === 0 ? 'job-bar-done' : 'job-bar-failed');
    bar.innerHTML = `
      <div class="job-bar-header">
        <span class="job-bar-label ${stateClass}">PRESTO</span>
        <span class="job-bar-title">Wan2.2 I2V — ${escapeHtml(job.package_id || '--')}</span>
        <span class="job-bar-time">${elapsed} / ${eta}</span>
      </div>
      <div class="job-bar-track">
        <div class="job-bar-fill job-bar-presto" style="width:${pct}%"></div>
        <span class="job-bar-pct">${pct}%</span>
      </div>
      <div class="job-bar-meta">
        <span class="muted">${running ? 'Rendering on RTX 4090' : (job.exit_code === 0 ? 'Completed OK' : 'Failed (exit ' + job.exit_code + ')')}</span>
        ${job.comfyui_url ? `<a href="${escapeHtml(job.comfyui_url)}" target="_blank" rel="noopener" class="job-bar-link">ComfyUI &rarr;</a>` : ''}
      </div>
      ${job.stderr_tail ? `<details class="job-bar-stderr"><summary>stderr</summary><pre>${escapeHtml(job.stderr_tail)}</pre></details>` : ''}
    `;
  }

  globalScope.JobProgress = { mount, stopPolling };
})(window);
