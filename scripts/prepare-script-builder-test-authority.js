#!/usr/bin/env node
'use strict';

/*
 * Build an isolated verification checkout from the pinned Script Builder
 * authority, then seed the public Episode Factory canary Story through that
 * checkout's real store/version implementation. Script Builder remains the
 * executable authority; this supplies deterministic test data that is not part
 * of its pinned source commit and never mutates the operator's live checkout.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const RUN_ID = '2026-08-25-lifecycle-integration-canary-canary-not-for-publication';
const RUN_DIR = path.join(REPO, 'package-runs', RUN_ID);
const TASK_FILE = path.join(RUN_DIR, 'agents', 'visual_planning_director',
  'vpd-canary-bridge-1', 'task.json');
const BINDING_FILE = path.join(RUN_DIR, 'story-binding.json');
const LOCK_FILE = path.join(REPO, 'config', 'script-builder-authority.json');

function fail(message) { throw new Error(`Script Builder test authority: ${message}`); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!args.source || !args.out) fail('usage: --source <pinned checkout> --out <empty path>');
  return { source: path.resolve(args.source), out: path.resolve(args.out) };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (!fs.existsSync(args.source)) fail(`source checkout is missing: ${args.source}`);
  if (fs.existsSync(args.out)) fail(`output path must not exist: ${args.out}`);

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  const sourceCommit = execFileSync('git', ['-C', args.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (sourceCommit !== lock.ref) fail(`source is ${sourceCommit}; expected pinned ${lock.ref}`);

  execFileSync('git', ['clone', '--quiet', '--shared', args.source, args.out], { stdio: 'inherit' });
  const clonedCommit = execFileSync('git', ['-C', args.out, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (clonedCommit !== lock.ref) fail(`isolated checkout is ${clonedCommit}; expected pinned ${lock.ref}`);

  const task = JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
  const binding = JSON.parse(fs.readFileSync(BINDING_FILE, 'utf8'));
  const store = require(path.join(args.out, 'lib', 'store.js'));
  const versions = require(path.join(args.out, 'lib', 'versions.js'));
  const config = require(path.join(args.out, 'lib', 'config.js'));
  const dataRoot = path.join(args.out, 'data');
  const projectDir = path.join(dataRoot, 'projects', binding.story.project_id);
  if (fs.existsSync(projectDir)) fail(`fixture project already exists in pinned checkout: ${binding.story.project_id}`);

  store.ensureLayout(dataRoot);
  const project = store.newProject({
    id: binding.story.project_id,
    title: 'CANARY — Lifecycle Integration Test Package (NOT FOR PUBLICATION)',
    length_class: 'long',
    source_handoff: `vidtoolz-episode-factory/package-run/${RUN_ID}/final-script.md`,
  });
  store.saveProject(dataRoot, project);

  const sections = task.story.sections.map((section) => ({
    id: section.section_id,
    order: section.order,
    beat: section.beat,
    type: section.type,
    background: section.background,
    framing_preset: section.framing_preset,
    dialogue: section.dialogue,
    visual_notes: section.visual_notes,
    media_refs: section.media_refs,
  }));
  const computedHash = versions.scriptContentHash(sections);
  if (computedHash !== binding.story.content_hash) {
    fail(`public canary sections hash to ${computedHash}; binding requires ${binding.story.content_hash}`);
  }

  const generated = versions.createVersion(dataRoot, project, sections, config.loadConfig(dataRoot), {
    label: `Episode Factory canonical verification fixture for ${RUN_ID}`,
    source_provenance: { source_system: 'vidtoolz-episode-factory/test-fixture', source_id: RUN_ID },
  });
  const generatedFile = versions.versionFile(dataRoot, project.id, generated.id);
  const targetFile = versions.versionFile(dataRoot, project.id, binding.story.version_id);
  const generatedText = fs.readFileSync(generatedFile, 'utf8');
  const idLine = `id: "${generated.id}"`;
  if (!generatedText.includes(idLine)) fail('generated version does not expose its identity in canonical frontmatter');
  fs.writeFileSync(targetFile, generatedText.replace(idLine, `id: "${binding.story.version_id}"`));
  fs.unlinkSync(generatedFile);

  const resolved = versions.loadVersion(dataRoot, project.id, binding.story.version_id);
  if (resolved.id !== binding.story.version_id || resolved.content_hash !== binding.story.content_hash) {
    fail('seeded canary did not round-trip through pinned Script Builder authority');
  }

  process.stdout.write(`${JSON.stringify({
    root: args.out,
    source_commit: sourceCommit,
    fixture_project_id: project.id,
    fixture_version_id: resolved.id,
    fixture_content_hash: resolved.content_hash,
  }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { RUN_ID, parseArgs, main };
