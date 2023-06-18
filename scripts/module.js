/* globals
Hooks,
game,
canvas,
CONFIG,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";

// API imports
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";
import { FILOQueue } from "./FILOQueue.js";
import { ShadowShader } from "./ShadowShader.js";
import { ShadowShaderNoRadius } from "./ShadowShaderNoRadius.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";
import { PixelCache, TilePixelCache } from "./PixelCache.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";
import { TokenPointElevationCalculator } from "./TokenPointElevationCalculator.js";
import { TokenAverageElevationCalculator } from "./TokenAverageElevationCalculator.js";
import { ElevationLayerShader } from "./ElevationLayerShader.js";

// Register methods, patches, settings
import { registerAdditions, registerPatches, registerShadowPatches } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

// For elevation layer registration and API
import { ElevationLayer } from "./ElevationLayer.js";

// Settings, to toggle whether to change elevation on token move
import { SETTINGS, registerSettings, getSceneSetting, setSceneSetting } from "./settings.js";

import { updateFlyTokenControl } from "./scenes.js";

// Hooks
import { preUpdateTokenHook, refreshTokenHook } from "./tokens.js";
import { updateTileHook } from "./tiles.js";
import {
  initializeLightSourceShadersHook,
  initializeVisionSourceShadersHook } from "./rendered_point_sources.js";
import {
  renderAmbientLightConfigHook,
  renderAmbientSoundConfigHook,
  renderTileConfigHook,
  updateAmbientLightDocumentHook,
  updateAmbientSoundDocumentHook,
  refreshAmbientLightHook,
  refreshAmbientSoundHook } from "./renderConfig.js";

// Other self-executing hooks
import "./changelog.js";
import "./controls.js";

// Imported elsewhere: import "./scenes.js";

Hooks.once("init", function() {
  // CONFIG.debug.hooks = true;


  // Set CONFIGS used by this module.
  CONFIG[MODULE_ID] = {

    /**
     * TravelElevation.
     * The percent threshold under which a tile should be considered transparent at that pixel.
     * @type {number}
     */
    alphaThreshold: 0.75,

    /**
     * ElevationLayer.
     * Maximum texture size used to represent elevation values.
     * @type {number}
     */
    elevationTextureSize: 4096,

    /**
     * ElevationLayer.
     * Resolution to use for the layer, as a percentage between 0 and 1.
     * 1 means the texture will be the same size as the canvas.
     * Texture will still be limited by elevationTextureSize; resolution may be rounded.
     * @type {number}
     */
    resolution: 0.25,

    /**
     * TravelElevation.
     * Permitted step size to allow tokens to move between tiles of similar elevations before flying.
     * If undefined, will use token height.
     * @type {number|undefined}
     */
    tileStep: undefined,

    /**
     * TravelElevation.
     * Permitted step size to allow tokens to move between terrains of similar elevations before flying.
     * If undefined, will use token height or (for coordinate testing) terrain height.
     * @type {number|undefined}
     */
    terrainStep: undefined,

    /**
     * TravelElevation.
     * When auto-averaging is enabled, this value will be used to average over terrain when
     * calculating token travel elevation. 0 means do not average, 1+ means test every N pixels.
     * Should be a positive number or 0. Decimals are allowed.
     * Larger numbers will make averaging faster but less precise.
     * @type {number}
     */
    averageTerrain: 2,

    /**
     * TravelElevation.
     * When auto-averaging is enabled, this value will be used to average over tiles when
     * calculating token travel elevation. 0 means do not average, 1+ means test every N pixels.
     * Should be a positive number or 0. Decimals are allowed.
     * Larger numbers will make averaging faster but less precise.
     * @type {number}
     */
    averageTiles: 2,

    /**
     * Maximum number of walls passed to the GLSL shader.
     * This has a performance consequence. Also, even if the number of walls is not
     * reached in a scene, setting this value too high could result in errors if it
     * exceeds the maximum permissible number of uniforms that can be sent to the GPU.
     *
     */
    maxShaderWalls: 100
  };

  game.modules.get(MODULE_ID).api = {
    util,
    extract,
    ElevationLayer,
    ShadowShader,
    ShadowShaderNoRadius,
    FILOQueue,
    WallTracerEdge,
    WallTracerVertex,
    WallTracer,
    SCENE_GRAPH,
    PixelCache,
    TilePixelCache,
    CoordinateElevationCalculator,
    TokenPointElevationCalculator,
    TokenAverageElevationCalculator,
    ElevationLayerShader
  };

  // These methods need to be registered early
  registerGeometry();
  registerSettings();
  registerLayer();
  registerAdditions();

  // Register new render flag for elevation changes to placeables.
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");

  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");
});

Hooks.once("setup", function() {
  // game.scenes is present here
  registerPatches();
});

Hooks.on("canvasInit", function(_canvas) {
  log("canvasInit");
  registerShadowPatches();
  updateFlyTokenControl();
});

Hooks.on("canvasReady", function() {
  // Set the elevation grid now that we know scene dimensions
  if ( !canvas.elevation ) return;
  canvas.elevation.initialize();
});

Hooks.on("3DCanvasSceneReady", function(_previewArr) {
  disableScene();
});

Hooks.on("3DCanvasToggleMode", function(isOn) {
  // TODO: Do we need to reset the values for the scene? Seems unnecessary, as a 3d canvas
  //       is not likely to be used in a non-3d state and require EV for it.
  if ( !isOn ) return;
  disableScene();
});

async function disableScene() {
  const autoelevateDisabled = getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const shadowsDisabled = getSceneSetting(SETTINGS.SHADING.ALGORITHM) !== SETTINGS.SHADING.TYPES.NONE;

  if ( autoelevateDisabled ) {
    await setSceneSetting(SETTINGS.AUTO_ELEVATION, false);
    updateFlyTokenControl(false);
  }
  if ( shadowsDisabled ) {
    await setSceneSetting(SETTINGS.SHADING.ALGORITHM, SETTINGS.SHADING.TYPES.NONE);
    registerShadowPatches();
    // Looks like we don't need to redraw the scene?
    // await canvas.draw(canvas.scene);
  }

  if ( autoelevateDisabled || shadowsDisabled ) {
    ui.notifications.notify("Elevated Vision autoelevate and features for the scene disabled for compatibility with 3D Canvas.");
  }
}


// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

function registerLayer() {
  CONFIG.Canvas.layers.elevation = { group: "primary", layerClass: ElevationLayer };
}

Hooks.on("preUpdateToken", preUpdateTokenHook);
Hooks.on("refreshToken", refreshTokenHook);

Hooks.on("updateTile", updateTileHook);
Hooks.on("renderTileConfig", renderTileConfigHook);

Hooks.on("initializeVisionSourceShaders", initializeVisionSourceShadersHook);
Hooks.on("initializeLightSourceShaders", initializeLightSourceShadersHook);

Hooks.on("renderAmbientLightConfig", renderAmbientLightConfigHook);
Hooks.on("renderAmbientSoundConfig", renderAmbientSoundConfigHook);
Hooks.on("updateAmbientLightDocument", updateAmbientLightDocumentHook);
Hooks.on("updateAmbientSoundDocument", updateAmbientSoundDocumentHook);
Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
Hooks.on("refreshAmbientSound", refreshAmbientSoundHook);


