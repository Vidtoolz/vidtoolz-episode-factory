#!/usr/bin/env node
'use strict';

/*
 * final-music — the operator entry point for Final Music Production.
 *
 * The whole workflow reduced to: see where you are, make or hand over a track,
 * listen, choose.
 *
 *   final-music status   --run-id <run>
 *   final-music generate --run-id <run>                     (fresh Final renders)
 *   final-music ingest   --run-id <run> --file <track>      (your own render)
 *   final-music list     --run-id <run>                     (audition paths)
 *   final-music select   --run-id <run> --candidate <id> --authority "Mikko Pakkala"
 *   final-music reject | alternate | project | help
 *
 * The operator supplies a run, a file and a decision. Lock, brief, hashes,
 * candidate identity, provenance, QC, coherence diagnostics and completion are
 * all resolved from the run id. Nothing here selects music.
 */

const path = require('node:path');

const music = require('./final-music-production.js');
const directed = require('./directed-draft-assembly-handoff.js');

const COMMANDS = Object.freeze([
  'status', 'generate', 'ingest', 'list', 'select', 'reject', 'alternate', 'project', 'help',
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function usage() {
  return [
    'final-music — Final Music Production',
    '',
    '  status    --run-id <run>                       where Final music stands and what to do next',
    '  generate  --run-id <run> [--count 3]           fresh Final-stage candidates (needs a transport)',
    '  ingest    --run-id <run> --file <track>        register a track you produced yourself',
    '  list      --run-id <run>                       candidates with audition paths and diagnostics',
    '  select    --run-id <run> --candidate <id> --authority "Mikko Pakkala"',
    '  reject    --run-id <run> --candidate <id> --authority "..." [--note "..."]',
    '  alternate --run-id <run> --candidate <id> --authority "..."',
    '  project   --run-id <run>                       derived Resolve music projection',
    '',
    '  --json for the full machine record.',
    '',
    'Draft music is INSPIRATION_ONLY: it never becomes Final music authority.',
    'A candidate is never a selection, and no machine may make the selection.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..'), json: false };
  if (!COMMANDS.includes(out.command)) fail('FINAL_MUSIC_COMMAND_INVALID', `${String(out.command)} (expected one of ${COMMANDS.join(', ')})`);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') { out.json = true; continue; }
    if (token === '--run-id') { out.runId = argv[++index]; continue; }
    if (token === '--repo') { out.repo = path.resolve(argv[++index]); continue; }
    if (token === '--file') { out.file = argv[++index]; continue; }
    if (token === '--candidate') { out.candidate = argv[++index]; continue; }
    if (token === '--authority') { out.authority = argv[++index]; continue; }
    if (token === '--note') { out.note = argv[++index]; continue; }
    if (token === '--count') { out.count = Number(argv[++index]); continue; }
    if (token === '--model') { out.model = argv[++index]; continue; }
    if (token === '--experimental-minimax') { out.experimentalMinimax = true; continue; }
    if (token === '--acknowledge-coherence-rejection') { out.acknowledgeCoherenceRejection = true; continue; }
    fail('FINAL_MUSIC_ARGUMENT_INVALID', token);
  }
  if (out.command !== 'help' && !out.runId) fail('FINAL_MUSIC_ARGUMENT_INVALID', '--run-id is required');
  if (out.command === 'ingest' && !out.file) fail('FINAL_MUSIC_ARGUMENT_INVALID', 'ingest requires --file');
  if (['select', 'reject', 'alternate'].includes(out.command) && !out.candidate) {
    fail('FINAL_MUSIC_ARGUMENT_INVALID', `${out.command} requires --candidate`);
  }
  if (['select', 'reject', 'alternate'].includes(out.command) && !out.authority) {
    fail('FINAL_MUSIC_ARGUMENT_INVALID', `${out.command} requires --authority (this is a human decision)`);
  }
  return out;
}

const RULE = '─'.repeat(74);

