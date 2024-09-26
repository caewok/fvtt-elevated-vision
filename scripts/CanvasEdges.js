/* globals

*/
"use strict";

// Modify CanvasEdges class to add a quadtree and track adding and removing edges.
// Patches for the CanvasEdges class.
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- Hooks ----- //
function initializeEdges() {
  console.log("initializeEdges");
}

PATCHES.BASIC.HOOKS = { initializeEdges };
