'use strict';

/*
 * Materialize a canonical visual-plan.json into the five package-run planning
 * artifacts that gate 6 (shot-edit-plan-review) evaluates.
 *
 * This is the second half of the gate-6 bridge. visual_planning_director owns
 * the SEMANTIC plan; this adapter owns its canonical package-run
 * REPRESENTATION. The five markdown files are projections of the plan, not a
 * competing plan: every row is derived from a typed field of one shot, and
 * regenerating from the same plan produces byte-identical output.
 *
 * Deliberately:
 *  - classification is by typed media_type / demonstration, never by keyword
 *    matching on prose;
 *  - a category with no legitimate entries states that explicitly and gives the
 *    reason, rather than inventing filler rows to avoid a zero count;
 *  - no row is ever emitted with a TODO/TBD status, because a scaffold row is
 *    exactly what this bridge exists to stop producing;
 *  - the canonical table headers are preserved verbatim, because gate 7's
 *    capture-checklist and the gate-6 evaluator both recognise planning tables
 *    by their first header cell.
 *
 * Human annotations survive regeneration only inside the explicit HUMAN NOTES
 * region; arbitrary edits elsewhere are overwritten, never silently merged.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const visualPlan = require('./visual-plan.js');

const ADAPTER_VERSION = 'visual-plan-package-materializer-v1';
const MACHINE_OWNER = 'visual_planning_director';
const PROVENANCE_FILE = 'visual-plan-materialization.json';
const PROVENANCE_SCHEMA = 'vidtoolz.visualPlanMaterialization.v1';

const HUMAN_REGION_START = '<!-- human-notes:start -->';
const HUMAN_REGION_END = '<!-- human-notes:end -->';

// Category -> which media types belong to it. PRESENTER_A_ROLL is the presenter
// themself: it belongs in the shot list, never in supplemental coverage.
const BROLL_MEDIA = Object.freeze(['GENERATED_STILL', 'GENERATED_VIDEO', 'MAP_ANIMATION', 'ARCHIVAL_EXTERNAL']);
const GRAPHICS_MEDIA = Object.freeze(['INFOGRAPHIC', 'TEXT_GRAPHIC']);
const CAPTURE_MEDIA = Object.freeze(['SCREEN_CAPTURE']);

const OUTPUT_FILES = Object.freeze([
  'shot-list.md',
  'screen-capture-list.md',
  'demo-list.md',
  'b-roll-list.md',
  'graphics-list.md',
]);

// Where a human approval marker can legitimately live. The three non-OUTPUT
// files are human-owned (this adapter never rewrites them); the OUTPUT files are
// scanned too because a marker can be placed in their human-notes region.
const APPROVAL_SCAN_FILES = Object.freeze([
  'production-plan.md',
  'audio-notes.md',
  'production-blockers.md',
  ...OUTPUT_FILES,
]);

class MaterializationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MaterializationError';
    this.code = code;
  }
}

function fail(code, message) { throw new MaterializationError(code, message); }

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/* ----------------------------------------------------------------- cells ---- */

// A table cell must stay one cell: pipes and newlines collapse, and trailing
// punctuation is trimmed so rows read as list entries rather than sentences.
function cell(value, limit = 220) {
  let text = String(value == null ? '' : value)
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > limit) {
    text = `${text.slice(0, limit - 1).replace(/[\s,;:.]+$/, '')}…`;
  }
  return text || '—';
}

function beatLabel(shot, beatsById) {
  const beat = beatsById.get(shot.beat_ref?.canonical_beat_id);
  const order = beat ? beat.order : null;
  const name = shot.narrative_function || (beat ? beat.beat : '') || 'beat';
  return order ? `beat ${order} (${name})` : name;
}

/* ------------------------------------------------------------ classifying --- */

function classifyPlan(plan) {
  const beatsById = new Map();
  (plan.required_beats || []).forEach((beat, index) => {
    beatsById.set(beat.canonical_beat_id, { ...beat, order: index + 1 });
  });

  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  return {
    beatsById,
    shots,
    captures: shots.filter((shot) => CAPTURE_MEDIA.includes(shot.media_type)),
    // A demonstration is declared by the planner, not guessed from wording.
    demos: shots.filter((shot) => shot.demonstration && typeof shot.demonstration === 'object'),
    broll: shots.filter((shot) => BROLL_MEDIA.includes(shot.media_type)),
    graphics: shots.filter((shot) => GRAPHICS_MEDIA.includes(shot.media_type)),
    noVisual: (plan.coverage || []).filter((entry) => entry.decision === 'INTENTIONAL_NO_VISUAL'),
  };
}

