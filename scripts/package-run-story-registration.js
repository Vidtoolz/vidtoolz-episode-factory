'use strict';

/*
 * Register a package run's own approved script as a canonical Story, then bind
 * the run to it.
 *
 * Why this exists: package runs that predate the Story lane have a real,
 * reviewed script (final-script.md) but no canonical Story identity, so
 * visual_planning_director cannot plan for them. This is the sanctioned
 * backfill: it does NOT invent Story content, ids, or approval. It takes the
 * run's existing approved script, decomposes it on its own `##` headings, and
 * registers it through Script Builder's own canonical API
 * (store.newProject / store.newSection / versions.createVersion).
 *
 * What it deliberately does not do:
 *  - approve the Story version (approval is a human act, left at state 'none')
 *  - write Story content anywhere under package-runs (Script Builder keeps authority)
 *  - guess a script when the run has none (it fails closed instead)
 */

const fs = require('node:fs');
const path = require('node:path');

const compat = require('./script-builder-compat.js');
const storyBinding = require('./package-run-story-binding.js');
const packageRunsIndex = require('./package-runs-index.js');

const SCRIPT_CANDIDATES = Object.freeze(['final-script.md', 'script-draft.md']);
const PROVENANCE_SOURCE_SYSTEM = 'vidtoolz-episode-factory/package-run';

class StoryRegistrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoryRegistrationError';
    this.code = code;
  }
}

function fail(code, message) { throw new StoryRegistrationError(code, message); }

/* --------------------------------------------------------------- parsing ---- */

/*
 * Decompose a package-run script into canonical Story sections on its own `##`
 * headings. Structural only: the heading becomes the beat, the prose beneath it
 * becomes the dialogue. Content before the first heading is run preamble
 * (metadata bullets), not a beat, and is dropped.
 */
function parseScriptSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { beat: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue; // preamble before the first beat
    current.body.push(line);
  }
  return sections
    .map((section) => ({
      beat: section.beat,
      dialogue: section.body.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    }))
    .filter((section) => section.dialogue.length > 0);
}

function readRunScript(runDir) {
  for (const filename of SCRIPT_CANDIDATES) {
    const file = path.join(runDir, filename);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      if (text.trim()) return { filename, text };
    }
  }
  return null;
}

// The run's canonical workflow path already declares its delivery shape; derive
// the Story output class from it rather than asking the caller to restate it.
function lengthClassForRun(runDir) {
  const workflowPath = packageRunsIndex.readWorkflowPathForRun(runDir);
  if (workflowPath === 'vertical') return 'short';
  if (workflowPath === 'horizontal') return 'long';
  fail('STORY_REGISTRATION_LENGTH_CLASS_UNKNOWN',
    `cannot derive Story output class from workflow path: ${workflowPath || '(none)'}`);
  return null;
}

function runTitle(runDir, runId) {
  const file = path.join(runDir, 'selected-package.json');
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const title = parsed?.package?.proposedTitle;
      if (typeof title === 'string' && title.trim()) return title.trim();
    } catch (_) { /* fall through to the run id */ }
  }
  return runId;
}

/* ---------------------------------------------------------- registration ---- */

function planRegistration(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('STORY_REGISTRATION_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  if (!packageRunsIndex.isPackageRunDir(runDir)) {
    fail('STORY_REGISTRATION_NOT_A_PACKAGE_RUN',
      `${path.basename(runDir)} is not a package run; refusing to register a Story for a proof directory`);
  }
  const runId = path.basename(runDir);

  const script = readRunScript(runDir);
  if (!script) {
    fail('STORY_REGISTRATION_SCRIPT_MISSING',
      `run has no script to register (looked for ${SCRIPT_CANDIDATES.join(', ')})`);
  }

  const parsed = parseScriptSections(script.text);
  if (!parsed.length) {
    fail('STORY_REGISTRATION_SCRIPT_UNSTRUCTURED',
      `${script.filename} has no '## ' beat headings to decompose into canonical Story sections`);
  }

  return {
    runDir,
    runId,
    script,
    sections: parsed,
    title: runTitle(runDir, runId),
    lengthClass: options.lengthClass || lengthClassForRun(runDir),
    scriptSha256: storyBinding.sha256(script.text),
  };
}

/*
 * Create the canonical Story in Script Builder and bind the run to it.
 * Idempotent by content: if the run is already bound to a resolvable Story whose
 * content hash matches this script's sections, nothing is written.
 */
