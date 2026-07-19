// VIDTOOLZ Score Engine — cue planning layer.
// 1) Deterministic rule-based cue sheet generation (works fully offline — §5A manual mode).
// 2) AI planning prompt templates (versioned files in score-engine/prompts/) with
//    strict JSON schema validation of responses. Cloud providers are optional and
//    only called when explicitly configured AND explicitly triggered.
// 3) Revision-request interpreter: plain-language notes → structured change list.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const schemas = require("./score-schemas.js");

const PROMPTS_DIR = path.join(__dirname, "prompts");

// ── rule-based cue sheet (deterministic; no AI required) ──
// Narrative shapes by duration bucket, tuned for narration-led short-form (§6).
const SHAPES = {
  short: [ // <= 75s: Shorts
    { function: "hook", share: 0.16, emotion: "curious", energy: 4, density: 2 },
    { function: "explanation", share: 0.55, emotion: "clinical", energy: 2, density: 2 },
    { function: "reveal", share: 0.17, emotion: "optimistic", energy: 4, density: 3 },
    { function: "button", share: 0.12, emotion: "warm", energy: 3, density: 2 },
  ],
  medium: [ // 75s - 180s
    { function: "hook", share: 0.1, emotion: "curious", energy: 4, density: 2 },
    { function: "setup", share: 0.15, emotion: "clinical", energy: 2, density: 2 },
    { function: "explanation", share: 0.35, emotion: "clinical", energy: 2, density: 1 },
    { function: "turn", share: 0.15, emotion: "tense", energy: 3, density: 2 },
    { function: "reveal", share: 0.15, emotion: "optimistic", energy: 4, density: 3 },
    { function: "outro", share: 0.1, emotion: "warm", energy: 3, density: 2 },
  ],
  long: [ // > 180s
    { function: "hook", share: 0.07, emotion: "curious", energy: 4, density: 2 },
    { function: "setup", share: 0.13, emotion: "clinical", energy: 2, density: 2 },
    { function: "explanation", share: 0.3, emotion: "clinical", energy: 2, density: 1 },
    { function: "turn", share: 0.15, emotion: "tense", energy: 3, density: 2 },
    { function: "explanation", share: 0.15, emotion: "curious", energy: 2, density: 2 },
    { function: "climax", share: 0.1, emotion: "urgent", energy: 5, density: 3 },
    { function: "outro", share: 0.1, emotion: "warm", energy: 3, density: 2 },
  ],
};

const EMOTION_BY_MOOD = {
  curious: "curious", tense: "tense", warm: "warm", clinical: "clinical",
  playful: "playful", dark: "dark", optimistic: "optimistic", urgent: "urgent",
  serious: "clinical", funny: "playful", dry: "playful", confident: "optimistic",
};

function pickShape(durationSeconds) {
  if (durationSeconds <= 75) return SHAPES.short;
  if (durationSeconds <= 180) return SHAPES.medium;
  return SHAPES.long;
}