/* --------------------------------------------------------------- renderers -- */

function planHeader(plan, runId) {
  return [
    `- Run: ${runId}`,
    `- Machine owner: ${MACHINE_OWNER}`,
    `- Visual plan: ${plan.plan_id} r${plan.plan_revision}`,
    `- Plan digest: ${plan.plan_digest_sha256}`,
    `- Story: ${plan.story.project_id} @ ${plan.story.version_id}`,
    `- Adapter: ${ADAPTER_VERSION}`,
  ];
}

/*
 * An empty category is a planning decision, so it is written as one: what was
 * considered, why nothing is required, and where to verify that. This is
 * deliberately substantive prose — a bare "none" would read as an unfinished
 * artifact to the gate evaluator, and would deserve to.
 */
function deliberateNone(kind, plan, context) {
  return [
    `## No ${kind} Required`,
    '',
    `- Decision: NO_${context.token}_REQUIRED`,
    `- Decided by: ${MACHINE_OWNER} in visual plan ${plan.plan_id} r${plan.plan_revision}`,
    `- Basis: the plan assigns every covered beat to ${context.insteadOf}, so no ${kind} is needed for this episode.`,
    `- Coverage checked: ${context.shotCount} planned shot(s) across ${context.beatCount} canonical beat(s).`,
    '',
    context.detail,
  ].join('\n');
}

function shotDetailBlock(shot, beatsById) {
  const lines = [
    `### ${shot.narrative_function} — ${cell(shot.subject, 120)}`,
    '',
    `- Shot: ${shot.shot_id}`,
    `- Beat: ${beatLabel(shot, beatsById)}`,
    `- Media: ${shot.media_type} / ${shot.generation_mode}`,
    `- Presenter relation: ${shot.presenter_relation}`,
    `- Edit placement: ${cell(shot.edit_placement, 120)}`,
    `- Priority: ${shot.priority}`,
    `- Brief: ${cell(shot.shot_brief, 600)}`,
  ];
  if (shot.generation_requirements?.duration_target_s) {
    lines.push(`- Duration target: ${shot.generation_requirements.duration_target_s}s`);
  }
  if (shot.camera_intent) {
    lines.push(`- Camera intent (intent only, no mechanics): ${cell(shot.camera_intent.purpose || shot.camera_intent.subject, 200)}`);
  }
  if (shot.research_sensitive) {
    lines.push(`- Research-sensitive: yes — visual assertion ${cell(shot.visual_assertion, 200)}`);
  }
  if (Array.isArray(shot.continuity_notes) && shot.continuity_notes.length) {
    lines.push(`- Continuity: ${shot.continuity_notes.map((note) => cell(note, 120)).join('; ')}`);
  }
  if (shot.demonstration) {
    lines.push(
      `- Demonstration start state: ${cell(shot.demonstration.start_state, 300)}`,
      `- Demonstration action: ${cell(shot.demonstration.action, 300)}`,
      `- Demonstration expected result: ${cell(shot.demonstration.expected_result, 300)}`
    );
  }
  return lines.join('\n');
}

