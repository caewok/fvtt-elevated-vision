/* globals
canvas,
GlobalLightSource,
Token
*/
"use strict";

import { MODULE_ID } from "./const.js";

import { Draw } from "./geometry/Draw.js";

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
  let lightsFullRedraw = this.checkLights();
  if ( lightsFullRedraw ) {
    this.pointSourcesStates.clear();
    vision.fov.lights.clear();
  }
  vision.base.clear();
  vision.base.beginFill(fillColor, 1.0);
  vision.fov.lights.beginFill(fillColor, 1.0);
  vision.fov.tokens.clear();
  vision.fov.tokens.beginFill(fillColor, 1.0);

  vision.los.clear();
  vision.los.beginFill(fillColor, 1.0);
  vision.los.preview.clear();
  vision.los.preview.beginFill(fillColor, 1.0);

  // Iterating over each light source
  for ( const lightSource of canvas.effects.lightSources ) {
    // The light source is providing vision and has an active layer?
    if ( lightSource.active && lightSource.data.vision ) {
      if ( !lightSource.isPreview ) vision.los.drawShape(lightSource.shape);
      else vision.los.preview.drawShape(lightSource.shape);
    }

    // The light source is emanating from a token?
    if ( lightSource.object instanceof Token ) {
      if ( !lightSource.active ) continue;
      if ( !lightSource.isPreview ) vision.fov.tokens.drawShape(lightSource.shape);
      else vision.base.drawShape(lightSource.shape);
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
    if ( draw ) vision.fov.lights.drawShape(lightSource.shape);
  }

  // Do we need to cache the lights into the lightsSprite render texture?
  // Note: With a full redraw, we need to refresh the texture cache, even if no elements are present
  if ( refreshCache || lightsFullRedraw ) this.cacheLights(lightsFullRedraw);

  // Iterating over each vision source
  for ( const visionSource of canvas.effects.visionSources ) {
    if ( !visionSource.active ) continue;
    // Draw FOV polygon or provide some baseline visibility of the token's space
    if ( (visionSource.radius > 0) && !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.fov.tokens.drawShape(visionSource.fov);
    } else vision.base.drawShape(visionSource.fov);
    // Draw LOS mask (with exception for blinded tokens)
    if ( !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.los.drawShape(visionSource.los);
      commitFog = true;
    } else vision.los.preview.drawShape(visionSource.data.blinded ? visionSource.fov : visionSource.los);
  }

  // Fill operations are finished for LOS and FOV lights and tokens
  vision.base.endFill();
  vision.fov.lights.endFill();
  vision.fov.tokens.endFill();
  vision.los.endFill();
  vision.los.preview.endFill();

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
