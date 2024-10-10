/* globals
Hooks,
game,
canvas,
CONFIG,
loadTemplates,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS, TEMPLATES } from "./const.js";
import { log } from "./util.js";

// API imports
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";
import {
  SourceShadowWallGeometry,
  PointSourceShadowWallGeometry,
  DirectionalSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";

import { DirectionalLightSource } from "./DirectionalLightSource.js";

// Register methods, patches, settings
import { PATCHER, initializePatching, registerPatchesForSceneSettings } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

// Settings, to toggle whether to change elevation on token move
import { Settings, getSceneSetting, setSceneSetting } from "./settings.js";

import { ElevationTextureHandler } from "./ElevationTextureHandler.js";

// Other self-executing hooks
import "./changelog.js";

// Imported elsewhere: import "./scenes.js";

Hooks.once("init", function() {
  registerGeometry();

  // CONFIG.debug.hooks = true;
  console.debug(`${MODULE_ID}|init`);

  CONFIG.controlIcons.directionalLight = "icons/svg/sun.svg";
  CONFIG.controlIcons.directionalLightOff = "icons/svg/cancel.svg";

  // Set CONFIGS used by this module.
  CONFIG[MODULE_ID] = {

    /**
     * ElevationLayer.
     * Maximum texture size used to represent elevation values.
     * @type {number}
     */
    elevationTextureSize: 4096, // 64^2

    /**
     * ElevationLayer.
     * Resolution to use for the layer, as a percentage between 0 and 1.
     * 1 means the texture will be the same size as the canvas.
     * Texture will still be limited by elevationTextureSize; resolution may be rounded.
     * @type {number}
     */
    resolution: 0.25,

    /**
     * WebGL shadows.
     * Maximum texture size used to represent shadows.
     * @type {number}
     */
    shadowTextureSize: 4096, // 64^2
  };

  game.modules.get(MODULE_ID).api = {
    util,
    extract,
    DirectionalLightSource,
    PATCHER,

    glsl: {
      SourceShadowWallGeometry,
      PointSourceShadowWallGeometry,
      DirectionalSourceShadowWallGeometry,
    }
  };

  // These methods need to be registered early
  Settings.registerAll();
  initializePatching();

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
  log("Setup...");
  loadTemplates(Object.values(TEMPLATES)).then(_value => log("Templates loaded."));
});

Hooks.on("canvasInit", function(_canvas) {
  log("canvasInit");
  canvas.scene[MODULE_ID] = new ElevationTextureHandler();
  canvas.scene[MODULE_ID].initialize(); // Async.
  registerPatchesForSceneSettings();
});

Hooks.on("canvasReady", function() {
  // Set the elevation grid now that we know scene dimensions
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

// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

