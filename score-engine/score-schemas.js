// VIDTOOLZ Score Engine — schemas, default palettes, starter instrument profiles,
// and hand-rolled validators (this repo is dependency-free by design).
// Everything here is pure data + pure functions: no fs, no network.
"use strict";

const CUE_FUNCTIONS = ["hook", "setup", "explanation", "turn", "reveal", "climax", "button", "outro"];
const CUE_EMOTIONS = ["curious", "tense", "warm", "clinical", "playful", "dark", "optimistic", "urgent"];
const MUSIC_ROLES = ["underscore", "intro", "transition", "tension", "release", "outro", "mixed"];
const DIALOGUE_DENSITIES = ["low", "medium", "high"];
const INSTRUMENT_ROLES = ["pulse", "bass", "harmony", "melody", "texture", "impact", "percussion", "transitions"];
const TARGET_PLATFORMS = ["youtube_shorts", "youtube_longform", "documentary_segment", "generic_video"];
const CANDIDATE_STATUSES = ["planned", "midi_generated", "daw_built", "preview_rendered", "approved", "rejected"];
const AI_PROVIDERS = ["manual", "openai", "anthropic"];

// ── Default palettes (abstract musical attributes only — never named artists) ──
const DEFAULT_PALETTES = {
  tech_noir_pulse: {
    palette_id: "tech_noir_pulse",
    display_name: "Tech Noir Pulse",
    description: "Analog pulse, low synth bass, muted arps, dark pad, subtle noise texture.",
    default_mode: "minor",
    roles: {
      pulse: { character: "analog 8th-note pulse, filtered, soft attack", register: "mid", profile_hint: "arturia_analog_pulse" },
      bass: { character: "low round synth bass, root-heavy", register: "low", profile_hint: "arturia_analog_bass" },
      harmony: { character: "dark evolving pad, slow attack", register: "mid", profile_hint: "omnisphere_dark_pad" },
      melody: { character: "muted arp fragments, very sparse", register: "mid", profile_hint: "arturia_muted_arp" },
      texture: { character: "subtle noise bed, vinyl-like air", register: "high", profile_hint: "omnisphere_noise_texture" },
      impact: { character: "low boom, soft sub hit", register: "low", profile_hint: "uvi_low_boom" },
    },
  },
  broadcast_explainer: {
    palette_id: "broadcast_explainer",
    display_name: "Broadcast Explainer",
    description: "Clean pulse, light mallets/plucks, restrained bass, warm pad, minimal transitions.",
    default_mode: "major",
    roles: {
      pulse: { character: "clean plucked pulse, even 8ths", register: "mid", profile_hint: "ableton_clean_pluck" },
      bass: { character: "restrained bass, roots and fifths", register: "low", profile_hint: "ableton_soft_bass" },
      harmony: { character: "warm pad, simple triads", register: "mid", profile_hint: "arturia_warm_pad" },
      melody: { character: "light mallet motif, sparse", register: "high", profile_hint: "uvi_mallets" },
      texture: { character: "clean high shimmer, quiet", register: "high", profile_hint: "omnisphere_air_texture" },
      impact: { character: "small soft transition hit", register: "wide", profile_hint: "uvi_soft_hit" },
    },
  },
  ai_lab: {
    palette_id: "ai_lab",
    display_name: "AI Lab",
    description: "Granular textures, synthetic clicks, evolving pad, sparse bass, glitch accents.",
    default_mode: "dorian",
    roles: {
      pulse: { character: "synthetic click pulse, irregular accents", register: "mid", profile_hint: "ableton_click_pulse" },
      bass: { character: "sparse sub bass, long tones", register: "low", profile_hint: "ableton_sub_bass" },
      harmony: { character: "evolving granular pad", register: "wide", profile_hint: "omnisphere_evolving_pad" },
      melody: { character: "glitch accent fragments", register: "high", profile_hint: "uvi_glitch_accent" },
      texture: { character: "granular texture bed", register: "high", profile_hint: "omnisphere_granular_bed" },
      impact: { character: "processed digital hit", register: "wide", profile_hint: "uvi_digital_hit" },
    },
  },
  dry_comedy_underscore: {
    palette_id: "dry_comedy_underscore",
    display_name: "Dry Comedy Underscore",
    description: "Minimal pizz/pluck/synth blips, awkward pauses, soft bass, small stingers.",
    default_mode: "major",
    roles: {
      pulse: { character: "minimal pizzicato-like blips with pauses", register: "mid", profile_hint: "uvi_pizz_pluck" },
      bass: { character: "soft short bass notes", register: "low", profile_hint: "ableton_soft_bass" },
      harmony: { character: "dry sparse chords, staccato", register: "mid", profile_hint: "arturia_dry_keys" },
      melody: { character: "deadpan two-note motifs", register: "high", profile_hint: "ableton_blip_lead" },
      texture: { character: "almost nothing — occasional air", register: "high", profile_hint: "omnisphere_air_texture" },
      impact: { character: "small stinger, single accent", register: "wide", profile_hint: "uvi_small_stinger" },
    },
  },
  serious_system_builder: {
    palette_id: "serious_system_builder",
    display_name: "Serious System Builder",
    description: "Steady pulse, low authority bass, slow harmonic shifts, clean high texture, confident outro.",
    default_mode: "minor",
    roles: {
      pulse: { character: "steady quarter/8th pulse, confident", register: "mid", profile_hint: "arturia_analog_pulse" },
      bass: { character: "low authority bass, sustained roots", register: "low", profile_hint: "arturia_analog_bass" },
      harmony: { character: "slow harmonic pad shifts", register: "mid", profile_hint: "omnisphere_cinematic_pad" },
      melody: { character: "confident sparse motif, intro/outro only", register: "mid", profile_hint: "arturia_lead_soft" },
      texture: { character: "clean high texture, restrained", register: "high", profile_hint: "omnisphere_air_texture" },
      impact: { character: "confident low hit, final button", register: "low", profile_hint: "uvi_low_boom" },
    },
  },
};

