/* globals
AmbientLight,
canvas,
CanvasVisibility,
ClockwiseSweepPolygon,
GlobalLightSource,
libWrapper,
LightSource,
PIXI,
RenderedPointSource,
SettingsConfig,
Tile,
Token,
VisionSource
*/

"use strict";

// Patches

import { MODULE_ID } from "./const.js";
import { getSetting, SETTINGS } from "./settings.js";

import {
  defaultOptionsAmbientSoundConfig,
  getDataTileConfig,
  _onChangeInputTileConfig
} from "./renderConfig.js";

import {
  cloneToken
} from "./tokens.js";

import {
  drawShapePIXIGraphics,
  _testLOSDetectionMode,
  _testPointDetectionModeBasicSight,
  _canDetectDetectionModeTremor } from "./vision.js";

import {
  _computeClockwiseSweepPolygon,
  _drawShadowsClockwiseSweepPolygon,
  initializeClockwiseSweepPolygon
} from "./clockwise_sweep.js";

import { getEVPixelCacheTile } from "./tiles.js";

import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_GlobalLightSource } from "./GlobalLightSource.js";
import { PATCHES as PATCHES_LightSource } from "./LightSource.js";

import {
  _configureRenderedPointSource,
  destroyRenderedPointSource,
  wallAddedRenderedPointSource,
  wallUpdatedRenderedPointSource,
  wallRemovedRenderedPointSource,
  boundsRenderedPointSource,

  EVVisionMaskRenderedPointSource,
  EVVisionLOSMaskVisionSource,
  EVVisionMaskVisionSource,

  _initializeEVShadowsRenderedPointSource,
  _initializeEVShadowGeometryRenderedPointSource,
  _initializeEVShadowMeshRenderedPointSource,
  _initializeEVShadowRendererRenderedPointSource,
  _initializeEVShadowMaskRenderedPointSource,

  _initializeEVShadowGeometryVisionSource,
  _initializeEVShadowRendererVisionSource,
  _initializeEVShadowMaskVisionSource,

  _updateEVShadowDataRenderedPointSource,

  // Shadow visibility testing.
  BRIGHTNESS_LEVEL,
  pointInShadowRenderedPointSource,
  targetInShadowRenderedSource,
  targetInShadowVisionSource,
  hasWallCollisionRenderedPointSource } from "./shadow_hooks.js";

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

// Currently unused
// function mixed(method, fn, options = {}) {
//   return libWrapper.register(MODULE_ID, method, fn, libWrapper.MIXED, options);
// }

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
  wrap("Canvas.prototype._onMouseMove", PATCHES_Canvas.BASIC.WRAPS._onMouseMove, { perf_mode: libWrapper.PERF_FAST });

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

  // ----- Lighting elevation tooltip ----- //
  wrap("AmbientLight.prototype._draw", PATCHES_AmbientLight.BASIC.WRAPS._draw);

  // ----- Directional lighting ----- //
  wrap("AmbientLight.prototype.clone", PATCHES_AmbientLight.BASIC.WRAPS.clone);
  wrap("AmbientLight.prototype._onUpdate", PATCHES_AmbientLight.BASIC.WRAPS._onUpdate);
  wrap("AmbientLight.prototype.refreshControl", PATCHES_AmbientLight.BASIC.WRAPS.refreshControl);

  // ----- Penumbra lighting shadows ----- //
  wrap("LightSource.prototype._initialize", PATCHES_LightSource.WEBGL.WRAPS._initialize);
  wrap("LightSource.prototype._createPolygon", PATCHES_LightSource.WEBGL.WRAPS._createPolygon);

  // ----- Shadow visibility testing ----- //
  if ( getSetting(SETTINGS.TEST_VISIBILITY) ) {
    override("DetectionMode.prototype._testLOS", _testLOSDetectionMode, { perf_mode: libWrapper.PERF_FAST });
    override("DetectionModeBasicSight.prototype._testPoint", _testPointDetectionModeBasicSight, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Tremor visibility detection ----- //
  override("DetectionModeTremor.prototype._canDetect", _canDetectDetectionModeTremor, { perf_mode: libWrapper.PERF_FAST });

  // Clear the prior libWrapper shader ids, if any.
  libWrapperShaderIds.length = 0;
}

export function registerAdditions() {
  addClassMethod(ClockwiseSweepPolygon.prototype, "_drawShadows", _drawShadowsClockwiseSweepPolygon);
  addClassMethod(Token.prototype, "getTopLeft", getTopLeftTokenCorner);

  addClassGetter(Tile.prototype, "evPixelCache", getEVPixelCacheTile);
  addClassMethod(Tile.prototype, "_evPixelCache", undefined);

  // For Polygons shadows -- Nothing added

  // For Directional Lighting
  addClassMethod(AmbientLight.prototype, "convertToDirectionalLight", PATCHES_AmbientLight.BASIC.METHODS.convertToDirectionalLight);
  addClassMethod(AmbientLight.prototype, "convertFromDirectionalLight", PATCHES_AmbientLight.BASIC.METHODS.convertFromDirectionalLight);

  // For WebGL shadows
  addClassMethod(RenderedPointSource.prototype, "wallAdded", wallAddedRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "wallUpdated", wallUpdatedRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "wallRemoved", wallRemovedRenderedPointSource);
  addClassGetter(RenderedPointSource.prototype, "bounds", boundsRenderedPointSource);

  addClassMethod(CanvasVisibility.prototype, "checkLights", PATCHES_CanvasVisibility.WEBGL.METHODS.checkLights);
  addClassMethod(CanvasVisibility.prototype, "cacheLights", PATCHES_CanvasVisibility.WEBGL.METHODS.cacheLights);
  addClassMethod(CanvasVisibility.prototype, "renderTransform", PATCHES_CanvasVisibility.WEBGL.METHODS.renderTransform);
  addClassMethod(CanvasVisibility.prototype, "pointSourcesStates", PATCHES_CanvasVisibility.WEBGL.METHODS.pointSourcesStates);

  // For WebGL shadows -- shadow properties
  addClassGetter(RenderedPointSource.prototype, "EVVisionMask", EVVisionMaskRenderedPointSource);
  addClassGetter(VisionSource.prototype, "EVVisionLOSMask", EVVisionLOSMaskVisionSource);
  addClassGetter(GlobalLightSource.prototype, "EVVisionMask", PATCHES_GlobalLightSource.WEBGL.GETTERS.EVVisionMask);
  addClassGetter(VisionSource.prototype, "EVVisionMask", EVVisionMaskVisionSource);

  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadows", _initializeEVShadowsRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowGeometry", _initializeEVShadowGeometryRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowMesh", _initializeEVShadowMeshRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowRenderer", _initializeEVShadowRendererRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowMask", _initializeEVShadowMaskRenderedPointSource);

  addClassMethod(LightSource.prototype, "_initializeEVShadowMesh", PATCHES_LightSource.WEBGL.METHODS._initializeEVShadowMesh);

  addClassMethod(VisionSource.prototype, "_initializeEVShadowGeometry", _initializeEVShadowGeometryVisionSource);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowRenderer", _initializeEVShadowRendererVisionSource);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowMask", _initializeEVShadowMaskVisionSource);

  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadows", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadows);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowGeometry", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowGeometry);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowMesh", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowMesh);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowRenderer", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowRenderer);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowMask", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowMask);

  addClassMethod(RenderedPointSource.prototype, "_updateEVShadowData", _updateEVShadowDataRenderedPointSource);
  addClassMethod(LightSource.prototype, "_updateEVShadowData", PATCHES_LightSource.WEBGL.METHODS._updateEVShadowData);
  addClassMethod(GlobalLightSource.prototype, "_updateEVShadowData", PATCHES_GlobalLightSource.WEBGL.METHODS._updateEVShadowData);

  // For light elevation tooltip
  addClassMethod(AmbientLight.prototype, "_drawTooltip", PATCHES_AmbientLight.BASIC.METHODS._drawTooltip);
  addClassMethod(AmbientLight.prototype, "_getTooltipText", PATCHES_AmbientLight.BASIC.METHODS._getTooltipText);
  addClassMethod(AmbientLight, "_getTextStyle", PATCHES_AmbientLight.BASIC.STATIC_METHODS._getTextStyle);

  // For vision in dim/bright/shadows
  addClassMethod(RenderedPointSource.prototype, "pointInShadow", pointInShadowRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "targetInShadow", targetInShadowRenderedSource);
  addClassMethod(VisionSource.prototype, "targetInShadow", targetInShadowVisionSource);
  addClassMethod(RenderedPointSource.prototype, "hasWallCollision", hasWallCollisionRenderedPointSource);
}


