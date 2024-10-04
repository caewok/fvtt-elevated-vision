/* globals
canvas
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { WebGLShadows } from "./glsl/WebGLShadows.js";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- Hooks ----- //
function initializeEdges() {
  console.log("initializeEdges");

//   const sources = [
//     ...canvas.effects.lightSources,
//     ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
//   ];
//
//   sources.forEach(src => {
//     const ev = src[MODULE_ID] ??= WebGLShadows.fromSource(src);
//     ev.initializeShadows();
//   });
}

PATCHES.BASIC.HOOKS = { initializeEdges };
