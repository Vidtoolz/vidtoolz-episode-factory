#!/usr/bin/env node
'use strict';

/*
 * final-assets — the operator entry point for Final Asset Production.
 *
 * The whole workflow reduced to: read a prompt, generate the asset by hand,
 * hand the file over, accept or reject, continue.
 *
 *   final-assets next          --run-id <run>
 *   final-assets prompt        --run-id <run> --beat <beat>
 *   final-assets ingest-image  --run-id <run> --beat <beat> --file <path>
 *   final-assets select-image  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
 *   final-assets reject        --run-id <run> --beat <beat> --candidate <sha|id> --authority "..." [--note "..."]
 *   final-assets alternate     --run-id <run> --beat <beat> --candidate <sha|id> --authority "..."
 *   final-assets set-role      --run-id <run> --beat <beat> --role <FINAL_STILL_CANDIDATE|FINAL_VIDEO_SOURCE_CANDIDATE> --authority "..."
 *   final-assets kling-prompt  --run-id <run> --beat <beat>
 *   final-assets ingest-video  --run-id <run> --beat <beat> --file <path>
 *   final-assets select-video  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
 *   final-assets queue         --run-id <run>
 *   final-assets progress      --run-id <run>
 *   final-assets project       --run-id <run>
 *
 * The caller gives a run, a beat and a file. Hashes, asset identity, prompt
 * authority, provenance, beat binding, state transitions and I2V gating are
 * all resolved here. Nothing in this tool calls GPT Image or Kling, and no
 * creative choice is ever made automatically.
 *
 * Human-readable output by default; --json for the full machine record.
 */

const path = require('node:path');

const directed = require('./directed-draft-assembly-handoff.js');
const production = require('./final-asset-production.js');

const COMMANDS = Object.freeze(['next', 'prompt', 'ingest-image', 'select-image', 'reject', 'alternate',
  'set-role', 'kling-prompt', 'ingest-video', 'select-video', 'queue', 'progress', 'project', 'help']);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function parseArgs(argv) {
  const out = { command: argv[0], repo: path.resolve(__dirname, '..'), json: false };
  if (!COMMANDS.includes(out.command)) fail('FINAL_ASSETS_COMMAND_INVALID', `${String(out.command)} (expected one of ${COMMANDS.join(', ')})`);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') { out.json = true; continue; }
    if (token === '--run-id') { out.runId = argv[++index]; continue; }
    if (token === '--repo') { out.repo = path.resolve(argv[++index]); continue; }
    if (token === '--beat') { out.beat = argv[++index]; continue; }
    if (token === '--file') { out.file = argv[++index]; continue; }
    if (token === '--candidate') { out.candidate = argv[++index]; continue; }
    if (token === '--authority') { out.authority = argv[++index]; continue; }
    if (token === '--note') { out.note = argv[++index]; continue; }
    if (token === '--role') { out.role = argv[++index]; continue; }
    fail('FINAL_ASSETS_ARGUMENT_INVALID', token);
  }
  if (out.command !== 'help' && !out.runId) fail('FINAL_ASSETS_ARGUMENT_INVALID', '--run-id is required');
  const needsBeat = ['prompt', 'ingest-image', 'select-image', 'reject', 'alternate', 'set-role', 'kling-prompt', 'ingest-video', 'select-video'];
  if (needsBeat.includes(out.command) && !out.beat) fail('FINAL_ASSETS_ARGUMENT_INVALID', `${out.command} requires --beat`);
  if (['ingest-image', 'ingest-video'].includes(out.command) && !out.file) fail('FINAL_ASSETS_ARGUMENT_INVALID', `${out.command} requires --file`);
  if (['select-image', 'select-video', 'reject', 'alternate'].includes(out.command) && !out.candidate) fail('FINAL_ASSETS_ARGUMENT_INVALID', `${out.command} requires --candidate`);
  if (out.command === 'set-role' && !out.role) fail('FINAL_ASSETS_ARGUMENT_INVALID', 'set-role requires --role');
  return out;
}