function renderStatus(value) {
  const lines = [
    `FINAL MUSIC: ${value.final_music_state}   (complete: ${value.final_music_complete})`,
    '',
    `brief            ${value.brief.state}  ${String(value.brief.sha256).slice(0, 12)}  ${value.brief.sections} sections, target ${Math.round((value.brief.target_duration_ms || 0) / 1000)}s`,
    `ending required  ${value.brief.ending_requirement || 'n/a'}`,
    `draft music      ${value.draft_music} — never promoted to Final authority`,
    '',
    'candidates',
  ];
  const c = value.counts;
  lines.push(`  registered ${c.candidates}   generated ${c.generated}   manual/external ${c.manual_external}`);
  lines.push(`  auditionable ${c.auditionable}   technically valid ${c.technically_valid}   alternates ${c.alternates}`);
  lines.push(`  machine-rejected: technical ${c.rejected_technical}, coherence ${c.rejected_coherence}   human-rejected ${c.human_rejected}   superseded ${c.superseded}`);
  lines.push(`  selections made ${c.selections_made}`);
  if (value.selected) {
    lines.push('', `SELECTED  ${value.selected.candidate_id}  (${value.selected.source_type}, ${value.selected.acceptance})`);
    lines.push(`          ${value.selected.path}`);
  } else if (value.recommendation) {
    lines.push('', `machine recommendation: ${value.recommendation.candidate_slot} (${value.recommendation.candidate_id}) — ${value.recommendation.note}`);
  }
  if (value.blocking_reasons.length) lines.push('', `blocking: ${value.blocking_reasons.join(', ')}`);
  lines.push('', RULE, `NEXT [${value.next_action.state}] ${value.next_action.task}`, value.next_action.detail);
  for (const command of value.next_action.commands || [value.next_action.command]) {
    if (command) lines.push(`  ${command}`);
  }
  lines.push(RULE);
  lines.push('', 'lanes: Final visual assets, Final human performance and Final music proceed independently.');
  return lines.join('\n');
}

