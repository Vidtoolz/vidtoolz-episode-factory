#!/usr/bin/env node
'use strict';

/*
 * Final Human Performance authority.
 *
 * Presenter Take Manifest V1 remains the reusable provenance primitive for
 * presenter media. This layer is the Final Production adapter: it binds the
 * immutable recording to the current Final Production Lock and Package, then
 * records human-only selection history and projects a derived Resolve view.
 * It never records, transcribes, ranks, or creatively selects a performance.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const lockAuthority = require('./final-production-lock.js');
const packageAuthority = require('./final-production-package.js');
const presenterTakes = require('./presenter-take-manifest.js');
const directed = require('./directed-draft-assembly-handoff.js');

const SCHEMA = 'vidtoolz.finalHumanPerformanceAuthority.v1';
const MANIFEST_SCHEMA = 'vidtoolz.finalPerformanceSelectionManifest.v1';
const PROJECTION_SCHEMA = 'vidtoolz.finalResolvePerformanceProjection.v1';
const AUTHORITY_DIR = 'final-production/performance-authority';
const TAKE_DIR = 'media';
const SHA_RE = /^[a-f0-9]{64}$/;
const HUMAN_NAME = 'Mikko Pakkala';
const EXTENSIONS = new Set(['.mov', '.mp4', '.m4a', '.wav', '.aiff', '.aif']);

class FinalPerformanceError extends Error { constructor(code, message) { super(message); this.name = 'FinalPerformanceError'; this.code = code; } }
function fail(code, message) { throw new FinalPerformanceError(code, message); }
function canonicalize(value) { return lockAuthority.canonicalize(value); }
function digest(value) { return crypto.createHash('sha256').update(canonicalize(value)).digest('hex'); }
function sha256File(file) { return presenterTakes.sha256(fs.readFileSync(file)); }
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function readJson(file, code = 'FINAL_PERFORMANCE_JSON_INVALID') { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(code, `${file}: ${e.message}`); } }
function writeImmutable(file, value, code = 'FINAL_PERFORMANCE_IMMUTABLE_CONFLICT') {
  const body = jsonBytes(value); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) { if (fs.readFileSync(file, 'utf8') !== body) fail(code, file); return false; }
  fs.writeFileSync(file, body, { flag: 'wx' }); return true;
}
function writeAtomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.writeFileSync(tmp, jsonBytes(value), { flag: 'wx' }); fs.renameSync(tmp, file); }
function inside(root, file) { return file === root || file.startsWith(`${root}${path.sep}`); }
function paths(runDir) { const base = path.join(path.resolve(runDir), AUTHORITY_DIR); return { base, manifests: path.join(base, 'manifests'), takes: path.join(base, TAKE_DIR), current: path.join(base, 'CURRENT.json'), projection: path.join(base, 'resolve-performance-projection.json') }; }

function probe(file) {
  const stat = fs.statSync(file); const sha256 = sha256File(file);
  const result = childProcess.spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail('FINAL_PERFORMANCE_MEDIA_UNREADABLE', result.error?.message || result.stderr.trim() || file);
  let info; try { info = JSON.parse(result.stdout); } catch (_) { fail('FINAL_PERFORMANCE_MEDIA_PROBE_INVALID', file); }
  const streams = info.streams || []; const audio = streams.find((s) => s.codec_type === 'audio'); const video = streams.find((s) => s.codec_type === 'video');
  const duration = Number(info.format?.duration || 0);
  if (!(duration > 0)) fail('FINAL_PERFORMANCE_MEDIA_DURATION_INVALID', file);
  if (!audio) fail('FINAL_PERFORMANCE_AUDIO_STREAM_MISSING', file);
  return { sha256, byte_size: stat.size, duration_s: duration, has_audio: true, has_video: Boolean(video), streams: streams.map((s) => ({ codec_type: s.codec_type, codec_name: s.codec_name, sample_rate: s.sample_rate ? Number(s.sample_rate) : null, channels: s.channels ?? null, width: s.width ?? null, height: s.height ?? null, pix_fmt: s.pix_fmt ?? null })), format_name: info.format?.format_name || null };
}

function resolveRun(repo, runId) { return directed.resolveRunDir(path.resolve(repo), runId); }
function requireProduction(runDir, options = {}) {
  const status = lockAuthority.lockStatus(runDir, options);
  if (status.state !== 'FINAL_PRODUCTION_LOCKED') fail(status.state === 'FINAL_PRODUCTION_LOCK_STALE' ? 'FINAL_PERFORMANCE_LOCK_STALE' : 'FINAL_PERFORMANCE_LOCK_REQUIRED', status.lock_stale?.message || status.state);
  const { lock } = lockAuthority.loadFinalProductionLock(runDir); lockAuthority.verifyLockCurrent(runDir, lock, options);
  const pp = packageAuthority.packagePaths(runDir);
  for (const file of [pp.package, pp.performance]) if (!fs.existsSync(file)) fail('FINAL_PERFORMANCE_PACKAGE_MISSING', file);
  const productionPackage = readJson(pp.package); const performance = readJson(pp.performance);
  if (productionPackage.run_id !== lock.run_id || productionPackage.lock_id !== lock.lock_id || productionPackage.lock_digest_sha256 !== lock.lock_digest_sha256 || productionPackage.package_digest_sha256 !== digest(Object.fromEntries(Object.entries(productionPackage).filter(([k]) => k !== 'package_digest_sha256')))) fail('FINAL_PERFORMANCE_PACKAGE_STALE', 'Final Production Package is not current for the lock');
  const performanceSha = sha256File(pp.performance); const component = productionPackage.components?.final_performance_package;
  if (!component || component.sha256 !== performanceSha || performance.schema !== packageAuthority.PERFORMANCE_SCHEMA || performance.run_id !== lock.run_id || performance.lock_id !== lock.lock_id || performance.lock_digest_sha256 !== lock.lock_digest_sha256) fail('FINAL_PERFORMANCE_PACKAGE_STALE', 'Final Performance Package binding changed');
  if (performance.final_human_performance_complete !== false || performance.selected_take !== null || performance.takes.length !== 0) fail('FINAL_PERFORMANCE_PACKAGE_AUTHORITY_ESCALATION', 'the immutable package cannot carry completed Final performance state');
  return { lock, productionPackage, performance, performancePath: pp.performance, performanceSha };
}

function baseManifest(ctx) {
  const sections = ctx.performance.sections.map((s) => ({ section_id: s.section_id, order: s.order, beat_ids: s.covered_by_final_visual_beats || [], locked_lines: s.locked_lines, target_duration_ms: s.target_duration_ms }));
  const core = { schema: MANIFEST_SCHEMA, artifact_type: 'final-performance-selection-manifest', authority_schema: SCHEMA, manifest_revision: 1, supersedes: null, run_id: ctx.lock.run_id, lock: { lock_id: ctx.lock.lock_id, lock_digest_sha256: ctx.lock.lock_digest_sha256 }, production_package: { package_digest_sha256: ctx.productionPackage.package_digest_sha256, performance_package_sha256: ctx.performanceSha }, locked_script: { story_version_id: ctx.performance.locked_script.story_version_id, story_content_hash: ctx.performance.locked_script.story_content_hash, script_sha256: ctx.performance.locked_script.script_sha256 }, story: { project_id: ctx.lock.project_id, version_id: ctx.performance.locked_script.story_version_id, content_hash: ctx.performance.locked_script.story_content_hash }, presenter: { id: HUMAN_NAME, role: 'FINAL_HUMAN_PERFORMANCE' }, required_sections: sections, takes: [], selections: [], selection_history: [], state: 'INCOMPLETE', final_human_performance_complete: false, created_at: new Date().toISOString(), created_by: 'final-performance' };
  return { ...core, manifest_id: `final-performance-manifest-${ctx.lock.run_id}-r1-${digest(core).slice(0, 16)}`, manifest_digest_sha256: digest(core) };
}
function coreManifest(manifest) { const copy = { ...manifest }; delete copy.manifest_digest_sha256; return copy; }
function manifestValid(manifest, ctx, options = {}) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.run_id !== ctx.lock.run_id || manifest.lock.lock_id !== ctx.lock.lock_id || manifest.lock.lock_digest_sha256 !== ctx.lock.lock_digest_sha256 || manifest.production_package.package_digest_sha256 !== ctx.productionPackage.package_digest_sha256 || manifest.production_package.performance_package_sha256 !== ctx.performanceSha) fail('FINAL_PERFORMANCE_MANIFEST_STALE', 'manifest is bound to another lock or package');
  if (manifest.manifest_digest_sha256 !== digest(coreManifest(manifest))) fail('FINAL_PERFORMANCE_MANIFEST_TAMPERED', manifest.manifest_id || 'unknown');
  const ids = new Set(manifest.required_sections.map((s) => s.section_id));
  for (const take of manifest.takes) { if (!take.media?.path || !inside(paths(ctx.runDir).takes, path.resolve(take.media.path))) fail('FINAL_PERFORMANCE_CANONICAL_MEDIA_PATH_INVALID', take.take_id); if (!SHA_RE.test(take.media.sha256) || !fs.existsSync(take.media.path) || sha256File(take.media.path) !== take.media.sha256) fail('FINAL_PERFORMANCE_SELECTED_TAKE_BYTES_CHANGED', take.take_id); if (!['REGISTERED', 'REJECTED'].includes(take.state)) fail('FINAL_PERFORMANCE_TAKE_INVALID', take.take_id); if (!['WHOLE_SCRIPT', 'SECTIONS'].includes(take.coverage.mode)) fail('FINAL_PERFORMANCE_COVERAGE_INVALID', take.take_id); if (take.coverage.mode === 'SECTIONS' && take.coverage.section_ids.some((id) => !ids.has(id))) fail('FINAL_PERFORMANCE_COVERAGE_INVALID', take.take_id); }
  const selectedSections = new Set();
  for (const selection of manifest.selections) { if (!ids.has(selection.section_id)) fail('FINAL_PERFORMANCE_SECTION_UNKNOWN', selection.section_id); if (selectedSections.has(selection.section_id)) fail('FINAL_PERFORMANCE_SECTION_DUPLICATE', selection.section_id); selectedSections.add(selection.section_id); const take = manifest.takes.find((t) => t.take_id === selection.take_id); if (!take) fail('FINAL_PERFORMANCE_SELECTION_UNREGISTERED', selection.take_id); if (take.state !== 'REGISTERED') fail('FINAL_PERFORMANCE_REJECTED_TAKE_SELECTED', selection.take_id); if (!selection.selector || selection.selector.type !== 'HUMAN' || !selection.selector.id || /^(machine|auto|agent|model|tool)/i.test(selection.selector.id)) fail('FINAL_PERFORMANCE_MACHINE_SELECTOR_REFUSED', String(selection.selector?.id)); if (selection.media_sha256 !== take.media.sha256) fail('FINAL_PERFORMANCE_SELECTION_TAMPERED', selection.section_id); }
  const covered = new Set(manifest.selections.map((s) => s.section_id)); const expectedState = covered.size === ids.size ? 'COMPLETE' : 'INCOMPLETE';
  if (manifest.state !== expectedState || manifest.final_human_performance_complete !== (expectedState === 'COMPLETE')) fail('FINAL_PERFORMANCE_MANIFEST_TAMPERED', manifest.manifest_id || 'state');
  return manifest;
}
function currentManifest(ctx, options = {}) { const p = paths(ctx.runDir); if (!fs.existsSync(p.current)) { const m = baseManifest(ctx); if (options.create !== false) { writeImmutable(path.join(p.manifests, `${m.manifest_id}.json`), m); writeAtomic(p.current, { manifest_id: m.manifest_id, manifest_digest_sha256: m.manifest_digest_sha256 }); } return m; } const ref = readJson(p.current); const file = path.join(p.manifests, `${ref.manifest_id}.json`); if (!fs.existsSync(file)) fail('FINAL_PERFORMANCE_MANIFEST_MISSING', file); return manifestValid(readJson(file), ctx); }
function successor(previous, mutate) { const next = JSON.parse(JSON.stringify(previous)); next.manifest_revision += 1; next.supersedes = { manifest_id: previous.manifest_id, manifest_digest_sha256: previous.manifest_digest_sha256 }; next.created_at = new Date().toISOString(); mutate(next); const required = new Set(next.required_sections.map((s) => s.section_id)); const covered = new Set(next.selections.map((s) => s.section_id)); next.state = covered.size === required.size ? 'COMPLETE' : 'INCOMPLETE'; next.final_human_performance_complete = next.state === 'COMPLETE'; delete next.manifest_digest_sha256; next.manifest_id = `final-performance-manifest-${next.run_id}-r${next.manifest_revision}-${digest(next).slice(0, 16)}`; next.manifest_digest_sha256 = digest(coreManifest(next)); return next; }
function saveManifest(ctx, manifest) { const p = paths(ctx.runDir); writeImmutable(path.join(p.manifests, `${manifest.manifest_id}.json`), manifest); writeAtomic(p.current, { manifest_id: manifest.manifest_id, manifest_digest_sha256: manifest.manifest_digest_sha256 }); return manifest; }

function status(runDirInput, options = {}) { const runDir = path.resolve(runDirInput); try { const ctx = { runDir, ...requireProduction(runDir, options) }; const m = currentManifest(ctx, { create: false }); const covered = new Set(m.selections.map((s) => s.section_id)); return { run_id: ctx.lock.run_id, lock_id: ctx.lock.lock_id, locked_script: ctx.performance.locked_script, required_sections: m.required_sections.length, takes: m.takes.length, selected_takes: new Set(m.selections.map((s) => s.take_id)).size, coverage: m.required_sections.map((s) => ({ section_id: s.section_id, status: covered.has(s.section_id) ? 'COVERED_BY_SELECTED_TAKE' : 'UNCOVERED', take_id: m.selections.find((x) => x.section_id === s.section_id)?.take_id || null })), performance_required: true, final_human_performance_complete: m.final_human_performance_complete === true, next_action: m.final_human_performance_complete ? 'Final human performance complete; proceed with derived Resolve projection' : m.takes.length ? 'Mikko selects a registered final performance take' : 'Mikko records final performance', state: m.state, manifest_id: fs.existsSync(paths(runDir).current) ? m.manifest_id : null }; } catch (e) { return { run_id: path.basename(runDir), performance_required: true, final_human_performance_complete: false, state: e.code, error: e.message }; } }

function ingest(runDirInput, fileInput, options = {}) { const runDir = path.resolve(runDirInput); const ctx = { runDir, ...requireProduction(runDir, options) }; const file = path.resolve(fileInput); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('FINAL_PERFORMANCE_MEDIA_MISSING', file); if (!EXTENSIONS.has(path.extname(file).toLowerCase())) fail('FINAL_PERFORMANCE_FORMAT_UNSUPPORTED', path.extname(file)); const mediaInfo = probe(file); const p = paths(runDir); fs.mkdirSync(p.takes, { recursive: true }); const target = path.join(p.takes, `${mediaInfo.sha256}${path.extname(file).toLowerCase()}`); if (fs.existsSync(target) && sha256File(target) !== mediaInfo.sha256) fail('FINAL_PERFORMANCE_CANONICAL_MEDIA_CONFLICT', target); if (!fs.existsSync(target)) fs.copyFileSync(file, target); const m = currentManifest(ctx); const existing = m.takes.find((take) => take.media.sha256 === mediaInfo.sha256); if (existing) return { state: 'ALREADY_REGISTERED', take: existing, manifest: m }; const take = { take_id: `final-take-${mediaInfo.sha256.slice(0, 20)}`, source: { path: file, sha256: mediaInfo.sha256, ingested_at: new Date().toISOString() }, media: { path: target, sha256: mediaInfo.sha256, byte_size: mediaInfo.byte_size, duration_s: mediaInfo.duration_s, has_audio: mediaInfo.has_audio, has_video: mediaInfo.has_video, streams: mediaInfo.streams, format_name: mediaInfo.format_name }, coverage: { mode: options.coverageMode || 'WHOLE_SCRIPT', section_ids: options.sectionIds || m.required_sections.map((s) => s.section_id), declaration: 'coverage is an explicit recording declaration; duration alone never infers section coverage' }, state: 'REGISTERED', technical_status: 'VALID', registered_at: new Date().toISOString() }; if (!['WHOLE_SCRIPT', 'SECTIONS'].includes(take.coverage.mode)) fail('FINAL_PERFORMANCE_COVERAGE_INVALID', take.coverage.mode); const next = successor(m, (n) => n.takes.push(take)); saveManifest(ctx, next); return { state: 'REGISTERED', take, manifest: next }; }
function select(runDirInput, takeId, options = {}) { const runDir = path.resolve(runDirInput); const ctx = { runDir, ...requireProduction(runDir, options) }; const m = currentManifest(ctx); const take = m.takes.find((t) => t.take_id === takeId || t.media.sha256.startsWith(takeId)); if (!take) fail('FINAL_PERFORMANCE_TAKE_UNREGISTERED', takeId); if (take.state !== 'REGISTERED') fail('FINAL_PERFORMANCE_REJECTED_TAKE_SELECTED', take.take_id); const authority = options.authority; if (!authority) fail('FINAL_PERFORMANCE_HUMAN_AUTHORITY_REQUIRED', 'selection requires named human authority'); if (/^(machine|auto|agent|model|tool)/i.test(authority) || authority !== HUMAN_NAME) fail('FINAL_PERFORMANCE_MACHINE_SELECTOR_REFUSED', authority); const sectionIds = options.sectionIds?.length ? options.sectionIds : m.required_sections.map((s) => s.section_id); if (take.coverage.mode === 'SECTIONS' && sectionIds.some((id) => !take.coverage.section_ids.includes(id))) fail('FINAL_PERFORMANCE_COVERAGE_NOT_DECLARED', take.take_id); const requested = sectionIds.map((section_id) => ({ section_id, take_id: take.take_id, media_sha256: take.media.sha256, selector: { type: 'HUMAN', id: authority }, selected_at: new Date().toISOString(), rationale: options.rationale || null })); const same = requested.every((x) => m.selections.some((y) => y.section_id === x.section_id && y.take_id === x.take_id && y.selector.id === x.selector.id)); if (same) return { state: 'ALREADY_SELECTED', manifest: m }; const next = successor(m, (n) => { n.selection_history.push(...n.selections.map((s) => ({ ...s, historical: true, superseded_by_revision: n.manifest_revision }))); n.selections = [...n.selections.filter((s) => !sectionIds.includes(s.section_id)), ...requested]; }); const saved = saveManifest(ctx, manifestValid(next, ctx)); writeProjection(ctx, saved); return { state: 'SELECTED', manifest: saved, complete: saved.final_human_performance_complete }; }
function reject(runDirInput, takeId, options = {}) { const ctx = { runDir: path.resolve(runDirInput), ...requireProduction(path.resolve(runDirInput), options) }; const m = currentManifest(ctx); if (!options.authority || options.authority !== HUMAN_NAME) fail('FINAL_PERFORMANCE_HUMAN_AUTHORITY_REQUIRED', 'reject requires Mikko authority'); const take = m.takes.find((t) => t.take_id === takeId || t.media.sha256.startsWith(takeId)); if (!take) fail('FINAL_PERFORMANCE_TAKE_UNREGISTERED', takeId); const next = successor(m, (n) => { const item = n.takes.find((t) => t.take_id === take.take_id); item.state = 'REJECTED'; item.rejected_by = HUMAN_NAME; item.rejected_at = new Date().toISOString(); n.selections = n.selections.filter((selection) => selection.take_id !== take.take_id); }); return { state: 'REJECTED', manifest: saveManifest(ctx, next) }; }
function writeProjection(ctx, manifest) {
  const p = paths(ctx.runDir);
  const selected = Object.fromEntries(manifest.required_sections.map((section) => {
    const selection = manifest.selections.find((item) => item.section_id === section.section_id);
    const take = selection && manifest.takes.find((item) => item.take_id === selection.take_id);
    const value = selection && take
      ? { placeholder: `PERFORMANCE_${section.section_id}`, take_id: take.take_id, source_path: take.media.path, sha256: take.media.sha256, duration_s: take.media.duration_s, selector: selection.selector }
      : { placeholder: `PERFORMANCE_${section.section_id}`, unresolved: true };
    return [section.section_id, value];
  }));
  const core = {
    schema: PROJECTION_SCHEMA, artifact_type: 'final-resolve-performance-projection',
    run_id: ctx.lock.run_id, lock_id: ctx.lock.lock_id, lock_digest_sha256: ctx.lock.lock_digest_sha256,
    performance_manifest_id: manifest.manifest_id, performance_manifest_digest_sha256: manifest.manifest_digest_sha256,
    selected_sections: selected, final_human_performance_complete: manifest.final_human_performance_complete,
    canonical_resolve_blueprint_mutated: false, final_edit_created: false, publication_authority: false,
    derived_at: manifest.created_at,
  };
  const value = { ...core, projection_digest_sha256: digest(core) };
  writeImmutable(path.join(p.base, `resolve-performance-projection-${manifest.manifest_id}.json`), value);
  writeAtomic(p.projection, value);
  return value;
}
function projection(runDirInput, options = {}) { const ctx = { runDir: path.resolve(runDirInput), ...requireProduction(path.resolve(runDirInput), options) }; const m = currentManifest(ctx); return writeProjection(ctx, m); }
function nextAction(runDirInput, options = {}) { const s = status(runDirInput, options); if (s.state !== 'COMPLETE') return { task: s.takes === 0 ? 'RECORD_FINAL_PERFORMANCE' : 'SELECT_PERFORMANCE_TAKE', state: s.takes === 0 ? 'WAITING_FOR_MIKKO' : 'READY', next_action: s.next_action, missing_sections: (s.coverage || []).filter((x) => x.status !== 'COVERED_BY_SELECTED_TAKE').map((x) => x.section_id) }; return { task: 'FINAL_HUMAN_PERFORMANCE_COMPLETE', state: 'COMPLETE', next_action: 'Performance authority complete; projection is ready for Resolve' }; }

function parseArgs(argv) { const out = { command: argv[0], repo: path.resolve(__dirname, '..') }; for (let i = 1; i < argv.length; i += 1) { const a = argv[i]; if (a === '--run-id') out.runId = argv[++i]; else if (a === '--file') out.file = argv[++i]; else if (a === '--take') out.take = argv[++i]; else if (a === '--authority') out.authority = argv[++i]; else if (a === '--section') (out.sections ||= []).push(argv[++i]); else if (a === '--coverage-mode') out.coverageMode = argv[++i]; else if (a === '--repo') out.repo = path.resolve(argv[++i]); else fail('FINAL_PERFORMANCE_ARGUMENT_INVALID', a); } if (!['status', 'ingest', 'list', 'select', 'section-select', 'reject', 'projection', 'next'].includes(out.command) || !out.runId) fail('FINAL_PERFORMANCE_ARGUMENT_INVALID', 'command and --run-id are required'); return out; }
function main(argv = process.argv.slice(2)) { try { const a = parseArgs(argv); const run = resolveRun(a.repo, a.runId); let result; if (a.command === 'status') result = status(run); else if (a.command === 'list') result = status(run); else if (a.command === 'ingest') result = ingest(run, a.file, { coverageMode: a.coverageMode, sectionIds: a.sections }); else if (a.command === 'select') result = select(run, a.take, { authority: a.authority }); else if (a.command === 'section-select') result = select(run, a.take, { authority: a.authority, sectionIds: a.sections }); else if (a.command === 'reject') result = reject(run, a.take, { authority: a.authority }); else if (a.command === 'projection') result = projection(run); else result = nextAction(run); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return 0; } catch (e) { process.stderr.write(`${e.code || 'FINAL_PERFORMANCE_FAILED'}: ${e.message}\n`); return 1; } }

module.exports = { SCHEMA, MANIFEST_SCHEMA, PROJECTION_SCHEMA, AUTHORITY_DIR, HUMAN_NAME, FinalPerformanceError, canonicalize, digest, paths, probe, requireProduction, manifestValid, status, ingest, select, reject, projection, nextAction, parseArgs, main };
if (require.main === module) process.exitCode = main();
