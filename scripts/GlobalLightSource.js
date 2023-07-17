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
 * Return early for initialization and update methods b/c not calculating shadows.
 * New methods:
 * - GlobalLightSource.prototype._initializeEVShadows
 * - GlobalLightSource.prototype._initializeEVShadowGeometry
 * - GlobalLightSource.prototype._initializeEVShadowTexture
 * - GlobalLightSource.prototype._initializeEVShadowMask
 * - GlobalLightSource.prototype._updateEVShadowData
 */
function _initializeEVShadowGeometry() { return undefined; }
function _initializeEVShadowMesh() { return undefined; }
function _initializeEVShadowRenderer() { return undefined; }
function _initializeEVShadowMask() { return undefined; }
function _updateEVShadowData(_opts) { return undefined; }
function _initializeEVShadows() { return undefined; }


PATCHES.WEBGL.METHODS = {
  _initializeEVShadowGeometry,
  _initializeEVShadowMesh,
  _initializeEVShadowRenderer,
  _initializeEVShadowMask,
  _updateEVShadowData,
  _initializeEVShadows
};

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
  EVVisionMask
};