function renderList(value) {
  if (!value.candidates.length) return 'No Final music candidates registered yet.';
  const lines = [`FINAL MUSIC CANDIDATES (${value.candidates.length})`, ''];
  for (const item of value.candidates) {
    lines.push(`${item.slot}  ${item.candidate_id}${item.selected ? '   ← SELECTED' : ''}`);
    lines.push(`    listen      ${item.audition_path}`);
    lines.push(`    media       ${item.duration_s}s  ${item.codec} ${item.sample_rate}Hz ${item.channels}ch  ${item.integrated_lufs} LUFS`);
    lines.push(`    source      ${item.source_type}${item.model ? ` (${item.model})` : ''}${item.concept ? ` — ${item.concept}` : ''}`);
    lines.push(`    machine     ${item.acceptance} · ending ${item.ending_class} · coherence ${item.coherence_class}${item.coherence_score != null ? ` (${item.coherence_score})` : ''}`);
    if (item.warnings.length) lines.push(`    warnings    ${item.warnings.join(', ')}`);
    lines.push(`    disposition ${item.disposition}`);
    lines.push('');
  }
  if (value.recommendation) lines.push(`machine recommendation: ${value.recommendation.candidate_slot} — advisory only, not a selection.`);
  lines.push('Selection is human-only: final-music select --candidate <id> --authority "Mikko Pakkala"');
  return lines.join('\n');
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help') return { text: usage(), value: null, exitCode: 0 };
  const runDir = directed.resolveRunDir(args.repo, args.runId);
  const opts = {
    authority: args.authority,
    note: args.note,
    acknowledgeCoherenceRejection: args.acknowledgeCoherenceRejection,
  };

  if (args.command === 'status') {
    const value = music.musicStatus(runDir);
    return { text: renderStatus(value), value, exitCode: 0 };
  }
  if (args.command === 'list') {
    const value = music.listCandidates(runDir);
    return { text: renderList(value), value, exitCode: 0 };
  }
  if (args.command === 'generate') {
    const value = await music.generateFinalCandidates(runDir, {
      count: args.count, model: args.model, experimentalMinimax: args.experimentalMinimax,
    });
    const text = [
      `GENERATED ${value.candidates.length} Final music candidate(s) with ${value.model} (${value.routing_policy})`,
      ...value.candidates.map((item) => `  ${item.candidate_slot}  ${item.candidate_id}  ${item.acceptance}`),
      '',
      'None is selected. Audition them with `final-music list`, then select one yourself.',
    ].join('\n');
    return { text, value, exitCode: 0 };
  }
  if (args.command === 'ingest') {
    const value = music.ingestMusic(runDir, { file: args.file, sourceType: 'MANUAL_EXTERNAL' });
    if (value.state === 'ALREADY_REGISTERED') {
      return { text: `ALREADY_REGISTERED — these exact bytes are already candidate ${value.candidate.candidate_id}. Nothing changed.`, value, exitCode: 0 };
    }
    const warn = value.candidate.technical_qc.warnings.map((item) => `\n  warning     ${item}`).join('');
    const text = [
      `INGESTED ${value.candidate.candidate_id}`,
      `  sha256      ${value.candidate.sha256}`,
      `  media       ${value.candidate.media.duration_s}s ${value.candidate.media.codec} ${value.candidate.media.sample_rate}Hz ${value.candidate.media.channels}ch`,
      `  machine     ${value.candidate.acceptance} · ending ${value.candidate.technical_qc.ending_class} · coherence ${value.candidate.coherence_diagnostics.coherence_class}`,
      `  disposition ${value.candidate.disposition} — registered is NOT selected${warn}`,
      '',
      `Next: final-music select --run-id ${args.runId} --candidate ${value.candidate.sha256.slice(0, 12)} --authority "Mikko Pakkala"`,
    ].join('\n');
    return { text, value, exitCode: 0 };
  }
  if (args.command === 'select') {
    const value = music.selectMusic(runDir, { ...opts, candidate: args.candidate });
    if (value.state === 'ALREADY_SELECTED') {
      return { text: `ALREADY_SELECTED — ${value.candidate.candidate_id} is already the current Final music.`, value, exitCode: 0 };
    }
    const lines = [
      `FINAL MUSIC SELECTED: ${value.candidate.candidate_id}`,
      `  authority   HUMAN:${value.selection.authority.id}`,
      `  sha256      ${value.selection.media.sha256}`,
      `  selection   #${value.selection.selection_index}`,
    ];
    if (value.selection.previous_selection) {
      lines.push(`  supersedes  ${value.selection.previous_selection.candidate_id} (kept as history, now SUPERSEDED)`);
    }
    if (value.selection.warnings_at_selection.length) {
      lines.push(`  warnings    ${value.selection.warnings_at_selection.join(', ')} (recorded, not overridden)`);
    }
    lines.push('', `Next: final-music project --run-id ${args.runId}`);
    return { text: lines.join('\n'), value, exitCode: 0 };
  }
  if (args.command === 'reject') {
    const value = music.rejectCandidate(runDir, { ...opts, candidate: args.candidate });
    return { text: `REJECTED ${value.candidate.candidate_id} — preserved in history, can never satisfy Final music completion.`, value, exitCode: 0 };
  }
  if (args.command === 'alternate') {
    const value = music.keepAsAlternate(runDir, { ...opts, candidate: args.candidate });
    return { text: `KEEP_AS_ALTERNATE ${value.candidate.candidate_id} — kept available, not selected.`, value, exitCode: 0 };
  }
  if (args.command === 'project') {
    const value = music.projectResolveMusic(runDir);
    const track = value.projection.music_track;
    const text = [
      `RESOLVE MUSIC PROJECTION → ${path.relative(runDir, value.path)}`,
      `  music track   ${track.state}${track.candidate_id ? ` (${track.candidate_id})` : ''}`,
      `  blueprint     ${value.projection.blueprint_sha256.slice(0, 12)} — NOT mutated`,
      `  mix guidance  bed ${value.projection.mix_guidance.suggested_music_level_db} dB, pause lift ${value.projection.mix_guidance.pause_lift_db} dB, no destructive premix`,
      `  final edit    ${value.projection.final_edit_complete}   final QC ${value.projection.final_qc_pass}   publication ${value.projection.publication_authority}`,
    ].join('\n');
    return { text, value, exitCode: 0 };
  }
  return { text: usage(), value: null, exitCode: 2 };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await run(argv);
    if (result.text) process.stdout.write(`${result.text}\n`);
    if (argvWantsJson(argv) && result.value) process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.code || 'FINAL_MUSIC_ERROR'}: ${error.message}\n`);
    return 1;
  }
}

function argvWantsJson(argv) { return argv.includes('--json'); }

module.exports = { COMMANDS, parseArgs, usage, run, main, renderStatus, renderList };

if (require.main === module) main().then((code) => { process.exitCode = code; });
