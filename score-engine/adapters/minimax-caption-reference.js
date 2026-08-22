// EXPERIMENTAL REFERENCE ADAPTER
// MiniMax Music 3 renderer is not yet production-approved (technical
// feasibility passed on the worker; human audible approval under real
// narration is still pending). No automatic routing uses this module.
//
// This adapter consumes MusicRenderBrief v1 ONLY. Hard boundary: it never
// loads Scorecraft projects, cue sheets, or files, never interprets cue
// functions (cue IDs inside section notes are opaque provenance text), never
// aggregates trajectory, and never mutates the brief. It translates the
// frozen generator-neutral contract into MiniMax structured-caption syntax
// ([Global Metadata] / [Vocal Details] / [Arrangement]) deterministically:
// same brief in, byte-identical caption out. No LLM, no clock, no I/O.
//
// Reference source: the canonical VIDLAP2 Python adapter
// (C:\VidtoolzMusic\docs\brief_to_minimax_caption.py). Intentional
// divergences from it are marked DIVERGENCE below.
"use strict";

const contract = require("../music-render-brief.js");

const ENDING_SENTENCES = {
  "clear-button": "end on a clear button, not a fade",
  "fade": "end with a gentle fade",
  "sting": "end with a short sting",
  "loop-ready-tail": "end with a loop-ready tail",
};

// One cue may develop substantially, but its sections are not independent
// songs. MiniMax receives this rule inside the Arrangement block so it binds
// every timed section, especially a late build/peak that might otherwise be
// interpreted as permission to start unrelated material.
const CONTINUITY_DOCTRINE = [
  "Continuity rule: evolve one continuous composition; do not replace it.",
  "Keep the core instrumental palette, tonal and harmonic world, motif family, groove family, production aesthetic, and spatial character recognizably consistent from beginning to end.",
  "Develop through intensity, density, layers, register, fills, rhythmic or harmonic development, melodic variation, breakdown, rebuild, and ending resolution.",
  "Unless the brief explicitly requests a transformation, do not start an unrelated second composition, switch genre, replace the palette, reset the harmony, introduce a disconnected groove, or hard-restart the music.",
].join(" ");

const SECTION_CONTINUATION = "Continue the established motif, palette, harmony, and groove; vary and develop the arrangement instead of starting new music";

function mmss(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

function renderGlobalMetadata(brief) {
  const tempo = brief.tempo === undefined || brief.tempo === "free" ? "free tempo" : `${brief.tempo} BPM`;
  const emotion = (brief.emotion_curve || []).join(", ") || "neutral";
  const highNarration = (brief.narration_density || []).some((span) => span.density === "high");
  const parts = [
    `Instrumental cue, ${tempo}, ${brief.key_mode || "any key"}, ${Math.round(brief.target_duration_s)} seconds.`,
    `${capitalize(emotion)}.`,
    `Energy: ${brief.energy_curve.replace(/-/g, " ")}, ${brief.mix_role} character.`,
  ];
  if (highNarration && brief.mix_role === "underlay") parts.push("Must stay behind continuous narration.");
  return parts.join(" ");
}

function renderVocalDetails() {
  // The Scorecraft route is always instrumental until the frozen brief gains
  // a versioned vocal contract — never inferred from project text.
  return "Instrumental. No vocals of any kind.";
}

function renderArrangement(brief) {
  const inst = brief.instrumentation || {};
  const parts = [CONTINUITY_DOCTRINE];
  brief.sections.forEach((section, index) => {
    let line = `${mmss(section.start_s)}-${mmss(section.end_s)} ${section.name}`;
    const details = [];
    if (index === 0 && Array.isArray(inst.required) && inst.required.length) {
      details.push(inst.required.join(" and "));
    }
    if (index > 0) details.push(SECTION_CONTINUATION);
    if (section.notes) details.push(section.notes);
    if (details.length) line += `: ${details.join("; ")}`;
    parts.push(line.endsWith(".") ? line : `${line}.`);
  });
  if (Array.isArray(inst.allowed) && inst.allowed.length) {
    parts.push(`Allowed colors: ${inst.allowed.join(", ")}.`);
  }
  parts.push(`${capitalize(ENDING_SENTENCES[brief.ending])}.`);
  // DIVERGENCE from the Python reference: it ignored `loopability`; the
  // contract field is rendered here so a loop requirement actually reaches
  // the generator. Section structure is unchanged by it.
  if (brief.loopability === true) parts.push("The cue must loop cleanly from end back to start.");
  if (Array.isArray(brief.avoid) && brief.avoid.length) {
    parts.push(`Avoid: ${brief.avoid.join(", ")}.`);
  }
  return parts.join(" ");
}

// Validated MusicRenderBrief v1 object in → MiniMax structured caption out.
// Re-validates defensively; rejects rather than guessing on a bad contract.
function renderMiniMaxCaption(brief) {
  const errors = contract.validateMusicRenderBrief(brief);
  if (errors.length) {
    const e = new Error(`MiniMax adapter refused invalid MusicRenderBrief: ${errors.join("; ")}`);
    e.statusCode = 400;
    throw e;
  }
  const blocks = {
    global_metadata: renderGlobalMetadata(brief),
    vocal_details: renderVocalDetails(),
    arrangement: renderArrangement(brief),
  };
  const caption = `[Global Metadata]\n${blocks.global_metadata}\n\n`
    + `[Vocal Details]\n${blocks.vocal_details}\n\n`
    + `[Arrangement]\n${blocks.arrangement}\n`;
  return { caption, blocks, adapter: "minimax-caption-reference", status: "experimental" };
}

module.exports = { CONTINUITY_DOCTRINE, SECTION_CONTINUATION, renderMiniMaxCaption };
