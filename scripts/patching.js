/* globals
AmbientLight,
LightSource,
Wall
*/

"use strict";

// Patches

import { WALL_HEIGHT_MODULE_ID, LEVELS_MODULE_ID, MODULE_ID } from "./const.js";
import { drawMeshes } from "./Shadow.js";

export function registerAdditions() {

  if ( !Object.hasOwn(LightSource.prototype, "elevation") ) {
    Object.defineProperty(LightSource.prototype, "elevation", {
      get: lightSourceElevation
    });
  }

  if ( !Object.hasOwn(AmbientLight.prototype, "elevation") ) {
    Object.defineProperty(AmbientLight.prototype, "elevation", {
      get: ambientLightElevation
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

//   Object.defineProperty(Set.prototype, "diff", {
//     value: function(b) { return new Set([...this].filter(x => !b.has(x))); },
//     writable: true,
//     configurable: true
//   });

}

export function registerPatches() {
  // libWrapper.register(MODULE_ID, "LightSource.prototype.drawMeshes", drawMeshes, "OVERRIDE");
  libWrapper.register(MODULE_ID, "LightSource.prototype.drawMeshes", drawMeshes, "WRAPPER");
}

/**
 * For {AmbientLight} object
 * @type {number}
 */
function ambientLightElevation() {
  return this.document.getFlag(LEVELS_MODULE_ID, "rangeTop") ?? 0;
}

/**
 * For {LightSource} object
 * @type {number}
 */
function lightSourceElevation() { return ambientLightElevation.call(this.object); }

/**
 * For {Wall} object
 * @type {number}   The topmost point of the wall.
 */
function wallTop() {
  return this.document.getFlag(WALL_HEIGHT_MODULE_ID, "top") ?? Number.POSITIVE_INFINITY;
}

/**
 * For {Wall} object
 * @type {number}   The bottommost point of the wall.
 */
function wallBottom() {
  return this.document.getFlag(WALL_HEIGHT_MODULE_ID, "bottom") ?? Number.NEGATIVE_INFINITY;
}


