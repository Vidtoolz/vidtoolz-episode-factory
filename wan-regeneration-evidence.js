'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function walk(root, basename, out = []) {
  if (!root || !fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, basename, out);
    else if (entry.isFile() && entry.name === basename) out.push(full);
  }
  return out;
}

function durationHours(start, finish) {
  const a = Date.parse(start || ''); const b = Date.parse(finish || '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 3600000 : null;
}

function wanRuns(aigenRoot) {
  const runsRoot = path.join(aigenRoot || '', 'image-to-video', 'production', 'wan22-81f', 'runs');
  if (!fs.existsSync(runsRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const run = readJson(path.join(runsRoot, entry.name, 'run.log'));
    if (!run) continue;
    out.push({ ...run, run_id: run.run_id || entry.name, output_file: path.join(runsRoot, entry.name, 'output.mp4') });
  }
  return out;
}

function normalizedSuperFocusEvent(file, attempt) {
  const r = attempt.regeneration || {};
  const project = path.basename(path.dirname(file));
  return {
    event_id: `super-focus:${project}:${attempt.attempt_id}`,
    project, package: project, slot: attempt.index, lane: 'super-focus-presto', surface: 'super_focus',
    timestamp: r.recorded_at || attempt.dispatched_at || null,
    reason: r.reason_code || null, note: r.note || '',
    previous_attempt_id: r.previous_attempt_id || null,
    previous_output_sha256: r.previous_output_sha256 || null,
    previous_output_path: r.previous_output_path || r.previous_archived_path || null,
    previous_profile: r.previous_profile || null,
    new_attempt_id: attempt.attempt_id || null, new_profile: r.new_profile || attempt.profile || null,
    previous_source_sha256: r.previous_source_sha256 || null,
    new_source_sha256: r.new_source_sha256 || (attempt.source && attempt.source.sha256) || null,
    previous_prompt_sha256: r.previous_prompt_sha256 || null,
    new_prompt_sha256: r.new_prompt_sha256 || (attempt.i2v && attempt.i2v.sha256) || null,
    source_changed: r.source_changed == null ? null : Boolean(r.source_changed),
    prompt_changed: r.prompt_changed == null ? null : Boolean(r.prompt_changed),
    profile_changed: r.profile_changed == null ? null : Boolean(r.profile_changed),
    technical_failure_predecessor: Boolean(r.technical_failure_predecessor),
    technical_failure_code: r.technical_failure_code || null,
    new_output_sha256: attempt.output && attempt.output.sha256 || null,
    new_output_path: attempt.output_rel || null,
    final_disposition: null,
    gpu_duration_hours: durationHours(attempt.dispatched_at, attempt.finished_at),
    schema: attempt.evidence_schema_version === 1 ? 'current' : 'legacy',
    source_file: file,
  };
}

function deltaBucket(event) {
  const changed = ['source', 'prompt', 'profile'].filter((key) => event[`${key}_changed`] === true);
  if (changed.length === 0) return 'none_changed';
  if (changed.length > 1) return 'multiple_changed';
  return `${changed[0]}_changed_only`;
}

function stats(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { attempts: 0, gpu_hours: 0, mean_hours: null, median_hours: null };
  const total = clean.reduce((a, b) => a + b, 0);
  const middle = Math.floor(clean.length / 2);
  return {
    attempts: clean.length, gpu_hours: total, mean_hours: total / clean.length,
    median_hours: clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2,
  };
}

function analyze(options = {}) {
  const superFocusRoot = options.superFocusRoot;
  const aigenRoot = options.aigenRoot;
  const events = [];
  const legacyUninstrumented = [];
  const schemaInvalid = [];
  const runs = wanRuns(aigenRoot);

  for (const file of walk(superFocusRoot, 'video-attempts.json')) {
    const data = readJson(file);
    if (!data || !data.attempts) { schemaInvalid.push({ source_file: file, issue: 'unreadable_or_malformed' }); continue; }
    const attempts = Object.values(data.attempts).sort((a, b) => String(a.dispatched_at).localeCompare(String(b.dispatched_at)));
    const seen = new Map();
    for (const attempt of attempts) {
      const prior = seen.get(String(attempt.index));
      if (attempt.regeneration) {
        const event = normalizedSuperFocusEvent(file, attempt);
        if (event.previous_attempt_id && !data.attempts[event.previous_attempt_id]) event.broken_attempt_link = true;
        if (event.previous_output_path
            && !fs.existsSync(path.resolve(path.dirname(file), event.previous_output_path))) event.referenced_output_absent = true;
        events.push(event);
      }
      else if (prior) legacyUninstrumented.push({ surface: 'super_focus', project: path.basename(path.dirname(file)), slot: attempt.index, new_attempt_id: attempt.attempt_id, previous_attempt_id: prior.attempt_id, historical_objective_delta: { source_changed: prior.source && attempt.source ? prior.source.sha256 !== attempt.source.sha256 : null, prompt_changed: prior.i2v && attempt.i2v ? prior.i2v.sha256 !== attempt.i2v.sha256 : null, profile_changed: prior.profile != null && attempt.profile != null ? prior.profile !== attempt.profile : null } });
      if (attempt.evidence_schema_version === 1 && attempt.generation_semantics !== 'first_generation' && !attempt.regeneration) schemaInvalid.push({ source_file: file, attempt_id: attempt.attempt_id, issue: 'current_regeneration_missing_diagnosis' });
      seen.set(String(attempt.index), attempt);
    }
  }

  for (const file of walk(aigenRoot, 'wan-regeneration-events.json')) {
    const data = readJson(file);
    if (!data || !Array.isArray(data.events)) { schemaInvalid.push({ source_file: file, issue: 'unreadable_or_malformed' }); continue; }
    for (const raw of data.events) {
      const slot = Number(raw.slot);
      const run = runs.filter((candidate) => String(candidate.profile || '') === String(raw.new_profile || '')
        && String(candidate.source || '').includes(`/script-packages/${raw.project || raw.package}/`)
        && (!Number.isFinite(slot) || String(candidate.label || '').endsWith(`-${String(slot).padStart(3, '0')}`))
        && (!raw.timestamp || Date.parse(candidate.created_at || '') >= Date.parse(raw.timestamp)))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;
      let outputSha = raw.new_output_sha256 || null;
      if (!outputSha && run && fs.existsSync(run.output_file)) {
        const crypto = require('crypto');
        outputSha = crypto.createHash('sha256').update(fs.readFileSync(run.output_file)).digest('hex');
      }
      const event = {
        ...raw,
        new_attempt_id: raw.new_attempt_id || (run && run.run_id) || null,
        new_output_sha256: outputSha,
        schema: 'current',
        gpu_duration_hours: Number.isFinite(raw.gpu_duration_hours) ? raw.gpu_duration_hours
          : (run && Number.isFinite(run.elapsed) ? run.elapsed / 3600 : null),
        source_file: file,
      };
      if (event.previous_attempt_id && !runs.some((candidate) => candidate.run_id === event.previous_attempt_id)) event.broken_attempt_link = true;
      if (event.previous_output_path) {
        const previousPath = path.isAbsolute(event.previous_output_path)
          ? event.previous_output_path : path.resolve(path.dirname(path.dirname(file)), event.previous_output_path);
        if (!fs.existsSync(previousPath)) event.referenced_output_absent = true;
      }
      events.push(event);
    }
  }

  const ids = new Set();
  for (const event of events) {
    if (!event.event_id) schemaInvalid.push({ source_file: event.source_file, issue: 'missing_event_identity' });
    else if (ids.has(event.event_id)) schemaInvalid.push({ source_file: event.source_file, event_id: event.event_id, issue: 'duplicate_regeneration_event_identity' });
    ids.add(event.event_id);
    if (!event.previous_attempt_id) event.lineage_issue = 'missing_predecessor_attempt';
    if (!event.previous_output_sha256 && !event.technical_failure_predecessor) event.output_lineage_issue = 'missing_predecessor_output_hash';
  }

  const current = events.filter((e) => e.schema === 'current');
  const diagnosed = current.filter((e) => e.reason);
  const coverage = current.length ? diagnosed.length / current.length : null;
  const packages = new Set(diagnosed.map((e) => e.project || e.package).filter(Boolean));
  const reasons = new Map(); const surfaces = new Map(); const deltas = new Map();
  for (const event of diagnosed) {
    reasons.set(event.reason, (reasons.get(event.reason) || 0) + 1);
    surfaces.set(event.surface || 'other', (surfaces.get(event.surface || 'other') || 0) + 1);
    const bucket = deltaBucket(event); deltas.set(bucket, (deltas.get(bucket) || 0) + 1);
  }
  const durationEvents = diagnosed.filter((e) => Number.isFinite(e.gpu_duration_hours));
  const byReasonGpu = {};
  for (const reason of reasons.keys()) byReasonGpu[reason] = stats(diagnosed.filter((e) => e.reason === reason).map((e) => e.gpu_duration_hours));
  const largestPackage = packages.size ? Math.max(...Array.from(packages).map((p) => diagnosed.filter((e) => (e.project || e.package) === p).length)) / diagnosed.length : null;
  const concentration = reasons.size === 1 && diagnosed.length >= 20;
  const lineageIssues = schemaInvalid.concat(events.filter((e) => e.lineage_issue || e.output_lineage_issue || e.broken_attempt_link || e.referenced_output_absent).map((e) => ({ event_id: e.event_id, predecessor: e.lineage_issue || null, output: e.output_lineage_issue || null, broken_attempt_link: Boolean(e.broken_attempt_link), referenced_output_absent: Boolean(e.referenced_output_absent) })));
  const requirements = {
    complete_coverage: coverage === 1 && schemaInvalid.filter((x) => x.issue === 'current_regeneration_missing_diagnosis').length === 0,
    diagnosed_events: diagnosed.length >= 20,
    packages: packages.size >= 3,
    categories: reasons.size >= 3 || concentration,
    gpu_duration_events: durationEvents.length >= 10,
    package_concentration: largestPackage != null && largestPackage <= 0.70,
    lineage_integrity: lineageIssues.length === 0,
  };
  const ready = Object.values(requirements).every(Boolean);
  return {
    generated_at: new Date().toISOString(), mode: 'read_only',
    readiness: ready ? 'READY_FOR_PARETO_REVIEW' : 'NOT_READY', requirements,
    coverage: { total_regeneration_events: current.length, diagnosed: diagnosed.length, undiagnosed: current.length - diagnosed.length, coverage_percent: coverage == null ? null : coverage * 100, legacy_uninstrumented: legacyUninstrumented.length, current_schema_invalid: schemaInvalid.length },
    surfaces: Object.fromEntries(surfaces), reasons: Object.fromEntries(reasons), objective_deltas: Object.fromEntries(deltas),
    gpu_attribution: { events_with_duration: durationEvents.length, total_gpu_hours: durationEvents.reduce((sum, e) => sum + e.gpu_duration_hours, 0), by_reason: byReasonGpu },
    sample: { packages_represented: packages.size, categories_represented: reasons.size, largest_package_share_percent: largestPackage == null ? null : largestPackage * 100 },
    lineage_integrity: { issues: lineageIssues },
    legacy_uninstrumented: legacyUninstrumented,
    events,
  };
}

module.exports = { analyze, deltaBucket, stats };
