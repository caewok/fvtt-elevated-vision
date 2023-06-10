/* globals
ClockwiseSweepPolygon,
libWrapper,
LightSource,
PIXI,
Token,
VisionSource
*/

"use strict";

// Patches

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
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
  _updateColorationUniformsLightSource,
  _updateIlluminationUniformsLightSource,
  _updateEVLightUniformsLightSource,
  _createPolygonLightSource
} from "./lighting.js";

import {
  refreshCanvasVisibilityPolygons,
  refreshCanvasVisibilityShader,
  createVisionCanvasVisionMaskPV,
  _createEVMask,
  _createEVMeshVisionSource,
  _createEVMeshLightSource,
  _createMaskVisionSourcePV,
  _createMaskLightSourcePV,
  _updateLosGeometryLightSource,
  _updateLosGeometryVisionSource,
  _createEVMeshVisionSourcePV,
  _createEVMeshLightSourcePV
} from "./vision.js";

import {
  _computeClockwiseSweepPolygon,
  _drawShadowsClockwiseSweepPolygon,
  initializeClockwiseSweepPolygon
} from "./clockwise_sweep.js";

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
 */
function wrap(method, fn, options = {}) { libWrapper.register(MODULE_ID, method, fn, libWrapper.WRAPPER, options); }

function mixed(method, fn, options = {}) { libWrapper.register(MODULE_ID, method, fn, libWrapper.MIXED, options); }

function override(method, fn, options = {}) { libWrapper.register(MODULE_ID, method, fn, libWrapper.OVERRIDE, options);}

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

export function registerAdditions() {
  addClassMethod(ClockwiseSweepPolygon.prototype, "_drawShadows", _drawShadowsClockwiseSweepPolygon);
  addClassMethod(LightSource.prototype, "_updateEVLightUniforms", _updateEVLightUniformsLightSource);
  addClassMethod(VisionSource.prototype, "_updateEVVisionUniforms", _updateEVLightUniformsLightSource);
  addClassMethod(Token.prototype, "getTopLeft", getTopLeftTokenCorner);

  addClassMethod(VisionSource.prototype, "_createEVMask", _createEVMask);
  addClassMethod(LightSource.prototype, "_createEVMask", _createEVMask);

  if ( MODULES_ACTIVE.PERFECT_VISION ) shaderPVAdditions();
  else shaderAdditions();
}

function shaderAdditions() {
  addClassMethod(VisionSource.prototype, "_createEVMesh", _createEVMeshVisionSource);
  addClassMethod(LightSource.prototype, "_createEVMesh", _createEVMeshLightSource);
}

function shaderPVAdditions() {
  addClassMethod(VisionSource.prototype, "_createEVMesh", _createEVMeshVisionSourcePV);
  addClassMethod(LightSource.prototype, "_createEVMesh", _createEVMeshLightSourcePV);
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
const shaderMixed = regShaderPatch(mixed);
const shaderOverride = regShaderPatch(override);


export function registerPatches() {
  // Unneeded with fixes to PV shader patcher: if ( typeof PerfectVision !== "undefined" ) PerfectVision.debug = true;

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
  const shader_choice = use_shader | (MODULES_ACTIVE.PERFECT_VISION << 1);

  if ( use_shader ) {
    // ----- Drawing shadows for light sources ----- //
    shaderWrap("LightSource.prototype._updateColorationUniforms", _updateColorationUniformsLightSource, { perf_mode: libWrapper.PERF_FAST });
    shaderWrap("LightSource.prototype._updateIlluminationUniforms", _updateIlluminationUniformsLightSource, { perf_mode: libWrapper.PERF_FAST });
    shaderWrap("LightSource.prototype._createPolygon", _createPolygonLightSource, { perf_mode: libWrapper.PERF_FAST });
  }

  switch ( shader_choice ) {
    case SHADER_SWITCH.NO_SHADER:
      shaderOverride("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityPolygons, { perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.SHADER:
      shaderWrap("VisionSource.prototype._updateLosGeometry", _updateLosGeometryVisionSource, { perf_mode: libWrapper.PERF_FAST });
      shaderWrap("LightSource.prototype._updateLosGeometry", _updateLosGeometryLightSource, { perf_mode: libWrapper.PERF_FAST });
      shaderOverride("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityShader, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.PV_NO_SHADER:
      shaderWrap("CanvasVisionMask.prototype.createVision", createVisionCanvasVisionMaskPV, { perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.PV_SHADER:
      shaderOverride("VisionSource.prototype._createMask", _createMaskVisionSourcePV, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      shaderMixed("LightSource.prototype._createMask", _createMaskLightSourcePV, { type: libWrapper.MIXED, perf_mode: libWrapper.PERF_FAST });
      break;
  }
}
