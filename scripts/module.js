/* globals
Hooks,
game,
canvas,
CONFIG,
renderTemplate,
Dialog,
ui,
Ray,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";

// Patches
import { patchTile } from "./patches/Tile.js";

// Rendering configs
import { renderAmbientLightConfigHook, renderAmbientSoundConfigHook, renderTileConfigHook } from "./renderConfig.js";

// API imports
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";
import { FILOQueue } from "./FILOQueue.js";
import { ShadowShader } from "./ShadowShader.js";
import { ShadowShaderNoRadius } from "./ShadowShaderNoRadius.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";
import { PixelCache, TilePixelCache } from "./PixelCache.js";
import { TravelElevation } from "./TravelElevation.js";

// Register methods, patches, settings
import { registerAdditions, registerPatches, registerShadowPatches } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";
import { registerElevationAdditions } from "./elevation.js";

// For elevation layer registration and API
import { ElevationLayer } from "./ElevationLayer.js";

// Elevation Layer control tools
import {
  addElevationLayerSceneControls,
  addElevationLayerSubControls,
  renderElevationLayerSubControls
} from "./controls.js";

// Settings, to toggle whether to change elevation on token move
import { SETTINGS, getSetting, setSetting, registerSettings, getSceneSetting, setSceneSetting } from "./settings.js";

// Self-executing hooks
import "./changelog.js";

const FLY_CONTROL = {
  name: SETTINGS.FLY_BUTTON,
  title: `${MODULE_ID}.controls.${SETTINGS.FLY_BUTTON}.name`,
  icon: "fa-solid fa-plane-lock",
  toggle: true
};

Hooks.once("init", function() {
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
    TravelElevation
  };

  FLY_CONTROL.title = game.i18n.localize(FLY_CONTROL.title);

  // These methods need to be registered early
  registerGeometry();
  registerElevationAdditions();
  registerSettings();
  registerLayer();
  registerAdditions();

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
     * Delay in milliseconds before displaying elevation values in the layer.
     * @type {number}
     */
    hoverDelay: 500,

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
     * If undefined, will use terrain height.
     * @type {number|undefined}
     */
    terrainStep: undefined,

    /**
     * TravelElevation.
     * When auto-averaging is enabled, this value will be used to average over terrain when
     * calculating token travel elevation. 0 means do not average, 1+ means test every N pixels.
     * Should be a positive integer or 0.
     * @type {number}
     */
    averageTerrain: 1, // Terrain elevation already compressed, so makes sense to not skip

    /**
     * TravelElevation.
     * When auto-averaging is enabled, this value will be used to average over tiles when
     * calculating token travel elevation. 0 means do not average, 1+ means test every N pixels.
     * Should be a positive integer or 0.
     * @type {number}
     */
    averageTiles: 4
  }
});

Hooks.once("libWrapper.Ready", async function() {
  patchTile();
});

Hooks.once("setup", async function() {
  registerPatches();
});

Hooks.on("canvasInit", async function(_canvas) {
  log("canvasInit");

  if ( typeof getSceneSetting(SETTINGS.AUTO_ELEVATION) === "undefined" ) {
    const autoelevate = getSetting(SETTINGS.AUTO_ELEVATION) ?? true;
    await setSceneSetting(SETTINGS.AUTO_ELEVATION, autoelevate);
  }

  if ( typeof getSceneSetting(SETTINGS.SHADING.ALGORITHM) === "undefined" ) {
    const algorithm = getSetting(SETTINGS.SHADING.ALGORITHM) ?? SETTINGS.SHADING.TYPES.WEBGL;
    await setSceneSetting(SETTINGS.SHADING.ALGORITHM, algorithm);
  }

  registerShadowPatches();
  updateFlyTokenControl();
});

Hooks.on("canvasReady", async function() {
  // Set the elevation grid now that we know scene dimensions
  if ( !canvas.elevation ) return;
  canvas.elevation.initialize();

  // Cache overhead tile pixel data.
  for ( const tile of canvas.tiles.placeables ) {
    if ( tile.document.overhead ) {
      // Match Levels settings. Prefer Levels settings.
      const levelsE = tile.document?.flag?.levels?.rangeBottom;
      if ( typeof levelsE !== "undefined" ) tile.document.setFlag(MODULE_ID, "elevation", levelsE);
      else tile.document.update({flags: { levels: { rangeBottom: tile.elevationE } } })

      // Cache the tile pixels.
      tile._textureData._evPixelCache = TilePixelCache.fromOverheadTileAlpha(tile);
    }
  }
});

