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
import { PATCHES as PATCHES_CanvasEdges } from "./CanvasEdges.js";
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
 * - LIGHTING     When EV adjusts lighting for elevation
 * - VISION       When EV adjust vision for elevation
 * - VISIBILITY   When EV is responsibility for testing visibility
 * - REGIONS      Code specific to Foundry Regions
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
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  "foundry.canvas.edges.CanvasEdges": PATCHES_CanvasEdges,
  "foundry.canvas.sources.PointLightSource": PATCHES_PointLightSource,
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
  unregisterPatchesForSettings();
  if ( visibility ) PATCHER.registerGroup("VISIBILITY");
}

function unregisterPatchesForSettings() {
  PATCHER.deregisterGroup("VISIBILITY");
}

/**
 * Register patches for the current scene settings
 */
export function registerPatchesForSceneSettings() {
  unregisterPatchesForSceneSettings();
  const { LIGHTING, VISION } = Settings.KEYS.SHADOWS;
  if ( LIGHTING )
  if ( VISION )

  // Trigger initialization of light source shadows.
  if ( LIGHTING ) {
    PATCHER.registerGroup("LIGHTING");
    canvas.effects.lightSources.forEach(src => src._initializeEVShadows());
  }

  if ( VISION ) {
    PATCHER.registerGroup("VISION");
  }

  if ( !(LIGHTING || VISION) ) {
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
  PATCHER.deregisterGroup("LIGHTING");
  PATCHER.deregisterGroup("VISION");
}