/**
 * Deregister shading wrappers.
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
function deregisterShadowPatches() {
  libWrapperShaderIds.forEach(i => libWrapper.unregister(MODULE_ID, i, false));
}

export async function updateShadowPatches(algorithm, priorAlgorithm) {
  registerShadowPatches(algorithm);

  if ( (!priorAlgorithm && algorithm !== SETTINGS.SHADING.TYPES.WEBGL)
    || priorAlgorithm === SETTINGS.SHADING.TYPES.WEBGL ) await SettingsConfig.reloadConfirm({world: true});
  await canvas.draw();

  if ( algorithm === SETTINGS.SHADING.TYPES.WEBGL ) {
    const sources = [
      ...canvas.effects.lightSources,
      ...canvas.tokens.placeables.map(t => t.vision)
    ];

    for ( const src of sources ) {
      const ev = src[MODULE_ID];
      if ( !ev ) continue;

      ev.wallGeometry?.refreshWalls();
      ev.wallGeometryUnbounded?.refreshWalls();

      if ( ev.shadowMesh ) {
        ev.shadowMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowRenderer.update();
      }

      if ( ev.shadowVisionLOSMesh ) {
        ev.shadowVisionLOSMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowVisionLOSRenderer.update();
      }
    }
  }
}

export function registerShadowPatches(algorithm) {
  const TYPES = SETTINGS.SHADING.TYPES;
  switch ( algorithm ) {
    case TYPES.NONE: return registerNoShadowPatches();
    case TYPES.POLYGONS: return registerPolygonShadowPatches();
    case TYPES.WEBGL: return registerWebGLShadowPatches();
  }
}

function registerNoShadowPatches() {
  deregisterShadowPatches();
}

function registerPolygonShadowPatches() {
  deregisterShadowPatches();
  shaderWrap("PIXI.LegacyGraphics.prototype.drawShape", drawShapePIXIGraphics, { perf_mode: libWrapper.PERF_FAST });
}

function registerWebGLShadowPatches() {
  deregisterShadowPatches();
  shaderOverride("CanvasVisibility.prototype.refreshVisibility", PATCHES_CanvasVisibility.WEBGL.OVERRIDES.refreshVisibility, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("CanvasVisibility.prototype._tearDown", PATCHES_CanvasVisibility.WEBGL.WRAPS._tearDown, { perf_mode: libWrapper.PERF_FAST });

  shaderWrap("AdaptiveLightingShader.create", PATCHES_AdaptiveLightingShader.BASIC.STATIC_WRAPS.create);

  shaderWrap("RenderedPointSource.prototype._configure", _configureRenderedPointSource, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("RenderedPointSource.prototype.destroy", destroyRenderedPointSource, { perf_mode: libWrapper.PERF_FAST });
}

// NOTE: Simple functions used in additions.

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
