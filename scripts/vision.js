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
 * This version draws the FOV and LOS polygons with holes, which creates shadows for
 * walls below the source, but does not (a) make higher terrain in the shadow visible or
 * (b) shadow terrain higher than the viewer.
 */
export function refreshCanvasVisibilityPolygons({forceUpdateFog=false}={}) {
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
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.fov });
    } else {
      vision.fov.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
    }

    if ( lightSource.data.vision ) {
      if ( shadows.length ) {
        drawPolygonWithHoles(shadows, { graphics: vision.los });
      } else {
        vision.los.beginFill(0xFFFFFF, 1.0).drawShape(lightSource.los).endFill();
      }
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
    if ( shadows.length ) {
      drawPolygonWithHoles(shadows, { graphics: vision.los });
    } else {
      vision.los.beginFill(0xFFFFFF, 1.0).drawShape(visionSource.los).endFill();
    }

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


// VisionContainerClass so that certain properties can be overriden
export class EVVisionContainer extends PIXI.Container {
  constructor() {
    super();

    this.base = this.addChild(new PIXI.LegacyGraphics());
    this.fov = this.addChild(new PIXI.LegacyGraphics());

    // Store the LOS separately from the container children
    // Will use in _render to construct sprite mask
    this.los = new PIXI.LegacyGraphics();
    this.mask = this.addChild(new PIXI.Sprite());

    this._explored = false;
  }

  _renderLOS() {
    // Return reusable RenderTexture to the pool
    if ( this.mask.texture instanceof PIXI.RenderTexture ) canvas.masks.vision._EV_textures.push(this.mask.texture);
    else this.mask.texture?.destroy();

    const tex = canvas.masks.vision._getEVTexture();
    canvas.app.renderer.render(this.los, tex);
    this.mask.texture = tex;
  }


  // Failing for some reason; may revisit as alternative to explicitly calling
  // _renderLOS. The latter is likely more performant, as it can be called outside the
  // render loop.
//   _render() {
//    //  if ( this.los ) {
// //       const tex = canvas.masks.vision._getEVTexture();
// //       canvas.app.renderer.render(this.los, tex);
// //
// //       // Return reusable RenderTexture to the pool
// // //     if ( this.mask.texture instanceof PIXI.RenderTexture ) canvas.masks.vision._EV_textures.push(this.mask.texture);
// // //     else this.mask.texture?.destroy();
// //       this.mask.texture = tex;
// //       this.los.destroy(true);
// //       this.los = undefined;
// //     }
//
//     super._render();
//   }

  destroy(options) {
    if ( this.los ) this.los.destroy(true);
    this.los = undefined;

    // Return reusable RenderTexture to the pool
    if ( this.mask.texture instanceof PIXI.RenderTexture ) canvas.masks.vision._EV_textures.push(this.mask.texture);
    else this.mask.texture?.destroy();
    this.mask.texture = undefined;

    super.destroy(options)
  }
}


/**
 * Override CanvasVisionMask.prototype.createVision
 * Only when combined with refreshCanvasVisibilityShader.
 * Need to be able to add graphics children so that ShadowLOSFilter can be applied
 * per light or vision source. Cannot filter the parent b/c cannot distinguish which
 * source is responsible for which graphic shape unless each source has its own PIXI.Graphics.
 *
 * - Masking only works with PIXI.Graphics or PIXI.Sprite. Unlikely to work with
 *    filters on graphics b/c they would likely be applied too late.
 * See https://ptb.discord.com/channels/732325252788387980/734082399453052938/1013856472419008593
 * for potential work-around.
 *
 * Using a switch in settings for now b/c of the high risk of breaking other stuff when
 * messing with the vision and vision mask.
 */
export function createVisionCanvasVisionMask() {
  const vision = new EVVisionContainer();
  return this.vision = this.addChild(vision);
}

export function _getEVTexture() {
  if ( this._EV_textures.length ) {
    const tex = this._EV_textures.pop();
    if ( tex.valid ) return tex;
  }
  return PIXI.RenderTexture.create({
    width: canvas.dimensions.width,
    height: canvas.dimensions.height,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE });
}

// export function _renderLOSMaskCanvasVisionMask() {
//   // Create a staging texture and render the LOS container to it.
//   const tex = this._getEVTexture();
//   canvas.app.renderer.render(this.vision.los, tex);
//
//   // Return reusable RenderTexture to the pool
//   if ( this._EV_sprite.texture instanceof PIXI.RenderTexture ) this._EV_textures.push(this._EV_sprite.texture);
//   else this._EV_sprite.texture?.destroy();
//   this._EV_sprite.texture = tex;
//
//   //
//   this.vision.los.destroy(true);
//   this.vision.los = undefined;
//
// }


export function clearCanvasVisionMask(wrapped) {
  while ( this._EV_textures.length ) {
    const t = this._EV_textures.pop();
    t.destroy(true);
  }

  wrapped();
}

export function refreshCanvasVisibilityShader({forceUpdateFog=false}={}) {
  if ( !this.initialized ) return;
  if ( !this.tokenVision ) {
    this.visible = false;
    return this.restrictVisibility();
  }

  log("refreshCanvasVisibilityShader");

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

    // At least for now, GlobalLightSource cannot provide vision.
    // No shadows possible for the global light source
    if ( lightSource instanceof GlobalLightSource ) continue;

    const shadowFilter = ShadowLOSFilter.create({}, lightSource);
    g.filters = [shadowFilter];

    if ( lightSource.data.vision ) {
      const g = vision.los.addChild(new PIXI.LegacyGraphics());
      g.filters = [shadowFilter];
      g.beginFill(fillColor, 1.0).drawShape(lightSource.los).endFill();
    }
  }

  // Draw sight-based visibility for each vision source
  for ( let visionSource of canvas.effects.visionSources ) {
    visionSource.active = true;
    const shadowFilter = ShadowLOSFilter.create({}, visionSource);

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( visionSource.radius > 0 ) {
      const g = vision.fov.addChild(new PIXI.LegacyGraphics());
      g.beginFill(fillColor, 1.0).drawShape(visionSource.fov).endFill();
      g.filters = [shadowFilter];
    } else {
      const baseR = canvas.dimensions.size / 2;
      vision.base.beginFill(fillColor, 1.0).drawCircle(visionSource.x, visionSource.y, baseR).endFill();
    }

    const g = vision.los.addChild(new PIXI.LegacyGraphics());
    g.beginFill(fillColor, 1.0).drawShape(visionSource.los).endFill();
    g.filters = [shadowFilter];

    // Record Fog of war exploration
    if ( canvas.fog.update(visionSource, forceUpdateFog) ) vision._explored = true;
  }

  // Update the LOS mask sprite
  log(`Rendering LOS Mask. texture valid? ${vision.mask.texture?.valid}`);
  vision._renderLOS();
//
// //   canvas.app.renderer.render(vision.los, vision.mask.texture);
  log(`Finished rendering LOS Mask. texture valid? ${vision.mask.texture?.valid}`);

  // Commit updates to the Fog of War texture
  if ( commitFog ) canvas.fog.commit();

  // Alter visibility of the vision layer
  this.visible = canvas.effects.visionSources.size || !game.user.isGM;

  // Restrict the visibility of other canvas objects
  this.restrictVisibility();
}
