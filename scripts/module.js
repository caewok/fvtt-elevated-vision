/* globals
Hooks,
game,
canvas,
CONFIG,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { log } from "./util.js";

// API imports
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";

import { FILOQueue } from "./FILOQueue.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";
import { PixelCache, TilePixelCache } from "./PixelCache.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";
import { TokenPointElevationCalculator } from "./TokenPointElevationCalculator.js";
import { TokenAverageElevationCalculator } from "./TokenAverageElevationCalculator.js";

import { AbstractEVShader } from "./glsl/AbstractEVShader.js";
import { defineFunction } from "./glsl/GLSLFunctions.js";
import { ElevationLayerShader } from "./glsl/ElevationLayerShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";
import { SourceShadowWallGeometry, DirectionalSourceShadowWallGeometry, PointSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowWallShader, ShadowWallPointSourceMesh, TestGeometryShader } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { TestShadowShader } from "./glsl/TestShadowShader.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

// Register methods, patches, settings
import { PATCHES, REG_TRACKER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

// For elevation layer registration and API
import { ElevationLayer } from "./ElevationLayer.js";

// Settings, to toggle whether to change elevation on token move
import { SETTINGS, registerSettings, getSceneSetting, setSceneSetting } from "./settings.js";

import { updateFlyTokenControl } from "./scenes.js";

// Hooks
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientSound } from "./AmbientSound.js";
import { PATCHES as PATCHES_RenderedPointSource } from "./RenderedPointSource.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

import { PATCHES_Token, PATCHES_ActiveEffect } from "./Token.js";

import {
  PATCHES_AmbientLightConfig,
  PATCHES_AmbientSoundConfig,
  PATCHES_TileConfig } from "./render_configs.js";

// Other self-executing hooks
import "./changelog.js";
import "./controls.js";

// Imported elsewhere: import "./scenes.js";

Hooks.once("init", function() {
  // CONFIG.debug.hooks = true;
  console.debug(`${MODULE_ID}|init`);

  CONFIG.controlIcons.directionalLight = "icons/svg/sun.svg";
  CONFIG.controlIcons.directionalLightOff = "icons/svg/cancel.svg";

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
    averageTiles: 2
  };

  game.modules.get(MODULE_ID).api = {
    util,
    extract,
    ElevationLayer,
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
    ElevationLayerShader,

    AbstractEVShader,
    SourceShadowWallGeometry,
    PointSourceShadowWallGeometry,
    DirectionalSourceShadowWallGeometry,
    defineFunction,
    ShadowWallShader,
    ShadowWallPointSourceMesh,
    EVQuadMesh,
    ShadowTextureRenderer,
    TestShadowShader,
    TestGeometryShader,
    DirectionalLightSource,

    PATCHES,
    REG_TRACKER
  };

  // These methods need to be registered early
  registerGeometry();
  registerSettings();
  initializePatching();
  registerLayer();

  // Register new render flag for elevation changes to placeables.
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");

  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshElevation = {};
  CONFIG.AmbientSound.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshElevation");

  // Register new render flag for radius changes to lights
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshRadius = {};
  CONFIG.AmbientLight.objectClass.RENDER_FLAGS.refreshField.propagate.push("refreshRadius");
});

Hooks.once("setup", function() {
  // The game.scenes object is present here
});

Hooks.on("canvasInit", function(_canvas) {
  log("canvasInit");
//   registerShadowPatches(getSceneSetting(SETTINGS.SHADING.ALGORITHM));
  updateFlyTokenControl();
});

Hooks.on("canvasReady", function() {
  // Set the elevation grid now that we know scene dimensions
  if ( !canvas.elevation ) return;
  canvas.elevation.initialize();
  setDirectionalLightSources(canvas.lighting.placeables);
  DirectionalLightSource._refreshElevationAngleGuidelines();
});

function setDirectionalLightSources(lights) {
  lights.forEach(l => {
    // Assuming all lights currently are non-directional.
    if ( !l.document.getFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED) ) return;
    l.convertToDirectionalLight();
  });
}

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
    // registerShadowPatches(SETTINGS.SHADING.TYPES.NONE);
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

Hooks.on("preUpdateToken", PATCHES_Token.BASIC.HOOKS.preUpdateToken);
Hooks.on("refreshToken", PATCHES_Token.BASIC.HOOKS.refreshToken);
Hooks.on("createActiveEffect", PATCHES_ActiveEffect.createActiveEffect);
Hooks.on("deleteActiveEffect", PATCHES_ActiveEffect.deleteActiveEffect);

Hooks.on("updateTile", PATCHES_Tile.BASIC.HOOKS.updateTile);
Hooks.on("renderTileConfig", PATCHES_TileConfig.BASIC.HOOKS.renderTileConfig);

Hooks.on("renderAmbientLightConfig", PATCHES_AmbientLightConfig.BASIC.HOOKS.renderAmbientLightConfig);
Hooks.on("renderAmbientSoundConfig", PATCHES_AmbientSoundConfig.BASIC.HOOKS.renderAmbientSoundConfig);
Hooks.on("updateAmbientLight", PATCHES_AmbientLight.BASIC.HOOKS.updateAmbientLight);
Hooks.on("updateAmbientSound", PATCHES_AmbientSound.BASIC.HOOKS.updateAmbientSound);
Hooks.on("refreshAmbientLight", PATCHES_AmbientLight.BASIC.HOOKS.refreshAmbientLight);
Hooks.on("hoverAmbientLight", PATCHES_AmbientLight.BASIC.HOOKS.hoverAmbientLight);

Hooks.on("initializeLightSourceShaders", PATCHES_RenderedPointSource.WEBGL.HOOKS.initializeLightSourceShaders);
Hooks.on("initializeVisionSourceShaders", PATCHES_RenderedPointSource.WEBGL.HOOKS.initializeVisionSourceShaders);
Hooks.on("initializeDirectionalLightSourceShaders", PATCHES_RenderedPointSource.WEBGL.HOOKS.initializeDirectionalLightSourceShaders);

Hooks.on("createWall", PATCHES_Wall.WEBGL.HOOKS.createWall);
Hooks.on("updateWall", PATCHES_Wall.WEBGL.HOOKS.updateWall);
Hooks.on("deleteWall", PATCHES_Wall.WEBGL.HOOKS.deleteWall);


// Hooks.on("refreshAmbientSound", refreshAmbientSoundHook);