function usage() {
  return `final-assets — Final Asset Production (manual generation, canonical bookkeeping)

  next          --run-id <run>                        what to do next, with the prompt to copy
  prompt        --run-id <run> --beat <beat>          the exact final image prompt for one beat
  ingest-image  --run-id <run> --beat <beat> --file <path>
  select-image  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
  reject        --run-id <run> --beat <beat> --candidate <sha|id> --authority "..." [--note "..."]
  alternate     --run-id <run> --beat <beat> --candidate <sha|id> --authority "..."
  set-role      --run-id <run> --beat <beat> --role <FINAL_STILL_CANDIDATE|FINAL_VIDEO_SOURCE_CANDIDATE> --authority "..."
  kling-prompt  --run-id <run> --beat <beat>          image-bound Kling prompt (needs a selected image)
  ingest-video  --run-id <run> --beat <beat> --file <path>
  select-video  --run-id <run> --beat <beat> --candidate <sha|id> --authority "Mikko Pakkala"
  queue         --run-id <run>                        the whole work queue
  progress      --run-id <run>                        production progress counts
  project       --run-id <run>                        project selected assets into the Resolve blueprint

Add --json for the full machine record. Image and clip generation are manual by
design: this tool never calls GPT Image or Kling, and never picks for you.
`;
}

/* ── human-readable rendering ────────────────────────────────────────────── */

function rule(width = 74) { return '─'.repeat(width); }
function renderBriefing(briefing) {
  const lines = [];
  const beat = briefing.beat;
  lines.push(rule(), `BEAT ${beat.final_beat_id}   ${beat.purpose}   [${beat.visual_role}, ${Math.round(beat.duration_ms / 100) / 10}s]`, rule());
  lines.push(`section       ${beat.section_id}`);
  lines.push(`role          ${briefing.role.effective}${briefing.role.human_override ? ' (human override)' : ' (recommended)'}`);
  lines.push(`state         ${briefing.state}`);
  lines.push(`geometry      ${briefing.geometry.width}x${briefing.geometry.height} (${briefing.geometry.aspect_ratio})`);
  lines.push(`script line   ${JSON.stringify(beat.locked_script_line.slice(0, 96))}${beat.locked_script_line.length > 96 ? '…' : ''}`);
  if (briefing.infographic) {
    lines.push('', 'INFOGRAPHIC — render EXACTLY and ONLY this text:');
    for (const text of briefing.infographic.exact_allowed_text) lines.push(`  • ${text}`);
    lines.push(`hierarchy     ${briefing.infographic.hierarchy}`);
    lines.push(`typography    ${briefing.infographic.typography_constraints}`);
  }
  lines.push('', `PROMPT (${briefing.prompt_id}) — copy everything between the markers:`, rule());
  lines.push(briefing.prompt);
  lines.push(rule());
  lines.push('', 'notes:');
  for (const note of briefing.production_notes) lines.push(`  - ${note}`);
  lines.push('', `candidates    images ${briefing.candidates.images}, videos ${briefing.candidates.videos}, rejected ${briefing.candidates.rejected}`);
  lines.push(`NEXT          ${briefing.next_human_action}`);
  return lines.join('\n');
}
function renderNext(result) {
  if (result.complete) return `All final visual assets are selected.\n${result.next_action}`;
  const lines = [`NEXT TASK: ${result.task}  (beat ${result.final_beat_id}, ${result.completed}/${result.total} beats complete, ${result.remaining} outstanding)`, '', result.next_action, ''];
  if (result.task === 'GENERATE_IMAGE') lines.push(renderBriefing(result.briefing));
  return lines.join('\n');
}
function renderQueue(q) {
  const lines = [`FINAL ASSET PRODUCTION — ${q.run_id}`, ''];
  const p = q.progress;
  lines.push(`progress   ${p.final_complete}/${p.total_beats} complete   |   prompt-ready ${p.prompt_ready}  generated ${p.generated}  image-selected ${p.image_selected}  video-generated ${p.video_generated}  blocked ${p.blocked}`);
  lines.push('');
  lines.push('BEAT              STATE                 ROLE                          CANDIDATES        NEXT');
  for (const row of q.beats) {
    const role = row.role === 'FINAL_VIDEO_SOURCE_CANDIDATE' ? 'VIDEO_SOURCE' : 'STILL';
    lines.push([
      row.final_beat_id.padEnd(18),
      row.state.padEnd(22),
      `${role}${row.role_overridden ? '*' : ''}`.padEnd(30),
      `img ${row.image_candidates_live}/${row.image_candidates} vid ${row.video_candidates_live}/${row.video_candidates}`.padEnd(18),
      row.task ? row.task.task : 'complete',
    ].join(''));
  }
  lines.push('', `current beat  ${q.current_beat || 'none'}`);
  lines.push(`ready now     ${q.ready.length}   waiting on your decision  ${q.waiting_on_mikko_decision.length}   waiting on your manual generation  ${q.waiting_on_manual_generation.length}`);
  return lines.join('\n');
}
function renderMotion(m) {
  return [
    rule(), `KLING PROMPT — beat ${m.beat.final_beat_id}  (prompt v${m.prompt_version})`, rule(),
    `source image   ${m.source_image.path}`,
    `image sha256   ${m.source_image.sha256}`,
    `dimensions     ${m.source_image.width}x${m.source_image.height}`,
    `duration       ${m.intended_duration_ms} ms`,
    `camera         ${m.camera_and_motion.camera_behavior}`,
    `motion         ${m.camera_and_motion.intended_motion}`,
    '', 'PROMPT — copy everything between the markers:', rule(), m.prompt, rule(),
    '', 'do not allow:', ...m.negative_constraints.map((c) => `  - ${c}`),
    '', `state          ${m.state}`, `NEXT           ${m.next_human_action}`,
  ].join('\n');
}

