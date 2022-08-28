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
import { ElevationGrid } from "./ElevationGrid.js";
import { WallTracer } from "./WallTracer.js";
import { FILOQueue } from "./FILOQueue.js";
import { ShadowLOSFilter } from "./ShadowLOSFilter.js";


Hooks.once("init", async function() {
  game.modules.get(MODULE_ID).api = {
    drawing,
    util,
    Point3d,
    Shadow,
    ElevationLayer,
    ElevationGrid,
    WallTracer,
    ShadowLOSFilter
  };

  registerPIXIPolygonMethods();
  registerAdditions();
  registerLayer();
});

Hooks.once("libWrapper.Ready", async function() {
  registerPatches();
});

Hooks.once("canvasReady", async function() {
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
  CONFIG.Canvas.layers.elevation = { group: "primary", layerClass: ElevationLayer }
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

  util.log("preUpdateToken", token, update, options, userId);
  if ( !("x" in update || "y" in update) ) return;
  if ( "elevation" in update ) return;

  util.log(`preUpdateToken token with elevation ${token.elevation} ${token.x},${token.y} --> ${update.x},${update.y}`);

  const currRect = canvas.grid.grid.getRect(token.width, token.height);
  currRect.x = token.x;
  currRect.y = token.y;
  util.log(`Token Bounds ${currRect.x},${currRect.y} width ${currRect.width} height ${currRect.height}`);

  const currTerrainElevation = canvas.elevation.averageElevation(currRect);
  util.log(`Current terrain elevation ${currTerrainElevation} and current token elevation ${token.elevation}`, currRect);
  if ( currTerrainElevation != token.elevation ) return;


  const newX = update.x ?? token.x;
  const newY = update.y ?? token.y;
  const newWidth = update.width ?? token.width;
  const newHeight = update.height ?? token.height;
  const newRect = canvas.grid.grid.getRect(newWidth, newHeight);
  newRect.x = newX;
  newRect.y = newY;
  util.log(`New token Bounds ${newRect.x},${newRect.y} width ${newRect.width} height ${newRect.height}`);
  const newTerrainElevation = canvas.elevation.averageElevation(newRect);
  util.log(`new terrain elevation ${newTerrainElevation}`, newRect);

  update.elevation = newTerrainElevation;
});
