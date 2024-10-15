/* globals
canvas,
foundry,
GlobalLightSource,
PIXI,
Token
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";

// NOTE: Polygon and Shader methods for CanvasVisibility

export const PATCHES = {};
PATCHES.VISION = {};

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
 *
 * v12
 * vision.base is now vision.light.preview
 * vision.fov is now vision.light
 * vision.fov.lights has no replacement
 * vision.tokens now vision.light
 *
 */

/**
 * Wrap CanvasVisiblity#refreshVisibility
 * Use the source masks instead of the graphics.
 */
function refreshVisibility(wrapped) {
  if ( !this.vision ) return wrapped();
  const vision = this.vision;

  const sources = [
    vision.light.sources,
    vision.light.preview,
    vision.light.global.source,
    vision.light.mask,
    vision.light.mask.preview,
    vision.sight,
    vision.sight.preview,
    vision.darkness
  ];

  for ( const s of sources ) {
    s.children.forEach(c => {
      if ( c instanceof EVQuadMesh ) vision.light.sources.removeChild(c);
    });
  }

  // Temporarily destroy the ability of each source to draw shapes, so we can instead use the premade graphics.
  //   const drawShape = vision.light.sources.drawShape;
  //   const fakeDrawShape = () => {};
  //   vision.light.sources.drawShape = fakeDrawShape;
  //   vision.light.preview.drawShape = fakeDrawShape;
  //   vision.light.global.source.drawShape = fakeDrawShape;
  //   vision.light.mask.drawShape = fakeDrawShape;
  //   vision.light.mask.preview.drawShape = fakeDrawShape;
  //   vision.sight.drawShape = fakeDrawShape;
  //   vision.sight.preview.drawShape = fakeDrawShape;
  //   vision.darkness.drawShape = fakeDrawShape;

  // Temporarily obliterate each source shape so nothing gets drawn.
  // Better than messing with drawShape b/c the cache's drawShape cannot be accessed
  // No can it easily be wiped after.
  const shapeMap = new Map();
  const lightMap = new Map();
  const fakeShape = new PIXI.Rectangle();

  // Basically replicate the iteration from refreshVisibility.
  for ( const lightSource of canvas.effects.lightSources ) {
    if ( !lightSource.hasActiveLayer || (lightSource instanceof foundry.canvas.sources.GlobalLightSource) ) continue;

    // Use the EV mask if available.
    const mask = lightSource.EVVisionMask;
    if ( !mask ) {
      log(`refreshVisibility|lightSource.EVVisionMask not found for ${lightSource.object.id}`);
      continue;
    }

    // Temp override of the shape.
    shapeMap.set(lightSource, lightSource.shape);
    lightSource.shape = fakeShape;

    // Is the light source providing vision?
    if ( lightSource.data.vision ) {
      const losMask = lightSource.isPreview ? vision.light.mask.preview : vision.light.mask;
      losMask.addChild(mask);
    }

    // Draw the light source.
    const los = lightSource.isPreview ? vision.light.preview : vision.light.sources;
    los.addChild(mask);
  }

  for ( const visionSource of canvas.effects.visionSources ) {
    if ( !visionSource.hasActiveLayer ) continue;

    const fovMask = visionSource.EVVisionFOVMask;
    const losMask = visionSource.EVVisionMask;
    if ( !(fovMask && losMask) ) {
      log(`refreshVisibility|visionSource.EVVisionMask or EVVisionFOVMask not found for ${visionSource.object.id}`);
      continue;
    }

    // Temp override of the shape.
    shapeMap.set(visionSource, visionSource.shape);
    visionSource.shape = fakeShape;
    lightMap.set(visionSource, visionSource.light);
    visionSource.light = fakeShape;

    // Draw vision FOV
    const blinded = visionSource.isBlinded;
    const fov = ((visionSource.radius > 0)
      && !blinded
      && !visionSource.isPreview) ? vision.sight : vision.sight.preview;
    fov.addChild(fovMask);

    // Draw light perception
    const los = ((visionSource.lightRadius > 0)
      && !blinded
      && !visionSource.isPreview) ? vision.light.mask : vision.light.mask.preview;
    los.addChild(losMask);
  }

  wrapped();

  // Put the source shapes back.
  shapeMap.entries().forEach(([source, shape]) => source.shape = shape);
  lightMap.entries().forEach(([source, light]) => source.light = light);
}

