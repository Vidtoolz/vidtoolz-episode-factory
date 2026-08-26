'use strict';

/*
 * Deterministic Production Assembly renderer.
 *
 * The LLM may prepare an authorized render specification and invoke this tool,
 * but it is not part of the closure path.  This module validates immutable
 * authority, writes a stable plan, renders to staging, runs machine QC, emits
 * non-gating evidence, and writes the COMPLETE marker last.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const boundaryReview = require('./presenter-boundary-review.js');
const compositionEngine = require('./production-assembly-composition.js');

const SPEC_SCHEMA = 'vidtoolz.productionAssemblyRenderSpec.v1';
const PACKET_SCHEMA = 'vidtoolz.productionAssemblyReleasePacket.v1';
const PLAN_SCHEMA = 'vidtoolz.productionAssemblyRenderPlan.v1';
const MANIFEST_SCHEMA = 'vidtoolz.productionAssemblyManifest.v1';
const EVIDENCE_SCHEMA = 'vidtoolz.productionAssemblyTechnicalEvidence.v1';
const COMPLETION_SCHEMA = 'vidtoolz.productionAssemblyCompletion.v1';
const SHA_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_RE = /(?:proxy|piper|synthetic|tts|draft-v1|draft[_-]narration|draft[_-]presenter)/i;
const BOUNDARY_CLASSES = new Set(['HUMAN_CONFIRMED', 'CAPTURE_EVENT_BOUND']);
const MUSIC_POLICIES = new Set(['FADE_EARLY', 'LOOP_WITH_CROSSFADE', 'FULL_PROGRAMME', 'NONE']);
const INSERT_NECESSITY = new Set(['ESSENTIAL', 'USEFUL', 'OPTIONAL']);
const PERFORMANCE_ROLES = new Set(['HUMAN_DRAFT_PERFORMANCE', 'FINAL_HUMAN_PERFORMANCE']);
const LOCK_SCHEMA = 'vidtoolz.productionAssemblyRenderLock.v1';
const STATE_SCHEMA = 'vidtoolz.productionAssemblyRenderState.v1';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function sameStory(a, b) { return Boolean(a && b && a.project_id === b.project_id && a.version_id === b.version_id && a.content_hash === b.content_hash && a.approval_state === b.approval_state); }
function samePlan(a, b) { return Boolean(a && b && a.plan_id === b.plan_id && a.version === b.version && a.digest_sha256 === b.digest_sha256 && a.approval_state === b.approval_state); }
function readJson(filePath, code = 'JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(code, `${filePath}: ${error.message}`); }
}
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, filePath);
}
async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject); stream.on('data', (chunk) => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function execFile(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) fail(options.code || 'COMMAND_FAILED', `${command} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}
function probeMedia(filePath) {
  const parsed = JSON.parse(execFile('ffprobe', ['-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', filePath], { code: 'MEDIA_PROBE_FAILED' }));
  const video = (parsed.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (parsed.streams || []).find((stream) => stream.codec_type === 'audio');
  return {
    duration_ms: Math.round(Number(parsed.format?.duration || video?.duration || audio?.duration || 0) * 1000),
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, r_frame_rate: video.r_frame_rate, avg_frame_rate: video.avg_frame_rate, nb_frames: Number(video.nb_read_frames ?? video.nb_frames) } : null,
    audio: audio ? { codec: audio.codec_name, sample_rate: Number(audio.sample_rate), channels: audio.channels } : null,
    raw: parsed,
  };
}
function realExisting(filePath, code) {
  try { return fs.realpathSync(filePath); } catch (_) { fail(code, `required file missing: ${filePath}`); }
}
function inside(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function requireInputPath(filePath, roots, label) {
  if (typeof filePath !== 'string' || !filePath) fail('INPUT_PATH_REQUIRED', label);
  const target = realExisting(filePath, 'INPUT_FILE_MISSING');
  const allowed = roots.map((root) => realExisting(root, 'INPUT_ROOT_MISSING'));
  if (!allowed.some((root) => inside(root, target))) fail('INPUT_PATH_OUTSIDE_ALLOWED_ROOT', `${label}: ${target}`);
  if (!fs.statSync(target).isFile()) fail('INPUT_NOT_FILE', `${label}: ${target}`);
  return target;
}
function requireOutputPath(outputRoot, relativePath) {
  const root = realExisting(outputRoot, 'OUTPUT_ROOT_MISSING');
  if (path.isAbsolute(relativePath) || !relativePath || relativePath.includes('\0')) fail('OUTPUT_PATH_INVALID', String(relativePath));
  const target = path.resolve(root, relativePath);
  if (!inside(root, target)) fail('OUTPUT_PATH_ESCAPE', target);
  let parent = path.dirname(target);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (!inside(root, fs.realpathSync(parent))) fail('OUTPUT_SYMLINK_ESCAPE', target);
  return { root, target };
}
function assertSha(value, label) { if (!SHA_RE.test(value || '')) fail('SHA256_INVALID', label); }
function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value || {})) if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `${label}.${key}`);
}
function ffmpegVersion() { return execFile('ffmpeg', ['-version']).split('\n')[0].trim(); }
function ffprobeVersion() { return execFile('ffprobe', ['-version']).split('\n')[0].trim(); }
function processStartIdentity(pid = process.pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const startTicks = stat.slice(close + 2).split(' ')[19];
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return `${bootId}:${startTicks}`;
  } catch (_) { return null; }
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
function fileFingerprint(filePath) {
  try { const stat = fs.statSync(filePath); return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`; }
  catch (_) { return 'MISSING'; }
}
function sleepMs(milliseconds) { if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }
function lockObservedFiles(paths) { return [paths.lock, paths.output, paths.staged, paths.state, paths.manifest, paths.evidence, paths.completion]; }
function lockHolderState(lock, options = {}) {
  if (!lock || lock.schema !== LOCK_SCHEMA || !lock.owner_token || !lock.hostname || !Number.isInteger(lock.pid) || !lock.process_start_identity) return 'MALFORMED';
  const hostname = options.hostname || os.hostname();
  if (lock.hostname !== hostname) return 'REMOTE_UNPROVABLE';
  const alive = (options.processAlive || processAlive)(lock.pid);
  if (!alive) return 'DEAD';
  const identity = (options.processIdentity || processStartIdentity)(lock.pid);
  return identity && identity === lock.process_start_identity ? 'ACTIVE' : 'PID_REUSED';
}
function acquireRenderLock(paths, plan, options = {}) {
  fs.mkdirSync(path.dirname(paths.lock), { recursive: true });
  const hostname = options.hostname || os.hostname();
  const identity = options.currentProcessIdentity || (options.processIdentity || processStartIdentity)(process.pid);
  if (!identity) fail('LOCK_PROCESS_IDENTITY_UNAVAILABLE', 'cannot establish process start identity');
  const lock = {
    schema: LOCK_SCHEMA, owner_token: crypto.randomUUID(), render_id: plan.plan_digest_sha256.slice(0, 24),
    pid: process.pid, process_start_identity: identity, hostname, started_at: new Date().toISOString(),
    handoff_digest_sha256: plan.release_packet.sha256, plan_digest_sha256: plan.plan_digest_sha256,
    intended_output: paths.output, staged_output: paths.staged,
  };
  try { fs.writeFileSync(paths.lock, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); return lock; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  let existing;
  try { existing = readJson(paths.lock, 'RENDER_LOCK_MALFORMED'); }
  catch (_) { fail('RENDER_LOCK_MALFORMED', 'malformed lock requires operator inspection'); }
  const holder = lockHolderState(existing, options);
  if (holder === 'ACTIVE') fail('RENDER_LOCK_ACTIVE', `candidate owned by active render ${existing.render_id}`);
  if (holder === 'REMOTE_UNPROVABLE') fail('RENDER_LOCK_REMOTE_UNPROVABLE', `cannot prove remote holder dead: ${existing.hostname}`);
  if (holder === 'MALFORMED') fail('RENDER_LOCK_MALFORMED', 'malformed lock requires operator inspection');
  const observed = lockObservedFiles(paths);
  const before = observed.map(fileFingerprint);
  (options.sleep || sleepMs)(options.lockObservationMs ?? 100);
  const after = observed.map(fileFingerprint);
  if (canonicalize(before) !== canonicalize(after)) fail('RENDER_LOCK_OUTPUT_ACTIVE', 'render artifacts changed while stale lock was observed');
  const stale = `${paths.lock}.stale-${Date.now()}-${digest(existing).slice(0, 8)}`;
  fs.renameSync(paths.lock, stale);
  fs.writeFileSync(paths.lock, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return lock;
}
function releaseRenderLock(lockPath, owned) {
  if (!owned || !fs.existsSync(lockPath)) return;
  const current = readJson(lockPath, 'RENDER_LOCK_MALFORMED');
  if (current.owner_token !== owned.owner_token) fail('RENDER_LOCK_OWNERSHIP_LOST', 'refusing to release another renderer lock');
  fs.unlinkSync(lockPath);
}
function musicDecisionDigest(entry) {
  const copy = { ...entry }; delete copy.binding_digest_sha256;
  return digest(copy);
}
function activeMusicDecision(music) {
  const history = music?.policy_history;
  if (!Array.isArray(history) || history.length === 0) fail('MUSIC_POLICY_HISTORY_REQUIRED', 'append-only music policy history required');
  const ids = new Set(); let predecessor = null; let active = null;
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (!item.decision_id || ids.has(item.decision_id) || item.predecessor_decision_id !== predecessor || !MUSIC_POLICIES.has(item.policy) || musicDecisionDigest(item) !== item.binding_digest_sha256) fail('MUSIC_POLICY_HISTORY_INVALID', `entry ${index}`);
    if (index < history.length - 1 && item.status !== 'SUPERSEDED') fail('MUSIC_POLICY_HISTORY_INVALID', `entry ${index} must be superseded`);
    if (item.status === 'ACTIVE') { if (active) fail('MUSIC_POLICY_HISTORY_INVALID', 'multiple active decisions'); active = item; }
    ids.add(item.decision_id); predecessor = item.decision_id;
  }
  if (!active || active !== history[history.length - 1]) fail('MUSIC_POLICY_HISTORY_INVALID', 'latest decision must be the sole active decision');
  if (active.authority?.type !== 'HUMAN' || !active.authority.id) fail('MUSIC_HUMAN_AUTHORITY_REQUIRED', 'active creative music decision must be HUMAN');
  if (active.policy !== music.policy || (music.sha256 || null) !== (active.music_sha256 || null)) fail('MUSIC_POLICY_HISTORY_INVALID', 'active decision does not bind render policy/music');
  return active;
}

async function validateInputs(spec, options = {}) {
  if (spec?.schema !== SPEC_SCHEMA) fail('RENDER_SPEC_SCHEMA_INVALID', 'exact render spec schema required');
  if (!spec.run_id || !PERFORMANCE_ROLES.has(spec.performance_role)) fail('PERFORMANCE_ROLE_INVALID', 'supported exact human performance role required');
  if (spec.output_class !== 'PRODUCTION_ASSEMBLY_CANDIDATE' || spec.evidence_class !== 'PROPOSED_PRODUCTION_ASSEMBLY_TECHNICAL_EVIDENCE' || spec.gate_authority !== false) fail('OUTPUT_AUTHORITY_INVALID', 'non-gating Production candidate semantics required');
  if (!Array.isArray(spec.input_roots) || spec.input_roots.length === 0) fail('INPUT_ROOTS_REQUIRED', 'explicit input roots required');
  const packetPath = requireInputPath(spec.release_packet?.path, spec.input_roots, 'release packet');
  const reviewPath = requireInputPath(spec.human_review?.path, spec.input_roots, 'human review');
  assertSha(spec.release_packet?.sha256, 'release packet sha256');
  assertSha(spec.human_review?.file_sha256, 'human review file sha256');
  const packetHash = await (options.hashFile || sha256File)(packetPath);
  const reviewFileHash = await (options.hashFile || sha256File)(reviewPath);
  if (packetHash !== spec.release_packet.sha256) fail('RELEASE_PACKET_DRIFT', 'release packet bytes changed');
  if (reviewFileHash !== spec.human_review.file_sha256) fail('HUMAN_REVIEW_FILE_DRIFT', 'human review bytes changed');
  const packet = readJson(packetPath, 'RELEASE_PACKET_JSON_INVALID');
  const review = readJson(reviewPath, 'HUMAN_REVIEW_JSON_INVALID');
  if (packet.schema !== PACKET_SCHEMA || packet.artifact_type !== 'production-assembly-release-packet') fail('RELEASE_PACKET_SCHEMA_INVALID', 'release packet schema mismatch');
  if (packet.run_id !== spec.run_id || review.run_id !== spec.run_id) fail('RUN_DRIFT', 'run identity mismatch');
  if (packet.ready !== true || (packet.blockers || []).length !== 0) fail('ASSEMBLY_NOT_ELIGIBLE', 'release packet is not ASSEMBLY_ELIGIBLE');
  if (packet.output_class !== spec.output_class || packet.evidence_class !== spec.evidence_class || packet.gate_authority !== false) fail('PACKET_OUTPUT_AUTHORITY_INVALID', 'release packet claims wrong authority');
  if (review.schema !== boundaryReview.SUCCESSOR_SCHEMA || boundaryReview.successorDigest(review) !== review.binding_digest_sha256 || packet.human_review_binding_sha256 !== review.binding_digest_sha256) fail('HUMAN_REVIEW_DRIFT', 'exact valid V2 human review required');
  if (review.verdict !== 'KEEP_ALL' || review.reviewer?.type !== 'HUMAN') fail('HUMAN_REVIEW_AUTHORITY_INVALID', 'human KEEP_ALL successor required');
  if (!sameStory(packet.story, review.story) || !samePlan(packet.visual_plan, review.visual_plan)) fail('STORY_PLAN_DRIFT', 'packet and human review lineage differ');
  if (!sameStory(packet.story, spec.story) || !samePlan(packet.visual_plan, spec.visual_plan)) fail('SPEC_STORY_PLAN_DRIFT', 'render spec lineage differs');
  const sources = packet.presenter_sources || [];
  if (sources.length === 0 || sources.length !== review.segments?.length) fail('SECTION_COVERAGE_INCOMPLETE', 'every reviewed segment must appear exactly once');
  const declaredOrder = packet.section_story_order || sources.map((source) => source.story_order);
  if (declaredOrder.length !== sources.length || new Set(declaredOrder).size !== declaredOrder.length) fail('STORY_ORDER_INVALID', 'explicit unique Story order required');
  const sorted = sources.slice().sort((a, b) => a.story_order - b.story_order);
  if (canonicalize(sources.map((source) => source.story_order)) !== canonicalize(declaredOrder) || canonicalize(sorted.map((source) => source.story_order)) !== canonicalize(declaredOrder)) fail('STORY_ORDER_INVALID', 'sources must already be in explicit Story order');
  const reviewSegments = new Map(review.segments.map((segment) => [segment.segment_id, segment]));
  const sectionIds = new Set(); const masterPaths = new Map(); const masterInfo = new Map();
  for (const source of sources) {
    const reviewed = reviewSegments.get(source.selected_segment_id);
    if (!reviewed || reviewed.section_id !== source.section_id || reviewed.master_id !== source.master_id || reviewed.master_sha256 !== source.master_media_sha256 || reviewed.in_ms !== source.in_ms || reviewed.out_ms !== source.out_ms || reviewed.duration_ms !== source.duration_ms) fail('SEGMENT_REVIEW_DRIFT', source.section_id);
    if (!BOUNDARY_CLASSES.has(reviewed.boundary_class)) fail('PROVISIONAL_BOUNDARY_FORBIDDEN', source.section_id);
    if (sectionIds.has(source.section_id)) fail('DUPLICATE_SECTION', source.section_id); sectionIds.add(source.section_id);
    if (!Number.isInteger(source.story_order) || !Number.isInteger(source.in_ms) || !Number.isInteger(source.out_ms) || !Number.isInteger(source.duration_ms) || source.in_ms < 0 || source.out_ms <= source.in_ms || source.duration_ms !== source.out_ms - source.in_ms) fail('SEGMENT_INTERVAL_INVALID', source.section_id);
    if (!sameStory(source.story, packet.story) || !samePlan(source.visual_plan, packet.visual_plan)) fail('SEGMENT_LINEAGE_DRIFT', source.section_id);
    if (source.derivative_is_authority !== false || !['PROOF_CAPTURE', 'PRODUCTION_CAPTURE'].includes(source.quality_class) || (spec.performance_role === 'FINAL_HUMAN_PERFORMANCE' && source.quality_class !== 'PRODUCTION_CAPTURE')) fail('HUMAN_SOURCE_SEMANTICS_INVALID', source.section_id);
    if (FORBIDDEN_RE.test(canonicalize(source))) fail('FORBIDDEN_SOURCE_REFERENCE', source.section_id);
    assertSha(source.master_media_sha256, `master ${source.master_id}`);
    const sourcePath = requireInputPath(source.master_media_path, spec.input_roots, `master ${source.master_id}`);
    if (masterPaths.has(source.master_id) && masterPaths.get(source.master_id) !== sourcePath) fail('MASTER_PATH_AMBIGUOUS', source.master_id);
    masterPaths.set(source.master_id, sourcePath);
  }
  if (!Array.isArray(spec.forbidden_media_sha256)) fail('FORBIDDEN_MEDIA_REGISTRY_REQUIRED', 'explicit proxy/Piper hash registry required');
  for (const [masterId, sourcePath] of masterPaths) {
    const source = sources.find((entry) => entry.master_id === masterId);
    const actual = await (options.hashFile || sha256File)(sourcePath);
    if (actual !== source.master_media_sha256) fail('MASTER_SHA_DRIFT', masterId);
    if (spec.forbidden_media_sha256.includes(actual)) fail('FORBIDDEN_MEDIA_BYTES', masterId);
    const media = (options.probeMedia || probeMedia)(sourcePath);
    if (!media.video || !media.audio) fail('MASTER_STREAMS_REQUIRED', masterId);
    for (const item of sources.filter((entry) => entry.master_id === masterId)) if (item.out_ms > media.duration_ms + (spec.source_duration_tolerance_ms || 250)) fail('SEGMENT_OUT_OF_RANGE', item.section_id);
    masterInfo.set(masterId, { path: sourcePath, sha256: actual, media });
  }
  const cropByMaster = new Map();
  for (const crop of spec.crops || []) {
    if (!masterInfo.has(crop.master_id) || cropByMaster.has(crop.master_id)) fail('CROP_POLICY_INVALID', String(crop.master_id));
    const media = masterInfo.get(crop.master_id).media;
    if (!Number.isInteger(crop.x) || !Number.isInteger(crop.y) || !Number.isInteger(crop.width) || !Number.isInteger(crop.height) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > media.video.width || crop.y + crop.height > media.video.height) fail('CROP_OUT_OF_BOUNDS', crop.master_id);
    cropByMaster.set(crop.master_id, crop);
  }
  if (cropByMaster.size !== masterInfo.size) fail('CROP_POLICY_INCOMPLETE', 'one exact crop per master required');
  const replacedInsertIds = new Set((spec.composition?.beats || []).flatMap((beat) => (beat.layers || []).flatMap((layer) => layer.replaces_insert_ids || [])));
  const packetInserts = new Map((packet.insert_policy || []).map((item) => [item.shot_id, item]));
  const inserts = [];
  for (const item of spec.inserts || []) {
    const policy = packetInserts.get(item.shot_id);
    if (!policy || !INSERT_NECESSITY.has(policy.necessity) || policy.necessity !== item.necessity || policy.section_id !== item.section_id || policy.section_order !== item.section_order) fail('INSERT_POLICY_DRIFT', String(item.shot_id));
    if (!['RENDER', 'FALLBACK_A_ROLL', 'OMIT', 'REPLACED_BY_COMPOSITION'].includes(item.decision)) fail('INSERT_DECISION_INVALID', item.shot_id);
    if (item.decision === 'REPLACED_BY_COMPOSITION' && (!spec.composition || !replacedInsertIds.has(item.shot_id))) fail('INSERT_COMPOSITION_REPLACEMENT_INVALID', item.shot_id);
    if (spec.composition && item.decision === 'RENDER') fail('COMPOSITION_LEGACY_INSERT_STACKING_FORBIDDEN', item.shot_id);
    if (policy.necessity === 'ESSENTIAL' && !['RENDER', 'REPLACED_BY_COMPOSITION'].includes(item.decision)) fail('ESSENTIAL_INSERT_REQUIRED', item.shot_id);
    if (policy.necessity === 'USEFUL' && item.decision === 'OMIT') fail('USEFUL_INSERT_FALLBACK_REQUIRED', item.shot_id);
    if (policy.necessity === 'OPTIONAL' && item.decision === 'FALLBACK_A_ROLL') fail('OPTIONAL_INSERT_DECISION_INVALID', item.shot_id);
    if (item.decision === 'RENDER') {
      assertSha(item.asset_sha256, `insert ${item.shot_id}`);
      item.asset_path = requireInputPath(item.asset_path, spec.input_roots, `insert ${item.shot_id}`);
      if (await (options.hashFile || sha256File)(item.asset_path) !== item.asset_sha256) fail('INSERT_ASSET_DRIFT', item.shot_id);
      const section = sources.find((source) => source.story_order === item.section_order && source.section_id === item.section_id);
      if (!section || !Number.isInteger(item.start_offset_ms) || !Number.isInteger(item.end_offset_ms) || item.start_offset_ms < 0 || item.end_offset_ms <= item.start_offset_ms || item.end_offset_ms > section.duration_ms) fail('INSERT_INTERVAL_INVALID', item.shot_id);
    }
    inserts.push(item);
  }
  for (const policy of packetInserts.values()) if (policy.necessity === 'ESSENTIAL' && !inserts.some((item) => item.shot_id === policy.shot_id)) fail('ESSENTIAL_INSERT_REQUIRED', policy.shot_id);
  if (!MUSIC_POLICIES.has(spec.music?.policy)) fail('MUSIC_POLICY_REQUIRED', 'explicit FADE_EARLY, LOOP_WITH_CROSSFADE, FULL_PROGRAMME, or NONE required');
  const musicDecision = activeMusicDecision(spec.music);
  let music = null;
  const packetMusic = packet.music_policy || null;
  if (spec.music.policy === 'NONE' && packetMusic?.sha256) fail('MUSIC_PACKET_DRIFT', 'release packet requires a bound music source');
  if (spec.music.policy === 'FADE_EARLY' && packetMusic && packetMusic.option !== 'B' && packetMusic.decision !== 'FADE_EARLY' && packetMusic.decision !== 'END_NATURALLY_OR_FADE_BEFORE_PROGRAMME_END') fail('MUSIC_PACKET_DRIFT', 'release packet does not authorize FADE_EARLY');
  if (spec.music.policy === 'LOOP_WITH_CROSSFADE' && packetMusic && packetMusic.option !== 'A' && packetMusic.decision !== 'LOOP_WITH_CROSSFADE') fail('MUSIC_PACKET_DRIFT', 'release packet does not authorize looping');
  if (spec.music.policy === 'FULL_PROGRAMME' && packetMusic && packetMusic.decision !== 'FULL_PROGRAMME' && packetMusic.option !== 'FULL_PROGRAMME') fail('MUSIC_PACKET_DRIFT', 'release packet does not authorize full-programme music');
  if (spec.music.policy !== 'NONE') {
    assertSha(spec.music.sha256, 'music');
    const musicPath = requireInputPath(spec.music.path, spec.input_roots, 'music');
    if (await (options.hashFile || sha256File)(musicPath) !== spec.music.sha256) fail('MUSIC_SHA_DRIFT', 'music bytes changed');
    if (packet.music_policy?.sha256 !== spec.music.sha256) fail('MUSIC_PACKET_DRIFT', 'music identity differs from release packet');
    const media = (options.probeMedia || probeMedia)(musicPath);
    if (!media.audio) fail('MUSIC_AUDIO_REQUIRED', 'music has no audio stream');
    music = { ...spec.music, active_decision: musicDecision, path: musicPath, media, media_duration_ms: media.duration_ms };
    if (music.policy === 'FADE_EARLY' && (!Number.isInteger(music.fade_start_ms) || !Number.isInteger(music.fade_duration_ms) || music.fade_start_ms < 0 || music.fade_duration_ms <= 0 || music.fade_start_ms + music.fade_duration_ms > media.duration_ms + 50)) fail('MUSIC_FADE_POLICY_INVALID', 'exact bounded fade required');
    if (music.policy === 'LOOP_WITH_CROSSFADE' && (!Number.isInteger(music.crossfade_ms) || music.crossfade_ms <= 0 || music.crossfade_ms >= media.duration_ms)) fail('MUSIC_LOOP_POLICY_INVALID', 'exact crossfade required');
  }
  const output = requireOutputPath(spec.output_root, spec.output.relative_path);
  if (spec.output.width !== 1080 || spec.output.height !== 1920 || spec.output.fps !== 30 || spec.output.video_codec !== 'libx264' || spec.output.audio_codec !== 'aac' || spec.output.audio_sample_rate !== 48000 || spec.output.audio_channels !== 2) fail('OUTPUT_FORMAT_INVALID', 'canonical 1080x1920 CFR30 H.264/AAC stereo required');
  const partial = { packetPath, reviewPath, packetHash, reviewFileHash, packet, review, sources, masterInfo, cropByMaster, inserts, music, musicDecision, output };
  const timeline = buildTimeline(partial);
  let composition = null;
  if (spec.composition) {
    const designPath = requireInputPath(spec.composition.design_package?.path, spec.input_roots, 'V2 design package');
    const visualPlanPath = requireInputPath(spec.composition.approved_visual_plan?.path, spec.input_roots, 'approved visual plan');
    const assetManifestPath = requireInputPath(spec.composition.asset_manifest?.path, spec.input_roots, 'composition asset manifest');
    const hashFile = options.hashFile || sha256File;
    if (await hashFile(designPath) !== spec.composition.design_package.sha256) fail('COMPOSITION_DESIGN_PACKAGE_DRIFT', designPath);
    if (await hashFile(visualPlanPath) !== spec.composition.approved_visual_plan.file_sha256) fail('COMPOSITION_VISUAL_PLAN_DRIFT', visualPlanPath);
    if (await hashFile(assetManifestPath) !== spec.composition.asset_manifest.sha256) fail('COMPOSITION_ASSET_MANIFEST_DRIFT', assetManifestPath);
    const designPackage = readJson(designPath, 'COMPOSITION_DESIGN_PACKAGE_INVALID');
    if (designPackage.schema !== spec.composition.design_package.schema) fail('COMPOSITION_DESIGN_PACKAGE_DRIFT', 'design package schema mismatch');
    const approved = readJson(visualPlanPath, 'COMPOSITION_VISUAL_PLAN_INVALID');
    if (approved.plan_id !== spec.composition.approved_visual_plan.plan_id || (spec.composition.approved_visual_plan.digest_sha256 && approved.digest_sha256 !== spec.composition.approved_visual_plan.digest_sha256)) fail('COMPOSITION_VISUAL_PLAN_DRIFT', 'approved visual-plan identity mismatch');
    const assetManifest = readJson(assetManifestPath, 'COMPOSITION_ASSET_MANIFEST_INVALID');
    for (const asset of assetManifest.assets || []) if (asset.status === 'ACCEPTED') {
      asset.path = requireInputPath(asset.path, spec.input_roots, `composition asset ${asset.asset_id}`);
      if (await hashFile(asset.path) !== asset.sha256) fail('COMPOSITION_ASSET_DRIFT', asset.asset_id);
      const media = (options.probeMedia || probeMedia)(asset.path);
      const stream = asset.media_kind === 'IMAGE' ? media.video : media.video;
      if (!stream || stream.width !== asset.width || stream.height !== asset.height) fail('COMPOSITION_ASSET_METADATA_DRIFT', asset.asset_id);
      if (asset.media_kind === 'VIDEO' && Number.isInteger(asset.duration_ms) && Math.abs(media.duration_ms - asset.duration_ms) > 100) fail('COMPOSITION_ASSET_METADATA_DRIFT', asset.asset_id);
    }
    composition = compositionEngine.validateComposition(spec.composition, timeline, spec.output, assetManifest);
  }
  const programmeDuration = timeline.at(-1)?.programme_out_ms || 0;
  if (music?.policy === 'FULL_PROGRAMME' && music.media_duration_ms + 50 < programmeDuration) fail('MUSIC_FULL_PROGRAMME_TOO_SHORT', `${music.media_duration_ms} < ${programmeDuration}`);
  return { ...partial, timeline, composition };
}

function buildTimeline(validated) {
  let cursor = 0;
  return validated.sources.map((source) => {
    const crop = validated.cropByMaster.get(source.master_id);
    const entry = {
      story_order: source.story_order, section_id: source.section_id, selected_segment_id: source.selected_segment_id,
      master_id: source.master_id, master_path: validated.masterInfo.get(source.master_id).path,
      master_sha256: source.master_media_sha256, in_ms: source.in_ms, out_ms: source.out_ms,
      duration_ms: source.duration_ms, programme_in_ms: cursor, programme_out_ms: cursor + source.duration_ms,
      crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
      boundary_class: validated.review.segments.find((segment) => segment.segment_id === source.selected_segment_id).boundary_class,
      quality_class: source.quality_class, source_capture_cadence: validated.masterInfo.get(source.master_id).media.video.avg_frame_rate,
      derivative_is_authority: false,
    };
    cursor += source.duration_ms;
    return entry;
  });
}

function buildPlan(spec, validated) {
  const timeline = validated.timeline || buildTimeline(validated);
  const cursor = timeline.at(-1)?.programme_out_ms || 0;
  const inserts = validated.inserts.map((item) => {
    const section = timeline.find((entry) => entry.story_order === item.section_order);
    return { ...item, programme_in_ms: item.decision === 'RENDER' ? section.programme_in_ms + item.start_offset_ms : null, programme_out_ms: item.decision === 'RENDER' ? section.programme_in_ms + item.end_offset_ms : null };
  });
  const semantic = {
    schema: PLAN_SCHEMA, run_id: spec.run_id, performance_role: spec.performance_role,
    output_class: spec.output_class, evidence_class: spec.evidence_class, gate_authority: false,
    release_packet: { path: validated.packetPath, sha256: validated.packetHash },
    human_review: { path: validated.reviewPath, file_sha256: validated.reviewFileHash, binding_digest_sha256: validated.review.binding_digest_sha256 },
    story: validated.packet.story, visual_plan: validated.packet.visual_plan,
    timeline, inserts, composition: validated.composition, music: validated.music ? { ...validated.music, media: undefined } : { ...spec.music, active_decision: validated.musicDecision },
    output: spec.output, programme_duration_ms: cursor,
    toolchain: { node: process.version, ffmpeg: ffmpegVersion(), ffprobe: ffprobeVersion(), renderer: SPEC_SCHEMA },
  };
  const planDigest = digest(semantic);
  const plan = { ...semantic, plan_digest_sha256: planDigest };
  return { ...plan, ffmpeg_invocation: buildFfmpegCommand(plan, `<STAGING>`) };
}

function buildFfmpegCommand(plan, stagedOutput) {
  const command = ['-nostdin', '-hide_banner', '-y'];
  for (const segment of plan.timeline) command.push('-ss', (segment.in_ms / 1000).toFixed(6), '-t', (segment.duration_ms / 1000).toFixed(6), '-i', segment.master_path);
  let musicIndex = null;
  if (plan.music.policy !== 'NONE') { musicIndex = plan.timeline.length; command.push('-i', plan.music.path); }
  const renderedInserts = plan.inserts.filter((item) => item.decision === 'RENDER');
  const filters = [];
  for (let index = 0; index < plan.timeline.length; index += 1) {
    const segment = plan.timeline[index]; const duration = (segment.duration_ms / 1000).toFixed(6); const crop = segment.crop;
    filters.push(`[${index}:a]asetpts=PTS-STARTPTS,aresample=${plan.output.audio_sample_rate},apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`);
  }
  filters.push(`${plan.timeline.map((_, index) => `[a${index}]`).join('')}concat=n=${plan.timeline.length}:v=0:a=1[dial]`);
  if (plan.composition) compositionEngine.buildVideoGraph(plan, command, filters);
  else {
    const imageBase = plan.timeline.length + (musicIndex === null ? 0 : 1);
    for (const insert of renderedInserts) command.push('-loop', '1', '-framerate', String(plan.output.fps), '-t', ((insert.programme_out_ms - insert.programme_in_ms) / 1000 + 0.5).toFixed(6), '-i', insert.asset_path);
    for (let index = 0; index < plan.timeline.length; index += 1) {
      const segment = plan.timeline[index]; const duration = (segment.duration_ms / 1000).toFixed(6); const crop = segment.crop;
      filters.push(`[${index}:v]setpts=PTS-STARTPTS,fps=${plan.output.fps},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${plan.output.width}:${plan.output.height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=2,trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`);
    }
    filters.push(`${plan.timeline.map((_, index) => `[v${index}]`).join('')}concat=n=${plan.timeline.length}:v=1:a=0[vcat]`);
    let video = 'vcat';
    renderedInserts.forEach((insert, index) => {
      const firstFrame = Math.ceil(insert.programme_in_ms / 1000 * plan.output.fps); const endFrame = Math.ceil(insert.programme_out_ms / 1000 * plan.output.fps);
      const start = firstFrame / plan.output.fps; const low = start - 0.5 / plan.output.fps; const high = (endFrame - 1) / plan.output.fps + 0.5 / plan.output.fps;
      filters.push(`[${imageBase + index}:v]format=rgba,fps=${plan.output.fps},setpts=PTS+${start.toFixed(6)}/TB[g${index}]`);
      filters.push(`[${video}][g${index}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${low.toFixed(6)},${high.toFixed(6)})'[ov${index}]`); video = `ov${index}`;
    });
    filters.push(`[${video}]format=yuv420p[vout]`);
  }
  const total = (plan.programme_duration_ms / 1000).toFixed(6);
  if (plan.music.policy === 'NONE') filters.push(`[dial]apad=whole_dur=${total},atrim=duration=${total},alimiter=limit=0.85:level=disabled[aout]`);
  if (plan.music.policy === 'FADE_EARLY') {
    const fadeStart = (plan.music.fade_start_ms / 1000).toFixed(6); const fadeDuration = (plan.music.fade_duration_ms / 1000).toFixed(6);
    filters.push(`[${musicIndex}:a]aresample=${plan.output.audio_sample_rate},afade=t=out:st=${fadeStart}:d=${fadeDuration},volume=${Number(plan.music.gain_db || -14).toFixed(2)}dB,apad=whole_dur=${total},atrim=duration=${total},asetpts=PTS-STARTPTS[music]`);
    filters.push(`[dial][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.85:level=disabled,atrim=duration=${total},asetpts=PTS-STARTPTS[aout]`);
  }
  if (plan.music.policy === 'LOOP_WITH_CROSSFADE') {
    const duration = plan.music.media_duration_ms || 1; const crossfade = plan.music.crossfade_ms; const count = Math.max(2, Math.ceil((plan.programme_duration_ms - crossfade) / (duration - crossfade)));
    filters.push(`[${musicIndex}:a]asplit=${count}${Array.from({ length: count }, (_, index) => `[m${index}]`).join('')}`);
    for (let index = 0; index < count; index += 1) filters.push(`[m${index}]atrim=duration=${(duration / 1000).toFixed(6)},asetpts=PTS-STARTPTS[mt${index}]`);
    let current = 'mt0';
    for (let index = 1; index < count; index += 1) { filters.push(`[${current}][mt${index}]acrossfade=d=${(crossfade / 1000).toFixed(6)}:c1=tri:c2=tri[mx${index}]`); current = `mx${index}`; }
    filters.push(`[${current}]volume=${Number(plan.music.gain_db || -14).toFixed(2)}dB,atrim=duration=${total},apad=whole_dur=${total}[music]`);
    filters.push(`[dial][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.85:level=disabled,atrim=duration=${total},asetpts=PTS-STARTPTS[aout]`);
  }
  if (plan.music.policy === 'FULL_PROGRAMME') {
    filters.push(`[${musicIndex}:a]aresample=${plan.output.audio_sample_rate},volume=${Number(plan.music.gain_db || -18).toFixed(2)}dB,apad=whole_dur=${total},atrim=duration=${total},asetpts=PTS-STARTPTS[music]`);
    filters.push(`[dial][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.85:level=disabled,atrim=duration=${total},asetpts=PTS-STARTPTS[aout]`);
  }
  command.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', plan.output.video_codec, '-preset', plan.output.preset || 'slow', '-crf', String(plan.output.crf ?? 18), '-pix_fmt', 'yuv420p', '-r', String(plan.output.fps), '-c:a', plan.output.audio_codec, '-b:a', plan.output.audio_bitrate || '192k', '-ar', String(plan.output.audio_sample_rate), '-ac', String(plan.output.audio_channels), '-movflags', '+faststart', stagedOutput);
  return ['ffmpeg', ...command];
}

function qcCandidate(filePath, plan, options = {}) {
  const probe = (options.probeMedia || probeMedia)(filePath);
  if (!probe.video || !probe.audio || probe.video.width !== plan.output.width || probe.video.height !== plan.output.height || probe.video.codec !== 'h264' || probe.audio.codec !== 'aac' || probe.audio.sample_rate !== plan.output.audio_sample_rate || probe.audio.channels !== plan.output.audio_channels) fail('OUTPUT_QC_STREAMS_FAILED', 'output streams do not match contract');
  if (!['30/1', '60/2'].includes(probe.video.avg_frame_rate)) fail('OUTPUT_QC_CADENCE_FAILED', `expected CFR30, got ${probe.video.avg_frame_rate}`);
  if (!Number.isInteger(probe.video.nb_frames) || probe.video.nb_frames <= 0) fail('OUTPUT_QC_FRAME_COUNT_FAILED', 'positive measured output frame count required');
  const tolerance = Math.ceil(1000 / plan.output.fps) + 25;
  if (Math.abs(probe.duration_ms - plan.programme_duration_ms) > tolerance) fail('OUTPUT_QC_DURATION_FAILED', `${probe.duration_ms} vs ${plan.programme_duration_ms}`);
  if (options.decode !== false) execFile('ffmpeg', ['-v', 'error', '-xerror', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { code: 'OUTPUT_QC_DECODE_FAILED' });
  return {
    full_decode: options.decode === false ? 'INJECTED_PASS' : 'PASS', duration_ms: probe.duration_ms,
    expected_duration_ms: plan.programme_duration_ms, duration_tolerance_ms: tolerance, video: probe.video, audio: probe.audio,
    source_coverage: plan.timeline.map((item) => item.section_id), story_order: plan.timeline.map((item) => item.story_order),
    required_inserts: plan.inserts.filter((item) => item.necessity === 'ESSENTIAL').map((item) => ({ shot_id: item.shot_id, decision: item.decision })),
    composition: plan.composition ? {
      beat_count: plan.composition.beats.length,
      coverage_start_ms: plan.composition.beats[0].start_ms,
      coverage_end_ms: plan.composition.beats.at(-1).end_ms,
      primary_owners: plan.composition.beats.map((beat) => ({ beat_id: beat.beat_id, primary_owner: beat.primary_owner })),
      presenter_absent_beats: plan.composition.beats.filter((beat) => !beat.layers.some((layer) => layer.type === 'PRESENTER' && layer.visible !== false)).map((beat) => beat.beat_id),
      operation_digests: plan.composition.beats.map((beat) => ({ beat_id: beat.beat_id, sha256: beat.operation_digest_sha256 })),
      music_branch: plan.music.policy === 'FULL_PROGRAMME' ? { policy: 'FULL_PROGRAMME', source_sha256: plan.music.sha256, start_ms: 0, end_ms: plan.programme_duration_ms } : null,
    } : null,
  };
}

async function renderFromSpec(specPath, options = {}) {
  const spec = readJson(specPath, 'RENDER_SPEC_JSON_INVALID');
  const validated = await validateInputs(spec, options);
  const plan = buildPlan(spec, validated);
  const output = validated.output.target;
  const base = output.replace(/\.mp4$/i, '');
  const workRoot = path.join(path.dirname(output), '_work', plan.plan_digest_sha256.slice(0, 24));
  const paths = {
    output, plan: `${base}.render-plan.json`, state: `${base}.state.json`, manifest: `${base}.manifest.json`,
    evidence: `${base}.evidence.json`, completion: `${base}.complete.json`, lock: `${base}.render.lock.json`,
    staged: path.join(workRoot, 'candidate.partial.mp4'),
  };
  const hashFile = options.hashFile || sha256File;
  if (fs.existsSync(paths.completion)) {
    const completion = readJson(paths.completion, 'COMPLETION_INVALID');
    if (completion.schema !== COMPLETION_SCHEMA || completion.plan_digest_sha256 !== plan.plan_digest_sha256 || !fs.existsSync(output) || await hashFile(output) !== completion.output_sha256) fail('EXISTING_OUTPUT_CONFLICT', 'completion does not match exact plan/output');
    return { status: 'REUSED', plan, paths, completion };
  }
  if (options.failAt === 'before-lock') fail('INJECTED_INTERRUPTION', 'before lock');
  const ownedLock = acquireRenderLock(paths, plan, options);
  try {
    if (options.failAt === 'after-lock') fail('INJECTED_INTERRUPTION', 'after lock');
    if (fs.existsSync(paths.completion)) fail('EXISTING_OUTPUT_CONFLICT', 'candidate completed while acquiring lock');
    if (fs.existsSync(paths.plan)) {
      const frozen = readJson(paths.plan, 'RENDER_PLAN_INVALID');
      if (frozen.plan_digest_sha256 !== plan.plan_digest_sha256 || canonicalize(frozen) !== canonicalize(plan)) fail('RENDER_PLAN_CONFLICT', 'frozen plan differs from requested authority');
    } else writeJsonAtomic(paths.plan, plan);
    writeJsonAtomic(paths.state, { schema: STATE_SCHEMA, state: 'INCOMPLETE', plan_digest_sha256: plan.plan_digest_sha256, phase: 'PLAN_FROZEN' });
    if (options.failAt === 'after-plan' || options.failAt === 'before-render') fail('INJECTED_INTERRUPTION', 'after plan freeze');

    let candidatePath = paths.staged;
    let reusedRenderedBytes = false;
    if (fs.existsSync(output)) {
      if (!fs.existsSync(paths.manifest) || !fs.existsSync(paths.evidence)) fail('EXISTING_OUTPUT_UNATTESTED', 'candidate exists without manifest/evidence; operator inspection required');
      const manifest = readJson(paths.manifest, 'MANIFEST_INVALID');
      const evidence = readJson(paths.evidence, 'EVIDENCE_INVALID');
      const outputSha = await hashFile(output);
      if (manifest.plan_digest_sha256 !== plan.plan_digest_sha256 || manifest.output_sha256 !== outputSha || evidence.plan_digest_sha256 !== plan.plan_digest_sha256 || evidence.output_sha256 !== outputSha) fail('EXISTING_OUTPUT_UNATTESTED', 'candidate bindings do not support completion recovery');
      candidatePath = output; reusedRenderedBytes = true;
    } else if (fs.existsSync(paths.staged)) {
      try { qcCandidate(paths.staged, plan, options); reusedRenderedBytes = true; }
      catch (_) { fs.renameSync(paths.staged, `${paths.staged}.rejected-${Date.now()}`); }
    }
    if (!reusedRenderedBytes) {
      fs.mkdirSync(workRoot, { recursive: true });
      const command = buildFfmpegCommand(plan, paths.staged);
      if (typeof options.render === 'function') await options.render(command, paths.staged, plan);
      else execFile(command[0], command.slice(1), { stdio: options.quiet ? 'ignore' : 'inherit', code: 'RENDER_FAILED' });
      if (options.failAt === 'during-render') fail('INJECTED_INTERRUPTION', 'during render');
    }
    writeJsonAtomic(paths.state, { schema: STATE_SCHEMA, state: 'INCOMPLETE', plan_digest_sha256: plan.plan_digest_sha256, phase: 'RENDERED_PENDING_QC', reused_rendered_bytes: reusedRenderedBytes });
    if (options.failAt === 'after-render') fail('INJECTED_INTERRUPTION', 'after render');
    if (!fs.existsSync(candidatePath)) fail('RENDER_OUTPUT_MISSING', candidatePath);
    const qc = qcCandidate(candidatePath, plan, options);
    if (options.failAt === 'after-qc') fail('INJECTED_INTERRUPTION', 'after qc');
    const outputSha = await hashFile(candidatePath);
    const semanticManifest = {
      schema: MANIFEST_SCHEMA, state: 'QC_PASSED_PENDING_FINALIZATION', run_id: spec.run_id,
      plan_digest_sha256: plan.plan_digest_sha256, output_class: spec.output_class, performance_role: spec.performance_role,
      source_capture_quality_classes: [...new Set(plan.timeline.map((item) => item.quality_class))],
      source_capture_cadence: [...new Map(plan.timeline.map((item) => [item.master_id, { master_id: item.master_id, average_frame_rate: item.source_capture_cadence }])).values()],
      output_cadence: `${spec.output.fps}/1`, output_sha256: outputSha, output_size_bytes: fs.statSync(candidatePath).size,
      programme_duration_ms: plan.programme_duration_ms, story: plan.story, visual_plan: plan.visual_plan,
      human_review_binding_sha256: plan.human_review.binding_digest_sha256, timeline: plan.timeline, inserts: plan.inserts, composition: plan.composition,
      music: plan.music, ffmpeg_invocation: buildFfmpegCommand(plan, '<STAGING>'), toolchain: plan.toolchain, qc,
    };
    const manifest = { ...semanticManifest, semantic_digest_sha256: digest(semanticManifest) };
    const evidenceCore = {
      schema: EVIDENCE_SCHEMA, evidence_class: spec.evidence_class, gate_authority: false,
      producer: spec.producer, attester: { type: 'MACHINE', id: 'production-assembly-renderer' },
      plan_digest_sha256: plan.plan_digest_sha256, manifest_digest_sha256: manifest.semantic_digest_sha256,
      output_sha256: outputSha, performance_role: spec.performance_role, qc, toolchain: plan.toolchain,
      positive_claims: ['exact selected HUMAN intervals consumed in explicit Story order', 'output bytes passed deterministic stream, duration, coverage and full-decode QC', 'output is bound to declared Story, VP2, V2 human review, source hashes, crops, inserts and active human music policy', ...(plan.composition ? ['frozen beat composition, explicit primary ownership, z-order, geometry and exact asset hashes were executed'] : [])],
      negative_claims: ['not final creative approval', 'not final performance approval', 'not final mix approval', 'not Gate 9 authority', 'not Gate 10 authority', 'not publish-ready'],
    };
    const evidence = { ...evidenceCore, evidence_digest_sha256: digest(evidenceCore) };
    if (options.failAt === 'manifest') fail('INJECTED_MANIFEST_FAILURE', 'manifest phase');
    writeJsonAtomic(paths.manifest, manifest);
    if (options.failAt === 'evidence') fail('INJECTED_EVIDENCE_FAILURE', 'evidence phase');
    writeJsonAtomic(paths.evidence, evidence);
    if (candidatePath !== output) fs.renameSync(candidatePath, output);
    if (options.failAt === 'after-finalize') fail('INJECTED_INTERRUPTION', 'after candidate rename, before COMPLETE');
    const completionCore = { schema: COMPLETION_SCHEMA, state: 'COMPLETE', plan_digest_sha256: plan.plan_digest_sha256, output_sha256: outputSha, manifest_digest_sha256: manifest.semantic_digest_sha256, evidence_digest_sha256: evidence.evidence_digest_sha256 };
    if (options.failAt === 'completion') fail('INJECTED_COMPLETION_FAILURE', 'completion phase');
    writeJsonAtomic(paths.completion, { ...completionCore, completion_digest_sha256: digest(completionCore) });
    writeJsonAtomic(paths.state, { schema: STATE_SCHEMA, state: 'COMPLETE', plan_digest_sha256: plan.plan_digest_sha256, output_sha256: outputSha });
    releaseRenderLock(paths.lock, ownedLock);
    return { status: reusedRenderedBytes ? 'RECOVERED_COMPLETE' : 'COMPLETE', plan, paths, manifest, evidence, completion: readJson(paths.completion) };
  } catch (error) {
    try { writeJsonAtomic(paths.state, { schema: STATE_SCHEMA, state: 'INCOMPLETE', plan_digest_sha256: plan.plan_digest_sha256, phase: error.code || 'FAILED' }); } catch (_) { /* preserve the primary failure */ }
    if (!options.keepLockOnError) releaseRenderLock(paths.lock, ownedLock);
    throw error;
  }
}

