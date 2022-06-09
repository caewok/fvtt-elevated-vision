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
import { EVSightLayerRefresh, EVDrawVision, EVDrawSight, EVSightTestVisibility } from "./tokens.js";

export function registerAdditions() {

  if ( !Object.hasOwn(VisionSource.prototype, "elevationZ") ) {
    Object.defineProperty(VisionSource.prototype, "elevationZ", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(LightSource.prototype, "elevationZ") ) {
    Object.defineProperty(LightSource.prototype, "elevationZ", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(SoundSource.prototype, "elevationZ") ) {
    Object.defineProperty(SoundSource.prototype, "elevationZ", {
      get: sourceElevation
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "topZ") ) {
    Object.defineProperty(Wall.prototype, "topZ", {
      get: wallTop
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "bottomZ") ) {
    Object.defineProperty(Wall.prototype, "bottomZ", {
      get: wallBottom
    });
  }

  if ( !Object.hasOwn(Token.prototype, "topZ") ) {
    Object.defineProperty(Token.prototype, "topZ", {
      get: tokenTop
    });
  }

  if ( !Object.hasOwn(Token.prototype, "bottomZ") ) {
    Object.defineProperty(Token.prototype, "bottomZ", {
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
//   libWrapper.register(MODULE_ID, "LightSource.prototype.drawMeshes", drawMeshes, "WRAPPER");
  libWrapper.register(MODULE_ID, "SightLayer.prototype.testVisibility", EVSightTestVisibility, "MIXED");
//   libWrapper.register(MODULE_ID, "Token.prototype.isVisible", EVTokenIsVisible, "OVERRIDE");

  libWrapper.register(MODULE_ID, "SightLayer.prototype.refresh", EVSightLayerRefresh, "OVERRIDE");
//   libWrapper.register(MODULE_ID, "VisionSource.prototype.drawVision", EVDrawVision, "OVERRIDE");
//   libWrapper.register(MODULE_ID, "VisionSource.prototype.drawSight", EVDrawSight, "OVERRIDE");
}


/**
 * Convert a grid units value to pixel units, for equivalency with x,y values.
 */
function zValue(value) {
  return value * canvas.scene.data.grid / canvas.scene.data.gridDistance;
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

function replaceInfinity(value) {
  return isFinite(value) ? zValue(value)
    : value === Infinity ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

/**
 * For {LightSource|SoundSource|VisionSource} objects
 * Do not permit infinity, as it screws up orientation and other calculations.
 * @type {number}
 */
function sourceElevation() {
  return replaceInfinity(WallHeight.getSourceElevationTop(this.object.document));
}

/**
 * For {Token}
 * @type {number}
 */
function tokenTop() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return zValue(this.document.object.losHeight);
}

/**
 * For {Token}
 * @type {number}
 */
function tokenBottom() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return zValue(this.document.data.elevation);
}

/**
 * For {Wall}
 * @type {number}
 */
function wallTop() { return replaceInfinity(WallHeight.getWallBounds(this).top); }

/**
 * For {Wall}
 * @type {number}
 */
function wallBottom() { return replaceInfinity(WallHeight.getWallBounds(this).bottom);  }