/* ── dispatch ────────────────────────────────────────────────────────────── */

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help') return { text: usage(), value: null, exitCode: 0 };
  const runDir = directed.resolveRunDir(args.repo, args.runId);
  const opts = { authority: args.authority, note: args.note };

  if (args.command === 'next') {
    const value = production.nextAction(runDir);
    return { text: renderNext(value), value, exitCode: 0 };
  }
  if (args.command === 'prompt') {
    const ctx = production.context(runDir);
    const value = production.beatBriefing(ctx, args.beat);
    return { text: renderBriefing(value), value, exitCode: 0 };
  }
  if (args.command === 'ingest-image') {
    const value = production.ingestImage(runDir, args.beat, args.file, opts);
    const warn = (value.warnings || []).map((w) => `\n  warning: ${w}`).join('');
    const text = value.state === 'ALREADY_REGISTERED'
      ? `ALREADY_REGISTERED — these exact bytes are already a candidate for ${args.beat} (${value.asset.asset_id}). Nothing changed.`
      : `INGESTED ${value.asset.asset_id}\n  beat        ${args.beat}\n  sha256      ${value.asset.media.sha256}\n  dimensions  ${value.asset.media.width}x${value.asset.media.height} (${value.asset.media.codec})\n  state       ${value.beat_state}  — GENERATED is NOT selected${warn}\n\nNext: final-assets select-image --run-id ${args.runId} --beat ${args.beat} --candidate ${value.asset.media.sha256.slice(0, 12)} --authority "Mikko Pakkala"`;
    return { text, value, exitCode: 0 };
  }
  if (args.command === 'select-image') {
    const value = production.selectImage(runDir, args.beat, args.candidate, opts);
    const lines = [`SELECTED image for ${args.beat}: ${value.selected.asset_id}`, `  state       ${value.state}`];
    if (value.reselection) {
      lines.push('  re-selection: the previous image is historical; its Kling prompt and clips are stale and must be regenerated from the new image');
      for (const item of value.staled) lines.push(`    staled ${item.kind} ${String(item.digest_sha256).slice(0, 16)} — ${item.reason}`);
    }
    lines.push(value.state === 'FINAL_ASSET_SELECTED'
      ? '  this still beat is now complete'
      : `\nNext: final-assets kling-prompt --run-id ${args.runId} --beat ${args.beat}`);
    return { text: lines.join('\n'), value, exitCode: 0 };
  }
  if (args.command === 'reject') {
    const kind = /\.(mp4|mov|webm|mkv)$/i.test(String(args.candidate)) ? 'VIDEO' : (args.role === 'VIDEO' ? 'VIDEO' : 'IMAGE');
    let value;
    try { value = production.rejectCandidate(runDir, args.beat, args.candidate, 'IMAGE', opts); }
    catch (error) {
      if (error.code !== 'FINAL_ASSET_CANDIDATE_UNKNOWN') throw error;
      value = production.rejectCandidate(runDir, args.beat, args.candidate, 'VIDEO', opts);
    }
    return { text: `REJECTED ${value.rejected.asset_id} (preserved as history, can never become current)\n  beat state  ${value.state}`, value, exitCode: 0 };
  }
  if (args.command === 'alternate') {
    let value;
    try { value = production.keepAsAlternate(runDir, args.beat, args.candidate, 'IMAGE', opts); }
    catch (error) {
      if (error.code !== 'FINAL_ASSET_CANDIDATE_UNKNOWN') throw error;
      value = production.keepAsAlternate(runDir, args.beat, args.candidate, 'VIDEO', opts);
    }
    return { text: `KEPT AS ALTERNATE ${value.alternate.asset_id}\n  beat state  ${value.state}`, value, exitCode: 0 };
  }
  if (args.command === 'set-role') {
    const value = production.setRole(runDir, args.beat, args.role, opts);
    return { text: `ROLE ${value.role_before} -> ${value.role_after} for ${args.beat}\n  state       ${value.state}`, value, exitCode: 0 };
  }
  if (args.command === 'kling-prompt') {
    production.prepareMotionPrompt(runDir, args.beat, opts);
    const value = production.motionBriefing(runDir, args.beat, opts);
    return { text: renderMotion(value), value, exitCode: 0 };
  }
  if (args.command === 'ingest-video') {
    const value = production.ingestVideo(runDir, args.beat, args.file, opts);
    const warn = (value.warnings || []).map((w) => `\n  warning: ${w}`).join('');
    const text = value.state === 'ALREADY_REGISTERED'
      ? `ALREADY_REGISTERED — these exact bytes are already a clip candidate for ${args.beat} (${value.asset.asset_id}). Nothing changed.`
      : `INGESTED ${value.asset.asset_id}\n  beat        ${args.beat}\n  sha256      ${value.asset.media.sha256}\n  duration    ${value.asset.media.duration_ms} ms  ${value.asset.media.width}x${value.asset.media.height}\n  source img  ${value.asset.source_image.sha256.slice(0, 16)}\n  state       ${value.beat_state}  — VIDEO_GENERATED is NOT selected${warn}\n\nNext: final-assets select-video --run-id ${args.runId} --beat ${args.beat} --candidate ${value.asset.media.sha256.slice(0, 12)} --authority "Mikko Pakkala"`;
    return { text, value, exitCode: 0 };
  }
  if (args.command === 'select-video') {
    const value = production.selectVideo(runDir, args.beat, args.candidate, opts);
    return { text: `SELECTED final clip for ${args.beat}: ${value.selected.asset_id}\n  state       ${value.state}\n  provenance  source image ${value.final_asset.provenance.source_image_sha256.slice(0, 16)}, motion prompt ${value.final_asset.provenance.motion_prompt_digest_sha256.slice(0, 16)}`, value, exitCode: 0 };
  }
  if (args.command === 'queue') {
    const value = production.workQueue(runDir);
    return { text: renderQueue(value), value, exitCode: 0 };
  }
  if (args.command === 'progress') {
    const value = production.workQueue(runDir).progress;
    const text = Object.entries(value).map(([key, count]) => `  ${key.padEnd(28)} ${count}`).join('\n');
    return { text: `FINAL ASSET PRODUCTION PROGRESS\n${text}`, value, exitCode: 0 };
  }
  const projected = production.projectResolveAssets(runDir);
  return {
    text: `RESOLVE ASSET PROJECTION written (${projected.projection.resolved_beats} resolved, ${projected.projection.placeholder_beats} still placeholders)\n  ${projected.path}\n  blueprint mutated: ${projected.projection.blueprint_mutated}`,
    value: projected.projection, exitCode: 0,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await run(argv);
    process.stdout.write(`${result.json ?? false ? '' : ''}`);
    const args = (() => { try { return parseArgs(argv); } catch (_) { return { json: false }; } })();
    process.stdout.write(args.json ? `${JSON.stringify(result.value, null, 2)}\n` : `${result.text}\n`);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.code || 'FINAL_ASSETS_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = { COMMANDS, parseArgs, usage, run, main, renderBriefing, renderQueue, renderMotion, renderNext };

if (require.main === module) main().then((code) => { process.exitCode = code; });