// ── Starter instrument profiles (template-first abstraction; §7) ──
// These reference owned-tool CATEGORIES, not reverse-engineered plugin APIs.
const STARTER_INSTRUMENT_PROFILES = [
  { profile_id: "omnisphere_evolving_pad", display_name: "Omnisphere evolving pad", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "pad", mood_tags: ["evolving", "cinematic"], density_range: [1, 3], register: "wide", preset_hint: "Search: evolving pad / atmosphere", track_template_path: null, ableton_template_hint: "Omnisphere pad track", notes: "" },
  { profile_id: "omnisphere_dark_pad", display_name: "Omnisphere dark pad", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "pad", mood_tags: ["dark", "tense"], density_range: [1, 3], register: "mid", preset_hint: "Search: dark pad / underscore", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "omnisphere_cinematic_pad", display_name: "Omnisphere cinematic pulse-pad", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "pad", mood_tags: ["cinematic", "serious"], density_range: [1, 4], register: "mid", preset_hint: "Search: cinematic pad", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "omnisphere_noise_texture", display_name: "Omnisphere noise/air texture", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "texture", mood_tags: ["airy", "noise"], density_range: [1, 2], register: "high", preset_hint: "Search: texture / noise bed", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "omnisphere_granular_bed", display_name: "Omnisphere granular bed", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "texture", mood_tags: ["granular", "lab"], density_range: [1, 2], register: "high", preset_hint: "Search: granular", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "omnisphere_air_texture", display_name: "Omnisphere clean air texture", vendor: "Spectrasonics", plugin_name: "Omnisphere", plugin_format: "unknown", daw_backend: "both", role: "texture", mood_tags: ["clean", "air"], density_range: [1, 2], register: "high", preset_hint: "Search: air / shimmer", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_low_boom", display_name: "UVI low boom / sub hit", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "impact", mood_tags: ["low", "boom"], density_range: [1, 5], register: "low", preset_hint: "Cinematic percussion: boom / sub hit", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_soft_hit", display_name: "UVI soft transition hit", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "impact", mood_tags: ["soft", "transition"], density_range: [1, 4], register: "wide", preset_hint: "Transition FX: soft hit", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_digital_hit", display_name: "UVI processed digital hit", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "impact", mood_tags: ["digital", "glitch"], density_range: [1, 4], register: "wide", preset_hint: "Sound design: digital impact", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_small_stinger", display_name: "UVI small stinger", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "impact", mood_tags: ["comedy", "small"], density_range: [1, 3], register: "wide", preset_hint: "Stinger / accent", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_mallets", display_name: "UVI light mallets", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "lead", mood_tags: ["mallet", "light"], density_range: [1, 3], register: "high", preset_hint: "Mallets: vibraphone / marimba soft", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_glitch_accent", display_name: "UVI glitch accent", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "fx", mood_tags: ["glitch"], density_range: [1, 2], register: "high", preset_hint: "Sound design: glitch", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "uvi_pizz_pluck", display_name: "UVI pizzicato / pluck", vendor: "UVI", plugin_name: "UVI Falcon/Workstation", plugin_format: "unknown", daw_backend: "both", role: "pulse", mood_tags: ["pizz", "dry"], density_range: [1, 3], register: "mid", preset_hint: "Orchestral: pizzicato", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_analog_pulse", display_name: "Arturia analog pulse", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "pulse", mood_tags: ["analog", "pulse"], density_range: [1, 4], register: "mid", preset_hint: "Sequence/arp patch, filter closed", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_analog_bass", display_name: "Arturia analog bass", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "bass", mood_tags: ["analog", "round"], density_range: [1, 4], register: "low", preset_hint: "Mono bass, soft attack", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_warm_pad", display_name: "Arturia warm analog pad", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "pad", mood_tags: ["warm", "analog", "soft"], density_range: [1, 3], register: "mid", preset_hint: "Juno-style soft pad category", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_muted_arp", display_name: "Arturia muted arp", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "lead", mood_tags: ["muted", "arp"], density_range: [1, 3], register: "mid", preset_hint: "Arp patch, lowpass down", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_dry_keys", display_name: "Arturia dry keys/plucks", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "pad", mood_tags: ["dry", "staccato"], density_range: [1, 3], register: "mid", preset_hint: "EP/clav dry patch", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "arturia_lead_soft", display_name: "Arturia soft lead", vendor: "Arturia", plugin_name: "Arturia V Collection", plugin_format: "unknown", daw_backend: "both", role: "lead", mood_tags: ["soft", "confident"], density_range: [1, 3], register: "mid", preset_hint: "Soft mono lead", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "ableton_clean_pluck", display_name: "Ableton Wavetable clean pluck", vendor: "Ableton", plugin_name: "Wavetable", plugin_format: "unknown", daw_backend: "ableton", role: "pulse", mood_tags: ["clean", "pluck"], density_range: [1, 4], register: "mid", preset_hint: "Wavetable pluck preset", track_template_path: null, ableton_template_hint: "Wavetable pluck track", notes: "" },
  { profile_id: "ableton_click_pulse", display_name: "Ableton Operator click pulse", vendor: "Ableton", plugin_name: "Operator", plugin_format: "unknown", daw_backend: "ableton", role: "pulse", mood_tags: ["click", "synthetic"], density_range: [1, 4], register: "mid", preset_hint: "Operator short percussive", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "ableton_soft_bass", display_name: "Ableton Drift soft bass", vendor: "Ableton", plugin_name: "Drift", plugin_format: "unknown", daw_backend: "ableton", role: "bass", mood_tags: ["soft", "round"], density_range: [1, 3], register: "low", preset_hint: "Drift bass preset", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "ableton_sub_bass", display_name: "Ableton Operator sub bass", vendor: "Ableton", plugin_name: "Operator", plugin_format: "unknown", daw_backend: "ableton", role: "bass", mood_tags: ["sub", "sparse"], density_range: [1, 2], register: "low", preset_hint: "Sine sub patch", track_template_path: null, ableton_template_hint: null, notes: "" },
  { profile_id: "ableton_blip_lead", display_name: "Ableton blip lead", vendor: "Ableton", plugin_name: "Operator", plugin_format: "unknown", daw_backend: "ableton", role: "lead", mood_tags: ["blip", "comedy"], density_range: [1, 2], register: "high", preset_hint: "Short square blip", track_template_path: null, ableton_template_hint: null, notes: "" },
];

const DEFAULT_SETTINGS = {
  music_root: "", // resolved at runtime to ~/vidtoolz-score-projects when empty
  default_video_package_root: "",
  ffmpeg_path: "ffmpeg",
  ffprobe_path: "ffprobe",
  reaper_executable_path: "",
  reaper_resource_path: "",
  reaper_project_template_path: "",
  reaper_track_template_folder: "",
  reaper_auto_open: false,
  ableton_template_path: "",
  ableton_handoff_enabled: true,
  max_for_live_bridge_enabled: false,
  openai_api_key_env: "OPENAI_API_KEY",
  anthropic_api_key_env: "ANTHROPIC_API_KEY",
  // Model overrides for the optional AI planning call. Present here so
  // saveSettings keeps them (it drops unknown keys); empty = provider default.
  openai_model: "",
  anthropic_model: "",
  default_ai_provider: "manual",
  default_palette: "tech_noir_pulse",
  default_candidate_count: 3,
  default_dialogue_density: "high",
  default_export_sample_rate: 48000,
  default_export_bit_depth: 24,
  duration_exact_export: true,
};

// ── validators: return array of error strings (empty = valid) ──

function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }

