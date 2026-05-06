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
  const SUPPORTED_PRESETS = ["dark-fairytale-trailer"];

  const DARK_FAIRYTALE_SECTIONS = [
    {
      id: "forest-whisper",
      name: "Forest whisper",
      start: 0,
      end: 12,
      purpose: "Open on the red hood, the path, and the sense that the woods are listening.",
      musicalDirection: "Thin music-box motif, breathy branches, no pulse yet.",
    },
    {
      id: "warning",
      name: "The warning",
      start: 12,
      end: 28,
      purpose: "The rule is stated: stay on the path, do not trust the forest.",
      musicalDirection: "Low wolf drone enters under a fragile two-note answer.",
    },
    {
      id: "temptation",
      name: "Off the path",
      start: 28,
      end: 44,
      purpose: "Curiosity pulls Red away from safety and toward the darker story.",
      musicalDirection: "Uneven twig pulse begins, leaving gaps for glances and cuts.",
    },
    {
      id: "wolf-reveal",
      name: "Wolf reveal",
      start: 44,
      end: 64,
      purpose: "The predator becomes present without fully showing its hand.",
      musicalDirection: "Pulse tightens, motif drops lower, reversed-bow riser appears.",
    },
    {
      id: "grandmothers-house",
      name: "Grandmother's house",
      start: 64,
      end: 84,
      purpose: "The safe place feels wrong and the familiar becomes threatening.",
      musicalDirection: "Clockwork pulse, cold choir pad, nursery motif in minor shape.",
    },
    {
      id: "teeth",
      name: "Teeth in the dark",
      start: 84,
      end: 104,
      purpose: "The trailer reaches the chase, the transformation, and the largest danger.",
      musicalDirection: "Dense heartbeat pulse, wolf impacts, high string scrape riser.",
    },
    {
      id: "red-turns",
      name: "Red turns",
      start: 104,
      end: 116,
      purpose: "Red stops being prey and the story turns toward survival or revenge.",
      musicalDirection: "Pulse falls away, motif returns stronger in low octaves.",
    },
    {
      id: "blood-moon-sting",
      name: "Blood moon sting",
      start: 116,
      end: 120,
      purpose: "End card or title hit: fairy tale innocence has become threat.",
      musicalDirection: "Single brutal low hit, bent fifth, short tail into silence.",
    },
  ];

  const DARK_FAIRYTALE_TEMPO_MAP = [
    { start: 0, bpm: 68, feel: "music-box rubato, bare-footstep space" },
    { start: 12, bpm: 78, feel: "cautious warning under low wolf breath" },
    { start: 28, bpm: 92, feel: "uneven twig pulse, still restrained" },
    { start: 44, bpm: 104, feel: "stalking motion and close-cut tension" },
    { start: 64, bpm: 116, feel: "clockwork dread inside Grandmother's house" },
    { start: 84, bpm: 138, feel: "dense chase heartbeat and teeth impacts" },
    { start: 104, bpm: 96, feel: "survival turn, pulse release, darker resolve" },
    { start: 116, bpm: 68, feel: "blood moon sting with silence after impact" },
  ];

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizePresetId(value) {
    return cleanString(value);
  }

  function isSupportedPreset(value) {
    const preset = normalizePresetId(value);
    return preset ? SUPPORTED_PRESETS.includes(preset) : true;
  }

  function presetLabel(value) {
    return normalizePresetId(value) || "default";
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

  function buildSectionMap(options = {}) {
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return DARK_FAIRYTALE_SECTIONS.map((section) => ({ ...section }));
    }
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

  function buildTempoMap(options = {}) {
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return DARK_FAIRYTALE_TEMPO_MAP.map((tempo) => ({ ...tempo }));
    }
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

  function buildSectionMapMarkdown(title, options = {}) {
    const heading = cleanString(title) || "Untitled trailer cue";
    const preset = normalizePresetId(options.preset);
    const lines = [
      `# Trailer Cue Section Map: ${heading}`,
      "",
      "- Length: 02:00",
      preset === "dark-fairytale-trailer"
        ? "- Structure: deterministic Red Riding Hood / dark fairytale trailer arc"
        : "- Structure: deterministic VIDTOOLZ v1 trailer arc",
      `- Preset: ${presetLabel(preset)}`,
      "- Audio generation: none",
      "- DAW or plugin control: none",
      "",
      "| Start | End | Section | Purpose | Musical direction |",
      "| --- | --- | --- | --- | --- |",
    ];
    buildSectionMap(options).forEach((section) => {
      lines.push(`| ${formatTime(section.start)} | ${formatTime(section.end)} | ${section.name} | ${section.purpose} | ${section.musicalDirection} |`);
    });
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  function buildTempoMapMarkdown(options = {}) {
    const preset = normalizePresetId(options.preset);
    const lines = [
      "# Trailer Cue Tempo Map",
      "",
      `- Preset: ${presetLabel(preset)}`,
      "",
      "| Start | BPM | Feel |",
      "| --- | ---: | --- |",
    ];
    buildTempoMap(options).forEach((tempo) => {
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

  function buildResolveMarkerCsv(options = {}) {
    const rows = [["Marker Name", "Description", "Start Timecode", "Duration", "Color"]];
    buildSectionMap(options).forEach((section) => {
      const redMarker = section.id === "climax" || section.id === "sting" || section.id === "teeth" || section.id === "blood-moon-sting";
      rows.push([
        section.name,
        section.purpose,
        formatTimecode(section.start),
        formatTime(section.end - section.start),
        redMarker ? "Red" : "Blue",
      ]);
    });
    return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
  }

  function buildPatchRecommendationsMarkdown(title, options = {}) {
    const heading = cleanString(title) || "Untitled trailer cue";
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return `# Trailer Cue Patch Recommendations: ${heading}

Preset: dark-fairytale-trailer

These are patch choices for later Red Riding Hood / dark fairytale sound design. They are recommendations only; this generator does not load plugins, control a DAW, or render audio.

## Motif

- Broken music box, celeste, toy piano, icy felt piano, or glassy pluck.
- Keep the first notes innocent but slightly detuned or unstable.
- After 01:44, move the motif lower and more confident to show Red turning from prey to threat.

## Drone

- Low wolf breath, dark bowed texture, granular forest air, or distant male choir pad.
- Keep the first drone almost felt rather than heard, then open the filter toward Grandmother's house.
- Avoid clean heroic warmth; the tone should feel wooded, old, and unsafe.

## Pulse

- Twig snaps, muted frame drum, clock tick, low heartbeat, or pizzicato string ostinato.
- Use sparse uneven motion before 00:44, then a denser chase pulse from 01:24.
- Leave holes for whispers, door creaks, breath, and trailer dialogue.

## Riser

- Reversed strings, bowed cymbal, breath swell, wolf howl layer, or pitch-bent harmonics.
- The main rise should feel like the forest closing in, not a generic EDM sweep.
- Push the strongest scrape into 01:24 and 01:44.

## Climax Hits

- Low wolf boom, wood impact, door slam, processed growl, and short metallic tooth transient.
- Hits should support danger beats at 01:24, 01:32, 01:40, and 01:44.
- Keep the biggest hit ugly and short enough for a cut to black.

## Final Sting

- Blood moon title hit: low boom, bent fifth, short choir or bowed tail.
- Target 01:56 to 02:00.
- Avoid a triumphant finish; the ending should feel cursed and unresolved.
`;
    }
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

  function buildRenderChecklistMarkdown(title, options = {}) {
    const heading = cleanString(title) || "Untitled trailer cue";
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return `# Trailer Cue Render Checklist: ${heading}

Preset: dark-fairytale-trailer

## Before Import

- [ ] Review section-map.md against the Red Riding Hood trailer edit.
- [ ] Import resolve-markers.csv into Resolve or recreate the dark fairytale story markers manually.
- [ ] Confirm the project starts at 01:00:00:00 if using the provided timecodes.
- [ ] Import MIDI files into separate tracks: motif, drone, pulse, riser, climax hits, final sting.

## Composition Pass

- [ ] Assign patches from patch-recommendations.md with a dark fairytale palette.
- [ ] Check that the music-box motif reads as Red Riding Hood rather than generic horror.
- [ ] Keep wolf drone and forest pulse low enough for whispers, breath, and dialogue.
- [ ] Confirm the chase density grows into Teeth in the dark instead of peaking too early.
- [ ] Keep the Blood moon sting cursed, short, and title-card safe.

## Render Pass

- [ ] Bounce audio only after human review.
- [ ] Watch the full 02:00 trailer against the cue.
- [ ] Check wolf impacts, forest tails, clipping, dialogue space, and marker alignment.
- [ ] Export stems only after the full mix is approved.
`;
    }
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

  function buildTestNotesMarkdown(title, options = {}) {
    const heading = cleanString(title) || "Untitled trailer cue";
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return `# Trailer Cue Test Notes: ${heading}

Preset: dark-fairytale-trailer

Use this file during a manual Red Riding Hood / dark fairytale validation pass. Do not connect this generator to a DAW, plugin host, Resolve, Fairlight, or any external API.

## Test Context

- Tester:
- Test date:
- DAW:
- Resolve version:
- Trailer edit/project:
- Cue folder:

## Musical Usability

- Overall usability for a 2-minute dark fairytale trailer:
- Does the cue clearly suggest Red Riding Hood:
- Does the cue feel too generic horror:
- Strongest MIDI stem:
- Weakest MIDI stem:
- Music-box motif clarity:
- Wolf drone usefulness:
- Twig/heartbeat pulse usefulness:
- Forest riser usefulness:
- Teeth impact usefulness:
- Notes to change:

## Patch Choices

| Stem | Instrument | Patch | Dark fairytale notes |
| --- | --- | --- | --- |
| Motif | Omnisphere / UVI / Arturia / other |  | Music box, celeste, toy piano, glass, or felt piano |
| Drone | Omnisphere / UVI / Arturia / other |  | Wolf breath, bowed forest, dark choir, or granular air |
| Pulse | Omnisphere / UVI / Arturia / other |  | Twig snap, clock tick, low heartbeat, or pizzicato ostinato |
| Riser | Omnisphere / UVI / Arturia / other |  | Reversed string, breath swell, bowed cymbal, or howl layer |
| Climax hits | Omnisphere / UVI / Arturia / other |  | Wood hit, wolf boom, door slam, growl, or tooth transient |
| Final sting | Omnisphere / UVI / Arturia / other |  | Blood moon boom, bent fifth, cursed choir tail |

## Section Timing

- Forest whisper timing:
- The warning timing:
- Off the path timing:
- Wolf reveal timing:
- Grandmother's house timing:
- Teeth in the dark timing:
- Red turns timing:
- Blood moon sting timing:
- Sections that need earlier entry:
- Sections that need later entry:

## Resolve Marker Usefulness

- Marker import/recreation result:
- Marker timecode alignment:
- Marker labels support the Red Riding Hood story:
- Marker colors useful:
- Missing story markers:
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
- Story turns supported:
- Cue feels too busy:
- Cue feels too thin:
- Mix or arrangement changes:

## Final Sting Strength

- Blood moon sting strength from 1-5:
- Works under end card/logo:
- Tail length:
- Needs more impact:
- Needs less impact:
- Final note:
`;
    }
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

  function buildDarkFairytaleNotesForPart(part) {
    const notes = {
      motif: [
        [0, 0.5, 72, 56],
        [1.5, 0.25, 71, 48],
        [4, 0.5, 67, 58],
        [7.5, 0.75, 63, 52],
        [12, 0.5, 60, 54],
        [24, 0.5, 59, 58],
        [28, 0.25, 72, 60],
        [30, 0.25, 71, 52],
        [36, 0.5, 67, 62],
        [44, 0.5, 55, 66],
        [48, 0.5, 58, 70],
        [56, 0.75, 62, 74],
        [64, 0.5, 67, 70],
        [72, 0.5, 66, 72],
        [104, 1.0, 48, 86],
        [110, 1.0, 43, 78],
      ],
      drone: [
        [0, 12, 36, 34],
        [12, 16, 31, 48],
        [28, 16, 34, 54],
        [44, 20, 29, 60],
        [64, 20, 31, 66],
        [84, 20, 36, 78],
        [104, 12, 29, 58],
      ],
      pulse: [],
      riser: [
        [44, 20, 50, 40],
        [64, 20, 54, 52],
        [76, 8, 57, 64],
        [84, 10, 61, 78],
        [94, 10, 66, 90],
      ],
      climaxHits: [
        [44, 0.25, 38, 86],
        [64, 0.25, 36, 92],
        [84, 0.5, 29, 116],
        [92, 0.5, 31, 118],
        [100, 0.75, 34, 122],
        [104, 1.0, 26, 126],
      ],
      finalSting: [
        [116, 1.25, 24, 126],
        [116, 1.25, 36, 112],
        [116.25, 2.5, 42, 92],
        [116.5, 1.75, 55, 78],
      ],
    };

    for (let second = 28; second < 64; second += 2) {
      notes.pulse.push([second, 0.2, 43, 62]);
      notes.pulse.push([second + 1.25, 0.2, 46, 50]);
    }
    for (let second = 64; second < 84; second += 1.5) {
      notes.pulse.push([second, 0.18, 43, 72]);
      notes.pulse.push([second + 0.75, 0.18, 55, 60]);
    }
    for (let second = 84; second < 104; second += 1) {
      notes.pulse.push([second, 0.16, 36, 92]);
      notes.pulse.push([second + 0.5, 0.12, 48, 76]);
    }

    return notes[part] || [];
  }

  function buildNotesForPart(part, options = {}) {
    if (normalizePresetId(options.preset) === "dark-fairytale-trailer") {
      return buildDarkFairytaleNotesForPart(part);
    }
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

  function buildMidiFile(part, options = {}) {
    const tempoMap = buildTempoMap(options);
    const channel = MIDI_CHANNELS[part] === undefined ? 0 : MIDI_CHANNELS[part];
    const events = [];

    buildTempoMap(options).forEach((tempo) => {
      const micros = Math.round(60000000 / tempo.bpm);
      events.push(eventAt(secondsToTicks(tempo.start, tempoMap), [0xff, 0x51, 0x03, ...uint32(micros).slice(1)]));
    });
    events.push(eventAt(0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]));
    const trackName = normalizePresetId(options.preset) ? `${part}-${normalizePresetId(options.preset)}` : part;
    events.push(eventAt(0, [0xff, 0x03, trackName.length, ...bytesFromString(trackName)]));
    events.push(eventAt(0, [0xc0 | channel, 88]));

    buildNotesForPart(part, options).forEach(([start, duration, pitch, velocity]) => {
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

  function buildCueArtifacts(title, options = {}) {
    const midiParts = ["motif", "drone", "pulse", "riser", "climaxHits", "finalSting"];
    const artifacts = {
      "section-map.md": buildSectionMapMarkdown(title, options),
      "tempo-map.md": buildTempoMapMarkdown(options),
      "resolve-markers.csv": buildResolveMarkerCsv(options),
      "patch-recommendations.md": buildPatchRecommendationsMarkdown(title, options),
      "render-checklist.md": buildRenderChecklistMarkdown(title, options),
      "test-notes.md": buildTestNotesMarkdown(title, options),
    };
    midiParts.forEach((part) => {
      const filename = `${part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.mid`;
      artifacts[filename] = buildMidiFile(part, options);
    });
    return artifacts;
  }

  const api = {
    CUES_DIR,
    TRAILER_SECONDS,
    TICKS_PER_BEAT,
    SUPPORTED_PRESETS,
    normalizePresetId,
    isSupportedPreset,
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
