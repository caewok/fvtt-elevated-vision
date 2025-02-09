/* globals
canvas,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { EdgeData } from "./glsl/BVH.js";
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
  const t0 = performance.now();

  // See ElevationTextureHandler.js.
  CONFIG[MODULE_ID].edgeData = EdgeData.edges.map(edge => new EdgeData(edge));

  CONFIG[MODULE_ID].edgeCache = EdgeData.createPixelCache();
  CONFIG[MODULE_ID].edgeTexture = EdgeData.createTexture();

  const t1 = performance.now();
  console.debug(`${MODULE_ID}|Created edge cache in ${t1 - t0} ms.`);
}

PATCHES.BASIC.HOOKS = { initializeEdges };