function validateCue(cue, index = 0) {
  const errors = [];
  const tag = `cues[${index}]`;
  if (!cue || typeof cue !== "object") return [`${tag}: not an object`];
  if (!isNonEmptyString(cue.cue_id)) errors.push(`${tag}: cue_id required`);
  if (!isNonEmptyString(cue.name)) errors.push(`${tag}: name required`);
  if (!isFiniteNumber(cue.start_seconds) || cue.start_seconds < 0) errors.push(`${tag}: start_seconds must be >= 0`);
  if (!isFiniteNumber(cue.end_seconds) || cue.end_seconds <= (cue.start_seconds || 0)) errors.push(`${tag}: end_seconds must be > start_seconds`);
  if (!CUE_FUNCTIONS.includes(cue.function)) errors.push(`${tag}: function must be one of ${CUE_FUNCTIONS.join("|")}`);
  if (!CUE_EMOTIONS.includes(cue.emotion)) errors.push(`${tag}: emotion must be one of ${CUE_EMOTIONS.join("|")}`);
  if (!Number.isInteger(cue.energy) || cue.energy < 1 || cue.energy > 5) errors.push(`${tag}: energy must be integer 1-5`);
  if (!Number.isInteger(cue.density) || cue.density < 1 || cue.density > 5) errors.push(`${tag}: density must be integer 1-5`);
  if (!isFiniteNumber(cue.tempo_bpm) || cue.tempo_bpm < 40 || cue.tempo_bpm > 220) errors.push(`${tag}: tempo_bpm must be 40-220`);
  if (!isNonEmptyString(cue.key)) errors.push(`${tag}: key required (e.g. "D minor")`);
  if (!/^\d+\/\d+$/.test(String(cue.time_signature || ""))) errors.push(`${tag}: time_signature must look like 4/4`);
  if (!Array.isArray(cue.hit_points)) errors.push(`${tag}: hit_points must be an array`);
  else cue.hit_points.forEach((h, i) => { if (!isFiniteNumber(h) || h < cue.start_seconds || h > cue.end_seconds) errors.push(`${tag}: hit_points[${i}] must be a number within the cue`); });
  if (typeof cue.dialogue_safe !== "boolean") errors.push(`${tag}: dialogue_safe must be boolean`);
  return errors;
}

