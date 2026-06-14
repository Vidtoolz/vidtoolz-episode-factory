(function musicCueGenerator(globalScope) {
  "use strict";

  const os = require("node:os");
  const path = require("node:path");

  const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), "vidtoolz-music-cue-output");
  const SUPPORTED_CUES = ["VT_CalmThinkingBed_01"];
  const VERSION = "0.1.0";
  const TICKS_PER_BEAT = 480;
  const TEMPO_BPM = 72;
  const BEAT_SECONDS = 60 / TEMPO_BPM;
  const TRACK_CHANNELS = {
    "01_PAD_MAIN": 0,
    "02_LOW_PULSE": 1,
    "03_SOFT_BASS": 2,
    "04_GRAIN_SHIMMER": 3,
  };

  const CUE_DEFINITION = {
    cue_name: "VT_CalmThinkingBed_01",
    duration_seconds: 60,
    tempo_bpm: TEMPO_BPM,
    meter: "4/4",
    mode: "D Dorian",
    harmonic_center: "D",
    anchor_sentence: "This cue sounds like a thoughtful person working through a serious problem quietly.",
    intended_use: "60-second narration-support background cue for serious practical VIDTOOLZ creator videos.",
  };

  const MIDI_NOTES = {
    "01_PAD_MAIN": [
      { notes: ["D3", "A3", "D4", "F4"], startBeat: 0, durationBeats: 16, velocity: 48 },
      { notes: ["D3", "A3", "D4", "B4"], startBeat: 16, durationBeats: 16, velocity: 46 },
      { notes: ["D3", "A3", "D4", "F4"], startBeat: 32, durationBeats: 4, velocity: 44 },
      { notes: ["D3", "A3", "D4", "B4"], startBeat: 36, durationBeats: 16, velocity: 46 },
      { notes: ["D3", "A3", "D4", "F4"], startBeat: 52, durationBeats: 8, velocity: 44 },
      { notes: ["D3", "A3", "D4"], startBeat: 60, durationBeats: 12, velocity: 42 },
    ],
    "02_LOW_PULSE": [
      { notes: ["D2"], startBeat: 18, durationBeats: 1.5, velocity: 34 },
      { notes: ["D2"], startBeat: 20, durationBeats: 1, velocity: 32 },
      { notes: ["D2"], startBeat: 26, durationBeats: 1, velocity: 30 },
      { notes: ["D2"], startBeat: 28, durationBeats: 1.5, velocity: 32 },
      { notes: ["D2"], startBeat: 35, durationBeats: 0.75, velocity: 28 },
      { notes: ["D2"], startBeat: 36, durationBeats: 1, velocity: 32 },
      { notes: ["D2"], startBeat: 42, durationBeats: 1, velocity: 30 },
      { notes: ["D2"], startBeat: 44, durationBeats: 1.5, velocity: 32 },
      { notes: ["D2"], startBeat: 51, durationBeats: 0.75, velocity: 28 },
      { notes: ["D2"], startBeat: 52, durationBeats: 1, velocity: 30 },
      { notes: ["D2"], startBeat: 58, durationBeats: 1, velocity: 26 },
    ],
    "03_SOFT_BASS": [
      { notes: ["D1"], startBeat: 0, durationBeats: 16, velocity: 38 },
      { notes: ["D1"], startBeat: 16, durationBeats: 16, velocity: 36 },
      { notes: ["A1"], startBeat: 32, durationBeats: 4, velocity: 28 },
      { notes: ["D1"], startBeat: 36, durationBeats: 16, velocity: 36 },
      { notes: ["D1"], startBeat: 52, durationBeats: 8, velocity: 34 },
      { notes: ["D1"], startBeat: 60, durationBeats: 12, velocity: 32 },
    ],
    "04_GRAIN_SHIMMER": [
      { notes: ["A4"], startBeat: 42, durationBeats: 1, velocity: 24 },
      { notes: ["D5"], startBeat: 44, durationBeats: 0.75, velocity: 22 },
      { notes: ["B4"], startBeat: 48, durationBeats: 1, velocity: 20 },
      { notes: ["A5"], startBeat: 52, durationBeats: 0.5, velocity: 20 },
      { notes: ["D5"], startBeat: 56, durationBeats: 1, velocity: 18 },
      { notes: ["B4"], startBeat: 60, durationBeats: 0.5, velocity: 14 },
    ],
  };

  const TRACKS = [
    {
      name: "01_PAD_MAIN",
      filename: "midi/01_PAD_MAIN.mid",
      role: "Continuous D-centered pad atmosphere.",
      register: "D3 to B4",
      instrument_category: "Ableton, UVI, or Arturia soft analog pad / evolving pad.",
      avoid: ["lead melody", "busy rhythm", "dramatic chord progression", "bright attack"],
    },
    {
      name: "02_LOW_PULSE",
      filename: "midi/02_LOW_PULSE.mid",
      role: "Sparse D2 breathing pulse that adds movement without becoming a beat.",
      register: "D2",
      instrument_category: "Filtered low synth pulse, soft muted synth, or breathy low texture.",
      avoid: ["drum transient", "dance pulse", "eighth-note pattern", "strong downbeat emphasis"],
    },
    {
      name: "03_SOFT_BASS",
      filename: "midi/03_SOFT_BASS.mid",
      role: "Low weight and D harmonic center, not a bassline.",
      register: "D1 to A1",
      instrument_category: "Soft sub, low sine/triangle, muted bass pad, or restrained synth bass.",
      avoid: ["bassline", "rhythmic riff", "audible attack", "mix-dominating sub"],
    },
    {
      name: "04_GRAIN_SHIMMER",
      filename: "midi/04_GRAIN_SHIMMER.mid",
      role: "Sparse upper D/A/B texture for a restrained register lift.",
      register: "A4 to A5",
      instrument_category: "Granular shimmer, soft harmonic pad, quiet glass texture, or airy digital layer.",
      avoid: ["melody", "hook", "sparkly arpeggio", "speech-competing brightness"],
    },
  ];

  function isSupportedCue(cueName) {
    return SUPPORTED_CUES.includes(String(cueName || "").trim());
  }

  function roundSeconds(value) {
    return Math.round(value * 1000) / 1000;
  }

  function noteNameToMidi(noteName) {
    const match = /^([A-G])(#|b)?(-?\d+)$/.exec(noteName);
    if (!match) throw new Error(`Invalid note name: ${noteName}`);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
    const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    const octave = Number(match[3]);
    return (octave + 1) * 12 + base + accidental;
  }

  function beatPosition(startBeat) {
    return {
      bar: Math.floor(startBeat / 4) + 1,
      beat: (startBeat % 4) + 1,
    };
  }

  function expandNoteRows(trackName) {
    const rows = [];
    (MIDI_NOTES[trackName] || []).forEach((event) => {
      event.notes.forEach((noteName) => {
        const position = beatPosition(event.startBeat);
        rows.push({
          note_name: noteName,
          midi_note_number: noteNameToMidi(noteName),
          bar: position.bar,
          beat: position.beat,
          start_seconds: roundSeconds(event.startBeat * BEAT_SECONDS),
          duration_beats: event.durationBeats,
          duration_seconds: roundSeconds(event.durationBeats * BEAT_SECONDS),
          velocity: event.velocity,
        });
      });
    });
    return rows;
  }

  function buildMidiContentSchema() {
    return Object.fromEntries(TRACKS.map((track) => [track.name, expandNoteRows(track.name)]));
  }

  function buildArrangement(generatedAt = new Date().toISOString()) {
    return {
      ...CUE_DEFINITION,
      version: VERSION,
      generated_at: generatedAt,
      tracks: TRACKS.map((track) => ({ ...track })),
      midi_content_schema: buildMidiContentSchema(),
      arrangement_sections: [
        { start_seconds: 0, end_seconds: 15, label: "pad only" },
        { start_seconds: 15, end_seconds: 35, label: "add low pulse quietly" },
        { start_seconds: 35, end_seconds: 50, label: "add shimmer/register lift" },
        { start_seconds: 50, end_seconds: 60, label: "remove pulse / fade texture / resolve to D" },
      ],
      loop_points: [
        {
          label: "0-30s loop candidate",
          start_seconds: 0,
          end_seconds: 30,
          bars: "1-9",
          notes: "Stable D-centered first half. Pulse enters at 15.0s, with no stinger or one-time transition.",
        },
        {
          label: "30-60s loop candidate",
          start_seconds: 30,
          end_seconds: 60,
          bars: "10-18",
          notes: "Second half returns to simple D atmosphere by the end so the loop boundary is usable.",
        },
      ],
      export_targets: [
        "VT_CalmThinkingBed_01_60s_FullMix.wav",
        "VT_CalmThinkingBed_01_60s_PadOnly.wav",
        "VT_CalmThinkingBed_01_60s_NoPulse.wav",
      ],
      ableton_import_notes: [
        "Create four MIDI tracks named exactly 01_PAD_MAIN, 02_LOW_PULSE, 03_SOFT_BASS, and 04_GRAIN_SHIMMER.",
        "Drag each MIDI file from the midi/ folder into the matching Ableton track.",
        "Set the Ableton project tempo to 72 BPM and meter to 4/4 before import.",
        "Use restrained Ableton, UVI, or Arturia instruments manually; the MIDI does not choose presets.",
        "Keep all attacks soft and all parts low enough to sit under narration.",
      ],
      evaluation_questions: [
        "Does narration become more focused and credible with the cue underneath?",
        "Does the music avoid attracting attention to itself?",
        "Does the low pulse feel like breathing movement rather than a beat?",
        "Does the shimmer stay textural and avoid competing with speech?",
        "Can the cue loop or be cut at 0-30s and 30-60s without obvious damage?",
        "Does the cue avoid sounding cinematic, corporate, dramatic, or overproduced?",
        "Does it make the video clearer, not merely more musical?",
      ],
      warnings: [
        "This generator creates MIDI skeletons only, not finished music.",
        "No audio is generated and no DAW, plugin, or Resolve project is controlled.",
        "Do not treat the cue as approved until Mikko tests it under real VIDTOOLZ narration.",
        "Avoid adding trailer hits, risers, drums, lead melodies, or corporate stock-music gestures in the first pass.",
        "Do not write exports into canonical PRESTO or VIDNAS music library paths without explicit approval.",
      ],
    };
  }

  function bytesFromString(text) {
    return Array.from(Buffer.from(text, "ascii"));
  }

  function uint16(value) {
    return [(value >> 8) & 0xff, value & 0xff];
  }

  function uint32(value) {
    return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }

  function variableLength(value) {
    let buffer = Math.max(0, Math.round(value)) & 0x7f;
    const bytes = [];
    let remaining = Math.max(0, Math.round(value)) >> 7;
    while (remaining > 0) {
      buffer <<= 8;
      buffer |= (remaining & 0x7f) | 0x80;
      remaining >>= 7;
    }
    while (true) {
      bytes.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    return bytes;
  }

  function eventAt(tick, bytes) {
    return { tick, bytes };
  }

  function buildMidiFile(trackName) {
    const channel = TRACK_CHANNELS[trackName] === undefined ? 0 : TRACK_CHANNELS[trackName];
    const events = [];
    const micros = Math.round(60000000 / TEMPO_BPM);
    events.push(eventAt(0, [0xff, 0x51, 0x03, ...uint32(micros).slice(1)]));
    events.push(eventAt(0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]));
    events.push(eventAt(0, [0xff, 0x03, trackName.length, ...bytesFromString(trackName)]));
    events.push(eventAt(0, [0xc0 | channel, 88]));
    expandNoteRows(trackName).forEach((row) => {
      const startTick = Math.round(((row.start_seconds / BEAT_SECONDS) * TICKS_PER_BEAT));
      const endTick = startTick + Math.max(1, Math.round(row.duration_beats * TICKS_PER_BEAT));
      events.push(eventAt(startTick, [0x90 | channel, row.midi_note_number, row.velocity]));
      events.push(eventAt(endTick, [0x80 | channel, row.midi_note_number, 0]));
    });
    events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
    const track = [];
    let previousTick = 0;
    events.forEach((event) => {
      track.push(...variableLength(event.tick - previousTick), ...event.bytes);
      previousTick = event.tick;
    });
    const cueEndTick = CUE_DEFINITION.duration_seconds / BEAT_SECONDS * TICKS_PER_BEAT;
    if (previousTick < cueEndTick) {
      track.push(...variableLength(cueEndTick - previousTick), 0xff, 0x01, 0x00);
    }
    track.push(...variableLength(0), 0xff, 0x2f, 0x00);
    const header = [...bytesFromString("MThd"), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(TICKS_PER_BEAT)];
    const trackHeader = [...bytesFromString("MTrk"), ...uint32(track.length)];
    return Buffer.from([...header, ...trackHeader, ...track]);
  }

  function buildReadmeMarkdown() {
    return `# VT_CalmThinkingBed_01

This is a 60-second narration-support MIDI cue skeleton for serious practical VIDTOOLZ creator videos.

It is for calm, focused, investigative support under speech. It is not trailer music, corporate stock music, a finished song, a stinger, or a rendered audio cue.

## Use

1. Open Ableton manually.
2. Set the project to 72 BPM and 4/4.
3. Create four MIDI tracks with the names in ableton-track-map.md.
4. Drag each file from midi/ into the matching track.
5. Assign Ableton, UVI, or Arturia instruments manually.
6. Play it under real VIDTOOLZ narration before reusing it.

Do not overwork the first pass. Keep attacks soft, movement restrained, and narration clearly in front.
`;
  }

  function buildAbletonTrackMapMarkdown() {
    return `# Ableton Track Map

| Track | Suggested instrument category | Register | Role | Avoid |
| --- | --- | --- | --- | --- |
| 01_PAD_MAIN | Soft analog pad, evolving pad, restrained UVI/Arturia pad | D3-B4 | D-centered atmosphere for the full cue | Melody, bright attack, dramatic chord motion |
| 02_LOW_PULSE | Filtered low synth pulse or breathy low texture | D2 | Quiet movement from 15.0s to before 50.0s | Drums, dance pulse, sharp transient |
| 03_SOFT_BASS | Soft sub, muted synth bass, low pad | D1-A1 | Low D weight without a bassline | Rhythmic bassline, strong attack |
| 04_GRAIN_SHIMMER | Granular shimmer, quiet glass texture, airy digital layer | A4-A5 | Sparse upper texture around 35-50s | Hook, melody, bright arpeggio |

## Manual Setup

- Set Ableton to 72 BPM and 4/4.
- Import each MIDI file into the matching named track.
- Choose sounds manually; this generator does not select presets.
- Keep all tracks below narration priority.
- Test in Resolve under real VIDTOOLZ voiceover before keeping the cue.
`;
  }

  function buildRenderChecklistMarkdown() {
    return `# Render Checklist: VT_CalmThinkingBed_01

The MIDI generator creates an editable skeleton only. It does not create finished music.

## Format

- WAV
- 48 kHz
- 24-bit or 32-bit float

## First-Pass Exports

- [ ] VT_CalmThinkingBed_01_60s_FullMix.wav
- [ ] VT_CalmThinkingBed_01_60s_PadOnly.wav
- [ ] VT_CalmThinkingBed_01_60s_NoPulse.wav

PulseOnly is not required until the cue passes Resolve testing.

## Checks

- [ ] Test under real VIDTOOLZ narration in Resolve.
- [ ] Confirm the pulse does not feel like a beat.
- [ ] Confirm shimmer does not compete with speech.
- [ ] Confirm the cue can loop or be cut without obvious damage.
- [ ] Confirm Mikko approves the cue after playback before reuse.
`;
  }

  function buildEvaluationChecklistMarkdown() {
    return `# Evaluation Checklist: VT_CalmThinkingBed_01

The cue passes only if:

- [ ] Narration becomes more focused and credible.
- [ ] Music does not attract attention.
- [ ] Pulse does not feel like a beat.
- [ ] Texture does not compete with speech.
- [ ] Cue can loop or be cut without obvious damage.
- [ ] It does not sound cinematic, corporate, dramatic, or overproduced.
- [ ] It makes the video clearer, not merely more musical.

Do not approve this cue from MIDI inspection alone. Test it under real VIDTOOLZ narration.
`;
  }

  function buildArtifacts(generatedAt) {
    const arrangement = buildArrangement(generatedAt);
    const artifacts = {
      "README.md": buildReadmeMarkdown(),
      "arrangement.json": `${JSON.stringify(arrangement, null, 2)}\n`,
      "ableton-track-map.md": buildAbletonTrackMapMarkdown(),
      "render-checklist.md": buildRenderChecklistMarkdown(),
      "evaluation-checklist.md": buildEvaluationChecklistMarkdown(),
    };
    TRACKS.forEach((track) => {
      artifacts[track.filename] = buildMidiFile(track.name);
    });
    return artifacts;
  }

  function expectedFiles() {
    return [
      "README.md",
      "arrangement.json",
      "ableton-track-map.md",
      "render-checklist.md",
      "evaluation-checklist.md",
      ...TRACKS.map((track) => track.filename),
    ];
  }

  function validateArrangementPayload(payload) {
    const errors = [];
    const required = [
      "cue_name",
      "version",
      "generated_at",
      "duration_seconds",
      "tempo_bpm",
      "meter",
      "mode",
      "harmonic_center",
      "anchor_sentence",
      "intended_use",
      "tracks",
      "midi_content_schema",
      "arrangement_sections",
      "loop_points",
      "export_targets",
      "ableton_import_notes",
      "evaluation_questions",
      "warnings",
    ];
    required.forEach((key) => {
      if (!Object.hasOwn(payload, key)) errors.push(`missing arrangement field: ${key}`);
    });
    if (payload.cue_name !== CUE_DEFINITION.cue_name) errors.push("cue_name mismatch");
    if (payload.duration_seconds !== 60) errors.push("duration_seconds must be 60");
    if (payload.tempo_bpm !== 72) errors.push("tempo_bpm must be 72");
    if (!Array.isArray(payload.tracks) || payload.tracks.length !== 4) errors.push("tracks must contain four entries");
    TRACKS.forEach((track) => {
      const rows = payload.midi_content_schema && payload.midi_content_schema[track.name];
      if (!Array.isArray(rows) || rows.length === 0) {
        errors.push(`midi_content_schema.${track.name} must contain note rows`);
        return;
      }
      rows.forEach((row, index) => {
        [
          "note_name",
          "midi_note_number",
          "bar",
          "beat",
          "start_seconds",
          "duration_beats",
          "duration_seconds",
          "velocity",
        ].forEach((key) => {
          if (!Object.hasOwn(row, key)) errors.push(`${track.name}[${index}] missing ${key}`);
        });
      });
    });
    ["ableton_import_notes", "evaluation_questions", "warnings"].forEach((key) => {
      if (!Array.isArray(payload[key]) || payload[key].length === 0) errors.push(`${key} must be populated`);
    });
    const lowPulseRows = payload.midi_content_schema && payload.midi_content_schema["02_LOW_PULSE"];
    if (Array.isArray(lowPulseRows) && lowPulseRows[0]) {
      if (lowPulseRows[0].start_seconds !== 15 || lowPulseRows[0].bar !== 5 || lowPulseRows[0].beat !== 3) {
        errors.push("02_LOW_PULSE first note must start at 15.0s / beat 3 of bar 5");
      }
    }
    return errors;
  }

  const api = {
    DEFAULT_OUTPUT_DIR,
    SUPPORTED_CUES,
    VERSION,
    TICKS_PER_BEAT,
    TRACKS,
    isSupportedCue,
    noteNameToMidi,
    beatPosition,
    expandNoteRows,
    buildMidiContentSchema,
    buildArrangement,
    buildMidiFile,
    buildArtifacts,
    expectedFiles,
    validateArrangementPayload,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.MusicCueGenerator = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
