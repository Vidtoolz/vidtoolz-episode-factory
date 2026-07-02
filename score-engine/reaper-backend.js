// VIDTOOLZ Score Engine — REAPER backend (Phase 1 DAW target, §9).
// Generates a plain-text .RPP project with one track per lane, one MIDI item per
// (lane × cue) with events embedded, cue markers, tempo, colors, and conservative
// volume defaults — plus a README and a render helper note. The .RPP format is
// plain text and deterministic, so it is structurally testable in CI without
// REAPER installed. Actual in-REAPER rendering is operator-driven (documented).
"use strict";

const path = require("node:path");
const { PPQ } = require("./midi-writer.js");

const LANE_TRACKS = [
  { lane: "pulse", name: "01 Pulse", color: [63, 185, 80], volume: 0.85, pan: -0.15 },
  { lane: "bass", name: "02 Bass", color: [88, 166, 255], volume: 0.9, pan: 0 },
  { lane: "harmony", name: "03 Harmony Pad", color: [210, 153, 34], volume: 0.7, pan: 0.1 },
  { lane: "melody", name: "04 Melody Motif", color: [248, 81, 73], volume: 0.8, pan: -0.1 },
  { lane: "texture", name: "05 Texture", color: [163, 113, 247], volume: 0.6, pan: 0.3 },
  { lane: "impact", name: "06 Impacts", color: [240, 246, 252], volume: 0.9, pan: 0 },
];

function reaperColor([r, g, b]) { return 0x01000000 | (b << 16) | (g << 8) | r; }
function hex(value) { return value.toString(16).padStart(2, "0"); }
function quote(text) { return `"${String(text).replace(/"/g, "'")}"`; }

// Build embedded-MIDI item source lines for the notes of one lane within one cue.
// Event ticks are item-relative; REAPER "E" lines are: E <delta> <status> <d1> <d2>.
function midiSourceLines(notes, cueStartTick) {
  const events = [];
  for (const n of notes) {
    events.push({ tick: n.tick - cueStartTick, bytes: ["90", hex(Math.min(127, Math.max(0, Math.round(n.note)))), hex(Math.min(127, Math.max(1, Math.round(n.velocity))))] });
    events.push({ tick: n.tick - cueStartTick + n.dur_ticks, bytes: ["80", hex(Math.min(127, Math.max(0, Math.round(n.note)))), "00"] });
  }
  events.sort((a, b) => a.tick - b.tick);
  const lines = [];
  let last = 0;
  for (const event of events) {
    const delta = Math.max(0, Math.round(event.tick - last));
    lines.push(`E ${delta} ${event.bytes.join(" ")}`);
    last = Math.round(event.tick);
  }
  lines.push("E 0 b0 7b 00"); // all notes off
  return lines;
}

// composition: output of composer.compose(); cues: cue sheet cues.
function buildRppText({ projectName, cues, composition, sampleRate = 48000 }) {
  const firstTempo = cues[0] ? cues[0].tempo_bpm : 90;
  const lines = [];
  lines.push(`<REAPER_PROJECT 0.1 "7.0/vidtoolz-score-engine" 0`);
  lines.push(`  TEMPO ${firstTempo} 4 4`);
  lines.push(`  SAMPLERATE ${sampleRate} 0 0`);
  lines.push(`  TITLE ${quote(projectName)}`);
  cues.forEach((cue, i) => {
    lines.push(`  MARKER ${i + 1} ${cue.start_seconds} ${quote(`${cue.cue_id} ${cue.name}`)} 0`);
  });

  // Cue start ticks mirror composer's accumulation (per-cue tempo aware).
  const cueStartTicks = [];
  let tick = 0;
  for (const cue of cues) {
    cueStartTicks.push(tick);
    tick += Math.round(((cue.end_seconds - cue.start_seconds) / (60 / cue.tempo_bpm)) * PPQ);
  }

  for (const track of LANE_TRACKS) {
    const laneNotes = composition.notes.filter((n) => n.lane === track.lane);
    lines.push("  <TRACK");
    lines.push(`    NAME ${quote(track.name)}`);
    lines.push(`    PEAKCOL ${reaperColor(track.color)}`);
    lines.push(`    VOLPAN ${track.volume} ${track.pan} -1 -1 1`);
    lines.push("    MAINSEND 1 0");
    cues.forEach((cue, cueIndex) => {
      const cueNotes = laneNotes.filter((n) => n.seconds >= cue.start_seconds - 1e-6 && n.seconds < cue.end_seconds);
      if (!cueNotes.length) return;
      lines.push("    <ITEM");
      lines.push(`      POSITION ${cue.start_seconds}`);
      lines.push(`      LENGTH ${Math.round((cue.end_seconds - cue.start_seconds) * 1000) / 1000}`);
      lines.push(`      NAME ${quote(`${cue.cue_id} ${track.lane}`)}`);
      lines.push("      <SOURCE MIDI");
      lines.push(`        HASDATA 1 ${PPQ} QN`);
      for (const line of midiSourceLines(cueNotes, cueStartTicks[cueIndex])) lines.push(`        ${line}`);
      lines.push("      >");
      lines.push("    >");
    });
    lines.push("  >");
  }
  lines.push(">");
  return lines.join("\n") + "\n";
}

function buildReaperReadme({ projectName, cues, musicPlan, settings = {} }) {
  const roleLines = LANE_TRACKS.map((track) => {
    const role = musicPlan && musicPlan.roles ? musicPlan.roles[track.lane === "harmony" ? "harmony" : track.lane] : null;
    const hint = role ? `${role.profile_display_name}${role.preset_hint ? ` — ${role.preset_hint}` : ""}` : "operator's choice";
    return `| ${track.name} | ${track.lane} | ${hint} |`;
  });
  return `# REAPER handoff — ${projectName}

Open \`project.rpp\` in REAPER (double-click, or File → Open project).
Every track already contains the generated MIDI items and cue markers.

## What to do
1. Put an instrument on each track (FX button). Suggested owned-tool patch per track:

| Track | Role | Suggested instrument |
|---|---|---|
${roleLines.join("\n")}

2. Tracks use conservative volume/pan defaults — mix to taste.
3. Cue markers: ${cues.map((c) => `${c.cue_id} @ ${c.start_seconds}s`).join(" · ")}
4. Render the stereo mix: File → Render… (48 kHz WAV suggested). For stems,
   render with "Stems (selected tracks)" after selecting all six lane tracks.
5. Multi-tempo note: the project grid uses the first cue's tempo
   (${cues[0] ? cues[0].tempo_bpm : "?"} BPM). Item positions are time-locked in
   seconds, so audio timing is correct even if later cues declare other tempos;
   the standalone \`.mid\` files in \`../midi/\` carry the full tempo map.

${settings.reaper_track_template_folder ? `Track templates folder configured: ${settings.reaper_track_template_folder}\nApply your templates (right-click TCP → Insert track from template) to replace the empty tracks.` : "Tip: save your favorite instrument setups once as REAPER track templates, then point Score Engine settings at the template folder."}

Generated by VIDTOOLZ Score Engine. This file is regenerated on every REAPER
build — do not hand-edit it; edit the .rpp copy you open instead.
`;
}

// Command spec to open the project in REAPER — spawn is done by the caller so
// this stays pure/testable. Returns null when no executable is configured.
function openInReaperCommand(settings, rppPath) {
  const exe = String(settings.reaper_executable_path || "").trim();
  if (!exe) return null;
  return { command: exe, args: [rppPath] };
}

module.exports = { buildRppText, buildReaperReadme, openInReaperCommand, LANE_TRACKS, midiSourceLines };
