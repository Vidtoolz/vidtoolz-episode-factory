// MusicRenderBrief v1 exporter — Scorecraft cue semantics end HERE.
//
// This module is the ONLY place that interprets Scorecraft cue sheets for
// music-generation purposes. It derives a generator-neutral MusicRenderBrief
// v1 (see MusicRenderBrief-v1.schema.json, frozen) from an approved cue
// sheet: deterministic, explainable, no LLM, no network, no filesystem.
// Downstream adapters (MiniMax today, others later) consume ONLY the brief.
//
// Every derived rule below is deterministic but still encodes an editorial
// assumption; the notable ones are marked EDITORIAL and listed in the task
// report so they can be recalibrated from real production use.
"use strict";

const contract = require("./music-render-brief.js");

// EDITORIAL: emotion valence groups. A change of group is treated as a
// material emotional shift (region-split signal); movement inside one group
// is not. Vocabulary comes from score-schemas CUE_EMOTIONS.
const EMOTION_GROUPS = {
  curious: "calm", warm: "calm", clinical: "calm", playful: "calm", optimistic: "calm",
  tense: "tense", dark: "tense", urgent: "tense",
};

// EDITORIAL: Scorecraft music_role → frozen v1 mix_role. underscore/mixed
// stay underlay (VIDTOOLZ scores are narration-first); transition maps 1:1;
// the moment-carrying roles become feature.
const MIX_ROLE_MAP = {
  underscore: "underlay",
  mixed: "underlay",
  transition: "transition",
  intro: "feature",
  outro: "feature",
  tension: "feature",
  release: "feature",
};

const PURPOSE_BY_MIX_ROLE = {
  underlay: "an underlay serving the narration",
  feature: "a featured score carrying the video's key moments",
  transition: "transition music bridging sections",
};

