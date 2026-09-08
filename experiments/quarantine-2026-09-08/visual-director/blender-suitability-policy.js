/**
 * BLENDER SUITABILITY POLICY V1
 * Evaluates whether a visual beat should be assigned to Blender or another medium.
 * Actively penalizes tool-bias and rejects Blender when unsuitable.
 */

function evaluateBlenderSuitability(beatContext) {
  const {
    visual_function,
    dialogue_snippet = "",
    requires_human_emotion = false,
    requires_real_ui = false,
    requires_photorealism = false,
    requires_exact_topology = false,
    has_diagrammatic_content = false,
    candidate_primitives = []
  } = beatContext;

  // Immediate hard vetoes against Blender
  if (requires_human_emotion || visual_function === "SHOW_PERSON") {
    return {
      suitable: false,
      score: 0.05,
      recommended_disposition: "TALKING_HEAD",
      reason: "Human personal identity and lived emotion must be carried on camera, not synthetic 3D."
    };
  }

  if (requires_real_ui || visual_function === "SHOW_INTERFACE") {
    return {
      suitable: false,
      score: 0.10,
      recommended_disposition: "SCREEN_CAPTURE",
      reason: "Software interfaces, code, and terminals require authentic screen capture rather than reconstructed 3D."
    };
  }

  if (visual_function === "NONE") {
    return {
      suitable: false,
      score: 0.0,
      recommended_disposition: "NONE",
      reason: "No visual needed; dialogue carries the narrative beat."
    };
  }

  // Positive scoring factors
  let score = 0.5;

  const proceduralFunctions = [
    "SHOW_FLOW", "SHOW_CONSTRAINT", "SHOW_ACCUMULATION", "SHOW_HIERARCHY",
    "SHOW_TRANSFORMATION", "SHOW_METRIC", "SHOW_BEFORE_AFTER", "COMPARE", "EXPLAIN",
    "SHOW_FAILURE", "ATMOSPHERE"
  ];

  if (proceduralFunctions.includes(visual_function)) {
    score += 0.3;
  }

  if (requires_exact_topology || has_diagrammatic_content) {
    score += 0.2;
  }

  if (candidate_primitives.length >= 2) {
    score += 0.1;
  }

  // Negative scoring factors
  if (requires_photorealism) {
    score -= 0.35;
  }

  // Anchor vs Direct disposition determination
  if (score >= 0.75) {
    if (requires_photorealism || beatContext.requires_cinematic_motion || visual_function === "ATMOSPHERE") {
      return {
        suitable: true,
        score: Math.min(score, 1.0),
        recommended_disposition: "BLENDER_AI_VIDEO_ANCHOR",
        reason: "Structural geometry benefits from Blender layout, while cinematic motion/lighting benefits from I2V continuation."
      };
    } else {
      return {
        suitable: true,
        score: Math.min(score, 1.0),
        recommended_disposition: "BLENDER_DIRECT",
        reason: "Exact procedural topology, stable nodes, and clean metrics require deterministic direct Blender rendering."
      };
    }
  }

  // Default rejection to alternative mediums
  const fallback = requires_photorealism ? "AI_IMAGE" : "TALKING_HEAD";
  return {
    suitable: false,
    score: Math.max(score, 0.1),
    recommended_disposition: fallback,
    reason: `Blender suitability score (${score.toFixed(2)}) below admission threshold (0.75). Route to ${fallback}.`
  };
}

module.exports = {
  evaluateBlenderSuitability
};
