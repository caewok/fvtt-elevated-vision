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
//   const shadowWalls = this.los.wallsBelowSource;
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


/**
 * Override CanvasVisibility.prototype.refresh to handle shadows.
 */

export function refreshCanvasVisibility({forceUpdateFog=false}={}) {
  if ( !this.initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  // Stage the priorVision vision container to be saved to the FOW texture
  let commitFog = false;
  const priorVision = canvas.masks.vision.detachVision();
  if ( priorVision._explored ) {
    this.pending.addChild(priorVision);
    commitFog = this.pending.children.length >= FogManager.COMMIT_THRESHOLD;
  }
  else priorVision.destroy({children: true});

  // Create a new vision for this frame
  const vision = canvas.masks.vision.createVision();

  // Draw field-of-vision for lighting sources
  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;
    const shadows = lightSource.los.combinedShadows || [];
    vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
    drawShadowHoles(vision.fov, shadows); // Works b/c the shadows previously trimmed to lightSource.los
    vision.los.endFill();

    if ( lightSource.data.vision ) {
      vision.los.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
      drawShadowHoles(vision.los, shadows); // Works b/c the shadows previously trimmed to lightSource.los
      vision.los.endFill();
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;
    const shadows = visionSource.los.combinedShadows || [];

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.fov).endFill();
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(0xFFFFFF, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    // Draw LOS mask
    vision.los.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.los);
    drawShadowHoles(vision.los, shadows) // Works b/c the shadows previously trimmed to visionSource.los
    vision.los.endFill();

    // Record Fog of war exploration
    if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
  }


  // Commit updates to the Fog of War texture
  if ( commitFog ) canvas.fog.commit();

  // Alter visibility of the vision layer
  this.visible = canvas.effects.visionSources.size || !game.user.isGM;

  // Restrict the visibility of other canvas objects
  this.restrictVisibility();
}

/**
 * Helper function to draw shadows as holes for a given graphics
 * @param {Shadow[]} shadows    Array of shadows
 * @param {PIXI.Graphics} graphics
 */
function drawShadowHoles(graphics, shadows) {
  for ( const shadow of shadows ) {
    graphics.beginHole();
    graphics.drawShape(shadow);
    graphics.endHole();
  }
}
