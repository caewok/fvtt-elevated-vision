/* globals
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Draw } from "./geometry/Draw.js";

// Methods related to GlobalLightSource

export const PATCHES = {};
PATCHES.WEBGL = {};

/**
 * New getter: GlobalLightSource.prototype.EVVisionMask
 * Draw the global shape (canvas rectangle) to graphics and pass as mask.
 */
function EVVisionMask() {
  // TODO: This could be cached somewhere, b/c this.shape does not change unless canvas changes.
  const g = new PIXI.Graphics();
  const draw = new Draw(g);
  draw.shape(this.shape, { fill: 0xFF0000 });
  return g;
}

PATCHES.WEBGL.GETTERS = {
  //EVVisionMask
};