async function renderPreviewFromSpec(specPath, selector, options = {}) {
  const spec = readJson(specPath, 'RENDER_SPEC_JSON_INVALID');
  if (!spec.composition) fail('PREVIEW_COMPOSITION_REQUIRED', 'preview mode requires the canonical composition plan');
  const validated = await validateInputs(spec, options); const plan = buildPlan(spec, validated);
  let startMs; let endMs; let label;
  if (selector.beat) {
    const beat = plan.composition.beats.find((item) => item.beat_id === selector.beat);
    if (!beat) fail('PREVIEW_BEAT_UNKNOWN', selector.beat); startMs = beat.start_ms; endMs = beat.end_ms; label = beat.beat_id;
  } else {
    const match = /^(\d+):(\d+)$/.exec(selector.rangeMs || '');
    if (!match) fail('PREVIEW_RANGE_INVALID', 'range must be integer start:end milliseconds');
    startMs = Number(match[1]); endMs = Number(match[2]); label = `${startMs}-${endMs}`;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs || endMs > plan.programme_duration_ms) fail('PREVIEW_RANGE_INVALID', selector.rangeMs);
  }
  const preview = requireOutputPath(spec.output_root, selector.output);
  if (preview.target === validated.output.target) fail('PREVIEW_OUTPUT_CONFLICT', 'preview cannot target the Production candidate');
  fs.mkdirSync(path.dirname(preview.target), { recursive: true });
  const command = buildFfmpegCommand(plan, preview.target); command.splice(command.length - 1, 0, '-ss', (startMs / 1000).toFixed(6), '-t', ((endMs - startMs) / 1000).toFixed(6));
  if (typeof options.render === 'function') await options.render(command, preview.target, plan);
  else execFile(command[0], command.slice(1), { stdio: options.quiet ? 'ignore' : 'inherit', code: 'PREVIEW_RENDER_FAILED' });
  if (!fs.existsSync(preview.target)) fail('PREVIEW_OUTPUT_MISSING', preview.target);
  const metadata = { schema: 'vidtoolz.productionAssemblyPreview.v1', authority: 'NON_AUTHORITATIVE_ENGINEERING_PREVIEW', complete_marker_written: false, plan_digest_sha256: plan.plan_digest_sha256, selector: label, start_ms: startMs, end_ms: endMs, output_sha256: await (options.hashFile || sha256File)(preview.target) };
  writeJsonAtomic(`${preview.target}.preview.json`, metadata);
  return { status: 'PREVIEW_COMPLETE_NON_AUTHORITATIVE', output: preview.target, metadata, plan };
}