function validateCueSheet(cueSheet, options = {}) {
  const errors = [];
  if (!cueSheet || typeof cueSheet !== "object") return ["cue sheet is not an object"];
  const cues = cueSheet.cues;
  if (!Array.isArray(cues) || cues.length === 0) return ["cues must be a non-empty array"];
  cues.forEach((cue, i) => errors.push(...validateCue(cue, i)));
  // Cue ids unique, ordered, non-overlapping.
  const ids = new Set();
  for (let i = 0; i < cues.length; i += 1) {
    if (ids.has(cues[i].cue_id)) errors.push(`cues[${i}]: duplicate cue_id ${cues[i].cue_id}`);
    ids.add(cues[i].cue_id);
    if (i > 0 && isFiniteNumber(cues[i].start_seconds) && isFiniteNumber(cues[i - 1].end_seconds)
      && cues[i].start_seconds < cues[i - 1].end_seconds - 0.001) {
      errors.push(`cues[${i}]: overlaps previous cue (starts ${cues[i].start_seconds} before previous end ${cues[i - 1].end_seconds})`);
    }
  }
  const duration = options.duration_seconds;
  if (isFiniteNumber(duration) && cues.length) {
    const last = cues[cues.length - 1];
    if (isFiniteNumber(last.end_seconds) && last.end_seconds > duration + 0.05) {
      errors.push(`last cue ends at ${last.end_seconds}s but video duration is ${duration}s`);
    }
  }
  return errors;
}

function validateScoreProject(project) {
  const errors = [];
  if (!project || typeof project !== "object") return ["project is not an object"];
  if (!isNonEmptyString(project.project_id)) errors.push("project_id required");
  if (!isFiniteNumber(project.duration_seconds) || project.duration_seconds <= 0) errors.push("duration_seconds must be > 0");
  if (!isFiniteNumber(project.global_tempo_bpm) || project.global_tempo_bpm < 40 || project.global_tempo_bpm > 220) errors.push("global_tempo_bpm must be 40-220");
  if (!isNonEmptyString(project.global_key)) errors.push("global_key required");
  if (!DIALOGUE_DENSITIES.includes(project.dialogue_density)) errors.push(`dialogue_density must be ${DIALOGUE_DENSITIES.join("|")}`);
  if (!MUSIC_ROLES.includes(project.music_role)) errors.push(`music_role must be ${MUSIC_ROLES.join("|")}`);
  if (project.cues && project.cues.length) errors.push(...validateCueSheet({ cues: project.cues }, { duration_seconds: project.duration_seconds }));
  return errors;
}

function validateInstrumentProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== "object") return ["profile is not an object"];
  if (!isNonEmptyString(profile.profile_id)) errors.push("profile_id required");
  else if (!/^[a-z0-9_]+$/.test(profile.profile_id)) errors.push("profile_id must be lowercase snake_case");
  if (!isNonEmptyString(profile.display_name)) errors.push("display_name required");
  if (!isNonEmptyString(profile.role)) errors.push("role required");
  if (!["reaper", "ableton", "both"].includes(profile.daw_backend || "both")) errors.push("daw_backend must be reaper|ableton|both");
  if (profile.density_range && (!Array.isArray(profile.density_range) || profile.density_range.length !== 2)) errors.push("density_range must be [min,max]");
  return errors;
}

function validatePalette(palette) {
  const errors = [];
  if (!palette || typeof palette !== "object") return ["palette is not an object"];
  if (!isNonEmptyString(palette.palette_id)) errors.push("palette_id required");
  if (!palette.roles || typeof palette.roles !== "object") errors.push("roles object required");
  else {
    for (const role of ["pulse", "bass", "harmony", "texture", "impact"]) {
      if (!palette.roles[role]) errors.push(`palette missing required role: ${role}`);
    }
  }
  return errors;
}

// Settings whose value must be a string when present. Without this a
// wrong-typed music_root (e.g. a number) was accepted, persisted, and then
// bricked EVERY score read route with a path TypeError until the settings
// file was hand-edited.
const STRING_SETTINGS = [
  "music_root", "default_video_package_root", "ffmpeg_path", "ffprobe_path",
  "reaper_executable_path", "reaper_resource_path", "reaper_project_template_path",
  "reaper_track_template_folder", "ableton_template_path",
  "openai_api_key_env", "anthropic_api_key_env", "openai_model", "anthropic_model",
  "default_palette",
];

function validateSettings(settings) {
  const errors = [];
  if (!settings || typeof settings !== "object") return ["settings is not an object"];
  for (const key of STRING_SETTINGS) {
    if (settings[key] !== undefined && settings[key] !== null && typeof settings[key] !== "string") {
      errors.push(`${key} must be a string`);
    }
  }
  if (settings.default_palette && !Object.prototype.hasOwnProperty.call(DEFAULT_PALETTES, settings.default_palette)) {
    errors.push(`default_palette must be one of ${Object.keys(DEFAULT_PALETTES).join("|")}`);
  }
  if (settings.default_ai_provider && !AI_PROVIDERS.includes(settings.default_ai_provider)) errors.push(`default_ai_provider must be ${AI_PROVIDERS.join("|")}`);
  if (settings.default_candidate_count !== undefined && (!Number.isInteger(settings.default_candidate_count) || settings.default_candidate_count < 1 || settings.default_candidate_count > 5)) errors.push("default_candidate_count must be integer 1-5");
  if (settings.default_dialogue_density && !DIALOGUE_DENSITIES.includes(settings.default_dialogue_density)) errors.push(`default_dialogue_density must be ${DIALOGUE_DENSITIES.join("|")}`);
  // Wrong-typed render numbers previously produced silently corrupt 44-byte
  // header-only WAV "exports" (NaN frame count) with no error anywhere.
  if (settings.default_export_sample_rate !== undefined && (!Number.isInteger(settings.default_export_sample_rate) || settings.default_export_sample_rate < 8000 || settings.default_export_sample_rate > 192000)) {
    errors.push("default_export_sample_rate must be an integer between 8000 and 192000");
  }
  if (settings.default_export_bit_depth !== undefined && ![16, 24].includes(settings.default_export_bit_depth)) {
    errors.push("default_export_bit_depth must be 16 or 24");
  }
  for (const key of ["openai_api_key", "anthropic_api_key", "api_key"]) {
    if (settings[key]) errors.push(`${key}: raw API keys must not be stored in settings — use *_api_key_env names`);
  }
  return errors;
}

module.exports = {
  CUE_FUNCTIONS,
  CUE_EMOTIONS,
  MUSIC_ROLES,
  DIALOGUE_DENSITIES,
  INSTRUMENT_ROLES,
  TARGET_PLATFORMS,
  CANDIDATE_STATUSES,
  AI_PROVIDERS,
  DEFAULT_PALETTES,
  STARTER_INSTRUMENT_PROFILES,
  DEFAULT_SETTINGS,
  validateCue,
  validateCueSheet,
  validateScoreProject,
  validateInstrumentProfile,
  validatePalette,
  validateSettings,
};
