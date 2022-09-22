/* globals
Hooks,
game,
canvas,
CONFIG,
renderTemplate
*/
"use strict";

import { MODULE_ID } from "./const.js";

// API imports
import * as drawing from "./drawing.js";
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";
import { StencilMask } from "./perfect-vision/stencil-mask.js";
import { GraphicsStencilMask } from "./perfect-vision/graphics-stencil-mask.js";
import { DepthStencilShader } from "./perfect-vision/depth-stencil-shader.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";
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

Hooks.once("init", function() {
  game.modules.get(MODULE_ID).api = {
    drawing,
    util,
    extract,
    Point3d,
    Shadow,
    ElevationLayer,
    ElevationGrid,
    WallTracer,
    ShadowLOSFilter,
    FILOQueue,
    StencilMask,
    GraphicsStencilMask,
    DepthStencilShader
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

// Reset the token elevation when moving the token after a cloned drag operation.
// Token.prototype._refresh is then used to update the elevation as the token is moved.
Hooks.on("preUpdateToken", function(tokenD, update, options, userId) {
  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return;

  const token = tokenD.object;
  if ( typeof token._EV_elevationOrigin === "undefined" ) return;

  const keys = Object.keys(foundry.utils.flattenObject(update));
  const changed = new Set(keys);
  const positionChange = ["x", "y"].some(c => changed.has(c));
  if ( !positionChange ) return;

  util.log("preUpdateToken", token, update, options, userId);
  token.document.elevation = this._EV_elevationOrigin;
  token._EV_elevationOrigin = undefined;
});

// Add settings for minimum and step elevation to the scene configuration.
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
