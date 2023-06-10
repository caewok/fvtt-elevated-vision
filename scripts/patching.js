/* globals
ClockwiseSweepPolygon,
libWrapper,
LightSource,
PIXI,
Tile,
Token,
VisionSource
*/

"use strict";

// Patches

import { MODULE_ID } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";

import {
  defaultOptionsAmbientSoundConfig,
  getDataTileConfig,
  _onChangeInputTileConfig
} from "./renderConfig.js";

import {
  cloneToken
} from "./tokens.js";

import {
  createAdaptiveLightingShader,
  _createPolygonLightSource
} from "./lighting.js";

import {
  refreshCanvasVisibilityPolygons,
  refreshCanvasVisibilityShader,

  _createEVMask,
  _createEVMeshVisionSource,
  _createEVMeshLightSource

  // Perfect Vision patches that will not work in v11:
  // createVisionCanvasVisionMaskPV,
  // _createMaskVisionSourcePV,
  // _createMaskLightSourcePV,
  // _createEVMeshVisionSourcePV,
  // _createEVMeshLightSourcePV
} from "./vision.js";

import {
  _computeClockwiseSweepPolygon,
  _drawShadowsClockwiseSweepPolygon,
  initializeClockwiseSweepPolygon
} from "./clockwise_sweep.js";

import { getEVPixelCacheTile } from "./tiles.js";

import { _onMouseMoveCanvas } from "./ElevationLayer.js";

// A: shader / not shader
// B: PV / not PV
// A | (B << 1)
const SHADER_SWITCH = {
  NO_SHADER: 0,
  SHADER: 1,
  PV_NO_SHADER: 2,
  PV_SHADER: 3
};

/**
 * Helper to wrap methods.
 * @param {string} method       Method to wrap
 * @param {function} fn         Function to use for the wrap
 * @param {object} [options]    Options passed to libWrapper.register. E.g., { perf_mode: libWrapper.PERF_FAST}
 * @returns {number} libWrapper ID
 */
function wrap(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.WRAPPER, options);
}

function override(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.OVERRIDE, options);
}

/**
 * Helper to add a method to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
function addClassMethod(cl, name, fn) {
  Object.defineProperty(cl, name, {
    value: fn,
    writable: true,
    configurable: true
  });
}

/**
 * Helper to add a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
function addClassGetter(cl, name, fn) {
  if ( !Object.hasOwn(cl, name) ) {
    Object.defineProperty(cl, name, {
      get: fn,
      enumerable: false,
      configurable: true
    });
  }
}

export function registerAdditions() {
  addClassMethod(ClockwiseSweepPolygon.prototype, "_drawShadows", _drawShadowsClockwiseSweepPolygon);
  addClassMethod(Token.prototype, "getTopLeft", getTopLeftTokenCorner);

  addClassMethod(VisionSource.prototype, "_createEVMask", _createEVMask);
  addClassMethod(LightSource.prototype, "_createEVMask", _createEVMask);

  addClassGetter(Tile.prototype, "evPixelCache", getEVPixelCacheTile);
  addClassMethod(Tile.prototype, "_evPixelCache", undefined);

  shaderAdditions();
}

function shaderAdditions() {
  addClassMethod(VisionSource.prototype, "_createEVMesh", _createEVMeshVisionSource);
  addClassMethod(LightSource.prototype, "_createEVMesh", _createEVMeshLightSource);
}

// IDs returned by libWrapper.register for the shadow shader patches.
const libWrapperShaderIds = [];

/**
 * Decorator to register and record libWrapper id for a shader function.
 * @param {function} fn   A libWrapper registration function
 */
function regShaderPatch(fn) {
  return function() { libWrapperShaderIds.push(fn.apply(this, arguments)); };
}

const shaderWrap = regShaderPatch(wrap);
const shaderOverride = regShaderPatch(override);

export function registerPatches() {
  // Track mouse events
  wrap("Canvas.prototype._onMouseMove", _onMouseMoveCanvas, { perf_mode: libWrapper.PERF_FAST });

  // ----- Locating edges that create shadows in the LOS ----- //
  wrap("ClockwiseSweepPolygon.prototype._compute", _computeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });

  // ----- Token animation and elevation change ---- //
  wrap("Token.prototype.clone", cloneToken, { perf_mode: libWrapper.PERF_FAST });

  // ----- Application rendering configurations ----- //
  wrap("AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig);
  wrap("TileConfig.prototype.getData", getDataTileConfig);
  wrap("TileConfig.prototype._onChangeInput", _onChangeInputTileConfig);

  // ----- Clockwise sweep enhancements ----- //
  if ( getSetting(SETTINGS.CLOCKWISE_SWEEP) ) {
    wrap("ClockwiseSweepPolygon.prototype.initialize", initializeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Shader code for drawing shadows ----- //
  wrap("AdaptiveLightingShader.create", createAdaptiveLightingShader);

  // Clear the prior libWrapper shader ids, if any.
  libWrapperShaderIds.length = 0;
}

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic elevation determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeftTokenCorner(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}

/**
 * Deregister shading wrappers.
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
function deregisterShadowPatches() {
  libWrapperShaderIds.forEach(i => libWrapper.unregister(MODULE_ID, i, false));
}

/**
 * Register shading wrappers
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
export function registerShadowPatches() {
  deregisterShadowPatches();

  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const shaderAlgorithm = getSceneSetting(ALGORITHM) ?? TYPES.NONE;
  if ( shaderAlgorithm === TYPES.NONE ) return;

  // ----- Drawing shadows for vision source LOS, fog  ----- //
  const use_shader = shaderAlgorithm === TYPES.WEBGL;
  const shader_choice = use_shader;

  switch ( shader_choice ) {
    case SHADER_SWITCH.NO_SHADER:
      shaderOverride("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityPolygons, { perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.SHADER:
      shaderOverride("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityShader, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      shaderWrap("LightSource.prototype._createPolygon", _createPolygonLightSource, { perf_mode: libWrapper.PERF_FAST });
      break;
  }
}
