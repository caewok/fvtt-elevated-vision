/* globals
LightSource,
Wall,
VisionSource,
SoundSource,
Token,
libWrapper,
canvas,
ClockwiseSweepPolygon
*/

"use strict";

// Patches

import { MODULE_ID } from "./const.js";
import { zValue } from "./util.js";

import {
  testVisibilityLightSource,
  testNaturalVisibilityVisionMode,
} from "./tokens.js";

import {
  createAdaptiveLightingShader,
  _updateColorationUniformsLightSource,
  _updateIlluminationUniformsLightSource,
  _updateEVLightUniformsLightSource,
  _createLOSLightSource
} from "./lighting.js";

import {
  initializeVisionSource,
  // _updateMeshVisionSource,
  _updateColorationUniformsVisionSource,
  _updateIlluminationUniformsVisionSource,
  refreshCanvasVisibility
} from "./vision.js";

import {
  _computeClockwiseSweepPolygon,
  _drawShadowsClockwiseSweepPolygon,
  _testShadowWallInclusionClockwisePolygonSweep,
  testCollision3dClockwiseSweepPolygon,
  _testCollision3dClockwiseSweepPolygon
} from "./clockwise_sweep.js";

export function registerAdditions() {

  if ( !Object.hasOwn(MovementSource.prototype, "elevationZ") ) {
    Object.defineProperty(MovementSource.prototype, "elevationZ", {
      get: movementSourceElevation
    });
  }

  if ( !Object.hasOwn(VisionSource.prototype, "elevationZ") ) {
    Object.defineProperty(VisionSource.prototype, "elevationZ", {
      get: visionSourceElevation
    });
  }

  if ( !Object.hasOwn(LightSource.prototype, "elevationZ") ) {
    Object.defineProperty(LightSource.prototype, "elevationZ", {
      get: lightSourceElevation
    });
  }

  if ( !Object.hasOwn(SoundSource.prototype, "elevationZ") ) {
    Object.defineProperty(SoundSource.prototype, "elevationZ", {
      get: soundSourceElevation
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

  Object.defineProperty(LightSource.prototype, "_updateEVLightUniforms", {
    value: _updateEVLightUniformsLightSource,
    writable: true,
    configurable: true
  });

  Object.defineProperty(VisionSource.prototype, "_updateEVLightUniforms", {
    value: _updateEVLightUniformsLightSource,
    writable: true,
    configurable: true
  });

  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_drawShadows", {
    value: _drawShadowsClockwiseSweepPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_testShadowWallInclusion", {
    value: _testShadowWallInclusionClockwisePolygonSweep,
    writable: true,
    configurable: true
  });

  Object.defineProperty(ClockwiseSweepPolygon, "testCollision3d", {
    value: testCollision3dClockwiseSweepPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_testCollision3d", {
    value: _testCollision3dClockwiseSweepPolygon,
    writable: true,
    configurable: true
  });

//   Object.defineProperty(LightSource.prototype, "renderShadows", {
//     value: renderShadows,
//     writable: true,
//     configurable: true
//   })

  //   Object.defineProperty(Set.prototype, "diff", {
  //     value: function(b) { return new Set([...this].filter(x => !b.has(x))); },
  //     writable: true,
  //     configurable: true
  //   });
}

export function registerPatches() {
  // ----- Locating edges that create shadows in the LOS ----- //
  libWrapper.register(MODULE_ID, "ClockwiseSweepPolygon.prototype._compute", _computeClockwiseSweepPolygon, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

  // ----- Shader code for drawing shadows ----- //
  libWrapper.register(MODULE_ID, "AdaptiveLightingShader.create", createAdaptiveLightingShader, libWrapper.WRAPPER);

  // ----- Drawing shadows for light sources ----- //
  libWrapper.register(MODULE_ID, "LightSource.prototype._updateColorationUniforms", _updateColorationUniformsLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "LightSource.prototype._updateIlluminationUniforms", _updateIlluminationUniformsLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "LightSource.prototype._createLOS", _createLOSLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

  // ----- Drawing shadows for vision sources ----- //
  libWrapper.register(MODULE_ID, "CanvasVisibility.prototype.refresh", refreshCanvasVisibility, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});

//   libWrapper.register(MODULE_ID, "VisionSource.prototype._updateColorationUniforms", _updateColorationUniformsVisionSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
//   libWrapper.register(MODULE_ID, "VisionSource.prototype._updateIlluminationUniforms", _updateIlluminationUniformsVisionSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

  // ----- Visibility testing ----- //
  libWrapper.register(MODULE_ID, "LightSource.prototype.testVisibility", testVisibilityLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "VisionMode.prototype.testNaturalVisibility", testNaturalVisibilityVisionMode, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

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

/**
 * For MovementSource objects, use the token's elevation
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function movementSourceElevation() {
  return this.object.topZ;
}

/**
 * For VisionSource objects, use the token's elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function visionSourceElevation() {
  return this.object.topZ;
}

/**
 * For LightSource objects, default to infinite elevation.
 * This is to identify lights that should be treated like in default Foundry.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function lightSourceElevation() {
  return zValue(this.object.document.flags?.levels?.rangeTop ?? Number.POSITIVE_INFINITY);
}

/**
 * For SoundSource objects, default to 0 elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function soundSourceElevation() {
  return zValue(this.object.document.flags?.levels?.rangeTop ?? Number.POSITIVE_INFINITY);
}

/**
 * For Token objects, default to 0 elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function tokenTop() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return zValue(this.document.object.losHeight ?? 0);
}

/**
 * For Token objects, default to 0 elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function tokenBottom() {
  // From Wall Height but skip the extra test b/c we know it is a token.
  return zValue(this.document.elevation ?? 0);
}

/**
 * For Wall objects, default to infinite top/bottom elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function wallTop() {
  return zValue(this.document.flags?.['wall-height']?.top ?? Number.POSITIVE_INFINITY);
}

/**
 * For Wall objects, default to infinite top/bottom elevation.
 * @type {number} Elevation, in grid units to match x,y coordinates.
 */
function wallBottom() {
  return zValue(this.document.flags?.['wall-height']?.top ?? Number.NEGATIVE_INFINITY);
}

