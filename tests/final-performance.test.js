'use strict';

const { assert, fs, os, path, childProcess, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const fixtures = require('./final-production-lock-package.test.js');
const authority = require('../scripts/final-performance.js');

function wav(dir, name, seconds = 1) {
  const file = path.join(dir, name);
  const frequency = 440 + [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const made = childProcess.spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, '-c:a', 'pcm_s16le', '-y', file], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr); return file;
}
function failCode(fn, code) { assert.throws(fn, (e) => e.code === code, `expected ${code}`); }

test('FHP01 status is a non-mutating real-run canary with lock-bound empty authority', () => {
  const run = '/home/vidtoolz/vidtoolz-episode-factory/package-runs/2026-08-31-claude-real-20-bespoke-still-draft-successor';
  if (!fs.existsSync(path.join(run, 'final-production/final-performance-package.json'))) return;
  const before = new Map(); const root = path.join(run, 'final-production');
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const walk = (dir) => { for (const name of fs.readdirSync(dir)) { const f = path.join(dir, name); if (fs.statSync(f).isDirectory()) walk(f); else before.set(path.relative(run, f), hash(f)); } };
  walk(root); const out = authority.status(run); assert.equal(out.required_sections, 11); assert.equal(out.takes, 0); assert.equal(out.selected_takes, 0); assert.equal(out.final_human_performance_complete, false); assert.equal(out.next_action, 'Mikko records final performance');
  const after = new Map(); const walkAfter = (dir) => { for (const name of fs.readdirSync(dir)) { const f = path.join(dir, name); if (fs.statSync(f).isDirectory()) walkAfter(f); else after.set(path.relative(run, f), hash(f)); } }; walkAfter(root); assert.deepEqual([...after], [...before]);
});

test('FHP02 full take certification is explicit, complete, and projects every section', async () => {
  const estate = await fixtures.packagedEstate('fhp-full'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhp-full-media-')); const file = wav(temp, 'take-a.wav', 1.1);
  const ingested = authority.ingest(estate.runDir, file, { scriptBuilderRoot: estate.story.root }); assert.equal(ingested.state, 'REGISTERED');
  assert.equal(authority.ingest(estate.runDir, file, { scriptBuilderRoot: estate.story.root }).state, 'ALREADY_REGISTERED');
  const selected = authority.select(estate.runDir, ingested.take.take_id, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }); assert.equal(selected.complete, true);
  const projection = authority.projection(estate.runDir, { scriptBuilderRoot: estate.story.root }); assert.equal(Object.keys(projection.selected_sections).length, selected.manifest.required_sections.length); assert.ok(Object.values(projection.selected_sections).every((x) => x.take_id === ingested.take.take_id));
});