Hooks.on("3DCanvasToggleMode", async function(isOn) {
  // TODO: Do we need to reset the values for the scene? Seems unnecessary, as a 3d canvas
  //       is not likely to be used in a non-3d state and require EV for it.
  if ( !isOn ) return;

  const autoelevateDisabled = getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const shadowsDisabled = getSceneSetting(SETTINGS.SHADING.ALGORITHM) !== SETTINGS.SHADING.TYPES.NONE;

  if ( autoelevateDisabled ) {
    await setSceneSetting(SETTINGS.AUTO_ELEVATION, false);
    updateFlyTokenControl(false);
  }
  if ( shadowsDisabled ) await setSceneSetting(SETTINGS.SHADING.ALGORITHM, SETTINGS.SHADING.TYPES.NONE);

  registerShadowPatches();
  await canvas.draw(canvas.scene);

  if ( autoelevateDisabled || shadowsDisabled ) {
    ui.notifications.notify("Elevated Vision autoelevate and features for the scenes for compatibility with 3D Canvas.");
  }
});

// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.on("getSceneControlButtons", addElevationLayerSceneControls);
Hooks.on("renderSceneControls", addElevationLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderElevationLayerSubControls);

function registerLayer() {
  CONFIG.Canvas.layers.elevation = { group: "primary", layerClass: ElevationLayer };
}


// Reset the token elevation when moving the token after a cloned drag operation.
// Token.prototype._refresh is then used to update the elevation as the token is moved.
Hooks.on("preUpdateToken", function(tokenD, changes, options, userId) {  // eslint-disable-line no-unused-vars
  const token = tokenD.object;
  log(`preUpdateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);
  log(`preUpdateToken hook moving ${tokenD.x},${tokenD.y} --> ${changes.x ? changes.x : tokenD.x},${changes.y ? changes.y : tokenD.y}`);

  token._elevatedVision ??= {};
  token._elevatedVision.tokenAdjustElevation = false; // Just a placeholder
  token._elevatedVision.tokenHasAnimated = false;

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;
  if ( typeof changes.x === "undefined" && typeof changes.y === "undefined" ) return;

  const tokenCenter = token.center;
  const tokenDestination = token.getCenter(changes.x ? changes.x : tokenD.x, changes.y ? changes.y : tokenD.y );
  const travelRay = new Ray(tokenCenter, tokenDestination);
  const te = new TravelElevation(token, travelRay);
  const travel = token._elevatedVision.travel = te.calculateElevationAlongRay(token.document.elevation);
  if ( !travel.adjustElevation ) return;

  if ( tokenD.elevation !== travel.finalElevation ) changes.elevation = travel.finalElevation;
  tokenD.object._elevatedVision.tokenAdjustElevation = true;
});

Hooks.on("updateToken", function(tokenD, changes, _options, _userId) {
  const token = tokenD.object;
  log(`updateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);

});

// Hook when a tile changes elevation.
// Track for Levels, to ensure minimum elevation for the scene is met.
Hooks.on("createTile", createTileHook);
Hooks.on("preUpdateTile", preUpdateTileHook);
Hooks.on("updateTile", updateTileHook);

function createTileHook(document, _options, _userId) {
//   if ( !canvas.elevation?._initialized ) return;

  const elevationMin = canvas.elevation.elevationMin;
  const rangeBottom = document.flags?.levels?.rangeBottom ?? document.elevation ?? elevationMin;
  const rangeTop = document.flags?.levels?.rangeTop ?? document.elevation ?? elevationMin;
  const min = Math.min(rangeBottom, rangeTop);

  if ( min < elevationMin ) {
    canvas.elevation.elevationMin = min;
    ui.notifications.notify(`Elevated Vision: Scene elevation minimum set to ${min} based on tile minimum elevation range.`);
  }
}

function preUpdateTileHook(document, changes, options, userId) {
  const updateData = {};
  if ( changes.flags?.levels?.rangeBottom ) updateData[`flags.${MODULE_ID}.elevation`] = changes.flags.levels.rangeBottom;
  else if ( changes.flags?.[MODULE_ID]?.elevation) updateData[`flags.levels.rangeBottom`] = changes.flags[MODULE_ID].elevation;
  foundry.utils.mergeObject(changes, updateData, {inplace: true});
}

