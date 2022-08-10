import * as drawing from "./drawing.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";
import * as util from "./util.js";

import { registerPIXIPolygonMethods } from "./PIXIPolygon.js";
import { getRayCollisions3d } from "./clockwise_sweep.js";

import { MODULE_ID } from "./const.js";

import { registerAdditions, registerPatches } from "./patching.js";

Hooks.once('init', async function() {
  game.modules.get(MODULE_ID).api = {
    drawing,
    util,
    Point3d,
    Shadow,
    getRayCollisions3d
  };

  registerPIXIPolygonMethods();
  registerAdditions();
//   registerPatches();

});

Hooks.once('ready', async function () {
  //registerPatches();
});

Hooks.once('libWrapper.Ready', async function() {
  registerPatches();
});


// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

