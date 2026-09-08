/**
 * BLENDER VISUAL MAPPER V1
 * Deterministically maps high-level Visual Director concepts to SceneSpec V1 constructs.
 * Preferentially maps to qualified compositions (C01-C08) before raw primitives.
 */

function mapIntentToSceneSpec(beat) {
  const {
    scene_id,
    visual_function,
    visual_concept = "",
    continuity_group = null,
    style_profile = "VIDTOOLZ_EXPLAINER_V1"
  } = beat;

  const spec = {
    scene_id: scene_id || `scene_${Date.now()}`,
    scene_type: "explainer",
    aspect_ratio: "9:16",
    visual_intent: visual_concept || `Visualize ${visual_function}`,
    style_profile: style_profile,
    layout_mode: "vertical_stack",
    disposition: beat.disposition || "DIRECT_BLENDER",
    continuity_group: continuity_group,
    camera: {
      mode: "overview",
      focal_length_mm: 50.0
    },
    primitives: [],
    relationships: []
  };

  // Rule 1: SHOW_CONSTRAINT / SHOW_ACCUMULATION -> C02 Bottleneck Pipeline
  if (visual_function === "SHOW_CONSTRAINT" || visual_function === "SHOW_ACCUMULATION") {
    spec.layout_mode = "vertical_stack";
    spec.primitives = [
      { primitive: "stage", id: "stage_intake", label: "INTAKE_QUEUE", state: "complete" },
      { primitive: "stage", id: "stage_bottleneck", label: "CONSTRAINED_GATE", state: "blocked" },
      { primitive: "blockage", id: "blockage_barrier", attached_to: "stage_bottleneck" },
      { primitive: "queue", id: "queue_backlog", attached_to: "stage_bottleneck", count: 7 },
      { primitive: "stage", id: "stage_deliverable", label: "PUBLISHED_CANON", state: "inactive" }
    ];
    spec.relationships = [
      { type: "flow", from: "stage_intake", to: "stage_bottleneck" },
      { type: "flow", from: "stage_bottleneck", to: "stage_deliverable", state: "blocked" }
    ];
    spec.focus_primitive = "stage_bottleneck";
    return spec;
  }

  // Rule 2: COMPARE / SHOW_BEFORE_AFTER -> C03 Before / After Split
  if (visual_function === "COMPARE" || visual_function === "SHOW_BEFORE_AFTER") {
    spec.layout_mode = "horizontal_split";
    spec.camera.mode = "comparison";
    spec.primitives = [
      { primitive: "comparison", id: "side_a_manual", label: "CHAOTIC_PROMPT", state: "failed" },
      { primitive: "comparison", id: "side_b_system", label: "GATED_PIPELINE", state: "complete" },
      { primitive: "blockage", id: "defect_wall", attached_to: "side_a_manual" },
      { primitive: "focus", id: "system_focus", attached_to: "side_b_system" }
    ];
    return spec;
  }

  // Rule 3: SHOW_FLOW / SHOW_CAUSALITY -> C01 Linear Pipeline
  if (visual_function === "SHOW_FLOW" || visual_function === "SHOW_CAUSALITY") {
    spec.layout_mode = "vertical_stack";
    spec.primitives = [
      { primitive: "stage", id: "stage_source", label: "RESEARCH_INPUT", state: "complete" },
      { primitive: "stage", id: "stage_process", label: "SCRIPT_DIRECTION", state: "active" },
      { primitive: "stage", id: "stage_output", label: "RENDERED_ASSET", state: "neutral" }
    ];
    spec.relationships = [
      { type: "flow", from: "stage_source", to: "stage_process" },
      { type: "flow", from: "stage_process", to: "stage_output" }
    ];
    return spec;
  }

  // Rule 4: SHOW_HIERARCHY -> C06 Hierarchy Tree
  if (visual_function === "SHOW_HIERARCHY") {
    spec.layout_mode = "hierarchical_tree";
    spec.primitives = [
      { primitive: "hierarchy", id: "node_governor", label: "HUMAN_OPERATOR", state: "selected" },
      { primitive: "hierarchy", id: "node_orchestrator", label: "HERMES_AGENT", state: "active", parent: "node_governor" },
      { primitive: "stage", id: "director_visual", label: "VISUAL_DIRECTOR", state: "active", parent: "node_orchestrator" },
      { primitive: "stage", id: "tool_executor", label: "BLENDER_ENGINE", state: "complete", parent: "director_visual" }
    ];
    spec.relationships = [
      { type: "dependency", from: "node_governor", to: "node_orchestrator" },
      { type: "dependency", from: "node_orchestrator", to: "director_visual" },
      { type: "dependency", from: "director_visual", to: "tool_executor" }
    ];
    return spec;
  }

  // Rule 5: SHOW_TRANSFORMATION -> C05 Transformation Gateway
  if (visual_function === "SHOW_TRANSFORMATION") {
    spec.layout_mode = "vertical_stack";
    spec.primitives = [
      { primitive: "stage", id: "raw_material", label: "RAW_GENERATION", state: "neutral" },
      { primitive: "transformation", id: "transform_chamber", label: "EDITORIAL_FILTER", state: "selected" },
      { primitive: "stage", id: "curated_result", label: "DEFENSIBLE_STANCE", state: "complete" }
    ];
    spec.relationships = [
      { type: "flow", from: "raw_material", to: "curated_result" }
    ];
    spec.focus_primitive = "transform_chamber";
    return spec;
  }

  // Rule 6: SHOW_METRIC -> Gauge / Progress Metric
  if (visual_function === "SHOW_METRIC") {
    spec.layout_mode = "vertical_stack";
    spec.primitives = [
      { primitive: "stage", id: "target_system", label: "CAPACITY_MONITOR", state: "active" },
      { primitive: "metric", id: "throughput_gauge", label: "VERIFIED_QUALITY", value: 92, max_value: 100 },
      { primitive: "focus", id: "metric_focus", attached_to: "target_system" }
    ];
    return spec;
  }

  // Default fallback
  spec.primitives = [
    { primitive: "stage", id: "default_stage", label: "SYSTEM_BEAT", state: "active" }
  ];
  return spec;
}

module.exports = {
  mapIntentToSceneSpec
};