function updateTileHook(document, change, _options, _userId) {
//   if ( !canvas.elevation?._initialized ) return;

//   const elevationMin = canvas.elevation.elevationMin;
//   const rangeBottom = change.flags?.levels?.rangeBottom ?? document.elevation ?? elevationMin;
//   const rangeTop = change.flags?.levels?.rangeTop ?? document.elevation ?? elevationMin;
//   const min = Math.min(rangeBottom, rangeTop);



//   if ( min < elevationMin ) {
//     canvas.elevation.elevationMin = min;
//     ui.notifications.notify(`Elevated Vision: Scene elevation minimum set to ${min} based on tile minimum elevation range.`);
//   }

  if ( change.overhead ) {
    document.object._textureData._evPixelCache = TilePixelCache.fromOverheadTileAlpha(document.object);
  } else if ( document.overhead ) {
    const cache = document.object._textureData._evPixelCache;

    if ( Object.hasOwn(change, "x")
      || Object.hasOwn(change, "y")
      || Object.hasOwn(change, "width")
      || Object.hasOwn(change, "height") ) {
      cache._resize();
    }

    if ( Object.hasOwn(change, "rotation")
      || Object.hasOwn(change, "texture")
      || (change.texture
        && (Object.hasOwn(change.texture, "scaleX")
        ||  Object.hasOwn(change.texture, "scaleY"))) ) {

      cache.clearTransforms();
    }
  }
}

Hooks.on("renderAmbientLightConfig", renderAmbientLightConfigHook);
Hooks.on("renderAmbientSoundConfig", renderAmbientSoundConfigHook);
Hooks.on("renderTileConfig", renderTileConfigHook);

Hooks.on("getSceneControlButtons", controls => {
  if ( !canvas.scene || !getSetting(SETTINGS.FLY_BUTTON) || !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;

  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(FLY_CONTROL);
});

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
Hooks.on("renderSceneConfig", renderSceneConfigHook);

async function renderSceneConfigHook(app, html, data) {
  util.log("SceneConfig", app, html, data);

  const renderData = {};
  renderData[MODULE_ID] = { algorithms: SETTINGS.SHADING.LABELS };

  if ( typeof data.document.getFlag(MODULE_ID, SETTINGS.ELEVATION_MINIMUM) === "undefined" ) {
    renderData[`data.flags.${MODULE_ID}.${SETTINGS.ELEVATION_MINIMUM}`] = getSetting(SETTINGS.ELEVATION_MINIMUM) ?? 0;
  }

  if ( typeof data.document.getFlag(MODULE_ID, SETTINGS.ELEVATION_INCREMENT) === "undefined" ) {
    renderData[`data.flags.${MODULE_ID}.${SETTINGS.ELEVATION_INCREMENT}`] = getSetting(SETTINGS.ELEVATION_INCREMENT) ?? canvas.dimensions.distance;
  }

  if ( typeof data.document.getFlag(MODULE_ID, SETTINGS.AUTO_ELEVATION) === "undefined" ) {
    renderData[`data.flags.${MODULE_ID}.${SETTINGS.AUTO_ELEVATION}`] = getSetting(SETTINGS.AUTO_ELEVATION) ?? true;
  }

  if ( typeof data.document.getFlag(MODULE_ID, SETTINGS.SHADING.ALGORITHM) === "undefined" ) {
    renderData[`data.flags.${MODULE_ID}.${SETTINGS.SHADING.ALGORITHM}`] = getSetting(SETTINGS.SHADING.ALGORITHM) ?? SETTINGS.SHADING.TYPES.WEBGL;
  }

  foundry.utils.mergeObject(data, renderData, {inplace: true});

  const form = html.find(`input[name="initial.scale"]`).closest(".form-group");
  const snippet = await renderTemplate(`modules/${MODULE_ID}/templates/scene-elevation-config.html`, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}

/**
 * Monitor whether EV has been enabled or disabled for a scene.
 */
Hooks.on("updateScene", updateSceneHook);

async function updateSceneHook(document, change, _options, _userId) {
  if ( canvas.scene.id !== document.id ) return;

  // If the updated scene is currently the active scene, then update patches and fly controls.
  const autoelevate = change.flags?.[MODULE_ID]?.[SETTINGS.AUTO_ELEVATION];
  if ( typeof autoelevate !== "undefined" ) {
    updateFlyTokenControl(autoelevate);
    if ( autoelevate === true ) ui.notifications.notify("Elevated Vision autoelevate enabled for scene.");
    else if ( autoelevate === false ) ui.notifications.notify("Elevated Vision autoelevate disabled for scene.");
  }

  const algorithm = change.flags?.[MODULE_ID]?.[SETTINGS.SHADING.ALGORITHM];
  if ( algorithm ) {
    registerShadowPatches();
    await canvas.draw();
    const label = game.i18n.localize(SETTINGS.SHADING.LABELS[algorithm]);
    ui.notifications.notify(`Elevated Vision scene shadows switched to ${label}.`);
  }
}

function updateFlyTokenControl(enable) {
  enable ??= getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const flyIndex = tokenTools.tools.findIndex(b => b.name === SETTINGS.FLY_BUTTON);
  if ( enable && !~flyIndex ) tokenTools.tools.push(FLY_CONTROL);
  else if ( ~flyIndex ) tokenTools.tools.splice(flyIndex, 1);
  ui.controls.render(true);
}

