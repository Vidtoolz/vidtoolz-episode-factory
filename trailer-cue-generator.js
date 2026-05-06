(function trailerCueGenerator(globalScope) {
  "use strict";

  const CUES_DIR = "trailer-cues";
  const TRAILER_SECONDS = 120;
  const TICKS_PER_BEAT = 480;
  const MIDI_CHANNELS = {
    motif: 0,
    drone: 1,
    pulse: 2,
    riser: 3,
    climaxHits: 4,
    finalSting: 5,
  };

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function slugify(value) {
    const slug = cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "untitled-trailer-cue";
  }

  function dateString(date = new Date()) {
    if (typeof date === "string") return date.slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  function buildCueFolderName(title, date = new Date()) {
    return `${dateString(date)}-${slugify(title)}`;
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatTimecode(seconds, fps = 24) {
    const safeSeconds = 3600 + Math.max(0, seconds);
    const whole = Math.floor(safeSeconds);
    const frames = Math.round((safeSeconds - whole) * fps);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }

  function buildSectionMap() {
    return [
      {
        id: "cold-open",
        name: "Cold open",
        start: 0,
        end: 12,
        purpose: "Immediate stakes and sonic identity.",
        musicalDirection: "Sparse motif, low air, no full pulse yet.",
      },
      {
        id: "problem",
        name: "Problem",
        start: 12,
        end: 28,
        purpose: "Clarify the pain or obstacle.",
        musicalDirection: "Drone enters, motif fragments answer the edit.",
      },
      {
        id: "discovery",
        name: "Discovery",
        start: 28,
        end: 44,
        purpose: "First useful turn or reveal.",
        musicalDirection: "Pulse begins with restraint, riser remains hidden.",
      },
      {
        id: "build",
        name: "Build",
        start: 44,
        end: 64,
        purpose: "Momentum and practical proof.",
        musicalDirection: "Pulse thickens, motif climbs by sequence.",
      },
      {
        id: "proof",
        name: "Proof",
        start: 64,
        end: 84,
        purpose: "Show that the promise works.",
        musicalDirection: "More kinetic pulse, harmonic lift, riser bed starts.",
      },
      {
        id: "climax",
        name: "Climax",
        start: 84,
        end: 104,
        purpose: "Largest trailer impact and payoff.",
        musicalDirection: "Full pulse, rising line, spaced impact hits.",
      },
      {
        id: "payoff",
        name: "Payoff",
        start: 104,
        end: 116,
        purpose: "Resolve the promise and leave room for voice or title.",
        musicalDirection: "Pulse releases, motif returns wider and slower.",
      },
      {
        id: "sting",
        name: "Final sting",
        start: 116,
        end: 120,
        purpose: "End card, logo, or hard stop.",
        musicalDirection: "Single final gesture with tail space.",
      },
    ];
  }

  function buildTempoMap() {
    return [
      { start: 0, bpm: 72, feel: "half-time pulse, open space" },
      { start: 12, bpm: 84, feel: "low tension, measured edits" },
      { start: 28, bpm: 96, feel: "first visible forward motion" },
      { start: 44, bpm: 108, feel: "steady build" },
      { start: 64, bpm: 120, feel: "proof section drive" },
      { start: 84, bpm: 132, feel: "climax acceleration" },
      { start: 104, bpm: 112, feel: "payoff release" },
      { start: 116, bpm: 72, feel: "final sting space" },
    ];
  }

  function tempoAtSecond(seconds, tempoMap = buildTempoMap()) {
    let current = tempoMap[0];
    tempoMap.forEach((item) => {
      if (item.start <= seconds) current = item;
    });
    return current;
  }

  function secondsToTicks(seconds, tempoMap = buildTempoMap()) {
    const target = Math.max(0, seconds);
    const sorted = [...tempoMap].sort((a, b) => a.start - b.start);
    let ticks = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const nextStart = index + 1 < sorted.length ? sorted[index + 1].start : target;
      if (target <= current.start) break;
      const segmentEnd = Math.min(target, nextStart);
      if (segmentEnd > current.start) {
        ticks += ((segmentEnd - current.start) * current.bpm * TICKS_PER_BEAT) / 60;
      }
      if (target <= nextStart) break;
    }
    return Math.round(ticks);
  }

  function buildSectionMapMarkdown(title) {
    const heading = cleanString(title) || "Untitled trailer cue";
    const lines = [
      `# Trailer Cue Section Map: ${heading}`,
      "",
      "- Length: 02:00",
      "- Structure: deterministic VIDTOOLZ v1 trailer arc",
      "- Audio generation: none",
      "- DAW or plugin control: none",
      "",
      "| Start | End | Section | Purpose | Musical direction |",
      "| --- | --- | --- | --- | --- |",
    ];
    buildSectionMap().forEach((section) => {
      lines.push(`| ${formatTime(section.start)} | ${formatTime(section.end)} | ${section.name} | ${section.purpose} | ${section.musicalDirection} |`);
    });
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  function buildTempoMapMarkdown() {
    const lines = [
      "# Trailer Cue Tempo Map",
      "",
      "| Start | BPM | Feel |",
      "| --- | ---: | --- |",
    ];
    buildTempoMap().forEach((tempo) => {
      lines.push(`| ${formatTime(tempo.start)} | ${tempo.bpm} | ${tempo.feel} |`);
    });
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  function csvEscape(value) {
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildResolveMarkerCsv() {
    const rows = [["Marker Name", "Description", "Start Timecode", "Duration", "Color"]];
    buildSectionMap().forEach((section) => {
      rows.push([
        section.name,
        section.purpose,
        formatTimecode(section.start),
        formatTime(section.end - section.start),
        section.id === "climax" || section.id === "sting" ? "Red" : "Blue",
      ]);
    });
    return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
  }

  function buildPatchRecommendationsMarkdown(title) {
    const heading = cleanString(title) || "Untitled trailer cue";
    return `# Trailer Cue Patch Recommendations: ${heading}

These are patch choices for later sound design. They are recommendations only; this generator does not load plugins, control a DAW, or render audio.

## Motif

- Short pluck, felt piano, muted bell, or soft synth key.
- Keep attack readable and decay short enough for edit points.
- Use one dry lead version and one wider duplicate only after 01:04.

## Drone

- Low sustained analog pad, bowed texture, or processed room tone.
- Filter should open gradually from 00:12 to 01:44.
- Keep sub energy controlled so narration remains usable.

## Pulse

- Low-mid synth pulse, muted bass ostinato, or percussive tick stack.
- Start narrow at 00:28, add octave or transient layer at 00:44, full drive at 01:04.
- Sidechain or manual ducking should leave space for dialogue.

## Riser

- Noise swell, reversed cymbal, tonal gliss, or filtered synth rise.
- Main long riser begins at 01:04 and crests into 01:44.
- Avoid white-noise dominance; use pitch motion for shape.

## Climax Hits

- Layered low boom, mid punch, and short bright transient.
- Hits should support edit cuts at 01:24, 01:32, 01:40, and 01:44.
- Leave at least one beat of tail space after the last climax hit.

## Final Sting

- One concise logo-safe hit with optional tonal fifth.
- Target 01:56 to 02:00, with no busy rhythm under an end card.
`;
  }

  function buildRenderChecklistMarkdown(title) {
    const heading = cleanString(title) || "Untitled trailer cue";
    return `# Trailer Cue Render Checklist: ${heading}

## Before Import

- [ ] Review section-map.md against the trailer edit.
- [ ] Import resolve-markers.csv into Resolve or recreate markers manually.
- [ ] Confirm the project starts at 01:00:00:00 if using the provided timecodes.
- [ ] Import MIDI files into separate tracks: motif, drone, pulse, riser, climax hits, final sting.

## Composition Pass

- [ ] Assign patches from patch-recommendations.md.
- [ ] Check that motif does not mask voiceover.
- [ ] Keep drone and pulse low enough for edit dialogue.
- [ ] Confirm riser energy crests into the climax instead of peaking early.
- [ ] Keep the final sting short and logo-safe.

## Render Pass

- [ ] Bounce audio only after human review.
- [ ] Watch the full 02:00 trailer against the cue.
- [ ] Check loudness, clipping, tails, and marker alignment.
- [ ] Export stems only after the full mix is approved.
`;
  }

  function buildTestNotesMarkdown(title) {
    const heading = cleanString(title) || "Untitled trailer cue";
    return `# Trailer Cue Test Notes: ${heading}

Use this file during a manual real-world validation pass. Do not connect this generator to a DAW, plugin host, Resolve, Fairlight, or any external API.

## Test Context

- Tester:
- Test date:
- DAW:
- Resolve version:
- Trailer edit/project:
- Cue folder:

## Musical Usability

- Overall usability for a 2-minute trailer:
- Strongest MIDI stem:
- Weakest MIDI stem:
- Motif clarity:
- Pulse usefulness:
- Drone usefulness:
- Riser usefulness:
- Climax hit usefulness:
- Notes to change:

## Patch Choices

| Stem | Instrument | Patch | Notes |
| --- | --- | --- | --- |
| Motif | Omnisphere / UVI / Arturia / other |  |  |
| Drone | Omnisphere / UVI / Arturia / other |  |  |
| Pulse | Omnisphere / UVI / Arturia / other |  |  |
| Riser | Omnisphere / UVI / Arturia / other |  |  |
| Climax hits | Omnisphere / UVI / Arturia / other |  |  |
| Final sting | Omnisphere / UVI / Arturia / other |  |  |

## Section Timing

- Cold open timing:
- Problem timing:
- Discovery timing:
- Build timing:
- Proof timing:
- Climax timing:
- Payoff timing:
- Final sting timing:
- Sections that need earlier entry:
- Sections that need later entry:

## Resolve Marker Usefulness

- Marker import/recreation result:
- Marker timecode alignment:
- Marker names useful:
- Marker colors useful:
- Missing markers:
- Markers to rename:

## Rendered Stem Check

- Motif rendered:
- Drone rendered:
- Pulse rendered:
- Riser rendered:
- Climax hits rendered:
- Final sting rendered:
- Stem timing after render:
- Noise, clipping, or tail issues:

## Fairlight Assembly Check

- Stems line up against Resolve edit:
- Dialogue/music balance notes:
- Edit points supported:
- Cue feels too busy:
- Cue feels too thin:
- Mix or arrangement changes:

## Final Sting Strength

- Strength from 1-5:
- Works under end card/logo:
- Tail length:
- Needs more impact:
- Needs less impact:
- Final note:
`;
  }

  function buildNotesForPart(part) {
    const notes = {
      motif: [
        [0, 0.5, 60, 74],
        [2, 0.5, 63, 68],
        [4, 0.75, 67, 72],
        [8, 0.5, 60, 70],
        [28, 0.5, 62, 72],
        [32, 0.5, 65, 72],
        [36, 0.75, 69, 78],
        [44, 0.5, 67, 82],
        [48, 0.5, 70, 78],
        [52, 0.75, 74, 84],
        [104, 1.0, 72, 78],
        [110, 1.0, 67, 72],
      ],
      drone: [
        [12, 16, 36, 48],
        [28, 16, 39, 50],
        [44, 20, 41, 54],
        [64, 20, 43, 58],
        [84, 20, 48, 62],
        [104, 12, 43, 52],
      ],
      pulse: [],
      riser: [
        [64, 20, 55, 42],
        [76, 8, 59, 52],
        [84, 12, 62, 66],
        [96, 8, 67, 78],
      ],
      climaxHits: [
        [84, 0.5, 36, 110],
        [92, 0.5, 36, 112],
        [100, 0.75, 38, 116],
        [104, 1.0, 31, 120],
      ],
      finalSting: [
        [116, 1.25, 36, 116],
        [116, 1.25, 48, 100],
        [116.5, 2.5, 55, 84],
      ],
    };

    for (let second = 28; second < 104; second += 2) {
      const velocity = second < 64 ? 62 : second < 84 ? 76 : 92;
      notes.pulse.push([second, 0.25, second < 64 ? 48 : 43, velocity]);
      notes.pulse.push([second + 1, 0.25, 55, Math.max(52, velocity - 12)]);
    }

    return notes[part] || [];
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
    let buffer = value & 0x7f;
    const bytes = [];
    let remaining = value >> 7;
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

  function buildMidiFile(part) {
    const tempoMap = buildTempoMap();
    const channel = MIDI_CHANNELS[part] === undefined ? 0 : MIDI_CHANNELS[part];
    const events = [];

    buildTempoMap().forEach((tempo) => {
      const micros = Math.round(60000000 / tempo.bpm);
      events.push(eventAt(secondsToTicks(tempo.start, tempoMap), [0xff, 0x51, 0x03, ...uint32(micros).slice(1)]));
    });
    events.push(eventAt(0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]));
    events.push(eventAt(0, [0xff, 0x03, part.length, ...bytesFromString(part)]));
    events.push(eventAt(0, [0xc0 | channel, 88]));

    buildNotesForPart(part).forEach(([start, duration, pitch, velocity]) => {
      const startTick = secondsToTicks(start, tempoMap);
      const endTick = secondsToTicks(Math.min(TRAILER_SECONDS, start + duration), tempoMap);
      events.push(eventAt(startTick, [0x90 | channel, pitch, velocity]));
      events.push(eventAt(Math.max(startTick + 1, endTick), [0x80 | channel, pitch, 0]));
    });

    events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
    const track = [];
    let previousTick = 0;
    events.forEach((event) => {
      track.push(...variableLength(event.tick - previousTick), ...event.bytes);
      previousTick = event.tick;
    });
    track.push(...variableLength(0), 0xff, 0x2f, 0x00);

    const header = [...bytesFromString("MThd"), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(TICKS_PER_BEAT)];
    const trackHeader = [...bytesFromString("MTrk"), ...uint32(track.length)];
    return Buffer.from([...header, ...trackHeader, ...track]);
  }

  function buildCueArtifacts(title) {
    const midiParts = ["motif", "drone", "pulse", "riser", "climaxHits", "finalSting"];
    const artifacts = {
      "section-map.md": buildSectionMapMarkdown(title),
      "tempo-map.md": buildTempoMapMarkdown(),
      "resolve-markers.csv": buildResolveMarkerCsv(),
      "patch-recommendations.md": buildPatchRecommendationsMarkdown(title),
      "render-checklist.md": buildRenderChecklistMarkdown(title),
      "test-notes.md": buildTestNotesMarkdown(title),
    };
    midiParts.forEach((part) => {
      const filename = `${part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.mid`;
      artifacts[filename] = buildMidiFile(part);
    });
    return artifacts;
  }

  const api = {
    CUES_DIR,
    TRAILER_SECONDS,
    TICKS_PER_BEAT,
    slugify,
    buildCueFolderName,
    buildSectionMap,
    buildTempoMap,
    tempoAtSecond,
    secondsToTicks,
    buildSectionMapMarkdown,
    buildTempoMapMarkdown,
    buildResolveMarkerCsv,
    buildPatchRecommendationsMarkdown,
    buildRenderChecklistMarkdown,
    buildTestNotesMarkdown,
    buildNotesForPart,
    buildMidiFile,
    buildCueArtifacts,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.TrailerCueGenerator = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