test('FHP03 composite section selection preserves immutable takes and covers only selected sections', async () => {
  const estate = await fixtures.packagedEstate('fhp-composite'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhp-composite-media-')); const a = authority.ingest(estate.runDir, wav(temp, 'a.wav'), { scriptBuilderRoot: estate.story.root }); const b = authority.ingest(estate.runDir, wav(temp, 'b.wav'), { scriptBuilderRoot: estate.story.root }); const c = authority.ingest(estate.runDir, wav(temp, 'c.wav'), { scriptBuilderRoot: estate.story.root });
  const ids = a.manifest.required_sections.map((s) => s.section_id); authority.select(estate.runDir, a.take.take_id, { authority: 'Mikko Pakkala', sectionIds: ids, scriptBuilderRoot: estate.story.root }); authority.select(estate.runDir, b.take.take_id, { authority: 'Mikko Pakkala', sectionIds: [ids[2]], scriptBuilderRoot: estate.story.root }); authority.select(estate.runDir, c.take.take_id, { authority: 'Mikko Pakkala', sectionIds: [ids[3]], scriptBuilderRoot: estate.story.root });
  const out = authority.status(estate.runDir, { scriptBuilderRoot: estate.story.root }); assert.equal(out.takes, 3); assert.equal(out.final_human_performance_complete, true); assert.equal(out.coverage.find((x) => x.section_id === ids[2]).take_id, b.take.take_id); assert.equal(out.coverage.find((x) => x.section_id === ids[3]).take_id, c.take.take_id);
});

test('FHP04 incomplete coverage cannot complete and next action names missing coverage', async () => {
  const estate = await fixtures.packagedEstate('fhp-incomplete'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhp-incomplete-media-')); const a = authority.ingest(estate.runDir, wav(temp, 'a.wav'), { scriptBuilderRoot: estate.story.root, coverageMode: 'SECTIONS', sectionIds: [estate.built.performance.sections[0].section_id] }); authority.select(estate.runDir, a.take.take_id, { authority: 'Mikko Pakkala', sectionIds: [estate.built.performance.sections[0].section_id], scriptBuilderRoot: estate.story.root }); const out = authority.nextAction(estate.runDir, { scriptBuilderRoot: estate.story.root }); assert.equal(out.state, 'READY'); assert.equal(out.task, 'SELECT_PERFORMANCE_TAKE'); assert.ok(out.missing_sections.length > 0);
});

test('FHP05 reselection creates successor history and rejected takes remain stored but unusable', async () => {
  const estate = await fixtures.packagedEstate('fhp-history'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhp-history-media-')); const a = authority.ingest(estate.runDir, wav(temp, 'a.wav')); const b = authority.ingest(estate.runDir, wav(temp, 'b.wav')); const ids = a.manifest.required_sections.map((s) => s.section_id); const first = authority.select(estate.runDir, a.take.take_id, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }); const second = authority.select(estate.runDir, b.take.take_id, { authority: 'Mikko Pakkala', sectionIds: [ids[0]], scriptBuilderRoot: estate.story.root }); assert.equal(second.manifest.manifest_revision, first.manifest.manifest_revision + 1); assert.ok(second.manifest.selection_history.some((x) => x.take_id === a.take.take_id)); assert.equal(second.manifest.selections.find((x) => x.section_id === ids[0]).take_id, b.take.take_id); assert.equal(authority.select(estate.runDir, b.take.take_id, { authority: 'Mikko Pakkala', sectionIds: [ids[0]], scriptBuilderRoot: estate.story.root }).state, 'ALREADY_SELECTED'); const rejected = authority.reject(estate.runDir, a.take.take_id, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }); assert.equal(rejected.manifest.takes.find((x) => x.take_id === a.take.take_id).state, 'REJECTED'); failCode(() => authority.select(estate.runDir, a.take.take_id, { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_REJECTED_TAKE_SELECTED');
});

test('FHP06 hostile ingest and selection paths fail closed', async () => {
  const estate = await fixtures.packagedEstate('fhp-hostile'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fhp-hostile-media-')); const corrupt = path.join(temp, 'bad.wav'); fs.writeFileSync(corrupt, 'not media'); failCode(() => authority.ingest(estate.runDir, corrupt, { scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_MEDIA_UNREADABLE'); failCode(() => authority.ingest(estate.runDir, path.join(temp, 'missing.mov'), { scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_MEDIA_MISSING'); const take = authority.ingest(estate.runDir, wav(temp, 'valid.wav'), { scriptBuilderRoot: estate.story.root }); failCode(() => authority.select(estate.runDir, take.take.take_id, { authority: 'MACHINE_SELECTOR', scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_MACHINE_SELECTOR_REFUSED'); failCode(() => authority.select(estate.runDir, 'missing', { authority: 'Mikko Pakkala', scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_TAKE_UNREGISTERED'); failCode(() => authority.select(estate.runDir, take.take.take_id, { scriptBuilderRoot: estate.story.root }), 'FINAL_PERFORMANCE_HUMAN_AUTHORITY_REQUIRED');
});

module.exports = { tests: require('./_helpers.js').tests };
