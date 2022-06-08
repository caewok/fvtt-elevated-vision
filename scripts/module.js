import * as drawing from "./drawing.js";
import { ClipperLib } from "./ClockwiseSweep/clipper_unminified.js";
import { EVClockwiseSweepPolygon } from "./ClockwiseSweep/ClockwiseSweepPolygon.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";
import * as util from "./util.js";

import { registerPIXIPolygonMethods } from "./ClockwiseSweep/PIXIPolygon.js";
import { registerPIXIRectangleMethods } from "./ClockwiseSweep/PIXIRectangle.js";
import { registerPIXICircleMethods } from "./ClockwiseSweep/PIXICircle.js";
import { registerPolygonVertexMethods } from "./ClockwiseSweep/SimplePolygonEdge.js";

import { MODULE_ID } from "./const.js";

import { registerAdditions, registerPatches } from "./patching.js";

Hooks.once('init', async function() {
  game.modules.get(MODULE_ID).api = {
    EVClockwiseSweepPolygon,
    ClipperLib,
    drawing,
    util,
    Point3d,
  };

  registerPIXIPolygonMethods();
  registerPIXIRectangleMethods();
  registerPIXICircleMethods();
  registerPolygonVertexMethods();
  registerAdditions();

});

Hooks.once('ready', async function () {
  registerPatches();

  CONFIG.Canvas.losBackend = EVClockwiseSweepPolygon;
});


// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

