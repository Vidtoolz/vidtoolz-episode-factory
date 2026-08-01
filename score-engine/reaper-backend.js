// VIDTOOLZ Score Engine — REAPER backend (Phase 1 DAW target, §9).
// Generates a plain-text .RPP project with one track per lane, one MIDI item per
// (lane × cue) with events embedded, cue markers, tempo, colors, and conservative
// volume defaults — plus a README and a render helper note. The .RPP format is
// plain text and deterministic, so it is structurally testable in CI without
// REAPER installed. Actual in-REAPER rendering is operator-driven (documented).
"use strict";

const path = require("node:path");
const { PPQ } = require("./midi-writer.js");
const schemas = require("./score-schemas.js");

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
function rppNumber(value) {
  if (!Number.isFinite(value)) throw new Error("Cannot build REAPER project: timing values must be finite.");
  return String(Object.is(value, -0) ? 0 : value);
}
function encodedTimeSignature(signature) {
  const [numerator, denominator] = String(signature).split("/").map(Number);
  return (denominator << 16) | numerator;
}

function validateComposition(cues, composition) {
  if (!composition || !Array.isArray(composition.notes) || !Array.isArray(composition.markers) || composition.markers.length !== cues.length) {
    throw new Error("Cannot build REAPER project: composition must contain notes and one marker per cue.");
  }
  let previousMarker = -1;
  composition.markers.forEach((marker, index) => {
    if (!marker || !Number.isFinite(marker.tick) || marker.tick < 0 || marker.tick < previousMarker) {
      throw new Error(`Cannot build REAPER project: invalid marker tick for cue ${cues[index].cue_id}.`);
    }
    previousMarker = marker.tick;
  });
  const laneNames = new Set(LANE_TRACKS.map((track) => track.lane));
  for (const note of composition.notes) {
    if (!note || !laneNames.has(note.lane)
      || !Number.isFinite(note.seconds) || !Number.isFinite(note.dur_seconds)
      || !Number.isFinite(note.tick) || !Number.isFinite(note.dur_ticks)
      || note.dur_seconds <= 0 || note.dur_ticks <= 0) {
      throw new Error("Cannot build REAPER project: composition contains a malformed note event.");
    }
    const cueIndex = cues.findIndex((cue) => note.seconds >= cue.start_seconds - 1e-9 && note.seconds < cue.end_seconds - 1e-9);
    if (cueIndex < 0) throw new Error("Cannot build REAPER project: note event is outside every cue.");
    if (note.seconds + note.dur_seconds > cues[cueIndex].end_seconds + 1e-9) {
      throw new Error(`Cannot build REAPER project: note event crosses cue boundary for ${cues[cueIndex].cue_id}.`);
    }
    if (note.tick < composition.markers[cueIndex].tick - 1e-9) {
      throw new Error(`Cannot build REAPER project: note event precedes cue-local source start for ${cues[cueIndex].cue_id}.`);
    }
  }
}

