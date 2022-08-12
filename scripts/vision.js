/* globals
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

/** To test a token
drawing = game.modules.get("elevatedvision").api.drawing
drawing.clearDrawings()
_token.vision.los._drawShadows()

*/

// AdaptiveVisionShader extends AdaptiveLightingShader, so need not repeat here.

// _updateColorationUniforms basically same as LightSource
// _updateIlluminationUniforms basically same as LightSource
// _updateEVLightUniforms can be reused from LightSource

// Currently no VisionSource.prototype._createLOS.
// So must instead wrap initialize

/**
 * Wrap VisionSource.prototype.initialize
 * Trigger an update to the illumination and coloration uniforms, so that
 * the light reflects the current shadow positions when dragged.
 */
export function initializeVisionSource(wrapped) {
  const out = wrapped();

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  out._resetUniforms.illumination = true;
  out._resetUniforms.coloration = true;

  return out;
}
