/* globals
Hooks,
game,
canvas,
CONFIG,
renderTemplate
*/
"use strict";

import { MODULE_ID } from "./const.js";

import { autoElevationChangeForToken } from "./tokens.js";

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

Hooks.on("preUpdateToken", function(tokenD, update, options, userId) {
  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return;
  if ( !("x" in update || "y" in update) ) return;
  if ( "elevation" in update ) return;

  const token = tokenD.object;

  util.log("preUpdateToken", token, update, options, userId);

//   const newX = update.x ?? token.x;
//   const newY = update.y ?? token.y;
//   const newWidth = (update.width ?? token.width);
//   const newHeight = (update.height ?? token.height);
//   const newElevation = autoElevationChangeForToken(tokenD, { x: newX, y: newY }, { newWidth, newHeight });
//   if ( newElevation === null ) return;

//   update.elevation = newTerrainElevation;
});

Hooks.on("refreshToken", function(token, options) {
//   util.log("refreshToken", token, options, this);

  if ( !options.border || !getSetting(SETTINGS.AUTO_ELEVATION) ) return;

  // Old position: this.position
  // New position: this.document

  if ( util.points2dAlmostEqual(token.position, token.document) ) return;

//   const newElevation = autoElevationChangeForToken(token, token.document);
});


Hooks.on("renderSceneConfig", injectSceneConfiguration);
async function injectSceneConfiguration(app, html, data) {
  util.log("injectSceneConfig", app, html, data);

  if ( !app.object.getFlag(MODULE_ID, "elevationmin") ) app.object.setFlag(MODULE_ID, "elevationmin", 0);
  if ( !app.object.getFlag(MODULE_ID, "elevationstep") ) app.object.setFlag(MODULE_ID, "elevationstep", canvas.dimensions.distance);

  const form = html.find(`input[name="initial.scale"]`).closest(".form-group");
  const snippet = await renderTemplate(`modules/${MODULE_ID}/templates/scene-elevation-config.html`, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}