function parseCli(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--spec') args.spec = argv[++index];
    else if (argv[index] === '--quiet') args.quiet = true;
    else if (argv[index] === '--beat') args.beat = argv[++index];
    else if (argv[index] === '--range-ms') args.rangeMs = argv[++index];
    else if (argv[index] === '--preview-output') args.previewOutput = argv[++index];
    else fail('CLI_ARGUMENT_INVALID', argv[index]);
  }
  if (!args.spec) fail('CLI_SPEC_REQUIRED', '--spec is required');
  if ((args.beat || args.rangeMs) && (!args.previewOutput || (args.beat && args.rangeMs))) fail('CLI_PREVIEW_INVALID', 'preview requires exactly one --beat/--range-ms and --preview-output');
  return args;
}

if (require.main === module) {
  const cli = parseCli(process.argv.slice(2));
  const operation = cli.beat || cli.rangeMs
    ? renderPreviewFromSpec(path.resolve(cli.spec), { beat: cli.beat, rangeMs: cli.rangeMs, output: cli.previewOutput }, { quiet: cli.quiet })
    : renderFromSpec(path.resolve(cli.spec), { quiet: cli.quiet });
  operation
    .then((result) => process.stdout.write(`${JSON.stringify({ status: result.status, output: result.paths?.output || result.output, completion: result.paths?.completion || null })}\n`))
    .catch((error) => { process.stderr.write(`${error.code || 'RENDERER_ERROR'}: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = {
  SPEC_SCHEMA, PACKET_SCHEMA, PLAN_SCHEMA, MANIFEST_SCHEMA, EVIDENCE_SCHEMA, COMPLETION_SCHEMA, LOCK_SCHEMA,
  canonicalize, digest, sha256File, probeMedia, musicDecisionDigest, activeMusicDecision, processStartIdentity,
  lockHolderState, acquireRenderLock, releaseRenderLock, validateInputs, buildTimeline, buildPlan, buildFfmpegCommand, qcCandidate, renderFromSpec, renderPreviewFromSpec,
};