function briefIdForProject(project) {
  const slug = String(project.project_id || "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}-brief-v1`.replace(/^-+/, "").slice(0, 80);
}

function derivePurpose(project, mixRole) {
  const name = String(project.name || project.project_id || "score project").trim();
  const platform = String(project.target_platform || "generic_video").replace(/_/g, " ");
  const sentence = `Background score for ${name} (${platform}): ${PURPOSE_BY_MIX_ROLE[mixRole]}.`;
  // Frozen bounds: 8-400 chars. Deterministic truncation keeps the sentence shape.
  return sentence.length > 400 ? `${sentence.slice(0, 399)}.` : sentence;
}

function deriveMixRole(project) {
  const mapped = MIX_ROLE_MAP[project.music_role];
  if (!mapped) {
    const e = new Error(`music_role '${project.music_role}' has no MusicRenderBrief mix_role mapping (known: ${Object.keys(MIX_ROLE_MAP).join(", ")})`);
    e.statusCode = 400;
    throw e;
  }
  return mapped;
}

function deriveTempo(project) {
  // Scorecraft's global tempo is a validated finite BPM (40-220); serialize
  // exactly. Scorecraft has no tempo-range or free-tempo project concept, so
  // those schema forms are currently unreachable from live data.
  return String(Math.round(project.global_tempo_bpm));
}

// ── energy curve ────────────────────────────────────────────────────────────
// Deterministic classification of ordered cue energies (integers 1-5) into
// the frozen enum. Rules, in order:
//   1. range <= 1                        → flat (±1 noise is NOT a shape):
//        mean >= 3.5 → flat-high, else flat-low  (EDITORIAL: mid≈3 flats
//        read as restraint for narration scores → flat-low)
//   2. two meaningful peaks (prominence >= 2, separated by a dip >= 2)
//                                        → two-peak
//   3. rise to max >= 2 AND fall after max >= 2 → build-release
//   4. rise to max >= 2 and the score stays up (fall <= 1) → slow-build
//   5. anything else (e.g. decay-only trajectories have no enum) →
//        conservative flat by mean, as rule 1.  (EDITORIAL fallback)
function classifyEnergyCurve(energies) {
  const e = energies.filter((v) => Number.isFinite(v));
  if (!e.length) return "flat-low";
  const max = Math.max(...e);
  const min = Math.min(...e);
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  const flat = () => (mean >= 3.5 ? "flat-high" : "flat-low");
  if (max - min <= 1) return flat();

  // Meaningful peaks: local maxima at max-1 or higher with prominence >= 2,
  // counted as separate only when a dip of >= 2 lies between them.
  const peaks = [];
  for (let i = 0; i < e.length; i += 1) {
    const left = i === 0 ? -Infinity : e[i - 1];
    const right = i === e.length - 1 ? -Infinity : e[i + 1];
    if (e[i] >= left && e[i] >= right && e[i] - min >= 2 && e[i] >= max - 1) peaks.push(i);
  }
  let separatedPeaks = peaks.length ? 1 : 0;
  for (let p = 1; p < peaks.length; p += 1) {
    const between = e.slice(peaks[p - 1] + 1, peaks[p]);
    if (between.length && Math.min(...between) <= Math.min(e[peaks[p - 1]], e[peaks[p]]) - 2) separatedPeaks += 1;
  }
  if (separatedPeaks >= 2) return "two-peak";

  const riseToMax = max - e[0];
  const fallAfterMax = max - e[e.length - 1];
  if (riseToMax >= 2 && fallAfterMax >= 2) return "build-release";
  if (riseToMax >= 2 && fallAfterMax <= 1) return "slow-build";
  return flat();
}

// ── narration density ───────────────────────────────────────────────────────
// dialogue_safe === true means the cue plays UNDER dense narration (the
// planner sets it for dialogue-heavy stretches), so it maps to density
// "high". dialogue_safe === false maps through the project-level
// dialogue_density: low→low, medium→medium, high→medium (EDITORIAL:
// a non-safe cue inside a dialogue-heavy project still has some narration).
function cueNarrationDensity(cue, project) {
  if (cue.dialogue_safe === true) return "high";
  return project.dialogue_density === "low" ? "low" : "medium";
}

function deriveNarrationDensity(cues, project) {
  const spans = [];
  for (const cue of cues) {
    const density = cueNarrationDensity(cue, project);
    const last = spans[spans.length - 1];
    if (last && last.density === density) last.end_s = cue.end_seconds;
    else spans.push({ start_s: cue.start_seconds, end_s: cue.end_seconds, density });
  }
  // Schema cap: deterministically merge the shortest span into its longer
  // neighbour (adopting the neighbour's density) until within limits.
  while (spans.length > contract.LIMITS.narration_max_items) {
    let shortest = 0;
    for (let i = 1; i < spans.length; i += 1) {
      if ((spans[i].end_s - spans[i].start_s) < (spans[shortest].end_s - spans[shortest].start_s)) shortest = i;
    }
    const leftLen = shortest > 0 ? spans[shortest - 1].end_s - spans[shortest - 1].start_s : -1;
    const rightLen = shortest < spans.length - 1 ? spans[shortest + 1].end_s - spans[shortest + 1].start_s : -1;
    const into = rightLen > leftLen ? shortest + 1 : shortest - 1;
    const [a, b] = into > shortest ? [shortest, into] : [into, shortest];
    spans[a] = { start_s: spans[a].start_s, end_s: spans[b].end_s, density: spans[into].density };
    spans.splice(b, 1);
  }
  return spans;
}

// ── emotion curve ───────────────────────────────────────────────────────────
// Ordered cue emotions with adjacent duplicates collapsed. If still over the
// schema cap, deterministic uniform down-selection that always preserves the
// first and last entries (beginning and ending of the arc survive; middle
// turns survive approximately).
function deriveEmotionCurve(cues) {
  const collapsed = [];
  for (const cue of cues) {
    if (collapsed[collapsed.length - 1] !== cue.emotion) collapsed.push(cue.emotion);
  }
  const cap = contract.LIMITS.emotion_curve_max_items;
  if (collapsed.length <= cap) return collapsed;
  const picked = [];
  for (let i = 0; i < cap; i += 1) {
    const index = Math.round((i * (collapsed.length - 1)) / (cap - 1));
    if (picked[picked.length - 1] !== collapsed[index]) picked.push(collapsed[index]);
  }
  return picked;
}

// ── ending ──────────────────────────────────────────────────────────────────
// Deterministic mapping from the terminal cue's function:
//   button → clear-button   (an explicit final button)
//   outro  → fade           (EDITORIAL: Scorecraft outros wind down)
//   anything else → clear-button (EDITORIAL conservative default: a defined
//   ending cuts cleaner under an edit than an unrequested fade).
// "sting" and "loop-ready-tail" have no Scorecraft source representation and
// are currently unreachable from live data (documented, not manufactured).
function deriveEnding(cues) {
  const last = cues[cues.length - 1];
  if (last && last.function === "outro") return "fade";
  return "clear-button";
}

// ── instrumentation ─────────────────────────────────────────────────────────
// Conservative v1: reuse the project's orchestration-profile role characters
// VERBATIM as the allowed palette (they are the repo's own controlled
// vocabulary — no invention), in the stable INSTRUMENT_ROLES order. There is
// no reliable "must be present" or "must avoid" signal in Scorecraft, so
// required and avoid stay empty. Formalizing an instrument vocabulary is an
// acknowledged later task.
function deriveInstrumentation(project, palettes, instrumentRoles) {
  const paletteId = project.assignment_profile_id || project.palette_id;
  const palette = palettes && palettes[paletteId];
  const allowed = [];
  if (palette && palette.roles) {
    for (const role of instrumentRoles) {
      const entry = palette.roles[role];
      if (entry && typeof entry.character === "string" && entry.character) {
        allowed.push(entry.character.slice(0, contract.LIMITS.instrument_item_max));
      }
    }
  }
  return { instrumentation: { required: [], allowed }, avoid: [] };
}

// ── musical regions ─────────────────────────────────────────────────────────
// Cue boundaries are NOT automatically musical boundaries. Adjacent cues
// merge into one region while their musical requirements stay compatible;
// a region boundary opens on a meaningful change:
//   - |energy delta| >= 2            (sustained rise / substantial drop / peak)
//   - dialogue_safe flips            (arrangement-density condition changes)
//   - |density delta| >= 2           (material arrangement change)
//   - emotion valence group changes  (calm <-> tense)
//   - the terminal cue is a button/outro (distinct closing resolution)
// A ±1 energy or density fluctuation alone never splits (noise tolerance).
function boundarySignificance(prev, next) {
  let score = Math.abs((next.energy || 0) - (prev.energy || 0));
  score += Math.abs((next.density || 0) - (prev.density || 0));
  if (Boolean(prev.dialogue_safe) !== Boolean(next.dialogue_safe)) score += 2;
  if (EMOTION_GROUPS[prev.emotion] !== EMOTION_GROUPS[next.emotion]) score += 2;
  if (["button", "outro"].includes(next.function)) score += 3;
  return score;
}

function shouldSplit(prev, next, isTerminal) {
  if (Math.abs((next.energy || 0) - (prev.energy || 0)) >= 2) return true;
  if (Boolean(prev.dialogue_safe) !== Boolean(next.dialogue_safe)) return true;
  if (Math.abs((next.density || 0) - (prev.density || 0)) >= 2) return true;
  if (EMOTION_GROUPS[prev.emotion] !== EMOTION_GROUPS[next.emotion]) return true;
  if (isTerminal && ["button", "outro"].includes(next.function)) return true;
  return false;
}

function regionEnergy(region) {
  return region.cues.reduce((a, c) => a + (c.energy || 0), 0) / region.cues.length;
}

// EDITORIAL naming: names describe musical behaviour, never narrative cue
// functions. Rule order matters and is deterministic.
function nameRegion(region, index, regions, globalMaxEnergy) {
  const energy = regionEnergy(region);
  const prev = index > 0 ? regions[index - 1] : null;
  const isLast = index === regions.length - 1;
  const underNarration = region.cues.every((c) => c.dialogue_safe === true);
  const hasMax = region.cues.some((c) => (c.energy || 0) >= globalMaxEnergy && globalMaxEnergy >= 4);
  if (isLast && region.cues.some((c) => ["button", "outro"].includes(c.function))) return "closing resolution";
  if (hasMax) return "peak intensity";
  if (prev && regionEnergy(prev) - energy >= 1.5) return "post-peak release";
  if (prev && energy - regionEnergy(prev) >= 1) return "tension build";
  if (underNarration && energy <= 2.5) return "restrained under narration";
  if (energy <= 2.5) return "low-energy bed";
  if (energy >= 4) return "high-energy drive";
  return "steady mid-energy";
}

function formatCueIdRange(cues) {
  const ids = cues.map((c) => c.cue_id);
  if (ids.length > 3) return `${ids[0]}..${ids[ids.length - 1]}`;
  return ids.join(", ");
}

function regionNotes(region, name) {
  const functions = [...new Set(region.cues.map((c) => c.function))].join(", ");
  const hits = region.cues.flatMap((c) => (Array.isArray(c.hit_points) ? c.hit_points : []));
  const underNarration = region.cues.every((c) => c.dialogue_safe === true);
  const intent = [];
  if (underNarration) intent.push("Keep percussion sparse and harmony restrained under narration");
  if (name === "tension build") intent.push("Add texture and momentum gradually across the region");
  if (name === "peak intensity") intent.push("Fullest arrangement of the piece; commit to the peak");
  if (name === "post-peak release") intent.push("Thin the arrangement and let the energy settle");
  if (name === "closing resolution") intent.push("Resolve harmonically and end decisively");
  if (name === "low-energy bed" || name === "restrained under narration") intent.push("Static harmonic bed, minimal movement");
  if (!intent.length) intent.push("Hold a steady arrangement consistent with the section name");
  if (hits.length) intent.push(`Hit accents at ${hits.map((h) => `${Math.round(h * 10) / 10}s`).join(", ")}`);
  const provenance = `Source cues: ${formatCueIdRange(region.cues)}; functions: ${functions}.`;
  let notes = `${intent.join(". ")}. ${provenance}`;
  if (notes.length > contract.LIMITS.section_notes_max) {
    notes = `${notes.slice(0, contract.LIMITS.section_notes_max - 1).replace(/\s+\S*$/, "")}.`;
  }
  return notes;
}

function aggregateMusicalRegions(cues) {
  const regions = [];
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    const isTerminal = i === cues.length - 1;
    const current = regions[regions.length - 1];
    if (!current || shouldSplit(cues[i - 1], cue, isTerminal)) regions.push({ cues: [cue] });
    else current.cues.push(cue);
  }
  // Schema cap: deterministically merge the least-significant adjacent
  // boundary until <= 16 regions. The final region is never truncated —
  // merging joins neighbours, it never drops timeline tail.
  while (regions.length > contract.LIMITS.sections_max) {
    let weakest = 1;
    let weakestScore = Infinity;
    for (let i = 1; i < regions.length; i += 1) {
      const prevCue = regions[i - 1].cues[regions[i - 1].cues.length - 1];
      const nextCue = regions[i].cues[0];
      const score = boundarySignificance(prevCue, nextCue);
      if (score < weakestScore) { weakestScore = score; weakest = i; }
    }
    regions[weakest - 1].cues.push(...regions[weakest].cues);
    regions.splice(weakest, 1);
  }
  const globalMaxEnergy = Math.max(...cues.map((c) => c.energy || 0));
  return regions.map((region, index) => {
    const name = nameRegion(region, index, regions, globalMaxEnergy);
    return {
      name,
      start_s: region.cues[0].start_seconds,
      end_s: region.cues[region.cues.length - 1].end_seconds,
      notes: regionNotes(region, name),
    };
  });
}