// Build embedded-MIDI item source lines for one lane within one cue. The caller
// supplies the candidate-global tick of the cue marker; subtracting it makes
// every item source cue-local even when the candidate-global MIDI timeline has
// intentional silence gaps. REAPER "E" lines are:
// E <delta> <status> <d1> <d2>.
function midiSourceLines(notes, cueMarkerTick) {
  const events = [];
  for (const n of notes) {
    events.push({ tick: n.tick - cueMarkerTick, bytes: ["90", hex(Math.min(127, Math.max(0, Math.round(n.note)))), hex(Math.min(127, Math.max(1, Math.round(n.velocity))))] });
    events.push({ tick: n.tick - cueMarkerTick + n.dur_ticks, bytes: ["80", hex(Math.min(127, Math.max(0, Math.round(n.note)))), "00"] });
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
// rendersDir (optional): pre-seeds project render settings so File → Render is
// one click — 48 kHz 24-bit stereo WAV, entire project, into rendersDir
// (RENDER_CFG "ZXZhdxgAAA==" = 'evaw' + 24-bit flag, the standard WAV config).
function buildRppText({ projectName, cues, composition, sampleRate = 48000, rendersDir = null }) {
  const cueErrors = schemas.validateCueSheet({ cues });
  if (cueErrors.length) throw new Error(`Cannot build REAPER project: ${cueErrors.join("; ")}`);
  validateComposition(cues, composition);
  const firstTempo = cues[0] ? cues[0].tempo_bpm : 90;
  const [firstNumerator, firstDenominator] = cues[0] ? cues[0].time_signature.split("/").map(Number) : [4, 4];
  const lines = [];
  lines.push(`<REAPER_PROJECT 0.1 "7.0/vidtoolz-score-engine" 0`);
  lines.push(`  TEMPO ${rppNumber(firstTempo)} ${firstNumerator} ${firstDenominator}`);
  lines.push(`  SAMPLERATE ${sampleRate} 0 0`);
  lines.push(`  TITLE ${quote(projectName)}`);
  if (rendersDir) {
    lines.push(`  RENDER_FILE ${quote(rendersDir)}`);
    lines.push(`  RENDER_PATTERN ${quote("scorecraft-mix")}`);
    lines.push("  RENDER_RANGE 1 0 0 18 1000");
    lines.push("  RENDER_STEMS 0");
    lines.push("  RENDER_DITHER 0");
    lines.push("  <RENDER_CFG");
    lines.push("    ZXZhdxgAAA==");
    lines.push("  >");
  }
  cues.forEach((cue, i) => {
    lines.push(`  MARKER ${i + 1} ${rppNumber(cue.start_seconds)} ${quote(`${cue.cue_id} ${cue.name}`)} 0`);
  });
  // Authoritative REAPER timing model:
  // - timeline position/length are video seconds;
  // - each MIDI item source starts at cue-local tick zero;
  // - square tempo points at cue starts govern the cue's musical tick rate;
  // - gaps remain empty project time between items (never leading source ticks).
  lines.push("  <TEMPOENVEX");
  lines.push("    ACT 1 -1");
  lines.push("    VIS 1 0 1");
  lines.push("    LANEHEIGHT 0 0");
  lines.push("    ARM 0");
  lines.push("    DEFSHAPE 1 -1 -1");
  for (const cue of cues) {
    // Shape 1 is square. The encoded signature makes meter changes explicit;
    // Flags 1+4 set the signature/start a measure while permitting a partial
    // preceding measure at arbitrary video-time cuts.
    lines.push(`    PT ${rppNumber(cue.start_seconds)} ${rppNumber(cue.tempo_bpm)} 1 ${encodedTimeSignature(cue.time_signature)} 0 5`);
  }
  lines.push("  >");

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
      lines.push(`      POSITION ${rppNumber(cue.start_seconds)}`);
      lines.push(`      LENGTH ${rppNumber(cue.end_seconds - cue.start_seconds)}`);
      lines.push("      SOFFS 0");
      lines.push(`      NAME ${quote(`${cue.cue_id} ${track.lane}`)}`);
      lines.push("      <SOURCE MIDI");
      lines.push(`        HASDATA 1 ${PPQ} QN`);
      const cueMarkerTick = composition.markers[cueIndex].tick;
      for (const line of midiSourceLines(cueNotes, cueMarkerTick)) lines.push(`        ${line}`);
      lines.push("      >");
      lines.push("    >");
    });
    lines.push("  >");
  }
  lines.push(">");
  return lines.join("\n") + "\n";
}

function buildReaperReadme({ projectName, cues, musicPlan, settings = {}, templates = {}, templateWarnings = [] }) {
  const roleLines = LANE_TRACKS.map((track) => {
    const role = musicPlan && musicPlan.roles ? musicPlan.roles[track.lane === "harmony" ? "harmony" : track.lane] : null;
    const hint = role ? `${role.profile_display_name}${role.preset_hint ? ` — ${role.preset_hint}` : ""}` : "operator's choice";
    const template = templates[track.lane] ? `template: ${templates[track.lane]}` : "plain MIDI track — patch manually";
    return `| ${track.name} | ${track.lane} | ${hint} | ${template} |`;
  });
  return `# REAPER handoff — ${projectName}

**This project is MIDI-only until instruments are patched** (plain \`project.rpp\`)
— or use the template route below to arrive with instruments already loaded.

## Route A — open the plain project
Open \`project.rpp\`. Render settings are pre-seeded (48 kHz / 24-bit stereo
WAV, entire project → \`renders/scorecraft-mix.wav\`), so after patching
instruments, File → Render → Render is all you need. For a guaranteed-safe
one-click render, run \`render-scorecraft-mix.lua\` instead (Actions → Show
action list → New action → Load ReaScript) — it versions the output and never
overwrites.

## Route B — build from your track templates (recommended once set up)
Run \`build-scorecraft-from-templates.lua\` in REAPER. It creates the six role
tracks from your configured .RTrackTemplate files (instruments included),
imports the per-lane MIDI, adds the cue markers, and saves a NEW versioned
project. Roles without a template fall back to plain MIDI tracks.

Template status at generation time:
${Object.keys(templates).length ? Object.entries(templates).map(([lane, p]) => `- ${lane}: ${p}`).join("\n") : "- (none configured — all tracks will be plain MIDI)"}
${templateWarnings.length ? templateWarnings.map((w) => `- ⚠ ${w}`).join("\n") : ""}

To set templates up once: build each role's instrument track in REAPER, save it
via right-click track → Save track as track template, then paste the
.RTrackTemplate path into the matching instrument profile on the Score Engine
page (or set the shared folder in Settings).

## Track / instrument map

| Track | Role | Suggested instrument | Template |
|---|---|---|---|
${roleLines.join("\n")}

## Notes
- Cue markers: ${cues.map((c) => `${c.cue_id} @ ${c.start_seconds}s`).join(" · ")}
- Tracks use conservative volume/pan defaults — mix to taste.
- Stems: select all six lane tracks, File → Render → Source "Stems (selected tracks)".
- Multi-tempo: square tempo markers at every cue start preserve each cue's BPM;
  item positions are time-locked in seconds and intentional gaps remain empty.

Generated by VIDTOOLZ Score Engine. Regenerated on every REAPER build (previous
.rpp versions are kept as .rpp.bak) — edit the copy you open, not this handoff.
`;
}