// Deterministic cue sheet from duration + high-level intent. Always >= 3 cues.
function generateCueSheet(options = {}) {
  const duration = Number(options.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("duration_seconds must be > 0 to generate a cue sheet.");
  const tempo = Number(options.tempo_bpm) || (duration <= 75 ? 96 : 84);
  const key = options.key || "D minor";
  const mood = EMOTION_BY_MOOD[String(options.overall_mood || "").toLowerCase()] || null;
  const dialogueDensity = options.dialogue_density || "high";
  const shape = pickShape(duration);
  const cues = [];
  let cursor = 0;
  shape.forEach((segment, i) => {
    const isLast = i === shape.length - 1;
    const length = isLast ? duration - cursor : Math.round(duration * segment.share * 10) / 10;
    const cue = {
      cue_id: `C${String(i + 1).padStart(3, "0")}`,
      name: defaultCueName(segment.function),
      start_seconds: Math.round(cursor * 1000) / 1000,
      end_seconds: Math.round((cursor + length) * 1000) / 1000,
      function: segment.function,
      emotion: mood && ["explanation", "setup"].includes(segment.function) === false ? blendEmotion(segment.emotion, mood) : segment.emotion,
      energy: segment.energy,
      density: segment.density,
      tempo_bpm: tempo,
      key,
      time_signature: "4/4",
      instrument_roles: { pulse: "", bass: "", harmony: "", melody: "", texture: "", impact: "" },
      arrangement_notes: "",
      hit_points: [],
      dialogue_safe: dialogueDensity === "high" || (dialogueDensity === "medium" && ["explanation", "setup"].includes(segment.function)),
    };
    cues.push(cue);
    cursor = cue.end_seconds;
  });
  // Duration-lock the last cue exactly.
  cues[cues.length - 1].end_seconds = Math.round(duration * 1000) / 1000;
  const errors = schemas.validateCueSheet({ cues }, { duration_seconds: duration });
  if (errors.length) throw new Error(`Generated cue sheet failed validation: ${errors.join("; ")}`);
  return { cues, generator: "rule_based_v1", duration_seconds: duration };
}

function blendEmotion(shapeEmotion, mood) {
  // Hook/reveal keep their function-driven feel unless the mood is strongly different.
  if (["curious", "optimistic"].includes(shapeEmotion) && mood) return mood;
  return shapeEmotion;
}

function defaultCueName(fn) {
  return { hook: "Opening hook", setup: "Setup", explanation: "Explanation bed", turn: "The turn", reveal: "Reveal", climax: "Climax", button: "Final button", outro: "Outro" }[fn] || fn;
}

// Rough narration duration estimate from a script (≈150 spoken words/minute).
function estimateDurationFromScript(scriptText) {
  const words = String(scriptText || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return null;
  return Math.max(15, Math.round((words / 150) * 60));
}

// ── music plan (palette applied to cue sheet) ──
function buildMusicPlan(cueSheet, paletteId, profiles = []) {
  const palette = schemas.DEFAULT_PALETTES[paletteId];
  if (!palette) throw new Error(`Unknown palette: ${paletteId}. Available: ${Object.keys(schemas.DEFAULT_PALETTES).join(", ")}`);
  const profileById = new Map(profiles.map((p) => [p.profile_id, p]));
  const roles = {};
  for (const [role, spec] of Object.entries(palette.roles)) {
    const profile = profileById.get(spec.profile_hint) || null;
    roles[role] = {
      character: spec.character,
      register: spec.register,
      profile_id: profile ? profile.profile_id : spec.profile_hint,
      profile_display_name: profile ? profile.display_name : spec.profile_hint,
      vendor: profile ? profile.vendor : null,
      preset_hint: profile ? profile.preset_hint : null,
      track_template_path: profile ? profile.track_template_path : null,
    };
  }
  return {
    palette_id: palette.palette_id,
    palette_display_name: palette.display_name,
    description: palette.description,
    roles,
    mix_guidance: [
      "Music under speech stays conservative — trust the dialogue-safe mix.",
      "Low end must not fight narration; keep bass simple under dense speech.",
      "Leave midrange room for the voice (gentle 1-4 kHz care on pads).",
      "Sidechain suggestion: duck pads/texture -3 to -6 dB from the narration bus.",
    ],
  };
}

// ── AI planning layer (optional; manual-first) ──
function loadPromptTemplate(task) {
  const names = { cue_sheet: "cue-sheet-prompt.md", palette: "palette-prompt.md", revision: "revision-prompt.md", provenance: "provenance-prompt.md" };
  const file = names[task];
  if (!file) throw new Error(`Unknown prompt task: ${task}`);
  return fs.readFileSync(path.join(PROMPTS_DIR, file), "utf8");
}

function renderPrompt(task, context = {}) {
  let text = loadPromptTemplate(task);
  for (const [key, value] of Object.entries(context)) {
    text = text.split(`{{${key}}}`).join(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
  // Any un-filled placeholder becomes an explicit gap the user can see.
  text = text.replace(/\{\{[a-z_]+\}\}/g, "(not provided)");
  return text;
}

// Strip artist/composer imitation requests into abstract attributes (§0.2).
const ARTIST_REFERENCE_PATTERN = /\b(like|sounds? like|in the style of|inspired by|similar to)\s+[A-Z][\w.]*(\s+[A-Z][\w.]*)?/g;
function sanitizeStyleRequest(text) {
  const found = [];
  const sanitized = String(text || "").replace(ARTIST_REFERENCE_PATTERN, (match) => {
    found.push(match);
    return "with these abstract attributes instead (tempo/density/instrumentation/harmony/energy/texture/rhythm/emotional function)";
  });
  return { sanitized, strippedReferences: found };
}

// Parse + validate an AI cue-sheet response (from API or manual paste).
function parseAiCueSheet(rawText, options = {}) {
  let parsed;
  const text = String(rawText || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { parsed = JSON.parse(text); } catch (error) {
    throw new Error(`AI response is not valid JSON: ${error.message}`);
  }
  const cues = Array.isArray(parsed) ? parsed : parsed.cues;
  if (!Array.isArray(cues)) throw new Error("AI response must contain a cues array.");
  const errors = schemas.validateCueSheet({ cues }, { duration_seconds: options.duration_seconds });
  if (errors.length) throw new Error(`AI cue sheet failed schema validation: ${errors.join("; ")}`);
  return { cues, generator: options.generator || "ai_assisted" };
}

// Optional cloud call — used only when settings.default_ai_provider is set AND
// the user clicks the AI action in the GUI. Keys come from env vars only.
async function callAiProvider(provider, promptText, settings = {}, fetchImpl = fetch) {
  if (provider === "openai") {
    const key = process.env[settings.openai_api_key_env || "OPENAI_API_KEY"];
    if (!key) throw new Error(`OpenAI selected but env var ${settings.openai_api_key_env || "OPENAI_API_KEY"} is not set. Fix in Settings or use manual mode.`);
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: settings.openai_model || "gpt-4o-mini", messages: [{ role: "user", content: promptText }], temperature: 0.4 }),
      signal: AbortSignal.timeout(120000), // a hung provider must not hold the route open forever
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    return { provider: "openai", model: data.model, text: data.choices?.[0]?.message?.content || "" };
  }
  if (provider === "anthropic") {
    const key = process.env[settings.anthropic_api_key_env || "ANTHROPIC_API_KEY"];
    if (!key) throw new Error(`Anthropic selected but env var ${settings.anthropic_api_key_env || "ANTHROPIC_API_KEY"} is not set. Fix in Settings or use manual mode.`);
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: settings.anthropic_model || "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: promptText }] }),
      signal: AbortSignal.timeout(120000), // a hung provider must not hold the route open forever
    });
    if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}`);
    const data = await response.json();
    return { provider: "anthropic", model: data.model, text: (data.content || []).map((c) => c.text || "").join("") };
  }
  throw new Error(`Provider must be openai or anthropic (got ${JSON.stringify(provider)}). Manual mode uses copy/paste instead.`);
}

// ── revision interpreter: plain-language request → structured change list ──
const REVISION_RULES = [
  { pattern: /less busy|too busy|calmer|quieter under (speech|narration)/i, change: { type: "density", delta: -1, dialogue_safe: true }, describe: "Reduce density by 1 and force dialogue-safe mode" },
  { pattern: /more tension (in|through) the middle|more tension/i, change: { type: "emotion", scope: "middle", emotion: "tense", energy_delta: 1 }, describe: "Middle cues become tense with +1 energy" },
  { pattern: /stronger (ending|button|outro)/i, change: { type: "ending", energy_delta: 1 }, describe: "Raise final cue energy and button emphasis" },
  { pattern: /warmer|warm(er)? (analog )?sound|replace pulse with warmer/i, change: { type: "palette", palette_id: "broadcast_explainer" }, describe: "Switch toward the warmer Broadcast Explainer palette" },
  { pattern: /more dry|funnier|more funny|comedy/i, change: { type: "palette", palette_id: "dry_comedy_underscore" }, describe: "Switch to Dry Comedy Underscore palette" },
  { pattern: /reduce bass|less bass|too much low end/i, change: { type: "lane_gain", lane: "bass", gain: 0.5 }, describe: "Halve bass level in the render mix" },
  { pattern: /more distinctive intro|stronger intro|intro more/i, change: { type: "intro", energy_delta: 1, allow_melody: true }, describe: "Raise intro energy and allow an intro motif" },
  { pattern: /darker/i, change: { type: "emotion", scope: "all", emotion: "dark" }, describe: "Shift cue emotions darker" },
  { pattern: /faster|more tempo|quicker/i, change: { type: "tempo", delta: 8 }, describe: "Raise tempo by 8 BPM" },
  { pattern: /slower|less tempo/i, change: { type: "tempo", delta: -8 }, describe: "Lower tempo by 8 BPM" },
];

function planRevision(requestText) {
  const { sanitized, strippedReferences } = sanitizeStyleRequest(requestText);
  const changes = [];
  for (const rule of REVISION_RULES) {
    if (rule.pattern.test(sanitized)) changes.push({ ...rule.change, description: rule.describe });
  }
  return {
    request: String(requestText || ""),
    sanitized_request: sanitized,
    stripped_artist_references: strippedReferences,
    changes,
    unmatched: changes.length === 0,
    note: changes.length === 0 ? "No rule matched — the request is stored verbatim; a new seed variation will be generated." : "",
  };
}

// Apply a revision plan to (cueSheet, generation settings) → new derived settings.
function applyRevision(cueSheet, generation, revisionPlan) {
  const cues = JSON.parse(JSON.stringify(cueSheet.cues));
  const next = { ...generation, seed: (generation.seed || 1) + 1, lane_gains: { ...(generation.lane_gains || {}) } };
  for (const change of revisionPlan.changes) {
    if (change.type === "density") {
      cues.forEach((cue) => { cue.density = Math.max(1, cue.density + change.delta); if (change.dialogue_safe) cue.dialogue_safe = true; });
    } else if (change.type === "emotion") {
      const targets = change.scope === "middle" ? cues.slice(1, Math.max(2, cues.length - 1)) : cues;
      targets.forEach((cue) => { cue.emotion = change.emotion; if (change.energy_delta) cue.energy = Math.min(5, cue.energy + change.energy_delta); });
    } else if (change.type === "ending") {
      const last = cues[cues.length - 1];
      last.energy = Math.min(5, last.energy + change.energy_delta);
    } else if (change.type === "palette") {
      next.palette_id = change.palette_id;
    } else if (change.type === "lane_gain") {
      next.lane_gains[change.lane] = change.gain;
    } else if (change.type === "intro") {
      const first = cues[0];
      first.energy = Math.min(5, first.energy + change.energy_delta);
      if (change.allow_melody) first.dialogue_safe = false;
    } else if (change.type === "tempo") {
      cues.forEach((cue) => { cue.tempo_bpm = Math.max(40, Math.min(220, cue.tempo_bpm + change.delta)); });
    }
  }
  return { cues, generation: next };
}

module.exports = {
  generateCueSheet,
  estimateDurationFromScript,
  buildMusicPlan,
  loadPromptTemplate,
  renderPrompt,
  sanitizeStyleRequest,
  parseAiCueSheet,
  callAiProvider,
  planRevision,
  applyRevision,
  SHAPES,
};
