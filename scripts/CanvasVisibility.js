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
 *
 * v12
 * vision.base is now vision.light.preview
 * vision.fov is now vision.light
 * vision.fov.lights has no replacement
 * vision.tokens now vision.light
 *
 */
// function refreshVisibility() {
//   if ( !this.vision?.children.length ) return;
//   const fillColor = 0xFF0000;
//   const vision = this.vision;
//
//   // A flag to know if the lights cache render texture need to be refreshed
//   let refreshCache = false;
//
//   // A flag to know if fog need to be refreshed.
//   let commitFog = false;
//
//   // Checking if the lights cache need a full redraw
//   // TODO: Can we force the cache to clear if a wall within the light radius changes?
//   // let lightsFullRedraw = this.checkLights();
//   let lightsFullRedraw = true;
//   if ( lightsFullRedraw ) {
//     this.pointSourcesStates.clear();
//     // vision.light.clear();
//     vision.light.removeChildren();
//   }
//
//   vision.light.preview.clear();
//   vision.light.preview.removeChildren();
//   // vision.base.beginFill(fillColor, 1.0);
//
//   // vision.fov.lights.beginFill(fillColor, 1.0);
//   // Already cleared with lightsFullRedraw above.
//
//   vision.light.clear();
//   vision.light.removeChildren();
//   // Currently unused
//   // vision.fov.tokens.beginFill(fillColor, 1.0);
//
//   vision.light.clear();
//   if ( vision.light.children.length > 1 ) vision.light.removeChildren(1); // Keep the vision.los.preview child.
//   // Currently unused
//   // vision.los.beginFill(fillColor, 1.0);
//
//   vision.light.preview.clear();
//   vision.light.preview.removeChildren();
//   // Currently unused
//   // vision.los.preview.beginFill(fillColor, 1.0);
//
//   // Iterating over each light source
//   for ( const lightSource of canvas.effects.lightSources ) {
//     const mask = lightSource.EVVisionMask;
//     if ( !mask && !(lightSource instanceof foundry.canvas.sources.GlobalLightSource) ) {
//       console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|LightSource ${lightSource.object.id} has no mask.`);
//     }
//
//     // The light source is providing vision and has an active layer?
//     if ( lightSource.active && lightSource.data.vision ) {
//       // Global light will have data.vision = false.
//       const los = lightSource.isPreview ? vision.light.preview : vision.light;
//       los.addChild(mask);
//     }
//
//     // The light source is emanating from a token?
//     if ( lightSource.object instanceof Token ) {
//       // Global light cannot emanate from a token.
//       if ( !lightSource.active ) continue;
//       const los = lightSource.isPreview ? vision.light.preview : vision.light;
//       const mask = lightSource[MODULE_ID].shadowVisionMask;
//       los.addChild(mask);
//       continue;
//     }
//
//     // Determine whether this light source needs to be drawn to the texture
//     let draw = lightsFullRedraw;
//     if ( !lightsFullRedraw ) {
//       const priorState = this.pointSourcesStates.get(lightSource);
//       if ( !priorState || priorState.wasActive === false ) draw = lightSource.active;
//     }
//
//     // Save the state of this light source
//     this.pointSourcesStates.set(lightSource,
//       {wasActive: lightSource.active, updateId: lightSource.updateId});
//
//     if ( !lightSource.active ) continue;
//     refreshCache = true;
//     if ( draw ) vision.light.addChild(mask);
//
//   }
//
//   // Do we need to cache the lights into the lightsSprite render texture?
//   // Note: With a full redraw, we need to refresh the texture cache, even if no elements are present
//   if ( refreshCache || lightsFullRedraw ) this.cacheLights(lightsFullRedraw);
//
//   // Iterating over each vision source
//   for ( const visionSource of canvas.effects.visionSources ) {
//     if ( !visionSource.active ) continue;
//
//     const fovMask = visionSource.EVVisionFOVMask;
//     const losMask = visionSource.EVVisionMask;
//     if ( !fovMask ) console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|visionSource ${visionSource.object.id} has no fov mask.`);
//     if ( !losMask ) console.error(`${MODULE_ID}|refreshVisibilityCanvasVisibility|visionSource ${visionSource.object.id} has no los mask.`);
//
//     // Draw FOV polygon or provide some baseline visibility of the token's space
//     if ( (visionSource.radius > 0) && !visionSource.data.blinded && !visionSource.isPreview ) {
//       vision.fov.tokens.addChild(fovMask);
//     } else {
//       vision.base.beginFill(fillColor, 1.0);
//       vision.base.drawShape(visionSource.fov);
//       vision.base.endFill();
//     }
//     // Draw LOS mask (with exception for blinded tokens)
//     if ( !visionSource.data.blinded && !visionSource.isPreview ) {
//       vision.los.addChild(losMask);
//       commitFog = true;
//     } else vision.los.preview.addChild(visionSource.data.blinded ? fovMask : losMask);
//   }
//
//   // Fill operations are finished for LOS and FOV lights and tokens
//   // vision.base.endFill();
//   // vision.fov.lights.endFill();
//
//   // Not needed with the masks:
//   // vision.fov.tokens.endFill();
//   // vision.los.endFill();
//   // vision.los.preview.endFill();
//
//   // Update fog of war texture (if fow is activated)
//   if ( commitFog ) canvas.fog.commit();
// }

//PATCHES.WEBGL.OVERRIDES = { refreshVisibility };

// TODO: Use refreshVisibility override for polygons as well? What about "none"?


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

//   vision.light.sources.drawShape = drawShape;
//   vision.light.preview.drawShape = drawShape;
//   vision.light.global.source.drawShape = drawShape;
//   vision.light.mask.drawShape = drawShape;
//   vision.light.mask.preview.drawShape = drawShape;
//   vision.sight.drawShape = drawShape;
//   vision.sight.preview.drawShape = drawShape;
//   vision.darkness.drawShape = drawShape;

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

PATCHES.WEBGL.WRAPS = { _tearDown, refreshVisibility: refreshVisibility2 };


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

    // Use the EV mask if available.
    const mask = lightSource.EVVisionMask;
    if ( !mask ) {
      log(`refreshVisibility|lightSource.EVVisionMask not found for ${lightSource.object.id}`);
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

    const fovMask = visionSource.EVVisionFOVMask;
    const losMask = visionSource.EVVisionMask;
    if ( !(fovMask && losMask) ) {
      log(`refreshVisibility|visionSource.EVVisionMask or EVVisionFOVMask not found for ${visionSource.object.id}`);
      continue;
    }

    // Draw vision FOV
    // Not needed b/c that can be drawn using the defaults.
    const blinded = visionSource.isBlinded;
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

PATCHES.WEBGL.HOOKS = { visibilityRefresh };


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
// function cacheLights(clearTexture) {
//   this.vision.fov.lights.renderable = true;
//   const dims = canvas.dimensions;
//   this.renderTransform.tx = -dims.sceneX;
//   this.renderTransform.ty = -dims.sceneY;
//
//   // Render the currently revealed vision to the texture
//   canvas.app.renderer.render(this.vision.fov.lights, {
//     renderTexture: this.vision.fov.lightsSprite.texture,
//     clear: clearTexture,
//     transform: this.renderTransform
//   });
//   this.vision.fov.lights.renderable = false;
// }

PATCHES.WEBGL.METHODS = {
  // cacheLights,
  renderTransform: new PIXI.Matrix(),
  pointSourcesStates: new Map()
};
