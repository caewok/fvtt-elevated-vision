/* globals
LightSource,
Wall,
VisionSource,
SoundSource,
Token,
libWrapper,
canvas,
WallHeight
*/

"use strict";

// Patches

import { MODULE_ID } from "./const.js";

import {
  testVisibilityLightSource,
  testNaturalVisibilityVisionMode,
  drawSightVisionSource
} from "./tokens.js";

// import {
//   } from "./lighting.js";

import {
  _testWallInclusionClockwisePolygonSweep,
  _identifyEdgesClockwisePolygonSweep,
  _computeClockwisePolygonSweep,
  _drawShadowsClockwiseSweepPolygon
} from "./clockwise_sweep.js";

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

  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_drawShadows", {
    value: _drawShadowsClockwiseSweepPolygon,
    writable: true,
    configurable: true
  })

  //   Object.defineProperty(Set.prototype, "diff", {
  //     value: function(b) { return new Set([...this].filter(x => !b.has(x))); },
  //     writable: true,
  //     configurable: true
  //   });
}

export function registerPatches() {
  libWrapper.register(MODULE_ID, "VisionSource.prototype.drawSight", drawSightVisionSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
//   libWrapper.register(MODULE_ID, "VisionSource.prototype._drawRenderTextureContainer", EVVisionSourceDrawRenderTextureContainer, libWrapper.WRAPPER);

//   libWrapper.register(MODULE_ID, "LightSource.prototype._drawRenderTextureContainer", EVLightSourceDrawRenderTextureContainer, libWrapper.WRAPPER);

  libWrapper.register(MODULE_ID, "LightSource.prototype.testVisibility", testVisibilityLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "VisionMode.prototype.testNaturalVisibility", testNaturalVisibilityVisionMode, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});


  libWrapper.register(MODULE_ID, "ClockwiseSweepPolygon.prototype._testWallInclusion", _testWallInclusionClockwisePolygonSweep, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "ClockwiseSweepPolygon.prototype._identifyEdges", _identifyEdgesClockwisePolygonSweep, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "ClockwiseSweepPolygon.prototype._compute", _computeClockwisePolygonSweep, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

}

/**
 * Convert a grid units value to pixel units, for equivalency with x,y values.
 */
function zValue(value) {
  return value * canvas.scene.grid.size / canvas.scene.grid.distance;
}

// function replaceInfinity(value) {
//   return isFinite(value) ? zValue(value)
//     : value === Infinity ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
// }

/**
 * For {LightSource|SoundSource|VisionSource} objects
 * Do not permit infinity, as it screws up orientation and other calculations.
 * @type {number}
 */
function sourceElevation() {
//   return replaceInfinity(WallHeight.getSourceElevationTop(this.object.document));
  return this.object.document.flags?.levels?.rangeTop ?? Number.POSITIVE_INFINITY;
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
  return zValue(this.document.elevation);
}

/**
 * For {Wall}
 * @type {number}
 */
function wallTop() {
  return this.document.flags?.['wall-height'].top ?? Number.MAX_SAFE_INTEGER;
}

/**
 * For {Wall}
 * @type {number}
 */
function wallBottom() {
  return this.document.flags?.['wall-height'].top ?? Number.MIN_SAFE_INTEGER;
}