function renderShotList(plan, runId, classified) {
  const { shots, beatsById, noVisual } = classified;
  const rows = shots.map((shot) => `| ${cell(`${shot.narrative_function}: ${shot.subject}`)} | ${cell(`${beatLabel(shot, beatsById)}; ${shot.media_type}; presenter ${shot.presenter_relation}`)} | ${cell(shot.priority, 12)} | PLANNED |`);
  const out = [
    '# Shot List',
    '',
    ...planHeader(plan, runId),
    '',
    '| shot | reason | priority | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Shot Detail',
    '',
    ...shots.map((shot) => `${shotDetailBlock(shot, beatsById)}\n`),
  ];
  if (noVisual.length) {
    out.push('## Beats With A Deliberate No-Visual Decision', '');
    for (const entry of noVisual) {
      const beat = beatsById.get(entry.beat_ref?.canonical_beat_id);
      out.push(`- ${beat ? `beat ${beat.order}` : 'beat'} (${entry.beat_ref?.section_id}): ${cell(entry.reason, 400)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function renderScreenCaptureList(plan, runId, classified) {
  const { captures, beatsById, shots } = classified;
  if (!captures.length) {
    return [
      '# Screen Capture List',
      '',
      ...planHeader(plan, runId),
      '',
      deliberateNone('screen capture', plan, {
        token: 'SCREEN_CAPTURE',
        insteadOf: 'generated, graphic, or presenter coverage rather than recordings of an application',
        shotCount: shots.length,
        beatCount: (plan.required_beats || []).length,
        detail: 'If a later revision introduces a SCREEN_CAPTURE shot, this artifact is regenerated from that plan revision; it is not edited by hand.',
      }),
      '',
    ].join('\n');
  }
  const rows = captures.map((shot) => {
    const refs = shot.generation_requirements?.input_artifact_refs || [];
    const source = refs.length ? refs.map((ref) => cell(ref, 60)).join(', ') : 'source named in the capture detail below';
    return `| ${cell(shot.subject)} | ${cell(`${shot.narrative_function}; ${beatLabel(shot, beatsById)}`)} | ${cell(source, 90)} | PLANNED |`;
  });
  return [
    '# Screen Capture List',
    '',
    ...planHeader(plan, runId),
    '',
    '| capture | proof purpose | source/app | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Capture Detail',
    '',
    ...captures.map((shot) => `${shotDetailBlock(shot, beatsById)}\n`),
  ].join('\n');
}

function renderDemoList(plan, runId, classified) {
  const { demos, beatsById, shots } = classified;
  if (!demos.length) {
    return [
      '# Demo List',
      '',
      ...planHeader(plan, runId),
      '',
      deliberateNone('demonstration', plan, {
        token: 'DEMO',
        insteadOf: 'explanatory visuals rather than a walked-through workflow the viewer must follow step by step',
        shotCount: shots.length,
        beatCount: (plan.required_beats || []).length,
        detail: 'A demonstration is recorded on a shot as an explicit start state, action, and expected result. No shot in this plan revision declares one.',
      }),
      '',
    ].join('\n');
  }
  const rows = demos.map((shot) => `| ${cell(`${shot.subject}: ${shot.demonstration.action}`)} | ${cell(shot.demonstration.expected_result)} | ${cell(shot.demonstration.start_state)} | PLANNED |`);
  return [
    '# Demo List',
    '',
    ...planHeader(plan, runId),
    '',
    '| demo | what it proves | setup needed | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Demonstration Detail',
    '',
    ...demos.map((shot) => `${shotDetailBlock(shot, beatsById)}\n`),
  ].join('\n');
}

function renderBrollList(plan, runId, classified) {
  const { broll, beatsById, shots } = classified;
  if (!broll.length) {
    return [
      '# B-Roll List',
      '',
      ...planHeader(plan, runId),
      '',
      deliberateNone('b-roll', plan, {
        token: 'BROLL',
        insteadOf: 'graphic and presenter coverage carrying each beat directly',
        shotCount: shots.length,
        beatCount: (plan.required_beats || []).length,
        detail: 'Supplemental footage is only listed when the plan contains a generated, map, or archival shot. This plan revision contains none.',
      }),
      '',
    ].join('\n');
  }
  const rows = broll.map((shot) => `| ${cell(`${shot.narrative_function}: ${shot.subject}`)} | ${cell(`${beatLabel(shot, beatsById)}; presenter ${shot.presenter_relation}`)} | ${cell(`${shot.media_type} / ${shot.generation_mode}`, 60)} | PLANNED |`);
  return [
    '# B-Roll List',
    '',
    ...planHeader(plan, runId),
    '',
    '| b-roll item | reason | source | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## B-Roll Detail',
    '',
    ...broll.map((shot) => `${shotDetailBlock(shot, beatsById)}\n`),
  ].join('\n');
}

function renderGraphicsList(plan, runId, classified) {
  const { graphics, beatsById, shots } = classified;
  if (!graphics.length) {
    return [
      '# Graphics List',
      '',
      ...planHeader(plan, runId),
      '',
      deliberateNone('graphic', plan, {
        token: 'GRAPHICS',
        insteadOf: 'captured, generated, or presenter coverage rather than built graphics',
        shotCount: shots.length,
        beatCount: (plan.required_beats || []).length,
        detail: 'Graphics are listed from INFOGRAPHIC and TEXT_GRAPHIC shots. This plan revision contains none.',
      }),
      '',
    ].join('\n');
  }
  const rows = graphics.map((shot) => `| ${cell(`${shot.narrative_function}: ${shot.subject}`)} | ${cell(shot.shot_brief)} | ${cell(`${shot.media_type}; ${beatLabel(shot, beatsById)}`, 90)} | PLANNED |`);
  return [
    '# Graphics List',
    '',
    ...planHeader(plan, runId),
    '',
    '| graphic | clarity purpose | source/input | status |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Graphic Detail',
    '',
    ...graphics.map((shot) => `${shotDetailBlock(shot, beatsById)}\n`),
  ].join('\n');
}

const RENDERERS = Object.freeze({
  'shot-list.md': renderShotList,
  'screen-capture-list.md': renderScreenCaptureList,
  'demo-list.md': renderDemoList,
  'b-roll-list.md': renderBrollList,
  'graphics-list.md': renderGraphicsList,
});

/* ------------------------------------------------------- human-notes region -- */

function extractHumanRegion(existing) {
  if (!existing) return '';
  const start = existing.indexOf(HUMAN_REGION_START);
  const end = existing.indexOf(HUMAN_REGION_END);
  if (start === -1 || end === -1 || end < start) return '';
  return existing.slice(start + HUMAN_REGION_START.length, end).trim();
}

function withHumanRegion(body, preserved) {
  return [
    body.replace(/\s+$/, ''),
    '',
    HUMAN_REGION_START,
    preserved ? preserved : '',
    HUMAN_REGION_END,
    '',
  ].join('\n');
}

/* ------------------------------------------------------------ materialize --- */

function loadPlan(planPath) {
  const file = path.resolve(planPath);
  if (!fs.existsSync(file)) fail('VISUAL_PLAN_NOT_FOUND', `visual plan not found: ${planPath}`);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fail('VISUAL_PLAN_UNREADABLE', `visual plan is not valid JSON: ${planPath}`); }
  if (plan?.artifact_type !== 'visual-plan') {
    fail('VISUAL_PLAN_ARTIFACT_TYPE_INVALID', 'artifact is not a canonical visual-plan');
  }
  return plan;
}

/*
 * Refuse to materialize a plan that is not structurally valid or whose stored
 * digest does not match its content: the five artifacts must never be more
 * trustworthy-looking than the plan they came from.
 */
function assertPlanUsable(plan) {
  const validation = visualPlan.validatePlan(plan, {});
  const issues = validation.issues || [];
  if (issues.length) {
    fail('VISUAL_PLAN_INVALID', `visual plan failed structural validation: ${issues.slice(0, 3).map((i) => i.code).join(', ')}`);
  }
  if (visualPlan.planDigest(plan) !== plan.plan_digest_sha256) {
    fail('VISUAL_PLAN_DIGEST_MISMATCH', 'visual plan digest does not match its content');
  }
  if (!Array.isArray(plan.shots) || !plan.shots.length) {
    fail('VISUAL_PLAN_EMPTY', 'visual plan contains no shots to materialize');
  }
  return plan;
}

function buildArtifacts(plan, runId) {
  const classified = classifyPlan(plan);
  const files = {};
  for (const filename of OUTPUT_FILES) {
    files[filename] = RENDERERS[filename](plan, runId, classified);
  }
  return { classified, files };
}

function atomicWrite(target, contents) {
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/*
 * Once a human has approved a shot/edit plan, regenerating these artifacts from
 * a DIFFERENT plan would hand that approval to content the approver never saw:
 * the gate re-reads the marker, still finds it, and passes. Making the artifacts
 * machine-regenerable is what turned that into a practical bypass, so the guard
 * belongs here.
 *
 * A recorded approval names the plan digest it was given for. If the plan on the
 * table is not that plan, materialization refuses. Re-planning after approval is
 * legitimate, but it must be an explicit act that supersedes the approval rather
 * than a silent inheritance of it.
 */
function readApprovalBinding(runDir) {
  const APPROVAL = /^(?:[-*]\s*)?(?:Manual approval|Production planning approval|Shot\/edit plan approval):\s*PASS\s*$/im;
  const DIGEST = /Approved plan digest:\s*([0-9a-f]{64})/i;
  for (const filename of APPROVAL_SCAN_FILES) {
    const file = path.join(runDir, filename);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!APPROVAL.test(text)) continue;
    const digest = DIGEST.exec(text);
    return { filename, approvedDigest: digest ? digest[1].toLowerCase() : null };
  }
  return null;
}

function assertNotSupersedingApproval(runDir, plan, options) {
  const approval = readApprovalBinding(runDir);
  if (!approval) return null;
  if (options.replaceApproved) return approval;
  if (approval.approvedDigest === plan.plan_digest_sha256) return approval;
  if (!approval.approvedDigest) {
    fail('APPROVED_PLAN_DIGEST_UNKNOWN',
      `${approval.filename} records a human approval with no approved plan digest; refusing to regenerate approved artifacts`);
  }
  fail('APPROVED_PLAN_SUPERSEDED',
    `${approval.filename} approves plan digest ${approval.approvedDigest}, not ${plan.plan_digest_sha256}; clear or renew the approval before materializing a different plan`);
  return null;
}

function materialize(runDirInput, planPathInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    fail('MATERIALIZE_RUN_NOT_FOUND', `package run folder not found: ${runDirInput}`);
  }
  const runId = path.basename(runDir);
  const plan = assertPlanUsable(loadPlan(planPathInput));
  const approval = assertNotSupersedingApproval(runDir, plan, options);

  const { classified, files } = buildArtifacts(plan, runId);
  const written = [];
  for (const filename of OUTPUT_FILES) {
    const target = path.join(runDir, filename);
    // Path safety: a rendered filename must never escape the run directory.
    if (path.dirname(target) !== runDir) fail('MATERIALIZE_PATH_UNSAFE', `refusing to write outside the run: ${filename}`);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const contents = withHumanRegion(files[filename], extractHumanRegion(existing));
    const unchanged = existing === contents;
    if (!options.dryRun && !unchanged) atomicWrite(target, contents);
    written.push({
      filename,
      path: target,
      sha256: sha256(contents),
      bytes: Buffer.byteLength(contents),
      unchanged,
      human_notes_preserved: Boolean(extractHumanRegion(existing)),
    });
  }

  const provenance = {
    schema: PROVENANCE_SCHEMA,
    adapter_version: ADAPTER_VERSION,
    machine_owner: MACHINE_OWNER,
    run_id: runId,
    source_visual_plan: {
      path: path.relative(runDir, path.resolve(planPathInput)),
      plan_id: plan.plan_id,
      plan_revision: plan.plan_revision,
      plan_digest_sha256: plan.plan_digest_sha256,
      lifecycle_state: plan.lifecycle_state,
      created_at: plan.created_at,
      created_by: plan.created_by,
      task_id: options.taskId || null,
    },
    story: {
      project_id: plan.story.project_id,
      version_id: plan.story.version_id,
      content_hash: plan.story.content_hash,
      approval_state: plan.story.approval?.state || 'none',
    },
    coverage: {
      required_beats: (plan.required_beats || []).length,
      planned_shots: classified.shots.length,
      intentional_no_visual: classified.noVisual.length,
      screen_captures: classified.captures.length,
      demonstrations: classified.demos.length,
      broll: classified.broll.length,
      graphics: classified.graphics.length,
    },
    artifacts: written.map(({ filename, sha256: digest, bytes }) => ({ filename, sha256: digest, bytes })),
    human_approval: approval
      ? { recorded_in: approval.filename, approved_plan_digest: approval.approvedDigest, matches_source_plan: approval.approvedDigest === plan.plan_digest_sha256 }
      : null,
  };
  if (!options.dryRun) {
    atomicWrite(path.join(runDir, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`);
  }

  return { runId, plan, classified, written, provenance };
}

function usage() {
  return [
    'Usage: node scripts/visual-plan-package-materializer.js <package-run> <visual-plan.json> [--task-id ID] [--dry-run] [--json]',
    '',
    'Projects a canonical visual plan into the five package-run planning artifacts.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = { json: false, dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--task-id') options.taskId = argv[++i];
    else if (arg === '--help') { console.log(usage()); return 0; }
    else positional.push(arg);
  }
  if (positional.length !== 2) { console.error(usage()); return 1; }
  try {
    const result = materialize(positional[0], positional[1], options);
    if (options.json) {
      console.log(JSON.stringify({ run_id: result.runId, provenance: result.provenance, written: result.written }, null, 2));
    } else {
      console.log(`materialized ${result.plan.plan_id} r${result.plan.plan_revision} into ${result.runId}`);
      for (const file of result.written) console.log(`  ${file.filename} ${file.unchanged ? '(unchanged)' : ''} ${file.sha256.slice(0, 16)}`);
    }
    return 0;
  } catch (error) {
    console.error(`${error.code || 'MATERIALIZE_FAILED'}: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ADAPTER_VERSION,
  MACHINE_OWNER,
  PROVENANCE_FILE,
  PROVENANCE_SCHEMA,
  OUTPUT_FILES,
  APPROVAL_SCAN_FILES,
  readApprovalBinding,
  BROLL_MEDIA,
  GRAPHICS_MEDIA,
  CAPTURE_MEDIA,
  HUMAN_REGION_START,
  HUMAN_REGION_END,
  MaterializationError,
  cell,
  classifyPlan,
  extractHumanRegion,
  withHumanRegion,
  loadPlan,
  assertPlanUsable,
  buildArtifacts,
  materialize,
  usage,
  main,
};
