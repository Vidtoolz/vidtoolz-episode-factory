'use strict';

// In-memory Script Evaluator evaluation-job manager.
//
// Chunked evaluation is slow (~85-100s per qwen3:14b chunk), so a full script
// must not be one blocking HTTP request. This runs the chunks as a background
// job with progress the client can poll. It is deliberately model-agnostic: the
// server injects processChunk/assemble/formatError so this module has no network
// or Ollama knowledge and is unit-testable with fakes.
//
// Policy: ONE active evaluation job at a time (per manager instance = per
// server). Jobs are in-memory only; after a cockpit restart a job id is simply
// "not found" and the UI can retry. Job ids are server-generated (never
// user-controlled) and validated with a strict pattern.

const crypto = require('crypto');

const JOB_ID_RE = /^se-[a-f0-9]{16}$/;

function assertValidJobId(id) {
  if (!JOB_ID_RE.test(String(id == null ? '' : id))) {
    const e = new Error('Invalid evaluation job id.');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

function createEvaluationJobManager(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();
  const randomId = typeof deps.randomId === 'function' ? deps.randomId : () => 'se-' + crypto.randomBytes(8).toString('hex');
  const jobs = new Map();
  let activeId = null;

  function hasActive() {
    if (!activeId) return false;
    const j = jobs.get(activeId);
    return Boolean(j && (j.status === 'queued' || j.status === 'running'));
  }

  function runningMessage(job) {
    if (job.status === 'queued') return 'Queued…';
    if (job.status === 'running') {
      const label = (job.provider && job.provider.label) || 'vidnux Ollama';
      return `Evaluating chunk ${job.current_chunk}/${job.chunks_total} with ${label}…`;
    }
    return job.message || null;
  }

  function snapshot(job) {
    const p = job.payload || {};
    return {
      job_id: job.id,
      status: job.status,
      chunks_total: job.chunks_total,
      chunks_completed: job.chunks_completed,
      current_chunk: job.current_chunk,
      provider: job.provider || null,
      partial: job.partial,
      message: runningMessage(job),
      timeout_seconds: job.timeout_seconds || null,
      summary: p.summary || '',
      verdict: p.verdict != null ? p.verdict : null,
      total_score: p.total_score != null ? p.total_score : null,
      scores: p.scores || null,
      spans: p.spans || [],
      highlighted_html: p.highlighted_html || '',
      approved: p.approved || [],
      disapproved: p.disapproved || [],
      suggested_corrections: p.suggested_corrections || [],
      notes: p.notes || [],
      evaluation: p.evaluation || null,
      error: job.error || null,
      started_at: job.started_at,
      updated_at: job.updated_at,
    };
  }

  // spec = { chunks, processChunk(chunk,i)->{scored,provider}, assemble(evals,isDone)->payload,
  //          formatError(err,completed,total)->string, partialMessage(completed,total)->string,
  //          providerHint, timeoutSeconds }
  function start(spec) {
    if (hasActive()) {
      const e = new Error('Another script evaluation is already running. Wait or cancel it.');
      e.statusCode = 409;
      throw e;
    }
    const chunks = Array.isArray(spec.chunks) ? spec.chunks : [];
    const id = randomId();
    const job = {
      id,
      status: chunks.length ? 'running' : 'failed',
      chunks_total: chunks.length,
      chunks_completed: 0,
      current_chunk: chunks.length ? 1 : 0,
      provider: spec.providerHint || null,
      partial: true,
      payload: null,
      error: chunks.length ? null : 'Nothing to evaluate.',
      message: null,
      timeout_seconds: spec.timeoutSeconds || null,
      cancelRequested: false,
      started_at: now(),
      updated_at: now(),
      _spec: spec,
    };
    jobs.set(id, job);
    if (!chunks.length) { return snapshot(job); }
    activeId = id;
    // Fire-and-forget: the caller (HTTP handler) returns immediately.
    Promise.resolve().then(() => runJob(job)).catch((err) => {
      job.status = 'failed';
      job.error = (err && err.message) || String(err);
      job.updated_at = now();
      if (activeId === job.id) activeId = null;
    });
    return snapshot(job);
  }

  async function runJob(job) {
    const spec = job._spec;
    const completed = [];
    for (let i = 0; i < job.chunks_total; i += 1) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.message = `Evaluation cancelled after ${completed.length}/${job.chunks_total} chunks. Completed chunks are shown; the rest remains neutral.`;
        break;
      }
      job.current_chunk = i + 1;
      job.updated_at = now();
      try {
        const r = await spec.processChunk(job._spec.chunks[i], i);
        if (r && r.provider) job.provider = r.provider;
        completed.push(r && r.scored != null ? r.scored : r);
        job.chunks_completed = completed.length;
        job.payload = spec.assemble(completed, false); // partial payload after each chunk
        job.updated_at = now();
      } catch (err) {
        job.error = spec.formatError ? spec.formatError(err, completed.length, job.chunks_total) : ((err && err.message) || 'chunk failed');
        break;
      }
    }
    if (job.status !== 'cancelled') {
      if (completed.length === job.chunks_total && completed.length > 0) job.status = 'done';
      else if (completed.length > 0) job.status = 'partial';
      else job.status = 'failed';
    }
    if (completed.length > 0) {
      const done = job.status === 'done';
      job.partial = !done;
      job.payload = spec.assemble(completed, done);
      if (!done && !job.message && spec.partialMessage) job.message = spec.partialMessage(completed.length, job.chunks_total);
    } else {
      job.partial = false;
    }
    job.updated_at = now();
    if (activeId === job.id) activeId = null;
  }

  function get(id) {
    const j = jobs.get(id);
    return j ? snapshot(j) : null;
  }

  function cancel(id) {
    const j = jobs.get(id);
    if (!j) return null;
    if (j.status === 'queued' || j.status === 'running') {
      j.cancelRequested = true;
      j.message = 'Cancel requested — stopping after the current chunk.';
      j.updated_at = now();
    }
    return snapshot(j);
  }

  function activeSnapshot() { return activeId ? get(activeId) : null; }

  return { start, get, cancel, hasActive, activeSnapshot };
}

module.exports = { createEvaluationJobManager, assertValidJobId, JOB_ID_RE };
