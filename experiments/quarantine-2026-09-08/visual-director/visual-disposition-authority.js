/**
 * VISUAL DISPOSITION AUTHORITY V1
 * Defines the canonical mediums through which a visual beat can be realized in production.
 */

const VISUAL_DISPOSITIONS = Object.freeze({
  TALKING_HEAD: {
    description: "Camera A-roll on human presenter (Mikko Pakkala).",
    requires_asset: false,
    execution_engine: "PRESENTER_CAMERA"
  },
  BLENDER_DIRECT: {
    description: "3D procedural diagram, pipeline, hierarchy, or metric rendered via Blender Cycles/EEVEE.",
    requires_asset: true,
    execution_engine: "VIDTOOLZ_BLENDER_COMPILER"
  },
  BLENDER_AI_VIDEO_ANCHOR: {
    description: "Blender-rendered structural anchor frame handed to Wan2.2/Kling for I2V generation.",
    requires_asset: true,
    execution_engine: "VIDTOOLZ_BLENDER_WAN_PIPELINE"
  },
  AI_IMAGE: {
    description: "Generative 2D conceptual plate or metaphorical still.",
    requires_asset: true,
    execution_engine: "MIDJOURNEY_OR_DALLE"
  },
  AI_VIDEO: {
    description: "Text-to-video or pure generative cinematic shot without geometric constraints.",
    requires_asset: true,
    execution_engine: "WAN_OR_KLING"
  },
  SCREEN_CAPTURE: {
    description: "Terminal recording, code diff, Resolve timeline, or desktop capture.",
    requires_asset: true,
    execution_engine: "OBS_OR_HEADLESS_CDP"
  },
  INFOGRAPHIC: {
    description: "2D typographical card, lower third, or static chart.",
    requires_asset: true,
    execution_engine: "RESOLVE_TITLES_OR_HTML"
  },
  UNREAL: {
    description: "Real-time 3D camera move through virtual set or imported glTF asset.",
    requires_asset: true,
    execution_engine: "UNREAL_ENGINE_5"
  },
  STOCK: {
    description: "Archival footage or licensed external b-roll.",
    requires_asset: true,
    execution_engine: "EXTERNAL_MEDIA_LIBRARY"
  },
  NONE: {
    description: "Pure dialogue beat with presenter on camera or continuing prior plate.",
    requires_asset: false,
    execution_engine: "PASSTHROUGH"
  }
});

function isValidVisualDisposition(disp) {
  return Boolean(VISUAL_DISPOSITIONS[disp]);
}

module.exports = {
  VISUAL_DISPOSITIONS,
  isValidVisualDisposition
};
