/* globals
Hooks,
game
*/
"use strict";

import * as drawing from "./drawing.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";
import * as util from "./util.js";

import { registerPIXIPolygonMethods } from "./PIXIPolygon.js";

import { MODULE_ID } from "./const.js";

import { registerAdditions, registerPatches } from "./patching.js";

import {
  addElevationLayerSceneControls,
  addElevationLayerSubControls,
  renderElevationLayerSubControls
} from "./controls.js";

import { ElevationLayer } from "./ElevationLayer.js";

Hooks.once("init", async function() {
  game.modules.get(MODULE_ID).api = {
    drawing,
    util,
    Point3d,
    Shadow
  };

  registerPIXIPolygonMethods();
  registerAdditions();
  registerLayer();
});

Hooks.once("libWrapper.Ready", async function() {
  registerPatches();
});


// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.on("getSceneControlButtons", addElevationLayerSceneControls);
Hooks.on("renderSceneControls", addElevationLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderElevationLayerSubControls);


function registerLayer() {
  CONFIG.Canvas.layers.elevation = { group: "primary", layerClass: ElevationLayer }
}