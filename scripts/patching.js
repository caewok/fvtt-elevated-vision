/* globals
LightSource,
VisionSource,
libWrapper,
ClockwiseSweepPolygon
*/

"use strict";

// Patches

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { getSetting, SETTINGS } from "./settings.js";

import { defaultOptionsAmbientSoundConfig } from "./renderAmbientConfig.js";

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
  _drawShadowsClockwiseSweepPolygon
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
  const shaderAlgorithm = getSetting(SETTINGS.SHADING.ALGORITHM);
  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.NONE ) return;

  const use_shader = shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL;
  const shader_choice = use_shader | (MODULES_ACTIVE.PERFECT_VISION << 1);

  Object.defineProperty(ClockwiseSweepPolygon.prototype, "_drawShadows", {
    value: _drawShadowsClockwiseSweepPolygon,
    writable: true,
    configurable: true
  });

  if ( use_shader ) {
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
  }

  switch ( shader_choice ) {
    case SHADER_SWITCH.NO_SHADER: break;
    case SHADER_SWITCH.SHADER: shaderAdditions(); break;
    case SHADER_SWITCH.PV_NO_SHADER: break;
    case SHADER_SWITCH.PV_SHADER: shaderPVAdditions(); break;
  }

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


export function registerPatches() {
  const shaderAlgorithm = getSetting(SETTINGS.SHADING.ALGORITHM);
  // ----- Locating edges that create shadows in the LOS ----- //
  libWrapper.register(MODULE_ID, "ClockwiseSweepPolygon.prototype._compute", _computeClockwiseSweepPolygon, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

  // ----- Token animation and elevation change ---- //
  libWrapper.register(MODULE_ID, "Token.prototype._refresh", _refreshToken, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  libWrapper.register(MODULE_ID, "Token.prototype.clone", cloneToken, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});

  // ----- Rendering configurations ----- //
  libWrapper.register(MODULE_ID, "AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig, libWrapper.WRAPPER);

  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.NONE ) return;

  // ----- Drawing shadows for vision source LOS, fog  ----- //
  const use_shader = shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL;
  const shader_choice = use_shader | (MODULES_ACTIVE.PERFECT_VISION << 1);

  if ( use_shader ) {
    // ----- Shader code for drawing shadows ----- //
    libWrapper.register(MODULE_ID, "AdaptiveLightingShader.create", createAdaptiveLightingShader, libWrapper.WRAPPER);

    // ----- Drawing shadows for light sources ----- //
    libWrapper.register(MODULE_ID, "LightSource.prototype._updateColorationUniforms", _updateColorationUniformsLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
    libWrapper.register(MODULE_ID, "LightSource.prototype._updateIlluminationUniforms", _updateIlluminationUniformsLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
    libWrapper.register(MODULE_ID, "LightSource.prototype._createPolygon", _createPolygonLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
  }

  switch ( shader_choice ) {
    case SHADER_SWITCH.NO_SHADER:
      libWrapper.register(MODULE_ID, "CanvasVisibility.prototype.refresh", refreshCanvasVisibilityPolygons, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});
      break;
    case SHADER_SWITCH.SHADER:
      libWrapper.register(MODULE_ID, "VisionSource.prototype._updateLosGeometry", _updateLosGeometryVisionSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
      libWrapper.register(MODULE_ID, "LightSource.prototype._updateLosGeometry", _updateLosGeometryLightSource, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
      libWrapper.register(MODULE_ID, "CanvasVisibility.prototype.refresh", refreshCanvasVisibilityShader, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});
      break;
    case SHADER_SWITCH.PV_NO_SHADER:
      libWrapper.register(MODULE_ID, "CanvasVisionMask.prototype.createVision", createVisionCanvasVisionMaskPV, libWrapper.WRAPPER, {perf_mode: libWrapper.PERF_FAST});
      break;
    case SHADER_SWITCH.PV_SHADER:
      libWrapper.register(MODULE_ID, "VisionSource.prototype._createMask", _createMaskVisionSourcePV, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});
      libWrapper.register(MODULE_ID, "LightSource.prototype._createMask", _createMaskLightSourcePV, libWrapper.MIXED, {perf_mode: libWrapper.PERF_FAST});
      break;
  }

}
