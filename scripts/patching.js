/* globals
AmbientLight,
LightSource,
Wall
*/

"use strict";

// Patches

import { WALL_HEIGHT_MODULE_ID, LEVELS_MODULE_ID, MODULE_ID } from "./const.js";
import { drawMeshes } from "./Shadow.js";
import { log } from "./util.js";
import { EVSightLayerRefresh, EVDrawVision, EVDrawSight } from "./tokens.js";

export function registerAdditions() {

  if ( !Object.hasOwn(VisionSource.prototype, "elevation") ) {
    Object.defineProperty(VisionSource.prototype, "elevation", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(LightSource.prototype, "elevation") ) {
    Object.defineProperty(LightSource.prototype, "elevation", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(SoundSource.prototype, "elevation") ) {
    Object.defineProperty(SoundSource.prototype, "elevation", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "top") ) {
    Object.defineProperty(Wall.prototype, "top", {
      get: wallTop
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "bottom") ) {
    Object.defineProperty(Wall.prototype, "bottom", {
      get: wallBottom
    });
  }

  if ( !Object.hasOwn(Token.prototype, "top") ) {
    Object.defineProperty(Token.prototype, "top", {
      get: tokenTop
    });
  }

  if ( !Object.hasOwn(Token.prototype, "bottom") ) {
    Object.defineProperty(Token.prototype, "bottom", {
      get: tokenBottom
    });
  }


//   Object.defineProperty(Set.prototype, "diff", {
//     value: function(b) { return new Set([...this].filter(x => !b.has(x))); },
//     writable: true,
//     configurable: true
//   });

}

export function registerPatches() {
  // libWrapper.register(MODULE_ID, "LightSource.prototype.drawMeshes", drawMeshes, "OVERRIDE");
  libWrapper.register(MODULE_ID, "LightSource.prototype.drawMeshes", drawMeshes, "WRAPPER");
//   libWrapper.register(MODULE_ID, "SightLayer.prototype.testVisibility", testVisibility, "WRAPPER")
  libWrapper.register(MODULE_ID, "SightLayer.prototype.refresh", EVSightLayerRefresh, "OVERRIDE");
//   libWrapper.register(MODULE_ID, "VisionSource.prototype.drawVision", EVDrawVision, "OVERRIDE");
//   libWrapper.register(MODULE_ID, "VisionSource.prototype.drawSight", EVDrawSight, "OVERRIDE");
}

/**
 * For testing shadow creation
 */
function testVisibility(wrapped, point, {tolerance = 2, object = null} = {}) {
  // Block square around 1000, 1000
  const out = wrapped(point, { tolerance, object });
  if ( point.x > 900 && point.x < 1100 && point.y > 900 && point.y < 1100) {
    return false;
  }
  return out;
}

/**
 * For {LightSource|SoundSource|VisionSource} objects
 * @type {number}
 */
function sourceElevation() { return WallHeight.getSourceElevationTop(this.object.document) }

/**
 * For {Token}
 * @type {number}
 */
function tokenTop() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return this.document.object.losHeight;
}

/**
 * For {Token}
 * @type {number}
 */
function tokenBottom() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return this.document.data.elevation;
}

/**
 * For {Wall}
 * @type {number}
 */
function wallTop() { return WallHeight.getWallBounds(this).top; }

/**
 * For {Wall}
 * @type {number}
 */
function wallBottom() { return WallHeight.getWallBounds(this).bottom;  }