function registerStoryForRun(runDirInput, options = {}) {
  const plan = planRegistration(runDirInput, options);
  const { root, versions } = compat.load(options.scriptBuilderRoot);
  const dataRoot = path.join(root, 'data');
  const store = require(path.join(root, 'lib', 'store.js'));
  const config = require(path.join(root, 'lib', 'config.js'));
  const { ulid } = require(path.join(root, 'lib', 'ulid.js'));

  const existingBinding = storyBinding.readBinding(plan.runDir);
  if (existingBinding && !options.replace) {
    const resolved = storyBinding.resolveBoundStory(plan.runDir, { scriptBuilderRoot: root });
    return {
      created: false,
      reused: true,
      runId: plan.runId,
      projectId: resolved.projectId,
      versionId: resolved.versionId,
      contentHash: resolved.contentHash,
      binding: resolved.binding,
    };
  }

  const projectId = ulid();
  const project = store.newProject({
    id: projectId,
    title: plan.title,
    length_class: plan.lengthClass,
    kind: 'one-off',
  });
  // The Story is registered from an existing package run; say so on the record
  // itself so nobody later mistakes it for native Script Builder authoring.
  project.source_handoff = `${PROVENANCE_SOURCE_SYSTEM}/${plan.runId}/${plan.script.filename}`;
  store.saveProject(dataRoot, project);

  const sections = plan.sections.map((section, index) => {
    const built = store.newSection({
      id: ulid(),
      order: index + 1,
      beat: section.beat,
      type: 'composited',
      dialogue: section.dialogue,
      state: 'raw',
    });
    store.validateSection(dataRoot, built);
    store.saveSection(dataRoot, project.id, built);
    return built;
  });

  const version = versions.createVersion(dataRoot, project, sections, config.loadConfig(dataRoot), {
    label: `registered from package run ${plan.runId}`,
    source_provenance: {
      source_system: PROVENANCE_SOURCE_SYSTEM,
      source_id: `${plan.runId}/${plan.script.filename}`,
      artifact_sha256: plan.scriptSha256,
      registered_by: options.registeredBy || 'claude (lifecycle bridge)',
    },
  });

  const binding = storyBinding.buildBinding({
    runId: plan.runId,
    projectId: project.id,
    versionId: version.id,
    contentHash: version.content_hash,
    scriptBuilderRoot: root,
    boundAt: version.created,
    boundBy: options.registeredBy || 'claude (lifecycle bridge)',
    provenance: {
      source_artifact: plan.script.filename,
      source_artifact_sha256: plan.scriptSha256,
      section_count: sections.length,
      registration: 'package-run-story-registration.js',
    },
  });
  const written = storyBinding.writeBinding(plan.runDir, binding, { replace: Boolean(options.replace) });

  return {
    created: true,
    reused: false,
    runId: plan.runId,
    projectId: project.id,
    versionId: version.id,
    contentHash: version.content_hash,
    sectionCount: sections.length,
    approvalState: version.approval.state,
    binding: written.binding,
    bindingPath: written.path,
  };
}

function usage() {
  return [
    'Usage: node scripts/package-run-story-registration.js package-runs/<run> [--replace] [--json]',
    '',
    'Registers the run\'s approved script as a canonical Script Builder Story and',
    'binds the run to that exact version. Does not approve the Story.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = { json: false, replace: false };
  let runFolder = null;
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--help') { console.log(usage()); return 0; }
    else if (!runFolder) runFolder = arg;
    else { console.error(usage()); return 1; }
  }
  if (!runFolder) { console.error(usage()); return 1; }
  try {
    const result = registerStoryForRun(path.resolve(runFolder), options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`story ${result.reused ? 'already bound' : 'registered'}: ${result.projectId}@${result.versionId}`);
      console.log(`content hash: ${result.contentHash}`);
      if (result.created) console.log(`sections: ${result.sectionCount}; approval state: ${result.approvalState}`);
    }
    return 0;
  } catch (error) {
    console.error(`${error.code || 'STORY_REGISTRATION_FAILED'}: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SCRIPT_CANDIDATES,
  PROVENANCE_SOURCE_SYSTEM,
  StoryRegistrationError,
  parseScriptSections,
  readRunScript,
  lengthClassForRun,
  runTitle,
  planRegistration,
  registerStoryForRun,
  usage,
  main,
};
