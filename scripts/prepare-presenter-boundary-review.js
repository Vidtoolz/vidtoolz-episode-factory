'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const boundary = require('./presenter-boundary-review.js');
const planningReview = require('./package-run-shot-edit-plan-review.js');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function parseSilences(stderr) {
  const starts = []; const intervals = [];
  for (const line of String(stderr).split(/\r?\n/)) {
    let m = /silence_start:\s*([0-9.]+)/.exec(line); if (m) starts.push(Number(m[1]));
    m = /silence_end:\s*([0-9.]+).*silence_duration:\s*([0-9.]+)/.exec(line);
    if (m) { const start = starts.shift(); if (Number.isFinite(start)) intervals.push({ start_ms: Math.round(start * 1000), end_ms: Math.round(Number(m[1]) * 1000), duration_ms: Math.round(Number(m[2]) * 1000) }); }
  }
  return intervals;
}
function detectSilences(file, options = {}) {
  const noise = options.noise || '-35dB'; const minimum = options.minimumSeconds || 0.65;
  const result = (options.runner || childProcess.spawnSync)('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${noise}:d=${minimum}`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.status !== 0) { const error = new Error(`silence analysis failed for ${file}`); error.code = 'BOUNDARY_PROPOSAL_ANALYSIS_FAILED'; throw error; }
  return { intervals: parseSilences(result.stderr), parameters: { analyzer: 'ffmpeg-silencedetect', noise, minimum_s: minimum } };
}
function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length || 1; }
function proposeIntervals(durationMs, sections, silenceResult) {
  if (sections.length === 1) return [{ in_ms: 0, out_ms: durationMs }];
  const weights = sections.map((s) => wordCount(s.approved_dialogue)); const total = weights.reduce((a, b) => a + b, 0);
  const candidates = silenceResult.intervals.filter((s) => s.duration_ms >= 650).map((s) => Math.round((s.start_ms + s.end_ms) / 2)).filter((v) => v > 750 && v < durationMs - 750);
  const cuts = []; let cumulative = 0; let prior = 0;
  for (let index = 0; index < sections.length - 1; index++) {
    cumulative += weights[index]; const ideal = Math.round(durationMs * cumulative / total);
    const eligible = candidates.filter((v) => v > prior + 750 && v < durationMs - (sections.length - index - 1) * 750);
    const cut = eligible.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0] ?? ideal;
    cuts.push(cut); prior = cut;
  }
  const points = [0, ...cuts, durationMs];
  return sections.map((_, i) => ({ in_ms: points[i], out_ms: points[i + 1] }));
}
function plannedFraming(plan, sectionId) {
  const shot = (plan.shots || []).find((s) => s.media_type === 'PRESENTER_A_ROLL' && s.beat_ref?.section_id === sectionId);
  return shot?.camera_intent?.subject || shot?.shot_brief || 'VP2_PRESENTER_A_ROLL';
}
function prepareRealRun(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput); const runId = path.basename(runDir);
  const approval = planningReview.readContext(runDir).approvalBinding;
  if (!approval?.ok) { const error = new Error(approval?.detail || 'canonical VP2 approval is not valid'); error.code = 'VP2_APPROVAL_AUTHORITY_INVALID'; throw error; }
  const plan = readJson(path.join(runDir, 'visual-plan.json'));
  const manifest = readJson(path.join(runDir, 'presenter-take-manifest.json'));
  const brief = readJson(path.join(runDir, 'TIER3-ASSEMBLY-BRIEF.json'));
  const evidence = readJson(path.join(runDir, 'PRESENTER-CAPTURE-EVIDENCE.json'));
  const predecessorPath = path.join(runDir, 'HUMAN-REVIEW-PERFORMANCE-V1.json');
  const predecessor = readJson(predecessorPath);
  if (predecessor.verdict !== 'KEEP ALL' || predecessor.reviewer?.type !== 'HUMAN') { const error = new Error('exact KEEP ALL predecessor review required'); error.code = 'PREDECESSOR_REVIEW_INVALID'; throw error; }
  const story = manifest.story;
  const visualPlan = { plan_id: plan.plan_id, version: plan.plan_revision, digest_sha256: plan.plan_digest_sha256, approval_state: 'approved' };
  const evidenceByName = new Map((evidence.masters || []).map((m) => [m.canonical_name, m]));
  const masters = (brief.masters || []).map((m) => {
    const file = path.join(runDir, m.run_relative_path); const expected = evidenceByName.get(m.canonical_name);
    const actualSha = hashFile(file);
    if (actualSha !== m.sha256 || actualSha !== expected?.sha256) { const error = new Error(`${m.master_id} bytes differ from accepted evidence`); error.code = 'SOURCE_MEDIA_DRIFT'; throw error; }
    return { master_id: m.master_id, path: file, sha256: actualSha, duration_ms: Math.round(m.duration_s * 1000), section_orders: m.sections_covered_in_performance_order, section_ids: m.sections_covered_in_performance_order.map((n) => brief.section_map.find((s) => s.order === n)?.section_id), captured_framing: m.setup };
  });
  const unitBySection = new Map((manifest.recording_units || []).map((u, i) => [u.section_id, { ...u, story_order: i + 1 }]));
  const sections = [];
  for (const master of masters) {
    const ordered = master.section_ids.map((id) => unitBySection.get(id));
    const silence = detectSilences(master.path, options);
    const proposals = proposeIntervals(master.duration_ms, ordered, silence);
    ordered.forEach((unit, i) => sections.push({
      section_id: unit.section_id, recording_unit_id: unit.recording_unit_id, story_order: unit.story_order,
      approved_script_excerpt: unit.approved_dialogue,
      master_id: master.master_id, planned_framing: plannedFraming(plan, unit.section_id), captured_framing: master.captured_framing,
      crop_policy: { class: 'DETERMINISTIC_TECHNICAL_IMPLEMENTATION', human_confirmation_required: false, rule: 'compose a 1080-wide vertical window implementing approved VP2 camera intent; preserve the accepted captured composition; record exact x; never simulate a physically wider shot', machine_measurement: null },
      proposal: { ...proposals[i], boundary_class: 'MACHINE_INFERRED_PROVISIONAL', method: 'SILENCE_WEIGHTED_SCRIPT_ORDER', analyzer_parameters: silence.parameters, candidate_evidence_sha256: boundary.sha256(boundary.canonicalize(silence.intervals)) },
    }));
  }
  return boundary.createSession({
    run_id: runId, production_mode: 'PRODUCTION', story, visual_plan: visualPlan,
    visual_plan_approval_evidence: { authority_class: 'GATE_6_APPROVAL_BINDING', marker_file: approval.marker_file, approved_digest: approval.approved_digest, current_digest: approval.current_plan_digest, verified: true, stale_source_lifecycle_state: plan.lifecycle_state, stale_field_is_authority: false },
    predecessor_review: { path: predecessorPath, sha256: hashFile(predecessorPath), verdict: predecessor.verdict, reviewed_at: predecessor.reviewed_at },
    masters, sections, insert_policy: brief.insert_slots,
    music_policy: { state: 'MUSIC_DURATION_POLICY_HUMAN_DECISION_REQUIRED', asset_id: brief.music.asset_id, sha256: brief.music.sha256, duration_ms: Math.round(brief.music.duration_seconds * 1000), allowed_decisions: ['LOOP_WITH_CROSSFADE_FOR_FULL_PROGRAMME', 'END_NATURALLY_OR_FADE_BEFORE_PROGRAMME_END'] },
    prepared_at: options.now || new Date().toISOString(), prepared_by: options.preparedBy || 'presenter-boundary-review-proposer',
  });
}

function main(argv = process.argv.slice(2)) {
  const runDir = argv[0]; let output = null; let dryRun = false;
  for (let i = 1; i < argv.length; i++) { if (argv[i] === '--output') output = argv[++i]; else if (argv[i] === '--dry-run') dryRun = true; }
  if (!runDir || (!output && !dryRun)) { console.error('usage: prepare-presenter-boundary-review.js <run-dir> --output <session.json> [--dry-run]'); return 2; }
  try { const session = prepareRealRun(runDir); if (dryRun) console.log(JSON.stringify({ run_id: session.run_id, state: 'PROPOSALS_ONLY', sections: session.sections.map((s) => ({ section_id: s.section_id, master_id: s.master_id, proposal: s.proposal })), binding_digest_sha256: session.binding_digest_sha256 }, null, 2)); else { const target = path.resolve(output); const tmp = `${target}.tmp-${process.pid}`; fs.writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(tmp, target); console.log(target); } return 0; }
  catch (error) { console.error(`${error.code || 'BOUNDARY_PREPARE_FAILED'}: ${error.message}`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { parseSilences, detectSilences, proposeIntervals, prepareRealRun };
