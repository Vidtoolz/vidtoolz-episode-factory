/**
 * VISUAL FUNCTION AUTHORITY V1
 * Defines the canonical semantic vocabulary for what job a visual performs in VIDTOOLZ.
 * Visual function MUST precede any tool, medium, or renderer selection.
 */

const VISUAL_FUNCTIONS = Object.freeze({
  ESTABLISH: {
    description: "Sets the spatial, technical, or production context.",
    suitable_dispositions: ["TALKING_HEAD", "AI_IMAGE", "SCREEN_CAPTURE", "UNREAL"]
  },
  EXPLAIN: {
    description: "Clarifies how a mechanism or system operates.",
    suitable_dispositions: ["BLENDER_DIRECT", "INFOGRAPHIC", "SCREEN_CAPTURE"]
  },
  COMPARE: {
    description: "Contrasts two opposing states, methodologies, or outcomes.",
    suitable_dispositions: ["BLENDER_DIRECT", "INFOGRAPHIC", "STATIC_GRAPHIC"]
  },
  DEMONSTRATE: {
    description: "Walks through a concrete execution sequence or UI operation.",
    suitable_dispositions: ["SCREEN_CAPTURE", "BLENDER_DIRECT"]
  },
  PROVE: {
    description: "Supplies evidence, telemetry, benchmarks, or citations.",
    suitable_dispositions: ["SCREEN_CAPTURE", "STATIC_GRAPHIC", "INFOGRAPHIC"]
  },
  CONTRAST: {
    description: "Highlights sharp qualitative differences between alternatives.",
    suitable_dispositions: ["BLENDER_DIRECT", "TALKING_HEAD", "INFOGRAPHIC"]
  },
  SHOW_CAUSALITY: {
    description: "Illustrates action-reaction dynamics across time or stages.",
    suitable_dispositions: ["BLENDER_DIRECT", "AI_VIDEO"]
  },
  SHOW_FLOW: {
    description: "Depicts information, data, or progression through pipeline nodes.",
    suitable_dispositions: ["BLENDER_DIRECT"]
  },
  SHOW_HIERARCHY: {
    description: "Visualizes authority, delegation, governance, or taxonomy.",
    suitable_dispositions: ["BLENDER_DIRECT", "INFOGRAPHIC"]
  },
  SHOW_TRANSFORMATION: {
    description: "Illustrates semantic conversion or refinement of an asset (A -> B).",
    suitable_dispositions: ["BLENDER_DIRECT", "AI_VIDEO"]
  },
  SHOW_CONSTRAINT: {
    description: "Reveals system boundaries, limits, bottlenecks, or pressure.",
    suitable_dispositions: ["BLENDER_DIRECT", "INFOGRAPHIC"]
  },
  SHOW_ACCUMULATION: {
    description: "Shows queue buildup, latency, backlog, or inventory volume.",
    suitable_dispositions: ["BLENDER_DIRECT"]
  },
  SHOW_METRIC: {
    description: "Displays quantitative measurements, gauges, or progress.",
    suitable_dispositions: ["BLENDER_DIRECT", "STATIC_GRAPHIC", "INFOGRAPHIC"]
  },
  SHOW_FAILURE: {
    description: "Depicts an error, blocked gate, rejected candidate, or crash.",
    suitable_dispositions: ["BLENDER_DIRECT", "SCREEN_CAPTURE", "STATIC_GRAPHIC"]
  },
  SHOW_BEFORE_AFTER: {
    description: "Direct before/after comparison of identical subjects.",
    suitable_dispositions: ["BLENDER_DIRECT", "AI_IMAGE", "INFOGRAPHIC"]
  },
  SHOW_INTERFACE: {
    description: "Displays software GUI, timeline, cockpit, or terminal.",
    suitable_dispositions: ["SCREEN_CAPTURE"]
  },
  SHOW_PERSON: {
    description: "Human host, emotional expression, lived authenticity.",
    suitable_dispositions: ["TALKING_HEAD", "PRESENTER_PROXY"]
  },
  ATMOSPHERE: {
    description: "Mood, tone, cinematic backdrop, or metaphor.",
    suitable_dispositions: ["AI_IMAGE", "AI_VIDEO", "BLENDER_AI_VIDEO_ANCHOR"]
  },
  TRANSITION: {
    description: "Narrative pacing shift between topics or sections.",
    suitable_dispositions: ["BLENDER_DIRECT", "STATIC_GRAPHIC", "NONE"]
  },
  NONE: {
    description: "No dedicated visual required; dialogue carries the beat.",
    suitable_dispositions: ["NONE", "TALKING_HEAD"]
  }
});

function isValidVisualFunction(fn) {
  return Boolean(VISUAL_FUNCTIONS[fn]);
}

function getVisualFunctionDefinition(fn) {
  return VISUAL_FUNCTIONS[fn] || null;
}

module.exports = {
  VISUAL_FUNCTIONS,
  isValidVisualFunction,
  getVisualFunctionDefinition
};
