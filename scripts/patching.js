/* globals
canvas,
GlobalLightSource,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches

import { Patcher } from "./Patcher.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientSound } from "./AmbientSound.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./ClockwiseSweepPolygon.js";
import { PATCHES as PATCHES_PIXI_LegacyGraphics } from "./PIXI_LegacyGraphics.js";
import { PATCHES as PATCHES_GlobalLightSource } from "./GlobalLightSource.js";
import { PATCHES as PATCHES_LightSource } from "./LightSource.js";
import { PATCHES as PATCHES_RenderedPointSource } from "./RenderedPointSource.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_LightingLayer } from "./LightingLayer.js";

import {
  PATCHES_DetectionMode,
  PATCHES_DetectionModeBasicSight,
  PATCHES_DetectionModeTremor } from "./detection_modes.js";

import {
  PATCHES_AmbientLightConfig,
  PATCHES_AmbientSoundConfig,
  PATCHES_TileConfig } from "./render_configs.js";

import { PATCHES_Token, PATCHES_ActiveEffect } from "./Token.js";


/**
 * Groupings:
 * - BASIC        Always in effect
 * - POLYGON      When Polygon shadow setting is selected
 * - WEBGL        When WebGL shadow setting is selected
 * - SWEEP        When Sweep enhancement setting is selected
 * - VISIBILITY   When EV is responsibility for testing visibility
 *
 * Patching options:
 * - WRAPS
 * - OVERRIDES
 * - METHODS
 * - GETTERS
 * - STATIC_WRAPS
 */
export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  AdaptiveLightingShader: PATCHES_AdaptiveLightingShader,
  AmbientLight: PATCHES_AmbientLight,
  AmbientLightConfig: PATCHES_AmbientLightConfig,
  AmbientSound: PATCHES_AmbientSound,
  AmbientSoundConfig: PATCHES_AmbientSoundConfig,
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  GlobalLightSource: PATCHES_GlobalLightSource,
  LightingLayer: PATCHES_LightingLayer,
  LightSource: PATCHES_LightSource,
  "PIXI.LegacyGraphics": PATCHES_PIXI_LegacyGraphics,
  RenderedPointSource: PATCHES_RenderedPointSource,
  Tile: PATCHES_Tile,
  TileConfig: PATCHES_TileConfig,
  Token: PATCHES_Token,
  VisionSource: PATCHES_VisionSource,
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  registerPatchesForSettings();
}

/**
 * Register patches for the current settings
 */
export function registerPatchesForSettings() {
  const visibility = getSetting(SETTINGS.TEST_VISIBILITY);
  const sweep = getSetting(SETTINGS.CLOCKWISE_SWEEP);
  unregisterPatchesForSettings();
  if ( visibility ) PATCHER.registerGroup("VISIBILITY");
  if ( sweep ) PATCHER.registerGroup("SWEEP");
}

function unregisterPatchesForSettings() {
  PATCHER.deregisterGroup("VISIBILITY");
  PATCHER.deregisterGroup("SWEEP");
}

/**
 * Register patches for the current scene settings
 */
export function registerPatchesForSceneSettings() {
  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const algorithm = getSceneSetting(ALGORITHM);
  unregisterPatchesForSceneSettings();
  switch ( algorithm ) {
    case TYPES.POLYGONS: PATCHER.registerGroup("POLYGONS"); break;
    case TYPES.WEBGL: {
      PATCHER.registerGroup("WEBGL");
      canvas.effects.lightSources.forEach(src => src._initializeEVShadows());
      break;
    }
  }

  if ( algorithm !== TYPES.WEBGL ) {
    canvas.effects.lightSources.forEach(src => {
      Object.values(src.layers).forEach(layer => layer.shader.uniforms.uEVShadows = false);
    });
  }

  // Trigger initialization of all lights when switching so that the visibility cache is updated.
  for ( const lightSource of canvas.effects.lightSources ) {
    if ( lightSource instanceof GlobalLightSource ) continue;
    if ( lightSource instanceof DirectionalLightSource
      && algorithm !== TYPES.WEBGL ) lightSource.object.convertFromDirectionalLight();

    lightSource.initialize(lightSource.data);
  }

  canvas.perception.update({refreshLighting: true, refreshVision: true});
}

function unregisterPatchesForSceneSettings() {
  PATCHER.deregisterGroup("POLYGONS");
  PATCHER.deregisterGroup("WEBGL");
}