// Command spec to open the project in REAPER — spawn is done by the caller so
// this stays pure/testable. Returns null when no executable is configured.
function openInReaperCommand(settings, rppPath) {
  const exe = String(settings.reaper_executable_path || "").trim();
  if (!exe) return null;
  return { command: exe, args: [rppPath] };
}

function luaQuote(text) {
  return `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Companion ReaScript: explicit, user-invoked render of the loaded project to
// a versioned WAV (never overwrites). Uses the exact GetSetProjectInfo calls
// proven against real REAPER 7.67 in the 2026-07-02 validation pass.
function buildRenderScript({ rendersDir, durationSeconds, sampleRate = 48000 }) {
  return `-- render-scorecraft-mix.lua — generated by VIDTOOLZ Score Engine.
-- Run inside REAPER with the Scorecraft project open (Actions -> Show action
-- list -> Load ReaScript). Renders the master mix to a versioned WAV; existing
-- files are never overwritten.
local RENDER_DIR = ${luaQuote(rendersDir)}
local DURATION = ${durationSeconds}
local proj = 0
local pattern = "scorecraft-mix"
local function exists(p) local f = io.open(p, "rb") if f then f:close() return true end return false end
if exists(RENDER_DIR .. "/" .. pattern .. ".wav") then
  pattern = pattern .. "-" .. os.date("%Y%m%d-%H%M%S")
end
reaper.GetSetProjectInfo_String(proj, "RENDER_FILE", RENDER_DIR, true)
reaper.GetSetProjectInfo_String(proj, "RENDER_PATTERN", pattern, true)
reaper.GetSetProjectInfo_String(proj, "RENDER_FORMAT", "evaw\\24\\0\\0\\0", true) -- 24-bit WAV
reaper.GetSetProjectInfo(proj, "RENDER_SETTINGS", 0, true)   -- master mix
reaper.GetSetProjectInfo(proj, "RENDER_BOUNDSFLAG", 0, true) -- custom bounds
reaper.GetSetProjectInfo(proj, "RENDER_STARTPOS", 0, true)
reaper.GetSetProjectInfo(proj, "RENDER_ENDPOS", DURATION, true)
reaper.GetSetProjectInfo(proj, "RENDER_SRATE", ${sampleRate}, true)
reaper.GetSetProjectInfo(proj, "RENDER_CHANNELS", 2, true)
reaper.Main_OnCommand(41824, 0) -- render using these settings, no dialog
reaper.ShowConsoleMsg("Scorecraft render done: " .. RENDER_DIR .. "/" .. pattern .. ".wav\\n")
-- (headless validation harnesses terminate REAPER externally; os.exit is not available in ReaScript)
`;
}

// Companion ReaScript: build a NEW project from Mikko's own REAPER track
// templates (one per role), import the per-lane MIDI, add cue markers, and
// save next to the handoff — versioned, never overwriting. Roles without a
// configured/existing template fall back to plain named MIDI tracks and are
// listed in the on-screen report. This is the repeatable-patching workflow:
// make six good track templates once, point Score Engine at them, and every
// future handoff arrives with instruments already loaded.
// Notes are embedded directly and written via CreateNewMIDIItemInProject +
// MIDI_InsertNote — deliberately NOT InsertMedia(.mid), whose multi-track
// import prompt blocks unattended runs (found in real-REAPER validation).
function buildTemplateScript({ projectName, roles, cues, savePath, tempo }) {
  const roleLines = roles.map((role) => {
    const itemLines = (role.items || []).map((item) => {
      const notes = item.notes.map((n) => `{${n.s},${n.e},${n.n},${n.v}}`).join(",");
      return `      { s = ${item.start}, e = ${item.end}, notes = {${notes}} },`;
    });
    return `  { lane = ${luaQuote(role.lane)}, name = ${luaQuote(role.name)}, template = ${role.template ? luaQuote(role.template) : "nil"},\n    items = {\n${itemLines.join("\n")}\n    } },`;
  });
  const markerLines = cues.map((c, i) => `  { pos = ${c.start_seconds}, name = ${luaQuote(`${c.cue_id} ${c.name}`)}, idx = ${i + 1} },`);
  const tempoLines = cues.map((c) => {
    const [numerator, denominator] = String(c.time_signature || "4/4").split("/").map(Number);
    return `  { pos = ${c.start_seconds}, bpm = ${c.tempo_bpm}, num = ${numerator}, den = ${denominator} },`;
  });
  return `-- build-scorecraft-from-templates.lua — generated by VIDTOOLZ Score Engine.
-- Run inside REAPER (new/empty project is fine). Creates one track per role
-- from your configured .RTrackTemplate files (falling back to plain MIDI
-- tracks), writes the cue MIDI items directly, adds cue markers, and saves a
-- NEW project file (versioned; nothing is overwritten).
local ROLES = {
${roleLines.join("\n")}
}
local MARKERS = {
${markerLines.join("\n")}
}
local TEMPO_MARKERS = {
${tempoLines.join("\n")}
}
local SAVE_PATH = ${luaQuote(savePath)}
local TEMPO = ${tempo}
local proj = 0
local report = {}
local function exists(p) if not p then return false end local f = io.open(p, "rb") if f then f:close() return true end return false end

reaper.Main_OnCommand(40859, 0) -- new project tab (keeps any open project untouched)
reaper.SetCurrentBPM(0, TEMPO, false)
for _, marker in ipairs(TEMPO_MARKERS) do
  -- Keep Scorecraft's authoritative video-time position. REAPER's
  -- GetSetTempoTimeSigMarkerFlag "new measure" flags quantize fractional cue
  -- boundaries to musical measure starts; SetTempoTimeSigMarker already stores
  -- the requested tempo and signature without that destructive adjustment.
  reaper.SetTempoTimeSigMarker(proj, -1, marker.pos, -1, -1, marker.bpm, marker.num, marker.den, false)
end

for i, role in ipairs(ROLES) do
  reaper.InsertTrackAtIndex(i - 1, true)
  local track = reaper.GetTrack(0, i - 1)
  if exists(role.template) then
    local f = io.open(role.template, "rb")
    local chunk = f:read("*a")
    f:close()
    reaper.SetTrackStateChunk(track, chunk, false)
    report[#report + 1] = role.name .. ": template " .. role.template
  else
    if role.template then
      report[#report + 1] = role.name .. ": TEMPLATE MISSING (" .. role.template .. ") -- plain MIDI track, patch manually"
    else
      report[#report + 1] = role.name .. ": no template configured -- plain MIDI track, patch manually"
    end
  end
  reaper.GetSetMediaTrackInfo_String(track, "P_NAME", role.name, true)
  for _, item in ipairs(role.items) do
    local mediaItem = reaper.CreateNewMIDIItemInProj(track, item.s, item.e, false)
    local take = reaper.GetActiveTake(mediaItem)
    if take then
      for _, note in ipairs(item.notes) do
        local startPpq = reaper.MIDI_GetPPQPosFromProjTime(take, note[1])
        local endPpq = reaper.MIDI_GetPPQPosFromProjTime(take, note[2])
        reaper.MIDI_InsertNote(take, false, false, startPpq, endPpq, 0, note[3], note[4], true)
      end
      reaper.MIDI_Sort(take)
    end
  end
end

for _, m in ipairs(MARKERS) do
  reaper.AddProjectMarker(proj, false, m.pos, 0, m.name, m.idx)
end

local savePath = SAVE_PATH
if exists(savePath) then
  savePath = savePath:gsub("%.rpp$", "") .. "-" .. os.date("%Y%m%d-%H%M%S") .. ".rpp"
end
reaper.Main_SaveProjectEx(proj, savePath, 0)
reaper.ShowConsoleMsg("Scorecraft template build saved: " .. savePath .. "\\n" .. table.concat(report, "\\n") .. "\\n")
-- (headless validation harnesses terminate REAPER externally; os.exit is not available in ReaScript)
`;
}

module.exports = { buildRppText, buildReaperReadme, buildRenderScript, buildTemplateScript, openInReaperCommand, LANE_TRACKS, midiSourceLines };