// ── assembly ────────────────────────────────────────────────────────────────
// Pure derivation: (project, cues, palettes, instrumentRoles) → frozen v1
// brief. Loading, approval gating, and artifact writing live in score-lane.
function deriveMusicRenderBrief(project, cues, palettes, instrumentRoles) {
  if (project.duration_seconds > contract.LIMITS.duration_max) {
    const e = new Error(`Project duration ${project.duration_seconds}s exceeds the MusicRenderBrief v1 maximum of ${contract.LIMITS.duration_max}s — the frozen contract cannot represent it.`);
    e.statusCode = 400;
    throw e;
  }
  const mixRole = deriveMixRole(project);
  const { instrumentation, avoid } = deriveInstrumentation(project, palettes, instrumentRoles);
  const brief = {
    brief_id: briefIdForProject(project),
    brief_version: 1,
    purpose: derivePurpose(project, mixRole),
    target_duration_s: project.duration_seconds,
    tempo: deriveTempo(project),
    key_mode: String(project.global_key || "").slice(0, contract.LIMITS.key_mode_max),
    energy_curve: classifyEnergyCurve(cues.map((c) => c.energy)),
    emotion_curve: deriveEmotionCurve(cues),
    instrumentation,
    avoid,
    sections: aggregateMusicalRegions(cues),
    narration_density: deriveNarrationDensity(cues, project),
    ending: deriveEnding(cues),
    loopability: false, // EDITORIAL: timeline-bound narrative scores are not loops
    mix_role: mixRole,
  };
  const errors = contract.validateMusicRenderBrief(brief);
  if (errors.length) {
    const e = new Error(`Exported brief failed MusicRenderBrief v1 validation: ${errors.join("; ")}`);
    e.statusCode = 500; // exporter bug, not caller error
    throw e;
  }
  return brief;
}

module.exports = {
  EMOTION_GROUPS,
  MIX_ROLE_MAP,
  briefIdForProject,
  derivePurpose,
  deriveMixRole,
  deriveTempo,
  classifyEnergyCurve,
  deriveNarrationDensity,
  deriveEmotionCurve,
  deriveEnding,
  deriveInstrumentation,
  aggregateMusicalRegions,
  deriveMusicRenderBrief,
};
