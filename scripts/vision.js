/* globals
canvas,
GlobalLightSource,
FogManager,
game,
PIXI
*/
"use strict";

import { log, drawPolygonWithHoles, perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { ShadowLOSFilter } from "./ShadowLOSFilter.js";

const MAX_NUM_WALLS = 100;

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

//   log(`_updateColorationUniformsVisionSource ${this.object.id}`);

  // Not sure yet how to handle elevation with vision.
  // Two components enter into this: vision and FOW (VisiblityFilter)
//   this._updateEVVisionUniforms(this.coloration);
//   this.coloration.shader.uniforms.EV_isVision = true;
}

/**
 * Wrap VisionSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

//   log(`_updateIlluminationUniformsVisionSource ${this.object.id}`);
//   this._updateEVVisionUniforms(this.illumination);
//   this.illumination.shader.uniforms.EV_isVision = true;
}

/**
 * Wrap VisionSource.prototype._updateBackgroundUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateBackgroundUniformsVisionSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

//   log(`_updateBackgroundUniformsVisionSource ${this.object.id}`);
//   this._updateEVVisionUniforms(this.background);
//   this.background.shader.uniforms.EV_isVision = true;
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

/**
 * Override CanvasVisionMask.prototype.createVision
 * Need to be able to add graphics children so that ShadowLOSFilter can be applied
 * per light or vision source. Cannot filter the parent b/c cannot distinguish which
 * source is responsible for which graphic shape unless each source has its own PIXI.Graphics.
 * Two issues:
 * 1. PIXI.Graphics only work as containers in part. Drawing in the parent and the
 *    children results in only the parent displaying.
 * 2. Masking only works with PIXI.Graphics or PIXI.Sprite. Unlikely to work with
 *    filters on graphics b/c they would likely be applied too late.
 */
export function createVisionCanvasVisionMask() {
  const vision = new PIXI.Container();
  vision.base = vision.addChild(new PIXI.LegacyGraphics());
  vision.fov = vision.addChild(new PIXI.Container());
  vision.los = vision.addChild(new PIXI.Container());
  vision.losMask = vision.addChild(new PIXI.LegacyGraphics());
  vision.mask = vision.losMask;
  vision._explored = false;
  return this.vision = this.addChild(vision);
}

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
  const fillColor = 0xFF0000;

  // Draw field-of-vision for lighting sources
  for ( let lightSource of canvas.effects.lightSources ) {
    if ( !canvas.effects.visionSources.size || !lightSource.active || lightSource.disabled ) continue;
    const g = vision.fov.addChild(new PIXI.LegacyGraphics())
    g.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();

    if ( !(lightSource instanceof GlobalLightSource )) {
      // No shadows possible for the global light source
//       const shadowFilter = ShadowLOSFilter.create({}, lightSource);
//       g.filters = [shadowFilter];
    }

    if ( lightSource.data.vision ) {
      const g = vision.los.addChild(new PIXI.LegacyGraphics());
//       g.filters = [shadowFilter];
      g.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();
       vision.losMask.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      const g = vision.fov.addChild(new PIXI.LegacyGraphics());
      //       g.filters = [shadowFilter];
      g.beginFill(fillColor, 1.0).drawShape(visionSource.fov).endFill();
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(fillColor, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    const g = vision.los.addChild(new PIXI.LegacyGraphics());
//     const shadowFilter = ShadowLOSFilter.create({}, visionSource);
//     g.filters = [shadowFilter];
     g.beginFill(fillColor, 1.0).drawShape(visionSource.los).endFill();
     vision.losMask.beginFill(fillColor, 1.0).drawShape(visionSource.los).endFill();

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