function refreshVisibility2(wrapped) {
  if ( !this.vision ) return wrapped();
  const vision = this.vision;

  // Remove all EV children so the drawings do not coexist with the children and children not repeated.
  [
    vision.light.sources,
    vision.light.preview,
    vision.light.global.source,
    vision.light.mask,
    vision.light.mask.preview,
    vision.sight,
    vision.sight.preview,
    vision.darkness
  ].forEach(s => {
    const toRemove = s.children.filter(c => c instanceof EVQuadMesh);
    toRemove.forEach(c => s.removeChild(c));
  });

  // Prevent light caching by temporarily making the light source objects point to a token.
  // See CanvasVisibility.prototype.#shouldCacheLight.
  const fakeT = canvas.tokens.placeables[0];
  const sourceMap = new Map();
  if ( fakeT ) {
    for ( const lightSource of canvas.effects.lightSources ) {
      if ( lightSource.object instanceof Token ) continue;
      sourceMap.set(lightSource, lightSource.object);
      lightSource.object = fakeT;
    }
  }

  wrapped();

  // See visibilityRefresh hook for the los/fov mods.
  // Done in hook so fog commit will function.

  // Replace the source objects changed above.
  sourceMap.entries().forEach(([source, obj]) => source.object = obj);
}


/**
 * Wrap CanvasVisibility.prototype._tearDown
 * Clear the pointSourcesStates in tear down.
 */
async function _tearDown(wrapped, options) {
  this.pointSourcesStates.clear();
  return wrapped(options);
}

PATCHES.VISION.WRAPS = { _tearDown, refreshVisibility: refreshVisibility2 };


/**
 * Hook visibilityRefresh.
 * See CanvasVisibility#refreshVisibility.
 * Replace the vision drawings with the los/fov EV containers.
 * @param {CanvasVisibility} cv
 */
function visibilityRefresh(cv) {
  const vision = cv.vision;
  if ( !vision ) return;

  // End fills
  vision.light.sources.endFill();
  vision.light.preview.endFill();
  vision.light.global.source.endFill();
  vision.light.mask.endFill();
  vision.light.mask.preview.endFill();
  vision.sight.endFill();
  vision.sight.preview.endFill();
  vision.darkness.endFill();

  // Clear drawn sources.
  vision.light.preview.clear();
  vision.light.sources.clear();
  vision.light.mask.preview.clear();
  vision.light.mask.clear();

  for ( const lightSource of canvas.effects.lightSources ) {
    if ( !lightSource.hasActiveLayer || (lightSource instanceof foundry.canvas.sources.GlobalLightSource) ) continue;
    const ev = lightSource[MODULE_ID];
    if ( !ev ) return;

    // Use the EV mask if available.
    const mask = ev.shadowVisionMask;
    if ( !mask ) {
      console.error(`refreshVisibility|lightSource.EVVisionMask not found for ${lightSource.object.id}`);
      continue;
    }

    // Is the light source providing vision?
    if ( lightSource.data.vision ) {
      const losMask = lightSource.isPreview ? vision.light.mask.preview : vision.light.mask;
      losMask.addChild(mask);
    }

    // Draw the light source.
    const los = lightSource.isPreview ? vision.light.preview : vision.light.sources;
    los.addChild(mask);
  }

  for ( const visionSource of canvas.effects.visionSources ) {
    if ( !visionSource.hasActiveLayer ) continue;
    const ev = visionSource[MODULE_ID];
    if ( !ev ) return;

    const fovMask = ev.shadowFOVMask;
    const losMask = ev.shadowVisionMask;
    if ( !(fovMask && losMask) ) {
      console.error(`refreshVisibility|visionSource.EVVisionMask or EVVisionFOVMask not found for ${visionSource.object.id}`);
      continue;
    }

    // Draw vision FOV
    // Not needed b/c that can be drawn using the defaults.
    const blinded = visionSource.isBlinded;
    // Currently unused:
    //     const fov = ((visionSource.radius > 0)
    //       && !blinded
    //       && !visionSource.isPreview) ? vision.sight : vision.sight.preview;
    //     fov.addChild(fovMask);

    // Draw light perception
    const los = ((visionSource.lightRadius > 0)
      && !blinded
      && !visionSource.isPreview) ? vision.light.mask : vision.light.mask.preview;
    los.addChild(losMask);
  }
}

PATCHES.VISION.HOOKS = { visibilityRefresh };

PATCHES.VISION.METHODS = {
  renderTransform: new PIXI.Matrix(),
  pointSourcesStates: new Map()
};
