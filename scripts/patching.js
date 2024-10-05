/* globals
canvas,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches

import { Patcher } from "./Patcher.js";
import { getSceneSetting, Settings } from "./settings.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

import { PATCHES as PATCHES_ActiveEffect } from "./ActiveEffect.js";
import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientLightConfig } from "./AmbientLightConfig.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./ClockwiseSweepPolygon.js";
import { PATCHES as PATCHES_PIXI_LegacyGraphics } from "./PIXI_LegacyGraphics.js";
import { PATCHES as PATCHES_PointLightSource } from "./PointLightSource.js";
import { PATCHES as PATCHES_PointVisionSource } from "./PointVisionSource.js";
import { PATCHES as PATCHES_RenderedEffectSource } from "./RenderedEffectSource.js";
import { PATCHES as PATCHES_Region } from "./Region.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_RegionConfig } from "./RegionConfig.js";

import {
  PATCHES_DetectionMode,
  PATCHES_DetectionModeBasicSight,
  PATCHES_DetectionModeTremor } from "./detection_modes.js";


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
  "foundry.applications.sheets.AmbientLightConfig": PATCHES_AmbientLightConfig,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  "foundry.canvas.sources.PointLightSource": PATCHES_PointLightSource,
  "PIXI.LegacyGraphics": PATCHES_PIXI_LegacyGraphics,
  "foundry.applications.sheets.RegionConfig": PATCHES_RegionConfig,
  "foundry.canvas.sources.RenderedEffectSource": PATCHES_RenderedEffectSource,
  Region: PATCHES_Region,
  "foundry.canvas.sources.PointVisionSource": PATCHES_PointVisionSource,
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("REGIONS");
  registerPatchesForSettings();
}

/**
 * Register patches for the current settings
 */
export function registerPatchesForSettings() {
  const visibility = Settings.get(Settings.KEYS.TEST_VISIBILITY);
  const sweep = Settings.get(Settings.KEYS.CLOCKWISE_SWEEP);
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
  const { ALGORITHM, TYPES } = Settings.KEYS.SHADING;
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
    if ( lightSource instanceof foundry.canvas.sources.GlobalLightSource ) continue;
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
