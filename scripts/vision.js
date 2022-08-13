/* globals
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { Shadow } from "./Shadow.js";

/** To test a token
drawing = game.modules.get("elevatedvision").api.drawing
drawing.clearDrawings()
_token.vision.los._drawShadows()

*/

// AdaptiveVisionShader extends AdaptiveLightingShader, so need not repeat here.

// _updateColorationUniforms basically same as LightSource
// _updateIlluminationUniforms basically same as LightSource
// _updateEVLightUniforms can be reused from LightSource

/**
 * Wrap VisionSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateColorationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.coloration.shader);
  this.coloration.shader.uniforms.EV_isVision = true;
}

/**
 * Wrap VisionSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateIlluminationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.illumination.shader);
  this.illumination.shader.uniforms.EV_isVision = true;
}

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




// Below does not appear to do anything, good or bad.
// export function _updateMeshVisionSource(wrapped, mesh) {
//   // add shadow mask
//
//   log("_updateMeshVisionSource");
//
//   const shadowWalls = this.los.edgesBelowSource;
//   if ( !shadowWalls || !shadowWalls.size ) return;
//
//   log("_updateMeshVisionSource shadow walls encountered");
//
//   mesh.mask = new PIXI.Container;
//
//   for ( const w of shadowWalls ) {
//     const shadow = Shadow.constructShadow(w, this.los.config.source);
//     if ( !shadow ) continue;
//     const g = mesh.mask.addChild(new PIXI.LegacyGraphics());
//     g.beginFill(0x000000, 1.0).drawShape(shadow).endFill();
//   }
//
//   return wrapped(mesh);
// }
