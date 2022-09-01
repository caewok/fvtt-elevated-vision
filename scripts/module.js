/* globals
Hooks,
game,
canvas,
CONFIG,
renderTemplate
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";

// API imports
import * as drawing from "./drawing.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";
import * as util from "./util.js";
import { EVVisionContainer } from "./vision.js";
import { WallTracer } from "./WallTracer.js";
import { FILOQueue } from "./FILOQueue.js";
import { ShadowLOSFilter } from "./ShadowLOSFilter.js";
import { ElevationGrid } from "./ElevationGrid.js";

// Register methods, patches, settings
import { registerPIXIPolygonMethods } from "./PIXIPolygon.js";
import { registerAdditions, registerPatches } from "./patching.js";

// For elevation layer registration and API
import { ElevationLayer } from "./ElevationLayer.js";

// Elevation Layer control tools
import {
  addElevationLayerSceneControls,
  addElevationLayerSubControls,
  renderElevationLayerSubControls
} from "./controls.js";

// Settings, to toggle whether to change elevation on token move
import { SETTINGS, getSetting, registerSettings } from "./settings.js";

Hooks.once("init", async function() {
  game.modules.get(MODULE_ID).api = {
    drawing,
    util,
    Point3d,
    Shadow,
    ElevationLayer,
    ElevationGrid,
    WallTracer,
    ShadowLOSFilter,
    EVVisionContainer,
    FILOQueue
  };

  // These methods need to be registered early
  registerSettings();
  registerPIXIPolygonMethods();
  registerLayer();
  registerAdditions();
});

// Hooks.once("libWrapper.Ready", async function() {
//   registerPatches();
// });

Hooks.once("setup", async function() {
  registerPatches();
});

Hooks.on("canvasReady", async function() {
  // Set the elevation grid now that we know scene dimensions
  if ( !canvas.elevation ) return;
  canvas.elevation.initialize();
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

Hooks.on("preUpdateToken", async function(token, update, options, userId) {
  // Rule:
  // If token elevation currently equals the terrain elevation, then assume
  // moving the token should update the elevation.
  // E.g. Token is flying at 30' above terrain elevation of 0'
  // Token moves to 25' terrain. No auto update to elevation.
  // Token moves to 35' terrain. No auto update to elevation.
  // Token moves to 30' terrain. Token & terrain elevation now match.
  // Token moves to 35' terrain. Auto update, b/c previously at 30' (Token "landed.")

  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return;

  util.log("preUpdateToken", token, update, options, userId);
  if ( !("x" in update || "y" in update) ) return;
  if ( "elevation" in update ) return;

  util.log(`preUpdateToken token with elevation ${token.elevation} ${token.x},${token.y} --> ${update.x},${update.y}`);

  const tokenShape = canvas.elevation._tokenShape(token.x, token.y, token.width, token.height);
  const currTerrainElevation = canvas.elevation.averageElevationWithinShape(tokenShape);
  util.log(`Current terrain elevation ${currTerrainElevation} and current token elevation ${token.elevation}`, tokenShape);
  if ( currTerrainElevation !== token.elevation ) return;

  const newX = update.x ?? token.x;
  const newY = update.y ?? token.y;
  const newWidth = update.width ?? token.width;
  const newHeight = update.height ?? token.height;

  const newTokenShape = canvas.elevation._tokenShape(newX, newY, newWidth, newHeight);
  const newTerrainElevation = canvas.elevation.averageElevationWithinShape(newTokenShape);
  util.log(`new terrain elevation ${newTerrainElevation}`, newTokenShape);

  update.elevation = newTerrainElevation;
});


Hooks.on("renderSceneConfig", injectSceneConfiguration);
async function injectSceneConfiguration(app, html, data) {
  log("injectSceneConfig", app, html, data);

  if ( !app.object.getFlag(MODULE_ID, "elevationmin") ) app.object.setFlag(MODULE_ID, "elevationmin", 0);
  if ( !app.object.getFlag(MODULE_ID, "elevationstep") ) app.object.setFlag(MODULE_ID, "elevationstep", canvas.dimensions.distance);

  const form = html.find(`input[name="initial.scale"]`).closest(".form-group");
  const snippet = await renderTemplate(`modules/${MODULE_ID}/templates/scene-elevation-config.html`, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}
