/* globals
canvas,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { EdgePixelCache } from "./glsl/BVH.js";
import { WebGLShadowsBVH } from "./glsl/WebGLShadowsBVH.js";
import { extractPixelsAdvanced } from "./geometry/extract-pixels.js";

// Track wall creation, update, and deletion, constructing WallTracerEdges as we go.
// Use to update the pathfinding triangulation.

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook initializeEdges
 * Set up the SCENE GRAPH with all wall edges.
 */
function initializeEdges() {
  if ( CONFIG[MODULE_ID].webGLShadowClass !== WebGLShadowsBVH ) return;

  // See ElevationTextureHandler.js.
  CONFIG[MODULE_ID].edgePixelCache.resetEdges();


  // Wipe any existing shadows.
  canvas.effects.visionSources.forEach(s => {
    if ( s._elevatedvision ) {
      s._elevatedvision.destroy();
      s._elevatedvision = undefined;
    }
  });
  canvas.effects.lightSources.forEach(s => {
    if ( s._elevatedvision ) {
      s._elevatedvision.destroy();
      s._elevatedvision = undefined;
    }
  });
}

PATCHES.BASIC.HOOKS = { initializeEdges };
