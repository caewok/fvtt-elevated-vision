/* globals
canvas,
GlobalLightSource,
Token
*/
"use strict";

import { MODULE_ID } from "./const.js";

// NOTE: Polygon and Shader methods for CanvasVisibility

export const PATCHES = {};
PATCHES.WEBGL = {};

/**
 * Override CanvasVisibility.prototype.refreshVisibility
 * Use mask meshes instead of drawing shapes except for the basic shapes.
 * Requires several additions to work around private methods.
 * v11.302.
 * ---
 * Containers:
 * vision.base
 * vision.fov. 2 children:
 *   - vision.fov.lightsSprite
 *   - vision.fov.lights
 *   - vision.fov.tokens
 * vision.los. 1 child:
 *   - vision.los.preview
 * ---
 * Mask children added to:
 * - vision.los √
 * - vision.los.preview √
 * - vision.fov.tokens √
 * - vision.base √
 * - vision.fov.lights √
 */
function refreshVisibility() {
  if ( !this.vision?.children.length ) return;
  const fillColor = 0xFF0000;
  const vision = this.vision;

  // A flag to know if the lights cache render texture need to be refreshed
  let refreshCache = false;

  // A flag to know if fog need to be refreshed.
  let commitFog = false;

  // Checking if the lights cache need a full redraw
  // TODO: Can we force the cache to clear if a wall within the light radius changes?
  // let lightsFullRedraw = this.checkLights();
  let lightsFullRedraw = true;
  if ( lightsFullRedraw ) {
    this.pointSourcesStates.clear();
    vision.fov.lights.clear();
    vision.fov.lights.removeChildren();
  }

  vision.base.clear();
  vision.base.removeChildren();
  //vision.base.beginFill(fillColor, 1.0);

  //vision.fov.lights.beginFill(fillColor, 1.0);
  // Already cleared with lightsFullRedraw above.

  vision.fov.tokens.clear();
  vision.fov.tokens.removeChildren();
  // Currently unused
  // vision.fov.tokens.beginFill(fillColor, 1.0);

  vision.los.clear();
  if ( vision.los.children.length > 1 ) vision.los.removeChildren(1); // Keep the vision.los.preview child.
  // Currently unused
  // vision.los.beginFill(fillColor, 1.0);

  vision.los.preview.clear();
  vision.los.preview.removeChildren();
  // Currently unused
  // vision.los.preview.beginFill(fillColor, 1.0);

  // Iterating over each light source
  for ( const lightSource of canvas.effects.lightSources ) {
    const mask = lightSource.EVVisionMask;
    if ( !mask && !(lightSource instanceof GlobalLightSource) ) {
      console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|LightSource ${lightSource.object.id} has no mask.`);
    }

    // The light source is providing vision and has an active layer?
    if ( lightSource.active && lightSource.data.vision ) {
      // Global light will have data.vision = false.
      const los = lightSource.isPreview ? vision.los.preview : vision.los;
      los.addChild(mask);
    }

    // The light source is emanating from a token?
    if ( lightSource.object instanceof Token ) {
      // Global light cannot emanate from a token.
      if ( !lightSource.active ) continue;
      const los = lightSource.isPreview ? vision.base : vision.fov.tokens;
      const mask = lightSource[MODULE_ID].shadowVisionMask;
      los.addChild(mask);
      continue;
    }

    // Determine whether this light source needs to be drawn to the texture
    let draw = lightsFullRedraw;
    if ( !lightsFullRedraw ) {
      const priorState = this.pointSourcesStates.get(lightSource);
      if ( !priorState || priorState.wasActive === false ) draw = lightSource.active;
    }

    // Save the state of this light source
    this.pointSourcesStates.set(lightSource,
      {wasActive: lightSource.active, updateId: lightSource.updateId});

    if ( !lightSource.active ) continue;
    refreshCache = true;
    if ( draw ) vision.fov.lights.addChild(mask);

  }

  // Do we need to cache the lights into the lightsSprite render texture?
  // Note: With a full redraw, we need to refresh the texture cache, even if no elements are present
  if ( refreshCache || lightsFullRedraw ) this.cacheLights(lightsFullRedraw);

  // Iterating over each vision source
  for ( const visionSource of canvas.effects.visionSources ) {
    if ( !visionSource.active ) continue;

    const fovMask = visionSource.EVVisionMask;
    const losMask = visionSource.EVVisionLOSMask;
    if ( !fovMask ) console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|visionSource ${visionSource.object.id} has no fov mask.`);
    if ( !losMask ) console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|visionSource ${visionSource.object.id} has no los mask.`);

    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( (visionSource.radius > 0) && !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.fov.tokens.addChild(fovMask);
    } else {
      vision.base.beginFill(fillColor, 1.0);
      vision.base.drawShape(visionSource.fov);
      vision.base.endFill();
    }
    // Draw LOS mask (with exception for blinded tokens)
    if ( !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.los.addChild(losMask);
      commitFog = true;
    } else vision.los.preview.addChild(visionSource.data.blinded ? fovMask : losMask);
  }

  // Fill operations are finished for LOS and FOV lights and tokens
  // vision.base.endFill();
  // vision.fov.lights.endFill();

  // Not needed with the masks:
  // vision.fov.tokens.endFill();
  // vision.los.endFill();
  // vision.los.preview.endFill();

  // Update fog of war texture (if fow is activated)
  if ( commitFog ) canvas.fog.commit();
}

PATCHES.WEBGL.OVERRIDES = { refreshVisibility };

// TODO: Use refreshVisibility override for polygons as well? What about "none"?

/**
 * Wrap CanvasVisibility.prototype._tearDown
 * Clear the pointSourcesStates in tear down.
 */
async function _tearDown(wrapped, options) {
  this.pointSourcesStates.clear();
  return wrapped(options);
}

PATCHES.WEBGL.WRAPS = { _tearDown };

/**
 * Copy CanvasVisibility.prototype.#checkLights into public method.
 * Required to override CanvasVisibility.prototype.refreshVisibility.
 * Assumes this.#pointSourcesStates is made public
 * ---
 * Check if the lightsSprite render texture cache needs to be fully redrawn.
 * @returns {boolean}              return true if the lights need to be redrawn.
 */
function checkLights() {
  // Counter to detect deleted light source
  let lightCount = 0;
  // First checking states changes for the current effects lightsources
  for ( const lightSource of canvas.effects.lightSources ) {
    if ( lightSource.object instanceof Token ) continue;
    const state = this.pointSourcesStates.get(lightSource);
    if ( !state ) continue;
    if ( (state.updateId !== lightSource.updateId) || (state.wasActive && !lightSource.active) ) return true;
    lightCount++;
  }
  // Then checking if some lightsources were deleted
  return this.pointSourcesStates.size > lightCount;
}


/**
 * Copy CanvasVisibility.prototype.#cacheLights to a public method.
 * Required to override CanvasVisibility.prototype.refreshVisibility.
 * Relies on fact that vision.fov.lightsSprite = this.#lightsSprite
 * Assumes a public renderTransform = new PIXI.Matrix has been defined
 * ---
 * Cache into the lightsSprite render texture elements contained into vision.fov.lights
 * Note: A full cache redraw needs the texture to be cleared.
 * @param {boolean} clearTexture       If the texture need to be cleared before rendering.
 */
function cacheLights(clearTexture) {
  this.vision.fov.lights.renderable = true;
  const dims = canvas.dimensions;
  this.renderTransform.tx = -dims.sceneX;
  this.renderTransform.ty = -dims.sceneY;

  // Render the currently revealed vision to the texture
  canvas.app.renderer.render(this.vision.fov.lights, {
    renderTexture: this.vision.fov.lightsSprite.texture,
    clear: clearTexture,
    transform: this.renderTransform
  });
  this.vision.fov.lights.renderable = false;
}

PATCHES.WEBGL.METHODS = {
  checkLights,
  cacheLights,
  renderTransform: new PIXI.Matrix(),
  pointSourcesStates: new Map()
};
