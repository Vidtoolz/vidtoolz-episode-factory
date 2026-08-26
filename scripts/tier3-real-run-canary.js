'use strict';

/* Read-only compatibility audit for captured batch masters. It deliberately
 * reports missing authority instead of fabricating section timecodes or
 * rewriting live production evidence. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function inspectRealRun(runDir, options = {}) {
  const dir = path.resolve(runDir);
  const evidence = readJson(path.join(dir, 'PRESENTER-CAPTURE-EVIDENCE.json'));
  const review = readJson(path.join(dir, 'HUMAN-REVIEW-PERFORMANCE-V1.json'));
  const story = readJson(path.join(dir, 'story-binding.json'));
  const plan = readJson(path.join(dir, 'visual-plan-v2.json'));
  const blockers = [];
  const results = [];
  const reviewByName = new Map((review.decisions || []).map((decision) => [decision.master, decision]));

  for (const master of evidence.masters || []) {
    const file = path.join(dir, 'media', 'presenter-masters', master.canonical_name);
    const sidecarFile = path.join(dir, 'media', 'presenter-masters', master.canonical_name.replace(/\.mp4$/, '_sidecar.json').replace(/batch-master-([A-Z])_.+_sidecar/, 'batch-master-$1_sidecar'));
    const actualSha = fs.existsSync(file) ? sha256File(file) : null;
    const decision = reviewByName.get(master.canonical_name);
    let probe = null;
    if (fs.existsSync(file) && options.probe !== false) {
      const run = (options.runner || childProcess.spawnSync)('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
      if (run.status === 0) try { probe = JSON.parse(run.stdout); } catch (_) { probe = null; }
    }
    const streams = probe?.streams || [];
    const item = {
      master: master.canonical_name, file, expected_sha256: master.sha256, actual_sha256: actualSha,
      hash_matches: actualSha === master.sha256, byte_size_matches: fs.existsSync(file) && fs.statSync(file).size === master.byte_size,
      review_hash_matches: decision?.sha256 === master.sha256 && decision?.verdict === 'KEEP',
      sections_covered: master.sections_covered, duration_s: Number(probe?.format?.duration || master.duration_s || 0),
      has_video: streams.some((stream) => stream.codec_type === 'video'), has_audio: streams.some((stream) => stream.codec_type === 'audio'),
      sidecar_path: sidecarFile, sidecar_present: fs.existsSync(sidecarFile),
    };
    results.push(item);
    if (!item.hash_matches) blockers.push({ code: 'REAL_MASTER_HASH_MISMATCH', master: master.canonical_name });
    if (!item.review_hash_matches) blockers.push({ code: 'REAL_MASTER_REVIEW_BINDING_MISMATCH', master: master.canonical_name });
    if (probe && (!item.has_video || !item.has_audio)) blockers.push({ code: 'REAL_MASTER_STREAM_MISSING', master: master.canonical_name });
  }
  if (review.verdict !== 'KEEP ALL' || review.reviewer?.type !== 'HUMAN') blockers.push({ code: 'REAL_PERFORMANCE_HUMAN_REVIEW_INVALID' });
  if (!(review.story?.project_id && review.story?.version_id && review.story?.content_hash)) blockers.push({ code: 'REVIEW_STORY_BINDING_MISSING' });
  if (!(review.visual_plan?.plan_id && review.visual_plan?.digest_sha256)) blockers.push({ code: 'REVIEW_VISUAL_PLAN_BINDING_MISSING' });
  if (!Array.isArray(review.segment_boundaries) || review.segment_boundaries.length === 0) blockers.push({ code: 'SECTION_BOUNDARY_AUTHORITY_MISSING' });
  const sectionSet = new Set(results.flatMap((item) => item.sections_covered || []));
  if (sectionSet.size !== 11 || [...sectionSet].some((value) => !Number.isInteger(value) || value < 1 || value > 11)) blockers.push({ code: 'MASTER_SECTION_MEMBERSHIP_INCOMPLETE' });

  return {
    schema: 'vidtoolz.tier3RealRunCanary.v1', run_id: path.basename(dir), read_only: true,
    story: story.story, visual_plan: { plan_id: plan.plan_id, version: plan.plan_revision, digest_sha256: plan.plan_digest_sha256 },
    human_review: { verdict: review.verdict, reviewed_at: review.reviewed_at, reviewer_type: review.reviewer?.type },
    masters: results, section_membership_complete: sectionSet.size === 11,
    assembly_eligible: blockers.length === 0, blockers,
  };
}

module.exports = { inspectRealRun };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: tier3-real-run-canary.js <package-run-dir>'); process.exit(2); }
  const result = inspectRealRun(dir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.assembly_eligible ? 0 : 1);
}
