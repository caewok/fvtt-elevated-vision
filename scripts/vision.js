/* globals
canvas,
ClockwiseSweepPolygon,
GlobalLightSource,
Token,
TokenDocument
*/
"use strict";

import { getSceneSetting, SETTINGS } from "./settings.js";
import { MODULE_ID } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

// NOTE: Polygon and Shader methods

/**
 * Wrap PIXI.Graphics.drawShape.
 * If passed a polygon with an array of polygons property, use that to draw with holes.
 */
export function drawShapePIXIGraphics(wrapped, shape) {
  if ( !(shape instanceof ClockwiseSweepPolygon) ) return wrapped(shape);

  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const shaderAlgorithm = getSceneSetting(ALGORITHM) ?? TYPES.NONE;
  if ( (shaderAlgorithm === TYPES.POLYGONS || shaderAlgorithm === TYPES.WEBGL) && Object.hasOwn(shape, "_evPolygons") ) {
    for ( const poly of shape._evPolygons ) {
      if ( poly.isHole ) {
        this.beginHole();
        this.drawShape(poly);
        this.endHole();
      } else this.drawShape(poly);
    }
  } else {
    return wrapped(shape);
  }

  return this;
}


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
export function refreshVisibilityCanvasVisibility() {
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
  vision.base.beginFill(fillColor, 1.0);

  vision.fov.lights.beginFill(fillColor, 1.0);
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
    } else vision.base.drawShape(visionSource.fov);
    // Draw LOS mask (with exception for blinded tokens)
    if ( !visionSource.data.blinded && !visionSource.isPreview ) {
      vision.los.addChild(losMask);
      commitFog = true;
    } else vision.los.preview.addChild(visionSource.data.blinded ? fovMask : losMask);
  }

  // Fill operations are finished for LOS and FOV lights and tokens
  vision.base.endFill();
  vision.fov.lights.endFill();

  // Not needed with the masks:
  // vision.fov.tokens.endFill();
  // vision.los.endFill();
  // vision.los.preview.endFill();

  // Update fog of war texture (if fow is activated)
  if ( commitFog ) canvas.fog.commit();
}

/**
 * Copy CanvasVisibility.prototype.#checkLights into public method.
 * Required to override CanvasVisibility.prototype.refreshVisibility.
 * Assumes this.#pointSourcesStates is made public
 * ---
 * Check if the lightsSprite render texture cache needs to be fully redrawn.
 * @returns {boolean}              return true if the lights need to be redrawn.
 */
export function checkLightsCanvasVisibility() {
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
 * Wrap CanvasVisibility.prototype._tearDown
 * Clear the pointSourcesStates in tear down.
 */
export async function _tearDownCanvasVisibility(wrapped, options) {
  this.pointSourcesStates.clear();
  return wrapped(options);
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
export function cacheLightsCanvasVisibility(clearTexture) {
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

/**
 * Override DetectionMode.prototype._testLOS
 * Test using shadow texture or ray-wall collisions
 */
export function _testLOSDetectionMode(visionSource, mode, target, test) {
  // LOS has no radius limitation.
  if ( !this._testAngle(visionSource, mode, target, test) ) return false;

  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === undefined ) {
    hasLOS = visionSource.targetInShadow(target, test.point) < 0.5;
    test.los.set(visionSource, hasLOS);
  }
  return hasLOS;
}

/**
 * Override DetectionModeBasicSight.prototype._testPoint
 * Test using shadow texture or ray-wall collisions
 */
export function _testPointDetectionModeBasicSight(visionSource, mode, target, test) {
  if ( !this._testLOS(visionSource, mode, target, test) ) return false;
  if ( this._testRange(visionSource, mode, target, test) ) return true;

  for ( const lightSource of canvas.effects.lightSources.values() ) {
    if ( !lightSource.active ) continue;
    if ( lightSource instanceof GlobalLightSource ) return true;
    if ( !testWithinRadius(lightSource, test) ) continue;
    if ( !testSourceAngle(lightSource, test) ) continue;
    if ( lightSource.targetInShadow(target, test.point) < 0.5 ) return true;
  }
  return false;
}

/* Testing
api = game.modules.get("elevatedvision").api
DirectionalLightSource = api.DirectionalLightSource
Draw = CONFIG.GeometryLib.Draw
*/


// see DetectionMode.prototype._testRange.
function testWithinRadius(source, test) {
  if ( source instanceof DirectionalLightSource || source instanceof GlobalLightSource ) return true;
  const radius = source.radius || source.data.externalRadius;
  const dx = test.point.x - source.x;
  const dy = test.point.y - source.y;
  return ((dx * dx) + (dy * dy)) <= (radius * radius);
}

function testSourceAngle(source, test) {
  const { angle, rotation, externalRadius } = source.data;
  if ( angle >= 360 ) return true;
  const point = test.point;
  const dx = point.x - source.x;
  const dy = point.y - source.y;
  if ( (dx * dx) + (dy * dy) <= (externalRadius * externalRadius) ) return true;
  const aMin = rotation + 90 - (angle / 2);
  const a = Math.toDegrees(Math.atan2(dy, dx));
  return (((a - aMin) % 360) + 360) % 360 <= angle;
}

/**
 * Override DetectionModeTremor.prototype._canDetect
 * Use actual check for whether token is on the ground. Tiles count.
 */
export function _canDetectDetectionModeTremor(visionSource, target) {
  const tgt = target?.document;
  if ( !(tgt instanceof TokenDocument) ) return false;
  const calc = new canvas.elevation.TokenElevationCalculator(target);
  return calc.isOnGround();
}
