/* globals
LightSource,
VisionSource,
libWrapper,
ClockwiseSweepPolygon
canvas
*/

"use strict";

// Patches

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";

import {
  defaultOptionsAmbientSoundConfig,
  getDataTileConfig,
  getDataWallConfig,
  getDataTokenConfig,
  _onChangeInputTileConfig
} from "./renderConfig.js";

import {
  _refreshToken,
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

export function registerAdditions() {
  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_drawShadows", {
    value: _drawShadowsClockwiseSweepPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(LightSource.prototype, "_updateEVLightUniforms", {
    value: _updateEVLightUniformsLightSource,
    writable: true,
    configurable: true
  });

  Object.defineProperty(VisionSource.prototype, "_updateEVVisionUniforms", {
    value: _updateEVLightUniformsLightSource,
    writable: true,
    configurable: true
  });

  if ( MODULES_ACTIVE.PERFECT_VISION ) shaderPVAdditions();
  else shaderAdditions();
}

function shaderAdditions() {
  Object.defineProperty(VisionSource.prototype, "_createEVMesh", {
    value: _createEVMeshVisionSource,
    writable: true,
    configurable: true
  });

  Object.defineProperty(LightSource.prototype, "_createEVMesh", {
    value: _createEVMeshLightSource,
    writable: true,
    configurable: true
  });

  Object.defineProperty(VisionSource.prototype, "_createEVMask", {
    value: _createEVMask,
    writable: true,
    configurable: true
  });

  Object.defineProperty(LightSource.prototype, "_createEVMask", {
    value: _createEVMask,
    writable: true,
    configurable: true
  });

}

function shaderPVAdditions() {
  Object.defineProperty(VisionSource.prototype, "_createEVMesh", {
    value: _createEVMeshVisionSourcePV,
    writable: true,
    configurable: true
  });

  Object.defineProperty(LightSource.prototype, "_createEVMesh", {
    value: _createEVMeshLightSourcePV,
    writable: true,
    configurable: true
  });

  Object.defineProperty(VisionSource.prototype, "_createEVMask", {
    value: _createEVMask,
    writable: true,
    configurable: true
  });

  Object.defineProperty(LightSource.prototype, "_createEVMask", {
    value: _createEVMask,
    writable: true,
    configurable: true
  });
}

// IDs returned by libWrapper.register for the shadow shader patches.
const libWrapperShaderIds = [];

/**
 * Helper to register libWrapper patches.
 */
function regPatch(target, fn, { type, perf_mode } = {}) {
  type ??= libWrapper.WRAPPER;
  perf_mode ??= libWrapper.PERF_NORMAL;
  return libWrapper.register(MODULE_ID, target, fn, type, { perf_mode });
}

/**
 * Helper to register and record libWrapper id for a shader function.
 */
function regShaderPatch(target, fn, { type, perf_mode } = {}) {
  libWrapperShaderIds.push(regPatch(target, fn, {type, perf_mode}));
}

export function registerPatches() {
  // Unneeded with fixes to PV shader patcher: if ( typeof PerfectVision !== "undefined" ) PerfectVision.debug = true;

  // ----- Locating edges that create shadows in the LOS ----- //
  regPatch("ClockwiseSweepPolygon.prototype._compute", _computeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });

  // ----- Token animation and elevation change ---- //
  regPatch("Token.prototype._refresh", _refreshToken, { perf_mode: libWrapper.PERF_FAST });
  regPatch("Token.prototype.clone", cloneToken, { perf_mode: libWrapper.PERF_FAST });

  // ----- Application rendering configurations ----- //
  regPatch("AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig);
  regPatch("TileConfig.prototype.getData", getDataTileConfig);
  regPatch("WallConfig.prototype.getData", getDataWallConfig);
  regPatch("TokenConfig.prototype.getData", getDataTokenConfig);
  regPatch("TileConfig.prototype._onChangeInput", _onChangeInputTileConfig);

  // ----- Clockwise sweep enhancements ----- //
  if ( getSetting(SETTINGS.CLOCKWISE_SWEEP) ) {
    regPatch("ClockwiseSweepPolygon.prototype.initialize", initializeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Shader code for drawing shadows ----- //
  regPatch("AdaptiveLightingShader.create", createAdaptiveLightingShader);

  // Clear the prior libWrapper shader ids, if any.
  libWrapperShaderIds.length = 0;
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
    regShaderPatch("LightSource.prototype._updateColorationUniforms", _updateColorationUniformsLightSource, { perf_mode: libWrapper.PERF_FAST });
    regShaderPatch("LightSource.prototype._updateIlluminationUniforms", _updateIlluminationUniformsLightSource, { perf_mode: libWrapper.PERF_FAST });
    regShaderPatch("LightSource.prototype._createPolygon", _createPolygonLightSource, { perf_mode: libWrapper.PERF_FAST });
  }

  switch ( shader_choice ) {
    case SHADER_SWITCH.NO_SHADER:
      regShaderPatch("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityPolygons, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.SHADER:
      regShaderPatch("VisionSource.prototype._updateLosGeometry", _updateLosGeometryVisionSource, { perf_mode: libWrapper.PERF_FAST });
      regShaderPatch("LightSource.prototype._updateLosGeometry", _updateLosGeometryLightSource, { perf_mode: libWrapper.PERF_FAST });
      regShaderPatch("CanvasVisibility.prototype.refresh", refreshCanvasVisibilityShader, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.PV_NO_SHADER:
      regShaderPatch("CanvasVisionMask.prototype.createVision", createVisionCanvasVisionMaskPV, { perf_mode: libWrapper.PERF_FAST });
      break;
    case SHADER_SWITCH.PV_SHADER:
      regShaderPatch("VisionSource.prototype._createMask", _createMaskVisionSourcePV, { type: libWrapper.OVERRIDE, perf_mode: libWrapper.PERF_FAST });
      regShaderPatch("LightSource.prototype._createMask", _createMaskLightSourcePV, { type: libWrapper.MIXED, perf_mode: libWrapper.PERF_FAST });
      break;
  }
}
